# Leg: 03-cross-window-drop-adopt

**Status**: completed
**Flight**: [Cross-Window Tab Drag](../flight.md)

## Objective

A tab dragged from window A's strip and dropped on window B's strip moves A→B keeping `wcId`, jar,
and page state — **criterion 8** — by wiring the target-side `drop` to a new `tab-adopt-by-drop` IPC
that reuses the existing `moveTabIntoWindow` core (DD1). Includes the DD2 authority ruling
(provenance gate) and the source-side reconciliation (no false "move failed" announce after a
successful adopt).

## Context

Risk: **HIGH** — new IPC surface with an authority question (DD2), a cross-window announce/ordering
seam, and a change to the `dragover` accept-gate that must not regress same-window reorder. Design
review before implementation.

**Reuse (verified against current code):**
- `moveTabIntoWindow(source, p, resolveTarget, allowSoleTab)` (`main.js` ~2876) — re-parent core; DD1
  synchrony pin (`move-tab-synchrony.test.js`); sends `tab-moved-away` to the source chrome; queues
  `adopt-tab` + `tab-nav-state` to the target; closes an emptied source when `allowSoleTab` (the F10 L3
  consolidate ruling).
- `validateMoveTabPayload` / `buildAdoptPayload` (`main.js` requires from `src/main/move-tab-payload.js`).
- The drag payload set at `dragstart` is ALREADY the exact `MoveTabPayload` shape
  (`{wcId,url,title,favicon,container}`).
- `moveOutcomeMessage(result, dest)` (renderer) — the DD5-total announce map; reused verbatim with a
  new dest phrase.
- Closest authority analog: `tab-move-to-window` (`main.js` ~3059) — target-from-payload, source-from-sender.
  **This leg inverts it** (source-from-payload, target-from-sender), which is exactly the DD2 weakening.

**Verified gap this leg must close (source-side reconciliation):** after a successful adopt, the
source's `dragend` fires `requestTearOff` (release read as outside-strip; `dropEffect` is `none` even
on success — spike + probe6). Main replies `{ok:false, reason:'no-tab'}` (tab already moved), and the
`.then` currently announces the default-arm "Move to a new window failed" — a **false error on every
successful cross-window drag**. `tab-moved-away` (sent during the adopt) arrives at the source before
the tear-off reply on the source's own ordered pipe, so at `.then` time the local `tabs` map no longer
has the tab — that is the suppression key.

**Ordering assumption — RULED: accept-and-document (design review, FD concurrence).** The suppression
above assumes main processes the target's adopt invoke BEFORE the source's `tab-tear-off` invoke. Those
ride different pipes (no cross-pipe guarantee), but the adopt send strictly precedes the tear-off send
in wall-clock (the `drop` dispatch completes before the source's `dragend` fires — DnD spec ordering),
so a tear-off-first arrival is vanishing. If it ever happens: the tab tears off into an unexpected new
window C and the adopt then refuses `not-dragging` (C's record has no drag registration) — the target
announces a failure while the tab sits visible in C; the user re-drags. Recoverable, rare, accepted.
(Noted: the DD2 gate is what makes this race non-self-healing; the trade is accepted — the gate's
authority value outweighs a vanishing, recoverable race.)

## Design Decisions

**DD2 (flight) — RESOLVED: provenance gate (recommended; operator may downgrade to accept-as-is).**
The adopt payload names the SOURCE tab (`wcId`) — payload-supplied authority. Forgery vector: any guest
page can `setData()` our MIME with an arbitrary `wcId`; a user dragging from a hostile page onto a strip
would move one of their own tabs. Blast radius is benign (single-user desktop, own tabs, physical gesture
required) but the project's authority doctrine (DD8 lineage: "the payload does not get to name it") argues
for closing it cheaply:
- `dragstart` (chrome) → `ipcRenderer.send('tab-drag-started', wcId)`; main verifies the SENDER's window
  owns that wcId (`getWindowForChrome(sender).tabViews.has(wcId)`) and records it on the source's window
  record (`rec.dragWcId = wcId`).
- `dragend` (chrome) → `send('tab-drag-ended', wcId)`; main clears `rec.dragWcId` on a **short grace
  timer (~1500 ms)** — NOT immediately — because the target's adopt invoke and the source's drag-ended
  ride different IPC pipes with no cross-pipe ordering guarantee; an immediate clear could race a
  legitimate adopt into refusal. A fresh `tab-drag-started` cancels any pending clear.
- `tab-adopt-by-drop` refuses unless the resolved source record's `dragWcId === p.wcId` (reason
  `'not-dragging'` → default announce arm). Guests cannot send `tab-drag-started` (chrome-only bridge),
  so a forged MIME payload dies here.
- **Refinement (design review): a successful adopt CONSUMES the registration** — clear `source.dragWcId`
  (and any pending grace timer) on the `ok` path; one drag = one drop, shrinking the post-success
  forgery window to ~0.
- **Registry mechanics (definitive, not conditional):** `checkJs` covers `src/**` and the `WindowRecord`
  typedef is closed — add `dragWcId` to the typedef in `src/main/window-registry.js` and seed it (`null`)
  in `create()`, or `rec.dragWcId = wcId` fails typecheck (AC8). The grace timer is **per-record** (a
  fresh `tab-drag-started` cancels only ITS OWN record's pending clear). A timer firing after
  `registry.remove` mutates an unreachable record — harmless; do not over-engineer a cancel-on-close.

**DD3 (leg) — target-side accept + append placement.** The target window's document `dragover` must
`preventDefault()` + `dropEffect='move'` for ANY goldfinch-tab drag (currently gated on its own live
`dnd`, so a foreign drag is never accepted and `drop` never fires). Zone/displacement logic stays
`dnd`-gated (source-window-only). The adopted tab APPENDS to the target strip (the existing `adopt-tab`
renderer path; no insertion-index plumbing this leg — parity with the keyboard/menu move). *(Noted for
HAT: only `#tabs` handles `drop` — a release over the target's toolbar/other chrome falls through to
the source's dragend → tear-off → new window, the same outcome as releasing over the desktop.
Behaviorally consistent, not a bug.)*

**DD4 (leg) — announce split.** The TARGET announces the outcome (it owns the authoritative reply):
`moveOutcomeMessage(result, 'this window')` on the invoke result. The SOURCE suppresses exactly the
`no-tab` refusal **when its local `tabs` map no longer has the tab** (adopted-elsewhere signature —
`tab-moved-away` already processed); a `no-tab` with the tab still present stays announced (true anomaly).
DD5's "silence is not an outcome" is honored — the outcome IS announced, in the window that did the move.

**DD5 (leg) — sole-tab drags consolidate.** `tab-adopt-by-drop` passes `allowSoleTab = true` (dragging
the only tab of A into B moves it and closes A — the F10 L3 menu-path ruling, same semantics).

## Acceptance Criteria

- [x] **AC1 — target `dragover` accepts foreign drags.** Document `dragover`: MIME guard first, then
      `preventDefault()` + `dropEffect='move'` unconditionally for the MIME; the zone/displacement body
      remains gated on this window's own `dnd`. Same-window reorder feel unchanged.
- [x] **AC2 — `drop` cross-window branch.** At the LEG 3 SEAM: when there is no live `dnd` (or the
      payload `wcId` is foreign), invoke `window.goldfinch.tabAdoptByDrop(payload)` and announce the
      result via `moveOutcomeMessage(result, 'this window')`. Same-window path untouched (`dropHandled`
      still set synchronously before any parse). **Null-`dnd`-own-tab guard (design review):** if `dnd`
      is null AND the payload `wcId` belongs to one of THIS window's own tabs, this is a mid-drag-canceled
      same-window release (popup `createTab`/tab-close ran `cancelDnd` under the live native drag) —
      silent no-op, do NOT invoke (main's `same-window` refusal stays as defense-in-depth).
- [x] **AC3 — `tab-adopt-by-drop` IPC (main).** `target = getWindowForChrome(event.sender)` (refuse
      `no-source`); `p = validateMoveTabPayload(payload)` (refuse `bad-payload`);
      `source = registry.getWindowForGuest(p.wcId)` (refuse `no-tab`); refuse `source === target`
      (`same-window` — renderer handles that as reorder; defense-in-depth); **provenance check per DD2**
      (`source.dragWcId === p.wcId` else `not-dragging`); then
      `moveTabIntoWindow(source, p, () => target, true)` and return the result verbatim.
- [x] **AC4 — provenance registration.** `tab-drag-started`/`tab-drag-ended` (chrome preload + renderer
      dragstart/dragend + main handlers with the sender-owns-wcId verification and the grace-timer clear).
      Window-record field cleaned up with the record (no leak on window close mid-drag).
- [x] **AC5 — source-side reconciliation (both orderings).** (a) `requestTearOff`'s `.then` suppresses
      the announce iff `result.ok === false && result.reason === 'no-tab' && !tabs.has(tabId)`; all other
      outcomes announce as today. (b) **`onTabMovedAway` silent-clear (design review):** when the departing
      `wcId` IS the live `dnd` session's tab, clear the session/visuals WITHOUT the "Move canceled"
      announce (per leg-DD4 the target owns the outcome announce) — otherwise `tab-moved-away` beating the
      source's own `dragend` produces a false "Move canceled" on a successful move, and the null-`dnd`
      dragend early-return means (a) alone never covers that ordering. No false announce in EITHER ordering.
- [x] **AC6 — preload + typings.** `tabAdoptByDrop` on the chrome bridge (invoke) + the two sends;
      `renderer-globals.d.ts` declarations.
- [x] **AC7 — tests.** In the project's source-scan/invariant idiom: pin the adopt handler's authority
      chain (source-from-payload resolved via `getWindowForGuest`, provenance check present,
      `allowSoleTab` true); pin AC1's unconditional preventDefault-for-MIME; pin AC5's suppression
      predicate (both directions). Pure logic extracted where the project's pure-module pattern fits
      (implementer's call on the exact split). **Existing-pin bumps (design review, both sanctioned by
      the suites' own procedures):** `move-tab-synchrony.test.js` pins the `moveTabIntoWindow` token
      count at exactly 4 in THREE assertions (~L273, ~L405, ~L524-530) — the new handler is a real 4th
      call site; bump 4 → 5 per the test's own failure-message instruction. `tab-drag-invariants.test.js`
      ~L414-415 pins exactly 2 `moveOutcomeMessage(result, '…')` call sites — bump 2 → 3 (update the
      message text) in the suite's mutation-controlled idiom. The synchrony PROPERTY (no await between
      delete/set) is untouched. Note: the new drop-branch code lands inside the invariants suite's
      `dragSection` scan bounds — keep it within the pinned shape.
- [x] **AC8 — gates green** (`npm test`, `lint`, `typecheck`).

## Out of Scope
- Insertion-index placement of the adopted tab (append-only this leg).
- Any drop-position indicator in the target strip.
- The behavior-spec apparatus switch — **Leg 4**.

## Files Affected
- `src/renderer/renderer.js` (dragover accept, drop branch, dragstart/dragend sends, requestTearOff
  suppression, onTabMovedAway silent-clear).
- `src/preload/chrome-preload.js` + `renderer-globals.d.ts` (bridge).
- `src/main/main.js` (adopt handler + registration handlers; update `moveTabIntoWindow`'s stale
  `allowSoleTab` JSDoc — "ONLY tab-move-to-window passes true" gains a second true-caller).
- `src/main/window-registry.js` (`dragWcId` in the `WindowRecord` typedef + seeded in `create()` — required, see DD2 mechanics).
- `test/unit/` per AC7 (including the two existing-pin bumps).

## Line Budget (DD11 — code lines)
- main.js ≤ +60; renderer.js ≤ +40; preload/typings ≤ +10. Exceed ⇒ stop and report.

---
## Post-Completion Checklist
- [x] ACs verified — code + tests (all 8; gates: 1973 pass / 0 fail, lint clean, typecheck clean).
      Criterion 8 LIVE (operator HAT with overlapping windows) is the flight-level gate, still owed.
- [x] flight-log leg entry; leg status per lifecycle (`landed`); flight.md leg checked
- [x] Do NOT commit (flight-end review + single commit) — honored; nothing committed
