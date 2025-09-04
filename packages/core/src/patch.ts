import type { Event } from './types';
import { invert as invertEvents } from './invert';

/**
 * Patch represents a normalized sequence of events.
 */
export class Patch {
  /** Normal form (NF) list of events. */
  readonly nf: Event[];

  constructor(events: Event[]) {
    this.nf = events.slice();
  }

  /**
   * Compute the inverse Patch relative to a base state.
   *
   * @param base - Base state before this patch is applied
   * @returns Patch that undoes this patch when applied after it
   */
  invert(base: Record<string, unknown>): Patch {
    return new Patch(invertEvents(this.nf, base));
  }
}

