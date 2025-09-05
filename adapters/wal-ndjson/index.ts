import { promises as fsp } from "fs";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import type { Adapter, Notify } from "../types";
import { appendAndFsync } from "./fs-append";

export class WalNdjsonAdapter implements Adapter {
  public readonly name = "wal-ndjson";
  private readonly dir: string;
  private handle: import("fs").promises.FileHandle | null = null;
  private currentDay = "";

  constructor(dir = "journal") {
    this.dir = dir;
  }

  async onNotify(n: Notify): Promise<void> {
    await this.onNotifyBatch([n]);
  }

  async onNotifyBatch(ns: Notify[]): Promise<void> {
    // Guard: NDJSON must be text-only; require BinaryRef instead of raw binary.
    for (const n of ns) assertNoBinary(n);
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await this.rotateIfNeeded(day);
    if (!this.handle) return;
    const lines = ns.map(n => JSON.stringify(n)).join("\n") + "\n";
    await appendAndFsync(this.handle, lines);
  }

  async drain(): Promise<void> {
    if (this.handle) {
      try {
        await this.handle.sync();
      } catch {}
      await this.handle.close();
      this.handle = null;
      this.currentDay = "";
    }
  }

  async health(): Promise<{ ok: boolean }> {
    try {
      // if dir is writable, consider ok. We attempt to open current day file lazily.
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private async rotateIfNeeded(day: string): Promise<void> {
    if (this.currentDay === day && this.handle) return;
    this.currentDay = day;
    const file = join(this.dir, `${day}.ndjson`);
    mkdirSync(dirname(file), { recursive: true });
    if (this.handle) await this.handle.close();
    this.handle = await fsp.open(file, "a");
  }
}

function assertNoBinary(x: unknown): void {
  const visit = (v: unknown) => {
    if (v == null) return;
    if (isBinary(v)) throw new Error("wal-ndjson cannot serialize binary; expected BinaryRef");
    if (Array.isArray(v)) { for (const it of v) visit(it); return; }
    if (typeof v === 'object') { for (const it of Object.values(v as any)) visit(it); }
  };
  visit(x);
}
function isBinary(x: unknown): x is Uint8Array {
  return (
    !!x &&
    (x instanceof Uint8Array || (typeof (globalThis as any).Buffer !== "undefined" && (globalThis as any).Buffer?.isBuffer?.(x)))
  );
}
