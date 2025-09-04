import type { Event } from './types';

/**
 * Compute the inverse events for a given event sequence relative to a base state.
 * Rules:
 * - Create(id, v) → Delete(id) if id absent in base, else Update(id, oldValue)
 * - Update(id, v) → Update(id, oldValue) if id existed, else no-op
 * - Delete(id)    → Create(id, oldValue) if id existed, else no-op
 *
 * The returned inverse events are ordered to undo the original sequence in reverse.
 *
 * @param events - Events to invert
 * @param base - Base state the original events were applied to
 * @returns Inverse events that restore the base when applied after `events`
 */
export function invert(
  events: Event[],
  base: Record<string, unknown>
): Event[] {
  // Shadow state to simulate application and capture pre-values per event
  const shadow: Record<string, unknown> = { ...base };
  const preValues: (unknown | undefined)[] = [];
  const existedBefore: boolean[] = [];

  for (const ev of events) {
    const existed = Object.prototype.hasOwnProperty.call(shadow, ev.id);
    const oldValue = existed ? shadow[ev.id] : undefined;
    existedBefore.push(existed);
    preValues.push(oldValue);

    switch (ev.type) {
      case 'Create':
        shadow[ev.id] = ev.value;
        break;
      case 'Update':
        if (existed) shadow[ev.id] = ev.value;
        break;
      case 'Delete':
        delete shadow[ev.id];
        break;
    }
  }

  // Build inverse by walking events in reverse using captured per-event info
  const inv: Event[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const oldValue = preValues[i];
    const existed = existedBefore[i];

    if (ev.type === 'Create') {
      if (!existed) {
        inv.push({ type: 'Delete', id: ev.id });
      } else {
        inv.push({ type: 'Update', id: ev.id, value: oldValue });
      }
    } else if (ev.type === 'Update') {
      if (existed) {
        inv.push({ type: 'Update', id: ev.id, value: oldValue });
      }
    } else if (ev.type === 'Delete') {
      if (existed) {
        inv.push({ type: 'Create', id: ev.id, value: oldValue });
      }
    }
  }

  return inv;
}
