# Squawk 0120: web-compat-pdf spec: tighten steps 1, 5 and 6 after its first run

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

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
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
