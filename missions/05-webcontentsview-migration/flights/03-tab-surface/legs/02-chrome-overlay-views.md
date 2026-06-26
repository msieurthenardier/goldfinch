# Leg: chrome-overlay-views — Native chrome popups (REVISED)

**Status**: landed
**Flight**: [Tab Surface](../flight.md)

> **Design history:** this leg first attempted a custom-HTML overlay `WebContentsView` to float the popups
> over the guest. That failed at runtime 3× (transparency→black; in-window overlay → not-showing +
> white-launch). Root cause: HTML chrome can't float over a native content view (CSS z-index can't cross
> views) — the same wall Chrome/Edge avoid by using native chrome + native menu widgets. **Revised to the
> native approach (DD12 revised; operator: "do it the right way / how Chrome does it").** The original
> overlay design is superseded; the implementer follows the native plan below.

## Objective

Make the transient chrome popups render above the opaque guest `WebContentsView`s **the platform-native
way**: replace the custom-HTML menus (page context menu, kebab, container picker) with native Electron
`Menu.popup()` (OS-composited above all views — zero occlusion, free keyboard/a11y), inset the guest from
the top for the find bar (page stays live), and give site-info a small popup/inset. Also fix the
context-menu coordinate alignment. Remove the failed overlay infrastructure (which also removes the
white-launch regression). Trade-off accepted: the menus become OS-styled (the Flight-2 custom-HTML menu look
is given up — operator-approved).

## Context

- **Why native** (flight DD12 revised): the guest is an opaque native view above the chrome view; custom-HTML
  popups in the chrome doc are occluded and can't be composited over a native sibling view (transparency →
  black; in-window overlay → fragile). Native `Menu.popup()` renders at the OS level above everything — the
  built-in, robust answer, and how Chrome's own right-click menu works.
- **Current popups to convert** (code interrogation, 2026-06-25):
  - Page context menu: today opened via the guest `context-menu` event → forwarded to the renderer as
    `page-context-menu` → custom HTML (`buildPageContextSections`). Sub-step-1 (overlay attempt) already
    removed the HTML element from `index.html`/renderer and moved build logic into `popup-host.js` (to be
    deleted). Native rebuild lives in **main** on the guest `context-menu` event.
  - Container picker `#container-menu` (`renderer.js:138–187`), kebab `#kebab-menu` (`renderer.js:221–237`)
    — custom HTML menus triggered by chrome buttons.
  - Find bar `#find-bar` (`renderer.js:2168–2204`) — a search input bar (NOT a menu); needs the live page.
  - Site-info `#site-info-popup` (`renderer.js:334–348`) — an info dialog (NOT a menu).
  - `menu-controller.js` (custom-HTML APG controller) becomes unused for the converted menus; keep only if
    something still uses it after conversion, else remove (DD12 "fix weird stuff").
- **Context-menu coordinate basis** (Spike B, confirmed): a `WebContentsView` guest's `context-menu` params
  are **view-relative**. Native `Menu.popup()` defaults to popping at the current cursor position, so the
  coordinate problem largely disappears — but if popping at explicit coords, use `guestBounds + params`.
- **Known-remaining occluders (still out of scope, logged):** `#toasts` (fixed bottom-left) and `#lightbox`
  (fixed inset:0) remain in the chrome doc and will be occluded by the guest — addressed later; not new
  regressions at the HAT.

## Inputs

- Sub-step-1 (overlay attempt) state on the branch: `popupView`, `popup-host.html`, `popup-preload.js`, the
  `popup-open/measured/action/dismissed` IPC, the z-order guard, and the context-menu relocation. **All to
  be removed/replaced** by this revised leg.
- Leg-1 web-tab surface (works); FIX-1 geometry + FIX-2 captureWindow (keep).

## Outputs

- Native context menu, kebab, and container picker via `Menu.popup()`.
- Find bar working over a live page via guest-top-inset.
- Site-info shown without occlusion (small popup/inset).
- Overlay infrastructure removed; white-launch regression gone.
- `npm test`/`typecheck`/`lint` green; `npm run a11y` green.

## Acceptance Criteria

- [ ] **AC1 — Overlay infra removed; no white-launch.** `popupView`, `popup-host.html`, `popup-preload.js`,
  and the popup-open/measured/action/dismissed IPC + z-order guard are removed. Tabs launch with the page
  visible (no white-until-tabs-created regression).
- [ ] **AC2 — Native context menu.** Right-click on a guest opens a native `Menu.popup()` at the cursor,
  above the page, with the correct items for the target (link: open/copy link; image: copy/save image;
  selection: copy; editable: cut/copy/paste/select-all; spellcheck: suggestions + add-to-dictionary; plus
  Inspect/DevTools). Items perform the same actions as before. Internal `goldfinch://` guests get no custom
  menu (parity). Built in **main** on the guest `context-menu` event.
- [ ] **AC3 — Native kebab.** The ⋮ button opens a native menu (Settings, Downloads, Print, Exit) above the
  page; actions work (open settings/downloads tab, print active guest, quit).
- [ ] **AC4 — Native container picker.** The new-tab ▾ opens a native menu of containers (default + user
  containers, with a color affordance, + "New container…"); selecting one opens a new tab in that
  container; "New container…" still works (via a main `dialog` input or inline, since `window.prompt` isn't
  available — see edge cases).
- [ ] **AC5 — Find bar over a live page (inset).** Opening find insets the active guest from the top by the
  find-bar height so the find bar (still HTML, in chrome) shows above the guest; the page stays live (find
  highlights/scroll visible); closing find restores the guest bounds. Per-tab find state preserved.
- [ ] **AC6 — Site-info visible.** The address-chip site-info shows without being occluded (small native-ish
  popup or inset — implementer's call, lowest-risk).
- [ ] **AC7 — a11y + dismiss.** Native menus provide keyboard nav + dismiss for free; find/site-info keep
  their existing keyboard handling. `npm run a11y` green.
- [ ] **AC8 — No regressions.** Leg-1 web tabs (render/navigate/switch/close/capture/guards) + FIX-1
  geometry + FIX-2 captureWindow still work. `npm test`/`typecheck`/`lint` green.

## Verification Steps

- Runtime (operator + agent): right-click a page → native context menu above the page, correct items,
  actions work; ⋮ → native kebab; ▾ → native container picker (open tab in container; new container);
  Ctrl+F → find bar shows over the live page (highlights visible), closes cleanly; address chip → site-info
  visible; tabs launch with page visible (no white). `npm test && npm run typecheck && npm run lint`;
  `npm run a11y`.

## Implementation Guidance

**Incremental, smoke after each. Sub-step 1 first (it removes the white-launch + proves native menus).**

1. **Remove the overlay infra + native CONTEXT MENU (sub-step 1 redo).**
   - Delete `popupView` (creation, IPC: `popup-open`/`popup-measured`/`popup-action`/`popup-dismissed`, the
     `tab-set-active` z-order guard, main-mediated dismiss), `src/renderer/popup-host.html`,
     `src/renderer/popup-host.js`, `src/preload/popup-preload.js`, and the `popupHost`/`sendChromeContextMenu`
     bridge bits. This removes the white-launch regression.
   - In **main**, on the guest `context-menu` event (the existing `wireGuestContents` handler that currently
     forwarded `page-context-menu`): build `Menu.buildFromTemplate(template)` from `params` and
     `menu.popup({ window: mainWindow })` (pops at the cursor). Template per `params.linkURL`/`srcURL`/
     `mediaType`/`selectionText`/`isEditable`/`editFlags`/`misspelledWord`/`dictionarySuggestions`. Wire
     click handlers directly to `contents.*` (copy/cut/paste/selectAll/replaceMisspelling/copyImageAt/
     downloadURL, `toggleDevTools(contents)`, clipboard.writeText, `session.addWordToSpellCheckerDictionary`,
     and the open-in-new-tab via the existing open-tab path). Internal guests: no menu (keep the
     `!__goldfinchInternal` guard). Remove the now-dead renderer context-menu code (the
     `onPageContextMenu`/`pageContextEntry`/`positionPageContextMenu` remnants) and the stale coord comment.
   - **Smoke:** right-click → native menu above page, items work; tabs launch non-white.
2. **Native KEBAB + CONTAINER picker.** Replace the HTML `#kebab-menu` / `#container-menu` + their
   `menuController` entries with: renderer button click → IPC to main (with the trigger's screen rect for
   positioning, or let the menu pop at the button) → main `Menu.popup()`. Kebab template = Settings/Downloads/
   Print/Exit (wire actions in main, reusing existing handlers). Container template = containers (color via
   `MenuItem` icon `NativeImage` swatch) + "New container…". Selecting → main signals the renderer to
   `createTab` in that container (or main triggers it). Remove the HTML elements + builders. Smoke.
3. **Find bar INSET (AC5).** Keep `#find-bar` HTML in the chrome. On find-open, the renderer signals main
   (or computes) to inset the active guest's bounds from the top by the find-bar height (~32–40px); the find
   bar renders in that strip above the guest; the page stays live below. On find-close, restore the guest
   bounds (the normal `#webviews` rect). Preserve per-tab find state (`tab.findOpen`/`findText`) and the
   `tab-find` path to the guest. Smoke (find highlights visible over a live page).
4. **Site-info (AC6).** Lowest-risk: a small native popup is not available for arbitrary info, so either
   inset a strip under the address bar while open, or briefly freeze-frame behind it (it's transient). Pick
   the simplest that shows it un-occluded; smoke.
5. **Cleanup (DD12).** Remove now-unused `menu-controller.js` usages if nothing else needs it; delete dead
   popup CSS/markup. Run `npm run a11y`.

## Edge Cases

- **`window.prompt` unavailable** (container "New container…") — use main's `dialog`-based input or an inline
  field, not `window.prompt`.
- **Native menu positioning** — `Menu.popup()` defaults to the cursor; for button-anchored menus (kebab,
  container) pass `{ x, y }` from the trigger rect (window coords) if you want it under the button.
- **Find inset reflow** — insetting the guest reflows the page slightly (top strip); acceptable (page stays
  live). Ensure the inset is removed on find-close and doesn't fight the FIX-1 geometry rAF.
- **Internal guests** — no context menu (keep the existing guard); kebab/container are chrome-level (fine).
- **Spellcheck** — Electron provides `params.misspelledWord` + `params.dictionarySuggestions`; build
  suggestion items + "Add to dictionary" (`session.addWordToSpellCheckerDictionary`).
- **Toasts/lightbox** — still occluded; out of scope (logged), not new regressions.

## Files Affected

- `src/main/main.js` — native context menu on guest `context-menu`; kebab/container `Menu.popup` IPC
  handlers; find-inset bounds handling; remove `popupView` + popup IPC.
- `src/renderer/renderer.js` — remove HTML context/kebab/container menus + `menuController` entries; wire
  button clicks to the native-menu IPC; find-open/close → inset signal; site-info handling.
- `src/renderer/index.html` / `styles.css` — remove the converted popup markup/CSS.
- `src/preload/chrome-preload.js` + `renderer-globals.d.ts` — the native-menu trigger IPC; remove popup-host
  bits.
- **Delete:** `src/renderer/popup-host.html`, `src/renderer/popup-host.js`, `src/preload/popup-preload.js`.
- `src/renderer/menu-controller.js` — remove if unused after conversion.
- `test/unit/` — update tests touching the popup DOM/menuController.

## Post-Completion Checklist

- [ ] AC1–AC8 verified (incl. runtime smoke per sub-step + `npm run a11y`)
- [ ] Tests/typecheck/lint green
- [ ] Flight log updated (native-menu conversion notes per popup; find-inset; site-info choice; cleanup)
- [ ] Leg status `landed` (NOT committed); `[HANDOFF:review-needed]`

## Citation Audit

Citations from the Flight-3 popup interrogation (2026-06-25): `renderer.js:138–187, 221–237, 334–348,
2168–2204`; `menu-controller.js`; sub-step-1 added `popup-host.*`/`popup-preload.js`/`popupView`. Line
numbers to be re-verified by the implementer (Leg 1 + sub-step 1 shifted them; symbols are stable).
