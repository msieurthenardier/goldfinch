// @ts-check

// Pure decision model for the chrome toolbar's vault ("lock") indicator (M12
// Flight 2 Leg 2 chrome-unlock, DD10). Extracted so the hidden/locked/unlocked
// truth table is unit-testable without DOM — the same shape as
// automation-indicator-model.js. Real ES module: consumed via `import` by the
// chrome renderer (renderer.js) and `require()`d verbatim by the unit suite.
//
// DD10 freshness contract: the indicator is a PURE PROJECTION of the pushed
// `vault-lock-state` payload `{ setUp, unlocked }` — the source of truth is the
// vault-store's MRK-present state, broadcast on every transition. This module
// never caches; it maps a single pushed snapshot to a render model.
//
// States:
//   - not set up  → hidden (the manager has never been created; nothing to show).
//   - set up + locked   → visible, 'locked'.
//   - set up + unlocked → visible, 'unlocked'.
//
// Never throws — malformed / partial input coerces to booleans (defensive
// defaults), matching every other shared decision module in this codebase.

/**
 * @param {{ setUp?: any, unlocked?: any } | null | undefined} input
 * @returns {{ visible: boolean, state: 'locked' | 'unlocked' }}
 */
export function buildVaultIndicatorModel(input) {
  const opts = input || {};
  const setUp = !!opts.setUp;
  const unlocked = !!opts.unlocked;
  if (!setUp) return { visible: false, state: 'locked' };
  return { visible: true, state: unlocked ? 'unlocked' : 'locked' };
}
