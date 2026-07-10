# Leg: data-controls-ui

**Status**: completed
**Flight**: [Per-Jar Data Controls](../flight.md)

## Objective

Wire the data controls end-to-end: enable the per-section clear/wipe buttons behind
the confirm-everything flow (DD5), give successful clears visible feedback, and land
the DD4 chrome half — the `onJarWiped` preload listener and the renderer's
reload-the-jar's-tabs sweep (CP3). Also lands DD10(b), the CLAUDE.md onboarding
checklist paragraph.

## Context

- Flight DD5 (confirm EVERY action — operator ruling), DD4 (reload after full wipe
  only, broadcast-driven), DD10(b).
- Leg 2 left the exact seams this leg fills: `buildDataControlsBlock`
  (jars.js:561-579) renders one DISABLED button per `JAR_DATA_CLASSES` descriptor +
  a disabled "New identity" button; `ui` already carries
  `{ mode: 'confirm', rowId, action }` with `'delete'` as the only action; and
  `updateDeleteArea` (jars.js:658-668) demonstrates the required confirm-area
  pattern — rebuild ONLY when this row's confirm-open-ness changes, so unrelated
  broadcasts can't reset an in-flight Confirm's disabled state.
- Leg 1 shipped the IPC + wrappers: `bridge.jarsClearData({ id, classes })` →
  `{ ok, cleared }`, `bridge.jarsWipe({ id })` → `{ ok }`, `jar-wiped { id }`
  broadcast on wipe success (before resolve). chrome-preload has the action
  wrappers and an explicit "NO onJarWiped yet — lands in leg 3" comment
  (chrome-preload.js:60-66).
- Suite baseline: 1269/1269 (legs 1-2 landed, uncommitted).

## Inputs

- Legs 1-2 landed on the working tree (uncommitted).
- `src/renderer/pages/jars.js` (967 lines, post-relayout), `jars.css`,
  `chrome-preload.js`, `renderer.js`.

## Outputs

- `src/renderer/pages/jars.js` — data-controls wiring (confirms, calls, feedback)
- `src/renderer/pages/jars.css` — confirm/status styling for the data area (as
  needed; reuse existing form/confirm classes where possible)
- `src/preload/chrome-preload.js` — `onJarWiped` listener wrapper
- `src/renderer/renderer.js` — `jar-wiped` reload sweep
- `CLAUDE.md` — the shared-global onboarding checklist paragraph (DD10(b))

## Acceptance Criteria

### Page: confirms + calls (DD5)

- [x] Every data-controls button is ENABLED and opens a two-step confirm:
      `ui = { mode: 'confirm', rowId: id, action }` where `action` is
      `'clear-cookies' | 'clear-storage' | 'clear-cache' | 'wipe'` — derived from
      the descriptor id (`'clear-' + cls.id`) so a future data class needs zero new
      action plumbing; `'wipe'` comes from the New identity button. Exclusivity
      and Escape-dismiss hold automatically (`ui` wholesale replacement + the
      existing global handler, jars.js:894-898).
- [x] Confirm-area shape (FD ruling at design review — the leg-2 delete pattern
      does NOT generalize as-is): the data-controls block gets ONE shared
      data-confirm area (`refs.dataConfirmArea`) rendered BELOW the always-visible
      button row; it is diffed on `(ui.action, open-for-this-row)` using the
      `updateDeleteArea` transition discipline (jars.js:660-666 — rebuild only on
      actual transition, so unrelated broadcasts can't reset an in-flight
      Confirm's disabled state). The five buttons stay visible and clickable while
      a confirm is open — clicking a sibling action swaps the confirm via `ui`
      wholesale replacement. `buildDataControlsBlock` (jars.js:561-579) is
      restructured accordingly (button row + confirm area, refs extended); the
      delete area keeps its existing separate mechanism unchanged.
      Cycle-2 amendments (scoped review, all three REQUIRED):
      (a) the transition key is the open `(action, rowId)` pair compared as
      string-or-null — NOT updateDeleteArea's boolean; a literal boolean copy
      breaks the sibling-swap case (cookies→wipe on the same row would skip the
      rebuild and keep stale copy/handler);
      (b) in-flight guards — every resolve/reject handler verifies
      `ui.mode === 'confirm' && ui.rowId === id && ui.action === action` before
      mutating `ui` or writing the local error (an abandoned promise must not
      close a NEWER confirm the user swapped to), AND the TRIGGERING button
      disables while its action is in flight (a swap-away-and-back mid-flight
      must restore a disabled/pending state, not a fresh clickable Confirm —
      the double-fire hole the sibling-visible design opens);
      (c) focus — `updateDataConfirmArea`'s rebuild branch focuses the new
      confirm's Confirm button (gated by the key change, so unrelated re-renders
      never hijack focus; keyboard/SR users otherwise get no signal the confirm
      appeared below the button row).
      Plus a code comment noting the confirm copy is deliberately
      name-free — anyone adding `{name}`-interpolated copy must widen the
      transition key.
- [x] Each confirm shows: action-specific copy (below), a Confirm button
      (disables once clicked), Cancel, and its own confirm-LOCAL error line —
      matching the delete-confirm precedent (jars.js:613-616), NOT the section's
      shared line.
- [x] Confirm copy (operator-adjustable at HAT — flight Acceptable Variations):
      - clear-cookies: "Clears this jar's cookies. Sites in this jar will sign
        you out."
      - clear-storage: "Clears this jar's site storage — data sites saved
        locally in this jar."
      - clear-cache: "Clears this jar's cached files. Sites reload them on next
        visit."
      - wipe (flight DD5 verbatim): "Wipes this jar's cookies, site storage, and
        cache, and rerolls its fingerprint. Open tabs in this jar will reload."
- [x] Confirm actions invoke the leg-1 wrappers: clear-* →
      `bridge.jarsClearData({ id, classes: [clsId] })` (one class per button —
      `['cookies']` / `['storage']` / `['cache']`); wipe →
      `bridge.jarsWipe({ id })`. Results are success/failure signals ONLY (no
      render-from-resolve): on `{ ok: true }` close the confirm and show
      feedback; on `{ ok: false }`/reject set the confirm-local error line
      ("Couldn't clear data" / "Couldn't wipe jar") and re-enable Confirm.
- [x] Success feedback: the section's shared status line (`refs.errorLine`,
      already `aria-live="polite"`) briefly shows a per-action past-tense note
      ("Cookies cleared." / "Site storage cleared." / "Cache cleared." /
      "New identity — data wiped, fingerprint rerolled."). **Visual variant
      required (review finding)**: `.jar-error-line` is styled `color: var(--err)`
      (jars.css:346-351) — success notes must NOT render red. Add an `is-ok`
      modifier class the success path sets and the error path clears; same
      element, no new live regions. Message discipline: last-write-wins, and a
      timeout-based clear only fires if the content is unchanged since it was
      set (no timers stomping a newer message; clear the handle on section
      removal).
- [x] Burner section remains data-controls-free (leg 2 structure untouched);
      `reconcileUi` needs NO change (any `mode === 'confirm'` with a vanished
      rowId already collapses — jars.js:908-914 — verify the new actions ride
      that path).

### Chrome: reload sweep (DD4)

- [x] `chrome-preload.js` gains `onJarWiped: (cb) => ...` following the
      `onJarsChanged` one-liner idiom exactly (chrome-preload.js:61 — chrome
      preload has no handle-based off; do not invent one).
- [x] `renderer.js` subscribes once (beside the `onJarsChanged` subscription,
      renderer.js:133) and sweeps: for every tab whose `container.id` equals the
      payload id, if it's a web tab with a live `wcId`, fire
      `tabNavigate({ wcId, verb: 'reload', args: [] })` (the existing reload
      idiom — renderer.js:2293/:2346 precedents). No pre-activation, no ordering
      concerns (nothing closes — tabs reload in place), no fallback logic.
      Internal tabs are excluded by the web-tab guard; burner tabs are
      unreachable (wipe rejects burner).
- [x] Granular clears trigger NO reload anywhere (no `jars-changed` coupling, no
      clear-side broadcast exists — nothing to assert beyond not adding one).

### Docs + gates

- [x] CLAUDE.md's "Recurring module shapes" pattern note gains the shared-global
      onboarding checklist paragraph (DD10(b)): all four parts — eslint global,
      d.ts declare, page `<script>` tag, INTERNAL_PAGES entry when an internal
      page loads it — stated as a checklist, one sentence of why (both gates
      hard-fail without the first two; the internal scheme 404s without the
      fourth).
- [x] `npm test` green (existing 1269 — this leg adds no unit tests; the sweep
      and confirms are behavior-tested in leg 4 and HAT-judged per DD9),
      typecheck green, lint green.

## Verification Steps

- `npm test`, typecheck, lint — green.
- Grep checks: no `disabled = true` remains in `buildDataControlsBlock`'s button
  path; `onJarWiped` exists in chrome-preload and is subscribed exactly once in
  renderer.js; the four action strings appear in jars.js.
- Optional boot smoke on a scratch profile (clean stdout), torn down by killing
  the Electron main pid. End-to-end wipe/reload behavior is leg 4's
  `jar-data-controls` spec (step 5 pins the reload observable) — do not chase it
  manually here.

## Implementation Guidance

1. **Data-confirm area** — implement the FD ruling in the ACs: restructure
   `buildDataControlsBlock` into an always-visible button row + one shared
   `dataConfirmArea`, with an `updateDataConfirmArea(refs, row)` applying the
   same transition discipline as `updateDeleteArea` (track the open
   `(action, rowId)` pair in refs; rebuild only when it changes). The delete
   confirm's existing behavior must not regress. Optional (HAT-adjustable): a
   subtle de-emphasis on the non-active data buttons while a confirm is open.
2. **Action table** — a small const map `{ action: { copy, run(id), okNote,
   failNote } }` keeps the wiring declarative; derive clear-action entries from
   `JAR_DATA_CLASSES` (label → copy interpolation is fine for the note strings;
   the confirm COPY above is bespoke per class — keep the three strings literal,
   they're operator-facing).
3. **Feedback timing** — if using a timeout to clear the status note, keep the
   handle per section and clear it on section removal (no timers firing into
   removed DOM).
4. **renderer.js sweep** — reuse the tab-iteration idiom nearest the
   onJarsChanged handler; keep it a few lines. Do not touch
   `refreshOpenTabJars` (different concern — registry reconciliation).
5. **CLAUDE.md paragraph** — write it where the "Recurring module shapes" note
   lives; keep it four bullet-lines + one rationale sentence.

## Edge Cases

- **Confirm open for clear-cookies, operator clicks New identity on the same
  jar**: `ui` wholesale replacement swaps the confirm — correct by construction;
  verify the transition pattern rebuilds (action changed, same row).
- **Wipe on a jar with zero open tabs**: sweep matches nothing — fine; the
  `jar-wiped` broadcast is still fired by main (leg 1) and must not error in an
  empty sweep.
- **Wipe succeeds while the jars page is open in a tab of that jar**: impossible —
  internal pages live on the internal partition, never in a persistent jar.
- **Two windows / multiple chrome renderers**: out of scope — the app is
  single-window (existing assumption everywhere).
- **Broadcast arrives before resolve (house rule)**: the sweep may fire before
  the page's confirm closes — harmless; the page renders from state, the sweep
  touches only web tabs.

## Files Affected

- `src/renderer/pages/jars.js` — confirm generalization + wiring + feedback
- `src/renderer/pages/jars.css` — minor styles if needed
- `src/preload/chrome-preload.js` — one listener
- `src/renderer/renderer.js` — one subscription + sweep
- `CLAUDE.md` — one paragraph

## Citation Audit

Verified at leg design time (2026-07-10) against the post-leg-2 working tree:
`jars.js:561-579` (buildDataControlsBlock — flat disabled-button block, to be
RESTRUCTURED per the FD confirm-area ruling, not merely enabled), `:613-616`
(delete confirm's LOCAL error line — the failure-line precedent), `:660-666`
(updateDeleteArea transition pattern), `:331-340` (SectionRefs typedef — gains
the dataConfirmArea refs), `:62` (UiState typedef with `action`), `:893-899`
(global Escape), `:911-914` (reconcileUi collapse on vanished rowId);
`jars.css:346-351` (`.jar-error-line` is err-colored — the is-ok variant
finding); `chrome-preload.js:63-66` (leg-1 comment reserving onJarWiped for
this leg), `:61` (onJarsChanged idiom); `renderer.js:133` (onJarsChanged
subscription site), `:166` (refreshOpenTabJars — NOT to be touched),
`:2293`/`:2346` (tabNavigate reload idiom precedents). Drift repairs from
design review applied; reviewer additionally verified the single-window
premise, the internal-tab exclusion (`container.id === 'internal'` at
renderer.js:828-830), and that no unit test pins the page's button DOM. All OK.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (suite + typecheck + lint)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit — the flight review + commit follows this leg
