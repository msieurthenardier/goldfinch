# Behavior Test: HTML5 Video Fullscreen Expands Over Chrome

**Slug**: `web-compat-fullscreen`
**Status**: active
**Created**: 2026-07-27
**Last Run**: never

## Intent

Verifies that a page calling `requestFullscreen()` on a video expands the guest over the browser chrome to fill the window and restores the normal layout cleanly on exit (including Esc). This is main-process bounds/z-order behavior across a real compositing surface — unit tests pin the wiring logic, but only live observation can judge "the chrome is actually not visible" and "the layout restores." Includes one step against a real video site per the mission criterion.

## Preconditions

- App launched via `npm run dev:automation` (goldfinch MCP reachable; `enumerateTabs` responds).
- Fixture server running: `node tests/behavior/fixtures/web-compat/serve.mjs --port {P}` (serves `/video.html` with an embedded `<video>` and a fullscreen button; port must not collide with the MCP port).
- Network access for the real-video-site step.

## Observables Required

- browser (DOM state via `evaluate`/`readDom`; visual chrome-visibility via `captureWindow` screenshots — measured via goldfinch MCP)
- shell (fixture server lifecycle — measured via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab to `http://127.0.0.1:{P}/video.html`. Wait for the video element. | Page loads; `document.fullscreenElement` is null; a window capture shows tab strip and toolbar visible. |
| 2 | Click the page's fullscreen button (real user gesture via MCP click on the button's coordinates/element). | Within 2s, `document.fullscreenElement` is the video. A window capture shows the video surface filling the window — no tab strip, no toolbar visible. |
| 3 | Press Escape (key routed to the guest). | Within 2s, `document.fullscreenElement` is null. A window capture shows tab strip and toolbar restored; page content laid out in the normal slot. |
| 4 | Re-enter fullscreen via the button, then open a second tab via MCP `openTab` and activate it. | Fullscreen force-exits: the first tab's `document.fullscreenElement` is null; the window shows normal chrome with the second tab active. |
| 5 | Close the second tab, re-activate the video tab, re-enter fullscreen, then exit via the button (not Esc). | `document.fullscreenElement` null; chrome restored — both exit routes converge on the same restore path. |
| 6 | Navigate a tab to a real video site (primary: a YouTube video page; fallback if consent/autoplay interstitials block the run: any Wikimedia Commons video page — interstitial-free), start playback, activate player fullscreen. | Video fills the window with no goldfinch chrome visible. |
| 7 | Press Escape. | Site's normal page layout returns with goldfinch chrome visible. |

## Out of Scope

- OS-level fullscreen (`win.setFullScreen`) — optional extra per mission ruling, not required.
- Fullscreen "feel"/transition quality — HAT/alignment flight.
- Popup or auth behavior — see `web-compat-basic-auth`, Flight 2 specs.
