# Flight Log: Vault Filter

**Flight**: [Vault Filter](flight.md)

## Summary

Landed 2026-09-23. Leg 1 `vault-filter` (behavior test 10/10 pass) and leg 2 `hat-and-alignment` (operator sign-off; H1 inline clear button, H3 access keys hidden while filtering) are complete. Squawks 0103 and 0104 were logged.

---

## Leg Progress

### Planning — design review (2026-09-22)

Architect review: **approve with changes**. Folded in:
- The filter-field append is gated at `render()`'s call site on
  `view.mode === 'unlocked'`. `buildVaultsGroupSection()` is built in both modes
  today (DD3).
- The late-vault semantics are explicit: `registerVault` marks a section loaded
  and runs a full `apply()`, an unloaded vault is never hidden, and the unit test
  asserts ancestor-level unhiding (DD1).
- Stale-registration guard for reads that resolve after a reset (DD1).
- A `[hidden]` override is needed only for `.vault-item-row` (the only author
  `display` rule), re-verified in the leg (DD1).
- "Other items" title-matching is defensive only (`metadataOf` throws on an
  unknown type) and covered by unit tests (DD2).
- The line budget's no-slack rule is noted as a deliberate departure from this
  pin's own buffer history (DD7).

Confirmed by the architect: `vault-unlock` is absent from
`AUTOMATABLE_MENU_TYPES`, admin `allowInternal` reaches `goldfinch://vault`, the
route-closure plan matches the sibling controllers, and the `FILTER_FIELDS` drift
guard matches the current `SCHEMA`.

### Flight Director Notes

- 2026-09-22: Loaded `.flightops/agent-crews/leg-execution.md` (structure valid).
  Flight moved `planning` → `in-flight`, and branch `flight/01-vault-filter` was
  created. Two legs: one autonomous (`vault-filter`) and one interactive
  (`hat-and-alignment`).
- **Leg 1 designed.** Refinement of flight DD1: the filter hides by toggling the
  class `vault-filter-out` (`display: none !important`) instead of the `hidden`
  attribute. `renderUnknownItems` already owns `hidden` on "Other items", and a
  filter writing `hidden` would clobber it. `!important` also makes the
  per-selector `[hidden]` overrides unnecessary. The behavior spec will observe
  "not displayed" rather than the attribute.
- **Leg 1 risk tier: HIGH.** It introduces a cache (the row registry) with a
  per-render lifecycle and a stale-read guard, it touches `render()`'s rebuild
  path, and it carries an unresolved live-region risk (AC10, a Divert criterion).
  A Developer design review runs before implementation.
- **Leg 1 design review** (Developer): **approve with changes**. All citations
  verified, and the reviewer confirmed that no path rebuilds item rows outside
  `render()`. Folded in:
  - AC10's primary mechanism is now a scoped `aria-live="off"` set by the
    controller, with `aria-busy` as a fallback only (it's timing-fragile in
    Chromium).
  - The stale guard is `isConnected` alone. The generation token is dropped as
    redundant, because every render builds fresh sections.
  - A shared internal `clearQuery()` serves both the clear button and the nav
    path; only the button returns focus.
- **FD ruling: a jar vault with zero item matches hides whole, including its
  Access-keys subsection.** Access keys are never a match target, and the
  operator's "a vault with no matches is removed" wins over the mission's
  "Access keys aren't filtered". That criterion means access keys are never
  filtered on their own. The operator can revisit this at alignment, and the
  behavior spec gains a check for it.
- The review changes were clarifications, so no second review pass was run. Leg 1
  is `ready`.

### vault-filter

Implemented to AC1–AC13.

**Built:**
- `src/shared/vault-page-model.js`: `FILTER_FIELDS` (frozen per-type field lists,
  byte-for-byte the DD2 taxonomy), `itemMatchesFilter(meta, query)` (trim, empty-matches-all,
  case-insensitive substring over the whitelisted string fields only, `['title']` fallback for
  an unknown/missing type), and `filterStatusText(count, active)` (empty inactive,
  singular/plural active, "No items match" at zero).
- `src/renderer/pages/vault-filter-controller.js` (new): `createVaultFilter(deps)` — the field/
  clear/status, a `Map<row, meta>` registry plus `Map<section, row[]>`, `registerVault`
  (isConnected-guarded, marks loaded + runs `apply()`), `reset()`, `apply()` (rows → subsections
  via a `section.children` walk + `.contains(row)`, never `querySelectorAll` — see Deviation 1 —
  → sections → status/clear-button), the nav capture-phase click listener (DD6/AC9), and the
  AC10 `aria-live="off"` scoping (see below). Hides via the `vault-filter-out` class
  (`display: none !important`), never the `hidden` attribute, per the leg's DD1 refinement.
- `src/renderer/pages/vault.js`: wiring only — `filter` constructed next to `nav` (ahead of the
  first `render()`/`refresh()`, TDZ checklist); `render()` calls `filter.reset()` before
  `root.textContent = ''`, and appends `filter.buildField()` to the "Vaults" group section only
  when `view.mode === 'unlocked'`; `renderItems`/`renderUnknownItems` now return their
  `{ row, meta }` pairs (`[]` on the empty-state path); `buildVaultSection`'s `vaultList().then`
  collects all five lists' pairs and calls `filter.registerVault(section, pairs)` once, after
  every list has rendered (DD1's atomic-registration requirement).
- `src/renderer/pages/vault.css`: `.vault-filter-field`/`-label`/`-input`/`-clear`/`-status`
  (modest styling, alignment leg owns polish) plus the `[hidden]`-beats-author-`display`
  override on `.vault-filter-clear` and the `.vault-filter-out { display: none !important; }`
  rule itself.
- `src/main/internal-page-map.js`: exact `/vault-filter-controller.js` route.
- Docs: CLAUDE.md's "Vault page — controller decomposition" bullet extended with a
  `vault-filter-controller.js` paragraph (incl. Deviation 1 below); the "Drift guard" exemplar
  list gained the `FILTER_FIELDS` ↔ `SCHEMA.nonSecret` guard; `docs/vault.md`'s internal-page
  a11y-gap paragraph gained a sentence noting the filter inherits that same gap.
- `tests/behavior/vault-filter.md`: finalized (observables = computed `display`/AX absence/the
  `vault-filter-out` class, exact status copy, the FD-ruling whole-vault-collapse check added to
  step 6, "kebab → Vault" noted), status set to `active`. **Not run** — that is the Flight
  Director's step, per the leg.

**Tests**: `test/unit/vault-page-model.test.js` 58/58 (11 new: matcher positive/negative per
type, trim/whitespace, non-string-ignored, unknown-type-by-title, the per-type
secret-key-never-matches negative, `filterStatusText`, and the `FILTER_FIELDS` ↔
`vault-item-schema.js` drift guard). New `test/unit/vault-filter-controller.test.js` 15/15
(hand-rolled mock DOM, the `vault-nav-controller.test.js` precedent, extended with
classList/isConnected/addEventListener+dispatchEvent — covers AC3–AC10: field shape/naming,
register-then-apply row/subsection/section hiding, the Access-keys-never-toggled-alone rule,
the all-empty-vault collapse, the "Other items" `hidden`-attribute-survives-a-cycle check, late
registration under an active query, the `isConnected` stale-registration guard, status text
incl. re-registration, clear-button behavior + focus return, `reset()`, the AC10
`aria-live="off"` scoping, and the three nav-click scenarios). Also updated (pre-existing
tests, now green): `test/unit/internal-page-map.test.js` (new route entry),
`test/unit/vault-browser-import-invariants.test.js` (its M19 F1 Leg 2 closed-set route-count
fixture, extended one more entry — same accounting discipline it already used for the Leg 3
HAT fix and the Flight 2 Leg 1 extraction), `test/unit/seam-contract.test.js`
(`VAULT_PAGE_LINE_BUDGET`). Full suite: `timeout 600 npm test` → 5676 pass / 0 fail / 4 todo
(pre-existing todos, unrelated). `npm run typecheck`, `npm run lint`, `npm run format` then
`npm run format:check` all clean.

**AC10 (live region) mechanism**: the primary scoped-`aria-live="off"` approach, exactly as the
leg specified — no `[BLOCKED:live-region]`. `registerVault` sets `aria-live="off"` directly on
the vault SECTION element the moment it takes ownership of it (i.e., right after that section's
rows have already been populated by `renderItems`/`renderUnknownItems`, but before the first
`apply()` runs against it). Because a nearer `aria-live` overrides an ancestor's for both the
element it's set on AND every descendant that carries no closer `aria-live` of its own, this one
attribute covers everything the filter subsequently toggles inside that section — rows,
subsections, and the section's own collapse — without needing a second scoping site. Two
properties made this the clean primary mechanism rather than a fallback: (1) it is set AFTER
that section's initial content already populated, so the section's own "vault items loaded"
population is not itself swallowed — only every SUBSEQUENT keystroke-driven toggle is; (2) it
never touches `#vault-root` itself or any non-filter-managed child of the ROOT (Settings, the
"Vaults" group header, a locked vault section — none of which ever call `registerVault`), so
ordinary page state-transition announcements (setup → locked → unlocked, etc.) are structurally
unaffected. `#vault-filter-status`'s own `role="status"` is untouched and remains the one live
announcement channel for filter results, exactly as DD5 specifies. `aria-busy` was not needed as
a fallback.

**Fix cycle 1 correction**: the original write-up above overstated the scope — it said the
mechanism "never touches... any non-filter-managed child", but `aria-live="off"` on the SECTION
also covers every descendant with no closer `aria-live` of its own, which includes the
`.vault-accesskeys` subsection `buildVaultSection` appends as a direct child of that SAME
section (a non-filter-managed subtree that renders content asynchronously after registration —
`refreshKeys()`/`renderAccessKeys` on every mint/revoke). That silenced Access-keys' own live
announcements, a real regression review caught (finding 1). Fixed by having `registerVault`
re-declare `aria-live="polite"` on every direct child of the section that is NOT a
`.vault-type-subsection` — a class-based rule (not a `.vault-accesskeys`-only special case) —
immediately after setting the section's own `"off"`. That restores `polite` inheritance for
Access-keys (and, harmlessly, the static title-row header) while leaving every type subsection
(filter-managed) covered by the section's `"off"` via inheritance, since none of them carry
their own `aria-live`. Unit-pinned: a new test asserts `.vault-accesskeys`' `aria-live` is
`"polite"` and both type subsections carry no own `aria-live` attribute after `registerVault`.
Pinned at the unit level (`registerVault` sets both attributes; a never-registered section is
untouched); the live announcement behavior itself is verified by the `vault-filter` behavior
test's `readAxTree` checks plus the operator's screen-reader spot-check at the
`hat-and-alignment` leg, per DD5/AC10.

**Measured line count**: `vault.js` landed at **2153 lines** after `npm run format`.
`VAULT_PAGE_LINE_BUDGET` set to exactly 2153 (no buffer) per DD7's explicit
pre-authorization; the test comment records the deliberate departure from this pin's own
"landed + buffer" history.

**Deviations from the leg spec (both judgment calls within "Acceptable variations" —
flight.md — plus DD7's own "approximately"):**

1. **The matcher is injected, not statically imported inside the controller** (DD7 literally
   says "plus the matcher via import"; Implementation Guidance #2 repeats it). Reason: a
   `./vault-page-model.js` flat-specifier import inside `src/renderer/pages/vault-filter-
   controller.js` only resolves through the internal-page-map's custom serving-path resolver
   at runtime — plain Node ESM resolution has no route from `src/renderer/pages/` to
   `src/shared/`. The two existing controllers that DO import it that way
   (`vault-restore-controller.js`, `vault-browser-import-controller.js`) are consequently
   tested only by reading their SOURCE AS TEXT (`vault-restore-workflow-invariants.test.js`,
   `vault-browser-import-invariants.test.js`) — neither is ever `import()`ed and executed in a
   unit test. That is incompatible with what the leg's own Verification Steps ask for ("mock
   DOM, the `vault-nav-controller.test.js` precedent") and with the flight's required test
   scenarios (register-then-apply, late registration, reset, clear-button focus, status text,
   subsection/section hiding) — all of which need a REAL execution against a fake DOM, not
   text pattern-matching. `vault-nav-controller.js` is the only vault-page controller that IS
   directly `import()`ed in its test, and it achieves that specifically by taking every shared
   dependency as an injected dep (mirroring `jars-section-controller.js`/`jars.js`, which does
   the same for `isSafeColor`/`PALETTE`/etc. from `jar-page-model.js`). I followed that second,
   more-established precedent instead: `vault-filter-controller.js` takes
   `itemMatchesFilter`/`filterStatusText` as deps, and `vault.js` imports them from
   `./vault-page-model.js` (already importing other exports from it) and passes them through.
   This is recorded in both the controller's own header comment and the CLAUDE.md addition.
   No behavior differs; only the dependency-acquisition shape differs from the leg's literal
   phrasing. Flagged here per the task instructions rather than silently substituted.
2. **`eslint.config.mjs`** needed a new entry (`src/renderer/pages/vault-filter-controller.js`
   added to the explicit `sourceType: 'module'` allowlist) — not called out in the leg's Files
   Affected list, but required for `export function createVaultFilter` to parse; every other
   ES-module page controller already carries this same explicit entry, so this is filling in a
   gap the leg's file list simply didn't enumerate, not a new pattern.

No other deviations. All thirteen ACs verified as implemented; AC12's gates and AC13's spec
finalization are both green per the above.

### vault-filter — fix cycle 1 (2026-09-22)

Addressed review findings:
- **Finding 1 (BLOCKING)**: `registerVault`'s section-wide `aria-live="off"` silenced the
  Access-keys subsection's own async announcements (mint/revoke `refreshKeys()`), a real AC10
  regression — see the corrected write-up inline in the AC10 section above. Fix:
  `registerVault` now re-declares `aria-live="polite"` on every direct child of the section that
  is NOT `.vault-type-subsection` (structural, class-based — covers `.vault-accesskeys` and the
  static title-row header, and any future non-filter-managed child with no edit needed here).
  `src/renderer/pages/vault-filter-controller.js`'s header comment and `registerVault`'s own
  comment were both updated to describe the actual scoping. Added a unit test asserting
  `.vault-accesskeys`' `aria-live` is `"polite"` after `registerVault` while both type
  subsections carry no own `aria-live` (still covered by the section's `"off"` via
  inheritance) — `test/unit/vault-filter-controller.test.js`. `vault.js` was not touched; its
  line count is unchanged at 2153, so `VAULT_PAGE_LINE_BUDGET` needed no re-measurement.
- **Finding 2 (non-blocking)**: checked off all 13 AC checkboxes in the leg artifact (verified
  above) and the flight.md Checkpoints "Matcher + drift guard green" / "Controller + wiring
  green". Left the Post-Completion Checklist and the flight.md Legs-list checkbox for the
  Flight Director's commit step; the leg's own status field is left as-is (not `completed`).
- Also noted in `tests/behavior/vault-filter.md` (Preconditions, step 1, Observables Required):
  minting an access key goes through the chrome-owned step-up sheet (master password
  re-entry), which is outside `AUTOMATABLE_MENU_TYPES` — an operator step when the jar vault
  has no key yet, same shape as the existing unlock-is-operator-only note.

**Gates re-run after the fix**: `timeout 600 npm test` → 5677 pass / 0 fail / 4 todo (pre-existing,
unrelated) — includes the new aria-live test. `npm run typecheck`, `npm run lint` both clean.
`npm run format` reformatted only `vault-filter-controller.js` (the new block's line wrapping);
`npm run format:check` clean after. `vault.js` line count re-confirmed at 2153, matching
`VAULT_PAGE_LINE_BUDGET` (unchanged).
- **Flight review** (Reviewer, cycle 1): one blocking issue. The AC10
  `aria-live="off"` on a whole section silenced the Access-keys mint/revoke
  announcements. The FD chose a fix over documenting a trade-off: non-type-subsection
  children re-declare `polite`. Checkbox hygiene was also flagged. A Developer fix
  cycle ran.
- **Flight review** (Reviewer, cycle 2): **`[HANDOFF:confirmed]`**. Gates were
  green: 5677 pass / 0 fail / 4 todo, and `vault.js` is 2153, equal to the budget.
  One non-blocking residual: a collapsed-then-reshown jar section's re-declared-polite
  children (the title row and access keys) may re-announce on re-show. This is
  uncertain AT behavior, so it's folded into the `hat-and-alignment` screen-reader
  spot check, named explicitly in flight.md.
- **Commit plan**: the code and artifacts are committed now, with leg 1 kept at
  `landed`. It moves to `completed` only after the `vault-filter` behavior test
  passes on the live app. That run needs the admin MCP apparatus plus the operator
  for unlock and the access-key mint.
- **Behavior test `vault-filter`: PASS**, 10/10 checkpoints (run log
  `tests/behavior/vault-filter/runs/2026-09-23-17-09-28.md`).
  - Checkpoint 7 was Validator-INCONCLUSIVE under the apparatus-focus rule and
    resolved PASS by operator by-eye confirmation of the focus ring.
  - Spec deviation: "Home" was seeded in Work because Personal already held its one
    identity. The spec's Preconditions are now amended.
  - Apparatus: the dev instance was relaunched with ADMIN + DEV_MINT and bound
    49708. An attach-only client was used.
  - Two crew apparatus notes were landed in
    `.flightops/agent-crews/behavior-tests-execution.md`: `hasFocus` is
    page-scoped, and the tag-the-node refresh check (the Mission 21 debrief's
    "recommendations as actions" rule).
- **Leg 1 `vault-filter` → completed.**
- **Squawk 0103 logged (routine, deferred to the next turnaround):** the vault page
  still says "Unlock the manager…" and "lock the manager". Squawk 0102 missed
  these. It was found incidentally at checkpoint 10 and is out of this flight's
  scope.

### hat-and-alignment

- **HAT H1 fix (2026-09-23)**: operator feedback — "the × should be inside the
  box, otherwise everything looks good." `buildField()`
  (`src/renderer/pages/vault-filter-controller.js`) no longer nests the input
  inside the `<label>` (a `<button>`-inside-`<label>` is bad semantics); the
  input and clear button now share a new `span.vault-filter-box` sibling of the
  label, with the label carrying an explicit `for="vault-filter"` association
  instead (accessible name unchanged: "Filter items"). `vault.css` gained
  `.vault-filter-box` (`position: relative`) and repositioned `.vault-filter-
  clear` `position: absolute` at the box's right edge, vertically centered via
  `top: 50%; transform: translateY(-50%)`; `.vault-filter-input` gained right
  padding (28px) so typed text never runs under the ×, and the clear button's
  `:focus-visible` outline offset went negative (`-2px`) so the ring stays
  inside the box instead of colliding with the input's own ring. All frozen
  hooks (`#vault-filter`, `#vault-filter-clear`, `#vault-filter-status`,
  `vault-filter-out`, the button's `aria-label`/native `<button>`/`hidden`
  toggling, tab order input → clear, focus-return-on-clear) are unchanged.
  `vault.js` was not touched — no `VAULT_PAGE_LINE_BUDGET` re-measurement
  needed.
  - `test/unit/vault-filter-controller.test.js`: `fieldParts` updated for the
    new box wrapper; added assertions that the input and clear button share the
    same `.vault-filter-box` parent and that neither is a label descendant, plus
    a check on the label's new `for` attribute.
  - Gates: `timeout 600 npm test` → 5677 pass / 0 fail / 4 todo (pre-existing,
    unrelated). `npm run typecheck`, `npm run lint`, `npm run format` (no
    changes — already Prettier-clean), `npm run format:check` all clean.
  - Live-app visual verification via the admin MCP apparatus (port 49708):
    reloaded the `goldfinch://vault` tab (internal-session `reload`/`navigate`
    are refused for automation, so used `evaluate` → `location.reload()`,
    which the internal session DOES permit under the admin tier), typed "al"
    into `#vault-filter`, and captured a screenshot confirming the × sits
    inside the field's right edge, vertically centered, with the "al" text
    clear of it. Saved to
    `/tmp/behavior-tests/goldfinch/vault-filter/hat/h1-filter-clear-inside-box.png`
    (scratch/local, not part of the repo). Cleared the field again afterward.
- **H1 verified by operator (2026-09-23)**: "looks great." No further changes
  requested.
- **H2 (feel): pass.** The operator typed several queries and cleared; filtering
  read as immediate, with no jank or layout jumps flagged.
- **H3 (no-match + access keys) ruling (2026-09-23)**: the operator reviewed
  the "No items match" state and the access-keys behavior, and OVERTURNED the
  leg 1 FD ruling. Operator's own words: "I think it's more confusing to
  include the access keys and that's not what people are going to be
  searching for in the first place, let's exclude." FD interpretation,
  announced back to the operator: while a filter query is active (non-empty
  after trim), every jar vault's Access-keys subsection is hidden, regardless
  of whether that vault has item matches; with an empty query the page is
  exactly as before (access keys visible). This replaces the narrower
  zero-match-only rule.
  - **Implemented**: `vault-filter-controller.js`'s `apply()` now toggles
    `vault-filter-out` directly on a loaded section's `.vault-accesskeys`
    child by `active` alone (see the new `ACCESSKEYS_CLASS` constant and the
    updated subsection/section walk). Access keys are still never registered,
    never a match target, and never feed the status count — only the hide
    condition changed. The fix-cycle-1 `aria-live="polite"` re-declaration on
    non-type-subsection children (incl. `.vault-accesskeys`) is unchanged:
    mint/revoke announcements still fire correctly whenever the element is
    actually displayed (query empty, or since cleared).
  - `vault.js` was not touched; `VAULT_PAGE_LINE_BUDGET` needed no
    re-measurement (confirmed: `vault.js` is 2152 lines, budget 2153, test
    uses `<=`).
  - Tests: `test/unit/vault-filter-controller.test.js` — renamed the old
    "Access-keys subsection is never itself toggled" test to
    `HAT H3: Access-keys hides directly whenever the query is active, even
    when its vault HAS matches, and shows again once the query clears`
    (covers: query-active-with-matches → access keys hidden while the
    section stays visible; query-active-zero-matches → both hidden; query
    cleared → access keys visible again); added a new test for an unloaded
    vault's access keys staying untouched by an active query. 17/17 pass (was
    15; net +2 after the rename/split).
  - Gates re-run: `timeout 600 npm test` → 5678 pass / 0 fail / 4 todo
    (pre-existing, unrelated). `npm run typecheck`, `npm run lint` both
    clean. `npm run format` reformatted only the new test assertions'
    line-wrapping; `npm run format:check` clean after.
  - Live verification via the admin MCP apparatus (port 49708): reloaded
    `goldfinch://vault`, set `#vault-filter` to `mail.example` (`evaluate`:
    set `.value` + dispatch `input`), and confirmed via `evaluate` that
    `section#vault-personal` is displayed, its `.vault-accesskeys` carries
    `vault-filter-out` with computed `display: none`, and the "Beta Mail" row
    is displayed. Screenshot saved to
    `/tmp/behavior-tests/goldfinch/vault-filter/hat/h3-accesskeys-hidden.png`
    (scratch/local). Cleared the field (`.value = ''` + `input` dispatch) and
    confirmed `.vault-accesskeys` no longer carries `vault-filter-out` (access
    keys displayed again). Left the field empty afterward.
- **Artifacts re-authored to match the H3 ruling** (deliberate spec/doc
  amendments, not silent edits): `tests/behavior/vault-filter.md` (a new
  header note plus steps 5–7's Expected Results and the Preconditions/Out-of-
  Scope wording), `mission.md`'s first success criterion, and `flight.md`
  (a new "HAT amendment" note appended after DD1, leaving the original leg 1
  FD ruling text intact as history rather than rewriting it).
- **H4** pass: the operator tested a nav click on a hidden vault, and the
  save-while-filtering reset is acceptable.
- **H5** waived: the operator skipped the screen-reader spot check. Speech
  behavior, including the collapsed-vault re-show residual, stays unverified by
  ear. The AX roles and names were verified by the behavior test.
- **H6** sign-off: "pass, looks good", given after an app relaunch to pick up the
  H3 code.
- **HAT review** (Reviewer): `[HANDOFF:confirmed]`. 5678 pass / 0 fail / 4 todo,
  and gates clean.
- **Squawk 0104 logged** (routine): in a running dev session, edits to
  internal-page ES modules stay stale across `location.reload()` until the app is
  relaunched. Found during H3's live verification.
- **Leg 2 `hat-and-alignment` → completed. Flight → landed.** Behavior spec
  steps 5–7 were re-authored for H3. The next `vault-filter` run exercises the new
  access-keys rule. The last run (2026-09-23-17-09-28) predates it.
