# root-paradigm

Minimal, event-sourcing-like core for state derived from linear commits — with host and adapters for persistence and streaming.

## Features
- Small, deterministic core (`@minamorl/root-core`) with normalization and undo/redo.
- Host that enriches events with sequence/time and fans out to adapters.
- Adapters: SQLite, WAL-NDJSON, Server‑Sent Events (SSE), and file‑system blob storage.

## Monorepo Layout
- `packages/core`: Core TypeScript library and tests.
- `host/`: `RootHost` orchestrator and metrics.
- `adapters/`: SQLite, WAL‑NDJSON, SSE, Blob‑FS.
- `app/`: Bootstrap + minimal HTTP server for local runs.
- `src/lib/`: Thin wiring to instantiate `Root` for the app.

## Quick Start
Prereqs: Node 18+ and pnpm.
```sh
pnpm i
pnpm -C packages/core test     # run tests with coverage
pnpm -C packages/core build    # emit dist/
```

Run the sample HTTP server (port 8080):
```sh
pnpm dlx tsx app/server/http.ts
# stream:   curl -N http://localhost:8080/stream
# publish:  curl -XPOST localhost:8080/events -H 'content-type: application/json' \
#            -d '{"type":"Create","id":"u1","value":"Ann"}'
```

## Core API (sketch)
```ts
import { Root, rewrite, Patch } from '@minamorl/root-core';
const law = { enforce: (p: Patch) => p };
const root = new Root(rewrite, law);

root.commit({ type: 'Create', id: 'u1', value: 'Ann' });
root.commit({ type: 'Update', id: 'u1', value: 'Eve' });
console.log(root.state());       // { u1: 'Eve' }
console.log(root.history());     // normalized history
root.compact();                  // snapshot to Creates; emits Snapshot to subscribers
```

Subscribe to push updates:
```ts
const off = root.subscribe(ev => console.log('push:', ev));
off(); // unsubscribe
```

Patch + undo/redo:
```ts
const p = Patch.from([
  { type: 'Create', id: 'a', value: 1 },
  { type: 'Update', id: 'a', value: 2 },
], rewrite);
root.commit(p);
root.undo(p); // state back to previous snapshot
root.redo(p); // apply again
```

## HTTP Endpoints (app/server)
- `GET /stream`: SSE stream of notifications.
- `POST /events`: publish one or more core events (array or single object). Optional `x-trace-id`/`x-actor` headers.
- `POST /compact`: compact host/root.
- `GET /metrics` and `GET /health`.

Examples:
```sh
# Post a single event
curl -sS -XPOST localhost:8080/events \
  -H 'content-type: application/json' \
  -d '{"type":"Create","id":"u1","value":"Ann"}'

# Post a batch with metadata headers
curl -sS -XPOST localhost:8080/events \
  -H 'content-type: application/json' \
  -H 'x-trace-id: t-123' -H 'x-actor: bob' \
  -d '[{"type":"Update","id":"u1","value":"Eve"},{"type":"Delete","id":"u2"}]'

# Compact and watch the stream
curl -sS -XPOST localhost:8080/compact
curl -N http://localhost:8080/stream
```

## Development
- Lint: `pnpm lint`
- Tests (watch): `pnpm dev`
- Adapters and server store data under `journal/`, `blobs/`, `.tmp/` (git‑ignored).

## Host + Adapters Examples
Bootstrap with SQLite and Blob FS:
```ts
import { bootstrap } from './app/bootstrap';
const { host, sse } = bootstrap({ sqlite: 'data.db', binary: { inlineMaxBytes: 1024 } });
host.emit({ type: 'Create', id: 'u1', value: 'Ann' }, { traceId: 't1', actor: 'cli' });
// sse.handler(req,res) attaches to /stream (see app/server/http.ts)
```

Binary payloads with BlobFsAdapter:
```ts
import { BlobFsAdapter } from './adapters/blob-fs';
import type { BinaryRef } from './adapters/types';
const blob = new BlobFsAdapter('blobs');
const bytes = new Uint8Array([137,80,78,71]); // example
const { uri, bytes: n } = await blob.put(bytes, { contentType: 'application/octet-stream' });
const ref: BinaryRef = { kind: 'blob', uri, bytes: n, contentType: 'application/octet-stream' };
// Store reference in an event value
host.emit({ type: 'Create', id: 'file:1', value: ref });
```

## Invariants
- History is normalized and linear; state derives solely from the log.
- `Update` without prior `Create` is ignored by law/normalization.
- `compact()` preserves observable state while shortening history.

## Contributing
See `AGENTS.md` for contributor guidelines (structure, commands, style, tests, and PR workflow).
