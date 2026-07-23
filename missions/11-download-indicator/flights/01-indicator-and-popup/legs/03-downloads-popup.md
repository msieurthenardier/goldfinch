# Leg: downloads-popup

**Status**: completed
**Flight**: [Top-Bar Download Indicator + Downloads Popup](../flight.md)

## Objective

Add the sheet-hosted downloads popup: a new `downloads` menu-overlay template that renders one row per
current/recent download (filename → open, folder icon → reveal, progress for in-flight) plus an "Open
downloads page" footer, wired to the `#downloads-indicator` button as its trigger and to the Leg-1
chrome-trust bridges, with the button + popup added to the `npm run a11y` sweep.

## Context

- Depends on **Leg 1** (`window.goldfinch.openDownloadedFile(id)` / `revealDownloadedFile(id)`) and
  **Leg 2** (`downloadsController` with `getSnapshot()` / `acknowledge()` / `isVisible()` /
  `forceShowForAudit()`, and `els.downloadsIndicator`).
- Flight DD2: **snapshot-at-open, close-then-act.** The sheet is presentation-only (one-shot activation,
  no main→sheet push). The popup renders the snapshot captured at open; activating a row closes the sheet,
  then the chrome performs the action. Live progress stays in the button, not the popup.
- Flight DD3: **new `downloads` template**, `role="dialog"`, trigger `aria-haspopup="dialog"`, **id-based**
  row dispatch (`dl:open:<id>` / `dl:folder:<id>` / `dl:page`). Full chrome-side wiring enumerated in DD3
  (a)-(f) — reproduced in Implementation Guidance below. The template kind is NEW (a fifth kind alongside
  `menu` / `info-popup` / `input-dialog` / `suggestions`).
- Menu-overlay template registration precedent — `info-popup` (`menu-overlay.js:245-270`): a node with an
  `id`, `role`, `tabIndex=-1`, `.hidden`; `menuController.register({ trigger, menu, onOpen, onClose,
  focusReturn })`; a local `keydown` owning Escape/Tab; a `render*()` builder; a `TEMPLATES[menuType]`
  entry; a `NODE_OF_ENTRY` pair; an `onInit` dispatch branch. Rows dispatch via `sendActivatedOnce({ id })`
  then `menuController.close(entry)`.
- a11y sweep precedent — `scripts/a11y-audit.mjs`: the `devtools-button` chrome state (`:373-386`)
  force-shows a `.hidden` button then runs axe; `SHEET_STATES` (`:399-411`) open each sheet menu from a
  chrome-side global opener and audit the sheet wcId; `SHEET_DISMISS_EXPR` / `SHEET_CLOSED_EXPR`
  (`:246,254`) enumerate the sheet node ids `['sheet-menu','sheet-popup','sheet-dialog']`.
- **FD ruling (from flight DD3):** the globalThis audit-opener seam additions
  (`showDownloadsIndicatorForAudit`, `openDownloadsOverlayForAudit`) are approved, scoped solely to the
  `npm run a11y` sweep, matching the `openTabContextMenuForAudit` precedent.

## Inputs

- Legs 1 + 2 landed (uncommitted on `flight/01-indicator-and-popup`).
- `src/renderer/menu-overlay.js` — `TEMPLATES` (`:524`), `NODE_OF_ENTRY` (`:537`), `onInit` dispatch
  (`:593-613`), `renderPopup`/`popupEntry` (`:245-275`), `sendActivatedOnce`.
- `src/renderer/renderer.js` — `overlayMenus` state map (~`:217-247`; note the `suggestions`/`page-context`
  entries at `:224-248` are the **custom state-literal** precedent to copy — NOT `fixedTriggerMenu`),
  `overlayTriggerClick` (~`:433`), the kebab opener + `rightSheetAnchor` (~`:368-396`),
  `dispatchOverlayActivation` (~`:478-718`), `openDownloads()` (`:159 — "function openDownloads()"`),
  `onMenuOverlayClosed`, the CLOSED-SET `globalThis` audit seam (`:1176-1199`).
- `src/renderer/chrome/overlay-menus.js` — `chromePointToSheet` (`:14`), `open` early-return-without-state
  (`:45`), `ariaTarget`/`fixedTriggerMenu` (`:51,79`).
- `scripts/a11y-audit.mjs` — `SHEET_STATES`, `SHEET_DISMISS_EXPR`, `SHEET_CLOSED_EXPR`, `devtools-button`.

## Outputs

- `menu-overlay.js`: `sheet-downloads` node + `downloadsEntry` + `renderDownloads()` + `TEMPLATES`/
  `NODE_OF_ENTRY`/`onInit` entries + local keydown.
- `menu-overlay.css`: `.dl-*` row/footer styles (the sheet document `menu-overlay.html` links **only**
  `menu-overlay.css`, where `.cm-*`/`.si-*`/`.sg-*` already live; `styles.css` is the chrome's sheet and is
  NOT loaded by the sheet document).
- `renderer.js`: `overlayMenus['downloads']` state, button trigger wiring, `openDownloadsOverlay()`,
  `dispatchOverlayActivation` `case 'downloads'`, the two globalThis audit-seam functions.
- `scripts/a11y-audit.mjs`: `downloads-button` chrome state + `sheet:downloads` sheet state +
  `sheet-downloads` added to the dismiss/closed node-id arrays.
- `tests/behavior/download-indicator.md`: flip `Status: draft → active` only after a passing run (leave
  draft here; it is activated during HAT).

## Acceptance Criteria

- [x] A new `downloads` menu-overlay template renders in the sheet: a `#sheet-downloads` node
      (`role="dialog"`, `tabIndex=-1`, `.hidden`) registered via `menuController.register` **without an
      `items` getter** (so the controller's roving no-ops — the chrome-popup regime), with a
      `TEMPLATES['downloads']='downloads'` entry, the JSDoc `TEMPLATES` **union type extended with
      `| 'downloads'`** (`menu-overlay.js:523` — `checkJs` is on, so omitting this fails `npm run typecheck`),
      a `NODE_OF_ENTRY` pair, and an `onInit` dispatch branch (flat-array `modelShapeOk` branch).
- [x] The template's **local keydown** owns: `Escape` → `preventDefault` + close (escape flavor);
      `Tab` / `Shift+Tab` → `preventDefault` + **cycle focus among the enabled buttons** (the *input-dialog*
      precedent, `menu-overlay.js:420-432`) with **no** dismissal and **no** `lastStimulus` mutation. (Do
      NOT copy info-popup's Tab-closes behavior — a multi-button dialog must cycle.)
- [x] `renderDownloads(model)` renders one row per snapshot item. **Completed** items render a **filename
      button** dispatching `dl:open:<id>` and a **folder-icon button** dispatching `dl:folder:<id>`.
      **In-progress** items render the filename as **non-interactive text** (a `<span>`, not a button) plus
      a **progress indicator** — no open/reveal buttons, so an in-progress item is inherently not openable
      (this is cleaner than a disabled button and avoids a disabled-first-button focus trap). A footer
      button dispatches `dl:page`. All filenames are set via `textContent` (never `innerHTML`).
- [x] The `#downloads-indicator` button is the trigger: clicking / activating it opens the `downloads`
      overlay anchored under the button (via `rightSheetAnchor` + `chromePointToSheet`).
      `downloadsController.acknowledge()` is called when the popup **closes** (DD5 refinement — see the
      flight-log Decisions entry), NOT on open, so the trigger button never hides underneath its own open
      popup.
- [x] `overlayMenus['downloads']` is a **custom state literal** (copied from the `suggestions`/`page-context`
      entries, `renderer.js:224-248`), NOT `fixedTriggerMenu(...)` — using `fixedTriggerMenu` nests the whole
      state object under `ariaTarget` and makes `state.ariaTarget()` throw. It provides
      `ariaTarget: () => els.downloadsIndicator` (so the button's `aria-expanded` flips `true`/`false` on
      open/close) and a guarded `refocus(reason)` that focuses the button only when
      `(reason==='escape'||reason==='activated') && downloadsController.isVisible()` — never while `.hidden`
      (fall back to `els.address.focus()` otherwise, page-context parity).
- [x] `dispatchOverlayActivation` handles `case 'downloads'`: parse `<id>` from `dl:open:<id>` /
      `dl:folder:<id>`, validate it is an integer present in the open-time snapshot (vanished / malformed →
      no-op), then call `window.goldfinch.openDownloadedFile(id)` / `revealDownloadedFile(id)`; `dl:page`
      calls `openDownloads()` (reuses the existing downloads-page opener).
- [x] The a11y sweep covers both surfaces: a `downloads-button` chrome state (force-show the button via a
      globalThis seam, then axe the chrome) and a `sheet:downloads` sheet state
      (`openDownloadsOverlayForAudit()` force-shows a synthetic entry + opens the popup, then axe the sheet
      wcId); `sheet-downloads` is added to `SHEET_DISMISS_EXPR` and `SHEET_CLOSED_EXPR`.
- [x] `npm run a11y` passes (button + popup labeled/operable; no new violations, or a curated allowlist
      entry added with rationale if the popup raises the same transient-region advisory as the other sheet
      menus).
- [x] `npm test`, `npm run typecheck`, and `npm run lint` are all green; the Leg-2 `eslint-disable` on
      `downloadsController` is removed now that the popup consumes it.

## Verification Steps

- `npm test` — green. `npm run typecheck` — clean. `npm run lint` — clean.
- `npm run a11y` — passes, including the new `downloads-button` and `sheet:downloads` states.
- `grep -n "sheet-downloads\|dl:open\|dl:folder\|dl:page" src/renderer/menu-overlay.js src/renderer/renderer.js`
  — template + dispatch present; filenames set via `textContent`.
- `grep -n "openDownloadsOverlayForAudit\|showDownloadsIndicatorForAudit" src/renderer/renderer.js scripts/a11y-audit.mjs`
  — seam functions defined and referenced by the sweep.
- Behavior test (activated at HAT): `/behavior-test download-indicator` — the real-app flow.

## Implementation Guidance

1. **New template** (`menu-overlay.js`) — mirror the `info-popup` block (`:245-275`):
   - Create `downloadsNode` (`id='sheet-downloads'`, `role='dialog'`, `tabIndex=-1`, `.hidden`, appended to
     `root`); a `DOWNLOADS_LABELS`/`aria-label` ("Downloads").
   - `const downloadsEntry = menuController.register({ trigger: downloadsNode, menu: downloadsNode,
     onOpen() { downloadsNode.classList.remove('hidden'); (downloadsNode.querySelector('button') ||
     downloadsNode).focus(); }, onClose() { downloadsNode.classList.add('hidden'); reportDismissed(); },
     focusReturn: () => {} })`. (`querySelector('button')` is safe: only completed rows and the footer
     render buttons, so the first button is always enabled — no `:not([disabled])` needed.)
   - Local `keydown` on `downloadsNode`: `Escape` → `preventDefault()` + `lastStimulus='escape'` +
     `menuController.close(downloadsEntry)`; `Tab`/`Shift+Tab` → `preventDefault()` + cycle focus among
     `downloadsNode.querySelectorAll('button')` (all rendered buttons are enabled), no dismissal, no
     `lastStimulus` write. This is the *input-dialog* cycle regime, not info-popup's Tab-closes.
   - `renderDownloads(menuType, model, anchor)`: clear node; for each `item` in `model` build a `.dl-row`:
     - **completed** (`item.completed`): a filename `<button class="dl-name">` (`textContent =
       item.filename`) whose click does `if (sendActivatedOnce({ id: 'dl:open:' + item.id }))
       menuController.close(downloadsEntry)`, plus a folder-icon `<button aria-label="Show in folder">` →
       `dl:folder:' + item.id`.
     - **in-progress** (`!item.completed`): the filename as a **`<span class="dl-name">`** (text, not a
       button) plus a `.dl-progress` element (percent from `received/total`, or a paused/indeterminate
       state) — no action buttons, so the item is inherently not openable.
     Append a footer `<button>` "Open downloads page" → `dl:page`. Then `positionNode(downloadsNode, anchor)`.
   - Register `TEMPLATES['downloads'] = 'downloads'` AND extend the JSDoc union at `menu-overlay.js:523`
     with `| 'downloads'`; add `[downloadsEntry, downloadsNode]` to `NODE_OF_ENTRY`; add an `onInit` branch:
     `else if (template === 'downloads') { renderDownloads(...); menuController.open(downloadsEntry, 0); }`.
     The `modelShapeOk` check uses the flat-array branch (the downloads model is an array).

2. **Chrome wiring** (`renderer.js`) — DD3 (a)-(f):
   - (a) Add `overlayMenus.downloads` as a **custom state literal** (copy the shape of the
     `suggestions`/`page-context` entries at `:224-248` — do NOT use `fixedTriggerMenu`, which returns the
     whole state object and would make `state.ariaTarget()` throw):
     ```js
     downloads: {
       open: false, token: 0, blurClosedAt: -Infinity,
       ariaTarget: () => els.downloadsIndicator,
       refocus(reason) {
         // acknowledge-on-close FIRST (before isVisible), so isVisible() reflects the
         // post-acknowledge state — see the acknowledge-on-close note below and the
         // flight-log DD5-refinement Decision. refocus runs before handleOverlayClosed
         // (overlay-menus.js:81-82), so this is the correct single-fire hook.
         downloadsController.acknowledge();
         if ((reason === 'escape' || reason === 'activated') && downloadsController.isVisible()) {
           els.downloadsIndicator.focus();
         } else {
           els.address.focus();
         }
       }
     }
     ```
     Without a state entry, `overlayMenuClient.open` early-returns `false`.
   - (b) Wire the button: on `els.downloadsIndicator` click / Enter / Space (and ArrowDown/Up per the
     kebab pattern) → `overlayTriggerClick('downloads', …)`. Guard: do nothing if the button is `.hidden`.
   - (c) `openDownloadsOverlay()` builds the model from `downloadsController.getSnapshot()` — each item
     carries `state` (not `completed`), so map to `{ id, filename, completed: entry.state === 'completed',
     received, total, paused }` — retains the id-list for dispatch validation, computes the anchor with
     `rightSheetAnchor(webviewsRect, els.downloadsIndicator.getBoundingClientRect())`, and opens via the
     overlay client (menuType `'downloads'`). Guard: no-op if the model is empty. Do **NOT** call
     `acknowledge()` here — it is called on close (see (d)/refocus).
   - **acknowledge-on-close**: call `downloadsController.acknowledge()` as the **first statement inside the
     state's `refocus(reason)`** (shown in (a) above) — NOT in `handleOverlayClosed`. `refocus` runs before
     `handleOverlayClosed` (`overlay-menus.js:81-82`); placing `acknowledge()` there first means the
     subsequent `isVisible()` check sees the post-acknowledge state, so the button is refocused only when
     in-flight downloads keep it visible and otherwise focus falls back to `els.address` — preserving the
     focus contract. It fires once per close (token-guarded) and covers escape / outside-click / blur
     uniformly. A close always follows an open, so acknowledging on any close is unambiguous and avoids
     hiding the trigger under its own open popup.
   - (d) `dispatchOverlayActivation` `case 'downloads'`: for `id` strings `dl:open:<n>` / `dl:folder:<n>`,
     `const n = Number(rawId); if (!Number.isInteger(n)) return;` then confirm `n` is in the snapshot the
     popup was opened with (retain it on open); `dl:open` → `window.goldfinch.openDownloadedFile(n)`,
     `dl:folder` → `window.goldfinch.revealDownloadedFile(n)`; `dl:page` → `openDownloads()`.
   - (e) `els.downloadsIndicator` / IDS entry already exist (Leg 2).
   - (f) In the CLOSED-SET `globalThis` audit seam (`:1176-1199`), add (guarded like the existing
     `openTabContextMenuForAudit`): `globalThis.showDownloadsIndicatorForAudit = () =>
     downloadsController.forceShowForAudit();` and `globalThis.openDownloadsOverlayForAudit = () => {
     downloadsController.forceShowForAudit(); openDownloadsOverlay(); };`. Update the seam's entry-count
     comment (the "N-entry set" note bumps by 2, mirroring the `openTabContextMenuForAudit` annotation).
     Remove the Leg-2 `eslint-disable no-unused-vars` on `downloadsController` (now consumed).
   - aria-expanded: handled by the `ariaTarget` in (a) via `overlay-menus.js:51,79` — verify it flips.

3. **a11y sweep** (`scripts/a11y-audit.mjs`):
   - Add a chrome state after `devtools-button`: `await evaluate(client, wcId,
     'showDownloadsIndicatorForAudit()'); await sleep(200);` then `runAxe(..., 'downloads-button')`.
   - Add `{ label: 'sheet:downloads', open: 'openDownloadsOverlayForAudit()' }` to `SHEET_STATES`.
   - Add `'sheet-downloads'` to both the `SHEET_DISMISS_EXPR` and `SHEET_CLOSED_EXPR` id arrays.
   - Run `npm run a11y`. **Expected: no allowlist entry needed** — the accepted-list comment
     (`a11y-audit.mjs:136-140`) notes `role="dialog"` sheet content (info-popup, input-dialog) raises no
     region advisory, and `#sheet-downloads` is also `role="dialog"`. Only if a real violation surfaces,
     add a curated `{ id:'region', selector:'#sheet-downloads', state:'sheet:downloads', reason:'…' }` entry
     (same class as the sheet-menu exceptions) — never auto-dump.
   - Note: `forceShowForAudit()` runs in both the `downloads-button` and `sheet:downloads` states and the
     reducer's `done` does not dedup, so the popup audit may render two identical synthetic rows — harmless
     for axe (both are named, enabled buttons).

4. **Styles**: add `.dl-row` / filename-button / filename-span / folder-button / `.dl-progress` / footer
   styles to **`menu-overlay.css`** (the only stylesheet the sheet document links), matching the `.si-*`
   info-popup visual language. Use CSS ellipsis on the filename for long/RTL names.

## Edge Cases

- **Malformed / vanished id** (`dl:open:` with a non-integer, or an id no longer in the snapshot) → no-op
  (validated at dispatch). This is the "vanished → validated no-op" DD3 contract.
- **Open on a non-completed row** — the row is disabled, but if a race lets it through, Leg 1's handler
  returns `{ ok: false }` silently (completion gate). No user-visible error is expected.
- **Untrusted filename** with markup / RTL / very long text → `textContent` only; CSS ellipsis for length.
- **Empty snapshot** — the button only shows when there is ≥1 item, but guard `openDownloadsOverlay()` to
  no-op on an empty model rather than opening an empty dialog.
- **Focus while hidden** — the refocus path must not `.focus()` the button when `.hidden`; guard on
  `isVisible()`.

## Files Affected

- `src/renderer/menu-overlay.js` — new template.
- `src/renderer/menu-overlay.css` (or the sheet's stylesheet) — `.dl-*` styles.
- `src/renderer/renderer.js` — state entry, trigger, opener, dispatch, audit seam; remove Leg-2 eslint-disable.
- `src/renderer/menu-overlay.css` — `.dl-*` row/footer styles.
- `scripts/a11y-audit.mjs` — `downloads-button` + `sheet:downloads` states + dismiss/closed arrays.

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`), `npm run a11y` passing, typecheck + lint clean
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] This is the last **autonomous** leg — do NOT land the flight or transition flight status here; the
      `hat-and-alignment` leg follows, and flight-end review/commit is the Flight Director's step
- [ ] Changes staged for the single flight-end commit (do NOT commit per-leg under this workflow)
