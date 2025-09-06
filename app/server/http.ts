import http from "http";
import { bootstrap } from "../bootstrap";
import type { BootstrapOptions } from "../bootstrap";
import type { Event as CoreEvent } from "@minamorl/root-core";
import { metrics } from "../../host/metrics";

export function startServer(port = 8080, opts: BootstrapOptions = {}) {
  const { host, sse, wal, sqlite } = bootstrap(opts);
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) return notFound(res);
      if (req.method === "GET" && (req.url === "/" || req.url === "/status")) {
        return await statusPage({ host, sse, wal, sqlite }, res);
      }
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
      if (req.method === "GET" && req.url === "/status.json") {
        const json = await collectStatus({ host, sse, wal, sqlite });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
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

async function collectStatus(ctx: { host: ReturnType<typeof bootstrap>["host"]; sse: ReturnType<typeof bootstrap>["sse"]; wal: ReturnType<typeof bootstrap>["wal"]; sqlite?: ReturnType<typeof bootstrap>["sqlite"]; }) {
  const started = new Date().toISOString();
  const health = await Promise.all([
    ctx.sse.health?.().catch(() => ({ ok: false })),
    ctx.wal.health?.().catch(() => ({ ok: false })),
    ctx.sqlite?.health?.().catch(() => ({ ok: false })),
  ]);
  const sseOk = health[0]?.ok ?? true;
  const walOk = health[1]?.ok ?? true;
  const sqliteOk = ctx.sqlite ? (health[2]?.ok ?? true) : null;
  return {
    ok: sseOk && walOk,
    node: process.version,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    time: new Date().toISOString(),
    endpoints: ["/", "/status.json", "/stream", "/health", "/metrics", "/events", "/compact", "/shutdown"],
    adapters: {
      sse: { ok: sseOk, name: ctx.sse.name },
      wal: { ok: walOk, name: ctx.wal.name },
      sqlite: ctx.sqlite ? { ok: sqliteOk, name: ctx.sqlite.name } : null,
    },
    metrics: metrics.render(),
  };
}

async function statusPage(ctx: { host: ReturnType<typeof bootstrap>["host"]; sse: ReturnType<typeof bootstrap>["sse"]; wal: ReturnType<typeof bootstrap>["wal"]; sqlite?: ReturnType<typeof bootstrap>["sqlite"]; }, res: http.ServerResponse) {
  const data = await collectStatus(ctx);
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const ok = data.ok ? "#16a34a" : "#dc2626";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Root Host Status</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 20px; color: #111827; }
    header { display:flex; align-items:center; gap:12px; }
    .dot { width:12px; height:12px; border-radius:50%; background:${ok}; display:inline-block; }
    pre { background:#f9fafb; padding:12px; border-radius:6px; overflow:auto; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    a { color:#2563eb; text-decoration:none; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  </style>
  <meta http-equiv="refresh" content="5" />
  </head>
  <body>
    <header>
      <span class="dot"></span>
      <h1>Root Host Status</h1>
    </header>
    <p>Uptime: <b>${data.uptimeSec}s</b> • Node: <code>${esc(data.node)}</code> • PID: ${data.pid}</p>
    <div class="grid">
      <section>
        <h2>Adapters</h2>
        <ul>
          <li>${esc(String(data.adapters.sse.name))}: <b style="color:${data.adapters.sse.ok ? '#16a34a' : '#dc2626'}">${data.adapters.sse.ok ? 'ok' : 'down'}</b></li>
          <li>${esc(String(data.adapters.wal.name))}: <b style="color:${data.adapters.wal.ok ? '#16a34a' : '#dc2626'}">${data.adapters.wal.ok ? 'ok' : 'down'}</b></li>
          ${data.adapters.sqlite ? `<li>${esc(String(data.adapters.sqlite.name))}: <b style="color:${data.adapters.sqlite.ok ? '#16a34a' : '#dc2626'}">${data.adapters.sqlite.ok ? 'ok' : 'down'}</b></li>` : '<li>sqlite: <i>not configured</i></li>'}
        </ul>
      </section>
      <section>
        <h2>Endpoints</h2>
        <ul>
          ${data.endpoints.map(e => `<li><a href="${e}">${e}</a></li>`).join('')}
        </ul>
      </section>
    </div>
    <section>
      <h2>Metrics</h2>
      <pre>${esc(data.metrics)}</pre>
    </section>
  </body>
</html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}
