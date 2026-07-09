# Behavior Test: Cross-view keyboard navigation (chrome ↔ guest)

**Slug**: `chrome-guest-keyboard-nav`
**Status**: active
**Created**: 2026-07-07
**Last Run**: never

## Intent
Verify the multi-`WebContentsView` keyboard/focus **bridge** between the chrome shell and the guest page —
the mission Known Issue surfaced in the Flight-8 HAT. On the native view surface, keyboard focus lives in one
`WebContentsView` at a time, so accelerators and Tab traversal that must cross the chrome↔guest boundary
depend on explicit forwarding + focus-handoff (the DD13 pattern) rather than the DOM focus order a single
renderer would give for free. This needs a behavior test rather than a unit test because it is a
render/focus-layer property of the *running* multi-view app: which view holds OS keyboard focus after a key,
and whether a guest-captured accelerator is forwarded to the chrome — observable only live, and invisible to
the unit suite and to settled-frame captures. Covers all three gaps: (a) **Tab leaves the guest** into the
chrome; (b) **Ctrl+L works while a guest has focus** (revive focus-address); (c) **chrome Tab-order cycles/wraps**
without stranding focus on `<body>`.

## Preconditions
- Goldfinch running via **`npm run dev:automation`** (loopback MCP transport); `GOLDFINCH_MCP_PORT` pinned.
- **Apparatus-wiring litmus passed** (the flight's Leg-1 gate): the MCP client is bound to *this* instance at
  admin tier — `getChromeTarget()` returns this instance's chrome `wcId`; `enumerateTabs()` lists *this*
  instance's tabs (no foreign jar).
- The cross-view keyboard-bridge fix is present in the running build (this spec is the fix's acceptance net).
- A focus fixture with at least one focusable input reachable over HTTP (reuse the mcp-drive fixture, or any
  page with a text input); an internal `goldfinch://` page reachable for the internal-tab exclusion check.

## Observables Required
- mcp (MCP tool results over loopback — `pressKey`/`typeText`/`evaluate`/`readAxTree`/`enumerateTabs`/
  `getChromeTarget`/`captureWindow`; measured via the Goldfinch MCP client at `127.0.0.1:$GOLDFINCH_MCP_PORT`).
  The `chrome-devtools` MCP does **not** qualify (it launches its own browser — false pass against a
  non-Goldfinch process).
- browser (which view/element holds keyboard focus). **Read-path note (apparatus, load-bearing):** `readDom`
  returns only `{url,title,html=outerHTML}` and does **NOT** serialize `document.activeElement` (live pseudo-state),
  so focus is read via **`evaluate(wc, "document.activeElement && (document.activeElement.id || document.activeElement.tagName)")`**
  and/or **`readAxTree(wc)`'s focused node** — NOT via `readDom`. `captureWindow` pixels (focus ring/caret)
  corroborate only. Typeability is proven by `typeText` landing, not by DOM focus alone.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Wiring litmus.** `getChromeTarget()`; `enumerateTabs()`. | `getChromeTarget()` returns a numeric chrome `wcId` (record as **C**); `enumerateTabs()` lists *this* instance's tabs with no foreign jar. **If either fails, halt — preconditions not met (DD2).** |
| 2 | (Setup) `openTab` to the HTTP focus fixture (record guest wcId **G**); `activateTab(G)`; confirm load via `readDom(G)`. Then `click(G, x, y)` on a focusable input in the page so the **guest** holds OS keyboard focus. | (setup — no judgment) |
| 3 | Confirm the guest holds focus: `evaluate(G, "document.activeElement && (document.activeElement.id \|\| document.activeElement.tagName)")`. | `evaluate(G, …)` returns the fixture's input element (its id/tag) — the guest view holds keyboard focus (baseline for the cross-view checks). |
| 4 | **Gap (b) — Ctrl+L from the guest.** `pressKey(G, "l", ["control"])` (dispatches to the guest `before-input-event`). Then `evaluate(C, "document.activeElement && (document.activeElement.id \|\| document.activeElement.tagName)")`, `readAxTree(C)`, `captureWindow()`. **Then prove typeability:** `typeText(C, "example.com")` and read the address field's value via `evaluate(C, …)`. | The accelerator is **forwarded to the chrome AND the chrome view takes OS focus**: `evaluate(C,…)` shows the **address input** is `activeElement` (and/or `readAxTree(C)`'s focused node is the URL field); `captureWindow` shows the focus ring/caret on the address bar; **`typeText(C,…)` lands in the address field** (its value becomes `example.com`) — proving it is *typeable*, not merely DOM-focused. Ctrl+L is no longer dead when a guest has focus. `[a11y]` focus is on the address input. |
| 5 | **Gap (a) — Tab leaves the guest.** Re-focus the guest (`evaluate(G, "document.getElementById('field').focus()")` or `click(G, x, y)`), confirm via `evaluate(G,…)`. Then `pressKey(G, "Tab")`. Observe `evaluate(C,…)` / `readAxTree(C)`, `captureWindow()`. | After Tab, keyboard focus **lands on the chrome address bar**: `evaluate(C,…)` shows `activeElement` is the address input (`id="address"`) and `captureWindow` shows the focus ring in the chrome, not the page — Tab traverses the guest→chrome boundary. **Note (cross-view semantics, observed F5):** the guest's *own* `document.activeElement` may still report the last-focused input — Chromium does **not** dispatch blur when OS focus leaves a sibling `WebContentsView`. That is inert (keystrokes go to chrome, proven by Step 4's typeability); the load-bearing assertion is "**chrome address is focused**", NOT "guest activeElement cleared". |
| 6 | **Gap (c) — chrome Tab-order wraps.** With focus in the chrome (from Step 5), `pressKey(C, "Tab")` repeatedly (allow ~30 presses — an open media/privacy panel adds ~10 buttons) to walk past the last control. Observe the focused element via `evaluate(C,…)` / `readAxTree(C)` after each press. | Tab **cycles** through the chrome's focusable controls and **wraps** back to the first (`address` reappears) — focus is **never stranded** on `<body>`/`null`. `[a11y]` no focus trap, no lost focus. *(Observed F5: address→…→address-chip→address; wrap is Chromium-native within the standalone chrome document, so no bespoke handler is required — confirm it still holds.)* |
| 7 | **Internal-tab Ctrl+L.** Open an internal `goldfinch://settings` tab (record **I**) — **NOT via `openTab`, which refuses non-http(s)**; open it via the chrome UI route (kebab → Settings) or a chrome-driven action, then `enumerateTabs` (admin) to record **I**. Focus into it. `pressKey(I, "l", ["control"])`; observe **chrome only** via `evaluate(C,…)` / `readAxTree(C)` + `captureWindow` (do **not** `evaluate(I,…)` — internal sessions refuse observe reads, DD7). | Ctrl+L focuses the address bar on the internal tab too (the intended default — Ctrl+L is a chrome-level accelerator, not a guest feature): `evaluate(C,…)` shows the address input focused; no crash, no misroute; the internal trust boundary is intact. *(Ctrl+L is served by the new minimal internal-guest `before-input-event` — Leg 2 Context DD.)* |

**Row conventions:** Step 2 is pure setup (no judgment). Steps 4–6 each verify one of the three named gaps.
`[a11y]` marks the accessibility-relevant focus checks.

## Out of Scope
- Chrome-only tab-strip keyboard operability (`tab-keyboard-operability.md` — the tab-strip's own arrow/Enter/Delete
  semantics, chrome-renderer-driven, no cross-view boundary).
- Every guest accelerator already captured pre-fix (zoom/print/find/downloads/devtools — those have their own
  convenience specs); this spec covers only the **cross-view bridge** additions (Ctrl+L, Tab) + chrome wrap.
- macOS parity for the bridge (carried to the Flight-6 macOS gate as HAT steps).

## Variants (optional)
- Re-run Step 4 with `Ctrl+L` issued while a *background* guest is active vs foreground, if the fix distinguishes.
