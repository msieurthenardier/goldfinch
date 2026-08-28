# Flight Debrief: Keyboard Reachability and Omnibox Semantics

**Date**: 2026-08-28
**Flight**: [Keyboard Reachability and Omnibox Semantics](flight.md)
**Status**: landed
**Duration**: 2026-08-27 (Leg 1 spike) – 2026-08-28 (HAT + land)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved

Keyboard-only users can now enter, traverse, and leave page content across the multi-`WebContentsView` boundary, and assistive technology hears the omnibox suggestion state — the two consequences of the chrome and the guest being separate documents that this flight set out to solve. Concretely: **F6 / Shift+F6** cycle chrome ↔ content (from either side, DD1/DD6), **Enter** in the address bar hands focus to the page on commit (DD7), **mid-page Tab** is Chromium's again and a guest **tab-boundary** signal returns focus to the chrome at the ends (DD2–DD5), a shared ESM `tab-boundary.js` unifies the tabbable-filter logic across the chrome and both guest preloads (DD9), and a chrome-owned `#suggest-status` polite live region announces the suggestion count / highlighted row / "No matches" while the invalid `aria-expanded` on the address textbox is retired (DD11/DD12).

Closes the code half of issue #174 (maintenance findings F48, F49). Its draft AC1 ("Tab from the last chrome control lands in the guest") was superseded by the operator's DD1 ruling (F6 enters; the chrome keeps its native Tab order) — recorded as a deliberate confirmation on the live build, not a miss.

### Mission Criteria Advanced

- **Criterion 1** — keyboard-only user can enter, traverse, and leave page content: **met**.
- **Criterion 2** — omnibox suggestion highlighting exposed to AT across the view boundary: **met**.

Verification: `chrome-guest-keyboard-nav` 15/15 (run 2026-08-28-01-56-28), `omnibox-suggestion-announcement` 8/8 (run 2026-08-28-02-48-31), `npm run a11y` exit 0 (no new violations), `npm test` 3941/3941.

## What Went Well

- **Two-cycle risk-tiered design review earned its keep.** Every high-risk leg got a per-leg design review, and the reviews caught two real errors *before* implementation: Leg 2's `renderer.js` budget off-by-one (already at 1827 by the pin's metric — a new line would breach) and Leg 3's "zero renderer.js lines" premise (every pure helper reaches the chrome controllers through `renderer.js`'s deps object, not top-level imports). Both were process wins, not design flaws.
- **The shared ESM `tab-boundary.js` (DD9)** is the flight's strongest structural result: one selector + visibility algorithm now serves the chrome (`import`) and both guest preloads (bundled `require`), retiring the Leg 1 chrome-side duplicate on schedule and interop-verified before the leg closed.
- **The `model.announcement` seam (DD12)** routed new cross-boundary state through the model `buildSuggestionModel` already returns, avoiding a `renderer.js` budget breach with no new dep — a reusable "ride the existing seam" precedent.
- **DD1 was decided on the live build, correctly.** The document-level F6 landing is undecidable from ground truth alone; Leg 1's first run showed `webContents.focus()` lands on `BODY`, which reads as "F6 did nothing." The operator ruled Chrome-parity only after seeing that misread happen in the HAT — the flight's clearest case of a decision that needed a running build.
- **Cross-view boundary IPC reused an existing trust pattern** (sender-derived wcId, `register-browser-ipc.js`), not a new one — the flight-end security review traced every path and confirmed no forgeable target and no secret-bearing announcement text.
- **Structural pins were neuter-verified** (delete/invert → red → restore) rather than assumed, and both behavior specs corroborated `evaluate` reads with `readAxTree` — the "negative assertions need an instrumented read" discipline held.

## What Could Be Improved

- **The `wc -l` line-budget metric trap recurred.** Flight 5 hit it; Leg 2 hit it again (`wc -l` under-counts the trailing newline vs. the pin's `split(/\r?\n/).length`). This should be encoded once as a leg-design checklist item ("measure the budget with the pin's exact metric, before and after"), not rediscovered per flight.
- **A maintenance-report fix shape was wrong before the leg started.** F49 said "add `aria-expanded`"; ground truth found the attribute already present *and invalid* on a `textbox` (axe 4.13). DD11 reversed it correctly, but the lesson is that maintenance-report fix shapes are hypotheses to verify at leg design, not specs to implement.
- **Leg 3 ran serially after Leg 2 but was nearly independent of it** — it shared only the `renderer.js` budget constraint and the DD numbering. It could have run in parallel; the cost was schedule, not correctness.
- **HAT under WSLg was high-friction.** Every round-trip to report dropped the app window's OS focus, and both `document.hasFocus()` and synthetic `pressKey` probes proved unreliable while the window was backgrounded. The reliable signal turned out to be the chrome's **persisted `document.activeElement.id`** (it survives the window blur) plus the operator's visual report.

### Technical / Test Metrics

`npm test` on the landed branch: **3941 / 3941 pass, 0 fail / skip / todo**, 13 suites, node `--test` wall-clock **≈3502 ms**. Prior: Flight 5 recorded 3839/3839 at ≈3064 ms; this flight's own baseline drifted to 3843 across four post-F5 turnaround merges, landing at 3941 — **+98 tests (+2.6%)**, wall-clock **+14.3%**. The wall-clock delta outruns the test-count delta, the same pattern M16 Flight 2's debrief flagged as a multi-flight timing watch item (not a finding against any one flight). Visible contributors this flight: two new bundle-integrity test files, a +290-line `navigation-controller.test.js` (many fake-timer cases for DD7's one-shot), and `pretest` now bundling two esbuild entries. Zero skips/todos/flakes on the run — the suite's zero-skip streak holds.

**One unreproduced behavior flake** (run 2026-08-28-02-48-31, checkpoint 4): the suggestions sheet closed and `#suggest-status` emptied on the run's very first `ArrowDown`, immediately after the session's first CDP attach (`readAxTree(C)`) while the sheet was open; two targeted reruns isolating that call and `captureScreenshot(C)` were both clean. Characterized as a first-CDP-attach apparatus/timing artifact, not a product defect — correctly not escalated on a single occurrence, and covered by the HAT hand-walk.

## Deviations

- **HAT steps 4/5/7 mapped to run-log evidence** rather than hand-walked (FD adaptation, logged): the automated coverage is exhaustive and the window-refocus friction made re-walking low-value. Steps 2, 3, 6 (and the two alignment rulings) were walked live.
- **One FD instruction error** during the HAT: the step script said "Ctrl+Shift+W to close the window," but goldfinch has no close-window accelerator (`keydown-action.js:127` binds Ctrl+W → close-tab). Corrected in the operator's hands; not a defect.
- **Operator-identity leak incident (FD-caused, remediated).** The Flight Director's `ln -s` in the squawk-0045 scratch worktree created a `node_modules` symlink whose target was an absolute home path; `.gitignore`'s directory-only `node_modules/` glob did not match it, so `git add -A` committed it and it reached public `origin/main` via PR #187. Detected at the flight-landing commit; remediated as **grounding squawk 0047** (PR #189): symlink removed from main, `.gitignore` changed to a bare `node_modules` so a stray file/symlink of that name can never be staged again. The leaking blob remains reachable in history at `46b5be6` — a **residual requiring an operator decision** on a `main` history rewrite (force-push), which the operator has previously declined for similar cases.

## Key Learnings

1. **Measure line budgets with the pin's exact metric** (`split(/\r?\n/).length`), before and after, never `wc -l` — a two-flight-recurring trap.
2. **Maintenance-report fix shapes are hypotheses.** Verify them against current code at leg design; F49's was already stale before Leg 3 began.
3. **Negative assertions need an instrumented read.** Both behavior specs had a "did NOT happen" claim (Leg 2 row 13's collector, Leg 3 row 3's politeness / row 15's losing-view focus) that was prose-only until an explicit read was added mid-run — an AUTHORING.md candidate.
4. **Under WSLg, the reliable HAT focus signal is the persisted `document.activeElement.id`**, not `hasFocus()` or synthetic probes against a backgrounded window — a standing crew apparatus fact.
5. **Never point a scratch worktree's `node_modules` at a path that resolves into the primary checkout, and `.gitignore` globs for `node_modules` must be bare** (not directory-only) to catch a stray symlink.

## Architectural Debt (deferred, sorted by fixability)

| Item | Nature | Owner |
|------|--------|-------|
| Cross-view **stale focus ring** at the boundary (losing `WebContentsView` keeps its ring) | Inherent to the multi-view model; a correct fix (store/blur/restore in the every-page preload) must preserve DD1's F6-re-entry-restores-place contract (behavior row 7) | **Flight 2 / #147**, together with the subframe-preload decision and squawk 0044 |
| **Trailing-iframe** forward-Tab wrap (DD8 residual) | Model-inherent: a top-frame capturing listener can't see subframe keydowns without `nodeIntegrationInSubFrames` (full page-world preload in every iframe — a security trade) | **Flight 2 / #147** |
| `tabSequence` **does not pierce shadow DOM** | Narrower, more fixable (walk open shadow roots); not exercised by current pages | Squawk candidate |
| Omnibox **bare-IP → https, no http fallback** (blank error page) | Ordinary scheme-inference, unrelated to the multi-view model | **Squawk 0046** (logged) |
| Toolbar buttons draw **no focus ring** (WCAG 2.4.7) | Cousin to the stale-ring item; both are "where did my focus go at the boundary" | **Squawk 0044** (logged) |

## Skill Effectiveness (Flight Control methodology)

- **Flight / leg structure held.** Risk-tiering + two-cycle review is doing exactly its job (two pre-implementation catches this flight). The recurring line-budget metric trap argues for a **standing leg-design checklist item** so the same arithmetic error isn't rediscovered per flight — a mission-control methodology candidate (joins the four unreviewed items carried from the Flight 5 debrief).
- **The HAT-under-WSLg friction** suggests the HAT leg guidance should name the persisted-`activeElement` read as the sanctioned live-signal and warn that window-blur invalidates synthetic probes — a `hat`/behavior-test authoring note.
- **The worktree `node_modules` incident** is partly a mission-control tooling gap: agentic-workflow / squawk worktree setup should never symlink `node_modules` into a path resolving into the primary checkout; a crew/skill note is warranted.

## Follow-Up Actions

1. **Servicing squawk** — two stale comments naming the retired `lastVisibleChromeTabbable` (`test/unit/shortcut-controller.test.js:22,47`; also the stale mentions in `a11y-audit-exit-codes.test.js:28` and `vault-accesskey-template.test.js:8` noted during squawk 0045). Comment-only; next turnaround. **Logged as squawk 0048.**
2. **Squawk candidate** — extend `tabSequence`/`FOCUSABLE_SELECTOR` to pierce open shadow roots (Architect finding). **Logged as squawk 0049** (latent — no current page uses shadow DOM; revisit trigger recorded on the squawk).
3. **Crew-file apparatus notes** — fold the accumulated behavior-run facts (collector patterns, `readAxTree` iframe-omission, stale losing-view reads, persisted-`activeElement` HAT signal, `json.dumps` arg quoting, JSON-escaped `readDom`, chevron ring not reliably invisible) into `.flightops/agent-crews/behavior-tests-execution.md`.
4. **Mission-control methodology** — line-budget-metric checklist item; HAT-under-WSLg live-signal note; worktree-`node_modules` tooling note; the AUTHORING.md negative-assertion rule. These join the Flight 5 debrief's four unreviewed items for a batched methodology pass.
5. **Operator decision** — whether to rewrite `main` history to purge the leaked-path blob at `46b5be6` (squawk 0047 residual). **Operator decision 2026-08-28: leave as is — no history rewrite.**
6. **Already logged**: squawk 0044 (focus-visible on toolbar buttons), squawk 0046 (omnibox https/no-fallback), squawk 0047 (node_modules symlink, completed). Flight 2 / #147 owns the stale-ring + subframe-preload design.
