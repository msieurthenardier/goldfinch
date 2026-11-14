'use strict';

// Standing guard for the GUEST preload's outbound IPC (Mission 23 Flight 1, leg
// `ipc-gate-complete`, DD3). Every `ipcRenderer.send` / `sendSync` / `invoke` in the guest preload
// SOURCES passes a string LITERAL channel, and the set of literals equals the classification
// table's `tab-guest` set, in both directions.
//
// What this is worth, stated honestly: a page can come to hold the preload's IPC object (probe
// Q1), so a literal send is HARDENING, not the boundary — a page that reaches the object can name
// any channel. The boundary is the main-side class check (`ipc-gate.js`); this test only keeps the
// guest's own surface small, readable and in step with the table.
//
// It scans the four SOURCE files (comments masked), never the generated bundle.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments } = require('../helpers/source-scan');
const { CHANNEL_CLASS } = require('../../src/main/ipc-channel-table');
const { sendPlannedCapture } = require('../../src/preload/vault-capture-plan');

const PRELOAD_DIR = path.join(__dirname, '../../src/preload');
const GUEST_SOURCES = ['webview-preload.js', 'vault-fill-icon.js', 'guest-bookmark-drop.js', 'vault-capture-plan.js'];

const SEND_RE = /\bipcRenderer\w*\s*\.\s*(send|sendSync|invoke)\s*\(\s*/g;

/**
 * Every ipcRenderer send/sendSync/invoke call in `source`: its channel when the first argument is
 * a plain string literal, else the offending text.
 * @param {string} source
 * @returns {{ literals: string[], nonLiteral: string[] }}
 */
function scanSends(source) {
  const masked = maskComments(source);
  /** @type {string[]} */
  const literals = [];
  /** @type {string[]} */
  const nonLiteral = [];
  SEND_RE.lastIndex = 0;
  while (SEND_RE.exec(masked)) {
    const rest = masked.slice(SEND_RE.lastIndex);
    const lit = rest.match(/^(['"])([^'"\\\n]*)\1\s*[,)]/);
    if (lit) literals.push(lit[2]);
    else nonLiteral.push(rest.slice(0, 40).split('\n')[0]);
  }
  return { literals, nonLiteral };
}

/** @param {string} file */
const readSource = (file) => fs.readFileSync(path.join(PRELOAD_DIR, file), 'utf8');

const TAB_GUEST_CHANNELS = Object.keys(CHANNEL_CLASS)
  .filter((c) => CHANNEL_CLASS[c] === 'tab-guest')
  .sort();

test('every guest-preload send passes a string-literal channel', () => {
  for (const file of GUEST_SOURCES) {
    const { literals, nonLiteral } = scanSends(readSource(file));
    assert.deepEqual(nonLiteral, [], `${file}: a non-literal first argument`);
    assert.ok(literals.length > 0 || file === 'vault-capture-plan.js', `${file}: scan found no sends (vacuous?)`);
  }
});

test("the literal channels the guest preload sources send are exactly the table's tab-guest set (both directions)", () => {
  const sent = new Set();
  for (const file of GUEST_SOURCES) for (const c of scanSends(readSource(file)).literals) sent.add(c);
  assert.equal(TAB_GUEST_CHANNELS.length, 13);
  assert.deepEqual([...sent].sort(), TAB_GUEST_CHANNELS);
});

test("internal-preload.js's one guest-class send is guest-tab-boundary", () => {
  const { literals, nonLiteral } = scanSends(readSource('internal-preload.js'));
  assert.deepEqual(nonLiteral, [], 'internal-preload.js: a non-literal first argument');
  const guestClass = literals.filter((c) => CHANNEL_CLASS[c] === 'tab-guest');
  assert.deepEqual(guestClass, ['guest-tab-boundary']);
  // every other channel it names is an internal-class invoke (or the one chrome-or-internal read)
  for (const c of literals.filter((x) => x !== 'guest-tab-boundary')) {
    assert.ok(['internal', 'chrome-or-internal'].includes(CHANNEL_CLASS[c]), `${c} is ${CHANNEL_CLASS[c]}`);
  }
});

test('the scan is real: a non-literal channel, a template channel and a missing literal are all caught', () => {
  assert.deepEqual(scanSends(`ipcRenderer.send(c.channel, c.payload);`).nonLiteral.length, 1);
  assert.deepEqual(scanSends('ipcRenderer.send(`x-${k}`, 1);').nonLiteral.length, 1);
  assert.deepEqual(scanSends(`ipcRenderer.send(NAME);`).nonLiteral.length, 1);
  assert.deepEqual(scanSends(`ipcRenderer.sendSync('a'); ipcRenderer.invoke("b", 1); ipcRenderer.send('c')`).literals, [
    'a',
    'b',
    'c'
  ]);
  // a send that only appears in a comment is not seen
  assert.deepEqual(scanSends(`// ipcRenderer.send(x)\n/* ipcRenderer.send(y) */`), { literals: [], nonLiteral: [] });
  // neuter (set direction): a source that sends one fewer channel differs from the table set
  const sent = new Set();
  for (const file of GUEST_SOURCES) for (const c of scanSends(readSource(file)).literals) sent.add(c);
  const without = [...sent].filter((c) => c !== 'guest-privacy-fp').sort();
  assert.notDeepEqual(without, TAB_GUEST_CHANNELS);
  // neuter (set direction, extra): a planted extra channel differs too
  assert.notDeepEqual([...sent, 'zz-planted'].sort(), TAB_GUEST_CHANNELS);
});

test("the capture-plan dispatch: each kind's literal send equals the channel its planner stamps (drift pin); an unknown kind sends nothing", () => {
  const planSource = maskComments(readSource('vault-capture-plan.js'));
  const pairs = [...planSource.matchAll(/kind:\s*'(login|card|identity)',\s*channel:\s*'([\w-]+)'/g)].map((m) => [
    m[1],
    m[2]
  ]);
  assert.ok(pairs.length >= 3, 'the planners stamp their channels');
  const kinds = new Set(pairs.map(([k]) => k));
  assert.deepEqual([...kinds].sort(), ['card', 'identity', 'login']);
  for (const [kind, channel] of pairs) {
    const sends = [];
    sendPlannedCapture({ send: (...a) => sends.push(a) }, { kind, payload: { p: kind } });
    assert.deepEqual(
      sends,
      [[channel, { p: kind }]],
      `${kind} must send on the channel its planner names (${channel})`
    );
  }
  const none = [];
  sendPlannedCapture({ send: (...a) => none.push(a) }, { kind: 'password-reset', payload: {} });
  sendPlannedCapture({ send: (...a) => none.push(a) }, { kind: '__proto__', payload: {} });
  assert.deepEqual(none, [], 'an unknown kind is never sent (never a login fallback)');
});

test('webview-preload dispatches each plan entry through the per-kind helper inside its own try (no early return in the loop)', () => {
  const src = maskComments(readSource('webview-preload.js'));
  const at = src.indexOf('sendPlannedCapture(ipcRenderer, c)');
  assert.notEqual(at, -1, 'the capture loop sends through sendPlannedCapture');
  const loopStart = src.lastIndexOf('for (const c of plan)', at);
  assert.notEqual(loopStart, -1);
  const loop = src.slice(loopStart, src.indexOf('\n    }\n', at) + 7);
  assert.match(loop, /try\s*\{[\s\S]*sendPlannedCapture\(ipcRenderer, c\);[\s\S]*armGestureDetachWatch/);
  assert.match(loop, /catch\s*\{/);
  assert.doesNotMatch(loop, /\breturn\b/, 'one family failing must never stop the rest');
});
