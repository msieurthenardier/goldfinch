'use strict';

// Squawk 0058: source-contract pins for the sheet-side reason → copy mapping in
// src/renderer/menu-overlay.js (the downloads-popup-contract idiom — menu-overlay.js
// runs only inside the overlay webContents, so the mapping is pinned as a source
// contract; the live rendering is behavior-test territory). The collapse this squawk
// fixes: every step-up failure rendered as 'Wrong master password' — including a
// correct-password mint against a jar with no vault file, and a VaultBusyError while a
// compromise rotation held the re-key gate. The delegates (main.js) now forward
// NON-SECRET reasons and these sheet-side mappers branch the copy.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const js = fs.readFileSync(path.join(ROOT, 'src/renderer/menu-overlay.js'), 'utf8');

test('vault-stepup sheet: per-reason copy — busy → rotation-in-progress, state (mint mode) → no-vault, default → per-mode wrong-password', () => {
  assert.match(
    js,
    /function vaultStepupErrorCopy\(mode, reason\) \{[\s\S]*?if \(reason === 'busy'\) return 'A rotation is already in progress\.';[\s\S]*?if \(reason === 'state' && mode === 'mint'\) \{\s*return 'No vault for this jar yet — save an item into it first, then mint\.';\s*\}[\s\S]*?'Wrong master password\. The recovery key was not rotated\.'[\s\S]*?'Wrong master password\. The admin key was not rotated\.'[\s\S]*?'Wrong master password\. Nothing was minted\.';\s*\}/
  );
  // submitVaultStepup renders through the mapper with the forwarded reason.
  assert.match(js, /vaultStepup\.error\.textContent = vaultStepupErrorCopy\(mode, res && res\.reason\);/);
});

test('vault-change-master sheet: per-reason copy — busy → rotation-in-progress, default → wrong-current-password', () => {
  assert.match(
    js,
    /function vaultChangeMasterErrorCopy\(reason\) \{\s*if \(reason === 'busy'\) return 'A rotation is already in progress\.';\s*return 'Wrong current master password\. Nothing was changed\.';\s*\}/
  );
  assert.match(js, /vaultChangeMaster\.error\.textContent = vaultChangeMasterErrorCopy\(res && res\.reason\);/);
});

test('vault-recover sheet: per-reason copy — busy → rotation-in-progress, format/auth share the wrong-key copy', () => {
  assert.match(
    js,
    /function vaultRecoverErrorCopy\(reason\) \{\s*if \(reason === 'busy'\) return 'A rotation is already in progress\.';\s*return 'Wrong recovery key\. Nothing was changed\.';\s*\}/
  );
  assert.match(js, /vaultRecover\.error\.textContent = vaultRecoverErrorCopy\(res && res\.reason\);/);
});
