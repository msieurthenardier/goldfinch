# Behavior Test: Omnibox suggestion announcements (live region)

**Slug**: `omnibox-suggestion-announcement`
**Status**: active
**Created**: 2026-08-28 (Mission 17 Flight 1 Leg 3 — finding F49)
**Last Run**: 2026-08-28-02-48-31 (pass — 8/8; checkpoint 4 on a rerun; see `omnibox-suggestion-announcement/runs/2026-08-28-02-48-31.md`)

## Intent
Verify, in the running app, that the address-bar suggestions popup's state reaches assistive technology
through the chrome-owned `#suggest-status` polite live region (Leg 3 DD12): the row count when results
arrive, the highlighted row's name and position as ArrowDown/ArrowUp move the selection, `No matches` for
an empty result set, and an emptied region on Escape — while `#address` never carries `aria-expanded`
(DD11: the attribute is invalid on a `textbox`; the listbox lives in another document). The suggestions
sheet itself is unobservable to automation (CLAUDE.md "READABLE BUT NOT SCRIPTABLE"), so the region is
the only AT-facing surface and the only thing this spec can assert; open/closed is corroborated by
`enumerateWindows().sheetVisible`.

## Preconditions
- Goldfinch running via **`npm run dev:automation`**; `GOLDFINCH_MCP_PORT` pinned; admin key freshly minted.
- **Apparatus-wiring litmus passed**: `getChromeTarget()` returns this instance's chrome `wcId`.
- Fixtures served on **:8001** (`python3 -m http.server 8001 --directory tests/behavior/fixtures/keyboard-nav`).
- The personal jar's history holds **≥ 2** visits whose titles start with `keyboard-nav:` (left by the
  `chrome-guest-keyboard-nav` runs; if absent, `openTab` → `form.html` and `links.html` once before row 1).
- The Leg 3 build: `#suggest-status` present in the chrome document.

## Observables Required
- mcp (`getChromeTarget`/`enumerateWindows`/`openTab`/`activateTab`/`evaluate`/`typeText`/`pressKey`/
  `readAxTree` over the loopback client; session-registered MCP tools do **not** qualify).
- browser — the live region's text: **`evaluate(C, "document.getElementById('suggest-status').textContent")`**
  is the primary read; `readAxTree(C)` corroborates (the `status` node's text child); `enumerateWindows()`
  `sheetVisible` corroborates open/closed. The sheet's wcId is never read.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Wiring litmus.** `getChromeTarget()` (record **C**); `enumerateWindows()`. | Numeric chrome `wcId`; the window entry has `sheetVisible` absent or `false`. |
| 2 | (Setup) `openTab` → `http://127.0.0.1:8001/form.html` (record **G**); `activateTab(G)`. `evaluate(C, "(()=>{const a=document.getElementById('address'); a.focus(); a.select(); return JSON.stringify({active:document.activeElement.id, role:a.getAttribute('role'), expanded:a.getAttribute('aria-expanded'), auto:a.getAttribute('aria-autocomplete'), status:document.getElementById('suggest-status').textContent})})()")`. | `active` is `address`; `role` and `expanded` are `null` (DD11 — a plain textbox, no `aria-expanded` at rest); `auto` is `list`; `status` is `""`. |
| 3 | **Results announce their count.** `typeText(C, "keyboard")`; wait ≤ 1 s; `evaluate(C, "(()=>JSON.stringify({status:document.getElementById('suggest-status').textContent, expanded:document.getElementById('address').getAttribute('aria-expanded')}))()")`; `enumerateWindows()`; `readAxTree(C)` → save; grep the dump for the status text; `evaluate(C, "(()=>{const s=document.getElementById('suggest-status'); return JSON.stringify({role:s.getAttribute('role'), live:s.getAttribute('aria-live'), cls:s.className})})()")`. `[a11y]` | `status` matches `^[1-9][0-9]* suggestions?$` (record **N**, expect N ≥ 2); `expanded` is `null` **while the popup is open** (DD11's retired toggle); `sheetVisible` is `true`; the region reads `role=status`, `aria-live=polite`, class `sr-only` (the only direct politeness check — run 2026-08-28-02-48-31); the a11y dump contains a `status` node whose text is the same string (condition: `paintSuggestions()` → `suggestionAnnouncement(model)` with `selectedIndex === -1`). |
| 4 | **ArrowDown announces the highlighted row.** `pressKey(C, "ArrowDown")`; read the status; `readAxTree(C)` focused node. `[a11y]` | Status matches `^keyboard-nav: .+, 127\.0\.0\.1:8001, 1 of N$`; the a11y focused node is still the address textbox — selection moves without moving focus (M08 F4 DD2). |
| 5 | **Position tracks the selection; the top clamps back to the count.** `pressKey(C, "ArrowDown")`; read the status. Then `pressKey(C, "ArrowUp")` twice, reading the status after each. | `…, 2 of N`; then `…, 1 of N`; then `N suggestions` (condition: `moveSelection` clamps to `-1` → the count announcement, not an empty region). |
| 6 | **Escape clears the region without touching the text.** `pressKey(C, "Escape")`; `evaluate(C, "(()=>JSON.stringify({status:document.getElementById('suggest-status').textContent, value:document.getElementById('address').value, active:document.activeElement.id}))()")`; `enumerateWindows()`. | `status` is `""`, `value` is **unchanged** by Escape (whatever the field held — a prior row's recovery may have altered the literal), `active` is `address`; `sheetVisible` is `false` (condition: `closeSuggestions('escape')` → `resetSuggestState()` clears the region; no "closed" announcement). |
| 7 | **A main-initiated close clears the region too.** Re-open: `pressKey(C, "Backspace")` (value `keyboar`; the `input` event re-queries — the FTS prefix still matches `keyboard-nav: …`); wait ≤ 1 s; read the status (the count again, record **N′**); `pressKey(C, "ArrowDown")`; read the status. Then `activateTab(<another web tab from enumerateTabs, e.g. wcId 2>)` — main closes the sheet with reason `tab-switch`; read the status via `evaluate(C, …)`; `enumerateWindows()`. Then `activateTab(G)`. | Before the switch: `N′ suggestions`, then `…, 1 of N′`. After the switch the region is `""` and `sheetVisible` is `false` (condition: main's `tab-switch` close (`tab-set-active`) → chrome `handleOverlayClosed` → `handleSuggestionsClosed('tab-switch')` → `resetSuggestState()` — the sink the cycle-1 design review found bypassing the clear; `resetSuggestionsForActivation` on the return switch keeps it empty). |
| 8 | **No matches.** (Setup) `evaluate(C, "(()=>{const a=document.getElementById('address'); a.focus(); a.value='keyboard'; return document.activeElement.id})()")` (tab activation re-synced the bar); `pressKey(C, "End")`; `typeText(C, "zzqxv")`; wait ≤ 1 s; read the status; `enumerateWindows()`. Then `pressKey(C, "Escape")`. | Status is `No matches` and `sheetVisible` is `true` (the sheet opens on an empty set with the note; the region says the same); after Escape the region is `""` again. |

## Out of Scope
- Announcement wording quality, verbosity settings, or what a particular screen reader speaks — the spec asserts the region's text and its timing, not AT output.
- The sheet's own `aria-selected` rows (unobservable; unit-pinned in `menu-overlay`).
- Apparatus (run 2026-08-28-02-48-31): build `evaluate` args containing single quotes via `json.dumps`; scrub every saved file for the home path, not only a11y dumps; the run's first selection move once found the sheet closed (unreproduced — see the run log).
- Consecutive identical announcements not being re-read (live-region semantics, accepted in DD12).
- The full combobox pattern (moving the listbox into the chrome document) — F49's named out-of-scope fix.
