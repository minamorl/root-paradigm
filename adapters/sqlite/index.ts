import type { Adapter, Notify, EventN } from "../types";

// Minimal DB interface to avoid hard dependency; compatible with better-sqlite3.
type Statement = { run: (...args: any[]) => unknown };
type DB = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction<T extends (...args: any[]) => unknown>(fn: T): T;
};

export class SqliteAdapter implements Adapter {
  public readonly name = "sqlite";
  private readonly db: DB;
  private readonly insertEvent: Statement;
  private readonly upsertState: Statement;
  private readonly deleteState: Statement;
  private readonly insertSnapshot: Statement;
  private readonly txApply: (ns: Notify[]) => void;

  constructor(dbOrPath: DB | string) {
    // Lazy load better-sqlite3 if a path is provided.
    if (typeof dbOrPath === "string") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const BetterSqlite3 = require("better-sqlite3");
      this.db = new BetterSqlite3(dbOrPath);
    } else {
      this.db = dbOrPath;
    }

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS events (
        seq TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        id TEXT,
        value TEXT,
        trace_id TEXT UNIQUE,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state (
        id TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
      `,
    );

    this.insertEvent = this.db.prepare(
      `INSERT OR IGNORE INTO events (seq, ts, type, id, value, trace_id, version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertSnapshot = this.db.prepare(
      `INSERT OR IGNORE INTO events (seq, ts, type, id, value, trace_id, version)
       VALUES (?, ?, 'Snapshot', NULL, NULL, ?, ?)`,
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
      this.insertSnapshot.run(String(n.seq), n.ts, n.traceId ?? null, n.version);
      return;
    }
    const ev = n as EventN;
    const valueJson = ev.value === undefined ? null : JSON.stringify(ev.value);
    this.insertEvent.run(
      String(ev.seq),
      ev.ts,
      ev.type,
      ev.id,
      valueJson,
      ev.traceId ?? null,
      ev.version,
    );
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
}

