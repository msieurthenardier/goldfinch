# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)
**Kind**: interactive — human acceptance test. The operator performs each step; the Flight Director presents one step at a time, waits for the result, and has anything the operator finds fixed before moving on. No crew agent runs this leg on its own.

> Finalised 2026-11-15 after the flight-end review: steps 12 and 13 carry the two behaviours the fix pass changed and only unit tests have seen (the "another confirmation is open" retry; a lock-then-unlock during the dialog).

## Objective

Have the operator see and use what this flight changed and automation could not observe — above all the upgrade of a real vault, the confirmation dialog, and the Electron 45 runtime by eye — and align anything that looks or behaves wrong; and walk what Flight 1 left unwalked.

## Context

- Every leg left a "not verified" list; three things recur. **Nobody but the operator types a master password**, so everything that needs an unlocked vault is here. **A native dialog cannot be seen or answered by automation**, so its appearance and an affirmative answer are here. **WSL raises no power events**, so suspend and screen lock are here or on a release checklist.
- **Order matters: the vault upgrade is walked first and on a copy.** Once a profile is unlocked on this build its vault files are version 2, and an earlier build cannot open them. The first group makes a copy of the vaults directory, proves the upgrade on a **copy of the profile**, and only then lets the real dev profile be unlocked.
- **Fix-versus-feature rule**: a look-and-feel fix found here is made inline by a Developer and re-checked; a request that adds behaviour gets a scoped design review first; a fix spanning more than one surface gets a light design-review pass before it is built. The Flight Director says out loud which it is.
- **Contracts the specs depend on** (flight DD9) — changing any is a spec re-author, not an inline fix: the refusal shapes of the gated calls (`refused: 'not-confirmed'`), the trace lines (`[reveal-gate] …`, `[vault-gesture] …`, `[vault-power-lock] …`), the bridge method names the specs call, `enumerateWindows()` fields, the fill icon's `data-goldfinch-vault-lock` attribute.
- **Not in this walk, by operator ruling in Flight 1**: the Windows / macOS internet-origin-mark check (release checklist).

## Setup (the Flight Director gives exact commands at the start of each group)

- The dev build from the flight branch. A copy of the operator's dev profile made by the Flight Director's command, and a copy of its vaults directory kept aside as the way back.
- For the confirmation-dialog group: the app launched in dev mode with the admin flag and an admin client attached by a small script the Flight Director starts and stops — the operator does the clicking.
- Loopback test pages from `tests/behavior/fixtures/` as each step needs; the Flight Director starts the servers.
- Group 2 onwards uses a **second window** at least once — state the operator is not looking at.

## Steps

Each step is one thing to do and one thing to look for. The operator answers pass, fail, or "looks wrong because…". Groups can be done in separate sittings; groups 1 and 2 matter most.

### Group 1 — The vault upgrade (the hard-to-reverse step)

1. **The way back.** Run the Flight Director's command to copy your dev profile's vaults directory aside. *Look for:* the copy exists and lists your vault files.
2. **A copy first.** Launch the build against a **copy** of the profile. Unlock with your master password. *Look for:* it unlocks in about the usual time; the vault page lists every vault and the item counts you expect.
3. **Everything is there.** Open one login, one card, one identity, and an item with a one-time code, in at least two vaults. *Look for:* fields are right; the code shows and changes.
4. **Fill still works.** On the login test page, click a field's lock icon with the pointer and fill a login. *Look for:* it fills. (This is also `vault-gesture-trust` step 6b: a physical click raises the picker; an automation click no longer does.)
5. **Lock, unlock again.** Lock from the toolbar; unlock. *Look for:* same contents. The Flight Director confirms from the copy's files that every vault file is now version 2 and that the second unlock rewrote nothing.
6. **Access key and automation**, if you use them: an automation client with its existing access key still lists the logins it should.
7. **Export and restore round trip** on the copy: export a profile bundle; restore it into a fresh scratch profile. *Look for:* same vaults and items.
8. **Then the real profile**: quit, launch against your real dev profile, unlock. *Look for:* same as step 2. From here your real dev vault is version 2.

### Group 2 — The confirmation dialog (admin automation attached)

9. **It appears, and reads right.** With the admin client attached, on the vault page click the eye on a password. *Look for:* a native dialog, parented to the window, naming the item, saying automation is connected and will be able to read it; **Cancel is the default button**.
10. **Cancel.** *Look for:* nothing is revealed; a short "not confirmed" line; the field stays hidden; **your clipboard is untouched** if you tried Copy.
11. **Confirm.** Click the eye again and confirm. *Look for:* the value shows. Reveal another field of the **same** item: no second dialog. Open **another** item: it asks again.
12. **One-time code.** Open an item with a code. *Look for:* one dialog; after confirming, the code keeps updating with no further dialogs; after cancelling, it says not shown and does **not** ask again when you click away and back. Then, with a dialog already open from a **second window**, open an item with a code in the first: *look for* "Another confirmation is open - try again" and, once the other dialog is gone, the widget asking by itself within a few seconds.
13. **Lock in the middle.** Raise the dialog, lock the vault from the toolbar in the other window, then answer the dialog. *Look for:* nothing is revealed. Unlock and reveal the same item: it asks again. Repeat, but this time lock **and unlock again** before answering the dialog: *look for* nothing revealed by that answer either.
14. **Cookie value, key minting, export.** On the jars page click a cookie's eye; on the automation page generate a jar key; on the vault page start an export. *Look for:* each asks; each cancel does nothing; each confirm works. In the export-before-delete offer, a cancelled export neither deletes nor blocks you from deleting.
15. **Leaving it open.** Raise a dialog and do nothing for a minute. *Look for:* it closes by itself and the action did not happen.
16. **No automation, no dialog.** The Flight Director detaches the admin client and restarts the app (or ten minutes pass). *Look for:* reveals work as they always did, with no dialog.
17. **Wording.** Read the dialog's two lines and the "not confirmed" lines once more as a set. Reword anything that reads wrong.

### Group 3 — Lock, clipboard, quit

18. **Copy clears.** Copy a password from the vault page. Wait 25 seconds, paste somewhere. *Look for:* nothing pastes (on WSL, paste in a **Linux** window; the Windows clipboard may keep it — a stated limit; say what you see).
19. **The control.** Copy a password, then copy any other text, wait 25 seconds. *Look for:* the other text is still there.
20. **Key cards.** On a recovery-key or access-key display card, use Copy; wait 25 seconds. *Look for:* cleared, as in step 18.
21. **Quit with a secret on the clipboard.** Copy a password and quit within ten seconds. *Look for:* what a Linux window pastes afterwards, and what Windows pastes — report both; the docs state the limit and this is the measurement of it by eye.
22. **A code does not hold the vault open.** Set auto-lock to its shortest setting; open an item with a one-time code and leave it. *Look for:* the vault locks on schedule.
23. **Quit locks.** Unlock, quit, relaunch. *Look for:* locked at start (as always), and nothing odd at quit with a vault sheet open in a second window.
24. **Suspend**, only if you can run this build on a machine that sleeps: unlock, sleep, wake. *Look for:* locked. Otherwise this is recorded as not walked and added to the release checklist.

### Group 4 — Automation's own input, port, permissions

25. **Your shortcut after automation's keys** (`jar-key-shortcut-containment` step 12): the Flight Director has a jar-key script type into a tab; right after, press Ctrl+T yourself. *Look for:* a new tab.
26. **Port note.** The Flight Director occupies the automation port and launches. *Look for:* the toolbar indicator's tooltip and the automation page both say the port moved; re-binding from the page clears it.
27. **Internal pages.** Settings, downloads, jars, vault, automation: open each and do one ordinary thing. *Look for:* nothing asks for or is refused a permission you can notice; Copy on the automation page still copies.

### Group 5 — Electron 45 by eye

28. Browse a few real sites for a few minutes in two jars: scrolling, video, a form. *Look for:* anything that renders or behaves differently from before.
29. Every kind of sheet once: kebab, page context menu, tab context menu, bookmark edit, address suggestions, site info, downloads popup, find bar. *Look for:* placement, focus, dismissal.
30. A PDF in a tab; a popup window from a site; fullscreen video and Escape; print preview; zoom.
31. HTTP sign-in card (`web-compat` basic-auth page): **Escape dismisses it** (automation cannot press it — squawk 0185); a client-certificate picker if you have a certificate.
32. Tear a tab off and back; a second window; close windows in different orders; quit.
33. Kill a tab's process (the Flight Director supplies the command): the crash panel; reload.

### Group 6 — Flight 1's unwalked steps

34. Flight 1 HAT groups 2–6 and group 1 step 11, as written in `missions/23-security-review-remediation/flights/01-page-containment/legs/09-hat-and-alignment.md`, presented step by step. Step 11 (a copied card asks again) and the card / identity confirmation now run on a version-2 vault.

### Group 7 — Operator-attended spec steps

35. `admin-reach-refusal` steps 5, 10 and 11, and `vault-copy-item`'s attended halves, run by the Flight Director's Executor with the operator unlocking the vault and answering dialogs as the steps say. Recorded in those specs' run logs, not here.

## Acceptance Criteria

- [ ] Group 1 walked in full **before** the real profile is unlocked on this build; any failure stops the walk and goes back to design (the flight's Divert rule).
- [ ] Group 2 walked in full; every failure fixed and re-walked, or accepted by the operator with the acceptance recorded.
- [ ] Groups 3–7 walked to the extent the operator chooses; anything not walked is listed in the flight log as not verified by eye, and suspend / screen-lock, if not walked, is added to `docs/RELEASING.md`'s checklist.
- [ ] Every fix made during the walk is classified out loud (fix / feature / multi-surface), goes through a Developer, and has its unit tests and the affected behavior spec re-run.
- [ ] The flight log's entry for this leg records each step's outcome in the operator's words where they said something.

## Edge Cases

- **If the upgrade on the copy fails or loses anything** (group 1): stop. The real profile is not unlocked on this build. The copy and its vaults directory are kept as evidence.
- **If the dialog cannot be seen, or sits behind the window**, on this display: stop group 2; that is the gate's premise and goes back to design.
- The operator's display scale and whether the session is WSLg are recorded with step 9.
- No agent types a master password or answers a dialog at any step.

## Post-Completion Checklist

- [ ] Leg status `completed` when the operator says the walk is done; artifacts and any fixes committed on the flight branch.
