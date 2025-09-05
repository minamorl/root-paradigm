RootHost

- Subscribes to Core Root and enriches notifications with `seq: bigint`, `ts: string`, `version: 1`, and optional `traceId`/`actor`.
- Fans out to all registered adapters, preserving order per adapter.
- Executes fanout asynchronously and swallows adapter errors to isolate failures.
- Provides `emit()`, `compact()`, and `shutdown()`; `shutdown()` waits for adapters' `drain()`.

Usage sketch:

  import { RootHost } from './root-host';
  import { makeRoot } from '../src/lib/root';
  import { SseAdapter } from '../adapters/sse';

  const root = makeRoot();
  const sse = new SseAdapter();
  const host = new RootHost(root, [sse]);
  host.emit({ type: 'Create', id: 'x', value: 1 }, { traceId: 't1' });

