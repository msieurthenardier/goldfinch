# Leg: auth-challenges

**Status**: landed
**Flight**: [Main-Process Wiring — Fullscreen, Auth Challenges, Inline PDF](../flight.md)

## Objective

Wire HTTP auth challenges end to end per flight DD2 + DD3: `app.on('login')` → per-window serialized pending-challenge store → chrome-owned `auth-basic` sheet with a dual-zeroized credential channel, plus the vault-mediated agent answer path (`vaultAnswerAuth`).

## Context

- DD2 (flight.md): every-callback-answered with **two lifecycles** — *resolution* (submit / Esc / outside-click / explicit cancel / tab close / window close / cross-window move / navigation-away) vs *occlusion* (blur / superseded / tab-hide / fullscreen-enter → re-present from the queue). Proxy challenges (`authInfo.isProxy`) cancel silently. Contents-less challenges null-checked and cancelled. Agent-answered challenges close the sheet with a **resolution-family** reason so the queue doesn't re-present.
- DD3: `vaultAnswerAuth` mirrors `vaultFill` — all enforcement in `vault-context` (`resolveTarget` jar scoping, `resolveItem`, `originMatches`), effect via an injected delegate, credential never crosses the MCP boundary.
- Leg 01 landed: `htmlFullscreen` mode exists on the WindowRecord; fullscreen-enter closes the sheet (occlusion bucket). The web-compat fixture server exists (`tests/behavior/fixtures/web-compat/serve.mjs`) — this leg extends it.
- **Apparatus note (flight-log anomaly)**: window-level captures are unavailable under this session's jar-scoped MCP identity; behavior runs needing sheet visibility will be attempted and, if blocked, carry the same deferred disposition as leg 01's run. Unit coverage is the leg's hard gate.

## Inputs

- Leg 01 landed (uncommitted, on `flight/01-main-process-wiring`); `npm test` 2869 green, lint/typecheck clean.
- Draft behavior spec `tests/behavior/web-compat-basic-auth.md`; fixture server with `--log` JSONL support.
- Vault machinery: `vault-context.js`, `VAULT_TOOLS` (`mcp-tools.js:619`), `WCID_FIRST_CUSTOM_JAR_OPS = ['vaultFill']` (`scope.js:84`), zeroized-channel discipline (`register-overlay-ipc.js:91` `menu-overlay:vault-unlock`).

## Outputs

- New `src/main/auth-challenges.js` (Electron-free DI store) + unit tests
- `app.on('login')` in `app-lifecycle.js`; navigation-away invalidation wiring
- `auth-basic` sheet template + full registry/dispatch/state/a11y integration; `menu-overlay:auth-submit` zeroized channel
- Optional `onClosed` observer hook on the menu-overlay manager (close-reason → lifecycle-bucket mapping)
- `vaultAnswerAuth` MCP tool + `vault-context.answerAuth` + injected `answerAuthDelegate`
- Fixture `/protected` endpoint (401 → `WWW-Authenticate: Basic realm="fixture"`, validates `fixtureuser`/`fixturepass`, echoes username only, JSONL-logs Authorization presence)
- Behavior spec `web-compat-basic-auth` → `active`; run attempted by FD
- Planned pin bumps: `RENDERER_LINE_BUDGET` (renderer.js is at exactly 1700/1701) and `SEAM_COUNT = 29` (`test/unit/seam-contract.test.js:58,65`), justified in the commit

## Acceptance Criteria

- [x] A guest navigation hitting HTTP basic auth produces exactly one sheet prompt (host + realm shown) on the owning window when that tab is active; the load neither hangs nor cancels while the prompt is pending
- [x] Submit resolves the challenge with credentials via `menu-overlay:auth-submit` following the zeroized discipline verbatim (sender identity via `recordForSheetSender`, token gate, `Buffer.from` copy, `finally` zeroize of both copies); credentials never transit channel-4 `activated` and never reach any page DOM
- [x] Every close reason maps to its DD2 bucket and the mapping is unit-pinned: `escape`/`outside-click`/`activated`(cancel button)/`tab-close`/`teardown` → resolve-cancel; **any unlisted/unknown reason → resolve-cancel (fail-safe, pinned)**; `blur`/`superseded`/`tab-hide`/`tab-switch` → challenge survives and re-presents at the next trigger (tab activation, **window refocus**, **fullscreen exit**, or queue event) — incl. the model-replace `'superseded'` path that bypasses `closeMenuOverlay`
- [x] Navigation away (`did-start-navigation` on the challenge's wcId) cancels that tab's pending challenges; cross-window move cancels; a source-scan-style unit test pins that no code path abandons a callback (every callback resolved exactly once)
- [x] `authInfo.isProxy` and contents-less/non-guest challenges cancel silently (unit-pinned)
- [x] Concurrent challenges on one window queue FIFO and present one at a time; challenges for background tabs hold until their tab activates
- [x] `vaultAnswerAuth({wcId, itemId, vaultId?})`: enforces jar membership (`resolveTarget`), item type `login`, `originMatches` against the challenge's host/url; returns `{answered:true}` on success and `{answered:false, reason}` for locked / no-challenge / no-match / origin-mismatch / ambiguous; the credential appears in no tool result and no audit log; registered in `WCID_FIRST_CUSTOM_JAR_OPS`; audit-detail entry added alongside `vaultFill`'s
- [x] Agent answer closes a visible sheet for that challenge with a resolution-family reason (no re-present)
- [x] a11y: `auth-basic` joins the audit sheet matrix (`SHEET_STATES` + audit driver seam); labeled fields, keyboard-reachable (existing modal-card contract)
- [x] `npm test`, `npm run lint`, `npm run typecheck` pass; seam-contract pin bumps are deliberate and justified in the flight log
- [x] Behavior spec `web-compat-basic-auth` active; FD run attempted (pass, or apparatus-blocked with deferred disposition recorded in the run log and flight log). Carry-forward: FD attempts the existing vault-login behavior re-run under the same disposition rules

## Verification Steps

- `node --test test/unit/auth-challenges.test.js` (new) and full `npm test && npm run lint && npm run typecheck`
- Manual fixture check: `node tests/behavior/fixtures/web-compat/serve.mjs --port 8091 --log /tmp/fixture.jsonl` then `curl -u fixtureuser:fixturepass http://127.0.0.1:8091/protected` (200, username echoed) and `curl http://127.0.0.1:8091/protected` (401 with `WWW-Authenticate`)
- `/behavior-test web-compat-basic-auth` (FD-run)

## Implementation Guidance

1. **Store module `src/main/auth-challenges.js`** — `createAuthChallenges({ registry, logger })`:
   - `handleLogin(webContents, details, authInfo, callback)`: null-check `webContents` (can be undefined) → cancel; `authInfo.isProxy` → cancel; `registry.getWindowForGuest(webContents.id)` null (chrome/sheet/DevTools/favicon fetches) → cancel. Otherwise mint an opaque `challengeId`, enqueue `{challengeId, wcId, host: authInfo.host, port, scheme, realm: authInfo.realm, url: details.url, state: 'pending'}` on the owning window's FIFO, and present if eligible (its tab is `activeTabWcId` and no other challenge is showing on that window).
   - "Cancel" is always `resolveOnce(challengeId, null)`; submit is `resolveOnce(challengeId, {username, password})`. `resolveOnce` guards exactly-one resolution (ledger), calls the Electron `callback` with or without args, dequeues, and presents the next eligible challenge.
   - `cancelForTab(wcId, reason)` (navigation/tab-close/move), `cancelForWindow(record)` (window close/teardown — cancels the **whole queue**, not just the presented head), `notifySheetClosed(record, menuType, reason)` (bucket mapping), `notifyTabActivated(record, wcId)`, `notifyWindowFocused(record)` (**mandatory** per DD2 "re-presents on refocus" — window blur closes the sheet with no tab-activation counterpart), `notifyFullscreenExited(record)`, `answerWithCredential(wcId, credential)` → resolves that tab's presented/pending head challenge; returns `{answered, reason?}` and closes the sheet with a resolution-family reason (`'activated'`).
   - **Keying (design ruling)**: the store keys its **presented challenge per window record** — no token→challengeId map. The sheet token stays what it already is: the manager/IPC freshness gate (`getCurrentMenu` check in the invoke handler). `notifySheetClosed` and the auth-submit handler both carry window identity natively (the manager is per-record; `recordForSheetSender` resolves the record), which also sidesteps token collisions across windows (tokens are per-chrome monotonic counters).
   - **Bucket mapping (complete)**: resolution → `escape`, `outside-click`, `activated`, `tab-close`, `teardown`, plus **any unlisted/unknown reason (fail-safe default: resolve-cancel — never a hung callback, pinned)**; occlusion → `blur`, `superseded`, `tab-hide`, `tab-switch`. The store filters `menuType === 'auth-basic'` for its own lifecycle; closes of **other** menus are ignored entirely (no re-present-stealing — ruling per edge case below). Re-present triggers are exactly: `notifyTabActivated`, `notifyWindowFocused`, `notifyFullscreenExited`, and queue events (a resolution dequeuing the head). Max re-presentation staleness = the gap until the next such trigger.
   - **Presentation eligibility**: the challenge's tab is `activeTabWcId`, no other challenge is showing on that window, `record.htmlFullscreen` is not set (a challenge arriving mid-fullscreen holds, like tab-hidden; presents on fullscreen exit), **and `!record.sheet?.isMenuOpen()`** — a re-present must never model-replace an open menu. Critical case (pinned in the store matrix): the dismiss-locked one-time-key sheets (`vault-recovery-show` family) ignore `'blur'` and survive an app-switch, but ARE hard-closed by `'superseded'` — a `notifyWindowFocused` re-present over one would destroy an unrecoverable one-time key. The held challenge waits for the next trigger instead.
   - Presentation is chrome-mediated to reuse the standard open flow and bounds snapshot (precedent: `vault-recovery-show`/`vault-accesskey-show` main→chrome sends riding `openOverlayMenu`): `chromeForTab(wcId)?.send('auth-challenge-present', { wcId, host, realm })`; the chrome opens the sheet through the existing `menu-overlay:open` path with `menuType: 'auth-basic'`, `dismissible: true`. Add `chromeForTab` to the store's deps.
2. **Manager close-observer**: `createMenuOverlayManager` gains an optional `onClosed({ menuType, reason })` dep, invoked on **both** close-emit paths: inside `closeMenuOverlay` after the channel-7 emit AND in `openMenu`'s model-replace branch (`menu-overlay-manager.js:262-266` emits `'superseded'` directly via `sendToChrome` without calling `closeMenuOverlay` — hooking only `closeMenuOverlay` would stall the queue on exactly the occlusion case the store depends on). The mapping must be path-agnostic (`'superseded'` also arrives through `closeMenuOverlay` from the accelerator path, `window-factory.js:143`). Threaded at the construction site in `window-factory.js:216-236`, closing over `record` so the store gets window identity. Unit test pins both emit paths fire the hook.
3. **`app.on('login')`** in `registerAppLifecycle` (top-level, beside the other `app.on` registrations — NOT inside `whenReady`): `event.preventDefault()` always, then `authChallenges.handleLogin(webContents, details, authInfo, callback)`. `handleLogin` also excludes internal-session guests via the `session.__goldfinchInternal` marker (symmetry with DD4; practically unreachable, pinned anyway). Thread `authChallenges` through the deps object from `main.js`.
4. **Invalidation + re-present wiring**: in `wireTabViewEvents` (`guest-wiring.js`), add `wc.on('did-start-navigation', guard((e) => { if (e.isMainFrame && !e.isSameDocument) authChallenges.cancelForTab(wcId, 'navigated'); }))` — main-frame, non-same-document only. In `register-tab-ipc.js`: `tab-close` → `cancelForTab`; `moveTabIntoWindow` → `cancelForTab` at move time (flight DD2 ruling); `tab-set-active` → `notifyTabActivated`. In `window-factory.js`: `win.on('focus')` → `notifyWindowFocused(record)` (new hook — the blur counterpart at `:298` already closes the sheet); `win.on('close')` teardown (`:241-245`) → `cancelForWindow(record)` (load-bearing: the sheet's own `'teardown'` close only resolves the presented head, not the queue). Fullscreen exit: `createHtmlFullscreen` gains an optional `onExited(record)` callback dep (same additive pattern as the manager's `onClosed`); `main.js` wires it to `notifyFullscreenExited`.
5. **Sheet template** `src/shared/auth-basic-template.js` (modal-card family, `attachModalCard`): host + realm text, username input, password input, Submit + Cancel. Follow the mechanical checklist: import + `TEMPLATES` entry (`menu-overlay.js:1811`) + `NODE_OF_ENTRY` + dispatch branch; sheet state entry in `renderer.js` incl. the `auth-challenge-present` main→chrome listener that calls the standard open path; preload channel `menu-overlay:auth-submit` (`menu-overlay-preload.js`); handler in `register-overlay-ipc.js` cloning the `vault-unlock` discipline byte for byte (`:91-112` shape) with payload `{ token, username: string, secret: Uint8Array }` → the handler runs the freshness gate (`getCurrentMenu` token check) and resolves the record via `recordForSheetSender`, then calls `authChallenges.answerFromSheet(record, username, buf)` (record-shaped, matching `notifySheetClosed` — the store holds no tokens) then `finally` zeroize. Cancel button rides channel-4 `activated` with a non-secret id (`'cancel'`).
6. **`vault-context.answerAuth`**: mirror `fill` (`vault-context.js:416+`): touch/revalidate → locked check → `resolveTarget(identity, wcId, engineDeps)` (`:373`) → query the injected `getPendingChallenge(wcId)` (from the auth store) → no challenge → `{answered:false, reason:'no-challenge'}` → `resolveItem(itemId, vaultId, item => item.type === 'login')` → `originMatches(found, challengeOrigin, {widen:true})` where **`challengeOrigin = originOf(challenge.url)`** — the same helper `fill` uses at `vault-context.js:423`. (**Never** build the origin from `authInfo.scheme` — that field is the *auth* scheme, `'basic'`, not the URL scheme; `authInfo.host/port` are kept for display only.) Mismatch → `origin-mismatch` → hand `{wcId, credential}` to injected `answerAuthDelegate` → `{answered:true, id, origin}`. Credential never in the return.
7. **MCP tool** `vaultAnswerAuth` in `VAULT_TOOLS` (`mcp-tools.js:619+`), `usesEngine:false`, schema `{wcId, itemId, vaultId?}`; add to `WCID_FIRST_CUSTOM_JAR_OPS` (`scope.js:83`); audit-detail entry beside `vaultFill`'s in `mcp-server.js` (records resolved origin, never the credential). Wire `answerAuthDelegate` + `getPendingChallenge` in `main.js` beside `fillDelegate` (`main.js:908`).
8. **Fixture**: add `/protected` to `serve.mjs` per Outputs, with `Cache-Control: no-store` (matching existing endpoints, so repeat navigations reliably re-challenge); JSONL-log each request's path + whether a syntactically valid `Authorization: Basic` header arrived and whether it matched (never log the header value itself — the log is committed-spec-adjacent evidence).
8b. **Close-site and ordering discipline**: the **store owns sheet-closing** — `answerFromSheet` and `answerWithCredential` both resolve the ledger **first**, then call `closeMenuOverlay('activated')`; the IPC handler never closes the sheet itself (single close site, no drift). The ledger-before-close ordering is unit-pinned on both paths: the trailing `'activated'` close notification maps to resolve-cancel (cancel button semantics), and only the exactly-once ledger prevents it from cancelling a just-answered challenge. Acknowledged side effect: an agent-driven close triggers `focusChrome` (`menu-overlay-manager.js:329`) — OS focus moves to the chrome; accepted.
9. **a11y + pins**: `SHEET_STATES` entry + audit driver seam for `auth-basic` (vault-sheet precedent in `renderer.js:1659,1693` region); bump `RENDERER_LINE_BUDGET` and `SEAM_COUNT` in `test/unit/seam-contract.test.js` (`:58`, `:65`) minimally, with one-line justifications in the flight-log leg entry.
10. **Unit tests**: store matrix (every bucket from AC 3-6; exactly-once ledger incl. double-submit and submit-after-cancel; FIFO + background-tab hold + re-present), app-lifecycle login registration + preventDefault + routing, overlay-ipc auth-submit (identity/token/zeroize — clone the vault-unlock test shape), manager onClosed hook, vault-context answerAuth (locked, out-of-jar throw passthrough, no-challenge, ambiguous, origin-mismatch, success, credential-absence in result), scope registration, source-scan no-abandoned-callback pin.

## Edge Cases

- **Two tabs, simultaneous challenges**: each window queue independent; within a window, second challenge waits for first's resolution.
- **Subresource challenge mid-page**: presents like a navigation challenge; its tab's `did-start-navigation` (main-frame) cancels it.
- **Challenge while fullscreen** (leg 01 interplay): fullscreen-enter closes the sheet → occlusion bucket; a challenge arriving mid-fullscreen holds (presentation eligibility); both re-present via `notifyFullscreenExited` — unit-pin this interplay.
- **Sheet superseded by vault picker or any other menu**: occlusion; other menus' closes are **ignored** by the store (ruling — no re-present-stealing); the challenge re-presents at the next trigger (`notifyTabActivated` / `notifyWindowFocused` / `notifyFullscreenExited` / queue event). That trigger gap is the documented max re-presentation staleness.
- **Agent answers while sheet is open**: sheet closes (`'activated'` family), no re-present, exactly-one resolution.
- **Wrong credentials**: server re-challenges → Electron fires `login` again → new challenge, new prompt (standard browser behavior); ledger treats it as a distinct challenge.
- **App quit with pending challenges**: `cancelForWindow` on teardown; no hanging callbacks (unit-pinned).

## Files Affected

- `src/main/auth-challenges.js` — new store
- `src/main/app-lifecycle.js` — `app.on('login')` + dep
- `src/main/guest-wiring.js` — `did-start-navigation` invalidation + dep
- `src/main/register-tab-ipc.js` — cancel/notify call sites + dep
- `src/main/menu-overlay-manager.js` — optional `onClosed` observer (both emit paths)
- `src/main/html-fullscreen.js` — optional `onExited` callback dep
- `src/main/window-factory.js` — `onClosed` threading at the manager construction site; `win.on('focus')` hook; `cancelForWindow` in close teardown
- `src/main/register-overlay-ipc.js` — `menu-overlay:auth-submit` + dep
- `src/preload/chrome-preload.js` — `onAuthChallengePresent` bridge method (precedent: `onVaultRecoveryShow` at `:295`); `renderer-globals.d.ts` entry (CLAUDE.md mandate; typecheck gate fails without it)
- `src/main/vault/vault-context.js` — `answerAuth`
- `src/main/automation/mcp-tools.js`, `scope.js`, `mcp-server.js` — tool, scope, audit
- `src/main/main.js` — construct store; thread deps; `answerAuthDelegate`/`getPendingChallenge`
- `src/shared/auth-basic-template.js` — new; `src/renderer/menu-overlay.js`, `src/renderer/renderer.js`, `src/preload/menu-overlay-preload.js` — registry/state/channel
- `scripts/a11y-audit.mjs` surface via `SHEET_STATES` (renderer-side)
- `test/unit/auth-challenges.test.js` (new) + updated suites; `test/unit/seam-contract.test.js` pin bumps
- `tests/behavior/fixtures/web-compat/serve.mjs` — `/protected`; `tests/behavior/web-compat-basic-auth.md` — status flip

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight: update flight.md status to `landed`, check off flight in mission.md

*(Batched workflow: Developer lands, does not commit; behavior runs are FD-owned.)*

## Citation Audit

Verified at leg design time against the post-leg-01 tree (grep): `app-lifecycle.js:75` (`session-created`), `:100` (`web-contents-created`), top-level-registration comment `:80-82`; `main.js:908` (`fillDelegate`, second site; human-path delegate at `:833`); `mcp-tools.js:619` (`VAULT_TOOLS`), `:696` (`TOOLS` composition); `scope.js:84` (`WCID_FIRST_CUSTOM_JAR_OPS = ['vaultFill']`; `:83` is its comment line); `register-overlay-ipc.js:38` (`recordForSheetSender`), `:91` (`menu-overlay:vault-unlock` handler); `vault-context.js:373` (`resolveTarget`), `:422` (fill's use); `menu-overlay.js:1811` (`TEMPLATES`); `renderer.js` = 1700 lines; `seam-contract.test.js:58` (`SEAM_COUNT = 29`), `:65` (`RENDERER_LINE_BUDGET = 1701`). All OK; drift from flight-doc figures repaired here (recordForSheetSender `:38`, fillDelegate `:908`).
