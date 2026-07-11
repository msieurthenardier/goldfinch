# Flight Log: Mission-Close Gaps

**Flight**: [Mission-Close Gaps](flight.md)

## Summary

Minimal two-leg flight closing the two gaps the post-Flight-4 mission-close
audit found: the container picker's missing default marker (DD1) and the
never-live-tested automation-key revocation on jar delete (DD2).

---

## Flight Director Notes

### Flight start (2026-07-10)

- Scope fixed by the mission-close audit (Sonnet agent, read-only pass over all
  9 success criteria + the tentative Flight 5 scope) and operator ruling
  ("Close both gaps first"). Audit verdict recorded: everything else in the
  tentative "Chrome integration" scope is already covered by Flights 1–4 —
  entry points (F3 HAT), delete-with-open-tabs incl. last-tab fallback
  (`jar-delete-closes-tabs` step 4, 5/5 twice; single-window app so
  zero-tabs-window ≡ zero-tabs-app), cross-surface propagation (F4 HAT + F6
  fix), fresh-install defaults (unit), quick-create/manage rows (unit + HAT).
- Audit also ranked known-issue-tier items (not flown): criteria 1–3's
  *(behavior-test-backed)* tags overstate coverage (page DOM is HAT-only by F4
  DD9); rename-preserves-data and migration-preserves-real-data verified once
  manually, no regression net. Routed to the mission debrief's known-issues
  accounting.
- FD spot-verified both headline gaps against the tree before chartering:
  `buildContainerModel` has no `defaultId` parameter or consumer
  (container-menu.js), and no behavior spec exercises revocation-on-delete
  (automation-key-gating covers toggle gating only).

### Leg 1 design review (cycle 1 — approve with changes)

- All five FD-flagged trace items verified against the tree; two HIGH issues
  caught, both would have failed the leg's own gates:
  - **H1**: `renderer-globals.d.ts:348-350` hand-declares `buildContainerModel`
    — the two-arg call site fails typecheck (TS2554, empirically confirmed on a
    scratch copy) without a declare update. The leg omitted the file entirely.
    This is EXACTLY the DD10(b) checklist-scope gap Flight 4's debrief flagged
    (declares beyond shared-global modules) recurring — third data point.
  - **H2**: `container-menu.test.js`'s first test strict-deepEquals the FULL
    model from a single-arg call — the backward-compat rule (single-arg ⇒
    Burner marked) deterministically breaks it. AC amended: that one literal
    gains `isDefault: true`; the "existing tests untouched" AC was internally
    inconsistent as written.
  - **M1**: the leg claimed the dangling-defaultId→Burner rule as "jars-page
    precedent" — traced FALSE (`jar-page-model.js:74` marks Burner only on
    `== null`; dangling leaves all rows unmarked). Reframed as a NEW, more
    defensive rule motivated by `resolveNewTabContainer` routing parity.
  - Cosmetic: `openContainerPicker` → `openContainerOverlay` (function name
    didn't exist); CSS target named precisely (`menu-overlay.css`, not
    styles.css); `.jar-nav-badge` (jars.css:128) cited as the pill precedent.
- Review also confirmed: single production caller; accessible-name mechanism
  holds (visible descendant text in the menuitem button); no item-field
  collision for `isDefault`.
- FD call: all fixes mechanical/spec-text — applied inline, cycle 2 skipped per
  the minor-fix rule. Leg → `ready`; Developer spawned.

---

## Leg Progress

### Leg 1 — picker-default-marker

- `buildContainerModel(containers, defaultId)` (`src/shared/container-menu.js`):
  added the `defaultId` param. Holder resolution: the row whose `id === defaultId`
  gets `isDefault: true`; when `defaultId` is null/undefined or dangling (matches
  no container in the list), the Burner sentinel carries it instead — mirrors
  `resolveNewTabContainer`'s fallback so the marker never lies about where a new
  tab actually routes. Single-arg calls keep working (`defaultId` undefined ⇒
  Burner marked).
- `src/renderer/renderer-globals.d.ts` (lines 348-353): updated the hand-written
  `declare function buildContainerModel` to add the `defaultId` param and
  `isDefault?: boolean` on the return shape — required per design-review H1, or
  the two-arg call site fails typecheck (TS2554).
- `src/renderer/renderer.js` (`openContainerOverlay`, line 352): call site now
  passes the module-state `defaultId`.
- `src/renderer/menu-overlay.js` (`renderMenu`): renders a trailing `.cm-default`
  badge (`textContent = 'Default'`) on any item with `isDefault: true`, appended
  after the label text node — dot leads, marker trails. Visible descendant text
  inside the `role="menuitem"` button contributes to the accessible name
  automatically (confirmed at design review), so no separate `aria-label` was
  needed.
- `src/renderer/menu-overlay.css`: new `.cm-default` rule — `.jar-nav-badge`
  (jars.css:128-136) precedent, scaled to the menu row's 12px font (9px badge
  text vs. the nav list's 10px); literal `--accent`/`#1e1f25` (`--accent-fg`
  equivalent) colors, matching this stylesheet's existing pattern of literal
  chrome-token copies rather than importing jars.css tokens.
- `test/unit/container-menu.test.js`: extended with 7 new tests (holder marked;
  Burner fallback on null/undefined/dangling `defaultId`; single-arg backward
  compat; action rows + separator never marked) plus the one design-review-
  mandated literal edit — the first test's Burner entry now asserts
  `isDefault: true` (single-arg call ≡ null default). All other existing tests
  untouched.
- Gates: `npm test` 1283/1283 (1277 baseline + 6 net new — the file grew from 9
  to 15 tests, one of which is a modified-not-added literal), `npm run
  typecheck` clean, `npm run lint` clean.
- No deviations from the leg spec; manual/HAT smoke of the live marker move
  (open picker → move default on jars page → reopen) was left to the operator
  per the leg's "manual smoke (FD or operator)" verification note — not part of
  the automated gates.

### Leg 2 design review (spec premise audit — needs rework → fixed at draft)

- One SEV-1 premise error caught before burning a live two-agent run: the spec
  required the chrome apparatus (`getChromeTarget` + `evaluate`) for the
  rename/delete mutations but explicitly withheld the admin key — and those ops
  are **admin-only** (scope.js:168 throws `automation: admin-only` for jar
  identities; `jar-delete-closes-tabs`'s own precondition requires the admin
  key for the same reason). The draft copied the apparatus but dropped its key
  requirement. Fixed: dual-mint launch (`GOLDFINCH_AUTOMATION_DEV_MINT=1` +
  `GOLDFINCH_AUTOMATION_ADMIN=1`), two client transports — jar key as the
  identity under test, admin key as apparatus only, never an assertion target.
- All other premises traced TRUE against the tree: per-request re-validation in
  `onRequest` (mcp-server.js:533, identity NOT cached at initialize); literal
  `writeHead(401)` before body read (curl header set irrelevant to reaching the
  gate); rename touches only name/color, never revokes; `handleRemove` returns
  `{ ok, removed, wiped }` and revokes in the same synchronous handler (so no
  admitted-but-crashing window — 401 is guaranteed to win the race, scope.js's
  own comment confirms deliberate).
- FD call: spec is `draft` — pre-first-run corrections are authoring, not
  drift. Fixed inline; leg 2 remains `ready`.

### Leg 1 — landed (gates 1283/1283, typecheck, lint)

- Implemented to spec, zero deviations; manual smoke of the live marker move
  deferred to operator per the leg's verification note. Details in Leg Progress.

### Leg 2 — verify-key-revocation (2026-07-11, landed)

- **`/behavior-test jar-key-revocation-on-delete`: PASS 5/5, first run.** Run
  log: `tests/behavior/jar-key-revocation-on-delete/runs/2026-07-11-05-12-54.md`.
  Live two-agent mode (persistent Executor + Validator via SendMessage),
  cache-cold on a fresh scratch stage (`XDG_CONFIG_HOME` redirect; operator's
  real profile and separately-running instance never touched).
- The chain under test held end to end: keyed jar's live MCP session admitted
  (step 1) → survived a rename, positive control (step 2) → jar deleted via the
  real user-path composition, `{ok:true, wiped:true}` (step 3) → the SAME live
  session's next request drew a bare auth-layer **401** (step 4) → fresh
  connect with the revoked key refused, with a concurrent valid-admin control
  proving key-specificity (step 5). No app restart, no session teardown —
  per-request re-validation did the work, as designed.
- **Run bonus**: an apparatus anomaly (idle admin session pruned server-side,
  drawing 404 "No valid session" under a still-VALID key) became an in-run
  negative control discriminating auth-layer 401 from session-routing 404 —
  the exact distinction the mixed-frame step needed. Promoted into the spec
  post-run (rejection-shape note + idle-pruning precondition), along with the
  step-2 rename return-shape correction (API returns the container record, not
  an `ok` envelope). Spec `draft` → `active`, Last Run stamped.
- Mission gap closed: the automation-degradation scenario the mission's Open
  Questions named is now live-witnessed and re-runnable.

### Flight review (deferred, after both legs) — issues fixed, then confirmed

- Reviewer (Sonnet, no Developer context) ran gates independently: 1283/1283,
  typecheck, lint — all green. Code findings: none high; marker semantics,
  backward compat, CSP/textContent discipline, accessible-name mechanism, and
  the full unit truth table all verified correct against the leg specs.
- Findings fixed before commit: MEDIUM — this flight log lacked leg 2's
  completion entry (added above); LOW ×3 — leg 1 + leg 2 checklist boxes
  unchecked despite landed status (checked), `.cm-default`'s color literal
  re-declared a token the sheet's own `:root` already defines (Developer
  continuation swapped it to `var(--bg)`; lint + typecheck re-run green).
- Artifact hygiene verified by the reviewer: no operator-identity leaks, no
  key material, run-log format consistent with the project's established
  convention.

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

- 2026-07-10: Flight chartered post-audit; branch `flight/05-mission-close-gaps`.
