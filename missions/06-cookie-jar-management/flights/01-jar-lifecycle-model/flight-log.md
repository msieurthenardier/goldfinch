# Flight Log: Jar Lifecycle Model

**Flight**: [Jar Lifecycle Model](flight.md)

## Summary

Execution started 2026-07-09 under /agentic-workflow (deferred-review mode: leg
design reviewed per leg; code review and commit deferred until after the last
autonomous leg).

Flight landed 2026-07-09 — all four legs completed, 1132/1132 unit tests green,
deferred code review confirmed with zero issues; committed on
`flight/01-jar-lifecycle-model`.

---

## Flight Director Notes

- 2026-07-09 — Phase file `leg-execution.md` loaded and validated (Developer /
  Reviewer crew, Sonnet). Flight spec passed a 2-cycle Architect design review
  (approve-with-changes → approve); all findings incorporated, two low-severity
  nits fixed post-approval. Flight status `ready` → `in-flight`; branch
  `flight/01-jar-lifecycle-model` created off `main` (baseline 1065/1065).
- Plan: 4 autonomous legs (`store-model`, `load-migration`, `ipc-surface`,
  `verify-integration`), single deferred review + commit at the end.
- 2026-07-09 — Leg 1 (`store-model`) designed; Developer design review returned
  approve-with-changes. Findings incorporated: (1) HIGH — flight spec's
  "`container-menu.test.js` untouched" claim was wrong: its Burner test mints
  `add('Burner')` and pins id `burner`, colliding with the DD4 remap; leg now flips
  it and re-pins tolerance with a hand-built jar object (flight spec annotated).
  (2) MED — interim non-v2 load fallback now suppresses persistence entirely
  (`storePath` stays null) so a mid-flight `add()` can't overwrite a real v1 file;
  blanket suppression ruled acceptable for one leg. (3) MED —
  `init-profile-order.test.js` gains a jars path-arg assertion mirroring
  settings/downloads (forgotten arg would silently never persist). (4) LOW —
  explicit null-storePath guard in save(). Rulings: rename/remove return
  container-or-null uniformly; setDefault returns boolean with idempotent-true
  cases. Second (delta) design review passed → leg `ready`.

- 2026-07-09 — Leg 2 (`load-migration`) designed; Developer design review returned
  approve-with-changes (1 medium: enumerate the three suppression-era comments that
  go stale; 3 low: wrong-version matrix row, keep whole load() body failure-safe,
  assert v1→v2 rewrite-once via file bytes). All applied, plus reviewer suggestions
  (legacy seed asserted by content, fold the two pre-migration corrupt/missing
  tests into probe-explicit matrix rows, 'personal' literal) and rulings on its
  questions (probe-explicit corrupt→fresh testing complies with CP2; added a seed
  clone-integrity pin; flipped suppression pin must assert post-add v2 file shape).
  Second review cycle skipped: every change mechanically applies the reviewer's own
  recommendations, no new design. Leg `ready`.

- 2026-07-09 — Leg 3 (`ipc-surface`) designed around a new testable
  `src/main/jar-ipc.js` module (registerJarIpc with injected deps) instead of
  growing main.js — honoring the M05 debrief's god-file warning. Developer design
  review: approve-with-changes (1 med: `'in'`-operator throws on primitive
  payloads — explicit object guard + non-object test cases added; 2 low: jars-add
  name guard now mirrors new-container-create so both add entry points agree,
  two citation nits fixed). Reviewer confirmed deps-in-scope, registration
  ordering, harness realism, no existing-test breakage, typecheck exposure.
  Rulings: jars-add invalid name → null + no broadcast; settings-changed on
  remove stays unconditional (matches mint path). Suggestions adopted
  (forward-reference note, setDefault idempotent re-broadcast documented,
  set-default-null test, live-array payload assertion note). Second cycle
  skipped (mechanical adoptions only). Leg `ready`.

- 2026-07-09 — Leg 4 (`verify-integration`) designed: real-boot migration matrix
  on XDG_CONFIG_HOME scratch profiles + the real dev profile, auto-mint both
  sides of the interim gap, docs/comment corrections, stale stub cleanup.
  Developer design review: approve-with-changes (1 high: CP4's real-picker smoke
  had no home — added as an admin-apparatus drive of the chrome renderer
  (getChromeTarget + evaluate: jarsList, newContainerCreate, jarsRemove
  end-to-end); 2 med: backup+isolation-probe moved to step 0 before any boot
  (XDG premise has no repo precedent — now empirically confirmed before reliance,
  BLOCKED on failure), docs/mcp-automation.md:124/:60 added to doc scope; 2 low:
  impossible silent-skip edge case reworded, timeout --kill-after + pgrep guard
  added). Reviewer verified the auto-mint code path (throw → caught →
  "[mcp] dev auto-mint failed:" on stderr, bind continues) and located the stale
  comment at main.js:2518-2519. Suggestions adopted (settings.json mint
  side-effect note, cmp-rationale note). Second cycle skipped (mechanical
  adoptions only). Leg `ready`.

---

## Leg Progress

### Leg 1 — store-model (landed 2026-07-09)

**Status**: landed. All 13 acceptance criteria verified; gates green
(`npm test` 1098/1098, `npm run typecheck` clean, `npm run lint` clean).
Test count: 1065 → 1098 (+33; the jars suite grew from 38 to 70 tests,
container-menu gained one, init-profile-order reshaped in place).

**What changed**:
- `src/shared/burner.js` (new) — frozen `BURNER` identity constant, dual
  CJS/global export (safe-color pattern); header documents "compose
  `list() + BURNER`; never a store entry" and flags the `#ff8c42` literal
  duplication in container-menu.js/renderer.js as Flight 2/3 scope.
- `src/main/jars.js` (rewritten) — Electron-free v2 model: `load(userDataPath)`
  arg injection (downloads-store pattern), v2 envelope
  `{version: 2, defaultId, containers}`, default floor removed, reserved
  `burner`/`burner-*` namespace remapped (never dropped) at both validation and
  mint time, `repairDefaultId` (dangling → first survivor; empty → null),
  atomic tmp+rename save with null-storePath guard, full lifecycle API
  (`add`/`rename`/`remove`/`setDefault`/`getDefault`) enforcing the DD2
  exactly-one-default/Burner-fallback invariant. Non-v2 shapes fall back to an
  in-memory Personal(default)+Work seed with persistence fully suppressed
  (`TODO(leg 2 load-migration)` marked). Old four-jar DEFAULTS kept as
  `LEGACY_DEFAULTS` for Leg 2.
- `src/main/init-profile.js` — `jars.load(app.getPath('userData'))`; JSDoc
  stores type and both ordering comments updated (only shields still reads
  `getPath('userData')` internally).
- `test/unit/jars.test.js` — converted off the electron-stub to the
  downloads-store pattern (cache-busted `freshStore()` + `fs.mkdtempSync` per
  test); floor tests flipped/renamed ("no floor: missing default entry is NOT
  injected"); alias-rejection test kept as-is (DD5); new coverage for every
  criterion incl. remap collision cascade, empty-v2-stays-empty, the named
  suppression pins ("suppression pin (Leg 2 flips this): …"), atomic save
  shape, and BURNER frozen.
- `test/unit/container-menu.test.js` — Burner-mint test flipped to the remap
  behavior (`add('Burner')` → `jar-burner`, model item `jar:jar-burner`);
  picker-tolerance premise re-pinned with a hand-built literal `burner`-id jar;
  electron-stub require dropped.
- `test/unit/init-profile-order.test.js` — fake jars store records
  `jars.load:${path}`; both order tests assert the (dev-redirected /
  un-redirected) path; comments updated.

**Notes / deviations**:
- `LEGACY_DEFAULTS` is intentionally unused until Leg 2 — carried with an
  `eslint-disable-next-line no-unused-vars` (repo precedent: renderer.js:641).
- `rename()` gained a one-line JSDoc param annotation: `tsc` inferred the
  destructured `= {}` default as type `{}` and failed typecheck without it.
- `test/unit/safe-color.test.js` still requires the electron-stub before
  requiring jars (harmless — the stub is inert now that jars.js is
  Electron-free). Left untouched: outside this leg's declared file set; a
  candidate cleanup for Leg 4 or the flight review.
- No other deviations; no blockers.

### Leg 2 — load-migration (landed 2026-07-09)

**Status**: landed. All 7 acceptance criteria verified; gates green
(`npm test` 1109/1109, `npm run typecheck` clean, `npm run lint` clean).
Test count: 1098 → 1109 (+11; the jars suite grew from 70 to 81 tests —
13 migration-matrix tests added, the two unconditional corrupt/missing →
fresh-seed pins folded into probe-explicit matrix tests, the two suppression
pins flipped in place).

**What changed**:
- `src/main/jars.js` — `load()` completed with the DD3 three-shape dispatch:
  (a) v2 envelope validate+repair unchanged (never rewritten by load); (b) v1
  bare array validated under the v2 rules (remap + goldfinch-alias drop apply
  during migration), `defaultId = repairDefaultId(validated, 'default')`,
  rewritten as v2 via the atomic `save()` — zero survivors fall through;
  (c) missing/corrupt/unknown-version probes
  `userData/Partitions/goldfinch` (existence only) → legacy four-jar seed
  (`defaultId 'default'`) or fresh Personal+Work seed (`defaultId
  'personal'`), both persisted synchronously inside the same `load()` call
  (the launch-#2 guard). `storePath` is now assigned once before the dispatch
  — persistence unconditional on every shape. The `TODO(leg 2)` block, the
  `storePath = null` suppression, and the `eslint-disable` on
  `LEGACY_DEFAULTS` are gone; header comment gained the migration summary;
  `save()`'s guard comment and the `LEGACY_DEFAULTS` lead comment rewritten
  for the migrated contract. Both seeds cloned via `.map((c) => ({ ...c }))`.
  The outer try still wraps the whole body (never-throws covers non-disk
  faults; the residual fallback is in-memory fresh seed).
- `test/unit/jars.test.js` — CP2 matrix added (`probeDir` helper +
  `validBanking` fixture): operator-shaped v1 fixture with byte-level
  rewrite-exactly-once + reload idempotency; v1-without-default → first
  survivor; v1 burner-id remap with partition intact; zero-validating v1 on
  both probe sides; no-file+probe legacy seed asserted by content
  (persist:goldfinch on `default` only); wrong-version (v3) envelope →
  fresh; launch-#2 pin (fresh seed survives the probe dir appearing);
  corrupt JSON on both probe sides (both rewrite v2); empty-v2
  not-rewritten (byte-compare); seed clone-integrity pin. Suppression pins
  renamed/inverted to "persistence pin (flipped Leg 1 suppression)",
  asserting post-add FILE SHAPE (v2 envelope containing the new jar). The
  add-before-load no-write pin untouched. Banners at the load section and
  the (former) suppression section rewritten for the migrated contract.

**Notes / deviations**:
- Seed clone-integrity pin implemented with a SAME-module-instance re-load
  (legacy load → `rename('default', {name:'X'})` → delete `containers.json`
  → `load()` again on the same store → name is `Default`) instead of the
  leg's literal "fresh module require" between the mutation and the
  re-load: a cache-busted re-require re-instantiates `LEGACY_DEFAULTS`,
  which would make the pin pass even if `load()` aliased the constant —
  the same-instance re-seed is the version that actually detects aliasing.
  Intent (prove branch (c) clones, never aliases) preserved.
- Branch (c)'s fresh `defaultId` uses the literal `'personal'` per the
  implementation guidance (matching the mission criterion naming Personal),
  not `FRESH_SEED[0].id`.
- No other deviations; no blockers. Not committed (deferred-review flight).

### Leg 3 — ipc-surface (landed 2026-07-09)

**Status**: landed. All 7 acceptance criteria verified; gates green
(`npm test` 1131/1131, `npm run typecheck` clean, `npm run lint` clean).
Test count: 1109 → 1131 (+22; new `jar-ipc.test.js` suite — no existing
test touched).

**What changed**:
- `src/main/jar-ipc.js` (new) — Electron-free `registerJarIpc(deps)` module
  (deps injected: `ipcMain`, `jars`, `session`, `rerollSeed`, `revokeJarKey`,
  `settings`, `broadcast`) registering the six jar-registry channels:
  `jars-list` (bare-array passthrough, DD7), `jars-add` (name guard mirroring
  `new-container-create`), `jars-rename` (patch built from only the fields
  present in the payload via post-guard `'in'` checks), `jars-set-default`
  (boolean; idempotent re-broadcast on the current holder documented),
  `jars-get-default` (jar-or-BURNER), and the async `jars-remove` composing
  the DD6 delete: `jars.remove()` → partition wipe (`clearStorageData` +
  `clearCache`, the only fail-soft step → `wiped` flag) → `rerollSeed(ses)` →
  `revokeJarKey(removed.id, settings)` → unconditional `settings-changed`
  broadcast (`settings.getAll()`) → `jars-changed`. Every mutating handler is
  payload-hardened (explicit object guard before any `'in'` access — never
  throws on undefined/string/number payloads) and broadcasts `jars-changed`
  `{ containers: jars.list(), defaultId }` (defaultId by BURNER reference
  identity, null ⇔ Burner) only on success. Returns `{ broadcastJarsChanged }`.
  Header documents DD6/DD7 (chrome-trusted; Flight 3 adds the
  internal-origin-gated variants).
- `src/main/main.js` — the two inline `jars-list`/`jars-add` handlers at the
  "cookie jars / container identities" section replaced by the `registerJarIpc`
  call wired with real deps (`broadcast: broadcastToChromeAndInternal`), with
  the chrome-trusted/DD7 comment; `new-container-create` now calls
  `broadcastJarsChanged()` after `jars.add` (forward `const` reference noted in
  a comment — handler runs post-module-eval); one new require. Net growth kept
  minimal (~+16 lines); `identity-new` untouched.
- `src/preload/chrome-preload.js` — `jarsRename`/`jarsRemove`/`jarsSetDefault`/
  `jarsGetDefault` invoke wrappers beside `jarsList`/`jarsAdd`, plus
  `onJarsChanged(cb)` (the `onShieldsChanged` pattern).
- `test/unit/jar-ipc.test.js` (new, 22 tests) — fake-`ipcMain` harness with a
  real cache-busted temp-dir jars store and an in-order event log spanning
  wipe/reroll/revoke/broadcast spies; broadcast payloads snapshotted at emit
  time (structuredClone) with one pin documenting the live-array reference.
  Covers: exactly-six-channels registration, list passthrough, add broadcast
  shape (empty-store string defaultId included), add name-guard (`{}` /
  `{ name: 42 }`), rename field-preservation (+ explicit `name: undefined`
  non-clobber), rename/set-default unknown-id no-broadcast failures,
  set-default `{ id: null }` both DD2 sides (false with jars; true +
  `defaultId: null` broadcast on empty), get-default BURNER reference
  equality, full remove composition ordering incl. default-flag reassignment
  in the payload, remove-last-jar (`containers: []`, `defaultId: null`,
  BURNER), remove unknown-id zero-side-effects, throwing-wipe fail-soft
  (`wiped: false`, rest runs), undefined-payload hardening across all four
  mutating channels + string payload for rename, and the returned
  `broadcastJarsChanged`.

**Notes / deviations**:
- The Verification Steps' `grep -c "ipcMain.handle" src/main/jar-ipc.js`
  returns 7, not 6: six real registrations plus one hit in the header
  comment's "bare `ipcMain.handle`" phrase. The registration count is pinned
  at exactly six by the test suite ("no others").
- The `grep -n "jars-list\|jars-add" src/main/main.js` verification returns
  zero hits (expected "only the registerJarIpc call region"): the replacement
  comment names the channels descriptively without the hyphenated literals.
  No inline handlers remain.
- No other deviations; no blockers. Not committed (deferred-review flight).

### Leg 4 — verify-integration (landed 2026-07-09)

**Status**: landed. All acceptance criteria verified; gates green
(`npm test` 1132/1132, `npm run typecheck` clean, `npm run lint` clean).
Test count: 1131 → 1132 (+1: a jars-suite pin for the integration defect
found and fixed during Scenario A — see Deviations below; the leg's expected
test delta was 0).

**What changed**:
- `src/main/jars.js` — one minimal fix inside `save()`: `fs.mkdirSync(dirname,
  { recursive: true })` before the tmp write (deviation D1 below).
- `test/unit/jars.test.js` — one new test pinning D1 ("userData dir not yet
  created (true first boot) → seed still persists; launch #2 stays fresh").
- `src/main/main.js` — auto-mint comment block only: the "'default' … always
  present in jars.list()" claim replaced with the fresh-install gap
  (migrated/legacy profiles have it; fresh seed is Personal+Work; graceful
  stderr failure path; M06 Flight 2 retires the hardcoded id). No code change.
- `README.md` — container bullet rewritten for the v2 model (new installs:
  Personal default + Work; existing profiles keep their set; burner unchanged;
  fuller jar management arrives later in the mission); jars.js architecture
  table row now describes the lifecycle model.
- `CLAUDE.md` — persisted-state line notes the v2 `containers.json` envelope +
  in-place v1 migration.
- `docs/mcp-automation.md` — the mint-line "`default`-jar key (always present
  under the double gate)" claim corrected with the same fresh-install gap as
  the main.js comment; the "the `default` jar is the usual starting point"
  step softened for fresh installs (pick e.g. `personal` there).
- `test/unit/safe-color.test.js` — the inert electron-stub require dropped
  (Leg 1 carried cleanup); suite still passes, identity pin intact.
- Grep pass over README/CLAUDE.md/docs for container-set and
  auto-mint/`default`-jar claims: no contradicted claims remain. The
  `tests/behavior/*.md` specs that mint against the `default` jar run against
  the operator's legacy-shaped dev profile and remain correct — noted, not
  edited (per the leg contract).

#### Leg 4 verification matrix

All boots real `npm start` / `npm run dev:automation` under WSLg, bounded with
`timeout --kill-after=5 <N>`; between scenarios an orphan guard
(`pgrep` for the electron binary) confirmed no leftover process. Paths
sanitized: `~` = operator home, `<scratch>` = temp scratch root.

- **Step 0 — backup + isolation probe: PASS.** `~/.config/goldfinch-dev/
  containers.json` copied to `containers.json.v1.bak` (12-jar v1 bare array)
  BEFORE any boot. After Scenario A's first boot: `<scratch>/xdgA/goldfinch-dev/
  containers.json` exists AND `cmp` of the real file against the backup showed
  zero drift → `XDG_CONFIG_HOME` isolation empirically confirmed before any
  further scenario relied on it.
  - **Backup purpose (restoration path)**: until this flight merges, a
    `main`-branch launch against the migrated profile sees a v2 envelope,
    fails its v1 validation, and falls back to the old four DEFAULTS in the
    picker (registry only; data dirs untouched). To restore the pre-flight
    state: `cp ~/.config/goldfinch-dev/containers.json{.v1.bak,}`.
- **Scenario A — fresh-profile boot ×2: PASS** (after deviation D1 fix).
  Boot 1 on a brand-new `XDG_CONFIG_HOME` scratch produced
  `<scratch>/xdgA/goldfinch-dev/containers.json`:
  `{ "version": 2, "defaultId": "personal", containers: [personal, work] }`
  (exactly those two ids, that order), and
  `<scratch>/xdgA/goldfinch-dev/Partitions/goldfinch` existed post-run (the
  pre-warm fired). Boot 2 left the file byte-identical (`cmp` clean) — the
  launch-#2 pin exercised against the real pre-warm.
- **Scenario B — legacy-shaped boot: PASS.** Scratch with
  `<scratch>/xdgB/goldfinch-dev/Partitions/goldfinch` pre-created and no
  containers.json → one boot → v2 envelope with exactly
  `default,personal,work,banking`, `defaultId: "default"`, partitions
  `persist:goldfinch` + the three `persist:container:*`.
- **Scenario C — real dev profile v1 migration: PASS.** One boot migrated
  `~/.config/goldfinch-dev/containers.json` in place to
  `{ version: 2, defaultId: "default", … }` preserving ALL twelve ids in
  order (default, personal, work, banking, shopping, seed1–seed6, hat-test)
  with every partition string unchanged (asserted programmatically against
  the pre-run backup, per the drift edge case).
- **Auto-mint, legacy side: PASS.** `GOLDFINCH_AUTOMATION_ADMIN=1
  GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` on the migrated real
  profile printed the single parseable mint line to stdout (keys redacted):
  `AUTOMATION_DEV_MINT {"key":"<redacted>","adminKey":"<redacted>"}` — the
  `default` jar survived migration, so the hardcode still resolves.
  - **Side-effect noted (with the backup note above)**: this run rewrites
    `automationKeyHashes.default` and `automationAdminKeyHash` in the REAL
    profile's `settings.json` (normal dev-mint behavior). Pre/post key-name
    set unchanged (`default`, `personal`, `work`); the default-jar and admin
    hashes now correspond to the (discarded) verification-run keys.
- **Picker data-path smoke (CP4): PASS** (attach attempt 2 of the allowed 2 —
  see deviation D2). Attached over the loopback MCP with the admin key
  (throwaway scratch-dir SDK client, a11y-audit attach pattern — not added to
  the repo), `getChromeTarget` → `{ wcId: 1, kind: "chrome" }`, then via
  `evaluate` on the chrome renderer:
  - `goldfinch.jarsList()` → the 12 migrated jars (exact ids, order preserved);
  - `goldfinch.newContainerCreate('cp4-smoke')` →
    `{ id: "cp4-smoke", name: "cp4-smoke", color: "#b06ef5",
    partition: "persist:container:cp4-smoke" }`; follow-up `jarsList()`
    included it (13) AND on-disk containers.json gained it;
  - `goldfinch.jarsRemove({ id: 'cp4-smoke' })` →
    `{ ok: true, removed: {…cp4-smoke…}, wiped: true }`; the jar disappeared
    from `jarsList()` (12) and from the file — first real-app exercise of the
    Leg 3 delete composition. Post-smoke the real store is the same 12-jar v2.
- **Auto-mint, fresh side (interim gap): PASS.** Same launch on a fresh
  scratch (`<scratch>/xdgC`): the mint failure took the documented graceful
  path and the boot demonstrably continued. Observed (sanitized) stderr:
  `[mcp] dev auto-mint failed: mintJarKey: jarId default is not a known jar
  (burner ids and unknown ids are not valid mint targets)` — no
  `AUTOMATION_DEV_MINT` line; renderer/GPU log lines continue AFTER the
  failure line; the MCP surface bound independently of the mint (evidence
  adaptation D3: the code emits no bind-success line, so binding was proven
  by a live loopback probe while the app ran — the automation port was
  LISTENing and answered `HTTP 401` without a key, i.e. the auth gate live).
  The scratch profile also seeded fresh (v2, personal+work) — consistent
  with Scenario A post-fix.
- **Gates: PASS.** `npm test` 1132/1132 (baseline 1131 + the D1 pin),
  `npm run typecheck` clean, `npm run lint` clean. `grep electron-stub
  test/unit/safe-color.test.js` → no require (only the explanatory comment).

**Notes / deviations**:
- **D1 — integration defect found (Scenario A, first run) and fixed
  minimally.** On a true first boot the fresh seed was NOT persisted:
  `containers.json` never appeared in the scratch profile. Root cause —
  `jars.load()` runs in `whenReady` before Electron has created the
  dev-redirected userData dir (Electron creates it lazily; only the
  prod-named dir exists that early for Local State/Crashpad), so the DD3c
  synchronous seed persist ENOENTed into `save()`'s fail-soft catch.
  Reproduced at unit level (load() against a nonexistent dir → no file).
  Integration consequence: the pre-warm then creates `Partitions/goldfinch`,
  so launch #2 re-probes the fresh install as LEGACY — the exact DD3 bug the
  launch-#2 pin exists to prevent (the unit matrix passed because mkdtemp
  dirs always exist — an integration-only ordering effect, as the leg
  anticipated). Fix: `fs.mkdirSync(path.dirname(storePath), { recursive:
  true })` in `jars.js save()` (siblings settings/downloads don't need it —
  they first save on user action, after the dir exists). This implements
  DD3c/DD8's intended behavior — no flight design decision changed. One unit
  test added; full gates AND all four boot scenarios re-run green post-fix.
- **D2 — MCP attach attempt 1 failed on port discovery, attempt 2 passed.**
  The client's default `127.0.0.1:49707` connect timed out: the server's
  free-port fallback had bound `49709` (49707 unreachable on this rig —
  connect timeout rather than refusal, consistent with the WSL2 mirrored-
  networking Windows-side holding the port; the persisted `automationPort` is
  still 49707). Attempt 2 discovered the live port from the listening
  process and passed in full. No product defect — the fallback behaved as
  designed; the smoke run's GUI bound was raised 25s → 90s to fit the
  attach window (leg edge case "raise the bound").
- **D3 — "MCP bind line" AC adapted.** main.js logs only bind FAILURE
  (`[mcp] failed to start automation server: …`); there is no bind-success
  stdout line to observe after the mint-failure line. Boot continuation +
  independent bind were instead proven by post-failure log output plus a
  live port probe (LISTEN + HTTP 401) while the fresh-side run was up.
- The throwaway MCP smoke client lived in the session scratch dir and was
  never added to the repo; no absolute home paths were written into any
  artifact or repo file.
- Not committed (deferred-review flight); flight stays `in-flight` for the
  Flight Director's review+commit.

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes
