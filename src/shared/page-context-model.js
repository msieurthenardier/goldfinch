// @ts-check

// Page-context menu model for the menu-overlay sheet (M05 Flight 8, Leg 4 / AC2).
// Pure params→model builder: ports the section logic of the chrome renderer's
// buildPageContextSections (which keeps serving the gate-OFF path until the Leg-5
// cutover deletes it — two derivations coexist during the parallel run, bridged by
// mirrored unit assertions; do NOT refactor the old renderer to consume this).
//
// Sections, in order (separators BETWEEN sections, never before the first):
//   link → image → selection → editable → spelling → always(bookmark-page, Inspect).
// Toolbar mode (toolbarItem set) short-circuits to the single Unpin item.
//
// NAMESPACED id space (the Leg-3 lesson, mandatory): `link:*`, `image:*`, `sel:*`,
// `edit:*`, `spell:<index>`, `action:inspect`, `action:bookmark-page`,
// `action:unpin:<item>`. Spelling dispatches by INDEX (DD8): the id carries only
// `spell:2`; the chrome resolves the word from the CAPTURED
// params.dictionarySuggestions[2] with bounds/type validation — a guest-controlled
// string never round-trips as a command, only as a rendered label (the sheet
// renders labels via textContent only).
//
// `action:bookmark-page` (M15 F1 Leg 2, flight DD4): a THIRD parameter, an
// options object `opts` — extensible, backward-compatible with every existing
// 2-arg call (opts defaults to {}) — carries `opts.isBookmarked`, computed by
// the chrome from ITS OWN bookmarks cache keyed on the captured tab's URL
// (never guest-influenced `params`). Lives in the always-present section
// beside `action:inspect` (same section, no separator between the two — one
// separator precedes the whole group, mirroring every other section).
//
// `opts.canBookmark` (M15 F2 Leg 3, L3-DD-D): burner/internal tabs can never
// own a bookmark, so the item is OMITTED entirely (not present-but-inert) —
// computed chrome-side from the captured tab (exists ∧ ¬internal ∧ ¬burner).
// Defaults to true when omitted (every pre-Leg-3 2-arg/3-arg call site is
// unaffected) — only an EXPLICIT `false` suppresses the item; `action:inspect`
// always renders regardless.
//
// Item types (extends the Leg-3 registry vocabulary):
//   { type: 'item', id, label }   — focusable role="menuitem" button
//   { type: 'separator' }         — role="separator", non-focusable, skipped by roving
//   { type: 'note', text }        — aria-disabled, non-focusable ("No suggestions")

/** Truncate a string for an inline menu label — the renderer's truncateLabel rule,
 * inlined here (a shared module must not reach into renderer.js).
 * @param {any} s @param {number} n */
function truncateForLabel(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** @type {{ [item: string]: string }} */
const UNPIN_LABELS = { media: 'Unpin Media', shields: 'Unpin Shields', devtools: 'Unpin DevTools' };

/**
 * Build the typed page-context menu model from the captured context-menu params.
 * @param {any} params  the guest context-menu params captured at open (or null —
 *   keyboard/toolbar invocations carry no params; yields the Inspect-only menu)
 * @param {('media'|'shields'|'devtools'|null)} [toolbarItem]  toolbar-unpin mode
 * @param {{ isBookmarked?: boolean, canBookmark?: boolean }} [opts]  M15 F1 Leg 2 — extensible options bag (canBookmark added M15 F2 Leg 3)
 * @returns {Array<{ type: 'item', id: string, label: string } | { type: 'separator' } | { type: 'note', text: string }>}
 */
export function pageContextModel(params, toolbarItem, opts = {}) {
  /** @type {Array<{ type: 'item', id: string, label: string } | { type: 'separator' } | { type: 'note', text: string }>} */
  const model = [];

  // --- toolbar-mode: single "Unpin {item}" — short-circuit; no page sections. ---
  if (toolbarItem) {
    const label = UNPIN_LABELS[toolbarItem];
    if (label) model.push({ type: 'item', id: 'action:unpin:' + toolbarItem, label });
    return model;
  }

  const p = params || {};
  let needSep = false;
  /** Separator before the next section — skipped before the first. */
  const sep = () => {
    if (needSep) model.push({ type: 'separator' });
  };
  /** @param {string} id @param {string} label */
  const item = (id, label) => {
    model.push({ type: 'item', id, label });
    needSep = true;
  };

  // --- link ---
  if (p.linkURL) {
    sep();
    item('link:open', 'Open link in new tab');
    item('link:copy', 'Copy link');
  }

  // --- image (mediaType gate; prefer srcURL, fall back to imageURL) ---
  const imgSrc = p.mediaType === 'image' ? (p.srcURL || p.imageURL) : null;
  if (imgSrc) {
    sep();
    item('image:open', 'Open image in new tab');
    item('image:copy', 'Copy image address');
    item('image:save', 'Save image');
  }

  // --- selection ---
  if (p.selectionText) {
    sep();
    item('sel:copy', 'Copy');
    item('sel:search', 'Search for "' + truncateForLabel(p.selectionText, 30) + '"');
  }

  // --- editable (gated per editFlags; the whole section is OMITTED when no flag) ---
  if (p.isEditable) {
    const f = p.editFlags || {};
    /** @type {Array<[string, string]>} */
    const acts = [];
    if (f.canCut) acts.push(['edit:cut', 'Cut']);
    if (f.canCopy) acts.push(['edit:copy', 'Copy']);
    if (f.canPaste) acts.push(['edit:paste', 'Paste']);
    if (f.canUndo) acts.push(['edit:undo', 'Undo']);
    if (f.canRedo) acts.push(['edit:redo', 'Redo']);
    if (acts.length) {
      sep();
      for (const [id, label] of acts) item(id, label);
    }
  }

  // --- spelling suggestions (sliced to 8; INDEX ids; note fallback when none) ---
  if (p.misspelledWord) {
    sep();
    const sugg = Array.isArray(p.dictionarySuggestions) ? p.dictionarySuggestions.slice(0, 8) : [];
    if (sugg.length) {
      sugg.forEach((word, i) => item('spell:' + i, String(word)));
    } else {
      model.push({ type: 'note', text: 'No suggestions' });
      needSep = true;
    }
  }

  // --- always: Bookmark this page + Inspect (one section, no separator between
  //     the two — a single separator precedes the whole group) ---
  sep();
  // L3-DD-D: OMIT (not disable) the bookmark item when the captured tab can't
  // own one — an explicit `false` only; undefined/omitted opts default to true.
  if (!opts || opts.canBookmark !== false) {
    item('action:bookmark-page', opts && opts.isBookmarked ? 'Edit bookmark…' : 'Bookmark this page');
  }
  item('action:inspect', 'Inspect');
  return model;
}
