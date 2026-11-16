# Squawk 0193: closeSavePromptAndDrop is now the general tab-left-the-front hook

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: —

## Report
From the Mission 23 Flight 2 debrief (Architect). `closeSavePromptAndDrop` in `register-tab-ipc.js` began as the save prompt's close-and-drop; it now also drops the vault picker context and, since the walk's fix, cancels a pending reveal confirmation, through a fifth positional parameter. Six call sites pass five arguments. Its name no longer says what it is, and the next 'this tab stopped being in front' consumer will add a sixth parameter.

## Evidence
- `src/main/register-tab-ipc.js` — `closeSavePromptAndDrop(owner, wcId, reason, vaultHuman, tabInactive)` and its five call sites; `src/main/html-fullscreen.js` — the sixth.
- `test/unit/reveal-gate-stranding-wiring.test.js` — pins every call site passes the hook.

## Corrective Action
*(written at completion)*

## Verification
The function is renamed for what it does and takes its collaborators as one object; the wiring pins are re-targeted with `assertMutated`; no behaviour change (the save-prompt, picker-context and reveal-gate tests pass unmodified in their assertions).

## Sign-Off
*(written at completion)*
