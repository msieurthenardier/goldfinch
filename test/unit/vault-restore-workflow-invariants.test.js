'use strict';

// Grep-AC suite (M18 F3 Leg 3 / CLAUDE.md's "Grep-AC convention") for structural invariants
// this leg's acceptance criteria name literally, codified as a permanent regression net rather
// than a one-off manual check. Each test source-scans the relevant file(s) — no boot, no DOM.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '../..');
const MAIN_JS = fs.readFileSync(path.join(REPO_ROOT, 'src/main/main.js'), 'utf8');
const OVERLAY_IPC_JS = fs.readFileSync(path.join(REPO_ROOT, 'src/main/register-overlay-ipc.js'), 'utf8');
const VAULT_JS = fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/pages/vault.js'), 'utf8');
const VAULT_CSS = fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/pages/vault.css'), 'utf8');
const RENDERER_JS_PATH = path.join(REPO_ROOT, 'src/renderer/renderer.js');
const JARS_SECTION_CONTROLLER_JS = fs.readFileSync(
  path.join(REPO_ROOT, 'src/renderer/pages/jars-section-controller.js'),
  'utf8'
);

test('adminPrivateKeyB64 in main.js/register-overlay-ipc.js: only the from-scratch/rotate-admin provision path, no live adopt send/reply', () => {
  // Every hit must sit within a small window of one of the provision-path markers — a bare
  // per-line match is too strict (a destructuring return two lines below its own derive call
  // carries no marker on its own line).
  const combinedLines = (MAIN_JS + '\n' + OVERLAY_IPC_JS).split('\n');
  const hitIndices = combinedLines.reduce(
    (acc, line, i) => (line.includes('adminPrivateKeyB64') ? [...acc, i] : acc),
    []
  );
  assert.ok(hitIndices.length > 0, 'sanity: the provision path still references it');
  const MARKER = /rotateAdminKey|vaultSetup|adminkey-show|recoveryKeyDisplay|deferred to F4/i;
  for (const i of hitIndices) {
    const line = combinedLines[i].trim();
    if (line.startsWith('//') || line.startsWith('*')) continue; // a historical/explanatory comment.
    const window = combinedLines.slice(Math.max(0, i - 3), i + 1).join('\n');
    assert.ok(MARKER.test(window), `unexpected adminPrivateKeyB64 reference outside the provision path: ${line}`);
  }
});

test('vault-adminkey-show: every live send/registration is the rotate-admin PROVISION path — the fresh-adopt chain is gone', () => {
  // The DELETED adopt chain used to send it from register-overlay-ipc.js's activated handler
  // AND stash/take an admin key alongside it (main.js). Neither exists any more: the ONLY live
  // `.send('vault-adminkey-show', ...)` site left is the rotate-admin-key delegate's own.
  const sendSites = [...OVERLAY_IPC_JS.matchAll(/\.send\('vault-adminkey-show'/g)];
  assert.equal(sendSites.length, 1, 'exactly one live vault-adminkey-show send (rotate-admin-key provision)');
  // The deleted admin-key map/functions may still be named in a HISTORICAL comment explaining
  // what was removed — assert no LIVE reference (a declaration, or a call on the map) remains.
  assert.equal(
    /_pendingAdoptAdminKeys\s*=\s*new Map|_pendingAdoptAdminKeys\.(set|get|delete|has)\(/.test(MAIN_JS),
    false,
    'the deleted admin-key map has no live declaration or call'
  );
  assert.equal(/\btakeAdoptAdminKey\s*[:(]/.test(OVERLAY_IPC_JS), false, 'no live takeAdoptAdminKey reference remains');
  assert.equal(
    /\bstashAdoptAdminKey\s*[:(]/.test(OVERLAY_IPC_JS),
    false,
    'no live stashAdoptAdminKey reference remains'
  );
});

test('renderer.js is untouched by this leg (DD11: no renderer.js change, or a named bump)', () => {
  const lines = fs.readFileSync(RENDERER_JS_PATH, 'utf8').split(/\r?\n/).length;
  // Mirrors seam-contract.test.js's own RENDERER_LINE_BUDGET pin (1836, the same split-array
  // counting convention) — this leg's AC is that the budget itself needed no bump; asserting
  // the exact landed count keeps that honest here too.
  assert.equal(lines, 1836, 'renderer.js line count unchanged from the pre-leg working tree');
});

test('no inline VaultStore error-class check outside the vault-sheet-errors.js mapper (zero inline ladders)', () => {
  const inlineChecks = [...MAIN_JS.matchAll(/instanceof\s+(?:vs\.|vc\.)?Vault\w*Error/g)];
  assert.deepEqual(inlineChecks, [], 'every VaultStore error class check routes through mapVaultSheetError');
});

test('the vault page Export modal calls BOTH exportProfile (whole-profile, default) and exportVault (single-vault, the HAT-fix-1 veto restoration) — M18 F3 L4', () => {
  // Leg 3 (DD1 ruling 7) made this modal whole-profile-only and this test asserted NO
  // bridge.exportVault caller in vault.js at all. The operator vetoed ruling 7 at the HAT
  // (leg 4, HAT fix 1): the modal now offers a source choice again, so vault.js gains back a
  // bridge.exportVault caller — the jars page's delete-time offer is no longer the ONLY one,
  // just the one exempt from ever being retired.
  assert.ok(
    /bridge\.exportVault\s*\(\s*select\.value/.test(VAULT_JS),
    'the Export modal calls exportVault(select.value, …) for a single-vault source'
  );
  assert.ok(
    /bridge\.exportProfile\s*\(/.test(VAULT_JS),
    'exportProfile is still called for the whole-profile (default) source'
  );
  assert.ok(
    JARS_SECTION_CONTROLLER_JS.includes('bridge.exportVault(id)'),
    'the jars page delete-time offer remains a separate, always-single-vault exportVault caller, untouched'
  );
});

// ---------------------------------------------------------------------------
// DD2 ruling 9 (broadcast-close + resume): a forced modal close (render()'s
// unconditional closeActivePageModal()) must NEVER drop the held import record —
// only an explicit onCancel does. Source-scan invariant: every clearPendingImport(
// call site, and every `pendingImportRecord = null` assignment, sits inside an
// onCancel/onSubmit handler body — never inside render()'s own top-level statements.
// ---------------------------------------------------------------------------

test("ruling 9: render()'s forced closeActivePageModal() never drops the held import record — clearPendingImport calls live only in onCancel bodies", () => {
  // Extract render()'s own function body (up to its matching top-level closing brace at the
  // function's own indent) and assert it contains neither a clearPendingImport call nor a
  // pendingImportRecord mutation — render() only ever REFRESHES the cache (via refresh()),
  // never drops the server-side record itself.
  const start = VAULT_JS.indexOf('function render(state) {');
  assert.ok(start !== -1, 'render(state) found');
  // render() is a single top-level function; its body ends at the next line that dedents back
  // to the same 2-space indent with a bare closing brace (mirrors this file's own formatting).
  const afterStart = VAULT_JS.slice(start);
  const endMatch = afterStart.match(/\n {2}\}\n/);
  assert.ok(endMatch, "render()'s closing brace found");
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));
  assert.equal(body.includes('clearPendingImport'), false, 'render() never calls clearPendingImport');
  assert.equal(body.includes('pendingImportRecord ='), false, 'render() never assigns pendingImportRecord');
  assert.ok(body.includes('closeActivePageModal()'), 'sanity: render() still forces the modal closed unconditionally');
});

// ---------------------------------------------------------------------------
// M18 F3 L4, HAT fix 4: the restore mapping modal ("Choose destinations") gets visible field
// labels + row/field spacing per the page's existing modal conventions, and its new-jar color
// control becomes a dot-swatch picker (mirroring the jars page's own jar-creation idiom)
// instead of a native <input type=color>. Source-scan invariants — no DOM/jsdom harness exists
// for this page (this file's own house style above).
// ---------------------------------------------------------------------------

/** Extract openMappingModal's own function body (up to its matching 2-space-indent closing
 * brace) — the same technique the ruling-9 test above uses for render(). */
function openMappingModalBody() {
  const start = VAULT_JS.indexOf('function openMappingModal(record, existingVaults) {');
  assert.ok(start !== -1, 'openMappingModal(record, existingVaults) found');
  const afterStart = VAULT_JS.slice(start);
  const endMatch = afterStart.match(/\n {2}\}\n/);
  assert.ok(endMatch, "openMappingModal()'s closing brace found");
  return afterStart.slice(0, /** @type {number} */ (endMatch.index));
}

test('openMappingModal: every row control (action, jar name, jar color, destination, replace/merge) carries a visible .vault-field/.vault-field-label — not aria-label alone', () => {
  const body = openMappingModalBody();
  for (const labelText of ['Action', 'Jar name', 'Jar color', 'Destination', 'What to do']) {
    assert.ok(
      body.includes(`el('span', 'vault-field-label', '${labelText}')`),
      `a visible vault-field-label span reads "${labelText}"`
    );
  }
  // Each labeled control sits in a .vault-field group (the editor's own convention — HAT fix 4
  // reuses it rather than inventing a parallel one), never a bare unlabeled select/input.
  const fieldGroups = [...body.matchAll(/el\('(?:label|div)', 'vault-field'\)/g)];
  assert.equal(fieldGroups.length, 5, 'five .vault-field groups: action, jar name, jar color, destination, mode');
});

test('openMappingModal: the new-jar color control is a dot-swatch picker, not a native input[type=color]', () => {
  const body = openMappingModalBody();
  assert.equal(/type\s*=\s*['"]color['"]/.test(body), false, 'no native color <input> remains in the mapping modal');
  assert.equal(body.includes('colorInput'), false, 'the retired colorInput variable is fully gone');
  assert.ok(body.includes('buildColorSwatchGrid('), 'the row builds a dot-swatch grid for the new-jar color');
});

test('openMappingModal: the color swatch grid prefills the bundle identity color and mirrors the jars page editColors idiom (append-as-custom-swatch, never a nearest-color guess)', () => {
  const body = openMappingModalBody();
  assert.ok(
    /identity\.kind === 'jar'\s*&&\s*isSafeColor\(identity\.color\)\s*\?\s*identity\.color\s*:\s*NEW_JAR_FALLBACK_COLOR/.test(
      body
    ),
    'initialColor prefers the bundle identity color, validated with isSafeColor (M18 F3 L5 rename)'
  );
  assert.ok(
    /JAR_COLOR_PALETTE\.includes\(initialColor\)\s*\?\s*JAR_COLOR_PALETTE\s*:\s*\[\s*\.\.\.JAR_COLOR_PALETTE,\s*initialColor\s*\]/.test(
      body
    ),
    'a non-preset bundle color is appended as a trailing custom swatch — mirrors jars-section-controller.js editColors'
  );
});

test('buildColorSwatchGrid: a radiogroup of role=radio dot buttons — the jars-page swatch-grid idiom, reimplemented locally (goldfinch://vault has no route to jars-create-controller.js)', () => {
  assert.ok(
    /function buildColorSwatchGrid\(colors, initialColor, ariaLabel, onSelect\) \{/.test(VAULT_JS),
    'buildColorSwatchGrid helper defined'
  );
  const start = VAULT_JS.indexOf('function buildColorSwatchGrid(colors, initialColor, ariaLabel, onSelect) {');
  const afterStart = VAULT_JS.slice(start);
  const endMatch = afterStart.match(/\n {2}\}\n/);
  assert.ok(endMatch, "buildColorSwatchGrid()'s closing brace found");
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));
  assert.ok(body.includes(`setAttribute('role', 'radiogroup')`), 'the grid is a radiogroup');
  assert.ok(body.includes(`setAttribute('role', 'radio')`), 'each swatch is a radio');
  assert.ok(body.includes('vault-swatch-btn'), 'swatches use the vault-swatch-btn class (styled in vault.css)');
});

// ---------------------------------------------------------------------------
// M18 F3 L4, HAT fix 5 (live-walk operator feedback on the mapping modal): (1) a
// per-row conditional block that is `.hidden` in JS but never actually hidden on screen,
// because an unconditional author-origin `display` declaration always beats the UA
// stylesheet's `[hidden] { display: none }` regardless of specificity; (2) the Action
// select's DISPLAYED value must reflect the row's prefilled directive, never "Choose…";
// (3) the new-jar color control collapses to a single dot by default.
// ---------------------------------------------------------------------------

test('vault.css gates every mapping-row conditional block behind its own [hidden] override — the author-origin `display` rules alone can never defeat JS-toggled .hidden', () => {
  for (const cls of ['vault-mapping-newjar-row', 'vault-mapping-dest-row', 'vault-mapping-mode-row']) {
    assert.ok(
      new RegExp(`\\.${cls}\\[hidden\\]`).test(VAULT_CSS),
      `.${cls}[hidden] { display: none } exists — otherwise .hidden has zero visual effect`
    );
  }
});

test('vault.css gates the collapsible color swatch grid behind its own [hidden] override', () => {
  assert.ok(
    /\.vault-swatch-grid\[hidden\]/.test(VAULT_CSS),
    '.vault-swatch-grid[hidden] { display: none } exists (same author-origin-beats-UA gotcha, avoided from the start)'
  );
});

test('vault.css pins .vault-modal-body as the sole scroll region of the generic modal card, with title/status/actions fixed (M18 F3 L4, HAT fix 6) — the mapping modal keeps Cancel/Commit visible no matter how many bundle vaults it lists', () => {
  const cardBlock = /\.vault-modal-card\s*{[^}]*}/.exec(VAULT_CSS)?.[0] ?? '';
  assert.match(cardBlock, /flex-direction:\s*column/, '.vault-modal-card is a flex column so header/body/footer stack');
  const bodyBlock = /\.vault-modal-body\s*{[^}]*}/.exec(VAULT_CSS)?.[0] ?? '';
  assert.match(bodyBlock, /flex:\s*1 1 auto/, '.vault-modal-body is the flexible member that absorbs extra height');
  assert.match(
    bodyBlock,
    /overflow-y:\s*auto/,
    '.vault-modal-body scrolls its own overflow rather than growing the card'
  );
  for (const cls of ['vault-modal-title', 'vault-modal-status', 'vault-modal-actions']) {
    const block = new RegExp(`\\.${cls}\\s*{[^}]*}`).exec(VAULT_CSS)?.[0] ?? '';
    assert.match(
      block,
      /flex-shrink:\s*0/,
      `.${cls} is pinned (flex-shrink: 0) — never squeezed by the scrolling body`
    );
  }
});

test('openMappingModal: every row prefills a directive — the Action select is never left on the disabled "Choose…" placeholder', () => {
  const body = openMappingModalBody();
  assert.ok(
    /directiveSelect\.value\s*=\s*isGlobalSource\s*\?\s*'existing'\s*:\s*matchedExisting\s*\?\s*'existing'\s*:\s*'new'/.test(
      body
    ),
    "directiveSelect.value is set to the row's prefilled directive (global→existing, jar→new UNLESS a" +
      ' name-matched residue jar exists, in which case existing→that jar — HAT fix 7/DD3 rerun-recovery)'
  );
  assert.ok(
    /destSelect\s*&&\s*isGlobalSource\s*\)\s*destSelect\.value\s*=\s*GLOBAL_VAULT_ID/.test(body),
    "the global row's destination select is defaulted to GLOBAL_VAULT_ID (buildVaultSelect otherwise defaults to its first option, not necessarily Global)"
  );
  assert.ok(
    /else if\s*\(destSelect\s*&&\s*matchedExisting\)\s*destSelect\.value\s*=\s*matchedExisting\.vaultId/.test(body),
    "a name-matched jar row's destination select is defaulted to that residue jar's vaultId (HAT fix 7)"
  );
});

// ---------------------------------------------------------------------------
// M18 F3 L4, HAT fix 8: a jar row's "existing" destinations (and HAT-fix-7's rerun-recovery
// match) now source from jarRows + jarVaultPresence via the pure restoreDestinationOptions
// (src/shared/vault-page-model.js) — NOT from existingVaults, which DD2 ruling 3 forces empty
// on a fresh (not-set-up) adopt. The matching semantics themselves (trimmed/case-insensitive,
// first-hit-wins) are unit-tested at the pure-function level (vault-page-model.test.js); this
// suite only pins that openMappingModal actually delegates to it, for both rows it drives.
// ---------------------------------------------------------------------------

test('openMappingModal: a jar-sourced row builds its destination options AND rerun-recovery match via restoreDestinationOptions(jarRows, jarVaultPresence, …) — never existingVaults', () => {
  const body = openMappingModalBody();
  assert.ok(
    /const jarDest =\s*identity\.kind === 'jar'\s*\?\s*restoreDestinationOptions\(jarRows, jarVaultPresence, identity\.name\)\s*:\s*null/.test(
      body
    ),
    'jarDest is computed via restoreDestinationOptions against jarRows + jarVaultPresence, for jar rows only'
  );
  assert.ok(/:\s*jarDest\.options;/.test(body), "a jar row's destinationOptions come from jarDest.options");
  assert.ok(
    /const matchedExisting = isGlobalSource \? undefined : jarDest\.matched;/.test(body),
    'matchedExisting is jarDest.matched for a jar row, and is never computed for the global row'
  );
  assert.equal(/existingVaults\.find\(/.test(body), false, 'the old existingVaults.find() name-match is fully gone');
});

test('openMappingModal: a stale hasVault probe reply can never overwrite a row that has since moved on to a different directive/destination', () => {
  const body = openMappingModalBody();
  assert.ok(/let probeGeneration = 0/.test(body), 'a per-row generation counter exists');
  assert.ok(
    /probeGeneration\+\+/.test(body),
    'recompute() bumps the generation on every call, superseding any in-flight probe'
  );
  const staleGuards = [...body.matchAll(/if \(stale\(\)\) return;/g)];
  assert.equal(
    staleGuards.length,
    2,
    'both the resolve and reject branches of the hasVault probe drop a superseded reply'
  );
});

test('buildColorSwatchGrid: collapsed by default behind a dot toggle button with aria-expanded, expanding the radiogroup on click', () => {
  const start = VAULT_JS.indexOf('function buildColorSwatchGrid(colors, initialColor, ariaLabel, onSelect) {');
  const afterStart = VAULT_JS.slice(start);
  const endMatch = afterStart.match(/\n {2}\}\n/);
  assert.ok(endMatch, "buildColorSwatchGrid()'s closing brace found");
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));
  assert.ok(body.includes('vault-swatch-toggle'), 'a toggle button renders the collapsed single-dot state');
  assert.ok(body.includes('vault-swatch-dot'), 'the toggle shows the selected color as a dot');
  assert.ok(body.includes(`setAttribute('aria-expanded', 'false')`), 'the toggle starts collapsed');
  assert.ok(body.includes(`grid.hidden = true`), 'the swatch grid starts hidden behind the toggle');
  assert.ok(body.includes(`grid.hidden = false`), 'clicking the toggle expands the grid');
  assert.ok(
    /ev\.key === 'Escape'.*close\(true\)/s.test(body),
    'Escape collapses the grid back to the dot (and does not also close the enclosing modal)'
  );
  assert.ok(/onSelect\(color\);\s*close\(true\);/.test(body), 'selecting a swatch collapses the grid back to the dot');
});
