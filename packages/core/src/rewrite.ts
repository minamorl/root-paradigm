import type { Create, Update, Event, Id } from './types';

interface Hist {
  create: Create;
  update?: Update;
  lastIndex: number;
}

/**
 * Normalize a sequence of events.
 *
 * Rules:
 * - L1: `Update` without prior `Create` is discarded.
 * - L2: `Delete` removes all history for that id.
 * - L3: `Create→Update*→Delete` collapses to nothing.
 * - L4: Sequential `Update`s collapse to the last one.
 */
export function rewrite(events: readonly Event[]): Event[] {
  const map = new Map<Id, Hist>();
  events.forEach((ev, idx) => {
    switch (ev.type) {
      case 'Create':
        map.set(ev.id, { create: ev, lastIndex: idx });
        break;
      case 'Update': {
        const hist = map.get(ev.id);
        if (hist) {
          hist.update = ev;
          hist.lastIndex = idx;
        }
        break;
      }
      case 'Delete':
        map.delete(ev.id);
        break;
      default: {
        const _exhaustive: never = ev;
        void _exhaustive;
      }
    }
  });
  const items = Array.from(map.values()).sort((a, b) => a.lastIndex - b.lastIndex);
  const result: Event[] = [];
  for (const h of items) {
    result.push(h.create);
    if (h.update) result.push(h.update);
  }
  return result;
}
