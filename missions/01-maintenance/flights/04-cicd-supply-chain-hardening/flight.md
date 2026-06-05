# Flight: CI/CD Supply-Chain Hardening

**Status**: ready
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [ ] F17 — least-privilege top-level `permissions:` on both workflows
- [ ] F16 — README auto-update no longer pushes to `main` unreviewed
- [ ] F18 — third-party actions SHA-pinned (non-GitHub action prioritized)
- [ ] F19 — release job restricted to semver `v*` tags with gating

---

## Pre-Flight

### Objective
Harden the GitHub Actions supply chain: scope the workflow token to least privilege, remove the unreviewed push to `main`, pin third-party actions to immutable SHAs, and gate releases to validated semver tags — all within the two workflow files.

### Open Questions
N/A.

### Design Decisions
N/A — deferred to leg design.

### Prerequisites
- [ ] N/A

### Pre-Flight Checklist
- [ ] N/A — maintenance flight, Pre-Flight skipped

---

## In-Flight

### Technical Approach

One finding maps to one leg.

- **F17 — token least-privilege (Action Required).** Neither `build.yml` nor `ci.yml` declares a top-level `permissions:`; the `build` job and all of `ci.yml` inherit the repo default token scope. **Fix:** add `permissions: contents: read` at the top of both files; keep per-job `contents: write` on `release`/`update-readme`. Also set the repo default workflow token to read-only in Settings.
- **F16 — unreviewed push to `main` (Advisory).** `build.yml:86-113` `update-readme` job pushes to `main` as `github-actions[bot]` (`contents:write`), bypassing PR. Input is constrained to the `DOWNLOADS` markers via a semver regex, so injection risk is low; the exposure is an unreviewed default-branch write. **Fix:** open a PR for the README change (or move it behind a protected environment) instead of pushing directly.
- **F18 — unpinned actions (Advisory).** All `uses:` reference mutable major tags (`checkout@v4`, `setup-node@v4`, `upload/download-artifact@v4`, and notably the non-GitHub `softprops/action-gh-release@v2` running with `contents:write`). **Fix:** pin to full 40-char commit SHAs with a version comment; prioritize the non-GitHub action; add Dependabot (`package-ecosystem: github-actions`) to bump pins.
- **F19 — release tag gating (Advisory).** The `release` job condition is only `startsWith(github.ref, 'refs/tags/')` (not `v*`), with `generate_release_notes` and no semver/draft gating; a malformed tag could publish a public release. **Fix:** tighten to `refs/tags/v`, validate strict semver before publishing, consider `draft: true` with a manual promote, and document a rollback runbook (delete release + tag, re-tag).

### Checkpoints
- [ ] `permissions:` blocks added (F17); release gating tightened (F19)
- [ ] Actions SHA-pinned (F18); README update no longer pushes to `main` unreviewed (F16)

### Adaptation Criteria

**Divert if**:
- Moving the README update to a PR flow conflicts with the release sequence and needs a redesign of the publish pipeline.

**Acceptable variations**:
- Pinning only the non-GitHub action to SHA first if pinning all actions at once is too noisy, with the rest tracked via Dependabot.

### Legs

> Tentative.

- [ ] `workflow-token-permissions` - F17
- [ ] `release-tag-gating` - F19
- [ ] `sha-pin-actions` - F18
- [ ] `readme-update-via-pr` - F16

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] A test release/tag exercises the gated publish path successfully

### Verification
Both workflows declare least-privilege `permissions:`; actions are SHA-pinned; the release job only fires on validated semver `v*` tags; the README auto-update reaches `main` through review rather than a direct bot push.
