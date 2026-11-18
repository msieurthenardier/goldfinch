# Squawk 0210: Six deliberate bare chrome sends in `guest-wiring.js` are unpinned and contradict CLAUDE.md

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
CLAUDE.md says there is "no bare `chromeForTab(wcId)?.send` in `guest-wiring.js`", but six exist outside `wireTabViewEvents`. They are deliberately unqueued (keystroke / right-click / page-initiated sends whose replay after a chrome boot would act on stale input), so the code is right and the wording and pin are not. Found by routine maintenance 2026-11-18 (finding #22).

## Evidence
- `src/main/guest-wiring.js` — `handleChromeShortcut` (`chrome-shortcut-action`), `wireGuestContents` (`open-tab`, `open-find`, `open-downloads`, `devtools-state-changed`, `page-context-menu`).
- `test/unit/guest-wiring.test.js` — the zero-bare-send pin scans `wireTabViewEvents` only.
- CLAUDE.md *Chrome recovery* bullet: "no bare `chromeForTab(wcId)?.send` in `guest-wiring.js`".

## Corrective Action
*(written at completion)*

## Verification
The pin covers the whole file with the six sends listed by channel as deliberate exceptions (a seventh bare send fails it; neuter-verified), and CLAUDE.md names the exception.
