# Flight: Release Integrity

**Status**: ready
**Mission**: [Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] A release cannot be built from a commit that fails the audit or fuse gate.
- [ ] Dependabot cannot quietly regress SHA pinning, and the runtime is on the current Electron 45 patch.

---

## Pre-Flight

### Objective

Make a release see its own gate. Today `build.yml` assumes the local Concourse `ci` job passed for the tagged commit. For v0.19.16–.18 that assumption was false: the `npm audit --audit-level=high` gate has failed since 2026-10-19 and nobody noticed. This flight makes the release build run the audit gate itself, alongside the fuse check it already runs, and pins that in the workflow invariants test. It also records the Dependabot re-pin rule where Dependabot's PRs come from, and takes the Electron 45.3.4 patch.

### Open Questions

- [x] **Merging the audit step blocks releases until `picomatch` is patched.** Operator ruling 2026-11-18: **hold the leg**. Fly `dependabot-repin-note` and `electron-45-3-4`; build `release-runs-audit` to ready but do not merge it until a patched `picomatch` is released (then take the normal bump in the same leg).

### Design Decisions

**The build job runs `npm audit --audit-level=high`; `check-fuses` stays where it is**: operator ruling 2026-11-18 (report decision 2, option B).
- Rationale: the build job already runs project code (`npm ci`, electron-builder) with `contents: read` and no token, so an audit step adds no privilege. `check-fuses` already runs per platform after packing (`build.yml`, the `Check runtime fuses` step), so only audit is missing.
- Trade-off: the release now fails on any high advisory in a dev dependency, including ones with no patch (the current state).

**The audit gate is not lowered**: operator ruling 2026-11-18 (report decision 1, option B, wait for upstream). No `overrides` pin outside a declared range and no allowlist.

### Prerequisites

- [x] Release-blocking consequence ruled on: hold `release-runs-audit` until `picomatch` is patched.
- [ ] `fly -t local-goldfinch` authorized, so the leg can record what Concourse `ci` has shown since 2026-10-19.

### Pre-Flight Checklist

- [x] All open questions resolved: N/A for design (maintenance flight); the one open item is a merge-time confirmation.
- [x] Design decisions documented
- [ ] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

- **Finding #1 / #16: the release runs the audit gate.**
  - **Evidence:**
    - `grep` of `.github/workflows/build.yml` finds no `npm audit`, `npm test`, `typecheck` or `format:check`.
    - The advisory was published 2026-10-19 with range `picomatch <= 4.0.7`; 4.0.7 is the latest version.
    - `git show v0.19.16:package-lock.json` and `v0.19.18` both carry `picomatch` 4.0.7.
    - Concourse `ci` runs `audit` inside `in_parallel` (`ci/pipeline.yml`), so `package-linux` and its `check-fuses` are skipped when it fails.
  - **Fix:** add one `npm audit --audit-level=high` step to the `build` job after `npm ci`. Run it once, not per platform: either a guard on the Linux matrix entry, or a small `gate` job that `build` needs. Choose whichever keeps `contents: read`, `persist-credentials: false` and no secrets.
  - **Pins:** extend `test/unit/release-workflow-invariants.test.js` so the audit step must exist, must run before any installer is staged, and must not carry `continue-on-error` or `|| true`. Also pin that `check-fuses` still runs on every platform.
  - **Docs:** `docs/RELEASING.md` (what the release now checks), and the CLAUDE.md *Release / CI* paragraph.
  - Architect: Action Required.
- **Finding #14: Dependabot re-pin note.**
  - **Evidence:** `.github/dependabot.yml`, the github-actions block, has no note. The SHA-pin invariant (`release-workflow-invariants.test.js`, the `uses:` check) runs only on Concourse after a merge to main.
  - **Fix:** a comment in `dependabot.yml` stating that every action bump must be re-pinned to the new version's commit SHA with a `# vX.Y.Z` comment, pointing at CLAUDE.md. Optionally pin that the comment exists. A comment is cheap and survives.
- **Finding #9: Electron 45.3.4.**
  - **Evidence:** `npm outdated`: `electron` 45.3.3 → 45.3.4.
  - **Fix:** bump it. Per CLAUDE.md *App database*, every Electron bump re-runs the full store suite and the `third-party-cookie-isolation` behavior spec. A patch bump that drops the `enable-features` name would make isolation fail open.

### Checkpoints

- [ ] Concourse `ci` history since 2026-10-19 recorded in the flight log.
- [ ] `build.yml` audit step pinned by the invariants test; a manual `workflow_dispatch` run shows it failing on today's advisory (expected while upstream is unpatched).
- [ ] Electron 45.3.4 with the store suite and `third-party-cookie-isolation` re-run.

### Adaptation Criteria

**Divert if**:
- A patched `picomatch` ships mid-flight. Take the normal bump in leg `release-runs-audit`; the gate then goes green and the release-blocking question disappears.
- The operator revisits the audit-gate ruling. The `node-gyp` 11.1.0 override analysis is in the maintenance report.

**Acceptable variations**:
- Where the single audit step lives (a guarded matrix step or a separate `gate` job).
- Adding `npm test` to the same gate step, if the operator asks.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [ ] `release-runs-audit` - `build.yml` runs `npm audit --audit-level=high` once before staging; invariants test extended; RELEASING.md and CLAUDE.md updated; Concourse history recorded.
- [ ] `dependabot-repin-note` - Re-pin rule recorded in `.github/dependabot.yml`.
- [ ] `electron-45-3-4` - Electron patch bump with the store suite and the isolation behavior spec re-run.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification

- A manual `workflow_dispatch` run of `build.yml` fails at the audit step while GHSA-fc5q-39xc-vjpf is unpatched, and passes it once fixed.
- `release-workflow-invariants.test.js` fails if the audit step is removed, or is made non-fatal (neuter-verified).
- `electron --version` in a dev launch reads 45.3.4, and the isolation spec passes.
