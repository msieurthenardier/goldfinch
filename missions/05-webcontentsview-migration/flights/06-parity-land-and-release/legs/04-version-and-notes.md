# Leg: version-and-notes

**Status**: landed
**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](../flight.md)

## Objective
Bump the version to 0.6.0 and author the v0.6.0 release notes, so the release sequence has a clean, disclosed body.

## Done (2026-07-08)
- **`package.json` 0.5.7 → 0.6.0** (minor — the WebContentsView migration, DD4).
- **Pre-tag check (DD11):** the bump (`0.6.0`) equals the intended tag (`v0.6.0`) — no silent tag-wins mismatch.
- **Release notes authored** → `v0.6.0-release-notes.md` (this flight dir): user-facing migration highlights, the
  **unsigned-mac disclosure + right-click-Open / `xattr` instructions** (DD11), installer list, and known
  follow-ups (macOS runtime pending; macOS-authoritative items). Ready to use as the GitHub Release body at the
  `cut-release` leg (`gh release edit v0.6.0 --notes-file …`, replacing the auto-generated notes).

## Acceptance Criteria
- [x] `package.json` at 0.6.0; bump == intended tag.
- [x] Release notes authored with the unsigned-mac disclosure + follow-ups.

## Files Affected
- `package.json` (version); `missions/.../06-parity-land-and-release/v0.6.0-release-notes.md` (new).

---

## Post-Completion Checklist
- [x] Bump + notes done; recorded in flight log; leg `landed`; checked off in flight.md
