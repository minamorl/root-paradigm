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
  // Add new columns for binary/json split if they don't exist.
  db.exec(
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS value_json TEXT;\n` +
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS value_blob BLOB;\n` +
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS value_ct TEXT;\n` +
    `ALTER TABLE state ADD COLUMN IF NOT EXISTS value_json TEXT;\n` +
    `ALTER TABLE state ADD COLUMN IF NOT EXISTS value_blob BLOB;\n` +
    `ALTER TABLE state ADD COLUMN IF NOT EXISTS value_ct TEXT;`
  );
}
