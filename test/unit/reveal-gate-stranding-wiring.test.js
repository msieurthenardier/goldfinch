'use strict';

// Mission 23 Flight 2, leg `hat-and-alignment`, fix 1 (a confirmation could strand its window): source-scan
// pins for the wiring of rules 2 and 3 (and rule 1's `isActive`), plus a direct test that the single
// tab-lifecycle fan-out reaches the gate. Each pin is run on the real source and on a mutation that must flip
// it (`assertMutated` guards each mutation against a stale `.replace()` target).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments } = require('../helpers/source-scan');
const { onTabLeftFront } = require('../../src/main/register-tab-ipc');

const MAIN = path.join(__dirname, '..', '..', 'src', 'main');
const read = (f) => fs.readFileSync(path.join(MAIN, f), 'utf8');
const assertMutated = (before, after, what) =>
  assert.notEqual(after, before, `the ${what} mutation did not apply - the .replace() target is stale`);

/** The argument text of every `onTabLeftFront(` call (not the declaration) in a source. */
function dropCalls(src) {
  const m = maskComments(src);
  const out = [];
  const re = /(?<!function )onTabLeftFront\(/g;
  let x;
  while ((x = re.exec(m))) {
    let depth = 0;
    let i = m.indexOf('(', x.index);
    const start = i;
    for (; i < m.length; i++) {
      if (m[i] === '(') depth++;
      else if (m[i] === ')' && --depth === 0) break;
    }
    out.push(m.slice(start, i + 1));
  }
  return out;
}

function failingPins({ tabSrc, fsSrc, mainSrc, wiringSrc, factorySrc, sendersSrc }) {
  const fails = [];
  const tabCalls = dropCalls(tabSrc);
  const fsCalls = dropCalls(fsSrc);
  if (tabCalls.length !== 5) fails.push(`register-tab-ipc.js has 5 onTabLeftFront call sites (${tabCalls.length})`);
  if (fsCalls.length !== 1) fails.push('html-fullscreen.js has 1 onTabLeftFront call site');
  if (!tabCalls.every((c) => /tabInactive:\s*revealTabInactive,?\s*\}\s*\)$/.test(c)))
    fails.push('every register-tab-ipc.js site passes revealTabInactive');
  if (!fsCalls.every((c) => /tabInactive:\s*revealTabInactive,?\s*\}\s*\)$/.test(c)))
    fails.push('html-fullscreen.js site passes revealTabInactive');
  if (!/tabInactive\?\.\(wcId\)/.test(maskComments(tabSrc))) fails.push('onTabLeftFront calls tabInactive');
  const mm = maskComments(mainSrc);
  if (
    !/registerTabIpc\(\{(?:(?!\n\}\);)[\s\S])*?revealTabInactive:\s*\(wcId\)\s*=>\s*revealGate\.tabInactive\(wcId\)/.test(
      mm
    )
  )
    fails.push('main.js hands registerTabIpc the gate tabInactive');
  if (
    !/createHtmlFullscreen\(\{(?:(?!\n\}\);)[\s\S])*?revealTabInactive:\s*\(wcId\)\s*=>\s*revealGate\.tabInactive\(wcId\)/.test(
      mm
    )
  )
    fails.push('main.js hands createHtmlFullscreen the gate tabInactive');
  if (!/createRevealGate\(\{(?:(?!\n\}\);)[\s\S])*?\.\.\.createGateSenderResolvers\(registry\)/.test(mm))
    fails.push('main.js gives the gate the shared sender resolvers (which carry the active-tab predicate)');
  if (
    !/isActive\(sender\)\s*\{[\s\S]*?getWindowForGuest\(sender\.id\);\s*if \(g\) return g\.activeTabWcId === sender\.id;/.test(
      maskComments(sendersSrc)
    )
  )
    fails.push('the sender resolvers keep the guest active-tab predicate');
  if (
    !/createGuestWiring\(\{(?:(?!\n\}\);)[\s\S])*?revealWindowInput:\s*\(win\)\s*=>\s*revealGate\.windowInput\(win\)/.test(
      mm
    )
  )
    fails.push('main.js hands the guest wiring the gate windowInput');
  if (
    !/createWindowFactory\(\{(?:(?!\n\}\);)[\s\S])*?revealWindowInput:\s*\(win\)\s*=>\s*revealGate\.windowInput\(win\)/.test(
      mm
    )
  )
    fails.push('main.js hands the window factory the gate windowInput');
  // Listener shape, on every tab guest (the block must NOT sit under the witness's internal-contents guard)
  const w = maskComments(wiringSrc);
  const wb = /if \(revealWindowInput\) \{\s*wc\.on\('input-event'[\s\S]*?\n {4}\}\n/.exec(w);
  if (!wb) fails.push('guest-wiring.js has the reveal input listener block');
  else {
    const b = wb[0];
    if (!/handleRevealInputEvent\(\{/.test(b)) fails.push('guest listener calls the shared handleRevealInputEvent');
    if (!/\binjectedInput,/.test(b) || !/\bwcId,/.test(b)) fails.push('guest listener passes wcId and injectedInput');
    if (/isAutoRepeat|input\.type/.test(b)) fails.push('guest listener has no private input filter');
    if (/isInternalContents/.test(b)) fails.push('guest listener covers internal tabs');
    if (!/windowInput:\s*revealWindowInput/.test(b)) fails.push('guest listener hands the gate windowInput');
  }
  if (/before-mouse-event/.test(w.slice(w.indexOf('revealWindowInput'))))
    fails.push('no before-mouse-event after the gate listener');
  const f = maskComments(factorySrc);
  const fb = /if \(revealWindowInput\) \{\s*chromeView\.webContents\.on\('input-event'[\s\S]*?\n {4}\}\n/.exec(f);
  if (!fb) fails.push('window-factory.js has the chrome view reveal input listener');
  else {
    const b = fb[0];
    if (!/handleRevealInputEvent\(\{/.test(b)) fails.push('chrome listener calls the shared handleRevealInputEvent');
    if (!/\binjectedInput,/.test(b) || !/wcId:\s*chromeView\.webContents\.id/.test(b))
      fails.push('chrome listener passes wcId and injectedInput');
    if (/isAutoRepeat|input\.type/.test(b)) fails.push('chrome listener has no private input filter');
    if (!/windowInput:\s*revealWindowInput/.test(b)) fails.push('chrome listener hands the gate windowInput');
  }
  return fails;
}

const REAL = {
  tabSrc: read('register-tab-ipc.js'),
  fsSrc: read('html-fullscreen.js'),
  mainSrc: read('main.js'),
  wiringSrc: read('guest-wiring.js'),
  factorySrc: read('window-factory.js'),
  sendersSrc: read('reveal-gate-senders.js')
};

test('every stranding-fix wiring pin holds on the real source', () => {
  assert.deepEqual(failingPins(REAL), []);
});

test('each pin flips when its wiring is removed (neuter-verified)', () => {
  const muts = [
    [
      'tabSrc',
      /'tab-close',\s*\{\s*vaultHuman: vaultHuman\?\.\(\),\s*tabInactive: revealTabInactive\s*\}\)/,
      "'tab-close', { vaultHuman: vaultHuman?.() })",
      'tab-close site'
    ],
    ['tabSrc', /tabInactive\?\.\(wcId\);/, 'void 0;', 'fan-out call'],
    [
      'fsSrc',
      /\{\s*vaultHuman: vaultHuman\(\),\s*tabInactive: revealTabInactive\s*\}\)/,
      '{ vaultHuman: vaultHuman() })',
      'html-fullscreen site'
    ],
    ['mainSrc', /\.\.\.createGateSenderResolvers\(registry\),?/, '', 'sender resolvers spread'],
    [
      'sendersSrc',
      /if \(g\) return g\.activeTabWcId === sender\.id;/,
      'if (g) return true;',
      'guest active-tab predicate'
    ],
    [
      'mainSrc',
      /revealTabInactive:\s*\(wcId\)\s*=>\s*revealGate\.tabInactive\(wcId\),\n\s*\/\/ Squawk|revealTabInactive:\s*\(wcId\)\s*=>\s*revealGate\.tabInactive\(wcId\),/,
      '',
      'main tabInactive'
    ],
    ['wiringSrc', /handleRevealInputEvent\(\{/, 'void ({', 'guest shared call'],
    ['wiringSrc', /\n\s*injectedInput,\n\s*win:/, '\n win:', 'guest injectedInput arg'],
    ['wiringSrc', /windowInput:\s*revealWindowInput/, 'windowInput: () => {}', 'guest gate arg'],
    ['factorySrc', /handleRevealInputEvent\(\{/, 'void ({', 'chrome shared call'],
    ['factorySrc', /\n\s*injectedInput,\n\s*win,/, '\n win,', 'chrome injectedInput arg'],
    ['factorySrc', /windowInput:\s*revealWindowInput/, 'windowInput: () => {}', 'chrome gate arg']
  ];
  for (const [key, re, to, what] of muts) {
    const after = REAL[key].replace(re, to);
    assertMutated(REAL[key], after, what);
    assert.ok(failingPins({ ...REAL, [key]: after }).length > 0, `${what} must flip a pin`);
  }
});

test('the fan-out reaches the gate: onTabLeftFront calls tabInactive with the tab id, and survives a throw', () => {
  const seen = [];
  onTabLeftFront(null, 42, 'tab-switch', { tabInactive: (id) => seen.push(id) });
  assert.deepEqual(seen, [42]);
  assert.doesNotThrow(() =>
    onTabLeftFront(null, 1, 'tab-hide', {
      tabInactive: () => {
        throw new Error('x');
      }
    })
  );
  assert.doesNotThrow(() => onTabLeftFront(null, 1, 'tab-hide'));
});
