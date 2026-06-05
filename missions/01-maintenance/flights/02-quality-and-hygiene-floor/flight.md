# Flight: Quality & Hygiene Floor

**Status**: ready
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [ ] F8 — test runner + unit tests over the privacy core
- [ ] F12 — README documents Shields/containers/privacy + `Ctrl+Shift+P`; architecture table updated
- [ ] F9 — `engines.node` floor declared
- [ ] F10 — ESLint + formatter configured
- [ ] F11 — `@ts-check`/`jsconfig` on IPC-boundary modules; stray `Tab` JSDoc fixed
- [ ] F13 — six stale remote branches deleted

---

## Pre-Flight

### Objective
Establish the quality floor the rest of the mission relies on: a test runner with unit coverage over the security-critical privacy logic, linting, incremental type-checking on the IPC boundary, an accurate public README, a Node version floor, and repo cleanup.

### Open Questions
N/A.

### Design Decisions
N/A — deferred to leg design (e.g. choice of test runner / ESLint config style).

### Prerequisites
- [ ] N/A

### Pre-Flight Checklist
- [ ] N/A — maintenance flight, Pre-Flight skipped

---

## In-Flight

### Technical Approach

One finding maps to one leg.

- **F8 — test harness + privacy-logic units (Action Required).** No `test` script/deps in `package.json`. The pure, Electron-free functions are the high-value first target: `registrableDomain`, `classify` (`src/main/trackers.js`), `stripUrl`, `isTrackingParam`, `active` (`src/main/shields.js`). **Fix:** add a lightweight runner (e.g. `node --test` or Vitest) and unit tests for these. Per global instructions these are pure-logic unit tests (no committed snapshots).
- **F12 — README accuracy (Action Required).** README Features section omits the entire Shields/containers/privacy feature set (shipped v0.2.0) and the `Ctrl+Shift+P` shortcut (`src/renderer/renderer.js:1087-1096`); architecture table omits `shields.js`/`jars.js`/`trackers.js`. **Fix:** add a Privacy/Shields section, the shortcut, and the three modules. (Note: `scripts/update-readme.mjs` only rewrites the `DOWNLOADS` block — manual edits elsewhere are safe.)
- **F9 — `engines` field (Advisory).** No `engines`; CI uses Node 20, dev Node 22. **Fix:** add `engines.node: ">=20"`.
- **F10 — linter/formatter (Advisory).** No ESLint/Prettier. **Fix:** add ESLint (node + browser envs for main/preload vs renderer) and a `lint` script; optional formatter.
- **F11 — type-checking on IPC boundary (Advisory).** Plain JS, no `jsconfig`/`@ts-check`; IPC payloads (`download-media`, `privacy-net`) are unchecked; stray `@type {Map<string, Tab>}` refers to an undefined `Tab` (`src/renderer/renderer.js:53`). **Fix:** add `jsconfig.json` with `checkJs`, `// @ts-check` on `src/preload/chrome-preload.js` and the `ipcMain.handle` modules, and JSDoc typedefs for the IPC payloads; fix the stray `Tab` reference.
- **F13 — stale branches (Advisory).** `origin/branding`, `docs-claude-md`, `download-selected`, `privacy-panel`, `release-prep-v0.2.0`, `shields` are squash-merged but show unmerged. **Fix:** confirm each PR landed, then `git push origin --delete` them.

### Checkpoints
- [ ] Test runner green with privacy-core units (F8)
- [ ] README accurate (F12); lint/types/engines configured (F9–F11); branches pruned (F13)

### Adaptation Criteria

**Divert if**:
- Adding `@ts-check` surfaces a large number of real type errors that warrant their own remediation leg rather than inline fixes.

**Acceptable variations**:
- Runner/linter tooling choice; bundling F9 into the same `package.json` edit as F8.

### Legs

> Tentative.

- [ ] `test-harness-and-privacy-units` - F8 (+ F9 package.json edit)
- [ ] `eslint-setup` - F10
- [ ] `ts-check-ipc-boundary` - F11
- [ ] `readme-feature-sync` - F12
- [ ] `prune-stale-branches` - F13

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (`npm test` green)
- [ ] Documentation updated (README)

### Verification
`npm test` runs and passes with coverage over the five privacy-core functions; `npm run lint` runs; `jsconfig`/`@ts-check` reports clean on the IPC modules; README accurately lists the privacy features and `Ctrl+Shift+P`; `package.json` has an `engines.node`; the six stale remote branches are gone.
