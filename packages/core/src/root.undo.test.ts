import { describe, it, expect } from 'vitest';
import { Root, Patch } from './index';

describe('Root.undo/redo', () => {
  it('undo returns to base, redo re-applies', () => {
    const r = new Root();
    const p = new Patch([
      { type: 'Create', id: 'u1', value: 1 },
      { type: 'Update', id: 'u1', value: 2 },
    ]);

    r.commit(p);
    expect(r.state()).toEqual({ u1: 2 });

    r.undo(p);
    expect(r.state()).toEqual({});

    r.redo(p);
    expect(r.state()).toEqual({ u1: 2 });
  });
});

