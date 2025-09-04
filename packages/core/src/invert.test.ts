import { describe, it, expect } from 'vitest';
import { invert, Root, Patch } from './index';
import type { Event } from './types';

function apply(base: Record<string, unknown>, h: Event[]): Record<string, unknown> {
  const r = new Root();
  for (const [id, value] of Object.entries(base)) {
    r.commit({ type: 'Create', id, value });
  }
  r.commit(new Patch(h));
  const inv = invert(h, base);
  r.commit(new Patch(inv));
  return r.state();
}

describe('invert(events, base)', () => {
  it('Create u1=1 → inverse Delete u1', () => {
    const base = {} as Record<string, unknown>;
    const h: Event[] = [{ type: 'Create', id: 'u1', value: 1 }];
    const state = apply(base, h);
    expect(state).toEqual(base);
  });

  it('Create u1=1; Update u1=2 → inverse returns to {}', () => {
    const base = {} as Record<string, unknown>;
    const h: Event[] = [
      { type: 'Create', id: 'u1', value: 1 },
      { type: 'Update', id: 'u1', value: 2 },
    ];
    const state = apply(base, h);
    expect(state).toEqual(base);
  });

  it('Delete u1 when base had u1=7 → inverse Create u1=7', () => {
    const base = { u1: 7 } as Record<string, unknown>;
    const h: Event[] = [{ type: 'Delete', id: 'u1' }];
    const state = apply(base, h);
    expect(state).toEqual(base);
  });
});

