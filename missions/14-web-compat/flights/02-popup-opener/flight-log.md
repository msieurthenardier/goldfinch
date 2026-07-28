# Flight Log: Popup & Opener Ruling + Implementation

**Flight**: [Popup & Opener Ruling + Implementation](flight.md)

## Summary

Pre-flight. Premise spike complete; proposal authored; awaiting the mission-gated human ruling.

---

## Premise Check (pre-flight spike, 2026-07-28)

Throwaway worktree at `71a4f15`, Electron 43.2.0, OAuth fixture (opener/popup postMessage round-trip), driven via admin-keyed automation on a pinned port with fresh userData (instance identity guaranteed). All findings observed directly:

- `{action:'allow'}` (± `overrideBrowserWindowOptions`): live opener handle, bidirectional postMessage, **session always the opener's jar** (partition overrides silently ignored); popup is a `BrowserWindow` outside the registry (no census, auth challenges silently cancel, non-guest nav-guard shape).
- `createWindow` override: **adopt hook, not construct hook** — Electron passes a pre-created opener-linked `options.webContents`; adopting it into a `WebContentsView` on the existing BaseWindow preserves the opener fully (both postMessage directions verified). **Returning any other contents permanently wedges the opener renderer, silently** — absolute implementation taboo.
- Teardown manual in the adopt path (`close` → `destroyed`; host window untouched; dead view must be detached by the implementation). #119 hazard does not apply to window.open-created contents.
- Latch race: same shape as tab-create; setting `__goldfinchNavGuarded` first-thing in the adopt hook is early enough (observed).
- Preload not inherited; injectable via `overrideBrowserWindowOptions.webPreferences.preload`; with preload in, self-close routes through `guest-window-close` → works **only** if `chromeForTab` resolves the popup (i.e., chrome-registered) — else silent no-op.
- Popup `window.open` needs no user gesture (automation-triggerable).

## Flight Director Notes

- Flight 1 debrief carry-forwards applied: premise-check-first (done, above); four grown parity rows folded into the proposal's checklist; apparatus DD names the key-tier/instance-identity constraints explicitly.
- Proposal authored at [popup-proposal.md](popup-proposal.md) — three options, recommendation Option A (popup-as-adopted-tab). **Paused for the human ruling per the mission gate.** No implementation, no legs, until approved.

---

## Leg Progress

*(post-ruling)*

## Decisions

*(post-ruling)*

## Deviations

*(none)*

## Anomalies

*(none)*

## Session Notes

- 2026-07-27/28: planning session — spike, proposal, flight draft; architect design review of the draft follows, then the pause.
