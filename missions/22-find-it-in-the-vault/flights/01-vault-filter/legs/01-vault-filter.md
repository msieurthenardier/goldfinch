# Leg: vault-filter

**Status**: landed
**Flight**: [Vault Filter](../flight.md)

## Objective

Ship the page-wide vault filter end to end. That means a pure whitelist matcher
with a schema drift guard, a `vault-filter-controller.js` that owns the field,
the clear button, the status line, the row registry, and the nav-clear behavior,
thin `vault.js` wiring, CSS, the internal-page route, the line-budget pin, and
docs. Finish with the finalized `vault-filter` behavior spec.

## Context

- Flight DDs 1–9 govern. Key points:
  - hide, don't re-render; a vault registers its rows once its list loads, and an
    unloaded vault is never hidden (DD1);
  - a phrase matcher over the whitelist, with the drift guard (DD2);
  - the field is appended only when the page is unlocked, and it's called a
    filter, never search (DD3);
  - the filter lasts one render (DD4);
  - a single `role="status"` count (DD5);
  - a nav click clears the filter when the filter hides the target (DD6);
  - a controller module plus an exact route (DD7);
  - the frozen DOM hooks (DD9).
- **Leg-level refinement of DD1 (hide mechanism): a class, not the `hidden`
  attribute.** The filter toggles a dedicated class, `vault-filter-out`, backed by
  `.vault-filter-out { display: none !important; }`, rather than writing `hidden`.
  There are two reasons:
  1. `renderUnknownItems` already owns `hidden` on the "Other items" subsection
     (hidden when empty). A filter that writes `hidden` would clobber that base
     state when the query clears.
  2. `!important` beats every author `display` rule, including
     `.vault-item-row { display: flex }`, so no per-selector `[hidden]` overrides
     are needed.

  `display: none` also removes elements from the accessibility tree, which is
  what DD1 wanted from `hidden`. Record this refinement in the flight log's
  Flight Director Notes. The behavior spec observes "not displayed" (computed
  `display: none` or absent from the AX tree), not the attribute.
- Carried from planning: `buildVaultsGroupSection()` is built in both locked and
  unlocked modes today, so the unlocked gate is new code at `render()`'s call site.
  `metadataOf()` throws on unknown types, so "Other items" filtering is unit-test
  only.

## Inputs

- `src/renderer/pages/vault.js` (2,107 lines; `VAULT_PAGE_LINE_BUDGET = 2150` in
  `test/unit/seam-contract.test.js`).
- `src/shared/vault-page-model.js` (pure ESM, already routed) and
  `src/shared/vault-item-schema.js` (CJS `SCHEMA`/`ITEM_TYPES`, main-only).
- `src/renderer/pages/vault-nav-controller.js`: the injected-deps controller
  precedent and its mock-DOM test `test/unit/vault-nav-controller.test.js`.
- `src/main/internal-page-map.js` vault entry tree (`/vault-nav-controller.js`
  route precedent).
- Draft spec `tests/behavior/vault-filter.md`.

## Outputs

- `src/shared/vault-page-model.js`: `FILTER_FIELDS`, `itemMatchesFilter`, and
  `filterStatusText(count, active)` (the pure count/no-match copy, singular/plural).
- `src/renderer/pages/vault-filter-controller.js`: `createVaultFilter(deps)`.
- `src/renderer/pages/vault.js`: wiring only.
- `src/renderer/pages/vault.css`: field/clear/status styles plus `.vault-filter-out`.
- `src/main/internal-page-map.js`: the `/vault-filter-controller.js` route.
- Tests: `test/unit/vault-page-model.test.js` (matcher + drift guard + status copy),
  new `test/unit/vault-filter-controller.test.js`, and
  `test/unit/seam-contract.test.js` (budget).
- Docs: CLAUDE.md Password-vault "controller decomposition" bullet, and
  `docs/vault.md` if it describes the page UI.
- `tests/behavior/vault-filter.md`: finalized, status `active`.

## Acceptance Criteria

- [x] **AC1 (matcher)**: `itemMatchesFilter(meta, query)` trims the query; an empty
      query matches everything. Otherwise it returns true iff some **string** value
      among `FILTER_FIELDS[meta.type]` (or `['title']` for an unknown or missing
      type) contains the query, case-insensitively (`toLowerCase` on both sides). It
      reads no other key. Unit-tested:
      - a positive match for every field of every type;
      - case-insensitivity, a whitespace-only query, and a non-string value
        (`null`/number) ignored without throwing;
      - an unknown type matching by title only;
      - **per type, a negative where the query appears only in a stray secret key**
        on the meta (`password`, `notes`, `totp` / `number`, `cvv` / `body` /
        `email`, `street`) and in `hasTotp`/`matchMode`/`id`.
- [x] **AC2 (drift guard)**: a unit test `require()`s `vault-item-schema.js` and
      asserts `FILTER_FIELDS[t]` deep-equals `SCHEMA[t].nonSecret` for every `t` in
      `ITEM_TYPES`, and that `Object.keys(FILTER_FIELDS)` equals `ITEM_TYPES` (as
      sets).
- [x] **AC3 (field + controls)**: when the page is unlocked, the "Vaults" group
      section (`#vault-vaults`) contains, below its lede:
      - `input#vault-filter` (`type="text"`, with an accessible name containing
        "Filter");
      - `button#vault-filter-clear` (a native button, `aria-label="Clear filter"`),
        hidden while the field is empty;
      - `#vault-filter-status` with `role="status"`.

      No element in the feature uses "search" in its id, class, name, label, role, or
      `type`. When the page is locked or not set up, none of these exist.
- [x] **AC4 (filtering)**: each `input` event runs a full apply.
      - A row that doesn't match gets `vault-filter-out`.
      - A `.vault-type-subsection` (including the unknown one) whose vault is
        **loaded** and that has no visible registered row gets `vault-filter-out`
        while a query is active.
      - A vault section (`section.vault-child-section`) gets `vault-filter-out` under
        the same rule.
      - An **unloaded** vault section and its subsections never get it.
      - The Access-keys subsection is never registered or toggled by itself. **It
       disappears with its vault section when that jar vault has zero item
       matches.** That is an accepted trade-off (FD ruling, recorded in the flight
       log): access keys are never a match target, and "a vault with no matches is
       removed" wins. The operator can revisit this at alignment.
      - An empty query removes every `vault-filter-out`.
      - The filter never writes the `hidden` attribute, so the "Other items"
        subsection's own `hidden` survives a filter/clear cycle (unit-tested).
- [x] **AC5 (late vault)**: `registerVault(sectionEl, pairs)` marks the section
      loaded and runs apply, so a vault registered while a query is active arrives
      already filtered. Unit-tested: section A is registered, the query is set, and
      section B (unloaded) stays visible; then B registers:
      - B's non-matching rows and emptied subsections are hidden;
      - B's section is hidden iff it has zero matches;
      - a matching row in B makes B's section visible.

      A `registerVault` for a section that is not `isConnected` is ignored
      (unit-tested). `render()` always builds fresh section elements, so a stale
      `.then` from a prior render always targets a disconnected section. That makes
      `isConnected` the load-bearing guard, and no generation token is needed.
- [x] **AC6 (status)**: `#vault-filter-status` text is `filterStatusText(n,
      active)`:
      - empty when inactive;
      - "1 item matches" / "N items match";
      - "No items match" at zero.

      It updates on every apply, including a late `registerVault`. It is the only
      element the filter writes status text to.
- [x] **AC7 (clear)**: activating `#vault-filter-clear` empties the field, runs
      apply (all rows, subsections, and sections are visible again, and the status is
      empty), hides the button, and focuses `#vault-filter`.
- [x] **AC8 (lifetime)**: `render()` calls `filter.reset()` before rebuilding. That
      clears the query and the registry. After any
      `refresh()` the field (if unlocked) is empty and nothing carries
      `vault-filter-out`. After a lock, the field is absent.
- [x] **AC9 (nav)**: a capture-phase `click` listener on the nav element, installed
      once at construction, clears the filter (as AC7, without moving focus) when the
      clicked `a[href^="#vault-"]` targets a section currently carrying
      `vault-filter-out`. The default hash navigation then proceeds unprevented.
      Clicks on visible targets leave the filter unchanged. Unit-tested. The
      controller keeps an internal `clearQuery()` (empty + apply + update the clear
      button) that both paths share. Only the clear-button handler adds the
      focus-return step.
- [x] **AC10 (live region)**: filter-driven show/hide inside `#vault-root`
      (`aria-live="polite"`) must not produce announcements beyond the status
      element. The leg picks and documents a mechanism, and the verification
      records the approach, for the operator's screen-reader spot-check at
      alignment. **Primary candidate**: scope `aria-live="off"`, set dynamically by
      the controller (never in `vault.html`), on the elements whose visibility the
      filter toggles or on their containers. A nearer `aria-live` overrides the
      root's `polite`. `#vault-filter-status`'s own `role="status"` (implicit
      `polite`) stays a live region regardless. Keep the vault sections as direct
      children of `#vault-root`, because the scroll-spy reads `root.children`, so
      don't introduce a wrapper around them. `aria-busy` toggled synchronously
      around the writes is a **fallback only**: Chromium serializes accessibility
      changes after the task yields and may see only the final state. The mechanism
      must not change announcement behavior for any non-filter render, beyond what
      the leg documents. If no such mechanism exists without restructuring the
      page's live region, stop and emit `[BLOCKED:live-region]` (flight Divert
      criterion).
- [x] **AC11 (shape + budget)**: the controller has no bridge/IPC access.
      - `internal-page-map.js` has an exact `/vault-filter-controller.js` route.
      - `internal-page-route-closure.test.js` passes.
      - `VAULT_PAGE_LINE_BUDGET` equals `vault.js`'s landed count, measured after
        `npm run format`. Its comment records the deliberate no-buffer departure
        (flight DD7).
      - The seam contract (`SEAM_COUNT`) is unchanged.
      - All user-supplied/metadata strings are set via `textContent` only.
- [x] **AC12 (gates)**: `npm test`, `npm run typecheck`, `npm run lint`,
      `npm run format:check` are all green.
- [x] **AC13 (spec)**: `tests/behavior/vault-filter.md` is finalized against the
      shipped hooks and mechanism ("not displayed" rather than `hidden`, exact status
      copy) and set to `active`. Running it is the Flight Director's step after
      review, not the Developer's.

## Verification Steps

- AC1/AC2/AC6: `node --test test/unit/vault-page-model.test.js`.
- AC3–AC5/AC7–AC9: `node --test test/unit/vault-filter-controller.test.js` (mock
  DOM, the `vault-nav-controller.test.js` precedent), plus a source read of the
  `vault.js` wiring (`render()` reset, unlocked-only append, `registerVault` in
  `buildVaultSection`'s `.then`).
- AC3 naming: `grep -rn -i "search" src/renderer/pages/vault-filter-controller.js`
  returns no hits, plus the same grep over the added `vault.js`/`vault.css` hunks
  in the diff.
- AC10: the Developer records the mechanism and its reasoning in the flight log;
  the live check is the behavior test's AX read plus the alignment spot-check.
- AC11/AC12: `timeout 600 npm test`, `npm run typecheck`, `npm run lint`,
  `npm run format && npm run format:check`, and
  `node -e "console.log(require('fs').readFileSync('src/renderer/pages/vault.js','utf8').split(/\r?\n/).length)"`
  matching the pin.

## Implementation Guidance

1. **Matcher** (`vault-page-model.js`): add `FILTER_FIELDS` (a frozen object of
   frozen arrays), `itemMatchesFilter`, and `filterStatusText`. Export them in the
   existing export block. Add the tests to `vault-page-model.test.js`, following that
   file's style.
2. **Controller** (`src/renderer/pages/vault-filter-controller.js`): export
   `createVaultFilter({ document, navEl })`. It imports
   `itemMatchesFilter`/`filterStatusText` via the flat specifier
   `./vault-page-model.js`, with `// @ts-ignore` if tsc can't resolve it, per the
   src/shared ESM convention. The page file lives in `src/renderer/pages/`, so
   check how `vault-nav-controller.js` / `vault.js` import `vault-page-model.js` and
   copy that exactly.
   - State: `query`, a registry `Map<row, meta>`, a `Set` of loaded sections,
     and the built field elements.
   - `buildField()` creates a wrapper containing the label or `aria-label`, the
     input, the clear button, and the status. It wires `input` → set query + apply +
     update the clear button, and clear-click → AC7. It returns the wrapper and
     replaces any prior refs.
   - `registerVault(sectionEl, pairs)`: check the guard, add the pairs to the
     registry, add the section to the loaded set, then run apply.
   - `reset()`: clear the query, registry, loaded set, and field refs.
   - `apply()`:
     1. Evaluate rows.
     2. For each loaded section, compute each `.vault-type-subsection` within it by
        whether it contains a visible registered row (use `closest()` from rows, or
        `contains()`).
     3. Compute each section.
     4. Write the status.
   - Count only registered rows that are visible.
   - The nav listener: `navEl.addEventListener('click', handler, true)` once, at
     construction.
   - The stale guard is `sectionEl.isConnected` alone (see AC5).
3. **Wiring** (`vault.js`): keep it minimal.
   - Construct `filter` next to `nav`.
   - In `render()`: `filter.reset()` near the top, before `root.textContent = ''`.
     After `buildVaultsGroupSection()`, if `view.mode === 'unlocked'`, append
     `filter.buildField()` to that section.
   - `renderItems`/`renderUnknownItems` return `{ row, meta }` pairs (an empty array
     for the empty-state path).
   - `buildVaultSection` collects the pairs from every list render in its `.then`,
     and calls `filter.registerVault(section, pairs)`.
   - Watch the TDZ checklist (CLAUDE.md): `filter` must be constructed before the
     first `render()`/`refresh()` call.
4. **Live region (AC10)**: use the scoped `aria-live="off"` approach first, as
   described in AC10, and `aria-busy` only as a fallback. Document the choice and
   its reasoning in the flight log. Don't touch `vault.html`'s attribute
   page-wide.
5. **CSS** (`vault.css`): `.vault-filter-out { display: none !important; }` plus
   modest field/clear/status styles, matching existing `.vault-field`/`.vault-btn`
   tokens. The visual polish is the alignment leg's job (DD3: constraints only).
6. **Route**: add `'/vault-filter-controller.js': rendererPage('vault-filter-controller.js')`
   beside the nav-controller route, with a one-line comment.
7. **Budget**: run `npm run format`, measure, and set `VAULT_PAGE_LINE_BUDGET` to
   the measured value. Update its comment (Mission 22 F1: landed at N, no buffer,
   deliberate departure per operator pre-authorization).
8. **Docs**:
   - CLAUDE.md: extend the Password-vault "Vault page — controller decomposition"
     bullet with one or two sentences on `vault-filter-controller.js`. Cover the
     registry reset per render, `registerVault` on load, the class-based hide, and
     the `FILTER_FIELDS` ↔ `SCHEMA.nonSecret` drift guard. Also mention the drift
     guard in the "Drift guard" exemplars list.
   - `docs/vault.md`: a sentence if it describes the vault page's UI.
9. **Spec**: finalize `tests/behavior/vault-filter.md` (observables = computed
   display / AX absence, exact status strings, the class name), set it to `active`,
   and add a preconditions note on how to open the page.

## Edge Cases

- **A read resolving after `render()`** (stale section): ignored (AC5).
- **A read failure (`.catch`)**: the section never registers and stays visible.
  The existing `res.locked` → `refresh()` path resets anyway.
- **An empty vault** (zero items; subsections show "No … yet"): once loaded with a
  query active, it has no matches, so it is hidden. With the query empty it shows
  as today.
- **Typing before any vault loads**: the status shows the count of registered
  matches so far (possibly "No items match" briefly) and updates as vaults
  register. That's acceptable; a loaded-all distinction isn't required.
- **A meta with a missing or non-string title**: ignored for matching, never
  throws.
- **The editor modal** lives on `document.body`, outside `#vault-root`, so it is
  unaffected.
- **Focus**: the field is rebuilt on refresh (DD4), so focus is lost after a save
  while typing. That's accepted by ruling.

## Files Affected

- `src/shared/vault-page-model.js`: the matcher, fields, and status copy.
- `src/renderer/pages/vault-filter-controller.js`: new.
- `src/renderer/pages/vault.js`: wiring.
- `src/renderer/pages/vault.css`: styles plus `.vault-filter-out`.
- `src/main/internal-page-map.js`: the route.
- `test/unit/vault-page-model.test.js`, `test/unit/vault-filter-controller.test.js`
  (new), `test/unit/seam-contract.test.js`.
- `CLAUDE.md`, `docs/vault.md` (if applicable).
- `tests/behavior/vault-filter.md`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)

## Citation Audit

Verified 2026-09-22 against `main` @ `8387832`:
- `vault.js` is 2,107 lines.
- `render()` (`root.textContent = ''` at the rebuild, `buildVaultsGroupSection()`
  called for both modes).
- `buildVaultSection` (`bridge.vaultList(vaultId).then` → `partitionItemsByType` →
  `renderItems` per `ITEM_SUBSECTIONS`, `renderUnknownItems`).
- `renderUnknownItems` sets `sub.subsection.hidden`.
- `buildVaultsGroupSection` (`#vault-vaults`, h2 "Vaults", `.vault-lede`).
- `vault.css` `.vault-item-row { display: flex }`.
- `vault.html` `#vault-root aria-live="polite"`.
- `seam-contract.test.js` `VAULT_PAGE_LINE_BUDGET = 2150`.
- `internal-page-map.js` `/vault-nav-controller.js` route.
- `vault-item-schema.js` `SCHEMA`/`ITEM_TYPES` exports.
- `vault-nav-controller.js` `createVaultNav(deps)`; the nav entries are plain
  `<a href="#vault-<id>">`.
