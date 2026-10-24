# Squawk 0142: `PRESS_KEY_NAMES` is a hand list that can drift from `KEY_MAP`

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-10
**Completed**: 2026-10-24

## Report
The `pressKey` tool advertises its key vocabulary through `PRESS_KEY_NAMES`, a hand-written string in `src/main/automation/mcp-tools.js`. The keys it actually accepts come from `KEY_MAP` in `src/main/automation/input.js`, a separate hand list. Nothing ties the two together. F6 was added to `KEY_MAP` in M17 F1 L1 but missed `PRESS_KEY_NAMES` until Sortie 03 (the hard-reload leg's design review spotted it). The fix is to derive `PRESS_KEY_NAMES` from `Object.keys(KEY_MAP)` (plus the `ShiftTab` composite), or to add a drift-guard test asserting the two agree.

## Evidence
- `src/main/automation/mcp-tools.js` — `const PRESS_KEY_NAMES = 'Tab, Enter, Escape, Space, ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete, Backspace, F5, F6, ShiftTab';`
- `src/main/automation/input.js` — `const KEY_MAP = { Tab: 'Tab', … F6: 'F6', F5: 'F5' }` plus the `ShiftTab` composite in `keyEvents`.
- Sortie 03 debrief, Recommendation 3 (`sorties/03-hard-reload/flight-debrief.md`).

## Corrective Action
`input.js` now exports `KEY_NAMES` (`Object.freeze([...Object.keys(KEY_MAP), 'ShiftTab'])`), also used by the `unknown key` error text. `mcp-tools.js` derives `PRESS_KEY_NAMES` from it (`KEY_NAMES.join(', ')`) instead of a hand string. Advertised order is now KEY_MAP declaration order (F6 before F5); the same keys as before. A new unit test parses the `KEY_MAP` literal independently and asserts `KEY_NAMES` equals its keys + `ShiftTab`, and that the `pressKey` description and both `name`/`key` param descriptions contain the list. `docs/mcp-automation.md` does not enumerate the keys, so no doc change.

## Verification
`automation-mcp-tools` + `automation-input` unit tests pass (160/160). Format, lint, typecheck and full `npm test` results recorded in the implementer report.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. The advertised key set is unchanged (the same 15 names; only F5/F6 order follows `KEY_MAP`). The drift test parses the `KEY_MAP` literal independently, so it is not vacuous. There is no Electron/SDK import via `input.js`. Non-blocking: the `mcp-tools.js` header comment wording. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`

## Disposition
**Deferred**: logged from the Sortie 03 debrief. Nothing is broken today (the lists agree as of `c7d8840`). Revisit when the automation key vocabulary is next touched, or at the next squawk turnaround.

**Picked up 2026-10-23** at the squawk turnaround (the stated revisit trigger); implemented as derivation from `KEY_MAP` plus a pinning test.
