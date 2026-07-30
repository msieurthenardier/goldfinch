# Flight Log: Bookmarking Core and Surfaces

**Flight**: [Bookmarking Core and Surfaces](flight.md)

## Summary

Leg 1 (`foundations-and-risk-retirement`) landed: bookmarks data spine (store + broadcast +
chrome-only IPC), the two shortcut classifier actions with a new classifier-parity contract
test, the `background` `createTab` option with the session-restore rewrite and full
activate-on-create audit, and the cross-surface drag spike verdict (both axes:
needs-operator-manual-test). No shipped UI. Baseline 3095 → 3192 unit tests (+97), typecheck
and lint clean.

Leg 2 (`star-popover-and-context-menu`) landed: the address-bar star with five-path state
sync, the `bookmark-edit` anchored quick-edit popover (first-ever anchored modal card),
the page-context "Bookmark this page" item, live Ctrl+D wiring, and DD6 icon passive
refresh. Bookmark business logic lives in the new `bookmarks-client.js` per the leg's
line-budget ruling. 3192 → 3222 unit tests (+30), typecheck and lint clean. `npm run a11y`
reproduced the same pre-existing `sheet:kebab` secret-sheet refusal leg 1 recorded — it
masks the new `sheet:bookmark-edit` a11y state (never reached this run); not this leg's
to fix.

Leg 3 (`bar-settings-and-overflow`) landed: the settings-page section merge ("Startup &
appearance"), the `bookmarksBarEnabled` toggle (Settings checkbox + Ctrl+Shift+B, converging
on one stored value via the new `toggle-bookmarks-bar` main-side channel), the bookmarks bar
itself (icons/monograms, tooltips, click-navigate, middle/Ctrl+click background open, instant
non-animated reflow), and the `bookmarks-overflow` sheet with index dispatch and the sheet's
first-ever per-row context menu. ALL bar/overflow logic lives in the new
`src/renderer/chrome/bookmarks-bar.js` per the leg's line-budget ruling. 3222 → 3244 unit
tests (+22), typecheck and lint clean. `npm run a11y` attempt: reordering `SHEET_STATES` to
put the two new bookmark states before `sheet:kebab` did **not** achieve the FD ruling's
intended "real audit coverage" — the `isSheetContents` secret-sheet refusal in
`resolve.js` fires on the **identity of the sheet's wcId itself** (the one shared
`WebContentsView` behind every menuType), not on which menu content is displayed, so it
now fails immediately on whichever state is tried FIRST regardless of order. This run
failed on `sheet:bookmark-edit` (now first) before `sheet:bookmarks-overflow` (second) was
ever reached — see Decisions below for the full account. Not this leg's to fix (the guard
predates the flight and is out of scope), but recorded as a materially different finding
from legs 1/2's "kebab masks the new state" note: reordering cannot fix this class of
masking at all.

Leg 4 (`omnibox-bookmarks-source`) landed: the `bookmark-suggest.js` hand-mirror matcher
(quoted-phrase adjacency + unicode61 diacritic folding, empirically verified against a live
FTS5 corpus), the `bookmarks-suggest` main-side channel (app-scoped, `{ok, suggestions}`
envelope mirroring `history-suggest`), the `mergeSuggestionSources` merge model
(bookmark-first, history-dedupe-by-URL, `kind` stamping), the navigation controller's
`Promise.allSettled` dual-source query with per-source degrade-to-`[]`, and the suggestions
sheet's bookmark-row badge (`aria-describedby` to a `.sr-only` node, never `aria-label` on the
row). `tests/behavior/omnibox-suggestions.md`'s absolute cross-jar zero-rows step narrowed to
history-only, per DD11 (edited, not run). 3244 → 3271 unit tests (+27), typecheck and lint
clean. `npm run a11y` reproduced the identical pre-existing `isSheetContents` secret-sheet
refusal legs 1-3 recorded — see the Leg 4 progress entry below for the account (no new
information; still not this leg's to fix).

---

## Leg Progress

### Leg 1 — `foundations-and-risk-retirement` — **landed**

**Built:**
- `src/main/bookmarks-store.js` (new) — Electron-free, jars.js's collection-store template;
  envelope `{version:1, bookmarks:[]}`; per-entry validate/repair (url drop-worthy,
  title/icon repaired); `add`/`update`/`remove`/`reorder` with copies-only reads.
- `src/shared/bookmark-url.js` (new) — the DD2 exact-URL-match predicate, pure ESM.
- `src/main/register-bookmarks-ipc.js` (new) — sender-resolved chrome-only IPC (DD3, no
  internal twin), `bookmarks-get`/`bookmark-add`/`bookmark-update`/`bookmark-remove`/
  `bookmark-reorder`, every mutation broadcasting `bookmarks-changed` with an empty payload
  (idempotent re-add suppressed).
- Wired into `src/main/main.js` (require + registrar call) and `src/main/init-profile.js`
  (`bookmarks.load(path)` joins the settings/jars/downloads load sequence — `profileStores`
  in `main.js` extended with `bookmarks: bookmarksStore`).
- Classifier lockstep (DD5): `Ctrl+D` → `bookmark-page`, `Ctrl+Shift+B` →
  `toggle-bookmarks-bar` in both `src/shared/keydown-action.js` and
  `src/shared/sheet-accelerator.js`; `guest-forward-allowlist.js` (`bookmark-page` web-only,
  `toggle-bookmarks-bar` both guest kinds); `dispatchChromeAction` in
  `src/renderer/chrome/shortcut-controller.js` gains stub cases (handled, no consumer yet —
  legs 2/3 wire the real behavior).
- `test/unit/shortcut-classifier-parity.test.js` (new): chrome-scope-only parity between
  `keydownToAction` and `sheetAcceleratorAction`, plus the explicit unshifted-Ctrl+P
  guest-scope exemption and a near-miss corpus.
- `createTab` (`src/renderer/chrome/tab-controller.js`) gains `background: true` (skips
  self-activation only; default path unchanged). Session-restore loop
  (`src/renderer/renderer.js`) rewritten to pass `background: true` on every restore create
  and explicitly activate the saved-active tab (or, absent one, the last created tab) once
  at the end.
- Preload/typing surface: `src/preload/chrome-preload.js` and
  `src/renderer/renderer-globals.d.ts` gain the five bookmarks bridge methods +
  `onBookmarksChanged` + a `BookmarkEntry` type.
- New unit tests: `bookmarks-store.test.js`, `bookmark-url.test.js`,
  `shortcut-classifier-parity.test.js`; extended `broadcast-invariant.test.js` (bookmarks-
  changed no-snapshot contract), `keydown-action.test.js`, `sheet-accelerator.test.js`,
  `guest-forward-allowlist.test.js` (the two new chords/actions), `init-profile-order.test.js`
  (bookmarks joins the load-order invariant), `session-restore-wiring.test.js` (one pin
  re-targeted — see Deviations).

**Baseline**: 3095 (leg start) → 3192 (leg end), +97 tests. `npm run typecheck` and
`npm run lint` both clean throughout. No fault-injection flakes observed (full suite run
twice back to back, 3192/3192 both times).

**`npm run a11y` attempt**: the app launched successfully in this session
(`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`,
Wayland, admin key minted) and the audit was run against it. It errored on the `sheet:kebab`
state: `automation: secret-sheet — wcId N is a chrome-owned secret/overlay sheet and is never
automatable (any tier)` (`src/main/automation/resolve.js:126`, untouched by this leg). This
leg's changes are backend/classifier-only — no DOM/CSS/menu-model changes — so this is almost
certainly a pre-existing condition orthogonal to leg 1 (not investigated further; a11y-surface
work is legs 2/3+ scope, where the bar/popover/overflow actually add new audit-relevant DOM).
Recorded per the AC's own instruction to record the attempt rather than silently skip it. App
processes were cleanly killed after the attempt (`pgrep` confirmed no survivors).

**Activate-on-create audit** and **drag spike verdict**: see Decisions below.

---

### Leg 2 — `star-popover-and-context-menu` — **landed**

**Built:**
- `src/renderer/chrome/bookmarks-client.js` (new) — the `jars-client.js` boot/applyState/
  subscribe triad (`createBookmarksClient`): boots via `bookmarksGet()`, re-queries on
  `onBookmarksChanged`, exposes a synchronous `findByUrl` (the DD2 `bookmarkUrlsMatch`
  predicate). Also houses the bookmark BUSINESS logic the leg's line-budget ruling keeps
  out of `renderer.js`: `activateStar(tab)` (the one shared star-click/Ctrl+D/page-context
  decision — add-then-resolve on an unbookmarked page, resolve-existing on a bookmarked one,
  inert on internal tabs/no-wcId) and `handleEditSubmit(payload)` (the bookmark-edit sheet's
  forwarded-submit body — issues the actual `bookmarkUpdate`/`bookmarkRemove`; chrome is the
  sole bookmark-mutation issuer). An optional `onChanged` hook covers the 5th star-sync path
  (fires only after a BROADCAST-triggered re-query completes, never the raw event, so it
  never reads a stale cache).
- `src/shared/bookmark-edit-template.js` (new) — pure, document-injected DOM builder for the
  `bookmark-edit` sheet card (the `auth-basic-template.js` sibling shape): labeled name/url
  inputs, an aria-live error line, Remove/Done actions. `+ test/unit/bookmark-edit-template.test.js`.
- `src/main/bookmark-edit-validate.js` (new) — pure, Electron-free per-field validator
  (`validateBookmarkEditFields`, the `menu-overlay-value.js` testability pattern) mirroring
  the store's own `validUrl` (never widened past `isSafeTabUrl`). `+
  test/unit/bookmark-edit-validate.test.js`.
- `src/renderer/menu-overlay.js` — the `bookmark-edit` template (the SIXTEENTH kind, and the
  FIRST-EVER anchored modal card: `positionNode` is applied to the CARD, not the backdrop —
  every prior dialog-style card ignores its anchor and centers via CSS). Submit rides the
  DEDICATED `menuOverlay.bookmarkEditSubmit` invoke, never channel-4 `sendActivated`.
  Registered in `TEMPLATES`/`NODE_OF_ENTRY`/the model-shape gate/the init dispatch.
- `src/renderer/menu-overlay.css` — `#sheet-bookmark-edit` (backdrop, flex-centering as a
  no-anchor fallback) + `.bookmark-edit-inner { position: absolute; }` (so `positionNode`'s
  inline left/top take effect on the card — an absolutely-positioned child simply leaves the
  parent's flex flow, so the two rules coexist).
- `src/main/register-overlay-ipc.js` — the `menu-overlay:bookmark-edit-submit` handler,
  gated on an injected `validateBookmarkEdit` (offline overlay tests never register it):
  `recordForSheetSender`, open-token freshness, `action:'remove'` skips field validation
  entirely, a `save` failure returns `{ok:false}` with NO close (rejection path (a) — the
  sheet stays open with a generic inline error), a pass closes the sheet then forwards
  `{id, action, name?, url?}` to the owning chrome via `chromeForAttachment(rec.win)?.send(
  'bookmark-edit-submit', …)` — main never touches `bookmarksStore` on this path. Wired in
  `main.js` with `validateBookmarkEditFields`.
- `src/preload/menu-overlay-preload.js` (`bookmarkEditSubmit`) + `src/preload/chrome-preload.js`
  (`onBookmarkEditSubmit`) + `src/renderer/renderer-globals.d.ts` / `src/renderer/menu-overlay-globals.d.ts`
  type additions.
- `src/shared/page-context-model.js` — `pageContextModel(params, toolbarItem, opts = {})`:
  a third, backward-compatible options parameter carrying `opts.isBookmarked`; a new
  `action:bookmark-page` item ("Bookmark this page" / "Edit bookmark…") in the always-present
  section beside `action:inspect` (one separator before the group, none between the two
  items). `test/unit/page-context-model.test.js` fully updated (every existing ids()
  assertion gained the new item; new tests for both label states + the toolbar-mode
  omission).
- Star control: `#star` in `index.html` between `#address-chip` and `#address`
  (`src/renderer/styles.css` — absolutely positioned, `#address`'s left padding bumped
  40px→68px). `refreshStar(tab)` in `navigation-controller.js` (modeled on
  `refreshZoomControl`, including its hidden-early-return shape — but SYNCHRONOUS, no async
  race guard needed). Five sync-path call sites: `tab-controller.js`'s `activateTab` and the
  `createTab` wcId-arrival `.then()` (covers `restoreHistory`-based creates, which skip
  `loadURL` and may never fire `did-navigate`), `renderer.js`'s `onTabDidNavigate` and
  `onTabDidNavigateInPage`, and `bookmarksClient`'s `onChanged` hook (cross-window edits).
  `bookmarksClient.boot` joins the startup `Promise.all` (boot-race gate).
- Shared star-activation handler: `handleBookmarkStarActivate(tab)` in `renderer.js` (calls
  `bookmarksClient.activateStar` then opens `openBookmarkEditOverlay` on a non-null
  resolution) — wired from the star's own click listener, from
  `shortcut-controller.js`'s `bookmark-page` (Ctrl+D) case, and from the page-context
  dispatch's new `action:bookmark-page` branch (TOCTOU-safe — re-resolves the tab from the
  captured wcId first).
- DD6 icon passive refresh: `onTabFavicon` in `renderer.js` issues `bookmarkUpdate({id,
  icon})` when the cache holds a matching bookmark AND its stored icon differs from the
  freshly-delivered one (difference guard — no broadcast storms on routine navigation).
- Evaluate seam (FD ruling): `openBookmarkEditOverlayForAudit` — the seam closed set grows
  31 → 32 (`test/unit/seam-contract.test.js` `SEAM_COUNT`, CLAUDE.md's dual-source note
  updated in the same change). `scripts/a11y-audit.mjs` gained `sheet-bookmark-edit` in
  `SHEET_NODE_IDS` and a `sheet:bookmark-edit` `SHEET_STATES` entry.
- Line budget (FD ruling): `RENDERER_LINE_BUDGET` 1766 → 1866 (+100) — the sheet's residual
  chrome-wiring footprint (overlay-state entry, the anchored-open + shared-handler glue that
  can't move into `bookmarks-client.js` since it needs sheet/anchor machinery, the
  dispatch stub case + the page-context branch, the `bookmarksClient` construction + boot-race
  join, two of the five star-sync call sites, the DD6 icon-refresh line, the star
  trigger + submit-subscriber wiring, and the seam hook) — bookmark BUSINESS logic (the
  cache, `activateStar`'s decision, the edit-submit forward body) lives in
  `bookmarks-client.js`, not here.
- New/updated unit tests: `bookmark-edit-template.test.js`, `bookmark-edit-validate.test.js`,
  `bookmarks-client.test.js` (boot/subscribe/`findByUrl`/`activateStar`/`handleEditSubmit`
  against a fake bridge), `page-context-model.test.js` (rewritten), `register-overlay-ipc.test.js`
  (6 new cases for the bookmark-edit-submit handler), `navigation-controller.test.js`
  (`refreshStar`), `shortcut-controller.test.js` (`bookmark-page` routes through the shared
  handler), `tab-controller.test.js` (harness gained a `refreshStar` stub).

**Baseline**: 3192 (leg start) → 3222 (leg end), +30 tests. `npm run typecheck` and
`npm run lint` both clean throughout. No fault-injection flakes observed (full suite run
twice back to back, 3222/3222 both times).

**`npm run a11y` attempt**: the app launched successfully in this session
(`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`,
admin key minted) and the audit was run against it with the media fixture served on
`:8000`. It errored on the FIRST sheet state, `sheet:kebab`: `automation: secret-sheet —
wcId 5 is a chrome-owned secret/overlay sheet and is never automatable (any tier)` — the
IDENTICAL pre-existing condition leg 1 recorded (`src/main/automation/resolve.js:126`,
untouched by this leg). Because `sheet:kebab` is the first entry in `SHEET_STATES`, the
harness throws before ever reaching the new `sheet:bookmark-edit` state near the end of the
list — **the kebab error fully masks the new bookmark-edit a11y state this run; it was
never exercised.** Per the leg's own AC instruction ("attempt the a11y run, record results
including whether the kebab error masks the new states"), this is recorded rather than
silently skipped; the `sheet:kebab` refusal is explicitly not this leg's to fix (predates
the flight). The `bookmark-edit` template's structural/aria contract is instead pinned
offline by `bookmark-edit-template.test.js` (the `auth-basic-template.test.js` precedent for
exactly this apparatus gap). App/fixture-server processes were cleanly killed after the
attempt (`pgrep` confirmed no survivors).

---

### Leg 3 — `bar-settings-and-overflow` — **landed**

**Built:**
- **Settings merge** (`src/renderer/pages/settings.html`/`.css`/`.js`, DD7): the former
  `#startup` section's content (home-page input + restore-session fieldset) moved into
  `<section id="appearance">`, whose `<h2>` is now "Startup & appearance"; `#startup` and its
  nav `<li>` removed outright; nav link text updated. All moved-content element ids are
  UNCHANGED (settings.js selects by id only). `settings.css:270`'s `#startup label[for=
  "home-page-input"]` re-scoped to `#appearance label[...]` (the design-review catch from the
  leg spec's own Context) — the home-page label would otherwise have silently lost its
  styling once `#startup` was removed.
- **`bookmarksBarEnabled` setting** (`src/main/settings-store.js`): DEFAULTS gains
  `bookmarksBarEnabled: false`, strict-boolean validator (the `restoreSession` template, not
  the typeof-fallback), no version bump (additive-key rule), no normalizer.
- **Settings toggle UI**: checkbox `#bookmarks-bar-enabled`, cloned from the restore-session
  IIFE idiom byte-for-byte in shape (guard, direct `.checked` assignment, `change` →
  `settingsSet`, `onSettingsChanged` re-sync, `pagehide` teardown).
- **`toggle-bookmarks-bar` main-side channel** (`src/main/register-settings-ipc.js`): the
  `unpin-toolbar-item` shape exactly — a bare `ipcMain.on` that flips `bookmarksBarEnabled`
  and broadcasts `settings-changed` itself. `chrome-preload.js` gains `toggleBookmarksBar()`;
  `shortcut-controller.js`'s `toggle-bookmarks-bar` case (Ctrl+Shift+B, landed as a stub in
  leg 1) now calls it. The Settings checkbox and the shortcut converge on the exact same
  stored value — no divergent state.
- **Bar markup + instant reflow**: `#bookmarks-bar` inserted between `#toolbar` and `#main`
  in `index.html` (body-level flex column — a fixed-height row shrinks `#main` with no other
  CSS change), a fixed `#bookmarks-overflow` chevron button as its one permanent child.
  `styles.css` carries a **zero-transition** rule block with an INVARIANT comment (the
  media/privacy-panel precedent, cited M15 F1) explaining why the guest-bounds change this
  row's visibility triggers can never be animated (a `WebContentsView`'s bounds move in one
  discrete `setBounds` step — a CSS transition would animate only the chrome-DOM box while
  the guest slot snaps at t=0, the same chrome-ramps/guest-steps mismatch the panel
  INVARIANT documents). `window-controller.js` gains `applyBookmarksBar(enabled)` (mirrors
  `applyToolbarPins`: initial `settingsGet` read + `onSettingsChanged` live path) and calls
  the newly-threaded `sendActiveBounds()` dep **explicitly** after every apply — belt-and-
  suspenders over the `#webviews` ResizeObserver, per the AC.
- **Bar rendering + overflow** (new `src/renderer/chrome/bookmarks-bar.js`, `createBookmarksBar`
  — houses ALL bar/overflow business logic per the leg's line-budget FD ruling): renders one
  `<button class="bm-item">` per `bookmarksClient.list` entry ahead of the chevron; icon
  `<img>` for a stored `data:image/*` icon, else a letter-monogram tile; native `title`
  tooltip `"{title}\n{url}"`. Re-renders on the bookmarks cache's post-refresh signal — the
  **existing single `onChanged` closure** at `renderer.js`'s `createBookmarksClient(...)` call
  site (formerly just `refreshStar`) is extended inline to also call `render()` and
  `closeOverflowIfOpen()`; no independent `onBookmarksChanged` subscription was added (would
  fire before the cache refresh resolves and could read stale `bookmarksClient.list`).
  Overflow measurement is a `ResizeObserver` on the bar + a cumulative item-width walk (a NEW
  pattern — no in-repo precedent; the tab strip is pure CSS) with a fixed chevron-width
  reservation and a re-entrancy guard (skip re-partitioning when the bar's own measured size
  is unchanged from the last pass — the design-review-adopted defense against
  ResizeObserver loop-limit warnings). The overflow sheet (menuType `bookmarks-overflow`,
  template family `menu` — shares `menuNode`, no `NODE_OF_ENTRY` addition) opens with a
  chrome-side SNAPSHOT of exactly the overflowed entries; rows dispatch `bookmark:<i>`
  (navigate) via the standard channel-4 click path, and the sheet's FIRST-EVER per-row
  `contextmenu` (gated in `menu-overlay.js`'s `renderMenu` to `menuType === 'bookmarks-
  overflow'` only) sends `bookmark-edit:<i>` on the SAME channel — no new IPC channel.
- **Bar activation**: left-click/Enter navigates the current tab via the same `navigate()`
  path omnibox suggestion acceptance uses; middle-click (`auxclick` button 1) and Ctrl/Cmd+
  click open a background tab via the **three-arg** `createTab(url, null, { background:
  true })` form — verified non-negotiable per the leg's design-review correction (the 2-arg
  form would land `{background:true}` in the container parameter, silently defeating
  background-open and corrupting jar resolution); right-click opens the leg-2 popover
  anchored at the item.
- **`openBookmarkEditOverlay` anchor parameterization** (leg-2 code, small refactor per the
  leg's Context): `function openBookmarkEditOverlay(bookmark, anchorEl = els.star)` — every
  leg-2 call site (which passes only `bookmark`) is unaffected (defaults to the star); bar/
  overflow call sites pass their own trigger element. Reuses the ALREADY pure + unit-tested
  `chromePointToSheet`/`convertChromePointToSheet` (`overlay-menus.test.js`) rather than
  inventing a duplicate pure helper.
- **Audit seam** (FD ruling): `openBookmarksOverflowOverlayForAudit` — the seam closed set
  grows 32 → 33 (`test/unit/seam-contract.test.js` `SEAM_COUNT`, CLAUDE.md's dual-source note
  updated in the same change), plus a `SHEET_STATES` entry — **no** `NODE_OF_ENTRY` /
  `SHEET_NODE_IDS` additions (the menu family shares the single `menuNode`/`sheet-menu` id).
  **FD ruling — SHEET_STATES ordering**: `scripts/a11y-audit.mjs`'s `SHEET_STATES` reordered
  so `sheet:bookmark-edit` and the new `sheet:bookmarks-overflow` sit BEFORE `sheet:kebab`,
  with a comment recording the rationale — see the `npm run a11y` account below for what this
  reorder actually achieved (materially less than intended).
- **Behavior-spec updates** (edited, NOT run — flight-verification/HAT runs them):
  `settings-shell.md` step 3 rewritten (4 links / 4 sections: Startup & appearance, Privacy &
  Shields, Automation, About — `startup` id dropped); `settings-controls.md` step 1's
  "On-startup section" → "Startup & appearance section" wording; `toolbar-pins.md`'s full
  "Appearance" → "Startup & appearance" prose sweep (22 sites — every occurrence in the file,
  a slightly larger sweep than the leg's own "~16" estimate, since every occurrence
  genuinely refers to the merged section name).
- **Line budget** (FD ruling, second minimal bump): `RENDERER_LINE_BUDGET` 1866 → 1933
  (+67) — the bar/overflow's residual renderer.js footprint (overlay-state entry,
  `bookmarksBarController` construction + boot-race `render()` join, the extended
  `onChanged` closure, the `dispatchOverlayActivation` case, the parameterized-anchor
  refactor, the `sendActiveBounds` dep thread into `window-controller.js`, and the seam
  hook) — bar/overflow rendering, measurement, and dispatch logic lives in the new
  `bookmarks-bar.js`, not here.
- **Keyboard model decision** (flight-log-noted per the AC): plain document tab order over
  native `<button>`s, NOT the APG toolbar roving-tabindex pattern — `index.html`'s
  `#bookmarks-bar` carries no `role="toolbar"`/`aria-orientation` (a `role="group"` label
  container instead). Rationale: the roving-tabindex toolbar pattern is the more
  Chrome-parity-faithful choice but adds real state-machine complexity (arrow-key navigation,
  tracked focus index, `tabindex` bookkeeping across dynamic add/remove/overflow-collapse) for
  a control row that is small, infrequently focused, and already keyboard-operable via plain
  Tab order — the "documented simpler tab-order" option the AC explicitly authorizes. Each
  `<button>`'s native Enter/Space-activates-click behavior needs no extra wiring.
- New/updated unit tests: `settings-store.test.js` (4 new — `bookmarksBarEnabled` default/
  set/validator-reject/pre-leg-migration); `register-settings-ipc.test.js` +
  `helpers/settings-ipc-harness.js` (`toggle-bookmarks-bar` listener registration + flip/
  broadcast behavior); `window-controller.test.js` (2 new — `applyBookmarksBar` visibility +
  explicit `sendActiveBounds`, live settings-changed sync); `shortcut-controller.test.js` (1
  new — `toggle-bookmarks-bar` calls the bridge method exactly); `bookmarks-bar.test.js` (new,
  14 tests — the pure `monogramLetter`/`tooltipFor`/`partitionOverflow`/`overflowSheetModel`/
  `resolveOverflowRowId` truth tables, plus a fake-DOM harness for render/overflow-collapse/
  chevron-dispatch/click-modifier/contextmenu behavior — the `tab-controller.test.js` dynamic-
  import + hand-rolled-fakes precedent).

**Baseline**: 3222 (leg start) → 3244 (leg end), +22 tests. `npm run typecheck` and
`npm run lint` both clean throughout. No fault-injection flakes observed (full suite run
twice back to back, 3244/3244 both times).

**`npm run a11y` attempt**: the app launched successfully in this session
(`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`,
Wayland, admin key minted) with the media fixture served on `:8000`, and the audit was run
against it. It errored on the very FIRST `SHEET_STATES` entry — now `sheet:bookmark-edit`
(reordered ahead of `sheet:kebab` per this leg's FD ruling): `automation: secret-sheet — wcId
5 is a chrome-owned secret/overlay sheet and is never automatable (any tier)` —
`src/main/automation/resolve.js`'s `isSheetContents` guard, byte-identical in shape to the
refusal legs 1/2 recorded on `sheet:kebab`, untouched by this leg.

**Finding (goes beyond what legs 1/2 recorded)**: the FD ruling's premise — that reordering
the two bookmark states ahead of `sheet:kebab` would let them "get real audit coverage
instead of being masked by the pre-existing kebab refusal" — does not hold. Reading
`resolve.js` (`isSheetContents(wc)`, called before any DOM/content is inspected) shows the
refusal is keyed on the **wcId identity of the menu-overlay sheet itself** — ONE
`WebContentsView` per window, shared by every menuType (kebab, container, bookmark-edit,
bookmarks-overflow, …). The refusal therefore fires on **whichever `SHEET_STATES` entry is
attempted first**, unconditionally, at every tier (the guard is explicitly "ABSOLUTE, NOT
lifted by admin" per its own comment) — it is not specific to kebab's content and reordering
cannot route around it. This run's own evidence: `sheet:bookmark-edit` (now first) failed
immediately; `sheet:bookmarks-overflow` (now second, this leg's other new state) was
**never reached either** — the masking is total for the whole sheet-audit sweep regardless
of order, not a one-state problem the reorder could fix. Both of this flight's new
sheet-audit states (`sheet:bookmark-edit` from leg 2, `sheet:bookmarks-overflow` from this
leg) remain unexercised by `npm run a11y` in every session run so far (legs 1, 2, and 3).
This is recorded per the AC's own instruction to record results rather than silently skip;
fixing `resolve.js`'s guard is explicitly out of scope for this leg (pre-existing, not a
bar/overflow surface). The bar's own structural/aria contract (buttons, tooltip text,
monogram fallback, chevron `aria-haspopup`/`aria-expanded`) is instead pinned offline by
`bookmarks-bar.test.js`'s DOM-harness assertions — the `bookmark-edit-template.test.js`
precedent for exactly this apparatus gap. App/fixture-server processes were cleanly killed
after the attempt (`pgrep` confirmed no survivors).

---

### Leg 4 — `omnibox-bookmarks-source` — **landed**

**Built:**
- `src/shared/bookmark-suggest.js` (new, pure ESM) — the FTS5 hand-mirror matcher (DD11):
  `tokenize` (NFKD-decompose + strip Unicode combining marks + lowercase + split into
  `\p{L}\p{N}` runs — the unicode61-default-tokenizer mirror), `queryWordTokens`
  (`sanitizeSearchQuery`'s whitespace-split/quote-strip mirror, re-tokenized per word),
  `phraseMatches` (adjacent-in-order sub-token run, last sub-token prefix-matched — the
  quoted-phrase-prefix semantics `"exa-mple"*` needs), `entryMatches` (a query word satisfies
  EITHER the title or url tokens independently — verified cross-column AND, not a same-field
  requirement), and `matchBookmarks` (stored order, `limit` default 3, non-throwing on any
  input).
- `test/unit/bookmark-suggest.test.js` (new, 12 tests) — unit coverage of the pure helpers
  PLUS the load-bearing FTS5-parity test: builds a live in-memory `node:sqlite` FTS5 table
  (`tokenize='unicode61'`, `prefix='2 3 4'` — the exact `visits_fts` config) over a 19-entry
  corpus (adjacency-positive/negative, diacritics, ligature/stroke letters, digits, mixed
  case, three-way punctuation splits, 1-char uncovered-prefix queries) × 25 queries, and
  asserts the JS matcher agrees with FTS5 on EVERY (entry, query) pair — zero divergences.
  Two additional single-assertion pins (adjacency-required, ligature-never-cross-matched) sit
  alongside the sweep. **Verified the test actually catches drift**: temporarily swapped
  `phraseMatches` for an AND-of-independent-prefixes implementation (the wrong design the AC
  warns against) — 3 of the 12 tests failed, including the parity sweep itself, confirming
  the corpus is load-bearing rather than incidentally green.
- `src/main/register-bookmarks-ipc.js` — `bookmarks-suggest` invoke (app-scoped, no jarId):
  `{ ok: true, suggestions }` on the (non-throwing) matcher path, `{ ok: false, suggestions:
  [] }` on the defensive catch — the envelope shape mirrors `history-suggest` exactly
  (design decision: consistency over minimalism).
- `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts` — `bookmarksSuggest`
  bridge method + type.
- `src/shared/omnibox-suggest-model.js` — new export `mergeSuggestionSources` (bookmark rows
  first — pre-capped at ≤3 by the source's own limit, not re-capped here — then history rows
  deduped by `bookmarkUrlsMatch` against the bookmark set, bookmark wins, total capped at 6,
  every row stamped `kind: 'bookmark' | 'history'`); `buildSuggestionModel` now forwards
  `kind` onto each model item (`'bookmark'` only when the source row says so, `'history'`
  otherwise — including legacy/pre-merge inputs with no `kind` field at all, so nothing
  silently renders unmarked). `shouldQuery` byte-for-byte untouched (verification grep
  confirmed same-day). `+ test/unit/omnibox-suggest-model.test.js`: 3 new kind-passthrough
  tests, 8 new `mergeSuggestionSources` tests (bookmark-first ordering, exact-URL dedupe,
  the 4th+-bookmark edge case surfacing its history row plain, the 6-cap with bookmarks
  counted first, a custom-limit case, both-source-empty degradation both directions,
  non-throwing on malformed input).
- `src/renderer/chrome/navigation-controller.js` — the input listener now issues
  `historySuggest` and `bookmarksSuggest` together via `Promise.allSettled` (NOT
  `Promise.all` — design-review correction carried into implementation: a rejected or
  `{ok:false}` source degrades to `[]` independently, so one source's failure never blanks
  the other), gates the settled pair through the EXISTING `acceptSuggestResponse` seq
  discipline unchanged, merges via `mergeSuggestionSources`, and paints. The prior
  single-source `.catch()` close-on-failure branch is gone — a total dual-source failure now
  degrades to an empty merged list (which paints the sheet's existing "No matches" empty
  state) rather than closing the dropdown, consistent with the per-source degrade contract.
  `+ test/unit/navigation-controller.test.js`: harness gained a `bookmarksSuggest` mock
  (resolve/reject controls) and a stand-in `mergeSuggestionSources` dep; 4 new tests (both
  sources queried + merged bookmark-first; a bookmarks-side rejection degrades to `[]`
  while history still paints; a history-side rejection degrades to `[]` while bookmarks
  still paint; an `{ok:false}` bookmarks response degrades the same as a rejection). The
  pre-existing stale-response test was extended to resolve both promises (`Promise.allSettled`
  now waits on the pair).
- `src/renderer/renderer.js` — `mergeSuggestionSources` imported and threaded into
  `createNavigationController`'s deps on the SAME line as `buildSuggestionModel` (line-budget
  discipline: the file sits at 1932 of 1933 budgeted lines; combining the two dep names onto
  one line kept the net delta at zero new lines rather than requesting another FD budget
  bump for a single dependency wire).
- `src/renderer/menu-overlay.js` — `renderSuggestions`'s row-build gains a `kind === 'bookmark'`
  branch: a visible `.sg-badge` span (`textContent = 'Bookmark'`, a REAL DOM node — no CSS
  `content:` glyph, per design review's "zero precedent for generated-content markers" — and
  `aria-hidden="true"` so its visible text does NOT leak into the option's computed
  accessible NAME) plus a `.sr-only` text node (`textContent = 'bookmark'`, a real accessibility-
  tree member — NOT `display:none`/`hidden`, which would remove it from the tree and defeat
  `aria-describedby`) wired via a per-row `aria-describedby` id on the option row. Deliberately
  NOT `aria-label` on the row (would override the computed accessible name outright and drop
  the visible primary/secondary text for AT users — the AC's explicit warning).
- `src/renderer/menu-overlay.css` — `.sg-option` gains `position: relative` (anchors the
  badge); new `.sg-badge` (small pill, `pointer-events: none`, top-right absolute) and a
  locally-defined `.sr-only` (menu-overlay.html is a separate document that does not load
  `styles.css`, so the existing chrome-side `.sr-only` rule is reproduced here rather than
  cross-document-imported).
- `tests/behavior/omnibox-suggestions.md` — step 3's absolute "ZERO suggestion rows"
  wording narrowed to "ZERO **history** rows... Bookmark rows... ARE permitted" per DD11
  (edited, not run — flight-verification/HAT runs it).

**FTS5 semantics verified empirically before writing the matcher** (Node 22 / SQLite 3.50.4,
`node:sqlite`, matching the design review's own verification method): `"exa-mple"*` matches
`exa mplecase` but not `exa foo mplecase` (adjacency required); `café`≡`cafe` and
`İstanbul`≡`istanbul` (diacritic folding via NFKD decompose + combining-mark strip); `øre`,
`œuvre`, `łódź`'s `ł`, and `straße` are NOT folded to their unaccented/expanded forms (no
compatibility decomposition for these letters — `ł` itself stays `ł` even though `ó`/`ź` in
the same word DO fold, since those decompose to a base letter + a combining mark); a
multi-word query AND-combines but each word may satisfy its phrase in EITHER the title or
url column independently (verified against a two-column in-memory FTS5 table) — informed the
`entryMatches` cross-field design. All findings are reproduced as corpus entries in
`bookmark-suggest.test.js`, not just prose.

**Baseline**: 3244 (leg start) → 3271 (leg end), +27 tests (12 bookmark-suggest + 11
omnibox-suggest-model + 4 navigation-controller). `npm run typecheck` and `npm run lint` both
clean throughout. No fault-injection flakes observed (full suite run twice back to back,
3271/3271 both times).

**`npm run a11y` attempt**: the app launched successfully in this session
(`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`,
Wayland, admin key minted) with the media fixture served on `:8000`, and the audit was run
against it. It errored on the FIRST `SHEET_STATES` entry, `sheet:bookmark-edit`: `automation:
secret-sheet — wcId 5 is a chrome-owned secret/overlay sheet and is never automatable (any
tier)` — the IDENTICAL `isSheetContents` refusal legs 1-3 recorded (`src/main/automation/
resolve.js`, untouched by this leg), keyed on the shared sheet `WebContentsView`'s identity
regardless of content or `SHEET_STATES` order (per leg 3's own finding). No new information
this run — leg 4 adds no new `SHEET_STATES` entry at all (there is still no dedicated
`sheet:suggestions` audit state in `scripts/a11y-audit.mjs`; the suggestions sheet has never
had one, before or after this leg), so this leg's own new surface (the bookmark-row badge)
was never going to be reached by `npm run a11y` even absent the kebab/bookmark-edit masking.
The badge's structural/aria contract (a real `.sg-badge` DOM node, `aria-hidden` on it, a
`.sr-only` description node, `aria-describedby` wiring) is instead reasoned about directly
against `menu-overlay.js`'s source (no dedicated fake-DOM unit test exists for `menu-
overlay.js`'s rendering — consistent with the established leg 1-3 precedent that this
presentation-only, `document`-coupled page script has no unit-test harness; its contract is
verified via a11y/behavior tests, which this leg's a11y attempt could not reach for the
reasons above). Not this leg's to fix (the `resolve.js` guard predates the flight, out of
scope). App/fixture-server processes were cleanly killed after the attempt (`pgrep` confirmed
no survivors).

---

## Decisions

### Activate-on-create audit (AC — background-tab-open risk retirement)

Every `createTab(` call site in `src/` (grep-enumerated, 22 real call sites + 1 documented
non-site), verdict per site. `background` is opt-in (default `false`); every site below that
doesn't pass it keeps byte-for-byte default behavior — **unchanged** means exactly that, not
"not reviewed."

| # | Call site | Trigger | Verdict |
|---|-----------|---------|---------|
| 1 | `renderer.js:193` | Boot: default `goldfinch://settings` internal tab | unchanged |
| 2 | `renderer.js:671` | Container-menu "Burner" action | unchanged |
| 3 | `renderer.js:677` | Container-menu jar selection | unchanged |
| 4 | `renderer.js:776` | Page-context "Open link in new tab" | unchanged |
| 5 | `renderer.js:784` | Page-context "Open image in new tab" | unchanged |
| 6 | `renderer.js:803` | Page-context "Search for selection" | unchanged |
| 7 | `renderer.js:889` | Tab-context "Duplicate" | unchanged |
| 8 | `renderer.js:1256` | `onOpenTab` (guest `window.open` popups) | unchanged |
| 9 | `renderer.js:1694` | **Session-restore loop** | **REWRITTEN** — `background:true` + explicit final `activateTab` (saved-active, else last-created fallback) |
| 10 | `renderer.js:1699` | Session-restore fallback (no saved session / `bootTab`) | unchanged |
| 11 | `shortcut-controller.js:55` | `Ctrl+T` new-tab | unchanged |
| 12 | `shortcut-controller.js:80` | `Ctrl+Shift+T` reopen-closed-tab | unchanged |
| 13 | `navigation-controller.js:80` | Address-bar Alt+Enter / modified-Enter open-in-new-tab | unchanged |
| 14 | `navigation-controller.js:291` | `#newtab-pill` click | unchanged |
| 15 | `media-controller.js:216` | Media-panel item "open full-size as a tab" | unchanged |
| 16 | `tab-controller.js:660` | `closeTab`'s never-zero-tabs fallback | unchanged |
| 17 | `tab-controller.js:968` | Automation `openTab` hook (`__goldfinchAutomation`) | unchanged |
| 18 | `overlay-menus.js:102` | Kebab "Downloads" | unchanged |
| 19 | `overlay-menus.js:106` | Kebab "Cookie jars" | unchanged |
| 20 | `overlay-menus.js:110` | Kebab "Passwords" (vault) | unchanged |
| 21 | `overlay-menus.js:125` | Site-info "Site settings →" | unchanged |
| 22 | `overlay-menus.js:145` | New-container-create → open tab in the new jar | unchanged |

**Documented non-site (design-review finding, reconfirmed)**: cross-window tab adopt
(`tab-controller.js`'s `onAdoptTab` handler) does **NOT** go through `createTab` — it calls
`buildStripRecord` directly and assigns the already-live `wcId` (the webContents already
exists; there is nothing to "activate on create"). Out of this audit's scope by construction,
not by oversight.

**Finding**: no call site required structural change to tolerate a non-activating create
existing alongside it — background is additive and every existing site is default-path
byte-identical. The only site that *needed* to change is the one this leg's DD10 targets: the
session-restore loop, which is the one caller that previously depended on
each-create-self-activates as an (accidental) mechanism for "the last tab created ends up
active" — replaced with an explicit, Edge-Case-covered activation.

### Drag spike verdict (DD9 / AC — cross-surface drag retirement)

Per this repo's own precedent (`tests/behavior/cross-window-drag.md`, `docs/mcp-automation.md`):
synthetic pointer injection (`dragPointer`, CDP) **cannot initiate native HTML5 DnD** — a dead
instrument, not attempted. Fabricating `DragEvent`/`DataTransfer` via `evaluate` to drive drop
handlers is **forbidden as false-pass green-wash** and was **not attempted**. No throwaway
instrumentation was added to the working tree (nothing to revert).

**Environment facts recorded** (Implementation Guidance #5 — the WSLg geometry caveat,
`src/shared/tab-drag-zone.js` header): this implementation session is a headless/agentic
sandbox with **no human operator present** to perform a physical mouse drag — the hard
constraint against synthetic-drag attempts and fabricated `DragEvent` evidence therefore
forecloses a "viable" verdict on EITHER axis from this session, structurally, regardless of
apparatus availability. As fast corroborating evidence (not a drag attempt): `npm run
dev:automation` was launched with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1`
under a bounded timeout — the app booted on **Wayland** (matching the documented WSLg default)
and printed a live `AUTOMATION_DEV_MINT` line (admin key mint succeeded), confirming the
automation surface itself is reachable in this sandbox. However the captured stdout also
interleaved console output from unrelated, already-running web content sharing this sandbox's
compositor session (non-Goldfinch content) — this sandbox's display is **not an isolated rig**,
reinforcing that a trustworthy manual observation needs a clean, operator-controlled machine
(the `cross-window-drag.md` spec's own X11 + fresh-scratch-profile precondition), not this
session. The process was killed after the bounded window; no lingering Electron/Goldfinch
process remains (`pgrep` confirmed clean).

**Verdict — axis (a) chrome-DOM → guest-surface delivery: `needs-operator-manual-test`.**
**Verdict — axis (b) chrome ↔ menu-overlay-sheet delivery: `needs-operator-manual-test`.**

Both are the expected honest outcome per the leg spec. Pre-authored operator procedures
(~2 minutes each), for a future keyed HAT session, using only EXISTING draggable product
surfaces (no bookmarks UI exists yet — this leg ships none):

---

**Procedure (a) — chrome-DOM → guest-surface drag delivery**

*Question*: does a native HTML5 drag session that STARTS on a chrome-DOM element survive the
pointer crossing into the guest `WebContentsView`'s native compositing surface (a different
process/paint surface, not a DOM descendant of the chrome window)?

*Apparatus*: `npm run dev:automation -- --ozone-platform=x11` (X11, not Wayland — Wayland is
already known to cancel a drag that leaves its source surface, so it cannot discriminate this
question; expect the first-click-swallow quirk, spend one throwaway click first). Admin MCP
client for observation only.

1. Executor: open one web tab at any http(s) URL (`openTab`). Confirm it is the active tab.
2. Executor: over the chrome target, `evaluate` a ONE-LINE throwaway listener on the active
   tab's `.tab` button: `document.querySelector('.tab.active').addEventListener('dragover',
   () => (window.__gfDragProbe = (window.__gfDragProbe||0)+1))` — this only proves the CHROME
   side keeps receiving dragover during the gesture; the load-bearing read is (3).
3. Executor: over the GUEST target (the active tab's own wcId), `evaluate` a throwaway
   top-level listener: `window.addEventListener('dragover', () => (window.__gfDragProbe =
   (window.__gfDragProbe||0)+1)); window.addEventListener('drop', () => (window.__gfDropSeen =
   true))`.
4. **OPERATOR**: press and hold on the active tab in the strip (a chrome-DOM `draggable=true`
   element — the same native source the tab-drag/tear-off machinery already uses), drag the
   pointer DOWN into the page content area (the guest's screen region) without releasing, hold
   there ~1 second, then release. Confirm.
5. Executor: `evaluate(guestWcId, "window.__gfDropSeen === true")` and re-read
   `window.__gfDragProbe` on the guest. `captureScreenshot` both chrome and guest for the
   record.
6. Executor: **REMOVE the throwaway listeners** (reload the tab, or a `evaluate` that clears
   the two globals) — leave no instrumentation behind.

*Expected results / verdict rule*: `__gfDropSeen === true` (or a nonzero guest-side
`__gfDragProbe`) on the guest ⇒ **viable**. No guest-side event at all, with the OPERATOR
confirming a real hold-and-release inside the content area, ⇒ **not-viable** (the native drag
session died at the view boundary — expected on the same structural grounds as the documented
Wayland cross-window cancellation, but for a *within-window* cross-surface boundary, which is
UNMEASURED before this run). A build that will not launch under X11 in the operator's
environment, or an operator unable to complete the physical gesture, resolves this axis
`needs-operator-manual-test` again (unchanged), not a silent pass either way.

---

**Procedure (b) — chrome ↔ menu-overlay-sheet drag delivery**

*Question*: does a native HTML5 drag session cross between chrome DOM and the menu-overlay
sheet's `WebContentsView` (the surface every popup menu, including DD9's planned bookmarks-
overflow menu, renders on)?

*Apparatus*: same as (a) — X11, admin MCP client for observation only.

1. Executor: open the kebab menu (`click` the kebab button) so the sheet is live; read its
   `wcId` from `enumerateWindows().sheetWcId`. Keep at least one ordinary tab open too.
2. Executor: over the sheet target, `evaluate` a throwaway listener:
   `window.addEventListener('dragover', () => (window.__gfDragProbe =
   (window.__gfDragProbe||0)+1)); window.addEventListener('drop', () => (window.__gfDropSeen =
   true))`.
3. **OPERATOR**: press and hold on the active tab in the strip (the chrome-DOM drag source),
   drag the pointer onto the OPEN kebab menu's rendered area (the sheet, floating over the
   guest), hold ~1 second, release. Confirm.
4. Executor: `evaluate(sheetWcId, "window.__gfDropSeen === true")`, re-read the sheet's
   `__gfDragProbe`. `captureScreenshot` the chrome (the sheet composites into the same window
   capture — no separate window to shoot).
5. Executor: **REMOVE the throwaway listeners** — close and reopen the menu (a fresh sheet
   load clears module state) rather than leaving the probe wired.

*Expected results / verdict rule*: same rule as (a) — a genuine drop/dragover observed on the
sheet ⇒ **viable**; a confirmed real gesture with no sheet-side event ⇒ **not-viable**; a build/
launch/operator-availability failure resolves `needs-operator-manual-test` again.

---

**Consumption**: DD9 (overflow surface) stands as designed for Flight 2 — the provisional
choice was never gated on this leg's spike resolving to a verdict either way (the leg spec's
Adaptation Criteria divert only if the spike shows the sheet **cannot host overflow at all**,
which was not tested here — this spike is about the *drag transport crossing into* the sheet,
not the sheet's ability to host a click/keyboard-driven overflow menu, which is unaffected).
Flight 2 (or a future flight, if bookmarks drag-reorder is prioritized) owns actually running
these two procedures in a keyed operator session before building any cross-surface drag
feature on either axis.

---

## Deviations

- **`session-restore-wiring.test.js`, AC5 mutation pin re-targeted (not weakened)**: the
  pre-existing test asserted "after removing `if (!container) continue;`, the extracted branch
  body contains no `continue` at all." This leg's rewrite adds a SECOND, unrelated
  `if (!tab) continue;` guard (skips a null return from `createTab` — a defensive no-op today,
  since `createTab` only returns `null` on `isSafeTabUrl` rejection, which a restore URL should
  never trip, but the loop must not push a `null` onto `lastTab`/`activeTab` if it ever did) to
  the same branch, so a bare `.includes('continue')` count could no longer discriminate the
  original mutation. Re-targeted the assertion to the SPECIFIC `'if (!container) continue;'`
  literal (both the real-body presence check and the post-mutation absence check) — the pin's
  intent (the deleted-jar drop must survive) is unchanged and still fails on the same injected
  mutation; only the string it greps for is more specific. Comment added in the test
  documenting why.
- **`renderer.js` line-budget (`seam-contract.test.js`, `RENDERER_LINE_BUDGET = 1766`)**: the
  session-restore rewrite's explanatory comment was trimmed twice to land the file at exactly
  1766 lines (the existing budget, unchanged) rather than requesting a budget bump — a leg-1
  comment-density tradeoff, not a scope reduction; every fact the longer draft carried
  (restoreHistory/insertAt exclusion, the DD4 inheritContainerFromPartition prohibition, the
  DD10 background:true rationale, the Edge Case fallback) survives in the final 7-line form.
- **Leg 2 — none.** Anchored positioning was implemented as specced (no fallback to the
  centered card was needed — the Adaptation Criteria's pre-authorized fallback was not
  triggered). One discretionary/interpretive choice, not a spec deviation: the star's
  `title`/`aria-label` are STATIC ("Bookmark this page (Ctrl+D)" — the AC's own example
  string), unlike the page-context item's label, which does switch to "Edit bookmark…" when
  filled; `aria-pressed` alone carries the fill state to AT, matching a native toggle-button's
  ARIA contract (e.g. a mute button keeps its label constant). The AC specifies only the
  title FORMAT, not label dynamism, so this is a reading, not a departure.
- **Leg 3 — `toolbar-pins.md` prose-sweep count (22 sites, not "~16")**: the AC's own estimate
  was approximate ("~16 prose references"); every literal occurrence of "Appearance" in the
  file genuinely refers to the merged section name, so all 22 were swept rather than stopping
  short at the estimate. Not a scope deviation — a closer reading of the same instruction.
- **Leg 3 — the anchor-parameterization AC's "extracted pure and unit-tested" helper**: read
  as satisfied by REUSE of the already-pure, already-unit-tested `chromePointToSheet`/
  `convertChromePointToSheet` (`overlay-menus.js` + `overlay-menus.test.js`, pre-dating this
  leg) rather than authoring a new, functionally-identical pure wrapper — `openBookmarkEditOverlay`
  was parameterized to accept `anchorEl` (defaulting to `els.star` for the unchanged leg-2 call
  sites) and calls the SAME pure helper on the new anchor element's rect. No new pure function
  was extracted because none was needed to satisfy the AC's actual requirement (a
  pure, tested anchor-translation function existed already); recorded here as an
  interpretive choice, not a spec departure.

---

## Anomalies

- None observed in this leg's own runs. **Baseline provenance note**: the leg-start count
  (3095) is taken from this flight-log's own "Flight start" session note and the leg
  artifact's stated M14 convention (design-review-approved figure, matching the branch's
  clean pre-leg state — working tree held only the expected untracked planning artifacts) —
  `npm test` was NOT independently re-run against the pre-leg tree before implementation
  began in this session (a stash-and-restore to verify it directly was attempted and blocked
  by the harness's safety classifier as a work-discarding action; not retried by another
  route). The end-of-leg count (3192) IS a direct measured result, run twice back to back
  with 3192/3192 both times — no flake. One prior-flight convention note (M14 debrief) called
  out a transient [history] fault-injection flake that cleared on rerun at 3095/3095; this
  leg's own end-of-leg runs showed no flake of any kind to footnote.
- **Leg 2 — none.** The 3192 leg-start count is a direct carry-forward of leg 1's own
  measured end-of-leg result in this same flight-log (no independent re-verification
  needed — no other work landed on the branch between the two legs). The 3222 end-of-leg
  count is a direct measured result, run twice back to back with 3222/3222 both times — no
  flake.
- **Leg 3 — none.** The 3222 leg-start count is a direct carry-forward of leg 2's own
  measured end-of-leg result in this same flight-log (no other work landed on the branch
  between the two legs). The 3244 end-of-leg count is a direct measured result, run twice
  back to back with 3244/3244 both times — no flake. The `npm run a11y` finding (SHEET_STATES
  reordering does not achieve real coverage — see the Leg 3 progress entry above) is a
  substantive result, not an anomaly in this leg's own execution — it is a pre-existing
  `resolve.js` guard behaving consistently across all three legs' attempts.
- **Leg 4 — none.** The 3244 leg-start count is a direct carry-forward of leg 3's own
  measured end-of-leg result in this same flight-log (no other work landed on the branch
  between the two legs). The 3271 end-of-leg count is a direct measured result, run twice
  back to back with 3271/3271 both times — no flake. The `npm run a11y` finding (identical
  `isSheetContents` refusal, first-state masking — see the Leg 4 progress entry above) is a
  substantive, expected result (the leg spec's own "record, don't fix" instruction), not an
  anomaly in this leg's own execution.

---

## Session Notes

### Flight Director Notes

**2026-07-28 — Flight start**: Branch `flight/01-bookmarking-core-and-surfaces` created; flight marked in-flight. Crew file `leg-execution.md` loaded from project `.flightops/` (structure valid).

**Leg 1 risk tier: HIGH** — session-restore lifecycle rewrite (state-machine change), shared-interface change (`createTab` options bag, ~24 call sites), new persistence store, and the classifier lockstep edit (documented drift risk). Per-leg design review required. Citation audit ran clean (one path repair).

**Leg 1 design review**: cycle 1 = approve with changes (7 findings incl. 2 high: spike guidance contradicted repo's own drag precedent; parity AC testably false vs Ctrl+P guest-only divergence). All incorporated, incl. new store ruling: update() URL-collision → rejected no-op. Cycle 2 = approve. Leg marked ready. [HANDOFF:review-needed] → implementation spawn.

**2026-07-28 — Leg 1 implementation complete**: all acceptance criteria met, no partial/deferred items beyond what the leg spec itself authorizes (dispatchChromeAction stub cases for legs 2/3; drag spike lands `needs-operator-manual-test` on both axes, the spec's own expected honest outcome). Baseline 3095 → 3192 (+97), typecheck/lint clean throughout, no flakes on two back-to-back full-suite runs. Leg marked `landed`; flight.md leg checkbox + Leg 1 checkpoint both checked off. No commit made (flight-end batched commit per the leg's post-completion checklist). [HANDOFF:review-needed]

**Leg 2 risk tier: HIGH** — new privileged IPC channel (sheet→main invoke + main→chrome forward; security-sensitive surface), first-ever anchored modal card in the sheet, evaluate-seam closed-set growth, page-context dispatch surface. Design review required.

**FD ruling (leg 2)**: evaluate-seam closed set grows by exactly one entry (`openBookmarkEditOverlayForAudit`) per the every-new-sheet precedent — seam-contract count + CLAUDE.md dual-source note updated in the same change. **FD ruling (leg 2)**: `RENDERER_LINE_BUDGET` may take a minimal bump with rationale comment, but only after bookmark logic is housed in the new `bookmarks-client.js` module. Rationale: both are the established mechanisms for exactly this class of addition; refusing the seam entry would leave the new sheet unauditable, contradicting the flight's a11y verification approach.

**Leg 2 design review**: cycle 1 = approve with changes (high: missing 5th star-sync path at createTab wcId-arrival — restoreHistory creates could boot a hidden star; medium: boot-race gate, conflated rejection UXes). Cycle 2 = approve with changes (two copy-sync leftovers, fixed directly — within max-2-cycles budget as prescription-only fixes). Leg marked ready. [HANDOFF:review-needed] → implementation spawn.

**2026-07-28 — Leg 2 implementation complete**: all acceptance criteria met — star control with all five sync paths (activateTab, the createTab wcId-arrival site, both renderer.js navigation subscriptions, and the bookmarks cache's own post-broadcast re-query), the boot-race gate, the shared star-activation handler wired from the star click / Ctrl+D / page-context "Bookmark this page", the first-ever anchored `bookmark-edit` modal card with the dedicated `menu-overlay:bookmark-edit-submit` invoke (pre-forward validator + close-only-on-success, chrome as the sole mutation issuer), the page-context model's backward-compatible third `opts` parameter, DD6 icon passive refresh, the FD-ruled evaluate-seam growth (31→32) and `RENDERER_LINE_BUDGET` bump (1766→1866) both landed with CLAUDE.md's dual-source note updated in the same change. Baseline 3192 → 3222 (+30), typecheck/lint clean throughout, no flakes on two back-to-back full-suite runs. `npm run a11y` reproduced leg 1's exact pre-existing `sheet:kebab` secret-sheet refusal — it fully masks the new `sheet:bookmark-edit` a11y state this run (never reached); not this leg's to fix, and recorded per the AC's own instruction. No deviations from the leg spec (the anchored-positioning fallback was pre-authorized but not needed). Leg marked `landed`; flight.md leg checkbox + Leg 2 checkpoint both checked off. No commit made (flight-end batched commit per the leg's post-completion checklist). [HANDOFF:review-needed]

**Leg 3 risk tier: HIGH** — settings-store schema addition, new chrome-initiated settings-mutation IPC, guest-bounds layout change (bar reflow), sheet's first per-row contextmenu, invented overflow-measurement pattern (no in-repo precedent), behavior-spec surface edits. Design review required.

**FD ruling (leg 3)**: second RENDERER_LINE_BUDGET bump authorized (minimal, rationale comment, logic housed in new bookmarks-bar.js). **FD ruling (leg 3)**: evaluate-seam growth 32→33 for openBookmarksOverflowOverlayForAudit — same every-new-sheet precedent; refusing would leave the overflow sheet unauditable against the flight's a11y verification approach.

**Leg 3 design review**: cycle 1 = approve with changes (high: createTab 2-arg call would corrupt jar resolution + defeat background-open; medium: settings.css #startup selector, single-subscriber onChanged coordination; low: seam-scope overstatement). Cycle 2 = approve with changes (one stale Context bullet, fixed directly). New FD ruling: SHEET_STATES reordered — bookmark states before kebab so new surfaces get real audit coverage. Leg marked ready. [HANDOFF:review-needed] → implementation spawn.

**2026-07-28 — Leg 3 implementation complete**: all acceptance criteria met — the settings section merge ("Startup & appearance", `settings.css`'s `#startup` selector re-scoped per the design review), `bookmarksBarEnabled` (strict-boolean validator, additive, off-by-default) with the Settings checkbox and Ctrl+Shift+B converging on the same stored value via the new `toggle-bookmarks-bar` channel, the bar (icons/monograms/tooltips/click/middle-Ctrl+click-background-open via the verified three-arg `createTab` form/instant zero-transition reflow with an explicit `sendActiveBounds()` per toggle), the overflow chevron (ResizeObserver + cumulative-width-walk partition, re-entrancy-guarded) with its sheet (index dispatch, the FIRST per-row contextmenu gated to `bookmarks-overflow` only, DD9 close-on-`bookmarks-changed`-while-open), the leg-2 popover's anchor parameterization, the FD-ruled evaluate-seam growth (32→33) and second `RENDERER_LINE_BUDGET` bump (1866→1933) both landed with CLAUDE.md's dual-source note updated in the same change, and the three behavior-spec edits (not run). Baseline 3222 → 3244 (+22), typecheck/lint clean throughout, no flakes on two back-to-back full-suite runs. `npm run a11y` attempt: the SHEET_STATES-reorder FD ruling did NOT achieve its intended "real audit coverage" — the `isSheetContents` refusal is keyed on the shared sheet wcId's identity, not menu content, so it fires on whichever state is tried first regardless of order; `sheet:bookmark-edit` (now first) failed immediately and `sheet:bookmarks-overflow` (now second) was never reached — a materially different, more complete finding than legs 1/2 recorded, written up in full in the Leg 3 progress entry and Decisions; not this leg's to fix (pre-existing `resolve.js` guard, out of scope). Two discretionary readings recorded in Deviations (the 22-site "Appearance" sweep vs. the AC's "~16" estimate; the anchor-parameterization AC satisfied by reusing the already-pure, already-tested `chromePointToSheet` rather than authoring a duplicate). Keyboard model: plain document tab order over native buttons (not APG roving-tabindex toolbar) — the AC's "documented simpler tab-order" option, rationale recorded above. Leg marked `landed`; flight.md leg checkbox + Leg 3 checkpoint both checked off. No commit made (flight-end batched commit per the leg's post-completion checklist). [HANDOFF:review-needed]

**Leg 4 risk tier: HIGH** — shared-interface change (suggest model consumed by controller + sheet), second hand-mirror pair of the flight (JS matcher vs FTS5 semantics; pinned by parity test per DD11). Design review required.

**Leg 4 design review**: cycle 1 = approve with changes (2 high, empirically grounded: FTS5 quoted-phrase adjacency semantics and unicode61 diacritic folding — both would have shipped a drifted matcher; medium: Promise.all fail-close, missing a11y convention, broken verification grep). Cycle 2 = approve. Leg marked ready. [HANDOFF:review-needed] → implementation spawn (final autonomous leg — flight-end Reviewer follows).

**2026-07-28 — Leg 4 implementation complete**: all acceptance criteria met — the
`bookmark-suggest.js` hand-mirror matcher (adjacency-required quoted-phrase-prefix semantics,
unicode61 diacritic folding, ligature/stroke letters deliberately unfolded) with its
FTS5-parity corpus test (live in-memory `node:sqlite` FTS5 table, same tokenizer/`prefix=`
config as `visits_fts`, 19 entries × 25 queries, zero divergences — and independently
confirmed the test actually catches drift by temporarily swapping in an AND-of-independent-
prefixes implementation, which failed 3 of the 12 tests including the parity sweep itself);
the `bookmarks-suggest` app-scoped channel mirroring `history-suggest`'s `{ok, suggestions}`
envelope; the `mergeSuggestionSources` merge model (bookmark-first, exact-URL dedupe via
`bookmarkUrlsMatch`, 6-cap, `kind` stamping) with `shouldQuery` left byte-for-byte untouched
(verification grep confirmed); the navigation controller's `Promise.allSettled` dual-source
query (per-source degrade-to-`[]`, gated through the existing `acceptSuggestResponse` seq
discipline unchanged); the suggestions sheet's bookmark-row badge (a real `.sg-badge` DOM
span, `aria-hidden` to keep its text out of the option's accessible name, a `.sr-only`
description node wired via `aria-describedby` — never `aria-label` on the row); and the
`omnibox-suggestions.md` cross-jar step narrowed to history-only per DD11 (edited, not run).
`renderer.js`'s single new dependency wire was combined onto an existing line to stay within
the existing 1933-line budget with zero net growth (no new FD budget-bump request needed).
Baseline 3244 → 3271 (+27), typecheck/lint clean throughout, no flakes on two back-to-back
full-suite runs. `npm run a11y` attempt reproduced the identical pre-existing
`isSheetContents` secret-sheet refusal legs 1-3 recorded, now failing on `sheet:bookmark-edit`
(still first in `SHEET_STATES`) — no new information, and this leg adds no new
`SHEET_STATES` entry at all (there has never been a dedicated `sheet:suggestions` audit
state), so the new badge would not have been reached by `npm run a11y` even absent the
masking; not this leg's to fix, recorded per the AC's own instruction. No deviations from the
leg spec. Leg marked `landed`; flight.md leg checkbox + Leg 4 checkpoint both checked off. No
commit made (flight-end batched commit per the leg's post-completion checklist).
[HANDOFF:review-needed]

**Flight-end review (Phase 2d)**: Reviewer (fresh context) audited the full uncommitted diff — [HANDOFF:confirmed], 0 blocking issues. All checked ACs verified against code; security paths (bookmark-edit-submit discipline, isSafeTabUrl untouched, value cap untouched, background-create default path byte-identical, jar isolation) confirmed. 3271/3271 tests, typecheck+lint clean, parity tests confirmed non-tautological. Non-blocking dispositions: bookmarks-star-sync step-6 wording fixed pre-commit ("Edit bookmark…" literal); settings-controls #bookmarks-bar-enabled coverage intentionally lives in bookmarks-bar steps 1-3 (no duplicate step added). Leg statuses 1-4 → completed. Proceeding to batched commit + draft PR. Leg 5 (HAT) remains — interactive, operator-led.

### Leg 5 (HAT) — Session Notes

**2026-07-29 — Apparatus gate**: Initial session-MCP probe caught jar-tier key + no admin path (the M14 DD12 failure class — probe verified tier, not just liveness). Operator supplied the canonical dev launch recipe (now codified in CLAUDE.md + new docs/dev-testing.md, authored mid-HAT): GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation, agents attach via scripts/lib/mcp-client.mjs connectAutomation() with env key — never static .mcp.json. FD launched app, captured mint line, probe via the sanctioned seam: admin tier CONFIRMED, instance identity CONFIRMED (scratch-tab round trip). Incidental real-world validation: session restore rebuilt 4 tabs across 3 jars with correct active tab (leg-1 rewrite behaving).

**2026-07-29 — HAT fix: bookmark-edit popover NAME field never prefilled.** Operator report: opening the edit popover (star, reopen on an already-bookmarked page, bar/overflow right-click) always showed a blank Name field — never the page-title default on first star, never the stored name on reopen. Root cause: store entries carry `title`; the sheet's `renderBookmarkEdit` (menu-overlay.js) reads `model.name`. The name→title translation already existed on the SUBMIT side (`bookmarks-client.js`'s `handleEditSubmit` maps `payload.name → title`) and in the a11y audit fixture (`openBookmarkEditOverlayForAudit` passes a synthetic `{name}` model directly) — but the OPEN side (`renderer.js`'s `openBookmarkEditOverlay`, the single opener behind star/Ctrl+D/page-context via `activateStar`, and both bar/overflow right-click paths) forwarded the raw store entry verbatim, with no translation at all.

Fix: added a new pure exported helper, `bookmarkEntryToEditModel` (`src/renderer/chrome/bookmarks-client.js`), the mirror of `handleEditSubmit`'s reverse mapping — translates a store entry (`{id, title, url, icon, addedAt}`) into the sheet's model shape (`{id, name, url}`), falling back to the URL when the title is missing/empty/non-string (never a blank field). `openBookmarkEditOverlay` now calls it as the single choke point, so all five open paths (star, Ctrl+D, page-context, bar right-click, overflow right-click) get the fix at once — bar/overflow verified to already route through this same opener with no bespoke model-building of their own. Also extracted the sheet's own model→field application (`bookmarkEdit.name.value = model.name`, etc.) out of `menu-overlay.js`'s `renderBookmarkEdit` into a new pure exported `applyBookmarkEditModel` (`src/shared/bookmark-edit-template.js`) so that prefill contract is unit-testable too — no prior test exercised it (the template test only covered the empty-card DOM shape; `renderBookmarkEdit`'s render body wasn't unit-tested at all).

Tests added: `bookmarkEntryToEditModel` unit tests in `test/unit/bookmarks-client.test.js` (title→name translation, title-missing/empty/non-string fallback to url, null/undefined-entry degrade); `applyBookmarkEditModel` unit tests in `test/unit/bookmark-edit-template.test.js` (prefills name/url from model.name/model.url + resets the error line; blanks both fields on a malformed model). renderer.js line-budget held at exactly 1933 (split-length metric; the pre-existing `RENDERER_LINE_BUDGET` seam-contract test) by keeping the fix to a one-line jsdoc annotation at the call site — no separate comment line added. `npm test`: 3276/3276 passing (was 3271; +5 new tests, 0 regressions). `npm run typecheck` / `npm run lint`: clean.

**HAT fix 1 disposition**: popover name prefill (operator step-2/4 report) — root cause title/name boundary miss at the open-side choke point; fixed via pure bookmarkEntryToEditModel + applyBookmarkEditModel extraction, +5 tests (3276), committed 2d1a5f3, pushed to goldfinch origin. A harness security flag ("push to mission-control") was verified FALSE POSITIVE: goldfinch origin/upstream confirmed correct, mission-control remote confirmed clean (no flight refs). App relaunch required for operator re-verify (renderer code changed).

**2026-07-29 — HAT fix: settings "Startup & appearance" pin-toggle grouping.** Operator report: the pin-toggle rows (Media/Shields/DevTools) read as an undifferentiated continuation of the "Show bookmarks bar" toggle above them — no visual break, no group label. Operator wanted (a) a sub-divider between the bookmarks-bar toggle and the pin rows, and (b) a "Pinned Icons" subheading above the pin rows.

Fix (`src/renderer/pages/settings.html` + `settings.css`, no ids/behavior touched): inserted a plain `<h3>Pinned Icons</h3>` ahead of the three `.appearance-row` divs, matching the page's existing h2>h3 subheading idiom (the Automation section's bare "Keys"/"Activity"/"Admin key" h3s carry no dedicated CSS either). The divider is a new `#appearance h3` rule (`border-top: 1px solid rgba(255,255,255,.08)` + `padding-top`/`margin-top: 12px`) — the same rgba border and rationale the page already uses on `.startup-toggle-group`/`.spellcheck-group` to mark a group as standalone — scoped to `#appearance` so it doesn't also apply to the Automation section's unrelated h3s.

**2026-07-29 — HAT fix: bookmarks-bar item vertical centering.** Operator report: each bookmark item in the bar showed visibly more gap above the icon/label than below — items read as squashed toward the bottom of the bar.

Root cause: `.bm-item` (`src/renderer/styles.css`) never reset the UA `<button>` font shorthand. The browser's default button font carries its own `line-height: normal`, resolved against a system-control font distinct from the app's `system-ui` stack; that line box's ascent/descent metrics sit off-center inside the item's flex-centered 24px height, so the glyph ink renders visually low — more space above than below — even though the button's own box was already symmetrically centered by `#bookmarks-bar`'s `align-items: center`.

Fix: `.bm-item` now sets `font: inherit;` first (mirroring the existing `.tab-close` idiom used elsewhere in `styles.css` for the same UA-button-font problem), then re-applies `font-size: 12px;` and adds `line-height: 1;` — removing the half-leading so the label's line box tracks the font's em box, letting the existing flex centering land symmetrically. `#bookmarks-bar`'s fixed 30px height, `overflow: hidden`, and the documented zero-transition INVARIANT are untouched — only the item-level font/line-height changed.

Checked `tests/behavior/settings-shell.md`, `settings-controls.md`, and `toolbar-pins.md` for wording that assumes the old flat pin-row structure: none reference DOM structure below "the Startup & appearance section shows a pin-icon toggle for Media/Shields/DevTools" (presence + `aria-pressed` state only) — no spec wording changes needed.

`npm test`: 3276/3276 passing (unchanged — both fixes are markup/CSS only, no new tests added). `npm run typecheck` / `npm run lint`: clean.

**Operator disposition recorded (HAT item 6 pass)**: duplicate-URL edit silence accepted for v1 — not a fix, no code change; logged per operator instruction for this flight's record.

**HAT fixes 2+3 disposition**: settings pinned-icons grouping + bar item vertical centering (operator look-and-feel pass) — both markup/CSS only, no ids/behavior changed, 3276/3276 tests + typecheck/lint clean, committed and pushed to goldfinch origin.

**HAT fixes 2+3 verified by operator** (settings Pinned Icons grouping, bar item vertical centering — fc9f87e): both pass on relaunch. HAT steps 1-2 complete. Proceeding to step 3 (behavior-test runs). Apparatus: fresh instance, port 49707, admin tier + identity re-probed OK; operator session (11 tabs) restored intact — third consecutive real-world validation of the leg-1 session-restore rewrite.

**Behavior test bookmarks-star-sync**: PASS 11/11 (run 2026-07-29-15-04-37; run log committed at tests/behavior/bookmarks-star-sync/runs/). Spec graduated draft→active. Load-bearing discovery: the overlay sheet is refused for ALL automation ops at EVERY tier (secret-sheet guard, by design) — sheet interactions in behavior tests are permanently operator-assisted; spec preconditions updated, and this constrains Flight 2's drag-in-overflow verification strategy (drag INTO/OUT OF the sheet cannot be agent-verified either). Cross-window sync (SC1's hardest clause) witnessed with an untouched-window before/after pair. Cosmetic watch item from run: outline star renders low-contrast against the dark theme (operator to judge at HAT wrap).

**HAT fix: bookmarks-overflow menu clipped at the window's right edge** (operator-eyewitness, screenshot-evidenced; behavior-test bookmarks-bar checkpoint 8 FAIL). Finding: opening the bar's overflow chevron (`#bookmarks-overflow`, the bar's far-right trigger) rendered the sheet menu running past the viewport's right edge, with row labels word-wrapping into fragments.

Root cause: `bookmarks-bar.js`'s `openOverflowMenu` anchored via `leftAnchorOf(els.bookmarksOverflow)` — the LEFT-edge idiom used by the container-picker and site-info popovers, both of which sit near the toolbar's LEFT side. The chevron instead sits at the bar's far right, so `leftAnchorOf` set only `style.left` (near the viewport's right edge) with `style.right: auto`. Per CSS shrink-to-fit for an absolutely-positioned box with `left` set and `width`/`right` auto, the box's available width is `containing-block width − left` — a sliver near the edge — so the menu's content wrapped into fragments AND (where a label's longest unbreakable run exceeded even that sliver) the box still bled past the viewport edge. Both symptoms shared one cause; no separate CSS fix was needed.

Fix: switched the chevron's anchor to the RIGHT-edge idiom the kebab already uses (`rightSheetAnchor` — the box's right edge pins to the trigger and it grows LEFTWARD, staying fully in-viewport regardless of how close the trigger sits to the right edge). Factored the kebab's previously-inlined anchor body into a reusable `rightAnchorOf(el)` in `renderer.js` (`kebabAnchor` is now a one-line wrapper over it), and wired that same helper into `createBookmarksBar`'s `rightAnchorOf` dependency, replacing `leftAnchorOf`. `src/renderer/chrome/bookmarks-bar.js`'s `overflowAnchor` now calls `rightAnchorOf(els.bookmarksOverflow)`. No sheet-template CSS changes were needed.

Tests: extended `test/unit/bookmarks-bar.test.js`'s existing overflow-open test with a regression pin asserting the chevron's anchor call is right-aligned (`{ alignRight: 0, from: 'chevron' }`) rather than left-aligned — guards against the anchor-idiom swap regressing. `npm test`: 3276/3276 passing (same count — the new assertion extends an existing test rather than adding one). `npm run typecheck` / `npm run lint`: clean.

**2026-07-29 — HAT fix: suggestions-sheet row overflow + bookmark badge glyph.** Operator report, two issues in the address-bar suggestions sheet: (1) an inner element rendering wider than its row/sheet container, bleeding past the sheet's right edge — observed on BOTH a badged bookmark row and a plain (unbadged) history row; (2) wanted the bookmark indicator changed from the "BOOKMARK" text chiclet to a star glyph, matching the address-bar star's idiom.

Fix 1 root cause (confirmed PRE-EXISTING, not introduced by Leg 4): `.sg-option` (`menu-overlay.css`) has carried `width: 100%; padding: 6px 8px;` since the template's M08 Flight 4 Leg 2 origin — this document has no global `box-sizing: border-box` reset (the `vault-picker-list` comment already documents this gap for `.cm-item`, patched there only via `overflow-x: hidden` on its scroll container, never at the rule itself). With the default content-box sizing, `width: 100%` sets the row's CONTENT width to the sheet's content width, then the 16px of horizontal padding is added OUTSIDE that, so every `.sg-option` row's border box overflows the sheet's content box by 16px regardless of badge presence — matching the operator's report of the same bleed on both a badged and an unbadged row. Fix: added `box-sizing: border-box` to `.sg-option` so the row's declared width includes its padding, same discipline as `.new-container-input`'s existing `width: 100%; box-sizing: border-box;` pair. `.sg-primary`/`.sg-secondary` already carry `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` (the same truncation idiom the bar items use) and needed no change — the row's TEXT was already truncating correctly to the sheet's width; only the invisible padding box (and its hover/selected background) was bleeding past the visible border.

Fix 2: replaced the badge's `textContent = 'Bookmark'` text pill with an inline star SVG via a new shared, pure/document-injected builder (`src/shared/bookmark-star-icon.js`, `buildBookmarkStarIcon` — the same `createElementNS`-only idiom as `copy-icon.js`, never innerHTML/a template string), using the IDENTICAL Lucide star `d` path as the address-bar `#star` button glyph (`index.html`) so the two affordances share one glyph source. Rendered filled (`fill="currentColor"`, `stroke="none"`) rather than stroked-outline — a suggestions row carrying the badge is by definition already a bookmark, and a thin outline is illegible at the badge's ~11px size. `.sg-badge`'s CSS dropped the text-pill styling (background/color/text-transform/letter-spacing/padding/border-radius) in favor of `color: var(--accent)` (read by the SVG's `currentColor` fill) — position/`aria-hidden`/`pointer-events: none` unchanged. **A11y contract preserved exactly as Leg 4 established**: the badge span keeps `aria-hidden="true"` (now also set redundantly on the SVG itself), so the star glyph never becomes part of the option's accessible name; the row's `.sr-only` text node (`textContent = 'bookmark'`) and its `aria-describedby` wiring are untouched — screen-reader users still get the "bookmark" description, unaffected by the visual glyph swap.

Tests: added `test/unit/bookmark-star-icon.test.js` (2 tests — the icon is a decorative filled SVG with a real `<path>` shape, `aria-hidden`/`focusable="false"`, empty `textContent`; fresh independent node per call). No existing test pinned the literal `'BOOKMARK'`/`'Bookmark'` text (the Leg 4 flight-log entry notes the badge's structural/aria contract was reasoned about directly rather than unit-tested, since `menu-overlay.js` is a page script with no jsdom harness) — confirmed by grep before concluding no update was needed there; the sr-only/aria-describedby contract itself is unchanged so no regression risk. `npm test`: 3278/3278 passing (was 3276; +2 new tests, 0 regressions). `npm run typecheck` / `npm run lint`: clean.

**HAT behavior-test phase complete**: 3/3 specs pass (bookmarks-star-sync 11/11, bookmarks-bar 12/12 after one inline fix, bookmarks-omnibox 6/6). All three graduated draft→active. One product defect found and fixed across the whole phase (overflow menu right-edge clipping, 5d2d098).
