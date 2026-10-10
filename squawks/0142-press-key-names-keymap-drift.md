# Squawk 0142: `PRESS_KEY_NAMES` is a hand list that can drift from `KEY_MAP`

**Status**: deferred
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-10
**Completed**: —

## Report
The `pressKey` tool advertises its key vocabulary through `PRESS_KEY_NAMES`, a hand-written string in `src/main/automation/mcp-tools.js`. The keys it actually accepts come from `KEY_MAP` in `src/main/automation/input.js`, a separate hand list. Nothing ties the two together. F6 was added to `KEY_MAP` in M17 F1 L1 but missed `PRESS_KEY_NAMES` until Sortie 03 (the hard-reload leg's design review spotted it). The fix is to derive `PRESS_KEY_NAMES` from `Object.keys(KEY_MAP)` (plus the `ShiftTab` composite), or to add a drift-guard test asserting the two agree.

## Evidence
- `src/main/automation/mcp-tools.js` — `const PRESS_KEY_NAMES = 'Tab, Enter, Escape, Space, ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete, Backspace, F5, F6, ShiftTab';`
- `src/main/automation/input.js` — `const KEY_MAP = { Tab: 'Tab', … F6: 'F6', F5: 'F5' }` plus the `ShiftTab` composite in `keyEvents`.
- Sortie 03 debrief, Recommendation 3 (`sorties/03-hard-reload/flight-debrief.md`).

## Corrective Action
—

## Verification
—

## Sign-Off
—

## Disposition
**Deferred**: logged from the Sortie 03 debrief. Nothing is broken today (the lists agree as of `c7d8840`). Revisit when the automation key vocabulary is next touched, or at the next squawk turnaround.
