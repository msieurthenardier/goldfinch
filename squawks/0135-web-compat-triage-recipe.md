# Squawk 0135: docs/dev-testing.md: add a web-compat triage recipe (bisect Shields first)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

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
Added a "Web-compat triage" section to `docs/dev-testing.md` (ordered steps 1-4, the before/after-on-real-site rule, one-line sortie 02 case). Extended the existing dev-testing pointer line in CLAUDE.md Commands with "web-compat triage order".

## Verification
`npx prettier --write` on changed files; `npm run format:check` (see handoff). Docs-only; no code touched.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
