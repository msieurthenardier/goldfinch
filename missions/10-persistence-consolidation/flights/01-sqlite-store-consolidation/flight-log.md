# Flight Log: SQLite Store Consolidation

**Flight**: [SQLite Store Consolidation](flight.md)

## Summary

Flight executed 2026-07-17: all 3 legs completed, flight-end review [HANDOFF:confirmed] with zero issues, behavior gate sqlite-store-migration PASS 6/6. Suite 1973 → 2017 pass / 0 fail. Flight landed.

---

## Reconnaissance Report

Source artifacts: GitHub issue #94 (goal 1 + shared acceptance criteria) and
the BACKLOG seed "Persistent storage substrate: JSON stores → SQLite".
Verified against `main` @ `50e17fc` at flight design (mission-design survey +
Architect probe, 2026-07-17).

| Item | Classification | Evidence | Recommendation |
|------|---------------|----------|----------------|
| settings on JSON file | confirmed-live | `src/main/settings-store.js` → `userData/settings.json`; codec seam at :175-179 | Migrate (leg 1) |
| downloads on JSON file | confirmed-live | `src/main/downloads-store.js` → `downloads.json`; codec seam :58-62; "SQLite migration lifts this" comment :41 | Migrate (leg 1) |
| session on JSON file | confirmed-live | `src/main/session-store.js` → `session.json`; codec seam :46-50 | Migrate (leg 1) |
| jars on JSON file | confirmed-live | `src/main/jars.js` → `containers.json` v2 envelope; no codec seam; three-shape load :175-243 | Migrate (leg 2) |
| shields on JSON file, below discipline | confirmed-live | `src/main/shields.js` — `require('electron')` :7, self-resolved path :33, non-atomic swallow-errors save :44-50 | Migrate + DD8 rework (leg 2) |
| "codec seam anticipates SQLite backend" premise | confirmed-live | header comments in settings/downloads/session stores | Seam is the swap point (DD3) |
| BACKLOG "re-home settings+downloads behind repo interface" | confirmed-live (superset here) | BACKLOG.md:137-180 | Retire entry at leg 3; fix stale "Node ≥ 22.12" note (real: bundled 24.18) |
| BACKLOG "crash-survivable in-progress downloads" rider | out-of-scope (mission ruling) | mission.md Open Questions | Not scheduled; noted in DD3 trade-off |
| DD1 re-affirmation request (issue goal 1 bullet) | confirmed-live | M08 F1 flight.md DD1; no re-affirmation exists yet | Flight DD1 + leg 3 docs |

No `already-satisfied` or `drifted` items. Autonomous mode: retirements
confirmed by Flight Director under the mission's pre-authorization.

---

## Leg Progress

- 2026-07-17: Leg 1 `app-db-and-codec-stores` implemented.
  - **New**: `src/main/app-db.js` — Electron-free, module-singleton
    `node:sqlite` substrate for `userData/app.db` (WAL + `synchronous=NORMAL`,
    `user_version=1` bootstrap of `documents(store, payload, updated_at)`,
    quarantine-and-recreate on a corrupt file, idempotent `close()`,
    `createDocumentStore(name)` → `{ read, write, remove }` seam). Cloned from
    `history-store.js`'s proven seams per the leg guidance.
  - **Converted**: `settings-store.js`, `downloads-store.js`,
    `session-store.js` now persist through app-db document rows keyed
    `'settings'` / `'downloads'` / `'session'` instead of standalone JSON
    files. Public module exports and codec-seam option signatures are
    byte-identical to before. Each store's `load()` resolves its document
    store and reads the row **outside** the existing catch-all
    never-throws try (an app-db-not-open error now propagates as a clear
    "programmer error", per design review); everything else (JSON parse,
    repair, migration rename) keeps the never-throw contract. One-time
    migration: row-absent + legacy JSON present → existing
    repair/validate/normalize logic runs unchanged → repaired result
    written as the row → legacy file renamed `<name>.json.migrated`
    (best-effort, including for a corrupt legacy file — the repaired-to-
    defaults/empty result is what migrates). Row-present → legacy JSON
    ignored, no re-import. Neither → in-memory defaults, no row write.
    `session-store.clear()` now removes the row (best-effort) plus any
    lingering **bare** `session.json`, never touching a `.migrated`
    sibling — M09 semantics preserved.
  - **`main.js`**: `appDb.open(app.getPath('userData'))` wired immediately
    before `initProfileAndStores(...)`; `appDb.close()` added to the
    existing `will-quit` handler beside `historyStore.close()`; the
    `session-store.load()` call-site comment (main.js:3739-3741 pre-leg)
    touched up to describe the app-db-backed failure mode instead of the
    old "throws without a load()-set dir" framing.
  - **Tests**: new `test/unit/app-db.test.js` (17 tests — interface,
    Electron-free, lifecycle, schema bootstrap, document read/write/
    upsert/remove/isolation round-trips, `updated_at` default vs explicit
    `now`, idempotent close/re-open, corrupt-file quarantine incl.
    `-wal`/`-shm` siblings, write-during-load synchrony). Updated
    `settings-store.test.js` (+6), `downloads-store.test.js` (+5),
    `session-store.test.js` (+7) with: `appDb` required ONCE per file
    (never cache-busted) and reset per test via `appDb.open(newTmpDir)`
    per the design-review require-order-hazard ruling; a `load() throws
    when app-db is not open` test per store; dedicated migration cases
    (values-intact + rename, corrupt-JSON-still-migrates + rename,
    row-wins-over-stray-JSON no re-import, fresh-dir defaults with no row
    write); the three tests that had asserted directly on the JSON file
    (settings "atomic write...", downloads "atomic write...", session
    "atomic write...") were converted to assert on the document row
    instead, per the leg's "convert to row/.migrated assertions" note —
    all other existing behavioral assertions pass unmodified.
  - **Test counts**: suite baseline 1973 pass / 0 fail → **2008 pass / 0
    fail** (+35: 17 new app-db + 6 settings + 5 downloads + 7 session, net
    of the 3 renamed/repurposed file-assertion tests). `npm run typecheck`
    and `npm run lint` both green.
  - **Grep checks** (Verification Steps): no `require('electron')` call in
    `app-db.js` (the header's prose comment mentions the string, same as
    `history-store.js`'s identical comment — not a real import); no
    `writeFileSync`/tmp+rename write path remains in any of the three
    converted stores' `save()`/`write()` — only the one-time `.migrated`
    `renameSync` at migration remains.
  - Leg → `landed`. [HANDOFF:review-needed]

- 2026-07-17: Leg 2 `jars-shields-boot-seam` implemented.
  - **`jars.js`**: built the codec seam from scratch (none existed pre-leg) —
    module-scoped `docStore` + `{ serialize, deserialize }` pair defaulting to
    `JSON.stringify(…, null, 2)`/`JSON.parse`, injectable via a new optional
    `opts` arg on `load(userDataPath, opts?)`. Row resolved + read OUTSIDE the
    never-throw catch-all (an app-db-not-open error propagates). Known-shape
    migration: v2 envelope AND v1 bare array both validate through the
    existing logic, `save()` the row, then best-effort rename
    `containers.json` → `.migrated`. **Unknown-version carve-out preserved
    exactly**: that branch returns before any row write or rename — pinned by
    the untouched `jars-security-forward-version.test.js` byte-identity
    assertion plus two new dedicated tests. Seed branches (probe-dependent
    FRESH_SEED/LEGACY_DEFAULTS) unchanged in logic, now persisting to the row.
    `save()` keeps its ENTIRE body (including the `docStore.write` call)
    inside the existing swallow-all try, so `add()` before `load()` still
    fail-soft no-ops exactly as the old unset-`storePath` guard did —
    `container-menu.test.js`'s pre-load `jars.add()` premise needed zero
    changes and the file is byte-identical.
  - **`shields.js`** (DD8 rework): dropped `require('electron')`; gained
    `load(userDataPath, opts?)` with the same codec seam + row-backed
    migration (merge-over-DEFAULTS repair, unchanged) as the other stores.
    `save()` now reads `if (!docStore) return;` (the not-loaded no-op,
    preserving today's semantics for the ~9 pre-load mutation sites in
    shields.test.js) followed by an UNGUARDED `docStore.write(...)` — a
    loaded-state write failure now propagates uncaught (DD10 refined),
    replacing the old swallow-everything catch. Public API unchanged plus the
    new `opts` param.
  - **`init-profile.js`**: signature widened to `{ appDb, shields, settings,
    jars, downloads }`; sequence is now dev redirect → `appDb.open(userData)`
    → `shields.load(userData)` → `settings.load` → `jars.load` →
    `downloads.load`. This is the permanent fix for leg 1's flagged dev-mode
    ordering nuance (the interim sibling `appDb.open` ran before the redirect;
    it now runs after, alongside every other store).
  - **`main.js`**: removed the leg-1 interim `appDb.open(...)` sibling call
    and its comment block; `appDb` is now passed into
    `initProfileAndStores(...)`. `will-quit`'s `appDb.close()` unchanged.
    Zero `appDb.open` references remain in `main.js` (grep-verified).
  - **Tests**: `init-profile-order.test.js` re-pinned to the new
    signature/order as a named, deliberate change (DD9) — asserts
    `setPath < appDb.open < {shields,settings,jars,downloads}.load` and that
    the dev-redirected path reaches all five. `jars.test.js` (94 → 96):
    every `load()`-touching test gained the leg-1 `appDb.open(dir)`/`close()`
    per-test pattern; every assertion that previously read the persisted
    envelope off `containers.json` was converted to read the app-db row
    instead (a new `readRow()` helper), since `save()` no longer touches the
    file at all; migration-matrix tests updated to assert the legacy file is
    renamed `.migrated` (not rewritten in place, the pre-SQLite behavior);
    added the carve-out's dedicated "no row is created" pin and a
    throws-before-open pin. `jars-security-forward-version.test.js` (3, no
    count change): setup gained `appDb.open`/`close`; the byte-identity
    assertion itself is untouched. `jar-ipc.test.js` (59, no count change):
    `makeHarness()` gained `appDb.open(dir)` + `t.after` close, per the
    design-review-flagged 59-test blast radius. `shields.test.js` (21 → 28):
    dropped the `electron-stub` require; stateful tests now cache-bust the
    module per test (`freshStore()`, the jars.test.js pattern) since the
    store is no longer a config-mutate-in-place-forever singleton across the
    file; pre-load tests need no `appDb` at all (docStore stays null); added
    migration cases (values-intact + rename, corrupt-repaired + rename,
    row-wins, fresh-dir), a throws-before-open pin, an explicit not-loaded
    no-op pin, and a DD10 loaded-write-propagates pin (via an injected
    throwing `serialize`). `container-menu.test.js` is byte-for-byte
    unmodified (`git diff` empty) and stays green.
  - **Test counts**: 2008 pass / 0 fail (post-leg-1) → **2017 pass / 0 fail**
    (+9: +2 jars, +7 shields, 0 net elsewhere). `npm run typecheck` and
    `npm run lint` both green.
  - **Grep checks** (Verification Steps): no `require('electron')` call in
    `shields.js` (only the header comment's prose mentions the string); no
    `writeFileSync` in either `jars.js` or `shields.js` — only the one-time
    `.migrated` `renameSync` remains in each; `main.js` has zero `appDb.open`
    references and exactly one `appDb.close()` at `will-quit`.
  - Leg → `landed`. [HANDOFF:review-needed]

- 2026-07-17: Leg 3 `migration-verification-and-docs` — **docs portion**
  implemented (guidance step 1; the live behavior-test gate, guidance step
  2, is run separately by the Flight Director next).
  - **CLAUDE.md**: read the actual leg-1/leg-2 code (`app-db.js` + all five
    converted stores + `init-profile.js` + `main.js`'s `whenReady`/
    `will-quit`) rather than the flight plan, so the docs describe reality.
    Settings store section updated: the "Durable and atomic" bullet (the
    old tmp-file/`renameSync` description) replaced with the app-db
    document-row UPSERT path; "Persisted location" now names the `app.db`
    row + the one-time `.migrated` rename, not `settings.json` as the live
    file. New **"App database" section** inserted between Settings store
    and History store (mirroring History store's depth): substrate
    ruling (DD1 re-affirmed + widened to the whole persistence layer, with
    the corrected bundled-Node-24.18 fact folded in), the `documents`
    table + `createDocumentStore` seam (DD3), the `app.db` WAL family +
    `will-quit` close ordering beside `historyStore.close()` (DD7), the
    import-once-then-`.migrated` migration semantics (DD5) including the
    jars unknown-version carve-out, quarantine-and-recreate-fresh-defaults
    (DD6) including the deliberate jars branch-dependent post-quarantine
    reseed, and shields' DD8/DD10 house-discipline + write-error-
    propagation posture. History store's intro sentence and DD1/tax
    bullets updated to cross-link the new section (the old "unlike the
    JSON-file codec pattern (settings-store.js / downloads-store.js)"
    line was stale — both are now document-row stores). Also fixed two
    other spots the code-read surfaced as stale: the Architecture section's
    "Persisted state lives in userData: shields.json, containers.json"
    line, and the "mkdirSync-before-synchronous-persist" pattern's
    `jars.js:218` citation (that call moved to `app-db.js`'s `open()` when
    jars stopped writing its own file in leg 2). Grepped
    `settings.json`/`shields.json`/`containers.json`/`downloads.json`/
    `session.json`: all remaining hits are historical/migration-context,
    per the leg's Verification Steps.
  - **BACKLOG.md**: "Persistent storage substrate: JSON stores → SQLite"
    retired using the project's landed-entry pattern (title kept, body
    replaced by a Status line + pointer, matching the "Tab strip:
    Chrome-style shrink" entry's shape) — pointer to M10 F1
    (`sqlite-store-consolidation`) and to CLAUDE.md's new App database
    section. Fixed the stale "Node ≥ 22.12" claim in the same motion (the
    entry's only other content) — verified: Electron 42.6.1 bundles Node
    24.18, `node:sqlite` unflagged.
  - **Verification**: `npm test` 2017 pass / 0 fail (unchanged from the
    leg-2 baseline — docs-only change, no test-affecting edit); `npm run
    typecheck` and `npm run lint` both green.
  - Leg stays `in-flight`: the behavior-test gate
    (`/behavior-test sqlite-store-migration`) is the leg's other guidance
    step and runs next, directly by the Flight Director. [HANDOFF:review-needed]

---

## Flight Director Notes

- 2026-07-17: Flight → in-flight; branch `flight/01-sqlite-store-consolidation`
  created. Crew file `leg-execution.md` validated (Crew/Protocol/Prompts
  present).
- 2026-07-17: Leg 1 `app-db-and-codec-stores` designed. **Risk tier: HIGH**
  — new DB schema + one-time data migration across three shared stores;
  per-leg design review required before implementation.
- 2026-07-17: Leg 1 design review (Developer, 1 cycle): **approve with
  changes**. High: doc-store resolution/read must sit OUTSIDE the stores'
  catch-all never-throw try (mis-ordered boot must propagate, not dissolve
  into defaults) — guidance hardened + per-store throws-before-open test
  pinned. Medium: no app-db cache-busting in store suites (require-order
  hazard) — require-once + open(newDir) reset pattern specified. Plus:
  updated_at determinism scoped to app-db tests only; session clear()
  never-throws preserved; main.js:3739 comment touch-up folded in. All 16
  citations verified OK; baseline re-verified. Second cycle skipped
  (changes adopt reviewer's recommendations). Leg 1 → ready.
  [HANDOFF:review-needed] emitted; proceeding to implementation spawn.
- 2026-07-17: Leg 2 `jars-shields-boot-seam` designed. **Risk tier: HIGH**
  — boot-seam shared-interface change + pinned-test updates + migration
  with a security-pinned carve-out. Design review (Developer, 1 cycle):
  **approve with changes**. High: `jar-ipc.test.js` (59 tests) missing
  from blast radius → added with the leg-1 app-db pattern. High: shields
  pre-load mutation sites (~9, unwrapped) would throw under a naive DD10 →
  **FD ruling refines DD10**: `save()` keeps the not-loaded silent no-op
  (exactly today's `if (configPath)` semantics — the least-change option,
  intersecting both reviewer alternatives), while loaded-state write
  errors propagate (DD10's actual target). Medium: container-menu.test.js
  pre-load `jars.add()` fail-soft dependency named in Edge Cases (keep
  save()'s whole body in the swallow). Low: grep wording fixed;
  forward-version setup requirement made definite. Second cycle skipped —
  the shields ruling strictly preserves current behavior and the
  flight-end review sees the final code. Leg 2 → ready.
- 2026-07-17: Leg 3 `migration-verification-and-docs` designed. **Risk
  tier: LOW** — docs-only code changes + a verification run; no
  schema/interface surface. Per-leg design review skipped per protocol;
  the flight-end Reviewer covers the docs. Apparatus premise audited: no
  instance running, Wayland socket present, launchable in-session;
  dev-profile backup/restore mandatory. Leg 3 → ready.
- 2026-07-17: **Behavior test `sqlite-store-migration` RUN: PASS 6/6
  checkpoints** (run log `tests/behavior/sqlite-store-migration/runs/2026-07-17-20-46-52.md`;
  spec → active). Live two-agent Witnessed mode. Migration fidelity, one-time
  semantics (byte-identical `.migrated` across restart), and corrupt-DB
  quarantine-to-defaults ALL verified on the real rig; DD6's
  branch-dependent legacy reseed observed live exactly as designed. Two
  apparatus premise-corrections recorded in the run log + spec header
  (openTab-vs-internal-pages; the sanctioned admin-key mechanism via
  `scripts/lib/mcp-client.mjs`). Notable crew moment: the Executor
  correctly REFUSED the FD's first proposed key mechanism (argv exposure)
  — refusal accepted, better mechanism adopted; feed to debrief.
- 2026-07-17: **Security note (FD, for HAT scope)**: while inspecting
  `.mcp.json` the FD printed the registered jar-scoped bearer key into its
  own session transcript (redaction regex missed a leading-underscore
  token). Loopback-only credential, but per the standing carry this is a
  leak: **rotate/re-mint the automation keys during the HAT flight** and
  re-register the session MCP entry. Leg 3 → landed.
- 2026-07-17: Flight-end review (Reviewer, 1 cycle): **[HANDOFF:confirmed]**,
  zero blocking/non-blocking issues; suite 2017/typecheck/lint re-verified;
  security grep of committed artifacts clean. Committed `7d1ae66`; branch
  pushed; **PR #96 opened (draft)**. `gh pr ready`/`gh pr merge` are
  classifier-blocked in this session's permission mode — the PR remains
  DRAFT for the operator; **promote + merge scoped to the HAT flight**.
  Flight 2 will stack on `flight/01-sqlite-store-consolidation` (M09 F9
  stacked-PR precedent). Flight → landed. [COMPLETE:flight]

---

## Decisions

- 2026-07-17 (Leg 1 implementation): Implemented the leg's `main.js` wiring
  literally — `appDb.open(app.getPath('userData'))` immediately before
  `initProfileAndStores(...)`. Note for leg 2 / whoever reshapes
  `init-profile.js`: `initProfileAndStores` runs the dev-profile
  `app.setPath('userData', …)` redirect as its OWN first step (the
  invariant documented in `init-profile.js`'s header), so this leg-1
  sibling call to `appDb.open()` runs **before** that redirect — in an
  unpackaged (dev) launch, `app.db` opens against the pre-redirect
  `userData` dir while settings/downloads (loaded moments later, inside
  `initProfileAndStores`, after the redirect) land in the `-dev` suffixed
  one. Production (`isPackaged`) launches are unaffected (no redirect to
  race). This is exactly the gap the leg's own guidance names ("a one-line
  comment noting leg 2 folds it into the reshaped seam") and does not
  affect unit tests (which never exercise `main.js`'s `whenReady` flow) or
  packaged builds — but it DOES mean a dev-mode manual/behavior-test run
  before leg 2 lands will find `app.db` in the wrong directory relative to
  the migrated `.migrated` JSON siblings. Leg 2's `initProfileAndStores`
  reshape (DD7/DD9: app-db open folds in as its first internal step, after
  `setPath`, alongside shields/settings/jars/downloads) resolves this
  fully — flagged here so leg 3's live migration behavior test isn't run
  in dev mode against a pre-leg-2 build without accounting for it.

- 2026-07-17 (Leg 2 implementation): the leg spec's known-shape migration
  guidance ("v2 envelope AND v1 bare array both migrate … then rename
  `.migrated`") left one branch underspecified: a v1 array that validates to
  **zero** surviving entries falls through to the (c) seed/probe path rather
  than returning as a successful v1 migration. Same question for (c)'s other
  two triggers — a missing file (nothing to rename, unambiguous) vs a
  present-but-corrupt/unparseable file. Ruling applied: `load()`'s (c) branch
  now makes a best-effort `renameSync(file, file + '.migrated')` attempt
  UNCONDITIONALLY after seeding+saving — a silent no-op (caught) when there
  was no file to begin with (true first run), and an actual rename when a
  v1-array-shaped-but-empty or corrupt/unparseable file led to the seed path.
  Rationale: DD5 names "v1 array" as a migrating shape without carving out
  the zero-survivor sub-case, and this keeps jars consistent with
  settings/downloads' own precedent (a corrupt legacy file still migrates its
  repaired result and renames the original) rather than introducing a third,
  jars-only disposition for "file existed but was unusable." Only the DD5
  unknown-version envelope carve-out is exempted from this rename (per its
  explicit, separately-ruled carve-out). New tests pin both sub-cases (zero-
  survivor v1 array with/without the probe dir; corrupt JSON with/without the
  probe dir) asserting the file is consumed and renamed.

---

## Deviations

*(none)*

---

## Anomalies

*(none)*

---

## Session Notes

- 2026-07-17: Flight designed autonomously (mission pre-authorization).
  Baseline verified: 1973 pass / 0 fail, clean tree.
- 2026-07-17: Design review (Architect, 1 cycle): **approve with changes**.
  High: DD5 would have defeated jars' pinned unknown-version
  forward-compat guarantee → carve-out added (no row write / no rename for
  that branch). Medium: session-store load stays a `main.js` sibling
  (DD7/DD9 clarified; pin widens to app-db + same four stores). Medium:
  jars' branch-dependent post-quarantine reseed accepted as deliberate
  parity (DD6 addendum). Also named: jars codec seam is real leg-2 work;
  DD10 records shields' new error-propagation mode. Reviewer verified:
  invalidation broadcasts structurally unaffected; automation surface reads
  only store APIs; one pre-boot settings read already try/caught. Second
  cycle skipped — changes adopt the reviewer's recommended options.
  Flight → **ready**.
