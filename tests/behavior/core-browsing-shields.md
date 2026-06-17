# Behavior Test: Core browsing + Shields survive the Electron upgrade

**Slug**: `core-browsing-shields`
**Status**: active
**Created**: 2026-06-05
**Last Run**: 2026-06-05-17-43-36 (pass — 5/5; on Electron 42.3.3; see runs/2026-06-05-17-43-36.md)

## Intent

After the Electron 33 → 42 major upgrade, verify that the core runtime behaviors that unit tests and `@ts-check` cannot observe still work: the app launches, a tab navigates and renders a real page, the Shields `webRequest` pipeline still **blocks a known third-party tracker** and **strips tracking params**, and multi-tab works. This needs a behavior test (not a unit test) because the behavior lives in the live Chromium/Electron `session.webRequest` layer that the major upgrade most threatens — only the running app proves the privacy enforcement survived the Chromium bump.

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch (post-upgrade) is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT={port}`. At launch, the
  app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`.
  The MCP server listens on `127.0.0.1:{port}/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`). Export it once at launch and reuse it (as `{port}`) in all SDK calls.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on `127.0.0.1:{port}/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  The Bearer rides every request the transport sends.
- **This is an ADMIN spec — the admin key is required, a jar key is refused.** The key assertion (Step 5,
  tracker-block) reads the **chrome** privacy panel, which lives in the chrome renderer — reachable only via
  `getChromeTarget()` (`admin-only`; a jar key is refused, `scope.js:149`) plus `captureWindow()` (also
  admin-gated). The guest navigation (Steps 3–4, 6) drives `<webview>` tabs via `openTab`/`navigate`, but
  the whole spec runs on **one admin identity** because it asserts chrome-visible state (the privacy panel),
  not jar isolation — simpler than a two-client spec and correct for what it measures.
- **A local HTTP fixture is served** (a page that references a known tracker domain and carries tracking
  params) at a known `http://127.0.0.1:8080/` URL — **use a port distinct from `{port}` (the MCP port)**,
  e.g. `8080`; serve via `python3 -m http.server 8080` (or `npx serve -l 8080`) from the fixture dir.
  **Why a served fixture**: the tracker-block assertion needs a page whose HTML requests a registrable
  domain that is in `src/main/trackers.js`'s `TRACKERS` map — use
  `<script src="https://www.google-analytics.com/analytics.js"></script>` (`google-analytics.com` →
  `analytics`, confirmed in `trackers.js`) so the Shields `block` strategy cancels it; the param-strip
  assertion needs the page loaded at a URL carrying `utm_*` params. The fixture port and `{port}` must stay
  distinct so the served page and the MCP server do not collide.
- Input must be delivered as **trusted events** via the MCP tools (`click(wcId, x, y)`, `navigate(wcId, url)`,
  etc.), not synthetic `dispatchEvent` — only trusted events fire the renderer's real handlers.
- **Coordinate-click rule (apparatus rule):** all clicks are coordinate-based — `click(wcId, x, y)` located
  via a `captureWindow()` screenshot. There are no CSS selectors over the MCP surface; the privacy-panel
  Shield toggle (`#toggle-privacy`) is located by reading a `captureWindow()` frame of the chrome `wcId`.
- **Focus-anchor rule (apparatus rule):** if any keyboard step is added, establish a focus anchor with a
  `click(wcId, x, y)` into the chrome first (a cold `Tab` from the bare document does not relocate focus —
  normal browser behavior, not an engine defect). The current steps drive by coordinate-click + navigation,
  so no cold-`Tab` anchor is needed.
- **Active precondition probe** (Step 1): confirm `tools/list` shows 17 tools including `getChromeTarget`,
  `getChromeTarget()` returns a numeric chrome `wcId`, and the fixture serves before exercising anything.
- Shields are at defaults (all on) — the test asserts default-on behavior; if a prior run paused a site,
  reset (the app starts with `pausedSites: []`).
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:{port}`, app launched via `npm run dev:automation`. This is **not** a CDP / DevTools-port attach
  path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is used.

## Observables Required

- mcp (admin MCP tools — measured via the admin MCP client connected with the admin Bearer header):
  the chrome `wcId` (`getChromeTarget()`); the live guest tabs and their URLs (`enumerateTabs()`); each
  guest's rendered body / current URL (`readDom(guestWcId)` → `{ url, title, html }` — body text in `html`,
  authoritative current URL in `url`); the chrome privacy panel's blocked-tracker rows
  (`readDom(chromeWcId)` → the rendered `outerHTML`); `captureWindow(chromeWcId)` screenshots to locate the
  Shield toggle and corroborate panel state.
- shell (precondition probes: `tools/list` count, `getChromeTarget` result, fixture HTTP 200 — Bash/curl).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; call `getChromeTarget()`; and probe the fixture URL (`curl http://127.0.0.1:8080/`). | `tools/list` returns **17 tools** including `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` with a **numeric** chrome `wcId`. The fixture returns HTTP 200. Record `chromeWcId`. Halt if any fails. |
| 2 | App-launch smoke: call `getChromeTarget()` and `enumerateTabs()`. | `getChromeTarget()` returns the chrome `wcId` (the Goldfinch chrome renderer is up) and `enumerateTabs()` lists **at least one guest** `<webview>` tab — the app started cleanly on the new Electron (no white screen / crash). |
| 3 | Open a tab to a real page: `openTab('https://example.com/')` → guest `wcId`; wait for load, then `readDom(guestWcId)`. | `openTab` returns a numeric guest `wcId`; `readDom(guestWcId).html` contains "Example Domain" and `readDom(guestWcId).url` is `https://example.com/`. Core navigation + rendering survived the upgrade. (The guest `url` is the authoritative current-URL witness; the chrome address bar can be cross-read via `getChromeTarget`+`readDom` if desired.) |
| 4 | Navigate a guest to the local fixture loaded at `http://127.0.0.1:8080/?utm_source=test&q=keep` (via `navigate(guestWcId, …)`, or `openTab(…)` for a fresh guest `wcId`). Wait for load, then `readDom(guestWcId)`. | The fixture renders; `readDom(guestWcId).url` has the tracking param **stripped** — `utm_source` gone, `q=keep` preserved — confirming the top-level navigation strip redirect (`session.webRequest` → `redirectURL`) still works. (Observe the guest **`url`**, **not** the privacy aggregate's `stripped` count — that field is 0 for mainFrame navigation by design: `recordRequest` returns early on `resourceType==='mainFrame'`. Don't assert on it.) |
| 5 | On the **chrome** `wcId`: take a `captureWindow(chromeWcId)` screenshot, locate the Shield toggle (`#toggle-privacy`) and `click(chromeWcId, x, y)` to **open the privacy panel** (if collapsed). Then `readDom(chromeWcId)` and inspect the returned `outerHTML`. | After loading the fixture (which requests `google-analytics.com`), the rendered privacy panel in `readDom(chromeWcId).html` contains a **`class="tag blk"` row naming `google-analytics.com`** — the blocked tracker (**primary, blocked-specific witness**); the `session.webRequest.onBeforeRequest` block path survived the Chromium bump. **This is a `readDom` read, not in-page eval** — the `.tag.blk` rows are static rendered elements in the chrome `outerHTML` once the panel is open (a read before opening returns no tags). **Optional secondary cross-check**: the `#privacy-count` **toolbar badge** (`<span id="privacy-count" class="tb-badge">`) reads a **bare integer ≥ 1** (the *total* tracker count, blocked + allowed; `.hidden` when zero — NOT "Shield (N)"); treat it only as a ≥1 corroboration, not the blocked-specific assertion. |
| 6 | Open a second tab: `openTab(<another page>)`; then **poll** `enumerateTabs()` (with a timeout) until **two guest tabs** appear; `activateTab(secondWcId)` to switch. | `enumerateTabs()` reports two distinct guest tabs; `activateTab` switches without error; no crash. Multi-tab + session wiring intact. (Poll for the second tab — there's a brief window after `openTab` before the new guest registers in `enumerateTabs()`.) |

## Out of Scope

- Fingerprint farbling correctness, downloads-to-disk, container/jar cookie isolation, New Identity — these are deeper runtime behaviors; this spec is the **core browsing + Shields-blocking smoke gate** for the upgrade. (Note as residual upgrade risk; a fuller privacy behavior suite is a future spec.)
- Hostile-URL scheme guarding — covered by the separate `tab-scheme-guard` spec (re-run alongside this one post-upgrade).

## Variants (optional)

- N/A for the draft. Could later parametrize Step 5 over multiple tracker categories (ads/analytics/social).
