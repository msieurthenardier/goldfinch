// @ts-check
'use strict';

// Squawk 0119: Electron's default user agent carries two embedder tokens —
// the app token (`goldfinch/<version>`, from the package `name`) and
// `Electron/<version>` — between `Chrome/…` and `Safari/…`. Sites sniff
// `" Electron/"` (claude.ai routes such a UA to its desktop-app frame and
// then expects `window.claudeAppBindings`; embedded-login blocks refuse it).
// Goldfinch is a general-purpose browser, so web sessions present a
// Chrome-shaped UA: `session-runtime.js` `onSessionCreated` applies this to
// every WEB session (the internal session keeps its default).
//
// Electron-free and pure: removes exactly those two tokens (each with its one
// adjoining space), never hardcodes a version, leaves every other token —
// including the parenthesised platform comment — byte-identical. Idempotent.
// User-Agent Client Hints brands are deliberately untouched (out of scope).

const EMBEDDER_TOKEN = /^(?:goldfinch|electron)\/\S+$/i;

/**
 * Strip the `goldfinch/<ver>` and `Electron/<ver>` tokens from a UA string.
 * Non-string or empty input is returned unchanged.
 * @param {unknown} userAgent
 * @returns {unknown}
 */
function stripEmbedderTokens(userAgent) {
  if (typeof userAgent !== 'string' || userAgent === '') return userAgent;
  return userAgent
    .split(' ')
    .filter((token) => !EMBEDDER_TOKEN.test(token))
    .join(' ');
}

module.exports = { stripEmbedderTokens };
