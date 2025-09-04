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
