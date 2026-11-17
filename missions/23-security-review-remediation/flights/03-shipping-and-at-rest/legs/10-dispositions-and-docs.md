# Leg: dispositions-and-docs

**Status**: landed
**Flight**: [Shipping and At-Rest](../flight.md)

## Objective

Every finding of the 2026-11-12 security review has one recorded outcome that a reader can check — fixed, with the test or pin that keeps it fixed, or accepted, with the reason — and nothing in the project's own documentation still says something this mission found to be false.

## Context

- Mission success criterion 10: "Every finding 1–22 has a recorded disposition and the regression net is green: each is fixed-and-pinned or accepted-with-reason in this mission's artifacts … but not silently." This leg writes that record. It changes no behaviour.
- The findings are numbered in `mission.md`'s Context (*Critical / high* 1–3, *Medium* 4–8, *Low* 9–22), with the operator decisions taken at planning and the dated notes added since. Flights 1 and 2 recorded their outcomes in their own flight logs and debriefs (`flights/01-page-containment/`, `flights/02-vault-and-automation-boundary/`), and Flight 1's `guard-audit.md` carries the finished audit and the new findings it added (the `NF` and lettered items). This flight's outcomes are in its legs and flight log.
- **This flight's own dispositions** (the source for the rows it owns):
  - Finding 3 (no update mechanism; Electron patch lag) — fixed: a daily notify-only check (legs `update-check`, `update-notice`; `test/unit/update-version.test.js`, `update-check.test.js`, `register-update-ipc.test.js`, `update-notice-model.test.js`; behavior spec `update-notice`); Electron 45.3.3 (leg `dependencies`). Accepted: nothing is downloaded or installed automatically (operator decision at planning); GitHub sees the network address and the request's `Accept-Language`.
  - Finding 7 (release artifacts unverifiable) — leg `release-integrity`: provenance attestation, GitHub's per-asset digests, immutable releases. Accepted: no operating-system code signing (operator decision at planning) — SmartScreen and Gatekeeper still warn.
  - Finding 8 (local hardening) — three parts: runtime fuses **fixed** (leg `runtime-fuses`; `test/unit/check-fuses.test.js`, the check in every packaging path); cookies at rest **accepted** (operator ruling 2026-11-17 after measurement: nominal without a keyring, one-way, unverifiable on macOS — `packaged-measurements.md`, *AC5 / Q2*); code-on-disk integrity **accepted** (`asar: false` is load-bearing; the two archive-integrity fuses need `asar`).
  - Finding 18 (release workflow) — the build job cannot write and holds no token (leg `release-build-split`; `test/unit/release-workflow-invariants.test.js`; run 44116887492); tag protection and the stable-tag check — leg `release-integrity`. The personal Windows fallback builder was removed (operator ruling).
  - Finding 19 (launch switches) — fixed for the listed switches (leg `launch-switches`; `test/unit/launch-switches.test.js`, `launch-switches-placement.test.js`). Accepted: `--no-sandbox`, `--proxy-server`, `GOLDFINCH_AUTOMATION_ADMIN` (each with the operator's reason); not covered: the process-launcher switch family and a local attacker; `--inspect` is closed by the fuse.
  - Finding 20 (dependency advisories) — fixed: `npm audit` reports none (leg `dependencies`); the `minimatch` overrides are temporary and their removal condition is stated.
- **Carried into this leg from the flight log**: `ci/README.md` still calls the repository private; the `minimatch` overrides need a removal note; the `@hono/node-server` major-version move deserves a release-note line; the Flight 2 debrief's recommendation 1 (two standing planning rules) was never applied to CLAUDE.md; the seven by-eye items carried in `docs/RELEASING.md` from Flights 1 and 2 need an owner.
- **The repository is public.** The table states outcomes and where the proof is. It does not describe how to exploit anything that was accepted rather than fixed beyond what the mission's Context already says.

## Inputs

- Leg `release-integrity` landed (its rows are final). Legs 01–07 landed.

## Outputs

- `mission.md` — a *Dispositions* section; the criteria it can now tick are **not** ticked by this leg (that is the debrief's and the operator's).
- CLAUDE.md, `docs/**`, `README.md`, `ci/README.md` — corrections only.
- A release-notes draft for the first release built from this branch, in the flight directory.

## Acceptance Criteria

- [ ] **AC1 — The table.** `mission.md` gains `## Dispositions` with one row per finding 1–22, and a second short table for the findings the Flight 1 audit added (every `NF` / lettered item in `guard-audit.md` that the mission's Context adopted). Columns: finding (number and a few words), outcome (**fixed** / **fixed in part** / **accepted**), where (flight and leg), the proof (the unit test file, pin, behavior spec or measured run that would fail or differ if it regressed — a path that exists), and for anything accepted or partial: the reason and who decided (operator ruling with its date, or a mission planning decision). A finding with several parts has one sub-row per part. No row says only "done".
- [ ] **AC2 — Every proof exists and bites.** A script-free check, recorded in the log: for each path named in the table, `ls` it; for each unit test named, run that file and record pass. Any row whose proof cannot be found is reported to the Flight Director — it is not filled with the nearest plausible test.
- [ ] **AC3 — Nothing accepted is silent.** Each accepted or not-covered item in the table also appears where an operator would look: `docs/RELEASING.md` (release-side), `docs/updates.md`, `docs/vault.md`, `docs/mcp-automation.md` or `README.md`'s security / limits text — one line each, with a pointer to the table. Listed in the log as item → where it is stated.
- [ ] **AC4 — The false-claim sweep.** For every claim the review's findings named as false or overstated in the project's documentation (the mission Context names them — for example finding 22's "several sheet channels lack the menu-type guard CLAUDE.md claims", and the statements about releases, updates, fuses and automation tiers), `grep` CLAUDE.md, `README.md`, `docs/**` and `ci/README.md` and record: the claim, where it was, and that it is now true as written or was corrected. Also corrected here: `ci/README.md`'s "private repo"; any remaining "205" channel count; any statement that a manual workflow dispatch yields no installer; any rollback text that says a tag can be reused.
- [ ] **AC5 — The two standing planning rules** from the Flight 2 debrief, recommendation 1 (read them there; do not paraphrase from this leg) are added to CLAUDE.md's *Project-specific planning rules*, each in one or two lines with its evidence in parentheses, in the list's existing style.
- [ ] **AC6 — The release checklist has an owner.** `docs/RELEASING.md`'s carried by-eye items (from Flights 1 and 2) are gathered under one heading with, for each: what to look at, on which platform, and whether leg `hat-and-alignment` of this flight will walk it. Items that leg walks are struck by that leg, not this one. Added to the list from this flight: the kebab "Update available" item; a refused launch switch's error box on Windows and macOS; the Windows `/switch` forms; the macOS build on real hardware; the About section's spacing.
- [ ] **AC7 — Release notes draft** (`release-notes-draft.md` in this flight's directory; the operator edits and uses it): what an operator will notice (the update notice and its setting; refused launch switches and exit code 64; a release now carries five installers with provenance and no updater metadata), what changed underneath (Electron 45.3.3; the MCP transport's request library moved a major version; fuses), a request to macOS users to report a build that will not open (the fuse change was verified on a build runner, not on a Mac), and how to verify a download. Plain sentences; no claim the flight did not verify.
- [ ] **AC8 — Maintenance notes.** `ci/README.md` *Accepted advisories*: the `minimatch` overrides, why they exist, and the condition for removing them (electron-builder and eslint declaring a patched range) with the command that shows it (`npm ls minimatch` after deleting the overrides in a scratch copy). The `@hono/node-server` override status (none was needed) stated in one line.
- [ ] **AC9 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`. `git diff --stat` shows no file under `src/`, `test/`, `scripts/`, `.github/` or `ci/tasks/` changed by this leg.

## Verification Steps

- AC1–AC4: read by the Flight Director against the three flights' logs. AC2's run list in the log. AC9's diff stat.

## Implementation Guidance

1. Build the table from the artifacts, flight by flight; mark every cell you could not source.
2. Verify the proofs (AC2) before polishing the wording.
3. The sweep (AC4), then AC3's one-liners, AC5, AC6, AC8.
4. The release-notes draft last. Gates. Leg `landed`, flight-log entry, `[LAND:leg]`. Do not commit.

## Edge Cases

- **A finding the artifacts show as neither fixed nor explicitly accepted**: do not invent a disposition. List it for the Flight Director with what was found; the operator rules.
- **A finding re-verification struck** (the mission's Context marks these): the row says "struck" with the note's date — it is still a row.
- **Two flights touched one finding**: one row, both places named.
- **A proof that is a behavior spec**: name the spec and its latest passing run log.
- **A doc statement that is true but unverified on some platform**: it must say which platform was not verified (the Reviewer checks this).
- **Anything needing a decision**: `[BLOCKED:<reason>]`.

## Files Affected

- `missions/23-security-review-remediation/mission.md`
- `CLAUDE.md`, `README.md`, `docs/RELEASING.md`, `docs/updates.md`, `docs/vault.md`, `docs/mcp-automation.md`, `ci/README.md` — as the sweep requires
- `missions/23-security-review-remediation/flights/03-shipping-and-at-rest/release-notes-draft.md` (new)

## Citation Audit

Checked by the Flight Director on 2026-11-17: `mission.md` — the numbered findings 1–22 under *Critical / high*, *Medium*, *Low*, success criterion 10's wording, and the dated notes under the criteria; the Flight 2 debrief's *Recommendations* item 1 ("Add two standing planning rules to CLAUDE.md before Flight 3 is designed"); this flight's log for each disposition listed in Context and for the carried items; `ci/README.md`'s "private repo" phrase (found by leg 01's Developer and again by the Reviewer). Not audited by reading: Flights 1 and 2's per-finding outcomes — assembling them from those flights' artifacts is the leg's work, and AC2 is its check. Tier: **low** — documentation and one mission table, no source change; the flight-end Reviewer reads the result.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
