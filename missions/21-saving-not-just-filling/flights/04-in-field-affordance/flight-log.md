# Flight Log: The In-Field Affordance

**Flight**: [The In-Field Affordance](flight.md)

## Summary

Ready (operator-approved 2026-09-21). Not yet in flight.

---

## Leg Progress

### lock-indicator-click

- Implemented squawk 0099 / DD10: a `click` listener on `els.vaultIndicator` in
  `vault-controller.js`, beside the existing `contextmenu` listener. Locked (and set up)
  → `openOverlayMenu('vault-unlock', [], null, 0)` via the `onVaultRequestUnlock` shape
  (no `pendingVaultFlow` set, so a subsequent unlock springs no picker); unlocked →
  `openVaultPage()`; not set up → no-op (defense in depth — the indicator is hidden
  then). No keydown handler needed — `#vault-indicator` is a native `<button>`, so
  Enter/Space already fire `click`.
- Extended `test/unit/vault-controller-capture.test.js`: `fakeVaultIndicatorEl` gained
  `classList`/`setAttribute` stubs (`renderVaultIndicator`, driven by `onVaultLockState`,
  touches both — needed once a test broadcasts lock state against a real fake element);
  `harness()` now records `openVaultPageCalls`. Three new tests: locked click opens the
  unlock sheet once with no `pendingVaultFlow` leak (a following unlock broadcast opens
  no picker); unlocked click opens the vault page once and no sheet; not-set-up click is
  a no-op. All three ACs plus the pre-existing contextmenu/no-DOM-harness cases pass.
- Updated `index.html`'s `#vault-indicator` comment (click semantics, no longer "the
  pick-and-fill leg") and the CLAUDE.md "Chrome indicators" Vault bullet (one-line note
  on the click semantics).
- Squawk 0100 was diagnosed in two passes before this leg was re-scoped (see the Flight
  Director Notes above) and left `open`, deferred to this flight's HAT leg — this leg's
  own scope is 0099 only, per the operator's leg-design ruling.
- `git diff --stat`: `CLAUDE.md`, `src/renderer/chrome/vault-controller.js`,
  `src/renderer/index.html`, `test/unit/vault-controller-capture.test.js` — no
  `src/renderer/renderer.js` change (`RENDERER_LINE_BUDGET` untouched).
- Results: `npm test` 5458 pass / 0 fail / 3 todo (pre-existing, unrelated); `npm run
  lint`, `npm run typecheck`, `npm run format:check` all clean. No deviation from the
  leg spec.

### password-field-roles

- **Corpus first (DD2, Implementation Guidance step 1).** Wrote `password-field-roles.js`
  (the classifier is a prerequisite of the new `plans-login`/`no-login-plan` assertion
  helpers themselves, so it had to exist before the corpus could even be written) plus its
  own 30-case unit suite (`test/unit/password-field-roles.test.js`, AC1-5, all green
  standalone), then committed the 12 new fixtures + manifest entries + `ungranted` support
  + `assertPlansLogin`/`assertNoLoginPlan` (`test/helpers/save-moment-assertions.js`) —
  all BEFORE touching `vault-capture-plan.js`. Ran `save-moment-corpus.test.js` against
  unmodified `planLogin`: 7 of the 12 new fixtures failed for the right reason (six
  positive multi-field fixtures — `change-password-three-unmarked/-marked`,
  `-no-username`, `current-new-marked`, `-token-named`, `-readonly-username` — all
  produced the CURRENT password's value, confirming flight.md's own planning finding;
  `signup-confirm-mismatch` wrongly planned a login despite the confirm disagreeing,
  since the confirm-agreement rule didn't exist yet); the two-field sign-up fixtures
  (`signup-password-confirm-unmarked`, `-new-password-marked`) and both one-field
  fixtures (`signin-current-password`, `signin-lying-new-password`) already passed
  BY COINCIDENCE — `resolveOrdinalInFamily` resolves a 2-field scope's gesture to
  ordinal 0, which happens to be the sign-up form's `new` field (first field in the
  form), so the pre-fix single-field body already returned the right value for that
  shape. 4 todo (the pre-existing 3 plus the new `current-new-fully-unmarked`
  known-unsolved fixture, itself expected-red).
- **Live defect (`webview-preload.js` snapshot shape) found while building the planner,
  not the corpus.** The first `planLogin` draft read `snapshotEntries[i]` directly as a
  field's `{detected, value}` snapshot — but `snapshotEntries[i]` is the WHOLE per-entry
  snapshot (`{username, password}`, DD3h's three-state shape); the fix reads
  `snapshotEntries[i].password`. Caught immediately by the corpus (two previously-passing
  sign-up fixtures went red — "expected a login capture to be planned, none was" — after
  the scope-widening landed but before this fix), not by a design gap; recorded here per
  the "test/find bugs, don't hide them" norm.
- **planLogin widened (DD3/DD3a).** `planCaptures`' loop now threads a third context arg
  (`{entries, snapshotEntries, ordinal}`, the login family's own full arrays) into
  `planLogin` only — `planCard`/`planIdentity` untouched, byte-identical outputs (all 16
  pre-existing `vault-capture-plan.test.js` cases pass UNMODIFIED — `git diff` on that
  file shows only added cases, AC7). A scope of ONE password field (via the new
  `loginScopeOrdinals`) takes today's body verbatim regardless of classification — proven
  by `signin-lying-new-password` (roles `['new']`, still captures as a sign-in, no
  `currentPassword`). A classified multi-field scope captures the `new` field's value,
  admits it only on confirm agreement (byte-equal, provenanced), and carries an optional
  `currentPassword` Uint8Array when a provenanced `current` role exists. Added 10 new
  `vault-capture-plan.test.js` cases (AC8/AC9/AC10) against hand-built multi-field fake
  scopes (a `loginScope(fields, opts)` helper mirroring the file's existing
  `loginEntry()`/`loginSnapshot()` style) — one required a second fix: the first
  "confirm is OPTIONAL" test used fully unmarked fake fields for a 2-field current+new
  scope, which DD1's own layer-3 default (no `current` resolved -> new+confirm) correctly
  read as new+confirm rather than current+new — not a code bug, a test-fixture omission
  (no `autocomplete` marker); fixed by marking the fields explicitly, matching the
  `current-new-marked` corpus fixture's own shape.
- **Main chain (DD3a/DD4).** `register-browser-ipc.js`'s `guest-vault-capture` handler
  forwards an optional `currentPassword` as `currentPasswordBytes`; `holdGestureLogin`
  accepts it, copies it into `rec.currentPassword`, zeroizes the incoming array on every
  path including gate refusal (AC11); `captureRelease`'s login closure copies it forward
  (the same aliasing-hazard discipline `rec.password` already follows); `capture()`
  gained the same param + gate-refusal zeroize (AC15b). `disposeCapture` tries the DD4
  current-password match FIRST (batched `listItems` per distinct vaultId, never per row),
  reassigning `rec.username` to the matched row's own normalized username on a single
  candidate (AC12 — the design-review-round-1 HIGH: without this, `captureSave`'s update
  branch would persist `username: rec.username` = null over a real stored username, silent
  corruption on every no-username-field rotation); zero/several candidates fall through to
  today's rule unchanged. `applyUsernameDowngrade` exempts `rec.matchedByPassword === true`
  FIRST, before its own checks (AC13). A shared `zeroizeCurrentPassword(rec)` helper is
  called at exactly the two AC15 sites (`capture()`'s unlocked branch,
  `captureFinalize`'s login dispatch).
- **AC14 test-design finding.** The literal AC14(d) scenario as first written (a stored
  row with a NAMED username, e.g. `'alice'`) does NOT actually exercise the
  `matchedByPassword` exemption — `disposeCapture`'s own `rec.username` reassignment
  already makes it non-null, which alone satisfies `applyUsernameDowngrade`'s ordinary
  null-check regardless of the exemption. Confirmed by neuter check 3 initially staying
  GREEN against that test. The exemption is load-bearing only when the MATCHED ROW's own
  stored username is null (a genuinely username-less stored login) AND the capture's
  username field was merely detected, not provenanced — split into two tests, AC14(d)
  (null-username row — neuter-sensitive) and AC14(d)b (named row — the reassignment alone
  suffices, kept as a second, weaker-but-still-useful case).
- **Corpus regression note.** Building the corpus fixtures required one further scan of
  `field-tokenizer.js`'s token vocabulary (`confirm`/`confirmation`/`repeat`/`retype`/
  `verify`/`again`, `current`/`old`/`existing`) to keep sign-up fixture field names
  (`password`/`password2`/`password3`) genuinely token-free where the fixture's own intent
  was to exercise DD1's structural layer 3, not layers 1-2 — no code change, a fixture-
  authoring discipline note only.
- **Lint fallout.** `password-field-roles.js` needed an explicit entry in
  `eslint.config.mjs`'s CJS-preload-module `files` list (no `src/preload/**` wildcard, per
  that block's own documented lesson) — added alongside `vault-capture-plan.js`'s own
  entry. Two `no-useless-assignment` findings (a `let x = null; try { x = ... } catch { x =
  null; }` shape in the classifier, copied defensively from an earlier draft) were
  simplified to plain `const` assignments once the try/catch was found unnecessary
  (`fieldHaystack`/`getAttribute` access is already null-safe via optional chaining and
  `typeof` guards — nothing in the classifier's own inputs can throw on a well-formed or
  bare fake field). One `no-unused-vars` in a new test helper's `.map((f, i) => …)`.
- **TypeScript fallout.** `vault-human.js` carries a STALE, ORPHANED docblock immediately
  above `disposeCapture`'s own (two back-to-back `/** */` blocks before `capture()`'s
  actual, later docblock) — not touched, since `tsc` associates a JSDoc block with the
  NEXT following statement and two consecutive blocks leave the first one dangling
  (confirmed: it was already stale — missing `usernameDetected`/`origin`/`jar` — before
  this leg, with no prior typecheck failure). The REAL docblock (`capture()`'s own, ~30
  lines further down) needed `currentPasswordBytes` added to its `@param` type; without
  it, `tsc` flagged both the new property access inside `capture()` and the new object
  literal key in `captureRelease`'s login closure as excess/unknown properties.
- **Neuter checks** (all applied via a saved pre-edit backup, verified red, then reverted
  byte-identical to the backup):
  1. `planLogin` returns the handle entry's own password on a classified scope (instead of
     the `new` field's) → `change-password-three-unmarked`/`-marked` both went red
     ("planned login password did not match expectPassword", actual = the current
     password). Reverted; both green again.
  2. The confirm-equality check removed → `signup-confirm-mismatch` went red ("expected no
     login capture to be planned, one was"). Reverted; green again.
  3. The `matchedByPassword` exemption removed from `applyUsernameDowngrade` → AC14(d)
     (the null-username-row variant, per the test-design finding above) went red
     (`'save' !== 'update'`); AC14(d)b (named-row variant) stayed green, confirming it does
     NOT exercise the exemption on its own. Reverted; both green again.
- **Docs.** CLAUDE.md's Password vault pattern gained a new bullet (module, three layers,
  the `sign-in`/`classified`/`ambiguous` kinds, the DD3a scope-widening + DD3
  confirm-agreement rule, and DD4's disposition + `matchedByPassword` exemption) plus a
  cross-reference from the pre-existing DD3c bullet's neighbourhood. `docs/vault.md` gained
  a new "Password-field roles" subsection (operator terms) after "The save moment" section,
  plus a module-layout table row.
- `git diff --stat` (this leg only; Leg 1's `vault-controller.js`/`index.html` changes are
  pre-existing and untouched): `CLAUDE.md`, `docs/vault.md`, `eslint.config.mjs`,
  `src/main/register-browser-ipc.js`, `src/main/vault/vault-human.js`,
  `src/preload/vault-capture-plan.js` (modified); `test/fixtures/save-moment/manifest.js`,
  `test/helpers/save-moment-assertions.js`, `test/unit/register-browser-ipc.test.js`,
  `test/unit/save-moment-corpus.test.js`, `test/unit/vault-capture-drop-safety.test.js`,
  `test/unit/vault-capture-plan.test.js`, `test/unit/vault-capture.test.js`,
  `test/unit/vault-gesture-capture.test.js` (modified, added cases); NEW:
  `src/preload/password-field-roles.js`, `test/unit/password-field-roles.test.js`,
  `test/fixtures/save-moment/password-roles/*.html` (10 files),
  `test/fixtures/save-moment/negative-gesture/signup-confirm-mismatch.html`,
  `test/fixtures/save-moment/known-unsolved/current-new-fully-unmarked.html`. No
  `src/renderer/renderer.js` change (`RENDERER_LINE_BUDGET` untouched); no
  `vault-controller.js` change (Leg 1's uncommitted diff is unaffected).
- **Deviation from the leg spec**: `eslint.config.mjs` is not listed in the leg's "Files
  Affected", but a new CJS preload module requires an entry in its explicit files list
  (no `src/preload/**` wildcard) — a mechanical consequence of adding the module, not a
  design change.
- Results: `npm test` 5531 tests / 5527 pass / 0 fail / 4 todo (3 pre-existing + this
  leg's own `current-new-fully-unmarked`); `npm run lint`, `npm run typecheck`, `npm run
  format:check` all clean.

### generate-in-picker

- **Implemented per Implementation Guidance order** (policy+generator → gesture payload
  → main validation → picker/dispatch/controller → bridge+main handler+vault-human →
  isolated-world fill → e2e test + neuter checks + docs).
- **NEW `src/shared/password-policy.js`** (pure ESM): `sanitizeGenerateConstraints`
  (the `-1`/absent-unset, 1-128 clamp, ≤512-char `passwordRules`, unknown-keys-ignored
  rules), a WebKit-`passwordrules`-core `parsePasswordRules` (top-level-comma class
  lists respecting one level of `[...]` nesting, the literal `special` char set, `unicode`
  aliased to `ascii-printable`, ANY syntax error voids the whole attribute), `resolvePolicy`
  (defaults / rules-narrowed alphabet+required-sets / a hard 128 max source folded in
  always / degrade-to-attributes-only-on-unsatisfiable-rules per DD6), and
  `generateCandidates` (primary + an alnum-only fallback, dropped when identical).
- **`password-generator.js` extended additively**: an explicit `requiredSets` array on
  `generatePassword`'s opts routes to a new `generateFromPolicy` (one char per required
  set + the rest from `alphabet`, `maxConsecutive` enforced by a bounded (100) full
  redraw). Every pre-existing call shape (absent `requiredSets`) is byte-identical —
  confirmed by the full pre-existing `password-generator.test.js` suite passing
  unmodified.
- **`password-field-roles.js`** gained `generateGestureInfo(entries, ordinal)`: widens
  to the handle's scope, classifies it, and — only on a `classified` scope with a `new`
  role — reads `minlength`/`maxlength`/`passwordrules` off the scope's OWN `new` field
  (never the clicked field, when they differ — e.g. clicking the confirm field's icon).
  Never reads `.value`.
- **`vault-fill-icon.js`'s `onIconClick`** now sends `{ generate: generateGestureInfo(...) }`
  whenever the resolved target is `kind:'login'` and its ordinal resolves — including a
  `sign-in` classification (`passwordRole: null`), which one PRE-EXISTING test's literal
  payload assertion depended on being bare `{}`; that one assertion was updated (see
  Deviation below) rather than left broken, since AC7's formula is unconditional on
  `target.kind==='login'`, not on the classification outcome. Card/identity/unresolved
  gestures stay bare `{}`, unchanged.
- **`register-browser-ipc.js`'s `guest-vault-gesture` handler** gained
  `validateGenerateGesture`: literal `passwordRole==='new'` + `sanitizeGenerateConstraints`
  + `resolvePolicy(...).ok` → forwards `{wcId, generate:{canGenerate, constraints}}`;
  anything else degrades to today's bare `{wcId}`.
- **`vault-picker-template.js`**: `GENERATE_ID`/`UNLOCK_ID` fixed ids, action-row
  rendering (branches before `kindOf`/section derivation, no `data-pick-index`, pushed
  into the roving `buttons` array in array order — chrome always prepends them so
  visual order is roving order with no extra bookkeeping), the empty-note-vs-unlock-row
  coexistence rule, and the `activationIdFor(dataset)` dispatch chokepoint (AC9b) —
  `menu-overlay.js`'s `renderPicker` click handler now calls it instead of its old
  binary pick-index-or-`MANAGE_ID` rule.
- **`vault-controller.js`**: `pendingVaultFlow` gained an optional `generate` field;
  `openVaultPicker(wcId, generate?)` prepends `{action:'generate'}` when
  `generate?.canGenerate`; `onVaultGesture` gained the locked+canGenerate branch (Generate
  + Unlock rows, NO `vaultReachableItems` call at all) ahead of today's locked-unlock
  branch; the `onVaultLockState` continuation now threads `pendingVaultFlow.generate`
  through to the re-opened picker; `handleActivation`'s `vault-picker` branch gained
  `GENERATE_ID` (dispatches `vaultFillGenerated`, clears the flow, no sheet on
  `{filled:false}`) and `UNLOCK_ID` (enters the SAME `'unlocking'` phase today's locked
  gesture uses) branches.
- **`chrome-preload.js`/`renderer-globals.d.ts`**: new `vaultFillGenerated` bridge
  method + `onVaultGesture`'s payload type widened for `generate`.
- **`main.js`**: `ipcMain.handle('vault-fill-generated', …)` — the FD-ruled STRICTER
  owner check (`registry.getWindowForChrome(event.sender) === registry.getWindowForGuest(wcId)`,
  reimplemented inline since `register-tab-ipc.js`'s `ownsTab` is closure-local),
  re-`sanitizeGenerateConstraints` + re-`generateCandidates` (never trusting the
  chrome's earlier `canGenerate`), then `getVaultHuman().fillGenerated(...)`. The
  `fillGeneratedDelegate` is wired ONLY into the HUMAN `getVaultHuman()` deps block
  (~line 1368 region) — confirmed absent from the MCP automation vault-human deps block
  (~1525 region) by grep — so generation is not reachable from the MCP surface.
- **`vault-human.js`** gained `fillGenerated({wcId, candidates})`: gates set-up +
  persistent jar + non-null origin (NOT unlocked, per DD5), empty/non-array candidates →
  `'unsatisfiable'`, an omitted delegate → `'ineligible'` rather than throwing; success
  calls `fillGeneratedDelegate` and returns `{filled:true}` only — never a candidate.
- **`vault-fill-fields.js`** gained `fillGeneratedForm(doc, candidates, ordinal)` (+ the
  private `selectGeneratedCandidate` pattern-matcher): top-frame only; a
  null/non-integer/out-of-range ordinal fills NOTHING (no first-field fallback, an FD
  ruling beyond the flight spec, recorded in the flight log's Leg 3 design entry);
  widens via `loginScopeOrdinals` + `classifyPasswordScope` (imported, not
  hand-mirrored); `pattern` tested ONLY here (`new RegExp('^(?:'+pattern+')$', 'v')`,
  guarded on length ≤1024 + try/catch, Electron 44's `v` flag confirmed present under
  plain Node 22 too); fills `new` (+ `confirm` when present) via `setFieldValue`, never
  `current`/username; returns `{filled, fields}` for `observer.grantForFill`.
- **`vault-entry-observer-bootstrap.js`/`vault-entry-tracker.js`/`webview-preload.js`**
  gained the `fillGenerated` method / `runFill` router / `vault-fill-generated`
  `ipcRenderer.on` listener, mirroring `fillLogin`'s three-file shape exactly.
- **Bundles**: `npm run build:preload` succeeds; `vault-entry-observer-bundle.generated.js`
  confirmed (grep) to contain `fillGeneratedForm`/`selectGeneratedCandidate`/
  `loginScopeOrdinals`/`classifyPasswordScope`; `webview-preload.bundle.js` confirmed to
  contain `generateGestureInfo` (via `vault-fill-icon.js`'s require). No new runtime
  dependency.
- **AC16 end-to-end test** (`test/unit/vault-fill-generated-e2e.test.js`, new): drives
  `fillGeneratedForm`'s real output through the real `createEntryObserver`'s
  `grantForFill`, resolves the fixture's own submit button via the real
  `resolveGestureTargets`, and runs the real `planCaptures` — on
  `password-roles/signup-new-password-marked.html` (generated value survives, no
  `currentPassword`) and `password-roles/change-password-three-marked.html` (generated
  value survives ALONGSIDE a granted `currentPassword`, provenanced via `observer._grant`
  standing in for "the operator typed the current password" — the
  `planSignupEmailAsUsernameFixture` idiom from `vault-capture-plan.test.js`). No
  mechanism shortcuts: the resolver/planner chain is never reimplemented.
- **Neuter checks** (each applied via a saved pre-edit backup, confirmed red, then
  reverted byte-identical to the backup — diffed to confirm):
  1. `fillGeneratedForm` falls back to ordinal 0 on an invalid ordinal → the stale/null
     ordinal test (`vault-fill-generated-form.test.js`) went red (expected `filled:false`,
     got a fill). Reverted; green again.
  2. `fillGeneratedForm` also fills the scope's `current` field → the change-password
     test's "current stays untouched" assertion went red. Reverted; green again.
  3. `register-browser-ipc.js`'s `guest-vault-gesture` handler forwards the guest's raw,
     unvalidated `generate` sub-payload → 5 of the 6 `AC8:` tests in
     `register-browser-ipc.test.js` went red (a malformed/wrong-role payload no longer
     degraded to the bare shape). Reverted; all 32 tests green again.
- **Deviation from the leg spec's "every existing `vault-fill-icon` test passes"
  (AC7)**: one pre-existing test's literal payload assertion (`click: a trusted gesture
  sends the BARE guest-vault-gesture IPC…`) asserted `sends[0].payload` deep-equals `{}`
  for a login gesture on an unmarked, unclassified single password field. AC7's formula
  wraps the payload in `{ generate: ... }` whenever the resolved target is
  `kind:'login'` and the ordinal resolves — UNCONDITIONALLY on the classification
  outcome, not only when `passwordRole==='new'` — so this sign-in-classified scenario now
  sends `{ generate: { passwordRole: null, constraints: null } }` rather than a bare
  `{}`. This is the correct, unavoidable consequence of AC7's literal spec (AC8's
  degrade-to-bare happens ONE HOP LATER, in main, not in the preload's own outgoing IPC)
  — the assertion was updated to the new payload shape and renamed; every OTHER existing
  test in the file (channel name, `consumeFillTarget` binding, DD5 precedence, identity
  anchor binding) is unchanged. No other file's pre-existing assertions needed updates.
- **Deviation**: `eslint.config.mjs` was NOT touched this leg — `password-policy.js` is a
  real ESM `src/shared/` module (the existing wildcard/module rule already covers it),
  and every new preload module (`vault-fill-fields.js`, `password-field-roles.js`) was
  already an existing CJS entry before this leg.
- **Squawk candidate logged per the leg's FD ruling** (not filed as a numbered squawk in
  this leg — recorded here for flight-end triage): retrofit the `ownsTab`-shaped owner
  check onto `vault-fill-human` / `vault-reachable-items` in `main.js`, which currently
  trust any chrome sender's wcId claim without an ownership check, unlike the new
  `vault-fill-generated` handler.
- Results: `timeout 600 npm test` → 5631 tests, 5627 pass, 0 fail, 4 todo (3
  pre-existing + Leg 2's `current-new-fully-unmarked`); `npm run lint`, `npm run
  typecheck`, `npm run format:check` all clean; `npm run build:preload` succeeds.
- `git diff --stat` (this leg only — Legs 1-2's changes are pre-existing and untouched):
  modified `CLAUDE.md`, `docs/vault.md`, `src/main/main.js`, `src/main/register-browser-ipc.js`,
  `src/main/vault/vault-human.js`, `src/preload/chrome-preload.js`,
  `src/preload/password-field-roles.js`, `src/preload/vault-entry-observer-bootstrap.js`,
  `src/preload/vault-entry-tracker.js`, `src/preload/vault-fill-fields.js`,
  `src/preload/vault-fill-icon.js`, `src/preload/webview-preload.js`,
  `src/renderer/chrome/vault-controller.js`, `src/renderer/menu-overlay.js`,
  `src/renderer/renderer-globals.d.ts`, `src/shared/password-generator.js`,
  `src/shared/vault-picker-template.js`, `test/unit/password-generator.test.js`,
  `test/unit/register-browser-ipc.test.js`, `test/unit/vault-fill-icon.test.js`,
  `test/unit/vault-human.test.js`, `test/unit/vault-picker-template.test.js`; NEW
  `src/shared/password-policy.js`, `test/unit/password-policy.test.js`,
  `test/unit/vault-controller-generate.test.js`, `test/unit/vault-fill-generated-e2e.test.js`,
  `test/unit/vault-fill-generated-form.test.js`. No `src/renderer/renderer.js` change
  (`RENDERER_LINE_BUDGET`/`SEAM_COUNT` both untouched, confirmed by
  `seam-contract.test.js` passing). No MCP automation surface exposure (grep-confirmed
  no `password-policy`/`vaultFillGenerated`/`generateCandidates` reference anywhere
  under `src/main/automation/`).

### goldfinch-badge

- Rewrote `buildVaultLockIcon` (`src/preload/vault-fill-icon.js`) per the flight DD9 /
  leg FD draft: the root `<svg>` attribute block is untouched byte-for-byte; the eight
  children are now the Goldfinch mark (disc, cap, mask, beak, eye — IDENTICAL between
  locked and unlocked builds) plus a lock-state overlay (a white backing circle, a
  `currentColor` shackle whose path differs by lock state, and a `currentColor` lock
  body). All built via `createElementNS` + `setAttribute`, no `innerHTML`/`<image>`/
  `<use href>`/emoji/inline `style`. `createIcon`'s chip styling (`s.width`/`height`
  16px, near-white background, `currentColor` via `s.color`) is unchanged — the FD
  draft's overlay proportions (r=5.6 backing, 1.5 stroke-width, enlarged from its first
  iteration) were judged legible at 16px without a chip tweak (AC6 N/A).
- Re-targeted the shackle test (`buildVaultLockIcon: locked vs unlocked glyph + label +
  marker` → `buildVaultLockIcon: overlay shackle carries lock state (AC3, renamed from
  the old first-path shackle test)`): the shackle is now located by `stroke ===
  'currentColor'`, not "the first `path`" (that's the bird's cap). Closed/open
  assertions kept their intent, retargeted from `…V11`/no-`…V11` to the new
  coordinates `…V17.6`/no-`…V17.6`.
- Added three new tests per AC1/AC4/AC7: (1) every child of every kind/lock-state build
  carries only the allowed geometry/paint attribute set, is one of `circle`/`path`/
  `rect`, and has no `href`/`xlink:href`/`style`/text content; (2) the five mark
  children (disc/cap/mask/beak/eye) serialize byte-identically between a locked and an
  unlocked build (with a non-vacuous sanity check that the overlay's shackle *does*
  differ); (3) all three kinds (`login`/`card`/`identity`) in both lock states produce
  the exact structural child-tag list `circle, path, path, path, circle, circle, path,
  rect`.
- The two pre-existing attribute-set pin tests (`the icon is decorative: it holds no
  credential value or text a hostile page could read` at ~line 375 and `AC13/AC14: the
  identity icon carries no extra attribute` at ~line 588) are UNMODIFIED —
  `git diff` on the assertion blocks confirms no touched lines.
- Updated the module header comment and `buildVaultLockIcon`'s JSDoc to describe the
  mark + overlay shape (glyph rationale, per-shape breakdown, the "no `style`
  attribute" note from the leg's edge-cases section). Added a one-line "In-field badge"
  bullet to CLAUDE.md's Password vault pattern (between "Sheet family" and "Payment
  cards"). `docs/vault.md` was checked and does not describe the icon's visual
  appearance anywhere (only its click/gesture behavior), so no doc-text change was
  needed there per AC9's conditional.
- **Legibility (optional check, done outside the Reviewer/HAT gate):** rendered the
  REAL `buildVaultLockIcon` (via a fake tree-tracking `document`, requiring the actual
  module — not a re-typed copy) offscreen at 16/32/96px on white and `#1e1e1e` fields,
  both lock states, login kind, in a scratch-only Electron script
  (`/tmp/.../scratchpad/badge/render-final.js`, never committed). At 16px the disc,
  cap, mask and beak read as a bird silhouette and the amber/green overlay corner is
  clearly distinguishable in both states on both fields; final HAT judgment (DD12) is
  still pending per the leg's own instructions — this was a Developer sanity check,
  not a substitute for it.
- Known limits carried forward per the leg's Edge Cases section (not addressed, as
  specified): author CSS targeting `svg path`/`circle`/`rect` can still override the
  fixed `fill`/`stroke` presentation attributes (same exposure as before this leg,
  not a regression); forced-colors/high-contrast mode may override the fixed fills
  while the accessible name still carries state (accepted).
- `git diff --stat` (this leg only): modified `CLAUDE.md`,
  `src/preload/vault-fill-icon.js`, `test/unit/vault-fill-icon.test.js`. No other
  files touched.
- Results: `timeout 600 npm test` → 5634 tests, 5630 pass, 0 fail, 4 todo
  (pre-existing, unrelated to this leg); `npm run lint`, `npm run typecheck`, `npm run
  format:check` all clean; `npm run build:preload` succeeds. No deviation from the leg
  spec; no `src/renderer/renderer.js` change (line budget/seam count both untouched).

---

## Flight Director Notes

### Planning (2026-09-21)

- Operator rulings at planning: fold squawks 0099 and 0100 into this flight;
  generator as a picker row, offered while locked; layered new-password rule;
  honour `passwordrules`; badge = mark in both states + lock overlay, drafted by the
  Flight Director and approved at HAT; toolbar lock click locked→unlock,
  unlocked→vault page; include a HAT leg.
- Planning-time finding (drove DD3): `resolveOrdinalInFamily` step 2 resolves a
  change-password form's gesture to the FIRST in-form login entry — the current
  password field — so today a rotation would save the OLD password.
- **Design review, round 1** (Architect): approve with changes. HIGH — DD3/DD4 had
  no path for sibling password fields into the per-field pipeline (traced:
  `findAllLoginFields` per-field, `planCaptures` narrows to one ordinal,
  `holdGestureLogin` has no current-password slot). Resolved by new **DD3a**: scope
  derived inside the planner from the full arrays; `findAllLoginFields` contract
  kept (the scope-shaped alternative rejected for its consumer ripple). MEDIUMs
  resolved: two candidates up front instead of a guest→main retry channel (DD6/DD7);
  `resolvePolicy` decides Generate availability and is re-run on pick (DD5); the
  locked branch reuses the existing `pendingVaultFlow` unlock phase (DD5). Added a
  `disposeCapture` unit test for the several-matches fallback (DD4).
- **Design review, round 2** (Architect): approve with changes; applied without a
  third round (the two-cycle cap, all fixes clear). MEDIUM — DD3c's downgrade would
  undo a password-matched rotation update when the form shows a read-only prefilled
  username → `rec.matchedByPassword` exempts it (DD4). MEDIUM — the per-scope
  layering misread a two-field current + new form → per-field resolution, then
  structure (DD1); the fully unmarked shape is known-unsolved and counted in DD8.
  LOW — wrong channel name → the existing `guest-vault-capture` plus its handler's
  forwarding (DD3a). LOW — a second generator → extend the existing
  `src/shared/password-generator.js` via a new `password-policy.js` (DD6). The
  scope-widening hand-mirror is now named with a one-function-or-drift-guard rule (DD7).
- **Approved** by the operator 2026-09-21; status → `ready`. Open prerequisite: a
  running `npm run dev:automation` for Leg 1's 0100 reproduction and the HAT.

### Flight start + Leg 1 design (2026-09-21)

- Phase file `.flightops/agent-crews/leg-execution.md` loaded (valid structure). Flight
  status `ready` → `in-flight`; branch `flight/04-in-field-affordance` created.
- **0100 diagnosis, pass 1** (Developer, diagnosis only): reported a "deterministic repro"
  (the first sheet open on a viewless welcome tab, home page unset), based on blank
  `captureWindow` output for the kebab. Side finding (unconfirmed): the vault page's
  `internal-vault-request-unlock`/`-setup` relay (`register-browser-ipc.js`,
  `chromeForTab(event.sender.id)`) is multi-hop and async, so it can land its sheet open
  on a different tab when the requesting tab closes mid-flight.
- **0100 diagnosis, pass 2** (Developer, instrumented spike, fully reverted): **refuted**
  pass 1. `captureWindow`/`readDom` omit every non-allowlisted sheet menuType by design,
  so a blank kebab capture is a redaction, not a paint failure. The instrumented chain was
  healthy in every variant: slot bounds `{1,119,1398,780}` applied before `addChildView`,
  sheet `innerWidth/innerHeight` 1398×780, and site-info painting on the same sheet,
  including after closing a `goldfinch://vault` tab. A stale "Secrets" tab-strip entry was
  seen once after an internal-tab close (unconfirmed, possibly a test artifact). Worth a
  look at the HAT.
- **Decision (operator ruling):** 0100 moves to the HAT for a human reproduction. Leg 1
  is re-scoped to 0099 alone and renamed `lock-indicator-click` (the leg was never
  `in-flight`, so no immutability issue). DD11's divert gate now applies at the HAT.
- **Risk tier: LOW.** Additive, single-surface work (one click listener in
  `vault-controller.js` beside an existing listener) that follows established patterns
  (`onVaultRequestUnlock`'s open shape). It touches no schema, interface, lifecycle,
  cache or security surface: the click opens existing sheets through existing funnels.
  Design review skipped; the flight-end Reviewer covers the code.

### Flight start + Leg 1 design (2026-09-21)

- Phase file `.flightops/agent-crews/leg-execution.md` loaded (valid structure). Flight
  status `ready` → `in-flight`; branch `flight/04-in-field-affordance` created.
- **0100 diagnosis, pass 1** (Developer, diagnosis only): reported a "deterministic repro"
  (the first sheet open on a viewless welcome tab, home page unset), based on blank
  `captureWindow` output for the kebab. Side finding (unconfirmed): the vault page's
  `internal-vault-request-unlock`/`-setup` relay (`register-browser-ipc.js`,
  `chromeForTab(event.sender.id)`) is multi-hop and async, so it can land its sheet open
  on a different tab when the requesting tab closes mid-flight.
- **0100 diagnosis, pass 2** (Developer, instrumented spike, fully reverted): **refuted**
  pass 1. `captureWindow`/`readDom` omit every non-allowlisted sheet menuType by design,
  so a blank kebab capture is a redaction, not a paint failure. The instrumented chain was
  healthy in every variant: slot bounds `{1,119,1398,780}` applied before `addChildView`,
  sheet `innerWidth/innerHeight` 1398×780, and site-info painting on the same sheet,
  including after closing a `goldfinch://vault` tab. A stale "Secrets" tab-strip entry was
  seen once after an internal-tab close (unconfirmed, possibly a test artifact). Worth a
  look at the HAT.
- **Decision (operator ruling):** 0100 moves to the HAT for a human reproduction. Leg 1
  is re-scoped to 0099 alone and renamed `lock-indicator-click` (the leg was never
  `in-flight`, so no immutability issue). DD11's divert gate now applies at the HAT.
- **Risk tier: LOW.** Additive, single-surface work (one click listener in
  `vault-controller.js` beside an existing listener) that follows established patterns
  (`onVaultRequestUnlock`'s open shape). It touches no schema, interface, lifecycle,
  cache or security surface: the click opens existing sheets through existing funnels.
  Design review skipped; the flight-end Reviewer covers the code.
- **Leg 1 landed** (Developer): FD spot-checked the `vault-controller.js` diff against the
  spec, and it matches. legs_completed 1 of 5. Held uncommitted until the flight-end
  review and commit (Phase 2d). Next is Leg 2 `password-field-roles` (high-risk tier,
  per-leg design review).
- **Leg 2 design** (`password-field-roles`), drafted 2026-09-22. **Risk tier: HIGH**: the
  capture path, the disposition, a new secret on the capture IPC, and a behaviour change
  on the planner shared by every login capture. Per-leg design review follows.
- **Leg 2 design review, round 1** (Developer): approve with changes. **HIGH**
  (FD-verified against `captureSave`'s update branch): a password-matched rotation with
  no username field would persist `username: rec.username` (null) over the stored login's
  username, which is silent vault corruption. Fixed: AC12 now reassigns `rec.username`,
  and AC14(g) adds a `captureSave`-level persistence test. Suggestions applied: AC15 names
  its two sites, AC15b covers `capture()`'s gate-refusal zeroize, the flat-name (`newpass`)
  limit is documented, and a comment covers the handle's username. The review confirmed
  AC7's regression gate is reachable (no existing test has two password fields in one
  scope), the fixture extractor supports every needed attribute, and the store signatures
  match. **No second round**: the fixes are targeted additions to ACs, not a design
  change. Leg status → `ready`.
- **Leg 2 landed** (Developer). The FD spot-checked the `disposeCapture` password-match
  block (the `rec.username` reassignment is present, per the round-1 HIGH) and
  `planLogin`'s one-field regression path and multi-field gate, and both match the spec.
  An FD-run `npm test` gave 5531 tests: 5527 pass, 0 fail, 4 todo. The Developer
  reported one unnamed single-test failure across five runs that did not recur. It is
  treated as a flake, and the flight-end Reviewer should watch for it. Noted deviation:
  `eslint.config.mjs` gained the new CJS preload module (mechanical). The neuter check for
  the `matchedByPassword` exemption exposed a vacuous AC14(d), rewritten against a
  null-username stored row, which is the exemption's load-bearing case. Good catch;
  recorded as a planning lesson for the debrief: a named "downgrade survives" test must
  use a row the ordinary null check would actually downgrade. legs_completed 2 of 5.
  Next: Leg 3 `generate-in-picker` (high-risk).
- **Leg 3 design** (`generate-in-picker`), drafted 2026-09-22. **Risk tier: HIGH** (a new
  secret path main → guest, a page-influenced gesture payload, the locked-vault picker
  state machine). Per-leg design review follows. One FD call beyond the flight spec,
  recorded here: the generated fill has NO first-field fallback on a stale or null
  ordinal (the existing login fill does). Rationale: a generated password filled into
  the wrong form is worse than no fill. DD7's scope-widening hand-mirror is resolved by
  both worlds calling Leg 2's exported `loginScopeOrdinals`, so no drift guard is needed.
- **Leg 3 design review, round 1** (Developer): approve with changes. **HIGH**
  (FD-verified at `menu-overlay.js`'s `renderPicker`): the picker's click dispatch maps
  any row without `data-pick-index` to `MANAGE_ID`, so both new action rows would have
  navigated to the vault page. Fixed with new AC9b (`data-action-id` checked first, only
  the two exported ids honoured), and `menu-overlay.js` added to Files Affected and step
  4. MEDIUM: action rows must branch before `kindOf`/section derivation and join the
  roving `buttons` array (AC9 amended, plus the empty-note coexistence test). LOWs
  applied: the AC7 ordinal derivation, the explicit line 441 continuation change, the
  `pendingVaultFlow` JSDoc type, and the attribute-read guard style. **FD ruling:** the
  owner-window check on `vault-fill-generated` stays, and is deliberately stricter than
  `vault-fill-human`/`vault-reachable-items` (a guest write from chrome-supplied input).
  **Squawk candidate** (log at flight end, out of scope here): retrofit the same owner
  check onto those two older handles. **No second round**: the fixes add targeted
  requirements at already-identified sites and do not change the design. The review
  also confirmed the `v` regex flag (Electron 44), the observer-bundle reachability,
  `globalThis.crypto` in main, the two distinct `fillDelegate` blocks, and every
  citation. Leg status → `ready`.
- **Leg 4 design** (`goldfinch-badge`), drafted 2026-09-22 while Leg 3 was implementing
  (an artifact only, so no code overlap). The FD drafted the SVG per DD9 and rendered it
  with the repo's Electron offscreen at 16/32/96 px on light and dark fields: it reads
  as the mark, and the overlay's colour and shackle carry state. The PNG stays in the
  scratchpad and is not committed. **Risk tier: LOW** (one pure builder, security pins
  unchanged). No design review. The leg runs after Leg 3 lands, because both touch
  `vault-fill-icon.js`. Status `ready`.
- **Leg 3 landed** (Developer). FD spot-checks passed: the `vault-fill-generated` handle
  refuses a sender that is not the owning window's chrome, and `fillGeneratedForm` has
  no first-field fallback and writes only new and confirm. Reported: 5631 tests, 0 fail;
  bundles build; nothing generation-related under `src/main/automation/`. Accepted
  deviation: a sign-in-classified login gesture now sends
  `{ generate: { passwordRole: null, … } }` rather than `{}`. Main's validation
  degrades any non-`'new'` role to the bare forward, so it is behaviourally identical at
  the chrome. legs_completed 3 of 5. Next: Leg 4 `goldfinch-badge` (low risk, no design
  review).
- **Leg 4 landed** (Developer): the Goldfinch mark plus lock overlay, root attribute
  pins untouched in the diff, the mark identical across states. 5634 tests, 0 fail;
  the preload bundle builds. legs_completed 4 of 5 (the autonomous legs are done).
  Phase 2d: a flight-end Reviewer over all uncommitted changes (Legs 1–4). Leg 5 (HAT,
  interactive) follows the commit. HAT leg artifact written (`05-hat-and-alignment.md`,
  `ready`).
- **Phase 2d review** (Reviewer, flight-end, Legs 1–4): **[HANDOFF:confirmed]** in one
  cycle, no blocking or non-blocking code issues. It independently ran and passed:
  `npm test` 5634 (5630 pass, 0 fail, 4 todo), lint, typecheck, format:check,
  `build:preload`. It verified 17 security-sensitive points, including wrong-value /
  wrong-disposition, currentPassword zeroization on every path, generated-password
  containment (never in the chrome, a sheet, logs or MCP), the owner check, the
  no-fallback ordinal, `pattern` evaluated only in the guest, the strictness of the
  `passwordrules` parser, CSPRNG use, the picker dispatch, and the badge pins. Legs 1–4
  → `completed`. Squawk 0099 → `in-progress` (its fix is committed; it completes at HAT
  step 3). Committing, then opening a draft PR, then Leg 5 HAT.

### Leg 5 HAT: session notes (2026-09-22)

- Setup: the dev app via `GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`; fixtures
  served on `http://127.0.0.1:8765/` (`test/fixtures/save-moment`).
- **Step 1 (badge, locked) FAIL.** The operator found the round badge hard to read.
  Operator request: make it a toggle-switch pill, with the goldfinch as the knob, the
  lock to the left in the darkened track, and no border. First, build a page showing
  only the icon, in several versions, so one can be picked. **FD call: a look-and-feel
  FIX, not a feature.** It is a single surface (the `buildVaultLockIcon` shape plus the
  chip styling in `vault-fill-icon.js`). A design lab page was built in the scratchpad
  (not committed) and served on `http://127.0.0.1:8766/`. Six variants (A–F: classic,
  state-tinted track, bold bird, bold + tinted, full-height knob, hairline edge), each
  at actual size in light and dark fields and at 4× zoom. Implementation waits for the
  operator's pick. Note: a 30×16 pill changes the icon's WIDTH, so `positionIcon`'s
  `rect.width - 20` trailing offset must change with it. The root attribute KEYS stay
  pinned (only the width/viewBox values change).
- **Step 1 fix implemented.** Operator picked variant 'A' from the lab (classic toggle:
  neutral dark track, the original bird scaled into a 6.6-radius knob at cx 22.4, lock
  coloured by state) with its "bigger lock" geometry. `buildVaultLockIcon` in
  `src/preload/vault-fill-icon.js` rebuilt: viewBox `0 0 30 16`, width `30`
  (height stays `16`); track `rect` (neutral `#2b2d31`, no border/chip); lock shackle
  `path` (stroke-width 1.7, closed d ends `…V7.2`, open d omits the trailing V) + lock
  body `rect` (fill currentColor) drawn IN the track on the left; knob `circle`
  (cx 22.4 cy 8 r 6.6, fill `#E8B83A`) plus the bird's cap/mask/beak/eye SCALED
  NUMERICALLY into knob-space (no `<g transform>` — coordinates baked in at 2-decimal
  precision, beak stroke-width scaled too) on the right. `COLOR_LOCKED`/`COLOR_UNLOCKED`
  brightened to `#e8a33d`/`#34c46a` (the lab's dark-track-legible pair). `createIcon`
  drops the chip entirely (`background: transparent`, `border: none`, no
  `borderRadius`) — the track rect is now the visible shape. New `ICON_WIDTH`(30)/
  `ICON_HEIGHT`(16) constants drive `positionIcon`'s vertical centering and its
  trailing-edge inset, now `rect.width - ICON_WIDTH - 4` (a 4px gap, replacing the old
  16px-icon-sized `- 20`). Root attribute KEYS unchanged (only `viewBox`/`width` VALUES
  moved). **Mid-fix addendum (operator ruling): a native hover tooltip**, exact text
  `"Open Vault"` for every kind and both lock states — implemented as a `<title>` CHILD
  element (`createElementNS` + `textContent`), appended FIRST, never a `title`
  ATTRIBUTE on the root (keeps the attribute-key pin byte-identical); aria-label stays
  the accessible name and stays kind/state-specific.
  `test/unit/vault-fill-icon.test.js` updated in step: `EXPECTED_CHILD_TAGS` →
  `['title','rect','path','rect','circle','path','path','path','circle']`; the
  shackle-state regex → `/V7\.2$/`; the "identical across states" test rewritten to
  compare every child EXCEPT the shackle (filtered by predicate, not a hardcoded
  slice) rather than a fixed first-five/last-three split; the AC1 attribute test
  special-cases exactly one bare `<title>` with text `"Open Vault"` and asserts every
  other child stays shape-only; the two in-tree/body-placement positioning tests'
  expected `left` values recomputed for `ICON_WIDTH=30` + the 4px inset (1345→1331,
  360→346); `width` pin `'16'`→`'30'`; `setVaultLocked` color assertions →
  `#e8a33d`/`#34c46a`. `npm run build:preload`, the full unit suite, lint, typecheck,
  and format all green after the change.
- **Step 1 (redo) PASS.** The operator approved the variant-A toggle badge ("much
  better") at in-field size, locked. DD9's badge approval is satisfied with the
  toggle-switch revision.
- **Step 2 PASS** (unlocked badge green/open, knob unchanged; card and identity fields show the same badge).
- **Step 3 PASS** (toolbar lock: unlocked → vault page; right-click Lock now; locked → unlock sheet with no picker after; Enter/Space match click). Squawk 0099 verified live.
- **Step 4 FAIL → fix: unconstrained new-password fields never showed "Generate strong
  password."** Reproduced headlessly against
  `test/fixtures/save-moment/password-roles/signup-new-password-marked.html`. Cause:
  `src/preload/password-field-roles.js`'s `generateGestureInfo` reads a clicked field's
  length attributes via `readGenerateConstraints`/`parseIntOrNull`, which emits `null`
  (not `-1`) for an ATTRIBUTE-LESS field — so an unconstrained new-password field's real
  payload is `{ minLength: null, maxLength: null, passwordRules: null }`. But
  `src/shared/password-policy.js`'s `sanitizeGenerateConstraints` → its inner
  `sanitizeInt` treated only `undefined`/the sentinel `-1` as "absent"; a literal `null`
  fell through to `Number.isInteger(null) === false` and sanitized the WHOLE constraints
  object to `null`. `src/main/register-browser-ipc.js`'s `validateGenerateGesture` then
  degraded every such gesture to the bare `{ wcId }` shape — no `generate` sub-payload,
  no Generate row — for EVERY new-password field lacking `minlength`/`maxlength`
  attributes (the common case). Fix: `sanitizeInt` now treats `v === null` identically to
  `undefined`/`-1` (one added disjunct); every other rule (integer bounds, clamp,
  negative-not-`-1` rejection) is unchanged. Regression coverage, two layers: (1) a
  targeted unit case in `test/unit/password-policy.test.js` pinning
  `{minLength:null,maxLength:null,passwordRules:null}` → itself, `resolvePolicy(...).ok`
  true; (2) a new CONTRACT test, `test/unit/generate-gesture-contract.test.js`, that
  drives the REAL chain end to end with no hand-built payload at any hop —
  `findAllLoginFields` (real fixture DOM) → `generateGestureInfo` (real preload output) →
  `validateGenerateGesture` (real main validator, newly exported alongside
  `registerBrowserIpc`) — over every gated `plans-login` corpus fixture whose
  `expectRoles` includes `'new'` (9 fixtures, incl. the 6 named at diagnosis:
  signup-new-password-marked, signup-password-confirm-unmarked,
  change-password-three-marked, change-password-three-unmarked,
  change-password-no-username, current-new-marked), asserting `canGenerate: true`; plus
  the inverse for `signin-current-password` (no ordinal ever resolves a `new` role, so
  `validateGenerateGesture` is never even reachable with a truthy `generate` payload).
  **Neuter check**: reverted the `sanitizeInt` fix, reran
  `generate-gesture-contract.test.js` — 9 of 11 subtests went red with
  `AssertionError: expected validateGenerateGesture to accept the real preload payload`,
  confirming the test has teeth; restored the fix, reran — all green (11/11, and
  `password-policy.test.js` 50/50). **Lesson**: Leg 3's own test suite validated each
  hop of the chain (preload role classification, `sanitizeGenerateConstraints`,
  `resolvePolicy`, `validateGenerateGesture`) individually with HAND-BUILT payloads at
  every hop's own boundary — none of them ever fed one real module's actual output into
  the next real module's real input, so a boundary-shape mismatch between two adjacent
  hops (preload's `null` vs. main's `undefined`/`-1` "absent" vocabulary) was invisible
  to the whole suite until a live HAT walk hit it. The fix: at least one CONTRACT test
  per multi-hop chain that runs the real functions back to back against real fixture
  input, alongside (never instead of) the existing per-hop unit tests.
- **HAT (operator, between steps 3 and 4): empty right-click menu on the locked toolbar
  lock** → right-clicking `#vault-indicator` while the vault is LOCKED opened an empty
  dropdown — `page-context-model.js`'s toolbar-mode `'vault'` branch (squawk 0038) pushed
  `"Lock now"` only `if (!opts.vaultLocked)`, so the locked case pushed nothing. Operator
  ruling: locked now shows a single `"Unlock now"` item that runs the exact same body as
  a LEFT click on the locked indicator (Flight 4 Leg 1's `onVaultRequestUnlock` shape — no
  `pendingVaultFlow`, so a successful unlock springs no fill picker). Fix: `vault-
  controller.js` extracts that body into an exported `unlockNow()`, shared by the click
  listener and by a new `indicatorAction('lock'|'unlock')` router; `renderer.js`'s single
  `lockVaultNow` dep line was replaced 1:1 by `vaultIndicatorAction`, keeping the file at
  its zero-headroom 1550-line budget unchanged; `overlay-dispatch.js` gained an
  `'action:vault-unlock'` case beside the existing `'action:vault-lock'`, both routed
  through `vaultIndicatorAction`. Coverage: `page-context-model.test.js`'s locked-case
  test retargeted to assert the new item (not the omission); new `vault-controller-
  capture.test.js` cases for `unlockNow()`/`indicatorAction()`; new `overlay-
  dispatch.test.js` case for `'action:vault-unlock'`. `wc -l src/renderer/renderer.js`
  and `seam-contract.test.js` confirmed unchanged at 1550.
- **Step 4 (redo) PASS** (after the null-constraints fix): the Generate row is first; new and confirm filled with the same 20-char value (verified via the DevTools console); submit → save offer → the item is in the vault with the generated password. Note: the first restart after the badge fix left the old app instance running beside the new one; the FD killed it before this step.
- **Step 5 PASS** (generate while locked: Generate + "Unlock to fill a saved login" rows
  with no unlock first; the generated fill needs no unlock; submit → unlock-to-save →
  saved; the Unlock row → unlock → the full picker with Generate first). The operator
  reported "username not saved". Diagnosis: the fixture's username is PRE-FILLED by page
  markup (`value="newuser2"`) and never typed, so it is unprovenanced and deliberately
  excluded (DD3/DD3c: only typed or Goldfinch-filled values enter a capture). A retry
  with a typed username saved it. Working as designed; no change.
- App restarted cleanly: one instance, with all HAT fixes loaded. **"Unlock now" fix
  PASS**: locked right-click → "Unlock now" → the unlock sheet, with no picker after;
  unlocked → "Lock now".
- **Step 6 PASS** (rotation to an UPDATED item): on `change-password-no-username`, the
  current password was pasted from the vault and Generate was used for new; the offer
  was an UPDATE to the `alice-test` login; after saving, the same item kept its
  username with the new password and no new item was created. This proves DD3 + DD4 +
  the round-1 HIGH (username preserved on a no-username rotation) live.
- **Step 7 PASS** (constraints: maxlength 12 + passwordrules → ≤12 chars, alphanumeric, lower + digit present; maxlength 6 → no Generate row).
- **Step 8: squawk 0100 REPRODUCED by operator** with a live, instrumented repro:
  regular tab → kebab → Secrets (`goldfinch://vault` opens) → on the vault page
  click Unlock (the `vault-unlock` sheet opens) → click back to the original
  tab — every later kebab/right-click menu in that window opens correctly in
  main/sheet/chrome state but never paints again. **Root cause**: `register-
  tab-ipc.js`'s `tab-set-active` calls `owner.sheet?.syncBounds(rounded)` while
  the sheet is still VISIBLE (applying the newly-active tab's bounds), then in
  the same tick calls `owner.sheet?.closeMenuOverlay('tab-switch')` →
  `menu-overlay-manager.js`'s `hide()` → `removeChildView` — a resize-then-
  remove in one tick that the live instrumentation showed leaves the sheet
  document's `document.visibilityState` permanently `'hidden'`; `show()`'s
  later `v.setVisible(true)` becomes a no-op because the view's tracked
  `visible` flag was never actually flipped `false` by the old
  `removeChildView`-only `hide()`. State stays correct everywhere; only pixels
  go missing, and it is invisible to automation by design (kebab/page-context
  are not in `AUTOMATABLE_MENU_TYPES`). **Fix**: `hide()` now also calls
  `view.setVisible(false)` after `removeChildView`, so the next `show()`'s
  `setVisible(true)` is a genuine `false`→`true` toggle. Considered and
  declined reordering `register-tab-ipc.js`'s `syncBounds`/`closeMenuOverlay`
  calls (it would change behavior on an unrelated same-tab-reactivation
  branch); the `hide()` fix is the more general one and covers every close
  path, not just `tab-switch`. New/renamed unit tests in `menu-overlay-manager.test.js`
  pin the `false`→`true` toggle; neuter-checked (exactly those two tests go
  red with the fix reverted). See squawk 0100 for the full write-up. Live
  verification at this HAT step is pending a re-run of the repro against the
  fix.
- **Step 8 re-test FAIL → FD live diagnosis → fix**: the operator re-tested the
  `hide()` `setVisible(false)` remedy above against the live app — the sheet
  was **still stuck hidden**. The FD then ran a second live-instrumented
  diagnosis pass (temporary logging of the sheet's own `document.visibilityState`,
  one fresh app per experiment) rather than guessing again:
  - Repro confirmed: internal tab active (`goldfinch://settings` or
    `goldfinch://vault`), any sheet open (site-info suffices; `vault-unlock` in
    the operator's original report), switch to a web tab → every later sheet
    open in that window inits with `visibilityState: 'hidden'` and never
    paints.
  - web→web switch: fine (same guest bounds — internal tabs have no bookmarks
    bar, so an internal↔web switch is the one case whose guest/sheet bounds
    actually differ, `y=89` vs `y=119`).
  - Closing the menu BEFORE the switch: fine.
  - Moving `closeMenuOverlay('tab-switch')` to run BEFORE
    `owner.sheet?.syncBounds(rounded)` in `tab-set-active`: **FIXED** — tested
    both at the top of the `if (entry)` block and immediately before the old
    `syncBounds` line; both fixed it.
  - The previous attempt's `hide()` `setVisible(false)` addition did **NOT**
    fix it (re-confirmed still-hidden under the same instrumentation).
  - **Conclusion**: a `setBounds` that RESIZES the still-visible sheet,
    followed in the same tick by `removeChildView`, leaves the sheet
    webContents' page visibility stuck `'hidden'` for the window's life — a
    view-API flag reset (the first remedy) does not touch this mechanism; only
    reordering to close-before-resize does.

  Disposition: reverted the `hide()` `setVisible(false)` remedy and its two
  tests entirely (back to HEAD — the original `hide never uses
  setVisible(false)-only` test and comment stand as they were). Fixed
  `register-tab-ipc.js`'s `tab-set-active` instead: on a genuine tab SWITCH,
  `closeMenuOverlay('tab-switch')` now runs before `syncBounds`; the same-tab
  re-activation branch (`syncBounds` then `show()`) is unchanged, since it
  never closes the menu and can't hit this mechanism. Audited `tab-set-bounds`,
  `tab-hide`, `tab-close`, and the cross-window move core's
  `target.sheet?.closeMenuOverlay('tab-switch')` for the same
  resize-then-remove-in-one-tick shape — none of them precede a
  `closeMenuOverlay`/`hide` with a same-tick sheet `syncBounds`, so none needed
  the reorder. Two new unit tests in `register-tab-ipc.test.js` pin the order
  (switch: close before sync; same-tab: sync before show, unchanged) and are
  neuter-checked (reverting the reorder turns exactly the switch-order test
  red). See squawk 0100's rewritten Corrective Action for the full write-up.
  Live re-verification against the running app at this HAT step is still
  pending.
- **Step 8 PASS** (squawk 0100 fixed live): the operator's exact repro (tab → kebab → Secrets → Unlock → switch back) plus a repeat and the Settings-page variant: kebab and right-click menus paint. Squawk 0100 is verified live.
- **Step 9 PASS** (regression: a plain typed sign-in offers save/update as before; card checkout offers card then identity serially). **All HAT steps pass.** The FD spawned a Reviewer over the uncommitted HAT inline fixes before the commit (they touched security-sensitive surfaces).
- HAT-fix Reviewer: code, tests and gates clean (5654 tests, 0 fail; lint,
  typecheck, format:check, build:preload all clean; `renderer.js` exactly 1550). One
  blocker, documentation only: squawks 0099/0100 still read "pending live
  verification". Fixed by closing both squawks (completed, live HAT evidence, sign-off).
  Committed `cc8b3b7`.

### Flight landed (2026-09-22)

- Leg 5 → `completed`; the flight → `landed`; checked off in mission.md. The docs
  check found CLAUDE.md (password roles, generate-in-picker, badge, the Unlock now
  indicator, the squawk 0100 sheet rule) and `docs/vault.md` (password roles, generate)
  current. Squawk candidate, filed at flight end: retrofit the owner-window check onto
  `vault-fill-human` / `vault-reachable-items`. PR #230 marked ready for review. Next:
  `/mission-control:flight-debrief` (operator request).
