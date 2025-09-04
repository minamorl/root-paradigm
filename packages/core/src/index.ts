export type { Id, Create, Update, Delete, Event } from './types';
export { rewrite } from './rewrite';
export { state } from './state';
export { invert } from './invert';
export { Patch } from './patch';

import type { Event } from './types';
import { Patch } from './patch';
import { state as computeState } from './state';

const isPatch = (
  input: Patch | Event | readonly Event[],
): input is Patch =>
  typeof (input as { toNormalForm?: unknown }).toNormalForm === 'function';

// Base state snapshot per committed Patch for undo.
const patchBases = new WeakMap<Patch, Record<string, unknown>>();

export type Subscriber = (ev: Event | { type: 'Snapshot' }) => void;

/**
 * Facade over event normalization and law enforcement with push notifications.
 * Stores history only in normal form.
 */
export class Root {
  private nf: Event[] = [];
  private readonly subs: Set<Subscriber> = new Set();

  constructor(
    private readonly rewrite: (es: readonly Event[]) => Event[],
    private readonly law: { enforce(p: Patch): Patch },
  ) {}

  /** Commit new events or patches, storing the resulting normalized history, and notify subscribers. */
  commit(input: Patch | Event | readonly Event[]): void {
    const p = Array.isArray(input)
      ? Patch.from(input, this.rewrite)
      : isPatch(input)
        ? input
        : Patch.from([input], this.rewrite);
    // snapshot base for undo if a Patch instance was provided
    if (isPatch(input)) {
      patchBases.set(input, this.state());
    }
    const enforced = this.law.enforce(p);
    // Merge raw events first, then normalize entire history.
    this.nf = this.rewrite([...this.nf, ...enforced.toEvents()]);
    // push notify committed events
    for (const fn of this.subs) {
      for (const ev of enforced.toEvents()) fn(ev);
    }
  }

  /** Subscribe to push notifications. Returns an unsubscribe function. Immediately emits a Snapshot. */
  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    fn({ type: 'Snapshot' });
    return () => {
      this.subs.delete(fn);
    };
  }

  /** Current replayed state of the normalized history. */
  state(): Record<string, unknown> {
    return computeState(this.nf);
  }

  /** Normalized event history. */
  history(): readonly Event[] {
    return this.nf;
  }

  /** Undo a previously committed patch by applying its inverse. */
  undo(p: Patch): void {
    const base = patchBases.get(p) ?? this.state();
    const inv = p.invert(base);
    this.commit(inv);
  }

  /** Redo a previously undone patch by committing it again. */
  redo(p: Patch): void {
    this.commit(p);
  }

  /**
   * Compact history to a snapshot of Creates reflecting current state,
   * and notify subscribers with a Snapshot event.
   */
  compact(): void {
    const snapshot = this.state();
    const newLog: Event[] = [];
    for (const [id, value] of Object.entries(snapshot)) {
      newLog.push({ type: 'Create', id, value } as Event);
    }
    this.nf = newLog;
    for (const fn of this.subs) fn({ type: 'Snapshot' });
  }
}
