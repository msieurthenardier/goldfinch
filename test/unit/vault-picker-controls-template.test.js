'use strict';

// The picker template's additions for leg `vault-picker-controls` (Mission 23 Flight 1), on the pure template
// with the existing mock document: the destination node between header and list (textContent, capped,
// aria-describedby, every view), and the template's four CHOKE POINTS - `activationIdFor` reports each new
// action under its own id; the action-entry predicate recognises the new entries; the "nothing to fill here"
// note is not rendered in the warning or confirmation view; the "Manage passwords" footer is omitted from both.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const T = require('../../src/shared/vault-picker-template.js');
const {
  buildVaultPickerCard,
  renderVaultPickerRows,
  setVaultPickerDestination,
  destinationLineText,
  activationIdFor,
  MANAGE_ID,
  GENERATE_ID,
  UNLOCK_ID,
  CERTIFICATE_CONTINUE_ID,
  CONFIRM_FILL_ID,
  CONFIRM_CANCEL_ID,
  DESTINATION_MAX_CHARS
} = T;

const CERT_VIEW = [{ action: 'certificate-continue' }];
const CONFIRM_VIEW = [
  { action: 'confirm-summary', type: 'card', title: 'Visa', brand: 'Visa', last4: '4242' },
  { action: 'confirm-fill' },
  { action: 'confirm-cancel' }
];
const labels = (rows) => rows.map((r) => r.children[0].textContent);
const hasClass = (card, cls) => card.children.some((c) => c.className === cls);

// ---- destination -------------------------------------------------------------------------------

test('the destination node sits BETWEEN the header and the list; the list is described by it', () => {
  const document = createDocument();
  const picker = buildVaultPickerCard(document);
  const kids = picker.card.children;
  assert.equal(kids.length, 3, 'header, destination, list - the header structure itself is unchanged');
  assert.equal(kids[0].className, 'vault-sheet-header');
  assert.equal(kids[1], picker.destination);
  assert.equal(kids[2], picker.list);
  assert.equal(picker.destination.id, 'vault-picker-destination');
  assert.equal(picker.list.attributes.get('aria-describedby'), 'vault-picker-destination');
  assert.equal(kids[0].children.length, 2, 'the header still holds only title + close');
});

test('setVaultPickerDestination writes "Fill on <destination>" via textContent on every init and replaces the previous', () => {
  const document = createDocument();
  const picker = buildVaultPickerCard(document);
  setVaultPickerDestination(picker, 'example.com:8443');
  assert.equal(picker.destination.textContent, 'Fill on example.com:8443');
  setVaultPickerDestination(picker, 'http://localhost:3000');
  assert.equal(picker.destination.textContent, 'Fill on http://localhost:3000');
  setVaultPickerDestination(picker, undefined);
  assert.equal(picker.destination.textContent, '', 'no destination -> empty line');
  // Markup in a destination is text, never parsed: the node has no children.
  setVaultPickerDestination(picker, '<img src=x onerror=alert(1)>');
  assert.equal(picker.destination.children.length, 0);
  assert.equal(picker.destination.textContent, 'Fill on <img src=x onerror=alert(1)>');
});

test('a long destination keeps its final labels; short and at-cap hosts are unchanged', () => {
  const host = 'familiar.example.com.' + 'x'.repeat(200) + '.evil-registrable.test';
  const text = destinationLineText(host);
  assert.ok(text.endsWith('.evil-registrable.test'), text);
  assert.ok(text.includes('…'));
  assert.equal(text.length, 'Fill on '.length + DESTINATION_MAX_CHARS);
  assert.equal(destinationLineText('example.com'), 'Fill on example.com');
  const atCap = 'a'.repeat(DESTINATION_MAX_CHARS - 4) + '.com';
  assert.equal(destinationLineText(atCap), 'Fill on ' + atCap);
});

test('the destination is length-capped in the sheet', () => {
  const long = 'a'.repeat(500) + '.example';
  const text = destinationLineText(long);
  assert.equal(text.length, 'Fill on '.length + DESTINATION_MAX_CHARS);
  assert.ok(text.includes('…'));
  assert.equal(destinationLineText('x'.repeat(DESTINATION_MAX_CHARS)), 'Fill on ' + 'x'.repeat(DESTINATION_MAX_CHARS));
  assert.equal(destinationLineText(''), '');
  assert.equal(destinationLineText(42), '');
});

// ---- choke point 1: activationIdFor ---------------------------------------------------------------

test('choke point 1: activationIdFor reports each new action under its own id, never "manage passwords"', () => {
  assert.equal(activationIdFor({ actionId: CERTIFICATE_CONTINUE_ID }), CERTIFICATE_CONTINUE_ID);
  assert.equal(activationIdFor({ actionId: CONFIRM_FILL_ID }), CONFIRM_FILL_ID);
  assert.equal(activationIdFor({ actionId: CONFIRM_CANCEL_ID }), CONFIRM_CANCEL_ID);
  for (const id of [CERTIFICATE_CONTINUE_ID, CONFIRM_FILL_ID, CONFIRM_CANCEL_ID]) assert.notEqual(id, MANAGE_ID);
  // The two existing action ids and the pick-index / footer rules are unchanged.
  assert.equal(activationIdFor({ actionId: GENERATE_ID }), GENERATE_ID);
  assert.equal(activationIdFor({ actionId: UNLOCK_ID }), UNLOCK_ID);
  assert.equal(activationIdFor({ pickIndex: '3' }), 'pick:3');
  assert.equal(activationIdFor({}), MANAGE_ID);
  assert.equal(
    activationIdFor({ actionId: 'confirm-everything' }),
    MANAGE_ID,
    'an unknown action id is never honoured'
  );
});

// ---- choke point 2: the entry predicate ------------------------------------------------------------

test('choke point 2: the new entries are action entries - no pick index, no section heading, not an item row', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, CONFIRM_VIEW);
  for (const r of rows) assert.equal(r.dataset.pickIndex, undefined, 'no row carries a pick index');
  assert.ok(!hasClass(list, 'vault-picker-section'), 'no section heading is spawned');
  assert.ok(!hasClass(list, 'vault-picker-row'), 'no credential row is built from an action entry');
});

// ---- the two views ----------------------------------------------------------------------------------

test('the certificate warning view: a notice and ONE action; no items, no generate row, no note, no footer', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, CERT_VIEW);
  assert.equal(rows.length, 1, 'one focusable action');
  assert.equal(rows[0].dataset.actionId, CERTIFICATE_CONTINUE_ID);
  assert.equal(labels(rows)[0], 'Continue');
  assert.ok(hasClass(list, 'vault-picker-certificate'), 'the notice is rendered');
  assert.equal(list.children.find((c) => c.className === 'vault-picker-certificate').textContent, T.CERTIFICATE_NOTICE);
  // choke point 3 (note) and 4 (footer)
  assert.ok(!hasClass(list, 'cm-item vault-picker-note'), 'no "nothing to fill here" note');
  assert.ok(!list.children.some((c) => /vault-picker-note/.test(c.className)));
  assert.ok(!hasClass(list, 'vault-picker-separator'), 'no separator');
  assert.ok(!list.children.some((c) => c.dataset && c.dataset.manage), 'no Manage passwords footer');
  assert.ok(!rows.some((r) => r.dataset.manage));
});

test('the confirmation view: the item, the prompt, Fill and Cancel; no note, no footer', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, CONFIRM_VIEW);
  assert.deepEqual(
    rows.map((r) => r.dataset.actionId),
    [CONFIRM_FILL_ID, CONFIRM_CANCEL_ID]
  );
  assert.deepEqual(labels(rows), ['Fill', 'Cancel']);
  const summary = list.children.find((c) => c.className === 'vault-picker-confirm');
  assert.ok(summary, 'the summary block is rendered');
  assert.equal(summary.children[0].textContent, T.CONFIRM_PROMPT);
  assert.equal(summary.children[1].textContent, 'Visa', 'the title');
  assert.equal(summary.children[2].textContent, 'Visa  •••• 4242', "the row's non-secret secondary line");
  assert.ok(!list.children.some((c) => /vault-picker-note/.test(c.className)), 'no note');
  assert.ok(!hasClass(list, 'vault-picker-separator'));
  assert.ok(!rows.some((r) => r.dataset.manage), 'no footer');
  // Neither action is focused or pre-selected: roving tabindex starts at -1 everywhere.
  for (const r of rows) assert.equal(r.tabIndex, -1);
});

test('an identity summary shows its full name as the secondary line; a missing title falls back', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  renderVaultPickerRows(document, list, [
    { action: 'confirm-summary', type: 'identity', title: '', fullName: 'Ada Lovelace' },
    { action: 'confirm-fill' },
    { action: 'confirm-cancel' }
  ]);
  const summary = list.children.find((c) => c.className === 'vault-picker-confirm');
  assert.equal(summary.children[1].textContent, 'Ada Lovelace');
  assert.equal(summary.children[2].textContent, 'Ada Lovelace');
});

test('every ordinary view is unchanged: items keep the footer and the empty state keeps its note', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [
    { vaultId: 'global', id: 'i1', title: 'GitHub', username: 'me' }
  ]);
  assert.equal(rows.length, 2, 'one row + the footer');
  assert.ok(rows[1].dataset.manage);
  const empty = renderVaultPickerRows(document, list, []);
  assert.equal(empty.length, 1, 'footer only');
  assert.ok(
    list.children.some((c) => /vault-picker-note/.test(c.className)),
    'the note'
  );
  const locked = renderVaultPickerRows(document, list, [{ action: 'generate' }, { action: 'unlock' }]);
  assert.equal(locked.length, 3, 'generate, unlock, footer');
});
