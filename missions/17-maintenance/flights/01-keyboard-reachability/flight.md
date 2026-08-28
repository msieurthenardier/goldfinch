# Flight: Keyboard Reachability and Omnibox Semantics

**Status**: in-flight
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

*Tentative — written at Leg 1 design from the scout's ground truth; Leg 1's
evidence confirms or amends each (recorded in the flight log as runtime
decisions). Full text and rationale in `legs/01-focus-entry-spike.md` § Context.*

**DD1 (confirmed, amended 2026-08-28) — F6 / Shift+F6 cycle chrome ↔ content,
Chrome-like landing.** F6 hands OS focus to the guest *document*: on a fresh
page `activeElement` is `BODY` and the first Tab enters the first tabbable; on
re-entry Chromium restores the element the page last held. This is exactly
Chrome's and Firefox's F6 contract and needs no guest-side code (operator
ruling 2026-08-28 after the Leg 1 run showed `webContents.focus()` never
lands on a tabbable; explicit first-tabbable focus and a hybrid were
rejected). F12 is the classifier's precedent for an unmodified key.
Enter-after-navigation focusing the page is deferred to Leg 2.

**DD2 (confirmed by run 2026-08-28-01-01-15) — the guest reports tab-sequence exhaustion.** A pure
`tabBoundary(doc, direction)` helper (CJS-by-design, shared by both guest
preload branches — the web branch runs in the page main world with
`contextIsolation:false`, the internal branch sandboxed) decides whether a
Tab / Shift+Tab press would leave the page's tabbable sequence; if so the
preload sends a payload-minimal `guest-tab-boundary {direction}` that main
forwards to the tab's chrome with the wcId from `event.sender.id` — the
`guest-vault-gesture` pattern. The preload `preventDefault`s at the boundary
(review ruling — today's handoff does too); Leg 1 measures that the async
handoff is clean. **DD5 (confirmed — the internal jars page emitted a `backward` event to the chrome)** — both guest preloads are bundled
by `scripts/build-preload.mjs` (the trusted preload is sandboxed too and
cannot `require` a shared module unbundled).

**DD3 (confirmed) — mid-page Tab is Chromium's.** `crossViewNavAction`
stops returning `'tab-handoff'` for unmodified Tab; Ctrl/Cmd+L unchanged; the
pinned test is renamed and inverted, not deleted.

**DD4 (confirmed with a fix, 2026-08-28) — chrome-side placement.** Forward
boundary → `#address` (`focus()` + `select()`); backward boundary → the
chrome's last *visible* tabbable. The collapsed media/privacy panels are
hidden with `visibility:hidden` — and the Leg 1 run found that a
`visibility:hidden` element still reports client rects, so a
`getClientRects().length` visibility test alone walks onto a panel button whose
`.focus()` is a silent no-op (run 2026-08-27-23-14-02, checkpoint 8 / diag-8).
Visibility is therefore tested with `getComputedStyle(el).visibility` as well
(inherited, so ancestor-hidden controls are excluded too), in both the chrome
walk and `tabBoundary()`. F6 → new `focusActiveGuest()`
bridge → `tab-focus-guest` (sender window's active tab only). Dispatch lives
in `shortcut-controller.js`; `F6` is added to the automation `KEY_MAP`; the
popup no-op (`chromeForTab` does not resolve popups) is accepted for Leg 1.

**DD6 (Leg 2) — F6 / Shift+F6 from the guest.** `crossViewNavAction` returns
`'focus-address'` for unmodified F6 (Chrome's F6 from the page → omnibox) and
`'focus-chrome-end'` for Shift+F6 (→ the chrome's last visible tabbable, the
backward-boundary placement); `handleCrossView` forwards the *computed* action
(it hardcoded `'focus-address'` before). Both sides gate F6 on ctrl/meta/alt
(parity). Popups: null-safe no-op, accepted.

**DD7 (Leg 2) — Enter in the address bar focuses the page on commit.** A
one-shot keyed by the *logical tab id* (the welcome tab's wcId does not exist
at Enter time) is armed after `blur()`; the chrome's existing
`tab-did-navigate {wcId}` push resolves the wcId to its tab and, if it is the
armed tab, still active, and the address bar was not re-focused, calls
`focusActiveGuest()` once. In-page navigations and search-query Enters never
commit through `did-navigate` — the one-shot expires on the next Enter or tab
switch.

**DD8 (ruled C, 2026-08-28) — trailing iframe.** The keydown inside an iframe
is invisible to the top-frame listener, so forward Tab past a trailing iframe
wraps to the top document's first tabbable. A subframe listener would require
`nodeIntegrationInSubFrames`, which loads the *same* page-world farbling
preload in every cross-origin iframe (`electron.d.ts:19341-19347`) — a
security/farbling call for Flight 2 / #147, not this flight. With DD6, every
page has a documented standard exit (F6 / Shift+F6 → chrome), which satisfies
WCAG 2.1.2; the wrap stays a documented residual (Mission 17 Known Issue) and
the iframe fixture row keeps documenting.

**DD9 (Leg 2) — `tab-boundary.js` is an ES module** shared by the chrome
(`shortcut-controller.js` import) and both bundled preloads (esbuild's CJS
`require()`-of-ESM interop yields named exports as plain properties; Node 22's
`require(esm)` already serves `cross-view-nav.js` the same way). Retires Leg
1's chrome-side duplicate of the tabbable filter. `eslint.config.mjs`'s
CJS-by-design lists drop the file.

**DD10 (Leg 2) — spec rows** for F6-from-guest, Shift+F6-from-guest, and
Enter-after-navigation; baselines blur `document.activeElement`; the iframe
row's Expected Results carry the DD8 (C) wording.

**DD11 (Leg 3) — `#address` stays a `textbox`; the `aria-expanded` toggle is
retired.** F49's fix shape ("plus `aria-expanded`") was amended by ground
truth: the attribute was already toggled (`renderer.js` suggestions
`ariaTarget`) and is not permitted on a textbox (axe 4.13
`aria-allowed-attr`); `combobox` would require an `aria-controls` that cannot
reference the sheet's listbox in another document. `ariaTarget: () => null`;
`aria-autocomplete="list"` kept; no `role`/`aria-expanded` in any state —
the only configuration with no axe violation open or closed.

**DD12 (Leg 3) — a dedicated `#suggest-status` polite live region.** Sibling
to `#tab-status` (the M09 F2 DD3 no-race idiom). Text composed by the pure
`suggestionAnnouncement(model)` and carried on the model as `announcement`
(`buildSuggestionModel`) — the chrome controllers take every helper through
`renderer.js`'s deps object, and the file is at budget: `No matches` /
`{n} suggestion(s)` / `{primary}, {secondary}, {i} of {n}` (+ `, bookmark`).
Written on every paint; cleared by `resetSuggestState`, which the close sink
(`handleSuggestionsClosed`) now calls for every non-`activated` reason.

**DD13 (Leg 3) — verification.** Pure truth table + controller cases + a
grep-shape pin file; new spec `omnibox-suggestion-announcement` (8 rows,
run 2026-08-28-02-48-31 8/8) reading the region via `evaluate(C)` corroborated
by `readAxTree(C)`'s status node and `enumerateWindows().sheetVisible`.

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F48 and F49 (evidence + fix shape)
- [x] Prior art: `register-overlay-ipc.js:698` (`refocusGuest: true`) →
      `find-overlay-manager.js:291` (`wc.focus()`) — a working
      main-process focus-entry primitive

### Pre-Flight Checklist

- [x] Open questions above resolved as tentative DD1–DD4 at Leg 1 design (2026-08-27); Leg 1 confirms them with evidence
- [x] Behavior specs re-authored (see Verification) — `chrome-guest-keyboard-nav` (15 rows) and `omnibox-suggestion-announcement` (8 rows), both `active`
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

- [x] CP1: spike result — a reliable tab-exhaustion signal from the guest
      preload, demonstrated on form-heavy, no-focusable, and internal pages
      (link-only fixture exists; the trailing-iframe fixture documents a
      one-directional trap for Leg 2)
- [x] CP2: keyboard-only enter → traverse → fill a field, live (run 2
      rows 3–6), `cross-view-nav.test.js` reversed and green
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

- [x] `focus-entry-spike` - prove the tab-exhaustion signal and the entry gesture on fixtures — landed 2026-08-28 (behavior test 12/12 on the fixed build)
- [x] `chrome-to-guest-handoff` - entry gesture + `wc.focus()` path + `cross-view-nav` change + reversed pins
- [x] `omnibox-suggestion-announcement` - live-region mirror of the highlighted suggestion
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
