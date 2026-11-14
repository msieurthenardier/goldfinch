'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { sanitizeFilename, isWithinDir, MAX_NAME_BYTES } = require('../../src/main/download-path');

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

test('sanitizeFilename: very long name is capped at 180 bytes (extension-preserving rule)', () => {
  const long = 'a'.repeat(300);
  const result = sanitizeFilename(long);
  assert.ok(Buffer.byteLength(result) <= MAX_NAME_BYTES, `length ${result.length} exceeds the cap`);
  assert.equal(result.length, MAX_NAME_BYTES, 'a plain ASCII name is cut to exactly the cap');
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
// Mission 23 Flight 1 (leg `downloads`): disguising characters, reserved names, byte-measured truncation
// ---------------------------------------------------------------------------

const DISGUISES = {
  'right-to-left override U+202E': '\u202E',
  'left-to-right override U+202D': '\u202D',
  'left-to-right embedding U+202A': '\u202A',
  'right-to-left embedding U+202B': '\u202B',
  'pop directional formatting U+202C': '\u202C',
  'left-to-right isolate U+2066': '\u2066',
  'right-to-left isolate U+2067': '\u2067',
  'first strong isolate U+2068': '\u2068',
  'pop directional isolate U+2069': '\u2069',
  'left-to-right mark U+200E': '\u200E',
  'right-to-left mark U+200F': '\u200F',
  'arabic letter mark U+061C': '\u061C',
  'zero-width space U+200B': '\u200B',
  'zero-width non-joiner U+200C': '\u200C',
  'zero-width joiner U+200D': '\u200D',
  'word joiner U+2060': '\u2060',
  'byte-order mark U+FEFF': '\uFEFF',
  'soft hyphen U+00AD': '\u00AD',
  'line separator U+2028': '\u2028',
  'paragraph separator U+2029': '\u2029',
  'NUL U+0000': '\u0000',
  'tab U+0009': '\t',
  'newline U+000A': '\n',
  'DEL U+007F': '\u007F',
  'C1 control U+0085': '\u0085'
};

for (const [label, ch] of Object.entries(DISGUISES)) {
  test(`sanitizeFilename: replaces ${label} with an underscore`, () => {
    assert.equal(sanitizeFilename(`invoice${ch}fdp.pdf`), 'invoice_fdp.pdf');
  });
}

test('sanitizeFilename: a lone surrogate is replaced, a valid pair is kept whole', () => {
  assert.equal(sanitizeFilename('a\ud800b.txt'), 'a_b.txt');
  assert.equal(sanitizeFilename('a\udc00b.txt'), 'a_b.txt');
  assert.equal(sanitizeFilename('a\u{1F600}b.txt'), 'a\u{1F600}b.txt');
});

test('sanitizeFilename: the result never contains a control or format character', () => {
  const hostile = Object.values(DISGUISES).join('x');
  const result = sanitizeFilename(`${hostile}.exe`);
  assert.ok(
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(result),
    `disguising character left in ${JSON.stringify(result)}`
  );
});

test('sanitizeFilename: reserved device names are tested on the trimmed first dot-segment', () => {
  assert.equal(sanitizeFilename('CON.tar.gz'), '_CON.tar.gz');
  assert.equal(sanitizeFilename('con .txt'), '_con .txt');
  assert.equal(sanitizeFilename('Com1.a.b.c'), '_Com1.a.b.c');
  // A zero-width character inside the name is replaced first, so it is no longer a device name at all.
  const hidden = sanitizeFilename('C\u200BON');
  assert.equal(hidden, 'C_ON');
  assert.ok(!hidden.includes('\u200B'));
  // A zero-width character AFTER the name is replaced first too: `CON_` is not a device name either.
  assert.equal(sanitizeFilename('CON\u200B.txt'), 'CON_.txt');
});

test('sanitizeFilename: a long name keeps its final extension', () => {
  const result = sanitizeFilename(`${'a'.repeat(300)}.exe`);
  assert.ok(result.endsWith('.exe'), result);
  assert.equal(Buffer.byteLength(result), MAX_NAME_BYTES);
});

test('sanitizeFilename: a long non-Latin name is limited in bytes and never splits a character', () => {
  const result = sanitizeFilename(`${'\u00E9'.repeat(200)}.txt`);
  assert.ok(Buffer.byteLength(result) <= MAX_NAME_BYTES, `${Buffer.byteLength(result)} bytes`);
  assert.ok(result.endsWith('.txt'));
  assert.ok(!result.includes('\uFFFD'));
  const emoji = sanitizeFilename(`${'\u{1F600}'.repeat(100)}.png`);
  assert.ok(Buffer.byteLength(emoji) <= MAX_NAME_BYTES);
  assert.ok(emoji.endsWith('.png'));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji), 'a surrogate pair was split');
  assert.ok(!/(?<![\ud800-\udbff])[\udc00-\udfff]/.test(emoji), 'a surrogate pair was split');
});

test('sanitizeFilename: a name without a plain extension is cut whole', () => {
  const result = sanitizeFilename(`${'a'.repeat(250)}.${'b'.repeat(40)}`);
  assert.ok(Buffer.byteLength(result) <= MAX_NAME_BYTES);
  assert.ok(result.length > 0);
});

test('sanitizeFilename: never returns an empty name, dots, spaces, or a name ending in a dot or space', () => {
  for (const input of ['', ' ', '. .', '...', '\u202E', '\u200B\u200B', 'a. ', 'a .', ' a ', 'a.\u200B', '.\u202E.']) {
    const result = sanitizeFilename(input);
    assert.ok(result.length > 0, `empty for ${JSON.stringify(input)}`);
    assert.ok(!/^[.\s]+$/.test(result), `dots/spaces only for ${JSON.stringify(input)}: ${JSON.stringify(result)}`);
    assert.ok(!/[.\s]$/.test(result), `ends in dot/space for ${JSON.stringify(input)}: ${JSON.stringify(result)}`);
  }
  assert.equal(sanitizeFilename('.exe'), 'exe', 'a name that is only an extension loses its leading dot');
});

test('sanitizeFilename: separators, shell-special characters and traversal are unchanged', () => {
  assert.equal(sanitizeFilename('a:b*c?d"e<f>g|h'), 'a_b_c_d_e_f_g_h');
  assert.equal(sanitizeFilename('a..b'), 'a_b');
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
