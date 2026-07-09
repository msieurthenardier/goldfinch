# Leg: page-context-and-unpin

**Status**: completed
**Flight**: [Menu Overlay Sheet](../flight.md)

## Objective

Migrate the last two surfaces — the **page context menu** (guest right-click, keyboard
invocation, and the audit hook) and the **toolbar-unpin mode** (same menu node today) — onto the
sheet behind the gate, with **1:1 guest-relative coordinates** (the DD2 payoff: the chrome-offset
translation is bypassed on the sheet path and becomes deletable at Leg 5), a pure unit-tested
params→model builder, index-dispatched spelling suggestions, and reason-resolved focus return via
`returnFocus`. Completes **CP3**: all five surfaces render from the sheet behind the gate; old
paths intact gate-OFF.

## Context

- **DD2 coordinate identity (the flight's headline win for this surface)**: guest `params.x/y`
  are guest-view-relative DIPs; the sheet's page CSS coords ≡ guest-region coords, so the sheet
  path positions the menu at `params.x/y` DIRECTLY — no `els.webviews.getBoundingClientRect()`
  offset (`positionPageContextMenu`, `renderer.js:837-859`, keeps serving the gate-OFF path;
  Leg 5 deletes it). The chrome-focused keyboard and toolbar invocations still translate
  chrome→sheet (subtract guest-region origin, clamp y≥0) — the DD2 nuance, same helper the
  toolbar menus already use.
- **Invocation modes today** (all through one `pageContextEntry`, `renderer.js:861-905`):
  1. **Guest right-click**: main's guest `context-menu` listener forwards
     `{wcId, params}` to chrome (`src/main/main.js:1044-1048`; internal guests excluded at
     `:1047 — "if (isInternalContents(contents)) return"` — DD7's page-context exclusion,
     UNCHANGED); chrome subscription `renderer.js:913-921` captures
     `pageCtx` (TOCTOU: acted-on `wcId` captured at right-click, never re-resolved) and opens
     via a `queueMicrotask` blur-settle defer (`:921`).
  2. **Chrome-focused keyboard** (Shift+F10 / ContextMenu key, `renderer.js:928-947`):
     chrome client coords from the focused element's rect; lightbox gate `:931`; toolbar
     pin buttons excluded `:936` (their `contextmenu` listener owns them — double-fire gate).
     A guest-focused Shift+F10 synthesizes a real `context-menu` event main-side → mode 1.
  3. **Toolbar-unpin** (`openToolbarContextMenu`, `renderer.js:955-965`): single
     "Unpin {item}" item, anchored at the pin button.
  4. **Audit hook** (`openPageContextMenuForAudit`, `renderer.js:974-992`): synthetic
     full-section params at fixed coords; reachable via MCP `evaluate` — the `npm run a11y`
     driver (DD6). Must work on BOTH paths (gate-aware) — Leg 5's a11y extension depends on it.
- **Model building**: `buildPageContextSections` (`renderer.js:714-828`) renders sections
  directly into chrome DOM per captured params — link (`Open link in new tab` / `Copy link`),
  image (`srcURL||imageURL`; open/copy-address/save via `downloadMedia` +
  `basenameFromUrl`, `:699`), selection (`Copy` / `Search for "…"` via `truncateLabel(…, 30)`,
  `:693`, `:786`), editable (edit-actions gated per `editFlags`, omit-if-falsy), spelling
  (suggestions sliced to 8; else a disabled `No suggestions` note — the only non-focusable
  affordance), always-Inspect; toolbar mode short-circuits to the single Unpin item. The sheet
  path extracts this into a **pure, dual-export, unit-tested** `pageContextModel(params,
  toolbarItem)` returning typed items — the DOM renderer keeps consuming its OWN section logic
  gate-OFF (one derivation, mirrored assertions in tests; full extraction of the old renderer
  is NOT required — it dies at Leg 5).
- **Model item types (extends the Leg-3 registry vocabulary)**: `{type:'item', id, label}`,
  `{type:'separator'}` (`role="separator"`, non-focusable, skipped by roving),
  `{type:'note', text}` (aria-disabled, non-focusable — the `No suggestions` case).
- **Id namespacing (Leg-3 lesson, mandatory)**: `link:open`, `link:copy`, `image:open`,
  `image:copy`, `image:save`, `sel:copy`, `sel:search`, `edit:cut|copy|paste|undo|redo`,
  `spell:<index>`, `action:inspect`, `action:unpin:<media|shields|devtools>`.
  **Spelling dispatches by INDEX**: the id carries `spell:2`; chrome resolves the word from the
  CAPTURED `pageCtx.params.dictionarySuggestions[2]` with bounds/type validation — a
  guest-controlled string never round-trips as a command, only as a rendered label (DD8).
- **Actions stay in chrome (DD4)**: all channel-6 `page-context` dispatch bodies call the same
  `window.goldfinch` APIs as today (`clipboardWriteText`, `downloadMedia`,
  `pageContextAction`, `correctMisspelling`, `toggleDevtools`, `unpinToolbarItem`,
  `createTab`) with `pageCtx`-captured `wcId` (TOCTOU preserved).
- **Focus return (completes DD4's reason map) — via a GENERALIZED entry shape (design-review
  decision)**: the `overlayMenus` entry gains two per-entry fields that the generic
  channel-1/channel-7 handlers consult: `ariaTarget: () => HTMLElement|null` (aria-expanded is
  stamped/reset ONLY when non-null — `page-context` returns null: its "trigger" is transient
  and stamping the address input / body / a foreign menu-button would leak a false AT signal,
  incl. the same-menuType-replace stale-close orphan) and a refocus policy keyed by reason
  (existing fixed-trigger menus keep today's escape+activated→trigger behavior; `page-context`
  refocuses on `escape` ONLY → `pageCtx.returnFocus` if `isConnected` and `!== document.body`,
  else `els.address` — parity with `focusReturn`, `renderer.js:893-901`). The getter is
  READ-ONLY (must not clear on read — the open-time path also calls it); `returnFocus` is
  cleared in the channel-7 close handling after use. Leg 5 inherits this shape at cutover.
  Main-side `focusChrome()` on escape already lands (Leg-2 machinery).
- **Blur-settle defer dropped on the sheet path**: the `queueMicrotask` (`:921`) existed to
  outlive the chrome window-blur from the right-click racing menuController's blur-dismisser —
  retired concern for sheet menus (dismissal authority is the sheet + close family). Gate-ON
  opens directly; gate-OFF keeps the defer.
- **Point-anchor clamping**: the sheet's `positionNode` already supports `{x,y}` point anchors
  (`menu-overlay.js:80-101`); this leg adds clamping so a near-edge right-click keeps the menu
  inside the sheet (mirror today's viewport clamp semantics: `min(x, sheetW - menuW - 4)`,
  floor 4 — `positionPageContextMenu`'s clamp, `renderer.js:851-856`).
- **No main.js changes expected**: the `context-menu` forward, internal exclusion, and Leg-2
  protocol all serve as-is.
- Deferred to Leg 5: cutover (old entry/renderer/translation deletion, freeze deletion, audit
  extension per DD6, DD11 spec/docs dispositions). Deferred to Leg 6: HAT + Witnessed runs.

## Inputs

- Legs 1–3 landed (uncommitted). Sheet machinery: `openOverlayMenu` family
  (`renderer.js:280-304`), namespaced-id dispatch precedent (`:378-394`), per-template
  controller entries + `positionNode` (`menu-overlay.js`, 465 lines), Leg-2 channel protocol.
- Anchors (fresh, post-Leg-3 tree, renderer.js 3,069 lines): `:63` `els.pageContextMenu`,
  `:689` `pageCtx`, `:693` `truncateLabel`, `:699` `basenameFromUrl`, `:714`
  `buildPageContextSections`, `:837` `positionPageContextMenu` (clamp `:851-856`), `:861-905`
  `pageContextEntry` (freeze `:877`, focusReturn `:893-901`), `:913-921` subscription (defer
  `:921`), `:928-947` keyboard handler (lightbox `:931`, toolbar exclusion `:936`), `:955-965`
  `openToolbarContextMenu`, `:974-992` `openPageContextMenuForAudit`;
  `src/main/main.js:1044-1048` guest `context-menu` forward + internal exclusion;
  `src/renderer/menu-overlay.js:80-101` `positionNode`.
- Apparatus: as prior legs (free-port SDK client, litmus, canary, probed sheet wcId, evidence
  dir `/tmp/behavior-tests/goldfinch/menu-overlay-cp3-final/<ts>/`). Known nuance (Leg-3): MCP
  `pressKey` Enter on a focused sheet menuitem doesn't synthesize the DOM click — drive
  activation via `evaluate` `activeElement.click()` on the sheet wcId; real-keyboard parity is
  HAT-covered. Right-click synthesis: MCP `click` with `{button:'right'}` on the guest wcId
  fires the real `context-menu` path (verify; else `evaluate`-drive the audit hook for model
  checks and cover true right-click at HAT).

## Outputs

- Modified: `src/renderer/renderer.js` (gate branches on all four invocation paths, channel-6
  `page-context` dispatch with index-resolved spelling + bounds validation, channel-7 focus
  return with `returnFocus`, audit hook gate-awareness), `src/renderer/menu-overlay.js`/`.css`
  (separator/note item types in the `menu` template; point-anchor clamping), new
  `src/shared/page-context-model.js` (pure builder, dual-export) + unit test.
- Behavior: gate ON → all five surfaces on the sheet (CP3 complete); gate OFF → today's
  behavior bit-for-bit.

## Acceptance Criteria

- [x] **AC1 — Guest right-click at 1:1 coords (gate ON).** Right-click on the live fixture at a
  known guest coordinate → sheet menu opens with its top-left at that coordinate (pixels;
  tolerance ≤2px) over the LIVE guest — no offset translation on this path. Sections reflect
  the real params (link context → link items; plain area → Inspect-only).
- [x] **AC2 — Pure model builder unit-tested.** `pageContextModel(params, toolbarItem)` covers:
  section presence/order (link → image → selection → editable → spelling → Inspect), image
  `srcURL||imageURL` preference + `mediaType==='image'` gate, editable gated per-flag with
  omit-if-no-flags, selection label truncation (30) + quoting, suggestions sliced to 8,
  `note` fallback for zero suggestions, separators between (not before first), always-Inspect,
  toolbar short-circuit to the single `action:unpin:<item>` item, namespaced ids, `spell:<i>`
  index ids.
- [x] **AC3 — Keyboard + toolbar invocations (gate ON).** Chrome-focused Shift+F10/ContextMenu
  on a focusable chrome element opens the sheet menu at the translated element anchor
  (y-clamped); the lightbox gate and toolbar-button double-fire exclusion behave as today.
  Right-click on a pinned toolbar button opens the single-item Unpin menu at the translated
  anchor; activating it unpins (same body) and lands focus on the address bar — that focus
  comes from the DISPATCH BODY (`unpinToolbarItem` + `els.address.focus()`, parity with
  `renderer.js:750-753`), NOT the reason map, which stays escape-only for this menuType. Guest-focused
  Shift+F10 rides the main-side path (mode 1) — spot-check.
- [x] **AC4 — Actions round-trip (gate ON).** Each verified live where non-disruptive:
  `link:open` (new tab), `link:copy` + `sel:copy` (clipboard via `evaluate`
  `navigator.clipboard.readText()` or equivalent), `sel:search` (search tab), `edit:*` against
  an editable field (cut/paste round-trip), `spell:<i>` corrects via INDEX dispatch (bounds
  validated — out-of-range/no-params dispatch is a no-op), `action:inspect` toggles devtools
  on the captured wcId (close it after), `image:copy` address. `image:save` may be verified by
  download-record presence (no dialog on this path) or deferred to HAT if disruptive — note
  which. Print-style modal traps: none expected; avoid `edit:*` on chrome-focused mode.
- [x] **AC5 — Sheet template extensions.** Separators render `role="separator"` and are
  excluded from roving (Arrow past them lands on items); `note` items are `aria-disabled`,
  non-focusable; point-anchor clamping keeps a near-right/bottom-edge menu fully inside the
  sheet (floor 4px, parity semantics).
- [x] **AC6 — Focus return.** Escape after a keyboard invocation returns focus to the invoking
  element (keystroke-corroborated); Escape after the audit-hook open returns to `els.address`;
  outside-click/blur → no refocus; `returnFocus` never leaks across opens (cleared on use;
  a second open overwrites it).
- [x] **AC7 — Audit hook gate-aware.** `openPageContextMenuForAudit()` opens the full-section
  menu on the sheet when gated (readDom on the sheet wcId shows all sections) and on chrome
  DOM when not — the Leg-5 a11y driver premise.
- [x] **AC8 — Dismissal parity + close family.** Right-click in the guest region while a sheet
  menu is open is **swallowed by the sheet** — it dismisses via `outside-click` and does NOT
  reach the guest (no `context-menu` event, no navigation, no new menu) — this is PARITY
  (gate-OFF the frozen guest can't receive it either) and by design (review: the sheet has no
  contextmenu forward and must not gain one). Supersede coverage for `page-context` is
  verified via the audit hook (`evaluate` open while the kebab is open → model-replace). Tab
  lifecycle/blur close it via the family; DD5 find interplay holds (find hidden while the
  context menu is open, restored on dismiss).
- [x] **AC9 — Gate-OFF parity (all five surfaces).** Old context menu (with offset
  translation + freeze), unpin mode, kebab, container, site-info, dialog — exactly as today;
  no `menu-overlay:*` traffic.
- [x] **AC10 — Gates green.** `npm test`, `npm run typecheck`, `npm run lint`.

## Verification Steps

- Apparatus preamble (litmus + canary). Fixture: extend
  `tests/behavior/fixtures/menu-overlay/index.html` — add a **mid-page link** (AC1's positional
  target — the existing bottom-left link sits 24px above the edge where the y-clamp would fire,
  contradicting a 1:1 check; the bottom-left link stays UNTOUCHED, it is the Leg-6 spec's
  step-3 contract), an image (same-origin sibling PNG served by the fixture's own http.server —
  keeps the no-external-resources pledge while exercising the real downloads path), a text
  selection target, and an editable input. Ticking display contract intact.
- AC1: MCP `click {button:'right'}` on the guest at the MID-PAGE link's coords (the schema
  supports `button:'right'` end-to-end — `mcp-tools.js` enum → `input.js` `sendInputEvent`;
  whether synthetic right-click fires `context-menu` on a WebContentsView is unverified) →
  grab + `readDom(sheet)` (link section present; menu at the click point, 1:1, tolerance
  ≤2px). If right-button synthesis doesn't fire `context-menu`, fall back to the audit hook
  for model checks and record AC1's positional claim as HAT-carried (note in flight log).
- AC2: `npm test` (new suite).
- AC3: `evaluate` focus a toolbar element → pressKey Shift+F10 (chrome wcId) → menu at
  translated anchor; `evaluate` right-click event on a pin button → Unpin menu; activate →
  `unpinToolbarItem` effect (toolbar icon gone) + refocus corroboration.
- AC4: per-action live checks (clipboard reads via `evaluate` on the GUEST for page clipboard;
  chrome-side `clipboardWriteText` lands in the system clipboard — read back via `evaluate`
  `navigator.clipboard.readText()` in chrome with permission fallback noted); spelling: type a
  misspelling in the fixture's editable field, right-click it, dispatch `spell:0`, confirm the
  field text changed.
- AC5: right-click near the sheet's right/bottom edge → grab (menu inside, 4px floor); Arrow
  through a full-section menu → roving skips separators/notes (`readDom` roving state).
- AC6/AC7/AC8: per AC text — keystroke corroboration as in prior legs; audit hook via
  `evaluate` in both gate modes (two instances or relaunch). **Refactor regression
  spot-check** (the entry-shape change rewrites lines Legs 2-3 verified live): open kebab →
  Escape → `#kebab` focused + `aria-expanded` reset (one line, gate ON).
- AC9: gate-OFF relaunch sweep of all five surfaces + old context menu offset behavior.
- AC10: `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

1. **`src/shared/page-context-model.js`** (pure, `// @ts-check`, dual-export): port the section
   logic of `buildPageContextSections` (`renderer.js:714-828`) to emit the typed item array;
   reuse the truncation rule (inline a local `truncateLabel` or export the existing one from a
   shared module — do NOT reach into renderer.js from the shared module). Toolbar mode
   short-circuits. Unit-test per AC2.
2. **Gate branches (renderer.js)**: in the subscription (`:913-921`) — gate ON: set `pageCtx`
   exactly as today, then `openOverlayMenu('page-context', pageContextModel(params, null),
   {x: pageCtx.x, y: pageCtx.y}, 0)` directly (no microtask, no translation); gate OFF:
   existing body. Keyboard handler (`:928-947`) and `openToolbarContextMenu` (`:955-965`) —
   gate ON: translate the element-rect coords chrome→sheet with the existing anchor helper
   (point form: `{x: r.left - wv.left, y: max(0, r.bottom - wv.top)}`), open with the model
   (toolbar mode passes `toolbarItem`). **All four gate-ON branches capture `pageCtx`
   (`wcId`/`params`/`toolbarItem`/`returnFocus`) exactly as their gate-OFF bodies do before
   opening** — channel-6 dispatch and the escape refocus read those fields. Audit hook
   (`:974-992`) — gate ON: same synthetic params through the sheet path (translate the
   synthetic 80,80 chrome coords chrome→sheet like the other keyboard-mode anchors —
   immaterial to the audit's purpose, pinned for determinism). **Generalize the `overlayMenus` entry shape** (per Context):
   add `ariaTarget: () => HTMLElement|null` — existing menus return their trigger,
   `page-context` returns null; the generic open path (`:286` aria stamp) and channel-7 close
   path guard on it — and a per-entry reason→refocus policy (existing menus keep
   escape+activated→trigger; `page-context`: escape-only → guarded read-only `returnFocus`
   getter, cleared after use in the close handler).
3. **Channel-6 dispatch**: `case 'page-context'` — switch on the namespaced id prefix; bodies
   are the same calls as today's `item(...)` closures (`:741-827`), reading `pageCtx.params` /
   `pageCtx.wcId` captured at open. **Validated-no-op discipline on EVERY id** (review): a
   synchronous local open can overwrite `pageCtx` between channel 7 and channel 6 — each body
   guards its inputs (`link:open` with vanished `linkURL` → no-op, never
   `createTab(undefined)`; same for image/selection ids). `spell:<i>`: parse int, validate
   `Array.isArray(dictionarySuggestions) && i >= 0 && i < min(len, 8)` and
   `typeof word === 'string'` before `correctMisspelling`. Unpin ids route to
   `unpinToolbarItem` + `els.address.focus()` parity.
4. **Sheet template (`menu-overlay.js`)**: extend the `menu` template's item loop for
   `separator` (div, `role="separator"`, class) and `note` (div, `aria-disabled="true"`,
   `textContent`) — **branch on `item.type` BEFORE the existing id-string guard**
   (`menu-overlay.js:167` drops id-less items — separators would silently vanish); the
   `items()` getter already returns ONLY `[role="menuitem"]` buttons (roving falls out). Add a
   `page-context` entry to `MENU_LABELS`: `'Page actions'` (parity —
   `src/renderer/index.html:54`).
   Point-anchor clamp: **measurement requires the node to be visible** — `positionNode`
   currently runs while the node is `.hidden` (`display:none` → `offsetWidth` 0,
   `menu-overlay.js:187` vs unhide at `:134`): unhide before measuring (or run point-anchor
   positioning after the unhide in `onOpen`), mirroring the chrome path
   (`renderer.js:879-882`). Then clamp `x` to `[4, innerWidth - w - 4]`, `y` to
   `[0, innerHeight - h - 4]` (y floor 0 per DD12; clamp point anchors only — align anchors
   already clamp).
5. **CSS**: separator/note styles mirroring today's `.cm-sep` / disabled `.cm-item`
   (literal values, sheet doc doesn't load styles.css); context-menu width matches today's.
6. **No changes** to: main.js, manager, preloads, menu-controller.js, old chrome menu code
   (gate-OFF path untouched — deletions are Leg 5).

## Edge Cases

- **Params with zero sections** (right-click on plain page area): model = `[Inspect]` only (no
  leading separator) — unit case.
- **Right-click while any sheet menu is open** (including a second right-click while the
  context menu itself is open): the sheet swallows it → `outside-click` dismissal, nothing
  forwarded, no new menu (AC8 parity contract). A *subsequent* right-click (menu now closed)
  opens fresh with new params; `pageCtx` overwritten — old captured params must not leak into
  the new dispatch (token discipline covers the racing dismissed).
- **`returnFocus` element removed from DOM before Escape** (e.g. toolbar unpinned): guard
  `isConnected`/focusability, fall back to `els.address`.
- **Out-of-bounds / malformed `spell:` id, params gone by dispatch time** (tab closed between
  open and activate): validated no-op — never throw on stale dispatch; the wcId-captured calls
  already tolerate dead targets (`getTabContents`-style guards main-side).
- **Guest coordinate at the very top edge** (y≈0): point anchor y-floor 0 — menu flush at
  sheet top, parity with DD12.
- **Shift+F10 with a side panel open**: the guest region shrinks, so a chrome-element anchor
  can translate beyond the sheet's width → clamped to the sheet edge, away from the element
  (today's chrome-DOM menu could overlay the panel). DD12-class accepted variation — record,
  don't fix.
- **Guest page zoom (Ctrl+=) skews params.x/y vs CSS px**: shared with the old path (parity
  risk only) — HAT spot-check note, not a leg fix.
- **Two derivations during parallel-run (plain statement)**: the shared model builder AND the
  old DOM renderer's own section logic coexist until Leg 5 deletes the latter — mirrored unit
  assertions bridge them; do NOT refactor `buildPageContextSections` to consume the model.
- **Devtools toggle via Inspect on WSLg**: opens the devtools window — close it in the same
  step; don't leave it open across subsequent pixel grabs (it changes window composition).
- **Image save path**: `downloadMedia` is dialog-free (goes to the app's download dir) — safe
  live; only defer if the rig proves otherwise (record which).

## Files Affected

- `src/renderer/renderer.js` — gate branches ×4, channel-6 `page-context` case, refocus entry,
  audit hook
- `src/shared/page-context-model.js` (new) + `test/unit/page-context-model.test.js` (new)
- `src/renderer/menu-overlay.js` / `.css` — separator/note types, point-anchor clamp
- `tests/behavior/fixtures/menu-overlay/index.html` — minimal additions (mid-page link, image,
  editable, selection target) preserving the existing contract
- `tests/behavior/fixtures/menu-overlay/<name>.png` (new) — same-origin sibling image asset
  (served fixture asset, not a snapshot baseline — committable)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit
are deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (CP3-complete verdict + evidence paths in the flight log)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry — including the DD11 bookkeeping additions
  for the Leg-5 deletion inventory: `pageContextEntry`, `buildPageContextSections`,
  `positionPageContextMenu` + its offset translation, the `queueMicrotask` defer, the freeze
  call at the entry's onOpen, and all gate-OFF branches
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against the post-Leg-3 working tree on `flight/08-menu-overlay-sheet` (2026-07-02,
renderer.js 3,069 lines — all anchors re-derived fresh after Leg 3 shifted them):

- `src/renderer/renderer.js:63` `els.pageContextMenu`, `:689` `pageCtx`, `:693`
  `truncateLabel`, `:699` `basenameFromUrl`, `:714` `buildPageContextSections`, `:786`
  search-label truncation call, `:837` `positionPageContextMenu` (clamp `:851-856`),
  `:861-905` `pageContextEntry` (freeze `:877`, focusReturn `:893-901`), `:913-921`
  subscription (microtask defer `:921`), `:928-947` keyboard handler (lightbox `:931`, toolbar
  exclusion `:936`), `:955-965` `openToolbarContextMenu`, `:974-992`
  `openPageContextMenuForAudit` — **OK**
- `src/renderer/renderer.js:280-304` `openOverlayMenu` family, `:378-394` namespaced-id
  dispatch precedent — **OK**
- `src/main/main.js:1044-1048` guest `context-menu` forward, internal exclusion `:1047` —
  **OK**
- `src/renderer/menu-overlay.js:80-101` `positionNode` (point-anchor support present; clamping
  absent — this leg adds it) — **OK**

All clean; no drift.
