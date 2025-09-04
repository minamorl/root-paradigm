import { describe, it, expect } from 'vitest';
import { Root, Patch, rewrite } from './index';

const law = { enforce: (p: Patch) => p };

describe('Root.undo/redo', () => {
  it('undo returns to base, redo re-applies', () => {
    const r = new Root(rewrite, law);
    const p = Patch.from([
      { type: 'Create', id: 'u1', value: 1 },
      { type: 'Update', id: 'u1', value: 2 },
    ], rewrite);

    r.commit(p);
    expect(r.state()).toEqual({ u1: 2 });

    r.undo(p);
    expect(r.state()).toEqual({});

    r.redo(p);
    expect(r.state()).toEqual({ u1: 2 });
  });
});
