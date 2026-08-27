# Squawk 0037: Electron pinned with a caret range on the security-critical Chromium

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

`package.json` declares `"electron": "^43.2.0"`. The lockfile pins the installed version, so builds are reproducible today, but the caret means a fresh `npm install` without the lockfile — or a lockfile regeneration — can silently move Chromium. Dependabot already delivers Electron bumps as standalone PRs gated on behavior-test runs; an exact pin makes the declared range match that policy. Change to `"43.2.0"` (exact, as `@modelcontextprotocol/sdk` already is) and confirm `npm ls electron` and the suite are unchanged.

Source: maintenance report 2026-08-27, finding F10m.

## Evidence

- `package.json` devDependencies — `"electron": "^43.2.0"` vs `"@modelcontextprotocol/sdk": "1.29.0"`
- `.github/dependabot.yml` — majors arrive standalone with a behavior-test gate comment

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
