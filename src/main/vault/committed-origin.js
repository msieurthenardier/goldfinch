'use strict';

// The COMMITTED origin of a tab (Mission 23 Flight 1, leg `vault-fill-trust`, finding NF12).
//
// A derived read over `webContents.getURL()`, not a stored field: the design review measured that
// `getURL()` keeps answering with the previous committed URL for the whole of a pending navigation
// (the new URL appears only at commit), so it is the committed document's URL. This function answers
// only for a tuple http(s) origin, so the picker's fill checks never run against an error page, an
// `about:` page, a `file:` page, a `data:` page, a `blob:` page or a `goldfinch://` page. (The older
// `tabOriginFor` in vault-human.js, also used by capture and automation, is deliberately unchanged.)
//
// Pure and Electron-free.

/**
 * @param {unknown} url  what `webContents.getURL()` returned
 * @returns {string | null}  `https://host[:port]` / `http://host[:port]`, or `null` when there is none
 */
function committedOriginOf(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!parsed.hostname) return null;
  // `URL.origin` of an http(s) URL is the serialised tuple origin (userinfo and path dropped).
  return parsed.origin;
}

module.exports = { committedOriginOf };
