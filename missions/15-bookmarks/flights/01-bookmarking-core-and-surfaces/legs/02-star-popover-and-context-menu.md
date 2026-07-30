# Leg: star-popover-and-context-menu

**Status**: completed
**Flight**: [Bookmarking Core and Surfaces](../flight.md)

## Objective

Ship the first user-visible bookmarking surfaces: the address-bar star with correct filled/outline state through all five sync paths, the `bookmark-edit` quick-edit popover sheet (name, URL, Remove/Done), the page-context "Bookmark this page" item, live Ctrl+D wiring, and icon capture-at-star with passive refresh.

## Context

- Governing flight DDs: DD2 (exact-URL predicate — `bookmarkUrlsMatch`, never re-derive), DD4 (star + popover), DD5 (Ctrl+D behaves exactly like a star click), DD6 (icons). Leg 1 landed the data spine; this leg consumes it.
- Leg-1 ground truth (flight log): preload surface is `bookmarksGet/bookmarkAdd/bookmarkUpdate/bookmarkRemove/bookmarkReorder/onBookmarksChanged`; `bookmark-add` broadcasts **only when created** (idempotent re-add silent); `update()` rejects cross-entry URL collision `{ok:false, reason:'duplicate-url'}`; `dispatchChromeAction` has a swallow-only stub for `bookmark-page` (replace it; leave `toggle-bookmarks-bar` for leg 3).
- **FD ruling — seam growth**: the evaluate-seam closed set MAY grow by exactly one entry this leg (`openBookmarkEditOverlayForAudit`), following the every-new-sheet precedent; update `test/unit/seam-contract.test.js` count and the CLAUDE.md dual-source note in the same change. Recorded in flight log.
- **FD ruling — line budget**: `RENDERER_LINE_BUDGET` (1766; renderer.js is at 1765) MAY be bumped with the customary rationale comment (`seam-contract.test.js` precedent) — but only after new logic that belongs in `src/renderer/chrome/bookmarks-client.js` (new module) lives there, not in renderer.js.

## Inputs

- Leg 1 landed (store/IPC/predicate/shortcut plumbing in working tree, uncommitted)
- `src/shared/bookmark-url.js:bookmarkUrlsMatch`; `src/main/register-bookmarks-ipc.js` channels; chrome-preload methods + `BookmarkEntry` typings

## Outputs

- New: `src/renderer/chrome/bookmarks-client.js` (cache + boot + subscribe triad), `src/shared/bookmark-edit-template.js` (+ unit test), sheet-side `bookmark-edit` wiring, `menu-overlay:bookmark-edit-submit` invoke path, star button + `refreshStar`
- Modified: `src/renderer/index.html`, `src/renderer/chrome/navigation-controller.js`, `src/renderer/chrome/tab-controller.js` (call-site pairing), `src/renderer/renderer.js`, `src/renderer/menu-overlay.js`, `src/renderer/menu-overlay.css`, `src/preload/menu-overlay-preload.js`, `src/preload/chrome-preload.js`, `src/main/register-overlay-ipc.js`, `src/shared/page-context-model.js`, `src/renderer/chrome/shortcut-controller.js`, `src/renderer/renderer-globals.d.ts`, `scripts/a11y-audit.mjs`, `test/unit/seam-contract.test.js`, CLAUDE.md (pattern notes)

## Acceptance Criteria

- [x] **Bookmarks cache**: new `src/renderer/chrome/bookmarks-client.js` cloned from the `jars-client.js` boot/applyState/subscribe triad — boots via `bookmarksGet()`, re-queries on `onBookmarksChanged`, exposes a synchronous lookup by URL (using `bookmarkUrlsMatch`) plus the ordered list. Cache freshness contract: source of truth is the main-side store; rebuild trigger is the `bookmarks-changed` broadcast (invalidation-not-snapshot); staleness bounded by one broadcast round-trip.
- [x] **Star control**: button in `#address-wrap` between `#address-chip` and the address input; hidden on internal tabs and tabs without a wcId via a `refreshStar(tab)` sibling modeled on `refreshZoomControl` (`src/renderer/chrome/navigation-controller.js:refreshZoomControl` — including its hidden-early-return shape; lookups are synchronous against the cache, no async race guard needed). Filled state ⟺ cache holds the active tab's exact URL. `aria-pressed` reflects state; `title` follows the `"Label (Chord)"` toolbar convention (`Bookmark this page (Ctrl+D)`).
- [x] **Five sync paths verified** (design-review correction): `refreshStar` called beside all three `updateAddressChip` call sites (`renderer.js:onTabDidNavigate`, `renderer.js:onTabDidNavigateInPage`, `tab-controller.js:activateTab` — inside `activateTab`'s single body, which automatically covers adopt-tab), **plus** the wcId-arrival site inside `createTab`'s `tabCreate().then()` callback where `refreshZoomControl(tab)` is already called directly (`tab-controller.js` ~line 327 — without this, `restoreHistory`-based creates (duplicate/reopen/restore) can boot a permanently hidden star since they skip `loadURL` and may never fire `did-navigate`), **plus** the cache's `bookmarks-changed` re-query completion (covers cross-window edits).
- [x] **Boot-race closed**: `bookmarksClient.boot` joins the startup `Promise.all` in `renderer.js` (~line 1673) exactly as `jarsClient.boot` does, so the first tab's star renders only after the cache is populated.
- [x] **Star click / Ctrl+D behavior** (one shared handler; `dispatchChromeAction`'s `bookmark-page` arm calls it): unbookmarked page → `bookmarkAdd({url: tab.url, title: <tab.title, falling back to url, never the literal 'New tab' seed>, icon: tab.favicon ?? undefined})` then open the popover for the created entry; bookmarked page → open the popover directly. Inert (no-op, control hidden anyway) on internal tabs — `bookmark-page` is already web-guest-only in the forward allowlist.
- [x] **`bookmark-edit` sheet template**: new menuType registered in ALL of `TEMPLATES` (+ JSDoc union), `NODE_OF_ENTRY`; card built by new pure `src/shared/bookmark-edit-template.js` (the `auth-basic-template.js` sibling shape, `textContent`-only labels), composed with `attachModalCard` for Escape/backdrop/4-way Tab cycle (`name` input → `url` input → Remove → Done); card sets its own `aria-label` (dialog family — not `MENU_LABELS`).
- [x] **Anchored positioning attempt**: popover card positioned at the invoking anchor (star: `getBoundingClientRect()` → `chromePointToSheet(left, bottom)` — the toolbar-unpin idiom) via `positionNode` applied to the **card** (unhide before measuring). Implementation note (design review): the card needs its own `position: absolute` so `positionNode`'s inline `left/top` take effect — unlike `.new-container-inner`, which relies on flex centering and sets no position; the backdrop may keep its flex rules since an absolutely-positioned child leaves the flex flow. `attachModalCard`'s `getCycle()` is already arbitrary-length — the 4-way cycle needs no new machinery. If anchored positioning proves unworkable within the leg, fall back to the centered card (flight Adaptation Criteria pre-authorize; record as Deviation). Note: `chromePointToSheet` clamps y≥0, so the popover may hug the sheet's top edge rather than pixel-anchor to the star — accepted, HAT-visible.
- [x] **Popover payload path (DD3-preserving)**: form submission does NOT ride channel 4 (24-char value cap; close-on-activation). New dedicated invoke `menu-overlay:bookmark-edit-submit` in `src/preload/menu-overlay-preload.js` + handler in `src/main/register-overlay-ipc.js` following the sibling discipline exactly: `recordForSheetSender`, token freshness gate, per-field validation in a new pure Electron-free validator module (unit-tested; the `menu-overlay-value.js` testability pattern), close-only-on-success; on success main **forwards to the chrome** via `chromeForAttachment(rec.win)?.send('bookmark-edit-submit', payload)` (the `vault-setup` forward precedent) — the chrome subscriber then issues `bookmarkUpdate`/`bookmarkRemove` itself. `MAX_ACTIVATED_VALUE_LENGTH` untouched.
- [x] **Two rejection paths, two UXes** (design-review correction — do not conflate): (a) **Pre-forward validation failure** (malformed/unsafe/internal URL, empty fields — catchable per-field): the invoke returns `{ok:false}` and the sheet **stays open** with a generic inline error, per the vault-unlock re-prompt precedent; close-only-on-success discipline. (b) **Store-side `duplicate-url`** (cross-entry comparison, structurally invisible to the per-field validator): surfaces only after close via the chrome's `bookmarkUpdate` call — minimal v1 presentation: star/cache re-derive to truth, nothing further this leg (noted for HAT feedback). `reason:'invalid-url'` post-close should be unreachable given (a) — assert this understanding in a code comment rather than leaving it implied.
- [x] **Page context menu**: `pageContextModel(params, toolbarItem, opts = {})` — options-object third parameter (decided: extensible, backward-compatible with the existing 2-arg test calls) carrying `opts.isBookmarked`; new `action:bookmark-page` item (label "Bookmark this page" / "Edit bookmark…" when already bookmarked) in the always-present section beside `action:inspect`; unit tests updated (model is pure — test both label states and omission on toolbar mode). Chrome passes `isBookmarked` from the cache using `findTabByWcId(pageCtx.wcId).url` — never guest-influenced `params`. Dispatch: new `else if` branch in the `page-context` case following the VALIDATED-NO-OP discipline — re-resolve the tab from captured `wcId`, no-op if gone, then run the shared star handler against THAT tab's URL (TOCTOU rule).
- [x] **Icon passive refresh (DD6)**: in the `onTabFavicon` handler, after `tab.favicon = fav`: if the cache holds a bookmark matching `tab.url` (`bookmarkUrlsMatch`) AND its stored icon differs from `fav`, issue `bookmarkUpdate({id, icon: fav})` — the difference guard prevents broadcast storms on routine navigation.
- [x] **Audit seam (FD ruling)**: `openBookmarkEditOverlayForAudit` seam entry + `SHEET_STATES`/`SHEET_NODE_IDS` rows in `scripts/a11y-audit.mjs`; `seam-contract.test.js` closed-set count updated in the same change with the CLAUDE.md dual-source note. The pre-existing `sheet:kebab` a11y error is NOT this leg's to fix — attempt the a11y run, record results (including whether the kebab error masks the new states) in the flight log.
- [x] **Line budget (FD ruling)**: bookmark logic lives in `bookmarks-client.js`; residual renderer.js additions (overlay state entry via `fixedTriggerMenu`, dispatch case, `bookmark-edit-submit` subscriber, audit seam) justify a minimal `RENDERER_LINE_BUDGET` bump with the customary rationale comment.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; count vs leg-1 close (3192) recorded in flight log; new unit tests for: bookmark-edit template model, submit-payload validator, page-context-model bookmark states, bookmarks-client cache behavior (if extractable as pure logic).

## Verification Steps

- `npm test && npm run typecheck && npm run lint` — green, count recorded
- `node --test test/unit/bookmark-edit-template.test.js test/unit/page-context-model.test.js test/unit/seam-contract.test.js` — targeted green
- `grep -n "bookmark-edit-submit" src/main/register-overlay-ipc.js src/preload/menu-overlay-preload.js src/preload/chrome-preload.js` — dedicated channel present at all three layers
- `grep -n "MAX_ACTIVATED_VALUE_LENGTH" src/main/menu-overlay-value.js` — still 24, untouched
- `grep -c "refreshStar" src/renderer/chrome/navigation-controller.js src/renderer/renderer.js src/renderer/chrome/tab-controller.js` — all five sync paths wired (incl. the `createTab` wcId-arrival site)
- Manual/MCP smoke if app launchable: star fills on add, popover opens, rename propagates — full validation deferred to `/behavior-test bookmarks-star-sync` at flight verification

## Edge Cases

- **Star pressed before favicon resolves**: `tab.favicon` still null → bookmark stores no icon (monogram case) — accepted per DD6; passive refresh backfills on next favicon delivery.
- **Popover submit with URL edited to another bookmark's URL**: store rejects (`duplicate-url`); star re-derives from cache; no data loss (accepted-minimal presentation, see AC).
- **Popover submit with URL edited to an unsafe/internal URL**: caught by the pre-forward validator — rejection path (a): the sheet **stays open** with the inline error (NOT the post-close minimal presentation; the store's own `isSafeTabUrl` check remains the authoritative backstop).
- **Tab closed while popover open**: chrome subscriber re-resolves entry by id at submit; entry operations are id-based so tab death is irrelevant; if the bookmark was removed meanwhile, `not-found` no-ops.
- **Two windows, popover open in each for the same bookmark**: last submit wins (whole-entry update); `bookmarks-changed` re-syncs both windows.
- **Ctrl+D on internal tab**: not forwarded (allowlist) and chrome-focused dispatch finds star hidden → handler no-ops on `isInternalTab`.

## Files Affected

*(see Outputs — 4 new files, ~14 modified)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (incl. a11y run result, any Deviation on anchoring fallback)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (flight-end batched commit)

---

## Citation Audit

Load-bearing symbols verified at leg design time (grep + same-day code interrogation, 2026-07-28): `attachModalCard` (`src/shared/modal-card-controller.js`), `recordForSheetSender`/`chromeForAttachment` (`src/main/register-overlay-ipc.js`), `positionNode`/`TEMPLATES`/`NODE_OF_ENTRY` (`src/renderer/menu-overlay.js`), `refreshZoomControl` (`src/renderer/chrome/navigation-controller.js`), `openPageContextOverlaySheet`/`pageCtx` (`src/renderer/renderer.js`), `auth-basic-template` (shared + unit test), `SHEET_STATES` (`scripts/a11y-audit.mjs`, `test/unit/seam-contract.test.js`), `RENDERER_LINE_BUDGET` (=1766; renderer.js measured 1765), `bookmarkUrlsMatch` (`src/shared/bookmark-url.js`, leg 1), chrome-preload bookmark methods (leg 1). Interrogation flagged and this spec absorbed: first-ever anchored modal card (fallback pre-authorized), y≥0 anchor clamp, add-broadcasts-only-when-created, favicon values already `data:image/*` by construction.
