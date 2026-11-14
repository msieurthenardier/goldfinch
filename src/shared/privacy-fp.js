// Fingerprinting-attempt counters the guest preload reports (`guest-privacy-fp`) — the ONE key
// set, shared by the preload (which counts) and main (which validates what a page-influenced
// sender claims before forwarding it to the chrome). Mission 23 Flight 1, leg
// `ipc-gate-complete`, finding NF8.
//
// Real ES module: required by the sandboxed guest preload through its bundle and by main-side
// code via require(esm), like every other pure module here.

/** The counters the preload bumps; also the only keys main will forward. */
export const FP_KINDS = Object.freeze(['canvas', 'webgl', 'audio']);

/** A count above this is clamped (a page can call a farbled API in a tight loop). */
export const FP_COUNT_CEILING = 100000;

/**
 * Validate a `guest-privacy-fp` payload. Returns a fresh object carrying EVERY `FP_KINDS` key (an
 * absent one is 0), each value a finite non-negative integer clamped to `FP_COUNT_CEILING`; or `null` — anything else (a non-plain object, an unknown or inherited
 * key, a non-integer, negative, NaN or non-number value) is dropped whole, never partially
 * forwarded.
 * @param {unknown} raw
 * @returns {Record<string, number> | null}
 */
export function sanitizeFpCounts(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;
  /** @type {Record<string, number>} */
  const out = Object.fromEntries(FP_KINDS.map((kind) => [kind, 0]));
  for (const key of keys) {
    if (!FP_KINDS.includes(key)) return null;
    const value = /** @type {any} */ (raw)[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
    out[key] = Math.min(value, FP_COUNT_CEILING);
  }
  return out;
}
