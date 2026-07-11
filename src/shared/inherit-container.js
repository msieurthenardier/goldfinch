// @ts-check

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
export function inheritContainerDecision(sourceContainer, sourceIsInternal) {
  if (sourceIsInternal || !sourceContainer) return {};
  if (sourceContainer.burner) return { freshBurner: true };
  return { container: sourceContainer };
}

// inheritFromPartition (DD7, M06 F3 Leg 4) — popup inheritance. window.open /
// target=_blank popups are captured in main's setWindowOpenHandler, which has
// no Tab object, only the OPENER guest's webContents — so main forwards the
// one opener fact it reliably holds: the session PARTITION STRING (read from
// the existing tabViews registry, tracked at tab-create time and cleaned up on
// tab-close — no staleness risk). This function resolves that string
// renderer-side into the SAME decision shape inheritContainerDecision produces,
// so the renderer consumes exactly one decision path (freshBurner/container) for
// both context-menu opens (inheritContainerDecision) and popup opens (this).
//
// Partition shapes (pinned at design review against the working tree — do not
// re-guess):
//   - persistent jar:  `persist:${...}`           (src/main/jars.js)
//   - burner:          `burner:${n}` — COLON separator, NOT the hyphen used in
//                       burner ids (`burner-<n>`) (makeBurner, renderer.js)
//   - internal:         bare string `goldfinch-internal` (src/shared/internal-page.js)
// `startsWith('persist:')` / `startsWith('burner:')` dispatch is unambiguous.
//
//   - burner-pattern partition → `{ freshBurner: true }` — a FRESH burner, NEVER
//     the opener's own burner partition (never-share-state invariant, same
//     rationale as inheritContainerDecision above: burner containers are never
//     in `containers`, so a partition match against `containers` could not
//     accidentally resolve one anyway, but the burner branch is checked FIRST,
//     structurally, so this holds even if that ever changed).
//   - persistent partition matching a container in `containers` → `{ container }`
//     (that container's object reference).
//   - persistent-LOOKING partition with NO match (stale id, container since
//     deleted) → `{}` — default resolution; privacy-conservative, mirrors
//     `resolveNewTabContainer`'s stale-id posture (never guess a container).
//   - internal partition, unknown format, or missing/undefined (e.g. the opener
//     closed before the popup IPC lands, or a sender outside the tabViews
//     registry) → `{}` — default resolution. NEVER throws.
/**
 * @param {string | null | undefined} openerPartition
 * @param {Array<{ id?: any, partition?: string, burner?: boolean }> | null | undefined} containers
 * @returns {{ container?: { id?: any, partition?: string, burner?: boolean }, freshBurner?: boolean }}
 */
export function inheritFromPartition(openerPartition, containers) {
  if (typeof openerPartition !== 'string' || !openerPartition) return {};
  if (openerPartition.startsWith('burner:')) return { freshBurner: true };
  if (openerPartition.startsWith('persist:')) {
    const match = (containers || []).find((c) => c && c.partition === openerPartition);
    return match ? { container: match } : {};
  }
  return {}; // internal (`goldfinch-internal`) / unrecognized format → default
}
