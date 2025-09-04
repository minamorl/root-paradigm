import { describe, it, expect } from 'vitest';
import { Root, Event } from './index';

describe('Root Paradigm', () => {
  it('commit → state 解釈 → compact まで通る', () => {
    const root = new Root();
    root.commit({ type: 'Create', id: 'u1', value: 'Alice' });
    root.commit({ type: 'Update', id: 'u1', value: 'Alice Cooper' });
    root.commit({ type: 'Delete', id: 'u1' });
    root.commit({ type: 'Create', id: 'u2', value: 'Bob' });

    expect(root.history().length).toBe(4);
    expect(root.state()).toEqual({ u2: 'Bob' });

    root.compact();
    expect(root.history()).toEqual([{ type: 'Create', id: 'u2', value: 'Bob' }]);
  });

  it('Update だけでは無視される', () => {
    const root = new Root();
    root.commit({ type: 'Update', id: 'x', value: 1 });
    expect(root.state()).toEqual({});
  });

  it('Event switch is exhaustive', () => {
    const exhaustive = (ev: Event): void => {
      switch (ev.type) {
        case 'Create':
        case 'Update':
        case 'Delete':
          return;
        default: {
          const _never: never = ev;
          return _never;
        }
      }
    };
    exhaustive({ type: 'Create', id: 'z', value: null });
  });
});
