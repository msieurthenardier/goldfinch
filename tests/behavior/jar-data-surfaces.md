# Behavior Test: Jar data surfaces — cookies & site-data listings + generalized retention

**Slug**: `jar-data-surfaces`
**Status**: active
**Created**: 2026-07-17
**Last Run**: 2026-07-17-23-48-56 (partial 6/7 — checkpoint 6 cookie clause: spec premise gap, amended; see runs/)

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
- Dev profile backup/restore (the F1 pattern) — the test seeds real cookie/storage state.
- The pre-existing `work` jar. If it contains a real origin whose last activity is older
  than the 1-day floor, Step 6 must witness that origin disappear; if no such origin exists,
  record the premise as absent rather than inventing a time-travel fixture. Fresh-data survival
  remains mandatory, and cutoff arithmetic remains unit-pinned. **Cookie-removal-by-age is NOT observable on a first-ever sweep** (cold-start
  stamping — see step 6 as amended); a jar whose `cookie_seen` bookkeeping predates the
  run by more than the window is required to witness a live cookie removal (HAT-scoped
  after run 1).
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
- **shell/filesystem** — launch/quit lifecycle; profile backup/restore.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Backup profile. Launch rig. In jar `work`, open a real `http(s)://` page and drive it (via `evaluate` on the PAGE's own wcId) to set ≥2 cookies (distinct names/expiries, e.g. `document.cookie`) and seed IndexedDB (`indexedDB.open` + a `put`) for its origin. | (setup) |
| 2 | Open `goldfinch://jars` (chrome global `openJarsPage()`), select jar `work`, activate the Cookies tab. | The seeded cookies are listed with name, domain, and expiry visible (no `value` field anywhere in the DOM/AX tree — DD7); count and identities match a `ses.cookies.get` read through the admin client. |
| 3 | Delete one listed cookie via its per-cookie delete affordance (no confirm — single-item delete is unconfirmed by design). | The row disappears from the panel; `ses.cookies.get` no longer returns it; the other seeded cookie survives. |
| 4 | Activate the Other-site-data tab. | The fixture origin appears tagged **"Has stored data"** (the IndexedDB-confirmed tier — DD3 VERDICT composite union); pre-existing `work`-jar origins with only history activity (no IndexedDB) appear tagged **"Visited — storage unconfirmed"**; no usage/quota figure is rendered anywhere (confirmed absent from Electron's API); the panel's known-gap note (localStorage-only / never-visited origins are invisible to both tiers) is present in the DOM. |
| 5 | Delete the fixture origin's site data via its per-origin delete (no confirm). | The origin's row DOWNGRADES from "Has stored data" to "Visited — storage unconfirmed" (its history row survives — storage and history are independent data, matching the documented no-op-on-history edge case) rather than disappearing entirely; re-driving the fixture page confirms `indexedDB` for that origin is empty. The fixture's COOKIES (set in step 1, survived step 3's single delete) are UNCHANGED by this action — the per-origin delete's storage-class set excludes cookies (`src/shared/jar-data-classes.js`'s `'storage'` descriptor), a distinct data-class boundary from the Cookies panel's own delete. |
| 6 | Re-seed the fixture cookie + IndexedDB data (fresh, age ≈ 0). Note the CURRENT set of `work`-jar cookies/origins pre-existing from real prior use and whether any origin has last activity older than one day. Via the chrome bridge (`evaluate` on the chrome wcId: `window.goldfinch.jarsSetRetention({ id: <work-jar-id>, days: 1 })` — the proven mechanism class, NOT the internal page's `<select>`), shrink `work`'s retention to the 1-day floor, triggering the immediate one-jar sweep (DD6). Wait for the async sweep's `jar-data-changed` broadcast (panel repaint / polled reads). | **Storage/history half**: the freshly re-seeded fixture IndexedDB data SURVIVES ("Has stored data" intact). If the recorded precondition includes a real >1-day origin/history row, it is removed on the same pass; if not, record **aged-origin premise absent** and rely on the unit-pinned cutoff arithmetic rather than fabricating age. Both panels, if open, repaint via `jar-data-changed` without manual refresh. **Cookie half (amended after run 1 — cold-start semantics)**: on a jar's FIRST-ever sweep, NO cookies are removed regardless of age — the stamp-before-expire ordering (deliberate, unit-pinned: prevents deleting real cookies before any bookkeeping exists) stamps every unseen cookie `firstSeenMs=now` in the same pass. The observable here is: all cookies SURVIVE the first sweep (identical identity set pre/post). Removal-by-age becomes live-observable only in a LATER session against the now-populated `cookie_seen` table — **HAT-scoped witness** (run 1 disposition); the aging arithmetic itself is unit-covered (`retention-sweep.test.js`). |
| 7 | Manual controls regression: use the panel's Clear-cookies control on the jar. | All jar cookies gone (panel empty + session read empty); other data classes (site data, history) untouched — the manual clear path is unchanged by this flight's retention-sweep work. |
| 8 | Quit (`window.goldfinch.appQuit()`); restore profile backup. | (teardown) |

## Out of Scope

- Store migration (covered by `sqlite-store-migration`).
- Live cookie-removal-by-age on a first-ever sweep (structurally impossible — cold-start
  stamping; witnessed cross-session at HAT instead).
- Exact retention window-boundary math (day-granularity cutoff arithmetic, the
  stamp-then-expire ordering, the overwrite-cause handling) — covered by
  `retention-sweep.test.js` / `app-db.test.js` / `jar-ipc.test.js`'s unit-pinned SEQUENCING
  and ordering tests; this run verifies the live mechanism fires end-to-end and
  discriminates fresh-vs-aged data, not the precise arithmetic.
- Per-class retention windows (out of mission scope — single per-jar dial).

## Variants (optional)

- Burner-jar variant: burner tabs expose no persisted listing surface (structural absence).
