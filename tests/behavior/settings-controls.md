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
- Goldfinch running via `npm run dev:debug` (CDP `:9222`); `scripts/cdp-driver.mjs` reaches it. **Not** the
  `chrome-devtools` MCP.
- The build includes the settings store, the secured bridge, and the wired Shields/home controls.
- A reachable web page (e.g. `https://example.com/`) for the home-effect + security checks.
- The settings store path is known: `userData/settings.json` (read via Bash/Read on the filesystem); Shields:
  `userData/shields.json`.
- **Guest-reachability probe**: after opening Settings, confirm the `goldfinch://settings` guest is attachable
  (it surfaces as `type: webview` in the flat CDP `/json` list — proven Flights 4–5).

## Observables Required
- browser (guest DOM of `goldfinch://settings` — the Shields toggle controls + the home-page input; the
  chrome privacy-panel DOM; tab set + new-tab URL — via `scripts/cdp-driver.mjs` + node-CDP guest attach)
- filesystem (`userData/settings.json`, `userData/shields.json` — persistence, via Read/Bash)
- shell (precondition probes; reading the store files — via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe: `node scripts/cdp-driver.mjs eval '1+1'`; confirm a renderer target. Open Settings (kebab ⋮ → Settings or trusted `createTab('goldfinch://settings', null, {trusted:true})`). Attach to the guest. | Returns `2`; the `goldfinch://settings` guest is attachable; the Privacy & Shields section shows real toggle controls and the On-startup section shows a home-page input (not placeholders). |
| 2 | Read the current Shields state from the guest controls AND from `userData/shields.json`. Note one global toggle's value (e.g. `block`). | The guest's toggle state matches `shields.json` for the global keys (`enabled`/`block`/`strip`/`isolate`/`farble`). |
| 3 | In the settings guest, flip a global Shield toggle (e.g. `block`) — by keyboard (Tab to it, Space/Enter) — and read back. | The toggle flips in the guest; the action is keyboard-operable (visible focus, togglable without mouse). `[a11y]` |
| 4 | Read `userData/shields.json` after the flip. | `shields.json` reflects the new value — the change **persisted** through the bridge to the store/`shields.js`. |
| 5 | Open (or focus) the slide-out **Shields panel** in the chrome (Shield button) and read its toggle for the same key. | The panel reflects the **same** new value — settings ↔ panel are **consistent** (the `shields-changed` broadcast reached both surfaces). |
| 6 | Read the current home page from the settings input AND from `userData/settings.json`. Then set a new home page in settings (e.g. `https://example.com/`) by keyboard, and confirm it saved. | The input shows the stored `homePage`; after the edit, `userData/settings.json` reflects the new value. Keyboard-operable. `[a11y]` |
| 7 | Try to set an **unsafe** home page (e.g. `goldfinch://settings` or `javascript:alert(1)`) from settings. | The value is **rejected** (validation via `isSafeTabUrl`); `settings.json` keeps the prior valid value; the UI does not accept it. |
| 8 | Open a **new tab** (the `+` control or a fresh new-tab action). Read the new tab's webview `src`. | The new tab opens to the **newly-set home page** (`https://example.com/`), not the old hardcoded default — the home setting **takes effect**. |
| 9 | **Security:** open a normal web tab (`https://example.com/`); in that web guest, read `typeof window.goldfinchInternal`. | `undefined` — the privileged bridge is **absent** in web tabs (they get the web preload, not the internal one). |
| 10 | **Security:** via CDP `Runtime.evaluate` against the **`file://` chrome target** (index.html), attempt `ipcRenderer.invoke('internal-settings-set', {homePage:'https://evil.test/'})`. (Note: this proves the privileged channel is **not exposed to the chrome surface** — `chrome-preload.js` doesn't carry `ipcRenderer` — which is adjacent to, not identical to, "main rejects a non-internal sender.") Read `userData/settings.json` after. | The call **fails / is rejected** (`ipcRenderer` not available on the chrome surface, and/or the main helper rejects the non-internal sender); `settings.json` is **unchanged** (no `evil.test`). *(The true "web content inside the internal session" vector is hard to drive post-Flight-5 — nav lock + immutable webPreferences. If undrivable, assert step 9 + this + the structural main-side `senderFrame.origin` argument, and **log the gap** per DD5 — do not claim the in-session case as driven.)* |
| 11 | (Setup) Run `npm run a11y -- --target=goldfinch://settings` against the settings guest with the wired controls. | (empty — judged in step 12) |
| 12 | Read the guest a11y result. | **No NEW** violations vs the pinned `ACCEPTED` baseline — the wired controls (toggles + input) introduce no new WCAG A/AA violations. `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Steps 9–10 are the origin-check
security assertion (the Flight-4/5 Known-Issue closure); step 10's in-session vector may be argued rather
than driven per DD5.

## Out of Scope
- **Per-site Shields pause** (`pausedSites`) — stays in the slide-out panel (needs a current site); not wired
  into settings this flight.
- **The pin/unpin system** + the "Site settings →" rewire — **Flight 7**.
- **safeStorage encryption** of the store — deferred until a secrets manager exists (DD6).

## Variants (optional)
- Per global toggle (`enabled`/`block`/`strip`/`isolate`/`farble`) — parametrize step 3–5.
- Home page set to a search term vs a full URL (exercises `toUrl` normalization at the createTab site).
