# Flight: Spike & Decision Gate

**Status**: completed
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria
- [ ] **SC2** — Spike-gated commitment, verified on pixels (this flight *is* SC2)
- [ ] Informs SC1/SC3/SC4 design and de-risks SC7 (#27/SC10) and SC8 — not claimed here

---

## Pre-Flight

### Objective

De-risk the WebContentsView migration before a single production leg is built. On the Flight-1 branch
(off the mission branch), branch-mutate the real app into a throwaway `BaseWindow` + `WebContentsView`
prototype and empirically settle the migration's four unknowns — frameless+drag, **panel-overlay-as-
native-view** (the make-or-break), the tab view-hosting model, and `found-in-page` delivery — judging
each on the **rendered surface (pixels)**, not DOM geometry. The flight runs as a hands-on alignment
session and ends with a recorded go / review-together decision in the flight log. A clean result
authorizes Flight 2; a non-clean result pauses for an operator options-review (never auto-abort). The
prototype code is discarded — only the decision and learnings carry forward.

### Open Questions
- [x] What apparatus produces the pixel evidence? → DD2 (capturePage/window-capture → PNG → visual HAT)
- [x] How is the decision recorded? → DD4 (inline in the flight log)
- [x] Standalone harness vs. branch-mutate the real app? → DD1 (branch-mutate, throwaway, not merged)
- [x] How do we capture *composited* pixels of stacked native views? → DD3 (single-contents
  `capturePage()` is insufficient; establish an OS/window-level capture in Leg 1 before trusting any
  probe verdict)
- [ ] **Carried to the spike itself (these are what the spike answers, not pre-flight blockers):** does
  the panel composite cleanly over a `WebContentsView` guest on layout-change/animation? does
  `found-in-page` fire on a directly-constructed `WebContentsView` `webContents`? one-view-per-tab vs.
  one reused view — which has the cleaner geometry/z-order/show-hide story?

### Design Decisions

**DD1 — Branch-mutate the real app; prototype is throwaway, not merged.**
- Choice: Prototype directly against `src/main` + `src/renderer` on the Flight-1 branch (branched off the
  mission branch), exercising the real panel DOM, real container/jar partitions, and real preload paths.
  The branch is **abandoned/discarded** after the decision — its prototype code never merges to the
  mission branch; Flight 2 starts clean from the mission branch.
- Rationale: Higher fidelity than a standalone harness — the panel-overlay verdict (the gate) is only
  trustworthy against the real panel's complexity (Shields toggles, jar picker, music player) and real
  partitions. A toy harness could pass where the real app fails.
- Trade-off: Discipline required so prototype code doesn't leak into Flight 2 (mitigated by discarding
  the branch); the planning artifacts (`flight.md`, `flight-log.md`) live on the mission branch, not the
  discarded spike branch, so the decision survives.

**DD2 — Apparatus: main-process capture → PNG → visual HAT (no Witnessed behavior test).**
- Choice: The prototype captures rendered pixels via main-process capture (`webContents.capturePage()`
  for single contents; an OS/window-level grab for the composite — see DD3), writes PNGs to the ephemeral
  evidence dir, and the operator judges them by eye in the alignment session. Plus live eyeballing of the
  running window. **No** `/behavior-test` Witnessed spec this flight.
- Rationale: The prototype is throwaway and carries no MCP automation surface, so the project's
  `captureWindow()` behavior-test apparatus isn't available; and the acceptance signal here is a human
  pixel judgment ("does it look right / does it mis-composite like #27 did"), which is exactly visual
  HAT. Act path = manual/interactive driving + capture calls; read path = the PNGs + the live window.
- Trade-off: Not a repeatable automated gate — acceptable for a one-shot decision spike. The *real*
  surfaces get Witnessed coverage in Flights 2–6 against the existing corpus.

**DD3 — Acceptance signal is composited pixels, not DOM geometry — and single-contents capture is
structurally insufficient for the composite.**
- Choice: Treat "DOM geometry reads correct" as necessary-but-insufficient (`CLAUDE.md` "DOM correct ≠
  render correct"). The panel probe must judge the *composite* of two stacked native views, which
  `webContents.capturePage()` on **either** single contents cannot show (it cannot capture the overlap
  region of two sibling native views). Leg 1 **commits to an OS/window-level grab as the primary composite
  apparatus** (`desktopCapturer` window source — goldfinch uses no `desktopCapturer` today, so this is new
  prototype plumbing) **with live operator observation as load-bearing, not a fallback** (live eyeball was
  the only thing that caught #27). Leg 1 must also resolve a known hazard: goldfinch's existing
  `captureWindow` is `chromeContents.capturePage()` (`observe.js:212`) and the docs *claim* it returns
  "chrome + composited guests," but guest capture has a documented blank-on-background failure under WSLg
  (`observe.js:6-13`; `tests/behavior/foreground-to-act.md:12`) — so Leg 1 must empirically determine
  whether host-window `capturePage()` even includes the new `WebContentsView` guest pixels at all, and
  prove the chosen apparatus can see a *deliberately induced* mis-composite before any probe verdict is
  trusted.
- Rationale: This is the precise failure class that defeated three CSS attempts in M04 Flight 6; a
  geometry-only or single-contents check is the documented false-confidence trap, and the existing
  capture path's blank-guest behavior is direct evidence the hazard is real on this venue.
- Trade-off: A little apparatus plumbing up front, before the interesting probes.

**DD4 — Decision recorded inline in the flight log.**
- Choice: Per-probe verdict (pass / fail / mac-unknown), evidence references (PNG paths in the ephemeral
  dir), and the overall **clean → go (Flight 2)** / **not-clean → operator options-review** decision are
  written directly into `flight-log.md`. No separate spike-report artifact.
- Rationale: Operator preference; keeps the decision with the flight's execution narrative.
- Trade-off: None material.

**DD5 — macOS not assessed this flight; recorded as deferred.**
- Choice: All probes run on Linux/WSLg (the only in-loop venue). macOS-authoritative aspects (traffic
  lights, `titleBarStyle`, platform compositing differences) are recorded as **unknown / cross-fingers
  pending venue**, NOT as "pass." The flight log states the mission's macOS stance: defer + build-
  readiness; CI mac builds ~a week out; a contributor built an earlier version on mac.
- Rationale: Honesty about the verification gap (a Mission 04 lesson — "macOS-authoritative" must not be
  silently treated as passing).
- Trade-off: The frameless/drag and compositing verdicts carry an explicit mac caveat into Flight 2.

### Prerequisites
- [ ] **Create the long-running mission branch off `main`** (verified absent at planning — only `main` +
  old `flight/0x` branches exist), then create the Flight-1 branch off the mission branch.
- [ ] Local Electron run works on Linux/WSLg with a live display (GUI) — the spike needs visible pixels.
- [ ] Electron ^42.4.0 confirmed installed (already verified at mission planning).
- [ ] Ephemeral evidence directory available at the ARTIFACTS.md path
  (`/tmp/behavior-tests/goldfinch/spike-webcontentsview/{timestamp}/` or equivalent scratch) — PNGs are
  local-only, never committed.

### Pre-Flight Checklist
- [x] All open questions resolved (the remaining open items are what the spike *answers*, by design)
- [x] Design decisions documented (DD1–DD5)
- [ ] Prerequisites verified (branch creation is the first execution step — see Prerequisites)
- [x] Validation approach defined (visual HAT; DD2/DD3)
- [x] Legs defined

---

## In-Flight

### Technical Approach

This is a **hands-on alignment flight**, not an `/agentic-workflow` batch — the operator and agent work
the prototype live and judge pixels together. On the Flight-1 branch, incrementally mutate the real app:
swap `BrowserWindow` → `BaseWindow`, host the chrome as a `WebContentsView`, and host guest pages as one
or more `WebContentsView`s with `webPreferences` set at construction (reproducing the web-tab
`contextIsolation:false` + farble preload, and the internal partition, that `will-attach-webview` sets
today). Drive each of the four probes, capturing composited pixel evidence (DD2/DD3). Keep changes
throwaway and reversible. End by writing the decision into the flight log and discarding the prototype.

The probes, in dependency order:
1. **Capture apparatus** (Leg 1) — prove we can *see* the composite of stacked native views (DD3).
2. **Frameless + drag** (Leg 2) — `BaseWindow` frame/titleBar/trafficLight options + a working drag
   region from a chrome `WebContentsView`. (Linux/WSLg verdict only; `-webkit-app-region` propagation
   through a child view is genuinely open per-platform — note the mac caveat, DD5.)
3. **Panel-as-native-view** (Leg 3, THE GATE) — **probe the parity model first**: today the panel is a
   flex *sibling* that animates `width: 0 → var(--panel-w)` and thereby **resizes the guest** (`styles.css`
   `#webviews{flex:1}`), and #27 was that **animated open/close resize** glitching — so the gate must
   reproduce the panel as a sibling native view whose open/close **animates the guest `WebContentsView`'s
   bounds**, and confirm on pixels the guest stays correctly painted *through the transition*, not just at
   rest. A static or wrong-model composite passing is the top false-go risk. **Then, only if it comes
   free, probe the true overlay-over-guest model** (the SC7/#27 bonus); if the overlay model is not clean,
   that is an acceptable "go with the parity model, SC7 deferred to Flight 6," not a gate failure.
4. **Tab view-hosting model** (Leg 4) — prototype one-`WebContentsView`-per-tab vs. one reused view:
   show/hide, geometry from a tab strip, z-order vs. chrome + panel.
5. **Renderer↔guest event seams** (Leg 5) — two parts, since the same `<webview>`-element root cause
   governs both: (a) `found-in-page` — call `findInPage()` on a real `WebContentsView` `webContents` and
   confirm the event fires on the main-process contents (would let the D1 workaround be deleted); (b) **the
   `sendToHost`/`ipc-message` seam** — today the media scanner (`media-list`) and fingerprint counts
   (`privacy-fp`) stream preload→host via `sendToHost` to the `<webview>` element (`renderer.js:1044`),
   which has **no `WebContentsView` equivalent** (there is no host element). Confirm a replacement delivery
   path (main-world preload → `ipcRenderer.send` to main → forward to chrome) actually works — this gates
   the media + privacy panels and is *more* at risk than `found-in-page`.
6. **Security-critical spot-checks** (Leg 6, while the prototype exists — cheap now, expensive later) —
   (a) **farble preload runs in the page main world** on a directly-constructed `WebContentsView`
   (`webPreferences.contextIsolation:false`, no `will-attach-webview` hook): load a page, confirm a
   fingerprint API is actually wrapped (a silent failure here is a privacy regression no pixel probe
   catches); (b) **internal-partition identity**: a `WebContentsView` built with
   `webPreferences.partition = INTERNAL_PARTITION` lands on the *same* `session.fromPartition` object the
   internal handler/`__goldfinchInternal` wiring uses (jar membership is decided by session-object
   identity — drift silently breaks the trust boundary or MCP jar-scoping). If either can't be settled
   here, the decision records it as a **named, deferred risk**, not a silent omission.

### Checkpoints
- [ ] Capture apparatus demonstrably shows a deliberate mis-composite (apparatus is trustworthy)
- [ ] Frameless window with a working drag region (Linux/WSLg; mac caveat noted)
- [ ] **Panel (sibling model) animates the guest's bounds open/close with the guest correctly painted
  *through the transition* — the gate.** Overlay model probed only if free (SC7 bonus)
- [ ] A workable tab view-hosting model identified (with a recommendation for Flight 3)
- [ ] `found-in-page` delivery on a `WebContentsView` confirmed (or its replacement path identified)
- [ ] **`sendToHost`/`ipc-message` replacement path confirmed** (media-list + privacy-fp streams)
- [ ] **Farble preload confirmed running in the page main world** on a constructed `WebContentsView`
- [ ] **`INTERNAL_PARTITION` → internal-session-identity** confirmed (or recorded as named deferred risk)
- [ ] Decision recorded inline in the flight log; macOS stance recorded; prototype branch discarded

### Adaptation Criteria

**Divert if**:
- The **panel *parity* model (animated sibling-resize of the guest) reproduces the #27 mis-composite** →
  STOP; do NOT proceed to Flight 2. Trigger the operator options-review (alternatives:
  panel-as-own-`WebContentsView`, clipped-chrome-view, no-animation, or accept the panel parity model is
  blocked). (The *overlay* model failing is NOT a divert — it only defers SC7 to Flight 6.)
- The **`sendToHost`/`ipc-message` seam has no working replacement** → media + privacy panels can't
  migrate; STOP for options-review (this is a parity hole, not a polish gap).
- The **capture apparatus can't produce trustworthy composited pixels** → resolve the apparatus before
  any probe verdict is believed (a geometry-only or single-contents "pass" is worthless here).
- A probe needs macOS to settle and the verdict materially changes the migration plan → record as
  mac-gated open item, don't fabricate a Linux verdict.

**Acceptable variations**:
- Probe order, exact harness structure, OS-screenshot vs. `desktopCapturer` for the composite grab.
- Settling the tab view-model as a *recommendation* (final call is Flight 3) rather than a commitment.
- Partial wins: e.g. frameless/drag/found-in-page all clean but panel needs its own view — that's a
  "clean with a noted approach," still a go, with the panel approach fed into Flight 6.

### Legs

> **Note:** Tentative; this is a hands-on alignment flight, so legs are exploration steps run live with
> the operator rather than autonomous `/agentic-workflow` units. The whole flight is the HAT/alignment
> session — no separate `hat-and-alignment` leg.

- [ ] `spike-harness-and-capture` - On the Flight-1 branch, scaffold the `BaseWindow` + `WebContentsView`
  mutation and establish the composited-pixel capture method (DD3: `desktopCapturer` window grab + live
  eyeball); determine whether host-window `capturePage()` even includes the guest view; prove the
  apparatus can see a deliberately induced mis-composite.
- [ ] `probe-frameless-drag` - `BaseWindow` frameless + working drag region from a chrome
  `WebContentsView`; capture pixel + live evidence; note the Linux-only / mac-unknown caveat. (Informs SC8.)
- [ ] `probe-panel-native-view` - **THE GATE.** Reproduce the panel as a sibling native view whose
  open/close **animates the guest `WebContentsView`'s bounds** (today's parity model); confirm on pixels
  the guest stays correctly painted *through the transition*. Then probe the overlay-over-guest model only
  if it comes free (SC7 bonus). (De-risks SC7; gates the migration.)
- [ ] `probe-tab-model` - Prototype one-view-per-tab vs. one reused view (show/hide, geometry, z-order);
  produce a recommendation for Flight 3. (Informs SC1/SC3.)
- [ ] `probe-event-seams` - (a) `found-in-page` delivery on a `WebContentsView` contents; (b) the
  `sendToHost`/`ipc-message` replacement path for the `media-list` + `privacy-fp` streams (no host
  element on a view). Both are the migration's event-seam re-architecture. (Informs SC4/SC5.)
- [ ] `probe-security-spotchecks` - While the prototype exists: (a) farble preload runs in the page main
  world on a constructed `WebContentsView`; (b) `INTERNAL_PARTITION` lands on the internal session by
  object identity. Settle here or record as named deferred risks. (Informs SC5/SC6.)
- [ ] `decision-record` - Write per-probe verdicts + evidence refs + the clean→go / not-clean→review
  decision + the macOS-defer stance + any named deferred risks inline in the flight log; update mission
  Known Issues if a probe surfaced a blocker; discard the prototype branch (no prototype code carries into
  Flight 2).

---

## Post-Flight

### Completion Checklist
- [x] All probes run with pixel evidence / direct assertion captured (Legs 1–6, all PASS)
- [x] Decision recorded inline in the flight log — **GO (clean)**
- [x] macOS stance recorded; mac-authoritative items flagged unknown (not "pass")
- [x] Prototype branch discarded; mission branch carries only planning artifacts + the decision
- [x] GO → Flight 2 (Window shell) is unblocked
- [x] Mission `flights` checklist updated; no blockers surfaced (Known Issues unchanged)

### Verification

No automated/behavior test — this is a decision spike verified by **visual HAT** (DD2). "Done" =
every probe judged on composited pixels (DD3) with evidence PNGs in the ephemeral dir, and a recorded
go/review-together decision in the flight log. The real surfaces get Witnessed behavior-test coverage in
Flights 2–6 against the existing corpus; this flight deliberately does not.
