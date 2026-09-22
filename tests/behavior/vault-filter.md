# Behavior Test: Vault Filter

**Slug**: `vault-filter`
**Status**: active
**Created**: 2026-09-22
**Last Run**: never

> **Hybrid witnessed** (Mission 22, Flight 1). The Executor drives the internal
> `goldfinch://vault` page with the admin tier. Unlock is an operator step,
> because the `vault-unlock` sheet is not automatable. Finalized against the
> shipped Leg 1 DOM/mechanism (flight DD9; leg-level DD1 refinement): the
> filter hides by toggling the class `vault-filter-out`
> (`display: none !important` — never the `hidden` attribute), so every
> "hidden" check below observes NOT DISPLAYED — computed `display: none`
> and/or absence from the accessibility tree and/or the `vault-filter-out`
> class — not the `hidden` attribute. The one exception is
> `#vault-filter-clear`, which genuinely uses the native `hidden` ATTRIBUTE
> for its own empty/non-empty visibility (unrelated to the filter's own hide
> mechanism).

## Intent

Verifies Mission 22's filter against the real app: one field on the unlocked vault
page narrows items across every vault. Non-matching rows, emptied subsections, and
emptied vaults disappear, a count and a no-match state are reported, and a secret
value never matches. The clear button restores the page. A page refresh or a lock
resets the filter, and a nav click on a filtered-out vault clears the filter.
Unit tests pin the matcher and the controller. This test pins the composition with
the page's real async per-vault loads, its re-render cycle, the lock broadcast, and
the accessibility tree, none of which a unit test observes.

## Preconditions

- Dev app running (`npm run dev:automation` with `GOLDFINCH_AUTOMATION_ADMIN=1`;
  under WSLg add `-- --disable-gpu --ozone-platform=x11` if needed). Admin-tier MCP
  attached; confirm with `enumerateTabs` before the run.
- Vault set up and **unlocked**. The operator knows the master password.
- Items (seeded by the setup row if absent):
  - **Global**: login "Filter Alpha" (username `alpha-user`, origin
    `https://alpha.example`, password `zq7marker-secret`, notes `zq7marker-note`);
    card "Filter Card" (cardholder "Pat Example", brand Visa, number ending 4242).
  - **One jar vault** (for example Personal): login "Beta Mail" (username
    `beta-user`, origin `https://mail.example`); note "Filter Recipe" (body
    `zq7marker-body`); identity profile titled "Home" (fullName "Pat Example",
    email `zq7marker@example.com`); at least one access key minted for this jar
    (needed for the step-6 whole-vault-collapse check — an Access-keys subsection
    with a row in it). **Minting goes through the chrome-owned step-up sheet**
    (re-enter the master password) — not on `AUTOMATABLE_MENU_TYPES`, so this is
    an **operator step** if the jar vault has no key yet, done before or during
    step 1's setup, the same way unlock itself is an operator step (see below).
  - The marker `zq7marker` appears **only** in secret fields.
- The page is reached via the chrome kebab menu → **Vault** (opens
  `goldfinch://vault` as a trusted internal tab). Record every vault section id on
  the page (`section#vault-<id>`) before step 2.

## Observables Required

- **browser**: the vault page's DOM via admin `readDom`/`evaluate`:
  - the NOT-DISPLAYED state of `li.vault-item-row`, `.vault-type-subsection`, and
    `section#vault-<id>` — computed `display: none` (`getComputedStyle(el).display`)
    and/or the presence of the `vault-filter-out` class; the filter never writes the
    `hidden` attribute on any of these
  - `#vault-filter` value
  - `#vault-filter-clear` presence / its `hidden` ATTRIBUTE (this one control genuinely
    uses `hidden`, not `vault-filter-out`)
  - `#vault-filter-status` text — exact shipped copy: empty when inactive, `"1 item
    matches"` (singular), `"N items match"` (N ≥ 2), `"No items match"` at zero
  - `document.activeElement`

  Also its accessibility tree via admin `readAxTree` (a not-displayed row/subsection/
  section is absent from the tree — `display: none` removes it), and screenshots via
  `captureScreenshot`.
- **operator**: an attested unlock through the `vault-unlock` sheet, and (if the
  jar vault has no access key at setup time) an attested mint through the
  chrome-owned step-up sheet — neither is automation-observable.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | (Setup) Open `goldfinch://vault` in a tab (kebab → Vault). Seed any missing precondition items through the page's Add/editor controls. If the jar vault has no access key yet, the **operator** mints one through the chrome-owned step-up sheet (master password re-entry) — this step is not automatable (the sheet's menuType is outside `AUTOMATABLE_MENU_TYPES`), so the Executor hands off and waits for the operator's attestation before continuing. Note each vault's section id. | (empty) |
| 2 | Read the page. | The "Vaults" section holds `#vault-filter`, which is empty. `#vault-filter-clear` is hidden (its `hidden` attribute) or absent. Every seeded item row is displayed (not `vault-filter-out`). The status line (`#vault-filter-status`) is empty. [a11y] The field's accessible name contains "Filter", and neither the field nor the status uses a "search" name or role. |
| 3 | Click `#vault-filter` and type `filter`. | Displayed rows are exactly "Filter Alpha", "Filter Card", and "Filter Recipe" (title matches across both vaults). "Beta Mail" and "Home" rows are NOT displayed (carry `vault-filter-out` / `display: none`), and the jar vault's Logins and Identity subsections are NOT displayed for the same reason. The status reads exactly "3 items match". `#vault-filter-clear` is displayed (its `hidden` attribute cleared). Focus is still on `#vault-filter`. |
| 4 | Clear the field by selecting all and typing `pat example`. | Only "Filter Card" (cardholder) and "Home" (fullName) are displayed. The match is case-insensitive. The status reads exactly "2 items match". |
| 5 | Replace the text with `mail.example`. | Only "Beta Mail" (origin) is displayed. The Global vault's `section#vault-<id>` is NOT displayed (`vault-filter-out`) because it has zero matches. The jar vault section is displayed, and its Access-keys subsection — never itself a filter target — is still displayed alongside it. |
| 6 | Replace the text with `zq7marker`. | Every item row is NOT displayed, and every vault section (`section#vault-<id>`, both Global and the jar vault) is NOT displayed (zero matches each). **The jar vault's Access-keys subsection is ALSO not displayed** — not because the filter ever targets it directly (it never registers or toggles Access-keys on its own), but because it collapses along with its whole owning vault section, per the flight's FD ruling: a jar vault with zero item matches hides whole, Access-keys included. The status reads exactly "No items match", and the page states it in words rather than going blank. No row that carries the marker in a secret field (password, notes, note body, identity email) is displayed. [a11y] `#vault-filter-status` has role `status`, and every not-displayed row/subsection/section is absent from the accessibility tree. |
| 7 | Activate `#vault-filter-clear` (click it). | The field is empty, and every item row, subsection, and vault section (including the jar vault's Access-keys subsection) is displayed again — nothing carries `vault-filter-out`. The status is empty. The clear button is hidden (its `hidden` attribute). Focus is on `#vault-filter`. |
| 8 | Type `filter recipe`. Then click the left nav entry for the **Global** vault, which is filtered out (not displayed). | Before the jump, the Global section is not displayed. After the click, the filter is cleared (the field is empty and all rows/subsections/sections are displayed again) and the page has scrolled to the Global vault section. |
| 9 | Type `alpha`. Open "Filter Alpha"'s Edit, change nothing, and Save, so the page refreshes. | After the refresh, `#vault-filter` is empty, every item row is displayed, and the status is empty. The field and the page agree. |
| 10 | Type `alpha`. Then click the page's "Lock now" control. | The page shows the locked view. `#vault-filter` is not present anywhere in the DOM. |
| 11 | Operator unlocks through the vault-unlock sheet (attested). Executor re-reads the page. | Unlocked view. `#vault-filter` is present and empty, every item row is displayed, and the status is empty. No query survived the lock. |

## Out of Scope

- The visual design (spacing, width, icon). The flight's alignment leg settles it.
- Screen-reader speech itself. The operator spot-checks it at alignment. This test
  asserts the roles and names that produce it, and that a not-displayed row/section
  is absent from the accessibility tree (the `aria-live="off"` scoping the controller
  applies is a mechanism detail the operator's screen-reader spot-check verifies
  directly, not this test).
- axe-core auditing: `goldfinch://vault` is an accepted internal-page audit gap.
- The item editor, delete, import/restore, and access keys (beyond the whole-vault
  collapse check in step 6), beyond being unaffected. Existing specs cover them.
