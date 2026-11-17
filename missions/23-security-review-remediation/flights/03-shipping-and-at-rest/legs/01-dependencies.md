# Leg: dependencies

**Status**: landed
**Flight**: [Shipping and At-Rest](../flight.md)

## Objective

The shipped dependency tree carries no known advisory, Electron is on the current 45 patch, the Concourse task images are pinned by digest, the personal Windows fallback builder is gone, and every advisory that remains in build-only tooling is written down with its reason.

## Context

- Flight DD7 (mission finding 20, and the supply-chain half of finding 18). Operator rulings 2026-11-17: the Windows fallback builder is **removed** (Q8); Dependabot #286 is **folded in** (this leg's Electron bump covers it; the flight's pull request closes it — nobody closes it by hand).
- **State measured at leg design (2026-11-17, `main` at `f401407`, version 0.19.15):**
  - `npm audit --omit=dev`: 2 moderate — `hono` 4.13.14 (vulnerable `<=4.13.15`) and `@hono/node-server` 1.19.17 (vulnerable `<=2.1.2`). Both arrive only through `@modelcontextprotocol/sdk` 1.32.2, whose declared ranges are `hono: ^4.11.4` and `@hono/node-server: ^1.19.9 || ^2.0.5`. Registry latest: `hono` 4.13.19, `@hono/node-server` 2.1.9. So the fix is **inside the SDK's ranges**, but for `@hono/node-server` it is a **major** step (1.x → 2.x): no 1.x release is outside the vulnerable range.
  - That package is on the live path: `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js` builds its request listener with `getRequestListener` from `@hono/node-server` — every MCP request the app serves goes through it. Nothing in `src/` imports `hono` itself.
  - `npm audit` (all): 10 moderate, the other 8 all one advisory — `minimatch` 7.0.0–11.0.0 (GHSA-g3hv-75wg-m249) through `electron-builder` 26.18.0 (`app-builder-lib`, `@electron/universal`, `dmg-builder`, `electron-builder-squirrel-windows`) and `eslint` 10.14.0 (`@eslint/config-array`). Installed copies in the range: 9.0.9 and 10.2.6. The registry has 11.0.1–11.0.9. npm's own suggestion (downgrade electron-builder to 25.1.0) is **not** taken.
  - Electron: `package.json` pins `45.3.2` exactly; 45.3.3 is published.
  - `package.json` already has `overrides: { "brace-expansion": "^5.0.8" }` — the pattern to follow.
  - Six Concourse tasks pull `node` by the mutable tag `'22'`: `ci/tasks/{audit,build-linux,lint,package-linux,test,typecheck}.yml`. `ci/tasks/build-windows.yml` has no image (it runs on the worker host).
  - The Windows fallback builder is: `ci/tasks/build-windows.yml`; the `build-windows` job and the `windows-installers` resource in `ci/pipeline.yml` (and the header comment naming it); and in `ci/README.md` the table row, the *Fallback installers* section's Windows lines, the ad-hoc `fly execute` line, the `build-windows` note, and `windows-installers` in the secrets table. `docs/RELEASING.md` and CLAUDE.md do not name it (grep `build-windows` — only `ci/` and historical mission artifacts, which are not edited).
- The audit gate (`npm audit --audit-level=high`) is not lowered and is not what this leg is measured against — the leg's target is **zero** advisories with `--omit=dev`.
- CLAUDE.md's many "measured on Electron 45.3.2" statements are dated measurements. They are **not** rewritten to 45.3.3; only a statement this leg actually re-measures may be updated, with the new version beside the old.

## Inputs

- Flight branch `flight/03-shipping-and-at-rest` at `f401407` plus uncommitted planning artifacts. No source change yet in this flight.
- `fly` (`~/.local/bin/fly`, target `local-goldfinch`) and `docker` are on the host. Either may not be logged in or running — see Edge Cases.

## Outputs

- `package.json`, `package-lock.json`; six `ci/tasks/*.yml`; `ci/pipeline.yml`; `ci/README.md`; `ci/tasks/build-windows.yml` deleted.
- A flight-log entry carrying the before/after audit counts, the chosen versions, the image digest and the date it was resolved, and the accepted-advisory record.

## Acceptance Criteria

- [ ] **AC1 — Nothing shipped is flagged.** `npm audit --omit=dev` reports 0 vulnerabilities. `hono` and `@hono/node-server` are at patched versions inside the SDK's declared ranges; `@modelcontextprotocol/sdk` stays pinned at exactly `1.32.2`. Done by a lockfile update if npm will resolve it, otherwise by `overrides` entries; either way the leg's log entry says which and why.
- [ ] **AC2 — The MCP transport still works on the new `@hono/node-server` major.** The existing unit suites that exercise the server (`test/unit/mcp-server*.test.js`, `origin-guard*.test.js` and whatever else imports `mcp-server.js`) pass unchanged, **and** a live run proves it end to end (AC6). If the transport fails on 2.x in a way that needs a source change in `src/main/automation/**` or `mcp-server.js`: stop, restore the working tree for those two packages, and signal `[BLOCKED:node-server-major]` with the failure — do not patch the transport in this leg.
- [ ] **AC3 — Electron 45.3.3**, pinned exactly in `package.json`. Read the 45.3.3 release notes: if they mention cookies, third-party-cookie blocking, `enable-features`, `node:sqlite` or the permission handlers, say so in the log entry and flag it for the Flight Director (the `third-party-cookie-isolation` spec is then re-run before the flight lands); if not, record "no relevant change" with the notes' headings as evidence.
- [ ] **AC4 — Build-tool advisories: fixed where it is safe, recorded where it is not.** For `minimatch`: try an `overrides` entry to a patched release. It is kept only if **all** of these still pass with it: `npm run lint`, `npm test`, `npm run typecheck`, and `npm run pack` (the unpacked Linux build). If any consumer breaks, the override is withdrawn and the advisory is recorded as accepted in the log entry and in `ci/README.md` (a short *Accepted advisories* note: the package, the advisory id, that it is build-time only and not in the shipped app, the date, and what would let it be fixed). The same rule for any other advisory `npm audit` shows after the bumps. `electron-builder` is not downgraded.
- [ ] **AC5 — Images by digest.** Each of the six task files pins the `node` image to one digest — the same digest in all six, the multi-platform index digest for the `22` tag as resolved on the day, with the tag kept beside it for readers. Use whichever form Concourse's `registry-image` type honours for a task `image_resource` (verify against the Concourse documentation or the resource's README; state the source in the log). `ci/README.md` gains a short *Updating the Node image* recipe: the one command that prints the current digest and the one place-per-file to change. A unit test (new, small, under `test/unit/`) reads `ci/tasks/*.yml` and fails if any `image_resource` lacks a `sha256:` digest or if the digests differ between files.
- [ ] **AC6 — Live smoke on the new runtime and transport** (dev mode, operator standing preference): `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1` (and `GOLDFINCH_AUTOMATION_ADMIN=1`), key captured from the launch line, an env-key script using `scripts/lib/mcp-client.mjs` `connectAutomation()`. Exercise every existing apparatus primitive once against a loopback page served by the script itself: `enumerateWindows`, `enumerateTabs`, `openTab`, `navigate`, `readDom`, `evaluate`, `readAxTree`, `captureScreenshot`, `captureWindow`, `click`, `typeText`, `pressKey`, `scroll`, `findInPage`/`stopFindInPage`, `getZoom`/`setZoom`, `goBack`/`goForward`, `reload`, `getHistory`, `downloadsList`, `closeTab`; then one request with a wrong key (401) and one with a foreign `Origin` header (403). Record `process.versions.electron` as read from the app. Quit the app at the end; leave no process and no port bound. Never the registered `goldfinch-dev` MCP server; never the operator's real profile; no vault unlock; nothing written to the clipboard; no download started.
- [ ] **AC7 — The Windows fallback builder is removed.** `ci/tasks/build-windows.yml` deleted; the `build-windows` job and the `windows-installers` resource removed from `ci/pipeline.yml` and its header comment corrected; `ci/README.md` no longer names a Windows build, job, worker or resource and says in one line that Windows installers come only from the GitHub release workflow. `grep -rn "build-windows\|windows-installers" ci/ docs/ CLAUDE.md README.md .github/` returns nothing. `ci/pipeline.yml` still parses (`fly validate-pipeline -c ci/pipeline.yml` if `fly` runs offline; otherwise a YAML parse). The log entry carries the operator's follow-up, verbatim: after merge, run `./ci/set-pipeline.sh` to drop the job from the running pipeline; archives already in MinIO are theirs to delete.
- [ ] **AC8 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass. `npm ci` from a clean `node_modules` succeeds with the new lockfile (run once at the end).

## Verification Steps

- AC1: `npm audit --omit=dev`; `npm ls hono @hono/node-server @modelcontextprotocol/sdk`.
- AC2, AC8: the commands named.
- AC3: `node -p "require('./node_modules/electron/package.json').version"`; the release-notes excerpt in the log.
- AC4: `npm audit` output before and after in the log; `npm run pack` exit status.
- AC5: the new unit test; `grep -n "sha256" ci/tasks/*.yml`. If `fly` is logged in: `fly -t local-goldfinch execute -c ci/tasks/audit.yml -i repo=.` once, as proof the pinned form is accepted by the worker — if it is not logged in, say "not verified on the worker" rather than guess.
- AC6: the script's printed results summarised in the log (primitive, outcome). The script lives in the scratch directory, not the repository.
- AC7: the grep.

## Implementation Guidance

1. **Record the baseline** — both audits, `npm ls` for the three packages — in the log entry first.
2. **Runtime advisories** (AC1), then the server unit suites (AC2). Stop here if the transport breaks.
3. **Electron** (AC3). Re-run `npm test` (the store suites run on built-in `node:sqlite` and are the reason every Electron bump re-runs them).
4. **Build tooling** (AC4), with the four checks after the override.
5. **Images** (AC5) and the test.
6. **Windows builder removal** (AC7).
7. **Live smoke** (AC6) — last, on the final tree.
8. Clean `npm ci`, gates (AC8). `npm run format` before finishing. Leg `landed`, flight-log entry, `[LAND:leg]`. Do not commit.

## Edge Cases

- **`npm audit fix` wants to touch more than the two packages**: do not run it blind. Use targeted updates (`npm update hono @hono/node-server`, or overrides) and read the lockfile diff — every changed package is listed in the log entry. An unrelated major bump riding along is reverted.
- **An override on `@hono/node-server` conflicts with a future SDK**: note in the log that the override (if one was needed) is removed when the SDK pin next moves.
- **`minimatch` 11 is a different major from what its consumers ask for** (they declare 9.x and 10.x): that is why AC4 makes the four checks the judge. A per-consumer nested override is acceptable if a blanket one breaks something; "it installs" is not evidence.
- **`docker` not running / registry unreachable**: resolve the digest another way (the registry's HTTP API) or signal `[BLOCKED:no-digest]`. Never invent or copy a digest from memory.
- **`fly` not logged in**: skip the worker check and say so. Do not log in, and do not run `set-pipeline` under any circumstance — that changes the operator's running CI and is theirs.
- **`npm run pack` writes `dist/`**: it is gitignored; leave it, but do not launch anything from it (flight rule: no packaged build runs on this host before leg `packaged-measurements` has measured profile isolation).
- **A port needed by the smoke is taken**: pick another; the script binds port 0 for its own page.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- `package.json`, `package-lock.json`
- `ci/tasks/audit.yml`, `build-linux.yml`, `lint.yml`, `package-linux.yml`, `test.yml`, `typecheck.yml` — image digest
- `ci/tasks/build-windows.yml` — deleted
- `ci/pipeline.yml`, `ci/README.md`
- `test/unit/ci-image-pins.test.js` (new; name at the Developer's discretion)
- CLAUDE.md — only if a statement about CI or the dependency set becomes false (the Release / CI section's Concourse line names five task files and stays true)

## Citation Audit

Checked by the Flight Director against the working tree on 2026-11-17: `npm audit` and `npm audit --omit=dev` output; `npm ls hono @hono/node-server minimatch`; the SDK's `package.json` ranges; `streamableHttp.js`'s `getRequestListener` import; `npm view` for `electron@45`, `hono`, `@hono/node-server`, `minimatch`; `package.json` `overrides`; the `image_resource` blocks of all seven task files; `ci/pipeline.yml` in full; `ci/README.md` in full; `grep -n "build-windows"` across `docs/`, CLAUDE.md, README.md and `.github/`. Tier: **low** — configuration and lockfile only, no source change; the one real unknown (the transport on the new `@hono/node-server` major) is empirical, cannot be settled by reading, and is gated by AC2 and AC6 with a stop rule.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
