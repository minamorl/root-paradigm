/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import type { Notify, EventN } from '../../../adapters/types.ts';

function ev(value: unknown): Notify {
  return { type: 'Create', id: 'x', value, seq: 1n, ts: new Date().toISOString(), version: 1 } as any as EventN;
}

describe('SseAdapter binary guard', () => {
  it('rejects raw binary values; expects BinaryRef', async () => {
    // eslint-disable-next-line import/no-restricted-paths
    const { SseAdapter } = await import(new URL('../../../../adapters/sse/index.ts', import.meta.url).pathname);
    const sse = new SseAdapter();
    const bin = new Uint8Array([1,2,3,4]);
    await expect(sse.onNotify(ev({ data: bin }))).rejects.toThrow(/binary/);
  });
});
