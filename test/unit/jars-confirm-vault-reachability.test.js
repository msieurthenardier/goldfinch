'use strict';

// M12 F4 Leg 6 — renderer reachability SMOKE for the jars Delete confirm's
// offer-export-first affordance. This leg owns the STRUCTURAL modal change (the copy
// branch + the "Export vault first" button + the widened focus cycle); the full
// interactive walkthrough + the axe/screen-reader a11y audit defer to the F5 HAT.
//
// Asserts here: (1) a vault-bearing delete renders the export button AND it is in the
// (3-element) focus cycle — keyboard-reachable; (2) a no-vault delete is the unchanged
// 2-element [confirm, cancel] modal with the static copy (byte-unchanged behavior).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDocument } = require('./helpers/jars-page-dom');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../../src/renderer/pages/jars-confirm-modal.js')
).href;

const DELETE_COPY = 'Deletes this jar and wipes its data.';
const DELETE_VAULT_COPY = 'This jar has a saved password vault — deleting it is permanent and unrecoverable.';

function findButton(root, label) {
  let found = null;
  const visit = (node) => {
    if (node.tagName === 'BUTTON' && node.textContent === label) found = node;
    node.children.forEach(visit);
  };
  visit(root);
  return found;
}

async function buildModal({ vaultPresent, exportVault }) {
  const { createConfirmModal } = await import(moduleUrl);
  const document = createDocument();
  document.body = document.createElement('body');
  document.body.ownerDocument = document;
  // The module reads the GLOBAL `document` (no injected-doc dep) — provide one for
  // the duration; node isolates each test file in its own process, so this is contained.
  globalThis.document = document;

  const ui = { mode: 'confirm', rowId: 'work', action: 'delete', vaultPresent };
  const dataActions = {
    delete: {
      copy: DELETE_COPY,
      run: async () => ({ ok: true }),
      okNote: '',
      failNote: "Couldn't delete jar",
      silentSuccess: true,
      vaultPresentCopy: DELETE_VAULT_COPY,
      exportVault: exportVault || (async () => ({ ok: true, path: '/x/vault.gfvaultbundle' }))
    }
  };
  const modal = createConfirmModal({
    dataActions,
    titles: { delete: 'Delete jar?' },
    getUi: () => ui,
    closeTransient: () => {},
    getSectionRefs: () => ({ dataButtons: new Map() }),
    setSectionStatus: () => {},
    fallbackFocusEl: document.createElement('button')
  });
  modal.update();
  const backdrop = document.body.children.find((c) => c.id === 'jars-confirm-backdrop');
  return { document, backdrop };
}

function pressTab(backdrop, { shift = false } = {}) {
  backdrop.dispatch('keydown', { key: 'Tab', shiftKey: shift, preventDefault() {} });
}

test('vault-bearing delete confirm renders the "Export vault first" button with permanence copy', async () => {
  const { backdrop } = await buildModal({ vaultPresent: true });
  assert.ok(!backdrop.hidden, 'the modal is open');
  const exportBtn = findButton(backdrop, 'Export vault first');
  assert.ok(exportBtn, 'the Export button is rendered');
  // The permanence copy replaces the static copy.
  let descText = null;
  const visit = (n) => { if (n.id === 'jars-confirm-desc') descText = n.textContent; n.children.forEach(visit); };
  visit(backdrop);
  assert.equal(descText, DELETE_VAULT_COPY);
});

test('the Export button is in the confirm focus cycle (3-element, keyboard-reachable)', async () => {
  const { document, backdrop } = await buildModal({ vaultPresent: true });
  const exportBtn = findButton(backdrop, 'Export vault first');
  const confirmBtn = findButton(backdrop, 'Confirm');
  const cancelBtn = findButton(backdrop, 'Cancel');
  // update() default-focuses Cancel (destructive-safe). Tab cycles [export, confirm, cancel].
  assert.equal(document.activeElement, cancelBtn, 'Cancel focused by default');
  pressTab(backdrop);                                   // cancel -> export (wraps to index 0)
  assert.equal(document.activeElement, exportBtn, 'Tab reaches the Export button');
  pressTab(backdrop);                                   // export -> confirm
  assert.equal(document.activeElement, confirmBtn);
  pressTab(backdrop);                                   // confirm -> cancel
  assert.equal(document.activeElement, cancelBtn);
});

test('the Export button reuses exportVault WITHOUT closing the modal and surfaces a locked vault honestly', async () => {
  // The modal never calls closeTransient from the export path by construction (Delete is
  // a separate explicit Confirm click). Assert the result line surfaces the locked message
  // and the modal stays open — a locked vault is never a faked success.
  const { backdrop } = await buildModal({ vaultPresent: true, exportVault: async () => ({ locked: true }) });
  const exportBtn = findButton(backdrop, 'Export vault first');
  exportBtn.dispatch('click', {});
  await new Promise((r) => setImmediate(r));
  assert.ok(!backdrop.hidden, 'the modal stays open after an export attempt');
  let noteFound = false;
  const visit = (n) => { if (typeof n.textContent === 'string' && n.textContent.includes('Unlock the vault')) noteFound = true; n.children.forEach(visit); };
  visit(backdrop);
  assert.ok(noteFound, 'a locked vault surfaces "unlock the vault to export", never a faked success');
});

test('no-vault delete confirm is the unchanged 2-element [confirm, cancel] modal with static copy', async () => {
  const { document, backdrop } = await buildModal({ vaultPresent: false });
  assert.equal(findButton(backdrop, 'Export vault first'), null, 'no Export button without a vault');
  const confirmBtn = findButton(backdrop, 'Confirm');
  const cancelBtn = findButton(backdrop, 'Cancel');
  // Static copy (unchanged).
  let descText = null;
  const visit = (n) => { if (n.id === 'jars-confirm-desc') descText = n.textContent; n.children.forEach(visit); };
  visit(backdrop);
  assert.equal(descText, DELETE_COPY);
  // 2-element cycle: cancel -> confirm -> cancel.
  assert.equal(document.activeElement, cancelBtn, 'Cancel focused by default');
  pressTab(backdrop);
  assert.equal(document.activeElement, confirmBtn);
  pressTab(backdrop);
  assert.equal(document.activeElement, cancelBtn);
});
