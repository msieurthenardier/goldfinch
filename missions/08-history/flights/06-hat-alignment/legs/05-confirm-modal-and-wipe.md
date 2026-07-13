# Leg: confirm-modal-and-wipe

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

**H7**: replace the easily-overlooked INLINE two-step confirmation with a
page-level **modal** the user cannot miss (all destructive jar actions —
clear cookies/storage/cache/history, wipe, delete). **H6**: wiping a jar
**closes** the jar's open tabs instead of reloading them (so history stays
cleared — the reload was re-recording it), with the confirm copy warning
that tabs will close.

## Context & rulings

- HAT step 6; rulings (flight-log Decisions): H6 → **close the jar's tabs
  on wipe (not reload), state it in the confirm copy** (supersedes
  F4/DD4's reload sweep); H7 → **modal, not inline**.
- **Confirm machinery today** (`src/renderer/pages/jars.js`): the `ui`
  state `{ mode:'confirm', rowId, action }`; `DATA_ACTIONS` (per-class
  clear + wipe + delete, each `{ copy, okNote, run, silentSuccess? }`);
  `CLEAR_COPY`/`WIPE_COPY` copy tables; `buildDataConfirm(rowId, action,
  refs)` (in-flight disable of Confirm + trigger, stale-`ui` guard,
  local error line); `updateConfirmAreas` renders `buildDataConfirm`
  INLINE into per-region confirm areas (`confirmAreas`/`confirmOpenKeys`
  keyed by `CONFIRM_REGIONS = ['history','cookies','site-data','footer']`
  via `regionForAction`); `closeTransient`; the global Escape handler.
- **Leg 03 interaction**: the per-region confirm areas live inside the tab
  panels + footer; Leg 03 added the "switch tab with an open confirm →
  `closeTransient()`" rule. **A page-level modal RETIRES both** the
  per-region confirm machinery AND that tab-switch rule (a focus-trapped
  modal blocks tab-strip interaction while open) — a net simplification.
- **Wipe reload** (`src/renderer/renderer.js:158`): `onJarWiped` reloads
  every matching web tab via `tabNavigate reload`. `closeTab(id)`
  (renderer.js:986) is the close path; it has a "last tab →
  `createTab()`" branch, and closing mutates the `tabs` Map (iterate a
  SNAPSHOT — the existing orphan-sweep pattern, renderer.js:182).

## Design

### H7 — modal confirmation (jars.js + jars.css)

- **One page-level modal**, built once (a module-scoped overlay): a
  backdrop `<div>` + a centered `role="dialog" aria-modal="true"`
  `aria-labelledby`/`aria-describedby` card containing the action's copy,
  a Confirm (danger) button, and a Cancel button. Reuse the existing
  `buildDataConfirm` body — copy, `run`, in-flight disable of Confirm,
  stale-`ui` guard, error line — but MOUNT it in the modal instead of a
  region.
- **Driven by `ui`**: replace `updateConfirmAreas` with
  `updateConfirmModal(...)`: when `ui.mode === 'confirm'` open the modal
  populated for `(ui.action, ui.rowId)`; else close it. One modal
  page-wide (the `ui` singleton already guarantees one transient at a
  time). **RETIRE** `CONFIRM_REGIONS`, `confirmAreas`, `confirmOpenKeys`,
  `regionForAction`, and the per-region area DOM in
  `buildJarSection`/`buildRegionControls` (buildRegionControls STILL emits
  the trigger buttons — Clear X / Clear identity / Delete — MINUS the
  confirm area). The trigger buttons stay in their tabs/footer and open
  the modal.
- **`jars-tabs.js` MUST be edited too** *(design review, HIGH — omitted
  file)*: `jars.js:627` calls `createJarTabs({ panels, getUi,
  closeTransient, regionForAction })` and `jars-tabs.js`'s `selectTab`
  consumes `regionForAction` in its confirm-close-on-switch branch. Drop
  that branch AND the `regionForAction`/`closeTransient` params from
  `createJarTabs`'s signature + JSDoc (the modal blocks tab switching →
  the branch is dead). Keep `selectTab`'s never-strand-focus recovery.
- **Precedent to transplant** *(design review)*: the menu-overlay
  new-container dialog (`menu-overlay.js:296-431`) is the same-repo
  template — `role="dialog" aria-modal="true"`, a fixed small-array Tab
  cycle (`[input, create, cancel]` via indexOf/modulo; ours is
  `[confirm, cancel]`), Escape + backdrop dismiss, explicit `focusReturn`.
  Follow it (simpler here — 2 elements). The chrome lightbox
  (`renderer.js:1688-1830`) is a second reference.
- **Modal a11y + behavior**:
  - **Title for `aria-labelledby`** *(design review — buildDataConfirm
    has no heading today)*: add a per-action TITLE table (e.g. "Clear
    cookies?", "Clear identity?", "Delete jar?") + an `id`'d `<h2>` in the
    modal; `aria-labelledby`→it, `aria-describedby`→the existing copy
    paragraph.
  - **`buildDataConfirm` must expose `cancelBtn`** *(design review —
    returns only `{root, confirmBtn}` today; existing code focuses
    Confirm)*: return `{ root, confirmBtn, cancelBtn }`; on open **default
    focus Cancel** (destructive-safe).
  - `Tab`/`Shift+Tab` cycle Confirm↔Cancel (focus trap); `Escape` cancels;
    backdrop click cancels; both route through `closeTransient`.
  - **Focus restore on close** to the trigger, WITH a fallback *(design
    review)*: `delete` is `silentSuccess` — its row (and trigger) is gone
    by the time `reconcileUi` closes the modal, so restoring to a detached
    node strands focus on `<body>`. Fall back to `#jars-new` when the
    captured trigger is not `isConnected` (never strand on body — the
    house invariant).
  - **In-flight (Confirm clicked, `run` pending)**: Confirm + Cancel
    disabled (existing), AND suppress Escape/backdrop dismiss until the
    promise settles via a **dialog-local `keydown` + `stopPropagation`
    shadow** *(design review, FD pick — mirrors the name-input Escape
    precedent at jars.js:831-838; smaller than threading `ui.inFlight`,
    and keeps the global Escape handler unchanged)*.
- **CSS** (`jars.css`): backdrop (dim, covers the page), centered card,
  danger Confirm button. **Drop ONLY `.jar-data-confirm-area` (jars.css:392)**
  — `.jar-confirm`/`.jar-confirm-text`/`.jar-form-actions` (360-378) are
  REUSED by the mounted `buildDataConfirm` output (`.jar-form-actions` is
  also shared with the create-panel) *(design review — do not broad-sweep
  "confirm" rules)*. Respect reduced-motion (instant, no animation).
- **Growth fallback** *(design review — jars.js at 1,708, the ~1,800 DD2
  headroom was spent in Leg 03)*: retiring the per-region machinery frees
  ~70-90 lines; a full modal adds ~100-200. If it lands ≥ ~1,800, extract
  the modal into `src/renderer/pages/jars-confirm-modal.js` (the
  `jars-tabs.js`/`jars-history-panel.js` three-point-onboarding precedent).
  Pre-agreed.

### H6 — close jar tabs on wipe (renderer.js + copy)

- **`onJarWiped`** (renderer.js): change the sweep from `tabNavigate
  reload` to **`closeTab`** for every matching web tab. **Snapshot first**
  (`[...tabs.values()]`) — `closeTab` mutates `tabs`. **Reuse the DD6
  ordered-sweep shape** (renderer.js:174-195) to avoid the active-tab
  `tabSetActive` flicker: close the NON-active matching tabs first, the
  active one last (or the equivalent survivor-first activation) — the
  same structural fix the orphan sweep already uses for the identical
  multi-close-with-active pattern *(design review)*. The `isWebTab` +
  `container.id` match is unchanged (internal/burner never match);
  `closeTab`'s last-tab→`createTab()` branch is acceptable. Update the
  DD4 comment to reflect close-not-reload.
- **`WIPE_COPY`** (jars.js): update the wipe confirm copy to warn that the
  jar's open tabs will CLOSE (was "reload"). Keep it concise; the modal
  makes it prominent.
- **Main side** (`handleWipe`, jar-ipc.js): UNCHANGED — it already purges
  history + broadcasts `jar-wiped` + (n>0) `history-changed`. Closing tabs
  is purely the renderer's reaction to `jar-wiped`; no more reload means
  no re-recorded visit, so history stays cleared (H6 root cause fixed).
- **`tests/behavior/jar-data-controls.md` MUST be rewritten** *(design
  review, HIGH — it pins the OLD behavior)*: Step 5 asserts the wiped
  jar's tab RELOADED in place (wcId unchanged, `__bt_alive` undefined),
  and the Intent says "auto-reloads." Rewrite Step 5's expected result +
  the Intent sentence to assert CLOSE-not-reload (the tab is gone from
  `enumerateTabs` / its wcId no longer present; a fresh tab if it was the
  jar's last). The RE-RUN of `/behavior-test jar-data-controls` is folded
  into the `hat-reverification` leg (alongside the live wipe re-check) —
  this leg only fixes the spec text.

## Acceptance Criteria

- [x] All destructive jar actions (clear cookies/storage/cache/history,
      wipe, delete) confirm via ONE page-level modal (role=dialog,
      aria-modal, focus-trapped, Cancel default-focused, Escape/backdrop
      cancel, focus restored to trigger on close); the inline per-region
      confirm areas are gone. (Live modal feel — focus trap, default focus,
      Escape/backdrop dismiss, focus-restore — is HAT-verified in the
      `hat-reverification` closing leg; this leg's evidence is static:
      `role="dialog"`/`aria-modal`/`aria-labelledby`/`aria-describedby` on
      the built card, the Tab-cycle/Escape/backdrop-click listeners, and
      `restoreFocus`'s fallback, all in `jars-confirm-modal.js`.)
- [x] The `(action,rowId)` key, `run` bodies, in-flight disable, stale-`ui`
      guard, `silentSuccess` (delete), and per-action copy are preserved;
      `closeTransient`/global-Escape still dismiss.
- [x] Dead machinery removed (grep-AC: `grep -n
      "CONFIRM_REGIONS\|confirmAreas\|regionForAction\|confirmOpenKeys"
      src/renderer/pages/jars.js` → 0 hits — verified; the Leg-03 selectTab
      closeTransient-on-confirm branch removed, and the `getUi`/
      `closeTransient`/`regionForAction` params dropped from
      `createJarTabs`); jars.css per-region confirm-area rule removed
      (`.jar-data-confirm-area` gone; `.jar-confirm`/`.jar-confirm-text`/
      `.jar-form-actions` kept and reused by the modal).
- [x] Wiping a jar CLOSES its open web tabs (snapshot-then-close), does
      NOT reload them; wipe confirm copy warns tabs will close; after a
      wipe the jar's history stays cleared (no re-recorded reload visit).
      (Renderer-side close sweep + copy verified statically/by unit+lint/
      typecheck; the live wipe-closes-tabs behavior is re-verified in the
      `hat-reverification` closing leg per this leg's Verification Steps.)
- [x] Focus preservation across broadcasts intact; the tab shell (Leg 03)
      and history panel (Leg 04) undisturbed except for the retired
      confirm-region hooks.
- [x] `npm test` / typecheck / lint green; script-tag contract test green;
      report jars.js line count (retiring the per-region machinery should
      be net-neutral-or-less vs. adding the modal — watch ~1,800). jars.js
      landed at 1,587 lines (down from 1,708 pre-leg) — the modal itself
      was extracted to `src/renderer/pages/jars-confirm-modal.js` (316
      lines) per the pre-agreed growth fallback, since the modal
      inline had briefly pushed jars.js to 1,817 (≥ ~1,800).

## Verification Steps

Gates + grep-ACs; the modal feel + the wipe-closes-tabs behavior are
re-verified live in the `hat-reverification` leg (this is the very
finding that leg re-checks). Internal-page DOM isn't eval-observable — HAT
is the acceptance signal (M06 F4 DD9).

## Files Affected

- `src/renderer/pages/jars.js` — modal replacing per-region confirms;
  per-action TITLE table + `aria-labelledby`; buildDataConfirm returns
  `cancelBtn`; WIPE_COPY copy; retire
  CONFIRM_REGIONS/regionForAction/confirmAreas/confirmOpenKeys
- `src/renderer/pages/jars-tabs.js` — drop selectTab's confirm-close
  branch + the `regionForAction`/`closeTransient` params from
  `createJarTabs` (design review, HIGH)
- `src/renderer/pages/jars.css` — modal styling; drop ONLY
  `.jar-data-confirm-area` (keep `.jar-confirm`/`-text`/`.jar-form-actions`)
- `src/renderer/renderer.js` — `onJarWiped` reload→ordered-close + snapshot
  + comment
- `tests/behavior/jar-data-controls.md` — rewrite Step 5 + Intent
  (close-not-reload); re-run in the hat-reverification leg
- `src/renderer/pages/jars-confirm-modal.js` (NEW) + `jars.html` +
  `INTERNAL_PAGES.jars` (main.js) + `eslint.config.mjs` — growth-fallback
  extraction triggered: jars.js briefly landed at 1,817 lines with the modal
  inline (≥ ~1,800), so it moved to this sibling module (three-point
  onboarding, jars-tabs.js precedent); jars.js settled at 1,587.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` 1502/1502, typecheck clean, lint clean,
      script-tag contract test green, both grep-ACs 0 hits)
- [x] Update flight-log.md with leg progress entry (incl. jars.js line count)
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (this is the last autonomous leg → flight-level review
      + commit follows)
