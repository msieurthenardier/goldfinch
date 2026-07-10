# Leg: page-crud-interactions

**Status**: completed
**Flight**: [Jar Management Page](../flight.md)

## Objective

The `goldfinch://jars` page becomes fully interactive: create a jar (name + curated
palette), rename/recolor an existing jar, move the default flag, and delete a jar
behind an in-page two-step confirmation — with the Burner row exposing no controls.

## Context

- **DD4**: curated palette only — a frozen array of ~12 hex swatches exported from
  `src/shared/jar-page-model.js` (each pinned by `isSafeColor` in a unit test),
  rendered as a swatch grid in the create and recolor flows. The store still clamps
  (`cleanColor`, jars.js:80) — the palette is UX, not enforcement.
- **DD5**: rename carries the `{name, color}` patch through `jarsRename` (there is
  no separate recolor API; id/partition immutable and NOT surfaced). Delete is an
  in-page two-step confirm naming the consequences ("wipes cookies, site storage,
  and cache; closes its open tabs") — no native dialog (CSP-safe), explicit
  Confirm/Cancel, keyboard-reachable. Burner renders no edit/delete/set-default
  controls (mission invariant).
- **Leg 1 outputs (all uncommitted on this branch)**: the full internal bridge —
  `window.goldfinchInternal.jarsList/jarsAdd/jarsRename/jarsRemove/jarsSetDefault/
  jarsGetDefault` + `onJarsChanged`/`offJarsChanged`; `buildJarPageModel(containers,
  defaultId)` in `src/shared/jar-page-model.js`; the read-only page
  `src/renderer/pages/jars.{html,css,js}` (single IIFE, subscribe-then-boot-read,
  wholesale re-render, textContent-only, aria-live list); the self-deriving vm
  shared-scope net `test/unit/jars-page-shared-scripts.test.js` (auto-covers this
  leg's jars.js changes for parse-time collisions). Suite baseline 1180/1180.
- **This leg touches NO main-process or preload code** — the bridge is complete.
  Expected surface: jars.{html,css,js}, jar-page-model.js (+ its test), AND the
  d.ts/eslint entries, which are REQUIRED, not optional (design-review cycle 1
  empirically proved both gates fail on a bare `PALETTE` reference): jars.js is a
  classic script with no module system, so `PALETTE` is reachable only as a bare
  global — add `declare const PALETTE: readonly string[]` to renderer-globals.d.ts
  (precedent: `declare const BURNER` at :344) and `PALETTE: 'readonly'` to the
  `src/renderer/**/*.js` globals block at eslint.config.mjs:45.
- **Store semantics the UI leans on (all Flight 1/2-pinned)**: `add` derives id
  from name with collision suffixing and auto-claims default into an empty registry;
  `rename` of unknown id returns null; `setDefault` is idempotent-true on the
  current holder and false on unknown ids; `remove` of the flag-holder repairs the
  flag (next jar, else null ⇔ Burner); every mutation broadcasts `jars-changed`.
- **Broadcast/UI-state interaction (F2-observed)**: the `jars-changed` broadcast can
  arrive BEFORE the mutating invoke resolves (renderer.js:2710-2716 documents this
  for the picker). The page must not depend on invoke-then-render ordering: render
  only from broadcast/boot state, treat invoke results as success/failure signals.

## Inputs

- Leg 1 landed (uncommitted): bridge + read-only page + model module as above.
- Suite 1180/1180; typecheck/lint clean.

## Outputs

- Interactive page: create / rename / recolor / set-default / delete-with-confirm.
- `PALETTE` exported from jar-page-model.js (dual-export, frozen).
- Extended truth-table tests; suite green.

## Acceptance Criteria

- [x] `jar-page-model.js` exports a frozen `PALETTE` (10-14 hex entries, distinct,
      first entry a sensible default-new-jar color); unit test pins: every entry
      passes `isSafeColor`, array frozen, entries unique. If the row model needs an
      editability flag is needed, use the EXISTING `row.isBurner` (Leg 1,
      jar-page-model.js:32-56, already truth-table-tested) — `editable =
      !row.isBurner` in jars.js; do NOT add a duplicate model field (design-review
      ruling). The page never special-cases `id === 'burner'` in DOM code.
- [x] **Create**: a create affordance opens a form (name input + palette swatch
      grid, one swatch preselected); submit calls `jarsAdd({name, color})` with
      the TRIMMED name; the form disables submit while the trimmed name is empty.
      **The page-side trim/disable is the SOLE enforcement for whitespace-only
      names** — `cleanName` (jars.js:75-77) does not trim (`'   '` persists
      verbatim; only literal `''` falls back to `'Jar'`), and `handleAdd` only
      rejects falsy names. The store clamp backstops only the empty string and
      the 24-char cap. (Same page-side-guard precedent as the picker sheet,
      renderer.js:2703-2704.) On success the form resets/closes. New jar appears
      via the broadcast re-render (no optimistic insertion).
- [x] **Rename/recolor**: each persistent-jar row exposes an edit affordance
      opening an inline editor (name input pre-filled + swatch grid with the
      current color marked; a palette-external current color renders as a
      13th "current" swatch, not silently dropped); save calls
      `jarsRename({id, name, color})` with only changed fields; cancel restores
      the row unchanged.
- [x] **Set-default**: each non-default persistent-jar row exposes a
      make-default affordance calling `jarsSetDefault({id})`; the default row
      shows the marker instead of the affordance. When the registry is empty the
      Burner row shows the default marker (Leg 1 behavior preserved).
- [x] **Delete**: each persistent-jar row exposes a delete affordance that flips
      the row into an explicit confirm state — text names the consequences
      (per DD5) and shows Confirm + Cancel buttons; only Confirm calls
      `jarsRemove({id})`, and the Confirm button disables once clicked
      (`handleRemove` is async — jar-ipc.js:115-142 — a double-fire would surface
      a needless `{ok:false}` inline error). Confirm state is exclusive (opening
      it on one row, or opening any editor, collapses other transient states).
      **Escape dismisses ANY open transient state** — create form, edit row, or
      delete confirm (FD ruling at design review: keyboard consistency across all
      `ui.mode`s, not confirm-only).
- [x] **Burner row**: renders name/color/default-marker only — structurally no
      buttons (model-driven, per the first criterion).
- [x] All rendering stays `createElement`+`textContent`; swatch/dot backgrounds
      pass through `isSafeColor` (fallback `#9aa0ac`); all affordances are real
      `<button>`s (keyboard-reachable, labeled — `aria-label` where icon-only).
- [x] **Transient-state survival**: re-renders (any broadcast) preserve an open
      editor/confirm only if its row id still exists; a mutation from another
      surface that removes the edited row collapses the editor without error.
      Invoke rejection/`null`/`false` returns surface a non-blocking inline error
      line (textContent) and leave state consistent.
- [x] No changes under `src/main/` or `src/preload/`; `git diff` confines to
      pages/, shared/jar-page-model.js, tests, and (only if unavoidable) d.ts /
      eslint globals.
- [x] `npm test` (baseline 1180 + new model tests), `npm run typecheck`,
      `npm run lint` all green; vm page net still green (it self-derives —
      any new page `<script>` must keep the collision discipline).

## Verification Steps

- `npm test` / `npm run typecheck` / `npm run lint`.
- `node -e` spot checks: `PALETTE` frozen + all-safe; `buildJarPageModel` row
  editability flags for jar vs burner rows.
- `git diff --stat` — confirm the no-main/no-preload criterion.
- Live CRUD verification is Leg 5 (real boot + chrome-driven mutations observed on
  the page) and the HAT (operator-driven page flows) per DD9 — this leg's machine
  verification is the suite plus code inspection by the flight-level review.

## Implementation Guidance

1. **Model first**: add `PALETTE` + (if used) row editability to jar-page-model.js
   with tests; keep the module DOM-free.
2. **Page state shape**: INTRODUCE a persisted `state = {containers, defaultId}`
   module-scope binding (Leg 1's jars.js has none — both call sites pass the
   just-received payload straight to `render()`, jars.js:105-113; UI-only actions
   like opening an editor need to re-render from cached state without a fresh
   broadcast), separate from `ui = {mode, rowId, draft}` (transient); render is a
   pure function of both; reconcile `ui` against row existence each render.
3. **One transient state at a time**: a single `ui.mode` (`create` | `edit` |
   `confirm-delete` | `null`) enforces exclusivity cheaply.
4. **Swatch grid**: render as a `role="radiogroup"` of buttons with
   `aria-checked`; reuse for create and edit (one function).
5. **Error line**: one reserved element per form, textContent-set from invoke
   failures ("Couldn't create jar" etc.) — no throw-to-console-only paths.
6. **Copy for delete confirm** (DD5): "Deletes this jar and wipes its cookies,
   site storage, and cache. Open tabs in this jar will close." — the tab-closure
   sentence ships now; the behavior lands in Leg 3 (same flight-level commit, so
   no user-visible window where the copy overpromises).
7. Do not add entry points (Leg 3) or touch renderer.js.

## Edge Cases

- **Broadcast-before-resolve** (see Context): never render from invoke returns.
- **Delete the flag-holder**: store repairs the flag; the re-render simply shows
  the new marker position — no page-side flag logic.
- **Rename to empty**: submit disabled; store clamp is backstop.
- **Current color not in palette** (legacy/migrated jars): shown as an extra
  "current" swatch in the editor (explicitly criterion-pinned above).
- **Last-jar delete from the page**: registry empties; Burner row shows the
  marker (tabs-closure arrives in Leg 3; until then behavior matches Flight 2).
- **Concurrent editors**: exclusivity via `ui.mode`; cross-surface mutations
  collapse stale transient state by id-reconciliation.

## Files Affected

- `src/renderer/pages/jars.js` — interactions (primary surface)
- `src/renderer/pages/jars.html` / `jars.css` — form/affordance markup hooks +
  styles
- `src/shared/jar-page-model.js` — `PALETTE` (+ optional row editability)
- `test/unit/jar-page-model.test.js` — extended truth table
- `src/renderer/renderer-globals.d.ts` — `declare const PALETTE` (REQUIRED)
- `eslint.config.mjs` — `PALETTE: 'readonly'` in the renderer globals block
  (REQUIRED)

---

## Citation Audit

This leg cites Leg 1's uncommitted outputs (bridge wrapper names, model signature,
page file shape) as stated in Leg 1's landed artifact and flight-log entry, plus
two pre-verified Flight-design citations (`cleanColor` jars.js:80;
picker broadcast-ordering note renderer.js:2710-2716 — verified at design review
cycle 1 against `51e1ea6`, untouched by Leg 1). The design review for this leg
re-verifies the Leg 1 surface against the actual working tree.

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (append-only)
- [x] Set this leg's status to `landed` (deferred-review mode: `completed` comes at
      the flight-level commit)
