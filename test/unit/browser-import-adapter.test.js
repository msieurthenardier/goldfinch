'use strict';

// Unit tests for the Chrome-export adapter (M19 F1 Leg 1 / DD3, DD7, DD8,
// DD12): header detection, the row taxonomy + caps, the DD3 dedupe plan, and
// the DD11 outcome summary. Pure — no temp dirs, no scrypt; every fixture is
// built from `csv-parse.js`'s real `parseCsv` output (round-tripped through
// the actual parser) rather than hand-built record objects, so the adapter
// is exercised against real parser output end to end.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv } = require('../../src/main/vault/csv-parse');
const {
  detectChromeExport,
  originOfDiscriminated,
  adaptChromeRows,
  planLogins,
  summarizeOutcomes,
  canonicalOrigin,
  BrowserImportFormatError,
  MAX_IMPORT_ITEMS,
  MAX_FIELD_CHARS
} = require('../../src/main/vault/browser-import');

const HEADER = 'name,url,username,password,note\n';

function recordsFor(csvText) {
  return parseCsv(csvText).records;
}

// ---------------------------------------------------------------------------
// AC3 — header gate
// ---------------------------------------------------------------------------

test('AC3: detectChromeExport accepts the exact Chrome header, case-insensitive and trimmed', () => {
  assert.doesNotThrow(() => detectChromeExport(recordsFor(HEADER)));
  assert.doesNotThrow(() => detectChromeExport(recordsFor(' Name , URL , UserName , Password , Note \n')));
});

test('AC3: detectChromeExport throws BrowserImportFormatError("unrecognized-format") on a random CSV, an empty file, or a JSON blob', () => {
  const throwsUnrecognized = (records) => {
    assert.throws(
      () => detectChromeExport(records),
      (e) => e instanceof BrowserImportFormatError && e.reason === 'unrecognized-format'
    );
  };
  throwsUnrecognized(recordsFor('foo,bar,baz\n1,2,3\n'));
  throwsUnrecognized(recordsFor(''));
  throwsUnrecognized(recordsFor('{"format":"gfvaultbundle","version":1}\n'));
  throwsUnrecognized(recordsFor('name,url,username,password\n')); // wrong column count
  throwsUnrecognized([{ line: 1, malformed: true, reason: 'unexpected-quote' }]); // malformed first record
});

// ---------------------------------------------------------------------------
// AC4 — one fixture, every row class
// ---------------------------------------------------------------------------

function buildFixture() {
  const longField = 'x'.repeat(MAX_FIELD_CHARS + 1);
  const rows = [
    // normal row
    'Example,https://a.example,alice,pw-alice,a note',
    // empty username, real password
    'NoUser,https://b.example,,pw-nouser,',
    // empty name -> title falls back to host
    ',https://c.example,carol,pw-carol,',
    // empty note -> notes key absent (covered by assertion on candidate)
    'HasNote,https://d.example,dave,pw-dave,dave note',
    // malformed: wrong field count
    'TooFew,https://e.example,eve',
    // field-too-long
    `LongField,https://f.example,frank,${longField},`,
    // malformed-url
    'BadUrl,not a url at all,greg,pw-greg,',
    // non-web-origin (android app credential)
    'AndroidApp,android://somehash@com.example.app/,henry,pw-henry,',
    // no-password (federated / never-typed password)
    'Federated,https://g.example,irene,,'
  ];
  const text = HEADER + rows.join('\n') + '\n';
  return recordsFor(text);
}

test('AC4: one fixture with every row class produces exactly the expected skip/candidate set — no row dropped, never throws', () => {
  const records = buildFixture();
  assert.doesNotThrow(() => detectChromeExport(records));
  const { candidates, skipped } = adaptChromeRows(records);

  // 9 data rows total; every one accounted for.
  assert.equal(candidates.length + skipped.length, 9);

  const byReason = (reason) => skipped.filter((s) => s.reason === reason);
  assert.equal(byReason('malformed').length, 1, 'wrong field count');
  assert.equal(byReason('field-too-long').length, 1);
  assert.equal(byReason('malformed-url').length, 1);
  const nonWeb = byReason('non-web-origin');
  assert.equal(nonWeb.length, 1);
  assert.equal(nonWeb[0].scheme, 'android');
  assert.equal(byReason('no-password').length, 1);

  assert.equal(candidates.length, 4, 'normal + empty-username + empty-name + has-note');

  const normal = candidates.find((c) => c.title === 'Example');
  assert.ok(normal);
  assert.equal(normal.origin, 'https://a.example');
  assert.equal(normal.username, 'alice');
  assert.equal(normal.password, 'pw-alice');
  assert.equal(normal.notes, 'a note');

  const emptyUser = candidates.find((c) => c.origin === 'https://b.example');
  assert.ok(emptyUser);
  assert.equal(emptyUser.username, '', 'empty username preserved, not dropped');
  assert.equal(emptyUser.password, 'pw-nouser');

  const emptyName = candidates.find((c) => c.origin === 'https://c.example');
  assert.ok(emptyName);
  assert.equal(emptyName.title, 'c.example', 'title falls back to the URL host when name is empty');

  const hasNote = candidates.find((c) => c.origin === 'https://d.example');
  assert.ok(hasNote);
  assert.equal(hasNote.notes, 'dave note');

  const emptyNoteCandidate = candidates.find((c) => c.origin === 'https://b.example');
  assert.equal('notes' in emptyNoteCandidate, false, 'notes key is ABSENT (not empty string) when note is empty');
});

// ---------------------------------------------------------------------------
// AC5 — android:// rows never collide in the identity map
// ---------------------------------------------------------------------------

test('AC5: two android:// rows with different packages are both non-web-origin skips, never dedupe, and no literal "null" string appears', () => {
  const text =
    HEADER +
    'App1,android://hash1@com.example.one/,alice,pw1,\n' +
    'App2,android://hash2@com.example.two/,alice,pw1,\n'; // same username+password, different package
  const { candidates, skipped } = adaptChromeRows(recordsFor(text));
  assert.equal(candidates.length, 0);
  assert.equal(skipped.length, 2);
  for (const s of skipped) {
    assert.equal(s.reason, 'non-web-origin');
    assert.equal(s.scheme, 'android');
    assert.equal(JSON.stringify(s).includes('null'), false, 'no "null" string in the skip entry');
  }
});

test('originOfDiscriminated: android:// origin discriminates as non-web (string "null"), an unparseable url as invalid (JS null)', () => {
  const androidResult = originOfDiscriminated('android://somehash@com.example.app/');
  assert.equal(androidResult.kind, 'non-web');
  assert.equal(androidResult.scheme, 'android');

  const invalidResult = originOfDiscriminated('not a url');
  assert.equal(invalidResult.kind, 'invalid');

  const emptyResult = originOfDiscriminated('');
  assert.equal(emptyResult.kind, 'invalid');

  const webResult = originOfDiscriminated('https://example.com/path?x=1');
  assert.equal(webResult.kind, 'web');
  assert.equal(webResult.origin, 'https://example.com');
});

// ---------------------------------------------------------------------------
// AC6 — row cap
// ---------------------------------------------------------------------------

function fixtureWithRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(`Row${i},https://site${i}.example,user${i},pw${i},`);
  }
  return HEADER + rows.join('\n') + '\n';
}

test('AC6: MAX_IMPORT_ITEMS + 1 data records throws too-many-rows; MAX_IMPORT_ITEMS exactly is accepted', () => {
  const overRecords = recordsFor(fixtureWithRows(MAX_IMPORT_ITEMS + 1));
  assert.throws(
    () => adaptChromeRows(overRecords),
    (e) => e instanceof BrowserImportFormatError && e.reason === 'too-many-rows'
  );

  const exactRecords = recordsFor(fixtureWithRows(MAX_IMPORT_ITEMS));
  const { candidates, skipped } = adaptChromeRows(exactRecords);
  assert.equal(candidates.length + skipped.length, MAX_IMPORT_ITEMS);
});

test('AC6: the exported MAX_IMPORT_ITEMS equals the vault-store re-exported constant (one literal, cross-module assert)', () => {
  const vs = require('../../src/main/vault/vault-store');
  assert.equal(vs.MAX_IMPORT_ITEMS, MAX_IMPORT_ITEMS);
});

// ---------------------------------------------------------------------------
// AC7 — dedupe trichotomy
// ---------------------------------------------------------------------------

function candidateRow(overrides = {}) {
  return { line: 1, title: 'A', origin: 'https://a.example', username: 'alice', password: 'pw-a', ...overrides };
}
function loginItemFixture(overrides = {}) {
  return {
    id: 'existing-a',
    type: 'login',
    title: 'Existing A',
    origin: 'https://a.example',
    username: 'alice',
    password: 'pw-a',
    ...overrides
  };
}

test('AC7: the trichotomy — identical duplicate, changed password, changed-title-only duplicate, new — in one scenario', () => {
  const existing = [loginItemFixture()];
  const candidates = [
    candidateRow({ line: 1 }), // identical
    candidateRow({ line: 2, password: 'pw-a-changed' }), // changed password
    candidateRow({ line: 3, title: 'Different Title Only' }), // same secrets, different title -> duplicate
    candidateRow({ line: 4, origin: 'https://b.example', username: 'bob', password: 'pw-b' }) // new
  ];
  const plan = planLogins(candidates, existing);
  assert.deepEqual(
    plan.map((p) => p.kind),
    ['duplicate', 'changed', 'duplicate', 'new']
  );
});

test('AC7: login.example.com and mail.example.com with the same username are distinct identities', () => {
  const existing = [loginItemFixture({ origin: 'https://login.example.com', username: 'alice' })];
  const candidates = [candidateRow({ origin: 'https://mail.example.com', username: 'alice', password: 'pw-a' })];
  const plan = planLogins(candidates, existing);
  assert.equal(plan[0].kind, 'new', 'distinct subdomains are distinct identities, never merged');
});

test('AC7: a destination card/note item never participates in the identity map', () => {
  const existing = [
    { id: 'card-1', type: 'card', title: 'My Card', number: '4111', origin: 'https://a.example' },
    { id: 'note-1', type: 'note', title: 'My Note', body: 'secret' }
  ];
  const candidates = [candidateRow()];
  const plan = planLogins(candidates, existing);
  assert.equal(plan[0].kind, 'new', 'non-login items are never matched against');
});

test('AC7: an existing login carrying totp with a matching password/notes incoming row is duplicate (totp is never compared)', () => {
  const existing = [loginItemFixture({ totp: 'JBSWY3DPEHPK3PXP', notes: 'shared note' })];
  const candidates = [candidateRow({ notes: 'shared note' })];
  const plan = planLogins(candidates, existing);
  assert.equal(plan[0].kind, 'duplicate', 'totp is not part of the secret comparison — no totp-less copy is minted');
});

// ---------------------------------------------------------------------------
// AC8 — intra-file duplicates
// ---------------------------------------------------------------------------

test('AC8: intra-file duplicates — identical second row is duplicate; differing-password second row is changed', () => {
  const identicalPlan = planLogins([candidateRow({ line: 1 }), candidateRow({ line: 2 })], []);
  assert.deepEqual(
    identicalPlan.map((p) => p.kind),
    ['new', 'duplicate']
  );

  const changedPlan = planLogins([candidateRow({ line: 1 }), candidateRow({ line: 2, password: 'pw-a-2' })], []);
  assert.deepEqual(
    changedPlan.map((p) => p.kind),
    ['new', 'changed']
  );
});

test('canonicalOrigin: an unparseable stored origin never matches (returns null, never throws)', () => {
  assert.equal(canonicalOrigin('not a url'), null);
  assert.equal(canonicalOrigin('https://a.example/'), 'https://a.example');
});

test('a destination login with an unparseable stored origin can never dedupe against any incoming candidate', () => {
  const existing = [loginItemFixture({ origin: 'not-a-valid-origin' })];
  const plan = planLogins([candidateRow()], existing);
  assert.equal(plan[0].kind, 'new');
});

// ---------------------------------------------------------------------------
// AC16 — summarizeOutcomes
// ---------------------------------------------------------------------------

test('AC16: summarizeOutcomes folds a mixed fixture into correct counts, coercing unknown/malformed entries safely', () => {
  const skipped = [
    { line: 1, reason: 'malformed' },
    { line: 2, reason: 'malformed' },
    { line: 3, reason: 'non-web-origin', scheme: 'android' },
    { line: 4 } // no reason at all -> coerced to 'unknown', never throws/NaN
  ];
  const results = [
    { line: 5, outcome: 'imported' },
    { line: 6, outcome: 'imported' },
    { line: 7, outcome: 'duplicate' },
    { line: 8, outcome: 'changed' },
    { line: 9, outcome: 'failed', reason: 'boom' },
    { line: 10, outcome: 'something-unexpected' } // coerced into failed
  ];
  const summary = summarizeOutcomes(skipped, results);
  assert.deepEqual(summary, {
    imported: 2,
    duplicate: 1,
    changed: 1,
    failed: 2,
    unmappable: {
      total: 4,
      byReason: { malformed: 2, 'non-web-origin': 1, unknown: 1 }
    }
  });
});

test('summarizeOutcomes never throws on empty/malformed input', () => {
  assert.doesNotThrow(() => summarizeOutcomes([], []));
  assert.doesNotThrow(() => summarizeOutcomes(undefined, undefined));
  const summary = summarizeOutcomes(undefined, undefined);
  assert.equal(summary.unmappable.total, 0);
  assert.equal(summary.imported, 0);
});
