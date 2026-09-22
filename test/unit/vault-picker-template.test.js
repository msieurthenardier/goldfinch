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
  buildVaultPickerCard,
  renderVaultPickerRows,
  pickId,
  parsePickIndex,
  badgeLabelFor,
  MANAGE_ID,
  GENERATE_ID,
  UNLOCK_ID,
  activationIdFor
} = require('../../src/shared/vault-picker-template.js');

// Row layout: [icon(svg), text(title+username), badges(chicklet [+ widened])].
const iconOf = (row) => row.children[0];
const textOf = (row) => row.children[1];
const titleOf = (row) => textOf(row).children[0];
const usernameOf = (row) => textOf(row).children[1];
const badgesOf = (row) => row.children[2];
const chickletOf = (row) => badgesOf(row).children[0];
const chickletLabel = (row) => chickletOf(row).children[chickletOf(row).children.length - 1].textContent;
// The Manage-passwords footer is the last focusable item returned; the card holds a
// separator immediately before it.
const manageBtn = (rows) => rows[rows.length - 1];

test('buildVaultPickerCard: centered backdrop + header (title + close) over a role="menu" list', () => {
  const document = createDocument();
  const { node, card, list, close } = buildVaultPickerCard(document);
  assert.equal(node.id, 'sheet-vault-picker');
  assert.equal(node.classList.contains('hidden'), true);
  assert.equal(card.parentNode, node);
  // The menu semantics live on the roving LIST host (moved off the card so the fixed header
  // is not a menuitem and does not scroll away).
  assert.equal(list.attributes.get('role'), 'menu');
  assert.equal(list.attributes.get('aria-label'), 'Choose a saved item to fill');
  assert.equal(list.tabIndex, -1);
  assert.equal(list.parentNode, card);
  // A fixed header: a title + an accessible close (X) button.
  const header = card.children[0];
  assert.equal(header.className, 'vault-sheet-header');
  assert.equal(header.children[0].className, 'vault-sheet-title');
  assert.equal(header.children[0].textContent, 'Fill from vault');
  assert.equal(close.tagName, 'BUTTON');
  assert.equal(close.attributes.get('aria-label'), 'Close');
});

test('renderVaultPickerRows: icon + stacked title/username + source-vault chicklet, index-stamped', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const model = [
    { vaultId: 'global', id: 'i1', title: 'GitHub', username: 'me@a', hasTotp: false },
    { vaultId: 'work', id: 'i2', title: 'Jira', username: 'w@a', hasTotp: true, badgeLabel: 'Work' }
  ];
  const rows = renderVaultPickerRows(document, list, model);

  // Two credential rows + the Manage-passwords footer (always appended).
  assert.equal(rows.length, 3);
  const credRows = rows.slice(0, 2);
  // Each credential row is a role=menuitem button, non-focusable by default (roving
  // assigns tabindex), with the index stamped on data-pick-index.
  credRows.forEach((btn, i) => {
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.attributes.get('role'), 'menuitem');
    assert.equal(btn.tabIndex, -1);
    assert.equal(btn.dataset.pickIndex, String(i));
  });

  // Icon-left: a decorative inline SVG (built via createElementNS), aria-hidden, no
  // remote favicon. Same glyph on every row.
  credRows.forEach((btn) => {
    const icon = iconOf(btn);
    assert.equal(icon.tagName, 'SVG');
    assert.equal(icon.attributes.get('class'), 'vault-picker-icon');
    assert.equal(icon.attributes.get('aria-hidden'), 'true');
    assert.ok(icon.children.length >= 1); // path/rect geometry
  });

  // Row 0 (global): stacked title + username; the source-vault chicklet reads "Global".
  assert.equal(titleOf(rows[0]).textContent, 'GitHub');
  assert.equal(titleOf(rows[0]).className, 'vault-picker-title');
  assert.equal(usernameOf(rows[0]).textContent, 'me@a');
  assert.equal(usernameOf(rows[0]).className, 'vault-picker-username');
  assert.equal(chickletLabel(rows[0]), 'Global');
  // Row 1 (work): the enriched jar-name chicklet.
  assert.equal(chickletLabel(rows[1]), 'Work');

  // METADATA ONLY: nothing on the rows carries a password (there is no password in
  // the model; assert no leakage even if one slipped into an unexpected field).
  assert.ok(!JSON.stringify(model).includes('password'));
});

test('renderVaultPickerRows: jar-colored chicklet when badgeColor is present, neutral otherwise', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [
    { vaultId: 'work', id: 'i1', title: 'Jira', username: 'w@a', badgeLabel: 'Work', badgeColor: '#ff8800' },
    { vaultId: 'global', id: 'i2', title: 'GitHub', username: 'me@a' }, // Global → no color
    { vaultId: 'evil', id: 'i3', title: 'X', username: 'x', badgeLabel: 'Evil', badgeColor: 'url(javascript:alert(1))' } // unsafe → ignored
  ]);

  // Colored: the chicklet carries the -colored modifier and an inline-tinted dot.
  const chicklet0 = chickletOf(rows[0]);
  assert.ok(chicklet0.classList.contains('vault-picker-badge-colored'));
  const dot0 = chicklet0.children[0];
  assert.equal(dot0.className, 'vault-picker-badge-dot');
  assert.equal(dot0.style.backgroundColor, '#ff8800');

  // Global (no badgeColor): neutral chip — no -colored modifier, no dot.
  const chicklet1 = chickletOf(rows[1]);
  assert.ok(!chicklet1.classList.contains('vault-picker-badge-colored'));
  assert.equal(chicklet1.children.length, 1); // label only, no dot
  assert.equal(chickletLabel(rows[1]), 'Global');

  // Unsafe color (fails isSafeColor): treated as neutral, never reaches a style.
  const chicklet2 = chickletOf(rows[2]);
  assert.ok(!chicklet2.classList.contains('vault-picker-badge-colored'));
  assert.equal(chicklet2.children.length, 1);
});

test('renderVaultPickerRows: the widened (subdomain-match) badge still renders', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [
    { vaultId: 'global', id: 'i1', title: 'GitHub', username: 'me@a', widened: true }
  ]);
  const badges = badgesOf(rows[0]);
  // chicklet + widened badge.
  assert.equal(badges.children.length, 2);
  const widened = badges.children[1];
  assert.ok(widened.className.split(' ').includes('vault-picker-badge-widened'));
  assert.equal(widened.textContent, 'Subdomain match');
});

test('renderVaultPickerRows: a separated, focusable "Manage passwords" footer is always present', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [
    { vaultId: 'global', id: 'i1', title: 'GitHub', username: 'me@a' }
  ]);
  // The footer is the last returned focusable item (so roving reaches it by keyboard).
  const manage = manageBtn(rows);
  assert.equal(manage.tagName, 'BUTTON');
  assert.equal(manage.attributes.get('role'), 'menuitem');
  assert.equal(manage.tabIndex, -1);
  assert.equal(manage.dataset.manage, 'true');
  assert.equal(manage.dataset.pickIndex, undefined); // NOT a pick row
  assert.equal(manage.children[0].textContent, 'Manage passwords');

  // A divider separates it from the item rows: list = [row, separator, manage].
  const sep = list.children[list.children.length - 2];
  assert.equal(sep.attributes.get('role'), 'separator');
  assert.equal(sep.className, 'vault-picker-separator');
  assert.equal(list.children[list.children.length - 1], manage);

  // MANAGE_ID is the dispatch id the chrome routes to openVaultPage() — never a pick index.
  assert.equal(parsePickIndex(MANAGE_ID), null);
});

test('renderVaultPickerRows: empty model → non-focusable note + the Manage footer only', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, []);
  // Even with no logins, the footer is present so the operator can reach the vault page.
  assert.equal(rows.length, 1);
  assert.equal(manageBtn(rows).dataset.manage, 'true');
  // card = [note, separator, manage].
  assert.equal(list.children.length, 3);
  const note = list.children[0];
  assert.equal(note.textContent, 'No saved logins, cards, or identities to fill here');
  assert.equal(note.attributes.get('aria-disabled'), 'true');
  // A note is not a menuitem → the roving items getter excludes it (no role).
  assert.equal(note.attributes.has('role'), false);
});

test('renderVaultPickerRows replaces prior content on re-render', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  renderVaultPickerRows(document, list, [{ vaultId: 'global', id: 'i1', title: 'A', username: 'a' }]);
  const rows = renderVaultPickerRows(document, list, [{ vaultId: 'global', id: 'i2', title: 'B', username: 'b' }]);
  // One credential row + the footer; the card was fully rebuilt (row, separator, manage).
  assert.equal(rows.length, 2);
  assert.equal(list.children.length, 3);
  assert.equal(titleOf(rows[0]).textContent, 'B');
});

test('row falls back to username, then "Login", when title is absent', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [
    { vaultId: 'global', id: 'i1', username: 'only-user@a' },
    { vaultId: 'global', id: 'i2' }
  ]);
  assert.equal(titleOf(rows[0]).textContent, 'only-user@a');
  assert.equal(titleOf(rows[1]).textContent, 'Login');
});

test('NO password field anywhere in the rendered picker DOM', () => {
  const document = createDocument();
  const { node, list } = buildVaultPickerCard(document);
  renderVaultPickerRows(document, list, [
    { vaultId: 'global', id: 'i1', title: 'GitHub', username: 'me@a' },
    { vaultId: 'work', id: 'i2', title: 'Jira', username: 'w@a', badgeLabel: 'Work', badgeColor: '#0a0' }
  ]);
  // Walk the whole subtree; no input carries a password type, and no text/attr mentions
  // "password" (metadata only — the picker never holds a secret).
  const walk = (el, visit) => {
    visit(el);
    el.children.forEach((c) => walk(c, visit));
  };
  walk(node, (el) => {
    assert.notEqual((el.attributes.get('type') || '').toLowerCase(), 'password');
    assert.equal(el.tagName === 'INPUT', false);
    const text = (el.textContent || '').toLowerCase();
    if (el.children.length === 0) assert.ok(!text.includes('password') || text === 'manage passwords');
  });
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

// Mission 21 Flight 3 Leg 1 (sheet-type-dispatch) — pins added alongside the
// dispatch-table refactor. AC9: every test above this line is UNMODIFIED.

test('AC2: an unrecognised or absent type resolves as login, byte-identically', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [
    { vaultId: 'global', id: 'i1', type: 'note', title: undefined, username: undefined },
    { vaultId: 'global', id: 'i2', type: undefined, username: 'a@b' }
  ]);
  // Both rows render the login (credential) icon, not the card icon.
  const icon0 = iconOf(rows[0]);
  const icon1 = iconOf(rows[1]);
  assert.equal(icon0.attributes.get('class'), 'vault-picker-icon');
  assert.equal(icon1.attributes.get('class'), 'vault-picker-icon');
  // No brand/last4 fields → secondary is '' → falls all the way to the login
  // generic title, exactly like an unrecognised-type item always has.
  assert.equal(titleOf(rows[0]).textContent, 'Login');
  // Row 2 has a username → the secondary line (login shape, not the card shape).
  assert.equal(usernameOf(rows[1]).textContent, 'a@b');
});

test('AC3b: a null model entry alongside a card renders with NO section headings', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  renderVaultPickerRows(document, list, [null, { vaultId: 'global', id: 'i1', type: 'card', last4: '4242' }]);
  // No `.vault-picker-section` heading node anywhere in the list.
  const headings = list.children.filter((c) => c.className === 'vault-picker-section');
  assert.equal(headings.length, 0, 'a null entry must not flip the picker into sectioned rendering');
  // The null entry still renders as a login row (item || {} in the render loop).
  const nullRowIcon = iconOf(list.children[0]);
  assert.equal(nullRowIcon.attributes.get('class'), 'vault-picker-icon');
});

test('AC4: the empty-picker copy appears exactly once in the module source', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/shared/vault-picker-template.js'), 'utf8');
  const matches = src.match(/No saved logins, cards, or identities to fill here/g) || [];
  assert.equal(matches.length, 1);
});

// --- Generate-in-picker action rows (Mission 21, Flight 4, Leg 3, AC9/AC9b) ---

test('AC9: unlocked + canGenerate + zero saved items -> the Generate row AND the empty note both render', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [{ action: 'generate' }]);
  // buttons = [generateBtn, manageBtn].
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.actionId, GENERATE_ID);
  assert.equal(rows[0].dataset.pickIndex, undefined);
  assert.equal(rows[0].children[0].textContent, 'Generate strong password');
  // card = [note, generateBtn, separator, manageBtn].
  assert.equal(list.children.length, 4);
  assert.equal(list.children[0].textContent, 'No saved logins, cards, or identities to fill here');
  assert.equal(list.children[1], rows[0]);
});

test('AC9: locked -> Generate + Unlock rows and NO empty note', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const rows = renderVaultPickerRows(document, list, [{ action: 'generate' }, { action: 'unlock' }]);
  // buttons = [generateBtn, unlockBtn, manageBtn] — no note.
  assert.equal(rows.length, 3);
  assert.equal(rows[0].dataset.actionId, GENERATE_ID);
  assert.equal(rows[1].dataset.actionId, UNLOCK_ID);
  assert.equal(rows[1].children[0].textContent, 'Unlock to fill a saved login');
  // card = [generateBtn, unlockBtn, separator, manageBtn] — no note node.
  assert.equal(list.children.length, 4);
  for (const child of list.children) {
    assert.notEqual(child.textContent, 'No saved logins, cards, or identities to fill here');
  }
});

test('AC9: action rows sit under no section heading, even alongside real login+card items', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const model = [
    { action: 'generate' },
    { vaultId: 'global', id: 'i1', type: 'login', title: 'GitHub' },
    { vaultId: 'global', id: 'i2', type: 'card', last4: '4242' }
  ];
  renderVaultPickerRows(document, list, model);
  const headings = list.children.filter((c) => c.className === 'vault-picker-section');
  // Two distinct real kinds (login, card) -> sectioned, but the action row itself
  // triggers no heading of its own and never merges into either section.
  assert.equal(headings.length, 2);
  assert.equal(list.children[0].dataset.actionId, GENERATE_ID, 'the action row leads, before any heading');
});

test('AC9: item rows keep pick:<i> keyed to the FULL model array (action rows occupy earlier indices)', () => {
  const document = createDocument();
  const { list } = buildVaultPickerCard(document);
  const model = [{ action: 'generate' }, { vaultId: 'global', id: 'i1', title: 'GitHub' }];
  const rows = renderVaultPickerRows(document, list, model);
  // rows[1] is the real item row, at model index 1.
  assert.equal(rows[1].dataset.pickIndex, '1');
  assert.equal(rows[1].dataset.actionId, undefined);
});

test('AC9b: activationIdFor honours only GENERATE_ID/UNLOCK_ID as action ids; anything else falls through', () => {
  assert.equal(activationIdFor({ actionId: GENERATE_ID }), GENERATE_ID);
  assert.equal(activationIdFor({ actionId: UNLOCK_ID }), UNLOCK_ID);
  // An unrecognised data-action-id (never produced today, defensive) falls through
  // to the pick-index-or-MANAGE_ID rule rather than being honoured as an action.
  assert.equal(activationIdFor({ actionId: 'something-else', pickIndex: '3' }), pickId(3));
  assert.equal(activationIdFor({ actionId: 'something-else' }), MANAGE_ID);
  // The pre-existing binary rule, unchanged for rows with no actionId.
  assert.equal(activationIdFor({ pickIndex: '2' }), pickId(2));
  assert.equal(activationIdFor({}), MANAGE_ID);
  assert.equal(activationIdFor(undefined), MANAGE_ID);
});

test('AC9b: the dispatch chokepoint — without it, both action rows would have routed to MANAGE_ID (regression pin)', () => {
  // The naive pre-AC9b rule: pick-index-present ? pickId : MANAGE_ID.
  const naiveRule = (dataset) => {
    const pi = dataset && dataset.pickIndex;
    return pi != null && pi !== '' ? pickId(Number(pi)) : MANAGE_ID;
  };
  assert.equal(naiveRule({ actionId: GENERATE_ID }), MANAGE_ID, 'the naive rule mis-routes Generate');
  assert.notEqual(activationIdFor({ actionId: GENERATE_ID }), MANAGE_ID, 'the real helper does not');
});
