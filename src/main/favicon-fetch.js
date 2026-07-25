// @ts-check
'use strict';

// Favicon fetch (Mission 13 Flight 1 / Leg 1 — DD1 jar-session favicon fetch).
//
// ELECTRON-FREE, injected-deps module (house exemplars: settings-store.js,
// find-overlay-geometry.js): does NOT require('electron'), does NOT resolve a
// session or webContents itself. The wiring layer (guest-wiring.js) injects a
// per-call `fetchImpl` bound to the OWNING webContents' `wc.session.fetch` —
// this module only ever sees a plain async function.
//
// Contract:
// - picks favicons[0]; a page-declared `data:image/...` favicon (<= 512 KB) is
//   inert local content and passes through UNCHANGED, no network fetch (DD1
//   addendum, mirroring DD2's scheme-pass-through carve-out) — dropping it
//   would regress a legitimate pattern.
// - every other non-http(s) scheme (goldfinch://, javascript:, file:, a
//   non-image data: URL) is rejected without fetching.
// - http/https favicons are fetched via the injected fetchImpl; the FINAL
//   response (session.fetch follows 30x transparently, so "final" may
//   describe a different URL than the one requested) must be `image/*` and
//   its body must not exceed maxBytes, else rejected. Content-Length is
//   NEVER trusted for the cap — the body is read and its actual byteLength
//   checked (a lying/absent header must not bypass the cap).
// - a success resolves to a `data:<content-type>;base64,...` URL.
// - LATEST-WINS: a monotonic per-wcId sequence — every request() call bumps
//   it (even one that resolves synchronously to null), and a fetch's result
//   is discarded unless it is still the newest request issued for that wcId
//   by the time it resolves. This is what makes a fast placeholder->real
//   double-update, or a stale slow fetch racing a newer one, resolve
//   correctly instead of flickering back to an older favicon.
// - forget(wcId) drops the per-tab sequence entry (tab teardown — prevents
//   unbounded map growth over the process lifetime).
// - NEVER THROWS. Every failure path (bad scheme, non-ok response, wrong
//   content-type, oversized body, a thrown/rejected fetchImpl) resolves to
//   null ("no favicon") — the wiring layer forwards nothing on a null.

const DATA_FAVICON_MAX_BYTES = 512 * 1024; // page-declared data: favicon pass-through cap
const DEFAULT_FETCH_MAX_BYTES = 256 * 1024; // fetched-body cap

const DATA_IMAGE_RE = /^data:image\//i;
const HTTP_URL_RE = /^https?:\/\//i;

/**
 * @param {{ maxBytes?: number }} [opts]
 */
function createFaviconFetcher({ maxBytes = DEFAULT_FETCH_MAX_BYTES } = {}) {
  /** @type {Map<number, number>} */
  const seqByWcId = new Map();

  /** @param {number} wcId */
  function bumpSeq(wcId) {
    const next = (seqByWcId.get(wcId) || 0) + 1;
    seqByWcId.set(wcId, next);
    return next;
  }

  /**
   * @param {{ wcId: number, favicons: any, fetchImpl: (url: string) => Promise<any> }} args
   * @returns {Promise<string | null>}
   */
  async function request({ wcId, favicons, fetchImpl }) {
    // Bumped unconditionally — even a call that turns out to carry no usable
    // favicon is still the newest KNOWN state for this tab, and must be able
    // to outrank an earlier in-flight fetch that resolves later (see the
    // latest-wins check below).
    const mySeq = bumpSeq(wcId);

    const favicon = Array.isArray(favicons) ? favicons[0] : null;
    if (!favicon || typeof favicon !== 'string') return null;

    if (favicon.startsWith('data:')) {
      if (!DATA_IMAGE_RE.test(favicon)) return null;
      if (favicon.length > DATA_FAVICON_MAX_BYTES) return null;
      return favicon;
    }

    if (!HTTP_URL_RE.test(favicon)) return null;

    /** @type {string} */
    let dataUrl;
    try {
      const response = await fetchImpl(favicon);
      if (!response || !response.ok) return null;
      const rawType = response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('content-type')
        : null;
      const contentType = (rawType || '').split(';')[0].trim();
      if (!/^image\//i.test(contentType)) return null;
      const buf = await response.arrayBuffer();
      if (buf.byteLength > maxBytes) return null;
      dataUrl = `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`;
    } catch {
      return null;
    }

    // Latest-wins: a newer request for this wcId landed while this fetch was
    // in flight — drop this (now stale) resolution.
    if (seqByWcId.get(wcId) !== mySeq) return null;
    return dataUrl;
  }

  /** @param {number} wcId */
  function forget(wcId) {
    seqByWcId.delete(wcId);
  }

  return { request, forget };
}

module.exports = { createFaviconFetcher, DATA_FAVICON_MAX_BYTES, DEFAULT_FETCH_MAX_BYTES };
