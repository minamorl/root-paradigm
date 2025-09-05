import { describe, it, expect } from 'vitest';
import type { Notify, EventN, BinaryRef } from '../../../adapters/types.ts';

type Statement = { run: (...args: any[]) => unknown };
type DB = { exec(sql: string): void; prepare(sql: string): Statement; transaction<T extends (...args:any[])=>unknown>(fn:T): T };

function makeMockDb() {
  const calls: { sql: string; args: any[] }[] = [];
  const db: DB = {
    exec(sql: string) { /* accept */ },
    prepare(sql: string): Statement {
      return {
        run: (...args: any[]) => {
          calls.push({ sql, args });
          return { changes: 1 } as any;
        },
      };
    },
    transaction<T extends (...args: any[]) => unknown>(fn: T): T {
      return ((...args: any[]) => fn(...args)) as any;
    },
  };
  return { db, calls };
}

function ev(value: unknown): EventN {
  return { type: 'Create', id: 'x', value, seq: 1n, ts: new Date().toISOString(), version: 1 };
}

describe('SqliteAdapter binary handling', () => {
  it('stores BinaryRef as JSON', async () => {
    const { db, calls } = makeMockDb();
    const { SqliteAdapter } = await import(new URL('../../../../adapters/sqlite/index.ts', import.meta.url).pathname);
    const sqlite = new SqliteAdapter(db);
    const ref: BinaryRef = { kind: 'blob', uri: 'blob:sha256-' + '0'.repeat(64), bytes: 10 };
    await sqlite.onNotify(ev(ref) as Notify);
    const ins = calls.find(c => c.sql.includes('INSERT INTO events'))!;
    expect(ins.args[4]).toBe(JSON.stringify(ref)); // value_json
    expect(ins.args[5]).toBe(null); // value_blob
    const up = calls.find(c => c.sql.includes('INSERT INTO state'))!;
    expect(up.args[1]).toBe(JSON.stringify(ref));
    expect(up.args[2]).toBe(null);
  });

  it('stores small Uint8Array inline as BLOB', async () => {
    const { db, calls } = makeMockDb();
    const { SqliteAdapter } = await import(new URL('../../../../adapters/sqlite/index.ts', import.meta.url).pathname);
    const sqlite = new SqliteAdapter(db, { inlineMaxBytes: 1024 });
    const bin = new Uint8Array([1,2,3]);
    await sqlite.onNotify(ev(bin) as Notify);
    const ins = calls.find(c => c.sql.includes('INSERT INTO events'))!;
    expect(ins.args[4]).toBe(null); // value_json
    expect(ins.args[5]).toBeInstanceOf(Uint8Array); // value_blob
    const up = calls.find(c => c.sql.includes('INSERT INTO state'))!;
    expect(up.args[1]).toBe(null);
    expect(up.args[2]).toBeInstanceOf(Uint8Array);
  });
});
