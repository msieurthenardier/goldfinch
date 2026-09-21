# Leg: identity-capture

**Status**: completed
**Flight**: [Identity Fill and Capture](../flight.md)

## Objective

Let a billing form typed by hand raise an identity save offer: the gesture's third
arm, identity's value-layer admission gate, a held identity record under the
zeroized-buffer discipline, disposition through `classifyCapture`, and a capture
sheet that names the fields changing — never their values. Close the flight's
two carried debts (`familyOf`, `classifyCapture` with no caller) and promote the
identity corpus.

## Context

- **Flight DD1** (multi-hold), **DD2** (the value-layer gate), **DD4** (corpus
  promotion + HAT), **DD5** (login > card > identity), **DD6** (field names,
  never values), **DD10** (`classifyCapture` is a hard-zero AC; the fresh-profile
  residual), **DD12** (a seam grant this leg does NOT use — see LD5). Read all.
- Legs 1-3 landed (uncommitted by design). Leg 1's `KIND_TABLE` in
  `vault-capture-template.js`, Leg 2's multi-hold and chrome queues, and Leg 3's
  `IDENTITY_ROLES`, `anchorRole` and in-world identity detection are all inputs.
- **Honest axes count: 5**, up from the flight spec's 3 — the value-layer gate,
  the conflict sheet mode, `classifyCapture`'s first live wiring, the
  fail-closed three-way dispatch (below), and the ten-field buffer discipline
  (LD2). The operator ruled on Leg 2 to keep a high-axes leg whole; this leg
  follows that ruling and states its count rather than splitting unasked.

## ⚠ The central danger: every capture dispatch defaults to LOGIN

Enumerated by shape (`familyOf|kind === 'card'|type === 'card'` across the
capture path). Every family dispatch is **binary with login as the else-branch**,
so a missed site does not crash — it **silently routes identity into the login
path**:

| site | shape today | if left binary, an identity record would… |
|---|---|---|
| `vault-human.js:84-85` `familyOf` | `rec.kind === 'card' ? 'card' : 'login'` | be classified as login, evicting pending login holds (DD1 defeated) |
| `vault-human.js:684` `captureRelease` | `if (rec.kind === 'card') … else <login>` | be released through `capture()` as a login |
| `vault-human.js:920` `captureFinalize` | `card ? disposeCardCapture : disposeLogin` | be disposed as a login |
| `vault-human.js:969` `captureSave` | `if (rec.kind === 'card') … else <login save>` | **be written to the vault as a `type: 'login'` item** |
| `webview-preload.js:580`, `:590`, `:595` | `resolved.kind === 'card' ? … : <login>` | be sent over the LOGIN capture channel |
| `vault-gesture-policy.js:154-155` `secretRoleForKind` | `kind === 'card' ? 'number' : 'password'` | check a `password` role it never has — never held (fails closed, but silently) |

`:969` is a wrong-type write — the mission's hard-zero class.

**LD1 — Every capture-side family dispatch becomes EXPLICIT and FAIL-CLOSED, through
ONE shared helper.** The known family set is `{ login, card, identity }`.
`familyOf(rec)` returns `'login'` only when `rec.kind` is absent (verified at
design review: every login-creating site — `capture`, `holdGestureLogin` — omits
`kind`, and every card-creating site stamps it), `'card'` or `'identity'` when
stamped, and `null` for any other value. An identity record stamps
`kind: 'identity'` at creation.
- **The three main-side dispatch sites (`captureRelease`, `captureFinalize`,
  `captureSave`) route through ONE exported pure helper**,
  `dispatchByFamily(rec, { login, card, identity })`, which calls the matching
  handler and returns a refusal sentinel — never a login fallback — when
  `familyOf(rec)` is `null`. **Why one helper** (design review, HIGH): the first
  draft required pinning the unrecognised-kind refusal at all three sites, but
  `familyOf` is private and no public API can construct a record with an
  unrecognised `kind` — the pin had no construction path. Three
  independently-written three-way branches would also be three places to drift
  back to a login default, the flight's own recurring lesson. One helper is
  directly unit-testable with a plain `{ kind: 'bogus' }` object and has one
  fallback to get right.
- `familyOf` and `dispatchByFamily` are added to `module.exports` beside the
  existing pure `originOf` export — the established precedent for exporting a pure
  helper from this Electron-free module.
- **The refusal sentinel and how each call site maps it** (design review round 2 —
  left unspecified, each site would improvise its own). `dispatchByFamily` returns
  one exported frozen constant, `FAMILY_REFUSED`, when `familyOf(rec)` is `null`.
  Every call site **drops and zeroizes the record first**, then returns the value
  it ALREADY returns when its record is gone — so each mapping is literally true
  rather than a convenient reuse:
  - `captureRelease` → the record is omitted from the returned array (exactly as a
    record whose disposition yields no offer is omitted today);
  - `captureFinalize` → `{ reason: 'expired' }` — its existing "no such record"
    reason (`if (!rec) return { reason: 'expired' }`), true once the record is
    dropped; no new chrome-side copy is needed;
  - `captureSave` → `{ saved: false }` — its existing "record gone" shape
    (`if (!rec) return { saved: false }`).
  No new reason string, no new chrome handling. Unreachable in production today (no
  public constructor produces an unrecognised `kind`), which is exactly why it must
  be pinned rather than assumed.

## Other leg-scoped decisions

**LD2 — The ten secret identity fields cross as ONE zeroizable buffer.**
`vault-item-schema.js` declares ten of the eleven identity fields secret. They
cross the capture IPC as ONE `Uint8Array` — the UTF-8 JSON of the ten secret
fields — held main-side as ONE `Buffer` on the record as **`rec.identitySecrets`**,
and zeroized at the `dropCapture` choke point **per LD7** (NOT automatically — see
LD7 for why the first draft of this sentence was wrong). `fullName`, the one non-secret field, crosses as a
plain string. Decoding to strings happens only transiently at dispose/save time,
mirroring `rec.password.toString('utf8')`.
- **Why not the card precedent**: card sends `expiry` — a declared secret — as a
  plain string. That is a pre-existing inconsistency, not a precedent to extend to
  ten more fields; a street address, phone and email are at least as sensitive as
  an expiry date, and the mission's constraint is that the held record "lives
  longer, so the zeroization … rules matter more, not less."
- **Why one buffer, not ten**: one choke point, one zeroize, one thing to get
  right. The guest side already holds these as JS strings (the isolated world's
  provenance map); the discipline being protected is MAIN-side retention.

**LD3 — `anchorRole` crosses the isolated-world boundary in the snapshot.**
Leg 3 stamped `entry.anchorRole` on the detected entry
(`vault-identity-fields.js:541`) but the observer snapshots only the eleven role
keys (`vault-entry-observer.js:234`), so it never reaches the snapshot — despite
the detector's own comment (`:537-538`) saying the gate reads it. Reading it from
the MAIN-world entry instead would create a TOCTOU between two independent
enumerations. The observer's identity snapshot entry therefore carries
`anchorRole` (a plain role-name string — safe to cross, DD3g). The gate then
reads anchor role AND values from ONE isolated-world enumeration.

**LD4 — No `fullName` composition. Ruling on the flight's deferred question.**
`fullName` is never synthesized from `firstName` + `lastName`. Two reasons:
1. DD1's founding principle is "nothing inferred from shape, position or value".
   Composition is inference.
2. It would manufacture spurious conflicts. `classifyCapture` compares
   byte-exact: a stored `fullName` of "Jane Q. Doe" (from a single-field form)
   against a composed "Jane Doe" (from a later split-name form) is a CONFLICT —
   an "update your details?" offer for a value the operator never typed on that
   form, proposing to overwrite their real name with a lesser synthetic one.
**Named residual, carried from Flight 2 and now final**: a profile saved only
from split-name forms has no `fullName`, so its picker row shows its `title`
alone. A fresh identity save sets `title` to the fixed non-secret default
`"My details"` — one profile per vault needs no disambiguation.

**LD5 — DD12's seam grant is NOT used.** `vault-capture` has had no audit hook at
all since M12 (verified in Leg 2: "No `openVaultCaptureOverlayForAudit` hook
exists"). Adding the first one is an accessibility-coverage improvement unrelated
to identity, and would pull this leg into `renderer.js`. The identity sheet modes
are covered by the HAT. `SEAM_COUNT` stays 41.

**LD6 — Which profile a capture is classified against.** Following the
login/card precedent (jar match preferred over global): if the tab's jar vault
holds an identity profile, classify against it; else the global vault's; else it
is a fresh save offering `[jarId, 'global']`. Every read goes through
`identityProfileOf(items)`; if its `extra` is non-empty for the chosen vault (the
one-profile invariant violated), **refuse the offer** and `vaultTrace` it — never
silently pick one.

**LD7 — `dropCapture` zeroizes every Buffer on the record, not a named list.
⚠ Added at design review (HIGH, SECURITY) — the fifth enumeration miss of this
flight, and the most dangerous.** LD2's first draft said the identity buffer is
"zeroized by the existing `dropCapture` choke point." Verified false:
`dropCapture` IS the choke point every drop passes through, but its zeroize step
walks a NAMED LIST —

```js
// vault-human.js:182-186
// A new secret field MUST be added here or it outlives the record.
for (const field of ['password', 'number', 'cvv']) {
```

— so a new `rec.identitySecrets` Buffer would never be zeroized. Held PII would
have outlived every lock, tab close, window close, dismiss and TTL. The first
draft conflated "every drop goes through it" with "it zeroizes everything on the
record" — the identical conflation Leg 2 got away with only because the bulk
drops happen to iterate records rather than fields.

**Retire the defect class; do not add one more name.** The code's own comment
says a new secret field *must* be added by hand — exactly the pattern Flight 2's
debrief recommended retiring structurally rather than policing with ever-better
checklists. `dropCapture` instead zeroizes **every own Buffer-valued field** on
the record (`Buffer.isBuffer(value)` over `Object.values(rec)`). This is safe and
strictly a superset: every Buffer on a capture record is secret by construction
(non-secret fields are strings), so today's set — `password`, `number`, `cvv` —
is exactly what it zeroizes now, plus `identitySecrets`, plus any future secret
field with no edit required. It introduces no new aliasing risk: those three were
already zeroized, and `captureRelease` already copies before dropping precisely
because of it. The obsolete "MUST be added here" comment is replaced with one
stating the new invariant.

**LD8 — An identity `update` writes EXACTLY the fields the offer named, and
nothing else.** Design review (MEDIUM, data loss): the card/login merge is a
spread of a fixed field set, safe because those records always carry a value for
every relevant field. Identity does not — a checkout captures only the fields it
happens to ask for. A literal `{ ...existing, ...captured }` where absent fields
decode to `null`/`''` would **silently blank previously-saved fields** the current
form never asked about. So the write set is **derived from `classifyCapture`'s own
output**: exactly `gapFilled[].field` ∪ `conflicting[].field`, which by
construction contains only fields PRESENT in the capture. The field-name lists are
stored on the held record at dispose time; `captureSave` decodes
`identitySecrets` transiently and writes `captured[field]` for those fields only,
over the existing item. The operator approves precisely the fields DD6 named on
the sheet, and the save writes precisely those — the offer and the write cannot
disagree.

**LD9 — The refusal is the safety property; tracing is an optional diagnostic.**
Design review (MEDIUM): LD6 said "refuse the offer and `vaultTrace` it", but
`vaultTrace` is a closure inside `register-browser-ipc.js`'s factory and does not
exist in `vault-human.js`, which is Electron-free by design. `VaultHumanDeps`
gains an OPTIONAL injected `trace(event, detail)` with a no-op default — the house
injected-deps pattern (`setTimeout`, `now`). `main.js` wires it behind the same
`GOLDFINCH_VAULT_TRACE` gate, using the same `[vault-capture]`-style prefix as
`register-browser-ipc.js`'s own `vaultTrace` so one debugging session reads as one
coherent stream rather than two differently-labelled ones. The duplicate-profile REFUSAL is unit-pinned
independently of whether `trace` is wired, and `detail` carries vault ids and
counts only — never a field value.

## Acceptance Criteria

**LD1 — fail-closed three-way dispatch**

- [x] **AC1 — `familyOf` is three-way and fail-closed, and exported**: absent
      `kind` → `'login'`, `'card'` → `'card'`, `'identity'` → `'identity'`,
      anything else (including `'constructor'`, `''`, `null`) → `null`. Pinned for
      every outcome.
- [x] **AC2 — `dispatchByFamily` is the ONLY main-side family dispatch, and it
      fails closed.** Exported and pinned directly with plain objects: a
      `{ kind: 'bogus' }` record invokes NO handler and returns `FAMILY_REFUSED`;
      each known family invokes exactly its own handler.
- [x] **AC2b — Each call site's refusal mapping is pinned** (LD1): a refused record
      is dropped AND zeroized at every site, and `captureRelease` omits it,
      `captureFinalize` returns `{ reason: 'expired' }`, `captureSave` returns
      `{ saved: false }`. Driven by placing a `{ kind: 'bogus' }` record into the
      `captures` Map through a test seam, or by exercising the exported helper with
      the site's own handlers — whichever the implementer can reach without
      exporting mutable internal state; report which.
      `captureRelease`, `captureFinalize` and `captureSave` each route through it.
      Grep-AC: after this leg, `grep -n "rec.kind === 'card'" src/main/vault/vault-human.js`
      returns nothing — no binary dispatch survives.
- [x] **AC3 — The hard-zero pin.** A held identity record saved through
      `captureSave` writes an item of `type: 'identity'` and NEVER `type: 'login'`.
      **Neuter-verify**: temporarily restore the binary `rec.kind === 'card' ? … :
      <login>` at `captureSave`, confirm the test goes RED because a login item
      was written, restore. Record the RED output.
- [x] **AC4 — DD1 holds for three families.** An identity hold, a login hold and a
      card hold coexist on one tab; a second identity gesture evicts only the
      identity record; `captureRelease` returns all three offers. Pinned.

**Gesture + gate**

- [x] **AC5 — `resolveGestureTarget` gains the identity arm**, checked LAST (DD5:
      login, then card, then identity), taking `{ logins, cards, identities }` and
      reusing `resolveOrdinalInFamily` with `IDENTITY_ROLES` — no new resolver.
- [x] **AC6 — DD2's value-layer gate.** `snapshotHasProvenancedSecret(snap,
      'identity')` is true iff the snapshot's `anchorRole` names a role whose field
      is provenanced (`value != null`) AND at least one `NON_POSTAL_ROLES` field is
      provenanced. `secretRoleForKind` no longer drives the identity case. Pinned:
      anchor-only → false; non-postal-only → false; both → true; a missing or
      unrecognised `anchorRole` → false (fails closed).
- [x] **AC7 — LD3: the observer carries `anchorRole`.** Its identity snapshot entry
      includes `anchorRole`; the "carries no policy" source-scan pin still passes.
      `npm run build:preload` regenerated; the bundle test passes.
- [x] **AC8 — The guest sends an identity capture.** `webview-preload.js`'s gesture
      handler detects identities alongside logins and cards, resolves via AC5, and
      on an identity target sends `guest-vault-capture-identity` carrying LD2's
      single `Uint8Array` of secret fields plus `fullName` as a string — then arms
      the per-family detach watch with kind `'identity'` (Leg 2's module). The
      three-way dispatch at `:580`/`:590`/`:595` is explicit (LD1).

**Hold, release, dispose, save**

- [x] **AC8b — `captureIdentity`, the identity analog of `capture` / `captureCard`**
      (named explicitly at design review round 2 — it was only implied). Same shape
      as its twins: gate (set up, persistent jar, origin), family-scoped
      supersession, create the record, then dispose immediately if the vault is
      unlocked or hold with `mode: 'locked'` if not. `captureRelease`'s identity
      branch and nothing else calls it (the twins' own call graph, verified at
      Leg 2 design review).
- [x] **AC9 — `holdGestureIdentity`** in `vault-human.js`: same gate as its twins
      (set up, persistent jar, origin), family-scoped supersession, stamps
      `kind: 'identity'`, holds ONE `Buffer` (LD2) copied then the incoming array
      zeroized, `mode: 'pending-settle'`, the same `CAPTURE_DROP_MS` timer.
- [x] **AC10 — `register-browser-ipc.js` gains the `guest-vault-capture-identity`
      handler** — `wcId` from `event.sender.id`, origin derived and frozen
      main-side, never guest-supplied; holds, never offers.
- [x] **AC11 — `dropCapture` zeroizes every Buffer on the record (LD7).** Pinned:
      (a) `password`, `number` and `cvv` are still zeroized — today's behaviour, now
      as a subset; (b) `identitySecrets` is zeroized after a drop by lock, tab close,
      window close, dismiss and TTL; (c) **the canary that proves the class is
      retired**: a record carrying an arbitrary, never-before-seen Buffer field is
      zeroized too, with no edit to `dropCapture`. **Neuter-verify (c)**: restore
      the named list, confirm the canary goes RED, restore LD7.
- [x] **AC12 — `captureRelease`'s identity branch** copies the Buffer BEFORE
      `dropCapture` (the aliasing hazard Leg 2 preserved) and disposes it.
- [x] **AC13 — `disposeIdentityCapture` wires `classifyCapture` — the flight's
      HARD-ZERO criterion (DD10).** Decodes the Buffer transiently, reads the
      profile via `identityProfileOf` per LD6, calls `classifyCapture(stored,
      captured)`, and maps: `match` → no offer (record dropped); `gap-fill` → an
      offer; `conflict` → an offer; a fresh vault (no profile) → a save offer.
      **The model carries field LABELS only** (DD6):
      `{ kind:'identity', origin, mode, addedFields: string[],
      changedFields: string[], defaultVaultId, choices }`.
- [x] **AC14 — DD6 pinned with a value-bearing probe.** Capture a profile whose
      every field holds a distinctive sentinel string; assert NONE of those
      sentinels appears anywhere in the serialized offer model — not in
      `addedFields`, not in `changedFields`, not in any other key. A regex over
      `JSON.stringify(model)` for each sentinel. (Asserting only that expected
      keys are present would pass a model that ALSO carried values.)
- [x] **AC15 — `captureFinalize`'s identity branch** (the locked-vault path) runs
      the same disposition after unlock, with Leg 2's queues carrying the offer.
- [x] **AC16 — `captureSave`'s identity branch**: a `save` writes a new
      `type: 'identity'` item titled `"My details"` (LD4); an `update` writes
      EXACTLY `gapFilled` ∪ `conflicting` fields over the existing item (LD8) —
      every other field carried forward untouched. The store's
      one-profile-per-vault refusal (`_saveItem`) is respected, never bypassed;
      verified at design review that an `update` to the existing profile's own id
      passes it, and a racing `save` surfaces as a `VaultStateError` through the
      existing generic "Couldn't save" chain.
- [x] **AC16b — LD8's data-loss pin.** A stored profile holding `phone`; a capture
      from a form with NO phone field; the update is accepted — `phone` must still
      hold its stored value afterwards. **Neuter-verify**: swap in a naive
      `{ ...existing, ...captured }` merge, confirm `phone` is blanked and the test
      goes RED, restore.
- [x] **AC16c — LD9: the duplicate-profile refusal.** A vault whose items contain
      TWO identity profiles: no offer is raised; the injected `trace` (when present)
      receives an event carrying no field value; with `trace` absent, the refusal
      still happens.

**Sheet**

- [x] **AC17 — The capture template's `KIND_TABLE` gains `identity`**, with
      MODE-dispatch within the family on top of Leg 1's type-dispatch: fresh save
      → "Save your details?"; gap-fill → "Add to your saved details?"; conflict →
      "Update your saved details?". The subject row lists the field LABELS from
      `addedFields` / `changedFields` (a conflict names both groups); a save offers
      the vault choice; an update does not. Text via `textContent` only.
- [x] **AC18 — The capture card's `aria-label`** is derived per mode exactly as
      today (`heading.slice(0, -1)`), so each identity mode is announced by its own
      heading.

**Corpus + backstop**

- [x] **AC19 — `billing-jostens` is promoted**, `tier` and `assert` updated
      TOGETHER. Its submit button sits INSIDE `<form id="billing-address">`
      (verified), so native submission is a real headless settle signal and it
      earns **`offers`** — decided by reading the fixture, per DD4.
      `test/helpers/save-moment-assertions.js`'s `assertCapturesEntry` /
      `assertOffersEntry` gain identity support (the `assertDetectsEntry`
      identity branch is the precedent).
- [x] **AC20 — `incident-report-third-party` is NOT promoted to `captures`.**
      It is Flight 2's named ACCEPTED false positive; asserting that it captures
      would gate a known false positive as desired behaviour. Instead, a
      `classifyCapture`-level test proves the BACKSTOP: with an existing profile,
      its captured values classify as `conflict`; on a fresh vault they classify as
      `gap-fill` — DD10's named residual, pinned as a residual rather than
      discovered later.
- [x] **AC21 — The negative set still produces ZERO offers**, including every
      identity negative fixture. The standing canary still inverts and throws.

**Gates**

- [x] **AC22 — Automation still login-only** — Leg 3's AC21 pin still passes.
- [x] **AC23 — Gates clean**: `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`. `renderer.js` still 1550 and `SEAM_COUNT` still 41
      (LD5).

## Verification Steps

- AC1-AC4, AC9, AC11-AC16: unit tests in `vault-gesture-capture.test.js` (or a new
  `vault-identity-capture.test.js`, mirroring `vault-card-capture.test.js`), with
  AC3's neuter-verification RED output recorded in the flight log.
- AC5-AC6: `vault-gesture-policy.test.js`.
- AC7: `vault-entry-observer.test.js`, then `npm run build:preload` and the bundle test.
- AC8, AC10: `register-browser-ipc.test.js`; the preload wiring by source reading
  (it cannot be required under `node --test`) — say so precisely in the log.
- AC14: the sentinel probe.
- AC17-AC18: `vault-capture-template.test.js`.
- AC19-AC21: the corpus suite.
- **Live acceptance is the HAT's**: a real billing form raising a real offer, the
  card + identity double offer queueing two sheets, and a conflict offer's copy.

## Implementation Guidance

1. **LD1 FIRST, before any identity code exists.** Make `familyOf` and every
   dispatch site three-way and fail-closed while identity records still cannot be
   created — the suite must stay green through that step alone. Then build
   identity on top of it. This is the order that makes AC3's hard-zero cheap to
   prove.
2. **Enumerate by shape before editing each file.** `grep -n "familyOf\|kind ===\|type ===\|=== 'card'\|=== 'login'"`
   — the table above is the Flight Director's enumeration; confirm it rather than
   trusting it, and report any site it misses.
3. **Search before you build.** `resolveOrdinalInFamily`, `identityProfileOf`,
   `classifyCapture`, `IDENTITY_ROLES`, `NON_POSTAL_ROLES` and Leg 2's detach-watch
   module all exist. Reuse; write no parallel helper.
3b. **LD7 before anything creates `identitySecrets`.** Land the zeroize-every-Buffer
   change with its canary while no identity record can exist yet — same principle
   as LD1: prove the choke point safe on its own first.
3c. **The test helper has binary sites too.**
   `test/helpers/save-moment-assertions.js`'s `resolveCaptureWorthyGesture` and
   `buildProvenancedObserver` (~`:189-272`) carry their own
   `(resolved.kind === 'card' ? snapshot.cards : snapshot.logins)` dispatch and
   login/card-only provenance loops. AC19 depends on them gaining the identity arm;
   the Central Danger table is scoped to `src/` and does not list them.
3d. **`vault-entry-observer.js` is at 415-416 of its 425-line `OBSERVER_LINE_BUDGET`**
   (`test/unit/vault-entry-observer.test.js:771`; the two design-review rounds
   measured one line apart). LD3's `anchorRole` should fit in the ~10 lines of
   headroom; if it does not, extract — never compact (house
   rule).
4. **Regenerate the observer bundle after LD3's change.**

## Edge Cases

- **A checkout with card AND identity in one form** (the flight's headline case):
  one gesture must hold BOTH (Leg 2's multi-hold), and settle must raise BOTH offers
  in sequence.
- **A locked vault at settle**: every record returns `mode: 'locked'`; Leg 2's
  locked queue carries the identity record through unlock to AC15's disposition.
- **An identity capture whose every field matches** the stored profile: `match`,
  no offer, record dropped and zeroized.
- **A capture whose values are ALL empty strings**: DD2's gate refuses it before a
  hold is ever created.
- **Two profiles in one vault** (the invariant violated by a hand-edited file):
  LD6 refuses and traces.

## Files Affected

- `src/main/vault/vault-human.js` — `familyOf` + `dispatchByFamily` (exported,
  LD1), LD7's `dropCapture`, `holdGestureIdentity`, `disposeIdentityCapture`,
  identity branches, the optional `trace` dep (LD9)
- `src/main/main.js` — wires the optional `trace` dep (LD9)
- `src/main/register-browser-ipc.js` — the identity capture handler
- `src/preload/vault-gesture-policy.js` — identity arm, the value-layer gate
- `src/preload/vault-entry-observer.js` — `anchorRole` in the snapshot (LD3)
- `src/preload/webview-preload.js` — three-way gesture dispatch, identity send
- `src/shared/vault-capture-template.js` — identity `KIND_TABLE` entry + modes
- `test/fixtures/save-moment/manifest.js`, `test/helpers/save-moment-assertions.js`
  (its own binary sites — Guidance 3c)
- tests for each; `missions/.../flight-log.md`

## Citation Audit

Re-probed 2026-09-20, branch `flight/03-identity-fill-and-capture` (Legs 1-3
landed, uncommitted), **by shape** — `grep -n "familyOf\|kind === 'card'\|kind: 'card'\|type === 'card'\|=== 'login'"`
across the capture path:

- `familyOf` binary at `vault-human.js:84-85`; family-scoped supersession at
  `:479`, `:560`, `:615`, `:843`; binary dispatch at `:684`, `:920`, `:969`.
  **Confirmed.**
- `webview-preload.js` binary gesture dispatch at `:580`, `:590`, `:595`;
  `armGestureDetachWatch(kind, fields)` at `:549`. **Confirmed.**
- `vault-gesture-policy.js`: `resolveGestureTarget` login + card only (`:145-150`);
  `secretRoleForKind` binary (`:154-155`); `snapshotHasProvenancedSecret` (`:171`).
  **Confirmed.**
- LD3's gap: `entry.anchorRole` set at `vault-identity-fields.js:541`; observer
  snapshots via `snapshotEntry(entry, IDENTITY_ROLES)` at
  `vault-entry-observer.js:234` — `anchorRole` not among the keys. **Confirmed.**
- `billing-jostens.html`: `<form id="billing-address">` at `:16`, `<button
  type="submit">` at `:33`, `</form>` at `:34` — submit INSIDE the form.
  **Confirmed.**
- `save-moment-assertions.js`: `assertDetectsEntry` supports `identity` (`:154-164`);
  captures/offers do not yet. **Confirmed.**
- Search-before-build (Leg 3's lesson): every helper named in Guidance 3 exists.
  **Confirmed by grep.**
- **Added at design review**: `dropCapture` zeroizes a NAMED list,
  `['password', 'number', 'cvv']` at `vault-human.js:183`, under a comment reading
  "A new secret field MUST be added here or it outlives the record." The first
  draft's LD2 claimed the new buffer was covered automatically — false. This is
  the fifth enumeration miss of the flight: a claim about what a mechanism COVERS,
  made without reading how it discovers what to cover. Closed structurally by LD7.
- `module.exports = { createVaultHuman, originOf }` at `vault-human.js:1168` —
  `familyOf` was private, so the first draft's AC2 had no construction path.
  **Confirmed**; closed by LD1's exported helper.
- `vaultTrace` occurrences in `vault-human.js`: **0**. **Confirmed**; LD9.
- `OBSERVER_LINE_BUDGET = 425`, observer at 416. **Confirmed.**

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — flight-end review and commit follow this leg
