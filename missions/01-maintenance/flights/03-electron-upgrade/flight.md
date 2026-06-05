# Flight: Dependency Currency — Electron Major Upgrade

**Status**: ready
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [ ] F2 — Electron upgraded to a current major; webview/session behavior re-verified
- [ ] F21 — CI runs a dependency-audit step

---

## Pre-Flight

### Objective
Bring the shipped Electron runtime current (nine majors behind) to pick up Chromium/Electron security fixes reachable by hostile web content, then add a CI audit step so dependency drift self-surfaces next cycle.

### Open Questions
N/A at planning level — the upgrade path (incremental vs direct to latest) is a leg-design decision.

### Design Decisions
N/A — deferred to leg design.

### Prerequisites
- [ ] Hostile-page hardening (Flight 1) ideally landed first, so security regressions are isolated from the upgrade churn.

### Pre-Flight Checklist
- [ ] N/A — maintenance flight, Pre-Flight skipped

---

## In-Flight

### Technical Approach

One finding maps to one leg.

- **F2 — Electron upgrade (Action Required).** `npm outdated` confirms `electron 33.4.11 → 42.3.3` (nine majors). The shipped `electron` package carries advisories (iframe-permission origin confusion, custom-protocol header injection, service-worker IPC spoofing) reachable by hostile content. **Fix:** upgrade Electron (and `electron-builder` 25→26 as needed for build compatibility). This is breaking across nine majors — re-verify the security-sensitive surfaces: `will-attach-webview` config (`contextIsolation:false`, `nodeIntegration:false`), `session-created` shields wiring, the single per-session `webRequest` listener, `setWindowOpenHandler`, and permission handlers. **Do NOT `npm audit fix --force`** — the other nine audit highs are `electron-builder` dev toolchain (build-time only); the real fix is this targeted bump. Validate by running the packaged app and exercising shields/containers/downloads.
- **F21 — CI audit step (Advisory).** `ci.yml` runs only `npm ci` + `electron-builder --dir`. **Fix:** add `npm audit --audit-level=high` (and/or `npm audit signatures`) so a future Electron lag self-surfaces; optionally enable Dependabot for npm + secret scanning.

### Checkpoints
- [ ] Electron upgraded; app launches and webview/session/shields/downloads verified
- [ ] CI audit step added and green

### Adaptation Criteria

**Divert if**:
- A webview/session API breaking change requires non-trivial code changes that expand the flight beyond a dependency bump (carve those into their own legs).

**Acceptable variations**:
- Landing on the latest stable vs the latest patched line of an intermediate major, if a direct jump proves unstable.

### Legs

> Tentative.

- [ ] `electron-major-upgrade` - F2 (bump + re-verify security surfaces)
- [ ] `ci-dependency-audit` - F21

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] App builds on all three platforms in CI
- [ ] Manual verification of webview/session/shields/downloads passed

### Verification
`npm outdated` shows Electron on a current major; the packaged app launches and shields/containers/downloads/farbling work; CI runs a dependency-audit step and is green.
