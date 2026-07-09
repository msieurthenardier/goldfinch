# Flight Log: Parity Sweep, Mission Landing & v0.6.0 Release

**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](flight.md)

## Summary
Planning. F6 is the mission-landing + release flight: SC3 browsing/tab/chrome corpus on the native surface,
the F5 debrief carry-forwards + the parked `<webview>` sweep, macOS build-readiness, merge `mission/05` → `main`,
and a real v0.6.0 GitHub release with all installers.

---

## Reconnaissance Report

Source: the **Flight-5 debrief** action items + the **mission** SC/roadmap, walked against current code (2026-07-08).

| Item (source) | Classification | Evidence / recommendation |
|---|---|---|
| SC3 browsing/tab/chrome corpus on new surface | `confirmed-live` | 8 specs (core-browsing-shields, unified-tab-controls, responsive-tab-strip, tab-keyboard-operability, settings-shell/controls/activity-viewer, toolbar-pins); prior run logs are pre-migration → re-run on the native surface. **Leg 1.** |
| `nav.js` internal-guard asymmetry (F5 debrief) | `confirmed-live` | `nav.js` lacks the op-local `isInternalContents` guard `zoom`/`find`/`print`/`observe` carry (`resolve.js:104` honors admin `allowInternal`). Add the guard. **Leg 2 (DD6).** |
| Doc reconciliations: page-context Escape target; mcp-drive Preconditions (F5 debrief) | `confirmed-live` | CLAUDE.md page-context prose says "address bar" vs spec `#kebab`; `mcp-drive-end-to-end.md` Preconditions frame the run jar-only. **Leg 2.** |
| `<webview>`→WebContentsView terminology sweep (mission Known Issue) | `confirmed-live` | ~15 specs' prose + `src/preload/webview-preload.js:1-5` header + residual source comments. Prose/comments only; zero functional dependency. **Leg 2 (DD5).** |
| DD9 mint-gate OFF-branch never positively witnessed (F5 debrief) | `confirmed-live` | Dev profile was `automationEnabled:true` in F5; witness the persisted-false ⇒ mint-DISABLED branch. **Leg 1 (apparatus-gated).** |
| Keyboard-bridge macOS HAT + WSLg-authoritative items (CDP-conflict, find count, focus-ring/squiggle, F10 key) | `needs-human-recheck` | No in-loop mac venue (DD2). **Deferred** — post-release/contributor follow-ups + carried to the mission debrief; NOT F6 gates. |
| Live two-agent Witnessed re-run of the 2 BLOCKING security specs (F5 debrief) | `needs-human-recheck` | Belt-and-suspenders; no defect suspected (Leg-3 offline validation + source cross-check stand). **Optional** — carry to mission debrief, not an F6 gate. |
| Retire the "947 baseline" convention (F5 debrief) | `already-satisfied` (methodology) | Not F6 code work; captured in the F5 debrief for future out-of-order flights. |
| Release infra | `confirmed-live` | electron-builder `^26.x` → GitHub Releases; `build.yml` tag-driven (`v*`) with `workflow_dispatch` build-only smoke; `GITHUB_TOKEN` only; version 0.5.7. **Legs 3/4/6.** |

**Decisions confirmed with operator (2026-07-08):** macOS = build-readiness only; cut a real v0.6.0 release; land
the `<webview>` sweep. See flight.md DD1–DD9.

---

## Flight Director Notes

- **2026-07-08 — F6 execution started (`/agentic-workflow`).** Branch `flight/06-parity-land-and-release` off
  `mission/05`; plan committed (`19d6c9b`); `ready`→`in-flight`. Legs run sequentially (the `<webview>` sweep in
  Leg 2 rewords specs Leg 1 drives). Legs 5–6 (merge, tag/publish) are operator-gated.
- **Leg 1 hit two transient `529 Overloaded` API errors** (server-side spike). First Executor completed 2 specs
  (core-browsing-shields, unified-tab-controls — both PASS) then died; a continuation immediately 529'd. Backed
  off ~5 min, then a retry completed the remaining 6 + DD9. No work lost (run logs are per-spec, timestamped).
- **Leg 1 accepted on Executor evidence + FD triage; per-spec Validator deferred** (conserving API during the 529
  spike). The final flight Reviewer (Phase 2d) covers the whole diff. Findings all PASS / classified non-blocking.

## Leg Progress

### Leg 1 — sc3-browsing-corpus (SC3)
**Status**: landed
**Completed**: 2026-07-08

#### Result: SC3 browser-behavior parity PASS — 8/8 specs + DD9 OFF-branch (no regressions)
| Spec | Verdict |
|------|---------|
| core-browsing-shields | PASS 6/6 |
| unified-tab-controls | PASS (1 apparatus-inconclusive sub-obs) |
| responsive-tab-strip | PASS 8/8 |
| tab-keyboard-operability | PASS 8/8 |
| settings-shell | PASS (2 SPEC-DRIFT below, 1 apparatus-limit) |
| settings-controls | PASS (8/8 drivable; 9–12 F8-deferred per spec) |
| settings-activity-viewer | PASS 8/8 (pager/freeze ran cleanly, not the pre-classified WSLg limit) |
| toolbar-pins | PASS 13/14 (step 9 F8-deferred) |
| **DD9 mint-gate OFF-branch** | **PASS** — persisted-false ⇒ toggle OFF + all 13 mint buttons DISABLED; Revoke governed by `hasKey` not the toggle; no auto-revoke. Closes the F5 debrief follow-up. |

- **Spec-drift → Leg 2 (`carry-forwards-and-webview-sweep`) reconciliations:** (a) settings-shell step 10 — "Site
  settings" opens `goldfinch://settings/#privacy` (the F7 rewire, correct behavior; spec text stale); (b)
  settings-shell step 11 — the internal-tab nav-lock is now a **read-only address bar** (`readOnly=true` on
  internal, editable on web) — a stronger invariant + changed UX; **FD accepts as intended** (a reasonable trust
  hardening consistent with the internal nav-lock); update the spec text.
- **Pre-existing tensions → mission debrief (NOT F6-introduced; F6 Leg 2 hadn't run yet):** (1) the axe a11y
  harness cannot inject into the internal `goldfinch://settings` target (DD5 internal-session exclusion refuses
  `injectScript`/`evaluate`) — a settings-page a11y **coverage gap**; the default `npm run a11y` gate (green in
  F5 Leg 6) covers the chrome shell + sheets, not the internal page. (2) internal-tab enumerability/drivability
  under the **admin** key is the already-settled admin-`allowInternal` behavior (jar exclusion intact — F5 triage);
  Leg 2's `nav.js` hardening closes the mutating-nav slice of it.

### Leg 2 — carry-forwards-and-webview-sweep (DD5/DD6/DD10)
**Status**: landed
**Completed**: 2026-07-08

#### Changes Made
- **`nav.js` hardening (DD6 — the one real code change).** Added the op-local `isInternalContents`
  post-resolve guard to **all four** nav ops (`navigate`/`goBack`/`goForward`/`reload`), mirroring
  `zoom.js`/`print.js`. Each guard fires AFTER `resolveContents` so it refuses the internal
  `goldfinch://settings` session **even under the admin `allowInternal:true` relaxation**
  (`resolve.js:104` skips its internal throw for admin). Error shape copied from the siblings:
  `automation: {op} — internal-session excluded`. Imported `isInternalContents` alongside
  `resolveContents`.
- **New admin-path unit tests (acceptance-critical).** The pre-existing internal-refusal cases pass
  `deps` WITHOUT `allowInternal`, so they only exercise `resolveContents`'s throw and would stay green
  even with the op-local guard broken. Added **5 new tests** to `test/unit/automation-nav.test.js`, all
  constructing `deps` **with `allowInternal:true`**: one per op asserting the internal wcId is refused
  by the op-local guard AND no navigation side-effect fired (`loadURL`/`goBack`/`goForward`/`reload`
  not called), plus a guest-tab control asserting the guard is internal-only (guest still drivable
  under `allowInternal:true`). Nav suite 26 → 31 tests.
- **Doc reconciliations.** (a) `CLAUDE.md` page-context Escape target aligned to the observed `#kebab`
  (two occurrences — the page-context-menu prose + the menu-overlay close-family policy line, both had
  said "address bar"). (b) `mcp-drive-end-to-end.md` Preconditions gained a Key-tier line noting Step 9's
  admin-only `captureWindow` needs the admin key (Steps 1–8 are jar-driven). (c) `settings-shell.md`
  step 10 now expects "Site settings →" to navigate to `goldfinch://settings/#privacy` (F7 rewire), not a
  slide-out panel; step 11 rewritten to assert the read-only-address invariant (`readOnly=true` on internal,
  editable on web) instead of the retired "type a web URL → new tab" affordance; Intent parenthetical updated
  to match.
- **`<webview>`→WebContentsView terminology sweep (DD5, prose/comments only).** Reworded stale present-tense
  `<webview>` references across **14 behavior specs** (16 occurrences); the one remaining spec occurrence
  (`panel-slide.md`) is a deliberate historical contrast, requalified as "the legacy `<webview>`
  implementation". Reworded the `webview-preload.js` header (also corrected the stale `ipcRenderer.sendToHost`
  → `ipcRenderer.send('guest-media-list')`, matching the actual code; filename retained per whitelist) and
  3 stale present-tense source comments (`renderer.js` context-menu comment, `chrome-preload.js` devtools-spike
  note, `main.js` wireGuestContents header). Historical "removed"/"legacy"/"old `<webview>`" comments left as-is
  (whitelisted). No functional spec steps, tool names, selectors, or code logic changed.

#### SC1 source-absence verification (DD10)
Ran the functional-form greps over `src/`:
- `grep -rn "createElement(['\"]webview['\"])" src/` → **0 hits** (no constructed `<webview>` element).
- `grep -rEn "<webview[ >/]" src/ --include=*.html --include=*.js` → only prose/comments (historical
  "removed"/"not a `<webview>`" statements + the whitelisted `webview-preload.js` filename note); **no
  literal `<webview>` element in any HTML/renderer file**.
- `grep -rn "webviewTag" src/` → **1 hit**, a `renderer.js` comment stating "No `will-attach-webview`
  handler or `webviewTag` option remains" (whitelisted historical); **no functional `webviewTag:`
  webPreferences key**.
- `grep -rn "will-attach-webview" src/` → same single whitelisted comment; **no registration**.
Confirmed residuals are exactly the whitelist: `webview-preload.js` filename, the `#webviews` DOM slot id,
and historical "removed" comments. **SC1 (DD10) satisfied.**

#### Notes
- Verify gates all green: `npm test` **1065/1065** (1060 baseline + 5 new nav tests), `npm run typecheck`
  clean, `npm run lint` clean.
- **Housekeeping:** three untracked ephemeral scratch driver files left at the repo root from Leg-1
  behavior-test runs (`parse-tmp.mjs`, `scratch-ax.mjs`, `scratch-drv.mjs` — one self-labeled "Ephemeral
  behavior-test driver") were the *only* `npm run lint` failures (node-globals `no-undef`); none of the
  leg's changed files had lint errors. Relocated them out of the repo tree (to the session scratchpad) to
  clear the gate and keep the flight's batch commit clean; they are regenerable and no tracked Leg-1
  artifact was touched.

### Leg 3 — release-readiness (local)
**Status**: landed
**Completed**: 2026-07-08

#### Result: PASS — linux installers build cleanly; config sound
- **Config audit:** electron-builder build block sound (mac dmg/zip, win nsis, linux AppImage/deb → GitHub
  Releases via `GITHUB_TOKEN`; tag-driven version sync); `asar:false` + `files:["src/**/*"]` confirmed
  **deliberate** (pre-existing; electron-builder warns but it's the intended unbundled-source ship). `build.yml`
  Architect-verified (tag-driven `v*`, `workflow_dispatch` build-only, 3-platform matrix).
- **Local linux installer smoke (PASS):** `npx electron-builder --linux --publish never` → exit 0;
  `Goldfinch-0.5.7.AppImage` (125M) + `goldfinch_0.5.7_amd64.deb` (97M) built (version 0.5.7 pre-bump). Benign
  warnings: asar-disabled (intended), **`desktopName` not set** (cosmetic linux window-association nicety →
  post-release polish), duplicate-dep references (cosmetic, from the express/MCP deps).
- **macOS build-readiness (DD2):** builds via GitHub Actions `macos-latest`, unsigned (`identity:null`); runtime
  mac verification deferred (no in-loop venue) — carried to the mission debrief.
- `dist/` removed after the smoke (gitignored regardless).

## Decisions

### DD7 refinement — the 3-platform CI dry-run runs post-merge-pre-tag (not on the feature branch)
**Context**: triggering `build.yml` via `workflow_dispatch` needs the code on a *remote* branch; the feature
branch is not pushed separately (that trends toward the operator-gated zone).
**Decision**: Leg 3's autonomous part is LOCAL (config audit + linux installer smoke — both done, PASS). The full
3-platform build-only dry-run runs **after the operator-gated merge to `main`, before the tag** — still
pre-publish, satisfying DD7's "catch a broken build before publishing" intent.

_(further runtime decisions recorded here)_

## Deviations

_(none yet)_

## Anomalies

### Page-context Escape focus-return: observed `#kebab` vs code `address bar` (non-blocking, follow-up)
**Observed**: F5's page-context behavior test saw Escape return focus to `#kebab`; F6 Leg 2 "reconciled"
CLAUDE.md to `#kebab`.
**Code truth**: `renderer.js` page-context escape refocus is `returnFocus` (keyboard invocations) **else
`els.address.focus()`** (the address bar) — a right-click menu (returnFocus null) → address bar.
**Resolution**: the final Reviewer caught the doc/code mismatch; FD reverted CLAUDE.md to the code-accurate
"returnFocus else address bar". The `#kebab` observation is likely a keyboard/`returnFocus`-was-kebab scenario.
**Follow-up (non-blocking, → debrief):** re-observe the page-context Escape target precisely per invocation
(right-click vs keyboard) and reconcile `page-context-menu.md`'s expected result accordingly. Does not affect v0.6.0.

## Session Notes

- **2026-07-08** — F6 planned via `/flight` after F5 completed. Reconnaissance above. Three planning decisions
  locked with the operator (macOS build-readiness only; real v0.6.0 release; land the `<webview>` sweep).
- **2026-07-08 — Architect design review (Phase 5b): approve-with-changes.** All codebase claims verified
  (release path `build.yml`, nav.js asymmetry, SC3 corpus, `<webview>` prose-only, clean FF merge). Fixes
  incorporated: (1) **[HIGH]** DD6 — the existing `automation-nav` unit tests give false coverage (assert
  internal refusal *without* `allowInternal`, so they miss the admin path); scoped the guard to all 4 nav ops and
  made "unit tests assert refusal with `allowInternal:true`" a Leg-2 acceptance criterion. (2) **[MED]** SC1
  defined as absence of the *functional* forms + a whitelist (preload filename, `#webviews` id, historical
  comments) — DD10. (3) **[MED]** unsigned/un-notarized mac installer → release notes must disclose + give open
  instructions — DD11. (4) **[MED]** `build.yml` `update-readme` auto-commits to `main` on a stable publish →
  noted in `cut-release`. (5) **[LOW]** pre-tag version==tag check; confirm `asar:false`+`files:src/**` deliberate.
  Two operator-facing decisions surfaced: ship unsigned mac publicly (with disclosure) vs withhold; and confirm
  the `update-readme` auto-commit is desired on the cut.
