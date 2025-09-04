import type { Event, Subscriber } from './types';
import { Patch } from './patch';

// Internal association of a Patch to the base state it was applied on.
const patchBases = new WeakMap<Patch, Record<string, unknown>>();

/**
 * Root holds the append-only event log and provides utilities to
 * derive state, subscribe to changes, and perform undo/redo with patches.
 */
export class Root {
  private readonly log: Event[] = [];
  private readonly subs: Subscriber[] = [];

  /**
   * Commit a single event or a Patch (sequence of events) to the log.
   * Notifies subscribers per event in order.
   */
  commit(event: Event): void;
  commit(patch: Patch): void;
  commit(arg: Event | Patch): void {
    const events: Event[] = arg instanceof Patch ? arg.nf : [arg];
    if (arg instanceof Patch) {
      // Snapshot base state for potential undo
      patchBases.set(arg, this.state());
    }
    for (const ev of events) {
      this.log.push(ev);
      for (const fn of this.subs) fn(ev);
    }
  }

  /**
   * Subscribe to events appended to the log.
   */
  subscribe(fn: Subscriber): void {
    this.subs.push(fn);
  }

  /**
   * Return the current normalized history (NF) of events.
   */
  history(): readonly Event[] {
    return this.log;
  }

  /**
   * Compute the latest materialized state by interpreting the log.
   */
  state(): Record<string, unknown> {
    const s: Record<string, unknown> = {};
    for (const ev of this.log) {
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
      }
    }
    return s;
  }

  /**
   * Query events by partial structural match.
   */
  match(pattern: Partial<Event>): Event[] {
    return this.log.filter((ev) =>
      Object.entries(pattern).every(([k, v]) => (ev as any)[k] === v)
    );
  }

  /**
   * Compact history by snapshotting current state as Create events.
   */
  compact(): void {
    const snapshot = this.state();
    const newLog: Event[] = [];
    for (const [id, value] of Object.entries(snapshot)) {
      newLog.push({ type: 'Create', id, value });
    }
    (this.log as Event[]).length = 0;
    (this.log as Event[]).push(...newLog);
  }

  /**
   * Undo a previously created patch by committing its inverse
   * relative to the current state.
   */
  undo(p: Patch): void {
    const base = patchBases.get(p) ?? this.state();
    const inv = p.invert(base);
    this.commit(inv);
  }

  /**
   * Redo a previously undone patch by committing it again.
   */
  redo(p: Patch): void {
    this.commit(p);
  }
}
