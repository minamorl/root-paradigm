import type { Adapter, Notify } from "../types";
import type { IncomingMessage, ServerResponse } from "http";
import { SseHub } from "./hub";

type ResLike = Pick<ServerResponse, "writeHead" | "write" | "end" | "setHeader"> & {
  flushHeaders?: () => void;
  on?: (ev: string, cb: () => void) => void;
};

export class SseAdapter implements Adapter {
  public readonly name = "sse";
  private readonly hub: SseHub;
  private readonly heartbeats = new WeakMap<ResLike, NodeJS.Timeout>();

  constructor(hub = new SseHub()) {
    this.hub = hub;
  }

  // HTTP handler to register a client. Example usage with Node http:
  //   http.createServer((req, res) => sse.handler(req, res)).listen(8080)
  handler(_req: IncomingMessage, res: ResLike): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.writeHead?.(200);
    res.flushHeaders?.();
    res.write("retry: 2000\n\n");
    // initial comment for intermediates
    res.write(": connected\n\n");
    this.hub.add(res);
    // heartbeat every 15s
    const t = setInterval(() => {
      try {
        res.write(":\n\n");
      } catch {
        this.hub.remove(res);
        clearInterval(t);
      }
    }, 15000);
    this.heartbeats.set(res, t);
    const onClose = () => {
      this.hub.remove(res);
      const hb = this.heartbeats.get(res);
      if (hb) clearInterval(hb);
      try {
        res.end();
      } catch {}
    };
    res.on?.("close", onClose);
    res.on?.("finish", onClose);
  }

  async onNotify(n: Notify): Promise<void> {
    // Guard: SSE stream is text-only; require BinaryRef instead of raw binary.
    assertNoBinary(n);
    this.hub.broadcast(n);
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

function assertNoBinary(x: unknown): void {
  const visit = (v: unknown) => {
    if (v == null) return;
    if (isBinary(v)) throw new Error("sse cannot stream binary; expected BinaryRef");
    if (Array.isArray(v)) { for (const it of v) visit(it); return; }
    if (typeof v === 'object') { for (const it of Object.values(v as any)) visit(it); }
  };
  visit(x);
}
function isBinary(x: unknown): x is Uint8Array {
  return (
    !!x &&
    (x instanceof Uint8Array || (typeof (globalThis as any).Buffer !== "undefined" && (globalThis as any).Buffer?.isBuffer?.(x)))
  );
}
