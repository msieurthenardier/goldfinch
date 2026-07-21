// @ts-check

// Pure state-selection model for the goldfinch://vault management page (M12
// Flight 3, Leg 1 / DD9). Extracted so the page's three-state selection is
// unit-testable WITHOUT a DOM — the mission's proven pure-module split
// (jar-page-model.js precedent). No DOM, no Electron.
//
// The page renders three mutually-exclusive modes from the `internal-vault-state`
// read (`{ setUp, unlocked, vaults }`, LABELS ONLY — no counts, no secret):
//   - 'not-set-up' — the manager has no manager.json yet; show a setup CTA. No
//     vault list (there are no vaults until setup runs).
//   - 'locked'     — set up but no MRK in memory; show the vault labels (labels
//     need no MRK) plus an unlock affordance. No item counts (those need the MRK).
//   - 'unlocked'   — show the vault list, labels only (counts land in leg 2).
//
// Real ES module: the page imports it via a flat serving-path specifier resolved
// by internal-page-map.js; unit tests `require()` the same file.

/**
 * @typedef {{ vaultId: string, label: string }} VaultRow
 * @typedef {{ mode: 'not-set-up' | 'locked' | 'unlocked', vaults: VaultRow[] }} VaultView
 */

/**
 * Select the page view from the raw `internal-vault-state` payload. Defensive:
 * a malformed/absent payload degrades to 'not-set-up' with no vaults, and each
 * vault row is normalized to a `{ vaultId, label }` string pair (a missing label
 * falls back to the id) so the page always renders text via `textContent`.
 *
 * @param {{ setUp?: unknown, unlocked?: unknown, vaults?: unknown }} [state]
 * @returns {VaultView}
 */
function selectVaultView(state) {
  const s = state && typeof state === 'object' ? state : {};
  const setUp = s.setUp === true;
  const unlocked = s.unlocked === true;

  const rawVaults = Array.isArray(s.vaults) ? s.vaults : [];
  /** @type {VaultRow[]} */
  const vaults = [];
  for (const v of rawVaults) {
    if (!v || typeof v !== 'object' || typeof v.vaultId !== 'string' || !v.vaultId) continue;
    vaults.push({
      vaultId: v.vaultId,
      label: typeof v.label === 'string' && v.label ? v.label : v.vaultId
    });
  }

  if (!setUp) return { mode: 'not-set-up', vaults: [] };
  if (!unlocked) return { mode: 'locked', vaults };
  return { mode: 'unlocked', vaults };
}

export { selectVaultView };
