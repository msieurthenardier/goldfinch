'use strict';

// Which sheet closes END a vault picker open (Mission 23 Flight 1, leg `vault-fill-trust`), plus the three
// facts that allowlist relies on, pinned against the real source: a successful unlock closes its sheet
// with `activated` (context kept), the unlock row replacing the picker closes it `superseded` (kept), and a
// vault lock closes with `vault-lock` (kept).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PICKER_MENU_TYPES,
  DISMISSAL_REASONS,
  dismissesPickerContexts
} = require('../../src/main/vault/picker-dismissal');
const { createMenuOverlayManager } = require('../../src/main/menu-overlay-manager');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the allowlists are exactly the stated ones (both halves explicit, never a denylist)', () => {
  assert.deepEqual([...PICKER_MENU_TYPES].sort(), ['vault-picker', 'vault-unlock']);
  assert.deepEqual([...DISMISSAL_REASONS].sort(), [
    'blur',
    'escape',
    'outside-click',
    'tab-close',
    'tab-hide',
    'tab-switch',
    'teardown'
  ]);
});

test('only a dismissal of a picker menu type drops contexts; activated / superseded / vault-lock never do', () => {
  for (const menuType of PICKER_MENU_TYPES)
    for (const reason of DISMISSAL_REASONS)
      assert.equal(dismissesPickerContexts(menuType, reason), true, `${menuType}/${reason}`);
  for (const menuType of PICKER_MENU_TYPES)
    for (const reason of ['activated', 'superseded', 'vault-lock', 'toggle', 'input-empty', '', undefined, 5])
      assert.equal(dismissesPickerContexts(menuType, reason), false, `${menuType}/${String(reason)}`);
  for (const menuType of [
    'kebab',
    'suggestions',
    'auth-basic',
    'cert-picker',
    'vault-set',
    'vault-stepup',
    'vault-import-unlock',
    'vault-recover',
    'downloads',
    'input-dialog',
    '',
    undefined,
    null
  ])
    for (const reason of DISMISSAL_REASONS)
      assert.equal(dismissesPickerContexts(menuType, reason), false, `${String(menuType)}/${reason}`);
});

function makeManager(onClosedLog) {
  const view = {
    webContents: { on() {}, isDestroyed: () => false, destroy() {}, focus() {}, send() {} },
    setBounds() {},
    setVisible() {}
  };
  const contentView = { addChildView() {}, removeChildView() {} };
  return createMenuOverlayManager({
    getContentView: () => contentView,
    createSheetView: () => view,
    onClosed: (info) => onClosedLog.push(info)
  });
}

test('the unlock row replacing the picker closes the picker `superseded` (a kept context); a dismissal reports its own reason', () => {
  const log = [];
  const m = makeManager(log);
  m.openMenu({ menuType: 'vault-picker', model: [], token: 1 });
  m.openMenu({ menuType: 'vault-unlock', model: [], token: 2 }); // the picker's Unlock row: the same-flow replacement
  assert.deepEqual(log.at(-1), { menuType: 'vault-picker', reason: 'superseded' });
  assert.equal(dismissesPickerContexts(log.at(-1).menuType, log.at(-1).reason), false);
  m.closeMenuOverlay('escape');
  assert.deepEqual(log.at(-1), { menuType: 'vault-unlock', reason: 'escape' });
  assert.equal(dismissesPickerContexts(log.at(-1).menuType, log.at(-1).reason), true);
  // A pick closes the picker `activated`: kept (the fill that follows consumes it).
  m.openMenu({ menuType: 'vault-picker', model: [], token: 3 });
  m.closeMenuOverlay('activated');
  assert.deepEqual(log.at(-1), { menuType: 'vault-picker', reason: 'activated' });
  assert.equal(dismissesPickerContexts(log.at(-1).menuType, log.at(-1).reason), false);
});

test('a vault lock never ends a picker open: the lock close is scoped away from both picker menu types (context kept)', () => {
  const { closesOnVaultLock } = require('../../src/shared/vault-blur-survival');
  for (const menuType of PICKER_MENU_TYPES) assert.equal(closesOnVaultLock(menuType), false, menuType);
  assert.equal(dismissesPickerContexts('vault-picker', 'vault-lock'), false);
  assert.equal(dismissesPickerContexts('vault-unlock', 'vault-lock'), false);
});

test('source pins: a successful unlock closes `activated`; every lock fans a `vault-lock` close; the model-replace emits `superseded`', () => {
  const overlay = read('src/main/register-overlay-ipc.js');
  assert.match(
    overlay,
    /const ok = await vaultUnlock\(buf\);\s*if \(ok\) rec\.sheet\.closeMenuOverlay\('activated', current\.token\);/,
    'unlock success closes its sheet with `activated`'
  );
  const main = read('src/main/main.js');
  assert.match(main, /rec\.sheet\?\.closeMenuOverlay\('vault-lock'\)/, 'every vault lock fans a vault-lock close');
  const manager = read('src/main/menu-overlay-manager.js');
  assert.match(
    manager,
    /onClosed\(\{ menuType: currentMenu\.menuType, reason: 'superseded' \}\)/,
    'model-replace reports superseded'
  );
});
