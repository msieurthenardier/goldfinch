# Flight Log: Release Integrity

**Flight**: [Release Integrity](flight.md)

## Summary

In flight (2026-11-19). Branch `flight/01-release-integrity` cut from `main` @ 22304bf.

---

## Leg Progress

### Leg 01 `release-runs-audit` landed (live dispatch pending, Flight Director)

- `build.yml` `build` job: new step "Audit dependencies (high and above)", `if: matrix.platform == 'linux'`, `npm audit --audit-level=high`, placed after Set up Node and BEFORE `npm ci`; runs on tag and dispatch; no `continue-on-error`, no `|| true`, no permission or secret added.
- Pins added in `release-workflow-invariants.test.js` (3 tests), each neuter-verified (workflow mutated, test red, restored):
  1. audit step: linux-only `if`, exact command, no softening, before `npm ci` and the build step. Neutered by `|| true`, `--audit-level=critical`, replacing the `if` with `continue-on-error`, moving the step after `npm ci`: all red.
  2. fuse check: no `if:`, command intact, after `electron-builder`. Neutered by `if: matrix.platform == 'win'`: red.
  3. `upload` job `if` requires `needs.build.result == 'success'` (and never `!=`), `needs` includes `build`, publish needs upload success. Neutered by `!= 'failure'`: red.
- Docs: `docs/RELEASING.md` jobs table and new *The audit gate* section; CLAUDE.md *Release / CI*.
- `npm audit --audit-level=high`: exit 0, 0 vulnerabilities (re-run again before commit).
- Verification, stated honestly: the pins carry the blocking proof. The live `workflow_dispatch` run (Flight Director, after the commit) shows the step runs and passes on the DISPATCH path only. The TAG path's first live confirmation is the next real release (candidate or stable).

### Leg 02 `dependabot-repin-note` landed

- Added a five-line re-pin comment directly above the `github-actions` entry in `.github/dependabot.yml`; nothing else in the file changed.
- Added a pin test to `test/unit/release-workflow-invariants.test.js`. It reads the comment block directly above the entry and matches wrap-insensitive regexes for "before merging", "commit SHA" and "re-pin to `owner/repo@<40-hex> # vX.Y.Z`".
- Neuter check: with the comment removed, the test fails ("no comment block above the github-actions entry"). It passes with the comment restored (29/29).
- `format:check`, `lint`, `typecheck` and `npm test` (7375 pass, 0 fail) are green. Prettier covers the YAML file.

### Leg 03 `electron-45-patch` landed (behavior spec pending, Flight Director)

- `npm install electron@45.4.1 --save-exact`; `npm ls electron` -> `electron@45.4.1`. Lockfile diff scope: only the `electron` entry moved (version, resolved, integrity) plus the `package.json` pin; no other package changed.
- `format:check`, `lint`, `typecheck` green; `timeout 400 npm test`: 7379 tests, 7375 pass, 0 fail, 4 todo (store suites included).
- `npm audit --audit-level=high`: found 0 vulnerabilities (the known `picomatch` highs no longer report).
- Pack: `npm run pack`, then `node scripts/check-fuses.mjs dist/linux-unpacked/goldfinch` -> `check-fuses: ok` (fuse table unchanged). The packed binary was not launched; `dist/linux-unpacked` removed (`dist/` is gitignored).
- Dev launch on scratch HOME + XDG_CONFIG_HOME (`dev:automation` with ADMIN + DEV_MINT, env-key script): chrome user agent reports `Electron/45.4.1` (Chrome/156.0.8078.100).
- Live smoke on 45.4.1, all ok: `enumerateWindows`, `enumerateTabs`, `openTab` (example.com), `captureWindow`, `captureScreenshot`, `evaluate`, `readDom`, `getChromeTarget`. App stopped with SIGTERM; scratch profile and key log deleted.
- No CLAUDE.md or docs statement names the current runtime version; all "45.3.x" mentions are historical measurements, left as is.
- Pending: `third-party-cookie-isolation` behavior spec on 45.4.1 (Flight Director).

---

## Decisions

## Flight Director Notes

- **2026-11-19, flight start.** Loaded `.flightops/agent-crews/leg-execution.md`. Flight marked `in-flight`.
- **Leg 1 `release-runs-audit`: designed to `ready` and HELD** (operator ruling 2026-11-18). `picomatch` was rechecked today: no patched release, and 4.0.7 is still the latest. The leg is not implemented on this branch, so it cannot drift while it waits. When a fix ships, it flies as its own PR. The flight therefore stays `in-flight` after this PR merges; it lands when leg 1 does.
- **Leg 2 `dependabot-repin-note`, tier: LOW.** A comment and a pin test; single surface, no behaviour.
- **Leg 3 `electron-45-patch`, tier: LOW for design review.**
  - A version bump has nothing to review in design. Its risk (isolation failing open, store-suite regressions, fuse-table drift) is carried by acceptance criteria the leg cannot skip: the full suite, the `third-party-cookie-isolation` behavior spec (run by the Flight Director), a fuse check on a packed build, and a live smoke.
  - **Target version: 45.4.1** (latest 45.x), not 45.3.4; the mission criterion says "45.3.4 or later". Divert to 45.3.4 if 45.4.1 fails a gate.
- **Legs 2 and 3 are implemented one after the other.** They touch disjoint files, but leg 3 runs `npm install` and the full suite.
- **Leg 1 UN-HELD (operator ruling 2026-11-19).**
  - **Why:** leg 3's audit check reported 0 vulnerabilities. The Flight Director found that GitHub had **withdrawn** GHSA-fc5q-39xc-vjpf (`withdrawn_at` 2026-11-18T15:38:56Z) without ever patching it, so `picomatch` 4.0.7 no longer reports and `main`'s audit gate is green with no lockfile change.
  - **Ruling:** the operator chose to fly the audit leg now, in this PR. Its "bump `picomatch`" criterion is dropped.
  - **Tier: HIGH.** It changes the release workflow, the supply-chain surface pinned by `release-workflow-invariants.test.js`. Design review spawned.
- **Maintenance report 2026-11-18, finding #1 is partly superseded.** The "no patched release" premise no longer holds: the advisory was withdrawn. The report is a snapshot and is annotated at its header, not rewritten.
- **Leg 1 design review, cycle 1: approve with changes** (no high issue). Folded in:
  - the audit placed BEFORE `npm ci`;
  - an exact-command pin;
  - a new pin that `upload` still requires `needs.build.result == 'success'`;
  - a fuse-check pin;
  - the fail-closed, time-varying behaviour documented;
  - honest verification (a dispatch run; the tag path is first confirmed at the next release).
  No second review was needed. Implementation follows the behavior-test run (leg 3's gate), so the dev app run and the test suite do not compete.
- **Leg 3 gate: `third-party-cookie-isolation` passed on Electron 45.4.1 (14/14 judged, step 9 struck).** It covered two app-driven restarts and confirmed isolation is genuinely off after an off-and-restart, then back on after the re-enable. [Run log](../../../../tests/behavior/third-party-cookie-isolation/runs/2026-11-19-04-01-53.md). No fallback to 45.3.4 was needed.
- **Flight review (Reviewer, Sonnet): [HANDOFF:confirmed]** on legs 01–03.
  - **Checks:** `npm test` 7,378 pass, 0 fail; lint, typecheck and format clean; `npm audit` 0; `electron@45.4.1`.
  - **Non-blocking, accepted:**
    - the Dependabot note could spell out the annotated-tag dereference (`git/tags/<sha>`);
    - the fuse-check pin's `indexOf` could match a comment.
  - Legs 02 and 03 are completed. **Leg 01 stays `landed` until its live `workflow_dispatch` run passes the audit step.** That run is dispatched after this commit, with the operator's go-ahead.

