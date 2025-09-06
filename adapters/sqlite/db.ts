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
}
