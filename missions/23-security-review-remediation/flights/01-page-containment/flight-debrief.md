# Flight Debrief: Page Containment

**Date**: 2026-11-14
**Flight**: [Page Containment](flight.md)
**Status**: landed
**Duration**: 2026-11-12 (planned) – 2026-11-14 (landed)
**Legs Completed**: 9 of 9 (planned as 7; two were split at leg design)
**Plugin version**: mission-control 1.2.3 (1.2.4 was available throughout and not installed)

Committed locally on `flight/01-page-containment` as `7e2d8c4`, `f1d4520`, `7a8a716`, `95b713b`. **Not pushed and no PR, by operator ruling**: the repository is public and the branch carries the full findings list, including issues not fixed until Flights 2–3 and an account of how a page reaches internal IPC in the released 0.19.13.

Inputs to this debrief: the flight log; a Developer interview (which ran the suite and measured the footprint, but says it did not read the leg files or the log in depth, so its quality judgements rest on the diff and tests); an Architect interview (which worked from the spec, the log and the mission and says it did not read the new modules' source); the three flight-end reviewers' reports; and the operator's rulings during the flight. No separate human interview was held — the operator's decisions are recorded verbatim in the log.

## Outcome Assessment

### Objectives Achieved

- **Every main-process IPC channel now names who may call it.** One gate module with a classification table it enforces at registration, and a source guard at zero exceptions. Before: 46 handlers with no sender check and 2 that did not refuse. A page holding the guest preload's IPC object — which Leg 1 proved a page can obtain — is refused on every chrome, sheet, find and save-prompt channel. Behavior-tested (`guest-ipc-refusal`, 9/9), with a recorded run on the unmodified build in which the same calls succeeded.
- **The vault picker can only be raised by a real click, and a fill is bound to the page it was raised on.** Main witnesses the click itself; an accepted gesture mints a main-held context carrying the tab's committed origin; every fill requires it. Behavior-tested (`vault-gesture-trust`, 11/11 twice) and **walked by the operator with a physical pointer** (16 of 17 steps, all passing).
- **The picker defends the one accepted residual.** Destination line, nothing selected at open, half-second arming, once-per-site confirmation for cards and identities, a warning first on a certificate-override tab. Unit- and integration-tested, and seen by the operator.
- **No page-supplied URL is fetched through another jar.** The media list is validated in main and the proxy is addressed by an unguessable per-document token. Behavior-tested (`cross-jar-fetch-isolation`, 10/10), with the cross-jar request recorded on the unmodified build.
- **Smaller fixes, each measured first**: `file:` URLs can no longer be downloaded through the media channel; a history title update can only touch its own visit; a page-suggested file name cannot carry control or bidi characters; Retry goes through the owning jar; `user:pass@` is not shown in the address bar or stored in history; the client-certificate picker opens with nothing selected.
- **The interrupted web-content audit was finished** as a guard audit (35 guards: 22 sound, 11 gap, 2 undetermined) with a 214-channel census, and the `[A]`-tagged claims were re-verified (63 of 73 confirmed).

### Not achieved, or achieved less than planned

- **DD4's original premise failed.** Main cannot exchange data with the isolated world free of page code. The flight diverted, by operator ruling, to main witnessing input; the page-reported icon box is an **accepted residual**: a real click anywhere on a hostile page can raise the picker.
- **DD9 was cut to about a third and DD7/DD10/DD11 to about half**, by operator ruling, once it was asked whether the OS or Chromium already covered them. No executable-type list, no in-app open confirmation, no extension forcing, no arming for the sign-in card or certificate-error Proceed.
- **One built item guards rather than fixes.** The history title cap and limiter were justified by a standalone probe's 4 s stall; in the product the same flood cost 93 ms before any change.
- **By-eye coverage is partial.** HAT groups 2–6 were not walked (sheets behind the new guards, tabs and media, downloads and address bar, second window, wording). Everything in them has unit or behavior-test coverage; nobody has looked.
- **Not verifiable on this host**: whether downloads carry the internet-origin mark on Windows and macOS — the thing the "leave confirmation to the OS" ruling relies on. Now a release-checklist item.

### Mission Criteria Advanced

Findings 1, 2, 4, 9, 10, 14, 22 addressed; 6, 15 and 16-history addressed in narrowed form with the mission's wording revised under dated notes. The mission's gate — operator go/no-go on Flights 2 and 3 — is now due.

## What Went Well

- **Probe first, build nothing on an unverified premise.** The opening leg was evidence only. When Q2 failed, the cost was one leg and a design conversation; no code depended on DD4. The operator's no-fallback ruling made the stop unambiguous.
- **Non-vacuity runs on the unmodified build.** Five legs had to show their defect reproducing before any source change. Four did, and the specs that follow are demonstrations. The fifth did not (the title flood), and that was reported instead of built around.
- **Leg design reviews caught real defects before code existed**: stripping key hashes from one path would have broken the indicator and left them on another; a no-menu refusal would have dropped the sheet-drag end signal; restored history entries were an unvalidated path into a web partition; an old document's last media list arrives after the next commit; the card confirmation could be skipped by lock-then-re-pick; the picker template routed unknown actions to the vault page.
- **Three scoped flight-end reviewers instead of one.** About 200 files; each slice was read closely. They found a key-hash bypass via a non-string key, the destination line cutting the wrong end of a long host, and four edge paths around the credential-free address. A fourth reviewer then caught the fix pass re-applying credentials on any navigation — the risk the Flight Director had named in its brief.
- **Independent gate runs.** A reviewer, then the Flight Director, re-ran the suite; nothing rested on a Developer's word at the end.
- **The operator's "does the OS already do this?"** removed more scope than any review did, and nothing removed has been missed.
- **Checking the remote before pushing.** The earlier approval to open a draft PR had not considered that the repository is public.

## What Could Be Improved

### Process

- **The platform question was asked at leg 7, not at planning.** By the Architect's reading DD9, the rate-limit half of DD10 and most of DD11's arming would not have survived a planning-time check. Cost: one leg designed at full size and sent back "needs rework", one rewritten, two operator scope conversations mid-flight.
- **Legs were oversized twice.** `vault-fill-trust` and `jar-isolation-and-downloads` were each split at design review. The first cost two review cycles.
- **Probe evidence was weighted the same whichever way it pointed.** A standalone rig measured a 4 s stall the product does not have, and a fixture design (fail once, then succeed) that Chromium's auto-resume makes impossible. A rig also prevented a real design error. Scope was expanded on the first kind without a product measurement.
- **The Flight Director misread evidence three times and corrected each in the open**: told the operator a stylesheet rule existed when it did not; gave a test hostname with a 92-character label; told the operator the icon appears on a postal-code field. None reached code. Each cost the operator a round trip during the walk.
- **Behavior tests were batched** (one Executor pass, a separately spawned Validator) rather than run checkpoint by checkpoint after the first. It kept eleven runs affordable and each run log says so, but a Validator working from files cannot re-observe a live state.
- **Four legs of source sat uncommitted for a day.** Deliberate — one reviewed commit — and nothing was lost, but a snapshot outside the tree was the only protection during the fix pass.
- **Interview inputs were thinner than asked.** Both debrief interviewees skipped part of their reading and said so. The briefs were long; shorter briefs with fewer mandatory extras would likely have been followed in full.

### Technical

- **Suite**: 6,780 tests, 6,776 pass, 0 fail, 4 todo (the known unsolved capture cases), no flake. Runner 9.4 s, wall 9.7 s. Against sortie 08 (6,348 tests, 8.2 s runner): +432 tests, +1.2 s. The slow files are unchanged vault suites (`vault-compromise-rotate` 3.5 s, `vault-txn` 2.6 s, `vault-context` 2.1 s). The increase is plausibly the 22 new test files and the rewritten registrar suites rather than noise; re-measure on a quiet host before calling it a new band. The runner reports no per-file timing.
- **Footprint** (`8e2313f..HEAD`): 226 files, +21,123 / −2,405. `src/` 71 files +5,541 / −1,816; `test/` 134 files +12,156 / −581; 19 new source modules; about 25 existing test files substantively rewritten.
- **About 40% of the new test files are source-scan pins** (11 of 22). They are how the gate invariant and the "applied only here" rules are held, and they break on refactors. Most brittle: `ipc-gate-invariant.test.js`, `preload-channel-literals.test.js`, and the picker template and stylesheet pins.
- **Budgets**: `renderer.js` 1,504 of 1,505 (untouched all flight — several fixes were shaped around not editing it); `bookmarks-bar.js` 1,076 of 1,100; evaluate seam 41.
- **`main.js` is 3,052 lines** (+107) and `menu-overlay.js` 3,136 (+52). CLAUDE.md calls `main.js` a composition root; the vault channel registrations and fill delegates are the natural extraction.
- **A trust unit now spans four mechanisms**: gate class, click witness, picker context, sheet arming. Each is small and tested; their interaction is tested only through the controller's mock bridge and one operator walk.
- **The four-guard rule for sheet channels is split**: the gate owns sender identity and menu type; token freshness and the business gate stay inline in each handler.
- **Display values derived from real ones caused the flight's worst bug.** The address without credentials produced two review findings and a blocking fix-pass defect, when a display value was mapped back to a real one by matching a field that every navigation rewrites.
- **The witness sees mouse input only.** A touch tap raises nothing; the icon is not keyboard-reachable.

### Documentation

- CLAUDE.md names the gate and the table but has no short "adding a channel" recipe (classify in the table, pick the registrar, state the refusal).
- `docs/vault.md` describes the gesture witness and the picker's controls; it should carry the accepted residual as a named, findable item rather than a paragraph.
- No document states the display-versus-real rule that the fix pass arrived at.
- The debrief format has nowhere for suite timing; this one puts it under Technical.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
| --- | --- | --- |
| DD4/DD5 trust root changed from the isolated world to main witnessing real input | Leg 1 probe: the isolated-world reply is page-visible and page-alterable | Yes — a premise-bearing decision gets its probe before any leg depends on it |
| 7 planned legs flew as 9 | Two legs too large for one pass, found at design review | Yes — size by decision clusters; split before the first review, not after |
| DD9 cut to sanitiser, owning-jar Retry, completion check | The OS confirms before running a download; the server already controls the derived name | Yes — the platform check below |
| DD7 arming is decided in the sheet alone; DD10 uses a self-invalidating match instead of hooks in three modules | Simpler mechanisms with the same outcome, found at leg design | Case by case |
| File-scoped interim allowlist became a channel-scoped set, then was deleted | Nearly every registrar mixed checked and unchecked handlers | n/a (complete) |
| Three flight-end reviewers, each on a slice | The diff was too large for one careful read | Yes, above roughly 80 files |
| Behavior tests batched: one Executor pass, separate Validator | Cost; the first run of the first spec had passed checkpoint by checkpoint | Only for re-runs and for specs with self-enforced halt gates; say so in the run log |
| `prompts-and-bounds` tiered low, no design review | Six additive changes of a few lines, each with survey evidence | No — its one cross-cutting change (the display address) produced the flight's blocking bug; a change that alters what another process holds is never low |
| No push, no PR | Public repository; unfixed findings on the branch | Yes — check repository visibility before the first push of any security work |
| HAT stopped after group 1 | Operator's choice; group 1 was the residual's defence | n/a |

## Key Learnings

1. **Ask what the platform already does before sizing anything.** One row per design decision: what the OS or Chromium already does, measured in the product; what the server or page already controls; the residual; why the residual is worth a leg.
2. **A probe that widens scope needs a product measurement; a probe that blocks a design does not.** Rigs give upper bounds and feasibility. The 4 s stall and the impossible fixture were both rig truths.
3. **A display value is derived one way and never mapped back.** Main keeps the real value; every consumer is display or act, never both; no lookup keyed on state that changes.
4. **"Low risk" is about what else holds the value, not how many lines change.** Changing what the chrome is told about a tab touched reload, retry, bookmarks, crash and window moves.
5. **What nobody can observe needs a person early.** The vault sheet rested on unit tests and reviewers' reading until the operator's walk, which took minutes and found one thing automation could not.
6. **Tell the operator when a justification weakens.** The title-flood correction changed nothing in the code and was still worth saying.
7. **Security work on a public repository has a publication step of its own**, separate from commit and review.

## Methodology Observations

Recorded, not judged. Installed plugin: mission-control 1.2.3.

- **flight skill, Phase 4 (crew interview / design decisions).** The skill asks that "a DD that rests on an empirical premise should have that premise verified before it's locked", and the flight did that for DD4 by putting a probe leg first. It has no prompt for the opposite check — whether a decision is needed at all given what the platform already provides. Expected: a planning step that tests each decision's necessity. Cost: one leg designed and reviewed at full size then rewritten at a third; one cut by half after a survey; two mid-flight scope conversations with the operator.
- **flight skill, leg identification.** Guidance says "default to few, large legs". Two legs sized that way were split at design review; one took two review cycles. Expected: a sizing check that counts subsystems or decision clusters per leg. Cost: one extra design-review cycle and a rewrite.
- **agentic-workflow, Phase 2a risk tiering.** The low tier is described as "additive, single-surface work within established codebase patterns". Leg `prompts-and-bounds` fit that description line by line and was tiered low; its change to what the chrome holds for a tab's address produced two review findings and a blocking defect in the fix pass. Expected: a tiering question about values other processes hold or feed back. Cost: one of the three review cycles.
- **agentic-workflow, Phase 2d.** "Spawn a Reviewer" over "ALL uncommitted changes". With roughly 200 changed files the Flight Director split the review three ways by leg and assigned the gate run to one reviewer. The skill neither forbids nor suggests this. It worked; recorded so a sweep can see whether single-reviewer flights of this size miss more.
- **agentic-workflow, Phase 2d step 4 (draft PR).** The step has no check of repository visibility or of what the branch discloses. The operator had approved "commit and a draft PR"; the Flight Director checked the remote unprompted and stopped. Expected: a publication check for security-relevant flights. Cost: none this time.
- **behavior-test skill, Phase 4.** Checkpoint-by-checkpoint with two live agents was used for the first run of the first spec and cost about sixteen agent turns for eight checkpoints. Later runs were batched into one Executor pass and one Validator spawn, with halt gates enforced by the Executor. The skill's re-spawn and live modes do not describe a batched mode. Recorded as a deviation in every run log.
- **behavior-test skill, apparatus discovery.** The crew prompt maps observables to registered MCP servers; this project forbids registered servers for dev runs and drives the app with env-key scripts. Every Executor and Validator brief had to restate that. Cost: longer briefs; no wrong run.
- **flight-debrief skill, Phase 2.** Both interviewees returned useful input and both stated they had skipped part of the reading the brief required. Recorded with the briefs' length (the Flight Director added five to seven extra instructions to each crew prompt) as the likely cause.
- **squawk skill, Log verb.** Fourteen candidates were logged in one invocation; eight failed the gate. The skill handled the batch, though it is written for one item at a time and the "interview briefly" step was skipped because the flight log already held the evidence.
- **Plugin update notice.** 1.2.4 was announced at session start and was not installed, as the methodology directs for a Flight Director. The flight ran entirely on 1.2.3.

## Recommendations

1. **Before Flight 2 is designed, run the platform check on every remaining design decision** — the table in Key Learning 1, with a measurement in the product for anything a probe suggested.
2. **Cut a release from this branch before publishing the findings.** 0.19.13 still has what this flight fixes. Decide separately whether the audit, census and probe write-ups are published at all.
3. **Add the permission-handler gaps (NF2, NF5) to Flight 2** and decide there whether keyboard and touch activation of the fill icon join it or become a sortie.
4. **Walk HAT groups 2–6 before that release.** Twenty minutes; they cover every sheet card behind a new guard.
5. **Write the display-versus-real rule and the "adding an IPC channel" recipe into CLAUDE.md**, and name the accepted residual in `docs/vault.md`.

## Action Items

**Squawks logged from this flight** (all open, routine):

- [ ] [0179](../../../../squawks/0179-downloads-popup-extension-hidden-by-ellipsis.md) — downloads popup can hide a long name's extension
- [ ] [0180](../../../../squawks/0180-redirected-media-download-loses-suggested-name.md) — a redirected media download loses its suggested name and folder
- [ ] [0181](../../../../squawks/0181-address-field-unbounded-after-long-in-page-navigation.md) — the chrome is pushed an unbounded address after a long in-page navigation
- [ ] [0182](../../../../squawks/0182-certificate-picker-no-arming-cue.md) — the certificate picker gives no cue while arming
- [ ] [0183](../../../../squawks/0183-window-left-with-no-tabs-after-move.md) — a window may be left with no tabs after a move (unconfirmed)
- [ ] [0184](../../../../squawks/0184-unique-path-suffix-exceeds-name-cap.md) — de-duplication can exceed the name cap

**Failed the squawk gate — need a design call** (sortie or Flight 2/3):

- [ ] Keyboard and touch activation of the vault fill icon (needs a witness for a key press or a tap; security-sensitive surface)
- [ ] A control to forget a card's or identity's confirmed sites (new behaviour)
- [ ] Internal session has no permission handler (NF2); `window-management` granted unprompted (NF5) — Mission 23 Flight 2
- [ ] Trust display: long subdomains clipped in the address bar; the sign-in card does not show http versus https
- [ ] The native fill-icon menu does not match the app's menus (operator observation at the HAT; would move it onto the sheet)

**Open verification:**

- [ ] HAT groups 2–6, and group 1 step 11 (a copied card asks again)
- [ ] Windows and macOS: a downloaded file carries the internet-origin mark and the system warns before running it (`docs/RELEASING.md`)
- [ ] Re-measure suite time on a quiet host (9.4 s against 8.2 s at sortie 08)

**Operator decisions pending:**

- [ ] Go / no-go and scope for Flights 2 and 3
- [ ] When and how to publish this branch — operator intends to merge and cut a release as soon as it is merged (2026-11-14); the version is bumped on the branch without a tag, and the release tag is created on `main` after the merge
- [x] Whether to mark this flight `completed` — yes (operator, 2026-11-14)
