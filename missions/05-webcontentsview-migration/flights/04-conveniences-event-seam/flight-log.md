# Flight Log: Conveniences & Event-Seam Re-architecture

**Flight**: [Conveniences & Event-Seam Re-architecture](flight.md)

## Summary

Planning in progress. The upstream reconnaissance (below) found the flight materially smaller than the
mission budgeted: Flight 3 already re-homed almost every renderer↔`<webview>`-element seam, leaving
`find.js` as the only `confirmed-live` element-coupled convenience. Operator confirmed the leaner scope
(find re-home + full active-view consolidation + docs/spec cleanup + full convenience-corpus
verification + HAT).

---

## Reconnaissance Report

Source artifact: the Flight-3 (Tab Surface) debrief's forward-looking action items + technical
recommendations. Each cited item walked against current code on `mission/05-webcontentsview-migration`.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Dead `find.js` automation find | `confirmed-live` | `src/main/automation/find.js:120,170` — `querySelectorAll('webview')` (now always empty) in injected find/stop code | **Leg 1** — re-home to main-process `wc.findInPage()` + `found-in-page` event |
| Renderer `found-in-page` listener | `already-satisfied` | No dead `tab.webview` listener in `renderer.js`; find results return via MCP/IPC, not a DOM listener | No re-home needed |
| Media-rescan seam | `already-satisfied` (minimal re-point done in F3) | `src/main/main.js:1554` — `ipcMain.on('rescan-media', {wcId})` → `getTabContents(wcId).send('rescan-media')` | None — fully on `webContents`/IPC |
| Privacy-stream listener | `already-satisfied` | `src/main/main.js:1546` — `guest-privacy-fp` uses `event.sender.id`, no element access | None |
| zoom / print / DevTools / context-menu / spellcheck / downloads | `already-satisfied` | `automation/zoom.js:49,76`; `automation/print.js:44`; `devtools.js:35`; `main.js:622` (`context-menu`→`page-context-menu` IPC); `main.js:1107,1628` (session-layer spellcheck); `downloads-manager.js` (main-process model) — all on `webContents`/IPC | Re-verify only (Leg 4 corpus) |
| `visibleWebTabWcId` / `!t.trusted` bookkeeping | `confirmed-live` (scattered) | `renderer.js:110,780-792,811,860-876,1096,1160,1166,1172,1260,2144,2282,2598` (~12 callsites) | **Leg 2** — consolidate to single active-view concept + `isWebTab()` |
| `capture-active-guest` comment invariant | `confirmed-live` | `src/main/main.js:1520-1534` — comment states chrome-only exposure but not "captures internal too; no exfiltration" | **Leg 3** — clarify comment |
| `farbling-correctness.md` citation | `drifted` | spec `:51` cites `tab.webview.reload()` / `renderer.js:1756`; real code is `tabNavigate(...)` at `renderer.js:2327` | **Leg 3** — fix citation |
| `CLAUDE.md` tab architecture | `confirmed-live` (stale) | goldfinch `CLAUDE.md:21,23,33,56,66,104` still describe tabs as `<webview>` elements | **Leg 3** — update to WebContentsView + freeze-frame + `INTERNAL_PARTITION` rule |
| `responsive-tab-strip.md` | `already-satisfied` | spec is MCP-only (`getChromeTarget`/`captureWindow`/`readDom`), no `<webview>` coupling | **Retire from scope** (M05F2 Rec 5 closed) |
| `tab-surface-geometry` / `internal-tab-menus` specs | not-yet-authored | absent from `tests/behavior/` | **Authored at planning** (2026-06-26) |
| `find-in-page.md` cold-start note | `needs-human-recheck` | spec `:9` documents a `<webview>` cold-start `{0,0}` quirk | **Leg 1** — re-verify under `WebContentsView`; update the note |

**Operator decision (2026-06-26):** confirmed the leaner scope; full active-view consolidation; full
convenience corpus as Witnessed runs; HAT included. `responsive-tab-strip` retired (already satisfied).

---

## Leg Progress

_(none yet)_

---

## Decisions

### Flight Director Notes

- **2026-06-26 — Flight planned via `/flight`.** Recon reshaped the mission's "budgeted as a rewrite"
  framing: F3's opportunistic re-homing left only `find.js` live. Recorded here rather than rewriting the
  mission's Flight-4 line (the original framing stays as commentary; this log + flight.md are the live
  spec). Two behavior specs (`tab-surface-geometry`, `internal-tab-menus`) authored inline at planning so
  their `captureWindow` rendered-state apparatus shaped the leg breakdown (DD4).
- **2026-06-26 — Design review (Architect, codebase-grounded) → approve with changes; incorporated.**
  Three load-bearing corrections from real code reads: (1) **DD1 narrowed** — the user find bar already
  works through the F3-migrated `tab-find`/`tab-found-in-page` main-process path (`main.js:670,1499`);
  `found-in-page` delivery is proven, not a risk. Leg 1 is now only the `find.js` MCP ops + a rewrite of
  the injection-coupled `automation-find.test.js` (~573 lines), with `requestId` correlation to avoid
  double-fire/concurrent-find misattribution. (2) **DD2 reframed** — the three F3 HAT regressions are
  already individually fixed and `isInternalTab()` already exists (`renderer.js:911`); consolidation is
  preventive-hardening, not a bug fix. **Operator re-confirmed full structural consolidation anyway.**
  (3) **Spec apparatus fixed** — the WSLg-fallback `captureWindow` draws the live-hidden guest over the
  chrome, so the menu-above pixel check is unreliable there; both new specs now make `readDom` of
  `#webviews backgroundImage` the **authoritative** freeze tell and demote pixels to corroborating.
  Also: CLAUDE.md staleness wider than recon (added `:27,28,65,72,75,78`); 2 new specs run as a gating
  sub-step before the 9-spec corpus. A second Architect pass was skipped — the edits directly implement
  the review's own recommendations. Flight set to `ready`.

---

## Deviations

_(none yet)_

---

## Anomalies

_(none yet)_

---

## Session Notes

_(none yet)_
