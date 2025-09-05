import { promises as fsp } from "fs";

export type Handle = import("fs").promises.FileHandle;

export async function appendAndFsync(handle: Handle, content: string): Promise<void> {
  await handle.appendFile(content, { encoding: "utf8" });
  // Ensure durability for the file; datasync is sufficient for content + metadata updates
  // on most platforms, but fall back to full sync if unavailable.
  // @ts-expect-error Node typings might not include datasync
  if (typeof handle.datasync === "function") {
    // @ts-expect-error see above
    await handle.datasync();
  } else if (typeof (handle as any).sync === "function") {
    await (handle as any).sync();
  } else {
    // As a last resort, close and reopen; caller may handle rotation.
    await handle.sync?.();
  }
}

