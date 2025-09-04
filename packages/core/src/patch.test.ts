import { describe, it, expect } from 'vitest';
import { rewrite } from './rewrite';
import { state } from './state';
import { Patch } from './patch';
import type { Event } from './types';

describe('patch', () => {
  it('state(history) equals state(rewrite(history))', () => {
    const history: Event[] = [
      { type: 'Create', id: 'u1', value: 0 },
      { type: 'Update', id: 'u1', value: 1 },
      { type: 'Delete', id: 'u1' },
      { type: 'Create', id: 'u2', value: 3 },
      { type: 'Update', id: 'u2', value: 4 },
    ];
    expect(state(rewrite(history))).toEqual(state(history));
  });

  it('compose merges and normalizes', () => {
    const a: Event[] = [{ type: 'Create', id: 'u1', value: 0 }];
    const b: Event[] = [
      { type: 'Update', id: 'u1', value: 1 },
      { type: 'Create', id: 'u2', value: 2 },
    ];
    const p1 = Patch.from(a, rewrite);
    const p2 = Patch.from(b, rewrite);
    const composed = p1.compose(p2);
    expect(composed.toNormalForm()).toEqual(rewrite([...a, ...b]));
  });
});
