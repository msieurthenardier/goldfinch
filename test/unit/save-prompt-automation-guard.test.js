'use strict';

// Sortie 06 Leg 1 (AC25, DD10): the corner save prompt is fail-closed to automation at EVERY tier.
//
// UNIT-PROVEN ONLY. No live MCP op can obtain the prompt's wcId - the census deliberately omits
// it - so this guard is defense in depth and is NOT claimed as live-verified (flight log).
//
// engine.js require()s electron at module scope; as automation-sheet-gate.test.js does, install a
// minimal electron double in Module._cache first (node --test isolates each file's process).

const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROMPT_WCID = 910;
const TAB_WCID = 911;

/** @type {any} */
let promptWc = null;
/** @type {any} */
let tabWc = null;

const electronResolved = require.resolve('electron');
Module._cache[electronResolved] = {
  id: electronResolved,
  filename: electronResolved,
  loaded: true,
  exports: {
    webContents: { fromId: (id) => (id === PROMPT_WCID ? promptWc : id === TAB_WCID ? tabWc : null) },
    session: { fromPartition: () => null }
  },
  parent: null,
  children: [],
  paths: []
};

const { createEngine } = require('../../src/main/automation/engine');
const { WCID_FIRST_OPS } = require('../../src/main/automation/scope');
const { resolveContents } = require('../../src/main/automation/resolve');
const { createWindowRegistry } = require('../../src/main/window-registry');
const { maskComments } = require('../helpers/source-scan');

function fakeWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed: () => false,
    async capturePage() {
      return { toPNG: () => Buffer.from('PNG') };
    },
    async executeJavaScript() {
      return { url: 'file://prompt', title: '', html: '<html></html>' };
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
    getZoomFactor: () => 1,
    sendInputEvent() {},
    async printToPDF() {
      return Buffer.from('PDF');
    },
    findInPage: () => 1,
    stopFindInPage() {},
    openDevTools() {},
    closeDevTools() {},
    isDevToolsOpened: () => false,
    focus() {}
  };
}

const VALID_ARGS = {
  closeTab: [],
  activateTab: [],
  navigate: ['https://example.test/'],
  goBack: [],
  goForward: [],
  reload: [],
  click: [10, 10],
  typeText: ['hello'],
  scroll: [10, 10, 0, 100],
  pressKey: ['Enter'],
  captureScreenshot: [],
  readDom: [],
  readAxTree: [],
  evaluate: ['1'],
  injectScript: ['void 0'],
  openDevTools: [],
  closeDevTools: [],
  getZoom: [],
  setZoom: [1.5],
  printToPDF: [],
  findInPage: ['needle'],
  stopFindInPage: [],
  dragPointer: [
    { x: 1, y: 1 },
    { x: 20, y: 20 }
  ]
};

const isSavePromptContents = (wc) => wc === promptWc;

test('AC25: the valid-args table covers WCID_FIRST_OPS exactly (an op added later must be classified)', () => {
  assert.deepEqual(Object.keys(VALID_ARGS).sort(), [...WCID_FIRST_OPS].sort());
});

test('AC25: resolveContents refuses the prompt with `save-prompt` at jar-equivalent, admin and admin+allowSheet - BEFORE the internal / non-tab checks', () => {
  promptWc = fakeWc(PROMPT_WCID);
  const fromId = (id) => (id === PROMPT_WCID ? promptWc : null);
  const base = { fromId, isSavePromptContents };
  for (const opts of [
    {}, // jar-equivalent
    { allowInternal: true }, // admin
    { allowInternal: true, allowSheet: true }, // admin + the op opted in to the sheet
    {
      allowInternal: true,
      allowSheet: true,
      isSheetContents: () => true,
      sheetMenuFor: () => ({ menuType: 'site-info', token: 1 })
    }
  ]) {
    assert.throws(
      () => resolveContents(PROMPT_WCID, { ...base, ...opts }),
      /automation: save-prompt — wcId 910 is the chrome-owned save prompt and is never automatable \(any tier\)/,
      JSON.stringify(Object.keys(opts))
    );
  }
});

test('AC25: it fires BEFORE the sheet guard (guard order) - a prompt that is ALSO reported as sheet contents still says save-prompt', () => {
  promptWc = fakeWc(PROMPT_WCID);
  assert.throws(
    () =>
      resolveContents(PROMPT_WCID, {
        fromId: () => promptWc,
        allowInternal: true,
        isSavePromptContents,
        isSheetContents: () => true
      }),
    /automation: save-prompt/
  );
});

test('AC25: every wcId-first op dispatch refuses the prompt at admin and admin+allowSheet-opting ops (engine level)', async () => {
  promptWc = fakeWc(PROMPT_WCID);
  const engine = createEngine(() => null, { allowInternal: true, isSavePromptContents });
  const refused = [];
  for (const op of WCID_FIRST_OPS) {
    await assert.rejects(
      Promise.resolve().then(() => engine[op](PROMPT_WCID, ...VALID_ARGS[op])),
      /automation: save-prompt/,
      op + ' must be refused on the prompt'
    );
    refused.push(op);
  }
  // the three allowSheet ops included
  for (const op of ['captureScreenshot', 'readDom', 'readAxTree']) assert.ok(refused.includes(op));
  assert.ok(refused.length >= 20, 'the sweep is not vacuous');
});

test('AC25: a jar-tier engine (no allowInternal) refuses the prompt too, and a NORMAL tab is unaffected by the predicate', async () => {
  promptWc = fakeWc(PROMPT_WCID);
  tabWc = fakeWc(TAB_WCID);
  const engine = createEngine(() => null, { isSavePromptContents, isTabViewWcId: (id) => id === TAB_WCID });
  await assert.rejects(
    Promise.resolve().then(() => engine.readDom(PROMPT_WCID)),
    /automation: save-prompt/
  );
  // a real tab is not the prompt: it must NOT trip the save-prompt guard
  let err = null;
  try {
    await engine.getZoom(TAB_WCID);
  } catch (e) {
    err = e;
  }
  if (err) assert.doesNotMatch(String(err.message), /save-prompt/);
});

test('AC25: with the predicate ABSENT the guard cannot fire - which is exactly why both createEngine sites are grep-pinned below', () => {
  promptWc = fakeWc(PROMPT_WCID);
  // at admin an absent injection falls through to a normal chrome-class resolve (documented gap)
  assert.equal(resolveContents(PROMPT_WCID, { fromId: () => promptWc, allowInternal: true }), promptWc);
});

// ---- registry predicate -------------------------------------------------------------------

test("AC25: window-registry.isSavePromptContents is true for any window's LIVE prompt view, false otherwise", () => {
  const registry = createWindowRegistry();
  const a = registry.create({ win: { id: 1 }, chromeView: { webContents: {} } });
  const b = registry.create({ win: { id: 2 }, chromeView: { webContents: {} } });
  const wcA = { id: 1, isDestroyed: () => false };
  const wcB = { id: 2, isDestroyed: () => false };
  assert.equal(registry.isSavePromptContents(wcA), false, 'none exists yet');
  a.savePrompt = { getView: () => ({ webContents: wcA }) };
  b.savePrompt = { getView: () => ({ webContents: wcB }) };
  assert.equal(registry.isSavePromptContents(wcA), true);
  assert.equal(registry.isSavePromptContents(wcB), true);
  assert.equal(registry.isSavePromptContents({ id: 3, isDestroyed: () => false }), false);
  b.savePrompt = { getView: () => null };
  assert.equal(registry.isSavePromptContents(wcB), false, 'a never-shown view is not contents');
  a.savePrompt = null;
  assert.equal(registry.isSavePromptContents(wcA), false);
  a.savePrompt = { getView: () => ({ webContents: { ...wcA, isDestroyed: () => true } }) };
  assert.equal(registry.isSavePromptContents(wcA), false, 'a destroyed webContents is not contents');
});

// ---- grep pins ----------------------------------------------------------------------------

const MAIN = maskComments(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8'));

test('AC25 grep pin: main.js injects isSavePromptContents at BOTH the createEngine site and the scopeCtx site', () => {
  const hits = MAIN.match(/isSavePromptContents:\s*\(wc\)\s*=>\s*registry\.isSavePromptContents\(wc\)/g) || [];
  assert.equal(hits.length, 2, 'engine site + scopeCtx (vault path) site');
  // and it sits next to isSheetContents at each
  const pairs = MAIN.match(/isSheetContents:[^\n]*\n[\s\S]{0,200}?isSavePromptContents:/g) || [];
  assert.ok(pairs.length >= 1);
});

test('AC25 grep pin: captureWindow composites ONLY the find and sheet layers - the prompt is never a layer', () => {
  const start = MAIN.indexOf('const layers = []');
  assert.notEqual(start, -1, 'vacuity guard: the layer list must exist');
  // the layer-building region: from the layer list to the sheet layer block's end
  const region = MAIN.slice(start, MAIN.indexOf('sheet overlay layer', start) + 4000);
  assert.ok(/findOverlay/.test(region) && /grabRec\.sheet/.test(region), 'find + sheet layers present');
  assert.equal(/savePrompt/.test(region), false, 'no save-prompt layer in the captureWindow composite');
});

test('AC25: the engine threads isSavePromptContents via the conditional-spread idiom (absent -> key absent)', () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'automation', 'engine.js'), 'utf8');
  assert.match(engine, /typeof isSavePromptContents === 'function' \? \{ isSavePromptContents \} : \{\}/);
});
