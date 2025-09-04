import type { Event } from './types';
import { invert as invertEvents } from './invert';

/**
 * Immutable sequence of events that can be composed and normalized.
 */
export class Patch {
  private constructor(
    private readonly events: Event[],
    private readonly rw: (events: readonly Event[]) => Event[],
  ) {}

  /** Create a patch from raw events. */
  static from(events: readonly Event[], rewrite: (events: readonly Event[]) => Event[]): Patch {
    return new Patch([...events], rewrite);
  }

  /** Merge this patch with another and normalize the result. */
  compose(other: Patch): Patch {
    const combined = [...this.events, ...other.events];
    return new Patch(this.rw(combined), this.rw);
  }

  /** Return the normalized form of the underlying events. */
  toNormalForm(): Event[] {
    return this.rw([...this.events]);
  }

  /** Return the raw underlying events (non-normalized). */
  toEvents(): readonly Event[] {
    return [...this.events];
  }

  /**
   * Compute the inverse Patch relative to a base state.
   */
  invert(base: Record<string, unknown>): Patch {
    return Patch.from(invertEvents(this.toNormalForm(), base), this.rw);
  }
}
