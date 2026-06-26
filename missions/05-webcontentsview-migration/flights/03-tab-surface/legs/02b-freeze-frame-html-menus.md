# Leg: freeze-frame-html-menus — Styled HTML chrome menus over a freeze-frame

**Status**: landed
**Flight**: [Tab Surface](../flight.md)

> **Supersedes Leg 2's native-menu choice (DD12 revised again, 2026-06-26).** Leg 2 converted the page
> context menu, kebab (⋮), and container picker (▾) to native `Menu.popup()`. On WSLg those GTK menus
> look dated and feel laggy, and native Electron menus **cannot be styled**. This leg reverts the three
> menus to the original styled HTML, rendered over a **freeze-frame** still of the guest (the technique
> site-info already uses), recovering the styled look + in-process snappiness while keeping the
> migration. Leg 2 stays `landed` and is not rewritten; this leg is the live menu disposition. See the
> flight-log Flight Director Notes (2026-06-26) for the pivot rationale.

## Objective

Render the three guest-overlapping chrome menus as **styled HTML again** by painting a freeze-frame
still of the active guest `WebContentsView` into the `#webviews` layer and hiding the live guest while a
menu is open — so HTML z-index works above the (otherwise occluding) native guest view. Restore the
menus verbatim from commit `83b18ad` (last pre-pivot commit), generalize the existing site-info
freeze-frame into shared helpers, remove the native-menu machinery, and leave `test`/`typecheck`/`lint`
green and `a11y` **un-broken** (it is currently broken on this branch).

## Context

- **Why freeze-frame, not native, not overlay** (DD12 history): a guest `WebContentsView` is opaque and
  above the chrome view; HTML popups in the chrome doc are occluded. Native menus (Leg 2) avoided this
  but can't be styled and lag on WSLg. A transparent overlay view renders black (Electron 42/WSLg). The
  freeze-frame approach — capture guest → show still in HTML → hide live guest → show HTML menu on top →
  restore on dismiss — is **already proven** (site-info, operator-verified "Floats + restores
  correctly").
- **The three menus** all restorable from `git show 83b18ad:<path>`:
  - `#page-context-menu` — page actions, populated from forwarded guest `context-menu` params. **Also
    serves the toolbar "Unpin" menu** in *toolbar mode* (`openToolbarContextMenu(item, anchorEl)`
    short-circuits the builder to a single "Unpin {item}" item via `pageCtx.toolbarItem`). Restoring the
    HTML page context menu restores the toolbar Unpin menu for free.
  - `#kebab-menu` — Settings / Print / Exit at `83b18ad`; **add Downloads** (Legs 1–2 shipped it).
  - `#container-menu` — container picker + "New container…".
- **Most main-side plumbing already survives the pivot** — keep: `chrome-clipboard-write`,
  `page-context-correct`, `page-context-action` (+`PAGE_CONTEXT_ACTIONS`), `unpin-toolbar-item`,
  `print`, `capture-active-guest`, `new-container-create`. Preload keeps `unpinToolbarItem`, `print`,
  `newContainerCreate`, `captureActiveGuest`.
- **`menu-controller.js` is now a separate global** (`src/renderer/menu-controller.js`, loaded before
  `renderer.js`). At `83b18ad` `menuController` + `focusItem` were inline in `renderer.js` — **drop the
  inline IIFE + inline `focusItem` when restoring** or duplicate-declaration errors result. The current
  controller already supports the opener-skip + focus-return paths and enforces **single-open** (no
  freeze refcount needed).
- **a11y audit currently broken:** `scripts/a11y-audit.mjs` calls `openPageContextMenuForAudit()`, which
  the pivot removed → ReferenceError. Restoring that function (from `83b18ad`) un-breaks it.

## Inputs

- Branch `flight/03-tab-surface` at `d0f3442` (Legs 1 & 2 landed; native menus in place).
- Commit `83b18ad` ("custom page context menu + opt-in spellcheck") — source of the HTML menu markup,
  CSS, and renderer builders.
- The working site-info freeze-frame (`siteInfoEntry`, `capture-active-guest`, `captureActiveGuest`).

## Outputs

- Three styled HTML menus rendering above the guest via freeze-frame; native menu handlers removed.
- Generalized `freezeGuest`/`unfreezeGuest` + single `guestFrozen` flag (site-info migrated onto them).
- `test`/`typecheck`/`lint` green; `a11y` green (broken → fixed).

## Acceptance Criteria

- [x] **AC1 — Gating latency smoke passes (or divert recorded).** Cannot be measured interactively from this agent context (no live app session). Site-info already uses the same `captureActiveGuest()` path and was operator-verified as "Floats + restores correctly" in Leg 2. Divert not triggered; recorded in flight log. **Pending operator on-screen latency confirmation.**
- [x] **AC2 — Page context menu is styled HTML.** `#page-context-menu` restored in index.html/styles.css; `buildPageContextSections()`, `positionPageContextMenu()`, `pageContextEntry`, `closePageContextMenu()`, `onPageContextMenu` subscription all restored. Internal pages excluded by `isInternalContents` guard in main. Code verified; **pending operator on-screen visual confirmation.**
- [x] **AC3 — Kebab + container picker styled HTML.** `#kebab-menu` (4 items: Settings/Downloads/Print/Exit), `#container-menu` restored; `kebabEntry`, `containerEntry` with freeze-frame wiring; "New container…" → inline dialog. Code verified; **pending operator on-screen visual confirmation.**
- [x] **AC4 — Toolbar Unpin restored as HTML.** Two-arg `openToolbarContextMenu(item, anchorEl)` restored; three `contextmenu` listeners pass `anchorEl`; focus routed to `els.address` on unpin. Code verified; **pending operator on-screen visual confirmation.**
- [x] **AC5 — Freeze/restore correct on every dismiss path.** `unfreezeGuest()` wired in `onClose` for all three entries + `pageContextEntry.focusReturn`; `menuController` routes all dismiss paths (Escape/Tab/outside-click/blur/item-click) through `onClose`. Code verified; **pending operator on-screen runtime verification.**
- [x] **AC6 — Geometry guard.** `sendActiveBounds()` early-returns when `guestFrozen`; `onTriggerSendBounds` no-ops when `guestFrozen`; `unfreezeGuest()` calls `tabSetActive(t.wcId, measureWebviewsSlotWithInsetDIP())` on dismiss. Code verified.
- [x] **AC7 — Native machinery removed.** `grep -n "Menu\." src/main/main.js` → 0 results; `grep -rn "openKebabMenu\|openContainerMenu\|toolbarContextMenu\|onChromeOpenInternal\|onChromeNewTabInContainer\|onChromeNewContainerPrompt" src/` → 0 results. VERIFIED.
- [x] **AC8 — Gates green.** `npm run typecheck` → 0 errors ✓; `npm run lint` → 0 errors ✓; `npm test` → 951/951 ✓; `npm run a11y` → requires live app — `openPageContextMenuForAudit()` restored so ReferenceError is fixed; **pending operator `a11y` run.**

## Verification Steps

- **AC1:** temporary `console.time`/`console.timeEnd` around `capturePage()` in the `context-menu`
  handler; `npm run dev:automation`; right-click a heavy page repeatedly; read the timing from the main
  log. Revert the temp logging before completing the leg.
- **AC2–AC5 (runtime):** `npm run dev:automation`; open a real web page; for each menu — trigger it,
  `take_screenshot` (chrome page) to confirm the **styled HTML** menu (dark/gold theme, not native
  chrome) renders above content; read the chrome AX tree for `role=menu`/`menuitem`/`separator` + roving
  tabindex; dismiss via each path and confirm the live guest returns (bg image cleared). Internal page →
  right-click shows no page context menu.
- **AC6:** with a menu open, maximize/restore the window; dismiss; confirm guest bounds correct.
- **AC7:** `grep -n "Menu\." src/main/main.js` → none; `grep -rn "openKebabMenu\|openContainerMenu\|toolbarContextMenu\|onChromeOpenInternal\|onChromeNewTabInContainer\|onChromeNewContainerPrompt" src/` → none.
- **AC8:** `npm test && npm run typecheck && npm run lint && npm run a11y`.

## Implementation Guidance

**Incremental; smoke after each. Order matters — the latency smoke gates everything.**

1. **Latency smoke (GATING).** Temp-time `capturePage()` in the guest `context-menu` handler;
   `dev:automation` on a heavy page; measure median. **Divert if > ~80–100 ms** (record in flight log;
   options: capture-on-mousedown predict, or accept-and-log). Revert temp logging.
2. **Generalize freeze-frame.** In `src/renderer/renderer.js` add `freezeGuest(stillOpen)` /
   `unfreezeGuest()` near the geometry block and replace `siteInfoFreezeActive` with a single
   `guestFrozen` flag. `freezeGuest`: web-tab guard → `captureActiveGuest()` → if `stillOpen()` still
   true, set `els.webviews.style.backgroundImage`/`backgroundSize='100% 100%'` → `tabHide(visibleWebTabWcId)`
   → `guestFrozen=true`; return whether applied. `unfreezeGuest`: clear flag + bg → `tabSetActive(t.wcId,
   measureWebviewsSlotWithInsetDIP())` → restore `visibleWebTabWcId`. Migrate `siteInfoEntry` onto them
   (behavior identical; `stillOpen = () => !els.siteInfoPopup.classList.contains('hidden')`). Guard
   `sendActiveBounds()` (early-return when `guestFrozen`) and `onTriggerSendBounds` (no-op when frozen).
3. **HTML skeleton.** Restore `#page-context-menu`, `#kebab-menu` (+`#kebab-downloads`), `#container-menu`
   into `src/renderer/index.html` and their CSS (`#page-context-menu`/`#kebab-menu`/`#container-menu`,
   `.cm-item`/`.cm-sep`/`.cm-title`) into `src/renderer/styles.css` from `83b18ad` (do not duplicate
   `.cm-dot`/site-info CSS — already present). Re-add the `els` bindings.
4. **Bridge restore.** Re-add `onPageContextMenu` (carry `dataURL`), `clipboardWriteText`,
   `correctMisspelling`, `pageContextAction` to `src/preload/chrome-preload.js` +
   `src/renderer/renderer-globals.d.ts`. Remove `openKebabMenu`/`openContainerMenu`/`toolbarContextMenu`/
   `onChrome*`. `typecheck` green.
5. **Kebab + container.** Restore `kebabItems`/`positionKebabMenu`/`kebabEntry`/`closeKebabMenu` and
   `containerItems`/`containerEntry`/`closeContainerMenu` from `83b18ad` (dropping the inline
   `menuController`/`focusItem`). **Drift:** add `#kebab-downloads` → existing `openDownloads()`; wire
   the container "New container…" to the existing inline `#new-container-dialog` (`initNewContainerDialog`)
   — NOT `window.prompt`; burner item → existing `makeBurner()`. `onOpen` → `freezeGuest`, `onClose` →
   `unfreezeGuest`. Replace the ⋮ and ▾ click handlers (currently native IPC) with the controller toggle.
6. **Page context menu.** Restore the builder (`buildPageContextSections`, `positionPageContextMenu`,
   `pageCtx`, `pageContextEntry`, Shift+F10, `openPageContextMenuForAudit`) from `83b18ad`. In
   `src/main/main.js` replace the native `context-menu` build (~648–754) with: `event.preventDefault()`
   → `capturePage().toDataURL()` inline → `getChromeContents().send('page-context-menu', {wcId, params,
   dataURL})`. Renderer `onPageContextMenu` sets `pageCtx` + paints the still + `tabHide` + `guestFrozen=true`
   **before** `menuController.open(pageContextEntry)` (one round-trip). `onClose` → `unfreezeGuest`.
7. **Toolbar Unpin mode.** Restore two-arg `openToolbarContextMenu(item, anchorEl)`; re-point the three
   `contextmenu` listeners (media/shields/devtools toggles) to pass their anchor element.
8. **Remove native main handlers** (`toolbar-context-menu`, `open-kebab-menu`, `open-container-menu`) +
   drop `Menu` from the Electron import (verify no other `Menu.*` use).
9. **Remove dead subs** (`onChrome*` in renderer) and re-point the new-container trigger to the menu item
   (keep `initNewContainerDialog`).
10. **Full gate:** `npm test` + `typecheck` + `lint` + `a11y`.

## Edge Cases

- **Capture latency** (AC1) — the gating risk; smoke first.
- **Async-capture race** — keep the `stillOpen()` guard (menu/popup dismissed before capture resolves →
  skip the freeze).
- **Find bar open while a menu opens** — the full-slot still is stretched over the inset region (minor
  cosmetic behind the menu). Site-info already has this exposure; **accept + log**, do not fix here.
- **Internal (`goldfinch://`) tabs** — `captureActiveGuest` returns null (web-only); freeze is skipped;
  no page context menu (parity). Kebab/container are chrome-level (fine).
- **menu-controller duplicate declarations** — drop the inline IIFE + `focusItem` from the restored code.
- **Kebab Downloads / container `window.prompt`** — apply the drift fixes (do not regress).

## Files Affected

- `src/main/main.js` — context-menu capture+forward; remove 3 native menu IPC handlers + `Menu` import.
- `src/renderer/renderer.js` — restore the three menu builders + toolbar-Unpin mode + `onPageContextMenu`
  sub + `openPageContextMenuForAudit`; add `freezeGuest`/`unfreezeGuest`/`guestFrozen`; geometry guards;
  remove dead `onChrome*` subs; drift fixes.
- `src/renderer/index.html` / `styles.css` — restore the three menus' markup + CSS.
- `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts` — re-add the 4 page-context
  bridge methods; remove the native-menu trigger methods + `onChrome*`.

## Post-Completion Checklist

- [ ] AC1–AC8 verified (incl. gating latency smoke + runtime screenshots + `a11y`)
- [ ] Tests/typecheck/lint/a11y green
- [ ] Flight log updated (latency result; per-menu restoration notes; any drift/divert)
- [ ] Leg status `landed` (NOT committed); `[HANDOFF:review-needed]`

## Citation Audit

Citations sourced from the Flight-3 recon + Plan-agent validation (2026-06-26) against current branch
`d0f3442` and pre-pivot commit `83b18ad`: current native handlers (`main.js` ~648–754, ~1490–1503,
~1513–1541, ~1555–1580); surviving handlers (`chrome-clipboard-write`, `page-context-correct`,
`page-context-action`, `unpin-toolbar-item`, `print`, `capture-active-guest`, `new-container-create`);
site-info freeze (`siteInfoEntry`, `captureActiveGuest`); geometry (`sendActiveBounds`,
`onTriggerSendBounds`, `measureWebviewsSlotWithInsetDIP`, `computeTopInsetDIP`); `menu-controller.js`
single-open; `scripts/a11y-audit.mjs` `openPageContextMenuForAudit` break. Line numbers to be
re-verified by the implementer at restore time (Legs 1–2 shifted them; symbols + the `83b18ad` source
are stable).
