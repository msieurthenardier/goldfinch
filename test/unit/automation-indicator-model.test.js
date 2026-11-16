'use strict';

// Unit tests for the pure automation toolbar-indicator decision model (Flight 3,
// Leg 6 / HAT inline finding F7). Truth-table coverage of visibility, the
// enabled-jar-key count, and mode resolution (idle / jar / multi / admin),
// including the defense-in-depth color-safety and never-throw guarantees.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildAutomationIndicatorModel } = require('../../src/shared/automation-indicator-model');

const WORK = { id: 'work', color: '#2196f3' };
const PERSONAL = { id: 'personal', color: '#e91e63' };
const CONTAINERS = [WORK, PERSONAL];

// ---------------------------------------------------------------------------
// Visibility — >=1 ENABLED key (jar or admin), independent of live connections.
// ---------------------------------------------------------------------------

test('hidden when zero jar keys enabled and admin not enabled', () => {
  const model = buildAutomationIndicatorModel({ enabledJarKeyCount: 0, adminKeyEnabled: false });
  assert.deepEqual(model, { visible: false, count: 0, mode: 'idle', color: null, portMoved: false, portLine: null });
});

test('visible (idle) when >=1 jar key enabled, even with zero active connections', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    adminKeyEnabled: false,
    activeJarIds: [],
    containers: CONTAINERS
  });
  assert.equal(model.visible, true);
  assert.equal(model.count, 2);
  assert.equal(model.mode, 'idle');
  assert.equal(model.color, null);
});

test('visible (idle) when ONLY the admin key is enabled, count is 0 (never counts admin)', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 0,
    adminKeyEnabled: true,
    activeJarIds: [],
    adminActive: false
  });
  assert.deepEqual(model, { visible: true, count: 0, mode: 'idle', color: null, portMoved: false, portLine: null });
});

test('malformed/negative/non-integer enabledJarKeyCount clamps to 0, never throws', () => {
  assert.equal(buildAutomationIndicatorModel({ enabledJarKeyCount: -1, adminKeyEnabled: true }).count, 0);
  assert.equal(buildAutomationIndicatorModel({ enabledJarKeyCount: NaN, adminKeyEnabled: true }).count, 0);
  assert.equal(buildAutomationIndicatorModel({ enabledJarKeyCount: '3', adminKeyEnabled: true }).count, 0);
  assert.equal(buildAutomationIndicatorModel({ enabledJarKeyCount: 1.5, adminKeyEnabled: true }).count, 0);
});

test('missing input object entirely never throws (all-defaults hidden)', () => {
  assert.deepEqual(buildAutomationIndicatorModel(), {
    visible: false,
    count: 0,
    mode: 'idle',
    color: null,
    portMoved: false,
    portLine: null
  });
  assert.deepEqual(buildAutomationIndicatorModel(undefined), {
    visible: false,
    count: 0,
    mode: 'idle',
    color: null,
    portMoved: false,
    portLine: null
  });
});

// ---------------------------------------------------------------------------
// Mode: jar — exactly one distinct active (non-admin) jar with a resolvable color.
// ---------------------------------------------------------------------------

test("mode=jar with the active jar's color when exactly one distinct active jar resolves", () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    adminKeyEnabled: false,
    activeJarIds: ['work'],
    adminActive: false,
    containers: CONTAINERS
  });
  assert.deepEqual(model, { visible: true, count: 2, mode: 'jar', color: '#2196f3', portMoved: false, portLine: null });
});

test('duplicate active sessions on the SAME jar still resolve to a single distinct jar (mode=jar)', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    activeJarIds: ['work', 'work', 'work'],
    containers: CONTAINERS
  });
  assert.equal(model.mode, 'jar');
  assert.equal(model.color, '#2196f3');
});

test('a stale/unknown active jarId (not in containers) downgrades to mode=multi, never throws', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    activeJarIds: ['deleted-jar'],
    containers: CONTAINERS
  });
  assert.equal(model.mode, 'multi');
  assert.equal(model.color, null);
});

test('an active jar whose stored color fails isSafeColor downgrades to mode=multi (defense in depth)', () => {
  const hostile = { id: 'work', color: 'red;background:url(evil)' };
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 1,
    activeJarIds: ['work'],
    containers: [hostile]
  });
  assert.equal(model.mode, 'multi');
  assert.equal(model.color, null);
});

test('an active jar with a non-string color downgrades to mode=multi, never throws', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 1,
    activeJarIds: ['work'],
    containers: [{ id: 'work', color: null }]
  });
  assert.equal(model.mode, 'multi');
  assert.equal(model.color, null);
});

test('missing containers array with an active jar never throws (downgrades to multi)', () => {
  const model = buildAutomationIndicatorModel({ enabledJarKeyCount: 1, activeJarIds: ['work'] });
  assert.equal(model.mode, 'multi');
  assert.equal(model.color, null);
});

// ---------------------------------------------------------------------------
// Mode: multi — more than one distinct active (non-admin) jar → neutral, no color.
// ---------------------------------------------------------------------------

test('mode=multi (neutral, no color) when more than one distinct jar is active simultaneously', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    activeJarIds: ['work', 'personal'],
    containers: CONTAINERS
  });
  assert.deepEqual(model, { visible: true, count: 2, mode: 'multi', color: null, portMoved: false, portLine: null });
});

test('null/undefined/empty-string entries in activeJarIds are ignored when counting distinct jars', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 1,
    activeJarIds: ['work', null, undefined, ''],
    containers: CONTAINERS
  });
  assert.equal(model.mode, 'jar');
  assert.equal(model.color, '#2196f3');
});

// ---------------------------------------------------------------------------
// Mode: admin — the admin key is BOTH enabled AND currently active. Trumps jar
// activity even when jar connections are simultaneously live.
// ---------------------------------------------------------------------------

test('mode=admin (rainbow, no fixed color) when the admin key is enabled and active', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    adminKeyEnabled: true,
    adminActive: true,
    activeJarIds: [],
    containers: CONTAINERS
  });
  assert.deepEqual(model, { visible: true, count: 2, mode: 'admin', color: null, portMoved: false, portLine: null });
});

test('admin trumps a concurrently active single jar', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    adminKeyEnabled: true,
    adminActive: true,
    activeJarIds: ['work'],
    containers: CONTAINERS
  });
  assert.equal(model.mode, 'admin');
});

test('admin trumps concurrently active multiple jars', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 2,
    adminKeyEnabled: true,
    adminActive: true,
    activeJarIds: ['work', 'personal'],
    containers: CONTAINERS
  });
  assert.equal(model.mode, 'admin');
});

test('adminActive true but the admin key is NOT enabled never renders admin mode (falls through to jar/multi/idle)', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 1,
    adminKeyEnabled: false,
    adminActive: true,
    activeJarIds: ['work'],
    containers: CONTAINERS
  });
  assert.equal(model.mode, 'jar');
  assert.equal(model.color, '#2196f3');
});

test('admin enabled but NOT currently active, with no jar connections either, stays idle', () => {
  const model = buildAutomationIndicatorModel({
    enabledJarKeyCount: 1,
    adminKeyEnabled: true,
    adminActive: false,
    activeJarIds: [],
    containers: CONTAINERS
  });
  assert.equal(model.mode, 'idle');
});

// ---------------------------------------------------------------------------
// Mission 23 Flight 2, leg `port-and-permissions` (DD5): the moved-port note.
// ---------------------------------------------------------------------------

const KEYED = { enabledJarKeyCount: 1, adminKeyEnabled: false };

test('port: configured and bound differ -> portMoved and the line', () => {
  const m = buildAutomationIndicatorModel({ ...KEYED, port: { configured: 49707, bound: 49708 } });
  assert.equal(m.portMoved, true);
  assert.equal(m.portLine, 'Listening on 49708 — 49707 was in use');
});

test('port: equal -> no note', () => {
  const m = buildAutomationIndicatorModel({ ...KEYED, port: { configured: 49707, bound: 49707 } });
  assert.equal(m.portMoved, false);
  assert.equal(m.portLine, null);
});

test('port: not listening (bound null) -> no note', () => {
  const m = buildAutomationIndicatorModel({ ...KEYED, port: { configured: 49707, bound: null } });
  assert.equal(m.portMoved, false);
  assert.equal(m.portLine, null);
});

test('port: absent, null or malformed never throws and shows no note', () => {
  for (const port of [undefined, null, {}, { configured: 'x', bound: 5 }, { configured: 5 }, 'junk', 7]) {
    const m = buildAutomationIndicatorModel({ ...KEYED, port });
    assert.equal(m.portMoved, false);
    assert.equal(m.portLine, null);
  }
});

test('port: the note is carried in every visible mode, and absent when the indicator is hidden', () => {
  const port = { configured: 1, bound: 2 };
  assert.equal(buildAutomationIndicatorModel({ ...KEYED, port }).mode, 'idle');
  assert.equal(buildAutomationIndicatorModel({ ...KEYED, port, activeJarIds: ['a', 'b'] }).portMoved, true);
  assert.equal(
    buildAutomationIndicatorModel({ enabledJarKeyCount: 0, adminKeyEnabled: true, adminActive: true, port }).portMoved,
    true
  );
  const hidden = buildAutomationIndicatorModel({ enabledJarKeyCount: 0, adminKeyEnabled: false, port });
  assert.equal(hidden.visible, false);
  assert.equal(hidden.portMoved, false);
});
