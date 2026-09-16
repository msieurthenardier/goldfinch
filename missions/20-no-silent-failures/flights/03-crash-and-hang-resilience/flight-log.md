# Flight Log: Crash and Hang Resilience

**Flight**: [Crash and Hang Resilience](flight.md)

## Summary

Planning (2026-09-16). No legs executed yet.

---

## Reconnaissance Report

Source artifacts walked against `main` at `3613542` (Flight 2 merged, squawks
0078–0081 merged): issue #133, the BACKLOG seed it promotes, the mission's
criteria 6–9 and its open questions, and the Flight 2 debrief's action items.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| #133 — no guest `render-process-gone` handling (gray tab forever) | confirmed-live | `grep -rn render-process-gone src/` → only `find-overlay-manager.js:197`, `menu-overlay-manager.js:303`, `tearoff-overlay-manager.js:86`; `guest-wiring.js` `wireGuestContents` wires no crash listener | In scope — the guest crash surface |
| #133 — chrome-view crash bricks the window | confirmed-live | `window-factory.js:180-192` creates the chrome view with no crash handler; `app-lifecycle.js:169` `window-boot-config` serves `restoreTabs`/`bootTab` only — nothing reconciles live guests into a rebooted chrome | In scope — reload-and-reconcile |
| #133 — no `unresponsive` handling | confirmed-live | no `unresponsive`/`responsive` listener in `src/`; Electron 44 has both on `WebContents` (`electron.d.ts:17503`, `:17568`) | In scope — wait-or-kill |
| #133 — no `crashReporter`, no crash record | confirmed-live | no `crashReporter`/`child-process-gone` in `src/`; `crashReporter.start({ uploadToServer: false })` needs no `submitURL` (`electron.d.ts:21428-21447`) | In scope — local records + dumps |
| #133 watch-out — teardown assumes live guests; wiring must survive a respawn | confirmed-live (design) | `window-factory.js` close teardown `:283-…` destroys guests; `guest-wiring.js` installs listeners on the `WebContents` OBJECT, which survives a renderer crash (`isDestroyed()` stays false — the overlay managers' own comment) | Design: no re-wiring on reload; teardown must tolerate a crashed guest |
| #133 watch-out — sleep/resume storm | confirmed-live (design) | no debounce anywhere | Design: guest surfaces never auto-reload; chrome reload debounced + capped |
| Mission OQ — chrome recovery: what to rebuild vs drop | confirmed-live (design) | registry holds `tabViews`, `activeTabWcId`, per-entry `loadFailure`/`security`/`lastRequestedUrl`; strip ORDER lives only in the chrome DOM; welcome records, pending queries, find text, suggestions are chrome-only | Design: adopt every registry entry in insertion order (the snapshot's order), re-push state, re-derive welcome from settings, drop the rest |
| Mission OQ — hang thresholds | needs-human-recheck (spike) | Chromium's hung-renderer detection is INPUT-driven; whether `unresponsive` fires on a busy loop with no input is a rig fact | Spike premise |
| Mission OQ — crashed tab on the closed-tab stack / snapshot | confirmed-live (design) | `session-snapshot.js` / `closed-tab-capture.js` read `effectiveUrl(entry)`; a crashed guest's `wc.getURL()` should persist (spike) | Spike premise; expected yes |
| Mission env — `process.crash()` via admin `evaluate` | drifted | web guests run `sandbox: true`, `nodeIntegration: false` (CLAUDE.md) — the page main world has no `process`; `chrome://crash` is refused by `isSafeTabUrl` | Apparatus change: expose the renderer OS pid on the admin census and inject crashes with OS signals (`kill -SEGV`/`-KILL`; `-STOP`/`-CONT` for hangs) — no product seam |
| F2 debrief — unify the chip refresh into one fan-out; extract the dispatch switch from `renderer.js` | confirmed-live | `renderer.js` 1805 / budget 1806; `dispatchOverlayActivation` `:932-1235` (~300 lines) + `handleOverlayClosed` `:1236-1275` | Substrate leg (this flight adds glue for two new surfaces) |
| F2 debrief — per-tab-state rules; settle-before-read; "no preliminary click"; dedicated acceptance-gate leg | already-satisfied (rules) / confirmed-live (application) | CLAUDE.md rules landed (squawk 0081); the crew file carries the apparatus notes (0080) | Apply: own push channels (`tab-crash`, `tab-hung`), spec clauses, an acceptance leg that ships nothing else |
| #216 — stranded focus after a typed failure | confirmed-live, out of scope | operator ruling (F2 debrief): backlog | Not this flight's; the crash panel inherits the click-first workaround; the HAT walks it with that caveat |
| Squawks 0074–0081 | already-satisfied | all `completed` on `main` | — |

Retirements proposed: none of the work items. The one drifted item is the
crash-injection apparatus (mission environment text) — replaced by OS-signal
injection against an admin-visible pid.

---

## Leg Progress

*(none yet)*

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### 2026-09-16 — planning

- `/mission-control:flight 3` on `main` after the squawk turnaround. Recon above.

## Flight Director Notes — planning (2026-09-16)

- **Crew interview outcomes.** HAT: small leg, elected (`hat-and-alignment`, optional). Recovery policy: reload the chrome at once, cap 3 per 60 s, then stop (DD6). Crash log: the operator's constraint is that the log must never become a vector for leaking browsing data or secrets — encoded as DD7's closed field set (origin host only, `null` for burner, no URL path/query/fragment, no title, no page data) with a source-scan + redaction unit pin, and DD8's documented, count-capped, local-only minidumps.
- **Apparatus.** The mission's `process.crash()` premise is drifted (recon); replaced by OS-signal injection against an admin-visible `pid` (DD9/DD10). Both axes audited: act = `kill -SEGV/-KILL/-STOP/-CONT`; observe = census `loadState`/`loadError`/`pid`, `enumerateWindows.booted`/`chromePid`, chrome a11y tree, `crash-log.jsonl` from the shell.
- **Substrate first.** `renderer.js` sits at 1805/1806; leg 1 extracts the overlay dispatch switch and unifies the chip refresh (F2 debrief recommendations 2) before either feature leg adds glue.
- Spec + `tests/behavior/crash-and-hang-surfaces.md` (draft) written; Architect design review spawned (cycle 1 of max 2).
- **Architect cycle 1 (approve with changes).** Five high issues, all verified against the code and folded: (1) `rec.restoreTabs` never clears → recovery nulls it and `recoverTabs` is checked first (DD5); (2) guest pushes go through `chromeForTab`, not `queueChromeSend` → new `sendOrQueue` helper gated on `bootConfigServed` (DD5); (3) two inline `entry.loadFailure` focus checks (`register-tab-ipc.js:1060`, `:1125`) outside `applyGuestVisibility` → shared `guestTakenOver` predicate + grep-AC (DD1); (4) `kind: 'popup'` had no producer → popup crash = record + close the popup window (DD2); (5) `crashReporter.start` beside `registerSchemesAsPrivileged` would precede the dev-profile redirect → placed after `main.js:274`, source-scan pinned (DD8). Suggestions adopted: single `deriveStripLoadState` writer, crash clears `loadFailure`/`hung`, `failedTabTitle` reads the crash url, pause is per-window-lifetime (DD6), vault sheets in the dropped list, spike (j) for `getOSProcessId` on a crashed renderer, behavior spec step 6 reads the fresh pid. Cycle 2 spawned, scoped to the amended DDs.
- **Architect cycle 2 (deltas; approve with changes).** DD5's `restoreTabs` null would have defeated `isRestorePending`'s boot-restore hazard gate — dropped; the `recoverTabs`-first ternary alone suffices. DD1's grep-AC widened to all of `src/main/` (`window-factory.js`'s `isFindableTab` was a third bare read) and `shortcut-controller.js`'s F6 branch gains crash parity. Queue replay: adopts/re-pushes sent directly before the FIFO flush, gap sends deduped last-wins per `(wcId, channel)`. Cleared: `sendOrQueue` is no behaviour change for a normal boot; popup `win.close()` runs the existing teardown cleanly; Electron 44's `crashReporter.start` accepts no `submitURL` with `uploadToServer: false`. Two cycles used (max); the remaining items were mechanical and applied without a third pass.
