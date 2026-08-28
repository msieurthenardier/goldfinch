# Leg: Omnibox Suggestion Announcement

**Status**: completed
**Flight**: [Keyboard Reachability and Omnibox Semantics](../flight.md)
**Slug**: `omnibox-suggestion-announcement`
**Risk tier**: high — changes the accessible semantics of the chrome's primary input and a shared overlay-state contract (`ariaTarget`); adds an export to the shared pure model.

## Objective

Give screen-reader users the state of the address-bar suggestions popup — how many rows, which row is highlighted and where it sits, "No matches" — through a chrome-owned polite live region, and stop the chrome from setting an ARIA attribute the address bar's role does not permit. Closes maintenance finding F49 (Mission 17 criterion: keyboard/AT reachability of the omnibox). Zero lines added to `renderer.js` (at its budget, 1828, after Leg 2).

## Context

**Ground truth (2026-08-28).**

- `src/renderer/index.html:125-134` — `#address` is a plain `<input type="text">` (implicit role `textbox`) with `aria-label="Address and search bar"` and `aria-autocomplete="list"`; no `role`, no `aria-expanded` at rest.
- `src/renderer/renderer.js:463-469` — the `suggestions` overlay state declares `ariaTarget: () => els.address`; `src/renderer/chrome/overlay-menus.js:52-57` (`open`) and `:86-90` (`onMenuOverlayClosed`) call `state.ariaTarget()?.setAttribute('aria-expanded', …)`. So today `#address` **gains `aria-expanded="true"` while the popup is open**.
- axe-core 4.13.0 (`node_modules/axe-core/axe.js:13592-13597`): `textbox` allows only `aria-activedescendant, aria-autocomplete, aria-multiline, aria-placeholder, aria-readonly, aria-required` — `aria-expanded` on `#address` is an `aria-allowed-attr` violation in every open state. `combobox` (`:13145-13151`) requires **both** `aria-expanded` and `aria-controls`; the listbox lives in the menu-overlay sheet's separate `WebContentsView` (`src/renderer/menu-overlay.js:675-678`, `role="listbox"`), a different document, so `aria-controls` can never resolve — a combobox role would trade one open-state violation for another (`aria-required-attr`). `npm run a11y` (`scripts/a11y-audit.mjs`) audits chrome states at rest and sheet states by `--target`; it has never audited the chrome with suggestions open, which is why neither gap has surfaced.
- The highlighted row is JS state only: `src/renderer/chrome/navigation-controller.js:229` `suggest.selectedIndex`; ArrowDown/ArrowUp move it via `moveSelection` (`src/shared/omnibox-suggest-model.js:131-134`) and repaint (`paintSuggestions`, `navigation-controller.js:290-296`) — every paint is a model-replace through `openOverlayMenu('suggestions', model, …, { noFocus: true })`; OS focus never leaves `#address` (M08 F4 DD2). The model (`buildSuggestionModel`, `omnibox-suggest-model.js:70-87`) is `{ items: [{ primary, secondary, kind }], selectedIndex, emptyNote? }` with `emptyNote: 'No matches'` when empty — and an empty result set still opens the sheet (the sheet renders the note).
- The sheet's rows carry `aria-selected` and, for bookmarks, an `sr-only` "bookmark" description (`menu-overlay.js:700-760`) — none of it reachable from the chrome document's AT tree.
- Existing chrome-owned live regions and their idiom: `#media-status` (`index.html:421`) and `#tab-status` (`index.html:425`, "a dedicated sibling … so tab-reorder announcements never race media-panel ones", M09 F2 DD3); `announceTabStatus` sets `els.tabStatus.textContent` (`src/renderer/chrome/window-controller.js:42-46`); ids are registered in `src/renderer/chrome/context.js:22-23`.
- Local state resets: `resetSuggestState` (`navigation-controller.js:245-249`) runs on every close (`closeSuggestions` `:277-281`), the main-initiated close sink, and tab activation (`resetSuggestionsForActivation` `:251-258`).
- Tests: the pure model has `test/unit/omnibox-suggest-model.test.js`; the controller harness (`test/unit/navigation-controller.test.js:16-56` `El` with `textContent`/`setAttribute`; `:60-74` builds `els` from a `names` list) is the only `createNavigationController` harness (`seam-contract`, `homepage-literal-scan`, `search-engines` only grep the file). No unit test pins `aria-expanded` on `#address` or the suggestions `ariaTarget` (grep 2026-08-28). One behavior spec names the address bar's role ("address textbox": `tests/behavior/chrome-guest-keyboard-nav.md`, rows 6 and 13) — unaffected while the role stays `textbox`.
- `src/main/history-store.js:438-460` `suggest` is FTS-narrowed (`visits_fts`, `prefix='2 3 4'`, unicode61) — a query `keyboard` matches the `keyboard-nav: …` fixture titles the keyboard-nav runs left in the personal jar's history.

**DD11 — the address bar stays a `textbox`; the `aria-expanded` toggle is retired.** F49's fix shape said "plus `aria-expanded` on `#address`"; ground truth amends it: the attribute is already toggled and is invalid on the role, and `combobox` cannot be made valid without an in-document listbox (moving the list into the chrome is the out-of-scope full fix F49 already names). So: `renderer.js:467` `ariaTarget: () => els.address` → `ariaTarget: () => null` (edit in place — no line added; `overlay-menus.js` is already null-safe via `?.`), `aria-autocomplete="list"` retained (permitted on `textbox`), no `role`/`aria-haspopup`/`aria-expanded` on `#address` in any state. Open/closed state reaches AT through DD12 instead. Rationale: the only configuration with **no** axe violation in any state; smallest change; the ring/selection behaviour and every spec that keys on "address textbox" unchanged. Alternative rejected: `role="combobox"` + `aria-expanded` + `aria-haspopup="listbox"` without `aria-controls` — semantically closer to what the widget is, but a standing `aria-required-attr` violation while open and a role change every existing run log would have to re-read.

**DD12 — a chrome-owned polite live region mirrors the popup state.** New `<div id="suggest-status" class="sr-only" role="status" aria-live="polite"></div>` beside `#tab-status` (`index.html:425`) — its own region, per the M09 F2 DD3 no-race idiom; `context.js` registers `suggestStatus: 'suggest-status'`. Text is composed by a new pure export `suggestionAnnouncement(model)` in `src/shared/omnibox-suggest-model.js`, and **`buildSuggestionModel` attaches it to the model it returns as `announcement`** (`{ items, selectedIndex, emptyNote?, announcement }`). Design review (cycle 1): `navigation-controller.js` has no top-level imports — every pure helper reaches it through the deps object `renderer.js` builds (`renderer.js:19-25` import list, `:547-551` deps pass-through, both one-per-line under Prettier), so wiring a new helper would cost ≥ 2 `renderer.js` lines against a file at budget. Riding on the model that already crosses that seam costs none. The sheet's `renderSuggestions` reads only `items`/`selectedIndex`/`emptyNote` and ignores the extra field; main does not validate the model shape (grep `emptyNote|selectedIndex` in `src/main/` — no hits). Composition rules:
  - no items → `No matches`
  - `selectedIndex < 0` → `{n} suggestion` / `{n} suggestions`
  - otherwise → `{primary}, {secondary}, {i+1} of {n}` (omit the `, {secondary}` segment when `secondary` is empty), with `, bookmark` appended when `kind === 'bookmark'` — mirroring the sheet's `sr-only` description.
  `paintSuggestions()` sets `els.suggestStatus.textContent = model.announcement` on every paint (fresh results and selection moves alike); `resetSuggestState()` clears it to `''` — which covers every chrome-initiated close (`closeSuggestions`: escape, blur, navigation, input-empty, activated) and tab switch (`resetSuggestionsForActivation`). **The close sink is a separate path** (design review, cycles 1–2): `handleSuggestionsClosed(reason)` (`navigation-controller.js:585-591`) is reached from `renderer.js:1234-1248` `handleOverlayClosed` for **every** suggestions close — chrome-initiated (`escape`, `blur`, `navigation`, `input-empty`, `activated`) and main-initiated (`outside-click`, `toggle`, `superseded`, `tab-switch`, `tab-hide`, `tab-close`, `teardown`, window-level `blur`; the set in `src/main/menu-overlay-manager.js:396-397`). It re-implements the item/selection clear inline and would leave stale text on the main-initiated reasons; it becomes `if (reason !== 'activated') resetSuggestState(); else cancelSuggestTimers();` (the `'activated'` branch keeps `suggest.items` for `dispatchSuggestion`, which resets afterwards; cancelling the blur grace timer there is the pre-existing behaviour). Note: an MCP `activateTab` (→ `tab-set-active`, `register-tab-ipc.js:1005-1009`) closes with `'tab-switch'`; `'tab-hide'` is sent only from the new-tab-without-wcId branch (`tab-controller.js:920`). No "closed" announcement on any path (the operator or the window caused it). Known live-region behaviour: consecutive identical text is not re-announced (retyping to the same count) — accepted.

**DD13 — verification.** Unit: the pure function's truth table; the controller announces on paint and clears on close/switch/activation (harness `names` gains `suggestStatus`); structural pins: `index.html` has the region with `role="status"` + `aria-live="polite"` + `sr-only` and `#address` has no `aria-expanded`/`role`; `renderer.js` suggestions state has `ariaTarget: () => null` (regex-target pin, neuter-verified). Real environment: new spec `tests/behavior/omnibox-suggestion-announcement.md` (authored with this leg, draft) — the region's text read via `evaluate(C)` and corroborated by `readAxTree(C)`'s status node, popup open/closed corroborated by `enumerateWindows().sheetVisible` (the suggestions sheet itself is unobservable to automation — CLAUDE.md "READABLE BUT NOT SCRIPTABLE"). Docs: `docs/renderer-menu.md:58-61` suggestions-template bullet gains the live-region sentence; goldfinch `CLAUDE.md` a11y line unchanged.

## Inputs

- Tree on `flight/01-keyboard-reachability` with Legs 1–2 landed (uncommitted; 3920 tests; gates green; `renderer.js` = 1828 = `RENDERER_LINE_BUDGET`).
- Fixture server on :8001; the personal jar's history holding the `keyboard-nav: …` visits (else visit `form.html` and `links.html` once before the run).

## Outputs

- `src/renderer/index.html` (`#suggest-status`), `src/renderer/chrome/context.js` (`suggestStatus`), `src/renderer/renderer.js:467` (`ariaTarget: () => null`, in place), `src/shared/omnibox-suggest-model.js` (`suggestionAnnouncement`), `src/renderer/chrome/navigation-controller.js` (announce on paint; clear in `resetSuggestState`; `handleSuggestionsClosed` → `resetSuggestState`), tests (`omnibox-suggest-model.test.js`, `navigation-controller.test.js`, one new structural-pin file), `docs/renderer-menu.md`; the behavior spec; flight-log leg entry; this leg `landed`.

## Acceptance Criteria

- [x] AC1: `suggestionAnnouncement` returns `No matches` for an empty model; `1 suggestion` / `{n} suggestions` with no selection; `{primary}, {secondary}, {i+1} of {n}` for a selection, omitting an empty `secondary`, appending `, bookmark` for bookmark rows; never throws on malformed input — unit-pinned.
- [x] AC2: the controller writes `model.announcement` to `#suggest-status` on every paint (fresh results, ArrowDown/ArrowUp) and clears it on close (`escape`), on the main-initiated close sink (`handleSuggestionsClosed('tab-switch')` and `('blur')`; `('activated')` keeps items until `dispatchSuggestion` resets), and on tab activation — unit-pinned in the navigation-controller harness.
- [x] AC3: `#address` carries no `aria-expanded` in any state: the suggestions overlay state's `ariaTarget` returns `null` (regex-target pin on `renderer.js`, neuter-verified); `index.html` pins: `#suggest-status` present with `role="status"`, `aria-live="polite"`, `class="sr-only"`; `#address` has `aria-autocomplete="list"` and no `role`/`aria-expanded` attribute.
- [x] AC4: `renderer.js` unchanged in length (1828 by the pin's metric); `RENDERER_LINE_BUDGET` untouched.
- [x] AC5: `/behavior-test omnibox-suggestion-announcement` passes on the shipped build.
- [x] AC6: `docs/renderer-menu.md` suggestions bullet documents the live region, the model's `announcement` field, and the retired `aria-expanded`; goldfinch `CLAUDE.md` § Patterns' Prettier bullet reads `RENDERER_LINE_BUDGET` 1828 (pre-existing drift from Leg 2's re-base, folded in here).
- [x] AC7: gates — `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .`.

## Verification Steps

- AC1–AC3: the named test files; neuter checks on the new pins (delete/invert the guarded line → red).
- AC4: `node -e` count with the pin's metric before and after.
- AC5: the run log.
- AC6: read the doc bullet.
- AC7: the gates.

## Implementation Guidance

1. **Pure first**: add `suggestionAnnouncement` to `omnibox-suggest-model.js` beside `buildSuggestionModel` (same non-throwing discipline; JSDoc types) and have `buildSuggestionModel` set `model.announcement = suggestionAnnouncement(model)` (extend the `@type` on the model); truth table in `omnibox-suggest-model.test.js` plus one case that `buildSuggestionModel(...).announcement` equals the pure function's output; existing `deepEqual` pins there assert `model.items` only and stay green.
2. **Markup + registry**: `index.html` region after `#tab-status` with a two-line comment naming DD12 and the no-race sibling idiom; `context.js` `suggestStatus: 'suggest-status'`.
3. **Controller**: in `paintSuggestions()` set `els.suggestStatus.textContent = model.announcement` before opening; in `resetSuggestState()` set `els.suggestStatus.textContent = ''`; rewrite `handleSuggestionsClosed` to `if (reason !== 'activated') resetSuggestState(); else cancelSuggestTimers();` (`resetSuggestState` already cancels timers). **No import, no new dep, no `renderer.js` line** — measure before and after.
4. **DD11**: `renderer.js:467` → `ariaTarget: () => null,` with the trailing comment moved/kept on the same line if needed to stay within Prettier's width — verify the count is still 1828 after `prettier --write`.
5. **Tests**: harness `names` gains `suggestStatus`; cases per AC2 (use the existing suggest-response helpers `h.resolveSuggest`/`h.resolveBookmarksSuggest`, the keydown listener to move the selection, and `controller.handleSuggestionsClosed('tab-switch')` for the sink); new `test/unit/omnibox-live-region-pin.test.js` (grep-shape pins over `index.html`, `context.js`, and the `suggestions: {` block of `renderer.js`, regex-target idiom); neuter-verify each.
6. **Docs**: `docs/renderer-menu.md` bullet.
7. Gates; then the FD runs the behavior test; flight-log entry; leg → `landed` (AC5 pending the run).

## Edge Cases

- **Empty result set**: the sheet still opens with `No matches`; the region says the same. Clearing the input (`input-empty`) closes and clears — no "0 suggestions".
- **ArrowUp at the top**: `moveSelection` clamps to `-1` → the count announcement returns ("5 suggestions"), not an empty string.
- **Stale response after a tab switch**: `acceptSuggestResponse` rejects it before paint — no announcement; `resetSuggestionsForActivation` already cleared the region.
- **Bookmark row**: `, bookmark` suffix (the sheet's description), never in the primary text.
- **Internal/burner tabs**: `shouldQuery` is false — no paint, region stays empty; `#address` is `readOnly` on internal tabs and still has no `aria-expanded`.
- **Identical consecutive announcements** (retype yielding the same count): not re-read by AT — accepted, documented in DD12.
- **Screen-reader focus**: the region is `sr-only` (clipped, not `display:none`) so it stays in the AT tree; it is never focusable and never in the tab sequence (`tabSequence` ignores it — no tabbable role).

## Files Affected

`src/renderer/index.html`, `src/renderer/chrome/context.js`, `src/renderer/renderer.js` (one in-place edit), `src/shared/omnibox-suggest-model.js`, `src/renderer/chrome/navigation-controller.js`, `test/unit/omnibox-suggest-model.test.js`, `test/unit/navigation-controller.test.js`, `test/unit/omnibox-live-region-pin.test.js` (new), `docs/renderer-menu.md`, `CLAUDE.md` (one number), `tests/behavior/omnibox-suggestion-announcement.md` (new, FD-authored).

## Citation Audit

2026-08-28, against the Leg 2 tree: every `file:line` above read at design time (`index.html:125-134, 421, 425`; `renderer.js:463-469`; `overlay-menus.js:52-57, 86-90`; `navigation-controller.js:229, 245-258, 277-281, 290-296, 385-416`; `omnibox-suggest-model.js:70-87, 131-134`; `menu-overlay.js:675-678, 700-760`; `window-controller.js:42-46`; `context.js:22-23`; `history-store.js:438-460`; `navigation-controller.test.js:16-56, 60-74`; `docs/renderer-menu.md:58-61`; `axe.js:13145-13151, 13592-13597`). Cycle-2 review added `register-tab-ipc.js:1005-1009`, `tab-controller.js:906, 920` (close reasons). Cycle-1 review corrected two spans (`El` 16-56, `announceTabStatus` 42-46) and added `navigation-controller.js:585-591`, `renderer.js:19-25, 547-551, 1234-1253`, `menu-overlay-manager.js:396-397`. Nothing vanished.

## Run Record

- Implemented 2026-08-28 (one Developer spawn): `suggestionAnnouncement` + `model.announcement` in the pure model; `#suggest-status` region; `context.js` registration; controller announce-on-paint / clear-on-reset / close sink via `resetSuggestState`; `renderer.js:467` `ariaTarget: () => null` in place (1828 → 1828); docs bullet; CLAUDE.md budget number. Tests 3920 → 3940; four new pins neuter-verified; gates green.
- AC5: `/behavior-test omnibox-suggestion-announcement` run `2026-08-28-02-48-31` — **8/8 pass** (checkpoint 4 on an instrumented rerun; the first-attempt close is an unreproduced flake recorded in the run log and carried to the debrief). Spec → `active`; row 3 gains the region-attribute read; row 6's literal → "unchanged".
