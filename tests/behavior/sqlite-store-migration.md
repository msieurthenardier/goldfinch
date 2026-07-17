# Behavior Test: JSON → SQLite store migration on a real profile boot

**Slug**: `sqlite-store-migration`
**Status**: active
**Created**: 2026-07-17
**Last Run**: 2026-07-17-20-46-52 (pass, 6/6 checkpoints — first clean run; see runs/)

> Authored at M10 F1 flight design. The migration's whole point is observable only across a
> real app boot against a real `userData` profile: JSON files in, migrated SQLite rows +
> `.migrated` renames out, and a corrupt-DB boot that still comes up. The unit layer proves
> each store's migration logic offline; this spec pins the end-to-end truth (boot sequence,
> real Electron userData path, WAL file family on disk, quit ordering). Requires the
> out-of-band quit/relaunch harness proven at M09 F10 — if the running session has no rig
> (no admin MCP key / no dev instance), the run is HAT-scoped, not skipped-and-claimed.
>
> **Run-learned apparatus notes (first run, 2026-07-17)**: (1) MCP `openTab` cannot open
> `goldfinch://` internal pages under ANY identity — use `getChromeTarget` + `evaluate` of
> the FD-approved chrome globals (`kebabActionSettings()`, `openJarsPage()`,
> `createTab(url, null, {trusted:true})`). (2) Admin-tier keyed calls: use a one-shot Node
> script over `scripts/lib/mcp-client.mjs` (`connectAutomation({key})` +
> `parseDevMintLine()`) — key as a function argument only, never argv/env/disk/stdout.
> (3) Step 7's "leave `-wal`/`-shm`" reads "if present" — clean shutdown checkpoints them away.

## Intent

Verify that a real Goldfinch profile carrying pre-M10 JSON stores (`settings.json`,
`shields.json`, `containers.json`, `downloads.json`, `session.json`) boots into the
SQLite-backed stores with every surface's data intact (settings values, jar definitions
including per-jar retention, download records, session snapshot), the JSON files renamed to
`.migrated`, and the `app.db` WAL family present — and that a corrupt `app.db` never stops
the app from booting (quarantine-and-recreate to defaults).

## Preconditions

- The live rig is up-able: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
  npm run dev:automation` (Wayland). Admin MCP key by env-var reference ONLY, never a
  command literal (standing carry).
- **A seedable profile**: either a dedicated userData dir the launcher can be pointed at, or
  the dev profile with a pre-test backup and post-test restore (the app must NOT be running
  while seeding). Confirmed at leg design (apparatus premise).
- The out-of-band quit/relaunch harness (M09 F10 precedent): clean quit via the
  `windowClose` chrome bridge (never SIGKILL), relaunch against the SAME profile, reconnect
  admin MCP.
- Seed fixture: JSON files with distinctive, non-default values — e.g. a custom `homePage`,
  a named jar with non-default `retentionDays`, ≥1 download record, a session snapshot with
  ≥1 restorable tab, a shields override + paused site.

## Observables Required

- **filesystem** — `userData` contents before/after boot: JSON files, `.migrated` renames,
  `app.db`/`-wal`/`-shm` family, `.corrupt-<epoch>` quarantine siblings (measured via Bash).
- **browser** — migrated state read back through the live app: goldfinch admin MCP
  (`evaluate` against internal pages / IPC-backed reads), `goldfinch://jars` and
  `goldfinch://settings` UI state.
- **shell** — the out-of-band launch/quit/relaunch of the OS process (Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | With the app not running, seed the profile's `userData` with the fixture JSON files (distinctive non-default values); remove any existing `app.db` family. | (setup — files in place, byte-verifiable) |
| 2 | Launch the app (dev:automation, out-of-band); connect admin MCP. | App boots to a usable window. `userData` now contains the `app.db` family; each seeded JSON file is renamed `*.json.migrated`; no bare `*.json` store files remain. |
| 3 | Read back settings: open `goldfinch://settings`, inspect the home-page field (and via MCP `evaluate`, `settingsGet('homePage')`). | The seeded custom `homePage` value — not the default — is live. |
| 4 | Read back jars: open `goldfinch://jars`; enumerate jars and the seeded jar's retention control. | The seeded jar exists with its name, color, and non-default `retentionDays` intact; default-jar designation preserved. |
| 5 | Read back downloads + shields + session surfaces (downloads page list; shields state via internal read; session-restore setting). | The seeded download record is listed; the shields override + paused site are live; the session-restore toggle reflects the seeded value. |
| 6 | Clean quit (windowClose bridge). Relaunch. Re-read one value per store. | Second boot reads identical state from the rows alone (no JSON left to re-import) — migration is one-time, not re-run. |
| 7 | Quit. Corrupt `app.db` (truncate/garbage bytes; leave `-wal`/`-shm`). Relaunch. | App boots to a usable window with default settings/jars (fresh defaults, DD6); `userData` shows a `app.db.corrupt-<epoch>` quarantine family and a fresh `app.db`; `.migrated` files are NOT re-imported. |
| 8 | Quit; restore the profile backup if the dev profile was used. | (teardown) |

## Out of Scope

- Retention behavior for cookies/site data (Flight 2's spec).
- History-store migration (already on SQLite since M08; `history.db` untouched here).
- safeStorage/encryption (seam preserved, not built — unit-layer concern).

## Variants (optional)

- Fresh-profile variant: empty `userData` (no JSON at all) → boots with defaults, rows
  seeded, no `.migrated` files (nothing to migrate).
