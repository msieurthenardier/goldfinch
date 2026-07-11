# Leg: page-relayout

**Status**: completed
**Flight**: [Per-Jar Data Controls](../flight.md)

## Objective

Rework `goldfinch://jars` from the flat row list into the settings-style
master-detail layout (DD1): dynamic left nav + one always-expanded section per jar,
instant-apply inline rename/recolor with focus preservation (DD6), the read-only
Burner section (DD7), "+ New jar" moved to the sidebar, and the edit mode deleted —
delete (with its existing confirm) still fully functional (CP2).

## Context

- Flight DD1 (layout), DD6 (instant apply + focus-preserving reconcile — this leg's
  hard requirement), DD7 (Burner section), DD5 partially (the `ui` state generalizes
  to `{ mode: 'create'|'confirm', rowId, action }` here; only `action: 'delete'`
  exists this leg — leg 3 adds the four data-action confirms to the same shape).
- The data-controls block: render it STRUCTURALLY this leg — a per-section container
  with one button per `JAR_DATA_CLASSES` descriptor (label from the descriptor) plus
  a "New identity" wipe button, all `disabled` — leg 3 enables and wires them
  (flight Technical Approach: "rendered from the DD2 list but wired in leg 3").
  Nothing is committed between legs 2 and 3, so the disabled state never ships.
- Leg 1 landed (uncommitted): `jar-data-classes.js` is page-loadable (script tag +
  INTERNAL_PAGES entry already in place); `JAR_DATA_CLASSES` / `jarDataClassById`
  are globals in the page's shared scope. Suite 1269/1269.
- The page controller is a single IIFE (`src/renderer/pages/jars.js`, 660 lines) —
  this leg is a substantial rewrite of its DOM half. The state half (broadcast-driven
  `state`, subscribe-then-boot-read, `normalizeDefaultId`) is CORRECT and stays.

## Inputs

- Leg 1 landed on the working tree (uncommitted).
- `src/renderer/pages/jars.{html,css,js}` as shipped by Flight 3 + leg 1's script
  tag.
- `src/renderer/pages/settings.{html,css,js}` as the layout/scroll-spy donor.

## Outputs

- `src/renderer/pages/jars.html` — nav + main skeleton (settings structure)
- `src/renderer/pages/jars.css` — master-detail layout, nav styles, section styles
- `src/renderer/pages/jars.js` — rewritten render half: keyed per-section
  reconcile, dynamic nav + scroll-spy, instant-apply editing, sectioned confirm,
  create-from-sidebar
- No main-process, preload, or shared-module changes in this leg

## Acceptance Criteria

### Layout and nav

- [x] `jars.html` body is `<nav aria-label="Jars">` + `<main>` (the settings.html
      structure — settings.css flexbox layout, adapted in jars.css). The nav
      contains: a dynamic `<ul id="jars-nav" role="list">` (one entry per jar-model
      row, INCLUDING Burner, in model order) and the `#jars-new` "+ New jar" button
      (moved from the header row). `<main>` keeps the `<h1>`, the F2/F5 description
      paragraph (verbatim copy unchanged), the page-level error line, the create
      panel container, and a `<div id="jars-sections">` replacing the old
      `<ul id="jars-list">`.
- [x] Each nav entry is an anchor `href="#jar-{id}"` showing the jar's color dot
      (isSafeColor-guarded, FALLBACK_COLOR else), name (textContent), and a compact
      default marker on the flag holder (Burner's entry carries it when
      `defaultId` is null). Nav rebuilds on every `jars-changed` render pass.
- [x] Scroll-spy: the section currently in view marks its nav link
      `aria-current="true"` — the settings.js IntersectionObserver pattern
      (settings.js:40-100: visible-set + first-in-document-order, rootMargin
      `0px 0px -50% 0px`), adapted to DYNAMIC sections: on each render pass that
      adds/removes sections, re-observe (disconnect + observe the fresh section
      list). Clicking a nav link scrolls to the section (native anchor behavior).
      **Scroll-container rule (review correction — the draft had this inverted)**:
      the DOCUMENT (`body`) owns the scroll, NOT `main` — settings.css:24-31's own
      comment explains why (`overflow:auto` on `main` is an axe
      scrollable-region-focusable violation unless it takes `tabindex="0"`). The
      nav is `position: sticky` with its own `overflow-y: auto`
      (settings.css:53-63); `main` carries NO overflow/height rule. Mirror that
      exactly.
- [x] Each persistent jar renders one always-expanded
      `<section id="jar-{id}" class="jar-section">` containing: a header line
      (color dot + `<h2>` name + Default pill when flagged), the inline name
      input, the swatch grid, a "Make default" text button (absent on the flag
      holder — F6 ruling: stays text), the disabled data-controls block (see
      Context), and the delete control. Section ids use the `jar-` prefix
      (`#jar-personal`) so store ids can never collide with static page ids.
- [x] The Burner section renders read-only (DD7): header line (dot + name +
      Default pill when `defaultId` is null) + the F4 hint copy (verbatim:
      "Burner is always available and keeps no history — its tabs evaporate on
      close.") — NO name input, NO swatches, NO make-default, NO data controls,
      NO delete. Structurally driven by `row.isBurner` (never `id === 'burner'`
      string checks in DOM code — the F3 convention).

### Instant-apply editing (DD6)

- [x] The edit mode is GONE: no pencil icon button, no `buildEditRow`, no
      `'edit'` ui.mode value anywhere. `ICON_EDIT` is removed (ICON_DELETE stays
      if the delete control keeps its icon — designer's presentation choice,
      see Edge Cases).
- [x] Name input semantics: value mirrors the store name; commits via
      `bridge.jarsRename({ id, name: trimmed })` on Enter and on blur, ONLY when
      `trimmed !== ''` and `trimmed !== ` the current store name (no-op edits and
      whitespace-only inputs never invoke — page-side trim remains the SOLE
      whitespace enforcement). A whitespace-only or empty input reverts to the
      store name on blur/Enter without invoking. Escape while focused in a name
      input reverts the value to the store name and blurs (and does NOT also
      dismiss an open transient — stopPropagation, the input-level Escape wins).
      Enter must not submit/navigate (preventDefault).
- [x] Swatch semantics: `buildSwatchGrid` (jars.js:139-175, reused as-is) with
      `getSelected` reading the CURRENT store color and `onSelect` invoking
      `bridge.jarsRename({ id, color })` directly (instant apply). The grid's
      own in-place `paint()` gives immediate feedback; the authoritative
      re-render arrives via the broadcast. `editColors` (jars.js:184-186) still
      supplies the 13th "current" swatch for palette-external legacy colors.
- [x] Focus preservation (the DD6 hard requirement): rendering reconciles
      per-section keyed by jar id — existing sections are UPDATED IN PLACE
      (header name text, dot colors, Default pill, make-default presence, swatch
      aria-checked, nav entry), new sections are inserted in model order, gone
      sections are removed. A name input that currently holds focus NEVER has
      its value overwritten by a render pass (sync it on blur instead); a
      broadcast re-render while typing must not steal focus, move the caret, or
      fire a spurious blur→commit. The old `listEl.textContent = ''` wholesale
      rebuild (jars.js:610) is gone.
- [x] Rename/recolor failure surfaces per-section (a small error line in the
      section, textContent-set, mirroring the F3 error-line idiom) and reverts
      the optimistic input/swatch state to the store value; invoke results are
      still success/failure signals ONLY (broadcast-before-resolve rendering rule
      unchanged — module doc comment jars.js:29-34 stays true).

### Transient state, create, delete

- [x] `ui` becomes `{ mode: 'create'|'confirm'|null, rowId, action, draft }` with
      exclusivity by wholesale replacement (unchanged principle). This leg's only
      confirm action is `'delete'`. `reconcileUi` collapses the confirm when its
      rowId disappears (same behavior, new shape).
- [x] "+ New jar" (now in the nav) toggles the create panel exactly as before
      (label flips to Cancel, aria-expanded) — the panel keeps its current form
      (name input + PALETTE grid + Create/Cancel + error line, page-side trim
      sole enforcement, close-on-success via broadcast). On open, the name input
      receives focus and the panel is scrolled into view.
- [x] **Create-panel focus survival (review correction — this property does NOT
      exist today and must be BUILT, not preserved)**: the current `render()`
      calls `renderCreatePanel()` unconditionally on every pass (jars.js:621) and
      `renderCreatePanel` wholesale-rebuilds the form (jars.js:465-466), so an
      unrelated `jars-changed` broadcast mid-typing destroys the create input's
      focus/caret — the same DD6 failure mode as the section inputs. This leg
      fixes it: the create panel is rebuilt ONLY on an actual ui-mode transition
      (open/close); state-only render passes leave the open panel's DOM
      untouched. Verifiable: with the panel open and text typed, a rename from
      the picker must not reset the input.
- [x] Delete: the per-section delete control opens the two-step confirm rendered
      INSIDE that jar's section (replacing the section's controls area or
      appended to it — not a separate row), with the F3 verbatim copy ("Deletes
      this jar and wipes its cookies, site storage, and cache. Open tabs in this
      jar will close."), Confirm-disables-once-clicked, error line, Cancel. On
      success the section + nav entry disappear via broadcast (no local close
      needed — reconcile handles it).
- [x] Escape dismisses ANY open transient (create or confirm) — the global
      handler (jars.js:586-588) survives, subject to the name-input Escape
      precedence above.

### Regression + gates

- [x] All F3-established behaviors still work by construction: set-default
      (per-section button → `jarsSetDefault`, page error line on failure),
      boot subscribe-then-read order (jars.js:644-655 unchanged), pagehide
      cleanup, CSP discipline (createElement + textContent only, no innerHTML
      with dynamic data, colors only via isSafeColor guard).
- [x] aria-live (FD ruling at design review): do NOT put `aria-live` on the
      sections container (it reconciles on every broadcast from any surface —
      announcement spam). Live regions are exactly: the existing
      `#jars-page-error` (already `aria-live="polite"`) and each section's own
      error line (`aria-live="polite"` per line — small, targeted, only speaks
      on that jar's failure). Visual state changes (rename, recolor, pill moves)
      are not announced — they are self-evident to the acting user and noise to
      everyone else.
- [x] Uniform focus rule (FD ruling, generalizing the name-input guard): ANY
      container currently holding `document.activeElement` is patched in place,
      never rebuilt — this covers name inputs (value sync skip), swatch grids
      (patch `aria-checked` in place when focused), and the nav (update entries
      in place when a nav link holds focus; wholesale rebuild is fine otherwise).
      One rule, three appearances — no per-widget carve-outs.
- [x] `npm test` green (1269+; this leg adds no unit tests — the page DOM is
      HAT-owned per DD9 — but must break none: jars-page-shared-scripts.test.js
      re-derives from jars.html and must still pass with the unchanged script
      list), typecheck green, lint green.

## Verification Steps

- `npm test`, typecheck, lint — all green.
- Static self-check of jars.js against the criteria: grep proves no `'edit'` mode
  string, no `buildEditRow`, no `ICON_EDIT`, no `listEl.textContent = ''`
  wholesale clear in the render path.
- Manual smoke (developer, no operator needed): launch dev build on a scratch
  profile (`XDG_CONFIG_HOME=<scratch> npm run dev`), open the jars page from the
  kebab, and verify: nav lists Personal/Work/Burner + New jar; sections always
  expanded; typing in a name field while adding a jar from the picker (second
  surface) does not steal focus; rename commits on blur; swatch click recolors
  live in picker + nav + section; delete confirm works end-to-end; Burner section
  is control-free. Tear the instance down after (kill the Electron main pid).

## Implementation Guidance

1. **HTML first** — transplant settings.html's body skeleton (nav + main) into
   jars.html; keep the head's script list byte-identical (the shared-scripts net
   derives from it). Keep static copy verbatim (description, hint) — the HAT
   already approved those strings.
2. **CSS** — adapt settings.css's nav/main FLEX layout (read the whole block from
   the scroll-container comment at settings.css:24 through :139) into jars.css
   under the existing jar-* class vocabulary; keep the swatch/button/form styles
   already shipped. The `aria-current` nav highlight and hover states follow
   settings.css:85-102. Drop jars.css's current single-column centering
   (`max-width: 760px; margin: 0 auto` at jars.css:41-45) — `main` becomes a flex
   sibling like settings' (FD ruling: match the settings dialect; cap line length
   with padding/max-width on main's CONTENT if needed, not by centering the
   column). Retire dead list-era CSS: `.jars-list`, `.jar-row`, `.jar-row-edit`,
   `.jar-row-confirm` and any other selectors whose DOM no longer exists — no
   dead rules survive the rewrite.
3. **jars.js render rework** — replace the rows loop with a keyed reconcile:
   maintain a `Map<id, { root, refs }>` of live sections (refs = the elements the
   update path touches: name h2, dot, input, pill slot, make-default slot, swatch
   grid container, error line, controls area). Update path mutates textContent/
   attributes/presence; build path constructs the section once. Insert new
   sections before the Burner section (model order is store order + Burner last).
   The nav rebuilds wholesale each pass UNLESS a nav link holds focus (uniform
   focus rule — patch entries in place in that case); don't disturb the document
   scroll position, and re-observe the scroll-spy only when the section SET
   changed.
4. **Name input wiring** — per section: `input` listener only tracks dirty state
   locally (no store writes); `keydown` handles Enter (commit) and Escape
   (revert + blur + stopPropagation); `blur` commits-or-reverts. After a
   successful commit the broadcast render syncs the (now unfocused) input.
   Guard the focused-input rule in the update path:
   `if (document.activeElement !== refs.input) refs.input.value = row.name;`.
5. **Swatch instant apply** — `buildSwatchGrid(editColors(row.color), () => currentColorFor(id), (color) => rename)` —
   note `getSelected` must read live state (closure over id, not a snapshot).
   Update path: apply the uniform focus rule (AC) — if the grid holds
   `document.activeElement`, patch `aria-checked`/selected classes in place;
   otherwise rebuilding the grid on store-color change is fine (the 13th-swatch
   membership can change).
6. **Scroll-spy module** — lift settings.js's IIFE logic into a small function
   `observeSections(sections)` owned by jars.js (do NOT import settings.js);
   disconnect the prior observer before re-observing. Sections and nav links are
   both derived from the same model pass, so the linkMap is rebuilt alongside.
7. **Data-controls placeholder** — a `.jar-data-controls` container per persistent
   section: one disabled button per `JAR_DATA_CLASSES` entry (`textContent` =
   `Clear ${label.toLowerCase()}` or the label itself — pick one and keep it for
   leg 3) + a disabled "New identity" button. No handlers this leg.
8. **Self-check greps, then gates.**

## Edge Cases

- **Two jars, same display name**: sections/nav key by id — no collision; the HAT
  may show identical labels, which is store-accurate.
- **Jar deleted from another surface while its name input is focused**: the
  reconcile removes the section (focus drops to body — acceptable; this is the
  R2b HAT scenario, deliberately exercised at leg 5).
- **Jar deleted from another surface while its confirm is open**: `reconcileUi`
  collapses the transient (existing F3 behavior, preserved).
- **Create panel open + broadcast arrives**: see the dedicated acceptance
  criterion — this survival property must be BUILT this leg (today's code rebuilds
  the panel every render pass; the F3 code does NOT already have it).
- **Delete-control presentation**: sections give room for a labeled danger button;
  the F6 icon ruling was made for cramped ROWS. Designer's default: a compact
  danger button labeled "Delete jar…" (trash icon optional inside it). This is an
  Acceptable Variation (flight) — the HAT adjusts if the operator prefers icons.
- **Burner-only registry** (all persistent jars deleted): main shows just the
  Burner section (with Default pill); nav shows Burner + New jar; create flow
  still works.
- **Anchor navigation on a fresh load with a hash**: not required — entry points
  never link to a specific jar; don't build hash-restore logic.

## Files Affected

- `src/renderer/pages/jars.html` — body restructure
- `src/renderer/pages/jars.css` — layout rework
- `src/renderer/pages/jars.js` — render-half rewrite

## Citation Audit

Verified at leg design time (2026-07-10), all read live this session:
`jars.js:29-34` (broadcast-before-resolve doc), `:37-46` (element grabs — the
grabbed id set changes this leg), `:100-106` (state/ui shapes), `:139-175`
(buildSwatchGrid — reused), `:184-186` (editColors), `:200-294` (buildRow —
replaced by sections), `:304-387` (buildEditRow — deleted), `:397-458`
(buildConfirmRow — adapted into the section confirm), `:464-546` (create panel —
kept, relocated trigger), `:553-561` (openEdit deleted / openConfirmDelete
adapted), `:586-588` (global Escape), `:599-603` (reconcileUi), `:606-622`
(render — rewritten; `:610` wholesale clear removed), `:633-659` (normalize/boot/
subscribe/pagehide — unchanged); `jars.html:16-20` (script list — must stay
byte-identical), `:24-38` (header + description copy), `:44-52` (error line,
create panel, list); `settings.js:40-100` (scroll-spy donor);
`settings.css:32-139` (layout donor ranges), `:85-102` (nav link states). All OK.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (suite + typecheck + lint)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit — the flight uses deferred review (review + commit after leg 3)
