# Leg: deferred-resize-on-close

**Status**: completed
**Flight**: [Tab-Bar Control Restructure](../flight.md)

## Objective
When a tab is closed **by pointer while the cursor is over the strip**, freeze each remaining
tab's measured pixel width so siblings slide left under the cursor with no resize, releasing the
freeze on `#tabstrip` `mouseleave` (then flex re-expands) — while **keyboard close stays immediate**
(DD5; flight-local, no mission SC).

## Context
- Flight **DD5**: freeze each remaining tab's measured pixel width on pointer-close, release on
  `#tabstrip` `mouseleave`, then clear the freeze and let flex re-expand. **Keyboard close
  (Delete/Backspace) reflows immediately** — there is no cursor position to preserve.
- **Implementation seam (Architect, mandatory)**: the clean pointer-vs-keyboard split already
  exists. **Pointer close** runs through the tab button's click handler (the
  `if (… .closest('.tab-close')) closeTab(id)` branch, `renderer.js:188-194`). **Keyboard close**
  runs through the `els.tabs` keydown Delete/Backspace branch (`renderer.js:415-419`). Both call
  the **shared** `closeTab` (`renderer.js:203-215`). **Apply the freeze in the click path, NEVER
  inside `closeTab`** — that keeps keyboard close immediate (DD5).
- **Zero-tab guard interaction (Architect)**: `closeTab` injects a fresh tab via `createTab()`
  when the last tab closes (`renderer.js:213`). The freeze must (a) key its state to **live** tabs
  and (b) ensure a `createTab` during/after a frozen run does **not** inherit a stale inline width.
  Both are satisfied by: freezing only when more than one tab exists (`tabs.size > 1`) so a
  last-tab pointer-close skips the freeze entirely and `createTab` makes a clean element; and by
  setting the freeze via **inline style on existing tab buttons only** (a fresh `createTab` button
  has no inline `flex`).
- **Builds on leg 2**: leg 2 set `.tab { flex: 1 1 0; min-width:88px; max-width:240px }`. The
  freeze overrides this per-tab with an **inline** `flex: 0 0 <px>` (inline beats the stylesheet,
  no `!important` involved); releasing it (`style.flex = ''`) restores the shared `flex:1 1 0` so
  tabs re-expand. Every frozen width is a rendered width already within `[88px, 240px]`, so the
  surviving `min-width`/`max-width` never fight the frozen basis.
- **box-sizing**: the project sets `* { box-sizing: border-box }` (`styles.css:13-14`), so
  `getBoundingClientRect().width` (border-box) equals the flex-basis under border-box — freezing at
  the measured width reproduces the exact rendered width with no drift.
- **No `els.tabstrip` today**: `els` has `tabs` (`#tabs`, the inner `tablist`) but not the outer
  `#tabstrip`. DD5 releases on `#tabstrip` `mouseleave` (the outer strip, so moving the pointer
  from a tab onto the leading pill or the inter-element gap does NOT release mid-serial-close).
  This leg adds an `els.tabstrip` reference.
- Live verification is the `responsive-tab-strip` behavior test
  (`tests/behavior/responsive-tab-strip.md`) **Steps 5–6** (pointer-close freeze + `mouseleave`
  re-expand) and **Step 8** (keyboard-close immediate reflow), deferred to `verify-integration`.
  In-leg verification is the code presence + offline gates.
- **Tooling**: renderer is whole-codebase `@ts-check`'d, `sourceType:"script"`. New DOM access
  (`els.tabstrip`, `t.btn.getBoundingClientRect()`, `t.btn.style.flex`) must satisfy `tsc`; follow
  the existing JSDoc-cast pattern (e.g. `els.tabs` is `/** @type {HTMLElement} */ (...)`) and add
  casts only where `npm run typecheck` requires.

## Inputs
What must be true before this leg runs:
- Legs 1–2 landed (working tree, uncommitted): pill leads `#tabstrip`; `.tab { flex:1 1 0; ...
  overflow:hidden }`.
- `src/renderer/renderer.js` — `els` object with `tabs:` at `:8` (and the block `:7-52`);
  `createTab` tab-button click handler with the pointer-close branch (`:188-194`); shared
  `closeTab` (`:203-215`) including the zero-tab `createTab()` at `:213`; `els.tabs` keydown
  Delete/Backspace branch (`:415-419`); `focusTab`/`activeTab` helpers used by the keydown handler.
- `src/renderer/index.html` — `#tabstrip` (`:14`) wraps `#newtab-pill` + `#tabs`.
- Offline gates green.

## Outputs
What exists after this leg completes:
- `els.tabstrip` reference; a `widthsFrozen` flag; `freezeTabWidths()` / `releaseTabWidths()`
  helpers.
- Pointer-close (click on `.tab-close`) freezes all live tab widths (when `tabs.size > 1`) **before**
  `closeTab`, so siblings slide left under the unmoved cursor with a trailing gap; a `#tabstrip`
  `mouseleave` listener releases the freeze and tabs re-expand.
- Keyboard close stays behaviorally **immediate** (reflows at once); a *release-only* call is added
  to its branch to clear any active freeze — no freeze ever enters this path, and the shared
  `closeTab` is untouched.
- `renderer.js` only; offline gates green.

## Acceptance Criteria
- [x] `els.tabstrip` is added (referencing `#tabstrip`) with the same JSDoc-cast style as the
  surrounding `els` entries.
- [x] A module-scope `widthsFrozen` boolean and two helpers exist: `freezeTabWidths()` sets each
  **live** tab button's inline `style.flex = '0 0 <measured>px'` (measured via
  `getBoundingClientRect().width`) and sets `widthsFrozen = true`; `releaseTabWidths()` clears each
  tab button's inline `style.flex` and sets `widthsFrozen = false`.
- [x] The pointer-close branch in the tab button's click handler calls `freezeTabWidths()` **only
  when `tabs.size > 1`**, immediately **before** `closeTab(id)`. (Last-tab pointer-close skips the
  freeze so the `createTab()` replacement is clean.)
- [x] `closeTab` is **not** modified — no freeze logic inside the shared close function.
- [x] The keyboard-close branch (`els.tabs` keydown Delete/Backspace) calls `releaseTabWidths()`
  **before** `closeTab(cur)`, so keyboard close **always** reflows immediately — even right after a
  pointer-close while the cursor is still over the strip (the literal DD5 contract). This adds a
  *release*, never a *freeze*, to the keyboard path.
- [x] A `mouseleave` listener on `els.tabstrip` calls `releaseTabWidths()`.
- [x] After a pointer-close (with >1 tab), the freed slot is taken by the right-neighbor sliding
  left (remaining tabs keep their widths, a trailing gap appears); after the pointer leaves
  `#tabstrip`, tabs re-expand to the shared flex width. Keyboard (Delete/Backspace) close reflows
  immediately with no freeze. *(In-leg: code present + gates; live behavior at `verify-integration`.)*
- [x] A fresh tab created by the zero-tab guard does not inherit a frozen inline width.
- [x] `npm test`, `npm run typecheck` (0 errors), `npm run lint` (0 problems), and
  `npx prettier --check src/renderer/renderer.js` all clean.

## Verification Steps
- `grep -n "tabstrip:" src/renderer/renderer.js` → `els.tabstrip` reference present.
- `grep -n "widthsFrozen\|freezeTabWidths\|releaseTabWidths" src/renderer/renderer.js` → flag +
  both helpers defined and referenced.
- `grep -n -B2 -A2 "freezeTabWidths()" src/renderer/renderer.js` → called in the click-handler
  pointer-close branch (guarded by `tabs.size > 1`), **before** `closeTab(id)`; confirm by reading
  that the `closeTab` function body itself contains no freeze call.
- `grep -n "tabstrip.addEventListener('mouseleave'" src/renderer/renderer.js` → release listener
  on `#tabstrip`.
- `git diff --name-only` → only `src/renderer/renderer.js` changed.
- `npm run typecheck` → 0 errors; `npm run lint` → exit 0; `npm test` → all pass;
  `npx prettier --check src/renderer/renderer.js` → clean.
- Deferred to `verify-integration`: `/behavior-test responsive-tab-strip` Steps 5–6 (pointer-close
  freeze → `mouseleave` re-expand) and Step 8 (keyboard-close immediate reflow).

## Implementation Guidance

1. **`renderer.js` — add `els.tabstrip` (in the `els` block, near `tabs:` at `:8`).**
   ```js
   tabstrip: /** @type {HTMLElement} */ (document.getElementById('tabstrip')),
   ```

2. **`renderer.js` — freeze/release helpers + flag.** Place near the tab close/activate code
   (after `closeTab`/`activateTab`, before the keydown wiring). Keep `closeTab` itself untouched.
   ```js
   let widthsFrozen = false;
   // Deferred resize-on-close (DD5): freeze remaining tabs' rendered widths so a pointer-close
   // doesn't reflow the strip out from under the cursor. Released on #tabstrip mouseleave.
   function freezeTabWidths() {
     for (const t of tabs.values()) {
       t.btn.style.flex = `0 0 ${t.btn.getBoundingClientRect().width}px`;
     }
     widthsFrozen = true;
   }
   function releaseTabWidths() {
     if (!widthsFrozen) return;
     for (const t of tabs.values()) t.btn.style.flex = '';
     widthsFrozen = false;
   }
   els.tabstrip.addEventListener('mouseleave', releaseTabWidths);
   ```
   No `t.btn` cast is needed: `jsconfig.json` sets `strict:false` (no `strictNullChecks`), so the
   tab record's `btn` types as `HTMLElement` and `.getBoundingClientRect()`/`.style.flex` resolve
   cleanly. (`els.tabstrip` keeps its cast, consistent with the rest of the `els` block.) Run
   `npm run typecheck` to confirm.

3. **`renderer.js` — freeze in the pointer-close branch (`:188-194`).** In the tab button's click
   handler, guard and freeze before the shared close:
   ```js
   btn.addEventListener('click', (e) => {
     if (/** @type {HTMLElement} */ (e.target).closest('.tab-close')) {
       if (tabs.size > 1) freezeTabWidths(); // DD5: defer reflow on pointer-close (not last tab)
       closeTab(id);
       return;
     }
     activateTab(id);
   });
   ```

4. **`renderer.js` — leave `closeTab` untouched; add a *release* to the keyboard branch.** Do
   **not** add any freeze to `closeTab` (`:203-215`). In the `els.tabs` keydown Delete/Backspace
   branch (`:415-419`), call `releaseTabWidths()` immediately before `closeTab(cur)` so keyboard
   close always reflows immediately (DD5; behavior-test Step 8) — including the mixed-input case
   (pointer-close, then Delete with the cursor still over the strip):
   ```js
   } else if (e.key === 'Delete' || e.key === 'Backspace') {
     e.preventDefault();
     releaseTabWidths(); // keyboard close always reflows immediately (DD5) — clears any active freeze
     closeTab(cur);
     const now = activeTab();
     if (now && now.btn) focusTab(now.id);
   }
   ```
   This adds only a *release* (never a freeze) to the keyboard path, so the DD5 seam ("no freeze in
   the shared/keyboard path") is preserved.

## Edge Cases
- **Serial pointer-close without leaving the strip**: each pointer-close re-runs
  `freezeTabWidths()`, re-measuring the (already frozen) widths and setting the same inline values
  on the surviving tabs — idempotent. The freeze persists across closes until `mouseleave`.
- **Closing the last tab by pointer**: `tabs.size > 1` is false, so no freeze; `closeTab` →
  `createTab()` yields a clean tab with no inline width. (Also covers the DD5 zero-tab guard.)
- **Closing the active tab**: `closeTab` activates `[...tabs.keys()].pop()`; that sibling is frozen
  at its width like the others — no special handling needed.
- **Pointer leaves via the pill / inter-element gap**: `mouseleave` is on `#tabstrip` (the outer
  container incl. the pill), so moving onto the pill mid-serial-close does **not** release — only
  leaving the whole strip does. (If HAT prefers release-on-`#tabs`-leave, that's a one-line target
  change; DD5 specifies `#tabstrip`.)
- **`mouseleave` vs `mouseout`**: use `mouseleave` (fires once when the pointer leaves the element
  boundary, does not bubble from children) — `mouseout` would fire spuriously moving between tabs.
- **Re-expand correctness**: clearing inline `flex` restores `flex:1 1 0`; if many tabs still
  exceed the width, they settle at the `88px` floor and `#tabs` scrolls (leg 2 behavior); if they
  now fit, they grow. Either is correct.
- **Frozen width vs min/max**: a frozen `flex:0 0 Wpx` has `W ∈ [88,240]` by construction (it was a
  rendered width under leg-2's constraints), so the surviving `min-width:88`/`max-width:240` don't
  alter it.
- **New tab via the pill during an active freeze**: `#newtab-pill` is inside `#tabstrip`, so
  clicking `+`/`▾` mid-freeze does not fire `mouseleave`; the fresh tab enters with `flex:1 1 0`
  (grows) next to frozen-width siblings — a transient visual inconsistency that self-heals on the
  next pointer-close (re-freezes all) or on `mouseleave`. Acceptable; not worth special-casing.
- **Freeze under leg-2 overflow/scroll**: when many tabs already sit at the `88px` floor and `#tabs`
  is scrolling, freezing pins them at the floor; closing one frees floor-width of space and the
  trailing gap may be small or absent (the strip may simply stop overflowing). Re-expand on
  `mouseleave` still applies. The behavior test exercises the wide-window case (visible gap); the
  scroll case is a benign variant.

## Files Affected
- `src/renderer/renderer.js` — `els.tabstrip` reference; `widthsFrozen` flag; `freezeTabWidths`/
  `releaseTabWidths` helpers + `#tabstrip` `mouseleave` listener; one guarded `freezeTabWidths()`
  call in the tab-button pointer-close branch; one `releaseTabWidths()` call in the keyboard
  Delete/Backspace branch. **The shared `closeTab` function is unchanged.**

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (commit deferred to the
flight-level review/commit per `/agentic-workflow`):**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint` + `npx prettier --check`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-level commit promotes to
  `completed`
- [x] (Not the final leg — no flight.md leg checkoff or flight-status change here)

## Citation Audit
Citations verified against the current working tree (renderer.js untouched by legs 1–2) — all
`OK`: `renderer.js:8` (`els.tabs`), `:7-52` (`els` block), `:188-194` (tab-button click handler,
pointer-close branch), `:203-215` (shared `closeTab`, incl. `:213` zero-tab `createTab()`),
`:415-419` (`els.tabs` keydown Delete/Backspace branch); `index.html:14` (`#tabstrip`);
`styles.css:13-14` (`box-sizing:border-box`). Behavior-test alignment: `responsive-tab-strip`
Steps 5–6 + 8.
