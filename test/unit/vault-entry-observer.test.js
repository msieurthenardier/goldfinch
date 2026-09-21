'use strict';

// Unit test for the isolated-world entry OBSERVER core (Mission 21, Flight 1,
// Leg 3 — entry-tracker, DD3f/DD3g/DD3h). Zero-dep: a hand-rolled fake document
// + fake fields, the vault-fill-fields.test.js discipline. Only "does this
// genuinely run inside a spoof-immune isolated world" is left to the live probe
// (DD3f) — everything else here is ordinary, testable logic.
//
// AC fidelity requirement: `value` is modeled as a getter/setter pair on the
// FAKE FIELD's prototype, backed by a real private class field — NOT a plain own
// property — so a value-binding test genuinely exercises live reads through an
// accessor rather than a frozen snapshot.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEntryObserver, LOGIN_ROLES, CARD_ROLES } = require('../../src/preload/vault-entry-observer');

// Plain Node has no built-in MutationObserver global at all (unlike `Event`,
// which Node 22 does provide). Most tests below don't care about detachment
// behavior specifically, so a harmless default stub is installed ONCE here —
// otherwise `install()`'s bounded retry (live-verified Leg 3 fix: a freshly-
// created isolated world's FIRST script can run before MutationObserver is
// attached there) would schedule real, un-mocked setTimeout retries for every
// such test (up to MAX_ATTEMPTS × RETRY_DELAY_MS ≈ 2s of real wall-clock delay
// EACH), which is exactly the file-global-mock-timers trap avoided by instead
// giving `armMutationObserver()` something to succeed against immediately.
// Tests that specifically exercise the retry/absence path save-and-restore
// this default around their own explicit `delete global.MutationObserver`.
class DefaultFakeMutationObserver {
  observe() {}
}
global.MutationObserver = DefaultFakeMutationObserver;

class FakeField {
  #value = '';
  constructor(type, name) {
    this.type = type || 'text';
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

// A minimal fake document: real capturing-listener bookkeeping (so tests can
// fire events the SAME way the observer's own install() would receive them),
// plus a `documentElement` for the MutationObserver wiring.
function makeFakeDocument() {
  const listeners = { keydown: [], input: [] };
  const documentElement = {
    _children: [],
    querySelectorAll(sel) {
      // '*' → every currently-tracked child (flat — enough for eviction tests).
      return sel === '*' ? documentElement._children.slice() : [];
    }
  };
  return {
    documentElement,
    addEventListener(type, fn /* , capture */) {
      if (listeners[type]) listeners[type].push(fn);
    },
    // test-only helper, not part of the real DOM surface.
    _fire(type, evt) {
      for (const fn of listeners[type].slice()) fn(evt);
    }
  };
}

function trustedEvent(type, target) {
  return { type, isTrusted: true, target };
}
function untrustedEvent(type, target) {
  return { type, isTrusted: false, target };
}

/** Installs a throwaway global MutationObserver for the duration of `fn`, then restores it. */
function withFakeMutationObserver(fn) {
  const had = 'MutationObserver' in global;
  const saved = global.MutationObserver;
  const instances = [];
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.observed = null;
      instances.push(this);
    }
    observe(target) {
      this.observed = target;
    }
    // test-only trigger — fires the callback with a childList removal record.
    _removeChildren(removedNodes) {
      this.cb([{ type: 'childList', addedNodes: [], removedNodes }]);
    }
  }
  global.MutationObserver = FakeMutationObserver;
  try {
    return fn(instances);
  } finally {
    if (had) global.MutationObserver = saved;
    else delete global.MutationObserver;
  }
}

// --- short-circuit-before-resolve + isTrusted pass-through -----------------

test('an untrusted (synthetic) input/keydown never grants provenance, and never even resolves detection', () => {
  const pass = new FakeField('password', 'password');
  let detectCalls = 0;
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => {
      detectCalls++;
      return [{ username: null, password: pass, form: null }];
    }
  });
  observer.install();

  pass.value = 'attacker-value';
  doc._fire('input', untrustedEvent('input', pass));

  assert.equal(detectCalls, 0, 'an untrusted event must short-circuit BEFORE the detection walk runs at all');
  assert.equal(observer._provenanceSize(), 0);
  assert.deepEqual(observer.snapshot(), {
    logins: [{ password: { detected: true, value: null } }],
    cards: [],
    identities: []
  });
});

test('a trusted input on a detected field grants provenance (isTrusted pass-through)', () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: null, password: pass, form: null }]
  });
  observer.install();

  pass.value = 'real-typed-value';
  doc._fire('input', trustedEvent('input', pass));

  assert.equal(observer._provenanceSize(), 1);
  assert.deepEqual(observer.snapshot(), {
    logins: [{ password: { detected: true, value: 'real-typed-value' } }],
    cards: [],
    identities: []
  });
});

test('a trusted event on a field that is NOT currently detected grants nothing', () => {
  const stray = new FakeField('text', 'stray');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({ document: doc, findAllLoginFields: () => [] });
  observer.install();

  stray.value = 'whatever';
  doc._fire('input', trustedEvent('input', stray));

  assert.equal(observer._provenanceSize(), 0);
});

// --- keydown-fires-before-input ordering ------------------------------------

test('keydown grants the value BEFORE the keystroke; the following input supersedes it (real browser order)', () => {
  const user = new FakeField('text', 'username');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: user, password: null, form: null }]
  });
  observer.install();

  // Real browser order: keydown fires with the OLD value, THEN the value updates,
  // THEN input fires with the NEW value.
  user.value = '';
  doc._fire('keydown', trustedEvent('keydown', user));
  assert.deepEqual(observer.snapshot().logins[0], { username: { detected: true, value: '' } });

  user.value = 'a';
  doc._fire('input', trustedEvent('input', user));
  assert.deepEqual(
    observer.snapshot().logins[0],
    { username: { detected: true, value: 'a' } },
    "input's later grant supersedes keydown's"
  );
});

// --- the DD3 value-equality check -------------------------------------------

test('keystroke-then-overwrite: a silent script mutation after a real grant reports unprovenanced (null), never the stale OR the new value', () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: null, password: pass, form: null }]
  });
  observer.install();

  pass.value = 'hunter2real';
  doc._fire('input', trustedEvent('input', pass));
  assert.equal(observer.snapshot().logins[0].password.value, 'hunter2real');

  // No trusted event — a page can set `.value` by plain script (this repo's own
  // setFieldValue proves that requires no trusted event at all).
  pass.value = 'ATTACKER-OVERWRITE';
  assert.deepEqual(
    observer.snapshot().logins[0].password,
    { detected: true, value: null },
    'a mismatch is unprovenanced — never "trust the newer value"'
  );
});

// --- DD3i: bounded provenance lifetime (Leg 5 — broadened-capture) ---------

/** A controllable injected timer (vault-capture-drop-safety.test.js idiom). */
function makeTimer() {
  let seq = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { fn, ms });
      return { id, unref() {} };
    },
    clearTimeout: (h) => {
      if (h && pending.has(h.id)) pending.delete(h.id);
    },
    fireAll: () => {
      for (const [id, e] of [...pending]) {
        pending.delete(id);
        e.fn();
      }
    }
  };
}

test('DD3i: grant() arms a bounded-lifetime timer at PROVENANCE_TTL_MS; firing it EVICTS the entry (active eviction)', () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const timer = makeTimer();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: null, password: pass, form: null }],
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });
  observer.install();

  pass.value = 'hunter2';
  doc._fire('input', trustedEvent('input', pass));
  assert.equal(observer._hasLiveProvenance(pass), true);
  assert.equal(timer.pending.size, 1, 'exactly one expiry timer armed');

  timer.fireAll();

  assert.equal(observer._hasLiveProvenance(pass), false, 'the entry is actively evicted, not merely stale');
  assert.deepEqual(
    observer.snapshot().logins[0].password,
    { detected: true, value: null },
    'an expired grant reads the SAME unprovenanced shape as never-granted/mismatched'
  );
});

test('DD3i: the PASSIVE read-time check also catches expiry — a snapshot read past expiresAt is unprovenanced even before the timer fires', () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  let now = 1000;
  const timer = makeTimer();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: null, password: pass, form: null }],
    now: () => now,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });
  observer.install();

  pass.value = 'hunter2';
  doc._fire('input', trustedEvent('input', pass));
  assert.equal(observer.snapshot().logins[0].password.value, 'hunter2');

  // Advance the clock past the TTL WITHOUT firing the timer.
  const { PROVENANCE_TTL_MS } = require('../../src/preload/vault-entry-observer');
  now += PROVENANCE_TTL_MS + 1;

  assert.deepEqual(observer.snapshot().logins[0].password, { detected: true, value: null });
});

test('DD3i: re-granting (re-typing) an already-granted field RE-ARMS the timer rather than stacking a second one', () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const timer = makeTimer();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: null, password: pass, form: null }],
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });
  observer.install();

  pass.value = 'first';
  doc._fire('input', trustedEvent('input', pass));
  assert.equal(timer.pending.size, 1);

  pass.value = 'second';
  doc._fire('input', trustedEvent('input', pass));
  assert.equal(timer.pending.size, 1, 'the FIRST timer was cleared, not left to also fire later');
  assert.equal(observer.snapshot().logins[0].password.value, 'second');
});

test("DD3i: detachment eviction ALSO clears the field's armed expiry timer (no dangling handle survives a removed node)", () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const timer = makeTimer();
  return withFakeMutationObserver((instances) => {
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: null, password: pass, form: null }],
      setTimeout: timer.setTimeout,
      clearTimeout: timer.clearTimeout
    });
    observer.install();

    pass.value = 'hunter2';
    doc._fire('input', trustedEvent('input', pass));
    assert.equal(timer.pending.size, 1);

    instances[0]._removeChildren([pass]);

    assert.equal(timer.pending.size, 0, "the detached field's expiry timer was cleared, not left armed");
    assert.equal(observer._hasLiveProvenance(pass), false);
  });
});

test('DD3i: grantForFill ALSO carries a bounded lifetime (shares grantValue with grant)', () => {
  const pass = new FakeField('password', 'password');
  const user = new FakeField('text', 'username');
  const doc = makeFakeDocument();
  const timer = makeTimer();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: user, password: pass, form: null }],
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });
  observer.install();

  observer.grantForFill({
    filled: true,
    fields: [
      { field: user, value: 'bob' },
      { field: pass, value: 'hunter2' }
    ]
  });
  assert.equal(timer.pending.size, 2, 'both filled fields carry their own armed expiry timer');

  timer.fireAll();
  assert.equal(observer._hasLiveProvenance(user), false);
  assert.equal(observer._hasLiveProvenance(pass), false);
});

test('DD3i: a missing setTimeout/clearTimeout injection fails CLOSED — grant() still records the field (passive-only bound), never throws', () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: null, password: pass, form: null }]
    // no setTimeout/clearTimeout injected — falls back to Node's real globals
    // in THIS test process (unref'd, so it never blocks the suite exiting).
  });
  observer.install();
  assert.doesNotThrow(() => {
    pass.value = 'hunter2';
    doc._fire('input', trustedEvent('input', pass));
  });
  assert.equal(observer.snapshot().logins[0].password.value, 'hunter2');
});

test('DD3i: pagehide (belt-and-suspenders unload clear) wipes every granted field and its timer', () => {
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const timer = makeTimer();
  const pagehideListeners = [];
  const fakeWindow = {
    addEventListener(type, fn) {
      if (type === 'pagehide') pagehideListeners.push(fn);
    }
  };
  const hadWindow = 'window' in global;
  const savedWindow = global.window;
  global.window = fakeWindow;
  try {
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: null, password: pass, form: null }],
      setTimeout: timer.setTimeout,
      clearTimeout: timer.clearTimeout
    });
    observer.install();
    assert.equal(pagehideListeners.length, 1, 'install() registers exactly one pagehide listener');

    pass.value = 'hunter2';
    doc._fire('input', trustedEvent('input', pass));
    assert.equal(timer.pending.size, 1);

    pagehideListeners[0]();

    assert.equal(timer.pending.size, 0, 'pagehide clears every armed timer');
    assert.equal(observer._provenanceSize(), 0);
  } finally {
    if (hadWindow) global.window = savedWindow;
    else delete global.window;
  }
});

test('fill-then-mutate: grantForFill binds provenance to the written value; a later silent mutation breaks it', () => {
  const number = new FakeField('text', 'number');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [],
    findAllCardFields: () => [
      { number, cardholder: null, expiry: null, expMonth: null, expYear: null, csc: null, form: null }
    ]
  });
  observer.install();

  number.value = '4242424242424242';
  observer.grantForFill({ filled: true, fields: [{ field: number, value: '4242424242424242' }] });
  assert.equal(observer.snapshot().cards[0].number.value, '4242424242424242');

  number.value = 'ATTACKER-AFTER-FILL';
  assert.deepEqual(observer.snapshot().cards[0].number, { detected: true, value: null });
});

test('grantForFill grants provenance for EXACTLY the fields the fill result names — never for a sibling field', () => {
  const user = new FakeField('text', 'username');
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: user, password: pass, form: null }]
  });
  observer.install();

  user.value = 'bob';
  pass.value = 'hunter2';
  // Simulate a password-only fill result (e.g. cred.username was null).
  observer.grantForFill({ filled: true, fields: [{ field: pass, value: 'hunter2' }] });

  assert.deepEqual(observer.snapshot().logins[0], {
    username: { detected: true, value: null }, // never granted — not in the fill result
    password: { detected: true, value: 'hunter2' }
  });
});

test('grantForFill on a malformed / missing result is a safe no-op', () => {
  const doc = makeFakeDocument();
  const observer = createEntryObserver({ document: doc, findAllLoginFields: () => [] });
  observer.install();
  assert.doesNotThrow(() => observer.grantForFill(null));
  assert.doesNotThrow(() => observer.grantForFill(undefined));
  assert.doesNotThrow(() => observer.grantForFill({ filled: false }));
  assert.equal(observer._provenanceSize(), 0);
});

// --- detachment eviction -----------------------------------------------------

test('detachment eviction: a removed field is cleared WITHOUT its value changing (the round-1 review bug)', () => {
  withFakeMutationObserver((instances) => {
    const pass = new FakeField('password', 'password');
    const doc = makeFakeDocument();
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: null, password: pass, form: null }]
    });
    observer.install();

    pass.value = 'hunter2real';
    doc._fire('input', trustedEvent('input', pass));
    assert.equal(observer._provenanceSize(), 1);

    // Removed WITHOUT touching .value — a lazy value/liveness check would never
    // fire here, which is exactly the round-1 review finding.
    assert.equal(pass.value, 'hunter2real', 'sanity: value is untouched by removal');
    instances[0]._removeChildren([pass]);

    assert.equal(observer._provenanceSize(), 0, "the removed field's provenance entry must be evicted");
  });
});

test('detachment eviction: a removed WRAPPER evicts every descendant input (framework unmount removes a wrapper, not each input)', () => {
  withFakeMutationObserver((instances) => {
    const user = new FakeField('text', 'username');
    const pass = new FakeField('password', 'password');
    const wrapper = {
      querySelectorAll(sel) {
        return sel === '*' ? [user, pass] : [];
      }
    };
    const doc = makeFakeDocument();
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: user, password: pass, form: null }]
    });
    observer.install();

    user.value = 'alice';
    doc._fire('input', trustedEvent('input', user));
    pass.value = 'hunter2real';
    doc._fire('input', trustedEvent('input', pass));
    assert.equal(observer._provenanceSize(), 2);

    instances[0]._removeChildren([wrapper]);

    assert.equal(observer._provenanceSize(), 0, 'both descendants evicted via the wrapper removal alone');
  });
});

test('install() is a safe no-op when no global MutationObserver exists, ever (still wires keydown/input; bounded retry gives up)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const had = 'MutationObserver' in global;
  const saved = global.MutationObserver;
  delete global.MutationObserver;
  try {
    const pass = new FakeField('password', 'password');
    const doc = makeFakeDocument();
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: null, password: pass, form: null }]
    });
    assert.doesNotThrow(() => observer.install());

    pass.value = 'hunter2real';
    doc._fire('input', trustedEvent('input', pass));
    assert.equal(observer._provenanceSize(), 1, 'event granting still works without a MutationObserver');
    assert.equal(observer._mutationObserverArmed(), false);

    // Drain the BOUNDED retry to completion, one 100ms step at a time (never
    // one big tick — the house MockTimers recipe) — generous upper bound so
    // this proves the retry actually STOPS rather than running forever.
    for (let i = 0; i < 30; i++) t.mock.timers.tick(100);
    assert.equal(observer._mutationObserverArmed(), false, 'still never armed — nothing to retry into');
  } finally {
    if (had) global.MutationObserver = saved;
  }
});

test('install() degrades gracefully when setTimeout does not exist in the realm at all — the retry arm is skipped, never a bare-global ReferenceError', () => {
  const hadMO = 'MutationObserver' in global;
  const savedMO = global.MutationObserver;
  const hadST = 'setTimeout' in global;
  const savedST = global.setTimeout;
  // Both gaps at once: MutationObserver missing forces install() down the
  // retry-arming branch at all, and setTimeout missing (never injected, and
  // absent from the global too — the flight-end review finding's exact
  // scenario) is what a bare `setTimeout(...)` call would have thrown a
  // ReferenceError against.
  delete global.MutationObserver;
  delete global.setTimeout;
  try {
    const pass = new FakeField('password', 'password');
    const doc = makeFakeDocument();
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: null, password: pass, form: null }]
      // no setTimeout/clearTimeout injected, and none on the global either.
    });

    assert.doesNotThrow(
      () => observer.install(),
      'install() must not throw arming the bounded retry when there is no timer function anywhere'
    );
    assert.equal(observer._mutationObserverArmed(), false, 'never armed — nothing to retry with');

    // The failure is confined to detachment eviction (which needed the
    // MutationObserver this retry would have armed) — ordinary event-granting
    // is completely unaffected.
    pass.value = 'hunter2real';
    doc._fire('input', trustedEvent('input', pass));
    assert.equal(
      observer._provenanceSize(),
      1,
      'event granting still works — the loss is confined to detachment eviction, not the whole install'
    );
  } finally {
    if (hadMO) global.MutationObserver = savedMO;
    else delete global.MutationObserver;
    if (hadST) global.setTimeout = savedST;
    else delete global.setTimeout;
  }
});

test('a MutationObserver that becomes available AFTER install() (live-verified Leg 3 timing gap) is picked up by the bounded retry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const had = 'MutationObserver' in global;
  const saved = global.MutationObserver;
  delete global.MutationObserver; // not yet available at install() time
  try {
    const pass = new FakeField('password', 'password');
    const doc = makeFakeDocument();
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: null, password: pass, form: null }]
    });
    observer.install();
    assert.equal(observer._mutationObserverArmed(), false, 'unavailable at install() time, exactly the live finding');

    // The world "finishes initializing" a couple of retry steps later —
    // single-step ticks, draining real setImmediate work between them so no
    // intermediate state is skipped.
    t.mock.timers.tick(100);
    t.mock.timers.tick(100);

    class LateMutationObserver {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {}
    }
    global.MutationObserver = LateMutationObserver;

    t.mock.timers.tick(100); // the next scheduled retry now finds it
    assert.equal(
      observer._mutationObserverArmed(),
      true,
      'the retry must pick up a MutationObserver that arrives late'
    );
  } finally {
    if (had) global.MutationObserver = saved;
    else delete global.MutationObserver;
  }
});

// --- the emitted snapshot shape (DD3h three-state) --------------------------

test('snapshot shape: detected+provenanced, detected+unprovenanced, and never-detected are three DIFFERENT wire shapes', () => {
  const user = new FakeField('text', 'username'); // will be provenanced
  const pass = new FakeField('password', 'password'); // detected, never typed into
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: user, password: pass, form: null }]
  });
  observer.install();

  user.value = 'alice';
  doc._fire('input', trustedEvent('input', user));

  const snap = observer.snapshot();
  assert.deepEqual(snap, {
    logins: [
      {
        username: { detected: true, value: 'alice' }, // detected + provenanced
        password: { detected: true, value: null } // detected + unprovenanced
      }
    ],
    cards: [],
    identities: []
  });
  // The third state — never detected — is a KEY ABSENT, not a third value. A
  // password-only entry (no username field at all) proves it directly:
  const passOnlyObserver = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: null, password: pass, form: null }]
  });
  const passOnlySnap = passOnlyObserver.snapshot();
  assert.equal(
    'username' in passOnlySnap.logins[0],
    false,
    'no username field at all → key absent, not { detected:false }'
  );
  assert.equal(Object.keys(passOnlySnap.logins[0]).length, 1);
});

test('report() is called with the current snapshot after a grant, a fill-grant, and a detachment', () => {
  withFakeMutationObserver((instances) => {
    const pass = new FakeField('password', 'password');
    const reports = [];
    const doc = makeFakeDocument();
    const observer = createEntryObserver({
      document: doc,
      findAllLoginFields: () => [{ username: null, password: pass, form: null }],
      report: (snap) => reports.push(snap)
    });
    observer.install();

    pass.value = 'hunter2real';
    doc._fire('input', trustedEvent('input', pass));
    assert.equal(reports.length, 1);

    observer.grantForFill({ filled: true, fields: [{ field: pass, value: 'refilled' }] });
    assert.equal(reports.length, 2);

    instances[0]._removeChildren([pass]);
    assert.equal(reports.length, 3);

    for (const snap of reports) {
      assert.ok(Array.isArray(snap.logins) && Array.isArray(snap.cards), 'every report is the same plain shape');
    }
  });
});

// --- no node identity crosses (structural: report/snapshot payloads are plain) --

test('every value in a snapshot is a boolean or a string — never a field/node reference', () => {
  const user = new FakeField('text', 'username');
  const pass = new FakeField('password', 'password');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [{ username: user, password: pass, form: null }]
  });
  observer.install();
  user.value = 'alice';
  doc._fire('input', trustedEvent('input', user));

  const seen = [];
  (function walk(v) {
    seen.push(v);
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  })(observer.snapshot());

  for (const v of seen) {
    assert.ok(
      v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'object',
      'unexpected non-plain value in snapshot'
    );
    assert.notEqual(v, user, 'a field reference must never appear in the snapshot');
    assert.notEqual(v, pass, 'a field reference must never appear in the snapshot');
  }
});

// --- "the observer carries no policy", pinned concretely --------------------

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'preload', 'vault-entry-observer.js');
const SOURCE_TEXT = fs.readFileSync(SOURCE_PATH, 'utf8');
// Measured at Leg 3 landing (this test's own newline-split metric, the house
// RENDERER_LINE_BUDGET idiom) + a small headroom buffer for incidental drift —
// not planned growth. RAISED from 260 to 300 during this same leg: the live
// probe found a real defect (a freshly-created isolated world's FIRST script
// execution can run before MutationObserver is attached there — live-verified,
// not theoretical) and the bounded-retry fix that closes it earns its ~35
// lines. RAISED AGAIN from 300 to 390 at Leg 5 (broadened-capture, DD3i):
// bounded provenance lifetime — the expiry timer/clock injection, the
// grant/grantForFill unification into grantValue, active eviction on expiry,
// and the pagehide belt-and-suspenders clear — earns its ~70 lines. RAISED
// AGAIN from 410 to 425 at Mission 21 Flight 3 Leg 3 (identity-fill, AC4): a
// third injected finder (`findAllIdentityFields`), the imported (never
// hand-typed — AC3b) `IDENTITY_ROLES`, and identity's third arm in `detect()`
// / `isDetectedField()` / `snapshot()` earns its ~12 lines. A future leg that
// needs more room bumps this explicitly.
const OBSERVER_LINE_BUDGET = 425;

test('the observer carries no save/update/dispose/IPC policy vocabulary (source scan)', () => {
  const forbidden = [
    /\bupdate\b/i,
    /\bsave\b/i,
    /\bdispose\b/i,
    /\bcaptureId\b/i,
    /ipcRenderer/,
    /ipcMain/,
    /\bsend\(/,
    /\binvoke\(/
  ];
  for (const re of forbidden) {
    assert.equal(
      re.test(SOURCE_TEXT),
      false,
      `vault-entry-observer.js must not reference ${re} — that is policy, owned by vault-entry-tracker.js`
    );
  }
});

test('vault-entry-observer.js stays within its line-ceiling', () => {
  const lines = SOURCE_TEXT.split(/\r?\n/).length;
  assert.ok(
    lines <= OBSERVER_LINE_BUDGET,
    `vault-entry-observer.js has ${lines} lines; budget is ${OBSERVER_LINE_BUDGET}`
  );
});

// --- exported role lists are the exact wire vocabulary ----------------------

test('LOGIN_ROLES / CARD_ROLES match the roles the pure field modules actually resolve', () => {
  assert.deepEqual(LOGIN_ROLES, ['username', 'password']);
  assert.deepEqual(CARD_ROLES, ['number', 'cardholder', 'expiry', 'expMonth', 'expYear', 'csc']);
});

// --- identity (M21 F3 Leg 3, AC4) --------------------------------------------

test('snapshot() returns an identities array alongside logins/cards, three-state per role', () => {
  const street = new FakeField('text', 'street');
  const fullName = new FakeField('text', 'fullName');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [],
    findAllIdentityFields: () => [
      {
        anchor: street,
        anchorRole: 'street',
        fullName,
        firstName: null,
        lastName: null,
        email: null,
        phone: null,
        street,
        street2: null,
        city: null,
        region: null,
        country: null,
        postalCode: null
      }
    ]
  });
  observer.install();

  const before = observer.snapshot();
  assert.deepEqual(before.identities, [
    { fullName: { detected: true, value: null }, street: { detected: true, value: null }, anchorRole: 'street' }
  ]);

  street.value = '123 Main St';
  doc._fire('input', trustedEvent('input', street));
  const after = observer.snapshot();
  assert.equal(after.identities[0].street.value, '123 Main St');
});

test('a trusted keystroke into an identity field grants provenance the same as login/card', () => {
  const email = new FakeField('email', 'email');
  const street = new FakeField('text', 'street');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [],
    findAllIdentityFields: () => [
      {
        anchor: street,
        fullName: null,
        firstName: null,
        lastName: null,
        email,
        phone: null,
        street,
        street2: null,
        city: null,
        region: null,
        country: null,
        postalCode: null
      }
    ]
  });
  observer.install();

  email.value = 'a@b.com';
  doc._fire('input', trustedEvent('input', email));
  assert.equal(observer.snapshot().identities[0].email.value, 'a@b.com');

  // A synthetic (untrusted) input never grants.
  street.value = 'forged';
  doc._fire('input', untrustedEvent('input', street));
  assert.equal(observer.snapshot().identities[0].street.value, null);
});

test('grantForFill grants provenance for an identity fill result exactly like login/card', () => {
  const street = new FakeField('text', 'street');
  const doc = makeFakeDocument();
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields: () => [],
    findAllIdentityFields: () => [
      {
        anchor: street,
        fullName: null,
        firstName: null,
        lastName: null,
        email: null,
        phone: null,
        street,
        street2: null,
        city: null,
        region: null,
        country: null,
        postalCode: null
      }
    ]
  });
  observer.install();

  street.value = '123 Main St';
  observer.grantForFill({ filled: true, fields: [{ field: street, value: '123 Main St' }] });
  assert.equal(observer.snapshot().identities[0].street.value, '123 Main St');
});

test("IDENTITY_ROLES (imported, AC3b) matches identity's own detector role names", () => {
  const { IDENTITY_ROLES } = require('../../src/preload/vault-identity-fields');
  assert.deepEqual(
    IDENTITY_ROLES.slice().sort(),
    [
      'city',
      'country',
      'email',
      'firstName',
      'fullName',
      'lastName',
      'phone',
      'postalCode',
      'region',
      'street',
      'street2'
    ].sort()
  );
});
