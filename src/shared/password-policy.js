// @ts-check

// Pure password-generation POLICY module (Mission 21, Flight 4, Leg 3 —
// generate-in-picker, DD6). Sits between a clicked field's raw attribute
// values and the existing `password-generator.js`: parses the WebKit
// `passwordrules` core, resolves the widest satisfiable generation policy
// (length / required classes / alphabet / max-consecutive), and produces the
// 1-2 candidate strings main sends to the guest (DD6's "no guest->main retry
// channel" — two candidates up front, the isolated world picks one against
// `pattern`).
//
// Pure, no DOM, no Electron: reachable from main via `require()` (Node's
// synchronous `require(esm)`, the `settings-store.js` / `search-engines.js`
// precedent) and from the isolated-world observer bundle via `import`.
//
// `sanitizeGenerateConstraints` is the boundary validator for the small,
// page-influenced payload the in-field badge's gesture carries (flight DD5):
// every field is re-validated here — literal shape, integer bounds, string
// length — before anything downstream (`resolvePolicy`) ever sees it. Main
// re-runs this on the CHOSEN constraints too (never trusting the chrome to
// have kept them intact), so availability (`resolvePolicy(...).ok`) and
// generation are always decided by the SAME function against the SAME
// validated input.

import { generatePassword, CLASSES, CLASS_NAMES } from './password-generator.js';

// The WebKit `passwordrules` "special" character class (AC2) — copied
// verbatim from the flight spec's literal set.
const SPECIAL_CHARS = '-~!@#$%^&*_+=`|(){}[:;"\'<>,.?]';

// Printable ASCII, EXCLUDING space (0x21 '!' .. 0x7e '~') — both the
// `ascii-printable`/`unicode` named class (AC2: "unicode is treated as
// ascii-printable") and the filter applied to a `[...]` custom set's literal
// characters ("custom sets keep only printable ASCII except space").
const ASCII_PRINTABLE = (() => {
  let s = '';
  for (let c = 0x21; c <= 0x7e; c += 1) s += String.fromCharCode(c);
  return s;
})();

/** De-duplicate a charset string (keeps `randomIndex`'s per-character draw uniform —
 * a repeated character would otherwise be drawn twice as often).
 * @param {string} s
 * @returns {string}
 */
function uniqueChars(s) {
  return Array.from(new Set(s)).join('');
}

/** Keep only the characters of `s` that also appear in `keep`.
 * @param {string} s
 * @param {string} keep
 * @returns {string}
 */
function intersectChars(s, keep) {
  const keepSet = new Set(keep);
  let out = '';
  for (const ch of s) if (keepSet.has(ch)) out += ch;
  return uniqueChars(out);
}

/** Filter to printable-ASCII-except-space, per AC2's custom-set rule.
 * @param {string} s
 * @returns {string}
 */
function filterAsciiPrintableNoSpace(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0x21 && code <= 0x7e) out += ch;
  }
  return out;
}

/** Only [A-Za-z0-9] characters, for `generateCandidates`' alphanumeric fallback.
 * @param {string} s
 * @returns {string}
 */
function onlyAlnum(s) {
  let out = '';
  for (const ch of s) if (/[A-Za-z0-9]/.test(ch)) out += ch;
  return out;
}

/** A named `passwordrules` class token -> its charset, or null for an unknown name.
 * @param {string} name  already lower-cased.
 * @returns {string | null}
 */
function classCharset(name) {
  if (name === 'upper') return CLASSES.upper;
  if (name === 'lower') return CLASSES.lower;
  if (name === 'digit') return CLASSES.digits;
  if (name === 'special') return SPECIAL_CHARS;
  if (name === 'ascii-printable' || name === 'unicode') return ASCII_PRINTABLE;
  return null;
}

/**
 * Split a `required:`/`allowed:` rule VALUE on top-level commas, respecting
 * ONE level of `[...]` nesting (a comma inside a custom set is literal, not a
 * separator). Returns `null` on any bracket-balance error (unterminated `[`,
 * a stray `]`, nested `[[`) or an empty token (a stray/doubled comma) —
 * AC2's "any syntax error -> null for the whole attribute".
 * @param {string} value
 * @returns {string[] | null}
 */
function splitClassList(value) {
  if (value === '') return [];
  /** @type {string[]} */
  const tokens = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '[') {
      depth += 1;
      if (depth > 1) return null;
      cur += ch;
    } else if (ch === ']') {
      depth -= 1;
      if (depth < 0) return null;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      tokens.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (depth !== 0) return null;
  tokens.push(cur.trim());
  if (tokens.some((t) => t === '')) return null;
  return tokens;
}

/**
 * Resolve one `required:`/`allowed:` list token — a named class, or a
 * `[...]` custom set — to its charset.
 * @param {string} tok
 * @returns {{ ok: true, charset: string } | { ok: false }}
 */
function resolveToken(tok) {
  if (tok.indexOf('[') !== -1 || tok.indexOf(']') !== -1) {
    if (tok[0] !== '[' || tok[tok.length - 1] !== ']') return { ok: false };
    const inner = tok.slice(1, -1);
    if (inner.indexOf('[') !== -1 || inner.indexOf(']') !== -1) return { ok: false };
    return { ok: true, charset: uniqueChars(filterAsciiPrintableNoSpace(inner)) };
  }
  const charset = classCharset(tok.toLowerCase());
  if (charset == null) return { ok: false }; // unknown class keyword
  return { ok: true, charset };
}

/**
 * @typedef {Object} ParsedPasswordRules
 * @property {string[]} required  one charset string per required class/custom set (AC2).
 * @property {string[]} allowed   one charset string per allowed class/custom set.
 * @property {number | null} maxConsecutive
 * @property {number | null} minlength
 * @property {number | null} maxlength
 */

/**
 * Parse a `passwordrules` attribute value (the WebKit core subset — AC2).
 * `;`-separated `name: value` rules, case-insensitive names, whitespace-
 * tolerant. `required:`/`allowed:` take a comma-separated list of classes
 * (`upper`/`lower`/`digit`/`special`/`ascii-printable`/`unicode`) and
 * `[...]` custom sets. `max-consecutive:`/`minlength:`/`maxlength:` take a
 * base-10 non-negative integer. Unknown rule NAMES are ignored. ANY syntax
 * error — an unterminated `[`, a non-integer where one is required, an
 * unknown class keyword, a malformed `name:value` segment — returns `null`
 * for the WHOLE attribute (never partially applied).
 * @param {any} str
 * @returns {ParsedPasswordRules | null}
 */
export function parsePasswordRules(str) {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (trimmed === '') return null;

  /** @type {ParsedPasswordRules} */
  const result = { required: [], allowed: [], maxConsecutive: null, minlength: null, maxlength: null };

  const rawRules = trimmed.split(';');
  for (const rawRule of rawRules) {
    const rule = rawRule.trim();
    if (rule === '') continue; // a trailing/doubled ';' is benign, not an error.
    const colonIdx = rule.indexOf(':');
    if (colonIdx < 0) return null; // no "name:value" shape at all.
    const name = rule.slice(0, colonIdx).trim().toLowerCase();
    const value = rule.slice(colonIdx + 1).trim();

    if (name === 'required' || name === 'allowed') {
      const tokens = splitClassList(value);
      if (tokens === null) return null;
      /** @type {string[]} */
      const charsets = [];
      for (const tok of tokens) {
        const resolved = resolveToken(tok);
        if (!resolved.ok) return null;
        charsets.push(resolved.charset);
      }
      if (name === 'required') result.required.push(...charsets);
      else result.allowed.push(...charsets);
    } else if (name === 'max-consecutive' || name === 'minlength' || name === 'maxlength') {
      if (!/^\d+$/.test(value)) return null; // a non-integer where one is required.
      const n = Number(value);
      if (name === 'max-consecutive') result.maxConsecutive = n;
      else if (name === 'minlength') result.minlength = n;
      else result.maxlength = n;
    }
    // else: an unrecognised rule NAME — ignored, per AC2.
  }
  return result;
}

/**
 * Sanitize the small, page-influenced constraints payload the in-field
 * badge's gesture carries (flight DD5). `raw` must be a plain object; every
 * PRESENT field is individually re-validated — a malformed field fails the
 * WHOLE sanitize (`null`), never a partial pass-through.
 *   - `minLength`/`maxLength`: `undefined`, `null`, or the sentinel `-1` ->
 *     `null` (unset — a field with no `minlength`/`maxlength` attribute reads
 *     back as `null`, not `-1`, via `readGenerateConstraints`'s
 *     `parseIntOrNull`, so `null` must be treated as absent here too); any
 *     other non-negative integer clamps into [1, 128]; a non-integer or any
 *     OTHER negative is malformed;
 *   - `passwordRules`: `undefined`/`null` -> `null`; a string > 512 chars, or
 *     any non-string, is malformed; `''` -> `null`;
 *   - unknown keys on `raw` are ignored.
 * @param {any} raw
 * @returns {{ minLength: number|null, maxLength: number|null, passwordRules: string|null } | null}
 */
export function sanitizeGenerateConstraints(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const sanitizeInt = (/** @type {any} */ v) => {
    if (v === undefined || v === null || v === -1) return { ok: true, value: null };
    if (!Number.isInteger(v) || v < 0) return { ok: false };
    return { ok: true, value: Math.max(1, Math.min(128, v)) };
  };

  const min = sanitizeInt(raw.minLength);
  if (!min.ok) return null;
  const max = sanitizeInt(raw.maxLength);
  if (!max.ok) return null;

  let passwordRules = null;
  if (raw.passwordRules !== undefined && raw.passwordRules !== null) {
    if (typeof raw.passwordRules !== 'string' || raw.passwordRules.length > 512) return null;
    passwordRules = raw.passwordRules === '' ? null : raw.passwordRules;
  }

  return { minLength: min.value, maxLength: max.value, passwordRules };
}

/** The default policy's required classes, in a stable order (our four classes). */
const DEFAULT_REQUIRED_SETS = CLASS_NAMES.map((n) => CLASSES[n]);

/**
 * @param {{ attrMin: number|null, attrMax: number|null, rules: ParsedPasswordRules|null }} args
 * @returns {{ ok: true, length: number, requiredSets: string[], alphabet: string, maxConsecutive: number|null } | { ok: false }}
 */
function computePolicy({ attrMin, attrMax, rules }) {
  /** @type {string[]} */
  let requiredSets;
  /** @type {string} */
  let alphabet;
  if (rules && (rules.required.length > 0 || rules.allowed.length > 0)) {
    requiredSets = rules.required;
    alphabet = uniqueChars(rules.required.join('') + rules.allowed.join(''));
  } else {
    requiredSets = DEFAULT_REQUIRED_SETS;
    alphabet = uniqueChars(requiredSets.join(''));
  }

  // Defensive (AC3): each required set intersected with the final alphabet —
  // a no-op for the union construction above, but keeps a hypothetical future
  // divergence fail-closed rather than silently over-promising a class the
  // alphabet doesn't actually contain.
  requiredSets = requiredSets.map((s) => intersectChars(s, alphabet));
  if (alphabet.length === 0 || requiredSets.some((s) => s.length === 0)) return { ok: false };

  const minSources = [attrMin, rules ? rules.minlength : null].filter((v) => typeof v === 'number');
  // 128 is always a max source — the generator's own hard ceiling (AC5: every
  // candidate <= 128 chars), independent of whatever an unbounded
  // `maxlength:` rule claims.
  const maxSources = [attrMax, rules ? rules.maxlength : null, 128].filter((v) => typeof v === 'number');
  const lower = minSources.length ? Math.max(...minSources) : undefined;
  const upper = Math.min(...maxSources);
  if (lower !== undefined && lower > upper) return { ok: false };

  let length = 20;
  if (lower !== undefined) length = Math.max(length, lower);
  length = Math.min(length, upper);

  if (length < 8) return { ok: false };
  if (length < requiredSets.length) return { ok: false };

  const maxConsecutive = rules && typeof rules.maxConsecutive === 'number' ? rules.maxConsecutive : null;
  return { ok: true, length, requiredSets, alphabet, maxConsecutive };
}

/**
 * Resolve the generation policy from a SANITIZED constraints object (AC3).
 * Defaults: length 20, required sets = our four classes, alphabet = their
 * union. A parseable `passwordRules` narrows the alphabet to the union of its
 * `allowed`+`required` classes (or the defaults when neither is given) and
 * its required sets. Length = 20 clamped into
 * `[max(minLength sources), min(maxLength sources)]`. `ok: false` when
 * min > max, the final length is < 8, length < requiredSets.length, or the
 * alphabet is empty. An UNSATISFIABLE parsed-rules policy (not an unsatisfiable
 * attribute one) degrades to the attributes-only policy before giving up
 * (DD6 "widest satisfiable").
 * @param {{ minLength?: number|null, maxLength?: number|null, passwordRules?: string|null }} constraints
 * @returns {{ ok: true, length: number, requiredSets: string[], alphabet: string, maxConsecutive: number|null } | { ok: false }}
 */
export function resolvePolicy(constraints) {
  const c = constraints && typeof constraints === 'object' ? constraints : {};
  const attrMin = typeof c.minLength === 'number' ? c.minLength : null;
  const attrMax = typeof c.maxLength === 'number' ? c.maxLength : null;
  const rules = typeof c.passwordRules === 'string' ? parsePasswordRules(c.passwordRules) : null;

  const withRules = computePolicy({ attrMin, attrMax, rules });
  if (withRules.ok) return withRules;

  if (rules) {
    const attrsOnly = computePolicy({ attrMin, attrMax, rules: null });
    if (attrsOnly.ok) return attrsOnly;
  }
  return { ok: false };
}

/**
 * The 1-2 candidate passwords main sends to the guest (AC5, DD6's "no
 * guest->main retry channel" — the isolated world picks whichever candidate
 * matches the field's `pattern`, or the first when there is none). `[]` when
 * the primary policy is not satisfiable. The second candidate is an
 * ALPHANUMERIC-ONLY fallback (every non-alnum character stripped from the
 * alphabet and each required set; a required set that becomes empty is
 * dropped) — included only when it is itself satisfiable AND its alphabet
 * differs from the primary's (a `passwordRules` already alnum-only, e.g. no
 * `special`, would make the two identical). Every candidate is <= 128 chars
 * (the primary via `resolvePolicy`'s own 128 max source; the fallback shares
 * the primary's `length`).
 * @param {{ minLength?: number|null, maxLength?: number|null, passwordRules?: string|null }} constraints
 * @returns {string[]}
 */
export function generateCandidates(constraints) {
  const policy = resolvePolicy(constraints);
  if (!policy.ok) return [];

  const primary = generatePassword({
    length: policy.length,
    requiredSets: policy.requiredSets,
    alphabet: policy.alphabet,
    maxConsecutive: policy.maxConsecutive
  });
  /** @type {string[]} */
  const candidates = [primary];

  const fallbackAlphabet = onlyAlnum(policy.alphabet);
  const fallbackRequired = policy.requiredSets.map(onlyAlnum).filter((s) => s.length > 0);
  const fallbackOk =
    fallbackAlphabet.length > 0 && fallbackAlphabet !== policy.alphabet && policy.length >= fallbackRequired.length;
  if (fallbackOk) {
    candidates.push(
      generatePassword({
        length: policy.length,
        requiredSets: fallbackRequired,
        alphabet: fallbackAlphabet,
        maxConsecutive: policy.maxConsecutive
      })
    );
  }
  return candidates;
}
