# Behavior Test: A pointer close shows the tab under the cursor

**Slug**: `pointer-close-shows-tab`
**Status**: draft
**Created**: 2026-11-08
**Last Run**: never

## Intent
Verify sortie 08: after every ✕ click or middle-click close on a tab, the tab that is now under the
cursor becomes the active tab — selected in the strip, its URL in the address bar, and its page
actually rendered in the guest slot — while keyboard closes keep the existing fallback and a close
that leaves nothing under the cursor changes nothing beyond today's behavior. This needs the real
app: the target is decided by live post-removal layout (the DD5 width freeze, the issue #97
right-end reflow), and "the page is shown" is a native `WebContentsView` surface a unit test cannot
see (DOM correct ≠ render correct). Sub-frame "no flash" and "hover never switches" are NOT
observable here (no move-only primitive; flashes are sub-frame) — they are pinned by unit tests and
by eye at HAT (see Out of Scope).

## Preconditions
- **Apparatus — admin MCP surface, Goldfinch dev mode (operator standing preference).** Launch with
  `npm run dev:automation` and `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`;
  capture `adminKey` from the printed `AUTOMATION_DEV_MINT {...}` line (per launch); attach with the
  env-key script client (`scripts/lib/mcp-client.mjs` `connectAutomation()`). Never the registered
  `goldfinch-dev` MCP server; the `chrome-devtools` MCP does not qualify (it drives its own browser).
  Port: pin-if-free / free-fallback exactly as `tab-reorder.md` Preconditions describe.
- **Drive the chrome renderer.** `getChromeTarget()` returns the chrome `wcId`; every `click`/
  `pressKey`/`evaluate` below targets it. A jar key cannot (admin required).
- **Fixture.** A local HTTP fixture serving at least eight pages at distinct URLs, each with a
  distinct `<title>` (`P1`…`P8`) and a distinct full-page background color, so the rendered guest
  in a `captureWindow()` identifies which tab's page is shown.
- **The app boots with one default tab** — leave it in place, open the fixture tabs after it, and
  work from the observed DOM order (`[...document.querySelectorAll('#tabs .tab')].map(t =>
  t.dataset.id)`), never an assumed count.
- **Coordinates come from rect reads** (`getBoundingClientRect()` of `.tab` / `.tab-close` via chrome
  `evaluate`); `captureWindow()` is the fallback locator and the rendered-truth check.
- **Apparatus facts (carried from `responsive-tab-strip.md`)**: `click(wcId, x, y)` is a trusted
  mouseMove→mouseDown→mouseUp at (x, y); `{ button: 'middle' }` delivers a trusted middle-click.
  `#window-controls` sits inside `#tabstrip`, so a window-control click does NOT end the width
  freeze; to end it, click at a coordinate in the web content area.
- **Active-tab observables** (read after every close): (a) `enumerateTabs()`/`readAxTree(chrome)`
  — exactly one `selected: true`; (b) chrome `evaluate` of
  `({ active: document.querySelector('#tabs .tab.active')?.dataset.id, address: document.getElementById('address').value })`;
  (c) `captureWindow()` — the guest slot shows that tab's fixture color.

## Observables Required
- mcp (admin MCP client on the chrome `wcId`): `click`, `pressKey`, `evaluate`, `readAxTree`,
  `enumerateTabs`, `enumerateWindows`, `getChromeTarget`, `captureWindow`, `captureScreenshot`
- http (local fixture server — measured via shell)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Connect the admin client; `tools/list`; `getChromeTarget()`; `enumerateWindows()`. | `tools/list` includes `getChromeTarget`, `evaluate`, `click`, `pressKey`, `readAxTree`, `enumerateTabs`, `captureWindow`. `getChromeTarget()` returns a numeric chrome `wcId`. One window, `booted: true`. Halt if not. |
| 2 | Open fixture tabs `P1`…`P8` (in order, after the default tab). Activate `P2` by clicking its tab body. Record the DOM order and every `.tab` / `.tab-close` rect. | (setup) Titles pairwise distinct; `P2` is the active tab. |
| 3 | **Background ✕ close, mid-strip.** Click the ✕ of `P4` (a background tab, not last). Do not move elsewhere. Read the active-tab observables and the `.tab` rects. | `P4` is gone (count −1). The active tab is the tab whose post-removal rect contains the click coordinate — with the equal fixture widths this is `P5`, which slid left into `P4`'s slot under the frozen widths (record the containing rect; if the point fell in the 4px gap, no tab contains it and `P2` stays active — re-run with a coordinate at the ✕'s center). `selected`, `.tab.active`, and `#address` all name `P5`; `captureWindow()` shows `P5`'s fixture color in the guest slot. Remaining tab widths are unchanged from Step 2 (freeze intact). |
| 4 | **Run continues.** Click the same coordinate again (now `P5`'s ✕, the active tab). Read the observables. | `P5` is gone. The active tab is `P6` (now under the coordinate) — NOT the rightmost tab. `selected`/`.tab.active`/`#address`/rendered color all name `P6`. Widths still frozen. |
| 5 | **Middle-click close switches.** Click `P1`'s body to make `P1` active (still inside the strip — the freeze holds). Then middle-click the body of `P7` (a background, non-last tab). Read the observables and the post-removal rect containing the coordinate. | `P7` is gone. The active tab is the tab whose rect now contains the middle-click coordinate (`P8`, the right neighbour that slid in), NOT `P1`. All four observables agree on it. |
| 5b | **Already-active target — no redundant switch.** Read the active tab (`P8`). Click the ✕ of the tab immediately LEFT of `P8` (`P6`, background, non-last). Read the observables. | `P6` is gone; `P8` slides under the coordinate and is already active, so it stays active (all four observables name `P8`; the rendered guest is unchanged). The no-redundant-`tabSetActive` property itself is unit-pinned (not observable here). |
| 6 | End the freeze: click at a coordinate in the web content area (outside `#tabstrip`). Read rects. | (setup) Tabs re-expand (freeze released). The active tab is unchanged by this click. |
| 7 | **Right-end close (issue #97, no freeze).** If only one or two tabs remain, open two more fixture tabs first. Read rects; click the ✕ of the rightmost tab. Read rects, `document.elementFromPoint(x, y)` at the click coordinate (`evaluate`), and the observables. | The rightmost tab is gone; widths reflow (no freeze — #97 carve-out intact). If the coordinate now falls inside a `.tab`'s rect, that tab is active (all four observables agree). If it falls on the `+` pill or the trailing gap (no `.tab`), the active tab is what today's rule gives: unchanged if the closed tab was background; the DOM-order-last tab if the closed tab was active. Record which branch occurred. |
| 8 | **Keyboard close is unchanged (control).** Activate a mid-strip tab by clicking its body, then `pressKey(chrome, 'w', ['control'])`. Read the observables. | The tab closes and the newly active tab is the DOM-order-last tab (today's fallback). **If squawk 0177 has landed**, it is the right neighbour instead — check `squawks/0177-*.md` status before judging. Mouse position plays no part. |
| 9 | **Single-tab guard.** Close tabs by ✕ until two remain, then close the background one by ✕, then the last by ✕. Read `enumerateTabs()`. | With two tabs, the survivor is active. Closing the last tab leaves the window with one fresh tab (today's `openNewTab` path), no error. |
| 10 | **Apparatus sweep.** With the final state: `captureScreenshot(activeGuestWcId)`, `readAxTree(chrome)`, `enumerateWindows()`. | Screenshot is the active tab's page; ax tree shows exactly one selected tab; census is consistent with `enumerateTabs()`. |

## Out of Scope
- **No intermediate flash** (DD4: one tab switch per close, never the rightmost tab first) — a
  sub-frame visual; pinned by a unit test (`tabSetActive` call sequence) and watched by eye at HAT.
- **Hover never switches tabs** (DD1) — no move-only MCP primitive (`click` always clicks); pinned by
  a grep-AC (no hover-family listener on tabs/strip) and by eye at HAT.
- Width-freeze geometry itself — `responsive-tab-strip.md` Steps 6–7.
- The keyboard-close neighbour fix — squawk 0177 (re-authors `tab-reorder.md` Step 6).
- Tab drag / tear-off — `cross-window-drag.md` (operator-performed).
