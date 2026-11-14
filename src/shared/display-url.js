// @ts-check

// Mission 23 Flight 1, leg `prompts-and-bounds`: the address the operator is SHOWN (and the address history
// STORES) never carries a username or password. A link or a redirect can commit `trusted.example@evil.example`
// style addresses; the address bar showing the raw committed URL made that disguise work.
//
// Pure and display-only. Navigation, reload, the session snapshot, the closed-tab stack and credential handling
// keep using the REAL URL - such addresses still load and still authenticate (intranet devices need that).
// The helper is applied at exactly two kinds of site: main's pushes of a URL to the chrome, and the history
// recorder's stored address (pinned by `test/unit/display-url.test.js`).
//
// Everything else is returned byte-identical: the input string is only cut, never re-serialised, so a URL with
// nothing to remove (or one that does not parse) comes back as the very same string.

/**
 * @param {unknown} url
 * @returns {string} `url` with any username/password removed; the input unchanged when there is nothing to remove
 */
export function displayUrl(url) {
  if (typeof url !== 'string' || !url.includes('@')) return /** @type {any} */ (url);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.username && !parsed.password) return url;
  // Cut the userinfo out of the original text: scheme "//" authority, userinfo is everything up to the LAST "@"
  // inside the authority (which ends at the first "/", "?" or "#").
  const m = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/s.exec(url);
  if (m) {
    const at = m[2].lastIndexOf('@');
    if (at !== -1) return m[1] + m[2].slice(at + 1) + m[3];
  }
  // Unusual spellings (for example backslashes) fall back to the parsed form with the credentials cleared.
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

/**
 * A load-failure record as the chrome is shown it: a copy whose `url` has no credentials. The stored
 * record (snapshot, closed-tab capture) keeps the real address.
 * @template {{ url?: string } | null | undefined} T
 * @param {T} failure
 * @returns {T}
 */
export function failureForChrome(failure) {
  if (!failure || typeof failure.url !== 'string') return failure;
  return /** @type {T} */ ({ ...failure, url: displayUrl(failure.url) });
}

/**
 * A crash record as the chrome is shown it: a copy whose `url` has no credentials. The entry's own
 * record keeps the real address. Display only: the chrome reads `crash.url` to label the panel and its
 * tab, and Reload goes through main's `reload` verb, never this value.
 * @template {{ url?: string } | null | undefined} T
 * @param {T} crash
 * @returns {T}
 */
export function crashForChrome(crash) {
  if (!crash || typeof crash.url !== 'string') return crash;
  return /** @type {T} */ ({ ...crash, url: displayUrl(crash.url) });
}

/** Longest page title stored in history or pushed to the chrome, in characters. */
export const TITLE_MAX_CHARS = 512;

/**
 * Cut a page title to the cap without leaving half a surrogate pair at the end. Non-strings come back as is.
 * @template T
 * @param {T} title
 * @returns {T}
 */
export function capTitle(title) {
  if (typeof title !== 'string' || title.length <= TITLE_MAX_CHARS) return title;
  let end = TITLE_MAX_CHARS;
  const last = title.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return /** @type {T} */ (/** @type {unknown} */ (title.slice(0, end)));
}
