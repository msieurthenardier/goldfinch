'use strict';

// The sheet's arming axis (Mission 23 Flight 1, leg `vault-picker-controls`, DD7 as amended): the shared table,
// the timestamp gate inside the sheet's one-shot activation sender (fake clock), and source-scan pins on the
// sheet wiring (the table's types are real templates; every init goes through `begin` with the table's delay;
// the picker's row listener reaches the bridge only through the gated sender; dismissals bypass the sender).
// The unit DOM only fires `click`, so Enter / Space during arming and the inert style are `[by-eye]`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ARMING_DELAY_MS,
  VAULT_PICKER_ARMING_MS,
  CERT_PICKER_ARMING_MS,
  armingDelayFor
} = require('../../src/shared/sheet-arming.js');
const { createSheetReport } = require('../../src/shared/modal-card-controller.js');
const { maskComments } = require('../helpers/source-scan');

const ROOT = path.join(__dirname, '../..');
const SHEET_SRC = fs.readFileSync(path.join(ROOT, 'src/renderer/menu-overlay.js'), 'utf8');

function makeBridge() {
  const activated = [];
  const dismissed = [];
  return {
    activated,
    dismissed,
    sendActivated: (p) => activated.push(p),
    sendDismissed: (p) => dismissed.push(p)
  };
}
function makeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

// ---- the table -------------------------------------------------------------------------------

test('the table lists vault-picker and cert-picker at 500 ms and nothing else; unlisted and malformed types are zero', () => {
  assert.deepEqual({ ...ARMING_DELAY_MS }, { 'vault-picker': 500, 'cert-picker': 500 });
  assert.equal(armingDelayFor('cert-picker'), 500);
  assert.equal(CERT_PICKER_ARMING_MS, 500);
  assert.equal(VAULT_PICKER_ARMING_MS, 500);
  assert.equal(armingDelayFor('vault-picker'), 500);
  for (const t of ['kebab', 'vault-unlock', 'cert-override', 'auth-basic', 'constructor', '', undefined, null, 7]) {
    assert.equal(armingDelayFor(t), 0, String(t));
  }
  assert.ok(Object.isFrozen(ARMING_DELAY_MS));
});

test("drift guard: every listed menu type is a key of the sheet's private TEMPLATES table (source scan)", () => {
  const body = SHEET_SRC.match(/const TEMPLATES = \{([\s\S]*?)\n {2}\};/);
  assert.ok(body, 'the TEMPLATES table was found (a rename must retarget this scan, never pass vacuously)');
  const keys = new Set([...body[1].matchAll(/^\s*(?:'([a-z-]+)'|([a-z]+)):/gm)].map((m) => m[1] || m[2]));
  assert.ok(keys.size >= 20, `parsed ${keys.size} template keys`);
  for (const type of Object.keys(ARMING_DELAY_MS)) assert.ok(keys.has(type), `${type} is a sheet template`);
});

// ---- the gate --------------------------------------------------------------------------------

test('an activation during arming sends nothing and leaves the latch UNSET; the same activation after the delay sends once', () => {
  const bridge = makeBridge();
  const clock = makeClock();
  const report = createSheetReport(bridge, clock.now);
  report.begin(7, 500);
  assert.equal(report.sendActivatedOnce({ id: 'pick:0' }), false, 'swallowed while arming');
  assert.deepEqual(bridge.activated, []);
  assert.equal(report.sent, false, 'the one-shot latch is not set by a swallowed activation');
  clock.advance(499);
  assert.equal(report.sendActivatedOnce({ id: 'pick:0' }), false, 'still arming at 499 ms');
  clock.advance(1);
  assert.equal(report.sendActivatedOnce({ id: 'pick:0' }), true, 'armed at exactly the delay');
  assert.deepEqual(bridge.activated, [{ id: 'pick:0', token: 7 }]);
  assert.equal(report.sendActivatedOnce({ id: 'pick:1' }), false, 'one-shot after the first send');
  assert.equal(bridge.activated.length, 1);
});

test('a second begin (a model replace) re-arms; the delay restarts from that init', () => {
  const bridge = makeBridge();
  const clock = makeClock();
  const report = createSheetReport(bridge, clock.now);
  report.begin(7, 500);
  clock.advance(600);
  report.begin(8, 500); // same-menu-type replace: init goes through begin again
  assert.equal(report.sendActivatedOnce({ id: 'pick:0' }), false, 're-armed');
  clock.advance(500);
  assert.equal(report.sendActivatedOnce({ id: 'pick:0' }), true);
  assert.deepEqual(bridge.activated, [{ id: 'pick:0', token: 8 }]);
});

test('a zero (or omitted) delay activates immediately and a later non-armed begin clears a prior arming', () => {
  const bridge = makeBridge();
  const clock = makeClock();
  const report = createSheetReport(bridge, clock.now);
  report.begin(1);
  assert.equal(report.sendActivatedOnce({ id: 'a' }), true, 'omitted delay');
  report.begin(2, 0);
  assert.equal(report.sendActivatedOnce({ id: 'b' }), true, 'explicit zero delay');
  report.begin(3, 500);
  report.begin(4, 0); // opening a non-listed menu type right after a listed one
  assert.equal(report.sendActivatedOnce({ id: 'c' }), true, 'arming does not leak into the next open');
  assert.equal(bridge.activated.length, 3);
});

test('dismissals are never delayed: reportDismissed sends while still arming', () => {
  const bridge = makeBridge();
  const clock = makeClock();
  const report = createSheetReport(bridge, clock.now);
  report.begin(7, 500);
  report.lastStimulus = 'escape';
  report.reportDismissed();
  assert.deepEqual(bridge.dismissed, [{ reason: 'escape', token: 7 }]);
});

test('a swallowed activation does not stop a later dismissal either (nothing closed, latch free)', () => {
  const bridge = makeBridge();
  const clock = makeClock();
  const report = createSheetReport(bridge, clock.now);
  report.begin(7, 500);
  report.sendActivatedOnce({ id: 'pick:0' });
  report.reportDismissed();
  assert.equal(bridge.dismissed.length, 1);
});

// ---- the sheet wiring (source scans) -----------------------------------------------------------

test('every init goes through begin with the table delay (fresh open and replace alike)', () => {
  const begins = SHEET_SRC.match(/report\.begin\([^)]*\)/g) || [];
  assert.deepEqual(begins, ['report.begin(token, armingDelay)'], 'exactly one begin site, taking the delay');
  assert.match(SHEET_SRC, /const armingDelay = armingDelayFor\(menuType\);/);
});

test("the picker's row listener reaches the bridge only through the gated sender; nothing else calls the bridge for the picker", () => {
  const start = SHEET_SRC.indexOf('function renderPicker(model)');
  assert.ok(start > 0, 'renderPicker found');
  const end = SHEET_SRC.indexOf('attachBackdropPressGate({\n    node: pickerNode', start);
  assert.ok(end > start, 'end of the picker block found');
  const block = SHEET_SRC.slice(start, end);
  assert.match(block, /sendActivatedOnce\(\{ id \}\)/, 'the row listener uses the gated one-shot sender');
  assert.doesNotMatch(block, /window\.menuOverlay\.sendActivated|bridge\.sendActivated|menuOverlay\.send/);
  // The whole picker section of the file: no direct bridge activation call at all.
  const pickerSection = SHEET_SRC.slice(
    SHEET_SRC.indexOf('template: vault-picker'),
    SHEET_SRC.indexOf('template: cert-picker')
  );
  assert.doesNotMatch(pickerSection, /window\.menuOverlay\.sendActivated/);
});

test("the confirmation view's Cancel is a dismissal: it closes the picker with the 'escape' flavor and never calls the sender", () => {
  const m = SHEET_SRC.match(/if \(id === CONFIRM_CANCEL_ID\) \{([\s\S]*?)\n {8}\}/);
  assert.ok(m, 'the Cancel branch was found');
  assert.match(m[1], /report\.lastStimulus = 'escape'/);
  assert.match(m[1], /menuController\.close\(pickerEntry\)/);
  assert.doesNotMatch(m[1], /sendActivatedOnce/);
});

test("the picker's own open handler ignores the start index and focuses the list container (no sentinel, no focusItem)", () => {
  const start = SHEET_SRC.indexOf('const pickerEntry = sheet({');
  const end = SHEET_SRC.indexOf('// The cosmetic half of arming', start);
  const block = maskComments(SHEET_SRC.slice(start, end));
  assert.match(block, /onOpen\(\) \{/, 'onOpen takes no start index');
  assert.match(block, /pickerList\.focus\(\)/);
  assert.doesNotMatch(block, /focusItem|startIndex/);
  // ...and the init branch opens the picker with 0 whatever the payload said.
  assert.match(SHEET_SRC, /menuController\.open\(pickerEntry, 0\)/);
  assert.doesNotMatch(SHEET_SRC, /menuController\.open\(pickerEntry, typeof startIndex/);
});

test('the destination line is written on every picker init and the arming cosmetic timer is started there', () => {
  assert.match(
    SHEET_SRC,
    /setVaultPickerDestination\(picker, payload\.destination\);\s*startPickerArming\(armingDelay\);/
  );
});

test('the inert style hook is the one class the sheet toggles and the stylesheet defines', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/menu-overlay.css'), 'utf8');
  assert.match(css, /#sheet-vault-picker\.vault-picker-arming \.cm-item/);
  assert.match(SHEET_SRC, /pickerNode\.classList\.add\('vault-picker-arming'\)/);
  assert.match(SHEET_SRC, /pickerNode\.classList\.remove\('vault-picker-arming'\)/);
  // cosmetic only: the gate is the timestamp, so no listener reads the class
  assert.doesNotMatch(
    SHEET_SRC.replace(/pickerNode\.classList\.(add|remove)\('vault-picker-arming'\)/g, ''),
    /vault-picker-arming'\)\s*\)/
  );
});

test("the certificate picker's own open handler ignores the start index and focuses the list container (source scan)", () => {
  const start = SHEET_SRC.indexOf('const certPickerEntry = sheet({');
  const end = SHEET_SRC.indexOf('// Header close (X): a deliberate dismiss', start);
  assert.ok(start > 0 && end > start, 'the cert picker entry block was found');
  const block = maskComments(SHEET_SRC.slice(start, end));
  assert.match(block, /onOpen\(\) \{/, 'onOpen takes no start index');
  assert.match(block, /certPickerList\.focus\(\)/);
  assert.doesNotMatch(block, /focusItem|startIndex/);
  assert.match(SHEET_SRC, /menuController\.open\(certPickerEntry, 0\)/);
  assert.doesNotMatch(SHEET_SRC, /menuController\.open\(certPickerEntry, typeof startIndex/);
});

test("the certificate picker's Cancel row is a dismissal (escape reason), never the arming-gated sender (source scan)", () => {
  const start = SHEET_SRC.indexOf('function renderCertPicker(');
  const end = SHEET_SRC.indexOf('attachBackdropPressGate({', start);
  assert.ok(start > 0 && end > start, 'renderCertPicker was found');
  const block = maskComments(SHEET_SRC.slice(start, end));
  const cancel = block.match(/if \(id === CERT_CANCEL_ID\) \{([\s\S]*?)\n\s*return;\s*\n\s*\}/);
  assert.ok(cancel, 'a Cancel branch precedes the gated sender');
  assert.match(cancel[1], /report\.lastStimulus = 'escape'/);
  assert.match(cancel[1], /menuController\.close\(certPickerEntry\)/);
  assert.doesNotMatch(cancel[1], /sendActivatedOnce/);
  assert.ok(block.indexOf('id === CERT_CANCEL_ID') < block.indexOf('sendActivatedOnce({ id })'));
  // 'escape' resolves the pending request (RESOLUTION bucket, not OCCLUSION: no re-present)
  const auth = fs.readFileSync(path.join(__dirname, '../../src/main/auth-challenges.js'), 'utf8');
  assert.match(auth, /RESOLUTION_REASONS = new Set\(\[[^\]]*'escape'/);
  assert.doesNotMatch(auth.match(/OCCLUSION_REASONS = new Set\(\[[^\]]*\]/)[0], /escape/);
});
