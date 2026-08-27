'use strict';

// M15 Flight 3 Leg 1 — source-scan invariants for the menu-overlay sheet's automation gate.
//
// Three things this leg depends on that no runtime unit test in this repo can reach:
//
//   AC7 — captureWindow's SHEET LAYER (src/main/main.js) is gated on the same menuType
//         allowlist the resolver uses, and its post-await TOCTOU re-check re-evaluates the
//         menuType and not only isVisible(). NO TEST IN THIS REPO LOADS main.js
//         (test/helpers/source-scan.js says so outright), so this is a scan, not a unit test.
//   AC8 — the CO-RESIDENCY PREMISE that makes admitting readDom on the sheet sound: the three
//         one-time-secret cards scrub their own textContent in their onClose bodies, and
//         onInit's pre-scrub early-return set is ENUMERATED so a new early return added ahead
//         of the scrub fails here. src/renderer/menu-overlay.js is a 2400-line ESM page script
//         with 17 top-level imports and preload-bridge access; the repo tests only its pure
//         template builders (vault-accesskey-template.test.js states that gap outright).
//   AC9 — sheetMenuFor is wired at BOTH createEngine sites. The fallback is SILENT (absent →
//         the sheet is simply refused), so a half-wired seam produces no test failure
//         anywhere — the house dual-site grep-pin convention (engine.js's listWindows note).
//
// Toolkit: test/helpers/source-scan.js — maskComments preserves offsets, so prose in the
// (extensive) comments around these subjects can neither trip nor satisfy a scan. Precedent
// for "assert X sits inside Y's body": latch-ordering-invariant.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');
const { AUTOMATABLE_MENU_TYPES } = require('../../src/main/automation/resolve');

const SRC = path.join(__dirname, '..', '..', 'src');

/** @param {string[]} parts */
function readMasked(...parts) {
  return maskComments(fs.readFileSync(path.join(SRC, ...parts), 'utf8'));
}

// ---------------------------------------------------------------------------
// AC7 — captureWindow's sheet layer (DD1c)
// ---------------------------------------------------------------------------

test('AC7: captureWindow gates its sheet layer on the SAME menuType allowlist the resolver uses', () => {
  const masked = readMasked('main', 'main.js');

  // Vacuity guard: the subject must exist. A rename/refactor fails loudly here rather than
  // letting the pin pass on a missing subject.
  assert.ok(
    /grabRec\.sheet\s*&&\s*grabRec\.sheet\.isVisible\(\)/.test(masked),
    'main.js must still compute sheetView from the visible sheet of the grabbed record'
  );

  // The allowlist is IMPORTED from the resolver, never re-typed as string literals — the two
  // predicates must be the same object, or a pixel read stays open on a surface a DOM read
  // is refused (which is exactly the pre-existing gap DD1c closes).
  assert.ok(/require\(['"]\.\/automation\/resolve['"]\)/.test(masked), 'main.js requires the resolver');
  assert.ok(/AUTOMATABLE_MENU_TYPES/.test(masked), 'main.js references the imported allowlist');
  for (const menuType of AUTOMATABLE_MENU_TYPES) {
    assert.ok(
      !masked.includes("'" + menuType + "'"),
      'main.js must not re-type the allowlisted menuType ' + menuType + ' as a literal'
    );
  }

  // The gate must use the registry's sheetMenuFor reader (which itself returns null on a
  // hidden sheet) against the SHEET's webContents.
  assert.ok(/registry\.sheetMenuFor\(/.test(masked), 'the sheet layer must consult registry.sheetMenuFor');

  // Both call sites: the pre-capture gate AND the post-await re-check.
  const admittedCalls = (masked.match(/AUTOMATABLE_MENU_TYPES\.has\(/g) || []).length;
  assert.ok(admittedCalls >= 1, 'the allowlist is consulted in main.js');
});

test("AC7: the sheet layer's post-await TOCTOU re-check re-evaluates the menuType, not only isVisible()", () => {
  const masked = readMasked('main', 'main.js');

  // Locate the post-await re-check by its subject and extract the whole condition. The old
  // condition tested only detachment; a capture that starts under an allowlisted menu and is
  // MODEL-REPLACED by vault-unlock mid-capture must not composite the vault pixels.
  const idx = masked.indexOf('!grabRec.sheet || !grabRec.sheet.isVisible()');
  assert.notEqual(idx, -1, "the sheet layer's post-await re-check must still exist");
  const lineEnd = masked.indexOf('\n', idx);
  const condition = masked.slice(idx, lineEnd);
  assert.ok(
    /sheetMenuAdmitted|AUTOMATABLE_MENU_TYPES|sheetMenuFor/.test(condition),
    "the post-await re-check must ALSO re-evaluate the sheet's current menuType — " +
      'an isVisible()-only re-check leaves the TOCTOU that DD1c exists to close'
  );
});

// ---------------------------------------------------------------------------
// AC8 (DD1e) — the co-residency premise
// ---------------------------------------------------------------------------

/**
 * Extract the body of the `onClose() { … }` method that ENCLOSES `needleIdx`, or null.
 * Walks backwards to the nearest preceding `onClose() {` and checks the needle is inside
 * its matching brace.
 * @param {string} masked
 * @param {number} needleIdx
 */
function enclosingOnCloseBody(masked, needleIdx) {
  const head = masked.lastIndexOf('onClose() {', needleIdx);
  if (head === -1) return null;
  const braceOpen = masked.indexOf('{', head);
  const braceClose = findMatchingBracket(masked, braceOpen, '{', '}');
  if (braceClose === -1 || needleIdx > braceClose) return null;
  return masked.slice(braceOpen + 1, braceClose);
}

test('AC8: each one-time-secret card clears its own textContent INSIDE an onClose() body', () => {
  const masked = readMasked('renderer', 'menu-overlay.js');

  const scrubs = [
    "recovery.keyValue.textContent = ''", // vault-recovery-show
    "accessKey.secretValue.textContent = ''", // vault-accesskey-show
    "adminKey.keyValue.textContent = ''" // vault-adminkey-show
  ];
  for (const scrub of scrubs) {
    const idx = masked.indexOf(scrub);
    assert.notEqual(idx, -1, 'the scrub `' + scrub + '` must exist in menu-overlay.js');
    assert.equal(masked.indexOf(scrub, idx + 1), -1, 'exactly one occurrence of `' + scrub + '`');
    const body = enclosingOnCloseBody(masked, idx);
    assert.ok(
      body !== null,
      '`' +
        scrub +
        '` must sit inside an onClose() body — a scrub that runs anywhere else ' +
        'does not fire on the close paths that matter (menuController.closeAll runs onClose)'
    );
  }
});

test("AC8: onInit's pre-scrub early-return set is ENUMERATED — a new early return before the scrub fails here", () => {
  const masked = readMasked('renderer', 'menu-overlay.js');

  // Extract onInit's callback body.
  const head = masked.indexOf('window.menuOverlay.onInit(');
  assert.notEqual(head, -1, 'the onInit registration must exist');
  const argOpen = masked.indexOf('(', head);
  const argClose = findMatchingBracket(masked, argOpen, '(', ')');
  assert.notEqual(argClose, -1, 'the onInit argument list must close');
  const bodyOpen = masked.indexOf('{', argOpen);
  const bodyClose = findMatchingBracket(masked, bodyOpen, '{', '}');
  assert.notEqual(bodyClose, -1, 'the onInit callback body must close');
  const body = masked.slice(bodyOpen + 1, bodyClose);

  // The lazy scrub still runs at the top of every RENDER (report.silence() then closeAll()).
  const scrubIdx = body.indexOf('menuController.closeAll()');
  assert.notEqual(scrubIdx, -1, 'onInit must still scrub before rendering');
  assert.ok(body.indexOf('report.silence()') < scrubIdx, 'silence() precedes closeAll()');

  // ENUMERATED, not ordinal. An ordinal "closeAll precedes render" scan would codify an
  // invariant the file already sidesteps: the `downloads` fast path returns BEFORE the scrub
  // (benign today — downloads→downloads, same template, and DD1f now scrubs at close time
  // anyway). What must not happen silently is a NEW pre-scrub return being added.
  const preScrub = body.slice(0, scrubIdx);
  const returns = (preScrub.match(/\breturn\b/g) || []).length;
  assert.equal(
    returns,
    3,
    "onInit's pre-scrub early-return set changed. The three known returns are: (1) the " +
      'menuType/token shape guard, (2) the !modelShapeOk guard, (3) the in-place `downloads` ' +
      "fast path. If you added a fourth, confirm it cannot render or expose a prior menu's " +
      'DOM, then update this count deliberately.'
  );

  // The three known returns, by their subjects — so a swap that keeps the COUNT still fails.
  assert.ok(
    /typeof menuType !== 'string' \|\| typeof token !== 'number'/.test(preScrub),
    'return 1: the menuType/token shape guard'
  );
  assert.ok(/if \(!modelShapeOk\) return;/.test(preScrub), 'return 2: the model-shape guard');
  assert.ok(
    /template === 'downloads' && menuController\.current === downloadsEntry/.test(preScrub),
    'return 3: the in-place downloads fast path'
  );
});

test('AC8/DD1f: the sheet registers the EAGER close/reset scrub, and it runs silence() then closeAll()', () => {
  const masked = readMasked('renderer', 'menu-overlay.js');
  const head = masked.indexOf('window.menuOverlay.onCloseReset(');
  assert.notEqual(
    head,
    -1,
    "the sheet must subscribe to main's close/reset channel — without it the DOM is only " +
      'scrubbed lazily at the next open, which is the window DD1f exists to remove'
  );
  const argOpen = masked.indexOf('(', head);
  const argClose = findMatchingBracket(masked, argOpen, '(', ')');
  const handler = masked.slice(argOpen, argClose);
  const silence = handler.indexOf('report.silence()');
  const closeAll = handler.indexOf('menuController.closeAll()');
  assert.ok(silence !== -1 && closeAll !== -1, 'the handler runs both halves');
  assert.ok(silence < closeAll, 'silence() must precede closeAll() (a late dismissed would be stale)');

  // <body> data attributes are deliberately NOT cleared — DD8's probe readback depends on
  // its counters surviving the close.
  assert.ok(
    !/document\.body\.(removeAttribute|dataset)/.test(handler),
    'the scrub must not touch <body> data attributes (DD8 probe readback depends on them)'
  );
});

test('DD1f: main sends the close/reset on the close path, and the preload exposes it', () => {
  const manager = readMasked('main', 'menu-overlay-manager.js');
  assert.ok(
    /function deliverCloseReset\(\)/.test(manager),
    'menu-overlay-manager must own a single close/reset emitter'
  );
  assert.ok(/'menu-overlay:close'/.test(manager), 'it sends the menu-overlay:close channel');

  // The emitter must be called from closeMenuOverlay's body — the single close path.
  const head = manager.indexOf('function closeMenuOverlay(');
  assert.notEqual(head, -1, 'closeMenuOverlay must exist');
  const parenOpen = manager.indexOf('(', head);
  const parenClose = findMatchingBracket(manager, parenOpen, '(', ')');
  const bodyOpen = manager.indexOf('{', parenClose);
  const bodyClose = findMatchingBracket(manager, bodyOpen, '{', '}');
  const body = manager.slice(bodyOpen + 1, bodyClose);
  assert.ok(/deliverCloseReset\(\)/.test(body), 'closeMenuOverlay must emit the eager scrub — the whole of DD1f');

  const preload = maskComments(fs.readFileSync(path.join(SRC, 'preload', 'menu-overlay-preload.js'), 'utf8'));
  assert.ok(
    /onCloseReset:/.test(preload) && /'menu-overlay:close'/.test(preload),
    'the sheet preload must expose the close/reset listener'
  );
});

// ---------------------------------------------------------------------------
// AC9 — dual-site engine wiring
// ---------------------------------------------------------------------------

test('AC9: sheetMenuFor is wired at BOTH createEngine sites (silent fallback ⇒ grep-pinned)', () => {
  const sites = [
    ['main', 'main.js'], // the MCP engine
    ['main', 'app-lifecycle.js'] // the automation:dev-invoke seam
  ];
  for (const site of sites) {
    const masked = readMasked(...site);
    assert.ok(/createEngine\(/.test(masked), site.join('/') + ' must construct an engine');
    assert.ok(
      /sheetMenuFor:\s*\(\w+\)\s*=>\s*registry\.sheetMenuFor\(\w+\)/.test(masked),
      site.join('/') +
        " must inject sheetMenuFor — absent, the sheet gate's menuType half " +
        'silently disappears and this engine diverges from its twin with no test failure'
    );
  }
});

test('AC9: engine.js threads sheetMenuFor onto deps by the conditional-spread idiom, and exactly three ops opt in', () => {
  const masked = readMasked('main', 'automation', 'engine.js');
  assert.ok(
    /\.\.\.\(typeof sheetMenuFor === 'function' \? \{ sheetMenuFor \} : \{\}\)/.test(masked),
    'sheetMenuFor rides base by the same conditional-spread idiom as isSheetContents'
  );
  const optIns = (masked.match(/deps\(\{ allowSheet: true \}\)/g) || []).length;
  assert.equal(
    optIns,
    3,
    'EXACTLY three dispatch entries may opt into the sheet (captureScreenshot, readDom, ' +
      "readAxTree). A fourth is a security decision — read resolve.js's guard-3 comment first."
  );
  for (const op of ['captureScreenshot', 'readDom', 'readAxTree']) {
    // Non-greedy but bounded: allows Prettier's arrow-body line wrap onto the
    // next line while a negative lookahead refuses to cross into the NEXT
    // dispatch-table property (`\n<indent>word:`), so this cannot vacuously
    // match a later op's allowSheet opt-in if this op's own is stripped.
    const re = new RegExp(op + ':(?:(?!\\n\\s*\\w+:)[\\s\\S])*?deps\\(\\{ allowSheet: true \\}\\)');
    assert.ok(re.test(masked), op + ' must be one of the three opt-ins');
  }
});
