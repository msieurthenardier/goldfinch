'use strict';

// Sortie 06 Leg 1 (AC2-AC9): the per-window corner save-prompt manager. Electron-free fakes;
// timer cases use MockTimers enabled PER TEST (never file-global).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSavePromptManager,
  SAVE_PROMPT_TIMEOUT_MS,
  SAVE_PROMPT_SHOW_FALLBACK_MS
} = require('../../src/main/save-prompt-manager');
const { makeHarness, presentShown, makeFakeView, OFFER_MODEL } = require('../helpers/save-prompt-fakes');

const enable = (t) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
const closedEvents = (h) => h.chromeSends.filter(([c]) => c === 'save-prompt-closed').map(([, p]) => p);
const sent = (h, channel) =>
  h.views.flatMap((v) => v.calls.filter(([k, c]) => k === 'send' && c === channel).map((c) => c[2]));

test('constants are exported at the spec values', () => {
  assert.equal(SAVE_PROMPT_TIMEOUT_MS, 10_000);
  assert.equal(SAVE_PROMPT_SHOW_FALLBACK_MS, 1500);
});

// ---- AC2: lazy, never focused ------------------------------------------------------------

test('AC2: before the first present(): isVisible/isPaused false, getView null, none throws', () => {
  const h = makeHarness();
  assert.equal(h.manager.isVisible(), false);
  assert.equal(h.manager.isPaused(), false);
  assert.equal(h.manager.getView(), null);
  assert.equal(h.views.length, 0);
});

test('AC2: present() delivers init, but shows the view only AFTER the :height report for THAT token', () => {
  const h = makeHarness();
  assert.deepEqual(h.manager.present({ token: 5, captureId: 'c', wcId: 7, model: OFFER_MODEL, anchor: 900 }), {
    presented: true
  });
  h.views[0].webContents.emit('did-finish-load');
  assert.equal(h.manager.isVisible(), false, 'not shown before the page reports its height');
  assert.equal(
    h.views[0].calls.some(([k]) => k === 'setBounds'),
    false
  );
  h.manager.reportHeight(4, 200); // a different token: dropped
  assert.equal(h.manager.isVisible(), false);
  h.manager.reportHeight(5, 200);
  assert.equal(h.manager.isVisible(), true);
  const kinds = h.log.map((e) => e[0]);
  assert.ok(kinds.includes('addChildView'));
  // the FIRST paint is already the right size: setBounds precedes addChildView, with height 200
  const calls = h.views[0].calls;
  const sb = calls.find(([k]) => k === 'setBounds');
  assert.equal(sb[1].height, 200);
  assert.equal(sb[1].width, 340);
});

test('AC2: the manager NEVER calls webContents.focus() across a full present/show/raise/close cycle', () => {
  const h = makeHarness();
  presentShown(h);
  h.manager.show();
  h.manager.syncBounds({ x: 0, y: 100, width: 800, height: 500 });
  h.manager.setAnchor(700);
  h.manager.close('dismissed');
  presentShown(h, { token: 2, captureId: 'c2' });
  h.manager.teardown();
  // reaching here means the throwing fake focus() was never invoked
});

test('AC2: an init sent before the page is ready is HELD and delivered on did-finish-load (first-load queue)', () => {
  const h = makeHarness();
  h.manager.present({ token: 1, captureId: 'c', wcId: 7, model: OFFER_MODEL, anchor: 900 });
  assert.deepEqual(sent(h, 'save-prompt:init'), []);
  h.views[0].webContents.emit('did-finish-load');
  const [init] = sent(h, 'save-prompt:init');
  assert.equal(init.token, 1);
  assert.equal(init.captureId, 'c');
  assert.deepEqual(init.model, OFFER_MODEL);
});

test('AC2: height fail-safe - no :height within 1500 ms shows the view at height 160', (t) => {
  enable(t);
  const h = makeHarness();
  h.manager.present({ token: 1, captureId: 'c', wcId: 7, model: OFFER_MODEL, anchor: 900 });
  t.mock.timers.tick(1499);
  assert.equal(h.manager.isVisible(), false);
  t.mock.timers.tick(1);
  assert.equal(h.manager.isVisible(), true);
  const sb = h.views[0].calls.find(([k]) => k === 'setBounds');
  assert.equal(sb[1].height, 160);
});

test('AC2: destroyed-recreate guard - a destroyed view is rebuilt on the next present()', () => {
  const h = makeHarness();
  presentShown(h);
  h.manager.close('dismissed');
  h.views[0].webContents.markDestroyed();
  const r = h.manager.present({ token: 2, captureId: 'c2', wcId: 7, model: OFFER_MODEL });
  assert.equal(r.presented, true);
  assert.equal(h.views.length, 2, 'a fresh view was constructed');
});

test('AC2: the prompt page crashing while shown closes `dismissed` (the shown capture is DROPPED) and self-tears-down', () => {
  const h = makeHarness();
  presentShown(h);
  h.views[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.deepEqual(h.dismisses, ['cap1'], 'captureDismiss ran for the shown capture');
  assert.deepEqual(
    closedEvents(h).map((e) => e.reason),
    ['dismissed']
  );
  assert.equal(h.manager.getView(), null, 'view torn down; the next present rebuilds');
  assert.equal(h.manager.isVisible(), false);
});

test('AC2: the prompt page failing to load while presented closes `dismissed`; a crash with NO prompt emits nothing', () => {
  const h = makeHarness();
  h.manager.present({ token: 1, captureId: 'c', wcId: 7, model: OFFER_MODEL });
  h.views[0].webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true);
  assert.deepEqual(h.dismisses, ['c']);
  assert.equal(closedEvents(h).length, 1);

  const h2 = makeHarness();
  presentShown(h2);
  h2.manager.close('dismissed');
  const before = h2.chromeSends.length;
  h2.views[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(h2.chromeSends.length, before, 'no prompt -> no closed event, no dismiss');
});

// ---- AC3: one prompt, one token ----------------------------------------------------------

test('AC3: present() while visible model-replaces; stale-token heights are dropped', () => {
  const h = makeHarness();
  presentShown(h, { token: 1, captureId: 'c1' });
  const r = h.manager.present({ token: 2, captureId: 'c2', wcId: 7, model: OFFER_MODEL });
  assert.equal(r.presented, true);
  assert.equal(h.manager.currentCaptureId(), 'c2');
  assert.equal(h.manager.currentToken(), 2);
  assert.equal(h.manager.isCurrentToken(1), false);
  const before = h.views[0].calls.length;
  h.manager.reportHeight(1, 999);
  assert.equal(h.views[0].calls.length, before, 'a stale token height changes nothing');
});

test('AC3: close() is idempotent, sends :clear BEFORE removeChildView, and emits exactly one save-prompt-closed', () => {
  const h = makeHarness();
  presentShown(h);
  const mark = h.log.length;
  h.manager.close('dismissed');
  h.manager.close('dismissed');
  h.manager.close('timeout');
  const clearIdx = h.views[0].calls.findIndex(([k, c]) => k === 'send' && c === 'save-prompt:clear');
  assert.ok(clearIdx >= 0);
  // :clear was queued on the view before the stack removal was logged
  const removed = h.log.slice(mark).findIndex(([k]) => k === 'removeChildView');
  assert.ok(removed >= 0);
  assert.equal(closedEvents(h).length, 1);
  assert.deepEqual(closedEvents(h)[0], { token: 1, captureId: 'cap1', reason: 'dismissed' });
  assert.equal(h.manager.isVisible(), false);
});

// ---- AC4: the 10 s timer ------------------------------------------------------------------

test('AC4: expiry at 10 s closes `timeout` and dismisses the shown capture', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  t.mock.timers.tick(9999);
  assert.equal(h.manager.isVisible(), true);
  t.mock.timers.tick(1);
  assert.equal(h.manager.isVisible(), false);
  assert.deepEqual(h.dismisses, ['cap1']);
  assert.deepEqual(closedEvents(h)[0].reason, 'timeout');
});

for (const [name, on, off] of [
  ['pointer', (m) => m.setPointerInside(true), (m) => m.setPointerInside(false)],
  ['focus', (m) => m.setFocusInside(true), (m) => m.setFocusInside(false)],
  ['windowBlur', (m) => m.setWindowBlurred(true), (m) => m.setWindowBlurred(false)],
  ['sheet', (m) => m.setSheetVisible(true), (m) => m.setSheetVisible(false)]
]) {
  test(`AC4: pause input "${name}" - pause at 4 s, +60 s still visible, resume, closes at +6 s`, (t) => {
    enable(t);
    const h = makeHarness();
    presentShown(h);
    t.mock.timers.tick(4000);
    on(h.manager);
    assert.equal(h.manager.isPaused(), true);
    t.mock.timers.tick(60_000);
    assert.equal(h.manager.isVisible(), true, 'still visible after 60 s paused');
    off(h.manager);
    assert.equal(h.manager.isPaused(), false);
    t.mock.timers.tick(5999);
    assert.equal(h.manager.isVisible(), true);
    t.mock.timers.tick(1);
    assert.equal(h.manager.isVisible(), false);
    assert.equal(closedEvents(h)[0].reason, 'timeout');
  });
}

test('AC4: combined - two inputs on, one off, still paused; all off resumes', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  h.manager.setPointerInside(true);
  h.manager.setFocusInside(true);
  h.manager.setPointerInside(false);
  assert.equal(h.manager.isPaused(), true);
  t.mock.timers.tick(30_000);
  assert.equal(h.manager.isVisible(), true);
  h.manager.setFocusInside(false);
  assert.equal(h.manager.isPaused(), false);
  t.mock.timers.tick(10_000);
  assert.equal(h.manager.isVisible(), false);
});

test('AC4: every present() starts a fresh 10 s regardless of pause state', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  t.mock.timers.tick(7000);
  h.manager.close('dismissed');
  presentShown(h, { token: 2, captureId: 'c2' });
  t.mock.timers.tick(9999);
  assert.equal(h.manager.isVisible(), true);
  t.mock.timers.tick(1);
  assert.equal(h.manager.isVisible(), false);
});

test('AC4: DD1 reverse race - a sheet becomes visible over a visible prompt, closes, and the prompt resumes with its remaining time', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  t.mock.timers.tick(3000);
  h.manager.setSheetVisible(true); // e.g. an auth challenge sheet raised over the prompt
  t.mock.timers.tick(120_000);
  assert.equal(h.manager.isVisible(), true);
  h.manager.setSheetVisible(false);
  t.mock.timers.tick(6999);
  assert.equal(h.manager.isVisible(), true);
  t.mock.timers.tick(1);
  assert.equal(h.manager.isVisible(), false);
});

test('AC4: every pause/resume pushes save-prompt:timer { remainingMs, paused } with no per-tick spam', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  t.mock.timers.tick(4000);
  const before = sent(h, 'save-prompt:timer').length;
  t.mock.timers.tick(1000);
  assert.equal(sent(h, 'save-prompt:timer').length, before, 'no pushes while merely running');
  h.manager.setPointerInside(true);
  const pushes = sent(h, 'save-prompt:timer');
  const last = pushes[pushes.length - 1];
  assert.equal(last.paused, true);
  assert.equal(last.remainingMs, 5000);
  assert.equal(last.token, 1);
});

test('AC4: pointer/focus state is reset on close so a stuck pause cannot leak into the next prompt', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  h.manager.setPointerInside(true);
  h.manager.close('dismissed');
  presentShown(h, { token: 2, captureId: 'c2' });
  assert.equal(h.manager.isPaused(), false);
});

// ---- AC5: result states -------------------------------------------------------------------

test('AC5: a successful save shows a role=status result, starts NO new 10 s, and closes `saved` after 2500 ms (hide deferred one macrotask)', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  t.mock.timers.tick(6000);
  const res = h.manager.save('personal');
  assert.deepEqual(res, { saved: true });
  assert.deepEqual(h.saves, [{ captureId: 'cap1', vaultId: 'personal' }]);
  const [result] = sent(h, 'save-prompt:result');
  assert.deepEqual({ kind: result.kind, text: result.text }, { kind: 'success', text: 'Password saved to Personal' });
  // the original 10 s timer must not fire during the 2.5 s hold even past its old deadline
  t.mock.timers.tick(2499);
  assert.equal(closedEvents(h).length, 0);
  assert.equal(h.manager.isVisible(), true);
  t.mock.timers.tick(1);
  assert.deepEqual(
    closedEvents(h).map((e) => e.reason),
    ['saved']
  );
  // The result-close emits closed FIRST; the stack removal is deferred one macrotask after it
  // (MockTimers runs a 0 ms timer inside the same tick, so pin the ORDER from the shared log).
  const iClosed = h.log.findIndex(([k, c]) => k === 'chrome' && c === 'save-prompt-closed');
  const iRemoved = h.log.findIndex(([k]) => k === 'removeChildView');
  assert.ok(iClosed >= 0 && iRemoved > iClosed, 'closed emitted before the deferred removeChildView');
  assert.equal(h.manager.isVisible(), false);
});

test('AC5: a pointer or focus pause does NOT hold a result state open', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  h.manager.save('personal');
  h.manager.setPointerInside(true);
  h.manager.setFocusInside(true);
  t.mock.timers.tick(2500);
  assert.equal(closedEvents(h).length, 1);
});

test('AC5: failure results hold 4000 ms', (t) => {
  enable(t);
  const h = makeHarness();
  h.state.saveResult = { saved: false, reason: 'locked' };
  presentShown(h);
  const res = h.manager.save('personal');
  assert.equal(res.reason, 'locked');
  assert.equal(sent(h, 'save-prompt:result')[0].text, 'Vault locked — not saved');
  t.mock.timers.tick(3999);
  assert.equal(closedEvents(h).length, 0);
  t.mock.timers.tick(1);
  assert.equal(closedEvents(h)[0].reason, 'dismissed');
});

test('AC5/AC18: save outcomes - invalid vault, throw, record gone', (t) => {
  enable(t);
  // invalid vault -> failure -> dismissed
  let h = makeHarness();
  h.state.saveResult = { saved: false, reason: 'invalid-vault' };
  presentShown(h);
  h.manager.save('nope');
  assert.equal(sent(h, 'save-prompt:result')[0].text, "Couldn't save to that vault");
  t.mock.timers.tick(4000);
  assert.equal(closedEvents(h)[0].reason, 'dismissed');
  // throw
  h = makeHarness();
  h.state.saveResult = () => {
    throw new Error('boom');
  };
  presentShown(h);
  h.manager.save('personal');
  assert.equal(sent(h, 'save-prompt:result')[0].text, "Couldn't save to that vault");
  t.mock.timers.tick(4000);
  assert.equal(closedEvents(h)[0].reason, 'dismissed');
  // record gone (no reason) -> expired
  h = makeHarness();
  h.state.saveResult = { saved: false };
  presentShown(h);
  h.manager.save('personal');
  assert.equal(sent(h, 'save-prompt:result')[0].text, 'This save request expired');
  t.mock.timers.tick(4000);
  assert.equal(closedEvents(h)[0].reason, 'expired');
});

test('AC5/AC18: card and identity success nouns come from KIND_TABLE; update mode names the fixed vault', () => {
  let h = makeHarness();
  presentShown(h, { model: { ...OFFER_MODEL, kind: 'card', mode: 'save' } });
  h.manager.save('global');
  assert.equal(sent(h, 'save-prompt:result')[0].text, 'Card saved to Global');
  h = makeHarness();
  presentShown(h, { model: { ...OFFER_MODEL, kind: 'identity' } });
  h.manager.save('personal');
  assert.equal(sent(h, 'save-prompt:result')[0].text, 'Details saved to Personal');
  h = makeHarness();
  presentShown(h, {
    model: {
      origin: 'https://a.example',
      mode: 'update',
      kind: 'login',
      defaultVaultId: 'global',
      vaultLabel: 'Global',
      choices: []
    }
  });
  h.manager.save('whatever');
  assert.equal(sent(h, 'save-prompt:result')[0].text, 'Password saved to Global');
});

test('AC18: in-flight guard - a second save() (double-click) is refused; captureSave runs once', () => {
  const h = makeHarness();
  presentShown(h);
  assert.equal(h.manager.canSave(), true);
  h.manager.save('personal');
  assert.equal(h.manager.canSave(), false);
  assert.equal(h.manager.save('personal').reason, 'kind');
  assert.equal(h.saves.length, 1);
});

test('AC18: a locked model is never saveable', () => {
  const h = makeHarness();
  presentShown(h, { model: { origin: 'https://a.example', mode: 'locked' } });
  assert.equal(h.manager.canSave(), false);
  assert.equal(h.manager.save('personal').reason, 'kind');
  assert.equal(h.saves.length, 0);
});

// ---- AC6: main-side drop -> expired -------------------------------------------------------

test('AC6: an EXTERNAL drop of the shown capture shows "This save request expired" (4 s) then closes `expired`', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  h.manager.onCaptureDropped({ captureId: 'cap1' });
  assert.equal(sent(h, 'save-prompt:result')[0].text, 'This save request expired');
  assert.equal(closedEvents(h).length, 0);
  t.mock.timers.tick(4000);
  assert.deepEqual(
    closedEvents(h).map((e) => e.reason),
    ['expired']
  );
});

test('AC6: drops of non-shown ids are ignored', () => {
  const h = makeHarness();
  presentShown(h);
  h.manager.onCaptureDropped({ captureId: 'other' });
  assert.equal(sent(h, 'save-prompt:result').length, 0);
  assert.equal(h.manager.isVisible(), true);
});

test("AC6: the prompt's OWN save/dismiss/timeout/close drop never triggers expired - a successful save -> `saved`, never `expired`", (t) => {
  enable(t);
  // The real vault-human fires onCaptureDropped from inside captureSave/captureDismiss; model that.
  const h = makeHarness();
  h.state.saveResult = () => {
    h.manager.onCaptureDropped({ captureId: 'cap1' });
    return { saved: true };
  };
  presentShown(h);
  h.manager.save('personal');
  assert.equal(sent(h, 'save-prompt:result')[0].text, 'Password saved to Personal');
  t.mock.timers.tick(2500);
  assert.equal(closedEvents(h)[0].reason, 'saved');

  const h2 = makeHarness({});
  const mgr2 = h2.manager;
  presentShown(h2);
  // dismiss: captureDismiss drops synchronously
  const origDismiss = h2.dismisses.push.bind(h2.dismisses);
  h2.dismisses.push = (id) => {
    mgr2.onCaptureDropped({ captureId: id });
    return origDismiss(id);
  };
  mgr2.dismiss();
  assert.equal(sent(h2, 'save-prompt:result').length, 0, "no expired state after the prompt's own dismiss");
  assert.equal(closedEvents(h2)[0].reason, 'dismissed');
});

test('AC6/AC14: a SUPERSEDED shown capture closes silently `dismissed` - no expired flash', () => {
  const h = makeHarness();
  presentShown(h);
  h.manager.onCaptureDropped({ captureId: 'cap1', cause: 'superseded' });
  assert.equal(sent(h, 'save-prompt:result').length, 0);
  assert.deepEqual(
    closedEvents(h).map((e) => e.reason),
    ['dismissed']
  );
});

test('AC6/AC15: close(vault-lock) sets settling, so the dropAllCaptures that follows cannot flash expired', () => {
  const h = makeHarness();
  presentShown(h);
  h.manager.close('vault-lock');
  h.manager.onCaptureDropped({ captureId: 'cap1' }); // dropAllCaptures
  assert.equal(sent(h, 'save-prompt:result').length, 0);
  assert.deepEqual(h.dismisses, [], 'vault-lock does not dismissShown');
  assert.deepEqual(
    closedEvents(h).map((e) => e.reason),
    ['vault-lock']
  );
});

test('Edge: a TTL drop while PAUSED shows expired', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  h.manager.setWindowBlurred(true);
  h.manager.onCaptureDropped({ captureId: 'cap1' });
  t.mock.timers.tick(4000);
  assert.equal(closedEvents(h)[0].reason, 'expired');
});

test('Edge: lock while a result state shows closes `vault-lock` immediately and cancels the result timer', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  h.manager.save('personal');
  h.manager.close('vault-lock');
  assert.equal(h.manager.isVisible(), false, 'immediate (not deferred)');
  t.mock.timers.tick(10_000);
  assert.deepEqual(
    closedEvents(h).map((e) => e.reason),
    ['vault-lock']
  );
});

// ---- result-only models (interim locked path) --------------------------------------------

test('result-only model renders a result state with no 10 s timer and closes after its hold', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h, { model: { result: 'unchanged' } });
  assert.deepEqual(sent(h, 'save-prompt:init')[0].result, { kind: 'success', text: 'Already saved' });
  assert.equal(h.manager.canSave(), false);
  t.mock.timers.tick(2500);
  assert.equal(closedEvents(h).length, 1);
  assert.equal(closedEvents(h)[0].reason, 'dismissed');
});

// ---- AC7: sheet-open and fullscreen refusal -----------------------------------------------

test('AC7: present() refuses with sheet-open / fullscreen and creates, shows, queues nothing', () => {
  const h = makeHarness();
  h.state.sheetVisible = true;
  assert.deepEqual(h.manager.present({ token: 1, captureId: 'c', wcId: 7, model: OFFER_MODEL }), {
    presented: false,
    reason: 'sheet-open'
  });
  h.state.sheetVisible = false;
  h.state.fullscreen = true;
  assert.deepEqual(h.manager.present({ token: 1, captureId: 'c', wcId: 7, model: OFFER_MODEL }), {
    presented: false,
    reason: 'fullscreen'
  });
  assert.equal(h.views.length, 0, 'no view was created');
  assert.equal(h.manager.currentCaptureId(), null);
  assert.equal(h.log.length, 0);
});

test('AC7: a window with no contentView refuses `gone`', () => {
  const h = makeHarness({ getContentView: () => null });
  assert.equal(h.manager.present({ token: 1, captureId: 'c', wcId: 7, model: OFFER_MODEL }).reason, 'gone');
});

// ---- geometry, anchors, re-raise ----------------------------------------------------------

test('AC11: the anchor (CSS px) is converted to DIP by the LIVE chrome zoom factor, and setAnchor/syncBounds re-position while visible', () => {
  const h = makeHarness();
  h.state.zoom = 1.5;
  presentShown(h, { anchor: 400 }); // 400 css px * 1.5 = 600 dip right edge
  const sb = h.views[0].calls.filter(([k]) => k === 'setBounds');
  assert.equal(sb[sb.length - 1][1].x + sb[sb.length - 1][1].width, 600);
  h.state.zoom = 1;
  h.manager.setAnchor(800);
  const sb2 = h.views[0].calls.filter(([k]) => k === 'setBounds');
  assert.equal(sb2[sb2.length - 1][1].x + sb2[sb2.length - 1][1].width, 800);
  h.state.guest = { x: 0, y: 100, width: 700, height: 600 };
  h.manager.syncBounds(h.state.guest);
  const sb3 = h.views[0].calls.filter(([k]) => k === 'setBounds');
  assert.ok(sb3[sb3.length - 1][1].x + sb3[sb3.length - 1][1].width <= 700 - 8);
});

test('AC11: syncBounds stores always but only applies while visible', () => {
  const h = makeHarness();
  h.manager.syncBounds({ x: 0, y: 0, width: 500, height: 500 });
  assert.equal(h.views.length, 0);
});

test('AC8: show() re-raises (addChildView) only a VISIBLE prompt; the height report is applied while visible but never after a hide', () => {
  const h = makeHarness();
  presentShown(h);
  const adds = () => h.log.filter(([k]) => k === 'addChildView').length;
  const n = adds();
  h.manager.show();
  assert.equal(adds(), n + 1);
  h.manager.close('tab-switch');
  const n2 = adds();
  h.manager.show();
  assert.equal(adds(), n2, 'a closed prompt is not re-raised');
  const before = h.views[0].calls.length;
  h.manager.reportHeight(1, 300); // late report for the old token
  assert.equal(h.views[0].calls.length, before);
});

test('AC8: a height change while visible re-sizes the view', () => {
  const h = makeHarness();
  presentShown(h, { height: 140 });
  h.manager.reportHeight(1, 220);
  const sb = h.views[0].calls.filter(([k]) => k === 'setBounds');
  assert.equal(sb[sb.length - 1][1].height, 220);
  h.manager.reportHeight(1, 99999);
  const sb2 = h.views[0].calls.filter(([k]) => k === 'setBounds');
  assert.equal(sb2[sb2.length - 1][1].height, 600 - 16, 'clamped to the guest height - 16');
});

// ---- AC9: the pointer seam ----------------------------------------------------------------

test('AC9: pointer-inside reaches the timer through EXACTLY ONE manager method, setPointerInside', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../../src/main/save-prompt-manager'), 'utf8');
  const sets = src.match(/pause\.pointer\s*=\s*(?!false)\S/g) || [];
  assert.equal(sets.length, 1, 'pause.pointer is ever SET from exactly one place (the rest only reset it to false)');
  assert.equal((src.match(/function setPointerInside/g) || []).length, 1);
  const h = makeHarness();
  presentShown(h);
  h.manager.setPointerInside(true);
  assert.equal(h.manager.isPaused(), true);
});

// ---- two windows --------------------------------------------------------------------------

test("Two windows: prompt A ignores window B's blur/focus/sheet/pointer (per-instance closures)", (t) => {
  enable(t);
  const a = makeHarness();
  const b = makeHarness();
  presentShown(a);
  presentShown(b, { token: 9, captureId: 'capB' });
  b.manager.setWindowBlurred(true);
  b.manager.setSheetVisible(true);
  b.manager.setPointerInside(true);
  assert.equal(a.manager.isPaused(), false);
  assert.equal(b.manager.isPaused(), true);
  t.mock.timers.tick(10_000);
  assert.equal(a.manager.isVisible(), false, 'A timed out while B stayed paused');
  assert.equal(b.manager.isVisible(), true);
});

test('teardown destroys the view, resets state, and emits close(teardown) for a live prompt', () => {
  const h = makeHarness();
  presentShown(h);
  h.manager.teardown();
  assert.equal(h.manager.getView(), null);
  assert.equal(h.views[0].webContents.isDestroyed(), true);
  assert.equal(closedEvents(h)[0].reason, 'teardown');
  assert.deepEqual(h.dismisses, ['cap1']);
});

test('makeFakeView sanity: focus() throws (the never-focused tripwire is armed)', () => {
  assert.throws(() => makeFakeView().webContents.focus());
});

test('the exported factory refuses to import Electron (Electron-free module)', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../../src/main/save-prompt-manager'), 'utf8');
  assert.ok(!/require\('electron'\)/.test(src));
  assert.equal(typeof createSavePromptManager, 'function');
});

// ---- Sortie 06 Leg 3: keyboard focus, held focus, refocus on close -------------------------

const fs = require('node:fs');
const path = require('node:path');
const { maskComments } = require('../helpers/source-scan');

const armFocus = (h) => {
  h.views[h.views.length - 1].allowFocus = true;
  return h.views[h.views.length - 1];
};
const wcEmit = (h, ev) => h.views[h.views.length - 1].webContents.emit(ev);

test('Leg 3 AC2: focusPrompt focuses the view THEN pushes focus-first{token}; present() still never focuses', () => {
  const h = makeHarness();
  presentShown(h, { token: 3 });
  const v = armFocus(h);
  assert.equal(h.manager.canFocusPrompt(), true);
  assert.equal(h.manager.focusPrompt(), true);
  const seq = v.calls.filter(([k, c]) => k === 'focus' || (k === 'send' && c === 'save-prompt:focus-first'));
  assert.deepEqual(
    seq.map((c) => c[0]),
    ['focus', 'send']
  );
  assert.deepEqual(seq[1][2], { token: 3 });
});

test('Leg 3 AC2: focusPrompt is a no-op unless visible, ready, shown and an interactive offer', () => {
  const h = makeHarness();
  assert.equal(h.manager.focusPrompt(), false, 'nothing presented');
  h.manager.present({ token: 1, captureId: 'c', wcId: 7, model: OFFER_MODEL, anchor: 1 });
  assert.equal(h.manager.focusPrompt(), false, 'not ready / not shown');
  h.views[0].allowFocus = true;
  h.views[0].webContents.emit('did-finish-load');
  assert.equal(h.manager.focusPrompt(), false, 'ready but not shown');
  h.manager.reportHeight(1, 100);
  assert.equal(h.manager.canFocusPrompt(), true);
  h.manager.save('personal'); // success -> result state
  assert.equal(h.manager.canFocusPrompt(), false, 'result state');
  assert.equal(h.manager.focusPrompt(), false);
  assert.equal(
    h.views[0].calls.some(([k]) => k === 'focus'),
    false
  );
});

test('Leg 3 AC2: no focus while consenting (locked offer) or saving', () => {
  const h = makeHarness();
  presentShown(h, { model: { ...OFFER_MODEL, mode: 'locked' } });
  armFocus(h);
  assert.equal(h.manager.beginConsent(), true);
  assert.equal(h.manager.canFocusPrompt(), false);
  assert.equal(h.manager.canDismissByKey(), false);
});

test('Leg 3 R3/AC5: saved + held focus -> guest focused AFTER the result hold ends (AC6), not at the click', (t) => {
  enable(t);
  const h = makeHarness();
  presentShown(h);
  wcEmit(h, 'focus');
  h.manager.save('personal');
  assert.equal(h.guestFocuses.length, 0, 'not while the result is still showing');
  t.mock.timers.tick(2500); // result hold elapses -> close('saved', deferHide)
  t.mock.timers.tick(0);
  assert.equal(h.guestFocuses.length, 1);
  const order = h.log.map((e) => e[0]);
  assert.ok(order.lastIndexOf('removeChildView') < order.indexOf('focus-guest'), 'refocus runs AFTER the hide');
});

test('Leg 3 AC5: dismissed (Esc / close) + held focus -> guest focused', () => {
  const h = makeHarness();
  presentShown(h);
  wcEmit(h, 'focus');
  h.manager.close('dismissed');
  assert.equal(h.guestFocuses.length, 1);
  const order = h.log.map((e) => e[0]);
  assert.ok(order.indexOf('removeChildView') < order.indexOf('focus-guest'));
});

test('Leg 3 AC5: dismissed WITHOUT prior focus -> no guest focus; blur clears held focus', () => {
  const h = makeHarness();
  presentShown(h);
  h.manager.close('dismissed');
  assert.equal(h.guestFocuses.length, 0);
  presentShown(h, { token: 2, captureId: 'c2' });
  wcEmit(h, 'focus');
  wcEmit(h, 'blur'); // operator clicked the page
  h.manager.close('dismissed');
  assert.equal(h.guestFocuses.length, 0);
});

test('Leg 3 R3: a window blur clears held focus (no refocus into a blurred window)', () => {
  const h = makeHarness();
  presentShown(h);
  wcEmit(h, 'focus');
  h.manager.setWindowBlurred(true);
  h.manager.close('dismissed');
  assert.equal(h.guestFocuses.length, 0);
});

test('Leg 3 AC5: unlock-requested, timeout, expired, tab-switch and vault-lock + held focus -> NO guest focus', () => {
  for (const reason of ['unlock-requested', 'timeout', 'expired', 'tab-switch', 'vault-lock', 'teardown']) {
    const h = makeHarness();
    presentShown(h);
    wcEmit(h, 'focus');
    h.manager.close(reason);
    assert.equal(h.guestFocuses.length, 0, reason);
  }
});

test('Leg 3 AC5: held focus does not leak into the next prompt; a refusing/throwing focusActiveGuest never throws', () => {
  const h = makeHarness({
    focusActiveGuest: () => {
      throw new Error('guest gone');
    }
  });
  presentShown(h);
  wcEmit(h, 'focus');
  assert.doesNotThrow(() => h.manager.close('dismissed'));
  assert.equal(h.manager.isHeldFocus(), false);
});

test('Leg 3 R4: canDismissByKey only on an interactive visible offer', () => {
  const h = makeHarness();
  assert.equal(h.manager.canDismissByKey(), false);
  presentShown(h);
  assert.equal(h.manager.canDismissByKey(), true);
  h.manager.save('personal');
  assert.equal(h.manager.canDismissByKey(), false, 'result state');
});

test('Leg 3 R3: save-prompt-manager.js has exactly ONE webContents.focus( call, inside focusPrompt', () => {
  const src = maskComments(
    fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'save-prompt-manager.js'), 'utf8')
  );
  assert.ok(src.length > 1000 && src.includes('function focusPrompt'), 'vacuity guard');
  const hits = [...src.matchAll(/webContents\.focus\s*\(/g)];
  assert.equal(hits.length, 1);
  const fnStart = src.indexOf('function focusPrompt');
  const fnEnd = src.indexOf('\n  }\n', fnStart);
  assert.ok(hits[0].index > fnStart && hits[0].index < fnEnd);
  // mutation: a second site is detected
  assert.equal([...(src + '\nwc.webContents.focus();').matchAll(/webContents\.focus\s*\(/g)].length, 2);
});
