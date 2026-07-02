# Flight Log: Menu Overlay Sheet

**Flight**: [Menu Overlay Sheet](flight.md)

## Summary

Not yet in flight. Planning began 2026-07-02.

---

## Leg Progress

*(none yet)*

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### 2026-07-02 — Flight planning

- Direction set by operator: leverage the Flight-7 overlay breakthrough; retire freeze-frame outright.
  The F7 debrief's "investigate pause-hit-testing first" recommendation recorded as considered-and-
  overridden (flight.md DD1).
- Recon (read-only) mapped the freeze machinery: five menu surfaces, all through `menuController`, all
  calling `freezeGuest`/`unfreezeGuest`; capture → still → hide → z:60 DOM menu.
- Overlay shape interviewed with consequences on the table; operator selected the **full-guest
  transparent sheet** (DD2) over sized-to-menu views. Operator also locked: find bar hidden under open
  menus (DD5, parity), a11y auditing must be preserved (DD6), HAT leg yes.
- a11y observe-path premise verified against code at planning: `evaluate` resolves arbitrary wcIds
  (`src/main/automation/resolve.js:76-81`), `a11y-audit.mjs:runAxe` is wcId-parameterized.
- Behavior spec `tests/behavior/menu-overlay.md` drafted (status: draft).

### 2026-07-02 — Design review round 1 (Architect)

- Verdict: **approve with changes** (direction sound; completeness fixes, no rework). 14/16 citations
  exact; one drift repaired (`guestFrozen` guard is `renderer.js:979` + `2697-2698`, not 879-886).
- Two HIGHs, both in DD4's close-path enumeration — exactly the F7-debrief gap class the review was
  asked to stress: (1) no declared path for **main-initiated** sheet hides (BaseWindow blur — no such
  listener exists yet; tab lifecycle; teardown) → fixed with the `closeMenuOverlay(reason)` single
  close path + reason-resolved refocus; (2) the **trigger re-click-to-close race** (sheet blur fires
  before chrome's click → close-then-reopen blink) → named in DD4 with a default suppress-window
  mechanism, locked at Leg-2 design.
- Mediums fixed: DD11 now enumerates all **six** freeze-pinning artifacts (incl. `menu-dismissal.md`,
  `kebab-menu.md`, `menu-controller.test.js` — previously "the four specs"); cutover no longer deletes
  the dual-purpose `tab-hide`/`tab-set-active` overlay touches (re-comment only); the behavior spec's
  step 3 reframed around the injected-clicks-bypass-hit-testing apparatus limit (OS-pointer
  interception is HAT-only); DD13 added (accelerators forwarded via the existing `before-input-event`
  pattern — freeze-era shortcuts parity).
- Lows fixed: sheet renders model labels via `textContent` only (guest-controlled strings); DD2
  coordinate-identity nuance (toolbar anchors need chrome→sheet translation); DD8 gained the
  **jar-tier hardening** (non-`tabViews` wcIds resolve admin-only — a real gap: a jar key could have
  driven privileged menu actions via the probed sheet).
- Review pre-answered the `#new-container-dialog` open question from code: NOT a freeze consumer;
  `position:fixed; inset:0` chrome dialog shown post-unfreeze — latent pre-existing occlusion defect.
  Leg-3 disposition reframed (fix via sheet vs accept/record — operator call).
- Suggestions adopted: `menu-overlay-manager.js` extraction committed from Leg 1; Leg-5→5b split
  pre-authorized; concrete liveness fixture named in the spec; `aria-expanded="true"`-while-open
  assertion added; OS-grab `captureWindow` availability recorded as an execution-time prerequisite.

### 2026-07-02 — Design review round 2 (Architect, final)

- Verdict: **approve with changes** — round-1 incorporation verified sound (all corrected citations
  exact; re-comment-not-delete rationale confirmed in code; menu-controller "move not
  reimplementation" confirmed via dual-export). Two mediums + two lows, all targeted DD edits, all
  applied:
  - **DD8 premise corrected**: the jar-tier "gap" was not live — the scope façade
    (`scope.js:120-128` → `resolveContentsForJar`, `resolve.js:151-157`) already refuses the
    chrome-class sheet on session identity (pinned by `automation-scope.test.js:142-191`). Hardening
    retained as defense-in-depth; "SOLE relaxation" docs/tests flagged for same-pass update; Flight 5
    will not be sent hunting a non-existent vulnerability.
  - **DD13 set corrected**: guest-captured accelerators are a proper subset of the chrome-focus set
    (`keydownToAction`); forwarding set is now the union (Ctrl+W etc. would have dead-ended under
    the original wording). Phantom "Ctrl+Tab" example dropped.
  - **DD4 additions**: monotonic open-token echoed in channels 4/5/7 (same-menuType stale-close
    race) + `closeMenuOverlay` idempotency (double-blur on app switch) — both on the Leg-2 lock list.
  - Spec: step-4 `readDom(sheetWcId)` observable added to Actions; fixture-placement constraint
    (link away from the top-right menu rect) recorded in step 1.
- Two review cycles complete (max reached); spec is codebase-validated. Awaiting operator walkthrough
  → `ready`.
