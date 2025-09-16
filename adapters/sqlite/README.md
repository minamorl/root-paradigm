# SQLite Adapter

The adapter persists `Notify` batches into SQLite using [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).

## Idempotency

- Each event row carries the originating `trace_id` from `RootHost`.
- A partial unique index enforces `(trace_id, id)` only when both fields are present. This allows a batch to contain many events sharing the same trace while still ignoring duplicate replays of the same entity.
- Inserts use `ON CONFLICT DO NOTHING`, so conflicts are silent and downstream state reconciliation is skipped for duplicates.
- Legacy databases that previously defined `trace_id TEXT UNIQUE` are migrated in-place by rebuilding the `events` table and re-applying indexes at startup.

If an event arrives without a `trace_id`, it is inserted without deduplication (matching previous behaviour).

