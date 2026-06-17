# Behavior Test: Settings controls — Shields toggles + home page (wired)

**Slug**: `settings-controls`
**Status**: active
**Created**: 2026-06-08
**Last Run**: 2026-06-07-21-23-58 (pass; see `settings-controls/runs/`)

## Intent
Verify that the **global Shields toggles** and the **home page** are operable **from `goldfinch://settings`**,
that changes **persist** (to `shields.json` / `settings.json`) and **take effect**, and that they stay
**consistent with the existing slide-out Shields panel** — plus that the privileged settings-page IPC bridge
is **origin-locked** (web content cannot call it). This needs a behavior test, not a unit test, because the
assertions are real-environment + cross-process: a control in a `<webview>` guest on a privileged scheme
writes through an origin-checked IPC bridge to the main process, which persists to disk and broadcasts to a
*different* renderer (the chrome) — none of which is observable offline. SC7 (controls operable + persistent
+ consistent) and SC8 (keyboard + a11y) are exactly this shape.

## Preconditions
- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`. At launch, the
  app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`.
  The MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`). Export it once at launch and reuse it in all SDK calls.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  The Bearer rides every request the transport sends. This spec requires the **admin** key — both the
  chrome renderer (`getChromeTarget`, for the slide-out Shields panel read) and the internal
  `goldfinch://settings` guest (`enumerateTabs` with `allowInternal`) are needed.
- The build includes the settings store, the secured bridge, and the wired Shields/home controls.
- A reachable web page (e.g. `https://example.com/`) for the home-effect + security checks.
- The settings store path is known: `userData/settings.json` (read via Bash/Read on the filesystem); Shields:
  `userData/shields.json`.
- **Guest-reachability probe**: after opening Settings, confirm the `goldfinch://settings` guest is
  reachable — it surfaces in admin `enumerateTabs({ allowInternal: true })` as the internal guest `wcId`
  (proven by `settings-shell`'s migration).
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold keyboard sequence from the bare
  document does not relocate focus. **Before any keyboard-only sequence on the settings guest, establish a
  focus anchor with `click(guestWcId, x, y)` into the guest first** (located via `captureWindow()`), then
  `pressKey`/`typeText`. Confirm focus via the focused node in `readAxTree(guestWcId)`.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over the MCP
  surface.
- **Active precondition probe** (Step 1): confirm `tools/list` shows 17 tools including `getChromeTarget`
  and `enumerateTabs`; `getChromeTarget()` returns a numeric chrome `wcId`. A dead or jar-identity
  connection otherwise surfaces as a confusing mid-test cascade.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not** a CDP attach
  path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is used.

## Observables Required
- mcp (admin MCP tools — measured via the admin MCP client connected with the admin Bearer header):
  - the **`goldfinch://settings` guest** (`wcId` from `enumerateTabs({ allowInternal: true })`): the
    Shields toggle controls + the home-page input via `readDom(guestWcId)` / `readAxTree(guestWcId)`
    (toggle `aria-pressed`/`aria-checked` + roles + the focused node via the `focused` property);
    `typeText(guestWcId, …)` / `pressKey(guestWcId, …)` to drive them; `captureWindow()` to locate
    controls before clicks;
  - the **chrome** (`getChromeTarget()` → chrome `wcId`): the slide-out privacy-panel DOM via
    `readDom(chromeWcId)`; the tab set + new-tab URL via `enumerateTabs()`;
- filesystem (`userData/settings.json`, `userData/shields.json` — persistence, via Read/Bash).
- shell (precondition probes; reading the store files — via Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; `tools/list`; `getChromeTarget()`. Open Settings (locate the kebab ⋮ via `captureWindow()`, `click(chromeWcId,…)` → Settings; or `openTab('goldfinch://settings')` via the trusted path). Find the guest `wcId` via `enumerateTabs({ allowInternal: true })`. | `tools/list` returns **17 tools** including `getChromeTarget`/`enumerateTabs`; `getChromeTarget()` returns a numeric chrome `wcId`; the `goldfinch://settings` guest appears in `enumerateTabs({ allowInternal: true })` with a numeric `wcId`; `readDom(guestWcId)`/`readAxTree(guestWcId)` show the Privacy & Shields section with real toggle controls and the On-startup section with a home-page input (not placeholders). Record both `wcId`s. If not, halt — preconditions not met. |
| 2 | Read the current Shields state from the guest controls (`readDom(guestWcId)`/`readAxTree(guestWcId)`) AND from `userData/shields.json`. Note one global toggle's value (e.g. `block`). | The guest's toggle state matches `shields.json` for the global keys (`enabled`/`block`/`strip`/`isolate`/`farble`). |
| 3 | In the settings guest, flip a global Shield toggle (e.g. `block`) — by keyboard: focus-anchor `click(guestWcId,…)`, then `pressKey(guestWcId, 'Tab')` to the toggle (confirm via the focused node in `readAxTree(guestWcId)`), then `pressKey(guestWcId, 'Space')`/`'Enter'` — and read back. | The toggle flips in the guest (`aria-pressed`/`aria-checked` via `readAxTree(guestWcId)`); the action is keyboard-operable (visible focus per the focused node + `captureWindow()`, togglable without mouse). `[a11y]` |
| 4 | Read `userData/shields.json` after the flip. | `shields.json` reflects the new value — the change **persisted** through the bridge to the store/`shields.js`. |
| 5 | Open (or focus) the slide-out **Shields panel** in the chrome (locate + `click(chromeWcId,…)` the Shield button, or `pressKey(chromeWcId, 'P', ['control','shift'])`) and read its toggle for the same key via `readDom(chromeWcId)`/`readAxTree(chromeWcId)`. | The panel reflects the **same** new value — settings ↔ panel are **consistent** (the `shields-changed` broadcast reached both surfaces). |
| 6 | Read the current home page from the settings input (`readDom(guestWcId)`) AND from `userData/settings.json`. Then set a new home page in the settings guest (e.g. `https://example.com/`) by keyboard: focus the input (anchor click + `pressKey(guestWcId, 'Tab')`), `typeText(guestWcId, 'https://example.com/')`, commit (`pressKey(guestWcId, 'Enter')`/Tab-out), and confirm it saved. | The input shows the stored `homePage`; after the edit, `userData/settings.json` reflects the new value. Keyboard-operable. `[a11y]` |
| 7 | Try to set an **unsafe** home page (e.g. `goldfinch://settings` or `javascript:alert(1)`) from the settings guest (`typeText(guestWcId, …)` + commit). | The value is **rejected** (validation via `isSafeTabUrl`); `settings.json` keeps the prior valid value; the UI does not accept it. |
| 8 | Open a **new tab** (locate the `+` control via `captureWindow()` and `click(chromeWcId,…)`, or `openTab()` with no URL). Read the new tab's webview `src` via `enumerateTabs()`/`readDom`. | The new tab opens to the **newly-set home page** (`https://example.com/`), not the old hardcoded default — the home setting **takes effect**. |
| 9 | **Security (privileged-bridge absence in a web tab).** | > **Deferred to F8-eval:** asserts `typeof window.goldfinchInternal === undefined` in a web guest — a script-runtime read with no DOM/a11y/pixel manifestation. Needs an in-page `evaluate(wcId, expr)` MCP tool (F8-eval); not expressible on the current surface. The assertion intent (the privileged bridge is **absent** in web tabs — they get the web preload, not the internal one) is preserved here for when the `evaluate` tool lands. |
| 10 | **Security (privileged-channel privilege-escalation probe).** | > **Deferred to F8-eval:** the page-context `ipcRenderer.invoke('internal-settings-set', { homePage: 'https://evil.test/' })` privilege-escalation probe needs an in-page `evaluate` MCP tool to drive from a guest/chrome context (F8-eval). The assertion intent is preserved: the call must be **rejected** (the `ipcRenderer` is not exposed on the chrome surface and/or the main helper rejects the non-internal sender) and `userData/settings.json` must be **unchanged** (no `evil.test`). *(The true "web content inside the internal session" vector remains hard to drive post-Flight-5 — nav lock + immutable webPreferences; when the `evaluate` tool lands, assert this alongside step 9 + the structural main-side `senderFrame.origin` argument, and log the gap per DD5 — do not claim the in-session case as driven.)* |
| 11 | (Setup) Run `npm run a11y -- --target=goldfinch://settings` against the settings guest with the wired controls. | > **Deferred to F8-eval (a11y harness):** this is the axe-core injection audit — it runs axe's rule engine in-page, which the MCP surface's `readAxTree` (AX *tree*, not axe rule evaluation) cannot reproduce. Kept verbatim as the F8-deferred axe harness; not migrated to the MCP surface. (empty — judged in step 12) |
| 12 | Read the guest a11y result. | > **Deferred to F8-eval (a11y harness):** paired with Step 11. Assertion intent preserved — **No NEW** violations vs the pinned `ACCEPTED` baseline: the wired controls (toggles + input) introduce no new WCAG A/AA violations. `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Steps 1–8 run on the admin MCP
surface (settings guest `wcId` via `enumerateTabs({ allowInternal: true })`; chrome via
`getChromeTarget`; store files via filesystem). Focus assertions read the **focused node** (the node
whose `focused` property is set) from the raw `readAxTree(guestWcId)` AX-node array — not an in-page
`document.activeElement` eval. Steps 9–10 are the origin-check security assertions (the Flight-4/5
Known-Issue closure), **deferred to F8-eval** because they read script-runtime values / drive page-context
IPC — both need an in-page `evaluate` MCP tool the current surface lacks; the assertion intent is recorded
in each step body so the checkpoint is not lost. Steps 11–12 are the **F8-deferred axe harness** (`npm run
a11y`, an in-page rule engine, not migrated).

## Out of Scope
- **Per-site Shields pause** (`pausedSites`) — stays in the slide-out panel (needs a current site); not wired
  into settings this flight.
- **The pin/unpin system** + the "Site settings →" rewire — **Flight 7**.
- **safeStorage encryption** of the store — deferred until a secrets manager exists (DD6).

## Variants (optional)
- Per global toggle (`enabled`/`block`/`strip`/`isolate`/`farble`) — parametrize step 3–5.
- Home page set to a search term vs a full URL (exercises `toUrl` normalization at the createTab site).
