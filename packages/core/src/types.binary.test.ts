import { describe, it } from 'vitest';
import type { BinaryRef } from '../../../adapters/types.ts';
import type { Create, Update } from './types';

describe('BinaryRef type compatibility', () => {
  it('BinaryRef assignable to unknown value fields', () => {
    const ref: BinaryRef = { kind: 'blob', uri: 'blob:sha256-' + '0'.repeat(64), bytes: 123, contentType: 'application/octet-stream' };
    // Existing event types accept unknown for value; this should type-check.
    const c: Create = { type: 'Create', id: 'x', value: ref };
    const u: Update = { type: 'Update', id: 'x', value: ref };
    // Use variables to avoid TS removing unused vars; runtime no-op
    void c; void u;
  });
});

