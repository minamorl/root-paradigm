import type { Root, Event } from '@minamorl/root-core';
import { Patch } from '@minamorl/root-core';
import ParserPkg from 'node-sql-parser';
import type {
  AST,
  Select,
  Insert_Replace,
  Update as UpdateAst,
  Delete as DeleteAst,
  OrderBy,
  Limit,
} from 'node-sql-parser';

export type SqlMeta = { traceId?: string; actor?: string };

type StatementType = 'select' | 'insert' | 'update' | 'delete' | 'transaction';

type ParserCtor = new () => { astify(sql: string): AST | AST[] };

const { Parser } = ParserPkg as unknown as { Parser: ParserCtor };

export type SqlRow = {
  id: string;
  value: unknown;
  table?: string;
};

type EntityRow = { table: string; id: string; value: unknown };

type RowContext = {
  entities: Record<string, EntityRow>;
  defaultEntity: EntityRow;
};

type CreateResultOptions = {
  mutable?: boolean;
  patch?: Patch;
  autoCommitted?: boolean;
};

class SqlOperation {
  public readonly rows: SqlRow[];
  public readonly type: StatementType;
  private readonly events: Event[];
  private readonly patch: Patch | null;
  private committed: boolean;
  private lastMeta: SqlMeta | undefined;
  private readonly mutable: boolean;

  constructor(
    private readonly adapter: SqlOrmAdapter,
    type: StatementType,
    rows: SqlRow[],
    events: Event[],
    opts: CreateResultOptions = {},
  ) {
    this.type = type;
    this.rows = rows;
    this.events = events;
    this.patch = opts.patch ?? (events.length ? Patch.from(events, evs => [...evs]) : null);
    this.mutable = opts.mutable ?? (type !== 'select');
    this.committed = opts.autoCommitted ?? false;
  }

  commit(meta?: SqlMeta): SqlOperation {
    if (!this.patch || this.committed) return this;
    this.adapter.commitPatch(this.patch, this.events, meta);
    this.committed = true;
    this.lastMeta = meta ? { ...meta } : meta;
    return this;
  }

  undo(): SqlOperation {
    if (!this.patch || !this.committed) return this;
    if (this.adapter.isTransactionActive()) {
      throw new Error('Cannot undo while a transaction is active');
    }
    this.adapter.root.undo(this.patch);
    this.committed = false;
    return this;
  }

  redo(): SqlOperation {
    if (!this.patch || this.committed) return this;
    if (this.adapter.isTransactionActive()) {
      throw new Error('Cannot redo while a transaction is active');
    }
    this.adapter.root.redo(this.patch);
    this.committed = true;
    return this;
  }

  update(value: unknown, meta?: SqlMeta): SqlResult {
    if (!this.mutable) {
      throw new Error('Cannot update result set');
    }
    const result = this.adapter.makeUpdateFromRows(this.rows, value);
    if (meta) result.commit(meta);
    return result;
  }

  delete(meta?: SqlMeta): SqlResult {
    if (!this.mutable) {
      throw new Error('Cannot delete from result set');
    }
    const result = this.adapter.makeDeleteFromRows(this.rows);
    if (meta) result.commit(meta);
    return result;
  }

  get meta(): SqlMeta | undefined {
    return this.lastMeta;
  }
}

type Dialect = 'postgres' | 'sqlite';

export class SqlOrmAdapter {
  public readonly root: Root;
  private readonly parser: InstanceType<typeof Parser>;
  private readonly defaultTable: string;
  private readonly metadata = new Map<string, SqlMeta[]>();
  private tx: {
    patch: Patch | null;
    events: Event[];
    metas: Array<{ key: string; meta: SqlMeta }>;
  } | null = null;
  private readonly dialect: Dialect;

  constructor(root: Root, opts?: { table?: string; dialect?: Dialect }) {
    this.root = root;
    this.defaultTable = (opts?.table ?? 'root').toLowerCase();
    this.parser = new Parser();
    this.dialect = opts?.dialect ?? 'postgres';
  }

  execute(sql: string): SqlResult {
    const ast = this.parser.astify(sql);
    if (Array.isArray(ast)) throw new Error('Multiple statements not supported');
    switch (ast.type) {
      case 'select':
        return this.handleSelect(ast as Select);
      case 'insert':
        return this.handleInsert(ast as Insert_Replace);
      case 'update':
        return this.handleUpdate(ast as UpdateAst);
      case 'delete':
        return this.handleDelete(ast as DeleteAst);
      case 'transaction':
        return this.handleTransaction(ast);
      default:
        throw new Error(`Unsupported SQL type: ${(ast as { type: string }).type}`);
    }
  }

  get objects(): QueryBuilder {
    return new QueryBuilder(this, { table: this.defaultTable, dialect: this.dialect });
  }

  builder(table: string): QueryBuilder {
    return new QueryBuilder(this, { table: table.toLowerCase(), dialect: this.dialect });
  }

  metaFor(id: string, table?: string): readonly SqlMeta[] {
    if (table) {
      return this.metadata.get(this.metaKey(table, id)) ?? [];
    }
    if (id.includes(':')) {
      return this.metadata.get(id) ?? [];
    }
    return this.metadata.get(this.metaKey(this.defaultTable, id)) ?? [];
  }

  commitPatch(patch: Patch, events: Event[], meta?: SqlMeta): void {
    if (this.tx) {
      this.tx.patch = this.tx.patch ? this.tx.patch.compose(patch) : patch;
      this.tx.events.push(...events);
      if (meta) this.queueMeta(events, meta, this.tx);
      return;
    }
    this.root.commit(patch);
    if (meta) this.applyMeta(events, meta);
  }

  makeUpdateFromRows(rows: SqlRow[], value: unknown): SqlResult {
    const targets = this.uniqueEntityRows(rows);
    const events = targets.map<Event>(row => ({ type: 'Update', id: this.composeId(row.table, row.id), value }));
    const resultRows = targets.map(row => this.formatRow({ table: row.table, id: row.id, value }));
    return this.createResult('update', resultRows, events);
  }

  makeDeleteFromRows(rows: SqlRow[]): SqlResult {
    const targets = this.uniqueEntityRows(rows);
    const events = targets.map<Event>(row => ({ type: 'Delete', id: this.composeId(row.table, row.id) }));
    const resultRows = targets.map(row => this.formatRow({ table: row.table, id: row.id, value: undefined }));
    return this.createResult('delete', resultRows, events);
  }

  isTransactionActive(): boolean {
    return this.tx !== null;
  }

  private handleSelect(ast: Select): SqlResult {
    const from = ast.from ?? [];
    if (!from.length) throw new Error('SELECT requires FROM clause');
    const info = this.normalizeFrom(from);
    const snapshot = this.root.state();
    let contexts = this.contextsFromRows(this.rowsFromSnapshot(snapshot, info.base.table), info.base);
    for (const join of info.joins) {
      contexts = this.joinContexts(contexts, join, this.rowsFromSnapshot(snapshot, join.table));
    }
    contexts = this.filterContexts(contexts, ast.where);
    contexts = this.sortContexts(contexts, ast.orderby ?? undefined);
    contexts = this.limitContexts(contexts, ast.limit ?? undefined);
    const projection = this.projectSelect(ast.columns ?? [], contexts, info);
    return this.createResult('select', projection.rows, [], { mutable: projection.mutable });
  }

  private handleInsert(ast: Insert_Replace): SqlResult {
    const table = this.assertSingleTable(ast.table);
    const columns = ast.columns ?? [];
    const idIdx = columns.findIndex(c => c.toLowerCase() === 'id');
    const valueIdx = columns.findIndex(c => c.toLowerCase() === 'value');
    if (idIdx === -1) throw new Error('INSERT must specify id column');
    const values = ast.values?.values ?? [];
    const events: Event[] = [];
    const rows: SqlRow[] = [];
    for (const tuple of values) {
      const exprs = tuple.value ?? [];
      const id = this.evaluate(exprs[idIdx]);
      if (typeof id !== 'string') throw new Error('id must be a string literal');
      const value = valueIdx >= 0 ? this.evaluate(exprs[valueIdx]) : undefined;
      const composedId = this.composeId(table.table, id);
      events.push({ type: 'Create', id: composedId, value });
      rows.push(this.formatRow({ table: table.table, id, value }));
    }
    return this.createResult('insert', rows, events);
  }

  private handleUpdate(ast: UpdateAst): SqlResult {
    const table = this.assertSingleTable(ast.table);
    const set = ast.set ?? [];
    const valueExpr = set.find(s => s.column.toLowerCase() === 'value');
    if (!valueExpr) throw new Error('UPDATE must set value column');
    const value = this.evaluate(valueExpr.value);
    const snapshot = this.root.state();
    const baseRows = this.rowsFromSnapshot(snapshot, table.table);
    let contexts = this.contextsFromRows(baseRows, table);
    contexts = this.filterContexts(contexts, ast.where);
    const targets = contexts.map(ctx => ctx.defaultEntity);
    const existingIds = new Set(targets.map(row => row.id));
    for (const id of this.extractIds(ast.where, table.alias)) {
      if (!existingIds.has(id)) {
        targets.push({ table: table.table, id, value: undefined });
        existingIds.add(id);
      }
    }
    const rows = targets.map(row => this.formatRow(row));
    return this.makeUpdateFromRows(rows, value);
  }

  private handleDelete(ast: DeleteAst): SqlResult {
    const ref = this.assertSingleTable(ast.from ?? ast.table);
    const snapshot = this.root.state();
    const baseRows = this.rowsFromSnapshot(snapshot, ref.table);
    let contexts = this.contextsFromRows(baseRows, ref);
    contexts = this.filterContexts(contexts, ast.where);
    const targets = contexts.map(ctx => ctx.defaultEntity);
    const existingIds = new Set(targets.map(row => row.id));
    for (const id of this.extractIds(ast.where, ref.alias)) {
      if (!existingIds.has(id)) {
        targets.push({ table: ref.table, id, value: undefined });
        existingIds.add(id);
      }
    }
    const rows = targets.map(row => this.formatRow({ table: row.table, id: row.id, value: undefined }));
    return this.makeDeleteFromRows(rows);
  }

  private handleTransaction(ast: any): SqlResult {
    const action = String(ast.expr?.action?.value ?? '').toLowerCase();
    switch (action) {
      case 'begin':
        if (this.tx) throw new Error('Transaction already active');
        this.tx = { patch: null, events: [], metas: [] };
        return this.createResult('transaction', [], [], { mutable: false, autoCommitted: true });
      case 'commit':
        if (!this.tx) throw new Error('No active transaction');
        if (!this.tx.patch) {
          this.tx = null;
          return this.createResult('transaction', [], [], { mutable: false, autoCommitted: true });
        }
        const patch = this.tx.patch;
        const events = [...this.tx.events];
        const metas = [...this.tx.metas];
        this.tx = null;
        this.root.commit(patch);
        for (const entry of metas) {
          this.storeMeta(entry.key, entry.meta);
        }
        return this.createResult('transaction', [], events, { patch, mutable: false, autoCommitted: true });
      case 'rollback':
        if (!this.tx) throw new Error('No active transaction');
        this.tx = null;
        return this.createResult('transaction', [], [], { mutable: false, autoCommitted: true });
      default:
        throw new Error(`Unsupported transaction action: ${action}`);
    }
  }

  private createResult(
    type: StatementType,
    rows: SqlRow[],
    events: Event[],
    opts: CreateResultOptions = {},
  ): SqlResult {
    const op = new SqlOperation(this, type, rows, events, opts);
    let proxy: SqlResult;
    const handler: ProxyHandler<SqlOperation> = {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator) {
          return target.rows[Symbol.iterator].bind(target.rows);
        }
        if (prop === 'rows') return target.rows;
        if (prop === 'length') return target.rows.length;
        if (prop === 'type') return target.type;
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          return target.rows[Number(prop)];
        }
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            const res = value.apply(target, args);
            return res === target ? proxy : res;
          };
        }
        if (value !== undefined) return value;
        const rowsValue = (target.rows as any)[prop];
        if (typeof rowsValue === 'function') {
          return rowsValue.bind(target.rows);
        }
        return rowsValue;
      },
      has(target, prop) {
        if (prop === 'rows' || prop === 'length' || prop === 'type') return true;
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = Number(prop);
          return idx >= 0 && idx < target.rows.length;
        }
        return prop in target || prop in target.rows;
      },
      ownKeys(target) {
        const keys = new Set<PropertyKey>();
        keys.add('rows');
        keys.add('length');
        keys.add('type');
        for (let i = 0; i < target.rows.length; i += 1) keys.add(String(i));
        for (const key of Reflect.ownKeys(target)) keys.add(key);
        return Array.from(keys);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'rows') {
          return { configurable: true, enumerable: true, value: target.rows, writable: false };
        }
        if (prop === 'length') {
          return { configurable: true, enumerable: true, value: target.rows.length, writable: false };
        }
        if (prop === 'type') {
          return { configurable: true, enumerable: true, value: target.type, writable: false };
        }
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = Number(prop);
          const value = target.rows[idx];
          if (value === undefined) return undefined;
          return { configurable: true, enumerable: true, value, writable: false };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    };
    proxy = new Proxy(op, handler) as unknown as SqlResult;
    return proxy;
  }

  private normalizeFrom(entries: any[]): {
    base: { table: string; alias: string };
    joins: Array<{ table: string; alias: string; on: any }>;
  } {
    const baseEntry = this.normalizeTableRef(entries[0]);
    const joins: Array<{ table: string; alias: string; on: any }> = [];
    for (let i = 1; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry.join || entry.join.toUpperCase() !== 'INNER JOIN') {
        throw new Error('Only INNER JOIN is supported');
      }
      if (!entry.on) throw new Error('JOIN requires ON clause');
      const norm = this.normalizeTableRef(entry);
      joins.push({ table: norm.table, alias: norm.alias, on: entry.on });
    }
    return { base: baseEntry, joins };
  }

  private assertSingleTable(entries: any[]): { table: string; alias: string } {
    if (!entries || entries.length !== 1) throw new Error('Only single table statements are supported');
    return this.normalizeTableRef(entries[0]);
  }

  private normalizeTableRef(entry: { table: string; as?: string | null }): { table: string; alias: string } {
    if (!entry || !entry.table) throw new Error('Invalid table reference');
    const table = String(entry.table).toLowerCase();
    const alias = entry.as ? String(entry.as).toLowerCase() : table;
    return { table, alias };
  }

  private rowsFromSnapshot(snapshot: Record<string, unknown>, table?: string): EntityRow[] {
    const rows: EntityRow[] = [];
    for (const [rawId, value] of Object.entries(snapshot)) {
      const parsed = this.parseCompositeId(rawId);
      if (!table || parsed.table === table) {
        rows.push({ table: parsed.table, id: parsed.id, value });
      }
    }
    return rows;
  }

  private contextsFromRows(rows: EntityRow[], ref: { table: string; alias: string }): RowContext[] {
    return rows.map(row => ({
      entities: this.aliasMapForRow(row, ref),
      defaultEntity: row,
    }));
  }

  private aliasMapForRow(row: EntityRow, ref: { table: string; alias: string }): Record<string, EntityRow> {
    const map: Record<string, EntityRow> = {};
    map[ref.alias] = row;
    map[row.table] = row;
    return map;
  }

  private joinContexts(contexts: RowContext[], join: { table: string; alias: string; on: any }, joinRows: EntityRow[]): RowContext[] {
    const results: RowContext[] = [];
    for (const ctx of contexts) {
      for (const row of joinRows) {
        const entities = { ...ctx.entities, ...this.aliasMapForRow(row, join) };
        const combined: RowContext = { entities, defaultEntity: ctx.defaultEntity };
        if (this.evaluateCondition(join.on, combined)) {
          results.push(combined);
        }
      }
    }
    return results;
  }

  private filterContexts(contexts: RowContext[], where: any): RowContext[] {
    if (!where) return [...contexts];
    return contexts.filter(ctx => this.evaluateCondition(where, ctx));
  }

  private sortContexts(contexts: RowContext[], orderBy?: OrderBy[] | null): RowContext[] {
    if (!orderBy || !orderBy.length) return [...contexts];
    const clauses = orderBy.map(ob => ({ expr: ob.expr, dir: String(ob.type ?? 'ASC').toUpperCase() }));
    const decorated = contexts.map((ctx, idx) => ({
      ctx,
      idx,
      keys: clauses.map(clause => this.evaluate(clause.expr, ctx)),
    }));
    decorated.sort((a, b) => {
      for (let i = 0; i < clauses.length; i += 1) {
        const cmp = this.compareValues(a.keys[i], b.keys[i]);
        if (cmp !== 0) {
          return clauses[i].dir === 'DESC' ? -cmp : cmp;
        }
      }
      return a.idx - b.idx;
    });
    return decorated.map(item => item.ctx);
  }

  private limitContexts(contexts: RowContext[], limit?: Limit | null): RowContext[] {
    if (!limit) return [...contexts];
    const values = limit.value ?? [];
    let take: number | undefined;
    let skip = 0;
    if (limit.seperator && limit.seperator.toLowerCase() === 'offset') {
      take = this.toNumber(values[0]);
      skip = this.toNumber(values[1]) ?? 0;
    } else if (values.length === 2) {
      take = this.toNumber(values[0]);
      skip = this.toNumber(values[1]) ?? 0;
    } else if (values.length === 1) {
      take = this.toNumber(values[0]);
    }
    const start = Math.max(0, Math.floor(skip));
    if (take === undefined || !Number.isFinite(take)) {
      return contexts.slice(start);
    }
    const count = Math.max(0, Math.floor(take));
    return contexts.slice(start, start + count);
  }

  private projectSelect(
    columns: Array<{ expr: any; as?: string | null }> | null,
    contexts: RowContext[],
    info: { base: { table: string; alias: string }; joins: Array<{ table: string; alias: string; on: any }> },
  ): { rows: SqlRow[]; mutable: boolean } {
    const cols = columns ?? [];
    const isStar =
      cols.length === 1 &&
      cols[0].expr &&
      cols[0].expr.type === 'column_ref' &&
      String(cols[0].expr.column ?? '').trim() === '*';
    if (isStar && info.joins.length === 0) {
      return {
        rows: contexts.map(ctx => this.formatRow(ctx.defaultEntity)),
        mutable: true,
      };
    }
    const rows: SqlRow[] = contexts.map((ctx, idx) => {
      const projected: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        const key = col.as ?? this.columnLabel(col.expr) ?? `col_${i + 1}`;
        projected[key] = this.evaluate(col.expr, ctx);
      });
      return { id: String(idx), value: projected };
    });
    return { rows, mutable: false };
  }

  private formatRow(row: EntityRow): SqlRow {
    if (row.table === this.defaultTable) {
      return { id: row.id, value: row.value };
    }
    return { id: row.id, table: row.table, value: row.value };
  }

  private evaluate(expr: any, ctx?: RowContext): unknown {
    if (!expr) return undefined;
    switch (expr.type) {
      case 'column_ref':
        return this.valueFromColumn(expr, ctx);
      case 'binary_expr': {
        const op = String(expr.operator ?? '').toUpperCase();
        if (op === '->' || op === '->>') {
          const base = this.evaluate(expr.left, ctx);
          const key = this.evaluate(expr.right, ctx);
          if (typeof key !== 'string') throw new Error('JSON path key must be a string literal');
          const projected = this.projectJson(base, key);
          return op === '->>' ? this.asText(projected) : projected;
        }
        throw new Error(`Unsupported binary operator in expression: ${expr.operator}`);
      }
      case 'function':
        return this.evaluateFunction(expr, ctx);
      case 'single_quote_string':
      case 'double_quote_string':
      case 'string':
      case 'var_string': {
        const value = String(expr.value);
        const trimmed = value.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            return JSON.parse(trimmed);
          } catch {
            return value;
          }
        }
        return value;
      }
      case 'number':
        return Number(expr.value);
      case 'bool':
      case 'boolean':
        return Boolean(expr.value);
      case 'null':
        return null;
      case 'expr_list':
        return expr.value.map((item: unknown) => this.evaluate(item, ctx));
      default:
        return expr.value ?? undefined;
    }
  }

  private evaluateFunction(expr: any, ctx?: RowContext): unknown {
    const name = String(expr.name?.name?.[0]?.value ?? '').toLowerCase();
    const args: any[] = Array.isArray(expr.args?.value) ? expr.args.value : [];
    switch (name) {
      case 'lower': {
        const input = args.length ? this.evaluate(args[0], ctx) : undefined;
        const text = this.asText(input);
        return text === null ? null : text.toLowerCase();
      }
      case 'json_extract': {
        if (!ctx) throw new Error('json_extract requires row context');
        const baseArg = args[0];
        const pathArg = args[1];
        let baseValue: unknown;
        if (baseArg?.type === 'double_quote_string') {
          const col = String(baseArg.value);
          if (col === 'value') {
            baseValue = ctx.defaultEntity.value;
          } else if (col === 'id') {
            baseValue = ctx.defaultEntity.id;
          } else {
            baseValue = (ctx.defaultEntity.value as Record<string, unknown> | undefined)?.[col];
          }
        } else {
          baseValue = this.evaluate(baseArg, ctx);
        }
        const pathRaw = this.evaluate(pathArg, ctx);
        if (typeof pathRaw !== 'string') return undefined;
        return this.extractJsonFromPath(baseValue, pathRaw);
      }
      default:
        return undefined;
    }
  }

  private extractJsonFromPath(base: unknown, rawPath: string): unknown {
    if (!rawPath.startsWith('$')) return undefined;
    const segments = rawPath
      .replace(/^\$\.?/, '')
      .split('.')
      .filter(Boolean);
    let value = base;
    for (const segment of segments) {
      if (Array.isArray(value)) {
        const idx = Number(segment);
        value = Number.isInteger(idx) ? value[idx] : undefined;
      } else if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[segment];
      } else {
        return undefined;
      }
    }
    return value;
  }

  private valueFromColumn(expr: any, ctx?: RowContext): unknown {
    if (!ctx) throw new Error('Column reference requires row context');
    const aliasToken = expr.table ? String(expr.table).toLowerCase() : undefined;
    const columnToken = typeof expr.column === 'string' ? expr.column : String(expr.column?.expr?.value ?? '');
    const entity = this.resolveEntity(aliasToken, ctx);
    if (!entity) return undefined;
    const column = columnToken.toLowerCase();
    if (column === 'id') return entity.id;
    if (column === 'value') return entity.value;
    if (entity.value && typeof entity.value === 'object' && entity.value !== null) {
      return (entity.value as Record<string, unknown>)[columnToken];
    }
    return undefined;
  }

  private resolveEntity(alias: string | undefined, ctx: RowContext): EntityRow | undefined {
    if (alias) {
      return ctx.entities[alias];
    }
    return ctx.defaultEntity;
  }

  private evaluateCondition(expr: any, ctx: RowContext): boolean {
    if (!expr) return true;
    if (expr.type !== 'binary_expr') {
      const value = this.evaluate(expr, ctx);
      return !!value;
    }
    const op = String(expr.operator ?? '').toUpperCase();
    if (op === 'AND') {
      return this.evaluateCondition(expr.left, ctx) && this.evaluateCondition(expr.right, ctx);
    }
    if (op === 'OR') {
      return this.evaluateCondition(expr.left, ctx) || this.evaluateCondition(expr.right, ctx);
    }
    if (op === '=') {
      return this.equals(this.evaluate(expr.left, ctx), this.evaluate(expr.right, ctx));
    }
    if (op === 'IN') {
      const left = this.evaluate(expr.left, ctx);
      const right = this.evaluate(expr.right, ctx);
      if (!Array.isArray(right)) return false;
      return right.some(val => this.equals(left, val));
    }
    if (op === 'LIKE') {
      const left = this.asText(this.evaluate(expr.left, ctx));
      const right = this.asText(this.evaluate(expr.right, ctx));
      if (left === null || right === null) return false;
      const regex = new RegExp(
        `^${right.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`,
        'i',
      );
      return regex.test(left);
    }
    throw new Error(`Unsupported WHERE clause operator: ${expr.operator}`);
  }

  private extractIds(where: any, alias: string): string[] {
    if (!where || where.type !== 'binary_expr') return [];
    const op = String(where.operator ?? '').toUpperCase();
    const aliasLower = alias.toLowerCase();
    if (op === '=') {
      if (this.isIdColumn(where.left, aliasLower)) {
        const value = this.evaluate(where.right);
        return typeof value === 'string' ? [value] : [];
      }
      if (this.isIdColumn(where.right, aliasLower)) {
        const value = this.evaluate(where.left);
        return typeof value === 'string' ? [value] : [];
      }
      return [];
    }
    if (op === 'IN') {
      if (!this.isIdColumn(where.left, aliasLower)) return [];
      const value = this.evaluate(where.right);
      return Array.isArray(value)
        ? value.filter((val): val is string => typeof val === 'string')
        : [];
    }
    return [];
  }

  private isIdColumn(expr: any, alias: string): boolean {
    if (!expr) return false;
    if (expr.type !== 'column_ref') return false;
    if (expr.table) {
      if (String(expr.table).toLowerCase() !== alias) return false;
    }
    const column = typeof expr.column === 'string' ? expr.column : String(expr.column?.expr?.value ?? '');
    return column.toLowerCase() === 'id';
  }

  private columnLabel(expr: any): string | undefined {
    if (!expr) return undefined;
    if (expr.type === 'column_ref') {
      const column = typeof expr.column === 'string' ? expr.column : String(expr.column?.expr?.value ?? '');
      const prefix = expr.table ? `${expr.table}.` : '';
      return `${prefix}${column}`;
    }
    return undefined;
  }

  private projectJson(base: unknown, key: string): unknown {
    if (base === null || base === undefined) return undefined;
    if (Array.isArray(base)) {
      const idx = Number(key);
      if (Number.isInteger(idx)) return base[idx];
      return undefined;
    }
    if (typeof base === 'object') {
      return (base as Record<string, unknown>)[key];
    }
    return undefined;
  }

  private asText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private equals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    if (typeof a === 'number' && typeof b === 'number') {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      return a === b;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    return String(a) === String(b);
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0;
    const aNum = this.toComparableNumber(a);
    const bNum = this.toComparableNumber(b);
    if (aNum !== null && bNum !== null) {
      if (aNum < bNum) return -1;
      if (aNum > bNum) return 1;
      return 0;
    }
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    const aStr = typeof a === 'string' ? a : this.asText(a) ?? '';
    const bStr = typeof b === 'string' ? b : this.asText(b) ?? '';
    return aStr.localeCompare(bStr);
  }

  private toComparableNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const num = Number(value);
      if (!Number.isNaN(num)) return num;
    }
    return null;
  }

  private toNumber(expr: any): number | undefined {
    if (!expr) return undefined;
    const value = this.evaluate(expr);
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  private uniqueEntityRows(rows: SqlRow[]): EntityRow[] {
    const seen = new Set<string>();
    const result: EntityRow[] = [];
    for (const row of rows) {
      const table = (row.table ?? this.defaultTable).toLowerCase();
      const key = `${table}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ table, id: row.id, value: row.value });
    }
    return result;
  }

  private composeId(table: string | undefined, id: string): string {
    const tableName = (table ?? this.defaultTable).toLowerCase();
    return tableName === this.defaultTable ? id : `${tableName}:${id}`;
  }

  private parseCompositeId(raw: string): { table: string; id: string } {
    const idx = raw.indexOf(':');
    if (idx === -1) return { table: this.defaultTable, id: raw };
    return { table: raw.slice(0, idx), id: raw.slice(idx + 1) };
  }

  private metaKey(table: string, id: string): string {
    const tableName = table.toLowerCase();
    return tableName === this.defaultTable ? id : `${tableName}:${id}`;
  }

  private metaKeyForEvent(eventId: string): string {
    return eventId.includes(':') ? eventId : this.metaKey(this.defaultTable, eventId);
  }

  private applyMeta(events: Event[], meta: SqlMeta): void {
    for (const ev of events) {
      this.storeMeta(this.metaKeyForEvent(ev.id), meta);
    }
  }

 private queueMeta(events: Event[], meta: SqlMeta, tx: { metas: Array<{ key: string; meta: SqlMeta }> }): void {
    for (const ev of events) {
      tx.metas.push({ key: this.metaKeyForEvent(ev.id), meta: { ...meta } });
    }
  }

  private storeMeta(key: string, meta: SqlMeta): void {
    const arr = this.metadata.get(key) ?? [];
    arr.push({ ...meta });
    this.metadata.set(key, arr);
  }
}

type WhereClause = {
  path: string[];
  operator: 'eq' | 'ilike';
  value: unknown;
};

type OrderClause = { key: string; dir?: 'asc' | 'desc' };

type BuilderOptions = {
  table: string;
  dialect: Dialect;
};

export class QueryBuilder {
  private readonly adapter: SqlOrmAdapter;
  private readonly table: string;
  private readonly dialect: Dialect;
  private whereClauses: WhereClause[] = [];
  private orderClauses: OrderClause[] = [];
  private limitValue?: number;
  private offsetValue?: number;

  constructor(adapter: SqlOrmAdapter, opts: BuilderOptions) {
    this.adapter = adapter;
    this.table = opts.table;
    this.dialect = opts.dialect;
  }

  where(criteria: Record<string, unknown>): QueryBuilder {
    const clauses: WhereClause[] = [];
    for (const [key, raw] of Object.entries(criteria)) {
      const path = key.split('.');
      if (path[0] !== 'value' && path[0] !== 'id') {
        throw new Error(`Unsupported where key: ${key}`);
      }
      if (
        raw &&
        typeof raw === 'object' &&
        !Array.isArray(raw) &&
        ('ilike' in (raw as Record<string, unknown>))
      ) {
        clauses.push({ path, operator: 'ilike', value: (raw as Record<string, unknown>).ilike });
        continue;
      }
      clauses.push({ path, operator: 'eq', value: raw });
    }
    this.whereClauses = [...this.whereClauses, ...clauses];
    return this;
  }

  orderBy(order: OrderClause[]): QueryBuilder {
    this.orderClauses = order;
    return this;
  }

  limit(n: number): QueryBuilder {
    this.limitValue = n;
    return this;
  }

  offset(n: number): QueryBuilder {
    this.offsetValue = n;
    return this;
  }

  clone(): QueryBuilder {
    const next = new QueryBuilder(this.adapter, { table: this.table, dialect: this.dialect });
    next.whereClauses = [...this.whereClauses];
    next.orderClauses = [...this.orderClauses];
    next.limitValue = this.limitValue;
    next.offsetValue = this.offsetValue;
    return next;
  }

  async findMany(): Promise<SqlResult> {
    const sql = this.toSelectSql();
    return this.adapter.execute(sql);
  }

  async findOne(): Promise<SqlResult> {
    const builder = this.clone();
    if (builder.limitValue === undefined) builder.limitValue = 1;
    const result = await builder.findMany();
    return result;
  }

  toSelectSql(): string {
    const select = `SELECT * FROM ${this.table}`;
    const where = this.buildWhere();
    const order = this.buildOrder();
    const limit = this.buildLimit();
    return [select, where, order, limit].filter(Boolean).join(' ');
  }

  private buildWhere(): string {
    if (!this.whereClauses.length) return '';
    const parts = this.whereClauses.map(clause => this.renderWhereClause(clause));
    return `WHERE ${parts.join(' AND ')}`;
  }

  private renderWhereClause(clause: WhereClause): string {
    const rendered = this.renderPath(clause.path);
    const sqlValue = this.renderValue(clause.value);
    switch (clause.operator) {
      case 'ilike':
        return this.dialect === 'postgres'
          ? `${rendered} ILIKE ${sqlValue}`
          : `LOWER(${rendered}) LIKE LOWER(${sqlValue})`;
      case 'eq':
      default:
        return `${rendered} = ${sqlValue}`;
    }
  }

  private renderPath(path: string[]): string {
    if (path[0] === 'id') {
      return 'id';
    }
    const segments = path.slice(1);
    if (!segments.length) return 'value';
    if (this.dialect === 'postgres') {
      let expr = 'value';
      for (let i = 0; i < segments.length - 1; i += 1) {
        expr = `${expr}->'${segments[i]}'`;
      }
      return `${expr}->>'${segments[segments.length - 1]}'`;
    }
    const joined = segments.map(seg => `.${seg}`).join('');
    return `json_extract("value", '$${joined}')`;
  }

  private renderValue(value: unknown): string {
    if (value === null) return 'NULL';
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    const escaped = json.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  private buildOrder(): string {
    if (!this.orderClauses.length) return '';
    const parts = this.orderClauses.map(o => {
      const dir = (o.dir ?? 'asc').toUpperCase();
      const path = this.renderPath(o.key.split('.'));
      return `${path} ${dir}`;
    });
    return `ORDER BY ${parts.join(', ')}`;
  }

  private buildLimit(): string {
    if (this.limitValue === undefined && this.offsetValue === undefined) return '';
    if (this.dialect === 'sqlite') {
      const limit = this.limitValue ?? -1;
      const offset = this.offsetValue ?? 0;
      return `LIMIT ${limit} OFFSET ${offset}`;
    }
    const parts: string[] = [];
    if (this.limitValue !== undefined) parts.push(`LIMIT ${this.limitValue}`);
    if (this.offsetValue !== undefined) parts.push(`OFFSET ${this.offsetValue}`);
    return parts.join(' ');
  }
}
