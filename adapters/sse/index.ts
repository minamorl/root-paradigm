import type { Adapter, Notify } from "../types";
import type { IncomingMessage, ServerResponse } from "http";

type ResLike = Pick<ServerResponse, "writeHead" | "write" | "end" | "setHeader"> & {
  flushHeaders?: () => void;
};

export class SseAdapter implements Adapter {
  public readonly name = "sse";
  private readonly clients = new Set<ResLike>();

  constructor() {}

  // HTTP handler to register a client. Example usage with Node http:
  //   http.createServer((req, res) => sse.handler(req, res)).listen(8080)
  handler(_req: IncomingMessage, res: ResLike): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.writeHead?.(200);
    res.flushHeaders?.();
    res.write(": connected\n\n");
    this.clients.add(res);
    const onClose = () => {
      this.clients.delete(res);
      try {
        res.end();
      } catch {}
    };
    // Rely on runtime to call onClose when connection ends.
    // @ts-expect-error Node-specific APIs may exist at runtime
    res.on?.("close", onClose);
    // @ts-expect-error Node-specific APIs may exist at runtime
    res.on?.("finish", onClose);
  }

  async onNotify(n: Notify): Promise<void> {
    const payload = `data: ${JSON.stringify(n)}\n\n`;
    for (const res of Array.from(this.clients)) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}

