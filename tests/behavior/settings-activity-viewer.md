# Behavior Test: Settings Activity viewer — render, paginate, freeze-on-page-back

**Slug**: `settings-activity-viewer`
**Status**: draft
**Created**: 2026-06-17
**Last Run**: 2026-06-17-17-23-30 — [run log](./settings-activity-viewer/runs/2026-06-17-17-23-30.md) (**partial** — serve-seam render guard Step 1 PASS (viewer not blank); pager/freeze Steps 2-8 carried, apparatus-limited)

## Intent
Verify that the `goldfinch://settings` **Automation → Activity** viewer correctly **renders** the audit
log inside the privileged internal guest and **paginates** it with the conventional numbered control
(`‹ 1 2 3 … ›`), honoring the F7 freshness contract: **page 1 is live** (re-renders as new entries
arrive) while **page 2+ is frozen** at the moment it was opened (older entries do not slide mid-read),
with **back-to-live** resuming page 1. This needs a behavior test, not a unit test, for two reasons the
F7 debrief made concrete: (1) the viewer renders inside a `<webview>` guest on the `goldfinch://`
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
  `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
  GOLDFINCH_MCP_PORT={port}`. Capture the `AUTOMATION_DEV_MINT` jar `key` + `adminKey` from stdout.
  Connect an admin MCP client (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`)
  on `127.0.0.1:{port}/mcp`. See `settings-automation.md` Preconditions for the full apparatus,
  coordinate-click rule, focus-anchor rule, and the two-target (`chrome` vs `guestWcId`) discipline —
  this spec assumes them and does not repeat them.
- **F8 note (load-bearing for launchability).** Under F8 the surface still binds in **dev** via
  `--automation-dev` (force-bind + implicit auth-enable — DD4), so `npm run dev:automation` remains the
  apparatus exactly as in F7. The toggle-binds production change does **not** alter the dev harness; do
  not attempt to drive a *packaged* build for this spec (use the dev harness).
- **Dev profile (F8 DD1).** A `dev:automation` launch writes to the **isolated dev profile**
  (`~/.config/goldfinch-dev` or the chosen `-dev` dir), not the installed `~/.config/goldfinch`. The
  audit ring is in-memory regardless; this note only flags that any persisted state the run inspects
  lives in the dev profile.
- **Reflexivity is an ASSET here.** The harness's own admin session emits an audit entry on **every**
  tool call (`readDom`, `readAxTree`, `getChromeTarget`, `enumerateTabs` — see `settings-automation.md`
  reflexivity note). This spec **exploits** that: driving the viewer naturally generates the many
  entries needed to exceed one page. To fill pages deterministically, the Executor may issue extra
  benign reads (e.g. repeated `readDom(guestWcId)`) until the entry count crosses a page boundary.
- **Page size is read from the rendered control, not assumed.** The spec refers to the page size as
  `{pageSize}` and to the total page count as `{pageCount}`; both are **derived from the rendered
  pager** (the highest page number shown / the entries-per-page actually displayed), never hardcoded —
  the F7 implementation shipped numbered pagination and the size is an implementation detail that may
  change.
- **The build includes F7's audit paging** — `src/shared/audit-paging.js` registered in
  `INTERNAL_PAGES`, the numbered pager DOM in `settings.html`, and the `reduceAudit` freeze state
  machine wired into the `settings.js` activity-viewer IIFE.

## Observables Required
- mcp (admin MCP tools — `readDom(guestWcId)` for the rendered `#automation-activity-log` + the numbered
  pager DOM (entry rows, page-number buttons, prev/next, any "current page" marker); `captureWindow()`
  to locate page-number buttons for coordinate clicks; `enumerateTabs` for `guestWcId`; repeated reads
  to generate audit entries — all via the admin MCP client)
- shell (the `AUTOMATION_DEV_MINT` stdout line; `tools/list` count probe — via the MCP client or Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe + serve-seam guard.** Connect the admin MCP client; `tools/list`; `getChromeTarget()`. Open Settings (`openTab('goldfinch://settings', null, {trusted:true})` or kebab→Settings); `enumerateTabs` → record `guestWcId`. `readDom(guestWcId)` and confirm the `#automation` section AND a non-empty Activity viewer container (`#automation-activity-log`) render. | `tools/list` returns the expected tool set incl. `getChromeTarget`; `getChromeTarget()` returns a numeric chrome `wcId`. The settings guest is enumerable. The Activity viewer container **renders with content** (not blank) — i.e. `audit-paging.js` was **served** via `INTERNAL_PAGES` (no 404/blank — the exact F7-HAT regression). If the viewer is empty/blank with no entries despite a live admin session, **FAIL** (serve-seam regression). |
| 2 | (Setup — generate entries) Issue benign reads (repeated `readDom(guestWcId)` / `readAxTree(guestWcId)`) until the audit ring holds **more than one page** of entries. Re-open / re-render the viewer. Read the pager DOM via `readDom(guestWcId)`; record `{pageSize}` (entries shown on page 1) and `{pageCount}` (highest page number in the control). | (Setup row — no judgment.) A numbered pager appears once entries exceed one page. |
| 3 | Read the page-1 entry rows + the numbered pager control via `readDom(guestWcId)`. | Page 1 shows the **newest** entries (most-recent-first), at most `{pageSize}` rows. The pager renders the **conventional numbered form** (`‹ 1 2 3 … ›`): a prev control, contiguous page numbers (with ellipsis when `{pageCount}` is large), a next control, and a marked **current page = 1**. `[a11y]` |
| 4 | **Page-1 liveness.** With page 1 shown, issue one more benign read (generates a new newest entry). Re-read the page-1 rows via `readDom(guestWcId)`. | Page 1 **re-renders live** — the brand-new entry appears at the top of page 1 (page 1 tracks the live ring; broadcasts re-render it). |
| 5 | **Navigate to page 2.** Locate the `2` page button via `captureWindow()`; `click(guestWcId, x, y)`. Read the rows + the pager via `readDom(guestWcId)`. | The viewer shows page 2's window (the entries `{pageSize}+1 … 2×{pageSize}`, older than page 1); the pager marks **current page = 2**. |
| 6 | **Freeze-on-page-back.** While page 2 is shown, issue **several** more benign reads (new entries arrive at the live ring). Re-read page 2's rows via `readDom(guestWcId)`. | Page 2's rows are **unchanged** by the new entries — the page-2 window is **frozen** at the snapshot taken when it was opened; entries do **not** slide. (If a "paused / N newer / back-to-live" affordance is present it may update its counter, but the **visible page-2 entry rows must not shift**.) This is the F7 freshness contract that prevents older entries sliding mid-read. |
| 7 | **Back to live.** Click the prev/`1`/back-to-live control to return to page 1 (locate via `captureWindow()`; `click(guestWcId, x, y)`). Read the rows + pager via `readDom(guestWcId)`. | The viewer returns to page 1 with **current page = 1**, page 1 reflects the **latest** ring state (including all entries added during the freeze), and liveness resumes (a subsequent benign read again appears at the top — optionally re-confirm). |
| 8 | (Boundary) If `{pageCount}` ≥ 3, navigate to the **last** page (click the highest page number / next-to-end). Read the rows. | The last page renders its (possibly partial) window of the **oldest** entries without error; the pager marks the last page current and disables/omits "next" appropriately. *(Skip with `partial` if the ring never exceeds 2 pages in the run env.)* `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant (pager is a navigation control —
the optional Accessibility Validator checks focusability/labels). Step 1 is the **serve-seam guard** —
a blank viewer there is the load-bearing F7-HAT regression and is a hard FAIL. Steps 4 + 6 together are
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
</content>
