# Leg: omnibox-bookmarks-source

**Status**: completed
**Flight**: [Bookmarking Core and Surfaces](../flight.md)

## Objective

Bookmarked pages surface in address-bar suggestions: token-prefix-matched (history-parity semantics), ranked first (max 3 of 6), deduped against history by exact URL with the bookmark row winning, visually and accessibly distinguishable, available in every jar — with the FTS5-mirror drift risk pinned by a parity test.

## Context

- Governing DD: DD11 (verbatim — including the mirror-drift note requiring the FTS5-parity test) and the mission's jar-boundary ruling (bookmarks are app-scoped; suggestions may surface them in any jar; history stays jar-scoped).
- Current pipeline (verified 2026-07-28, untouched by legs 1-3): `navigation-controller.js:201` single `historySuggest({jarId, query})` invoke → `:211` assigns `res.suggestions` verbatim; pure model `src/shared/omnibox-suggest-model.js` (`shouldQuery :20`, `buildSuggestionModel :60`, `moveSelection :80`, `acceptSuggestResponse :93`); main-side `history-store.js:suggest` (`:449`, limit clamp `:460`, default 6) over FTS5 `unicode61` **with deliberately NO tokenchars override** (schema comment at `:46-50`) and whole-token-prefix matching.
- `shouldQuery`'s jar/burner/internal gates are UNTOUCHED — bookmarks appear only where suggestions appear at all.
- Leg 1-3 ground truth: store list ordered; `bookmarkUrlsMatch` is the only URL identity predicate; `register-bookmarks-ipc.js` is the registrar to extend; suggestions sheet template rows are built at `menu-overlay.js` (~`:450-520`) with `sug:<i>` dispatch — activation mechanism unchanged.

## Inputs

- Legs 1-3 landed uncommitted; suggest pipeline in its pre-flight state

## Outputs

- New: `src/shared/bookmark-suggest.js` (pure tokenizer + matcher), `test/unit/bookmark-suggest.test.js` (incl. FTS5-parity corpus), merge-model tests
- Modified: `src/shared/omnibox-suggest-model.js` (+ its unit test), `src/renderer/chrome/navigation-controller.js`, `src/renderer/menu-overlay.js`/`.css` (row marker), `src/main/register-bookmarks-ipc.js`, `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`, `tests/behavior/omnibox-suggestions.md` (narrowing), CLAUDE.md (pattern note if warranted)

## Acceptance Criteria

- [x] **Matcher** (`src/shared/bookmark-suggest.js`, pure ESM): mirrors what history search **actually does** (design-review empirical findings), not a generic tokenizer:
  - Query handling mirrors `sanitizeSearchQuery`: whitespace-split the raw query into words; each word behaves as an FTS5 **quoted phrase with trailing prefix** — a word containing internal punctuation splits into sub-tokens that must appear **adjacent and in order** in the matched field, with only the LAST sub-token prefix-matched (verified: `"exa-mple"*` matches `exa mplecase` but NOT `exa foo mplecase`). An AND-of-independent-prefixes implementation over-matches and is wrong.
  - Content tokenization mirrors `unicode61` defaults: alphanumeric runs, case-folded, **and diacritic-folded** (NFKD-decompose + strip combining marks — verified: `café`≡`cafe`, `İstanbul`≡`istanbul`); ligature/stroke letters (`ø œ ł ß`) are NOT folded by either side — the corpus pins both classes.
  - Matches over title and URL tokens; returns stored order, `limit` param (default 3); non-throwing on any input.
- [x] **FTS5-parity test** (DD11 mirror-drift note): a unit test builds an in-memory `node:sqlite` FTS5 table (`unicode61`, same `prefix=` config as `visits_fts`) and asserts the JS matcher agrees with FTS5 over a fixed edge-case corpus: diacritics (folded class) AND ligature/stroke letters (unfolded class), punctuation-in-query words with adjacency-positive and adjacency-negative content cases, digits, mixed-case, multi-token queries. Divergences must fail the test — the corpus is the pinned contract. (Verified the test genuinely fails on divergence: a temporary AND-of-independent-prefixes swap-in broke 3/12 tests, including the parity sweep.)
- [x] **Suggest channel**: `bookmarks-suggest` invoke in `register-bookmarks-ipc.js` (app-scoped — no jarId parameter), running the shared matcher over the store's current list; response envelope **mirrors `history-suggest`'s `{ok, suggestions}` shape** (decided: consistency beats minimalism — the controller's `res.ok` discipline applies uniformly to both sources); `bookmarksSuggest({query})` in chrome-preload + `renderer-globals.d.ts`.
- [x] **Merge model** (pure, in `omnibox-suggest-model.js`): new exported merge function — bookmark rows first (≤3), then history rows deduped against them by `bookmarkUrlsMatch` (bookmark row wins), total capped at 6; rows carry `kind: 'bookmark' | 'history'`; `buildSuggestionModel` passes `kind` through unchanged. Existing exports keep their signatures (`shouldQuery` byte-untouched).
- [x] **Controller wiring**: `navigation-controller.js` issues `historySuggest` and `bookmarksSuggest` together via **`Promise.allSettled`** (design-review correction — graceful per-source degradation: a rejected or `ok:false` source is treated as `[]`, so a bookmarks-side failure never blanks history results; `Promise.all` would fail-close the pair), gates the settled pair through the existing `acceptSuggestResponse` seq discipline (a stale pair never paints), merges via the model function; selection/activation (`sug:<i>` into the merged list) unchanged.
- [x] **Row presentation**: suggestions sheet renders `kind==='bookmark'` rows with a real DOM badge span (design-review: no CSS `content:` glyph — the codebase has zero precedent for generated-content markers; every marker is a `textContent` node) and accessibly distinguishable via **`aria-describedby`** referencing a hidden text node ("bookmark") — NOT `aria-label` on the option row, which would override the computed accessible name and drop the visible text for AT users.
- [x] **a11y attempt-and-record** (flight per-leg convention): attempt `npm run a11y` against the running app; record what got audited and any findings in the flight log (the sheet-identity refusal is expected to block sheet states — record, don't fix).
- [x] **Cross-jar behavior**: bookmark suggestions appear for queries in any jar (including jars with no history for that URL); history rows remain jar-scoped; burner/internal gating unchanged (`shouldQuery` untouched — assert via existing tests still passing unmodified).
- [x] **Spec narrowing**: `tests/behavior/omnibox-suggestions.md`'s absolute cross-jar zero-rows step reworded to "zero **history** rows; bookmark rows (marked as bookmarks) are permitted" per DD11 — edited, not run.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; count vs leg-3 close (3244) recorded in flight log; two consecutive clean full runs.

## Verification Steps

- `npm test && npm run typecheck && npm run lint` — green, counts recorded
- `node --test test/unit/bookmark-suggest.test.js` — parity corpus green
- `grep -n "shouldQuery" src/shared/omnibox-suggest-model.js` — signature/body unchanged
- `grep -n "bookmarksSuggest" src/renderer/chrome/navigation-controller.js` — wired through seq gating
- `grep -rni "zero.*rows\|history rows" tests/behavior/omnibox-suggestions.md` — narrowed wording in place (pattern fixed per design review; the original grep could not match the spec's actual "ZERO suggestion rows" text)

## Edge Cases

- **Query matches >3 bookmarks**: first 3 in stored order; history floor preserved.
- **Bookmark URL also in current jar's history**: one row, bookmark-marked (dedupe, bookmark wins).
- **Empty/whitespace query**: `shouldQuery` already gates; matcher returns empty on empty token list.
- **Bookmark with URL-only match** (query matches URL tokens, not title): still surfaces — matcher covers both fields.
- **Store empty**: bookmarks-suggest returns `[]`; pipeline degrades to history-only exactly as today.
- **Race**: bookmark edited between keystrokes — seq gating drops the stale pair; next keystroke re-queries both sources.
- **4th+ matching bookmark**: a bookmark beyond the ≤3 cap is not surfaced as a bookmark row, but its URL may still appear as an undecorated plain history row if present in the current jar's history — correct per DD11 (the dedupe only removes history rows that duplicate a SURFACED bookmark row).
- **Source failure**: `bookmarksSuggest` rejecting or returning `ok:false` degrades that source to `[]`; history results still paint (and vice versa).

## Files Affected

*(see Outputs)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (incl. parity-corpus notes)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (flight-end batched commit)

---

## Citation Audit

Verified by direct grep same-day (2026-07-28), post-leg-3 tree: `navigation-controller.js:201` (`historySuggest` invoke), `:211` (`res.suggestions` verbatim assign); `omnibox-suggest-model.js` exports at `:20/:60/:80/:93`; `history-store.js:449` (`suggest`, limit clamp `:460`); suggest pipeline untouched by legs 1-3 (git diff scope check). `bookmarkUrlsMatch`, `register-bookmarks-ipc.js`, and the suggestions template `sug:<i>` mechanism carried from leg 1-3 audited ground truth.

**Design-review corrections**: FTS5 `unicode61` no-tokenchars comment is at `history-store.js:50-53` (not 46-50); suggestions row-build block is `menu-overlay.js:466-542` (not ~450-520); `sanitizeSearchQuery` quoted-phrase mechanics at `history-store.js:406-413` verified **empirically** against live FTS5 (Node 22 / SQLite 3.50.4) by the design reviewer — adjacency and diacritic-folding findings baked into the matcher AC. `tests/behavior/bookmarks-omnibox.md` step 4 confirmed as the sole (sufficient, deliberate) cross-jar coverage; `omnibox-suggestions.md`'s narrowing is wording-only, no new seeding.
