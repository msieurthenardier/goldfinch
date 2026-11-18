'use strict';

// Mission 23 Flight 2 (leg `automation-input`, flight DD4) - source-scan invariants for the injected-input
// counts. The fallbacks are SILENT (an engine without the counts injects unbracketed, so the click witness
// and the jar-key shortcut gate see nothing), so a half-wired seam produces no failure anywhere else - the
// house dual-site grep-pin convention. Every pin is run on the real source AND on a mutation that must flip
// it (neuter-verified; `assertMutated` guards each mutation so a stale `.replace()` target cannot pass
// vacuously). NO TEST IN THIS REPO LOADS main.js (test/helpers/source-scan.js), so main.js is scanned.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, findMatchingBracket, collectSources } = require('../helpers/source-scan');

const MAIN = path.join(__dirname, '..', '..', 'src', 'main');
const read = (...p) => fs.readFileSync(path.join(MAIN, ...p), 'utf8');

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply - the .replace() target is stale`);
}

/**
 * Every `sendInputEvent(` call site in one source, with whether it sits inside a `withInjection(` argument
 * list. A call is an occurrence of the method name followed by `(`; a definition or a mention in a comment
 * is masked out.
 * @param {string} source
 * @returns {{ index: number, inside: boolean }[]}
 */
function sendSites(source) {
  const masked = maskComments(source);
  const spans = [];
  const w = /\bwithInjection\(/g;
  let m;
  while ((m = w.exec(masked))) {
    const open = masked.indexOf('(', m.index);
    spans.push([open, findMatchingBracket(masked, open, '(', ')')]);
  }
  const out = [];
  const s = /\.sendInputEvent\(/g;
  while ((m = s.exec(masked))) out.push({ index: m.index, inside: spans.some(([a, b]) => m.index > a && m.index < b) });
  return out;
}

// `scroll` uses webContents.debugger (CDP Input.dispatchMouseEvent), not sendInputEvent: it has no call site
// here and so nothing to exempt; this list exists so a future exemption must be stated, with its reason.
const EXEMPT = /** @type {Record<string, string>} */ ({});

function offenders(files) {
  const bad = [];
  for (const [file, src] of Object.entries(files)) {
    if (EXEMPT[file]) continue;
    for (const site of sendSites(src)) if (!site.inside) bad.push(file);
  }
  return bad;
}

const FILES = Object.fromEntries(collectSources(MAIN).map((f) => [path.relative(MAIN, f), fs.readFileSync(f, 'utf8')]));

test('every sendInputEvent( call in src/main/** is inside withInjection(...), and there are exactly three', () => {
  assert.deepEqual(offenders(FILES), []);
  const all = Object.entries(FILES).flatMap(([file, src]) => sendSites(src).map(() => file));
  assert.deepEqual(
    all,
    ['automation/input.js', 'automation/input.js', 'automation/input.js'],
    'sendInput, actOn, actOnPaced'
  );
});

test('neuter: a sendInputEvent call outside withInjection (here, a stray file) flips the pin', () => {
  const stray = { ...FILES, 'stray.js': 'function f(wc) { wc.sendInputEvent({ type: "keyDown" }); }' };
  assert.deepEqual(offenders(stray), ['stray.js']);
  // ... and unwrapping any one of the three real sites flips it.
  const input = FILES['automation/input.js'];
  for (const [what, re] of [
    ['sendInput', /withInjection\(wcId, deps, wc, \[event\], \(\) => wc\.sendInputEvent\(event\)\);/],
    [
      'actOn',
      /withInjection\(wcId, deps, target, events, \(\) => \{\n(\s*)for \(const ev of events\) target\.sendInputEvent\(ev\);\n\s*\}\);/
    ],
    ['actOnPaced', /await withInjection\(wcId, deps, target, events, async \(\) => \{/]
  ]) {
    const mutated = input.replace(re, (m) => m.replace('withInjection(', 'notInjection('));
    assertMutated(input, mutated, `${what} unwrap`);
    assert.ok(offenders({ 'automation/input.js': mutated }).length > 0, what);
  }
});

test('input.js: begin sits after the re-resolve and release is guaranteed (the helper, not each caller)', () => {
  const m = maskComments(FILES['automation/input.js']);
  for (const fn of ['actOn', 'actOnPaced']) {
    const a = m.indexOf(`async function ${fn}(`);
    const body = m.slice(a, findMatchingBracket(m, m.indexOf('{', m.indexOf(')', a)), '{', '}'));
    const activate = body.indexOf('await activate(wcId)');
    const reResolve = body.indexOf('wc = resolveContents(wcId, deps);', activate);
    const inject = body.indexOf('withInjection(');
    assert.ok(activate >= 0 && reResolve > activate && inject > reResolve, `${fn}: withInjection after the re-resolve`);
  }
  const h = m.indexOf('function withInjection(');
  const body = m.slice(h, findMatchingBracket(m, m.indexOf('{', m.indexOf(')', h)), '{', '}'));
  assert.ok(/counts\.begin\(/.test(body) && /release\(\)/.test(body));
  assert.ok(/jar = deps\.jarTier === true/.test(body), 'the jar flag is deps.jarTier === true');
});

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

/** @returns {string[]} the names of every wiring pin that fails on these sources */
function failingPins({ mainSrc, lifecycleSrc, engineSrc, serverSrc, wiringSrc }) {
  const fails = [];
  // 1. the counts are injected at BOTH production createEngine sites, from the one store.
  const mainCalls = engineCalls(mainSrc);
  const lifeCalls = engineCalls(lifecycleSrc);
  if (mainCalls.length !== 1 || !mainCalls.every((c) => /\binjectedInput,/.test(c)))
    fails.push('main.js createEngine site injects injectedInput');
  if (lifeCalls.length !== 1 || !lifeCalls.every((c) => /\binjectedInput,/.test(c)))
    fails.push('app-lifecycle.js createEngine site injects injectedInput');
  const mm = maskComments(mainSrc);
  if (!/const injectedInput = createInjectedInput\(\)/.test(mm)) fails.push('main.js builds ONE store');
  if (!/registerAppLifecycle\(\{[\s\S]{0,300}?\binjectedInput,/.test(mm))
    fails.push('main.js passes registerAppLifecycle the same store');
  if (!/createGuestWiring\(\{(?:(?!\n\}\);)[\s\S])*?\binjectedInput,/.test(mm))
    fails.push('main.js hands the store to the guest wiring');
  // 2. the tier: set ONLY at the server's getEngine call, for a non-admin identity; neither engine site names it.
  if (
    !/getEngine\(\{\s*allowInternal:\s*identity === 'admin',\s*jarTier:\s*identity !== 'admin'\s*\}\)/.test(
      maskComments(serverSrc)
    )
  )
    fails.push("mcp-server.js sets jarTier: identity !== 'admin' at the getEngine call");
  if (mainCalls.some((c) => /\bjarTier\b/.test(c.replace(/\.\.\.engineOpts/, ''))))
    fails.push('main.js names jarTier at the engine site (it must only spread engineOpts)');
  if (!mainCalls.every((c) => /\.\.\.engineOpts/.test(c))) fails.push('main.js engine site spreads engineOpts');
  if (lifeCalls.some((c) => /\bjarTier\b/.test(c))) fails.push('the dev chrome channel engine must not be jar tier');
  // 3. engine.js: the conditional-spread idiom for both.
  const em = maskComments(engineSrc);
  if (!/\.\.\.\(injectedInput && typeof injectedInput\.begin === 'function' \? \{ injectedInput \} : \{\}\)/.test(em))
    fails.push('engine.js threads injectedInput by the conditional-spread idiom');
  if (!/\.\.\.\(jarTier === true \? \{ jarTier: true \} : \{\}\)/.test(em))
    fails.push('engine.js threads jarTier only when true');
  // 4. guest-wiring.js: the witness gate, the key gate, the destroy hook.
  const wm = maskComments(wiringSrc);
  if (!/if \(!isOperatorInput\(injectedInput, wcId\)\) return;\s*gestureWitness\.onInput\(wcId, input\)/.test(wm))
    fails.push('guest-wiring.js: the witness ignores input while !isOperatorInput');
  if (!/if \(injectedInput\?\.isJarInjecting\(contents\.id\)\) return;\s*if \(handleCrossView/.test(wm))
    fails.push('guest-wiring.js: the key handler returns for a jar injection before every branch');
  if (!/injectedInput\.forget\(contents\.id\)/.test(wm)) fails.push('guest-wiring.js forgets the counts at destroy');
  return fails;
}

const REAL = {
  mainSrc: read('main.js'),
  lifecycleSrc: read('app-lifecycle.js'),
  engineSrc: read('automation', 'engine.js'),
  serverSrc: read('automation', 'mcp-server.js'),
  wiringSrc: read('guest-wiring.js')
};

test('every injected-input wiring pin holds on the real source', () => {
  assert.deepEqual(failingPins(REAL), []);
});

test('injectedInput is wired at BOTH createEngine sites: removing it from either flips the pin', () => {
  const mainMut = REAL.mainSrc
    .replace(/\n\s*injectedInput,\n(\s*)\/\/ Sortie 06/, '\n$1// Sortie 06')
    .replace(
      /(isSavePromptContents: \(wc\) => registry\.isSavePromptContents\(wc\),\n)(?:\s*\/\/[^\n]*\n)*\s*injectedInput,\n/,
      '$1'
    );
  assertMutated(REAL.mainSrc, mainMut, 'main.js engine injection');
  assert.ok(failingPins({ ...REAL, mainSrc: mainMut }).length > 0);
  const lifeMut = REAL.lifecycleSrc.replace(/(\n\s*markScripted,\n)\s*injectedInput,\n/, '$1');
  assertMutated(REAL.lifecycleSrc, lifeMut, 'app-lifecycle.js engine injection');
  assert.ok(failingPins({ ...REAL, lifecycleSrc: lifeMut }).length > 0);
});

test('one store: unbinding app-lifecycle or the guest wiring from main.js flips the pin', () => {
  const a = REAL.mainSrc.replace(
    /(markScripted: \(wc\) => documentMarks\.markScripted\(wc\.id\),\n)\s*injectedInput,\n/,
    '$1'
  );
  assertMutated(REAL.mainSrc, a, 'registerAppLifecycle injectedInput');
  assert.ok(failingPins({ ...REAL, mainSrc: a }).length > 0);
  const b = REAL.mainSrc.replace(/(\n\s*gestureWitness,\n)(?:\s*\/\/[^\n]*\n)*\s*injectedInput,\n/, '$1');
  assertMutated(REAL.mainSrc, b, 'guest wiring injectedInput');
  assert.ok(failingPins({ ...REAL, mainSrc: b }).length > 0);
});

test('the tier flag: a getEngine call that does not set it, or an engine site that names it, flips the pin', () => {
  const s = REAL.serverSrc.replace(/,\s*jarTier:\s*identity !== 'admin'/, '');
  assertMutated(REAL.serverSrc, s, 'mcp-server jarTier');
  assert.ok(failingPins({ ...REAL, serverSrc: s }).length > 0);
  const lifeMut = REAL.lifecycleSrc.replace(
    /(\n {8}markScripted,\n {8}injectedInput,\n)/,
    '$1        jarTier: true,\n'
  );
  assertMutated(REAL.lifecycleSrc, lifeMut, 'dev channel jarTier');
  assert.ok(failingPins({ ...REAL, lifecycleSrc: lifeMut }).length > 0);
  const mainMut = REAL.mainSrc.replace(/(\n\s*\.\.\.engineOpts,\n)/, '$1        jarTier: true,\n');
  assertMutated(REAL.mainSrc, mainMut, 'main.js jarTier');
  assert.ok(failingPins({ ...REAL, mainSrc: mainMut }).length > 0);
});

test('engine.js and guest-wiring.js: dropping a spread, a gate or the destroy hook flips the pin', () => {
  const e = REAL.engineSrc.replace(/\.\.\.\(jarTier === true \? \{ jarTier: true \} : \{\}\),?/, '');
  assertMutated(REAL.engineSrc, e, 'engine.js jarTier spread');
  assert.ok(failingPins({ ...REAL, engineSrc: e }).length > 0);
  const e2 = REAL.engineSrc.replace(
    /\.\.\.\(injectedInput && typeof injectedInput\.begin === 'function' \? \{ injectedInput \} : \{\}\),?/,
    ''
  );
  assertMutated(REAL.engineSrc, e2, 'engine.js injectedInput spread');
  assert.ok(failingPins({ ...REAL, engineSrc: e2 }).length > 0);
  for (const [what, re] of [
    ['witness gate', /if \(!isOperatorInput\(injectedInput, wcId\)\) return;\s*/],
    ['key gate', /if \(injectedInput\?\.isJarInjecting\(contents\.id\)\) return;\s*/],
    ['destroy hook', /injectedInput\.forget\(contents\.id\)/]
  ]) {
    const w = REAL.wiringSrc.replace(re, 'void 0;');
    assertMutated(REAL.wiringSrc, w, what);
    assert.ok(failingPins({ ...REAL, wiringSrc: w }).length > 0, what);
  }
});

test('reveal-gate.js handleRevealInputEvent uses isOperatorInput and contains no raw isInjecting call', () => {
  const src = maskComments(fs.readFileSync(path.join(MAIN, 'reveal-gate.js'), 'utf8'));
  const body = (s) => {
    const i = s.indexOf('function handleRevealInputEvent(');
    assert.ok(i >= 0, 'handleRevealInputEvent found');
    const open = s.indexOf('{', s.indexOf(')', i));
    return s.slice(open, findMatchingBracket(s, open, '{', '}'));
  };
  const pinned = (s) =>
    /if \(!isOperatorInput\(injectedInput, wcId\)\) return;/.test(body(s)) && !/\.isInjecting\b/.test(body(s));
  assert.ok(pinned(src));
  const mut = src.replace(
    /if \(!isOperatorInput\(injectedInput, wcId\)\) return;/,
    'if (injectedInput?.isInjecting?.(wcId)) return;'
  );
  assertMutated(src, mut, 'reveal cancel predicate');
  assert.ok(!pinned(mut), 'a raw isInjecting call flips the pin');
});

test('no isInjecting( call remains in src/main/** outside automation/injected-input.js', () => {
  for (const [file, src] of Object.entries(FILES)) {
    if (file === path.join('automation', 'injected-input.js')) continue;
    assert.ok(!/\bisInjecting\(/.test(maskComments(src)), file);
  }
});
