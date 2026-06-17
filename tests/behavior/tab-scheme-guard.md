# Behavior Test: Tab URL scheme guard rejects hostile schemes

**Slug**: `tab-scheme-guard`
**Status**: active
**Created**: 2026-06-05
**Last Run**: 2026-06-07-19-40-28 (pass — 13 / 13; see runs/2026-06-07-19-40-28.md). Prior: 2026-06-05-16-29-17 (partial 5/0/1).

> **Promoted `draft → active` on the 2026-06-07 run (Flight 4, leg `verify-integration`).** That run
> extended the spec to the internal-scheme boundary (steps 8–13) and resolved the prior Step-6
> inconclusive: the `file:` media vector **is** reachable after all (the media panel catalogs the
> crafted `<video src=file://>` item and exposes a clickable "Pop out to new tab" action) — it is
> **blocked at the destination** (`popout()` routes through `createTab` on the untrusted branch, whose
> `isSafeTabUrl` gate rejects `file:`), i.e. **reachable-but-guarded**, not structurally unreachable.

## Intent

Verify that a hostile web page cannot cause Goldfinch to load a dangerous-scheme URL (`file:`, `javascript:`, `data:`) into a webview — through any of the three reachable vectors: the `window.open()` path, the media-panel "open as tab" path, and **in-page self-navigation** (`window.location = 'file://…'`) — while a legitimate `https:` `window.open()` still opens normally. This needs a behavior test rather than a unit test because the threat is a *real page* exercising the real enforcement chain inside the running Electron app: `setWindowOpenHandler` → IPC → `createTab` (renderer gate) **and** the main-process `will-navigate` guard. The unit test (`isSafeTabUrl()`) covers the pure predicate, but only the running app proves the predicate is wired into *both* enforcement points and that a `<webview>` never actually navigates to `file://` by any path.

**Extended by Flight 4 (internal page scheme).** The spec also covers the *privileged internal scheme* `goldfinch://` from the inverse angle: it must be **unreachable from web content** (a hostile page cannot navigate to, open, embed, or `fetch` it) yet **reachable through the trusted embedder path** (selecting kebab → Settings opens `goldfinch://settings` in its own tab, reloadable). This is the running-app proof of Flight 4's layered boundary — `isSafeTabUrl` still rejecting `goldfinch://`, the `createTab` `trusted` flag + `isInternalPageUrl` allowlist, the session-aware `will-navigate`, the internal-session-only `protocol.handle`, and the internal-session CSP `frame-ancestors 'none'` — none of which a unit test can attest across process boundaries. (Steps 8–13.)

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
  The Bearer rides every request the transport sends. This spec requires the **admin** key — it needs the
  chrome renderer (`getChromeTarget`, for the trusted kebab→Settings open) and the internal-guest check
  (`enumerateTabs` with `allowInternal`), neither of which a jar key can reach.
- **A local HTTP trigger page is served** (e.g. `python3 -m http.server` in the fixture dir
  `tests/behavior/fixtures/tab-scheme-guard/`) at a known `http://127.0.0.1:PORT/` URL. The page provides
  buttons that call `window.open(<scheme-under-test>)`, set `window.location`, inject an `<iframe>`,
  `fetch('goldfinch://settings')`, and exposes a crafted media element whose source is `file:///etc/passwd`
  (to exercise the media-open vector). **Why HTTP, not file://**: the trigger page itself must load over a
  legitimate scheme so the test isolates the *target* scheme, not the page's own.
- **Observational integrity (load-bearing).** The hostile vectors (`window.open` / `window.location` /
  `<iframe>` / `fetch`) are driven **by the trigger page's own buttons** — the harness **clicks the
  trigger page's buttons** (`click(guestWcId, x, y)` on the web-guest `wcId`, located via
  `captureWindow()`) and **observes** the outcome. The harness must **NOT** itself call
  `window.open`/`fetch`/etc.; driving the attack from the harness would not test the guard. There is no
  in-page eval anywhere in this spec.
- **Active precondition probe** (Step 1 below): confirm `tools/list` shows 17 tools including
  `getChromeTarget`, `openTab`, `enumerateTabs`, `readDom`; `getChromeTarget()` returns a numeric chrome
  `wcId`; the trigger page is reachable (HTTP 200). A dead connection or unserved fixture otherwise
  surfaces as a confusing mid-test cascade.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not** a CDP attach
  path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is used.

## Observables Required

- mcp (admin MCP tools — measured via the admin MCP client connected with the admin Bearer header):
  - the **set of tabs and each tab's current URL** via `enumerateTabs()` (no tab on a forbidden scheme);
  - the active/trigger guest webview's **current URL** via `readDom(guestWcId)` (the `url` field /
    `outerHTML` — the webview stays on the original `http://`; never `file://`/`javascript:`/`data:`/
    `goldfinch://`);
  - the **fixture's own DOM status elements** via `readDom(guestWcId)` — the trigger page writes its
    `fetch`/embed outcomes to stable elements: `#goldfinch-fetch-result` (writes `rejected: …`/`resolved`)
    and `#goldfinch-embed-result` (records the iframe injection). The fixture performs the `fetch`/embed
    and writes the result to its own DOM; the harness only reads it via `readDom` — **not** harness eval;
  - `captureScreenshot(guestWcId)` / `captureWindow()` screenshots (no local file contents / injected HTML
    rendered; the settings stub not shown inside an iframe);
  - the chrome `wcId` via `getChromeTarget()` for the trusted kebab→Settings open; `openTab(url)` to
    create the web-guest trigger tab.
- shell (precondition probes: `tools/list` count, `getChromeTarget` result, fixture HTTP 200 — measured
  via the MCP client or Bash/curl).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; call `getChromeTarget()`; `curl` the trigger page URL. Then `openTab('http://127.0.0.1:PORT/')` (the trigger fixture) and record its `wcId` from `enumerateTabs()`. Wait for it to load. | `tools/list` returns **17 tools** including `getChromeTarget`, `openTab`, `enumerateTabs`, `readDom`. `getChromeTarget()` returns a numeric chrome `wcId`. The trigger page returns HTTP 200 and renders in the new tab; `enumerateTabs()` shows the new web-guest `wcId` on the `http://127.0.0.1:PORT/...` URL (the `trigger-page-loaded` marker is visible). Record the chrome `wcId` and the web-guest `wcId`. If any fail, halt — preconditions not met. |
| 2 | Confirm the trigger page is loaded in the web guest: `readDom(guestWcId)` (url + the `trigger-page-loaded` marker) and a `captureWindow()`. | The trigger page is rendered in the active tab; `readDom(guestWcId)`'s `url` is the `http://127.0.0.1:PORT/...` URL and the page shows the hostile-vector buttons. |
| 3 | On the trigger page, click the **`open file:///etc/passwd`** button (locate `#open-file` via `captureWindow()`, then `click(guestWcId, x, y)` — the page's own `window.open('file:///etc/passwd')` fires). Observe via `enumerateTabs()`, `readDom`, and `captureScreenshot`. | No tab renders the contents of `/etc/passwd`; no tab in `enumerateTabs()` has a `file:` URL; no `<webview>` ever carries a `file://` URL. (A blocked attempt may leave no new tab, or a blank/homepage tab — but never local file content.) The harness only clicked the page's button and observed. |
| 4 | Click the **`open javascript:…`** button (`#open-javascript`) and then the **`open data:text/html,…`** button (`#open-data`) on the trigger page (each is a coordinate `click(guestWcId, x, y)`; the page's own `window.open` fires). Observe the tab set + each tab's URL/content. | Neither is loaded into a tab: no tab renders "injected"; no tab's title becomes "pwned"; no tab in `enumerateTabs()` carries a `javascript:` or `data:` URL. *(Note: `window.open` of a blocked scheme may still spawn a **blank `about:blank`** tab — that is acceptable here; the criteria forbid the dangerous URL/content, not a neutralized blank popup. The `file:`/`goldfinch:` `window.open` vectors create no tab at all.)* |
| 5 | **In-page self-navigation:** click the **`navigate self to file:///etc/passwd`** button (`#nav-file`) on the trigger page — the page sets `window.location = 'file:///etc/passwd'` itself. Observe via `enumerateTabs()`/`readDom(guestWcId)`. | The active tab does NOT render `/etc/passwd` and the web guest's current URL (`readDom(guestWcId).url`) is not `file://` (the main-process `will-navigate` guard prevented it). Positive anchor: the web guest remains on the original `http://127.0.0.1:PORT/...` trigger-page URL (navigation was cancelled, not merely redirected elsewhere). This is the vector the `createTab` gate alone would miss. |
| 6 | Open the media panel for the trigger page, locate the crafted media item whose source is `file:///etc/passwd`, and use its "open as tab" / "pop out" action (coordinate clicks on the chrome `wcId` for the panel + item, located via `captureWindow()`). Observe the tab set + URLs. | The media item does not open a tab displaying local file contents; no tab in `enumerateTabs()` navigates to the `file:` URL. (Media-open vector is closed by the same `createTab` guard.) |
| 7 | Control / no-over-block: click the **`open https://example.com/`** control button (`#open-control`) on the trigger page (`click(guestWcId, x, y)`; the page's own `window.open('https://example.com/')` fires). Observe via `enumerateTabs()`/`readDom`. | A new tab DOES open and renders example.com; `enumerateTabs()` shows the new tab on `https://example.com/`. Confirms the guard rejects only dangerous schemes and does not break legitimate `window.open` navigation. |
| 8 | **Internal scheme — page `window.open`:** click the **`open goldfinch://settings`** button (`#open-goldfinch`) on the trigger page (`click(guestWcId, x, y)`; the page's own `window.open('goldfinch://settings')` fires). Observe. | No tab opens to the internal scheme: no tab in `enumerateTabs()` carries a `goldfinch://` URL; no tab renders the settings stub ("Settings — coming soon"). (`setWindowOpenHandler` → `open-tab` IPC → `createTab` *untrusted* → `isSafeTabUrl` rejects `goldfinch://`.) |
| 9 | **Internal scheme — in-page self-navigation:** click the **`navigate self to goldfinch://settings`** button (`#nav-goldfinch`) on the trigger page (the page sets `window.location = 'goldfinch://settings'`). Observe via `readDom(guestWcId)`/`enumerateTabs()`. | The active tab does NOT navigate to `goldfinch://settings`; the web guest's current URL is not `goldfinch://`. Positive anchor: the web guest remains on the original `http://127.0.0.1:PORT/...` trigger-page URL (the session-aware main-process `will-navigate` guard rejected `goldfinch://` from this web origin). |
| 10 | **Internal scheme — embed:** click the **`embed <iframe src="goldfinch://settings">`** button (`#embed-goldfinch`) on the trigger page (the page injects the iframe). Observe via `readDom(guestWcId)` (incl. the `#goldfinch-embed-result` status element, which the fixture sets to confirm the button fired) + `captureScreenshot(guestWcId)`. | The iframe does NOT render the settings stub (no "Settings — coming soon" inside it) — `captureScreenshot` shows it blank/failed. `#goldfinch-embed-result` confirms the button fired (so a blank-but-present iframe is distinguishable from "button never fired"). The internal-session CSP `frame-ancestors 'none'` + the web session having no `goldfinch://` handler both forbid it. |
| 11 | **Internal scheme — cross-origin `fetch`:** click the **`fetch('goldfinch://settings')`** button (`#fetch-goldfinch`) on the trigger page (the page performs the `fetch` and writes the outcome to its own `#goldfinch-fetch-result` element). Read that element via `readDom(guestWcId)`. | `#goldfinch-fetch-result` reads `rejected: …` (a network/scheme error) — it does **NOT** read `resolved` with the stub's body. The internal scheme is not a fetchable origin from a web page. The fixture performed the `fetch` and wrote the result; the harness only read the DOM status element (no harness eval). |
| 12 | **Trusted open (positive):** in the running chrome, locate the kebab (`⋮`) via `captureWindow()` and `click(chromeWcId, x, y)` to open it, then `click` **Settings**. Observe via `enumerateTabs()` + `captureScreenshot`. | A new tab opens to `goldfinch://settings` (`enumerateTabs()` shows a tab on `goldfinch://settings`); the settings stub renders ("Settings — coming soon" / `<h1>Settings</h1>` visible in `captureScreenshot` + `readAxTree`); the tab appears in the strip and is closeable like any other. This is the trusted embedder path — reachable from chrome, not from any page vector above. |
| 13 | **Reload (positive):** with the `goldfinch://settings` tab active, reload it (`reload(internalWcId)` from `enumerateTabs()` with `allowInternal`, or re-activate + reload the internal tab). Observe via `readDom`/`captureScreenshot`. | The tab reloads and re-renders the settings stub; the internal guest's URL stays `goldfinch://settings` (the session-aware `will-navigate` allows the internal session's own reload — SC5 "reloadable like any other tab"). |

**Row conventions:** one row = one checkpoint. The harness **never drives the hostile vectors itself** —
it clicks the **trigger page's own buttons** (`click(guestWcId,…)`) and **observes** outcomes via
`enumerateTabs` / `readDom(guestWcId)` (webview `src`/url + the fixture's `#goldfinch-fetch-result` /
`#goldfinch-embed-result` status elements) / screenshots. The internal-guest positive check (Steps 12–13)
opens Settings via the chrome `wcId` (`getChromeTarget`) and locates the internal tab via `enumerateTabs`
(`allowInternal`). Keep the chrome `wcId` (`getChromeTarget`), web-guest `wcId` (`openTab`/`enumerateTabs`)
and internal-guest `wcId` (`enumerateTabs` `allowInternal`) straight.

## Out of Scope

- The address-bar typing path (`toUrl`, user-initiated) — if the guard is extended there, cover it
  separately; this spec is scoped to *hostile-page-reachable* vectors.
- Download path traversal (F4/F5), `poster` CSS injection (F6), `open-external` (F3), and
  `containers.json` validation (F7) — each verified by its own leg's checks, not this spec.
- Correctness of `isSafeTabUrl()`'s scheme classification in isolation — covered by the pure unit test
  stood up in this flight.

## Variants (optional)

- N/A for the draft. Could later parametrize Step 3/4 over an expanded hostile-scheme list (`chrome:`,
  `about:config`-style, `blob:` cross-origin) once the predicate stabilizes.
