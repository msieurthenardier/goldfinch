# Flight Debrief: Core Conveniences — Zoom & Print

**Date**: 2026-06-18
**Flight**: [Core Conveniences — Zoom & Print](flight.md)
**Status**: completed
**Duration**: 2026-06-18 (single session, `/agentic-workflow` + HAT)
**Legs Completed**: 6 of 6 (5 autonomous + 1 HAT; leg 05 added mid-flight)

## Outcome Assessment

### Objectives Achieved

The flight delivered both decision-light Chromium-engine conveniences and their agent-parity tools:
- **Page zoom** (SC1) — `Ctrl +`/`-`/`0` captured main-side via a `before-input-event` listener on each guest (works page-focused), renderer fallback for chrome-focus, and (after the HAT) a polished **in-address-bar zoom control** `[−] % [+] ⟳` with hover-reveal/auto-fade and a **query-on-demand** label that tracks Chromium's per-origin-per-session truth.
- **Print / Save-as-PDF** (SC2) — `Ctrl+P` + kebab **Print…** → `webContents.print()`; operator-confirmed the native dialog → Save-as-PDF. Failures are logged (not swallowed) for the WSLg no-printer case.
- **Agent parity** (SC8 part) — `getZoom`/`setZoom` (factor, clamped) + `printToPDF` (base64), jar-scoped + admin, with op-local internal-session guards. Tool count 24.

### Mission Criteria Advanced

- **SC1** — met (live-verified across the per-origin matrix).
- **SC2** — met (automation `printToPDF` proof + operator-confirmed native dialog).
- **SC8 (part)** — met (jar-scoped + admin, live-confirmed under both key identities).
- **A11y cross-cutting bar** — held (0 new violations).

All checkpoints met. Behavior tests `page-zoom` (6/7; step 7 = HAT) and `print-to-pdf` (core; step 3 = HAT) are `active` with committed run logs.

## What Went Well

- **Precise, load-bearing design decisions.** DD3 (op-local `isInternalContents` guard *after* resolve, because admin runs `allowInternal:true`), DD4 (base64 via `okResult`, not `imageResult`; flat schemas), and DD6 (`before-input-event` capture + the foreseen `pressKey` `=`/`-`/`+` apparatus dependency) all held in practice with no revision. The DD6 handler was sensibly consolidated to also carry `Ctrl+P`, and matches `=`/`+` regardless of shift for US-layout `Ctrl+Shift+=`.
- **Live verification caught a real defect unit tests could not.** Running the gate under *both* an admin and a jar key surfaced the SC8 jar-scope-parity break (new tools missing from `scope.js` `WCID_FIRST_OPS`) before merge. The two-axis apparatus audit (can it *act* AND *observe*) plus the dual-key run is exactly what earned its keep.
- **Adaptive recovery.** The defect became a tight, well-scoped mid-flight leg (`05-jar-scope-parity`, a one-line `WCID_FIRST_OPS` append + a positive in-jar test), with the rationale recorded in the flight-log Anomalies — clean traceability rather than a silent patch.
- **The HAT genuinely improved the product.** It turned a basic toolbar chip into the in-address-bar control the operator wanted, and caught three renderer bugs (initial-mount hover; stale label on host-zoom inheritance; stale label on same-origin tab switch) that no automation step asserted. The final query-on-demand label is a better architecture than the cache it replaced.
- **Strong, fast, deterministic automation-seam tests.** Guards proven with `allowInternal:true` (the op-local guard fires, not `resolveContents`), clamp bounds both directions, factor validation asserting `setZoomFactor` is *not* called, `printToPDF` activate-ordered-before-print + base64 round-trip, flat-schema invariant.

## What Could Be Improved

### Process

- **`WCID_FIRST_OPS` three-place registration is a recurring recon blind spot (now seen twice).** A new wcId-first automation op must register in **three** places — `engine.js` (dispatch), `mcp-tools.js` (ToolDef), and **`scope.js` `WCID_FIRST_OPS`** (jar façade) — plus the op-local internal guard if it can touch internal pages. Legs 2/3 enumerated only the first two; F09 hit the same surface and *did* register all three, so the recon template (not the people) is the gap. This single miss is the entire reason leg 05 existed.
- **Internal-refusal steps were mis-specified as automation-reachable.** `page-zoom` S7 and `print-to-pdf` S3 assumed the apparatus could hand an op a `goldfinch://settings` wcId; it structurally cannot (`openTab`→null, `enumerateTabs` filters internal) — which is the boundary working. DD5's claim that "the admin key exercises the op-local guard via the behavior test" was wrong at the apparatus level: the admin key *bypasses* jar scoping but still can't be *handed* an internal wcId. These should have been authored as HAT/unit checkpoints from the start.

### Technical

- **The displayed-value architecture (cache vs live-query) should have been a Design Decision, derivable at leg 1.** The leg-1 live check refuted "per-tab" in favor of per-origin-per-session — at which point "a per-`wcId` cache fed by active-tab-only `zoom-changed` broadcasts cannot track origin-shared state" was derivable. But DD1 updated only the *test invariant*, not the *display architecture*, so the staleness surfaced as two reactive HAT patches plus a cache-retirement commit. The query-on-demand label (chrome IPC `get-zoom` → `wc.getZoomFactor()`, with an `activeTabId` race-guard) is the right end state and should have been the up-front decision.
- **Duplicated zoom bounds.** `ZOOM_MIN=0.25`/`ZOOM_MAX=5.0` are declared in both `src/main/main.js` and `src/main/automation/zoom.js` (deliberate — the automation module must not import the Electron entry — but unguarded against drift; the `ZOOM_LADDER` lives only in `main.js`). Extract `{ ZOOM_MIN, ZOOM_MAX, ZOOM_LADDER }` into a dependency-free `src/shared/` module both can import (the project already keeps cross-process constants like `url-safety.js` there).
- **`get-zoom` (chrome IPC) vs `getZoom` (MCP tool) naming overlap.** Two reads of `wc.getZoomFactor()` in two trust domains share a name; the distinction is kept by prose/comments, not structure. Acceptable, but document it (below) so a future reader doesn't "consolidate" them.

### Documentation

- Add the chrome-IPC `get-zoom` vs MCP `getZoom` trust-domain distinction to `docs/mcp-automation.md` (currently code-comment-only).
- Document that keyboard zoom snaps `setZoom`'s arbitrary float to the nearest `ZOOM_LADDER` rung (an undocumented, defensible UX seam).
- **Stale artifact note:** the leg-04 flight-log entry says CLAUDE.md "still says 21 tools … left untouched" — but the leg-04 commit *did* update CLAUDE.md to 24/15-drive. Correct the note so a future maintainer doesn't hunt a non-existent stale count.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Added mid-flight leg `05-jar-scope-parity` | Live verification caught the SC8 jar-façade gap legs 2/3 missed | **No** (the leg shouldn't have been needed — standardize the *recon checklist* that prevents it instead) |
| Live gate driven via goldfinch's own example MCP client over Bash (Executor agent) + Flight-Director-as-Validator, not the formal two-agent `/behavior-test` | The goldfinch MCP isn't a registered session MCP and can't be added mid-session | **Situationally** — document this fallback for projects whose apparatus is a local loopback MCP not registered in the session |
| Ran on port 49801 | WSLg default 49707 held by an external Windows service (NVDisplay.Container) | **No** — environment-specific; but note the `GOLDFINCH_MCP_PORT`/`GOLDFINCH_MCP_URL` override worked cleanly |
| DD1 "per-tab" sub-hypothesis refuted live (per-origin-per-session) | Chromium host-zoom map is per-origin-per-session | **Yes** — bake the model into future flights touching session-shared Chromium state |
| Toolbar chip → in-address-bar zoom control | Operator request during HAT (alignment) | **Yes** as a *product* pattern; the HAT loop worked as intended |

## Test Metrics

- **Full suite (`npm test`, single run):** **803 pass / 0 fail / 0 skipped**, 12 suites, **~0.89s** wall-clock. No flakes. `npm run lint` clean; `npm run typecheck` clean.
- **New/changed suites:** `automation-zoom.test.js` (NEW, 18 tests), `automation-print.test.js` (NEW, 5 tests, ~202ms — the `waitForPaint` 80ms `setTimeout` dominates), `automation-scope.test.js` (+leg-5 positive parity test), `automation-input.test.js` (+`=`/`-`/`+` keyEvents), `automation-mcp-tools.test.js` / `automation-mcp-server.test.js` (tool count 21→24).
- **Trend vs prior debrief (M03/F10):** 773 → **803** pass (+30), wall-clock **flat at ~0.89s**, zero new failures/skips/flakes. All +30 tests are in the automation seam; **none in the renderer** — see Key Learnings.

## Key Learnings

1. **Two recon axes for every new wcId automation op.** The internal-exclusion axis (op-local guard / admin path) and the jar-membership axis (`scope.js` `WCID_FIRST_OPS`) are *independent*; getting one right (DD3) does not imply the other. A new guest-targeting op lands in exactly three places.
2. **Query Chromium truth on demand for session-owned implicit state.** If Chromium can mutate a wcId's state without emitting an event for *that* wcId (host-zoom map re-zooming siblings; origin-inherited zoom on load), the renderer must *read it on demand*, not cache-and-broadcast. This generalizes directly to find-in-page match counts and devtools attach state.
3. **`per-origin-per-session` is the established Chromium state model** for zoom (and likely spellcheck/dictionary and download history) — assert it up front in future flight designs rather than rediscovering it.
4. **The persistent renderer-test gap is where the bugs live.** Every HAT bug this flight was renderer logic (race guard, query refresh, initial mount, internal-tab hide) — pure logic, not pixels — yet there is no renderer unit harness, so they were operator-found. This theme recurs across many prior debriefs.

## Recommendations

1. **[Critical] Make "three-place wcId-op registration" a hard leg-recon gate + a CI guard.** For any leg adding a guest-targeting automation op, list `engine.js`, `mcp-tools.js`, **and `scope.js` `WCID_FIRST_OPS`** as explicit deliverables. Add a **membership-equality** test to `automation-scope.test.js` asserting the expected op set *equals* `WCID_FIRST_OPS` (the current per-op iteration test is blind to a *missing* op) so a forgotten façade entry fails CI instead of waiting for live verification. This eliminates the entire `jar-scope-parity` class.
2. **[Important] Author a `zoom-control` behavior-test spec** covering the DD1 label cases (a)–(f) — zoom-active, same-jar sibling on tab-switch, fresh inherited tab, cross-jar independence, reset, internal-tab no-op. The seams are already driveable (`getZoom`/`setZoom`/`pressKey` + reading `#zoom-percent` via `evaluate` on the chrome target — the exact self-test run this flight). This converts the "verified by reasoning + one-off self-test" into a re-runnable regression gate and starts closing the renderer-verification gap with the project's own apparatus. (See `.claude/skills/behavior-test/AUTHORING.md`.)
3. **[Important] Bake "live-query, not cache, for session-owned implicit state" into the find-in-page and devtools flight designs** as a stated Design Decision — with the same `activeTabId` race-guard pattern — rather than rediscovering it through HAT bugs.
4. **[Important] Pre-classify internal-refusal and OS-native steps as HAT/unit, never automation-surface steps.** The apparatus cannot hand an op a `goldfinch://` wcId or open the OS print dialog. Bake this into behavior-test authoring for context-menu and any flight with internal/web no-op semantics.
5. **[Minor] Extract shared zoom constants** (`ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_LADDER`) into a dependency-free `src/shared/` module with a sync test; consider exporting a shared `waitForPaint` from `observe.js` so `print.js` and future capture-style ops don't each carry a local copy. Add the `get-zoom` vs `getZoom` and ladder-snap docs notes; correct the stale leg-04 CLAUDE.md note.

## Action Items

- [x] Add a `WCID_FIRST_OPS` membership-equality test to `test/unit/automation-scope.test.js` (CI guard for the three-place registration). **Done (2026-06-18)** — non-circular cross-check derives wcId-first tools from the authoritative `mcp-tools.js` registry and asserts each is in `WCID_FIRST_OPS` (or an explicit, currently-empty `WCID_FIRST_EXEMPT`); deliberate-break verified (removing `getZoom` fails the test). Pointer comment added at the `WCID_FIRST_OPS` declaration. Suite now 804.
- [ ] Author a `zoom-control` behavior-test spec (DD1 cases a–f) during the next planning conversation; run via `/behavior-test zoom-control`.
- [ ] Carry forward to **Flight 2 (find-in-page)** and **Flight 3 (devtools)** designs: the three-place op-registration checklist; "live-query not cache" for session-owned implicit state; internal-refusal-as-HAT.
- [ ] Extract `src/shared/` zoom constants + sync test (opportunistic, when the next main/automation-shared constant appears).
- [ ] Docs: `get-zoom` vs `getZoom` distinction + ladder-snap behavior in `docs/mcp-automation.md`; correct the stale leg-04 CLAUDE.md note in the flight log.
