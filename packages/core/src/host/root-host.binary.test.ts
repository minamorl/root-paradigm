import { describe, it, expect } from 'vitest';
import { Root } from '../root';
import { rewrite } from '../rewrite';
// eslint-disable-next-line import/no-restricted-paths
import type { Adapter, Notify } from '../../../adapters/types.ts';
import { BlobFsAdapter } from '../adapters/blob-fs/index.ts';
import { join } from 'path';

class CaptureAdapter implements Adapter {
  name = 'capture';
  public last: Notify | null = null;
  async onNotify(n: Notify) { this.last = n; }
}

describe('RootHost binary preprocessing', () => {
  it('emits BinaryRef for large Uint8Array', async () => {
    // eslint-disable-next-line import/no-restricted-paths
    const { RootHost } = await import(new URL('../../../../host/root-host.ts', import.meta.url).pathname);
    const r = new Root(rewrite, { enforce: p => p });
    const cap = new CaptureAdapter();
    const blob = new BlobFsAdapter(join('.tmp', 'host-binary', 'blobs'));
    const host = new RootHost(r, [cap], { binary: { adapter: blob, inlineMaxBytes: 1024 } });
    // wait until subscription is established (initial Snapshot observed)
    await waitFor(() => cap.last && cap.last.type === 'Snapshot');
    const big = new Uint8Array(2048);
    big.fill(1);
    host.emit({ type: 'Create', id: 'b1', value: { data: big } }, { traceId: 't-big' });
    // wait for Create to be processed (initial Snapshot may arrive first)
    await waitFor(() => cap.last && cap.last.type === 'Create');
    expect(cap.last).not.toBeNull();
    expect((cap.last as any).type).toBe('Create');
    const ref = (cap.last as any).value.data;
    expect(ref.kind).toBe('blob');
    expect(ref.uri.startsWith('blob:sha256-')).toBe(true);
    expect(ref.bytes).toBe(2048);
  });

  it('passes small Uint8Array unchanged when no SSE', async () => {
    // eslint-disable-next-line import/no-restricted-paths
    const { RootHost } = await import(new URL('../../../../host/root-host.ts', import.meta.url).pathname);
    const r = new Root(rewrite, { enforce: p => p });
    const cap = new CaptureAdapter();
    const blob = new BlobFsAdapter(join('.tmp', 'host-binary', 'blobs'));
    const host = new RootHost(r, [cap], { binary: { adapter: blob, inlineMaxBytes: 32 * 1024 } });
    await waitFor(() => cap.last && cap.last.type === 'Snapshot');
    const small = new Uint8Array([1,2,3]);
    host.emit({ type: 'Create', id: 's1', value: { data: small } }, { traceId: 't-small' });
    await waitFor(() => cap.last && cap.last.type === 'Create');
    expect(cap.last).not.toBeNull();
    expect((cap.last as any).type).toBe('Create');
    expect((cap.last as any).value.data instanceof Uint8Array).toBe(true);
  });
});

async function waitFor(pred: () => any, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) break;
    await new Promise(r => setTimeout(r, 10));
  }
}
