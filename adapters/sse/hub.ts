import type { Notify } from "../types";
import type { ServerResponse } from "http";

type ResLike = Pick<ServerResponse, "writeHead" | "write" | "end" | "setHeader"> & {
  flushHeaders?: () => void;
  on?: (ev: string, cb: () => void) => void;
};

export class SseHub {
  private readonly clients = new Set<ResLike>();

  add(res: ResLike): void {
    this.clients.add(res);
  }

  remove(res: ResLike): void {
    this.clients.delete(res);
  }

  broadcast(n: Notify): void {
    const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
    const payload = `data: ${JSON.stringify(n, bigintSafe)}\n\n`;
    for (const res of Array.from(this.clients)) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}
