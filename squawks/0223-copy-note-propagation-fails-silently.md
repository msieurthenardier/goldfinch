# Squawk 0223: The vault copy handler skips note propagation silently when the new-id diff is not exactly one

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
For a copy whose outcome is `copied` or `kept-both`, `internal-vault-item-copy` finds the destination item's new id by diffing the destination's `listItemsMeta` before and after the synchronous `copyItem`. If that diff is not exactly one id, the handler skips `revealGate.itemCopied` and logs nothing. A source item renamed while automation was active, then copied to a new item, would show its spoofed title with no "changed" note. This cannot happen today (`copyItem` is synchronous and writes one item), but it fails open, and it fails silently. From the Mission 24 Flight 2 debrief, Developer interview.

## Evidence
- `src/main/register-vault-ipc.js`, the `internal-vault-item-copy` handler: the before/after id diff, then the `itemCopied` call (Mission 24 Flight 2, leg `item-write-grants`).
- `missions/24-maintenance/flights/02-reveal-gate-item-writes/flight-debrief.md`, *Technical*.

## Corrective Action
*(written at completion)*

## Verification
- A unit test with a store whose copy adds zero ids, and one whose copy adds two, asserts that the reply is unchanged, that `itemCopied` is not called, and that exactly one log line is written per reason (the reason code and channel, never an id or title).
- The behaviour is otherwise unchanged. The real fix, `copyItem` returning the written id, is a separate flight item.
