# Leg: html-fullscreen

**Status**: landed
**Flight**: [Main-Process Wiring — Fullscreen, Auth Challenges, Inline PDF](../flight.md)

## Objective

Wire `enter-html-full-screen`/`leave-html-full-screen` so a page's `requestFullscreen()` expands the guest over the chrome to fill the window and restores cleanly on every exit path, per flight DD1.

## Context

- DD1 (flight.md): fullscreen is a **window-record mode** that gates the renderer-driven bounds pipeline. The chrome renderer is the normal single source of bounds truth (`sendActiveBounds` → `tab-set-bounds`); during fullscreen, main becomes the single writer and renderer sends are deferred, not applied.
- The `'fullscreen'` permission is already allowlisted (`src/main/session-runtime.js:14`), so `requestFullscreen()` succeeds page-side today — only the bounds/z-order response is missing.
- Guest bounds changes are **discrete `setBounds` steps, never animated** (CLAUDE.md invariant). Enter and exit are one step each.
- Two mission-13 carry-forwards ride this leg (shared surface): the `__goldfinchNavGuarded` latch-ordering regression test, and the permission-Set comment guard.
- This is the first leg of the flight; nothing is uncommitted before it except mission/flight artifacts and draft behavior specs.

## Inputs

- Clean `flight/01-main-process-wiring` branch; `npm test` / lint / typecheck green (verified at flight start).
- Draft behavior spec `tests/behavior/web-compat-fullscreen.md` (fixture endpoint expectations defined there).
- No `tests/behavior/fixtures/web-compat/` directory yet — this leg creates it.

## Outputs

- New module `src/main/html-fullscreen.js` (Electron-free, DI) + unit tests
- Fullscreen event wiring in `src/main/guest-wiring.js`; deps threaded in `src/main/main.js`
- Bounds-gate integration in `src/main/register-tab-ipc.js`; resize re-expand in `src/main/window-factory.js`
- Force-exit on all exit edges incl. `moveTabIntoWindow`
- New fixture server `tests/behavior/fixtures/web-compat/serve.mjs` with `/video.html` (skeleton extended by later legs)
- Latch regression test + permission-Set comment guard (carry-forwards)
- Behavior spec `web-compat-fullscreen` status `draft` → `active`; run log from a passing run

## Acceptance Criteria

- [x] `requestFullscreen()` on a guest page expands that guest to the full window content bounds in a single `setBounds` step, raised above the chrome view
- [x] Exiting (page exit, Esc, or any force-exit edge) restores the pre-fullscreen bounds in a single `setBounds` step, re-requests renderer bounds (`trigger-send-bounds`) for convergence, and **restores the find overlay** if its session is active on that tab (AC6b mirror: `syncBounds(restoredBounds)` + `show()` — show's re-add also re-asserts z-order)
- [x] While fullscreen, incoming `tab-set-bounds` for the **fullscreen tab** defers (stored as pending, not applied; no `findOverlay`/`sheet` `syncBounds` fan-out); other tabs' bounds apply normally; exit applies `pendingBounds || savedBounds`
- [x] Same-tab `tab-set-active` during fullscreen is a no-op for geometry (bounds deferred as pending, find-restore branch skipped) — MCP `activateTab` on the fullscreen tab must not shrink the guest or re-show overlays
- [x] Window resize (and maximize/unmaximize) during fullscreen re-expands the guest to the new content bounds
- [x] Force-exit edges all restore through one path and are unit-tested: activating a **different** tab, `tab-hide` of the fullscreen tab, **tab close (explicit idempotent cleanup in the `tab-close` handler — the armed gate must never survive its tab, or the window's bounds pipeline wedges)**, window close, and `moveTabIntoWindow` (force-exit ordered **before** the H3 geometry capture; the call must stay synchronous/un-awaited to respect the pinned synchrony invariant)
- [x] Sheet and find overlay are hidden/closed on fullscreen enter (mirroring the `tab-hide` path at `register-tab-ipc.js:663-666`)
- [x] Defensive Esc branch exists in the web `before-input-event` handler, placed before the `if (!(input.control || input.meta)) return;` early-return, no-op unless fullscreen is active for that contents
- [x] Carry-forward 1: a source-scan unit test pins that `contents.__goldfinchNavGuarded = true` is the first statement of `wireGuestContents` with no suspension point before it
- [x] Carry-forward 2: `ALLOWED_PERMISSIONS` (`session-runtime.js:13-22`) carries a comment naming the unit test that pins the shared-Set union, guarding against a "fix the asymmetry" refactor
- [x] `npm test`, `npm run lint`, `npm run typecheck` pass
- [ ] Run `/behavior-test web-compat-fullscreen` and confirm pass (FD runs this after implementation; spec marked `active`)

## Verification Steps

- Unit: `node --test test/unit/html-fullscreen.test.js` (new), plus updated `guest-wiring.test.js`, `register-tab-ipc.test.js` assertions
- Full gates: `npm test && npm run lint && npm run typecheck`
- Behavior: `/behavior-test web-compat-fullscreen` (FD-run; fixture server per spec preconditions)

## Implementation Guidance

1. **New module `src/main/html-fullscreen.js`** — house pattern: Electron-free, zero `require`, DI factory `createHtmlFullscreen({ registry, chromeForTab, logger })` returning:
   - `enter(wcId)`: resolve `registry.getWindowForGuest(wcId)`; refuse (log + return) if no record, destroyed win, or `wcId !== record.activeTabWcId` (a background tab cannot seize the window — ask its page to exit instead); if the window is already fullscreen for another tab, force-exit that first. Snapshot `entry.view.getBounds()` → `record.htmlFullscreen = { wcId, savedBounds, pendingBounds: null }`; one `entry.view.setBounds({ x: 0, y: 0, width, height })` from `record.win.getContentBounds()`; raise via `record.win.contentView.addChildView(entry.view)`; then mirror the tab-hide path (`register-tab-ipc.js:663-666`): hide find overlay, `record.sheet?.closeMenuOverlay(...)` with a reason from the validated set (`'tab-hide'` family).
   - `exit(wcId)`: no-op unless `record.htmlFullscreen?.wcId === wcId`; one `setBounds(pendingBounds || savedBounds)`; clear the mode; restore the find overlay if `record.findOverlay?.isSessionActive(wcId)` (mirror AC6b, `register-tab-ipc.js:763-769`: `syncBounds(restored)` + `show()`); `chromeForTab(wcId)?.send('trigger-send-bounds')` for renderer convergence. (Preload already exposes `onTriggerSendBounds`, `chrome-preload.js:148` — main→chrome send of `'trigger-send-bounds'` is the existing resize-path channel, `window-factory.js:302`.) Ruling: the find session **survives** fullscreen (hide-with-surviving-session on enter, restore on exit) — consistent with the flight's occlusion semantics.
   - `forceExit(record)`: exit for whatever tab holds the mode; ask the live page to leave via `entry.view.webContents.executeJavaScript('document.exitFullscreen()').catch(() => {})` only if not destroyed, then run the same restore. Destroyed contents skip straight to record cleanup. **Must return synchronously** (the page-exit ask is fire-and-forget) — callers include the synchrony-pinned `moveTabIntoWindow`.
   - `isFullscreen(wcId)`: membership query for guest-wiring's Esc branch (no direct record-peeking from guest-wiring).
   - `handleRendererBounds(record, wcId, rounded)`: returns `true` (handled/deferred) only when `record.htmlFullscreen?.wcId === wcId` — stores `pendingBounds = rounded`. For any other tab it returns `false` and the caller applies normally (deliberate: background-tab bounds are harmless to apply; silent drops wedge nothing).
   - `handleWindowResize(record)`: while fullscreen, re-apply full content bounds (one step).
   - API shape is deliberate: `enter`/`exit`/`isFullscreen` take `wcId` (event-driven callers), `forceExit`/`handleRendererBounds`/`handleWindowResize` take `record` (record-holding callers) — do not "normalize."
2. **Wire events** in `wireGuestContents` (`src/main/guest-wiring.js`, web branch only — after the internal-branch early return at `guest-wiring.js:100-106`): `contents.on('enter-html-full-screen', …)` / `'leave-html-full-screen'` → injected `htmlFullscreen.enter/exit(contents.id)`. Add `htmlFullscreen` to the deps destructure (`guest-wiring.js:11-27`) and thread it from `main.js` where `createGuestWiring` is constructed. **Do not disturb the latch**: `contents.__goldfinchNavGuarded = true` stays the first statement (`guest-wiring.js:66-73`).
3. **Esc branch**: in the web `before-input-event` handler, immediately before `if (!(input.control || input.meta)) return;` (`guest-wiring.js:118`): on `input.key === 'Escape'`, non-repeat, if this contents holds the fullscreen mode, call `htmlFullscreen.forceExit`-style page-exit; do not `preventDefault` (the page may also handle it; Blink's own Esc handling firing `leave-html-full-screen` makes `exit` idempotent — pin idempotence in tests).
4. **Bounds gate** in `register-tab-ipc.js`: in the `tab-set-bounds` body, after the rounding at `:817`, consult `htmlFullscreen.handleRendererBounds(owner, wcId, rounded)` and return early when it handled the send — this also skips the `syncBounds` fan-out at `:827-832`. In `tab-set-active` (`:708`), before the swap: if `owner.htmlFullscreen` is set and the incoming `wcId` **differs**, `htmlFullscreen.forceExit(owner)` first; if it's the **same** wcId (MCP `activateTab` on the fullscreen tab — existing deliberate path, `:784-788`), defer the bounds as pending and skip the find-restore branch (`:763-769`) — ruling: same-tab activation is a geometry no-op under fullscreen, not an exit edge. In the `tab-hide` handler (`:649+`), force-exit when hiding the fullscreen tab. In the `tab-close` handler (`:159-227`), add an explicit idempotent force-exit/cleanup beside the `wasActive` overlay block (`:221-224`) — the mode must never survive its tab (dead-wcId gate = wedged bounds pipeline for the whole window). Thread `htmlFullscreen` into `registerTabIpc` deps.
5. **Move edge**: in `moveTabIntoWindow` (`register-tab-ipc.js:371`), force-exit before the H3 geometry capture at `:400 — "const guestBounds = entry.view.getBounds();"` so the captured rect is the restored one, and the source record's mode is cleared.
6. **Resize edge**: in the `win.on('resize')` handler (`window-factory.js:298-303`), after the chrome re-bound, call `htmlFullscreen.handleWindowResize(record)` (record is in scope; thread the helper into `createWindow`'s deps). Hook `maximize`/`unmaximize` (`:304-311`) the same way — they send `trigger-send-bounds` independently and may arrive without a paired resize on some platforms. The renderer's subsequent bounds send lands in the gate and is deferred — that ordering is fine. Accepted transient (documented, no code): `tab-create` during fullscreen `addChildView`s the new guest above the fullscreen view until an activation force-exits — momentary z-fight, resolved by the activation edge.
7. **Window-close/teardown**: the record dies with the window (registry removal); add a `forceExit` in the close path only if leaving fullscreen has observable work beyond record death (page-side exit request for a surviving contents — tab close destroys the contents, so usually a no-op; cover with a unit test rather than speculative code).
8. **Carry-forward tests**: (a) new source-scan test (toolkit: `test/helpers/source-scan.js`) asserting the latch assignment is the first statement of `wireGuestContents` and no `await` precedes it; (b) comment on `ALLOWED_PERMISSIONS` in `session-runtime.js:13-22` naming the pinning test in `session-runtime.test.js` (find its exact test name and cite it verbatim).
9. **Fixture server** `tests/behavior/fixtures/web-compat/serve.mjs`, modeled on `tests/behavior/fixtures/cross-jar-fetch/serve.mjs` (CLI `--port`/`--log`, JSONL log, `127.0.0.1` bind, in-memory assets, no committed binaries): this leg needs `GET /video.html` — a page with a `<video>` element (in-memory WAV-style generated source is fine; decoded frames are not required for fullscreen mechanics), a visible "Enter fullscreen" button calling `video.requestFullscreen()`, and a `fullscreenchange` listener writing state into a `#fs-state` element (the spec's observability seam). Add a `README.md` noting later legs extend this server (401, PDF, 302 endpoints).
10. **Unit tests** (`test/unit/html-fullscreen.test.js` + updates): fake registry/records/views per house style (`test/helpers/electron-stub.js`, existing `register-tab-ipc.test.js` fakes). Cover: enter snapshot/expand/raise; refuse non-active tab; double-enter idempotence; exit restore (saved vs pending); gate defers and skips fan-out; resize re-expand; each force-exit edge; move ordering (force-exit before capture — assert via call-order fake); Esc branch placement (source-scan or behavioral); exit convergence send.
11. **Spec activation**: flip `web-compat-fullscreen.md` status to `active` once the fixture exists and the wiring lands.

## Edge Cases

- **Enter from a background tab** (MCP `evaluate` can trigger without focus): refused in `enter`; ask the page to exit so it doesn't believe it's fullscreen.
- **Double enter / double leave**: idempotent; `leave` after force-exit must not restore twice (mode already cleared → no-op).
- **Renderer bounds send racing enter** (in-flight rAF send): arrives after the mode is set → deferred as pending; exit applies it — no stale-rect flash.
- **Window resize while fullscreen**: re-expand; the deferred renderer send keeps the *pending* slot current for exit.
- **Move to another window while fullscreen**: force-exit first (step 5); pending challenges are not this leg's concern.
- **Contents destroyed mid-fullscreen** (crash/close): restore path must not touch destroyed views; record cleanup only.
- **Same-tab `activateTab` under fullscreen** (MCP path): geometry no-op — bounds deferred, find-restore skipped (AC 4 / guidance step 4).

## Files Affected

- `src/main/html-fullscreen.js` — new module
- `src/main/guest-wiring.js` — event wiring + Esc branch + dep
- `src/main/register-tab-ipc.js` — bounds gate, activation/hide/move force-exits, dep
- `src/main/window-factory.js` — resize re-expand hook, dep
- `src/main/main.js` — construct + thread `htmlFullscreen`
- `src/main/window-registry.js` — `WindowRecord` typedef entry + `htmlFullscreen: null` seed at `create()` (house pattern: every record slot seeded; registry-test shape update as needed)
- `src/main/session-runtime.js` — comment only (carry-forward 2)
- `test/unit/html-fullscreen.test.js` — new; `guest-wiring.test.js`, `register-tab-ipc.test.js`, `seam-contract`-adjacent updates as needed
- `test/unit/latch-ordering-invariant.test.js` — new (carry-forward 1; name per repo convention)
- `tests/behavior/fixtures/web-compat/serve.mjs`, `README.md` — new
- `tests/behavior/web-compat-fullscreen.md` — status flip

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: update flight.md status to `landed`, check off flight in mission.md

*(Flight-level note: per the batched workflow, code review and commit happen after the last autonomous leg — the Developer lands the leg and updates artifacts but does not commit.)*

## Citation Audit

Verified at leg design time against the working tree: `guest-wiring.js:66-73` (latch comment + assignment), `:11-27` (deps destructure), `:100-106` (internal early return), `:118 — "if (!(input.control || input.meta)) return;"`, `register-tab-ipc.js:708` (`tab-set-active`), `:814-816` (owner/entry resolve), `:827-832` (syncBounds fan-out), `:371` (`moveTabIntoWindow`), `:400 — "const guestBounds = entry.view.getBounds();"`, `window-factory.js:298-303` (resize handler; `trigger-send-bounds` at `:302`), `session-runtime.js:13-22` (`ALLOWED_PERMISSIONS`, `'fullscreen'` at `:14`), `chrome-preload.js:148` (`onTriggerSendBounds`), fixture precedent `tests/behavior/fixtures/cross-jar-fetch/serve.mjs`. `register-tab-ipc.js:663-666` (tab-hide overlay handling) and `:649` (tab-hide handler) verified via the flight-design review pass. Revision-added citations verified by the second design-review pass against the working tree: `register-tab-ipc.js:763-769` (AC6b find-restore branch), `:784-788` (same-tab sheet path), `:159-227` / `:221-224` (tab-close handler, `wasActive` block), `:817` (rounding line), `window-factory.js:304-311` (maximize/unmaximize). All OK; no drift.
