# Leg: scheme-registration-and-serving

**Status**: landed
**Flight**: [Internal Page Scheme (`goldfinch://`)](../flight.md)

## Objective
Register `goldfinch://` as a privileged scheme at module load and serve a minimal, accessible
`goldfinch://settings` stub from a **dedicated internal session** via `protocol.handle`, with the
strict CSP set **in the response headers** — proving the serving half of the internal-page mechanism
end to end (the trusted *opening* path is leg 3).

## Context
- **Flight DD2** — `protocol.registerSchemesAsPrivileged([{ scheme: 'goldfinch', privileges: { standard: true, secure: true } }])`
  at **module top level in `main.js`, before `app.whenReady`** (privileged registration must precede
  app ready). Serve via the **session-scoped** `session.fromPartition('goldfinch-internal').protocol.handle('goldfinch', …)`
  (NOT the global `protocol`, which binds the default session), using `net.fetch(pathToFileURL(...))`.
  Map `goldfinch://settings` → `src/renderer/pages/settings.html`; **404 every other host/path**, no
  traversal. There is **no existing `protocol.*` usage** in the codebase — all net-new.
- **Flight DD3** — CSP (`frame-ancestors 'none'` + a tight `default-src`) is set **in the `Response`
  headers the handler returns**, NOT via `onHeadersReceived` (custom-protocol responses bypass the
  `webRequest` pipeline — see `applyShields`/`onHeadersReceived` at `main.js:369`, which would silently
  not fire for these). The internal session is **excluded** from the web-content Shields hooks
  (`applyShields`, `main.js:312`) — they are built for web traffic and have no business on a bundled
  local page (resolves the DD3 open question: exclude).
- **Flight DD6** — the served page is the **real destination** `goldfinch://settings`, a minimal
  accessible stub (`<main>`, `<h1>Settings</h1>`, "coming soon"); Flight 5 enriches the same document.
- **Packaging** — `asar: false`, `files: ["src/**/*"]` (`package.json`), so the stub under `src/`
  ships unpacked and `pathToFileURL(path.join(__dirname, '..', 'renderer', 'pages', 'settings.html'))`
  resolves at runtime in both dev and packaged builds.
- **The `will-navigate` spike (DD4)** is a **live** step that runs at this leg's verification with the
  operator (the harness can't launch the GUI) — inject `<webview partition="goldfinch-internal"
  src="goldfinch://settings">` over CDP and observe whether `will-navigate` fires on load + reload. It
  does NOT block this leg's code; leg 4's guard is written defensively regardless. Record the result in
  the flight log when run.

## Inputs
- `src/main/main.js` with: requires block (`:1-10`), `createWindow` (`:16`), `web-contents-created`
  (`:67`), `applyShields` (`:312`), `session-created` hook (`:519`), `app.whenReady` (`:524`). No
  `protocol.*` yet.
- `package.json` (`asar:false`, `files: src/**/*`).
- No `src/renderer/pages/` directory yet.

## Outputs
- `goldfinch://` registered privileged (`{ standard, secure }`) at module load.
- A dedicated internal session (`goldfinch-internal` partition) excluded from `applyShields`, with
  `protocol.handle('goldfinch', …)` serving the stub and 404ing everything else.
- `src/renderer/pages/settings.html` — minimal accessible stub.
- The served response carries `Content-Security-Policy: …; frame-ancestors 'none'` and
  `Content-Type: text/html`.
- Offline gates green; the live serving + spike + CSP read-back are leg-6 / operator steps.

## Acceptance Criteria
- [ ] `protocol.registerSchemesAsPrivileged([{ scheme: 'goldfinch', privileges: { standard: true, secure: true } }])`
  is called at **module top level**, before `app.whenReady` runs. (`protocol` added to the electron
  require at `main.js:3`.)
- [ ] Inside `whenReady`, a dedicated internal session is created
  (`session.fromPartition('goldfinch-internal')`), **excluded from BOTH `applyShields` AND
  `wireDownloadHandler`**, and `internalSession.protocol.handle('goldfinch', handler)` is registered on
  it (session-scoped, not the global `protocol`).
- [ ] The handler serves **only** `goldfinch://settings` (host `settings`, root path) →
  `src/renderer/pages/settings.html` via `net.fetch(pathToFileURL(...))`; **every other host/path
  returns a 404 `Response`**. The file path is a **fixed host→file map**, not built from the URL path
  (so traversal is structurally impossible). Non-GET methods → 405 or 404.
- [ ] The served `Response` sets `Content-Type: text/html; charset=utf-8` and a strict
  `Content-Security-Policy` including **`frame-ancestors 'none'`** and a tight `default-src` (e.g.
  `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`), set **in the
  Response headers** (DD3) — not via `onHeadersReceived`.
- [ ] **The exclusion is driven by a module-scoped flag checked INSIDE the `session-created` hook
  (`main.js:519`), set immediately BEFORE `session.fromPartition('goldfinch-internal')`** — because
  `fromPartition` emits `session-created` **synchronously, during the call**, before any
  marker-after-creation could be set. The hook, seeing the flag, marks the session
  (`ses.__goldfinchInternal = true`) and **returns without calling either `applyShields` or
  `wireDownloadHandler`**. (Evidence this is the real ordering: `whenReady` already does
  `session.fromPartition(PAGE_PARTITION)` at `main.js:530` then a *redundant* `applyShields` at `:532`
  — redundant only because the hook already fired synchronously at :530; the explicit call survives
  via the `__goldfinchShields` idempotency guard. The internal session takes the identical path.) A
  defensive `if (ses.__goldfinchInternal) return;` at the top of `applyShields` is kept as
  belt-and-suspenders, NOT as the primary mechanism.
- [ ] `src/renderer/pages/settings.html` exists: a valid HTML document with `<main>`, a single
  `<h1>Settings</h1>`, placeholder text ("coming soon"), `<title>Settings — Goldfinch</title>`, and
  **no inline `<script>`** (and no inline style that would force `unsafe-inline` — if any styling is
  needed, either omit it for the stub or serve a `settings.css` by extending the handler's allowlist;
  prefer omitting for the minimal stub). It must satisfy the strict CSP.
- [ ] `main.js` changes are JSDoc/type-clean (it's typecheck-covered — `src/**`): `npm run typecheck`
  → 0. No `Electron.*` type breakage from the new `protocol`/`net` usage.
- [ ] Offline gates green: `npm test` (147, unchanged — pure main-process/asset additions, no
  `src/shared` or `test/unit` touched), `npm run typecheck` → 0, `npm run lint` → 0.

## Verification Steps
- `npm run typecheck` → 0 (main.js is in tsc scope; confirm the `protocol`/`net`/`pathToFileURL`
  additions typecheck).
- `npm run lint` → 0; `npm test` → 147 unchanged.
- **Static read-through**: registration is before app-ready; the handler's host/path allowlist is exact
  and traversal-proof (fixed map, not path-derived); CSP is on the Response; the internal session is
  excluded from `applyShields`; the stub satisfies the CSP (no inline script/style).
- **Deferred to leg 6 / operator (live)**: `npm run dev:debug`; inject the internal webview over CDP and
  confirm the stub renders; **read back the served CSP** over CDP (DD3 — a dropped policy must fail);
  run the **`will-navigate` spike** (DD4) and log whether it fires on load + reload; confirm a 404 for
  `goldfinch://nope`.

## Implementation Guidance

1. **Register the scheme at module load** (`main.js`, top level after requires)
   - Add `protocol` (and `net`) to the electron destructure (`main.js:3`).
   - `protocol.registerSchemesAsPrivileged([{ scheme: 'goldfinch', privileges: { standard: true, secure: true } }]);`
     placed at top level (NOT inside `whenReady`/`createWindow`) so it runs before app ready.
   - `const { pathToFileURL } = require('url');` (add to requires).

2. **Create + isolate the internal session, register the handler** (inside `app.whenReady().then(...)`, `main.js:524`)
   - Use a **module-scoped flag** to make the `session-created` hook skip the internal session — set it
     BEFORE `fromPartition` (the hook fires synchronously inside that call):
     ```js
     // module scope
     let creatingInternalSession = false;
     // ... in whenReady:
     creatingInternalSession = true;
     const internalSession = session.fromPartition('goldfinch-internal'); // emits session-created NOW
     creatingInternalSession = false;
     internalSession.__goldfinchInternal = true; // belt-and-suspenders for any later applyShields call
     internalSession.protocol.handle('goldfinch', handleInternal);
     ```
   - The `session-created` hook (step 4) reads `creatingInternalSession` and returns early, skipping
     BOTH `applyShields` and `wireDownloadHandler`.

3. **The handler** (`handleInternal(request)`)
   - Parse `const url = new URL(request.url);`. Accept only `url.host === 'settings'` and a root path
     (`url.pathname === '/' || url.pathname === ''`) and `request.method === 'GET'`. Everything else →
     `new Response('Not found', { status: 404 })` (or 405 for wrong method).
   - For the one allowed page: `const file = path.join(__dirname, '..', 'renderer', 'pages', 'settings.html');`
     (a FIXED path — not derived from `url.pathname`), then **inside try/catch**
     `const res = await net.fetch(pathToFileURL(file).toString());` and return
     `new Response(res.body, { headers })` with explicit `headers`: `Content-Type: text/html; charset=utf-8`
     and the strict CSP. (`res.body` is a `ReadableStream`, accepted by the `Response` constructor;
     re-wrap so you control the headers — don't return `net.fetch`'s headers verbatim.) **On any
     `net.fetch` rejection, return a 404/500 `Response`, never let it throw** inside `protocol.handle`
     (an unhandled throw yields a failed load with no diagnostics).
   - Keep a small `INTERNAL_PAGES` map comment so adding a page later (Flight 5) is an explicit allowlist
     edit, not a directory passthrough. Note in a comment that **`standard: true` is load-bearing for
     the host-based routing** (`new URL('goldfinch://settings').host === 'settings'` only parses that way
     for a `standard` scheme) — so the privileges must not be "simplified" away.

4. **Exclude the internal session in the `session-created` hook** (`main.js:519-522`)
   - Change the hook to skip BOTH wirings for the internal session, gated by the module flag from step 2:
     ```js
     app.on('session-created', (ses) => {
       if (creatingInternalSession) { ses.__goldfinchInternal = true; return; }
       applyShields(ses);
       wireDownloadHandler(ses);
     });
     ```
   - Additionally add a defensive `if (ses.__goldfinchInternal) return;` at the top of `applyShields`
     (`main.js:312`) as belt-and-suspenders — but the hook-level skip is the PRIMARY mechanism (the
     `applyShields`-only marker can't work: the hook fires during `fromPartition`, before any
     post-creation marker is set).

5. **The stub page** (`src/renderer/pages/settings.html`, new dir)
   - Minimal, accessible, CSP-safe: `<!doctype html>`, `<html lang="en">`, `<title>Settings — Goldfinch</title>`,
     `<main><h1>Settings</h1><p>Coming soon.</p></main>`. No inline script. Avoid inline style for the
     stub (Flight 5 will add a served stylesheet under the scheme).

6. **Do NOT** wire the trusted-open path, `isInternalPageUrl`, the internal preload, or the
   `will-attach-webview` isolation here — those are leg 3. Do NOT touch `renderer.js`. Do NOT run the
   live spike (operator/leg 6).

## Edge Cases
- **Scheme registered but handler on the wrong (default) session**: the page would fail to load on the
  internal partition. Register on `internalSession.protocol`, and ensure the leg-3 webview uses the
  exact same `'goldfinch-internal'` partition string.
- **`net.fetch` of a `file:` URL**: requires the privileged scheme + post-ready; the handler runs
  post-ready so this is fine. If `net.fetch` rejects (missing file), return a 404/500 Response rather
  than throwing (an unhandled throw in `protocol.handle` yields a failed load with no diagnostics).
- **Trailing slash / query** on `goldfinch://settings/` or `goldfinch://settings?x=1`: decide
  explicitly (accept root with optional trailing slash; ignore query) — keep it strict but not
  brittle for a reload.
- **CSP too strict for the stub**: `default-src 'self'` blocks inline script/style; the stub avoids
  both, so it renders. If a later style is needed, serve CSS via the handler (allowlist), not inline.
- **Exclusion ordering (the real trap)**: `session-created` fires **synchronously inside
  `fromPartition`**, before any post-creation marker is set — so a marker-after-creation approach
  silently fails and the internal session gets all the web hooks. The module-flag-before-`fromPartition`
  (steps 2 + 4) is mandatory; the `applyShields` marker check is only defense-in-depth.

## Files Affected
- `src/main/main.js` — `protocol`/`net`/`pathToFileURL` requires; `registerSchemesAsPrivileged` at load;
  internal session + handler + exclusion marker in `whenReady`; `applyShields` early-return.
- `src/renderer/pages/settings.html` — NEW minimal stub.
- (No `renderer.js`, no `src/shared`, no `test/unit`, no `package.json`/`mission.md`.)

---

## Post-Completion Checklist

**Batched-commit flight: implement + update artifacts, do NOT commit; signal `[HANDOFF:review-needed]`.**

- [ ] All acceptance criteria verified (static + offline gates; live serving/spike/CSP-readback → leg 6)
- [ ] Offline gates passing (`npm test` / `typecheck` / `lint`)
- [ ] Update flight-log.md with leg progress entry (note the spike + CSP read-back are pending live)
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; signal `[HANDOFF:review-needed]`
