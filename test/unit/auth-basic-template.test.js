'use strict';

// Unit tests for the auth-basic sheet template DOM/aria structure (M14 F1 L2,
// flight DD2). The card is built by the pure, document-injected
// buildAuthBasicCard — the vault-unlock-template.test.js idiom — so its
// structure/aria contract (labeled fields, modal dialog, keyboard-reachable
// controls) is pinned offline. Behavior (submit → the dedicated Buffer channel,
// Cancel → channel-4 'cancel') is wired in menu-overlay.js and exercised by the
// auth-submit handler suite. This structural pin also stands in for the live
// axe sweep while the audit's sheet-state path is apparatus-blocked (the M12
// finding-1 secret-sheet refusal — see the flight log anomaly).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildAuthBasicCard } = require('../../src/shared/auth-basic-template.js');

test('auth-basic card is a modal dialog: host/realm line + LABELED username/password inputs + Sign in/Cancel', () => {
  const document = createDocument();
  const card = buildAuthBasicCard(document);

  // Backdrop node, hidden by default (menu-controller onOpen unhides).
  assert.equal(card.node.id, 'sheet-auth-basic');
  assert.equal(card.node.classList.contains('hidden'), true);

  // The card itself is the accessible dialog: role=dialog + aria-modal=true + a name.
  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Sign in');
  assert.equal(card.card.parentNode, card.node);

  // Username is a plain text input; password is type=password — both
  // autocomplete/spellcheck off (credentials never feed either).
  assert.equal(card.username.type, 'text');
  assert.equal(card.username.id, 'sheet-auth-username');
  assert.equal(card.username.autocomplete, 'off');
  assert.equal(card.username.spellcheck, false);
  assert.equal(card.password.type, 'password');
  assert.equal(card.password.id, 'sheet-auth-password');
  assert.equal(card.password.autocomplete, 'off');
  assert.equal(card.password.spellcheck, false);

  // A polite aria-live error line; role=alert deliberately NOT set.
  assert.equal(card.error.attributes.get('aria-live'), 'polite');
  assert.equal(card.error.textContent, '');
  assert.equal(card.error.attributes.has('role'), false);

  // Sign in + Cancel are type=button (never a form submit).
  assert.equal(card.submit.type, 'button');
  assert.equal(card.submit.textContent, 'Sign in');
  assert.equal(card.cancel.type, 'button');
  assert.equal(card.cancel.textContent, 'Cancel');

  // A header (title + accessible close X) over a padded body — the shared sheet chrome.
  const [header, body] = card.card.children;
  assert.equal(header.className, 'vault-sheet-header');
  assert.equal(header.children[0].textContent, 'Sign in');
  assert.equal(card.close.tagName, 'BUTTON');
  assert.equal(card.close.type, 'button');
  assert.equal(card.close.attributes.get('aria-label'), 'Close');

  // DOM order inside the body: origin line → popup marker (hidden, M14 F2 L2)
  // → user label → username → pass label → password → error → actions(Sign in,
  // Cancel). BOTH labels point at their inputs (the AC's "labeled fields").
  assert.equal(body.className, 'vault-sheet-body');
  const [origin, popupNote, userLabel, username, passLabel, password, error, actions] = body.children;
  assert.equal(popupNote, card.popupNote);
  assert.equal(origin, card.origin);
  assert.equal(origin.className, 'auth-basic-origin');
  assert.equal(origin.textContent, '', 'host/realm set per-init via textContent, never markup');
  assert.equal(userLabel.tagName, 'LABEL');
  assert.equal(userLabel.htmlFor, 'sheet-auth-username');
  assert.equal(username, card.username);
  assert.equal(passLabel.tagName, 'LABEL');
  assert.equal(passLabel.htmlFor, 'sheet-auth-password');
  assert.equal(password, card.password);
  assert.equal(error, card.error);
  assert.deepEqual(actions.children, [card.submit, card.cancel]);
});

test('each buildAuthBasicCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildAuthBasicCard(document);
  const b = buildAuthBasicCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.username, b.username);
  assert.notEqual(a.password, b.password);
});

test('popup marker line (M14 F2 L2, DD5): fixed copy, hidden by default, sited between the origin line and the username label', () => {
  const document = createDocument();
  const card = buildAuthBasicCard(document);

  assert.ok(card.popupNote, 'the template returns the popupNote ref (menu-overlay toggles it per model.popup)');
  assert.equal(card.popupNote.classList.contains('hidden'), true, 'hidden by default — tab challenges never show it');
  assert.equal(card.popupNote.className, 'auth-basic-origin auth-popup-note');
  assert.equal(
    card.popupNote.textContent,
    'This request comes from a pop-up window opened by this page.',
    'FIXED template copy — no server-controlled string ever rides the marker'
  );

  // Sited directly after the origin context line (both are context copy).
  const body = card.origin.parentNode;
  const kids = body.children;
  assert.equal(kids.indexOf(card.popupNote), kids.indexOf(card.origin) + 1);
});
