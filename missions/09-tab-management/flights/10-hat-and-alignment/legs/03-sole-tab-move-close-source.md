# Leg: L3 — sole-tab-move-close-source

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

HAT feature (T4): a single-tab window can move its tab into **another existing window** (consolidate), and
the now-empty source window **closes**. Reverses today's blanket sole-tab refusal — for the existing-window
path only.

## Context

Risk: **HIGH** — reverses a prior design decision (F8's sole-tab refusal), touches `moveTabIntoWindow`'s
lifecycle + a window-close, changes a behavior-test contract. Design review.

**Anchors (recon):** the sole-tab refusal is **one gate in two places** (kept in sync deliberately):
`tab-context-model.js:~85` `if (!isLastTab && !isInternal){ move-new-window + move-window:* }`, and
`main.js:~2852` `if (source.tabViews.size <= 1) return {ok:false, reason:'sole-tab'}`. The move core
`moveTabIntoWindow` (`main.js:2842`) already re-parents + adopts, generalized over its target.

**Scope the relaxation to the EXISTING-window path only.** "Move to **new** window" (`tab-move-to-new-window`
`:2985`) and tear-off (`tab-tear-off` `:3031`) are a **no-op window swap** for a sole tab — keep them
refused. "Move to **window [B]**" (`tab-move-to-window` `:3013`, target `registry.get(payload.windowId)`) is
the useful case — enable it.

**Empty-source disposal (new):** today the source renderer's `onTabMovedAway` (`renderer.js:~4007`) boots a
fresh unrequested tab when the strip empties (`else createTab()`, annotated "main refuses sole-tab move" —
the assumption this leg removes). New behavior: after a successful move leaves `source.tabViews.size === 0`,
**`source.win.close()`** — placed in `moveTabIntoWindow` after the delete/`tab-moved-away` send, honoring the
DD1 synchrony pin (no `await` between the delete/set pair `:2903–2904`; a `win.close()` after it is fine).
The `close` handler tolerates empty `tabViews` (its capture loop no-ops). Also gate the renderer's
`else createTab()` so an emptied source does not boot a tab (main's close is authoritative).

## Acceptance Criteria

- [ ] **AC1 — a sole tab offers "Move to window …" for each OTHER window** (not "Move to new window").
      Relax `tab-context-model.js:85` by restructuring `if (!isLastTab && !isInternal){…}` →
      `if (!isInternal){ if (!isLastTab) item('tab:move-new-window'…); for (…) item('tab:move-window:${windowId}'…) }`
      — so `tab:move-window:*` emits even for a sole tab while `tab:move-new-window` stays omitted for it.
      Update `test/unit/tab-context-model.test.js` both directions (sole tab + 1 other window → the
      move-window item present, new-window item absent; sole tab + no other window → no move items).
- [ ] **AC2 — moving the sole tab into another window closes the empty source (design-review mechanism).**
      Add a defaulted param `moveTabIntoWindow(source, p, resolveTarget, allowSoleTab = false)`; the guard
      becomes `if (!allowSoleTab && source.tabViews.size <= 1) return {ok:false, reason:'sole-tab'}`. **Only
      `tab-move-to-window` (`:3013`) passes `allowSoleTab = true`** — the two `newWindowForMove` callers
      (`tab-move-to-new-window`, `tab-tear-off`) inherit `false` and stay refused (AC3). The empty-source
      close is the **last statement before `return {ok:true}`**, AFTER `broadcastMoveTargetsChanged()`
      (`:2979`) so the target adopt queuing never depends on `close()` timing:
      `if (source.tabViews.size === 0 && !source.win.isDestroyed()) source.win.close();` — `size===0` is
      **self-selecting** (only a sole-tab move can empty the source, and that's only reachable with
      `allowSoleTab`), so no extra path check is needed. **Safety confirmed by review:** this is the same
      shape as the existing `window-close` IPC (`:2486`, `win.close()` on the sender's own window inside an
      IPC dispatch — `tab-move-to-window`'s sender IS the source chrome); the close handler tolerates empty
      `tabViews`; the target's queue is independent; no WSLg hang risk beyond the already-guarded class.
- [ ] **AC3 — new-window / tear-off of a sole tab stay REFUSED** (no-op swap). `tab-move-to-new-window` and
      `tab-tear-off` keep the sole-tab refusal.
- [ ] **AC4 — the identity + synchrony invariants hold + the renderer no longer boots a tab.** Reuse
      `moveTabIntoWindow` (do **not** transcribe): the DD1 no-`await` synchrony and the displaced-active-tab
      hide (`main.js:~2935`, pinned by `tab-tearoff.md` row 8a) are preserved. In `renderer.js`
      `onTabMovedAway` (`:~4007`), **DELETE the `else createTab()` arm** (not just gate it) — every
      empty-strip `onTabMovedAway` now means main is closing the window, so booting a tab would race a
      `tab-create` into a closing window (orphan-guest leak). Update the now-false comment ("main refuses a
      sole-tab move"). The non-empty branch (`if (next) activateTab(next)`) is untouched.
- [ ] **AC5 — contracts updated (specific, per review).** (a) `tab-context-menu.md` **Step 9**: update the
      rationale — the sole-tab move-window item is absent because there's **no other window**, not because
      the tab is sole; **add a two-window sub-case** asserting the move-window item **appears** for a sole
      tab (the AC1 behavior). (b) `tab-tearoff.md` **Out-of-Scope** bullet ("Cross-window adopt of a SOLE
      tab — F8 refuses it … source-window disposal … a separate design question F8 does not open"):
      **rewrite** — this leg opens and resolves that question (sole-tab existing-window move + source
      disposal now ships). (c) `tab-tearoff.md` **row 6** parenthetical cross-ref to that OOS rationale is
      now stale — trim it (row 6's behavior, sole-tab **tear-off** stays refused, is unchanged).
      **Note (review):** with `restoreSession` on, the `close`-handler snapshot write momentarily serializes
      the zero-tab source (removed from the registry only at `closed`) — the same accepted transient the code
      documents at `main.js:~1289` ("overwritten by the next close/quit"); the target's move already corrects
      the set. No action, acknowledged.
- [ ] **AC6 — gates green** (`npm test` delta, `lint`, `typecheck` — standalone). Runtime (the actual
      move+close) is the verification pass; pin code shape here (masked scans: gate relaxed for existing-window
      only; `size===0 → win.close()` present; renderer no longer boots a tab on empty source).

## Files Affected
- `src/shared/tab-context-model.js` (`:85`) + `test/unit/tab-context-model.test.js`.
- `src/main/main.js` — `moveTabIntoWindow` (`:2852` guard + empty-source `win.close()`), `tab-move-to-window` (`:3013`).
- `src/renderer/renderer.js` — `onTabMovedAway` (`:4007`) empty-source handling.
- `tests/behavior/tab-context-menu.md` (Step 9), `tests/behavior/tab-tearoff.md` (rows 6/9 + OOS).

## Line Budget (DD11 — code lines)
- `main.js`: **≤ +12**. `tab-context-model.js`: **≤ +4**. `renderer.js`: **≤ +4**. Exceed ⇒ stop and report.

---
## Post-Completion Checklist
- [x] ACs verified (runtime deferred to the verification pass, stated)
- [x] flight-log leg entry; leg status `completed`; flight.md leg checked
- [x] Do NOT commit (flight-end review + single commit)
