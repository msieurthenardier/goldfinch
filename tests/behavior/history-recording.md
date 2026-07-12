# Behavior Test: Jar visits are recorded and survive restart; burner and internal navigation leave zero rows

**Slug**: `history-recording`
**Status**: active
**Created**: 2026-07-12
**Last Run**: 2026-07-12-19-37-28 (pass — 8/8 checkpoints, first run; live two-agent mode)

## Intent

Verify Mission 08's recording criteria in the running app: navigating web pages
in a **jar-backed** tab produces history rows (address, title, visit time)
keyed to that jar in the on-disk store, those rows **survive a full app
restart**, and — the privacy half — **burner** tabs and **internal**
(`goldfinch://`) pages produce **zero rows anywhere** (structural exclusion,
not a filter).

This needs a behavior test rather than a unit test because the properties are
decided by the live wiring: real `did-navigate` / `did-navigate-in-page`
events on real `WebContentsView` guests, the real partition string threaded
from `tab-create` into the recorder, the real registry resolution
(positive allowlist), and a real SQLite file under the dev profile that must
persist across a process exit and relaunch. The recorder's decision table
(allowlist × scheme × duplicate suppression) is unit-backed; this spec
exercises the end-to-end pipeline and the on-disk truth.

**Scope honesty:** this spec asserts recording and exclusion at the **store**
(the on-disk database — the system's single history truth). It does NOT assert
any UI surface (Flight 2–3), omnibox suggestions (Flight 4), or the automation
read tool / cross-jar isolation of read surfaces (Flight 5's
isolation specs).

## Preconditions

- Goldfinch launched via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1` and `GOLDFINCH_AUTOMATION_ADMIN=1`
  (admin key printed at launch — the admin tier is used to stage/drive tabs
  across jars and to read the chrome). Export `GOLDFINCH_MCP_PORT` for a
  deterministic endpoint.
- Dev-profile isolation means the store under test is
  `~/.config/goldfinch-dev/history.db` (the dev `userData`). The Executor
  locates it once and reuses the path. **Read path (load-bearing):** the
  database is WAL-mode, so a second process may read while the app runs —
  reads are performed via `node -e` with `node:sqlite`
  (`new DatabaseSync(path, { readOnly: true })`; Node ≥22 on the host,
  confirmed at flight design). The `chrome-devtools` MCP does NOT qualify as
  drive apparatus (launches its own browser — the standing Goldfinch trap).
- At least two persistent jars exist (`personal` — or the resolved default —
  plus any second jar); jar ids are read from the chrome or `containers.json`.
- A local fixture server is NOT required — steps use stable public-free
  URLs served from a local `python3 -m http.server` over
  `tests/behavior/fixtures/` (any static fixture page works; what matters is
  distinct URLs with distinct `<title>`s).
- A clean baseline is helpful but not required: steps assert **deltas**
  (row counts before/after each action), so pre-existing rows don't fail the
  run.

## Observables Required

- filesystem (the `history.db` rows: jar_id, url, title, visited_at — measured
  via `node -e` + `node:sqlite` read-only queries through Bash)
- browser (tab staging and navigation state — driven and observed via the
  goldfinch MCP apparatus: `openTab`, `navigate`, `enumerateTabs`, admin
  `evaluate` on the chrome for burner-tab creation)
- shell (app launch/relaunch, stdout key capture, fixture server — via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Setup + apparatus probe.** (Setup:) start the fixture server; launch the app with the mint envs; capture the admin key; connect the MCP client; locate `history.db` under the dev profile; record the baseline row count `N0` via the read path. | `initialize` succeeds as admin; `history.db` exists (or is created on first launch) and the read-path query returns a number. **If the DB can't be read while the app runs, halt — apparatus premise broken.** |
| 2 | **Jar visit is recorded with address + time.** In a persistent jar (the resolved default), navigate a tab to fixture URL A. Wait for load. Query the DB for rows with `url = A`. | Exactly one new row for URL A exists, `jar_id` equals the jar's id, `visited_at` is within the last minute. Total rows = `N0 + 1` (± unrelated browsing noise — the Validator judges on the URL-A delta, not the absolute count). |
| 3 | **Title is backfilled.** Re-query URL A's row after the page has finished loading. | The row's `title` equals fixture page A's `<title>` text (backfill via `page-title-updated` reached the same row — no second row was created for the title). |
| 4 | **SPA navigation records.** Drive an in-page navigation on the same tab (fixture page's pushState link, or `evaluate: history.pushState` + verify URL bar) to URL A#/route or A?spa=1. Query for the new URL. | A new row exists for the in-page URL in the same jar (`did-navigate-in-page` records). |
| 5 | **Second jar's visits key to its own jar id.** Open a tab in a **different** persistent jar (admin `openTab` with that `jarId`, or via the UI container picker); navigate it to fixture URL B. Query for URL B. | URL B's row carries the **second** jar's `jar_id` — recording keys to the visited tab's jar, not the default jar. |
| 6 | **Burner navigation leaves zero rows.** Record row count `N1`. Open a **burner** tab (UI `▾` picker → Burner, or admin evaluate on the chrome's `createTab` seam); navigate it to fixture URL C (a URL used nowhere else this run); wait for load. Query for URL C and re-count. | **Zero rows** contain URL C; total row count is unchanged from `N1` by the burner activity. Nothing from the burner session is persisted. |
| 7 | **Internal pages leave zero rows.** Open `goldfinch://settings` (kebab ⋮ → Settings) and `goldfinch://jars` (kebab → Cookie jars); wait for load. Query for any row whose url starts with `goldfinch://`. | **Zero rows** with a `goldfinch://` URL exist (scheme allowlist + no registered-jar partition — doubly excluded). |
| 8 | **Rows survive a full restart.** Quit the app via **kebab ⋮ → Exit** (the `app-quit` IPC → `app.quit()` — the only path guaranteed to fire `will-quit` and close the store; do NOT SIGTERM a single launcher PID — `dev-launch.mjs` spawns Electron as a plain child with no signal forwarding, so a stray-PID signal can miss the app entirely; if a signal must be used, deliver it to the **process group**). Confirm process exit. Query the DB again (now sole reader) for URLs A and B. Relaunch via `npm run dev:automation` (same envs); reconnect; query once more. | Rows for A (with title) and B are present after quit AND after relaunch — recording is durable, WAL contents were not lost on close. The relaunched app appends new visits normally (its startup produces no duplicate rows for A/B by itself). |

## Out of Scope

- History UI (panels, search, delete, clear) — Flights 2–3.
- Omnibox suggestions and felt-instant-at-scale — Flight 4.
- Read-surface jar isolation (page/omnibox/automation cannot read a foreign
  jar) — Flight 5's isolation specs close those mission criteria.
- Retention pruning timing (unit-backed; the hourly tick is impractical to
  witness live).
- Duplicate-suppression window mechanics (unit-backed decision table).

## Variants (optional)

- Re-run Step 6 with the burner tab opened via `window.open` from a jar page
  (popup inheritance path) once popup-burner staging is convenient.
- After Flight 3 lands, extend Step 8 to assert the history panel renders the
  restored rows (the UI read path).
