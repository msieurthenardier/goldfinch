# Leg: bar-settings-and-overflow

**Status**: completed
**Flight**: [Bookmarking Core and Surfaces](../flight.md)

## Objective

Ship the bookmarks bar end-to-end: the merged startup-and-appearance Settings section with the off-by-default bar toggle, Ctrl+Shift+B, the bar itself (icons/monograms, tooltips, click navigate, middle/Ctrl+click background open, instant guest reflow), the `bookmarks-overflow` sheet with index dispatch and the sheet's first per-row context menu, and edit/remove reuse of the leg-2 popover from bar and overflow.

## Context

- Governing DDs: DD7 (settings merge + toggle), DD8 (bar layout/interaction), DD9 (overflow surface — proceeds on click contract; the drag spike returned `needs-operator-manual-test` on both axes, so there is NO positive drag evidence and none is required this flight), DD10 (background open — `createTab` option landed leg 1), DD2/DD4/DD6 consumed via `bookmarks-client.js`.
- Leg-2 ground truth: `createBookmarksClient` exposes `findByUrl`, `activateStar`, `handleEditSubmit`, `boot`, `get list()`; popover opens via `openBookmarkEditOverlay(bookmark)` with the anchor **hardcoded to `els.star`** — this leg parameterizes the anchor (small refactor of leg-2 code, update its tests); the sheet model field is `name`, the store field is `title` — translate at the boundary. `toggle-bookmarks-bar` dispatch stub exists (`shortcut-controller.js` — replace the body); classifier/forwarding fully landed leg 1.
- **FD ruling — line budget**: second minimal `RENDERER_LINE_BUDGET` bump authorized (1866 → as-needed, rationale comment), conditional on bar/overflow logic living in a new `src/renderer/chrome/bookmarks-bar.js` module (the `bookmarks-client.js` precedent).
- **FD ruling — seam growth**: one further evaluate-seam entry authorized for the overflow sheet's audit hook (`openBookmarksOverflowOverlayForAudit`, 32 → 33), same every-new-sheet-state precedent; seam-contract count + CLAUDE.md dual-source note updated together, `SHEET_STATES` row added (no `SHEET_NODE_IDS`/`NODE_OF_ENTRY` — menu family shares the template node; see the audit-seam AC, which is authoritative).
- Settings mutation precedent: chrome-initiated settings writes use a dedicated main-side channel that flips state and broadcasts itself (`unpin-toolbar-item` precedent; CLAUDE.md rule — any handler mutating settings directly must broadcast `settings-changed` itself).

## Inputs

- Legs 1-2 landed uncommitted: store/IPC spine, `bookmarks-client.js`, `bookmark-edit` sheet, five-path star sync, `background: true` createTab option, `toggle-bookmarks-bar` classifier + stub

## Outputs

- New: `src/renderer/chrome/bookmarks-bar.js` (+ pure model helpers unit-testable where extractable), `#bookmarks-bar` markup/CSS, `bookmarks-overflow` sheet menuType, `toggle-bookmarks-bar` main-side IPC, `bookmarksBarEnabled` setting + Settings UI
- Modified: `settings.html`/`settings.js` (section merge + toggle), `settings-store.js`, `window-controller.js`, `index.html`, `styles.css`, `menu-overlay.js` (+`MENU_LABELS`), `renderer.js`, `overlay-menus.js`, `shortcut-controller.js`, `register-settings-ipc.js` (or sibling registrar), `chrome-preload.js`, `renderer-globals.d.ts`, `scripts/a11y-audit.mjs`, `test/unit/seam-contract.test.js`, CLAUDE.md
- Spec updates: `tests/behavior/settings-shell.md` (5→4 links/sections, id list), `tests/behavior/settings-controls.md` (section-name wording), `tests/behavior/toolbar-pins.md` (~16 prose references "Appearance" → merged section name)

## Acceptance Criteria

- [x] **Settings merge**: `#startup`'s content (home-page input block, restore-session fieldset) moves into `<section id="appearance">`, whose `<h2>` becomes **"Startup & appearance"**; the `#startup` section and its nav `<li>` are removed; nav link text updated. The scroll-spy needs no JS change (generic `main section[id]` selector — verified). All element ids inside the moved content are unchanged (settings.js selects by element id only) — **but `settings.css:270` selects `#startup label[for="home-page-input"]` (design-review catch): re-scope that rule (to `#appearance …` or a class) or the home-page label silently loses its styling.**
- [x] **`bookmarksBarEnabled` setting**: `settings-store.js` DEFAULTS gains `bookmarksBarEnabled: false` beside `restoreSession`, strict boolean validator (`(v) => typeof v === 'boolean'` — the restoreSession template, NOT the typeof-fallback), `Settings` typedef updated; no version bump (additive-key rule per DEFAULTS' own comment); no normalizer.
- [x] **Settings toggle UI**: checkbox `#bookmarks-bar-enabled` in the merged section, cloned from the restore-session IIFE idiom byte-for-byte in shape (guard, `.checked` direct assignment with the no-echo-loop comment, `change` → `settingsSet`, `onSettingsChanged` re-sync, `pagehide` teardown).
- [x] **Bar markup + instant reflow**: `#bookmarks-bar` inserted between `#toolbar` and `#main` (body-level flex column — a fixed-height row shrinks `#main` with no other CSS change); hidden via class toggle; **zero transition properties**, carrying the 16-line "INSTANTLY — no transition" INVARIANT comment block (media/privacy-panel precedent, cite M15 F1); `window-controller.js` gains `applyBookmarksBar(enabled)` mirroring `applyToolbarPins` (initial `settingsGet` read + `onSettingsChanged` live path — full-object broadcast means `all.bookmarksBarEnabled` is always present, and this is the multi-window sync mechanism); after each toggle the chrome calls `sendActiveBounds()` explicitly (panel precedent — belt-and-suspenders over the `#webviews` ResizeObserver).
- [x] **Ctrl+Shift+B + toggle channel**: new main-side channel (the `unpin-toolbar-item` shape: validate, flip `bookmarksBarEnabled`, broadcast `settings-changed` itself); `dispatchChromeAction`'s `toggle-bookmarks-bar` arm calls it; the Settings checkbox and the shortcut converge on the same stored value (no divergent state).
- [x] **Bar rendering** (in `bookmarks-bar.js`): renders from `bookmarksClient.list` in order; re-renders on the client's post-refresh signal — **extend the existing single `onChanged` closure inline at `renderer.js:104`** (decided: keep single-subscriber; the closure becomes `refreshStar + bar re-render + overflow stale-close`; an independent `onBookmarksChanged` subscription from bookmarks-bar.js is forbidden — it fires before the cache refresh resolves and would read stale `bookmarksClient.list`); each item a button with icon (`<img>` for stored `data:image/*` icons; letter-monogram tile fallback), label = title, native `title` tooltip `"{title}\n{url}"`; keyboard-operable (bar is a toolbar-pattern container: items focusable, arrow-key roving consistent with existing chrome toolbar behavior or documented simpler tab-order — decided by implementer within APG norms, noted in flight log).
- [x] **Bar activation**: left-click / Enter navigates the **current tab** to the bookmark URL via the same navigation path omnibox suggestion acceptance uses (untrusted gate preserved — never a `trusted` create); middle-click (`auxclick` button 1) and Ctrl+click open via **`createTab(url, null, { background: true })`** — three-arg form, options in the THIRD slot (design-review correction: the 2-arg form would land `{background:true}` in the `container` parameter, silently defeating background-open AND corrupting jar resolution; the landed leg-1 precedent is `renderer.js:1787 — createTab(t.url, container, { trusted: false, background: true })`); current tab stays foregrounded; right-click (`contextmenu`) opens the leg-2 popover anchored at the item (parameterized `openBookmarkEditOverlay(bookmark, anchorEl)` refactor with the anchor helper extracted pure and unit-tested; bookmark object captured at event time — TOCTOU).
- [x] **Overflow collapse**: when items exceed bar width, rightmost items collapse behind a chevron button (`#bookmarks-overflow`); measurement is a `ResizeObserver` on the bar + cumulative item-width walk (NEW pattern — no in-repo precedent; the tab strip is pure CSS). Re-entrancy guards: the bar's height is a **fixed literal** (pinned in CSS with a comment, like other fixed chrome dimensions) so overflow recomputation never changes `#webviews` height (no observer loop), and the callback skips re-measure when the observed border-box size is unchanged from the last pass (defends against ResizeObserver loop-limit warnings during rapid resizes — design-review suggestion adopted). Chevron hidden when everything fits.
- [x] **Overflow sheet**: menuType `bookmarks-overflow`, template family `menu`; `TEMPLATES` + JSDoc union + `MENU_LABELS` entry (a11y name — omission degrades the label to the raw menuType string) + overlay state entry (`fixedTriggerMenu(() => els.bookmarksOverflow)`); model rows `{id: 'bookmark:<i>', label: title}` built from a **snapshot captured at open**; standard APG sheet keyboard contract (roving menuitems, Escape). Chrome dispatch case: `bookmark:<i>` → navigate current tab to `snapshot[i].url` (index validated against snapshot bounds — VALIDATED-NO-OP); `bookmark-edit:<i>` → open the popover for `snapshot[i]` anchored at the chevron.
- [x] **Per-row context menu in the sheet** (first of its kind): in `renderMenu`'s button-creation site, gated to `menuType === 'bookmarks-overflow'` only, a `contextmenu` listener that `preventDefault()`s and sends `sendActivatedOnce({id: 'bookmark-edit:<i>'})` then closes — a second id family on channel 4 (id field is type-checked only, length-unbounded — verified); no new IPC channel; no listener leaks into other menuTypes.
- [x] **DD9 cache freshness**: if `bookmarks-changed` fires while the overflow sheet is open, the chrome closes it via `overlayMenuClient.close('superseded')` (valid close reason — verified); next open re-snapshots.
- [x] **Audit seam (FD ruling, corrected scope)**: `openBookmarksOverflowOverlayForAudit` seam entry (32→33, CLAUDE.md dual-source note in the same change) + a `SHEET_STATES` row only — **NO** `NODE_OF_ENTRY` or `SHEET_NODE_IDS` additions (menu-family menuTypes share the single `menuNode`/`sheet-menu` id like kebab/container/page-context/tab-context; design-review correction). **FD ruling — SHEET_STATES ordering**: place the two new bookmark states (`sheet:bookmark-edit`, `sheet:bookmarks-overflow`) BEFORE `sheet:kebab` in `SHEET_STATES`, with a comment, so the flight's new surfaces get real audit coverage instead of being masked by the pre-existing kebab refusal (which halts the run and is still not this leg's to fix). Attempt `npm run a11y`; record results.
- [x] **Behavior-spec updates**: `settings-shell.md` step rewritten (4 links / 4 sections, updated id+heading list); `settings-controls.md` section-name wording; `toolbar-pins.md` prose sweep ("Appearance" → "Startup & appearance", ~16 sites). Specs updated, NOT run (flight-verification/HAT runs them).
- [x] **Line budget (FD ruling)**: bar/overflow logic in `bookmarks-bar.js`; minimal renderer.js bump with rationale comment.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; count vs leg-2 close (3222) recorded (3222 → 3244, +22); new unit tests: settings-store `bookmarksBarEnabled` validation, overflow partition/model helpers (pure parts of `bookmarks-bar.js`), toggle-channel handler (Electron-free part), popover-anchor refactor regression.

## Verification Steps

- `npm test && npm run typecheck && npm run lint` — green, counts recorded
- `grep -n "transition" src/renderer/styles.css` around `#bookmarks-bar` — none on the bar; INVARIANT comment present
- `grep -n "bookmarks-overflow" src/renderer/menu-overlay.js` — TEMPLATES + MENU_LABELS entries present (no NODE_OF_ENTRY line — menu family shares menuNode)
- `grep -n "contextmenu" src/renderer/menu-overlay.js` — exactly one listener, gated to bookmarks-overflow
- `grep -n "sendActiveBounds" src/renderer/chrome/window-controller.js src/renderer/chrome/bookmarks-bar.js` — explicit call on toggle
- `grep -rn "5 links\|five links" tests/behavior/settings-shell.md` — none remain
- Manual/MCP smoke if launchable: toggle on → bar appears + guest reflows instantly; full validation at flight verification (`/behavior-test bookmarks-bar`)

## Edge Cases

- **Zero bookmarks, bar enabled**: bar renders empty (height preserved); no chevron. (Empty-state hint text is HAT-feedback territory, not specced.)
- **Bookmark added/removed while overflow computes**: re-render is idempotent from `bookmarksClient.list`; overflow recomputes on the same pass.
- **Window too narrow for even one item**: all items collapse; chevron alone remains.
- **Middle-click on overflow rows**: NOT in scope (sheet rows get click + right-click only this flight; middle-click semantics inside the sheet deferred — record if HAT requests it).
- **Toggle spam (rapid Ctrl+Shift+B)**: each write flips the stored value; broadcasts serialize; final state consistent — the explicit `sendActiveBounds()` per apply is rAF-coalesced downstream.
- **Corrupt icon in store**: store-level validation already normalizes to null (leg 1) → monogram path; bar never renders a non-`data:image` src.

## Files Affected

*(see Outputs)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (incl. overflow-measurement design notes, a11y result, keyboard-model decision)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (flight-end batched commit)

---

## Citation Audit

Verified same-day by code interrogation against the working tree (2026-07-28): settings.html nav/sections (`:20-28`, `#appearance :31-54`, `#startup :126-137`); settings.js scroll-spy generic selector (`:49-114`), restore-session checkbox idiom (`:279-302`); settings-store DEFAULTS/VALIDATORS (`:46-93`, `:120-179`), additive-key rule comment (`:52-56`), repairConfig (`:224-249`); window-controller `applyToolbarPins`/`onSettingsChanged` (`:81-99`); body flex layout (`styles.css:35-38`), `#main`/`#webviews` (`:665-673`), panel INVARIANT blocks (`:698-713`, `:1134-1149`); `measureWebviewsSlotDIP`/`sendActiveBounds` (`tab-controller.js:815-842`), `#webviews` ResizeObserver (`:929-931`); `renderMenu` row creation (`menu-overlay.js:177-249`, btn at `:209`), `MENU_LABELS` (`:136-141`); channel-4 id unbounded (`register-overlay-ipc.js:81`); close reasons incl. `superseded` (`register-overlay-ipc.js:7`); `bookmarks-client.js` API (`:25-96`); `openBookmarkEditOverlay` star-anchored (`renderer.js:614-618`); `toggle-bookmarks-bar` stub (`shortcut-controller.js:160-165`); `RENDERER_LINE_BUDGET`=1866 (renderer.js at 1865); behavior-spec impact points (`settings-shell.md:85`, `settings-controls.md:66,79`, `toolbar-pins.md` ~16 prose sites). Tab strip confirmed pure-CSS (no items-that-fit JS precedent — overflow measurement is new invention).

**Audit addendum (post design review)**: four citations added by review incorporation — `settings.css:270` (`#startup label` selector), `renderer.js:104` (single `onChanged` closure), `renderer.js:1787` (3-arg background createTab precedent), `tab-controller.js:256` (createTab signature) — verified by the design reviewer against the working tree, 2026-07-28.
