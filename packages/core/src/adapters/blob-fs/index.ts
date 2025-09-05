import { createHash } from "crypto";
import { promises as fsp } from "fs";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import type { BlobAdapter } from '../../../../adapters/types.ts';

/** File-system based content-addressed blob store. */
export class BlobFsAdapter implements BlobAdapter {
  public readonly name = "blob-fs";
  constructor(private readonly baseDir: string = "blobs") {}

  async put(content: Uint8Array, opts: { contentType?: string } = {}) {
    const hex = createHash("sha256").update(content).digest("hex");
    const uri = `blob:sha256-${hex}`;
    const p = this.pathFor(hex);
    mkdirSync(dirname(p), { recursive: true });
    await fsp.writeFile(p, content);
    if (opts.contentType) {
      await fsp.writeFile(`${p}.ctx`, JSON.stringify({ contentType: opts.contentType }), "utf8");
    }
    return { uri, bytes: content.byteLength };
  }

  async get(uri: string) {
    const hex = this.hexFromUri(uri);
    const p = this.pathFor(hex);
    const content = new Uint8Array(await fsp.readFile(p));
    let contentType: string | undefined;
    try {
      contentType = JSON.parse(await fsp.readFile(`${p}.ctx`, "utf8"))?.contentType;
    } catch {}
    return { content, contentType };
  }

  async has(uri: string) {
    try {
      await fsp.stat(this.pathFor(this.hexFromUri(uri)));
      return true;
    } catch {
      return false;
    }
  }

  private pathFor(hex: string) {
    return join(this.baseDir, hex.slice(0, 2), hex);
  }
  private hexFromUri(uri: string) {
    const m = /^blob:sha256-([0-9a-f]{64})$/.exec(uri);
    if (!m) throw new Error(`invalid blob uri: ${uri}`);
    return m[1];
  }
}

