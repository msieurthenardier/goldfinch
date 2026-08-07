'use strict';

// M15 Flight 3 "Drag Interactions" Leg 5a — the SHEET half of bar → overflow.
//
// The overflow sheet's drop target, its placement indicator, and the boundaries
// that keep both of them where they belong. These are source-scan / CSS-scan
// invariants rather than behavioural tests, and deliberately so: the sheet is a
// separate `WebContentsView` document with no offline harness in this repo, and
// every one of the properties below is a STRUCTURAL claim about where code and
// styles are attached — exactly the shape the repo's Grep-AC convention covers.
// The rendered behaviour (does the line land between the right two rows, does
// the gesture feel right) is operator-verified at HAT.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments } = require('../helpers/source-scan.js');

const ROOT = path.join(__dirname, '../..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readMasked = (...p) => maskComments(read(...p));

const SHEET_JS = 'src/renderer/menu-overlay.js';
const SHEET_CSS = 'src/renderer/menu-overlay.css';

// ---------------------------------------------------------------------------
// AC1 — a drop target, and (Leg 5b) a drag SOURCE.
//
// ⚠ PREMISE SHIFT, RE-TARGETED RATHER THAN DELETED. Until operator session 4
// this test asserted the OPPOSITE half — that `menu-overlay.js` contains no
// `draggable` and no `dragstart` — because the sheet → chrome transport had
// never been measured and leg 5b did not yet exist. Session 4 measured it (54
// `dragover` / 1 `drop` on the chrome, custom MIME intact, and the sheet does
// receive its own `dragend`), so the claim inverts: the source must now exist,
// and must be GATED, which is what the assertions below have become.
// ---------------------------------------------------------------------------

test('AC1: the sheet is a drop target AND (Leg 5b) a gated drag source', () => {
  const code = readMasked(SHEET_JS);
  assert.match(code, /addEventListener\('drop'/, 'the drop target exists');
  assert.match(code, /addEventListener\('dragover'/, 'and its dragover, without which drop is never dispatched');
  assert.match(code, /btn\.draggable = true/, 'Leg 5b: sheet rows are drag sources — the transport is measured');
  assert.match(code, /addEventListener\('dragstart'/, 'and the source arms a real session');
  // Both affordances live in ONE function, reached from ONE gated call site, so
  // there is a single place to audit rather than a scattering of `draggable`s.
  const attach = code.slice(code.indexOf('function attachOverflowDragSource'));
  assert.match(attach.slice(0, attach.indexOf('\n  }\n')), /btn\.draggable = true/);
  assert.equal((code.match(/\.draggable = /g) || []).length, 1,
    'exactly one place in the sheet ever makes a node draggable');
});

test('AC1 (Leg 5b): the drag source is gated to `bookmarks-overflow` — renderMenu serves five menuTypes', () => {
  const code = readMasked(SHEET_JS);
  // The one call site, behind the SAME named predicate the drop target uses. An
  // ungated `draggable = true` here would make every kebab / container /
  // page-context / tab-context row in the app a drag source.
  assert.match(code, /if \(isOverflowMenu\(\)\) attachOverflowDragSource\(btn, item\.id\);/);
  assert.equal((code.match(/attachOverflowDragSource\(/g) || []).length, 2,
    'one definition, one call site — nothing may attach it by another route');
  // …and that call site is nested inside the pre-existing bookmarks-overflow
  // row branch, so the row-id family is gated too (a `sug:`/`tab:` id can never
  // reach it).
  const rowBranch = code.indexOf("if (menuType === 'bookmarks-overflow' && item.id.startsWith('bookmark:'))");
  assert.notEqual(rowBranch, -1);
  assert.ok(code.indexOf('attachOverflowDragSource(btn, item.id)') > rowBranch,
    'the drag source attaches inside the bookmarks-overflow row branch');
});

test('AC2 (Leg 5b): the sheet-sourced payload carries the SNAPSHOT INDEX — no id, no url', () => {
  const code = readMasked(SHEET_JS);
  const attach = code.slice(code.indexOf('function attachOverflowDragSource'));
  const body = attach.slice(0, attach.indexOf('\n  }\n'));
  assert.match(body, /dt\.setData\(BOOKMARK_DND_MIME, String\(index\)\)/,
    'the custom type carries the snapshot index — the sheet is a dumb renderer and knows no id (DD9)');
  // The recorded asymmetry, pinned so it cannot be quietly half-fixed: an
  // overflow-sourced drag populates NEITHER standard type, so dragging a row out
  // of the menu onto a PAGE (leg 4's path) does nothing. Bar-sourced drags still
  // carry all three.
  assert.equal(/text\/uri-list|text\/plain/.test(body), false,
    'AC2: no url types from the sheet — that is the decision, and its cost');
  assert.match(readMasked('src/renderer/chrome/bookmarks-bar.js'), /dt\.setData\('text\/uri-list'/,
    'the BAR source is unaffected — it still carries the url for DD5\'s page-wins case');
});

test('AC3 (Leg 5b): the lifecycle signals ride their own channel, and the token is captured at dragstart', () => {
  const code = readMasked(SHEET_JS);
  const attach = code.slice(code.indexOf('function attachOverflowDragSource'));
  const body = attach.slice(0, attach.indexOf('\n  }\n'));
  assert.match(body, /window\.menuOverlay\.sheetDrag\?\.\(\{ token, phase: 'start', index \}\)/);
  assert.match(body, /window\.menuOverlay\.sheetDrag\?\.\(\{ token, phase: 'end' \}\)/);
  assert.equal(/sendActivatedOnce|sendActivated|overflowDrop/.test(body), false,
    'a drag lifecycle is not an activation and not a drop report — three separate concerns, three channels');
  // ⚠ The token MUST be captured at dragstart: the sheet is blur-closed the
  // instant the drag begins and main's close-reset runs report.silence(), so
  // `report.token` is already null by dragend. Re-reading it there would send an
  // `end` the chrome could never match, leaving the bar latched until the timer.
  assert.match(body, /const token = dragToken;/);
  assert.match(readMasked('src/preload/menu-overlay-preload.js'),
    /sheetDrag: \(payload\) => ipcRenderer\.send\('menu-overlay:sheet-drag', payload\)/);
});

// ---------------------------------------------------------------------------
// AC3a — gating. `renderMenu` is shared by FIVE menuTypes.
// ---------------------------------------------------------------------------

test('AC3a: every sheet-side drag affordance is gated to `bookmarks-overflow`', () => {
  const code = readMasked(SHEET_JS);
  // The gate is a single named predicate, so the three handlers cannot drift
  // apart the way five separately-written conditions would.
  assert.match(code, /isOverflowMenu\s*=\s*\(\)\s*=>\s*menuNode\.dataset\.menuType === 'bookmarks-overflow'/,
    'one gate, reading the menuType renderMenu itself stamps');
  // …and it is consulted before anything else happens, in the shared helper both
  // handlers call.
  const gateBody = /function overflowDragEvent\(e\) \{\s*if \(!isOverflowMenu\(\)\) return null;/;
  assert.match(code, gateBody,
    'the menuType check is the FIRST thing the shared drag gate does — kebab / container / ' +
    'page-context / tab-context must never acquire a drop target');
  // The MIME half: without it the sheet preventDefaults every drag crossing it,
  // including native file and link drags (the DD2 mistake, guest-side).
  assert.match(code, /types\.includes\(BOOKMARK_DND_MIME\)/);
  assert.match(code, /import \{[^}]*BOOKMARK_DND_MIME[^}]*\} from '\.\.\/shared\/bookmark-drag\.js'/,
    'the MIME literal is imported, never re-typed');
});

test('AC3a: the indicator is parented to #menu-root, NOT to the menu node renderMenu wipes', () => {
  const code = readMasked(SHEET_JS);
  assert.match(code, /overflowIndicator\.className = 'sheet-drop-indicator hidden';\s*root\.appendChild\(overflowIndicator\);/,
    'renderMenu opens with `menuNode.textContent = \'\'`, so an indicator inside #sheet-menu ' +
    'is wiped on every render — it must hang off #menu-root');
  assert.equal(/menuNode\.appendChild\(overflowIndicator\)/.test(code), false);
  // …and renderMenu retracts it, since the rows it pointed between are gone.
  assert.match(code, /menuNode\.textContent = '';\s*hideOverflowIndicator\(\);/);
});

test('AC3a: #sheet-menu keeps `position: absolute` — adding `relative` would break positionNode', () => {
  const css = read(SHEET_CSS);
  const rule = css.slice(css.indexOf('#sheet-menu {'), css.indexOf('}', css.indexOf('#sheet-menu {')));
  assert.ok(rule.length > 0, '#sheet-menu must exist');
  assert.match(rule, /position:\s*absolute/, 'it is ALREADY absolute — leg 3 needed to ADD relative to its container, this one must not');
  assert.equal(/position:\s*relative/.test(rule), false,
    'positionNode writes inline left/right/top on this node; a relative containing block would re-base them');
});

test('AC3: the indicator is out of flow and never animates', () => {
  const css = read(SHEET_CSS);
  const start = css.indexOf('.sheet-drop-indicator {');
  assert.notEqual(start, -1, 'the indicator rule must exist');
  const rule = css.slice(start, css.indexOf('}', start));
  // Out of flow is the load-bearing property (leg 3's lesson, other axis): an
  // indicator IN the row flow moves the rows, invalidating the geometry the drop
  // index was computed against.
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /pointer-events:\s*none/, 'it must never eat the dragover it exists to visualise');
  assert.match(rule, /transition:\s*none/);
  assert.match(rule, /animation:\s*none/);
});

// ---------------------------------------------------------------------------
// AC3 — the y-axis math is the PURE module's, not hand-rolled in the sheet.
// ---------------------------------------------------------------------------

test('AC3: the sheet delegates its drop-index and indicator geometry to the pure module', () => {
  const code = readMasked(SHEET_JS);
  assert.match(code, /import \{[^}]*overflowDropIndexY[^}]*\} from '\.\.\/shared\/bookmark-drag\.js'/);
  assert.match(code, /import \{[^}]*overflowIndicatorY[^}]*\} from '\.\.\/shared\/bookmark-drag\.js'/);
  // No inline midpoint arithmetic, on either axis. This is the exact shape both
  // prior debriefs name as this codebase's recurring defect source: a
  // hand-mirrored pair with no differential test.
  assert.equal(/height \/ 2|width \/ 2/.test(code), false,
    'the midpoint rule must not be re-derived in the sheet — it is imported (via overflowDropIndexY)');
});

// ---------------------------------------------------------------------------
// AC8 — the channel, and the one thing it must NOT be.
// ---------------------------------------------------------------------------

test('AC8: the drop index rides its OWN channel, never channel-4 sendActivated', () => {
  const code = readMasked(SHEET_JS);
  assert.match(code, /window\.menuOverlay\.overflowDrop\?\.\(\{ token, index \}\)/,
    'the dedicated channel carries the index and the open token, and nothing else');
  // ⚠ channel 4 is disqualified by a SIDE EFFECT, not by payload size:
  // `menu-overlay:activated` closes the sheet AND dispatches — and for a
  // `bookmark:<i>` id that dispatch NAVIGATES the current tab.
  const dropHandler = code.slice(code.indexOf("menuNode.addEventListener('drop'"));
  const body = dropHandler.slice(0, dropHandler.indexOf('\n  });'));
  assert.equal(/sendActivatedOnce|sendActivated/.test(body), false,
    'a drop is not an activation: channel 4 would navigate the tab and consume the one-report-per-token budget');
  assert.match(readMasked('src/preload/menu-overlay-preload.js'),
    /overflowDrop: \(payload\) => ipcRenderer\.send\('menu-overlay:overflow-drop', payload\)/);
});

test('AC8b: the main-side handler names all THREE guards, the menuType one included', () => {
  const code = readMasked('src/main/register-overlay-ipc.js');
  const start = code.indexOf("ipcMain.on('menu-overlay:overflow-drop'");
  assert.notEqual(start, -1);
  const body = code.slice(start, code.indexOf('\n  });', start));
  assert.match(body, /recordForSheetSender\(event\.sender\)/, 'guard 1 — sender identity');
  assert.match(body, /token !== current\.token/, 'guard 2 — open-token freshness');
  assert.match(body, /current\.menuType !== 'bookmarks-overflow'/,
    'guard 3 — WITHOUT THIS a drop index is accepted while vault-unlock is on screen. ' +
    'This flight has recorded four findings of exactly that shape; the predicate is named, not inherited.');
});

// ---------------------------------------------------------------------------
// AC9 — no double-handling. Asserted rather than guarded, per the AC.
// ---------------------------------------------------------------------------

test('AC9: the three drop surfaces have three separate handlers in three separate documents', () => {
  // Bar (chrome document), guest (page main world), sheet (overlay document) are
  // three distinct WebContentsViews, so one release can only ever be dispatched
  // into one of them. The structural claim is that no file registers a drop
  // handler for a surface it does not own.
  const bar = readMasked('src/renderer/chrome/bookmarks-bar.js');
  const guest = readMasked('src/preload/webview-preload.js');
  const sheet = readMasked(SHEET_JS);

  assert.match(bar, /document\.addEventListener\('drop'/, 'the bar owns the CHROME document');
  assert.equal(/menuNode|sheet-menu|menu-overlay/.test(bar), false,
    'the bar must not reach into the sheet\'s DOM — its only channel to the sheet is overlayMenuClient');

  assert.match(guest, /window\.addEventListener\('drop', bookmarkDrop\.handleDrop\)/,
    'the guest preload owns the PAGE\'s own window');
  assert.equal(/menuNode|sheet-menu/.test(guest), false);

  assert.match(sheet, /menuNode\.addEventListener\('drop'/, 'the sheet owns its own menu node — and ONLY that node');
  assert.equal(/document\.addEventListener\('drop'/.test(sheet), false,
    'a document-wide sheet drop handler would claim the whole guest region for the overflow menu');
});
