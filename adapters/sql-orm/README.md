# SQL ORM Adapter

Provides a lightweight ORM facade over `Root`, translating SQL or QueryBuilder invocations into normalized events.

## Supported Features

- `SELECT`, `INSERT`, `UPDATE`, `DELETE` mapped to Create/Update/Delete events.
- INNER JOIN (1:N) between logical tables persisted inside the same `Root.state()` snapshot.
- WHERE clauses with equality, `IN`, and JSON path dereferencing (`value->>'field'`).
- ORDER BY on scalar JSON paths, plus LIMIT / OFFSET pagination.
- Transactions via `BEGIN`/`COMMIT`/`ROLLBACK`, batching multiple statements into a single `Patch` for atomic commit with undo/redo.

## Query Builder API

```ts
const user = await orm.objects
  .where({ 'value.name': { ilike: '%ann%' } })
  .orderBy([{ key: 'value.createdAt', dir: 'desc' }])
  .limit(10)
  .offset(20)
  .findOne();

user.update({ name: 'Eve' }).commit({ traceId: 'update-1', actor: 'cli' });
```

- `.where({...})`: equality or `{ ilike: pattern }` predicates on `id` or `value.*` paths.
- `.orderBy([{ key, dir }])`: multiple keys with mixed ASC/DESC.
- `.limit(n)` / `.offset(n)`.
- `.findMany()` / `.findOne()` returning the same `SqlResult` proxy as raw SQL (supports `update`, `delete`, `commit`, `undo`, `redo`).

Use `orm.builder('posts')` for non-default tables.

## Dialects

- **Postgres (default):** renders JSON operators (`value->>'field'`), `ILIKE`, standard LIMIT/OFFSET.
- **SQLite:** renders `json_extract("value", '$.field')`, approximates `ILIKE` by `LOWER(...) LIKE LOWER(...)`, and rewrites LIMIT/OFFSET in SQLite form. Evaluation happens in-memory so behaviour stays consistent.

Select dialect by `new SqlOrmAdapter(root, { dialect: 'sqlite' })`.

## Limitations

- WHERE clauses currently support simple equality, `IN`, and case-insensitive pattern matching (no arbitrary SQL expressions).
- JOINs are limited to INNER JOIN with equality predicates.
- JSON path support is limited to dotted object paths (`value.foo.bar`); array indices must be numeric strings.
- Binary payloads are passed through unchanged but still rely on upstream adapters (e.g. BlobFsAdapter) for storage.
