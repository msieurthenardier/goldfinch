# Squawk 0113: Document the Windows-HAT-via-prerelease-tag path

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report
Sortie 01's Windows HAT used prerelease tags (`v0.18.0-rc.1`, `rc.2`) to get an NSIS installer built by `build.yml`, because WSL can't build NSIS and a manual `workflow_dispatch` run publishes nothing (no artifact upload). The path worked but isn't documented: tag naming, what the workflow publishes (a GitHub prerelease, not "latest"), and cleanup.

## Evidence
`.github/workflows/build.yml` — dispatch = `--publish never`, tag = `--publish always` (prerelease for a semver prerelease tag). `docs/RELEASING.md` has no prerelease section. Sortie 01 flight debrief, Recommendation 2.

## Corrective Action
Added a "Windows HAT build (prerelease tag)" section to `docs/RELEASING.md` (before Notes): why dispatch yields no installer, the `vX.Y.Z-rc.N` tag/push recipe (next release's version, bump N per re-check, no bump commit), downloading the `Goldfinch-Setup-…exe` from the prerelease page, cleanup (`gh release delete … --yes --cleanup-tag` + `git tag -d`), and the public/outward-facing caveat.

## Verification
Claims checked against `.github/workflows/build.yml`: triggers (`workflow_dispatch`, `v*` tags); `--publish` is `always` on tag and `never` on dispatch; "Set version from tag" runs `npm version --no-git-tag-version` from the tag; `create-release` classifies a `-` prerelease as `is_stable=false` and `publish-release` sets `--prerelease=true` (no `--latest`). `npm run format` then `npm run format:check` green.

## Sign-Off
**Reviewer**: independent Reviewer agent (batch review scoped to the diff; `npm test` 5749 pass / 0 fail, lint, typecheck, format:check clean)
**Verdict**: confirmed
**Commit**: the `squawk: turnaround 2026-09-29` commit on `squawk/turnaround-2026-09-29-2`

## Disposition
*(Deferred at logging during Sortie 01; completed in the same-day turnaround.)*