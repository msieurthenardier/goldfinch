# Behavior Test: Tab URL scheme guard rejects hostile schemes

**Slug**: `tab-scheme-guard`
**Status**: draft
**Created**: 2026-06-05
**Last Run**: 2026-06-05-16-29-17 (partial — 5 pass / 0 fail / 1 inconclusive; see runs/2026-06-05-16-29-17.md)

> **Step 6 (media-open file:) needs refinement before promotion to `active`.** The first run found this vector structurally unreachable: `file:` media is never cataloged by the media panel (the crafted `<video src=file://>` errors and never enters the catalog), so there is no media-open path to exercise. The genuinely-hostile vectors (window.open + in-page `window.location`) passed live. Refine Step 6 to a reachable case (e.g. a crafted dangerous-scheme item via the http(s) media-open path, which shares the same `createTab` guard), then re-run to promote.

## Intent

Verify that a hostile web page cannot cause Goldfinch to load a dangerous-scheme URL (`file:`, `javascript:`, `data:`) into a webview — through any of the three reachable vectors: the `window.open()` path, the media-panel "open as tab" path, and **in-page self-navigation** (`window.location = 'file://…'`) — while a legitimate `https:` `window.open()` still opens normally. This needs a behavior test rather than a unit test because the threat is a *real page* exercising the real enforcement chain inside the running Electron app: `setWindowOpenHandler` → IPC → `createTab` (renderer gate) **and** the main-process `will-navigate` guard. The unit test (`isSafeTabUrl()`) covers the pure predicate, but only the running app proves the predicate is wired into *both* enforcement points and that a `<webview>` never actually navigates to `file://` by any path.

**Extended by Flight 4 (internal page scheme).** The spec also covers the *privileged internal scheme* `goldfinch://` from the inverse angle: it must be **unreachable from web content** (a hostile page cannot navigate to, open, embed, or `fetch` it) yet **reachable through the trusted embedder path** (selecting kebab → Settings opens `goldfinch://settings` in its own tab, reloadable). This is the running-app proof of Flight 4's layered boundary — `isSafeTabUrl` still rejecting `goldfinch://`, the `createTab` `trusted` flag + `isInternalPageUrl` allowlist, the session-aware `will-navigate`, the internal-session-only `protocol.handle`, and the internal-session CSP `frame-ancestors 'none'` — none of which a unit test can attest across process boundaries. (Steps 8–13.)

## Preconditions

- Goldfinch is running via `npm run dev:debug` (exposes `--remote-debugging-port=9222 --remote-allow-origins=*`), so the apparatus can attach to both the chrome renderer and webview guest targets.
- A local HTTP trigger page is served (e.g. `python3 -m http.server` in a fixture dir) at a known `http://127.0.0.1:PORT/` URL. The page provides buttons that call `window.open(<scheme-under-test>)` and exposes a crafted media element whose source is `file:///etc/passwd` (to exercise the media-open vector). **Why HTTP, not file://**: the trigger page itself must load over a legitimate scheme so the test isolates the *target* scheme, not the page's own.
- **Active precondition probe** (Step 1 below): confirm port 9222 answers and the trigger page is reachable before exercising any vector — a dead devtools port or unserved fixture otherwise surfaces as a confusing mid-test cascade.

## Observables Required

- browser (rendered tab state — active tab's address bar value, the set of `<webview>` elements and their current URL, and whether any tab visibly renders local file contents or the internal settings stub — measured via the committed `scripts/cdp-driver.mjs` / Playwright MCP attached to port 9222; screenshot + a11y tree are primary, DOM `src` reads are supplementary diagnostic. **Apparatus note (Flight 4 / DD8): the `chrome-devtools` MCP does NOT qualify** — it launches its own browser → false pass.)
- shell (precondition probes: port reachability, fixture HTTP 200 — measured via Bash/curl)
- console (Flight 4: the trigger page's console / a status readback, to observe that a cross-origin `fetch('goldfinch://…')` rejects rather than resolves — measured via the CDP console or a DOM status element the fixture writes)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe the environment: `curl` the devtools endpoint `http://127.0.0.1:9222/json` and the trigger page URL. | Both respond (devtools lists targets incl. a Goldfinch window; trigger page returns HTTP 200). If either fails, halt — preconditions not met. |
| 2 | In the running app, open a tab and navigate it to the HTTP trigger page. Wait for it to load. | The trigger page is rendered in the active tab; the address bar shows the `http://127.0.0.1:PORT/...` URL. |
| 3 | On the trigger page, invoke `window.open('file:///etc/passwd')` (click the corresponding button). | No tab renders the contents of `/etc/passwd`; no `<webview>` has a `file:` URL; the address bar never shows a `file://` URL. (A blocked attempt may leave no new tab, or a blank/homepage tab — but never local file content.) |
| 4 | Invoke `window.open('javascript:document.title="pwned"')` and then `window.open('data:text/html,<h1>injected</h1>')` from the trigger page. | Neither is loaded into a tab: no tab renders "injected"; no tab's title becomes "pwned"; no `<webview>` carries a `javascript:` or `data:` URL. |
| 5 | **In-page self-navigation:** on the trigger page, set `window.location = 'file:///etc/passwd'` (the page navigates *itself*, not via `window.open`). | The active tab does NOT render `/etc/passwd` and the webview's current URL is not `file://` (the main-process `will-navigate` guard prevented it). Positive anchor: the webview remains on the original `http://127.0.0.1:PORT/...` trigger-page URL (navigation was cancelled, not merely redirected elsewhere). This is the vector the `createTab` gate alone would miss. |
| 6 | Open the media panel for the trigger page, locate the crafted media item whose source is `file:///etc/passwd`, and use its "open as tab" action. | The media item does not open a tab displaying local file contents; no `<webview>` navigates to the `file:` URL. (Media-open vector is closed by the same `createTab` guard.) |
| 7 | Control / no-over-block: from the trigger page, invoke `window.open('https://example.com/')`. | A new tab DOES open and renders example.com; the address bar shows `https://example.com/`. Confirms the guard rejects only dangerous schemes and does not break legitimate `window.open` navigation. |
| 8 | **Internal scheme — page `window.open`:** from the trigger page, invoke `window.open('goldfinch://settings')`. | No tab opens to the internal scheme: no `<webview>` carries a `goldfinch://` src; no tab renders the settings stub ("Settings — coming soon"); the address bar never shows `goldfinch://`. (`setWindowOpenHandler` → `open-tab` IPC → `createTab` *untrusted* → `isSafeTabUrl` rejects `goldfinch://`.) |
| 9 | **Internal scheme — in-page self-navigation:** on the trigger page, set `window.location = 'goldfinch://settings'`. | The active tab does NOT navigate to `goldfinch://settings`; the webview's current URL is not `goldfinch://`. Positive anchor: the webview remains on the original `http://127.0.0.1:PORT/...` trigger-page URL (the session-aware main-process `will-navigate` guard rejected `goldfinch://` from this web origin). |
| 10 | **Internal scheme — embed:** on the trigger page, inject `<iframe src="goldfinch://settings">` (button). | The iframe does NOT render the settings stub (no "Settings — coming soon" inside it). The internal-session CSP `frame-ancestors 'none'` + the web session having no `goldfinch://` handler both forbid it; the iframe stays blank/failed. |
| 11 | **Internal scheme — cross-origin `fetch`:** on the trigger page, `fetch('goldfinch://settings')` and report the outcome (button writes the result to a status element / console). | The fetch **rejects** (or yields a network/scheme error) — it does NOT resolve with the stub's body. The internal scheme is not a fetchable origin from a web page. |
| 12 | **Trusted open (positive):** in the running chrome, open the kebab (⋮) menu and select **Settings**. | A new tab opens to `goldfinch://settings` (the active `<webview>`'s src is `goldfinch://settings`); the settings stub renders ("Settings — coming soon" / `<h1>Settings</h1>` visible in screenshot + a11y tree); the tab appears in the strip and is closeable like any other. This is the trusted embedder path — reachable from chrome, not from any page vector above. |
| 13 | **Reload (positive):** with the `goldfinch://settings` tab active, reload it (trusted reload — re-activate / reload the internal tab). | The tab reloads and re-renders the settings stub; the webview's URL stays `goldfinch://settings` (the session-aware `will-navigate` allows the internal session's own reload — SC5 "reloadable like any other tab"). |

## Out of Scope

- The address-bar typing path (`toUrl`, user-initiated) — if the guard is extended there, cover it separately; this spec is scoped to *hostile-page-reachable* vectors.
- Download path traversal (F4/F5), `poster` CSS injection (F6), `open-external` (F3), and `containers.json` validation (F7) — each verified by its own leg's checks, not this spec.
- Correctness of `isSafeTabUrl()`'s scheme classification in isolation — covered by the pure unit test stood up in this flight.

## Variants (optional)

- N/A for the draft. Could later parametrize Step 3/4 over an expanded hostile-scheme list (`chrome:`, `about:config`-style, `blob:` cross-origin) once the predicate stabilizes.
