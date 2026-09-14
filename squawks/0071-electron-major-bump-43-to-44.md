# Squawk 0071: Electron major bump 43.4.1 → 44.3.0 (Dependabot #210)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-14
**Completed**: 2026-09-14

## Report

Dependabot opened PR #210 bumping `electron` from **43.4.1 → 44.3.0** — a
**MAJOR** version step (43 → 44), NOT a routine dev-dep bump. It carries
CLAUDE.md's explicit standing tax (App database section): "every Electron major
bump re-runs the full store suite (`history-store` + `app-db` + all five stores)
and treats a `node:sqlite` API break as a first-class migration cost."
`node:sqlite` is an EXPERIMENTAL Node/Electron API and the primary risk surface —
a major Electron bump can move Node versions and change or break it.

**This squawk is provisional.** It qualifies as `servicing` ONLY if the bump is
clean. **Escalation condition (fails the squawk no-design gate → becomes a
flight):** if completing it requires ANY `node:sqlite` (or other Electron/Node)
API migration work beyond a mechanical "bump the range + regenerate the lockfile
+ full green bar + the store suites pass + a manual dev-launch smoke", STOP and
escalate to `/mission-control:flight` rather than force it through as a squawk.

## Evidence

- `package.json` devDependency `electron`: `43.4.1` (installed 43.4.1); PR #210
  targets `44.3.0`.
- CLAUDE.md, App database (`src/main/app-db.js`) — the "Standing tax: every
  Electron major bump re-runs the full store suite … a `node:sqlite` API break
  as a first-class migration cost" rule; decision records in the mission
  08/10 `flight.md` files.
- `src/main/app-db.js` / `src/main/history-store.js` — the `node:sqlite`
  (`DatabaseSync`) consumers; `test/unit/` store suites are the gate.
- NOT the GitHub Actions SHA-pin rule — that governs workflow `uses:` refs; this
  is an npm dependency, verified by lockfile integrity, not a mutable tag.

## Corrective Action

Bumped `electron` in `package.json` devDependencies from `43.4.1` to `44.3.0`
(exact pin, matching both the existing entry's shape — it was already
exact-pinned, not range-pinned like the other devDeps — and the literal
version string in Dependabot PR #210's own `package.json`/`package-lock.json`
diff, confirmed via `gh pr diff 210`). Ran `npm install`, which downloaded the
Electron 44.3.0 binary and regenerated `package-lock.json`. Confirmed via
`git diff package.json package-lock.json` that the lockfile diff is byte-for-
byte identical in shape to Dependabot's own diff: only the two `electron`
version/resolved/integrity fields changed (integrity hash
`sha512-St9EV7F...VfQ==` matches PR #210 exactly) — no other dependency, no
transitive-dep churn, no unrelated `overrides`/`dependencies` change. No code
changes were made anywhere in `src/`.

## Verification

- **Lockfile scope**: `git diff --stat` → only `package.json` (1 line) +
  `package-lock.json` (the electron entry, two spots) changed. `npx electron
  --version` → `v44.3.0`, confirming the binary actually installed matches.
- **`npm audit --audit-level=high`**: `found 0 vulnerabilities` (clean, no
  regression from the pre-bump baseline).
- **Green bar under system Node 22.22.0** (the caveat that this does NOT
  exercise Electron's bundled Node/`node:sqlite` — see boot smoke below):
  - `npm test` → `# tests 4436 / # pass 4436 / # fail 0` (full suite,
    `test/unit/*.test.js`).
  - `npm run typecheck` → clean (`tsc --noEmit -p jsconfig.json`, no output).
  - `npm run lint` → clean (`eslint .`, no output).
  - `npm run format` → no files rewritten beyond the two already-changed
    (package.json/package-lock.json are not Prettier-formatted files); every
    test file reported `(unchanged)`. `npm run format:check` → "All matched
    files use Prettier code style!"
  - **Store suites explicitly re-run** (`node --test --test-timeout=60000
    …`), on top of already being part of the full `npm test` pass above:
    `test/unit/app-db.test.js`, `test/unit/history-store.test.js`,
    `test/unit/settings-store.test.js`, `test/unit/jars*.test.js` (incl.
    `jars-security-forward-version.test.js`, `jars-verify-persisted.test.js`),
    `test/unit/shields.test.js`, `test/unit/downloads-store.test.js`,
    `test/unit/session-store.test.js`, and the vault store family
    (`vault-store.test.js`, `vault-manager-v2.test.js`,
    `vault-key-rotation.test.js`) — combined 395 + 40 = 435 tests, all pass,
    0 fail. Cookie-bookkeeping (`cookie_seen`/`createCookieSeenStore`) is
    covered inside `app-db.test.js` (grep-confirmed) plus
    `jar-data-ipc.test.js`/`jar-registry-ipc.test.js`/`retention-sweep.test.js`/
    `session-runtime.test.js` — all part of the green `npm test` run.
- **Real boot smoke under Electron 44 (the load-bearing check)**: launched
  `npm run dev:automation` backgrounded to a log file. Port `127.0.0.1:49707`
  bound within ~3s (well under the 45s budget). Waited an additional ~5s past
  bind, then inspected the full log (38 lines): only the known WSLg
  ozone/drm/vaapi warnings/errors (`drmGetDevices2() has not found any
  devices`, `Failed to initialize drm render node handle`, Wayland
  `zcr_alpha_compositing_v1`/`overlay_prioritizer`/text-input-v3 warnings,
  `xdg` portal registration warning, `StackChildLayerRelativeTo` aura
  warnings) plus the two expected dev-mode "Insecure Content-Security-Policy"
  console notices — grepped for `sqlite|DatabaseSync|app\.db|history\.db|
  corrupt|uncaught|throw|exception|quarantine|node:sqlite|ExperimentalWarning`
  returned ZERO matches (the WSLg drm/ozone/vaapi lines contain none of these
  terms) — independently re-confirmed by the Reviewer's own boot smoke.
  `ps aux` showed the full expected process tree still alive after the wait
  (main + zygotes + gpu-process + network utility + 3 renderers — chrome +
  tab content), i.e. no crash/exit. `history.db-wal` grew and its mtime
  advanced to the boot time (confirming a live write through `node:sqlite`
  under Electron 44's bundled Node); `app.db`/`history.db` both present and
  non-empty (36864 / 40960 bytes respectively) in `~/.config/goldfinch-dev/`
  throughout. The window did not need to be inspected visually (known WSLg
  non-presentation is not a store-failure signal per the task brief). Cleanly
  terminated afterward: `pkill -9 -f 'dev-launch.mjs'` then `pkill -9 -f
  'node_modules/electron/dist/electron'` — confirmed zero matching processes
  and port 49707 no longer bound.
- **Escalation gate**: held clean. No `node:sqlite`/`DatabaseSync` API break,
  no store-open failure, no broken store suite, no Electron API change
  requiring code changes, and no unrelated dependency churn. This is a
  mechanically clean major bump.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet)
**Verdict**: confirmed — independently re-ran the green bar (4436/4436), the audit
(0 vulnerabilities), the store suites, AND its own real Electron-44 boot smoke
(history.db-wal grew, a live node:sqlite write, no store/sqlite error in the log).
The escalation gate held: a mechanically clean major bump, no migration needed.
**Commit**: squawk/0071 turnaround (supersedes Dependabot #210)
