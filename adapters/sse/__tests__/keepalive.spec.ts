import { describe, it, expect, vi } from 'vitest';
import { SseAdapter } from '../index';

describe('SSE keep-alive', () => {
  it('keeps connection alive for 30s via heartbeats', async () => {
    vi.useFakeTimers();
    const sse = new SseAdapter();
    const writes: string[] = [];
    const res: any = {
      setHeader() {},
      writeHead() {},
      flushHeaders() {},
      write(chunk: string) { writes.push(chunk); },
      end() {},
      on() {},
    };
    sse.handler({} as any, res);
    // initial retry + comment
    expect(writes.join('')).toContain('retry: 2000');
    // 30s pass => at least two heartbeats
    vi.advanceTimersByTime(30000);
    const heartbeatCount = writes.filter(w => w === ":\n\n").length;
    expect(heartbeatCount).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });
});

