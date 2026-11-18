# Leg: runtime-fuses

**Status**: completed
**Flight**: [Shipping and At-Rest](../flight.md)

## Objective

Packaged builds ship with the three fuses that let the binary be used as a general-purpose Node runtime or debugger target turned off, and every place that packages the app fails if any of them is found on.

## Context

- Flight DD2 (mission finding 18, the fuses part). Leg `packaged-measurements` measured Q4 on the unpacked Linux build with the three fuses off: the app starts, a URL on the command line opens, a second launch hands its URL to the first instance, and the Shields restart-to-apply relaunch works. Each fuse's effect was shown (`packaged-measurements.md`, *AC4 / Q4*): `ELECTRON_RUN_AS_NODE=1 … -e` stops running as Node; `--inspect` stops opening a debugger port; `NODE_OPTIONS` is no longer consulted.
- **How it is set**: electron-builder's `electronFuses` option (`node_modules/app-builder-lib/out/configuration.d.ts`, `FuseOptionsV1`: `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`, `enableCookieEncryption`, `resetAdHocDarwinSignature`, …) in `package.json`'s `build` block. It applies to every platform the builder packages. `@electron/fuses` 1.8.0 is installed (through electron-builder) and ships the `electron-fuses` CLI.
- **macOS** (Q5; operator ruling 2026-11-17 — no Apple hardware, the early launch is skipped): this project sets `mac.identity: null`, so the builder does not sign; changing the binary invalidates the ad-hoc signature an Apple-silicon build needs. `resetAdHocDarwinSignature: true` makes the fuse step re-sign. It cannot be run here. Leg `release-build-split` will add a check on the macOS build runner itself (signature verification and a short launch) — that is the only evidence this flight can get, and it is that leg's, not this one's.
- **Not touched, by decision** (recorded for the disposition table): the two archive-integrity fuses (`enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`) need `asar`, and `asar: false` is load-bearing (CLAUDE.md, *Non-obvious gotchas*); `grantFileProtocolExtraPrivileges` stays on because the chrome is a `file://` page; `enableCookieEncryption` is the operator's pending ruling (DD6) and, if turned on, belongs to leg `cookie-encryption`.
- Dev launches run the unmodified `node_modules/electron` binary and are unaffected.
- A packaged build on this host is launched only by the recipe leg 02 measured: both `HOME` and `XDG_CONFIG_HOME` set to scratch directories, `--no-sandbox --ozone-platform=wayland`; and it is drivable over MCP from a profile seeded by a dev-mode mint (`packaged-measurements.md`, *AC2*, the four-step recipe including the WAL files and `automationEnabled`).

## Inputs

- Legs 01, 02 and 05 landed (uncommitted). `package.json`'s `build` block has no `electronFuses` key.

## Outputs

- `package.json` (`build.electronFuses`; `@electron/fuses` as an explicit exact dev dependency), `package-lock.json`.
- `scripts/check-fuses.mjs` (new), a unit test, `ci/tasks/package-linux.yml`, `.github/workflows/ci.yml` (its packaging step), docs.

## Acceptance Criteria

- [ ] **AC1 — The setting.** `package.json` `build.electronFuses` is exactly `{ runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, resetAdHocDarwinSignature: true }` — no other key. `@electron/fuses` is added to `devDependencies` at the exact installed version (the check script imports it; a transitive dependency is not something to import from).
- [ ] **AC2 — One check, used everywhere.** `scripts/check-fuses.mjs <path-to-packaged-binary>` reads the fuse wire from the binary with `@electron/fuses`, prints each fuse's state, and exits non-zero if any of the three is on, **or** if any other fuse differs from the expected table the script holds (so a fuse changing by accident — a builder default moving, the cookie fuse turning on unannounced — is also caught). It exits non-zero with a clear message when the path does not exist or is not an Electron binary. The expected table is the single source: a unit test asserts it agrees with `package.json`'s `electronFuses` (drift guard, throwing rather than passing if the key is missing) and that the script's decision function (exported, pure: fuse states → verdict) fails on each of the three being on, one at a time, and on an unexpected change to any other.
- [ ] **AC3 — Packaging fails on a wrong fuse.** `ci/tasks/package-linux.yml` and the *Package (no installers)* step of `.github/workflows/ci.yml` run the check on `dist/linux-unpacked/goldfinch` after packing. (The release workflow, `build.yml`, is leg `release-build-split`'s file and gains the same check there, per platform — not edited here.) Shown locally both ways: `npm run pack` then the script → exit 0, output quoted in the log; the script on the stock `node_modules/electron/dist/electron` → non-zero (the three read *Enabled*).
- [ ] **AC4 — The packaged build still works, driven properly.** On the freshly packed, fused `dist/linux-unpacked` — launched only by leg 02's recipe, profile seeded for MCP at both tiers — every apparatus primitive answers once against a loopback page: `enumerateWindows`, `enumerateTabs`, `openTab`, `navigate`, `readDom`, `evaluate`, `readAxTree`, `captureScreenshot`, `captureWindow`, `click`, `typeText`, `pressKey`, `scroll`, `findInPage` / `stopFindInPage`, `getZoom` / `setZoom`, `goBack` / `goForward`, `reload`, `getHistory`, `downloadsList`, `closeTab`, `getChromeTarget`. Then: a URL on the command line opens; a second launch hands its URL over and exits; restart-to-apply relaunches and the same keys still attach. And each fuse's effect on **this** build: `ELECTRON_RUN_AS_NODE=1 <binary> -e "console.log(1)"` does not print `1`; `<binary> --inspect=<port>` opens no debugger port; `NODE_OPTIONS=--inspect=<port>` opens none either.
- [ ] **AC5 — Nothing in the repository relied on what was turned off.** `grep -rn "ELECTRON_RUN_AS_NODE\|NODE_OPTIONS\|--inspect\|utilityProcess\|child_process\|\.fork(" src/ scripts/ build/ ci/ .github/ package.json docs/ CLAUDE.md` — every hit listed in the log and judged: unaffected (runs under plain Node or the dev binary), or affected (then it is fixed or the leg stops with `[BLOCKED:fuse-dependency]`).
- [ ] **AC6 — Docs.** `docs/RELEASING.md`: a short *Runtime fuses* section — which three are off and what each stops, which are deliberately left and why, how to read them from an installed build (`npx electron-fuses read --app <path>`), and that macOS is re-signed ad hoc after the change and is checked on the build runner, not on hardware. `docs/dev-testing.md`: the packaged-launch recipe from leg 02 (the two redirected variables, the display switches, the seeded-profile MCP attach), since this is the first leg to depend on it and later legs will. CLAUDE.md: one line under *Non-obvious gotchas* (packaged builds cannot be run as Node or inspected; the check script and where it runs; never launch a packaged build on a dev host without both variables redirected), and `npm run pack` + check in *Commands* if a script alias is added.
- [ ] **AC7 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`; `npm ci` succeeds from clean with the new lockfile.

## Verification Steps

- AC1, AC2: the unit test; `node -p "require('./package.json').build.electronFuses"`.
- AC3: the two quoted runs. If `fly` is logged in, `fly -t local-goldfinch execute -c ci/tasks/package-linux.yml -i repo=.`; if not, say "not verified on the worker".
- AC4: the smoke script's table in the log (primitive → outcome), plus the three fuse-effect observations.
- AC5: the grep and its judgement.

## Implementation Guidance

1. The setting and the explicit dev dependency. `npm run pack`.
2. The script, its pure decision function, the unit test.
3. The two CI call sites.
4. The packaged smoke (AC4) — write the seeding helper once, in the scratch directory; the launcher must refuse to start anything unless both variables point inside the scratch root.
5. Docs, gates. Leg `landed`, flight-log entry, `[LAND:leg]`. Do not commit.

## Edge Cases

- **electron-builder reports an unknown key or the wrong shape for `electronFuses`**: read `node_modules/app-builder-lib/scheme.json`'s `electronFuses` entry and follow it; do not move to an `afterPack` hook without saying so in the log.
- **`resetAdHocDarwinSignature` is rejected on a Linux pack**: it should be ignored off macOS; if the builder errors, signal `[BLOCKED:mac-resign-option]`.
- **The fused build will not start**: stop; quote stderr; `[BLOCKED:fused-build]`. Leg 02 saw it start, so this would be new information.
- **A native dialog appears**: do not answer it; record it.
- **`fly` not logged in**: skip the worker run and say so. Never log in or set the pipeline.
- **Processes**: stop by recorded pid, never by name. Remove the scratch directory with a plain `rm -r`.

## Files Affected

- `package.json`, `package-lock.json`
- `scripts/check-fuses.mjs` (new), `test/unit/check-fuses.test.js` (new)
- `ci/tasks/package-linux.yml`, `.github/workflows/ci.yml`
- `docs/RELEASING.md`, `docs/dev-testing.md`, `CLAUDE.md`
- `eslint.config.mjs` only if `scripts/*.mjs` needs a listing (the existing scripts show the pattern)

## Citation Audit

Checked by the Flight Director on 2026-11-17: `node_modules/app-builder-lib/out/configuration.d.ts` — `electronFuses?: FuseOptionsV1`, with `runAsNode`, `enableCookieEncryption`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`; `@electron/fuses` 1.8.0 with `dist/bin.js`; `package.json` `build` (no `electronFuses`; `mac.identity: null`; `asar: false`); `ci/tasks/package-linux.yml` (`npx electron-builder --linux --dir`, image pinned by leg 01); `.github/workflows/ci.yml` step *Package (no installers)*; `packaged-measurements.md` sections *AC1*, *AC2*, *AC4*. Tier: **low** — a build configuration key and a check script; the behaviour was measured on this host in leg 02 before the decision was locked, and the one part that could not be measured (macOS) has a named owner in leg `release-build-split`.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
