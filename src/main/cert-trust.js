// @ts-check
'use strict';

// Mission 20 Flight 2 Leg 2 (DD1/DD2): the certificate-error TRUST DECISION.
// `app.on('certificate-error')` hands main a native `callback` that MUST be
// answered exactly once, synchronously — Chrome itself never holds this open
// (unlike the auth-challenge callbacks `auth-challenges.js` queues): a refused
// load fails into the ordinary `did-fail-load` path and a proceed re-navigates.
// So this module answers AT ONCE (never queues, never occludes) and stamps a
// per-tab record of the decision for Flight 1's panel / this leg's census.
//
// House pattern: Electron-free, dependency-injected (registry + popupRegistry
// + logger), the `auth-challenges.js` shape — the whole module unit-tests
// offline with fakes.
//
// SECURITY INVARIANT (AC1): exactly ONE `callback(` call site, inside a
// `finally` guarded by a `catch` — a bare `try/finally` would re-throw a
// resolution failure straight into Electron's top-level event dispatch,
// abandoning the callback AND crashing main. The stamp block that follows
// (recording the decision on the tab entry) is a SEPARATE, later concern and
// gets its OWN try/catch — a throwing `stripNetPrefix`/`summarizeCertificate`
// must never escape, but it must also never delay or skip the callback above.
// `handleCertificateError` never throws, full stop.
//
// DD2: the remembered-override Set is keyed `${partition}\n${host}:${port}\n
// ${fingerprint}` — per jar, per host:port, per certificate fingerprint,
// in-memory only (no `fs`/`app-db`/`settings-store` import anywhere in this
// module — grep-AC). `allow(key)` is exposed with ZERO callers in `src/` after
// this leg (the proceed path is leg 3) — AC8's inverted-by-leg-3 pin.

const { stripNetPrefix } = require('../shared/load-failure');
const { summarizeCertificate } = require('./certificate-summary');

/**
 * Sentinel partition for a certificate error arriving from a webContents that
 * is neither a registry tab nor a registered popup (chrome, sheet, find
 * overlay, DevTools frontend, an internal `goldfinch://` guest — none of
 * which should ever negotiate TLS, but the app-level `certificate-error`
 * event reaches this handler for ANY webContents). Answered by the same
 * refuse-or-remember rule; never stamped (there is no tab entry to stamp).
 */
const NO_PARTITION = 'no-partition';

/**
 * @param {string} partition
 * @param {string} host
 * @param {number | null} port
 * @param {string} fingerprint
 * @returns {string}
 */
function keyFor(partition, host, port, fingerprint) {
  return `${partition}\n${host}:${port}\n${fingerprint}`;
}

/**
 * @param {{ registry: any, popupRegistry?: { getByWcId: (wcId: number) => any } | null, logger?: any }} deps
 */
function createCertTrust({ registry, popupRegistry = null, logger = console }) {
  /** @type {Set<string>} */
  const remembered = new Set();

  /**
   * Resolve a webContents id's partition + (when it is a genuine registry
   * TAB) its tab entry. Popup resolution reads ONLY the popup's own captured
   * partition (AC2) — a popup never gets a stamp (it has no tab entry). Any
   * other contents (chrome, sheet, find, DevTools, internal guest) resolves
   * the `NO_PARTITION` sentinel.
   * @param {number} wcId
   * @returns {{ partition: string, entry: any | null }}
   */
  function resolvePartition(wcId) {
    const rec = registry?.getWindowForGuest?.(wcId);
    const entry = rec?.tabViews?.get?.(wcId) || null;
    if (entry && typeof entry.partition === 'string') return { partition: entry.partition, entry };
    const popupEntry = popupRegistry ? popupRegistry.getByWcId(wcId) : null;
    if (popupEntry && typeof popupEntry.partition === 'string') return { partition: popupEntry.partition, entry: null };
    return { partition: NO_PARTITION, entry: null };
  }

  /**
   * Stamp the decision onto a registry TAB entry (never a popup, never
   * `NO_PARTITION`) — its OWN try/catch, strictly after the callback has
   * already been answered. Never throws.
   * @param {{ entry: any, isMainFrame: boolean, decision: boolean, url: string, host: string, port: number | null, fingerprint: string, error: string, certificate: any }} args
   */
  function stampEntry({ entry, isMainFrame, decision, url, host, port, fingerprint, error, certificate }) {
    try {
      if (!entry || !isMainFrame) return;
      const strippedError = stripNetPrefix(error);
      if (decision) {
        entry.certOverride = { host, port, fingerprint, error: strippedError };
      } else {
        const summary = summarizeCertificate(certificate, { status: 'untrusted', error: strippedError });
        entry.certFailure = { url, host, port, error: strippedError, fingerprint, summary };
      }
    } catch (err) {
      logger.error('[cert-trust] stamp failed:', err && (err.message || err));
    }
  }

  /**
   * `app.on('certificate-error')` handler body (DD1). The caller has already
   * `preventDefault()`ed. Answers `callback` EXACTLY ONCE, synchronously,
   * inside the sole `finally` in this module — nothing before it can leave
   * the callback dangling, because every step that can throw is inside the
   * guarding `try`.
   * @param {any} wc
   * @param {string} url
   * @param {string} error
   * @param {any} certificate
   * @param {(allow: boolean) => void} callback
   * @param {boolean} isMainFrame
   */
  function handleCertificateError(wc, url, error, certificate, callback, isMainFrame) {
    let decision = false;
    let entry = null;
    let host = '';
    let port = /** @type {number | null} */ (null);
    let fingerprint = '';
    try {
      const resolved = resolvePartition(wc && wc.id);
      const partition = resolved.partition;
      entry = resolved.entry;
      const parsed = new URL(url);
      host = parsed.hostname;
      port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 0;
      fingerprint = certificate && typeof certificate.fingerprint === 'string' ? certificate.fingerprint : '';
      const key = keyFor(partition, host, port, fingerprint);
      decision = api.has(key) === true;
    } catch (err) {
      logger.error('[cert-trust] resolve failed:', err && (err.message || err));
      decision = false;
    } finally {
      callback(decision);
    }

    stampEntry({ entry, isMainFrame: !!isMainFrame, decision, url, host, port, fingerprint, error, certificate });
  }

  const api = {
    handleCertificateError,
    /** @param {string} key */
    allow(key) {
      remembered.add(key);
    },
    /** @param {string} key @returns {boolean} */
    has(key) {
      return remembered.has(key);
    },
    /** @param {string} partition */
    clearPartition(partition) {
      const prefix = `${partition}\n`;
      for (const key of remembered) {
        if (key.startsWith(prefix)) remembered.delete(key);
      }
    },
    keyFor
  };

  return api;
}

module.exports = { createCertTrust, NO_PARTITION, keyFor };
