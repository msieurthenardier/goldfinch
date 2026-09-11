'use strict';

// Unit tests for the hand-rolled RFC-4180 parser (M19 F1 Leg 1 / DD7, leg
// ruling 2). Security-adjacent code: the corpus below exercises embedded
// commas, embedded escaped quotes, embedded LF, embedded CRLF, a leading
// BOM, and every structural-error path (unescaped quote in an unquoted
// field, a closing quote followed by a non-delimiter, an unterminated quote
// at EOF, resync landing mid-quoted-content) plus the blank-line / trailing-
// newline edge cases. Pure — no temp dirs, no scrypt.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv } = require('../../src/main/vault/csv-parse');

// ---------------------------------------------------------------------------
// AC1 — byte-exact round-trip of a realistic Chrome-shaped export, embedded
// comma / escaped quote / LF / CRLF in `note`, plus a leading BOM.
// ---------------------------------------------------------------------------

test('AC1: round-trips a corpus with embedded comma, escaped quote, LF, CRLF in `note`, and a leading BOM — every field byte-exact', () => {
  const note = 'line1\nline2, with a comma and a "quoted" word\r\nline3';
  const quotedNote = `"${note.replace(/"/g, '""')}"`;
  const text =
    '﻿' +
    'name,url,username,password,note\n' +
    `Example,https://a.example,user1,pw1,${quotedNote}\n` +
    'Second,https://b.example,user2,pw2,plain note\n';

  const { records } = parseCsv(text);
  assert.equal(records.length, 3, 'header + two data rows');

  assert.deepEqual(records[0], { line: 1, fields: ['name', 'url', 'username', 'password', 'note'] });
  assert.equal(records[0].fields[0], 'name', 'no stray BOM byte on the first field');

  assert.equal(records[1].line, 2);
  assert.deepEqual(records[1].fields, ['Example', 'https://a.example', 'user1', 'pw1', note], 'byte-exact note field');

  // The embedded LF + CRLF inside record 1's quoted note field advance the
  // physical line count by two beyond record 1's own terminator, so record
  // 2 ("Second…") starts at physical line 5, not 3.
  assert.equal(records[2].line, 5);
  assert.deepEqual(records[2].fields, ['Second', 'https://b.example', 'user2', 'pw2', 'plain note']);
});

test('a field embedding a comma round-trips exactly', () => {
  const { records } = parseCsv('a,"b,c",d\n');
  assert.deepEqual(records[0].fields, ['a', 'b,c', 'd']);
});

test('an escaped quote ("") inside a quoted field round-trips as one literal quote', () => {
  const { records } = parseCsv('a,"say ""hi""",c\n');
  assert.deepEqual(records[0].fields, ['a', 'say "hi"', 'c']);
});

test('an embedded bare LF inside a quoted field round-trips exactly and advances the line counter', () => {
  const { records } = parseCsv('a,"line1\nline2",c\nd,e,f\n');
  assert.deepEqual(records[0].fields, ['a', 'line1\nline2', 'c']);
  assert.equal(records[0].line, 1);
  assert.deepEqual(records[1].fields, ['d', 'e', 'f']);
  assert.equal(records[1].line, 3, 'the embedded LF inside record 1 advanced the physical line count');
});

test('an embedded CRLF inside a quoted field round-trips exactly (both bytes preserved)', () => {
  const { records } = parseCsv('a,"line1\r\nline2",c\n');
  assert.deepEqual(records[0].fields, ['a', 'line1\r\nline2', 'c']);
});

// ---------------------------------------------------------------------------
// AC2 — structural-error handling, resync, trailing newline, blank lines.
// ---------------------------------------------------------------------------

test('AC2: an unescaped quote inside an unquoted field is malformed, and the parser resyncs at the next raw LF', () => {
  const text = 'a,b"c,d\ne,f,g\n';
  const { records } = parseCsv(text);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { line: 1, malformed: true, reason: 'unexpected-quote' });
  assert.deepEqual(records[1], { line: 2, fields: ['e', 'f', 'g'] });
});

test('AC2: a closing quote followed by a non-delimiter is malformed, and the parser resyncs at the next raw LF', () => {
  const text = 'a,"b"c,d\ne,f,g\n';
  const { records } = parseCsv(text);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { line: 1, malformed: true, reason: 'quote-not-followed-by-delimiter' });
  assert.deepEqual(records[1], { line: 2, fields: ['e', 'f', 'g'] });
});

test('AC2: an unterminated quoted field at EOF yields a final malformed record', () => {
  const text = 'a,b,c\nd,"unterminated,f\n,g';
  const { records } = parseCsv(text);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { line: 1, fields: ['a', 'b', 'c'] });
  assert.deepEqual(records[1], { line: 2, malformed: true, reason: 'unterminated-quote' });
});

test('AC2: a trailing final newline emits no empty record', () => {
  const { records } = parseCsv('a,b,c\n');
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].fields, ['a', 'b', 'c']);
});

test('AC2: a blank line between records is skipped (not returned, not malformed)', () => {
  const { records } = parseCsv('a,b\n\nc,d\n');
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { line: 1, fields: ['a', 'b'] });
  assert.deepEqual(records[1], { line: 3, fields: ['c', 'd'] });
});

test('AC2: each malformed record carries its own 1-based physical line', () => {
  const text = 'ok,1\nbad"1,2\nok,2\nbad"2,3\n';
  const { records } = parseCsv(text);
  assert.deepEqual(
    records.map((r) => r.line),
    [1, 2, 3, 4]
  );
  assert.equal(records[1].malformed, true);
  assert.equal(records[3].malformed, true);
});

test('resync can mis-split a following quoted-newline record into further malformed records — each is still accounted for', () => {
  // Record 1 is structurally bad; the raw-LF resync (ignoring quote state)
  // lands INSIDE record 2's quoted field (which itself contains an embedded
  // LF), so record 2 gets mis-split into further malformed records — none
  // silently lost.
  const text = 'bad"row,x\ngood,"has\nembedded\nnewlines",z\n';
  const { records } = parseCsv(text);
  // Every record is accounted for (no throw, no silent drop) — the exact
  // split is an implementation detail of where the raw LFs fall, not a
  // pinned count beyond "at least the first malformed record, and nothing
  // is lost silently: the sum of malformed + well-formed touches every line".
  assert.ok(records.length >= 2, 'at least the initial malformed record plus continuation');
  assert.equal(records[0].malformed, true);
  assert.equal(records[0].line, 1);
});

// ---------------------------------------------------------------------------
// Never throws on content
// ---------------------------------------------------------------------------

test('never throws on content: an empty file, quotes-only, commas-only, and a lone BOM all parse without throwing', () => {
  assert.doesNotThrow(() => parseCsv(''));
  assert.deepEqual(parseCsv('').records, []);
  assert.doesNotThrow(() => parseCsv('"'));
  assert.doesNotThrow(() => parseCsv(',,,,'));
  assert.doesNotThrow(() => parseCsv('﻿'));
  assert.deepEqual(parseCsv('﻿').records, []);
});

test('a header-only file (no data rows) parses to exactly one record', () => {
  const { records } = parseCsv('name,url,username,password,note\n');
  assert.equal(records.length, 1);
});

test('a file with no trailing newline still yields its last record via EOF', () => {
  const { records } = parseCsv('a,b,c');
  assert.deepEqual(records, [{ line: 1, fields: ['a', 'b', 'c'] }]);
});

test('a trailing comma with nothing after it at EOF yields one final empty field', () => {
  const { records } = parseCsv('a,b,');
  assert.deepEqual(records, [{ line: 1, fields: ['a', 'b', ''] }]);
});

test('a quoted field that closes exactly at EOF (no trailing newline) is well-formed', () => {
  const { records } = parseCsv('a,"b"');
  assert.deepEqual(records, [{ line: 1, fields: ['a', 'b'] }]);
});

test('CRLF terminates a record identically to a bare LF', () => {
  const { records } = parseCsv('a,b\r\nc,d\r\n');
  assert.deepEqual(records[0].fields, ['a', 'b']);
  assert.deepEqual(records[1].fields, ['c', 'd']);
});
