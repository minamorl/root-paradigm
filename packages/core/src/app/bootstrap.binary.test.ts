import { describe, it, expect } from 'vitest';
import { BlobFsAdapter } from '../adapters/blob-fs/index.ts';

describe('bootstrap wiring with blob adapter', () => {
  it('instantiates RootHost with binary options', async () => {
    // eslint-disable-next-line import/no-restricted-paths
    const { bootstrap } = await import(new URL('../../../../app/bootstrap.ts', import.meta.url).pathname);
    const { host } = bootstrap({ blob: new BlobFsAdapter('.tmp/blobs'), journalDir: '.tmp/journal', metaDir: '.tmp/host/meta', binary: { inlineMaxBytes: 1024, sseBase64MaxBytes: 512 } });
    expect(host).toBeTruthy();
  });
});
