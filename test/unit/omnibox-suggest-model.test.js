'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldQuery,
  buildSuggestionModel,
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
    assert.equal(shouldQuery({ focused: true, isInternal: false, isBurner: false, value: /** @type {any} */ (undefined) }), false);
  });
});

// ---------------------------------------------------------------------------
// buildSuggestionModel — item mapping, bad URLs, empty note, clamps
// ---------------------------------------------------------------------------

test('buildSuggestionModel: maps url/title to primary/secondary (host)', () => {
  const model = buildSuggestionModel(
    [{ url: 'https://example.com/path', title: 'Example Site' }],
    0
  );
  assert.deepEqual(model.items, [{ primary: 'Example Site', secondary: 'example.com' }]);
  assert.equal(model.selectedIndex, 0);
  assert.equal(model.emptyNote, undefined);
});

test('buildSuggestionModel: missing/empty title falls back to the URL as primary', () => {
  const model = buildSuggestionModel([{ url: 'https://example.com/', title: '' }], -1);
  assert.deepEqual(model.items, [{ primary: 'https://example.com/', secondary: 'example.com' }]);
});

test('buildSuggestionModel: malformed URL never throws — secondary falls back to empty string', () => {
  assert.doesNotThrow(() => {
    const model = buildSuggestionModel([{ url: 'not a url', title: '' }], 0);
    assert.deepEqual(model.items, [{ primary: 'not a url', secondary: '' }]);
  });
});

test('buildSuggestionModel: non-string url/title fields never throw', () => {
  assert.doesNotThrow(() => {
    const model = buildSuggestionModel(
      /** @type {any} */ ([{ url: null, title: 42 }]),
      0
    );
    assert.deepEqual(model.items, [{ primary: '', secondary: '' }]);
  });
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
  const model = buildSuggestionModel(
    [{ url: 'https://a.com', title: 'A' }],
    /** @type {any} */ (NaN)
  );
  assert.equal(model.selectedIndex, -1);
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
