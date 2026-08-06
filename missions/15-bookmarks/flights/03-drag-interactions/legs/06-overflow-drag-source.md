# Leg: overflow-drag-source

**Status**: landed *(gate passed — operator session 4)*
**Flight**: [Drag Interactions](../flight.md)

## Objective

Make overflow-menu rows a **drag source**, completing mission criterion 6's "in both directions" clause: dragging a row out of the overflow menu onto the bar reorders it there.

## Context

Flight DD2, DD3, DD4, DD8. **This is leg 5b of a split** (operator ruling, 2026-08-05, after design-review cycle 2). The seam is the transport measurement, not convenience:

- **5a's transport is measured.** Session 3: a sheet opened mid-drag receives 23 `dragenter` / 200 `dragover` / 2 `drop`, custom MIME intact.
- **5b's is not.** A drag *started inside the sheet* is a different question, and the sheet has **no drag source in existence** today (`grep draggable src/renderer/menu-overlay.js` → nothing).

**GATE PASSED — operator session 4, 2026-08-06.** The closing probe measured **sheet → chrome: 54 `dragover`, 1 `drop`, `application/x-goldfinch-bookmark | chromium/x-drag-id` intact**. This leg exists and criterion 6's both-directions clause needs no renegotiation. *(Original conditional framing:)* ~~This leg does not begin until the probe returns a verdict; a negative verdict means it does not exist.~~

### The probe's second question is what makes this leg safe

**MEASURED (session 4): `dragend` DOES fire in the sheet** — `data-gf-sheet-dragstart="1"`, `data-gf-sheet-dragend="1"` — despite the blur-close → `hide()` → `removeChildView`. So the lifecycle gate has a **real clear signal**, and AC3's timer bound is **defence-in-depth against a path that fails to clear, not the sole recovery**. Keep both the bound and the never-send-`end` test.

*(Why the probe asked:)* it counts sheet-side `dragstart`/`dragend`, not only chrome-side delivery, because **`dragend` might never have fired in the sheet**: it is blur-closed at drag start (`window-factory.js:324`) → `hide()` → `removeChildView`, and the `menu` template's `onClose` hides `menuNode` (`menu-overlay.js:162-165`), leaving the source button `display:none` in a detached view. If `dragend` does not arrive, an unbounded lifecycle latch would leave `dragActive` true forever — freezing both `render()` (`bookmarks-bar.js:478`) and `onResize()` (`:453`) for the rest of the session with no recovery. **The gate is therefore timer-bounded regardless of the verdict** (AC3).

## Inputs

- `overflow-drop-target` landed: spring-loading, the sheet's y-axis drop-index/indicator module, the bar → overflow commit, the drop-index channel with its menuType-gated main-side handler, and the `visibleCount` capture.
- **Leg 3's handlers bail on a foreign drag**: `dragover` `bookmarks-bar.js:553` and `drop` `:565` both `if (!dnd) return`, and `slotRects`/`barRect` are only ever captured inside a *local* `dragstart` (`:371-387`).
- `dropIndexFromPointer` (`tab-order.js:107-118`), `moveIndex` (`:34-52`), `commitReorder` (`bookmarks-client.js:262-263`).
- `overflowSheetModel` sends `{id: 'bookmark:<i>', label}` only (`bookmarks-bar.js:129-131`) — the sheet does **not** know a bookmark's real id or url.

## Acceptance Criteria

- [ ] **AC1 — sheet rows are drag sources, gated to `bookmarks-overflow`.** `renderMenu` (`menu-overlay.js:179-262`) is shared by `kebab`, `container`, `page-context`, `tab-context`; an ungated `draggable = true` would make every one of those rows draggable. The per-row `contextmenu` at `:246` is the precedent.
- [ ] **AC2 — what the sheet-sourced drag carries, decided and recorded.** The sheet knows only a snapshot index. Either extend `overflowSheetModel` with the real bookmark id, or put the snapshot index in `BOOKMARK_DND_MIME` and resolve chrome-side. **The latter preserves DD9's snapshot-index dispatch but means an overflow-sourced drag cannot populate `text/uri-list`/`text/plain` — so drag-from-overflow-onto-a-page (leg 4) would not work.** State the choice and its asymmetry; do not discover it at HAT.
- [ ] **AC3 — the drag-lifecycle channel is timer-bounded.** Sheet → chrome `start`/`end` signals, carrying the same menuType/token/`recordForSheetSender` guards 5a established. **The chrome-side gate must expire on a timer even if `end` never arrives** — see Context; an unbounded latch freezes the bar for the session. Reuse leg 4's `DRAG_HOLD_MS` shape rather than inventing a bound.
- [ ] **AC4 — the chrome needs a foreign-drag session, which does not exist** *(design-review cycle-2 finding — the largest unwritten piece)*. Leg 3's handlers `return` on `!dnd`, and no slot geometry is captured outside a local `dragstart`. This leg must build a slot-rect snapshot at the AC3 "start" signal and add a foreign-drag commit branch to the document `drop` handler.
- [ ] **AC5 — overflow → bar reorders to the drop slot's full-list index**, and the boundary displaces something back into overflow (DD4; the bar's capacity is unchanged). **`dropIndexFromPointer`'s external-source case**: the dragged item is not in the bar's rect array, so `draggedIndex = -1`, which yields the correct plain insertion index — but the documented contract says "among the **remaining** slots," presuming the dragged slot is present. **Extend the JSDoc and pin the external-source case in `tab-order.test.js`**, so a future reader does not "fix" behaviour two features depend on.
- [ ] **AC6 — a bar-side drop indicator for the reverse direction**, or an explicit statement that there is none. 5a gives the sheet an indicator; without this, overflow → bar has **no drop feedback at all** — which is the defect the operator reported for the forward direction.
- [ ] **AC7 — the drag source must survive the sheet's close.** The sheet blur-closes at drag start; AC3's gate must suppress `closeOverflowIfOpen` for the duration, and the flush must include the deferred close (not just `render()` — `bookmarks-bar.js:407`).
- [ ] **AC8 — jar correctness**: the reorder targets the bar's rendered jar (`currentJarId`) captured at drag start, never the active tab's at drop time; the commit re-reads via `bookmarksGet` (DD6b).
- [ ] **AC9** — `npm test`, `npm run typecheck`, `npm run lint` green; suite count recorded. `renderer.js` within budget — **this leg carries the renderer/preload/globals fan-out and the headroom is ~52 lines**; DD12 forbids a raise.

## Verification Steps

- AC1, AC3, AC4, AC5's index math, AC7, AC8 — unit tests
- AC2 — read the decision and its recorded rationale
- AC5/AC6 rendered behaviour — HAT
- AC9 — the three gates

## Edge Cases

- **`dragend` never fires in the sheet** — AC3's timer bound is the recovery. Test it explicitly by never sending `end`.
- **The sheet closes mid-drag despite AC7** — gesture ends with no commit; a wrong visual, never a wrong write (leg 3's disposition of the same class).
- **The dragged row's bookmark is deleted mid-drag** — `moveIndex` no-ops on `indexOf === -1` and `commitReorder` returns false (`bookmarks-client.js:262-263`).
- **Drop lands back inside the sheet** — no-op, not a reorder-to-self.
- **Only one overflowed row** — dragging it out empties the overflow and hides the chevron; assert the chevron's `.hidden` follows.

## Files Affected

- `src/renderer/menu-overlay.js`, `menu-overlay.css` — drag source, gated to `bookmarks-overflow`
- `src/preload/menu-overlay-preload.js`, `src/main/register-overlay-ipc.js` — the lifecycle channel
- `src/renderer/chrome/bookmarks-bar.js` — foreign-drag session, commit branch, suppression
- `src/shared/tab-order.js` — external-source JSDoc; `test/unit/tab-order.test.js` — its pin
- `src/renderer/menu-overlay-globals.d.ts`, `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`, `src/renderer/renderer.js` — type + wiring fan-out

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with a leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] **Do NOT commit** — this flight batches review and commit after the last autonomous leg
