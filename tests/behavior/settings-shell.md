# Behavior Test: Settings page shell + address-bar chips

**Slug**: `settings-shell`
**Status**: active
**Created**: 2026-06-07
**Last Run**: 2026-06-07-18-07-42 (pass — 12/12; see `settings-shell/runs/`)

## Intent
Verify that `goldfinch://settings` presents a **recognizable, accessible settings shell** (persistent
left section-nav + titled sections + placeholder content) and that the **address-bar chips** behave
correctly — an internal-page identity chip on `goldfinch://`, a web-page site-info chip + popup on
`http(s)` (summarizing existing per-tab data), and the **internal-tab navigation lock**, now enforced by a
**read-only address bar** on internal tabs (`readOnly=true`; editable on web tabs) so direct user URL entry
into a `goldfinch://` tab is blocked at the input. This needs a
behavior test rather than a unit test because the assertions are real-environment, cross-process UI
observations: the shell renders inside a guest WebContentsView on a privileged scheme, the chip lives in the
chrome renderer and reflects the active tab, and the lock is a navigation-routing behavior visible only
in the running app. SC6 (recognizable shell) and SC8 (keyboard + a11y) are exactly this shape.

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
  The Bearer rides every request the transport sends.
- **These specs require the admin key.** A jar key is refused `getChromeTarget` (`admin-only`) and
  cannot see the internal `goldfinch://settings` guest (jar keys cannot reach internal sessions).
  Only the admin identity can enumerate + drive internal tabs (admin engine built with
  `{ allowInternal: true }`).
- **Two distinct targets (load-bearing for this spec):**
  - **Chrome target** (`getChromeTarget()` → chrome `wcId`): the Goldfinch chrome UI — address-bar
    chip, toolbar, tab strip. Read via `readDom(wcId)` / `readAxTree(wcId)`; drive via
    `click(wcId, x, y)` / `pressKey(wcId, name)`.
  - **Internal guest target** (from `enumerateTabs` → the entry with `url: 'goldfinch://settings'`
    → its `wcId` as `guestWcId`): the `goldfinch://settings` guest WebContentsView. Read via
    `readDom(guestWcId)` / `readAxTree(guestWcId)`; drive via `click(guestWcId, x, y)` /
    `pressKey(guestWcId, name)`. Keep them straight — do NOT pass the chrome `wcId` to guest read
    calls or vice versa.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over
  the MCP surface.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab` from the bare document
  does not relocate focus — this is normal browser behavior, NOT an engine defect. **Before any
  keyboard-only sequence, establish a focus anchor by sending a `click(wcId, x, y)` (or
  `click(guestWcId, x, y)`) into the target first.**
- The build includes the served `settings.css` (+ optional `settings.js`) and the chip/popup/lock code.
- A reachable web page for the web-chip + lock checks (e.g. `https://example.com/`).
- **Active-precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`,
  and `getChromeTarget()` returns a numeric chrome `wcId`. After opening Settings, confirm the
  `goldfinch://settings` guest is enumerable via `enumerateTabs` (the admin engine's `allowInternal`
  makes it visible; if it is absent, halt).
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not** the
  CDP attach path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP
  surface is used.

## Observables Required
- mcp (admin MCP tools — `readDom(guestWcId)` / `readAxTree(guestWcId)` for the rendered guest DOM
  of `goldfinch://settings` (the `<nav>` links, the titled `<section>`s and their `<h2>`s,
  `aria-current`); `readDom(wcId)` / `readAxTree(wcId)` for the chrome renderer's chip element +
  popup; `captureWindow()` / `captureScreenshot(wcId)` for screenshots; `enumerateTabs` for tab set
  + partitions — all measured via the admin MCP client)
- shell (precondition probes: `tools/list` count and `getChromeTarget` result — measured via the MCP
  client or Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; call `getChromeTarget()` and record `wcId`. | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Else halt. |
| 2 | Open Settings via the kebab (take a `captureWindow()` screenshot; locate the kebab (⋮) button coordinates; call `click(wcId, x, y)` to open the kebab menu, then `click(wcId, x, y)` on the Settings item coordinates), or the identical trusted path `openTab('goldfinch://settings', null, {trusted:true})` — note which. Wait for load. Then call `enumerateTabs` and identify the `goldfinch://settings` entry; record its `wcId` as `guestWcId`. | A tab opens to `goldfinch://settings`; the active webview's partition is `goldfinch-internal`; the address bar shows the internal URL. `enumerateTabs` includes the `goldfinch://settings` entry (the admin engine's `allowInternal` makes the internal guest enumerable). Record `guestWcId`. |
| 3 | Call `readDom(guestWcId)` and `readAxTree(guestWcId)` on the `goldfinch://settings` guest; take a `captureWindow()` screenshot. | The guest renders a **persistent left section-nav** with the 5 links (Appearance, Privacy & Shields, Automation, On startup, About) and **5 titled `<section>`s** (`appearance`, `privacy`, `automation`, `startup`, `about`) each with an `<h2>` + content. Recognizable as a settings area. |
| 4 | In the guest, establish a focus anchor via `click(guestWcId, x, y)` on the nav area (locate via `captureWindow()` or `readDom(guestWcId)`), then move keyboard focus to a section nav link (via `pressKey(guestWcId, 'Tab')`) and activate it (`pressKey(guestWcId, 'Enter')`). Call `readAxTree(guestWcId)` to confirm focus and scroll state. | Focus reaches the nav link (visible focus ring in `captureWindow()`); activating it moves to the corresponding section (the target `<section>`/`<h2>` is scrolled into view / focused per `readAxTree(guestWcId)`). Section nav is keyboard-operable. `[a11y]` |
| 5 | (Setup) Run `npm run a11y -- --target=goldfinch://settings` against the open shell. | (empty — judged in step 6) |
| 6 | Read the guest-target a11y result. | **No NEW violations** vs the pinned `ACCEPTED` baseline — the shell introduces no new WCAG A/AA violations. `[a11y]` |
| 7 | Confirm the **internal-page identity chip**: with the Settings tab active, call `readDom(wcId)` / `readAxTree(wcId)` on the **chrome target** to read the chip element in the chrome `#address-wrap`. | An internal-page identity chip is shown (a "Goldfinch"/secure-internal indicator), distinct from the web-page chip; it is NOT a web origin/lock. |
| 8 | Open a normal web tab to `https://example.com/` and activate it; call `readDom(wcId)` / `readAxTree(wcId)` on the **chrome target** to read the chip in `#address-wrap`. | A **web-page site-info chip** is shown (a connection/lock indicator + the origin `example.com`), distinct from the internal chip. |
| 9 | Take a `captureWindow()` screenshot to locate the web chip; call `click(wcId, x, y)` on the chip coordinates; call `readDom(wcId)` / `readAxTree(wcId)` on the **chrome target** to read the popup element + its text. | A site-info **popup** opens showing the origin + connection (https) + a compact summary derived from the tab's existing privacy data (trackers blocked / permissions count) + a **"Site settings →"** action. *(A freshly-opened site legitimately summarizes to `0 trackers` / empty; `tab.privacy.net` is null until the ~350ms `privacy-net` IPC arrives — `0`/"—"/empty is a valid pass, the popup must not be blank/crashed.)* |
| 10 | Take a `captureWindow()` screenshot to locate the popup's "Site settings →" action; call `click(wcId, x, y)` on its coordinates; observe via `enumerateTabs` + `readDom(wcId)` on the chrome. | Activating **"Site settings →"** navigates to the internal **`goldfinch://settings/#privacy`** page (the Flight-7 rewire): an existing internal Settings tab is reused and moved to `#privacy`, else a new trusted internal tab opens there. It does **NOT** open a slide-out Shields/privacy panel (that panel is still reachable via the toolbar Shields icon / `Ctrl+Shift+P`, but is no longer this action's destination). The popup closes. |
| 11 | **Internal-tab read-only address lock**: re-activate the `goldfinch://settings` tab (locate it via `captureWindow()` and `click(wcId, x, y)`, or `enumerateTabs`); read the chrome address `<input>` via `readDom(wcId)` / `readAxTree(wcId)` and inspect its editability (`readOnly` / `aria-readonly` / not-editable). Then activate a normal web tab (e.g. `https://example.com/`) and read the same address `<input>` again for contrast. | On the internal Settings tab the address `<input>` is **read-only** (`readOnly=true` — the chip is `data-state="internal"`), so direct user URL entry is blocked at the input: the old "type a web URL → new tab opens" affordance no longer applies. This is **intended trust hardening**. On the web tab the same `<input>` is **editable** (`readOnly=false`, `data-state="web"`). The internal Settings tab remains on `goldfinch://settings`. |
| 12 | Dismiss the site-info popup by calling `click(wcId, x, y)` outside it (locate via `captureWindow()`) or `pressKey(wcId, 'Escape')` (if still open) and confirm the shared menu-dismiss behavior via `readAxTree(wcId)`. | The popup closes on outside-click / Escape (it routes through the shared `menuController`); focus returns appropriately. `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Step 11's lock is the UX half of the
Flight-4 internal-tab finding — it does NOT assert the security origin-check (that's Flight 6).

## Out of Scope
- **Wiring real settings controls** (Shields toggles, home page) — placeholder content only this flight
  (SC7 / Flight 6).
- **The security origin-check** of the internal bridge (Flight 6) — step 11 verifies the *navigation
  lock* (UX), not that a web page can't reach privileged IPC.
- The `goldfinch://` boundary vectors — covered by `tab-scheme-guard` (run as a regression).

## Variants (optional)
- N/A for the draft. Could later parametrize the section set or add a tabbed-navigation variant.
