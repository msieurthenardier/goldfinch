'use strict';

// Unit tests for the cert-override sheet template DOM/aria structure (Mission
// 20 Flight 2 Leg 3, flight DD3). The card is built by the pure,
// document-injected buildCertOverrideCard — the bookmark-edit-template.test.js
// idiom — so its structure/aria contract (labeled dialog, Back/Proceed
// reachable controls, engine-string-via-textContent) is pinned offline.
// Behavior (the dedicated menu-overlay:cert-override-proceed invoke, the
// four-guard main-side handler) is wired in menu-overlay.js / register-
// overlay-ipc.js and exercised by their own suites.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildCertOverrideCard, applyCertOverrideModel } = require('../../src/shared/cert-override-template.js');

test('cert-override card is a modal dialog: heading/body/error line + Back/Proceed', () => {
  const document = createDocument();
  const card = buildCertOverrideCard(document);

  // Backdrop node, hidden by default (menu-controller onOpen unhides).
  assert.equal(card.node.id, 'sheet-cert-override');
  assert.equal(card.node.classList.contains('hidden'), true);

  // The card itself is the accessible dialog: role=dialog + aria-modal=true + a name.
  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Proceed despite a certificate error?');
  assert.equal(card.card.parentNode, card.node);

  // Heading/body/error line ids (the frozen ids the leg's Outputs section names).
  assert.equal(card.heading.id, 'sheet-cert-override-heading');
  assert.equal(card.body.id, 'sheet-cert-override-body');
  assert.equal(card.errorLine.id, 'sheet-cert-override-error');

  // A polite aria-live status line for a failed proceed; role=alert deliberately NOT set.
  assert.equal(card.status.attributes.get('aria-live'), 'polite');
  assert.equal(card.status.textContent, '');
  assert.equal(card.status.attributes.has('role'), false);

  // Back + Proceed are type=button (never a form submit) with their frozen ids.
  assert.equal(card.back.type, 'button');
  assert.equal(card.back.id, 'sheet-cert-override-back');
  assert.equal(card.back.textContent, 'Back to safety');
  assert.equal(card.proceed.type, 'button');
  assert.equal(card.proceed.id, 'sheet-cert-override-proceed');

  // Visual weight: Back is primary, Proceed is NOT — never colour alone (leg
  // design review). A structural class difference, not a bare CSS assertion.
  assert.equal(card.back.className.includes('primary'), true);
  assert.equal(card.proceed.className.includes('primary'), false);

  // DOM order: heading → body → error line → status → actions(Back, Proceed).
  const [heading, body, errorLine, status, actions] = card.card.children;
  assert.equal(heading, card.heading);
  assert.equal(body, card.body);
  assert.equal(errorLine, card.errorLine);
  assert.equal(status, card.status);
  assert.deepEqual(actions.children, [card.back, card.proceed]);
});

test('each buildCertOverrideCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildCertOverrideCard(document);
  const b = buildCertOverrideCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.back, b.back);
  assert.notEqual(a.proceed, b.proceed);
});

test('applyCertOverrideModel: renders host/error/title/body via textContent and labels Proceed with the host', () => {
  const document = createDocument();
  const card = buildCertOverrideCard(document);
  card.status.textContent = 'stale status from a prior open';

  applyCertOverrideModel(card, {
    host: '127.0.0.1:8443',
    error: 'ERR_CERT_AUTHORITY_INVALID',
    title: "This connection isn't private",
    body: "This site's security certificate is from an authority Goldfinch doesn't trust."
  });

  assert.equal(card.heading.textContent, "This connection isn't private");
  assert.equal(card.body.textContent, "This site's security certificate is from an authority Goldfinch doesn't trust.");
  assert.equal(card.errorLine.textContent, 'ERR_CERT_AUTHORITY_INVALID');
  assert.equal(card.proceed.textContent, 'Proceed to 127.0.0.1:8443 (unsafe)');
  // The status line resets on every render — a stale failed-proceed message
  // from a PRIOR open must never survive into a fresh one.
  assert.equal(card.status.textContent, '');
});

test('applyCertOverrideModel: missing/non-string fields degrade to empty strings, never throw', () => {
  const document = createDocument();
  const card = buildCertOverrideCard(document);

  assert.doesNotThrow(() => applyCertOverrideModel(card, null));
  assert.equal(card.heading.textContent, '');
  assert.equal(card.body.textContent, '');
  assert.equal(card.errorLine.textContent, '');
  assert.equal(card.proceed.textContent, 'Proceed to  (unsafe)');

  assert.doesNotThrow(() => applyCertOverrideModel(card, { host: 42, error: {}, title: [], body: undefined }));
  assert.equal(card.heading.textContent, '');
  assert.equal(card.body.textContent, '');
  assert.equal(card.errorLine.textContent, '');
  assert.equal(card.proceed.textContent, 'Proceed to  (unsafe)');
});
