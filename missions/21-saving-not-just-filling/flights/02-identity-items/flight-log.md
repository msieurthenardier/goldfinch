# Flight Log: Identity Items

**Flight**: [Identity Items](flight.md)

## Summary

Flight planned. Not yet started.

---

## Reconnaissance Report

Source items walked against current code at planning (2026-09-19):

| item | classification | evidence | recommendation |
|---|---|---|---|
| squawk 0090 — expiry false positives | `confirmed-live` | `fallbackRoleOf({name:'sessionExpiry'})` → `'expiry'` | fix in Leg 1 |
| squawk 0091 — underscore blocks match | `confirmed-live` | `fallbackRoleOf({name:'card_nameOnCard'})` → `null` | fix in Leg 1 |
| fill-precision regression (F1 Leg 3) | `confirmed-live` | `webview-preload.js` calls `consumeFillTarget` only to CLEAR; `fillLogin(cred)` passes no target | close in Leg 3 (DD7) |
| `ITEM_TYPES` 3 enforcement sites | `confirmed-live` | `vault-store.js:126`, `:549` (bundle import, hard throw), `:2834`, `:3203` | Leg 2 |
| `isCard` binary branching | `confirmed-live` | 4 sites in `vault-capture-template.js`, 7 in `vault-picker-template.js` | Leg 4 |
| mission's guess that `unhinted-billing-fields` re-tiers | `already-satisfied` (as negative) | fixture is `field1`/`field2`/`field3` + placeholders only; DD1 declines to guess from placeholders | KEEP negative — do not re-tier |

---

## Leg Progress

### Leg 1 `fallback-pattern-foundation` — landed 2026-09-19

Implemented to the leg spec, which had already been through two design-review
rounds (see the Flight Director Notes below) — followed closely rather than
re-litigated.

**Tokenizer extracted first, on its own** (`src/preload/field-tokenizer.js`):
`normalizeFieldHaystack` (camelCase-hump split, now ALSO `_`/`-` → space — the
0091 fix) and `resolveAutocompleteToken` (the split-on-whitespace/
lookup-against-caller-map mechanism DD6 named as the second extraction — the
leg's own first-draft risk of silently narrowing to just the string half was
avoided). Zero card vocabulary in the module; 16 tests of its own
(`test/unit/field-tokenizer.test.js`), proving normalisation independently of
any family's patterns — per the leg's "separately tested" requirement.

**`rolesIn` restructured into two phases**, exactly per the corrected Guidance
3: phase 1 resolves the `number` anchor and its index via a single
first-match-wins scan (unchanged shape); phase 2 collects every OTHER role's
candidates in document order and applies `qualifiesForRole` — gate-then-
first-match, never nearest-to-anchor. The autocomplete pass is untouched
(single scan, ungated, first-match-wins — its "hidden duplicate" comment stays
true).

**The two-condition expiry gate** (`qualifiesForRole` in
`vault-card-fields.js`): condition (a) a card-context token
(`card`/`cc`/`credit`/`payment`, word-bounded, post-normalisation) in the
candidate's OWN haystack; condition (b) `|index - anchorIndex| <=
EXPIRY_ANCHOR_WINDOW` (bidirectional, named constant = 5, derivation comment
at the constant's definition site). Scoped to `expiry`/`expMonth`/`expYear`
only via `EXPIRY_ROLES`; every other fallback role routes straight through
`qualifiesForRole`'s early `return true`.

**The `\b` fix**: `FALLBACK_PATTERNS`'s `number` entry gained a leading `\b`
before `(card|cc|creditcard|pan)` — closes `accNumber`/`acctNumber`/
`successNumber` without touching any of the ten verified-safe positive
spellings (list in the squawk 0090 corrective action).

**Before/after probes** (required by the leg's Verification Steps), run against
`git show HEAD:src/preload/vault-card-fields.js` (pre-leg) vs. the fixed module:

```
                              before    after
fallbackRoleOf (field-level, no pipeline):
  sessionExpiry                expiry    expiry   ← UNCHANGED, correctly (the "trap")
  card_nameOnCard              null      cardholder
  accNumber                    number    null

findCardFields (full pipeline):
  sessionExpiry, far from anchor, no context token   resolves=true   resolves=false
  card_nameOnCard, no placeholder, full pipeline      cardholder=false cardholder=true
```

The `sessionExpiry` row is the leg's own documented trap, verified rather than
assumed: the fix is pipeline-level (lives in `rolesIn`/`findAllCardFields`,
which needs a resolved anchor), so a bare `fallbackRoleOf` probe is unchanged
by design — only the full-pipeline row shows the actual fix.

**Test additions** — `test/unit/vault-card-fields.test.js` grew from 30 to 64
tests: no-placeholder 0091 variants (including a full no-placeholder Jostens
field-set reproduction), the `\b` fix's positive/negative lists, the two
literal anchored spellings pin (`ccmonth`/`ccyear`/`ccexp`), and a dedicated
0090 section — the bidirectional-window regression (expiry preceding the
number), the window's inclusive boundary at exactly `EXPIRY_ANCHOR_WINDOW` and
rejection one position past it, condition (a) admitting six real spellings
regardless of distance, the required full-pipeline `sessionExpiry` rejection,
the other three of 0090's five evidence lines rejected when realistically far
from the anchor, the multi-candidate first-document-order tie-break (proving
it is NOT nearest-to-anchor — an AC not otherwise exercised by the leg's other
required tests, added because it was a real, distinct claim worth its own
proof), the named accepted residual (`couponExpirationDate` adjacent to the
anchor), and the pipeline-vs-field-level trap test itself.

**Verification run**: `npm test` — 5207 tests, 5204 pass / 0 fail / 3
pre-existing todo (baseline before this leg, per squawk 0092's own recorded
run: 5173 tests, 5170 pass / 0 fail / 3 todo — a net +34: +18 in
`vault-card-fields.test.js`, 30→48, and +16 in the wholly-new
`field-tokenizer.test.js`). `npm run lint` clean (required adding `field-tokenizer.js` to
`eslint.config.mjs`'s CJS-required-by-preload block, alongside its sole
consumer `vault-card-fields.js`, so `module.exports` resolves as a CJS
global rather than tripping `no-undef` under the repo's default ESM-leaning
lint block). `npm run typecheck` clean. `npm run format` run (one line-wrap in
the new multi-candidate test). **CI itself (local Concourse) was not run** — it
needs an interactive login unavailable to this agent; the gates above stand in
for it, as instructed.

**Squawks 0090 and 0091** updated to `completed`, corrective action + verification
recorded in each squawk file, linked to this leg. Sign-off in both squawk files is
marked PENDING — this flight batches implementation across its legs with a single
code review at the end (per `flight.md`'s Technical Approach), so no independent
reviewer has verified this leg yet at the time of writing. The Corrective
Action/Verification content is this Developer's own work, clearly attributed as
such; the end-of-flight review is the sign-off of record.

No deviations from the leg spec. No identity patterns written (out of scope, per
the leg's own repeated emphasis and DD6).

---

### Leg 2 `identity-boundary` — landed 2026-09-20

Implemented to the leg spec, which had already been through two design-review
rounds (both HIGH findings, both amendments — see the Flight Director Notes
above) — followed closely per the task's own instruction, not re-litigated.
Vocabulary and adversarial fixtures were written BEFORE the detector, per the
leg's own Implementation Guidance 1.

**Haystack builder extracted first** (`src/preload/field-tokenizer.js`):
`fieldHaystack(field)` — `[name, id, placeholder, aria-label].join(' ')` —
pulled out of its prior private home in `vault-card-fields.js` (which now
imports it) so both families read the identical four attributes and cannot
silently drift on what feeds detection.

**New module** (`src/preload/vault-identity-fields.js`), same shape as the
card family's (`findAllIdentityFields(doc)` -> entries; `findIdentityFields`
for the first), zero page/store coupling:

- **LD1's alternatives model**, not a flat token set: `ROLE_ALTERNATIVES` maps
  each of 11 roles (`street`, `street2`, `postalCode`, `city`, `region`,
  `country`, `fullName`, `firstName`, `lastName`, `email`, `phone`) to a list
  of `{tokens, anchor}` alternatives; matching is conjunctive within an
  alternative, disjunctive across all alternatives of every role, longest
  match wins (`fallbackResolution`). `address` never appears as a bare
  alternative anywhere in the table — the round-2 fix for the reachable
  `emailAddress`/street tie.
- **The vocabulary written twice**, in two structurally separate tables:
  `AUTOCOMPLETE_ROLES` (literal, possibly-hyphenated WHATWG tokens, matched by
  `resolveAutocompleteToken`) and `ROLE_ALTERNATIVES` (pre-split, hyphen-free
  token arrays, matched against `normalizeFieldHaystack`'s output) — the
  module header calls out the trap explicitly (a hyphenated literal pasted
  into the fallback table would be a dead entry) so a future editor cannot
  make Leg 1's near-miss.
- **LD2's scope anchor**: `identityEntryForScope` requires BOTH an
  anchor-eligible postal-role field (`street`/`street2`/`postalCode`, or a
  PREFIX-qualified `city`/`region`/`country` — never bare) AND a resolved
  non-postal role (`fullName`/`firstName`/`lastName`/`email`/`phone`), or the
  scope contributes nothing — no field inspected further. Anchor-eligibility
  is carried as a per-alternative flag computed purely from a single field's
  own token set (`fallbackResolution`/`resolveField`), never consulting
  "is the scope already anchored" — verified non-circular by construction
  (the same resolved-fields array is filtered by two independent predicates,
  neither reading the other's result).
- **The named 7-item prefix vocabulary** (`PREFIXES`: billing, shipping,
  delivery, mailing, contact, home, work), used for `city`/`region`/`country`
  qualification AND, by stated choice, `street`'s compound alternatives too
  (settles `billingAddress`) — one list, not two.
- **LD3**: `isClaimedByLogin(field, doc)` built from the already-exported
  `findAllLoginFields` (`field === entry.username` across entries) —
  `vault-fill-fields.js` untouched. Every candidate field is filtered through
  it BEFORE role resolution (`candidateFields`), so a login-claimed field is
  invisible to identity detection, including as an anchor candidate — the
  "anchor itself can be contested" edge case is a structural consequence of
  filtering before resolving, not a special case.

**Vocabulary decisions, pinned by direct unit test** (per-spelling, each with
the deciding alternative named in the test itself,
`test/unit/vault-identity-fields.test.js`, 35 tests): `address1`/`address2`
(the literal motivating spellings — `{address1}`/`{address2}`), `addr1`/`addr2`
(glued abbreviations), `billingAddress` (bare, via `{billing,address}`, not a
bare `{address}`), `streetAddress`/`shippingAddressLine1` (`{street,address}`/
`{address,line1}`), `emailAddress` (resolves `email`, never `street` — the
round-2 tie proven closed), `zipcode`/`postcode`/`zip` (glued literals, each
its own entry), `fname`/`lname` (glued literals), `mobile` (`{mobile}`), bare
`name` (field-level `fullName`, but REFUSED at the pipeline with no postal
field anywhere — the "bare single-field Full Name checkout" edge case,
decided: refused), bare `city` (field-level `city`, but not anchor-eligible —
proven both ways: admitted once independently anchored, refused as the SOLE
postal signal — the job-application fixture), `destination` (matches nothing
at all).

**Required fixtures** (`test/fixtures/save-moment/identity/`, wired into
`manifest.js`'s now three-way `family` union):
`billing-jostens.html` (the motivating page, every field `autocomplete="on"`
— useless hints, forcing the fallback path to carry the whole proof);
`incident-report-third-party.html` (the ACCEPTED, NAMED false positive —
third-party incident address + reporter's own name/email, pinned
admitted-with-reasoning per flight.md DD1/LD4 decision 3, with DD2's Leg-3
conflict rule named as the backstop in the fixture's own header);
`job-application-bare-city.html`, `flight-search-destination.html`,
`newsletter-name-and-email.html`, `shipping-cost-estimator.html` (all
negative-detection). The existing `unhinted-billing-fields.html`
(field1/field2/field3, anonymous) is REUSED, not paralleled, as this leg's own
required "anonymous field shape" adversarial case — confirmed still `[]` for
identity, and now covered by `assertNoDetectableEntry`'s extension.

**Three-way family dispatch** (`test/helpers/save-moment-assertions.js`):
`assertDetectsEntry` was `family === 'card' ? findAllCardFields :
findAllLoginFields` — `'identity'` would have silently asserted against the
LOGIN detector. Now a genuine three-way dispatch, with `entry.anchor` as
identity's anchor field (paralleling `entry.number`/`entry.password`).
`assertNoDetectableEntry` now asserts identity emptiness too — verified this
was the correct fix by first RUNNING THE SUITE WITHOUT IT: every existing
negative-detection fixture continued to pass (login/card unaffected), which
is exactly the silent-coverage-loss failure mode the leg's own AC warns is
"the single easiest thing in this leg to miss" — the extension makes the
suite catch a future identity false positive on an already-negative fixture,
which it could not have before.

**The anchor proven load-bearing, not assumed** (leg's Verification Steps):
built a throwaway variant of the module with the anchor-gate `if`s replaced
by an unconditional `resolved[0]`, ran it against all five adversarial
fixtures. 4 of 5 (`job-application-bare-city`, `flight-search-destination`,
`newsletter-name-and-email`, `shipping-cost-estimator`) flip from refused to
admitted with the gate removed — direct proof the anchor, not incidental
vocabulary narrowness, is what refuses them. The fifth,
`unhinted-billing-fields` (anonymous `field1`/`field2`/`field3`), stays
refused even gate-removed — it is refused by vocabulary absence (no field's
haystack matches ANY alternative, postal or not), not by the anchor. Recorded
honestly rather than claiming a uniform "all five" result the evidence does
not support.

**Edge cases** (leg's own list), each decided and unit-tested: address-only
scope (street + city + postalCode, no name/email/phone) — REFUSED, same rule
as the shipping-cost estimator (LD4 amendment 2 is symmetric); two identity
scopes in one document (billing + shipping forms) — both detected
independently; a postal field that is also login-claimed — LD3 applies, and
when that field was the scope's ONLY anchor-eligible field, the scope loses
its anchor entirely, not just that field's role (tested as two distinct
scenarios: a non-anchor field contested vs. the anchor field itself
contested).

**Verification run**: `npm test` — 5248 tests, 5245 pass / 0 fail / 3
pre-existing todo (net +41 over Leg 1's landing figure of 5207 tests: +35 in
the new `vault-identity-fields.test.js`, +6 new manifest/corpus entries: 2
`gated` identity-positive + 4 `negative-detection` identity-adversarial).
`npm run lint` clean (added `vault-identity-fields.js` to
`eslint.config.mjs`'s CJS-required-by-preload block, same fix Leg 1 needed
for `field-tokenizer.js`). `npm run typecheck` clean. `npm run format` run
(Prettier re-wrapped the three-way ternaries in
`save-moment-assertions.js`/the test file's long filter lines; re-verified
green after). `npm run format:check` clean. **CI itself (local Concourse) was
not run** — it needs an interactive login unavailable to this agent; the
gates above stand in for it, as instructed.

No deviations from the leg spec's mechanism. One scope note: the leg's own
illustrative LD1 "Shape" example groups `address1`/`address2` alternatives
under a single `street` role; this implementation instead uses two roles
(`street`/`street2`) so a real form's two address lines resolve to two
distinct entry fields rather than the second silently losing to
first-match-wins on a shared role — a strictly more useful shape for Leg 3,
consistent with the leg's own "and so on" framing of that example as
illustrative rather than literal.

### Leg 3 `identity-item-type` — landed 2026-09-20

Implemented to the design-reviewed leg spec (its first draft's two HIGH
findings — the trivially-bypassable LD2 scoping and the third-type-source /
invisible-item regression — were already corrected in the text handed to this
implementation; followed closely, not re-litigated).

**Three type sources, all three edited by hand** (DD4, amended): `SCHEMA` in
`vault-item-schema.js` gains `identity` with LD1's conservative split
(non-secret `title`/`fullName`; secret `firstName`/`lastName`/`email`/`phone`/
`street`/`street2`/`city`/`region`/`country`/`postalCode` — Leg 2's eleven
detector role names verbatim, no translation layer, cross-module-tested
against `vault-identity-fields.js`'s `POSTAL_ROLES`/`NON_POSTAL_ROLES` union);
`vault-store.js:126`'s independent `ITEM_TYPES` `Set` gains `identity`
separately; `vault-editor-model.js`'s `EDITOR_LAYOUT`/`EDITOR_TYPES` gains an
`identity` entry with a UI label for every field (a new test pins every field
of every type to a non-empty label string). The two hardcoded
`"item.type must be one of login|card|note"` strings (`_normalizeItem`,
`_saveItemPreservingSecrets`) now name `identity` too. The one permitted page
edit — `vault.js`'s `ITEM_SUBSECTIONS` — gained an `identity` entry so
`partitionItemsByType` learning the type doesn't make identity items silently
unrenderable (the leg's own stated exception to its "no page work" boundary).

**`classifyCapture` + `identityProfileOf`** land in a new module,
`src/main/vault/identity-profile.js` (pure, main-only CJS, the
`card-identity.js` precedent — no store, no Electron, no live caller until
Flight 3). `classifyCapture(stored, captured)` returns
`{kind, gapFilled, conflicting}` (never a flat `changed` list), byte-exact
equality (no normalisation — pinned with `"555-1234"` vs `"5551234"`), and the
fresh-profile residual (`stored` null/undefined → every captured field is a
gap) is its own named test. `identityProfileOf(items)` is the canonical "the
profile" read: `{profile, extra}`, where a duplicate SURFACES via `extra`
rather than being silently picked past. 13 direct unit tests
(`identity-profile.test.js`), all passing with no caller yet.

**LD2 enforced at every write path, not just `saveItem`** — the design
review's own finding, closed at all four sites it named:
- `_saveItem` REFUSES outright (throws, no write) when the item being saved is
  `identity`-typed and a DIFFERENT identity item already exists — uses
  `identityProfileOf` rather than a bespoke `.find()`.
- `mergeVaultItems` gained an `identitySkipped` return: once the destination
  already has an identity profile (from `existing` or from an identity item
  this same merge already landed), every FURTHER incoming identity item is
  refused — disjoint id AND same-id-but-diverged both refused (never a
  conflict copy, which would create a second profile); a same-id
  byte-identical item still falls through to the ordinary `skippedIdentical`
  no-op path.
- `capSingleIdentity` (new) caps a bundle vault's OWN item array to at most
  one identity item — used at `_importVault`'s fresh + existing (whole-vault-
  replace) writes, `restoreProfile`'s COMMIT (both merge and fresh-write
  branches), and PREVIEW (destination-independent — a bundle vault carrying
  two identity items is knowable before any target is chosen).
- All three are directly unit-tested (not only through their call sites):
  `mergeVaultItems`'s disjoint-id / diverged-same-id / identical-same-id /
  first-ever-profile / two-in-one-incoming-array cases, `capSingleIdentity`'s
  keep-first-drop-rest, and `_saveItem`'s refusal via `store.saveItem`
  directly.
- Where DD2 and DD3 collide at the merge site: the ruling ("keep destination,
  report incoming as skipped, reuse DD3's `skippedTypes` shape — no second
  mechanism") is implemented literally — `merge.identitySkipped` pushes
  `'identity'` into the SAME `skippedTypes` array the type-tolerance path
  populates, never a separate field.

**DD3's tolerant importer, all three `validateImportedItems` call sites, three
different fixes — `validateImportedItems` itself is UNCHANGED** (a new
sibling, `partitionImportedItems`, is the tolerant one; the strict validator
stays exactly as before, still used by nothing outside its own direct test —
`.gfvault`'s parse path never called it in the first place, so "the parse path
keeps loading loudly" was never contingent on this decision, but is pinned by
two new tests regardless, one per call-site family):
- `_importVault` (`:2236`-ish) — CONFIRMED zero callers in `src/main` (grepped
  again at implementation time). Fixed as a store-only return-shape change:
  `skippedTypes?: string[]` added to the return, conditionally spread (omitted
  when empty, so the pre-existing exact-shape `deepEqual` test at
  `vault-export-import.test.js:426` needed no change). Proven with a
  monkeypatched `vc.decryptItems` (the `vault-restore-preview.test.js`
  "cycle-2 HIGH pin" idiom) on both the fresh-adopt and existing-profile
  branches, plus the two-identity-items-in-one-vault case.
- `restoreProfile` COMMIT (`:2496`-ish) — gained a `catch` around the
  per-entry body (previously `try`/`finally` only): a genuinely malformed
  entry (never an unrecognized TYPE, which is tolerated without throwing) now
  fails ONLY that entry (`outcome: 'failed'`, `anyFailed = true` still gates
  the fresh-profile adopt) and the loop CONTINUES — proven with a 3-vault
  bundle where the MIDDLE entry is malformed (duplicate item id) and BOTH the
  earlier and the later entry still land, which is a strictly stronger proof
  than the edge case's own "earlier vaults survive" framing. **This changed
  the behavior an EXISTING test
  (`vault-restore-fault-injection.test.js`'s zeroize-discipline pin) asserted**
  — it expected the whole `restoreProfile` call to REJECT on a per-vault
  throw; updated to assert the new `outcome: 'failed'` result shape instead,
  keeping its actual point (the per-iteration `finally` still zeroizes the
  vault key buffer even though the throw is now caught, not propagated) fully
  intact.
- `restoreProfile` PREVIEW (`:2660`-ish) — `itemCount` now counts only
  KNOWN-type items (post-`partitionImportedItems`+`capSingleIdentity`); a new
  `skippedTypes?: string[]` per label reports what was excluded, so preview
  never under-counts silently. A genuinely malformed vault still fails the
  WHOLE preview (unchanged, and re-pinned) — DD3 softens only the type check,
  never the loud-corruption behavior the preview step exists to catch before
  any commit.
- Neither COMMIT nor PREVIEW needed IPC changes, confirmed: `vaultImportCommit`
  returns `results` verbatim and `peekLabels` passes `labels` through raw.

**Edge cases, all pinned**: a bundle where every item is an unknown type
(`partitionImportedItems` unit test — imports nothing, reports everything); an
unknown type in a multi-vault restore (the malformed-middle-entry integration
test above, a superset of the named case); `classifyCapture` with a stored
profile and an empty capture (kind `match`, never `conflict`).

**Verification run**: `npm test` — 5291 tests, 5288 pass / 0 fail / 3
pre-existing todo (net +43 tests over Leg 2's landing figure of 5248: two new
test files, `identity-profile.test.js` (13 tests) and
`vault-identity-item-type.test.js` (29 tests), plus one new test each in
`vault-item-schema.test.js` and `vault-editor-model.test.js`, and one existing
test in `vault-restore-fault-injection.test.js` updated in place rather than
added). `npm run lint` clean (no
new eslint.config.mjs entries needed — `identity-profile.js` is main-only,
same as `card-identity.js`, not preload-reachable). `npm run typecheck` clean.
`npm run format` run (Prettier re-wrapped `vault-item-schema.js`'s new
`identity.secret` array onto one line, and a couple of long test lines;
re-verified green after — `npm run format:check` clean). **CI itself (local
Concourse) was not run** — it needs an interactive login unavailable to this
agent; the gates above stand in for it, as instructed.

No deviations from the leg spec's mechanism or acceptance criteria. One
finding OUTSIDE this leg's charter, reported rather than folded in: none —
no new defect was found during implementation; the one adjustment required to
an existing test (`vault-restore-fault-injection.test.js`'s zeroize-discipline
pin) was a DIRECT, IN-CHARTER consequence of DD3's per-entry-exception-handling
requirement, not an unrelated defect.

---

## Decisions

*(Runtime decisions not in the original plan.)*

---

## Deviations

*(Departures from the planned approach.)*

---

## Anomalies

*(Unexpected issues encountered.)*

---

## Session Notes

### 2026-09-19 — Planning

Four operator rulings: strong-hints-only plausibility (refuse to guess), one
composite profile, a tolerant-and-reporting bundle importer, and the fill-precision
regression closed in this flight.

The recon changed one inherited assumption: the mission expected
`unhinted-billing-fields.html` to become an identity-positive shape. It should not.
Its fields are `field1`/`field2`/`field3` carrying only placeholder text, and DD1
explicitly declines to infer an address from a placeholder. The fixture stays
negative — which is the honest outcome, and one the mission would have got wrong.

### 2026-09-19 — Design review round 1: scope split, three DDs hardened

Review returned **feasible with caveats** and made one structural call I accepted
outright: the drafted flight repeated Flight 1's sizing mistake. Its Leg 3 bundled
identity detection design, fill, capture, and a cross-cutting fix to the existing
shared fill routing — four separable concerns that Flight 1 needed multiple
dedicated legs and six review rounds to get right across a *narrower* split.

**Flight split.** This flight is now "Identity foundations": one decision cluster —
what an identity is and how it is stored. Fill, capture, the three-way sheets and
the fill-precision regression move to a new Flight 3. The mission's flight list is
updated; generator/icon becomes Flight 4.

**Three DDs were preferences, not decisions. Now decided:**

- **DD1** had no boundary. "Unambiguous by name" is not implementable, and the
  review was right that the codebase argues the line is hard: card's own table
  requires a `card`/`cc` anchor for `number` precisely because a bare word is too
  generic — and it still shipped two squawks. Identity has no anchor at all. The
  rule is now explicit: a SPECIFIC token stands alone (`postal-code`, `given-name`,
  `tel`…); a GENERIC one (`name`, `city`, `address`, `state`, `country`) qualifies
  ONLY with a `billing`/`shipping`/`contact`/`home`/`work` prefix. The prefix
  requirement is what replaces the missing anchor. Jostens still passes; a job
  application's bare `city` is refused. And the rule is not trusted until Leg 2
  proves it against adversarial near-misses — asserting a pattern table without
  attacking it is exactly what shipped 0090 and 0091.
- **DD2**'s conflict case was carried as an open question. Promoted: a capture
  whose value DIFFERS from the stored profile never silently overwrites — it offers
  an explicit update naming what changes. The scenario that forced this: a
  gift-shipping checkout carries someone else's name and address, and a silent
  write would corrupt the operator's own identity with a stranger's, then fill it
  into an unrelated later form. Softer than DD3c's hard-zero, same family. It is
  also load-bearing for schema shape, which is why deferring it to leg design
  would have repeated Flight 1's rework.
- **DD3** undercounted its own blast radius. The draft said "one throw at `:549`";
  there are THREE call sites with three different fixes — `_importVault` has no
  outcome shape at all (new plumbing end to end), the restore COMMIT loop's throw
  is not caught per-entry (one unknown type aborts an entire multi-vault restore
  today), and the PREVIEW path would silently under-count unless it reports too,
  which this DD's own "never swallow" rule forbids.

**Verified rather than accepted:** `renderer.js` is 1576 lines against a 1577
budget — one line of slack, confirmed. Not this flight's problem (no renderer
work), but Flight 3 starts in deficit and the spec says so. The three importer call
sites confirmed. **One reviewer claim REJECTED**: it reported 5 `isCard` sites in
`vault-picker-template.js` and called the recon inaccurate; there are 7, as the
recon said.

**New open question, raised by review and not addressed anywhere in the mission**:
an `email` field is plausibly both a login username and an identity email on the
same form. Which detector claims it, which icon shows? Assigned to Leg 2, where the
two detectors first coexist.

### 2026-09-19 — Design review round 2: DD1 rewritten around a scope anchor

Round 2 confirmed the split was right (both remaining legs independently
completable, with precedent — Leg 2 mirrors Flight 1's `fixture-corpus`, Leg 3
mirrors the existing `note` type which also ships with no detector), verified DD3's
three-call-site characterisation against source in detail, and then found the hole
in DD1.

**DD1's token table failed in BOTH directions, and one rule fixes both.**
- It **over-admitted `email`**. My "specific token stands alone" test was about
  SPELLING ambiguity — is a field named `email` unambiguously collecting an email?
  Yes. But that is the wrong question: a bare standalone email field is among the
  most overloaded widgets on the web (newsletter boxes, contact forms, password
  resets, "email a friend"), none of them identity contexts. Wired into Flight 1's
  broadened capture machinery, every one becomes a save candidate — a wrong-moment
  cost of a different order than the mission's "budget, not a wall" framing.
- It **under-admitted a bare single "Full Name" field**, which is the most common
  identity shape on small checkouts that do not split given/family name. The
  generic-requires-prefix rule refused it.

Rewritten around a **SCOPE ANCHOR**: a scope is an identity context only if it
contains an admissible POSTAL role (street/address-line, postal-code, or a
prefix-qualified city/country). Without one, nothing in that scope is admissible.
With one, generic tokens qualify without a prefix. A postal address present in the
form IS the structural signal identity has no field-level equivalent for — and it
mirrors the card family's own "a form that hints even once is trusted to hint
completely" discipline. A newsletter has no address; a checkout does.

**The matching ALGORITHM is now flagged as unchosen and assigned to Leg 2.** The
admit/refuse verdicts depend on it entirely: whether `zipcode` matches at all turns
on word-token vs boundary-anchored regex, and a `\b`-anchored `zip` would fail
exactly as 0091 failed on `card_nameOnCard`. Leg 2 pins the algorithm before
writing the corpus, and must carry `addr1`, `zipcode`, `fname`/`lname`, `mobile`,
`emailAddress` and a bare single-field "Name" checkout as NAMED cases.

Also applied: DD2 gains a pure unit-tested `classifyCapture` in Leg 3 (otherwise
the conflict rule stays paper until Flight 3 — the failure DD1's own language
warns about) and an honest residual, that on a FRESH profile every field is a gap
so DD2's own motivating gift-shipping scenario classifies as an ordinary merge;
DD6 now says the tokenizer extraction is NEW DESIGN, not extraction, landing in
the same leg that edits those regexes to fix 0090/0091; the family-conflict
question is restated as structural — `resolveLoginEntry` picks by document
POSITION, never by name, so any identity field before a password is claimed by
login regardless of spelling — and Leg 2 must produce a precedence DD, not a
ticked checkbox; Leg 3 must rule on whether the store enforces one profile per
vault; and Leg 1 must add a `card_nameOnCard` test with NO placeholder, since the
existing one passes only on that crutch.

**Corrections to this log's own earlier entry**: the previous round's `isCard`
count dispute was recorded too flatly. Both numbers are defensible — `grep isCard`
on `vault-picker-template.js` returns 5 (one declaration, four uses); 7 counts the
two additional `type === 'card'` branch points that Flight 3's three-way migration
must also touch. 7 is the more useful number for scoping; "5 is simply wrong" was
imprecise and is withdrawn.

**Mission flight numbering defect, introduced by my own split and now fixed**: the
list carried TWO "Flight 3" entries and skipped Flight 4 outright, which would have
collided on directory naming at the next flight creation.

Review cycle cap reached (2 of 2). Going to the operator for sign-off.

---

## Flight Director Notes

### 2026-09-19 — Flight start

Operator approved after two design-review rounds. Flight `planning` → `in-flight`;
branch `flight/02-identity-items` created.

### Leg 1 `fallback-pattern-foundation` — risk tier: HIGH

Tiered high on two criteria: **security-sensitive surface** (this detection feeds
what gets written into the vault) and **shared-interface change** (the extracted
tokenizer becomes a primitive a second family will consume). Per-leg design review
therefore runs before implementation.

**The 0090 fix is a design decision I made at leg design rather than deferring, and
it is worth recording because the obvious answer is wrong.** The intuitive fix —
requiring the expiry roles to carry a `card`/`cc` token — buys 0090 with a false
negative: `expirationMonth` is a real spelling on real card forms and is detected
today. A denylist of disqualifiers (`session`, `coupon`, `password`, `license`) is
worse: unbounded, and fragile in precisely the way these patterns have already
failed twice.

The fix is **anchor-proximity selection**: when a scope yields several candidates
for a role, the one nearest the detected card-number anchor wins, replacing
first-match-wins. This changes SELECTION, not matching — so it costs no false
negatives at all, and it resolves the realistic case (a checkout carrying both a
promo expiry and the card's own) correctly regardless of document order.

**Named residual, stated rather than hidden**: a scope whose ONLY expiry-shaped
field is unrelated still resolves it. Narrower than today, and honest.

**One adjacent pre-existing defect pulled in deliberately**: `accNumber` resolves to
`number` today, because `cc` substring-matches inside `acc` — the
`(card|cc|creditcard|pan)` group has no leading word boundary. Probed and confirmed
(`accNumber` → `number`, while `acctNumber` and `successNumber` → null). It is the
same class, in the same patterns this leg already edits, and leaving it would mean
touching these regexes twice. In scope, with its own tests.

**The leg's real risk, per DD6**: the tokenizer is NEW DESIGN, not extraction —
`splitCamelHumps` handles camelCase only, while underscore tolerance currently
lives inside each regex's `[-_ ]?` class. Normalising `_` to a space fires word
boundaries that previously did not, which is the fix for 0091 and the hazard for
everything else. The negative set is the guard, and the leg requires the two
mechanisms be separately testable so a regression can be attributed.

### Leg 1 design review round 1 — my 0090 fix was largely cosmetic

The reviewer confirmed the doubt I raised when spawning it, and the answer was the
uncomfortable one.

**Anchor-proximity SELECTION does not fix 0090.** Traced through the squawk's own
evidence: four of its five lines (`sessionExpiry`, `couponExpirationDate`,
`passwordExpirationDate`, `licenseExpirationDate`) are SINGLE-candidate scopes.
Proximity only changes an outcome when two candidates compete for a role, so it had
nothing to select between in the majority of the reported cases. Worse, many real
card forms use split month/year `<select>`s and carry no generic `expiry` text
field at all — so for that role specifically, single-candidate is the norm, not the
edge. My leg would have closed 0090 while leaving most of it live.

**Rewritten as a two-condition GATE**, because selection is the wrong axis: an
expiry-family candidate qualifies only if it carries a card-context token OR sits
within a stated window of the card-number anchor. Each half alone fails — (a) alone
rejects `expirationMonth`, a real spelling detected today; (b) alone is the
cosmetic version above. Together they admit a card form's adjacent
`expirationMonth` and reject a `sessionExpiry` elsewhere in the same form.

The window is a NAMED constant with its own tests. It encodes a design bet — card
forms put expiry near number — and a future reader must be able to find and re-tune
it rather than discovering a magic number in a condition.

**0090 now closes as `completed` with an explicitly-named accepted residual**, not
a blanket completion: an unrelated expiry sitting ADJACENT to the card number still
resolves. The earlier draft would have overclaimed in the squawk record itself.

Three further corrections applied:
- **Guidance 3 was wrong about the code.** I wrote that `findAllCardFields`
  resolves the anchor before other roles. It does not — both passes are single
  linear scans where each field claims its own role immediately, so by the time the
  anchor can be named, every other role is already locked by first-match-wins.
  Implementing the gate is real surgery on `rolesIn`, in two phases, not a
  "confirm and proceed" checkpoint. Verified feasible: `candidateFields`' array
  index is a faithful document-order proxy and the fake-DOM contract already
  returns fixed insertion order, so no new DOM surface is needed.
- **The gate is scoped to the FALLBACK pass only.** The autocomplete pass keeps
  first-match-wins so its existing hidden-duplicate comment stays true.
- **DD6 named two extractions and my leg silently kept one.** The
  autocomplete-token lookup MECHANISM is now in scope (data stays card-side).
  Verified that Leg 2 needs this shape for DD1's WHATWG tokens and that the login
  family has no precedent to borrow — without it, Leg 2 would duplicate it or reach
  into a file this leg owns.

**Verified clean and worth recording** (the reviewer ran code rather than reasoning
about regexes, per instruction): the `^ccnumber$`-style anchored alternatives are
NOT broken by underscore normalisation — an input containing a separator never
matched them in the first place, so my worry was vacuous. But they DO still provide
unique coverage for the literal spellings `ccmonth`/`ccyear`/`ccexp`, which are now
added to the regression pin so a future edit cannot delete them silently. The
`accNumber` fix confirmed to close `accNumber`/`acctNumber`/`successNumber` without
touching `payment.cardNumber`, `card_cardNumber`, `cc_number` or `ccNumber`.

### Leg 1 design review round 2 — gate holds; six spec gaps closed

No HIGH findings. The reviewer ran probes against the real module rather than
reasoning about regexes, and confirmed the two-condition gate is a genuine fix
rather than round 1's cosmetic one: condition (a) admits every real card-expiry
spelling tested (`cc-exp`, `ccExpMonth`, `card_cardExpMonth`, `cardExpiry`,
`creditCardExpirationMonth`, `payment_exp_month`) and rejects all five of 0090's
evidence lines.

**Condition (b) earns its keep, narrowly.** I had asked whether it was a knob for
nothing. Answer: `expirationMonth` genuinely fails (a) and is an EXISTING PINNED
regression in `vault-card-fields.test.js` — not a hypothetical the leg invented. So
(b) exists to preserve already-shipped, already-tested behaviour that (a) cannot
cover. Small, but real.

**The one finding worth the round: window directionality was unspecified.** Neither
the leg nor the log said whether the window is forward-only or bidirectional, and
real forms place cardholder or expiry BEFORE the number field. A forward-only
implementation would have created a NEW false negative on those — the same class of
incomplete fix round 1 caught, just relocated. No fixture in the repo exercises a
reversed order, so it was untested by construction. Now pinned bidirectional with a
required regression case.

**The window value is no longer left to taste.** Distance probes show anchor →
its-own-expiry stays at 2–3 even with 16 preceding billing fields — those sit
BEFORE the anchor, not between it and the candidate — and reaches 3 with unrelated
selects interleaved. 4–6 is defensible, derived from one card entry's own field
count (number, name, month, year, csc ≈ 5).

**The residual is now named concretely rather than abstractly**:
`couponExpirationDate` beside a payment section. That is one of 0090's own five
evidence lines, and promo fields commonly sit next to payment on real checkouts —
foreseeable, not remote.

**And the 0090 closure has a trap the leg now warns about**: after this fix,
`fallbackRoleOf({name:'sessionExpiry'})` called in isolation STILL returns
`'expiry'` — correctly, since the gate lives in `rolesIn` and depends on an anchor a
bare field probe knows nothing about. The squawk's original evidence was phrased as
bare probes, so the sign-off must say the fix is pipeline-level or a future reader
will expect `null` and think it regressed.

Also closed: stale "ties in proximity" language from the superseded selection design
(the design is gate-then-first-match); and `giftCardExpiryDate` naming, admitted by
(a) on the literal token `card`, recorded as an accepted non-goal mirroring an
ambiguity the `number` pattern already has.

Review cycle cap reached (2 of 2). Leg status → `ready`; implementation proceeds.

### Leg 1 complete — Flight Director verification

Verified independently rather than on the Developer's report: `card_nameOnCard` →
`cardholder` by name alone (0091); `accNumber` → `null` (the adjacent substring
defect); field-level `sessionExpiry` → still `'expiry'` (the TRAP, correct — the
gate is pipeline-level); a distant `sessionExpiry` on a card form now REJECTED at
the pipeline (0090 actually fixed, not cosmetically). `EXPIRY_ANCHOR_WINDOW` = 5,
inside the 4–6 range the distance probes justified. 5204 pass, 0 fail, 3 todo.

Worth recording: the Developer marked squawk 0090/0091 sign-offs **PENDING** rather
than writing them, because no independent reviewer has seen the code yet (this
flight batches review to the end). Fabricating a sign-off in a permanent record
would have been fiction; saying so was right. It also added a multi-survivor
tie-break test nobody asked for — the spec says gate-then-first-document-order, and
nothing otherwise exercised it.

### Leg 2 `identity-boundary` — risk tier: HIGH

Tiered high without hesitation: this leg IS the admissibility boundary, and
identity is the one family with neither a structural anchor nor a plausibility
gate. If the boundary is wrong, everything downstream inherits it.

Two leg-level decisions made at design rather than deferred:

**LD1 — matching is word-token SET membership, not boundary-anchored regex.**
`\b`-anchored regex is exactly what shipped squawks 0090 and 0091 — boundaries that
do not fire at camel humps or against `_`. Leg 1's tokenizer already removed the
separator problem, which makes a token set simpler AND strictly more predictable.
The consequence is the point: every spelling must be DECLARED. `zipcode` normalises
to one token and must appear in the vocabulary explicitly rather than being reached
accidentally by a `zip` prefix. The card family stays on regex — it is now correct,
and churning it again would risk what Leg 1 just fixed.

**LD3 — login wins a contested field.** Not for the reason it first appears:
`resolveLoginEntry` selects the username by DOCUMENT POSITION only (verified — it
reads `input.type` and nothing else), so the contest is structural and a name-based
precedence rule would simply never engage. Login wins because its claim is anchored
on `input[type=password]`, a structural fact, while identity's is a vocabulary
judgement. The stronger anchor wins.

**The easiest thing in this leg to miss, now an explicit criterion**:
`assertNoDetectableEntry` asserts only that LOGIN and CARD find nothing. Add a third
family without extending it and every existing negative-detection fixture silently
stops covering identity — the corpus would look green while testing less than it
did before.

### Leg 2 design review round 1 — needs rework; a flat token set does not work

Two HIGH findings, both verified by running the real Leg 1 tokenizer rather than
reasoning about it. I had asked the reviewer the flat-vs-adjacency question
directly; the answer is that flat fails, and it fails on the motivating fixture.

**[HIGH] LD1's flat token set cannot reach the motivating page's own street
field.** Verified:
```
billingAddress1  -> ["billing","address1"]     <- NO "address" token exists
billingFirstName -> ["billing","first","name"]
billingLastName  -> ["billing","last","name"]  <- both carry "name"
```
`billingAddress1` is reachable only via an explicit `address1` vocabulary entry —
and my named-spelling checklist listed `addr1`, the abbreviation, but NOT
`address1`, the literal motivating spelling. The Jostens fixture would have
anchored on its postcode and passed the "motivating page passes" criterion while
**silently dropping the street address**. First/last/full name all share `name`, so
a flat set cannot tell them apart either; whichever role was checked first would
win.

Rewritten: **a role is a list of ALTERNATIVES, each an all-tokens-required set;
conjunctive within, disjunctive across, longest match wins.** So `{first,name}`
beats `{name}` on `billingFirstName`, and `street` carries `{address1}`,
`{addr1}`, `{street,address}`, `{address,line1}` as separate alternatives.

**Also caught: the vocabulary has to be written TWICE.** The two matching paths
normalise differently — `resolveAutocompleteToken` leaves hyphens intact, while
`normalizeFieldHaystack` converts them to spaces. So a literal `"postal-code"`
pasted from DD1's prose into the fallback path is a DEAD entry that never fires,
silently, and invisibly if another spelling covers the role by luck.

**[HIGH] I named one vacuous-assertion trap and missed its sibling.**
`assertDetectsEntry` is `family === 'card' ? findAllCardFields :
findAllLoginFields` — so `'identity'` falls through to the LOGIN detector. I had
flagged exactly this class for `assertNoDetectableEntry` and written it up as "the
single easiest thing in this leg to miss", then missed the function that proves the
POSITIVE criteria. Every positive identity fixture would have asserted against the
wrong family.

Three more applied: anchor-qualification is now a SEPARATE ungated predicate (the
first draft was circular — field admissibility depends on the scope being anchored,
and the anchor was computed from admissible fields); prefix-qualification is
per-FIELD, not per-scope (otherwise a stray `billing_department` plus a bare `city`
jointly anchor); and **bare `address` is not anchor-eligible**, which is what stops
`emailAddress` → `["email","address"]` from anchoring a newsletter on a stray token
— the exact over-admitted-email failure DD1 was rewritten to close.

**The adversarial set was also inadequate in a way I had not seen**: every fixture
in it FAILED TO ANCHOR. None probed a scope that anchors correctly and still should
not be an identity. Two added — a shipping-cost estimator (`zip` + `country`, no
name) and an incident form describing a third-party location plus a reporter's
details.

LD3 now requires a CALLABLE artifact (`isClaimedByLogin`, or the detector refusing
to double-claim) rather than prose plus a passing test, which would have left
Flight 3 re-deriving the rule.

### Leg 2 design review round 2 — cycle cap reached; three decisions made, flagged to operator

Round 2 confirmed both round-1 HIGH findings genuinely closed (the alternatives
model resolves `billingFirstName`/`billingLastName` unambiguously at 2 tokens
beating `fullName`'s 1; the three-way `assertDetectsEntry` dispatch is a named AC).
It then found the rework had opened a new hole in the same mechanism and had never
resolved the two adversarial fixtures round 1 itself added.

**[HIGH] A reachable TIE between `email` and `street`.** `billingAddress` →
`["billing","address"]` matches none of the shown street alternatives, so admitting
it needs a bare `{address}` alternative — at which point `emailAddress` →
`["email","address"]` matches `email`'s `{email}` and `street`'s `{address}` at
EQUAL length, and the winner is whichever the implementer checks first. That is
precisely the ambiguity the alternatives model was introduced to remove, reappearing
one role over. LD2's "bare `address` is not anchor-eligible" correctly protects the
ANCHOR phase and does nothing for field-role resolution once some other field
anchors the scope.

**[HIGH] Neither adversarial fixture is actually refused by the rules as written.**
I predicted this before the review returned. `postal-code` carries no prefix
requirement (the qualifier attaches only to city/country), so a bare `zip` anchors
on its own and the shipping-cost estimator is ADMITTED. I had added the fixture in
round 1 and supplied nothing that refuses it.

**Three decisions made rather than escalated — the operator has been told.** The
methodology escalates after two cycles; these were judgement calls I own as Flight
Director, the flight has a standing "complete it" instruction, and stalling on
three decidable questions serves nobody. All are reversible and all are recorded:

1. **`address` is NEVER bare-admissible**, at anchor or field. Symmetric, kills the
   tie, and settles `billingAddress` cleanly. Amends flight DD1, whose "generic
   tokens need no prefix" list included `address`.
2. **An anchored scope additionally requires ≥1 NON-POSTAL role** (name / email /
   phone). A postal anchor alone is not a person. Closes the estimator; an
   address-plus-phone shape still qualifies, so this refuses postal-ONLY scopes and
   nothing else.
3. **The incident form is an ACCEPTED, NAMED false positive.** A third party's
   address plus the reporter's own name and email clears every gate, and DD1's
   founding principle ("nothing inferred from shape, position or value")
   structurally forbids the only signal that could tell whose address it is — label
   proximity. It is irreducible to a vocabulary-only detector. Accepted rather than
   pretended away, with **DD2's conflict rule as the backstop**: a differing value
   never silently overwrites, it surfaces an explicit update naming what changes.

Also applied from the review: `postcode` named explicitly as needing its own literal
entry (a glued lowercase token like `zipcode` — the first draft named only the
latter, the same near-miss that almost dropped `address1`); the city/country prefix
vocabulary named rather than left to the implementer; and `isClaimedByLogin` pinned
to build on the already-exported `findAllLoginFields` (`field === entry.username`
across entries), which satisfies LD3's callable-artifact requirement without
touching `vault-fill-fields.js` as the constraint requires.

Proceeding to implementation. Third review cycle deliberately not run.

### Leg 2 complete — Flight Director verification and one sign-off

Verified against the built detector rather than the report. All six identity
fixtures behave as designed: Jostens DETECTED; flight-search, job-application bare
`city`, newsletter, and the shipping-cost estimator all REFUSED; the incident form
DETECTED as the accepted named false positive. The estimator's refusal is the
non-postal-role rule I added at the cycle cap, working. 5245 pass, 0 fail, 3 todo.

Also verified the round-2 tie directly: in an anchored scope, `emailAddress`
resolves to **email**, not street — and `billingFirstName`/`billingLastName`
resolve to distinct roles, which was round 1's finding. Both holes closed in code,
not just in prose.

**Sign-off on the Developer's flagged judgment call**: it implemented `street` and
`street2` as two roles rather than the single `street` my LD1 example implied,
so a form's two address lines resolve to two distinct fields instead of the second
losing to first-match-wins. That reading is correct — my "and so on" was
illustrative, and collapsing them would silently drop address line 2, which is the
same class of silent-drop the `address1` finding caught. Accepted as specified.

Worth recording: the Developer built a throwaway no-gate variant of the detector to
prove LD2's anchor is load-bearing, found 4 of 5 adversarial fixtures flip to
admitted without it, and reported honestly that the 5th
(`unhinted-billing-fields`) stays refused by vocabulary absence rather than by the
anchor — rather than claiming 5 of 5.

### Leg 3 design review round 1 — two HIGH, one of them an invisible regression

**[HIGH] LD2's uniqueness was trivially bypassable.** I scoped it to `saveItem`.
Three other live paths write a full item array and never call it — `mergeVaultItems`
(dedupes by `id` only, so two identity items with different random ids are neither
identical nor merged and the incoming one lands as a SECOND profile), and both
import fresh-write branches. So "a second identity item cannot be created" was false
the moment any bundle import touched the vault. Worse, **DD2 and DD3 collide at that
merge call site** and my leg never said so. Ruling added: on a merge collision the
destination's profile is KEPT and the incoming one REPORTED AS SKIPPED, reusing the
reporting shape DD3 is already building. A canonical read accessor is also required,
so a future caller cannot `find()` its way past a duplicate silently.

**[HIGH] The schema change forces a THIRD type source, and satisfying it introduces
an invisible-item regression.** `vault-editor-model.js`'s `EDITOR_LAYOUT`/
`EDITOR_TYPES` is pinned to the schema by an `assert.deepEqual` drift guard — adding
`identity` turns that test red until the editor gains labels for every field. DD4
named only two sources; amended to three. And then the sting: `vault.js`'s
`ITEM_SUBSECTIONS` is a SEPARATELY hardcoded `['login','card','note']`, so once
`partitionItemsByType` learns `identity`, an identity item is bucketed correctly and
**never rendered** — and it is not `unknown` either, so it also misses
`renderUnknownItems`, whose documented purpose is that nothing unbucketable is
silently lost. A leg claiming "no page work" would have made identity items
invisible on the vault page.

**I amended the leg's own boundary rather than defer it.** Adding the one
`ITEM_SUBSECTIONS` line is page work, and the leg said no page work — but shipping a
known invisibility regression and handing it to Flight 3 is worse than a one-line
edit. Boundary now reads "no page work beyond the one line that stops this leg
making identity items invisible."

**[MEDIUM] My DD3 plumbing claim was wrong in both directions.** `vaultImportCommit`
returns `results` verbatim and `peekLabels` passes `labels` through raw, so COMMIT
and PREVIEW need NO IPC changes — I had said all three needed end-to-end plumbing.
And `_importVault` has **zero** main-side callers (verified: no `importVault`
references in `src/main` at all), so it is UI-unreachable and its fix is a store-only
return-shape change with a direct unit test. My framing would have pushed an
implementer into building IPC and page wiring the leg forbids.

**[MEDIUM] `classifyCapture`'s shape was insufficient** — a flat `changed: [names]`
forces Flight 3 to re-derive the per-field gap-vs-conflict judgement outside the
module, the drift a single-source module exists to prevent. Now
`{kind, gapFilled: [{field,to}], conflicting: [{field,from,to}]}`, with byte-exact
equality pinned (no normalisation — `"555-1234"` vs `"5551234"` is a conflict, and
hiding that would be a judgement the operator should make).

Also applied: the identity field set enumerated to match Leg 2's detector role names
exactly (no translation layer, so the halves cannot drift); `fullName` composition
stated; and the two hardcoded `login|card|note` error strings named.
