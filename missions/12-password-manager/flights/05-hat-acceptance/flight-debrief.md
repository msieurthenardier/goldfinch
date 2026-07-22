# Flight Debrief: HAT + Alignment — End-to-End Acceptance

**Date**: 2026-07-22
**Flight**: [HAT + Alignment — End-to-End Acceptance](flight.md)
**Status**: landed
**Duration**: 2026-07-21 (plan) → 2026-07-22 (live HAT + inline pass + debrief)
**Legs Completed**: 4 emergent legs (hat-fixes-01, hat-page-sidebar, hat-import-export-modals, hat-vault-item-organization) + 1 banked (hat-fresh-profile-import, planning)

## Outcome Assessment

### Objectives Achieved
The mission's closing acceptance gate ran as a guided, interactive HAT: the operator drove the live app, the Flight Director guided and fixed issues inline. **Core surfaces verified live**: first-run setup + trust boundary (A1); rotation crypto — recovery/master/admin (B9/B10); automation fill — fill-only, origin-bound, no-wire-leak (A3); TOTP RFC-6238 cross-checked (A4); the registrable-domain widen via an `lvh.me`/`*.lvh.me` public-wildcard-DNS matrix (F4 DD5); and the full human-fill picker flow (F2). Alongside verification, the session produced a large inline UX/feature pass — **I1–I18** — that materially reshaped the Secrets page (two-level nav + sidebar, typed subsections, a modal item editor with a structural secret-teardown pattern, unified Import/Export modals, in-field reveal/copy, icon buttons, button-system parity) and, critically, **found and fixed a real defect in the mission's marquee portability criterion during the debrief itself**.

### Mission Criteria Advanced
Advanced the live-verification of the criteria F1–F4 could only approximate against mocks: explicit-gesture fill, TOTP, scoped automation, rotation/recovery, and registrable-domain matching are now confirmed against the running feature. The portability criterion (export/import) moved from "untested" to **"tested, broken, fixed"** for the same-profile restore path — and its cross-machine/fresh-profile variant is now precisely scoped (see Deviations + Action Items).

## What Went Well

- **The design-review gate remained the primary quality mechanism — the mission's most consistent finding across all five flights.** DD3's fix-vs-feature classifier promoted two mid-HAT features (import/export modals, item reorg) and the import-collision fix to scoped design reviews before implementation. Each review caught a real, load-bearing defect *before code*: the `exportVault` second-consumer trap (the jars delete-first offer — same shape as F4's `reachableLoginItems`); the editor-modal **secret-wipe-on-idle-lock** HIGH (`openModal.close()` drains nothing, and the idle-lock path reaches it — a wipe wired only to `onCancel` would be skipped); and, in the import-collision fix, the coded-collision discipline and the export write-anywhere validation.
- **The `editorCleanups` registry teardown is the flight's strongest engineering artifact.** Routing the secret wipe through the same registry `render()` drains converts "wipe on every exit" from a per-path convention into a structural property, verified across all five editor-modal exit paths (save-success, save-locked, cancel/Esc/backdrop, idle-lock re-render, preemption). The explicit ruling that `handle.close()` is never the teardown (it drains nothing) is the correct load-bearing distinction. **Worth lifting to a documented pattern for any modal holding secrets.**
- **Second-consumer / chokepoint discipline held.** `exportVault(target, savePath?)` stayed dual-mode with the store signature pinned single-arg (`store.exportVault.length === 1`), so the jars delete-first consumer never broke. The import IPC split (pick-file / begin-import-unlock / clear-pending) is a clean three-verb state machine with `chromeForTab` correctly placing the sheet-forward in `register-browser-ipc`.
- **The debrief did its job — it caught a shipped-looking bug.** The marquee portability path was declared verified-adjacent at landing; the debrief's human interview surfaced "just tested it, it's broken," which led to the I17 diagnosis (a mislabeled collision, not a crypto failure) and fix. This is the strongest possible argument for the debrief step.

## What Could Be Improved

### Process
- **The verify-flight-became-a-build-flight is intended, but the acceptance function still got displaced.** Per operator guidance, the closing HAT is *what enables the rest of the mission to run autonomously* — a heavy end-of-mission alignment/UX pass is the accepted tradeoff, not a failure. **However**, within that model the acceptance gate had no guard against silently landing with a criterion unverified. Recommendation (below): keep the fused model, but add a lightweight "are all criteria verified or explicitly deferred?" checkpoint before landing so a marquee criterion can't slide to a footnote. The I17 bug proves the point — it was landed-over, then only caught at debrief.
- **DD4 apparatus prerequisites were identified but not gated.** The fresh-profile/second-userDataPath, the extended fixture builder (multi-origin + matchMode), and the `/etc/hosts` PSL aliases were all unmet at probe and never resolved, so Segments C (cross-profile round-trip) and D (Witnessed suite) did not run as designed. DD4 should have been a hard go/no-go, not "probed before landing."
- **DD1's admin-sheet-read affordance went unused.** The session started jar-scoped; even after an admin transport was obtained it drove the guest/automation surface, never the sheet-DOM read. Sheet verification collapsed to operator-drive + report + `captureWindow` (which is fine — but then don't claim exact-DOM sheet assertions). Either make the admin transport a hard pre-Segment-1 prerequisite or drop the claim and lean on `npm run a11y`.

### Technical
- **`vault.js` is overweight (911 → ~1700 lines, ~94% of its own cited ~1800 extraction threshold).** Three inline subsystems have already-extracted analogues on the jars page it mirrors: the page-level modal system (vs the importable `jars-confirm-modal.js`), the item editor, and the import/export modals. This is the same modal/sheet-registry debt the F2/F3/F4 debriefs flagged and escalated — F5 added a *third* parallel modal primitive rather than paying it down.
- **The DD9 untested-DOM surface widened substantially.** The 5-path secret wipe, per-row delete confirm, in-field reveal/copy, and the H1 page-side invalidation all live in DOM code with only the live HAT + a DD6 grep as their regression net. The one cleanly unit-testable new piece (`partitionItemsByType`) was extracted and tested (+4). Extraction (above) is what would make the secret-lifecycle unit-testable.
- **Test metrics (this debrief run): 2689 pass / 0 fail / 0 skipped, no flakes; internal duration 2390 ms (mission high, proportionate — ~1.5 ms/new-test, no new slow suite).** Trajectory F1 2308 → F2 2389 → F3 2522 → F4 2638 → F5 2680 (landed) → 2689 (post-debrief fixes). The standing F1 `jar-ipc.test.js` own-time watch-item is untouched (F5 made no jar changes).

### Documentation
- `docs/vault.md` predates this flight and does not describe the new Secrets page (nav+main, typed subsections, modal editor, unified Import/Export, global Lock now, in-field reveal/copy) or the `editorCleanups` teardown pattern. Needs an update in maintenance.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Verify-only HAT became a large build/UX pass (I1–I18) | Operator model: the closing HAT enables autonomous execution; end-of-mission alignment volume is expected | Yes — but add a pre-land "criteria verified or deferred?" checkpoint |
| Batch-into-a-fix-leg instead of DD3 inline-fix protocol | Operator directive at run start | Situational — the classifier half still worked |
| Segments C + D did not run (cross-profile round-trip, Witnessed suite) | Apparatus-blocked (DD4 prereqs unmet, never provisioned) | No — make DD4-class apparatus a hard gate |
| Marquee portability criterion found BROKEN at debrief (I17), then fixed | The debrief's human interview surfaced it | Yes — the debrief catching this validates the step |
| Note item lost its redundant generic `notes` field (I18) | It showed both "Note" + "Notes"; schema taxonomy change | Yes — a note's content is its body |

## Key Learnings
- **A collision must never be reported as a bad secret.** The I17 root cause was a truthfulness bug: `importVault` throws `VaultStateError` for several distinct reasons, and the sheet blanketed all of them as "check the secret." Coded errors (`VaultCollisionError`) + reason-forwarding are the fix; message-matching is not.
- **Destructive imports need an explicit, up-front confirmation bound at the commit step**, not at file-pick (or the confirmation drifts from the held state — the same H1 discipline).
- **A renderer-supplied filesystem path is a latent write-anywhere primitive** until main validates it (canonicalize + extension + writable-parent). Export honored a pasteable path *and* closed the risk; import kept its read dialog-bound.
- **The closing-HAT-as-alignment model is legitimate and powerful** (it's the price of autonomous mid-mission execution) — its one weakness is a displaceable acceptance gate, cheaply fixed with a checkpoint.

## Recommendations
1. **Close the cross-profile portability criterion as a small, dedicated unit — implement the banked `hat-fresh-profile-import` leg + provision the DD4 apparatus.** The fresh-adopt store path works and is unit-tested; what's missing is the not-set-up UI entry point + a live round-trip on a real second `userDataPath`, plus reading the import-sheet comprehension copy to confirm it names the *source* secret. This is the mission's last open marquee item.
2. **Extract `vault.js` before the next vault feature** — pull the page-modal system (generalize `jars-confirm-modal.js`), then the item editor and import/export modals into their own files. Two-for-one: it makes the `editorCleanups`/5-path wipe unit-testable, closing the biggest testing gap. Pair with the F4-carried `_stepUpMaster` four-fold consolidation as the maintenance architecture-debt slate.
3. **Author + run the banked behavior specs** (durable nets, not snapshots): the modal secret-lifecycle (reveal → idle-lock/Esc/backdrop → assert zeroed + TOTP drained); the cross-profile round-trip; jar-delete → vault-removal lifecycle; and actually run `vault-human-fill-boundary` + `vault-registrable-domain-fill` (fold the `lvh.me` wildcard-DNS trick into fixtures to drop the `/etc/hosts` prereq).
4. **Add a pre-land acceptance checkpoint to the HAT model** — "every mission criterion verified live or explicitly deferred with disposition" — so a marquee criterion cannot land unverified inside a build-heavy HAT.
5. **Update `docs/vault.md`** for the new Secrets page + the `editorCleanups` teardown pattern; confirm the post-I16 `npm run a11y` is green (the sheet restyles touched many sheet kinds).

## Action Items
- [ ] Implement `hat-fresh-profile-import` (not-set-up import entry + destination-less modal variant) — closes the marquee criterion. Owner: next planning conversation / `/routine-maintenance` scope.
- [ ] Provision the DD4 apparatus: fresh second `userDataPath`, extend `tests/behavior/fixtures/vault-login/build-fixtures.mjs` for multi-origin + matchMode, fold the `lvh.me` wildcard-DNS trick into fixtures.
- [ ] Extract the page-modal system + item editor out of `vault.js` (mirror `jars-confirm-modal.js`); make the 5-path secret wipe unit-testable.
- [ ] Author the four banked behavior-test specs and run the two never-run Witnessed suites.
- [ ] Carry forward to maintenance: the `_stepUpMaster` four-fold consolidation (F4) + the DD9 page-a11y gap + `docs/vault.md` update + confirm `npm run a11y` green.
- [ ] Add the pre-land "criteria verified or deferred" checkpoint to the HAT/flight methodology (mission-control skill note).
