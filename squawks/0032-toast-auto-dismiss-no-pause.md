# Squawk 0032: Media toasts auto-dismiss on a fixed 5–8 s timer with no pause on hover or focus

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Toasts in `media-controller.js` remove themselves after 8000 ms / 5000 ms unconditionally. WCAG 2.2.1 (Timing Adjustable) asks that timed content pause or extend on user attention. Pause the removal timer while the toast is hovered or holds focus, and resume on leave/blur. The downloads indicator's 5-minute expiry is unaffected (it hides a badge only; nothing is lost).

Source: maintenance report 2026-08-27, finding F50.

## Evidence

- `src/renderer/chrome/media-controller.js:475` — `setTimeout(() => el.remove(), 8000)`; `:592` — 5000 ms variant

## Corrective Action

Added a module-scoped `armDismiss(el, ms)` helper in `src/renderer/chrome/media-controller.js`
and switched both auto-dismiss sites (`bulkFinish`'s 8000 ms toast and `toast()`'s 5000 ms
toast) to call it instead of a bare `setTimeout(() => el.remove(), …)`.

`armDismiss` uses the module's existing (unwrapped, global) `setTimeout`/`clearTimeout` — the
controller takes no injected timer deps, so no new seam was needed. It tracks elapsed time with
`Date.now()`, pausing the countdown on `mouseenter`/`focusin` (subtracting elapsed time from the
remaining budget) and resuming on `mouseleave`/`focusout` with a fresh timer scheduled for
exactly the remaining time — never a full reset. Hover and focus are tracked as independent
flags so leaving one while the other still holds (e.g. mouse leaves while a child retains focus)
correctly keeps the countdown paused. All four listeners are removed from the element the moment
it actually dismisses, so they don't outlive the toast.

No toast today has genuinely focusable content (the "Show folder"/"Show in folder" links are
plain `<a>` elements with no `href`, so they aren't in tab order in a real browser) — per the
squawk's guidance, no `tabindex="0"` or new role was added. `focusin`/`focusout` pause/resume
wiring is in place and will engage automatically if a toast ever gains real focusable content.

The downloads indicator's 5-minute badge expiry (`downloads-controller.js` / `downloads-indicator-model.js`)
was not touched — out of scope per the squawk.

## Verification

- `node --test test/unit/media-controller.test.js` — 9/9 pass, including 4 new squawk-0032 cases:
  untouched toast dismisses at the full 5000 ms deadline; hover at t=3s pauses (2000 ms
  remaining) and `mouseleave` resumes with exactly that remaining time, not a fresh timer;
  same for `focusin`/`focusout`; and a source-pin confirming both call sites route through
  `armDismiss`. Tests use `node:test` MockTimers with `apis: ['setTimeout', 'Date']` so
  `Date.now()`-based elapsed tracking advances in lockstep with `tick()`.
- `timeout 180 npm test` — 3798/3798 pass, no regressions.
- `npm run lint` — clean.
- `npm run typecheck` — clean.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 2)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 2)` on `squawk/turnaround-2026-08-27-2` (PR number recorded on the PR itself)

Batch gates at review: 3806/3806 tests, lint clean, typecheck clean.
