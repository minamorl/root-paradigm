# Repository Guidelines

## Project Structure & Module Organization
- `packages/core`: TypeScript library (`@minamorl/root-core`) with source, tests, and build output.
- `adapters/`: SSE, WAL‑NDJSON, SQLite, and Blob‑FS adapters and tests.
- `host/`: `RootHost` orchestration, metrics, and tests.
- `app/`: bootstrap and simple HTTP server for local runs.
- `src/lib/`: thin wiring that instantiates `Root` for the app.
- Transient/runtime data: `journal/`, `blobs/`, `.tmp/` (git‑ignored).

## Build, Test, and Development Commands
- `pnpm i`: install workspace deps.
- `pnpm build`: build `packages/core` (emits `dist/`).
- `pnpm test`: run Vitest with coverage for core.
- `pnpm dev`: Vitest watch mode for core.
- `pnpm lint`: ESLint over core sources.
Examples:
- `pnpm -C packages/core test`
- `pnpm -C packages/core build`

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Indent 2 spaces; semicolons; single quotes (Prettier in `packages/core/.prettierrc`).
- Files: kebab‑case (`root-host.ts`, `blob-fs.test.ts`).
- Imports: use public barrel `@minamorl/root-core`; avoid deep importing from `packages/core/src/*`.
- Keep pure, small modules with named exports.

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts`), coverage via `@vitest/coverage-v8`.
- Location/patterns: core uses `*.test.ts` (and focused variants like `*.binary.test.ts`); adapters may use `__tests__/*.spec.ts`.
- Run: `pnpm test` (CI) or `pnpm dev` (watch). Add tests for new behavior; prefer unit tests close to the module under test.

## Commit & Pull Request Guidelines
- Style: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). Example: `feat(sqlite): persist binary refs separately`.
- PRs: include summary, rationale, screenshots/logs if relevant, and link issues. Require: passing tests, `pnpm lint`, and no changes under `journal/`, `blobs/`, or `.tmp/`.
- Scope: avoid mixing refactors with features; keep diffs focused.

## Security & Configuration Tips
- Never commit data dirs: `journal/`, `blobs/`, `.tmp/`, `coverage/`, `dist/` (already in `.gitignore`).
- Local server: `app/server/http.ts` exposes `/stream`, `/events`, `/compact`, `/metrics`, `/health` on port 8080 by default. Example run entrypoint: bootstrap via `app/bootstrap.ts`.
- Binary handling: adapters should prefer `BinaryRef` over raw bytes; use `BlobFsAdapter` for local blob storage.

