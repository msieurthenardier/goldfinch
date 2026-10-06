# Behavior Test: Jar data surfaces — cookies & site-data listings + generalized retention

**Slug**: `jar-data-surfaces`
**Status**: active
**Created**: 2026-07-17
**Last Run**: 2026-10-06-13-24-48 (pass, 7/7 judged, batched; sortie 02 AC12/DD8 re-run under native 3P cookie blocking; step 6 premise unreachable on a fresh profile; see runs/2026-10-06-13-24-48.md)

> Drafted at M10 F2 flight design; **finalized at leg 3** against the leg-1 spike verdicts
> (Spike A: cookie first-seen bookkeeping, DD4 VERDICT; Spike B: composite IndexedDB +
> history-derived origin union, DD3 VERDICT), the leg-2 live smoke check's findings (the
> default-port `_0` dirname sentinel; `Local Storage` is NOT origin-parseable — only
> IndexedDB is, so the fixture below seeds IndexedDB, not `localStorage`), and DD4b's
> storage-aging ruling (since-last-activity, not since-creation). No `[SPIKE]` markers
> remain. Apparatus facts inherited from the `sqlite-store-migration` first run: internal
> pages open via `getChromeTarget` + `evaluate` of FD-approved chrome globals
> (`openJarsPage()`); admin-tier keyed calls via the one-shot `scripts/lib/mcp-client.mjs`
> mechanism (key as function argument only); internal-session evaluate is uniformly
> refused — assert via chrome-bridge reads + DOM/AX/screenshot of the internal tab.

## Intent

Verify, against the real app, that the `goldfinch://jars` Cookies and Other-site-data
panels list what a jar's session actually holds (with per-item delete that really deletes),
and that shrinking a jar's retention window drives the generalized retention sweep (cookies
by first-seen age, site data by last-activity age) on the retention-edit immediate-sweep
path — behavior spanning Chromium session state, main-process IPC, and internal-page UI
that no unit test can observe.

## Preconditions

- Live rig launchable (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
  npm run dev:automation`); admin key via the sanctioned one-shot client mechanism ONLY.
- **Isolated profile (replaces the dev-profile backup/restore pattern).** Every launch
  uses `XDG_CONFIG_HOME={scratch}/xdg`, a fresh scratch directory created for this run
  (Electron derives `appData` from it on Linux, so the dev profile's `userData` lands under
  the scratch dir; the operator's own profile is never touched). Launch stdout/stderr goes
  to a private, `chmod 600` evidence dir (`private/`), NEVER a shared evidence dir: the
  `AUTOMATION_DEV_MINT` line carries live keys. Teardown deletes the scratch profile.
- Because the profile is fresh, no real aged data exists. Step 6's aged-data premise is made
  reachable by **backdating** (steps 6a-6b): while the app is CLOSED, rewrite
  `history.db` `visits.visited_at` (ms epoch; schema in `src/main/history-store.js`) and
  `app.db` `cookie_seen.first_seen_ms` (ms epoch; PK `jar_id, name, domain, path`; schema in
  `src/main/app-db.js`) via `node:sqlite`. Re-launching mints new keys: re-capture them.
  Aged-data survival/removal is therefore witnessed live, not recorded as "premise absent".
- Fixture mechanism (flight-log Decisions, "Fixture-mechanism ruling", live-verified at
  leg 1): drive a real page in the jar via `evaluate` on the PAGE's own wcId (not the
  internal session, which refuses `evaluate`) — `document.cookie = 'name=value;
  max-age=<n>; path=/'` for cookies, `indexedDB.open(...)` + a `put` for site data
  (`localStorage` is deliberately NOT used as a fixture — Spike B measured it as a single
  consolidated, non-origin-keyed leveldb store with no origin recoverable from it, so a
  localStorage-only origin is invisible to the Other-site-data panel by design, not a bug
  to work around here).

## Observables Required

- **browser/app** — jars page panel DOM/AX + screenshots; chrome-bridge and session reads
  via the admin one-shot client (goldfinch MCP + mcp-client.mjs).
- **shell/filesystem** — launch/quit lifecycle; isolated scratch profile; `node:sqlite`
  reads/writes of `history.db` and `app.db` while the app is closed.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Create the isolated scratch profile (Preconditions). Launch rig. In jar `work`, open a real `http(s)://` page and drive it (via `evaluate` on the PAGE's own wcId) to set ≥2 cookies (distinct names/expiries, e.g. `document.cookie`) and seed IndexedDB (`indexedDB.open` + a `put`) for its origin. | (setup) |
| 2 | Open `goldfinch://jars` (chrome global `openJarsPage()`), select jar `work`, activate the Cookies tab. | The seeded cookies are listed with name, domain, and expiry visible (no cookie value in the DOM/AX tree absent an explicit per-row reveal click — DD7, reveal rider e07e21a; never click reveal in this step); count and identities match a `ses.cookies.get` read through the admin client. Independent corroboration of the session read: the page's own `document.cookie` (non-HttpOnly cookies) and the fixture server's request log agree with it. |
| 3 | Delete one listed cookie via its per-cookie delete affordance (no confirm — single-item delete is unconfirmed by design). | The row disappears from the panel; `ses.cookies.get` no longer returns it; the other seeded cookie survives. |
| 4 | Activate the Other-site-data tab. | The fixture origin appears tagged **"Has stored data"** (the IndexedDB-confirmed tier — DD3 VERDICT composite union); pre-existing `work`-jar origins with only history activity (no IndexedDB) appear tagged **"Visited — storage unconfirmed"**; no usage/quota figure is rendered anywhere (confirmed absent from Electron's API); the panel's known-gap note (localStorage-only / never-visited origins are invisible to both tiers) is present in the DOM. |
| 5 | Delete the fixture origin's site data via its per-origin delete (no confirm). | The origin's row DOWNGRADES from "Has stored data" to "Visited — storage unconfirmed" (its history row survives — storage and history are independent data, matching the documented no-op-on-history edge case) rather than disappearing entirely; re-driving the fixture page confirms `indexedDB` for that origin is empty. The fixture's COOKIES (set in step 1, survived step 3's single delete) are UNCHANGED by this action — the per-origin delete's storage-class set excludes cookies (`src/shared/jar-data-classes.js`'s `'storage'` descriptor), a distinct data-class boundary from the Cookies panel's own delete. |
| 6 | **Seed.** Re-seed the fixture (fresh, age ≈ 0) so three origins/cookie sets exist in `work`: origin **C** (IndexedDB + a history visit; to be aged), the fresh fixture origin (IndexedDB + visit; stays fresh), and cookies including one cookie **K** with partition duplicates (a CHIPS/third-party copy via the third-party-cookies fixture, so `K` appears as ≥2 session rows) plus a fresh cookie **F**. Refresh BOTH panels (Cookies, Other site data) after the re-seed, then record the pre-sweep panel and `ses.cookies.get` state. Quit the app (`window.goldfinch.appQuit()`). | (setup) Both panels, after refresh, match the session read; C shows "Has stored data". |
| 6a | **Backdate while the app is CLOSED.** With `node:sqlite` against the scratch profile's `history.db`: `UPDATE visits SET visited_at = <now-2d ms> WHERE jar_id='work' AND url LIKE '<C origin>%'`. Against `app.db`: `UPDATE cookie_seen SET first_seen_ms = <now-2d ms> WHERE jar_id='work' AND name='<K>'` (one row per merged identity; `cookie_seen` merges partition copies, so the one row covers every copy). Leave F and the fresh origin untouched. Read both tables back to confirm. | The updates affect exactly the intended rows (record row counts); no other row changed. |
| 6b | Relaunch (same scratch profile, new mint: re-capture the keys). Reopen `goldfinch://jars`, select `work`, refresh both panels; record pre-sweep state. Via the chrome bridge (`evaluate` on the chrome wcId: `window.goldfinch.jarsSetRetention({ id: 'work', days: 1 })` — NOT the internal page's `<select>`), shrink retention to the 1-day floor, triggering the immediate one-jar sweep (DD6). Do NOT manually refresh the panels afterward; wait for the async sweep's `jar-data-changed` broadcast (panel repaint / polled reads). | **Positive evidence the sweep ran (required; a no-op sweep must fail, not pass vacuously):** a `jar-data-changed` event for `work` is observed whose `classes` include the swept classes, AND at least one backdated item actually vanished. **Storage/history half**: C's visits are pruned and C's IndexedDB is cleared (C gone from the Other-site-data panel, or its tag no longer "Has stored data"); the fresh fixture origin SURVIVES ("Has stored data" intact). **Cookie half**: `cookie_seen` is stamped at SET time by the cookies listener (`session-runtime.js`), so the backdated row is a genuinely aged row (not a cold-start stamp) and the sweep removes it: EVERY partition copy of `K` is gone from the session read (cookies listener's delete path also drops its `cookie_seen` row); `F` and its fresh `cookie_seen` row survive. Both panels repaint via `jar-data-changed` without manual refresh and match the post-sweep session read. |
| 6c | **DD8 per-row delete of a duplicate.** Re-seed another partitioned cookie `K2` (≥2 session rows differing only by partition/expiry; seeded fresh, same identity merged to ONE `cookie_seen` row). Refresh the Cookies panel; confirm both duplicate rows are listed. Delete ONE of the two rows via its per-row delete. | BOTH duplicate rows disappear from the panel (the delete is by merged identity); the session read (`ses.cookies.get`, corroborated by page `document.cookie` and the fixture log) shows no `K2` copy; the merged `cookie_seen` row for `K2` is removed (read from `app.db` after step 8's quit, or via the admin bridge if exposed); other cookies survive. |
| 7 | Manual controls regression: use the panel's Clear-cookies control on the jar. | All jar cookies gone (panel empty + session read empty); other data classes (site data, history) untouched — the manual clear path is unchanged by this flight's retention-sweep work. |
| 8 | Quit (`window.goldfinch.appQuit()`); delete the scratch profile and the private launch-log dir. | (teardown) |

## Out of Scope

- Store migration (covered by `sqlite-store-migration`).
- Exact retention window-boundary math (day-granularity cutoff arithmetic, the
  stamp-then-expire ordering, the overwrite-cause handling) — covered by
  `retention-sweep.test.js` / `app-db.test.js` / `jar-ipc.test.js`'s unit-pinned SEQUENCING
  and ordering tests; this run verifies the live mechanism fires end-to-end and
  discriminates fresh-vs-aged data, not the precise arithmetic.
- Per-class retention windows (out of mission scope — single per-jar dial).

## Variants (optional)

- Burner-jar variant: burner tabs expose no persisted listing surface (structural absence).
