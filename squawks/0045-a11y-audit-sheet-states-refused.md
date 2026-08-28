# Squawk 0045: `npm run a11y` cannot complete — its sheet-state loop injects axe into the menu-overlay sheet, refused since M15 F3

**Status**: completed
**Type**: defect
**Severity**: grounding
**Reported**: 2026-08-28
**Completed**: 2026-08-28

## Report

`npm run a11y` exits **2** (apparatus failure) on every run since M15 F3 and never reaches its report: after the chrome states, the `SHEET_STATES` loop (`scripts/a11y-audit.mjs:501-604`) resolves the sheet's wcId and calls `runAxe(client, sheetWcId, …)` → `injectScript`, which main refuses for any sheet at any tier — `automation: secret-sheet — wcId 18 is a chrome-owned secret/overlay sheet and is never automatable (any tier)` (`src/main/automation/resolve.js:210-217`, `isSheetContents` guard). CLAUDE.md already rules the sheet un-auditable by axe ("READABLE BUT NOT SCRIPTABLE since M15 F3 … `evaluate` / `injectScript` are refused on it unconditionally, so axe-core auditing of any sheet state stays out of reach"); the script was never updated to that ruling. The loop's other sheet-side calls (`evaluate(client, sheetWcId, …)` for the downloads max-height, `SHEET_DISMISS_EXPR`, `SHEET_CLOSED_EXPR`) are refused the same way. Net: the verify-only a11y gate that issue #174 and the Mission 17 Flight 1 HAT rely on is dead, and the chrome states' results are lost with it.

Observed 2026-08-28 on `flight/01-keyboard-reachability` (Legs 1–3) with `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa --url=http://127.0.0.1:8001/` — the very first sheet state (`sheet:bookmark-edit`) fails the run.

## Evidence

- `scripts/a11y-audit.mjs:501-604` — `SHEET_STATES` and the loop that `runAxe`s the sheet wcId (`:594`) and dismisses via `evaluate` on it (`:595-603`).
- `src/main/automation/resolve.js:210-217` — the unconditional `secret-sheet` refusal for `isSheetContents(wc)`.
- CLAUDE.md § MCP automation — the M15 F3 ruling quoted above.
- Run log: `a11y-audit: injectScript(axe) failed for state "sheet:bookmark-edit": automation: secret-sheet — wcId 18 … never automatable (any tier)`; exit 2.

## Corrective Action

*(recorded by the Developer)*

Fix shape: the sheet states are unobservable to axe by ruling, so the script must not treat that refusal as an apparatus failure. Skip the sheet loop with a printed notice listing the skipped labels (keep `SHEET_STATES` as the record of what is not covered), run the chrome states to completion, and keep the exit-code contract (0 clean / 1 new violations / 2 apparatus failure) for what *is* audited. Pin it: a source pin beside `test/unit/a11y-audit-exit-codes.test.js` that the sheet loop is guarded by the skip notice. Update `docs/dev-testing.md` § a11y audit ("five chrome states + eight sheet states" → chrome states only; sheet states listed as skipped) and the CLAUDE.md `npm run a11y` line if it claims sheet coverage.

Implemented in `scripts/a11y-audit.mjs`: the `SHEET_STATES` array stays as the record of what is not covered, but the `for (const state of SHEET_STATES)` loop that used to open each state from the chrome and call `runAxe`/`evaluate` on the sheet's wcId is gone — replaced with a single `console.log` skip notice (printed after the chrome states run to completion) that reports `SHEET_STATES.length` and lists every skipped label. The now-dead sheet-discovery/dismissal machinery the old loop depended on (`findSheetWcId`, `SHEET_NODE_IDS`, `SHEET_DISMISS_EXPR`, `SHEET_CLOSED_EXPR`) was removed rather than left unreachable, so it can't silently rot or get re-wired into the live path by a future edit. The `fail()`/exit-code contract (0 clean / 1 new violations / 2 apparatus failure) is untouched — no new `process.exit` call site was added, and `test/unit/a11y-audit-exit-codes.test.js` stays green unmodified. No CLI flag was added, no main-process code (`resolve.js` included) was touched.

Docs: `docs/dev-testing.md` § *a11y audit* — the **Coverage** bullet now says the chrome states only, with the sheet states named as skipped by ruling (squawk 0045) and why. The CLAUDE.md `npm run a11y` line was reviewed and does not claim sheet coverage (it defers to `docs/dev-testing.md` for audited-states detail), so it was left unchanged per the fix shape's conditional.

Pin: `test/unit/a11y-audit-sheet-skip.test.js` (new, beside `test/unit/a11y-audit-exit-codes.test.js`, same static-parse house style) — asserts `SHEET_STATES` stays defined, the skip notice exists and references `SHEET_STATES.length` + every label, no `for (const state of SHEET_STATES)` loop remains, no `runAxe(client, sheetWcId, ...)` call site exists, and `findSheetWcId`/`SHEET_DISMISS_EXPR`/`SHEET_CLOSED_EXPR` are no longer defined.

## Verification

*(recorded by the Developer)*

- **Neuter-verify**: temporarily replaced the skip notice with a reintroduced `for (const state of SHEET_STATES) { … runAxe(client, sheetWcId, …) … }` loop shape — `test/unit/a11y-audit-sheet-skip.test.js` went **red** (`expected a printed skip notice listing SHEET_STATES.length skipped sheet state(s)`), confirming the pin actually guards the fix. Reverted to the real fix; re-ran green.
- `node --test test/unit/a11y-audit-sheet-skip.test.js test/unit/a11y-audit-exit-codes.test.js` — both green (2/2 pass); the exit-code pin is unaffected by this change.
- `timeout 300 npm test` — 3844/3844 pass, 0 fail.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npx prettier --check .` — clean (`prettier --write` run on the touched files first: `scripts/a11y-audit.mjs`, `test/unit/a11y-audit-sheet-skip.test.js`, `docs/dev-testing.md`, this squawk file — only the new test file needed a rewrap).
- `npm run a11y` was **not** run (needs the live app/GUI); the Flight Director runs it to confirm the chrome sweep now reaches its report instead of dying at exit 2 on the first sheet state.

## Sign-off

Independent Reviewer (leg-execution crew), 2026-08-28: `[HANDOFF:confirmed]` — diff confined to `scripts/a11y-audit.mjs`, the new pin, and `docs/dev-testing.md`; exit-code contract intact; pin non-tautological; gates green (3844/3844, lint, typecheck, prettier). Live verification by the Flight Director: the fixed script against the Mission 17 Flight 1 Legs 1–3 build → exit 0, "No NEW violations", 19 sheet states skipped by ruling. Follow-ups noted (not folded in): stale comment mentions of the removed helpers in `test/unit/a11y-audit-exit-codes.test.js:28` and `test/unit/vault-accesskey-template.test.js:8` — a comment-only servicing squawk for the next turnaround.
