# Behavior Test: Automation page Activity viewer — render, paginate, freeze-on-page-back

**Slug**: `settings-activity-viewer`
**Status**: draft
**Created**: 2026-06-17
**Last Run**: 2026-10-24-00-03-48 (pass — 8/8; see `settings-activity-viewer/runs/`)

> **Re-authored 2026-10-23 (squawk 0156).** This spec never read `settings.json`, but it had not run since Sortie 05 moved the
> viewer to `goldfinch://automation`, so it was re-checked against `src/renderer/pages/automation.js`/`automation.html`/
> `audit-paging.js`: launch recipe updated (`GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 … npm run
> dev:automation`, `connectAutomation()` env-key attach); the pager is now specified by its real DOM (`<nav
> id="automation-activity-pager" aria-label="Activity log pages">`, buttons `‹`/`›` with aria-labels `Previous page`/`Next
> page`, number buttons `Page N` / `Page N, current page` with `aria-current="page"`, hidden when the log is empty); page size
> is 20 (still read from the control); there is **no** separate "back-to-live" control (page `1` / prev is it); empty states
> are `No recent activity` / `No automation sessions`; session rows read `connected since <time>`. A state-hygiene note was
> added (no persisted state is mutated; the launch's `DEV_MINT` mint is the only profile change). Step numbering kept.

## Intent
Verify that the `goldfinch://automation` page's **Activity** viewer correctly **renders** the audit
log inside the privileged internal guest and **paginates** it with the conventional numbered control
(`‹ 1 2 3 … ›`), honoring the F7 freshness contract: **page 1 is live** (re-renders as new entries
arrive) while **page 2+ is frozen** at the moment it was opened (older entries do not slide mid-read),
with **back-to-live** resuming page 1. This needs a behavior test, not a unit test, for two reasons the
F7 debrief made concrete: (1) the viewer renders inside a guest WebContentsView on the `goldfinch://`
scheme, and its subresource (`audit-paging.js`) must be **served** via `INTERNAL_PAGES` — a renderer-in-guest
**serve seam** that unit tests structurally cannot reach (it 404'd at the F7 HAT and rendered nothing);
and (2) the freeze/live state machine is wired to **live broadcasts** that only fire against a running
MCP session over the loopback transport. The pure paging logic is already unit-tested
(`test/unit/audit-paging.test.js`); this test guards the **integration** — that the served module,
the rendered DOM, and the live-broadcast wiring actually compose in the real guest. It backs the
**SC10 audit-log viewer** (review what automation did) and closes the F7-debrief gap that the serve
seam had no live regression guard.

## Preconditions
- **Apparatus — admin MCP surface (identical to `settings-automation`).** Goldfinch running via
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT={port} npm run dev:automation`. Capture the
  one parseable `AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}` stdout line (both keys shown once). Attach an
  admin client with `connectAutomation({ key: adminKey, port })` from `scripts/lib/mcp-client.mjs` (env-key model) on
  `127.0.0.1:{port}/mcp` — never the registered `goldfinch-dev` MCP server (`docs/dev-testing.md`). See `settings-automation.md` Preconditions for the full apparatus,
  coordinate-click rule, focus-anchor rule, and the two-target (`chrome` vs `guestWcId`) discipline —
  this spec assumes them and does not repeat them.
- **F8 note (load-bearing for launchability).** In **dev** the surface binds regardless of the persisted
  `automationEnabled` toggle (dev-enable override — the `npm run dev:automation` script carries `--automation-dev`; never pass
  it by hand), so `npm run dev:automation` is the apparatus whatever the toggle says. The toggle-binds production change does **not** alter the dev harness; do
  not attempt to drive a *packaged* build for this spec (use the dev harness).
- **Dev profile + state hygiene (F8 DD1).** A `dev:automation` launch writes to the **isolated dev profile**
  (`~/.config/goldfinch-dev`), not the installed `~/.config/goldfinch`. Persisted settings live in its `app.db`
  (`documents` row `store = 'settings'`) — there is no `settings.json`. This spec reads **no** persisted state and mutates
  **none** (the audit ring is in-memory, lost on restart; page navigation is client state only), so it needs no in-run
  cleanup step. The only profile change is the launch's own `DEV_MINT` key mint; an Orchestrator who wants the profile
  byte-identical afterwards uses the B0 snapshot (before launch) / restore (after the app has fully quit) recipes in
  `settings-automation.md` Preconditions.
- **Reflexivity is an ASSET here.** The harness's own admin session emits an audit entry on **every**
  tool call (`readDom`, `readAxTree`, `getChromeTarget`, `enumerateTabs` — see `settings-automation.md`
  reflexivity note). This spec **exploits** that: driving the viewer naturally generates the many
  entries needed to exceed one page. To fill pages deterministically, the Executor may issue extra
  benign reads (e.g. repeated `readDom(guestWcId)`) until the entry count crosses a page boundary.
- **Page size is read from the rendered control, not assumed.** The spec refers to the page size as
  `{pageSize}` and to the total page count as `{pageCount}`; both are **derived from the rendered
  pager** (the number of `.activity-log-row` rows on page 1 / the highest page-number button shown), never hardcoded —
  `automation.js` currently sets `PAGE_SIZE = 20` over a 500-entry ring, but that is an implementation detail that may
  change. Row/pager DOM: rows are `.activity-log-row` (children `.activity-log-time`, `.activity-log-op`,
  `.activity-log-identity`, `.activity-log-outcome` = `ok` or `error[: code]`); the pager is `<nav
  id="automation-activity-pager" aria-label="Activity log pages">` (the `hidden` attribute is set while the log is empty) with
  `<button class="pager-btn">` children — `‹` (aria-label `Previous page`, `disabled` on page 1), page buttons (aria-label
  `Page N`, or `Page N, current page` plus `aria-current="page"` and class `current` on the current one), `…` spans, and `›`
  (aria-label `Next page`, `disabled` on the last page). Click targets are located via `captureWindow()` (coordinate clicks);
  if guest clicks do not land on the venue (WSLg), a synthetic `evaluate` `button.click()` on the aria-labelled button is the
  fallback, marking the row `partial` for input fidelity only.
- **The build includes F7's audit paging** — `src/shared/audit-paging.js` registered in
  `INTERNAL_PAGES` (served flat at `goldfinch://automation/audit-paging.js`, imported by `automation.js`), the numbered pager
  `<nav>` in `automation.html`, and the `reduceAudit` freeze state machine wired into the `automation.js` activity-viewer IIFE.

## Observables Required
- mcp (admin MCP tools — `readDom(guestWcId)` for the rendered `#automation-activity-log` + the numbered
  pager DOM (entry rows, page-number buttons, prev/next, the `aria-current="page"` marker); `captureWindow()`
  to locate page-number buttons for coordinate clicks; `enumerateTabs` for `guestWcId`; repeated reads
  to generate audit entries — all via the admin MCP client)
- shell (the `AUTOMATION_DEV_MINT` stdout line; `tools/list` probe — via the MCP client or Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe + serve-seam guard.** Connect the admin MCP client (`connectAutomation`); `tools/list`; `getChromeTarget()`. Open the Automation page (`evaluate({ wcId: <chrome wcId>, expression: "createTab('goldfinch://automation', null, { trusted: true })" })` — the chrome seam; the kebab click itself is [by-eye]/HAT); `enumerateTabs` → record `guestWcId`. `readDom(guestWcId)` and confirm the `<section id="activity">` AND a non-empty Activity viewer (`#automation-active-sessions` + `#automation-activity-log`) render. | `tools/list` returns the tool set incl. `getChromeTarget`; `getChromeTarget()` returns a numeric chrome `wcId`. The automation guest is enumerable. The viewer **renders with content** (not blank): `#automation-active-sessions` shows at least the harness's `admin` / `app / chrome` / `connected since <time>` row, and `#automation-activity-log` shows `.activity-log-row` rows (not the `No recent activity` empty-state, which cannot occur while a live admin session is generating entries) — i.e. `audit-paging.js` was **served** via `INTERNAL_PAGES` (no 404/blank — the exact F7-HAT regression). If the viewer is empty/blank despite a live admin session, **FAIL** (serve-seam regression). |
| 2 | (Setup — generate entries) Issue benign reads (repeated `readDom(guestWcId)` / `readAxTree(guestWcId)`) until the audit ring holds **more than one page** of entries (> `{pageSize}`; with `PAGE_SIZE = 20` that is > 20 calls — the page's own initial reads count). Re-open / re-render the viewer (`evaluate(guestWcId, "location.reload()")`; the `reload` tool refuses internal tabs). Read the pager DOM via `readDom(guestWcId)`; record `{pageSize}` (`.activity-log-row` count on page 1) and `{pageCount}` (highest page-number button). | (Setup row — no judgment.) The `#automation-activity-pager` `<nav>` loses `hidden` and a numbered pager appears once entries exceed one page. |
| 3 | Read the page-1 entry rows + the numbered pager control via `readDom(guestWcId)`. | Page 1 shows the **newest** entries (most-recent-first), at most `{pageSize}` rows (the newest are the harness's own `readDom`/`readAxTree`/`evaluate` calls, identity `admin`, outcome `ok`). The pager renders the **conventional numbered form** (`‹ 1 2 3 … ›`): a `‹` button (aria-label `Previous page`, `disabled` on page 1), contiguous page-number buttons (with `…` when `{pageCount}` is large), a `›` button (`Next page`), and **current page = 1** marked by `aria-current="page"` (aria-label `Page 1, current page`). `[a11y]` |
| 4 | **Page-1 liveness.** With page 1 shown, issue one more benign read (generates a new newest entry). Re-read the page-1 rows via `readDom(guestWcId)`. | Page 1 **re-renders live** — a brand-new entry (the benign read's `op`, identity `admin`) appears at the top of page 1 without a reload (page 1 tracks the live ring; the activity broadcast re-renders it). |
| 5 | **Navigate to page 2.** Locate the `Page 2` button via `captureWindow()`; `click({ wcId: guestWcId, x, y })`. Read the rows + the pager via `readDom(guestWcId)`; keep the page-2 row texts (time/op/identity) as `frozenRows`. | The viewer shows page 2's window (the entries `{pageSize}+1 … 2×{pageSize}`, older than page 1); the pager marks **current page = 2** (`aria-current="page"` on `Page 2, current page`; `‹` now enabled). |
| 6 | **Freeze-on-page-back.** While page 2 is shown, issue **several** more benign reads (new entries arrive at the live ring; note the reads that re-read this page add entries too). Re-read page 2's rows via `readDom(guestWcId)`. | Page 2's rows are **unchanged** from `frozenRows` — the page-2 window is **frozen** at the snapshot taken when it was opened; entries do **not** slide. (There is no on-page "paused / N newer" counter in the current UI — do not look for one; the assertion is that the visible page-2 rows do not shift.) This is the F7 freshness contract that prevents older entries sliding mid-read. |
| 7 | **Back to live.** Click the `Page 1` button (or `‹`) to return to page 1 (locate via `captureWindow()`; `click({ wcId: guestWcId, x, y })`). There is no separate back-to-live control. Read the rows + pager via `readDom(guestWcId)`. | The viewer returns to page 1 with **current page = 1**, page 1 reflects the **latest** ring state (including all entries added during the freeze), and liveness resumes (a subsequent benign read again appears at the top — optionally re-confirm). |
| 8 | (Boundary) If `{pageCount}` ≥ 3, navigate to the **last** page (click the highest page-number button). Read the rows. | The last page renders its (possibly partial) window of the **oldest** entries without error; the pager marks the last page current (`aria-current="page"`) and the `›` (`Next page`) button is `disabled`. *(Skip with `partial` if the ring never exceeds 2 pages in the run env.)* `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant (pager is a navigation control —
the optional Accessibility Validator checks focusability/labels). Step 1 is the **serve-seam guard** —
a blank viewer there is the load-bearing F7-HAT regression and is a hard FAIL. The viewer's text is rendered via `textContent` only, so `readDom` text reads are authoritative. Steps 4 + 6 together are
the **freshness contract** (page 1 live, page 2 frozen); a run that cannot generate entries fast enough
to distinguish them degrades those rows to `partial`, not fail. `{pageSize}`/`{pageCount}` are read from
the rendered control, never hardcoded.

## Out of Scope
- **The audit ring's data model + the pure paging math** (`windowPage`/`countNewer`/`reduceAudit`) —
  exhaustively unit-tested in `test/unit/audit-paging.test.js`. This spec verifies the **rendered,
  served, live-wired** composition only.
- **The indicator / session-list / zero-state** semantics — covered by `settings-automation`
  (Steps 11–13) and its leg-9 HAT framing.
- **Audit-log persistence / retention / clear** — explicitly deferred to a future mission (F7 DD4);
  the ring is in-memory and lost on restart.
- **Key management, toggle, port controls** — covered by `settings-automation`.

## Variants (optional)
- Could parametrize `{pageSize}` boundary conditions (exactly one full page → no pager; one-over →
  two pages) once the implementation's page size is pinned.
