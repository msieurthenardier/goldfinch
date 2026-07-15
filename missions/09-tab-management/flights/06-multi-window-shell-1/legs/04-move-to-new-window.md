# Leg: move-to-new-window

**Status**: completed
**Flight**: [Multi-Window Shell, Part 1](../flight.md)

## Objective

Land flight DD5 (the New Window command + `tab:move-new-window` with LIVE
re-parenting — spike verdict GO — via the explicit adopt protocol) and DD7
(roaming overlay singletons with attachment tracking), making a second
window fully usable end-to-end.

## Context

Flight DD5/DD7 are authoritative (two-pass review; M1/M2/M4/L4/L-e
resolutions embedded verbatim) — read them fully, plus: the leg-1 spike
verdicts (re-parent GO with mid-motion bar passed; overlay roaming GO;
`getFocusedWindow` stale — seeding via `noteFocus` at create/programmatic
focus, already in the registry from leg 2); the leg-2 entry (three-class
routing live; `getChromeForTab` is what makes the adopt re-bind automatic;
chrome webContents deliberately NOT destroyed at `close` — leg-2 deviation
2, this leg inherits that fact); the leg-3 entry (stack push-cache live —
a NEW window's chrome boot-seeds via the invoke and then receives pushes).

## Acceptance Criteria

- [x] **New Window command**: kebab menu item + `Ctrl+N`/`Cmd+N` through
      the one-classifier path — BOTH classifier copies in lockstep
      (`src/shared/keydown-action.js` + `src/renderer/sheet-accelerator.js`,
      the hand-mirror pin) + `guest-forward-allowlist.js` gains the action
      (both kinds as applicable); dispatchChromeAction case invokes a new
      `window-create` IPC. A Ctrl+N window boots its home tab normally.
- [x] **`window-boot-config` invoke** (DD5/L4): joins the renderer's
      boot-gating `Promise.all`; returns `{bootTab: boolean}` (default
      true; false for move-created windows). Preload + d.ts per the
      declare rule.
- [x] **Model row**: `tab:move-new-window` in `tab-context-model.js` —
      omitted at `isLastTab` AND for internal tabs (M4 ruling); unit
      tests extended (composition + both omissions + separator sections
      unchanged elsewhere).
- [x] **Move op** (DD5 steps 1–4, renderer-initiated, main-executed),
      with the three review-H pins:
      **(H2) invoke carries the source renderer's strip snapshot** —
      `tab-move-to-new-window({wcId, url, title, favicon, container})`
      (chrome→chrome trust domain; main shape-validates and relays into
      `adopt-tab`, adding main-authoritative fields at SEND time via
      wc.getTitle()/getURL() — a burner's synthesized container and the
      favicon exist ONLY renderer-side; main cannot rebuild either from
      wcId).
      **(H1) adopt has a readiness barrier** — main queues `adopt-tab` +
      the follow-up `tab-nav-state` push on the registry record and
      delivers them only after the target chrome's `window-boot-config`
      invoke has been served (the invoke arriving proves module
      evaluation completed; a send to a pre-boot document is silently
      dropped, no retry exists). The new `onAdoptTab`/`onTabMovedAway`
      registrations sit at renderer module top level ABOVE the boot gate.
      **(H3) geometry**: create the target window with the SOURCE
      window's content size, and re-apply the source guest's current
      bounds via main-side `setBounds` at attach (spike answer (b) —
      bounds are window-local content DIPs, identical chrome layout makes
      the seed exact). Accepted interim visual, documented: the live
      guest renders over the target's still-booting chrome until adopt
      completes.
      Handler body: registry window with `noBootTab` (flag on the
      registry record, create-chain extension + unit test); re-parent
      (removeChildView → addChildView); move the tabViews entry between
      records; update `activeTabWcId` both sides; **(M2) if the moved
      wcId is the live find-session's tab, close the find session
      first** (`refocusGuest:false` — the tab-close precedent); seed
      last-focused via programmatic `win.focus()` + `noteFocus`; send
      SOURCE chrome `tab-moved-away(wcId)` immediately; queue the target
      pair per H1.
- [x] **Renderer branches** (review M3's factoring is the implementation
      shape): extract createTab's **strip-record construction** as a
      named helper — tab object + tabs.set + button DOM + the five
      listeners (click/auxclick/contextmenu/pointerdown set) + append +
      title update points — used by BOTH createTab and `adopt-tab`;
      adopt assigns `tab.wcId = payload.wcId` directly (no tabCreate
      invoke, no provisioning .then) then `activateTab(id)`.
      `tab-moved-away` mirrors closeTab FIELD BY FIELD minus stack/IPC:
      `cancelDrag()`, button remove, tabs.delete, **the `activeViewWcId`
      clear** (omission = concrete cross-window bug: A's stale
      activeViewWcId would tabHide the moved guest IN WINDOW B on A's
      next activation), next-activation fallback — no stripIndex
      snapshot, no tabClose IPC, no capture.
- [x] **Re-bind verification per channel** (DD5 step 4 + review L2 — the
      FULL class-3 fan, not a subset): tab-title, tab-nav-state,
      tab-favicon, tab-loading, tab-did-navigate, tab-did-navigate-in-page,
      tab-did-finish-load, tab-dom-ready, zoom-changed,
      devtools-state-changed, tab-media-list, tab-privacy-fp, find-overlay
      syncs — after a live move, exercise and verify each lands in the
      TARGET window's chrome only (raw-wcId evaluate on both chromes);
      pre-adopt tolerance = the same fan null-guards unknown wcIds
      (verified in review: findTabByWcId/active-compare guards exist —
      pin with the live sweep).
- [x] **DD7 roaming overlays with attachment tracking — the FULL
      attachment-scope census (review M1), not just four items**:
      - Manager records attachment (contentView + window) at show
        (`openMenu` receives it, resolved from the open-sender's record);
        `hide()`/`teardown()` remove from the RECORDED attachment (the
        hide-time `getContentView()` re-resolve is the named defect);
        re-raise `show()` (tab-set-active path) uses the recorded
        attachment, never re-resolves.
      - Channel-7 `sendToChrome`, `focusChrome`, and the
        `menu-overlay:activated` forward all deliver to the ATTACHMENT
        window's chrome (wrong-window delivery = stuck aria-expanded).
      - Sheet accelerator (`before-input-event`): chrome-scope sends,
        guest-scope active-tab resolution, and the find/downloads sends
        all resolve the ATTACHMENT window.
      - `tab-set-active`'s `syncBounds` + `closeMenuOverlay('tab-switch')`
        + re-raise, `tab-set-bounds`' live syncBounds + find-overlay
        follow, `tab-hide`/`tab-close`'s unconditional
        hideFindOverlay/closeMenuOverlay, and `win.on('close')`'s
        `closeMenuOverlay('teardown')` — ALL conditioned on
        owner-window === attachment-window (find: `wcId ===
        findOverlayTabWcId`), else window B's activity visibly disturbs
        window A's open overlay.
      - Show-time bounds: fetch the owner record's active guest
        `entry.view.getBounds()` — no new state slot; find overlay same.
      Menus + find work in BOTH windows (live-verified).
- [x] **Focus rules**: the move-created window is focused, moved tab
      active (Chrome parity); source window's strip closes ranks with a
      sane active tab.
- [x] **Chrome-webContents leak revisit (review M4 — the leg-2 deferral
      lands here)**: closed windows' chrome webContents get a deferred
      destroy at `closed` (`setImmediate` — outside the sender's own IPC
      dispatch, the leg-2 crash-risk rationale) + a live check (open →
      close a window, verify the chrome wc count returns to baseline);
      update the leg-2 flight-log decision note.
- [x] **Sheet accelerator auto-repeat (review L1)**: the sheet's
      `new-window` row carries `autoRepeatGuard: true` (windows are
      heavier than tabs); a unit test pins that the guest-forward path's
      blanket `!isAutoRepeat` covers `new-window` (the non-`tab-`-prefix
      class, reopen-closed-tab precedent).
- [x] **Documented divergence (review L4)**: closing the adopted sole tab
      in a move-created window leaves the window alive with a fresh home
      tab (closeTab's existing else-createTab branch; Chrome would close
      the window) — accepted this flight, recorded in the flight log +
      carried to the HAT list. The live "blur/menu interplay across
      windows" observable may be undrivable under WSLg (spike: focus
      APIs inert) — HAT fallback pre-authorized for that single check.
- [x] Unit tests: model row; any pure extraction (e.g. adopt payload
      builder) — plus the manager attachment logic if extractable.
- [x] `npm test`, lint, typecheck green. Live MCP two-window check:
      Ctrl+N window (boot tab, working kebab menu + find); move a
      MID-STRIP tab (source closes ranks, target has exactly the moved
      tab, no boot tab); moved tab keeps live state (navigate history
      intact via goBack on the SAME wcId); per-channel re-bind sweep;
      burner tab move (full container payload); single-tab omission
      (menu lacks move row); blur/menu interplay across windows.
      Targeted-kill teardown; key env-only.
- [x] Flight log leg entry (+ doc-enumeration-invalidation answer);
      leg → landed. Do NOT commit.

## Files Affected

- `src/shared/tab-context-model.js` + test, `keydown-action.js` + test,
  `sheet-accelerator.js` (lockstep), `guest-forward-allowlist.js` + test
- `src/renderer/renderer.js` (dispatch, adopt/moved-away branches,
  boot-config gating), `src/renderer/menu-overlay.js` (if MENU_LABELS
  or channel handling needs touching — expected NO)
- `src/main/main.js` (window-create, tab-move-to-new-window,
  window-boot-config, adopt-side nav-state push), `src/main/
  menu-overlay-manager.js` (attachment tracking), find-overlay functions
  (per-window bounds at show)
- `src/main/window-registry.js` (+ test) if the record needs a helper
- `src/preload/chrome-preload.js` + `renderer-globals.d.ts`
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
