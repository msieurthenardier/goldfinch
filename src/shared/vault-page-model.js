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
 * @typedef {{ admin: boolean, vaultIds: string[] }} CompromiseReport
 * @typedef {{ route: 'change-master' | 'recover' }} SeverOffer
 * @typedef {{ mode: 'not-set-up' | 'locked' | 'unlocked', vaults: VaultRow[], adminProvisioned: boolean, compromiseReport: CompromiseReport | null, severOffer: SeverOffer | null }} VaultView
 * @typedef {{ id: string, kind: 'global' | 'jar', label: string, count?: number, color?: string|null }} VaultChildEntry
 * @typedef {(
 *   { id: string, kind: 'settings', label: string } |
 *   { id: string, kind: 'group', label: string, children: VaultChildEntry[] }
 * )} VaultNavEntry
 */

// The stable id of the top "Settings" nav entry / its section (M12 F5 HAT
// hat-page-sidebar). Not a vault id — the Settings section groups the manager-wide
// controls (lock, auto-lock, import, master-key management), so it needs its own
// reserved section id distinct from every vault's id.
const SETTINGS_ID = 'settings';

// The stable id of the top "Vaults" group nav entry / its header section (M12 F5 HAT
// batch). A group PARENT whose children are the per-vault entries — not a vault id.
const VAULTS_ID = 'vaults';

/**
 * Select the page view from the raw `internal-vault-state` payload. Defensive:
 * a malformed/absent payload degrades to 'not-set-up' with no vaults, and each
 * vault row is normalized to a `{ vaultId, label }` string pair (a missing label
 * falls back to the id) so the page always renders text via `textContent`.
 *
 * M18 F2 L4 (flight DD1/DD6): the view also carries `adminProvisioned` (drives
 * the Master-key section's provision state; false unless the payload says true)
 * and the normalized `compromiseReport` behind the persistent "Everything
 * rotated" card. The report rides BOTH the locked and unlocked views (R8: the
 * card renders regardless of the lock state the page lands in) and is dropped —
 * along with adminProvisioned — for 'not-set-up' (a rotated profile is by
 * definition set up). A malformed report normalizes to null; vaultIds keeps
 * string entries only (textContent-safe).
 *
 * M18 F3 L3 (DD7): the view also carries `severOffer` (the post-fresh-adopt sever
 * card's route — 'change-master' | 'recover') — normalized the same defensive way as
 * `compromiseReport`, rides BOTH the locked and unlocked views (the offer's route
 * flips live with lock state; the edge case: "Sever card while locked: card persists,
 * route flips to recover"), and is dropped for 'not-set-up' alongside the report.
 *
 * @param {{ setUp?: unknown, unlocked?: unknown, vaults?: unknown, adminProvisioned?: unknown, compromiseReport?: unknown, severOffer?: unknown }} [state]
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

  const adminProvisioned = s.adminProvisioned === true;
  /** @type {CompromiseReport | null} */
  let compromiseReport = null;
  const rawReport = s.compromiseReport;
  if (rawReport && typeof rawReport === 'object' && !Array.isArray(rawReport)) {
    const r = /** @type {{ admin?: unknown, vaultIds?: unknown }} */ (rawReport);
    compromiseReport = {
      admin: r.admin === true,
      vaultIds: Array.isArray(r.vaultIds) ? r.vaultIds.filter((id) => typeof id === 'string' && id) : []
    };
  }

  /** @type {SeverOffer | null} */
  let severOffer = null;
  const rawOffer = s.severOffer;
  if (rawOffer && typeof rawOffer === 'object' && !Array.isArray(rawOffer)) {
    const o = /** @type {{ route?: unknown }} */ (rawOffer);
    if (o.route === 'change-master' || o.route === 'recover') severOffer = { route: o.route };
  }

  if (!setUp) {
    return { mode: 'not-set-up', vaults: [], adminProvisioned: false, compromiseReport: null, severOffer: null };
  }
  if (!unlocked) return { mode: 'locked', vaults, adminProvisioned, compromiseReport, severOffer };
  return { mode: 'unlocked', vaults, adminProvisioned, compromiseReport, severOffer };
}

/**
 * Build the "Everything rotated" card's revoked-keys ROW MODEL (M18 F2 L4, R8) —
 * extracted from the page's inline card builder after behavior-test run
 * 2026-09-02-02-22-01 so the row rendering is unit-pinnable (the vault-page-model
 * extraction precedent; leg 4 had reassigned the card's DOM pins to the behavior
 * test, leaving NO unit layer over this mapping). Pure: report + vault rows in,
 * display rows out.
 *
 * Order and labels are the R8 ruling: the admin row FIRST ("Admin key"), then one
 * row per revoked vault in report order, each by its display label from the state's
 * vault rows — `'global'` resolves to its display label like any other id, and an
 * id with no matching row falls back to the raw id (textContent-safe either way).
 * Every row carries the UNIFORM "— Revoked" hint. A rotation with nothing to
 * revoke ({ admin: false, vaultIds: [] } — e.g. a repeat rotation on an
 * already-severed profile) correctly yields ZERO rows: the card still renders
 * (the report is non-null), with an empty list.
 *
 * @param {{ admin?: unknown, vaultIds?: unknown } | null | undefined} report
 * @param {Array<{ vaultId: string, label: string }>} [vaults]
 * @returns {Array<{ label: string, hint: string }>}
 */
function compromiseCardRows(report, vaults) {
  /** @type {Map<string, string>} */
  const labelById = new Map();
  for (const v of Array.isArray(vaults) ? vaults : []) {
    if (v && typeof v === 'object' && typeof v.vaultId === 'string' && v.vaultId) {
      labelById.set(v.vaultId, typeof v.label === 'string' && v.label ? v.label : v.vaultId);
    }
  }
  /** @type {Array<{ label: string, hint: string }>} */
  const rows = [];
  const r = report && typeof report === 'object' ? report : {};
  if (r.admin === true) rows.push({ label: 'Admin key', hint: '— Revoked' });
  for (const vaultId of Array.isArray(r.vaultIds) ? r.vaultIds : []) {
    if (typeof vaultId !== 'string' || !vaultId) continue;
    rows.push({ label: labelById.get(vaultId) || vaultId, hint: '— Revoked' });
  }
  return rows;
}

/**
 * Build the TWO-LEVEL left-nav entry model for the nav+main layout (M12 F5 HAT
 * hat-page-sidebar; two-level per the M12 F5 HAT batch): a fixed top "Settings" entry,
 * then a top "Vaults" group whose `children` are one entry per vault — the vaults are
 * indented under the group rather than sitting flat beside Settings.
 *
 * A vault child is a JAR entry when its id is a persistent jar (present in `jars`) and a
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

  /** @type {VaultChildEntry[]} */
  const children = [];
  for (const v of Array.isArray(vaults) ? vaults : []) {
    if (!v || typeof v.vaultId !== 'string' || !v.vaultId) continue;
    if (colorById.has(v.vaultId)) {
      children.push({ id: v.vaultId, kind: 'jar', label: v.label, count: v.count, color: colorById.get(v.vaultId) });
    } else {
      children.push({ id: v.vaultId, kind: 'global', label: v.label, count: v.count });
    }
  }

  return [
    { id: SETTINGS_ID, kind: 'settings', label: 'Settings' },
    { id: VAULTS_ID, kind: 'group', label: 'Vaults', children }
  ];
}

/**
 * Build the restore mapping modal's "existing" destination options for a JAR-SOURCED bundle
 * row (M18 F3 L4, HAT fix 8). Every PERSISTENT jar is a legal destination — vault-backed or
 * not — labeled by its own presence so an operator can point a bundle vault at a browsing
 * container that has never held a vault before. This closes the fresh-adopt gap: on a
 * not-set-up profile `selectVaultView`'s vaults list is empty by design (above), so the old
 * "existing" list built from it was empty/unusable and every jar row was forced onto "Create
 * a new jar" — colliding with the SAME-NAMED seeded container (Personal/Work) and landing a
 * duplicate `personal-1`. `jars` (jarRows) is populated regardless of setup/lock state and
 * never carries the reserved global id, so this list is always usable, pre-setup included.
 *
 * Also resolves HAT-fix-7's rerun-recovery prefill against this SAME full list (trimmed,
 * case-insensitive name match, first hit wins) — a residue jar left by a prior attempt is
 * found whether or not it already carries a vault file.
 *
 * `presenceById` is keyed by jar id; a missing/malformed entry degrades to "no vault yet" —
 * never thrown, never dropped from the list (a presence map that lags jarRows, e.g. mid-race,
 * still offers every jar as a destination). `count` renders only alongside `hasVault: true`
 * and only when it is a finite, non-negative number.
 *
 * @param {Array<{ id?: unknown, name?: unknown }>} [jars]  jarRows — the full persistent-jar list.
 * @param {Record<string, { hasVault?: unknown, count?: unknown }>} [presenceById]
 * @param {string} [bundleName]  the bundle row's identity.name, for the rerun-recovery match.
 * @returns {{ options: Array<{ vaultId: string, label: string }>, matched: { vaultId: string, label: string } | undefined }}
 */
function restoreDestinationOptions(jars, presenceById, bundleName) {
  const presence = presenceById && typeof presenceById === 'object' ? presenceById : {};
  const list = Array.isArray(jars) ? jars : [];
  /** @type {Array<{ vaultId: string, label: string }>} */
  const options = [];
  for (const j of list) {
    if (!j || typeof j !== 'object' || typeof j.id !== 'string' || !j.id) continue;
    const name = typeof j.name === 'string' && j.name ? j.name : j.id;
    const p = presence[j.id];
    const hasVault = !!(p && p.hasVault === true);
    const count = p && typeof p.count === 'number' && Number.isFinite(p.count) && p.count >= 0 ? p.count : null;
    const state = hasVault
      ? count === null
        ? 'has a vault'
        : `has a vault (${count} item${count === 1 ? '' : 's'})`
      : 'no vault yet';
    options.push({ vaultId: j.id, label: `${name} — ${state}` });
  }

  const target = typeof bundleName === 'string' ? bundleName.trim().toLowerCase() : '';
  const hit = target
    ? list.find(
        (j) => j && typeof j === 'object' && typeof j.name === 'string' && j.name.trim().toLowerCase() === target
      )
    : undefined;
  const matched = hit ? options.find((o) => o.vaultId === hit.id) : undefined;

  return { options, matched };
}

/**
 * Build the restore completion modal's per-vault outcome display lines (M18 F3 L4, HAT fix
 * 11; RE-KEYED M18 F3 L5 to close the bundle identity leak). Extracted so the pure
 * results→display-strings mapping is unit-testable without a DOM — vault.js's completion
 * render just maps over these (vault.js sits at its line-budget ceiling per the leg-4 HAT log;
 * see the `vaultNavEntries`/`restoreDestinationOptions` precedent above).
 *
 * The operator feedback this closes: after a merge commit, the completion surface didn't say
 * per-vault whether items were actually imported or deduped — an operator merging a vault that
 * turned out to be identical to the destination (DD4: same-id-identical-content items skip)
 * saw only "Restored" with no indication the merge legitimately imported nothing new.
 *
 * M18 F3 L5: the commit reply's per-vault key is now the bundle's opaque `entryHandle` — a
 * random token, not the old plaintext `sourceId` (a jar name-slug) HAT fix 11 originally leaned
 * on to display "as-is". An entryHandle is NEVER shown to the operator: this function takes a
 * SECOND argument, `labels` (the mapping step's decrypted per-entry labels, `{entryHandle,
 * identity,itemCount}` — vault.js passes `record.labels`, in closure from the mapping modal's
 * `onSubmit`), and joins each result's entryHandle to its decrypted display NAME (`'Global'` for
 * `identity.kind === 'global'`, else `identity.name`) before rendering. `destination` is still
 * shown AS-IS — the resolved LOCAL destination jar id the OPERATOR chose at the mapping step,
 * never anything from the bundle — exactly as before (this surface renders strictly
 * post-authorization, after the operator has already supplied the bundle secret and committed
 * the restore).
 *
 * Each malformed/missing entry is defensive: an entry with no string `entryHandle` is dropped, a
 * missing/non-string `destination` renders with no arrow, an unrecognized `outcome` falls back
 * to echoing the raw value (or 'unknown'), and every `mergeReport` field coerces to `0` rather
 * than rendering `NaN`/`undefined`. `conflictCopies` is mentioned only when it is > 0 (the
 * common case — a clean dedup-only merge, the operator's exact reported scenario — reads as
 * just "N new, M already present" with no trailing zero-copies clause). A result whose
 * entryHandle has no matching label (a defensive fallback, not an expected path — the mapping
 * step's labels and the commit reply's results are always the same bundle) falls back to the
 * generic "a vault" rather than ever surfacing the raw entryHandle.
 *
 * @param {Array<{ entryHandle?: unknown, outcome?: unknown, destination?: unknown, mergeReport?: { imported?: unknown, skippedIdentical?: unknown, conflictCopies?: unknown } | unknown }>} [results]
 * @param {Array<{ entryHandle?: unknown, identity?: unknown }>} [labels]
 * @returns {Array<{ entryHandle: string, text: string }>}
 */
function restoreOutcomeLines(results, labels) {
  const list = Array.isArray(results) ? results : [];
  /** @type {Map<string, string>} */
  const nameByHandle = new Map();
  for (const l of Array.isArray(labels) ? labels : []) {
    if (!l || typeof l !== 'object' || typeof l.entryHandle !== 'string' || !l.entryHandle) continue;
    const identity = l.identity && typeof l.identity === 'object' ? /** @type {any} */ (l.identity) : null;
    const name =
      identity && identity.kind === 'global'
        ? 'Global'
        : identity && typeof identity.name === 'string' && identity.name
          ? identity.name
          : 'a vault';
    nameByHandle.set(l.entryHandle, name);
  }

  /** @type {Array<{ entryHandle: string, text: string }>} */
  const lines = [];
  for (const r of list) {
    if (!r || typeof r !== 'object' || typeof r.entryHandle !== 'string' || !r.entryHandle) continue;
    const entryHandle = r.entryHandle;
    const name = nameByHandle.get(entryHandle) || 'a vault';
    const destination = typeof r.destination === 'string' && r.destination ? r.destination : null;
    const withDest = (/** @type {string} */ suffix) => `${name}${destination ? ` → ${destination}` : ''}: ${suffix}`;

    let text;
    if (r.outcome === 'landed') {
      const mr = r.mergeReport && typeof r.mergeReport === 'object' ? /** @type {any} */ (r.mergeReport) : null;
      if (mr) {
        const imported = typeof mr.imported === 'number' && Number.isFinite(mr.imported) ? mr.imported : 0;
        const skippedIdentical =
          typeof mr.skippedIdentical === 'number' && Number.isFinite(mr.skippedIdentical) ? mr.skippedIdentical : 0;
        const conflictCopies =
          typeof mr.conflictCopies === 'number' && Number.isFinite(mr.conflictCopies) ? mr.conflictCopies : 0;
        let merged = `merged — ${imported} new, ${skippedIdentical} already present`;
        if (conflictCopies > 0) merged += `, ${conflictCopies} kept as copies`;
        text = withDest(merged);
      } else {
        text = withDest('restored');
      }
    } else if (r.outcome === 'collision-refused') {
      text = withDest('not restored (a vault already exists; choose Replace or Merge)');
    } else if (r.outcome === 'skipped') {
      text = `${name}: skipped`;
    } else if (r.outcome === 'failed') {
      text = `${name}: failed`;
    } else {
      text = `${name}: ${typeof r.outcome === 'string' && r.outcome ? r.outcome : 'unknown'}`;
    }
    lines.push({ entryHandle, text });
  }
  return lines;
}

export {
  selectVaultView,
  compromiseCardRows,
  vaultNavEntries,
  restoreDestinationOptions,
  restoreOutcomeLines,
  SETTINGS_ID,
  VAULTS_ID
};
