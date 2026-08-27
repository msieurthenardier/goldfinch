# Flight Log: Prettier Adoption

**Flight**: [Prettier Adoption](flight.md)

## Summary

Landed 2026-08-27, same day, 2/2 legs, one review round each. Leg 1: 319 files reformatted, `RENDERER_LINE_BUDGET` 1650 → 1827, twelve pins re-targeted and neuter-verified, two typing-comment repositions authorized as correctness edits (PR #182, squash `339e808`). Leg 2: `format:check` in the Concourse lint task and a new GH Actions step, `.git-blame-ignore-revs` with the Leg 1 sha, CLAUDE.md/docs (PR recorded below). Gates throughout: 3839/3839, lint, typecheck, prettier. Concourse task run deferred to the operator (local server timeout).

---

## Reconnaissance Report

Source: [squawk 0039](../../../../squawks/0039-prettier-drift-not-enforced.md)
(escalated 2026-08-27). Verified 2026-08-27 by a revert-safe spike at the
flight's base commit (`f142f90`, tree clean before and after): `npm run
format` under the existing `.prettierrc`, then `npm test`.

| Item | Classification | Evidence | Recommendation |
|---|---|---|---|
| 318 files fail `prettier --check` | confirmed-live | `npx prettier --check .` → "318 files" at `f142f90` | Leg 1 |
| `renderer.js` 1650 budget breaks | confirmed-live | by the pin's metric (`split(/\r?\n/).length`, = `wc -l` + 1): 1650 → 1829 after format — today's pin has zero headroom; `seam-contract.test.js` budget test red | Leg 1, DD2 (re-base to the measured 1829) |
| `bookmarks-bar.js` budget | already-satisfied | 1040 → 1077 by the pin's metric, under the 1100 pin | none |
| *(line numbers below are **post-format** addresses from the spike's failing-test output; files are shorter pre-format — locate pins by `test(...)` title)* | | | |
| `cert-picker-template.test.js:129` | confirmed-live | fails after format (matcher literal) | Leg 1, DD3 |
| `move-authority.test.js:95` | confirmed-live | same | Leg 1, DD3 |
| `move-tab-synchrony.test.js:376` | confirmed-live | same | Leg 1, DD3 |
| `search-engines.test.js:387` | confirmed-live | same | Leg 1, DD3 |
| `session-restore-wiring.test.js:181` | confirmed-live | same | Leg 1, DD3 |
| `sheet-automation-gate-invariant.test.js:251` | confirmed-live | same | Leg 1, DD3 |
| `tab-adopt-by-drop.test.js:178, 354` | confirmed-live | exact multi-line literal `.replace()` mutation pins guarded by `assertMutated` — convert targets to regex (DD3 shape 1) | Leg 1, DD3 |
| `tab-adopt-by-drop.test.js:205` ("renderer bookends") | confirmed-live | no `.replace()` — Prettier splits the literal `'e.preventDefault(); return;'`; its `gate < declare` ordering assertion rides the re-targeted anchor (DD3 shape 3) | Leg 1, DD3 |
| `tab-drag-invariants.test.js:258, 402, 455` | confirmed-live | slice-window pins asserting absence (`/\bawait\b/` in an `indexOf`→`indexOf` window) — re-anchor AND keep a positive control (DD3 shape 2) | Leg 1, DD3 |
| Option (a) "tune `.prettierrc` toward house style" | already-decided (not achievable) | `printWidth` 100/120/140/160 → 355/318/321/325 files, `renderer.js` 1871/1828/1787/1774 (`wc -l`); `arrowParens`/`bracketSameLine`/`quoteProps`/`objectWrap`/`experimentalTernaries`/combo → 1810–1828. Prettier always expands one-line function bodies and splits over-width import lists | DD1; operator chose (b) |
| CI wiring (`format:check` in both CI definitions) | confirmed-live | `ci/tasks/lint.yml` and `.github/workflows/ci.yml` run `npm run lint` only | Leg 2, DD5 |
| `.prettierignore` gaps | already-satisfied | excludes bundle, lockfile, `*.md`, `missions/`, `maintenance/`, `tests/`; no `.dat`/asset touched | none |

Totals: 13 failing assertions in 9 test files (12 matchers + the budget pin) at `printWidth: 120`
(16 at 100, 12 at 160). Test count at base: 3839 (corrected — see Flight Director Notes; 3792 was pre-merge).

Design-review corrections (Architect, 2026-08-27): budget metric and numbers
(above); pin addresses labelled post-format; DD3 split into three pin
shapes; DD4 changed to two PRs so the blame-ignore sha is real; DD5 notes
`set-pipeline` is not needed and adds the `lint.yml` header + `ci/README.md`
row; Leg 2 *adds* the CLAUDE.md note (none exists). Confirmed by the
Architect: DD1 (live pipe through Prettier 3.9.6); the seam anchor
`Object.assign(/** @type {any} */ (globalThis), {` survives formatting so
`extractSeamIdentifiers` is unaffected; `styles.css` is already
Prettier-clean so `bookmarks-bar-css-pin.test.js` is untouched.

---

## Leg Progress

### format-and-repin

**Status**: landed (AC1–AC5 verified; AC6 blocked — see Deviations)
**Started**: 2026-08-27
**Completed**: 2026-08-27

**Changes Made**

- `npm run format` (`prettier --write .`) over the whole tree at the leg's base commit. 318 files formatted (`git diff --name-only | wc -l` → 321, minus the 3 pre-existing uncommitted planning artifacts (`mission.md`, `flight.md`, `flight-log.md`) = 318, matching the Inputs count exactly). `npx prettier --check .` is clean.
- Note: the first `prettier --write .` pass left 5 files (`src/main/app-db.js`, `src/renderer/renderer-globals.d.ts`, `src/renderer/renderer.js`, `test/unit/app-db.test.js`, `test/unit/bookmarks-store.test.js`) still flagged by `--check`; a second `--write` on just those 5 made the check clean. Non-deterministic first-pass behavior on this Prettier/Node combination — worth a note for Leg 2's CI wiring (a single `--write` may need to be idempotent-verified, or CI's `--check`-only invocation is unaffected either way since it doesn't write).
- Measured both budgeted files post-format by the pin's metric (`split(/\r?\n/).length`):
  - `src/renderer/renderer.js`: **1650 → 1827** (DD2 projected 1829; actual measured delta of 2 fewer lines — within the flight's Acceptable Variation for "the measured post-format counts differing from DD2's 1829/1077 by a few lines"). `RENDERER_LINE_BUDGET` re-based to **1827** in `test/unit/seam-contract.test.js`, comment updated with the metric and "Re-based 2026-08-27 (Flight 5, Prettier adoption)". Zero headroom preserved, as before.
  - `src/renderer/chrome/bookmarks-bar.js`: **1040 → 1077**, exactly matching DD2's projection, under the unchanged `BOOKMARKS_BAR_LINE_BUDGET` (1100) — no change needed.
- Fixed the 12 failing matcher pins the reformat broke (all 12 were on the Recon list — no pin outside it surfaced). Per-pin table below.
- Applied the two FD-ruled typing-comment corrections (AC6 unblock): `src/main/app-db.js:124-126` — bound the drifted `/** @type {any} */` cast to a local (`const anyErr = /** @type {any} */ (err);`) before the `&&` chain so it covers `err.errcode` on both disjuncts and can't be re-attached by a future reformat; `src/renderer/pages/vault.js:15` — moved the `// @ts-ignore — serving-path vs disk-path mismatch` comment (unchanged text) from above the `import {` line to immediately before the `} from './vault-editor-model.js';` line, where `tsc` now anchors the TS2307. Both edits verified `npx prettier --check` clean without any `--write`/hand-tweak cycle.

**Per-pin table**

| # | Test title | File | Shape | What changed | Neuter result |
|---|---|---|---|---|---|
| 1 | REGRESSION (M14 F3 HAT): the LIVE cert-picker model shape (`{certs, popup?}`) passes the sheet init gate — blank-sheet fix | `cert-picker-template.test.js` | 3 (presence) | `openOverlayMenu('cert-picker', { certs: Array.isArray(certs) ? certs : []` literal → wrap-insensitive regex (`\s*` between tokens) — Prettier wrapped the `openOverlayMenu(...)` call across 6 lines | Reverted `certs: Array.isArray(certs) ? certs : []` → `certs: certs` in `renderer.js`: 7/8 → red; restored → 8/8 green |
| 2 | AC5 mutated: resolving the source FROM THE PAYLOAD is caught — real → 1, mutated → 0 | `move-authority.test.js` | 1 (`.replace()` + `assertMutated`) | Exact-literal `.replace()` target (2-space indent) → regex with a captured-indent replacer function — the whole `ipcMain.handle('tab-move-to-window', ...)` block gained 2 spaces of indent (Prettier corrected a pre-existing under-indent) | Applied the payload-as-source-authority mutation directly to `register-tab-ipc.js`: 3/5 → red; restored → 5/5 green |
| 3 | the pin FAILS a suspension point between the delete and the set | `move-tab-synchrony.test.js` | 1 (`.replace()` chain + `assertMutated`) | Second literal in the `.replace().replace()` chain (2-space indent) → regex with a captured-indent replacer — same indent shift as #2, same source region | Inserted `await Promise.resolve();` between the delete/set lines in `register-tab-ipc.js`: 4/11 → red (7 failures); restored → 11/11 green |
| 4 | welcome-controller.js: the engine radio sync assigns .checked directly and the file never calls .click() on a radio | `search-engines.test.js` | 3 (presence) | `radio.checked = (radio.value === engine)` → `radio.checked = \(?radio\.value === engine\)?` — Prettier dropped the redundant parens | Changed the assignment to `radio.checked = true` in `welcome-controller.js`: 56/57 → red; restored → 57/57 green |
| 5 | AC4: window-boot-config returns restoreTabs — real → present, stripped → absent | `session-restore-wiring.test.js` | 1 (`.replace()` + `assertMutated`) | 3-line ternary literal → wrap-insensitive regex — Prettier collapsed the ternary onto one line (fits printWidth 120) | Replaced the return statement in `app-lifecycle.js` with the "stripped" shape: 11/12 → red; restored → 12/12 green |
| 6 | AC9: engine.js threads sheetMenuFor onto deps by the conditional-spread idiom, and exactly three ops opt in | `sheet-automation-gate-invariant.test.js` | 3 (presence, per-op) | Per-op regex `op + ':[^\n]*deps\(\{ allowSheet: true \}\)'` → bounded non-greedy `op + ':(?:(?!\n\s*\w+:)[\s\S])*?deps\(\{ allowSheet: true \}\)'` (negative lookahead refuses to cross into the next dispatch-table property, so it can't vacuously match a later op's opt-in) — Prettier wrapped `captureScreenshot`/`readAxTree`'s arrow bodies onto a second line | Stripped `readAxTree`'s `allowSheet: true` opt-in in `engine.js`: 7/8 → red; restored → 8/8 green |
| 7 | AC4: tab-drag-ended clears on the grace timer, never synchronously | `tab-adopt-by-drop.test.js` | 1 (`.replace()` + `assertMutated`) | Exact-literal `dragEndClearTimers.set(rec, setTimeout(...))` block → wrap-insensitive regex — Prettier exploded the call's multi-arg layout across 7 lines | Applied the synchronous-clear mutation directly to `register-tab-ipc.js`: 8/9 → red; restored → 9/9 green |
| 8 | AC4: the renderer bookends — dragstart declares, dragend ends BEFORE the null-session early return | `tab-adopt-by-drop.test.js` | 2 (slice-window, ordering) | `dsBody.indexOf('e.preventDefault(); return;')` → `dsBody.search(/e\.preventDefault\(\);\s*return;/)` — Prettier split the one-line guard onto two lines; existing `declare`/`ended`/`early` ordering checks are the positive controls, unchanged | Moved `tabDragStarted` above the gate in `tab-controller.js` (violates the ordering): 8/9 → red; restored → 9/9 green |
| 9 | AC5b: onTabMovedAway silently clears a live session whose tab is the departing one | `tab-adopt-by-drop.test.js` | 1 (`.replace()` + `assertMutated`) | `SILENT_CLEAR` exact-literal one-line if-body → `SILENT_CLEAR_RE` wrap-insensitive regex + `silentClearIndex()` helper — Prettier expanded the single-line `{ clearDragVisuals(); dnd = null; }` onto 3 lines | Removed the silent-clear block from `tab-controller.js`: 8/9 → red; restored → 9/9 green |
| 10 | AC5: `dnd` is nulled SYNCHRONOUSLY in dragend — no await precedes it, and the gate is present | `tab-drag-invariants.test.js` | 3 (presence) | `/e\.clientX, e\.clientY, dnd\.draggedIndex\);/` → `/e\.clientX,\s*e\.clientY,\s*dnd\.draggedIndex\s*\);/` — Prettier wrapped `classifyDragPoint`'s args (with inline `@type` casts) across 6 lines | Changed `e.clientX,` → `e.screenX,` at the dragend call site in `tab-controller.js`: 9/11 → red; restored → 11/11 green |
| 11 | AC10: every core refusal carries a reason, and the renderer maps every one | `tab-drag-invariants.test.js` | 3 (presence) | `/default: return \`[^\`]+\`;/` → `/default:\s*return \`[^\`]+\`;/` — Prettier split the `default:` case label from its `return` onto two lines | Changed the default-arm return to `''` (empty string literal) in `tab-controller.js`: 10/11 → red; restored → 11/11 green |
| 12 | DD16: no src/** file reads a cross-window coordinate — real → 0, mutated → 1 | `tab-drag-invariants.test.js` | 1 (`.replace()` + `assertMutated`, ×2 mutations) | `dnd.stripRect, dnd.slotRects,\n e.clientX, e.clientY, dnd.draggedIndex);` two-line literal → `CALL_SITE_RE` wrap-insensitive regex + a replacer that substitutes tokens within the matched text — Prettier collapsed this specific `classifyDragPoint` call (dragover handler) onto one line | Changed `e.clientX,` → `e.screenX,` at the dragover call site (`tab-controller.js:679`): 10/11 → red (banned-coordinate scan legitimately fires); restored → 11/11 green |

Every neuter check went red on the guarded line's removal/inversion and green on restore; every re-anchored slice-window pin (#8) kept its existing ordering assertions as positive controls (`declare`/`ended`/`early`, all still asserted before the change I made).

**Gate results**

- `npm test`: 3839/3839 pass, 0 fail, 0 skipped, 0 todo (see Deviations — pre-leg baseline is 3839, not the 3792 recorded in this flight's planning artifacts; no test added/removed/skipped/`.todo`'d by this leg).
- `npm run lint`: clean.
- `npx prettier --check .`: clean (318 files formatted; no `tests/behavior/` or `.md` file touched).
- `npm run typecheck`: clean (was **FAILS**; unblocked by the two FD-ruled edits above — see Deviations).

**Notes**

- No file under `tests/behavior/` or matching `*.md` was touched by Prettier (`.prettierignore` held).
- `git diff -w --stat -- src` still shows substantial insertions/deletions even with whitespace ignored — expected per DD1: Prettier's one-line-body and import-list expansions insert real new lines, which `-w` cannot hide. Spot-checked several files; the non-whitespace diff content is exclusively Prettier's line-splitting, no logic changes.

### ci-format-gate

**Status**: landed (AC1–AC7 verified)
**Started**: 2026-08-27
**Completed**: 2026-08-27

**Changes Made**

- `package.json`: added `"format:check": "prettier --check ."` beside `"format"`.
- `ci/tasks/lint.yml`: appended `npm run format:check` as the last line of the `run:` heredoc, after `npm run lint`; rewrote the header comment to `# ESLint + Prettier check over the repo — mirrors the GitHub Actions "Lint" step (ci.yml).`.
- `.github/workflows/ci.yml`: added a separate `- name: Format check` step (`run: npm run format:check`) immediately after the `Lint` step.
- `ci/README.md`: Lint row in "What runs where" reworded to `| Lint (ESLint + Prettier check) | tasks/lint.yml | "Lint" + "Format check" |`.
- `.git-blame-ignore-revs` (new, repo root): header comment explaining the file and the `git config blame.ignoreRevsFile .git-blame-ignore-revs` setup, then `339e808f229d342c114467d0142499d8cffc3eb7 # flight/05 leg 1 — Prettier reformat (#182)`.
- `CLAUDE.md`: `## Commands` gained three lines — `npm run format`, `npm run format:check` (naming both CI callers), and the `git config blame.ignoreRevsFile` one-liner. `## Patterns` gained one bullet ("Formatting is Prettier's (M17 F5)") pinning the two line budgets (`RENDERER_LINE_BUDGET` 1827, `BOOKMARKS_BAR_LINE_BUDGET` 1100) and retiring the fold-onto-one-line trick — placed at the end of the top-level Patterns bullet list, right after the Seam contract bullet (no closer natural neighbour; the two incidental "line-budget" mentions the Citation Audit flagged are about splitting logic across files, a different concept, and were left untouched).
- `docs/dev-testing.md`: one sentence appended to "Test layers" pointing at `npm run lint` / `npm run typecheck` / `npm run format:check` (or `npm run format` to fix).

**CI step shape chosen (AC3)**: a separate `- name: Format check` step, not a two-line `run: |` inside the existing `Lint` step. Every other step in `ci.yml` (`Checkout`, `Set up Node`, `Install dependencies`, `Unit tests`, `Type check`, `Lint`, `Dependency audit`, `Package`) already uses a single-line `run:` — per the Implementation Guidance's either-is-acceptable clause, matching that existing convention was the better fit than introducing the file's first multi-line `run: |` block. The Concourse-mirror claim in `ci/tasks/lint.yml`'s header comment stays true: the Concourse task now runs `npm run lint` then `npm run format:check` in one `run:` block, and GitHub Actions runs the same two commands as consecutive steps ("Lint" then "Format check") — same checks, same order, different step granularity.

**AC6 disposition**: `fly` is installed (`/home/<username>/.local/bin/fly`) and `fly targets` lists `local-goldfinch` (team `goldfinch`), so the primary path was attempted: `fly -t local-goldfinch execute -c ci/tasks/lint.yml -i repo=.` and `fly -t local-goldfinch status` both failed with `dial tcp 127.0.0.1:8080: i/o timeout` — the Concourse server itself is unreachable from this environment (not a missing tool or an expired login, so no `fly login` was attempted, per instruction not to log in to anything). Fell back to the task's commands locally (`npm ci` skipped — already installed): `npm run lint && npm run format:check` — both exit 0. **Concourse run deferred to the operator.**

**`git blame` before/after example (AC4)** — `src/renderer/renderer.js` lines 19–20 (`import {` / `  shouldQuery,`, an import-list Prettier reformatted):
- Plain `git blame`: `339e808f (C 2026-08-27 16:07:33 -0500 19) import {` — misattributed to the Leg 1 reformat commit.
- `git blame --ignore-revs-file .git-blame-ignore-revs`: `d9e764e5 (C 2026-07-29 21:13:45 -0500 19) import {` — correctly attributes to the commit that actually introduced this import, skipping over the reformat.

**Gate results**

- `npm test`: 3839/3839 pass, 0 fail, 0 skipped, 0 todo.
- `npm run lint`: clean.
- `npm run typecheck`: clean.
- `npx prettier --check .`: clean (all new/edited files individually verified Prettier-clean too; `.git-blame-ignore-revs` has no inferred parser, per DD5, and is never visited by the check).

---

## Decisions

---

## Deviations

### AC6 blocked — Prettier's reformat broke `npm run typecheck` on two source files (not in the Recon list)

`npm run lint` is clean, but `npm run typecheck` (`tsc --noEmit -p jsconfig.json`) fails with 2 errors that do **not** exist on the pre-format tree (verified live: stashed all leg changes, `npm run typecheck` on the unformatted base commit is clean; restored the stash immediately after — `npm test` re-confirmed 3839/3839 green post-restore):

```
src/main/app-db.js(128,29): error TS2339: Property 'errcode' does not exist on type 'object'.
src/renderer/pages/vault.js(16,8): error TS2307: Cannot find module './vault-editor-model.js' or its corresponding type declarations.
```

**Root cause, both cases**: Prettier reflows code around inline JSDoc type-cast comments (`/** @type {any} */ (expr)`) and `// @ts-ignore` directives without understanding their TypeScript-checker meaning (this is a plain `.js` file under `// @ts-check`, so Prettier's parser treats these as ordinary comments):

- `app-db.js` `isCorruptionErrcode()`: the pre-format source was `!!err && typeof err === 'object' && (\n  /** @type {any} */ (err).errcode === SQLITE_CORRUPT || /** @type {any} */ (err).errcode === SQLITE_NOTADB\n)` — each `/** @type {any} */` cast wrapped its own `(err)`. Prettier's multi-line `&&`-chain reformat reprinted the leading comment at the outer group boundary instead of on `(err)`, so the first disjunct is now effectively `/** @type {any} */ (err.errcode === SQLITE_CORRUPT || ...)` — the cast now applies to the whole boolean sub-expression, not to `err`, so `err.errcode` on the (still `unknown`-typed) `err` fails to typecheck.
- `vault.js`: a `// @ts-ignore` (which only suppresses the diagnostic on the *next* line) sat directly above a one-line `import { ... } from './vault-editor-model.js';`. Prettier's over-width import-list expansion (DD1's documented, accepted expansion) split the import across 14 lines; `tsc` now anchors the module-resolution diagnostic on the `} from '...'` line, 10 lines past the `@ts-ignore`, so the suppression no longer reaches it.

**Why I stopped rather than fixing it**: fixing either requires editing `src/main/app-db.js` or `src/renderer/pages/vault.js` by hand (restructuring the cast, or moving/duplicating the `@ts-ignore`) — which the leg's Implementation Guidance and AC5 both forbid ("no source file was hand-edited except by Prettier"; "the diff outside `test/unit/` is Prettier's output only"). This is not one of the twelve Recon-listed matcher pins and doesn't fit any of the leg's edge cases (it's a source-file typecheck regression, not a test-pin retarget). DD1 accepted Prettier's line-expansion behavior in the abstract but the Recon spike evidently didn't run `npm run typecheck` against the formatted tree (only `prettier --check` + `npm test` are recorded in the leg's Inputs), so this fallout wasn't caught before the leg started.

**Flagging for the Flight Director / Architect** — this needs a ruling, not a quiet edit, per the same principle DD5 applies to `.prettierignore`: options include (a) hand-fix the 2 files as an explicitly-scoped exception to AC5 (the safest fix: for `app-db.js`, replace the double-cast idiom with a single `/** @type {any} */ (err)` local before the `||`; for `vault.js`, move the `@ts-ignore` or replace it with a `@ts-expect-error` immediately above the `from` line, or restructure to a single-line import Prettier won't wrap), (b) exclude these two files from `prettier --write`/`--check` via `.prettierignore` with a comment explaining why, or (c) grep the other 96 occurrences of the `/** @type {any} */ (` idiom across `src/**` for latent (not-yet-`tsc`-flagged) instances of the same relocation risk before deciding. I did not choose among these — that's this leg's stop-and-report boundary.

**Disposition**: AC1–AC5 verified and checked off below; AC6 left unchecked. Leg status set to `landed` (implementation complete, submitted for review) rather than blocking the whole leg — the FD can decide whether to fold the typecheck fix into this leg's review pass, spin it out as a squawk, or amend DD1/DD5.

**FD ruling: correctness edit; applied.** The Flight Director ruled AC5's "no hand-edited source" intent is about hand-formatting, not correctness fixes, and authorized the two minimal, site-confined edits described in the Flight Director Notes below. Both are applied: `src/main/app-db.js:124-126` binds the cast to a local (`anyErr`) before the `&&` chain; `src/renderer/pages/vault.js:15` moves the `// @ts-ignore` to the line immediately before the `} from './vault-editor-model.js';` module-specifier line (text unchanged; import kept multi-line). Each edit was verified `npx prettier --check` clean with no `--write`/hand-tweak cycle. `npm run typecheck` is now clean; full gates re-run: `npm test` 3839/3839 (0 fail/skip/todo), `npm run lint` clean, `npx prettier --check .` clean. `git diff -w -- src/main/app-db.js src/renderer/pages/vault.js` shows no non-Prettier content beyond these two edits. AC5 and AC6 updated accordingly in the leg artifact.

### Test count baseline mismatch (informational, not caused by this leg)

The leg artifact's Inputs and this flight log both record "npm test 3792/3792" / "Test count at base: 3792" for the base commit `c6cacc4`. The actual, reproducible pre-format count on this tree is **3839** (verified twice before formatting, and again via the stash/pop above). `git diff --stat f142f90 c6cacc4 -- test/` is empty, so this isn't something that landed between the Recon spike and the leg's start — the 3792 figure in the planning artifacts appears to have been stale even at flight-plan time. I used the measured 3839 as the actual invariant (no test added/removed/skipped/`.todo`'d) for AC2, since that's what "the pre-leg test count" can only mean on the real tree. Both `npm test` runs (start of leg, end of leg) read 3839/3839.

---

## Anomalies

---

## Session Notes

---

## Flight Director Notes

- 2026-08-27 — `/agentic-workflow` started. Crew file `.flightops/agent-crews/leg-execution.md` validated (Crew / Interaction Protocol / Prompts present). Mission 17 `planning → active` (first flight to fly); Flight 5 `ready → in-flight`; branch `flight/05-prettier-adoption` from `main` `c6cacc4`. Test count at base: 3792.
- Commit model: per DD4 this flight deviates from the deferred single-commit default — each leg gets its own Reviewer pass, commit, and PR (squash-merged before the next leg starts), so Leg 2 can write Leg 1's real squash sha into `.git-blame-ignore-revs`.
- Leg 1 `format-and-repin` risk tier: **low**. Rationale: the reformat is mechanical and single-surface; the matcher re-targets are test-only edits whose three shapes, positive-control rule, and budget numbers were validated against the code in two Architect design-review cycles at flight level (live pipe through Prettier 3.9.6, pin metric re-measured). A per-leg design review would re-cover the same ground; the leg-end Reviewer covers the code. Divert criterion stands for any pin that cannot be re-targeted without weakening.
- 2026-08-27 — Leg 1 landed with AC6 blocked: `npm run typecheck` fails on two Prettier-induced typing-comment displacements (`src/main/app-db.js` — a `/** @type {any} */` cast re-attached to the wrong parenthesized group in a reformatted `&&` chain; `src/renderer/pages/vault.js` — a `// @ts-ignore` now ten lines above the TS2307 it suppresses, after DD1's import expansion). The Developer stopped because AC5 forbids hand-editing source. **FD ruling**: AC5's intent is "no hand-formatting"; restoring the placement of a typing comment is a correctness edit, not formatting. Two minimal, Prettier-stable edits are authorized and confined to those two sites: bind the cast to a local (`const anyErr = /** @type {any} */ (err);`-style) so it cannot drift again, and move the `// @ts-ignore` onto the line immediately before the module-specifier line it suppresses (the known flat-served-specifier TS2307 — BACKLOG "Internal pages: flat-served import specifiers are untypeable"). Recorded as a Deviation against AC5; the leg is not aborted (no requirement changed — an edge case surfaced). The Reviewer is told to check both edits are the only non-Prettier source changes.
- 2026-08-27 — Correction to the Recon Report / leg Inputs: the pre-leg test count is **3839**, not 3792. 3792 was measured on the batch-3 turnaround branch before PRs #177–#179 merged (which added 47 tests); the Developer verified 3839 on the actual base `c6cacc4` twice and used it as the AC2 invariant. Measured budgets on this base: `renderer.js` 1650 → 1827 (the Architect's 1829 was measured at `f142f90`, before the turnaround merges touched `renderer.js`); `bookmarks-bar.js` 1040 → 1077. DD2 says "measured", so 1827 is the re-based budget.
- 2026-08-27 — Leg 1 review: Reviewer (Sonnet) `[HANDOFF:confirmed]` first pass; all four gates re-run live; four pins independently neuter-verified across the DD3 shapes; the two authorized typing-comment edits confirmed semantically identical. Non-blocking: the reformat touched **319** files (the log's 318 omitted `eslint.config.mjs`); and the three `tab-drag-invariants` pins needed shape-1/shape-3 treatment, not the shape-2 absence-window re-anchor DD3 predicted — the prediction was wrong, the fixes are right (per-pin table reflects the true shapes). Leg 1 → `completed`; committing and opening its PR per DD4.
- 2026-08-27 — Leg 1 merged as PR #182, squash sha `339e808f229d342c114467d0142499d8cffc3eb7`; flight branch re-created from `main` at that sha for Leg 2. Leg 2 `ci-format-gate` designed; risk tier **low** (additive CI/doc wiring, no runtime surface, no shared interface; the one non-obvious step — the blame-ignore file — is verified by a `git blame` comparison in AC4). No per-leg design review; leg-end Reviewer covers it.
- 2026-08-27 — Leg 2 review: Reviewer `[HANDOFF:confirmed]` first pass, all seven ACs re-verified incl. the blame comparison and all four gates; one non-blocking artifact-sync note (flight checkbox/status), which is Phase 3 work done here by the FD. Leg 2 → `completed`; Flight 5 → `landed`; Flight 5 and mission criterion 7 checked off in Mission 17. Concourse task run still deferred to the operator (`fly` reached `127.0.0.1:8080` timeout) — first push to `main` with the new `lint.yml` will exercise it. `[COMPLETE:flight]`. Debrief via `/flight-debrief`.
