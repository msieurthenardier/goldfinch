'use strict';

// Unit tests for src/main/automation/resolve.js
//
// Electron-free: the module does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub. Fake wc/session
// objects stand in for real Electron webContents and Session objects.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isInternalContents,
  classifyContents,
  resolveContents,
  resolveContentsForJar,
  AUTOMATABLE_MENU_TYPES
} = require('../../src/main/automation/resolve');

// M15 F3 L1 (AC1) — the allowlist is IMPORTED, never retyped, so a member renamed in
// resolve.js cannot leave these tests passing against a string that no longer exists.
const [ADMITTED_MENU_TYPE, SECOND_ADMITTED_MENU_TYPE] = [...AUTOMATABLE_MENU_TYPES];
// A menuType deliberately NOT on the allowlist, and the reason the allowlist exists at all:
// the sheet state where the vault's master password is typed.
const SECRET_MENU_TYPE = 'vault-unlock';

/**
 * Build the (menuType × op) sheet-gate deps for a fake sheet wc.
 * @param {any} sheet  the fake sheet webContents
 * @param {{ menu?: any, allowSheet?: boolean, wireReader?: boolean, allowInternal?: boolean }} [o]
 */
function sheetDeps(sheet, { menu = null, allowSheet = false, wireReader = true, allowInternal = false } = {}) {
  return {
    fromId: (/** @type {number} */ id) => (id === sheet.id ? sheet : null),
    chromeContents: null,
    isSheetContents: (/** @type {any} */ wc) => wc === sheet,
    ...(allowInternal ? { allowInternal: true } : {}),
    ...(allowSheet ? { allowSheet: true } : {}),
    ...(wireReader ? { sheetMenuFor: (/** @type {any} */ wc) => (wc === sheet ? menu : null) } : {})
  };
}

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
  assert.equal(isInternalContents({}), false);
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
    isDestroyed() {
      return false;
    }
  };
}

/**
 * Build a fake internal-session webContents (goldfinch://settings guest).
 */
function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() {
      return false;
    }
  };
}

/**
 * Build a fake destroyed webContents.
 */
function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return true;
    }
  };
}

test('resolveContents: valid guest wcId → returns the webContents', () => {
  const wc = makeGuestWc(10);
  const fromId = (id) => (id === 10 ? wc : null);
  const result = resolveContents(10, { fromId, chromeContents: null });
  assert.equal(result, wc);
});

// RE-TARGETED, NOT DELETED (M15 F3 L1 AC12). This test formerly asserted that the sheet is
// refused "at EVERY tier, admin included" — an absolute the leg deliberately narrows to a
// (menuType × op) admission. What SURVIVES verbatim is everything the absolute was actually
// protecting: with no op opt-in — which is every op but three, and every op added later — the
// sheet is still refused at every tier, admin's allowInternal included.
test('resolveContents: the vault SECRET SHEET wc is refused at every tier for any op that did NOT opt in (PR#112 finding 1, narrowed by M15 F3 L1 DD1a)', () => {
  const sheet = makeGuestWc(50);
  const fromId = (id) => (id === 50 ? sheet : null);
  const isSheetContents = (wc) => wc === sheet;
  // The sheet is showing an ALLOWLISTED menu — the most permissive menuType half there is.
  const sheetMenuFor = (wc) => (wc === sheet ? { menuType: ADMITTED_MENU_TYPE, token: 7 } : null);

  // Non-admin (no allowInternal), no allowSheet: refused.
  assert.throws(
    () => resolveContents(50, { fromId, chromeContents: null, isSheetContents, sheetMenuFor }),
    /automation: secret-sheet/
  );
  // ADMIN (allowInternal:true) — the relaxation that lifts internal-session + non-tab-contents
  // does NOT lift this: without the op opt-in the sheet stays undrivable, so it can never be
  // keylogged and no non-admitted op can read it, allowlisted menuType or not.
  assert.throws(
    () => resolveContents(50, { fromId, chromeContents: null, allowInternal: true, isSheetContents, sheetMenuFor }),
    /automation: secret-sheet/
  );
  // A normal guest tab is unaffected by the predicate.
  const tab = makeGuestWc(51);
  const fromId2 = (id) => (id === 51 ? tab : null);
  assert.equal(
    resolveContents(51, { fromId: fromId2, chromeContents: null, isSheetContents: (wc) => wc === sheet }),
    tab
  );
});

// ---------------------------------------------------------------------------
// M15 F3 L1 (DD1/DD1a/DD1b/DD1d) — the sheet's (menuType × op) gate.
// AC1 (both allowlists, fail-closed shape) and AC2 (null refuses at every tier).
// ---------------------------------------------------------------------------

test('sheet gate (AC1): admitted ONLY when allowSheet AND the current menuType is on AUTOMATABLE_MENU_TYPES', () => {
  const sheet = makeGuestWc(60);
  // BOTH seeded menuTypes are admitted (the allowlist is iterated, not retyped).
  for (const menuType of AUTOMATABLE_MENU_TYPES) {
    const deps = sheetDeps(sheet, { menu: { menuType, token: 3 }, allowSheet: true });
    assert.equal(resolveContents(60, deps), sheet, menuType + ' is admitted for an opted-in op');
    // ...and still admitted at the admin tier, where allowInternal is also set.
    assert.equal(resolveContents(60, { ...deps, allowInternal: true }), sheet);
  }
});

test('sheet gate (AC1): an opted-in op is STILL refused under a non-allowlisted menuType — allowlist, never denylist (DD1d)', () => {
  const sheet = makeGuestWc(61);
  assert.throws(
    () => resolveContents(61, sheetDeps(sheet, { menu: { menuType: SECRET_MENU_TYPE, token: 1 }, allowSheet: true })),
    /automation: secret-sheet/,
    'vault-unlock is not on the allowlist, so even readDom/readAxTree/captureScreenshot are refused'
  );
  // A menuType invented by a future flight is refused by DEFAULT — it did nothing to be admitted.
  assert.throws(
    () =>
      resolveContents(
        61,
        sheetDeps(sheet, { menu: { menuType: 'some-future-menu', token: 1 }, allowSheet: true, allowInternal: true })
      ),
    /automation: secret-sheet/
  );
});

test('sheet gate (AC1): the predicate is FAIL-CLOSED IN SHAPE — an absent sheetMenuFor injection REFUSES, it does not throw a TypeError', () => {
  const sheet = makeGuestWc(62);
  // allowSheet is set (an admitted op) but the menuType reader was never injected — the
  // offline-test / legacy-caller / half-wired-engine-site case.
  let err;
  try {
    resolveContents(62, sheetDeps(sheet, { allowSheet: true, wireReader: false }));
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, 'a refusal, not a crash');
  assert.ok(!(err instanceof TypeError), 'a TypeError from inside a live security guard is NOT a refusal');
  assert.match(err.message, /automation: secret-sheet/);
});

test('sheet gate (AC2): a null current menu refuses at EVERY tier, regardless of allowSheet', () => {
  const sheet = makeGuestWc(63);
  // sheetMenuFor returns null when no menu is open OR the sheet is hidden — one answer, one refusal.
  for (const extra of [{}, { allowSheet: true }, { allowSheet: true, allowInternal: true }]) {
    assert.throws(
      () => resolveContents(63, sheetDeps(sheet, { menu: null, ...extra })),
      /automation: secret-sheet/,
      'null menu refuses with ' + JSON.stringify(extra)
    );
  }
});

test('sheet gate (AC1/AC2): a menu record with no menuType field refuses (no undefined slipping through the Set)', () => {
  const sheet = makeGuestWc(64);
  assert.throws(
    () => resolveContents(64, sheetDeps(sheet, { menu: { token: 4 }, allowSheet: true })),
    /automation: secret-sheet/
  );
});

test('sheet gate: the gate applies to the SHEET ONLY — an ordinary tab resolves with allowSheet set and no menu reader', () => {
  const tab = makeGuestWc(65);
  assert.equal(
    resolveContents(65, {
      fromId: (id) => (id === 65 ? tab : null),
      chromeContents: null,
      isSheetContents: () => false,
      allowSheet: true
    }),
    tab
  );
  assert.ok(
    SECOND_ADMITTED_MENU_TYPE,
    'the allowlist seeds at least two menuTypes (bookmarks-overflow + bookmark-edit)'
  );
});

test('resolveContents: valid chrome wcId → returns the webContents (classifyContents can then identify it)', () => {
  const chromeContents = {
    id: 1,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    }
  };
  const fromId = (id) => (id === 1 ? chromeContents : null);
  const result = resolveContents(1, { fromId, chromeContents });
  assert.equal(result, chromeContents);
  // Verify classifier identifies it correctly
  assert.equal(classifyContents(result, chromeContents), 'chrome');
});

test('resolveContents: internal-session wcId (direct supply) → throws internal-session (DD5 bypass-path guard)', () => {
  // This is the load-bearing security test: a directly-supplied internal-guest
  // wcId must be rejected at resolve-time, not merely filtered from enumerate.
  const internalWc = makeInternalWc(99);
  const fromId = (id) => (id === 99 ? internalWc : null);
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
  const fromId = (id) => (id === 55 ? destroyedWc : null);
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
  const fromId = (id) => (id === 99 ? internalWc : null);
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
  const fromId = (id) => (id === 99 ? internalWc : null);
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
    if (!sessions.has(partition))
      sessions.set(partition, { __partition: partition, __goldfinchInternal: partition === 'goldfinch-internal' });
    return sessions.get(partition);
  };
  return { sessionFor, fromPartition: (p) => sessionFor(p) };
}

function makeWcInPartition(id, partition, world) {
  return {
    id,
    session: world.sessionFor(partition),
    isDestroyed() {
      return false;
    }
  };
}

test('resolveContentsForJar: wc whose session === jar session → returns the wc', () => {
  const world = makeSessionWorld();
  const jar = { id: 'personal', partition: 'persist:container:personal' };
  const wc = makeWcInPartition(10, jar.partition, world);
  const deps = { fromId: (id) => (id === 10 ? wc : null), chromeContents: null, fromPartition: world.fromPartition };
  assert.equal(resolveContentsForJar(10, jar, deps), wc);
});

test('resolveContentsForJar: wc in a DIFFERENT jar session → throws out-of-jar', () => {
  const world = makeSessionWorld();
  const personal = { id: 'personal', partition: 'persist:container:personal' };
  // wc belongs to 'work' session, but we ask for 'personal'.
  const wc = makeWcInPartition(11, 'persist:container:work', world);
  const deps = { fromId: (id) => (id === 11 ? wc : null), chromeContents: null, fromPartition: world.fromPartition };
  assert.throws(
    () => resolveContentsForJar(11, personal, deps),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('resolveContentsForJar: burner session (matches no jar) → throws out-of-jar', () => {
  const world = makeSessionWorld();
  const personal = { id: 'personal', partition: 'persist:container:personal' };
  const wc = makeWcInPartition(12, 'burner:1', world);
  const deps = { fromId: (id) => (id === 12 ? wc : null), chromeContents: null, fromPartition: world.fromPartition };
  assert.throws(
    () => resolveContentsForJar(12, personal, deps),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('resolveContentsForJar: null jar → throws out-of-jar (a key bound to no jar drives nothing)', () => {
  const world = makeSessionWorld();
  const wc = makeWcInPartition(13, 'persist:container:personal', world);
  const deps = { fromId: (id) => (id === 13 ? wc : null), chromeContents: null, fromPartition: world.fromPartition };
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
  const internalDeps = {
    fromId: (id) => (id === 50 ? internalWc : null),
    chromeContents: null,
    fromPartition: world.fromPartition
  };
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
  const deps = { fromId: (id) => (id === 20 ? wc : null), chromeContents: null, fromPartition: world.fromPartition };
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
  const wc = {
    id: 42,
    session: sharedSession,
    isDestroyed() {
      return false;
    }
  };
  // chromeContents IS the same object — object identity match.
  const deps = {
    fromId: (id) => (id === 42 ? wc : null),
    chromeContents: wc,
    fromPartition: world.fromPartition
  };
  // Must throw out-of-jar with the chrome-renderer message — NOT pass through to the
  // session check (which would also refuse, but for the wrong reason).
  assert.throws(
    () => resolveContentsForJar(42, jar, deps),
    (err) =>
      err instanceof Error && err.message.includes('automation: out-of-jar') && err.message.includes('chrome renderer'),
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
    fromId: (id) => (id === 10 ? wc : null),
    chromeContents: null, // explicitly null
    fromPartition: world.fromPartition
  };
  // Should NOT throw — the null guard (!= null) prevents the guard from firing.
  assert.equal(resolveContentsForJar(10, jar, deps), wc);
});

test('resolveContentsForJar: undefined deps.chromeContents → guard is a no-op', () => {
  const world = makeSessionWorld();
  const jar = { id: 'personal', partition: 'persist:container:personal' };
  const wc = makeWcInPartition(11, jar.partition, world);
  const deps = {
    fromId: (id) => (id === 11 ? wc : null),
    // chromeContents absent (undefined)
    fromPartition: world.fromPartition
  };
  assert.equal(resolveContentsForJar(11, jar, deps), wc);
});

// ---------------------------------------------------------------------------
// resolveContents — isTabViewWcId non-tab-contents guard (M05 F8 DD8,
// defense-in-depth). Admin's SECOND relaxation: chrome-class overlay wcIds
// (the menu-overlay sheet, the find overlay) resolve only at the admin tier.
// ---------------------------------------------------------------------------

test('DD8 baseline: jar tier refuses a chrome-class non-tab wcId with OUT-OF-JAR (session identity) — not a widening being closed', () => {
  // The sheet is chrome-class (defaultSession-like session that matches no jar
  // partition), so resolveContentsForJar throws out-of-jar exactly as burner tabs
  // are refused — the resolver-level rule below is defense-in-depth on top.
  const world = makeSessionWorld();
  const jar = { id: 'personal', partition: 'persist:container:personal' };
  const sheetWc = makeWcInPartition(70, 'chrome-default', world); // matches no jar
  const deps = {
    fromId: (id) => (id === 70 ? sheetWc : null),
    chromeContents: null,
    fromPartition: world.fromPartition
  };
  assert.throws(
    () => resolveContentsForJar(70, jar, deps),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('DD8: with the predicate, a live non-tab non-chrome wcId throws non-tab-contents at the non-admin tier', () => {
  const chromeContents = makeGuestWc(1);
  const sheetWc = makeGuestWc(70); // chrome-class overlay: live, NOT internal, NOT chrome, NOT a tab view
  const deps = {
    fromId: (id) => (id === 70 ? sheetWc : id === 1 ? chromeContents : null),
    chromeContents,
    isTabViewWcId: (id) => id === 42 // 70 is not a tab view
  };
  assert.throws(
    () => resolveContents(70, deps),
    (err) => err instanceof Error && err.message.includes('automation: non-tab-contents')
  );
});

test('DD8: the predicate does NOT refuse tab views or the chrome contents', () => {
  const chromeContents = makeGuestWc(1);
  const tabWc = makeGuestWc(42);
  const deps = {
    fromId: (id) => (id === 42 ? tabWc : id === 1 ? chromeContents : null),
    chromeContents,
    isTabViewWcId: (id) => id === 42
  };
  assert.equal(resolveContents(42, deps), tabWc, 'tabViews member resolves');
  assert.equal(
    resolveContents(1, deps),
    chromeContents,
    'the chrome contents resolves (wc === chromeContents exemption)'
  );
});

test('DD8: admin (allowInternal:true) is UNAFFECTED — overlay wcIds resolve with the predicate present', () => {
  const chromeContents = makeGuestWc(1);
  const sheetWc = makeGuestWc(70);
  const deps = {
    fromId: (id) => (id === 70 ? sheetWc : null),
    chromeContents,
    allowInternal: true,
    isTabViewWcId: () => false
  };
  assert.equal(resolveContents(70, deps), sheetWc, 'admin tier drives the sheet by probed wcId (F7 precedent)');
});

test('DD8: ABSENT predicate = no behavior change (legacy callers / offline tests)', () => {
  const chromeContents = makeGuestWc(1);
  const sheetWc = makeGuestWc(70);
  const deps = {
    fromId: (id) => (id === 70 ? sheetWc : null),
    chromeContents
    // no isTabViewWcId
  };
  assert.equal(resolveContents(70, deps), sheetWc);
});

test('DD8: internal-session still throws FIRST (guard order — internal check precedes non-tab-contents)', () => {
  const internalWc = makeInternalWc(99);
  const deps = {
    fromId: (id) => (id === 99 ? internalWc : null),
    chromeContents: null,
    isTabViewWcId: () => false
  };
  assert.throws(
    () => resolveContents(99, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('resolveContents: error messages are distinguishable per guard', () => {
  // Pins AC4: three distinct prefixes so callers can identify which guard fired.
  const internalWc = makeInternalWc(1);
  const guestWc = makeGuestWc(2);

  let badHandleMsg, noSuchMsg, internalSessionMsg;

  try {
    // @ts-expect-error — intentionally passing wrong type
    resolveContents('x', { fromId: () => null, chromeContents: null });
  } catch (e) {
    badHandleMsg = e.message;
  }

  try {
    resolveContents(2, { fromId: () => null, chromeContents: null });
  } catch (e) {
    noSuchMsg = e.message;
  }

  try {
    resolveContents(1, { fromId: (id) => (id === 1 ? internalWc : null), chromeContents: guestWc });
  } catch (e) {
    internalSessionMsg = e.message;
  }

  assert.ok(badHandleMsg.includes('bad-handle'), 'bad-handle path must say bad-handle');
  assert.ok(noSuchMsg.includes('no-such-contents'), 'no-such path must say no-such-contents');
  assert.ok(internalSessionMsg.includes('internal-session'), 'internal path must say internal-session');

  // All three must be distinct messages
  assert.notEqual(badHandleMsg, noSuchMsg);
  assert.notEqual(noSuchMsg, internalSessionMsg);
  assert.notEqual(badHandleMsg, internalSessionMsg);
});

// ---------------------------------------------------------------------------
// M14 F2 L2 (DD1a) — isPopupWcId widening: popup-registry members are exempt
// from the non-tab-contents refusal; EVERYTHING else (session-identity jar
// membership, internal exclusion, secret-sheet refusal) is untouched.
// ---------------------------------------------------------------------------

test('popup widening: isPopupWcId exempts a popup wcId from non-tab-contents at the non-admin tier', () => {
  const chromeContents = makeGuestWc(1);
  const popupWc = makeGuestWc(701); // live, NOT internal, NOT chrome, NOT a tab view
  const deps = {
    fromId: (id) => (id === 701 ? popupWc : id === 1 ? chromeContents : null),
    chromeContents,
    isTabViewWcId: (id) => id === 42, // 701 is not a tab view…
    isPopupWcId: (id) => id === 701 // …but IS a popup — resolves
  };
  assert.equal(resolveContents(701, deps), popupWc, 'popup wcId resolves at the jar-capable tier');
});

test('popup widening: a wcId that is NEITHER tab NOR popup still throws non-tab-contents with both predicates present', () => {
  const chromeContents = makeGuestWc(1);
  const sheetWc = makeGuestWc(70);
  const deps = {
    fromId: (id) => (id === 70 ? sheetWc : null),
    chromeContents,
    isTabViewWcId: (id) => id === 42,
    isPopupWcId: (id) => id === 701
  };
  assert.throws(
    () => resolveContents(70, deps),
    (err) => err instanceof Error && err.message.includes('automation: non-tab-contents'),
    'the overlay refusal survives the widening'
  );
});

test('popup widening: jar membership rides the EXISTING session-identity check — own-jar popup resolves, foreign-jar popup refuses out-of-jar', () => {
  const world = makeSessionWorld();
  const personal = { id: 'personal', partition: 'persist:container:personal' };
  // The popup session IS the interned opener-jar session (spike-verified) —
  // exactly like a tab in that jar.
  const ownPopup = makeWcInPartition(701, personal.partition, world);
  const foreignPopup = makeWcInPartition(702, 'persist:container:work', world);
  const fromId = (id) => (id === 701 ? ownPopup : id === 702 ? foreignPopup : null);
  const deps = { fromId, chromeContents: null, fromPartition: world.fromPartition };
  assert.equal(resolveContentsForJar(701, personal, deps), ownPopup, 'own-jar popup drivable by the jar key');
  assert.throws(
    () => resolveContentsForJar(702, personal, deps),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar'),
    'foreign-jar popup refused on session identity — no partition strings involved'
  );
});

// RE-TARGETED, NOT DELETED (M15 F3 L1 AC12). The claim being pinned is unchanged — the popup
// widening cannot admit the sheet — but the sheet's own gate is no longer absolute, so the
// pin now also asserts that only the SHEET GATE decides: a lying isPopupWcId admits nothing
// under a non-allowlisted menuType, and it is not what admits the allowlisted one either.
test('popup widening: the secret-sheet gate is UNAFFECTED — isPopupWcId can never admit the sheet (guard order)', () => {
  const sheet = makeGuestWc(50);
  const deps = {
    fromId: (id) => (id === 50 ? sheet : null),
    chromeContents: null,
    isSheetContents: (wc) => wc === sheet,
    isTabViewWcId: () => false,
    isPopupWcId: () => true // even a (hypothetically) lying predicate
  };
  assert.throws(() => resolveContents(50, deps), /automation: secret-sheet/);
  // Still refused with the op opt-in when the menuType is not allowlisted — guard 3 runs
  // BEFORE the popup-widened guard 5, so the popup predicate never gets a say.
  assert.throws(
    () =>
      resolveContents(50, {
        ...deps,
        allowSheet: true,
        sheetMenuFor: () => ({ menuType: SECRET_MENU_TYPE, token: 1 })
      }),
    /automation: secret-sheet/
  );
  // And when the sheet IS admitted, it is the sheet gate that admitted it — guard 5 is
  // reached and satisfied by the popup predicate, so this asserts guard ORDER, not luck.
  assert.equal(
    resolveContents(50, {
      ...deps,
      allowSheet: true,
      sheetMenuFor: () => ({ menuType: ADMITTED_MENU_TYPE, token: 1 })
    }),
    sheet
  );
});

test('popup widening: internal-session still throws before the widened guard (a popup is never internal by DD3, pinned anyway)', () => {
  const internalWc = makeInternalWc(99);
  const deps = {
    fromId: (id) => (id === 99 ? internalWc : null),
    chromeContents: null,
    isTabViewWcId: () => false,
    isPopupWcId: (id) => id === 99
  };
  assert.throws(
    () => resolveContents(99, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('DD7 source-scan pin: no partition-string comparison in resolve.js or tabs.js (membership is session identity; census jarId maps main-side)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const rel of [
    ['src', 'main', 'automation', 'resolve.js'],
    ['src', 'main', 'automation', 'tabs.js']
  ]) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', ...rel), 'utf8');
    assert.equal(
      /partition\s*[!=]==?\s*|[!=]==?\s*[\w.]*partition\b/.test(src),
      false,
      rel.join('/') + ' must never compare partition strings (DD7 discipline)'
    );
  }
});
