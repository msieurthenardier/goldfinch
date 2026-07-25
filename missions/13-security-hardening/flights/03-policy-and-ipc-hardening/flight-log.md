# Flight Log: Policy and IPC Hardening Batch

**Flight**: [Policy and IPC Hardening Batch](flight.md)

## Summary

Planning complete. Branch `flight/03-policy-and-ipc-hardening` stacked on flight 2. Covers audit findings 2 (permission allowlist), 4 (IPC sender + tab-navigate URL), 5 (nav guards), 6 (vault isTrusted).

---

## Reconnaissance Report

Source: issue #131 findings 2, 4, 5, 6. Full IPC/permission/nav/vault recon against `flight/02` HEAD, 2026-07-25 (embedded in the flight DDs). Key facts:

| finding | current state | evidence |
|---|---|---|
| 2 permission | 12-entry deny-list, `granted = !SENSITIVE.has(perm)` → default-allow | `session-runtime.js:4-17,227-235`; `privacy-permission` push at `:231`; internal excluded via `applyShields` early-return |
| 2 app needs | app requests NOTHING (no getUserMedia/requestFullscreen/device handlers) | grep `src/` clean |
| 4 unguarded chrome-trust | `tab-navigate`/`tab-find`/`tab-history-snapshot`/`rescan-media`/`new-container-create`/`identity-new`/`privacy-*`/`zoom`/`print`/`toggle-devtools`/`page-context-*` ignore sender | `register-tab-ipc.js`, `register-browser-ipc.js` inventory |
| 4 tab-navigate URL | `loadURL(args[0])` — NO isSafeTabUrl (unlike automation/nav.js) | `register-tab-ipc.js:654-670` |
| 4 HIGH regression risk | `openSiteSettingsTab` navigates internal tab to `goldfinch://` via tab-navigate | `overlay-menus.js:120` |
| 5 nav guards | only `will-navigate` + `setWindowOpenHandler` on guests; NO will-frame-navigate/will-redirect; NO web-contents-created | `guest-wiring.js:65-79`; grep clean |
| 5 web-contents-created timing | fires synchronously during `new WebContentsView()`, before wireGuestContents | `register-tab-ipc.js:112-115` |
| 6 vault isTrusted | submit listener has NO isTrusted check; sibling icon handlers do | `webview-preload.js:329` vs `vault-fill-icon.js:191` |
| 6 edit target | source `webview-preload.js` (bundle regenerates) | flight 2 bundling |

---

## Leg Progress

*(none yet)*

---

## Decisions

*(runtime decisions will be recorded here)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Flight Director Notes

- 2026-07-25 — Flight 3 planned autonomously; branch stacked on flight 2. Architect design review: approve-with-changes (HIGH tab-navigate internal-tab regression caught pre-implementation; nav guards recognized as a live behavior change, not pure defense-in-depth). Leg split into permission (live) / ipc-sender+vault (mechanical) / nav-guards (live) so the risky live-behavior legs are isolated from the mechanical one.
