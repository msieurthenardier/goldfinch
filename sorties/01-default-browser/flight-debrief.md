# Flight Debrief: Default Browser (Sortie 01)

**Date**: 2026-09-29
**Flight**: [Default Browser](flight.md)
**Status**: completed
**Duration**: 2026-09-29 (chartered, designed, executed, and HAT'd in one session)
**Legs Completed**: 3 of 3 (2 autonomous + Windows HAT)
**Plugin version**: mission-control 1.2.0-beta.2

## Outcome Assessment

### Objectives Achieved

Goldfinch is now a single-instance browser with OS URL intake (cold argv, `second-instance`, macOS `open-url`) that opens every safe `http(s)` argument as an untrusted default-jar tab in the right window, after any session restore; the packaged app registers as a browser on Linux (`.desktop` MimeType) and Windows (NSIS Capabilities / RegisteredApplications include, update-safe); and `goldfinch://settings` has a Default browser row. GitHub issue #202 is addressed end to end. PR #239.

### Charter Criteria (sortie — stands in for mission criteria)

| Criterion | Result | Notes |
|---|---|---|
| **Windows** — listed in Default apps; external link opens as a new active default-jar tab in the last-focused window; no second process | **met** | HAT H1 (listing, per-user), H10 (all-users + uninstall removal), H3 (warm hand-off, `start` + clicked link), H4 (minimized restore). "No second process" evidenced on Linux by the behavior test (single electron PID, loser mints nothing) and on Windows by H3. |
| **Cold launch** — external link launches Goldfinch and opens the URL active; with restore on, restore first then URL in the first window | **met** | Behavior test checkpoints 7 (restore on) and 8 (restore off, no stray welcome tab); HAT H6. |
| **Safety** — non-web args never open a tab; only the untrusted `isSafeTabUrl` path | **met** | `extractLaunchUrls` unit matrix; behavior test checkpoint 4 (incl. a +13 s late re-read); HAT H7; AC7 grep-AC (no `trusted`/container on any external-URL path). |
| **Settings** (as narrowed at design approval) — Linux shows status + sets directly; Windows hands off to Default apps without claiming status | **met** | HAT H2 (row + deep link); H8 proved the narrowing right (Electron's win32 check reads a key that doesn't exist for a correctly-selected default). Linux live row/click is a recorded residual; covered at unit level by the row model. |

### Mission Criteria Advanced

None — a sortie has no parent mission; the charter above is the full assessment.

## What Went Well

- **Planning probes paid for themselves.** Checking `app-builder-lib` during flight design showed the NSIS target ignores `build.protocols` — the issue's proposed fix would have registered nothing on Windows. DD6's custom include was the flight's most valuable single call.
- **Layered reviews each caught something real.** Two Architect flight-design reviews (renderer budget at 1550/1550; `finally` that couldn't fire on a rejected boot chain; a top-level `return` that fails `tsc`), and two leg design reviews (the cold-launch target naming the LAST restored window; AC8 would have rewritten the operator's real system default; the untested row-copy matrix; exact-handler-list and harness gaps). None reached implementation.
- **The behavior test was worth its cost**: 7/7 across warm, hostile, focus-routing and three cold relaunches, live-mode agents, and it exercised boot ordering no unit test could.
- **DD9 premise re-runs** (project rule for global hooks) were executed and logged — dev/installed coexistence, DEV_MINT flow, relaunch recipe, order pins, restore gate.
- **Renderer budget handled by extraction, not compaction** (`audit-states.js`, `external-urls-controller.js`; 1550 → 1546; `SEAM_COUNT` 41).
- **Prerelease tags as a Windows HAT apparatus** replaced a local Windows build cleanly (rc.1 for the HAT, rc.2 for the fix re-check; both deleted after).

## What Could Be Improved

### Process

- **The HAT should have budgeted look-and-feel review of the new settings row.** Both HAT findings (H2-a separator/legend, H2-b button spacing) were CSS on a brand-new UI surface — predictable. A UI-adding leg should carry an explicit "screenshot + visual review against neighbouring groups" AC before landing.
- **Branch base drift.** The sortie branch was cut from the local init-project branch rather than an updated `main`; after the sync PR was squash-merged, the sortie branch carried a duplicate commit and needed a rebase before its first push.

### Technical

- `renderer.js` is at 1546/1550 — the next controller needs an extraction first.
- Residuals (recorded, accepted): packaged-Linux row/click not driven (global `xdg-settings` write); `default-web-browser` not written; win32 focus refresh during make-default can drop the transient failure line; quit-time hand-off loss; the pre-boot `second-instance` boot-tab race; macOS `open-url` unaccepted.
- `activate` still keys window creation on Electron's window count rather than registry records (consistent today; worth aligning if darwin work resumes).

### Documentation

- CLAUDE.md, `docs/dev-testing.md`, `docs/RELEASING.md`, `build/README.md` were updated during the legs.
- Missing: a short runbook for Windows-only acceptance via a prerelease tag (tag naming, what the workflow publishes, cleanup with `gh release delete --cleanup-tag`).

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| `extractLaunchUrls(argv)` dropped DD2's `{ isPackaged }` | Scheme filtering already discards exe, `.` and flags — the parameter was dead | no (design over-specified) |
| Cold-launch flush targets the FIRST created record, not `getLastFocused()` | `window-registry.create()` seeds `lastFocusedId` on every create | yes — "first-created for cold intake, last-focused for warm" |
| Leg 2 AC8 cut to its automatable part; new pure `default-browser-row-model.js` | Packaged builds have no automation surface; `xdg-settings` writes are global | yes — pure row models for any status UI |
| Windows HAT build via prerelease tags instead of a local build | Operator preference; WSL can't build NSIS | yes — document as the Windows HAT path |

## Key Learnings

- Windows default-browser status is not knowable from Electron: design is "hand off, never claim" (H8 evidence).
- `build/installer.nsh` from `buildResources` is auto-included by electron-builder; `${isUpdated}` in `customUnInstall` is what keeps a user's default across updates — the same mechanism that lost the taskbar pin in #65.
- A clean relaunch recipe must confirm the old PID is gone with `ps -p` (a `grep dev-launch` poll matches its own shell); with the single-instance lock, a relaunch against a dying instance now hands off and exits.
- Prettier re-indents chains when `.finally` is appended — source-scan pins must match semantic shape, not a literal `}).finally`.

## Test Metrics

- Full suite (`node --test`, `test/unit/*.test.js`): **5752 tests — 5748 pass, 0 fail, 4 todo** (the pre-existing `save-moment-corpus` known-unsolved cases), 0 skipped, **6.0 s** wall-clock.
- Trend: M20 F3 4996 tests / 5.33 s; M22 F1 5682 / 6.45 s; this sortie +70 tests vs M22 F1 at 6.0 s — linear growth, inside M21's 5.2–7.9 s band.
- Slowest files are all vault/automation suites untouched by this sortie (`vault-compromise-rotate` 2.41 s, `vault-txn` 1.91 s, `vault-context` 1.58 s, `navigation-controller` 1.44 s). This sortie's nine new/extended files run 62–137 ms each (pure or fake-injected; no process spawns).
- Flakes: one in-flight occurrence (vault `listItemsMeta`, leg 1) — logged as squawk 0110; none in the debrief run. First break in the recorded "0 flakes" streak.

## Methodology Observations

1. **agentic-workflow / Git Workflow (branch creation)** — the skill says "create the flight branch per that scheme at flight start" but not from which base. The FD cut it from the current HEAD, which was a just-merged-by-squash sync branch. Expected: branch from an updated default branch (fetch + `origin/main`). Cost: a duplicate commit on the branch and a rebase before first push (caught by chance when reading `git log`). Plugin 1.2.0-beta.2.
2. **agentic-workflow / 2b interactive HAT legs** — "Commit when all steps pass" assumes the verification artefact is the working tree. For a platform the FD can't run (Windows from WSL), the HAT needed a *built installer*, so each HAT fix required commit → push → tag → CI build → re-test before "all steps pass" could be true. The skill has no guidance for HATs whose apparatus is a release artefact (prerelease tag vs local build, cleanup afterwards). Cost: an extra commit and an extra prerelease cycle, decided ad hoc. Plugin 1.2.0-beta.2.
3. **sortie / charter gate vs design-time narrowing** — criterion 4 was narrowed on Windows at design approval (the FD asked, operator approved). The sortie skill says the charter is agreed before design but gives no rule for amending it once design reveals a criterion is unattainable as worded. It worked (the amendment went through the approval question), but it relied on FD judgment. Cost: none this time. Plugin 1.2.0-beta.2.
4. **flight (sortie) / design review depth** — two Architect flight-design reviews passed DD3's cold-launch target ("first record" in prose, but the mechanism named was `getLastFocused()`); the leg-1 design review caught it by reading `window-registry.create()`. Observation: the flight-level scenario trace (item 9) traced the warm path but not the cold path's target resolution. Cost: none (caught pre-implementation), but it was a real design defect that survived two flight-level reviews. Plugin 1.2.0-beta.2.
5. **behavior-test / crew apparatus notes** — live-mode (SendMessage) continuation worked well across 9 steps and three relaunches. The Executor's `ps` poll produced a false positive by matching its own command line; the Validator flagged it. The crew file's apparatus notes could carry "check liveness with `ps -p <pid>`, never a `grep` of the launcher name". Cost: one weakened evidence file. Plugin 1.2.0-beta.2.

## Recommendations

1. Add a visual-review acceptance criterion (screenshot vs neighbouring groups) to any leg that adds UI — both HAT findings would have been caught before landing.
2. Document the Windows-HAT-via-prerelease-tag runbook (naming `vX.Y.Z-rc.N`, what the workflow publishes, `gh release delete --cleanup-tag` cleanup).
3. Before the next renderer-touching flight, plan an extraction — `renderer.js` is 4 lines from its budget.
4. De-flake or diagnose squawk 0110 so the suite's flake-free lineage is restored.
5. Charter a follow-up sortie for the Node `MODULE_TYPELESS_PACKAGE_JSON` warning (CJS-by-design quartet in `src/shared/` needs a design call).

## Action Items

- [ ] Windows-HAT prerelease runbook in `docs/RELEASING.md` — squawk **0113** (deferred)
- [ ] Add "check liveness with `ps -p`" to the behavior-test crew's Project Apparatus Notes — squawk **0114** (deferred)
- [ ] Squawk 0110 — vault `listItemsMeta` flake (logged, deferred)
- [ ] Squawk 0111 — restored background tabs report `loadState: ok` (logged, deferred)
- [ ] Squawk 0112 — crash-dump debug line in packaged builds (logged, deferred)
- [ ] Future sortie: `MODULE_TYPELESS_PACKAGE_JSON` / `src/shared` module-type design
