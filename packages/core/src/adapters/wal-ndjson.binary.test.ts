import { describe, it, expect } from 'vitest';
import type { Notify, EventN } from '../../../adapters/types.ts';
import { join } from 'path';

function ev(value: unknown): Notify {
  return { type: 'Create', id: 'x', value, seq: 1n, ts: new Date().toISOString(), version: 1 } as any as EventN;
}

describe('WalNdjsonAdapter binary guard', () => {
  it('rejects raw binary values; expects BinaryRef', async () => {
    const { WalNdjsonAdapter } = await import(new URL('../../../../adapters/wal-ndjson/index.ts', import.meta.url).pathname);
    const wal = new WalNdjsonAdapter(join('.tmp','wal-bin'));
    const bin = new Uint8Array([1,2,3,4]);
    await expect(wal.onNotify(ev({ data: bin }))).rejects.toThrow(/binary/);
  });
});

