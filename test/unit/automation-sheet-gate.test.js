'use strict';

// M15 Flight 3 Leg 1 — the menu-overlay sheet's (menuType × op) automation gate.
//
// This file carries the parts of the gate that live ABOVE resolve.js (which is covered by
// automation-resolve.test.js):
//
//   AC3 — the OP allowlist, swept over EVERY member of scope.js's WCID_FIRST_OPS. Exactly
//         three dispatch entries in engine.js pass `allowSheet`; every other wcId-first op —
//         including any op added after this leg — must throw `secret-sheet` against a sheet
//         wcId even at the admin tier under an ALLOWLISTED menuType (the most permissive
//         conditions the gate ever presents).
//   AC4 — the jar tier, asserted AT THE LAYER IT OCCURS. Through scopeEngine's façade a sheet
//         wcId throws `out-of-jar` (session identity); against a jar-tier ENGINE directly it
//         throws `non-tab-contents`. Neither is described as the other, and the engine-level
//         assertion deliberately uses an ADMITTED op — a non-admitted one would throw
//         `secret-sheet` at guard 3 and pass for the wrong reason.
//   AC5 — the post-await re-check in all three admitted ops (observe.js).
//
// engine.js require()s electron at module scope, so — exactly as automation-engine.test.js
// does — a minimal local electron double is installed in Module._cache first. node --test
// isolates each test file in its own process, so this cache write cannot leak.

const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SHEET_WCID = 900;

/** @type {any} */
let sheetWc = null;

const electronResolved = require.resolve('electron');
Module._cache[electronResolved] = {
  id: electronResolved,
  filename: electronResolved,
  loaded: true,
  exports: {
    webContents: { fromId: (/** @type {number} */ id) => (id === SHEET_WCID ? sheetWc : null) },
    session: { fromPartition: () => null }
  },
  parent: null,
  children: [],
  paths: []
};

const { createEngine } = require('../../src/main/automation/engine');
const { scopeEngine, WCID_FIRST_OPS } = require('../../src/main/automation/scope');
const { AUTOMATABLE_MENU_TYPES } = require('../../src/main/automation/resolve');
const { captureScreenshot, readDom, readAxTree } = require('../../src/main/automation/observe');

// Imported, never retyped (AC1's discipline, applied here too).
const ADMITTED_MENU_TYPE = [...AUTOMATABLE_MENU_TYPES][0];

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeSheetWc(id = SHEET_WCID) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    async capturePage() {
      return { toPNG: () => Buffer.from('PNG') };
    },
    async executeJavaScript() {
      return { url: 'file://sheet', title: '', html: '<html></html>' };
    },
    debugger: {
      attach() {},
      detach() {},
      async sendCommand() {
        return { nodes: [] };
      }
    },
    loadURL() {},
    goBack() {},
    goForward() {},
    reload() {},
    setZoomFactor() {},
    getZoomFactor() {
      return 1;
    },
    sendInputEvent() {},
    async printToPDF() {
      return Buffer.from('PDF');
    },
    findInPage() {
      return 1;
    },
    stopFindInPage() {},
    openDevTools() {},
    closeDevTools() {},
    isDevToolsOpened() {
      return false;
    },
    focus() {}
  };
}

// ---------------------------------------------------------------------------
// AC3 — the op allowlist, swept over every WCID_FIRST_OPS member.
//
// VALID ARGS MATTER. Several ops validate their arguments BEFORE resolving
// (nav.navigate's isSafeTabUrl, zoom.setZoom's factor check, input.pressKey via keyEvents,
// input.dragPointer via dragEvents dereferencing from.x/to.x). Fed junk they would throw
// their own validation error and be silently counted as "refused" for the wrong reason.
// ---------------------------------------------------------------------------

/** Per-op valid argument lists (the wcId is prepended by the sweep). */
const VALID_ARGS = {
  closeTab: [],
  activateTab: [],
  navigate: ['https://example.test/'], // pre-resolve isSafeTabUrl check
  goBack: [],
  goForward: [],
  reload: [],
  click: [10, 10],
  typeText: ['hello'],
  scroll: [10, 10, 0, 100],
  pressKey: ['Enter'], // pre-resolve keyEvents/normalizeModifier throw
  captureScreenshot: [],
  readDom: [],
  readAxTree: [],
  evaluate: ['1'],
  injectScript: ['void 0'],
  openDevTools: [],
  closeDevTools: [],
  getZoom: [],
  setZoom: [1.5], // pre-resolve factor validation
  printToPDF: [],
  findInPage: ['needle'],
  stopFindInPage: [],
  dragPointer: [
    { x: 1, y: 1 },
    { x: 20, y: 20 }
  ] // pre-resolve dragEvents dereference
};

// The three dispatch entries in engine.js that pass `deps({ allowSheet: true })`.
const ADMITTED_OPS = ['captureScreenshot', 'readDom', 'readAxTree'];

test('AC3: the valid-args table covers WCID_FIRST_OPS EXACTLY — an op added later fails loudly here', () => {
  const table = Object.keys(VALID_ARGS).sort();
  const ops = [...WCID_FIRST_OPS].sort();
  assert.deepEqual(
    table,
    ops,
    'every wcId-first op needs an entry with args valid enough to REACH resolveContents; ' +
      'this assertion is the whole point of the sweep — a new op must be classified, not skipped'
  );
  for (const op of ADMITTED_OPS) {
    assert.ok(WCID_FIRST_OPS.includes(op), op + ' must be a wcId-first op');
  }
});

test('AC3: every NON-admitted wcId-first op throws secret-sheet against the sheet — admin tier, allowlisted menuType', async () => {
  sheetWc = makeSheetWc();
  const engine = createEngine(() => null, {
    // The most permissive conditions the gate ever presents: admin (both relaxations lifted)
    // AND the sheet is showing an allowlisted menu. Anything refused here is refused by the
    // OP half of the gate and nothing else.
    allowInternal: true,
    isSheetContents: (wc) => wc === sheetWc,
    sheetMenuFor: (wc) => (wc === sheetWc ? { menuType: ADMITTED_MENU_TYPE, token: 11 } : null)
  });

  const refused = [];
  for (const op of WCID_FIRST_OPS) {
    if (ADMITTED_OPS.includes(op)) continue;
    // Throw shapes are MIXED — goBack/goForward/reload/getZoom/setZoom/sendInput throw
    // SYNCHRONOUSLY while the input/observe/tabs ops reject. Normalizing through
    // Promise.resolve().then(...) means a synchronous thrower is not silently passed over
    // by an assert.rejects-only sweep.
    await assert.rejects(
      Promise.resolve().then(() => engine[op](SHEET_WCID, ...VALID_ARGS[op])),
      /automation: secret-sheet/,
      op + ' must be refused on the sheet — it did not opt in with allowSheet'
    );
    refused.push(op);
  }
  assert.equal(refused.length, WCID_FIRST_OPS.length - ADMITTED_OPS.length);
  assert.ok(refused.length >= 20, 'the sweep is not vacuous');
});

test('AC3: EXACTLY the three admitted ops are not refused by the sheet gate', async () => {
  sheetWc = makeSheetWc();
  const engine = createEngine(() => null, {
    allowInternal: true,
    isSheetContents: (wc) => wc === sheetWc,
    sheetMenuFor: (wc) => (wc === sheetWc ? { menuType: ADMITTED_MENU_TYPE, token: 11 } : null)
  });
  for (const op of ADMITTED_OPS) {
    let err = null;
    try {
      await engine[op](SHEET_WCID, ...VALID_ARGS[op]);
    } catch (e) {
      err = e;
    }
    // They may still fail for unrelated reasons in this fixture (captureScreenshot's
    // foreground-to-act needs a chrome), but never with the sheet refusal.
    if (err) {
      assert.doesNotMatch(
        String(err.message),
        /automation: secret-sheet/,
        op + ' opted in with allowSheet and must not be refused by guard 3'
      );
    }
  }
});

test('AC3: the three admitted ops are refused again the moment the menuType leaves the allowlist', async () => {
  sheetWc = makeSheetWc();
  const engine = createEngine(() => null, {
    allowInternal: true,
    isSheetContents: (wc) => wc === sheetWc,
    sheetMenuFor: () => ({ menuType: 'vault-unlock', token: 11 })
  });
  for (const op of ADMITTED_OPS) {
    await assert.rejects(
      Promise.resolve().then(() => engine[op](SHEET_WCID, ...VALID_ARGS[op])),
      /automation: secret-sheet/,
      op + ' is admitted by the OP half only — the menuType half must still pass'
    );
  }
});

// ---------------------------------------------------------------------------
// AC4 — the jar tier, at the layer each refusal actually occurs.
// ---------------------------------------------------------------------------

test('AC4 (façade layer): a sheet wcId through scopeEngine throws out-of-jar — SESSION IDENTITY, not the sheet guard', async () => {
  // scope.js's memberDeps() threads NEITHER isSheetContents NOR isTabViewWcId, so inside
  // resolveContentsForJar guards 3 and 5 are BOTH no-ops. The refusal a jar key actually
  // gets is the session-identity compare. This is the correction the leg's cycle-1 review
  // made, and it is why this leg widens the ADMIN TIER ONLY.
  const jarSession = { __partition: 'persist:container:personal' };
  const sheetSession = { __goldfinchInternal: false };
  const sheet = {
    id: SHEET_WCID,
    session: sheetSession,
    isDestroyed() {
      return false;
    }
  };

  const facade = scopeEngine({ readDom: async () => ({ html: 'SHOULD NEVER BE REACHED' }) }, 'personal', {
    jars: { list: () => [{ id: 'personal', partition: 'persist:container:personal' }] },
    fromId: (id) => (id === SHEET_WCID ? sheet : null),
    fromPartition: () => jarSession,
    getChromeContents: () => null
  });

  await assert.rejects(
    Promise.resolve().then(() => facade.readDom(SHEET_WCID)),
    /automation: out-of-jar/,
    'the façade refuses on session identity — NOT secret-sheet and NOT non-tab-contents'
  );
});

test('AC4 (engine layer): readDom on a sheet wcId against a JAR-TIER engine throws non-tab-contents', async () => {
  // readDom is used DELIBERATELY: it is an ADMITTED op, so guard 3 lets it through under an
  // allowlisted menuType and the refusal that fires is guard 5's. A non-admitted op would
  // throw secret-sheet at guard 3 and pass this test for entirely the wrong reason.
  sheetWc = makeSheetWc();
  const jarEngine = createEngine(() => null, {
    // No allowInternal — this is the jar tier. Guard 5 is live.
    isTabViewWcId: () => false,
    isSheetContents: (wc) => wc === sheetWc,
    sheetMenuFor: () => ({ menuType: ADMITTED_MENU_TYPE, token: 11 })
  });
  await assert.rejects(
    Promise.resolve().then(() => jarEngine.readDom(SHEET_WCID)),
    /automation: non-tab-contents/,
    'guard 3 admitted it; guard 5 (not lifted without allowInternal) is what refuses'
  );
});

// ---------------------------------------------------------------------------
// AC5 — the {menuType, token} snapshot and the post-await re-check, in all three
// admitted ops. Exercised against observe.js directly with fakes.
// ---------------------------------------------------------------------------

/**
 * A deps bag whose sheetMenuFor answers from a mutable cell, so a test can change the
 * "current menu" mid-op exactly as a model-replace would.
 * @param {any} wc
 * @param {{ menu: any }} cell
 */
function observeDeps(wc, cell, extra = {}) {
  return {
    fromId: (/** @type {number} */ id) => (id === wc.id ? wc : null),
    chromeContents: null,
    allowInternal: true,
    allowSheet: true,
    isSheetContents: (/** @type {any} */ c) => c === wc,
    sheetMenuFor: (/** @type {any} */ c) => (c === wc ? cell.menu : null),
    ...extra
  };
}

test('AC5 (captureScreenshot): a menu model-replaced mid-capture DISCARDS the pixels', async () => {
  const cell = { menu: { menuType: ADMITTED_MENU_TYPE, token: 1 } };
  const wc = {
    id: 71,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    async capturePage() {
      cell.menu = { menuType: 'vault-unlock', token: 2 }; // model-replace mid-paint
      return { toPNG: () => Buffer.from('PNG') };
    }
  };
  await assert.rejects(
    captureScreenshot(71, observeDeps(wc, cell), { waitForPaint: async () => {} }),
    /automation: sheet-menu-changed/
  );
});

test('AC5 (captureScreenshot): null → null does NOT throw — an ordinary tab is unaffected by a menu opening elsewhere', async () => {
  const wc = {
    id: 72,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    async capturePage() {
      return { toPNG: () => Buffer.from('PNG') };
    }
  };
  // sheetMenuFor answers null for this wc both times, even though a menu is "open" somewhere.
  const deps = {
    fromId: (/** @type {number} */ id) => (id === 72 ? wc : null),
    chromeContents: null,
    allowSheet: true,
    sheetMenuFor: () => null
  };
  const b64 = await captureScreenshot(72, deps, { waitForPaint: async () => {} });
  assert.equal(b64, Buffer.from('PNG').toString('base64'));
});

test('AC5 (readDom): a menu change across the executeJavaScript round trip DISCARDS the snapshot', async () => {
  const cell = { menu: { menuType: ADMITTED_MENU_TYPE, token: 1 } };
  const wc = {
    id: 73,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    async executeJavaScript() {
      // The round trip is main→renderer→main: what comes back is whatever the renderer had
      // rendered when the snippet ran, not what main believed at resolve time.
      cell.menu = { menuType: 'vault-recovery-show', token: 2 };
      return { url: 'x', title: 'y', html: '<html>SECRET</html>' };
    }
  };
  await assert.rejects(readDom(73, observeDeps(wc, cell)), /automation: sheet-menu-changed/);
});

test('AC5 (readDom): an unchanged menu returns the snapshot normally', async () => {
  const cell = { menu: { menuType: ADMITTED_MENU_TYPE, token: 1 } };
  const wc = {
    id: 74,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    async executeJavaScript() {
      return { url: 'x', title: 'y', html: '<html>ok</html>' };
    }
  };
  const out = await readDom(74, observeDeps(wc, cell));
  assert.equal(out.html, '<html>ok</html>');
});

test('AC5: a close-and-REOPEN of the SAME allowlisted menu also throws — token is compared, deliberately', async () => {
  const cell = { menu: { menuType: ADMITTED_MENU_TYPE, token: 1 } };
  const wc = {
    id: 75,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    async executeJavaScript() {
      cell.menu = { menuType: ADMITTED_MENU_TYPE, token: 2 }; // same menuType, NEW session
      return { url: 'x', title: 'y', html: '<html/>' };
    }
  };
  await assert.rejects(readDom(75, observeDeps(wc, cell)), /automation: sheet-menu-changed/);
});

test('AC5 (readAxTree): a menu change across the debugger session DISCARDS the tree', async () => {
  const cell = { menu: { menuType: ADMITTED_MENU_TYPE, token: 1 } };
  const wc = {
    id: 76,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    debugger: {
      attach() {},
      detach() {},
      async sendCommand(/** @type {string} */ cmd) {
        if (cmd === 'Accessibility.getFullAXTree') {
          cell.menu = { menuType: 'vault-adminkey-show', token: 2 };
          return { nodes: [{ nodeId: '1' }] };
        }
        return {};
      }
    }
  };
  await assert.rejects(readAxTree(76, observeDeps(wc, cell)), /automation: sheet-menu-changed/);
});

test('AC5 (readAxTree): the re-check applies UNCONDITIONALLY, including on the debugger-unavailable early return', async () => {
  const cell = { menu: { menuType: ADMITTED_MENU_TYPE, token: 1 } };
  const wc = {
    id: 77,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    debugger: {
      attach() {
        cell.menu = { menuType: 'vault-unlock', token: 2 };
        throw new Error('another client is attached'); // → { automation: 'debugger-unavailable' }
      },
      detach() {},
      async sendCommand() {
        return {};
      }
    }
  };
  await assert.rejects(readAxTree(77, observeDeps(wc, cell)), /automation: sheet-menu-changed/);
});

test('AC5 (readAxTree): an unchanged menu returns the node array normally', async () => {
  const cell = { menu: { menuType: ADMITTED_MENU_TYPE, token: 1 } };
  const wc = {
    id: 78,
    session: { __goldfinchInternal: false },
    isDestroyed() {
      return false;
    },
    debugger: {
      attach() {},
      detach() {},
      async sendCommand(/** @type {string} */ cmd) {
        return cmd === 'Accessibility.getFullAXTree' ? { nodes: [{ nodeId: '1' }] } : {};
      }
    }
  };
  const nodes = await readAxTree(78, observeDeps(wc, cell));
  assert.deepEqual(nodes, [{ nodeId: '1' }]);
});
