# Flight: Jar Lifecycle Model

**Status**: completed
**Mission**: [Cookie Jar Management](../../mission.md)

## Contributing to Criteria

- [x] A fresh profile starts with exactly two persistent jars — Personal (default) and
      Work — plus the ever-present Burner. *(fully owned by this flight)*
- [x] Upgrading an existing profile preserves all current browsing data; the legacy
      base-partition jar appears as a normal renameable, deletable jar. *(fully owned
      by this flight)*
- [ ] Exactly one jar is the default at all times … *(model + IPC foundation; new-tab
      routing lands in Flight 2, UI in Flight 3)*
- [ ] Rename / recolor / delete criteria *(model + IPC foundation; live propagation and
      UI land in Flights 2–3)*
- [ ] Burner always exists, exposes no rename/recolor/delete controls, keeps its
      evaporating semantics *(model-level identity + reserved namespace this flight;
      UI enforcement in Flight 3)*

---

## Pre-Flight

### Objective

Rebuild the jar store (`src/main/jars.js`) from an add-only list into a full lifecycle
model — rename, recolor, delete, and a default-jar flag governed by the "exactly one
default, Burner fallback" invariant — persisted in a versioned, atomically-written
`containers.json`, migrated losslessly from both legacy on-disk shapes, and exposed
over a complete IPC surface. No UI changes: the container picker keeps working exactly
as today, and no renderer code is touched.

### Open Questions

- [x] How do we distinguish a fresh install from a legacy install that never wrote
      `containers.json`? → See DD3 (Partitions-directory probe; premise verified on a
      real profile).
- [x] Where does the default flag live — per-entry boolean or top-level pointer? → See
      DD1 (top-level `defaultId`; "exactly one" becomes structural).
- [x] Is Burner an entry in `jars.list()`? → See DD4 (no — shared identity constant;
      three existing subsystems depend on burner ∉ list()).
- [x] Does rename change the id/partition? → See DD5 (never; name/color are cosmetic).
- [x] Which jar inherits the flag when the default jar is deleted? → See DD2 (first
      remaining persistent jar in list order; Burner only when none remain).
- [x] Can the user explicitly set Burner as default while persistent jars exist? → See
      DD2 (not in the model this flight — strict invariant; relaxing it later is a
      one-line change if Flight 3 decides the UI should offer it).

### Design Decisions

**DD1 — Versioned envelope with a top-level default pointer**: `containers.json`
becomes `{ "version": 2, "defaultId": string|null, "containers": [...] }`.
- Rationale: a top-level `defaultId` makes "exactly one default" structurally
  impossible to violate (no per-entry boolean to double-set or zero-set). A `version`
  field follows the settings-store/downloads-store convention and gives future
  migrations a hook. The bare v1 array is recognizable by shape (`Array.isArray`).
- Trade-off: consumers that want "is this jar the default?" must join against
  `defaultId`; acceptable — the store exposes `getDefault()` so nobody re-derives it.

**DD2 — Default-flag invariant**: `defaultId` MUST reference an existing entry in
`containers` whenever at least one persistent jar exists; `defaultId: null` means
"Burner is the default" and is valid ONLY while `containers` is empty.
- `remove(id)` where id holds the flag → flag moves to the first remaining jar in list
  order; removing the last jar → `defaultId = null`.
- `add(...)` while `defaultId === null` → the new jar becomes default automatically
  (the invariant forbids null-with-jars-present).
- `setDefault(id)` → id must exist in `containers`, else throws/no-ops (leg decides the
  error contract); `setDefault(null)` is rejected while jars exist.
- Validation repairs violations on load: dangling or missing `defaultId` → first jar;
  no jars → null.
- **Empty is a valid persisted state**: a v2 file with zero containers loads as
  empty-list + null-default — no reseed. The current `load()` idiom
  (`if (validated.length) containers = validated`, jars.js:69) is a second implicit
  floor and must NOT be carried into the rewrite, or "user deleted every jar" becomes
  unreachable across restarts (reseeding jars the user deliberately deleted).
- Rationale: mission language ("exactly one jar is the default at all times", "deleting
  the last persistent jar makes Burner the default"). Keeping null-only-when-empty
  strict makes every state mechanically checkable; Flight 3 can relax it deliberately
  if the UI wants explicit Burner-as-default.
- Trade-off: "I want new tabs to always be burners" isn't expressible while persistent
  jars exist — deferred, not foreclosed.

**DD3 — Three-shape load migration, with a filesystem probe for the no-file legacy
case**: `load()` handles (a) v2 envelope → validate + repair; (b) v1 bare array →
validate entries, `defaultId = 'default'` if that id survives else first entry,
rewrite as v2 (a v1 array that validates to **zero** entries falls through to path
(c) — there is nothing to preserve); (c) no file → probe
`path.join(app.getPath('userData'), 'Partitions', 'goldfinch')`: if it exists this is
a **legacy install** (the base partition only exists if the app has run before) →
seed the old four defaults (Default/Personal/Work/Banking, `defaultId: 'default'`);
if absent this is a **fresh install** → seed Personal (default) + Work.
- **Both path-(c) branches persist the v2 file synchronously inside the same
  `load()` call.** This is load-bearing, not hygiene: main.js:2419 pre-warms
  `session.fromPartition(PAGE_PARTITION)` on **every** launch, so `Partitions/
  goldfinch` exists on every profile after run 1 — fresh included. An unsaved fresh
  seed would be re-probed on launch #2 as "no file + dir exists" → legacy → the fresh
  user silently gains Default/Banking. The probe is only meaningful on a true first
  run; the seed must outlive it immediately.
- Verified premise: `containers.json` is only ever written by `add()` (jars.js:79-85 is
  only called from `add`), so an untouched install has partition data but no file — the
  operator's production profile is exactly this shape (has `Partitions/goldfinch` +
  three container partitions, no `containers.json`), while the dev profile has a v1
  bare array. Electron stores `persist:goldfinch` at `userData/Partitions/goldfinch`
  (URL-encoded for names containing `:`, e.g. `container%3Apersonal`) — confirmed on
  disk on this machine.
- Rationale: without the probe, every legacy-untouched install would be mis-seeded as
  fresh, orphaning the user's `persist:goldfinch` logins — silent data loss.
- Trade-off: the probe reads a Chromium-internal directory layout. It's stable across
  Electron majors and we only test existence, never contents; if the layout ever
  changes, the failure mode is "legacy user re-seeded as fresh," which the
  verify-integration leg pins with a test so it can't regress silently.

**DD4 — Burner is a shared identity constant, never a store entry**: add
`src/shared/burner.js` (dual CJS/global export, same pattern as `safe-color.js` /
`container-menu.js`) exporting a frozen `BURNER = { id: 'burner', name: 'Burner',
color: '#ff8c42' }`. `jars.list()` never contains it; `getDefault()` returns `BURNER`
when `defaultId === null`. The id namespace `burner` / `burner-*` is **reserved**:
`slug()` remaps collisions (prefix `jar-`), and validation/migration **remaps** saved
entries claiming it (id → `jar-`-prefixed, keeping the existing partition string
unchanged — jar resolution is by partition string, not id↔partition correspondence,
resolve.js:170). Remap, never drop: a legacy profile can legitimately contain a jar
named "Burner" (slug id `burner`, partition `persist:container:burner` — the picker's
namespaced ids were designed to tolerate it, container-menu.js:8-14), and dropping its
registry entry would orphan its partition data, violating the upgrade-preservation
criterion. The display name is untouched by the remap (a user jar named "Burner"
stays "Burner"; only the internal id moves out of the reserved namespace). The remap
target uses the same collision-suffix loop as `add()` (`jar-burner`, `jar-burner-1`,
…) — never assume the target id is free, since the dedup-first-wins pass would
otherwise silently drop the remapped entry, which this DD forbids.
- Rationale: three existing subsystems depend on burner ∉ `jars.list()` — the
  automation mint guard (mcp-server.js:852-876 refuses burner ids precisely because
  they're not listed), jar-scoped enumeration (scope.js:133-143 drops burners by
  session identity), and the picker model (container-menu.js renders the burner
  sentinel separately; a listed burner would render twice). A list entry would break
  all three. The reserved namespace prevents a user jar named "Burner" from colliding
  with ephemeral burner-tab ids (`makeBurner()` mints `burner-<n>`, renderer.js:490).
- Trade-off: management surfaces (Flight 3) must compose `list() + BURNER` themselves;
  documented in the constant's header comment.

**DD5 — Ids and partitions are immutable; rename touches name/color only**:
`rename(id, { name?, color? })` validates through the same truncation/`isSafeColor`
rules as `add()`. `persist:goldfinch` remains valid ONLY on id `default` (the legacy
jar); all other entries must be `persist:container:*` or they're dropped by
validation. New jars always mint `persist:container:{id}`.
- Rationale: partition strings are the session identity — automation resolves jar
  membership by `session.fromPartition(jar.partition)` object identity
  (resolve.js:160-177), and renaming a partition would orphan the user's data. This
  resolves the mission's open question at the model layer: rename is purely cosmetic.
- Trade-off: a jar's slug-derived id can drift from its display name after rename;
  invisible (ids never render) and harmless.

**DD6 — Store stays pure; session side-effects live in the IPC handler layer**:
`jars.remove(id)` only mutates and persists the list. The `jars-remove` IPC handler in
main.js composes the full delete: `jars.remove()` → wipe the partition
(`ses.clearStorageData()` + `ses.clearCache()`, the identity-new pattern at
main.js:2326-2327) → `rerollSeed(ses)` (so a future re-created jar with the same slug
gets a fresh fingerprint persona — session objects are per-partition-string for the
app's lifetime) → revoke any automation jar key (`revokeJarKey`, mcp-server.js:914, followed by a `settings-changed` broadcast so an
open settings page doesn't show a stale key list — the mint path already broadcasts,
main.js:1805; the revoke path today doesn't) → broadcast. After every mutating
operation (add/rename/remove/setDefault) main.js broadcasts a `jars-changed` event
carrying `{ containers, defaultId }` via the established
`broadcastToChromeAndInternal` helper (main.js:1579 — the same mechanism as
`shields-changed`/`settings-changed`; covers internal-session webContents too, which
Flight 3's management page will need for free). **Both** add entry points emit it:
the `jars-add` IPC (main.js:2318) and the picker's `new-container-create`
(main.js:1878).
- Rationale: jars.js stays unit-testable with no Electron session dependency (the
  existing electron-stub covers `app.getPath` only); side-effect composition is
  main.js's established role. The broadcast channel is defined now so Flights 2–3
  subscribe without another IPC change; it's fire-and-forget, so having zero listeners
  this flight is harmless.
- Trade-off: nothing user-visible consumes remove/rename this flight — the surface is
  inert until Flight 3's page and Flight 2's routing. Deliberate: model first, one
  consumer surface per flight.
- Cache contract (per review protocol): the renderer's `containers` array is a
  boot-time snapshot (renderer.js:107-114) — source of truth is `jars.list()` in main.
  Jars DO mutate at runtime today via one path: the picker's "+ New container…" flow
  (`new-container-create` → `jars.add`, main.js:1878; the renderer patches its own
  snapshot manually, renderer.js:2638-2646). That manual patch stays as-is this
  flight; `jars-changed` is the invalidation event later flights adopt to replace it.
  No rename/remove/setDefault caller exists until Flight 3, so the staleness window
  for those is unchanged (restart-only) this flight.

**DD7 — `jars-list` keeps its array shape; default info rides a new channel**: the
existing `jars-list` IPC returns the bare containers array unchanged (renderer boot at
renderer.js:108-114 destructures it as an array today). A new `jars-get-default`
channel returns the effective default (jar object, or `BURNER` when null). New
channels: `jars-rename`, `jars-remove`, `jars-set-default`, `jars-get-default`,
exposed on the chrome preload bridge alongside the existing `jarsList`/`jarsAdd`.
- Trust domain: the mutating channels are **deliberately chrome-trusted** this flight
  (same domain as the existing `jars-add`/`new-container-create`). Flight 3's
  management page runs in the internal session and will reach mutations through the
  origin-checked `registerInternalHandler` pattern (cf. `internal-settings-set`) —
  added there, not here.
- Rationale: zero renderer changes this flight; Flight 2 consumes `jars-get-default`
  for new-tab routing.
- Trade-off: two round-trips for a consumer wanting list + default; irrelevant at this
  scale, and `jars-changed` carries both anyway.

**DD8 — Durability follows downloads-store**: `save()` becomes atomic
(write tmp + `fs.renameSync`), the envelope carries `version`, corrupt or
unparseable files fall back to the seed path (DD3c), and per-entry validation drops
malformed entries while keeping survivors — the array-of-records pattern
(downloads-store.js), not the fixed-key merge (settings-store.js).
- Rationale: today's plain `writeFileSync` (jars.js:79-85) can tear on crash;
  containers.json now carries the default flag and the user's whole jar taxonomy, so
  it graduates to the same durability class as the other stores.
- Trade-off: none meaningful.

### Prerequisites

- [x] Mission 06 is `active`; this is its first flight (no sibling-flight dependencies).
- [x] Migration premise verified against real profiles (see DD3) — both legacy shapes
      exist on the operator's machine.
- [x] Test baseline green: `npm test` 1065/1065 pass on current `main` (verified
      during design review), `npm run typecheck` / `npm run lint` clean — re-verify on
      the flight branch before Leg 1.
- [ ] Clean working tree on `main`; create branch `flight/01-jar-lifecycle-model`
      (commit subjects `flight/01: …`, trailer `Mission: 06`).

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (two static ones; two runtime ones checked at execution start)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Three code legs then an integration gate. Leg 1 rebuilds `src/main/jars.js` around the
v2 model — envelope schema, `defaultId` invariant (DD2), `rename`/`remove`/
`setDefault`/`getDefault`, the shared `BURNER` constant + reserved namespace (DD4),
atomic save (DD8), and the validation rewrite (drop the "default floor" unshift at
jars.js:53-57; enforce `persist:goldfinch`-only-on-id-`default`; repair `defaultId`).
Leg 2 completes `load()` with the three-shape migration (DD3) including the
Partitions-directory probe. Leg 3 adds the IPC handlers + preload bridge + the
delete-time side-effect composition and `jars-changed` broadcast (DD6/DD7), keeping
main.js handlers thin — all logic that can live in jars.js lives there (main.js is a
2545-line god file per the M05 debrief; don't feed it). Leg 4 runs the full gates and
proves the migration matrix against scratch profiles.

Existing tests to update, not just extend: `test/unit/jars.test.js` pins the old floor
behavior — the floor-default prepend assertions (:121-145) flip to the new invariant.
The non-default-alias rejection test (:110-116) does NOT flip: DD5 retains exactly
that rule. Everything else in jars.test.js survives; `init-profile-order.test.js`
pins load order and must stay green. *(Corrected at Leg 1 design review:
`container-menu.test.js` is NOT untouched — its Burner-collision test mints via
`jars.add('Burner')` and pins id `burner`, which the DD4 reserved-namespace remap
changes to `jar-burner`; the leg flips that test and re-pins the picker-tolerance
premise with a hand-built jar object. Logged in the flight log.)* Leg 2 test-isolation caveat: `test/helpers/electron-stub.js`
returns a fixed shared tmpdir from `app.getPath` — migration tests that exercise
`load()` + probe + save need per-test isolation (overridable stub path or injected
fs seam) or parallel tests will cross-pollute through the real filesystem.

### Checkpoints

- [x] CP1 — Store model lands: full lifecycle API with DD2 invariant enforced,
      unit-tested including every remove/add/setDefault edge (delete default with
      survivors, delete last jar, add into empty, dangling defaultId repair, reserved
      burner namespace, prototype-pollution safety preserved).
- [x] CP2 — Migration lands: all three load shapes produce correct state (unit-tested
      with stubbed `app.getPath`/fs); v1 → v2 rewrite happens exactly once; the fresh
      seed survives a relaunch after the partition dir appears (fresh seed → create
      `Partitions/goldfinch` → reload → still Personal+Work, not legacy); an empty v2
      file stays empty (no reseed); a v1 array validating to zero entries routes to
      the probe path; corrupt-file expectation is probe-path-dependent (post-first-run
      that always means the legacy seed — do NOT encode "corrupt → fresh seed", which
      is unreachable once the partition dir exists).
- [x] CP3 — IPC surface lands: four new channels + broadcast wired, preload bridge
      extended, delete composes wipe + reroll + key-revoke; gates green.
- [x] CP4 — Integration proven: fresh scratch profile shows Personal(default)+Work in
      the real picker; legacy-shaped scratch profile (partition dir, no file) keeps the
      four legacy jars with Default flagged; dev profile (v1 file) migrates in place;
      dev auto-mint still works on the operator's dev profile, and the fresh-profile
      mint failure is confirmed to take the documented graceful path (the try/catch
      at main.js:2507-2515 logs and continues — pin the accepted variation, don't
      assume it).

### Adaptation Criteria

**Divert if**:
- The Partitions-directory probe proves unreliable (e.g. the dev/prod profile layout
  differs from the verified premise at execution time) — stop and redesign legacy
  detection rather than ship a guess.
- Enforcing the DD2 invariant requires touching `resolve.js`/`scope.js` (automation
  membership semantics) — that's Flight 2+ surface; stop and re-scope.

**Acceptable variations**:
- Error-contract details on the new store API (throw vs. return-null) — leg's choice,
  consistent with existing jars.js style.
- Exact shape of the `jars-changed` payload, as long as it carries containers +
  defaultId.
- The interim dev-only gap that auto-mint (`mintJarKey('default')`, main.js:2506-2516)
  would throw on a **fresh** profile after this flight (no jar id `default` exists
  there) is accepted and documented — the operator's dev profile is legacy-shaped so
  the real dev loop is unaffected, and Flight 2 retires the hardcode. Do NOT fix it
  here; log it in the flight log if observed.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and
> created one at a time as the flight progresses. This list will evolve based on
> discoveries during implementation.

- [x] `store-model` - jars.js v2 lifecycle model + BURNER constant + validation
      rewrite + unit tests (CP1)
- [x] `load-migration` - three-shape load migration with legacy probe + unit tests (CP2)
- [x] `ipc-surface` - four IPC channels, preload bridge, delete side-effect
      composition, `jars-changed` broadcast + unit tests (CP3)
- [x] `verify-integration` - full gates + scratch-profile migration matrix + dev
      auto-mint check (CP4)

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged
- [x] Tests passing
- [x] Documentation updated (jars.js header comment documents the v2 schema +
      invariant; CLAUDE.md only if it describes the jar set — check at Leg 4)

### Verification

- `npm test` / `npm run typecheck` / `npm run lint` all green (baseline 1065 unit
  tests grows with the new store/migration/IPC suites).
- Migration matrix (Leg 4): three scratch `userData` shapes — empty (fresh), partition
  dir + no containers.json (legacy-untouched), v1 bare-array file (legacy-customized)
  — each launched or load()-exercised and asserted against the DD3 outcomes.
- Real-app smoke on the dev profile: picker still lists the migrated jars; creating a
  jar from the picker still works end-to-end (add path unchanged); auto-mint still
  mints on launch.
- No behavior-test specs authored this flight: every behavior-test-backed mission
  criterion needs the management page (Flight 3+) to act through; this flight's two
  fully-owned criteria (fresh-install set, upgrade preservation) are
  filesystem/model-observable and are pinned by the Leg 2/Leg 4 test matrix instead.
