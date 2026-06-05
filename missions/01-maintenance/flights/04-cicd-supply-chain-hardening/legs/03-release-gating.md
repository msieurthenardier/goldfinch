# Leg: release-gating

**Status**: completed
**Flight**: [CI/CD Supply-Chain Hardening](../flight.md)

## Objective
Gate the `release` job to strictly-validated semver `v*` tags and gate `update-readme` to **stable** releases only (F19): tighten the `release` condition, add a strict-semver validation+classify step, mark prereleases explicitly, gate `update-readme` on a stable-release job output, and anchor the `update-readme.mjs` version regex as belt-and-suspenders.

## Context
- Flight Design Decision **F19**: the workflow already only *triggers* on `v*` push, so the residual threat is a `v`-prefixed **non-semver** tag (`vtest`, `v1`, `vfoobar`). Strict-semver validation closes it; auto-publish is kept (no `draft:`).
- The `update-readme` job pushes to `main` (accepted F16). Gating it to **stable** releases makes the Leg-04 live `v0.0.0-ci-test` test safe (a prerelease won't push a bogus README) and is independently correct (README links shouldn't point at a prerelease).
- **The `update-readme` `if:` gate is the load-bearing control** — `scripts/update-readme.mjs:7` validates with an *unanchored* `/^\d+\.\d+\.\d+/`, so `0.0.0-ci-test` passes it today (zero script-side protection). Anchoring the regex is defense-in-depth; the workflow gate is primary.
- This leg includes the **single permitted source touch** of the flight (the `update-readme.mjs` anchor).

## Inputs
- `.github/workflows/build.yml` (post Legs 01–02): `release` job `if: startsWith(github.ref, 'refs/tags/')`, `permissions: contents: write`, steps = download-artifact + create-release (action-gh-release pinned). `update-readme` job `if: startsWith(github.ref, 'refs/tags/v')`, `needs: release`.
- `scripts/update-readme.mjs`: version guard at line 7 is `/^\d+\.\d+\.\d+/` (unanchored).

## Outputs
- `release` job: condition tightened to `refs/tags/v`; a first **validate+classify** step; a job output `is_stable`; the create-release step explicitly marks prereleases.
- `update-readme` job: gated on `needs.release.outputs.is_stable == 'true'`.
- `scripts/update-readme.mjs`: version regex anchored to `$`.

## Acceptance Criteria
- [x] The `release` job `if:` is `startsWith(github.ref, 'refs/tags/v')` (was `refs/tags/`).
- [x] The `release` job declares `outputs: is_stable: ${{ steps.ver.outputs.is_stable }}` and has a first step `id: ver` that: strips the leading `v`, fails the job (`exit 1`, with a `::error::`) if the version is not strict semver, and otherwise writes `is_stable=true|false` to `$GITHUB_OUTPUT` (false when the version carries a prerelease identifier).
- [x] The validate step runs **before** download-artifact / create-release (so a bad tag never publishes).
- [x] The create-release step (`softprops/action-gh-release`) sets `prerelease: ${{ steps.ver.outputs.is_stable != 'true' }}` so a prerelease tag is flagged as a GitHub prerelease (and does not move the `latest` pointer).
- [x] The `update-readme` job `if:` is `needs.release.outputs.is_stable == 'true'` (it already `needs: release`); the direct `refs/tags/v` condition is replaced.
- [x] `scripts/update-readme.mjs` line 7 regex is anchored: `/^\d+\.\d+\.\d+$/` (rejects prerelease/garbage versions).
- [x] `build.yml` remains valid YAML / valid Actions syntax; `node --check scripts/update-readme.mjs` passes.
- [x] Static regex behavior confirmed (see Verification): `v1.2.3` → valid+stable; `v0.0.0-ci-test` → valid+prerelease; `vtest`/`v1`/`v1.2` → invalid (would not publish — see the rejection-path note in Edge Cases for *which* job catches them).

## Verification Steps
- `grep -n "refs/tags/v" .github/workflows/build.yml` → the `release` `if` now uses `refs/tags/v`; `grep -n "needs.release.outputs.is_stable" .github/workflows/build.yml` → present on `update-readme`.
- `grep -n "is_stable" .github/workflows/build.yml` → appears in the job `outputs:`, the validate step, the `prerelease:` input, and the `update-readme` `if:`.
- YAML parse `build.yml` (js-yaml@4 via node, or `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))"`).
- `node --check scripts/update-readme.mjs` → no error; `grep -n "\\^\\\\d+\\.\\\\d+\\.\\\\d+\\$" scripts/update-readme.mjs` → anchored regex present.
- **Test the semver bash regex offline** against sample tags — extract the exact ERE used in the validate step and confirm:
  - `v1.2.3` → matches, stable (no `-`)
  - `v0.0.0-ci-test` → matches, prerelease (`-` present)
  - `vtest`, `v1`, `v1.2`, `vfoobar` → do NOT match (job would `exit 1`)
  Example: `ver="${t#v}"; [[ "$ver" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] && echo match || echo no` for each.
- **Test the JS regex offline**: `node -e "for(const v of ['0.0.0-ci-test','1.2.3','test']) console.log(v, /^\d+\.\d+\.\d+$/.test(v))"` → `0.0.0-ci-test false`, `1.2.3 true`, `test false`.

## Implementation Guidance

1. **`release` job — tighten condition + add validate/classify + outputs.** In `.github/workflows/build.yml`, change the `release` job `if:` to `startsWith(github.ref, 'refs/tags/v')`, add an `outputs:` map, and insert a validate step as the FIRST step:
   ```yaml
   release:
     name: Publish release
     if: startsWith(github.ref, 'refs/tags/v')
     needs: build
     runs-on: ubuntu-latest
     permissions:
       contents: write
     outputs:
       is_stable: ${{ steps.ver.outputs.is_stable }}
     steps:
       - name: Validate semver tag and classify stability
         id: ver
         shell: bash
         run: |
           tag="${GITHUB_REF_NAME}"
           ver="${tag#v}"
           semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
           if [[ ! "$ver" =~ $semver ]]; then
             echo "::error::Tag '$tag' is not strict semver (vMAJOR.MINOR.PATCH[-prerelease][+build]); refusing to publish."
             exit 1
           fi
           core="${ver%%+*}"
           if [[ "$core" == *-* ]]; then
             echo "is_stable=false" >> "$GITHUB_OUTPUT"
             echo "Validated '$tag' as a PRERELEASE ($ver)."
           else
             echo "is_stable=true" >> "$GITHUB_OUTPUT"
             echo "Validated '$tag' as a STABLE release ($ver)."
           fi
       # existing steps below, unchanged except the prerelease input:
       - name: Download all installers
         uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
         with:
           path: artifacts
       - name: Create GitHub Release
         uses: softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2.6.2
         with:
           files: artifacts/**/*
           generate_release_notes: true
           prerelease: ${{ steps.ver.outputs.is_stable != 'true' }}
   ```
   Keep the existing download-artifact / create-release SHA pins exactly as they are now (do not re-pin or change them).

2. **`update-readme` job — gate on stable output.** Replace its `if:` with the stable-release gate (it already has `needs: release`):
   ```yaml
   update-readme:
     name: Update README download links
     if: ${{ needs.release.outputs.is_stable == 'true' }}
     needs: release
     ...
   ```
   Leave the rest of the job (checkout `ref: main`, regenerate, commit/push) unchanged.

3. **Anchor the script regex.** In `scripts/update-readme.mjs`, change line 7 from `if (!/^\d+\.\d+\.\d+/.test(version)) {` to `if (!/^\d+\.\d+\.\d+$/.test(version)) {`. Nothing else in the script changes.

4. **Validate** with the verification steps (YAML parse, `node --check`, offline regex tests).

## Edge Cases
- **Rejection path — which job catches a malformed `v` tag (important nuance).** The `build` job's `set version from tag` step (`build.yml`) runs `npm version --no-git-tag-version "${GITHUB_REF_NAME#v}"` on *any* `refs/tags/v` tag, and `build` runs *before* `release` (`release needs: build`). So a non-semver tag like `vtest`/`v1` is rejected **first by `npm version`** (exit 1 → the build matrix goes red with a generic npm error), and the `release` job's validate step *never runs* for it. The end state is still correct and safe (nothing publishes; `update-readme` skipped because its `needs` chain failed). Therefore the release validate step's `::error::…refusing to publish` message only ever fires for the narrow band of tags that **pass `npm version` but fail strict semver**, and its load-bearing unique value is the **stable/prerelease classification** (`is_stable`) that drives the `update-readme` gate. (Considered and deferred: duplicating a strict-semver guard into the build job's version step for a cleaner fail-fast message — left out to avoid regex duplication across a 3-OS matrix job; `npm version` already fails-fast on garbage, just less prettily.)
- **Build metadata with a dash** (`1.2.3+exp-1`): stripping build metadata (`${ver%%+*}`) before the `-` check prevents a build-metadata dash from being misread as a prerelease. (Already handled by `core="${ver%%+*}"`.)
- **`update-readme` skipped vs failed**: when the tag is a prerelease, `is_stable=false` → `update-readme` is *skipped* (not failed) — correct; the release still publishes as a prerelease.
- **`update-readme` `if:` must NOT gain `always()`.** The gate `needs.release.outputs.is_stable == 'true'` carries an implicit `success()` over `needs`, so a skipped/failed `release` correctly skips `update-readme`. Adding `always()`/`!cancelled()` to this job in a future edit would make the gate evaluate against a failed/empty output and could mis-fire — the omission is deliberate and load-bearing.
- **`prerelease:` boolean coercion**: `${{ steps.ver.outputs.is_stable != 'true' }}` yields the string `true`/`false`; `action-gh-release` accepts it. For a stable release `is_stable=true` → `prerelease=false`.
- **Do not add `draft:`** — operator chose auto-publish.

## Files Affected
- `.github/workflows/build.yml` — `release` condition + validate/classify step + `outputs` + `prerelease:` input; `update-readme` `if:`.
- `scripts/update-readme.mjs` — anchor the version regex (the flight's single permitted source touch).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (offline regex tests + YAML parse + `node --check`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred to flight level)
- [ ] Check off this leg in flight.md (deferred to flight-level commit)
- [ ] Commit handled at flight level (deferred review+commit per agentic-workflow)
