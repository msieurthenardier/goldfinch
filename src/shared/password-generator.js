// @ts-check

// Pure password generator for the goldfinch://vault editor (M12 Flight 3, Leg 3 /
// DD7). NO DOM, NO Electron, NO main round-trip, NO vault key — it produces fresh
// randomness in-page (the trusted internal page) and unit-tests headlessly.
//
// RANDOMNESS SOURCE (leg ruling): `globalThis.crypto.getRandomValues` — NOT
// `window.crypto` (undefined under `node --test`) and NOT `node:crypto` (the page
// is sandboxed with no Node require). `globalThis.crypto` is present in BOTH the
// sandboxed internal page AND Node >=22, so one source covers page + test.
//
// UNBIASED by construction: every random index is drawn by REJECTION SAMPLING over
// a Uint32 (never `x % n` on a raw draw — that skews toward the low indices), and
// the final character order is an unbiased Fisher-Yates shuffle (never
// `sort(() => rand)`, which is biased and engine-dependent).
//
// Real ES module: the page imports it via a flat serving-path specifier resolved by
// internal-page-map.js; unit tests require() the same file.

/** The four character classes, keyed by their option name. */
const CLASSES = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?'
};

/** The class option names, in a stable order. */
const CLASS_NAMES = /** @type {Array<keyof typeof CLASSES>} */ (['lower', 'upper', 'digits', 'symbols']);

// The exclusive upper bound of a Uint32 draw (2**32).
const UINT32_CEILING = 0x100000000;

/**
 * A uniformly-distributed integer in [0, maxExclusive) drawn from
 * `globalThis.crypto.getRandomValues` with REJECTION SAMPLING — no modulo bias.
 * Reads `globalThis.crypto` per call (not captured at module load) so a test spy
 * on `getRandomValues` is genuinely observed.
 * @param {number} maxExclusive  a positive integer.
 * @returns {number}
 */
function randomIndex(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError(`password-generator: maxExclusive must be a positive integer (got ${maxExclusive})`);
  }
  // The largest multiple of maxExclusive that fits in a Uint32; draws at/above it
  // are rejected so the surviving range divides evenly (unbiased).
  const limit = Math.floor(UINT32_CEILING / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let x;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % maxExclusive;
}

/**
 * Pick one character uniformly from a class string.
 * @param {string} charset
 * @returns {string}
 */
function pickFrom(charset) {
  return charset[randomIndex(charset.length)];
}

/**
 * In-place unbiased Fisher-Yates shuffle (each draw via {@link randomIndex}).
 * @param {string[]} arr
 * @returns {string[]}
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Generate a random password.
 *   - `length` characters (default 20; must be an integer ≥ 1 AND ≥ the number of
 *     enabled classes — a shorter length can't guarantee one char per class);
 *   - one class per enabled option (`lower`/`upper`/`digits`/`symbols`, all default
 *     true), guaranteeing ≥ 1 char from each ENABLED class and NONE from a disabled
 *     one; the remainder is drawn from the union of enabled classes;
 *   - the whole result is shuffled (unbiased) so the guaranteed-class chars are not
 *     pinned to the front.
 * Throws on all-classes-off or `length < enabled-class-count`.
 *
 * POLICY MODE (Mission 21, Flight 4, Leg 3 — generate-in-picker, AC4): an
 * `opts.requiredSets` array (see `generateFromPolicy` below) routes to the
 * field-constraint-driven generator instead — see that function's own
 * doc-comment. The two shapes are a union here so BOTH call forms typecheck.
 * @param {{ length?: number, lower?: boolean, upper?: boolean, digits?: boolean, symbols?: boolean, requiredSets?: undefined, alphabet?: undefined, maxConsecutive?: undefined } | { length?: number, requiredSets: string[], alphabet?: string, maxConsecutive?: number|null, lower?: undefined, upper?: undefined, digits?: undefined, symbols?: undefined }} [opts]
 * @returns {string}
 */
function generatePassword(opts = {}) {
  const o = opts || {};

  // Policy mode (Mission 21, Flight 4, Leg 3 — generate-in-picker, DD6/AC4):
  // an EXPLICIT `requiredSets` array routes to the field-constraint-driven
  // generator instead of the four-flag mode below. Absent `requiredSets` is
  // the ONLY discriminator — every pre-existing call (the vault page's own
  // Generate button, every prior test) omits it and is byte-for-byte
  // unaffected.
  if (Array.isArray(o.requiredSets)) {
    const policyOpts = /** @type {any} */ (o);
    return generateFromPolicy(policyOpts);
  }

  const { length = 20, lower = true, upper = true, digits = true, symbols = true } = o;

  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`password-generator: length must be a positive integer (got ${length})`);
  }

  const enabledFlags = { lower, upper, digits, symbols };
  /** @type {string[]} the charset string of each enabled class. */
  const enabled = [];
  for (const name of CLASS_NAMES) {
    if (enabledFlags[name]) enabled.push(CLASSES[name]);
  }
  if (enabled.length === 0) {
    throw new RangeError('password-generator: at least one character class must be enabled');
  }
  if (length < enabled.length) {
    throw new RangeError(
      `password-generator: length ${length} is below the ${enabled.length} enabled classes — cannot include one of each`
    );
  }

  const pool = enabled.join('');
  /** @type {string[]} */
  const chars = [];
  // One guaranteed char from each enabled class.
  for (const cls of enabled) chars.push(pickFrom(cls));
  // Fill the remainder from the union of enabled classes.
  for (let i = enabled.length; i < length; i += 1) chars.push(pickFrom(pool));
  // Unbiased shuffle so the guaranteed chars are not front-loaded.
  shuffle(chars);
  return chars.join('');
}

/**
 * True iff `chars` contains a run of the SAME character strictly longer than
 * `max` consecutive positions.
 * @param {string[]} chars
 * @param {number} max
 * @returns {boolean}
 */
function hasRunLongerThanMax(chars, max) {
  let run = 1;
  for (let i = 1; i < chars.length; i += 1) {
    run = chars[i] === chars[i - 1] ? run + 1 : 1;
    if (run > max) return true;
  }
  return false;
}

// A bounded attempt count for the max-consecutive redraw loop (AC4) — never an
// unbounded retry against a policy a caller handed us that happens to be very
// hard (or impossible) to satisfy without a long run.
const MAX_CONSECUTIVE_ATTEMPTS = 100;

/**
 * Policy-driven generation (`src/shared/password-policy.js`'s `resolvePolicy`/
 * `generateCandidates` are the only intended callers — this function does not
 * itself parse `passwordrules` or field attributes, it only draws characters):
 *   - one character from each of `requiredSets` (in order), the rest drawn
 *     from `alphabet`, then an unbiased Fisher-Yates shuffle (same `pickFrom`/
 *     `shuffle` helpers as the four-flag mode above — one audited randomness
 *     path);
 *   - `maxConsecutive`, when given, is enforced by REDRAWING THE WHOLE
 *     password (never patching one character in place, which would bias the
 *     redraw) up to `MAX_CONSECUTIVE_ATTEMPTS` times, then throws.
 * @param {{ length?: number, requiredSets: string[], alphabet?: string, maxConsecutive?: number|null }} opts
 * @returns {string}
 */
function generateFromPolicy(opts) {
  const { length = 20, requiredSets, alphabet = '', maxConsecutive = null } = opts;

  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`password-generator: length must be a positive integer (got ${length})`);
  }
  if (!Array.isArray(requiredSets) || requiredSets.some((s) => typeof s !== 'string' || s.length === 0)) {
    throw new RangeError('password-generator: requiredSets must be an array of non-empty charset strings');
  }
  if (length < requiredSets.length) {
    throw new RangeError(
      `password-generator: length ${length} is below the ${requiredSets.length} required sets — cannot include one of each`
    );
  }
  const remainderNeeded = length > requiredSets.length;
  if (remainderNeeded && (typeof alphabet !== 'string' || alphabet.length === 0)) {
    throw new RangeError(
      'password-generator: alphabet must be a non-empty string when length exceeds requiredSets.length'
    );
  }

  const attempts =
    typeof maxConsecutive === 'number' && Number.isInteger(maxConsecutive) && maxConsecutive > 0
      ? MAX_CONSECUTIVE_ATTEMPTS
      : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    /** @type {string[]} */
    const chars = [];
    for (const set of requiredSets) chars.push(pickFrom(set));
    for (let i = requiredSets.length; i < length; i += 1) chars.push(pickFrom(alphabet));
    shuffle(chars);
    if (attempts === 1 || !hasRunLongerThanMax(chars, /** @type {number} */ (maxConsecutive))) {
      return chars.join('');
    }
  }
  throw new RangeError(
    `password-generator: could not satisfy max-consecutive (${maxConsecutive}) within ${MAX_CONSECUTIVE_ATTEMPTS} attempts`
  );
}

export { generatePassword, CLASSES, CLASS_NAMES };
