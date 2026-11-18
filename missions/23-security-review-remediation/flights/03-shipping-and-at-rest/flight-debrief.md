# Flight Debrief: Shipping and At-Rest

**Date**: 2026-11-17
**Flight**: [Shipping and At-Rest](flight.md)
**Status**: landed
**Duration**: 2026-11-16 (planning) – 2026-11-17 (landed)
**Legs Completed**: 11 of 12 (leg 09 `cookie-encryption` not flown by operator ruling; leg 12 `update-download` added at the acceptance walk)
**Plugin version**: mission-control 1.2.3 (1.2.4 available, not installed)

Inputs: the flight log in full; a Developer interview (Sonnet, read-only, ran the suite); an Architect design review (Sonnet, read-only, read the end state from GitHub). The human interview was skipped — the operator's rulings are recorded verbatim in the flight log and no gap needed explaining.

## Outcome Assessment

### Objectives Achieved

- **Old builds are told, and can act.** A daily, credential-less check believes only a validated stable `tag_name`; Settings → About shows the running version, the newer one, "Download now" and "View release notes"; the kebab gains an item. The operator installed `v0.19.15-rc.3` on Windows and reported "pass", including the first real download from the button.
- **Releases are verifiable and fixed.** Provenance is attested in a job that runs no project code; a stable tag must be reachable from `main` (a deliberate `v0.0.0` on a non-`main` commit was refused live); the tag ruleset and immutable releases are on (`v0.19.15-rc.2` is the first immutable release); `gh attestation verify`, `gh release verify` and `verify-asset` pass as documented, and fail on a wrong workflow or a modified byte.
- **The build job cannot write.** `build` runs with `contents: read` and no token; a separate `upload` job verifies directory names, file names and digests before it uploads. Proved by manual dispatch runs on all three platforms (macOS signature verified on the runner; each app started).
- **The packaged app is not a general-purpose tool.** Three runtime fuses off and checked in every packaging path; dangerous launch switches stripped or refused (exit 64), measured on the packaged build.
- **Every finding has a disposition.** `mission.md` `## Dispositions`: 7 fixed, 15 fixed in part, none left open; the four undecided rows were ruled by the operator at the walk.
- Dependencies: no advisory in the tree; Electron 45.3.3.

### Not achieved, or achieved less than planned

- **Cookies at rest** — accepted, not fixed, after measurement (nominal without a keyring, one-way, unverifiable on macOS).
- **Not run anywhere yet**: a stable tag on `main` passing the stable-tag check, and the release sequence end to end — both at the 0.19.16 release.
- **Not walked**: a refused launch switch on Windows; the macOS build on hardware; Windows `/switch` forms; "Download now" on macOS and Linux; the by-eye items carried from Flights 1 and 2. All listed in `docs/RELEASING.md`'s checklist.
- **The Concourse image-digest pins** have never run on the worker.

### Mission Criteria Advanced

- *An operator on an old build finds out, and can verify what they install* — substantially met (see above; the passing stable-tag run is the last piece).
- *Every finding 1–22 has a recorded disposition and the regression net is green* — met for the disposition half; regression net green (7,250 passing). Not ticked here: that is the mission debrief's call.

## What Went Well

- **A measurement leg before the designs that depended on it.** `packaged-measurements` overturned the plan's apparatus premise (a packaged build *is* drivable over MCP from a seeded profile), set the per-switch mechanism (`--js-flags` only partly removable; `--load-extension` ignored), and produced the facts the cookie ruling rested on. Legs 03 and 04 were verified on the real packaged build instead of by unit tests alone.
- **A proof ladder for things that cannot be proved locally**: unit tests with neuter runs → a manual dispatch that publishes nothing → public release candidates → an operator install. Each rung found what the one below could not (the Windows `sha256sum` marker on the first dispatch; the stable-only version line on the first install).
- **Honest "not yet run" wording, then updated.** The docs said what had not executed; the Reviewer caught the one present-tense slip; after the walk the docs were brought up to what was observed.
- **The refusal test was fenced**: an auto-cancel armed before the push, run before immutability so clean-up was unrestricted, tag deleted afterwards.
- **Reviews caught real things at each pass** (three passes, each confirmed): artifact directory names unvalidated before the token step; `${{ }}` in run blocks unpinned workflow-wide; three disposition rows more generous than their own reasons; the redirect-blind repeat-click check.
- **Developers reported instead of inventing**: leg 10 listed the findings it could not source (14b, NF6, 13d); leg 04 stopped and reported Electron's self-added switch.
- **Fix-versus-feature was called out loud at the walk**: two defects fixed inline; "Download now" taken through a design review; release notes and the update indicator deferred.

## What Could Be Improved

### Process

- **The update notice gave the operator nothing to do** until the walk ("there is nothing actionable in the UI"). DD1's own trade-off line conceded the notice is easy to miss; neither the Flight Director nor the Architect review asked what the operator does next. Cost: leg 12 inside the flight and a third release candidate. *(Important.)*
- **The flight spanned three clusters** — release integrity, the update feature, local hardening — plus a feature added at the walk. It worked because the legs did not share files, but it ran to twelve legs and three review passes against a guideline of one to four legs.
- **Authority to push tags and change settings was granted verbally mid-flight** ("you can do all of that except Ill install the release candidate"). It was recorded, but should be asked once at planning and scoped.
- **The development host's `gh` (2.45.0) lacked the commands the docs cite**; the commands were written from the manual and first run at the walk. A current CLI in scratch at leg design would have checked them a day earlier.
- **Private paths reached public artifacts** across this mission and an earlier sortie: logs recorded absolute scratch paths that embed the OS user name (fourteen lines in seven files, cleaned in this flight; still in git history).

### Technical

- **`register-update-ipc.js` holds download policy** (`isThisDownload`, `downloadInProgress`, the latch, the ` (n)` suffix match against `uniquePath`) — a decision module inside a registrar, coupled to the downloads record shape.
- **The About controller has no unit seam**; the two walk defects were in exactly the glue it decides.
- **`update-version.js` holds two trust levels of version predicate** (`parseStableTag` for network input, `isWellFormedVersion` for the app's own) — the leg 06 error came from reusing one for the other.
- **The workflow tests parse YAML as text** and extract bash by indentation regexes; an innocent reformat fails them loudly but unhelpfully. `stable_tag_on_default` is tested as a text-extracted copy, not as a shipped file.
- **`check-fuses.mjs` pins the ninth fuse by index** (`WasmTrapHandlers`, unnamed by `@electron/fuses` 1.8.0) — loud when the library names it, silent if Electron reorders the wire.

### Documentation

- `docs/RELEASING.md`, `docs/updates.md`, the README and CLAUDE.md are current with what was observed. Missing: a short map in `docs/updates.md` of each update-stack piece to its test.

## Test metrics

`npm test`: **7,254 tests — 7,250 pass, 0 fail, 0 skipped, 4 todo** (the same four `[known-unsolved]` capture cases as Flights 1 and 2); no flake. Runner 9.7 s, wall 10.0 s, 399 files.

Against earlier flights: Flight 1 6,780 tests / runner 9.4 s; Flight 2 7,117 / 7.9 s; now **+137 tests, +1.8 s**. The only slow new file is `stable-tag-check.test.js` (~0.9 s standalone — it spawns real `bash` with a fake `gh`); the other new files are pure and cheap. Flight 2's debrief already called its own 1.5 s drop host variance, so the band is about 8–10 s and this is not judged a regression. The largest single file is `ipc-gate-invariant.test.js` (~5.9 s standalone; it scans all of `src/main/**`, which this flight grew) — worth watching.

## Deviations and Lessons Learned

| Deviation | Why | Lesson |
| --- | --- | --- |
| Leg 05 flown before 03 and 04 | it depended on neither; 03/04 were designed from leg 02's results meanwhile | Fine; the "decisions against files" table made it safe |
| Code review moved forward before the first push | nothing unreviewed should be pushed for a workflow run | A flight that must push mid-way needs a review checkpoint at that push |
| Leg 09 not flown | operator accepted cookies at rest on measured reasons | Conditional legs that end in "accept" are a legitimate outcome |
| Leg 12 added at the walk | operator: "A download now button would be ideal in the settings page" | Ask "what does the operator do next?" at planning |
| `allow-file-access-from-files` on neither list | Electron adds it while the `file://` fuse is on | A switch Electron sets itself is not refusable — measure `hasSwitch` on the packaged build |
| "In progress" = state `progressing`, not "no end time" | an `interrupted` record gets no end time while running | Enumerate a record's states before writing a rule over them |
| Repeat-click check matches the installer file name | a GitHub asset download records the redirect target | Ask "what will the record actually carry?" |
| Digest list written in one form on every runner | Windows `sha256sum` writes `hash *name` | Cross-runner output formats are a contract to assert |

Of the spec errors the Developer traced, three needed only a better design-review question ("where does this value come from, and what shapes can it take?"; "what states exist?"); the Windows marker, Electron's self-added switch, the 407 trace and the interrupted state needed a real run.

## Key Learnings

1. **Measure the platform in its own leg when a design rests on behaviour not readable from code**, and carry the results into later legs as a named file.
2. **A notify-only feature must name the operator's next action**, and the design must say whether that action is inside the app.
3. **Distinguish trust levels in validators by name.** The same version string needs a strict check from the network and a permissive one from the app itself.
4. **Unprovable-locally work needs a ledger** — what proves it, who runs it, when — kept until it has run. Leg 08's twelve-item list became the walk's agenda; it should be a first-class artifact.

## Methodology Observations

Recorded against mission-control **1.2.3**.

1. **agentic-workflow — no mid-flight push checkpoint.** The skill defers review and commit to the end of the flight; this flight had to push mid-way for a GitHub workflow run (leg 07 AC8), so the Flight Director improvised a review of legs 01–07 before the push, a second for 08 and 10, and a third for 12 and the walk fixes. Expected: a documented option for a review-and-commit checkpoint when a leg needs a push. Cost: three improvised passes, reasoned out each time.
2. **agentic-workflow — legs that cannot land on the Developer's word.** Legs 06, 07 and 12 ended with `[HANDOFF:review-needed]` and stayed `in-flight` until the Flight Director ran a behavior spec or the operator authorised a workflow run; the skill's signal table has `[LAND:leg]` only. Expected: a signal or convention for "built; landing waits on an external check". Cost: a custom instruction in three spawn prompts.
3. **agentic-workflow — HAT legs that need commits and pushes.** The walk needed three release candidates, each a commit, push and tag inside the HAT, and a feature built mid-walk; the skill's HAT section says "commit when all steps pass". Expected: guidance for a HAT on a published artifact. Cost: authority negotiated verbally mid-walk.
4. **flight — sizing.** The skill's guidance is one to four legs; this flight planned eleven and flew twelve across three decision clusters, and stayed coherent only because the legs did not share files. Expected: either a split at planning or guidance on when a wide flight is acceptable. Cost: none that failed, but three review passes and a long log.
5. **flight — the "what next" question.** Phase 4's interview has no prompt for a user-facing feature's follow-through; DD1 shipped a notice with no action and the Architect review did not catch it. Cost: leg 12 and a release candidate.
6. **behavior-test — batched mode.** Both spec runs used one Executor pass and one cold Validator rather than the skill's default re-spawn per checkpoint, because the specs relaunch the app and re-mint keys mid-run. It worked (25/25 judged, no inconclusive), but the skill does not describe it. Expected: a sanctioned batched mode with its trade-off (no re-observation).
7. **Artifact hygiene — absolute paths.** Crew and Flight Director logs recorded absolute scratch paths containing the OS user name in public artifacts across Flights 1–3 and an earlier sortie. Nothing in the crew files warns against it. Cost: a cleanup pass and residue in git history.
8. **flight-debrief — worked as written**; the skipped human interview was justified by the log.

## Recommendations

1. **Add four planning rules to CLAUDE.md's *Project-specific planning rules*** *(important)*: a measurement leg when a mechanism rests on platform behaviour; a notify feature names its next action; tool versions on the host are checked against the commands the docs will cite, at leg design; logs and docs use placeholders (`<session-scratch>`, `<repo>`) for session paths.
2. **A path-hygiene pin** *(important)*: a unit test that fails on `/home/<user>` or `/tmp/claude-` patterns under `missions/**`, `sorties/**`, `squawks/**`, `docs/**` and `tests/behavior/**`.
3. **Refactor the update stack's two weak joints** *(important, a sortie)*: move download matching into a pure `src/shared/update-download-match.js` (or have the start wrapper return the download's identity); give the About controller an injected-deps factory with unit tests; rename the two version predicates by trust level.
4. **Keep a "first real runs" ledger per flight** *(minor)*, and ask for scoped tag / settings authority at planning.
5. **Workflow tests** *(minor)*: move `stable_tag_on_default` into a sourced `scripts/` file the test runs directly; route ordering assertions through one helper.

## Action Items

Candidate squawks (single defect or servicing item, no design call):

- [x] Squawk 0198 — The toolbar downloads indicator counts an `interrupted` download as in progress while the downloads page says "Failed".
- [x] Squawk 0199 — The Retry note reads "does not record which identity it came from" for an app-started download.
- [x] Squawk 0200 — The home-page Save button is 2 px shorter than Clear beside it.
- [x] Squawk 0201 — `location.reload()` on the chrome through admin `evaluate` leaves only a Welcome tab and an empty tab census (unconfirmed whether it predates Flight 3).
- [x] Squawk 0202 — Older Settings controllers have the boot-read-versus-push race fixed for the update checkbox.
- [x] Squawk 0203 — `check-fuses.mjs`: cite the measured Electron version beside the ninth-fuse index, and make the failure message say to retire the local name.
- [x] ~~A comment-and-test drift guard that `allow-file-access-from-files` is deliberately on neither launch-switch list.~~ Not logged: it already exists — the comment in `src/main/launch-switches.js` and the test "allow-file-access-from-files is on neither list" in `test/unit/launch-switches.test.js`.
- [x] Squawk 0204 — The path-hygiene pin (Recommendation 2).

Sortie candidates (need design): an in-app update indicator (operator); hand-written release notes published by the workflow (operator); the update-stack refactor (Recommendation 3); planning and sending a capture from the isolated world (finding 14b); a cap on script-opened popups and tabs (squawk 0187); in-app verification of a downloaded installer.

At the 0.19.16 release: confirm the stable-tag check passes on the squash commit; confirm the release sequence as documented.
