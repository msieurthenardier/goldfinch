# Flight Log: Drive Engine (input / nav / tabs) + hidden-tab strategy

**Flight**: [Drive Engine (input / nav / tabs) + hidden-tab strategy](flight.md)

## Summary
_Not yet started. Flight in `planning`._

---

## Leg Progress

_None yet._

---

## Decisions
_Runtime decisions not in the original plan will be recorded here._

---

## Deviations
_Departures from the planned approach will be recorded here._

---

## Anomalies
_Unexpected issues will be recorded here._

---

## Session Notes

### 2026-06-13 — `render-strategy-spike` (DD9 gate) executed pre-flight

Ran a self-contained, throwaway Electron `^42` spike (an ad-hoc harness, since removed — faithful to
the real architecture: one `BrowserWindow`, real `<webview>` guests; mirrors `main.js:139`
`sandbox:false` for web webviews, since sandboxed guests crash on this WSL2 kernel's shm path, fixed
with `--no-sandbox --disable-dev-shm-usage`) to settle DD9 before the engine design locks. Evidence
(PNGs) in `/tmp/gf-spike/render-strategy/` (outside the repo, per ARTIFACTS); harness reproducible
from the table + notes below.

Results by axis (✅ pass / ❌ fail / ⚠️ unmeasurable here):

| Axis | (A) offscreen `-10000px` | (A) behind (occluded, on-screen) | (B) hidden `BrowserWindow` |
|------|--------------------------|----------------------------------|----------------------------|
| `capturePage` non-blank on bg | ❌ **hangs** (no frame produced) | ✅ full real content | ✅ full real content |
| `sendInputEvent` lands on bg | ✅ | ✅ | ✅ |
| same-tab front↔back, state preserved | ✅ (clicks 3→3, no teardown) | ✅ | n/a (window show/hide) |
| focus isolation from human fg | ⚠️ | ⚠️ single-window shares focus routing | ✅ by OS-window construction |
| preserves webview/tab-strip architecture | ✅ | ✅ | ❌ (tabs-as-windows) |

Key conclusions:
- **Offscreen-translation is OUT for capture**: a webview moved fully offscreen produces no frame, so
  `capturePage` hangs (input still lands). The render strategy must keep bg tabs **on-screen but
  occluded**, never translated offscreen.
- **(A) behind-layering WORKS** for capture + input + front/back with state preserved — and keeps the
  single-window tab-strip architecture and a cheap (z-order) bring-to-front. Confirmed by
  `03-bg-behind.png` (captured the occluded bg tab's full content while a different tab was in front).
- **(B) hidden window WORKS** for capture + input while never shown (`paintWhenInitiallyHidden:true` +
  `backgroundThrottling:false` + `sandbox:false`), and is focus-isolated by construction.
- **Focus interference is the deciding axis and is architectural, not measurable unattended**:
  `document.hasFocus()` is false for everything because the OS never focuses the app window in a
  headless run. By Chromium's single-window model, a `mouseDown` on a background webview focuses that
  frame and blurs the human's foreground tab — so a concurrently-typing human's physical keyboard would
  be routed to the agent's tab. (A) shares one window's focus route (a real risk for the concurrent-use
  requirement; possibly mitigable by main-process focus-restore after each agent action — unproven).
  (B) avoids this by giving each agent tab its own window. This needs a **real-human check**, not more
  unattended spiking.

**Decision (operator, 2026-06-13): Option C — foreground-to-act for v1.** Rather than build background
driving now, the agent brings a tab to the front to act on/screenshot it (the named v1 consumers are
headless/sandboxed). This collapses the DD9 complexity out of Flight 1 (no behind-layering, no
tri-state renderer, no `.bg-live` CSS, no focus-restore, no focus-interference risk) and reuses the
existing single-live-tab model. The spike is **not** wasted: it de-risked the future background-driving
path — both (A) behind-layering and (B) hidden window are proven viable on Electron `^42`, so concurrent
human+agent background work is a known future flight (prefer (A); validate single-window focus with a
real human), recorded in the mission Known Issues. DD3/DD9 in the flight spec reflect this; the spec
was simplified accordingly.
