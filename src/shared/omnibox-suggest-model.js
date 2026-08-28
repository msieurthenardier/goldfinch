// @ts-check

// Pure omnibox-suggestions decision module (M08 Flight 4, Leg 3 / flight DD5).
// Zero imports, zero Electron/DOM, zero direct reads of the system clock —
// every timing/identity input is passed in by the renderer.js controller,
// which owns all glue/events. This mirrors the default-routing.js /
// inherit-container.js split: the DECISION is pure and unit-tested here; the
// controller is thin wiring. (Grep-AC: this file must have zero hits for the
// wall-clock read every other pure module in this house avoids calling
// directly — see pruneOneJar/suggest's `now`-injection precedent.)
//
// M15 F1 Leg 4 (DD11) adds `mergeSuggestionSources` — bookmark rows first
// (already ≤3 pre-merge, from bookmarks-suggest's own limit), deduped
// against history by `bookmarkUrlsMatch` (bookmark wins), total capped at 6
// — and stamps every merged row with `kind: 'bookmark' | 'history'`, which
// `buildSuggestionModel` now forwards onto the model item unchanged. Every
// PRE-EXISTING export's signature is untouched (`shouldQuery` byte-for-byte;
// see the leg's own verification grep).

import { bookmarkUrlsMatch } from './bookmark-url.js';

/**
 * Query gate (flight DD5): suggestions engage only when the address bar is
 * focused, the active tab is a WEB/blank tab in a PERSISTENT jar (never
 * internal, never burner — both structurally excluded), and the trimmed
 * input is non-empty.
 * @param {{ focused: boolean, isInternal: boolean, isBurner: boolean, value: string }} args
 * @returns {boolean}
 */
export function shouldQuery({ focused, isInternal, isBurner, value }) {
  return !!focused && !isInternal && !isBurner && typeof value === 'string' && value.trim() !== '';
}

/**
 * Best-effort host extraction for the model's secondary line. Suggestion URLs
 * are stored history rows — most are well-formed, but a malformed/legacy row
 * must never throw the model build. `URL` is unavailable to `// @ts-check`'s
 * lib set only if `dom`/`es2022` aren't included (they are, per jsconfig) —
 * defensive try/catch is still the contract (leg spec).
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Clamp a selection index into the valid `-1..count-1` range (no wrap).
 * @param {number} index
 * @param {number} count
 * @returns {number}
 */
function clampSelection(index, count) {
  if (!Number.isInteger(index)) return -1;
  if (index < -1) return -1;
  if (index > count - 1) return count - 1;
  return index;
}

/**
 * Compose the chrome-owned `#suggest-status` live region's announcement text
 * for a suggestions model (M17 F1 L3 / DD12): "No matches" when there are no
 * items; the plain count when there is no selection; otherwise the
 * highlighted row's primary/secondary text plus its position, with a
 * trailing ", bookmark" for bookmark rows (mirroring the sheet's own sr-only
 * row description). Never throws on malformed input — every field is
 * defensively typed/defaulted, matching buildSuggestionModel's own
 * non-throwing discipline.
 * @param {{ items?: Array<{ primary?: any, secondary?: any, kind?: any }>, selectedIndex?: number }} model
 * @returns {string}
 */
export function suggestionAnnouncement(model) {
  const items = model && Array.isArray(model.items) ? model.items : [];
  if (items.length === 0) return 'No matches';
  const selectedIndex = model && Number.isInteger(model.selectedIndex) ? model.selectedIndex : -1;
  if (selectedIndex < 0 || selectedIndex > items.length - 1) {
    return `${items.length} suggestion${items.length === 1 ? '' : 's'}`;
  }
  const item = items[selectedIndex] || {};
  const primary = typeof item.primary === 'string' ? item.primary : '';
  const secondary = typeof item.secondary === 'string' ? item.secondary : '';
  const parts = [primary];
  if (secondary) parts.push(secondary);
  parts.push(`${selectedIndex + 1} of ${items.length}`);
  let text = parts.join(', ');
  if (item.kind === 'bookmark') text += ', bookmark';
  return text;
}

/**
 * Build the sheet's `suggestions` template model from a raw store response.
 * @param {Array<{ url?: any, title?: any, kind?: any }> | null | undefined} suggestions
 * @param {number} selectedIndex
 * @returns {{ items: Array<{ primary: string, secondary: string, kind: 'bookmark' | 'history' }>, selectedIndex: number, emptyNote?: string, announcement: string }}
 */
export function buildSuggestionModel(suggestions, selectedIndex) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const items = list.map((s) => {
    const url = s && typeof s.url === 'string' ? s.url : '';
    const title = s && typeof s.title === 'string' ? s.title : '';
    // DD11: pass `kind` through unchanged (no re-derivation) — mergeSuggestionSources
    // is the sole stamping site. Any row not explicitly kind:'bookmark' renders as
    // an ordinary ('history') row, including pre-merge/legacy inputs with no kind
    // field at all.
    /** @type {'bookmark' | 'history'} */
    const kind = s && s.kind === 'bookmark' ? 'bookmark' : 'history';
    return { primary: title || url, secondary: hostOf(url), kind };
  });
  /** @type {{ items: Array<{ primary: string, secondary: string, kind: 'bookmark' | 'history' }>, selectedIndex: number, emptyNote?: string, announcement: string }} */
  const model = { items, selectedIndex: clampSelection(selectedIndex, items.length), announcement: '' };
  if (items.length === 0) model.emptyNote = 'No matches';
  // DD12: composed from the model itself, after clamping — so the announcement
  // always agrees with what the sheet is about to render.
  model.announcement = suggestionAnnouncement(model);
  return model;
}

/**
 * Merge bookmark and history suggestion rows (flight DD11): bookmark rows
 * first (the caller pre-caps this list at ≤3 via bookmarks-suggest's own
 * `limit` — this function does not re-cap the bookmark side alone), then
 * history rows in their given order, EXCLUDING any history row whose url
 * exactly matches a bookmark row already included (`bookmarkUrlsMatch` — the
 * DD2 identity predicate; bookmark row wins, dedupe only removes history
 * rows that duplicate a SURFACED bookmark row per the leg's Edge Cases).
 * Every output row is stamped with `kind: 'bookmark' | 'history'`. Total
 * output length capped at `limit` (default 6). Non-throwing on any input.
 * @param {Array<{url?: any, title?: any}>} bookmarkRows
 * @param {Array<{url?: any, title?: any}>} historyRows
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{url: any, title: any, kind: 'bookmark' | 'history'}>}
 */
export function mergeSuggestionSources(bookmarkRows, historyRows, { limit = 6 } = {}) {
  const bookmarks = Array.isArray(bookmarkRows) ? bookmarkRows : [];
  const history = Array.isArray(historyRows) ? historyRows : [];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 6;

  /** @type {Array<{url: any, title: any, kind: 'bookmark' | 'history'}>} */
  const merged = [];
  for (const row of bookmarks) {
    if (merged.length >= cap) break;
    merged.push({ url: row && row.url, title: row && row.title, kind: 'bookmark' });
  }
  for (const row of history) {
    if (merged.length >= cap) break;
    const dup = bookmarks.some((b) => bookmarkUrlsMatch(b && b.url, row && row.url));
    if (dup) continue;
    merged.push({ url: row && row.url, title: row && row.title, kind: 'history' });
  }
  return merged;
}

/**
 * Move the selection by `delta`, clamped to `-1..count-1` (no wrap).
 * @param {number} current
 * @param {number} delta
 * @param {number} count
 * @returns {number}
 */
export function moveSelection(current, delta, count) {
  const base = Number.isInteger(current) ? current : -1;
  return clampSelection(base + delta, count);
}

/**
 * Response-time revalidation gate (flight DD5 HIGH — the kebab-while-typing
 * race). A `historySuggest` response paints only if it is still the LATEST
 * outstanding request (seq match) AND the query gate still holds at arrival
 * (the caller re-evaluates `shouldQuery` NOW and passes the result in).
 * @param {{ requestSeq: number, currentSeq: number, gateNow: boolean }} args
 * @returns {boolean}
 */
export function acceptSuggestResponse({ requestSeq, currentSeq, gateNow }) {
  return requestSeq === currentSeq && !!gateNow;
}
