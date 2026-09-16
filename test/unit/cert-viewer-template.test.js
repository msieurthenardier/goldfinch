'use strict';

// Unit tests for the cert-viewer sheet template DOM/aria structure and pure
// model application (Mission 20 Flight 2 Leg 4, DD9). The card is built by
// the pure, document-injected buildCertViewerCard — the cert-override-
// template.test.js idiom — so its structure/aria contract (labeled dialog,
// Close reachable, every field via textContent) is pinned offline. Behavior
// (dismissible dialog wiring, Close/Escape/backdrop dismiss) is wired in
// menu-overlay.js and covered by the shared modal-card-controller suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildCertViewerCard, applyCertViewerModel } = require('../../src/shared/cert-viewer-template.js');

test('cert-viewer card is a modal dialog: status line + rows container + Close', () => {
  const document = createDocument();
  const card = buildCertViewerCard(document);

  assert.equal(card.node.id, 'sheet-cert-viewer');
  assert.equal(card.node.classList.contains('hidden'), true);

  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Certificate');
  assert.equal(card.card.parentNode, card.node);

  assert.equal(card.status.id, 'sheet-cert-viewer-status');
  assert.equal(card.rows.id, 'sheet-cert-viewer-rows');
  assert.equal(card.close.id, 'sheet-cert-viewer-close');
  assert.equal(card.close.type, 'button');
  assert.equal(card.close.textContent, 'Close');

  // DOM order: status → rows → actions(Close).
  const [status, rows, actions] = card.card.children;
  assert.equal(status, card.status);
  assert.equal(rows, card.rows);
  assert.deepEqual(actions.children, [card.close]);
});

test('each buildCertViewerCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildCertViewerCard(document);
  const b = buildCertViewerCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.rows, b.rows);
  assert.notEqual(a.close, b.close);
});

test('applyCertViewerModel: a trusted summary renders "Trusted" + every labelled row via textContent', () => {
  const document = createDocument();
  const card = buildCertViewerCard(document);
  applyCertViewerModel(card, {
    subject: { commonName: 'a.example', organization: 'Acme' },
    issuer: { commonName: 'Goldfinch Fixture Trusted CA' },
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2026-02-01T00:00:00.000Z',
    serial: '01AB',
    fingerprints: { sha256: 'AA:BB', sha1: 'CC:DD' },
    san: ['a.example', 'b.example'],
    chain: [{ subject: 'CN=Intermediate', issuer: 'CN=Root' }],
    status: 'trusted'
  });

  assert.equal(card.status.textContent, 'Trusted');
  const rowText = (label) => {
    const row = [...card.rows.children].find((r) => r.children[0].textContent === label);
    return row && row.children[1].textContent;
  };
  assert.equal(rowText('Issued to'), 'CN=a.example, O=Acme');
  assert.equal(rowText('Issued by'), 'CN=Goldfinch Fixture Trusted CA');
  assert.equal(rowText('Valid from'), '2026-01-01T00:00:00.000Z');
  assert.equal(rowText('Valid until'), '2026-02-01T00:00:00.000Z');
  assert.equal(rowText('Subject alternative names'), 'a.example, b.example');
  assert.equal(rowText('Serial'), '01AB');
  assert.equal(rowText('SHA-256 fingerprint'), 'AA:BB');
  assert.equal(rowText('SHA-1 fingerprint'), 'CC:DD');
  assert.equal(rowText('Chain[0]'), 'CN=Intermediate → CN=Root');
});

test('applyCertViewerModel: untrusted/overridden statuses name the error; trusted names neither', () => {
  const document = createDocument();
  const card = buildCertViewerCard(document);

  applyCertViewerModel(card, { status: 'untrusted', error: 'ERR_CERT_AUTHORITY_INVALID' });
  assert.equal(card.status.textContent, 'Not trusted — ERR_CERT_AUTHORITY_INVALID');

  applyCertViewerModel(card, { status: 'overridden', error: 'ERR_CERT_AUTHORITY_INVALID' });
  assert.equal(card.status.textContent, 'Overridden this session — ERR_CERT_AUTHORITY_INVALID');

  applyCertViewerModel(card, { status: 'trusted' });
  assert.equal(card.status.textContent, 'Trusted');
});

test('applyCertViewerModel: a null/missing summary renders the "unavailable" status line ALONE, no rows', () => {
  const document = createDocument();
  const card = buildCertViewerCard(document);
  card.rows.appendChild(document.createElement('div')); // stale content from a prior render

  assert.doesNotThrow(() => applyCertViewerModel(card, null));
  assert.equal(card.status.textContent, 'Certificate details unavailable — reload to refresh');
  assert.equal(card.rows.children.length, 0);

  assert.doesNotThrow(() => applyCertViewerModel(card, undefined));
  assert.equal(card.status.textContent, 'Certificate details unavailable — reload to refresh');
});

test('applyCertViewerModel: an empty SAN/chain array renders the em-dash placeholder, never throws', () => {
  const document = createDocument();
  const card = buildCertViewerCard(document);
  applyCertViewerModel(card, { status: 'trusted', san: [], chain: [] });
  const rowText = (label) => {
    const row = [...card.rows.children].find((r) => r.children[0].textContent === label);
    return row && row.children[1].textContent;
  };
  assert.equal(rowText('Subject alternative names'), '—');
  assert.equal(rowText('Chain'), '—');
});

test('applyCertViewerModel: renders EXACTLY what the SAN/chain arrays are given — caps happen at the summary layer, not here', () => {
  const document = createDocument();
  const card = buildCertViewerCard(document);
  const san = Array.from({ length: 26 }, (_, i) => `host${i}.example`);
  san.push('+1 more'); // the summary layer's own cap marker — rendered verbatim
  const chain = Array.from({ length: 10 }, (_, i) => ({ subject: `CN=Level${i}`, issuer: `CN=Level${i + 1}` }));
  applyCertViewerModel(card, { status: 'trusted', san, chain });

  const rowText = (label) => {
    const row = [...card.rows.children].find((r) => r.children[0].textContent === label);
    return row && row.children[1].textContent;
  };
  assert.equal(rowText('Subject alternative names'), san.join(', '));
  for (let i = 0; i < chain.length; i++) {
    assert.equal(rowText(`Chain[${i}]`), `CN=Level${i} → CN=Level${i + 1}`);
  }
});

test('applyCertViewerModel: malformed/missing fields degrade to empty strings, never throw', () => {
  const document = createDocument();
  const card = buildCertViewerCard(document);
  assert.doesNotThrow(() =>
    applyCertViewerModel(card, {
      status: 'trusted',
      subject: null,
      issuer: 42,
      validFrom: {},
      validTo: undefined,
      serial: [],
      fingerprints: null,
      san: 'not-an-array',
      chain: 'not-an-array'
    })
  );
  const rowText = (label) => {
    const row = [...card.rows.children].find((r) => r.children[0].textContent === label);
    return row && row.children[1].textContent;
  };
  assert.equal(rowText('Issued to'), '');
  assert.equal(rowText('Issued by'), '');
  assert.equal(rowText('Valid from'), '');
  assert.equal(rowText('Valid until'), '');
  assert.equal(rowText('Serial'), '');
  assert.equal(rowText('SHA-256 fingerprint'), '');
  assert.equal(rowText('SHA-1 fingerprint'), '');
  assert.equal(rowText('Subject alternative names'), '—');
  assert.equal(rowText('Chain'), '—');
});
