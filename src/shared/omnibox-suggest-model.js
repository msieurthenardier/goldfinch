// @ts-check

// Pure omnibox-suggestions decision module (M08 Flight 4, Leg 3 / flight DD5).
// Zero imports, zero Electron/DOM, zero direct reads of the system clock —
// every timing/identity input is passed in by the renderer.js controller,
// which owns all glue/events. This mirrors the default-routing.js /
// inherit-container.js split: the DECISION is pure and unit-tested here; the
// controller is thin wiring. (Grep-AC: this file must have zero hits for the
// wall-clock read every other pure module in this house avoids calling
// directly — see pruneOneJar/suggest's `now`-injection precedent.)

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
 * Build the sheet's `suggestions` template model from a raw store response.
 * @param {Array<{ url?: any, title?: any }> | null | undefined} suggestions
 * @param {number} selectedIndex
 * @returns {{ items: Array<{ primary: string, secondary: string }>, selectedIndex: number, emptyNote?: string }}
 */
export function buildSuggestionModel(suggestions, selectedIndex) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const items = list.map((s) => {
    const url = s && typeof s.url === 'string' ? s.url : '';
    const title = s && typeof s.title === 'string' ? s.title : '';
    return { primary: title || url, secondary: hostOf(url) };
  });
  /** @type {{ items: Array<{ primary: string, secondary: string }>, selectedIndex: number, emptyNote?: string }} */
  const model = { items, selectedIndex: clampSelection(selectedIndex, items.length) };
  if (items.length === 0) model.emptyNote = 'No matches';
  return model;
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
