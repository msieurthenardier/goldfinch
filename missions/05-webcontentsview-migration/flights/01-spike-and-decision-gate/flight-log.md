# Flight Log: Spike & Decision Gate

**Mission**: WebContentsView Migration
**Flight**: 01 — Spike & Decision Gate
**Status**: landed

> Hands-on alignment spike, run 2026-06-23/24 on Linux/WSLg (Electron 42.4.0). All probes
> judged on composited pixels (DD3 apparatus: `desktopCapturer` window-grab, validated in Leg 1)
> or on direct main-process assertions (Legs 5/6). Evidence PNGs + `leg56-report.json` +
> `VERDICTS.md` in the ephemeral dir (not committed):
> `/tmp/behavior-tests/goldfinch/spike-webcontentsview/2026-06-23-14-57-26/`.
> Throwaway prototype harness archived alongside the evidence; **not merged** (DD1).

---

## Probe Verdicts

| Probe | Verdict | Evidence | Notes |
|-------|---------|----------|-------|
| Capture apparatus trustworthy (Leg 1) | ✅ PASS | `A-desktop-window.png`, `C-guest-capturePage.png`, `leg1-report.json` | `desktopCapturer` window-grab shows the TRUE composite incl. occlusion (GUEST clipped at panel edge); per-view `capturePage` is blind to the overlap (full GUEST) — confirms DD3. Electron renders `BaseWindow`+`WebContentsView` under WSLg. |
| Frameless + drag (Leg 2) | ✅ PASS | live operator test | `frame:false` renders; `-webkit-app-region:drag` moves the window through a child `WebContentsView`; `no-drag` button clickable. **mac: unknown (DD5).** |
| **Panel sibling-resize, animated (Leg 3, GATE)** | ✅ **PASS** | `gate-open-*`, `gate-close-*`, `gate-rapid-end.png` | Guest stays correctly painted through open/close + rapid no-settle animation: no seam/gap/black-band/mis-position/tearing; panel composites flush. **#27 mis-composite does NOT reproduce** — root cause (native surface decoupled from DOM layout) is eliminated; guest IS the native view, bounds are main-process-authoritative. |
| Panel overlay-over-guest (Leg 3, SC7 bonus) | ✅ effectively won | (parity model = #27 model) | The real app's panel IS a sibling-resize, so the gate PASS *is* the SC7/#27 win — no separate overlay model needed. Final claim deferred to Flight 6 against the real panel. |
| Tab view-hosting model (Leg 4) | ✅ PASS + recommendation | `tabs-active-2.png`, `tabs-active-3.png` | One-`WebContentsView`-per-tab with `setVisible()` toggling shows exactly the active tab. **Recommend one-view-per-tab for Flight 3**: N live `webContents` = same memory profile as today's N `<webview>`s, with per-tab state persistence. |
| found-in-page delivery (Leg 5a) | ✅ PASS | `leg56-report.json` | `found-in-page` FIRES on the main-process `webContents` (matches:6). **D1 is gone** — the ~130-line renderer-routed find workaround can be deleted in Flight 4. |
| sendToHost/ipc-message replacement (Leg 5b) | ✅ PASS | `leg56-report.json` | Host-element-less seam replaced: main-world preload → `ipcRenderer.send` → main delivers `media-list` + `privacy-fp`. Media scanner + fingerprint streams migrate. |
| Farble preload in main world (Leg 6a) | ✅ PASS | `leg56-report.json` | `contextIsolation:false` preload runs in the page main world (marker visible to page JS, canvas `toDataURL` wrapped) with NO `will-attach-webview` hook; `contextIsolation:true` control correctly isolates. Privacy parity holds. |
| INTERNAL_PARTITION → session identity (Leg 6b) | ✅ PASS | `leg56-report.json` | View built with `partition: INTERNAL_PARTITION` lands on the SAME session object as `session.fromPartition(INTERNAL_PARTITION)`; web guest session differs. Trust boundary + jar-scoping invariant preserved. |

## Decision

**GO — clean.** All six probes (apparatus + frameless/drag + the gate + tab-model + event-seams +
security) passed on pixels / direct assertion, with zero diverts triggered. The migration's one
make-or-break unknown (panel compositing under animation, the #27 class) is resolved in the
architecture's favor: native `WebContentsView` bounds are main-process-authoritative, so the
DOM-layout-decoupling that caused #27 no longer exists. **Flight 2 (Window shell) is unblocked.**

Bonus: **SC7 / #27 / SC10 looks winnable for free** — the parity sibling-resize model (which is how the
real panel already works) is exactly what the gate proved clean. Confirm against the real animated panel
in Flight 6.

## Carried into later flights (named, not blockers)

- **Flight 4** — delete the `find.js` D1 renderer-routing workaround (5a proved direct delivery); re-home
  the `media-list`/`privacy-fp` streams to the 5b `ipcRenderer.send` path.
- **Flight 3** — adopt one-view-per-tab + `setVisible` toggling; set per-tab `webPreferences`
  (`contextIsolation:false` + farble preload for web; `partition` for jars) at `WebContentsView`
  construction (no `will-attach-webview`).
- **Flight 5** — internal pages via `webPreferences.partition = INTERNAL_PARTITION` (6b proved session
  identity); keep the four gates.
- **Flight 6** — re-confirm the gate against the REAL animated panel + a live eyeball, then claim SC7.

## macOS Stance (recorded per DD5)

Deferred this mission: no in-loop mac venue. Rely on Linux/WSLg + a build-readiness check + the
contributor's mac build; CI mac builds ~a week out. **Mac-authoritative aspects are UNKNOWN, not pass** —
specifically: `titleBarStyle:'hidden'` + traffic-light position, `-webkit-app-region` drag propagation on
mac, and platform compositing differences in the gate. Re-verify these when a mac venue exists. The
durable apparatus decision (mac CI runner vs. periodic session vs. operator gate) is carried to the
post-mission maintenance pass.

## Notes / Deviations

- **Approach deviation (operator-approved mid-flight):** after Leg 1 showed native-view compositing works
  at rest, the operator chose to probe the remaining unknowns in the evolving minimal harness rather than
  branch-mutate the real app (DD1's original plan). Rationale: Leg 1 narrowed the gate to a
  compositor-only question, independent of the real panel's DOM richness; the harness settles it far more
  cheaply. Real-app integration is Flights 2–6 work, netted by the existing behavior-test corpus. Probes
  6a/6b still used the REAL `INTERNAL_PARTITION` constant and the real farble pattern for fidelity.
- **Gate caveat:** discrete-step + single rapid capture cannot catch a sub-frame transient during
  continuous 60fps animation; root-cause reasoning predicts none. Re-confirm with the real animated panel
  + live eyeball in Flight 6 (already carried above).
- Prototype harness (`spike/`) discarded per DD1 — not committed to the mission branch.
