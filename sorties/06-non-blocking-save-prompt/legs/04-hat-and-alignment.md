# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Non-blocking Save Prompt](../flight.md)

## Objective
The operator watches the rendered prompt through every live behavior that unit tests cannot see (the native-surface rule). This covers every check deferred from Legs 1-3 by the 2026-11-04 operator ruling.

## Context
- Interactive leg: the Flight Director guides one step at a time. Look-and-feel FIXES ride inline; anything that adds behavior is a FEATURE, which goes to a scoped design review first. If a fix spans more than one surface, a Developer design review comes before the implementing spawn.
- Apparatus: a throwaway profile seeded with `tests/behavior/fixtures/vault-login/build-fixtures.mjs`. The fixture is served on 127.0.0.1:8099, and the app is launched with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_VAULT_TRACE=1 npm run dev:automation -- --user-data-dir=<dir>`. The FD drives submits through a `connectAutomation()` env-key script and reads the census (`savePromptVisible`, `savePromptPaused`, `sheetVisible`); the operator watches and drives the keyboard and mouse.
- The vault idle-locks quickly in this profile. A locked run is expected whenever it does.

## Acceptance Criteria (verification steps, one at a time)
- [x] H1 **Unlocked submit**: the prompt appears top-right under the key icon, matching the mockup. The page stays clickable and typeable underneath it. It times out at about 10 s. No flicker appears on show or hide.
- [x] H2 **Hover pause (P1)**: with the pointer on the card, the bar freezes and dims and `savePromptPaused` is true. Moving off resumes it, and it times out after the remaining time.
- [x] H3 **Save (unlocked)**: Save → "Password saved to {vault}" in the corner → it closes. The item is in the vault. A second submit with the same credentials raises no offer, or "Already saved".
- [x] H4 **Not now / ✕**: closes the prompt immediately, with no save.
- [x] H5 **Tab switch drops it, with no flicker**: switching to another tab and back does not re-show the prompt.
- [x] H6 **Locked submit (Variant B)**: the corner prompt appears with "Unlock & save" and the lock note. No unlock sheet is auto-raised (`sheetVisible` false).
- [x] H7 **Unlock & save**: the unlock sheet opens. After typing the master password, "Password saved to {vault}" appears in the corner. The item is saved.
- [x] H8 **Slow unlock (A7)**: Unlock & save, then wait more than 2 min, then unlock → "This save request expired" appears in the corner. It is never silent.
- [x] H9 **Unlock by another route**: with a locked prompt showing, unlock from the vault indicator (or in a second window). The prompt converts to an unlocked "Save" offer.
- [x] H10 **Keyboard**:
  - F6 from the page → focus ring on the primary button, and the timer pauses;
  - Tab cycles inside;
  - F6 → address bar;
  - repeat, then Shift+F6 → page;
  - Esc → closes, and focus is back in the page (typing goes to the page).
- [x] H11 **Find bar and fullscreen**: with the find bar open, the prompt stacks below it (Leg 1 A1: a find bar opened AFTER the prompt overlaps it; judge whether that is acceptable). HTML fullscreen drops the prompt.
- [x] H12 **Anchor freshness**: unpin the vault icon, change chrome zoom, and resize the window while a prompt shows. The prompt stays sensibly placed.
- [x] H13 **Screen reader (P3)**: no screen reader is available, so this stays **unverified** and is recorded in the debrief.

## Post-Completion Checklist
Completion steps are Flight Control protocol; they are not repeated here.

## HAT Progress (2026-11-05, session 1 — paused for operator meeting before H12)
- H1–H11 PASS (operator by-eye + census/trace from the FD's env-key scripts).
- H2: the bar also holds while the WINDOW is unfocused (window-blur pause input, by design); operator confirmed hover freeze/resume.
- H3: "Password saved to {vault}" shown; same-credential resubmit raised no offer (gesture-hold, no open).
- H6/H7: locked offer with no auto-sheet; consent `granted` → finalize `saved` → confirmation in the corner.
- H8 (A7 live): unlock at ~191 s → corner showed the expired notice; no finalize write.
- H9: unlock from the key icon converted the offer in place (finalize `offer:save`); Save completed.
- H10: F6 needs **Fn** on the operator's keyboard (first attempt pressed bare F6). With Fn+F6: page→prompt (timer pauses), Tab cycles, F6→address bar, Shift+F6→page, Esc closes with page focus restored; typing reached `#probe`.
- H11: **A1 ACCEPTED by operator** ("edge case and is recoverable") — a find bar opened after the prompt covers its title and ✕ (Not now/Save stay reachable). The find-first ordering is unreachable with a navigating login (navigation closes the find bar before settle). HTML fullscreen drops the prompt and it does not return.
- Out-of-scope defects found (to file as squawks at HAT end): (1) WSLg: HTML fullscreen renders the page top-left with black bands, and on exit the page + chrome stay shifted right until relaunch — reproduced on a control page with no prompt ever shown; the operator's installed Windows build does not show it. (2) Windows installed build: Esc does not exit HTML fullscreen (F11 needed).
- Remaining: H12 (anchor freshness: unpin key icon, chrome zoom, resize), H13 (record P3 unverified).

## HAT Progress (2026-11-05, session 2 — complete)
- H12 PASS for window resize (prompt stays anchored top-right under the key icon) and page zoom (Ctrl+= to 200%: page scales, prompt unchanged). **Leg-design gap (FD)**: the "unpin the vault icon" sub-step was unreachable — the vault indicator is not pinnable (`toolbarPins` is media/shields/devtools only) and every pinnable button sits LEFT of it, so no operator action moves the anchor while a prompt shows. "Chrome zoom" is likewise not operator-reachable on this build (zoom actions target the tab). Both stay covered by unit tests only (A2). Carry to debrief: the project rule "check every AC against the primitive's actual signature at design review" was missed for this HAT step.
- H13 **UNVERIFIED** (no screen reader): P3 announcement wording/double-speak risk carried to the debrief.
- Squawks filed (deferred): 0170 (Windows: Esc does not exit HTML fullscreen), 0171 (WSLg: HTML fullscreen mis-render + shifted layout on exit).
