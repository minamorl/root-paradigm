import { Patch } from './patch';
import { state } from './state';
import type { Event } from './types';

const isPatch = (
  input: Patch | Event | readonly Event[],
): input is Patch =>
  typeof (input as { toNormalForm?: unknown }).toNormalForm === 'function';

// Base state snapshot per committed Patch for undo.
const patchBases = new WeakMap<Patch, Record<string, unknown>>();

/**
 * Facade over event normalization and law enforcement.
 * Stores history only in normal form.
 */
export class Root {
  private nf: Event[] = [];
  private readonly subs = new Set<(ev: Event | { type: 'Snapshot' }) => void>();
  constructor(
    private readonly rewrite: (es: readonly Event[]) => Event[],
    private readonly law: { enforce(p: Patch): Patch },
  ) {}

  /** Commit new events or patches, storing the resulting normalized history. */
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
    // push notify committed events (post-law enforcement)
    const events = enforced.toEvents();
    if (this.subs.size && events.length) {
      for (const fn of this.subs) {
        for (const ev of events) fn(ev);
      }
    }
  }

  /** Current replayed state of the normalized history. */
  state(): Record<string, unknown> {
    return state(this.nf);
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

  /** Subscribe to push notifications. Returns an unsubscribe; emits initial Snapshot. */
  subscribe(fn: (ev: Event | { type: 'Snapshot' }) => void): () => void {
    this.subs.add(fn);
    fn({ type: 'Snapshot' });
    return () => {
      this.subs.delete(fn);
    };
  }

  /** Compact history to a snapshot of Creates; then emit Snapshot. */
  compact(): void {
    const snap = this.state();
    const newLog: Event[] = [];
    for (const [id, value] of Object.entries(snap)) {
      newLog.push({ type: 'Create', id, value } as Event);
    }
    this.nf = newLog;
    if (this.subs.size) {
      for (const fn of this.subs) fn({ type: 'Snapshot' });
    }
  }
}
