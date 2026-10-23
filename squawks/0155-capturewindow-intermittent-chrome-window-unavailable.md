# Squawk 0155: `captureWindow` intermittently fails with a generic "chrome window unavailable"

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: 2026-10-22

## Report
On the Wayland/WSLg path, MCP `captureWindow` sometimes returns `automation: chrome window unavailable` even though the window, chrome and active guest are all alive. A retry moments later succeeds. Seen twice while verifying squawk 0154 on Electron 44.9.0:
- **TLS run 2026-10-23-00-18-01:** one capture with the cert-override card up failed. The Validator rated it UNKNOWN.
- **Flight Director re-check on a scratch instance:** the **first** capture, about 3 s after `openTab` to an untrusted-cert page (interstitial, no sheet), failed in 5 ms. The next five captures all succeeded, about 56–86 ms each: three with the Advanced card up, one after a tab-switch close, one with the site-info sheet up.

It fails closed, so no pixels leak. But the cause is invisible. It is not tied to secret sheets. Whether it predates 44.9.0 is not established; the isolation run on the same build had no capture failures.

Repro (best-effort): a fresh scratch `dev:automation` instance. `openTab` to an untrusted TLS fixture page, wait about 3 s, then call `captureWindow`. Repeat across a few fresh tabs.

## Evidence
- `src/main/main.js` `grabWindow`, Wayland composite fallback. Every failure collapses to `return null`:
  - `if (!cc || cc.isDestroyed()) return null;`
  - `if (!chromeImg) return null;`
  - the trailing catch-all `/* fallback failed */`, which re-throws only `automation: capture-timeout` and swallows everything else, e.g. a rejected `atc.capturePage()` inside `Promise.all`, or an `executeJavaScript` composite error.
- `src/main/automation/observe.js` `captureWindow`: `if (!result) throw new Error('automation: chrome window unavailable');`. So any swallowed error reads as "window unavailable".
- A 5 ms failure is faster than a successful capture (≥ 56 ms). That points to an early synchronous or immediately-rejecting path, such as the active-guest `capturePage()` rejecting, rather than the composite step.
- Run log: `tests/behavior/tls-trust-surface/runs/2026-10-23-00-18-01.md`, Orchestrator Notes.

## Corrective Action
**Diagnosis** (scratch `dev:automation` on WSLg/Electron 44.9.0, with temporary labelled `console.error`s in `grabWindow`, since removed). Every failure was the **active guest's `capturePage()` rejecting with `UnknownVizError`** (no compositor frame to copy), swallowed by the catch-all. The chrome capture never failed, and `executeJavaScript` never threw. Two shapes, both **deterministic**, not random:
1. **Guest hidden behind a chrome takeover panel.** On the TLS interstitial (load-failure), `applyGuestVisibility` hides the guest with `setVisible(false)`, and diagnostics showed `visible:false, painting:false`. The first capture **always** failed, at any delay (0–3000 ms, 8/8). The retry "succeeded" only because the failed `capturePage` had woken the hidden renderer. Worse, that success **composited the hidden guest's blank white page over the interstitial** that was actually on screen: a silent wrong-pixels success, confirmed by comparing against a chrome-only `captureScreenshot`. This was the squawk's "first capture ~3 s after an untrusted-cert `openTab`" case.
2. **Freshly created visible guest that has not painted yet.** On `about:blank` and plain http, a capture at 0 ms after `openTab` failed (4/4, and the immediate retry also failed). A guest's first capturable frame landed **93–199 ms** after the first rejected attempt (16 tabs polled every 25 ms). At ≥ 500 ms after `openTab`, 0 failures.

Both causes are inside `grabWindow`'s guest step, so the fix stays in squawk scope.

**Change.**
- New Electron-free `src/main/capture-failure.js`, with `captureFailure(step, err)` and `captureWithOneRetry(start, step)`:
  - `captureFailure` returns `automation: capture-failed — {step}: {reason}` and passes an existing `automation: capture-*` refusal through verbatim.
  - `captureWithOneRetry` retries once after `GUEST_CAPTURE_RETRY_MS = 250`, and never retries a capture-timeout.
- `src/main/main.js` `grabWindow` only:
  - (a) The guest is layered only while `activeEntry.view.getVisible()`. This is checked before the first attempt and again inside the retried thunk, the same disposition as the overlay layers' `isVisible()` gates. A taken-over guest is skipped, and the chrome capture carries the panel.
  - (b) The active-guest capture goes through `captureWithOneRetry(captureGuest, 'active guest')`.
  - (c) A chrome capture rejection is named `chrome`. An empty or missing chrome image is `capture-failed — chrome: empty image`.
  - (d) The catch-all swallows nothing: `throw captureFailure('composite', err)`. `return null` remains **only** for no record and destroyed chrome, so `automation: chrome window unavailable` keeps its verbatim pins and now means exactly that.
- The success wire shape is unchanged: a bare base64 string. A named refusal is a rejection, so it surfaces as `isError`, the established DD7 refusal shape.
- Comment and doc touch-ups: `observe.js` and `engine.js` notes on what a null now means. In `docs/mcp-automation.md`, the refusal list gains `capture-failed`.

**Tests.**
- `test/unit/capture-failure.test.js` (14 tests): the message mapping, verbatim pass-through, the bound on the retry delay, MockTimers-driven single-retry timing, timeouts never retried, composition with `withCaptureTimeout`, and propagation through `observe.captureWindow`.
- `test/unit/capture-window-failure-pins.test.js` (8 tests): wrap-insensitive source-scan pins P1–P5 over `grabWindow`. These cover the catch-all throw, exactly two allowed `return null`s, the named chrome step, guest-capture-through-retry, and both `getVisible()` gates plus the empty-chrome refusal. Each pin is neuter-verified by an `assertMutated`-guarded mutation, plus a vacuity guard.

## Verification
- **Before (repro, 2 rounds × 3 URLs × delays 0/500/1500/3000 ms):** 12/24 failed with `chrome window unavailable` in 4–23 ms:
  - TLS: 8/8 at every delay;
  - `about:blank` / http: 4/4 at 0 ms only.
- **After (same harness, fixed build):**
  - 3 rounds: **36/36** succeeded, all valid PNGs (magic-byte checked).
  - Timings: delay 0 → 274–339 ms (the retry path); ≥ 500 ms → 30–125 ms.
  - Delay-0 stress, 15 rounds × 3 URLs: **45/45** succeeded (267–478 ms).
- **Pixels:** the TLS-interstitial `captureWindow` now shows the interstitial panel, matching the chrome-only `captureScreenshot`; before the fix it showed a white guest page. A normal http page still composites its guest correctly.
- **Named refusal on the wire:** with the retry delay temporarily forced to 1 ms (reverted), 6/6 delay-0 captures returned `isError` with `automation: capture-failed — active guest: UnknownVizError`.
- **Smoke on the fixed build:** all fine.
  - `enumerateWindows`, `enumerateTabs`, `captureScreenshot`, `readDom`, `evaluate` OK.
  - `captureWindow` with and without `windowId` OK.
  - An unknown `windowId` still returns `automation: no-such-window — no window 99999`.
- **Gates:**
  - `npm test`: 6000 tests, 5996 pass, 0 fail, 4 todo.
  - `npm run typecheck` clean; `npm run lint` clean.
  - `npm run format` then `npm run format:check`: clean.
  - Existing verbatim `chrome window unavailable` pins unchanged and passing.
- **Cleanup:** the scratch instance and fixtures were killed by PID (from `ss -ltnp`), and the scratch `xdg` profile was deleted.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking issues.
- **Visibility skip:** correct. `getVisible()` is the on-screen truth: every guest `setVisible` is in `register-tab-ipc.js`, through `applyGuestVisibility` = `active && !guestTakenOver` or hide-on-inactive/move/close. In scope as the same root cause, and it matches the overlay layers' existing `isVisible()` gating.
- **Wire shape:** a success is still a bare base64 string, and every failure throws. The only remaining `return null`s are no-record and chrome-destroyed.
- **Retry:** bounded to one attempt at 250 ms, never on a timeout. It re-checks destroyed and visibility, and leaves no leaked timers or unhandled rejections.
- **Pins:** two neutered by the Reviewer; both fail, with no residue.
- **Gates:** `npm test` 6000 (5996 pass, 0 fail, 4 todo); typecheck, lint and format:check clean.

**Commit**: the `squawk/0155` commit on `squawk/0155-capturewindow-flake`
