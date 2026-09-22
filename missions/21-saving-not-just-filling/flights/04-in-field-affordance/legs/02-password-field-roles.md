# Leg: password-field-roles

**Status**: completed
**Flight**: [The In-Field Affordance](../flight.md)

## Objective

Make login capture read the right password on sign-up and change-password forms:
classify each password field in a login scope as `current`/`new`/`confirm`. The planned
capture then carries the NEW password (admitted only when a present confirm agrees), plus
the provenanced CURRENT password. Main files a rotation as an UPDATE to the one login
whose stored password equals that current value. Every `sign-in` scope captures exactly
as it does today.

## Context

- Flight DD1 (layered per-field rule), DD2 (corpus first), DD3 (capture reads `new`,
  confirm agreement), DD3a (scope derived INSIDE the planner; `findAllLoginFields` and
  `resolveOrdinalInFamily` unchanged), DD4 (rotation disposition by provenanced
  current-password match; `rec.matchedByPassword` exempts DD3c's downgrade), DD7 (the
  scope-widening function is exported from the same pure module so Leg 3's isolated-world
  fill can call it), DD8 (the fully unmarked two-field current + new form is a counted
  miss).
- **The live defect this fixes** (planning finding): `findAllLoginFields` returns one entry
  per `input[type=password]`. `resolveOrdinalInFamily` step 2 resolves a submit-button
  gesture to the FIRST entry in the form. On a change-password form that is the CURRENT
  password, so today a rotation saves the OLD password. This must be hard-zero before
  Leg 3 makes rotation common (Adaptation Criteria: divert if DD3/DD4 cannot be made
  hard-zero against the corpus).
- Leg 1 (`lock-indicator-click`) touched only `vault-controller.js`. There is no overlap.
- **No user-visible feature** in this leg. Checkpoints: every `sign-in` scope is unchanged;
  the rotation scope saves the NEW password as an update.
- Planner/actuator shape (CLAUDE.md "Recurring module shapes"): every decision stays in
  the pure `vault-capture-plan.js`. `webview-preload.js`'s `onCaptureGesture` loop is
  **unchanged** (it already passes the full `entriesByKind` arrays and the whole snapshot).

## Inputs

- `src/preload/vault-capture-plan.js`: `planCaptures` loop (`planner(entry, entrySnapshot)`),
  `planLogin(entry, entrySnapshot)`.
- `src/preload/vault-fill-fields.js:findAllLoginFields`, which yields per-field
  `{ username, password, form }` (the `form` is `pw.form || pw.closest('form')`; null when
  form-less).
- `src/preload/field-tokenizer.js`: `normalizeFieldHaystack`, `fieldHaystack`.
- `src/preload/vault-entry-observer.js:snapshot()`: `logins[i]` is
  `{ username?: {detected, value}, password: {detected, value} }`, ordinal-aligned with
  `findAllLoginFields` over the same document (the `value` is `null` when unprovenanced).
- `src/main/register-browser-ipc.js`: the `ipcMain.on('guest-vault-capture', …)` handler
  destructures `{ username, usernameDetected, password }`.
- `src/main/vault/vault-human.js`: `holdGestureLogin`, `captureRelease`'s `login:`
  closure, `capture`, `disposeCapture`, `applyUsernameDowngrade`, `captureFinalize`'s
  `login: () => applyUsernameDowngrade(rec, disposeCapture(rec))`, and `dropCapture` (which
  zeroizes every own Buffer, LD7).
- Corpus: `test/fixtures/save-moment/manifest.js` (the only source of tier),
  `test/helpers/save-moment-assertions.js` (`buildProvenancedObserver` grants provenance
  to every login field with a `value`), and `test/unit/save-moment-corpus.test.js`
  (`KNOWN_ASSERTS`).

## Outputs

- NEW `src/preload/password-field-roles.js`: pure, CJS, Electron-free, DOM-global-free
  (it must also bundle into the isolated world in Leg 3). It exports:
  - `loginScopeOrdinals(entries, ordinal)` → `number[]`: the ordinals of every entry in
    the handle's scope, in document order.
  - `classifyPasswordScope(passwordFields)` → `{ kind: 'sign-in' | 'classified' | 'ambiguous', roles: Array<'current'|'new'|'confirm'|null> }`,
    with `roles` aligned to the input.
- `vault-capture-plan.js`: `planLogin` widened per DD3a/DD3; the `guest-vault-capture`
  payload gains an optional `currentPassword: Uint8Array`.
- Main: the `currentPassword` chain (IPC handler → `holdGestureLogin` → `captureRelease` →
  `capture` → `disposeCapture`), the password-match rule, and the `matchedByPassword`
  downgrade exemption.
- Corpus: 12 new fixtures, two new assert kinds, and new assertion helpers.
- Unit tests (see the acceptance criteria), plus docs in CLAUDE.md and `docs/vault.md`.

## Acceptance Criteria

**Classifier (`password-field-roles.js`)**
- [ ] AC1: Layer 1 (`autocomplete`, read via `getAttribute('autocomplete')`, tokens split
      on whitespace so `section-x new-password` works): `new-password` → `new`, and a
      second `new-password` in the scope (document order) → `confirm`;
      `current-password` → `current`.
- [ ] AC2: Layer 2 runs only for fields layer 1 left unresolved. It matches word-boundary
      tokens over `normalizeFieldHaystack(fieldHaystack(field)).toLowerCase()`. Precedence
      within one field is **confirm > current > new** (so `confirmNewPassword` and
      `newPasswordConfirm` → `confirm`). Confirm tokens: `confirm`, `confirmation`,
      `repeat`, `retype`, `verify`, `again`. Current tokens: `current`, `old`,
      `existing`. New token: `new`. A second `new` in the scope becomes `confirm`, as in
      layer 1.
- [ ] AC3: Layer 3 fills only still-unresolved fields, consistent with what is resolved:
      - three fields → `current`, `new`, `confirm` (the roles not yet taken, assigned in
        document order);
      - two fields → `current` + `new` if either resolved `current`, otherwise `new` +
        `confirm`;
      - one field → no structural signal.
- [ ] AC4: Result kinds.
      - `sign-in`: a one-field scope whose field is unresolved or `current`.
      - `classified`: the final roles contain exactly one `new`, at most one `current`,
        at most one `confirm`, and no `null`.
      - `ambiguous`: anything else (more than three password fields, a duplicated
        `current`, a field left `null` in a multi-field scope).
      - A single field resolved `new` is `classified` with roles `['new']`.
      - The function never throws on fields lacking `getAttribute` or attributes.
- [ ] AC5: `loginScopeOrdinals(entries, ordinal)` returns every entry whose `.form` is the
      handle's non-null `.form`; when the handle's `.form` is null or undefined, it
      returns every entry whose `.form` is null or undefined. It returns `[]` for an
      out-of-range ordinal.

**Planner (`vault-capture-plan.js`)**
- [ ] AC6: `planCaptures` passes `planLogin` the full login `entries`, the full
      `snapshot.logins`, and the resolved ordinal. The card and identity planners and
      their outputs are byte-identical to before (their existing tests pass unmodified).
- [ ] AC7 (regression gate): when the scope has ONE password field (whatever its
      classification, including the lying `new-password` sign-in), `planLogin`'s output
      deep-equals today's output: the same payload keys
      `{ username, usernameDetected, password }` (NO `currentPassword` key) and
      `watchFields: [entry.username, entry.password]`. Every pre-existing
      `vault-capture-plan.test.js` case passes UNMODIFIED. If one would not, stop and
      report it (it means an existing shape has two form-less password fields; see Edge
      Cases).
- [ ] AC8: On a `classified` multi-field scope:
      - `password` = the `new` field's provenanced snapshot value;
      - when a `confirm` field exists, the plan is emitted only if confirm is provenanced
        AND byte-equal to new; a mismatch or an unprovenanced confirm plans NO login;
      - an unprovenanced `new` plans no login;
      - `currentPassword` (Uint8Array) is present iff a `current` field exists and is
        provenanced;
      - `username`/`usernameDetected` come from the HANDLE entry's snapshot exactly as
        today;
      - `watchFields` = every scope entry's password field plus the handle's username
        field (nulls filtered, no duplicates).
- [ ] AC9: An `ambiguous` multi-field scope plans NO login capture (a missed capture,
      never a wrong value). Card/identity plans from the same gesture are unaffected.
- [ ] AC10: The planner never reads a snapshot entry outside the scope's ordinals, and it
      tolerates a snapshot shorter than `entries` (the mutation-race residual) by planning
      nothing for the login family rather than throwing.

**Main chain + disposition**
- [ ] AC11: The `guest-vault-capture` handler forwards `currentPassword` to
      `holdGestureLogin` as `currentPasswordBytes`. `holdGestureLogin` accepts a
      `Uint8Array` (anything else is ignored), copies it into `rec.currentPassword`
      (a Buffer), and zeroizes the incoming array, on EVERY path including gate refusal.
      `captureRelease`'s login closure copies and forwards it, and `capture()` stores it.
      `dropCapture` zeroizes it with no edit (existing Buffer sweep): add a test asserting
      the held `currentPassword` Buffer is all-zero after drop.
- [ ] AC12: `disposeCapture`, when `rec.currentPassword` is non-empty:
      - reads full items ONCE per distinct `vaultId` among
        `reachableLoginItems(rec.jarId, rec.origin)` (`listItems(vaultId)`);
      - candidates = reachable rows whose stored `password` equals the current value
        byte-for-byte, AND (`rec.username == null` OR `normUsername(row.username) ===
        rec.username`);
      - exactly ONE candidate → `mode: 'update'` to it, `rec.matchedByPassword = true`,
        AND **`rec.username` is reassigned to that row's normalized username** (not only
        the returned model's `username`). `captureSave`'s login-update branch writes
        `username: rec.username` over the existing item, so leaving `rec.username` null
        would silently blank the stored username on every no-username-field rotation
        (design review HIGH). `rec.usernameDetected` is left as-is: the
        `matchedByPassword` exemption means it is never consulted on this path. The
        existing unchanged guard still applies (new password === stored → `null`, no
        offer);
      - zero or several candidates → today's origin + username rule, unchanged.
- [ ] AC13: `applyUsernameDowngrade` returns the model unchanged when
      `rec.matchedByPassword === true`. The username-keyed path's DD3c behaviour is
      unchanged (its existing tests pass unmodified).
- [ ] AC14: Named `disposeCapture` unit tests:
      - (a) a rotation with no username field, one reachable login whose password equals
        current → update to it;
      - (b) two reachable logins on the origin sharing the current password → today's
        rule, never an update by guess;
      - (c) a provenanced username that disagrees with the single password-matched row →
        today's rule;
      - (d) detected-but-unprovenanced username (read-only prefilled) + password match →
        update survives `applyUsernameDowngrade`;
      - (e) the same password match through the LOCKED path (`capture` locked →
        `captureFinalize` after unlock) → update;
      - (f) no `currentPassword` → behaviour identical to today (the existing suite);
      - (g) `captureSave`-level test (the real save path, not `disposeCapture`
        alone): a stored login `{username:'alice', password:'old'}` plus a capture with
        `username: null`, `currentPassword: 'old'`, `password: 'new'` → after
        `captureSave`, the persisted item has `username === 'alice'` and
        `password === 'new'`, and the item count is unchanged (an update, not a new
        item). Assert `rec.username === 'alice'` after dispose too.
- [ ] AC15: After a disposition is computed, `rec.currentPassword` is zeroized and
      deleted. It is not needed for save; this shortens its lifetime. There are exactly
      two sites, both immediately after `applyUsernameDowngrade(rec, disposeCapture(rec))`
      returns: `capture()`'s unlocked branch and `captureFinalize`'s login dispatch.
      Consider one small helper both call. Test both paths.
- [ ] AC15b: `capture()`'s gate-refusal early return zeroizes an incoming
      `currentPasswordBytes`, the same as it already does `passwordBytes`. Add a named
      test, symmetric with AC11's `holdGestureLogin` one.

**Corpus (DD2)**
- [ ] AC16: New assert kinds in `KNOWN_ASSERTS`, implemented in
      `save-moment-assertions.js` through the REAL `resolveGestureTargets` +
      `planCaptures` (never a reimplementation):
      - `plans-login`: offers-strength. The designated gesture plans a login whose
        decoded `password` equals `expectPassword`, whose decoded `currentPassword` equals
        `expectCurrentPassword` (or whose payload has no `currentPassword` key when that
        is `null`), and whose `usernameDetected`/`username` equal the optional
        `expectUsernameDetected`/`expectUsername`. It also asserts
        `classifyPasswordScope` over the scope's password fields yields `expectRoles`
        (an array, or the string `'sign-in'`), and that `wouldNativelySubmit(target)`
        holds.
      - `no-login-plan`: the gesture plans no `login` entry.

      A new optional manifest field `ungranted: string[]` lists `#id` selectors that
      `buildProvenancedObserver` must NOT grant (for the never-typed prefilled username).
      Its default leaves existing fixtures unchanged. Document every new field in the
      manifest's header.
- [ ] AC17: Fixtures committed and tiered (real HTML, a native form-submit button, values
      in `value=` attributes). Gated (`plans-login`):
      - `signup-password-confirm-unmarked` (username + two unmarked password fields) →
        `['new','confirm']`;
      - `signup-new-password-marked` → `['new','confirm']`;
      - `change-password-three-unmarked` → `['current','new','confirm']`, currentPassword
        set;
      - `change-password-three-marked` → same, via autocomplete;
      - `change-password-no-username` (marked) → `usernameDetected: false`;
      - `signin-current-password` (username + `current-password`) → `'sign-in'`, today's
        payload;
      - `current-new-marked` → `['current','new']`;
      - `current-new-token-named` (`oldPassword`/`newPassword`) → `['current','new']`;
      - `change-password-readonly-username` (read-only, prefilled, `ungranted` username +
        three marked fields) → `usernameDetected: true`, `username: null`,
        currentPassword set;
      - `signin-lying-new-password` (a lone login field marked `new-password`) → roles
        `['new']`, a login planned with that field's value and NO `currentPassword`. Its
        header documents why it is the DD2 "lying autocomplete" negative: it must still
        capture as a login, and it can never reach the password-match update.

      `negative-gesture` (`no-login-plan`):
      - `signup-confirm-mismatch` (new ≠ confirm).

      `known-unsolved` (`plans-login`, `{ todo: true }`):
      - `current-new-fully-unmarked` (two unmarked fields whose values differ and
        semantically are current + new). Its header cites DD1's known limit and DD8's
        counted miss.
- [ ] AC18: `npm test` is green, including every pre-existing corpus fixture and the
      standing canary. Also green: `npm run lint`, `npm run typecheck`,
      `npm run format:check`. There is no `renderer.js` change.

**Docs**
- [ ] AC19: CLAUDE.md's Password vault pattern gains a bullet on password-field roles:
      the module, its layers and `ambiguous` rule, the planner's scope derivation, the
      confirm-agreement rule, and the current-password disposition with its
      `matchedByPassword` DD3c exemption. `docs/vault.md`'s capture section gets the same
      in operator terms.

## Verification Steps

- `node --test test/unit/password-field-roles.test.js test/unit/vault-capture-plan.test.js test/unit/save-moment-corpus.test.js`,
  plus the `vault-human` / `vault-gesture-capture` / `vault-capture` suites touched.
- AC7: `git diff test/unit/vault-capture-plan.test.js` shows only ADDED cases.
- AC13/AC14(f): the pre-existing DD3c and disposition tests are unmodified in the diff.
- Neuter checks (record them in the flight log):
  - make `planLogin` return the handle entry's password on a classified scope → the
    `change-password-three-*` fixtures go red;
  - drop the confirm-equality check → `signup-confirm-mismatch` goes red;
  - remove the `matchedByPassword` exemption → AC14(d) goes red.
- `timeout 600 npm test && npm run lint && npm run typecheck && npm run format:check`.
- Live rotation behaviour is verified at the HAT (vault sheets are unobservable, DD12).

## Implementation Guidance

1. **Corpus first (DD2).** Add the fixtures, the manifest entries, the `ungranted`
   support, and the two assert kinds. Run the corpus and confirm the new gated fixtures
   fail for the right reason (e.g. the change-password shapes plan the CURRENT value).
   Note the result in the flight log.
2. **`password-field-roles.js`.** Keep it pure: take field objects and read only
   `getAttribute`, `name`, `id`, `placeholder` (via `fieldHaystack`) and `.form`.
   Word-boundary regexes over the normalized, lowercased haystack. Document in the
   module header that flat no-separator names (`newpass`, `oldpwd`) have no word boundary.
   They fall through to layer 3 (structure). That is a known limit beside DD1's, and
   the realistic camelCase and snake_case shapes are covered. Write
   `test/unit/password-field-roles.test.js` against plain fake fields (the
   `vault-fill-fields` test fakes are the precedent). Cover each layer, precedence, the
   second-`new` → `confirm` rule, every AC4 kind, and `loginScopeOrdinals` (form scope,
   form-less scope, a mixed page, out of range).
3. **Planner.** Change the loop to call `planner(entry, entrySnapshot, { entries, snapshotEntries, ordinal })`;
   card and identity ignore the third argument. In `planLogin`, derive the scope. A
   one-field scope takes today's body verbatim. Otherwise classify, gate and build the
   payload per AC8/AC9. Encode `currentPassword` with the same `TextEncoder`. Add a
   one-line comment on why the HANDLE's username is trusted for the whole scope:
   `resolveLoginEntry`'s last-preceding-text-field walk converges on the same node for
   every password field in a top-to-bottom form.
4. **Main chain.** Change the IPC handler, `holdGestureLogin`, the `captureRelease` login
   closure, `capture()` (add a `currentPasswordBytes` param and zeroize the incoming array
   on every path, including the gate-refusal early return), `disposeCapture`'s
   password-match block (ahead of the existing jar/global username match),
   the `rec.username` reassignment on a password match (AC12), `applyUsernameDowngrade`'s
   exemption, and the AC15 post-disposition zeroize. `captureSave` itself needs NO
   change once `rec.username` is reassigned, and AC14(g) pins that. Add
   `currentPassword` and `matchedByPassword` to the `CaptureRecord` typedef.
5. **Tests, neuter checks, docs, format.**

## Edge Cases

- **Two form-less password fields on a page** (e.g. two unrelated script-driven widgets):
  DD3a scopes them together, so the page classifies as new + confirm and plans a login
  only if the two values agree. This is an accepted behaviour change on a rare shape: a
  missed capture, never a wrong value. If an EXISTING test or corpus fixture pins the
  old behaviour for this shape, do not silently rewrite it. Report it (it is the
  design-review signal DD3a needs revisiting).
- **The page auto-copies new → confirm by script:** confirm is unprovenanced, so no plan
  (DD3 as written). It is a counted miss; note it in the flight log under DD8.
- **Password-match against an item whose stored password is empty:** never match an empty
  current value (AC12 requires a non-empty `rec.currentPassword`).
- **The handle resolves to the `current` entry** (a submit button in the form's first
  in-form entry): the scope widening makes the handle irrelevant to WHICH value is saved.
  That is the whole point of DD3a.
- **Snapshot/entries length skew** (a mutation between the main-world enumeration and the
  isolated-world read): AC10 plans nothing.

## Files Affected

- `src/preload/password-field-roles.js`: NEW
- `src/preload/vault-capture-plan.js`: `planLogin` scope widening, loop third arg
- `src/main/register-browser-ipc.js`: forward `currentPassword`
- `src/main/vault/vault-human.js`: hold/release/capture/dispose/downgrade, typedef
- `test/unit/password-field-roles.test.js`: NEW
- `test/unit/vault-capture-plan.test.js`, `test/unit/vault-human.test.js` (or the closest
  existing disposition suite), and the `vault-gesture-capture`/`vault-capture-drop-safety`
  suites as needed: added cases
- `test/helpers/save-moment-assertions.js`, `test/unit/save-moment-corpus.test.js`,
  `test/fixtures/save-moment/manifest.js`, `test/fixtures/save-moment/password-roles/*.html`
  (NEW directory; cosmetic only)
- `CLAUDE.md`, `docs/vault.md`

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Neuter checks recorded in the flight log
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (completed at the flight-end review and commit)

## Citation Audit

Checked 2026-09-22 on `flight/04-in-field-affordance` (Leg 1 uncommitted; it does not
touch these files). All symbols are present:
- `vault-capture-plan.js` `planLogin`/`planCaptures` (the loop calls
  `planner(entry, entrySnapshot)`)
- `vault-fill-fields.js` `resolveLoginEntry`/`findAllLoginFields`
- `vault-gesture-policy.js` `resolveOrdinalInFamily` (step 2 at ~line 133) and
  `snapshotHasProvenancedSecret`
- `field-tokenizer.js` `normalizeFieldHaystack`/`fieldHaystack`
- `vault-entry-observer.js` `snapshot()` (`LOGIN_ROLES = ['username','password']`)
- `register-browser-ipc.js` `'guest-vault-capture'` handler (~line 189)
- `vault-human.js` `disposeCapture` (~495), `applyUsernameDowngrade` (~546), `capture`
  (~577), `holdGestureLogin` (~665), `captureRelease` (~846), and `captureFinalize`'s
  login dispatch
- `webview-preload.js` `onCaptureGesture` (~562; unchanged by this leg)
- `save-moment-assertions.js` `buildProvenancedObserver`/`assertOffersFamilies`/`wouldNativelySubmit`
- `save-moment-corpus.test.js` `KNOWN_ASSERTS`
