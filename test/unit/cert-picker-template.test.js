'use strict';

// Unit tests for the cert-picker sheet template (M14 F1 L3, flight DD4): the
// DOM/aria structure (roving role="menu" list, LABELED subject/issuer rows, a
// separated keyboard-reachable Cancel row) and the id↔index mapping — the pure,
// document-injected vault-picker-template.test idiom. This structural pin also
// stands in for the live axe sweep while the audit's sheet-state path is
// apparatus-blocked (the M12 finding-1 secret-sheet refusal — flight-log
// anomaly). Selection ROUTING (main-side, ledger-first) is pinned in
// register-overlay-ipc.test.js; this suite additionally cross-pins the id
// prefix literal against the registrar's local mirror so they cannot drift.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createDocument } = require('./helpers/jars-page-dom');
const {
  buildCertPickerCard,
  renderCertPickerRows,
  certPickId,
  parseCertPickIndex,
  CERT_PICK_PREFIX,
  CERT_CANCEL_ID,
} = require('../../src/shared/cert-picker-template.js');

const MODEL = [
  { subject: 'CN=Goldfinch Fixture Client', issuer: 'CN=Goldfinch Fixture Throwaway CA' },
  { subject: 'CN=Second Cert', issuer: 'CN=Another CA' },
];

test('cert-picker card: hidden backdrop + header (title + accessible close) + role="menu" roving list host', () => {
  const document = createDocument();
  const card = buildCertPickerCard(document);

  assert.equal(card.node.id, 'sheet-cert-picker');
  assert.equal(card.node.classList.contains('hidden'), true);
  assert.equal(card.card.parentNode, card.node);

  const [header, list] = card.card.children;
  assert.equal(header.className, 'vault-sheet-header');
  assert.equal(header.children[0].textContent, 'Select a certificate');
  assert.equal(card.close.tagName, 'BUTTON');
  assert.equal(card.close.type, 'button');
  assert.equal(card.close.attributes.get('aria-label'), 'Close');

  assert.equal(list, card.list);
  assert.equal(list.attributes.get('role'), 'menu');
  assert.equal(list.attributes.get('aria-label'), 'Choose a certificate to present to this site');
  assert.equal(list.tabIndex, -1);
});

test('rows render subject + issuer via textContent, role="menuitem", index stamped on data-cert-index; Cancel row always appended after a separator', () => {
  const document = createDocument();
  const { list } = buildCertPickerCard(document);
  const items = renderCertPickerRows(document, list, MODEL);

  // Roving order: the two cert rows, then the Cancel row — all menuitems.
  assert.equal(items.length, 3);
  for (const btn of items) {
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.type, 'button');
    assert.equal(btn.attributes.get('role'), 'menuitem');
    assert.equal(btn.tabIndex, -1);
  }
  assert.equal(items[0].dataset.certIndex, '0');
  assert.equal(items[1].dataset.certIndex, '1');
  // Subject on the title line, issuer on the dimmed line (textContent only —
  // certificate metadata strings are never markup).
  const [text0] = items[0].children;
  assert.equal(text0.children[0].textContent, 'CN=Goldfinch Fixture Client');
  assert.equal(text0.children[1].textContent, 'CN=Goldfinch Fixture Throwaway CA');

  // The Cancel row: NOT an index row (no data-cert-index → the chrome reports
  // CERT_CANCEL_ID; main resolves cancel via the close), separated, labeled.
  const cancel = items[2];
  assert.equal(cancel.dataset.certIndex, undefined);
  assert.equal(cancel.dataset.certCancel, 'true');
  assert.equal(cancel.children[0].textContent, 'Continue without a certificate');
  const listChildren = list.children;
  assert.equal(listChildren[listChildren.length - 2].attributes.get('role'), 'separator');

  // Re-render replaces prior content (no row accumulation).
  const again = renderCertPickerRows(document, list, [MODEL[0]]);
  assert.equal(again.length, 2, 'one cert row + Cancel');
});

test('empty/absent-field models render defensively: note for [], "Certificate" fallback subject, empty issuer', () => {
  const document = createDocument();
  const { list } = buildCertPickerCard(document);
  // Empty model — defensive only (main never presents an empty candidate list):
  // a single non-focusable note; the Cancel row is still keyboard-reachable.
  const items = renderCertPickerRows(document, list, []);
  assert.equal(items.length, 1, 'only the Cancel row is focusable');
  assert.equal(list.children[0].attributes.get('aria-disabled'), 'true');
  assert.equal(list.children[0].textContent, 'No certificates available');

  const sparse = renderCertPickerRows(document, list, [{}]);
  const [text] = sparse[0].children;
  assert.equal(text.children[0].textContent, 'Certificate');
  assert.equal(text.children[1].textContent, '');
});

test('id↔index mapping: certPickId/parseCertPickIndex round-trip; malformed ids map to null, never a bogus index', () => {
  assert.equal(certPickId(0), 'cert:0');
  assert.equal(certPickId(12), 'cert:12');
  assert.equal(parseCertPickIndex('cert:0'), 0);
  assert.equal(parseCertPickIndex('cert:12'), 12);
  for (const bad of ['cert:', 'cert:-1', 'cert:1.5', 'cert:x', 'pick:1', 'cancel', '', null, undefined, 7]) {
    assert.equal(parseCertPickIndex(/** @type {any} */ (bad)), null, `'${String(bad)}' must map to no row`);
  }
  assert.equal(CERT_CANCEL_ID, 'cancel');
});

test("cross-pin: register-overlay-ipc.js's local prefix mirror matches the template's CERT_PICK_PREFIX (the ESM/CJS split cannot drift)", () => {
  const registrarSource = fs.readFileSync(
    path.join(__dirname, '../../src/main/register-overlay-ipc.js'), 'utf8'
  );
  assert.equal(CERT_PICK_PREFIX, 'cert:');
  assert.match(
    registrarSource,
    /const CERT_PICK_PREFIX = 'cert:';/,
    "register-overlay-ipc.js must carry the identical prefix literal (its parseCertPickIndex mirrors the template's)"
  );
});
