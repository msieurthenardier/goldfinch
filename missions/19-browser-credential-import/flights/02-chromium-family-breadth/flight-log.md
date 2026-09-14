# Flight Log: Chromium Family Breadth

**Flight**: [Chromium Family Breadth](flight.md)
**Mission**: [Browser Credential Import](../../mission.md)

Runtime decisions, deviations, and anomalies recorded here during execution.

---

## Reconnaissance Report (Phase 1b) — 2026-09-14

Source artifact: the Flight 1 debrief
(`../01-chrome-password-import/flight-debrief.md`). Each action item / forward
recommendation walked against current code (post-turnaround, main c98bed3).

| Item | Classification | Evidence | Recommendation |
|---|---|---|---|
| Document the vault-page-model pure-extraction pattern | already-satisfied | squawk 0065, landed in the 2026-09-11 turnaround (PR #209); CLAUDE.md `### Password vault` now carries the note | retire — done |
| Cite internal-page-route-closure.test.js as a standing guard | already-satisfied | squawk 0066, landed PR #209; CLAUDE.md "Adding an internal page" cites it | retire — done |
| not-set-up-with-jars regression test | already-satisfied | squawk 0064, landed PR #209; `test/unit/vault-page-model.test.js` case added | retire — done |
| Real-boot internal-page smoke check | confirmed-live | no such test exists; needs its own design | out of THIS flight's scope — a standing recommendation (maintenance), not Flight 2 work |
| vault.js restore-modal extraction (M18 F3 rec 2) | confirmed-live | `vault.js` = 2820/2820 (`seam-contract.test.js:193`); restore modals still in `vault.js:715-1252` | **in scope — leg 1 (DD4), operator-ruled to bundle here** |
| Generalize detectChromeExport to the Chromium family | confirmed-live | `browser-import.js:65` Chrome-exact `CHROME_HEADER`; controller strings Chrome-specific (`vault-browser-import-controller.js:54,91-92`) | **in scope — leg 2 (DD2)** |
| Activate dormant blocklist code if Edge emits it | already-satisfied (as no-op) | real Edge sample has no blocklist shape; empty-password rows are federated `no-password` (DD3) | no code needed; recorded |
| Multi-source labeling in the resume slot | retired-by-decision | operator ruled generalized guidance, no source tag (DD2) — no source label anywhere, so no multi-source labeling to do | retire — superseded by DD2 |
| Verify a real Edge export before designing | already-satisfied | done at planning: header byte-identical to Chrome (`name,url,username,password,note`), 8 rows exercising empty-pw/empty-user/android (DD1) | premise resolved |

Net: three debrief follow-ups already landed in the turnaround; the real-boot
smoke check stays a standing (non-Flight-2) recommendation; the extraction and
the Chromium generalization are Flight 2's two build legs; blocklist and
multi-source labeling dissolve given the real format + the generalized-guidance
ruling.

## Planning notes — 2026-09-14

- Operator produced a real Edge export (`~/Downloads/edge.csv`, not committed).
  Inspected header + structure ONLY (no credential values read): header
  `name,url,username,password,note` (identical to Chrome), 8 data rows, 2
  empty-password (federated), 3 empty-username, schemes 7 https + 1 android.
  Premise for DD1 resolved against a real file.
- Operator rulings this planning: (1) produce a real Edge export to verify
  format — done; (2) generalized Chromium guidance, NO source picker (DD2);
  (3) bundle the vault.js restore-modal extraction as leg 1 (DD4); (4) include a
  per-flight guided HAT (DD5). The leg-1 headroom premise (Edge UI needs room)
  was invalidated by DD1+DD2 (Edge adds only copy changes, not vault.js UI); the
  operator chose to keep the extraction bundled anyway as debt paydown — recorded
  as a deliberate, decoupled inclusion, not a headroom necessity.

## 2026-09-14 — Design review (Architect): approve with changes

Incorporated all findings (spec-text only; no leg or DD reversal, so no second
review cycle — the M19 precedent):
- **(high)** `pendingImportRecord` is touched at SIX sites, only three inside
  the extracted functions — leg 1 is a state-ownership refactor, not a verbatim
  move. DD4 now specifies it becomes controller-owned closure state exposed via
  a getter/loader (mirroring `browserImport.heldRecord()`), with vault.js's five
  external sites rewritten to the accessor.
- **(medium)** `openExportModal` shares `buildVaultSelect` with `openMappingModal`
  — extract it alongside the restore modals (default now, not "acceptable
  variation"), keeping the shared helper's consumers in one file. The invariants
  also scan `openExportModal` (`:321,:344`) — retargeted too.
- **(medium)** the CP2 grep-AC is now a TARGETED phrase scan
  (`Chrome password export` / `chrome://password-manager` / `In Chrome,`), never
  a bare `grep -ri chrome` — goldfinch's window-"chrome" naming (`byChrome`,
  `chromeId`, `windowForChrome`) pervades `src/main/vault/` and is unrelated.
- **(low)** leg 1 adds a `/vault-restore-controller.js` route in
  `internal-page-map.js` + the exact-allowlist test update + the flat-specifier
  `// @ts-ignore` convention (the route-closure guard enforces it).
- **(low)** explicit line-budget call: LOWER `VAULT_PAGE_LINE_BUDGET` to the
  post-extraction count + a small buffer to lock in the headroom; the new
  controller gets no budget (sibling precedent).
- Suggestion taken: leg order may flex (small leg 2 first banks Edge value,
  not hostage to leg 1's divert risk) — recorded in Adaptation Criteria; the
  operator's "extraction as leg 1" stays the default. CP1 gains a one-time
  manual app spot-check (no DOM harness for this page).
- Architect citation audit: all leg-owned citations exact; the invariants-scan
  citation was incomplete (missed `openExportModal`), now corrected.

Flight status planning → ready.

## 2026-09-14 — Flight start (execution)

### Flight Director Notes

- Phase file loaded: `.flightops/agent-crews/leg-execution.md` (Developer /
  Reviewer, Sonnet). Flight status ready → in-flight; branch
  `flight/02-chromium-family-breadth` off main d68fcf7 (green: 4433 tests).
- Total legs: 3 (2 autonomous build + 1 optional HAT). Leg order: DEFAULT per
  the operator ruling — extraction (leg 1) then generalization (leg 2) then HAT
  (leg 3). The Architect's "small leg 2 first" option was left available in the
  adaptation criteria but not taken; the operator's explicit "extraction as
  leg 1" stands.

- **Leg 1 `restore-modal-extraction` designed** (`legs/01-*.md`, 7 ACs). Risk
  tier: **HIGH** — a behavior-preserving refactor of HAT-tuned (M18 F3) restore
  code, a shared-interface state handoff (`pendingImportRecord` → controller-
  owned), source-scan-pin retargeting (5 invariant scans), a new internal-page
  route, and a line-budget change. Design review runs before implementation.
- **Leg 1 design review (Developer, Sonnet): approve with changes.** Two HIGH
  catches folded in before any code: (1) `pendingNotice` is a SECOND module-state
  coupling (written in `openExportModal`, read in `render()`) that would throw a
  `ReferenceError` on every export once the function moves — added an injected
  `setNotice` callback (the `pendingImportRecord` pattern applied again); (2)
  `vault-browser-import-invariants.test.js` (missed in the first draft) breaks on
  AC13 (the `PALETTE`/swatch scan of vault.js — retarget to the controller, drop
  the now-dead vault.js `PALETTE` import) and AC10 (the closed-set vault-route
  count — +1 for the new route). Two mediums: `GLOBAL_VAULT_ID` is a local
  literal, NOT importable (re-declare locally; do not add a `GLOBAL_ID` export);
  ruling 1's controller surface corrected to include `handleLabelsReady(vaults)`
  (the distinct first-arrival fetch+open, vs `openMapping` for the resume
  banners). Suggestions taken: drop `closeActivePageModal` from injected deps
  (only in a docblock); citation drifts fixed (`refresh()` `:2737`,
  `buildImportExportSection` `:1676`). No second review cycle — additions/pins
  within the established design, not a redesign. Leg 1 → `ready`.

## Leg Progress

### restore-modal-extraction

**Status**: landed
**Started**: 2026-09-14
**Completed**: 2026-09-14

**Changes Made**:
- New `src/renderer/pages/vault-restore-controller.js` (854 lines, `// @ts-check`,
  `createVaultRestoreController(deps)`). Moved verbatim (bodies unchanged): `openExportModal`,
  `openImportPickModal`, `buildColorSwatchGrid`, `openMappingModal`, `openCompletionModal`,
  plus the internal-only helpers `buildVaultSelect` and `NEW_JAR_FALLBACK_COLOR`.
  `GLOBAL_VAULT_ID` re-declared as a local literal in the controller (same value + rationale
  comment) — not imported, no `GLOBAL_ID` export added to `vault-page-model.js`.
  `restoreDestinationOptions`/`restoreOutcomeLines` (from `vault-page-model.js`), `isSafeColor`,
  and `PALETTE` are imported by the controller itself (flat specifiers, `// @ts-ignore`).
  `appendOption` was kept in `vault.js` (per ruling 2) since `vault.js` itself still references it
  when constructing `createVaultBrowserImport`'s dep bag — injected into the new controller
  rather than duplicated.
- Dep set: `bridge` (the eight bridge methods the moved bodies call: `pickSavePath`,
  `exportProfile`, `exportVault`, `pickImportFile`, `beginImportUnlock`, `clearPendingImport`,
  `hasVault`, `commitImport`, plus `fetchImportLabels` for the held-record loader/first-arrival
  path); `dom: { el, iconButton, openModal, appendOption }` (`button` was dropped from the
  destructure — unused by the moved bodies, an ESLint `no-unused-vars` catch); getter deps
  `getJarRows()` / `getJarVaultPresence()` (live reads — `openMappingModal` calls them at
  open time, never a stale snapshot); `refresh` (callback, the `openCompletionModal`/
  `openExportModal` success paths); `setNotice(text)` (the second state-handoff — see below).
- `pendingImportRecord` handoff: the module-scoped variable and its two in-function writes moved
  into the controller as closure state `heldRecord`, exposed via `heldRecord()` (getter),
  `loadHeld()` (the `bridge.fetchImportLabels()` re-fetch `refresh()` used to do inline — now
  joined into `refresh()`'s existing `Promise.all`), `handleLabelsReady(vaults)` (the DISTINCT
  first-arrival fetch+validate+open path, called from the labels-ready listener with
  `lastViewVaults`), and `dropHeldOnPagehide()`. `vault.js`'s five former external sites were
  rewired: the two "Resume restore…" banners now call
  `restore.openMapping(restore.heldRecord(), …)` guarded on `restore.heldRecord()`; `refresh()`
  joins `restore.loadHeld()`; the `onVaultImportLabelsReady` listener now just calls
  `restore.handleLabelsReady(lastViewVaults)`; the pagehide drop calls
  `restore.dropHeldOnPagehide()`. Zero bare `pendingImportRecord` references remain anywhere in
  `vault.js` or the controller (grep-verified).
- `pendingNotice` handoff (the second state coupling, design-review HIGH): stays declared + read
  + cleared in `vault.js`'s `render()` exactly as before; the three write sites inside the moved
  `openExportModal` now call an injected `setNotice(text)` callback that `vault.js` implements as
  `(text) => { pendingNotice = text; }` — no bare `pendingNotice =` assignment remains in the
  controller.
- `internal-page-map.js`'s `vault` route gained one entry, `/vault-restore-controller.js`;
  `vault.js` imports the controller as a flat specifier with the `// @ts-ignore` convention.
  `eslint.config.mjs`'s real-ES-module file list gained the new controller (the
  `vault-browser-import-controller.js` precedent) — needed or the new file parsed as a script and
  failed lint on the bare `import`/`export` statements.
- `openModal`/`activePageModal`/`closeActivePageModal` all stayed in `vault.js` exactly as before
  — confirmed a controller-opened modal (`openModal` is an injected dep the controller calls) is
  still tracked by `vault.js`'s single `activePageModal` ref and still force-closed by `render()`'s
  unconditional `closeActivePageModal()`; the forced-close-vs-`onCancel`-drop distinction for the
  mapping modal's held record is unchanged (verified by the retargeted "ruling 9" invariant test).
- `vault.js` line count: 2820 → 2101 (`wc -l`) / 2102 (this repo's `split(/\r?\n/).length`
  convention). `seam-contract.test.js`'s `VAULT_PAGE_LINE_BUDGET` lowered 2820 → 2150 (landed +
  ~48 headroom, rounded to a clean number); the new controller carries no budget of its own (the
  `vault-browser-import-controller.js` precedent).
- Test/tooling updates: `test/unit/internal-page-map.test.js` (allowlist +1 entry);
  `test/unit/vault-restore-workflow-invariants.test.js` (added a `VAULT_RESTORE_JS` read var;
  retargeted the `openMappingModal`/`buildColorSwatchGrid` (×2)/`openExportModal` (×2) scans
  there; `render()`/`openModal` scans stayed on `vault.js`); `test/unit/vault-browser-import-invariants.test.js`
  (AC13's PALETTE/swatch-literal scan retargeted to the controller + a new assertion that
  `vault.js` no longer imports `PALETTE` at all; AC10's closed-set route-count fixture bumped
  11→12 via a new `flight2Leg1` bucket, same accounting idiom as the existing Leg-3-HAT-fix
  bucket); `test/unit/seam-contract.test.js` (budget lowered, rationale comment added).

**Deviations / Anomalies**:
- The leg's own Citation Audit did not name `vault-restore-workflow-invariants.test.js`'s
  `'the vault page Export modal calls BOTH exportProfile … and exportVault …'` test (originally
  around `:81-94`), which also scans `vault.js` for the `bridge.exportVault(select.value` /
  `bridge.exportProfile(` call-site literals — both live inside `openExportModal`, which this leg
  moves. Left unretargeted it would have gone red (the calls no longer appear in `vault.js`).
  Retargeted to `VAULT_RESTORE_JS` alongside the five the leg named explicitly — same
  citation-audit-missed-a-spot class as the design review's AC13/AC10 catches, caught here by
  running the full green bar rather than trusting the citation list alone.
- The CP1 belt-and-suspenders manual app spot-check (pick → mapping → completion + export modals,
  live in the running app) was not performed — this leg's verification leaned on the full green
  bar (4433 tests incl. the retargeted restore/export source-scan invariants, typecheck, lint,
  format) plus a `git diff` review confirming the extraction is a move (bodies byte-identical
  apart from the two state-handoff rewrites) rather than a rewrite. Flagging for the Flight
  Director / Reviewer to decide whether a live-app pass is still wanted before this leg is
  considered fully closed.
- No out-of-scope defects found during this leg.

**Verification**:
- `node --test test/unit/internal-page-map.test.js test/unit/internal-page-route-closure.test.js` — 5/5 pass (AC3).
- `node --test test/unit/vault-restore-workflow-invariants.test.js` — 23/23 pass (AC4).
- `node --test test/unit/vault-browser-import-invariants.test.js` — 20/20 pass (AC4, incl. AC10/AC13).
- `node --test test/unit/vault-page-shared-scripts.test.js test/unit/vault-page-model.test.js test/unit/vault-import-handler.test.js` — 62/62 pass (sanity: no other vault suite broke).
- `npm test` — 4433/4433 pass, 0 fail (AC6; same total as the leg-start green bar — no test
  count drift, only retargeted assertions).
- `npm run typecheck` — clean (AC6).
- `npm run lint` — clean (AC6; required one fix, an `eslint.config.mjs` real-ES-module entry for
  the new controller file, and dropping the unused `button` destructure).
- `npm run format` then `npm run format:check` — clean, "All matched files use Prettier code
  style!" (AC6).
- `git diff --stat src/renderer/pages/vault.js` — 34 insertions / 752 deletions, consistent with
  a move (small construction/wiring additions, large block deletions) rather than a rewrite (AC1).

- **Leg 1 landed + FD-verified independently**: green bar 4433/4433,
  typecheck/lint/format clean; `vault.js` 2820 → 2102 (`split` metric),
  `VAULT_PAGE_LINE_BUDGET` 2820 → 2150 (~48 headroom); no bare
  `pendingImportRecord` in vault.js, no bare `pendingNotice` write in the
  controller; route + invariants retargets green. Developer deviation accepted:
  one extra invariant scan (the export-modal-calls-both-exportProfile/exportVault
  test) also needed retargeting — done, in scope. `eslint.config.mjs` gained the
  new controller in the ES-module list (the vault-nav/browser-import precedent).
  CP1 live restore spot-check NOT done autonomously (no DOM harness) — FOLDED
  INTO the Leg 3 HAT (operator live), which will exercise pick→mapping→
  completion + export alongside the Edge import before the flight lands.
- **Leg 2 `chromium-generalization` designed** (`legs/02-*.md`, 6 ACs). Risk
  tier: **LOW** — additive user-facing copy + docs + one header-acceptance test,
  within established patterns, zero logic change (the detector already accepts
  the identical Edge header). Per the workflow, low-risk legs skip the design
  review; the flight-end Reviewer covers the code. Note: the internal
  `detectChromeExport`/`CHROME_HEADER` rename is deliberately SKIPPED (internal,
  no operator benefit — DD2's acceptable-variation).

### chromium-generalization

**Status**: landed
**Started**: 2026-09-14
**Completed**: 2026-09-14

**Changes Made**:
- `src/renderer/pages/vault-browser-import-controller.js` (ruling 1/2): the
  `:54` refusal string generalized `"That file isn't a Chrome password
  export."` → `"That file isn't a recognized browser password export."`; the
  `:91-92` pick-modal guidance lede replaced Chrome-specific
  `chrome://password-manager` step-by-step copy with browser-generic Chromium
  guidance naming Chrome, Edge, and other Chromium browsers, with no
  per-browser steps — both remain `textContent`-only (no markup change); the
  completion modal's "Delete the exported CSV file now" line was left
  untouched (already source-agnostic, per ruling 1). The `:78` docblock comment
  ("a Chrome-export guidance lede") generalized to "a Chromium-browser-export
  guidance lede".
- `src/main/vault/browser-import-flow.js` (ruling 2): the `:60` `begin()`
  docblock comment ("Pick a Chrome password-export CSV…") generalized to "Pick
  a Chromium-browser password-export CSV…". No other line in this file
  mentions Chrome by name (the remaining `Chrome`-substring hits —
  `windowForChrome`, `chromeId`, `detectChromeExport`, `adaptChromeRows` — are
  either goldfinch's own window-chrome naming or the deliberately-unrenamed
  internal detector, both out of scope per ruling/DD2).
- `test/unit/browser-import-adapter.test.js` (ruling 3/AC2, first half): added
  `M19 F2 Leg 2 / DD1: detectChromeExport accepts the exact Edge
  password-export header (byte-identical to Chrome)` — asserts
  `detectChromeExport` does not throw against the literal Edge header
  `name,url,username,password,note`, pinning DD1's "Edge comes in on the same
  detector, unchanged" claim.
- `test/unit/vault-browser-import-invariants.test.js` (ruling 3/AC2, second
  half; source-scan style, matching the file's existing grep-AC convention —
  no DOM/jsdom harness exists for this controller, so the mapping is pinned at
  the source-scan level rather than by instantiating the module): updated the
  now-outdated `AC12: the pick modal lede names chrome://password-manager…`
  test to assert the new copy (`'Chromium browsers'`, `'Chrome'`, `'Edge'`,
  `'Export passwords'`) instead; added `M19 F2 Leg 2 / AC1, AC2: the pick modal
  lede is browser-generic Chromium guidance, no per-browser steps` (asserts
  `chrome://password-manager` and `'In Chrome,'` are ABSENT from the
  controller source — non-vacuous, would have failed before this leg's edit);
  added `M19 F2 Leg 2 / AC2: the unrecognized-format refusal maps to the
  browser-generic copy` (asserts the exact new `errorMessage` mapping line is
  present verbatim and the old Chrome-specific refusal string is absent) — this
  pins that `browser-import-flow.js`'s `begin()` `unrecognized-format` error
  code renders the new browser-generic copy, not the retired one.
- `docs/vault.md` (ruling 4): heading `### Browser import (Chrome)` (`:541`) →
  `### Browser import (Chromium browsers)`; the intro prose (`:543-548`)
  generalized to name the Chromium family and note the accurate mechanism —
  the detector still keys on the specific `name,url,username,password,note`
  header, which is the header the Chromium family shares, and a real Edge
  export was verified byte-identical at planning (M19 F2 DD1); also noted the
  internal `detectChromeExport`/`CHROME_HEADER` naming is unchanged by design
  (M19 F2 DD2, non-user-facing). The `:608` mechanism line ("about the export
  file Chrome already wrote") generalized to "the browser already wrote". The
  `:758` threat-model line generalized "A Chrome password export is plaintext
  by construction" → "A Chromium-browser password export is plaintext by
  construction", with an M19 F2 generalization note. Left untouched (per
  ruling 5 / Edge Cases): the `Chrome-owned entry/display sheets` doc-table row
  (`:43`, goldfinch's own window-chrome), the `getChromeTarget` reference
  (`:615`), and the `/import|csv|chrome|browser/i` regex-pattern description
  (`:613`, describes a regex literal, not a "Chrome"/"In Chrome," phrase — does
  not match the grep-AC pattern).
- `CLAUDE.md` (ruling 4): the `**Browser import (Chrome CSV, M19 F1).**` bullet
  → `**Browser import (Chromium CSV, M19 F1; generalized to the Chromium
  family M19 F2).**`, with a sentence added noting Edge verified
  format-identical at planning (DD1) and that the user-facing copy is now
  browser-generic (DD2); the trailing citation "Browser import (Chrome)"
  subsection" → "Browser import (Chromium browsers)" subsection" to match the
  renamed docs heading. `CLAUDE.md:262`'s unrelated closed-tab "Chrome's
  per-window reopen" line was left untouched (Edge Case / ruling 5).

**Deviations / Anomalies**:
- The leg's stated inputs cited `docs/vault.md`'s Browser-import section as
  `:541-615`; the actual Chrome-specific prose needing generalization also
  included the `:608` mechanism line and the `:758` threat-model line, both
  named explicitly in ruling 4 — no surprise, just confirming both were
  addressed (the leg's own Inputs line already covered `:758` via "`docs/vault.md`
  — the Browser-import section (`:541-615`, `:758`)").
- No new file created and no test file needed net-new creation — both AC2 test
  additions landed in existing suites (`browser-import-adapter.test.js`,
  `vault-browser-import-invariants.test.js`), matching each file's existing
  style (pure-function assertion vs. source-scan grep-AC) rather than adding a
  `browser-import-flow.test.js` case, since the copy-mapping half lives in the
  controller (DOM-injected-deps, no functional harness in this repo) rather
  than in the flow module itself — `browser-import-flow.test.js` was read but
  not modified.
- No out-of-scope defects found during this leg.

**Verification**:
- `node --test --test-timeout=60000 test/unit/browser-import-adapter.test.js
  test/unit/browser-import-flow.test.js test/unit/vault-browser-import-invariants.test.js`
  — 57/57 pass, 0 fail (AC2).
- `npm test` — 4436/4436 pass, 0 fail (AC5; 4433 leg-start + 3 net-new
  assertions — the one updated pre-existing test does not change the count).
- `npm run typecheck` — clean (AC5).
- `npm run lint` — clean (AC5).
- `npm run format` then `npm run format:check` — clean, "All matched files use
  Prettier code style!"; `format` reported every touched file "unchanged" (no
  re-wrap needed) (AC5).
- Grep-AC (ruling 5, AC4):
  `grep -nE "Chrome password export|chrome://password-manager|In Chrome,|Chrome-export" src/renderer/pages/vault-browser-import-controller.js docs/vault.md`
  → zero hits (exit 1, no matches). Also re-ran against `CLAUDE.md` as a
  belt-and-suspenders check (not in the leg's own ruling-5 scope but named in
  the flight.md verification section) — zero hits there too.

## 2026-09-14 — Flight-end review (legs 1+2)

### Flight Director Notes

- Flight-end Reviewer (Sonnet) over both autonomous legs: **[HANDOFF:confirmed]**,
  no blocking issues. Leg 1 verified as a true MOVE by diffing every moved body
  line-for-line against `main` (only the designed deltas: `setNotice`,
  `heldRecord`, getter reads, injected `appendOption`); both state handoffs +
  the `render()` force-close coupling intact; route/pins/budget correct (2150 vs
  2101). Leg 2 clean; grep-AC zero. Independent green bar 4436/4436.
- Non-blocking note (Reviewer): `flight.md` checkboxes deferred to this commit —
  legs 1+2 now checked; flight STATUS stays `in-flight` (leg 3 HAT pending) and
  the flight-level completion checklist waits until after the HAT.
- Committing legs 1+2 (autonomous) now; draft PR opened. Leg 3 (guided HAT,
  Edge import + the CP1 restore-flow spot-check) is operator-driven next; HAT
  fixes ride their own commits (Flight 1 precedent), then flight completion.

