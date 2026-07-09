# Leg: cross-view-keyboard-bridge

**Status**: completed
**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](../flight.md)

## Objective
Close the three chrome↔guest keyboard/focus gaps (Ctrl+L from a focused guest, Tab guest→chrome handoff,
chrome Tab-order wrap) so keyboard focus can cross the multi-`WebContentsView` boundary — resolving the mission
Known Issue and unblocking corpus runs that cross that boundary.

## Context
- **Mission Known Issue (F8 HAT).** On the native view surface, OS keyboard focus lives in one
  `WebContentsView` at a time. Today the guest `before-input-event` capture (`src/main/main.js:998`, inside the
  `!__goldfinchInternal` guard at `:997`) captures F12 / Ctrl+±0 / Ctrl+P / Ctrl+F / Ctrl+J / Ctrl+Shift+I but
  **not Ctrl+L or Tab** — so Ctrl+L is dead when a guest has focus, Tab can't leave the guest, and chrome
  Tab-order doesn't cycle.
- **DD3 (flight).** Fix scoped to the **named gaps only** (Ctrl+L + Tab handoff + chrome wrap) — NOT the full
  chrome accelerator union (capturing Ctrl+R would seize the guest's native reload — out of scope).
- **The DD13 forwarding template** (`src/main/main.js:385–413`, sheet `before-input-event`): chrome-class
  actions ride `getChromeContents()?.send('chrome-shortcut-action', { action })` → the renderer's
  `dispatchChromeAction` (`renderer.js:2318`; `focus-address` at `:2351` does `els.address.focus()/select()`).
  **Reuse this channel for Ctrl+L.**
- **OS-focus is load-bearing (DD3).** `dispatchChromeAction('focus-address')` only DOM-focuses the address input;
  for it to actually accept typing, the **chrome view must hold OS keyboard focus**, which currently sits in the
  guest. The guest Ctrl+L branch must call **`getChromeContents()?.focus()`** (focus-then-send, F4 rule) BEFORE
  the send. A working precedent already exists in-repo: `focusChrome: () => getChromeContents()?.focus()`
  (`src/main/main.js:483`) — reuse that primitive. The sheet's chrome branch (`main.js:402`) does NOT `.focus()`
  (it relies on menu-close dynamics) — so it is *not* a copyable template for this; the `.focus()` is essential.
- **Tab handoff is guest-specific.** The shared `sheetAcceleratorAction` mapper deliberately returns `null` for
  Tab (`src/shared/sheet-accelerator.js:47`, APG contract) — **do NOT edit that module for Tab.** Add a
  dedicated guest→chrome Tab branch in the guest handler.
- **Internal tabs get NO `before-input-event` today (design-review finding).** The entire guest handler is
  registered *inside* the `!__goldfinchInternal` guard (`main.js:997`), so internal guest contents receive no
  `before-input-event` at all. The flight Open Question's "renderer-keydown fallback" idea is **wrong** — that
  path fires only when *chrome* holds focus; when an internal tab holds OS focus the chrome renderer never sees
  the key (there is no `globalShortcut`/app-menu accelerator anywhere in `src/main/` — verified). So the ONLY
  viable capture for internal-tab Ctrl+L/Tab is a **main-side `before-input-event` on the internal guest's
  webContents**. **Decision (DD, this leg): the contained approach** — leave the existing web-guest capture block
  untouched (no regression surface added over F12/zoom/print/find/devtools) and register a **separate, minimal
  `before-input-event` on internal guest contents handling ONLY the two cross-view keys (Ctrl+L, Tab)**. The
  Ctrl+L/Tab handling is identical for web and internal (both just hand off to chrome), so factor it into one
  small helper invoked from both the web-guest handler and the new internal-guest handler.

## Inputs
- Leg 1 complete (litmus green; apparatus recipe recorded — launch on `GOLDFINCH_MCP_PORT=8899`).
- `src/main/main.js` guest `before-input-event` handler (~`:998`); `getChromeContents()` accessor; the
  `chrome-shortcut-action` IPC channel + renderer `dispatchChromeAction` (`renderer.js:2318`).
- `npm test` / `typecheck` / `lint` green at leg start (947/947 baseline).

## Outputs
- Guest handler forwards **Ctrl+L** → OS-focus the chrome view + `chrome-shortcut-action:focus-address` (works on
  web AND internal tabs — Ctrl+L is a chrome-level accelerator, not a guest feature; see the internal-tab Open
  Question in the flight — default intent: it works on both).
- Guest handler hands **Tab** off to the chrome view (guest releases focus; a deterministic chrome control
  receives it; OS focus moves to chrome).
- Chrome renderer **Tab-order cycles/wraps** without stranding focus on `<body>`.
- Unit coverage for any pure mapping added (extend the mapper tests if a shared mapper is touched; a new guest
  Ctrl+L/Tab decision, if extracted to a pure helper, is unit-tested like `sheet-accelerator`).
- Stale-comment housekeeping deferred to the a11y-and-housekeeping leg (NOT here) — keep this leg focused.

## Acceptance Criteria
- [ ] With a web guest focused, **Ctrl+L** focuses the address bar AND it is **typeable** (typing lands in the
  address field, not the page) — proving the OS-focus handoff, not just DOM focus.
- [ ] With a guest focused, forward **Tab** moves focus out of the guest to the **address bar** (the pinned,
  deterministic first chrome control): guest's `document.activeElement` is no longer the page; `els.address` is
  focused; OS focus is in chrome.
- [ ] In the chrome, repeated **Tab** cycles through focusable controls and **wraps** — never stranded on `<body>`.
  *(Confirm the wrap gap actually reproduces under `WebContentsView` — behavior spec Step 6 — BEFORE adding a
  handler; if Chromium already wraps within the chrome document, no new handler is needed. Do not add redundant code.)*
- [ ] **Ctrl+L on an internal `goldfinch://` tab** also focuses the address bar (default intent — via the new
  minimal internal-guest `before-input-event`, per the Context DD).
- [ ] Guest accelerators unchanged (F12/zoom/print/find/downloads/devtools still behave as before — no regression);
  the web-guest capture block is NOT restructured (contained approach).
- [ ] **Shift+Tab from the guest**: out of required scope for this leg (forward Tab is the gated path). If handled,
  target the LAST focusable chrome control; otherwise leave it to Chromium default — do not half-implement.
- [ ] `npm test` green (+ new unit tests for any extracted pure helper); `npm run typecheck` + `npm run lint` clean.
- [ ] `/behavior-test chrome-guest-keyboard-nav` **PASS** on the fixed build (run by the Flight Director after implementation — the leg's Witnessed acceptance net).

## Verification Steps
- Unit: `npm test` (new tests for the pure decision helper if extracted; assert Ctrl+L→focus-address, Tab→handoff,
  internal-tab behavior, and that existing guest accelerators are untouched).
- Static: `npm run typecheck`, `npm run lint`.
- Behavior (Flight-Director-run, not the Developer): relaunch admin-wired on `8899`, then
  `/behavior-test chrome-guest-keyboard-nav` — the Witnessed net for all three gaps + typeability + internal-tab.

## Implementation Guidance
1. **Cross-view nav helper (shared by web + internal guest).** Factor the two cross-view keys into one small
   handler, e.g. `handleGuestCrossViewNav(event, input)`:
   - **Ctrl+L** (`l`/`L` with `control||meta`): `event.preventDefault()`, `getChromeContents()?.focus()` (OS focus,
     reuse the `focusChrome` primitive at `main.js:483`), then `getChromeContents()?.send('chrome-shortcut-action',
     { action: 'focus-address' })`.
   - **Tab** (unmodified `Tab` keyDown; NOT Shift+Tab for the gated path): `event.preventDefault()`,
     `getChromeContents()?.focus()`, then signal the renderer to focus the **address bar** (the pinned deterministic
     target) — either reuse `chrome-shortcut-action:focus-address` or a dedicated focus-first-chrome signal.
   Return whether it handled the key so callers can early-return.
2. **Wire it into BOTH guest handlers.**
   - Web-guest: call `handleGuestCrossViewNav` at the top of the existing `before-input-event` (`main.js:998`),
     before the existing branches — leave those branches otherwise UNTOUCHED (contained approach; no regression
     surface added).
   - Internal-guest: register a NEW minimal `before-input-event` on internal guest contents (the branch the
     `!__goldfinchInternal` guard currently skips) that calls ONLY `handleGuestCrossViewNav` — nothing else, so
     internal tabs gain Ctrl+L/Tab and nothing more. Find the guest-contents wiring site and add the internal path.
3. **Chrome Tab-wrap** (`renderer.js`): **first confirm the gap reproduces** (behavior spec Step 6). If it does,
   add a top-level chrome-document Tab handler that wraps focus (last→first, first→last on Shift+Tab) instead of
   stranding on `<body>`. **No top-level handler exists today** — model the wrap math on the lightbox focus trap
   (`renderer.js:1402`, `els.lightbox`) or `focusItem` (`src/renderer/menu-controller.js:127`), but scope it to the
   whole chrome document, not a transient overlay. If Chromium already wraps within the chrome document, skip this.
4. **Purity/tests (optional).** A two-key (Ctrl+L/Tab) decision is small enough to keep as inline branches — the
   pure-helper extraction is OPTIONAL. If you DO extract a pure decision, mirror `sheet-accelerator.js`'s
   dual-export and unit-test it. At minimum, add/adjust unit tests asserting the existing guest accelerators are
   untouched and (if extracted) the new decision.
5. **Honor the focus-then-send rule** everywhere a keyboard-input-expecting IPC is routed to chrome.

## Edge Cases
- **Held Tab / Ctrl+L (isAutoRepeat)**: match the guard discipline of the surrounding guest branches (guard where
  a repeat would misbehave — e.g. don't repeatedly re-hand-off on a held Tab).
- **No chrome contents / no active tab**: `getChromeContents()?.` optional-chains to a no-op — never throw.
- **Internal tab Ctrl+L**: see AC + Open Question; whichever way, spec and code must agree.
- **Focus ring visibility**: after handoff, the focused chrome control should show a visible focus ring (a11y).

## Files Affected
- `src/main/main.js` — guest `before-input-event`: add Ctrl+L forward (+ OS focus) and Tab handoff.
- `src/renderer/renderer.js` — chrome Tab-order wrap; possibly a `chrome-shortcut-action`/focus entry point for the Tab handoff target.
- `src/shared/*.js` — a NEW pure helper if a non-trivial guest key decision is extracted (with dual-export), + its unit test under `test/unit/`.
- (NOT here: stale `will-attach-webview` comments — deferred to the housekeeping leg.)

---

## Post-Completion Checklist
- [ ] All acceptance criteria verified (unit + static; the Witnessed run is Flight-Director-driven post-impl)
- [ ] `npm test` / `typecheck` / `lint` green
- [ ] Update flight-log.md with a Leg 2 progress entry (what changed, any decisions/deviations)
- [ ] Set this leg's status to `landed` (NOT committed — batch-commit at flight end)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit and do NOT signal `[HANDOFF:review-needed]` (deferred to the end-of-flight review)
