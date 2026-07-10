# Leg: chrome-entry-and-delete-integration

**Status**: completed
**Flight**: [Jar Management Page](../flight.md)

## Objective

The jars page becomes reachable from chrome (kebab "Cookie jars" item + container-
picker "Manage jars…" row), deleting a jar closes its open tabs (snapshot sweep +
post-sweep zero-tab fallback, mission criterion 4), and the trusted-tab synthetic
jar's hardcoded "Settings" label is generalized.

## Context

- **Entry points (operator ruling)**: kebab menu + picker row; no settings-page
  link. Both funnel through one opener mirroring `openDownloads`
  (renderer.js:529-531) — `createTab('goldfinch://jars', null, {trusted: true})`.
  **`openDownloads` has NO dedupe/reuse guard** (design-review verified: it
  unconditionally creates; repeated opens already stack Downloads tabs today) —
  `openJarsPage` does the same, unconditionally. Parity, full stop; do not invent
  dedupe logic.
- **Kebab precedent**: static model `kebabModel()` (renderer.js:246-251), action
  fns `kebabActionSettings`/`kebabActionDownloads` (renderer.js:165-170),
  dispatched via `KEBAB_ACTIONS` (renderer.js:179-184). Add a "Cookie jars" item
  between Downloads and Print (label wording is an accepted variation).
- **Picker sentinel precedent**: `buildContainerModel` appends
  `{ id: 'action:new-container', label: '+ New container…', variant: 'add' }`
  (src/shared/container-menu.js:55-57); the chrome renderer dispatches by id
  prefix in `onMenuOverlayActivated`'s `container` case (renderer.js:377-405).
  Add an `action:manage-jars` sentinel ("Manage jars…") AFTER the quick-create
  item (quick-create stays — operator ruling); dispatch case calls the shared
  opener. `test/unit/container-menu.test.js` pins the model rows — extend it.
- **DD6 — tabs-close-on-delete (firm requirement), ORDERED-SWEEP ruling (FD, leg
  design review cycle 1 — supersedes the "suppress the per-call fallback"
  phrasing; DD6 annotated, flight-log Decision recorded)**: the orphan branch in
  `refreshOpenTabJars` (renderer.js:140-151; the `if (!fresh) continue` at
  :143-144) becomes "close this tab" via a SNAPSHOT sweep with deterministic
  ordering — `closeTab` is NOT modified (its signature has no suppression hook,
  and none is needed):
  1. Collect orphans from the snapshot (`[...tabs.values()]`).
  2. If the ACTIVE tab is an orphan and a survivor exists, `activateTab` a
     survivor FIRST (one deliberate activation — never let the fallback pick a
     doomed orphan).
  3. Close non-active orphans first, the active orphan (if any) LAST — closing
     non-active tabs never touches `activeTabId`, so no intermediate
     activations fire at all.
  4. All-orphan case: step 3's last close is the true last tab; `closeTab`'s own
     last-tab branch (renderer.js:827-830, `createTab()` at :830 — "never leave
     the window with zero tabs") fires EXACTLY ONCE (review-traced convergence:
     `activeTabId` always tracks a live tab, so the zero-tab branch is reachable
     only on the final close), creating the fresh default-resolved tab
     (`resolveNewTabContainer(containers, defaultId) || makeBurner()` — a fresh
     burner after a last-jar delete).
  The naive unordered loop is CORRECT but thrashes real IPC
  (`tabSetActive` swaps native view visibility per intermediate activation) —
  the ordering exists to make the sweep flicker-free, not to fix a correctness
  bug. Comment this rationale at the sweep.
- **Orphan definition — exclusions are load-bearing**: a tab is an orphan iff its
  `tab.container.id` matches NO current container AND it is not a burner tab AND
  not an internal tab. Burner tabs (`tab.container` from `makeBurner()`) and the
  internal pseudo-jar (`id: 'internal'`) never appear in `containers` by design —
  verify how the existing loop already skips them (the Flight 2 loop body's
  early-continues) and preserve those guards explicitly, or deleting any jar
  would wrongly close every burner/internal tab.
- **Pseudo-jar name (owned here per Leg 1 review ruling)**: renderer.js:736
  hardcodes `name: 'Settings'` for every trusted internal tab; derive the label
  from the URL host instead (settings/downloads/jars). Keep `id: 'internal'` and
  the internal-partition pairing byte-identical — that pairing is the documented
  data-loss guard (renderer.js:730-734).
- **Verification split (DD9)**: the closure sweep's machine gate is the
  `jar-delete-closes-tabs` behavior test (Leg 5); no unit seam exists for the
  renderer tab lifecycle — do not force one (no pure-module extraction is
  required for the sweep; the decision logic is a few lines against live DOM/Map
  state). container-menu changes DO have a unit seam (extend its test).
- Legs 1-2 (uncommitted) did not touch renderer.js or container-menu.js — the
  Flight-design citations above were verified at `51e1ea6` and remain current.

## Inputs

- Legs 1-2 landed (uncommitted): interactive page fully functional; bridge
  complete; suite 1185/1185, typecheck/lint clean.

## Outputs

- Page reachable from kebab + picker; jar deletion (from ANY surface — page,
  automation, future picker flows) closes the jar's open tabs; no tabless window
  possible; internal tabs correctly labeled per page.

## Acceptance Criteria

- [x] Shared opener (name it like `openJarsPage`) mirroring `openDownloads`'
      shape AND dedupe semantics; kebab model gains a "Cookie jars" item wired
      through `KEBAB_ACTIONS`; picker model gains an `action:manage-jars`
      sentinel after `action:new-container`, dispatched to the opener.
      Quick-create row unchanged.
- [x] `test/unit/container-menu.test.js` extended: model includes both sentinels
      in order, manage row's label/variant pinned, jar rows unaffected.
- [x] `refreshOpenTabJars` closes orphaned tabs per the ORDERED-SWEEP ruling
      (Context): snapshot iteration; burner and internal tabs explicitly exempt
      (existing `continue` guards at renderer.js:142 preserved); survivor
      pre-activation when the active tab is an orphan; non-active orphans closed
      first, active orphan last; `closeTab` signature UNCHANGED — its own
      last-tab branch provides the exactly-once zero-tab fallback (fresh burner
      when registry empty). No intermediate activation of any orphan at any
      point. No behavior change for rename/recolor/set-default re-renders
      (dot/title refresh path untouched for surviving tabs).
- [x] Trusted-tab synthetic jar name derives from the URL host (no literal
      'Settings' in the trusted branch); `id: 'internal'` + internal partition
      pairing untouched.
- [x] `npm test` (baseline 1185 + container-menu extensions), `npm run
      typecheck`, `npm run lint` green. Chrome vm net (chrome-shared-scripts)
      still green — container-menu.js is a chrome-document script; keep the
      top-level-binding collision discipline.
- [x] No changes under `src/main/` or `src/preload/` (this leg is renderer +
      shared + tests only; Leg 4 owns main.js).

## Verification Steps

- `npm test` / `npm run typecheck` / `npm run lint`.
- `git diff --stat` — renderer.js, container-menu.js, container-menu.test.js
  (+ possibly styles for the kebab/picker rows) only.
- Live closure proof: `/behavior-test jar-delete-closes-tabs` at Leg 5; entry
  points + labels operator-verified at HAT (DD9 split).

## Implementation Guidance

1. **Opener first**: read `openDownloads` (renderer.js:529-531) and its guard
   context; replicate for `goldfinch://jars`.
2. **Kebab**: one model row + one action fn + one `KEBAB_ACTIONS` entry — match
   the Downloads trio exactly.
3. **Picker**: add the sentinel in `buildContainerModel` (container-menu.js),
   handle the id in the renderer's dispatch `container` case alongside
   `action:new-container`/`action:burner`.
4. **Sweep rewrite** (`refreshOpenTabJars`): snapshot; for each tab keep the
   existing refresh behavior when `fresh` matches; collect orphans (subject to
   the exemptions); then apply the ORDERED-SWEEP ruling from Context verbatim
   (survivor pre-activation → non-active orphans → active orphan last; the
   fallback is `closeTab`'s own — read the branch at renderer.js:827-830 /
   function :816-832 before writing). Do NOT add a post-sweep `createTab` of
   your own and do NOT modify `closeTab` — both single-fallback and
   no-dangling-active are guaranteed by the ordering. Comment the flicker
   rationale at the sweep.
5. **Name fix**: derive the pseudo-jar `name` from `new URL(url).host`
   (capitalize or map: settings→Settings, downloads→Downloads, jars→Cookie
   Jars); tab titles still come from the page `<title>` — this label is the
   container tooltip/fallback only.
6. Comment the sweep with the DD6 rationale (broadcast-driven, uniform across
   mutation sources) — the Flight 2 comment block it replaces (renderer.js:
   137-139) promised this fix; update it rather than stacking.

## Edge Cases

- **Delete jar with the ONLY open tabs**: ordered sweep closes non-active
  orphans silently, then the active orphan; `closeTab`'s last-tab branch fires
  once, creating AND activating the fallback tab — no dangling active wcId.
- **Active tab is an orphan while SURVIVORS exist** (mixed case — design-review
  catch): survivor is activated BEFORE any close; no orphan is ever transiently
  activated; zero fallback fires (strip never empties).
- **Delete jar with NO open tabs**: sweep finds no orphans; no fallback fires
  (strip non-empty).
- **Burner tabs during any delete**: exempt — never closed by the sweep.
- **Internal tabs (jars page itself is one!)**: exempt — deleting a jar from the
  page must not close the page.
- **Multiple jars deleted in quick succession** (page allows sequential deletes):
  each broadcast triggers its own sweep; snapshot iteration makes each sweep
  self-consistent.
- **Rename/set-default broadcasts**: zero closure side-effects (orphan set empty).

## Files Affected

- `src/renderer/renderer.js` — opener, kebab row/action, picker dispatch case,
  `refreshOpenTabJars` sweep, pseudo-jar name (:736). `closeTab` (:816-832) is
  READ but NOT modified (ordered-sweep ruling)
- `src/shared/container-menu.js` — `action:manage-jars` sentinel
- `src/renderer/styles.css` — only if the new rows need styling hooks
- `test/unit/container-menu.test.js` — extended
- (d.ts only if a new global is introduced — none expected)

---

## Citation Audit

All renderer.js/container-menu.js citations verified at flight design against
`51e1ea6` (two Explore sweeps + Architect review, 2026-07-10); legs 1-2 touched
neither file (confirmed by their `git diff --stat` gates), so line anchors remain
current. The design review for this leg re-verifies against the working tree,
with specific attention to `openDownloads`' dedupe guard and the existing
burner/internal early-continues in the Flight 2 loop body.

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (append-only)
- [x] Set this leg's status to `landed` (deferred-review mode: `completed` comes
      at the flight-level commit)
