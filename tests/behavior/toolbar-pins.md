# Behavior Test: Pinnable toolbar items (Media + Shields)

**Slug**: `toolbar-pins`
**Status**: draft
**Created**: 2026-06-08

## Intent
Verify the **pin/unpin** system for toolbar items: a pinned item shows in the toolbar as an **icon + count
badge**; unpinning (from the settings Appearance section) **removes the toolbar icon** but leaves its
**keyboard shortcut** working; the pin state **persists** (`settings.json` `toolbarPins`) and the toolbar
reflects changes **live** (two-way with settings); and the site-info popup's **"Site settings →"** opens the
**settings page** (Privacy & Shields) rather than the slide-out panel. This needs a behavior test, not a unit
test: the assertions are real-environment, cross-process UI — the pin toggle lives in a `<webview>` guest on
a privileged scheme, the toolbar lives in the chrome renderer and reflects the active pin state via an IPC
broadcast, and persistence is a file the main process writes.

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
    (`#toggle-media`/`#toggle-privacy` presence/visibility/badge), the panels, and the `Ctrl+M` /
    `Ctrl+Shift+P` shortcut. Read via `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()`; drive via
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
- The build includes the `toolbarPins` store key, the icon toolbar + pin-apply, the Appearance pin toggles,
  and the "Site settings →" rewire.
- `userData/settings.json` is readable on the filesystem; a reachable web page (e.g. `https://example.com/`).
- **Active-precondition probe** (Step 1): confirm `tools/list` shows 17 tools including
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
  the chrome toolbar (`#toggle-media`/`#toggle-privacy` presence/`hidden` + icon + count badge) and
  panel `aria-expanded`/visibility via `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()` on the
  **chrome** `wcId`; the settings guest's Appearance pin toggles (`aria-pressed`) via
  `readDom(guestWcId)`/`readAxTree(guestWcId)`/`captureWindow()` on the **guest** `wcId`; the active
  tab's URL + the internal-guest entry via `enumerateTabs`)
- filesystem (`userData/settings.json` `toolbarPins` — measured via Read/Bash)
- shell (precondition probes: `tools/list` count + `getChromeTarget`; and Step 9's `npm run a11y`
  harness — measured via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then `getChromeTarget()` and record the chrome `wcId`. Read the chrome toolbar via `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()`: `#toggle-media` + `#toggle-privacy`. | `tools/list` returns **17 tools** including `getChromeTarget`; `getChromeTarget()` returns a **numeric** chrome `wcId`. Both toolbar controls render as **icons with a count badge** (not text "Media"/"Shield"); both are visible (default pinned). If the probe fails, halt. |
| 2 | Open Settings (take a `captureWindow()` to locate the kebab (⋮), `click(wcId, x, y)` to open it, then `click(wcId, x, y)` on the Settings item — or the identical trusted path `openTab('goldfinch://settings', null, {trusted:true})`); wait for load; call `enumerateTabs` and record the `goldfinch://settings` entry's `wcId` as `guestWcId`. Read the **Appearance** section via `readDom(guestWcId)`/`readAxTree(guestWcId)`/`captureWindow()`. | The Appearance section shows a **pin-icon toggle button** for **Media** and **Shields** (pushpin glyph, `aria-pressed`), both **pinned** (`aria-pressed="true"`, filled). `enumerateTabs` includes the `goldfinch://settings` entry. `[a11y]` |
| 3 | In the settings guest, establish a focus anchor with `click(guestWcId, x, y)` on the Appearance area (located via `captureWindow()`), then move keyboard focus to the **Media** pin-icon toggle (`pressKey(guestWcId, 'Tab')`) and activate it by keyboard (`pressKey(guestWcId, 'Enter')`/`'Space'`) to UNPIN it. Re-read via `readAxTree(guestWcId)`. | The Media pin toggles to unpinned (`aria-pressed="false"`, outline glyph); keyboard-operable. `[a11y]` |
| 4 | Read `userData/settings.json` (filesystem). | `toolbarPins.media === false` — the change **persisted**. |
| 5 | Read the chrome toolbar `#toggle-media` via `readDom(wcId)`/`captureWindow()` on the chrome `wcId`. | The Media toolbar icon is now **removed/hidden** — the toolbar reflects the unpin **live** (two-way). `#toggle-privacy` (Shields) remains visible. |
| 6 | With Media unpinned, fire **Ctrl+M** at the **chrome** target: establish a focus anchor with `click(wcId, x, y)` in the chrome, then `pressKey(wcId, 'M', ['control'])` (the leg-1 modifier-chord capability) — the shortcut is a chrome `document` keydown, independent of the toolbar button. | The media panel still **opens** (confirmed via `readDom(wcId)`/`readAxTree(wcId)`/`captureWindow()`) — unpinning removed the toolbar icon only; the keyboard shortcut remains active. |
| 7 | Re-pin Media from the settings Appearance toggle (back ON): `click(guestWcId, x, y)` (located via `captureWindow()`) or keyboard-activate the Media pin toggle. Re-read `settings.json` (filesystem) and the chrome toolbar (`readDom(wcId)`). | `settings.json` `toolbarPins.media === true`; the Media icon **returns** to the toolbar. |
| 8 | Open a normal web tab (`https://example.com/`); take a `captureWindow()` to locate the web chip and `click(wcId, x, y)` on it; in the site-info popup, locate **"Site settings →"** via a fresh `captureWindow()` and `click(wcId, x, y)` on it. Read the chrome via `readDom(wcId)`/`readAxTree(wcId)`. | A **`goldfinch://settings/#privacy`** tab opens or an existing settings tab is activated + navigated to it (active webview `src`/address contains `#privacy`); the **slide-out panel does NOT open**. The popup closes. |
| 9 | Run `npm run a11y` (chrome) and `npm run a11y -- --target=goldfinch://settings`; read both results. | **No NEW** violations vs the pinned `ACCEPTED` baseline — the icon toolbar (chrome) and the Appearance pin toggles (guest) introduce no new WCAG A/AA violations. `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Step 6 is the "unpinned keeps its
shortcut" assertion; step 8 is the "Site settings → opens the settings page, not the panel" assertion.
**Step 9 is NOT on the MCP surface** — `npm run a11y` is the F8-deferred axe-injection harness
(`scripts/a11y-audit.mjs`), invoked as a shell command and run separately against the hardened DevTools
port; it is left verbatim (the MCP surface has no axe-rule evaluation), not migrated to MCP tools.

## Out of Scope
- **Right-click → native "Unpin" context menu** (DD7) — a **native Electron menu** is not in the renderer DOM,
  so its "Unpin" click is **not drivable over the MCP surface**; it is **HAT-verified**. (This test covers unpin via the
  settings Appearance pin toggle, which is the drivable path; both write `toolbarPins` + broadcast, so the
  store/toolbar effect is equivalent.)
- **Per-site Shields overrides** (more-strict-only) — a future flight (mission Known Issues).
- The Shields/home wiring itself — covered by `settings-controls` (run as a regression).
- The `goldfinch://` boundary — covered by `tab-scheme-guard` (regression).

## Variants (optional)
- Repeat the pin/unpin (steps 3–7) for **Shields** (`toolbarPins.shields`; Ctrl+Shift+P for step 6).
