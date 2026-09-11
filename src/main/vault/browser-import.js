// @ts-check
'use strict';

// Chrome password-export adapter (M19 F1 Leg 1 / DD3, DD4, DD7, DD8, DD11,
// DD12): header-based source detection, the CSV-row → `login` candidate
// taxonomy, the content-identity dedupe plan, the row/field caps, and the
// per-entry outcome summary. Pure and Electron-free — every function here
// takes already-parsed `csv-parse.js` records (or plain candidate/item
// arrays) and returns plain data; no filesystem, no crypto, no vault-store
// import (see the `MAX_IMPORT_ITEMS` ownership note below — the reverse
// direction is a circular require).
//
// `MAX_IMPORT_ITEMS` and `MAX_PAYLOAD_BYTES` are OWNED here (design review,
// high / leg ruling 5): `vault-store.js` imports `MAX_IMPORT_ITEMS` from this
// module and re-exports it, rather than this module reading it back off
// `vault-store.js` — the latter direction is a circular require
// (`vault-store.js` would `require('./browser-import')` near its top, whose
// body would then read `vault-store.js`'s still-empty `module.exports` and
// silently bind `undefined`). This module must never `require('./vault-store')`.

/**
 * The Chrome password-export header, exact field order (trimmed,
 * lower-cased before compare — leg ruling 3).
 */
const CHROME_HEADER = ['name', 'url', 'username', 'password', 'note'];

// A single field's length cap (leg ruling 4.2 / DD12): generous vs. a real
// note running to a few KB, but bounds a single absurd field the row/byte
// caps below don't reach.
const MAX_FIELD_CHARS = 16384;

// The accepted-row count cap (leg ruling 5 / DD12): the SOLE definition —
// `vault-store.js` re-exports this constant rather than defining its own.
const MAX_IMPORT_ITEMS = 10000;

// The whole-file byte cap (DD6 / DD12), the `MAX_BUNDLE_BYTES` precedent
// (`main.js:1110`) — SOLE definition, consumed by `pending-browser-imports.js`.
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

/**
 * A whole-file refusal — the file is not recognized as (or no longer parses
 * as) a Chrome password export, or exceeds a structural bound. Carries a
 * fixed `reason` code (never row content) so a caller can render a stable
 * message.
 */
class BrowserImportFormatError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(`browser-import: ${reason}`);
    this.name = 'BrowserImportFormatError';
    /** @type {string} */
    this.reason = reason;
  }
}

/**
 * Validate the first parsed record against the exact Chrome header (leg
 * ruling 3): trimmed + lower-cased field-by-field equality. Throws
 * `BrowserImportFormatError('unrecognized-format')` on anything else — a
 * missing/malformed first record, a wrong field count, wrong field names, or
 * an empty file (`records[0]` absent).
 * @param {Array<{ line: number, fields?: string[], malformed?: true }>} records
 * @returns {void}
 */
function detectChromeExport(records) {
  const first = records[0];
  if (!first || first.malformed || !Array.isArray(first.fields)) {
    throw new BrowserImportFormatError('unrecognized-format');
  }
  const normalized = first.fields.map((f) => (typeof f === 'string' ? f.trim().toLowerCase() : ''));
  const ok = normalized.length === CHROME_HEADER.length && normalized.every((f, idx) => f === CHROME_HEADER[idx]);
  if (!ok) {
    throw new BrowserImportFormatError('unrecognized-format');
  }
}

/**
 * Discriminate a row's `url` field precisely (DD8): a genuinely unparseable
 * URL (`invalid`) vs. a well-formed but non-web/opaque origin (`non-web`,
 * e.g. `android://…`, where `new URL(url).origin` is the STRING `"null"`)
 * vs. an ordinary web origin (`web`). Getting `invalid`/`non-web` backwards
 * either crashes on real `android://` export rows or reclassifies genuine
 * parse failures as "non-web".
 * @param {any} url
 * @returns {{ kind: 'web', origin: string, host: string } | { kind: 'non-web', scheme: string } | { kind: 'invalid' }}
 */
function originOfDiscriminated(url) {
  if (typeof url !== 'string' || url.length === 0) return { kind: 'invalid' };
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'invalid' };
  }
  if (parsed.origin === 'null') {
    // WHATWG opaque-origin serialization — captured for the outcome line
    // ("non-web origin (android://)"), never the raw "null" string.
    const scheme = url.split(':')[0].toLowerCase().slice(0, 32);
    return { kind: 'non-web', scheme };
  }
  return { kind: 'web', origin: parsed.origin, host: parsed.host };
}

/**
 * Map parsed CSV records (as returned by `csv-parse.js`'s `parseCsv`,
 * HEADER INCLUDED at index 0 — this function skips it) into `login`
 * candidates + skips, in the DD8 taxonomy order (leg ruling 4, first hit
 * wins): parser-malformed / wrong field count → `malformed`; an
 * over-length field → `field-too-long`; an unparseable/empty url →
 * `malformed-url`; a non-web (opaque) origin → `non-web-origin` (scheme
 * captured); an empty password → `no-password`. Everything else is a
 * candidate. Never drops a row without an entry; never throws on row
 * content. Throws `BrowserImportFormatError('too-many-rows')` when the
 * DATA record count (candidates + skips) exceeds `MAX_IMPORT_ITEMS` —
 * refused whole, not truncated.
 * @param {Array<{ line: number, fields?: string[], malformed?: true }>} records
 * @returns {{
 *   candidates: Array<{ line: number, title: string, origin: string, username: string, password: string, notes?: string }>,
 *   skipped: Array<{ line: number, reason: string, scheme?: string }>
 * }}
 */
function adaptChromeRows(records) {
  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_IMPORT_ITEMS) {
    throw new BrowserImportFormatError('too-many-rows');
  }

  /** @type {Array<{ line: number, title: string, origin: string, username: string, password: string, notes?: string }>} */
  const candidates = [];
  /** @type {Array<{ line: number, reason: string, scheme?: string }>} */
  const skipped = [];

  for (const rec of dataRecords) {
    const line = rec.line;

    if (rec.malformed || !Array.isArray(rec.fields) || rec.fields.length !== 5) {
      skipped.push({ line, reason: 'malformed' });
      continue;
    }

    const [name, url, username, password, note] = rec.fields;
    if ([name, url, username, password, note].some((f) => typeof f === 'string' && f.length > MAX_FIELD_CHARS)) {
      skipped.push({ line, reason: 'field-too-long' });
      continue;
    }

    const disc = originOfDiscriminated(url);
    if (disc.kind === 'invalid') {
      skipped.push({ line, reason: 'malformed-url' });
      continue;
    }
    if (disc.kind === 'non-web') {
      skipped.push({ line, reason: 'non-web-origin', scheme: disc.scheme });
      continue;
    }
    if (!password) {
      skipped.push({ line, reason: 'no-password' });
      continue;
    }

    candidates.push({
      line,
      title: name || disc.host || disc.origin,
      origin: disc.origin,
      username: username ?? '',
      password,
      ...(note ? { notes: note } : {})
    });
  }

  return { candidates, skipped };
}

/**
 * Canonicalize a stored/candidate origin through the vault's existing origin
 * idiom (`new URL(x).origin`, mirroring `vault-human.js`'s `originOf`) —
 * re-run on every EXISTING item's origin (DD3) so an unparseable stored
 * origin can never match anything. Returns `null` on failure (never
 * throws).
 * @param {any} origin
 * @returns {string | null}
 */
function canonicalOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

/**
 * @param {string} origin
 * @param {string} username
 * @returns {string}
 */
function identityKey(origin, username) {
  return `${origin} ${username}`;
}

/**
 * Build the DD3 dedupe plan against a destination's EXISTING items: each
 * candidate resolves to `new` (no existing item shares its identity),
 * `duplicate` (same identity AND password AND `(notes ?? '')` as some
 * existing item sharing that identity — deliberately NOT `totp`, which a
 * Chrome row can never carry), or `changed` (same identity, no existing item
 * shares its secrets). The identity map holds EVERY existing item per
 * identity (including a prior `changed` copy), so re-importing an
 * already-landed `changed` row is `duplicate` against its own copy — no
 * unbounded copies. Intra-file duplicates use the SAME rule: a `new` or
 * `changed` candidate's identity joins the map immediately, so a later
 * same-identity row in the SAME batch is classified against it too.
 * @param {Array<{ line: number, title: string, origin: string, username: string, password: string, notes?: string }>} candidates
 * @param {any[]} existingItems
 * @returns {Array<{ candidate: (typeof candidates)[number], kind: 'new' | 'duplicate' | 'changed' }>}
 */
function planLogins(candidates, existingItems) {
  /** @type {Map<string, any[]>} */
  const byIdentity = new Map();
  for (const item of Array.isArray(existingItems) ? existingItems : []) {
    if (!item || item.type !== 'login') continue;
    const origin = canonicalOrigin(item.origin);
    if (origin === null) continue; // an unparseable stored origin can never match.
    const key = identityKey(origin, item.username ?? '');
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    /** @type {any[]} */ (byIdentity.get(key)).push(item);
  }

  /** @type {Array<{ candidate: any, kind: 'new' | 'duplicate' | 'changed' }>} */
  const results = [];
  for (const candidate of candidates) {
    const key = identityKey(candidate.origin, candidate.username ?? '');
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    const list = /** @type {any[]} */ (byIdentity.get(key));

    const match = list.find(
      (it) => (it.password ?? '') === candidate.password && (it.notes ?? '') === (candidate.notes ?? '')
    );
    if (match) {
      results.push({ candidate, kind: 'duplicate' });
      continue;
    }
    const kind = list.length === 0 ? 'new' : 'changed';
    results.push({ candidate, kind });
    list.push(candidate);
  }
  return results;
}

/**
 * Fold the adapter's skips (DD8 reasons) and the store's per-row commit
 * results (DD11 outcomes) into one report. Never throws, never emits `NaN` —
 * an unrecognized result outcome is coerced into `failed` so the total stays
 * honest rather than silently vanishing; a skip with no string `reason`
 * folds into an `'unknown'` bucket.
 * @param {Array<{ line: number, reason?: string }>} skipped
 * @param {Array<{ line: number, outcome?: string }>} results
 * @returns {{
 *   imported: number, duplicate: number, changed: number, failed: number,
 *   unmappable: { total: number, byReason: Record<string, number> }
 * }}
 */
function summarizeOutcomes(skipped, results) {
  /** @type {{ imported: number, duplicate: number, changed: number, failed: number, unmappable: { total: number, byReason: Record<string, number> } }} */
  const summary = { imported: 0, duplicate: 0, changed: 0, failed: 0, unmappable: { total: 0, byReason: {} } };

  for (const s of Array.isArray(skipped) ? skipped : []) {
    const reason = s && typeof s.reason === 'string' ? s.reason : 'unknown';
    summary.unmappable.total++;
    summary.unmappable.byReason[reason] = (summary.unmappable.byReason[reason] || 0) + 1;
  }

  for (const r of Array.isArray(results) ? results : []) {
    const outcome = r && r.outcome;
    if (outcome === 'imported') summary.imported++;
    else if (outcome === 'duplicate') summary.duplicate++;
    else if (outcome === 'changed') summary.changed++;
    else summary.failed++; // 'failed' and any unrecognized value alike.
  }

  return summary;
}

module.exports = {
  CHROME_HEADER,
  MAX_FIELD_CHARS,
  MAX_IMPORT_ITEMS,
  MAX_PAYLOAD_BYTES,
  BrowserImportFormatError,
  detectChromeExport,
  originOfDiscriminated,
  adaptChromeRows,
  canonicalOrigin,
  planLogins,
  summarizeOutcomes
};
