# Flight Debrief: CI/CD Supply-Chain Hardening

**Date**: 2026-06-05
**Flight**: [CI/CD Supply-Chain Hardening](flight.md)
**Status**: landed
**Duration**: 2026-06-05 (single session)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved
Hardened the GitHub Actions supply chain within the two workflow files, plus one permitted script touch, verified live on real Actions infrastructure (commits `b467bb3`, `6e8b4fa`; PR #16):
- **F17** — top-level `permissions: contents: read` on `build.yml` and `ci.yml`; per-job `contents: write` retained only on `release` and `update-readme`. Verified live: PR #16 CI ran green under the read-only scope (no job lost a needed permission).
- **F18** — all 8 `uses:` pinned to 40-char commit SHAs with `# vX.Y.Z` comments (incl. the non-GitHub `softprops/action-gh-release` running with `contents: write`); npm-audit triage policy documented at the `ci.yml` audit step. Dependabot's existing `github-actions` ecosystem maintains the pins.
- **F19** — `release` gated to strictly-validated semver `v*` via a validate/classify step; prereleases marked explicitly; `update-readme` gated to **stable** releases through a job-output `is_stable` flag; `update-readme.mjs` regex anchored as a backstop.
- **F16** — README bot-push to `main` **accepted as-is** (operator decision), recorded as a tradeoff (analogous to F14/F20), not actioned.
- Carry-forward folded in: a draft `farbling-correctness` behavior spec (run deferred).

Live verification (operator-confirmed): `v0.0.0-ci-test` → published as a **prerelease** (5 installer assets), `latest` pointer held at `v0.4.0`, `update-readme` **skipped**, `origin/main` untouched (`a4e6dae`); `vtest` → **rejected** (build `npm version` failed fast, `release` skipped, nothing published); all test tags/release/artifacts cleaned up.

### Mission Criteria Advanced
**F17, F18, F19** checked off; **F16** recorded as an accepted tradeoff. Mission `01-maintenance` is now **20/21** criteria — only **Flight 5 (accessibility — F22/F23/F24)** remains. All flight checkpoints met; no adaptation/divert criteria triggered.

## What Went Well

- **Reconnaissance-before-legs paid for itself, decisively.** Verifying all four maintenance-report findings against current `main` before designing legs changed the plan for **two of four**: F18 scoped down (the "add Dependabot for github-actions" half was already satisfied by Flight 3's `dependabot.yml` — the leg carried an explicit "do NOT re-add" guard), and F16 reframed as an accepted tradeoff. A leg author working straight from the (days-old, pre-Flight-3) report would likely have duplicated the Dependabot block. The Reconnaissance Report was the highest-value artifact in the flight.
- **High-fidelity execution.** Both crew reviewers independently confirmed the committed YAML/bash is identical to the leg specs' Implementation Guidance, line-for-line. No improvisation was needed during implementation.
- **Design review caught the one real wrinkle before implementation, not after.** Leg-3's design review discovered that malformed `v`-tags are caught *first* by the build job's `npm version` (so the release validate step's `::error::…refusing to publish` message is partly redundant; its load-bearing value is the `is_stable` classification). This was documented and deliberately deferred rather than over-engineered — and the live `vtest` run confirmed the analysis exactly.
- **The three controls compose into coherent defense-in-depth**, not three isolated edits: pins make the chain immutable, least-privilege caps blast radius, and release gating both closes the non-semver publish vector and makes the retained F16 `main`-write fire only for genuine stable releases. F19's stable gate is precisely what made accepting F16 defensible.
- **Outward-facing verification handled safely.** Leg 4 (real tags / public prerelease) was run as an operator-confirmed HAT-like step, never autonomously, with blast radius pre-identified, mandatory cleanup, and a fork/`workflow_dispatch` fallback documented. The live run surprised no one — including the Reviewer's carry-forward worry (does a prerelease version string in `package.json` disrupt electron-builder?) resolving cleanly (5 assets built).
- **Non-destructive-by-design verification.** The `update-readme` stable-only gate was made a *prerequisite* of the live test, so the test itself couldn't corrupt `main` — the verification was safe by construction, not by luck.

## What Could Be Improved

### Process
- **The human "interview" was effectively continuous, not a phase.** Every judgment call (F16 retirement, the live-tag go/no-go) was made with the operator in real time, so the debrief's human-interview step was redundant. Worth noting as a property of interactive orchestration, not a defect.
- **Leg specs could state when an AC is unverifiable until live.** Leg 2 pre-resolved SHAs "apply verbatim, no network lookup" — pragmatic, but it pushes SHA-correctness entirely onto the live PR-CI run (the agent literally cannot check a pin's SHA-vs-version offline). Future pinning legs should say so explicitly so reviewers don't expect an offline proof.

### Technical
- **The version-validation regex shipped without permanent unit coverage.** Test count is unchanged (147 — zero `src/` changes), but the JS anchor in `scripts/update-readme.mjs:7` and the inline bash semver ERE in `build.yml` are covered only by one-shot, ephemeral checks the leg ran (not committed, not re-run in CI). The cheap-to-verify half of F19 (pure regex logic) currently rides on a manual check. Extracting the JS version-validation into a tiny pure function under `test/unit/` would make it permanently regression-netted.
- **Test metrics (this run):** `npm test` **147 pass / 0 fail / 0 skipped / 0 flakes**, ~72 ms internal (~0.18 s wall). Fast-gate: typecheck ~0.97 s, lint ~0.54 s, audit ~0.50 s (**0 highs**) → ~2.0 s total. **Deltas vs Flight 3** (147 pass; ~98 ms / ~0.26 s wall; ~2.7 s fast-gate): counts identical (expected — zero source changes), timings marginally faster (machine noise). No regression, no PR-cycle cost concern.
- **The rejection-message asymmetry remains** (documented, deferred): a cleaner fail-fast for malformed `v`-tags would add a strict-semver guard to the build job's `Set version from tag` step. Cosmetic; fold in opportunistically only if a future flight touches that step.

### Documentation
- **No release runbook.** The semver contract ("tags must be strict `vMAJOR.MINOR.PATCH[-pre][+build]`; prereleases publish but don't update the README; recovery = delete-release + delete-tag + re-tag") lives only inline in the workflow bash and the leg/flight artifacts — not where a future releaser looks. The rollback runbook was explicitly de-selected during planning; a short `RELEASING.md` would close this gap.
- **Flight-log template tidy:** the log has duplicated empty `## Deviations` / `## Anomalies` / `## Session Notes` headings (a template artifact). Harmless; worth a cleanup.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| F18 scoped down (Dependabot github-actions half retired) | Recon found it already satisfied by Flight 3's `dependabot.yml` | n/a — outcome of recon, not a process change; but **standardize recon-before-legs** for findings-sourced flights |
| F16 retired as an accepted tradeoff (not actioned) | Operator decision — a bot post-release docs commit is a sanctioned exception even under branch protection; F19's stable-gate further reduced its residual risk | n/a — operator call; recorded as tradeoff like F14/F20 |
| One source touch in a "workflows-only" flight (`update-readme.mjs` regex anchor) | Defense-in-depth for exactly the hazard the flight introduced (the live test tag) | Situational — fine when narrowly justified and the primary control is elsewhere |
| Leg 4 run as operator-confirmed HAT, not autonomous | An agent must not push tags / publish public releases autonomously | **Yes — outward-facing verification = operator-gated, never autonomous** |
| Pre-resolved SHA table applied verbatim (no agent network lookup) | Avoids giving a possibly-sandboxed agent an ambiguous lookup task; live CI is the real proof | **Yes — standardize the pre-resolved-table pattern for pinning legs** |

## Key Learnings

1. **For findings-sourced flights, recon-before-legs is not optional.** A maintenance report drifts the moment another flight lands; here it had drifted on 2 of 4 items in days. Re-verify every cited finding against current `main` before designing legs.
2. **Discover-in-design-review, document, defer** beats both ignoring a wrinkle and over-engineering a fix. The `npm version` rejection-path redundancy was the model: caught early, documented in the leg's Edge Cases, kept the step for its real (classification) value, deferred the cosmetic cleanup.
3. **Make a live verification non-destructive by construction.** Landing the `update-readme` stable-only gate *before* running the live test meant the test couldn't corrupt `main`. Design the safety into the change, then verify.
4. **SHA-pinning is a posture with an operational tail.** Pinning everything trades staleness-risk for immutability — but it *freezes* deprecation horizons in place. It is only safe when paired with active Dependabot triage (see Recommendations — the Node-20 cutover is imminent).
5. **The cheap half of a "needs live verification" criterion is often still unit-testable.** F19's end-to-end behavior genuinely needed the live tag, but its pure-regex core did not — and shipped without a permanent net. Split the criterion: unit-test the pure part, live-test the infra part.

## Recommendations

1. **Accept the Dependabot Node-24 major-bump PRs before the 2026-06-16 forced cutover.** The pins froze five actions on Node.js 20 (`checkout@v4.3.1`, `setup-node@v4.4.0`, `upload-artifact@v4.6.2`, `download-artifact@v4.3.0`, `action-gh-release@v2.6.2`); GitHub force-migrates to Node 24 on **2026-06-16** (11 days out) and removes Node 20 on 2026-09-16. Dependabot will open the v5 PRs; **accept them promptly and smoke-test a release tag on the new majors** (upload/download-artifact v5 had breaking changes around artifact merge behavior — don't assume). This is a deadline-bearing action item, not an open-ended carry-forward.
2. **Add permanent unit coverage for the version-validation regex.** Extract the JS check from `scripts/update-readme.mjs` into a small pure function under `test/unit/` so the anchor (and the semver contract it encodes) is regression-protected in CI rather than via a one-time manual check.
3. **Write a short `RELEASING.md` release runbook** capturing the semver contract, the prerelease→no-README-update behavior, and the delete-release + delete-tag + re-tag recovery procedure — the place a future releaser actually looks (the rollback runbook was de-selected during planning).
4. **Codify two orchestration patterns** surfaced here: (a) recon-before-legs for any findings-sourced flight; (b) operator-gate every outward-facing verification leg (real tags/releases/external side effects) as a HAT step with mandatory cleanup — never autonomous.
5. **Tidy the flight-log template** to drop the duplicated empty trailing headings.

## Action Items
- [ ] **Accept Dependabot `github-actions` v5 major-bump PRs before 2026-06-16**; smoke-test a release on the new action majors. *(Deadline-bearing; carry into the next routine-maintenance pass action list.)*
- [ ] Add unit coverage for the version-validation regex (extract a pure function from `scripts/update-readme.mjs` into `test/unit/`).
- [ ] (Optional) Author a short `RELEASING.md` release runbook (semver contract + prerelease behavior + rollback steps).
- [ ] Run/promote the `farbling-correctness` draft behavior spec (`/behavior-test farbling-correctness`) before the next Electron major upgrade; refine the New-Identity step against the live UX before promotion.
- [ ] (Housekeeping) Remove the duplicated empty `## Deviations`/`## Anomalies`/`## Session Notes` headings in this flight's log.

## Skill Effectiveness Notes

- **Flight skill** — the **reconnaissance phase** was the highest-leverage step (changed 2 of 4 items); recommend keeping it mandatory for findings-sourced flights. The Phase-4 **apparatus premise-audit on both axes** worked for the farbling spec: the spec verified up front that chrome-devtools on `:9222` can both *act* (drive canvas/navigator reads in the guest) and *observe* (read the farbled values via `Runtime.evaluate`), and correctly targeted the webview **guest** frame — the single most common false-pass trap. The **live behavior-test execution prerequisites** rule correctly kept the farbling run *out* of this flight's gate (it carries a two-live-agent crew prerequisite and is off-surface).
- **Leg skill** — **pre-resolving SHAs in the leg** and **offline-verifiable acceptance criteria** (grep counts, YAML parse, `node --check`, offline regex tests) made legs 1-3 execute cleanly and review fast. The one refinement: legs should explicitly mark any AC that is unverifiable until a live run (the SHA pins), so reviewers don't expect an offline proof.
- **Agentic-workflow** — the **deferred single review+commit** across the autonomous legs (1-3) plus a **separate operator-gated verification leg** (4) fit a CI-hardening flight well. Treating leg 4 as interactive rather than autonomous was the correct safety boundary and is worth codifying as a general rule for outward-facing legs.
- **Behavior-test (AUTHORING.md)** — authoring the farbling draft against the *real* implementation corrected the Flight-3 debrief's sketch (which wrongly assumed `navigator.userAgent` spoofing; the code spoofs `hardwareConcurrency`/`deviceMemory`). Lesson: always re-read the implementation when authoring a spec from a prior debrief's sketch — sketches drift from code just like maintenance findings do.
