'use strict';

// Unit tests for src/main/automation/mcp-tools.js — the SDK-free drive-tool
// registry adapter (Leg 2, drive-tools).
//
// SDK-free + Electron-free: mcp-tools.js imports nothing, so these tests run
// under plain `node --test` with a fake recording engine (no SDK, no Electron).
// They pin the discovery contract (12 tool names + schemas, no `call` leak),
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
  'goBack', 'goForward', 'reload', 'click', 'typeText', 'scroll', 'pressKey',
];

const OBSERVE_NAMES = ['captureScreenshot', 'captureWindow', 'readDom', 'readAxTree'];

const ALL_NAMES = [...DRIVE_NAMES, ...OBSERVE_NAMES];

/**
 * Build a fake engine whose 12 ops record their positional args and return a
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

test('listTools returns exactly the 16 tools (12 drive + 4 observe), named 1:1 with engine ops', () => {
  const { engine } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  const tools = reg.listTools();
  assert.equal(tools.length, 16);
  assert.deepEqual(tools.map((t) => t.name).sort(), [...ALL_NAMES].sort());
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
  // pressKey — wcId + name; description enumerates the known keys (incl. ShiftTab)
  assert.deepEqual(req('pressKey'), ['wcId', 'name']);
  const pk = byName.get('pressKey').inputSchema.properties.name;
  assert.match(pk.description, /ShiftTab/);
  assert.match(pk.description, /Tab, Enter, Escape/);
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

test('scroll maps to engine.scroll(wcId, x, y, dx, dy)', async () => {
  const { engine, calls } = makeFakeEngine();
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('scroll', { wcId: 5, x: 1, y: 2, dx: 3, dy: 4 });
  assert.deepEqual(calls.scroll[0], [5, 1, 2, 3, 4]);
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

test('openTab maps to engine.openTab(url); typeText to engine.typeText(wcId, text); pressKey to engine.pressKey(wcId, name)', async () => {
  const { engine, calls } = makeFakeEngine({ returns: { openTab: 99 } });
  const reg = buildToolRegistry(() => engine);
  await reg.callTool('openTab', { url: 'https://a.test' });
  assert.deepEqual(calls.openTab[0], ['https://a.test']);
  await reg.callTool('typeText', { wcId: 1, text: 'hello' });
  assert.deepEqual(calls.typeText[0], [1, 'hello']);
  await reg.callTool('pressKey', { wcId: 1, name: 'ShiftTab' });
  assert.deepEqual(calls.pressKey[0], [1, 'ShiftTab']);
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
    for (const name of ['navigate', 'closeTab', 'activateTab', 'click', 'pressKey']) {
      const { engine } = makeFakeEngine({ throws: { [name]: new Error(msg) } });
      const reg = buildToolRegistry(() => engine);
      const args = { wcId: 1, url: 'https://a.test', x: 0, y: 0, name: 'Enter' };
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

test('observe input schemas: captureScreenshot { wcId req, delayMs opt }, readDom/readAxTree { wcId req }, captureWindow no-input', () => {
  const reg = buildToolRegistry(() => makeFakeEngine().engine);
  const byName = new Map(reg.listTools().map((t) => [t.name, t]));
  const req = (name) => byName.get(name).inputSchema.required || [];

  // captureScreenshot — wcId required, delayMs optional (present in properties, not required)
  assert.deepEqual(req('captureScreenshot'), ['wcId']);
  const csProps = byName.get('captureScreenshot').inputSchema.properties;
  assert.equal(csProps.wcId.type, 'integer');
  assert.equal(csProps.delayMs.type, 'integer');

  // captureWindow — NO input (no required, no wcId property)
  const cw = byName.get('captureWindow').inputSchema;
  assert.deepEqual(cw.required ?? [], []);
  assert.deepEqual(Object.keys(cw.properties ?? {}), []);

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
  const B64 = 'Zm9vYmFy';
  const { engine, calls } = makeFakeEngine({ returns: { captureWindow: B64 } });
  const reg = buildToolRegistry(() => engine);
  const result = await reg.callTool('captureWindow', {});

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.content, [{ type: 'image', data: B64, mimeType: 'image/png' }]);
  assert.deepEqual(calls.captureWindow[0], [], 'captureWindow takes no positional args');
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
