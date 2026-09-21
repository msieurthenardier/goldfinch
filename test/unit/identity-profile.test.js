'use strict';

// Unit tests for src/main/vault/identity-profile.js (Mission 21, Flight 2, Leg 3 /
// DD2, LD2, LD3). Pure module, no store, no DOM. `classifyCapture` gained its
// first live caller at Flight 3 Leg 4 (identity-capture, DD10) —
// `disposeIdentityCapture` in vault-human.js; this file still tests it directly
// with plain objects (the pre-Leg-4 "not trusted until proven" discipline), and
// AC20 below additionally proves the DD10 backstop against the REAL
// `incident-report-third-party` fixture rather than a hand-typed stand-in.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { extractFixtureFile } = require('../helpers/fixture-extractor');
const { findAllIdentityFields } = require('../../src/preload/vault-identity-fields');

const ip = require('../../src/main/vault/identity-profile');
const identityFields = require('../../src/preload/vault-identity-fields');

/* -------------------------------------------------- IDENTITY_FIELDS ↔ Leg 2 drift guard */

test('IDENTITY_FIELDS matches Leg 2 detector role names exactly — no translation layer (AC8)', () => {
  const detectorRoles = [...identityFields.POSTAL_ROLES, ...identityFields.NON_POSTAL_ROLES];
  assert.deepEqual([...ip.IDENTITY_FIELDS].sort(), [...detectorRoles].sort());
  // The exact eleven names the leg spec enumerates.
  assert.deepEqual(
    [...ip.IDENTITY_FIELDS].sort(),
    [
      'city',
      'country',
      'email',
      'firstName',
      'fullName',
      'lastName',
      'phone',
      'postalCode',
      'region',
      'street',
      'street2'
    ].sort()
  );
  // `title` is a vault-item concept (the entry's own nickname), never a detected field.
  assert.ok(!ip.IDENTITY_FIELDS.includes('title'));
});

/* --------------------------------------------------------------- identityProfileOf */

test('identityProfileOf: no items -> null profile, no extra', () => {
  assert.deepEqual(ip.identityProfileOf([]), { profile: null, extra: [] });
  assert.deepEqual(ip.identityProfileOf(/** @type {any} */ (null)), { profile: null, extra: [] });
});

test('identityProfileOf: one identity item among other types -> that item, no extra', () => {
  const login = { id: 'l1', type: 'login' };
  const identity = { id: 'i1', type: 'identity', fullName: 'Jane Doe' };
  const note = { id: 'n1', type: 'note' };
  assert.deepEqual(ip.identityProfileOf([login, identity, note]), { profile: identity, extra: [] });
});

test('identityProfileOf: a duplicate SURFACES via `extra` — never silently picked/hidden', () => {
  const first = { id: 'i1', type: 'identity', fullName: 'First' };
  const second = { id: 'i2', type: 'identity', fullName: 'Second' };
  const third = { id: 'i3', type: 'identity', fullName: 'Third' };
  const result = ip.identityProfileOf([first, second, third]);
  assert.equal(result.profile, first, 'first by array order wins the "profile" slot');
  assert.deepEqual(result.extra, [second, third], 'every OTHER identity item is surfaced, not dropped');
});

/* ---------------------------------------------------------------------- classifyCapture */

test('classifyCapture: all captured values match stored -> kind match, no offer', () => {
  const stored = { fullName: 'Jane Doe', email: 'jane@example.com' };
  const captured = { fullName: 'Jane Doe', email: 'jane@example.com' };
  assert.deepEqual(ip.classifyCapture(stored, captured), { kind: 'match', gapFilled: [], conflicting: [] });
});

test('classifyCapture: captured fills only gaps (fields absent from stored) -> kind gap-fill', () => {
  const stored = { fullName: 'Jane Doe' };
  const captured = { fullName: 'Jane Doe', street: '123 Main St', city: 'Springfield' };
  const result = ip.classifyCapture(stored, captured);
  assert.equal(result.kind, 'gap-fill');
  assert.deepEqual(
    result.gapFilled.sort((a, b) => a.field.localeCompare(b.field)),
    [
      { field: 'city', to: 'Springfield' },
      { field: 'street', to: '123 Main St' }
    ]
  );
  assert.deepEqual(result.conflicting, []);
});

test('classifyCapture: a differing stored value is a conflict, naming exactly which field', () => {
  const stored = { fullName: 'Jane Doe', phone: '555-1234' };
  const captured = { fullName: 'Jane Doe', phone: '555-9999' };
  const result = ip.classifyCapture(stored, captured);
  assert.equal(result.kind, 'conflict');
  assert.deepEqual(result.conflicting, [{ field: 'phone', from: '555-1234', to: '555-9999' }]);
  assert.deepEqual(result.gapFilled, []);
});

test('classifyCapture: ANY conflicting field makes the whole kind conflict, even alongside gaps', () => {
  const stored = { fullName: 'Jane Doe', phone: '555-1234' };
  const captured = { fullName: 'Jane Doe', phone: '555-9999', street: '1 New St' };
  const result = ip.classifyCapture(stored, captured);
  assert.equal(result.kind, 'conflict');
  assert.deepEqual(result.conflicting, [{ field: 'phone', from: '555-1234', to: '555-9999' }]);
  assert.deepEqual(result.gapFilled, [{ field: 'street', to: '1 New St' }]);
});

test('classifyCapture: value equality is BYTE-EXACT — "555-1234" vs "5551234" is a conflict, never normalised', () => {
  const stored = { phone: '555-1234' };
  const captured = { phone: '5551234' };
  const result = ip.classifyCapture(stored, captured);
  assert.equal(result.kind, 'conflict');
  assert.deepEqual(result.conflicting, [{ field: 'phone', from: '555-1234', to: '5551234' }]);
});

test('classifyCapture: a stored profile against an EMPTY capture -> match, never conflict (edge case)', () => {
  const stored = { fullName: 'Jane Doe', email: 'jane@example.com', street: '123 Main St' };
  assert.deepEqual(ip.classifyCapture(stored, {}), { kind: 'match', gapFilled: [], conflicting: [] });
  assert.deepEqual(ip.classifyCapture(stored, /** @type {any} */ (null)), {
    kind: 'match',
    gapFilled: [],
    conflicting: []
  });
});

test('classifyCapture: FRESH-PROFILE residual — no stored profile at all -> every captured field is a gap (DD2)', () => {
  // DD2's own motivating gift-shipping scenario: a captured stranger's identity, on a
  // profile that has never saved one before, classifies as an ordinary gap-fill merge —
  // still an offer, never a silent write, but the rule does not catch its own headline
  // case in this one situation. Pinned rather than hidden (flight DD2's residual note).
  const captured = { fullName: 'A Stranger', street: '9 Someone Else Ave', city: 'Nowhere' };
  const resultNull = ip.classifyCapture(null, captured);
  assert.equal(resultNull.kind, 'gap-fill');
  assert.equal(resultNull.gapFilled.length, 3);
  assert.deepEqual(resultNull.conflicting, []);

  const resultUndefined = ip.classifyCapture(undefined, captured);
  assert.equal(resultUndefined.kind, 'gap-fill');
  assert.equal(resultUndefined.gapFilled.length, 3);
});

test('classifyCapture: an empty-string stored value is treated as absent (a gap, not a conflict)', () => {
  const stored = { fullName: '' };
  const captured = { fullName: 'Jane Doe' };
  const result = ip.classifyCapture(stored, captured);
  assert.equal(result.kind, 'gap-fill');
  assert.deepEqual(result.gapFilled, [{ field: 'fullName', to: 'Jane Doe' }]);
});

test('classifyCapture: only fields PRESENT in captured are ever judged', () => {
  const stored = { fullName: 'Jane Doe', phone: '555-0000' };
  // captured carries neither fullName nor phone — nothing to judge for either.
  const captured = { email: 'jane@example.com' };
  const result = ip.classifyCapture(stored, captured);
  assert.equal(result.kind, 'gap-fill');
  assert.deepEqual(result.gapFilled, [{ field: 'email', to: 'jane@example.com' }]);
});

/* ------------------------------------------------------------ AC20 (Leg 4): the
 * DD10 backstop, proven against the REAL incident-report-third-party fixture —
 * Flight 2's named ACCEPTED false positive. Its fields (a third party's
 * incident location, a reporter's own name/email) clear every detection gate
 * (see the fixture's own header), so promoting it to `captures`/`offers` would
 * gate a known false positive as desired behaviour (AC20 forbids this). Instead
 * this pins the BACKSTOP it relies on: a captured value that conflicts with an
 * existing profile never silently overwrites; on a FRESH vault it is merely a
 * gap-fill (DD10's own named residual — the conflict rule cannot protect its
 * own headline scenario on a first-ever capture). */

const INCIDENT_REPORT_FIXTURE = path.join(
  __dirname,
  '..',
  'fixtures',
  'save-moment',
  'identity',
  'incident-report-third-party.html'
);

/**
 * Build the captured-record shape `disposeIdentityCapture` would compute from
 * the incident-report-third-party fixture, by setting plausible operator-typed
 * values on its detected fields and reading them back through the SAME
 * detector this leg's gesture/observer path uses — never a hand-typed stand-in.
 * @returns {any}
 */
function capturedFromIncidentReportFixture() {
  const doc = extractFixtureFile(INCIDENT_REPORT_FIXTURE);
  const entry = findAllIdentityFields(doc)[0];
  assert.ok(entry, 'the fixture must still detect an identity entry');
  const values = {
    fullName: 'Alex Reporter',
    email: 'alex@example.com',
    street: '123 Elsewhere St',
    city: 'Springfield',
    postalCode: '90001'
  };
  for (const [role, value] of Object.entries(values)) {
    if (entry[role]) entry[role].value = value;
  }
  /** @type {any} */
  const captured = {};
  for (const field of ip.IDENTITY_FIELDS) {
    const el = entry[field];
    if (el && el.value) captured[field] = el.value;
  }
  return captured;
}

test('AC20: incident-report-third-party — an EXISTING profile classifies the captured stranger-address as a CONFLICT', () => {
  const captured = capturedFromIncidentReportFixture();
  assert.ok(Object.keys(captured).length >= 3, 'sanity: the fixture actually captured several fields');

  const stored = {
    type: 'identity',
    title: 'My details',
    fullName: 'Jane Q. Operator',
    email: 'jane@example.com',
    street: '1 Real Home St',
    city: 'Hometown',
    postalCode: '00000'
  };
  const result = ip.classifyCapture(stored, captured);
  assert.equal(result.kind, 'conflict', "the backstop: a stranger's address never silently overwrites");
  assert.ok(result.conflicting.length > 0);
  // Every conflicting field really did differ.
  for (const c of result.conflicting) {
    assert.notEqual(c.from, c.to);
  }
});

test('AC20 (DD10 residual): on a FRESH vault (no stored profile) the same capture is only a gap-fill, never a conflict', () => {
  const captured = capturedFromIncidentReportFixture();
  const result = ip.classifyCapture(null, captured);
  assert.equal(result.kind, 'gap-fill', "DD10's own named residual — the conflict rule has nothing to fire against");
  assert.deepEqual(result.conflicting, []);
  assert.ok(result.gapFilled.length > 0);
});
