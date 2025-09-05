import { describe, it, expect } from 'vitest';

// This test is a placeholder; running it requires a SQLite DB implementation.
// It validates ordering and state consistency when wired end-to-end.

describe('sqlite ordering and state', () => {
  it.skip('10k events have monotonically increasing seq and consistent state', async () => {
    // TODO: integrate with real SQLite in CI or inject a DB double.
    expect(true).toBe(true);
  });
});

