export type { Id, Create, Update, Delete, Event } from './types';
import type { Event } from './types';

export type Subscriber = (ev: Event) => void;

export class Root {
  private readonly log: Event[] = [];
  private readonly subs: Subscriber[] = [];

  commit(event: Event): void {
    this.log.push(event);
    // push型通知
    for (const fn of this.subs) fn(event);
  }

  subscribe(fn: Subscriber): void {
    this.subs.push(fn);
  }

  history(): readonly Event[] {
    return this.log;
  }

  // 最新状態（論理削除を解釈）
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
        default: {
          const _exhaustive: never = ev;
          void _exhaustive;
        }
      }
    }
    return s;
  }

  // 部分一致マッチ（最初は素朴実装）
  match(pattern: Partial<Event>): Event[] {
    return this.log.filter((ev) =>
      Object.entries(pattern).every(
        ([k, v]) => (ev as Record<string, unknown>)[k] === v,
      ),
    );
  }

  // 圧縮：最新状態だけを Create として再構築
  compact(): void {
    const snapshot = this.state();
    const newLog: Event[] = [];
    for (const [id, value] of Object.entries(snapshot)) {
      newLog.push({ type: 'Create', id, value });
    }
    (this.log as Event[]).length = 0;
    (this.log as Event[]).push(...newLog);
  }
}
