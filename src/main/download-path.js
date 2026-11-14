'use strict';

const path = require('path');

// Windows reserved device names (case-insensitive, basename-level regardless of extension).
const RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
]);

// Longest saved name, in UTF-8 bytes (a file system limit is in bytes, not characters). Chosen below the
// common 255-byte limit so the " (n)" de-duplication suffix `uniquePath` adds still fits.
const MAX_NAME_BYTES = 180;
// An extension is a final dot followed by 1-16 letters or digits; truncation keeps it.
const EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,16}$/;
// Control characters, Unicode format characters (the bidirectional overrides / isolates / marks,
// zero-width characters, the byte-order mark, the soft hyphen), line and paragraph separators, and lone
// surrogates (under the `u` flag a valid surrogate pair is one code point and never matches).
const DISGUISING_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;

/** @param {string} s */
const byteLength = (s) => Buffer.byteLength(s, 'utf8');

/**
 * Cut `stem` (by whole code points, never splitting a surrogate pair) so it fits in `budget` bytes.
 * @param {string} stem
 * @param {number} budget
 */
function cutToBytes(stem, budget) {
  let out = '';
  let used = 0;
  for (const ch of stem) {
    const n = byteLength(ch);
    if (used + n > budget) break;
    out += ch;
    used += n;
  }
  return out;
}

/**
 * Sanitize a user- or page-supplied filename for safe filesystem use.
 *
 * Rules applied in order:
 *  1. Coerce to string.
 *  2. Replace control, Unicode format (bidirectional, zero-width, BOM, soft hyphen), line/paragraph
 *     separator and lone-surrogate characters with '_' (what Chromium does in the names it derives). This
 *     runs FIRST so a reserved name hidden behind a zero-width character is neutralised too.
 *  3. Replace path separators and shell-special chars with '_'.
 *  4. Strip leading dots/space (no hidden files) and trailing dots/space (NUL. resolves to NUL on Windows).
 *  5. Neutralize '..' tokens that survived step 3.
 *  6. If the trimmed first dot-segment (uppercased) is a Windows reserved device name, prefix with '_'.
 *  7. Cap at MAX_NAME_BYTES UTF-8 bytes, cutting the stem and keeping the final extension.
 *  8. Fall back to 'download' if the result is empty or only dots/spaces.
 * @param {unknown} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  // 1. Coerce to string.
  let s = String(name == null ? '' : name);

  // 2. Disguising characters.
  s = s.replace(DISGUISING_CHARACTERS, '_');

  // 3. Replace path separators and forbidden chars.
  s = s.replace(/[/\\:*?"<>|]/g, '_');

  // 4. Strip leading dots/space and trailing dots/space.
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  // 5. Neutralize any residual '..'.
  s = s.replace(/\.\./g, '_');

  // 6. Windows reserved device names: tested on the trimmed first dot-segment, so `CON.tar.gz` and
  //    `con .txt` are caught as well as a bare `CON`.
  if (s.length > 0 && RESERVED.has(s.split('.')[0].trim().toUpperCase())) {
    s = '_' + s;
  }

  // 7. Cap length in bytes, keeping the final extension.
  if (byteLength(s) > MAX_NAME_BYTES) {
    const match = EXTENSION_PATTERN.exec(s);
    const ext = match ? match[0] : '';
    const stem = s.slice(0, s.length - ext.length);
    const cut = cutToBytes(stem, MAX_NAME_BYTES - byteLength(ext)).replace(/[.\s]+$/, '');
    s = (cut || 'download') + ext;
  }

  // 8. Fall back.
  return /^[.\s]*$/.test(s) ? 'download' : s;
}

/**
 * Return true iff `candidate` resolves to a path strictly inside `dir`
 * (not equal to `dir` itself, not a sibling whose name starts with `dir`).
 *
 * @param {string} dir       - The parent directory.
 * @param {string} candidate - The path to test.
 * @returns {boolean}
 */
function isWithinDir(dir, candidate) {
  const r = path.resolve(candidate);
  return r === path.resolve(dir) ? false : r.startsWith(path.resolve(dir) + path.sep);
}

module.exports = { sanitizeFilename, isWithinDir, MAX_NAME_BYTES };
