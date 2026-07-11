// @ts-check

// Pure new-tab container resolution (M06 Flight 2, Leg 1 / DD1). Extracted so the
// routing truth-table is unit-testable without DOM.
//
// Contract: returns the resolved container object, or `null` meaning "the caller
// mints a fresh burner" (burner minting stays in the renderer — it's per-tab
// stateful, the `burner-<n>` counter). `defaultId === null` means Burner holds the
// flag (DD3 reconciliation); `defaultId === undefined` means the boot snapshot
// hasn't arrived yet. Both cases, and a stale/no-match id, resolve to `null`.
//
// Rationale for stale→burner: the store guarantees a resolvable `defaultId` at
// rest, so a miss here is a transient broadcast-in-flight window or a snapshot
// failure; minting a burner is the privacy-conservative fallback — nothing lands
// in an unintended persistent jar, and the tab evaporates.
/**
 * @param {Array<{ id?: any }>} containers
 * @param {string | null | undefined} defaultId
 * @returns {any}
 */
export function resolveNewTabContainer(containers, defaultId) {
  if (defaultId == null) return null; // null = Burner holds the flag; undefined = snapshot pending — both mint a burner
  return (containers || []).find((c) => c && c.id === defaultId) || null;
}
