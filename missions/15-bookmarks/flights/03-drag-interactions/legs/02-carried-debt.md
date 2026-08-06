# Leg: carried-debt

**Status**: landed
**Flight**: [Drag Interactions](../flight.md)

## Objective

Land the four Flight 2 carry-forward debt items the operator pulled into this flight — each mechanical, each with a binary acceptance criterion, none sharing a file with the automation gate.

## Context

Flight DD9, DD10.

**Why this is its own leg.** These four items were originally bundled into leg 1 alongside the automation gate. At leg-1 design review cycle 2, DD1f grew that leg's security surface to include `menu-overlay-manager.js`, `menu-overlay.js`, and the preload — and the operator ruled the debt items out into their own leg (2026-08-05) so the security diff stays reviewable on its own. None of the four touches a file leg 1 touches, so the split costs nothing; the flight batches review and commit at the end regardless.

**Why these four and not the other seven.** DD10's selection rule was *verification budget*, not edit locality — the Flight 2 debrief's sharpest process lesson is *"do not bundle work whose acceptance criterion is a rendered pixel into a leg whose acceptance criteria are unit-testable."* Every item here is mechanical. That is why **DD9 resolves to removal rather than a surface fix**: fixing `surfaceRejection`'s surface would mean restructuring the close-only-on-success round trip, which is a rendered-pixel criterion this flight has no reason to take on.

All four were verified `confirmed-live` against current `main` during the flight's reconnaissance pass (see the flight log's Reconnaissance Report) — none had been incidentally fixed, and no citation had drifted.

## Inputs

- Branch `flight/03-drag-interactions`. Leg 1 may or may not have landed — **this leg is independent of it** and shares no files.
- `bookmarks-client.js`: module header `:34-35`, `toast` constructor param `:49`, JSDoc `:181-190` and `:205`, `surfaceRejection` `:191-197`, call sites `:216`/`:220`.
- `register-overlay-ipc.js:573` closes the sheet *before* forwarding the submit to the chrome — the fact that makes the inline-sheet-error path structurally unavailable to `surfaceRejection`, and therefore the reason DD9 is a removal.
- `bookmarks-bar.js` is **already ESM** (`export function monogramLetter`, `:48`); constants `BAR_GAP` `:43`, `BAR_PADDING_X` `:44`, `CHEVRON_WIDTH` `:32`, all module-private.
- `styles.css`: `#bookmarks-bar` `gap: 2px` `:673`, `padding: 0 6px` `:674`, with the PINNED PAIR comment at `:667-672`; `#bookmarks-overflow` `width: 24px` `:767`, PINNED comment `:764-766`.
- `bookmarks-store.js`: stale "Preserved as an export" comment `:56-58`, constant `:59`, **live use** `:87`, dead export `:288`. Test pinning the dead export: `bookmarks-store.test.js:454-457`.
- `src/main/find-overlay-geometry.js` (note: **`src/main/`**, not `src/renderer/`) carries the retired-`#find-bar` claim at **both** `:6` and `:14-15`.
- `test/unit/csp-pins.test.js` is the source-scan test pattern — `readFileSync` a non-JS source and assert against it. `test/unit/tab-drag-invariants.test.js` is the sibling precedent.

## Outputs

- `surfaceRejection`, its `toast` dependency, and every `toast` reference in that module's prose removed; `renderer.js`'s construction site updated.
- `BAR_GAP`/`BAR_PADDING_X`/`CHEVRON_WIDTH` exported; a CSS↔JS pin test added.
- `DATA_IMAGE_RE`'s export, its test, and its stale comment gone; the constant kept.
- `find-overlay-geometry.js`'s dead mirror comment corrected at both sites.
- `CLAUDE.md:207` names the pinned pair.

## Acceptance Criteria

- [x] **AC1 (DD9)** — `surfaceRejection` (`bookmarks-client.js:191-197`), the `toast` constructor param (`:49`), and every `toast` reference in the module header (`:34-35`) and JSDoc (`:181-190`, `:205`) are removed. Both call sites (`:216`, `:220`) collapse to the existing `.catch(() => {})` shape and carry a comment naming the residual race as **unhandled**, and why: `register-overlay-ipc.js:573` closes the sheet before forwarding, so the inline-error path HAT FIX 1 built is structurally unavailable here. `renderer.js`'s `createBookmarksClient` call site drops the argument.
  - Correctness is unaffected either way — the cache's own `bookmarks-changed` re-derive already returns every surface to truth. What is removed is code that *claimed* to inform the user while writing to `#toasts`, which the guest `WebContentsView` covers.
- [x] **AC2 (DD10)** — `BAR_GAP`, `BAR_PADDING_X`, and `CHEVRON_WIDTH` are exported from `bookmarks-bar.js`. Publishing them does **not** touch the evaluate-seam closed set (that is `renderer.js`'s `Object.assign(globalThis, …)` tail), so no FD ruling is required — noted because CLAUDE.md's closed-set rule will otherwise give an implementer pause.
- [x] **AC3 (DD10)** — A source-scan test reads `styles.css` and asserts `#bookmarks-bar`'s `gap` (`:673`) and `padding` (`:674`), and `#bookmarks-overflow`'s `width` (`:767`), equal the exported constants. **Non-vacuous**: it throws rather than passing silently when a rule or declaration cannot be located, on `csp-pins.test.js`'s `extractCsp` model.
  - This is the item with real relevance to this flight rather than only to the backlog: leg 3's drag work touches the bar's layout math directly, and today changing `gap: 2px` → `4px` leaves the suite green while the chevron leaves the clipped box again — the defect that shipped through an entire flight undetected.
- [x] **AC4 (DD10)** — `DATA_IMAGE_RE` removed from `bookmarks-store.js`'s exports (`:288`); its test deleted (`bookmarks-store.test.js:454-457`); the now-false "Preserved as an export" comment (`:56-58`) corrected. **The constant (`:59`) and its live use in `sanitizeIcon` (`:87`) are kept** — only the export is dead.
- [x] **AC5 (DD10)** — `find-overlay-geometry.js`'s retired-`#find-bar` claim corrected at **both** `:6` and `:14-15`.
- [x] **AC6** — `CLAUDE.md:207`'s bar/overflow bullet names the CSS↔JS pinned pair. (The unobservable-surfaces list and the automation-gate documentation belong to leg 1's AC10 — do not duplicate them here.)
- [x] **AC7** — `npm test`, `npm run typecheck`, `npm run lint` green. Suite count recorded in the flight log.

## Verification Steps

- AC1 — `grep -n "surfaceRejection" src/renderer/chrome/bookmarks-client.js` returns nothing. (Deliberately narrowed from `toast`, which legitimately survives elsewhere in the renderer.)
- AC2, AC3 — mutate `gap: 2px` → `4px` in `styles.css`, confirm the suite goes **red**, revert. A pin test that never goes red is the failure mode here.
- AC4 — `grep -rn "DATA_IMAGE_RE" src/ test/` shows only `bookmarks-store.js:59,87` and `favicon-fetch.js:41,73`
- AC5, AC6 — read the diffs
- AC7 — `npm test`, `npm run typecheck`, `npm run lint`

## Implementation Guidance

1. **DD9 removal** — delete the function and the destructured `toast` param, simplify both `.then()` bodies, update `renderer.js`, and rewrite the prose. The prose matters as much as the code: three separate places currently describe a feedback mechanism that will no longer exist.

2. **Export the constants** — a one-line change; `bookmarks-bar.js` is already ESM and `require()`-able under Node 22.

3. **The pin test** — follow `csp-pins.test.js`: `readFileSync` the CSS, locate each rule block, extract the declaration, assert against the imported constant, and **throw** when a rule or declaration is missing so a markup drift fails loudly instead of making the comparison vacuously true.

4. **AC4** — scope the deletion to the export line, the test, and the comment. Do not touch `:59` or `:87`.

5. **AC5, AC6** — mechanical.

## Edge Cases

- **`toast` is still used elsewhere in the renderer** — AC1 removes it only from `bookmarks-client.js`'s constructor and prose. Do not chase other call sites; the toast layer's own invisibility is a mission-level known issue wider than this flight and is explicitly out of scope.
- **The CSS rules move** — the pin test must locate rules by selector, not by line number, or it becomes the drift it exists to catch.
- **A fourth constant is added later** — the test should fail loudly if `bookmarks-bar.js` exports a pinned-looking constant the test does not cover, or it silently under-pins. Implementer's discretion on whether that is worth the machinery; note the call either way.

## Files Affected

- `src/renderer/chrome/bookmarks-client.js` — `surfaceRejection`, `toast`, and their prose
- `src/renderer/renderer.js` — construction-site argument dropped (flight DD12 counts this line)
- `src/renderer/chrome/bookmarks-bar.js` — export three constants
- `src/main/bookmarks-store.js` — export line + stale comment
- `src/main/find-overlay-geometry.js` — comments at `:6` and `:14-15`
- `test/unit/bookmarks-store.test.js` — dead-export test deleted
- new: CSS↔JS pin test (file name implementer's discretion)
- `CLAUDE.md`

## Citation Audit

All citations verified against the working tree at `5aa4932` during leg design. The one correction inherited from leg 1's cycle-1 review is carried here: **`find-overlay-geometry.js` lives in `src/main/`, not `src/renderer/`**, and carries the stale claim at `:6` as well as `:14-15`.

| Citation | Status |
|---|---|
| `bookmarks-client.js:34-35`, `:49`, `:181-190`, `:191-197`, `:205`, `:216`, `:220` | verified |
| `register-overlay-ipc.js:573` | verified |
| `bookmarks-bar.js:32`, `:43`, `:44`, `:48` | verified |
| `styles.css:667-672`, `:673`, `:674`, `:764-766`, `:767` | verified |
| `bookmarks-store.js:56-58`, `:59`, `:87`, `:288`; `bookmarks-store.test.js:454-457` | verified |
| `src/main/find-overlay-geometry.js:6`, `:14-15` | verified (path corrected) |
| `favicon-fetch.js:41`, `:73`; `CLAUDE.md:207`; `csp-pins.test.js` | verified |

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [ ] **Do NOT commit** — this flight batches review and commit after the last autonomous leg
