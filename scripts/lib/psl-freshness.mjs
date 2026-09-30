// Pure helpers for the vendored Public Suffix List: the release-time freshness
// verdict (squawk 0117) and the refresh script's body validation. No I/O, no network.

/** Release is refused when the vendored snapshot is older than this. */
export const PSL_RELEASE_MAX_AGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Freshness verdict for the vendored snapshot. Fails CLOSED: a missing / non-finite
 * snapshot or clock is 'stale' (unlike psl.js's runtime gate, a release must not ship
 * a list whose age it cannot read).
 * @param {number | null | undefined} snapshotMs
 * @param {number} nowMs
 * @param {number} [maxAgeDays]
 * @returns {{ stale: boolean, ageDays: number | null }}
 */
export function pslFreshness(snapshotMs, nowMs, maxAgeDays = PSL_RELEASE_MAX_AGE_DAYS) {
  if (typeof snapshotMs !== 'number' || !Number.isFinite(snapshotMs) || !Number.isFinite(nowMs)) {
    return { stale: true, ageDays: null };
  }
  const ageMs = nowMs - snapshotMs;
  return { stale: ageMs > maxAgeDays * DAY_MS, ageDays: Math.floor(ageMs / DAY_MS) };
}

/**
 * Sanity-check a fetched PSL body. Returns the VERSION string on success, or null.
 * The VERSION header format matches psl.js's parseSnapshotMs.
 * @param {string} text
 * @returns {string | null}
 */
export function validatePslBody(text) {
  if (typeof text !== 'string') return null;
  const v = /^\/\/\s*VERSION:\s*(\d{4}-\d{2}-\d{2}\S*)/m.exec(text);
  if (!v || Number.isNaN(Date.parse(`${v[1].slice(0, 10)}T00:00:00Z`))) return null;
  if (!text.includes('// ===BEGIN ICANN DOMAINS===')) return null;
  if (!text.includes('// ===BEGIN PRIVATE DOMAINS===')) return null;
  return v[1];
}
