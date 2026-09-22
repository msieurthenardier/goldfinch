# Flight: The In-Field Affordance

**Status**: completed
**Mission**: [Saving, Not Just Filling](../../mission.md)

> **Scope note — axes counted at drafting (Flight 2 debrief rule).** This flight
> carries **seven** unproven adversarial axes: (1) the password-field role
> discriminator a hostile page can shape; (2) capture reading the NEW password
> field on a multi-password form (today it reads the first — a wrong-value
> defect); (3) rotation disposition matched by the provenanced CURRENT password
> (a wrong-disposition surface); (4) the icon gesture, bare since M12, now
> carrying page-influenced data (a field classification and the field's password
> constraints, including a `passwordrules` string); (5) a generated secret
> crossing main → guest and gaining provenance; (6) a page-supplied `pattern`
> regex evaluated somewhere; (7) a locked-vault picker variant. Plus one
> **undiagnosed** defect (squawk 0100). It is still ONE decision cluster — *what
> the in-field element is and offers* — and the mission groups the badge with the
> generator because both change the same element. **Mitigation is the leg split**:
> the carried sheet defect lands first (its diagnosis can divert the flight), the
> capture-correctness change lands before any generator depends on it, and the
> badge (UI craft, not security) is isolated in its own leg.

## Contributing to Criteria

- [ ] A password can be generated from within the field being typed, at account
      creation and at password rotation, and the generated value survives into the
      vault through the same save path as a typed one.
- [ ] The in-field vault affordance is recognisably Goldfinch — the product mark
      and the lock state in one badge — legible at in-field size in both lock
      states, on light and dark form fields, while still carrying nothing a hostile
      page could read.
- [ ] *(held, not newly claimed)* No save offer can be raised without a genuine
      operator gesture, and page script cannot influence new-vs-update disposition
      — this flight adds a disposition path (DD4) and must keep it.
- [ ] *(held)* Zero offers on the corpus's negative set — the new sign-in-vs-sign-up
      shapes join it (DD2).
- [ ] *(held)* The exclusions that bound capture (burner, internal, subframe, no
      secret in a page DOM) hold for the generator path.
- Carried squawks: **0099** (toolbar lock has no click action) and **0100** (sheet
  menus dead in a window after closing an internal tab) — operator ruling at
  planning to fold both into this flight.

---

## Pre-Flight

### Objective

Make the injected vault element worth clicking at the two moments it is missing
today — creating an account and changing a password — and make it look like
Goldfinch. Clicking the badge on a new-password field offers "Generate strong
password" at the top of the existing picker (even while the vault is locked);
choosing it fills the new and confirm fields with a CSPRNG password that honours
the field's constraints, and the password is then offered for saving through the
ordinary capture path. On a change-password form that save is an UPDATE to the
login whose current password the operator just used — which requires fixing
capture to read the new field rather than the first. The generic padlock becomes a
Goldfinch mark with a lock-state overlay. The toolbar lock gains a click action,
and the sheet-dies-after-closing-an-internal-tab defect is found and fixed.

### Open Questions

- [x] Where is generation offered? → DD5 (a row in the picker)
- [x] How is a new-password field told apart from a sign-in field? → DD1 (layered rule)
- [x] Which site password rules are honoured? → DD6 (field attributes + `passwordrules`)
- [x] Mark in both lock states, or only once unlocked? → DD9 (both, with a lock overlay)
- [x] Offered while the vault is locked? → DD5 (yes)
- [x] Toolbar lock click semantics (squawk 0099)? → DD10
- [x] Who authors the vector mark? → DD9 (Flight Director drafts, operator approves at HAT)
- [ ] **Squawk 0100's root cause** — unknown. Leg 1 diagnoses it; see Adaptation Criteria.

### Design Decisions

**DD1 — Password-field roles by a layered, pure rule.** A new shared-by-both-worlds
pure module (`src/preload/password-field-roles.js`) assigns every password field in
a login SCOPE (its form, or the document for form-less fields) one role —
`current`, `new`, or `confirm` — or leaves the scope `sign-in`. *(Layering
amended at design review round 2 — a per-scope "first decisive layer" rule
misread a two-field current + new form as new + confirm.)* Resolution is per
FIELD first, then structure fills only what is still unresolved:
1. `autocomplete` tokens: `new-password` → new (a second `new-password` in the
   scope → `confirm`); `current-password` → current.
2. Name/id/placeholder/aria-label tokens via the existing `field-tokenizer.js`
   (`current`/`old` → current; `confirm`/`repeat`/`retype`/`verify` → confirm;
   `new` → new).
3. Structure, for the fields layers 1–2 left unresolved, consistent with what they
   resolved: three fields → current + new + confirm in document order; two fields →
   **current + new** if either resolved as `current`, otherwise **new + confirm**.
   One field → no structural signal.
4. Nothing resolved at all → `sign-in` (no generator, capture unchanged from today).
- Known limit, corpus-recorded: a two-field current + new form with NO
  autocomplete and NO tokens is indistinguishable from new + confirm; it classifies
  as new + confirm, DD3's confirm-agreement rule then plans no capture (a missed
  capture — fail-safe, never a wrong value). Committed to the corpus's
  known-unsolved tier (DD2), and counted in DD8.
- Rationale: operator ruling (layered). Autocomplete is the only authored signal;
  structure catches the common unmarked sign-up; tokens catch the rest; defaulting
  to sign-in means an unrecognised form behaves exactly as today.
- Same "one pure module, two execution contexts" discipline as
  `resolveTargetForAnchor`: the main world uses it to classify the clicked field
  (DD5) and the capture scope inside the planner (DD3a); the isolated world uses it
  only to pick the generated fill's new/confirm targets (DD7). Neither world ever
  sends the other a node.
- Trade-off: a hostile page can shape the classification. Cost bound: it can only
  make "Generate" appear or not (wrong moment); it cannot choose a value (the value
  is main-generated) or a disposition (DD4 keys on provenanced values). A page that
  mis-marks a sign-in field as `new-password` gets a Generate row the operator
  must explicitly pick.

**DD2 — Corpus first.** Before the discriminator is written, commit fixtures under
`test/fixtures/save-moment/` (manifest-tiered, per the corpus rules): sign-up with
password + confirm (unmarked), sign-up marked `new-password`, change-password
(current + new + confirm, unmarked and marked), change-password with NO username
field, single-field sign-in marked `current-password`, and the negatives — a
sign-in form whose `autocomplete` lies (`new-password` on a lone login field is
classified new but must still capture as a login and never overwrite by
disposition), a two-password-field form where the confirm differs (DD3: no offer).
Also: current + new with no confirm, marked and token-named (gated), and fully
unmarked (known-unsolved, per DD1's known limit); and a change-password form with
a read-only, server-prefilled username field the operator never typed into (DD4's
downgrade exemption).
- Rationale: mission constraint — the corpus specifies behaviour before the
  heuristic exists; shapes that resist solution are demoted, never deleted.

**DD3 — Capture reads the NEW field on a classified scope.** When the gesture's
login scope classifies with a `new` role, the planned login capture's password is
the `new` field's provenanced value, and it is admitted only if the `confirm`
field (when present) is provenanced and byte-equal to it; a mismatch plans NO
login capture (the page will reject it anyway — never save a value the site did
not accept). `sign-in` scopes capture exactly as today.
- Rationale: fixes a live wrong-value defect found at planning —
  `resolveOrdinalInFamily` step 2 returns the FIRST in-form entry, i.e. the CURRENT
  password on a change-password form, so a rotation would save the OLD password.
  This is a hard-zero failure mode and must land before any generator makes
  rotation common.
- Mechanism lives in the pure planner (`vault-capture-plan.js`'s `planLogin`),
  per the planner/actuator shape (Flight 3 debrief recommendation 4) — but the
  planner cannot see a scope today; DD3a is how it does.

**DD3a — Scope is derived INSIDE the planner; `findAllLoginFields` keeps its
per-field contract.** *(Added at design review — the Architect traced the rotation
scenario and found no path for sibling fields: `findAllLoginFields` returns one
entry per `input[type=password]`, `resolveOrdinalInFamily` still resolves a
submit-button gesture to the first in-form entry, and `planCaptures` narrows to
`entries[ordinal]` / `snapshotEntries[ordinal]` before `planLogin` runs.)*
- `resolveOrdinalInFamily` is **unchanged**: whichever in-scope entry it resolves
  is only the scope's *handle*.
- `planCaptures`' login branch passes `planLogin` the FULL `entries` and
  `snapshotEntries` arrays plus the resolved ordinal. `planLogin` widens the handle
  to its scope — every login entry with the same `.form` (non-null), or every
  form-less entry when the handle's `.form` is null — and runs
  `password-field-roles.js` over the scope's password fields. The snapshot is
  ordinal-aligned with `entries` (both enumerate `findAllLoginFields` over the same
  document; the existing mutation-race residual applies unchanged).
- A `sign-in` scope — including every one-password-field scope — plans exactly
  today's payload from the handle entry (the regression gate for Leg 2).
- A classified scope plans: `password` = the `new` field's value (DD3's
  confirm-agreement rule applied), `currentPassword` = the `current` field's value
  when present and provenanced (DD4), `username` from the handle entry as today,
  and `watchFields` = every field in the scope (so the detach watch settles on the
  whole form, not one field).
- Classification of the CAPTURE runs **main-world**, where `onCaptureGesture` and
  the planner already run (`watchFields` are main-world node references consumed by
  `armGestureDetachWatch`). The isolated world uses the same pure module only for
  DD7's fill targets.
- Main-side chain for DD4 (all mechanical, traced feasible at review): the
  existing `guest-vault-capture` payload gains an optional `currentPassword` byte
  array → `register-browser-ipc.js`'s `guest-vault-capture` handler destructures and
  forwards it (today it pulls only `username`/`usernameDetected`/`password`) →
  `holdGestureLogin` gains `currentPasswordBytes` → `captureRelease`'s
  login closure forwards it → `capture()` stores `rec.currentPassword` →
  `disposeCapture` reads it. `dropCapture`'s zeroize-every-Buffer (LD7) covers the
  new field with no edit.
- **Rejected alternative**: making `findAllLoginFields` scope-shaped. It would ripple
  into `fillLoginForm`, the MCP automation fill, the observer's `LOGIN_ROLES`, the
  gesture policy and the fill icon — none of which need scopes.

**DD4 — Rotation disposition by provenanced current-password match.** On a scope
with a `current` role whose field is provenanced, the capture additionally carries
the current value (as its own zeroized buffer). `disposeCapture` then prefers an
UPDATE to the single reachable login for this origin whose stored password equals
it byte-for-byte; zero or several matches fall back to today's origin+username rule
(never guess among several). A username, when detected, must also agree.
- Rationale: change-password forms often have no username field, so today's
  origin+username match would file the rotation as a new username-less item. The
  current password is a stronger identity than the username and is exactly what
  the operator (or a Goldfinch fill) just typed — a page cannot forge provenance on
  it.
- Wrong-disposition bar: the match reads only provenanced values. A PROVENANCED
  username, when present, must agree with the matched item's.
- **DD3c's downgrade does not apply to a password-matched update** *(amended at
  design review round 2)*: `disposeCapture` stamps `rec.matchedByPassword = true`
  when the current-password rule decides the update, and `applyUsernameDowngrade`
  returns the model unchanged for such a record. DD3c exists to protect the
  USERNAME-keyed match from an unprovenanced username; a password-keyed match does
  not read the username at all, and applying the downgrade would re-file a correct
  rotation as a duplicate whenever the form shows a read-only prefilled username
  (common on change-password pages). The username-keyed path keeps DD3c unchanged.
- Batching: the comparison reads full stored items once per distinct vault among
  the reachable rows (`listItems(vaultId)`), never once per row.
- Trade-off: one more secret rides the capture IPC and lives in the held record
  for the settle window — covered by `dropCapture`'s zeroize-every-Buffer (LD7), so
  no hygiene code changes.
- The several-matches fallback is exercised by a `disposeCapture` unit test (two
  reachable logins on one origin sharing a stored password → today's rule, never an
  update to either by guess). It is vault state, not a page shape, so it is not a
  corpus fixture.

**DD5 — "Generate strong password" is a row at the top of the existing picker.**
The icon click, bare since M12, now carries a small, validated, non-secret payload:
`{ passwordRole: 'new' | null, constraints: { minLength, maxLength, passwordRules } }`
computed main-world from the clicked field's scope (DD1). Main validates every
field (literal role, integer bounds clamped to 1–128, `passwordRules` a string
≤ 512 chars) and forwards to the chrome; a malformed payload degrades to today's
bare gesture. When `passwordRole === 'new'`, the picker shows the Generate row
first, followed by any saved logins (a sign-up page may still want an existing
login). **Locked vault**: the picker opens WITHOUT unlocking, showing the Generate
row plus an "Unlock to fill a saved login" row (the existing unlock path); a
non-`new` gesture while locked keeps today's unlock-first behaviour.
- **Generate availability is decided main-side at gesture time**: main runs the
  generator's own pure `resolvePolicy(constraints)` (DD6) on the validated
  constraints and forwards `{ canGenerate, constraints }` to the chrome; the row
  shows only when `canGenerate`. Choosing the row sends the constraints back with the
  generate request, and main **re-validates and re-resolves** them (the chrome is not
  trusted to have kept them intact) — the same function decides availability and
  generates, so the two can never disagree.
- **Locked-vault branch, one state machine** *(clarified at design review)*:
  `vault-controller.js`'s `onVaultGesture` gains one branch ahead of today's
  locked → `vault-unlock` route: locked AND `canGenerate` → open the picker with the
  Generate row plus an "Unlock to fill a saved login" row. Choosing Unlock enters the
  EXISTING `pendingVaultFlow` 'unlocking' phase exactly as today's locked gesture
  does (then continues to the full picker), so there is one unlock-then-pick entry
  point, not two. Choosing Generate needs no phase. The picker's existing
  locked-mid-pick re-prompt path is untouched: saved-login rows are simply absent
  while locked, because `reachableItems` already returns `[]` for a locked vault
  (confirmed at review, `vault-store.js`'s reachable reads).
- Rationale: operator rulings (picker row; offered while locked). Smallest new
  security surface: no new sheet template, no secret ever shown on a sheet.
- Trade-off: the operator never sees the generated password before the save offer;
  accepted — it is then saved through the normal offer and visible in the vault.
- Budget: `vault-controller.js` owns the picker; no `renderer.js` growth expected
  (`RENDERER_LINE_BUDGET` is zero-headroom at 1550). No new evaluate seam.

**DD6 — Generation honours field attributes and `passwordrules`, main-side, on
the EXISTING generator.** *(Amended at design review round 2 — the first draft
proposed a second generator.)* `src/shared/password-generator.js` (M12 F3 Leg 3,
the vault page's Generate button) already does rejection-sampled uniform selection
from `globalThis.crypto.getRandomValues`, a per-class guarantee and an unbiased
Fisher–Yates shuffle, and main can `require()` it (shared ESM, as `settings-store`
already does with `search-engines.js`). One generator, two entry points: a new pure
sibling `src/shared/password-policy.js` owns `resolvePolicy(constraints)` and the
`passwordrules` parser and produces the options the existing `generatePassword`
takes (extended only as far as a custom allowed-character set and a
`max-consecutive` rule need). Default 20 characters over the four existing classes,
at least one of each required class, clamped to `minLength`/`maxLength`. The vault
page's own Generate button is unaffected. A strict parser for the
`passwordrules` attribute (the WebKit proposal: `required`, `allowed`,
`max-consecutive`, `minlength`, `maxlength`, character classes and `[...]` custom
sets) narrows the alphabet and constraints; any parse error ignores the whole
attribute (never partially applied). Rules that cannot be satisfied (e.g. a
`maxlength` below the required-class count) degrade to the widest satisfiable
policy, never to a weak password below 8 characters — below that, the Generate
row is omitted.
- **`pattern` is evaluated in the guest, never in main** (axis 6): a page-supplied
  regex run main-side is a ReDoS vector against the browser process. The isolated
  world tests the candidate against the field's `pattern` with the `v` flag. **No
  guest→main retry channel** *(amended at design review)*: main sends TWO
  independent candidates up front in the one `vault-fill-generated` message — the
  full-policy candidate and an alphanumeric-only fallback — and the isolated world
  uses the first that matches `pattern` (or the first, when there is no `pattern`).
  If neither matches, it fills nothing (the operator types a password as today). The
  unused candidate is discarded in the isolated world. The test runs only on the
  bounded candidate (≤ 128 chars), and a `pattern` longer than 1024 chars or that
  fails to compile skips the check rather than blocking the fill.
- Rationale: operator ruling (honour `passwordrules`). Zero new runtime
  dependencies (mission constraint). Reusing the page's generator keeps one
  audited randomness path and one password style across both Generate buttons.

**DD7 — The generated value fills new + confirm through the isolated world, with
provenance.** A new `vault-fill-generated` channel carries `{ candidates: [primary, fallback], ordinal }`
to the top-frame preload, which forwards to an isolated-world `fillGenerated`
beside `fillLogin`: it resolves the clicked scope by ordinal (DD9 of Flight 3),
fills the `new` and `confirm` fields (never `current`, never a username), and
calls `grantForFill` — so the ordinary capture gesture then captures the value
exactly as it would a typed one (the mission criterion's "same save path").
- Rationale: provenance can only be granted in the isolated world (DD3g/DD3h); a
  main-world fill would produce an unprovenanced value capture refuses.
- Same main→guest plain-string delivery the existing `vault-fill` uses
  (`main.js`'s `send('vault-fill', credential)`) — no new secret class on the wire.
- The ordinal mutation-race residual (mission Known Issue) applies unchanged.
- **Hand-mirror, kept in lockstep**: the scope-widening step ("same `.form`, or all
  form-less entries") exists twice — in `planLogin` (main world, DD3a) and in
  `fillGenerated` (isolated world) — because `password-field-roles.js` classifies a
  given scope but does not derive one. Export the widening from the same pure
  module so both worlds call one function; if that proves impossible, pin the two
  with a drift-guard test (the CLAUDE.md drift-guard shape).

**DD8 — Wrong-moment budget, counted.** This flight spends it in exactly two
places, plus one counted miss: a Generate row on a mis-classified field (DD1), a
save offer after a generated fill the site then rejects (the offer still waits for settle, so a
rejected submit that does not navigate or detach raises nothing), and — a miss, not
a spend — no offer at all on a fully unmarked two-field current + new form (DD1's
known limit). No automatic
trigger is added — generation is only ever reached from a trusted badge click
(operator rejected an on-focus offer).

**DD9 — The badge is the Goldfinch mark with a lock-state overlay, in all three
icon kinds.** A hand-authored inline-SVG silhouette of the mark (derived from
`src/renderer/assets/goldfinch_color.png`, simplified for 16 px) is shown in both
lock states; a small padlock overlay in one corner carries state (closed/amber
locked, open/green unlocked). Built whole in `buildVaultLockIcon` and rebuilt whole
by `setVaultLocked` (mission constraint: never mutated in place — the
`isIconOnlyMutation` single-node rule). Still one `<svg>` root; children are
presentational shapes only.
- **The attribute-set pin does not widen**: the root's attribute keys stay exactly
  `aria-label, data-locked, focusable, height, role, viewBox, width,
  data-goldfinch-vault-lock` (`test/unit/vault-fill-icon.test.js`); the accessible
  name is unchanged per kind.
- Legible on light and dark fields via the existing light chip. Emoji and fetched
  images remain forbidden (the guest has no emoji font and must fetch nothing).
- The Flight Director drafts the SVG; the operator approves or iterates it at the
  HAT (operator ruling).

**DD10 — Toolbar lock left-click (squawk 0099).** Locked → raise the existing
`vault-unlock` sheet; unlocked → `openVaultPage()` (already injected into
`vault-controller.js`). Right-click keeps "Lock now". Keyboard activation (Enter /
Space on the focused indicator) follows the click.
- Rationale: operator ruling. Lives in `vault-controller.js` beside the existing
  `contextmenu` listener; no `renderer.js` change.

**DD11 — Squawk 0100 is diagnosed before it is fixed, in its own leg.** Reproduce
on `main`, reduce the repro (any internal tab? active only? a web tab close?), find
the stuck state, fix it, and pin it with a unit test on the Electron-free
`menu-overlay-manager.js` (or wherever the fault lies). Leg 1, because the
generator adds picker work on the same sheet.
- If the root cause is a lifecycle redesign rather than a bounded fix, **divert**
  (see Adaptation Criteria).

**DD12 — Verification apparatus.** The vault sheets (picker, capture, unlock) are
on the standing unobservable-surfaces list — automation cannot read them at any
tier — so the save-offer and picker assertions are operator-only (HAT). Automated
verification is: the corpus (DD2) and unit suites for the discriminator, planner,
generator and `passwordrules` parser, disposition, gesture-payload validation, and
the icon; the live app is exercised in the HAT. **No new behavior-test spec** — its
observables would all sit behind the unobservable sheet. Read path for each HAT
assertion: the vault page (item saved/updated), the page's own fields (filled
value length and equality between new and confirm, via DevTools), and the rendered
badge by eye.

### Prerequisites

- [x] Flight 3 landed and merged (`214a590`); squawk turnaround merged (`d0aa933`).
- [x] `node:crypto` `randomInt` available in main (Electron's Node) — no dependency.
- [x] `openVaultPage` already injected into `vault-controller.js` (0099 needs no
      new wiring).
- [ ] A running `npm run dev:automation` instance for Leg 1's 0100 reproduction and
      the HAT (the dev instance is currently shut down).

### Pre-Flight Checklist

- [x] All open questions resolved (0100's cause is diagnosed in Leg 1 by design)
- [x] Design decisions documented
- [ ] Prerequisites verified
- [x] Validation approach defined (DD12)
- [x] Legs defined

---

## In-Flight

### Technical Approach

1. **Leg 1** fixes the sheet defect (0100) and adds the toolbar lock click (0099)
   — both on the chrome/sheet surface the generator will build on.
2. **Leg 2** lands capture correctness with no user-visible feature: corpus
   fixtures, the role discriminator, planner reading the new field, confirm
   agreement, and rotation disposition. Green against today's behaviour for every
   `sign-in` scope.
3. **Leg 3** builds generation on top: the gesture payload and its validation,
   the generator + `passwordrules` parser, the picker row (incl. locked), the
   isolated-world fill with provenance, and the guest-side `pattern` check.
4. **Leg 4** redesigns the badge across the three kinds.
5. **Leg 5** HAT.

### Checkpoints

- [ ] 0100 reproduced, root-caused, fixed and pinned; lock click works in both states
- [ ] Every existing `sign-in` capture unchanged (Leg 2 regression gate)
- [ ] Corpus shapes for sign-up/rotation committed and gated; a rotation capture
      reads the NEW password and updates the matching login
- [ ] Generate row fills new + confirm on a sign-up, and the save offer follows
- [ ] Badge redesigned, attribute pin unchanged
- [ ] HAT passed

### Adaptation Criteria

**Divert if**:
- 0100's root cause is a sheet/window lifecycle redesign rather than a bounded fix
  — stop Leg 1, escalate to the operator, and re-plan (it may become its own flight).
- DD3/DD4 cannot be made hard-zero for wrong value / wrong disposition against the
  corpus — the generator must not ship on top of a capture that saves the wrong
  password.
- The vector mark cannot be made legible at 16 px in both states — escalate for a
  badge-size or design ruling rather than shipping an illegible badge.

**Acceptable variations**:
- Moving the Generate row's copy or position within the picker.
- Tightening DD1's token list, or demoting a corpus shape to known-unsolved with a
  recorded reason.
- `passwordrules` features beyond the WebKit core set dropped (the parser ignores
  unknown rules).

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and
> created one at a time as the flight progresses.

- [x] `lock-indicator-click` — toolbar lock left-click (squawk 0099, DD10). *Re-scoped
      at leg design (operator ruling 2026-09-21): planned as `sheet-and-lock-indicator`;
      squawk 0100 could not be reproduced over automation (kebab/page-context are
      unobservable surfaces) and moved to the HAT — see the flight log.*
- [x] `password-field-roles` — corpus fixtures (DD2), the role discriminator (DD1),
      scope derivation inside the planner (DD3a), capture reads the new field with
      confirm agreement (DD3), the `currentPassword` chain through
      `holdGestureLogin`/`capture` and rotation disposition by current-password match
      (DD4). Checkpoints: every `sign-in` scope unchanged; the rotation scope saves the
      NEW password as an update. *High-risk tier (capture path, disposition).*
- [x] `generate-in-picker` — gesture payload + validation, `password-policy.js`
      (`resolvePolicy` + the `passwordrules` parser) over the existing generator, picker row incl. locked, `vault-fill-generated` with
      provenance, guest-side `pattern` (DD5–DD8). *High-risk tier (new secret path).*
- [x] `goldfinch-badge` — the vector mark + lock overlay across login/card/identity
      icons, rebuilt whole, attribute pin unchanged (DD9).
- [x] `hat-and-alignment` *(optional, operator opted in)* — badge legibility (both
      states, light and dark fields, three kinds), sign-up generation to a saved
      item, rotation generation to an UPDATED item, the lock click, and a HUMAN
      reproduction + diagnosis of squawk 0100 (moved here from Leg 1; fix inline per the
      HAT protocol if bounded, else divert per DD11).

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated (CLAUDE.md Password vault pattern: roles, generator,
      badge, the gesture payload; `docs/vault.md`)

### Verification

- Unit + corpus: `npm test` green, including the new sign-up / rotation shapes and
  their negatives; the icon attribute pin unchanged.
- HAT (operator, live dev build): generate on a sign-up form and see it saved;
  generate on a change-password form and see the EXISTING login updated (not a new
  item); badge legible in both states on light and dark fields for all three
  kinds; toolbar lock click in both states; the 0100 repro no longer kills the
  sheet.
