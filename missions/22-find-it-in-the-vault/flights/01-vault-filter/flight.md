# Flight: Vault Filter

**Status**: landed
**Mission**: [Find It in the Vault](../../mission.md)

## Contributing to Criteria

- [ ] One filter field filters every vault.
- [ ] Non-matching items are removed from the page (plus emptied subsections and
      vaults, plus a worded no-match state).
- [ ] Matching uses only the non-secret fields listed in the mission's Context.
- [ ] A clear control restores the full page.
- [ ] A page refresh resets the filter cleanly *(behavior-test-backed)*.
- [ ] Locking clears the filter.
- [ ] Accessible *(behavior-test-backed, via the live accessibility tree)*.
- [ ] Built in the page's existing shape.

This single flight carries every mission criterion.

---

## Pre-Flight

### Objective

Add one page-wide filter field to the unlocked `goldfinch://vault` page, in the
"Vaults" group section above the per-vault sections. Typing narrows every vault's
items to those whose non-secret metadata contains the typed phrase
(case-insensitive). Non-matching rows disappear, along with any type subsection and
any vault section left with no matches. A visible match count (also announced to
screen readers) and a worded no-match state report the result. A clear (×) button
restores everything. The filter is display-only and lives only as long as the
current render: any page refresh or lock resets it. A pure matcher in
`vault-page-model.js` and a new `vault-filter-controller.js` hold the logic, so
`vault.js` gains only wiring.

### Open Questions

- [x] Left-hand nav entries for vaults the filter has hidden? → DD6 (a click on
      a hidden vault's nav entry clears the filter, then jumps).
- [x] Visible match count, or screen-reader-only? → DD5 (visible and announced).
- [x] Escape clears the field? → No (operator ruling). It can be revisited at
      alignment.
- [x] Single phrase or every-word matching? → DD2 (single phrase).
- [x] Is "Other items" (unknown-type) filtered? → DD2 (title only).
- [x] Must the filter survive a refresh? → No (mission ruling). DD4 resets it.

### Design Decisions

**DD1: Hide, don't re-render. Each vault registers its rows once its list loads.**
`renderItems` (and `renderUnknownItems`) return the `{ row, meta }` pairs they
built. When a vault's `vaultList` read resolves and all of its type lists have been
rendered, `buildVaultSection` calls `filter.registerVault(sectionEl, pairs)`. That
call marks the vault section as **loaded** and runs a full, page-wide `apply()`,
which is cheap at realistic item counts. `apply()` is the single reconciliation
point, and input events call it too. It sets:
- a row's `hidden` to "query active and the row doesn't match";
- a type subsection's `hidden` to "query active, its vault is loaded, and no
  registered row inside it is visible";
- a vault section's `hidden` by the same rule, one level up.

**A vault that hasn't loaded yet is never hidden.** Its rows don't exist, and
"no rows" doesn't mean "no matches". Once it loads, the same `apply()` decides its
fate, so a late vault picks up the live query at the moment it registers. A vault
whose read fails (`.catch`) stays unloaded, and therefore visible, exactly as
today. An empty vault that loaded (zero items) is hidden while a query is active,
because it has no matches.

**Stale registrations are dropped.** A `vaultList` read from a previous render
can resolve after `render()` has reset the controller. `registerVault` ignores a
section that is no longer connected (`!sectionEl.isConnected`), or one from an
older render generation, so the registry only ever holds rows on the live page.
The registry's source of truth is the current render. It is rebuilt at every
`render()` (via `reset()`), never refreshed piecemeal, and no path re-renders a
single vault's item lists without a full `render()`. The leg re-verifies that
last point.
- Rationale: The item lists already load asynchronously per vault. Registering at
  render time makes a late-arriving vault pick up the live query the moment its rows
  exist, which satisfies the mission's "late-arriving vaults read the live query"
  constraint without touching the `vaultList` read path. Hiding (rather than
  rebuilding lists) keeps the item rows, their buttons, and the editor wiring
  untouched, and `hidden` removes elements from both layout and the accessibility
  tree.
- **CSS constraint (load-bearing)**: an author `display` rule beats the UA
  `[hidden] { display: none }` (`vault.css`'s existing `.vault-field[hidden]`
  override exists for exactly this reason). `.vault-item-row` is `display: flex`, so
  without an explicit `.vault-item-row[hidden]` override every "removed" row would
  stay visible. `.vault-type-subsection` and `.vault-child-section` carry no
  `display` rule today, so the UA rule already works for them. The leg re-verifies
  that when it adds its CSS, and adds an override only where an author `display`
  rule exists. A source-scan check pins the row override.
- Trade-off: Rows exist in the DOM while hidden. That is harmless here, because the
  page already holds only metadata.

**HAT amendment (H3, 2026-09-23, hat-and-alignment leg): Access-keys hides
whenever a query is active, unconditionally.** The leg 1 FD ruling above
("a jar vault with zero item matches hides whole, including its Access-keys
subsection") is superseded. At alignment the operator reviewed the no-match
state and ruled: "I think it's more confusing to include the access keys and
that's not what people are going to be searching for in the first place,
let's exclude." The controller now toggles `vault-filter-out` on a loaded
section's `.vault-accesskeys` child directly whenever `query.trim()` is
non-empty — independent of whether that section's own items matched — and
removes it whenever the query is empty. Access keys are still never a match
target and never feed the status count; only the *when it hides* rule
changed, from "only alongside a zero-match vault" to "whenever filtering is
active at all". See `flight-log.md`'s `hat-and-alignment` entry.

**DD2: The matcher is pure, phrase-based, and whitelist-driven.**
`vault-page-model.js` exports `FILTER_FIELDS` (per-type field lists) and
`itemMatchesFilter(meta, query)`. The query is trimmed. An empty query matches
everything. Otherwise the check is a case-insensitive
(`toLowerCase`) substring match of the whole phrase against each whitelisted field
value that is a string. Only `FILTER_FIELDS[meta.type]` is read. An unknown type
matches on `title` alone. That rule is **defensive only**: `metadataOf()` throws on
an unknown type, so a live "Other items" row can't be produced today. It is covered
by unit tests with synthetic meta, never by the behavior test. `hasTotp`, `matchMode`, `id`, and every other key are
never read.
- `FILTER_FIELDS` = login: title, username, origin; card: title, cardholder, brand,
  last4; identity: title, fullName; note: title.
- **Drift guard**: a unit test asserts that `FILTER_FIELDS` equals
  `vault-item-schema.js`'s `SCHEMA[type].nonSecret` for every type in `ITEM_TYPES`.
  A new non-secret field fails the test until the filter covers it, and a secret
  field can never enter the list without failing it too. (The page cannot import the
  main-only schema, so a pinned mirror plus a drift guard is the house pattern.)
- Trade-off: A single phrase can't express "gh work" (vault name + item). The
  operator accepted this.

**DD3: Placement, controls, and naming.**
`buildVaultsGroupSection()` stays mode-agnostic (today it is built in both locked
and unlocked modes). `render()` appends `filter.buildField()` to that section **at
its call site, only when `view.mode === 'unlocked'`**. That gate is new code, not
existing behavior, and it is what removes the field on lock (DD4). The field sits
below the lede and contains: a text `<input type="text">` with a visible or programmatic label
naming it a filter (for example "Filter items"), a native `<button>` clear control
with accessible name "Clear filter", and the count/status line (DD5). The clear
button is hidden while the field is empty. Activating it empties the field,
re-applies the filter, and returns focus to the input. Everything uses
`createElement`/`textContent`.
- The word is **filter** everywhere: copy, accessible names, identifiers, CSS
  classes, and specs. It is never "search", and not `type="search"` either (that
  maps to the `searchbox` role and brings a native cancel control, which would
  compete with ours).
- No keyboard shortcut and no Escape handling (operator rulings).
- **Visual DDs pin constraints only** (Mission 21 debrief). Exact spacing, width,
  icon, and copy polish are settled in the alignment leg.

**DD4: Lifetime is one render. Refresh and lock reset it.**
`render()` resets the controller before rebuilding: the query clears and the row
registry empties. The field is rebuilt empty with the new "Vaults" section. It is
built only in `unlocked` mode, so a lock (`onVaultLockState` → `refresh` →
`render`) removes the field and the query, and the next unlock starts empty.
- Rationale: Operator ruling. The filter need not survive a refresh, and the
  field and the page must never disagree. Resetting both in the same `render()`
  call makes disagreement structurally impossible.
- Trade-off: Saving or deleting an item while filtered loses the filter.
  Accepted.

**DD5: A visible count, announced once.**
A single status element (`role="status"`) under the field shows "N items match"
(singular handled) while a query is active, and "No items match" when the count is
zero. It is empty or hidden when the query is empty. The status element is the only
announcement for filtering.
- **Risk to resolve in the leg**: `#vault-root` carries `aria-live="polite"`, so
  toggling `hidden` on many rows inside it may make screen readers read large
  amounts of content on each keystroke. The leg must make sure filtering is
  announced only through the status element, for example by suppressing the root's
  live-region behavior for filter-driven changes or by placing the status outside the
  root's live scope. It verifies the result with the live accessibility tree, and
  records a note for the operator to check with a screen reader at alignment.

**DD6: The left nav is unchanged, but it clears a filter that hides its target.**
Nav entries are never hidden. A capture-phase click listener on the nav (the
entries are plain `<a href="#vault-<id>">` hash links) checks whether the target
section is currently hidden by the filter. If it is, the listener clears the filter
before the default hash jump runs. The listener lives in the filter controller,
which gets the nav element injected.
- Rationale: Operator ruling. A nav jump never lands on nothing, and the nav
  still lists every vault.

**DD7: The module shape follows the page's controller pattern.**
`src/renderer/pages/vault-filter-controller.js` exports `createVaultFilter(deps)`
with injected `document` and `navEl`, plus the matcher via import. Its API is
approximately `buildField() → HTMLElement`, `registerVault(sectionEl, pairs)`,
`reset()`, `apply()`, and `query()`. `internal-page-map.js` gains an exact
`/vault-filter-controller.js` route, and `internal-page-route-closure.test.js`
must pass. The controller has no bridge access and does no IPC.
`VAULT_PAGE_LINE_BUDGET` is raised only to the measured landed count (mission
constraint: no banked slack). This deliberately departs from this pin's own
"landed + ~30-50 buffer" history, and the updated test comment says so. The seam contract is unchanged.

**DD8: Apparatus: admin-tier MCP on the live page, plus the operator for unlock.**
The behavior test `vault-filter` drives the vault page as an internal guest with an
admin key:
- **Act**: `click`, `typeText`, `pressKey`. Admin's `allowInternal` lifts the
  internal-session guard on every op (`src/main/automation/resolve.js`
  `resolveContents`, the `!allowInternal && isInternalContents` throw;
  `docs/mcp-automation.md` "Internal-session gated by tier").
- **Observe**: `readDom` or `evaluate` (row/subsection/section `hidden` state, the
  field value, the status text, `document.activeElement`) and `readAxTree`
  (accessible names, the status role, hidden rows absent from the tree), through the
  same admin relaxation.
- **Not automatable**: the `vault-unlock` sheet, which is outside
  `AUTOMATABLE_MENU_TYPES`. Unlock is an operator step, following the hybrid-witnessed
  precedent in `multi-vault-adopt.md`. The lock itself is automatable through the
  page's own "Lock now" button.
- **Secret-never-matches, live**: the test seeds a login whose password (and notes)
  holds a unique marker that appears in no non-secret field. Filtering for the marker
  must yield "No items match".

### Prerequisites

- [x] Mission 22 approved and active; squawk 0102 merged (the heading reads "Vaults").
- [ ] Dev app launches via `npm run dev:automation` with
      `GOLDFINCH_AUTOMATION_ADMIN=1`, and an admin key is minted or attached. The
      `goldfinch-dev` MCP server failed to connect in the planning session, so re-attach
      and probe `enumerateTabs` plus a `readDom` on an open `goldfinch://vault` tab
      before the behavior-test run. This is verified at leg execution, not assumed.
- [ ] Dev profile with a set-up vault and items in Global plus at least one jar vault,
      across login, card, note, and identity. The spec's setup rows seed any that are
      missing through the page editor.
- [x] No new network service, port, or schema is introduced. There are no
      environment-conflict concerns.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified (the apparatus probe is deferred to leg execution, above)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

1. **Matcher** (`src/shared/vault-page-model.js`): `FILTER_FIELDS` and
   `itemMatchesFilter`, exported in the existing export block. Unit tests go in
   `test/unit/vault-page-model.test.js`: per-type positive matches, case
   insensitivity, trim and empty-query behavior, a secret-only-value negative per type
   (a meta object carrying a stray `password`/`number`/`body`/`email` key that holds
   the query must not match), an unknown type matched by title only, non-string field
   values ignored, and the `SCHEMA` drift guard.
2. **Controller** (`src/renderer/pages/vault-filter-controller.js`): builds the
   field, clear button, and status. Keeps the row registry (a `Map` of row element to
   meta, plus the set of loaded vault sections; subsections and sections are resolved
   via `closest()` at apply time). Runs a full `apply()` on input and on each
   `registerVault`. Owns the nav capture listener (DD6). Unit
   tests use mock nodes, following the `createSheetEntry` precedent:
   - register-then-apply;
   - **late registration under an active query**: an unloaded vault section stays
     visible, then after `registerVault` its non-matching rows, emptied subsections,
     and (with zero matches) the section itself are hidden, while a matching late
     vault's section is shown;
   - reset;
   - clear-button visibility and focus return;
   - count and no-match text;
   - subsection/section hiding.

   Live timing of a late vault can't be forced reliably, so this guarantee is
   pinned by the unit test.
3. **Wiring** (`vault.js`): construct the controller next to `nav`. In `render()`,
   call `filter.reset()`. when `view.mode === 'unlocked'`, append
   `filter.buildField()` to the section returned by `buildVaultsGroupSection()`.
   `renderItems`/`renderUnknownItems` return their `{ row, meta }` pairs, and
   `buildVaultSection`'s `vaultList` `.then` calls
   `filter.registerVault(section, pairs)` after rendering every list (DD1). The Access-keys subsection is never registered, so
   it is never filtered on its own (it disappears only with its vault section).
4. **CSS** (`vault.css`): styles for the field, clear button, and status, plus
   `[hidden]` overrides for `.vault-item-row`, `.vault-type-subsection`, and
   `.vault-child-section` (DD1).
5. **Route + budget**: an exact `internal-page-map.js` route for the controller,
   and `VAULT_PAGE_LINE_BUDGET` set to the landed count.
6. **Docs**: a short note in CLAUDE.md's Password-vault section (vault page
   controller decomposition) naming `vault-filter-controller.js` and the
   `FILTER_FIELDS` drift guard. Also a line in `docs/vault.md` if it describes the
   page UI.
7. **Behavior test**: finalize `tests/behavior/vault-filter.md` against the shipped
   DOM (ids and class hooks per DD9) and run it via `/mission-control:behavior-test
   vault-filter`.

**DD9: The DOM contract the behavior spec reads.** The spec addresses the filter by
stable hooks the leg assigns and then freezes: `#vault-filter` (input),
`#vault-filter-clear` (button), `#vault-filter-status` (status), plus the existing
`section#vault-<vaultId>`, `.vault-type-subsection`, and `li.vault-item-row`. A
change to these in the alignment leg is a spec re-author, handled deliberately, not
an inline fix.

### Checkpoints

- [x] Matcher + drift guard green
- [x] Controller + wiring green (`npm test`, typecheck, lint, format:check)
- [x] `vault-filter` behavior test passes on the live app
- [x] Operator alignment complete

### Adaptation Criteria

**Divert if**:
- The `aria-live` root (DD5) cannot be made quiet without restructuring the
  page's live-region design. Bring it back to the operator before changing
  page-wide announcement behavior.
- The admin apparatus cannot read or drive the internal vault page as DD8 assumes.

**Acceptable variations**:
- Exact controller API names, and whether the status sits above or below the field.
- Copy wording (settled at alignment), provided "filter" is the noun.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `vault-filter`: matcher + drift guard, filter controller, `vault.js`
      wiring, CSS (incl. `[hidden]` overrides), route, line budget, docs, finalize
      and run the `vault-filter` behavior test.
- [x] `hat-and-alignment`: guided HAT with the operator on the live page, tuning
      placement, spacing, copy, and feel. Include a screen-reader spot check of the
      announcement behavior (DD5): typing announces only the status line, and a
      whole vault collapsing then reappearing does not re-announce its name or
      Access-keys list. Those children re-declare `polite` (fix cycle 1) and may
      re-announce on re-show. Also include one refresh-while-filtered walk. Fixes route
      through the fix-vs-feature gate; a change to the DD9 contract re-authors the
      spec.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification

- `npm test` (matcher, drift guard, controller, route closure, and seam-contract
  line budget), `npm run typecheck`, `npm run lint`, `npm run format:check`.
- The behavior test `vault-filter` (`tests/behavior/vault-filter.md`) passes on the
  live app. It covers: the cross-vault filter, removal of rows, subsections, and
  vaults, the no-match state, the secret marker never matching, clear, the
  refresh reset, the lock reset, the nav-clears-hidden-target behavior, and the
  accessible names and status.
- Operator sign-off at the alignment leg.
