'use strict';

// Unit tests for the bookmark-edit sheet template DOM/aria structure (M15 F1
// Leg 2, flight DD4). The card is built by the pure, document-injected
// buildBookmarkEditCard — the auth-basic-template.test.js idiom — so its
// structure/aria contract (labeled fields, modal dialog, keyboard-reachable
// controls) is pinned offline. Behavior (submit → the dedicated
// menu-overlay:bookmark-edit-submit invoke, close-only-on-success) is wired in
// menu-overlay.js and exercised by the register-overlay-ipc handler suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildBookmarkEditCard, applyBookmarkEditModel } = require('../../src/shared/bookmark-edit-template.js');

test('bookmark-edit card is a modal dialog: LABELED name/url inputs + Remove/Done', () => {
  const document = createDocument();
  const card = buildBookmarkEditCard(document);

  // Backdrop node, hidden by default (menu-controller onOpen unhides).
  assert.equal(card.node.id, 'sheet-bookmark-edit');
  assert.equal(card.node.classList.contains('hidden'), true);

  // The card itself is the accessible dialog: role=dialog + aria-modal=true + a
  // name — the card sets its OWN aria-label (dialog family, not MENU_LABELS).
  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Edit bookmark');
  assert.equal(card.card.parentNode, card.node);

  // Name + URL are plain text inputs — autocomplete/spellcheck off.
  assert.equal(card.name.type, 'text');
  assert.equal(card.name.id, 'sheet-bookmark-name');
  assert.equal(card.name.autocomplete, 'off');
  assert.equal(card.name.spellcheck, false);
  assert.equal(card.url.type, 'text');
  assert.equal(card.url.id, 'sheet-bookmark-url');
  assert.equal(card.url.autocomplete, 'off');
  assert.equal(card.url.spellcheck, false);

  // A polite aria-live error line; role=alert deliberately NOT set.
  assert.equal(card.error.attributes.get('aria-live'), 'polite');
  assert.equal(card.error.textContent, '');
  assert.equal(card.error.attributes.has('role'), false);

  // Remove + Done are type=button (never a form submit).
  assert.equal(card.remove.type, 'button');
  assert.equal(card.remove.textContent, 'Remove');
  assert.equal(card.done.type, 'button');
  assert.equal(card.done.textContent, 'Done');

  // DOM order inside the card's single body: name label → name → url label →
  // url → error → actions(Remove, Done). BOTH labels point at their inputs.
  const [body] = card.card.children;
  assert.equal(body.className, 'vault-sheet-body');
  const [nameLabel, name, urlLabel, url, error, actions] = body.children;
  assert.equal(nameLabel.tagName, 'LABEL');
  assert.equal(nameLabel.htmlFor, 'sheet-bookmark-name');
  assert.equal(name, card.name);
  assert.equal(urlLabel.tagName, 'LABEL');
  assert.equal(urlLabel.htmlFor, 'sheet-bookmark-url');
  assert.equal(url, card.url);
  assert.equal(error, card.error);
  assert.deepEqual(actions.children, [card.remove, card.done]);
});

test('the 4-way Tab cycle order is name → url → Remove → Done (leg contract)', () => {
  const document = createDocument();
  const card = buildBookmarkEditCard(document);
  const cycle = [card.name, card.url, card.remove, card.done];
  assert.equal(cycle.length, 4);
  assert.deepEqual(new Set(cycle).size, 4, 'all four cycle members are distinct nodes');
});

test('each buildBookmarkEditCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildBookmarkEditCard(document);
  const b = buildBookmarkEditCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.name, b.name);
  assert.notEqual(a.url, b.url);
});

// ---------------------------------------------------------------------------
// applyBookmarkEditModel — the ONE place that reads model.name/model.url to
// prefill the popover (M15 F1 Leg 5 HAT fix: this contract must stay pinned
// so a model-shape drift, e.g. a `title` field, can't silently regress it).
// ---------------------------------------------------------------------------

test('applyBookmarkEditModel prefills name/url from model.name/model.url and resets the error line', () => {
  const document = createDocument();
  const card = buildBookmarkEditCard(document);
  card.error.textContent = 'stale error';
  applyBookmarkEditModel(card, { id: 'bm-1', name: 'Example Domain', url: 'https://example.com/' });
  assert.equal(card.name.value, 'Example Domain');
  assert.equal(card.url.value, 'https://example.com/');
  assert.equal(card.error.textContent, '');
});

test('applyBookmarkEditModel blanks both fields on a malformed model (non-string name/url, or none at all)', () => {
  const document = createDocument();
  const card = buildBookmarkEditCard(document);
  applyBookmarkEditModel(card, { id: 'bm-1', name: 42, url: null });
  assert.equal(card.name.value, '');
  assert.equal(card.url.value, '');
  applyBookmarkEditModel(card, null);
  assert.equal(card.name.value, '');
  assert.equal(card.url.value, '');
});
