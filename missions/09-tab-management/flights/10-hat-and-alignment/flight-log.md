# Flight Log: HAT & Alignment

**Flight**: [HAT & Alignment](flight.md)

## Summary

Operator-guided human acceptance test — the mission's closing gate. The Flight Director presents each
station's steps, the operator performs them on their live rig, the FD renders verdicts and fixes issues
inline (look-and-feel) or via scoped review (features) until the operator confirms alignment. Not
autonomous — the FD's session has no live rig (F9 DD9 NO-GO), so the operator drives execution.

---

## Flight Director Notes

- **Branch/stack:** `flight/10-hat-and-alignment` off the F9 head; stacks on `flight/9`.
- **Kickoff (operator):** scope = **full sequential A→F**; mode = **operator runs BY HAND** (the FD
  guides + validates + fixes; the operator is the instrument). Most stations need only the running dev
  build off `flight/10`; the automation MCP/admin key is needed only for Station E's `npm run a11y` and
  any exact-readout step the operator chooses to script. Flight → in-flight; starting Station A.

---

## Leg Progress

### Station A — Session restore (in progress)

**Checkpoint A1 — core restore + burner exclusion: PASS (with one inline cosmetic fix).**
- **Core restore PASS:** operator enabled the setting, opened tabs across two persist jars + a burner,
  quit, relaunched → **exactly the two persist-jar tabs returned** at their addresses/jars and the
  **burner did NOT** (the mission's absolute constraint, witnessed live for the first time on disk).
- **Internal-page exclusion — by design, confirmed with operator ("probably ok").** The open
  `goldfinch://settings` tab did **not** restore. This is correct: internal pages are `trusted`, and the
  snapshot's positive persist-jar allowlist drops trusted tabs by the same mechanism that drops burners
  (no persist jar to belong to). Recorded as a conscious design consequence — restore brings back web
  content in real jars, not internal chrome pages. If restoring internal pages is ever wanted, that is a
  scoped FEATURE change (include trusted tabs with URL-but-no-jar), not a defect.

**Inline fix (look-and-feel, single-surface → inline protocol): the toggle was child-indented.**
- Operator: *"the toggle is misaligned; it should be on its own line, it looks like a subtask of Home
  page."* Root cause: the row was cloned as a bare `.shield-row`, so `.shield-row:not(.shield-parent)`
  applied the 14px child indent (settings.css:196) — the exact divergence the flight-end accessibility
  review predicted. This is the standalone-control case the CSS already documents for spellcheck
  (settings.css:200: "standalone control, not a Shields child: divider above + no indent").
- **Fix:** added `.startup-toggle-group` (divider above + top margin) and `.startup-toggle-row`
  (no indent) in `settings.css`, applied to the restore fieldset/row in `settings.html`. Scoped to the
  startup section — spellcheck untouched. **Re-verified by operator ("looks good"); committed `297b34a`.
  A1 closed.**

**Checkpoint A2 — two-window menu-Exit guard: PASS.** Operator opened two windows (tabs in two persist
jars), quit via **kebab → Exit**, relaunched → **both windows returned** with their tabs/jars. This is
the two-writer coordination (the DD3 round-2 bug fix) witnessed live — the flight's highest-risk behavior.

**Checkpoint A3 — deleted-jar drop: NOT END-USER-REACHABLE (operator correctly rejected the test).**
Operator: *"I can't delete the jar without launching, as a normal end user."* Correct — the test as
designed is unreachable: you cannot delete a jar while the app is quit, and deleting it while running
**closes its tabs** (`jar-delete-closes-tabs`), so those tabs leave the snapshot at the next clean quit.
The `resolveRestoreContainer→null→drop` path therefore only fires via a **manual jars-store edit** or a
**stale-snapshot-after-crash** sequence (session A snapshot with jar X → session B deletes X but crashes
before a clean quit → session C restores A's snapshot with X gone). The **drop itself** (tab not
re-homed into the default jar) is already **unit-pinned both directions** (`restore-container.test.js`).
The only runtime-unverified residual is the **tabless-window** rendering (debrief risk #1: main creates
the window before the renderer drops the orphaned tab, so a window whose every tab's jar is gone could
restore blank). Its trigger is non-end-user-reachable. **Decision raised to operator: harden structurally
vs. document-and-defer** (see Decisions).

---

### Leg L1 (strip-visual-polish) — Implementation

CSS-only (`src/renderer/styles.css`), layout-neutral, +1 net code line (DD11 budget ≤ +12).

- **AC1 (T1) hover highlight.** Added `.tab:not(.active):hover { background: color-mix(in srgb, var(--bg-2) 60%, var(--bg-3)); }` — a paint-only tint between `.tab` (`--bg-2`) and `.tab.active` (`--bg-3`). `:not(.active)` leaves the active tab's `--bg-3` untouched; the descendant `.tab .tab-close:hover` rule does not clash. Added `transition: background 0.12s ease;` to the base `.tab` rule so the lift eases in/out (matches the file's transition idiom). No width/margin/layout change — the drag slot-rect snapshots stay valid.
- **AC2 (T2) active tab keeps favicon when shrunk.** Removed the `@container (max-width: 72px) { .tab.active .tab-fav { display: none } }` rule (the inactive-tab disclosure rules at 56px/40px are untouched). Raised the active-tab floor `.tab.active { min-width: 64px → 78px }` to seat favicon(14) + gap(8) on top of the existing 52px dot/close budget (= 74, +4px sub-pixel slack). Net: the active tab now shows favicon + jar dot + close even when heavily shrunk (its title may still hide/truncate). Inactive tabs unchanged.
- **AC3** (`responsive-tab-strip` Step 5: no scrollbar at 60+ tabs, no clipped tab, active `.tab-close` rect contained) is **deferred to the F10 verification pass** — the FD has no rig here. The CSS respects the reasoning: one wider (78px) floored active tab cannot force overflow (the 900px min window + ~4px/tab gap bound dominates across dozens of tabs).
- **Gates (standalone):** `npm run lint` clean, `npm run typecheck` clean, `npm test` **1948 pass / 0 fail** (unchanged — CSS does not affect unit tests). No a11y run — deferred to the verification pass.

---

### Leg L2 (keyboard-cycling-rearm) — Implementation

Main-only fix (`src/main/main.js` `tab-set-active`), per the design-review mechanism (read the
outgoing guest's `isFocused()`, focus the incoming iff it was page-focused — the fragile
renderer-flag-plumbing approach was rejected). **Zero renderer/preload/`renderer-globals.d.ts`
change.** +4 code lines (DD11 budget ≤ +8, est ~4).

- **The exact `tab-set-active` change (AC1/AC2).** Two additions to the `ipcMain.on('tab-set-active', …)`
  handler:
  1. **Before the visibility swap** (before the incoming `setVisible(true)` / outgoing `setVisible(false)`),
     capture the outgoing active guest's OS focus:
     `const wasPageFocused = owner.activeTabWcId != null && !!getTabContents(owner.activeTabWcId)?.isFocused();`
  2. **After the incoming guest is made visible + raised** (`owner.win.contentView.addChildView(entry.view)`):
     `if (wasPageFocused && !entry.view.webContents.isDestroyed()) { entry.view.webContents.focus(); }`
- **The accessor used.** `getTabContents(wcId)` (`main.js:661`) — it resolves the guest across all
  windows' records and **returns the guest `webContents` DIRECTLY**, already null-guarding a
  missing/destroyed guest (returns `null`). So the read is `getTabContents(...)?.isFocused()`, **not**
  `?.webContents.isFocused()` (the leg AC1 text described the return shape as a wrapper; the real
  accessor returns the webContents itself — corrected here). `owner.activeTabWcId` still points at the
  OUTGOING active tab at capture time (it is not reassigned until later in the handler), so this reads
  the tab losing focus, exactly as intended.
- **Why this preserves AC5.** `isFocused()` on the outgoing guest is precisely the "focus was in the
  page" signal: a page-content chord leaves the outgoing guest focused → focus the incoming (bug fixed);
  strip arrow/Enter nav, find-overlay, and the menu sheet all leave the outgoing guest NOT focused →
  don't focus (strip nav / find / sheet untouched). Internal/trusted incoming tabs ARE focused too
  (deliberate — cycling INTO a `goldfinch://` page must not re-orphan focus).
- **AC3 code-shape pin (both readings).** Added `test/unit/keyboard-rearm.test.js` — a masked
  source-scan (shared `test/helpers/source-scan.js` toolkit, window-closed-invariant house pattern) that
  extracts the real `tab-set-active` handler body from `main.js` and asserts it (1) captures the
  outgoing guest's `isFocused()` into a guard AND (2) conditionally `.focus()`es the incoming guest gated
  by that guard. **Both mutation directions fail the net** (synthetic-string tests, never real source
  mutation): removing the conditional focus (never `.focus()` the incoming) breaks (2); focusing
  unconditionally / removing the `isFocused()` read breaks (1). A vacuity guard fails loudly if the
  handler is renamed out of reach; a comment-masking test proves a shaped mention in prose can't satisfy
  it. **AC3 RUNTIME (two consecutive Ctrl+# from page focus, no intervening click) is the MANUAL HAT
  verification pass** — main.js is never executed by the unit suite, and a source scan cannot prove OS
  focus actually re-routes.
- **AC4 regression net.** Extended `tests/behavior/tab-cycling.md` Step 4 (guest-delivered cycling) to
  assert the REAL observable: after a guest-forwarded `Ctrl+Tab`, the INCOMING guest holds OS focus
  (`evaluate(G_next, "document.hasFocus()") === true` while the outgoing `=== false`) — the same
  `hasFocus()` technique Steps 4/5 already use on the outgoing guest. NOT a "two-chords-no-click"
  automated step: MCP `pressKey` injects via `sendInputEvent`-by-wcId, which BYPASSES OS focus routing,
  so a second forwarded chord would land regardless of the bug; two-chords-no-click stays the MANUAL HAT
  note (AC3).
- **WSLg `isFocused()` reliability.** The design review flagged one caveat — WSLg focus quirks
  (`main.js:306` documents focus-*event* quirks; this is an `isFocused()` *query*, a different path).
  To be confirmed in the live verification pass; the plumbed-`focusGuest`-flag fallback (with an
  `isSessionActive(wcId)` find guard) is the recorded contingency if the query proves unreliable on the
  rig.
- **Budget:** main.js **+4 code lines** (DD11 ≤ +8); renderer.js **+0** (main-only). `renderer-globals.d.ts`
  untouched (AC2).
- **Gates (standalone):** `npm run lint` clean, `npm run typecheck` clean, `npm test` **1953 pass / 0
  fail** (baseline 1948, **+5** from the new `keyboard-rearm.test.js` suite: 1 real code-shape pin + 4
  self-tests). No a11y run — main-only focus logic, no a11y surface; deferred to the verification pass.

---

### Leg L3 (sole-tab-move-close-source) — Implementation

Sole-tab consolidate into an EXISTING window + empty-source close, per the design-review mechanism
(the `allowSoleTab` param scoping the relaxation to the existing-window path only; `win.close()` placed
LAST, after `broadcastMoveTargetsChanged`). Built on the pre-existing uncommitted F9/F10 work in
`main.js` (L2 focus fix untouched).

- **AC1 — model gate (`src/shared/tab-context-model.js`).** Restructured
  `if (!isLastTab && !isInternal) { move-new-window; move-window:* }` →
  `if (!isInternal) { if (!isLastTab) item('tab:move-new-window',…); for (…) item('tab:move-window:${windowId}',…) }`.
  The two gates now deliberately DIVERGE: `move-window:*` rides `!isInternal` alone (a sole tab may
  consolidate into an existing window), while `move-new-window` keeps its `!isLastTab` omission (a
  sole-tab move to a NEW window is still a no-op swap). **Net 0 code lines** (2 added, 2 removed;
  budget ≤ +4). Header + inline comments rewritten to describe the divergence.
  - **`test/unit/tab-context-model.test.js` — both directions.** Replaced the old "move-window rides the
    SAME gate as move-new-window (sole tab / internal)" test (whose sole-tab half is now false) with three:
    (i) a SOLE tab + two other windows → the two `tab:move-window:*` items PRESENT, `move-new-window`
    ABSENT; (ii) a SOLE tab + NO other window → no move items at all; (iii) an INTERNAL tab → both move
    families omitted regardless of window count. (+2 tests net.)
- **AC2 — `moveTabIntoWindow` (`src/main/main.js`).** Added a defaulted param `allowSoleTab = false`; the
  guard is now `if (!allowSoleTab && source.tabViews.size <= 1) return { ok:false, reason:'sole-tab' }`.
  Empty-source close added as the **LAST statement before `return { ok:true }`**, AFTER
  `broadcastMoveTargetsChanged()`: `if (source.tabViews.size === 0 && !source.win.isDestroyed()) source.win.close();`
  (`size===0` self-selecting — only an `allowSoleTab` move can empty the source). **Only
  `tab-move-to-window` passes `allowSoleTab: true`** (`() => target, true`); the two `newWindowForMove`
  callers (`tab-move-to-new-window`, `tab-tear-off`) inherit `false` (AC3 — sole-tab → new window stays
  refused). **+1 code line** (the close; sig/guard/call are same-line edits; budget ≤ +12).
- **AC4 — renderer (`src/renderer/renderer.js` `onTabMovedAway`).** DELETED the `else createTab()` arm
  (not gated — deleted): an empty-strip `tab-moved-away` now always means main is closing the window, so
  booting a tab would race a `tab-create` into a closing window (orphan-guest leak). Kept the non-empty
  `if (next) activateTab(next)` branch; rewrote the now-false comment. Reused `moveTabIntoWindow` (the
  DD1 synchrony pin and the row-8a displaced-tab hide preserved — nothing transcribed). **-1 code line**
  (deletion; budget ≤ +4).
- **AC5 — contracts.** (a) `tests/behavior/tab-context-menu.md` **Step 9**: corrected the rationale (the
  sole tab's move-window item is absent because there is NO OTHER window, not because the tab is sole) and
  added a two-window sub-case asserting the move-window item APPEARS for a sole tab while move-new-window
  stays absent. (b) `tests/behavior/tab-tearoff.md` **Out-of-Scope**: rewrote the "cross-window adopt of a
  SOLE tab" bullet — this leg opens and resolves that question (sole-tab existing-window move + source
  disposal ships; the `else createTab()` orphan is gone), verified by the L3 runtime pass not this spec.
  (c) `tab-tearoff.md` **row 6** parenthetical: trimmed the stale cross-ref to the old OOS rationale (row
  6's sole-tab TEAR-OFF-stays-refused behavior is unchanged).
- **AC6 — code-shape pins (both readings each).** Added `test/unit/sole-tab-move-close-source.test.js` (a
  masked source-scan in the `move-core-fix.test.js` house pattern): pins (1) the guard is gated by
  `!allowSoleTab`; (2) the `size===0 → source.win.close()` empty-source close is present in the core; (3)
  ONLY `tab-move-to-window` passes `allowSoleTab` true (`() => target, true` present once,
  `newWindowForMove(source), true` absent — the mutation LEAKS it into a new-window caller and the pin
  catches it); (4) `onTabMovedAway` has no `createTab(` arm. **Finding recorded in the test:**
  `maskComments` is INVERTED in `renderer.js` at this location (its documented regex-literal blind spot —
  an upstream odd-quote regex flips parity), so the renderer pin is **paren-qualified** (`createTab(`),
  which the "else-createTab arm" comment does not carry, making the pin robust whether the mask applies or
  not; a dedicated test MEASURES that inverted-mask state so a future toolkit fix is caught. **AC6 RUNTIME
  (the actual sole-tab move + source-window close) is the MANUAL verification pass** — neither main.js nor
  renderer.js is executed by the unit suite, and a source scan cannot prove the window actually closes.
- **Necessary consequential test edits (signature change fallout).** AC2's new `allowSoleTab` param
  changed `moveTabIntoWindow`'s signature and the sole-tab guard line, so three existing source-scan tests
  that anchor on those exact strings were updated to match (not a behavior change): `move-core-fix.test.js`
  (DEFINITION_RE), `move-tab-synchrony.test.js` (four `.replace()` targets), `tab-drag-invariants.test.js`
  (the bare-null mutation target). Also reworded one `main.js` comment ("the move core closes…" instead of
  naming `moveTabIntoWindow`) to preserve `move-tab-synchrony`'s measured invariant that the anchor token
  appears nowhere in `main.js` prose (masked==unmasked==4).
- **Session-snapshot transient (acknowledged, no action).** With `restoreSession` on, the `close`-handler
  snapshot write momentarily serializes the zero-tab source (removed from the registry only at `closed`) —
  the accepted `main.js:~1289` "overwritten by the next close/quit" case; the target's move already
  corrects the set. No action, per the leg AC5 note.
- **Budget:** main.js **+1** (≤ +12), tab-context-model.js **net 0** (≤ +4), renderer.js **-1** (≤ +4).
  All within DD11.
- **Gates (standalone):** `npm run lint` clean, `npm run typecheck` clean, `npm test` **1960 pass / 0
  fail** (baseline 1953, **+7**: +2 from the rewritten model tests, +5 from the new
  `sole-tab-move-close-source.test.js` suite). No a11y run — no a11y surface (model gate + main lifecycle +
  a renderer deletion); deferred to the verification pass.

---

### Leg L4 (tearoff-drag-feedback) — Implementation

In-source-window feedback while a tear-off drag is armed: a window-local floating hint pill
("Release to open in a new window") that follows the pointer. Built on the pre-existing uncommitted
F9/F10 work (L1 CSS, L2 focus fix, L3 sole-tab move all untouched). Combines the "ghost" and "hint"
into one element (the AC's "and/or") to stay lean and within budget.

- **AC1 — the affordance appears when a tear-off arms.** Two helpers added right after
  `clearDragVisuals` (`renderer.js`): `trackTearoffGhost(x, y)` query-creates a `div.tearoff-ghost`,
  **appends it to `document.body` — OUTSIDE `#tabs`** — and positions it by `transform:
  translate(x+12, y+12)`; `clearTearoffGhost()` query-and-removes it. **Hook points:** in the
  `pointermove` tearOff **enter** block (`~:1569`), after the `drag.tearOff = true` / `.detaching` /
  `applyDetachDisplacement` lines and before its early `return`, `trackTearoffGhost(e.clientX,
  e.clientY)` — called on **every** pointermove while the pointer is in the tear-off zone, so the
  hint tracks the pointer (reusing the raw client coords, the DD16-allowed window-local read, not
  `e.screenX`). On strip **re-entry** (`drag.tearOff` flips back false), `clearTearoffGhost()` removes it.
- **AC2 — strictly layout-neutral.** The hint is appended outside `#tabs` and is `position: fixed`
  (out of flow) with `pointer-events: none` — it can never reflow `#tabstrip`/`#tabs` nor change a
  `.tab` width/margin, so the arm-time `slotRects`/`stripRect` snapshot stays valid. It is moved by
  `transform` only; **no `.style.(width|top|left|…)` layout write is added anywhere in the drag
  section**, so `tab-drag-invariants.test.js`'s `dragSection` LAYOUT_WRITE scan still reads 0 (the
  helpers use `.style.transform`, which the scan deliberately allows). The new `.tearoff-ghost` CSS
  rule sits directly below `.tab.detaching` (`styles.css:~360`) and is paint/position-only. The
  `.tab.detaching` rule itself is untouched, so its layout-neutral pin is unaffected.
- **AC3 — cleanup is complete.** `clearTearoffGhost()` is wired into **`clearDragVisuals`**, which
  runs at `pointerup` (BEFORE both the commit and tear-off-release branches, `~:1594`) and inside
  `cancelDrag` (`~:1537`) — so **every** end path clears it: commit, tear-off release, and all seven
  cancel sites (resize, Escape, `pointercancel`, createTab/closeTab/adopt/moved-away) reach it through
  `cancelDrag → clearDragVisuals`. Belt-and-suspenders: `clearTearoffGhost()` is `querySelector`-based
  (idempotent — a double clear is a no-op, and a stray ghost from any path is swept), and
  `trackTearoffGhost` likewise query-creates (guards double-append — no ghost stacking).
- **AC4 — gates green (standalone).** `npm test` **1960 pass / 0 fail** (baseline 1960 — **unchanged**;
  no unit test asserts the transient hint, and none is added: the existing invariant scan is scoped to
  `.tab.detaching`, and `.tearoff-ghost` is out-of-flow so its layout properties carry no strip-reflow
  hazard to pin). `npm run lint` clean, `npm run typecheck` clean. No a11y surface. **The visual (the
  hint appearing on tear-off, tracking the pointer, and vanishing on release/cancel) is the HAT
  verification pass** — no live rig here (F9 DD9 NO-GO).
- **Element structure:** a single `<div class="tearoff-ghost">Release to open in a new window</div>`
  under `<body>`, `position: fixed` at origin, translated to the pointer, `z-index: 100`, accent
  background / dark text, `pointer-events: none`, `white-space: nowrap`.
- **Budget:** `renderer.js` **+17 code lines** (two helpers ~14 + three wiring calls; ≤ +25),
  `styles.css` **+13 code lines** (the `.tearoff-ghost` rule; ≤ +14). Both within DD11. (The raw
  working-tree diff is larger because it also carries the pre-existing uncommitted L1 CSS / L2 / L3
  changes, left intact.)

---

## Takeaway Legs (accumulated during the walk — to be built as F10 legs after Stations D–F, then reviewed)

Per operator's plan: finish the HAT walk, then add implementation legs to F10 for these, then a review of
all changes. Each tagged fix / feature (fix = look-and-feel; feature/bug = scoped review before build).

- **T1 — hover highlight on tabs** *(feature, small).* At high tab counts it's hard to tell which tab the
  pointer is over. Add a hover state. (Station D #1.)
- **T2 — active tab drops its favicon when the strip shrinks** *(fix, but touches the pinned
  `responsive-tab-strip` shrink contract → light review).* The active tab must keep its favicon; widen its
  shrink floor a touch. (Station D #2.)
- **T3 — keyboard cycling stuck from page-content focus** *(BUG → scoped review).* From guest/page focus,
  the first `Ctrl+#` jump works, then subsequent chords do nothing until the chrome regains focus (click a
  tab). The `before-input-event` guest-forward path arms once and doesn't re-arm. (Station D #4.)
- **T4 — sole-tab move-to-window + close source** *(feature → design review).* A single-tab window should
  offer "move to window …" and, on move, **close the now-empty source window** — reversing the current
  `isLastTab` hide with source-window-close semantics. (Station D #6, closing the B1 #1 loop.)
- **T5 — in-drag tear-off visual feedback** *(feature → design review).* A drag ghost / "release to tear
  off" affordance in the source strip while a tear-off drag is in progress (window-local, feasible;
  distinct from the cursor-tracking window, which stays platform-limited). (Station B / B1 #3(a).)
- **T6 — cross-window drag via HTML5 DnD** *(feature, LARGE → design review; transport measured GO at
  Station C).* Make tabs `draggable`, `dragstart` stashes the tab identity in a custom MIME, a `drop`
  handler on the target window's strip fires the existing coordinate-free `moveTabIntoWindow`/adopt path.
  Satisfies mission criterion 8. (Station C.) → **F11.**

### Operator insight (L4-overlay verify) + a recorded future item
- **The tear-off overlay VIEW is a reusable primitive, not a one-off pill** (operator): a chrome-owned
  surface that paints **above the guest, anywhere in the window** opens future options — window/tab
  **previews** on drag (richer than a pill), and richer drag feedback generally. Worth treating the new
  `tearoff-overlay-manager` as the seed of a general chrome-over-guest overlay capability.
- **T7 (recorded observation, not yet scoped) — tab context menu can only render in the content area.**
  Operator flagged that the tab context menu (menu-overlay sheet) appears constrained to the content
  area and can't render over/above the strip cleanly. This is the SAME chrome-over-guest layering the
  L4-overlay work exercises, so the overlay-view primitive may be the lever to fix it. **Carry to the
  mission debrief / a future flight** — investigate whether the sheet's bounds are content-area-clamped
  and whether an overlay-view (or a bounds change) frees it. Not scoped into F10.

_(Stations E–F may add more.)_

### Decision: build ALL FIVE takeaway legs on F10, then ONE verification pass (operator)
- **Sequencing (operator):** implement the takeaway legs FIRST, then run the full automation gauntlet
  (a11y, `session-restore`, `tab-tearoff` row 8a, DD12 re-pointed specs) ONCE on the final tree — the FD
  runs the rig itself ("my rig is your rig"; admin key by env-reference only, never echoed/committed —
  F6-leak discipline). Avoids double-runs and catches fix-introduced regressions in one pass.
- **Scope (operator):** all five as F10 legs (incl. L5 cross-window drag). Leg plan:
  - **L1** — strip visual polish: T1 hover highlight + T2 active-tab favicon shrink floor.
  - **L2** — keyboard cycling re-arm bug (T3).
  - **L3** — sole-tab move-to-window + close-source (T4).
  - **L4** — tear-off in-drag feedback (T5).
  - **L5** — cross-window drag via HTML5 DnD (T6; transport measured GO at Station C).
  Shared surfaces (renderer.js/main.js/strip) ⇒ **sequential implementation**, pipelined design reviews.
  Stations E (a11y + re-pointed specs) and F (stale-header scrub, `getAttachedWindow`/`crossWindow`
  retirement) fold into the post-leg verification/hygiene pass.

## Decisions

### A3 tabless-window edge — DOCUMENT AND DEFER (operator's call)
The deleted-jar drop is unit-pinned both directions; the only residual is the tabless-window rendering,
whose trigger (manual store edit / stale-snapshot-after-crash) is not end-user-reachable. Operator chose
**document and defer** — no code change now. **Carry:** a restored window whose every tab's jar no longer
resolves is created by main (`noBootTab:true`) and then emptied by the renderer drop → a blank window.
Low severity (unreachable via normal UI), real structural gap. → mission debrief / maintenance: main
should filter out a restore window with zero live-jar-resolvable tabs before creating it. **Station A closed.**

---

### Station C — cross-window drag HTML5-drag spike (operator: "run it now")
Motivated by B1 finding #3(b). Candidate 2 (HTML5 drag, custom MIME) is the only transport that needs
no app-global coordinate — the browser owns the drag; the drop lands in the target window's own DOM.
The spike must produce a **GO/NO-GO** and, for any coordinate it reads, use a **second instrument**.
Central unmeasured premise (F8 debrief): does Chromium/Electron **deliver** a `drop` across two separate
`BaseWindow` `WebContentsView`s? Investigation launched (API + architecture + codebase); a live probe
design for the operator to confirm follows.

**Verdict (investigation): NO-GO (expected), moderate-high confidence — measure with a free probe.**
- `webContents.startDrag` (`electron.d.ts:18411`) carries **files only** (`Item` = `{file, files?, icon}`,
  `:21686`) — no custom payload; not a candidate-2 transport. **High-confidence NO-GO.**
- `WebContentsView` emits **only `bounds-changed`** (`:18568`) — no `drop`/`drag*` events; **the API
  exposes no cross-view/cross-window web-drop delivery.** The only `'drop'` in the surface is `Tray`
  (`:14898`, darwin-only).
- Architecture: each `WebContentsView` is a separate WebContents/Blink frame tree; a web drag leaving a
  surface hands off to the **OS-native** drag protocol (Wayland `wl_data_device`, OS-negotiated MIME —
  **not** Blink custom types). **Chromium's own cross-window tab drag uses a native `TabDragController`,
  NOT HTML5 DnD**, precisely because web DnD doesn't carry a custom payload across top-level windows. On
  the same WSLg/RAIL surface F8 proved anomalous. **Moderate-high-confidence NO-GO on cross-BaseWindow
  delivery.**
- The mission's "structurally immune" reasoning holds only its literal claim (no app coordinate needed —
  true) but is silent on delivery-across-BaseWindows — the actual blocker (`flight-log.md:1223` F8 already
  conceded this was unmeasured).
- **Fallback (already shipped):** the keyboard "Move to window …" move (`moveTabIntoWindow`,
  `main.js:2842`) delivers the cross-window **substance** coordinate-free and gesture-free; only the drag
  **gesture** is unsatisfiable on this rig. A measured NO-GO **honestly retires criterion 8** (its subject
  is "dragged"), as `mission.md:292` pre-authorized.
- **Live probe written** (`/tmp/gf-probe.js` + `/tmp/gf-probe.sh` wrapper, throwaway, out-of-repo): two
  `BaseWindow`s each a `WebContentsView`; A has a `draggable` div setting a custom MIME, B logs
  `dragenter/over/drop`; renderer consoles forwarded to the terminal. Reads **no coordinate**
  (second-instrument satisfied vacuously — nothing to cross-check).

**★ MEASURED VERDICT: GO — the investigation's expected NO-GO was REFUTED by direct measurement.**
Operator ran the probe and dragged A→B. Window B (a **separate `BaseWindow`**) logged the full sequence:
`dragenter` → many `dragover` → **`drop payload="probe-42"`**, with `types=["application/x-goldfinch-tab"]`
visible throughout and the custom payload **intact on drop** (`getData` empty during dragover is correct
per-spec — data is hidden until drop; `types` exposed so the target can accept/reject). So
**cross-`BaseWindow` HTML5 DnD delivers a custom-MIME web `drop` on this WSLg rig** — the one premise F8
never measured. `dropEffect=none` on `dragend` (A didn't negotiate a move effect) is an implementation
detail, not a blocker — a real build sets `effectAllowed`/`dropEffect`.

> **★ THE METHODOLOGICAL POINT — the flight's own thesis, paid forward.** The investigation reasoned from
> `electron.d.ts` (no drag events on `WebContentsView`) and Chromium architecture (its native
> `TabDragController` avoids HTML5 DnD) and predicted NO-GO at moderate-high confidence. **A direct probe
> refuted it.** This is F8's second-instrument lesson in the OPPOSITE direction: an instrument that reads
> documentation/architecture cannot discriminate the rig's actual runtime behavior — you must measure on
> the real artifact, in both directions. F8 nearly *shipped* a coordinate premise on an instrument that
> couldn't fail; F10 nearly *retired* a transport on one. Only the live probe settled it.

**Mission impact:** candidate 2 (HTML5-drag transport) is **VIABLE (measured)**. The cross-window-DRAG
criterion (criterion 8), deferred since F8, is **no longer blocked** — it is **achievable**, not retired.
Scope note: this unlocks *drag a tab into another window's strip* (the drop lands in B's DOM → trigger the
existing coordinate-free `moveTabIntoWindow`/adopt path). It does **not** by itself deliver the
*tear-off-into-empty-space window-follows-cursor* UX (B1 #3(b)) — that still needs live window
positioning, which stays fiction on this rig. Building the drag gesture is a **new flight's** worth of
work (draggable tabs + dragstart identity MIME + strip drop handler → adopt), not an inline HAT fix. →
decision raised to operator (plan a follow-up flight now vs. record the GO and continue the HAT).

### Station B — B1 findings (by-hand)
- **"Move to new window" absent for the sole tab — BY DESIGN.** Operator saw the item only when the
  window has >1 tab. Correct: `tab-context-model` gates it on `!isLastTab` — moving the only tab to a new
  window is a no-op that would leave the source window empty. (Confirm-with-operator this was the
  new-window item, not the existing-window "Move to window …" item, which is gated on window count.)
- **Tear-off drag lacks Chrome's live-window feedback — REAL gap, and it is the platform limitation F8
  MEASURED, not a bug.** Operator: *"tear-off works, but no drag indicator except a sliver + grab cursor;
  in Chrome the new window appears immediately and follows the mouse; ours appears only on mouse-up and
  isn't at the cursor."* This is a direct consequence of **DD16 (window-local coordinates only)** — F8's
  leg-2 second-instrument spike proved Electron's window coordinates on this WSLg rig are a **cached
  fiction** (`setPosition` a no-op, a real OS move fires no event, a virgin window born 363px wrong), so
  a live-following torn-off window is **not achievable on this rig**. Two separable parts:
  (a) **in-drag visual feedback within the source window** (a ghost/"release to tear off" affordance) —
  chrome-DOM-only, window-local, feasible → a **FEATURE** (scoped review) if wanted;
  (b) **the new window appearing immediately and tracking the cursor** — needs app-global window
  positioning that F8 measured impossible here → this is the **cross-window-drag transport** question
  (mission's last open question), whose measured GO/NO-GO is **Station C**. → decision raised to operator.

---

### Takeaway-leg design reviews (L2/L3/L5)
- **L2 (keyboard cycling) — approve with changes.** Root cause confirmed: `tab-set-active` never
  `.focus()`es the incoming guest. **Better fix than the leg proposed:** main-only — read the OUTGOING
  guest's `isFocused()` before the swap, focus the incoming iff it was page-focused. Zero renderer/preload
  change, self-correcting, find-safe. WSLg `isFocused()`-query reliability confirmed in the live pass;
  plumbed-flag fallback recorded. AC4 net fixed: MCP `pressKey` bypasses OS focus, so assert
  `document.hasFocus()` on the *incoming* guest (not "two chords no click", which passes regardless).
- **L3 (sole-tab move) — approve with changes.** `allowSoleTab` param scopes the relaxation to the
  existing-window path; empty-source `win.close()` placed LAST (after `broadcastMoveTargetsChanged`),
  guarded `size===0 && !isDestroyed` (self-selecting) — same proven-safe shape as the `window-close` IPC;
  no app-quit on the last-window edge. Renderer: DELETE the `else createTab()` (racing a closing window).
  Contract rewrites (tab-context-menu Step 9 + two-window sub-case; tab-tearoff OOS + row 6).
- **L5 (cross-window drag) — NEEDS REWORK → ESCALATE TO ITS OWN FLIGHT (F11).** Definitive: static
  `draggable=true` fires `pointercancel` → kills the document-level pointer reorder/tear-off; the
  `tearOff`-keyed dynamic toggle is **structurally impossible** (a native drag only initiates from a fresh
  press, not mid-pointer-gesture). Only paths: (b) full pointer→HTML5 rewrite (~+100/-80, re-litigates
  4 specs) or (c) modifier-gated `draggable`-set-at-`pointerdown` — **both need a live spike** (does
  `draggable` set during `pointerdown` initiate a drag? does a drop deliver over the strip's
  `-webkit-app-region: drag` zone — Station C's bare probe never tested the real strip, and `#tabs` isn't
  `no-drag`). Plus real defects: payload mismatch (`{wcId,jarId,url}` fails `validateMoveTabPayload` —
  needs `{wcId,url,title,favicon,container}`); authority weakening (source from payload `wcId` via
  `getWindowForGuest`, guest-spoofable — needs an explicit ruling). The flight-log said at spike time this
  was "a new flight's worth of work" — confirmed. → **decision raised to operator: F11 vs. defer.**
  **L1–L4 proceed as F10 legs regardless (independent of L5).**

_(further fix-vs-feature rulings and runtime decisions appended as they arise)_

---

## Anomalies

### FD process failure — admin key leaked into the session transcript (contained)
**Observed:** attempting the a11y verification, the FD launched `dev:automation` (admin+dev-mint) and grepped
the log for readiness through a `sed` redaction pass. The pattern matched `key=VALUE`/`key: VALUE` forms but
**not** the actual `AUTOMATION_DEV_MINT {"key":"…","adminKey":"…"}` **JSON** format, so the minted keys
printed **in full** into the conversation transcript.
**Severity:** process discipline — the exact **F6 admin-key-leak class** the standing carry forbids
("admin keys via env-var reference ONLY, never echoed"). Real slip, not minimized.
**Blast radius:** low but nonzero — dev-minted, local-only, ephemeral keys bound to that one `dev:automation`
instance, which was **force-killed** (all electron PIDs; keys invalidated with the dead process) and the log
removed. Nothing reached a committed artifact.
**Rule / carry (mission debrief):** never pipe a key-bearing stream through a redaction filter and print the
result — a redaction that can miss is not containment. The F6 rule needs teeth: **"never print a key-bearing
stream at all,"** not "redact then print." Handle a key only by extracting it into an env var inside a single
non-printing command, or let the operator run the keyed gate.
**Downstream:** the FD will NOT re-drive the keyed a11y/behavior gauntlet by self-parsing minted output; the
a11y run + live behavior checks go to the operator's clean rig (or F11's verification). The environment was
also degraded (no network; GPU transient failures), independently making a self-run unreliable.

### F10 leg verification (operator, by-hand) + the L4 layering bug
- **L1 PASS** (hover highlight + active favicon kept when shrunk). **L2 PASS** (Ctrl+# re-arm from page
  focus). **L3 PASS via menu** (sole-tab "Move to window …" moves the tab + closes the source). L3 "fail with
  drag" = **expected**: cross-window DRAG is **F11** (unbuilt), sole-tab tear-off is refused by design — not
  an L3 bug.
- **L4 BUG — fundamental layering.** Operator: *"the pill only shows in the chrome of the original window,
  goes behind the main content area, doesn't show outside."* The ghost is a **chrome-DOM element**, but the
  guest page is a **separate native `WebContentsView` stacked above the chrome's content area** — so once the
  pill follows the pointer below the strip band it is **occluded by the guest view**. A chrome-DOM element
  cannot render over the guest (exactly why find/menu overlays are separate views). **L4-as-built is broken
  for its purpose** — it's only visible over the strip band, the opposite of where a tear-off drag goes.
  → fix options raised to operator: (a) overlay-VIEW pill (find/menu pattern, follows anywhere, bigger fix);
  (b) strip-anchored hint (stays in the visible strip band, no cursor-follow into content, small);
  (c) revert L4.

### Leg L4-rebuild — Implementation (tearoff-overlay-view; supersedes the 589989c chrome-DOM ghost)
Chose fix option (a): the tear-off pill is now a MAIN-OWNED overlay `WebContentsView`, so it paints
**over the guest** and follows the cursor anywhere — the chrome-DOM ghost could only paint in the strip band.

- **The manager** — `src/main/tearoff-overlay-manager.js` (65 code lines): a trimmed copy of
  `find-overlay-manager.js`'s lifecycle — lazy singleton view, destroyed-recreate guard,
  `render-process-gone` self-teardown, `show()` = position → `addChildView` (the re-add RAISES above the
  guest) → `setVisible(true)`, `hide()` = visibility-gated `removeChildView` (never `setVisible(false)`-only),
  `teardown()` destroys the wc. The find-session state machine is DROPPED; positioning is a pill-anchored
  `setBounds({ x: x+12, y: y+12, width: 260, height: 28 })` off the pointer (constants live in the module,
  which stays Electron-free / offline-testable). `show(x,y)` seeds the position in one call; the AC5 re-assert
  calls `show()` with no args (keeps last position).
- **The 3 IPC channels** — `tearoff-overlay:show` / `:move` / `:hide` (main.js), chrome-origin,
  fire-and-forget; the sender's own window is resolved via `registry.getWindowForChrome(event.sender)` (a
  guest page has no `tearoffOverlay` path). Coordinates are 1:1 DIP (`e.clientX/Y` → pill `setBounds`).
  Bridged in `chrome-preload.js` (`tearoffOverlayShow/Move/Hide`, all `ipcRenderer.send`).
- **The rAF-coalesce** — `renderer.js`: `trackTearoffGhost(x,y)` stores the latest pointer position and
  schedules ONE `requestAnimationFrame` (mirror `sendActiveBounds`); the flush sends `:show` on the first
  frame (then `:move`), so at most one IPC per frame no matter how fast the pointer moves. `clearTearoffGhost()`
  sends `:hide` (idempotent — no stray IPC when nothing is shown). The existing hooks (tearOff-enter →
  track, tearOff-leave / pointerup / pointercancel via `clearDragVisuals` → clear) stay wired through those two
  functions unchanged. The `.tearoff-ghost` chrome-DOM element + its CSS block are REMOVED.
- **Teardown / no-leak (F6/F7 class)** — the manager is constructed per-window in `createWindow`
  (`record.tearoffOverlay`); `win.on('close')` calls `tearoffOverlay.teardown()` (beside `findOverlay.teardown()`)
  and nulls `rec.tearoffOverlay` — the SOLE destruction site. The pill wc never enters `tabViews`, so
  `enumerateTabs` is unaffected. Pinned by `test/unit/tearoff-overlay-teardown.test.js` (masked source-scan:
  teardown-in-close-handler + created-via-manager, with synthetic mutate-away failure cases).
- **How it layers above the guest** — `show()`'s `addChildView` re-add raises the pill last in the compositing
  stack (the find/menu idiom); `tab-set-active` re-asserts it after the guest/find/sheet re-adds (AC5) when a
  tear-off is live mid-activation (rare edge, now covered rather than accepted).
- **The no-focus divergence (AC3)** — deliberately UNLIKE find/menu: the pill view has NO preload,
  `webContents.focus()` is NEVER called on it, and its HTML `body { pointer-events: none }`. It is pure paint
  sized to the pill only, so a tear-off drag never steals focus from the guest or the tab strip and never
  intercepts input. Pill content is `src/renderer/tearoff-overlay.html` (accent `#f5c518`, radius, 12px, no
  script; `default-src 'none'` CSP with `style-src 'unsafe-inline'`).
- **Budgets (DD11):** tearoff-overlay-manager.js 65 / ≤90; main.js +28 / ≤+30; renderer.js +13 / ≤+15;
  chrome-preload.js +3 / ≤+6. All within.
- **Gate delta (standalone):** `npm test` 1965 pass / 0 fail (baseline 1960, +5 from the new source-scan
  suite); `npm run lint` clean; `npm run typecheck` clean (added the 3 bridge methods to `GoldfinchBridge`
  and a `tearoffOverlay` slot to the `WindowRecord` typedef). No a11y.
- **The visual is the operator's re-verify:** the pill should follow the cursor OVER the page during a
  tear-off drag and disappear on release / cancel / re-entry into the strip.

**Re-verify (operator): PASS over the content area** — the L4 bug (pill occluded by the guest) is fixed;
the overlay pill now tracks the cursor over the page. **"Disappears outside the window" = accepted platform
boundary, not a bug.** A `WebContentsView` is composited *inside* its host window and cannot paint on the
desktop beyond the window edge; the only out-of-window options are a cursor-tracking top-level window
(F8 measured WSLg window positioning a **cached fiction** — dead on this rig) or an **OS-native drag image**
(exactly what **F11's HTML5 drag** provides for free — the browser renders the ghost at OS level, crossing
window bounds). So the out-of-window feedback is **subsumed by F11**, not abandoned. **L4-overlay accepted;
the outside-window case carried to F11's native drag image.**
