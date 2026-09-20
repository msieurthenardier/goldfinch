# Leg: identity-item-type

**Status**: completed
**Flight**: [Identity Foundations](../flight.md)

## Objective

Add the identity item type to the vault substrate: the schema across BOTH type
sources, the profile shape DD2's conflict rule needs plus a pure unit-tested
`classifyCapture`, and DD3's tolerant bundle importer across all three call sites.

## Context

Flight DD2, DD3, DD4. Leg 2 delivered the detector; this leg gives it somewhere to
store what it admits. **No producer wires them together — that is Flight 3.**
Verified at flight design: this leg has no technical dependency on Leg 2 (the
profile's field set comes from DD1's taxonomy), so its ordering is risk-retirement
narrative, not a hard sequence.

## Design Decisions (leg-level)

**LD1 — The identity type's secret/non-secret split is CONSERVATIVE: `title` and
`fullName` are non-secret; everything else is secret.**
- Rationale: `vault-item-schema.js` is the SSOT whose two sets are exact
  complements — the metadata projection is a POSITIVE whitelist copying only
  declared non-secret fields, and the save-merge preserves the complement. Anything
  listed non-secret crosses to pickers and metadata reads unmasked.
- DD2 gives ONE profile per vault, so a picker never has to disambiguate between
  profiles — which means the non-secret set can stay minimal without costing
  usability. A street address, postcode, phone and email are all PII that should
  not ride a metadata read just to render a row that says "your details".
- Trade-off: a future multi-profile feature (explicitly out of scope) would need to
  revisit this, since distinguishing "home" from "work" in a picker may require
  more than a title.

**LD2 — One profile per vault, enforced at EVERY write path — not just
`saveItem`.** Design review found the original scoping trivially bypassable.
- `saveItem`/`_saveItem` is the cheap choke point, but **three other live paths
  write a full item array directly and never call it**: `mergeVaultItems`
  (`vault-store.js:772-810`, called from `restoreProfile`'s COMMIT on a merge
  collision — it dedupes by `id` only, and two identity items with different random
  ids are neither identical nor merged, so the incoming one lands as a SECOND
  profile), `_importVault`'s fresh write, and `restoreProfile`'s COMMIT fresh
  write. A bundle carrying two identity items lands both.
- **DD2 and DD3 collide at the merge call site**, and the first draft never said so.
- **Ruling on a merge collision**: the destination's existing identity profile is
  KEPT and the incoming one is REPORTED AS SKIPPED, reusing the exact reporting
  shape DD3 is already building for unknown types. This is consistent with DD2's
  "never silently overwrite" and needs no second mechanism.
- **Read side**: provide a canonical accessor for "the" profile rather than leaving
  a future caller to `find(it => it.type === 'identity')`, which would silently pick
  whichever sorts first and hide a duplicate instead of surfacing it.
- Rationale: DD2's whole conflict model (match / gap-fill / conflict) presumes a
  single record to compare against. Leaving uniqueness to the caller means a
  capture race — two offers accepted in quick succession — silently creates
  duplicates that the conflict rule then cannot reason about. Enforcing in the
  store makes the invariant true rather than hoped for.

**LD3 — `classifyCapture(stored, captured)` is PURE, exported and unit-tested in
this leg even though it has no caller until Flight 3.**
- Returns `{ kind, gapFilled: [{field, to}], conflicting: [{field, from, to}] }` —
  **not a flat `changed: [names]`**. DD2 promises an offer naming what changes;
  a bare field list forces the Flight 3 caller to re-derive the per-field
  gap-vs-conflict judgement outside the module, which is exactly the drift a
  single-source-of-truth module exists to prevent.
- **Value equality is BYTE-EXACT, no normalisation.** `"555-1234"` vs `"5551234"`
  is a conflict. Normalising would be a judgement that could silently hide a real
  change; the operator sees both values and decides.
- Rationale: flight DD2 requires it explicitly. Without it the conflict rule stays
  a paper decision until Flight 3, which is the exact failure DD1's own "not
  trusted until proven" language warns about — and which this flight has now been
  caught by three times.
- The **fresh-profile residual** must be pinned by a test, not just documented: with
  nothing stored, every field is a gap, so DD2's own motivating gift-shipping
  scenario classifies as an ordinary merge. Still an offer, never a silent write.

## Acceptance Criteria

- [x] `vault-item-schema.js` gains `identity` with LD1's split; its cross-module
      consistency test still passes.
- [x] **THREE type sources updated, not two.** DD4 named
      `vault-item-schema.js` and `vault-store.js:126`. There is a THIRD:
      `vault-editor-model.js`'s `EDITOR_LAYOUT`/`EDITOR_TYPES`, pinned to the schema
      by `test/unit/vault-editor-model.test.js` with `assert.deepEqual` — so adding
      `identity` to `SCHEMA` turns that test RED until the editor layout gains an
      `identity` entry with a UI label for every field. Flight DD4 is amended.
- [x] **⚠ The one-line page fix that stops this leg introducing an invisible-item
      regression.** `vault.js`'s `ITEM_SUBSECTIONS` is a SEPARATELY hardcoded
      `['login','card','note']`. Once `partitionItemsByType` learns `identity`, an
      identity item is bucketed correctly — and then never rendered, because that
      render loop does not know the type. It is also not `unknown`, so it misses
      `renderUnknownItems`, whose stated purpose is that "nothing the partition
      could not bucket is silently lost". **Add the subsection.** The leg's
      "no page work" boundary is amended to permit exactly this: shipping a known
      invisibility regression and deferring it would be worse than a one-line edit.
- [x] **BOTH structural type sources updated** — `vault-item-schema.js`'s `SCHEMA` (derived)
      and `vault-store.js:126`'s independent hardcoded `ITEM_TYPES` literal,
      enforced at `:549`, `:2834`, `:3203`. They do not cascade; both are edited by
      hand or the type is half-added.
- [x] `classifyCapture` implemented, exported, unit-tested — including the
      fresh-profile residual case.
- [x] **LD2 enforced in the store**, with a test proving a second identity item is
      refused.
- [x] **DD3's tolerant importer, at all THREE call sites, each with its own fix:**
      - `_importVault` (`:2236`) — **CORRECTED**: this method has NO live caller
        anywhere in `src/main` (verified — zero `importVault` references there), so
        it is UI-unreachable today. The fix is a **store-only return-shape change
        proven by a direct unit test**, NOT end-to-end plumbing. The first draft's
        "new plumbing end to end" framing would have pushed an implementer into
        building IPC and page wiring this leg forbids.
      - `restoreProfile` COMMIT loop (`:2496`) — the throw currently propagates out
        of the whole loop, discarding `results` for vaults that already landed.
        Tolerance means per-entry exception handling, not relaxing a validator.
      - `restoreProfile` PREVIEW (`:2660`) — must REPORT skipped types too.
        Silently under-counting here is a swallow, which DD3's own rule forbids.
      - **Neither COMMIT nor PREVIEW needs IPC changes** — `vaultImportCommit`
        returns `results` verbatim and `peekLabels` passes `labels` through raw, so
        a new per-entry field reaches the page already. Corrected from the first
        draft, which overstated the plumbing for all three.
- [x] **A bundle carrying an unknown item type imports its known items and reports
      what it skipped** — proven at both commit and preview.
- [x] **⚠ The `.gfvault` parse path is UNTOUCHED and keeps loading loudly.** DD3
      softens Mission 18's stance for the bundle paths ONLY.
- [x] **The identity field set is ENUMERATED, matching Leg 2's detector role names
      exactly** — `fullName`, `firstName`, `lastName`, `email`, `phone`, `street`,
      `street2`, `city`, `region`, `country`, `postalCode` — with no translation
      layer, so the two halves cannot drift on naming.
- [x] **`fullName` may be composed** from `firstName`+`lastName` when a form splits
      the name; until Flight 3 does that, a picker row may show `title` alone.
      Stated rather than discovered.
- [x] The two hardcoded validation strings at `vault-store.js:2835` and `:3204`
      (`"item.type must be one of login|card|note"`) are updated — DD4 names those
      exact lines for the type set and would otherwise leave misleading error text.
- [x] No detector wiring, no capture, and no page work BEYOND the one
      `ITEM_SUBSECTIONS` line above. `npm test` green.

## Verification Steps

- Unit coverage for the schema split, `classifyCapture` (all three kinds plus the
  fresh-profile case), store uniqueness, and each importer call site's behaviour
  including its report.
- A test proving the `.gfvault` parse path still throws on a tampered/unknown
  document — the loud half must stay loud.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`. CI is local
  Concourse needing an interactive login unavailable to the crew — say so.

## Edge Cases

- **A bundle where EVERY item is an unknown type** — imports nothing, reports
  everything. Must not look like success.
- **An unknown type in a multi-vault restore** — earlier vaults' results survive,
  which is the specific thing the current throw destroys.
- **`classifyCapture` with a stored profile and an empty capture** — no change; must
  not classify as conflict.

## Out of Scope

- Wiring the detector to the store, fill, capture, sheets — Flight 3.
- Multi-profile support — explicitly deferred (LD1's trade-off).

## Files Affected

- `src/shared/vault-item-schema.js`, `src/main/vault/vault-store.js`
- `src/shared/vault-editor-model.js` — the third type source (labels per field)
- `src/renderer/pages/vault.js` — the single `ITEM_SUBSECTIONS` entry
- A new module or store export for `classifyCapture` + its test
- Importer tests covering all three call sites

## Citation Audit

Verified at design time: `ITEM_TYPES` at `vault-store.js:126` enforced at `:549`
(bundle import), `:2834`, `:3203`; `validateImportedItems` called from `:2236`,
`:2496`, `:2660`; `vault-item-schema.js` `SCHEMA` holds exactly login/card/note
with `nonSecret`/`secret` complements.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified; tests passing; `npm run format` run
- [x] Flight log updated; leg status `landed`; checked off in flight.md
- [x] Do NOT commit — deferred to flight end
