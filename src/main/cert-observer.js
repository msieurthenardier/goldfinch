// @ts-check
'use strict';

// Mission 20 Flight 2 Leg 2 (DD6): the session-level certificate-VERIFICATION
// observer — installed on every web session's `setCertificateVerifyProc`
// (`session-runtime.js`'s `onSessionCreated`, beside `applyShields`). It
// records what the network service saw for later reads (`did-navigate`'s
// `entry.certificate` stamp, DD6) but NEVER makes a trust decision itself:
// the proc's ONLY possible answer is `callback(-3)` — "use Chromium's own
// verdict" — so this module changes NO trust outcome no matter what it
// records or how it fails. That is the whole safety argument for this hook,
// hence the source-scan pin: the ONLY `callback(` literal in this module is
// `-3`.
//
// House pattern: Electron-free, dependency-injected (`cap`, `summarize`,
// `logger`) — the `auth-challenges.js` / `cert-trust.js` shape, offline-
// tested with fakes.
//
// Per-partition LRU (cap 256, delete-then-re-set on both insert and hit —
// Map iteration order is insertion order, so the FIRST key is always the
// least-recently-used one to evict). The observer never throws into the
// network service: a throwing `summarize` is caught and logged, and the
// record is skipped for that verification (never abandons the callback).
//
// HAT F5 (accepted gap, post-ship): the cache is keyed by HOSTNAME ONLY —
// Electron's verify-proc `Request` carries no port, so there is no
// disambiguator to key on. Two distinct https origins on the same hostname
// but different ports (e.g. two local dev servers on 127.0.0.1) therefore
// share one slot: whichever was verified most recently wins the entry. For a
// TRUSTED page this means `did-navigate`'s `entry.certificate` stamp (the
// `secure`-path viewer source in tab-certificate-get) can show the most
// recently verified certificate for that hostname rather than necessarily
// this tab's own — a real but narrow gap (same host, different port, both
// legitimately trusted). It does NOT affect an overridden tab: that path
// reads `certOverride.summary` instead (stamped per-load by cert-trust.js),
// never this cache — see site-security.js's deriveSecurityState doc comment
// and register-tab-ipc.js's tab-certificate-get for the fix this leg made.

const { stripNetPrefix } = require('../shared/load-failure');

const DEFAULT_CAP = 256;

// Mission 20 Flight 2 Leg 4 (design review, HIGH): the same "no error" verdict
// site-security.js's deriveSecurityState checks against — kept as a LOCAL
// literal set (never an import of that ESM module into this CJS one) so both
// summary sources speak the same engine-error NAME. Belt-and-suspenders bare
// 'OK' alongside the spike-measured 'net::OK'.
const OK_RESULTS = new Set(['net::OK', 'OK']);

/**
 * @param {{ cap?: number, summarize?: (cert: any, ctx: { status?: string, error?: string, knownRoot?: boolean }) => any, logger?: any }} [deps]
 */
function createCertObserver({ cap = DEFAULT_CAP, summarize, logger = console } = {}) {
  /** @type {Map<string, Map<string, any>>} */
  const byPartition = new Map();

  /** @param {string} partition @returns {Map<string, any>} */
  function partitionMap(partition) {
    let m = byPartition.get(partition);
    if (!m) {
      m = new Map();
      byPartition.set(partition, m);
    }
    return m;
  }

  /**
   * Record one verification, refreshing an existing hostname to
   * most-recently-used (delete + re-set) and evicting the oldest entry once
   * the partition's map exceeds `cap`.
   * @param {string} partition
   * @param {string} hostname
   * @param {any} value
   */
  function record(partition, hostname, value) {
    const m = partitionMap(partition);
    if (m.has(hostname)) m.delete(hostname);
    m.set(hostname, value);
    if (m.size > cap) {
      const oldestKey = m.keys().next().value;
      m.delete(oldestKey);
    }
  }

  /**
   * The DURABLE-copy read seam (`guest-wiring.js`'s `did-navigate`). Refreshes
   * a hit to most-recently-used (same hit-refresh discipline as `record`) —
   * a repeat visit's own lookup keeps its entry alive as long as the tab
   * keeps being revisited, per spike (f)'s "verify-proc doesn't refire on a
   * repeat nav" finding.
   * @param {string} partition
   * @param {string} hostname
   * @returns {any | null}
   */
  function lookup(partition, hostname) {
    const m = byPartition.get(partition);
    if (!m || !m.has(hostname)) return null;
    const v = m.get(hostname);
    m.delete(hostname);
    m.set(hostname, v);
    return v;
  }

  /** @param {string} partition */
  function clearPartition(partition) {
    byPartition.delete(partition);
  }

  /**
   * Build this partition's `setCertificateVerifyProc` callback. Never throws
   * into the network service — every step that can fail (recording,
   * summarizing) is inside the guarding `try`, and the `finally` is the SOLE
   * `callback(` site in the module, always `-3`.
   * @param {string} partition
   * @returns {(request: any, callback: (verdict: number) => void) => void}
   */
  function procFor(partition) {
    return function proc(request, callback) {
      try {
        const hostname = request && typeof request.hostname === 'string' ? request.hostname : null;
        if (hostname) {
          let summaryResult = null;
          try {
            // Mission 20 Flight 2 Leg 4 (design review, HIGH): the summary's
            // `error` is the STRIPPED ENGINE NAME (e.g.
            // 'ERR_CERT_AUTHORITY_INVALID'), not the numeric errorCode — the
            // interstitial's own cert-trust.js summary speaks the same name,
            // and a code-only string (e.g. '-202') read badly beside it in
            // the viewer. Omitted entirely on an OK verdict.
            summaryResult = summarize
              ? summarize(request && request.certificate, {
                  status: request && request.verificationResult,
                  error:
                    request &&
                    typeof request.verificationResult === 'string' &&
                    !OK_RESULTS.has(request.verificationResult)
                      ? stripNetPrefix(request.verificationResult)
                      : undefined,
                  knownRoot: !!(request && request.isIssuedByKnownRoot)
                })
              : null;
          } catch (err) {
            logger.error('[cert-observer] summarize failed:', err && (err.message || err));
            summaryResult = null;
          }
          record(partition, hostname, {
            verificationResult: request && request.verificationResult,
            errorCode: request && request.errorCode,
            isIssuedByKnownRoot: !!(request && request.isIssuedByKnownRoot),
            summary: summaryResult
          });
        }
      } catch (err) {
        logger.error('[cert-observer] proc failed:', err && (err.message || err));
      } finally {
        callback(-3);
      }
    };
  }

  return { procFor, lookup, clearPartition };
}

module.exports = { createCertObserver };
