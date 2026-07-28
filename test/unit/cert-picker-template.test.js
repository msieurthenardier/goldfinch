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
  renderCertPickerSubtitle,
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

  const [header, subtitle, popupNote, list] = card.card.children;
  assert.equal(header.className, 'vault-sheet-header');
  assert.equal(subtitle, card.subtitle, 'the M14 F3 site-attribution subtitle sits directly under the header');
  assert.equal(popupNote, card.popupNote, 'the M14 F2 L2 popup marker sits between header and list');
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

test('REGRESSION (M14 F3 HAT): the LIVE cert-picker model shape ({certs, popup?}) passes the sheet init gate — blank-sheet fix', () => {
  // Live defect: since M14 F2 L2 the chrome's onCertChallengePresent wraps the
  // rows in the OBJECT form { certs, popup? } (the popup marker rides it), but
  // menu-overlay.js's init-dispatch model-shape gate still demanded a bare
  // ARRAY for cert-picker — so every real certificate challenge bailed at the
  // gate AFTER main's openMenu had already shown the sheet: a visible blank
  // sheet, no chooser card, page load hung on the unanswered callback. The
  // template tests passed (they exercise the pure builders with arrays) and
  // the a11y hook still sends the pre-popup bare-array shape, which masked it.
  // Source-contract pin (downloads-popup-contract idiom): BOTH ends of the
  // shape contract, so neither side can drift without failing here.
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/renderer.js'), 'utf8'
  );
  const sheetSource = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/menu-overlay.js'), 'utf8'
  );
  // 1. The live chrome sender uses the object form (never the bare array —
  //    the popup marker must be able to ride every presentation).
  assert.match(
    rendererSource,
    /openOverlayMenu\('cert-picker', \{ certs: Array\.isArray\(certs\) \? certs : \[\]/,
    "renderer.js's cert-challenge-present handler must send the { certs, popup? } object model"
  );
  // 2. The sheet's init gate accepts an OBJECT for cert-picker (array-or-object
  //    — renderCertPicker's documented domain; an array-only gate re-blanks
  //    the live sheet, an object-only gate breaks the a11y audit hook).
  assert.match(
    sheetSource,
    /template === 'cert-picker'\s*\?\s*!!model && typeof model === 'object'/,
    "menu-overlay.js's modelShapeOk must accept cert-picker's object form (and arrays — typeof covers both)"
  );
  // 3. (M14 F3 HAT fix, attribution subtitle) The chrome relays the store's
  //    host on the object model — dropping it re-opens the no-attribution gap:
  //    the sheet renders but can't say WHO is asking for a certificate…
  assert.match(
    rendererSource,
    /onCertChallengePresent\(\(\{ certs, host, popup \}\)/,
    "renderer.js's cert-challenge-present handler must destructure the payload's host"
  );
  assert.match(
    rendererSource,
    /\.\.\.\(typeof host === 'string' && host \? \{ host \} : \{\}\)/,
    "renderer.js's cert-challenge-present handler must put host on the model for the attribution subtitle"
  );
  // …and the sheet side renders it (the model field is inert without the
  //    renderCertPickerSubtitle call — both ends pinned, fix-#4 idiom).
  assert.match(
    sheetSource,
    /renderCertPickerSubtitle\(certPicker\.subtitle, host\)/,
    "menu-overlay.js's renderCertPicker must render the site-attribution subtitle from model.host"
  );
});

test('site-attribution subtitle (M14 F3 HAT fix): host renders the attribution copy via textContent; an absent host hides the line (a11y hook path)', () => {
  const document = createDocument();
  const card = buildCertPickerCard(document);

  // Default (as built): hidden and empty — the bare-array a11y audit model
  // carries no host and must keep rendering without a blank attribution line.
  assert.ok(card.subtitle, 'the template returns the subtitle ref (menu-overlay renders it per model.host)');
  assert.equal(card.subtitle.classList.contains('hidden'), true, 'hidden by default');
  assert.equal(card.subtitle.textContent, '');
  assert.equal(card.subtitle.className, 'auth-basic-origin cert-picker-origin');

  // Host present: the attribution copy names WHO is asking. The host is
  // `new URL(url).host` main-side, so a non-default port rides it natively
  // (the displayHost-parity property) — textContent only, never markup.
  renderCertPickerSubtitle(card.subtitle, '127.0.0.1:8493');
  assert.equal(
    card.subtitle.textContent,
    'The site 127.0.0.1:8493 is asking you to identify yourself with a certificate.'
  );
  assert.equal(card.subtitle.classList.contains('hidden'), false);

  // Sited under the header, above the list (with the popup marker line — the
  // two copy lines coexist; a popup challenge shows both).
  const kids = card.card.children;
  assert.ok(kids.indexOf(card.subtitle) === kids.indexOf(card.popupNote) - 1
    && kids.indexOf(card.subtitle) < kids.indexOf(card.list),
  'subtitle sits between the header and the popup marker / list');

  // Back to no host (and non-string hosts): the line hides and empties —
  // never copy with a blank in it.
  for (const absent of [undefined, null, '', 7]) {
    renderCertPickerSubtitle(card.subtitle, /** @type {any} */ (absent));
    assert.equal(card.subtitle.classList.contains('hidden'), true, `host ${String(absent)} must hide the line`);
    assert.equal(card.subtitle.textContent, '');
  }
});

test('popup marker line (M14 F2 L2, DD5): fixed copy, hidden by default, sited between the header and the roving list', () => {
  const document = createDocument();
  const card = buildCertPickerCard(document);

  assert.ok(card.popupNote, 'the template returns the popupNote ref (menu-overlay toggles it per model.popup)');
  assert.equal(card.popupNote.classList.contains('hidden'), true, 'hidden by default — tab challenges never show it');
  assert.equal(card.popupNote.className, 'auth-basic-origin auth-popup-note');
  assert.equal(card.popupNote.textContent, 'This request comes from a pop-up window opened by this page.',
    'FIXED template copy — no server/certificate string ever rides the marker');

  const kids = card.card.children;
  assert.ok(kids.indexOf(card.popupNote) > -1 && kids.indexOf(card.popupNote) < kids.indexOf(card.list),
    'marker sits above the certificate list');
});
