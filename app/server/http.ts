import http from "http";
import { bootstrap } from "../bootstrap";
import type { Event as CoreEvent } from "@minamorl/root-core";
import { metrics } from "../../host/metrics";

export function startServer(port = 8080) {
  const { host, sse } = bootstrap();
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) return notFound(res);
      if (req.method === "GET" && req.url === "/stream") {
        return sse.handler(req, res);
      }
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/metrics") {
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        res.end(metrics.render());
        return;
      }
      if (req.method === "POST" && req.url === "/events") {
        const body = await readJson(req);
        const meta = {
          traceId: (req.headers["x-trace-id"] as string) || body?.traceId,
          actor: (req.headers["x-actor"] as string) || body?.actor,
        };
        const events: CoreEvent[] = Array.isArray(body) ? body : body?.events ?? [body];
        host.emit(events, meta);
        res.writeHead(202);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/compact") {
        host.compact();
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/shutdown") {
        await host.shutdown();
        res.writeHead(204);
        res.end();
        // Allow process managers to handle exit.
        server.close();
        return;
      }
      notFound(res);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });
  server.listen(port);
  const stop = async () => {
    try {
      await host.shutdown();
    } finally {
      server.close();
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return { server };
}

function notFound(res: http.ServerResponse) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => {
        const s = Buffer.concat(chunks).toString("utf8");
        if (!s) return resolve(undefined);
        try {
          resolve(JSON.parse(s));
        } catch (e) {
          reject(e);
        }
      })
      .on("error", reject);
  });
}
