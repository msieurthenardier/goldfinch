'use strict';

// Unit tests for the vault-picker sheet template (Mission 12, Flight 2, Leg 3
// pick-and-fill, DD5/DD6). The card + rows are built by the pure, document-injected
// buildVaultPickerCard / renderVaultPickerRows so the structure/aria contract AND
// the id↔index mapping are testable against the fake-document helper without a live
// sheet — the same idiom vault-unlock-template.test.js uses. Behavior (roving,
// selection → sendActivatedOnce) is wired in menu-overlay.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const {
  buildVaultPickerCard, renderVaultPickerRows, pickId, parsePickIndex, badgeLabelFor,
} = require('../../src/shared/vault-picker-template.js');

test('buildVaultPickerCard is a centered backdrop + a role="menu" card', () => {
  const document = createDocument();
  const { node, card } = buildVaultPickerCard(document);
  assert.equal(node.id, 'sheet-vault-picker');
  assert.equal(node.classList.contains('hidden'), true);
  assert.equal(card.attributes.get('role'), 'menu');
  assert.equal(card.attributes.get('aria-label'), 'Choose a saved login to fill');
  assert.equal(card.tabIndex, -1);
  assert.equal(card.parentNode, node);
});

test('renderVaultPickerRows: badged rows (title + dimmed username + source-vault badge), index-stamped', () => {
  const document = createDocument();
  const { card } = buildVaultPickerCard(document);
  const model = [
    { vaultId: 'global', id: 'i1', title: 'GitHub', username: 'me@a', hasTotp: false },
    { vaultId: 'work', id: 'i2', title: 'Jira', username: 'w@a', hasTotp: true, badgeLabel: 'Work' },
  ];
  const rows = renderVaultPickerRows(document, card, model);

  assert.equal(rows.length, 2);
  // Each row is a role=menuitem button, non-focusable by default (roving assigns tabindex).
  rows.forEach((btn, i) => {
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.attributes.get('role'), 'menuitem');
    assert.equal(btn.tabIndex, -1);
    assert.equal(btn.dataset.pickIndex, String(i));
  });
  // Row 0 (global): title + username + "Global" badge.
  const [title0, user0, badge0] = rows[0].children;
  assert.equal(title0.textContent, 'GitHub');
  assert.equal(title0.className, 'vault-picker-title');
  assert.equal(user0.textContent, 'me@a');
  assert.equal(user0.className, 'vault-picker-username');
  assert.equal(badge0.textContent, 'Global');
  assert.equal(badge0.className, 'vault-picker-badge');
  // Row 1 (work): the enriched jar name badge.
  assert.equal(rows[1].children[2].textContent, 'Work');

  // METADATA ONLY: nothing on the rows carries a password (there is no password in
  // the model; assert no leakage even if one slipped into an unexpected field).
  assert.ok(!JSON.stringify(model).includes('password'));
});

test('renderVaultPickerRows: empty model → a single non-focusable note, returns []', () => {
  const document = createDocument();
  const { card } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, card, []);
  assert.deepEqual(rows, []);
  assert.equal(card.children.length, 1);
  const note = card.children[0];
  assert.equal(note.textContent, 'No saved logins for this site');
  assert.equal(note.attributes.get('aria-disabled'), 'true');
  // A note is not a menuitem → the roving items getter excludes it (no role).
  assert.equal(note.attributes.has('role'), false);
});

test('renderVaultPickerRows replaces prior content on re-render', () => {
  const document = createDocument();
  const { card } = buildVaultPickerCard(document);
  renderVaultPickerRows(document, card, [{ vaultId: 'global', id: 'i1', title: 'A', username: 'a' }]);
  const rows = renderVaultPickerRows(document, card, [{ vaultId: 'global', id: 'i2', title: 'B', username: 'b' }]);
  assert.equal(rows.length, 1);
  assert.equal(card.children.length, 1);
  assert.equal(rows[0].children[0].textContent, 'B');
});

test('row falls back to username, then "Login", when title is absent', () => {
  const document = createDocument();
  const { card } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, card, [
    { vaultId: 'global', id: 'i1', username: 'only-user@a' },
    { vaultId: 'global', id: 'i2' },
  ]);
  assert.equal(rows[0].children[0].textContent, 'only-user@a');
  assert.equal(rows[1].children[0].textContent, 'Login');
});

test('pickId / parsePickIndex round-trip; the id→index mapping is the dispatch contract', () => {
  for (const i of [0, 1, 7, 42]) {
    assert.equal(pickId(i), 'pick:' + i);
    assert.equal(parsePickIndex(pickId(i)), i);
  }
  // Defensive: a foreign / malformed id maps to no row (null), never NaN-indexing.
  assert.equal(parsePickIndex('sug:0'), null);
  assert.equal(parsePickIndex('pick:'), null);
  assert.equal(parsePickIndex('pick:-1'), null);
  assert.equal(parsePickIndex('pick:x'), null);
  assert.equal(parsePickIndex(undefined), null);
  assert.equal(parsePickIndex('create'), null);
});

test('badgeLabelFor: Global for the global vault, jar name (or vaultId) otherwise', () => {
  assert.equal(badgeLabelFor({ vaultId: 'global' }), 'Global');
  assert.equal(badgeLabelFor({ vaultId: 'work', badgeLabel: 'Work' }), 'Work');
  assert.equal(badgeLabelFor({ vaultId: 'work' }), 'work'); // fallback to the raw id
});
