# Squawk 0190: A profile export fails entirely when one vault is unreadable

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: 2026-11-19

## Report
Carried from Mission 23 Flight 2 (legs `vault-format-v2` and its review). `exportProfile` reads and rebuilds every vault for the bundle; if one vault file is corrupt, missing its key envelope, or does not unwrap, the whole export throws and nothing is exported — the operator cannot back up the vaults that are fine. This was already true before the flight; the per-entry rebuild added one more way to reach it.

## Evidence
- `src/main/vault/vault-store.js` — `_exportProfile` (per-entry read, unwrap and rebuild with no per-entry `try`).
- Flight debrief, `missions/23-security-review-remediation/flights/02-vault-and-automation-boundary/flight-debrief.md`, Technical.

## Corrective Action
Profile export now rebuilds each vault in its own try (planner/actuator, no early return in the loop):
- `src/main/vault/vault-store.js` `_exportProfile`: a vault whose read, mrk-envelope lookup, unwrap or rebuild throws is skipped; `carried`/`usedHandles` are only updated after a successful rebuild so `carried` still matches `bundle.vaults`. Returns the additive main-side `skipped: [{ id, reason }]` (never in the bundle; no bundle format change). `exportSkipReason` maps the error class to a fixed code (`no-unwrap`, `unreadable-format`, `read-failed`), never a message. One `_log` line per skipped vault (id + code). `VaultLockedError` still propagates.
- Edge choice: if every present vault is unreadable the export THROWS `VaultFormatError` (no empty bundle), as today.
- Upstream: `register-vault-ipc.js` `internal-vault-export-profile` forwards `skipped` in its success reply (one additive field); `vault-restore-controller.js` appends one clause to the existing "Exported N vaults" notice ("N unreadable vault(s) skipped."); `renderer-globals.d.ts` typed. The page shows a count only, no ids.
- Tests: new `test/unit/vault-export-profile-skip.test.js`; `reveal-gate-registrars.test.js` fake/expectation gained `skipped: []`.


## Verification
An export of a profile with one deliberately corrupted vault file writes a bundle holding the readable vaults and reports the one it skipped; a unit test builds that profile and restores the bundle.

Ran: `node --test` on the new file: 3/3 pass (corrupt vault skipped + reported + one log line + restore of the bundle keeps Global/Personal items and leaves Work empty; clean profile reports `skipped: []`; all-unreadable throws). Neuter-verify: adding `throw err` in the catch made the corrupt-vault test fail (1 fail), restored -> 3/3. `npm test`: 7407 tests, 7402 pass, 0 fail (rest skipped/todo-free counts per runner). `npm run lint`, `npm run typecheck`, `npm run format:check`: clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fifth 2026-11-19 turnaround)
**Verdict**: confirmed. `VaultLockedError` still propagates; every other per-vault failure becomes a skip with a fixed reason code taken from the error class, never its message. `carried` matches the bundle exactly, `skipped` is not in the bundle, the log and UI carry no titles or secrets, and the bundle restores. Low (accepted): a jar missing from the jar lookup is now a `read-failed` skip rather than a whole-export throw. Gates at re-review: `npm test` 7,417 tests (7,412 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-e`
