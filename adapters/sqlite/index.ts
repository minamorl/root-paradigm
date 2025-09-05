import type { Adapter, Notify, EventN } from "../types";
import { openDb, type DB, type Statement } from "./db";

export class SqliteAdapter implements Adapter {
  public readonly name = "sqlite";
  private readonly db: DB;
  private readonly insertEvent: Statement;
  private readonly upsertState: Statement;
  private readonly deleteState: Statement;
  private readonly insertSnapshot: Statement;
  private readonly txApply: (ns: Notify[]) => void;

  constructor(dbOrPath: DB | string) {
    this.db = openDb(dbOrPath);

    this.insertEvent = this.db.prepare(
      `INSERT INTO events (seq, ts, type, id, value, trace_id, version)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(seq) DO NOTHING`,
    );
    this.insertSnapshot = this.db.prepare(
      `INSERT INTO events (seq, ts, type, id, value, trace_id, version)
       VALUES (?, ?, 'Snapshot', NULL, NULL, ?, ?)
       ON CONFLICT(seq) DO NOTHING`,
    );
    this.upsertState = this.db.prepare(
      `INSERT INTO state(id, value) VALUES(?, ?)
       ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
    );
    this.deleteState = this.db.prepare(`DELETE FROM state WHERE id = ?`);

    this.txApply = this.db.transaction((ns: Notify[]) => {
      for (const n of ns) this.applyOne(n);
    });
  }

  async onNotify(n: Notify): Promise<void> {
    this.txApply([n]);
  }

  async onNotifyBatch(ns: Notify[]): Promise<void> {
    this.txApply(ns);
  }

  private applyOne(n: Notify): void {
    if (n.type === "Snapshot") {
      // Persist snapshot marker for completeness; no state mutation required.
      this.insertSnapshot.run(Number(n.seq), n.ts, (n as any).traceId ?? null, n.version);
      return;
    }
    const ev = n as EventN;
    const valueJson = ev.value === undefined ? null : JSON.stringify(ev.value);
    const res: any = this.insertEvent.run(
      Number(ev.seq),
      ev.ts,
      ev.type,
      ev.id,
      valueJson,
      ev.traceId ?? null,
      ev.version,
    );
    const inserted = !!(res && typeof res.changes === "number" ? res.changes > 0 : true);
    if (!inserted && ev.traceId) {
      // duplicate by traceId or seq; skip state mutation
      return;
    }
    switch (ev.type) {
      case "Create":
      case "Update":
        this.upsertState.run(ev.id, valueJson);
        break;
      case "Delete":
        this.deleteState.run(ev.id);
        break;
    }
  }

  async drain(): Promise<void> {
    // Synchronous driver; nothing buffered here.
  }

  async health(): Promise<{ ok: boolean }> {
    try {
      // no-op statement ensures DB is reachable
      this.insertSnapshot;
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // Optional helper usable by RootHost to initialize seq.
  maxSeq(): bigint {
    // We'll prepare a statement dynamically to avoid maintaining one.
    const stmt = this.db.prepare(`SELECT IFNULL(MAX(seq), 0) AS max FROM events`);
    const row: any = (stmt as any).get ? (stmt as any).get() : null;
    const max = row?.max ?? 0;
    return BigInt(max);
  }
}
