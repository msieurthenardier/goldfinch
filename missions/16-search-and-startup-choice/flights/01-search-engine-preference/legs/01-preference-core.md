# Leg: preference-core

**Status**: completed
**Flight**: [Search Engine as a Preference](../flight.md)

## Objective

The `searchEngine` preference exists in the settings schema — curated-allowlist-validated, defaulting to Google, unset-representable as `null` for both it and `homePage` — with the v3 migration rung and pin-on-load persisting both keys explicitly to every profile's settings row, and zero renderer changes.

## Context

- Flight DD1 (engine-id storage, shared table), DD2 (`null` sentinel; typecheck is NOT the null-safety net — `jsconfig.json` has `strict: false`), DD5 (v3 ladder + pin-on-load, with the single-shot-`migrateStored` trap), DD8 (red-when-neutered allowlist test). Read the flight spec's Design Decisions in full before implementing.
- This leg is deliberately invisible: after it lands, app behavior is byte-identical for every user (default stays Google; nothing reads the new key yet). Leg 2 wires consumption.
- The store is Electron-free and persists through `app-db.js`'s documents row seam — follow the existing test harness patterns in `test/unit/settings-store.test.js` (temp userData dirs, direct row inspection).

## Inputs

- `src/main/settings-store.js` at its current state (version 2, no `searchEngine` key)
- The mission's resolved eight-engine table (`mission.md` Open Questions, first resolved entry): DuckDuckGo, Brave Search, Startpage, Mojeek, Qwant, Ecosia, Google, Bing — templates and per-engine one-line descriptions as ruled there
- `test/unit/settings-store.test.js` (1443 lines of established harness patterns)

## Outputs

- `src/shared/search-engines.js` — new shared module: ordered engine table + lookup + search-URL builder
- `src/main/settings-store.js` — schema v3 with `searchEngine`, widened validators, restructured ladder, pin-on-load
- `test/unit/search-engines.test.js` — new
- `test/unit/settings-store.test.js` — extended
- `CLAUDE.md` — settings documentation updated, home-page-caching description corrected

## Acceptance Criteria

- [x] `src/shared/search-engines.js` exports an ordered table of exactly the mission's eight engines, each `{ id, label, template, description }`, with the Startpage template using `query=` (not `q=`); the module is Electron-free (no `require('electron')`) like its `src/shared/` siblings.
- [x] The module exports a search-URL builder that substitutes an `encodeURIComponent`-escaped query into the template of a given engine id; unit tests cover substitution for every engine (including Startpage's parameter name) and query escaping (spaces, `&`, `#`, `+`, non-ASCII).
- [x] `settings-store.js` DEFAULTS gains `searchEngine: 'google'`; the `Settings` typedef widens `homePage` and adds `searchEngine` as `string | null`.
- [x] `VALIDATORS.searchEngine` accepts exactly `null` plus the eight curated ids and nothing else; `VALIDATORS.homePage` accepts `null` plus what it accepts today. `''` remains invalid for both keys — `null` is the only unset representation (flight DD2).
- [x] **Red-when-neutered (flight DD8)**: the allowlist test asserts every curated id round-trips through `set()` AND that `'kagi'`, a URL-shaped string (`'https://evil.example/?q=%s'`), `''`, and an object are each rejected by `set()` (TypeError, prior value kept) and repaired to the default by `load()`. Verified once by hand during review: neutering the membership predicate (validator accepting any string) makes at least one of these tests fail.
- [x] `DEFAULTS.version` is 3, and `migrateStored()` is restructured into per-rung guards: the v1→v2 `restoreSession` discard runs only when `from < 2`; the v2→v3 rung stamps the version (its purpose is to trigger the save-on-migrate persist). A v2 row with an explicit `restoreSession: false` keeps it through v3 migration.
- [x] **Pin-on-load (flight DD5)**: after `load()` against (a) a v2 row, (b) no row at all, (c) a corrupt row, (d) a legacy `settings.json`, the persisted row exists and contains explicit `searchEngine` and `homePage` values — asserted by reading the row back (the `readRow(dir)` direct-row pattern the suite already uses), not by inspecting in-memory config. `load()` still never throws (pin write is best-effort inside the existing contract). The unifying rule: **any load path whose resolved config differs from the on-disk bytes persists the resolved config** — note that case (c) needs code, not just a test: `parseAndRepair`'s catch currently hardcodes `migrated: false` (`settings-store.js:305-312`), so a corrupt *document row* is repaired in memory but never written back (design review finding; the corrupt-legacy-*file* path saves unconditionally, the corrupt-*row* path does not).
- [x] **Two existing tests that pin the old behavior are rewritten, not left to fail** (design review finding): `test/unit/settings-store.test.js:71-85` asserts `version === 2` (breaks on the bump) and `test/unit/settings-store.test.js:1410-1423` asserts `readRow(dir) === null` after a no-row load — the exact opposite of pin-on-load. Both are updated to pin the new behavior, **renamed** (not deleted and re-added) so git blame documents the intent shift — the Flight Control leg-design convention for tests that pin behavior a new design deliberately breaks (design-review finding; methodology rule, not a flight-local one).
- [x] Repeated `load()` is idempotent: a pinned v3 row is not re-migrated and not redundantly rewritten in a way that changes its content.
- [x] No file under `src/renderer/` or `src/preload/` is modified.
- [x] `CLAUDE.md`: the settings documentation covers `searchEngine` (curated allowlist, null-unset, the ladder-departure rationale for the v3 force-persist rung and pin-on-load), and the home-page-caching description is corrected — it currently claims the boot `settingsGet` seeds the live cache, which is false (see squawk 0005; the cache's only writer is the `settings-changed` handler). Do not fix the seeding itself — that is squawk 0005, deferred to Flight 2.
- [x] `npm test`, `npm run typecheck`, `npm run lint` all green.

## Verification Steps

- `node --test test/unit/search-engines.test.js test/unit/settings-store.test.js` (use the project's standard timeout flag) — all pass
- `grep -c require\(.electron.\) src/shared/search-engines.js` → 0
- `git status --porcelain` shows no `src/renderer/` or `src/preload/` paths
- Hand-neuter check during review (DD8): temporarily relax the searchEngine validator to `typeof v === 'string'`, run the allowlist tests, confirm failure, restore — outcome recorded in the flight log
- `npm test && npm run typecheck && npm run lint`

## Implementation Guidance

1. **`src/shared/search-engines.js` first** — data + pure functions, no dependencies. Table order is the mission's resolved order (privacy-first engines before Google/Bing). Include the engine descriptions from the mission ruling (independent-crawler vs privacy-layer provenance one-liners). The mission gives no explicit copy for Google and Bing — use neutral-factual placeholders (Google: "The most widely used search engine."; Bing: "Microsoft's search engine.") — copy refinement is an accepted leg-2 variation, but every engine ships a non-empty description from this single source. Keep the exclusion rationale (Kagi: paid/logged-in; SearXNG: instance-specific) as a comment citing the mission ruling.
2. **Schema**: add `searchEngine: 'google'` to DEFAULTS with a comment documenting the DD5 ladder departure (the v3 rung exists to force-persist, unlike every prior additive key — cite `settings-store.js`'s own convention note it departs from). Wire `VALIDATORS.searchEngine` off the shared table's id set (import the table — `settings-store.js` already imports from `src/shared/` at `settings-store.js:24 — "require('../shared/url-safety')"`).
3. **Validators**: widen as `v === null || <existing/membership check>`. Do not touch NORMALIZERS.
4. **Ladder restructure** (`settings-store.js:migrateStored`): current body discards `restoreSession` whenever `from < DEFAULTS.version` — after the version bump that predicate would wrongly re-run the v1 transform on v2 rows. The only *transform* rung is `if (from < 2) { delete next.restoreSession }`; there is no v3-specific transform — the v3 "rung" is just the unconditional `next.version = DEFAULTS.version` stamp at the end (already how the stamp works today), whose entire purpose is tripping the save-on-migrate persist. Preserve the `from >= DEFAULTS.version` early return and the null/array/non-integer-version guards verbatim; don't invent v3 transform logic.
5. **Pin-on-load, three branches**:
   - *Row present*: the existing save fires only `if (parsed.migrated)` (`settings-store.js:344-353`) — but `parseAndRepair`'s catch returns `migrated: false` for corrupt bytes, so extend the signal so the row-present branch persists when the row was corrupt OR migrated (e.g. have the catch flag "resolved config must be rewritten" — pick the cleanest shape, keeping the flag's name honest).
   - *No row*: extend the `config = freshDefaults()` branch with the same best-effort `try { save(config) } catch {}` and a comment naming DD5.
   - *Legacy `settings.json`*: already saves unconditionally — test it, don't touch it.
   Verify each path by reading the row back via the suite's `readRow(dir)` pattern.
6. **Tests**: follow `settings-store.test.js` house style (temp dirs, explicit round-trips, "prior value kept" assertions). Name the neuter-sensitive tests so their intent is legible (e.g. `searchEngine — non-curated id rejected, prior value kept`).
7. **CLAUDE.md last**, once mechanisms are final.

## Edge Cases

- **Pin save failure** (read-only disk, etc.): in-memory config is still correct; `load()` must not throw. Same posture as the existing migration save.
- **Outer-catch fallback path** (`fs.existsSync` or another legacy-branch statement throws before defaults resolve): config resets to defaults and NO pin is attempted — consciously accepted; the never-throw boot contract outranks pinning in this vanishingly rare path, and the idempotent pin simply retries next load.
- **`null` round-trip**: a stored `null` for either key must survive load → getAll → save unchanged (it is valid, not repaired). Test it — in this flight nothing *writes* null, but Flight 2 depends on it surviving.
- **Unknown engine id in a stored row** (e.g. an engine later removed from the table): repairs to default `'google'`, silently, at load — the mission's repair-without-blocking-startup criterion.
- **`homePage: ''` in a stored row**: still invalid, still repairs to default — `''` is not and must not become a second unset representation.
- **v1 row**: gets BOTH transforms (restoreSession discard + v3 stamp + pin) in one load.
- **Legacy `settings.json` containing any of the above**: same repair semantics through `parseAndRepair` — the shared path means no extra code, but add one test to prove it.

## Files Affected

- `src/shared/search-engines.js` — new
- `src/main/settings-store.js` — DEFAULTS, typedef, VALIDATORS, migrateStored, load
- `test/unit/search-engines.test.js` — new
- `test/unit/settings-store.test.js` — extended
- `CLAUDE.md` — settings section + home-page-caching correction

## Citation Audit

2026-08-11, against working tree at `c8563f3`: `settings-store.js` read in full this session — DEFAULTS `:48-101`, version constant `:51`, homePage validator `:135-138`, VALIDATORS `:132-192`, NORMALIZERS `:199-204`, `migrateStored` `:279-296` (single-shot predicate confirmed at `:288`), `load` `:326-381`, save-on-migrate `:344-353`, shared-module import precedent `:24`. Test harness patterns confirmed in `test/unit/settings-store.test.js` (round-trip and prior-value-kept idioms throughout). All citations current.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight: *(not the final leg — handled by leg 2)*
  - [x] Update flight.md status to `landed`
  - [x] Check off flight in mission.md
- [x] Commit all changes together (code + artifacts) *(deferred-commit model: one flight-end commit, 2026-08-24)*

> **Flight-level note**: this flight runs the deferred-commit model — the Developer does NOT commit or complete this checklist's commit step at leg end; review and commit happen once after the final leg (flight spec, Technical Approach). Status updates and flight-log entries still happen per leg.
