import { describe, it, expect, beforeEach } from 'vitest';
import { Root } from '../root';
import { rewrite } from '../rewrite';
import { Patch } from '../patch';
// eslint-disable-next-line import/no-restricted-paths
import { SqlOrmAdapter, QueryBuilder } from '../../../../adapters/sql-orm/index.ts';
// eslint-disable-next-line import/no-restricted-paths
import type { BinaryRef } from '../../../../adapters/types.ts';

describe('SqlOrmAdapter', () => {
  let root: Root;
  let orm: SqlOrmAdapter;
  const law = { enforce: (p: Patch) => p };

  beforeEach(() => {
    root = new Root(rewrite, law);
    orm = new SqlOrmAdapter(root);
  });

  function seed(
    records: Array<{ id: string; value: unknown }>,
    table = 'root',
    target: SqlOrmAdapter = orm,
  ): void {
    if (!records.length) return;
    const values = records
      .map(({ id, value }) => {
        const idSql = id.replace(/'/g, "''");
        const jsonRaw = JSON.stringify(value ?? null) ?? 'null';
        const json = jsonRaw.replace(/'/g, "''");
        return `('${idSql}', '${json}')`;
      })
      .join(', ');
    target.execute(`INSERT INTO ${table} (id, value) VALUES ${values}`).commit();
  }

  it('performs CRUD via SQL statements and tracks metadata', () => {
    const insert = orm.execute(`INSERT INTO root (id, value) VALUES ('u1', '{"name":"Ann"}')`);
    expect(insert.type).toBe('insert');
    expect(insert.length).toBe(1);
    expect(insert[0]).toEqual({ id: 'u1', value: { name: 'Ann' } });
    insert.commit({ traceId: 'trace-create', actor: 'cli' });
    expect(insert.meta).toEqual({ traceId: 'trace-create', actor: 'cli' });
    expect(root.state()).toEqual({ u1: { name: 'Ann' } });
    expect(orm.metaFor('u1')).toEqual([{ traceId: 'trace-create', actor: 'cli' }]);

    insert.undo();
    expect(root.state()).toEqual({});
    insert.redo();
    expect(root.state()).toEqual({ u1: { name: 'Ann' } });

    const selectAll = orm.execute('SELECT * FROM root');
    expect(selectAll.type).toBe('select');
    expect([...selectAll]).toEqual([{ id: 'u1', value: { name: 'Ann' } }]);

    const update = orm.execute(`UPDATE root SET value = '{"name":"Eve"}' WHERE id = 'u1'`);
    update.commit({ traceId: 'trace-update', actor: 'cli' });
    expect(root.state()).toEqual({ u1: { name: 'Eve' } });
    expect(update.meta).toEqual({ traceId: 'trace-update', actor: 'cli' });
    expect(orm.metaFor('u1')).toEqual([
      { traceId: 'trace-create', actor: 'cli' },
      { traceId: 'trace-update', actor: 'cli' },
    ]);

    const del = orm.execute(`DELETE FROM root WHERE id = 'u1'`);
    del.commit({ traceId: 'trace-delete', actor: 'cli' });
    expect(root.state()).toEqual({});
    expect(del.meta).toEqual({ traceId: 'trace-delete', actor: 'cli' });
    expect(orm.metaFor('u1')).toEqual([
      { traceId: 'trace-create', actor: 'cli' },
      { traceId: 'trace-update', actor: 'cli' },
      { traceId: 'trace-delete', actor: 'cli' },
    ]);
  });

  it('wraps SELECT rows with helper operations', () => {
    orm.execute(`INSERT INTO root (id, value) VALUES ('u1', '{"name":"Ann"}')`).commit();
    const selection = orm.execute(`SELECT * FROM root WHERE id = 'u1'`);
    expect(selection[0]).toEqual({ id: 'u1', value: { name: 'Ann' } });

    const fromSelect = selection.update({ name: 'Eve' });
    expect(fromSelect.type).toBe('update');
    fromSelect.commit({ traceId: 'select-update', actor: 'ui' });
    expect(root.state()).toEqual({ u1: { name: 'Eve' } });
    expect(fromSelect.meta).toEqual({ traceId: 'select-update', actor: 'ui' });

    fromSelect.undo();
    expect(root.state()).toEqual({ u1: { name: 'Ann' } });
    fromSelect.redo();
    expect(root.state()).toEqual({ u1: { name: 'Eve' } });

    const selectionAfterUpdate = orm.execute(`SELECT * FROM root WHERE id = 'u1'`);
    const deletion = selectionAfterUpdate.delete({ traceId: 'select-delete', actor: 'ui' });
    expect(root.state()).toEqual({});
    expect(deletion.meta).toEqual({ traceId: 'select-delete', actor: 'ui' });
  });

  it('records metadata even when normalization ignores updates without Create', () => {
    const update = orm.execute(`UPDATE root SET value = 'ghost' WHERE id = 'ghost'`);
    update.commit({ traceId: 'ghost-update', actor: 'cli' });
    expect(root.state()).toEqual({});
    expect(orm.metaFor('ghost')).toEqual([{ traceId: 'ghost-update', actor: 'cli' }]);
  });

  it('filters rows by JSON path equality', () => {
    seed([
      { id: 'u1', value: { name: 'Ann', createdAt: '2024-01-01T00:00:00.000Z' } },
      { id: 'u2', value: { name: 'Bob', createdAt: '2024-01-02T00:00:00.000Z' } },
      { id: 'u3', value: { name: 'Ann', createdAt: '2024-01-03T00:00:00.000Z' } },
    ]);
    const selection = orm.execute(`SELECT * FROM root WHERE value->>'name' = 'Ann'`);
    expect(selection.length).toBe(2);
    expect([...selection].map(row => row.id)).toEqual(['u1', 'u3']);
  });

  it('orders by JSON path with limit and offset', () => {
    const records = Array.from({ length: 50 }, (_, idx) => {
      const n = idx + 1;
      return {
        id: `u${n}`,
        value: {
          name: n % 2 === 0 ? 'Ann' : 'Bob',
          createdAt: `2024-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
          score: n,
        },
      };
    });
    seed(records);
    const selection = orm.execute(`SELECT * FROM root ORDER BY value->>'createdAt' DESC LIMIT 10 OFFSET 20`);
    expect(selection.length).toBe(10);
    expect([...selection].map(row => row.id)).toEqual([
      'u30',
      'u29',
      'u28',
      'u27',
      'u26',
      'u25',
      'u24',
      'u23',
      'u22',
      'u21',
    ]);
  });

  it('supports ordering by multiple keys with mixed direction', () => {
    seed([
      { id: 'r1', value: { name: 'Zoe', score: 10 } },
      { id: 'r2', value: { name: 'Ann', score: 10 } },
      { id: 'r3', value: { name: 'Cara', score: 5 } },
      { id: 'r4', value: { name: 'Bob', score: 10 } },
    ]);
    const selection = orm.execute(
      `SELECT * FROM root ORDER BY value->>'score' DESC, value->>'name' ASC`,
    );
    expect([...selection].map(row => row.id)).toEqual(['r2', 'r4', 'r1', 'r3']);
  });

  it('applies filtering and pagination together', () => {
    const records = Array.from({ length: 6 }, (_, idx) => {
      const n = idx + 1;
      return {
        id: `a${n}`,
        value: {
          type: n % 2 === 0 ? 'beta' : 'alpha',
          createdAt: `2024-02-0${n}T00:00:00.000Z`,
        },
      };
    });
    seed(records);
    const selection = orm.execute(
      `SELECT * FROM root WHERE value->>'type' = 'alpha' ORDER BY value->>'createdAt' ASC LIMIT 2 OFFSET 1`,
    );
    expect([...selection].map(row => row.id)).toEqual(['a3', 'a5']);
  });

  it('joins related tables via INNER JOIN', () => {
    seed(
      [
        { id: 'u1', value: { name: 'Ann' } },
        { id: 'u2', value: { name: 'Bob' } },
      ],
      'users',
    );
    seed(
      [
        { id: 'p1', value: { user_id: 'u1', title: 'Post A' } },
        { id: 'p2', value: { user_id: 'u1', title: 'Post B' } },
        { id: 'p3', value: { user_id: 'u2', title: 'Post C' } },
      ],
      'posts',
    );
    const selection = orm.execute(
      `SELECT u.id, p.id FROM users u JOIN posts p ON u.id = p.user_id ORDER BY p.id ASC`,
    );
    const ids = selection.rows.map(row => row.value as Record<string, unknown>);
    expect(ids).toEqual([
      { 'u.id': 'u1', 'p.id': 'p1' },
      { 'u.id': 'u1', 'p.id': 'p2' },
      { 'u.id': 'u2', 'p.id': 'p3' },
    ]);
  });

  it('commits multiple statements atomically within a transaction', () => {
    orm.execute('BEGIN');
    orm.execute(`INSERT INTO users (id, value) VALUES ('u1', '{"name":"Ann"}')`).commit({ traceId: 't-users' });
    orm
      .execute(`INSERT INTO posts (id, value) VALUES ('p1', '{"user_id":"u1","title":"Welcome"}')`)
      .commit({ traceId: 't-posts' });
    const commit = orm.execute('COMMIT');
    expect(commit.type).toBe('transaction');
    const users = orm.execute('SELECT * FROM users ORDER BY id ASC');
    expect(users.length).toBe(1);
    expect(users[0]).toEqual({ id: 'u1', table: 'users', value: { name: 'Ann' } });
    const posts = orm.execute('SELECT * FROM posts ORDER BY id ASC');
    expect(posts.length).toBe(1);
    expect(posts[0]).toEqual({ id: 'p1', table: 'posts', value: { user_id: 'u1', title: 'Welcome' } });
    expect(orm.metaFor('u1', 'users')).toEqual([{ traceId: 't-users' }]);
    expect(orm.metaFor('p1', 'posts')).toEqual([{ traceId: 't-posts' }]);

    commit.undo();
    expect(orm.execute('SELECT * FROM users').length).toBe(0);
    expect(orm.execute('SELECT * FROM posts').length).toBe(0);

    commit.redo();
    expect(orm.execute('SELECT * FROM users').length).toBe(1);
    expect(orm.execute('SELECT * FROM posts').length).toBe(1);
  });

  it('rolls back a transaction without mutating state', () => {
    orm.execute('BEGIN');
    orm.execute(`INSERT INTO users (id, value) VALUES ('u2', '{"name":"Bob"}')`).commit();
    orm.execute('ROLLBACK');
    expect(orm.execute('SELECT * FROM users').length).toBe(0);
  });

  describe('QueryBuilder', () => {
    it('generates SQL equivalent queries', async () => {
      seed(
        Array.from({ length: 50 }, (_, idx) => ({
          id: `b${idx + 1}`,
          value: {
            name: idx % 2 === 0 ? 'Ann' : 'Bob',
            createdAt: `2024-03-${String(idx + 1).padStart(2, '0')}T00:00:00.000Z`,
          },
        })),
      );
      const builder = orm.objects
        .where({ 'value.name': 'Ann' })
        .orderBy([{ key: 'value.createdAt', dir: 'desc' }])
        .limit(10)
        .offset(5);
      const viaBuilder = await builder.findMany();
      const viaSql = orm.execute(
        `SELECT * FROM root WHERE value->>'name' = 'Ann' ORDER BY value->>'createdAt' DESC LIMIT 10 OFFSET 5`,
      );
      expect([...viaBuilder].map(row => row.id)).toEqual([...viaSql].map(row => row.id));
      expect(builder.toSelectSql()).toContain("WHERE value->>'name' = 'Ann'");
    });

    it('supports undo/redo through builder results', async () => {
      seed([{ id: 'undo1', value: { name: 'Ann', createdAt: '2024-04-01T00:00:00.000Z' } }]);
      const result = await orm.objects.where({ id: 'undo1' }).findOne();
      expect(result.length).toBe(1);
      const update = result.update({ name: 'Eve' });
      update.commit({ traceId: 'builder-update', actor: 'cli' });
      expect(root.state()).toEqual({ undo1: { name: 'Eve' } });
      expect(orm.metaFor('undo1')).toEqual([{ traceId: 'builder-update', actor: 'cli' }]);
      update.undo();
      expect(root.state()).toEqual({ undo1: { name: 'Ann', createdAt: '2024-04-01T00:00:00.000Z' } });
      update.redo();
      expect(root.state()).toEqual({ undo1: { name: 'Eve' } });
    });

    it('targets SQLite dialect when requested', async () => {
      const sqliteRoot = new Root(rewrite, law);
      const sqliteOrm = new SqlOrmAdapter(sqliteRoot, { dialect: 'sqlite' });
      seed(
        [
          { id: 's1', value: { name: 'Ann', createdAt: '2024-05-01T00:00:00.000Z' } },
          { id: 's2', value: { name: 'Bob', createdAt: '2024-05-02T00:00:00.000Z' } },
        ],
        'root',
        sqliteOrm,
      );
      const builder = sqliteOrm.objects
        .where({ 'value.name': { ilike: '%ann%' } })
        .orderBy([{ key: 'value.createdAt', dir: 'asc' }]);
      const sql = builder.toSelectSql();
      expect(sql).toContain('json_extract');
      const result = await builder.findMany();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 's1', value: { name: 'Ann', createdAt: '2024-05-01T00:00:00.000Z' } });
    });

    it('maintains invariants for traceId, compact, and BinaryRef', async () => {
      seed([{ id: 'bin-1', value: { name: 'BinaryUser' } }]);
      const binary: BinaryRef = { kind: 'blob', uri: 'blob:sha256-a', bytes: 4, contentType: 'application/octet-stream' };
      const selection = await orm.objects.where({ id: 'bin-1' }).findOne();
      const update = selection.update({ attachment: binary });
      update.commit({ traceId: 'trace-binary', actor: 'cli' });
      expect(root.state()['bin-1']).toEqual({ attachment: binary });
      expect(orm.metaFor('bin-1')).toEqual([
        { traceId: 'trace-binary', actor: 'cli' },
      ]);
      root.compact();
      const afterCompact = await orm.objects.where({ id: 'bin-1' }).findOne();
      expect(afterCompact[0]).toEqual({ id: 'bin-1', value: { attachment: binary } });
      update.undo();
      expect(root.state()['bin-1']).toEqual({ name: 'BinaryUser' });
    });
  });
});
