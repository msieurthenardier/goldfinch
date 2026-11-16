// @ts-check
'use strict';

// The ONE cleaner for text that comes from outside the browser and is shown inside the browser's own
// sentence (the sign-in card's realm, the reveal gate's native confirmation). One character-class table,
// not two (Mission 23 Flight 2, leg `admin-reach`).

/**
 * Whitespace (including line breaks) becomes single spaces; control, format (bidi overrides, zero-width),
 * lone-surrogate characters and every double-quote form are removed so the text cannot close a quote and
 * continue in the browser's voice; the result is capped at `max` characters with an ellipsis (a cut never
 * splits a surrogate pair). The input is sliced BEFORE any regular expression runs, so a very large string
 * costs a bounded amount of work. Anything that cleans to nothing is the empty string. Other scripts are
 * kept.
 * @param {unknown} text
 * @param {number} max  the cap in characters, ellipsis included
 * @returns {string}
 */
function cleanDisplayText(text, max) {
  if (typeof text !== 'string' || text.length === 0) return '';
  // Bound the work first: nothing past a generous window can survive the cap anyway.
  const cleaned = text
    .slice(0, max * 8)
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}"“”„‟″‶❝❞〝〞〟＂«»]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  let end = max - 1;
  const last = cleaned.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return cleaned.slice(0, end).trimEnd() + '…';
}

module.exports = { cleanDisplayText };
