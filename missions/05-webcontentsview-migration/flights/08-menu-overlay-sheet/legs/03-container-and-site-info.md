# Leg: container-and-site-info

**Status**: completed
**Flight**: [Menu Overlay Sheet](../flight.md)

## Objective

Migrate the two dynamic-model surfaces — the **container picker (▾)** and the **site-info popup
(🔒)** — onto the sheet behind the gate, and **fix the confirmed-broken `#new-container-dialog` by
rendering it as a sheet surface** (FD decision, pending operator ratification at the Leg-6 HAT —
see Decision note below). Extends the sheet's model protocol with non-menu templates (info rows,
a text-input dialog) and a `value` field on channel 4. Old chrome paths stay fully functional
with the gate OFF (parallel-run). **CP3 (partial)**: three of five surfaces render from the sheet
behind the gate with correct dynamic models; the rest (page context + unpin) land in Leg 4.

## Context

- **Decision — `#new-container-dialog` disposition (Leg-3 operator call, flight Open Question)**:
  the flight left "fix via sheet" vs "accept-and-record" to the operator. Asked at design time;
  no response within the window → FD proceeded with **fix via the sheet** (the flight's own
  "parity-plus-correctness" framing; the operator independently confirmed the defect matters —
  "the new container dialog is broken", 2026-07-02). Scope kept isolated: the dialog is one
  additional sheet surface; if the operator prefers accept-and-record at the HAT, deleting the
  `new-container` menuType branch + restoring the item's old handler is a contained revert.
- **Defect being fixed**: the dialog is chrome DOM (`src/renderer/index.html:58-67`,
  `role="dialog" aria-modal`), `position:fixed; inset:0` (`styles.css:1351+`), shown AFTER
  `closeContainerMenu()` (`renderer.js:391-392` — inside the "+ New container…" item handler).
  The live guest view composites above the chrome view in the guest region, so the centered
  dialog box is occluded — pre-existing, not freeze-related (design-review finding, operator
  confirmed).
- **DD10 (flight)**: menus sized by CSS inside the sheet; the container menu is naturally
  narrower (operator preference); long dynamic lists get `max-height` + internal scroll, not
  unbounded growth.
- **DD2/DD12 anchors**: container menu anchors LEFT-aligned at the ▾ trigger
  (`els.newTabMenu.getBoundingClientRect().left` today, `renderer.js:396`); site-info
  LEFT-aligned at the address chip (`positionSiteInfoPopup`, `renderer.js:427-432`). Both are
  toolbar-anchored → translate chrome→sheet (subtract guest-region origin) with y clamped to 0
  (flush at sheet top — the accepted ~4px shift).
- **Leg-2 machinery reused as-is** (no manager/protocol changes except the channel-4 `value`
  field): per-menuType chrome state map `overlayMenus` (`renderer.js:232-235`), open path
  (`menuOverlayOpen` call shape, `renderer.js:267-273`), channel 6/7 subscriptions
  (`renderer.js:314`, `:328`), suppress window + token discipline (generic per-menuType),
  model-replace mutual exclusion (manager `openMenu`), close family, DD5 find interplay, DD13
  forwarding — all already generic.
- **Container menu today** (gate-OFF path, stays): entry `renderer.js:354-411` (model built
  per-open from `containers` — jar items + burner + "+ New container…", `innerHTML` with
  `escapeHtml`, freeze calls), trigger click toggle `renderer.js:1274-1275`, `containers` array
  seeded ONCE at startup from `jarsList()` (`renderer.js:113-119`) — **there is no runtime
  jar-list refresh in the product** (no jars broadcast; `jarsAdd` has no renderer call site; no
  MCP jars tool): the sheet model builder reads the SAME array the old menu reads — parity, not
  live-refresh (design-review correction). Items carry a color dot (`cm-dot` span with inline
  `background`) — the sheet model carries `color` as DATA; the sheet sets it via
  `style.background` on a dedicated dot element after validating against the SAME color domain
  the product accepts: extract `isSafeColor` (`src/main/jars.js:16-20` — 3/4/6/8-digit hex OR
  letters-only keyword) to `src/shared/` and reuse it in both places (a stricter sheet-side
  rule would silently render fallback dots for legal colors — parity divergence). Invalid →
  default dot `#9aa0ac` (the DEFAULT_CONTAINER grey). Note the property-assignment path cannot
  inject sibling declarations regardless — the validation is defense-in-depth.
- **Site-info today** (gate-OFF path, stays): `buildSiteInfo(tab)` (`renderer.js:435-484`) —
  internal note variant OR host/Connection/Trackers/Permissions rows + "Site settings →" button;
  entry registered WITHOUT an items getter (`renderer.js:487-509` — controller roving no-ops;
  popup supplies its own Escape/Tab keydown `renderer.js:521-527`); chip click toggle
  `renderer.js:516-518`.
- **Sheet page today (post-Leg 2)**: `menu-overlay.js` (164 lines) validates
  `{menuType, model: Array, startIndex, token}` (`menu-overlay.js:108-110`), renders
  `role="menu"`/`role="menuitem"` buttons per item, `MENU_LABELS` per-menuType aria-label map
  (`:49`), APG via the shared `menu-controller.js`, reason attribution (default-blur), one-send-
  per-token. This leg generalizes rendering to **templates keyed by menuType** while keeping the
  model an array (empty allowed for fixed templates).
- **Channel-4 extension**: `menu-overlay:activated` gains optional `value: string` (the dialog's
  input text; length-capped at 24 to match the input's `maxlength`, `index.html:61`). Main
  validates shape (string, ≤24) before forwarding on channel 6; chrome treats it as data
  (existing `newContainerCreate` path validates the name, `main.js:1778`).
- **New-container flow (sheet-era, gate ON) — activated-close-then-fresh-open (design-review
  decision)**: container menu item `new-container` activates → main's channel-4 handler runs
  `closeMenuOverlay('activated')` (sheet hides, channel 7 `reason:'activated'`, `focusChrome`)
  → forwards channel 6 → chrome's handler immediately re-opens menuType `new-container` as a
  **fresh open** (normal `openMenu` path — `currentMenu` is null by then). This is NOT
  model-replace and a one-IPC-round-trip hide/re-show blink is accepted: the Leg-2
  manager/handler machinery stays frozen (worth more than eliminating a blink on a rare flow),
  and freeze-era behavior was strictly worse (menu fully closed, dialog appeared occluded).
  Two knock-on effects, accepted and recorded: (a) transient focus bounce (main→chrome→sheet;
  final focus lands in the dialog input — correct); (b) with a live find session,
  `restoreFindOverlay('activated')` re-shows the find bar for the round trip and the re-open
  hides it again — a rare cosmetic flash, HAT observes. Live check: the blink must be
  imperceptible-or-minor on grabs (a stuck intermediate state is a defect; a transient one is
  the accepted variation). Dialog template: label + text input (maxlength 24) + Create/Cancel,
  `role="dialog"` `aria-modal="true"` inside the sheet document, **centered via CSS** (the
  dialog template ignores the anchor — parity with today's centered card). Enter or Create →
  channel 4 `{id:'create', value, token}` → chrome runs the shared `submitDialog` body
  (`newContainerCreate` → push + `createTab`, `renderer.js:2889-2899`); empty-after-`trim()`
  value → no-op page-side, dialog stays open (the guard MUST live in the sheet page — main
  closes on any activated send, so a whitespace send would close-without-creating;
  parity trim at `:2890`). Escape / outside-click / Cancel (Cancel sends
  `dismissed{reason:'escape'}` — user-explicit, focus back to ▾) → close, no jar. Tab cycles
  input→Create→Cancel (dialog-local; Tab attribution to `'escape'` is template-conditional —
  menus only).
- **Gate-OFF parity**: the chrome dialog (`initNewContainerDialog`, `renderer.js:2877-2911`) and
  both old menus stay untouched on the no-gate path. The old dialog DOM/CSS is deleted at Leg 5
  cutover (add to the DD11 deletion inventory) — not here.
- Deferred: page context menu + toolbar-unpin (Leg 4); cutover/deletions + a11y audit extension
  (Leg 5); Witnessed runs + HAT ratification of the dialog decision (Leg 6).

## Inputs

- Legs 1–2 landed (uncommitted): manager with `openMenu`/`closeMenuOverlay`/tokens, chrome
  `overlayMenus` infrastructure, sheet renderer + APG + reason attribution, DD13 forwarding, DD5
  wiring.
- Anchors (fresh, post-Leg-2 tree): `src/renderer/renderer.js` — `:232-235` `overlayMenus`,
  `:242` `kebabModel`, `:267-273` open call, `:314`/`:328` subscriptions, `:350-414` container
  entry (+`:391-392` dialog open), `:427-432` `positionSiteInfoPopup`, `:435-484`
  `buildSiteInfo`, `:487-527` site-info entry + keydown, `:516-518` chip toggle, `:1274-1275`
  ▾ toggle, `:2877-2911` `initNewContainerDialog`; `src/renderer/index.html:58-67` dialog
  markup; `src/renderer/styles.css:1351` dialog CSS block; `src/renderer/menu-overlay.js:49`
  `MENU_LABELS`, `:108-126` init validation/render; `src/main/main.js:1778`
  `new-container-create` handler; `src/preload/menu-overlay-preload.js:20` `sendActivated`.
- Apparatus: as Legs 1–2 (free-port SDK client workaround, wiring litmus, capture canary,
  probed sheet wcId, `pressKey`/`readDom`/`evaluate`).

## Outputs

- Modified: `src/renderer/renderer.js` (gate-branches for ▾ and 🔒 triggers, `containerModel()`
  builder, `deriveSiteInfo` extraction + both renderers, `new-container` open-on-activated flow
  + shared `submitDialog` body reuse, refocus map entries), `src/renderer/menu-overlay.{js,css,
  html}` (per-template controller entries + hoisted token/attribution state; templates `menu` /
  `info-popup` / `input-dialog`; container dot styling; max-height scroll; dialog Tab-cycle +
  input handling), `src/main/main.js` (channel-4 `value` validation via extracted helper),
  `src/main/jars.js` (re-point at the extracted shared `isSafeColor`), preload JSDoc/type
  updates only.
- New: `src/shared/safe-color.js` (extracted `isSafeColor`, dual-export),
  `deriveSiteInfo` (dual-export, in `src/shared/` or renderer-adjacent per repo convention),
  the channel-4 value helper; unit tests for all three.
- Behavior: gate ON → kebab + container + site-info + new-container dialog all render from the
  sheet over the live guest; gate OFF → today's behavior bit-for-bit (including the broken
  chrome dialog — the fix exists only on the sheet path until cutover).

## Acceptance Criteria

- [x] **AC1 — Container menu on the sheet (gate ON).** ▾ click/keyboard opens menuType
  `container` with a model rebuilt per-open from the SAME `containers` array the old menu reads
  (+ Burner + "+ New container…"), left-aligned at the translated ▾ anchor, flush at the sheet
  top. Color dots render from model data via style property with the shared `isSafeColor`
  validation (no markup injection; labels `textContent`; invalid color → `#9aa0ac` default
  dot). Jar items and Burner activate → channel 4→6 → the SAME tab-creation bodies as today. A
  container created THROUGH THE NEW DIALOG (AC4) appears on the next open — the per-open
  rebuild made observable without inventing a runtime-refresh feature the product doesn't have
  (parity, per design review).
- [x] **AC2 — Long-list scroll (DD10).** With enough containers to exceed the cap — seeded via
  the dialog (AC4 flow, repeated) and/or the apparatus recipe `evaluate` on chrome:
  `window.goldfinch.jarsAdd({name,color}).then(c => containers.push(c))` (works: `containers`
  is a top-level `let`) — the menu caps at its CSS `max-height` with internal scroll; keyboard
  roving scrolls the focused item into view; no unbounded growth, no sheet overflow.
- [x] **AC3 — Site-info on the sheet (gate ON).** 🔒 chip toggle opens menuType `site-info`
  rendering the info-popup template: web tab → host / Connection / Trackers blocked /
  Permissions rows + "Site settings →" action; internal tab → the secure-page note (DD7: sheet
  over internal views — verify on `goldfinch://settings`). Values come from the same tab state
  as today (`buildSiteInfo` logic extracted/shared, not duplicated). "Site settings →"
  activates → the existing settings-navigation body runs. Escape closes with focus back on the
  chip (keystroke-corroborated); **Tab dismisses with the `'escape'` flavor too** (parity:
  today Tab closes AND refocuses the chip, `renderer.js:524-530` — an unattributed Tab would
  default to `'blur'` and silently drop the refocus); outside-click closes without focus
  theft. No APG roving (no `role="menu"`); Escape/Tab handled by the popup template's local
  keydown (only the input-dialog owns Tab-cycling).
- [x] **AC4 — New-container dialog on the sheet (gate ON) — the fix.** Activating
  "+ New container…" closes the container menu (`reason:'activated'` — the normal channel-4
  path) and chrome immediately re-opens menuType `new-container` as a fresh open; the
  one-round-trip blink is the accepted variation (live check: transient only, no stuck
  intermediate frame). The dialog renders **centered, visibly over the live guest** (pixels —
  this is the defect being fixed), input focused, `maxlength=24`. Enter/Create with a
  non-whitespace name → channel 4 `{id:'create', value}` → jar created, container appended,
  tab opened in it (shared `submitDialog` body). Empty-after-trim name → page-side no-op
  (dialog stays open — guard lives in the sheet page). Escape/Cancel/outside-click → closes,
  no jar created; Escape/Cancel return focus to the ▾ trigger. Tab cycles input → Create →
  Cancel → input (template-conditional Tab handling — no `'escape'` attribution for the
  dialog).
- [x] **AC5 — Channel-4 `value` hardening.** Main validates `value` via an extracted pure
  helper (string, length ≤ 24) before forwarding on channel 6; non-string/oversize dropped
  (payload otherwise forwarded without `value`); sender validation unchanged. The helper is
  unit-covered (the ipcMain handler itself is not unit-testable — test the pure part).
- [x] **AC6 — Mutual exclusion + close family across the three sheet surfaces.** Kebab open →
  ▾ click swaps to container (superseded, no flicker); container open → 🔒 swaps to site-info;
  dialog open → tab-switch/Ctrl+W/blur close it via the existing family (no jar created,
  chrome state resets, find-bar interplay per DD5). Suppress window works per-menuType
  (closing container via trigger-blur then immediately clicking the ▾ again doesn't blink;
  clicking the KEBAB within 300 ms still opens — same-menuType-only).
- [x] **AC7 — Gate-OFF parity.** All three surfaces (and the chrome dialog, including its broken
  occlusion) behave exactly as today; no `menu-overlay:*` traffic.
- [x] **AC8 — Unit + gates.** New/extended tests: `value` validation; template-registry
  rendering paths if extracted pure (else covered live); `npm test`, `npm run typecheck`,
  `npm run lint` green. Existing suites untouched and green.

## Verification Steps

- Apparatus preamble as Legs 1–2 (litmus + canary; evidence under
  `/tmp/behavior-tests/goldfinch/menu-overlay-cp3/<ts>/`).
- AC1: gate-ON instance → `evaluate` ▾ click → grab (menu over live ticking guest, left-anchored)
  + `readDom(sheetWcId)` (items = Default + Burner + New container…); create a container via the
  AC4 dialog → reopen ▾ → it's listed (per-open rebuild observable); activate a jar item
  (pressKey Enter) → new tab in that jar (`enumerateTabs` partition/jar corroboration).
- AC2: seed ~8 containers (AC4 dialog repeats and/or the `evaluate` recipe
  `window.goldfinch.jarsAdd({name,color}).then(c => containers.push(c))`) → open → grab (capped
  height) + pressKey ArrowDown to the last item → `readDom`/`evaluate` scrollTop > 0 in the
  sheet menu box.
- AC3: web tab → 🔒 → grab + `readDom(sheetWcId)` rows match `enumerateTabs`/tab state;
  "Site settings →" Enter → settings tab at `#privacy`; internal tab → 🔒 → secure-note variant
  over the internal view (grab). Escape → chip focused (keystroke corroboration as Leg 2).
- AC4: ▾ → ArrowDown to "+ New container…" → Enter → grab: **dialog centered, visible over the
  live guest** (the fix, on pixels; a consecutive-grab pair around the chained open confirms
  the blink is transient, no stuck intermediate); type "Shopping" (typeText on sheet wcId) →
  Enter → `enumerateTabs` shows a new tab in a new jar named Shopping; reopen ▾ → Shopping
  listed. Whitespace-only name → Enter → dialog still open, no jar. Cancel path: reopen dialog
  → Escape → no new jar (`jarsList` via evaluate unchanged), ▾ focused
  (keystroke-corroborated).
- AC5/AC8: `npm test` (+ the new cases), typecheck, lint.
- AC6: scripted sequence per the AC; verify no flicker via consecutive grabs (menu A frame →
  menu B frame, sheet never absent between).
- AC7: gate-OFF relaunch → ▾/🔒/dialog behave as today (dialog occlusion still present —
  expected; grab for the record).

## Implementation Guidance

1. **Sheet template registry (`menu-overlay.js`) — acknowledged restructure (design review:
   this is the leg's largest sheet-side change, not a gloss)**: key by menuType →
   `menu` (existing path: kebab, container — items array, APG roving),
   `info-popup` (site-info: `[{type:'note',text} | {type:'row',label,value} |
   {type:'action',id,label}]`), `input-dialog` (new-container: fixed layout, model may be
   empty). **Every template registers a `menuController` entry and is opened via
   `menuController.open`** — info-popup and input-dialog register WITHOUT an `items` getter
   (the controller's `!entry.items` guard no-ops roving for them, exactly the chrome
   site-info pattern), so the controller's global pointerdown/window-blur listeners deliver
   outside-click/blur dismissal uniformly for all three (an unregistered dialog would dangle
   on sheet-blur). The single-entry closure state (`currentToken`/`sent`/`lastStimulus` and
   the capture-phase attribution listeners) hoists to module scope shared across the three
   entries; Tab attribution ('escape' flavor) applies to `menu` templates only —
   the input-dialog's local keydown owns Tab-cycling. Loosen init validation minimally
   (model stays an Array; empty allowed). Container items carry `{id, label, color?}` — dot
   span gets `style.background` only after the shared `isSafeColor` check (see Context);
   invalid → `#9aa0ac`. All text via `textContent` (DD8).
2. **Anchors**: extend the Leg-2 anchor translation helper for left-aligned surfaces:
   `{ alignLeft: Math.round(r.left - wv.left), y: 0 }` (▾ and 🔒); sheet CSS positions
   `left: alignLeft` (kebab keeps `alignRight`). Clamp `alignLeft ≥ 0`.
3. **Chrome model builders (renderer.js)**: `containerModel()` mirrors the per-open build
   (`containers` map + burner + new-container item; plain strings — the sheet renders text, so
   raw names are correct data); `siteInfoModel(tab)` extracts the `buildSiteInfo` DERIVATION
   (host/connection/trackers/permissions or internal-note) into a **genuinely pure,
   dual-export, unit-tested** function (`deriveSiteInfo` — cover: fresh-tab `'—'` host
   fallback, HTTP vs HTTPS, trackers/permissions defaults, internal-note branch) shared by
   both paths — the old path keeps its innerHTML renderer consuming the same derived values
   (one derivation source, two renderers during parallel-run; AC7's parity claim becomes
   unit-pinned, not behavior-only).
4. **Gate branches**: mirror the Leg-2 kebab pattern exactly for ▾ (`renderer.js:1274-1275`
   toggle + trigger keydown; do NOT register `containerEntry` when gated) and 🔒
   (`:516-518` toggle; ALSO mirror the controller's trigger-keydown opener for the chip —
   Enter/Space/ArrowDown open the popup today via `menu-controller.js:41-51`; `startIndex` for
   the no-items popup means "focus the Site settings → action" — parity with today's
   first-button focus). Register both in `overlayMenus` with their trigger getters. Note for
   the Leg-5 a11y pass: the generic channel-7 handler sets `aria-expanded` on the chip, which
   the old path never did (chip has `aria-haspopup="dialog"`) — deliberate improvement, record
   as such so it doesn't read as drift.
5. **New-container flow — NAMESPACED ids (round-2 catch)**: the container model's id space
   must be namespaced — jar items as `jar:<jarId>`, sentinels as `action:new-container` /
   `action:burner` — because `jars.slug()` maps a user-created jar named "New Container" to id
   `new-container` (and "Burner" → `burner`), and this leg's dialog makes those names
   reachable: flat-id dispatch would re-open the dialog (or open a burner) instead of the
   user's jar. Dispatch on the prefix in the channel-6 `container` case; unit/edge-case the
   collision (jar literally named "New Container" opens a tab in THAT jar). In the channel-6
   handler, `case 'container'` with `id === 'action:new-container'` → open `'new-container'`
   via the SAME chrome open path as a
   trigger-initiated open (fresh token; suppress/aria bookkeeping uniform; anchor value is
   passed but the dialog template ignores it and centers via CSS). `case 'new-container'`:
   `id === 'create'` → run the shared `submitDialog` body with `value` (extract
   `renderer.js:2889-2899` into a named function used by both the chrome dialog and this
   handler). Cancel is sheet-initiated: the Cancel button sends `dismissed{reason:'escape'}`
   (user-explicit like Escape — focus returns to the ▾ trigger). Document in the sheet
   template.
6. **Dialog template (`menu-overlay.js/.css/.html`)**: container div `role="dialog"`
   `aria-modal="true"` `aria-label="New container"`, label + input (`maxlength=24`) + Create +
   Cancel; local keydown: Enter→create-send (guard empty), Escape→dismiss-escape, Tab/Shift+Tab
   cycle the three focusables (dialog-local trap — the sheet page has nothing else focusable);
   input focused on init (after the manager's focus-after-init lands on the webContents).
   One-send-per-token guard covers create-vs-dismiss races.
7. **Channel-4 `value`**: both preloads already pass payloads whole (type/JSDoc updates only —
   design-review correction: no functional preload edit exists). Main validates via an
   **extracted pure helper** (e.g. `sanitizeActivatedValue(value): string|undefined` —
   `typeof value === 'string' && value.length <= 24`, else undefined/dropped) and forwards
   inside the channel-6 payload; the helper is the unit-test target (the main.js handler
   itself isn't unit-testable). The manager never touches channel 4 — no manager change, no
   manager test for this.
8. **DD11 bookkeeping**: add the chrome dialog DOM/CSS + `initNewContainerDialog` to the Leg-5
   deletion inventory (note in this leg's flight-log entry; Leg 5's design picks it up).

## Edge Cases

- **Dialog modality is guest-region-scoped (DD12 consequence, accepted variation)**: the old
  chrome dialog's full-window dimmed backdrop blocked toolbar clicks; the sheet dialog covers
  the guest region only — toolbar clicks blur-dismiss it AND perform their action (e.g. ▾
  re-click dismisses and opens the container menu), and any dim covers the guest region only.
  Record for the HAT so it isn't read as a defect. Sheet-region dim optional per template CSS.
- **Sentinel-id collision** (round-2 catch): a jar literally named "New Container" or "Burner"
  must activate as a JAR (namespaced ids per guidance step 5) — unit-covered.
- **Find-bar flash on the dialog's chained open** (find session live → "+ New container…"):
  `restoreFindOverlay('activated')` re-shows the bar for one IPC round trip, the re-open hides
  it — rare, cosmetic, ACCEPTED (recorded here; HAT observes). Do not plumb a suppression for
  this.
- **Dialog open when `containers` changes underneath** (apparatus `jarsAdd` push mid-dialog):
  harmless — creation appends; duplicate names allowed today (`jars.add` semantics unchanged).
- **`newContainerCreate` returns null/rejects** (validation failure): parity with today's
  `if (c)` guard — no tab, no push; dialog already closed (matches current UX: `closeDialog()`
  runs before the await, `renderer.js:2892-2894`).
- **Site-info on a tab with no URL yet** (fresh tab): `buildSiteInfo` host try/catch → '—'
  (existing behavior; the shared derivation keeps it).
- **Rapid ▾→🔒→kebab swaps**: model-replace chain; each superseded close resets its trigger
  state; tokens strictly increase — the Leg-2 discipline needs no changes; verify once live.
- **Color value from a hostile/edge container name vs color**: names are text (safe via
  textContent); `color` is validated hex before touching `style` — a non-hex color renders a
  default dot, never a style-string injection.
- **Scroll + roving**: `focusItem` focuses; browser scrolls focused element into view natively
  inside the `max-height` box — no custom scroll code unless live check shows otherwise.
- **Dialog Tab-trap vs APG**: `input-dialog` template does NOT register APG roving (no
  `role="menu"`); its local keydown owns Tab — the shared controller's menu-keydown guard
  (`!entry.items → return`) already no-ops (same pattern as chrome's site-info today).

## Files Affected

- `src/renderer/renderer.js` — gate branches (▾, 🔒 incl. trigger keydown), model builders,
  `deriveSiteInfo` consumption in both renderers, shared `submitDialog` extraction, channel-6
  cases, refocus entries
- `src/renderer/menu-overlay.js` / `.css` / `.html` — per-template controller entries + hoisted
  attribution state, templates (menu / info-popup / input-dialog), container dot + scroll CSS,
  dialog markup/behavior
- `src/shared/safe-color.js` (new) — extracted `isSafeColor`; `src/main/jars.js` requires the
  shared module and KEEPS `isSafeColor` in its own `module.exports` (re-export, not move —
  `test/unit/jars.test.js:7` requires it from `src/main/jars`); renderer eslint-globals list
  (`eslint.config.mjs:46-48`) gains `isSafeColor` (+ `deriveSiteInfo` if renderer-global)
- `deriveSiteInfo` + channel-4 value helper (new, dual-export where consumed cross-context)
- `src/main/main.js` — channel-4 `value` validation + forward
- `src/preload/*` — JSDoc/type updates only
- `test/unit/*` — safe-color, deriveSiteInfo, value-helper suites

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit
are deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (CP3-partial verdict + evidence paths in the flight log,
  including the dialog-fix pixel evidence)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry (note the DD11 addition: chrome dialog
  DOM/CSS + `initNewContainerDialog` join the Leg-5 deletion inventory)
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against the post-Leg-2 working tree on `flight/08-menu-overlay-sheet` (2026-07-02, all
anchors re-derived fresh after Leg 2 shifted renderer.js):

- `src/renderer/renderer.js:232-235` `overlayMenus` state map, `:242` `kebabModel`, `:267-273`
  `menuOverlayOpen` call, `:314` / `:328` channel 6/7 subscriptions — **OK**
- `src/renderer/renderer.js:113-119` one-shot `containers` seed from `jarsList()` (review
  corrected — an earlier draft mis-cited `:263-271`, which is now the gate-ON kebab open path)
  — **OK**
- `src/renderer/renderer.js:350-414` container entry (dialog open at `:391-392`), `:427-432`
  `positionSiteInfoPopup`, `:435-484` `buildSiteInfo`, `:487-530` site-info entry + local
  keydown (review: keydown block ends `:530`, ±3 tail drift repaired), `:516-518` chip toggle,
  `:1274-1275` ▾ toggle — **OK**
- `src/main/jars.js:16-20` `isSafeColor` (3/4/6/8-digit hex + letters-only keywords) — **OK**
- `src/renderer/menu-controller.js:41-51` trigger-keydown opener (chip keyboard parity),
  `:58` `!entry.items` guard, `:114-123` global dismissal listeners — **OK**
- `src/renderer/renderer.js:2877-2911` `initNewContainerDialog` (submit body `:2889-2899`,
  empty-name guard `:2891`, close-before-await `:2892-2894`) — **OK**
- `src/renderer/index.html:58-67` dialog markup (`maxlength=24` at `:61`) — **OK**
- `src/renderer/styles.css:1351` `.new-container-dialog` block — **OK**
- `src/renderer/menu-overlay.js:49` `MENU_LABELS`, `:108-126` init validation + render — **OK**
- `src/preload/menu-overlay-preload.js:20` `sendActivated` — **OK**
- `src/main/main.js:1778` `new-container-create` handler, `:2247` `jars-add` — **OK**

All clean; no drift.
