'use strict';

// Tab-drag source invariants (M09 Flight 8, Leg 3) — a source-scan net in the
// broadcast-invariant.test.js / move-tab-synchrony.test.js house pattern, covering the
// four drag properties this leg's design rests on that have no runtime instrument here:
//
//   AC7  — DD6's cancel-path claim: there are SEVEN cancelDrag() call sites, asserted
//          rather than assumed (the flight draft named three, all mis-cited).
//   AC4  — detach-pending feedback is TRANSFORM-ONLY: neither the drag JS nor the
//          .detaching CSS rule may touch a layout property.
//   AC5  — `drag` is nulled SYNCHRONOUSLY at pointerup, and pendingDrop carries no visual.
//   AC10 — the move core returns a DISCRIMINATED result: no bare `return null` reaches a
//          drag, because silence is not an outcome (DD5).
//
// WHY SOURCE SCANS, STATED PLAINLY RATHER THAN IMPLIED. The leg's ACs for these four ask
// for RUNTIME readings — a fresh getBoundingClientRect() on a sibling, announceTabStatus
// observed on a refusal, orderedTabIds() before/after. This repo has NO DOM test harness:
// `npm test` is bare `node --test` over test/unit/*.test.js, there is no jsdom and no
// happy-dom, main.js is never executed by a test (only read as text), and the leg puts
// behavior specs out of scope (leg 5 owns them). So those readings are NOT taken here and
// this file does not pretend otherwise — it pins the CODE SHAPE each AC's runtime claim
// rests on, which is a weaker property honestly stated. The runtime half is owed to leg 5,
// and the leg log records it as owed rather than as done.
//
// Every mutation below is applied to an in-memory copy of the real source. No file is
// written. All scans are MASKED — the drag section discusses `cancelDrag()`, `transform`
// and `await` in its own prose, so an unmasked scan reads its own commentary and has
// discrimination zero (leg 1's AC9).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const REPO_ROOT = path.join(__dirname, '../..');
const RENDERER_JS = path.join(REPO_ROOT, 'src/renderer/renderer.js');
const STYLES_CSS = path.join(REPO_ROOT, 'src/renderer/styles.css');
const MAIN_JS = path.join(REPO_ROOT, 'src/main/main.js');

/** @returns {string} */
function rendererSource() {
  return fs.readFileSync(RENDERER_JS, 'utf8');
}

/** Assert a mutation actually applied — a no-op .replace() would "discharge" vacuously. */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

// ---------------------------------------------------------------------------
// AC7 — the cancelDrag() call sites, ENUMERATED. DD6 claims seven; the flight draft
// claimed three and mis-cited all of them. An enumeration preserves ARITY even when it
// corrupts content, which is what a downstream re-derivation needs.
// ---------------------------------------------------------------------------

// A CALL, not the definition and not a comment mention. The naive
// `grep -c "cancelDrag()" src/renderer/renderer.js` reads NINE on the real file: seven
// calls, plus `function cancelDrag() {` and one prose mention. That is exactly the
// over-count that put "three" in the flight draft, and it is why this is a real scan.
const CALL_RE = /(?<!function\s)\bcancelDrag\(\)/g;

/** Count real cancelDrag() call sites in `source`. @returns {number} */
function countCancelDragCalls(source) {
  return (maskComments(source).match(CALL_RE) || []).length;
}

test('AC7: there are EXACTLY SEVEN cancelDrag() call sites — real → 7, +1 → 8', () => {
  const real = rendererSource();
  assert.equal(
    countCancelDragCalls(real),
    7,
    'DD6 claims seven cancel paths and every one of them must stay an early-returning no-op ' +
      'across a tear-off round-trip. If this count CHANGED, the new site is a path that can ' +
      'now fire during a pending drop: check it against `drag` being null before bumping this.'
  );

  const mutated = real.replace(
    "window.addEventListener('resize', () => { if (drag) cancelDrag(); });",
    "window.addEventListener('resize', () => { if (drag) cancelDrag(); });\nwindow.addEventListener('blur', () => { if (drag) cancelDrag(); });"
  );
  assertMutated(real, mutated, 'eighth-cancel-site');
  assert.equal(countCancelDragCalls(mutated), 8, 'mutated → 8, and the assertion above FAILS');
});

test('AC7: the enumeration names all seven sites — the arity is not the whole claim', () => {
  // DD6's list, checked one by one against the real file rather than carried from the
  // flight spec's prose. The draft's three were named AND mis-cited; a bare count would
  // not have caught that, so the sites are located individually here.
  const masked = maskComments(rendererSource());
  const sites = [
    ['createTab', /function createTab\([\s\S]{0,400}?if \(drag\) cancelDrag\(\);/],
    ['pointercancel', /addEventListener\('pointercancel'[\s\S]{0,200}?cancelDrag\(\);/],
    ['Escape keydown', /e\.key === 'Escape' && drag[\s\S]{0,120}?cancelDrag\(\);/],
    ['resize', /addEventListener\('resize'[\s\S]{0,80}?cancelDrag\(\);/],
    ['closeTab', /function closeTab\([\s\S]{0,300}?if \(drag\) cancelDrag\(\);/],
    ['adopt-tab', /onAdoptTab\([\s\S]{0,400}?if \(drag\) cancelDrag\(\);/],
    ['tab-moved-away', /onTabMovedAway\([\s\S]{0,300}?if \(drag\) cancelDrag\(\);/]
  ];
  for (const [name, re] of sites) {
    assert.match(masked, re, `DD6's cancel site "${name}" is not where the DD says it is`);
  }
  assert.equal(sites.length, countCancelDragCalls(rendererSource()), 'the named sites ARE all the sites');
});

test('AC7: every cancel site is gated on `drag`, so none can fire during a pending drop', () => {
  // The property the count exists to protect (DD6): `drag` is null across the round-trip,
  // so each site early-returns. pointercancel and Escape call cancelDrag() ungated, but
  // cancelDrag() itself opens with `if (!drag) return;` — so the gate holds for all seven.
  const masked = maskComments(rendererSource());
  assert.match(masked, /function cancelDrag\(\) \{\s*if \(!drag\) return;/, 'cancelDrag early-returns on !drag');
  // And it is `drag`, never `pendingDrop`, that every one of them touches.
  const body = masked.slice(masked.indexOf('function cancelDrag()'));
  const end = findMatchingBracket(body, body.indexOf('{'), '{', '}');
  assert.equal(body.slice(0, end + 1).includes('pendingDrop'), false, 'no cancel path touches pendingDrop (DD6)');
});

// ---------------------------------------------------------------------------
// AC4 / AC5 — TRANSFORM-ONLY, in the JS and in the CSS. This is a constraint, not a style
// preference: armDrag's slotRects snapshot is taken once and getBoundingClientRect()
// INCLUDES transforms, so anything that reflows the strip makes dropIndexFromPointer
// compute silently wrong indices on drag-back — no cancel, no error.
// ---------------------------------------------------------------------------

// Layout-affecting style writes. `transform` and `opacity` are deliberately absent.
const LAYOUT_WRITE_RE =
  /\.style\.(width|height|display|margin|padding|border|flex|position|top|left|right|bottom|inset|gap|order)\b/g;

/**
 * The drag section: clearDragVisuals through the move outcome-message helper.
 *
 * The END landmark was `tearOffOutcomeMessage` until leg 4 merged that map with its
 * cross-window twin into `moveOutcomeMessage`. The rename fired this scan's own guard —
 * "the drag section bounds moved" — rather than letting `indexOf` return -1 and silently
 * scan a backwards or empty slice, which is the vacuous pass the guard is here to prevent.
 * The section did not move; its closing landmark was renamed.
 */
function dragSection(source) {
  const masked = maskComments(source);
  const start = masked.indexOf('function clearDragVisuals()');
  const end = masked.indexOf('function moveOutcomeMessage(');
  assert.ok(start !== -1 && end > start, 'the drag section bounds moved — re-anchor this scan');
  return masked.slice(start, end);
}

test('AC4: the drag section writes NO layout property — real → 0, width-collapse → 1', () => {
  const real = rendererSource();
  assert.equal((dragSection(real).match(LAYOUT_WRITE_RE) || []).length, 0, 'real → 0 layout writes');

  // AC4's named mutation: "close ranks" by collapsing the dragged tab's width instead of
  // by transform. This is the reflow that silently invalidates the rect snapshot.
  const mutated = real.replace(
    "      if (tab && tab.btn) tab.btn.classList.add('detaching');",
    "      if (tab && tab.btn) tab.btn.style.width = '0px';"
  );
  assertMutated(real, mutated, 'width-collapse');
  assert.equal((dragSection(mutated).match(LAYOUT_WRITE_RE) || []).length, 1, 'mutated → 1');
});

test('AC4: the .detaching CSS rule is layout-neutral — real → clean, `width: 0` → flagged', () => {
  // The JS scan above cannot see this: a width collapse delivered by the CLASS rather than
  // by an inline style reflows exactly the same and reads 0 layout writes in the JS.
  const LAYOUT_PROPS = /^\s*(width|height|display|margin|padding|border|flex|position|top|left|right|bottom|inset|gap|order)\b/;

  /** The declarations inside `.tab.detaching { … }`. @returns {string[]} */
  function detachingDecls(css) {
    const i = css.indexOf('.tab.detaching {');
    assert.notEqual(i, -1, 'the .tab.detaching rule is gone — re-anchor this scan');
    return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i)).split(';').filter((d) => d.trim());
  }

  const real = fs.readFileSync(STYLES_CSS, 'utf8');
  const realBad = detachingDecls(real).filter((d) => LAYOUT_PROPS.test(d));
  assert.deepEqual(realBad, [], 'real → no layout declaration in .tab.detaching');

  const mutated = real.replace('.tab.detaching {\n  opacity: 0.6;', '.tab.detaching {\n  width: 0;');
  assertMutated(real, mutated, 'css-width-collapse');
  assert.equal(detachingDecls(mutated).filter((d) => LAYOUT_PROPS.test(d)).length, 1, 'mutated → 1');
});

test('AC5: `drag` is nulled SYNCHRONOUSLY in pointerup — no await precedes it', () => {
  const masked = maskComments(rendererSource());
  const start = masked.indexOf("document.addEventListener('pointerup'");
  const body = masked.slice(start, masked.indexOf("document.addEventListener('pointercancel'"));
  assert.ok(body.includes('drag = null;'), 'pointerup nulls drag');
  assert.equal(/\basync\b/.test(body), false, 'the pointerup listener is not async');
  assert.equal(/\bawait\b/.test(body), false, 'nothing in pointerup suspends before drag is nulled');
  // And clearDragVisuals() still runs there, exactly as F2 left it (DD5/DD6).
  assert.ok(body.includes('clearDragVisuals();'), 'clearDragVisuals still runs at pointerup');
  // commitTabMove is NOT called on the tear-off branch — the tab is already at its origin.
  assert.match(body, /if \(tearOff\) requestTearOff\(tabId\);\s*\n\s*else commitTabMove\(tabId, targetIndex\);/);
});

test('AC5: pendingDrop carries dropSeq and tabId, and no visual state', () => {
  const masked = maskComments(rendererSource());
  assert.match(masked, /pendingDrop = \{ dropSeq: seq, tabId \};/, 'the record is exactly {dropSeq, tabId}');
  // No transform, class, or element ever lands in it.
  const assigns = masked.match(/pendingDrop = [^;]+;/g) || [];
  assert.ok(assigns.length >= 2, 'pendingDrop is assigned (set + the clears)');
  for (const a of assigns) {
    assert.equal(/transform|classList|btn|style/.test(a), false, `pendingDrop carries visual state: ${a}`);
  }
});

// ---------------------------------------------------------------------------
// AC10 — DD5's "no bare nulls, no silent deaths", pinned at the move core. main.js is
// never executed by this suite, so this is a source scan by necessity (see the header).
// ---------------------------------------------------------------------------

/**
 * The move core's body.
 *
 * RE-ANCHORED AT LEG 4 (`moveTabIntoNewWindow` → `moveTabIntoWindow`), which generalized the
 * core over its target so a tab can move into an EXISTING window and not only a new one.
 * This scan caught the rename by FAILING LOUDLY — "the move core is gone" — rather than
 * scanning an empty string and reporting a comfortable zero bare nulls, which is exactly the
 * vacuous pass leg 1's guards exist to make impossible. Worth recording: TWO independently
 * anchored scans (this one and move-tab-synchrony.test.js) both fired on the same edit, and
 * neither was silent.
 * @returns {string}
 */
function moveCoreBody(source) {
  const masked = maskComments(source);
  const i = masked.search(/function moveTabIntoWindow\s*\(/);
  assert.notEqual(i, -1, 'the move core is gone — re-anchor this scan');
  const brace = masked.indexOf('{', i);
  return masked.slice(brace, findMatchingBracket(masked, brace, '{', '}') + 1);
}

test('AC10: the move core NEVER returns a bare null — real → 0, mutated → 1', () => {
  const real = fs.readFileSync(MAIN_JS, 'utf8');
  const BARE_NULL_RE = /return null;/g;
  assert.equal(
    (moveCoreBody(real).match(BARE_NULL_RE) || []).length,
    0,
    'DD5: a drag cannot be omitted at build time the way a menu item can, so every refusal ' +
      'must reach the renderer with a reason. A bare null is silence, and silence is not an outcome.'
  );

  const mutated = real.replace(
    "  if (source.tabViews.size <= 1) return { ok: false, reason: 'sole-tab' };",
    '  if (source.tabViews.size <= 1) return null;'
  );
  assertMutated(real, mutated, 'bare-null-refusal');
  assert.equal((moveCoreBody(mutated).match(BARE_NULL_RE) || []).length, 1, 'mutated → 1');
});

/** A renderer outcome→message map's body, by name. @returns {string} */
function messageMapBody(name) {
  const masked = maskComments(rendererSource());
  const i = masked.indexOf(`function ${name}(`);
  assert.notEqual(i, -1, `${name} is gone — re-anchor this scan`);
  return masked.slice(i, masked.indexOf('\n}\n', i));
}

test('AC10: every core refusal carries a reason, and the renderer maps every one', () => {
  // The two halves must agree, and neither file alone can show it. Reasons are read off
  // main.js's core; each renderer message map is required to be total over them.
  const reasons = [...moveCoreBody(fs.readFileSync(MAIN_JS, 'utf8')).matchAll(/reason: '([a-z-]+)'/g)]
    .map((m) => m[1]);
  assert.deepEqual(
    reasons,
    ['no-tab', 'internal', 'sole-tab', 'no-target'],
    'the core refuses with exactly these reasons. `no-target` is LEG 4\'s: the core no longer ' +
      'creates its own target unconditionally, so "the destination is gone" became an outcome ' +
      'it can hit. Bump this list when the core gains a refusal — that is the point of reading ' +
      'it off the source instead of restating it.'
  );

  // ONE map since leg 4 (`moveOutcomeMessage`), parameterized by the destination phrase —
  // leg 4 drafted a second, near-duplicate one and its justification ("every message
  // differs") did not survive being held against the drafts. One core result union, one map
  // over it, and this pin is correspondingly one scan instead of two that could drift.
  const body = messageMapBody('moveOutcomeMessage');
  // TOTAL by construction — a default arm plus a final fallthrough, so no input reaches an
  // implicit `undefined` return. That totality, not the specific wording, is what makes
  // silence unreachable, so the arms are asserted to EXIST and the prose is not pinned.
  assert.match(body, /default: return `[^`]+`;/, 'the message map has a non-empty default arm');
  // Every refusal the core can name, EXCEPT no-tab, has its own arm — including `no-target`,
  // which is AC4's whole subject (the window closed between menu build and dispatch, and the
  // user is owed those words rather than a generic failure).
  for (const r of reasons.filter((x) => x !== 'no-tab')) {
    assert.ok(body.includes(`case '${r}':`), `the renderer names the '${r}' refusal specifically`);
  }
  // `no-tab` is deliberately unnamed: the strip mutated under the gesture, and the generic
  // default is the honest message for it.
  assert.equal(body.includes("case 'no-tab':"), false, 'no-tab is left to the default, deliberately');
  // Every `return` yields a non-empty literal — the property "no outcome is silent".
  const returns = body.match(/return (?:'[^']*'|`[^`]*`);/g) || [];
  assert.ok(returns.length >= 5, `expected an arm per outcome plus the fallthrough, found ${returns.length}`);
  for (const r of returns) {
    assert.notEqual(r, "return '';", 'an empty announcement IS silence');
    assert.notEqual(r, 'return ``;', 'an empty announcement IS silence');
  }

  // BOTH callers pass a destination, so no arm can render "undefined" into an announcement.
  const masked = maskComments(rendererSource());
  const calls = masked.match(/moveOutcomeMessage\(result, '[^']+'\)/g) || [];
  assert.equal(calls.length, 2, 'both the tear-off and the cross-window path announce through the one map');
});

// ---------------------------------------------------------------------------
// DD16 — the coordinate ban, widened from DD1's and pinned across src/**.
// ---------------------------------------------------------------------------

test('DD16: no src/** file reads a cross-window coordinate — real → 0, mutated → 1', () => {
  // Not `screen`, not a WINDOW's `getBounds`, not `screenX`: none is falsifiable from
  // inside Electron, which is what the flight's second instrument established. Masked,
  // because several files (this leg's zone module especially) name them in prose to say
  // they are banned — the exact shape leg 1's AC9 flagged as discrimination zero.
  //
  // SCOPED TO WINDOW-LEVEL READS, AND THAT IS A CORRECTION TO DD16's WORDING, NOT A
  // LOOPHOLE. DD16 says "nothing reads `screenX`, `getBounds`, `getPosition`". Read
  // literally that bans `view.getBounds()` too — and src/main/main.js has FIVE of those,
  // all predating F8, one of them (`entry.view.getBounds()`, the guest geometry seed) INSIDE
  // the move core this leg factored. They are not the hazard: a WebContentsView's bounds are
  // window-local, expressed against its own window's content view, and never cross a window
  // boundary. What the spike refuted was `win.getBounds()`/`win.getPosition()` — a window's
  // ORIGIN IN SCREEN SPACE, which is the cached fiction. Banning the window-local read too
  // would forbid the move core's own working code, so the ban is pinned where the hazard is.
  // BAN THE HAZARD, NOT A LIST OF SPELLINGS — widened at F8's flight-end review, which
  // measured three misses in the enumerated form and named the reason: an enumeration of
  // spellings is a proxy for the property, and it decays every time someone writes the
  // property a new way.
  //   - `\bscreenX\b` / `\bscreenY\b` rather than `window.screenX`. The window prefix is
  //     OPTIONAL (bare `screenX` resolves on the global), and — the reintroduction that
  //     actually matters — **`e.screenX`**: the drag handlers already hold `e`, `e.clientX`
  //     is the ALLOWED read, and `e.screenX` is ONE WORD away while carrying exactly the
  //     window-origin fiction the leg-2 spike measured (`screenX ≡ getBounds.x − 16`). The
  //     `\b` before `screenX` matches after `.` and after whitespace alike, so all three
  //     spellings fall to one token — which is why this is now a token and not a list.
  //   - `\bscreen\.` rather than three of the `screen` module's methods. DD1 banned THE
  //     MODULE; enumerating `getCursorScreenPoint`/`dipToScreenPoint`/`screenToDipPoint`
  //     bans three of its members and waves the rest through.
  // FALSE POSITIVES: MEASURED, not assumed. The zone module and renderer.js name these
  // words in prose, and `renderer/pages/jars.js` has a `screen.` in a comment — the scan is
  // MASKED, so all of them read 0. Verified against the real tree at the widening: masked
  // hits across src/** → 0 for every alternative below.
  const BANNED_RE = /\bscreenX\b|\bscreenY\b|\bwin\.getBounds\(\)|\bwin\.getPosition\(\)|\bscreen\./g;

  /** @param {string} dir @returns {string[]} */
  function walk(dir) {
    /** @type {string[]} */
    const out = [];
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) out.push(...walk(full));
      else if (d.name.endsWith('.js')) out.push(full);
    }
    return out;
  }

  const files = walk(path.join(REPO_ROOT, 'src'));
  assert.ok(files.length > 20, `expected the src tree, found ${files.length} files`);

  /** @type {string[]} */
  const hits = [];
  for (const f of files) {
    const n = (maskComments(fs.readFileSync(f, 'utf8')).match(BANNED_RE) || []).length;
    if (n) hits.push(`${path.relative(REPO_ROOT, f)} (${n})`);
  }
  assert.deepEqual(hits, [], 'DD16 bans every cross-window coordinate source in src/**');

  // The control: the ban is only meaningful if the scan can see a violation.
  const zone = fs.readFileSync(path.join(REPO_ROOT, 'src/shared/tab-drag-zone.js'), 'utf8');
  const mutated = zone.replace('return pointerX < left', 'return pointerX + window.screenX < left');
  assertMutated(zone, mutated, 'dd16-violation');
  assert.equal((maskComments(mutated).match(BANNED_RE) || []).length, 1, 'mutated → 1');

  // THE HARD CASE, AND THE ONE THE ENUMERATED FORM MISSED. `window.screenX` above is the
  // EASY control — it was the one spelling the old regex caught, so "both directions" was
  // demonstrated only on the case that could not fail. That is this flight's own thesis
  // (an instrument shown to discriminate only where it already did), so the control is
  // extended to the reintroduction actually predicted: `e.screenX`, at the REAL site, in
  // renderer.js's pointermove handler, where `e` is already in scope and `e.clientX` — the
  // ALLOWED window-local read — sits on the same line. This is a one-word edit away from
  // shipped code and reads as entirely natural; nothing but this scan would stop it.
  const real = rendererSource();
  assert.equal((maskComments(real).match(BANNED_RE) || []).length, 0, 'real renderer → 0');
  const eScreen = real.replace(
    '    e.clientX, e.clientY, drag.draggedIndex);',
    '    e.screenX, e.screenY, drag.draggedIndex);'
  );
  assertMutated(real, eScreen, 'dd16-e-screenX');
  assert.equal(
    (maskComments(eScreen).match(BANNED_RE) || []).length,
    2,
    'mutated → 2 (screenX + screenY). The OLD enumerated regex read ZERO here — it bans ' +
      '`window.screenX` and this spelling carries no `window.` prefix.'
  );

  // And the module-level half of the ban, which the enumeration reduced to three methods.
  const anyScreenMethod = real.replace(
    '    e.clientX, e.clientY, drag.draggedIndex);',
    '    require(\'electron\').screen.getCursorScreenPoint().x, e.clientY, drag.draggedIndex);'
  );
  assertMutated(real, anyScreenMethod, 'dd16-screen-module');
  assert.equal((maskComments(anyScreenMethod).match(BANNED_RE) || []).length, 1, 'the `screen` MODULE is banned, not three of its methods');
});
