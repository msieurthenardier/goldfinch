# Leg: keyboard-and-announce

**Status**: completed
**Flight**: [Non-blocking Save Prompt](../flight.md)

## Objective
Make the corner prompt keyboard-reachable without ever stealing focus on appearance, and have it announced politely:
- F6 from the page moves focus into the prompt.
- Inside the prompt, F6 moves to the address bar and Shift+F6 returns to the page.
- Esc means "Not now". Tab and Enter work natively.
- A `saved` or `dismissed` close returns focus to the page when the prompt held it.
- A chrome-side polite live region, plus the prompt's own status node, announces each new prompt.

## Context
- Flight **DD2** and **DD3**, binding. DD4's focus pause input already exists (Leg 1: page `focusin`/`focusout`).
- **Keys are read main-side from trusted input, not a page channel.** The prompt view's keys are read in its `before-input-event`, following the sheet's precedent (`src/main/window-factory.js` `createSheetView` ~128-160, `sheetAcceleratorAction`). DD2's page→main `save-prompt:key` channel is NOT built. Trusted input cannot be spoofed by the page, and the flight's "Acceptable variations" allow channel changes. Recorded as a Decision.
- Leg 1 pinned "no element `.focus(` in `save-prompt.js`" (`test/unit/save-prompt-page.test.js`; header comment `src/renderer/save-prompt.js` ~9-10). This leg narrows that pin: exactly ONE `.focus(` site is allowed, inside the main-pushed `save-prompt:focus-first` handler, and the pin asserts that.
- P3 is **unverified** (no screen reader; flight Prerequisites). Both announcement paths ship, and the announcement AC is unit and DOM level only. Spoken output is a recorded gap carried to the debrief.
- Operator ruling: all live checks go to the HAT.

## Inputs
- `src/main/guest-wiring.js` `handleCrossView` (~142-162): it calls `crossViewNavAction`, then `chrome?.focus()`, then `chrome?.send('chrome-shortcut-action', { action })`. It is used for both web guests and internal guests (~293).
- `src/shared/cross-view-nav.js` `crossViewNavAction`. Ctrl/Cmd+L → `focus-address`; F6 → `focus-address`; Shift+F6 → `focus-chrome-end`.
- `src/renderer/chrome/shortcut-controller.js`: `focus-content` (~213, including the load-failure `focusLoadFailureHeading` branch ~221) and `focus-chrome-end` (~239).
- `src/main/register-tab-ipc.js` `tab-focus-guest` (~1209-1221): refuses a taken-over guest.
- `src/main/window-factory.js` `createSavePromptView` (~113-125); `createSheetView` `before-input-event` precedent (~138).
- `src/main/save-prompt-manager.js` (Leg 1 + 2): `close(reason)`, the focus pause input, `currentWcId`.
- `src/shared/save-prompt-close-effects.js`: `refocusGuest` is `false` for every reason today.
- `src/renderer/save-prompt.js` / `save-prompt.css`; `src/shared/vault-capture-template.js` (dialog root, `KIND_TABLE` nouns).
- `src/renderer/index.html` live regions: `#toasts` (~439, polite, `aria-atomic="false"`), `#media-status` (~441), `#tab-status` (~445), `#suggest-status` (~449), plus `#zoom-percent` (`aria-live="off"`, ~143) and `#hang-notice` (~358).
- `src/renderer/chrome/save-prompt-client.js`: the successful-present path.

## Outputs
- `guest-wiring.js`: `handleCrossView` resolves the prompt in-module through its existing `registry` dep (Ruling R1). No new dep and no `main.js` edit.
- `window-factory.js`: the prompt view's `before-input-event` handler, plus a pure decision helper `src/main/save-prompt-keys.js` (`savePromptKeyAction(input)` → `'to-address' | 'to-guest' | 'dismiss' | null`).
- `save-prompt-manager.js`: `focusPrompt()` (`webContents.focus()` plus the `save-prompt:focus-first` push), focus tracking for the refocus rule, and the refocus on `saved`/`dismissed`.
- `save-prompt-close-effects.js`: `refocusGuest: true` for `saved` and `dismissed` ONLY; the manager additionally gates it on "the prompt held focus".
- `save-prompt.js`, preload and `.d.ts`: the `focus-first` handler and the in-prompt `role="status"` node.
- `index.html`: `#save-prompt-status`, plus its write in `save-prompt-client.js`.
- Tests: new `save-prompt-keys.test.js`; extended `guest-wiring.test.js`, `save-prompt-manager.test.js` (or `save-prompt-consent.test.js` precedent), `save-prompt-close-effects.test.js`, `save-prompt-page.test.js`, `save-prompt-client.test.js`, `window-factory.test.js`; a live-region pin test.
- Docs: `docs/vault.md` (keyboard), `docs/renderer-menu.md` or the keyboard doc that describes the F6 cycle (find it by grep `F6` in `docs/`), `CLAUDE.md` (one clause where the F6 cycle or the save-prompt view is described).

## Acceptance Criteria

**Guest → prompt (DD2)**
- [ ] AC1 `handleCrossView` routes **unmodified F6** (`key === 'F6'`, no shift/ctrl/meta/alt) from a guest whose `contents.id` is the wcId the window's prompt currently shows to the prompt, when `savePromptFor(contents.id)` reports the prompt visible. It does this INSTEAD of the chrome: `preventDefault`, the auto-repeat guard as today, then `manager.focusPrompt()`. It neither focuses nor sends to the chrome.

  Every other case is byte-for-byte today's behavior, each pinned by a `guest-wiring.test.js` case asserting the exact `chrome-shortcut-action` payload:
  - guest Shift+F6 → `focus-chrome-end`;
  - Ctrl/Cmd+L → `focus-address`, even with a prompt visible;
  - F6 with no prompt;
  - F6 with a prompt shown for a DIFFERENT tab;
  - an internal guest.

  An absent `savePromptFor` dep (legacy or offline harness) behaves exactly as today.
- [ ] AC2 `focusPrompt()` is a no-op unless the prompt is visible and in an interactive state (an offer, not a result or a `saving`/`consenting` state). It calls `view.webContents.focus()`, then pushes `save-prompt:focus-first { token }`. The page focuses its PRIMARY button (Save / Update / Unlock & save / Unlock & review); this is the ONE allowed `.focus(` site, and the page pin is narrowed to exactly that. A stale token is ignored.

  `present()` still NEVER focuses: the Leg 1 throwing-focus fake test stays green, with `focusPrompt` exercised separately.

**Inside the prompt (DD2)**
- [ ] AC3 `savePromptKeyAction(input)` is pure, with a table test:
  - keyDown F6 with no modifiers → `'to-address'`;
  - Shift+F6 → `'to-guest'`;
  - Escape with no modifiers → `'dismiss'`;
  - everything else → `null`, including Tab, Shift+Tab, Enter, Space, keyUp and Ctrl/Alt/Meta-modified F6/Escape.

  The prompt view's `before-input-event` (`window-factory.js`) calls it. On a non-null action it calls `preventDefault`; the auto-repeat guard applies to F6 and Shift+F6. Then:
  - `to-address` → focus the chrome webContents, THEN send `chrome-shortcut-action { action: 'focus-address' }` (the focus-then-send rule);
  - `to-guest` → focus the active guest via the same predicate as `tab-focus-guest`, refusing a taken-over or destroyed guest. Extract or share the predicate; do not duplicate it;
  - `dismiss` → `manager.close('dismissed')`, which drops the capture (Leg 1).

  Keys are acted on only while the prompt is visible. A `window-factory.test.js` case drives the real handler with a fake `input` for each action.
- [ ] AC4 Esc behaves the same whether the prompt was reached by F6 or clicked into. Tab, Shift+Tab and Enter stay native in the page: Tab cycles ✕ / Not now / primary (and the vault choice when shown), and Enter activates the focused button. Pinned by `save-prompt-page.test.js` (no keydown handler intercepts Tab or Enter).

**Refocus rule (DD2, design review 2 N3)**
- [ ] AC5 `savePromptCloseEffects('saved' | 'dismissed').refocusGuest === true`; every other reason is `false`, and the existing close-effects drift test is updated. The manager tracks "held focus" from the prompt webContents' `focus`/`blur` events (main-side, trusted). Leg 1's page-reported `focusin`/`focusout` stays the timer's pause input.

  On close, if `refocusGuest && heldFocus`, the manager focuses the window's active guest through the shared `tab-focus-guest` predicate, never the chrome. Tests cover:
  - `saved` + held focus → guest focused;
  - `dismissed` via Esc + held focus → guest focused;
  - `dismissed` via a click on Not now WITHOUT prior focus → no focus call;
  - `unlock-requested` + held focus → NO guest focus (the unlock sheet opens next);
  - `timeout`, `expired`, `tab-switch` and `vault-lock` → no focus call;
  - a taken-over guest → refused, no throw.
- [ ] AC6 After a result state (for example "Password saved to …"), the refocus happens at the final close, not at the click. The guest is not focused while the result is still showing over it.

**Announcement (DD3)**
- [ ] AC7 `index.html` gains `<div id="save-prompt-status" class="sr-only" role="status" aria-live="polite"></div>` as a SIBLING after `#suggest-status`, never wrapping anything.

  On every successful offer presentation, including convert in place and re-ask, `save-prompt-client.js` writes one announcement: "Save {noun} for {host}? Press F6 to respond." It uses `KIND_TABLE` nouns, "Update {noun} …" for update, and "Add to your identity …" for identity. Result-only presentations write nothing. To re-announce identical text it clears the node, then sets it in the next frame. Text is set via `textContent` only, and contains the origin host only: no username, no vault label.
- [ ] AC8 The prompt page's dialog root keeps `role="dialog"` with `aria-labelledby`/`aria-describedby` and NO `aria-modal` (Leg 1 pin). It also renders the same announcement in its own `role="status"` node at mount.
- [ ] AC9 **Shared mechanism unchanged** (CLAUDE.md rule; M22 F1 lesson). A test parses `index.html` and asserts that `#toasts`, `#media-status`, `#tab-status`, `#suggest-status`, `#zoom-percent` and `#hang-notice` keep their exact `role`/`aria-live`/`aria-atomic` attributes, and that none of them contains or is contained by `#save-prompt-status`. `shortcut-controller.js`'s `focus-content` (including the `focusLoadFailureHeading` branch) and `focus-chrome-end` are not modified: `git diff` shows no change in those cases, judged in the flight log.
- [ ] AC10 **P3 is recorded unverified.** The flight log and `docs/vault.md` state that the polite region in a non-focused chrome while the guest holds focus has not been confirmed with a screen reader. The HAT checks F6 discoverability by eye.

**Docs, gates**
- [ ] AC11 Docs:
  - `docs/vault.md`: keyboard use of the prompt; the announcement; the P3 gap.
  - The F6-cycle doc: the prompt hop. The guest→prompt hop exists only while a prompt is visible for that tab.
  - `CLAUDE.md`: one clause on the prompt hop.
- [ ] AC12 `npm test` (with a timeout), `npm run typecheck`, `npm run lint` and `npm run format:check` pass. `renderer.js` ≤ 1505 and `SEAM_COUNT` is unchanged.

## Verification Steps
- AC1-AC9: targeted `node --test --test-timeout=60000` on the named files, then the full `timeout 900 npm test`.
- AC9: `git diff -- src/renderer/chrome/shortcut-controller.js` must be empty, recorded in the flight log.
- AC12: the four commands.
- Live at the HAT (not this leg):
  - F6 from the page lands on the primary button, with a visible focus ring;
  - F6 again → address bar; Shift+F6 → page;
  - Esc → closes, and focus is back in the page;
  - Tab cycles inside;
  - the timer pauses while focused.

## Implementation Guidance
1. `save-prompt-keys.js` + test; the close-effects `refocusGuest` flip + test.
2. Manager: `focusPrompt`, held-focus tracking via webContents `focus`/`blur`, the refocus on close (inject `focusActiveGuest`). Share the `tab-focus-guest` predicate: extract a small helper the handler and the manager both use.
3. `window-factory.js`: the prompt view `before-input-event`, mirroring `createSheetView`'s.
4. `guest-wiring.js`: the in-module prompt hop per R1/R2.
5. Page: the `focus-first` handler, the status node, and the narrowed pin.
6. Chrome: `#save-prompt-status` in `index.html` + the client write. `renderer.js` is untouched.
7. The live-region pin test, docs, gates.

## Edge Cases
- **F6 while the prompt shows a result state** → it falls through to today's address-bar path (R2).
- **F6 auto-repeat**: guarded, as today.
- **The prompt focused, then the operator clicks the guest** → `blur` clears `heldFocus`, so there is no refocus at close (R3).
- **Esc pressed while consent is in flight** → `close('dismissed')` must not race the consent invoke. While the manager is `consenting`/`saving`, `dismiss` is ignored. Pinned.
- **Two windows**: each prompt view's handler acts on its own record only (a closure). A focused prompt in window A never moves focus in window B.
- **A prompt focused when the window blurs** → nothing special; the DD4 pause already applies.

## Files Affected
See Outputs.

---

## Post-Completion Checklist
Completion steps (status transitions, flight-log update, checking off in the parent flight, and commit) are Flight Control protocol, driven by the execution workflow. They are not repeated here.

## Citation Audit
Checked against the working tree on `sortie/06-non-blocking-save-prompt` (Leg 1 + 2 landed, uncommitted), 2026-11-04:
- `guest-wiring.js` ~142-162/~293;
- `cross-view-nav.js` (whole);
- `shortcut-controller.js` ~26/213/221/239;
- `index.html` ~143/358/439-449;
- `save-prompt.js` ~5-10;
- `register-tab-ipc.js` ~1209-1221;
- `window-factory.js` ~113-160.

These were re-read this session. Not re-read: the `main.js` guest-wiring construction site and the F6-cycle doc location, which the Developer finds by grep.

## Design Review Rulings (binding; supersede any conflicting AC text above)
Design review 1 (Developer, Sonnet, 2026-11-04): approve with changes. FD rulings:
- **R1 — no new dep.** `handleCrossView` resolves the prompt in-module with `const sp = registry.getWindowForGuest(contents.id)?.savePrompt`, using its existing `registry` dep (`guest-wiring.js` ~62-68, ~137). Popup guests resolve to `undefined` and fall through; add a test for that. `main.js` and the guest-wiring harnesses are untouched. AC1's "absent dep" case becomes "a record with no `savePrompt`".
- **R2 — eligibility before `preventDefault`.**
  - The manager gains a pure `canFocusPrompt()`. It is true only when all of these hold: visible, `ready`, `shown` (height reported), an offer state, not `saving`/`consenting`.
  - In `handleCrossView`: `if (input.key === 'F6' && action === 'focus-address' && sp?.currentWcId() === contents.id && sp.canFocusPrompt()) { event.preventDefault(); if (!input.isAutoRepeat) sp.focusPrompt(); return true; }`. Otherwise, today's path runs unchanged. Match on `key === 'F6'` explicitly, because Ctrl+L also yields `focus-address`.
  - `focusPrompt()` returns a boolean, but `handleCrossView` does not depend on it.
- **R3 — held focus.**
  - `heldFocus` tracks CURRENT focus: set on the prompt webContents `focus` event, cleared on `blur`, reset on close.
  - `close()` captures `const held = heldFocus` at its TOP, and the guest refocus runs AFTER the hide, including the deferred hide of a result close.
  - Window blur also clears it, so a prompt whose window is blurred never refocuses the guest; that is intended.
  - The refocus calls the injected `focusActiveGuest()`, NEVER the prompt's own `webContents.focus()`, so Leg 1's throwing-focus test stays green.
  - A source scan pins that `save-prompt-manager.js` has exactly ONE `webContents.focus(` call, inside `focusPrompt`.
  - The fake view gains a way to fire `focus`/`blur`.
- **R4 — Esc.**
  - Esc → `close('dismissed')` ONLY when `isOfferState() && !consenting && !saving`. Add a `canDismissByKey()` to the manager.
  - In a result state, or while consenting/saving, Esc is `preventDefault`ed and does nothing. It never overrides `saved` and never re-dismisses a saved capture.
  - After the prompt closes, Esc is no longer intercepted and reaches the guest normally. Pinned.
- **R5 — `focusActiveGuest(rec): boolean`.** Extract it to a tiny CJS module (e.g. `src/main/focus-active-guest.js`) that depends only on `guestTakenOver`. `tab-focus-guest` becomes `return focusActiveGuest(rec)` with identical semantics; its existing tests stay green, plus a regression case. The manager gets it as an injected dep closing over the record. The `tab-set-active` `wasPageFocused` refocus (~1285) is a different predicate and is left alone.
- **R6 — Shift+F6 into a taken-over tab.** If `focusActiveGuest` refuses, fall back to `chrome.focus()` and then send `chrome-shortcut-action { action: 'focus-content' }`, so the chrome's existing load-failure heading path (`shortcut-controller.js` ~221) handles it. Shift+F6 is never dead. Tested.
- **R7 — page focus.**
  - The page has ONE `focusPrimary()` function containing the single allowed `.focus(` call. Callers:
    - (a) the `focus-first` handler, which ignores a token ≠ `state.token` and no-ops when there is no primary button;
    - (b) the post-repaint restore: before a model-replace repaint the page records `hadFocus = card.contains(document.activeElement)` and, if true, calls `focusPrimary()` after the repaint. This covers convert in place and re-ask.
  - The `save-prompt-page.test.js` pin becomes:
    - exactly one `.focus(` match, located inside `focusPrimary`'s body (bounded with `findMatchingBracket` from `test/helpers/source-scan`);
    - the `autofocus` ban kept;
    - the vacuity mutation kept (an injected second `.focus(` → red).
  - The preload test's "no focus channel" wording is revised: a main→page `onFocusFirst` listener is allowed; any page→main focus-moving channel is still banned.
- **R8 — the keys helper** stays main-only CJS at `src/main/save-prompt-keys.js`, a pure decision module that only main uses. The prompt view's `before-input-event` listener is attached at the manager construction site in `window-factory.js` (~322), where `record` is in scope. `createSavePromptView()` keeps its signature.
- **R9 — the announcement.**
  - The chrome region text keeps "Press F6 to respond". The in-prompt `role="status"` text OMITS "Press F6", because the prompt is already in reach. Possible double speech is a recorded HAT item.
  - Re-announce clears the node and sets the text after `setTimeout(…, 30)`, never `requestAnimationFrame`, which does not fire in a hidden or background chrome window. MockTimers-tested.
  - AC9's nesting assertion: `#save-prompt-status` must match a self-closed `<div id="save-prompt-status" …></div>` (no children), and `#suggest-status`'s element must close before it. Read each pinned region's CURRENT attribute values from `index.html` before pinning; don't trust the leg's list.
- **R10 — the vault choice** stays a radio group, as Leg 1 built it. If it is a `<select>`, record that Esc dismisses the whole prompt.
- **R11 — doc sync.**
  - Update `src/shared/cross-view-nav.js`'s header comment (the F6 contract gains the guest→prompt hop, decided in `handleCrossView`).
  - In the same pass, add an amendment note under the flight's DD2: "Leg 3: keys read main-side from the prompt view's trusted `before-input-event`; no page→main `save-prompt:key` channel". Annotate; do not rewrite DD2.
  - The F6-cycle doc may be `docs/renderer-menu.md` or a keyboard doc; grep it, and if none exists, the `cross-view-nav.js` comment plus `docs/vault.md` suffice.

The review raised no high issue beyond R1/R2 (both resolved concretely). The FD skips cycle 2, and the flight-end Reviewer covers the code.
