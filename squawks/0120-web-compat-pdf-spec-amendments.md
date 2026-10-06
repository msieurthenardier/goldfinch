# Squawk 0120: web-compat-pdf spec: tighten steps 1, 5 and 6 after its first run

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
The first run (sortie 02 AC12) passed steps 1, 5 and 6 only on intent:
- step 1's 3 s paint bound wasn't captured with a timestamp;
- neither of step 5's navigation paths reaches the app's own top-frame guard (the automation `bad-url` gate fires first, and the omnibox normalizes to `https://chrome-extension//…`);
- step 6 names no fixture page and captures no refusal evidence.

Amend the spec as the Validator recommended:
- step 1: a timed capture within 3 s;
- step 5: split into 5a/5b, each saying what it proves (the app guard stays unit-pinned in `guest-wiring.test.js`);
- step 6: name `/oauth/opener.html`, use a 3 s wait, and capture console or main-log evidence;
- an ordering note (5b replaces the PDF tab);
- apparatus notes: `click` doesn't reach the PDF OOPIF but `scroll` does; the transient `captureWindow` "chrome window unavailable" has a chrome-wcId `captureScreenshot` fallback.

## Evidence
`tests/behavior/web-compat-pdf/runs/2026-10-06-13-24-48.md` (Orchestrator Notes, *Recommended amendments, not yet applied*); `tests/behavior/web-compat-pdf.md` steps 1, 5, 6.

## Corrective Action
Amended `tests/behavior/web-compat-pdf.md` only: step 1 now requires a timed capture (T0/T1, ≤3 s, timestamps recorded); step 5 split into 5a (automation `bad-url` gate) and 5b (omnibox normalization to `https://chrome-extension//…`), each stating what it proves and citing the unit pin in `test/unit/guest-wiring.test.js`; step 6 names `/oauth/opener.html`, waits 3 s and requires console/main-log refusal evidence; added an ordering note (5b replaces the PDF tab) and apparatus notes (`click` vs `scroll` on the PDF OOPIF; `captureWindow` transient failure with chrome-wcId `captureScreenshot` fallback).

## Verification
Confirmed the cited unit test exists in `test/unit/guest-wiring.test.js` (`PDF-viewer carve-out: top-frame will-navigate and will-redirect to the viewer URL stay refused (guardNav untouched)`) and that `/oauth/opener.html` is served by the fixture `serve.mjs`. Spec sections (Intent, Preconditions, Observables Required, Steps, Out of Scope) intact. Behavior test not run, per instruction. `npm run format:check` passed.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
