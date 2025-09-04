import { describe, it, expect } from 'vitest';
import type { Event } from './types';
import { rewrite } from './rewrite';
import { state } from './state';

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
  const len = rand(7);
  const h: History = [];
  for (let i = 0; i < len; i++) h.push(randomEvent());
  return h;
}

describe('rewrite property', () => {
  it('state(events) === state(rewrite(events))', () => {
    for (let i = 0; i < 50; i++) {
      const events = randomHistory();
      expect(state(rewrite(events))).toEqual(state(events));
    }
  });
});
