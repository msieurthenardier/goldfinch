// @ts-check
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

/**
 * Sanitize a user- or page-supplied filename for safe filesystem use.
 *
 * Rules applied in order:
 *  1. Coerce to string.
 *  2. Replace path separators and shell-special chars with '_'.
 *  3. Strip leading dots (no hidden files).
 *  4. Strip trailing dots (NUL. resolves to NUL on Windows).
 *  5. Neutralize '..' tokens that survived step 2.
 *  6. Trim whitespace.
 *  7. If the basename (sans extension, uppercased) is a Windows reserved device
 *     name, prefix the whole thing with '_'.
 *  8. Cap at 180 characters.
 *  9. Fall back to 'download' if the result is empty.
 */
function sanitizeFilename(name) {
  // 1. Coerce to string.
  let s = String(name == null ? '' : name);

  // 2. Replace path separators and forbidden chars.
  s = s.replace(/[/\\:*?"<>|]/g, '_');

  // 3. Strip leading dots.
  s = s.replace(/^\.+/, '');

  // 4. Strip trailing dots.
  s = s.replace(/\.+$/, '');

  // 5. Neutralize any residual '..' (after separator stripping they look like
  //    '__' already, but belt-and-suspenders: replace the literal string '..').
  s = s.replace(/\.\./g, '_');

  // 6. Trim whitespace.
  s = s.trim();

  // 7. Check Windows reserved device names (basename without extension).
  if (s.length > 0) {
    const ext = path.extname(s);
    const base = path.basename(s, ext);
    if (RESERVED.has(base.toUpperCase())) {
      s = '_' + s;
    }
  }

  // 8. Cap length.
  s = s.slice(0, 180);

  // 9. Fall back.
  return s || 'download';
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

module.exports = { sanitizeFilename, isWithinDir };
