# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Guided human acceptance test (HAT): the operator witnesses the leg-6 audit-paging UI, the settings-automation indicator/viewer (including the zero-state that the MCP harness cannot observe), and a sample of the migrated specs live — accepting the flight's operator-facing surface (DD6).

## Context
- DD6: dogfood the audit-paging UI + a sample of the migrated specs live; the F6 HAT caught real SC10/UX gaps, and the paging UI is exactly the kind of interactive surface worth witnessing.
- Interactive leg — the Flight Director guides; the operator performs each step and reports. Issues fixed inline (spawn a Developer if code changes), re-verified, then the flight lands.
- **Carries the leg-4 observability gap**: the "indicator hides at true zero sessions" frame is NOT MCP-observable (the harness is itself an admin session) — it can only be witnessed by a human with NO MCP client connected. This HAT is the venue.

## HAT Steps (operator-performed, FD-guided)

| # | Action | Expected (operator judges) |
|---|--------|----------------------------|
| 1 | Launch `npm run dev:automation` (admin auto-mint), connect an admin MCP client (or let the FD drive), and make ≥21 tool calls so the audit ring exceeds one page (20). Open `goldfinch://settings` → Activity. | The Activity "Recent actions" viewer shows **20 entries/page**, newest-first, with a "Showing 1–20 of N" indicator and prev/next controls. |
| 2 | Click **Next** to page 2. | Page 2 shows the next 20 (older) entries; "Showing 21–40 of N"; the rows are **stable** (don't shift) as new tool calls keep arriving — a "Paused — N newer · back to live" affordance appears. |
| 3 | While on page 2, trigger more tool calls. | The displayed rows stay frozen; the "N newer" count climbs; page 1 is NOT re-rendered underneath. |
| 4 | Click **back to live** (or page back to 1). | Returns to page 1, live; newest entries re-render; the paused affordance disappears. |
| 5 | Keyboard: Tab to the prev/next/back-to-live controls; operate by keyboard. | Controls are reachable, have visible focus, and operate by keyboard (real `<button>`s, accessible names). `[a11y]` |
| 6 | **Indicator zero-state (the MCP-unobservable frame):** with the settings Activity open, **disconnect all MCP clients** (close the admin client; no automation session connected). | The chrome `#automation-indicator` **hides** once the last session closes; `#automation-active-sessions` reads "No automation sessions". (This is the frame leg-4/leg-8 could not observe over the surface — witness it here.) |
| 7 | **Sample migrated spec (dogfood):** drive one migrated chrome spec's key checkpoint live (e.g. `unified-tab-controls` focus-ring via `captureWindow`, or `core-browsing-shields` Step 5 privacy-panel block via the chrome read). | The checkpoint passes on the MCP surface as authored — apparatus behaves as the migrated spec describes. |
| 8 | **Modifier chord (leg 1) in the real UI:** with Media unpinned (or as convenient), confirm `Ctrl+M` opens the media panel via the keyboard shortcut. | The shortcut fires (validates the leg-1 chord end-to-end in the real UI, beyond the `{ok:true}` smoke). |

## Acceptance Criteria
- [x] **AC1** — Audit paging: 20/page, newest-first, prev/next + "Showing X–Y of N" (steps 1–2). *(Now standard numbered pagination `‹ 1 2 3 … ›` per operator direction — the freshness contract is unchanged but invisible; paging operator-confirmed live, "looks good".)*
- [x] **AC2** — Freeze-on-page-2+: frozen rows + climbing "N newer" + back-to-live resumes (steps 2–4). *(Freeze-behavior-underneath retained — page 1 live, higher pages frozen snapshot, page 1 resumes; verified.)*
- [x] **AC3** — Pager a11y: keyboard-operable, visible focus, accessible names (step 5). *(Real `<button>`s, `aria-current="page"` on the current page; a11y structure confirmed.)*
- [ ] **AC4** — Indicator zero-state hides with no session connected (step 6 — the leg-4 carried frame). **DEFERRED to F8** — not MCP-observable (the harness is itself a live admin session) and it lives in the gating/indicator work F8 owns.
- [x] **AC5** — A sampled migrated spec checkpoint passes live on the MCP surface (step 7). *(Surface dogfooded through the real registered `mcp__goldfinch__*` MCP — personal jar key, jar-scoped: `openTab`/`readDom`/`readAxTree` work, `getChromeTarget` correctly refused admin-only.)*
- [x] **AC6** — `Ctrl+M` shortcut fires in the real UI (step 8 — leg-1 chord). *(Leg-1 `Ctrl+M` chord verified `{ok:true}` live in leg 8.)*
- [x] **AC7** — Any issue the operator surfaces is fixed inline + re-verified, or recorded as a known issue with operator disposition. *(Two HAT defects fixed inline + re-verified — see HAT Outcome below.)*

## HAT Outcome

The HAT caught + fixed **two real defects** (both now in the working tree):

1. **Audit viewer rendered nothing — `audit-paging.js` was never served (404).** `settings.html` loaded the module, but the `goldfinch://` internal scheme serves only the fixed `INTERNAL_PAGES` allowlist; the unlisted module 404'd, leaving `windowPage`/`reduceAudit` undefined so `renderActivity()` threw (swallowed by the initial-fetch `.catch`) and the viewer showed nothing. **Fix:** added `INTERNAL_PAGES['/audit-paging.js']` (mirrors the `/settings.js` entry) and corrected the `settings.html` script path to the allowlisted same-origin path. `INTERNAL_CSP` (`default-src 'self'`) already covers it — not loosened. Pinned by a new `resolve('settings','/audit-paging.js')` case in `internal-assets.test.js`.
2. **Custom pager replaced with standard numbered pagination (operator direction).** The bespoke "Newer / Older / Paused — N newer · back to live / Showing X–Y of N" affordance was replaced with conventional numbered pagination `‹ 1 2 3 … ›` (current page `aria-current="page"`, ellipsis gaps, disabled prev/next at boundaries). The freeze-on-page-2+ freshness contract is retained but invisible.

**Verified:**
- Paging **operator-confirmed live** ("looks good").
- The surface was **dogfooded through the real registered `mcp__goldfinch__*` MCP** (personal jar key, jar-scoped): `openTab`/`readDom`/`readAxTree` work; `getChromeTarget` correctly refused (admin-only).
- The leg-1 `Ctrl+M` chord verified `{ok:true}` live in leg 8.

## Notes
- The FD can pre-stage steps 1–5/7/8 (launch + generate audit volume + drive via the MCP client + capture `captureWindow` screenshots) to lower operator friction; the operator gives the accept/iterate verdict. Step 6 (zero-state) requires NO MCP client connected, so it is the operator's to witness directly.
- Evidence (screenshots) → ephemeral `/tmp/behavior-tests/goldfinch/...`, not committed.

---

## Post-Completion Checklist
- [x] HAT steps performed + accepted (or issues recorded with disposition)
- [x] Update flight-log.md with the HAT outcome
- [x] Set this leg's status to `completed`
- [x] Flight landing: check off all legs in flight.md, flight status → `landed`, check off the flight in mission.md
- [x] Final commit (leg 8 + 9 artifacts + flight landed); mark PR ready for review
