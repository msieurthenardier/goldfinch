'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../src/shared/shields-isolation-model.js');
const { decideStartup, effectiveAfterRestartFromConfigured } = require('../../src/main/third-party-cookies');
const shields = require('../../src/main/shields');

const OVERRIDES = [null, 'disabled', 'enabled'];
const BOOLS = [false, true];

// Build the raw command-line switch values that make decideStartup report the override.
function flagsFor(override) {
  if (override === 'disabled') return { enableFeatures: '', disableFeatures: 'ForceThirdPartyCookieBlockingEnabled' };
  if (override === 'enabled') return { enableFeatures: 'ForceThirdPartyCookieBlockingEnabled', disableFeatures: '' };
  return { enableFeatures: '', disableFeatures: '' };
}

test('AC2 drift guard: ESM effectiveAfterRestart == decideStartup == CJS twin, every combination', () => {
  for (const enabled of BOOLS)
    for (const isolate of BOOLS)
      for (const override of OVERRIDES) {
        // pausedSites and unrelated keys must never affect the outcome.
        const cfg = { enabled, isolate, block: !enabled, pausedSites: ['example.test'], farble: false };
        const configured = shields.isolateConfigured(cfg);
        const viaStartup = decideStartup({ configured, ...flagsFor(override) });
        assert.equal(viaStartup.operatorOverride, override, 'flag builder matches the override');
        const label = JSON.stringify({ enabled, isolate, override });
        assert.equal(
          model.effectiveAfterRestart(cfg, override),
          viaStartup.isolateEffective,
          'ESM vs decideStartup ' + label
        );
        assert.equal(
          effectiveAfterRestartFromConfigured(configured, override),
          viaStartup.isolateEffective,
          'CJS vs decideStartup ' + label
        );
        assert.equal(
          model.effectiveAfterRestart({ ...cfg, pausedSites: [], block: true }, override),
          model.effectiveAfterRestart(cfg, override)
        );
      }
});

test('AC1 matrix: every (enabled, isolate, isolateEffective, override, paused) combination', () => {
  for (const enabled of BOOLS)
    for (const isolate of BOOLS)
      for (const isolateEffective of BOOLS)
        for (const operatorOverride of OVERRIDES)
          for (const paused of BOOLS) {
            const cfg = { enabled, isolate };
            const m = model.isolationModel({ cfg, isolateEffective, operatorOverride, paused });
            const after = model.effectiveAfterRestart(cfg, operatorOverride);
            const pending = after !== isolateEffective;
            const label = JSON.stringify({ enabled, isolate, isolateEffective, operatorOverride, paused });
            assert.equal(m.inForce, isolateEffective, label);
            assert.equal(m.restartPending, pending, label);
            assert.equal(m.pendingDirection, pending ? (after ? 'on' : 'off') : null, label);
            assert.equal(m.isolateRow.dim, !isolateEffective, label);
            assert.equal(m.isolateRow.showCount, isolateEffective, label);
            const note = pending
              ? after
                ? 'turns-on-after-restart'
                : 'stays-on-until-restart'
              : isolateEffective && paused
                ? 'browser-wide'
                : null;
            assert.equal(m.isolateRow.note, note, label);
            assert.equal(m.masterNote, !enabled && isolateEffective ? 'isolation-stays-on-until-restart' : null, label);
          }
});

test('AC1 named states', () => {
  const inForcePaused = model.isolationModel({
    cfg: { enabled: true, isolate: true },
    isolateEffective: true,
    operatorOverride: null,
    paused: true
  });
  assert.deepEqual(inForcePaused.isolateRow, { dim: false, showCount: true, note: 'browser-wide' });
  const offButInForce = model.isolationModel({ cfg: { enabled: true, isolate: false }, isolateEffective: true });
  assert.deepEqual(offButInForce.isolateRow, { dim: false, showCount: true, note: 'stays-on-until-restart' });
  const onNotInForce = model.isolationModel({ cfg: { enabled: true, isolate: true }, isolateEffective: false });
  assert.deepEqual(onNotInForce.isolateRow, { dim: true, showCount: false, note: 'turns-on-after-restart' });
  const operatorOff = model.isolationModel({
    cfg: { enabled: true, isolate: true },
    isolateEffective: false,
    operatorOverride: 'disabled'
  });
  assert.equal(operatorOff.restartPending, false, 'no permanent hint under --disable-features');
  const masterOff = model.isolationModel({ cfg: { enabled: false, isolate: true }, isolateEffective: true });
  assert.equal(masterOff.masterNote, 'isolation-stays-on-until-restart');
  assert.equal(masterOff.copy[masterOff.masterNote], model.COPY['isolation-stays-on-until-restart']);
});

test('model never throws on garbage and copy is frozen', () => {
  assert.doesNotThrow(() => model.isolationModel());
  assert.doesNotThrow(() => model.isolationModel({ cfg: null }));
  assert.doesNotThrow(() => model.restartControl(null));
  assert.equal(Object.isFrozen(model.COPY), true);
  assert.equal(model.effectiveAfterRestart(null, null), false);
});

test('restartControl: label, note and restoreSession copy per state', () => {
  assert.deepEqual(model.restartControl({ restartPending: false, confirming: true }), {
    hidden: true,
    confirming: false,
    label: 'Restart now',
    note: ''
  });
  const idle = model.restartControl({ restartPending: true, confirming: false, restoreSession: true });
  assert.equal(idle.hidden, false);
  assert.equal(idle.label, 'Restart now');
  assert.equal(idle.note, '');
  const confirm = model.restartControl({ restartPending: true, confirming: true, restoreSession: true });
  assert.equal(confirm.label, 'Restart Goldfinch');
  assert.equal(confirm.note, 'Goldfinch will close and reopen.');
  const noRestore = model.restartControl({ restartPending: true, confirming: true, restoreSession: false });
  assert.match(noRestore.note, /Open tabs won't be reopened\./);
  assert.notEqual(idle.label, confirm.label, 'accessible name differs between states');
});

test('restartConfirmReducer: transitions', () => {
  const r = model.restartConfirmReducer;
  assert.deepEqual(r({ confirming: false }, 'activate'), { confirming: true, invoke: false, consumeEscape: false });
  assert.deepEqual(r({ confirming: true }, 'activate'), { confirming: false, invoke: true, consumeEscape: false });
  assert.equal(r({ confirming: true }, 'escape').consumeEscape, true);
  assert.equal(r({ confirming: false }, 'escape').consumeEscape, false);
  for (const e of ['timeout', 'focus-out', 'reset']) assert.equal(r({ confirming: true }, e).confirming, false);
  assert.equal(r(null, 'activate').confirming, true);
});

test('createRestartConfirm: first activation confirms without invoking; second invokes; 6 s timeout reverts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const drain = () => new Promise((r) => setImmediate(r));
  const changes = [];
  let invoked = 0;
  const c = model.createRestartConfirm({ onInvoke: () => invoked++, onChange: (v) => changes.push(v) });
  c.activate();
  assert.equal(invoked, 0);
  assert.equal(c.isConfirming(), true);
  t.mock.timers.tick(5999);
  await drain();
  assert.equal(c.isConfirming(), true);
  t.mock.timers.tick(1);
  await drain();
  assert.equal(c.isConfirming(), false, '6 s timeout reverts');
  c.activate();
  c.activate();
  assert.equal(invoked, 1);
  assert.deepEqual(changes, [true, false, true, false]);
  // Escape: first reverts + is consumed, second is not.
  c.activate();
  assert.equal(c.escape(), true);
  assert.equal(c.escape(), false);
  // Focus leaving reverts; the timer is cleared (no stray revert later).
  c.activate();
  c.focusOut();
  assert.equal(c.isConfirming(), false);
});
