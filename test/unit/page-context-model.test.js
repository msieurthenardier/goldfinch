'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { pageContextModel } = require('../../src/shared/page-context-model');

/** All-sections params (mirrors the audit hook's synthetic payload). */
function fullParams() {
  return {
    linkURL: 'https://example.com/',
    mediaType: 'image',
    srcURL: 'https://example.com/a.png',
    imageURL: 'https://example.com/b.png',
    selectionText: 'sample',
    isEditable: true,
    editFlags: { canCut: true, canCopy: true, canPaste: true, canUndo: true, canRedo: true },
    misspelledWord: 'teh',
    dictionarySuggestions: ['the', 'ten', 'tea']
  };
}

const ids = (model) => model.filter((m) => m.type === 'item').map((m) => m.id);

// ---------------------------------------------------------------------------
// Section presence + order + separators between (never before the first)
// ---------------------------------------------------------------------------
test('full params: link → image → selection → editable → spelling → (bookmark-page, Inspect), separators between sections', () => {
  const model = pageContextModel(fullParams(), null);
  assert.deepEqual(ids(model), [
    'link:open', 'link:copy',
    'image:open', 'image:copy', 'image:save',
    'sel:copy', 'sel:search',
    'edit:cut', 'edit:copy', 'edit:paste', 'edit:undo', 'edit:redo',
    'spell:0', 'spell:1', 'spell:2',
    'action:bookmark-page', 'action:inspect'
  ]);
  // Separators sit exactly between sections: 6 sections → 5 separators (the
  // always-present bookmark-page + Inspect group counts as ONE section — no
  // separator between the two items inside it).
  assert.equal(model.filter((m) => m.type === 'separator').length, 5);
  assert.notEqual(model[0].type, 'separator'); // never before the first section
  // Order pinned positionally: separator directly after each section's last item.
  const labels = model.map((m) => (m.type === 'separator' ? '|' : m.type === 'note' ? '(note)' : m.id));
  assert.deepEqual(labels, [
    'link:open', 'link:copy', '|',
    'image:open', 'image:copy', 'image:save', '|',
    'sel:copy', 'sel:search', '|',
    'edit:cut', 'edit:copy', 'edit:paste', 'edit:undo', 'edit:redo', '|',
    'spell:0', 'spell:1', 'spell:2', '|',
    'action:bookmark-page', 'action:inspect'
  ]);
});

test('zero sections (plain page area / null params): bookmark-page + Inspect only — no leading separator', () => {
  for (const params of [null, {}, { linkURL: '' }]) {
    const model = pageContextModel(params, null);
    assert.deepEqual(model, [
      { type: 'item', id: 'action:bookmark-page', label: 'Bookmark this page' },
      { type: 'item', id: 'action:inspect', label: 'Inspect' }
    ]);
  }
});

// ---------------------------------------------------------------------------
// Image gate: mediaType === 'image' AND srcURL || imageURL preference
// ---------------------------------------------------------------------------
test('image section requires mediaType image; srcURL preferred over imageURL', () => {
  // mediaType not image → no image section even with srcURL present
  const noImg = pageContextModel({ mediaType: 'video', srcURL: 'https://x/a.mp4' }, null);
  assert.deepEqual(ids(noImg), ['action:bookmark-page', 'action:inspect']);
  // srcURL preferred (the preference is observable at the chrome dispatch — the
  // model itself carries no URL; presence is what the builder decides on)
  const both = pageContextModel({ mediaType: 'image', srcURL: 'https://x/a.png', imageURL: 'https://x/b.png' }, null);
  assert.deepEqual(ids(both), ['image:open', 'image:copy', 'image:save', 'action:bookmark-page', 'action:inspect']);
  // imageURL alone still qualifies (the fallback half of srcURL || imageURL)
  const fallback = pageContextModel({ mediaType: 'image', imageURL: 'https://x/b.png' }, null);
  assert.deepEqual(ids(fallback), ['image:open', 'image:copy', 'image:save', 'action:bookmark-page', 'action:inspect']);
  // mediaType image with NEITHER url → no section
  const neither = pageContextModel({ mediaType: 'image' }, null);
  assert.deepEqual(ids(neither), ['action:bookmark-page', 'action:inspect']);
});

// ---------------------------------------------------------------------------
// Editable: per-flag gating; whole section omitted when no flag is set
// ---------------------------------------------------------------------------
test('editable renders only the truthy editFlags, in cut/copy/paste/undo/redo order', () => {
  const model = pageContextModel({ isEditable: true, editFlags: { canPaste: true, canUndo: true } }, null);
  assert.deepEqual(ids(model), ['edit:paste', 'edit:undo', 'action:bookmark-page', 'action:inspect']);
});

test('editable with no flags (or missing editFlags) omits the section entirely', () => {
  for (const editFlags of [{}, undefined, { canCut: false }]) {
    const model = pageContextModel({ isEditable: true, editFlags }, null);
    assert.deepEqual(model, [
      { type: 'item', id: 'action:bookmark-page', label: 'Bookmark this page' },
      { type: 'item', id: 'action:inspect', label: 'Inspect' }
    ]);
  }
});

// ---------------------------------------------------------------------------
// Selection: truncation (30) + quoting
// ---------------------------------------------------------------------------
test('selection: Copy + quoted Search label, truncated at 30 with ellipsis', () => {
  const long = 'a'.repeat(64);
  const model = pageContextModel({ selectionText: long }, null);
  assert.deepEqual(ids(model), ['sel:copy', 'sel:search', 'action:bookmark-page', 'action:inspect']);
  const search = model.find((m) => m.type === 'item' && m.id === 'sel:search');
  assert.equal(search.label, `Search for "${'a'.repeat(29)}…"`);
  // Short selection: whitespace collapsed, quoted verbatim, no ellipsis.
  const short = pageContextModel({ selectionText: '  hello\n world ' }, null);
  const shortSearch = short.find((m) => m.type === 'item' && m.id === 'sel:search');
  assert.equal(shortSearch.label, 'Search for "hello world"');
});

// ---------------------------------------------------------------------------
// Spelling: index ids, slice to 8, note fallback
// ---------------------------------------------------------------------------
test('spelling suggestions are sliced to 8 with spell:<index> ids and word labels', () => {
  const sugg = Array.from({ length: 12 }, (_, i) => 'word' + i);
  const model = pageContextModel({ misspelledWord: 'teh', dictionarySuggestions: sugg }, null);
  const spell = model.filter((m) => m.type === 'item' && m.id.startsWith('spell:'));
  assert.equal(spell.length, 8);
  assert.deepEqual(spell.map((m) => m.id), ['spell:0', 'spell:1', 'spell:2', 'spell:3', 'spell:4', 'spell:5', 'spell:6', 'spell:7']);
  assert.deepEqual(spell.map((m) => m.label), sugg.slice(0, 8));
});

test('zero suggestions → non-focusable note fallback (the only non-item affordance)', () => {
  for (const dictionarySuggestions of [[], undefined, 'not-an-array']) {
    const model = pageContextModel({ misspelledWord: 'teh', dictionarySuggestions }, null);
    const note = model.find((m) => m.type === 'note');
    assert.deepEqual(note, { type: 'note', text: 'No suggestions' });
    // A separator still lands between the note and the always-present group
    // (the note counts as content); bookmark-page + Inspect follow with no
    // separator between them.
    assert.deepEqual(model[model.length - 3], { type: 'separator' });
    assert.deepEqual(ids(model), ['action:bookmark-page', 'action:inspect']);
  }
});

// ---------------------------------------------------------------------------
// Always-present group + toolbar short-circuit
// ---------------------------------------------------------------------------
test('bookmark-page then Inspect are always last (no separator between them), with a separator before the group whenever any section precedes', () => {
  const model = pageContextModel({ linkURL: 'https://x/' }, null);
  assert.deepEqual(model[model.length - 1], { type: 'item', id: 'action:inspect', label: 'Inspect' });
  assert.deepEqual(model[model.length - 2], { type: 'item', id: 'action:bookmark-page', label: 'Bookmark this page' });
  assert.equal(model[model.length - 3].type, 'separator');
});

test('opts.isBookmarked toggles the bookmark-page label between "Bookmark this page" and "Edit bookmark…"', () => {
  const unbookmarked = pageContextModel(null, null, { isBookmarked: false });
  assert.equal(unbookmarked.find((m) => m.id === 'action:bookmark-page').label, 'Bookmark this page');
  const bookmarked = pageContextModel(null, null, { isBookmarked: true });
  assert.equal(bookmarked.find((m) => m.id === 'action:bookmark-page').label, 'Edit bookmark…');
});

test('opts is optional (every pre-leg 2-arg call site is unaffected) and defaults isBookmarked to falsy', () => {
  const twoArg = pageContextModel(null, null);
  assert.equal(twoArg.find((m) => m.id === 'action:bookmark-page').label, 'Bookmark this page');
});

test('toolbar mode short-circuits to the single namespaced Unpin item — page sections AND the bookmark-page/Inspect group are ignored', () => {
  for (const [itm, label] of [['media', 'Unpin Media'], ['shields', 'Unpin Shields'], ['devtools', 'Unpin DevTools']]) {
    const model = pageContextModel(fullParams(), /** @type {any} */ (itm), { isBookmarked: true });
    assert.deepEqual(model, [{ type: 'item', id: 'action:unpin:' + itm, label }]);
  }
});

test('unknown toolbar item yields an empty model (validated no-op shape)', () => {
  assert.deepEqual(pageContextModel(null, /** @type {any} */ ('bogus')), []);
});

// ---------------------------------------------------------------------------
// Vault indicator toolbar mode (squawk 0038, #113 "Lock now" half — the
// pinnable half is DECLINED; this is NOT an UNPIN_LABELS entry).
// ---------------------------------------------------------------------------
test('toolbar mode "vault": unlocked yields the single "Lock now" item, page sections ignored', () => {
  const model = pageContextModel(fullParams(), /** @type {any} */ ('vault'), { vaultLocked: false });
  assert.deepEqual(model, [{ type: 'item', id: 'action:vault-lock', label: 'Lock now' }]);
});

test('toolbar mode "vault": already locked OMITS the item (nothing to lock) — empty model, not disabled', () => {
  const model = pageContextModel(null, /** @type {any} */ ('vault'), { vaultLocked: true });
  assert.deepEqual(model, []);
});

test('toolbar mode "vault": vaultLocked defaults to falsy when opts is omitted (item present)', () => {
  const model = pageContextModel(null, /** @type {any} */ ('vault'));
  assert.deepEqual(model, [{ type: 'item', id: 'action:vault-lock', label: 'Lock now' }]);
});
