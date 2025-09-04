# root-paradigm

Vision: minimal event-sourcing-like core for state from linear commits.

## Quick Start
```sh
pnpm i
pnpm -C packages/core test
pnpm -C packages/core build
```

## API sketch
- `Root` – in-memory log of events.
- `commit(event)` – append event to log and notify subscribers.
- `history()` – inspect raw event log.
- `state()` – interpret log into current state.
- `compact()` – replace log with `Create` events representing the state.

## Invariants
- History is append-only and linear.
- State derives solely from the log and recomputes deterministically.
- `Update` without prior `Create` is ignored.
- `compact()` preserves observable state while shortening history.

## Roadmap
- Branching histories.
- CRDT merge.
