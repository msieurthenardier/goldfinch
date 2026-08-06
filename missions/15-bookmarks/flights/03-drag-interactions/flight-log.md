# Flight Log: Drag Interactions

**Flight**: [Drag Interactions](flight.md)

## Summary

All six autonomous legs landed (`automation-gate`, `carried-debt`, `bar-drag-reorder`, `drag-onto-page`, `overflow-drop-target`, `overflow-drag-source`) — all uncommitted, per this flight's batched review-and-commit. Suite 3558/0, typecheck and lint clean, `renderer.js` 1606/1650. Criterion 6's three clauses are all built, both directions of bar ↔ overflow included. Next: code review, then `hat-and-alignment` (every rendered/gesture half of legs 3–5b rides it).

---

## Reconnaissance Report

Flight 2's debrief enumerates eleven outstanding action items with code citations. Each was walked against current `main` before this flight's scope was set (skill Phase 1b). **All eleven are `confirmed-live`** — none were incidentally satisfied by intervening work, and no citation had drifted.

| Item | Classification | Evidence | Disposition |
|---|---|---|---|
| CSS↔JS pin test for `BAR_GAP`/`BAR_PADDING_X`/`CHEVRON_WIDTH` | `confirmed-live` | `bookmarks-bar.js:32,43,44` ↔ `styles.css:665-674`; matching PINNED-PAIR comments; no test references any of the three constants | **Pulled into leg 1** (DD10) |
| `validUrl` differential test | `confirmed-live` | `bookmark-edit-validate.js:22-24` still says "mirrors bookmarks-store.js's own `validUrl` predicate exactly (not imported)"; `bookmark-edit-validate.test.js` asserts behaviour, never diffs the pair | Not pulled — shares no surface with drag |
| `AUTHORING.md` budget-fixture rule + spec-authoring screens | `confirmed-live` | 247 lines; no budget-function or superseded-scoping guidance present | Not pulled — methodology work, belongs to mission-control |
| Name the pinned pair in `CLAUDE.md:207`; add unobservable-surfaces list | `confirmed-live` | no `PINNED-PAIR` or unobservable-surface text anywhere in `CLAUDE.md` | **Pulled into leg 1** (DD10); the list itself is **revised** by DD1 |
| Sheet-automation disposition | `confirmed-live` | `resolve.js:125-126` still refuses unconditionally; Flight 2 log:246 records it as still open | **Resolved as DD1** — the flight's opening decision |
| Nine deferred behavior specs | `confirmed-live` | six from Flight 1's landing note + three adjacent; Flight 2 leg 4 ran neither set | Not pulled — **third deferral, recorded as such**. The debrief is right that it is a leg's worth of work |
| Run the four vault specs (Flight 2 leg 1 extraction gap) | `needs-human-recheck` | cannot be verified from the repo — the question is whether a live run happened, not what the code says | Not pulled |
| `navigate()` fragment asymmetry | `needs-human-recheck` | runtime behaviour; not statically checkable | Not pulled |
| Retire dead `DATA_IMAGE_RE` | `confirmed-live` | exported `bookmarks-store.js:288`, zero importers (`favicon-fetch.js:41` carries its own copy); `bookmarks-store.test.js:454` pins the dead export | **Pulled into leg 1** (DD10) |
| Fix or remove `surfaceRejection` | `confirmed-live` | `bookmarks-client.js:191-197` intact, `toast` still wired, both call sites at `:216`/`:220` | **Pulled into leg 1 as removal** (DD9) |
| `find-overlay-geometry.js:14-15` dead CSS mirror comment | `confirmed-live` | comments still cite `#find-bar`'s `top: 8px` / `right: 12px` | **Pulled into leg 1** (DD10) |

Plus the debrief's explicit Flight-3-design instructions (item 12 in its action list), all dispositioned in the flight artifact: index-vs-id dispatch for the overflow snapshot → deferred into leg 4 by design; `bookmarkReorder` treated as unproven → DD7; the `renderer.js` budget question → DD12 (**62** lines headroom; the first draft of this line said 63, from `wc -l`, reproducing the exact defect the debrief warned about — corrected at design review, see cycle-1 item 10).

**Operator confirmation** (planning session, 2026-08-04): four items pulled forward, the rest left in the backlog. No classifications overridden.

---

## Leg Progress

### Leg 1 — `automation-gate`
**Status**: landed
**Completed**: 2026-08-05

#### Changes Made

**The gate itself (DD1/DD1a/DD1b/DD1d).** `resolve.js` gains an exported `AUTOMATABLE_MENU_TYPES` (`bookmarks-overflow`, `bookmark-edit`) and guard 3 becomes conditional: the sheet is admitted iff `allowSheet === true && typeof sheetMenuFor === 'function' && AUTOMATABLE_MENU_TYPES.has(sheetMenuFor(wc)?.menuType)`. Both halves are allowlists; the thrown code and the admin-does-not-lift-it property are unchanged. The two comments the leg specified were added at the guard — the fixed-app-authored-snippet-vs-caller-code distinction (so `readDom`'s `executeJavaScript` does not read as incoherent), and the **corrected** jar-tier note (`out-of-jar` from the session-identity compare, *not* guard 5 — `memberDeps()` threads neither predicate).

**Threading.** `window-registry.js` gains `sheetMenuFor(wc)` beside `isSheetContents` — same `records()` walk, same defensive `typeof` guards, returning `null` when the matching sheet is not `isVisible()`. `engine.js` takes it in the options bag and conditional-spreads it onto `base`; `deps()` gains its one argument, `{ allowSheet }`, and exactly three dispatch entries pass `deps({ allowSheet: true })`. Wired at **both** `createEngine` sites.

**Snapshot + post-await re-check (DD1b).** `observe.js` gains module-private `sheetMenuSnapshot` / `assertSheetMenuStable`. All three admitted ops snapshot after their first `resolveContents` and re-check after their async work — `captureScreenshot` after `withCaptureTimeout`, `readDom` after its `executeJavaScript` (which now `await`s rather than returning the promise), `readAxTree` after `withDebuggerSession` returns (never between its entry and its internal detach). `null → null` is not a mismatch; `token` is compared alongside `menuType`; the re-check applies unconditionally, including on the `debugger-unavailable` early return. The `Accessibility.enable`-with-no-`disable` residual is named in `readAxTree`'s comment as the leg asked.

**DD1f eager scrub.** New main→sheet channel `menu-overlay:close` (`deliverCloseReset()` in `menu-overlay-manager.js`, `onCloseReset` in the sheet preload + its `.d.ts` entry, a handler in `menu-overlay.js` running `report.silence()` then `menuController.closeAll()`). `closeMenuOverlay` emits it **first**, ahead of `hide()` and channel 7, so it is queued to the sheet before any later open's init. The module header's *"there is deliberately NO main→sheet close channel"* rule is reversed in place with the reasoning recorded. `<body>` attributes untouched.

**DD1c.** `captureWindow`'s sheet layer is gated on the same predicate — `AUTOMATABLE_MENU_TYPES` **imported** from the resolver, never re-typed — with the existing post-await check extended to re-evaluate the menuType alongside `isVisible()`.

**Tests (+35).** `automation-resolve.test.js` — the two absoluteness pins re-targeted and renamed (not deleted), plus six new gate tests including the fail-closed-shape assertion (a refusal, and explicitly *not* a `TypeError`). New `automation-sheet-gate.test.js` — the `WCID_FIRST_OPS` sweep (per-op valid-args table asserted equal to the op list, mixed throw shapes normalized, 20 refusals + the 3 admits), AC4's two-layer jar assertion, and nine AC5 re-check cases. New `sheet-automation-gate-invariant.test.js` — AC7's `main.js` source scan, AC8's `onClose`-enclosure + enumerated-early-return scans, the DD1f channel/preload pins, and AC9's dual-site grep. `menu-overlay-manager.test.js` +7 DD1f pins.

**Docs (AC10).** `CLAUDE.md` — the sheet-gate bullet in *Automation engine*, the DD1f bullet in *Menu-overlay sheet*, and the new **standing unobservable-surfaces list** (sheet = readable-but-not-scriptable with the axe consequence spelled out; toast layer wholly unobservable). `docs/vault.md` — the "every tier, admin included" paragraph rewritten as the two-allowlist rule, with the whole-window-pixel parenthetical **reversed**: it previously *accepted* that path, DD1c closes it, and the doc now says closed-not-accepted. `docs/mcp-automation.md` — a new sheet-gate bullet in the admin-relaxations section plus a correction on the overlay-views bullet (the probe walk is not a reliable sheet-discovery instrument under the gate; prefer `enumerateWindows`' `sheetWcId`; the read is self-gating).

#### Deviations

1. **DD1f extended to `openMenu`'s model-replace branch (an addition, not a reinterpretation).** AC6 names `closeMenuOverlay` only, and that path is implemented and pinned exactly as written. But `openMenu`'s model-replace is *also* a close — it emits channel 7 and `onClosed` with `reason:'superseded'`, and never calls `closeMenuOverlay` — so with only the specified half, a `vault-recovery-show` card superseded by the bookmarks-overflow chevron would leave its `textContent` resident in exactly the window DD1f exists to remove, with `currentMenu` already naming an admitted menuType. `superseded` is in the leg's own enumerated set of main-initiated closes and AC6's plain text says *"after any close"*, so the branch was covered. It is **gated on a menuType change**: an unconditional scrub there would null `menuController.current` and break `menu-overlay.js`'s in-place downloads repaint (hide flash, stolen focus), and a same-menuType replace cannot leak across a trust boundary — the residue is the same card's own prior model.
2. **AC9's comment states the corrected fail-open direction.** The AC asked for a comment recording that adding `isSheetContents` to the dev seam *without* `sheetMenuFor` "would be the fail-open edit". Verified against the code, that combination is fail-**closed**: guard 3's predicate requires the reader, so it would refuse the sheet absolutely there (a silent divergence from the MCP engine, not an opening). The genuine fail-open edit at that seam is adding `allowInternal: true` — or dropping `isTabViewWcId` — while `isSheetContents` is still absent, which lifts guard 5 with nothing for guard 3 to fire on. The comment records both directions. Transcribing the AC verbatim would have repeated exactly the defect cycle-1 review caught (a false mechanism written into a security comment), so it was corrected rather than copied.
3. **One collateral test narrowed.** `menu-overlay-manager.test.js`'s *"close before load clears the queued init"* asserted "no send at all"; the DD1f scrub is a send. Narrowed to the `menu-overlay:init` channel with the reason in a comment — the subject (no stale seed against a closed menu) is unchanged.

#### Anomalies

None blocking. One **residual recorded for the flight-end Reviewer**: the eager scrub narrows the residue window to IPC ordering, exactly as DD1f's own reasoning does — the scrub message is *queued* ahead of a later read, but `webContents.send` and `executeJavaScript` are not formally ordered against each other in Electron. This is not specific to the model-replace half; it is the same assumption DD1f rests on for the ordinary close path. Called out here so the Reviewer evaluates it once rather than rediscovering it; the operator session's live co-residency check across both admitted menuTypes is the empirical half.

#### Suite

**3394 pass / 0 fail**, ~3.3 s. Measured on the combined tree, so it includes leg 2's work: leg 2 recorded 3359 from the **3356** baseline (+3), and leg 1 contributes the remaining **+35** — `automation-resolve.test.js` +6, `automation-sheet-gate.test.js` +14, `sheet-automation-gate-invariant.test.js` +8, `menu-overlay-manager.test.js` +7. All additive; no test deleted. `npm run typecheck` and `npm run lint` are clean project-wide — this closes the two `TS2559` errors leg 2's entry observed in `observe.js` (`:197`, `:213`), which were this leg's `deps()`/`sheetMenuFor` threading caught mid-edit.

#### Not done here (by design)

The DD8 axis-(b) probe, DD1e's live co-residency check across both admitted menuTypes, the two `vaultInput.value` residue checks, and AC7's live `vault-unlock` confirmation are the **operator session** that closes this leg — not acceptance criteria. Not committed: this flight batches review and commit after the last autonomous leg.

### Leg 2 — `carried-debt`

**Status**: landed
**Started**: 2026-08-05
**Completed**: 2026-08-05

#### Changes Made

- **AC1 (DD9)** — `surfaceRejection` deleted from `bookmarks-client.js` along with the `toast` constructor param; both `handleEditSubmit` call sites collapsed to bare `.catch(() => {})`. The JSDoc now names the residual race as **unhandled** and why (`register-overlay-ipc.js:573` closes the sheet before forwarding, so HAT FIX 1's inline-error path is structurally unavailable from the chrome subscriber). Module header and `renderer.js`'s construction-site comment rewritten. `grep -ni "toast\|surfaceRejection" src/renderer/chrome/bookmarks-client.js` → no hits: the word is gone from the module entirely, not only the function.
- **AC2 (DD10)** — `BAR_GAP`, `BAR_PADDING_X`, `CHEVRON_WIDTH` exported from `bookmarks-bar.js`, each with a comment stating the export exists for the pin test and does not touch the evaluate-seam closed set.
- **AC3 (DD10)** — new `test/unit/bookmarks-bar-css-pin.test.js` (5 tests). Source-scans `styles.css` on `csp-pins.test.js`'s `extractCsp` model: comments stripped first, rules located **by selector** with an exact-selector-list match (so `#bookmarks-bar .bm-item` can never answer for `#bookmarks-bar`), and `ruleBlock`/`declaration`/`px` all **throw** on a missing rule, missing declaration, or a non-`px` value. A sixth test pins non-vacuity by asserting those throws.
- **AC4 (DD10)** — `DATA_IMAGE_RE` dropped from `bookmarks-store.js`'s `module.exports`; the pinning test in `bookmarks-store.test.js` deleted; the stale "Preserved as an export" comment corrected. **The constant and its live use in `cleanIcon` are untouched.** `grep -rn "DATA_IMAGE_RE" src/ test/` now shows only `favicon-fetch.js:41,73`, `bookmarks-store.js:56,61,89` (comment + constant + live use) and the tombstone comment in the test.
- **AC5 (DD10)** — `find-overlay-geometry.js` corrected at both `:6` and `:14-15`. The retired-`#find-bar` mirror claim is replaced by the true statement: these margins are the module's own authority; `find-overlay.css`'s own `#find-bar` sets no `top`/`right`, so nothing mirrors them and no CSS rule can drift under them.
- **AC6** — `CLAUDE.md`'s bar/overflow bullet now names the PINNED CSS↔JS PAIR (both directions, the defect it prevents, the test that makes it red, the no-FD-ruling note, and the under-pinning guard). Leg 1's unobservable-surfaces list and automation-gate documentation were deliberately **not** touched.

#### Verification

- **The pin test was proved capable of failing, per the leg's Verification Steps** — and not only for `gap`. All three pins were mutated one at a time in `styles.css` (`gap: 2px`→`4px`, `padding: 0 6px`→`0 8px`, `#bookmarks-overflow width: 24px`→`28px`) and each produced exactly one `not ok` with the drift message naming both sides. `styles.css` reverted to clean via `git checkout` after each; `git diff src/renderer/styles.css` is empty.
  - Worth recording for whoever next writes a pin test here: the first width mutation was applied with a naive string replace and silently hit `.star-btn`'s identical `width: 24px; height: 24px;` block instead — the test correctly stayed green, and a less careful check would have concluded the chevron pin could not fail. The mutation must be anchored on the selector, the same way the test itself is.
- **AC7** — `npm test`: **3359 pass / 0 fail** (13 suites) against the 3356 baseline, **+3 net**: −4 toast tests, −1 `DATA_IMAGE_RE` export test, +3 replacement tests in `bookmarks-client.test.js`, +5 new pin tests. `npm run lint` clean.

#### Notes

- **`npm run typecheck` is NOT clean on the working tree, and none of it is this leg's.** Two `TS2559` errors, both in `src/main/automation/observe.js` (`:197`, `:213`) — leg 1's in-flight `deps()`/`sheetMenuFor` threading, mid-edit at the time of this run. No error touches any file this leg changed. Leg 1 owns closing these; the flight-end Reviewer should confirm a clean project-wide typecheck before commit rather than trusting this entry.
- `renderer.js` is still **1588** lines (`split(/\r?\n/)` metric): the DD9 argument line went, the construction-site comment gained one line and lost one. DD12's 62-line headroom is unchanged.

#### Deviations

- **`test/unit/bookmarks-client.test.js` was edited; the leg's "Files Affected" does not list it.** Four tests there pinned `surfaceRejection`'s toast copy and its tolerance of a missing `toast` dependency — removing the feature necessarily breaks them, so the AC7 green-suite criterion could not be met without touching the file. Rather than deleting them outright they were replaced by three tests pinning the DD9 *end state*: a resolved `{ ok:false }` is a silent no-op that still forwards the mutation, a genuine IPC rejection stays swallowed, and a source scan asserting `surfaceRejection` appears nowhere in the module (which is the leg's own AC1 verification step, promoted from a manual grep into the suite). Net −1 test, coverage of the collapsed call sites retained.
- **AC1's prose instruction was read strictly.** The AC asks that "every `toast` reference in the module header and JSDoc" be removed, while also requiring a comment explaining *why* the race is unhandled — and the honest explanation involves the surface that was removed. Resolved by keeping the full rationale but describing the removed surface generically ("a chrome-DOCUMENT one, which the guest `WebContentsView` is layered OVER"), so the module is literally free of the token while losing none of the reasoning. The identifier `#toasts` was dropped for the same reason.
- **The leg's Edge Case "a fourth constant is added later" was resolved as *worth the machinery*** (the leg left it to implementer discretion, asking only that the call be noted). One extra assertion scans `bookmarks-bar.js` for `export const NAME = <number>` and requires the set to equal exactly the three pinned names — so adding a fourth pinned-looking export forces a decision instead of silently under-pinning. Cost: one test, one regex.

---

### Leg 3 — `bar-drag-reorder`

**Status**: landed
**Started**: 2026-08-05
**Completed**: 2026-08-05

#### AC1 (DD7) — the `bookmarkReorder` path, VERIFIED LIVE, before any drag UI was built on it

**Not blocked. The rig was available and the verification is real.** Run as the leg's first action, against the app launched
`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --ozone-platform=x11`, key taken from the `AUTOMATION_DEV_MINT` stdout line, connected through `scripts/lib/mcp-client.mjs`'s `connectAutomation()`, admin tier proven by a successful `getChromeTarget`. Reorders were issued by `evaluate` on the chrome calling `window.goldfinch.bookmarkReorder` / `bookmarksGet` directly — no seam entry needed, the bridge is on `window`.

**The bound port was 49709, not 49707 — again.** Operator Session 2's apparatus note held exactly: nothing in the launch log prints it, `ss -ltnp` found it, and a 49707 guess would have produced a bare `UND_ERR_CONNECT_TIMEOUT`. Both of this leg's live sessions bound 49709.

| DD7's specifically-unverified claim | Result |
|---|---|
| A chrome-issued reorder **persists** | ✅ re-read through a fresh `bookmarksGet` returned the new order |
| **Gap-free `0..n-1`** survives a real round trip | ✅ and stronger than asked — the live `personal` jar held a **pre-existing position gap** (10 and 11 absent from a 13-row list, an artefact of prior sessions' read-time-dropped rows), and the reorder **normalised it** to a clean `0..12` |
| The transaction **commits** rather than silently rolling back | ✅ the change was visible to a subsequent independent read |
| Broadcasts `bookmarks-changed { jarId }` | ✅ exactly one, `{"jarId":"personal"}` |
| Re-renders the bar through the existing **jar-filtered `onChanged`** path | ✅ verified in a second pass — the first reorder targeted `personal` while the active tab was in `disposable`, so the bar (correctly) did not repaint. Re-run against the **active tab's own jar**: bar labels went `["Example Domain","BAR …-1","BAR …-2"]` → `["BAR …-2","Example Domain","BAR …-1"]` with no code path other than the broadcast |
| `unknown-jar` does **not** fire spuriously | ✅ `{ok:true}` on every legitimate jar; `{"ok":false,"reason":"unknown-jar"}` only for a fabricated id, so the rejection is live and correctly aimed |

**The composed pair was exercised too, not the store alone** (the design review's first HIGH). `dropIndexFromPointer` was called on a real 3-slot geometry, its answer fed straight to `moveIndex` as `toIndex`, and the resulting id list sent as the payload — the store's returned order matched the computed one exactly. `moveIndex`'s same-array-reference no-op was confirmed live for both the `from === to` case and the absent-id case. **No contradiction with the unit tests was found; nothing was escalated.**

Fixture bookmarks created for this were removed at the end of each pass.

#### Changes Made

- **`src/shared/bookmark-drag.js` (new, AC2)** — pure, Electron-free, no DOM. Exports `BOOKMARK_DND_MIME`, `visibleSlotRects`, `classifyBookmarkDrop`, `isInsideBar`, `indicatorX`. `dropIndexFromPointer` is **imported unchanged**; the midpoint rule is not re-derived (a test asserts both the import line and the absence of a re-derivation). The header states the DD3 fact in full — visible index *is* full-list index because the hide is a strict tail, so there is no translation to write — and names the inverse requirement the filtering exists for.
- **`bookmarks-bar.js`** — `draggable` items with `dragstart`/`dragend`; document-level `dragover`/`drop`; the session snapshot; the insertion indicator; one `dragActive` gate consulted by **both** `render()` and `onResize`, flushed by exactly one `render()` in `dragend`.
- **`bookmarks-client.js`** — `commitReorder(jarId, bookmarkId, toIndex)`: fresh `bookmarksGet` → `moveIndex` → `bookmarkReorder`, skipped on the same-reference return.
- **`styles.css`** — `#bookmarks-bar { position: relative }` (the AC5 prerequisite) and the `.bm-drop-indicator` rule.
- **Tests** — `test/unit/bookmark-drag.test.js` (new, 22); +14 in `bookmarks-bar.test.js`; +9 in `bookmarks-client.test.js`; +2 in `bookmarks-store.test.js` (AC10).

#### Verification beyond the unit suite

The app was relaunched on the finished code and driven through the whole handler chain with **real `DragEvent`/`DataTransfer` objects**, which gives the parts no offline test in this repo can reach (there is no jsdom harness; every layout number in a renderer unit test is asserted by the author):

- **AC3 live** — all `.bm-item` elements are `BUTTON` with `draggable === true`, computed `-webkit-user-drag: element` (nothing is blocking the source). This is the codebase's first draggable `<button>`, so it was checked rather than assumed.
- **AC5 live, the premise and not just the rule** — `#bookmarks-bar` computes `position: relative`, `overflow: hidden`, `height: 30px`; the indicator computes `position: absolute`, `width: 2px`, `transition-duration: 0s`, `animation: none`. Item and bar rects were snapshotted **before and while the indicator was shown** and came back byte-identical (`[[7,137.45],[146.45,101.23],[249.69,102.31],[354,108.5]]` both times, bar height 30 both times). That is the actual claim AC5 rests on — the indicator reflows nothing, so the dragstart snapshot the drop commits against stays valid — measured rather than argued.
- **The chain end to end** — `dragstart` armed all three DD2 types; `dragover` was `defaultPrevented` and positioned the indicator (rect `[461.5, 2, 23]` — inside the 30px row); moving out of the bar retracted it; `drop` committed a **real** reorder through the live store (`["Example Domain","Drag alpha","Drag bravo","Drag charlie"]` → `["Drag alpha","Drag bravo","Drag charlie","Example Domain"]`, positions `[0,1,2,3]`), the bar repainted to match, and the indicator was hidden after `dragend`.
- **AC4 live** — a drop back into the original position left the order unchanged and produced **zero** `bookmarks-changed` broadcasts.

#### Gates

`npm test` **3441 pass / 0 fail** against the **3394** baseline (**+47**: 22 new pure-module tests, 14 bar, 9 client, 2 store). `npm run typecheck` clean. `npm run lint` clean. `renderer.js` unchanged at **1588** lines — DD12's 62-line headroom is fully intact, because the leg needed **no** renderer glue at all.

#### Operator Session 3 — 2026-08-05 — DD8 axis-(b): **VIABLE** (measured) + DD5b baseline: **default does NOT navigate**

Two verdicts, both measured, both reversing an earlier expectation. Rig: X11-forced, port **49709 again** (the session-2 apparatus note held a second time — `ss -ltnp` remains the only way to find it).

Fixtures were already ideal from prior work: bar visible, 10 bookmarks in the `personal` jar, 8 visible / 2 overflowed, and — for the first time — **every `.bm-item` reporting `draggable: true`**, leg 3's work live.

### DD5b — Chromium does NOT auto-navigate on an un-consumed URL drop

**Method**: an **observe-only** guest probe — deliberately *no* `preventDefault()`, because calling it would suppress the very default under test. (The opposite rule from the sheet probe, and inverting them would have produced a confident wrong answer.)

**Result**: `dragenter 4`, `dragover 29`, **`drop` absent**, no navigation, bar order unchanged.

**Mechanism, and it is textbook**: `drop` never fires unless something `preventDefault()`s `dragover`. Neither our passive probe nor `google.com` did, so the browser rejected the drop and there was no default to observe. Real Chrome navigates URL drops at the **browser-shell** level, above the page; Electron supplies the renderer but not that shell behaviour.

**Consequence**: `drag-onto-page` is a **real leg**, not a gap-fill. DD5/DD6's path must be built as specified. The DD5b branch in which that leg is empty does not obtain.

### DD8 axis-(b) — VIABLE. The session-2 verdict is fully reversed.

**Two operator corrections, in sequence, are what produced this** — the first invalidated session 2's stimulus, the second invalidated this session's first gesture:

1. *"why are we talking about tabs? are you going to use the same mechanism for the bookmarks?"* — session 2 used a **tab** as the drag source, carrying tear-off machinery (a 260×28 pill raised via `addChildView` mid-drag) no bookmark drag has. Leg 3 now supplies a real draggable bookmark item, removing the defect.
2. *"it should open when I hover over the chevron with the [item] I'm dragging"* — the intended interaction is **spring-loading**, not "drag into an already-open menu." Every probe up to that point measured a gesture the product does not have.

**Run A (pre-opened menu, incl. a `dismissible: false` variant)**: the overflow panel closes at drag start regardless — `dismissible: false` did **not** hold it open, so the closer is something outside the three soft dismiss reasons. Zero sheet counters. **Operator judgement: the menu closing at drag start is *desired* behaviour**, which retires this shape entirely rather than making it a defect to fix.

**Run B (spring-loaded chevron, instrumented)** — the real interaction:

| Surface | dragenter | dragover | drop | payload |
|---|---|---|---|---|
| Chevron (chrome) | — | **65** | — | — |
| **Sheet, opened MID-DRAG** | **23** | **200** | **2** | `text/plain \| text/uri-list \| application/x-goldfinch-bookmark \| chromium/x-drag-id` |

**A sheet opened during a live drag receives both `dragover` and `drop`, with all three of leg 3's DD2 MIME types intact — including the custom bookmark type.** The operator's *"nothing happened"* on release is exactly correct and is **not** a negative: there is no drop **handler** in the sheet. That is `bar-overflow-drag`'s work.

**Verdict: axis (b) is VIABLE. Mission criterion 6 stands as written — no renegotiation, and `bar-overflow-drag` is not dropped.**

### Design findings for `bar-overflow-drag` (operator-sourced, not inferred)

1. **Spring-loading is required and is first-class.** Hovering the chevron mid-drag must open the overflow menu (the Chrome/Finder folder-target idiom). It does not today. Without it the drop target is unreachable, whatever the transport does.
2. **The sheet needs its own placement indicator.** Leg 3 built the bar-side one only; the operator reported no indicator inside the menu, so a drop position there is currently unguessable.
3. **The menu SHOULD close at drag start** (operator ruling) — so the design is spring-open-on-hover, not keep-open-through-drag. This also means the still-unidentified closer is *not* a defect to chase.

### Methodology — the honest record

The session-2 verdict would have dropped a mission criterion on a reading that was wrong twice over: wrong drag source **and** wrong gesture. Flight 1's rule (*"a negative probe result is a hypothesis about the probe"*) was applied to the *measurement* both times — six refutation hypotheses, a positive control — and still missed both, because neither "is the stimulus representative?" nor "is this the gesture the product actually has?" was part of the ritual. **Both belong in it**, and both were caught by the operator rather than by the audit. This is the flight's most important methodology finding.

### Cleanup

All instrumentation removed: the sheet probe, the spring-load chevron probe, and the `dismissible: false` variant. Verified — the only surviving `dismissible: false` occurrences are the pre-existing vault/capture sheets. Gates after removal: **3441 pass / 0 fail**, typecheck and lint clean. App stopped.

### Incidental state

The operator reordered several `personal`-jar bookmarks while testing — real use of leg 3's shipped feature, not test debris.

### Still outstanding

- [ ] **DD1e residue checks** — `vaultInput.value` at `menu-overlay.js:618` and `:668`; live co-residency read under both admitted menuTypes.
- [ ] **DD1c live confirmation** — `captureWindow` omitting the sheet layer under a live `vault-unlock`.

---

## Decisions taken inside the leg

- **The `dragover`/`drop` listeners went on `document`, not on `#bookmarks-bar`** — two independent reasons. (1) A bar-scoped `dragover` stops firing once the pointer leaves the bar, so it can never observe the `outside` zone and the indicator could not be retracted (`dragleave` is no substitute — it fires on every child-to-child transition). (2) `dragover` must `preventDefault()` for a drop to be delivered at all, and the payload carries `text/uri-list`; an unaccepted release anywhere on the chrome document would hand Chromium's default url-drop handling a chance to navigate the chrome frame itself. Accepting document-wide and swallowing an out-of-bar drop closes that. This is chrome-document only — the guest is a separate `WebContentsView`, so **DD5b's measurement target is untouched**.
- **AC12's trap was resolved by not springing it.** No new `export const <NUMBER>` was added to `bookmarks-bar.js`; the indicator's 2px width lives in `styles.css` alone and the JS positions by `left` only. The `bookmarks-bar-css-pin` exact-export-set assertion stays green without being edited, which is the outcome that guard was written to force a decision about.
- **`visibleSlotRects` poisons the whole array on an unreadable VISIBLE item** rather than skipping it. Skipping would shift every later index by one and commit a wrong move; returning `[]` resolves through `classifyBookmarkDrop` to `outside` — no reorder. An unreadable *hidden* item is harmless and is ignored.
- **The degenerate-input polarity is inverted from `tab-drag-zone.js`, deliberately.** There the destructive branch is `tearOff`, so an unreadable rect falls through to `reorder`; here the reorder **is** the write, so an unreadable rect falls through to `outside`. Same underlying rule (a failed measurement never spends the destructive outcome), opposite default. Stated in the module and pinned by a test so it does not read as an inconsistency.
- **Edge Case "tab switch mid-drag" bounded as the leg asked.** The jar is captured at `dragstart` and never re-resolved at drop time (the DD13 TOCTOU discipline). A `render(otherJar)` mid-session records the new jar but paints nothing; the `dragend` flush paints the current jar while the commit uses the captured one. Both halves are unit-pinned.

#### Deviations

- **`test/unit/bookmarks-store.test.js` was edited; the leg's "Files Affected" does not list it.** AC10's autonomous half is explicitly a store-level fresh-load assertion, and that is the file the `freshStore()` + `reloaded.load(...)` idiom lives in. Two tests added, none changed.
- **The bar test harness's `FakeElement` gained geometry (`_left`/`_top`, and `getBoundingClientRect` now returns `left`/`top`/`right`/`bottom`) and a `style` object; `FakeDocument` gained `addEventListener`/`fire`.** Additive — every pre-existing test read only `width` — but it is a shared fixture change rather than a pure addition. The fake now also reproduces the browser's zero-width-at-left-0 behaviour for `display:none`, so the AC2 overflow case is exercised against the real failure mode rather than a stipulated one.
- **AC11 was satisfied by assertion, not by a new guard, exactly as the leg directed.** The test asserts that a suppressed tab leaves the previous jar's `.bm-item` children **in the DOM** (the design review's correction) and that `#bookmarks-bar.hidden` is what makes no drag source reachable, plus a source scan proving no `burner`/`isInternal` branch was added to `bookmarks-bar.js`. `window-controller.test.js`'s existing `setBarSuppressed` coverage already pins the `.hidden` half and was left alone.

#### Anomalies

- **`effectAllowed`/`dropEffect` read back as `"none"` under synthetic `DragEvent`s.** The code sets both (`effectAllowed = 'move'` in `dragstart`, `dropEffect = 'move'` in `dragover`), and the unit suite pins both against a fake `dataTransfer`. A **real** `DataTransfer` constructed in page script is not in a drag's protected mode, so it silently ignores those setters. This is a limitation of the synthetic instrument, not a finding about the code — but it means **the "`dropEffect` is MANDATORY or the drop is silently rejected" rule is the one part of the chain the live check could not confirm**, and it is confirmable only by an operator gesture. Named here so the HAT knows to watch for it: if a physical drag previews but refuses to drop, this is the first thing to look at.
- **The live `personal` jar carries two rows that `list()`'s read-time per-row validation drops** (raw count exceeded listed count by two, which is what produced the position gap AC1's reorder then normalised). Pre-existing dev-profile debris from earlier flights' fixtures, consistent with the documented Flight-1 drop/repair contract, and outside this leg. Noted because `add()` takes its new position from `countByJar` (a **raw** count), so a dropped row can hand a new bookmark a position that collides with an existing one — harmless today, since every reorder/remove renormalises, but it is the kind of thing that reads as a mystery later.

#### Not done here, by design

- **DD5b is NOT run.** It needs a physical drag gesture; the Flight Director runs it with the operator. Its precondition — a real `draggable` bar source carrying `text/uri-list` — now exists, and this leg's `dragover` `preventDefault()` is **chrome-document only**, so the guest-side default DD5b measures is not suppressed by anything landed here.
- **The DD8 axis-(b) re-run** is likewise enabled (the stimulus-representativeness defect is gone — there is now a bookmark drag source with none of the tab's tear-off machinery) and not run.
- **AC10's live relaunch half** belongs to the HAT; the offline fresh-load assertion is what landed.
- **Not committed**, and no `[COMPLETE:leg]` — this flight batches review and commit after the last autonomous leg.

---

### Leg 4 — `drag-onto-page`

**Status**: landed
**Started**: 2026-08-05
**Completed**: 2026-08-05

#### AC1's autonomous half — the WHOLE chain driven live, guest → main → chrome → navigation

Run against the app launched `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --ozone-platform=x11`, admin key from the `AUTOMATION_DEV_MINT` line, `connectAutomation()` from `scripts/lib/mcp-client.mjs`. **Port 49709 again** — the session-2 apparatus note has now held four times; `ss -ltnp` remains the only way to find it.

Two windows were live, so the driver matches the drop target's `windowId` to `getChromeTarget()`'s — a mismatch would have silently exercised the cross-window refusal instead of the happy path (and it did, deliberately, as the last case).

| Case | Method | Result |
|---|---|---|
| **AC1** — bookmark dragged onto an ordinary page loads it **in that tab** | real `dragstart`+`dragend` on the bar item (chrome), then a real `DragEvent('drop')` with a real `DataTransfer` on the guest's `window` | ✅ `https://example.com/` → `https://example.org/leg4-drag-onto-page` |
| **AC5/DD6 — the signal cannot be aimed** | the guest's `DataTransfer` carried `text/uri-list: https://attacker.invalid/` | ✅ the tab went to the **dragged bookmark's** url, not the attacker's — the strongest available live statement of DD6 |
| **AC7 — dragend before the signal** | `dragend` was dispatched **before** the guest drop in every pass | ✅ navigation still happened; the holder is load-bearing on the happy path, exactly as the design review corrected |
| **AC6 — fabricated drop, no declaration** | same synthetic drop with no drag in flight | ✅ no navigation |
| **AC6b — second signal inside one drag** | drop, reset the tab, then a second forged drop inside the same drag + grace | ✅ no second navigation — the declaration was consumed |
| **Cross-window drop** | declared in window B, dropped on window A's guest | ✅ refused; A's url unchanged and B's own declaration untouched |
| **AC3 live** | `dragover` with the bookmark MIME vs. one with `text/html` | ✅ ours `defaultPrevented`, the foreign one untouched |
| **AC4 live** | `drop` with the bookmark MIME | ✅ `defaultPrevented === false` after our handler ran |
| **AC2 live** | a page-installed `window` `drop` listener calling `preventDefault()`, then the same drop | ✅ **no navigation** — the page kept it |

Fixture bookmark (`LEG4 fixture`) removed at the end of the pass; the app was stopped. The pre-existing `personal`-jar `example.com` entry was NOT created here — the seeding `bookmarkAdd` was idempotent against a row added five days earlier.

#### The ordering claim, measured — and the half the instrument cannot reach

The unit test can only pin the author's *model* of dispatch ordering, so the same question was put to real Chromium: a probe listener registered FIRST (standing in for the document-start preload listener), a page handler registered SECOND that `preventDefault()`s, one `drop` dispatched at `window`.

```
{ final_defaultPrevented: true, synchronous_read_saw: false,
  microtask_read_saw: true, macrotask_read_saw: true }
```

- **The synchronous half of DD5's claim is CONFIRMED live**: a synchronous read sees `false` while the page went on to consume the drop. An implementation that read inline would have navigated over exactly the drops this design protects.
- **The microtask half is NOT reachable with this instrument, and the result must not be read as refuting it.** The event was dispatched *by script*, so the JS stack is not empty between listeners and the microtask could only run after the whole dispatch — hence `true`. The leg's claim is about a **browser-dispatched** event, where the stack IS empty between listeners. So `queueMicrotask` remains unverified-either-way here; the macrotask is correct in both regimes, which is why it is what shipped. Recorded because a future reader running this same probe would otherwise conclude the microtask read is fine.

#### Changes Made

- **`src/preload/guest-bookmark-drop.js` (new)** — Electron-free, injected-deps core (the `vault-fill-icon.js` division of labour): the `types`-gated `dragover` `preventDefault()`, and a `drop` handler that never `preventDefault()`s, reads the gate synchronously (protected mode), and reads `defaultPrevented` from an injected `setTimeout(…,0)`. Fail-closed on an unreadable `defaultPrevented`. `BOOKMARK_DND_MIME` is imported from `src/shared/bookmark-drag.js`, never re-typed.
- **`src/preload/webview-preload.js`** — captures `setTimeout` at document-start (`window.setTimeout.bind(window)`; a detached Window operation throws) and registers both listeners on `window`, bubble phase, in **every frame**. The generated bundle was NOT edited; `npm run build:preload` inlines the new leaf and `webview-preload-bundle.test.js` stays green.
- **`src/main/register-tab-ipc.js`** — `bookmark-drag-started` / `bookmark-drag-ended` (chrome-sender, `requireChrome`-gated, 1500 ms grace clear on a per-record `WeakMap` timer) and `guest-bookmark-drop` (guest-sender, bare): resolves the window and chrome from `event.sender.id`, refuses without a declaration, **consumes the declaration on the successful forward** (AC6b), and sends `{ targetWcId }`.
- **`src/main/window-registry.js`** — the new `bookmarkDragActive` record field (its OWN slot; `dragWcId` is untouched) plus its typedef entry.
- **`src/preload/chrome-preload.js` + `renderer-globals.d.ts`** — `bookmarkDragStarted` / `bookmarkDragEnded` / `onBookmarkDrop`.
- **`src/renderer/chrome/bookmarks-bar.js`** — declare at `dragstart`, `DRAG_HOLD_MS = 2000` holder past `dragend`, and `handleDropSignal({targetWcId})` navigating via the new per-wcId `tabNavigate` dep. The chrome consumes its own hold on use.
- **`src/renderer/renderer.js`** — +10 lines: three dep closures and the `onBookmarkDrop` subscription.
- **Tests** — `test/unit/guest-bookmark-drop.test.js` (new, 13), +12 in `register-tab-ipc.test.js`, +11 in `bookmarks-bar.test.js`.

#### Gates

`npm test` **3477 pass / 0 fail** against the **3441** baseline (**+36**). `npm run typecheck` clean. `npm run lint` clean. `renderer.js` **1597/1650** — 10 of DD12's 62-line budget spent, no raise.

#### Deviations

- **The `isTrusted` capture is NOT used to refuse a scripted drop**, though the leg's Implementation Guidance lists it as applying. Two reasons, and the first is decisive: refusing untrusted events would make **AC1's own autonomous half impossible** — a page-dispatched `DragEvent` is the only way to drive the chain without an operator gesture, and that verification exists precisely because an AC verifiable only at HAT is the block-or-fabricate trap. Second, it defends nothing DD6 does not already defend: the payload is bare, main gates on a chrome-declared drag and consumes it on the first forward, so a forged event buys a page at most the navigation the operator was already performing — which is why the leg itself labels this "annoyance hardening, not a security boundary". The reasoning is written at the registration site so it reads as a decision rather than an omission.
- **No `dropEffect` is set in the guest's `dragover`.** The leg says "preventDefault(). Nothing else", and that is what shipped — but DD2 records `dropEffect` as MANDATORY-or-the-drop-is-silently-rejected in the *chrome* document (`tab-controller.js:499`, "spike probe3"). ⚠ **HAT: if a physical drag previews over the page but refuses to drop, this is the first thing to try.** The synthetic instrument cannot settle it (leg 3 already recorded that `dropEffect` reads back `"none"` under a synthetic `DataTransfer`), and a real drop *was* delivered to the guest in every live pass above — but those were script-dispatched, so they never negotiated a drop effect at all.
- **The holder lives in `bookmarks-bar.js`, not `bookmarks-client.js`**, which the leg's "Files Affected" also listed. `bookmarks-client.js` was not touched: the hold is one field of the drag session, and the session already lives in `bookmarks-bar.js` — splitting it across two modules would put the release timer a file away from the `dragend` that arms it. No line-budget consequence either way.
- **The forward resolves its chrome through `registry.getChromeForTab(wcId)`** (routing class 3) even though the record was already in hand one line earlier — the extra walk is free and keeps the call site recognisable as the documented owner-routed push.

#### Anomalies

- **None in the code.** One environmental note: the dev profile has **two windows** and the `personal` jar's fixture debris from earlier sessions is still present (see leg 3's anomaly note). The driver had to bind its drop target to the chrome's `windowId`; a leg-4 verification that ignored `windowId` would have measured the cross-window refusal and reported the feature broken.

#### Not done here, by design

- **The physical-gesture halves of AC1 and AC2 ride the HAT**, as the leg's "Deferred to the HAT" section directs — synthetic events cannot confirm the OS drag transport, and the `dropEffect` question above is the specific thing to watch.
- **Not committed**, and no `[COMPLETE:leg]` — this flight batches review and commit after the last autonomous leg.

---

### Leg 5a — `overflow-drop-target`

**Status**: landed
**Started**: 2026-08-05
**Completed**: 2026-08-05

Every acceptance criterion implemented, including the non-sequential ones the two review cycles added (AC1, AC2a, AC2, AC3a, AC3, AC4, AC4b, AC6, AC7, AC8, AC6b, AC8b, AC9, AC10, AC11). The **closing operator probe is NOT run** — it needs a physical gesture and the Flight Director runs it with the operator; nothing here builds anything from `06-overflow-drag-source.md`.

#### Changes Made

- **`src/shared/bookmark-drag.js`** — four new pure exports. `overflowDropIndexY` / `overflowIndicatorY` are the y-axis siblings the sheet's vertical row list needs; `overflowDropIndexY` **maps the vertical axis onto the horizontal one and delegates to `dropIndexFromPointer` unchanged** (a test asserts the two agree case-for-case), so the midpoint rule is still single-sourced. `overflowDropToIndex` is the ruled index formula. `isOverChevron` is the spring-load hit test — `isInsideBar`'s rule plus a zero-area refusal, so a hidden chevron (`display:none` → `0,0,0,0`) can never be hit by a pointer at the viewport origin.
- **`src/shared/tab-order.js`** — JSDoc only: `dropIndexFromPointer`'s **external-source case** (`draggedIndex = -1`) is now documented as supported and pinned, with an explicit "do not clamp this to `length - 1`" note. This leg is its first consumer (DD3 assigned the note to leg 4, which turned out not to need it).
- **`src/renderer/chrome/bookmarks-bar.js`** — `overflowVisibleCount` stored beside `overflowSnapshot` through a single writer; the spring-load dwell and the two-indicator rule in the existing document `dragover`; the chevron-release swallow in the document `drop`; the drag hold extended to `{url, bookmarkId, jarId, visibleCount}`; `closeOverflowIfOpen` suppression + `dragend` flush; `handleOverflowDrop`.
- **`src/renderer/chrome/bookmarks-client.js`** — `commitOverflowDrop(jarId, bookmarkId, visibleCount, dropIndex)`. `commitReorder`'s body was extracted into a shared `reorderWith(jarId, bookmarkId, toIndexFor)`; the only difference between the two entry points is that the overflow one derives `toIndex` from the **length of the fresh DD6b read**, which is the one place the clamp's third term is knowable.
- **`src/renderer/menu-overlay.js`** — the sheet's drop target: `dragover` / `dragleave` / `drop` on `menuNode`, all behind one named `isOverflowMenu()` + MIME gate, plus the placement indicator parented to `#menu-root`.
- **`src/renderer/menu-overlay.css`** — `.sheet-drop-indicator`.
- **`src/preload/menu-overlay-preload.js` + `menu-overlay-globals.d.ts`** — `overflowDrop` (a one-way `send`).
- **`src/main/register-overlay-ipc.js`** — the `menu-overlay:overflow-drop` handler.
- **`src/preload/chrome-preload.js` + `renderer-globals.d.ts` + `renderer.js`** — `onBookmarkOverflowDrop`; `renderer.js` takes **4 lines** (one subscription + 3 comment lines).
- **Tests** — `test/unit/overflow-drop-target.test.js` (new, 9 — the sheet-side structural pins); +18 `bookmarks-bar.test.js`; +9 `bookmarks-client.test.js`; +8 `bookmark-drag.test.js`; +6 `register-overlay-ipc.test.js`.

#### The four things the leg said earlier drafts got wrong

1. **The index rule was taken as RULED and not re-derived.** `toIndex = Math.min(visibleCount + k, order.length - 1)` → `moveIndex`, unchanged. Pinned at **k=0, k=1, k=2, k=last (3), and k=past-the-end (4)** against `order = A..L, visibleCount = 8` — **four** overflow rows, so the clamp is genuinely exercised — each asserting the **literal expected full-list order** (`['B'…'I','A','J','K','L']` etc.) rather than recomputing the formula. A separate test drives `moveIndex` with the **unclamped** value and asserts it returns the same array reference, so the silent-no-op the clamp exists to prevent is pinned as a fact about `moveIndex`, not as a claim about our code.
2. **`visibleCount` is STORED.** `writeOverflowSnapshot(snapshot, visibleCount)` is the single writer of the pair; the hold captures it at `dragstart`. A test swaps what the cache answers **mid-drag** (the exact case that breaks the arithmetically-correct derivation) and asserts the committed count is unchanged.
3. **`dragend`-before-the-report is the DEFAULT test case**, not an edge case — every `handleOverflowDrop` test fires `dragend` first.
4. **The main-side handler names its menuType predicate.** `current.menuType !== 'bookmarks-overflow'` → refuse, with a test that sweeps `vault-unlock`, `kebab`, `bookmark-edit`, `auth-basic`, `cert-picker`, `page-context` and a `null` current menu.

#### Decisions taken inside the leg

- **ONE shared hold, not a second independent one** (AC4b asked this be stated). Leg 4's `dragHoldUrl` slot became a `dragHold` **record** — `{url, bookmarkId, jarId, visibleCount}` — with one timer and two consumers. Reasoning: a single physical release lands on exactly ONE surface, so at most one consumer can ever fire; sharing the slot makes "only one can be consumed" **structural** (whichever consumer wins releases the record) instead of a comment. Two independent holds would both be armed on every gesture, expire on two timers, and leave the invariant unenforced. Pinned by a test that consumes the sheet path and then asserts leg 4's navigation resolves to nothing.
- **AC6 and AC6b are closed by ONE rule at ONE site, and it is conditional on purpose.** `writeOverflowSnapshot` closes the open sheet **iff the snapshot's ids actually changed**. That disposes of the pre-existing resize desync (a resize that moves the visible/overflow boundary now closes the sheet it would otherwise have rewritten under) and of `dragend`'s partnerless `render()` (AC6b) with the same rule.
  - **Why conditional rather than "close on the dragend flush"**: an unconditional close at `dragend` would **race the sheet's in-flight drop report**. Both cross to main from different renderers at release with no ordering guarantee, and if the close won, main's token/menuType gate would refuse the operator's own drop — turning the happy path into a silent no-op, which is precisely what AC4's clamp discussion forbids. On the happy path the store mutation has not landed yet, so the `dragend` re-partition produces an **identical** snapshot and no close fires. Both branches are pinned (`AC6b: dragend's render() closes…` and `AC6b: the HAPPY path's dragend leaves the sprung sheet alone`).
  - Comparison is on **ids only** — a title/icon edit changes what a row reads but not what index N dispatches to, and closing on a cosmetic edit would be a gratuitous mid-gesture dismissal.
- **The gesture ends deterministically in main's drop handler**, which calls `closeMenuOverlay('activated', token)` before forwarding — the `menu-overlay:activated` precedent. Waiting for the `bookmarks-changed` broadcast instead would leave the sheet open forever after a commit that legitimately no-ops. A post-drop read of the sheet therefore requires a **re-open** (AC7 asked this be stated); the spec rows depend on it.
- **AC6 residual disposition, named**: a stale snapshot whose bookmark was deleted resolves `order.indexOf(bookmarkId) === -1` → `moveIndex` no-ops → `commitReorder` returns false. Unchanged from leg 3 and correct; pinned by `commitOverflowDrop: degenerate arguments…` (the `'ZZZ'` case).
- **Edge Case "release ON the chevron" — RULED: the chevron SWALLOWS it.** AC2a suppresses the bar indicator across the chevron, so committing leg 3's `reorder` classification there would be a **write with no preview** at a position nothing was ever drawn for. Inert instead; the sprung sheet is the affordance that carries an indicator and therefore a commit.
- **The dwell is measured against an injected clock (`now`, defaulted), not counted in events.** `SPRING_DWELL_MS = 250`. Event *rate* is a Chromium implementation detail — a count-based dwell would silently re-tune itself on a faster machine. `now` is a defaulted dep, so `renderer.js` passes nothing and the wiring costs no budget.
- **`dropEffect = 'move'` IS set in the sheet's `dragover`**, unlike leg 4's guest handler. The FD note of 2026-08-05 demotes this to "confirm" rather than "expected failure", but setting it costs one line and matches the chrome document's own handler.
- **AC8's "decide what a sheet-sourced drag carries" is recorded, not built** — there is no sheet drag source in this leg. Recorded for 5b: putting a **snapshot index in the MIME and resolving chrome-side** preserves DD9 and needs no model change, at the cost that an overflow-sourced drag cannot populate `text/uri-list`/`text/plain`, so **drag-from-overflow-to-page (leg 4's path) would not work from the sheet**. Extending `overflowSheetModel` to carry the real url is the alternative and gives up DD9's "the sheet is a dumb renderer". The choice belongs to 5b, after the probe.

#### Deviations

- **`src/renderer/menu-overlay.css` and `src/renderer/menu-overlay.js` acquired an import of `src/shared/bookmark-drag.js`, which the sheet had never loaded.** No `<script>` tag was added — the sheet's module graph resolves it through `menu-overlay.js`'s own `import`, the same way `bookmark-edit-template.js` already loads. The defer/module script-tag contract tests are untouched and green.
- **`test/unit/bookmarks-bar.test.js`'s `FakeElement` geometry is now DERIVED from live DOM position for the leg-5a harness only** (a per-harness `createElement` wrapper). This leg's flush path rebuilds every `.bm-item`, and widths stamped on the old nodes come back as 0 — a fake-only "the partition changed" that would have masked the exact race the AC6b tests measure. Every pre-existing test keeps the original stamped-geometry harness.
- **`harness()` gained `setLive()` and a `clock`**, and `bookmarksClient.listFor` now reads a mutable slot. Additive; no pre-existing assertion changed.
- **`test/unit/register-overlay-ipc.test.js`'s channel-key pin gained `menu-overlay:overflow-drop`** — a deliberate pin update, not a relaxation.
- **`CLAUDE.md` was not updated.** The drag-model documentation is a flight-level Completion Checklist item covering all of legs 3/4/5a together; writing a third of it now would produce prose the flight then has to rewrite.

#### Anomalies

- **None in the code.** One thing worth carrying to 5b: the spring-load branch reads `dnd.chevronRect`, so it requires a **local** drag session. A sheet-sourced drag has none in the chrome (leg 3's handlers `return` on `!dnd`), which is the "chrome has no foreign-drag session at all" gap cycle 2 identified as 5b's largest unwritten piece. Nothing here makes it worse; it is simply still true.

#### Gates

`npm test` **3527 pass / 0 fail** against the **3477** baseline (**+50**: 18 bar, 9 client, 8 pure-module, 6 overlay-ipc, 9 new sheet-side file). `npm run typecheck` clean. `npm run lint` clean. `renderer.js` **1602/1650** — 4 lines spent, 48 of DD12's headroom left, no raise.

#### Not done here, by design

- **The closing operator probe** (does a drag STARTED INSIDE the sheet deliver to the chrome?) — needs a physical gesture; the Flight Director runs it with the operator. It gates leg 5b.
- **Nothing from `06-overflow-drag-source.md`.** No `draggable`, no `dragstart`, no drag-lifecycle channel, no foreign-drag session, no overflow → bar commit. `overflow-drop-target.test.js` pins the absence of the first two so 5b cannot land accidentally.
- **The rendered halves of AC3/AC4** ride the HAT, as the leg's "Deferred to the HAT" section directs — including DD4's push-out-of-the-bar consequence, which is correct and will read as surprising.
- **Not committed**, and no `[COMPLETE:leg]` — this flight batches review and commit after the last autonomous leg.

---

### Leg 5b — `overflow-drag-source`

**Status**: landed
**Started**: 2026-08-06
**Completed**: 2026-08-06

Every acceptance criterion implemented (AC1–AC9). The gesture's rendered halves ride the HAT, as the leg directs. Built on operator session 4's measurements without re-deriving them: the transport is viable, and the sheet DOES receive its own `dragend`.

#### AC2 — the decision, and its asymmetry (made HERE, not discovered at HAT)

**RULED: the sheet-sourced drag carries the SNAPSHOT INDEX, and the chrome resolves it.** `overflowSheetModel` is unchanged; the sheet still knows no bookmark id and no url.

Three reasons, in the order they mattered:

1. **It preserves DD9** — the sheet stays a dumb renderer, and the index-dispatch addressing the whole overflow surface already uses stays the one addressing scheme. Extending the model to carry real ids/urls would have given the sheet a second, richer vocabulary for the same rows.
2. **It keeps the payload unaimable, which the alternative does not.** A hostile page can set `application/x-goldfinch-bookmark` on its own drag and release it over the bar. The chrome therefore reads **nothing** off the `dataTransfer` — not even the index it wrote. WHAT the drag is comes from the foreign session main opened under all three guards; the MIME value exists only so the chrome's existing `types.includes(...)` gates fire. Had the payload carried a real url, that gate would have become a page-reachable primitive.
3. It needs no model change, so the sheet's DOM gains no new data class at a moment when DD1/DD1e make what the sheet's document holds a security question.

**THE COST, STATED**: an overflow-sourced drag populates **no `text/uri-list` and no `text/plain`**, so **dragging a row out of the overflow menu onto a page does nothing** — leg 4's path is unavailable from the sheet. Bar-sourced drags are untouched and still carry all three types, so mission criterion 6's "dragged onto the page area" clause is satisfied by the bar, which is where the criterion's own wording puts it. Pinned by a test asserting the sheet writes exactly one type and the bar still writes `text/uri-list`, so the asymmetry cannot be half-fixed silently.

#### Changes Made

- **`src/renderer/menu-overlay.js`** — the sheet's FIRST-EVER drag source: `attachOverflowDragSource(btn, rowId)`, one definition and one call site, behind the existing `isOverflowMenu()` predicate **inside** the pre-existing bookmarks-overflow row branch (so both the menuType and the row-id family are gated). Sets `draggable`, writes the index-only payload, and sends `start`/`end` on the new channel. The open token is **captured at `dragstart` into the row's closure** — `report.token` is already null by `dragend`, because main's DD1f close-reset runs `report.silence()` when the sheet blur-closes at drag start.
- **`src/renderer/menu-overlay.css`** — `user-select: none` on the draggable rows, scoped by `[data-menu-type='bookmarks-overflow']` **and** `[draggable='true']`.
- **`src/preload/menu-overlay-preload.js` + `menu-overlay-globals.d.ts`** — `sheetDrag` (one-way `send`, one channel with a `phase` discriminator rather than two).
- **`src/main/register-overlay-ipc.js`** — the `menu-overlay:sheet-drag` handler, with its guards **named as predicates** (`recordForSheetSender` + token freshness + `current.menuType === 'bookmarks-overflow'`), not inherited by citing leg 5a. It deliberately does **not** close the sheet.
- **`src/preload/chrome-preload.js` + `renderer-globals.d.ts` + `renderer.js`** — `onBookmarkSheetDrag`; `renderer.js` takes **4 lines** (one subscription + 3 comment lines), 1602 → **1606**.
- **`src/renderer/chrome/bookmarks-bar.js`** — the **foreign-drag session** (AC4, the largest unwritten piece): `foreign` + `handleSheetDrag` + `endForeignDrag`/`discardForeignDrag` + the `FOREIGN_DRAG_MAX_MS` latch bound. `dragover`/`drop` now resolve `const session = dnd || foreign` and share all their geometry code; the indicator takes its session as a parameter (AC6 — the same indicator serves both directions). Two small extractions (`edgesOf`, `measureSlotRects`) so the two sessions snapshot geometry through one path rather than two.
- **`src/shared/bookmark-drag.js`** — `barDropToIndex(dropIndex, visibleCount)`, the mirror of `overflowDropToIndex`.
- **`src/shared/tab-order.js`** — JSDoc only: the external-source note now names **both** consumers and its own direct pin.
- **Tests** — +3 `tab-order.test.js` (the external-source case, pinned at the predicate for the first time), +4 `bookmark-drag.test.js`, +15 `bookmarks-bar.test.js`, +6 `register-overlay-ipc.test.js`, and `overflow-drop-target.test.js`'s AC1 pin **re-targeted** (see Deviations).

#### Decisions taken inside the leg

- **AC5's clamp — `min(dropIndex, visibleCount - 1)` — is the mirror of 5a's, and load-bearing for the same reason.** `dropIndexFromPointer` with `draggedIndex = -1` answers `visibleCount` for a release past the last visible slot, where the indicator drew at that slot's **right edge** ("here, at the end of the bar"). Unclamped that is full-list position `visibleCount` — the **first overflow row**: the bar would be visually unchanged and a deliberate gesture would read as "nothing happened". Clamped, the item lands at the last visible position and displaces whatever was there into overflow, which is DD4's consequence and exactly where the indicator pointed. The operator's 5a ruling ("land where the indicator drew") decides this case too; it is applied, not re-derived.
- **`end` is gated on sender identity ALONE main-side, and the token check MOVES to the chrome.** This is the one place the leg does not carry all three guards, and it is forced rather than chosen: the sheet blur-closes at drag **start**, so by `dragend` `getCurrentMenu()` is null and a token/menuType gate would refuse **every** `end` — turning the clear signal session 4 measured into one that never arrives, leaving AC3's timer as the sole recovery on every gesture. The chrome stores the session's token and matches the forwarded `end` against it, which is a check main structurally cannot perform. Safe to relax because `end` is **non-destructive by construction**: it can only cancel a session, never commit one. Both halves are pinned (a stale `end` does not cancel; the matching one does).
- **`FOREIGN_DRAG_MAX_MS = 15000`, deliberately generous.** It bounds a **latch**, not a gesture: session 4 measured that `dragend` fires, so this is defence-in-depth against a path that fails to clear (sheet `render-process-gone`, teardown mid-gesture). A tight bound would expire under a slow but legitimate human drag; expiry is non-destructive anyway (session gone → a late drop commits nothing). Pinned by the AC3 test that **never sends `end`**.
- **One suppression gate, never two.** `dragActive` and `pendingOverflowClose` are reused rather than duplicated, so AC7 is the same mechanism in both directions. A local `dragstart` **discards** any latched foreign session (`discardForeignDrag`) instead of sharing the gate with it, and a `start` arriving while `dnd` is live is refused. One pointer produces one gesture; the tests assert which session drove each commit by the **index it produced** (a local session excludes its own slot, a foreign one excludes nothing — the numbers differ, so the assertion names the mechanism rather than the outcome).
- **Spring-loading stays bar → overflow only.** A sheet-sourced drag is already leaving that menu; re-opening it under the pointer would offer a target for the gesture the operator just left. The chevron still **swallows** a foreign release, by the same rule 5a ruled for the forward direction — nothing was drawn there, so nothing may be written.
- **The reverse commit reuses `commitReorder` unchanged** — no new `bookmarks-client.js` entry point. 5a needed its own because its clamp's third term (`orderLength - 1`) is only knowable after the DD6b read; this clamp depends only on `visibleCount`, which is rendered state. DD6b's fresh read, the `moveIndex` no-op, and the failure disposition all come along untouched.
- **A foreign session is CONSUMED at commit** (it runs its own `endForeignDrag` flush before issuing the reorder), which gives the "one outcome per release" invariant structurally rather than through a `dropHandled` flag the foreign path has no `dragend` to read.

#### Deviations

- **`test/unit/overflow-drop-target.test.js`'s AC1 pin was RE-TARGETED, not deleted.** It asserted `menu-overlay.js` contains no `draggable` and no `dragstart` — a deliberate 5a guard so 5b could not land accidentally before the probe. Session 4 passed the gate, so the premise inverted: it now asserts the source **exists**, that exactly one place in the sheet makes a node draggable, and that it is reached from one gated call site. Two further tests (AC2's payload asymmetry, AC3's channel + token capture) were added beside it. This is the flight's "re-target, never delete" rule applied to a pin this leg was always going to shift.
- **`register-overlay-ipc.test.js`'s channel-key pin gained `menu-overlay:sheet-drag`** — a deliberate pin update, not a relaxation.
- **`CLAUDE.md` was not updated**, for the same reason 5a gave: the drag-model documentation is a flight-level Completion Checklist item covering legs 3/4/5a/5b together.

#### Anomalies

- **None in the code.** One residual risk worth carrying to the HAT, recorded because it is unobservable offline: the `start` signal and the sheet's blur close race each other into main. If main processed the blur first, `getCurrentMenu()` would be null and the `start` would be refused — the whole direction would no-op. The ordering is expected to favour us structurally (the renderer sends during its own `dragstart` dispatch, which strictly precedes the browser initiating the OS drag, which is what causes the blur), and the failure mode is a **wrong visual, never a wrong write**. It is the first thing to check if the HAT reports "the drag does nothing".
- The sheet's `dragstart` also has no `text/uri-list`, so Chromium's own default url-drop handling can never fire for this direction — noted as a small side benefit of AC2's choice, not a defect.

#### Gates

`npm test` **3558 pass / 0 fail** against the **3527** baseline (**+31**: 15 bar, 6 overlay-ipc, 4 pure-module, 3 tab-order, and 4 sheet-side structural tests replacing 1 retired absence pin). `npm run typecheck` clean. `npm run lint` clean. `renderer.js` **1606/1650** — 4 lines spent, **44** of DD12's headroom left, no raise. `file` reports every touched source as `JavaScript source` (the leg-5a literal-control-byte trap re-checked, and a fresh sweep of all of `src/` and `test/` for 0x00–0x1F literals returns nothing).

#### Not done here, by design

- **The HAT items.** The rendered halves of AC5/AC6 (does the indicator read right, does DD4's push-out-of-the-bar read as sensible rather than as a bug) and every physical gesture ride `hat-and-alignment`, per the leg's Verification Steps.
- **Not committed**, and no `[COMPLETE:leg]` — this flight batches review and commit after the last autonomous leg, and 5b is it.

---

## Flight Director Notes

### 2026-08-04 — Flight start

Phase file `leg-execution.md` loaded and structure-validated (`## Crew`, `## Interaction Protocol`, `## Prompts` all present, every prompt subsection fenced). Branch `flight/03-drag-interactions` created from `main` at `5aa4932` per the ARTIFACTS.md git convention. Flight status `planning` → `in-flight`. Five legs planned; leg 4 is conditional on the DD8 probe verdict and may be replaced by a mission amendment.

Flight artifacts are uncommitted by design — this flight batches code review and commit after the last autonomous leg (Phase 2d), so leg artifacts and code land together.

### 2026-08-04 — Leg 1 risk tier: **HIGH**

Tiered high, and the flight artifact's own "medium-risk" note is superseded by this call. Rationale, against the skill's tiering criteria:

- **Security-sensitive surface** — it modifies the guard whose stated purpose is refusing a keylogger/secret-reader on the WebContents that hosts the vault's master-password entry and its one-time recovery/access/admin key displays.
- **Shared-interface change** — `deps()` gains an argument (`engine.js:110-151`), `resolveContents`'s sheet semantics change for every one of its 29 call sites, and `window-registry.js` gains an export threaded through `main.js`.
- **Reverses a shipped absolute** — `resolve.js:125-127` currently refuses at *every* tier and says so in its comment; two existing test groups pin that absoluteness (`automation-resolve.test.js:113-129`, `:546-555`).

Any one of these alone would tier high. The Flight 2 debrief's lesson that risk tiers on **blast radius, not change shape** applies directly: the diff is small and mechanical-looking, which is exactly the shape that got leg 1 of Flight 2 under-tiered.

**Leg design note — a fact the flight artifact did not have.** Reading `observe.js` during leg design surfaced that `readDom` reads the DOM *by executing JavaScript* (`READ_DOM_SNIPPET` through `wc.executeJavaScript`, `:159-166`). That does not invalidate DD1a, but it means the allowlist's real distinction is **fixed app-authored snippet vs caller-supplied code**, not "executes script vs doesn't." Recorded in the leg artifact so a reviewer who assumes the latter does not conclude the gate is incoherent.

**Second leg-design finding, which narrows the change usefully**: ~~guard 5 (`non-tab-contents`, `resolve.js:154-162`) already refuses the sheet at every non-admin tier~~ — **this was wrong; see the leg-1 design review below.** The conclusion it supported (**this leg widens the admin tier only**) is correct and stands; the mechanism was not.

### 2026-08-04 — Leg 1 design review cycle 1: **needs rework**, incorporated

Three HIGH findings, all on the security half. Each independently re-verified by the FD against the code before incorporation. The HIGH tier earned its cost on the third one alone.

1. **The `{menuType, token}` snapshot cannot live in `deps()` (HIGH — unimplementable as specified).** `deps()` (`engine.js:110-151`) is constructed with **no wcId** — the target is not known yet — and `sheetMenuFor` is inherently per-record, since `isSheetContents` walks `records()` to find *which* window's sheet matches (`window-registry.js:219-227`). Under two windows a deps-time snapshot compares window A's menu against window B's sheet, which makes the leg's *own* stated two-window edge case unsatisfiable under the shape it mandated. Corrected: `sheetMenuFor` threads into deps as a **live reader** (that is all the gate needs, and it covers all 29 resolve points), and the snapshot moves **inside the two async ops** after their first resolve, where `wc` is already in hand (`observe.js:137`, `:312`) — ~6 lines. **Flight DD1b amended accordingly**, with the superseded reasoning preserved.
2. **AC7 (DD1e) is not writable as a unit test, and was filed under one (HIGH).** Verification Steps put it under `automation-resolve.test.js` — a file with no document, no sheet, no menu registry. The premise lives in `menu-overlay.js`: a 2433-line ESM **page script** with 17 top-level imports and preload-bridge access, of which the repo tests only the pure template builders. `vault-accesskey-template.test.js:5-7` states that gap outright. Corrected to a **Grep-AC** (the house convention for invariant ACs) pinning `closeAll()` before render and the three `onClose` scrubs, plus a live check in the operator session — and widened to cover **both** admitted menuTypes, since `bookmark-edit` is equally admitted by AC1 while DD1e argued only about `bookmarks-overflow`. Extracting the scrub wiring into a testable module was considered and declined as real unbudgeted scope.
3. **The leg told the implementer to write a FALSE claim into a security comment (HIGH).** The leg asserted guard 5 (`non-tab-contents`) refuses jar keys, and instructed: *"State this in the code comment — it is the single most reassuring fact about the change."* `memberDeps()` (`scope.js:138-145`) threads neither `isSheetContents` **nor `isTabViewWcId`**, so inside `resolveContentsForJar` guards 3 and 5 are *both* no-ops (each requires `typeof … === 'function'`). The real refusal is `out-of-jar` from the session-identity compare (`resolve.js:222-227`). **`docs/mcp-automation.md:335` already says exactly this**, and so does the flight's own DD1b bullet — the error was introduced in the leg, not inherited from the flight. Corrected in the leg's Context, in AC4 (which now asserts the refusal *at the layer it occurs* — `out-of-jar` through the façade, `non-tab-contents` against the jar engine directly), and in the comment instruction.

Also incorporated: the fail-closed predicate shape (an absent `sheetMenuFor` must refuse, not throw a `TypeError` from inside a live guard); `sheetMenuFor`'s injection into `createEngine`'s options bag, which the first draft never listed in Outputs or Files Affected despite it being the entire menuType half of the gate; the **second engine construction site** at `app-lifecycle.js:208`, missed entirely; AC3's actual recipe (`WCID_FIRST_OPS` is exported and already cross-checked by `automation-scope.test.js:211`, so a genuinely additive sweep exists — but it needs the `Module._cache` electron double and a per-op valid-args table that fails loudly on an unlisted op, else ops that validate args before resolving pass on the wrong error); AC12's extension to `docs/vault.md:347-355` and `docs/mcp-automation.md:325-345`, both of which assert the retired absolute — vault.md's parenthetical explicitly *accepts* the whole-window pixel path DD1c now closes, so DD1c reverses a documented accepted limit rather than patching an unnoticed gap; and the DD8 probe's self-gating readback (a drag ending over the sheet very likely closes the menu, nulling `currentMenu` at `menu-overlay-manager.js:337`, so the operator must re-open the overflow menu before the `readDom` — the counters survive on `<body>`, which is DD1a's own premise).

Adopted from Suggestions: `sheetMenuFor` returns `null` when the sheet is not `isVisible()`, folding the never-settles `capturePage()` hazard into the predicate and making the resolver gate and `captureWindow`'s `isVisible()` check literally the same predicate (flight DD1b amended); exporting the three bar constants rather than source-scanning them, with a note that publishing them does not touch the evaluate-seam closed set so no FD ruling is needed.

Six drifted citations and one wrong directory (`find-overlay-geometry.js` is `src/main/`, not `src/renderer/`, and carries the stale claim at `:6` as well as `:14-15`) corrected. **The first Citation Audit claimed zero drift and was wrong** — recorded, because the audit's value is entirely in being trustworthy.

Verified-correct and explicitly checked rather than assumed: `allowSheet` reaches `resolveContents` on every path all three ops take; `activate` inheriting `allowSheet` creates no unintended admission (`activateTab` on a sheet wcId misses `chromeForTab`, returns `false`, no raise); the post-await placements honour `readAxTree`'s no-re-resolve constraint; `getCurrentMenu()` is a sound proxy because `hide()` is reached only from `closeMenuOverlay`; suite baseline 3356/0.

### 2026-08-05 — Leg 1 design review cycle 2, and escalation to the operator

Cycle 2 confirmed all three cycle-1 fixes correct on their own terms and found **a new HIGH that invalidated DD1e's premise outright**. Verified by the FD before escalating:

**The pre-render residue window.** `deliverInit` is the only message main sends the sheet (`menu-overlay-manager.js:151`, called `:203`/`:310`) — there is no close message. After a main-initiated close (`tab-switch`/`tab-hide`/`tab-close`/`superseded`/`teardown`, all of which close even a `dismissible:false` card, `:334-338`) the secret's `textContent` stays live in the sheet DOM; the renderer's own comment names the case (`menu-overlay.js:2312-2315`). `openMenu` then sets `currentMenu` and `show()` **synchronously** (`:298-302`) and only afterwards calls `deliverInit` (`:310`), with the scrub `closeAll()` running in the renderer past that IPC hop (`:2317`). Between those points `sheetMenuFor(wc)` reports an admitted menuType while the DOM holds the prior secret, and an admin client can drive the chrome to open the chevron and loop `readDom`.

That is exactly the flight's own divert condition — *"any path by which an admitted op reads a secret from the shared sheet realm."* What made it escalation-worthy rather than a fix-in-place: **the window is unobservable by any verification this flight has.** It is orders of magnitude narrower than human timing, so AC8's Grep-AC and the operator's live check would both have passed while the premise was false. A checkpoint that cannot fail is not a check.

**Two design-review cycles is the skill's cap**, so this went to the operator rather than a third round.

**Operator ruling (2026-08-05)**, three decisions:

1. **Close the window** — eager scrub. `closeMenuOverlay` gains a main→sheet close/reset message running `report.silence()` + `menuController.closeAll()` immediately, so the DOM never retains a closed menu's content. → new **flight DD1f**. `<body>` data attributes are deliberately untouched, so DD8's probe readback premise survives.
2. **Split the four debt items into their own leg** — DD1f grew leg 1's security surface to `menu-overlay-manager.js`, `menu-overlay.js`, and the preload; none of the debt items shares a file with it. → **flight DD10 amended**; legs renumbered (`01-automation-gate`, `02-carried-debt`, then reorder/drag-onto-page/overflow-drag/HAT).
3. **Extend the post-await re-check to `readDom`** — its `executeJavaScript` is a full main→renderer round trip, so what returns is whatever the renderer had rendered when the snippet ran, not what main believed at resolve time. It was the admitted op with the widest content exposure and the only one without the guard; the exemption had been argued from handle staleness, which is a different concern.

Also incorporated from cycle 2: the `deps()`-has-no-wcId correction propagated into flight Technical Approach and the legs list (DD1b had been amended, those two had not); `sheetMenuFor` needs the same defensive `typeof` guards `isSheetContents` uses, or it throws a `TypeError` from inside a live security guard; AC3's sweep must also give valid args to **`pressKey`** and **`dragPointer`** (both build their event payloads before `actOn`) and must normalize **mixed throw shapes** (`nav`/`zoom`/`sendInput` throw synchronously, the rest reject — an `assert.rejects`-only sweep silently passes the sync throwers); AC7's `captureWindow` half is a **source scan, not a unit test**, because no test in this repo loads `main.js`; AC7's post-await check must re-evaluate **menuType**, not only `isVisible()`, or a capture model-replaced mid-flight composites vault pixels — the same TOCTOU AC5 closes, left open one op over in the op DD1c exists to fix; AC8's Grep-AC needs `maskComments`/`findMatchingBracket` from `test/helpers/source-scan.js` and must **enumerate `onInit`'s early-return set** rather than assert an ordinal "closeAll precedes render", because the `downloads` fast path (`:2306-2309`) already returns before the scrub; AC4 must name **`readDom`** as the op carrying the `non-tab-contents` assertion, since a non-admitted op would throw `secret-sheet` at guard 3 and pass for the wrong reason; AC9 added for the dual engine-site wiring, which no AC covered — an implementer wiring only `main.js:934` would have satisfied every criterion verbatim; the second `vaultInput.value` clear at `menu-overlay.js:668`; and a note that `readAxTree`'s `Accessibility.enable` has no matching `disable`, leaving accessibility mode resident on the shared document — outside DD1a's retired residency rule, but residual state left by an admitted op on the surface DD1a is about, so it is named in the code comment rather than left to be rediscovered.

One citation regression corrected: `main.js:598-616` → **`:598-615`** (`:616` is blank; the flight's original was right and the "corrected" audit made it worse).

**Note on review coverage**: DD1f's implementation is substantive and no design-review cycle has seen it, the cap having been reached. It is covered by the flight-end Reviewer (Phase 2d), which evaluates **all** uncommitted changes — recorded here so that gap is deliberate rather than assumed.

### 2026-08-05 — Leg 2 (`carried-debt`) risk tier: **LOW**

Additive, mechanical, single-surface per item, all within established patterns (`csp-pins.test.js` for the pin test; deletions and comment fixes otherwise). No design review; the flight-end Reviewer covers the resulting code. Independent of leg 1 — the two share no files — so both are spawned for implementation in parallel.

---

### 2026-08-05 — Leg 3 (`bar-drag-reorder`) risk tier: **HIGH**

Tiered high on three of the skill's criteria, any one of which would suffice:

- **First consumer of an unproven path.** `bookmarkReorder` has zero renderer call sites today; every link is unit-tested and the chain has never run end to end. AC1 makes verifying it the leg's *first* action, so a failure is attributed to the store rather than to the drag.
- **New mechanism.** Native HTML5 DnD on a surface that has never had it, with the session/`dropHandled`/`dropEffect` rules that the tab implementation learned the expensive way.
- **Cache-freshness behaviour.** DD6b changes where the commit's input comes from (fresh `bookmarksGet`, not the cache) precisely because a stale read plus DD7's full-id-list rule silently relocates another window's bookmark with `{ok:true}`.

Also a shared-interface change: `bookmarks-client.js` gains a reorder path, and `bookmarks-bar.js` gains behaviour that `renderer.js` wires.

**Design note carried into the leg** — three traps the artifact names explicitly, because each is a place a competent implementer would go wrong:

1. **No index translation exists to write.** DD3's original premise was falsified at flight design review; visible index *is* full-list index because the overflow hide is a strict tail. The real requirement is the inverse — filter `display:none` items out of the slot array, or their zero-width-at-left-0 rects inflate `dropIndexFromPointer`'s answer by exactly the overflow count.
2. **No click-suppression flag.** Native DnD fires no trailing click; `CLAUDE.md`'s tab-activation invariant says so and warns against reintroducing one. The bar item's click handler *navigates*, so an implementer assuming a trailing click will add a guard this codebase deliberately removed once.
3. **Two rebuild paths, not one.** `render()` and the `ResizeObserver` re-partition both destroy the drag source mid-gesture; the second is the one that gets missed, and the first is reachable with no tab switch at all.

**DD5b was moved out of the acceptance criteria** into a deferred operator section, matching how `automation-gate` handled its probe. It needs a physical gesture, so an implementing agent would either block on it or — worse — fabricate a result. Its binding constraint is *before `drag-onto-page`*, which the end of this leg satisfies.

**This leg also produces the artifact the withdrawn DD8 verdict needs**: a real `draggable` bar item, which removes the stimulus-representativeness defect that invalidated the tab-sourced probe. Producing it is an output of this leg; re-running the probe is a separate operator step.

### 2026-08-05 — Leg 3 design review cycle 1: **approve with changes**, incorporated

All three load-bearing claims verified against real code by the reviewer — the DD3 correction (both halves), AC9's no-trailing-click invariant, and AC7's rebuild-path analysis. Findings were specification completeness, not design error, so no decision was re-opened and a second cycle was not run (the skill's "skip re-review if only minor fixes were applied" — nothing here changes an approach, and the flight-end Reviewer covers the resulting code).

Two HIGH, both incorporated after independent FD verification:

1. **`moveIndex` was never named, leaving the commit's core computation to be hand-rolled.** `tab-order.js:34-52` already provides it, and it composes *exactly* with `dropIndexFromPointer` — the latter's "insertion index among the remaining slots" is precisely the former's `toIndex` contract, the same pairing `commitTabMove` uses (`tab-controller.js:367-377`). It also **returns the same array reference on a no-op**, which hands AC4 its drop-back-into-original-position check for free, and no-ops when the dragged id is absent (covering a bookmark deleted mid-drag). A hand-rolled `splice` pair is the classic forward-move off-by-one. **It has zero importers in `src/`** — as unproven as `bookmarkReorder`, so AC1 now exercises the composed pair rather than the store alone.
2. **AC1 had no procedure and no blocked disposition despite gating the leg.** It is agent-drivable (admin tier + `evaluate` on the chrome; the bridge is on `window`, outside the seam's closed set) but needs a live display. Given that *both* prior operator sessions hit rig faults, the leg now carries a concrete recipe — including **discovering the bound port with `ss -ltnp`, because it is not reliably 49707** — and an explicit disposition if the rig is unavailable: record as blocked, fold into the operator session, **never fabricate**.

Six MEDIUM incorporated. The two that would have cost real debugging time:

- **`dataTransfer` leaves protected mode when the dispatch ends**, so the `await` in `drop` (which DD6b requires) makes any later `getData`/`types` read return empty — the drop would silently do nothing. The id must come from the dragstart snapshot. The flight recorded this at cycle 2; the leg had inherited the `dropHandled` warning but not this one.
- **The insertion indicator must not participate in flex layout**, or it reflows the row and invalidates the very dragstart rect snapshot the drop commits against. `#bookmarks-bar` has no `position` declaration, so `position: relative` is a prerequisite.

Also incorporated: a **third** path that removes the drag source (`window-controller.js:108-114`'s `applyBarVisibility` sets `display:none` without calling `clearItems()`, so AC7's test passes while the source vanishes) — dispositioned as an accepted wrong-visual, never a wrong-write, rather than gated; AC11's premise corrected (suppressed tabs *keep* stale `.bm-item` children under a hidden bar, so the test must assert the bar's `.hidden`, not the items' absence); a drag-session-armed assertion for AC3, since this is the codebase's first `draggable` `<button>` and a failure to arm is indistinguishable from "nothing happened" — the ambiguity that produced the withdrawn axis-(b) verdict; the `bookmarks-bar-css-pin` exact-export-set trap, where a new numeric export turns the suite red **by design**; and AC10 split into an offline store-level fresh-load (autonomous) versus a live relaunch (HAT).

Citations corrected: `bookmarks-store.js` numbers were pre-`carried-debt` (+2 shift from the rewritten `DATA_IMAGE_RE` comment) — the leg's own sweep caught the `bookmarks-bar.js` +9 shift and stopped at one file; plus `closeOverflowIfOpen` and the chevron rule. The dangling "AC13" references and a DD5b output line that contradicted the deferred-operator section were removed.

**Flight artifact corrected too**: `flight.md`'s Open Questions still resolved DD3 as *"add one pure visible→full index translator"*, contradicting the rewritten DD3 body. That stale line is what a future reader finds first, so it now carries the falsification inline.

### 2026-08-05 — Leg 4 (`drag-onto-page`) risk tier: **HIGH**

Security-sensitive surface: it opens a path from a `contextIsolation: false` guest — where a hostile page can fabricate a `DragEvent` and reach our handler directly — to a navigation. That alone tiers it high; it also crosses the process boundary and adds IPC channels.

**DD5b's measurement materially simplified the design, and the leg records why.** DD5 was drafted assuming Chromium had a default URL-drop navigation that we would either let the page consume or suppress. Session 3 measured that there is none (29 `dragover`, zero `drop`). So:

- the guest's `dragover` `preventDefault()` is now **what makes the feature exist at all**, not a detail;
- the `drop` handler must **not** `preventDefault()` — there is nothing to suppress, and doing so would pollute `defaultPrevented`, the very flag the page-wins discriminator reads.

DD5's *policy* is unchanged; its *mechanism* is smaller and sharper because it was measured rather than assumed. This is the flight's clearest case of a probe paying for itself.

**The open question the flight carried since planning — tab-switch-mid-drag — is resolved by construction rather than by a guard.** Main resolves the target from `event.sender`, the guest that actually received the drop, so whatever the operator did mid-gesture, the page they dropped on is the page that navigates. No mid-drag cancellation logic, no "which tab was active" ambiguity.

Three things the leg names because they are where this goes wrong:

1. **The `defaultPrevented` read must be a `setTimeout(…, 0)` macrotask.** The preload runs at document-start, so its listener is *first* in registration order and fires ahead of a page's own handler on the same node; a synchronous read sees `false` and destroys exactly the drops DD5 exists to protect. `queueMicrotask` is also insufficient — a microtask checkpoint runs between listeners whenever the JS stack is empty, which for a browser-dispatched event it is.
2. **The `types` gate is mandatory.** Ungated, we `preventDefault()` every drag on every page, making pages accept file and link drops they otherwise refuse.
3. **The chrome must hold the resolved bookmark past its own `dragend`.** Leg 3 clears the session there (`bookmarks-bar.js:338-340`), and the guest→main→chrome hop has no cross-pipe ordering guarantee — the same hazard that justifies the tab bookend's 1500 ms grace. Without it the failure is *intermittent*, which is the worst available shape.

Also carried: the bookmark declaration takes its **own** record field — `dragWcId` is a single slot per window (`window-registry.js:99`) and reusing it would clobber a tab drag in flight.

### 2026-08-05 — Leg 4 design review cycle 1: **approve with changes**, incorporated

Two HIGH, both verified by the FD against the code before incorporation.

1. **The leg named the wrong security enforcement point — for the THIRD time in this flight.** AC8 said the navigation is gated by `will-navigate`/`isSafeTabUrl` (`guest-wiring.js:236`). It is not: the bar-click/omnibox path is `navigate()` → `tabNavigate({verb:'loadURL'})` (`navigation-controller.js:89`) → `ipcMain.on('tab-navigate')` (`register-tab-ipc.js:735`) → `wc.loadURL()`, and **Electron does not emit `will-navigate` for a programmatic `loadURL`**. The real gate is `register-tab-ipc.js:743-751`, trust-branched (`isInternal ? isInternalPageUrl : isSafeTabUrl`) with an `ownsTab` check ahead of it. End behaviour was still safe; a reviewer trusting the AC would have verified a guard that never runs. Also corrected: AC8's test was **vacuous** — `bookmarks-store.js:77-79` makes a non-`http(s)` bookmark unstorable, so the bad url must be injected at the holder/forward layer.
2. **Consume-on-forward was missing, and its absence widened the residual materially.** The cited bookend range stopped short of `register-tab-ipc.js:693-700`'s *"a successful adopt CONSUMES the registration — one drag = one drop, shrinking the post-success forgery window to ~0."* Without it, during any bookmark drag **plus its grace window**, *every* guest in that window — including background tabs never dropped on — could fabricate a `DragEvent` and navigate itself, repeatedly. The leg's edge case had waved this away as "the navigation they were performing anyway"; that was wrong. New **AC6b**: one navigation, in one tab, per drag.

**This is now a pattern, not three coincidences.** Leg 1 cycle 1 (guard 5 vs `out-of-jar`), leg 1 cycle 2 (the `isSheetContents`-without-`sheetMenuFor` direction), and now leg 4 (`will-navigate` vs the `tab-navigate` gate) are all the same failure: reasoning about a security mechanism from its *intent* or its *name* instead of tracing which predicate actually executes on the specific path. Each was caught by review rather than by the FD's own citation audit, which checks that a cited line *exists* but not that it is *on the path*. **The debrief should propose a check for this: when an AC names a guard, cite the call path from the entry point to that guard, not just the guard.**

Six MEDIUM incorporated. Two changed the design's shape:

- **The "no competing default" reasoning was wrong, though its conclusion survives.** The leg explained DD5b's result as "Electron lacks Chrome's browser shell." The probe cannot support that — `29 dragover / 0 drop` cannot distinguish "no shell nav exists" from "the drop was rejected before any default could run," and once our preload preventDefaults `dragover` a `drop` **is** dispatched, a regime the probe never entered. The two real protections are Blink's navigate-on-drop path being gated on the document not having handled the drag (so our own `preventDefault` suppresses it), and Electron's `navigateOnDragDrop` defaulting to `false` (set nowhere in this repo). Recorded because an implementer reasoning from the wrong model would draw wrong conclusions elsewhere.
- **AC7 was framed as an intermittent race; it is the primary path.** The drop is in the guest process while `dragend` fires in the chrome essentially at release, and the signal must cross a macrotask plus two IPC hops — **`dragend` wins on virtually every drop**. Framing it as a race would have invited an implementer to treat the holder as defensive hardening. The "dragend before the signal" ordering is now the **default** test case.

Also incorporated: **frame scope**, previously unspecified — `webview-preload.js` runs in every frame (hence its `IS_TOP_FRAME` gating elsewhere), so the leg now *decides* all-frames, with the rationale that main navigates the tab rather than a frame, making the outcome identical while top-frame-only would silently fail on iframe-heavy pages; **AC1 gained an autonomous half** (drive the finished chain with synthetic `DragEvent`s as leg 3 did) because an AC verifiable only at HAT is exactly the block-or-fabricate trap; **`setTimeout` must be captured at document-start**, since `contextIsolation` is off and a page can monkeypatch it at drop time to defeat page-wins or suppress the navigation; the **cross-window drop** case (refused — deliberate no-op) and **AC10's structural guarantee** (leg 3's chrome `drop` swallows non-reorder zones and the guest is a separate view, so no double-handling is construction, not a guard); the **bundle is generated** and must not be edited; and an honest bound on AC2's unit test, which pins the fake's dispatch ordering rather than Chromium's — the real check is the HAT fixture page.

Adopted from Suggestions: the **closer precedent is `guest-vault-gesture`** (`register-browser-ipc.js:116-123`), byte-for-byte DD6's shape — a `contextIsolation:false` guest sending a payload-free gesture, main deriving the wcId from `event.sender.id`, forwarding a bare trigger — already unit-covered, and a better model for the signal half than the tab bookend; and **`bookmarks-bar.js`'s `navigate` dep is active-tab-only**, contradicting AC9, so a per-wcId `tabNavigate` dep is budgeted rather than discovered mid-implementation.

Confirmed sound and left alone: the macrotask discriminator's reasoning; `event.sender` targeting as a real resolution of the tab-switch-mid-drag open question (leg 3's `dragActive` already keeps the source node alive across a switch, and jar is captured at `dragstart`); and every citation in the original audit.

No second cycle — the changes are additive specification plus two corrected rationales; no approach moved, and the flight-end Reviewer covers the code.

### 2026-08-05 — FD note: the leg-4 `dropEffect` risk is largely retired by session 3's own data

Leg 4 shipped without setting `dropEffect` in the guest's `dragover` (the leg said "preventDefault(). Nothing else"), and the implementer flagged it as **the first thing to check at HAT** if a physical drag previews but refuses to drop — reasonably, since `tab-controller.js:499` carries *"dropEffect = 'move'; // MANDATORY (spike probe3) — else the drop is silently rejected."*

**Operator session 3 already bears on this.** The DD8 sheet probe's handler was exactly:

```js
window.addEventListener('dragover', (e) => { e.preventDefault(); bump('gfProbeDragover'); }, true);
```

— `preventDefault()` and **no `dropEffect`** — and it recorded **`drop: 2`** from a real physical drag whose source was leg 3's bookmark item. So on this rig, in a cross-surface `WebContentsView` target, `preventDefault()` alone is sufficient for `drop` to be dispatched.

**Bound on the transfer**: session 3's target was the overlay **sheet**; leg 4's is the **guest**. Both are `WebContentsView`s and both were reached by the same physical drag source, so the evidence transfers well but is not identical. `tab-controller.js`'s MANDATORY note is most likely specific to the tab drag's `effectAllowed: 'move'` needing a matching `dropEffect` for the OS to accept a *move* — a constraint a bookmark drag does not obviously share.

**Disposition**: keep it on the HAT list, but demote it from "expected failure" to "confirm". If a physical drop onto the page does fail, `dropEffect` is still the first thing to try — and now with a recorded reason to be surprised rather than a shrug.

### 2026-08-05 — Leg 5 (`bar-overflow-drag`) risk tier: **HIGH**

New cross-surface mechanism (the sheet becomes a **drag source** for the first time — `grep draggable src/renderer/menu-overlay.js` currently returns nothing); a standing addressing ruling (index-vs-id dispatch, deferred here by the Flight 1 debrief); and a suppression that interacts with existing close behaviour (`closeOverflowIfOpen`).

**The leg is deliberately asymmetric about what is proven.** Session 3 measured **chrome → sheet** viable (23 dragenter / 200 dragover / 2 drop, custom MIME intact). It did **not** measure **sheet → chrome**, which is a different transport question with no source in existence. This flight has had two verdicts overturned by assuming things about drags, so AC1 measures the reverse direction *before* it is built, with the negative-probe audit attached — and if it is not viable, the leg escalates rather than silently shipping one direction of a two-direction criterion.

**The interaction is the operator's, not inferred.** Spring-loading (hover the chevron mid-drag → menu opens), a sheet-side placement indicator, and the ruling that the menu *should* close at drag start all come from session 3's live observations. A throwaway probe already proved spring-loading works mid-drag (65 chevron dragovers, menu opened), so this leg productionises a measured mechanism rather than inventing one.

**AC6 makes the dispatch ruling depend on AC7, not on taste.** The frozen index snapshot is safe *only because* `closeOverflowIfOpen` closes the sheet on any same-jar `bookmarks-changed`. AC7 must suppress that during a drag (or the reverse direction destroys its own source) — and if that suppression weakens the staleness guarantee, index dispatch stops being safe and id-based addressing becomes required. The two criteria are coupled and the leg says so.

**Note on autonomy**: AC1 needs a physical gesture, so this leg cannot be fully implemented in one autonomous pass. Sequencing is design review → FD-run operator probe → implementation shaped by the verdict.

### 2026-08-05 — Leg 5 design review cycle 1: **approve with changes** (four HIGH), incorporated

Four HIGH, all verified by the FD before incorporation. One would have shipped a wrong write.

1. **AC4's index formula was wrong.** `moveIndex` splices out **first**, then inserts (`tab-order.js:46-49`), so `toIndex` is a **post-removal** index; for bar → overflow `fromIndex < toIndex` always, so everything past the removal point shifts down one. Measured directly (`order = A..J`, `visibleCount = 8`): `toIndex 8` → `BCDEFGHIAJ`; `toIndex 7` → `BCDEFGHAIJ`, in which the item is **still visible** and never overflows at all. The visible/overflow boundary **moves as part of the operation**, which is why a formula is not a specification. Ruled: pass `visibleCount + snapshotIndex` to `moveIndex` unchanged, pin the **literal expected full-list order** in the test rather than re-deriving the formula, and let HAT confirm it lands where the indicator drew. Also: **`visibleCount` is not retained anywhere** — `applyOverflowPartition` uses it locally and keeps only `overflowSnapshot`, so the formula referenced state that does not exist.
2. **The commit would not survive `dragend`** — leg 4's lesson repeating one leg later. The sheet's drop crosses two IPC hops while the bar item's `dragend` fires locally at release, and leg 4 already **measured** that `dragend` wins on virtually every drop. `dragend` nulls `dnd` and calls `render()`, which rewrites `overflowSnapshot` — so the bookmark id, the jar, *and the snapshot the index was computed against* are all gone by arrival. New **AC4b**: carry `{bookmarkId, jarId, visibleCount}` across `dragend` on leg 4's `DRAG_HOLD_MS` pattern.
3. **AC7's suppression gate cannot be armed for a sheet-sourced drag.** `dragActive` is set/cleared in the *bar item's* own `dragstart`/`dragend`; a drag sourced in the sheet fires neither in the chrome — and with **no local `dragend` there is no flush point either**. "Extend the existing gate" was right in spirit and not implementable without a sheet → chrome **drag-lifecycle** channel carrying start *and* end. New **AC7a** makes that channel a deliverable rather than an assumption.
4. **AC8 misidentified what needs a channel, and channel 4 is disqualified by a side-effect rather than by size.** `menu-overlay:activated` **closes the sheet** (`register-overlay-ipc.js:106`) and dispatches — for a `bookmark:<i>` id that **navigates the current tab** (`bookmarks-bar.js:517-518`). The 24-char cap applies only to `value`; `id` is unbounded. Meanwhile the bar → overflow drop payload needs no channel at all, since the chrome's document `drop` reads `dataTransfer` synchronously. Pre-decided: dedicated `invoke`/`send` for the lifecycle and the drop index.

**AC6 was reframed — the first draft named the wrong dependency.** It claimed the frozen snapshot is safe *only because* `closeOverflowIfOpen` closes on change. In fact `closeOverflowIfOpen` has one caller (the cache's `onChanged`), covering the `render()` path but **not** `onResize()` — and `win.on('resize')` does not close the sheet, so **a window resize with the overflow open already rewrites the snapshot under live rows today**, a pre-existing defect this leg must now dispose of rather than leave unstated. The real invariant is snapshot ↔ rendered-rows **lockstep**, and the coupling runs *opposite* to the claim: `dragActive` already suppresses both writers, so suppression makes index dispatch **more** safe.

Also incorporated: **AC2 must use `openOverflowMenu` (`open`), never `trigger`** — `trigger` refuses to re-open within `BLUR_REOPEN_SUPPRESS_MS = 300` of a blur close, and the sheet is blur-closed at drag start, so copying the chevron's own click path would silently never spring; **AC1's probe must set `BOOKMARK_DND_MIME`**, or the chrome's `dragover` never `preventDefault()`s and the negative is a pure artifact — the DD5b mechanism a third time — with counters on `<body>` (DD1f preserves them deliberately) and the chrome-side counters attached to leg 3's **existing** handlers so the probe measures the production accept path; **AC3 needs a y-axis sibling** in `bookmark-drag.js`, since the sheet's rows are vertical and both existing helpers are x-only; the **release-on-chevron** edge case; the DD4 push-out phrased as "something is displaced" rather than naming the last-visible item (`partitionOverflow` re-runs and the count that fits can shift by one); and four more files in the fan-out against ~52 lines of `renderer.js` headroom.

Confirmed sound and left alone: AC5's external-source math (`draggedIndex = -1`), the CSP non-issue, and DD1f's scrub being harmless here (the `menu` template's `onClose` only adds `.hidden`; the real unknown AC1 measures is whether the drag survives `hide()`'s `removeChildView`).

### 2026-08-05 — Leg 5 design review cycle 2 + operator escalation: leg SPLIT, index rule RULED

Cycle 2 returned three more HIGH — including that cycle 1's AC4 fix was **still wrong**. Two design-review cycles is the cap, so this went to the operator.

**AC4, the third attempt, and the one place I checked rather than accepted.** Cycle 2 claimed two defects: an end-of-list **silent no-op** and a k≥1 **off-by-one**. Verified by running `moveIndex` directly:
- The **no-op is real**: `toIndex >= order.length` returns the same reference (`tab-order.js:42-43`), which `commitReorder` reads as "nothing moved" (`bookmarks-client.js:263`) — a drop past the last overflow row would silently do nothing, which the leg's own Edge Cases forbid. **The clamp is load-bearing.**
- The **off-by-one was not**, and cycle 2's proposed `clamp(v+k-1, …)` is worse — it collapses k=0 and k=1 to the same result. The claim assumed "insert before the original row"; the operator ruled *"land where the indicator drew"*, i.e. **the item ends at overflow position k**. Under that model `min(v+k, n-1)` is correct across the entire range, verified k=0..4 against `A..L`. Recorded because taking the reviewer's word here would have shipped a different wrong answer — a reviewer can be right about the defect and wrong about the fix.

**Operator rulings (2026-08-05):**
1. **Semantics**: land where the indicator drew; boundary displacement accepted and HAT-confirmed.
2. **Split the leg at the probe gate** → `overflow-drop-target` (5a, measured transport) and `overflow-drag-source` (5b, unmeasured, conditional).

**Other cycle-2 HIGHs, incorporated:**
- **`visibleCount` must be stored, not derived.** The derivation is arithmetically right in every state but temporally unsafe: `overflowSnapshot` is frozen during a drag while `listFor` is a live cache read updated *before* `onChanged` fires, and `render()` is suppressed — another window adding a bookmark mid-drag shifts it by one and produces a wrong write. The derive option is deleted so nobody picks it.
- **The chrome has no foreign-drag session at all** — leg 3's handlers `return` on `!dnd` and slot geometry is only captured in a *local* `dragstart`. That is the largest unwritten piece of 5b, previously unstated anywhere.
- **The lifecycle gate must be timer-bounded**, because whether the sheet even receives `dragend` after its blur-close → `removeChildView` is unknown. An unbounded latch would freeze both bar rebuild paths for the session with no recovery. The probe now counts sheet-side `dragstart`/`dragend` for exactly this reason.

**Also incorporated**: `dragend`'s unconditional `render()` has **no close partner** (unlike `onChanged`), which spring-loading makes reachable — a live sheet left rendering against a rewritten snapshot; the two new channels need the **menuType predicate named**, not just the precedent cited (`current.menuType === 'bookmarks-overflow'`) — **the fourth finding of that exact shape this flight**; the sheet's drag affordances must be gated to `bookmarks-overflow` since `renderMenu` is shared by five menuTypes; `menuNode.textContent = ''` wipes any indicator parented there; `#sheet-menu` is already `position: absolute` so adding `position: relative` would break anchoring; and the spring-load dwell paints the **bar** indicator over the chevron simultaneously — two contradictory indicators.

**AC8's direction error corrected**: it is **overflow → bar** whose payload needs no channel (the chrome's document `drop` reads `dataTransfer` synchronously), not bar → overflow, whose release lands in the sheet where the chrome's handler never runs.

## Anomaly — 2026-08-05 — `bookmarks-bar.js` shipped with LITERAL control bytes, silently defeating grep

**Found during FD verification of leg 5a, and only because a claim did not reconcile.** The agent's report referenced a `dragHold` record; `grep dragHold src/renderer/chrome/bookmarks-bar.js` returned **nothing**. Chasing that inconsistency — rather than assuming the report was loose — surfaced the real cause.

**What was wrong.** `snapshotKey` (`bookmarks-bar.js:549`) uses a NUL sentinel for a missing id and SOH as a join separator — a reasonable "cannot collide with a bookmark id" choice. But the **raw bytes** were written into the source instead of the escape sequences:

```js
return snapshot.map((b) => (b && b.id) || '<literal 0x00>').join('<literal 0x01>');
```

**Why it matters, and why it is not cosmetic.** It is legal JavaScript — the suite was green at 3527/0 throughout, and `git diff` still treated the file as text (532/11, not `-`). But `file` reports it as `data` and **GNU grep treats such a file as binary, returning no matches rather than an error**. Every grep against this 847-line file came back empty, for the whole file, silently. That is a trap for any future grep-based audit — including a human reading the code, a reviewer verifying a citation, or an agent instructed to `grep` before editing. This flight has leaned on grep-verified citations at every leg; a file that silently answers "no matches" to all of them is a live hazard.

**Fix**: literal bytes replaced with `'\x00'` / `'\x01'`. Behaviour is byte-identical at runtime — the string values are unchanged. `file` now reports `JavaScript source, Unicode text, UTF-8`; grep returns 8 `dragstart` and 14 `dragHold` matches, confirming the implementation was exactly as reported and merely invisible.

**Swept the rest of `src/`** for literal control characters (0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F): **none**. This was isolated.

**Gates after the fix**: 3527 pass / 0 fail, typecheck and lint clean — unchanged, as expected for an encoding-only correction.

**For the debrief.** Two things. First, the near-miss: had the FD accepted "the report says `dragHold` exists" without reconciling it against a failing grep, this would have shipped. Second, and more useful — **a green suite plus a clean `git diff` did not surface it**, because neither reads the file the way a person or a grep-based tool does. A `git grep -I --files-without-match` style check, or a lint rule banning literal control characters in source, would catch the whole class cheaply. Worth proposing.

---

## Operator Session 4 — 2026-08-06 — leg 5b gate: **VIABLE**, and the latch hazard does not exist

The closing probe of `overflow-drop-target`, answering the two questions that gate `overflow-drag-source`.

### Results

| Surface | Counter | Value |
|---|---|---|
| Sheet | `dragstart` | **1** — armed |
| **Sheet** | **`dragend`** | **1** — the sheet DOES see its own drag end |
| Chrome | `dragover` | **54** |
| Chrome | `drop` | **1** |
| Chrome | drop types | `application/x-goldfinch-bookmark \| chromium/x-drag-id` |

**1. Sheet → chrome transport is VIABLE.** A drag started inside the sheet delivers `dragover` and `drop` to the chrome with the custom MIME intact. **`overflow-drag-source` exists**; criterion 6's both-directions clause is achievable and needs no operator renegotiation.

**2. The latch hazard does not materialise.** `dragend` **fires in the sheet** despite the blur-close → `hide()` → `removeChildView` that leaves the source button `display:none` in a detached view. So 5b's lifecycle gate has a real clear signal. **The timer bound stays** — as defence-in-depth against a path that does not clear rather than as the only recovery — and 5b's AC3 test that never sends `end` remains worth keeping.

### Probe hygiene — all three requirements met

- **`BOOKMARK_DND_MIME` was set by the source.** Non-negotiable: the chrome's document `dragover` only `preventDefault()`s for that type, so without it `drop` is never dispatched and any negative is an artifact — the DD5b mechanism, which this flight has now had to respect three separate times.
- **Chrome-side counters were attached to leg 3's PRODUCTION handlers**, after `preventDefault`/`dropEffect` and before the `!dnd` bail — so the probe measured the real accept path, not a lookalike.
- **Counters on `<body>` dataset**; the sheet-side read needed a re-open, exactly as predicted (the gate refuses a null menuType).

### Two instrument defects caught BEFORE the gesture, not after

Both would have produced a false negative, and both were caught by the discipline rather than by luck:

1. **The readback grep was wrong, not the probe.** `readDom` returns JSON-escaped HTML, so `draggable="true"` appears as `draggable=\"true\"`; a naive `grep 'draggable="true"'` returned **0** and read exactly like "the probe failed to arm." Parsing the JSON instead showed `<button class="cm-item" role="menuitem" tabindex="0" draggable="true">` immediately. **Lesson: parse `readDom`'s JSON; never grep its escaped payload.**
2. **Earlier the same session, `grep` returned nothing for a 44 KB file** because of the literal-control-byte defect (see the Anomaly entry). Two independent grep-based readbacks silently lied in one session. That is a pattern worth carrying into the debrief: **a grep that returns nothing is not evidence of absence until the file and the escaping have both been checked.**

### Cleanup

Probe removed from both files (`grep` for every probe identifier returns zero files). Gates after removal: **3527 pass / 0 fail**, typecheck and lint clean. App stopped.

---

## Operator Session 1 — 2026-08-05 — PARTIAL: gate verified live, DD8 probe BLOCKED on the rig

Ran after `automation-gate` and `carried-debt` landed. Two of the session's four items completed; the drag probe is blocked by an environment fault, not by anything in the code.

### Environment — X11 confirmed empirically, not assumed

`WAYLAND_DISPLAY=wayland-0` is set on this rig, and `ozone-platform.js:60` makes the dev launcher pick Wayland whenever it is — which would have made any drag reading **void**, since Wayland cancels a drag leaving its source surface. Launched instead with the flag `cross-window-drag.md:62` already documents:

```
GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --ozone-platform=x11
```

Confirmed X11 by **`xlsclients` listing `electron` as an X11 client**, not merely by the flag being present on the command line. Admin tier confirmed by a successful `getChromeTarget` (the prerequisite's own standard — not tab enumeration). Connected via `scripts/lib/mcp-client.mjs`'s `connectAutomation()` against the freshly minted `AUTOMATION_DEV_MINT` key, never a static `.mcp.json` entry.

### COMPLETED — the DD1 gate, verified against a live vault-capable sheet

With `bookmark-edit` open on the shared sheet (`sheetWcId 4`), at **admin tier**:

| Op | Result | What it demonstrates |
|---|---|---|
| `readDom` | **admitted** | AC1 — menuType allowlist admits. Returned `<body data-gf-probe-armed="1">`, also proving the readback path |
| `readAxTree` | **admitted** | The accessibility-tree half of mission **Known Issue 2** — first automation read of this surface since Flight 1 |
| `evaluate` | **refused**, `automation: secret-sheet` | **AC3/DD1a** — the op allowlist refuses a non-admitted op at admin tier *under an admitted menuType*. The exact defect cycle 2 caught in the leg's first draft, now demonstrated closed on the real surface |

That is leg 1's AC7 behavioural half and the DD1e / Known-Issue-2 live evidence, banked. It stands independently of the drag probe.

### BLOCKED — DD8 axis-(b) probe not run

**The operator's mouse cursor is invisible over the app window on this rig.** Three launches attempted: X11 with default GPU, a restart, then X11 with `--disable-gpu --disable-gpu-compositing` (chosen because the log shows `dri3 extension not supported`, `WebGL1 blocklisted`, and `drmGetDevices2() has not found any devices` — a degraded graphics path). The fault persisted through all three. This is a WSLg/XWayland rendering fault, not behaviour of the app under test.

**The probe was NOT attempted, deliberately.** A drag performed without a visible cursor cannot distinguish *"the transport does not deliver"* from *"the gesture never started"* — the operator cannot confirm where the press landed or where the release happened. That is exactly DD8's stated discipline (*a negative result is a hypothesis about the instrument before it is a fact about the system*), and exactly the mistake Flight 1 already made once, recording "cross-surface drag not viable" from a probe that never called `preventDefault()`. Since this verdict gates whether `bar-overflow-drag` exists at all, a bad reading is expensive in both directions. **Guessing was declined; the measurement is deferred to a working rig.**

Switching to Wayland to dodge the cursor fault was considered and refused — it would void the reading rather than fix it.

### Probe instrumentation — REMOVED from the tree

The in-source probe (window-level `dragover`/`dragenter`/`drop` listeners in `menu-overlay.js`, counters on `<body>` data attributes, `preventDefault()` on `dragover` per the Flight 1 lesson) was written, armed, and confirmed live via `readDom` — then **removed** rather than left across the restart, so it cannot be swept into the flight-end commit. Verified: `grep -rc "__GF_DRAG_PROBE\|gfProbe" src/` returns nothing, and `menu-overlay.js`'s remaining diff is leg 1's DD1f change alone.

The exact snippet is stashed in the session scratchpad as `dd8-probe.snippet.js` for instant re-application. Re-applying is an append to `menu-overlay.js` plus a restart.

**Gates re-verified after removal**: 3394 pass / 0 fail, typecheck and lint clean.

### Outstanding from this session

- [ ] **DD8 axis-(b) probe** — gates `bar-overflow-drag`. Needs a rig where the cursor is visible over the app under X11.
- [ ] **DD1e residue checks** — `vaultInput.value` at `menu-overlay.js:618` and `:668`; live co-residency read under both admitted menuTypes.
- [ ] **DD1c live confirmation** — `captureWindow` omitting the sheet layer under a live `vault-unlock`.

None of these blocks `bar-drag-reorder` or `drag-onto-page`.

### Incidental state

One bookmark was created on `https://example.com/` in the `disposable` jar as the session fixture. Harmless; noted so it is not mistaken for test data later.

---

## Operator Session 2 — 2026-08-05 — DD8 axis-(b): **INCONCLUSIVE — verdict withdrawn, see the correction at the end of this entry**

Rig cleared after an operator reboot (the cursor-invisible fault of session 1 did not recur). Launched X11-forced, `xlsclients` confirming `electron` as an X11 client, admin tier proven by `getChromeTarget`.

### Apparatus note worth carrying forward

The MCP server bound to **port 49709, not the documented default 49707** (the production free-fallback path, after earlier instances held the lower ports). **Nothing in the launch log prints the bound port** — it was found with `ss -ltnp`. A future session that assumes 49707 gets a bare `UND_ERR_CONNECT_TIMEOUT` with no hint why. Worth a line in `docs/mcp-automation.md`.

### Verdict — axis (b) is NOT VIABLE, and the mechanism is known

**Method.** Identical probe listeners (window-level, capture phase, `preventDefault()` on `dragover`) armed on **both** the sheet and the guest beneath it, then **one** operator gesture — press-and-hold on a tab, drag to y≈400, release — so the two surfaces were measured under the *same* drag session rather than two gestures that might differ.

| Surface | dragenter | dragover | drop | payload |
|---|---|---|---|---|
| **Guest** (wcId 2, beneath) | 22 | 137 | 2 | `application/x-goldfinch-tab\|chromium/x-drag-id` |
| **Sheet** (wcId 4, above) | — | — | — | — |

**The drag reached the guest UNDERNEATH the open sheet and never touched the sheet.** The sheet was open (`sheetVisible: true`), measured at **1398×780** — exactly `#main`'s bounds — so it covered the drop point. It is not that cross-surface drag fails; it demonstrably works. The overlay sheet is simply **not a drag target while a drag is in flight**.

Corroborated by direct operator observation, which is what redirected the investigation: *"when dragging, everything disappears except the tab itself; when the page rehydrates the popover is gone."*

### Instrument audit (DD8 requires this BEFORE a negative is written down)

Flight 1 recorded "cross-surface drag not viable" once from a probe that never called `preventDefault()`, and Flight 2 would have been designed around a limitation that did not exist. Every way this reading could lie, and why it does not:

| Hypothesis | Refuted by |
|---|---|
| The probe is broken | Identical listener code fired **137×** in the guest, in the same gesture — the **positive control** |
| The sheet did not cover the drop point | Sheet view measured 1398×780 at `#main`'s exact bounds (top 119) |
| The probe was not armed on the sheet | `data-gf-probe-armed="1"` read back live, before and after the gesture |
| Close/reopen wiped the counters | `armed` survived that same cycle — `closeAll()` touches `#menu-root` only, as DD1a's premise says |
| Wrong sheet read | wcId 4 is window 1's sheet; the gesture was in window 1 |
| Missing `preventDefault` (Flight 1's exact trap) | Present in both probes; the guest proves the pattern works |

Three earlier hypotheses were tested and **refuted** rather than assumed, which is why the investigation took as long as it did: a synthetic outside-click did **not** dismiss the sheet; a programmatic window raise did **not** blur-close it; and the sheet was **not** mis-sized. The first probe run produced an unexplained negative and was deliberately **not** recorded as a verdict.

### Consequences

1. **`bar-overflow-drag` cannot be built as designed.** Criterion 6 requires bar↔overflow in **both** directions; the chrome→sheet direction is dead at the transport layer. Mission Open Question 3 pre-authorizes the renegotiation to click-only — **operator confirmation required**, per the flight's Adaptation Criteria (it changes a mission criterion, so it is a diversion, not an acceptable variation).
2. **`drag-onto-page`'s transport is now verified twice.** The guest row independently reproduces Flight 1's axis-(a) result — different operator, different session, custom MIME intact. DD5b's baseline measurement still stands separately.
3. **The finding is broader than the transport question.** Even had the sheet received events, the operator's observation implies overlay surfaces are torn down for the duration of a native drag — a constraint no transport capability fixes.

### Also banked this session (leg `automation-gate` live verification)

- `readDom` **refused** on the sheet while no menu was open — **DD1d's `null` refusal**, demonstrated live.
- `readDom` / `readAxTree` **admitted** under `bookmark-edit`; `evaluate` **refused** under that same admitted menuType (session 1).

### Cleanup

Probe removed; `grep -rc "__GF_DRAG_PROBE\|gfProbe" src/` returns zero files. Gates re-verified after removal: **3394 pass / 0 fail**, typecheck and lint clean. App stopped, no survivors.

### ⚠ CORRECTION — the "NOT VIABLE" verdict above is WITHDRAWN (operator challenge, same session)

The operator asked: *"why are we talking about tabs? are you going to use the same mechanism for the bookmarks?"* That question exposed a hole in the instrument audit, and the audit above is **wrong by omission** — it verified that the *measurement* was sound and never asked whether the *stimulus* was representative.

**Two defects in the experiment:**

1. **The drag source was a tab, and tab drags are not representative.** A tab drag carries tear-off machinery a bookmark drag will never have — including `tearoff-overlay-manager.js`, which mid-drag calls `addChildView` to raise a 260×28 pill (`:104-114`, `PILL_W`/`PILL_H` `:24-25`) **above the guest**, mutating the window's view stack during the very gesture under measurement. The bar item that `bar-drag-reorder` will make draggable has none of that. A tab was used only because it is the sole `draggable=true` element that exists today — a convenience, and it was not disclosed as a limitation.

2. **A mitigation was never tested before the feature was declared dead.** `closeMenuOverlay` (`menu-overlay-manager.js:376`) exempts a **`dismissible: false`** menu from exactly the three soft dismiss reasons — `escape`, `outside-click`, and **`blur`**. The most consistent explanation for the reading is that the sheet is dismissed at drag start (a native drag grabs input, the window blurs, `window-factory.js:324` closes the sheet) and the guest — newly topmost after `hide()`'s `removeChildView` — receives the drag instead. **If that is the mechanism, pinning the overflow sheet non-dismissible for the drag's duration defeats it**, and axis (b) is viable after all. That experiment costs one gesture and was not run.

**What is actually established:**

- **Measured, and it stands**: a chrome-initiated native drag delivers `dragover`/`drop` into the **guest** with the custom MIME intact (137/2, positive control). This independently reproduces Flight 1's axis-(a) result and is good evidence for `drag-onto-page`.
- **Measured, and it stands**: under *this* stimulus, with a *dismissible* sheet, the sheet received nothing.
- **NOT established**: whether the sheet is intrinsically unable to receive native drags, or is merely **dismissed before it can**. These have opposite consequences for `bar-overflow-drag`, and the reading cannot tell them apart.

**Disposition**: DD8's verdict is **inconclusive**, not negative. The mission amendment renegotiating criterion 6 to click-only is **NOT** taken; `bar-overflow-drag` stays gated rather than dropped.

**Next experiment** (one gesture, small instrumentation): pin the target sheet `dismissible: false`, re-arm both probes, repeat. If the sheet counters fire, the mechanism is dismissal and the feature is viable with a "pin the sheet while a bookmark drag is live" design. Better still, run it with a real `draggable` bar item once `bar-drag-reorder` builds one — which removes the stimulus-representativeness defect entirely and argues for **deferring this probe until after that leg**.

**Methodology note for the debrief.** Flight 1's lesson was *"a negative probe result is a hypothesis about the probe, not a fact about the system."* This session applied that to the measurement — six refutation hypotheses, a positive control — and still nearly shipped a wrong verdict, because a representative-stimulus check and a mitigation check were not part of the ritual. Both belong in it.

### Still outstanding

- [ ] **DD8 axis-(b)** — re-run with a real bookmark-bar drag source and a non-dismissible sheet. Best sequenced **after** `bar-drag-reorder`.
- [ ] **DD1e residue checks** — `vaultInput.value` at `menu-overlay.js:618` and `:668`; live co-residency read under both admitted menuTypes.
- [ ] **DD1c live confirmation** — `captureWindow` omitting the sheet layer under a live `vault-unlock`.

Neither blocks `bar-drag-reorder` or `drag-onto-page`.

---

## Decisions

*(runtime decisions recorded here as they are made)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### 2026-08-04 — Flight planning

Context gathered across the mission, both prior flights' debriefs and logs, and the bookmarks/drag source. Four design questions put to the operator in two rounds; all resolved (DD1, DD3, DD4, DD5, DD6, DD8, DD9, DD10, DD11).

Load-bearing findings from code interrogation, each verified rather than assumed:

- **`menu-overlay-manager.js:383` already exposes `getCurrentMenu()`** returning `{ menuType, token, jarId? } | null`, and `window-registry.js:219`'s `isSheetContents` already walks the records to find the matching sheet. DD1 needs no new state — only a second accessor on a walk that already happens.
- **The token-freshness idiom DD1 reuses is already proven** at `register-overlay-ipc.js:543` on the bookmark-edit submit channel. DD1's TOCTOU close is a reuse, not an invention.
- **`dropIndexFromPointer` (`tab-order.js:107-118`) carries no tab semantics** — plain `{left, width}` rects. Directly reusable; DD3 rests on this.
- **`register-overlay-ipc.js:573` closes the sheet *before* forwarding the submit to the chrome.** This is what makes the inline-error path structurally unavailable to `surfaceRejection` and is the reason DD9 resolves to removal rather than to a surface fix. Not previously recorded anywhere.
- **`webview-preload.js` runs in the guest main world with `contextIsolation` off** (`:10`, `:231-234`), which is the entire premise of DD6.
- **`renderer.js` = 1588 lines against a 1650 budget** — measured with `seam-contract.test.js:178-180`'s own metric (`split(/\r?\n/)`). *This line originally read 1587 and claimed the same provenance; it was `wc -l`. Corrected at design review — see cycle-1 item 10.*

Deliberately left open and gating: the axis-(b) transport verdict (DD8). Legs 2 and 3 do not wait on it.

### 2026-08-04 — Design review cycle 1: **needs rework**, incorporated

The Architect returned `needs rework` with three high-severity findings against DD1, DD3, and DD5, each resting on a premise the FD had asserted rather than verified. All three were **independently re-verified by the FD against the code before incorporation** — not taken on the agent's word — and all three held.

**Confirmed and incorporated:**

1. **DD1 reopened the vector the guard closes (HIGH, reverses the decision).** The sheet is one WebContents with one persistent document reused for every menu: `ensureView()` constructs once (`menu-overlay-manager.js:182-216`), `hide()` is `removeChildView` alone (`:244-249`), and `teardown()` — the only destroy — runs on `render-process-gone` and window close only (`:161-179`). The module header says it outright: *"the hidden sheet keeps its rendered menu DOM"* (`:61-63`). So JS injected under `bookmarks-overflow` is still resident when the same realm renders `vault-unlock`. **A pre-execution token check cannot revoke already-resident code**, so the original decision's own revert criterion ("if the token re-check has a hole") would not have caught this. Split into DD1/DD1a — admit only non-residual read ops; refuse `evaluate`/`injectScript`/`openDevTools` on the sheet unconditionally. **Cost: mission Known Issue 2 is re-scoped rather than closed** (axe-core needs injection), and the DD8 probe loses `evaluate` and reverts to in-source instrumentation with a `readDom` readback.
2. **DD1's threading was under-budgeted (HIGH).** `resolveContents` returns a bare `wc` across 29 call sites in 7 op modules, several resolving twice around an `activate`. Snapshot moved to `engine.js`'s per-op `deps()` (one site, covers every re-resolve). Post-await re-check added for `captureScreenshot` and `readAxTree`, reusing `main.js:604-609`'s existing "DD7 post-await re-check (TOCTOU)" idiom. → DD1b.
3. **DD3's justification was false (HIGH).** The claimed visible→full index translation is the **identity function**: `itemEls()` returns all `.bm-item` children in full-list order (`bookmarks-bar.js:149-151`) and the hide is a strict tail (`:245`). The real requirement is filtering hidden items out of the slot-rect array before measuring — `.bm-item.hidden` is `display: none` (`styles.css:729-731`), so they report zero-width rects at left 0 and `dropIndexFromPointer` counts every one. Had this shipped, leg 2 would have unit-tested a function with no terms, and the Flight 2 fixture rule would have been applied to it.
4. **DD5's discriminator was backwards (HIGH).** "Bubble phase means page handlers run first" holds only for nodes *below* `document`. The preload runs at document-start, so its `document` listener is first in registration order and fires *ahead of* a page's `document`-level dropzone — reading `defaultPrevented === false` and destroying the very drops the decision exists to protect. Fixed by deferring the read to a `setTimeout(…, 0)` macrotask. **`queueMicrotask` is explicitly insufficient** and is called out in the DD: a microtask checkpoint runs after each listener callback whenever the JS stack is empty, and for a browser-dispatched event it is empty between listeners.
5. **DD2 contradicted itself.** "The guest never reads the custom type" is not implementable — the `dragover` handler must gate on `types.includes(…)` or it preventDefaults every drag on every page. Corrected to: the guest reads `types` (permitted in protected mode), never `getData`.
6. **`captureWindow` already composited the sheet (MEDIUM, pre-existing).** `main.js:598-615` — so "refused at every tier" was already false, and at admin tier it returns pixels of `vault-unlock` and the one-time recovery-key display. Shipping DD1 while leaving this open would be incoherent. → DD1c, gated on the same predicate.
7. **DD1's TOCTOU evidence was misattributed (MEDIUM).** `auth-challenges.js:442` is inside `cancelForTab` (the *close* path), and `presentNext` refuses to present while any menu is open (`:264`). An auth sheet **cannot** model-replace an open `bookmarks-overflow`. The decision survives; the `null` refusal is carrying more load than the token re-check. → DD1d.
8. **DD6 gaps (MEDIUM).** `dragWcId` is a single slot per window record (`window-registry.js:99`) — a bookmark drag reusing it clobbers a tab drag's declaration; a distinct field is required. And the chrome-side session needs a grace window past its own `dragend`, since the guest→main→chrome hop has no ordering guarantee against it — the same cross-pipe hazard that justifies the tab code's 1500 ms grace timer.
9. **Reorder was a read-modify-write over a stale cache (MEDIUM).** DD7 mandates full id lists; `listFor` is a cache read. A bookmark added by another window and not yet broadcast would be omitted, and the store's forgiving rule would silently append it to the end with `{ok:true}`. → DD6b: re-read via `bookmarksGet` before commit, plus a stated freshness contract for the mutation path.
10. **DD12 reproduced the exact off-by-one the Flight 2 debrief recorded as a Key Learning.** The prerequisite claimed to use "the pinning test's own metric" but used `wc -l`: 1587/63. The test uses `split(/\r?\n/)`: **1588/62**. Conclusion unaffected, verification claim was not. Corrected, and the correction is recorded in the DD rather than quietly fixed.
11. **DD10's `DATA_IMAGE_RE` scope (LOW).** The constant is live (`bookmarks-store.js:87`); only the export and its test are dead. Deletion scoped accordingly.
12. **Behavior spec row 9 was not executable.** Guests run `nodeIntegration: false, sandbox: true` — there is no `ipcRenderer` in the page main world, which is why DD6's own threat model has a hostile page arriving via a fabricated `DragEvent`. Rewritten as two rows: reachability of `ipcRenderer` (must fail; a success halts the run) and a fabricated `DragEvent` as the attack simulation — with an explicit banner carve-out distinguishing forbidden fabrication (substituting for a gesture) from required fabrication (simulating an attacker).

**Adopted from Suggestions:**

- **DD5b — measure Chromium's default before building.** Chromium's own handling of an un-consumed URL drop may already navigate through the existing `will-navigate`/`isSafeTabUrl` gate, in which case DD5's policy holds by construction and DD6's apparatus is unnecessary. Critically, this is only measurable **before** leg 3 writes a `dragover` preventDefault that suppresses the default — so it moved into leg 1's operator session, which now carries two probes instead of one. This is DD8's own negative-probe discipline applied one leg over.
- **`render()` suppression during a drag**, not just the `ResizeObserver` — another window's edit rebuilds the drag source mid-gesture, reachable with no tab switch at all.
- **`closeOverflowIfOpen` interaction** with leg 4's post-drop reads (the sheet closes as `'superseded'` on the broadcast; spec rows re-open before reading).
- **`dropIndexFromPointer`'s external-source case** (`draggedIndex = -1`) documented and pinned rather than silently relied on.

**Not adopted:** the suggestion to use full paths in leg citations — the flight follows the house convention both prior flights use (bare module names, since `src/renderer/chrome/` is unambiguous in this codebase). Recorded as considered.

Net effect on scope: leg 1 grows (op-class split, `deps()` threading, post-await re-checks, `captureWindow` closure, two probes instead of one); leg 3 may shrink substantially depending on the DD5b baseline; mission Known Issue 2 is re-scoped rather than closed. **No leg was added or removed.**

### 2026-08-04 — Design review cycle 2: **needs rework**, incorporated

Cycle 2 was scoped to whether the cycle-1 rework was *correct* rather than to re-litigating it. The Architect re-verified every code claim the revised spec makes and all held. It returned two HIGH findings against the rework itself, both of which the FD independently confirmed against the code before incorporating.

1. **DD1a was written as a three-op denylist over a 23-op funnel (HIGH).** `resolveContents` is the single gate for every wcId-first op, and `scope.js:49-70` enumerates 23 of them. DD1a named three admits and three refusals; **seventeen were unclassified**, and several are worse than the residency hole DD1a was written to close — `navigate(sheetWcId, url)` replaces the shared persistent document with attacker-chosen content that then hosts `vault-unlock`; `printToPDF` is a full-fidelity read by a second door (the DD1c pattern repeating one flight later); `findInPage` is a content oracle; `typeText`/`click`/`pressKey`/`dragPointer` are writes into an allowlisted sheet. The tell was that `closeDevTools` sat admitted while `openDevTools` was refused — an ad-hoc enumeration rather than a derived rule. **Restated additively**: exactly three ops admitted, everything else refused, a new op refused by default. The *"leaves nothing resident"* phrasing is retired as the rule — it was the reason for the split and is a bad test, since `printToPDF` leaves nothing resident and must still be refused.
2. **DD5b's "zero code changes" was false, and would have produced a false negative (HIGH).** `buildItemButton` (`bookmarks-bar.js:158-190`) creates a plain `<button class="bm-item">`; there is **no `draggable` anywhere in the file** (contrast `tab-controller.js:117`), and buttons are not draggable by default. In leg 1 the operator could not have started a drag at all, would have reported "nothing happened," and the flight would have recorded *"Chromium's default does not fire"* — DD8's own negative-probe failure mode, reproduced inside the decision adopted from DD8's discipline, gating leg 3's entire shape. **DD5b moved to the end of leg 2**, where DD2's work has provided a real `draggable` source; the binding constraint was always "before leg 3," never "leg 1." DD8 stays in leg 1 — its question is transport-generic and the tab strip already supplies a draggable source with a custom MIME. A drag-session-started audit was added.

Also incorporated:

3. **`deps()` cannot carry op identity (MEDIUM).** `deps()` takes no arguments and returns an identical bag per op, so the menuType half of the gate had an input and the op half had none. Adopted the reviewer's recommended shape over the obvious one: an opt-in `allowSheet: true` spread at the three admitted dispatch entries (three edits, **structurally fail-closed**) rather than `deps(opName)` (~28 edits, fail-open on a forgotten argument). This makes finding 1's failure mode unrepresentable rather than merely documented.
4. **DD1's safety rested on an unstated DOM premise — the mirror of the argument that reversed it in cycle 1 (MEDIUM).** The sheet's single document holds every menu's card DOM (`menu-overlay.html:18`, one `#menu-root`). If a `vault-recovery-show` card's `textContent` survived, `readDom` — the op DD1a *admits* — would return the one-time recovery key. It doesn't: `onInit` calls `closeAll()` before rendering (`menu-overlay.js:2317`) and the three secret cards scrub on close (`:1224`, `:1423`, `:1484`). But the premise was uncited and **pinned by no test**, because until this flight nothing could read the sheet's DOM. → **DD1e**, with a leg-1 assertion. Plus two cheap residue checks in the same session: `vaultInput.value` is cleared on *open*, not close (`:618`), so a typed master password survives in the property — expected safe for both admitted read ops, but expected is not measured and it is a secret.
5. **Post-await re-check placement (LOW).** `classifyContents` returns `'guest'` for the sheet (`resolve.js:56-60`), so both async admits `await activate(wcId)` *before* their paint/CDP awaits and then re-resolve. The re-check goes after the **final re-resolve**, covering all three windows. Also noted that `captureScreenshot` on a hidden sheet hits the documented never-settles case, making the refuse-before-capture ordering load-bearing rather than incidental.
6. **`dataTransfer` reads must stay synchronous (LOW).** It leaves protected mode when dispatch ends, so DD5's `types` gate is captured into a local inside the handler; only `defaultPrevented` is read late. Easy to get wrong once deferral makes "read it later" feel uniform.
7. **Three orphaned "index translation" claims** left by DD3's rewrite (acceptable variations, unit tests, and — most damagingly — the fixture rule, which was still instructing leg 2 to build a discriminating fixture for a function with no terms). Retargeted to hidden-filtered slot assembly.
8. **DD12's correction was not propagated** to three other places still reading 1587/63. Fixed in all of them, including this log — a DD that exists to record a published wrong number should not leave the wrong number standing elsewhere.
9. **Leg 3 under-specified in the branch DD5b exists to create.** Named explicitly: in the DD5b-positive branch leg 3 is **empty**, and the tab-switch-mid-drag open question re-homes to leg 2.
10. **Behavior spec row 10** asserted a mechanism (the DD6 bookend) that does not exist in the DD5b-positive branch. Reworded to assert the observable and record which branch produced it.
11. **`scope.js:138-145`'s `memberDeps()` does not carry `isSheetContents`** — jar keys are protected from the sheet by session identity alone. Correct today and unchanged, now stated in DD1b so a future partition change does not silently open a door this flight believed closed.
12. **Checkpoints added** for the three cycle-1 MEDIUMs that had been folded into DDs but left unverifiable: DD6b's re-read before commit, DD5's macrotask deferral, and DD6's distinct declaration field.

**Considered and not adopted**: splitting the probes into their own leg. With DD5b moved to leg 2's close, leg 1 now carries one probe rather than two and the throwaway drag-source instrumentation that motivated the split is gone — the reviewer's own condition for leaving DD8 in leg 1 ("it has a drag source today") is met. Leg 1 remains one coherent cluster.

**Two review cycles reached — the skill's maximum.** No HIGH findings remain unaddressed; the flight goes to the operator.
