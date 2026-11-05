'use strict';

// Sortie 06 Leg 1 (AC11 / AC19 / AC20): the chrome-side prompt client - token minting, anchor
// measurement + re-send triggers (idle while nothing is presented), label mapping, and the
// close sink's stale-token handling.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSavePromptClient,
  CLIENT_HANDLED_REASONS,
  DEFERRED_REASONS
} = require('../../src/renderer/chrome/save-prompt-client');
const { SAVE_PROMPT_CLOSE_REASONS } = require('../../src/shared/save-prompt-close-effects');

function build({ rect = { right: 640, width: 24 }, answer = { presented: true }, containers = [], node = null } = {}) {
  const opens = [];
  const anchors = [];
  const closed = [];
  let closedCb = null;
  const winListeners = new Map();
  const win = {
    addEventListener: (t, fn) => winListeners.set(t, fn),
    removeEventListener: (t) => winListeners.delete(t)
  };
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.observed = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(el) {
      this.observed.push(el);
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  const indicator = { rect, getBoundingClientRect: () => indicator.rect };
  const goldfinch = {
    savePromptOpen: async (p) => {
      opens.push(p);
      return typeof answer === 'function' ? answer(p) : answer;
    },
    savePromptAnchor: (p) => anchors.push(p),
    onSavePromptClosed: (cb) => {
      closedCb = cb;
    }
  };
  const client = createSavePromptClient({
    goldfinch,
    jarsClient: { containers },
    getIndicator: () => indicator,
    getStatusNode: () => node,
    onClosed: (info) => closed.push(info),
    win
  });
  return { client, opens, anchors, closed, winListeners, observers, indicator, fireClosed: (d) => closedCb(d) };
}

const ENTRY = { captureId: 'c1', wcId: 7, model: { origin: 'x', mode: 'save', choices: ['global'] }, queue: null };

test('tokens are monotonic per open; the open carries the measured anchor (CSS px)', async () => {
  const t = build();
  await t.client.present(ENTRY);
  await t.client.present(ENTRY);
  assert.deepEqual(
    t.opens.map((o) => o.token),
    [1, 2]
  );
  assert.equal(t.opens[0].anchor, 640);
  delete globalThis.ResizeObserver;
});

test('AC11: while presented, a ResizeObserver on the indicator AND a window resize listener re-send the anchor; both are idle before/after', async () => {
  const t = build();
  assert.equal(t.observers.length, 0, 'idle before any prompt');
  assert.equal(t.winListeners.size, 0);
  await t.client.present(ENTRY);
  assert.equal(t.observers.length, 1);
  assert.deepEqual(t.observers[0].observed, [t.indicator]);
  assert.ok(t.winListeners.has('resize'));
  // indicator moves, then a hide (size -> 0) arrives as an observer callback
  t.indicator.rect = { right: 600, width: 24 };
  t.observers[0].cb();
  t.indicator.rect = { right: 0, width: 0 };
  t.winListeners.get('resize')();
  assert.deepEqual(t.anchors, [
    { token: 1, right: 600 },
    { token: 1, right: null }
  ]);
  // close -> tracking stops
  t.fireClosed({ token: 1, captureId: 'c1', reason: 'saved' });
  assert.equal(t.observers[0].disconnected, true);
  assert.equal(t.winListeners.size, 0);
  assert.equal(t.client.isOpen(), false);
  delete globalThis.ResizeObserver;
});

test('a refused open starts no tracking and reports the reason; a thrown invoke reads as `gone`', async () => {
  let t = build({ answer: { presented: false, reason: 'sheet-open' } });
  assert.deepEqual(await t.client.present(ENTRY), { presented: false, reason: 'sheet-open' });
  assert.equal(t.observers.length, 0);
  assert.equal(t.client.isOpen(), false);
  t = build({
    answer: () => {
      throw new Error('ipc gone');
    }
  });
  assert.deepEqual(await t.client.present(ENTRY), { presented: false, reason: 'gone' });
  delete globalThis.ResizeObserver;
});

test('the close sink ignores a stale token, passes wcId, and maps an unknown reason to `dismissed`', async () => {
  const t = build();
  await t.client.present(ENTRY);
  t.fireClosed({ token: 99, captureId: 'c1', reason: 'saved' });
  assert.deepEqual(t.closed, []);
  t.fireClosed({ token: 1, captureId: 'c1', reason: 'bogus' });
  assert.deepEqual(t.closed, [{ captureId: 'c1', wcId: 7, reason: 'dismissed' }]);
  t.fireClosed({ token: 1, captureId: 'c1', reason: 'saved' });
  assert.equal(t.closed.length, 1, 'a second close for the same token is ignored');
  delete globalThis.ResizeObserver;
});

test('AC20: labelChoice - global, resolved jar, and unresolved jar (disabled "Unknown vault")', () => {
  const t = build({ containers: [{ id: 'work', name: 'Work' }] });
  assert.deepEqual(t.client.labelChoice('global'), { vaultId: 'global', label: 'Global' });
  assert.deepEqual(t.client.labelChoice('work'), { vaultId: 'work', label: 'Work' });
  assert.deepEqual(t.client.labelChoice('zzz'), { vaultId: 'zzz', label: 'Unknown vault', disabled: true });
  delete globalThis.ResizeObserver;
});

test('AC20: decorate passes a result-only model through untouched', () => {
  const t = build();
  const m = { result: 'unchanged' };
  assert.equal(t.client.decorate(m), m);
  delete globalThis.ResizeObserver;
});

test("AC1 drift (chrome side): the client's handled reasons are a subset of the shared set, and every table reason is handled or explicitly deferred", () => {
  assert.ok(CLIENT_HANDLED_REASONS.length > 0, 'vacuity guard');
  for (const r of CLIENT_HANDLED_REASONS) assert.ok(SAVE_PROMPT_CLOSE_REASONS.has(r), r);
  for (const r of DEFERRED_REASONS) assert.ok(SAVE_PROMPT_CLOSE_REASONS.has(r), r);
  for (const r of SAVE_PROMPT_CLOSE_REASONS) {
    assert.ok(
      CLIENT_HANDLED_REASONS.includes(r) || DEFERRED_REASONS.includes(r),
      `table reason "${r}" is neither handled nor deferred`
    );
  }
});

// ---- Sortie 06 Leg 3 (AC7 / R9): the chrome polite announcement --------------------------------

const tick = () => new Promise((r) => setImmediate(r));

test('Leg 3 AC7: a successful offer presentation announces once (clear, then set after a TIMER, never rAF)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const node = { textContent: 'stale' };
  const tb = build({ node });
  const p = tb.client.present({
    ...ENTRY,
    model: {
      origin: 'https://login.example.com',
      mode: 'save',
      kind: 'login',
      username: 'secret-user',
      choices: ['global']
    }
  });
  await tick();
  await p;
  assert.equal(node.textContent, '', 'cleared first so identical text re-announces');
  t.mock.timers.tick(30);
  assert.equal(node.textContent, 'Save password for login.example.com? Press F6 to respond.');
  assert.equal(node.textContent.includes('secret-user'), false, 'host only: no username');
  delete globalThis.ResizeObserver;
});

test('Leg 3 AC7: update, card and identity phrasing; a re-ask / convert re-announces identical text', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const node = { textContent: '' };
  const tb = build({ node });
  const cases = [
    [
      { origin: 'https://a.example', mode: 'update', kind: 'login' },
      'Update password for a.example? Press F6 to respond.'
    ],
    [{ origin: 'https://a.example', mode: 'save', kind: 'card' }, 'Save card for a.example? Press F6 to respond.'],
    [
      { origin: 'https://a.example', mode: 'update', kind: 'identity', changedFields: [] },
      'Add to your identity for a.example? Press F6 to respond.'
    ],
    [{ origin: 'https://a.example', mode: 'save', kind: 'card' }, 'Save card for a.example? Press F6 to respond.']
  ];
  for (const [model, text] of cases) {
    await tb.client.present({ ...ENTRY, model });
    assert.equal(node.textContent, '');
    t.mock.timers.tick(30);
    assert.equal(node.textContent, text);
  }
  delete globalThis.ResizeObserver;
});

test('Leg 3 AC7: result-only presentations and refused opens write nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const node = { textContent: 'untouched' };
  let tb = build({ node });
  await tb.client.present({ ...ENTRY, model: { result: 'unchanged' } });
  t.mock.timers.tick(100);
  assert.equal(node.textContent, 'untouched');
  tb = build({ node, answer: { presented: false, reason: 'sheet-open' } });
  await tb.client.present(ENTRY);
  t.mock.timers.tick(100);
  assert.equal(node.textContent, 'untouched');
  delete globalThis.ResizeObserver;
});
