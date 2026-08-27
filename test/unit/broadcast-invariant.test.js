'use strict';

// DD8 broadcast-invariant net (M06 Flight 4, Leg 1). Issue #99 / #105 moved settings
// and jar handlers out of the god file into nine registrar modules; squawk 0001
// (see squawks/0001-broadcast-invariant-tripwire.md) re-armed the net's SELF-DERIVING
// property after the decomposition rewrite dropped it — the extraction helpers below
// once again parse the real registrar modules under src/main/, not just inline
// fixtures, so a future mutating handler added without a broadcast fails this test
// WITHOUT anyone editing it. The runtime harness tests further down (invoking captured
// registrar callbacks and observing mutation/broadcast order) stay alongside as a
// second, execution-order guarantee the static scan can't give.
//
// The extraction is deliberately dumb (a convention tripwire, not a parser), but
// two real footguns are guarded against explicitly:
//   1. Comments that happen to CONTAIN registration-shaped text (main.js:996 has
//      a doc comment literally reading `ipcMain.handle('tab-create')`, which
//      would otherwise register a bogus, coincidentally-balanced match) — fixed
//      by masking out // and /* */ comment bodies (replaced with spaces,
//      newlines preserved so offsets/labels stay accurate) before any regex or
//      bracket-balance scan runs.
//   2. Marker text that happens to appear only inside a comment INSIDE a real
//      handler body (e.g. a body that mentions "settings.set(" in a doc comment
//      without calling it) — fixed by running the mutatesSettings /
//      broadcastsSettingsChanged marker checks against the SAME masked text, so
//      only live code can trip (or satisfy) the net.
// String literal contents are left untouched by the mask (so `'http://...'`
// keeps its `//`; the string branch intentionally never re-enters comment
// detection while inside quotes).
//
// This file ORIGINATED maskComments + findMatchingBracket (M06 F4 L1) and carried them
// locally until M09 F8 leg 1 extracted them to test/helpers/source-scan.js — proving the
// move by BYTE-IDENTITY of the function bodies rather than by "the suite still passes".
// This file's copies are the ones that survived the extraction verbatim; see the helper's
// header for that ruling and for maskComments's known regex-literal blind spot.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');
const { makeHarness } = require('./helpers/jar-ipc-harness');
const { makeSettingsIpcHarness } = require('./helpers/settings-ipc-harness');
const appDb = require('../../src/main/app-db');
const { registerBookmarksIpc } = require('../../src/main/register-bookmarks-ipc');

const MUTATION_MARKERS = ['settings.set(', 'mintJarKey(', 'revokeJarKey(', 'mintAdminKey(', 'revokeAdminKey('];
const BROADCAST_MARKER = 'settings-changed';

// Deliberate exceptions (leg spec: "explicit in-test allowlist entry with a
// comment"). Empty by design: the automation:set-port gap this net found (DD8)
// was fixed at the time (main.js's automation:set-port handler broadcasts
// settings-changed), and stays fixed post-decomposition (register-settings-ipc.js's
// twin does too), so the net passes with ZERO allowlist entries — pinned by the
// dedicated test below.
/** @type {Set<string>} */
const ALLOWLIST = new Set([]);

/**
 * squawk 0003: the detection half was left as a raw substring test after squawk 0001
 * hardened the broadcast half to resolve module-scope helper wrappers — a handler that
 * mutates settings only INDIRECTLY, via a module-scope helper (e.g.
 * `const setPref = (k, v) => settings.set(k, v);` called from a handler body), contained
 * no marker of its own and was never classified as mutating at all, so it never even
 * reached the broadcast check. Mirrors the broadcast half's helper-crediting: a handler
 * is mutating if its OWN body contains a marker, OR it calls a module-scope helper (see
 * extractMutationHelperNames) whose own body contains one — UNLESS the handler's slice
 * locally shadows that helper's name (Finding B, see locallyShadowsName, reused as-is).
 *
 * Fail-safe asymmetry preserved: marker text appearing only in a string literal (not a
 * comment — maskComments already strips comments before this runs) can still produce a
 * false PASS-as-mutating (a false failure of the net, safe direction); a handler that
 * mutates only through an uncredited helper shape is the false PASS-as-clean this fix
 * closes, which is the unsafe direction.
 * @param {string} slice
 * @param {Set<string>} [mutationHelperNames] - names of module-scope helpers (see
 *   extractMutationHelperNames) whose OWN body contains a mutation marker; a handler
 *   that merely CALLS one of these counts as mutating, UNLESS the handler's own slice
 *   locally shadows the name (Finding B, see locallyShadowsName).
 */
function mutatesSettings(slice, mutationHelperNames) {
  if (MUTATION_MARKERS.some((m) => slice.includes(m))) return true;
  if (!mutationHelperNames) return false;
  for (const name of mutationHelperNames) {
    if (locallyShadowsName(slice, name)) continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(slice)) return true;
  }
  return false;
}

// squawk 0001, fix cycle 2, Finding A: the base check used to be a raw
// `slice.includes(BROADCAST_MARKER)` substring test — any incidental occurrence
// of the literal text `settings-changed` anywhere in a handler's own body
// (e.g. inside an unrelated string, like a code comment that survived masking
// as a string, or a local variable's value) passed it, with no requirement
// that the marker actually be an argument to a real broadcast call. Reproduced
// against production source by a second reviewer:
//   ipcMain.on('probe-inline-marker-string', () => {
//     settings.set('automationPort', 1);
//     const note = 'settings-changed is intentionally not sent for this internal counter';
//   });
// Tightened to the same call-shape discipline already applied to helper bodies
// (see BROADCAST_CALL_RE below): the marker must appear as the first argument
// of an actual call to `broadcast(` / `broadcastToChromeAndInternal(`.
//
// Two extra guards, added proactively while re-probing this exact fix (same
// class of defect the reviewer found twice already, one layer shallower each
// time — closed here rather than left for a third round):
//   - `(?<!\.)` rejects a METHOD call (`fakeBroadcast.broadcast('settings-changed', …)`)
//     — `\b` alone would credit a same-named method on an unrelated local decoy
//     object, since a `.` is a non-word character and still satisfies `\b`.
//   - the matched identifier itself (`broadcast` or `broadcastToChromeAndInternal`)
//     is captured and, before being credited, checked against `locallyShadowsName`
//     below — the exact Finding B guard, applied to the base primitive name
//     instead of a helper name, so a handler can't locally redeclare `broadcast`
//     as a no-op and call THAT.
const BASE_BROADCAST_CALL_RE = new RegExp(
  `(?<!\\.)\\b(broadcastToChromeAndInternal|broadcast)\\(\\s*(['"\`])${BROADCAST_MARKER}\\2`,
  'g'
);

/**
 * squawk 0001, fix cycle 2, Finding B: before crediting a handler's call to a
 * module-scope broadcast helper NAME, reject the credit if the handler's own
 * slice locally re-declares NAME — a `const`/`let`/`var`/`function` binding of
 * the same name inside the handler body shadows the real helper, so a call to
 * the shadowed name never reaches the module-scope broadcast at all. Reproduced
 * against production source by a second reviewer:
 *   ipcMain.on('probe-shadowed-name', () => {
 *     settings.set('automationPort', 1);
 *     const broadcastSettings = () => {};
 *     broadcastSettings();
 *   });
 * This is a text-level shadow guard, not scope resolution — see the disclosed
 * residual limitations in squawks/0001-broadcast-invariant-tripwire.md for the
 * shapes it deliberately does not attempt to close.
 *
 * squawk 0001, fix cycle 3: the direct-declaration check above requires NAME to
 * appear immediately after the declaration keyword, which a destructuring binding
 * defeats even though a declaration keyword IS present — reproduced against
 * production source by a third reviewer:
 *   const { broadcast } = { broadcast: () => {} };
 *   broadcast('settings-changed', 'noop');
 * (and the helper-name analog, `const { broadcastSettings } = {...};
 * broadcastSettings();`). Three more checks close this: object/array destructuring
 * bindings (`const { name } = ...` / `const [ name ] = ...`), and function-parameter
 * shadowing — both the parenthesized form (`(name) => {...}` / `function f(name) {...}`)
 * and the parenless single-param arrow form (`name => {...}`, the exact near-miss shape
 * already called out in this squawk's Disclosed Residual Limitations as a risk for the
 * bare-reassignment gap — closed here for the shadow check instead) — a parameter named
 * NAME shadows the outer binding for the whole function body, the same class one layer
 * shallower again. Residual gaps this still cannot reach (nested destructuring/parens,
 * catch-clause params, …) are named explicitly, not silently, in the squawk's Disclosed
 * Residual Limitations section.
 * @param {string} slice
 * @param {string} name
 * @returns {boolean}
 */
function locallyShadowsName(slice, name) {
  if (new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(slice)) return true;
  // Destructuring bindings: `const { name } = ...` (object) / `const [ name ] = ...` (array).
  if (new RegExp(`\\b(?:const|let|var)\\s+\\{[^}]*\\b${name}\\b`).test(slice)) return true;
  if (new RegExp(`\\b(?:const|let|var)\\s+\\[[^\\]]*\\b${name}\\b`).test(slice)) return true;
  // Function-parameter shadowing: `(..., name, ...) =>` (arrow) or
  // `function f(..., name, ...) {` (declaration/expression). Deliberately requires
  // `=>` or a `function` keyword immediately governing the parens, so an unrelated
  // `if (name) {` / `while (name) {` condition check isn't mistaken for a binding.
  if (new RegExp(`\\(([^()]*\\b${name}\\b[^()]*)\\)\\s*=>`).test(slice)) return true;
  if (new RegExp(`\\bfunction\\b[^{(]*\\(([^()]*\\b${name}\\b[^()]*)\\)`).test(slice)) return true;
  // Parenless single-param arrow: `name => {...}` (no surrounding parens at all).
  if (new RegExp(`\\b${name}\\s*=>`).test(slice)) return true;
  return false;
}

/**
 * @param {string} slice
 * @param {Set<string>} [broadcastHelperNames] - names of module-scope helpers
 *   (see extractBroadcastHelperNames) whose OWN body broadcasts settings-changed;
 *   a handler that merely CALLS one of these counts as broadcasting, UNLESS the
 *   handler's own slice locally shadows the name (Finding B, see
 *   locallyShadowsName).
 */
function broadcastsSettingsChanged(slice, broadcastHelperNames) {
  BASE_BROADCAST_CALL_RE.lastIndex = 0;
  let baseMatch;
  while ((baseMatch = BASE_BROADCAST_CALL_RE.exec(slice))) {
    if (!locallyShadowsName(slice, baseMatch[1])) return true;
  }
  if (!broadcastHelperNames) return false;
  for (const name of broadcastHelperNames) {
    if (locallyShadowsName(slice, name)) continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(slice)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Inline-callback registration-site extraction (main.js's original shape, now
// also the shape of six of the nine registrar modules — see REGISTRAR_FILES below).
// ---------------------------------------------------------------------------
const REGISTRATION_RE = /\bipcMain\.handle\(|\bipcMain\.on\(|\bregisterInternalHandler\(ipcMain,/g;

/**
 * @param {string} source
 * @returns {Array<{ label: string, slice: string }>}
 */
function extractMainRegistrations(source) {
  const masked = maskComments(source);
  /** @type {Array<{ label: string, slice: string }>} */
  const out = [];
  let m;
  REGISTRATION_RE.lastIndex = 0;
  while ((m = REGISTRATION_RE.exec(masked))) {
    // Every matched prefix's own '(' is the call's opening paren (true for both
    // `ipcMain.handle(` / `ipcMain.on(`, where it's the last matched char, and
    // `registerInternalHandler(ipcMain,`, where it's the first '(' after the
    // callee name) — so just take the first '(' from the match start.
    const openIdx = masked.indexOf('(', m.index);
    const closeIdx = findMatchingBracket(masked, openIdx, '(', ')');
    assert.notEqual(closeIdx, -1, `unbalanced call starting at offset ${m.index}`);
    const origSlice = source.slice(m.index, closeIdx + 1);
    const maskedSlice = masked.slice(m.index, closeIdx + 1);
    const chanMatch = origSlice.match(/'([^']+)'/);
    out.push({ label: chanMatch ? chanMatch[1] : `<offset ${m.index}>`, slice: maskedSlice });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Named-function-declaration extraction (jar-ipc.js's original shape, now also
// the shape of the remaining three registrar modules — see REGISTRAR_FILES below).
// Each handler is `function handleX(...) {...}` / `async function handleX(...) {...}`,
// registered by reference elsewhere (`ipcMain.handle('chan', handleX)`), so this
// scans by FUNCTION BODY instead of registration site — brace-balanced from the
// '{' after the parameter list.
// ---------------------------------------------------------------------------
const NAMED_FUNCTION_RE = /(?:async\s+)?function\s+(handle\w+)\s*\([^)]*\)\s*\{/g;

/**
 * @param {string} source
 * @returns {Array<{ label: string, slice: string }>}
 */
function extractNamedFunctionHandlers(source) {
  const masked = maskComments(source);
  /** @type {Array<{ label: string, slice: string }>} */
  const out = [];
  let m;
  NAMED_FUNCTION_RE.lastIndex = 0;
  while ((m = NAMED_FUNCTION_RE.exec(masked))) {
    const openIdx = m.index + m[0].length - 1; // the matched trailing '{'
    const closeIdx = findMatchingBracket(masked, openIdx, '{', '}');
    assert.notEqual(closeIdx, -1, `unbalanced function body for ${m[1]} at offset ${m.index}`);
    out.push({ label: m[1], slice: masked.slice(m.index, closeIdx + 1) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Module-scope broadcast-helper detection. register-settings-ipc.js DRYs its
// repeated `broadcast('settings-changed', settings.getAll())` call into a single
// `const broadcastSettings = () => broadcast('settings-changed', settings.getAll());`
// and has every mutating handler call `broadcastSettings()` instead — a real,
// desirable refactor that would otherwise read as a false-positive violation under
// a literal same-body string match. This finds any module-scope
// `const NAME = (...) => <expr>;` one-liner and credits NAME only when its body is
// ITSELF, at the top level, a direct call to a real broadcast primitive
// (`broadcast(...)` / `broadcastToChromeAndInternal(...)`) whose first argument is
// exactly the marker string literal — e.g. `=> broadcast('settings-changed', …)`.
// This is a deliberately narrower test than "the marker string appears somewhere in
// the body": a decoy helper such as
// `const fakeBroadcastHelper = () => 'settings-changed marker but does nothing';`
// must NOT be credited (squawk 0001 review finding) — its body doesn't call
// broadcast/broadcastToChromeAndInternal at all, it just happens to mention the
// marker text as an unrelated string literal.
// ---------------------------------------------------------------------------
const BROADCAST_HELPER_RE = /\bconst\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*([^{\n][^;\n]*);/g;
const BROADCAST_CALL_RE = /^\s*(?:broadcast|broadcastToChromeAndInternal)\(\s*(['"`])([^'"`]*)\1/;

/**
 * @param {string} source
 * @returns {Set<string>}
 */
function extractBroadcastHelperNames(source) {
  const masked = maskComments(source);
  /** @type {Set<string>} */
  const names = new Set();
  let m;
  BROADCAST_HELPER_RE.lastIndex = 0;
  while ((m = BROADCAST_HELPER_RE.exec(masked))) {
    const call = m[2].match(BROADCAST_CALL_RE);
    if (call && call[2] === BROADCAST_MARKER) names.add(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// squawk 0003: mutation-side mirror of extractBroadcastHelperNames. Finds any
// module-scope `const NAME = (...) => <expr>;` one-liner (the exact same shape
// register-settings-ipc.js already uses for broadcastSettings) and credits NAME only
// when its body is ITSELF, at the top level, a direct call to a real mutation
// primitive — e.g. `const setPref = (k, v) => settings.set(k, v);`. Mirrors the
// broadcast side's BROADCAST_CALL_RE anchor-at-start discipline (not a bare substring
// test over m[2]) for the same reason: a decoy such as
// `const fakeMutationHelper = () => 'settings.set( marker but does nothing';` must NOT
// be credited — its body doesn't call a mutation primitive at all, the marker text is
// just an unrelated string literal that happens to open with a quote, which the
// anchored regex rejects. Reuses BROADCAST_HELPER_RE (the shape scanned for is
// identical; only what's credited differs) rather than introducing a second
// helper-resolution mechanism.
// ---------------------------------------------------------------------------
const MUTATION_CALL_RE = /^\s*(?:settings\.set|mintJarKey|revokeJarKey|mintAdminKey|revokeAdminKey)\(/;

/**
 * @param {string} source
 * @returns {Set<string>}
 */
function extractMutationHelperNames(source) {
  const masked = maskComments(source);
  /** @type {Set<string>} */
  const names = new Set();
  let m;
  BROADCAST_HELPER_RE.lastIndex = 0;
  while ((m = BROADCAST_HELPER_RE.exec(masked))) {
    if (MUTATION_CALL_RE.test(m[2])) names.add(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// The nine registrar modules that replaced main.js/jar-ipc.js post-#99/#105,
// grouped by the extraction strategy that matches their known registration shape
// (verified by inspection; the per-group vacuity guards below fail loudly if a
// module's shape ever changes wholesale rather than silently scanning zero).
// ---------------------------------------------------------------------------
const MAIN_DIR = path.join(__dirname, '../../src/main');
const INLINE_CALLBACK_REGISTRARS = [
  'register-browser-ipc.js',
  'register-download-ipc.js',
  'register-overlay-ipc.js',
  'register-settings-ipc.js',
  'register-tab-ipc.js',
  'register-vault-ipc.js'
];
const NAMED_FUNCTION_REGISTRARS = ['register-bookmarks-ipc.js', 'jar-registry-ipc.js', 'jar-data-ipc.js'];

// ---------------------------------------------------------------------------
// The net (re-armed, squawk 0001): derives its handler inventory from the real
// registrar modules on disk, so a new settings-mutating handler added to any of
// the nine without a settings-changed broadcast fails this test without anyone
// editing it.
// ---------------------------------------------------------------------------
test('every settings-mutating registrar handler in production source broadcasts settings-changed', () => {
  /** @type {Array<{ label: string, slice: string }>} */
  const all = [];
  for (const file of INLINE_CALLBACK_REGISTRARS) {
    const source = fs.readFileSync(path.join(MAIN_DIR, file), 'utf8');
    const helperNames = extractBroadcastHelperNames(source);
    const mutationHelperNames = extractMutationHelperNames(source);
    const registrations = extractMainRegistrations(source);
    for (const r of registrations) {
      all.push({ label: `${file}:${r.label}`, slice: r.slice, helperNames, mutationHelperNames });
    }
  }
  for (const file of NAMED_FUNCTION_REGISTRARS) {
    const source = fs.readFileSync(path.join(MAIN_DIR, file), 'utf8');
    const helperNames = extractBroadcastHelperNames(source);
    const mutationHelperNames = extractMutationHelperNames(source);
    const handlers = extractNamedFunctionHandlers(source);
    for (const r of handlers) {
      all.push({ label: `${file}:${r.label}`, slice: r.slice, helperNames, mutationHelperNames });
    }
  }
  // Sanity: fail loudly if the extraction itself breaks (e.g. a future refactor
  // changes the registration shape) rather than silently scanning zero handlers.
  assert.ok(
    all.length > 140,
    `expected well over a hundred registrar handlers across nine modules, found ${all.length}`
  );

  const violations = all
    .filter(
      (r) => mutatesSettings(r.slice, r.mutationHelperNames) && !broadcastsSettingsChanged(r.slice, r.helperNames)
    )
    .filter((r) => !ALLOWLIST.has(r.label))
    .map((r) => r.label);
  assert.deepEqual(
    violations,
    [],
    `handler(s) mutate settings without broadcasting settings-changed: ${violations.join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// Runtime execution-order tests — complement the static net above (which proves
// text co-occurrence, not that the broadcast actually fires or fires in order).
// ---------------------------------------------------------------------------
test('every settings-mutating settings registrar handler broadcasts settings-changed at runtime', async () => {
  const h = makeSettingsIpcHarness();
  const mutations = [
    ['internal-settings-set', ['spellcheck', true]],
    ['automation:set-port', [45123]],
    ['automation:jar-key-mint', ['personal']],
    ['automation:jar-key-revoke', ['personal']],
    ['automation:admin-key-mint', []],
    ['automation:admin-key-revoke', []]
  ];
  for (const [channel, args] of mutations) {
    h.events.length = 0;
    await h.invokeInternal(channel, ...args);
    assert.equal(
      h.events.some((event) => event[0] === 'broadcast' && event[1] === 'settings-changed'),
      true,
      channel
    );
  }
  h.events.length = 0;
  h.send('unpin-toolbar-item', 'media');
  assert.equal(
    h.events.some((event) => event[0] === 'broadcast' && event[1] === 'settings-changed'),
    true
  );
});

test('jar removal revokes settings then broadcasts settings-changed before jars-changed', async (t) => {
  const harness = makeHarness(t);
  const result = await harness.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.deepEqual(
    harness.events
      .filter((event) => event.fn === 'revokeJarKey' || event.fn === 'broadcast')
      .map((event) => (event.fn === 'broadcast' ? event.channel : event.fn)),
    ['revokeJarKey', 'settings-changed', 'jars-changed']
  );
});

test('the allowlist is empty — the automation:set-port gap this net found is fixed, not allowlisted', () => {
  assert.equal(ALLOWLIST.size, 0);
});

// ---------------------------------------------------------------------------
// Regression insurance for the net's masking/marker logic itself (does not
// touch real source — the leg's manual "remove a broadcast and re-run" sanity
// check is a Verification Step done by hand, not committed as a mutation test).
// ---------------------------------------------------------------------------
test('mutatesSettings/broadcastsSettingsChanged classify a synthetic mutating-without-broadcasting handler', () => {
  const bad = "ipcMain.handle('x', () => { settings.set('k', 1); return true; })";
  const good =
    "ipcMain.handle('x', () => { settings.set('k', 1); broadcastToChromeAndInternal('settings-changed', settings.getAll()); })";
  assert.equal(mutatesSettings(bad), true);
  assert.equal(broadcastsSettingsChanged(bad), false);
  assert.equal(mutatesSettings(good), true);
  assert.equal(broadcastsSettingsChanged(good), true);
});

test('mutatesSettings credits a handler that mutates only indirectly, through a module-scope helper (squawk 0003)', () => {
  // The exact shape the squawk describes: a handler whose own body carries no
  // mutation marker at all, but which calls a module-scope helper that wraps one —
  // the same DRY shape register-settings-ipc.js already uses on the broadcast side
  // with broadcastSettings().
  const genuineMutationHelper = 'const setPref = (k, v) => settings.set(k, v);';
  const mutationHelperNames = extractMutationHelperNames(genuineMutationHelper);
  assert.deepEqual([...mutationHelperNames], ['setPref']);

  const handlerCallingHelper = "ipcMain.on('toggle-x', () => { setPref('k', 1); })";

  // Without the resolved helper names, the handler's own slice has no marker text at
  // all — this is the false PASS the squawk reports (regression baseline: proves the
  // fix, not just the helper of it, is doing the work).
  assert.equal(
    mutatesSettings(handlerCallingHelper),
    false,
    'a handler with no resolved helper names and no marker of its own must not be classified as mutating by chance'
  );
  // With the resolved helper names, the indirect mutation must be caught.
  assert.equal(mutatesSettings(handlerCallingHelper, mutationHelperNames), true);

  // The handler never broadcasts — end to end, this is a real violation: mutating
  // (indirectly) without broadcasting.
  assert.equal(broadcastsSettingsChanged(handlerCallingHelper), false);
  assert.equal(
    mutatesSettings(handlerCallingHelper, mutationHelperNames) && !broadcastsSettingsChanged(handlerCallingHelper),
    true,
    'a handler that mutates only through an uncredited helper and never broadcasts must be reported as a violation'
  );

  // A decoy helper that merely mentions the marker text (no real mutation call) must
  // not be credited — the exact class of squawk 0001's decoy finding, mirrored here.
  const decoyMutationHelper = "const fakeMutationHelper = () => 'settings.set( marker but does nothing';";
  assert.deepEqual(
    [...extractMutationHelperNames(decoyMutationHelper)],
    [],
    'a helper whose body only contains the marker as an unrelated string literal must not be credited'
  );

  // A handler locally shadowing the credited helper name must not be credited either
  // (Finding B, reused as-is for the mutation side).
  const shadowedHandler = "ipcMain.on('toggle-y', () => { const setPref = () => {}; setPref('k', 1); })";
  assert.equal(
    mutatesSettings(shadowedHandler, mutationHelperNames),
    false,
    'a locally-shadowed redeclaration of the mutation helper name must not be credited'
  );
});

test('extractBroadcastHelperNames credits a genuine broadcast helper but NOT a decoy that merely mentions the marker string (squawk 0001 review finding)', () => {
  const genuine = "const broadcastSettings = () => broadcast('settings-changed', settings.getAll());";
  const genuineViaFanout =
    "const broadcastSettings = () => broadcastToChromeAndInternal('settings-changed', settings.getAll());";
  const decoy = "const fakeBroadcastHelper = () => 'settings-changed marker but does nothing';";

  assert.deepEqual([...extractBroadcastHelperNames(genuine)], ['broadcastSettings']);
  assert.deepEqual([...extractBroadcastHelperNames(genuineViaFanout)], ['broadcastSettings']);
  assert.deepEqual(
    [...extractBroadcastHelperNames(decoy)],
    [],
    'a helper whose body only contains the marker as an unrelated string literal must not be credited'
  );

  // End-to-end through the consumer: a handler that calls the decoy (not a real
  // broadcast primitive) must still register as NOT broadcasting.
  const decoyHelperNames = extractBroadcastHelperNames(decoy);
  const handlerCallingDecoy = "ipcMain.on('toggle-x', () => { settings.set('k', 1); fakeBroadcastHelper(); })";
  assert.equal(broadcastsSettingsChanged(handlerCallingDecoy, decoyHelperNames), false);

  const genuineHelperNames = extractBroadcastHelperNames(genuine);
  const handlerCallingGenuine = "ipcMain.on('toggle-x', () => { settings.set('k', 1); broadcastSettings(); })";
  assert.equal(broadcastsSettingsChanged(handlerCallingGenuine, genuineHelperNames), true);
});

test('broadcastsSettingsChanged requires the marker as the first argument of an actual broadcast call, not a bare substring occurrence (squawk 0001 fix cycle 2, Finding A)', () => {
  // Reviewer's exact reproduction against production source (register-settings-ipc.js):
  // a mutating handler with no broadcast call at all, where the marker text merely
  // occurs, incidentally, inside an unrelated local string.
  const inlineMarkerString =
    "ipcMain.on('probe-inline-marker-string', () => { " +
    "settings.set('automationPort', 1); " +
    "const note = 'settings-changed is intentionally not sent for this internal counter'; " +
    '})';
  assert.equal(mutatesSettings(inlineMarkerString), true);
  assert.equal(
    broadcastsSettingsChanged(inlineMarkerString),
    false,
    'the marker string appearing outside a real broadcast(...) call must not count as broadcasting'
  );

  // The genuine shape — the marker as the literal first argument of a real call —
  // must still be credited, both spellings of the broadcast primitive.
  const realBroadcastCall =
    "ipcMain.on('x', () => { settings.set('k', 1); broadcast('settings-changed', settings.getAll()); })";
  const realFanoutCall =
    "ipcMain.on('x', () => { settings.set('k', 1); broadcastToChromeAndInternal('settings-changed', settings.getAll()); })";
  assert.equal(broadcastsSettingsChanged(realBroadcastCall), true);
  assert.equal(broadcastsSettingsChanged(realFanoutCall), true);
});

test('broadcastsSettingsChanged rejects a helper call when the handler locally shadows the helper name (squawk 0001 fix cycle 2, Finding B)', () => {
  // Reviewer's exact reproduction against production source (register-settings-ipc.js):
  // the handler locally redeclares `broadcastSettings` as a no-op and calls THAT,
  // never reaching the real module-scope helper.
  const genuine = "const broadcastSettings = () => broadcast('settings-changed', settings.getAll());";
  const genuineHelperNames = extractBroadcastHelperNames(genuine);

  const shadowedNameConst =
    "ipcMain.on('probe-shadowed-name', () => { " +
    "settings.set('automationPort', 1); " +
    'const broadcastSettings = () => {}; ' +
    'broadcastSettings(); ' +
    '})';
  assert.equal(mutatesSettings(shadowedNameConst), true);
  assert.equal(
    broadcastsSettingsChanged(shadowedNameConst, genuineHelperNames),
    false,
    'a locally-shadowed const redeclaration of the helper name must not be credited'
  );

  // Also cover let/var/function shadowing shapes, not just const.
  const shadowedNameLet =
    "ipcMain.on('probe-shadowed-let', () => { settings.set('k', 1); let broadcastSettings = () => {}; broadcastSettings(); })";
  const shadowedNameVar =
    "ipcMain.on('probe-shadowed-var', () => { settings.set('k', 1); var broadcastSettings = () => {}; broadcastSettings(); })";
  const shadowedNameFunction =
    "ipcMain.on('probe-shadowed-fn', () => { settings.set('k', 1); function broadcastSettings() {} broadcastSettings(); })";
  assert.equal(broadcastsSettingsChanged(shadowedNameLet, genuineHelperNames), false);
  assert.equal(broadcastsSettingsChanged(shadowedNameVar, genuineHelperNames), false);
  assert.equal(broadcastsSettingsChanged(shadowedNameFunction, genuineHelperNames), false);

  // An unshadowed call to the same real helper name must still be credited.
  const handlerCallingGenuine = "ipcMain.on('toggle-x', () => { settings.set('k', 1); broadcastSettings(); })";
  assert.equal(broadcastsSettingsChanged(handlerCallingGenuine, genuineHelperNames), true);
});

test('broadcastsSettingsChanged rejects a decoy METHOD call and a locally-shadowed base broadcast identifier (proactive hardening found while re-probing squawk 0001)', () => {
  // A same-named METHOD on an unrelated local object must not be credited —
  // `\b` alone is satisfied across a `.`, so a naive call-shape check would
  // credit `fakeBroadcast.broadcast('settings-changed', …)` even though it
  // never reaches the real broadcast primitive.
  const decoyMethodCall =
    "ipcMain.on('probe-decoy-method', () => { " +
    "settings.set('automationPort', 1); " +
    'const fakeBroadcast = { broadcast: () => {} }; ' +
    "fakeBroadcast.broadcast('settings-changed', 'noop'); " +
    '})';
  assert.equal(mutatesSettings(decoyMethodCall), true);
  assert.equal(
    broadcastsSettingsChanged(decoyMethodCall),
    false,
    'a method call on an unrelated local object must not satisfy the base check'
  );

  // A handler that locally shadows `broadcast` ITSELF as a no-op and calls the
  // shadowed name must not be credited — the same Finding B class, one layer
  // deeper (the base primitive rather than a named helper).
  const shadowedBasePrimitive =
    "ipcMain.on('probe-shadowed-broadcast', () => { " +
    "settings.set('automationPort', 1); " +
    'const broadcast = () => {}; ' +
    "broadcast('settings-changed', 'noop'); " +
    '})';
  assert.equal(mutatesSettings(shadowedBasePrimitive), true);
  assert.equal(
    broadcastsSettingsChanged(shadowedBasePrimitive),
    false,
    'a locally-shadowed redeclaration of the base broadcast identifier must not be credited'
  );

  // A genuine, unshadowed direct call must still be credited (no regression).
  const realDirectCall =
    "ipcMain.on('x', () => { settings.set('k', 1); broadcast('settings-changed', settings.getAll()); })";
  assert.equal(broadcastsSettingsChanged(realDirectCall), true);
});

test('broadcastsSettingsChanged rejects destructuring-pattern shadowing of the base identifier and of a credited helper name (squawk 0001 fix cycle 3, third-review finding)', () => {
  // Third reviewer's exact reproduction against production source: a declaration
  // keyword IS present (`const`), but NAME never appears directly after it — it's
  // bound via an object-destructuring pattern instead, defeating the pre-fix
  // `\b(?:const|let|var|function)\s+${name}\b` check even though this is genuinely
  // a local shadow of the real module-scope `broadcast`.
  const destructuredBasePrimitive =
    "ipcMain.on('probe-destructure-shadow', () => { " +
    "settings.set('automationPort', 1); " +
    'const { broadcast } = { broadcast: () => {} }; ' +
    "broadcast('settings-changed', 'noop'); " +
    '})';
  assert.equal(mutatesSettings(destructuredBasePrimitive), true);
  assert.equal(
    broadcastsSettingsChanged(destructuredBasePrimitive),
    false,
    'an object-destructured local binding of the base broadcast identifier must not be credited'
  );

  // The array-destructuring form must be caught too.
  const arrayDestructuredBasePrimitive =
    "ipcMain.on('probe-array-destructure-shadow', () => { " +
    "settings.set('automationPort', 1); " +
    'const [broadcast] = [() => {}]; ' +
    "broadcast('settings-changed', 'noop'); " +
    '})';
  assert.equal(
    broadcastsSettingsChanged(arrayDestructuredBasePrimitive),
    false,
    'an array-destructured local binding of the base broadcast identifier must not be credited'
  );

  // The helper-name analog: a credited module-scope helper's NAME is shadowed via
  // destructuring instead of a direct `const NAME = ...` redeclaration.
  const genuine = "const broadcastSettings = () => broadcast('settings-changed', settings.getAll());";
  const genuineHelperNames = extractBroadcastHelperNames(genuine);
  const destructuredHelperName =
    "ipcMain.on('probe-destructure-helper-shadow', () => { " +
    "settings.set('automationPort', 1); " +
    'const { broadcastSettings } = { broadcastSettings: () => {} }; ' +
    'broadcastSettings(); ' +
    '})';
  assert.equal(mutatesSettings(destructuredHelperName), true);
  assert.equal(
    broadcastsSettingsChanged(destructuredHelperName, genuineHelperNames),
    false,
    'an object-destructured local binding of a credited helper name must not be credited'
  );

  // A genuine, unshadowed direct call must still be credited (no regression).
  const realDirectCall =
    "ipcMain.on('x', () => { settings.set('k', 1); broadcast('settings-changed', settings.getAll()); })";
  assert.equal(broadcastsSettingsChanged(realDirectCall), true);
});

test('broadcastsSettingsChanged rejects function-parameter shadowing of the base identifier (squawk 0001 fix cycle 3, third-review finding — contrived shape, closed for the same class)', () => {
  // A parameter named `broadcast` shadows the outer binding for the whole callback
  // body — the same shadowing class as a local re-declaration, one layer deeper
  // again. Contrived for a real `ipcMain.on` callback (whose params are event-then-
  // args), but the same class the reviewer flagged, so it's closed rather than left.
  const paramShadowedBasePrimitive =
    "ipcMain.on('probe-param-shadow', (broadcast) => { " +
    "settings.set('automationPort', 1); " +
    "broadcast('settings-changed', 'noop'); " +
    '})';
  assert.equal(mutatesSettings(paramShadowedBasePrimitive), true);
  assert.equal(
    broadcastsSettingsChanged(paramShadowedBasePrimitive),
    false,
    'a parameter-bound local shadow of the base broadcast identifier must not be credited'
  );

  // The parenless single-param arrow form (`name => {...}`, no surrounding parens at
  // all) is the exact near-miss shape already flagged in this squawk's Disclosed
  // Residual Limitations as a risk for the bare-reassignment regex — closed here for
  // the shadow check, since it's a real, uncontrived JS shape (unlike the parenthesized
  // probe above, which is contrived for a real ipcMain.on callback).
  const parenlessParamShadow =
    "ipcMain.on('probe-parenless-param-shadow', broadcast => { " +
    "settings.set('automationPort', 1); " +
    "broadcast('settings-changed', 'noop'); " +
    '})';
  assert.equal(mutatesSettings(parenlessParamShadow), true);
  assert.equal(
    broadcastsSettingsChanged(parenlessParamShadow),
    false,
    'a parenless single-param arrow shadow of the base broadcast identifier must not be credited'
  );

  // A genuine, unshadowed direct call must still be credited (no regression).
  const realDirectCall =
    "ipcMain.on('x', () => { settings.set('k', 1); broadcast('settings-changed', settings.getAll()); })";
  assert.equal(broadcastsSettingsChanged(realDirectCall), true);
});

test('maskComments blanks comment bodies but leaves string literal contents (incl. embedded //) untouched', () => {
  // The URL string lives in real CODE here (not inside the comment) — a // line
  // comment legitimately consumes everything to the newline, quotes included, so
  // testing "strings survive" requires the string to sit outside the comment.
  const src = "const url = 'http://x'; // settings.set(  not real code\nconst b = /* mintJarKey( */ 2;";
  const masked = maskComments(src);
  assert.equal(masked.length, src.length);
  assert.ok(!masked.includes('settings.set('));
  assert.ok(!masked.includes('mintJarKey('));
  assert.ok(masked.includes("'http://x'")); // string content (with its own //) survives
  assert.ok(masked.includes('const url ='));
  assert.ok(masked.includes('const b ='));
});

test('a registration-shaped mention inside a comment (main.js:996 precedent) is not picked up as a real registration', () => {
  const src = "// see ipcMain.handle('tab-create') for details\nipcMain.handle('real-channel', () => {});";
  const registrations = extractMainRegistrations(src);
  assert.deepEqual(
    registrations.map((r) => r.label),
    ['real-channel']
  );
});

// ---------------------------------------------------------------------------
// bookmarks-changed no-snapshot contract (M15 Flight 1 "Bookmarking Core and
// Surfaces" Leg 1 / DD3, AC5; jar-addressed M15 Flight 2 "Jar-Scoped
// Bookmarks" Leg 2 / flight DD5): every mutation (add/update/remove/reorder)
// broadcasts `bookmarks-changed` with `{ jarId }` — invalidation-not-
// snapshot, the jars-changed/history-changed precedent, pinned here at the
// IPC-wiring level (the store's own unit tests cover the mutation contracts
// themselves) — a real registerBookmarksIpc instance over a real (temp-dir,
// real app-db) bookmarksStore, exercising every channel end-to-end. The
// harness's `jars` stub registers exactly one jar id ('personal') — every
// invoke() payload below carries that jarId, else L2-DD-C's registry
// rejection would fail every test with `unknown-jar`.
// ---------------------------------------------------------------------------

const JAR_ID = 'personal';

function makeBookmarksIpcHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bookmarks-ipc-'));
  appDb.open(dir);
  const resolved = require.resolve('../../src/main/bookmarks-store');
  delete require.cache[resolved];
  const bookmarksStore = require('../../src/main/bookmarks-store');
  bookmarksStore.load(dir);

  const jars = {
    list: () => [{ id: JAR_ID, name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' }]
  };

  /** @type {Array<{ channel: string, payload: any }>} */
  const events = [];
  const handlers = {};
  const ipcMain = {
    handle: (channel, fn) => {
      handlers[channel] = fn;
    }
  };
  const broadcast = (channel, payload) => events.push({ channel, payload });

  registerBookmarksIpc({ ipcMain, bookmarksStore, jars, broadcast });

  return {
    events,
    invoke: (channel, payload) => handlers[channel](null, payload),
    teardown: () => {
      appDb.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('bookmark-add (created) broadcasts bookmarks-changed with { jarId }', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const result = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.deepEqual(h.events, [{ channel: 'bookmarks-changed', payload: { jarId: JAR_ID } }]);
});

test('bookmark-add (duplicate URL, DD2 idempotent) does NOT re-broadcast', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  h.events.length = 0;
  const second = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  assert.equal(second.created, false);
  assert.deepEqual(h.events, [], 'a duplicate add — Edge Case: only ONE broadcast is needed');
});

test('bookmark-add with an invalid url does NOT broadcast', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const result = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'javascript:alert(1)' });
  assert.equal(result.ok, false);
  assert.deepEqual(h.events, []);
});

test('bookmark-add with an unknown jarId returns unknown-jar and does NOT broadcast (L2-DD-C)', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const result = await h.invoke('bookmark-add', { jarId: 'nope', url: 'https://example.com/' });
  assert.deepEqual(result, { ok: false, reason: 'unknown-jar' });
  assert.deepEqual(h.events, []);
});

test('bookmark-update broadcasts bookmarks-changed with { jarId }', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const { bookmark } = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  h.events.length = 0;
  const result = await h.invoke('bookmark-update', { jarId: JAR_ID, id: bookmark.id, title: 'New title' });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events, [{ channel: 'bookmarks-changed', payload: { jarId: JAR_ID } }]);
});

test('bookmark-update rejected by the DD3/AC3 duplicate-url ruling does NOT broadcast', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://a.example/' });
  const b = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://b.example/' });
  h.events.length = 0;
  const result = await h.invoke('bookmark-update', { jarId: JAR_ID, id: b.bookmark.id, url: 'https://a.example/' });
  assert.deepEqual(result, { ok: false, reason: 'duplicate-url' });
  assert.deepEqual(h.events, []);
});

test('bookmark-update with an unknown jarId returns unknown-jar and does NOT broadcast', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const { bookmark } = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  h.events.length = 0;
  const result = await h.invoke('bookmark-update', { jarId: 'nope', id: bookmark.id, title: 'x' });
  assert.deepEqual(result, { ok: false, reason: 'unknown-jar' });
  assert.deepEqual(h.events, []);
});

test('bookmark-remove broadcasts bookmarks-changed with { jarId }', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const { bookmark } = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  h.events.length = 0;
  const result = await h.invoke('bookmark-remove', { jarId: JAR_ID, id: bookmark.id });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events, [{ channel: 'bookmarks-changed', payload: { jarId: JAR_ID } }]);
});

test('bookmark-remove of an unknown id does NOT broadcast', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const result = await h.invoke('bookmark-remove', { jarId: JAR_ID, id: 'nope' });
  assert.deepEqual(result, { ok: false, reason: 'not-found' });
  assert.deepEqual(h.events, []);
});

test('bookmark-remove with an unknown jarId returns unknown-jar and does NOT broadcast', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const { bookmark } = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  h.events.length = 0;
  const result = await h.invoke('bookmark-remove', { jarId: 'nope', id: bookmark.id });
  assert.deepEqual(result, { ok: false, reason: 'unknown-jar' });
  assert.deepEqual(h.events, []);
});

test('bookmark-reorder broadcasts bookmarks-changed with { jarId }', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const a = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://a.example/' });
  const b = await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://b.example/' });
  h.events.length = 0;
  const result = await h.invoke('bookmark-reorder', { jarId: JAR_ID, ids: [b.bookmark.id, a.bookmark.id] });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events, [{ channel: 'bookmarks-changed', payload: { jarId: JAR_ID } }]);
});

test('bookmark-reorder with an unknown jarId returns unknown-jar and does NOT broadcast', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  const result = await h.invoke('bookmark-reorder', { jarId: 'nope', ids: [] });
  assert.deepEqual(result, { ok: false, reason: 'unknown-jar' });
  assert.deepEqual(h.events, []);
});

test('bookmarks-get is a pure read — never broadcasts, and skips the registry check (L2-DD-C)', async (t) => {
  const h = makeBookmarksIpcHarness();
  t.after(h.teardown);
  await h.invoke('bookmark-add', { jarId: JAR_ID, url: 'https://example.com/' });
  h.events.length = 0;
  const result = await h.invoke('bookmarks-get', { jarId: JAR_ID });
  assert.equal(result.length, 1);
  assert.deepEqual(h.events, []);
  // An unknown jar naturally yields zero rows rather than a rejection — a
  // read must never fail during the jar-delete race window.
  assert.deepEqual(await h.invoke('bookmarks-get', { jarId: 'nope' }), []);
});
