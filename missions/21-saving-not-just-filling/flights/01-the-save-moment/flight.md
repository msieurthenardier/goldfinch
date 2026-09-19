# Flight: The Save Moment

**Status**: landed
**Mission**: [Saving, Not Just Filling](../../mission.md)

## Contributing to Criteria

- [ ] A password or payment card entered in a flow that never fires a form submit is
      still offered for saving, for every gated corpus shape, both families.
- [ ] The offer is raised when the entry has demonstrably gone somewhere, not at the
      instant of the gesture; a snapshot that never settles is dropped and zeroized.
- [ ] No save offer can be raised without a genuine operator gesture; page script
      acting alone raises none and cannot influence new-vs-update disposition.
- [ ] The fixture corpus enumerates known-failing shapes, curated before the
      heuristic, with resistant shapes demoted rather than deleted.
- [ ] Zero offers on the corpus's entire negative set.
- [ ] Existing exclusions hold: no burner, no internal, no subframes, no secret in a
      page DOM.

---

## Pre-Flight

### Objective

Replace the single native-`submit` capture trigger with a broadened,
forgery-resistant trigger set covering both the login and card families, and stand
up the committed fixture corpus that defines what "coverage" means. This flight
carries the mission's central risk and both later flights depend on its output.

It is deliberately **not** split at the login/card boundary (operator ruling): both
families share one trigger and one containment-decoupled entry tracker, and
splitting would design that mechanism twice. Mission design review flagged this as
the mission's one oversized flight — accepted, and reflected in the leg cut below,
which front-loads safety and defers the entangled trigger/settle work to a single
late leg rather than dribbling it across several.

### Open Questions

- [x] Is a forgery-resistant trigger other than `submit` possible? → Yes. Resolved
      at mission level; see DD1.
- [x] Where does the containment-decoupled entry state live? → DD2.
- [x] What qualifies as a capture gesture? → DD3.
- [x] What counts as "settled"? → DD4.
- [x] What is the drop policy for a held snapshot? → DD5.
- [x] How is the corpus built and run? → DD6.
- [ ] Does the hand-rolled fixture extractor reproduce real DOM form-association
      semantics (including the `form=` attribute and nesting rules) faithfully
      enough to be trusted as the gate? Carried into Leg 3 with a **required**
      live cross-check, not a trusted assumption.
- [ ] Should repeat `update` offers for the same origin+username pair be
      rate-limited, to bound operator-fatigue misclick risk? Raised at design
      review. Not a hard-zero path once DD3 lands, but a real ergonomics question
      that DD3's breadth makes more likely to matter.
- [x] Was value-binding considered and rejected, or not considered? → Not
      considered in the first revision; that was the gap. Now adopted (DD3).
- [x] When a field lacks provenance for update purposes, drop or degrade? →
      Degrade to `save`-only (DD3c). Never overwrite; a duplicate is the cheap
      failure.
- [ ] Is per-field provenance sufficient on its own, or does a proximity
      constraint eventually need to join it? Provenance is the primary defense
      (DD3); proximity is the recorded fallback. Revisit if Leg 4's corpus work
      surfaces a case provenance cannot classify.

### Design Decisions

**DD1 — The trust anchor is `isTrusted`, not the event type**: broaden the trigger
to trusted `click` and trusted `keydown`(Enter), read through the same
document-start-captured native getter the current listener uses.
- Rationale: forgery-resistance comes from `webview-preload.js:303`'s captured
  `Event.prototype.isTrusted` getter, not from anything specific to `submit`.
  `vault-fill-icon.js:237-238` (`readTrusted` / `onIconClick`) already gates the
  lock icon's own click on exactly this mechanism, so it is proven in-tree rather
  than hypothetical. A page can override the prototype getter, monkey-patch
  `dispatchEvent`, or fabricate event objects; it cannot make the browser's own
  dispatch mark a script-made event trusted, and it cannot un-capture a reference
  the preload already holds.
- Trade-off: `submit` was structurally unambiguous — the browser declared the
  intent. A trusted click declares nothing, so disambiguation moves into our code
  and becomes heuristic. That is the cost this whole flight is paying.

**DD2 — The tracked entry lives in a NEW shared preload module**, a sibling of
`vault-fill-fields.js` / `vault-card-fields.js`, owning "the detected entry whose
values should be captured on the next qualifying gesture". Both the icon controller
and the capture path consume it.
- Rationale: this is the flight's riskiest logic and it belongs in a file with no
  pre-existing pinned surface. `vault-fill-icon.js` already carries the pinned
  attribute-set security test (`test/unit/vault-fill-icon.test.js:378-382`) and the
  `isIconOnlyMutation` DD3 feedback-loop guard; growing capture state into it
  raises this flight's blast radius against tests that exist to protect a different
  property. It also keeps the module's stated job (decorative icon placement)
  honest. Placing the state inline in `webview-preload.js` is **ruled out**: that
  file cannot be `require`d under `node --test`, so the logic would be structurally
  untestable.
- Trade-off: a new module plus wiring on both sides, and `pendingFillTarget`
  (`{kind, field, expiresAt}`) — already nearly the right shape — either moves or
  is duplicated. Leg 2 must pick one and not leave two notions of "current entry".

**DD3 — The gesture stays broad; what makes a VALUE admissible is per-field
operator provenance, not proximity.** A capture gesture is a trusted click on any
button-like element, or trusted Enter while focus is in a tracked field. A field's
value enters the snapshot **only if that field carries operator provenance, and
that provenance is bound to the exact value it certifies**. At the moment
provenance is granted — a trusted `input`/`keydown` on that field, or a
Goldfinch-originated fill — the tracker records `{ provenanced: true, value: <the
string observed at that instant> }`. At snapshot time the field is admitted only
if `field.value` still equals the recorded string. A mismatch is treated as
**unprovenanced**, i.e. absent — never as "trust the newer value". A field without
provenance is likewise **absent**, never an empty-or-untrusted value used anyway.
- Rationale: an earlier draft of this DD gated the snapshot on "the tracked entry
  changed since the last read." Design review correctly identified that as a
  **hard-zero violation path**, and it was verified against source rather than
  accepted on argument. Writing `field.value` from page script requires no trusted
  event at all — this codebase demonstrates it, since our own `setFieldValue`
  (`vault-fill-fields.js:93-94`) sets `.value` and dispatches script-made,
  untrusted `input`/`change` events. So a same-origin hostile page could write
  attacker-chosen values into tracked fields, wait for any ordinary trusted click
  (a cookie banner, a nav control), and have DD4 raise an offer on the next
  navigation. That is not merely a wrong-moment nuisance: `disposeCapture`
  (`vault-human.js:315-320`) computes the save-vs-update disposition from
  **origin** (main-derived, trustworthy) plus **username** (the captured field
  value), and on a match sets `rec.vaultId`/`rec.itemId` to the operator's real
  stored item. A script-written username therefore steers *which* credential is
  overwritten and a script-written password supplies the new value — both
  hard-zero modes, reachable with no event forgery whatsoever. DD1's `isTrusted`
  defense does not cover it, because it defends the *gesture*, not the *value*.
  Provenance closes it at the value axis, which is the separation DD7 claims for
  the flight and this DD previously failed to deliver.
- **Goldfinch's own fill must count as provenance.** Our fill path dispatches
  untrusted events by design (live frameworks need them), so a naive
  trusted-events-only rule would silently break fill-then-resave — the operator
  fills from the vault, changes nothing, and we would treat every field as absent.
  Provenance is therefore marked at our own write site, not inferred from events
  alone.
- **Proximity was considered and rejected** as the primary defense: a DOM-distance
  or shared-ancestor rule reintroduces exactly the coupling DD2 exists to remove,
  and would miss the motivating case, where the control sits outside every form.
  It is recorded as the fallback if provenance proves insufficient in practice.
- **Why value-bound and not a sticky per-field flag** (second review pass): a
  boolean "this field was typed into" is a TOCTOU hole, not a fix. Because
  `contextIsolation` is off in the guest main world, a page can let the operator
  genuinely type a password — granting provenance — then overwrite `field.value`
  by plain script with no event at all, and wait for any later trusted gesture.
  A sticky flag would still report the field provenanced and hand the *attacker's*
  current value into the snapshot, reproducing the exact hard-zero path the first
  review caught, moved one layer down. The same applies to the fill half: a page
  can trigger a genuine icon fill and then mutate the field afterward. Binding
  provenance to the observed string closes both, because the certified thing is
  the value, not the field.
- Trade-off: provenance is new per-field state the tracker must carry and
  invalidate correctly — on navigation, on detachment, after a snapshot, and
  implicitly on any value change (the binding does that one for free). Getting
  invalidation wrong is a correctness bug in the security-relevant direction, so
  it is unit territory, not incidental bookkeeping.

**DD3b — Main's disposition logic is unchanged; its INPUTS become
provenance-filtered.** `disposeCapture` stays exactly as it is. The security
argument is that the values reaching it can no longer be page-authored.
- Scope correction (second review pass): the claim "values reaching it can no
  longer be page-authored" holds for *values* under DD3, but did NOT hold for the
  username's **meaning** until DD3c defined it. `disposeCapture` is still
  unmodified; what changed is that the capture path must not take the `update`
  branch for a detected-but-unprovenanced username.
- Rationale: main cannot verify provenance — it sees only bytes. Enforcement is
  therefore necessarily preload-side, and the invariant must be stated where a
  future reader will find it: **anything main receives on the capture channel is
  claimed to be operator-entered, and that claim is only as good as DD3.** Writing
  it down keeps a later change from quietly weakening DD3 without anyone noticing
  the main-side consequence.
- Trade-off: the trust boundary is asymmetric — main trusts the preload's
  provenance claim. That is already true of every value on this channel today; this
  DD makes it explicit rather than introducing it.

**DD3c — A DETECTED-but-unprovenanced username may offer `save`, never `update`.**
If no username field was detected at all, existing behaviour is preserved
unchanged.
- Rationale: "absent" needed a defined wire meaning, and the obvious one is unsafe.
  `normUsername` (`vault-human.js:48-50`) deliberately collapses `''`/`null`/
  `undefined` to `null` so that "a password-only submit and a stored null-username
  item compare equal" — that comment is pre-existing and the behaviour is correct
  for genuine password-only forms. But it means an *absent-because-unprovenanced*
  username lands in the very same bucket, letting a page suppress provenance on a
  real username field and steer `disposeCapture` into matching an unrelated
  null-username stored item for that origin — overwriting it with the operator's
  real password. That is a wrong-disposition hard zero reached without forging
  anything, and neither DD1 (the click is genuinely trusted) nor DD3 (an absent
  value is *correctly* filtered) covers it. The ambiguity is in what absent
  *means* downstream, so it is resolved here rather than in code.
- The two cases are therefore distinguished explicitly: **username field detected
  but unprovenanced** → the capture may present `save` only, and must never take
  the `update` branch; **no username field detected** → unchanged, `null` may
  match a stored null-username item as it does today.
- Rationale for degrading rather than dropping: `save`-only can at worst create a
  duplicate entry the operator can delete. Dropping the capture entirely would
  lose a credential the operator really typed, which the mission's "budget, not a
  wall" language covers for wrong *moment* but does not license for wrong
  *disposition*. Never overwrite; a duplicate is the cheap failure.
- Trade-off: on a page that legitimately prevents our provenance from being
  granted on the username (an exotic custom input, a framework that replaces the
  node), a genuine update degrades to a duplicate save. Visible and recoverable,
  which is the right direction for this trade.

**DD3d — Every value read the tracker performs goes through a NATIVE `value`
getter captured at document-start, never the live property.** (Added mid-flight at
Leg 2 design review; see the flight log.)
- Rationale: DD3's value-binding compares `field.value` at grant time against
  `field.value` at snapshot time. With `contextIsolation:false` the page shares
  the preload's realm, and `HTMLInputElement.prototype.value` is an ordinary
  configurable WebIDL accessor — **not** `[Unforgeable]`. A page can
  `Object.defineProperty` a getter on the instance or the prototype *before* the
  operator touches the field. The browser's native typing path updates Blink's
  internal editing state directly rather than through that JS accessor, so the
  operator sees their real password on screen while every JS read returns the
  attacker's fabricated string. Both of DD3's reads would go through the same
  rigged getter, match each other, and report the attacker's value as
  provenanced — defeating value-binding completely, with no forged event
  anywhere. This is the same class DD1 already names ("a page can override the
  prototype getter"), and the codebase already carries the countermeasure for it:
  `isTrustedGet` (`webview-preload.js:303-308`) captures
  `Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted').get` at
  document-start and reads through it. The tracker does the same for
  `HTMLInputElement.prototype.value` and `HTMLSelectElement.prototype.value`
  (selects carry card expiry month/year).
- Corollary: Goldfinch's own fills never read back at all. `fillLoginForm` /
  `fillCardForm` report `{ field, value }` pairs carrying the string they
  **wrote**, so the fill path has no read exposure to spoof.
- Trade-off: one more captured-native-accessor to keep correct, and a capture that
  must happen before any page script runs — the same constraint `isTrustedGet`
  already lives under, at the same site.

**DD3e — The tracker's READ SURFACE is closed and enumerated, and every member is
a native accessor captured at document-start.** (Added at Leg 2 design review
round 2; extends DD3d rather than reopening it.)
- Immediate cause: `Event.prototype.target` was unguarded. A page can plant its
  own hidden `<input type="password">`, set its value by plain script, redefine
  `Event.prototype.target` to return it, and then wait for the operator to type
  **anywhere**. `isTrusted` is genuinely true (it and `target` are independent
  accessors), the decoy is a real live field that `findAllLoginFields` legitimately
  finds, and `nativeValueGet` faithfully reports the decoy's real value — the
  attacker's string. Provenance is granted on a field the operator never touched,
  and the binding never breaks because the attacker never touches it again. Same
  hard-zero mode, a sibling accessor over from DD3d.
- **The rule, not just the patch**: this is the FOURTH distinct defeat of the same
  mechanism across four reviews (no provenance → sticky flag → spoofed `value` →
  spoofed `target`). Each fix so far has been "capture one more accessor", which
  makes forgetting an accessor the standing failure mode. So the invariant is
  inverted: the tracker may read page state **only** through an explicitly
  enumerated set of captured native accessors — at minimum `Event.prototype.target`,
  `Event.prototype.isTrusted`, `HTMLInputElement.prototype.value` and
  `HTMLSelectElement.prototype.value` — and a **source-scan test** (the house
  Grep-AC convention) fails if the tracker module contains a bare property read of
  any enumerated name. That converts "did we remember?" from a review question
  into a standing test.
- Fail closed: an accessor that cannot be captured makes the tracker treat every
  field as unprovenanced.
- **Named residual, deliberately NOT closed here**: `findAllLoginFields` /
  `findAllCardFields` read detection properties (`type`, `name`, `form`,
  `tagName`, `options`) bare. Spoofing those cannot make an attacker-*written*
  value pass as provenanced — provenance is keyed by real node reference and read
  through the native value accessor — but it CAN mislabel which real,
  operator-typed field is reported as username vs password. That is a weaker,
  different guarantee, it belongs to DD7's detection axis rather than DD3's value
  axis, and it is recorded rather than silently conflated.

**DD3f — The tracker READS through an isolated world; its DECISIONS stay in a
plain, unit-testable module.** (Leg 2 spike result, operator-directed. Supersedes
nothing — it changes WHERE reads happen; DD3e still governs what may be read and
how, for everything that stays in the main world.)
- Evidence, not argument: across 30 real keystrokes, a main-world observer saw
  only the attacker's spoofed values while an isolated-world observer — reading
  through its own un-spoofed accessors — saw the real target identities and the
  real progressively-typed values. Instance override, prototype override and the
  `Event.prototype.target` redirect were all invisible from the isolated world.
  This ends the enumerated-accessor category **by construction** rather than by
  remembering to add the next accessor to a list, which is what four consecutive
  review rounds demonstrated we cannot reliably do.
- **Hybrid split, deliberately.** The isolated-world script stays thin and stable:
  it observes and reports `{ isTrusted, field identity, value }` records. All
  provenance state, the DD3 value-equality check, and the capture lifecycle live
  in a normal `node --test`-able preload module. Business logic does not grow
  inside an isolated-world script string, because that half is only testable in
  live Electron.
- **DD3e remains load-bearing** for main-world code that does not move —
  principally Goldfinch's own `fillLoginForm`/`fillCardForm` writes, which per
  DD3d never read back and therefore need no isolated-world treatment at all.
- **CORRECTED at Leg 5 design review — the read happens at GESTURE time, not at
  settle.** The original wording ("the settle read routes main → IPC → …") is
  architecturally impossible: `did-navigate` fires *after* the new document has
  committed, so the old page's isolated world and its provenance map are already
  destroyed by then — a read issued at settle would query the NEW page's empty
  world. So: the snapshot is read at gesture time via the same-process `webFrame`
  call and **held main-side**; settle becomes a pure **release gate** on data
  main already holds. A welcome consequence — no cross-process read is needed at
  settle at all, which retires DD3f's own unmeasured-timing concern for that path.
  The prohibition still stands for any read that does happen: never a direct
  cross-process `webContents.executeJavaScriptInIsolatedWorld`.** The spike could measure timing
  only on the same-process path; the cross-process hop is unmeasured, and no MCP
  tool exposes it for testing.
- **⚠ The spike observed that a same-process isolated-world read appears to
  capture its value synchronously at call time rather than at promise resolution.
  That is EMPIRICAL, not contractual** — Electron's typings promise only
  `Promise<any>` with no ordering guarantee. **No design may depend on it.** The
  actual protection against a between-grant-and-read rewrite remains DD3's
  value-equality check, which fails closed on any mismatch.
- Accepted cost: the isolated-world half is live-Electron-only testable, so it
  carries a different verification story from the rest of the preload. Keeping it
  thin is what bounds that cost.

**DD3g — NO node identity ever crosses the world boundary. The isolated world owns
detection AND provenance; only plain data crosses.** (Leg 3 design review.)
- The problem it solves: a DOM node reference cannot cross into another world —
  that is precisely what makes the isolated world immune. An earlier draft had the
  observer report a `fieldId` for the main world to key provenance on, which begged
  the question. Every way of minting such an id is unsafe or fragile: a stamped DOM
  attribute is ordinary page-writable state (a plain `setAttribute` re-opens the
  whole category next door to where we just closed it), and a document-order index
  misassociates whenever the DOM mutates between the two enumerations.
- **So identity never crosses.** The isolated world runs detection itself, holds
  the provenance map keyed by its OWN node references, runs its own
  MutationObserver for detachment, and performs the DD3 value-equality check where
  both sides of the comparison already live. It emits a snapshot of plain,
  serializable values — never a handle.
- **Logic stays unit-testable even though execution does not.** The isolated-world
  script is composed from the SAME pure modules the main world uses
  (`vault-fill-fields.js`, `vault-card-fields.js`) plus a small observer core, all
  `require`-able and tested under `node --test` against fake documents. Only the
  property "this genuinely executes in a spoof-immune context" needs the live
  probe. That shrinks the live-Electron-only surface to world isolation itself.
- **Bonus, and it closes DD3e's named residual**: detection reads
  (`type`/`name`/`form`/`tagName`/`options`) now happen in the isolated world too,
  so the mislabelling attack DD3e had to concede is also structurally gone for the
  capture path.
- **Two resolution call sites, one module — state it, don't hide it.** The chrome
  icon's placement still resolves in the main world (decorative, lower stakes, and
  it needs a main-world node to position against). Capture resolves in the isolated
  world. Same pure module, two execution contexts, different trust levels. The
  earlier "resolution exists in exactly ONE place" wording meant one MODULE, not
  one call site.
- **Boundary rule**: the isolated world does observation, detection, provenance
  bookkeeping and the equality check. The main-world module does policy — gesture
  gating, snapshot timing, DD3c's save-vs-update rule, and the hop to main.

**DD3h — Goldfinch's own fill WRITES move into the isolated world too, and the
snapshot carries three states, not two.** (Leg 3 design review round 2.)
- **Why fills move.** DD3g put provenance in the isolated world keyed by its own
  node references. But `fillLoginForm`/`fillCardForm` write in the MAIN world, so
  "a Goldfinch fill grants provenance" needed a main-world node reference to reach
  the isolated world's map — the very crossing DD3g proved impossible, and every
  substitute (stamped attribute, document-order index) is the one DD3g rejected two
  paragraphs earlier. Re-resolving in-world to guess which field was just written
  would misassociate on any mutation between the two enumerations: not a forged
  value, but provenance granted to the wrong field while the real one stays
  unprovenanced.
  So the write moves instead. A fill needs no read-back (DD3d's own corollary), an
  isolated world's DOM writes affect the same live document, and fill-plus-grant
  then happen in one realm with **no correlation problem to solve**. This removes a
  class rather than managing it.
- **Three-state snapshot.** A binary include/omit shape makes "no username field
  existed" and "a username field existed but lacked provenance" identical on the
  wire — and DD3c depends on telling them apart. The shape is therefore pinned
  here, by this flight, not negotiated later: per detected field
  `{ detected: true, value: <string|null> }`, with `value: null` meaning detected
  but unprovenanced or mismatched, and the key absent meaning never detected.
- **Build delivery is explicit.** `executeJavaScriptInIsolatedWorld` takes a STRING
  evaluated as a plain script — no `require`, no `module`. The pure modules are
  CJS, and the spike proved the sandboxed preload has no `fs`, so there is no
  runtime read-a-bundle fallback: the text must be baked in at build time. A second
  esbuild target emits a `require`/`module`-free script whose output is embedded as
  a generated constant the CJS preload bundle requires normally.
- **⚠ A throw inside an isolated-world script does NOT reject the promise — it
  resolves `undefined`** (spike Q6). So a naive injection of raw CJS source would
  fail on its trailing `module.exports` line and install **nothing**, silently,
  with the feature simply never working. Fail-closed detection must therefore
  assert on the RESOLVED VALUE's shape, never merely on the absence of a rejection.

**DD4 — "Settled" means a main-side navigation commit OR a preload-reported
detachment of the tracked fields. A timeout is NOT a settle signal.**
- Rationale: `did-navigate` is already wired per-tab (`guest-wiring.js:714`) and is
  observed in main, so it is unforgeable by page script and costs no new trust
  surface. Detachment covers the SPA case that never navigates. Critically,
  detachment being a *weaker* signal is acceptable because it only gates *when* we
  ask about data we already hold — it cannot cause a wrong-value offer, which is a
  hard-zero mode. Timeout-as-offer was considered and **rejected**: it spends the
  wrong-moment budget in the most confusing possible way, surfacing a card long
  after the gesture with no context for the operator to judge it.
- Implementation note (verified at review): detachment can ride the MutationObserver
  already installed in `webview-preload.js`, and the `isIconOnlyMutation` DD3
  feedback-loop guard (`vault-fill-icon.js:364-372`) does **not** filter it — that
  guard only suppresses mutations whose nodes are *all* icon nodes, and a removed
  tracked field is never an icon node. Leg 4 should decide explicitly between
  `field.isConnected` and inspecting removed-node subtrees.
- Trade-off (**operator-visible**): a flow that neither navigates nor detaches its
  fields will never offer. Those shapes go to the known-unsolved tier rather than
  being forced through by a timeout.
- Open exposure note: any navigation to any origin counts as settled. That is a
  deliberate simplification (legitimate checkouts redirect cross-origin), but it
  means a snapshot is offered on the *next* navigation regardless of relevance.
  With DD3's provenance rule the values are the operator's own, so the residual
  cost is wrong-moment only — but it is worth a specific HAT check.

**DD3i — Provenance retention is BOUNDED, and the exposure cost is stated, not
implied to be parity.** (Leg 5 design review.)
- **The honest accounting.** Before this flight a plaintext password string existed
  only transiently, inside one synchronous `submit` handler, then fell out of
  scope. Now `grant()` stores `{ value: field.value }` as a plain JS string in the
  isolated world's provenance map on **every trusted keystroke**, and it persists
  for the field's lifetime on the page — no TTL — plus there are more hops before
  the `Uint8Array` encode (map → snapshot → structured clone across worlds →
  main-world variable → encode). JS strings cannot be `.fill(0)`'d. So both the
  **retention window** and the **count of un-zeroable plaintext copies** grew. An
  earlier acceptance criterion called this parity with the existing discipline; it
  is not, and claiming so would have hidden the one thing this architecture made
  worse.
- **Mitigation, not just disclosure**: provenance entries carry a bounded lifetime
  and are evicted on expiry, on detachment, on value change (already implied by
  value-binding) and on document unload. The bound is chosen to comfortably cover a
  realistic fill-then-submit, not a browsing session.
- **Accepted residual**: within that window a plaintext copy exists in the isolated
  world. It is unreachable from the page (that is the whole point of DD3f) and from
  any other origin, and the alternative — not holding the value — makes capture
  impossible. This is an exposure-duration cost, not a value-forgery one, so it
  does not touch a hard-zero bar; it is budgeted deliberately.

**DD5 — Held-snapshot hygiene is tightened BEFORE the lifetime is extended**: held
captures drop on vault lock, on owning-window close, and on tab close, in addition
to the existing `CAPTURE_DROP_MS` TTL, which remains a **drop** and never an offer.
- Rationale: two of these do not exist today. `onLock` (`main.js:905`) drops
  pending vault imports and browser imports but **not** held captures;
  `releaseVaultHoldsForWindow` (`main.js:1012`) likewise. That is tolerable now
  only because a capture becomes an offer within milliseconds. Under DD3+DD4,
  holding is the normal state, so a captured password could outlive a vault lock or
  a window close for up to two minutes. Fixing the safety valve before widening the
  intake is the correct order.
- Trade-off: Leg 1 touches security-critical lock/teardown paths for a benefit that
  is invisible until Leg 4 lands. Accepted deliberately.

**DD6 — The corpus is committed HTML fixture files, read by a hand-rolled minimal
form-control extractor, run headlessly under `node --test`.** No new devDependency.
- Rationale: the corpus's job is to *specify* behaviour and to preserve what real
  pages ship, including whatever we failed to notice. Hand-transcribing shapes into
  JS fake-DOM objects lets the transcriber decide what is salient, which is exactly
  the bias the corpus exists to remove. Pasting real markup does not. The extractor
  is bounded because the detector's DOM surface is small and already pinned
  (`querySelectorAll('input, select')`, `.form`/`.closest`, attributes, `.type`,
  `.value`, `.options`, `.maxLength`, `.dispatchEvent`) — and this approach is
  proven: the Jostens defect was diagnosed exactly this way, by extracting form
  controls from captured markup and running the real `findAllCardFields` against
  them, which reproduced the live result.
- Trade-off (**operator-visible**): the extractor becomes a thing that can itself
  be wrong. If it models `.form` association incorrectly the corpus lies — and form
  association is precisely the semantic at issue in the motivating bug. Mitigated
  by its own unit tests plus a live cross-check during HAT (see Verification), not
  by trust.

**DD7 — Neither detection gate is touched by this flight.** Logins keep the
`input[type=password]` anchor; cards keep the Luhn + 12–19-digit plausibility gate
applied main-side in `card-identity.js` after capture arrives.
- Rationale: trigger and detection are independent axes. Broadening *when* we ask
  does not broaden *what we call a credential*, which is what keeps the two
  hard-zero failure modes out of this flight's risk surface.

### Prerequisites

- [x] Mission approved and `active`.
- [x] `isTrusted` mechanism verified in-tree (`vault-fill-icon.js:237-238`).
- [x] Per-tab `did-navigate` verified wired (`guest-wiring.js:714`).
- [x] Held-capture machinery verified to exist (`vault-human.js:353`, `dropCapture`,
      `CAPTURE_DROP_MS`, per-tab last-wins supersession).
- [x] Drop-rule gaps verified real, not assumed (`main.js:905`, `main.js:1012`).
- [ ] HAT apparatus audit: `evaluate` is a silent no-op in the installed build and
      `readDom`'s `selector`/`maxLength` are ignored (pending squawks). HAT
      verification must therefore rely on `readDom` (full-document) and
      `captureScreenshot` only. Confirm before the HAT leg runs.

### Pre-Flight Checklist

- [x] All open questions resolved or consciously carried
- [x] Design decisions documented with rationale and trade-offs
- [ ] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Four legs, ordered so that each one's risk is retired before the next depends on
it: tighten the safety valve, build the state the trigger needs, write the spec the
trigger must satisfy, then build the trigger.

The corpus is deliberately curated *before* the heuristic exists (mission
constraint). To avoid committing a knowingly-red suite, every positive shape lands
in the **known-unsolved** tier in Leg 3 and is **promoted** into the gated set in
Leg 4 as it is solved. **The mechanism is Node's `{ todo: true }`** — a todo that
later starts passing does not fail the run, which is exactly what clean promotion
needs. There is no `todo` precedent anywhere in `test/unit` today, so Leg 3
establishes the pattern deliberately rather than improvising it mid-leg. The negative set is gated from the moment it lands — it
should already pass, since today almost nothing offers at all. This exercises the
promotion mechanism as a matter of course rather than leaving it a paper policy.

### Checkpoints

- [x] A held capture cannot outlive a vault lock, a window close, or a tab close.
- [ ] One shared notion of "current entry" exists, consumed by both fill and capture.
- [x] The corpus runs headlessly, negative set green, positive shapes enumerated.
- [ ] A value written by page script, with no keystroke and no Goldfinch fill
      behind it, never enters a snapshot — verified directly, not inferred.
- [ ] **Keystroke-then-overwrite**: the operator types, page script then replaces
      the value with no event, a trusted gesture follows — the field is treated as
      unprovenanced and the attacker's value never reaches main. Same for
      fill-then-mutate. This is the TOCTOU case a sticky provenance flag would
      pass and value-bound provenance must fail.
- [ ] **Null-username collision**: a detected-but-unprovenanced username never
      produces an `update` offer against a stored null-username item; a genuine
      password-only form's existing matching behaviour is unchanged.
- [ ] Gated shapes offer; negative set still green; disposition unforgeable.

### Adaptation Criteria

**Divert if**:
- The extractor cannot faithfully reproduce form-association semantics, making the
  corpus untrustworthy as a gate. (Re-plan corpus shape; do not paper over.)
- The gated set cannot reach 100% without a timeout-based offer. (Return to the
  operator — this is the mission's central bet failing, not a leg-level problem.)
- Any path is found by which page-authored values reach a snapshot or influence
  save-vs-update disposition. (Hard stop: that is a hard-zero mode, and it is the
  specific failure design review caught in this flight's first draft.)

**Budget note (from design review)**: this flight is preload- and main-side, with
no new sheet and no new `renderer.js` UI, so it is unlikely to touch `SEAM_COUNT`
(41) or `RENDERER_LINE_BUDGET` (1577). Those costs land in Flight 2's identity
sheet and Flight 3's generator surface — do not budget slack here for them.

**Acceptable variations**:
- Corpus membership changes as shapes are found; promotion/demotion is expected.
- The exact detachment heuristic may evolve, provided it stays a *gate on timing*
  and never becomes a source of value.

### Legs

- [x] `capture-hold-safety` — drop held captures on vault lock, window close and
      tab close; TTL stays a drop. Retires the DD5 gap before anything extends the
      hold. Security-critical, independently valuable, no behaviour change visible.
      **Note**: `releaseVaultHoldsForWindow` receives a *chrome* id while
      `vault-human.js` keys captures by tab `wcId`, and that module is
      Electron-free with no registry access — the chromeId→owned-wcIds lookup must
      be threaded in as an injected dep, not reached for. Natural hook sites
      already exist and are consistent with house patterns:
      `register-tab-ipc.js:323` (which already tears down auth challenges, history
      and the sheet at that exact point) and `window-factory.js:334`.
- [x] **Leg 2** `isolated-world-spike` — live feasibility spike (ships no code): can the
      tracker's DOM reads run in an isolated world, where page-world accessor
      overrides structurally do not exist? Inserted by operator ruling after four
      reviews each found a distinct defeat of per-field provenance.
- [x] **Leg 3** `entry-tracker` — the new shared preload module owning the
      containment-decoupled tracked entry; reconcile with `pendingFillTarget` so
      exactly one notion of "current entry" exists.
- [x] **Leg 4** `fixture-corpus` — HTML fixtures, the minimal extractor (with its own tests),
      the three-tier harness using `{ todo: true }` for the known-unsolved tier.
      Positive shapes land known-unsolved; negative set gated immediately. **The
      live extractor cross-check is a required acceptance criterion of this leg**
      (DD6) — at least one canonical fixture's detection result compared against
      the real app, validating the parser rather than trusting it.
- [x] **Leg 5** `broadened-capture` — the gesture trigger, per-field provenance (DD3) and
      offer-on-settle together (they are entangled; a capture-without-settle
      intermediate would be pure noise, and provenance is what makes the trigger
      safe rather than a separable polish step), promoting gated shapes as solved.
      **Note**: the deferred offer must resolve its destination via
      `chromeForTab(wcId)` **at settle time**, not through a reference captured at
      gesture time, and must carry named tests for the keystroke-then-overwrite
      TOCTOU case and the null-username collision (DD3c) rather than leaving them
      implicit in "provenance" — this is the codebase's established per-tab owner-routed push
      class, and event-time resolution is precisely what makes a tab moved to
      another window between capture and settle work automatically.
- [x] **Leg 6** `hat-and-alignment` — guided HAT over the end-to-end save
      experience, including DD4's cross-origin-settle exposure check and at least
      one state the operator is not looking at (a second window, a background tab).
      The extractor cross-check is NOT here — it is a required criterion of
      `fixture-corpus`.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing
- [ ] Documentation updated (`docs/vault.md` capture section — must record the
      value-binding rule AND the null-username collapse/collision semantics, since
      `disposeCapture`'s comment block is currently the only place that documents
      the collapse and a future reader of DD3 alone would not see the hazard;
      CLAUDE.md vault pattern)
- [ ] Code merged

### Verification

- **Headless gate**: the fixture corpus under `node --test` — every gated shape
  offers, zero offers across the entire negative set, known-unsolved shapes
  documented and excluded from the gate by name.
- **Unit**: the extractor's own tests; the entry tracker's tests; drop-rule tests
  following the `vault-close-on-lock.test.js` precedent.
- **Live extractor cross-check (required, in `fixture-corpus`)**: at least one
  canonical fixture loaded in the real app, its detection result compared against
  the headless corpus result — validating the extractor rather than trusting it.
  Needs the GUI. It is a *check on the harness*, not the regression gate, but it is
  not optional: it is the only evidence for DD6.
- **Not used**: live-site behavior tests (operator chose a headless corpus as the
  net) and snapshot/golden-file baselines (house rule — never committed).
