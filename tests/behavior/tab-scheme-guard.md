# Behavior Test: Tab URL scheme guard rejects hostile schemes

**Slug**: `tab-scheme-guard`
**Status**: draft
**Created**: 2026-06-05
**Last Run**: never

## Intent

Verify that a hostile web page cannot cause Goldfinch to load a dangerous-scheme URL (`file:`, `javascript:`, `data:`) into a webview — through any of the three reachable vectors: the `window.open()` path, the media-panel "open as tab" path, and **in-page self-navigation** (`window.location = 'file://…'`) — while a legitimate `https:` `window.open()` still opens normally. This needs a behavior test rather than a unit test because the threat is a *real page* exercising the real enforcement chain inside the running Electron app: `setWindowOpenHandler` → IPC → `createTab` (renderer gate) **and** the main-process `will-navigate` guard. The unit test (`isSafeTabUrl()`) covers the pure predicate, but only the running app proves the predicate is wired into *both* enforcement points and that a `<webview>` never actually navigates to `file://` by any path.

## Preconditions

- Goldfinch is running via `npm run dev:debug` (exposes `--remote-debugging-port=9222 --remote-allow-origins=*`), so the apparatus can attach to both the chrome renderer and webview guest targets.
- A local HTTP trigger page is served (e.g. `python3 -m http.server` in a fixture dir) at a known `http://127.0.0.1:PORT/` URL. The page provides buttons that call `window.open(<scheme-under-test>)` and exposes a crafted media element whose source is `file:///etc/passwd` (to exercise the media-open vector). **Why HTTP, not file://**: the trigger page itself must load over a legitimate scheme so the test isolates the *target* scheme, not the page's own.
- **Active precondition probe** (Step 1 below): confirm port 9222 answers and the trigger page is reachable before exercising any vector — a dead devtools port or unserved fixture otherwise surfaces as a confusing mid-test cascade.

## Observables Required

- browser (rendered tab state — active tab's address bar value, the set of `<webview>` elements and their current URL, and whether any tab visibly renders local file contents — measured via chrome-devtools MCP attached to port 9222; screenshot + a11y tree are primary, DOM `src` reads are supplementary diagnostic)
- shell (precondition probes: port reachability, fixture HTTP 200 — measured via Bash/curl)

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

## Out of Scope

- The address-bar typing path (`toUrl`, user-initiated) — if the guard is extended there, cover it separately; this spec is scoped to *hostile-page-reachable* vectors.
- Download path traversal (F4/F5), `poster` CSS injection (F6), `open-external` (F3), and `containers.json` validation (F7) — each verified by its own leg's checks, not this spec.
- Correctness of `isSafeTabUrl()`'s scheme classification in isolation — covered by the pure unit test stood up in this flight.

## Variants (optional)

- N/A for the draft. Could later parametrize Step 3/4 over an expanded hostile-scheme list (`chrome:`, `about:config`-style, `blob:` cross-origin) once the predicate stabilizes.
