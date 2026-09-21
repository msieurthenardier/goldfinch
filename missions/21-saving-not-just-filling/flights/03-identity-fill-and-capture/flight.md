# Flight: Identity Fill and Capture

**Status**: in-flight
**Mission**: [Saving, Not Just Filling](../../mission.md)

> **Scope note — why this is not split, stated deliberately.** Flight 2's debrief
> recommends counting a flight's *unproven adversarial axes* at drafting and
> applying the same split scrutiny Flight 2 got. Counted honestly, this flight
> carries **seven** (six at drafting, plus the locked-vault pending-unlock queue
> that design review surfaced): the multi-hold re-key, identity's value-layer
> admission gate, card-vs-identity precedence, the identity capture-sheet mode,
> the already-unlocked offer queue, the locked-mode unlock-to-save queue, and the
> ordinal fill fix. That is more than Flight 2 had. It is
> nevertheless ONE decision cluster — *what an identity does on a live page* —
> and the mission's own criterion ("saved from a checkout form **and** filled
> into a later one") straddles fill and capture, so a fill/capture flight split
> would leave neither flight able to claim a mission criterion. **The mitigation
> is the leg split, not a flight split**: the two no-new-behavior mechanism legs
> (extraction, multi-hold) land green against TODAY's login/card behaviour before
> identity depends on either, and each leg below carries its own stated axes
> count. Operator-confirmed at planning.

## Contributing to Criteria

- [ ] A name, address, email and phone can be saved from a checkout form and
      filled into a later one, scoped per jar like every other vault item.
- [ ] Identity capture is gated by a stated plausibility rule, so that the family
      with no structural anchor cannot write an arbitrary form value into the
      vault — the same protection Luhn already gives cards.
- [ ] A password or a payment card entered in a flow that never fires a form
      submit is still offered for saving — for every shape in the corpus's gated
      set *(this flight adds the identity family's shapes to that set)*.
- [ ] The offer is raised when the entry has demonstrably gone somewhere, not at
      the instant of the gesture.
- [ ] No save offer can be raised without a genuine operator gesture.
- [ ] Zero offers on the corpus's entire negative set.
- [ ] The exclusions that bound the existing capture path still hold for every new
      path: no offers from burner or internal tabs, none from subframes, and no
      secret reaches a page DOM or crosses a channel outside the existing
      zeroized-buffer discipline.

---

## Pre-Flight

### Objective

Wire Flight 2's identity foundations into the live page: detection into the
isolated world, fill out of the vault, capture back into it, and the three-way
sheet work all of that needs — while closing the two live debts Flight 1 and
Flight 2 handed forward (the fill-precision regression, and `classifyCapture`
having no caller).

### Design Decisions

**DD1 — One pending capture per `(wcId, family)`, released as a LIST; the chrome
queues the offers.** *(Operator ruling. Supersedes the one-hold-per-tab rule
Flight 1 shipped.)*
- **The problem, verified at planning rather than assumed.** A checkout carries
  card fields AND billing identity fields. `holdGestureLogin` /
  `holdGestureCard` / `capture` each evict **every** record for the wcId before
  storing (`vault-human.js:509-511`, `:562-564`, `:430-432` — predicate
  `rec.wcId === wcId`, family-blind; the first two citations were off by a few
  lines in the draft and were re-probed at design review round 2 — Leg 2
  resolves them by grepping the predicate, never by line number), `resolveGestureTarget` returns exactly one
  `{kind, ordinal}`, and `captureRelease(wcId)` returns the **first**
  pending-settle record it finds. So today one gesture yields one offer, and on
  the mission's own motivating page the card would win and the billing identity
  would never be offered at all.
- **The change is narrow, and the drop rules need NO new wiring.** Probed: all
  three bulk-drop functions (`dropCapturesForTab` `:1024`,
  `dropCapturesForWindow` `:1046`, `dropAllCaptures` `:1064`) already key on
  `wcId` alone and are family-blind, so they cover a second concurrent record for
  free — the same argument Flight 1 made for `mode: 'pending-settle'` riding the
  existing `captures` Map and `dropCapture` choke point. What changes:
  1. the **four** supersession predicates gain a family term (`rec.wcId === wcId &&
     familyOf(rec) === familyOf(incoming)`), so a card hold no longer evicts an
     identity hold — and, critically, so `captureRelease`'s own call into
     `capture`/`captureCard` (which re-runs that eviction) cannot evict the
     sibling record it is midway through releasing. **AMENDED at Leg 2 design
     review: FOUR, not three.** This DD's first draft named three
     (`:430-432`, `:509-511`, `:562-564`); a fourth lives inside `captureCard`
     itself (`:765-767`) and binds its loop variable as `prior` rather than
     `rec`, which is how a `rec.wcId`-shaped grep missed it. Since
     `capture`/`captureCard` have no callers in `src/` outside `captureRelease`,
     leaving that one family-blind would have defeated the entire change — every
     card release would zeroize the sibling login offer in the same synchronous
     pass;
  2. `captureRelease(wcId)` releases **every** pending-settle record for the tab
     and returns an **array** (`[]` for the common nothing-pending case);
  3. both settle call sites (`guest-wiring.js:739` navigation-commit,
     `register-browser-ipc.js:231` detachment) iterate that array;
  4. the chrome (`vault-controller.js:303`) **queues** offers and presents them
     one sheet at a time.
- **Why the queue is chrome-side, not main-side**: the chrome already owns the
  sheet-close lifecycle and the `vault-capture-dismiss` invoke that drops a
  declined record. A main-side queue would need a new "send me the next offer"
  channel and would have to model sheet state main-side — the inverse of the
  established ownership split. Main stays stateless about presentation and simply
  pushes N `vault-capture-offer` messages.
- **⚠ AMENDMENT (design review, HIGH) — the LOCKED-vault continuation is a
  SECOND queue, and a scalar there silently drops an offer.** Verified live:
  `capture()`/`captureCard()` check `store.isUnlocked()` — a single GLOBAL flag
  (`vault-human.js:460`), not per-family — so when the vault is locked at settle
  time, **every** record released by one multi-hold `captureRelease` pass returns
  `mode: 'locked'` in the same synchronous call. Chrome-side,
  `vault-controller.js`'s `onVaultCaptureOffer` (`:303-322`) branches on
  `model.mode === 'locked'` and overwrites the **module-scope scalars**
  `pendingCaptureId` / `pendingCaptureUnlock` (`:66-70`) with whichever offer
  arrived last; `onVaultLockState` (`:344-360`) then reads
  `pendingCaptureUnlock` **once** and finalizes exactly one captureId. The other
  record — a card or billing address the operator really typed — is never
  finalized, never shown, and zeroized by `CAPTURE_DROP_MS` two minutes later
  with no toast and no error. That is precisely the silent-no-op class
  `reportNoCaptureOffer` was added to eliminate, and it fires on this flight's
  own headline scenario (locked vault + card/identity double offer).
  **Therefore the queue is TWO queues, not one**: an already-unlocked offer
  queue feeding `openCaptureSheet`, and a locked-mode pending-unlock **array**
  that a single successful unlock drains **serially** — each `vaultCaptureFinalize`
  resolving before the next sheet opens, each failure routed through the existing
  `reportNoCaptureOffer` rather than aborting the drain. An abandoned unlock
  drops **every** queued record, not just the last.
- **The unlock prompt opens ONCE per drain, not once per offer** (design review
  round 2). `onVaultCaptureOffer`'s locked branch today calls
  `openOverlayMenu('vault-unlock', …, { keepFocus: true })` unconditionally;
  with N locked offers arriving as N separate IPC pushes, subsequent captureIds
  push onto the array WITHOUT re-opening. Re-opening would model-replace the
  same menuType repeatedly and burn `KEEP_FOCUS_MAX`'s capped re-grab budget for
  no reason.
- **Presentation is TRULY SERIAL, never a model-replace.** Offer B does not open
  until offer A's sheet genuinely closes and fires its close event. Rationale:
  `handleClosed`'s existing `reason !== 'superseded'` carve-out
  (`vault-controller.js:640`) was written for a SAME-family repeat submit, where
  the superseding model belongs to the same record; a cross-family model-replace
  would silently skip A's dismiss-drop and leave A's record held with no sheet.
  Serial presentation needs no new close logic at all.
- **Trade-offs, named** (three):
  1. A page that gestures repeatedly can now hold up to one record per family
     per tab instead of one per tab. `CAPTURE_DROP_MS`, the three bulk drops and
     the lock/tab-close/window-close rules all still apply per record, so the
     bound grows by a constant factor, not unboundedly.
  2. `CAPTURE_DROP_MS` starts at **release** time, not display time, so a queued
     second offer's decision window is shortened by however long the operator
     spent on the first. The expiry path is already graceful (the generic
     couldn't-save message), so this is a stated cost, not a defect.
  3. Serial presentation means a second offer appears only after the first is
     resolved — the operator sees two sheets in sequence, not one combined card.
     The combined-card option was considered and declined at planning.
- **Ordering of a queued pair is deterministic and stated**: release order
  follows `captures` Map insertion order (the gesture order), and the chrome
  presents in the order received. No re-ranking.

**DD2 — Identity's value-layer admission gate MIRRORS LD2's detection gate.**
*(Operator ruling.)*
- `snapshotHasProvenancedSecret(entrySnapshot, kind)`
  (`vault-gesture-policy.js:~165`) today gates on exactly one secret-bearing role
  per family (`password` / `number`). Identity has eleven roles and no
  anchor-of-value.
- **The rule**: an identity entry is worth holding only when **the scope's postal
  ANCHOR field carries provenance** AND **at least one non-postal role**
  (`fullName`/`firstName`/`lastName`/`email`/`phone`) carries provenance. Same
  shape, at the value layer, as Flight 2's LD2 scope anchor at the detection
  layer.
- Rationale: it gives identity ONE rule to reason about across both layers
  instead of two unrelated ones, it makes a half-typed form hold nothing, and it
  is the closest structural analogue to card's Luhn gate the family can have. A
  threshold count (`N` provenanced fields) was rejected as an unprincipled
  constant; "any single provenanced field" was rejected as spending the whole
  wrong-moment budget at the value layer.
- **Consequence for the snapshot shape**: `findAllIdentityFields` returns an
  `anchor` node on every entry already (`vault-identity-fields.js`'s
  `entryFromResolved`), so the observer can snapshot the anchor's own state
  without a new detection concept. The `anchor` field is a DUPLICATE reference to
  one of the eleven role fields — the snapshot must therefore report the
  anchor's **role name**, not a twelfth pseudo-role, or the gate would be
  checking a field twice under two names.
- **How the role name is obtained is pinned, not left open** (design review):
  propagate it AT THE SOURCE. `identityEntryForScope` already holds
  `anchorCandidate.role` in scope at the exact line it calls `entryFromResolved`
  — the entry gains an `anchorRole` string there. The observer must never
  reverse-map a node reference back to a role name, which would be a second,
  driftable derivation of something the detector already knew.

**DD3 — The extraction is its own first leg.** *(Operator ruling; Flight 2
debrief recommendation 3.)*
- Probed at planning: `renderer.js` measures **1577** lines by
  `seam-contract.test.js`'s own metric (`split(/\r?\n/).length`) against a
  **1577** budget — **zero slack**, not the "one line" the Flight 2 debrief
  recorded (that figure came from `wc -l`, which is one lower on a
  newline-terminated file). Any renderer line lands the suite red.
- Probed, and **corrected at design review** (the first draft said 13 and
  miscited two lines): **12** binary family branch sites —
  `vault-capture-template.js` 4 (`:124,127,132,133`) and
  `vault-picker-template.js` 8 (`:120` `type === 'card'`, `:312` `type !== 'card'`,
  `:313` `type === 'card'`, `:318,319,324,336,352` `isCard`). Line `:303` is a
  **copy string** ("No saved logins or cards to fill here"), not a branch — but it
  is three-way copy and Leg 1 owns it, so it is counted separately as **1 copy
  site**. Each of the 12 becomes three-way.
- **Two different headrooms, and the flight had been conflating them** (design
  review). The 12 branch sites live in `src/shared/vault-*-template.js`, which has
  **no line budget** — rewriting them buys *template* clarity for the third
  family, not `renderer.js` lines.
- **What actually needs renderer lines is small and nameable**: at most an
  identity capture-sheet audit-hook entry in the `vaultController` destructure
  (`renderer.js:437-446`) plus its seam-tail entry — roughly **2 lines**, if
  Leg 4 adds a hook (see DD12). Against **zero** slack, 2 lines fails the build.
- **Leg 1 therefore buys a NAMED, NUMERIC floor**: land `renderer.js` at
  **≤1562** by this test's own metric (≥15 lines of headroom against a ~2-line
  need) and LOWER `RENDERER_LINE_BUDGET` to landed size, per the house
  lock-in-headroom discipline.
- **Named candidate**: the `onAuthChallengePresent` / `onCertChallengePresent`
  subscriptions (`renderer.js:1357-1381`, ~25 lines), whose only dependency is
  the already-extracted `openOverlayMenu` — an unusually clean lift.
- **⚠ CORRECTED at design review round 2 — the draft's precedent claim was
  false, and in a way that would have misdirected the implementer.** The draft
  said this is "exactly the class the M15 F2 Leg 1 renderer-extraction already
  moved out for the vault sheets." It is the opposite: that leg **explicitly
  kept these two subscriptions in `renderer.js`**
  (`missions/15-bookmarks/flights/02-jar-scoped-bookmarks/legs/01-renderer-extraction.md:58`
  — "they are the challenge flow (M14), not the vault flow, despite adjacency…
  Scope discipline: vault only"), and `vault-controller.js`'s own header
  (`:16-18`) restates that boundary today. **They must NOT be folded into
  `vault-controller.js`** — that would re-open a boundary drawn on purpose.
- **Destination is therefore named explicitly**: a NEW sibling,
  `src/renderer/chrome/auth-challenge-controller.js`, owning both subscriptions,
  their overlay states, their no-op dispatch cases and their audit hooks — the
  M14 F1 challenge flow kept whole and kept separate from the vault flow. The
  precedent being followed is the *shape* (sheet-raising glue lives in a
  controller, not the composition root), not a prior move of this code.
- An equally-precedented substitute candidate is an acceptable variation; folding
  this code into `vault-controller.js` is not.
- New chrome glue in later legs routes through `vault-controller.js` and
  `menu-overlay.js`, never `renderer.js`. M20 F3 Leg 1 (1806 → 1532 in one leg)
  is the model for the extraction itself.

**DD4 — Acceptance is corpus promotion PLUS an operator HAT leg.** *(Operator
ruling.)*
- The two identity fixtures (`billing-jostens`, `incident-report-third-party`)
  are promoted from `assert: 'detects'` to `'captures'`/`'offers'` per the
  manifest's own promotion discipline — `tier` and `assert` updated **together**,
  per the manifest header's Leg 5/Leg 6 correction.
- **`offers` requires a headlessly-provable settle signal** (native form
  submission) — `billing-jostens` earns whichever of `captures`/`offers` its own
  markup supports, decided by reading the fixture, never by widening the
  assertion to make it pass.
- The HAT leg closes the flight. Flight 1's HAT is what caught the
  "`offers` proves less than its name claims" defect that two review rounds
  missed; Flight 2 shipped nothing page-facing and needed none. This flight ships
  the whole page-facing path.
- **No behavior-test spec is authored.** Premise-audited and rejected on the
  *observability* axis: the key observable is a raised capture offer, which
  renders on the menu-overlay sheet, and the standing unobservable-surfaces list
  refuses every `vault-*` menuType to `readDom`/`readAxTree`/`captureScreenshot`
  at every tier (`AUTOMATABLE_MENU_TYPES` in `automation/resolve.js` admits only
  `bookmarks-overflow`, `bookmark-edit`, `site-info`, `cert-viewer`). An
  apparatus that cannot observe the assertion is not an apparatus. The HAT is the
  operator's own eyes, which is the only instrument that can see this surface.

**DD5 — CARD wins a field contested with identity; LOGIN still wins over both.**
- Flight 2's LD3 settled login-vs-identity with the callable `isClaimedByLogin`.
  Card-vs-identity is a real, reachable contest, not a hypothetical: identity's
  `fullName` alternative is bare `{name}`, and a "Name on Card" field
  (`card_nameOnCard`, squawk 0091's own motivating spelling) normalizes to a
  token set containing `name` — so it matches identity's `fullName` AND card's
  `cardholder`.
- **Card wins**, for LD3's exact reasoning inverted one notch: card's claim is
  anchored on a detected `cc-number` (a resolved anchor, `rolesIn`'s phase 1),
  identity's on a vocabulary judgement. Precedence is therefore
  **login > card > identity**, consistent at detection, at icon placement, and at
  gesture resolution.
- **The callable artifact** is `isClaimedByCard(field, doc)`, built from the
  already-exported `findAllCardFields` exactly as `isClaimedByLogin` is built
  from `findAllLoginFields` — never a reimplementation, and
  `vault-card-fields.js` is not touched. It filters identity's candidate list
  BEFORE role resolution, including as an anchor candidate, mirroring LD3.
- **Its scope is stated, not left to "mirroring"** (design review):
  `isClaimedByLogin` checks ONE role (`entry.username`), because that is login's
  only contestable field. `isClaimedByCard` checks **all six** card roles
  (`number`, `cardholder`, `expiry`, `expMonth`, `expYear`, `csc`) — not just
  `cardholder`. Rationale: `cardholder` is the only contest we can *name* today,
  but a card field claimed by the card detector is a card field whatever
  identity's vocabulary thinks, and enumerating the one known case would leave
  the rule to be re-derived the next time a spelling collides.

**DD6 — The identity capture-sheet model carries field NAMES, never values.**
- DD2 (Flight 2) requires an update offer "naming exactly which fields change".
  Ten of identity's eleven fields are declared **secret** in
  `vault-item-schema.js`'s `SCHEMA.identity` — only `title` and `fullName` are
  not. Rendering a from/to value pair would put a street address, phone number or
  email into the sheet model.
- The existing capture sheet is **metadata only** by design (its own header:
  "the captured password NEVER reaches the sheet"). That invariant is preserved
  unchanged: the identity offer model carries `{ kind: 'identity', origin, mode,
  changedFields: string[], addedFields: string[], defaultVaultId, choices }` —
  human-readable field LABELS, no values, on either side of a conflict.
- Copy therefore reads "Street address, postcode and phone differ from your saved
  details" rather than showing them. This satisfies DD2's "naming exactly which
  fields change" on the reading that matters (the operator knows what is at
  stake) without widening what the sheet holds.
- `classifyCapture`'s returned `gapFilled[].to` / `conflicting[].from`/`.to`
  **values are consumed main-side only** and never placed on the model.

**DD7 — Identity fill is NOT origin-gated; automation stays login-only.**
- Card precedent, same argument: a person's own name and address belong to the
  operator, not to a site. `reachableIdentityItems(jarId)` takes no origin, exactly
  as `reachableCardItems(jarId)` does (`vault-store.js:3514`). Every OTHER gate is
  unchanged — unlocked, persistent jar, jar+global scope, top-frame, explicit
  picker selection — and `fillHuman`'s branch is chosen by the **stored item's own
  `type`** (`vault-human.js:268`), never by anything the guest or chrome sends.
- **Automation needs no code change to stay login-only**: `vault-context.js`
  already filters `item.type !== 'login'` at every resolution site (`:357`,
  `:493`, `:549`), so identity inherits card's exclusion structurally. An AC pins
  that it stayed true.

**DD8 — Identity gets a third in-field icon kind, placed on TWO fields.**
- Without one there is no trigger for an identity fill at all on a form carrying
  no password and no card (a plain shipping-address form) — `reachableItems`
  feeds ONE unified picker, but the picker is opened by clicking an injected
  icon, and no icon means no route.
- **⚠ CORRECTED at design review — the first draft mischaracterized card.**
  Card does NOT anchor its icon on `number`. `cardAnchorsOf(entry)`
  (`vault-fill-icon.js:106-109`) places an icon on **four** fields — `number`,
  `cardholder`, `expiry`, `csc` — and its own comment says it is "mirroring the
  login path's both-fields placement". What resolves to `number` is the FILL
  TARGET (`resolveTargetForAnchor`), a different concept. Icon *placement* and
  fill-target *resolution* are not the same axis, and the draft conflated them.
- **The decision, made explicitly rather than by bad analogy**: identity places
  **two** icons — the scope's postal **anchor** field, and the **first
  non-postal role field in document order**. Rationale: these are exactly the two
  fields DD2's value-layer gate already names, so one rule serves three purposes
  (admission, placement, and the operator's mental model of what Goldfinch
  thinks this form is). It answers the real UX objection design review raised —
  on a billing form where name/email/phone precede the street address, an
  anchor-only placement would leave the operator with no affordance until they
  reached the street field.
- **Rejected, and why**: placing on all eleven role fields (the literal
  generalization of card's four) is visual noise on a form that routinely has
  more identity fields than a card has card fields; placing on the anchor alone
  is the affordance gap above.
- **The modification sites are enumerated, because one of them decides whether
  an identity icon renders AT ALL** (design review round 2 — the draft omitted
  it). `placeVaultIcons` only ever shows the icon for `focusedField`; eligibility
  and kind are decided by **`anchorKinds()`** (`vault-fill-icon.js:390-403`),
  which carries its OWN inline two-family precedence walk (login unconditional
  first, card second behind `if (!kinds.has(field))`) — a second, independent
  precedence mechanism, not derived from `isClaimedByLogin`/`isClaimedByCard`.
  It needs a **third walk, identity last, behind the same guard**, matching
  DD5's login > card > identity order. Without it the identity icon never
  renders no matter how correct everything downstream is. Sites:
  `anchorKinds()`, `resolveTargetForAnchor` (an identity arm returning the
  entry's `anchor` field as its fill target), `buildVaultLockIcon`'s `kind`
  parameter, and `createIcon`.
- **A field claimed by two families is structurally prevented upstream**, not by
  this walk: DD5's `isClaimedByCard` and LD3's `isClaimedByLogin` filter
  identity's candidate list before role resolution, so identity's fields are
  already disjoint from the other two. The `!kinds.has(field)` guard stays as
  defense in depth, exactly as it is for card today.
- **The second icon anchor needs a propagation path, and this DD decides it —
  the same decision DD2 makes for `anchorRole`** (design review round 2: the
  draft named the field without saying how the icon controller would learn it).
  `identityEntryForScope` already computes exactly this field as
  `nonPostalCandidate` (`vault-identity-fields.js:473`,
  `resolved.find(r => NON_POSTAL_ROLES.has(r.role))` — first in document order by
  construction), but uses it only to gate admission and never exposes it.
  Thread it onto the entry at the SAME call site DD2 already touches, so both
  propagations land together. The icon controller must never re-derive "first
  non-postal field" independently — that is precisely the second, driftable
  derivation DD2 forbids. `buildVaultLockIcon` carries the kind on the **accessible
  name only** — that file's own comment pins "no `data-kind` attribute", because
  the icon's attribute set is a "holds nothing a hostile page can read" guard.
  That pin is not widened.
- **The badge must be rebuilt whole, never mutated in place** (mission
  constraint): `setVaultLocked`'s existing rebuild-and-replace is the pattern,
  and `isIconOnlyMutation` tracks exactly one top-level node per icon.
- **Flight 4 inherits three kinds, not two.** Stated here so the badge redesign
  is not scoped against a stale two-kind assumption.

**DD9 — The fill-precision regression closes here, via an integer ORDINAL.**
- Verified live at planning: `webview-preload.js:441,453` call
  `consumeFillTarget` for its single-use/TTL/kind bookkeeping and **discard** the
  returned node; the bootstrap's `fillLogin`/`fillCard` call
  `fillLoginForm(document, cred)` / `fillCardForm(document, card)` with no target
  argument, so every icon-triggered fill lands on the first detected entry.
  `fillLoginForm`'s `targetPassword` parameter still exists
  (`vault-fill-fields.js:145`) and still works — it simply has no caller.
- The fix is the mechanism the **capture** path already proved: an **integer
  ordinal** crosses the world boundary freely (DD3g forbids node references, not
  integers). The main world resolves the clicked anchor's ordinal with its own
  detection pass — exactly as `onCaptureGesture` does — and passes the integer
  into the isolated world, where the fill resolves
  `findAllLoginFields(doc)[ordinal]` and fills that entry.
- **Two mechanism facts pinned at design review, so Leg 3 does not discover
  them**: (a) `vault-entry-tracker.js`'s `callScript` embeds exactly **one** JSON
  argument per isolated-world call, so the handle methods become
  `fillLogin({ cred, ordinal })` / `fillCard({ card, ordinal })` — a second
  positional argument is not available; (b) the isolated-world bundle is
  **generated** (`vault-entry-observer-bundle.generated.js`, gitignored), so the
  leg must run `npm run build:preload`, not merely edit
  `vault-entry-observer-bootstrap.js`.
- **Ordinal resolution REUSES `resolveOrdinalInFamily`** (`vault-gesture-policy.js:117`,
  exported `:181`) — the capture gesture's existing, tested resolver, whose own
  module header names fill precision as a stated purpose. **⚠ AMENDED at Leg 3
  design review**: this DD first said to write a NEW shared helper in
  `vault-entry-tracker.js`. That would have been a third implementation of an
  existing walk. The planning-time audit enumerated finder CALLERS by shape but
  never searched for an existing IMPLEMENTATION of the capability — the fourth
  enumeration miss of this flight, and the one that sharpens the lesson from
  "search by shape" to "before specifying a helper, search for one that exists".
- **A stale/out-of-range ordinal falls back** to today's first-entry behaviour,
  never throws and never fills a different form on purpose. The mutation-between-
  enumerations misassociation the mission's Known Issues names is NOT closed by
  this and stays a stated residual — this closes the *no precision at all*
  regression, not the race.
- This retires mission Known Issue 3 in its "still live: the gesture's ordinal fix
  reached capture, not fill" form.

**DD10 — Wiring `classifyCapture` into a live caller is a HARD-ZERO acceptance
criterion, not an ordinary feature task.** *(Flight 2 debrief recommendation 4.)*
- Flight 2's acceptance of the `incident-report-third-party` fixture as a named
  false positive rests explicitly on DD2's conflict rule as the backstop. That
  backstop has no caller. Until this flight wires it, the acceptance is a plan.
- **The corrected acceptance language, carried forward verbatim** (Flight 2
  debrief, Key Learning 4): *accepted, with DD2's conflict rule as the backstop
  **once a profile already exists**, and no backstop at all on a fresh vault* —
  because on a first-ever identity capture every field is a gap-fill and the
  conflict rule cannot fire on its own headline scenario.
- **Consequence, and this flight owns it**: a first-ever identity capture gets
  the gap-fill offer and nothing more. That is still an offer and never a silent
  write, so no hard-zero is breached — but the flight must not describe the
  conflict rule as protecting the fresh-profile case, because it does not.
- `identityProfileOf(items)` is the canonical read at every call site — never
  `items.find(it => it.type === 'identity')`, which hides a duplicate instead of
  surfacing it.

**DD11 — Detection lives in the isolated world; no new trust boundary.**
- Inherited verbatim from Flight 1 (DD3f/DD3g/DD3h) and Flight 2 (DD5).
  `findAllIdentityFields` joins `findAllLoginFields`/`findAllCardFields` in
  `vault-entry-observer-bootstrap.js`'s observer construction and in the esbuild
  observer target; `IDENTITY_ROLES` joins `LOGIN_ROLES`/`CARD_ROLES` in
  `vault-entry-observer.js`. No node identity crosses the boundary; provenance is
  value-bound and TTL-bounded exactly as it is for the other two families. No new
  design.

**DD12 — FD ruling, granted in advance: `SEAM_COUNT` may go 41 → 42 for ONE
identity capture-sheet audit hook, and no further.**
- The mission's own Constraints anticipate this ("an identity sheet's audit hook
  [is] likely to need one"). Granting it at planning rather than mid-leg is the
  point — the alternative is discovering a pinned budget during implementation,
  which is the failure mode the mission names.
- **Scope of the grant**: exactly one entry, for an identity capture-sheet audit
  hook, exported from `vault-controller.js` and destructured into
  `renderer.js`'s existing `open*OverlayForAudit` family (`:437-446`) — the
  M18 F2 Leg 4 every-new-sheet precedent. Any SECOND entry needs its own ruling.
- **Lockstep requirement**: `SEAM_COUNT` in `test/unit/seam-contract.test.js`
  and the seam note in CLAUDE.md are dual-sourced and must be updated in the
  same change (the standing FD ruling).
- **This may prove unnecessary.** The identity offer is a new *mode* of the
  existing `vault-capture` menuType, not a new menuType, so Leg 4 may reach the
  same coverage through the existing hook. The grant costs nothing unused; it
  exists so the leg is never blocked on a ruling mid-flight.

### Open Questions

- [x] How does a gesture spanning two families behave? → DD1.
- [x] What is identity's value-layer admission gate? → DD2.
- [x] When does the extraction happen? → DD3.
- [x] What carries live acceptance? → DD4.
- [x] Card vs identity on a contested field? → DD5.
- [x] How does a conflict offer name changed fields without leaking PII? → DD6.
- [x] Is identity fill origin-gated? Does automation see it? → DD7.
- [x] How is an identity fill triggered at all? → DD8.
- [x] Is the fill-precision regression in scope? → DD9.
- [ ] **Does an identity capture need its own settle signal, or does the existing
      pair suffice?** DD4 (Flight 1) gives two settle paths: a navigation commit,
      and a preload-reported detachment of the *held gesture's own fields*
      (`armGestureDetachWatch`). With two concurrent holds (DD1), the detach
      watch's single `watchedGestureFields` array and single observer must either
      become per-family or watch the union. **Leg 2 (`multi-hold`) must settle
      this as its own decision** — it is a mechanism question the multi-hold
      re-key raises, answerable against `webview-preload.js:499-524`, and it must
      not be discovered in Leg 3 or Leg 4.
- [ ] **Does `fullName` get COMPOSED from `firstName` + `lastName` at capture?**
      Flight 2 stated this as a leg residual with no caller: a profile saved from
      a split-name form may show `title` alone with `fullName` unset, which is
      the one non-secret field the picker row can render. **Leg 4 must rule** —
      compose (and state the join rule), or leave unset and accept a picker row
      that reads only its title.

### Prerequisites

Every claim below carries a literal probe output or an explicit **reasoned, not
run** flag — Flight 2 debrief recommendation 1.

- [x] Flight 2 landed and merged (`016e540`, PR #226); flight status `completed`.
- [x] **`renderer.js` is at 1577/1577 — zero slack.** Probe:
      `node -e "…split(/\r?\n/).length"` → `1577`; `SEAM_COUNT`/budget at
      `test/unit/seam-contract.test.js:107,300` → `41` / `1577`.
- [x] **12 binary family branch sites, plus 1 three-way copy line.** Probe: direct
      read of both files → `vault-capture-template.js` 4 (`:124,127,132,133`);
      `vault-picker-template.js` 8 (`:120,312,313,318,319,324,336,352`). `:303` is
      a copy string, counted separately. *(Flight 2's recon said "7 in picker";
      this flight's own first draft said 9 and miscited `:303` as a branch and
      `:312` as `===` when it is `!==`. Both corrected at design review — the
      correction is recorded because the flight claims probe-backed inputs.)*
- [x] **Fill-precision regression still live.** Probe: `grep -n consumeFillTarget
      src/preload/webview-preload.js` → `:441`, `:453`, both discarding the return;
      bootstrap `fillLogin(cred)` passes no third argument.
- [x] **The three bulk drops are already family-blind**, so multi-hold needs no new
      drop wiring. Probe: `dropCapturesForTab` `:1024` / `dropCapturesForWindow`
      `:1046` / `dropAllCaptures` `:1064` all key on `rec.wcId` only.
- [x] **The three supersession sites ARE family-blind and must change.** Probe:
      `rec.wcId === wcId` at `vault-human.js:431`, `:501`, `:561`.
- [x] **Identity fixtures are `detects`-only.** Probe: `manifest.js` →
      `billing-jostens` and `incident-report-third-party`, both
      `tier: 'gated', assert: 'detects', family: 'identity'`.
- [x] **The vault page already renders and edits identity items by hand.** Probe:
      `vault.js:1083` `ITEM_SUBSECTIONS` carries `identity`;
      `vault-editor-model.js:65` carries its layout. So this flight owns only the
      page-facing path, not the manual one.
- [x] **Automation is structurally login-only.** Probe: `vault-context.js:357`,
      `:493`, `:549` all filter `type !== 'login'`.
- [x] **The sheet is unobservable to automation under every `vault-*` menuType**,
      which is what rules out a behavior test (DD4). Probe:
      `AUTOMATABLE_MENU_TYPES` in `src/main/automation/resolve.js`.
- [x] **Squawks 0093, 0094, 0095 are open and OUT of scope** — documentation and
      sign-off hygiene from Flight 2's debrief, for a squawk turnaround, not this
      flight. Probe: `grep Status squawks/009{3,4,5}-*.md` → all `open`.
- [ ] GUI dev launch + automation surface available for the HAT leg
      (`npm run dev:automation`) — *reasoned, not run; verified by the operator at
      HAT time, as in Flight 1.*

### Pre-Flight Checklist

- [ ] All open questions resolved *(two are deliberately deferred to named legs —
      see Open Questions)*
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Four legs plus an optional HAT, ordered so that **every no-new-behaviour
mechanism change lands green against today's login/card behaviour before the
identity family depends on it**. Legs 1 and 2 add no family and no page-facing
behaviour; legs 3 and 4 add the family. The fixture corpus is reused under its
existing promotion discipline, not paralleled.

### Checkpoints

- [ ] Both sheet templates dispatch by type; renderer.js is under budget with
      headroom; no behaviour changed.
- [ ] A card hold and a login hold coexist on one tab, release together, and
      queue two sheets presented serially — proven against the EXISTING two
      families, before identity exists.
- [ ] With the vault LOCKED, two pending offers survive one unlock and both
      reach a sheet; an abandoned unlock drops both.
- [ ] An identity profile fills into a live checkout form from the picker, and an
      icon-triggered login fill on a two-form page fills the CLICKED form.
- [ ] A billing form entered by hand raises a real identity save offer; a
      gap-fill and a conflict each render their own copy, naming fields and never
      values.
- [ ] Zero offers across the entire negative set, unchanged.

### Adaptation Criteria

**Divert if**:
- The multi-hold re-key cannot be made to coexist with `captureRelease`'s own
  re-entry into `capture`/`captureCard` without restructuring the capture map —
  that is a data-model change, not an in-place widening, and needs re-deciding
  rather than forcing.
- DD2's value-layer gate turns out to refuse `billing-jostens` (the motivating
  page) while admitting an adversarial fixture — the gate would then not be
  achievable in that shape and needs re-deciding, not loosening in place.

**Acceptable variations**:
- Which specific renderer glue Leg 1 extracts, so long as the budget lands with
  headroom and no behaviour changes.
- Whether `billing-jostens` earns `captures` or `offers`, decided by its own
  markup per DD4.

### Legs

> Each leg states its count of **unproven adversarial axes** — decisions with no
> in-repo precedent to lean on (Flight 2 debrief, drafting-time sizing heuristic).

- [x] **Leg 1** `sheet-type-dispatch` — **0 unproven axes.** Replace the 12 binary
      family branches (and the one three-way copy line) in `vault-capture-template.js` and
      `vault-picker-template.js` with type-keyed dispatch, and extract the named
      candidate (DD3) — the auth/cert challenge subscriptions, into a NEW
      `src/renderer/chrome/auth-challenge-controller.js`, **never** into
      `vault-controller.js` (DD3 records why) — to land `renderer.js` at
      **≤1562**, lowering `RENDERER_LINE_BUDGET` to landed size per the house
      lock-in-headroom discipline. **Zero behaviour change** — the login and card
      sheets must render byte-identically, proven by the existing template tests
      before a third type exists anywhere. No identity.
- [x] **Leg 2** `multi-hold` — **2 unproven axes** (the re-key; the locked-vault
      pending-unlock queue — raised from 1 at design review). Family-scope the
      three supersession predicates; make `captureRelease` return an array and
      release every pending-settle record for the tab; iterate at both settle call
      sites; add **both** chrome-side queues in `vault-controller.js` — the
      already-unlocked presentation queue AND the locked-mode pending-unlock
      array replacing the `pendingCaptureId`/`pendingCaptureUnlock` scalars
      (DD1's amendment). Settles the detach-watch open question above as its own
      decision. Proven with **login + card only**, and the acceptance criteria
      must include: a concurrent login and card hold on one tab; two queued
      sheets presented serially; **a LOCKED vault with two pending offers, where
      one unlock resolves both**; an abandoned unlock dropping both; and correct
      drop behaviour on lock / tab close / window close / TTL for each record.
      No identity.
- [x] **Leg 3** `identity-fill` — **2 unproven axes** (the icon's third kind;
      the ordinal fill fix). `findAllIdentityFields` into the observer + bootstrap
      + esbuild target; `IDENTITY_ROLES` in the observer; `isClaimedByCard`
      (DD5); the third icon kind and its **`anchorKinds()` walk** plus the
      `nonPostalCandidate` propagation (DD8 — both are render-gating, not
      cosmetic);
      `reachableIdentityItems(jarId)` and the picker's third arm;
      `fillIdentityForm` in the isolated world; `fillHuman`'s third type branch
      (DD7); and **DD9's ordinal fix for all three families**. Pins that
      automation stayed login-only.
- [x] **Leg 4** `identity-capture` — **3 unproven axes** (the value-layer gate;
      the conflict sheet mode; `classifyCapture`'s first live wiring). Note that
      the sheet work is **mode-dispatch WITHIN the identity type**
      (fresh-save / gap-fill-merge / conflict) layered on top of Leg 1's
      type-dispatch ACROSS families — two dimensions, not one, which the axes
      count alone understates.
      `snapshotHasProvenancedSecret`'s identity arm (DD2);
      `resolveGestureTarget`'s third arm at DD5's precedence;
      `holdGestureIdentity` + `disposeIdentityCapture` wired through
      `classifyCapture` and `identityProfileOf` (DD10); the capture sheet's
      identity/merge/conflict rendering carrying field names only (DD6); the
      corpus promotion (DD4); the `fullName` composition ruling (open question
      above); and DD12's seam entry if a new audit hook proves necessary.
- [ ] **Leg 5** `hat-and-alignment` *(optional)* — operator-driven HAT on the dev
      build. Walk covers, at minimum: a real billing checkout raising an identity
      offer; a card + identity double offer queueing two sheets; a fill into a
      later form; a conflict offer's copy; an icon-triggered fill on a two-form
      page landing in the clicked form; and **at least one cross-window state**
      (a second window's sheet, or a lock raised from elsewhere while an offer is
      open), per the HAT sizing guidance.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`)
- [x] Documentation updated (`docs/vault.md`, CLAUDE.md — the Password vault
      pattern's identity bullet moves from "foundations only: no live caller" to
      the shipped behaviour, and the automation-stays-login-only guarantee is
      restated)
- [ ] Mission Known Issue 3 (fill precision) marked closed in its "no precision
      at all" form, with the mutation-race residual restated as what remains
- [ ] Mission flight list updated
- [ ] Flight 2's carried-forward debts explicitly accounted for: fill precision
      (DD9), unwired `classifyCapture` (DD10), LD3 precedence exercised (DD5),
      renderer budget (DD3)

### Verification

- **Headless gate**: the fixture corpus, with the two identity shapes promoted
  per DD4 and the entire negative set still at zero offers. Unit coverage for the
  value-layer gate, the multi-hold re-key and its drop rules, the ordinal fill
  resolution, `isClaimedByCard`, the three-way template dispatch, and the
  identity offer model's field-names-not-values shape.
- **Live acceptance**: the HAT leg (DD4). No behavior-test spec — the key
  observable is unreachable to every automation tier, premise-audited at planning.
- **Negative pins**: `vault-context.js` still refuses non-login items at all three
  sites; no identity value appears in any sheet model; no offer from a burner or
  internal tab or a subframe; no held record survives a lock, tab close, window
  close or TTL expiry un-zeroized, in either queue.
