# Flight: Keyboard Reachability and Omnibox Semantics

**Status**: ready
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] Keyboard-only user can enter, traverse, and leave page content (criterion 1)
- [ ] Omnibox suggestion highlighting exposed to AT across the view boundary (criterion 2)

---

## Pre-Flight

### Objective

Give keyboard-only users a way into the active guest page and a way to Tab
through it, and give assistive technology a way to hear which omnibox
suggestion is highlighted — both are consequences of the chrome and the
guest being separate documents, and both want one cross-view mechanism,
not two.

### Open Questions

- [ ] Focus-entry gesture: dedicated key (F6-style chrome↔content cycling
      is the browser convention), Enter-in-address-bar-after-load, or both?
- [ ] Tab-exhaustion detection: Electron has no "guest tab sequence
      exhausted" signal. Candidates: the guest preload observes
      `focusout` with `relatedTarget === null` on a forward Tab and reports
      it; or `document.activeElement` compared against the last tabbable
      element; or Chromium's own wrap behaviour observed via `keydown` +
      `focusin` ordering. Spike before choosing.
- [ ] Shift+Tab symmetry (explicitly out of scope in the M05 F5 L2 leg that
      introduced `tab-handoff`).
- [ ] F49 mechanism: mirror the highlighted suggestion's accessible name
      into a chrome-owned `aria-live` region, or move the highlighted-row
      state into the chrome document?

### Design Decisions

*(to be written at flight design; the maintenance report's F48/F49 details
are the inputs)*

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F48 and F49 (evidence + fix shape)
- [x] Prior art: `register-overlay-ipc.js:698` (`refocusGuest: true`) →
      `find-overlay-manager.js:291` (`wc.focus()`) — a working
      main-process focus-entry primitive

### Pre-Flight Checklist

- [ ] Open questions above resolved in a design review before leg 1
- [ ] Behavior specs re-authored (see Verification)
- Other items N/A — maintenance flight.

---

## In-Flight

### Technical Approach

**F48 — chrome↔guest focus handoff (#174).** Two root causes, both
verified: (1) the chrome's Tab order is closed-loop —
`shared/keydown-action.js:61-134` has no "focus page" action (every branch
but F12 requires ctrl/meta); Enter in the address bar runs `navigate()` then
`els.address.blur()` (`navigation-controller.js:327-333`) without focusing
the guest; `tab-create` (`register-tab-ipc.js:139-163`) and `tab-navigate`
(`:825-843`) never `.focus()` the guest; the only guest `.focus()` in the
tree, `tab-set-active` (`:869, :899-905`), is gated on `wasPageFocused` and
can only preserve focus a guest already had. (2) Once a guest holds focus,
`shared/cross-view-nav.js` returns `'tab-handoff'` for **any** unmodified
forward Tab and `guest-wiring.js:97-113` `preventDefault()`s it and ejects
to the address bar; only Shift+Tab reaches Chromium.

Fix shape: (a) add a focus-entry path from the chrome — the gesture is the
first design decision — implemented as a main-side `wc.focus()` on the
active guest, the primitive `find-overlay-manager.js:291` already proves;
(b) make `crossViewNavAction` distinguish "forward Tab at the guest's last
tabbable" from "forward Tab mid-page" — the detection mechanism is the
second design decision and needs a spike in the guest preload
(`webview-preload.js`), since the bridge runs on every page; (c) reverse
the pinned expectation in `test/unit/cross-view-nav.test.js` and rewrite
`tests/behavior/chrome-guest-keyboard-nav.md` so guest entry is by keyboard
(its step 2 currently establishes guest focus with a mouse click) and
forward traversal is asserted. Blast radius: a new IPC message from the
guest preload, `keydown-action.js`, `cross-view-nav.js`, `guest-wiring.js`;
must not fight the find-overlay, menu-sheet, or tab-strip focus rules
(`menu-overlay.js:11-22, 445-482`). Absorbs BACKLOG "Internal-page keyboard
focus" and M08 debrief H8 — internal `goldfinch://` pages are guests for
this purpose and must get the same entry path.

**F49 — omnibox suggestion semantics.** `index.html:78-85` `#address` has
`aria-autocomplete="list"` only; the `role="listbox"` rows render in the
menu-overlay sheet's separate `WebContentsView` (`menu-overlay.js:15`), so
`aria-activedescendant`/`aria-controls` cannot reference them; the
highlighted row is JS state only (`navigation-controller.js:306-314`).
Fix shape (design decision): the smallest correct change is a chrome-owned
`aria-live="polite"` region updated with the highlighted suggestion's
accessible name and position ("Brave Search, 2 of 5"), plus
`aria-expanded` on `#address`; a full combobox would require moving the
list into the chrome document, which is out of scope. Whatever cross-view
state channel (a) above introduces should carry this too.

### Checkpoints

- [ ] CP1: spike result — a reliable tab-exhaustion signal from the guest
      preload, demonstrated on three fixture pages (form-heavy, link-only,
      no focusables)
- [ ] CP2: keyboard-only navigate → activate a link → fill a field, live,
      with `cross-view-nav.test.js` reversed and green
- [ ] CP3: screen-reader-observable suggestion announcement (AX tree via
      `readAxTree` shows the live region text change)
- [ ] CP4: `chrome-guest-keyboard-nav` re-authored spec green; new
      keyboard-only spec green; suite/typecheck/lint green

### Adaptation Criteria

**Divert if**: no tab-exhaustion signal can be made reliable without
changing the guest preload's threat posture (e.g. it would require
trusting page-reported focus state for a privileged action).

**Acceptable variations**: choosing Enter-after-load *and* a dedicated key;
deferring Shift+Tab symmetry to a follow-on leg with a recorded reason.

### Legs

> **Note:** Tentative; designed one at a time by `/agentic-workflow`.

- [ ] `focus-entry-spike` - prove the tab-exhaustion signal and the entry gesture on fixtures
- [ ] `chrome-to-guest-handoff` - entry gesture + `wc.focus()` path + `cross-view-nav` change + reversed pins
- [ ] `omnibox-suggestion-announcement` - live-region mirror of the highlighted suggestion
- [ ] `hat-and-alignment` - operator keyboard walk incl. one multi-window state

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated (CLAUDE.md focus-handoff note; BACKLOG focus seed retired via squawk 0029)

### Verification

Two behavior specs authored inline at flight design: a rewritten
`chrome-guest-keyboard-nav` (keyboard guest entry; forward Tab traverses
page content; Tab past the last element returns to the chrome) and a new
keyboard-only primary-task spec (navigate, activate a link, fill a form
field, no mouse). Issue #174 closes on the shipped build's run logs.
