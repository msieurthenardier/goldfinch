'use strict';

// Bundle-integrity pin for the isolated-world entry-observer install script
// (Mission 21, Flight 1, Leg 3 — entry-tracker, DD3h). Model:
// webview-preload-bundle.test.js.
//
// `executeJavaScriptInIsolatedWorld` takes a plain STRING evaluated as a script
// — no `require`, no `module`. The pure modules this bundle inlines
// (vault-entry-observer.js, vault-fill-fields.js, vault-card-fields.js) are
// plain CJS ending in `module.exports = ...`, so this file verifies the property
// that actually matters: the GENERATED, wrapped script text runs cleanly in a
// sandbox with NO `require`/`module` globals defined at all (a `vm` context, the
// closest offline analog of an isolated world's own global scope) — not a blind
// textual absence of the substring "module.exports", which esbuild's own
// `__commonJS` interop legitimately preserves (verified empirically during this
// leg's design work — see scripts/build-preload.mjs's buildObserverScript doc
// comment): each occurrence there is a SAFELY SCOPED local `module`/`exports`
// parameter, not a reference to an undefined global, and grepping for it blindly
// would false-positive on exactly the code that makes this safe.
//
// This is rebuilt fresh here (hermetic, doesn't depend on what pretest ran).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const generatedPath = path.join(repoRoot, 'src', 'preload', 'vault-entry-observer-bundle.generated.js');

execFileSync('node', [path.join(repoRoot, 'scripts', 'build-preload.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit'
});

test('build:preload emits the observer install script constant', () => {
  assert.ok(fs.existsSync(generatedPath), `expected generated file at ${generatedPath}`);
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT } = require(generatedPath);
  assert.equal(typeof VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT, 'string');
  assert.ok(VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT.length > 1000, 'unexpectedly small — build may have failed silently');
});

test('no BARE (word-boundary) call to a global require( survives — __require/require_xxx internal identifiers are exempt', () => {
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT: src } = require(generatedPath);
  // \b before "require" excludes esbuild's own `__require`/`require_xxx`
  // internal identifiers (an underscore is a \w character, so there is no
  // boundary immediately before "require" in either) while still catching a
  // genuine bare `require(...)` call.
  const bareRequire = /\brequire\(/;
  assert.equal(
    bareRequire.test(src),
    false,
    'a bare require( call would throw against a real isolated world (no require global)'
  );
});

test('the wrapped script contains no ESM export syntax', () => {
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT: src } = require(generatedPath);
  assert.equal(/^export\s+(?:default\b|async\b|const\b|let\b|var\b|function\b|class\b|\{|\*)/m.test(src), false);
});

test('inlines the observer core and the pure field modules (their function names are present)', () => {
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT: src } = require(generatedPath);
  for (const name of [
    'createEntryObserver',
    'fillLoginForm',
    'findAllLoginFields',
    'fillCardForm',
    'findAllCardFields',
    // M21 F3 Leg 3 (identity-fill, AC8) — ADD, never remove.
    'fillIdentityForm',
    'findAllIdentityFields'
  ]) {
    assert.ok(src.includes(name), `expected inlined name "${name}" in the observer bundle`);
  }
});

// --- the functional property that actually matters: no require/module ReferenceError, real success ---

/** A minimal fake DOM sufficient to install the observer and grant one field. */
function makeSandbox() {
  class FakeField {
    #value = '';
    constructor(type, name) {
      this.type = type;
      this.name = name || '';
      this._listeners = {};
    }
    get value() {
      return this.#value;
    }
    set value(v) {
      this.#value = v;
    }
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatchEvent(evt) {
      for (const fn of (this._listeners[evt.type] || []).slice()) fn(evt);
      return true;
    }
    querySelectorAll() {
      return [];
    }
  }

  const password = new FakeField('password', 'password');
  const username = new FakeField('text', 'username');
  const form = {
    tagName: 'FORM',
    querySelectorAll(sel) {
      return sel === 'input' ? [username, password] : [];
    }
  };
  password.form = form;
  username.form = form;

  const docListeners = { keydown: [], input: [] };
  const documentElement = { querySelectorAll: () => [] };
  const fakeDocument = {
    documentElement,
    addEventListener(type, fn) {
      if (docListeners[type]) docListeners[type].push(fn);
    },
    querySelectorAll(sel) {
      if (sel === 'input[type=password]') return [password];
      if (sel === 'input') return [username, password];
      return [];
    }
  };

  class FakeMutationObserver {
    constructor() {}
    observe() {}
  }

  class FakeEvent {
    constructor(type, opts) {
      this.type = type;
      this.bubbles = !!(opts && opts.bubbles);
    }
  }

  const sandbox = {
    window: {},
    document: fakeDocument,
    MutationObserver: FakeMutationObserver,
    Event: FakeEvent,
    console
  };
  sandbox.window.document = fakeDocument;
  sandbox.window.top = sandbox.window; // top-frame, per fillLoginForm/fillCardForm's guard
  vm.createContext(sandbox);

  return { sandbox, username, password, docListeners };
}

function fireTrusted(docListeners, type, target) {
  for (const fn of docListeners[type].slice()) fn({ type, isTrusted: true, target });
}

test('the wrapped script runs cleanly with NO require/module globals defined and reports { installed: true }', () => {
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT } = require(generatedPath);
  const { sandbox } = makeSandbox();
  // Sanity: this sandbox genuinely has no require/module — if it did, this
  // test would not be exercising the property it claims to.
  assert.equal('require' in sandbox, false);
  assert.equal('module' in sandbox, false);

  const result = vm.runInContext(VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT, sandbox, { filename: 'observer-install.js' });
  // Cross-realm object (created inside the vm sandbox's own intrinsics) — compare
  // by property, not assert.deepEqual/deepStrictEqual, which additionally checks
  // prototype identity and would false-fail on a structurally-identical object
  // from a DIFFERENT realm.
  assert.equal(result.installed, true);
});

test('end-to-end: typing grants provenance with the REAL value, and a Goldfinch fill grants + writes in one call', () => {
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT } = require(generatedPath);
  const { sandbox, username, password, docListeners } = makeSandbox();
  vm.runInContext(VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT, sandbox, { filename: 'observer-install.js' });

  const { VAULT_ENTRY_OBSERVER_HANDLE } = require(
    path.join(repoRoot, 'src', 'preload', 'vault-entry-observer-handle.js')
  );
  const handle = sandbox.window[VAULT_ENTRY_OBSERVER_HANDLE];
  assert.ok(handle, 'the handle must be attached to window under the shared, single-sourced name');

  username.value = 'alice';
  fireTrusted(docListeners, 'input', username);
  const afterTyping = handle.getSnapshot();
  assert.equal(afterTyping.logins[0].username.value, 'alice');
  assert.equal(afterTyping.logins[0].password.value, null, 'password detected but never typed into → unprovenanced');

  // M21 F3 Leg 3 (DD9): the handle method's payload is `{ cred, ordinal }`, not
  // the cred directly — `ordinal` omitted here falls back to the
  // first-detected-entry heuristic, exactly the MCP/no-gesture path.
  const fillResult = handle.fillLogin({ cred: { username: 'bob', password: 'hunter2' } });
  assert.equal(fillResult.filled, true); // cross-realm object — see the property-check note above
  assert.equal(username.value, 'bob');
  assert.equal(password.value, 'hunter2');

  const afterFill = handle.getSnapshot();
  assert.equal(afterFill.logins[0].username.value, 'bob');
  assert.equal(afterFill.logins[0].password.value, 'hunter2');
});

test('flight-end review fix: install() still reports { installed: true } in a realm with NO setTimeout at all (retry-arming used to call the bare global)', () => {
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT } = require(generatedPath);
  const { sandbox } = makeSandbox();
  // Drop BOTH the MutationObserver the sandbox otherwise provides (forcing
  // install() down its bounded-retry branch at all) and setTimeout itself —
  // a bare `vm` sandbox has no timer globals unless explicitly given one
  // (confirmed: `typeof setTimeout` reads 'undefined' in a fresh
  // `vm.createContext({})`), the same gap the review finding flagged for the
  // isolated-world realm. Before the fix, the retry's bare `setTimeout(...)`
  // call threw a ReferenceError here, caught only by this bundle's own
  // try/catch wrapper and surfacing as `{ installed: false }` — total loss of
  // the whole install, not just detachment eviction.
  delete sandbox.MutationObserver;
  assert.equal('setTimeout' in sandbox, false, 'sanity: this sandbox has no setTimeout to begin with');

  const result = vm.runInContext(VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT, sandbox, { filename: 'observer-install.js' });
  assert.equal(
    result.installed,
    true,
    'a missing MutationObserver + missing setTimeout must still install successfully — the loss is confined to detachment eviction'
  );
});

test('a re-run against an already-installed world is an idempotent no-op (still reports installed: true)', () => {
  const { VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT } = require(generatedPath);
  const { sandbox } = makeSandbox();
  const first = vm.runInContext(VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT, sandbox, { filename: 'observer-install.js' });
  const second = vm.runInContext(VAULT_ENTRY_OBSERVER_INSTALL_SCRIPT, sandbox, { filename: 'observer-install.js' });
  assert.equal(first.installed, true); // cross-realm objects — see the property-check note above
  assert.equal(second.installed, true);
});
