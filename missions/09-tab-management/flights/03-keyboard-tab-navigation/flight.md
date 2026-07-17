# Flight: Keyboard Tab Navigation Parity

**Status**: completed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [x] The operator can cycle and jump between tabs from the keyboard
      (next/previous cycling and direct jump-to-position, including
      jump-to-last), and it works whether focus is in the chrome or in web
      page content. *(behavior-test-backed — new `tab-cycling` spec)*

Also carries (rider): the consolidated CLAUDE.md doc-pass owed by the
flight-1 and flight-2 debriefs (four topics).

---

## Pre-Flight

### Objective

Bring tab switching to keyboard parity with mainstream browsers:
`Ctrl+Tab` / `Ctrl+Shift+Tab` and `Ctrl+PgDn` / `Ctrl+PgUp` cycle the active
tab through the strip's visual (DOM) order with wraparound; `Ctrl+1`–`Ctrl+8`
jump to position N and `Ctrl+9` jumps to the last tab. These are GLOBAL
chrome shortcuts — they work with focus anywhere (address bar, strip, web
page content, internal pages) and from all three capture points (chrome
keydown, guest `before-input-event`, menu-overlay sheet accelerators),
routing through the one classifier (`keydownToAction`) and the one dispatch
(`dispatchChromeAction`) like every existing chrome shortcut.

### Open Questions

- [x] Cycle order: MRU or visual? → **Visual (DOM) order with wrap**
      (matches the mission criterion's "next/previous"; MRU cycling is a
      possible future preference — out of scope).
- [x] Do the new chords collide? → No: `keydownToAction` maps no
      Tab/PageDown/PageUp/digit keys today; `Ctrl+Shift+T` stays reserved
      (its unit pin is untouched — Tab ≠ T); the strip's roving-tabindex
      handler only handles UNmodified arrows/Home/End/Delete; the sheet's
      APG keys are unmodified. `Ctrl+Tab` does not collide with the guest
      Tab→chrome cross-view handoff (`cross-view-nav.js` decides on
      UNmodified Tab only — verify at design review).
- [x] Should cycling work while a sheet menu is open? → Yes, Chrome-parity:
      the sheet accelerator union set gains the new actions as chrome-class
      entries (ride `chrome-shortcut-action`); the existing tab-switch
      close reason then closes the menu as a natural consequence of
      activation. (DD13 pattern.)
- [x] Ctrl+digit while typing in the address bar? → Switches tabs
      (Chrome-parity; global means global). **The address value is REPLACED
      by the target tab's URL** — `activateTab()` unconditionally syncs
      `els.address.value` on every activation, same as every existing switch
      path; an in-progress edit is lost, exactly as in Chrome (design-review
      correction of the draft's "keeps its text" premise — the spec must
      assert the replace, not the keep).
- [x] `Ctrl+PgDn/PgUp` delivery from guests → key-name consistency across
      all three capture points confirmed at design review (same Chromium
      DomKey table the existing `=`/`-`/`0` mappings already prove); the
      cross-view-nav Tab handoff gates on fully-unmodified Tab and runs
      before the shortcut branch — Ctrl+Tab falls through correctly
      (verified in code).

### Design Decisions

**DD1 — One classifier, one dispatch, three capture points (the established
shortcut architecture; no new plumbing).** `keydownToAction`
(`src/shared/keydown-action.js`) gains pure mappings: `Ctrl+Tab`→`tab-next`,
`Ctrl+Shift+Tab`→`tab-prev`, `Ctrl+PgDn`→`tab-next`, `Ctrl+PgUp`→`tab-prev`,
`Ctrl+1..8`→`tab-jump-N`, `Ctrl+9`→`tab-jump-last` (digits and PgDn/PgUp are
NOT lightbox-deferred — tab switching must always work; matches
`new-tab`/`close-tab` precedent).
**i18n rulings (design review)**: (a) the classifier gains an `alt`
parameter (default `false` so existing pins stay green) and the DIGIT
branch is gated on `!alt` — AltGr on European layouts reports
ctrl+alt, and `Ctrl+Alt+7..9` must keep producing `{[]}` etc., never
tab-jumps; real `e.altKey`/`input.alt` is threaded through ALL THREE
capture points. The alt-guard is scoped to digits ONLY (Tab/PgDn/PgUp are
not character-producing; guarding them would be cargo cult — stated so a
future reader doesn't wonder). (b) The digit match is on `key === '1'..'9'`
REGARDLESS of shift — AZERTY layouts need Shift to produce digits, so a
reflexive `!shift` guard would break them (the `'='` zoom match is the
existing shift-tolerant precedent). Unit pins include `Ctrl+Alt+7 → null`
and a shifted-digit case. `dispatchChromeAction` (renderer.js)
implements them over `orderedTabIds()` (the F2 order authority — jumps and
cycling follow VISUAL order, including after reorder) + `activateTab`.
Wrap at both ends for cycling; jump beyond count = no-op (Chrome-parity:
Ctrl+7 with 5 tabs does nothing); `tab-jump-last` = last id.
- Rationale: the classifier/dispatch pair is the house pattern; adding
  actions auto-propagates to every capture point that consults it.
- Trade-off: none — this is the designed extension path.

**DD2 — Guest forwarding via the existing allowlist, for BOTH guest kinds.**
The guest `before-input-event` path already classifies via
`handleGuestChromeShortcut` + `keydownToAction` and consults
`guest-forward-allowlist.js` per guest kind. The new actions are added to
the allowlist for web AND internal guests (tab switching is
navigation-neutral chrome behavior — an internal settings page must not
trap the operator). `e.preventDefault()` on forward so the guest never sees
a stray Tab/PageDown (no page scroll, no focus traversal in the guest).
- Premise (verified at design): `cross-view-nav.js`'s guest Tab handoff
  decides on UNmodified Tab; ctrl-modified Tab falls through to the chrome-
  shortcut classification — confirm order of the two branches in
  `wireGuestContents` at leg design review.

**DD3 — Sheet accelerators: chrome-class entries.** `sheet-accelerator.js`'s
union mapper gains the new actions as chrome-class (ride
`chrome-shortcut-action` → `dispatchChromeAction`). Activation triggers the
existing tab-switch sheet close (`closeMenuOverlay('tab-switch')` path) —
no new close plumbing.
- Trade-off: unmodified APG keys stay with the menu (arrows still navigate
  menu items — only ctrl-modified chords ride through). Correct per DD13.

**DD4 — Verification: new `tab-cycling` behavior spec.** Steps: cycle
next/prev from chrome focus (address bar focused — proves global scope);
cycle from INSIDE web guest content (pressKey delivered to the guest wcId —
the real user path, and the strongest capture-point case); Ctrl+PgDn/PgUp
equivalence; jumps 1/N/last incl. out-of-range no-op; wrap at both ends;
jumps follow VISUAL order after a keyboard reorder (F2 integration — pin
the prediction from `orderedTabIds` before jumping); cycling while a sheet
menu is open (menu closes, tab switches); internal-tab case (cycle FROM a
`goldfinch://settings` tab). Apparatus: existing (pressKey + modifiers,
evaluate, readAxTree, enumerateTabs); no new ops needed — both axes exist.
Reuses the F2 no-hijack positive-control pattern where a "nothing happens"
row appears (out-of-range jump).
- Unit net: `keydown-action.test.js` pins every new mapping (incl. the
  Ctrl+Shift+T reservation staying intact — Tab vs T adjacency is exactly
  the kind of thing to pin, plus the AltGr and shifted-digit pins);
  `guest-forward-allowlist.test.js` pins the per-guest-kind forwarding;
  `sheet-accelerator.test.js` pins the union entries — **NOTE (design
  review): its existing generic loop test pins `Ctrl+Tab → null` (the
  `['a','s','d','q','ArrowDown','Escape','Enter','Tab']` array) — remove
  `'Tab'` from that loop IN THE SAME CHANGE the union entry lands, not as a
  red-test afterthought.**
- Spec note (design review): with ONE tab open, cycling wraps to the same
  id — `activateTab(sameId)` is a harmless re-add with no visible change;
  the spec words that row so a Witnessed run doesn't misread "nothing
  changed" as failure.
- Documented risk (design review Q3, mission-debrief carry):
  `sheet-accelerator.js` hand-mirrors `keydownToAction` rather than sharing
  it — every classifier change (incl. this flight's `alt` addition) must
  land in BOTH files in lockstep or the sheet path silently diverges on
  AltGr locales. Unification is a future maintenance candidate, not this
  flight.

**DD5 — Doc-pass rider (owed by F1+F2 debriefs).** CLAUDE.md gains, in one
pass: (a) a tab-strip DOM/CSS structure paragraph (`.tab` sizing/query
container + `.tab-row` layout box, disclosure stages, active-tab floor);
(b) the container-query self-restyle pitfall (recurring-failure-mode note);
(c) DOM-order authority (`orderedTabIds()`/`commitTabMove()`, Map demoted to
lookup); (d) the two-set-point click-suppression flag as a named pattern.
Plus this flight's keyboard map addition to the existing shortcuts notes.

### Prerequisites

- [x] Flight 2 landed and debriefed (branch stacks on `flight/2-tab-reorder`).
- [x] Classifier/dispatch/allowlist/sheet-mapper extension points read and
      confirmed current (keydown-action.js modifier gate structure; the
      allowlist's per-guest-kind shape; sheet union mapper).
- [x] No binding collisions (see Open Questions).
- [x] Behavior apparatus unchanged from F2 (pressKey modifiers array,
      pin-if-free port rule, fixture server).

### Pre-Flight Checklist

- [x] All open questions resolved (PgDn/PgUp guest-delivery premise-check
      delegated to leg design/implementation)
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Pure-first: classifier mappings + unit pins, then the renderer dispatch over
`orderedTabIds()`, then the two other capture points (guest allowlist +
before-input-event branch check; sheet union mapper), then the spec + doc
rider. All chrome/shared/main-side shortcut plumbing — no new IPC channels,
no session/guest-view changes, no automation-surface changes.
Watch item from the F2 debrief recorded: renderer.js is 3510 lines and
growing; this flight adds only a small dispatch switch (~30 lines) — the
chrome-DOM module split decision is deferred to the multi-window flights as
planned.

### Checkpoints

- [x] Unit pins green (classifier, allowlist, sheet mapper).
- [x] All three capture points verified live (chrome focus, guest content,
      sheet open).
- [x] `tab-cycling` behavior spec passes end-to-end (11/11 first run).
- [x] Doc-pass rider landed; a11y + suites green.

### Adaptation Criteria

**Divert if**:
- `before-input-event` does not see Ctrl+Tab or Ctrl+PgDn/PgUp from guests
  (Chromium consumes them earlier) → the guest capture point needs a
  different seam (e.g. webContents `zoom-changed`-style main capture);
  new DD required.

**Acceptable variations**:
- Exact no-op vs clamp semantics for out-of-range jumps (default no-op,
  Chrome-parity).
- Whether `Ctrl+9` announces/focuses anything beyond activation (default:
  plain activation, same as a click).

### Legs

> **Note:** Tentative; planned one at a time.

- [x] `cycle-and-jump` — classifier + dispatch + guest forwarding + sheet
      union + unit pins + live capture-point checks + `tab-cycling` spec
      authored.
- [x] `verify-and-docs` — run `tab-cycling`; a11y sweep; suites; the DD5
      CLAUDE.md doc pass; fix loop as needed.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged (PR — stacks on flight/2)
- [x] Tests passing
- [x] Documentation updated (DD5 rider + shortcut tables in README/docs if
      they enumerate chords)

### Verification

- New `tests/behavior/tab-cycling.md` passes.
- `npm run a11y` green; `npm test`/lint/typecheck green.
- Unit pins: new mappings + the intact Ctrl+Shift+T reservation.
