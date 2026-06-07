# Leg: verify-integration

**Status**: completed
**Flight**: [Internal Page Scheme (`goldfinch://`)](../flight.md)

## Objective
Live-verify the internal-page mechanism against a running GUI Electron app: the `tab-scheme-guard`
behavior test (incl. the 4 `goldfinch://` spoof vectors + the positive open/reload), the `will-navigate`
spike, the CSP read-back, internal-preload isolation, and the a11y gate (chrome baseline + guest target)
with the seed reconcile. FD-driven (live GUI the autonomous harness can't launch).

## Acceptance Criteria (all met — 2026-06-07 live run)
- [x] `tab-scheme-guard` behavior test **13/13 PASS**; spec promoted `draft → active`. Run log:
  `tests/behavior/tab-scheme-guard/runs/2026-06-07-19-40-28.md`.
- [x] **`will-navigate` spike (DD4)** resolved: internal tab initial-load + app-reload both succeed; the
  trusted programmatic `loadURL`/`navigate` bypasses `will-navigate` (allow-branch is belt-and-suspenders,
  as predicted). No blocking `about:blank` interaction.
- [x] **CSP read-back (DD3)**: served `goldfinch://settings/` carries `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`
  (read over CDP `Network.responseReceived`) — `frame-ancestors 'none'` genuinely shipped.
- [x] **Internal preload isolation**: guest `window.goldfinchInternal.version===1` while `window.goldfinch`
  / `require` are undefined (`contextIsolation:true` working).
- [x] **a11y**: `npm run a11y` (chrome) "No NEW violations" vs the pinned `ACCEPTED`; guest-target mode
  on `goldfinch://settings` a11y-clean. Leg-1 flagged assumption resolved (webview guests appear in the
  flat `/json` list). Seed reconciled (VERIFY-LEG6 markers dropped; 2 unreproduced
  scrollable-region-focusable kept pre-accepted); mission Known-Issue annotated.
- [x] Apparatus discipline (DD8): cdp-driver/curl/node-CDP only — never the `chrome-devtools` MCP.
- [x] Offline gates re-checked green after the fix-forward reconcile edits.

## Verification record
See the flight log `### verify-integration` entry and `## Anomalies` (incl. the latent
internal-tab-web-navigability finding carried to Flight 5/6). Fix-forward edits this leg:
`scripts/a11y-audit.mjs` (reconcile), `mission.md` (Known-Issue), `tests/behavior/tab-scheme-guard.md`
(active + spec-quality flags), the run log + flight log.

## Files Affected
- `tests/behavior/tab-scheme-guard.md` (status→active, Last Run, Step-4/6 notes), `tests/behavior/tab-scheme-guard/runs/2026-06-07-19-40-28.md` (new),
  `scripts/a11y-audit.mjs` (ACCEPTED reconcile), `mission.md` (Known-Issue), flight artifacts.

---

## Post-Completion Checklist
- [x] All acceptance criteria verified (live)
- [x] Flight log updated (verify-integration entry + anomalies)
- [x] Status `completed`
- [x] Checked off in flight.md
- [ ] Commit (fix-forward follow-up commit) — done by the FD after this leg
