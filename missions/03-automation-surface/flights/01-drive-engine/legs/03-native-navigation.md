# Leg: native-navigation

**Status**: completed
**Flight**: [Drive Engine (input / nav / tabs)](../flight.md)

## Objective

Give the engine native navigation control over a resolved `webContents` — `navigate(wcId, url)`
(re-applying `isSafeTabUrl` before `loadURL`) plus `back` / `forward` / `reload` — closing the
main-process `loadURL` hostile-URL bypass that `will-navigate` does not cover.

## Context

- **DD6** — `will-navigate` (`main.js:169 — "contents.on('will-navigate', ...)"`) only fires for
  **renderer-initiated** navigation; a main-process `wc.loadURL()` bypasses it (confirmed by the M02
  Flight-4 spike). So the engine's `navigate` entry point **must re-apply `isSafeTabUrl`** itself,
  reusing `src/shared/url-safety.js` — otherwise the engine is a hostile-URL bypass, a mission hard
  constraint. `goldfinch://` internal URLs are not a valid engine navigate target: `isSafeTabUrl`
  rejects them (`url-safety.js:15 — "function isSafeTabUrl(url)"` allows only http/https/about:blank),
  and the internal guest is unreachable anyway (DD5 / Leg 1 `resolveContents` rejects it).
- **DD5** — every act/nav call resolves through Leg 1's `resolveContents`, which rejects internal /
  bad-handle / dead contents. Navigation is an "act" call: it resolves the target first.
- **DD8** — debugger-free. Navigation uses `wc.loadURL` / `wc.goBack` / `wc.goForward` / `wc.reload`
  only — no `webContents.debugger`.
- **SC1** — the client can navigate a tab (open a URL; back / forward / reload), reflected in the live
  UI. This leg delivers the native capability; the attach half + behavior-test backing land in
  Flights 3 / 6.
- **Pattern continuity** — engine functions take **injected** Electron handles (`fromId`,
  `chromeContents`), mirroring `resolve.js` / `tabs.js`, so the logic is unit-testable with a fake
  `webContents` and the real binding is wired in the glue (Leg 5).

## Inputs

What exists before this leg runs:
- `src/main/automation/resolve.js` (Leg 1) — `resolveContents(wcId, { fromId, chromeContents })`.
- `src/shared/url-safety.js` — `isSafeTabUrl(url)` (`url-safety.js:15`), already exported for CommonJS
  (`url-safety.js:116-117`) and unit-tested (`test/unit/url-safety.test.js`).
- `webContents` instances expose `loadURL(url) → Promise`, `goBack()`, `goForward()`, `reload()`,
  `canGoBack()`, `canGoForward()` (Electron `^42` API).

## Outputs

What exists after this leg completes:
- `src/main/automation/nav.js` — **new**: `navigate`, `goBack`, `goForward`, `reload` engine
  functions taking injected deps; `navigate` re-applies `isSafeTabUrl`.
- `test/unit/automation-nav.test.js` — **new**: unit tests over a fake `webContents` + fake `fromId`,
  covering the URL gate, the resolve-rejection passthrough, and the back/forward/reload dispatch.

## Acceptance Criteria

- [x] **AC1** — `navigate(wcId, url, { fromId, chromeContents })` rejects (throws) when `url` is not
  `isSafeTabUrl`-safe — including `goldfinch://settings`, `file:`, `data:`, `javascript:`, and
  non-strings — with a distinct `bad-url` message, **before** any `loadURL` side effect. The URL gate
  is checked even if the `wcId` is also invalid (a clearly-distinguishable error either way).
  (Non-strings cause `isSafeTabUrl` to return `false`, so they fall through the same `if (!isSafeTabUrl(url))`
  gate — **no separate `typeof url` guard is needed** in `navigate`.)
- [x] **AC2** — On a safe `url` and a valid target, `navigate` resolves the target via
  `resolveContents` (so an internal-session / bad / dead `wcId` is rejected, DD5) and then calls
  `wc.loadURL(url)`, returning/await-ing its result.
- [x] **AC3** — `goBack`, `goForward`, `reload` each take `(wcId, { fromId, chromeContents })`,
  resolve the target via `resolveContents`, and dispatch to `wc.goBack()` / `wc.goForward()` /
  `wc.reload()` respectively. An internal/bad/dead `wcId` is rejected by `resolveContents` (no
  navigation side effect).
- [x] **AC4** — `nav.js` is `// @ts-check`, `'use strict';`, imports `isSafeTabUrl` from
  `../shared/url-safety` and `resolveContents` from `./resolve`; no `webContents.debugger` use (DD8);
  no top-level `require('electron')` (handles injected).
- [x] **AC5** — `test/unit/automation-nav.test.js` covers: unsafe-URL reject (incl. `goldfinch://`),
  safe-URL → `wc.loadURL` called with the exact URL, internal-`wcId` reject (reusing a fake internal
  contents), bad/dead handle reject, and `goBack`/`goForward`/`reload` dispatch to the right `wc`
  method. Uses fake `wc`/`fromId` — no live Electron. Full suite `node --test test/unit/*.test.js` green.
- [x] **AC6** — `npm run typecheck` and `npm run lint` clean.

## Verification Steps

- `node --test test/unit/automation-nav.test.js` — new tests pass.
- `npm test` — full unit suite green.
- `npm run typecheck` / `npm run lint` — clean.
- Manual read: confirm `navigate` calls `isSafeTabUrl` **before** `loadURL`, and that no
  `webContents.debugger` appears in `nav.js`.
- (Deferred to Leg 6 live smoke) drive `navigate`/`goBack`/`goForward`/`reload` on a foregrounded
  guest and observe the live UI update; confirm `navigate` to a `goldfinch://settings` URL is rejected.

## Implementation Guidance

1. **Create `src/main/automation/nav.js`** with the standard header:
   ```js
   // @ts-check
   'use strict';
   const { isSafeTabUrl } = require('../../shared/url-safety');
   const { resolveContents } = require('./resolve');
   ```
   (Confirm the relative path to `shared/url-safety` from `src/main/automation/` — it is
   `../../shared/url-safety`.)

2. **`navigate`**:
   ```js
   async function navigate(wcId, url, { fromId, chromeContents }) {
     if (!isSafeTabUrl(url)) {
       throw new Error('automation: bad-url — refusing to navigate to an unsafe URL: ' + String(url));
     }
     const wc = resolveContents(wcId, { fromId, chromeContents }); // throws on internal/bad/dead
     return wc.loadURL(url);
   }
   ```
   URL gate **first** (cheap, no side effect, the DD6 control), then resolve, then `loadURL`.

3. **`goBack` / `goForward` / `reload`**:
   ```js
   function goBack(wcId, { fromId, chromeContents }) {
     const wc = resolveContents(wcId, { fromId, chromeContents });
     return wc.goBack();
   }
   // goForward → wc.goForward(); reload → wc.reload()
   ```
   Keep them thin; `resolveContents` is the single guard. (Electron's `goBack`/`goForward` are no-ops
   when there is no history — no extra `canGoBack` guard required for v1; note it in Edge Cases.)

4. **Export** `module.exports = { navigate, goBack, goForward, reload };` — plain CommonJS, matching
   `resolve.js` / `tabs.js`. `nav.js` is main-process only (never renderer-loaded), so do **not** add
   the dual global-assignment branch that `url-safety.js` uses.

5. **Tests (`test/unit/automation-nav.test.js`)** — mirror the `automation-tabs`/`automation-resolve`
   style. Fake `wc` with spy methods (`loadURL`/`goBack`/`goForward`/`reload` recording calls;
   `loadURL` returns a resolved promise). Fake `fromId` mapping wcIds → fake contents (one internal via
   `{ session: { __goldfinchInternal: true } }`, one normal web contents, one dead via
   `isDestroyed: () => true`). Assert:
   - `navigate(id, 'https://example.com', deps)` → `wc.loadURL` called once with `'https://example.com'`.
   - `navigate(id, 'goldfinch://settings', deps)` → throws `bad-url`, `loadURL` NOT called.
   - `navigate(id, 'javascript:alert(1)', deps)` and a non-string → throws `bad-url`.
   - `navigate(internalId, 'https://ok.com', deps)` → throws `internal-session` (resolve guard),
     `loadURL` NOT called (URL is safe, so it passes the gate and the resolve guard fires).
   - `goBack/goForward/reload(id, deps)` → the matching `wc` method called once; internal/dead id rejects.

## Edge Cases

- **Unsafe URL + invalid wcId together** — the URL gate fires first (`bad-url`), so the caller learns
  the URL is the problem; this is fine (resolving an invalid wcId would also have failed). Deterministic
  ordering, documented.
- **`goBack`/`goForward` with no history** — Electron treats these as no-ops; the engine does not
  pre-check `canGoBack()`/`canGoForward()` in v1 (a no-op is an acceptable outcome). If a "nothing to
  go back to" signal is wanted later, add a `canGoBack()` guard — flagged, not built now.
- **`loadURL` rejection** (network failure, aborted load) — `navigate` returns the `loadURL` promise;
  its rejection propagates to the caller. The engine does not swallow it. (Electron rejects `loadURL`
  on `ERR_ABORTED` for some in-page cases — acceptable to surface for v1; note for Leg 6 smoke.)
- **`about:blank`** — `isSafeTabUrl` allows it (case-insensitive); a **deliberately** valid navigate
  target for v1 (e.g. "clear a tab's content"). No guard blocks it.

## Files Affected
- `src/main/automation/nav.js` — **new**: navigate/back/forward/reload with re-applied URL safety.
- `test/unit/automation-nav.test.js` — **new**: unit tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (batch commit at flight end — do NOT commit, do NOT `[COMPLETE:leg]`)
- [x] Do NOT check off the leg in flight.md yet (batch at flight end)
