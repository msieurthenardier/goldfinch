# Behavior Test: Menu dismissal — both menus close on any outside interaction

**Slug**: `menu-dismissal`
**Status**: draft
**Created**: 2026-06-07
**Last Run**: never

## Intent

Verify that both of Goldfinch's dropdown menus — the kebab (`⋮`) overflow menu and the container (`▾`)
menu — **dismiss reliably on any outside interaction**: a click landing in the page `<webview>` (a
separate web-contents the chrome's `document` cannot observe), a click on the *other* menu's trigger,
and an in-chrome click elsewhere. It also confirms Escape + focus-restore still work and that the two
menus are never open simultaneously. This needs a behavior test because the properties under test are
*real focus/input crossing the chrome↔webview web-contents boundary* and live menu open/close state —
neither a jsdom check nor synthetic events model the `window`-blur-on-webview-focus path or trusted
cross-trigger clicks. (Flight 3; flight-local dismissal correctness + the shared-controller behavior;
SC8-adjacent for the container menu's APG uplift.)

## Preconditions

- Goldfinch running via `npm run dev:debug` (`:9222`). The apparatus **attaches** to this instance via
  the committed `scripts/cdp-driver.mjs` (trusted input) or a connected Playwright MCP. **The
  `chrome-devtools` MCP does NOT qualify** (launches its own browser → false pass).
- Drives the **renderer** (the Goldfinch chrome), not a `<webview>` guest — select the top-level window
  whose URL is `index.html`.
- **At least one tab with a loaded `<webview>`** exists (the default homepage tab satisfies this) — the
  page-click / webview-focus dismissal path needs a real guest to focus.
- Input delivered as **trusted events** (CDP `Input.dispatch*`), not synthetic `dispatchEvent`.
- **Active precondition probe** (Step 1): `:9222` answers, a renderer target and a webview guest are
  both present.

## Observables Required

- browser (DOM + a11y tree — via a CDP client attached to `:9222`): each trigger's `aria-expanded`
  (`#kebab`, `#new-tab-menu`); each popup's open state (`.hidden` / computed `display`) — `#kebab-menu`,
  `#container-menu`; `document.activeElement`; the container popup's `role="menu"` / item
  `role="menuitem"` (post-uplift); the active tab's `<webview>` element id (`#webview-…`) for the
  focus-shift path.
- shell (precondition probe: `:9222` reachability — Bash/curl or `cdp-driver eval '1+1'`).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe `:9222`; identify the renderer target AND the active tab's `<webview>` guest (note its element id `#webview-…`). | `:9222` responds; renderer + at least one webview present. If no webview, halt — preconditions not met. |
| 2 | **Page/webview-click dismissal (kebab):** open the kebab (trusted click on `#kebab`); confirm open. Then shift focus to the page by focusing the active `<webview>` (`eval document.getElementById('webview-…').focus()` — the witnessed stand-in for a real page click, firing the same `window` blur). Read the kebab's state. | The kebab menu **closes** (`#kebab` `aria-expanded="false"`, `#kebab-menu` hidden) when focus moves to the webview. [the real pointer page-click is verified manually] |
| 3 | **Page/webview-click dismissal (container):** open the container menu (trusted click on `#new-tab-menu`); confirm open. Focus the active `<webview>`. Read the container's state. | The container menu **closes** (`#new-tab-menu` `aria-expanded="false"`, `#container-menu` hidden). |
| 4 | **Cross-trigger dismissal:** open the container menu; then trusted-click `#kebab`. Read both. Then trusted-click `#new-tab-menu`. Read both. | Opening the kebab closes the container (container expanded=false, kebab open); opening the container closes the kebab (kebab expanded=false, container open). Never both open. |
| 5 | **In-chrome outside click:** open the kebab; trusted-click a neutral chrome area (e.g. `#address` center). Read kebab state. Repeat for the container menu. | Each menu closes on the in-chrome outside click (`aria-expanded="false"`, hidden). |
| 6 | **Escape + focus-restore intact (both):** open the kebab, press `Escape` — read state + `activeElement`. Open the container (`▾`), press `Escape` — read state + `activeElement`. | Each menu closes on Escape and **restores focus to its own trigger** (`#kebab` / `#new-tab-menu` respectively); focus not stranded on `<body>`. [a11y] |
| 7 | **Container menu is now full APG:** open the container menu; read its `role`, its items' `role`, and the roving tabindex; drive `ArrowDown`/`ArrowUp`/`Home`/`End` and read `document.activeElement` after each. | `#container-menu` has `role="menu"`; items have `role="menuitem"` with roving tabindex (one `tabindex="0"`); arrow keys move focus between items (wrap), Home/End jump to first/last; focus stays within the menu. [a11y] |
| 8 | **Container behavior preserved:** with the container menu open, activate a named container item (trusted Enter/click). Read tab count + the new tab's jar dot. | A new tab opens in that container (its strip button shows the matching `.tab-jar` dot); tab count +1 — the APG uplift did not break container selection. |
| 9 | **Container trigger opens by keyboard:** focus the `▾` trigger (`eval document.getElementById('new-tab-menu').focus()`); press trusted `Space`; read the menu open state + `document.activeElement`. Close (Escape). Re-focus `▾`; press trusted `ArrowUp`; read open state + activeElement. | `Space` opens the container menu **exactly once** (`#new-tab-menu` `aria-expanded="true"`, menu visible, NOT toggled-closed) with focus on the **first** item; `ArrowUp` opens it with focus on the **last** item. (Witnesses the `preventDefault`-suppresses-synthetic-click contract — the subtlest part of the container uplift.) [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks. The
webview-`focus()` stand-in (Steps 2–3) exercises the real `window`-blur dismissal handler; the **real
pointer click on page content** and **app-switch** dismissal are verified manually (not cleanly
CDP-drivable across web-contents / OS focus).

## Out of Scope

- **Real pointer page-click + app-switch dismissal** — manual (cross-web-contents / OS focus, not
  CDP-drivable); the webview-`focus()` path is the witnessed proxy.
- The kebab menu's own APG nav + Settings/Exit semantics — `kebab-menu.md` (regression).
- The container menu opening tabs / pill structure beyond Step 8 — `unified-tab-controls.md`.
- Tablist roving nav — `tab-keyboard-operability.md`.
- The `goldfinch://` scheme — Flight 4 / `tab-scheme-guard.md`.

## Variants (optional)

- If DD1 diverts to the preload-forward fallback, Steps 2–3 instead trigger a real guest `pointerdown`
  (via the webview-preload host message) rather than `webview.focus()`.
