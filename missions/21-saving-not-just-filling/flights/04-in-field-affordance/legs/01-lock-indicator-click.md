# Leg: lock-indicator-click

**Status**: completed
**Flight**: [The In-Field Affordance](../flight.md)

## Objective

Give the toolbar vault lock indicator a left-click action (squawk 0099, flight DD10):
locked → raise the existing `vault-unlock` sheet; unlocked → open `goldfinch://vault`.

## Context

- Flight DD10 (operator ruling): locked → `vault-unlock`; unlocked → `openVaultPage()`;
  right-click keeps "Lock now"; keyboard activation follows the click.
- **Scope change at leg design (operator ruling 2026-09-21):** this leg was planned as
  `sheet-and-lock-indicator` (0100 + 0099). Two live diagnosis passes could not reproduce
  squawk 0100 via automation, because the kebab and page-context menuTypes are on the
  standing unobservable-surfaces list: `captureWindow`/`readDom` redact them by design, so
  a blank capture proves nothing. With instrumentation, the sheet bounds/viewport chain
  was healthy in every variant tried. The operator moved 0100 to the HAT (a human
  reproduction with a real mouse); see the flight log. This leg carries 0099 only.
- The indicator is a native `<button id="vault-indicator">` (`src/renderer/index.html`),
  so Enter/Space fire `click` natively — no keydown handler is needed.
- The locked branch must NOT spring the fill picker on a successful unlock. Use the
  `onVaultRequestUnlock` shape (`openOverlayMenu('vault-unlock', [], null, 0)` with no
  `pendingVaultFlow` set), NOT the `onVaultGesture` locked branch (which sets
  `pendingVaultFlow = { phase: 'unlocking' }`).

## Inputs

- `src/renderer/chrome/vault-controller.js:createVaultController`: the indicator's only
  listener is `contextmenu` (the `if (els.vaultIndicator)` block after `lockNow`);
  `openVaultPage` and `openOverlayMenu` are already injected deps; `lockState` holds the
  pushed `{ setUp, unlocked }`.
- `test/unit/vault-controller-capture.test.js`: the `fakeVaultIndicatorEl` + `harness({ vaultIndicatorEl })`
  pattern used by the existing contextmenu test.

## Outputs

- A `click` listener on `els.vaultIndicator` in `vault-controller.js`, beside the
  `contextmenu` listener.
- Unit tests covering both states and the no-setup guard.
- Squawk 0099 left `open` (it completes with the flight commit); flight log entry.

## Acceptance Criteria

- [x] Left-click with `lockState.unlocked === false` (and `setUp === true`) calls
      `openOverlayMenu('vault-unlock', [], null, 0)` exactly once and does NOT set
      `pendingVaultFlow` (a subsequent unlock broadcast opens no picker).
- [x] Left-click with `lockState.unlocked === true` calls `openVaultPage()` exactly once
      and opens no sheet.
- [x] Left-click when not set up (`setUp === false`) does nothing. (The indicator is
      hidden then; the guard is defense in depth.)
- [x] Right-click behaviour is unchanged (the existing contextmenu test still passes).
- [x] The existing `els: { vaultIndicator: null }` harness still constructs without
      throwing.
- [x] `index.html`'s indicator comment no longer claims the click action is unwired.
- [x] `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check` are green;
      `RENDERER_LINE_BUDGET` is untouched (no `renderer.js` change).

## Verification Steps

- `node --test test/unit/vault-controller-capture.test.js` → new cases pass: locked click →
  one `vault-unlock` open, then `onVaultLockState({setUp:true, unlocked:true})` → no
  `vault-picker` open; unlocked click → one `openVaultPage` call, zero opens; not-set-up
  click → zero opens, zero page calls.
- `npm test && npm run lint && npm run typecheck && npm run format:check`.
- `git diff --stat` shows no change to `src/renderer/renderer.js`.
- Live behaviour (a real click in both states) is verified at the HAT: sheets are
  unobservable to automation (DD12).

## Implementation Guidance

1. In `vault-controller.js`, inside the existing `if (els.vaultIndicator)` block, add:
   ```js
   els.vaultIndicator.addEventListener('click', () => {
     if (!lockState.setUp) return;
     if (lockState.unlocked) openVaultPage();
     else openOverlayMenu('vault-unlock', [], null, 0);
   });
   ```
   Add a short comment in the file's style citing squawk 0099 / DD10, and why it
   deliberately leaves `pendingVaultFlow` unset (the `onVaultRequestUnlock` shape).
2. The harness must record `openVaultPage` calls. Extend `harness()` in
   `vault-controller-capture.test.js` if it does not already capture them. Also extend
   `fakeVaultIndicatorEl` so it can fire `click` (it already fires `contextmenu`).
3. Update the `index.html` comment above `#vault-indicator`: "The live open trigger +
   click action are the pick-and-fill leg; this leg wires only the indicator." → state
   the click semantics (M21 F4 L1, squawk 0099).
4. Update the CLAUDE.md "Chrome indicators" Vault bullet or the Password vault
   pattern with a one-line note on the click semantics.

## Edge Cases

- **Click while `vault-unlock` is already open** (for example, raised by a guest gesture
  with `pendingVaultFlow` set): the open model-replaces the same menuType, so the sheet
  stays open. This is acceptable. Do not clear `pendingVaultFlow` from the click handler.
- **Stale `lockState`:** it is a pure projection of the latest push (DD10 freshness). If
  the vault locks between the push and the click, the unlocked branch opens the vault
  page, which shows its own locked state. Harmless.

## Files Affected

- `src/renderer/chrome/vault-controller.js`: the click listener
- `test/unit/vault-controller-capture.test.js`: tests (+ harness/fake extension)
- `src/renderer/index.html`: the comment only
- `CLAUDE.md`: a one-line doc note

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (completed at flight-end review/commit)
- [ ] Check off this leg in flight.md (at flight-end commit)

## Citation Audit

Checked 2026-09-21 against `flight/04-in-field-affordance` (identical to `main` d0aa933):
`vault-controller.js` contextmenu block (lines ~261-265), `onVaultGesture` (~267),
`onVaultRequestUnlock` (~291-297), `overlayStates['vault-unlock']` (~463); `index.html`
`#vault-indicator` (~245-258); test harness `vaultIndicatorEl` (lines 18-83, 262-274).
All present. Symbols are the durable anchors; line numbers are approximate.
