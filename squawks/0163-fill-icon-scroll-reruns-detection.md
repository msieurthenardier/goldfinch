# Squawk 0163: Fill icon re-runs full vault field detection on every scroll event

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-24
**Completed**: 2026-10-24

## Report
While a vault anchor field (login, card or identity) is focused, every `scroll` event in the page re-runs the full login, card and identity detection just to move the fill icon. The capture listener fires for any scroller, with no throttling. Scrolling does not change which fields are anchors; it only moves them. Each pass costs about as much as a focus change: around 2 ms at 54 fields, 9 ms at 1,000 and 19 ms at 4,000 (measured on the focus path, after squawk 0162). On large form pages that is per-frame scroll jank. `resize` takes the same path. Found in a follow-up sweep after squawk 0162 (#270).

## Evidence
- `src/preload/webview-preload.js`: `window.addEventListener('scroll', () => vaultIcons.placeVaultIcons(), true)` and the matching `resize` listener. Both carry the comment "Keep the shown icon glued to its field across layout shifts".
- `src/preload/vault-fill-icon.js:placeVaultIcons` → `anchorKinds()`, which runs `findAllLoginFields` + `cardEntries` + `identityEntries` over the whole document on each call while `focusedField` is set.
- Throttling with `requestAnimationFrame` would not help: Chromium already delivers scroll events at most about once per frame per scroller. The cost is the detection inside each event, not how often events arrive.

## Corrective Action
Added `repositionVaultIcons()` to the controller in `src/preload/vault-fill-icon.js` and pointed the `scroll` (capture) and `resize` listeners in `webview-preload.js` at it. It bails when disabled, then repositions the icon already shown for `focusedField` (re-checking `isFieldVisible`) or prunes it when the field is no longer visible. It never calls `anchorKinds()` or any detector and never creates an icon. Positioning and pruning are shared with `placeVaultIcons` through the new `positionIconForField` and `pruneIcons` helpers. If there is no live shown icon for the focused field (page removed it, or it was never shown), it falls back to `placeVaultIcons()`, which preserves the old self-healing behavior exactly. Focus, mutation and DOM-load paths are unchanged.

## Verification
Four new unit tests in `test/unit/vault-fill-icon.test.js` (spying on the injected login/card/identity detectors): reposition moves an already-shown icon with zero detector calls; reposition prunes it when the field goes non-visible with zero detector calls; reposition is a no-op while disabled; a page-removed icon falls back to `placeVaultIcons` and is re-created. `npm test` (6051 pass, 0 fail), `npm run lint`, `npm run typecheck`, `npm run format:check` pass; `npm run build:preload` regenerated the bundles. Live (`dev:automation`, focused password field plus N form-less text fields; ms per dispatched `scroll` event):
- before the fix: 0.6 at 54 fields, 4.4 at 1,000, 17.8 at 4,000;
- after the fix: 0.005–0.015 at every size.

A real CDP `scroll` (dy 250) moved the field from y=598 to y=348, and the icon's offset from the field stayed at (3, 151), with the same icon node. Hiding the field and then scrolling pruned the icon; showing it again and scrolling re-created it at the same offset.

## Sign-Off
**Reviewer**: independent Reviewer agent (leg-execution crew, Sonnet)
**Verdict**: confirmed
**Commit**: the `squawk/0163` commit on `squawk/0162-form-less-text-inputs-superlinear-keystroke-cost` (folded into the 0162 PR)
