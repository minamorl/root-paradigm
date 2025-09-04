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
}
