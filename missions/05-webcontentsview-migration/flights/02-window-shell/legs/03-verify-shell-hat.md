# Leg: verify-shell-hat

**Status**: completed
**Flight**: [Window Shell](../flight.md)

> **HAT outcome (2026-06-24/25): PASS (qualified).** All migration-critical acceptance met — frameless
> shell renders correctly (operator-confirmed on-screen), `<webview>` tabs browse real pages, automation
> engine alive (27 MCP tools), `captureWindow` composites the guest, the **DD7 maximize-state read path
> works** (`data-state` flip), responsive tab shrink/grow works (`responsive-tab-strip` Steps 1–3 PASS),
> `npm run a11y` clean (no new violations), and the **EPIPE guard holds** (EPIPE 0, no crash dialog).
> Operator elected to wrap after the migration-relevant assertions were confirmed (`Wrap now — enough
> confirmed`). **Not explicitly eyeballed** (low-risk, deferred): window drag-by-hand (AC3), minimize/close
> button clicks (AC4 — close is harness-destructive), and the full behavior corpus (AC6 — `responsive-tab-strip`
> Steps 4–8 + `tab-keyboard-operability` + `settings-shell`; these are renderer-internal behaviors the
> window-host swap does not touch). See the flight log HAT entry + the run log for detail.

## Objective

Operator-guided human acceptance test that the migrated frameless `BaseWindow` + chrome `WebContentsView` shell is at parity — drag regions, window controls, and maximize-state sync work on pixels — plus confirm the EPIPE fix live and run the runnable behavior-test corpus + a11y.

## Context

- This is an **interactive HAT / alignment leg** — not autonomous. The Flight Director guides the operator one step at a time; failures are fixed inline (spawning a Developer if code changes are needed), then the step is re-verified.
- **Already verified earlier this session** (no need to re-prove, but the operator may re-confirm by eye): the frameless chrome renders; `<webview>` tabs browse real pages; the automation engine is alive (27 MCP tools); and `captureWindow` composites the in-chrome guest (the flight's carried divert trigger — resolved favorably, with a paint-timing caveat). See the flight-log "Runtime verification" + "captureWindow guest-compositing" entries.
- **What genuinely needs the operator's hands/eyes**: window **drag** (drag regions on the frameless `BaseWindow`), **window controls** (minimize / maximize-restore / close by clicking), and **maximize-state label sync**. Plus a live confirmation that the EPIPE crash no longer appears under `--enable-logging`.

## Acceptance Criteria (verification steps)

- [x] **AC1 — Frameless launch, no white flash.** ✅ MET. App launches frameless under WSLg; chrome renders (operator confirmed the on-screen window renders correctly at normal and maximized size); dark `#1e1f25` background. (DD6/SC8.)
- [x] **AC2 — Tab browsing on pixels.** ✅ MET. `<webview>` tabs load and render real pages on the new shell — `readDom` returned the live `example.org` DOM; `captureWindow` showed the guest composited; the behavior test opened 5+ real tabs rendering correctly. (SC3 foundation.)
- [ ] **AC3 — Window drag.** ⚠️ NOT EXPLICITLY EYEBALLED this session (operator wrapped early). Low risk: drag regions are `-webkit-app-region` CSS in the chrome renderer, unchanged by the window-host swap; the operator was interacting with the window without reported issues. Carry as a quick manual confirm if desired. (SC8.)
- [~] **AC4 — Window controls.** PARTIAL ✅/⚠️. Maximize/restore + state sync **MET**: the control's `data-state` flips `normal→maximized` and its label to `Restore` (DD7 read path), and the operator confirmed on-screen maximize/unmaximize work correctly. Minimize and close were **not** explicitly clicked (close is harness-destructive; minimize backgrounds the renderer) — both call identical `BaseWindow` methods (Leg 2 AC3), parity by construction. (SC8/DD4.)
- [x] **AC5 — EPIPE fix, live.** ✅ MET. Guard in place (Leg 2); multiple `--enable-logging` launches this session showed **EPIPE count 0** in the logs and **no** "main process … write EPIPE" modal appeared. (D-EPIPE.)
- [~] **AC6 — Behavior corpus (runnable subset).** PARTIAL. `responsive-tab-strip`: Steps 1–3 **PASS** (run log `tests/behavior/responsive-tab-strip/runs/2026-06-24-23-02-18.md`), Steps 4–8 not exercised (operator wrapped; renderer-internal reflow timing untouched by the host swap). `tab-keyboard-operability` + `settings-shell`: **not run** this session (low-risk regression guards; deferred). (SC3/SC8 parity net.)
- [x] **AC7 — Accessibility.** ✅ MET. `npm run a11y` → no NEW violations (every node in the accepted baseline). 

## Verification Steps (operator-guided, one at a time)

| # | Action (operator) | Expected Result |
|---|-------------------|-----------------|
| 1 | Launch the app (`npm run dev`). | Frameless window, dark background, no white flash; chrome paints. (AC1) |
| 2 | Observe / open a tab to a real site. | Page renders inside the window. (AC2) |
| 3 | Drag the window by the chrome's drag strip; then try dragging from a toolbar button / address bar. | Window moves on the drag region; no-drag regions don't move it. (AC3) |
| 4 | Click minimize; restore; click maximize; click restore; observe the maximize control icon/label at each state. | Each control behaves correctly; the maximize/restore control reflects current state. (AC4) |
| 5 | Confirm no EPIPE crash dialog appeared during the session under `--enable-logging`. | No "main process … write EPIPE" modal. (AC5) |
| 6 | FD runs the behavior corpus (`/behavior-test responsive-tab-strip`, `tab-keyboard-operability`, `settings-shell`) and `npm run a11y`. | All pass on the new shell. (AC6, AC7) |
| 7 | Click window-close. | App closes cleanly (non-darwin: quits). |

## Edge Cases

- **mac path unverified (DD5)**: traffic-light / mac frameless parity is not verifiable this mission — recorded as unknown, build-readiness only. Not a HAT failure.
- **captureWindow paint-timing**: any captureWindow-based check must settle/wait for the guest to paint first (see flight-log caveat).

## Files Affected

- None (verification only). Any inline fix during the HAT is its own change, recorded in the flight log and committed separately.

---

## Post-Completion Checklist

- [x] All verification steps pass, OR accepted/deferred with rationale (migration-critical all pass; drag/minimize/close + full corpus deferred by operator — recorded)
- [x] Flight log updated with HAT results (no inline fixes were needed — nothing failed)
- [x] Leg status → completed; checked off in flight.md
- [x] Flight status → landed; flight checked off in mission.md
- [x] Commit (HAT results) — batched into the flight-landing commit by the Flight Director
