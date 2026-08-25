# Squawk 0009: `INTERNAL_JAR_NAMES` has no `vault` entry — a Vault tab's jar label falls back to "Settings"

**Status**: in-progress
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

Added a `vault` entry to `INTERNAL_JAR_NAMES` in `src/renderer/chrome/tab-controller.js:46`. The label is `'Secrets'`, not `'Vault'` — grepped `src/renderer/pages/vault.html` (`<title>Secrets — Goldfinch</title>`, `<h1>Secrets</h1>`, `<nav aria-label="Secrets">`) and the kebab menu entry in `src/renderer/chrome/overlay-menus.js:15` (`{ id: 'vault', label: 'Secrets' }`) — both name the page "Secrets", so the internal-jar table now matches that convention rather than the URL host word. The `'Settings'` fallback is unchanged.

```js
const INTERNAL_JAR_NAMES = { settings: 'Settings', downloads: 'Downloads', jars: 'Cookie Jars', vault: 'Secrets' };
```

## Verification

Added a new test, `trusted internal jar name is derived per host, including vault (squawk 0009)`, to `test/unit/tab-controller.test.js` (after the existing "safe and trusted create paths..." test). It asserts `container.name` for trusted `createTab` calls against `goldfinch://settings`, `goldfinch://downloads`, `goldfinch://jars`, and `goldfinch://vault`, confirming the last resolves to `'Secrets'`. Also widened the test harness's `isInternalPageUrl` fake regex to admit `vault` (previously `settings|downloads|jars` only), since `createTab`'s trusted branch gates on it.

- `timeout 300 npm test` — 3716/3716 passing, 13 suites, 0 failures, `duration_ms: 3016.247776` (wall clock `0m3.293s` via `time`).
- `npm run typecheck` — clean (`tsc --noEmit -p jsconfig.json`).
- `npm run lint` — clean (`eslint .`).
- **Red/green check**: reverted `INTERNAL_JAR_NAMES` to the pre-fix three-entry table (no `vault` key) and reran `node --test test/unit/tab-controller.test.js` — the new case failed as expected:
  ```
  not ok 2 - trusted internal jar name is derived per host, including vault (squawk 0009)
    Expected values to be strictly equal:
    + actual - expected
    + 'Settings'
    - 'Secrets'
  ```
  Restored the `vault: 'Secrets'` entry and reran the full suite: 3716/3716 passing again.

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
