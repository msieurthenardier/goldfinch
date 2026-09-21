# Mission: Saving, Not Just Filling

**Status**: active

## Outcome

The vault stops being a place you can only read from. Today Goldfinch fills
credentials well and captures them badly: there is exactly one way for anything to
get *into* the vault — a native `<form>` submit event — and a large and growing
share of the real web never fires one. The operator's own words: *"I have noticed
other instances where I'm not offered to save my password."*

When this mission lands, entering a credential, a payment card, or a billing
identity into a page offers to save it — including on the checkout and sign-up
flows that submit by script rather than by form. A new password can be generated
at the moment it is needed, in the field where it is being typed, rather than
invented by the operator. And the browser knows what a person is, not just what a
login and a card are.

Crucially, none of that arrives at the cost of the property that makes the capture
path trustworthy: a save offer still represents something the operator really did.

## Context

This mission comes directly out of a live investigation (2026-09-18) of a Jostens
yearbook checkout, driven over the automation surface against the real site.

**What was found.** The card fields on `secure.jostens.com/apps/buy/payment` are
plain top-frame inputs and Goldfinch detects them correctly — the in-field lock
icon renders on the card-number field exactly as designed. The failure is entirely
on the save half: the page's Submit Payment button (`#submit-common`) sits
**outside every `<form>` on the page** (the card form spans a byte range that ends
well before it), so no native `submit` event can ever reach the card form and the
capture listener never runs. No offer is raised, ever, no matter what the operator
types. The operator reports the same symptom for passwords on other sites.

**The trust property survives a broader trigger; the disambiguation does not come
free.** Design review against the codebase settled the mission's central worry:
`isTrusted` resistance is not a property of the `submit` event type. It comes from
the native getter captured at document-start (`webview-preload.js:303`), and it
holds identically for a genuine click or keypress — `vault-fill-icon.js:237-238`
already gates the lock icon's own click on exactly this. So a broadened trigger set
can preserve the security property outright. What `submit` uniquely provided was
**unambiguity**: the browser itself declared "this form is being submitted," and
the listener's only job was reading the right fields. A trusted click on an
arbitrary button declares nothing, so the preload must decide for itself which
gesture meant "I have finished entering this credential" — a heuristic judgement
with a real false-positive frontier. That judgement is bounded rather than
open-ended, and the bound is the point: the corpus's gated set defines what must
work, shapes that resist solution are demoted to a documented known-unsolved set
rather than deleted, and the negative set holds the line at zero. Critically, the
three failure modes hiding under "false positive" are governed separately — see
Constraints — because only two of them are actually worth trading coverage for.

**And the data path has to move.** Today's listener scopes off `e.target`, which
*is* the form, so `findLoginFields(form)` reads the right fields for free. Jostens
breaks precisely that: the submit control has no DOM relationship to the fields at
all. A click/Enter trigger therefore needs independently-tracked state — "the entry
whose values should be captured on the next qualifying gesture" — decoupled from
the click target and from DOM containment. That is new state in a security-critical
file, and it is the flight's real hard problem, more than the trust question.

This is not a surprise so much as a bill coming due. `webview-preload.js:400`
already says so in as many words: *"v1 covers real `<form>` submits only; SPA /
fetch logins with no submit event are a documented F3 gap."* Mission 12 shipped the
vault with one trigger and a note that it would not be enough. It is now not enough.

**Why the single trigger was chosen, and why replacing it is the risk.** The
`submit` listener is gated on the genuine `isTrusted` getter, captured once at
preload init (M12 F3 DD4). That gate closes two specific attacks: a hostile page
raising a **spurious** save offer for a credential the operator never submitted,
and a page **steering the disposition** of a save (new entry vs. update to an
existing one) by forging submits against a form it controls. `contextIsolation` is
off in guest main worlds — a requirement of fingerprint farbling — so page script
shares a realm with the preload and can forge almost anything except a genuinely
user-initiated event. The `submit` event is narrow, unambiguous, and user-driven.
Any broader trigger set is, by construction, a wider attack surface. Getting that
right is the mission's central problem; everything else here is ordinary work.

**The other three gaps, same root.** They are grouped here because they are all the
acquisition surface, and because they interact: an identity item is only useful if
checkouts can save one, and a generated password is worthless unless the save offer
that follows it fires.

- **No identity.** `src/shared/vault-item-schema.js` defines exactly `login`,
  `card`, `note`. Name, address, email and phone can be neither saved nor filled.
  Jostens' billing form ships `autocomplete="on"` rather than the WHATWG tokens
  (`given-name`, `address-line1`, `address-level2`), so detection will need name
  heuristics of the kind the card path already uses — and it will need them without
  the benefit of any structural anchor at all. Logins anchor on
  `input[type=password]`; cards anchor on a detected `cc-number`; an address form
  anchors on nothing.
- **No generator.** Nothing in the sheets, the vault page, or `vault-crypto.js`
  offers to invent a password. The operator wants one at account creation and at
  password rotation.
- **The in-field affordance looks like nothing.** The vault icon injected into a
  detected field is a bare generic padlock — amber when locked, green when
  unlocked. It reads as a browser widget rather than as Goldfinch, and it carries
  none of the product's identity at the one moment the operator is deciding whether
  to trust it with a secret. The operator wants it to combine the Goldfinch mark
  with the lock state, in the manner of a dedicated password manager's in-field
  badge. This is a look-and-feel item, but it is not free: the icon's exact
  attribute set is pinned by test as a "holds nothing a hostile page can read"
  guard, the glyph must stay inline SVG (the guest has no emoji font and must fetch
  nothing), and the repository currently has no vector form of the Goldfinch mark
  at all — only a raster app icon.
- **A detection defect** in the card fallback patterns (camelCase role names are
  missed, so Jostens' `card_cardExpMonth` / `card_cardExpYear` resolve to nothing)
  is being handled **as a separate squawk**, not as mission scope. It is recorded
  here only because it was found in the same investigation.

## Success Criteria

- [ ] A password or a payment card entered in a flow that never fires a form
      submit is still offered for saving — for **every** shape in the corpus's
      gated set, both families, with no exceptions. *(behavior-test-backed; the
      gated set IS the definition of coverage — see Constraints)*
- [ ] The offer is raised when the entry has demonstrably gone somewhere, not at
      the instant of the gesture — so a trusted click that led nowhere produces no
      card, and a held snapshot that never settles is dropped and zeroized rather
      than surfacing late.
- [ ] A name, address, email and phone can be saved from a checkout form and filled
      into a later one, scoped per jar like every other vault item.
- [ ] A password can be generated from within the field being typed, at account
      creation and at password rotation, and the generated value survives into the
      vault through the same save path as a typed one.
- [ ] No save offer can be raised without a genuine operator gesture: page script
      acting alone — including script that forges events, calls `form.submit()`,
      or synthesises clicks — raises no offer and cannot influence whether a save
      is dispositioned as a new entry or an update to an existing one.
- [ ] The committed fixture corpus enumerates the known-failing form shapes —
      including deliberate near-misses, decoy controls and multi-step forms, not
      only the winnable cases — and is curated **before** the detection heuristic is
      written, so it specifies the behaviour rather than ratifying it. Shapes that
      resist solution are demoted to the documented known-unsolved set, never
      deleted.
- [ ] The exclusions that bound the existing capture path still hold for every new
      path: no offers from burner or internal tabs, none from subframes, and no
      secret reaches a page DOM or crosses a channel outside the existing
      zeroized-buffer discipline.
- [ ] The in-field vault affordance is recognisably Goldfinch — the product mark
      and the lock state in one badge — legible at in-field size in both lock
      states, on light and dark form fields, while still carrying nothing a hostile
      page could read.
- [ ] Zero offers on the corpus's entire negative set — decoy controls, cancel
      buttons, search fields, mid-flow multi-step forms, and pages actively trying
      to provoke one. This is the hard gate that the two absolute failure modes
      (wrong value, wrong disposition) reduce to in practice.
- [ ] Identity capture is gated by a stated plausibility rule, so that the family
      with no structural anchor cannot write an arbitrary form value into the vault
      — the same protection Luhn already gives cards.

## Stakeholders

- **The operator** (primary, and the only user of this build): loses credentials
  silently today and has to hand-manage passwords and billing details. Benefits
  directly and immediately.
- **The vault's security model** (as a standing interest, represented in review):
  Mission 12's trust boundaries and Mission 18's compromise-mode work both assume
  capture is narrow and operator-driven. This mission widens the trigger and must
  not widen the trust.

## Constraints

- **The `isTrusted` property is non-negotiable.** Whatever replaces the `submit`
  event must be as resistant to page forgery. A trigger that a hostile page can
  synthesise is not an acceptable trigger, regardless of how much coverage it buys.
- **Spurious offers are governed per failure mode, not by one blanket rule**
  (operator ruling — this supersedes an earlier blanket "near-zero" constraint,
  which conflicted with the broadened-trigger outcome for no good reason). The
  three modes have genuinely different costs and therefore different bars:
  - **Wrong value** — offering to save something that is not the credential it
    claims to be. **Hard zero.** This is what the card path's existing stance
    (*"false positives are the risk to manage, not false negatives"*) was always
    really about, and it stays absolute.
  - **Wrong disposition** — offering to *update* an existing entry where it should
    be a new one, or letting page script influence which. **Hard zero.** This is
    the property M12 F3 DD4's `isTrusted` gate exists to protect.
  - **Wrong moment** — offering when the operator was not finishing entry. **A
    budget, not a wall.** The values shown are the operator's own, correctly read
    from fields they really typed into, and nothing is written without an explicit
    yes; the cost is one dismissal.
  The tension between broad coverage and correctness largely dissolves here,
  because **trigger and detection are independent axes**: broadening *when* we ask
  does not broaden *what we are willing to call a credential*. Logins anchor on
  `input[type=password]`; cards already pass a Luhn + 12–19-digit plausibility gate
  main-side in `card-identity.js` after capture. Neither gate is touched by a wider
  trigger, so a wider trigger buys wrong-moment risk, not wrong-value risk.
  **Identity is the exception** — no anchor, no Luhn analogue — which is why its
  plausibility gate is load-bearing rather than optional (see Open Questions).
- **Capture on gesture; offer on settle** (operator ruling). The trigger heuristic
  decides when to *snapshot* a detected entry; the offer is raised only once that
  entry demonstrably went somewhere — a navigation commit, the fields detaching,
  the form ceasing to be editable. Decoupling the two moves the uncertain judgement
  onto the cheap half and lets the gesture heuristic be generous without turning
  every ambiguous click into a visible card. **Cost, to be designed for
  explicitly:** the held record now lives longer than it does today, so the
  zeroization, drop-on-lock and drop-on-tab-close rules matter more, not less.
- **No offer is raised without an operator gesture, and there is no icon-level
  manual save** (operator ruling — automatic only). A missed detection is therefore
  not silently unrecoverable but is recovered the tedious way: creating the item by
  hand on the vault page. Accepted.
- **No secret in a page DOM.** The chrome-owned sheet + dual-zeroized Buffer
  channel stays the only path for secret entry and display.
- **Per-jar scoping holds** for identity items exactly as it does for logins and
  cards; burner jars capture nothing.
- **Zero new runtime dependencies.** Password generation uses the platform CSPRNG.
- **Top-frame only.** No new path may capture or fill inside a subframe.
- **"Coverage" means the corpus, and the corpus has two tiers.** There is no way
  to enumerate every failing form shape on the web, so no criterion here claims to.
  The corpus is a living, appended-to spec; a shape not in it is not a regression.
  It is split deliberately:
  - a **gated set**, which every shape must pass (see Success Criteria), and
  - a **known-unsolved set**: shapes that are documented and committed but
    explicitly outside the gate.
  This second tier exists because a 100% bar on the gated set, with no manual
  fallback, otherwise creates exactly one pressure — delete the hard shape to keep
  the gate green. A shape may be *promoted* into the gated set when it is solved;
  **a shape is never deleted to make the suite pass.** Demotion out of the gated
  set requires the same deliberate ruling as any other criterion change.
- **The negative set is a hard gate.** Decoy buttons, cancel controls, search
  boxes, mid-flow multi-step forms, and pages actively trying to provoke an offer
  live in the corpus alongside the positive shapes. Zero offers on any of them, no
  exceptions — this is the operational form of the two hard-zero modes above.
- **Two pinned budgets will be hit and must be handled deliberately, not
  discovered late.** The evaluate-seam closed set (`SEAM_COUNT`, currently 41,
  `test/unit/seam-contract.test.js:107`) requires an FD ruling for any new entry —
  a generator surface and an identity sheet's audit hook are both likely to need
  one. `RENDERER_LINE_BUDGET` (1577, same file, `:300`) is pinned against
  Prettier-formatted output and, per house rule, is fixed by extraction rather than
  compaction.
- **The in-field badge is rebuilt whole, never mutated in place.** The
  `isIconOnlyMutation` guard closes the DD3 media-rescan feedback loop by tracking
  exactly one top-level node per icon; a badge that appends or swaps children
  post-insertion silently re-arms that loop. `setVaultLocked`'s existing
  rebuild-and-replace is the pattern to follow.

## Environment Requirements

- Existing toolchain; no new runtime dependencies.
- A **vector form of the Goldfinch mark** must be authored — the repository ships
  only a raster app icon, and the in-field badge must be inline SVG.
- Fixture corpus runs headlessly under the existing unit runner; no GUI needed for
  the regression gate.
- Live-app verification (lock icon placement, sheet behaviour, generator UI) needs
  the GUI dev launch and the automation surface, as today.
- **Note:** the MCP `evaluate` op is currently a silent no-op in the installed
  0.16.5 build, and `readDom`'s `selector`/`maxLength` arguments appear ignored.
  Both are being logged as squawks. Any flight planning live verification should
  assume `evaluate` is unavailable until that is fixed.

## Open Questions

- [ ] What replaces the `submit` event as the trust anchor? Candidate signals
      include a trusted click on a control that would submit, a trusted Enter
      keypress in a detected field, and field-value state at navigation/unload —
      each with a different forgery profile. This is the first flight's central
      design decision and is deliberately left open here.
- [ ] Should an identity item be one composite record (a "profile") or a set of
      independently-fillable fields? Affects the schema, the picker, and what a
      partial capture from a form that only asks for name and postcode means.
- [ ] How is a *new-password* field distinguished from a *sign-in* password field,
      given both are `input[type=password]`? The generator needs this, and getting
      it wrong offers to generate a password over the one the operator is typing to
      log in.
- [ ] Does generation need to honour site password policies (length caps, required
      classes), and if so, where does that information come from?
- [ ] Does the redesigned badge show the product mark in **both** lock states, or
      does the mark replace the lock only once unlocked? Affects whether lock state
      stays readable at a glance, which is the icon's current primary job.
- [ ] How should a portable bundle carrying identity items behave when opened by a
      build that predates the type? `vault-store.js:126` hardcodes the type set and
      the bundle-import path (`:549`) throws `VaultFormatError` on an unknown type,
      failing the **whole** import rather than skipping the item — so adding a type
      is a forward-compatibility break in the Mission 18 portability surface unless
      something changes. Decide whether that is accepted, versioned, or made
      tolerant.
- [ ] **What is identity's plausibility gate?** Now load-bearing, not optional:
      identity is the one family with neither a structural anchor nor a Luhn
      analogue, so it is the only place where a broadened trigger genuinely can
      produce a wrong-value offer. Without an answer here the hard-zero constraint
      cannot be met for identity, and Flight 2 cannot honestly claim it.

## Known Issues

- [x] ~~**Flight 1's live acceptance is outstanding.**~~ **CLOSED 2026-09-19** by
      Flight 1's HAT leg — the operator drove all seven checks on the dev build and
      every one passed, including the motivating submit-outside-every-form shape
      raising a real card save offer that persisted to the vault. Original text: The dev sandbox's compositor
      is broken (synthetic input and screenshots fail with GPU/DRM errors while
      `evaluate` works), so nobody has yet watched the broadened trigger raise a
      real save offer on a real page. A rig problem rather than an app one —
      synthetic input works against the installed build. Closes via Flight 1's
      optional HAT leg, which the operator runs.
- [ ] **Bounded plaintext retention in the isolated world** (Flight 1, DD3i). A
      provenanced value is held as a JS string for a TTL-bounded window, where
      before the flight a plaintext copy existed only transiently inside one
      synchronous submit handler. Exposure duration, not value forgery — budgeted
      deliberately, and the one thing the new architecture made worse.
- [x] ~~**Gesture-initiated fill on a page with MULTIPLE detected forms**~~ —
      **CLOSED 2026-09-21 by Flight 3 (DD9), verified live at its HAT Step 3.**
      Original text: "resolves by entry ordinal rather than the clicked node… Correct
      in the common case." That text was imprecise when written — the ordinal fix had
      reached CAPTURE but not FILL, which still always filled the first detected
      entry. Flight 3 made every icon fill (login, card, identity) pass an integer
      ordinal through the existing `resolveOrdinalInFamily`; on a live two-form page
      the clicked form fills and the other stays empty. The residual is split out
      below.
- [ ] **Ordinal fill/capture can misassociate under a DOM mutation between the two
      enumerations** (the main world and the isolated world each enumerate entries
      independently; the integer means the same entry in both only while the DOM is
      stable between them). Narrowed from the item above — this is what remains.
      Affects fill and capture alike.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned
> and created one at a time as work progresses.

- [x] Flight 1: **The save moment** *(landed 2026-09-19, PR #222 — live acceptance CLOSED via HAT)* — replace the single `submit` trigger with a
      broadened, forgery-resistant trigger set for logins and cards, and stand up
      the committed fixture corpus that proves it. Carries the mission's central
      risk and its hardest design decision; everything else depends on it.
      **Deliberately NOT split at the login/card boundary** (operator ruling): both
      families share one trigger and one containment-decoupled state machine, and
      splitting risks designing that mechanism twice, or discovering late that a
      login-only design cannot carry the card family. Accepted cost: this is a
      large flight, and design review flagged it as the mission's one oversized
      piece.
- [x] Flight 2: **Identity foundations** *(landed 2026-09-20)* — what an identity IS and how it is
      stored: the admissibility boundary (a specific token stands alone, a generic
      one needs a qualifying prefix), proven against adversarial fixtures; the card
      fallback-pattern fixes escalated from squawks 0090/0091; and the identity
      item type in the vault substrate including a bundle importer that survives an
      unknown type. Nothing page-facing ships. *(Split at design review from a
      single larger "Identity items" flight — review judged that a repeat of
      Flight 1's sizing mistake.)*
- [x] Flight 3: **Identity fill and capture** *(landed 2026-09-21, PR #228 — HAT
      passed; the combined-form gap the HAT found was fixed in-flight as Leg 6)* — in-world detection wiring, fill,
      capture, the three-way sheet templates, and the fill-precision regression
      Flight 1 accepted (still live: the gesture's ordinal fix reached capture, not
      fill). Starts in budget deficit — `renderer.js` is 1576 lines against a 1577
      budget — so its sheet work must plan an extraction from day one.
      Comparable in scope to the original card-type work, not a small addition: it
      touches the schema and its cross-consistency test, the store's type set and
      its three enforcement sites, a new detection module (anchored on nothing, the
      hardest of the three families), a third arm in the reachable-items merge, and
      the capture and picker sheet templates — both of which currently hand-branch
      on a binary `isCard` and become three-way.
- [ ] Flight 4: **The in-field affordance** — what the injected icon *is* and what
      it *offers*: password generation at account creation and password rotation
      (including new-password-field discrimination), and the redesigned Goldfinch
      mark-plus-lock badge that replaces the generic padlock. Grouped because both
      change the same element on the same surface. Despite following Flight 1, this
      flight carries little of its security risk — generation is triggered by a
      trusted click on Goldfinch's own injected element, which is already gated
      today — and is instead the mission's highest UI-craft risk.
- [ ] Flight 5 *(optional)* — **carried from Flight 3's debrief, DECIDED by the
      operator**: a pending save offer should SURVIVE window blur (today the
      `vault-capture` sheet is deliberately excluded from blur survival, so
      alt-tabbing to check a detail discards the offer). A decided behaviour change,
      but it needs a scoped design, not a squawk: it is security-sensitive (a held
      secret stays in memory while the window is unfocused), and it interacts with
      Flight 3 Leg 2's LD2 (blur is an occlusion close that drops the whole queue)
      and with the lock-close safety valve (`closesOnVaultLock` would then also close
      it, so the dismiss-drop must fire on that reason).
- [ ] Flight 5 *(optional)* — **carried from Flight 3's HAT**: the operator asked
      for before/after VALUES on the identity update sheet. Not a squawk — it reverses
      Flight 3's DD6 (labels only, never values) and is security-sensitive (secret PII
      over a non-zeroized channel into the sheet DOM; stored secrets shown on a
      page-raised sheet). A named design question for this flight: masked hints,
      reveal-on-click via the secret channel, or new-values-only.
- [ ] Flight 5 *(optional)*: Alignment — vibe coding session for the feel of the
      offers, the generator affordance, and the identity sheet.
