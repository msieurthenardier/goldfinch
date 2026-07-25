// @ts-check
'use strict';

// Media proxy protocol.handle body (Mission 13 Flight 1 / Leg 2 — DD2/AC2).
//
// ELECTRON-FREE, injected-deps module (house exemplars: favicon-fetch.js,
// settings-store.js): does NOT require('electron'). getTabContents,
// isInternalContents, and parseMediaProxyUrl are all injected so the handler
// body is testable with plain fakes — no Electron runtime needed.
//
// Follows handleInternal's discipline (src/main/main.js:194-217): never
// throws (an unhandled throw inside protocol.handle yields a failed load with
// no diagnostics), and re-wraps the upstream response so ONLY an explicit
// header allowlist crosses the boundary — never the upstream's raw headers
// verbatim. Unlike handleInternal this streams: the Response is built with
// the upstream ReadableStream body directly (no buffering of the full body
// in the handler), which is what makes Range/seek requests viable at all.

const ALLOWED_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
// Only these two REQUEST headers are forwarded upstream — Range for seek,
// Accept for content negotiation. Nothing else from the incoming request
// (cookies, auth, etc.) ever reaches ses.fetch through this path.
const FORWARDED_REQUEST_HEADERS = ['Range', 'Accept'];

/**
 * @param {{
 *   getTabContents: (wcId: number) => any,
 *   isInternalContents: (wc: any) => boolean,
 *   parseMediaProxyUrl: (raw: string) => { wcId: number, url: string } | null,
 * }} deps
 * @returns {(request: Request) => Promise<Response>}
 */
function createMediaProxyHandler({ getTabContents, isInternalContents, parseMediaProxyUrl }) {
  return async function handleMediaProxy(request) {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405 });
    }

    const parsed = parseMediaProxyUrl(request.url);
    if (!parsed) {
      return new Response(null, { status: 400 });
    }

    const wc = getTabContents(parsed.wcId);
    if (!wc || isInternalContents(wc)) {
      return new Response(null, { status: 404 });
    }

    /** @type {Record<string, string>} */
    const forwardHeaders = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers && typeof request.headers.get === 'function'
        ? request.headers.get(name)
        : null;
      if (value != null) forwardHeaders[name] = value;
    }

    let upstream;
    try {
      upstream = await wc.session.fetch(parsed.url, { headers: forwardHeaders });
    } catch {
      return new Response(null, { status: 502 });
    }

    /** @type {Record<string, string>} */
    const responseHeaders = {};
    for (const name of ALLOWED_RESPONSE_HEADERS) {
      const value = upstream.headers && typeof upstream.headers.get === 'function'
        ? upstream.headers.get(name)
        : null;
      if (value != null) responseHeaders[name] = value;
    }

    // Streamed: upstream.body is a ReadableStream, accepted directly by the
    // Response constructor — never awaited/buffered in full here.
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  };
}

module.exports = { createMediaProxyHandler, ALLOWED_RESPONSE_HEADERS, FORWARDED_REQUEST_HEADERS };
