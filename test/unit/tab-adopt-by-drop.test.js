'use strict';

// Cross-window drop-adopt invariants (M09 Flight 11, Leg 3) — a source-scan net in the
// move-tab-synchrony.test.js / tab-drag-invariants.test.js house pattern, pinning the
// code shape the leg's design rests on. Same honesty note as the sibling suites: this
// repo has no main/renderer process harness (main.js and renderer.js are read as text,
// never executed), so these are CODE-SHAPE pins; the runtime half (a live cross-window
// drag) is the flight's operator HAT with overlapping windows (criterion 8) plus Leg 4's
// behavior spec, and this file does not pretend otherwise.
//
//   AC3 — the `tab-adopt-by-drop` handler's AUTHORITY CHAIN: target from the SENDER,
//         source from the PAYLOAD's wcId via the registry (the deliberate DD2 inversion
//         of tab-move-to-window), every refusal discriminated (DD5), the provenance gate
//         (source.dragWcId === p.wcId) ahead of the move core, allowSoleTab TRUE (the
//         existing-window consolidate semantics, leg DD5), and a successful adopt
//         CONSUMING the registration (one drag = one drop).
//   AC4 — the registration handlers: tab-drag-started records the wcId only after
//         verifying the SENDER's own window owns it (the payload does not get to name
//         it); tab-drag-ended clears on the ~1500 ms grace timer, never synchronously —
//         the target's adopt invoke rides a different IPC pipe, and an immediate clear
//         could race a legitimate adopt into 'not-dragging'.
//   AC1 — the document dragover accepts the MIME UNCONDITIONALLY (preventDefault +
//         dropEffect BEFORE any `dnd` gate): a foreign window's drag must be accepted
//         here or its `drop` never fires. Zone/displacement work stays dnd-gated.
//   AC2 — the drop handler's cross-window branch invokes tabAdoptByDrop and announces
//         through the one moveOutcomeMessage map ('this window' — leg DD4: the target
//         owns the outcome announce); the null-dnd-own-tab guard precedes the invoke (a
//         mid-drag-canceled same-window release is a silent no-op, not a false failure).
//   AC5 — BOTH orderings of the source-side reconciliation: (a) requestTearOff
//         suppresses EXACTLY the adopted-elsewhere signature (no-tab refusal AND the tab
//         already gone locally) and nothing else; (b) onTabMovedAway silently clears a
//         live drag session whose tab is the departing one. No false announce in either
//         arrival order.
//
// Every mutation below is applied to an in-memory copy of the real source; no file is
// ever written. Scans are masked EXCEPT the AC5(b) pins: onTabMovedAway sits past
// renderer.js's maskComments regex blind spot (the inverted-mask region that
// sole-tab-move-close-source.test.js measures), so those pins scan the RAW source with
// quote-free code tokens that read identically masked or not.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const REPO_ROOT = path.join(__dirname, '../..');
const MAIN_JS = path.join(REPO_ROOT, 'src/main/main.js');
const RENDERER_JS = path.join(REPO_ROOT, 'src/renderer/renderer.js');

const realMain = () => fs.readFileSync(MAIN_JS, 'utf8');
const rendererSource = () => fs.readFileSync(RENDERER_JS, 'utf8');

/** Assert a mutation actually applied — a no-op .replace() would "discharge" vacuously. */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

/** The masked body of an ipcMain.handle/ipcMain.on callback, by channel literal. */
function ipcBody(source, register, channel) {
  const masked = maskComments(source);
  const reg = masked.indexOf(`ipcMain.${register}('${channel}',`);
  assert.notEqual(reg, -1, `the ${channel} registration is gone — re-anchor this pin`);
  const brace = masked.indexOf('{', reg);
  const end = findMatchingBracket(masked, brace, '{', '}');
  assert.notEqual(end, -1, `unbalanced ${channel} body`);
  return masked.slice(brace, end + 1);
}

/** The masked body of a renderer listener/function, from `anchor` to its bracket close. */
function anchoredBody(source, anchor) {
  const masked = maskComments(source);
  const start = masked.indexOf(anchor);
  assert.notEqual(start, -1, `${anchor} is gone — re-anchor this pin`);
  const brace = masked.indexOf('{', start);
  const end = findMatchingBracket(masked, brace, '{', '}');
  assert.notEqual(end, -1, `unbalanced body at ${anchor}`);
  return masked.slice(brace, end + 1);
}

// ---------------------------------------------------------------------------
// AC3 — the adopt handler's authority chain.
// ---------------------------------------------------------------------------

test('AC3: the adopt handler resolves TARGET from the sender and SOURCE from the payload, refusals discriminated', () => {
  const body = ipcBody(realMain(), 'handle', 'tab-adopt-by-drop');
  assert.ok(
    body.includes('registry.getWindowForChrome(event.sender)'),
    'the TARGET is the sender — the window the drop physically landed in, never payload-named'
  );
  assert.ok(
    body.includes('registry.getWindowForGuest(p.wcId)'),
    'the SOURCE is resolved from the VALIDATED payload wcId through the registry — the DD2 inversion'
  );
  assert.ok(body.includes('validateMoveTabPayload(payload)'), 'the payload is shape-validated before any resolve on it');
  // Every refusal is discriminated (DD5: a drop is a physical gesture — silence is not an outcome).
  for (const reason of ['no-source', 'bad-payload', 'no-tab', 'same-window', 'not-dragging']) {
    assert.ok(body.includes(`reason: '${reason}'`), `the '${reason}' refusal is discriminated`);
  }
});

test('AC3/DD2: the provenance gate precedes the core, allowSoleTab is TRUE, and success CONSUMES the registration', () => {
  const real = realMain();
  const body = ipcBody(real, 'handle', 'tab-adopt-by-drop');
  const gate = body.indexOf('source.dragWcId !== p.wcId');
  const core = body.indexOf('moveTabIntoWindow(source, p, () => target, true)');
  assert.notEqual(gate, -1, 'the DD2 provenance gate is present — a payload the source never declared is refused');
  assert.notEqual(core, -1, 'the core call passes allowSoleTab TRUE (leg DD5 — a sole-tab drag consolidates and the emptied source closes)');
  assert.ok(gate < core, 'the gate runs BEFORE the move core — a forged payload never reaches it');
  assert.ok(body.includes('source.dragWcId = null'), 'a successful adopt consumes the registration (DD2 refinement: one drag = one drop)');

  // Mutation (a): delete the gate — the forgery door (guest setData with an arbitrary
  // wcId) reopens, and this pin FAILS rather than passing on the weakened chain.
  const ungated = real.replace(
    "  if (source.dragWcId !== p.wcId) return { ok: false, reason: 'not-dragging' };\n",
    ''
  );
  assertMutated(real, ungated, 'removed-provenance-gate');
  assert.equal(
    ipcBody(ungated, 'handle', 'tab-adopt-by-drop').includes('source.dragWcId !== p.wcId'),
    false,
    'mutated → the gate is gone and the pin above FAILS'
  );

  // Mutation (b): drop allowSoleTab — a sole-tab cross-window drag would refuse
  // ('sole-tab') instead of consolidating. The `const r =` prefix keeps this replace off
  // tab-move-to-window's earlier, `return`-prefixed twin.
  const noSole = real.replace(
    'const r = moveTabIntoWindow(source, p, () => target, true);',
    'const r = moveTabIntoWindow(source, p, () => target);'
  );
  assertMutated(real, noSole, 'dropped-allowSoleTab');
  assert.equal(
    ipcBody(noSole, 'handle', 'tab-adopt-by-drop').includes('moveTabIntoWindow(source, p, () => target, true)'),
    false,
    'mutated → the allowSoleTab pin above FAILS'
  );
});

// ---------------------------------------------------------------------------
// AC4 — the provenance registration handlers.
// ---------------------------------------------------------------------------

test('AC4: tab-drag-started verifies the SENDER owns the wcId before recording it', () => {
  const real = realMain();
  const body = ipcBody(real, 'on', 'tab-drag-started');
  const verify = body.indexOf('rec.tabViews.has(wcId)');
  const record = body.indexOf('rec.dragWcId = wcId');
  assert.notEqual(verify, -1, 'the sender-owns-wcId verification is present — the payload does not get to name a tab the sender does not own');
  assert.notEqual(record, -1, 'the registration write is present');
  assert.ok(verify < record, 'verified BEFORE recorded');

  // Mutation: drop the ownership conjunct — any chrome could then register a wcId it
  // does not own, re-opening the forgery the gate exists to close.
  const unverified = real.replace(
    "  if (!rec || typeof wcId !== 'number' || !rec.tabViews.has(wcId)) return;",
    "  if (!rec || typeof wcId !== 'number') return;"
  );
  assertMutated(real, unverified, 'dropped-ownership-check');
  assert.equal(
    ipcBody(unverified, 'on', 'tab-drag-started').includes('rec.tabViews.has(wcId)'),
    false,
    'mutated → the verification pin FAILS'
  );
});

test('AC4: tab-drag-ended clears on the grace timer, never synchronously', () => {
  const real = realMain();
  const body = ipcBody(real, 'on', 'tab-drag-ended');
  const timer = body.indexOf('setTimeout');
  const clear = body.indexOf('rec.dragWcId = null');
  assert.notEqual(timer, -1, 'the clear is deferred — the adopt invoke rides a DIFFERENT pipe, and an immediate clear races it into not-dragging');
  assert.notEqual(clear, -1, 'the timer clears the registration');
  assert.ok(timer < clear, 'the clear rides the timer thunk, not the dispatch');
  assert.match(maskComments(real), /const DRAG_END_GRACE_MS = 1500;/, 'the grace window is the designed ~1500 ms');

  // Mutation: clear immediately — the cross-pipe race the timer exists for comes back.
  const immediate = real.replace(
    '  dragEndClearTimers.set(rec, setTimeout(() => {\n    dragEndClearTimers.delete(rec);\n    rec.dragWcId = null;\n  }, DRAG_END_GRACE_MS));',
    '  rec.dragWcId = null;'
  );
  assertMutated(real, immediate, 'synchronous-clear');
  assert.equal(
    ipcBody(immediate, 'on', 'tab-drag-ended').includes('setTimeout'),
    false,
    'mutated → the deferred-clear pin FAILS'
  );
});

test('AC4: the renderer bookends — dragstart declares, dragend ends BEFORE the null-session early return', () => {
  const masked = maskComments(rendererSource());
  const ds = masked.indexOf("btn.addEventListener('dragstart'");
  const de = masked.indexOf("btn.addEventListener('dragend'");
  assert.ok(ds !== -1 && de !== -1 && ds < de, 'the dragstart/dragend pair moved — re-anchor this pin');
  const dsBody = masked.slice(ds, de);
  const gate = dsBody.indexOf('e.preventDefault(); return;');
  const declare = dsBody.indexOf('window.goldfinch.tabDragStarted(tab.wcId)');
  assert.notEqual(declare, -1, 'dragstart declares the drag main-side');
  assert.ok(gate !== -1 && gate < declare, 'declared only PAST the null-wcId refusal gate — a null wcId is never registered');
  const deBody = masked.slice(de, masked.indexOf('els.tabs.appendChild(btn);', de));
  const ended = deBody.indexOf('window.goldfinch.tabDragEnded(tab.wcId)');
  const early = deBody.indexOf('if (!dnd) return;');
  assert.notEqual(ended, -1, 'dragend ends the registration');
  assert.ok(early !== -1 && ended < early, 'the bookend precedes the null-dnd early return — a defensively-canceled session still ends its registration');
});

// ---------------------------------------------------------------------------
// AC1 — the target-side dragover accepts foreign drags.
// ---------------------------------------------------------------------------

test('AC1: dragover accepts UNCONDITIONALLY for the MIME — preventDefault/dropEffect before any dnd gate', () => {
  const real = rendererSource();
  const body = anchoredBody(real, "document.addEventListener('dragover'");
  const mime = body.indexOf('types.includes(TAB_DND_MIME)');
  const accept = body.indexOf('e.preventDefault()');
  const effect = body.indexOf("dropEffect = 'move'");
  const gate = body.indexOf('if (!dnd) return;');
  assert.ok(mime !== -1 && accept !== -1 && effect !== -1 && gate !== -1, 'the dragover shape moved — re-anchor this pin');
  assert.ok(mime < accept, 'the MIME guard runs first — non-tab drags are never accepted');
  assert.ok(accept < effect && effect < gate,
    'preventDefault + dropEffect run BEFORE the dnd gate — a FOREIGN drag must be accepted here or its drop never fires; only the zone/displacement body is source-window-only');

  // Mutation: restore the Leg 2 shape (accept gated on our own dnd) — a foreign drag is
  // never accepted, drop never fires, and criterion 8 dies silently. The pin must FAIL.
  const regated = real.replace(
    "  e.preventDefault();\n  e.dataTransfer.dropEffect = 'move';",
    "  if (!dnd) return;\n  e.preventDefault();\n  e.dataTransfer.dropEffect = 'move';"
  );
  assertMutated(real, regated, 'regated-accept');
  const mutated = anchoredBody(regated, "document.addEventListener('dragover'");
  assert.equal(
    mutated.indexOf("dropEffect = 'move'") < mutated.indexOf('if (!dnd) return;'),
    false,
    'mutated → the gate now precedes the accept and the ordering pin FAILS'
  );
});

// ---------------------------------------------------------------------------
// AC2 — the drop handler's cross-window branch.
// ---------------------------------------------------------------------------

test('AC2: the cross-window drop branch — dropHandled first, own-tab guard, adopt invoke, target-side announce', () => {
  const real = rendererSource();
  const body = anchoredBody(real, "els.tabs.addEventListener('drop'");
  assert.ok(
    body.indexOf('dnd.dropHandled = true') !== -1 && body.indexOf('dnd.dropHandled = true') < body.indexOf('JSON.parse'),
    'dropHandled is set SYNCHRONOUSLY before any parse — dragend must never tear off a committed drop (unchanged same-window property)'
  );
  const guard = body.indexOf('if (!dnd && findTabByWcId(payload.wcId)) return;');
  const invoke = body.indexOf('window.goldfinch.tabAdoptByDrop(payload)');
  const announce = body.indexOf("moveOutcomeMessage(result, 'this window')");
  assert.notEqual(guard, -1, 'the null-dnd-own-tab guard is present — a mid-drag-canceled same-window release is a silent no-op');
  assert.notEqual(invoke, -1, 'the cross-window branch invokes tabAdoptByDrop');
  assert.notEqual(announce, -1, 'the TARGET announces the outcome through the one moveOutcomeMessage map (leg DD4)');
  assert.ok(guard < invoke, 'the guard runs BEFORE the invoke — main is never asked to refuse the canceled-drag corner');

  // Mutation: drop the guard — a popup-canceled same-window release would invoke the
  // adopt and announce a spurious failure over main's same-window refusal.
  const unguarded = real.replace('  if (!dnd && findTabByWcId(payload.wcId)) return;\n', '');
  assertMutated(real, unguarded, 'removed-own-tab-guard');
  assert.equal(
    anchoredBody(unguarded, "els.tabs.addEventListener('drop'").includes('if (!dnd && findTabByWcId(payload.wcId)) return;'),
    false,
    'mutated → the guard pin FAILS'
  );
});

// ---------------------------------------------------------------------------
// AC5(a) — the tear-off reply suppression (dragend-first ordering).
// ---------------------------------------------------------------------------

const SUPPRESS = "if (result && result.ok === false && result.reason === 'no-tab' && !tabs.has(tabId)) return;";

test('AC5a: requestTearOff suppresses EXACTLY the adopted-elsewhere signature — both directions', () => {
  const real = rendererSource();
  const body = anchoredBody(real, 'function requestTearOff(');
  const suppress = body.indexOf(SUPPRESS);
  assert.notEqual(suppress, -1,
    'the suppression is the FULL signature: no-tab refusal AND the tab already gone locally (tab-moved-away processed) — the successful-adopt echo, nothing broader');
  assert.ok(
    body.indexOf('pendingDrop = null') < suppress && suppress < body.indexOf('announceTabStatus'),
    'suppression sits between the freshness check and the announce — every other outcome announces as before (DD5)'
  );

  // Direction 1: over-suppression — dropping the tab-still-present conjunct silences a
  // TRUE no-tab anomaly (strip mutated under the drag with the tab still here).
  const over = real.replace(SUPPRESS, "if (result && result.ok === false && result.reason === 'no-tab') return;");
  assertMutated(real, over, 'over-suppression');
  assert.equal(anchoredBody(over, 'function requestTearOff(').includes(SUPPRESS), false, 'mutated → the exact-signature pin FAILS');

  // Direction 2: no suppression — the false "Move to a new window failed" on EVERY
  // successful cross-window drag (the verified gap this leg closes) comes back.
  const none = real.replace(`    ${SUPPRESS}\n`, '');
  assertMutated(real, none, 'removed-suppression');
  assert.equal(anchoredBody(none, 'function requestTearOff(').includes('!tabs.has(tabId)'), false, 'mutated → the suppression pin FAILS');
});

// ---------------------------------------------------------------------------
// AC5(b) — the moved-away silent-clear (adopt-first ordering). RAW-source pins with
// quote-free tokens: this region sits past the maskComments regex blind spot (see the
// header), so the tokens must read the same whether the mask applied or not — and they
// do, because they are exact code lines that appear in no comment.
// ---------------------------------------------------------------------------

const SILENT_CLEAR = 'if (dnd && dnd.wcId === payload.wcId) { clearDragVisuals(); dnd = null; }';

test('AC5b: onTabMovedAway silently clears a live session whose tab is the departing one', () => {
  const real = rendererSource();
  const anchor = real.indexOf('onTabMovedAway((payload)');
  assert.notEqual(anchor, -1, 'the onTabMovedAway handler is gone — re-anchor this pin');
  const silent = real.indexOf(SILENT_CLEAR, anchor);
  const cancel = real.indexOf('if (dnd) cancelDnd();', anchor);
  assert.notEqual(silent, -1,
    'the silent-clear is present: the departing tab IS the live drag session tab means a successful adopt beat our own dragend, the TARGET announces, and a Move-canceled here would be false');
  assert.ok(cancel !== -1 && silent < cancel,
    'the silent-clear runs BEFORE the defensive cancel — the announce-free path wins for the departing drag tab, the cancel stays for every other mid-move mutation');

  // Mutation: remove the silent-clear — tab-moved-away beating the source dragend
  // (adopt-first ordering) announces a false cancel on every such successful move, and
  // the null-dnd dragend early-return means AC5(a) alone never covers that ordering.
  const removed = real.replace(`  ${SILENT_CLEAR}\n`, '');
  assertMutated(real, removed, 'removed-silent-clear');
  assert.equal(removed.indexOf(SILENT_CLEAR, removed.indexOf('onTabMovedAway((payload)')), -1, 'mutated → the silent-clear pin FAILS');
});
