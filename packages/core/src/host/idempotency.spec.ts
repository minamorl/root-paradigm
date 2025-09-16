// Re-export host-level SQLite idempotency tests so Vitest picks them up when running within packages/core.
import '../../../../host/__tests__/idempotency.spec.ts';
