# Flight Debrief: Spike & Decision Gate

**Date**: 2026-06-24
**Flight**: [Spike & Decision Gate](flight.md)
**Status**: landed
**Duration**: 2026-06-23 – 2026-06-24
**Legs Completed**: 7 of 7 (all probes passed)

> **Right-sized debrief.** This was a throwaway decision spike (DD1): it committed **zero production
> code** — the prototype harness was discarded, no `src/` file or test changed. The standard spawned
> Developer/Architect crew interviews and a full test-suite metrics run were deliberately skipped: there
> is no production diff to examine and no test-timing delta to capture (the suite is unchanged from
> Mission 04's baseline). Analysis below is written firsthand from running every probe + the flight log.

## Outcome Assessment

### Objectives Achieved
The spike resolved every migration unknown and returned a **clean GO** for the `WebContentsView` +
`BaseWindow` migration, gated on composited pixels (DD3 apparatus) and direct main-process assertions.
All six probes passed on Linux/WSLg (Electron 42.4.0): capture apparatus, frameless+drag, the panel
animation gate, tab view-hosting model, the renderer↔guest event seams, and the security spot-checks.
No divert triggered. Per-probe verdicts + evidence live in the flight log and the ephemeral evidence dir.

### Mission Criteria Advanced
- **SC2 (spike-gated commitment, verified on pixels)** — **MET**. The mission's gating criterion.
- **SC7 (#27/SC10 side-panel compositing)** — de-risked to "looks free": the gate proved the parity
  sibling-resize model (which is how the real panel already works) composites cleanly under animation, so
  #27's root cause is structurally eliminated. Final claim deferred to Flight 6 against the real panel.
- Informs **SC1/SC3** (tab view model), **SC4** (find direct + sendToHost replacement), **SC5/SC6**
  (farble main-world + partition identity) — each now has a proven approach feeding the relevant flight.

## What Went Well
- **The gate was decided on pixels, and the apparatus was validated *before* it was trusted.** Leg 1
  proved `desktopCapturer` window-grab captures the true composite (occlusion visible) while per-view
  `capturePage` is structurally blind to the overlap — so DD3's "single-contents capture is insufficient"
  wasn't an assumption, it was demonstrated, then the gate verdict rode the validated apparatus. This is
  the M04 lesson ("acceptance signal is the rendered surface, observed") applied correctly from step one.
- **The agent-reads-the-PNG visual-HAT loop worked and is reusable.** The harness wrote PNGs; the Flight
  Director read them as images and judged the composite directly, with the operator's live eyeball as the
  load-bearing backstop for the one OS-interactive probe (drag). Cheap, fast, and honest about pixels —
  a reusable pattern for any future native-surface verification where the full MCP `captureWindow`
  apparatus is unavailable (e.g. throwaway prototypes).
- **The pre-flight Architect design review earned its keep — it prevented a false GO.** It caught two
  real probe-coverage gaps: (a) the gate was mis-framed as "panel overlay over guest" when the real panel
  is a flex *sibling that resizes the guest*, and #27 was specifically the *animated* resize — a static
  or wrong-model probe could have passed while shipping a #27 reproduction; (b) only `found-in-page` was
  probed, but the `sendToHost`/`ipc-message` media+privacy streams share the same `<webview>`-element
  root cause and had no probe. Both were folded in before execution; both then passed. Without the
  review, a "clean GO" could have hidden two parity holes.
- **Risk was front-loaded correctly.** The make-or-break unknown (animated panel compositing) was the
  gate, sequenced right after apparatus validation — so the most likely "no-go" was settled early rather
  than after sunk probe cost.

## What Could Be Improved

### Process
- **The gate mis-framing was mine at flight-design time, not the operator's at execution.** I described
  the panel probe as "overlay over guest" in the first flight draft; the real model is sibling-resize.
  The Architect caught it, but the lesson is to **read the actual layout mechanism** (here: the panel CSS
  `transition` shrinking `#webviews` via flex) *when authoring the probe*, not to rely on the review to
  correct framing. Cost was zero (caught pre-execution) but the habit should be upstream.

### Technical
- **macOS remains entirely unverified** — `titleBarStyle`/traffic-lights, `-webkit-app-region` drag on
  mac, and platform compositing in the gate are all UNKNOWN (not pass). This is the standing Mission-04
  gap; the spike honestly recorded it rather than papering over it, but it persists into Flights 2–6.

### Documentation
- The `<webview>` "DOM-correct ≠ render-correct" gotcha in `CLAUDE.md` now has a **resolution** worth
  noting when the migration lands: native-view bounds are main-process-authoritative, removing the
  decoupling. Not a doc change now (premature pre-migration), but a flagged edit for the mission's
  landing flight.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Switched from branch-mutate-the-real-app (DD1) to an evolving minimal harness for Legs 2–6, mid-flight | Leg 1 narrowed the gate to a *compositor-only* question, independent of the real panel's DOM richness; the harness settles it far more cheaply, and probes 6a/6b still used the real `INTERNAL_PARTITION` + farble pattern for fidelity. Operator-approved at the checkpoint. | **Yes (as a spike heuristic)** — for a decision spike, prefer the cheapest apparatus that still answers the question; escalate to real-app fidelity only where the question depends on it. Right call here: every probe stayed decisive. |
| Gate probe re-framed (overlay → animated sibling-resize) before execution | Architect design review caught that the real panel is a flex-sibling resize and #27 was the animated transition. | Yes — **premise-audit probe coverage against the real mechanism**, not the assumed one. |

## Key Learnings
- **A throwaway spike with a validated pixel apparatus can retire a multi-flight structural risk in one
  session.** The migration looked high-risk (5 cross-mission `<webview>` failures); the spike showed the
  target architecture eliminates the *root cause* rather than working around it — converting "high-risk
  migration" into "mechanical migration with a proven approach per flight."
- **Probe coverage is a premise to audit, exactly like apparatus.** The flight skill already says
  premise-audit the apparatus on both axes (act/observe); this flight shows the same rigor must apply to
  *which probes exist* — a missing probe (sendToHost) or a wrong-model probe (static overlay) produces a
  confidently-wrong GO. The design review is where that audit happened; it should be a named expectation.
- **"Clean GO" must enumerate what it did *not* test.** The decision explicitly carries macOS-unknown,
  the sub-frame-transient caveat, and the real-panel re-confirmation — so the GO can't be mis-read as
  "everything verified." This honesty is what keeps Flight 6's re-confirmation from being skipped.

## Recommendations
1. **Carry the proven approaches into the right flights as design inputs** (not rediscovered):
   Flight 3 → one-view-per-tab + `setVisible`, per-tab `webPreferences` at construction; Flight 4 →
   delete the `find.js` D1 workaround + re-home `media-list`/`privacy-fp` to `ipcRenderer.send`;
   Flight 5 → internal pages via `webPreferences.partition = INTERNAL_PARTITION`; Flight 6 → re-confirm
   the gate against the **real animated panel** + live eyeball, then claim SC7.
2. **Reuse the agent-reads-the-PNG visual-HAT loop** as the default apparatus for throwaway native-surface
   probes where the full MCP `captureWindow` surface isn't wired — validate the capture method sees the
   composite first (Leg-1 pattern), then trust it.
3. **Promote "premise-audit probe coverage" to a named flight-design expectation** for spike/verification
   flights — the design review caught two false-GO gaps here; make that a checklist item, not luck.
4. **Keep the macOS gap visible at mission level** — it's now blocked behind no-venue across two missions;
   the durable apparatus decision (mac CI runner vs. session vs. operator gate) is carried to the
   post-mission maintenance pass and should not silently re-defer.

## Action Items
- [ ] Feed the four "carried approaches" into Flight 2–6 design (Recommendation 1) — owner: `/flight` per flight.
- [ ] Flight 6: re-confirm the gate against the real animated panel + live eyeball before claiming SC7.
- [ ] At mission landing: update the `CLAUDE.md` `<webview>` gotcha to record the migration resolution.
- [ ] Carry the macOS apparatus decision to the post-mission maintenance pass (already in mission debrief lineage).
- [ ] No behavior-test spec authored here (throwaway spike); the real surfaces get Witnessed coverage via the existing corpus in Flights 2–6.
