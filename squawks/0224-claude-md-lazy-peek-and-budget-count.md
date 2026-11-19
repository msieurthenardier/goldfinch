# Squawk 0224: CLAUDE.md does not document the "lazy with peek" pattern or the line-budget counting rule

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
Two documentation gaps, found by the Mission 24 Flight 3 debrief:

1. **The "lazy with peek" pattern is undocumented.** It pairs a constructing getter with a `peekX()` that never constructs, so the quit and power paths can never build what they read. `vault/vault-wiring.js` `getVaultStore` / `peekVaultStore` (and `peekVaultHuman`) is its first explicit use, and the quit-lock safety property rests on it. *Recurring module shapes* in CLAUDE.md does not name it.
2. **The line-budget counting rule is not stated.** CLAUDE.md's *Formatting is Prettier's* budget sentence does not say that the count is `split(/\r?\n/).length` on Prettier output, which is one more than `wc -l` for a file ending in a newline. Leg 3 of Flight 3 first set `RENDERER_LINE_BUDGET` from `wc -l` and failed a test run.

## Evidence
- `src/main/vault/vault-wiring.js`: `peekVaultStore`, used by `main.js` `lockVaultForQuit` and the `createPowerLock` deps; pinned in `test/unit/vault-power-lock.test.js`.
- `test/unit/seam-contract.test.js`: the `renderer.js` line-budget test counts `split(/\r?\n/).length`.
- `missions/24-maintenance/flights/03-decompose-main/flight-debrief.md`, *Documentation*.

## Corrective Action
*(written at completion)*

## Verification
CLAUDE.md *Recurring module shapes* has a "Lazy with peek" bullet naming `vault-wiring.js` as the exemplar. The budget sentence names the `split(/\r?\n/)` rule. `npm run format:check` passes.
