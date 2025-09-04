import type { Event } from './types';

/**
 * Replay a sequence of events and return the resulting state.
 */
export function state(events: readonly Event[]): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const ev of events) {
    switch (ev.type) {
      case 'Create':
        s[ev.id] = ev.value;
        break;
      case 'Update':
        if (ev.id in s) s[ev.id] = ev.value;
        break;
      case 'Delete':
        delete s[ev.id];
        break;
      default: {
        const _exhaustive: never = ev;
        void _exhaustive;
      }
    }
  }
  return s;
}
