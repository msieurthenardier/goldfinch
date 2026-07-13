# Leg: omnibox-wiring

**Status**: completed
**Flight**: [Address-Bar Suggestions](../flight.md)

## Objective

Wire the omnibox: the pure decision module
`src/shared/omnibox-suggest-model.js`, the renderer suggestions
controller (query gate, debounce, token + gate revalidation, keyboard,
close-trigger matrix, `sug:<i>` dispatch), and the aria touches — per
flight DD5 as amended.

## Inputs (leg-2 carry-forwards)

- The sheet's `suggestions` model shape is `{ items: [{ primary,
  secondary }], selectedIndex, emptyNote? }` — an OBJECT. **The `onInit`
  guard at menu-overlay.js (~:570) REJECTS it today**
  (`!Array.isArray(model)` short-circuits — CONFIRMED blocking; the
  sheet would silently never render). Widen exactly as prescribed at
  design review: compute `template = TEMPLATES[menuType] || 'menu'`
  BEFORE the model check, then
  `template === 'suggestions' ? (model && typeof model === 'object' &&
  !Array.isArray(model)) : Array.isArray(model)`.
- Ch2 reasons now allowlist `escape | blur | navigation | input-empty |
  activated` (+ legacy two).
- `bridge.historySuggest` (leg 1); manager `noFocus` flag (leg 2).

## Contract

1. **`src/shared/omnibox-suggest-model.js`** (ESM, `// @ts-check`, zero
   imports; unit-tested):
   - `shouldQuery({ focused, isInternal, isBurner, value })` → boolean
     (all gates from flight DD5: focused AND !internal AND !burner AND
     non-empty trimmed value).
   - `buildSuggestionModel(suggestions, selectedIndex)` →
     `{ items, selectedIndex, emptyNote? }` — items map
     `{ url, title }` → `{ primary: title || url, secondary: host-of-url
     (defensive try/catch) }`; empty suggestions + a live query →
     `emptyNote: 'No matches'`; `selectedIndex` clamped to
     `-1..items.length-1`.
   - `moveSelection(current, delta, count)` → clamped (no wrap) index.
   - `acceptSuggestResponse({ requestSeq, currentSeq, gateNow })` →
     boolean — the response-time revalidation seam (flight DD5 HIGH):
     paints only if the request is the latest AND the gate still holds.
   - Tests: gate truth table, model mapping (incl. bad URLs), clamps,
     accept/reject matrix.
2. **`src/renderer/renderer.js`** — suggestions controller:
   - Module-scope state: `suggest = { seq: 0, items: [], selectedIndex:
     -1, graceTimer: null, debounceTimer: null, lastQuery: '' }` — **NO
     local `open` flag** *(design review Q3 ruling: single source of
     truth — read `overlayMenus.suggestions.open`)*; the
     `overlayMenus.suggestions` registry entry uses
     `ariaTarget: () => els.address` (the generic mechanism stamps
     `aria-expanded` on open and non-stale close — no hand-rolled
     toggling *(design review)*), `refocus: NONE` (flight pin), and a
     one-line comment that `blurClosedAt` is written-but-unread here (no
     trigger-click path).
   - **Ch7 sink gains a `suggestions` branch** *(design review, HIGH —
     window-blur and other main-initiated closes would otherwise leave
     stale local state)*: on every NON-STALE suggestions close (any
     reason), reset `items`/`selectedIndex`, cancel the grace AND
     debounce timers.
   - `openOverlayMenu` gains an optional opts param (`{ noFocus }`)
     merged into the Ch1 payload — existing callers unchanged.
   - `input` listener on `els.address` (100 ms debounce): gate via
     `shouldQuery` (address focused, active tab web/blank + persistent
     jar); bump `seq`; `historySuggest({ jarId:
     activeTab().container.id, query })`; on response, gate through
     `acceptSuggestResponse` (re-evaluate `shouldQuery` NOW + seq match)
     before `openOverlayMenu('suggestions', model, anchor, { noFocus:
     true })`. Anchor: `leftAnchorOf(els.address)`-style, `y: 0`.
     `{ok:false}` responses → close if open, never throw.
   - Keydown extension (the existing Enter handler grows):
     ArrowDown/ArrowUp when open → move selection + re-open
     (model-replace with new selectedIndex; still noFocus) +
     `preventDefault`; Enter with `selectedIndex >= 0` → `navigate(items
     [i].url)` + close reason `activated`; Enter otherwise → EXISTING
     behavior byte-identical; Escape when open → close reason `escape` +
     `preventDefault` (input keeps focus/text).
   - Close helper `closeSuggestions(reason)`: no-op unless open; calls
     `window.goldfinch.menuOverlayClose({ reason })`; resets local state.
   - Close triggers: input emptied (`input-empty`); address `blur` — a
     150 ms grace timer whose callback closes ONLY IF the captured token
     is still current AND `document.activeElement !== els.address`
     *(design review, HIGH — refocus-within-grace (retype, the in-bar
     zoom buttons, Ctrl+L) mints no new token; the activeElement check
     covers "the operator came back")*; navigation of the active tab
     (`onTabDidNavigate` + in-page variant → `navigation`);
     `activateTab` → reset local state AND **bump `suggest.seq`**
     *(design review, HIGH — an in-flight response for the previous
     tab's jar must be invalidated; DOM blur is not guaranteed on
     programmatic activation, e.g. MCP activateTab; add the
     response-after-tab-switch truth row to the pure-module tests)* —
     main already closed the sheet on tab-switch, do NOT double-send;
     EXCEPT the brand-new-tab path *(design review, MEDIUM)*:
     `createTab`'s synchronous `activateTab` runs before any
     `tabSetActive` reaches main (wcId still null), so main's
     tab-switch close never fires in that window — the createTab
     sync-activate branch calls `closeSuggestions('navigation')`
     explicitly.
   - Ch6 dispatch: `sug:<i>` branch — parse index, bounds-check against
     `suggest.items`, `navigate(items[i].url)`; vanished/mismatched →
     no-op. (Ch7 for suggestions updates `open` state via the standard
     sink; cancel the grace timer on activation.)
   - Aria: `els.address` gets `aria-autocomplete="list"` (static, in
     index.html); `aria-expanded` rides the registry `ariaTarget`
     mechanism (above), NOT controller code.
   - `closeSuggestions` also clears the pending debounce timer
     (hygiene — saves a dead IPC round trip).
3. **No new CSS in chrome** (the dropdown is sheet-side, leg 2).
4. `index.html` gains the load-order-legibility
   `<script src="../shared/omnibox-suggest-model.js" type="module">` tag
   beside the other shared-module tags (house convention — the import
   alone would resolve, but every imported shared module gets a tag).

## Acceptance Criteria

- [x] Pure module + tests per contract (incl. the accept/reject matrix —
      the kebab-while-typing race is pinned there).
- [x] Controller per contract; existing Enter/navigate behavior
      byte-identical when no suggestion is selected; existing menus'
      openOverlayMenu callers unchanged.
- [x] The sheet model guard accepts the object shape (verified or
      widened).
- [x] Grep-ACs: `grep -n "historySuggest" src/renderer/renderer.js` hits
      only inside the controller; no `Date.now()` in the pure module.
- [x] `npm test` / typecheck / lint green; suite ~1s.

## Files Affected

- `src/shared/omnibox-suggest-model.js` — new (+ test)
- `src/renderer/renderer.js`, `src/renderer/index.html`
- `src/renderer/menu-overlay.js` (model-guard verify/widen only)
- `eslint.config.mjs` if the new shared ESM file needs the module list
  (check the src/shared block — it may already cover it)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

Seams recon/Architect-verified this flight: els.address listeners
(lone Enter handler), leftAnchorOf/anchor mechanics, overlayMenus
registry + Ch7 sink, openOverlayMenu genericity, activeTab().container,
tab-switch main-side close, sanitize cap forcing index dispatch. Leg-2
carry-forward: the object model shape + onInit guard.
