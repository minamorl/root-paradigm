import { readFileSync } from "fs";
import { join } from "path";

export type Statement = { run: (...args: any[]) => unknown };
export type DB = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction<T extends (...args: any[]) => unknown>(fn: T): T;
};

/** Open a DB or accept an existing connection; apply migrations. */
export function openDb(dbOrPath: DB | string): DB {
  if (typeof dbOrPath === "string") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require("better-sqlite3");
    const db: DB = new BetterSqlite3(dbOrPath);
    applyMigrations(db);
    return db;
  }
  applyMigrations(dbOrPath);
  return dbOrPath;
}

function applyMigrations(db: DB): void {
  const sql = readFileSync(join(__dirname, "migrations", "001_init.sql"), "utf8");
  db.exec(sql);
  // Add new columns for binary/json split; tolerate duplicates on existing DBs.
  const alters = [
    `ALTER TABLE events ADD COLUMN value_json TEXT`,
    `ALTER TABLE events ADD COLUMN value_blob BLOB`,
    `ALTER TABLE events ADD COLUMN value_ct TEXT`,
    `ALTER TABLE state  ADD COLUMN value_json TEXT`,
    `ALTER TABLE state  ADD COLUMN value_blob BLOB`,
    `ALTER TABLE state  ADD COLUMN value_ct TEXT`,
  ];
  for (const sql2 of alters) {
    try {
      db.exec(sql2);
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      if (!/duplicate column name/i.test(msg)) throw e;
    }
  }
  migrateTraceIdUniqueConstraint(db);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_events_trace_id_id ON events(trace_id, id) WHERE trace_id IS NOT NULL AND id IS NOT NULL`);
}

function migrateTraceIdUniqueConstraint(db: DB): void {
  try {
    const idxStmt = db.prepare(`PRAGMA index_list('events')`);
    const idxRows: any[] = (idxStmt as any).all?.() ?? [];
    const legacy = idxRows.find(row => row && row.origin === 'u' && row.unique);
    if (!legacy) return;
    const name = String(legacy.name ?? '');
    const infoStmt = db.prepare(`PRAGMA index_info('${name.replace(/'/g, "''")}')`);
    const infoRows: any[] = (infoStmt as any).all?.() ?? [];
    const legacyTraceOnly = infoRows.length === 1 && infoRows[0]?.name === 'trace_id';
    if (!legacyTraceOnly) return;

    db.exec('BEGIN');
    try {
      db.exec('ALTER TABLE events RENAME TO events_legacy');
      db.exec(`CREATE TABLE events (
        seq INTEGER PRIMARY KEY,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        id TEXT,
        value BLOB,
        trace_id TEXT,
        version INTEGER NOT NULL,
        value_json TEXT,
        value_blob BLOB,
        value_ct TEXT
      )`);
      db.exec(`INSERT INTO events (seq, ts, type, id, value, trace_id, version, value_json, value_blob, value_ct)
               SELECT seq, ts, type, id, value, trace_id, version, value_json, value_blob, value_ct
               FROM events_legacy`);
      db.exec('DROP TABLE events_legacy');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    // Propagate unexpected errors for visibility.
    throw err;
  }
}
