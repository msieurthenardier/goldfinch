# Mission: Find It in the Vault

**Status**: active

## Outcome

On the unlocked vault page, the operator can type into one filter field and see
only the matching items across every vault. Items that don't match are removed
from the page, so the operator can find a login, card, or identity without
scrolling through every jar's vault. One click clears the filter and brings the
full page back.

The filter only ever matches on what the page already shows. It never reads,
matches, or reveals a password or any other secret field.

## Context

`goldfinch://vault` renders one section per vault (Global, plus one per jar),
each split into Logins / Cards / Notes / Identity subsections. With several jars
and a growing number of captured items (Mission 21 made capture far more
frequent), the page has become a long scroll with no way to narrow it. The only
way to find an item is to know which vault it's in and scan by eye.

**What the page can see.** Each vault section loads its items through a single
read that returns only non-secret fields (`vault-item-schema.js`'s positive
whitelist, `metadataOf`). The page's DOM never holds a password, card number,
CVV, TOTP seed, note body, or secret identity field. A filter built on that read
therefore can't match on or reveal a secret. That's a structural property, not
a rule someone has to remember. The filterable fields per type are:

| Type | Filterable (non-secret) fields |
|------|--------------------------------|
| login | title, username, origin |
| card | title, cardholder, brand, last4 |
| identity | title, fullName |
| note | title |

**The page re-renders often.** `vault.js`'s `render()` clears and rebuilds
`#vault-root` on every `refresh()`: after any item save or delete, an
access-key change, a lock-state broadcast, or an import. The filter doesn't
need to survive that (operator ruling). A refresh resets it to empty and shows
everything. The work is making that reset clean and consistent, and making
sure vault lists that load asynchronously after the operator has typed arrive
already filtered.

**Page size.** `vault.js` is already ~2,100 lines. The page's established
pattern is pure, DOM-free display logic in `src/shared/vault-page-model.js`
(unit-tested without a DOM) plus `create*Controller(deps)` factories for UI
clusters (`vault-nav-controller.js`, `vault-restore-controller.js`,
`vault-browser-import-controller.js`). New filter logic belongs in that shape,
not inline in `vault.js`.

**Companion squawk (landed).** The vault's user-facing name had drifted to
"Secrets" and "Password manager". Squawk 0102 (PR #231) renamed the page
heading to **Vaults**, and the kebab item, tab name, lock indicator, and
unlock/setup copy to **Vault**. The page heading this mission builds under
reads "Vaults".

## Success Criteria

- [ ] **One filter field filters every vault.** While the vault is unlocked, a
  single filter field appears in the top "Vaults" section, below its heading,
  above the per-vault sections. Typing narrows items in every vault at once.
  The Settings section and Add buttons are unaffected. Access keys are never
  a filter target — a jar's Access-keys subsection is simply hidden whenever
  a query is active, unconditionally, and shown again once the query is
  cleared (operator ruling, HAT H3: access keys are not something people
  search for).
- [ ] **Non-matching items are removed from the page.** An item that doesn't
  match is not rendered or visible. A type subsection with no remaining
  matches, and a vault section with no remaining matches, are also removed
  while the filter is active. When nothing in any vault matches, the page says
  so in words instead of going blank.
- [ ] **Matching uses only the non-secret fields listed in Context.** Matching
  is case-insensitive and substring-based over title, username, origin,
  cardholder, brand, last4, and fullName, per type. A value that appears only
  in a secret field (password, TOTP, notes, note body, card number, CVV,
  expiry, secret identity fields) never produces a match. Unit-tested against
  the pure matcher, including a negative case per type.
- [ ] **A clear control restores the full page.** An × / clear control
  (keyboard-operable, with an accessible name) empties the filter and restores
  every item, subsection, and vault section. The control is present only when
  the filter has text.
- [ ] **A page refresh resets the filter cleanly.** After an item save,
  delete, or edit, or any other in-page refresh, the filter field is empty and
  every item is shown. The field and the page never disagree: no empty field
  over a filtered page, and no leftover query over an unfiltered page.
  *(Behavior-test-backed: observable only on the running page.)*
- [ ] **Locking clears the filter.** When the vault locks (manually or on idle
  autolock), the filter field is gone and no query survives into the locked
  view or the next unlock.
- [ ] **Accessible.** The filter field has an accessible name. The
  match / no-match state is announced to screen readers without stealing
  focus. Verified from the live page's accessibility tree in the behavior
  test. The axe audit can't target `goldfinch://vault` (an existing, accepted
  internal-page gap), so it is not an acceptance gate here.
- [ ] **Built in the page's existing shape.** The matching logic is a pure,
  DOM-free function with unit tests. The filter UI is its own controller, not
  new inline bulk in `vault.js`. Every existing vault-page test stays green;
  `VAULT_PAGE_LINE_BUDGET` moves only to the measured landed count.

## Stakeholders

- **The operator**: the sole user, and the person with many jars and a
  growing, capture-fed vault who can no longer find items by scrolling.
- **The vault's security model**: the metadata-only boundary on the vault page
  (no secret in the page DOM) must hold. The filter must never become a reason to
  widen what the page receives.

## Constraints

- **No secret crosses into the page for filtering.** The filter works only on
  the metadata the page already receives. No new IPC, no new main-side filter or query
  handler, no widening of `metadataOf`'s whitelist.
- **It's a filter, and it's called one.** In UI copy, the accessible name,
  code identifiers, and specs, this feature is a *filter*, never *search*.
  It narrows what's already on the page and doesn't query anything (operator
  ruling).
- **No keyboard shortcut** for focusing the filter (explicit operator ruling).
- **No per-vault filter fields.** One page-wide field (explicit operator
  ruling, replacing an earlier per-vault idea).
- **Filtering is display-only.** It must not change which items are loaded,
  how saves/deletes work, or the nav's vault list.
- **`vault.js` line budget may be raised.** `seam-contract.test.js` pins
  `VAULT_PAGE_LINE_BUDGET = 2150` against a current 2,107 lines. The operator
  pre-authorized raising it for this flight. The raise lands at the measured
  post-flight count (no banked slack), and the matcher and controller still
  live outside `vault.js`.
- **Late-arriving vaults read the live query.** Each vault's item list
  resolves on its own asynchronous read. If the operator types before every
  vault has loaded, the filter predicate must be read when items render, not
  when the section is built, so a late vault is never painted unfiltered.
- **Every string rendered via `textContent`.** Item metadata such as origins
  and titles is page-influenced (captured from sites).
- **The internal-page security model is unchanged**: CSP, route map, and
  bridge surface. If the controller is a new module, it gets its own exact
  `internal-page-map.js` route, and the route-closure test must pass.

## Environment Requirements

- Local Node ≥22 toolchain; `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run format:check`.
- The live app via `npm run dev:automation` with an admin key for the
  behavior test (the vault page is internal, so it needs admin-tier
  observation). A GUI (WSLg) is required.
- A dev profile with a set-up vault holding items in at least two vaults
  (Global plus one jar) across several types.

## Open Questions

- **Filtered-out vaults in the left nav.** Should the nav's per-vault entries
  hide when that vault has no matches, or stay as-is? Default assumption: the
  nav is left unchanged (the constraint above says filtering is display-only
  for the item lists). Confirm at flight planning.
- **Item count feedback.** Should the filter show a visible "N matches" count,
  or only announce it to screen readers? Resolve at flight design.
- **Is the "Other items" (unknown-type) subsection filtered by title?**
  Probably yes, by title only. Confirm at flight design.

## Known Issues

_None yet._

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses. This list will evolve based on discoveries during implementation.

- [x] Flight 1: **Vault filter**. Pure matcher plus unit tests, filter
  controller, integration with the page's render/refresh cycle
  (clean reset on refresh, async-load filtering, lock clears), accessible clear
  control and match announcement, behavior-test spec. The final
  leg is an **alignment leg**: a hands-on session with the operator to tune
  placement, spacing, empty-state copy, and feel on the live page.
