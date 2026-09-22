# Leg: generate-in-picker

**Status**: completed
**Flight**: [The In-Field Affordance](../flight.md)

## Objective

Clicking the in-field vault badge on a new-password field offers "Generate strong
password" as the first picker row, even while the vault is locked. Choosing it:
- has main generate a CSPRNG password that honours the field's length attributes and
  `passwordrules`;
- fills it into the scope's `new` and `confirm` fields in the isolated world, with
  provenance, so the ordinary capture gesture then offers it for saving through the same
  path as a typed password.

## Context

- Flight DD5 (picker row, the validated gesture payload, main decides availability,
  locked-vault branch through ONE state machine), DD6 (generation on the EXISTING
  `src/shared/password-generator.js` via a new pure `src/shared/password-policy.js`;
  `passwordrules` strict parse; `pattern` evaluated ONLY in the guest's isolated world;
  two candidates up front), DD7 (the isolated-world `fillGenerated` fills new + confirm,
  never current or username, and calls `grantForFill`), DD8 (reachable only from a
  trusted badge click; nothing automatic).
- **Leg 2 outputs this leg builds on**: `src/preload/password-field-roles.js`
  (`loginScopeOrdinals`, `classifyPasswordScope`, pure CJS and already an ESLint CJS
  preload entry). DD7's "scope widening exists twice" concern is resolved by both worlds
  calling `loginScopeOrdinals`, so no drift guard is needed. `planLogin` already captures
  the NEW field's value on a classified scope, so a generated fill followed by a
  submit-button gesture captures the generated value (the mission criterion's "same save
  path").
- The badge exists only on persistent-jar web tabs (`vault-eligible` in
  `register-browser-ipc.js` requires `resolvePersistJar`), so burner and internal tabs
  never raise a gesture. Main re-checks anyway (defense in depth).
- `renderer.js` is zero-headroom (`RENDERER_LINE_BUDGET` 1550). All chrome work lives in
  `vault-controller.js`, and there is no new evaluate seam (DD5).
- The vault sheets are unobservable to automation (DD12): the picker behaviour is
  unit-tested and verified live at the HAT.

## Inputs (current code)

- `src/preload/vault-fill-icon.js`:
  - `onIconClick` sends `ipcRenderer.send('guest-vault-gesture', {})`;
  - `targetForAnchor(anchor)` → `{ kind:'login', field: entry.password }`;
  - `consumeFillTarget(kind)` is single-use with `FILL_TARGET_TTL_MS` = 60 s.
- `src/main/register-browser-ipc.js`: `ipcMain.on('guest-vault-gesture', …)` forwards
  `{ wcId }` to `chromeForTab(wcId)`.
- `src/main/main.js`:
  - `popupVaultIconMenu`'s "Fill login…" sends a bare `vault-gesture`, and stays bare;
  - `ipcMain.handle('vault-fill-human', …)`;
  - the vault-human deps' `fillDelegate: ({wcId, credential}) => webContents.fromId(wcId)?.send('vault-fill', credential)`.
- `src/renderer/chrome/vault-controller.js`:
  - `goldfinch.onVaultGesture(({ wcId }) => …)` (unlocked → picker; locked →
    `pendingVaultFlow = {wcId, phase:'unlocking'}` + `vault-unlock`);
  - `onVaultLockState`'s continuation (`phase === 'unlocking' && unlocked` →
    `openVaultPicker(wcId)`);
  - `openVaultPicker(wcId)`, `handleActivation`'s `vault-picker` branch (`MANAGE_ID`,
    `pick:<i>`).
- `src/shared/vault-picker-template.js`: `renderVaultPickerRows(document, card, model)`,
  `pickId`/`parsePickIndex`, `MANAGE_ID`, `EMPTY_PICKER_NOTE`, `KIND_TABLE`.
- `src/preload/webview-preload.js`: the `ipcRenderer.on('vault-fill', …)` pattern
  (`consumeFillTarget` → `resolveOrdinalInFamily` → `entryTracker.fillLogin`).
- `src/preload/vault-entry-tracker.js` `runFill`; `src/preload/vault-entry-observer-bootstrap.js`
  `fillLogin` (→ `observer.grantForFill(result)`); `src/preload/field-setters.js`
  `setFieldValue`.
- `src/shared/password-generator.js` `generatePassword(opts)` (ESM; `globalThis.crypto`).
- `src/main/vault/vault-human.js` `tabJarFor`/`tabOriginFor`/`fillHuman`'s gate order.

## Outputs

- NEW `src/shared/password-policy.js` (ESM, pure): the `passwordrules` parser,
  `resolvePolicy(constraints)`, `generateCandidates(constraints)`, and
  `sanitizeGenerateConstraints(raw)`.
- `src/shared/password-generator.js`: extended additively (see AC4). The existing call
  shape is byte-identical in behaviour.
- `src/preload/password-field-roles.js`: a new pure export, `generateGestureInfo(entries, ordinal)`.
- Gesture payload: preload → main validate → chrome.
- Picker: Generate and Unlock action rows.
- New `vault-fill-generated` path: chrome invoke → main → guest → isolated world
  `fillGenerated` with provenance.
- Tests and docs.

## Acceptance Criteria

**Policy + generator (pure, main-side)**
- [x] AC1: `sanitizeGenerateConstraints(raw)` returns
      `{ minLength: int|null, maxLength: int|null, passwordRules: string|null }`, or
      `null` when `raw` is not a plain object or any present field is malformed. Rules:
      - integers are clamped to 1–128; a non-integer or a negative is malformed;
      - `-1`/absent → `null`;
      - `passwordRules` must be a string of ≤ 512 chars, else malformed; `''` → `null`;
      - unknown keys are ignored.
- [x] AC2: `parsePasswordRules(str)` implements the WebKit `passwordrules` core:
      - `;`-separated `name: value` rules, case-insensitive names, whitespace-tolerant;
      - `required:` and `allowed:` take comma-separated classes (`upper`, `lower`,
        `digit`, `special`, `ascii-printable`, `unicode`) and `[...]` custom sets;
      - `max-consecutive: <int>`, `minlength: <int>`, `maxlength: <int>`;
      - unknown rule NAMES are ignored;
      - ANY syntax error (an unterminated `[`, a non-integer where one is required, an
        unknown class keyword) → `null` for the WHOLE attribute (never partially
        applied);
      - `unicode` is treated as `ascii-printable` (the generator never emits
        non-ASCII);
      - custom sets keep only printable ASCII except space;
      - `special` = the WebKit set ``-~!@#$%^&*_+=`|(){}[:;"'<>,.?]``.
- [x] AC3: `resolvePolicy(constraints)` → `{ ok: true, length, requiredSets: string[], alphabet: string, maxConsecutive: number|null }`
      or `{ ok: false }`.
      - Defaults: length 20; required sets = our four classes; alphabet = their union.
      - Parsed rules narrow it: the alphabet = the union of allowed and required sets, or
        the defaults when neither is given. Required sets are the rule's, each
        intersected with the alphabet; a required set that becomes empty makes the rules
        unsatisfiable.
      - Length = 20 clamped into [max(minLength sources), min(maxLength sources)].
      - `ok: false` when min > max, when the final length is < 8, when length <
        `requiredSets.length`, or when the alphabet is empty.
      - Unsatisfiable RULES (not attributes) degrade to the attributes-only policy
        before giving up, per DD6 "widest satisfiable".
      - Unit tests cover each branch.
- [x] AC4: `generatePassword` gains an optional
      `{ length, requiredSets: string[], alphabet: string, maxConsecutive }` mode:
      - one char from each required set, the rest from `alphabet`, the unbiased
        shuffle;
      - `maxConsecutive` is enforced by redrawing the whole password, with a bounded
        attempt count (throw after 100);
      - the same `randomIndex` rejection sampling (never modulo; never `Math.random`).

      When `requiredSets` is absent the function behaves exactly as today, and every
      existing `password-generator` test passes unmodified. The vault page's own
      Generate button is unaffected.
- [x] AC5: `generateCandidates(constraints)` → `string[]` of length 1 or 2:
      - `[primary]` from `resolvePolicy`;
      - plus an alphanumeric fallback (the policy with every non-alnum character
        removed from the alphabet and required sets; empty required sets dropped),
        included only when that fallback policy is `ok` and it differs from the primary
        alphabet;
      - `[]` when the primary is not `ok`.

      Every candidate is ≤ 128 chars.

**Gesture payload**
- [x] AC6: `generateGestureInfo(entries, ordinal)` (pure, in `password-field-roles.js`)
      returns `{ passwordRole: 'new', constraints }` (attribute reads guarded in the
      module's defensive `typeof field?.getAttribute === 'function'` style) when the
      handle's scope classifies
      `classified` with a `new` role, else `{ passwordRole: null, constraints: null }`.
      `constraints` are read from the NEW field:
      - `minLength`/`maxLength` from `getAttribute('minlength'|'maxlength')`, parsed
        base-10, else `null`;
      - `passwordRules` from `getAttribute('passwordrules')`, else `null`.

      It never throws and never reads a value.
- [x] AC7: `onIconClick` sends `guest-vault-gesture` with
      `{ generate: generateGestureInfo(findAllLoginFields(doc), <ordinal of the clicked login entry>) }`
      when the resolved target is `kind: 'login'`, and `{}` otherwise (card, identity, or
      unresolved). The ordinal is
      `findAllLoginFields(doc).findIndex((e) => e.password === target.field)`
      (synchronous; `targetForAnchor` returns only `{kind, field}`); `-1` → send `{}`. Every existing `vault-fill-icon` test passes. A new test covers the
      login/new payload, the sign-in payload, and the card payload.
- [x] AC8: The main `guest-vault-gesture` handler validates `payload.generate`:
      - `passwordRole` must be the literal `'new'`;
      - `constraints` go through `sanitizeGenerateConstraints`.

      It then forwards `{ wcId, generate: { canGenerate: resolvePolicy(c).ok, constraints: c } }`
      when valid, and `{ wcId }` (today's bare shape) when anything is malformed or the
      role is not `'new'`. Unit-tested (valid, each malformed field, extra keys, a
      non-object). `popupVaultIconMenu`'s "Fill login…" is unchanged.

**Picker**
- [x] AC9: `vault-picker-template.js` exports `GENERATE_ID = 'generate-password'` and
      `UNLOCK_ID = 'unlock-saved-logins'`.
      - `renderVaultPickerRows` renders model entries shaped `{ action: 'generate' }` /
        `{ action: 'unlock' }` as `menuitem` rows labelled "Generate strong password" /
        "Unlock to fill a saved login", with those fixed ids (never `pick:<i>`), built
        via `textContent`.
      - Item rows keep `pick:<i>`, where `i` is the index into the SAME model array, so
        the chrome's `lastPickerModel[idx]` lookup is unchanged.
      - The empty note shows only when there are no item rows AND no `unlock` row.
      - Existing template tests pass unmodified.
      - Design review round 1 (MEDIUM): action entries branch EARLY in the render loop,
        before any `kindOf`/`KIND_TABLE` use, and are excluded from
        `presentKinds`/section-heading derivation (so they never spawn or merge into a
        "Logins" heading).
      - Their buttons carry `data-action-id="<GENERATE_ID|UNLOCK_ID>"` and NO
        `data-pick-index`.
      - They ARE pushed into the returned focusable `buttons` array, before the item
        rows (keyboard-reachable; roving order = visual order).
      - Explicit tests: unlocked + canGenerate + zero saved items → the Generate row AND
        the empty note both render; locked → Generate + Unlock rows and no empty note;
        action rows sit under no section heading.
- [x] AC9b (design review round 1 HIGH — the dispatch chokepoint): `menu-overlay.js`'s
      `renderPicker` click handler maps a row to its channel-4 id as
      `btn.dataset.actionId || (pickIndex present ? pickId(n) : MANAGE_ID)`. Today it is
      a binary pick-index-or-`MANAGE_ID` fallback, which would silently route both
      action rows to "Manage passwords" (a navigation to the vault page).
      - Only `GENERATE_ID`/`UNLOCK_ID` are honoured as action ids. Any other
        `data-action-id` falls through to the existing rule. `handleActivation`
        re-validates the ids chrome-side.
      - Enter/Space ride the same `click` listener (native `<button>`); there is no
        separate keydown path.
      - Pin the mapping in a small pure helper exported from `vault-picker-template.js`
        (e.g. `activationIdFor(dataset)`), used by `renderPicker` and unit-tested.
- [x] AC10: `onVaultGesture(({ wcId, generate }))`, with `setUp` false → no-op
      (unchanged):
      - unlocked + `generate?.canGenerate` → picker with
        `[{action:'generate'}, ...reachable items]`;
      - locked + `canGenerate` → picker with `[{action:'generate'}, {action:'unlock'}]`
        (no store read);
      - any other combination → exactly today's behaviour.

      `pendingVaultFlow` carries `generate` (`{ wcId, phase, generate }`) so the
      post-unlock continuation re-shows the Generate row:
      - `onVaultLockState`'s `openVaultPicker(pendingVaultFlow.wcId)` (~line 441) becomes
        `openVaultPicker(pendingVaultFlow.wcId, pendingVaultFlow.generate)`;
      - `openVaultPicker(wcId, generate?)` prepends `{action:'generate'}` when
        `generate?.canGenerate`;
      - update `pendingVaultFlow`'s JSDoc type to add
        `generate?: { canGenerate: boolean, constraints: any } | null`, or typecheck
        fails.

      (The review confirmed that `handleClosed` has no `vault-picker` branch, so
      `pendingVaultFlow` survives the Ch7-before-Ch6 ordering into `handleActivation`,
      the same as today's `pick:<i>` path.)
- [x] AC11: `handleActivation`'s `vault-picker` branch:
      - `GENERATE_ID` → `goldfinch.vaultFillGenerated({ wcId, constraints: pendingVaultFlow.generate.constraints })`,
        then clear `pendingVaultFlow`;
      - `UNLOCK_ID` → `pendingVaultFlow.phase = 'unlocking'` (keeping `wcId` and
        `generate`) + `openOverlayMenu('vault-unlock', [], null, 0)` — the SAME unlock
        entry point as today's locked gesture;
      - `pick:<i>` and `MANAGE_ID` are unchanged, and `pick:` on an action row's index
        is a no-op;
      - a resolved `{ filled:false }` from the generated fill shows no sheet (a toast
        is optional; reuse the existing toast dep if there is one).

      Unit tests go in the vault-controller suite: both gesture branches, both action
      ids, and the post-unlock re-show.
- [x] AC12: The `chrome-preload.js` bridge adds
      `vaultFillGenerated: (p) => ipcRenderer.invoke('vault-fill-generated', p)`. Add
      the `renderer-globals.d.ts` entry per the new-contextBridge-method rule.

**Main generate + fill**
- [x] AC13: `ipcMain.handle('vault-fill-generated', …)`:
      - accepts only a sender that is the owning window's chrome for `wcId` (the
        `ownsTab` shape: `registry.getWindowForChrome(event.sender)` ===
        `registry.getWindowForGuest(wcId)`). `ownsTab` is closure-local in
        `register-tab-ipc.js`, so reimplement the two-line check here. **FD ruling:**
        this is deliberately stricter than the older `vault-fill-human` /
        `vault-reachable-items` handles (no owner check), because this channel causes a
        write into a guest from chrome-supplied input. Retrofitting those two is out of
        scope here; it is a squawk candidate;
      - re-runs `sanitizeGenerateConstraints` then `generateCandidates` (never trusting
        the chrome's `canGenerate`);
      - delegates to `vaultHuman.fillGenerated({ wcId, candidates })`.

      `fillGenerated` gates, in order: the vault is set up; `tabJarFor(wcId)` is a
      persistent jar; `tabOriginFor(wcId)` is non-null (a web origin). It does NOT
      require unlocked. It returns `{ filled:false, reason }` on a refusal
      (`'ineligible'` / `'unsatisfiable'` for empty candidates), else calls
      `deps.fillGeneratedDelegate({ wcId, candidates })` →
      `webContents.fromId(wcId)?.send('vault-fill-generated', { candidates })` and
      returns `{ filled: true }`. The return NEVER carries a candidate. The chrome never
      receives or holds the password. Unit tests cover each gate and the no-secret
      return.
- [x] AC14: `webview-preload.js`'s `ipcRenderer.on('vault-fill-generated', (_e, p) => …)`
      does `consumeFillTarget('login')` → `resolveOrdinalInFamily(target, findAllLoginFields(document), LOGIN_ROLES)`
      → `entryTracker.fillGenerated({ candidates: p.candidates, ordinal })`. The tracker
      adds `fillGenerated` via the same `runFill` path.
- [x] AC15: The isolated-world `fillGenerated({ candidates, ordinal })` lives in the
      bootstrap, with its logic in a pure, unit-tested function
      `fillGeneratedForm(doc, candidates, ordinal)`, in `vault-fill-fields.js` or a
      sibling:
      - top-frame only;
      - **a non-integer, out-of-range, or null ordinal fills NOTHING** (never the
        first-field fallback — a generated password in the wrong form is worse than
        none);
      - scope = `loginScopeOrdinals`; `classifyPasswordScope` must return `classified`
        with a `new` role, else fill nothing;
      - candidate selection: read the NEW field's `pattern` attribute. If present, ≤
        1024 chars, and it compiles as `new RegExp('^(?:' + pattern + ')$', 'v')`, use
        the first candidate that matches it (≤ 128 chars); if none matches, fill
        nothing. If it is absent, too long, or fails to compile, use `candidates[0]`.
        Only strings ≤ 128 chars are considered;
      - fill the `new` field, and the `confirm` field when present, via `setFieldValue`.
        NEVER fill `current` or any username;
      - return `{ filled, fields: [{field, value}] }`, which the bootstrap passes to
        `observer.grantForFill`, exactly like `fillLogin`.

      Unit tests cover:
      - a sign-up (new + confirm both filled with the same value);
      - a change-password (current untouched);
      - a sign-in scope (nothing filled);
      - a null or stale ordinal (nothing filled);
      - a `pattern` matching only the fallback (the fallback is used);
      - a `pattern` matching neither (nothing filled);
      - an invalid or over-long `pattern` (the primary is used);
      - a returned `fields` list that exactly matches what was written.
- [x] AC16 (end-to-end, from the real trigger, with no mechanism shortcuts): one unit
      test in the vault-capture-plan or corpus suite drives the scenario from
      `fillGeneratedForm`'s output. It grants provenance through the real observer's
      `grantForFill`, synthesizes the form's submit-button click, and runs the real
      `resolveGestureTargets` + `planCaptures`. The planned login's `password` must
      decode to the generated value, on a sign-up fixture AND on a change-password
      fixture (the latter also carrying `currentPassword`). This proves "survives into
      the vault through the same save path" at the planner boundary. The main
      disposition is Leg 2's, already tested.

**Build, gates, docs**
- [x] AC17: `password-policy.js` is reachable from main via `require()` (sync
      require(esm), the `settings-store`/`search-engines.js` precedent).
      `password-field-roles.js`'s new function and `fillGeneratedForm` bundle into the
      isolated-world observer script (`scripts/build-preload.mjs`'s
      `buildObserverScript`). Verify the generated bundle builds and the preload bundle
      builds (`npm run` the preload build, or whatever `npm start`/`dev:automation`
      invokes). No new runtime dependency.
- [x] AC18: `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`
      are green; no `renderer.js` change; `SEAM_COUNT` unchanged.
- [x] AC19: Docs.
      - CLAUDE.md's Password vault pattern gets a "Generate in picker" bullet covering:
        the payload and its main validation; availability decided main-side by
        `resolvePolicy`; the locked-picker branch; chrome never holding the password;
        two candidates with `pattern` only in the isolated world; no-fallback ordinal;
        `grantForFill`.
      - `docs/vault.md` gets the same in operator terms.
      - Note the `passwordrules` subset supported.

## Verification Steps

- `node --test` over:
  - `test/unit/password-policy.test.js` (new);
  - the `password-generator` tests (unmodified plus new);
  - `password-field-roles.test.js`;
  - the `vault-fill-icon` tests;
  - the `register-browser-ipc` tests;
  - the `vault-picker-template` tests;
  - `vault-controller-capture.test.js` (or a new `vault-controller-generate.test.js`);
  - the vault-human suites;
  - the new `fillGeneratedForm` tests;
  - AC16's end-to-end test.
- The preload/observer bundle build succeeds (AC17).
- `timeout 600 npm test && npm run lint && npm run typecheck && npm run format:check`.
- Neuter checks (record them in the flight log):
  - make `fillGeneratedForm` fall back to ordinal 0 on a null ordinal → the stale-ordinal
    test goes red;
  - make it also fill the `current` field → the change-password test goes red;
  - make the main gesture handler forward a malformed `generate` → the AC8 test goes red.
- Live generation, the picker rows, and the save offer are checked at the HAT (DD12).

## Implementation Guidance

1. `password-policy.js`, plus the generator extension, plus tests.
2. `generateGestureInfo` plus the `vault-fill-icon.js` payload, plus tests.
3. Main gesture validation, plus tests.
4. The picker template action rows (`vault-picker-template.js`), the sheet dispatch in
   **`src/renderer/menu-overlay.js`'s `renderPicker`** (AC9b; without it both rows
   route to "Manage passwords"), and the `vault-controller.js` branches, plus tests.
5. The bridge and the `vault-fill-generated` main handler, plus `fillGenerated` in
   vault-human with its delegate wiring in `main.js`. Note that `main.js` has TWO
   vault-human dep blocks (~line 1368 and ~1525; one is the MCP automation vault
   context). Wire the delegate only where `fillHuman`'s `fillDelegate` for the HUMAN
   path lives, and do not expose generation to the MCP surface.
6. `fillGeneratedForm`, the isolated-world bootstrap method, the tracker method, and the
   preload listener; then rebuild the bundles.
7. AC16's end-to-end test, the neuter checks, docs, and format.

## Edge Cases

- **Gesture TTL expired before Generate is chosen** (the 60 s `FILL_TARGET_TTL_MS`, e.g.
  after a slow unlock): the ordinal is null, so nothing is filled (AC15). This is
  acceptable; the operator clicks the badge again. Do not lengthen the TTL.
- **A page mutates the form between the gesture and the fill**: the isolated world
  re-classifies. If the scope no longer classifies with `new`, nothing is filled (the
  mission's mutation-race Known Issue, narrowed rather than widened).
- **A hostile page marks a sign-in field `new-password`**: the Generate row appears (DD1
  trade-off). If chosen, it fills that one field. Capture then plans a login with the
  generated value (Leg 2's one-field path), and disposition uses today's
  origin+username rule. It cannot reach the password-match update, because there is no
  `currentPassword`. The cost is a wrong-moment offer, not a wrong value.
- **`maxlength` below 8** → `canGenerate` false → no Generate row → today's picker.
- **A card or identity badge click** → payload `{}` → unchanged.
- **Locked vault with Generate chosen**: the fill happens with no unlock. The capture
  that follows raises the existing unlock-to-save path (M12), which is unchanged.
- **Vault not set up**: `onVaultGesture` still returns early (no Generate). The main
  `fillGenerated` also refuses (`isSetUp`).

## Files Affected

- NEW: `src/shared/password-policy.js`, `test/unit/password-policy.test.js`, and a
  `fillGeneratedForm` test file
- `src/shared/password-generator.js` (+ tests)
- `src/preload/password-field-roles.js`, `src/preload/vault-fill-icon.js`,
  `src/preload/webview-preload.js`, `src/preload/vault-entry-tracker.js`,
  `src/preload/vault-entry-observer-bootstrap.js`, `src/preload/vault-fill-fields.js`
  (or a sibling), `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`
  (or wherever contextBridge types live)
- `src/main/register-browser-ipc.js`, `src/main/main.js`, `src/main/vault/vault-human.js`
- `src/shared/vault-picker-template.js`, **`src/renderer/menu-overlay.js`** (the
  `renderPicker` dispatch, AC9b), `src/renderer/chrome/vault-controller.js`, and
  possibly `src/renderer/menu-overlay.css` for the action-row style (optional)
- `eslint.config.mjs` if a new CJS preload module is added
- `CLAUDE.md`, `docs/vault.md`

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing; bundles build
- [x] Neuter checks recorded in the flight log
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`

## Citation Audit

Checked 2026-09-22 against the working tree (Legs 1–2 uncommitted):
- `vault-fill-icon.js`: `onIconClick` (~275–291), `targetForAnchor` (~214),
  `consumeFillTarget` (~243), `FILL_TARGET_TTL_MS` (207)
- `register-browser-ipc.js`: `guest-vault-gesture` (~142), `vault-eligible` (~127)
- `main.js`: `popupVaultIconMenu` (~2360), `vault-reachable-items`/`vault-fill-human`
  (~2390–2400), the `fillDelegate` sites (~1368, ~1525)
- `vault-controller.js`: `openVaultPicker` (114), `onVaultGesture` (~280),
  `onVaultLockState` continuation (~441), `handleActivation` `vault-picker` (~619)
- `vault-picker-template.js`: `renderVaultPickerRows`/`MANAGE_ID`/`parsePickIndex`
- `webview-preload.js` `vault-fill` listener (~449)
- `password-generator.js` `generatePassword`
- `register-tab-ipc.js` `ownsTab` (177)

All present.
