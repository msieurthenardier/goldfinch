// @ts-check

// Splits a download file name into a stem (may shrink with an ellipsis in the
// downloads popup) and an extension (never shrinks), so a long name cannot hide
// its extension (squawk 0179). Display only; the saved name is untouched.
//
// The extension rule is the one in src/main/download-path.js (EXTENSION_PATTERN:
// final dot + 1-16 letters or digits); download-name-split.test.js is the drift
// guard. A name with no such tail, a dot-file (`.bashrc`) or a trailing dot is
// all stem. `stem + ext` always equals the input.
const EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,16}$/;

/**
 * @param {string} name
 * @returns {{ stem: string, ext: string }}
 */
export function splitDownloadName(name) {
  const s = String(name == null ? '' : name);
  const match = EXTENSION_PATTERN.exec(s);
  if (!match || match.index === 0) return { stem: s, ext: '' };
  return { stem: s.slice(0, match.index), ext: match[0] };
}

export { EXTENSION_PATTERN };
