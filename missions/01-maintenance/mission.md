# Mission: Codebase Health — 2026-06-05 Maintenance

**Status**: active

## Outcome

Resolve the codebase health issues identified in maintenance report [2026-06-05](../../maintenance/2026-06-05.md): close the hostile-page-reachable security gap, bring Electron current, establish a test/quality floor over the privacy core, harden the CI supply chain, correct the public README, and make the browser chrome keyboard/screen-reader operable. The goal is a flight-ready codebase whose stated security priority is backed by a regression net.

## Context

Goldfinch was just onboarded to Flight Control and received a cold-baseline maintenance inspection (four read-only reviewers + an Architect roundtable). The codebase is clean and well-structured with sound core Electron hardening, but the inspection surfaced seven Action Required findings and thirteen advisories. None are Critical, but the security and dependency-currency items should be addressed before new feature work. Full evidence, severities, and the threat-model reasoning are in the maintenance report.

## Success Criteria

- [x] **F1** — Page-originated `window.open()` URLs are scheme-filtered before reaching a webview `src`; `file:`/`data:`/`javascript:` are rejected (verified by a behavior test)
- [x] **F3** — `open-external` validates scheme (or is removed while unused)
- [x] **F4** — `download-media` `saveDir` is asserted within a dialog-approved root
- [x] **F5** — Download filenames reject leading-dot / Windows-reserved names; path containment asserted
- [x] **F6** — Video `poster` is sanitized before use in `backgroundImage`
- [x] **F7** — `containers.json` is shape-validated on load (partition prefix, id dedupe, safe coercion)
- [ ] **F8** — A test runner is configured and unit tests cover `registrableDomain`, `classify`, `stripUrl`, `isTrackingParam`, `active`
- [ ] **F9** — `package.json` declares an `engines.node` floor aligned with CI
- [ ] **F10** — ESLint (and formatter) is configured with a lint script
- [ ] **F11** — `@ts-check` + `jsconfig.json` enabled on IPC-boundary modules; stray `Tab` JSDoc fixed
- [ ] **F12** — README documents the Shields/containers/privacy feature set and the `Ctrl+Shift+P` shortcut; architecture table lists `shields.js`/`jars.js`/`trackers.js`
- [ ] **F13** — The six stale squash-merged remote branches are deleted
- [ ] **F2** — Electron is upgraded to a current major; webview/session behavior re-verified
- [ ] **F21** — CI runs a dependency-audit step
- [ ] **F17** — Both workflows declare least-privilege top-level `permissions:`
- [ ] **F16** — The README auto-update no longer pushes to `main` unreviewed
- [ ] **F18** — Third-party actions are SHA-pinned (non-GitHub action prioritized)
- [ ] **F19** — Release job is restricted to semver `v*` tags with appropriate gating
- [ ] **F22** — Tabs are keyboard-operable with correct ARIA roles/state (verified by a behavior test)
- [ ] **F23** — Icon-only chrome controls have accessible names and a visible focus indicator
- [ ] **F24** — Remaining WCAG AA gaps addressed (reduced-motion, live regions, focus management, labels/landmarks, color+icon state, contrast)

## Stakeholders

The project owner/maintainer. As a privacy-focused public browser, end users (including keyboard/AT users) are indirect stakeholders in the security and accessibility outcomes.

## Constraints

- Unsigned builds remain an accepted, documented tradeoff for this stage (not in scope).
- Branch protection is unavailable on the current GitHub tier (not in scope until the repo is public/upgraded).
- Do **not** run `npm audit fix --force` — it churns the dev toolchain; remediate dependencies via the targeted Electron upgrade.

## Environment Requirements

- Local Node toolchain (Node ≥20) and `npm`.
- Electron desktop runtime for manual/behavior verification (GUI).
- The Electron upgrade flight requires running the packaged app to re-verify webview/session APIs.

## Open Questions

N/A — findings are concrete; design decisions are deferred to each flight.

## Known Issues

- [ ] **Container `color` is an unescaped HTML-attribute injection sink** — discovered in Flight 1 debrief. `validateContainers` (F7, `jars.js`) coerces `color` to a string but does **not** validate its format, and the renderer interpolates it unescaped into `style="background:${c.color}"` at `renderer.js:76, 127, 883` (while `name` is `escapeHtml`'d). A tampered `containers.json` color (e.g. `#000"><img src=x onerror=…>`) could break out of the attribute into HTML in the privileged chrome renderer. Same threat tier as F7 (requires local file tamper, second-order), but an incomplete fix. **Fast-follow**: in `validateContainers`, accept `color` only if it matches a safe pattern (e.g. `/^#[0-9a-fA-F]{3,8}$/` or a known CSS color keyword), else fall back to the default color. Affects the F7 surface; fold into Flight 2 or a micro-leg.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses.

- [x] Flight 1: Harden the hostile-page security boundary (F1, F3–F7)
- [ ] Flight 2: Quality & hygiene floor — tests, lint, types, README, branches (F8, F12, F9, F10, F11, F13)
- [ ] Flight 3: Dependency currency — Electron major upgrade (F2, F21)
- [ ] Flight 4: CI/CD supply-chain hardening (F17, F16, F18, F19)
- [ ] Flight 5: Accessibility — keyboard & screen-reader baseline (F22, F23, F24)
