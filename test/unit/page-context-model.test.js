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
test('full params: link → image → selection → editable → spelling → Inspect, separators between', () => {
  const model = pageContextModel(fullParams(), null);
  assert.deepEqual(ids(model), [
    'link:open', 'link:copy',
    'image:open', 'image:copy', 'image:save',
    'sel:copy', 'sel:search',
    'edit:cut', 'edit:copy', 'edit:paste', 'edit:undo', 'edit:redo',
    'spell:0', 'spell:1', 'spell:2',
    'action:inspect'
  ]);
  // Separators sit exactly between sections: 6 sections → 5 separators.
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
    'action:inspect'
  ]);
});

test('zero sections (plain page area / null params): Inspect only — no leading separator', () => {
  for (const params of [null, {}, { linkURL: '' }]) {
    const model = pageContextModel(params, null);
    assert.deepEqual(model, [{ type: 'item', id: 'action:inspect', label: 'Inspect' }]);
  }
});

// ---------------------------------------------------------------------------
// Image gate: mediaType === 'image' AND srcURL || imageURL preference
// ---------------------------------------------------------------------------
test('image section requires mediaType image; srcURL preferred over imageURL', () => {
  // mediaType not image → no image section even with srcURL present
  const noImg = pageContextModel({ mediaType: 'video', srcURL: 'https://x/a.mp4' }, null);
  assert.deepEqual(ids(noImg), ['action:inspect']);
  // srcURL preferred (the preference is observable at the chrome dispatch — the
  // model itself carries no URL; presence is what the builder decides on)
  const both = pageContextModel({ mediaType: 'image', srcURL: 'https://x/a.png', imageURL: 'https://x/b.png' }, null);
  assert.deepEqual(ids(both), ['image:open', 'image:copy', 'image:save', 'action:inspect']);
  // imageURL alone still qualifies (the fallback half of srcURL || imageURL)
  const fallback = pageContextModel({ mediaType: 'image', imageURL: 'https://x/b.png' }, null);
  assert.deepEqual(ids(fallback), ['image:open', 'image:copy', 'image:save', 'action:inspect']);
  // mediaType image with NEITHER url → no section
  const neither = pageContextModel({ mediaType: 'image' }, null);
  assert.deepEqual(ids(neither), ['action:inspect']);
});

// ---------------------------------------------------------------------------
// Editable: per-flag gating; whole section omitted when no flag is set
// ---------------------------------------------------------------------------
test('editable renders only the truthy editFlags, in cut/copy/paste/undo/redo order', () => {
  const model = pageContextModel({ isEditable: true, editFlags: { canPaste: true, canUndo: true } }, null);
  assert.deepEqual(ids(model), ['edit:paste', 'edit:undo', 'action:inspect']);
});

test('editable with no flags (or missing editFlags) omits the section entirely', () => {
  for (const editFlags of [{}, undefined, { canCut: false }]) {
    const model = pageContextModel({ isEditable: true, editFlags }, null);
    assert.deepEqual(model, [{ type: 'item', id: 'action:inspect', label: 'Inspect' }]);
  }
});

// ---------------------------------------------------------------------------
// Selection: truncation (30) + quoting
// ---------------------------------------------------------------------------
test('selection: Copy + quoted Search label, truncated at 30 with ellipsis', () => {
  const long = 'a'.repeat(64);
  const model = pageContextModel({ selectionText: long }, null);
  assert.deepEqual(ids(model), ['sel:copy', 'sel:search', 'action:inspect']);
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
    // A separator still lands between the note and Inspect (the note counts as content).
    assert.deepEqual(model[model.length - 2], { type: 'separator' });
    assert.deepEqual(ids(model), ['action:inspect']);
  }
});

// ---------------------------------------------------------------------------
// Always-Inspect + toolbar short-circuit
// ---------------------------------------------------------------------------
test('Inspect is always last, with a separator before it whenever any section precedes', () => {
  const model = pageContextModel({ linkURL: 'https://x/' }, null);
  assert.deepEqual(model[model.length - 1], { type: 'item', id: 'action:inspect', label: 'Inspect' });
  assert.equal(model[model.length - 2].type, 'separator');
});

test('toolbar mode short-circuits to the single namespaced Unpin item — page sections ignored', () => {
  for (const [itm, label] of [['media', 'Unpin Media'], ['shields', 'Unpin Shields'], ['devtools', 'Unpin DevTools']]) {
    const model = pageContextModel(fullParams(), /** @type {any} */ (itm));
    assert.deepEqual(model, [{ type: 'item', id: 'action:unpin:' + itm, label }]);
  }
});

test('unknown toolbar item yields an empty model (validated no-op shape)', () => {
  assert.deepEqual(pageContextModel(null, /** @type {any} */ ('bogus')), []);
});
