# Squawk 0156: Automation behavior specs read a retired settings.json and stale status strings

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: 2026-10-24

## Report
Three behavior specs for the Automation controls can't be run as written: `settings-automation`, `settings-activity-viewer` and `automation-key-gating`. Two of them read the persisted store from `<dev-userData>/settings.json`, which no longer exists, because settings now live in `app.db`'s `documents` table. `settings-automation` step 4 also expects pre-Flight-8 status/note strings. A straight run would report failures caused by the stale specs, not the app. Found at Sortie 05's HAT, where the operator skipped the runs on this basis. Re-author all three to the current store and strings, then re-run them against `goldfinch://automation`.

## Evidence
- `tests/behavior/settings-automation.md` (4 hits) and `tests/behavior/automation-key-gating.md` (5 hits, e.g. lines 40/52/70) read `settings.json`. That file is absent from the dev profile. The store is `src/main/app-db.js` `documents(store PK, payload, updated_at)`, row `'settings'`.
- `settings-automation.md` step 4 expects `Not running — start Goldfinch with --automation-dev…` and `Takes effect when Goldfinch is launched with --automation-dev.`. `src/renderer/pages/automation.js` renders `Not running — turn on the Automation toggle to bind the surface` and `Binds the local automation surface.` instead.
- Last runs: `settings-automation/runs/2026-07-08-19-13-05.md`, `automation-key-gating/runs/2026-07-08-23-34-09.md`, `settings-activity-viewer/runs/2026-07-08-23-22-11.md`.
- `settings-activity-viewer.md` has no `settings.json` read. Include it in the re-run anyway, because none of the three ran after Sortie 05 moved the page.

## Corrective Action
Re-authored the three specs against the current app (`goldfinch://automation`, sortie 05, `app.db` settings store); no app code changed. Each spec carries a dated "Re-authored 2026-10-23 (squawk 0156)" note at the top; slugs and the existing step numbering are kept.

**Verified store-read recipe** (replaces every `settings.json` read; read-only, safe while the app runs; run against the dev profile on this machine, app not running). The store is `~/.config/goldfinch-dev/app.db`, table `documents(store PK, payload, updated_at)`, row `store = 'settings'`; the real payload fields found are `automationEnabled` (bool), `automationPort` (int, 49707), `automationKeyHashes` (object jarId -> hash; here `personal`, `work`), `automationAdminKeyHash` (64-char string, `''` when none) alongside `version`, `homePage`, `toolbarPins`, `spellcheck`, `restoreSession`, `vaultAutoLockMinutes`, `bookmarksBarEnabled`, `searchEngine`:

```sh
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(require('os').homedir()+'/.config/goldfinch-dev/app.db',{readOnly:true});const s=JSON.parse(db.prepare(\"SELECT payload FROM documents WHERE store='settings'\").get().payload);console.log(JSON.stringify({automationEnabled:s.automationEnabled,automationPort:s.automationPort,jarKeys:Object.keys(s.automationKeyHashes||{}).sort(),adminKeySet:!!s.automationAdminKeyHash}))" 2>/dev/null
```

It prints key names and a boolean, never hashes (Node >= 22; the `ExperimentalWarning` goes to stderr). Caveat: the DB is WAL-mode (`app.db-wal`/`-shm` present); a read-only open sees committed state, each settings write is one committed whole-document UPSERT, and readers never block the app's writer, so re-run once if a read looks a step stale. Never write to `app.db` while the app runs. Also verified, against a scratch COPY of the profile, a B0 snapshot recipe (before launch) and an Orchestrator restore recipe (after the app has fully quit) for `automationEnabled`/`automationPort`/`automationKeyHashes`/`automationAdminKeyHash`.

**`settings-automation`**: store reads -> the recipe; status/note strings -> `Connected — listening on 127.0.0.1:{port}` (note empty) with the `Not running — turn on the Automation toggle to bind the surface` / `Binds the local automation surface.` / `Failed to bind: …` branches marked unobservable under `dev:automation` (harness needs the bound surface); `<input>` `.value`/`.checked` reads moved from `readDom` (not in `outerHTML`) to `evaluate` on the guest; copy message for keys is `#automation-key-message` (address/config copy is `#automation-message`); dev-override truth (toggle flips don't unbind); port Save/Find-free-port live-rebind (the "next launch" claim removed; `GOLDFINCH_MCP_PORT` wins so persisted != bound, sessions drop and are reconnected); admin mint rotates the harness's own key so Step 10 mints inside one `evaluate` and reconnects; Step 8 targets a non-default jar so the Step 11 staged key survives; click fallback via `evaluate` `.click()` marked `partial`; indicator title format re-stated; new **Step 14** cleanup (restore port, revoke run-minted keys, restore toggle, then admin revoke last) plus Orchestrator B0 snapshot/restore.
**`automation-key-gating`**: store reads -> the recipe; precondition no longer assumes the toggle starts OFF (this profile has it ON) — Step 1 records `enabledStart` and sets OFF; launch/attach recipe; dev-override assertions on Steps 4/5; **Step 7** cleanup restores the toggle, plus B0 restore.
**`settings-activity-viewer`**: no store read existed; re-checked against the moved page — real pager DOM (`nav#automation-activity-pager`, aria-labelled buttons, `aria-current`), `PAGE_SIZE = 20` (still read from the control), no separate back-to-live control or paused counter, empty-state strings, `connected since` rows; launch recipe; state-hygiene note (nothing persisted is mutated).

Not run (per instructions): the app was not launched and the specs were not executed. Assertions derived from code reading and not yet seen live: live-rebind dropping the harness session, the port field resetting to the env-pinned bound port after Save, and the admin-rotate self-lockout flow.

## Verification
The three re-authored specs will be run by the Flight Director via the behavior-test skill (`/mission-control:behavior-test`) against a dev-mode launch at this turnaround; run logs to be linked here. Original plan: re-author the store reads to a read-only `node:sqlite` query of `app.db` `documents` (`store = 'settings'`) and correct the status/note strings. Then run `/mission-control:behavior-test` for each of the three slugs against a dev-mode launch.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. Strings and ids match source, and the store recipe uses `~/.config/goldfinch-dev/app.db` via `os.homedir()` with no operator identity. Edits are confined to the three specs, and no historic run logs were touched. Verified by live runs: `settings-automation` 14/14 (`runs/2026-10-23-23-19-44.md`), `automation-key-gating` 7/7 (`runs/2026-10-23-23-56-29.md`) and `settings-activity-viewer` 8/8 (`runs/2026-10-24-00-03-48.md`). The dev profile was restored to its B0 snapshot after each run. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`

## Disposition
**Deferred**: logged mid-flight during Sortie 05's HAT, where the operator ruled to skip the runs. Revisit at the next squawk turnaround, or before any flight that changes the Automation page or the automation key/settings handlers.
