# Behavior Test: Vault Copy Item

**Slug**: `vault-copy-item`
**Status**: draft
**Created**: 2026-10-12
**Last Run**: never

> **Hybrid witnessed** (Sortie 04). The Executor drives the internal
> `goldfinch://vault` page with the admin tier. Unlock is an operator step,
> because the `vault-unlock` sheet is not automatable. Finalized against the
> shipped DOM in leg `copy-to-ui`; first run is leg 3 (HAT).
>
> **Selector key** (all inside the `goldfinch://vault` tab): row `li.vault-item-row`;
> Copy-to button `button.vault-icon-btn[aria-label="Copy <title> to another vault"]`;
> modal `.vault-modal-backdrop` with title `#vault-modal-title`, status line
> `.vault-modal-status` (role=status), Cancel `.vault-modal-actions .vault-btn`
> (first), submit `.vault-modal-actions .vault-btn.primary`; step 1 destination
> `select[aria-label="Copy destination"]`; step 2 group
> `fieldset.vault-copy-choice` (legend "What should happen?") with
> `input[type=radio][name=vault-copy-resolution]` (values `skip` / `replace` /
> `keep-both`); page notice `.vault-page-notice span[role=status]`.
> **Notice texts**: `Copied to <dest>.`, `Copied to <dest> as “<title>”.`,
> `Replaced “<title>” in <dest>.`, `Skipped — nothing copied.`,
> `Already in <dest> — nothing copied.` (`<dest>` = the destination name without its
> " — N secrets" suffix). Step 2 title `Already in <dest>`; submit label is `Apply`
> (identity: `Replace`).

## Intent

Verifies Sortie 04 against the real app: an item row's "Copy to…" action copies
the item into another vault, asks Skip / Replace / Keep both on a match, offers
only Replace / Cancel for an identity, reports an identical item as already there,
creates a jar's vault on first copy, and never puts an item field value in the
page DOM. Unit tests pin the planner, the store op and the controller against
fakes. This test pins their composition through the real IPC channel, the real
store on disk, and the page's refresh/render cycle, none of which a unit test
observes.

## Preconditions

- **Goldfinch dev mode, not the registered `goldfinch-dev` MCP server** (operator
  ruling, sortie 04). Launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
  npm run dev:automation` (under WSLg append `-- --disable-gpu --ozone-platform=x11` if
  needed), capture the `AUTOMATION_DEV_MINT {"key":…,"adminKey":…}` stdout line, and
  `export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>`. The Executor drives every MCP op through
  an env-key script on `scripts/lib/mcp-client.mjs` → `connectAutomation()`
  (`docs/dev-testing.md` → *Attaching a consumer*); re-capture the key on every launch.
  Confirm the attach with `enumerateTabs` before the run.
- The vault under test is the **dev profile's** vault (profile-isolated from the
  installed app), set up once with a throwaway master password — never the operator's
  real vault. Vault **unlocked** (operator step).
- Two persistent jars exist, called **Work** and **Personal** below (any two
  persistent jars; record the real names). **Personal has no vault file yet**
  (`hasVault` false). **One-shot**: step 8 consumes this. To re-arm for a rerun,
  create a fresh persistent jar and use it as "Personal".
- A `goldfinch://vault` tab is open.

## Observables Required

- browser, vault tab (DOM, AX tree) — admin-tier `readDom` / `readAxTree`, called via a
  `connectAutomation()` script against the dev-mode server (not a registered MCP client)
- vault contents — admin MCP `evaluate` on the vault tab calling
  `goldfinchInternal.vaultList(id)` (metadata only). Secret-field equality: an
  `evaluate` script calls `goldfinchInternal.vaultReveal({ vaultId, itemId })` for
  both items and returns ONLY per-field booleans (or SHA-256 digests via
  `crypto.subtle`) — never a secret value, so none reaches the transcript or the
  run log. Never rendered into the page.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 0 | **Live smoke** (CLAUDE.md planning rule), with the vault unlocked and the step-1 modal open: click the "Copy Alpha" Copy-to button (after step 1 setup), then run every existing apparatus primitive against the vault tab: `enumerateTabs`, `enumerateWindows`, `captureWindow`, `captureScreenshot` (vault tab), `readDom`, `readAxTree`, `evaluate` (e.g. `document.title`). Then Cancel the modal. | Each primitive returns without error while the modal is open; `enumerateTabs`/`enumerateWindows` list the vault tab, the screenshots are non-empty, `readDom` contains the modal title `Copy “Copy Alpha” to…`. Cancel closes the modal with nothing written. |
| 1 | Setup (via `evaluate` → `goldfinchInternal.vaultItemSave`): in **Global**, login "Copy Alpha" (origin `https://alpha.example`, username `alpha-user`, password `cq9marker-pass`, notes `cq9marker-note`, matchMode `registrable-domain`), note "cq9marker-title-control" (body `cq9marker-body`), card "Copy Card" (number `4242 4242 4242 4242`, cvv `cq9marker-cvv`), identity "Copy Home" (fullName "Pat Example", email `cq9marker@example.com`). In **Work**: identity "Work Home" (fullName "Sam Example"). Ensure Work has no login for `alpha.example`. Refresh the vault tab. | |
| 2 | On the "Copy Alpha" row, activate the Copy-to button. | A modal titled `Copy “Copy Alpha” to…` opens with `select[aria-label="Copy destination"]`. Its options read `Work — N secrets` and `Personal — no secrets yet`; there is NO Global option (the item's own vault). [a11y] The button's accessible name is `Copy Copy Alpha to another vault`; the select has its aria-label. |
| 3 | Choose Work and submit (`Copy`). | The modal closes. The page notice reads `Copied to Work.` Work's list (`vaultList`) contains exactly one login titled "Copy Alpha" with origin `https://alpha.example` and username `alpha-user`. Per-field equality against the Global item is true for password and notes (digest/boolean only), its matchMode is `registrable-domain`. Its id differs from the Global item's id. The Global item is unchanged. |
| 4 | Copy "Copy Alpha" to Work again. | No collision step: the notice reads `Already in Work — nothing copied.` Work still holds exactly one "Copy Alpha". |
| 5 | Setup: change the Global "Copy Alpha" password to `cq9marker-pass2` (`vaultItemSave` with `unchangedSecrets` for the rest). Copy it to Work. | A second modal titled `Already in Work` opens, naming the existing `“Copy Alpha” (alpha-user)`. Three radios in order `skip`, `replace`, `keep-both`, `skip` checked; the Replace option text says the existing item's fields will be overwritten. [a11y] The radios are in `fieldset.vault-copy-choice` with legend `What should happen?`. |
| 6 | Choose Keep both and submit (`Apply`). | The notice reads `Copied to Work as “Copy Alpha (copy)”.` Work now holds "Copy Alpha" (password digest unchanged from step 3) and "Copy Alpha (copy)" (password equal to the Global item's current password). |
| 7 | Copy "Copy Alpha" to Work once more. | The collision step shows only the `skip` and `keep-both` radios (two logins now match), no `replace`. Choose Skip and submit: the notice reads `Skipped — nothing copied.`; Work's item count is unchanged. |
| 8 | Copy "Copy Card" to Personal. | The notice reads `Copied to Personal.` Personal now has a vault (`hasVault` true) holding one card "Copy Card" whose number and cvv are equal to the source's (boolean/digest only). |
| 9 | Copy "Copy Home" (identity) to Work. | The step-2 modal names Work's existing identity profile and shows a single, pre-checked `replace` radio reading `Replace the existing identity profile` (submit label `Replace`). Cancel (the modal's Cancel button): modal closes, nothing written — Work's identity is still "Work Home". |
| 10 | Repeat step 9 and submit `Replace`. | The notice reads `Replaced “Work Home” in Work.` Work holds exactly ONE identity item; its title is "Copy Home", fullName "Pat Example", and its id equals the id "Work Home" had before. |
| 10a | Stale commit, driven directly (the UI cannot produce it). Setup: change the Global "Copy Card" cvv to `cq9marker-cvv2` (`vaultItemSave` with `unchangedSecrets` for the rest), so Personal's card is a single, non-identical match. Via `evaluate`, call `vaultItemCopy` for "Copy Card" → Personal with no resolution and record the returned `match.id`; delete that item from Personal via `vaultItemDelete`; then call `vaultItemCopy` again with `resolution: 'skip'` and the recorded `matchId`. | The first call returns `needs-resolution` with `allowed` = skip, replace, keep-both (no write). The skip commit returns `skipped`, and Personal holds zero items afterwards (no write the operator declined). |
| 11 | Read the full serialized DOM of the vault tab (`readDom`) and search it for every `cq9marker` value. | Positive control: the note title `cq9marker-title-control` IS present (a non-secret marker reaches the DOM, so the search is live). No other `cq9marker` string (every seeded secret: passwords, notes, cvv, email, note body) appears anywhere in the DOM. |
| 12 | Open the Copy-to modal on "Copy Alpha", then lock the vault (operator: vault indicator → Lock now). | The modal closes on lock; the page shows the locked state. No notice appears afterwards, and no item was written to any vault (re-check after the operator unlocks again). |
| 13 | Unlock (operator). Open the Copy-to modal on any item, cancel it. Then open an item's Delete confirm and cancel it, open the Edit modal and cancel it. | Each modal opens and closes normally; Delete confirm still names the item and nothing is deleted (the moved delete-confirm works as before). |

## Out of Scope

- Cross-window refresh (another window showing the destination stays stale until its own refresh, the same as after save/delete today).
- The busy (rotation in progress) refusal — pinned by unit tests; a rotation cannot be held open from this apparatus.
- The render-epoch guard (a lock landing while a copy invoke is in flight) — unit tests only (`vault-item-actions-controller.test.js`); the main-side op is synchronous and sub-millisecond, so the apparatus cannot land a lock inside the window. Step 12 locks with no invoke in flight.
- Visual layout and copy polish — HAT.

## Variants

None.
