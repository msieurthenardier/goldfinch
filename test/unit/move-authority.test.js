'use strict';

// M09 F8 Leg 4, DD8 — the AUTHORITY rule, pinned as source shape.
//
// THE RULE (main.js:270 / automation/tabs.js:63, and it is an AUTHORITY rule, not a
// confidentiality one): the REGISTRY — never a renderer's claim — decides which window owns
// a tab. "The renderer is authoritative only for url/title/jarId and NEVER learns windowId"
// governs CENSUS AGGREGATION, and its stated purpose is that ownership filtering is "what
// makes a double-count structurally impossible".
//
// WHY THIS PIN EXISTS. Leg 4 hands the chrome renderer a `windowId` and takes one back. That
// is not a violation — window-census.js already emits windowId on every row,
// tab-move-to-new-window already RETURNS { ok, windowId } to the chrome renderer, and
// renderer-globals.d.ts already declares it. But it is exactly the change that could QUIETLY
// invert the rule: the echoed id is a DESTINATION REQUEST, and the moment anything resolves
// the SOURCE (or the tab's ownership) from the payload instead of from the sender, the
// payload becomes the ownership authority and the structural impossibility becomes a
// convention. Nothing else in the tree says so, and the failure would be silent: a renderer
// naming a tab in another window would simply be believed.
//
// SOURCE SCAN BY NECESSITY. main.js is Electron-bound and is never executed by this suite —
// only read as text (the leg-3 header's finding, unchanged). This pins the SHAPE the runtime
// claim rests on. The RUNTIME reading — a payload naming a foreign tab is actually refused —
// is leg 5's, and is not claimed here.
//
// MASKED, and the mask is load-bearing here in a way it is not for the synchrony pin: the
// handler this scans is wrapped in a comment block that spells `payload.windowId`,
// `event.sender` and `registry.get` in prose to explain the rule. An unmasked scan reads
// those and cannot tell the explanation from the code.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const MAIN_JS = path.join(__dirname, '../../src/main/register-tab-ipc.js');

const CHANNEL = "'tab-move-to-window'";
const REGISTRATION_RE = /\bipcMain\.handle\(\s*'tab-move-to-window'\s*,/;

/** The cross-window move handler's body, masked. @returns {string} */
function handlerBody() {
  const masked = maskComments(fs.readFileSync(MAIN_JS, 'utf8'));
  const m = masked.match(REGISTRATION_RE);
  assert.ok(m && m.index !== undefined, `the ${CHANNEL} registration is gone — re-anchor this scan`);
  const brace = masked.indexOf('{', m.index);
  const end = findMatchingBracket(masked, brace, '{', '}');
  assert.notEqual(end, -1, `unbalanced ${CHANNEL} handler body`);
  return masked.slice(brace, end + 1);
}

/** Assert a mutation actually applied — a no-op .replace() would "discharge" vacuously. */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

/** Re-scan an arbitrary source string for the handler body. @returns {string} */
function bodyOf(source) {
  const masked = maskComments(source);
  const m = masked.match(REGISTRATION_RE);
  if (!m || m.index === undefined) return '';
  const brace = masked.indexOf('{', m.index);
  return masked.slice(brace, findMatchingBracket(masked, brace, '{', '}') + 1);
}

test('AC5: the SOURCE window is resolved from event.sender, never from the payload', () => {
  const body = handlerBody();
  assert.equal(
    (body.match(/registry\.getWindowForChrome\(event\.sender\)/g) || []).length,
    1,
    'the source window comes from the SENDER, through the registry — the same resolution the ' +
      'menu and tear-off paths use. A renderer does not get to say which window it is.'
  );
  // The payload is read for exactly ONE thing: the destination id.
  const payloadReads = body.match(/payload\.[a-zA-Z]+/g) || [];
  assert.deepEqual(
    [...new Set(payloadReads)],
    ['payload.windowId'],
    'the payload is read ONLY for the destination request. Anything else read off it — a ' +
      'source id, an owner id — would be the renderer claiming ownership.'
  );
});

test('AC5: the DESTINATION is re-resolved through the registry, and a dead one refuses', () => {
  const body = handlerBody();
  assert.match(body, /registry\.get\(wantedId\)/, 'the requested windowId is resolved through the registry');
  assert.match(
    body,
    /if \(!target \|\| target\.win\.isDestroyed\(\) \|\| target === source\) return \{ ok: false, reason: 'no-target' \};/,
    'AC4: absent / destroyed / self target REFUSES — announced, never a mis-target and never silence'
  );
});

test('AC5 mutated: resolving the source FROM THE PAYLOAD is caught — real → 1, mutated → 0', () => {
  const real = fs.readFileSync(MAIN_JS, 'utf8');
  const SENDER_RE = /registry\.getWindowForChrome\(event\.sender\)/g;
  assert.equal((bodyOf(real).match(SENDER_RE) || []).length, 1, 'real → the sender is the authority');

  // THE mutation this pin exists for: the payload names the source window. It type-checks,
  // it runs, and every test that only moves a tab within its own window still passes — the
  // tab really is where the payload says. It is wrong only when a renderer lies, which is
  // the case the registry filter exists to make impossible.
  const mutated = real.replace(
    "ipcMain.handle('tab-move-to-window', (event, payload) => {\n  const source = registry.getWindowForChrome(event.sender);",
    "ipcMain.handle('tab-move-to-window', (event, payload) => {\n  const source = registry.get(payload.sourceWindowId);"
  );
  assertMutated(real, mutated, 'payload-as-source-authority');
  assert.equal((bodyOf(mutated).match(SENDER_RE) || []).length, 0, 'mutated → the sender is no longer consulted');
  assert.match(bodyOf(mutated), /payload\.sourceWindowId/, 'mutated → the payload became the ownership authority');
});

test('AC5 mutated: dropping the destination re-resolution is caught — real → 1, mutated → 0', () => {
  const real = fs.readFileSync(MAIN_JS, 'utf8');
  const GET_RE = /registry\.get\(wantedId\)/g;
  assert.equal((bodyOf(real).match(GET_RE) || []).length, 1, 'real → the destination is re-resolved');

  // Trusting a target captured at menu-build time instead of re-resolving it is precisely
  // what DD8's reversal of the ordinal scheme forbids: it is the cache the ordinal scheme
  // needed, and it makes AC4's refusal unreachable.
  const mutated = real.replace(
    '  const target = wantedId === null ? null : registry.get(wantedId);',
    '  const target = wantedId === null ? null : cachedTargets.get(wantedId);'
  );
  assertMutated(real, mutated, 'cached-target');
  assert.equal((bodyOf(mutated).match(GET_RE) || []).length, 0, 'mutated → the registry is no longer the authority');
});

test('the mask IS load-bearing here — measured, and the first number written down was wrong', () => {
  // Unlike the synchrony pin — whose header measured its own mask as defensive-but-NOT
  // load-bearing on this tree and said so — this scan's subject sits directly under a
  // comment block that spells the very tokens it counts. So the mask earns its keep here,
  // and the reading proves it rather than the prose asserting it.
  //
  // HONESTY NOTE, in this flight's idiom: this test was FIRST WRITTEN asserting masked → 1,
  // and it failed on the real file. Two reads live in the one guard expression
  // (`typeof payload.windowId === 'number' ? payload.windowId : null`), not one. The claim
  // was composed from what the code ought to look like; 2 is what it does look like. The
  // measurement is what is committed.
  const real = fs.readFileSync(MAIN_JS, 'utf8');
  const RE = /payload\.windowId/g;
  const maskedCount = (maskComments(real).match(RE) || []).length;
  const rawCount = (real.match(RE) || []).length;
  assert.equal(maskedCount, 2, 'masked → the two reads of the ONE guard expression');
  assert.equal(rawCount, 3, 'unmasked → 3: the same two, plus the AUTHORITY comment naming the field');
  assert.ok(rawCount > maskedCount, 'the mask discriminates on this tree — prose is not code');
});
