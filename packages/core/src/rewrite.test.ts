import { describe, it, expect } from 'vitest';
import { rewrite } from './rewrite';
import type { Event } from './types';

describe('rewrite', () => {
  it('Create→Update→Delete→Create → [Create]', () => {
    const history: Event[] = [
      { type: 'Create', id: 'u1', value: 0 },
      { type: 'Update', id: 'u1', value: 1 },
      { type: 'Delete', id: 'u1' },
      { type: 'Create', id: 'u1', value: 2 },
    ];
    expect(rewrite(history)).toEqual([
      { type: 'Create', id: 'u1', value: 2 },
    ]);
  });

  it('Update alone → empty', () => {
    const history: Event[] = [{ type: 'Update', id: 'x', value: 1 }];
    expect(rewrite(history)).toEqual([]);
  });

  it('multiple updates collapse to last', () => {
    const history: Event[] = [
      { type: 'Create', id: 'u1', value: 0 },
      { type: 'Update', id: 'u1', value: 1 },
      { type: 'Update', id: 'u1', value: 2 },
    ];
    expect(rewrite(history)).toEqual([
      { type: 'Create', id: 'u1', value: 0 },
      { type: 'Update', id: 'u1', value: 2 },
    ]);
  });
});
