# Squawk 0009: `INTERNAL_JAR_NAMES` has no `vault` entry — a Vault tab's jar label falls back to "Settings"

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-24
**Completed**: —

## Report

The synthetic internal jar's display name is derived per host by `internalJarName(url)`, whose table lists `settings`, `downloads`, and `jars` only, with `|| 'Settings'` as the fallback. `goldfinch://vault` was onboarded as an internal page without an entry, so a Vault tab's jar name (tab-strip dot title / jar label surfaces) reads "Settings". Found during Mission 16 Flight 2 reconnaissance (2026-08-24). One-line table fix plus a unit case.

## Evidence

- `src/renderer/chrome/tab-controller.js:46-53` — `INTERNAL_JAR_NAMES = { settings: 'Settings', downloads: 'Downloads', jars: 'Cookie Jars' }` and `internalJarName(url)` with the `'Settings'` fallback.
- `src/shared/url-safety.js:84` — `INTERNAL_HOSTS = new Set(['settings', 'downloads', 'jars', 'vault'])` — four hosts, three names.

## Corrective Action
*(written at completion)*

## Verification
A unit case in the tab-controller suite asserting `internalJarName('goldfinch://vault')` returns the Vault label; visual check of a Vault tab's jar label.

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
