# Squawk 0193: closeSavePromptAndDrop is now the general tab-left-the-front hook

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: 2026-11-19

## Report
From the Mission 23 Flight 2 debrief (Architect). `closeSavePromptAndDrop` in `register-tab-ipc.js` began as the save prompt's close-and-drop; it now also drops the vault picker context and, since the walk's fix, cancels a pending reveal confirmation, through a fifth positional parameter. Six call sites pass five arguments. Its name no longer says what it is, and the next 'this tab stopped being in front' consumer will add a sixth parameter.

## Evidence
- `src/main/register-tab-ipc.js` — `closeSavePromptAndDrop(owner, wcId, reason, vaultHuman, tabInactive)` and its five call sites; `src/main/html-fullscreen.js` — the sixth.
- `test/unit/reveal-gate-stranding-wiring.test.js` — pins every call site passes the hook.

## Corrective Action
`closeSavePromptAndDrop` in `src/main/register-tab-ipc.js` is now `onTabLeftFront(owner, wcId, reason, { vaultHuman, tabInactive } = {})`: the name says it is the "this tab stopped being in front" fan-out, and a future consumer adds a field to the deps object instead of a sixth positional parameter. Body and side-effect order are unchanged (prompt close, then `dropCapturesForTab`, then the guarded `tabInactive` call). All five call sites in `register-tab-ipc.js` and the one in `src/main/html-fullscreen.js` (`require` and call) pass `{ vaultHuman: ..., tabInactive: revealTabInactive }`. The export is renamed. The name is mentioned in comments, `CLAUDE.md` (three paragraphs) and `docs/vault.md`, all updated. Pins re-targeted: `test/unit/reveal-gate-stranding-wiring.test.js` (call-site regexes now match `tabInactive: revealTabInactive }`; two neuter mutations re-targeted; the direct test passes the object), name-only changes in `test/unit/save-prompt-close-effects.test.js` and `test/unit/vault-human-context.test.js`.

## Verification
The function is renamed for what it does and takes its collaborators as one object; the wiring pins are re-targeted with `assertMutated`; no behaviour change (the save-prompt, picker-context and reveal-gate tests pass unmodified in their assertions).

Ran: the three touched test files (22 pass, 0 fail); `npm test` (7450 pass, 0 fail; one earlier run showed 1 unrelated failure that did not reproduce on two reruns); `npm run lint` and `npm run typecheck` clean; `npm run format:check` clean. Neuter check: the re-targeted pins' mutations (drop `tabInactive` at the tab-close site, at the html-fullscreen site, and remove the `tabInactive?.(wcId)` call) each guard with `assertMutated` and flip `failingPins`; the test passes only because each mutation applies and fails a pin.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the tenth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The body of `onTabLeftFront` is unchanged and keeps the squawk-0100 order (save prompt close, then the picker-context drop, then `tabInactive` in its `try`); all six call sites pass both collaborators in the object; no `closeSavePromptAndDrop` remains in `src/`, `test/`, `docs/`, `scripts/` or CLAUDE.md. Neuter: dropping `tabInactive` from the `tab-hide` call site fails `reveal-gate-stranding-wiring.test.js` (2 pass, 1 fail); restored. The CLAUDE.md and `docs/vault.md` edits are rename-only. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck, format:check and `path-hygiene.test.js` clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-j`
