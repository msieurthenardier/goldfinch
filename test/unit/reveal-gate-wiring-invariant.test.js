'use strict';

// Mission 23 Flight 2 (leg `admin-reach`, flight DD2) - source-scan invariants for the reveal gate's wiring.
// The fallbacks are SILENT (an engine without the setter simply never marks a document; a handler that
// skips the gate simply answers), so a half-wired seam produces no failure anywhere else - the house
// dual-site grep-pin convention (see sheet-automation-gate-invariant.test.js AC9). Every pin is run on the
// real source AND on a mutation that must flip it (neuter-verified; `assertMutated` guards each mutation so a
// stale `.replace()` target cannot pass vacuously).
//
// NO TEST IN THIS REPO LOADS main.js (test/helpers/source-scan.js), so main.js is scanned, not executed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const MAIN = path.join(__dirname, '..', '..', 'src', 'main');
const read = (...p) => fs.readFileSync(path.join(MAIN, ...p), 'utf8');

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply - the .replace() target is stale`);
}

/** The argument text of every `createEngine(getChromeContents ...)` call in a source. */
function engineCalls(source) {
  const masked = maskComments(source);
  const out = [];
  const re = /createEngine\(getChromeContents/g;
  let m;
  while ((m = re.exec(masked))) {
    const open = masked.indexOf('(', m.index);
    out.push(masked.slice(open, findMatchingBracket(masked, open, '(', ')') + 1));
  }
  return out;
}

/** @returns {string[]} the names of every pin that fails on these sources */
function failingPins({ mainSrc, lifecycleSrc, engineSrc, observeSrc, wiringSrc }) {
  const fails = [];
  // 1. markScripted is threaded at BOTH production createEngine sites, with a setter that really writes the mark.
  const mainCalls = engineCalls(mainSrc);
  const lifeCalls = engineCalls(lifecycleSrc);
  if (mainCalls.length !== 1) fails.push('main.js constructs exactly one engine (inside getEngine)');
  if (lifeCalls.length !== 1) fails.push('app-lifecycle.js constructs exactly one engine (dev chrome channel)');
  if (!mainCalls.every((c) => /markScripted:\s*\(\w+\)\s*=>\s*documentMarks\.markScripted\(\w+\.id\)/.test(c))) {
    fails.push('main.js createEngine site injects markScripted -> documentMarks.markScripted(wc.id)');
  }
  if (!lifeCalls.every((c) => /\bmarkScripted\b/.test(c)))
    fails.push('app-lifecycle.js createEngine site injects markScripted');
  // ... and main.js hands app-lifecycle the SAME store's setter.
  const mm = maskComments(mainSrc);
  if (
    !/registerAppLifecycle\(\{[\s\S]{0,200}?markScripted:\s*\(\w+\)\s*=>\s*documentMarks\.markScripted\(\w+\.id\)/.test(
      mm
    )
  ) {
    fails.push('main.js passes registerAppLifecycle a markScripted bound to the shared document marks');
  }
  // 2. engine.js: the conditional-spread idiom.
  if (!/\.\.\.\(typeof markScripted === 'function' \? \{ markScripted \} : \{\}\)/.test(maskComments(engineSrc))) {
    fails.push('engine.js threads markScripted by the conditional-spread idiom');
  }
  // 3. observe.js: evaluate and injectScript mark AFTER resolveContents and BEFORE executeJavaScript.
  const om = maskComments(observeSrc);
  for (const op of ['evaluate', 'injectScript']) {
    const a = om.indexOf(`async function ${op}(`);
    const body = om.slice(a, findMatchingBracket(om, om.indexOf('{', om.indexOf(')', a)), '{', '}'));
    const r = body.indexOf('resolveContents(');
    const k = body.indexOf('markScriptedDocument(wc, deps)');
    const x = body.indexOf('executeJavaScript(');
    if (!(r >= 0 && k > r && x > k))
      fails.push(`observe.js ${op}: resolveContents -> markScriptedDocument -> executeJavaScript`);
  }
  // 4. guest-wiring.js drops the state at commit and at destroy, for every tab kind (no internal guard).
  const wm = maskComments(wiringSrc);
  if (!/documentMarks\)\s*wc\.once\('destroyed',\s*\(\)\s*=>\s*documentMarks\.forget\(wcId\)\)/.test(wm)) {
    fails.push('guest-wiring.js forgets the document marks at destroy');
  }
  if (!/documentMarks\?\.onCommit\(wcId\)/.test(wm))
    fails.push('guest-wiring.js drops the document marks at did-navigate');
  if (!/createGuestWiring\(\{[\s\S]*?documentMarks,/.test(mm))
    fails.push('main.js hands the document marks to the guest wiring');
  return fails;
}

const REAL = {
  mainSrc: read('main.js'),
  lifecycleSrc: read('app-lifecycle.js'),
  engineSrc: read('automation', 'engine.js'),
  observeSrc: read('automation', 'observe.js'),
  wiringSrc: read('guest-wiring.js')
};

test('every reveal-gate wiring pin holds on the real source', () => {
  assert.deepEqual(failingPins(REAL), []);
});

test('markScripted is wired at BOTH createEngine sites: removing it from either flips the pin', () => {
  const mainMut = REAL.mainSrc.replace(
    /markScripted:\s*\(wc\)\s*=>\s*documentMarks\.markScripted\(wc\.id\),\n(\s*)\/\/ Sortie 06/,
    '$1// Sortie 06'
  );
  assertMutated(REAL.mainSrc, mainMut, 'main.js engine setter');
  assert.ok(failingPins({ ...REAL, mainSrc: mainMut }).length > 0);
  const lifeMut = REAL.lifecycleSrc.replace(
    /(registry\.sheetMenuFor\(contents\),\n(?:\s*\/\/[^\n]*\n)*)\s*markScripted,\n/,
    '$1'
  );
  assertMutated(REAL.lifecycleSrc, lifeMut, 'app-lifecycle.js engine setter');
  assert.ok(failingPins({ ...REAL, lifecycleSrc: lifeMut }).length > 0);
});

test('the dev seam setter and the MCP setter come from one store: unbinding app-lifecycle flips the pin', () => {
  const mut = REAL.mainSrc.replace(
    /(registerAppLifecycle\(\{\s+app,\s+gate,\s+)markScripted:\s*\(wc\)\s*=>\s*documentMarks\.markScripted\(wc\.id\),\s+/,
    '$1'
  );
  assertMutated(REAL.mainSrc, mut, 'registerAppLifecycle markScripted');
  assert.ok(failingPins({ ...REAL, mainSrc: mut }).length > 0);
});

test('engine.js and observe.js: removing the spread or the mark call flips the pin', () => {
  const e = REAL.engineSrc.replace(/\.\.\.\(typeof markScripted === 'function' \? \{ markScripted \} : \{\}\),?/, '');
  assertMutated(REAL.engineSrc, e, 'engine.js spread');
  assert.ok(failingPins({ ...REAL, engineSrc: e }).length > 0);
  for (const op of ['evaluate', 'injectScript']) {
    const idx = REAL.observeSrc.indexOf(`async function ${op}(`);
    const tail = REAL.observeSrc.slice(idx).replace('markScriptedDocument(wc, deps);', '');
    const o = REAL.observeSrc.slice(0, idx) + tail;
    assertMutated(REAL.observeSrc, o, `observe.js ${op} mark`);
    assert.ok(failingPins({ ...REAL, observeSrc: o }).length > 0, op);
  }
});

test('guest-wiring.js: dropping either lifetime hook flips the pin', () => {
  const a = REAL.wiringSrc.replace(/documentMarks\?\.onCommit\(wcId\);/, '');
  assertMutated(REAL.wiringSrc, a, 'commit hook');
  assert.ok(failingPins({ ...REAL, wiringSrc: a }).length > 0);
  const b = REAL.wiringSrc.replace(/documentMarks\.forget\(wcId\)/, 'void 0');
  assertMutated(REAL.wiringSrc, b, 'destroy hook');
  assert.ok(failingPins({ ...REAL, wiringSrc: b }).length > 0);
});

// ---- every secret-returning / key-minting channel asks the gate; every owning registrar requires it ----

/** [file, channel literal that must appear as a gate request or a gated-read registration] */
const GATED = [
  ['register-vault-ipc.js', /gatedItemRead\(\s*'reveal',\s*'internal-vault-reveal'/],
  ['register-vault-ipc.js', /gatedItemRead\(\s*'code',\s*'internal-vault-totp-code'/],
  ['register-vault-ipc.js', /channel:\s*'internal-vault-export'/],
  ['register-vault-ipc.js', /channel:\s*'internal-vault-export-profile'/],
  ['jar-data-ipc.js', /channel:\s*'internal-jars-cookies-value'/],
  ['register-settings-ipc.js', /channel:\s*'automation:jar-key-mint'/],
  ['register-settings-ipc.js', /channel:\s*'automation:admin-key-mint'/],
  ['register-download-ipc.js', /action:\s*'open-download'/]
];

test('every gated channel asks the reveal gate, and each owning registrar throws without one', () => {
  for (const [file, re] of GATED) {
    assert.ok(re.test(maskComments(read(file))), `${file} must gate ${re}`);
  }
  for (const [file, name] of [
    ['register-vault-ipc.js', 'registerVaultIpc'],
    ['register-settings-ipc.js', 'registerSettingsIpc'],
    ['jar-data-ipc.js', 'registerJarDataIpc'],
    ['register-download-ipc.js', 'registerDownloadIpc']
  ]) {
    const m = maskComments(read(file));
    assert.ok(new RegExp(`${name}: revealGate is required`).test(read(file)), `${name} throws at registration`);
    assert.ok(/!revealGate \|\| typeof revealGate\.confirm !== 'function'/.test(m), `${file} checks the dependency`);
  }
  // registerJarIpc hands it on, and main.js builds ONE gate and hands it to all three registrars
  assert.ok(/registerJarDataIpc\(\{\s+ipcMain,\s+gate,\s+revealGate,/.test(maskComments(read('jar-ipc.js'))));
  const mm = maskComments(read('main.js'));
  for (const call of ['registerJarIpc', 'registerSettingsIpc', 'registerVaultIpc']) {
    assert.ok(new RegExp(`${call}\\(\\{[^}]{0,60}?revealGate,`).test(mm), `main.js passes revealGate to ${call}`);
  }
  assert.ok(
    /registerDownloadIpc\(\{[\s\S]*?\n\s+revealGate,[\s\S]*?\n\}\);/.test(mm),
    'main.js passes revealGate to registerDownloadIpc'
  );
  assert.equal((mm.match(/createRevealGate\(/g) || []).length, 1, 'one gate, built once');
});

test('neuter: a gated handler that stops asking the gate flips the pin', () => {
  const src = read('jar-data-ipc.js');
  const mut = src.replace("channel: 'internal-jars-cookies-value'", "channel: 'x'");
  assertMutated(src, mut, 'cookie-value gate');
  assert.ok(!GATED[4][1].test(maskComments(mut)));
});

test('the gate dialog is the ONLY thing automation cannot reach: showConfirm is main.js dialog.showMessageBox with the gate signal', () => {
  const mm = maskComments(read('main.js'));
  assert.ok(
    /showConfirm:\s*\(win,\s*options,\s*signal\)\s*=>\s*dialog\.showMessageBox\(win,\s*\{\s*\.\.\.options,\s*signal\s*\}\)/.test(
      mm
    )
  );
  // the gate module never touches electron
  assert.ok(!/require\(['"]electron['"]\)/.test(maskComments(read('reveal-gate.js'))));
});
