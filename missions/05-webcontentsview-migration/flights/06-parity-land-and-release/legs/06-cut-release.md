# Leg: cut-release

**Status**: completed
**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](../flight.md)

## Objective
Cut the v0.6.0 release — all installers, via the tag-driven GitHub Actions path.

## Done (2026-07-09, operator-gated)
- Tagged `v0.6.0` on `761aec0`, pushed → release run `29027676740` **all 6 jobs success** (create-release,
  build linux/mac/win, publish-release, update-readme).
- **v0.6.0 PUBLISHED** (stable, not draft/prerelease) with installers: **mac** `Goldfinch-0.6.0-arm64.dmg` +
  `-arm64-mac.zip` (Apple Silicon), **win** `Goldfinch-Setup-0.6.0.exe`, **linux** `Goldfinch-0.6.0.AppImage` +
  `goldfinch_0.6.0_amd64.deb`, + auto-update `latest*.yml`.
- Release body set from `v0.6.0-release-notes.md` (unsigned-mac disclosure). The repo is PRIVATE → the release
  is collaborator-only (release visibility follows repo visibility), not world-visible.
- `update-readme` job auto-committed download links to `main` (`609c3e4`, DD11-expected); local `main` fast-forwarded.

## Follow-up (→ debrief)
- mac build is **arm64-only** (macos-latest default); no Intel/x64 mac. Config follow-up if x64 mac is wanted.

## Acceptance
- [x] v0.6.0 published with all installers; notes set; `gh release view v0.6.0` confirms 5 installer assets.
