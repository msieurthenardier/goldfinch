# Leg: foundations-and-risk-retirement

**Status**: completed
**Flight**: [Bookmarking Core and Surfaces](../flight.md)

## Objective

Land the bookmarks data spine (store, broadcasts, IPC), the two shortcut classifier actions with a new classifier-parity contract test, the `background` tab-open option with its session-restore rewrite and call-site audit, and the cross-surface drag spike verdict — no user-visible UI in this leg.

## Context

- Flight DD1 (store shape), DD2 (exact-URL identity), DD3 (chrome-only sender-resolved IPC + `bookmarks-changed` broadcast), DD5 (shortcuts + parity test), DD10 (background open, session-restore rewrite) all land here. DD9's spike runs here so its verdict is on record before leg 3 builds the overflow surface.
- Commits are deferred to flight end, so interim states (classifier actions with no dispatch consumer yet) are acceptable within the flight — legs 2/3 wire the dispatch cases to real handlers.
- Baseline discipline: record the unit-test count at leg start (M14 convention: 3095 at last flight close; count is the comparable metric).

## Inputs

- Clean flight branch `flight/01-bookmarking-core-and-surfaces` (untracked planning artifacts under `missions/` and `tests/behavior/bookmarks-*.md` are expected)
- No `bookmark` identifier exists anywhere in `src/` (greenfield — verified at mission planning)

## Outputs

- `src/main/bookmarks-store.js` (new), `src/main/register-bookmarks-ipc.js` (new)
- `src/shared/bookmark-url.js` (new pure ESM predicate module)
- Modified: `src/shared/keydown-action.js`, `src/shared/sheet-accelerator.js`, `src/renderer/chrome/shortcut-controller.js`, `src/shared/guest-forward-allowlist.js`, `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`, `src/main/main.js` (wiring), `src/renderer/chrome/tab-controller.js` (`createTab` background option), `src/renderer/renderer.js` (session-restore rewrite)
- New unit tests: bookmarks-store, bookmark-url, shortcut-classifier-parity; broadcast-invariant test extended
- Flight log: activate-on-create audit table; drag spike verdict; baseline record

## Acceptance Criteria

- [x] `src/main/bookmarks-store.js` exists: Electron-free module following the **actual `jars.js` storage pattern** — module-scope `require('./app-db')`, document store resolved inside `load(userDataPath)`; no invented DI seam (design-review correction: no store in `src/main/` takes `{documentStore}` as injected deps). Envelope `{version: 1, bookmarks: []}`; entry `{id, url, title, icon, addedAt}`; array order is display order. `load()` never throws: corrupt envelope → fresh empty; invalid entries dropped individually (unit-tested for: round-trip, corrupt envelope, bad-entry drop with valid siblings kept, reorder, update, remove).
- [x] Entry validation: `url` passes `isSafeTabUrl` and is not `about:blank` (the `homePage` validator precedent in `src/main/settings-store.js`); `icon` is absent or matches the `favicon-fetch.js` `DATA_IMAGE_RE` gate (`/^data:image\//i` — design-review tightening; other `data:` types are invalid; empty-string icon normalizes to absent with the entry kept); `title` non-empty string (fallback to url).
- [x] `update()` URL-collision ruling: an update whose new URL exactly matches a **different** existing bookmark is rejected as a no-op (result shape `{ok: false, reason: 'duplicate-url'}`), preserving the one-bookmark-per-exact-URL invariant; unit-tested. (UI presentation of the rejection is legs 2/3 scope.)
- [x] `src/shared/bookmark-url.js` exports the exact-committed-URL-match predicate (DD2) used by store dedupe; pure ESM, unit-tested (fragment difference ≠ same, identical string = same).
- [x] Every mutation (`add`, `update`, `remove`, `reorder`) broadcasts `bookmarks-changed` with empty payload via `broadcastToChromeAndInternal` (`src/main/broadcasts.js:createBroadcasters`); `test/unit/broadcast-invariant.test.js` extended to pin the no-snapshot contract for `bookmarks-changed`.
- [x] Sender-resolved chrome IPC registered (new `src/main/register-bookmarks-ipc.js`, wired in `main.js` like the other registrars): `bookmarks-get` (invoke) + mutation channels; `src/preload/chrome-preload.js` exposes `bookmarksGet`/`bookmarkAdd`/`bookmarkUpdate`/`bookmarkRemove`/`bookmarkReorder`/`onBookmarksChanged` (follow the existing `onJarsChanged` chrome-preload subscription shape); `src/renderer/renderer-globals.d.ts` gains matching entries. Add is idempotent by DD2 predicate (re-adding an existing URL returns the existing entry, no duplicate).
- [x] Classifier: `Ctrl+D` → `bookmark-page`, `Ctrl+Shift+B` → `toggle-bookmarks-bar` in `src/shared/keydown-action.js:keydownToAction` AND hand-mirrored in `src/shared/sheet-accelerator.js:sheetAcceleratorAction`, with `Ctrl+Shift+B` in the shifted chain before the unshifted-letter branch (the Ctrl+Shift+T/P/I placement); `dispatchChromeAction` in `src/renderer/chrome/shortcut-controller.js` gains cases for both actions (calling context hooks that may be stub-wired until legs 2/3); `src/shared/guest-forward-allowlist.js`: `bookmark-page` added to `WEB_CHROME_ACTIONS` only, `toggle-bookmarks-bar` to both `WEB_CHROME_ACTIONS` and `INTERNAL_CHROME_ACTIONS`.
- [x] New `test/unit/shortcut-classifier-parity.test.js`: for a corpus covering every sheet-recognized chord plus near-miss variants (wrong modifier, unshifted/shifted confusions), asserts parity **scoped to chrome-scope results only**: wherever `sheetAcceleratorAction` returns `{scope: 'chrome', action}`, `keydownToAction` returns the same action for the equivalent input. Guest-only accelerators with no chrome analog are exempt by scope and the exemption is asserted explicitly (the pre-existing unshifted Ctrl+P divergence: sheet → `{scope:'guest', action:'print'}`, chrome classifier → null). Design-review correction: unscoped "identical actions" parity is testably false today.
- [x] `createTab` (`src/renderer/chrome/tab-controller.js`) accepts `background: true` in its options bag and skips its self-activation for that case only; default path byte-for-byte behavior-equivalent (activation still synchronous).
- [x] Session restore (`src/renderer/renderer.js` restore loop) rewritten: restore creates tabs without depending on serial self-activation and explicitly activates exactly the saved active tab at the end; existing session-restore unit expectations (if any) updated with the rename-not-delete convention.
- [x] Activate-on-create audit: every `createTab` call site enumerated (grep `createTab(` across `src/`) with a verdict per site (unchanged / needs-background-awareness / rewritten), recorded as a table in the flight log. Cross-window adopt is documented as NOT a `createTab` site (design-review finding).
- [x] Drag spike verdict recorded in the flight log Decisions section, one verdict per axis — (a) chrome-DOM → guest-surface drag delivery, (b) chrome ↔ menu-overlay-sheet drag delivery — each viable / not-viable / needs-operator-manual-test with evidence. **Hard constraints from this repo's own precedent** (`tests/behavior/cross-window-drag.md`, `docs/mcp-automation.md`): synthetic pointer injection cannot initiate native HTML5 DnD (dead instrument — do not spend the time-box on `dragPointer`/CDP drag attempts), and fabricating `DragEvent`/`DataTransfer` via `evaluate` to drive drop handlers is **forbidden as false-pass green-wash** — it must never ground a "viable" verdict. The expected honest outcome is **needs-operator-manual-test**: the deliverable per axis is a pre-authored ~2-minute operator procedure (the cross-window-drag HAT-apparatus pattern), plus fast corroborating evidence where legitimately available (note: `npm run dev:automation` runs WSLg-**Wayland** by default, where cross-surface drag is documented to cancel on leaving the source surface; the `--ozone-platform=x11` variant carries a first-click-swallow quirk). Spike instrumentation is throwaway — NOT left in the working tree.
- [x] `npm test`, `npm run typecheck`, `npm run lint` all green; new test count and baseline (start vs end) recorded in the flight log. (`npm run a11y` baseline: attempt against the running app; if the app can't be launched in this session, record that explicitly in the flight log instead of silently skipping.)

## Verification Steps

- `npm test` — all green, count recorded
- `npm run typecheck && npm run lint` — clean
- `node --test test/unit/bookmarks-store.test.js test/unit/shortcut-classifier-parity.test.js` — targeted green
- `grep -rn "bookmarks-changed" src/ test/` — broadcast emitted in store-mutation path only, invariant test present
- `grep -rn "background" src/renderer/chrome/tab-controller.js` — option present; `grep -c "activateTab" src/renderer/renderer.js` restore path shows explicit final activation
- Flight log contains: audit table, spike verdict, baseline record

## Implementation Guidance

1. **Store first** (`bookmarks-store.js`): copy the `jars.js` module shape — module-scope app-db require, store resolved in `load(userDataPath)`, `freshDefaults()`, per-entry validator, whole-document write per mutation. Store API returns copies, never internal references.
2. **IPC + broadcast**: follow `src/main/jar-ipc.js`'s single-broadcast-helper pattern; register channels in a new registrar wired from `main.js` alongside the existing `register*Ipc` calls. Classify channels per CLAUDE.md's three routing classes: these are sender-resolved inbound + broadcast fan-out; no per-tab owner-routing.
3. **Classifier lockstep**: read the `Ctrl+N` addition (M09 F6) as the literal precedent; respect both files' LOCKSTEP PIN comments. Parity-test shape mismatch to handle deliberately (design-review): `keydownToAction` takes `{ctrl, …}` and returns `string|null`; `sheetAcceleratorAction` takes `{control, …}` (different modifier field name) and returns `{scope, action, autoRepeatGuard}|null` — build the corpus with an explicit adapter per function, never one shared descriptor object.
4. **`createTab` background**: the option must not disturb the `activateTab() ran synchronously` invariant for the default path (see the existing comments around creation/activation ordering in `tab-controller.js`). For restore: build the tab set, then one explicit `activateTab(savedActiveId)`, **with the fallback wired in the same change**: if no saved-active id resolves, activate the last created tab (Edge Cases) — under an all-background create loop, forgetting the fallback means nothing gets activated.
5. **Spike**: instrument, observe, revert — within the hard constraints in the acceptance criterion (no synthetic-drag attempts, no fabricated DragEvent evidence). Legitimate fast evidence: reading the documented Wayland cancellation behavior against a real manual drag attempt if a display is available; otherwise author the operator procedures and record the environment facts. Record the WSLg geometry caveat (`src/shared/tab-drag-zone.js` header) alongside whatever is observed.

## Edge Cases

- **Corrupt envelope vs corrupt entry**: envelope unparseable/wrong-shape → whole store repairs to empty; single bad entry → drop it, keep siblings. Test both.
- **Duplicate add race**: two adds of the same URL (e.g. star + Ctrl+D) — second returns existing entry, no duplicate row, only one broadcast needed.
- **`reorder` with unknown/missing ids**: ignore unknown ids, preserve entries omitted from the id list (append in prior order) — never drop data on a malformed reorder.
- **Restore with zero tabs / missing saved-active id**: explicit activation falls back to the last created tab (match current restore fallback behavior).

## Files Affected

- `src/main/bookmarks-store.js` (new), `src/main/register-bookmarks-ipc.js` (new), `src/shared/bookmark-url.js` (new)
- `src/shared/keydown-action.js`, `src/shared/sheet-accelerator.js`, `src/shared/guest-forward-allowlist.js`, `src/renderer/chrome/shortcut-controller.js`
- `src/renderer/chrome/tab-controller.js`, `src/renderer/renderer.js`
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`, `src/main/main.js`
- `test/unit/` — new: bookmarks-store, bookmark-url, shortcut-classifier-parity; extended: broadcast-invariant

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (including audit table, spike verdict, baseline)
- [x] Set this leg's status to `landed` (in this file's header) — flight-end review promotes to `completed`
- [x] Check off this leg in flight.md
- [ ] Do NOT commit (flight-end batched commit)

---

## Citation Audit

9 symbol-form citations mechanically verified at leg design time (grep, 2026-07-28): `createDocumentStore`, `isSafeTabUrl`, `broadcastToChromeAndInternal`, `keydownToAction`, `sheetAcceleratorAction`, `WEB_CHROME_ACTIONS`, `INTERNAL_CHROME_ACTIONS`, `dispatchChromeAction`, `onJarsChanged` — all present; LOCKSTEP PIN comments confirmed in both classifier files; `broadcast-invariant.test.js` and `keydown-action.test.js` exist. One repair: `renderer-globals.d.ts` corrected to `src/renderer/renderer-globals.d.ts`. ~24 `createTab(` call-site hits counted for the audit scope.

**Audit addendum (post design review)**: three citations added by review incorporation — `favicon-fetch.js:DATA_IMAGE_RE`, `tests/behavior/cross-window-drag.md`, `docs/mcp-automation.md` — independently re-verified by the second-pass design reviewer, 2026-07-28.
