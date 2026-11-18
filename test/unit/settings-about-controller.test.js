'use strict';

// Unit tests for src/renderer/pages/settings-about-controller.js (sortie 09 leg
// `about-controller-and-dot`): the Settings -> About controller, against a hand-rolled fake DOM and a
// fake bridge (deferred promises, a rejectable settingsSet, handle-checked on/off pairs), with the real
// pure model injected — the vault-filter-controller.test.js precedent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const controllerUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/settings-about-controller.js')).href;
const modelUrl = pathToFileURL(path.join(__dirname, '../../src/shared/update-notice-model.js')).href;

class El {
  constructor(doc, id) {
    this.doc = doc;
    this.id = id;
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.attrs = new Map();
    this.listeners = new Map();
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k) {
    this.attrs.delete(k);
  }
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  fire(type) {
    for (const fn of this.listeners.get(type) || []) fn({ type });
  }
  focus() {
    // A hidden or disabled control cannot take focus (as in a real DOM).
    if (this.hidden) return;
    this.doc.activeElement = this;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setImmediate(r));

const NEWER = {
  current: '0.19.16',
  available: '0.20.0',
  releaseUrl: 'https://example.invalid/r',
  checkEnabled: true,
  downloadName: null,
  lastCheck: null,
  canCheck: true
};
const CLEAR = { ...NEWER, available: null, releaseUrl: null };

const DEFAULT_IDS = [
  'about-version',
  'about-update-status',
  'about-update-open',
  'update-check-enabled',
  'about-update-download',
  'about-update-hint'
];
const CHECK_IDS = [...DEFAULT_IDS, 'about-check-now', 'about-check-result', 'about-last-checked'];

async function setup({ ids = DEFAULT_IDS, bridgeOver = {}, noBridge = false, now = () => 5000 } = {}) {
  const { createAboutController } = await import(controllerUrl);
  const model = await import(modelUrl);
  const doc = { activeElement: null, els: new Map() };
  for (const id of ids) doc.els.set(id, new El(doc, id));
  doc.getElementById = (id) => doc.els.get(id) || null;
  const pagehide = [];
  const win = {
    addEventListener(type, fn, opts) {
      if (type === 'pagehide') pagehide.push({ fn, opts });
    }
  };
  const calls = [];
  const handles = { update: new Set(), settings: new Set() };
  let n = 0;
  const bridge = {
    updateGetState: deferred(),
    settingsGet: deferred(),
    updateOpenReleasePage: (...a) => {
      calls.push(['open', a]);
      return Promise.resolve();
    },
    updateDownload: (...a) => {
      calls.push(['download', a]);
      return Promise.resolve({ ok: true });
    },
    settingsSet: (...a) => {
      calls.push(['set', a]);
      return Promise.resolve();
    },
    onUpdateStateChanged(cb) {
      const h = ++n;
      handles.update.add(h);
      bridge.pushUpdate = cb;
      return h;
    },
    offUpdateStateChanged(h) {
      assert.ok(handles.update.delete(h), 'update handle known');
    },
    onSettingsChanged(cb) {
      const h = ++n;
      handles.settings.add(h);
      bridge.pushSettings = cb;
      return h;
    },
    offSettingsChanged(h) {
      assert.ok(handles.settings.delete(h), 'settings handle known');
    },
    ...bridgeOver
  };
  const stateD = bridge.updateGetState;
  const getD = bridge.settingsGet;
  if (stateD && typeof stateD.then !== 'function' && stateD.promise) bridge.updateGetState = () => stateD.promise;
  if (getD && typeof getD.then !== 'function' && getD.promise) bridge.settingsGet = () => getD.promise;
  createAboutController({
    document: doc,
    window: win,
    bridge: noBridge ? undefined : bridge,
    updateNoticeModel: model.updateNoticeModel,
    downloadResultHint: model.downloadResultHint,
    checkNowView: model.checkNowView,
    now,
    format: { time: (ms) => `T${ms}`, date: (ms) => `D${ms}` }
  });
  const el = (id) => doc.els.get(id);
  return { doc, el, bridge, stateD, getD, calls, pagehide, handles };
}

test('a missing bridge or core element is a no-op', async () => {
  const a = await setup({ noBridge: true });
  assert.equal(a.el('about-version').textContent, '');
  const b = await setup({ ids: DEFAULT_IDS.filter((i) => i !== 'update-check-enabled') });
  assert.equal(b.el('about-version').textContent, '');
  assert.equal(b.handles.update.size, 0);
});

test('the notice renders from a push and clears', async () => {
  const t = await setup();
  assert.equal(t.el('about-update-status').hidden, true);
  t.bridge.pushUpdate(NEWER);
  assert.equal(t.el('about-update-status').hidden, false);
  assert.equal(t.el('about-update-status').textContent, 'Version 0.20.0 is available.');
  assert.equal(t.el('about-update-open').hidden, false);
  assert.equal(t.el('about-update-open').textContent, 'View release notes');
  assert.match(t.el('about-update-open').getAttribute('aria-label'), /0\.20\.0/);
  t.bridge.pushUpdate(CLEAR);
  assert.equal(t.el('about-update-status').hidden, true);
  assert.equal(t.el('about-update-status').textContent, '');
  assert.equal(t.el('about-update-open').hidden, true);
  assert.equal(t.el('about-update-open').getAttribute('aria-label'), null);
});

test('the boot read renders when nothing was pushed and is dropped after a push', async () => {
  const t = await setup();
  t.stateD.resolve(NEWER);
  await flush();
  assert.equal(t.el('about-update-status').textContent, 'Version 0.20.0 is available.');
  const u = await setup();
  u.bridge.pushUpdate(CLEAR);
  u.stateD.resolve(NEWER); // older than the push
  await flush();
  assert.equal(u.el('about-update-status').hidden, true);
});

test('the hint override survives an unchanged push and clears when available / downloadName changes', async () => {
  const t = await setup();
  const withDl = { ...NEWER, downloadName: 'Goldfinch-Setup-0.20.0.exe' };
  t.bridge.pushUpdate(withDl);
  const hint = t.el('about-update-hint');
  const dl = t.el('about-update-download');
  assert.equal(dl.hidden, false);
  const normal = hint.textContent;
  dl.fire('click');
  await flush();
  assert.notEqual(hint.textContent, normal);
  const overridden = hint.textContent;
  t.bridge.pushUpdate({ ...withDl, lastCheck: { at: 1, outcome: 'newer' } });
  assert.equal(hint.textContent, overridden);
  t.bridge.pushUpdate({ ...withDl, available: '0.20.1', downloadName: 'Goldfinch-Setup-0.20.1.exe' });
  assert.equal(hint.textContent, normal);
  dl.fire('click');
  await flush();
  assert.notEqual(hint.textContent, normal);
  t.bridge.pushUpdate({ ...NEWER, available: '0.20.1', downloadName: null });
  assert.equal(hint.hidden, false);
  assert.notEqual(hint.textContent, overridden);
});

test('focus moves to the checkbox when the focused notice button hides', async () => {
  const t = await setup();
  t.bridge.pushUpdate(NEWER);
  t.el('about-update-open').focus();
  assert.equal(t.doc.activeElement, t.el('about-update-open'));
  t.bridge.pushUpdate(CLEAR);
  assert.equal(t.doc.activeElement, t.el('update-check-enabled'));
});

test('focus moves to the release-page button when only the download button hides', async () => {
  const t = await setup();
  t.bridge.pushUpdate({ ...NEWER, downloadName: 'Goldfinch-Setup-0.20.0.exe' });
  t.el('about-update-download').focus();
  t.bridge.pushUpdate(NEWER);
  assert.equal(t.doc.activeElement, t.el('about-update-open'));
});

test('the release-page and download clicks call the bridge with no arguments', async () => {
  const t = await setup();
  t.bridge.pushUpdate({ ...NEWER, downloadName: 'Goldfinch-Setup-0.20.0.exe' });
  t.el('about-update-open').fire('click');
  t.el('about-update-download').fire('click');
  await flush();
  assert.deepEqual(t.calls, [
    ['open', []],
    ['download', []]
  ]);
});

test('the checkbox follows the stored value, drops a stale boot read, and reverts on a rejected write', async () => {
  const t = await setup();
  const cb = t.el('update-check-enabled');
  t.getD.resolve(true);
  await flush();
  assert.equal(cb.checked, true);
  t.bridge.pushSettings({ updateCheckEnabled: false });
  assert.equal(cb.checked, false);
  // a rejected write reverts to the last known stored value
  const r = await setup({ bridgeOver: { settingsSet: () => Promise.reject(new Error('no')) } });
  r.getD.resolve(true);
  await flush();
  const rcb = r.el('update-check-enabled');
  rcb.checked = false; // the operator unticked it
  rcb.fire('change');
  await flush();
  assert.equal(rcb.checked, true);
  // a stale boot read after a push
  const s = await setup();
  s.bridge.pushSettings({ updateCheckEnabled: true });
  s.getD.resolve(false);
  await flush();
  assert.equal(s.el('update-check-enabled').checked, true);
  // a change writes the boolean
  const w = await setup();
  w.el('update-check-enabled').checked = true;
  w.el('update-check-enabled').fire('change');
  assert.deepEqual(w.calls, [['set', ['updateCheckEnabled', true]]]);
});

test('both subscriptions are removed with their own handles on pagehide', async () => {
  const t = await setup();
  assert.equal(t.pagehide.length, 2);
  assert.ok(t.pagehide.every((p) => p.opts && p.opts.once === true));
  for (const p of t.pagehide) p.fn();
  assert.equal(t.handles.update.size, 0);
  assert.equal(t.handles.settings.size, 0);
});

// ── Check now ────────────────────────────────────────────────────────────────────────────────

test('Check now: disabled until a state with canCheck arrives; Not checked yet shows', async () => {
  const t = await setup({ ids: CHECK_IDS });
  assert.equal(t.el('about-check-now').disabled, true);
  assert.equal(t.el('about-last-checked').textContent, 'Not checked yet');
  assert.equal(t.el('about-check-result').hidden, true);
  t.bridge.pushUpdate(CLEAR);
  assert.equal(t.el('about-check-now').disabled, false);
  t.bridge.pushUpdate({ ...CLEAR, canCheck: false });
  assert.equal(t.el('about-check-now').disabled, true);
  assert.equal(t.el('about-check-result').textContent, "Checking isn't available in this build.");
});

test('Check now: a press calls the bridge once with no arguments, shows Checking…, then the answer', async () => {
  const d = deferred();
  const seen = [];
  const t = await setup({
    ids: CHECK_IDS,
    bridgeOver: {
      updateCheckNow: (...a) => {
        seen.push(a);
        return d.promise;
      }
    }
  });
  t.bridge.pushUpdate(CLEAR);
  const btn = t.el('about-check-now');
  btn.focus();
  btn.fire('click');
  btn.fire('click'); // never twice concurrently
  assert.deepEqual(seen, [[]]);
  assert.equal(btn.disabled, true);
  assert.equal(t.el('about-check-result').textContent, 'Checking…');
  // a push while the press is awaiting renders Last checked; the result waits for the answer
  t.bridge.pushUpdate({ ...CLEAR, lastCheck: { at: 5000, outcome: 'current' } });
  assert.equal(t.el('about-last-checked').textContent, 'Last checked at T5000');
  assert.equal(t.el('about-check-result').textContent, 'Checking…');
  d.resolve({ outcome: 'current' });
  await flush();
  assert.equal(btn.disabled, false);
  assert.equal(t.el('about-check-result').textContent, "You're up to date.");
  assert.equal(t.doc.activeElement, btn);
  btn.fire('click'); // a later press is allowed
  assert.equal(seen.length, 2);
});

test('Check now: newer, too-soon and a rejected or odd answer', async () => {
  const answers = [
    () => Promise.resolve({ outcome: 'newer' }),
    () => Promise.resolve({ outcome: 'too-soon', retryAt: 1 }),
    () => Promise.reject(new Error('x')),
    () => Promise.resolve(null)
  ];
  const t = await setup({ ids: CHECK_IDS, bridgeOver: { updateCheckNow: () => answers.shift()() } });
  t.bridge.pushUpdate(NEWER);
  const r = t.el('about-check-result');
  t.el('about-check-now').fire('click');
  await flush();
  assert.equal(r.textContent, 'Found a newer version — see above.');
  t.el('about-check-now').fire('click');
  await flush();
  assert.equal(r.textContent, 'Checked moments ago — try again in a few seconds.');
  t.el('about-check-now').fire('click');
  await flush();
  assert.equal(r.textContent, "Couldn't check — try again later.");
  t.el('about-check-now').fire('click');
  await flush();
  assert.equal(r.textContent, "Couldn't check — try again later.");
});

test('Check now: a throwing bridge call shows the failed text and a missing method too', async () => {
  const t = await setup({
    ids: CHECK_IDS,
    bridgeOver: {
      updateCheckNow: () => {
        throw new Error('boom');
      }
    }
  });
  t.bridge.pushUpdate(CLEAR);
  t.el('about-check-now').fire('click');
  await flush();
  assert.equal(t.el('about-check-result').textContent, "Couldn't check — try again later.");
  assert.equal(t.el('about-check-now').disabled, false);
  const u = await setup({ ids: CHECK_IDS });
  u.bridge.pushUpdate(CLEAR);
  u.el('about-check-now').fire('click');
  await flush();
  assert.equal(u.el('about-check-result').textContent, "Couldn't check — try again later.");
});

test('Check now: Last checked re-renders from every push, with no press', async () => {
  const t = await setup({ ids: CHECK_IDS });
  t.bridge.pushUpdate({ ...CLEAR, lastCheck: { at: 4000, outcome: 'newer' } });
  assert.equal(t.el('about-last-checked').textContent, 'Last checked at T4000');
  t.bridge.pushUpdate({ ...CLEAR, lastCheck: { at: 4500, outcome: 'failed' } });
  assert.equal(t.el('about-last-checked').textContent, 'Last checked at T4500');
  assert.equal(t.el('about-check-result').hidden, true);
});

test('Check now: the button keeps focus across a push', async () => {
  const t = await setup({ ids: CHECK_IDS });
  t.bridge.pushUpdate(CLEAR);
  t.el('about-check-now').focus();
  t.bridge.pushUpdate(NEWER);
  t.bridge.pushUpdate(CLEAR);
  assert.equal(t.doc.activeElement, t.el('about-check-now'));
});

// ── a stale Check now answer goes when another check or the setting changes the state ─────────
async function pressSetup(first) {
  const d = deferred();
  const t = await setup({ ids: CHECK_IDS, bridgeOver: { updateCheckNow: () => d.promise } });
  t.bridge.pushUpdate({ ...NEWER, lastCheck: first });
  const r = t.el('about-check-result');
  t.el('about-check-now').fire('click');
  return { t, r, d };
}
const lc = (at, outcome = 'newer') => ({ at, outcome });

test('Check now answer: kept when its own push follows, cleared by a later check', async () => {
  const { t, r, d } = await pressSetup(lc(100));
  d.resolve({ outcome: 'newer' });
  await flush();
  assert.equal(r.textContent, 'Found a newer version — see above.');
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(200) });
  assert.equal(r.hidden, false, 'its own push (answer first) keeps it');
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(200) });
  assert.equal(r.hidden, false, 'a push for another reason keeps it');
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(300) });
  assert.equal(r.hidden, true, 'a newer lastCheck.at clears it');
  assert.equal(r.textContent, '');
});

test('Check now answer: kept when its own push comes first', async () => {
  const { t, r, d } = await pressSetup(lc(100));
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(200) });
  d.resolve({ outcome: 'newer' });
  await flush();
  assert.equal(r.hidden, false);
  assert.equal(r.textContent, 'Found a newer version — see above.');
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(200) });
  assert.equal(r.hidden, false);
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(400) });
  assert.equal(r.hidden, true);
});

test('Check now answer: too-soon refers to the check already on record', async () => {
  const { t, r, d } = await pressSetup(lc(100));
  d.resolve({ outcome: 'too-soon', retryAt: 1 });
  await flush();
  assert.equal(r.textContent, 'Checked moments ago — try again in a few seconds.');
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(100) });
  assert.equal(r.hidden, false);
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(500, 'current') });
  assert.equal(r.hidden, true);
});

test('Check now answer: cleared when the notice goes (the setting turned off)', async () => {
  const { t, r, d } = await pressSetup(lc(100));
  d.resolve({ outcome: 'newer' });
  await flush();
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(200) });
  assert.equal(r.hidden, false);
  t.bridge.pushUpdate({ ...CLEAR, checkEnabled: false, lastCheck: lc(200) });
  assert.equal(r.hidden, true);
  t.bridge.pushUpdate({ ...NEWER, lastCheck: lc(200) });
  assert.equal(r.hidden, true, 'turning it back on does not resurrect the answer');
});
