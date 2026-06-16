'use strict';

// Unit tests for src/main/automation/resolve.js
//
// Electron-free: the module does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub. Fake wc/session
// objects stand in for real Electron webContents and Session objects.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isInternalContents, classifyContents, resolveContents, resolveContentsForJar } = require('../../src/main/automation/resolve');

// ---------------------------------------------------------------------------
// isInternalContents — predicate matrix
// ---------------------------------------------------------------------------

test('isInternalContents: session.__goldfinchInternal === true → true', () => {
  assert.equal(isInternalContents({ session: { __goldfinchInternal: true } }), true);
});

test('isInternalContents: session.__goldfinchInternal === false → false', () => {
  assert.equal(isInternalContents({ session: { __goldfinchInternal: false } }), false);
});

test('isInternalContents: session.__goldfinchInternal === 1 (truthy-but-not-true) → false (pins strict ===true)', () => {
  assert.equal(isInternalContents({ session: { __goldfinchInternal: 1 } }), false);
});

test('isInternalContents: missing session → false', () => {
  assert.equal(isInternalContents({ }), false);
});

test('isInternalContents: null wc → false', () => {
  assert.equal(isInternalContents(null), false);
});

test('isInternalContents: undefined wc → false', () => {
  assert.equal(isInternalContents(undefined), false);
});

test('isInternalContents: session.__goldfinchInternal === undefined → false', () => {
  assert.equal(isInternalContents({ session: {} }), false);
});

// ---------------------------------------------------------------------------
// classifyContents — identity comparison
// ---------------------------------------------------------------------------

test('classifyContents: wc === chromeContents → "chrome"', () => {
  const wc = { id: 1 };
  assert.equal(classifyContents(wc, wc), 'chrome');
});

test('classifyContents: wc !== chromeContents → "guest"', () => {
  const wc = { id: 1 };
  const chromeContents = { id: 2 };
  assert.equal(classifyContents(wc, chromeContents), 'guest');
});

test('classifyContents: null chromeContents injection → "guest" (engine glue injects live chrome; null never matches)', () => {
  const wc = { id: 1 };
  assert.equal(classifyContents(wc, null), 'guest');
});

// ---------------------------------------------------------------------------
// resolveContents — with fake fromId
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake webContents for a web/guest context.
 */
function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; }
  };
}

/**
 * Build a fake internal-session webContents (goldfinch://settings guest).
 */
function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; }
  };
}

/**
 * Build a fake destroyed webContents.
 */
function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return true; }
  };
}

test('resolveContents: valid guest wcId → returns the webContents', () => {
  const wc = makeGuestWc(10);
  const fromId = (id) => id === 10 ? wc : null;
  const result = resolveContents(10, { fromId, chromeContents: null });
  assert.equal(result, wc);
});

test('resolveContents: valid chrome wcId → returns the webContents (classifyContents can then identify it)', () => {
  const chromeContents = { id: 1, session: { __goldfinchInternal: false }, isDestroyed() { return false; } };
  const fromId = (id) => id === 1 ? chromeContents : null;
  const result = resolveContents(1, { fromId, chromeContents });
  assert.equal(result, chromeContents);
  // Verify classifier identifies it correctly
  assert.equal(classifyContents(result, chromeContents), 'chrome');
});

test('resolveContents: internal-session wcId (direct supply) → throws internal-session (DD5 bypass-path guard)', () => {
  // This is the load-bearing security test: a directly-supplied internal-guest
  // wcId must be rejected at resolve-time, not merely filtered from enumerate.
  const internalWc = makeInternalWc(99);
  const fromId = (id) => id === 99 ? internalWc : null;
  assert.throws(
    () => resolveContents(99, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('resolveContents: fromId returns null → throws no-such-contents', () => {
  const fromId = () => null;
  assert.throws(
    () => resolveContents(42, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('resolveContents: fromId returns undefined → throws no-such-contents', () => {
  const fromId = () => undefined;
  assert.throws(
    () => resolveContents(42, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('resolveContents: non-number wcId (string) → throws bad-handle', () => {
  const fromId = () => null;
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => resolveContents('10', { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('resolveContents: non-number wcId (null) → throws bad-handle', () => {
  const fromId = () => null;
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => resolveContents(null, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('resolveContents: destroyed webContents → throws no-such-contents', () => {
  // A resolved-but-destroyed contents is treated as gone (AC6, edge cases).
  const destroyedWc = makeDestroyedWc(55);
  const fromId = (id) => id === 55 ? destroyedWc : null;
  assert.throws(
    () => resolveContents(55, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

// ---------------------------------------------------------------------------
// resolveContents — allowInternal (DD6 / Leg 2): admin's sole relaxation
// ---------------------------------------------------------------------------

test('resolveContents: allowInternal:true SKIPS the internal-session throw (admin relaxation)', () => {
  const internalWc = makeInternalWc(99);
  const fromId = (id) => id === 99 ? internalWc : null;
  const result = resolveContents(99, { fromId, chromeContents: null, allowInternal: true });
  assert.equal(result, internalWc);
});

test('resolveContents: allowInternal:true STILL throws bad-handle (cap is internal-only)', () => {
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => resolveContents('x', { fromId: () => null, chromeContents: null, allowInternal: true }),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('resolveContents: allowInternal:true STILL throws no-such-contents (cap is internal-only)', () => {
  assert.throws(
    () => resolveContents(7, { fromId: () => null, chromeContents: null, allowInternal: true }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('resolveContents: allowInternal:false (explicit) still throws internal-session', () => {
  const internalWc = makeInternalWc(99);
  const fromId = (id) => id === 99 ? internalWc : null;
  assert.throws(
    () => resolveContents(99, { fromId, chromeContents: null, allowInternal: false }),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

// ---------------------------------------------------------------------------
// resolveContentsForJar (net-new, Leg 2 / DD7) — SESSION OBJECT IDENTITY
// ---------------------------------------------------------------------------

// One interned Session object per partition — the === identity is the test.
function makeSessionWorld() {
  const sessions = new Map();
  const sessionFor = (partition) => {
    if (!sessions.has(partition)) sessions.set(partition, { __partition: partition, __goldfinchInternal: partition === 'goldfinch-internal' });
    return sessions.get(partition);
  };
  return { sessionFor, fromPartition: (p) => sessionFor(p) };
}

function makeWcInPartition(id, partition, world) {
  return { id, session: world.sessionFor(partition), isDestroyed() { return false; } };
}

test('resolveContentsForJar: wc whose session === jar session → returns the wc', () => {
  const world = makeSessionWorld();
  const jar = { id: 'personal', partition: 'persist:container:personal' };
  const wc = makeWcInPartition(10, jar.partition, world);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null, fromPartition: world.fromPartition };
  assert.equal(resolveContentsForJar(10, jar, deps), wc);
});

test('resolveContentsForJar: wc in a DIFFERENT jar session → throws out-of-jar', () => {
  const world = makeSessionWorld();
  const personal = { id: 'personal', partition: 'persist:container:personal' };
  // wc belongs to 'work' session, but we ask for 'personal'.
  const wc = makeWcInPartition(11, 'persist:container:work', world);
  const deps = { fromId: (id) => id === 11 ? wc : null, chromeContents: null, fromPartition: world.fromPartition };
  assert.throws(
    () => resolveContentsForJar(11, personal, deps),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('resolveContentsForJar: burner session (matches no jar) → throws out-of-jar', () => {
  const world = makeSessionWorld();
  const personal = { id: 'personal', partition: 'persist:container:personal' };
  const wc = makeWcInPartition(12, 'burner:1', world);
  const deps = { fromId: (id) => id === 12 ? wc : null, chromeContents: null, fromPartition: world.fromPartition };
  assert.throws(
    () => resolveContentsForJar(12, personal, deps),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('resolveContentsForJar: null jar → throws out-of-jar (a key bound to no jar drives nothing)', () => {
  const world = makeSessionWorld();
  const wc = makeWcInPartition(13, 'persist:container:personal', world);
  const deps = { fromId: (id) => id === 13 ? wc : null, chromeContents: null, fromPartition: world.fromPartition };
  assert.throws(
    () => resolveContentsForJar(13, null, deps),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('resolveContentsForJar: bad/dead/internal still throw via resolveContents FIRST (before membership)', () => {
  const world = makeSessionWorld();
  const jar = { id: 'personal', partition: 'persist:container:personal' };
  const deps = { fromId: () => null, chromeContents: null, fromPartition: world.fromPartition };
  // bad-handle
  assert.throws(
    // @ts-expect-error — wrong type on purpose
    () => resolveContentsForJar('x', jar, deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
  // no-such-contents
  assert.throws(
    () => resolveContentsForJar(99, jar, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  // internal-session: jar deps carry no allowInternal → internal throws before membership
  const internalWc = makeWcInPartition(50, 'goldfinch-internal', world);
  const internalDeps = { fromId: (id) => id === 50 ? internalWc : null, chromeContents: null, fromPartition: world.fromPartition };
  assert.throws(
    () => resolveContentsForJar(50, jar, internalDeps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('resolveContentsForJar: LAZY fromPartition compare picks up a RUNTIME jars-add', () => {
  // A jar added at runtime: its partition interns a fresh Session on first
  // fromPartition call. The compare is lazy (no cached map), so a wc created in
  // that partition resolves correctly the moment the jar exists.
  const world = makeSessionWorld();
  const newJar = { id: 'just-added', partition: 'persist:container:just-added' };
  const wc = makeWcInPartition(20, newJar.partition, world);
  const deps = { fromId: (id) => id === 20 ? wc : null, chromeContents: null, fromPartition: world.fromPartition };
  assert.equal(resolveContentsForJar(20, newJar, deps), wc);
});

// ---------------------------------------------------------------------------
// resolveContentsForJar — chrome-exclusion guard (Flight 6, defense-in-depth)
// ---------------------------------------------------------------------------

test('resolveContentsForJar: wc === deps.chromeContents AND session matches the jar → throws out-of-jar BEFORE session check (ordering proof)', () => {
  // Synthetic: wc IS the chromeContents object AND its session happens to equal the jar
  // partition's session. In real code this collision cannot occur (the chrome uses
  // defaultSession, no jar aliases it), but the test proves the chrome-exclusion guard
  // fires before/independent of the session check. AC2 ordering requirement.
  const world = makeSessionWorld();
  const jar = { id: 'default', partition: 'persist:goldfinch' };
  // Build a wc whose session matches the jar AND also IS the chromeContents reference.
  const sharedSession = world.sessionFor(jar.partition);
  const wc = { id: 42, session: sharedSession, isDestroyed() { return false; } };
  // chromeContents IS the same object — object identity match.
  const deps = {
    fromId: (id) => id === 42 ? wc : null,
    chromeContents: wc,
    fromPartition: world.fromPartition,
  };
  // Must throw out-of-jar with the chrome-renderer message — NOT pass through to the
  // session check (which would also refuse, but for the wrong reason).
  assert.throws(
    () => resolveContentsForJar(42, jar, deps),
    (err) => err instanceof Error
      && err.message.includes('automation: out-of-jar')
      && err.message.includes('chrome renderer'),
    'chrome-exclusion guard must fire before the session check'
  );
});

test('resolveContentsForJar: nullish deps.chromeContents → guard is a no-op, normal in-jar guest resolves', () => {
  // When no chromeContents is injected (e.g. in tests that don't set it), the guard
  // must not misfire — !deps.chromeContents != null is false, so the guard skips.
  const world = makeSessionWorld();
  const jar = { id: 'personal', partition: 'persist:container:personal' };
  const wc = makeWcInPartition(10, jar.partition, world);
  const deps = {
    fromId: (id) => id === 10 ? wc : null,
    chromeContents: null, // explicitly null
    fromPartition: world.fromPartition,
  };
  // Should NOT throw — the null guard (!= null) prevents the guard from firing.
  assert.equal(resolveContentsForJar(10, jar, deps), wc);
});

test('resolveContentsForJar: undefined deps.chromeContents → guard is a no-op', () => {
  const world = makeSessionWorld();
  const jar = { id: 'personal', partition: 'persist:container:personal' };
  const wc = makeWcInPartition(11, jar.partition, world);
  const deps = {
    fromId: (id) => id === 11 ? wc : null,
    // chromeContents absent (undefined)
    fromPartition: world.fromPartition,
  };
  assert.equal(resolveContentsForJar(11, jar, deps), wc);
});

test('resolveContents: error messages are distinguishable per guard', () => {
  // Pins AC4: three distinct prefixes so callers can identify which guard fired.
  const internalWc = makeInternalWc(1);
  const guestWc = makeGuestWc(2);

  let badHandleMsg, noSuchMsg, internalSessionMsg;

  try {
    // @ts-expect-error — intentionally passing wrong type
    resolveContents('x', { fromId: () => null, chromeContents: null });
  } catch (e) { badHandleMsg = e.message; }

  try {
    resolveContents(2, { fromId: () => null, chromeContents: null });
  } catch (e) { noSuchMsg = e.message; }

  try {
    resolveContents(1, { fromId: (id) => id === 1 ? internalWc : null, chromeContents: guestWc });
  } catch (e) { internalSessionMsg = e.message; }

  assert.ok(badHandleMsg.includes('bad-handle'), 'bad-handle path must say bad-handle');
  assert.ok(noSuchMsg.includes('no-such-contents'), 'no-such path must say no-such-contents');
  assert.ok(internalSessionMsg.includes('internal-session'), 'internal path must say internal-session');

  // All three must be distinct messages
  assert.notEqual(badHandleMsg, noSuchMsg);
  assert.notEqual(noSuchMsg, internalSessionMsg);
  assert.notEqual(badHandleMsg, internalSessionMsg);
});
