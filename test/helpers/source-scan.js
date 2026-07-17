'use strict';

// Shared source-scan toolkit (M09 Flight 8, Leg 1) — the text-scanning primitives the
// repo's source-scan invariant tests are built from, extracted from the two suites that
// each carried their own copy:
//
//   test/unit/broadcast-invariant.test.js    (M06 F4 L1 — the ORIGINAL)
//   test/unit/window-closed-invariant.test.js (M09 F7 L1 — a later transcription)
//
// Extraction was proven by BYTE-IDENTITY of the function bodies against the copies
// deleted, not by "both suites still pass" — a toolkit that masks everything makes a
// source-scan net pass vacuously, so "still green" is the exact non-evidence these nets
// exist to warn about. (M09 F8 L1 AC1.)
//
// ---------------------------------------------------------------------------
// THE THREE TEXT DIVERGENCES, AND WHICH TEXT SURVIVED
// ---------------------------------------------------------------------------
// The two copies were code-identical but text-divergent in three places. Ruled here so
// the ruling is discoverable at the toolkit rather than re-litigated at each caller:
//
//   (a) findMatchingBracket BODIES were byte-identical (503 bytes each); the DOCSTRINGS
//       differed substantially. broadcast-invariant's survives: it states the
//       PRECONDITION (masked[openIdx] must equal `open`) and the REASON for the string
//       skipping (a quoted bracket would desync the depth count). window-closed's was a
//       terser restatement that carried neither.
//   (b) maskComments DOCSTRINGS differed. A merged, caller-neutral docstring survives:
//       broadcast's was more complete but named ITS OWN callers ("registration-site
//       regexes", "marker checks"), which is wrong in a shared toolkit. The load-bearing
//       invariant both stated — output is the SAME LENGTH as the input, so indices found
//       against the masked copy are valid offsets into the original — is kept verbatim.
//   (c) maskComments BODIES differed by exactly TWO inline comments, present in
//       broadcast-invariant and dropped by window-closed's transcription:
//         `// closing quote`
//         `// the newline itself (if any) is handled by the default branch`
//       broadcast-invariant's body survives BYTE-FOR-BYTE. It is the original, and both
//       comments explain genuinely non-obvious branches. The later copy dropped them;
//       nothing was gained by the drop, so it is not the version to standardise on.
//
// Consequence, stated plainly: the extracted maskComments body is byte-identical to
// broadcast-invariant's deleted copy and differs from window-closed's deleted copy by
// exactly those two comments. Byte-identity against BOTH was not available — the copies
// disagreed — so it was ruled, not assumed.
//
// ---------------------------------------------------------------------------
// KNOWN BLIND SPOT — REGEX LITERALS (recorded, deliberately NOT fixed)
// ---------------------------------------------------------------------------
// maskComments does not understand regex literals. It tracks quote parity, so a regex
// containing an ODD number of quote characters — `/don't/`, `/['"]/` — reads as an
// opening quote, INVERTS quote parity, and silently disables comment masking for the
// rest of the file. Everything after it is then scanned as if it were code, and prose
// in comments can trip (or satisfy) a net.
//
// Currently LATENT: `grep -cE "/\[[^]]*['\"]" src/main/main.js` → 0. Severity is low
// because the failure is LOUD, not silent — an inverted mask leaves half the file's
// comments unmasked, which lights up the nets rather than quieting them. It is recorded
// here and not fixed because fixing it means teaching this scanner to distinguish a
// regex literal from division, which needs a parser, and the whole point of this toolkit
// is that it is deliberately dumb.
//
// WHY IT IS RECORDED ANYWAY: M09 F8 leg 4 adds code to src/main/main.js, and NEITHER
// original docstring mentioned this. A leg-4 author writing `/['"]/` would break the
// DD1 pin's masking and have no way to know this was a known shape.

const fs = require('fs');
const path = require('path');

/**
 * Replace every // line comment and /* block comment *\/ body with spaces (newlines
 * preserved), leaving string/template literal contents untouched, so text that only
 * appears in a COMMENT can never trip (or satisfy) a scan.
 *
 * Output is the SAME LENGTH as the input, so indices found against the masked copy are
 * valid offsets into the original. Callers rely on this — do not "optimise" it into a
 * splice.
 *
 * String literal contents are left untouched (so `'http://...'` keeps its `//`; the
 * string branch never re-enters comment detection while inside quotes).
 *
 * KNOWN BLIND SPOT: regex literals — see the file header.
 * @param {string} source
 * @returns {string}
 */
function maskComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i] + source[i + 1];
          i += 2;
        } else {
          out += source[i];
          i++;
        }
      }
      if (i < n) {
        out += source[i]; // closing quote
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue; // the newline itself (if any) is handled by the default branch
    }
    if (ch === '/' && source[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Find the index of the bracket matching `open` at `openIdx` (masked[openIdx] must
 * equal `open`), skipping over string/template literal contents so a quoted
 * `(`/`)`/`{`/`}` never desyncs the depth count. Operates on already comment-masked
 * text.
 * @param {string} masked
 * @param {number} openIdx
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
function findMatchingBracket(masked, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < masked.length && masked[i] !== quote) {
        if (masked[i] === '\\') i++;
        i++;
      }
    }
  }
  return -1;
}

/**
 * Every .js file under `dir`, recursively. Callers scan the whole tree rather than a
 * named file so that a pin survives its subject being factored into a new module — the
 * pin fails on the missing SUBJECT (a vacuity guard's job) rather than on the file walk
 * quietly not looking there.
 * @param {string} dir
 * @returns {string[]}
 */
function collectSources(dir) {
  /** @type {string[]} */
  const out = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...collectSources(full));
    else if (dirent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

module.exports = { maskComments, findMatchingBracket, collectSources };
