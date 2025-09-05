import type { Root } from "../packages/core/src/root";
import type { Event as CoreEvent } from "../packages/core/src/types";
import type { Adapter, Notify, EventN, Snapshot } from "../adapters/types";

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

  constructor(
    private readonly root: Root,
    adapters: Adapter[],
    opts?: {
      startSeq?: bigint;
      clock?: () => string;
      batch?: { size?: number; intervalMs?: number };
      queueCapacity?: number;
    },
  ) {
    this.seq = opts?.startSeq ?? 1n;
    this.now = opts?.clock ?? (() => new Date().toISOString());
    this.batchSize = opts?.batch?.size ?? 128;
    this.batchIntervalMs = opts?.batch?.intervalMs ?? 50;
    this.queueCapacity = opts?.queueCapacity ?? 10_000;
    this.workers = adapters.map(a => ({ adapter: a, queue: [], flushing: false, timer: null }));

    // Subscribe to Root and fan out notifications enriched with seq/ts/version/traceId.
    this.unsubscribe = this.root.subscribe(ev => {
      const n = this.enrich(ev);
      this.fanout(n);
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

  /** Shut down host: stop receiving, flush queues, and drain adapters. */
  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    // Flush all per-adapter queues.
    await Promise.all(this.workers.map(w => this.flushWorker(w)));
    // Call adapter drains (best-effort, swallow errors).
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
    const seq = this.seq++;
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

  /** Fan-out to all adapters asynchronously; errors are swallowed to avoid impacting Root. */
  private fanout(n: Notify): void {
    for (const w of this.workers) {
      const a = w.adapter;
      // If adapter supports batch, enqueue and schedule flush
      if (typeof a.onNotifyBatch === "function") {
        // Enqueue for batch processing; preserve order and avoid blocking Root.
        // Note: capacity is advisory; to avoid data loss we do not drop items.
        w.queue.push(n);
        // size-based flush
        if (w.queue.length >= this.batchSize) {
          void this.flushWorker(w);
        } else if (!w.timer) {
          // time-based flush
          w.timer = setTimeout(() => {
            w.timer = null;
            void this.flushWorker(w);
          }, this.batchIntervalMs);
        }
        continue;
      }
      // Single notify path
      Promise.resolve()
        .then(() => a.onNotify(n))
        .catch(() => {
          /* swallow */
        });
    }
  }

  private async flushWorker(w: AdapterWorker): Promise<void> {
    if (w.flushing) return;
    if (!w.queue.length) return;
    w.flushing = true;
    try {
      const batch = w.queue.splice(0, this.batchSize);
      await w.adapter.onNotifyBatch?.(batch);
    } catch {
      // swallow
    } finally {
      w.flushing = false;
      // If items remain, re-schedule flush quickly to preserve order
      if (w.queue.length) {
        // Run next microtask to avoid deep recursion
        queueMicrotask(() => void this.flushWorker(w));
      }
    }
  }
}
