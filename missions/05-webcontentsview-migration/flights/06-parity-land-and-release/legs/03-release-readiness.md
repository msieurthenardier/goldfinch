# Leg: release-readiness

**Status**: landed
**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](../flight.md)

> **Outcome (2026-07-08): PASS.** Config sound (asar:false deliberate; build.yml Architect-verified); local linux
> smoke built AppImage (125M) + deb (97M) cleanly. macOS = build-readiness (Actions, unsigned, DD2). The
> 3-platform CI dry-run runs post-merge-pre-tag (DD7 refinement). Cosmetic: `desktopName` unset → polish.

## Objective
De-risk the v0.6.0 release: audit the electron-builder + `build.yml` config, prove the linux installers build
locally, and record the macOS build-readiness decision — before any merge/tag.

## Scope (autonomous, LOCAL — no push, no publish)
1. **Config audit:** confirm the electron-builder build block + `.github/workflows/build.yml` are release-sound
   (targets, publish provider, `GITHUB_TOKEN`-only auth, tag-driven version sync). Confirm `asar:false` +
   `files:["src/**/*"]` is **deliberate** (ships the unbundled source tree — pre-existing choice), not a leftover.
2. **Local linux installer smoke:** `npx electron-builder --linux --publish never` → build the AppImage + deb
   locally, confirming the linux release artifacts pack cleanly on this rig.
3. **macOS build-readiness decision (DD2):** record that the mac installer builds via GitHub Actions
   (`macos-latest`, unsigned — `identity:null`), and that runtime mac verification is deferred (no in-loop venue).

## Deferred to the operator-gated release sequence (DD7 refinement)
The full **3-platform `workflow_dispatch` build-only dry-run** requires the code on a *remote* branch and consumes
CI — it runs **after the operator-gated merge to `main`, before the tag** (still pre-publish, satisfying DD7's
"catch a broken build before publishing" intent). The feature branch is NOT pushed separately for it.

## Acceptance Criteria
- [ ] Config audit complete; `asar:false`+`files:src/**` confirmed deliberate; `build.yml` sound (recorded).
- [ ] Local linux installer smoke: AppImage + deb build cleanly (or any failure recorded with cause).
- [ ] macOS build-readiness decision recorded (DD2).

## Files Affected
- None (verification/build leg; `dist/` is local, gitignored/removed). Records into the flight log.

---

## Post-Completion Checklist
- [ ] Audit + linux smoke results recorded in the flight log
- [ ] Leg status → `landed` (no commit); check off in flight.md
