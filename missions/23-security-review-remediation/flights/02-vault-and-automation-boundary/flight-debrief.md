# Flight Debrief: Vault and Automation Boundary

**Date**: 2026-11-15
**Flight**: [Vault and Automation Boundary](flight.md)
**Status**: landed
**Duration**: 2026-11-14 (planned and started) – 2026-11-15 (landed)
**Legs Completed**: 13 of 13 (planned as 7; six added by splits at leg design)
**Plugin version**: mission-control 1.2.3 (1.2.4 was available throughout and not installed)

Committed locally on `flight/02-vault-and-automation-boundary` as `0d80b00` (twelve legs) and `42e179c` (the walk's fix and record). **Not pushed, by operator ruling**: the repository is public and the mission's artifacts describe release-side findings Flight 3 has not yet fixed.

Inputs to this debrief: the flight log; a Developer interview (which ran the suite and measured the footprint, and says it did **not** read the flight plan, the leg specs or most of the log, so its view of leg accuracy is thin); an Architect interview (which worked from the flight spec and the log and says it did **not** read the legs, the mission, the recon or most of the new modules' source); six Reviewer reports across the flight-end review and the walk's fix; and the operator's rulings and walk answers, recorded verbatim in the log. No separate human interview was held.

## Outcome Assessment

### Objectives Achieved

- **Electron 44.10.0 → 45.3.2**, first and alone. Gates and store suites identical on both runtimes; four of six behavior specs pass in full on 45, two in reduced form.
- **An admin automation key can no longer read a vault secret or a cookie value, export a vault, or mint a key without a person confirming.** A main-side gate asks through a native dialog no automation tier can see or answer, per item, only while an admin session has been active in the last ten minutes or script it left behind is still alive in the page. Measured before the change: admin script read a cookie's value and minted a key. After: refused, behavior-tested four times (`admin-reach-refusal`), and exercised by hand by the operator — reveal, cookie value, mint and export each denied once and confirmed once.
- **The launch flag is the only door to the admin tier.** Measured before: a key hash stored under the map name `admin` through the settings call reached the admin tier on a later launch with no flag. After: the settings call cannot write a key hash, and no reserved name is ever treated as an identity.
- **Automation's input is not the operator's.** Measured before: an automation click raised the vault picker, and a jar-scoped key's `pressKey` drove nearly every browser shortcut — including Ctrl+Q, which quit the app. After: neither; behavior-tested (`jar-key-shortcut-containment`, `vault-gesture-trust`).
- **Shared limits are bounded**: a per-key session cap with eviction of that key's own stalest session; audit fields clipped; the moved-port note; the internal session denies every permission (measured before: internal pages were granted notifications, location, camera and microphone by Electron's default); `window-management` no longer granted.
- **The vault locks when the machine does and at quit**; a one-time-code display no longer holds it open. (It was not locked at quit before — see below.)
- **Copied secrets leave the clipboard.** The existing 20-second clear had never fired in any release: it compared a promise with a string.
- **Vault and profile files are owner-only.**
- **A vault file is bound to its vault.** Version 2 of the file format; a file placed in another vault's slot is refused at every reader; version-1 files and bundles keep opening; existing files are converted in one verified, journalled transaction at the first master-key unlock. **The operator's real dev profile was upgraded at the walk**: four files converted in one second, the manager byte-identical, an access key carried, a later unlock rewriting nothing.
- **A master re-wrap never uses key-derivation parameters weaker than the default.**

### Not achieved, or achieved less than planned

- **By-eye coverage is partial.** The operator walked groups 1 (the vault upgrade) and 2 (the confirmation dialog) and stopped. Not walked: clipboard clearing and the quit lock; the operator's own shortcut after a jar key's input; the port note; Electron 45 by eye; Flight 1's unwalked groups 2–6; the vault-dependent spec steps as witnessed runs. Six by-eye checks were added to `docs/RELEASING.md`; nobody is yet assigned to walk them.
- **`admin-reach-refusal` has never passed in full.** Four runs, each "partial" for the same reason: export, reveal and the code read need a vault the operator unlocked. They have live evidence from the operator's own hands at the walk, not from a witnessed run.
- **Two specs are reduced.** On Electron 45 the Flight 1 probe page no longer obtains the guest preload's IPC object, so the page-sent refusal steps of `guest-ipc-refusal` and `vault-gesture-trust` cannot be exercised (operator ruling: accept and re-author; the route is not proven closed).
- **One rule of the walk's fix is unverified live.** "Real input reaching the window cancels a pending confirmation" cannot fire while the desktop holds the window, which it did on every later attempt.
- **One-time codes under the gate were not walked** — the operator has no working one-time-code item ("i have never successfully used a one time pass").
- **Not verifiable on this host**: lock on suspend and screen lock; everything on Windows and macOS (the dialog, `setIgnoreMenuShortcuts`, file modes, the clipboard).
- **Stated limits, by design**: a kept old version-1 copy of one vault can still be placed in another vault's slot and will be opened and upgraded there; an earlier build cannot open an upgraded vault or a bundle from one; revoking an access key or changing the master password does not re-key; on WSL the Windows clipboard may keep a secret after quit; on Linux locking the screen does not lock the vault.

### Mission Criteria Advanced

- *No automation tier reads vault plaintext or cookie values* (findings 5, 11, 17) — met in mechanism and behavior-tested for what can run unattended; tier documentation written.
- *A vault file tampered with on disk is detected* (findings 12, 13, 21) — met for the cross-vault swap and the key-derivation downgrade; lock on suspend built, unverified by eye; clipboard fixed; file modes done; re-keying accepted with a written reason.
- *No key-holder input can exhaust a shared limit* (finding 16, automation half) — met.
- Guard-audit NF2, NF5, NF11 fixed; P4 measured (already denied); NF6 measured and logged (squawk 0187).
- Finding 3, in part: the runtime is current. The update notification is Flight 3.

## What Went Well

- **Measuring first, in the leg that uses the answer.** Three legs opened with a measurement on the untouched tree, and each changed the work: jar-key shortcuts were far broader than the review's low-severity note (Ctrl+Q quit the app through a path Goldfinch's own key handler never sees); the session mechanism was replaced after reading and then measuring what the MCP client does on a 404; the clipboard measurement found the existing clear had never worked.
- **The bump first and alone.** The one runtime difference — the lost probe route — surfaced with nothing built on top of it, and was put to the operator as a clean question.
- **The vault format work ordered so the irreversible step was last and alone**: a rule change with no format change; plumbing that wrote the old format; the new format for new files and every bundle path together; then the conversion of existing files. Each stage left a safe state.
- **Evidence that does not share the code under test.** A version-1 oracle built on raw crypto; profiles and bundles written by the released commit's own store; one operator-approved known-answer vector. Three injected faults were each caught by the verification meant to catch them — a wrong vault id passed the in-memory check and was rejected on the staged bytes.
- **Design reviews by a reader of the code, before code.** They found: a hard id check could lock out a hand-moved vault file; restore would have decrypted with the wrong id for single-vault bundles; a profile export under the new format would have been silently unopenable unless the bundle paths landed with the switch; the code widget would re-prompt forever after a denial; a refused Copy would have emptied the operator's clipboard; `allowInternal` is not the tier; concurrent initialisations could pass the session cap.
- **Reviewers who knew nothing of the Developers' reasoning.** Three scoped slices at flight end found the one blocking defect; a fresh reviewer confirmed the fix pass; two more reviewed the walk's fix and one found its key handling written against the wrong event.
- **Independent gate runs** by the Flight Director at each landing point.
- **The operator's walk found what nothing else could**: a dialog that vanished and left its window dead.
- **Reporting corrections in the open**: the "menu shortcuts never restored" alarm retracted after a bisect showed the test, not the product, was at fault; the 63-second wait traced to the host's wall clock rather than argued away.

## What Could Be Improved

### Process

- **Seven planned legs flew as thirteen, and four of the six splits were visible in the flight's own text.** DD5 and DD8 shared no source file; DD7 was three bullets the spec itself called independent; DD6 listed four dependent stages; DD3 was "a few lines" beside DD2. The spec applied "one leg per decision cluster" to the automation work and nowhere else. Cost: each oversized leg was designed, reviewed, cut, and its other half written afresh.
- **Two premises were simply false and one lesson was not carried.** "The vault is locked at quit" rested on a comment describing a hook that was never wired. "An unknown session id gets the wrong status" was not checked against the handler, which already answered correctly. And Flight 1's review had found a `===` guard on an IPC value that the store then coerced; leg `admin-key-name`'s criteria said "for any key spelling" without saying "including a non-string", and the same defect shipped to the flight-end review.
- **Four behavior specs were authored wrong by the Flight Director and corrected only by running them.** A popup left open made an admin Ctrl+Q appear dead (read at first as a product regression and reported to the operator as one); the same popup made the jar Ctrl+Q step prove nothing; a settings-write step could not have detected a replaced key; a walk step predicted a blocking dialog would close on a click.
- **A crew probe overwrote the operator's clipboard.** The brief said save and restore; it did not say never restore over a clipboard that has changed since. The Developer noticed and put the newer text back, possibly without its line breaks.
- **A tool safety check stopped an Executor's cleanup mid-run**, leaving an app and a server up. The cause was a compound delete with a command substitution, which the spec's own teardown wording invited. Later briefs forbade the form; sixteen scratch profiles were still left behind by one Developer.
- **Briefs grew long again.** Flight 1's debrief said shorter briefs would be read in full. Implementation briefs in this flight carried ten to fifteen hard rules each. Both debrief interviewees again skipped most of their reading and said so.
- **Every leg was tiered high.** Twelve design reviews. Each found something, so none was wasted — but nothing was ever judged low, which says the tiering question was not really being asked.
- **The walk covered two of seven groups.** The two that mattered most; the rest moved to a release checklist with no owner.
- **Behavior runs were batched throughout** (one Executor pass, a separately spawned Validator from files). Affordable — twenty-odd runs — but a Validator that cannot re-observe returned "inconclusive" where a live one would have looked again, and one Executor delivered an index where a report was asked for.

### Technical

- **Suite**: 7,117 tests, 7,113 pass, 0 fail, 4 todo (the same four unsolved capture cases), no flake on one run. Runner 7.9 s, wall 8.1 s. Against Flight 1 (6,780 tests, 9.4 s): +337 tests and about 1.5 s **faster** — taken as host variance, not investigated; the added tests are fast. Heaviest suites alone: `vault-compromise-rotate` 2.5 s, `vault-txn` 2.0 s, `vault-context` 1.8 s, the new `vault-upgrade` 1.6 s, `automation-mcp-server` 1.2 s. The vault suites together went from 5.1 s to about 9 s over the format legs.
- **Footprint** (`376e541..HEAD`): 172 files, +15,796 / −618. `src/` 54 files +3,474 / −440; `test/` 58 files +8,535 / −108; 11 new source modules; 19 new test files, of which about 12 are behaviour tests, 4 mostly source-scan pins and 3 mixed — a better balance than Flight 1's.
- **Large files grew and none was split**: `vault-store.js` 4,597 lines; `main.js` 3,176; `mcp-server.js` 1,512. `renderer.js` is still 1,504 of 1,505.
- **The reveal gate has four cooperating pieces of state** — admin recency, the scripted-document mark, per-item grants with a lock epoch, the per-window slot with three cancel rules — in 509 lines. The Architect's reading: the right decomposition, contained, but accreting; the three cancel rules are a stack around a primitive whose behaviour the app does not control.
- **The confirmation is a native dialog whose hold on its window the desktop may not enforce.** It was chosen because automation cannot observe or click it, and that still holds. Its costs are now known: no visible default button on Linux; a window that stranded once; a rule that cannot be shown live; nothing a spec can see.
- **Per-tab `input-event` now has three consumers** (the vault click witness, injected-input bookkeeping by way of the handlers, the gate's cancel rule) with separate listeners and filters. And `closeSavePromptAndDrop` took a fifth parameter: it has become the general "this tab stopped being in front" hook under a name that says otherwise.
- **A test fake hid a real defect for the life of a feature.** The clipboard fake answered synchronously; Electron's does not. The same shape is possible wherever a fake stands in for an Electron API.
- **Carried, open**: `exportProfile` fails whole on one unreadable vault; compromise rotation's loop aborts on the first corrupt file; a leftover journal at unlock costs a second unlock before the upgrade runs; `automation-mcp-server.test.js` is order-sensitive (0188); the validator's memory bound is looser than scrypt's (0189); a page can open unbounded popups or tabs (0187).

### Documentation

- CLAUDE.md gained the gate, the format rules and the quit order, but has no short table of **what the gate does when** — four conditions, seven decisions, several accepted behaviours — and no standing planning rule for the two things this flight learned twice (below).
- `docs/mcp-automation.md` should state the gate's residuals in one place: the ten-minute window; that an admin session quiet for longer is covered only by the scripted mark; that a value already on screen is readable by automation that attaches later.
- The release checklist in `docs/RELEASING.md` now holds seven by-eye items from two flights and names nobody to walk them.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
| --- | --- | --- |
| 7 planned legs flew as 13 | Legs held more than one decision; split at each design review | Yes — draw the list from a decision-to-files table (below) |
| DD5's idle timeout replaced by a per-key cap with eviction and a recency window | The client cannot recover from an expired session; read from its source, then measured | Yes — read what the other end does before choosing a lifecycle |
| DD6's two vault legs became four | An export under the new format would be silently unopenable unless bundles landed with the switch; the conversion has no dependents | Yes — order irreversible steps last and alone |
| The plaintext id check logs instead of refusing for version-1 files | Two reviewers disagreed; ruled for no lock-out | Case by case; when reviewers disagree on a data-loss question, take the cautious reading |
| One committed known-answer vector | Operator ruling against the no-committed-baselines rule, for the one thing only real old bytes can prove | Only by explicit ruling |
| Three rules added to the gate at the walk | A dialog stranded its window once | The rules, yes; the primitive needs a decision (below) |
| Two specs reduced, one never fully run | The probe route is gone on Electron 45; no agent unlocks a vault | Record reduced runs as such; never as a pass |
| The walk on the operator's real profile, no copy first | Operator's choice | No — the leg's order stands for a release |
| All behavior runs batched | Cost | For re-runs; say so in each log |
| Branch kept local | Public repository | Yes, until Flight 3 lands |

## Key Learnings

1. **A claim about what the code already does needs a call site, not a comment.** Both false premises would have fallen to "show me the line that does it". This applies to every cell of a platform-check table — "already provided" and "residual" alike.
2. **One leg per design decision unless two decisions share a file.** The flight knew this, applied it to one cluster, and paid for the rest.
3. **A lesson that lives only in a debrief does not reach the next leg's criteria.** The `===`-then-coerce defect was found, written down, and built again within three days. Lessons of that kind belong in CLAUDE.md's standing planning rules, where leg design reads them.
4. **Measure the platform before designing on it** — and before believing a test double. The promise-returning clipboard, the application menu's accelerators, the wall clock that steps, the dialog's modality: none was knowable from the code.
5. **A spec is code and is wrong at about the same rate.** Four of this flight's specs had a design error that only a run exposed; one of them produced a false alarm to the operator. A first run of a new spec is a test of the spec.
6. **Anything a crew run touches outside its scratch directory is the operator's.** The clipboard is shared with the host; the downloads folder was last flight's version of the same lesson.
7. **When the irreversible step is isolated, it is boring.** The upgrade of a real profile was the least eventful part of the walk.
8. **A security control that depends on the desktop behaving needs a fallback that does not.** The dialog is unanswerable by automation on every desktop; whether it holds its window is not the app's to decide.

## Methodology Observations

Recorded, not judged. Installed plugin: mission-control 1.2.3.

- **flight skill, leg identification.** Guidance: "default to few, large legs; add a boundary only where a mid-flight human decision or a risky, hard-to-reverse step needs its own checkpoint". The flight drew seven legs that way; six more were cut at leg design, each along a seam between design decisions with disjoint source files. Flight 1 recorded the same observation (seven legs flown as nine). Expected: a step that tabulates each design decision against the files it touches. Cost: six legs designed twice in part; six extra design-review spawns.
- **flight skill, Phase 1b / Phase 2 (reconnaissance, code interrogation).** The recon classified source findings as live or satisfied with citations, as the skill asks. It did not test the flight's own claims about *existing* behaviour used as premises ("the quit hook locks the vault", "an unknown session gets a 400"). Both were false; both were caught at leg design review. Expected: the citation requirement extended to every "already does X" a design decision rests on. Cost: one leg re-scoped (a quit lock built, not wired); one acceptance criterion rewritten.
- **agentic-workflow, Phase 2a risk tiering.** All twelve autonomous legs were tiered high ("security-sensitive surface" applies to every leg of a security mission). The tier therefore selected nothing. Each review did find real issues. Recorded so a sweep can see whether a mission whose every leg meets a high-risk criterion is common.
- **agentic-workflow, Phase 2a ("Max 2 design review cycles", "Re-review if substantive changes were made").** Every leg took one cycle and the Flight Director skipped the second pass each time, reasoning that the changes were the reviewer's own corrections or a scope reduction. No leg was later found wrong for want of a second pass. The skill's wording would have required about ten more spawns.
- **agentic-workflow, Phase 2d.** One Reviewer over all uncommitted changes; the flight used three scoped Reviewers (about 164 files), then one for the fix pass. Same deviation and same reason as Flight 1.
- **agentic-workflow, Phase 2b, interactive legs.** The skill has the Flight Director guide the human one step at a time and fix issues inline. It worked. Two things it does not cover came up: the operator declining setup steps the leg marked as prerequisites (the copy-first sequence), and stopping partway — the leg's own criterion ("anything not walked is listed") handled the second; nothing handled the first except the Flight Director's judgement to proceed and keep a quiet copy.
- **behavior-test skill, run modes.** Every run was batched: one Executor pass, then a Validator spawned on the files. The skill describes live and re-spawn-per-checkpoint only. Recorded in every run log. Twenty-odd runs at about two spawns each; per-checkpoint would have been several hundred. One Executor returned an index for a report.
- **behavior-test skill, Phase 5 teardown and AUTHORING guidance.** A spec's teardown written as one compound shell line (quit, kill, delete by command substitution) was refused by the harness's safety check mid-run, leaving processes up. Nothing in the authoring guide speaks to how teardown should be written. Cost: one manual cleanup by the Flight Director; a squawk (0186).
- **behavior-test skill, AUTHORING (premise audit on both axes).** The guide asks whether the apparatus can act and observe. Four specs here failed on a third question it does not ask — whether an earlier step leaves state that makes a later step vacuous or misleading (an open popup; a jar that already had a key). Cost: one false alarm to the operator, two extra runs of one spec, one inconclusive clause.
- **flight-debrief skill, Phase 2.** As in Flight 1, both interviewees declared they had skipped most of the reading the brief required — this time with shorter briefs than last. The Developer read no leg and little of the log; the Architect read no leg and little source. Their input was still useful where they had looked.
- **flight-debrief skill, Phase 1 step 3.** "Determine whether the flight's PR has merged." There is no PR: the branch is local by operator ruling. The debrief was written on the flight branch.
- **Plugin update notice.** 1.2.4 announced at every session start; not installed, as the methodology directs for a Flight Director. The whole flight ran on 1.2.3.

## Recommendations

1. **Add two standing planning rules to CLAUDE.md before Flight 3 is designed.** (a) *A refusal that compares an IPC-supplied value must reject a non-string before comparing, and its tests send an array and an object through the real store.* (b) *Every claim that existing code already does something — in a design decision, a platform check, or a leg's context — cites the call site that does it.*
2. **Draw Flight 3's leg list from a table of design decisions against the files each touches**: one leg per decision unless files overlap; irreversible steps (anything that changes stored data or the release pipeline) last and alone; and tier honestly — a leg that only adds a doc and a pin is not high.
3. **Decide the confirmation's primitive before anything else depends on it.** One spike: can a dedicated sheet card, refused to every automation operation at the allowlist level, give the same "automation cannot see or click it" with modality the app controls? Until then keep the native dialog, and record "the desktop may not enforce a dialog's hold on its window" as a platform fact in CLAUDE.md.
4. **Give the release checklist an owner and walk it before the first release that carries Mission 23.** Seven by-eye items across two flights, several of which can only be seen on Windows or macOS. A checklist nobody walks is where "accepted by eye" turns into "never looked at".
5. **Treat every Electron API fake as a claim to verify.** A short audit of the test fakes for promise-returning or event-shaped Electron APIs (clipboard, dialog, `input-event`, power events) against the typings — this flight found two mismatches by accident.
6. **Plan the split of `vault-store.js` and the extraction from `main.js`** as their own maintenance work, not inside a feature flight.
7. **For behavior specs: run a new spec once as a test of the spec before it gates anything**, and write teardown as separate commands with literal paths.

## Action Items

**Squawks from this flight** (all open, routine unless noted):

- [ ] [0185](../../../../squawks/0185-basic-auth-spec-escape-step-not-marked-by-eye.md) — the basic-auth spec's Escape step is operator-only and unmarked
- [ ] [0186](../../../../squawks/0186-cookie-isolation-spec-teardown-and-evidence.md) — cookie-isolation spec teardown form and unsaved evidence
- [ ] [0187](../../../../squawks/0187-uncapped-script-opened-popups-and-tabs.md) — a page can open unbounded popups or tabs (fails the squawk gate: needs a sortie)
- [ ] [0188](../../../../squawks/0188-mcp-server-test-order-sensitive.md) — `automation-mcp-server.test.js` is order-sensitive
- [ ] [0189](../../../../squawks/0189-kdf-validator-memory-bound-too-loose.md) — the key-derivation validator accepts a memory limit scrypt rejects

**Logged at this debrief** (operator: "Log all five"):

- [ ] [0190](../../../../squawks/0190-profile-export-fails-whole-on-one-unreadable-vault.md) — a profile export fails entirely when one vault is unreadable
- [ ] [0191](../../../../squawks/0191-compromise-rotation-aborts-on-first-corrupt-vault.md) — compromise rotation aborts on the first corrupt vault file
- [ ] [0192](../../../../squawks/0192-leftover-journal-delays-vault-upgrade-one-unlock.md) — a leftover journal delays the vault upgrade by one unlock
- [ ] [0193](../../../../squawks/0193-close-save-prompt-and-drop-is-misnamed.md) — `closeSavePromptAndDrop` is the general tab-left-the-front hook under a misleading name
- [ ] [0194](../../../../squawks/0194-admin-reach-refusal-spec-poller-and-tolerance.md) — `admin-reach-refusal`: step 6's poller and step 8's tolerance

**Not logged** (operator: skip for now): one-time codes — the operator has never used them successfully; to be raised when they describe what goes wrong.

**Need a design call** (sortie or Flight 3):

- [ ] The confirmation's primitive (recommendation 3)
- [ ] Popup and tab burst limits (0187)
- [ ] From Flight 1, still open: keyboard and touch activation of the fill icon; a control to forget a card's confirmed sites; trust display for long subdomains and http versus https on the sign-in card; restyling the native fill-icon menu

**Open verification:**

- [ ] Walk groups 3–7 of this flight, and Flight 1's groups 2–6
- [ ] `docs/RELEASING.md`: the six by-eye checks from this flight and the internet-origin-mark check from Flight 1 — an owner, and a walk on Windows and macOS
- [ ] `admin-reach-refusal` steps 5, 10, 11 and `vault-copy-item`'s attended halves, as witnessed runs with the operator present
- [ ] Rule 3 of the walk's fix (real input cancels a stranded confirmation) on a desktop that lets a click through

**Operator decisions pending:**

- [x] Whether to mark this flight `completed` — yes (operator, 2026-11-15)
- [ ] When and how to publish this branch (kept local; Flight 3's findings are described in the mission)
- [ ] Go and scope for Flight 3 — shipping and at-rest
- [ ] Whether to install mission-control 1.2.4
