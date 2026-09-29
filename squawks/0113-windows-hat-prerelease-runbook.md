# Squawk 0113: Document the Windows-HAT-via-prerelease-tag path

**Status**: deferred
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: —

## Report
Sortie 01's Windows HAT used prerelease tags (`v0.18.0-rc.1`, `rc.2`) to get an NSIS installer built by `build.yml`, because WSL can't build NSIS and a manual `workflow_dispatch` run publishes nothing (no artifact upload). The path worked but isn't documented: tag naming, what the workflow publishes (a GitHub prerelease, not "latest"), and cleanup.

## Evidence
`.github/workflows/build.yml` — dispatch = `--publish never`, tag = `--publish always` (prerelease for a semver prerelease tag). `docs/RELEASING.md` has no prerelease section. Sortie 01 flight debrief, Recommendation 2.

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: doc-only — revisit at the next squawk turnaround or before the next Windows-only HAT (add a short "Windows HAT build" section to `docs/RELEASING.md`: `vX.Y.Z-rc.N` on the flight branch commit, installer from the prerelease page, `gh release delete <tag> --yes --cleanup-tag` afterwards).
