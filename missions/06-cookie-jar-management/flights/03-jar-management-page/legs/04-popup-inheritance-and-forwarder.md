# Leg: popup-inheritance-and-forwarder

**Status**: completed
**Flight**: [Jar Management Page](../flight.md)

## Objective

`window.open`/`target=_blank` popups inherit the opener tab's jar (burner openers
mint a FRESH burner), and guest-focus chrome accelerators are forwarded through one
generalized classifier-driven forwarder replacing the per-key one-offs — closing the
Ctrl+W/sibling gap.

## Context

- **DD7 — popup inheritance**: main's `setWindowOpenHandler` inside
  `wireGuestContents` (main.js:1054-1057, working tree) forwards only the URL.
  Fix: read the opener's partition from the EXISTING per-view registry —
  `tabViews.set(wcId, { view, partition, trusted, ... })` at main.js:1986,
  cleaned up on `tab-close` — via `tabViews.get(contents.id)?.partition`, and
  send `{ url, openerPartition }` on the `open-tab` channel.
  chrome-preload.js:114 forwards the payload object; the renderer's `onOpenTab`
  subscriber (renderer.js:2441, working tree) resolves the container with the
  same truth table as context-menu opens. Exactly three `open-tab` sites exist
  (re-verified at leg design review against the working tree: main.js:1055
  sender, chrome-preload.js:114, renderer.js:2441); no other sender/listener to
  migrate, and NO existing unit test pins the open-tab payload,
  setWindowOpenHandler, or handleGuestNewTab (grep-verified) — no test flips
  needed for those.
- **Partition→decision resolution (pure, shared)**: extend
  `src/shared/inherit-container.js` with a dual-exported pure function (e.g.
  `inheritFromPartition(openerPartition, containers)`) returning the SAME decision
  shape `inheritContainerDecision` produces, so the renderer consumes one decision
  path: persistent container whose `partition` matches → that container reference;
  burner-pattern partition → fresh-burner sentinel (never-share-state invariant);
  internal partition / unknown / null → default resolution. **Partition shapes,
  verified at design review — pin these in the truth table**: persistent jars
  `persist:...` (jars.js:49-59); burner `burner:${n}` (renderer.js:594 — COLON
  separator, not the hyphen used in burner ids); internal is the bare string
  `goldfinch-internal` (internal-page.js:8). `startsWith('persist:')` /
  `startsWith('burner:')` dispatch is unambiguous. Missing/undefined
  `openerPartition` (e.g. a sender outside the registry) → default resolution,
  never a throw.
- **DD8 — generalized forwarder**: the web-guest `before-input-event` block
  (main.js:1076-1148, working tree) forwards L/Tab (cross-view helper), T
  (`handleGuestNewTab`, main.js:1040-1049), F (`open-find`), J
  (`open-downloads`); zoom/print/devtools are handled main-side. The
  internal-guest block (main.js:1183-1186) has only cross-view + new-tab. Replace the chrome-class one-offs with ONE forwarder
  beside the existing helpers: classify the keystroke with the existing pure
  modules (src/shared/keydown-action.js `keydownToAction`;
  src/shared/sheet-accelerator.js enumerations — main.js:1016-1021 already uses
  them for the sheet path), and forward any allowlisted chrome-class action as
  `chrome-shortcut-action` `{ action }` (the channel the renderer already
  dispatches — chrome-preload.js:147).
- **Forwarder allowlists (FD ruling)**: WEB guests forward the full chrome-class
  action set the classifiers produce (this is the parity goal — anything the
  chrome DOM handler does under chrome focus works under guest focus).
  INTERNAL guests forward exactly: cross-view nav (existing helper, unchanged),
  `new-tab`, and `close-tab` — nothing else this flight (conservative; the
  allowlist is a one-line extension later). Main-side-handled keys (zoom, print,
  devtools, find, downloads) keep their existing branches and stay OUT of the
  forwarder.
- **Allowlist as pure module**: the per-guest-kind forwarding decision
  (`action × guestKind → forward?`) lives in a small pure CJS module under
  `src/shared/` (dual export not required if no page consumes it — main-only is
  fine), truth-table unit-tested. The main.js wiring stays thin.
- **Premise RESOLVED at design review (enumeration verbatim)**: (a)
  `keydownToAction` (keydown-action.js:40-74) emits 12 actions — devtools,
  zoom-in/out/reset, find, new-tab, close-tab, focus-address, toggle-panel,
  toggle-privacy, reload, downloads; `sheetAcceleratorAction`
  (sheet-accelerator.js:43-70) adds only `print` (guest-scope). Chrome-class
  forwarder set = keydownToAction vocabulary minus main-side-handled =
  **{new-tab, close-tab, focus-address, toggle-panel, toggle-privacy, reload}**
  (6). (b) The renderer's subscriber (`onChromeShortcutAction`,
  renderer.js:2548-2550) routes to `dispatchChromeAction`
  (renderer.js:2461-2522), a switch implementing ALL 12 keydownToAction outputs
  — extracted at M05 F8 Leg 2 as shared code, already exercised against the
  full vocabulary. (c) **Gap: NONE. No renderer dispatch extension is needed —
  do not add branches that already exist.**
- **Ctrl+Shift+T ruling (FD, design review cycle 1)**: `handleGuestNewTab`
  (main.js:1040-1049) matches `t` AND `T`, so Ctrl+Shift+T opens a new tab under
  guest focus today — but the chrome-focus DOM handler (via `keydownToAction`,
  lowercase `t` only) never supported it. Unifying on `keydownToAction`
  **intentionally drops** shifted-T under guest focus: parity with chrome focus,
  and Ctrl+Shift+T is conventionally "reopen closed tab" — a chord worth
  reserving unassigned for that future feature. Pin the intentional change with
  a unit test on the classifier/allowlist path (shifted T → no forward); the
  HAT re-verifies literal Ctrl+T only.
- **Ctrl+T regression risk**: `handleGuestNewTab` was the F2 HAT fix (D2) — the
  forwarder absorbs/replaces it; the HAT re-verifies Ctrl+T explicitly. Do not
  regress the two-branch wiring (web AND internal guests get new-tab).
- **Existing tests that may pin old behavior**: check for unit tests pinning the
  `open-tab` single-URL payload or `handleGuestNewTab`/sheet-accelerator
  action sets (keydown-action/sheet-accelerator have their own suites). Flip
  with rename-and-invert where the contract changes (staged-invariant naming
  convention, F1 precedent) — never delete-and-readd.
- Legs 1-3 (uncommitted) touched renderer.js only in Leg 3 (opener/kebab/picker/
  sweep areas + :736 name fix); `onOpenTab` at :2367 and the guest-wiring main.js
  blocks are untouched — but VERIFY line anchors against the working tree, Leg
  3's renderer edits may have shifted lines below its insertion points.

## Inputs

- Legs 1-3 landed (uncommitted); suite 1186/1186, typecheck/lint clean.

## Outputs

- Popups open in the opener's jar (fresh burner for burner openers); Ctrl+W (and
  the full chrome-class set) works under web-guest focus; internal guests gain
  close-tab; one forwarder replaces the accumulating `handleGuest*` one-offs.

## Acceptance Criteria

- [x] `setWindowOpenHandler` sends `{ url, openerPartition }` sourced from the
      per-view registry; preload forwards the object; renderer resolves via the
      new pure `inheritFromPartition` and passes the decision through the same
      consumption path as context-menu opens (fresh burner for burner-pattern
      openers; default for internal/unknown/missing).
- [x] `inherit-container.js` extension is pure + truth-table tested: container
      match by partition; the REAL burner partition format (pinned from
      `makeBurner`, not guessed); internal partition → default; null/undefined →
      default; no-match persistent-looking partition → default (privacy-
      conservative, mirrors `resolveNewTabContainer`'s stale-id posture).
- [x] One generalized forwarder in main.js registered in BOTH guest branches;
      per-guest-kind allowlist from the new pure module (web: full chrome-class
      set; internal: cross-view + new-tab + close-tab only); main-side-handled
      keys untouched; `handleGuestNewTab`'s behavior fully absorbed (Ctrl+T
      still forwards on both branches — no regression).
- [x] Renderer's `chrome-shortcut-action` dispatch (`dispatchChromeAction`,
      renderer.js:2461-2522) already implements every action the web-guest
      allowlist forwards — **no dispatch-side changes**; this criterion is
      satisfied by the design-review enumeration. Adding branches that already
      exist is a defect, not completeness.
- [x] Shifted-T intentional-drop pinned: a unit test on the classifier/allowlist
      path asserts Ctrl+Shift+T produces NO forward (FD ruling in Context) —
      the behavior change ships deliberately, visible in the test name.
- [x] Allowlist module truth-table tested; existing keydown-action /
      sheet-accelerator / any `open-tab`-payload-pinning tests flipped with
      rename-and-invert where contracts changed; no test deleted.
- [x] `npm test` (baseline 1186 + new module/truth-table tests), `npm run
      typecheck` (d.ts updated for the `onOpenTab` payload shape and any new
      global), `npm run lint` green.
- [x] `git diff` for this leg confined to: main.js (guest wiring +
      setWindowOpenHandler), chrome-preload.js (:114 area), renderer.js
      (`onOpenTab` subscriber + `chrome-shortcut-action` dispatch),
      src/shared/inherit-container.js + new allowlist module, tests, d.ts.

## Verification Steps

- `npm test` / `npm run typecheck` / `npm run lint`.
- Machine gate for popups: `/behavior-test popup-jar-inheritance` at Leg 5.
- Accelerator parity + Ctrl+T regression: HAT (input injection can't reliably
  drive `before-input-event` — DD9 split).

## Implementation Guidance

1. **Enumerate first** (from the design review's premise table): classifier
   action vocabulary → renderer subscriber coverage → gaps. Write the allowlist
   module against the enumeration.
2. **DD7 second** (small, three sites + pure function + tests).
3. **DD8 third**: forwarder function beside `handleGuestCrossViewNav`; wire into
   both branches; delete/absorb `handleGuestNewTab` (keep a comment trail to the
   F2 D2 fix); extend the renderer dispatch for gap actions.
4. Keep the internal-guest branch's deliberate thinness — its allowlist is the
   ruling's three actions, nothing more, commented as a deliberate posture.
5. Comment `inheritFromPartition` with the never-share-state burner rationale
   (F2 D3 lineage).

## Edge Cases

- **Popup from a burner tab**: fresh burner, NEVER the opener's `burner-<n>`
  container (partition match must not return the burner source as a container —
  burner containers aren't in `containers`, but pin a test anyway).
- **Popup from the jars/settings/downloads page**: internal partition → default
  routing (internal pages shouldn't spawn web popups, but the path must be safe).
- **Opener closed before the popup IPC lands**: registry entry gone →
  `openerPartition` undefined → default routing (no throw).
- **Ctrl+W on the last tab under guest focus**: forwarded close-tab runs the
  standard `closeTab` — its last-tab branch creates the fallback (Leg 3-verified
  convergence).
- **Ctrl+W under INTERNAL guest focus** (e.g. the jars page active): allowed by
  ruling — closes the internal tab.
- **Keystrokes that classify to main-side actions** (zoom/print/devtools/find/
  downloads): must NOT double-fire through the forwarder.
- **Ctrl+L ordering dependency (design-review catch)**: `crossViewNavAction`
  AND `keydownToAction` both map Ctrl+L → `focus-address`. Safe today only
  because `handleGuestCrossViewNav` runs FIRST with an early return. The
  forwarder MUST be registered AFTER the cross-view helper in both branches
  (comment the ordering constraint); otherwise Ctrl+L double-dispatches.
- **Ctrl+Shift+T**: intentionally no longer opens a tab under guest focus
  (FD ruling, Context) — pinned by test.

## Files Affected

- `src/main/main.js` — setWindowOpenHandler payload; generalized forwarder in
  both guest branches; `handleGuestNewTab` absorbed
- `src/preload/chrome-preload.js` — `onOpenTab` payload forward (:114 area)
- `src/renderer/renderer.js` — `onOpenTab` subscriber; `chrome-shortcut-action`
  dispatch extensions
- `src/shared/inherit-container.js` — `inheritFromPartition` (+ its test file)
- `src/shared/` — NEW pure allowlist module (+ NEW test)
- `src/renderer/renderer-globals.d.ts` — onOpenTab payload type; new globals if
  any
- `test/unit/` — extensions/flips per the enumeration

---

## Citation Audit

All anchors re-verified against the WORKING TREE at design review cycle 1
(2026-07-10), which found the flight-design main.js anchors had drifted +12
(Leg 1's INTERNAL_PAGES entry inserted above the guest wiring — the original
audit note wrongly implied only renderer.js could have shifted). Corrected,
review-verified values now inline throughout Context: setWindowOpenHandler
main.js:1054-1057 (sender :1055), web-guest block :1076-1148, internal-guest
block :1183-1186, handleGuestNewTab :1040-1049, tabViews.set :1986;
chrome-preload.js:114/:147; renderer.js onOpenTab subscriber :2441, makeBurner
partition :594, dispatchChromeAction :2461-2522, onChromeShortcutAction wiring
:2548-2550. The formerly-unverified subscriber-coverage premise is resolved by
the review's enumeration (no gap); `chrome-shortcut-action` has exactly three
senders today (main.js:419 sheet, :1023 cross-view, :1047 handleGuestNewTab).

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (append-only)
- [x] Set this leg's status to `landed` (deferred-review mode: `completed` comes
      at the flight-level commit)
