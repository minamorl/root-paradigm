import { describe, it, expect } from 'vitest';
import { rewrite } from './rewrite';
import { Patch } from './patch';
import { Root } from './root';
import type { Event } from './types';

const law = { enforce: (p: Patch) => p };

describe('Root', () => {
  it('commit(Create u1, Update u1, Delete u1, Create u2) → state == {u2:"Bob"}', () => {
    const root = new Root(rewrite, law);
    root.commit([
      { type: 'Create', id: 'u1', value: 'Ann' },
      { type: 'Update', id: 'u1', value: 'Eve' },
      { type: 'Delete', id: 'u1' },
      { type: 'Create', id: 'u2', value: 'Bob' },
    ]);
    expect(root.state()).toEqual({ u2: 'Bob' });
  });

  it('history is in normal form', () => {
    const root = new Root(rewrite, law);
    const events: Event[] = [
      { type: 'Create', id: 'u1', value: 0 },
      { type: 'Update', id: 'u1', value: 1 },
    ];
    root.commit(events);
    const h = root.history();
    expect(h).toEqual(rewrite(h));
  });

  it('Update alone has no effect via law enforcement', () => {
    const root = new Root(rewrite, law);
    root.commit({ type: 'Update', id: 'x', value: 1 });
    expect(root.state()).toEqual({});
    expect(root.history()).toEqual([]);
  });

  it('commit accepts Patch, single Event, and Event[]', () => {
    const root = new Root(rewrite, law);
    const patch = Patch.from([{ type: 'Create', id: 'u1', value: 0 }], rewrite);
    root.commit(patch);
    root.commit({ type: 'Create', id: 'u2', value: 'Ann' });
    const arr: Event[] = [{ type: 'Create', id: 'u3', value: 'Bob' }];
    root.commit(arr);
    expect(root.state()).toEqual({ u1: 0, u2: 'Ann', u3: 'Bob' });
  });
});

