# Flight Log: Spike & Decision Gate

**Mission**: WebContentsView Migration
**Flight**: 01 — Spike & Decision Gate
**Status**: ready

> Execution notes, probe verdicts, and the go/review-together decision are recorded here during the
> hands-on alignment session. Evidence PNGs live in the ephemeral evidence dir (not committed).

---

## Probe Verdicts

_(filled in during execution — one entry per probe, judged on composited pixels per DD3)_

| Probe | Verdict | Evidence (ephemeral PNG path / live obs) | Notes |
|-------|---------|------------------------------------------|-------|
| Capture apparatus trustworthy (Leg 1) | — | — | desktopCapturer + live eyeball; does capturePage see the guest? |
| Frameless + drag (Leg 2) | — | — | mac: unknown (DD5) |
| **Panel sibling-resize, animated (Leg 3, GATE)** | — | — | the #27 make-or-break (parity model) |
| Panel overlay-over-guest (Leg 3, bonus) | — | — | SC7 only; failure ≠ divert |
| Tab view-hosting model (Leg 4) | — | — | recommendation for Flight 3 |
| found-in-page delivery (Leg 5a) | — | — | D1 deletion candidate |
| sendToHost/ipc-message replacement (Leg 5b) | — | — | media-list + privacy-fp; higher risk |
| Farble preload in main world (Leg 6a) | — | — | privacy parity; not pixel-visible |
| INTERNAL_PARTITION → session identity (Leg 6b) | — | — | trust boundary + jar-scoping |

## Decision

_(clean → go to Flight 2 / not-clean → operator options-review — recorded here at end of flight)_

## macOS Stance (recorded per DD5)

Deferred this mission: no in-loop mac venue. Rely on Linux/WSLg + a build-readiness check + the
contributor's mac build; CI mac builds ~a week out. Mac-authoritative probe aspects are **unknown**, not
pass.

## Notes / Deviations
