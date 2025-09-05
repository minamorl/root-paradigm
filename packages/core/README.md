# @minamorl/root-core

## Event union
```ts
type Create = { type: "Create"; id: string; value: unknown };
type Update = { type: "Update"; id: string; value: unknown };
type Delete = { type: "Delete"; id: string };
type Event = Create | Update | Delete;
```

## `state()` and `compact()`
`state()` scans the log, applying `Create`, `Update`, and `Delete` to build the current map. `Update` for missing ids is ignored. `compact()` snapshots `state()` and rewrites the log with only `Create` events for each surviving id.

## Update without Create is ignored
```ts
const root = new Root();
root.commit({ type: "Update", id: "x", value: 1 });
root.state(); // {}
```

## Binary values and Blob storage

- Binary payloads may appear in event `value` as `Uint8Array | Buffer` or as `BinaryRef`.
- `BinaryRef` is a content-addressed reference produced by a `BlobAdapter`:

```ts
type BinaryRef = {
  kind: 'blob';
  uri: string;       // e.g. "blob:sha256-<64 hex>"
  bytes: number;
  contentType?: string; // optional
}
```

In host/adapters wiring:

- Text-only adapters (WAL-NDJSON, SSE) never carry raw bytes; they only emit JSON containing `BinaryRef`.
- SQLite can inline small binaries (configurable threshold) as BLOBs and stores `BinaryRef` as JSON.
- A file-system `BlobFsAdapter` is provided for local content-addressed storage.

Example: storing an image returns a `blob:sha256-...` URI that downstream consumers can resolve via the configured `BlobAdapter`.
