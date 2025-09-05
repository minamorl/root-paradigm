HTTP Server

Endpoints

- GET `/stream`: SSE stream of Notify events.
- GET `/health`: simple health check.
- POST `/events`: body is a single Core event or `{ events: CoreEvent[] }`. Optional headers `x-trace-id`, `x-actor`.
- POST `/compact`: compact Root and emit Snapshot.
- POST `/shutdown`: flush and drain adapters, then close server.

Start

  import { startServer } from './http';
  startServer(8080);

