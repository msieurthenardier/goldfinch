'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldQuery,
  buildSuggestionModel,
  mergeSuggestionSources,
  moveSelection,
  acceptSuggestResponse
} = require('../../src/shared/omnibox-suggest-model');

// ---------------------------------------------------------------------------
// shouldQuery — gate truth table (flight DD5: focused AND !internal AND
// !burner AND non-empty trimmed value)
// ---------------------------------------------------------------------------

test('shouldQuery: focused, persistent web tab, non-empty value → true', () => {
  assert.equal(shouldQuery({ focused: true, isInternal: false, isBurner: false, value: 'exa' }), true);
});

test('shouldQuery: not focused → false', () => {
  assert.equal(shouldQuery({ focused: false, isInternal: false, isBurner: false, value: 'exa' }), false);
});

test('shouldQuery: internal tab → false (structural exclusion)', () => {
  assert.equal(shouldQuery({ focused: true, isInternal: true, isBurner: false, value: 'exa' }), false);
});

test('shouldQuery: burner tab → false (structural exclusion)', () => {
  assert.equal(shouldQuery({ focused: true, isInternal: false, isBurner: true, value: 'exa' }), false);
});

test('shouldQuery: internal AND burner both true → false', () => {
  assert.equal(shouldQuery({ focused: true, isInternal: true, isBurner: true, value: 'exa' }), false);
});

test('shouldQuery: empty value → false', () => {
  assert.equal(shouldQuery({ focused: true, isInternal: false, isBurner: false, value: '' }), false);
});

test('shouldQuery: whitespace-only value → false (trimmed)', () => {
  assert.equal(shouldQuery({ focused: true, isInternal: false, isBurner: false, value: '   ' }), false);
});

test('shouldQuery: non-string value → false, never throws', () => {
  assert.doesNotThrow(() => {
    assert.equal(
      shouldQuery({ focused: true, isInternal: false, isBurner: false, value: /** @type {any} */ (undefined) }),
      false
    );
  });
});

// ---------------------------------------------------------------------------
// buildSuggestionModel — item mapping, bad URLs, empty note, clamps
// ---------------------------------------------------------------------------

test('buildSuggestionModel: maps url/title to primary/secondary (host)', () => {
  const model = buildSuggestionModel([{ url: 'https://example.com/path', title: 'Example Site' }], 0);
  assert.deepEqual(model.items, [{ primary: 'Example Site', secondary: 'example.com', kind: 'history' }]);
  assert.equal(model.selectedIndex, 0);
  assert.equal(model.emptyNote, undefined);
});

test('buildSuggestionModel: missing/empty title falls back to the URL as primary', () => {
  const model = buildSuggestionModel([{ url: 'https://example.com/', title: '' }], -1);
  assert.deepEqual(model.items, [{ primary: 'https://example.com/', secondary: 'example.com', kind: 'history' }]);
});

test('buildSuggestionModel: malformed URL never throws — secondary falls back to empty string', () => {
  assert.doesNotThrow(() => {
    const model = buildSuggestionModel([{ url: 'not a url', title: '' }], 0);
    assert.deepEqual(model.items, [{ primary: 'not a url', secondary: '', kind: 'history' }]);
  });
});

test('buildSuggestionModel: non-string url/title fields never throw', () => {
  assert.doesNotThrow(() => {
    const model = buildSuggestionModel(/** @type {any} */ ([{ url: null, title: 42 }]), 0);
    assert.deepEqual(model.items, [{ primary: '', secondary: '', kind: 'history' }]);
  });
});

// ---------------------------------------------------------------------------
// buildSuggestionModel — DD11 kind passthrough
// ---------------------------------------------------------------------------

test('buildSuggestionModel: kind:"bookmark" passes through unchanged', () => {
  const model = buildSuggestionModel([{ url: 'https://example.com/', title: 'Example', kind: 'bookmark' }], -1);
  assert.deepEqual(model.items, [{ primary: 'Example', secondary: 'example.com', kind: 'bookmark' }]);
});

test('buildSuggestionModel: kind:"history" and a missing kind field both render as history', () => {
  const model = buildSuggestionModel(
    [
      { url: 'https://a.com/', title: 'A', kind: 'history' },
      { url: 'https://b.com/', title: 'B' }
    ],
    -1
  );
  assert.deepEqual(
    model.items.map((i) => i.kind),
    ['history', 'history']
  );
});

test('buildSuggestionModel: an unrecognized kind value is never trusted verbatim — renders as history', () => {
  const model = buildSuggestionModel(
    [{ url: 'https://a.com/', title: 'A', kind: /** @type {any} */ ('not-a-real-kind') }],
    -1
  );
  assert.equal(model.items[0].kind, 'history');
});

test('buildSuggestionModel: empty suggestions → items:[] + emptyNote', () => {
  const model = buildSuggestionModel([], -1);
  assert.deepEqual(model.items, []);
  assert.equal(model.emptyNote, 'No matches');
  assert.equal(model.selectedIndex, -1);
});

test('buildSuggestionModel: null/undefined suggestions treated as empty, never throws', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(buildSuggestionModel(/** @type {any} */ (null), 0).items, []);
    assert.deepEqual(buildSuggestionModel(/** @type {any} */ (undefined), 0).items, []);
  });
});

test('buildSuggestionModel: selectedIndex clamped to -1..items.length-1 (too high)', () => {
  const model = buildSuggestionModel([{ url: 'https://a.com', title: 'A' }], 5);
  assert.equal(model.selectedIndex, 0);
});

test('buildSuggestionModel: selectedIndex clamped to -1..items.length-1 (too low)', () => {
  const model = buildSuggestionModel([{ url: 'https://a.com', title: 'A' }], -5);
  assert.equal(model.selectedIndex, -1);
});

test('buildSuggestionModel: non-integer selectedIndex clamps to -1', () => {
  const model = buildSuggestionModel([{ url: 'https://a.com', title: 'A' }], /** @type {any} */ (NaN));
  assert.equal(model.selectedIndex, -1);
});

// ---------------------------------------------------------------------------
// mergeSuggestionSources — DD11: bookmark-first, history-dedupe-by-url,
// total cap, kind stamping
// ---------------------------------------------------------------------------

test('mergeSuggestionSources: bookmark rows first, then history, both stamped with kind', () => {
  const bookmarks = [{ url: 'https://bm.example/', title: 'Bookmarked' }];
  const history = [{ url: 'https://hist.example/', title: 'Visited' }];
  assert.deepEqual(mergeSuggestionSources(bookmarks, history), [
    { url: 'https://bm.example/', title: 'Bookmarked', kind: 'bookmark' },
    { url: 'https://hist.example/', title: 'Visited', kind: 'history' }
  ]);
});

test('mergeSuggestionSources: a history row exactly duplicating a bookmark URL is dropped — bookmark wins', () => {
  const bookmarks = [{ url: 'https://dupe.example/', title: 'Bookmark Title' }];
  const history = [
    { url: 'https://dupe.example/', title: 'History Title (stale/different)' },
    { url: 'https://unique.example/', title: 'Unique' }
  ];
  const merged = mergeSuggestionSources(bookmarks, history);
  assert.deepEqual(merged, [
    { url: 'https://dupe.example/', title: 'Bookmark Title', kind: 'bookmark' },
    { url: 'https://unique.example/', title: 'Unique', kind: 'history' }
  ]);
});

test('mergeSuggestionSources: a 4th+ matching bookmark beyond the source cap is not deduped away — its history row still surfaces plain', () => {
  // The pre-merge bookmark list already reflects bookmarks-suggest's own ≤3
  // cap (Edge Case: dedupe only removes history rows that duplicate a
  // SURFACED bookmark row) — this function never re-derives that cap from a
  // longer bookmark list, it just merges what it's given.
  const bookmarks = [
    { url: 'https://one.example/', title: 'One' },
    { url: 'https://two.example/', title: 'Two' },
    { url: 'https://three.example/', title: 'Three' }
  ];
  const history = [{ url: 'https://four.example/', title: 'Four (would-be 4th bookmark)' }];
  const merged = mergeSuggestionSources(bookmarks, history);
  assert.deepEqual(
    merged.map((r) => ({ url: r.url, kind: r.kind })),
    [
      { url: 'https://one.example/', kind: 'bookmark' },
      { url: 'https://two.example/', kind: 'bookmark' },
      { url: 'https://three.example/', kind: 'bookmark' },
      { url: 'https://four.example/', kind: 'history' }
    ]
  );
});

test('mergeSuggestionSources: total capped at 6 (default), bookmarks counted first', () => {
  const bookmarks = [{ url: 'https://b1.example/' }, { url: 'https://b2.example/' }, { url: 'https://b3.example/' }];
  const history = [
    { url: 'https://h1.example/' },
    { url: 'https://h2.example/' },
    { url: 'https://h3.example/' },
    { url: 'https://h4.example/' } // pushed past the cap, dropped
  ];
  const merged = mergeSuggestionSources(bookmarks, history);
  assert.equal(merged.length, 6);
  assert.deepEqual(
    merged.map((r) => r.url),
    [
      'https://b1.example/',
      'https://b2.example/',
      'https://b3.example/',
      'https://h1.example/',
      'https://h2.example/',
      'https://h3.example/'
    ]
  );
});

test('mergeSuggestionSources: respects a custom limit', () => {
  const bookmarks = [{ url: 'https://b1.example/' }, { url: 'https://b2.example/' }];
  const history = [{ url: 'https://h1.example/' }, { url: 'https://h2.example/' }];
  const merged = mergeSuggestionSources(bookmarks, history, { limit: 3 });
  assert.deepEqual(
    merged.map((r) => r.url),
    ['https://b1.example/', 'https://b2.example/', 'https://h1.example/']
  );
});

test('mergeSuggestionSources: empty bookmark list degrades to history-only (Edge Case: empty store)', () => {
  const history = [{ url: 'https://h1.example/', title: 'H1' }];
  assert.deepEqual(mergeSuggestionSources([], history), [{ url: 'https://h1.example/', title: 'H1', kind: 'history' }]);
});

test('mergeSuggestionSources: empty history list degrades to bookmark-only', () => {
  const bookmarks = [{ url: 'https://b1.example/', title: 'B1' }];
  assert.deepEqual(mergeSuggestionSources(bookmarks, []), [
    { url: 'https://b1.example/', title: 'B1', kind: 'bookmark' }
  ]);
});

test('mergeSuggestionSources: non-array/malformed inputs never throw, treated as empty', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(mergeSuggestionSources(/** @type {any} */ (null), /** @type {any} */ (undefined)), []);
    assert.deepEqual(mergeSuggestionSources(/** @type {any} */ ('x'), /** @type {any} */ (42)), []);
  });
});

// ---------------------------------------------------------------------------
// moveSelection — clamped, no wrap
// ---------------------------------------------------------------------------

test('moveSelection: ArrowDown from -1 (no selection) selects the first item', () => {
  assert.equal(moveSelection(-1, 1, 3), 0);
});

test('moveSelection: ArrowUp from 0 returns to -1 (no wrap to the bottom)', () => {
  assert.equal(moveSelection(0, -1, 3), -1);
});

test('moveSelection: ArrowDown at the last item stays put (no wrap to the top)', () => {
  assert.equal(moveSelection(2, 1, 3), 2);
});

test('moveSelection: ArrowUp at -1 stays at -1 (floor, no wrap)', () => {
  assert.equal(moveSelection(-1, -1, 3), -1);
});

test('moveSelection: zero items always resolves -1', () => {
  assert.equal(moveSelection(-1, 1, 0), -1);
  assert.equal(moveSelection(0, 1, 0), -1);
});

test('moveSelection: non-integer current treated as -1, never throws', () => {
  assert.doesNotThrow(() => {
    assert.equal(moveSelection(/** @type {any} */ (undefined), 1, 3), 0);
  });
});

// ---------------------------------------------------------------------------
// acceptSuggestResponse — accept/reject matrix (incl. the kebab-while-typing
// race and the response-after-tab-switch row — flight DD5 HIGH)
// ---------------------------------------------------------------------------

test('acceptSuggestResponse: latest seq + gate holds → accept', () => {
  assert.equal(acceptSuggestResponse({ requestSeq: 3, currentSeq: 3, gateNow: true }), true);
});

test('acceptSuggestResponse: stale seq (a newer request superseded this one) → reject', () => {
  assert.equal(acceptSuggestResponse({ requestSeq: 2, currentSeq: 3, gateNow: true }), false);
});

test('acceptSuggestResponse: latest seq but gate no longer holds (kebab opened meanwhile) → reject', () => {
  assert.equal(acceptSuggestResponse({ requestSeq: 3, currentSeq: 3, gateNow: false }), false);
});

test('acceptSuggestResponse: response-after-tab-switch — activateTab bumped seq past the in-flight request → reject', () => {
  // The request was minted at seq 5 for the previous tab's jar; activateTab
  // bumped suggest.seq to 6 before the response arrived (design review HIGH:
  // an in-flight response for the previous tab's jar must be invalidated even
  // when the gate would otherwise still read true for the NEW tab).
  assert.equal(acceptSuggestResponse({ requestSeq: 5, currentSeq: 6, gateNow: true }), false);
});

test('acceptSuggestResponse: stale seq AND gate false → reject', () => {
  assert.equal(acceptSuggestResponse({ requestSeq: 1, currentSeq: 2, gateNow: false }), false);
});
