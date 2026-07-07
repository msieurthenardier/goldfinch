# Behavior Test: Side-panel slide compositing — guest compresses flush to the panel, stays live

**Slug**: `panel-slide`
**Status**: active
**Created**: 2026-07-06
**Last Run**: 2026-07-07-00-17-13 (PASS 6/6 — first run, settled compositing). Promoted draft→active
at F9 Leg-3. **Note:** F9 removed the panel *slide animation* (panels now open/close **instantly** —
the animated slide was structurally un-animatable — the guest is a separate compositing surface that
steps discretely, so chrome-ramps-while-guest-steps mis-renders the frame on **every platform**
(operator-confirmed on native Windows, not a WSLg quirk); see the flight #27/SC10 resolution). This
spec asserts **settled-state** compositing, which
is unchanged by that fix and remains the regression net; there is no longer any inter-frame slide to
judge.

> **Why this spec exists.** Mission-05 SC7/#27/SC10: the media/privacy side panels **compress** the
> live guest (side-by-side, not overlay) via a width slide. Under `<webview>` the slide tore because
> the out-of-process guest couldn't track the animating layout; on the native `WebContentsView`
> surface the guest is re-bounded by main-process geometry and should track cleanly. This spec is the
> re-runnable regression net for the **settled compositing**: after a panel opens/closes the guest
> occupies exactly the compressed/expanded region flush against the panel — no gap, no overlap, no
> residual strip — for both panels, populated privacy, and the cross-panel switch, while the guest
> stays live.

> **No slide to judge (F9 Leg-3).** Panels now open/close **instantly** — the width animation was
> removed because it was structurally un-animatable: the guest is a separate compositing surface whose
> bounds step discretely (it snaps to its final width in one step), so only the chrome panel box
> animated and that chrome-ramps-while-guest-steps mismatch mis-renders the frame on **every**
> platform (operator-confirmed on native Windows — not a WSLg quirk). So there is no inter-frame
> smoothness property at all; this spec asserts
> **settled-state** compositing only (guest flush to the panel, no gap/overlap/residual, guest live) —
> the durable regression net. (Historical: the original F9 CP1 run judged settled state while the
> 0.18s slide still existed; removing the slide does not change any settled assertion here.)

> **Apparatus-wiring litmus (required).** Before any step, confirm the MCP client is wired to the
> **dev** instance at admin tier: `getChromeTarget()` returns a chrome wcId AND `enumerateTabs()`
> lists this instance's tabs. Use the `goldfinch-development` namespace (dev, `127.0.0.1:49252`) —
> never the production instance.

## Intent

Verify, on rendered pixels, that opening/closing the media and privacy side panels re-composites the
live guest correctly: (1) with a panel open, the guest is **compressed flush** against the panel edge
— the panel occupies its `--panel-w` (360px) strip on the right, the guest occupies the remainder,
with no gap or overlap between them; (2) the guest stays **live** under compression (content keeps
updating — the panel does not freeze it); (3) closing restores the guest to full width flush with no
residual panel strip; (4) the privacy panel composites correctly **with its body populated** (the
M04 #27 asymmetry root); (5) the cross-panel switch (media↔privacy) leaves exactly one panel inset
with the guest flush. These are settled-state "DOM-correct ≠ render-correct" checks via
`captureWindow`.

## Preconditions

- Apparatus-wiring litmus passed (dev instance, admin tier).
- App running via `npm run dev:automation` (Wayland dev backend, F8) with the semi-permanent admin
  key; `captureWindow` OS-grab path available (re-confirm via a find-bar capture canary — a find bar
  visible in pixels proves the OS-grab path; the WSLg fallback cannot composite overlay/panel state
  reliably).
- A motion fixture served (the ticking `tests/behavior/fixtures/menu-overlay/` page or a video page)
  so guest liveness under compression is observable.

## Observables Required

- **browser / rendered window — AUTHORITATIVE** (`captureWindow()`): panel-open compositing (guest
  flush to the panel edge, no gap/overlap), guest liveness under compression (tick delta), close
  restoration, cross-panel switch, return-to-baseline.
- **mcp — corroborating** (`evaluate(chromeWcId, …)`): the guest bounds the renderer computes
  (`measureWebviewsSlotDIP()` — i.e. `#webviews` `getBoundingClientRect()`), the panel `.collapsed`
  state and rendered `width`, and `aria-expanded` on the toggles. Corroboration only — pixels govern
  the flush/gap claim.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Litmus: `getChromeTarget()`, `enumerateTabs()`. Open a web tab (Default jar) on the motion fixture. Record chrome + guest wcId and the baseline `#webviews` slot bounds via `evaluate`. Baseline `captureWindow()` (no panel open). | (setup) Litmus passes. Baseline: guest full-width below the toolbar, both panels collapsed (width 0), no residual panel strip. |
| 2 | **Media open + compress (PRIMARY flush-seam assertion):** `evaluate(chromeWcId, "document.getElementById('toggle-media').click()")`. After ~0.3s settle, `captureWindow()`; `evaluate` the `#webviews` slot bounds + `#media-panel` rendered width. Wait ~2s, `captureWindow()` again. | Media panel occupies the right ~360px; the guest is **compressed flush** against the panel's left edge — no gap (dark strip) and no overlap between guest and panel. The `#webviews` width shrank by ≈ the panel width and the guest re-bounded to it. **Re-layout tell (recommended, not overlay):** on the cream fixture, compression genuinely reflows the guest — a horizontal scrollbar appears and a text line clips at the panel seam (both vanish on restore in step 3); this is the strongest evidence `#webviews` re-bounded rather than being overlaid. The guest is **live** — the ticking region **differs between the two grabs** (compression didn't freeze it). [render-correct] |
| 3 | **Media close + restore:** `evaluate(chromeWcId, "document.getElementById('media-close').click()")`. Settle; `captureWindow()`; `evaluate` slot bounds. | Panel collapsed; the guest expanded back to **full width, flush to the window edge**, with no residual panel strip or gap. Slot bounds back to baseline. [render-correct] |
| 4 | **Privacy open, settled-composite:** open a tab on a **real page with tracker/third-party activity** (NOT the static local fixture — `renderPrivacy` always appends its ~8 sections, so a child-count check on the fixture passes trivially and proves nothing; a real page yields non-zero stats). Default page: `https://www.cnn.com/` (verified tracker-heavy — first run yielded Trackers=3, Third-party domains=16); fallback if it fails/changes: any tracker-heavy news/retail site. **Network-dependent** — if offline or no page yields non-zero stats, this step is INCONCLUSIVE, not fail (the compositing isn't broken; the apparatus can't populate it). Let the page fully load / hit `#privacy-refresh` before reading (stats accrue async). `evaluate(chromeWcId, "document.getElementById('toggle-privacy').click()")`. Settle; `captureWindow()`; `evaluate` a real-content signal (a non-zero **Trackers** or **Third-party domains** `.ps-big` value, not merely `#privacy-body` child count > 0) + slot bounds. | Privacy panel open on the right with a **genuinely populated body** (a non-zero stat rendered); guest compressed flush against it, no gap/overlap. **Seam caveat:** on a dark-themed real page the guest|panel seam is dark-on-dark — judge flush by absence of any *bright gap strip* + no cross-boundary bleed, backed by the slot-width Δ; the crispest flush-seam evidence is **step 2** (cream fixture vs dark panel), which is the primary flush assertion — steps 4–6 primarily assert population / single-inset / return. **Note (HAT-scoped):** the M04 asymmetry root — privacy stats arriving *async* and reflowing the body *during* the open frame — is an inter-frame property this settled grab cannot see; the operator observes it live in the Leg-2 HAT on a real tracker-heavy page. [render-correct] |
| 5 | **Cross-panel switch:** with privacy open, `evaluate(chromeWcId, "document.getElementById('toggle-media').click()")`. Settle; `captureWindow()`. | Privacy closes and media opens as the single right panel — **exactly one** panel inset, guest still compressed flush against it (no double-inset, no gap where the old panel was, no overlap). [render-correct] |
| 6 | **Return to baseline:** close the open panel (`media-close`). Settle; final `captureWindow()`; `evaluate` slot bounds. | Frame pixel-equivalent to the step-1 baseline (modulo time-varying content): no panel, guest full-width flush, no residual strip. Slot bounds == baseline. [render-correct] |

**Row conventions:** Row 1 is setup + litmus. Rows 2–6 each assert one settled-state compositing
checkpoint. `[render-correct]` flags the SC2-class rendered-vs-DOM checks.

## Out of Scope

- **Inter-frame slide smoothness / tear / lag during the 0.18s transition** — HAT-only (see the
  apparatus-limit note); this spec asserts settled states.
- **Panel content behavior** (media scan results, download actions, music player, privacy stats
  accuracy) — covered by the media/privacy behavior tests and unit tests.
- **Overlay compositing** — panels are inset (compress), not overlays (DD1); the overlay pattern is
  the find bar / menu sheet (`find-overlay-geometry.md`, `menu-overlay.md`).
- **Panel-open + find-open / menu-open simultaneously** — the F7 find bar and F8 menu sheet float
  above the guest at *full* bounds and are not re-bounded by panel compression; the interaction is
  untested and out of scope here (likely fine; flagged for the HAT to eyeball if convenient).

## Variants (optional)

- Repeat step 2 with a **video** guest (heavier motion) — liveness-under-compression must hold for
  video too.
- Repeat step 2 while the window is at a **narrow width** — the guest must still compress flush (no
  negative/overflow bounds) at `--panel-w` against a small slot.
