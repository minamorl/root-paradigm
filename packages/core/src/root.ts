import { Patch } from './patch';
import { state } from './state';
import type { Event } from './types';

const isPatch = (
  input: Patch | Event | readonly Event[],
): input is Patch =>
  typeof (input as { toNormalForm?: unknown }).toNormalForm === 'function';

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

  /**
   * Commit new events or patches, storing the resulting normalized history.
   */
  commit(input: Patch | Event | readonly Event[]): void {
    const p = Array.isArray(input)
      ? Patch.from(input, this.rewrite)
      : isPatch(input)
        ? input
        : Patch.from([input], this.rewrite);
    const enforced = this.law.enforce(p);
    this.nf = this.rewrite([...this.nf, ...enforced.toNormalForm()]);
  }

  /**
   * Current replayed state of the normalized history.
   */
  state(): Record<string, unknown> {
    return state(this.nf);
  }

  /**
   * Normalized event history.
   */
  history(): readonly Event[] {
    return this.nf;
  }
}

