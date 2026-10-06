# Squawk 0135: docs/dev-testing.md: add a web-compat triage recipe (bisect Shields first)

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
Squawk 0119 shipped a user-agent fix for "This browser isn't supported" before the hypothesis was falsified. The real cause (Shields cookie isolation) would have shown up in minutes with a fixed triage order. Add a "Web-compat triage" section to `docs/dev-testing.md`:
1. Reproduce in a signed-in dev profile.
2. Pause Shields on the site. If that fixes it, toggle each strategy one at a time to bisect.
3. Capture the failing subframe's request/response headers (Cookie sent, Set-Cookie received, content-type) and the console via the `--enable-logging` launch log.
4. Only then consider UA, fingerprint or engine causes.

Also note: a fix for a user-visible symptom needs a before/after on the real failing site.

## Evidence
`squawks/0119-web-guest-electron-ua-token.md` (Report: "Not the cause …"); sortie 02 flight log, 2026-10-01 entry; `sorties/02-partitioned-cookie-isolation/flight-debrief.md` (Key Learning 1).

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
