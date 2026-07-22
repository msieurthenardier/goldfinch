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
 * @typedef {{ vaultId: string, label: string, count?: number }} VaultRow
 * @typedef {{ mode: 'not-set-up' | 'locked' | 'unlocked', vaults: VaultRow[] }} VaultView
 * @typedef {{ id: string, kind: 'settings' | 'global' | 'jar', label: string, count?: number, color?: string|null }} VaultNavEntry
 */

// The stable id of the top "Settings" nav entry / its section (M12 F5 HAT
// hat-page-sidebar). Not a vault id — the Settings section groups the manager-wide
// controls (lock, auto-lock, import, master-key management), so it needs its own
// reserved section id distinct from every vault's id.
const SETTINGS_ID = 'settings';

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

/**
 * Build the left-nav entry list for the nav+main layout (M12 F5 HAT
 * hat-page-sidebar): a fixed "Settings" entry followed by one entry per vault.
 *
 * A vault is a JAR entry when its id is a persistent jar (present in `jars`) and a
 * GLOBAL entry otherwise — the manager-wide global vault is never a persistent jar,
 * so it never appears in `jars.list()` (register-vault-ipc prepends it to the vault
 * rows under the reserved `global` sentinel). This "is it backed by a persistent
 * jar?" test is exactly what distinguishes the globe entry from a jar-dot entry and
 * avoids threading the main-only `GLOBAL_ID` sentinel into this page-side module.
 *
 * Jar entries carry the jar's raw `color` (joined by id); the caller applies the
 * `isSafeColor` backstop before painting the dot (same contract as jars-nav).
 *
 * @param {VaultRow[]} vaults  the `{ vaultId, label, count? }` rows from vault state.
 * @param {Array<{ id?: unknown, color?: unknown }>} [jars]  the `internal-jars-list` rows.
 * @returns {VaultNavEntry[]}
 */
function vaultNavEntries(vaults, jars) {
  /** @type {Map<string, string|null>} */
  const colorById = new Map();
  for (const j of Array.isArray(jars) ? jars : []) {
    if (j && typeof j === 'object' && typeof j.id === 'string') {
      colorById.set(j.id, typeof j.color === 'string' ? j.color : null);
    }
  }

  /** @type {VaultNavEntry[]} */
  const entries = [{ id: SETTINGS_ID, kind: 'settings', label: 'Settings' }];
  for (const v of Array.isArray(vaults) ? vaults : []) {
    if (!v || typeof v.vaultId !== 'string' || !v.vaultId) continue;
    if (colorById.has(v.vaultId)) {
      entries.push({ id: v.vaultId, kind: 'jar', label: v.label, count: v.count, color: colorById.get(v.vaultId) });
    } else {
      entries.push({ id: v.vaultId, kind: 'global', label: v.label, count: v.count });
    }
  }
  return entries;
}

export { selectVaultView, vaultNavEntries, SETTINGS_ID };
