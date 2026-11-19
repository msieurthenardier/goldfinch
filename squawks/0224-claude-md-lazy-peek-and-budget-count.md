# Squawk 0224: CLAUDE.md does not document the "lazy with peek" pattern or the line-budget counting rule

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
Two documentation gaps, found by the Mission 24 Flight 3 debrief:

1. **The "lazy with peek" pattern is undocumented.** It pairs a constructing getter with a `peekX()` that never constructs, so the quit and power paths can never build what they read. `vault/vault-wiring.js` `getVaultStore` / `peekVaultStore` (and `peekVaultHuman`) is its first explicit use, and the quit-lock safety property rests on it. *Recurring module shapes* in CLAUDE.md does not name it.
2. **The line-budget counting rule is not stated.** CLAUDE.md's *Formatting is Prettier's* budget sentence does not say that the count is `split(/\r?\n/).length` on Prettier output, which is one more than `wc -l` for a file ending in a newline. Leg 3 of Flight 3 first set `RENDERER_LINE_BUDGET` from `wc -l` and failed a test run.

## Evidence
- `src/main/vault/vault-wiring.js`: `peekVaultStore`, used by `main.js` `lockVaultForQuit` and the `createPowerLock` deps; pinned in `test/unit/vault-power-lock.test.js`.
- `test/unit/seam-contract.test.js`: the `renderer.js` line-budget test counts `split(/\r?\n/).length`.
- `missions/24-maintenance/flights/03-decompose-main/flight-debrief.md`, *Documentation*.

## Corrective Action
CLAUDE.md: added a "Lazy with peek" bullet to *Recurring module shapes* (cites `vault-wiring.js` `getVaultStore`/`peekVaultStore`/`peekVaultHuman`, `main.js` `lockVaultForQuit` and `createPowerLock` deps, `vault-power-lock.test.js`); *Formatting is Prettier's* now states the `split(/\r?\n/).length` count is one more than `wc -l` for a newline-terminated file.

## Verification
CLAUDE.md *Recurring module shapes* has a "Lazy with peek" bullet naming `vault-wiring.js` as the exemplar. The budget sentence names the `split(/\r?\n/)` rule. `npm run format:check` passes.

Ran `npm run format` then `npm run format:check`: passed.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the third 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. Every claim in the "Lazy with peek" bullet holds at a call site (`vault-wiring.js` `getVaultStore` / `peekVaultStore` / `peekVaultHuman`, `main.js` `lockVaultForQuit` and the `createPowerLock` deps, the `vault-power-lock.test.js` scan); the budget sentence states the `split(/\r?\n/)` rule and the `wc -l` difference. Gates at review: `npm test` 7,390 tests (7,385 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-c`
