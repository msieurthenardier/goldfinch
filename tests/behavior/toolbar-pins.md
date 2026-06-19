# Behavior Test: Pinnable toolbar items (Media + Shields + DevTools)

**Slug**: `toolbar-pins`
**Status**: draft
**Created**: 2026-06-08

## Intent
Verify the **pin/unpin** system for toolbar items: a pinned item shows in the toolbar as an **icon + count
badge**; unpinning (from the settings Appearance section) **removes the toolbar icon** but leaves its
**keyboard shortcut** working; the pin state **persists** (`settings.json` `toolbarPins`) and the toolbar
reflects changes **live** (two-way with settings); and the site-info popup's **"Site settings →"** opens the
**settings page** (Privacy & Shields) rather than the slide-out panel. **DevTools** (M04 Flight 3) is the
**third pinnable item** alongside Media and Shields — but, unlike them, it defaults **UNPINNED**
(`toolbarPins.devtools === false`, DD4): a power-user tool, opt-in via right-click / Settings → Appearance,
with `F12`/`Ctrl+Shift+I` shortcuts that work **regardless of pin state**. The DevTools toggle is also a
**toggle button** (`aria-pressed` reflecting the external detached DevTools window's open/closed state, NOT
`aria-expanded` — it has no in-page panel), and is **inert-not-hidden** on internal `goldfinch://` tabs
(DD5). This needs a behavior test, not a unit test: the assertions are real-environment, cross-process UI —
the pin toggle lives in a `<webview>` guest on a privileged scheme, the toolbar lives in the chrome renderer
and reflects the active pin state via an IPC broadcast, persistence is a file the main process writes, and
the DevTools button's pressed state is driven by a `devtools-state-changed` event the main process forwards
(Leg-1 spike POSITIVE — the event fires reliably, so the button reflects open/closed **live**, including a
DevTools-window-initiated close; the on-activation `isDevtoolsOpen` reconcile is the backstop, not the
primary path).

## Preconditions
- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`. At
  launch, the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout —
  capture the `adminKey`. The MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`). Export it once at launch and reuse it in all SDK calls.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on
  `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  The Bearer rides every request the transport sends. This spec requires the **admin** key — a jar
  key is refused `getChromeTarget` (`admin-only`) and cannot see the internal `goldfinch://settings`
  guest (jar keys cannot reach internal sessions). Only the admin identity can enumerate + drive the
  internal guest (admin engine built with `{ allowInternal: true }`).
- **Two distinct targets (dual-target spec — keep them straight):**
  - **Chrome target** (`getChromeTarget()` → chrome `wcId`): the chrome toolbar
    (`#toggle-media`/`#toggle-privacy`/`#toggle-devtools` presence/visibility/badge), the panels, and the
    `Ctrl+M` / `Ctrl+Shift+P` / `F12` / `Ctrl+Shift+I` shortcuts. Read via
    `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()`; drive via
    `click(wcId, x, y)`/`pressKey(wcId, name, modifiers)`.
  - **Internal guest target** (from `enumerateTabs` → the entry with `url: 'goldfinch://settings'` →
    its `wcId` as `guestWcId`): the settings **Appearance** pin toggles. Read via
    `readDom(guestWcId)`/`readAxTree(guestWcId)`; drive via `click(guestWcId, x, y)`/
    `pressKey(guestWcId, name)`. Do NOT pass the chrome `wcId` to guest read calls or vice versa.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over
  the MCP surface (the toolbar icons, the kebab, and the Appearance pin toggles are all located by
  reading a `captureWindow()` frame).
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab`/keyboard sequence from
  the bare document does not relocate focus. **Before any keyboard-only sequence (Step 3 toggle by
  keyboard; Step 6 shortcut), establish a focus anchor by sending a `click` into the target first**
  — `click(guestWcId, x, y)` on the Appearance area for the guest toggle, `click(wcId, x, y)` in the
  chrome for the `Ctrl+M`/`Ctrl+Shift+P` shortcut.
- The build includes the `toolbarPins` store key (now `{ media, shields, devtools }`), the icon toolbar +
  pin-apply, the Appearance pin toggles (Media + Shields + **DevTools**), the "Site settings →" rewire, and
  the M04 Flight-3 DevTools affordance (`#toggle-devtools` button, `F12`/`Ctrl+Shift+I`, the
  `toggle-devtools`/`is-devtools-open` IPC).
- **DevTools default UNPINNED (load-bearing for the initial assertions, DD4).** A fresh / upgraded
  `settings.json` normalizes `toolbarPins.devtools` to `false` — so on first launch `#toggle-devtools`
  carries `.hidden` in the chrome toolbar and the Settings → Appearance DevTools pin reads
  `aria-pressed="false"`. The DevTools steps below open from that unpinned baseline (the inverse of
  Media/Shields, which default pinned). If a prior run left `devtools: true` in `settings.json`, reset it
  (delete the file or set `devtools: false`) before running so the default-unpinned assertions hold.
- `userData/settings.json` is readable on the filesystem; a reachable web page (e.g. `https://example.com/`).
- **Active-precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an exact count) the tools this spec drives:
  `getChromeTarget`, and `getChromeTarget()` returns a numeric chrome `wcId`. After opening Settings,
  confirm the `goldfinch://settings` guest is enumerable via `enumerateTabs` (the admin engine's
  `allowInternal` makes it visible).
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (false pass). The apparatus is the SDK admin MCP client
  over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not**
  the CDP attach path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP
  surface is used. (Step 9's `npm run a11y` is the one exception — the F8-deferred axe harness, run
  separately as a shell command; see Step 9.)

## Observables Required
- mcp (admin MCP tools — measured via the admin MCP client connected with the admin Bearer header):
  the chrome toolbar (`#toggle-media`/`#toggle-privacy`/`#toggle-devtools` presence/`hidden` + icon +
  count badge; the DevTools button's `aria-pressed` open/closed state) and panel
  `aria-expanded`/visibility via `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()` on the **chrome**
  `wcId`; the settings guest's Appearance pin toggles (`aria-pressed`) via
  `readDom(guestWcId)`/`readAxTree(guestWcId)`/`captureWindow()` on the **guest** `wcId`; the active
  tab's URL + the internal-guest entry via `enumerateTabs`; the DevTools open/closed state via the
  `#toggle-devtools` `aria-pressed` attribute, driven live by the `devtools-state-changed` event
  (Leg-1 spike POSITIVE))
- filesystem (`userData/settings.json` `toolbarPins` — measured via Read/Bash)
- shell (precondition probes: `tools/list` count + `getChromeTarget`; and Step 9's `npm run a11y`
  harness — measured via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then `getChromeTarget()` and record the chrome `wcId`. Read the chrome toolbar via `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()`: `#toggle-media` + `#toggle-privacy` + `#toggle-devtools`. | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`; `getChromeTarget()` returns a **numeric** chrome `wcId`. The Media + Shields controls render as **icons with a count badge** (not text "Media"/"Shield"); both are **visible** (default pinned). `#toggle-devtools` is present in the DOM but **`.hidden`** — DevTools defaults **UNPINNED** (`toolbarPins.devtools === false`, DD4). If the probe fails, halt. |
| 2 | Open Settings (take a `captureWindow()` to locate the kebab (⋮), `click(wcId, x, y)` to open it, then `click(wcId, x, y)` on the Settings item — or the identical trusted path `openTab('goldfinch://settings', null, {trusted:true})`); wait for load; call `enumerateTabs` and record the `goldfinch://settings` entry's `wcId` as `guestWcId`. Read the **Appearance** section via `readDom(guestWcId)`/`readAxTree(guestWcId)`/`captureWindow()`. | The Appearance section shows a **pin-icon toggle button** for **Media** and **Shields** (pushpin glyph, `aria-pressed`), both **pinned** (`aria-pressed="true"`, filled). `enumerateTabs` includes the `goldfinch://settings` entry. `[a11y]` |
| 3 | In the settings guest, establish a focus anchor with `click(guestWcId, x, y)` on the Appearance area (located via `captureWindow()`), then move keyboard focus to the **Media** pin-icon toggle (`pressKey(guestWcId, 'Tab')`) and activate it by keyboard (`pressKey(guestWcId, 'Enter')`/`'Space'`) to UNPIN it. Re-read via `readAxTree(guestWcId)`. | The Media pin toggles to unpinned (`aria-pressed="false"`, outline glyph); keyboard-operable. `[a11y]` |
| 4 | Read `userData/settings.json` (filesystem). | `toolbarPins.media === false` — the change **persisted**. |
| 5 | Read the chrome toolbar `#toggle-media` via `readDom(wcId)`/`captureWindow()` on the chrome `wcId`. | The Media toolbar icon is now **removed/hidden** — the toolbar reflects the unpin **live** (two-way). `#toggle-privacy` (Shields) remains visible. |
| 6 | With Media unpinned, fire **Ctrl+M** at the **chrome** target: establish a focus anchor with `click(wcId, x, y)` in the chrome, then `pressKey(wcId, 'M', ['control'])` (the leg-1 modifier-chord capability) — the shortcut is a chrome `document` keydown, independent of the toolbar button. | The media panel still **opens** (confirmed via `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()`) — unpinning removed the toolbar icon only; the keyboard shortcut remains active. |
| 7 | Re-pin Media from the settings Appearance toggle (back ON): `click(guestWcId, x, y)` (located via `captureWindow()`) or keyboard-activate the Media pin toggle. Re-read `settings.json` (filesystem) and the chrome toolbar (`readDom(wcId)`). | `settings.json` `toolbarPins.media === true`; the Media icon **returns** to the toolbar. |
| 8 | Open a normal web tab (`https://example.com/`); take a `captureWindow()` to locate the web chip and `click(wcId, x, y)` on it; in the site-info popup, locate **"Site settings →"** via a fresh `captureWindow()` and `click(wcId, x, y)` on it. Read the chrome via `readDom(wcId)`/`readAxTree(wcId)`. | A **`goldfinch://settings/#privacy`** tab opens or an existing settings tab is activated + navigated to it (active webview `src`/address contains `#privacy`); the **slide-out panel does NOT open**. The popup closes. |
| 9 | Run `npm run a11y` (chrome) and `npm run a11y -- --target=goldfinch://settings`; read both results. | **No NEW** violations vs the pinned `ACCEPTED` baseline — the icon toolbar (chrome) and the Appearance pin toggles (guest) introduce no new WCAG A/AA violations. (The chrome run also exercises the new `devtools-button` audit state — it pins DevTools, un-hides `#toggle-devtools`, and audits the button's static a11y. See the note below.) `[a11y]` |
| 10 | **(DevTools pin — default-unpinned baseline → pin via Settings → Appearance.)** In the settings guest, read the **Appearance** section (`readDom(guestWcId)`/`readAxTree(guestWcId)`/`captureWindow()`) and confirm a **DevTools** pin-icon toggle is present. Establish a focus anchor with `click(guestWcId, x, y)` on the Appearance area, then activate the **DevTools** pin toggle (`click(guestWcId, x, y)` on its glyph, or keyboard: anchor → `Tab` to it → `Enter`/`Space`) to **PIN** it. Re-read `readAxTree(guestWcId)`. | The Appearance section shows a **DevTools** pin-icon toggle (pushpin glyph, `aria-pressed`), initially **unpinned** (`aria-pressed="false"`, outline glyph) — unlike Media/Shields. After activation it toggles to **pinned** (`aria-pressed="true"`, filled); keyboard-operable. `[a11y]` |
| 11 | Read `userData/settings.json` (filesystem). Then read the chrome toolbar `#toggle-devtools` via `readDom(wcId)`/`captureWindow()` on the chrome `wcId`. | `toolbarPins.devtools === true` — the pin **persisted**. The `#toggle-devtools` icon is now **visible** (no longer `.hidden`) — the toolbar reflects the pin **live** (two-way). It is a **toggle button** with `aria-pressed` (NOT `aria-expanded` — DevTools has no in-page panel), currently `aria-pressed="false"` (DevTools window closed). `[a11y]` |
| 12 | **(Unpinned shortcut still opens DevTools.)** First UNPIN DevTools again from the Appearance toggle (`click(guestWcId, x, y)` / keyboard-activate) so `toolbarPins.devtools === false` and `#toggle-devtools` is `.hidden`. Then, on a **normal web tab** (open/activate `https://example.com/`), establish a chrome focus anchor with `click(wcId, x, y)` and fire **`F12`** (`pressKey(wcId, 'F12')` — no modifier; the leg-1 modifier-less branch) — or the alternate `Ctrl+Shift+I` (`pressKey(wcId, 'I', ['control','shift'])`). Confirm DevTools opened via the `is-devtools-open` IPC / `isDevToolsOpened()` for that tab's `wcId` (and, if the button is re-pinned to read it, `#toggle-devtools` `aria-pressed="true"`). | DevTools **opens** for the active web tab even though the toolbar button is **unpinned** (`toolbarPins.devtools === false`) — the shortcut is independent of pin state (DD2/DD4). `isDevToolsOpened()` for that `wcId` is **true**. (Close DevTools again — `F12` toggles — before continuing; the button, if visible, returns to `aria-pressed="false"` live via `devtools-state-changed`.) |
| 13 | **(Inert, NOT hidden, on internal tabs — DD5.)** Re-pin DevTools (Appearance toggle → `toolbarPins.devtools === true`, `#toggle-devtools` visible). Activate the `goldfinch://settings` internal tab. Read the chrome toolbar (`readDom(wcId)`/`captureWindow()`). Then `click(wcId, x, y)` the `#toggle-devtools` button and fire `F12` (`pressKey(wcId, 'F12')`) with the internal tab active. Re-read the toolbar + confirm via `is-devtools-open`/`isDevToolsOpened()` that no DevTools opened for the internal guest. | `#toggle-devtools` remains **visible** on the internal tab (visibility is pin-driven only — it is **inert, not hidden**, DD5); its click is a **no-op** (`aria-pressed` stays `false`, no DevTools window) and `F12` opens **nothing** on `goldfinch://` (web-content-only guard). The button does not throw or toggle. `[a11y]` |
| 14 | **(Right-click → Unpin DevTools — in-DOM custom menu, MCP-drivable.)** Right-click `#toggle-devtools` in the chrome toolbar (`click(wcId, x, y, { button: 'right' })`); read the chrome via `readDom(wcId)`/`captureWindow()`; `click(wcId, x, y)` the **"Unpin DevTools"** menu item; re-read the toolbar + `userData/settings.json`. | The **custom `#page-context-menu`** opens (anchored just below the button) with a single **"Unpin DevTools"** `cm-item role="menuitem"` — the in-DOM on-brand menu (the Leg-5 migration off the native `Menu.popup`), **not** a native Electron menu. Activating it sets `toolbarPins.devtools === false` (filesystem), hides the button live, broadcasts the change, and focuses the address bar — equivalent to the Appearance-toggle unpin. *(Full toolbar-Unpin coverage — Media/Shields/DevTools + persistence + focus — lives in `page-context-menu.md`; this row is the DevTools cross-check.)* |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Step 6 is the "unpinned keeps its
shortcut" assertion (Media); step 8 is the "Site settings → opens the settings page, not the panel"
assertion. Steps 10–13 are the **DevTools** coverage (pin via Settings → Appearance with live button
un-hide + persistence; unpinned `F12`/`Ctrl+Shift+I` still opening DevTools; inert-not-hidden on internal);
step 14 is the DevTools right-click unpin (now the in-DOM custom `#page-context-menu`, MCP-drivable since
the Leg-5 migration — see `page-context-menu.md` for the full toolbar-Unpin coverage). **Step 9 is NOT on
the MCP surface** — `npm run a11y` is the F8-deferred axe-injection harness (`scripts/a11y-audit.mjs`),
invoked as a shell command and run separately against the hardened DevTools port; it is left verbatim (the
MCP surface has no axe-rule evaluation), not migrated to MCP tools. **The harness's new `devtools-button`
state (Leg 3) and this spec's own DevTools steps are complementary** — the harness audits the
DevTools-pinned chrome under axe; this spec exercises the pin/persist/shortcut/inert *behaviors* over the
MCP surface. Neither supersedes the other.

## Out of Scope
- **The full right-click → "Unpin" context-menu coverage** (for Media, Shields, **and** DevTools) — owned by
  **`page-context-menu.md`**. Since the Leg-5 migration, the toolbar Unpin renders the **in-DOM custom
  `#page-context-menu`** (a single "Unpin {item}" `cm-item role="menuitem"`), so it **is** drivable over the
  MCP surface (`getChromeTarget` → `readDom` → coordinate `click` on the menu item) — it is **no longer** a
  native Electron menu and **no longer** HAT-only. This spec keeps the pin/unpin coverage via the settings
  Appearance pin toggle (both paths write `toolbarPins` + broadcast, so the store/toolbar effect is
  equivalent) and cross-checks the DevTools right-click in step 14; the exhaustive right-click-Unpin
  behavior is in `page-context-menu.md` to avoid duplication.
- **The live detached DevTools window + the CDP single-client conflict** (DevTools open ⇒ `readAxTree`
  refused) — **macOS-authoritative**, covered by `devtools-cdp-conflict` (re-staged M04 Flight 3). This spec
  asserts DevTools open/closed state via `isDevToolsOpened()`/the button's `aria-pressed`, not the
  detached-window materialization or the CDP conflict (which were inconclusive under WSLg).
- **Per-site Shields overrides** (more-strict-only) — a future flight (mission Known Issues).
- The Shields/home wiring itself — covered by `settings-controls` (run as a regression).
- The `goldfinch://` boundary — covered by `tab-scheme-guard` (regression).

## Variants (optional)
- Repeat the pin/unpin (steps 3–7) for **Shields** (`toolbarPins.shields`; Ctrl+Shift+P for step 6).
- DevTools restart-persistence: after step 11 (DevTools pinned), restart the app (`npm run dev:automation`
  fresh) and confirm `#toggle-devtools` is still visible / `toolbarPins.devtools === true` survived — the
  pin persists across restart (the inverse default of Media/Shields, which persist *pinned*).
