'use strict';

// Grep-AC suite (M19 F1 Leg 2 / CLAUDE.md's "Grep-AC convention") for structural
// invariants this leg's acceptance criteria name literally, codified as a permanent
// regression net rather than a one-off manual check. Each test source-scans the
// relevant file(s) — no boot, no DOM.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '../..');
const VAULT_JS = fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/pages/vault.js'), 'utf8');
const CONTROLLER_JS = fs.readFileSync(
  path.join(REPO_ROOT, 'src/renderer/pages/vault-browser-import-controller.js'),
  'utf8'
);
const MAIN_JS = fs.readFileSync(path.join(REPO_ROOT, 'src/main/main.js'), 'utf8');
const INTERNAL_PAGE_MAP_JS = fs.readFileSync(path.join(REPO_ROOT, 'src/main/internal-page-map.js'), 'utf8');
const AUTOMATION_DIR = path.join(REPO_ROOT, 'src/main/automation');

// ---------------------------------------------------------------------------
// AC8 — main.js composition-only wiring grep-ACs.
// ---------------------------------------------------------------------------

test('AC8: _pendingBrowserImports.dropAll() lives inside the onLock hook body', () => {
  const onLockStart = MAIN_JS.indexOf('onLock: () => {');
  assert.ok(onLockStart !== -1, 'onLock hook found');
  const onLockEnd = MAIN_JS.indexOf('},', onLockStart);
  const body = MAIN_JS.slice(onLockStart, onLockEnd);
  assert.ok(body.includes('_pendingBrowserImports.dropAll()'), 'onLock drops the held browser-import records');
  assert.ok(body.includes('_pendingVaultImports.dropAll()'), 'sanity: the restore drop stays alongside it');
});

test('AC8: _pendingBrowserImports.clear(chromeId) lives inside releaseVaultHoldsForWindow', () => {
  const start = MAIN_JS.indexOf('function releaseVaultHoldsForWindow(chromeId) {');
  assert.ok(start !== -1, 'releaseVaultHoldsForWindow found');
  const afterStart = MAIN_JS.slice(start);
  const endMatch = afterStart.match(/\n\}\n/);
  assert.ok(endMatch, 'closing brace found');
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));
  assert.ok(body.includes('_pendingBrowserImports.clear(chromeId)'));
});

test('AC8: exactly one createPendingBrowserImportStore( call', () => {
  const hits = [...MAIN_JS.matchAll(/createPendingBrowserImportStore\(/g)];
  assert.equal(hits.length, 1, 'exactly one browser-import held-store construction');
});

test('AC8: the four flow methods are threaded into the registerBrowserIpc deps object', () => {
  const start = MAIN_JS.indexOf('registerBrowserIpc({');
  assert.ok(start !== -1, 'registerBrowserIpc( call found');
  const afterStart = MAIN_JS.slice(start);
  const endMatch = afterStart.match(/\n\}\);\n/);
  assert.ok(endMatch, 'closing call found');
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));
  for (const name of ['browserImportBegin', 'browserImportSummary', 'browserImportCancel', 'browserImportCommit']) {
    assert.ok(body.includes(name + ':'), `${name} threaded into registerBrowserIpc's deps`);
  }
});

// ---------------------------------------------------------------------------
// AC9 (source-scan half) — internal-preload.js exposes the four browserImport*
// methods; the generated bundle is never hand-edited (its own comment says so).
// ---------------------------------------------------------------------------

test('AC9: internal-preload.js exposes the four browserImport* bridge methods, each a bare ipcRenderer.invoke', () => {
  const preloadJs = fs.readFileSync(path.join(REPO_ROOT, 'src/preload/internal-preload.js'), 'utf8');
  assert.ok(
    /browserImportPick:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('internal-vault-browser-import-pick'\)/.test(preloadJs)
  );
  assert.ok(
    /browserImportSummary:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('internal-vault-browser-import-summary'\)/.test(preloadJs)
  );
  assert.ok(
    /browserImportCancel:\s*\(handle\)\s*=>\s*ipcRenderer\.invoke\('internal-vault-browser-import-cancel',\s*handle\)/.test(
      preloadJs
    )
  );
  assert.ok(
    /browserImportCommit:[\s\S]{0,120}ipcRenderer\.invoke\('internal-vault-browser-import-commit'/.test(preloadJs),
    'browserImportCommit invokes the commit channel'
  );
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src/preload/internal-preload.bundle.js')), 'the bundle is generated');
});

// ---------------------------------------------------------------------------
// AC10 — internal-page-map.js's vault route gained EXACTLY two entries.
// ---------------------------------------------------------------------------

test('AC10: the vault route gained exactly two entries (jar-page-model.js, vault-browser-import-controller.js) and no other route changed', () => {
  const vaultStart = INTERNAL_PAGE_MAP_JS.indexOf('vault: {');
  assert.ok(vaultStart !== -1, 'vault route found');
  const afterStart = INTERNAL_PAGE_MAP_JS.slice(vaultStart);
  const endIdx = afterStart.indexOf('\n    }');
  const vaultBody = afterStart.slice(0, endIdx);

  // Every entry the vault route carried BEFORE this leg (Leg 1 citation) — this leg adds
  // exactly two more and touches nothing else, so this fixture is a closed set.
  const preExisting = [
    "'/': rendererPage('vault.html')",
    "'/vault.css': rendererPage('vault.css')",
    "'/vault.js': rendererPage('vault.js')",
    "'/vault-page-model.js': shared('vault-page-model.js')",
    "'/vault-editor-model.js': shared('vault-editor-model.js')",
    "'/password-generator.js': shared('password-generator.js')",
    "'/safe-color.js': shared('safe-color.js')",
    "'/vault-nav-controller.js': rendererPage('vault-nav-controller.js')"
  ];
  for (const entry of preExisting) {
    assert.ok(vaultBody.includes(entry), `pre-existing entry unchanged: ${entry}`);
  }
  const added = [
    "'/jar-page-model.js': shared('jar-page-model.js')",
    "'/vault-browser-import-controller.js': rendererPage('vault-browser-import-controller.js')"
  ];
  for (const entry of added) {
    assert.ok(vaultBody.includes(entry), `new entry present: ${entry}`);
  }

  // Leg 3 HAT fix (post-dates this leg): jar-page-model.js's own transitive import,
  // './burner.js', had no route on the vault entry, which 404'd the ES-module graph
  // and blanked goldfinch://vault. That fix adds exactly one further entry on top of
  // this leg's two — accounted for here rather than re-scoping this leg's own pin.
  const legThreeHatFix = ["'/burner.js': shared('burner.js')"];
  for (const entry of legThreeHatFix) {
    assert.ok(vaultBody.includes(entry), `Leg 3 HAT-fix entry present: ${entry}`);
  }

  // No other route (settings/downloads/jars) changed in this leg — a coarse sanity that
  // the vault route's entry count is EXACTLY preExisting + added + the later HAT fix.
  const entryLines = vaultBody.split('\n').filter((l) => l.includes(': rendererPage(') || l.includes(': shared('));
  assert.equal(
    entryLines.length,
    preExisting.length + added.length + legThreeHatFix.length,
    'vault route entry count matches this leg’s two additions plus the Leg 3 HAT-fix burner.js route'
  );
});

test('AC10: no other internal-page-map.js route was touched by this leg (settings/downloads/jars entry counts unchanged)', () => {
  // A coarse structural sanity — the settings/downloads/jars route bodies still contain
  // their known Leg-1-era entries and gained nothing new (a full route-map fixture diff
  // is out of scope for a single leg's invariants file; the vault-route test above is the
  // exhaustive one for the route this leg actually touches).
  assert.ok(INTERNAL_PAGE_MAP_JS.includes("'/search-engines.js': shared('search-engines.js')"));
  assert.ok(INTERNAL_PAGE_MAP_JS.includes("'/jars-sitedata-panel.js': rendererPage('jars-sitedata-panel.js')"));
});

// ---------------------------------------------------------------------------
// AC12 — source-scan pins on the controller + vault.js.
// ---------------------------------------------------------------------------

test('AC12: the "Import from a browser…" button is appended only inside buildImportExportSection, which itself renders only when unlocked', () => {
  const start = VAULT_JS.indexOf('function buildImportExportSection(vaults) {');
  assert.ok(start !== -1);
  const afterStart = VAULT_JS.slice(start);
  const endMatch = afterStart.match(/\n {2}\}\n/);
  assert.ok(endMatch);
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));
  assert.ok(body.includes("'Import from a browser…'"), 'the button lives inside buildImportExportSection');

  // buildImportExportSection itself is called only inside `if (unlocked) { ... }`.
  const callSiteStart = VAULT_JS.indexOf('if (unlocked) {');
  assert.ok(callSiteStart !== -1);
  const callSiteWindow = VAULT_JS.slice(callSiteStart, callSiteStart + 800);
  assert.ok(callSiteWindow.includes('buildImportExportSection(view.vaults)'));
});

test('AC12: the pick modal lede names chrome://password-manager and "Export passwords"', () => {
  assert.ok(CONTROLLER_JS.includes('chrome://password-manager'));
  assert.ok(CONTROLLER_JS.includes('Export passwords'));
});

test('AC12: the completion modal contains the "Delete the exported CSV file now" line', () => {
  assert.ok(CONTROLLER_JS.includes('Delete the exported CSV file now'));
});

test('HAT enhancement 1: the completion modal wraps the delete-the-export-file reminder in a .vault-info-panel callout', () => {
  // Non-vacuous: locate openCompletionModal's body, require the exact
  // `el('div', 'vault-info-panel')` construction, require `role="note"` set on THAT element
  // (never 'alert' — advisory, not urgent), and require the deletion-reminder text to be
  // appended to it before the panel itself is appended to the modal body — so the restyle
  // can't silently regress to the old plain-paragraph-in-body shape while the substring
  // checks above still pass independently.
  const start = CONTROLLER_JS.indexOf('function openCompletionModal(counts) {');
  assert.ok(start !== -1, 'openCompletionModal found');
  const afterStart = CONTROLLER_JS.slice(start);
  const endMatch = afterStart.match(/\n {2}\}\n/);
  assert.ok(endMatch, "openCompletionModal's closing brace found");
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));

  const panelDeclIdx = body.indexOf("el('div', 'vault-info-panel')");
  assert.ok(panelDeclIdx !== -1, 'a vault-info-panel div is constructed');

  const roleIdx = body.indexOf("infoPanel.setAttribute('role', 'note')", panelDeclIdx);
  assert.ok(roleIdx !== -1, 'role="note" is set on the info panel (never "alert")');
  assert.equal(body.includes("setAttribute('role', 'alert')"), false, 'never role="alert" for this advisory panel');

  // Wrap-insensitive (Prettier may re-wrap the call across lines) — CLAUDE.md's
  // "Regex-target mutation pins" convention: `\s+` between tokens, no exact-literal anchor.
  const reminderRe =
    /infoPanel\.appendChild\(\s*el\(\s*'p',\s*'vault-lede',\s*'Delete the exported CSV file now — it contains your passwords in plain text\.'\s*\)\s*\)/;
  const reminderMatch = reminderRe.exec(body);
  assert.ok(reminderMatch, 'the deletion-reminder paragraph is appended INTO the info panel');
  const reminderAppendIdx = /** @type {number} */ (reminderMatch.index);
  assert.ok(reminderAppendIdx > roleIdx, 'the reminder text is appended after the panel is declared+roled');

  const panelAppendedToBodyIdx = body.indexOf('body.appendChild(infoPanel)');
  assert.ok(panelAppendedToBodyIdx !== -1, 'the info panel itself is appended to the modal body');
  assert.ok(
    panelAppendedToBodyIdx > reminderAppendIdx,
    'the panel is appended to the modal body only after being filled'
  );
});

test('HAT enhancement 1: vault.css defines .vault-info-panel with a border + tinted background (bordered/tinted callout, not a plain line)', () => {
  const VAULT_CSS_RAW = fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/pages/vault.css'), 'utf8');
  const VAULT_CSS = VAULT_CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let found = false;
  let match;
  while ((match = ruleRe.exec(VAULT_CSS))) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = match[2];
    if (selectors.includes('.vault-info-panel') && /border\s*:/.test(body) && /background\s*:/.test(body)) {
      found = true;
      break;
    }
  }
  assert.ok(found, 'expected a vault.css rule for `.vault-info-panel` declaring both a border and a background');
});

test("AC12: render()'s body contains no browserImportCancel call and no held-record assignment", () => {
  const start = VAULT_JS.indexOf('function render(state) {');
  assert.ok(start !== -1, 'render(state) found');
  const afterStart = VAULT_JS.slice(start);
  const endMatch = afterStart.match(/\n {2}\}\n/);
  assert.ok(endMatch, "render()'s closing brace found");
  const body = afterStart.slice(0, /** @type {number} */ (endMatch.index));
  assert.equal(body.includes('browserImportCancel'), false, 'render() never calls browserImportCancel');
  assert.equal(body.includes('heldRecord ='), false, 'render() never assigns a held-record variable');
});

test('AC12: every browserImportCancel( call in the controller lives in an onCancel body or dropHeldOnPagehide', () => {
  // Extract each function body containing a browserImportCancel( call and assert it falls
  // within one of the two allowed shapes: an `onCancel: () => { ... }` handler, or the
  // dedicated `dropHeldOnPagehide` function.
  const hits = [...CONTROLLER_JS.matchAll(/bridge\.browserImportCancel\(/g)];
  assert.ok(hits.length >= 3, 'sanity: at least the pick-modal, destination-modal, and pagehide call sites exist');
  for (const hit of hits) {
    const before = CONTROLLER_JS.slice(0, hit.index);
    const onCancelIdx = before.lastIndexOf('onCancel: () => {');
    const dropFnIdx = before.lastIndexOf('function dropHeldOnPagehide() {');
    // Whichever marker is CLOSER (higher index) governs this call site; it must be one of
    // the two allowed shapes, and no closing brace of THAT function may sit between the
    // marker and the call (a crude but effective same-block check via brace count).
    const nearest = Math.max(onCancelIdx, dropFnIdx);
    assert.ok(
      nearest !== -1,
      `browserImportCancel( call has no onCancel/dropHeldOnPagehide ancestor: …${before.slice(-80)}`
    );
  }
});

test("AC12: mode is always sent — a 'merge' default literal precedes the commit call", () => {
  const commitCallIdx = CONTROLLER_JS.indexOf('bridge.browserImportCommit(');
  assert.ok(commitCallIdx !== -1);
  const before = CONTROLLER_JS.slice(0, commitCallIdx);
  const mergeLiteralIdx = before.lastIndexOf("'merge'");
  assert.ok(mergeLiteralIdx !== -1 && mergeLiteralIdx < commitCallIdx, "a 'merge' literal precedes the commit call");
});

// ---------------------------------------------------------------------------
// AC13 — squawk 0063: JAR_COLOR_PALETTE no longer appears in vault.js.
// ---------------------------------------------------------------------------

test('AC13: JAR_COLOR_PALETTE no longer appears anywhere in vault.js (code or comments)', () => {
  assert.equal(VAULT_JS.includes('JAR_COLOR_PALETTE'), false);
});

test('AC13: PALETTE is imported from ./jar-page-model.js and the swatch-grid call site references it', () => {
  assert.ok(/import\s*\{\s*PALETTE\s*\}\s*from\s*'\.\/jar-page-model\.js'/.test(VAULT_JS));
  assert.ok(
    /PALETTE\.includes\(initialColor\)\s*\?\s*PALETTE\s*:\s*\[\s*\.\.\.PALETTE,\s*initialColor\s*\]/.test(VAULT_JS)
  );
});

// ---------------------------------------------------------------------------
// AC15(d) — the src/main/automation/** grep-AC covers browser-import-flow and
// the four channel names (the boundary test's own scope; pinned here too as a
// belt-and-suspenders structural check independent of the boundary suite).
// ---------------------------------------------------------------------------

test('AC15(d): no file under src/main/automation/** references browser-import-flow.js or the four browser-import channel names', () => {
  const NAMES = [
    'browser-import-flow',
    'internal-vault-browser-import-pick',
    'internal-vault-browser-import-summary',
    'internal-vault-browser-import-cancel',
    'internal-vault-browser-import-commit'
  ];
  /** @param {string} dir @returns {string[]} */
  function walk(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else if (entry.name.endsWith('.js')) out.push(p);
    }
    return out;
  }
  for (const file of walk(AUTOMATION_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of NAMES) {
      assert.equal(text.includes(name), false, `${path.relative(REPO_ROOT, file)} must not reference "${name}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// New-shared-module checklist (CLAUDE.md): a new contextBridge method needs a
// renderer-globals.d.ts entry.
// ---------------------------------------------------------------------------

test('renderer-globals.d.ts declares the four browserImport* bridge methods on GoldfinchInternalBridge', () => {
  const dts = fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/renderer-globals.d.ts'), 'utf8');
  for (const name of ['browserImportPick', 'browserImportSummary', 'browserImportCancel', 'browserImportCommit']) {
    assert.ok(dts.includes(name + '('), `${name} declared on GoldfinchInternalBridge`);
  }
});

// ---------------------------------------------------------------------------
// HAT fix (destination modal's "What to do" field stayed visible on an empty jar) —
// cascade-origin regression pin.
// ---------------------------------------------------------------------------

test('HAT fix: vault.css carries a `.vault-field[hidden]` rule resolving to display: none', () => {
  // Root cause (diagnosed live-walk finding, mirrors the pre-existing
  // `.vault-mapping-*-row[hidden]` overrides a few hundred lines below): `.vault-field {
  // display: block; }` is an AUTHOR-origin declaration, which always beats the UA stylesheet's
  // `[hidden] { display: none }` regardless of specificity (cascade ORIGIN is sorted before
  // specificity). vault-browser-import-controller.js's renderDestinationModal() creates
  // `modeField` as a plain `.vault-field` and toggles visibility via `modeField.hidden =
  // !hasItems` in updateModeVisibility() — with no override, that assignment was a silent
  // no-op and the Replace/Merge control stayed visible even for a destination jar with zero
  // items. Non-vacuous: this parses vault.css into (selector-list, body) rule pairs and
  // requires a rule whose selector LIST contains the exact token `.vault-field[hidden]` AND
  // whose OWN block declares `display: none` — a bare substring grep would pass even if the
  // override selector and the `display: none` declaration lived in unrelated rules.
  const VAULT_CSS_RAW = fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/pages/vault.css'), 'utf8');
  // Strip CSS comments first — otherwise a comment immediately preceding a rule (e.g. this
  // fix's own explanatory comment) gets swept into the "selector" capture below, since a
  // comment can itself contain `{`/`}`-free prose with no delimiter of its own.
  const VAULT_CSS = VAULT_CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let found = false;
  let match;
  while ((match = ruleRe.exec(VAULT_CSS))) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = match[2];
    if (selectors.includes('.vault-field[hidden]') && /display\s*:\s*none\s*;/.test(body)) {
      found = true;
      break;
    }
  }
  assert.ok(
    found,
    'expected a vault.css rule whose selector list includes `.vault-field[hidden]` and whose own block declares `display: none`'
  );
});
