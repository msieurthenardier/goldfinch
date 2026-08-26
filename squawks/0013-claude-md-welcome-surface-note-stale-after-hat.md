# Squawk 0013: CLAUDE.md's welcome-surface note describes behavior the M16 F3 HAT retired

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-26
**Completed**: 2026-08-26

## Report

The welcome-surface paragraph in CLAUDE.md (written at M16 F2, extended at M16 F3 leg 1 with the DOM-contract rule) still describes `render`/`settle` as they were before the Flight 3 HAT: block visibility "only while `reasons.has(x) && current<x>() == null`", "the home page attaches if it is now set", and a dead-end "the panel hides and the address bar gets focus". After HAT items 3 and 6 (commit `46b3f5a`): both blocks are visible by `tab.welcome.reasons.has(x)` alone; Set saves and stays (no attach); `settle` auto-navigates only to run a pending search once an engine resolves; `unsetReasons` and the fallback are gone; `settle`/`render` accept a `{ search }`/`{ home }` override for the just-written value. A reader designing from CLAUDE.md would design against retired behavior. Found by the M16 F3 debrief Developer interview.

## Evidence

- `CLAUDE.md:70` — the stale sentences.
- `src/renderer/chrome/welcome-controller.js` `render`, `settle`, `submitHome`, `submitEngine` — the current shape (doc comments there are accurate).
- `missions/16-search-and-startup-choice/flights/03-welcome-branding/flight-log.md` — the item-3 and item-6 design-review rulings.

Fix: rewrite the paragraph to the current mechanism (reason-driven blocks; save-and-stay; the single pending-search auto-navigation; the override pattern; the DOM-contract rule stays). Verify by re-reading against the controller; the existing structural tests are unaffected.

## Corrective Action

Rewrote the stale sentences in `CLAUDE.md`'s welcome-surface bullet (the DD1 paragraph) to match `welcome-controller.js` as of M16 F3's HAT (commit `46b3f5a`), keeping the bullet's position, DD1 opening sentence, `SEARCH_ENGINES`/pending-query sentence, and the DD2 frozen-DOM-contract sentence verbatim:
- Replaced the stale `render(tab)`/visibility description ("only while `reasons.has(x) && current<x>() == null`") with the current rule: each block's visibility is `tab.welcome.reasons.has(x)` alone (why the tab was opened, never whether the preference is still unset), cited to M16 F3 HAT items 3 and 6 (DD7 pivot).
- Replaced the stale `settle` decision chain ("if a reason is still unset, render; otherwise a pending search runs, else the home page attaches if it is now set, else … the panel hides and the address bar gets focus") with the current one: `settle` attaches only when a pending query is waiting and an engine has resolved; every other case re-renders in place; `submitHome`'s Set saves and stays rather than attaching; the old hide-panel/address-focus fallback and the `unsetReasons` helper are gone (both unreachable/deleted per the HAT item-6 design review).
- Added the `{ search }`/`{ home }` override note for `render`/`settle` (resolves the just-written value ahead of the `settings-changed` broadcast landing).
- Replaced the stale "a block disappears the instant its preference is set … the next time the record is rendered or settled" sentence (blocks no longer disappear) with the current behavior: a shown block stays visible for the tab's life, reflecting the saved value/confirmation, and a background record catches up via `settle` the next time `show(tab)` runs on it.
- Left unchanged: the DD1 opening two sentences, the "both blocks render on a fresh profile … until at least one preference is chosen" sentence (still accurate — reasons are computed fresh per `openNewTab` call from live preference state), the `SEARCH_ENGINES`/pending-query-heading sentence, and the entire DD2 frozen-DOM-contract sentence and its id list.

No source file, test, or other doc touched — only `CLAUDE.md` and this squawk artifact.

## Verification

Verified claim by claim against `src/renderer/chrome/welcome-controller.js` (`render`, `settle`, `show`, `submitHome`, `submitEngine`) and `src/renderer/chrome/tab-controller.js` (`openWelcomeTab`, `attachView`, `welcomeReasons`, `openNewTab`), cross-checked against the M16 F3 Flight 3 flight-log's HAT item-3 and item-6 design-review/applied entries (`missions/16-search-and-startup-choice/flights/03-welcome-branding/flight-log.md`):
- `render(tab, opts)` gates `homeBlock`/`engineBlock` visibility on `tab.welcome.reasons.has('home')`/`.has('search')` only — confirmed, no `current<x>() == null` check remains.
- `settle(tab, opts)` — confirmed its body is exactly the pending-query/engine-resolved attach check, else `render(tab, opts)`; no `hide()`/address-focus fallback exists in the file.
- `submitHome` — confirmed it calls `welcomeSetPreference` then, on success, `settle(tab, { home: value })` (no `attachView` call on the success path).
- `submitEngine` — confirmed the pending-query branch attaches directly, and the no-pending-query path calls `settle(tab, { search: id })`; `reasons` is never mutated.
- `render`/`settle` signatures — confirmed both accept `opts` and resolve `'search' in opts ? opts.search : currentSearchEngine()` / `'home' in opts ? opts.home : currentHomePage()`.
- `unsetReasons` — confirmed absent from the file (grep: no matches).
- `show(tab)`/`onSettingsChanged` — confirmed `show` sets `currentTab` then calls `settle(tab)` with no override; the `onSettingsChanged` handler re-settles only `currentTab`, returning early when there is none.
- DD1/DD2 sentences (left untouched) — confirmed the tab is opened via `openWelcomeTab` with no `goldfinch://` URL, and the id list in the DD2 sentence matches every id assigned in the controller's build section.

`npm test`: 3792 passing, 0 failed, before and after the edit (doc-only change; no test file touched, so the count could not move) — `real 0m3.878s`.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — one review round (clean on the first pass), batch turnaround 2026-08-26
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-26 (0013, 0014, 0015)` on `squawk/turnaround-2026-08-26` (PR number recorded on the PR itself)

Reviewer verified every claim in the rewritten paragraph against `src/renderer/chrome/welcome-controller.js` and `tab-controller.js`'s `welcomeReasons`: `show` → `settle`; visibility from `tab.welcome.reasons.has(x)` alone; `settle` attaches only when a pending query and a resolved engine coexist; `submitHome` → `settle(tab, { home })` with no attach; `unsetReasons` absent from `src/`; the `{ search }`/`{ home }` override pattern; `onSettingsChanged` re-settles only the shown record. DD1/DD2 content byte-identical. Suite 3792/3792. Verdict: "Squawk 0013's rewrite of the welcome-surface paragraph in CLAUDE.md matches `welcome-controller.js`'s current behavior claim-by-claim, correctly retires the stale render/settle/fallback description, and leaves the DD1/DD2 content untouched — approved."
