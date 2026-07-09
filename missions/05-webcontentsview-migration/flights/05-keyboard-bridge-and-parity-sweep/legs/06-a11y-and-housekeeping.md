# Leg: a11y-and-housekeeping

**Status**: completed
**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](../flight.md)

## Objective
Close SC4's a11y gate (`npm run a11y`) and fold the small F4-deferred housekeeping + the spec-drift items the
corpus legs surfaced. (The repo-wide `<webview>`→`WebContentsView` terminology sweep stays PARKED for
F6/maintenance per DD5 — this leg does only the small, in-scope items.)

## Scope
1. **a11y gate:** run `npm run a11y` (`scripts/a11y-audit.mjs`); it must pass (the SC4 formal-net a11y half,
   deferred since F4 Leg 2). Triage any failure: real a11y regression → fix; pre-existing/venue → record.
2. **F4 CLAUDE.md conventions** (F4 rec #3): add (a) the focus-then-send rule (`getChromeContents()?.focus()`
   before `send()` on any keyboard-input-expecting IPC to chrome), and (b) the `isWebTab()`/`isInternalTab()`
   decision idiom (never read `.trusted` directly).
3. **Stale `will-attach-webview` comments:** fix `src/renderer/renderer.js` (~:956 "Leg 4 removes
   will-attach-webview / webviewTag"), `src/preload/internal-preload.js:4`, `src/main/settings-store.js:64`
   (verify current line numbers; the machinery is gone since F3).
4. **Promote first-run specs draft→active:** `tests/behavior/tab-surface-geometry.md` +
   `tests/behavior/internal-tab-menus.md` (both PASSed their first-ever runs in Leg 3).
5. **Spec-drift text fixes surfaced by the corpus:**
   - `tests/behavior/mcp-drive-end-to-end.md` Step 9: `captureWindow` is admin-only (correct posture) — fix the
     parenthetical that lists it in the jar-driven observe set.
   - `tests/behavior/page-context-menu.md`: Escape returns focus to `#kebab` (not `#address`) — align the assertion.
   - Behavior-test specs that read the persisted store: note the dev profile is `~/.config/goldfinch-dev` (not
     `~/.config/goldfinch`) under `dev:automation` — prevents the wrong-profile comparison that mis-fired in Leg 4.

## Acceptance Criteria
- [x] `npm run a11y` passes (or failures triaged/recorded); `npm test` / `typecheck` / `lint` green.
- [x] CLAUDE.md carries the two conventions.
- [x] The three stale `will-attach-webview` comments corrected.
- [x] The two first-run specs are `active`; the three spec-drift text fixes applied.

## Files Affected
- `CLAUDE.md`; `src/renderer/renderer.js`, `src/preload/internal-preload.js`, `src/main/settings-store.js`
  (comments only); `tests/behavior/{tab-surface-geometry,internal-tab-menus,mcp-drive-end-to-end,page-context-menu}.md`.

---

## Post-Completion Checklist
- [x] a11y gate green; test/typecheck/lint green
- [x] Housekeeping + spec fixes applied
- [x] Flight log updated; Leg status → `landed` (no commit); check off in flight.md
