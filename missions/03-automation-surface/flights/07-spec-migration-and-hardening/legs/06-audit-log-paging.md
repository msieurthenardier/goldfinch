# Leg: audit-log-paging

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Replace the Settings activity viewer's silent `LOG_DISPLAY_CAP = 50` slice with **20-entries/page pagination** (newest-first, prev/next + "showing X–Y of N"), implementing DD4's **freeze-on-page-2+** freshness contract — **renderer-only**, no backend/IPC/ring change — so the operator can reach older entries (the F6-debrief gap, acute under bulk runs).

## Context
- **DD4** (flight): 20/page, **in-memory**, **newest-first**, renderer-side windowing over the full ring snapshot. **Freeze-on-page-2+** (Architect HIGH — the live ring grows on every tool call, so naive page indices shift under the operator mid-read): **page 1 stays live** (broadcasts re-render it); **navigating to page 2+ snapshots the ring at that instant** and the viewer **stops applying live broadcasts** to the rows while paged back, showing a small "paused — N newer · back to live" affordance; returning to page 1 resumes live. Source of truth = the in-memory ring snapshot; rebuild trigger = broadcast (page 1 only) / explicit back-to-live; max staleness = until the operator returns to page 1 (bounded, operator-controlled).
- **Persistence is explicitly DEFERRED to a future mission** (operator) — no disk store, no retention/clear policy here. This leg only closes the "can't see older entries" gap.
- **No backend change** (verified): the renderer already receives the **full 500-entry ring snapshot** (`{ sessions, log }`) on every broadcast (`audit-log.js:snapshot`→`main.js` `broadcastToChromeAndInternal('automation-activity-changed', …)`→`settings.js` `onAutomationActivity`). The 50-cap is purely renderer-side. So windowing + freeze are entirely renderer-side.
- **Testability decision (this leg, refined at design review)**: `src/renderer/pages/settings.js` is a plain `<script defer>` (no module system, no bundler) and **no renderer file is unit-tested today**. The freeze/thaw/newer-count state machine is the HIGH-risk core, so this leg **extracts the pure logic into `src/shared/audit-paging.js`** — placed in `src/shared/` (NOT `src/renderer/pages/`) so it **exactly matches the existing `src/shared/url-safety.js` dual-export pattern**: a UMD tail (`if (typeof module !== 'undefined' && module.exports) …`) that is **lint-clean** there (the `src/shared/**` eslint block already grants `globals.node`, so `module` is defined — the browser-only `src/renderer/**` block does NOT, which would fail `no-undef`). It is loaded in the renderer via `<script src="../shared/audit-paging.js" defer>` (the url-safety.js precedent) and `require()`-d under `node --test`. The `settings.js` DOM wiring stays thin (covered live by the leg-9 HAT). No jsdom, no framework, no new eslint config.

## Inputs
- `src/renderer/pages/settings.js` — the activity-viewer IIFE (~`:644-801`): `const LOG_DISPLAY_CAP = 50` (`:704`); `renderActivity(snap)` (`:715-793`) with `log.slice().reverse().slice(0, LOG_DISPLAY_CAP)` (`:750-755`); module-scope `let lastSnap = null` (`:705-706`); data via `bridge.automationGetActivity().then(renderActivity)` (`:797`) + `bridge.onAutomationActivity(renderActivity)` (`:798`); cleanup on `pagehide` (`:799-800`). DOM containers `#automation-active-sessions` / `#automation-activity-log`.
- `src/renderer/pages/settings.html` (`:99-103`) — `<h4>Recent actions</h4>` + `<div id="automation-activity-log"></div>`; `<script src="settings.js" defer>` (`:8`). Pager controls + the paused affordance need adding here or injected by the script.
- `src/renderer/pages/settings.css` (`~:502-569`) — `.activity-log-row` etc.; needs pager-control styles.
- `src/main/automation/audit-log.js` — the 500-entry ring (`DEFAULT_CAPACITY = 500` `:25`); `recentEntries()` returns the full ring **newest-LAST** (`:73`); `snapshot()` → `{ sessions, log }` (`:89`). Entry shape `{ ts, sessionId, identity, op, targetWcId, outcome, errorCode, detail }`. **Not modified.**
- `test/unit/automation-audit-log.test.js` — existing ring tests (backend). The new pure-logic tests go in a new `test/unit/audit-paging.test.js`.

## Outputs
- **New `src/shared/audit-paging.js`** — pure, DOM-free module (mirrors `src/shared/url-safety.js`: browser global + `module.exports` UMD tail):
  - `windowPage(activeLog, page, pageSize)` → `{ rows, total, showingFrom, showingTo, hasPrev, hasNext }` — `rows` = newest-first slice (`activeLog` is newest-LAST in the ring; reverse then slice `[(page-1)*pageSize, page*pageSize)`); `total = activeLog.length`; 1-based `showingFrom`/`showingTo`; `hasPrev = page>1`; `hasNext = page*pageSize < total`. **`total` is derived from the passed `activeLog`** — callers pass the active log (`frozenLog ?? liveLog`), so the indicator can't accidentally jump to the live ring while frozen.
  - `countNewer(liveLog, frozenLog)` → number — count of `liveLog` entries with `ts` strictly greater than the **max `ts` in `frozenLog`** (robust to ring eviction; not a length delta).
  - `activeLog(state)` → `state.frozenLog ?? state.liveLog` — the single source for rendering + `windowPage`, so no call site can pass the live ring while frozen.
  - `reduceAudit(state, event)` → newState — the freshness state machine. `state = { page, frozenLog | null, liveLog }`. Events:
    - `{type:'broadcast', log}` — page 1 → update `liveLog`, stay live (`frozenLog=null`); page≥2 → update `liveLog` only, **keep `frozenLog`** (rows stay stable; only newer-count changes).
    - `{type:'next'}` — if `!hasNext` (over `activeLog`), **no-op** (clamp); else `page+1`; **entering page≥2 from page 1 snapshots** `frozenLog = liveLog`.
    - `{type:'prev'}` — if `!hasPrev`, **no-op**; else `page-1`; **landing on page 1 clears `frozenLog`** (resumes live) — and a `broadcast` arriving the same tick must NOT re-freeze (page is 1 → stays live).
    - `{type:'back-to-live'}` — `page=1`, `frozenLog=null` (observably identical end-state to prev-ing back to page 1).
    - The **active log for rendering** = `activeLog(state)`; `newerCount` (page≥2) = `countNewer(liveLog, frozenLog)`.
- **`src/renderer/pages/settings.js`** — the activity IIFE rewired: drop `LOG_DISPLAY_CAP`; hold pager state via `reduceAudit`; on each broadcast/init call `reduceAudit({type:'broadcast', log})` then render `windowPage(activeLog, page, 20)`; render the session list unchanged; inject/populate the pager (prev/next, "Showing X–Y of N"); on page≥2 show "Paused — N newer · back to live" (click → `reduceAudit({type:'back-to-live'})` + re-render); wire prev/next clicks. `pagehide` cleanup preserved.
- **`src/renderer/pages/settings.html`** — `<script src="../shared/audit-paging.js" defer></script>` added **before** `settings.js` (the url-safety.js loading precedent); **static** pager DOM under `<h4>Recent actions</h4>`: real prev/next `<button>`s, a "Showing X–Y of N" indicator span, and a `role="status"` paused-affordance region — added in HTML so the live region exists at parse time (dynamically-inserted `aria-live` regions are less reliably announced on first population). The script only toggles `disabled`/`textContent`/visibility.
- **`src/renderer/pages/settings.css`** — pager-control styles (buttons, disabled state, "Showing X–Y of N" text, the paused affordance).
- **New `test/unit/audit-paging.test.js`** — unit tests for `windowPage` / `countNewer` / `reduceAudit` (boundaries, freeze/thaw, newer-count under eviction, **next/prev clamping at both ends**, **the prev-to-page-1 + simultaneous-broadcast no-re-freeze case**, and **a fixture asserting reverse-then-slice yields strictly-descending `ts`**).
- `docs/mcp-automation.md` — if it documents the activity viewer / the 50-cap, update to the 20/page + freeze contract.

## Acceptance Criteria
- [x] **AC1 (20/page, newest-first)** — The viewer shows ≤20 entries/page, newest-first; page 1 = the most-recent 20. `windowPage` returns the correct slice, `total`, 1-based `showingFrom`/`showingTo`, and `hasPrev`/`hasNext`. Unit-tested incl. empty, <20, exactly 20, >20, and last-partial-page boundaries.
- [x] **AC2 (prev/next + indicator)** — Prev/next controls move pages and are disabled at the ends; a "Showing X–Y of N" indicator reflects the current window. (DOM wiring; the math is `windowPage`, unit-tested.)
- [x] **AC3 (freeze-on-page-2+)** — On page 1, broadcasts re-render live (`frozenLog` null). Navigating to page ≥2 snapshots the ring at that instant; subsequent broadcasts do NOT change the displayed rows; the displayed total/window stay stable (coherent older-entry reading). Returning to page 1 (or "back to live") resumes live and clears the snapshot. Unit-tested via `reduceAudit`.
- [x] **AC4 (newer-count + affordance)** — While frozen on page ≥2, a "Paused — N newer · back to live" affordance shows, where N = `countNewer(liveLog, frozenLog)` (entries with `ts` newer than the frozen snapshot's newest `ts` — robust to ring eviction, NOT a naive length delta). Clicking "back to live" returns to page 1 live. Unit-tested.
- [x] **AC5 (renderer-only, no backend change)** — No change to `audit-log.js`, the IPC channel, `main.js` broadcast, or the snapshot shape. This leg's changes are `src/shared/audit-paging.js` (new), `src/renderer/pages/settings.{js,html,css}`, `src/renderer/renderer-globals.d.ts` (the global type-decl, the url-safety.js precedent), `eslint.config.mjs` (renderer global allowlist, same precedent), and `test/unit/audit-paging.test.js` (new). No `src/main/**` change (the unrelated `src/main/automation/*` diffs in the working tree are from prior batched legs). The renderer windows the full snapshot it already receives. Docs unchanged — `mcp-automation.md` documents the broadcast data contract (unchanged), not the viewer's 50-cap/paging.
- [x] **AC6 (50-cap removed)** — `LOG_DISPLAY_CAP`/the silent 50-slice is gone; `grep -n "LOG_DISPLAY_CAP\|slice(0, 50)" src/renderer/pages/settings.js` returns nothing.
- [x] **AC7 (pure module testable + tested, lint-clean)** — `src/shared/audit-paging.js` is DOM-free, require-able (UMD tail), and lint-clean (the `src/shared/**` eslint block grants `globals.node`, so `module` is defined — placing it here, NOT `src/renderer/pages/`, avoids the `no-undef` failure). `test/unit/audit-paging.test.js` covers `windowPage`/`countNewer`/`reduceAudit`/`activeLog`. Tests pass under `node --test`.
- [x] **AC8 (gates green)** — `npm test` (692 pass) + `npm run typecheck` + `npm run lint` all pass.
- [x] **AC9 (a11y)** — Pager controls are real `<button type="button">`s with accessible names (`aria-label` on prev/next); the "Showing X–Y of N" indicator + the paused affordance live in a static `role="status"` region present at parse time; prev/next keyboard-operable as native buttons. (Verified live in the leg-9 HAT; structure asserted here.)

## Verification Steps
- AC1–AC4, AC7: `npm test` (the new `audit-paging.test.js`); inspect `audit-paging.js`.
- AC5: `git diff --stat` — only `src/renderer/pages/*` + `test/unit/audit-paging.test.js` (+ `docs` if touched); no `src/main/**` change.
- AC6: `grep -n "LOG_DISPLAY_CAP\|slice(0, 50)" src/renderer/pages/settings.js` — empty.
- AC8: `npm test && npm run typecheck && npm run lint`.
- AC9: structure by inspection; live keyboard/AT behavior in the leg-9 HAT.

## Implementation Guidance
1. **Write `src/shared/audit-paging.js` first** (pure, no `window`/`document`), **modeled on `src/shared/url-safety.js`**: `windowPage`, `countNewer`, `activeLog`, `reduceAudit` per Outputs. Use the same UMD tail + browser-global exposure as `url-safety.js` (read it for the exact idiom). Keep it `@ts-check`-clean (JSDoc types for the log entry + state shapes).
2. **Unit-test it** (`test/unit/audit-paging.test.js`, `node:test` + `node:assert/strict`, `require('../../src/shared/audit-paging')`, matching the existing test style): `windowPage` boundaries (0/1/19/20/21/41 entries; first/middle/last page; newest-first order; a fixture asserting reverse-then-slice yields strictly-descending `ts`); `countNewer` (no newer; some newer; eviction case where `liveLog.length === frozenLog.length` but newest `ts` advanced → N>0); `reduceAudit` transitions (broadcast on page 1 stays live + clears frozen; `next`→page 2 freezes a snapshot; broadcast while frozen keeps rows but updates liveLog for newer-count; `prev` back to page 1 clears frozen AND a same-tick broadcast does NOT re-freeze; `next`/`prev` clamp as no-ops at the ends; `back-to-live` resets; `total` while frozen comes from `frozenLog`, not the grown live ring).
3. **Rewire `settings.js`**: replace `LOG_DISPLAY_CAP` + the slice with pager state driven by `reduceAudit`. On init + each `onAutomationActivity` broadcast, dispatch `{type:'broadcast', log}`; render `windowPage(frozenLog ?? liveLog, page, 20)` rows (reuse the existing row DOM builder), the sessions list (unchanged), the "Showing X–Y of N" indicator, prev/next disabled state, and — on page≥2 — the "Paused — N newer · back to live" affordance. Wire prev/next + back-to-live click handlers to dispatch the matching events and re-render. Preserve the `pagehide` listener cleanup.
4. **HTML/CSS**: add `<script src="../shared/audit-paging.js" defer>` BEFORE `settings.js`; add **static** pager DOM in `settings.html` (prev/next `<button type="button">`s with accessible names, an indicator span, a `role="status"` paused/region — present at parse time so the live region announces reliably; the script only toggles `disabled`/`textContent`/visibility); add CSS mirroring the existing `.activity-*` style. Reuse the existing `role="status"` precedent (`settings.html:72,88,110`).
5. **Focus on back-to-live**: returning to page 1 via `prev` and clicking "back to live" reach the **same state** (live, frozen cleared); back-to-live additionally restores focus to a sensible anchor (the top of the log / the page-1 control) — the leg-9 HAT exercises the focus behavior.
6. **Docs**: `grep` `docs/mcp-automation.md` first; update only if it states the 50-cap / activity-viewer behavior — otherwise drop it from the diff to keep AC5's renderer-only scope tight.

## Edge Cases
- **Newer-count under eviction**: the ring caps at 500 and evicts oldest; while frozen, `liveLog.length` can equal `frozenLog.length` yet have newer entries. `countNewer` MUST compare by `ts` (count entries newer than the frozen snapshot's max `ts`), not by length delta — else N reads 0 when entries actually arrived.
- **Frozen page beyond the (frozen) end**: pagination is over the **frozen** snapshot while frozen, so the page count is stable; don't recompute `total` from the live ring while frozen (that would make the indicator jump). `total` (frozen) = `frozenLog.length`.
- **Returning to page 1**: clear `frozenLog`, resume live; the next broadcast (or the current `liveLog`) repaints page 1 newest-first.
- **Empty log**: keep the existing "No recent activity" empty line; pager hidden or disabled; no paused affordance.
- **Page 1 is always live even mid-bulk**: a bulk run floods broadcasts; page 1 re-renders each time (newest-first) — that's intended (the operator watching live sees the newest). Only paging back freezes.
- **Reflexivity note (cross-leg)**: leg-4 established the harness's own admin reads appear in this log; that's an observation about *content*, not this leg's paging mechanics — no special handling here.

## Files Affected
- `src/shared/audit-paging.js` — **new** pure module (windowPage/countNewer/activeLog/reduceAudit + UMD tail; modeled on `url-safety.js`; lint-clean in `src/shared/`).
- `src/renderer/pages/settings.js` — activity IIFE rewired to the pager; `LOG_DISPLAY_CAP` removed.
- `src/renderer/pages/settings.html` — `<script src="../shared/audit-paging.js" defer>` + static pager DOM (buttons, indicator, `role="status"` region).
- `src/renderer/pages/settings.css` — pager-control styles.
- `test/unit/audit-paging.test.js` — **new** unit tests for the pure module.
- `docs/mcp-automation.md` — activity-viewer contract (only if documented; grep first).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `grep` shows no `LOG_DISPLAY_CAP`/`slice(0, 50)` in settings.js
- [x] `git diff --stat` confirms this leg's contribution is `src/renderer/pages/*` + `src/shared/audit-paging.js` + `src/renderer/renderer-globals.d.ts` + `eslint.config.mjs` + the new test; no `src/main/**` from this leg
- [x] `npm test`/typecheck/lint green
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg (committed with the Phase-2d review block)

## Citation Audit
To verify at design-review time (2026-06-16): `settings.js` activity IIFE + `LOG_DISPLAY_CAP = 50` (`:704`) + the `reverse().slice(0, LOG_DISPLAY_CAP)` (`:750-755`) + broadcast wiring (`:797-800`); `settings.html:99-103` (`#automation-activity-log`) + `:8` (`<script>`); `audit-log.js` ring (`DEFAULT_CAPACITY=500` `:25`, `recentEntries` newest-last `:73`, `snapshot` `:89`); the full-snapshot-per-broadcast claim (`main.js` `broadcastToChromeAndInternal`). The design-review Developer cross-checks (a) the renderer truly receives the full ring (so renderer-only windowing holds), (b) the `<script defer>` ordering makes `AuditPaging` available before the IIFE runs, and (c) the UMD-tail + `@ts-check` approach is sound for a node-required pure module.
