import { describe, it, expect } from 'vitest';
import { Root, Event } from './index';

type History = Event[];
const ids = ['u1', 'u2'];
const rand = (n: number) => Math.floor(Math.random() * n);

function randomEvent(): Event {
  const id = ids[rand(ids.length)];
  const value = rand(5);
  switch (rand(3)) {
    case 0:
      return { type: 'Create', id, value };
    case 1:
      return { type: 'Update', id, value };
    default:
      return { type: 'Delete', id };
  }
}

function randomHistory(): History {
  const len = rand(7); // 0..6
  const h: History = [];
  for (let i = 0; i < len; i++) h.push(randomEvent());
  return h;
}

function replay(events: History): Record<string, unknown> {
  const root = new Root();
  for (const ev of events) root.commit(ev);
  return root.state();
}

describe('compact property', () => {
  it('preserves state after compaction', () => {
    for (let i = 0; i < 50; i++) {
      const root = new Root();
      const events = randomHistory();
      for (const ev of events) root.commit(ev);
      const stateA = root.state();
      root.compact();
      const root2 = new Root();
      for (const ev of root.history()) root2.commit(ev);
      const stateB = root2.state();
      expect(stateB).toEqual(stateA);
    }
  });

  const edgeCases: History[] = [
    [
      { type: 'Delete', id: 'u1' },
      { type: 'Create', id: 'u1', value: 1 },
    ],
    [
      { type: 'Create', id: 'u1', value: 0 },
      { type: 'Update', id: 'u1', value: 1 },
      { type: 'Update', id: 'u1', value: 2 },
    ],
    [{ type: 'Update', id: 'u1', value: 1 }],
  ];

  for (const events of edgeCases) {
    it(`edge case: ${events.map((e) => e.type).join('→')}`, () => {
      const stateA = replay(events);
      const root = new Root();
      for (const ev of events) root.commit(ev);
      root.compact();
      const root2 = new Root();
      for (const ev of root.history()) root2.commit(ev);
      const stateB = root2.state();
      expect(stateB).toEqual(stateA);
    });
  }
});
