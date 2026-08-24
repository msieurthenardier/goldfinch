# Leg: consumers-and-settings-ui

**Status**: completed
**Flight**: [Search Engine as a Preference](../flight.md)

## Objective

The stored `searchEngine` preference becomes live behavior: `toUrl` builds search URLs from it (address bar and context-menu entry points both), every window tracks changes instantly via broadcast plus an explicit boot seed, and Settings gains a radio-group engine control adjacent to the home-page control, rendered from the shared table — verified end-to-end by the two behavior specs.

## Context

- Flight DD3 (no new IPC — writes ride `internal-settings-set`), DD4 (live cache + **explicit boot seed**; `homePageCache`'s pattern is defective — squawk 0005 — do NOT copy it), DD7 (radio-group widget; MCP apparatus). Read the flight's Design Decisions in full.
- Leg 1 ground truth (flight log entry, 2026-08-11): `src/shared/search-engines.js` is a real ES module exporting `SEARCH_ENGINES` (ordered, frozen — render source), `getSearchEngine(id)` (null on miss, never throws), `buildSearchUrl(id, query)` (null on unknown id; `encodeURIComponent` escaping verified including literal `%s` in query). Store surface unchanged in shape: `settingsSet('searchEngine', id)` works through the existing bridge; validator enforces the curated set.
- **Chrome vs page import mechanics differ** (established conventions): chrome controllers receive dependencies via factory deps (`createNavigationController(deps)`, `navigation-controller.js:4-13`) — renderer.js imports and injects; internal pages import via **serving paths** as flat siblings, requiring an explicit asset route in `internal-page-map.js` (see `internal-page-map.js:16-19` — "Same-origin shared modules must be explicitly served") with `@ts-ignore` on the import per the documented serving-path convention (`settings.js:1-9`).

## Inputs

- Leg 1 landed (uncommitted): `search-engines.js`, schema v3, validators, pin-on-load
- `src/renderer/renderer.js:47-48` (`homePageCache`/`currentHomePage`), `:408` (nav-controller deps), `:478` (`setHomePage`), `:877` (`sel:search` through `toUrl`)
- `src/renderer/chrome/navigation-controller.js:93-99` (`toUrl`, hardcoded Google at `:98`)
- `src/renderer/chrome/window-controller.js:89` / `:120` (boot-seed idiom), `:130-135` (settings-changed handler)
- `src/renderer/pages/settings.html:35-40` (#appearance, home-page control), `settings.js` home-page controller (`:117-151`)
- `src/main/internal-page-map.js:12-20` (settings asset routes)
- Draft behavior specs `tests/behavior/search-engine-preference.md`, `tests/behavior/search-engine-upgrade.md`

## Outputs

- `renderer.js` — `searchEngineCache` + `setSearchEngine` + `currentSearchEngine`, new nav-controller deps
- `navigation-controller.js` — `toUrl` builds from the live engine
- `window-controller.js` — boot seed + broadcast handler line
- `internal-page-map.js` — `/search-engines.js` asset route for the settings host
- `settings.html` / `settings.js` / `settings.css` — engine radio-group
- Tests: `navigation-controller.test.js` (deps + engine cases), `internal-page-map.test.js` (route), and a settings-page **structural** test following the `*-page-shared-scripts.test.js` pattern (script/asset presence). **No DOM-driven controller-test harness exists for any internal page** (design review confirmed — `jars-page-shared-scripts.test.js` and siblings assert script-tag structure only, never instantiate controllers); the radio group's live behavior is covered by the behavior specs, not unit tests. Do not build a new harness.
- `CLAUDE.md` — Settings docs gain the engine control + cache contract
- Upgrade-fixture procedure validated; both behavior specs runnable

## Cache Freshness Contract (flight risk-check, declared)

- **Source of truth**: main's settings config (single writer, `settings-store.js`)
- **Rebuild triggers, exactly two**: (1) boot seed — `settingsGet('searchEngine')` at window-controller construction; (2) every `settings-changed` broadcast (all mutation paths broadcast — DD3)
- **Maximum staleness**: one IPC round-trip after a mutation; no polling, no TTL
- **Invalidating actions**: any settings mutation in any window (all funnel through `broadcastSettings` in `register-settings-ipc.js`)

## Acceptance Criteria

- [x] `renderer.js` holds `searchEngineCache` (initialized `'google'`, matching DEFAULTS) with `setSearchEngine(value)` storing the value **raw** — no coalescing in the setter (unlike `setHomePage`; null must survive for Flight 2) — and `currentSearchEngine()` returning it. Exactly one Google-coalescing read site exists (see next criterion), clearly commented as Flight-1 semantics that Flight 2's unset-routing will rewrite.
- [x] `toUrl` (navigation-controller) builds the search URL via `buildSearchUrl` from the current engine id, injected through factory deps (renderer.js imports the shared module and passes `buildSearchUrl` + `currentSearchEngine`); the hardcoded Google line at `navigation-controller.js:98` is gone. Non-search behaviors of `toUrl` (scheme passthrough, domain heuristic) are unchanged.
- [x] Both entry points prove out through the one change: `navigation-controller.test.js` covers `toUrl` under a non-default engine (e.g. DuckDuckGo) AND the default (existing `:118` assertion survives or is updated with rename discipline if its meaning shifts); a test exercises the `sel:search` path's URL construction if the existing suite has a seam for it (do not build a new harness just for this — note if absent). *(No seam found for `sel:search` specifically — it lives in `renderer.js`'s page-context dispatch and calls the same `toUrl`, so it inherits the fix structurally; noted for the FD, no new harness built.)*
- [x] `window-controller.js` boot-seeds via `settingsGet('searchEngine').then(setSearchEngine).catch(() => {})` (the `toolbarPins` idiom) and the `settings-changed` handler applies `all.searchEngine` guarded by `!== undefined` (null is a meaningful future value, `undefined` means absent).
- [x] The settings page renders a radio-group (fieldset + legend, one `<input type="radio">` per engine with label and description text) from `SEARCH_ENGINES` imported via serving path — requiring the `internal-page-map.js` route `'/search-engines.js': shared('search-engines.js')` and its `internal-page-map.test.js` coverage. No engine data duplicated in markup or page script.
- [x] The control sits in `#appearance` adjacent to the home-page control; selecting an engine writes via `goldfinchInternal.settingsSet('searchEngine', id)` and reflects live via `onSettingsChanged` (guard `!== undefined`); the current selection renders checked on page load via the initial `settingsGet`.
- [x] Selecting an engine in Settings changes address-bar search URLs in the same window AND other open windows without restart or reload (covered by behavior spec steps 4–5; unit tests cover the handler wiring). *(Handler wiring unit-verified; live cross-window observation is the behavior spec's job — see AC below.)*
- [x] Setting the engine never touches `homePage` and vice versa (independence — behavior spec step 7; the two controls share no state). *(Structural — `homePageCache`/`searchEngineCache` are separate module-scope variables with disjoint setters; behavior spec step 7 is confirmatory.)*
- [x] `npm test`, `npm run typecheck`, `npm run lint` green.
- [x] `CLAUDE.md` documents the engine control, the cache freshness contract above, and that `searchEngineCache` (seeded) deliberately diverges from `homePageCache` (unseeded, squawk 0005) until Flight 2 unifies them.
- [x] **Behavior acceptance (FD-run, not Developer-run)**: `/behavior-test search-engine-preference` and `/behavior-test search-engine-upgrade` pass. *(Run 2026-08-24 — both PARTIAL with dispositions recorded in the flight log and run logs: preference 7/8 pass + 1 inconclusive on an apparatus gap (context-menu sheet not automatable; structural coverage via the shared `toUrl`); upgrade 4/5 pass + 1 fail on pre-existing squawk 0005, reproduced identically on the pre-flight build — not an upgrade regression. Every search-engine claim passed. FD ruling: lands as known-issue disposition.)* The upgrade fixture is produced per the spec's procedure from a `git worktree` at the pre-implementation commit (`c8563f3` — leg 1's code is uncommitted, so HEAD is the pre-flight build). The leg does not land while either spec fails.

## Verification Steps

- `node --test test/unit/navigation-controller.test.js test/unit/internal-page-map.test.js` + the settings-page suites — pass
- `grep -n "google.com/search" src/renderer/chrome/navigation-controller.js` → no hits
- `grep -c "searchEngineCache" src/renderer/renderer.js` → definition + setter + accessor only
- `grep -rn "currentSearchEngine() || 'google'" src/renderer/chrome/navigation-controller.js` → exactly 1 hit (the sole coalescing site); `grep -rn "'google'" src/renderer/chrome/ src/renderer/renderer.js` bounds the fallback's total occurrence count (design review: the renderer.js grep alone cannot see the coalescing site, which lives in navigation-controller)
- `npm test && npm run typecheck && npm run lint`
- FD: run both behavior specs against `npm run dev:automation` (fresh scratch profile; upgrade fixture from worktree procedure); run logs land per ARTIFACTS.md

## Implementation Guidance

1. **Renderer cache first** (`renderer.js`): mirror `homePageCache`'s placement (`:47-48`) but keep the setter raw; add `currentSearchEngine()`. Register `setSearchEngine` in the same ctx object as `setHomePage` (`:478`).
2. **Nav-controller deps**: add `buildSearchUrl` and `currentSearchEngine` to the deps destructure and to renderer.js's instantiation (`:408`); rewrite `toUrl`'s search fallback as `buildSearchUrl(currentSearchEngine() || 'google', s)` with the Flight-2 comment. Test-side there is exactly ONE edit point: the shared harness in `test/unit/navigation-controller.test.js:34-112` that every test reuses (design review confirmed no other construction sites) — add the two deps there.
3. **Window-controller**: boot seed beside `:120`'s `applyBookmarksBar` seed; handler line beside `:131`'s `setHomePage` line, `!== undefined` guard.
4. **Asset route** (`internal-page-map.js:18-19` pattern): one line + one test case in `internal-page-map.test.js` following its existing route assertions.
5. **Settings page**: markup in `#appearance` after the home-page block (`settings.html:37-40`); fieldset/legend + radios; a `.muted` description line per engine from the table. Controller IIFE in `settings.js` following the home-page controller's shape (`:117-151`): initial `settingsGet('searchEngine')` checks the current radio; `change` handler calls `settingsSet`; `onSettingsChanged` re-checks (guard `!== undefined`). Import via serving path with the documented `@ts-ignore` convention (`settings.js:1-9`).
6. **CSS**: follow existing `#appearance` control styling (`settings.css`); no new visual language.
7. **Tests**: navigation-controller engine cases; internal-page-map route; a settings-page structural test per the `*-page-shared-scripts.test.js` pattern (no controller harness exists — see Outputs).
8. **CLAUDE.md last** — the edit extends the exact paragraph leg 1 already touched (`### Settings store`, the `homePageCache` bullet ending with the `window-controller.js:89`/`:120` citations); same working tree, sequential edit, safe under the deferred-commit model.
9. **Behavior-test enablement** (Developer prepares, FD executes): verify `npm run dev:automation` still boots with the uncommitted changes (smoke: app starts, MCP binds — no full test run); document the worktree fixture commands **in the leg's own completion entry** in the flight log (FD ruling on placement) for the FD to execute.

## Edge Cases

- **Broadcast arriving before boot seed resolves**: both call `setSearchEngine`; last-writer-wins with identical source data — benign. Do not add ordering machinery.
- **`buildSearchUrl` returning null** (unknown id in cache): structurally unreachable in F1 (validator + default), but `toUrl` must not return null into `navigate()` — coalesce the engine id, not the URL, so the built URL is always from a known id.
- **Radio `change` firing on the already-selected engine**: `settingsSet` with the same value is a harmless idempotent write + broadcast; no guard needed unless existing controllers guard (match house style).
- **A second window's Settings page open during a change**: its radio re-checks via `onSettingsChanged` — covered by the handler criterion; don't special-case.
- **Settings-page initial `settingsGet` racing a broadcast**: a broadcast landing before the initial GET resolves can be clobbered by the stale GET's `.then()`. Inherited pattern — every existing `settings.js` IIFE (home-page, shields, spellcheck, bookmarks-bar) shares it unguarded — accepted as-is, not this leg's to fix (design review).
- **`searchEngine: null` reached via raw IPC** (no UI affordance sets it in F1, but `internal-settings-set` doesn't discriminate): the radio group renders with no option checked. **Accepted F1 behavior by design ruling** — an honest rendering of unset; Flight 2 owns the unset UX. Do not add a synthetic "none" radio or coalesce the display.

## Files Affected

- `src/renderer/renderer.js` — cache, setter, accessor, deps
- `src/renderer/chrome/navigation-controller.js` — `toUrl`
- `src/renderer/chrome/window-controller.js` — seed + handler
- `src/main/internal-page-map.js` — asset route
- `src/renderer/pages/settings.html` / `settings.js` / `settings.css` — engine control
- `test/unit/navigation-controller.test.js`, `test/unit/internal-page-map.test.js`, settings-page tests
- `CLAUDE.md`

## Citation Audit

2026-08-11, against working tree (leg 1 landed, uncommitted): `navigation-controller.js:4-13` deps destructure, `:93-99` toUrl with Google at `:98` — confirmed this session post-leg-1 (leg 1 touched no renderer files). `renderer.js:47-48`, `:408`, `:478`, `:877` — confirmed. `window-controller.js:89`, `:120`, `:130-135` — confirmed. `internal-page-map.js:12-20` settings routes with shared() precedent at `:18-19` — confirmed. `settings.js:1-9` serving-path convention, `:117-151` home-page controller — confirmed. `settings.html:35-40` — confirmed. `navigation-controller.test.js:117-118` toUrl pins — confirmed. Leg 1 exports (`SEARCH_ENGINES`, `getSearchEngine`, `buildSearchUrl` null-on-miss contract) — from leg 1's flight-log ground-truth entry.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (including FD-run behavior specs — with dispositions, see the flight log 2026-08-24)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight:
  - [x] Update flight.md status to `landed`
  - [x] Check off flight in mission.md
- [x] Commit all changes together (code + artifacts) *(flight-end commit, 2026-08-24)*

> **Flight-level note**: deferred-commit model — the Developer does NOT commit and leaves the leg `in-flight` after implementation; the FD runs the behavior specs, then the flight-end Reviewer runs, then one commit closes both legs. Status `landed` is set by the FD after behavior specs pass.
