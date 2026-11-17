'use strict';
// Squawk 0195: the WebGL getParameter farble hook must ask the native function first and
// substitute the generic vendor/renderer ONLY when the native returned a string.
// The hook runs in the page main world and needs Electron, so the test extracts the
// replacement function's source from the preload and executes it with injected deps.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload', 'webview-preload.js'), 'utf8');
const m = /GL\.prototype\.getParameter\s*=\s*(function\s*\(p\)\s*\{[\s\S]*?\n {6}\});/.exec(src);
assert.ok(m, 'could not locate the WebGL getParameter replacement in webview-preload.js');

function makeHook(native, farble) {
  const bumps = [];
  const factory = new Function('gp', 'bumpFp', 'FARBLE', `return (${m[1]});`);
  return { hook: factory(native, (k) => bumps.push(k), farble), bumps };
}

test('WebGL getParameter hook: native first, fake only for a string', () => {
  const calls = [];
  const nativeOf = (ret) =>
    function (p) {
      calls.push([this, p]);
      return typeof ret === 'function' ? ret() : ret;
    };
  const recv = {};

  // native string -> fake
  let t = makeHook(nativeOf('Real Vendor'), true);
  assert.equal(t.hook.call(recv, 37445), 'Google Inc.');
  assert.equal(t.hook.call(recv, 37446), 'ANGLE (Generic GPU)');
  assert.deepEqual(t.bumps, ['webgl', 'webgl']);
  assert.equal(calls.length, 2, 'native must be called');
  assert.equal(calls[0][0], recv, 'native called with the same receiver');

  // native non-string -> passed through unchanged
  for (const v of [null, undefined, 7, false]) {
    t = makeHook(nativeOf(v), true);
    assert.equal(t.hook.call(recv, 37446), v);
    assert.deepEqual(t.bumps, ['webgl']);
  }

  // native throws -> propagates
  const boom = new TypeError('Illegal invocation');
  t = makeHook(
    nativeOf(() => {
      throw boom;
    }),
    true
  );
  assert.throws(
    () => t.hook.call(recv, 37445),
    (e) => e === boom
  );

  // farble off -> native result untouched, still counted
  t = makeHook(nativeOf('Real Vendor'), false);
  assert.equal(t.hook.call(recv, 37445), 'Real Vendor');
  assert.deepEqual(t.bumps, ['webgl']);

  // other parameter -> untouched, not counted
  t = makeHook(nativeOf('x'), true);
  assert.equal(t.hook.call(recv, 7936), 'x');
  assert.deepEqual(t.bumps, []);
});
