# Leg: item-management

**Status**: completed
**Flight**: [Vault Management Page](../flight.md)

## Objective

Give `goldfinch://vault` working item CRUD: a metadata-only item list (all types, no secrets), a
full-item editor (login/card/note) that reveals a secret only on explicit action and preserves
unrevealed secrets on save via an "unchanged" sentinel, plus delete and reveal/copy — all behind
`registerInternalHandler`-gated IPC, with no plaintext in the page DOM until an explicit reveal.

## Context

- **Flight DD10** — a net-new **metadata-only, all-types, per-vault** list op backs the page list
  (and leg-1's deferred item counts). Returns `{ vaultId, id, type, title, username, origin, hasTotp }`
  — **no secret fields**. (Today: only full-plaintext `listItems` and login/origin-filtered
  `reachableLoginItems`.)
- **Flight DD6** — secrets reach the page **only** on explicit reveal (`internal-vault-reveal(itemId)`,
  masked `●●●` + reveal button); the list and the editor's non-secret fields render from metadata.
  Copy uses the existing `clipboard:write` sink.
- **Flight DD3** — the editor is a *full-item* editor (replace, lossless, field-clearing works). On
  save, an **unrevealed secret field is sent as an "unchanged" sentinel**; the
  `internal-vault-item-save` handler resolves the sentinel against the existing item's secret **in
  main** (a targeted read-merge for the sentinel only — NOT a blind full-merge), then calls the
  unchanged `saveItem` (full-replace). An explicit *clear* sends empty (not the sentinel). Also
  re-assert (test) that the F2 capture caller still read-merges — the "partial callers merge" class,
  verifiably closed.
- **Leg 1 flag** — the vault page renders **attacker-influenced strings** (item titles/usernames/
  origins). `textContent`-only rendering (never `innerHTML`) + the strict CSP are the load-bearing
  XSS mitigations. This leg is where that discipline is first tested at scale.
- **Secret-field taxonomy (the linchpin — Architect-flagged).** Today the store validates only
  `type` (`_normalizeItem`, `vault-store.js:598-618`) and card/note fields don't exist — this leg
  **defines the per-type item schema** and single-sources a canonical **secret-field-names-per-type**
  map that BOTH the metadata projection (exclude) and the save-merge (preserve) consume as
  **complements**, so they can never drift and leak/drop a field. The provisional schema:
  - **login** — non-secret: `title`, `username`, `origin`; secret: `password`, `totp`, `notes`.
  - **card** — non-secret: `title`, `cardholder`, `brand`, `last4`; secret: `number`, `cvv`, `expiry`, `notes`.
  - **note** — non-secret: `title`; secret: `body`, `notes`.
  The metadata projection emits **only** the non-secret set (+ `type`, `id`, `hasTotp` flag); the
  reveal/preserve set is the secret complement. (`notes` is a secret free-text field on every type —
  the F2 capture test proves it holds secrets and must survive edits, `vault-capture.test.js:273,287`.)

## Inputs

- `src/main/vault/vault-store.js` — `listItems(target)` (full plaintext, MRK-gated), `saveItem`
  (full-replace upsert keeping only `createdAt`, `:628`), `_normalizeItem` (`:598-618`, validates only
  `type`), `_requireMrk`→`VaultLockedError` (`:343-348`), `reachableLoginItems` (`:697`, the
  positive-whitelist precedent to generalize), `listItems` (`:668`). The login item is `{ id, type,
  title, origin, username, password, totp?, notes?, createdAt, updatedAt }`; **card/note field schema
  does not exist yet — this leg defines it** (see Context taxonomy; note content is `body`, not
  `note`). **No delete-item / single-item-reveal / metadata-list / preserving-save op exists** (all
  net-new).
- `src/main/register-vault-ipc.js` (leg 1) — the `registerInternalHandler`-gated composition module;
  add the CRUD handlers here.
- `src/renderer/pages/vault.{html,css,js}` (leg 1) — the trusted shell; add the list + editor UI.
- `src/preload/internal-preload.js` — the `goldfinchInternal` bridge; add the CRUD wrappers.
- `src/main/register-settings-ipc.js:79` — the `clipboard:write` sink for copy.
- `test/unit/vault-capture.test.js` — the F2 capture read-merge to re-assert.

## Outputs

- **Shared schema module (net-new, `src/shared/vault-item-schema.js`)** — the single source of truth:
  per-type `{ nonSecret: [...], secret: [...] }` field maps (login/card/note per the taxonomy above),
  plus helpers `metadataOf(item)` (positive-whitelist strip → non-secret fields + `type`/`id`/`hasTotp`)
  and `secretFieldsFor(type)`. Both the projection and the save-merge import this; unit-tested that
  `nonSecret ∩ secret = ∅` per type and that `metadataOf` emits no secret key. Pure/CJS.
- **Store ops (net-new, `vault-store.js`)**:
  - `listItemsMeta(target)` → all-types metadata via `metadataOf` (**positive whitelist**, never a
    name-blacklist). Backs the page list + leg-1's counts. MRK-gated.
  - `revealItem(target, itemId)` → the full single item incl. secrets, MRK-gated, exact-scope by id.
  - `deleteItem(target, itemId)` → filter out + atomic `_writeVault`, MRK-gated; false on missing id.
  - `saveItemPreservingSecrets(target, item, unchangedFields)` → for each name in `unchangedFields`
    (validated ⊆ `secretFieldsFor(item.type)`), pull the value from the existing item and substitute;
    then `saveItem` (unchanged full-replace). **Create-defense**: if no existing item (new id) and
    `unchangedFields` is non-empty → throw (never persist a placeholder). Unit-tested. The resolution
    lives in the **store** (plaintext + schema are here), not the IPC handler.
  - Document `saveItem`'s **full-replace contract** at its definition (DD3) — unchanged.
- **IPC handlers (`register-vault-ipc.js`, all `registerInternalHandler`-gated)**:
  `internal-vault-list` (metadata), `internal-vault-reveal` (single item), `internal-vault-item-save`
  (`{ item, unchangedSecrets }` → `saveItemPreservingSecrets`), `internal-vault-item-delete`. Each
  **catches `VaultLockedError` and returns a structured `{ locked: true }`** (a thrown error only
  serializes to a string across `registerInternalHandler`, so the page can't `instanceof` it).
  Leg-1's `internal-vault-state` gains counts via `listItemsMeta` **guarded on `isUnlocked()`** (else
  omit/null — the locked-state read must stay non-throwing).
- **Bridge + types**: `internal-preload.js` wrappers `vaultList`/`vaultReveal`/`vaultItemSave`/
  `vaultItemDelete` + `renderer-globals.d.ts` entries.
- **Page UI (`vault.{html,css,js}`)**: the item list (grouped by vault, metadata via
  `listItemsMeta`, `textContent`-only), a full-item editor per type (login/card/note) — non-secret
  fields from metadata, secret fields **masked** with per-field reveal (→ `revealItem`) + copy (→
  `clipboard:write`); on save, send `unchangedSecrets` for masked-and-untouched fields; explicit clear
  sends empty. **Revealed secrets are cleared from the DOM + re-masked on hide/blur/save.** An
  `origin` rendered as a link **must validate http/https** before setting `href` (a `javascript:`
  origin executes even without `innerHTML`). Pure page-logic (unchanged-field assembly, mask/reveal
  state) factored to a testable `src/shared/` module.
- **Tests**: unit for the schema module (complement invariant, `metadataOf` no-secret), `listItemsMeta`
  (all three types, no secret), `revealItem`, `deleteItem`, `saveItemPreservingSecrets`
  (login/card/note round-trip, create-defense, unchanged-set ⊆ secret guard); integration for the
  four handlers (non-internal rejection; locked → `{locked:true}`; save preserves an unrevealed
  password AND `notes`/`body`; explicit clear removes a field; reveal single-id scope); the F2
  capture read-merge **re-assert** (cite `vault-capture.test.js:258` by intent); page-logic units
  (unchanged assembly, mask/reveal, clear-on-hide).

## Acceptance Criteria

- [x] The **schema module** single-sources per-type non-secret/secret field maps; unit asserts
      `nonSecret ∩ secret = ∅` per type and `metadataOf` emits no secret key.
- [x] `listItemsMeta` returns metadata via the **positive whitelist** (`metadataOf`) for **all three
      types** — no secret field (incl. `notes`, note `body`, card `number`/`cvv`) ever appears (unit +
      grep AC); the page list renders from it, `textContent`-only.
- [x] The editor opens with secret fields **masked**, populated only on explicit per-field reveal
      (`revealItem`); no plaintext secret is in the page DOM until reveal (grep AC); revealed secrets
      are **cleared from the DOM + re-masked on hide/blur/save** (page-logic test).
- [x] Save round-trips **all three types losslessly** via `{ item, unchangedSecrets }`: editing a
      **login** title with `password`+`totp`+`notes` unchanged preserves all three; editing a **note**
      title preserves `body`; editing a **card** title preserves `number`/`cvv`; explicit clear removes
      a field; a new-id save naming unchanged fields is **rejected** (create-defense). `saveItem`
      itself unchanged.
- [x] Delete removes the item (MRK-gated, false on missing id); reveal/copy work (copy via
      `clipboard:write`).
- [x] Every new handler is `registerInternalHandler`-gated (non-internal rejected); a **locked** store
      returns a structured `{ locked: true }` (not a serialized error string); `revealItem` returns the
      secret only for the requested id.
- [x] `internal-vault-state` counts are `isUnlocked`-guarded — the locked-state read stays
      non-throwing.
- [x] An `origin` rendered as a link validates http/https before `href` (no `javascript:` execution).
- [x] The F2 capture caller still read-merges (re-assert `vault-capture.test.js:258` by intent).
- [x] Existing tests pass unmodified; `npm test`, `npm run typecheck`, lint clean.

## Verification Steps

- Unit: `listItemsMeta` (all types, no secret), `revealItem`, `deleteItem`; page-logic (sentinel
  assembly, mask/reveal).
- Integration: the four handlers against a fake store — non-internal rejection; save sentinel
  preserves an unrevealed password + totp; explicit clear removes a field; reveal single-id scope.
- Re-assert: `vault-capture` read-merge still holds.
- `npm test` full — no regressions. `npm run typecheck` + lint clean.
- Grep: the list/editor render path emits no plaintext secret; only `revealItem` returns secrets.

## Implementation Guidance

1. **Schema module first** — `src/shared/vault-item-schema.js` (CJS): per-type `{nonSecret, secret}`
   maps + `metadataOf(item)` (positive whitelist) + `secretFieldsFor(type)`. This is the single source
   the projection and the save-merge both import. Unit-test the complement invariant.
2. **Store ops** — add to `vault-store.js`, all `_requireMrk`: `listItemsMeta` = `listItems(target)
   .map(metadataOf)`; `revealItem` = `listItems(target).find(id)`; `deleteItem` = filter + atomic
   `_writeVault`; `saveItemPreservingSecrets(target, item, unchangedFields)` = validate
   `unchangedFields ⊆ secretFieldsFor(item.type)`, find existing (throw if none + unchangedFields
   non-empty — create-defense), substitute those fields from existing, `saveItem(target, merged)`.
   Add the full-replace doc comment at `saveItem` (DD3).
3. **IPC handlers** — add to `register-vault-ipc.js`, each `registerInternalHandler`-wrapped, each
   **`try/catch (VaultLockedError) → return { locked:true }`**: `internal-vault-list` (metadata),
   `internal-vault-reveal(itemId)`, `internal-vault-item-save({item, unchangedSecrets})` →
   `saveItemPreservingSecrets`, `internal-vault-item-delete(itemId)`. Update `internal-vault-state`
   counts **only when `isUnlocked()`** (else omit/null; keep it non-throwing).
4. **Bridge + types** — the four wrappers + `renderer-globals.d.ts` entries.
5. **Page UI** — the list (metadata, grouped by vault, `textContent`-only), the per-type editor
   (non-secret from metadata; secrets masked with per-field reveal→`revealItem`, copy→`clipboard:write`;
   on save send `unchangedSecrets` for masked-untouched fields, empty for explicit clear). **Clear
   revealed secrets from the DOM + re-mask on hide/blur/save.** If rendering `origin` as a link,
   validate the scheme is http/https before `href`. Factor the unchanged-field assembly + mask/reveal
   state into a pure `src/shared/` module for unit tests. Guard every bridge call. Route a `{locked:true}`
   response to the leg-4 unlock path (page can also pre-gate off `internal-vault-state.unlocked`).

## Edge Cases

- **Locked at any op** — every handler catches `VaultLockedError` → `{ locked:true }` (structured, not
  a serialized string); the page routes to the leg-4 unlock path.
- **Unrevealed-secret save** — `unchangedSecrets` names them; `saveItemPreservingSecrets` pulls them
  from the existing item. Test with a login (`password`+`totp`+`notes`), a note (`body`), a card
  (`number`/`cvv`).
- **Explicit clear vs unchanged** — an explicitly cleared field sends empty and is NOT in
  `unchangedSecrets`; it must actually clear. Only masked-and-untouched fields go in `unchangedSecrets`.
- **`notes` free-text** — a secret field on every type (the capture test proves it holds secrets);
  never in the metadata projection, always in the preserve/reveal set.
- **XSS** — `textContent` only; an item titled `<img onerror=…>` renders as inert text; no `innerHTML`;
  an `origin` link's scheme is validated http/https before `href`.
- **Reveal scope** — `revealItem(id)` returns only that item; never the whole vault's secrets.
- **New item (create)** — all fields from the form; a new-id save naming `unchangedSecrets` is
  **rejected** (create-defense); `saveItem` mints the id.
- **Delete of a non-existent id** — false; don't throw.

## Files Affected

- `src/shared/vault-item-schema.js` (new) — the per-type secret/non-secret maps + `metadataOf`/`secretFieldsFor`.
- `src/main/vault/vault-store.js` — `listItemsMeta`/`revealItem`/`deleteItem`/`saveItemPreservingSecrets`
  + the `saveItem` full-replace doc comment.
- `src/main/register-vault-ipc.js` — the four handlers (locked→`{locked:true}`) + `isUnlocked`-guarded counts.
- `src/preload/internal-preload.js` + `src/renderer/renderer-globals.d.ts` — bridge wrappers + types.
- `src/renderer/pages/vault.{html,css,js}` (+ a pure `src/shared/` editor-logic module) — list + editor.
- `test/unit/…` — schema module, store ops, the four handlers, page-logic, the capture re-assert.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
