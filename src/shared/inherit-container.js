// @ts-check
'use strict';

// Pure link/image/selection-search open-in-new-tab container inheritance (M06
// Flight 2, HAT Leg 4 / D3). Extracted so the truth table is unit-testable
// without DOM, mirroring default-routing.js's split: the DECISION is pure and
// lives here; makeBurner() (per-tab stateful, the `burner-<n>` counter) stays
// caller-side in the renderer.
//
// Operator ruling at HAT: a link/image/selection-search opened FROM a tab must
// open in THAT tab's jar, not the DD1 default-jar resolution every other
// partition-less createTab call site uses.
//
// Contract — given the SOURCE tab's `container` and whether the source is
// internal (Settings/Downloads/unresolvable — isInternalTab(sourceTab)):
//   - source in a PERSISTENT jar (container present, not burner-flagged, not
//     internal) → `{ container: sourceContainer }` — inherit that SAME
//     container reference (same partition/cookies as the source tab)
//   - source is a BURNER tab (`container.burner === true`) → `{ freshBurner:
//     true }` — the caller mints a FRESH burner (never the source's own burner
//     partition: inheriting it would violate the burner-tabs-never-share-state
//     invariant, mission.md "Burner design stance". This also fixes a
//     pre-existing leak: before this fix every context-menu open passed no
//     container, so a burner tab's link-opens fell through the DD1 default
//     resolution and could land in the persistent default jar.)
//   - source is internal, or has no container at all (stale wcId / tab already
//     closed by dispatch time) → `{}` — neither field set, meaning "no
//     inheritance"; the caller's createTab falls through to its normal
//     default-jar resolution (status quo, DD1).
// At most one of `container` / `freshBurner` is ever set.
/**
 * @param {{ id?: any, burner?: boolean } | null | undefined} sourceContainer
 * @param {boolean} sourceIsInternal
 * @returns {{ container?: { id?: any, burner?: boolean }, freshBurner?: boolean }}
 */
function inheritContainerDecision(sourceContainer, sourceIsInternal) {
  if (sourceIsInternal || !sourceContainer) return {};
  if (sourceContainer.burner) return { freshBurner: true };
  return { container: sourceContainer };
}

// Dual export: CommonJS (main process + test runner) and global (renderer,
// which runs with nodeIntegration:false and cannot require()).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { inheritContainerDecision };
} else {
  /** @type {any} */ (globalThis).inheritContainerDecision = inheritContainerDecision;
}
