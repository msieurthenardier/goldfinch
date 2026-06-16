# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

> **HAT PASS (operator sign-off, 2026-06-16).** Guided HAT of the chrome affordance + dogfooding, run live against the `dev:automation` admin surface. The agent drove the operator's real browser (a new Wikipedia tab opened + activated, witnessed live) and the SC10 audit trail was visible. Three integration gaps were found and **fixed inline**, re-verified, and signed off.

## Objective
Guided human acceptance test (DD7): the operator drives/witnesses the chrome affordance + the migrated dogfooding live, with issues fixed inline before sign-off.

## Context
- **DD7** (flight): include the HAT — "dogfooding the chrome affordance is exactly where it pays off." It did: the HAT surfaced three real SC10/UX gaps that the automated passes (leg 7) didn't.
- Interactive leg — not autonomous. The Flight Director guided the operator step-by-step; fixes were spawned to Developers and re-verified live.

## What was verified (live, operator-witnessed)
1. **Sanity** — operator confirmed the running Goldfinch looked normal.
2. **Live drive-through** — FD drove `getChromeTarget` → `openTab https://www.wikipedia.org/` → `activateTab` → `readDom` over the admin MCP client; operator **witnessed the new Wikipedia tab appear and activate in their real window** (proof an agent drives the actual browser, not a separate one).
3. **Audit visibility (SC10)** — operator opened Settings → automation activity and confirmed the admin session's actions were logged and attributed.

## HAT findings → inline fixes (all re-verified + signed off)
1. **Audit log lacked per-action context.** The activity log recorded the op + target wcId but not the "where" (URL for navigate/open, coords for click, key for keypress). **Fix**: added a per-op `detail` to the audit record (`audit-log.js`), derived from the tool args at the single record call site via `deriveAuditDetail(op, args)` (`mcp-server.js`), rendered in the activity viewer (`settings.js`, `textContent`). **`typeText` redacted to `text(N chars)`** (operator decision) so a typed secret never reaches the local log; URLs/coords/keys logged verbatim. Re-verified live: the log showed `url=…`, `(400,63)`, `key=Escape`, and `text(13 chars)` for a deliberately-typed secret (redaction confirmed).
2. **Port Save button always enabled** (no signal whether a save took). **Fix**: dirty-state — `savedPort` baseline + `updatePortSaveDirty()` (`settings.js`); Save disabled when the field matches the saved port, enabled only on a valid change, re-disabled after a successful save/rebind.
3. **"(takes effect on next launch)" note was wrong** — the surface live-rebinds on Save. **Fix**: reworded to **"(unsaved — applies on Save)"** (`settings.js` `recomputePortNote`).
4. **Disabled Save button had no visual state** (not muted, still highlighted on hover). **Fix**: `.settings-btn:disabled { opacity: 0.5; cursor: not-allowed }` + scoped hover to `.settings-btn:not(:disabled):hover` (`settings.css`).

(Finding 1 was an apparatus-env artifact during testing — `GOLDFINCH_MCP_PORT` pinned the port so saves snapped back; resolved by relaunching without the pin. Not a code defect — recorded in the flight-log Decisions.)

## Acceptance Criteria
- [x] **AC1** — Operator witnessed the agent driving their real browser live (Wikipedia tab open + activate).
- [x] **AC2** — SC10 audit trail visible in Settings (admin session + actions).
- [x] **AC3** — HAT-found gaps fixed inline, gates green (650/650 + typecheck + lint), re-verified live.
- [x] **AC4** — Operator sign-off ("pass").

## Files Affected (HAT fixes)
- `src/main/automation/audit-log.js`, `src/main/automation/mcp-server.js` — audit `detail` + `deriveAuditDetail`.
- `src/renderer/pages/settings.js` — `detail` rendering, port Save dirty-state, note rewording.
- `src/renderer/pages/settings.css` — disabled-button styling.
- `src/renderer/renderer-globals.d.ts`, `docs/mcp-automation.md` — `detail` type + docs.
- `test/unit/automation-audit-log.test.js`, `test/unit/automation-mcp-server.test.js` — coverage incl. typeText redaction.

---

## Post-Completion Checklist
- [x] HAT driven live with operator; gaps fixed inline + re-verified
- [x] Operator sign-off
- [x] Gates green (650/650 + typecheck + lint)
- [ ] Flight review + commit + land (Flight Director, next)
