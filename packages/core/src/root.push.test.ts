import { describe, it, expect } from 'vitest';
import { Root } from './root';
import { rewrite } from './rewrite';
import { Patch } from './patch';

const law = { enforce: (p: Patch) => p };

describe('Root push notifications', () => {
  it('subscribe immediately emits one Snapshot', () => {
    const r = new Root(rewrite, law);
    const received: Array<unknown> = [];
    r.subscribe(ev => received.push(ev));
    expect(received).toEqual([{ type: 'Snapshot' }]);
  });

  it('commit(Create ...) notifies subscribers once', () => {
    const r = new Root(rewrite, law);
    const received: Array<unknown> = [];
    r.subscribe(ev => received.push(ev));
    received.length = 0; // clear initial Snapshot
    r.commit({ type: 'Create', id: 'u1', value: 1 });
    expect(received).toEqual([{ type: 'Create', id: 'u1', value: 1 }]);
  });

  it('compact() preserves state and emits Snapshot', () => {
    const r = new Root(rewrite, law);
    r.commit([
      { type: 'Create', id: 'u1', value: 1 },
      { type: 'Update', id: 'u1', value: 2 },
    ]);
    const before = r.state();
    const received: Array<unknown> = [];
    r.subscribe(ev => received.push(ev));
    received.length = 0; // clear initial Snapshot
    r.compact();
    expect(r.state()).toEqual(before);
    expect(received).toEqual([{ type: 'Snapshot' }]);
  });

  it('unsubscribe stops further notifications', () => {
    const r = new Root(rewrite, law);
    const received: Array<unknown> = [];
    const unsubscribe = r.subscribe(ev => received.push(ev));
    received.length = 0; // clear initial Snapshot
    unsubscribe();
    r.commit({ type: 'Create', id: 'x', value: 1 });
    r.compact();
    expect(received).toEqual([]);
  });
});

