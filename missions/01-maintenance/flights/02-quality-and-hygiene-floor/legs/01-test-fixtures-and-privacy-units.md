# Leg: test-fixtures-and-privacy-units

**Status**: completed
**Flight**: [Quality & Hygiene Floor](../flight.md)

## Objective
Give the security-critical privacy core a regression net (F8): consolidate the Electron stub into a shared test helper, then unit-test the pure functions in `trackers.js` and `shields.js`.

## Context
- Flight technical approach Leg 1 (F8 + stub consolidation). `node --test` runner + `test/unit/` exist from Flight 1.
- `src/main/trackers.js` is **pure** (no `require`) — exports `registrableDomain`, `hostnameOf`, `classify` (+ `TRACKERS`). `classify(url, firstParty)` returns `{ thirdParty, tracker: category|null, domain }` and **only sets `tracker` when third-party** (`trackers.js:117`).
- `src/main/shields.js` does `require('electron')` (`:7`) for `app.getPath` — so its tests need the Electron stub. Pure helpers to test: `active`, `stripUrl`, `isTrackingParam`, `isPaused`. `active`/`isPaused` read the module-scoped `config` (starts at `DEFAULTS`: all-on, no paused sites); arrange state via the exported `set()`/`setPaused()` (they mutate `config` in memory; disk `save()` is skipped while `configPath` is null).
- `test/unit/jars.test.js:12-22` currently hand-stubs `Module._cache['electron']` — lift this verbatim into a shared helper that both `jars` and `shields` tests require.

## Inputs
- `src/main/trackers.js`, `src/main/shields.js` (modules under test — **not modified**).
- `test/unit/jars.test.js` (existing stub to lift; will require the new helper).

## Outputs
- `test/helpers/electron-stub.js` (new) — side-effecting module that injects the `electron` stub into `Module._cache` at require time.
- `package.json` (modified) — scope the `test` script to `node --test test/unit/` so `node --test` discovers only unit suites (the new `test/helpers/` fixture is **not** run as a spurious empty suite, and future `tests/behavior` fixtures stay out).
- `test/unit/jars.test.js` (modified) — replaces its inline stub with `require('../helpers/electron-stub')`.
- `test/unit/trackers.test.js` (new) — pure-function tests.
- `test/unit/shields.test.js` (new) — uses the stub helper.

## Acceptance Criteria
- [ ] `test/helpers/electron-stub.js` exists and, when required, installs `{ app: { getPath: () => path.join(os.tmpdir(), 'goldfinch-test-userdata') } }` into `Module._cache[require.resolve('electron')]` (lifted from the current `jars.test.js` stub, but using `os.tmpdir()` instead of a hardcoded `/tmp` path). It must be required **before** any module that `require('electron')`.
- [ ] The `test` script in `package.json` is `node --test test/unit/` so discovery is scoped to unit suites (helpers/fixtures excluded).
- [ ] `test/unit/jars.test.js` requires `../helpers/electron-stub` (before requiring `jars`) and no longer contains its own inline `Module._cache` stub; its existing assertions still pass unchanged.
- [ ] `test/unit/trackers.test.js` covers: `registrableDomain` (`a.com`→`a.com`, `sub.a.com`→`a.com`, `bbc.co.uk`→`bbc.co.uk` via MULTI_SUFFIX, `x.bbc.co.uk`→`bbc.co.uk`, `''`/`undefined`→`''`, single label `localhost`→`localhost`); `hostnameOf` (`https://a.com/x`→`a.com`, `not a url`→`''`); `classify` (third-party known tracker → `{thirdParty:true, tracker:'<cat>'}`; **same-domain first-party known tracker → `tracker:null`**; third-party non-tracker → `{thirdParty:true, tracker:null}`; **host-level fallback** — use `https://analytics.google.com/...` (registrable `google.com` is NOT in TRACKERS, but host `analytics.google.com` IS → `analytics`); **known-tracker with no firstParty** — `classify('https://google-analytics.com/collect', undefined)` → `{thirdParty:false, tracker:null, domain:'google-analytics.com'}`; empty/garbage URL → `{thirdParty:false, tracker:null, domain:''}`).
- [ ] `test/unit/shields.test.js` (requires the stub helper first) covers: `isTrackingParam` (known param `gclid`→true, prefix `utm_source`/`hsa_x`/`pk_y`/`mtm_z`→true, case-insensitive `GCLID`→true, `q`→false); `stripUrl` (mixed `?q=hello&utm_source=foo` → cleaned to `?q=hello` (non-tracking preserved); URL with no tracking params → `null`; invalid URL → `null`); `active` (default config + valid strategy + unpaused site → true; paused site → false; master `enabled:false` → false); `isPaused` (site in `pausedSites` → true; absent → false; `''`/falsy → false).
- [ ] **Test isolation**: `shields` `config` is module-global (node --test runs a file's tests sequentially in one worker); stateful tests (`active`/`isPaused`) restore default state afterward via `shields.set({ ...shields.DEFAULTS })` / `shields.setPaused(site, false)` (`DEFAULTS` is exported at `shields.js:91`) so order doesn't matter.
- [ ] `npm test` passes; total count increases from the current baseline by the number of new cases; no prior test regresses.

## Verification Steps
- `npm test` → exits 0; new `trackers` + `shields` suites present and green; `jars` suite still green via the shared helper.
- `grep -n "Module._cache" test/unit/*.js test/helpers/*.js` → the injection lives only in `test/helpers/electron-stub.js` (not duplicated in jars.test.js).
- `grep -n "require('../helpers/electron-stub')" test/unit/jars.test.js test/unit/shields.test.js` → both require it before the module under test.

## Implementation Guidance
1. **`test/helpers/electron-stub.js`**: move the `electronStub` + `Module._cache[require.resolve('electron')] = {...}` block here (side effect on require). `app.getPath` returns `path.join(os.tmpdir(), 'goldfinch-test-userdata')` (portable; not the hardcoded `/tmp` path). Optionally `module.exports = electronStub` for customization, but the install is the require side effect.
2. **`package.json`**: change `"test"` to `"node --test test/unit/"` (scopes discovery; the helper file won't run as an empty suite).
3. **`jars.test.js`**: delete the inline stub (`:5-22` region), add `require('../helpers/electron-stub');` immediately before `const { validateContainers } = require('../../src/main/jars');`.
3. **`trackers.test.js`**: `require('../../src/main/trackers')` directly (pure). Write the cases above.
4. **`shields.test.js`**: `require('../helpers/electron-stub'); const shields = require('../../src/main/shields');`. Use `node:test` + `node:assert/strict`. For `active`/`isPaused`, set/clear paused state via `shields.setPaused(...)`/`shields.set(...)` and restore after each stateful test.

## Edge Cases
- **Require order**: the stub helper must run before `require('shields'|'jars')` or the real `require('electron')` throws in plain Node.
- **`require.resolve('electron')`** resolves because `electron` is an installed dep — keep using it (do not hardcode a path).
- **Global `config` bleed** between shields tests — restore defaults; don't rely on test ordering.
- **`classify` first-party**: a known-tracker domain that equals the first party must yield `tracker:null` — assert this explicitly (it's the easy-to-miss branch).

## Files Affected
- `test/helpers/electron-stub.js` — new shared fixture (uses `os.tmpdir()`)
- `package.json` — scope `test` script to `node --test test/unit/`
- `test/unit/jars.test.js` — use shared fixture (remove inline stub)
- `test/unit/trackers.test.js` — new
- `test/unit/shields.test.js` — new

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 1 of 6)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
