'use strict';

// Unit tests for src/main/automation/mcp-tools.js — the SDK-free drive-tool
// registry adapter (Leg 2, drive-tools).
//
// SDK-free + Electron-free: mcp-tools.js imports nothing, so these tests run
// under plain `node --test` with a fake recording engine (no SDK, no Electron).
// They pin the discovery contract (18 drive tool names + schemas, no `call` leak),
// the named→positional dispatch mapping, DD6 success serialization, the
// openTab-null operational case, every throw→isError class, unknown-tool→isError,
// and the per-call getEngine discipline.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildToolRegistry } = require('../../src/main/automation/mcp-tools');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRIVE_NAMES = [
  'enumerateTabs', 'openTab', 'closeTab', 'activateTab', 'navigate',
  'goBack', 'goForward', 'reload', 'getZoom', 'setZoom', 'printToPDF',
  'findInPage', 'stopFindInPage',
  'click', 'typeText', 'scroll', 'pressKey', 'dragPointer',
];

const OBSERVE_NAMES = ['captureScreenshot', 'captureWindow', 'readDom', 'readAxTree'];

// Flight-9 eval ops — debugger-free executeJavaScript tools (evaluate / injectScript).
const EVAL_NAMES = ['evaluate', 'injectScript'];

// Flight-9 devtools ops — webContents.openDevTools/closeDevTools (NO CDP from the ops).
const DEVTOOLS_NAMES = ['openDevTools', 'closeDevTools'];

const ALL_NAMES = [...DRIVE_NAMES, ...OBSERVE_NAMES, ...EVAL_NAMES, ...DEVTOOLS_NAMES];

/**
 * Build a fake engine whose ops record their positional args and return a
 * configurable value (or throw a configured error). `returns` / `throws` are
 * keyed by op name.
 */
function makeFakeEngine({ returns = {}, throws = {} } = {}) {
  const calls = {};
  const engine = {};
  for (const name of ALL_NAMES) {
    calls[name] = [];
    engine[name] = (...args) => {
      calls[name].push(args);
      if (Object.prototype.hasOwnProperty.call(throws, name)) {
        throw throws[name];
      }
      // undefined return models a genuinely-void op unless explicitly configured.
      return Object.prototype.hasOwnProperty.call(returns, name) ? returns[name] : undefined;
    };
  }
  return { engine, calls };
}

/** The text payload of a single-text-content result. */
function textOf(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// listTools — discovery contract
// ---------------------------------------------------------------------------

test('listTools returns exactly the 30 tools (18 drive + 4 observe + 2 eval + 2 devtools + 3 chrome/app-admin (getChromeTarget + enumerateWindows + downloadsList) + 1 history (getHistory)), named 1:1 with engine ops', () => {
  const { engine } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  const tools = reg.listTools();
  assert.equal(tools.length, 30);
  // M09 F7 DD2: enumerateWindows is the +1 — the window-topology discovery primitive.
  const allNames30 = [...ALL_NAMES, 'getChromeTarget', 'enumerateWindows', 'downloadsList', 'getHistory'];
  assert.deepEqual(tools.map((t) => t.name).sort(), [...allNames30].sort());
});

test('listTools exposes only { name, description, inputSchema } — no internal call fn leaks', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  for (const t of reg.listTools()) {
    assert.deepEqual(Object.keys(t).sort(), ['description', 'inputSchema', 'name']);
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.call, 'undefined');
  }
});

test('input schemas carry the correct required fields per the discovery contract', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  const req = (name) => byName.get(name).inputSchema.required || [];

  // enumerateTabs — no required input
  assert.deepEqual(req('enumerateTabs'), []);
  // openTab — url required
  assert.deepEqual(req('openTab'), ['url']);
  // single-wcId ops
  for (const name of ['closeTab', 'activateTab', 'goBack', 'goForward', 'reload']) {
    assert.deepEqual(req(name), ['wcId'], name);
  }
  // navigate — wcId + url
  assert.deepEqual(req('navigate'), ['wcId', 'url']);
  // getZoom — wcId only
  assert.deepEqual(req('getZoom'), ['wcId']);
  assert.equal(byName.get('getZoom').inputSchema.properties.wcId.type, 'integer');
  // setZoom — wcId + factor; factor is a number
  assert.deepEqual(req('setZoom'), ['wcId', 'factor']);
  assert.equal(byName.get('setZoom').inputSchema.properties.factor.type, 'number');
  // typeText — wcId + text
  assert.deepEqual(req('typeText'), ['wcId', 'text']);
  // click — wcId, x, y required; button/clickCount optional (present in properties)
  assert.deepEqual(req('click'), ['wcId', 'x', 'y']);
  const clickProps = byName.get('click').inputSchema.properties;
  assert.equal(clickProps.wcId.type, 'integer');
  assert.equal(clickProps.x.type, 'number');
  assert.equal(clickProps.y.type, 'number');
  assert.deepEqual(clickProps.button.enum, ['left', 'right', 'middle']);
  assert.equal(clickProps.clickCount.type, 'integer');
  // scroll — wcId, x, y, dx, dy required; dx/dy are numbers
  assert.deepEqual(req('scroll'), ['wcId', 'x', 'y', 'dx', 'dy']);
  const scrollProps = byName.get('scroll').inputSchema.properties;
  assert.equal(scrollProps.dx.type, 'number');
  assert.equal(scrollProps.dy.type, 'number');
  // pressKey — wcId always required; the key arrives as `name` (preferred) or `key`
  // (alias), but "at least one of name/key" is enforced at RUNTIME in the tool
  // `call` — NOT via a top-level schema combinator (strict MCP consumers reject
  // those; #56/SC9). The schema therefore carries no top-level anyOf.
  const pressKeySchema = byName.get('pressKey').inputSchema;
  assert.deepEqual(req('pressKey'), ['wcId']);
  assert.equal(pressKeySchema.anyOf, undefined, 'pressKey must not declare a top-level anyOf (#56/SC9)');
  const pkProps = pressKeySchema.properties;
  assert.equal(pkProps.name.type, 'string');
  assert.equal(pkProps.key.type, 'string'); // alias property, same string type
  // modifiers — optional array of the canonical four (the clean public contract;
  // aliases are normalized defensively in keyEvents but not advertised here).
  assert.equal(pkProps.modifiers.type, 'array');
  assert.equal(pkProps.modifiers.items.type, 'string');
  assert.deepEqual(pkProps.modifiers.items.enum, ['control', 'shift', 'alt', 'meta']);
  // modifiers is optional — not in `required`.
  assert.ok(!req('pressKey').includes('modifiers'));
  // description enumerates the known keys (incl. ShiftTab) and documents the name|key alias
  const pkDesc = byName.get('pressKey').description;
  assert.match(pkDesc, /ShiftTab/);
  assert.match(pkDesc, /Tab, Enter, Escape/);
  assert.match(pkDesc, /\bname\b/);
  assert.match(pkDesc, /\bkey\b/);
  assert.match(pkDesc, /modifiers/); // chord usage documented
  // dragPointer (M09 F2 Leg 2) — wcId, from, to required; steps optional
  assert.deepEqual(req('dragPointer'), ['wcId', 'from', 'to']);
  const dragProps = byName.get('dragPointer').inputSchema.properties;
  assert.equal(dragProps.wcId.type, 'integer');
  assert.deepEqual(dragProps.from.required, ['x', 'y']);
  assert.deepEqual(dragProps.to.required, ['x', 'y']);
  assert.equal(dragProps.steps.type, 'integer');
  assert.equal(dragProps.stepDelayMs.type, 'integer');
  assert.ok(!req('dragPointer').includes('steps'), 'steps is optional');
  assert.ok(!req('dragPointer').includes('stepDelayMs'), 'stepDelayMs is optional');
});

// ---------------------------------------------------------------------------
// Flat-schema discovery invariant (DD4/SC8) — the zoom tools must carry NO
// top-level oneOf/allOf/anyOf. After #56/SC9, NO tool carries a top-level
// combinator (pressKey's former anyOf was flattened to a runtime guard).
// ---------------------------------------------------------------------------

test('getZoom/setZoom schemas are flat — no top-level oneOf/allOf/anyOf', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  for (const name of ['getZoom', 'setZoom']) {
    const schema = byName.get(name).inputSchema;
    assert.equal(schema.type, 'object', name);
    assert.equal(schema.anyOf, undefined, name + ' must not declare a top-level anyOf');
    assert.equal(schema.oneOf, undefined, name + ' must not declare a top-level oneOf');
    assert.equal(schema.allOf, undefined, name + ' must not declare a top-level allOf');
  }
  // No tool carries a top-level anyOf — pressKey's was flattened to a runtime guard (#56/SC9).
  const withAnyOf = reg.listTools().filter((t) => t.inputSchema.anyOf !== undefined).map((t) => t.name);
  assert.deepEqual(withAnyOf, []);
  // No tool declares a top-level oneOf or allOf.
  assert.deepEqual(reg.listTools().filter((t) => t.inputSchema.oneOf !== undefined).map((t) => t.name), []);
  assert.deepEqual(reg.listTools().filter((t) => t.inputSchema.allOf !== undefined).map((t) => t.name), []);
});

test('no tool inputSchema carries a top-level anyOf/oneOf/allOf/not (SC9 hygiene — count-agnostic)', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const offenders = [];
  for (const t of reg.listTools()) {
    for (const combinator of ['anyOf', 'oneOf', 'allOf', 'not']) {
      if (t.inputSchema[combinator] !== undefined) {
        offenders.push(t.name + '.' + combinator);
      }
    }
  }
  assert.deepEqual(offenders, [], 'strict MCP consumers reject top-level schema combinators (#56/SC9)');
});

// ---------------------------------------------------------------------------
// Dispatch — named → positional mapping
// ---------------------------------------------------------------------------

test('navigate maps named args → positional engine.navigate(wcId, url)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('navigate', { wcId: 7, url: 'https://example.com' });
  assert.deepEqual(calls.navigate[0], [7, 'https://example.com']);
});

test('click maps to engine.click(wcId, x, y, { button, clickCount })', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('click', { wcId: 7, x: 10, y: 20, button: 'left', clickCount: 1 });
  assert.deepEqual(calls.click[0], [7, 10, 20, { button: 'left', clickCount: 1 }]);
});

test('click without button/clickCount passes an opts object with undefined values (engine defaults apply)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('click', { wcId: 3, x: 1, y: 2 });
  assert.deepEqual(calls.click[0], [3, 1, 2, { button: undefined, clickCount: undefined }]);
});

test('getZoom maps named args → positional engine.getZoom(wcId)', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { getZoom: { factor: 1.25 } } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getZoom', { wcId: 7 });
  assert.deepEqual(calls.getZoom[0], [7]);
  assert.equal(textOf(result), JSON.stringify({ factor: 1.25 }));
});

test('setZoom maps named args → positional engine.setZoom(wcId, factor)', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { setZoom: { factor: 2.0 } } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('setZoom', { wcId: 7, factor: 2.0 });
  assert.deepEqual(calls.setZoom[0], [7, 2.0]);
  assert.equal(textOf(result), JSON.stringify({ factor: 2.0 }));
});

test('findInPage maps full named args → positional engine.findInPage(wcId, text, { forward, findNext, matchCase })', async () => {
  const match = { activeMatchOrdinal: 2, matches: 5 };
  const { engine, calls } = makeFakeEngine({ returns: { findInPage: match } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('findInPage', { wcId: 7, text: 'hello', forward: false, findNext: true, matchCase: true });
  assert.deepEqual(calls.findInPage[0], [7, 'hello', { forward: false, findNext: true, matchCase: true }]);
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), match);
});

test('findInPage minimal args (wcId + text only) threads undefined opts fields to engine', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { findInPage: { activeMatchOrdinal: 1, matches: 1 } } });
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('findInPage', { wcId: 3, text: 'word' });
  assert.deepEqual(calls.findInPage[0], [3, 'word', { forward: undefined, findNext: undefined, matchCase: undefined }]);
});

test('stopFindInPage maps { wcId } → engine.stopFindInPage(wcId), void → {"ok":true}', async () => {
  const { engine, calls } = makeFakeEngine(); // returns undefined → void op
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('stopFindInPage', { wcId: 7 });
  assert.deepEqual(calls.stopFindInPage[0], [7]);
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), '{"ok":true}');
});

test('scroll maps to engine.scroll(wcId, x, y, dx, dy)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('scroll', { wcId: 5, x: 1, y: 2, dx: 3, dy: 4 });
  assert.deepEqual(calls.scroll[0], [5, 1, 2, 3, 4]);
});

test('dragPointer maps to engine.dragPointer(wcId, from, to, { steps, stepDelayMs })', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('dragPointer', { wcId: 7, from: { x: 10, y: 20 }, to: { x: 100, y: 20 }, steps: 5, stepDelayMs: 2 });
  assert.deepEqual(calls.dragPointer[0], [7, { x: 10, y: 20 }, { x: 100, y: 20 }, { steps: 5, stepDelayMs: 2 }]);
});

test('dragPointer without steps/stepDelayMs passes an opts object with both undefined (engine defaults apply)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('dragPointer', { wcId: 7, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
  assert.deepEqual(calls.dragPointer[0], [7, { x: 0, y: 0 }, { x: 1, y: 1 }, { steps: undefined, stepDelayMs: undefined }]);
});

test('enumerateTabs invokes engine.enumerateTabs() with no args', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { enumerateTabs: [] } });
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('enumerateTabs', {});
  assert.deepEqual(calls.enumerateTabs[0], []);
});

test('single-wcId ops map to engine.op(wcId)', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { closeTab: true, activateTab: true } });
  const reg = buildToolRegistry(() => engine);
  for (const name of ['closeTab', 'activateTab', 'goBack', 'goForward', 'reload']) {
    await reg.callTool(name, { wcId: 42 });
    assert.deepEqual(calls[name][0], [42], name);
  }
});

test('openTab (no jarId) maps to engine.openTab(url, undefined); typeText to engine.typeText(wcId, text); pressKey to engine.pressKey(wcId, name)', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { openTab: 99 } });
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('openTab', { url: 'https://a.test' });
  // jarId is absent in the input → undefined forwarded as second arg (documents the contract)
  assert.deepEqual(calls.openTab[0], ['https://a.test', undefined]);
  await reg.callTool('typeText', { wcId: 1, text: 'hello' });
  assert.deepEqual(calls.typeText[0], [1, 'hello']);
  await reg.callTool('pressKey', { wcId: 1, name: 'ShiftTab' });
  // modifiers is forwarded as a third positional arg; absent → undefined (bare-key contract).
  assert.deepEqual(calls.pressKey[0], [1, 'ShiftTab', undefined]);
});

test('openTab forwards jarId to engine.openTab(url, jarId) when supplied', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { openTab: 77 } });
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('openTab', { url: 'https://b.test', jarId: 'personal' });
  assert.deepEqual(calls.openTab[0], ['https://b.test', 'personal']);
});

test('pressKey with { wcId, name } maps to engine.pressKey(wcId, name)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('pressKey', { wcId: 7, name: 'Enter' });
  assert.deepEqual(calls.pressKey[0], [7, 'Enter', undefined]);
});

test('pressKey with the { wcId, key } alias maps to engine.pressKey(wcId, key)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('pressKey', { wcId: 7, key: 'Enter' });
  assert.deepEqual(calls.pressKey[0], [7, 'Enter', undefined]);
});

test('pressKey prefers `name` over `key` when both are supplied', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('pressKey', { wcId: 7, name: 'Enter', key: 'Tab' });
  assert.deepEqual(calls.pressKey[0], [7, 'Enter', undefined]);
});

test('pressKey forwards modifiers (chord) to engine.pressKey(wcId, name, modifiers)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('pressKey', { wcId: 7, name: 'M', modifiers: ['control'] });
  assert.deepEqual(calls.pressKey[0], [7, 'M', ['control']]);
});

test('pressKey with neither name nor key → distinct isError, engine not called (#56/SC9)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('pressKey', { wcId: 1 });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), "automation: pressKey requires 'name' or 'key'");
  assert.equal(calls.pressKey.length, 0); // guard short-circuits before the engine
});

test('callTool with undefined arguments defaults to {} (no destructuring throw)', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { enumerateTabs: [] } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('enumerateTabs', undefined);
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls.enumerateTabs[0], []);
});

// ---------------------------------------------------------------------------
// DD6 success serialization
// ---------------------------------------------------------------------------

test('enumerateTabs success → the tab array as JSON, no isError', async () => {
  const tabs = [
    { wcId: 1, url: 'https://a.test', title: 'A', jarId: null, active: true },
    { wcId: 2, url: 'https://b.test', title: 'B', jarId: 'work', active: false },
  ];
  const { engine } = makeFakeEngine({ returns: { enumerateTabs: tabs } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('enumerateTabs', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), tabs);
});

test('openTab returning a number → that number serialized, no isError', async () => {
  const { engine } = makeFakeEngine({ returns: { openTab: 123 } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('openTab', { url: 'https://a.test' });
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), '123');
});

test('closeTab / activateTab serialize their boolean return (NOT normalized to {ok:true})', async () => {
  const { engine } = makeFakeEngine({ returns: { closeTab: true, activateTab: false } });
  const reg = buildToolRegistry(() => engine);
  const closed = await reg.callTool('closeTab', { wcId: 1 });
  assert.equal(closed.isError, undefined);
  assert.equal(textOf(closed), 'true');
  const activated = await reg.callTool('activateTab', { wcId: 1 });
  assert.equal(activated.isError, undefined);
  assert.equal(textOf(activated), 'false');
});

test('void ops (resolve undefined) serialize to the {"ok":true} success shape', async () => {
  const { engine } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  for (const name of ['goBack', 'goForward', 'reload']) {
    const result = await reg.callTool(name, { wcId: 1 });
    assert.equal(result.isError, undefined, name);
    assert.equal(textOf(result), '{"ok":true}', name);
  }
  const nav = await reg.callTool('navigate', { wcId: 1, url: 'https://a.test' });
  assert.equal(textOf(nav), '{"ok":true}');
  const typed = await reg.callTool('typeText', { wcId: 1, text: 'x' });
  assert.equal(textOf(typed), '{"ok":true}');
  const clicked = await reg.callTool('click', { wcId: 1, x: 0, y: 0 });
  assert.equal(textOf(clicked), '{"ok":true}');
  const scrolled = await reg.callTool('scroll', { wcId: 1, x: 0, y: 0, dx: 0, dy: 0 });
  assert.equal(textOf(scrolled), '{"ok":true}');
  const pressed = await reg.callTool('pressKey', { wcId: 1, name: 'Enter' });
  assert.equal(textOf(pressed), '{"ok":true}');
  const dragged = await reg.callTool('dragPointer', { wcId: 1, from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
  assert.equal(textOf(dragged), '{"ok":true}');
});

// ---------------------------------------------------------------------------
// DD6 operational vs error mapping
// ---------------------------------------------------------------------------

test('openTab returning null → NORMAL result (operational), not isError', async () => {
  const { engine } = makeFakeEngine({ returns: { openTab: null } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('openTab', { url: 'javascript:alert(1)' });
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), 'null');
});

test('each resolveContents throw class (bad-handle / no-such-contents / internal-session) → isError with message preserved', async () => {
  const cases = [
    'automation: bad-handle — wcId must be a number, got string',
    'automation: no-such-contents — wcId 99 is not a live webContents',
    'automation: internal-session — wcId 5 belongs to the internal goldfinch://settings session and cannot be driven',
  ];
  for (const msg of cases) {
    // exercise across a wcId-taking op AND across close/activate (which also resolve)
    for (const name of ['navigate', 'closeTab', 'activateTab', 'click', 'pressKey', 'dragPointer']) {
      const { engine } = makeFakeEngine({ throws: { [name]: new Error(msg) } });
      const reg = buildToolRegistry(() => engine);
      const args = { wcId: 1, url: 'https://a.test', x: 0, y: 0, name: 'Enter', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
      const result = await reg.callTool(name, args);
      assert.equal(result.isError, true, name + ' / ' + msg);
      assert.equal(textOf(result), msg);
    }
  }
});

test('navigate bad-url throw → isError with message preserved', async () => {
  const msg = 'automation: bad-url — refusing to navigate to an unsafe URL: ftp://x';
  const { engine } = makeFakeEngine({ throws: { navigate: new Error(msg) } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('navigate', { wcId: 1, url: 'ftp://x' });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('openTab non-string bad-url throw → isError', async () => {
  const msg = 'automation: bad-url — url must be a string';
  const { engine } = makeFakeEngine({ throws: { openTab: new Error(msg) } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('openTab', { url: 42 });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('pressKey unknown-key throw → isError', async () => {
  const msg = 'automation: unknown key Foo (known: Tab, Enter, …, ShiftTab)';
  const { engine } = makeFakeEngine({ throws: { pressKey: new Error(msg) } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('pressKey', { wcId: 1, name: 'Foo' });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('unknown tool name → isError', async () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const result = await reg.callTool('nope', {});
  assert.equal(result.isError, true);
  assert.match(textOf(result), /unknown-tool/);
});

test('null engine (window closed) degrades to isError, never a null-deref', async () => {
  const reg = buildToolRegistry(() => null);
  const result = await reg.callTool('navigate', { wcId: 1, url: 'https://a.test' });
  assert.equal(result.isError, true);
});

test('engine-unavailable accessor (throwing getEngine) degrades to isError', async () => {
  const reg = buildToolRegistry(() => { throw new Error('automation: engine unavailable'); });
  const result = await reg.callTool('reload', { wcId: 1 });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), 'automation: engine unavailable');
});

// ---------------------------------------------------------------------------
// getEngine discipline — fresh engine per callTool
// ---------------------------------------------------------------------------

test('getEngine is called once per callTool (fresh engine each call)', async () => {
  let n = 0;
  const engines = [];
  const reg = buildToolRegistry(() => {
    n += 1;
    const { engine } = makeFakeEngine({ returns: { reload: undefined } });
    engines.push(engine);
    return engine;
  });
  assert.equal(n, 0); // not called at build time
  await reg.callTool('reload', { wcId: 1 });
  await reg.callTool('reload', { wcId: 1 });
  assert.equal(n, 2);
});

// ---------------------------------------------------------------------------
// Observe tools (Leg 3) — list shape + schemas
// ---------------------------------------------------------------------------

test('listTools includes the 4 observe tools with valid object inputSchemas', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  for (const name of OBSERVE_NAMES) {
    const t = byName.get(name);
    assert.ok(t, name + ' must be listed');
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.call, 'undefined', 'internal call fn must not leak for ' + name);
    assert.equal(typeof t.shape, 'undefined', 'internal shape fn must not leak for ' + name);
  }
});

test('observe input schemas: captureScreenshot { wcId req, delayMs opt }, readDom/readAxTree { wcId req }, captureWindow { windowId OPTIONAL }', () => {
  // RENAMED at M09 F7 DD3 (was: "… captureWindow no-input"). The old name asserted a
  // contract DD3 deliberately FALSIFIES: captureWindow now accepts an optional
  // windowId. Renamed with the assertion INVERTED rather than deleted, so git blame
  // carries the intent shift — a green test that goes red on correct code is the GOOD
  // outcome DD9 exists to produce, and deleting it would discard the signal.
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  const req = (name) => byName.get(name).inputSchema.required || [];

  // captureScreenshot — wcId required, delayMs optional (present in properties, not required)
  assert.deepEqual(req('captureScreenshot'), ['wcId']);
  const csProps = byName.get('captureScreenshot').inputSchema.properties;
  assert.equal(csProps.wcId.type, 'integer');
  assert.equal(csProps.delayMs.type, 'integer');

  // captureWindow — windowId OPTIONAL (present in properties, NOT required); still no
  // wcId (it is a whole-WINDOW capture, never a per-contents one — F6 DD9's constraint).
  const cw = byName.get('captureWindow').inputSchema;
  assert.deepEqual(cw.required ?? [], [], 'windowId must NOT be required — omitted means last-focused');
  assert.deepEqual(Object.keys(cw.properties ?? {}), ['windowId']);
  assert.equal(cw.properties.windowId.type, 'integer');
  assert.equal(cw.properties.wcId, undefined, 'captureWindow is window-scoped, never wcId-scoped');

  // readDom — wcId required
  assert.deepEqual(req('readDom'), ['wcId']);
  assert.equal(byName.get('readDom').inputSchema.properties.wcId.type, 'integer');

  // readAxTree — wcId required; depth/properties NOT exposed (unimplemented stub)
  assert.deepEqual(req('readAxTree'), ['wcId']);
  const axProps = byName.get('readAxTree').inputSchema.properties;
  assert.deepEqual(Object.keys(axProps).sort(), ['wcId']);
  assert.equal(axProps.depth, undefined, 'depth must NOT be exposed');
  assert.equal(axProps.properties, undefined, 'properties must NOT be exposed');
  // DD8 stale-handle caveat carried in the description
  assert.match(byName.get('readAxTree').description, /stale/i);
});

// ---------------------------------------------------------------------------
// Image content shaping (DD6) — base64 pass-through, no JSON-wrap, no isError
// ---------------------------------------------------------------------------

test('captureScreenshot success → MCP image content with the base64 verbatim, no isError', async () => {
  const B64 = 'AAECAwQF'; // a known base64 string the engine "returned"
  const { engine } = makeFakeEngine({ returns: { captureScreenshot: B64 } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('captureScreenshot', { wcId: 9 });

  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'image');
  assert.equal(result.content[0].mimeType, 'image/png');
  assert.equal(result.content[0].data, B64, 'base64 must pass through verbatim into data');
  // no JSON-wrap: no text block, data is the raw string (not JSON.stringify'd)
  assert.equal(result.content[0].text, undefined);
  assert.notEqual(result.content[0].data, JSON.stringify(B64));
});

test('captureWindow success → MCP image content with the base64 verbatim, no isError', async () => {
  // M09 F7 DD3 — THE IMAGE-CONTRACT CONTROL. The two content assertions below are
  // UNMODIFIED across DD3 and that is the point: captureWindow's WIRE SHAPE does not
  // move. Its return is a bare base64 string consumed POSITIONALLY by imageResult, so
  // adding a windowId field to it would yield a malformed image with NO error — the
  // DD1 incomplete-marker failure mode, one DD over. Topology is read via
  // enumerateWindows instead.
  const B64 = 'Zm9vYmFy';
  const { engine, calls } = makeFakeEngine({ returns: { captureWindow: B64 } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('captureWindow', {});

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.content, [{ type: 'image', data: B64, mimeType: 'image/png' }]);
  // The ENGINE-DISPATCH pin (distinct from the wire shape above): DD3 changes this
  // signature by design — the op now takes an options bag, not zero args. Omitted
  // windowId rides through as undefined ⇒ the engine's last-focused path.
  assert.deepEqual(calls.captureWindow[0], [{ windowId: undefined }], 'captureWindow takes ONE options-bag arg (DD3)');
});

test('captureWindow with a windowId → the id reaches the engine; the image wire shape is IDENTICAL to the omitted case', async () => {
  const B64 = 'Zm9vYmFy';
  const { engine, calls } = makeFakeEngine({ returns: { captureWindow: B64 } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('captureWindow', { windowId: 3 });

  assert.deepEqual(calls.captureWindow[0], [{ windowId: 3 }], 'the discriminator reaches the engine');
  // Byte-identical to the omitted-windowId case above: passing a discriminator must
  // not perturb the image contract in any way.
  assert.deepEqual(result.content, [{ type: 'image', data: B64, mimeType: 'image/png' }]);
  assert.equal(result.isError, undefined);
});

// ---------------------------------------------------------------------------
// captureScreenshot delayMs mapping (DD7 opts arg)
// ---------------------------------------------------------------------------

test('captureScreenshot maps delayMs → engine.captureScreenshot(wcId, { delayMs }) when present', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { captureScreenshot: 'AA==' } });
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('captureScreenshot', { wcId: 4, delayMs: 250 });
  assert.deepEqual(calls.captureScreenshot[0], [4, { delayMs: 250 }]);
});

test('captureScreenshot passes undefined (not {}) for the opts arg when delayMs is absent', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { captureScreenshot: 'AA==' } });
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('captureScreenshot', { wcId: 4 });
  assert.deepEqual(calls.captureScreenshot[0], [4, undefined]);
});

// ---------------------------------------------------------------------------
// readDom — JSON-text normal result (default serialize)
// ---------------------------------------------------------------------------

test('readDom success → { url, title, html } serialized as JSON text, no isError', async () => {
  const dom = { url: 'https://x.test/', title: 'X', html: '<html></html>' };
  const { engine, calls } = makeFakeEngine({ returns: { readDom: dom } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('readDom', { wcId: 11 });

  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(textOf(result)), dom);
  assert.deepEqual(calls.readDom[0], [11]);
});

// ---------------------------------------------------------------------------
// readAxTree — array→normal, refusal-object→normal (NOT isError), throw→isError
// ---------------------------------------------------------------------------

test('readAxTree success (AXNode array) → JSON-text normal result, no isError', async () => {
  const nodes = [{ nodeId: '1', role: { value: 'RootWebArea' } }];
  const { engine, calls } = makeFakeEngine({ returns: { readAxTree: nodes } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('readAxTree', { wcId: 12 });

  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), nodes);
  assert.deepEqual(calls.readAxTree[0], [12]);
});

test('readAxTree empty array [] → JSON-text normal result (valid success), no isError', async () => {
  const { engine } = makeFakeEngine({ returns: { readAxTree: [] } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('readAxTree', { wcId: 12 });
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), '[]');
});

test('readAxTree debugger-unavailable REFUSAL object → NORMAL JSON-text result, isError falsy (DD6)', async () => {
  const refusal = { automation: 'debugger-unavailable', reason: 'attach-failed', wcId: 13 };
  const { engine } = makeFakeEngine({ returns: { readAxTree: refusal } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('readAxTree', { wcId: 13 });

  assert.ok(!result.isError, 'a RETURNED refusal must NOT be isError — the agent must see and react');
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(textOf(result)), refusal);
});

test('readAxTree post-attach sendCommand throw → isError (genuine exception propagates)', async () => {
  const msg = 'CDP getFullAXTree failed';
  const { engine } = makeFakeEngine({ throws: { readAxTree: new Error(msg) } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('readAxTree', { wcId: 14 });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('observe resolveContents throws (bad-handle / internal-session) → isError, message preserved', async () => {
  const cases = [
    'automation: bad-handle — wcId must be a number, got string',
    'automation: internal-session — wcId 5 belongs to the internal goldfinch://settings session and cannot be driven',
  ];
  for (const msg of cases) {
    for (const name of ['captureScreenshot', 'readDom', 'readAxTree']) {
      const { engine } = makeFakeEngine({ throws: { [name]: new Error(msg) } });
      const reg = buildToolRegistry(() => engine);
      const result = await reg.callTool(name, { wcId: 1 });
      assert.equal(result.isError, true, name + ' / ' + msg);
      assert.equal(textOf(result), msg);
    }
  }
});

test('captureWindow chrome-unavailable throw → isError', async () => {
  const msg = 'automation: chrome window unavailable';
  const { engine } = makeFakeEngine({ throws: { captureWindow: new Error(msg) } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('captureWindow', {});
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

// ---------------------------------------------------------------------------
// Eval tools (Flight 9) — evaluate / injectScript: list shape, schemas, dispatch
// ---------------------------------------------------------------------------

test('listTools includes evaluate + injectScript with wcId + (expression|script) required schemas', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  const req = (name) => byName.get(name).inputSchema.required || [];

  // evaluate — wcId + expression required
  const evalT = byName.get('evaluate');
  assert.ok(evalT, 'evaluate must be listed');
  assert.deepEqual(req('evaluate').sort(), ['expression', 'wcId']);
  assert.equal(evalT.inputSchema.properties.wcId.type, 'integer');
  assert.equal(evalT.inputSchema.properties.expression.type, 'string');
  assert.equal(typeof evalT.call, 'undefined', 'internal call must not leak');
  assert.equal(typeof evalT.shape, 'undefined', 'no shape — evaluate rides default JSON-text serialize');
  // description states the JSON-serializable return contract + main-world + internal exclusion
  assert.match(evalT.description, /JSON-serializable/i);
  assert.match(evalT.description, /main world/i);
  assert.match(evalT.description, /internal/i);

  // injectScript — wcId + script required
  const injT = byName.get('injectScript');
  assert.ok(injT, 'injectScript must be listed');
  assert.deepEqual(req('injectScript').sort(), ['script', 'wcId']);
  assert.equal(injT.inputSchema.properties.wcId.type, 'integer');
  assert.equal(injT.inputSchema.properties.script.type, 'string');
  assert.equal(typeof injT.call, 'undefined', 'internal call must not leak');
  // description states void/{"ok":true} + skips-foreground-to-act + no-persistence
  assert.match(injT.description, /\{"ok":true\}/);
  assert.match(injT.description, /foreground-to-act/i);
  assert.match(injT.description, /persistence/i);
});

test('evaluate maps named args → positional engine.evaluate(wcId, expression)', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { evaluate: { violations: 0 } } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('evaluate', { wcId: 7, expression: 'axe.run(document)' });
  assert.deepEqual(calls.evaluate[0], [7, 'axe.run(document)']);
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), { violations: 0 });
});

test('injectScript maps named args → positional engine.injectScript(wcId, script), void → {"ok":true}', async () => {
  const { engine, calls } = makeFakeEngine(); // returns undefined → void op
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('injectScript', { wcId: 7, script: 'window.__x = 1;' });
  assert.deepEqual(calls.injectScript[0], [7, 'window.__x = 1;']);
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), '{"ok":true}');
});

test('evaluate non-serializable / internal-session engine throw → isError with message preserved', async () => {
  const cases = [
    'automation: evaluate — return value is not JSON-serializable',
    'automation: evaluate — internal-session excluded',
  ];
  for (const msg of cases) {
    const { engine } = makeFakeEngine({ throws: { evaluate: new Error(msg) } });
    const reg = buildToolRegistry(() => engine);
    const result = await reg.callTool('evaluate', { wcId: 1, expression: 'x' });
    assert.equal(result.isError, true, msg);
    assert.equal(textOf(result), msg);
  }
});

test('injectScript internal-session engine throw → isError with message preserved', async () => {
  const msg = 'automation: injectScript — internal-session excluded';
  const { engine } = makeFakeEngine({ throws: { injectScript: new Error(msg) } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('injectScript', { wcId: 1, script: 'x' });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

// ---------------------------------------------------------------------------
// DevTools tools (Flight 9) — openDevTools / closeDevTools: list shape, schemas, dispatch
// ---------------------------------------------------------------------------

test('listTools includes openDevTools + closeDevTools with wcId-required schemas and the capability-distinction note', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  const req = (name) => byName.get(name).inputSchema.required || [];

  for (const name of DEVTOOLS_NAMES) {
    const t = byName.get(name);
    assert.ok(t, name + ' must be listed');
    assert.deepEqual(req(name), ['wcId'], name);
    assert.equal(t.inputSchema.properties.wcId.type, 'integer', name);
    assert.equal(typeof t.call, 'undefined', 'internal call must not leak for ' + name);
    assert.equal(typeof t.shape, 'undefined', 'no shape — void → {"ok":true} via default serialize for ' + name);
  }

  // openDevTools description: detached/{mode:"detach"} rationale + CDP-client/attach-failed
  // distinction + evaluate/injectScript keep working + internal exclusion.
  const openDesc = byName.get('openDevTools').description;
  assert.match(openDesc, /detach/i);
  assert.match(openDesc, /attach-failed|debugger-unavailable/i);
  assert.match(openDesc, /evaluate/);
  assert.match(openDesc, /internal/i);

  // closeDevTools description: idempotent + releases the CDP client.
  const closeDesc = byName.get('closeDevTools').description;
  assert.match(closeDesc, /idempotent/i);
  assert.match(closeDesc, /internal/i);
});

test('openDevTools maps named args → positional engine.openDevTools(wcId), void → {"ok":true}', async () => {
  const { engine, calls } = makeFakeEngine(); // returns undefined → void op
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('openDevTools', { wcId: 7 });
  assert.deepEqual(calls.openDevTools[0], [7]);
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), '{"ok":true}');
});

test('closeDevTools maps named args → positional engine.closeDevTools(wcId), void → {"ok":true}', async () => {
  const { engine, calls } = makeFakeEngine(); // returns undefined → void op
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('closeDevTools', { wcId: 7 });
  assert.deepEqual(calls.closeDevTools[0], [7]);
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), '{"ok":true}');
});

test('devtools internal-session engine throw → isError with message preserved (both ops)', async () => {
  for (const [name, msg] of [
    ['openDevTools', 'automation: openDevTools — internal-session excluded'],
    ['closeDevTools', 'automation: closeDevTools — internal-session excluded'],
  ]) {
    const { engine } = makeFakeEngine({ throws: { [name]: new Error(msg) } });
    const reg = buildToolRegistry(() => engine);
    const result = await reg.callTool(name, { wcId: 1 });
    assert.equal(result.isError, true, name);
    assert.equal(textOf(result), msg);
  }
});

// ---------------------------------------------------------------------------
// getChromeTarget — Flight-6 chrome-discovery tool
// NOTE: makeFakeEngine only covers ALL_NAMES (drive + observe), so getChromeTarget
// tests use plain objects to avoid the helper's ALL_NAMES limitation.
// ---------------------------------------------------------------------------

test('getChromeTarget is listed with an OPTIONAL windowId inputSchema and no internal call/shape leak', () => {
  // RENAMED at M09 F7 DD3 (was: "… with a no-input inputSchema"). Same treatment as
  // the captureWindow schema pin: DD3 falsifies "no-input", so the assertion is
  // inverted in place rather than deleted, keeping the intent shift in git blame.
  const reg = buildToolRegistry(() => ({ getChromeTarget: () => ({}) }));
  const tools = reg.listTools();
  const t = tools.find((x) => x.name === 'getChromeTarget');
  assert.ok(t, 'getChromeTarget must be in listTools()');
  assert.equal(t.inputSchema.type, 'object');
  assert.deepEqual(Object.keys(t.inputSchema.properties ?? {}), ['windowId']);
  assert.equal(t.inputSchema.properties.windowId.type, 'integer');
  assert.deepEqual(t.inputSchema.required ?? [], [], 'windowId must NOT be required — omitted means last-focused');
  assert.deepEqual(Object.keys(t).sort(), ['description', 'inputSchema', 'name']);
  assert.equal(typeof t.call, 'undefined', 'internal call must not leak');
});

test('callTool getChromeTarget passes windowId through to the engine, and omits it as undefined', async () => {
  const calls = [];
  const engine = { getChromeTarget: (...args) => { calls.push(args); return { wcId: 5, kind: 'chrome', url: 'about:blank', windowId: 3 }; } };
  const reg = buildToolRegistry(() => engine);

  await reg.callTool('getChromeTarget', { windowId: 3 });
  assert.deepEqual(calls[0], [{ windowId: 3 }]);

  await reg.callTool('getChromeTarget', {});
  assert.deepEqual(calls[1], [{ windowId: undefined }], 'omitted → undefined ⇒ the engine takes its last-focused path');
});

// ---------------------------------------------------------------------------
// enumerateWindows — M09 F7 DD2, the window-topology discovery primitive.
// NOTE: makeFakeEngine only covers ALL_NAMES (drive + observe), so these tests
// use plain objects (mirrors the getChromeTarget tests above).
// ---------------------------------------------------------------------------

test('enumerateWindows is listed with a no-input inputSchema and no internal call/shape leak', () => {
  const reg = buildToolRegistry(() => ({ enumerateWindows: () => [] }));
  const t = reg.listTools().find((x) => x.name === 'enumerateWindows');
  assert.ok(t, 'enumerateWindows must be in listTools()');
  assert.equal(t.inputSchema.type, 'object');
  assert.deepEqual(Object.keys(t.inputSchema.properties ?? {}), [], 'no-input: properties must be empty');
  assert.deepEqual(t.inputSchema.required ?? [], []);
  assert.deepEqual(Object.keys(t).sort(), ['description', 'inputSchema', 'name']);
  assert.equal(typeof t.call, 'undefined', 'internal call must not leak');
});

test('callTool enumerateWindows over a fake admin engine returns the serialized census (normal result)', async () => {
  const census = [
    { windowId: 1, chromeWcId: 11, booted: true, activeTabWcId: 5, lastFocused: true, sheetWcId: 77, sheetVisible: true, findVisible: false },
    { windowId: 2, chromeWcId: 21, booted: false, activeTabWcId: null, lastFocused: false, sheetVisible: false, findVisible: false },
  ];
  const reg = buildToolRegistry(() => ({ enumerateWindows: () => census }));
  const result = await reg.callTool('enumerateWindows', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), census);
});

test('callTool enumerateWindows over a jar-scoped engine (throws admin-only) → isError with the message', async () => {
  const msg = 'automation: admin-only — enumerateWindows (window topology discovery) is restricted to the admin identity';
  const reg = buildToolRegistry(() => ({ enumerateWindows: () => { throw new Error(msg); } }));
  const result = await reg.callTool('enumerateWindows', {});
  assert.equal(result.isError, true);
  assert.match(textOf(result), /admin-only/);
});

test('callTool enumerateWindows windows-unavailable throw → isError', async () => {
  const msg = 'automation: windows-unavailable — window registry not wired';
  const reg = buildToolRegistry(() => ({ enumerateWindows: () => { throw new Error(msg); } }));
  const result = await reg.callTool('enumerateWindows', {});
  assert.equal(result.isError, true);
  assert.match(textOf(result), /windows-unavailable/);
});

// ---------------------------------------------------------------------------
// DD9 — the SCHEMA-SHAPE pin, field by field (S10).
//
// The op COUNT guard alone cannot catch a param drifting onto an existing tool:
// F7 DD3 adds windowId to two schemas while docs/mcp-automation.md asserts "All 30
// tools below match mcp-tools.js exactly". This pin makes that drift LOUD.
// ---------------------------------------------------------------------------

/**
 * The DD9 assertion helper: does `schema` declare `prop` as an OPTIONAL property of
 * the given JSON-schema `type`? Extracted so the pin and its positive control run
 * through the SAME code path — a pin proven only against correct code is an
 * instrument never shown able to report the fault it exists to catch.
 */
function declaresOptional(schema, prop, type) {
  const props = schema?.properties ?? {};
  if (!Object.prototype.hasOwnProperty.call(props, prop)) return false;
  if (props[prop].type !== type) return false;
  return !(schema.required ?? []).includes(prop);
}

test('DD9: the windowId param is pinned FIELD BY FIELD on captureWindow and getChromeTarget — with a positive control', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));

  // The pin: both DD3 tools declare windowId as an optional integer.
  assert.equal(declaresOptional(byName.get('captureWindow').inputSchema, 'windowId', 'integer'), true);
  assert.equal(declaresOptional(byName.get('getChromeTarget').inputSchema, 'windowId', 'integer'), true);

  // POSITIVE CONTROL — the SAME helper must REJECT a synthetic schema missing
  // windowId, one declaring it with the wrong type, and one marking it required.
  // Without this the pin is an absence confirmed by an instrument never shown able
  // to report presence (the leg-1 false-PASS class).
  assert.equal(declaresOptional({ type: 'object', properties: {} }, 'windowId', 'integer'), false, 'a schema MISSING windowId must be rejected');
  assert.equal(declaresOptional({ type: 'object', properties: { windowId: { type: 'string' } } }, 'windowId', 'integer'), false, 'the WRONG type must be rejected');
  assert.equal(declaresOptional({ type: 'object', properties: { windowId: { type: 'integer' } }, required: ['windowId'] }, 'windowId', 'integer'), false, 'a REQUIRED windowId must be rejected — it would break every existing caller');
});

test('DD9: the tools DD3 does NOT touch keep their wcId-required schemas unchanged', () => {
  // The other half of the pin: DD3 must not have leaked windowId onto the wcId ops.
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  for (const name of ['captureScreenshot', 'readDom', 'readAxTree']) {
    const schema = byName.get(name).inputSchema;
    assert.deepEqual(schema.required, ['wcId'], name + ' keeps wcId required');
    assert.equal(schema.properties.windowId, undefined, name + ' must NOT have gained a windowId param');
  }
  // enumerateWindows and enumerateTabs take no input at all.
  assert.deepEqual(Object.keys(byName.get('enumerateWindows').inputSchema.properties ?? {}), []);
  assert.deepEqual(Object.keys(byName.get('enumerateTabs').inputSchema.properties ?? {}), []);
});

// ---------------------------------------------------------------------------
// M09 F7 leg 4 — THE DESCRIPTION PIN (the gap DD9 leaves open).
//
// DD9 pins the op COUNT, the KEY SHAPE, and the inputSchema. It does NOT pin
// `description` — yet listTools projects description to every consumer
// (mcp-tools.js's listTools projection; the key-shape pin above asserts exactly
// ['description','inputSchema','name']). So a description can LIE to every
// consumer while all 30 tools, every schema, and every count stay green: the S10
// schema-stable/contract-breaking class, in the one field DD9 doesn't cover.
// That field matters more than its absence from the pin suggests — a description
// is what an agentic consumer actually READS to decide how to call a tool.
//
// Scope: the FOUR topology-bearing tools — exactly the set F7 changed the
// contract of (DD1/DD2/DD3). Seven other tools already carry ad-hoc description
// assertions (pressKey, readAxTree, evaluate, injectScript, openDevTools,
// closeDevTools, getHistory); those are untouched. This ADDS four; it does not
// rewrite the file's approach.
//
// What is pinned: CONTRACT-BEARING SUBSTANCE, never exact prose. A pin on
// wording is a rename-tripwire, not a contract.
//
// TOKEN DISCRIMINATION — the maintenance rule these pins live or die by.
// A token must be satisfiable ONLY by the contract claim it stands for. Two
// classes of token, with very different risk:
//   - IDENTIFIER tokens (windowId, booted, sheetVisible, lastFocused) recur
//     several times per description, but EVERY occurrence is prose about that
//     same field — deleting the contract deletes them all. Low risk.
//   - NATURAL-LANGUAGE PHRASES are the hazard: they can recur in an UNRELATED
//     sense and satisfy the pin after the real claim is gone. This is not
//     hypothetical — /all windows/i was defeated exactly this way here (see
//     enumerateTabs below), and the in-test synthetic controls did NOT catch it.
// RULE: mutation-test every new token against the REAL description — delete the
// claim, watch this test go red. A synthetic fixture proves the helper; only a
// mutation proves the token.
// ---------------------------------------------------------------------------

/**
 * The description-pin assertion helper: does `description` carry every required
 * token? Returns the list of MISSING tokens (empty ⇒ pass). Extracted so the pin
 * and its positive control run through the SAME code path — a pin proven only
 * against correct code is an instrument never shown able to report the fault it
 * exists to catch (the leg-1 false-PASS class; mirrors declaresOptional above).
 *
 * @param {string} description
 * @param {RegExp[]} required
 * @returns {string[]} the source strings of the patterns that did NOT match
 */
function missingDescriptionTokens(description, required) {
  return required.filter((re) => !re.test(description)).map((re) => String(re));
}

test('M09 F7: the four topology-bearing tools pin their DESCRIPTION contract — with a positive control', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));

  // Contract-bearing substance per tool. Each token is a claim a consumer acts on.
  const required = {
    // DD1: the census spans all windows and stamps windowId; booted is its
    // completeness signal.
    //
    // ⚠ `/across ALL windows/i`, NOT `/all windows/i` — the looser token is
    // DEFEATED BY INCIDENTAL PROSE. This description says "all windows" TWICE:
    // once as the contract claim ("tabs across ALL windows") and once in an aside
    // about jar keys ("a jar key sees all windows' tabs for its own jar"). With
    // /all windows/i the pin PASSES even after the contract claim is deleted —
    // caught by mutation-testing the real description, NOT by the synthetic
    // control below (which proves the HELPER works, never that a TOKEN
    // discriminates). Any token added here must be mutation-tested against the
    // real description: delete the claim, watch this test go red.
    enumerateTabs: [/across ALL windows/i, /windowId/, /booted/],
    // DD3: optional windowId, named refusal, and — load-bearing — that it returns
    // PIXELS, NOT TOPOLOGY (the wire shape stayed unwrapped for exactly this reason).
    captureWindow: [/windowId/, /optional/i, /no-such-window/, /pixels, not topology/i],
    // DD3: admin tier, optional windowId, named refusal.
    getChromeTarget: [/admin only/i, /windowId/, /no-such-window/],
    // DD2: admin tier, the completeness signal, the two-menus observable, and that
    // lastFocused is NOT an OS-focus claim (a promise this codebase deliberately refuses).
    enumerateWindows: [/admin only/i, /booted/, /sheetVisible/, /lastFocused/, /not an OS-focus claim/i],
  };

  for (const [name, tokens] of Object.entries(required)) {
    const missing = missingDescriptionTokens(byName.get(name).description, tokens);
    assert.deepEqual(missing, [], name + "'s description is missing contract tokens: " + missing.join(', '));
  }

  // POSITIVE CONTROL — the SAME helper must REJECT a synthetic tool object whose
  // description omits a required token. Without this the pin is an absence
  // confirmed by an instrument never shown able to report presence.
  const syntheticMissing = { description: 'List tabs as an array of { wcId, url }.' };
  assert.deepEqual(
    missingDescriptionTokens(syntheticMissing.description, required.enumerateTabs),
    ['/across ALL windows/i', '/windowId/', '/booted/'],
    'a description omitting every DD1 token must be rejected — all three reported missing'
  );
  // And it must report a PARTIAL miss, not just an all-or-nothing one: a description
  // that drifted back to the pre-DD1 single-window contract keeps windowId but loses
  // the all-windows claim — the exact silent regression this pin exists to catch.
  const syntheticDrifted = { description: 'List the tabs in the current window as { wcId, url, windowId }. booted is unrelated.' };
  assert.deepEqual(
    missingDescriptionTokens(syntheticDrifted.description, required.enumerateTabs),
    ['/across ALL windows/i'],
    'a description that lost ONLY the all-windows claim must be rejected on exactly that token'
  );
  // THE TOKEN-DISCRIMINATION CONTROL (M09 F7 leg 4 — the finding that motivated it).
  // The synthetic controls above prove the HELPER works. They do NOT prove a TOKEN
  // discriminates against THIS tool's real prose. This one does: the real
  // enumerateTabs description contains the phrase "all windows" a SECOND time, in a
  // jar-key aside ("a jar key sees all windows' tabs for its own jar"). A pin written
  // as /all windows/i therefore PASSES even when the contract claim is gone — proven
  // by mutation. Assert the loose token's defeat explicitly, so nobody loosens it back.
  const contractClaimDeleted = "List all drivable (dom-ready) tabs as an array of { wcId, url, title, jarId, active, windowId }. windowId is stamped from the window registry. A window whose chrome has not finished booting contributes ZERO rows — poll booted. Admin listings include the internal goldfinch:// tabs; jar-key listings never do (session filter) — a jar key sees all windows' tabs for its own jar, never the window topology.";
  assert.deepEqual(
    missingDescriptionTokens(contractClaimDeleted, [/all windows/i]),
    [],
    'DEMONSTRATION: the LOOSE token /all windows/i is satisfied by the jar-key aside alone — it does NOT catch the deleted contract claim'
  );
  assert.deepEqual(
    missingDescriptionTokens(contractClaimDeleted, [/across ALL windows/i]),
    ['/across ALL windows/i'],
    'the TIGHT token /across ALL windows/i DOES catch the deleted contract claim — this is why the pin uses it'
  );
  // And the helper must PASS a description that carries every token — otherwise the
  // controls above would be satisfied by a helper that rejects everything.
  assert.deepEqual(
    missingDescriptionTokens('Lists tabs across ALL windows, stamping windowId; booted signals completeness.', required.enumerateTabs),
    [],
    'a description carrying every token must PASS — the helper is not simply rejecting everything'
  );
});

// ---------------------------------------------------------------------------
// M09 F7 leg 4 (errata fold) — THE DD6 RAISE/NO-RAISE DESCRIPTION PIN.
//
// The defect this exists to catch is not hypothetical: it SHIPPED in this very
// flight and this pin is the fix's tripwire. Before the fold, readDom's and
// evaluate's descriptions BOTH read "(foreground-first)" while their shipped ops
// do the exact opposite — DD6 deleted the activate branch from both, and
// observe.js's own header says so verbatim ("THIS OP NO LONGER ACTIVATES ITS
// TARGET"). The operator-facing docs WERE updated for DD6
// (docs/mcp-automation.md: readDom "Does NOT foreground its target"); the
// MACHINE-READABLE tool descriptions were NOT. The consumer that matters most
// here — an agentic MCP client choosing how to call a tool — reads the stale
// one, and could reasonably pick readDom AS A RAISE PRIMITIVE and silently get
// no raise. That is precisely the hazard DD6 set out to retire.
//
// Why this pin is shaped as a PAIR (present-on-two / absent-on-two) instead of
// four independent asserts: THE RAISE HALF IS THE NO-RAISE HALF'S POSITIVE
// CONTROL, on the same instrument, in the same run. /foreground-first/i must be
// PRESENT on the two ops that still activate (captureScreenshot, readAxTree) and
// ABSENT on the two that no longer do (readDom, evaluate). An absence pin whose
// token was never shown able to report presence is the class this flight paid for
// three times over — here presence is demonstrated one assert away from the
// absence claim, so "the token didn't match" cannot be confused with "the token
// never matches anything".
// ---------------------------------------------------------------------------

test('M09 F7 DD6: readDom/evaluate descriptions must NOT claim foreground-first — with the raise half as the same-run positive control', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));

  // THE RAISE HALF — the POSITIVE CONTROL. These two ops DO still activate
  // (observe.js: both `await activate(wcId)` for a guest target), so their
  // descriptions must still claim it. This half proves /foreground-first/i CAN
  // report presence against REAL shipped prose, in this run.
  for (const name of ['captureScreenshot', 'readAxTree']) {
    assert.deepEqual(
      missingDescriptionTokens(byName.get(name).description, [/foreground-first/i]),
      [],
      name + ' DOES activate its target — its description must still claim foreground-first'
    );
  }

  // THE NO-RAISE HALF — both directions are required, because omitting a lie is
  // not the same as stating the truth:
  //   (a) the stale claim is ABSENT — the defect that actually shipped;
  //   (b) the real contract is PRESENT — so a future rewrite cannot satisfy the
  //       pin by simply saying nothing about foregrounding at all.
  for (const name of ['readDom', 'evaluate']) {
    const desc = byName.get(name).description;
    assert.deepEqual(
      missingDescriptionTokens(desc, [/foreground-first/i]),
      ['/foreground-first/i'],
      name + ' does NOT activate its target (DD6) — its description must NOT claim foreground-first'
    );
    assert.deepEqual(
      missingDescriptionTokens(desc, [/Does NOT foreground/i]),
      [],
      name + ' must STATE the no-raise contract, not merely omit the stale one'
    );
  }

  // MUTATION CONTROLS — AC17's hard-won lesson, applied literally.
  // A synthetic fixture proves the HELPER, never that a TOKEN DISCRIMINATES:
  // AC17's own /all windows/i pin sat green while its contract claim was deleted,
  // because the token recurred in an unrelated aside. THE ONLY CONTROL THAT
  // COUNTS IS A MUTATION OF THE REAL ARTIFACT. So each token below is mutated
  // against the REAL shipped description, not a synthetic stand-in.

  // (1) Delete readDom's REAL no-raise claim ⇒ the (b) pin must go red.
  const readDomReal = byName.get('readDom').description;
  const readDomClaimDeleted = readDomReal.replace(/Does NOT foreground its target[^.]*\.\s*/i, '');
  assert.notEqual(
    readDomClaimDeleted, readDomReal,
    'the mutation must actually alter the REAL description — a no-op mutation proves nothing'
  );
  assert.deepEqual(
    missingDescriptionTokens(readDomClaimDeleted, [/Does NOT foreground/i]),
    ['/Does NOT foreground/i'],
    'MUTATION: deleting readDom\'s real no-raise claim MUST break the pin'
  );

  // (2) Delete evaluate's REAL no-raise claim ⇒ the (b) pin must go red.
  const evaluateReal = byName.get('evaluate').description;
  const evaluateClaimDeleted = evaluateReal.replace(/Does NOT foreground its target[^.]*\.\s*/i, '');
  assert.notEqual(
    evaluateClaimDeleted, evaluateReal,
    'the mutation must actually alter the REAL description — a no-op mutation proves nothing'
  );
  assert.deepEqual(
    missingDescriptionTokens(evaluateClaimDeleted, [/Does NOT foreground/i]),
    ['/Does NOT foreground/i'],
    'MUTATION: deleting evaluate\'s real no-raise claim MUST break the pin'
  );

  // (3) REGRESSION-SHAPED MUTATION — reintroduce the exact defect that shipped.
  // This is the highest-value control here: it replays the real bug rather than
  // an invented one. The pre-fold text is pasted verbatim from the tree.
  const readDomPreFold = 'Read the live DOM of the tab identified by wcId (foreground-first). Returns { url, title, html } as JSON text — the full live document.documentElement outerHTML (no trimming).';
  assert.deepEqual(
    missingDescriptionTokens(readDomPreFold, [/foreground-first/i]),
    [],
    'MUTATION: the pre-fold readDom description DID claim foreground-first — the (a) pin catches it (this is the bug that shipped)'
  );
  assert.deepEqual(
    missingDescriptionTokens(readDomPreFold, [/Does NOT foreground/i]),
    ['/Does NOT foreground/i'],
    'MUTATION: the pre-fold readDom description also failed the (b) pin — it never stated the real contract'
  );

  // (4) The raise half's token must discriminate too — delete foreground-first
  // from captureScreenshot's REAL description and confirm its pin goes red.
  // Without this, the raise half could be passing on prose that happens to
  // contain the token for an unrelated reason.
  const captureReal = byName.get('captureScreenshot').description;
  const captureClaimDeleted = captureReal.replace(/foreground-first/gi, '');
  assert.notEqual(captureClaimDeleted, captureReal, 'the mutation must actually alter the REAL description');
  assert.deepEqual(
    missingDescriptionTokens(captureClaimDeleted, [/foreground-first/i]),
    ['/foreground-first/i'],
    'MUTATION: stripping foreground-first from captureScreenshot\'s real description MUST break the raise-half control'
  );
});

test('callTool getChromeTarget over a fake admin engine returns the serialized target (normal result)', async () => {
  const target = { wcId: 5, kind: 'chrome', url: 'about:blank' };
  const engine = { getChromeTarget: () => target };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getChromeTarget', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), target);
});

test('callTool getChromeTarget over a jar-scoped engine (throws admin-only) → isError with the message', async () => {
  const msg = 'automation: admin-only — getChromeTarget (chrome renderer discovery) is restricted to the admin identity';
  const engine = { getChromeTarget: () => { throw new Error(msg); } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getChromeTarget', {});
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('callTool getChromeTarget chrome-window-unavailable throw → isError', async () => {
  const msg = 'automation: chrome-window-unavailable — mainWindow is null (closed or starting up)';
  const engine = { getChromeTarget: () => { throw new Error(msg); } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getChromeTarget', {});
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

// ---------------------------------------------------------------------------
// downloadsList — Flight-5 app-level downloads tool (admin-only via scope façade)
// NOTE: makeFakeEngine only covers ALL_NAMES (drive + observe), so downloadsList
// tests use plain objects (mirrors the getChromeTarget tests above).
// ---------------------------------------------------------------------------

test('downloadsList is listed with a no-input inputSchema and no internal call/shape leak', () => {
  const reg = buildToolRegistry(() => ({ getDownloadsList: () => [] }));
  const tools = reg.listTools();
  const t = tools.find((x) => x.name === 'downloadsList');
  assert.ok(t, 'downloadsList must be in listTools()');
  assert.equal(t.inputSchema.type, 'object');
  assert.deepEqual(Object.keys(t.inputSchema.properties ?? {}), [], 'no-input: properties must be empty');
  assert.deepEqual(Object.keys(t).sort(), ['description', 'inputSchema', 'name']);
  assert.equal(typeof t.call, 'undefined', 'internal call must not leak');
});

test('callTool downloadsList over a fake admin engine returns the serialized records (normal result)', async () => {
  const records = [
    { id: 1, url: 'https://example.com/a.zip', filename: 'a.zip', savePath: '/d/a.zip', state: 'completed', received: 10, total: 10 },
    { id: 2, url: 'https://example.com/b.pdf', filename: 'b.pdf', savePath: '/d/b.pdf', state: 'progressing', received: 3, total: 9 },
  ];
  const engine = { getDownloadsList: () => records };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('downloadsList', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), records);
});

test('callTool downloadsList over a jar-scoped engine (throws admin-only) → isError with the message', async () => {
  const msg = 'automation: admin-only — downloadsList (app-level downloads view) is restricted to the admin identity';
  const engine = { getDownloadsList: () => { throw new Error(msg); } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('downloadsList', {});
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

// ---------------------------------------------------------------------------
// getHistory — Mission 08 Flight 5 jar-confined history read (NOT admin-only)
// NOTE: makeFakeEngine only covers ALL_NAMES (drive + observe), so getHistory
// tests use plain objects (mirrors the getChromeTarget/downloadsList tests above).
// ---------------------------------------------------------------------------

test('getHistory is listed with jarId/query/limit/before all OPTIONAL at the schema level and no internal call/shape leak', () => {
  const reg = buildToolRegistry(() => ({ getHistory: () => ({}) }));
  const tools = reg.listTools();
  const t = tools.find((x) => x.name === 'getHistory');
  assert.ok(t, 'getHistory must be in listTools()');
  assert.equal(t.inputSchema.type, 'object');
  assert.deepEqual(Object.keys(t.inputSchema.properties ?? {}).sort(), ['before', 'jarId', 'limit', 'query']);
  // No top-level `required` — the jar-optional / admin-required split is runtime
  // (engine.js), not schema-level (a schema can't express "required for admin only").
  assert.deepEqual(t.inputSchema.required ?? [], []);
  assert.equal(t.inputSchema.properties.jarId.type, 'string');
  assert.equal(t.inputSchema.properties.query.type, 'string');
  assert.equal(t.inputSchema.properties.limit.type, 'integer');
  assert.equal(t.inputSchema.properties.before.type, 'integer');
  assert.deepEqual(Object.keys(t).sort(), ['description', 'inputSchema', 'name']);
  assert.equal(typeof t.call, 'undefined', 'internal call must not leak');
  // Description spells the identity semantics (flight DD1/leg contract item 3).
  assert.match(t.description, /jar key/i);
  assert.match(t.description, /admin/i);
  assert.match(t.description, /out-of-jar/);
  assert.match(t.description, /unknown-jar/);
});

test('callTool getHistory maps named args to the engine\'s (jarId, opts) positional signature', async () => {
  const calls = [];
  const engine = { getHistory: (jarId, opts) => { calls.push([jarId, opts]); return { jarId, visits: [] }; } };
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('getHistory', { jarId: 'work', query: 'example', limit: 10 });
  assert.deepEqual(calls, [['work', { query: 'example', limit: 10, before: undefined }]]);
});

test('callTool getHistory with no args at all still calls engine.getHistory(undefined, opts)', async () => {
  const calls = [];
  const engine = { getHistory: (jarId, opts) => { calls.push([jarId, opts]); return { jarId: 'own', visits: [] }; } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getHistory', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [[undefined, { query: undefined, limit: undefined, before: undefined }]]);
});

test('callTool getHistory over a fake jar engine returns the serialized { jarId, visits } (normal result)', async () => {
  const payload = { jarId: 'personal', visits: [{ id: 1, url: 'https://a', title: 'A', visitedAt: 1000 }] };
  const engine = { getHistory: () => payload };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getHistory', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(result)), payload);
});

test('callTool getHistory foreign-jarId out-of-jar throw → isError with the message', async () => {
  const msg = 'automation: out-of-jar — a jar key may only read history for its own jar (personal)';
  const engine = { getHistory: () => { throw new Error(msg); } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getHistory', { jarId: 'work' });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('callTool getHistory admin missing-jarId bad-args throw → isError with the message', async () => {
  const msg = 'automation: bad-args — jarId required';
  const engine = { getHistory: () => { throw new Error(msg); } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getHistory', {});
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('callTool getHistory admin unknown-jarId throw → isError with the message', async () => {
  const msg = 'automation: unknown-jar';
  const engine = { getHistory: () => { throw new Error(msg); } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getHistory', { jarId: 'ghost' });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});

test('callTool getHistory query+before bad-args throw → isError with the message', async () => {
  const msg = 'automation: bad-args — query does not page';
  const engine = { getHistory: () => { throw new Error(msg); } };
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('getHistory', { query: 'x', before: 5 });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), msg);
});
