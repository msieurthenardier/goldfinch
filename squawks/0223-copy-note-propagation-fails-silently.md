# Squawk 0223: The vault copy handler skips note propagation silently when the new-id diff is not exactly one

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
For a copy whose outcome is `copied` or `kept-both`, `internal-vault-item-copy` finds the destination item's new id by diffing the destination's `listItemsMeta` before and after the synchronous `copyItem`. If that diff is not exactly one id, the handler skips `revealGate.itemCopied` and logs nothing. A source item renamed while automation was active, then copied to a new item, would show its spoofed title with no "changed" note. This cannot happen today (`copyItem` is synchronous and writes one item), but it fails open, and it fails silently. From the Mission 24 Flight 2 debrief, Developer interview.

## Evidence
- `src/main/register-vault-ipc.js`, the `internal-vault-item-copy` handler: the before/after id diff, then the `itemCopied` call (Mission 24 Flight 2, leg `item-write-grants`).
- `missions/24-maintenance/flights/02-reveal-gate-item-writes/flight-debrief.md`, *Technical*.

## Corrective Action
`src/main/register-vault-ipc.js`: new `noteSkipped(reason)` writes one `console.warn` line (`[internal-vault-item-copy] <reason>`; precedent `register-overlay-ipc.js` `[cert-override-proceed]`; this registrar has no injected logger). `noteCopy` calls it when the before/after diff adds zero ids (`copy-note-no-new-id`), more than one (`copy-note-ambiguous-new-id`), or the before-snapshot could not be taken (`copy-note-no-baseline`). Skip behaviour and reply unchanged; no id or title in the line. `copyItem` untouched.

## Verification
- A unit test with a store whose copy adds zero ids, and one whose copy adds two, asserts that the reply is unchanged, that `itemCopied` is not called, and that exactly one log line is written per reason (the reason code and channel, never an id or title).
- The behaviour is otherwise unchanged. The real fix, `copyItem` returning the written id, is a separate flight item.

Ran: new `test/unit/vault-copy-note-skip.test.js` (zero and two added ids, for `copied` and `kept-both`: reply unchanged, `itemCopied` not called, exactly one log line equal to the reason code and channel with no id/title; one-added control: called, no log) - 5 pass. Neuter-verified: with the log line removed 4 of 5 fail; restored. `npm test` 7410 pass / 0 fail; `npm run lint`, `npm run typecheck`, `npm run format` then `format:check` clean.
Follow-up (review, low): added a case to `test/unit/vault-copy-note-skip.test.js` where the before-snapshot `listItemsMeta` throws on its first call (`copied` and `kept-both`): reply unchanged, `itemCopied` not called, exactly one log line `[internal-vault-item-copy] copy-note-no-baseline` with no id/title. Neuter-verified (call removed: 2 new cases fail; restored). A non-string destination id is not a separate case: `noteCopy` returns at its string check before `noteSkipped`, so no log is written on that path. File 7 pass.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fifth 2026-11-19 turnaround)
**Verdict**: confirmed. Zero and two added ids, for `copied` and `kept-both`, log one reason line with no id or title and leave the reply and `itemCopied` unchanged. One low finding — the Developer's extra `copy-note-no-baseline` reason had no test — was fixed by adding one, neuter-verified. Gates at re-review: `npm test` 7,417 tests (7,412 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-e`
