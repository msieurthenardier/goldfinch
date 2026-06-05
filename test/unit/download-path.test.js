'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { sanitizeFilename, isWithinDir } = require('../../src/main/download-path');

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

test('sanitizeFilename: strips path separators (existing behavior)', () => {
  assert.equal(sanitizeFilename('foo/bar'), 'foo_bar');
  assert.equal(sanitizeFilename('foo\\bar'), 'foo_bar');
});

test('sanitizeFilename: neutralizes traversal sequences', () => {
  const result = sanitizeFilename('../../etc/passwd');
  // Must not contain path separators or raw '..'
  assert.ok(!result.includes('/'), 'must not contain forward slash');
  assert.ok(!result.includes('\\'), 'must not contain backslash');
  assert.ok(!result.includes('..'), 'must not contain ..');
  // Must not be empty
  assert.ok(result.length > 0);
});

test('sanitizeFilename: strips leading dots (no hidden files)', () => {
  assert.equal(sanitizeFilename('.bashrc'), 'bashrc');
  assert.equal(sanitizeFilename('...hidden'), 'hidden');
  assert.equal(sanitizeFilename('.'), 'download');
});

test('sanitizeFilename: strips trailing dots', () => {
  const result = sanitizeFilename('NUL.');
  assert.ok(!result.endsWith('.'), `trailing dot present in: ${result}`);
});

test('sanitizeFilename: prefixes Windows reserved name CON', () => {
  assert.equal(sanitizeFilename('CON'), '_CON');
});

test('sanitizeFilename: prefixes reserved name case-insensitively (con)', () => {
  assert.equal(sanitizeFilename('con'), '_con');
});

test('sanitizeFilename: prefixes reserved name with extension (con.txt)', () => {
  assert.equal(sanitizeFilename('con.txt'), '_con.txt');
});

test('sanitizeFilename: prefixes reserved name LPT1', () => {
  assert.equal(sanitizeFilename('LPT1'), '_LPT1');
});

test('sanitizeFilename: prefixes reserved name NUL', () => {
  assert.equal(sanitizeFilename('NUL'), '_NUL');
});

test('sanitizeFilename: prefixes reserved name PRN', () => {
  assert.equal(sanitizeFilename('PRN'), '_PRN');
});

test('sanitizeFilename: trailing-dot reserved name (NUL.) becomes safe', () => {
  // NUL. -> strip trailing dot -> NUL -> prefix -> _NUL
  const result = sanitizeFilename('NUL.');
  assert.ok(result === '_NUL', `expected _NUL, got ${result}`);
});

test('sanitizeFilename: empty string falls back to download', () => {
  assert.equal(sanitizeFilename(''), 'download');
});

test('sanitizeFilename: all-dots string falls back to download', () => {
  assert.equal(sanitizeFilename('...'), 'download');
  assert.equal(sanitizeFilename('..'), 'download');
});

test('sanitizeFilename: whitespace-only string falls back to download', () => {
  assert.equal(sanitizeFilename('   '), 'download');
});

test('sanitizeFilename: null/undefined falls back to download', () => {
  assert.equal(sanitizeFilename(null), 'download');
  assert.equal(sanitizeFilename(undefined), 'download');
});

test('sanitizeFilename: falsy 0 produces safe name', () => {
  // 0 is falsy but String(0) = '0' which is a valid filename
  const result = sanitizeFilename(0);
  assert.ok(result === '0' || result === 'download', `got: ${result}`);
});

test('sanitizeFilename: very long name is capped at 180 chars', () => {
  const long = 'a'.repeat(300);
  const result = sanitizeFilename(long);
  assert.ok(result.length <= 180, `length ${result.length} exceeds 180`);
});

test('sanitizeFilename: normal filename is unchanged', () => {
  assert.equal(sanitizeFilename('video.mp4'), 'video.mp4');
  assert.equal(sanitizeFilename('photo (1).jpg'), 'photo (1).jpg');
});

test('sanitizeFilename: falsy suggestedName (empty string) produces safe fallback', () => {
  // Simulates the will-download fallback: (meta.suggestedName) || item.getFilename() || 'download'
  // When suggestedName is '' (falsy), the fallback 'download' string would be used.
  // sanitizeFilename on 'download' must return a valid non-empty string.
  const result = sanitizeFilename('download');
  assert.equal(result, 'download');
});

// ---------------------------------------------------------------------------
// isWithinDir
// ---------------------------------------------------------------------------

test('isWithinDir: file inside dir is accepted', () => {
  const dir = '/tmp/downloads';
  const candidate = '/tmp/downloads/video.mp4';
  assert.equal(isWithinDir(dir, candidate), true);
});

test('isWithinDir: dir itself is rejected (not a file within it)', () => {
  const dir = '/tmp/downloads';
  assert.equal(isWithinDir(dir, dir), false);
});

test('isWithinDir: parent directory is rejected', () => {
  const dir = '/tmp/downloads';
  assert.equal(isWithinDir(dir, '/tmp'), false);
});

test('isWithinDir: sibling-prefix path is rejected', () => {
  // /foo/bar vs /foo/bar-evil — the latter is NOT within /foo/bar
  assert.equal(isWithinDir('/foo/bar', '/foo/bar-evil'), false);
});

test('isWithinDir: sibling-prefix path with trailing sep is rejected', () => {
  assert.equal(isWithinDir('/foo/bar', '/foo/bar-evil/file.txt'), false);
});

test('isWithinDir: nested file deep within dir is accepted', () => {
  assert.equal(isWithinDir('/tmp/downloads', '/tmp/downloads/sub/dir/file.mp4'), true);
});

test('isWithinDir: path outside dir is rejected', () => {
  assert.equal(isWithinDir('/tmp/downloads', '/etc/passwd'), false);
});

test('isWithinDir: relative candidate resolved against cwd stays inside dir when expected', () => {
  // Use actual cwd-based paths to test resolution
  const dir = path.resolve('/tmp/downloads');
  const candidate = path.resolve('/tmp/downloads/test.mp4');
  assert.equal(isWithinDir(dir, candidate), true);
});

test('isWithinDir: traversal candidate is rejected', () => {
  // Even if someone constructs a path like /tmp/downloads/../etc/passwd
  assert.equal(isWithinDir('/tmp/downloads', '/tmp/downloads/../etc/passwd'), false);
});

// ---------------------------------------------------------------------------
// Integration: dedup suffix stays within dir
// ---------------------------------------------------------------------------

test('dedup-suffix scenario: filenames with dedup suffix stay within dir', () => {
  // Simulate what uniquePath produces: dir/base (1).ext
  const dir = '/tmp/downloads';
  const dedupFile = '/tmp/downloads/video (1).mp4';
  assert.equal(isWithinDir(dir, dedupFile), true);
});
