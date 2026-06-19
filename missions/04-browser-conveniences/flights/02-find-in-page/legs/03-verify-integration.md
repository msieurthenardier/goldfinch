# Leg: verify-integration

**Status**: completed
**Flight**: [Find in Page](../flight.md)

## Objective

Close the flight's acceptance gates: run the `find-in-page` behavior test on the automation
surface (SC8 parity), run the a11y gate, sweep the regression-prone keyboard-handler specs, and
land all the documentation + prose tool-count updates the prior two legs deliberately deferred
(README shortcuts, `docs/mcp-automation.md`, `CLAUDE.md` prose count 24 → 26).

## Context

- This is the verification + docs leg for Flight 2. Code is complete and uncommitted across legs
  `find-bar-ui` (renderer find bar) and `find-mcp-tools` (the `findInPage`/`stopFindInPage`
  automation tools, 24 → 26 — **unit-test** counts already bumped).
- **Owns the prose docs + prose count bumps** (Flight-1 "stale CLAUDE.md count" debrief note —
  the doc count change is batched here, with the doc edits, not scattered into the code legs):
  README keyboard-shortcuts table, `docs/mcp-automation.md` tool reference, and the **`CLAUDE.md`
  prose tool list** ("24 tools / 15 drive" → "26 tools / 17 drive", add both tool names). These
  are prose, not test gates — they were left at 24 by the code legs to keep `npm test` green.
- **Behavior-test apparatus = the M03 automation surface** (DD6, dogfooding). The spec already
  exists (drafted at planning): `tests/behavior/find-in-page.md` (status `draft`). The Flight
  Director runs it via `/behavior-test find-in-page` — **not** a spawned Developer agent (the run
  skill orchestrates its own Executor + Validator crew).
- **A11y + behavior test + HAT are real-environment gates** (need the live GUI + automation
  surface; not headless CI). Per the flight, SC4's visual bar is HAT-verified and SC8's parity is
  behavior-test-verified.

## Inputs

- Uncommitted working tree from legs 1–2 (`npm test` green at 824 tests; lint + typecheck clean).
- `tests/behavior/find-in-page.md` — the drafted spec (7 steps; jar-key parity assertions +
  `evaluate` corroboration; the internal-tab + visual-bar cases are explicitly out-of-scope /
  HAT/unit).
- `.flightops/agent-crews/behavior-tests-execution.md` — Executor + Validator crew prompts.
- `README.md:141-154` — the Keyboard shortcuts table (currently ends at `Ctrl+P` print).
- `CLAUDE.md` — the prose tool list paragraph ("The server advertises **24 tools** — **15
  drive** (… `printToPDF`, `click`, …)"). Also a drive-list mention near `:12`/`:15` if present.
- `docs/mcp-automation.md` — the drive-tool lists (~`:290`, ~`:434-437`), the per-tool reference
  table (`getZoom`/`setZoom`/`printToPDF` rows ~`:343-345`), and the internal-session-excluded
  invariant note (~`:347`).
- Specs touching the keyboard handlers (regression sweep targets): any unit test referencing
  `before-input-event`, the renderer `document` keydown handler, or the zoom/print capture.

## Outputs

- `tests/behavior/find-in-page/runs/{ts}.md` — the behavior-test run log (committed); status
  `pass` (or a recorded disposition if the operator accepts a known issue).
- `tests/behavior/find-in-page.md` — `Last Run` updated; status `draft` → `active` on first pass.
- `README.md` — find shortcuts added.
- `CLAUDE.md` — prose count 24 → 26, drive 15 → 17, both tool names added.
- `docs/mcp-automation.md` — find tools in the drive lists, the reference table, and the
  internal-excluded invariant note.
- a11y gate result recorded; regression sweep result recorded.

## Acceptance Criteria

- [ ] **AC1 — Behavior test passes.** `/behavior-test find-in-page` runs on the live automation
  surface (`npm run dev:automation`, jar key) and **passes** all in-scope steps: `findInPage`
  returns `{activeMatchOrdinal, matches}` matching the `evaluate`-corroborated term count;
  forward/back stepping moves `activeMatchOrdinal`; a no-match query returns `{matches:0,
  activeMatchOrdinal:0}` cleanly; `stopFindInPage` → `{ok:true}`; the cross-jar attempt is
  refused `out-of-jar`. A run log lands at `tests/behavior/find-in-page/runs/{ts}.md`. *(If the
  operator accepts a failure as a known issue, the leg may land with that disposition recorded in
  the flight-log entry alongside the run-log path — flight policy.)*
- [ ] **AC2 — A11y gate clean (find bar audited OPEN).** `npm run a11y` (per CLAUDE.md attach
  model) reports **no new** `(rule id, node-selector)` violations — gated on
  `wcag2a,wcag2aa,wcag21a,wcag21aa`. **The audit must exercise the find bar in its OPEN state**:
  the existing audit drives only `base-chrome → media-panel → privacy-panel → lightbox` and has
  **no** find-bar state — so this leg **adds a 5th `find-bar` state-driver** to
  `scripts/a11y-audit.mjs` that opens the bar (via `evaluate` calling the renderer `openFind()`
  on a web tab, matching how the existing drivers call `togglePanel(true)`/`openLightbox()`).
  Auditing the hidden/closed element is insufficient — the find bar's focus order and `aria-live`
  count only exist when open. Any genuinely-accepted finding is added to the `ACCEPTED` allowlist
  with a documented reason (never silently suppressed). *(Design-review [high] fix — the original
  AC implied an open-state audit the script could not actually perform.)*
- [ ] **AC3 — README shortcuts.** The Keyboard shortcuts table (`README.md:~141`) lists the find
  shortcuts: `Ctrl+F` (Find in page) and `Enter` / `Shift+Enter` (Next / previous match) as new
  rows near the other page-content shortcuts. For `Esc`: the table **already has an `Esc` row**
  ("Close an open menu / panel") — **extend that row** to include the find bar (e.g. "Close an
  open menu / panel / find bar") rather than adding a duplicate `Esc` row (design-review [medium]
  fix).
- [ ] **AC4 — CLAUDE.md prose count.** The prose tool paragraph reads **26 tools** / **17 drive**,
  with `findInPage` and `stopFindInPage` added to the drive list (and any other in-file "24"/"15
  drive" tool-count prose updated — grep to confirm none missed).
- [ ] **AC5 — docs/mcp-automation.md.** `findInPage`/`stopFindInPage` appear in **all** of:
  - the intro summary count (~`:19`): "**24 tools — 15 drive**" → "**26 tools — 17 drive**"
    (design-review [high] — was missed);
  - the "All 24 tools" line (~`:323`) → "All 26 tools" and the "### Drive tools (15)" heading
    (~`:327`) → "(17)" (design-review [high] — was missed);
  - the drive-tool name list (~`:290`);
  - the per-tool **reference table** — new rows mirroring the `getZoom`/`printToPDF` rows:
    `findInPage` `{ wcId, text, forward?, findNext?, matchCase? }` → JSON
    `{"activeMatchOrdinal":n,"matches":m}`; `stopFindInPage` `{ wcId }` → `{"ok":true}`;
  - the **Result/refusal semantics** enumeration (~`:432-435`): put `stopFindInPage` in the
    **void-ops** (`{"ok":true}`) list and `findInPage` in the **real-return-value** list
    alongside `getZoom`/`setZoom` (design-review [low] — `:434` is the results-semantics section,
    not a separate drive list; place each in the correct sub-list);
  - the **internal-session-excluded** invariant note (~`:347`) — add both names to the excluded
    set.
  Verify with `rg -n "24 tools|15 drive|All 24|Drive tools \(15\)" docs/mcp-automation.md`
  returning nothing.
- [ ] **AC6 — Regression sweep.** Re-run the full `npm test` suite after the docs edits (docs
  don't affect tests, but confirm 824 still green) and confirm no spec touching the
  `before-input-event` / renderer keydown handlers regressed from the leg-1/leg-2 changes. Record
  the result.
- [ ] **AC7 — Spec status.** On a passing run, `tests/behavior/find-in-page.md` `Status` is set
  `draft` → `active` and `Last Run` updated to the run timestamp.

## Verification Steps

- **AC1**: Operator/Flight-Director starts `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`,
  then `/behavior-test find-in-page`; confirm the run log status is `pass`.
- **AC2**: `npm run a11y` (with the find bar reachable) — exits clean / only pre-accepted findings.
- **AC3–AC5**: Read the diffs; grep `rg -n "24 tools|15 drive" CLAUDE.md docs/` returns nothing
  stale; `rg -n "findInPage|stopFindInPage" docs/mcp-automation.md README.md CLAUDE.md` shows the
  additions.
- **AC6**: `npm test` → 824 green; `rg -l "before-input-event|keydown" test/` reviewed for fallout.
- **AC7**: Read `tests/behavior/find-in-page.md` header.

## Implementation Guidance

**This leg has two tracks. The docs track (AC3–AC6) is autonomous (a Developer agent). The live
gates (AC1, AC2, AC7) need the running GUI and are Flight-Director/operator-driven.**

1. **Docs track (Developer agent, autonomous, committable):**
   - README: add `Ctrl+F` and `Enter`/`Shift+Enter` rows; **extend the existing `Esc` row** to
     mention the find bar (do not add a 2nd `Esc` row).
   - CLAUDE.md: update the prose tool paragraph — "24 tools" → "26 tools", "15 drive" → "17
     drive", append `findInPage`, `stopFindInPage` to the drive enumeration. Grep the whole file
     for any other stale tool count.
   - docs/mcp-automation.md: update **all** count sites (intro ~`:19`, "All 24 tools" ~`:323`,
     "### Drive tools (15)" ~`:327`), add the two tools to the drive name list (~`:290`), add two
     reference-table rows (mirror the `printToPDF` row), place each in the correct results-semantics
     sub-list (~`:432-435`: `findInPage` real-return, `stopFindInPage` void-ops), and add both
     names to the internal-session-excluded invariant note (~`:347`). Grep-verify no stale count
     remains.
   - Re-run `npm test` (824 green), `npm run lint`, `npm run typecheck`. Do NOT touch source/test
     code (leg 1/2 own it). Do NOT commit.
   - **Find-bar a11y state-driver (source, AC2):** add a 5th `find-bar` state-driver to
     `scripts/a11y-audit.mjs` that opens the bar (via `evaluate` → `openFind()` on a web tab),
     mirroring the existing `media-panel`/`lightbox` drivers, so the open bar is audited. This is
     the one source edit this leg owns (the audit script is verify-infrastructure, not feature
     code). It can be authored autonomously but only *runs* in the live-GUI a11y track below.

2. **Behavior-test track (Flight Director):** invoke `/behavior-test find-in-page`. The run skill
   confirms preconditions (app on `npm run dev:automation`, jar key, tool count 26), spawns the
   Executor + Validator, drives the 7-step table, and writes the run log. A failing in-scope step
   means the leg does not land until fixed (new commit, re-run) — unless the operator records an
   accepted known-issue disposition.

3. **A11y track:** `npm run a11y` with the find bar reachable; treat any new violation as
   blocking until fixed or explicitly allowlisted with a reason.

4. **On all gates green:** flip `tests/behavior/find-in-page.md` to `active` + stamp `Last Run`;
   record every gate result in the flight log.

## Edge Cases

- **Environment can't run the GUI here** (headless orchestration): the docs track still completes
  autonomously; AC1/AC2/AC7 are flagged operator-gated and run in a live session. The leg does
  not fully land until they pass — surface this clearly rather than marking them done.
- **Behavior test reveals a real bug** in leg-1/leg-2 code: fix in a new commit (no amend),
  re-run — the leg holds open until green or an accepted disposition is recorded.
- **A11y finding on the find bar**: fix (preferred) or allowlist with a documented reason; never
  silently suppress.

## Files Affected

- `README.md` — shortcuts table (Ctrl+F, Enter/Shift+Enter rows; extend the Esc row).
- `CLAUDE.md` — prose tool count + drive list (24→26, 15→17, both names).
- `docs/mcp-automation.md` — all count sites (:19/:323/:327), drive list (:290), reference table,
  results-semantics sub-lists (:432-435), invariant note (:347).
- `scripts/a11y-audit.mjs` — **add a 5th `find-bar` open-state driver** (AC2); plus allowlist
  edits only if a genuinely-accepted new finding needs it.
- `tests/behavior/find-in-page.md` — status/Last Run (on pass).
- `tests/behavior/find-in-page/runs/{ts}.md` *(new, written by the run skill)* — run log.

---

## Post-Completion Checklist

**Complete ALL before signaling `[HANDOFF:review-needed]` (this is the last autonomous leg —
review + commit follow at the flight level; do NOT commit / do NOT signal `[COMPLETE:leg]`):**

- [ ] Docs track complete (AC3–AC6); `npm test`/lint/typecheck green
- [ ] Behavior test run + a11y gate either passed, or clearly flagged operator-gated with the
      reason (live-GUI dependency) so the flight-level step can sequence them
- [ ] Update flight-log.md with the verify-integration entry (gate results + run-log path)
- [ ] Set this leg's status to `landed` (or note the live gates as pending operator verification)
- [ ] Do NOT commit
