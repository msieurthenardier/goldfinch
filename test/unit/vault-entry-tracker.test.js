'use strict';

// Unit test for the main-world entry-tracker POLICY module (Mission 21, Flight
// 1, Leg 3 — entry-tracker, DD3g/DD3h). Electron-free: `execInWorld` is a fake
// (never the real webFrame.executeJavaScriptInIsolatedWorld), so this exercises
// the tracker's install lifecycle, fail-closed behavior, and fill-routing
// entirely under `node --test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEntryTracker, resolveTargetForAnchor } = require('../../src/preload/vault-entry-tracker');
const { VAULT_ENTRY_OBSERVER_HANDLE } = require('../../src/preload/vault-entry-observer-handle');

// A deferred promise — proves the tracker never assumes execInWorld resolves
// synchronously (DD3f: "Nothing depends on an isolated-world read resolving
// synchronously... the spike's observation of that is empirical, not
// contractual"). Every fake `execInWorld` below resolves over a REAL microtask
// hop (setImmediate), never inline.
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeExecInWorldAlways(resultOrFn) {
  return (script) =>
    new Promise((resolve) => {
      setImmediate(() => resolve(typeof resultOrFn === 'function' ? resultOrFn(script) : resultOrFn));
    });
}

// --- install lifecycle -------------------------------------------------------

test('ensureInstalled resolves true on a well-shaped { installed: true } result', async () => {
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways({ installed: true }),
    installScript: 'INSTALL_SCRIPT'
  });
  assert.equal(await tracker.ensureInstalled(), true);
});

test('install success is asserted on the RESOLVED VALUE shape, never on absence of rejection (DD3h)', async () => {
  // A throw inside an isolated-world script resolves `undefined` rather than
  // rejecting — this fake reproduces exactly that non-rejecting failure shape.
  let warned = 0;
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways(undefined),
    installScript: 'INSTALL_SCRIPT',
    warn: () => warned++
  });
  const ok = await tracker.ensureInstalled();
  assert.equal(ok, false, 'an unshaped resolve (undefined) must never be treated as success');
  assert.equal(warned, 1);
});

test('a malformed resolved value ({} , { installed: false }, a string) is also treated as install failure', async () => {
  for (const bad of [{}, { installed: false }, 'ok', null, 0, false]) {
    const tracker = createEntryTracker({
      execInWorld: fakeExecInWorldAlways(bad),
      installScript: 'INSTALL_SCRIPT',
      warn: () => {}
    });
    assert.equal(await tracker.ensureInstalled(), false, `expected failure for resolved value ${JSON.stringify(bad)}`);
  }
});

test('a genuinely REJECTING execInWorld is treated the same as an unshaped resolve, not specially', async () => {
  let warned = 0;
  const tracker = createEntryTracker({
    execInWorld: () => Promise.reject(new Error('world unavailable')),
    installScript: 'INSTALL_SCRIPT',
    warn: () => warned++
  });
  const ok = await tracker.ensureInstalled();
  assert.equal(ok, false);
  assert.equal(warned, 1);
});

test('fail closed and NOT silent: warn is called EXACTLY ONCE across many failed calls', async () => {
  let warned = 0;
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways(undefined),
    installScript: 'INSTALL_SCRIPT',
    warn: () => warned++
  });
  await tracker.ensureInstalled();
  await tracker.ensureInstalled();
  await tracker.fillLogin({ username: 'a', password: 'b' });
  await tracker.fillCard({ number: '4242424242424242' });
  assert.equal(warned, 1, 'a systemic outage must be diagnosable ONCE, not spammed forever');
});

test('a failed install is never retried within the same tracker instance (execInWorld call count stays 1)', async () => {
  let calls = 0;
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways(() => {
      calls++;
      return undefined;
    }),
    installScript: 'INSTALL_SCRIPT',
    warn: () => {}
  });
  await tracker.ensureInstalled();
  await tracker.ensureInstalled();
  await tracker.fillLogin({ username: 'a', password: 'b' });
  assert.equal(calls, 1);
});

test('a successful install is never re-attempted (execInWorld call count stays 1 across many calls)', async () => {
  let calls = 0;
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways(() => {
      calls++;
      return { installed: true };
    }),
    installScript: 'INSTALL_SCRIPT'
  });
  await tracker.ensureInstalled();
  await tracker.ensureInstalled();
  assert.equal(calls, 1);
});

test('concurrent ensureInstalled callers share ONE in-flight install (no duplicate execInWorld calls)', async () => {
  let calls = 0;
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways(() => {
      calls++;
      return { installed: true };
    }),
    installScript: 'INSTALL_SCRIPT'
  });
  const [a, b, c] = await Promise.all([
    tracker.ensureInstalled(),
    tracker.ensureInstalled(),
    tracker.ensureInstalled()
  ]);
  assert.deepEqual([a, b, c], [true, true, true]);
  assert.equal(calls, 1);
});

// --- DD3f: nothing depends on synchronous resolution ------------------------

test('does not depend on execInWorld resolving synchronously — a genuinely async (deferred) resolve still works', async () => {
  const d = deferred();
  const tracker = createEntryTracker({
    execInWorld: () => d.promise,
    installScript: 'INSTALL_SCRIPT'
  });
  const pending = tracker.ensureInstalled();
  // Nothing has resolved yet — the call must not have synchronously settled.
  let settled = false;
  pending.then(() => {
    settled = true;
  });
  await Promise.resolve(); // one microtask hop
  assert.equal(settled, false, 'must not have settled before the underlying promise resolves');
  d.resolve({ installed: true });
  assert.equal(await pending, true);
});

// --- fill routing -------------------------------------------------------------

test('fillLogin installs first (once), then calls execInWorld again for the fill script, and returns { filled: true } on success', async () => {
  const scripts = [];
  let installed = false;
  const tracker = createEntryTracker({
    execInWorld: (script) => {
      scripts.push(script);
      return new Promise((resolve) =>
        setImmediate(() => {
          if (!installed) {
            installed = true;
            resolve({ installed: true });
          } else {
            resolve({ filled: true });
          }
        })
      );
    },
    installScript: 'INSTALL_SCRIPT'
  });

  const result = await tracker.fillLogin({ username: 'bob', password: 'hunter2' });
  assert.deepEqual(result, { filled: true });
  assert.equal(scripts.length, 2, 'one call for install, one for the fill');
  assert.equal(scripts[0], 'INSTALL_SCRIPT');
  assert.ok(
    scripts[1].includes(`window[${JSON.stringify(VAULT_ENTRY_OBSERVER_HANDLE)}]`),
    'the fill script must look up the shared, single-sourced handle name'
  );
});

test('fillLogin embeds the credential as a JSON literal calling h.fillLogin(...)', async () => {
  let fillScript = null;
  const tracker = createEntryTracker({
    execInWorld: (script) => {
      if (fillScript === null && script !== 'INSTALL_SCRIPT') fillScript = script;
      return Promise.resolve(script === 'INSTALL_SCRIPT' ? { installed: true } : { filled: true });
    },
    installScript: 'INSTALL_SCRIPT'
  });
  await tracker.fillLogin({ username: 'bob', password: 'hunter2' });
  assert.ok(fillScript.includes('h.fillLogin('), 'must call the exposed fillLogin method');
  assert.ok(fillScript.includes('"bob"'));
  assert.ok(fillScript.includes('"hunter2"'));
});

test('fillCard calls h.fillCard(...) with the card payload', async () => {
  let fillScript = null;
  const tracker = createEntryTracker({
    execInWorld: (script) => {
      if (fillScript === null && script !== 'INSTALL_SCRIPT') fillScript = script;
      return Promise.resolve(script === 'INSTALL_SCRIPT' ? { installed: true } : { filled: true });
    },
    installScript: 'INSTALL_SCRIPT'
  });
  await tracker.fillCard({ number: '4242424242424242', cvv: '123' });
  assert.ok(fillScript.includes('h.fillCard('));
  assert.ok(fillScript.includes('4242424242424242'));
});

test('AC7: fillIdentity calls h.fillIdentity(...) with the { identity, ordinal } payload', async () => {
  let fillScript = null;
  const tracker = createEntryTracker({
    execInWorld: (script) => {
      if (fillScript === null && script !== 'INSTALL_SCRIPT') fillScript = script;
      return Promise.resolve(script === 'INSTALL_SCRIPT' ? { installed: true } : { filled: true });
    },
    installScript: 'INSTALL_SCRIPT'
  });
  const result = await tracker.fillIdentity({ identity: { fullName: 'Ada Lovelace' }, ordinal: 1 });
  assert.deepEqual(result, { filled: true });
  assert.ok(fillScript.includes('h.fillIdentity('));
  assert.ok(fillScript.includes('Ada Lovelace'));
  assert.ok(fillScript.includes('"ordinal":1'));
});

test('fillLogin/fillCard return { filled: false } when install failed — never throw, never hang', async () => {
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways(undefined),
    installScript: 'INSTALL_SCRIPT',
    warn: () => {}
  });
  assert.deepEqual(await tracker.fillLogin({ username: 'a', password: 'b' }), { filled: false });
  assert.deepEqual(await tracker.fillCard({ number: '4242424242424242' }), { filled: false });
});

test('fillLogin returns { filled: false } when the fill script itself resolves undefined / malformed', async () => {
  const tracker = createEntryTracker({
    execInWorld: (script) => Promise.resolve(script === 'INSTALL_SCRIPT' ? { installed: true } : undefined),
    installScript: 'INSTALL_SCRIPT'
  });
  assert.deepEqual(await tracker.fillLogin({ username: 'a', password: 'b' }), { filled: false });
});

test('fillLogin returns { filled: false } when execInWorld rejects for the fill call specifically', async () => {
  const tracker = createEntryTracker({
    execInWorld: (script) =>
      script === 'INSTALL_SCRIPT' ? Promise.resolve({ installed: true }) : Promise.reject(new Error('gone')),
    installScript: 'INSTALL_SCRIPT'
  });
  assert.deepEqual(await tracker.fillLogin({ username: 'a', password: 'b' }), { filled: false });
});

// --- resolveTargetForAnchor (the shared resolution walk) --------------------

test('resolveTargetForAnchor: a login field anchor resolves { kind: "login", field: password }', () => {
  const password = { tag: 'password-field' };
  const username = { tag: 'username-field' };
  const doc = {};
  const result = resolveTargetForAnchor(doc, username, {
    findAllLoginFields: () => [{ username, password, form: null }]
  });
  assert.deepEqual(result, { kind: 'login', field: password });
});

test('resolveTargetForAnchor: a card anchor (number/cardholder/expiry/csc) resolves { kind: "card", field: number }', () => {
  const number = { tag: 'number-field' };
  const csc = { tag: 'csc-field' };
  const doc = {};
  const result = resolveTargetForAnchor(doc, csc, {
    findAllLoginFields: () => [],
    findAllCardFields: () => [
      { number, cardholder: null, expiry: null, expMonth: null, expYear: null, csc, form: null }
    ]
  });
  assert.deepEqual(result, { kind: 'card', field: number });
});

test("resolveTargetForAnchor: the split expMonth/expYear selects are never anchors (mirrors the icon's cardAnchorsOf)", () => {
  const number = { tag: 'number-field' };
  const expMonth = { tag: 'exp-month' };
  const doc = {};
  const result = resolveTargetForAnchor(doc, expMonth, {
    findAllLoginFields: () => [],
    findAllCardFields: () => [
      { number, cardholder: null, expiry: null, expMonth, expYear: null, csc: null, form: null }
    ]
  });
  assert.equal(result, null);
});

test('resolveTargetForAnchor (AC15): an identity anchor — either the postal anchor OR the non-postal anchor — resolves { kind: "identity", field: <postal anchor> }', () => {
  const street = { tag: 'street-field' };
  const email = { tag: 'email-field' };
  const doc = {};
  const identityEntry = { anchor: street, nonPostalAnchor: email };

  // Clicking the postal anchor itself.
  assert.deepEqual(
    resolveTargetForAnchor(doc, street, {
      findAllLoginFields: () => [],
      findAllCardFields: () => [],
      findAllIdentityFields: () => [identityEntry]
    }),
    { kind: 'identity', field: street }
  );

  // Clicking the non-postal anchor — the fill target is STILL the postal anchor.
  assert.deepEqual(
    resolveTargetForAnchor(doc, email, {
      findAllLoginFields: () => [],
      findAllCardFields: () => [],
      findAllIdentityFields: () => [identityEntry]
    }),
    { kind: 'identity', field: street }
  );
});

test('resolveTargetForAnchor (DD5): login, then card, then identity — precedence order', () => {
  const contested = { tag: 'contested-field' };
  const doc = {};
  // A pathological identity entry claims the SAME field a login entry claims —
  // login must win (checked first).
  const result = resolveTargetForAnchor(doc, contested, {
    findAllLoginFields: () => [{ username: null, password: contested, form: null }],
    findAllCardFields: () => [],
    findAllIdentityFields: () => [{ anchor: contested, nonPostalAnchor: null }]
  });
  assert.deepEqual(result, { kind: 'login', field: contested });
});

test('resolveTargetForAnchor: null / unrecognized anchor resolves null', () => {
  const doc = {};
  assert.equal(resolveTargetForAnchor(doc, null, { findAllLoginFields: () => [] }), null);
  assert.equal(
    resolveTargetForAnchor(doc, { tag: 'stray' }, { findAllLoginFields: () => [], findAllCardFields: () => [] }),
    null
  );
});

test('resolveTargetForAnchor: a login entry with no password field (theoretical) resolves null even for a username anchor match', () => {
  const username = { tag: 'username-field' };
  const doc = {};
  const result = resolveTargetForAnchor(doc, username, {
    findAllLoginFields: () => [{ username, password: null, form: null }]
  });
  assert.equal(result, null);
});

// --- DD3g: no node identity crosses the world boundary ----------------------

test('vault-entry-tracker.js keys no state on a field/node identity (source scan)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload', 'vault-entry-tracker.js'), 'utf8');
  // A provenance-style keying scheme needs a Map/WeakMap (or an object used as
  // one) keyed by a field reference — this module has none. It tracks only
  // `installState`/`warned`/`installing`, none of which originate in the
  // isolated world.
  assert.equal(/\bWeakMap\b/.test(source), false, 'no WeakMap — nothing here should be keyed by a node reference');
  assert.equal(/\bnew Map\(/.test(source), false, 'no Map — nothing here should be keyed by a node reference');
});

// --- readSnapshot (Leg 5 — broadened-capture, DD3f corrected) ---------------

test('readSnapshot installs first (once), then calls execInWorld for the snapshot script, and returns the resolved shape', async () => {
  const scripts = [];
  let installed = false;
  const tracker = createEntryTracker({
    execInWorld: (script) => {
      scripts.push(script);
      return new Promise((resolve) =>
        setImmediate(() => {
          if (!installed) {
            installed = true;
            resolve({ installed: true });
          } else {
            resolve({
              logins: [{ password: { detected: true, value: 'hunter2' } }],
              cards: [],
              identities: []
            });
          }
        })
      );
    },
    installScript: 'INSTALL_SCRIPT'
  });
  const snapshot = await tracker.readSnapshot();
  assert.deepEqual(snapshot, {
    logins: [{ password: { detected: true, value: 'hunter2' } }],
    cards: [],
    identities: []
  });
  assert.equal(scripts.length, 2, 'install script, then the snapshot call script');
});

test('readSnapshot fails closed to an empty { logins: [], cards: [], identities: [] } shape when the observer never installed', async () => {
  const tracker = createEntryTracker({
    execInWorld: fakeExecInWorldAlways(undefined), // never installs
    installScript: 'INSTALL_SCRIPT',
    warn: () => {}
  });
  assert.deepEqual(await tracker.readSnapshot(), { logins: [], cards: [], identities: [] });
});

test('readSnapshot fails closed to the empty shape on a rejecting execInWorld (install succeeds, snapshot call rejects)', async () => {
  let installed = false;
  const tracker = createEntryTracker({
    execInWorld: () => {
      if (!installed) {
        installed = true;
        return Promise.resolve({ installed: true });
      }
      return Promise.reject(new Error('world torn down mid-read'));
    },
    installScript: 'INSTALL_SCRIPT'
  });
  assert.deepEqual(await tracker.readSnapshot(), { logins: [], cards: [], identities: [] });
});

test('readSnapshot fails closed to the empty shape on a malformed resolved value (missing logins/cards arrays)', async () => {
  let installed = false;
  const tracker = createEntryTracker({
    execInWorld: () => {
      if (!installed) {
        installed = true;
        return Promise.resolve({ installed: true });
      }
      return Promise.resolve({ filled: false }); // the callScript() catch-all shape, not a snapshot
    },
    installScript: 'INSTALL_SCRIPT'
  });
  assert.deepEqual(await tracker.readSnapshot(), { logins: [], cards: [], identities: [] });
});

test('readSnapshot does not depend on execInWorld resolving synchronously (DD3f)', async () => {
  const d = deferred();
  let installed = false;
  const tracker = createEntryTracker({
    execInWorld: () => {
      if (!installed) {
        installed = true;
        return Promise.resolve({ installed: true });
      }
      return d.promise;
    },
    installScript: 'INSTALL_SCRIPT'
  });
  const pending = tracker.readSnapshot();
  let settled = false;
  pending.then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, 'must not have settled before the underlying promise resolves');
  d.resolve({ logins: [], cards: [{ number: { detected: true, value: '4111111111111111' } }], identities: [] });
  assert.deepEqual(await pending, {
    logins: [],
    cards: [{ number: { detected: true, value: '4111111111111111' } }],
    identities: []
  });
});

// --- DD3f (Leg 5 correction): no direct cross-process isolated-world read ---

test('source scan: no direct `webContents.executeJavaScriptInIsolatedWorld` call anywhere under src/ — only the same-process `webFrame` form is ever called', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  /** @param {string} dir @returns {string[]} */
  function walk(dir) {
    const out = [];
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (dirent.name.endsWith('.generated.js') || dirent.name.endsWith('.bundle.js')) continue; // build output, not source
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) out.push(...walk(full));
      else if (dirent.name.endsWith('.js')) out.push(full);
    }
    return out;
  }
  const srcDir = path.join(__dirname, '..', '..', 'src');
  const offenders = [];
  for (const file of walk(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    // A bare CALL, not a comment/doc-string mention — `webContents.executeJavaScriptInIsolatedWorld(`.
    if (/\bwebContents\.executeJavaScriptInIsolatedWorld\s*\(/.test(text)) offenders.push(path.relative(srcDir, file));
  }
  assert.deepEqual(
    offenders,
    [],
    `found a direct cross-process executeJavaScriptInIsolatedWorld call in: ${offenders.join(', ')}`
  );

  // Confirm the scan has teeth: the ONE legitimate call site uses the SAME-PROCESS
  // `webFrame` form instead.
  const webviewSource = fs.readFileSync(path.join(srcDir, 'preload', 'webview-preload.js'), 'utf8');
  assert.ok(
    /\bwebFrame\.executeJavaScriptInIsolatedWorld\s*\(/.test(webviewSource),
    'expected the legitimate same-process webFrame call to still be present'
  );
});
