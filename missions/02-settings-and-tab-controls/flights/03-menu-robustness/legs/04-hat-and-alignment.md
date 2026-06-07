# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Menu Dismissal & Shared APG Helper](../flight.md)

## Objective

Guided human acceptance test: the operator exercises the live menus and confirms the dismissal behavior + container-menu feel, including the manual checks the harness can't drive (real page-click, app-switch).

## Acceptance Criteria
- [x] Operator confirms an open menu closes when clicking the page (web content).
- [x] Operator confirms an open menu closes on app-switch (the CDP-undrivable check — same `window`-blur handler).
- [x] Operator confirms the container menu's new keyboard nav + overall menu feel are good.

## HAT Session Outcome

**Operator verdict: all good — land it.** Confirmed live against the running app (`:9222`):
- **Page-click dismissal** — clicking the web page with a menu open closes it. (Also independently confirmed by a real trusted CDP click into the webview during verify-integration.)
- **App-switch dismissal** — switching to another application closes an open menu. This was the one check CDP cannot drive; the operator confirmed it by hand (same `window`-blur handler the webview-click path uses).
- **Container menu feel** — the new APG keyboard nav (arrow/Home/End, trigger Space/↓ to open) and dismissal feel right; no tuning requested.

No fixes needed. macOS remains deferred to a future mac HAT (dev platform is Linux/WSL).

## Files Affected
- None (verification only; no code changes requested at HAT).

---

## Post-Completion Checklist
- [x] Operator confirmed page-click + app-switch dismissal + container feel
- [x] No tuning fixes needed
- [x] Flight log updated
- [x] Status `completed`
