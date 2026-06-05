# Leg: sha-pin-actions

**Status**: completed
**Flight**: [CI/CD Supply-Chain Hardening](../flight.md)

## Objective
Pin every `uses:` in both workflows to an immutable 40-char commit SHA with a `# vX.Y.Z` version comment (F18), prioritizing the non-GitHub `softprops/action-gh-release`; and document the npm-audit false-positive triage policy at the `ci.yml` audit step (bundled — shared `ci.yml`/workflow surface).

## Context
- Flight Design Decision **F18**: pin all `uses:` in one pass. `.github/dependabot.yml` already has `package-ecosystem: github-actions` (Flight 3), so Dependabot will keep these SHA pins current — **do NOT re-add a Dependabot github-actions block.**
- The non-GitHub `softprops/action-gh-release` runs in the `release` job with `contents: write` — highest-priority pin.
- Bundled carry-forward (Flight 3 debrief): the `--audit-level=high` CI gate could one day red-build on a *dev-only-tree* transitive high (e.g. electron-builder's chain) that isn't a shipped-runtime risk. Document the triage policy now, before the first false positive.
- **SHAs are pre-resolved by the Flight Director** (below) against each action's latest stable tag — apply them verbatim; no network lookup required.

## Inputs
- `.github/workflows/build.yml` — after Leg 01, top-level `permissions:` at L13-16; `uses:` directives on mutable major tags.
- `.github/workflows/ci.yml` — after Leg 01, top-level `permissions:` at L16-17; `uses:` on mutable tags; a "Dependency audit" step running `npm audit --audit-level=high`.

## Outputs
- Both workflows with every `uses:` pinned to a 40-char SHA + `# vX.Y.Z` comment.
- A triage-policy comment block above the `ci.yml` Dependency audit step.

## Pre-resolved SHA pins (apply verbatim)

| Action | Pin |
|--------|-----|
| `actions/checkout` | `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1` |
| `actions/setup-node` | `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0` |
| `actions/upload-artifact` | `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2` |
| `actions/download-artifact` | `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0` |
| `softprops/action-gh-release` | `softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2.6.2` |

## Acceptance Criteria
- [x] Every `uses:` in `build.yml` is pinned to its 40-char SHA + `# vX.Y.Z` comment per the table: `checkout` (build job **and** update-readme job — 2 occurrences), `setup-node`, `upload-artifact`, `download-artifact`, `action-gh-release`.
- [x] Every `uses:` in `ci.yml` is pinned per the table: `checkout` and `setup-node` (2 `uses:` total, one each).
- [x] No `uses:` anywhere in either file still references a mutable `@vN` / `@vN.N` tag (i.e., no `uses:` line lacks a 40-char SHA).
- [x] Each pinned line carries a trailing `# vX.Y.Z` comment matching the table (so a human/Dependabot can read the intended version).
- [x] A triage-policy comment block is present above the `ci.yml` "Dependency audit" step, stating: a high in the **dev-only dependency tree** (e.g. electron-builder's transitive chain) is distinct from a high in **runtime `electron`**; the remediation is always to **update the dependency**, never to lower the `--audit-level` gate or remove the step.
- [x] Both files remain valid YAML / valid Actions workflow syntax.
- [x] `.github/dependabot.yml` is unchanged (the github-actions ecosystem block already exists; do not duplicate it).

## Verification Steps
- `grep -nE "uses:" .github/workflows/build.yml .github/workflows/ci.yml` → every line includes an `@<40-hex>` SHA; none ends in a bare `@vN`.
- `grep -cE "uses:.*@[0-9a-f]{40}" .github/workflows/build.yml` → 6 (checkout×2, setup-node, upload-artifact, download-artifact, action-gh-release).
- `grep -cE "uses:.*@[0-9a-f]{40}" .github/workflows/ci.yml` → 2 (checkout, setup-node).
- Confirm no unpinned remain: `grep -nE "uses:.*@v[0-9]" .github/workflows/*.yml` → no output.
- YAML parse both files (js-yaml@4 via node, or `python3 -c "import yaml; yaml.safe_load(open('FILE'))"`) → no error.
- `git diff .github/dependabot.yml` → empty (untouched).
- Confirm the audit-triage comment exists: `grep -n "audit-level\|dev-only\|never lower" .github/workflows/ci.yml`.

## Implementation Guidance

1. **Pin `build.yml`.** Replace each `uses:` with the pinned form from the table. Locate by action name (line numbers may have shifted after Leg 01), not by absolute line. Six occurrences: `actions/checkout` appears twice (the `build` job and the `update-readme` job) — pin both. Preserve any `with:` blocks beneath each `uses:` unchanged.
2. **Pin `ci.yml`.** Replace `actions/checkout` and `actions/setup-node` `uses:` with the pinned forms. Preserve the `with:` blocks.
3. **Add the audit-triage comment** immediately above the `- name: Dependency audit` step in `ci.yml`:
   ```yaml
   # Audit-gate triage policy: a high here is actionable ONLY by updating the
   # offending dependency — never by lowering --audit-level or deleting this step.
   # Distinguish a high in the dev-only tree (e.g. electron-builder's transitive
   # chain: tar/cacache/node-gyp — build-time only, not shipped) from a high in
   # runtime `electron` itself (shipped, hostile-content-reachable). Both are fixed
   # by bumping the dep (Dependabot surfaces these); the gate stays at high.
   ```
4. **Validate** with the verification steps. Do NOT modify `.github/dependabot.yml`.

## Edge Cases
- **Two `checkout` occurrences in `build.yml`** (build job + update-readme job) — both must be pinned; easy to miss the second.
- **Preserve `with:` blocks** — e.g. `setup-node` has `node-version`/`cache`; `checkout` in update-readme has `ref: main`; `upload-artifact`/`download-artifact` have `name`/`path`; `softprops/action-gh-release` (the priority pin) has `files`/`generate_release_notes`. Only the `uses:` line changes.
- **Comment style** — the trailing `# vX.Y.Z` must be on the same line as the `uses:` SHA (GitHub/Dependabot convention) so Dependabot can bump it.
- **Do not "helpfully" upgrade** the action major versions or change `with:` inputs — pin the current major's latest stable SHA as given; behavior must not change.

## Files Affected
- `.github/workflows/build.yml` — pin 6 `uses:`.
- `.github/workflows/ci.yml` — pin 2 `uses:` + add audit-triage comment.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (N/A — workflow syntax validation instead)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred to flight level)
- [ ] Check off this leg in flight.md (deferred to flight-level commit)
- [ ] Commit handled at flight level (deferred review+commit per agentic-workflow)
