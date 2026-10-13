'use strict';

// Unit tests for src/main/vault/copy-plan.js (Sortie 04 Leg 1 / DD2, DD3):
// the pure cross-vault copy planner — match rule per type, identical check,
// `allowed` sets. Pure: no store, no clock.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { planCopy, allowedFor, isIdenticalItem } = require('../../src/main/vault/copy-plan');

const login = (o = {}) => ({
  id: 'l1',
  type: 'login',
  title: 'Site',
  origin: 'https://example.com',
  username: 'alice',
  password: 'pw',
  ...o
});
const card = (o = {}) => ({ id: 'c1', type: 'card', title: 'Visa', number: '4242424242424242', cvv: '123', ...o });
const note = (o = {}) => ({ id: 'n1', type: 'note', title: 'Wifi', body: 'secret', ...o });
const ident = (o = {}) => ({ id: 'i1', type: 'identity', title: 'Me', fullName: 'A B', email: 'a@b.c', ...o });

// ---- login ----------------------------------------------------------------

test('login: no destination match -> new; empty / non-array destination -> new', () => {
  assert.deepEqual(planCopy(login(), []), { kind: 'new' });
  assert.deepEqual(planCopy(login(), undefined), { kind: 'new' });
  assert.deepEqual(planCopy(login(), [login({ id: 'x', username: 'bob' })]), { kind: 'new' });
  assert.deepEqual(planCopy(login(), [login({ id: 'x', origin: 'https://other.com' })]), { kind: 'new' });
});

test('login: one match differing -> match; identical -> identical', () => {
  const differing = login({ id: 'd1', password: 'other' });
  assert.deepEqual(planCopy(login(), [differing]), { kind: 'match', matchIds: ['d1'] });
  const same = login({ id: 'd2', createdAt: 5, updatedAt: 9, extra: 'ignored' });
  assert.deepEqual(planCopy(login(), [same]), { kind: 'identical', matchIds: ['d2'] });
});

test('login: several matches preserve destination order; any identical -> identical', () => {
  const a = login({ id: 'a', password: 'x' });
  const b = login({ id: 'b', password: 'y' });
  assert.deepEqual(planCopy(login(), [a, b]), { kind: 'match', matchIds: ['a', 'b'] });
  const c = login({ id: 'c' });
  assert.deepEqual(planCopy(login(), [a, c, b]), { kind: 'identical', matchIds: ['a', 'c', 'b'] });
});

test('login: origin is canonicalized (path/case) before matching', () => {
  const dest = login({ id: 'd', origin: 'https://example.com', password: 'x' });
  assert.deepEqual(planCopy(login({ origin: 'https://Example.com/path' }), [dest]), { kind: 'match', matchIds: ['d'] });
});

test('login: username null vs "" vs absent share one key', () => {
  const dest = (u) => {
    const o = login({ id: 'd', password: 'x' });
    if (u === 'absent') delete o.username;
    else o.username = u;
    return o;
  };
  for (const src of [null, '', 'absent']) {
    for (const d of [null, '', 'absent']) {
      const s = login({ username: src });
      if (src === 'absent') delete s.username;
      assert.equal(planCopy(s, [dest(d)]).kind, 'match', `${src} vs ${d}`);
    }
  }
});

test('login: opaque and non-URL origins never match (either side)', () => {
  const same = (origin) => planCopy(login({ origin }), [login({ id: 'd', origin })]);
  assert.deepEqual(same('file:///x'), { kind: 'new' });
  assert.deepEqual(same('chrome://a'), { kind: 'new' });
  assert.deepEqual(same('not a url'), { kind: 'new' });
  assert.deepEqual(
    planCopy(login({ origin: 'chrome://a' }), [login({ id: 'd', origin: 'chrome://b' })]),
    { kind: 'new' },
    'chrome://a vs chrome://b'
  );
  assert.deepEqual(planCopy(login({ origin: 'https://example.com' }), [login({ id: 'd', origin: 'chrome://a' })]), {
    kind: 'new'
  });
});

test('login: matchMode absent == exact for identical; exact vs registrable-domain differs', () => {
  const dest = (mm) => {
    const o = login({ id: 'd' });
    if (mm !== undefined) o.matchMode = mm;
    return o;
  };
  assert.equal(planCopy(login(), [dest('exact')]).kind, 'identical');
  assert.equal(planCopy(login({ matchMode: 'exact' }), [dest(undefined)]).kind, 'identical');
  assert.equal(planCopy(login({ matchMode: 'exact' }), [dest('registrable-domain')]).kind, 'match');
  assert.equal(planCopy(login({ matchMode: 'registrable-domain' }), [dest('registrable-domain')]).kind, 'identical');
});

test('isIdenticalItem: undefined/null/"" alike; type mismatch is not identical', () => {
  assert.equal(isIdenticalItem(login({ notes: '' }), login({ notes: undefined })), true);
  assert.equal(isIdenticalItem(login({ totp: null }), login()), true);
  assert.equal(isIdenticalItem(login(), note()), false);
  assert.equal(isIdenticalItem(login({ notes: 'a' }), login({ notes: 'b' })), false);
});

// ---- card -----------------------------------------------------------------

test('card: digits normalization matches; differing -> match; identical -> identical', () => {
  const dest = card({ id: 'd', number: '4242424242424242', cvv: '999' });
  assert.deepEqual(planCopy(card({ number: '4242 4242 4242 4242' }), [dest]), { kind: 'match', matchIds: ['d'] });
  const same = card({ id: 's', number: '4242424242424242', cvv: '123' });
  assert.deepEqual(planCopy(card(), [same]), { kind: 'identical', matchIds: ['s'] });
  assert.deepEqual(planCopy(card({ number: '5555555555554444' }), [dest]), { kind: 'new' });
});

test('card: several matches; empty or non-string number never matches (no throw)', () => {
  const a = card({ id: 'a', cvv: '1' });
  const b = card({ id: 'b', cvv: '2' });
  assert.deepEqual(planCopy(card(), [a, b]), { kind: 'match', matchIds: ['a', 'b'] });
  assert.deepEqual(planCopy(card({ number: '' }), [card({ id: 'd', number: '' })]), { kind: 'new' });
  assert.deepEqual(planCopy(card({ number: undefined }), [card({ id: 'd', number: undefined })]), { kind: 'new' });
  assert.deepEqual(planCopy(card({ number: 4242424242424242 }), [card({ id: 'd' })]), { kind: 'new' });
  assert.deepEqual(planCopy(card(), [card({ id: 'd', number: { x: 1 } })]), { kind: 'new' });
});

// ---- note -----------------------------------------------------------------

test('note: trimmed case-sensitive title match; body differs -> match; same -> identical', () => {
  assert.deepEqual(planCopy(note({ title: '  Wifi ' }), [note({ id: 'd', body: 'other' })]), {
    kind: 'match',
    matchIds: ['d']
  });
  assert.deepEqual(planCopy(note(), [note({ id: 'd', title: 'wifi' })]), { kind: 'new' });
  assert.deepEqual(planCopy(note(), [note({ id: 'd' })]), { kind: 'identical', matchIds: ['d'] });
  assert.deepEqual(planCopy(note(), []), { kind: 'new' });
});

test('note: several matches', () => {
  const a = note({ id: 'a', body: '1' });
  const b = note({ id: 'b', body: '2' });
  assert.deepEqual(planCopy(note(), [a, b]), { kind: 'match', matchIds: ['a', 'b'] });
});

// ---- identity -------------------------------------------------------------

test('identity: any destination identity is THE match; two identities -> first only', () => {
  assert.deepEqual(planCopy(ident(), []), { kind: 'new' });
  assert.deepEqual(planCopy(ident(), [login()]), { kind: 'new' });
  assert.deepEqual(planCopy(ident(), [ident({ id: 'd', fullName: 'Z' })]), { kind: 'match', matchIds: ['d'] });
  assert.deepEqual(planCopy(ident(), [ident({ id: 'd' })]), { kind: 'identical', matchIds: ['d'] });
  const r = planCopy(ident(), [ident({ id: 'first', fullName: 'Z' }), ident({ id: 'second' })]);
  assert.deepEqual(r, { kind: 'match', matchIds: ['first'] });
});

// ---- cross-type + allowed ---------------------------------------------------

test('a different-type item with the same title never matches', () => {
  assert.deepEqual(planCopy(note({ title: 'Same' }), [login({ id: 'd', title: 'Same' })]), { kind: 'new' });
  assert.deepEqual(planCopy(login({ title: 'Same' }), [note({ id: 'd', title: 'Same' })]), { kind: 'new' });
});

test('allowedFor: one match -> three; several -> skip/keep-both; identity -> replace', () => {
  assert.deepEqual(allowedFor({ kind: 'match', matchIds: ['a'] }, login()), ['skip', 'replace', 'keep-both']);
  assert.deepEqual(allowedFor({ kind: 'match', matchIds: ['a', 'b'] }, login()), ['skip', 'keep-both']);
  assert.deepEqual(allowedFor({ kind: 'match', matchIds: ['a'] }, ident()), ['replace']);
});
