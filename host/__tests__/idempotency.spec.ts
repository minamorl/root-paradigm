import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteAdapter } from '../../adapters/sqlite/index.ts';
import type { EventN } from '../../adapters/types';

function makeEvent(traceId: string, id: string, seq: number): EventN {
  return {
    type: 'Create',
    id,
    value: { n: seq },
    seq: BigInt(seq),
    ts: new Date(2024, 0, 1 + seq).toISOString(),
    version: 1,
    traceId,
  };
}

describe('host idempotency via traceId', () => {
  let db: Database;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    db = new Database(':memory:');
    adapter = new SqliteAdapter(db);
  });

  afterEach(() => {
    db?.close();
  });

  it('deduplicates repeated traceId applications', async () => {
    await adapter.onNotify(makeEvent('trace-a', 'alpha', 1));
    await adapter.onNotify(makeEvent('trace-a', 'alpha', 2));
    await adapter.onNotify(makeEvent('trace-a', 'alpha', 3));

    const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE type != ?').get('Snapshot') as { n: number };
    expect(row.n).toBe(1);
  });

  it('allows multiple ids under the same traceId', async () => {
    const batch = [makeEvent('trace-b', 'beta-1', 1), makeEvent('trace-b', 'beta-2', 2), makeEvent('trace-b', 'beta-3', 3)];
    await adapter.onNotifyBatch?.(batch);

    const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE type != ?').get('Snapshot') as { n: number };
    expect(row.n).toBe(3);
  });

  it('persists distinct traceIds independently', async () => {
    await adapter.onNotify(makeEvent('trace-c1', 'gamma', 1));
    await adapter.onNotify(makeEvent('trace-c2', 'gamma', 2));

    const rows = db.prepare('SELECT trace_id, id FROM events WHERE type != ? ORDER BY seq').all('Snapshot') as Array<{ trace_id: string; id: string }>;
    expect(rows).toEqual([
      { trace_id: 'trace-c1', id: 'gamma' },
      { trace_id: 'trace-c2', id: 'gamma' },
    ]);
  });
});
