import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { BlobFsAdapter } from './blob-fs/index.ts';

const TMP = join('.tmp', 'blob-fs-tests');

async function rimraf(p: string): Promise<void> {
  try {
    const st = await fsp.stat(p);
    if (st.isDirectory()) {
      const entries = await fsp.readdir(p);
      for (const e of entries) await rimraf(join(p, e));
      await fsp.rmdir(p);
    } else {
      await fsp.unlink(p);
    }
  } catch {}
}

describe('BlobFsAdapter', () => {
  beforeEach(async () => {
    await rimraf(TMP);
  });

  it('write/read roundtrip and has()', async () => {
    const blob = new BlobFsAdapter(join(TMP, 'blobs'));
    const content = new Uint8Array([1, 2, 3, 4]);
    const { uri, bytes } = await blob.put(content, { contentType: 'application/octet-stream' });
    expect(bytes).toBe(4);
    expect(uri.startsWith('blob:sha256-')).toBe(true);
    expect(await blob.has(uri)).toBe(true);
    const { content: back, contentType } = await blob.get(uri);
    expect(Array.from(back)).toEqual([1, 2, 3, 4]);
    expect(contentType).toBe('application/octet-stream');
  });

  it('different content yields different URIs', async () => {
    const blob = new BlobFsAdapter(join(TMP, 'blobs'));
    const a = await blob.put(new Uint8Array([1]));
    const b = await blob.put(new Uint8Array([2]));
    expect(a.uri).not.toBe(b.uri);
  });
});

