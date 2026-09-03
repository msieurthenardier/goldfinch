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

test('the vault page has NO caller of the single-vault exportVault bridge method — exportProfile only', () => {
  assert.equal(
    /bridge\.exportVault\s*\(/.test(VAULT_JS),
    false,
    'vault.js must call exportProfile() only — exportVault is the jars page single-vault caller'
  );
  assert.ok(/bridge\.exportProfile\s*\(/.test(VAULT_JS), 'exportProfile is actually called somewhere');
  assert.ok(
    JARS_SECTION_CONTROLLER_JS.includes('bridge.exportVault(id)'),
    'the jars page delete-time offer remains the one intentional exportVault caller, untouched'
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
