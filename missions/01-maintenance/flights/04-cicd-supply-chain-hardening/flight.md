# Flight: CI/CD Supply-Chain Hardening

**Status**: landed
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [x] F17 — least-privilege top-level `permissions:` on both workflows
- [x] F18 — third-party actions SHA-pinned (non-GitHub action prioritized)
- [x] F19 — release job restricted to semver `v*` tags with gating
- [x] F16 — README auto-update **accepted as-is** (operator decision; recorded as an acknowledged tradeoff, not actioned — see Design Decisions)

> **Reconnaissance** (full report in [flight-log.md](flight-log.md)): all four source findings verified against current `main`. F17/F19 confirmed-live; F18 **scoped down** — the SHA-pinning half is live but the "add Dependabot for github-actions" half is **already satisfied** by `.github/dependabot.yml` (committed in Flight 3); F16 **retired by operator decision** as an accepted tradeoff. Two Flight-3 carry-forwards folded in: an audit-gate triage policy (CI surface) and a `farbling-correctness` behavior-test draft (off-surface, folded in by request).

---

## Pre-Flight

### Objective
Harden the GitHub Actions supply chain within the two workflow files: scope the workflow token to least privilege (F17), pin every third-party action to an immutable commit SHA (F18), and gate releases to strictly-validated semver `v*` tags (F19) — then prove the gated publish path with a live throwaway pre-release tag. Two Flight-3 carry-forwards ride along: a documented npm-audit false-positive triage policy, and a draft `farbling-correctness` behavior spec. The README auto-push (F16) is accepted as-is per operator decision.

### Open Questions
- [x] F16 — should the README auto-update keep pushing to `main`? → **Resolved**: yes, accepted as-is (operator decision; see Design Decisions). Even under branch protection this bot commit would be a sanctioned bypass.
- [x] F19 — gating strictness? → **Resolved**: strict semver + auto-publish (no draft).
- [x] How to verify the publish path? → **Resolved**: live throwaway pre-release tag, then delete.
- [x] Does the live test tag corrupt `main` via `update-readme`? → **Resolved**: gate `update-readme` to stable semver only (excludes prerelease tags) — fixes the test hazard and is independently correct.

### Design Decisions

**F16 — bot README push to `main` accepted as-is (won't action)**: The `update-readme` job's direct `git push origin HEAD:main` (`build.yml:112`) is retained.
- Rationale: The job's input is constrained to the README `DOWNLOADS` markers via a semver-validated version arg (low injection surface), and even if branch protection were enabled, an automated post-release docs commit by `github-actions[bot]` would be a sanctioned bypass exception rather than a reviewed change. The convenience of self-updating download links outweighs the unreviewed-write concern at this project stage.
- Trade-off: an automated default-branch write remains in the supply chain. Mitigated by F17 (the job keeps only the narrow `contents: write` it needs) and by the F19 stable-only gate (the push only fires for real releases).
- Disposition: mission criterion **F16 to be marked as an accepted tradeoff** (analogous to F14 unsigned builds / F20 branch protection), not as "met by code change." Confirm at mission update.

**F17 — top-level `contents: read`, per-job `contents: write` retained**: Add `permissions: contents: read` at the top of both `build.yml` and `ci.yml`. Keep the existing per-job `contents: write` on `release` and `update-readme` (both genuinely write). `ci.yml` needs no write at all (pure PR build-check).
- Rationale: least privilege — every job starts read-only and only the two publish jobs escalate.
- Trade-off: the repo-default-token-to-read-only toggle is a GitHub **Settings** action, not a file change; it is tracked as a manual checklist item (Prerequisites), not a leg deliverable. The in-file `permissions:` blocks are the durable, reviewable control regardless of the repo default.

**F18 — pin all `uses:` to 40-char SHAs in one pass**: Pin every `uses:` in both workflows (`checkout`, `setup-node`, `upload/download-artifact`, and the non-GitHub `softprops/action-gh-release`) to a full commit SHA with a `# vX.Y.Z` comment, prioritizing the non-GitHub action (it runs with `contents: write`).
- Rationale: `.github/dependabot.yml` already declares `package-ecosystem: github-actions` (Flight 3), so Dependabot will keep the pins current — this removes the staleness downside that normally argues against pinning everything at once.
- Trade-off: a one-time noisy diff; accepted because Dependabot maintenance amortizes it. **Do NOT re-add a Dependabot github-actions block** — it already exists.

**F19 — strict semver + auto-publish; gate `update-readme` to stable releases**: Tighten the `release` job from `startsWith(github.ref, 'refs/tags/')` to `refs/tags/v`, and add a step that fails the job unless `${GITHUB_REF_NAME}` matches a strict semver pattern before publishing. Keep auto-publish (no `draft: true`). Separately, gate the `update-readme` job to **stable** semver only.
- Rationale: the workflow already only *triggers* on `v*` push, so the genuine residual threat is a `v`-prefixed **non-semver** tag (`vtest`, `v1`, `vfoobar`) matching the glob; strict-semver validation closes it. Gating `update-readme` to stable releases makes the live-tag verification safe (a `v0.0.0-ci-test` prerelease won't push a bogus README to `main`) and is independently correct — README download links should never point at a prerelease.
- **Implementation note — the `update-readme` `if:` gate is the load-bearing control, not the script.** Architect review found `scripts/update-readme.mjs:7` validates with an **unanchored** regex (`/^\d+\.\d+\.\d+/`), so `0.0.0-ci-test` passes it — the script offers **zero** protection against a prerelease corrupting the README. The safety of the live-tag verification therefore rests entirely on the new workflow `if:` condition. Express it as a **positive strict-stable-semver match** (e.g. `github.ref_name` matches `^v[0-9]+\.[0-9]+\.[0-9]+$`), **not** a negative `!contains(ref_name, '-')` — the positive form also rejects malformed numerics, not just dash-bearing prereleases.
- **Belt-and-suspenders (one permitted source touch):** also anchor the `update-readme.mjs` regex to `/^\d+\.\d+\.\d+$/` so the script self-rejects a prerelease/garbage version even if the `if:` gate is ever loosened. This is the single, narrow exception to this flight's "workflows-only" scope — it is defense-in-depth for exactly the hazard this flight introduces (the live test tag). If the operator prefers to keep the flight strictly workflows-only, this anchor can be deferred to a micro-task; the `if:` gate alone is sufficient for the live test's safety.
- Trade-off: no draft/manual-promote gate (operator chose auto-publish); a rollback runbook was **de-selected** and is deferred. Recovery is the standard delete-release + delete-tag + re-tag, exercised explicitly by the verification leg.

**Verification — live throwaway pre-release tag**: Prove the gated path by pushing `v0.0.0-ci-test` (valid prerelease semver — passes strict validation, `npm version` accepts it at `build.yml:42`): build + release-as-prerelease run, `update-readme` is skipped (stable-only gate), then delete the release and tag. Also push an invalid `vtest` and confirm the release job rejects it (fails strict-semver validation; never publishes).
- **Blast radius (explicit):** the test tag triggers the full mac/win/linux build matrix (~3 min/runner of CI minutes) **and** creates a *real, public GitHub prerelease with uploaded installer artifacts* (`softprops … files: artifacts/**/*`, `build.yml:81`) on this public repo — transiently visible on the Releases feed. A semver prerelease does **not** move GitHub's "latest" pointer (verify during the run), so `latest`-release consumers are unaffected. Cleanup (delete the release **and** its artifacts **and** the tag for both `v0.0.0-ci-test` and `vtest`) is a **non-optional, immediate** step in the verify leg and the post-flight checklist.
- Fallback (Adaptation Criteria): if a public prerelease is unacceptable, switch to the `workflow_dispatch` / fork dry-run instead.

**Audit-gate triage policy (carry-forward, folded in)**: Document, at the CI audit step, how to handle a future `npm audit --audit-level=high` failure: distinguish a high in the dev-only dependency tree (e.g. electron-builder's) from a runtime `electron` high; the remediation is always to update the dependency, **never** to lower the gate.
- Rationale: Flight 3 flagged a foreseeable future false-positive; documenting the policy before the first occurrence prevents a panic gate-lowering.

**`farbling-correctness` behavior spec (carry-forward, folded in by request)**: Author a draft behavior spec verifying Goldfinch's fingerprint-farbling on the live app — authored as a flight artifact during planning (`tests/behavior/farbling-correctness.md`).
- Apparatus (premise-audited, both axes): chrome-devtools MCP attached to `:9222` (via `npm run dev:debug`), targeting the **webview guest** frame.
  - *Act*: a fixture page draws a canvas and reads `navigator` fingerprint surfaces; the apparatus loads it in a Shields-farbling jar and drives reads via `evaluate_script` in the guest — the same attach path proven by `tab-scheme-guard`.
  - *Observe*: the assertion reads `navigator.hardwareConcurrency`, `navigator.deviceMemory`, and `canvas.toDataURL()` directly as JS return values via CDP `Runtime.evaluate` in the guest — no test-only seam needed. Read path verified against the implementation: spoofs and noise are installed at document-start in `src/preload/webview-preload.js` (`navigator.hardwareConcurrency`/`deviceMemory → 8` at L325/L330; canvas `getImageData`/`toDataURL`/`toBlob` noised at L262-292), gated by `ipcRenderer.sendSync('shields-farble', …)` at L231.
- Disposition: authored as **draft**; **running/promoting it is deferred** (it is not an acceptance gate for *this* CI flight — it is off-surface, and a live run carries its own crew prerequisite of multi-turn sub-agent continuation). Recommended to run via `/behavior-test farbling-correctness` before the next Electron major upgrade.
- Note: the Flight-3 debrief sketch named `navigator.userAgent` as the spoofed surface; the actual implementation spoofs `hardwareConcurrency`/`deviceMemory` (no UA spoof found) — the spec is authored against the real code.

### Prerequisites
- [ ] Repo write access and an authenticated `gh` CLI (or web UI) to push/delete the verification tag and inspect Actions runs.
- [ ] Operator decision on whether to also set the **repo default workflow token to read-only** in GitHub Settings → Actions (complements F17's in-file blocks; manual, optional).
- [ ] (Deferred farbling run only — not gating this flight) live app via `npm run dev:debug` + chrome-devtools MCP + a session with multi-turn sub-agent continuation for the Executor/Validator crew.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified (`gh` auth / repo write confirmed before the verify leg)
- [x] Validation approach defined (live pre-release tag + static review; farbling spec drafted)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Code changes are confined to `.github/workflows/build.yml` and `.github/workflows/ci.yml`, plus one short policy doc and one new behavior-spec artifact — and the single permitted source touch noted in the F19 decision (anchoring `scripts/update-readme.mjs`'s version regex). No other application source is touched. Order legs so the cheap, independent file edits land first and the live-tag verification runs last against the fully-hardened workflows.

- **F17 — token least-privilege.** Add `permissions: contents: read` at the top of both workflows; retain per-job `contents: write` on `release` (`build.yml:70-71`) and `update-readme` (`build.yml:91-92`). `ci.yml` gets read-only with no per-job escalation (it is a pure `pull_request` build-check, no write actions).
- **F18 — SHA-pin actions.** Replace every mutable `@vN` tag with a 40-char commit SHA + `# vX.Y.Z` comment across both files (8 `uses:` total); prioritize `softprops/action-gh-release` (non-GitHub, `contents: write`). Dependabot (already configured) maintains the pins. **Bundled (shared `ci.yml`/workflow surface):** document the npm-audit triage policy at the `ci.yml` audit step.
- **F19 — release gating.** Tighten the `release` `if` to `startsWith(github.ref, 'refs/tags/v')`, add a strict-semver validation step (fail on non-semver `v*`), add a positive strict-stable-semver condition to `update-readme` (skip prerelease tags), and anchor the `update-readme.mjs` regex as belt-and-suspenders.
- **farbling-correctness spec.** Drafted as a flight artifact (run deferred).
- **Verification.** Push `v0.0.0-ci-test` (valid prerelease) → expect build + prerelease publish, no README push; push `vtest` (invalid) → expect release job rejected. Delete tag(s) + release(s) + artifacts afterward (non-optional).

### Checkpoints
- [x] Both workflows declare top-level `permissions: contents: read` (F17); all 8 `uses:` SHA-pinned (F18); audit-gate triage policy documented
- [x] `release` gated to validated semver `v*` (F19); `update-readme` runs only for stable semver; `update-readme.mjs` regex anchored
- [x] `farbling-correctness` draft spec written
- [x] Live `v0.0.0-ci-test` exercises the gated publish path (and `vtest` is rejected); test tag + release + artifacts cleaned up

### Adaptation Criteria

**Divert if**:
- The strict-semver gate or the `update-readme` stable-only condition can't be expressed cleanly in workflow `if:`/step logic and needs a redesign of the publish sequence.
- The live test tag cannot be safely isolated from a real publish (e.g. external listeners on the Releases feed) — fall back to a fork / `workflow_dispatch` dry-run for verification.

**Acceptable variations**:
- Pinning only the non-GitHub `action-gh-release` to SHA first if pinning all actions at once proves too noisy in review, with the GitHub-owned actions tracked via the existing Dependabot.
- Folding the audit-triage-policy doc into whichever CI/maintenance doc location the project prefers (comment vs. standalone note).

### Legs

> **Note:** Tentative; planned and created one at a time as the flight progresses.

- [x] `workflow-token-permissions` - F17: top-level `contents: read` on both workflows; retain per-job writes
- [x] `sha-pin-actions` - F18: pin all 8 `uses:` to 40-char SHAs (prioritize the non-GitHub action) + document npm-audit triage policy at the `ci.yml` audit step (bundled — shared `ci.yml`/workflow surface)
- [x] `release-gating` - F19: strict-semver gate + validation step; positive stable-semver gate on `update-readme`; anchor `update-readme.mjs` regex
- [x] `verify-release-pipeline` - live `v0.0.0-ci-test` exercise + invalid-tag (`vtest`) rejection + non-optional cleanup (integration/verify leg)

> `farbling-correctness` behavior spec is authored as a flight artifact during planning (`tests/behavior/farbling-correctness.md`); its run/promotion is deferred (recommended before the next Electron major). Optional HAT/alignment leg omitted — the `verify-release-pipeline` leg already provides hands-on confirmation; add one if desired.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged (PR #16 draft → marked ready for review; merges after review)
- [x] A live `v0.0.0-ci-test` tag exercised the gated publish path successfully; an invalid `vtest` was rejected; **test tag + release + uploaded artifacts deleted** (both tags)
- [x] Mission criteria F17/F18/F19 checked off; **F16 recorded as accepted tradeoff** (not "met by change")

### Verification
Both workflows declare top-level least-privilege `permissions:`; every `uses:` resolves to a 40-char commit SHA with a version comment; the `release` job fires only on strictly-validated semver `v*` tags and rejects `v`-prefixed non-semver tags; `update-readme` runs only for stable releases (skips prereleases). Confirmed live by pushing `v0.0.0-ci-test` (built + published as a prerelease, no README push to `main`) and `vtest` (release rejected), both cleaned up afterward. The npm-audit triage policy is documented at the CI audit step, and a draft `farbling-correctness` behavior spec exists for pre-upgrade fingerprint-farbling verification.
