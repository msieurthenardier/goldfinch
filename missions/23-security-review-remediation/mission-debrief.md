# Mission Debrief: Security Review Remediation

**Date**: 2026-11-18
**Mission**: [Security Review Remediation](mission.md)
**Status**: completed
**Duration**: 2026-11-12 (review and planning) – 2026-11-17 (Flight 3 landed); merged and released as v0.19.16 on 2026-11-18
**Flights Completed**: 3 of 3 (33 legs flown; one planned leg, `cookie-encryption`, not flown by operator ruling)
**Plugin version**: mission-control 1.2.4 for this debrief; all three flights ran on 1.2.3

Inputs: the mission, its `## Dispositions` table, the three flight debriefs, and each flight's log as summarized in its debrief (the logs were not re-read line by line). Also: an Architect interview (Sonnet, read-only; it read the Dispositions, the debriefs' Technical sections and the cited code, and said what it skipped); a fresh run of the four gates at HEAD `6ca7cee`; the release workflow's run history; `docs/RELEASING.md`'s by-eye checklist; and a short operator interview.

## Outcome Assessment

### Success Criteria Results

| # | Criterion | Status | Notes |
| --- | --- | --- | --- |
| 1 | Coverage is complete before fixes are designed | met | Flight 1 leg `probe-and-audit`: a guard audit of 35 guards and a 214-channel census finished the interrupted web-content audit; 63 of 73 `[A]` claims confirmed, the rest corrected in the leg record. The operator's go/no-go was held before Flights 2 and 3. |
| 2 | A web page cannot drive a privileged handler | met | One caller class per channel (211 rows), enforced at registration; `ipc-gate-invariant.test.js` pinned at zero exceptions. `guest-ipc-refusal` ran 9/9 on Electron 44, with the same calls recorded succeeding on the unmodified build. **Reduced on Electron 45**: the probe route no longer reaches the IPC object, so steps 4–9 cannot run. The route is not proven closed, so the main-side class remains the boundary. |
| 3 | A page cannot obtain a saved card, identity or login through a prompt it raised | met, with accepted residuals | Main witnesses the click; a fill needs a per-open context. The picker shows the destination, has nothing selected at open, arms for 500 ms and confirms per site. The operator walked it with a real pointer. Accepted by ruling: 2c (the fill payload crosses the main world), 2d (the icon box is page-supplied), 14b (a page can choose what its own save prompt offers). |
| 4 | Cookie-jar isolation on chrome-initiated requests and history writes | met | Token-addressed media proxy; the media list is validated in main; Retry goes through the owning jar; title updates are keyed by visit. `cross-jar-fetch-isolation` passes on Electron 45. |
| 5 | Saved file names cannot be reordered or disguised | met (revised wording) | Sanitizer, one gated open function. **Open check**: whether downloads carry the internet-origin mark on Windows and macOS, which the "the OS confirms" ruling relies on, has never been looked at (checklist item 1). |
| 6 | No automation tier reads vault plaintext or cookie values | met in mechanism | Reveal gate with a native confirmation; the launch flag is the only door to the admin tier; injected input is not the operator's. **`admin-reach-refusal` has never passed in full** (export, reveal and code-read need an operator-unlocked vault). The operator denied and confirmed each gated action by hand at Flight 2's walk. |
| 7 | A vault file tampered with on disk is detected | met; lock-on-suspend unobserved | Format v2 binds each file to its slot; the KDF re-wrap has a floor; the clipboard clear finally fires; files are owner-only. The operator's real profile was upgraded. Lock on suspend is built and unit-pinned but has **never been seen on real hardware**: WSL raises no power events (checklist item 2). Re-keying on revoke was accepted. |
| 8 | Trusted prompts cannot be made to say or do the attacker's thing | met per item | Realm cleaned and capped; credentials kept out of the address bar and history; certificate picker armed; history and MCP bounds in place. Accepted per item by dated rulings (arming for the sign-in card and certificate Proceed, subdomain eliding, `pushState` rate limit). |
| 9 | An operator on an old build finds out, and can verify what they install | met | Daily check, About section, kebab item and dot, Check now, Download now. Provenance attestation, tag ruleset and immutable releases are on, and the build job holds no write token. **The last open piece has now run**: stable tags `v0.19.16`, `v0.19.17` and `v0.19.18` on `main` all passed `create-release` (build workflow runs 2026-11-18, all `success`). The docs still say it has not run (squawk 0207). |
| 10 | Every finding has a disposition and the regression net is green | met | `mission.md` `## Dispositions`: 7 fixed, 15 fixed in part, every remaining part accepted with a named ruling, none open. At HEAD `6ca7cee` on 2026-11-18: `npm test` 7,323 tests, 7,319 pass, 0 fail, 4 todo (the four known-unsolved capture cases); `lint`, `typecheck` and `format:check` clean. |

### Overall Outcome

**Achieved.** Every one of the 22 findings ended fixed and pinned, or accepted with a written reason and a named decision. The headline outcomes hold in code and under test:

- A page cannot reach a privileged handler.
- A page cannot pull a card or identity through a picker it raised.
- A page cannot act through another jar.
- No automation tier reads a secret without a person.
- An old build learns it is old, and its releases can be verified.

The goal was still the right one at the end. Two things changed along the way. The operator narrowed "notify only" to allow a download the operator asks for. The "OS already does this" rulings shrank three design decisions by half or more, and nothing they removed has been missed.

What remains is **verification, not construction**. 12 of the 14 by-eye checklist items in `docs/RELEASING.md` have not been walked (operator: "unwalked; carry forward"). Two behavior specs run reduced on Electron 45, and one has never passed in full. Several Windows and macOS behaviors were seen only on build runners or not at all. Three stable releases have shipped with that list open.

## Flight Summary

| Flight | Status | Key Outcome |
| --- | --- | --- |
| 1. Page containment | completed (9 legs; planned 7) | The channel gate and standing guard; main-witnessed vault gesture and the picker's controls; token media proxy; download naming and Retry; history keyed by visit; prompt and history bounds. The DD4 premise was disproven by the opening probe and the flight diverted cleanly. |
| 2. Vault and automation boundary | completed (13 legs; planned 7) | Electron 44 to 45 first and alone; reveal gate; admin tier closed; injected input separated from the operator's; MCP session and audit bounds; vault lock on suspend and at quit; clipboard clear that works; file modes; vault format v2 with an in-place upgrade of a real profile. |
| 3. Shipping and at-rest | completed (11 of 12 legs flown, plus one added at the walk) | Update check and notice, then Download now; build/upload split with provenance; stable-tag check, tag ruleset, immutable releases; three runtime fuses; launch-switch strip/refuse; dependency advisories cleared; the disposition table. Cookies at rest accepted after measurement. |

**Patterns across flights.** All three flights planned fewer legs than they flew (7→9, 7→13, 11→12), each split along a seam that the flight's own design decisions already showed. The flights that went smoothest were the ones that measured first: Flight 1's probe leg, Flight 2's measure-before-change legs, Flight 3's packaged-measurements leg. In each, the measurement redirected the work before code depended on it. Every flight stopped its acceptance walk partway, and the unwalked groups went to a release checklist that has no owner.

## What Went Well

- **Measure first, in the leg that uses the answer.** Measurements changed the work every time:
  - The guest preload's IPC object was reachable on Electron 44 (finding 1 became real).
  - The isolated world cannot be the trust root (DD4 diverted).
  - A jar key's Ctrl+Q quit the app (17b was far worse than the review said).
  - The clipboard clear had never fired in any release.
  - The MCP client cannot recover from an expired session, so the planned idle timeout was replaced.
  - A packaged build *is* drivable, which made leg 03/04 verification real.
- **Non-vacuity on the unmodified build.** The specs record the defect reproducing before the fix, so they are demonstrations, not assertions. When a defect did not reproduce (the 4 s title stall), that was reported instead of built around.
- **Irreversible steps last and alone.** The vault format work went in this order: rule, then plumbing, then new files and bundles together, then the upgrade. Releases went: dispatch, then candidates, then install, then stable. The real-profile upgrade was "the least eventful part of the walk".
- **Independent evidence.** A raw-crypto version-1 oracle, files written by the released commit's own store, one known-answer vector, and three injected faults each caught by the check meant to catch them.
- **Design reviews by a reader of the code, before code.** Across the three flights they caught more than a dozen defects that would otherwise have shipped: the key-hash bypass, restore with the wrong id, an unopenable export, a confirmation loop, a clipboard wipe, a redirect-blind repeat-click check, and others.
- **Scoped flight-end reviewers** (three slices per large flight), plus independent gate runs by the Flight Director at every landing.
- **The operator's "does the OS already do this?"** removed more scope than any review did. Their walks found the defects that nothing else could: the stranded dialog, the notice that offered no action, the stable-only version line.
- **The gated one-mission structure worked.** Operator, in hindsight: "it went about right". Mission control reported nothing notable in coordination friction.

## What Could Be Improved

- **By-eye verification has no owner and no deadline.** Flight 1 walked 1 of 6 groups and Flight 2 walked 2 of 7. Flight 3 walked its own items on Windows. Everything else moved to `docs/RELEASING.md` (14 items, 2 walked). Three stable releases have shipped since. Things that rest on this list include: the internet-origin mark (the premise of a ruling), lock on suspend (a must-have criterion), and the reveal dialog on Windows. A list that is carried forward without a walk turns "accepted by eye" into "never looked at".
- **Leg sizing, three flights running.** The decision-to-files table that fixed it in Flight 3 only arrived as a lesson in Flight 2. If it had been a planning step from the start, about eight design-review spawns and rewrites would have been saved.
- **Planning-time checks came late.** The platform-necessity check (Flight 1, leg 7), the "show me the call site" check for existing-behavior premises (Flight 2), and the "what does the operator do next?" check (Flight 3, at the walk) were each learned by paying for the omission once.
- **Lessons that live only in a debrief recur.** The `===`-then-coerce defect was found in Flight 1 and built again in Flight 2. That rule and the call-site rule did reach CLAUDE.md. **Flight 3's four recommended planning rules have not**: a measurement leg for platform-dependent designs, a notify feature names its next action, host tool versions checked at leg design, and placeholders for session paths.
- **Specs were wrong at about the rate code is.** In Flight 2, four specs had design errors that only a run exposed; one became a false alarm to the operator. Two specs now run reduced because the platform moved under them, and neither has been re-authored yet.
- **Private paths reached public artifacts** (Flights 1–3 and an earlier sortie). They were cleaned once, they remain in git history, and there is still no pin (squawk 0204).

## Lessons Learned

**Technical**

- **Main-side authority, page message as a hint.** This one pattern carried the whole mission: the channel gate, the click witness, the picker context, the reveal gate and the update checker's "believe only `tag_name`". The Architect confirmed it was applied consistently: a pure decision, a thin registrar and a source-scan pin.
- **A display value is derived one way and never mapped back** (Flight 1's worst bug).
- **Treat every Electron API fake as a claim.** The synchronous clipboard fake hid a dead feature for its whole life.
- **Name validators by trust level** (`parseStableTag` for the network, `isWellFormedVersion` for the app's own version).
- **A control that depends on the desktop behaving needs a fallback that does not.** The reveal gate's three cancel rules are that fallback.
- **Concentration grew.** No extraction landed during the mission, despite two debriefs flagging it:
  - `main.js` went from 2,945 to 3,263 lines.
  - `vault-store.js` went from 4,095 to 4,597.
  - `mcp-server.js` went from 1,320 to 1,512.
  - `renderer.js` held at 1,504 of 1,505 by shaping fixes around it.
- **Source-scan pins are the mission's regression net, and its cost centre.** About 40% of Flight 1's new test files are scans. `ipc-gate-invariant.test.js` now takes about 7.3 s standalone (5.9 s at the Flight 3 debrief) and grows with `src/main/**`.

**Process**

- Plan from a decision-to-files table: one leg per decision unless the decisions share files.
- Every "already does X" claim cites a call site, and every design decision gets a platform-necessity row.
- A first run of a new spec is a test of the spec.
- Anything a crew run touches outside its scratch directory (the clipboard, the downloads folder) belongs to the operator.
- Security work on a public repository has its own publication step. Branches were kept local until the release that fixed them; the operator later merged everything through PRs #288 and #291 and released.

**Domain**

- **The operating system and Chromium already cover much of a browser's trust surface.** Confirmation before running a download, the derived file name, and `pushState` throttling are all examples. A browser's job is often to not undo that, rather than to rebuild it.
- **A notify-only update feature is incomplete** until it names the operator's next action.

## Methodology Feedback

Restated from the flight debriefs. A sweep that reads those debriefs and this one should count each occurrence once. Flights ran on 1.2.3; this debrief ran on 1.2.4.

**Methodology observations** (each reproduces from the methodology alone and cost something):

1. **flight — leg identification / sizing.** The guidance "default to few, large legs" produced legs that were split at design review in **3 of 3 flights** (Flights 1, 2, 3). Expected: a decision-to-files tabulation step before legs are listed, plus guidance on when a flight wider than one to four legs is acceptable. Cost: about eight legs designed twice in part, extra design-review spawns, and one leg that took two review cycles.
2. **flight — Phase 4 design decisions lack a necessity check and a premise-citation check.** There is no prompt for "is this decision needed, given what the platform already does?" (Flight 1), and none for citing the call site behind "existing code already does X" (Flight 2). **2 of 3 flights.** Cost: one leg rewritten at a third of its size, one halved, two mid-flight scope conversations; one leg re-scoped and one criterion rewritten.
3. **flight — Phase 4 has no follow-through prompt for user-facing features** ("what does the operator do next?"). Seen in **1 of 3** (Flight 3). Cost: a leg added at the walk and an extra release candidate.
4. **agentic-workflow — Phase 2a risk tiering.** The tier missed a cross-process value change (Flight 1: a "low" leg produced the blocking bug) and selected nothing on a security mission (Flight 2: every leg high). **2 of 3 flights.** Cost: one of Flight 1's three review cycles.
5. **agentic-workflow — no mid-flight push/review checkpoint, no "landing waits on an external check" signal, and no guidance for a HAT on a published artifact.** Seen in **1 of 3** (Flight 3). Cost: three improvised review passes, custom instructions in three spawn prompts, and authority negotiated verbally mid-walk.
6. **behavior-test — no batched mode.** Every run after the first was one Executor pass followed by a cold Validator, in **3 of 3 flights**. Cost: inconclusive judgements where a live Validator would have re-observed (Flight 2), and one Executor delivered an index instead of a report.
7. **behavior-test — AUTHORING has no state-leak premise question and no teardown-form guidance.** Seen in **1 of 3** (Flight 2). Cost: one false alarm to the operator, two extra runs, and a teardown stopped mid-run by the harness (squawk 0186).
8. **flight-debrief / mission-debrief — interviewees skip the required reading.** Recorded in Flights 1 and 2, and it recurred in **this mission debrief**: the Architect read only part of `mission.md` and listed what it skipped, even with a short brief. Cost: thinner interview input, which the Flight Director had to make up from the documents.
9. **Artifact hygiene — absolute session paths in public artifacts.** Crew files say nothing against it. Seen in **3 of 3 flights** plus an earlier sortie. Cost: a cleanup pass, and residue in git history.

**Local fixes** (this project's own files):

- The behavior-test crew prompt maps observables to registered MCP servers, but this project forbids the registered server for dev runs, so every brief restated that (Flight 1). Fix: `.flightops/agent-crews/behavior-tests-execution.md` should carry the env-key `connectAutomation()` rule.
- Session-path placeholders (`<session-scratch>`, `<repo>`) should go into the crew files' logging instructions, alongside the squawk 0204 pin.

**Local lessons** (real, but no cost, or not reproducible from the methodology alone):

- Splitting the flight-end review into three scoped Reviewers above about 80 files (Flights 1 and 2). It worked; no cost was recorded.
- Skipping the second design-review pass when the changes were the reviewer's own corrections (Flight 2). No defect traced to it.
- Checking repository visibility before the first push of security work (Flight 1). Caught by the Flight Director; no cost.
- The plugin update to 1.2.4 was deferred through all three flights and has now been installed.

## Action Items

**Operator decisions taken at this debrief**

- [x] The reveal confirmation stays a native dialog. Operator, 2026-11-18: accept it, closing Flight 2's open design call. Record "the desktop may not hold a native dialog modal; the reveal gate's cancel rules are the fallback" as a platform fact in CLAUDE.md.
- [x] The by-eye release checklist is unwalked and carried forward. Operator, 2026-11-18. It goes to the next maintenance cycle as open verification.

**Verification carried forward**

- [ ] `docs/RELEASING.md` checklist: 12 unwalked items, including the internet-origin mark (Windows), lock on sleep, the clipboard clear and quit flush, the reveal dialog on Windows, jar-key Ctrl+Q on Windows, a refused launch switch on Windows, `/switch` forms, Download now on Linux, and Flight 1 groups 2–6 and Flight 2 groups 3–7. Give it an owner.
- [ ] Re-author `guest-ipc-refusal` and `vault-gesture-trust` for Electron 45 (operator ruling 2026-11-14: accept and re-author).
- [ ] A witnessed full run of `admin-reach-refusal` (steps 5, 10, 11) with the operator present to unlock; squawk 0194 first.
- [ ] Squawk 0207: update the docs now that the stable-tag check has passed on `v0.19.16`–`v0.19.18`.

**Documentation**

- [ ] CLAUDE.md *Project-specific planning rules*: add Flight 3's four (a measurement leg for platform-dependent designs; a notify feature names its next action; host tool versions checked against the commands the docs cite; placeholders for session paths).
- [ ] CLAUDE.md: an "adding an IPC channel" recipe and the display-versus-real rule (Flight 1); a "what the reveal gate does when" table (Flight 2); the native-dialog platform fact (above).
- [ ] `docs/vault.md`: name the 2d residual as a findable item. `docs/updates.md`: map each update-stack piece to its test.

**Technical debt** (for the maintenance cycle that follows this debrief)

- [ ] Extract from `main.js` (3,263 lines; the vault channel registrations and fill delegates are the natural cut) and split `vault-store.js` (4,597).
- [ ] Move download policy out of `register-update-ipc.js` (`isThisDownload`, `downloadInProgress`, the latch) into a pure module. Not addressed by sorties 09/10; the About controller seam was.
- [ ] Add one "operator input" predicate in `injected-input` for both the click witness and the reveal gate. Today the witness repeats the `isInjecting` check inline at `guest-wiring.js:592`.
- [ ] Rename `closeSavePromptAndDrop` (squawk 0193; 8 call sites, including `html-fullscreen.js`).
- [ ] Cache the source file scan shared by the invariant tests before the next mission adds more of them (`ipc-gate-invariant.test.js` ≈ 7.3 s standalone).
- [ ] Carried squawks: 0187 (popup/tab bursts; needs a sortie), 0188, 0189, 0190, 0191, 0192, 0198–0206, 0208, 0209.

**Sortie candidates**

- [ ] 14b: plan and send a capture from one trusted realm.
- [ ] 0187: caps on script-opened popups and tabs.
- [ ] Keyboard and touch activation of the fill icon.
- [ ] A control to forget a card's or identity's confirmed sites.
- [ ] Trust display: long subdomains, and http versus https on the sign-in card.
- [ ] In-app verification of a downloaded installer.

**Methodology**

- [ ] 23 mission debriefs and 10 sortie debriefs exist, and no service report has ever been run. `/mission-control:service-report` is the operator's to run when they choose. Observations 1, 6 and 9 above have now recurred in every flight of this mission.
