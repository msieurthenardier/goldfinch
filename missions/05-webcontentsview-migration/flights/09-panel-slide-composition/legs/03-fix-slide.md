# Leg: fix-slide

**Status**: completed
**Flight**: [Side-Panel Slide Composition](../flight.md)

## Objective

Fix the confirmed side-panel slide glitch surfaced at the Leg-2 HAT (CP2 fail). Conditional leg,
pre-authorized by the flight (DD5/Leg-3). **Resolution: remove the panel width animation entirely —
panels open/close instantly.** #27/SC10 is closed by retiring the un-animatable slide rather than
fighting the compositor.

## Diagnosis (the load-bearing part)

The HAT reproduced the M04 #27 glitch "exactly the same" across the `<webview>`→`WebContentsView`
migration. FD + operator diagnosed it live:

1. **The app layout is provably correct.** Instrumented the full slide (2s then 10s, sampled every
   ~120ms via `evaluate` on the chrome wcId): `#tabstrip`/`#toolbar`/`#main` stay rock-solid at
   1398px the entire time; `document.documentElement.scrollWidth == clientWidth == 1400` throughout
   (**no horizontal overflow, ever**); `#media-panel` animates smoothly 0→360; and `#webviews` snaps
   to its final compressed width (1038) **instantly at t=0** — the guest does NOT animate.
2. **The composited output is wrong.** Operator screenshots mid-slide (at the 10s speed) show the
   whole window misaligned: chrome rendered ~150px narrow (toolbar ends ~x1250, window controls
   shifted left), guest shifted left (tab/clock clipped), privacy panel pushed off the right edge
   (body clipped — "Shiel"/"Block tracke"). Operator's sharp catch: the panel's **header row reaches
   the window edge while the body below (incl. scrollbar) is clipped ~90px short** — the panel isn't
   composited as one rigid layer during the animation.
3. **Root cause.** Since the guest re-bounds to its final width in one step (DOM `#webviews` snaps at
   t=0; the guest view follows via `tabSetBounds`), the CSS width slide only animates the chrome-DOM
   panel box while the guest stays put — a mismatched half-animation. That sustained chrome repaint
   over the slide **mis-composites the native views on WSLg** (DOM-correct, render-wrong — the
   mission's thesis, at the compositor level). Same root cause as the three M04 mechanisms that all
   "failed identically." It is a real, *captured* render defect (not a live-only flicker); the earlier
   Leg-1 "capture path shows it stable" reading was a mis-timed-capture artifact (captures landed on
   settled frames), corrected here by the operator's mid-slide screenshots.

## The fix

Remove the `width`/`margin-right` transition from `#media-panel` and `#privacy-panel`
(`src/renderer/styles.css`). Panels open/close instantly. No animated frames → nothing for WSLg to
mis-composite mid-slide. **No UX loss** (operator-confirmed): the guest already snapped instantly, so
the slide was a mismatched half-animation anyway; instant open is clean and consistent on every
platform. This is a *better* resolution than a smooth slide — the slide was structurally
un-composite-able on the native-view architecture.

## Acceptance Criteria

- [x] Width animation removed from both panels (`styles.css`); panels open/close instantly.
- [x] **Settled state unchanged / still correct** — instant open lands flush: closed `#webviews`
  1398 (flush, panel 0); open 1038 (flush, panel 360 at x1039); reclosed 1398 (flush); no
  horizontal overflow in any state (`evaluate` re-confirmed on the running instance).
- [x] **HAT re-check: glitch GONE** — operator confirmed, instant open/close (click + Ctrl+M /
  Ctrl+Shift+P), no mid-slide misalignment, no chrome shift, no clip. "The user experience really
  doesn't lose anything."
- [x] Gates green — `npm test` 1050/1050, typecheck, lint. (a11y not required — CSS-transition-only
  change; no panel DOM/ARIA structure changed.)

## Files Affected

- `src/renderer/styles.css` — `#media-panel` + `#privacy-panel` width/margin-right transition
  removed, replaced with a rationale comment.

## Deviation from the anticipated fix

The flight budgeted Leg 3 as "per-frame guest-bounds sync / transform-composited slide" (DD6) — i.e.
*make the slide smooth*. The real fix is the opposite and simpler: **retire the slide.** The
diagnosis showed the slide is structurally un-composite-able (guest snaps, only chrome animates,
WSLg mis-composites the mismatch), so animating it "correctly" was never achievable — exactly why
M04's three attempts failed. Recorded per the flight's mid-execution-scope-change discipline.
