import type { Root, Event as CoreEvent } from "@minamorl/root-core";
import type { Adapter, Notify, EventN, Snapshot, BlobAdapter, BinaryRef } from "../adapters/types";
import { metrics } from "./metrics";
import { promises as fsp } from "fs";
import { dirname, join } from "path";
import { mkdirSync } from "fs";

export type EmitMeta = { traceId?: string; actor?: string };

type AdapterWorker = {
  adapter: Adapter;
  queue: Notify[];
  flushing: boolean;
  timer?: ReturnType<typeof setTimeout> | null;
};

export class RootHost {
  private seq: bigint;
  private readonly version = 1 as const;
  private readonly now: () => string;
  private readonly unsubscribe: () => void;
  private readonly workers: AdapterWorker[];
  private currentMeta: EmitMeta | undefined;
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private readonly queueCapacity: number;
  private readonly strategy: "block" | "drop-new" | "drop-old";
  private readonly metaDir: string;
  private readonly binary?: {
    adapter: BlobAdapter;
    inlineMaxBytes: number;
    sseBase64MaxBytes: number;
  };

  constructor(
    private readonly root: Root,
    adapters: Adapter[],
    opts?: {
      startSeq?: bigint;
      clock?: () => string;
      batch?: { size?: number; intervalMs?: number };
      queueCapacity?: number;
      strategy?: "block" | "drop-new" | "drop-old";
      metaDir?: string;
      binary?: {
        adapter: BlobAdapter;
        inlineMaxBytes?: number;
        sseBase64MaxBytes?: number;
      };
    },
  ) {
    this.seq = 0n; // will be loaded
    this.now = opts?.clock ?? (() => new Date().toISOString());
    this.batchSize = opts?.batch?.size ?? 128;
    this.batchIntervalMs = opts?.batch?.intervalMs ?? 50;
    this.queueCapacity = opts?.queueCapacity ?? 10_000;
    this.strategy = opts?.strategy ?? "drop-new";
    this.metaDir = opts?.metaDir ?? join("host", "meta");
    this.workers = adapters.map(a => ({ adapter: a, queue: [], flushing: false, timer: null }));
    if (opts?.binary) {
      this.binary = {
        adapter: opts.binary.adapter,
        inlineMaxBytes: opts.binary.inlineMaxBytes ?? 32 * 1024,
        sseBase64MaxBytes: opts.binary.sseBase64MaxBytes ?? 8 * 1024,
      };
    }

    // Initialize sequence from adapters or meta file
    void this.initSeqFrom(adapters)
      .catch(() => {})
      .finally(() => {
        // Subscribe to Root and fan out notifications enriched with seq/ts/version/traceId.
        this.unsubscribe = this.root.subscribe(ev => {
          const n = this.enrich(ev);
          this.fanout(n);
        });
      });
  }

  /**
   * Delegate event emission to Root, optionally tagging with meta (traceId, actor).
   * Any Root notifications produced synchronously will inherit the provided meta.
   */
  emit(ev: CoreEvent | readonly CoreEvent[], meta?: EmitMeta): void {
    this.currentMeta = meta;
    try {
      // Root.commit is synchronous; subscription handlers run within this call.
      this.root.commit(Array.isArray(ev) ? ev : (ev as CoreEvent));
    } finally {
      this.currentMeta = undefined;
    }
  }

  /** Trigger Root.compact() passthrough. */
  compact(): void {
    this.root.compact();
  }

  /** Shut down host: stop receiving, flush queues with timeout, then drain adapters. */
  async shutdown(opts: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    this.unsubscribe?.();
    const deadline = Date.now() + timeoutMs;
    // Flush all per-adapter queues.
    for (const w of this.workers) {
      while (w.queue.length) {
        if (Date.now() > deadline) break;
        // kick off a flush if not already flushing
        if (!w.flushing) void this.flushWorker(w);
        await new Promise(r => setTimeout(r, 10));
      }
    }
    // Call adapter drains (best-effort).
    await Promise.all(
      this.workers.map(async w => {
        try {
          await w.adapter.drain?.();
        } catch {
          // swallow
        }
      }),
    );
  }

  /** Convert Root event/snapshot into enriched Notify with seq/ts/version and optional meta. */
  private enrich(ev: CoreEvent | { type: "Snapshot" }): Notify {
    const ts = this.now();
    const seq = ++this.seq;
    // Persist latest seq asynchronously (best-effort)
    void this.persistSeq(seq).catch(() => {});
    if (ev.type === "Snapshot") {
      const snap: Snapshot = { type: "Snapshot", seq, ts, version: this.version };
      return snap;
    }
    const { traceId, actor } = this.currentMeta ?? {};
    const n: EventN = {
      type: ev.type,
      id: ev.id,
      value: (ev as any).value,
      seq,
      ts,
      version: this.version,
      traceId,
      actor,
    };
    return n;
  }

  /** Fan-out to all adapters asynchronously with batching, retries, and DLQ. */
  private fanout(n: Notify): void {
    for (const w of this.workers) {
      const a = w.adapter;
      // If adapter supports batch, enqueue and schedule flush
      if (typeof a.onNotifyBatch === "function") {
        // Capacity management
        if (w.queue.length >= this.queueCapacity) {
          switch (this.strategy) {
            case "drop-new":
              metrics.inc("dropped", 1, "Dropped fanout notifications");
              return;
            case "drop-old":
              w.queue.shift();
              metrics.inc("dropped", 1);
              break;
            case "block": {
              // Defer enqueue until there is space; keep order.
              const tryEnq = () => {
                if (w.queue.length < this.queueCapacity) {
                  w.queue.push(n);
                  this.afterEnqueue(w);
                } else {
                  setTimeout(tryEnq, 1);
                }
              };
              tryEnq();
              return;
            }
          }
        }
        w.queue.push(n);
        this.afterEnqueue(w);
        continue;
      }
      // Single notify path with retry/DLQ
      void this.sendWithRetry(a, [n]);
    }
  }

  private afterEnqueue(w: AdapterWorker): void {
    metrics.set("queue_depth", w.queue.length);
    if (w.queue.length >= this.batchSize) {
      void this.flushWorker(w);
    } else if (!w.timer) {
      w.timer = setTimeout(() => {
        w.timer = null;
        void this.flushWorker(w);
      }, this.batchIntervalMs);
    }
  }

  private async flushWorker(w: AdapterWorker): Promise<void> {
    if (w.flushing) return;
    if (!w.queue.length) return;
    w.flushing = true;
    try {
      const batch = w.queue.splice(0, this.batchSize);
      await this.sendWithRetry(w.adapter, batch);
    } catch {
      // already handled in sendWithRetry
    } finally {
      w.flushing = false;
      // If items remain, re-schedule flush quickly to preserve order
      if (w.queue.length) {
        // Run next microtask to avoid deep recursion
        queueMicrotask(() => void this.flushWorker(w));
      }
    }
  }

  private async sendWithRetry(adapter: Adapter, batch: Notify[]): Promise<void> {
    // Normalize binary payloads per-adapter before send.
    if (this.binary) {
      batch = await this.normalizeBatchForAdapter(adapter, batch);
    }
    const max = 5;
    let attempt = 0;
    while (attempt < max) {
      try {
        if (typeof adapter.onNotifyBatch === "function") {
          await adapter.onNotifyBatch(batch);
        } else {
          for (const n of batch) await adapter.onNotify(n);
        }
        metrics.inc("sent", batch.length, "Successfully sent notifications");
        return;
      } catch (e) {
        attempt++;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        await new Promise(r => setTimeout(r, delay));
        if (attempt >= max) {
          metrics.inc("failed", batch.length, "Failed notifications after retries");
          await this.toDLQ(batch);
          return;
        }
      }
    }
  }

  private async toDLQ(batch: Notify[]) {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const file = join("host", "dlq", `${day}.ndjson`);
    mkdirSync(dirname(file), { recursive: true });
    const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
    const lines = batch.map(n => JSON.stringify(n, bigintSafe)).join("\n") + "\n";
    await fsp.appendFile(file, lines, { encoding: "utf8" });
  }

  private async initSeqFrom(adapters: Adapter[]): Promise<void> {
    // Try SQLite-like adapters exposing maxSeq
    for (const a of adapters) {
      const anyA = a as any;
      if (typeof anyA.maxSeq === "function") {
        try {
          const max: bigint = await Promise.resolve(anyA.maxSeq());
          if (max > this.seq) this.seq = max;
        } catch {}
      }
    }
    // Fallback to meta file
    try {
      const p = join(this.metaDir, "seq");
      const s = await fsp.readFile(p, "utf8");
      const n = BigInt(s.trim() || "0");
      if (n > this.seq) this.seq = n;
    } catch {}
  }

  private async persistSeq(seq: bigint): Promise<void> {
    const p = join(this.metaDir, "seq");
    mkdirSync(dirname(p), { recursive: true });
    await fsp.writeFile(p, String(seq), { encoding: "utf8" });
  }

  // Binary normalization helpers
  private async normalizeBatchForAdapter(adapter: Adapter, batch: Notify[]): Promise<Notify[]> {
    const isSse = adapter.name === "sse";
    const isWal = adapter.name === "wal-ndjson";
    const forceRef = isSse || isWal;
    const out: Notify[] = [];
    for (const n of batch) {
      if (n.type === "Snapshot") {
        out.push(n);
        continue;
      }
      const ev = n as EventN;
      const value = await this.normalizeBinaryDeep(ev.value, { forceRef });
      out.push({ ...ev, value });
    }
    return out;
  }

  private async normalizeBinaryDeep(input: unknown, opts: { forceRef: boolean }): Promise<unknown> {
    if (!this.binary) return input;
    const { adapter, inlineMaxBytes } = this.binary;
    const seen = new WeakSet<object>();
    const visit = async (v: unknown): Promise<unknown> => {
      if (v == null) return v;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return v;
      if (isBinary(v)) {
        const bytes = (v as Uint8Array).byteLength;
        if (opts.forceRef || bytes > inlineMaxBytes) {
          const b = v as Uint8Array;
          const { uri, bytes: sz } = await adapter.put(b);
          const ref: BinaryRef = { kind: "blob", uri, bytes: sz };
          return ref;
        }
        return v;
      }
      if (Array.isArray(v)) {
        const arr = new Array(v.length);
        for (let i = 0; i < v.length; i++) arr[i] = await visit(v[i]);
        return arr;
      }
      if (typeof v === "object") {
        if (seen.has(v as object)) return v; // avoid cycles
        seen.add(v as object);
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[k] = await visit(val);
        }
        return out;
      }
      return v;
    };
    return await visit(input);
  }
}

function isBinary(x: unknown): x is Uint8Array {
  // Buffer is a Uint8Array subclass; also catch plain Uint8Array
  return (
    !!x &&
    (x instanceof Uint8Array || (typeof (globalThis as any).Buffer !== "undefined" && (globalThis as any).Buffer?.isBuffer?.(x)))
  );
}
