# Leg: store-model

**Status**: completed
**Flight**: [Jar Lifecycle Model](../flight.md)

## Objective

Rebuild `src/main/jars.js` as an Electron-free, fully lifecycle-capable v2 jar store —
rename/remove/setDefault/getDefault added, the "exactly one default, Burner fallback"
invariant enforced, the default floor removed, the reserved burner namespace remapped,
atomic saves — plus the shared `BURNER` identity constant, with the unit suite updated
to pin every new invariant (flight CP1).

## Context

- Flight DD1: `containers.json` becomes `{ version: 2, defaultId: string|null,
  containers: [...] }`. Top-level `defaultId` makes "exactly one default" structural.
- Flight DD2: `defaultId` must reference an existing entry whenever any persistent jar
  exists; `null` ⇔ Burner-is-default, valid ONLY while `containers` is empty. Empty is
  a **valid persisted state** — the current `if (validated.length)` guard
  (jars.js:69 — `if (validated.length) containers = validated;`) is an implicit floor
  and must not survive the rewrite.
- Flight DD4: Burner is a shared frozen constant, never a store entry. Reserved id
  namespace `burner` / `burner-*` remaps (never drops) via the same collision-suffix
  loop as `add()`, keeping the partition string unchanged.
- Flight DD5: ids/partitions immutable; rename touches name/color only;
  `persist:goldfinch` valid only on id `default`.
- Flight DD8: durability follows downloads-store — atomic tmp+rename, version
  envelope, per-entry validator-drop, load never throws.
- **Testability seam (this leg's structural choice)**: jars.js drops
  `require('electron')` and takes the userData path as a `load(userDataPath)`
  argument, exactly like `src/main/downloads-store.js:load` (`function
  load(userDataPath, opts = {})` — downloads-store.js:138) and settings-store. This
  resolves the flight's electron-stub isolation caveat at the root: tests use
  cache-busted fresh requires + `fs.mkdtempSync` temp dirs (the
  `downloads-store.test.js` pattern), no `electron-stub` needed. `init-profile.js`
  already injects the stores and is the only `load()` caller.
- Leg boundary: the three-shape migration (v1 array, no-file legacy probe) is **Leg 2**
  (`load-migration`). This leg's `load()` reads the v2 envelope only; any other shape
  (missing file, v1 array, corrupt JSON) falls back to an **in-memory** fresh seed
  with persistence fully suppressed: leave `storePath = null` unless a valid v2
  envelope was parsed, so no later mutation (`add()` via the live picker,
  main.js:1878-1880 / main.js:2318) can overwrite a real v1 file with a v2 envelope
  that Leg 2's migration could no longer recover. Blanket suppression (including the
  no-file case) is deliberate — it only costs persistence on scratch profiles for the
  duration of one leg. Mark it `// TODO(leg 2 load-migration)`.

## Inputs

- Flight spec approved (`../flight.md`), branch `flight/01-jar-lifecycle-model`
  checked out, baseline 1065/1065 green.
- `src/main/jars.js` in its current add-only form; `test/unit/jars.test.js` pinning
  the old floor; `src/main/init-profile.js` calling `jars.load()` with no argument.
- Prior legs: none (first leg).

## Outputs

- `src/shared/burner.js` — new: frozen `BURNER` constant, dual CJS/global export.
- `src/main/jars.js` — rewritten: Electron-free v2 model, full lifecycle API.
- `src/main/init-profile.js` — `jars.load(app.getPath('userData'))`; JSDoc + ordering
  comments updated (jars now takes the path as an arg like settings/downloads).
- `test/unit/jars.test.js` — updated + extended for the v2 model.
- `test/unit/container-menu.test.js` — Burner-mint test flipped to the remap
  behavior; tolerance premise re-pinned with a hand-built jar object.
- `test/unit/init-profile-order.test.js` — fake jars store records its path arg;
  both order tests assert it (plus comment updates).

## Acceptance Criteria

- [x] `src/shared/burner.js` exports a frozen `BURNER = { id: 'burner', name:
      'Burner', color: '#ff8c42' }` with the dual CJS/global export pattern of
      `src/shared/safe-color.js`; header comment documents "management surfaces
      compose `list() + BURNER`; never a store entry" (flight DD4).
- [x] `jars.js` no longer contains `require('electron')`; `load(userDataPath)` takes
      the path as an argument; `init-profile.js` passes `app.getPath('userData')`.
- [x] `load()` of a valid v2 envelope restores containers + defaultId; `load()` never
      throws; non-v2 shapes fall back to an in-memory Personal(default)+Work seed
      with `storePath` left `null` (persistence suppressed — a subsequent `add()`
      must NOT write the file; TODO(leg 2) comment present).
- [x] `load()` of `{version:2, defaultId:null, containers:[]}` yields an empty list
      and `getDefault()` returns `BURNER` — no reseed (flight DD2 empty-is-valid).
- [x] `validateContainers` has no default floor: output for an input without a
      `default` entry contains no injected entry. The `persist:goldfinch`-only-on-id-
      `default` rule, id/partition dedup, field-by-field rebuild (prototype-pollution
      safety), name truncation, and `isSafeColor` fallback all still hold.
- [x] Reserved namespace: saved entries with id `burner` or `burner-*` are remapped to
      `jar-`-prefixed ids via the same collision-suffix loop as `add()`, partition
      string preserved, name preserved; `slug()`/`add()` can never mint a reserved id.
- [x] `defaultId` repair on load: dangling/missing → first surviving jar; empty list →
      `null`.
- [x] Lifecycle API with the DD2 invariant:
      - `add(name, color)` — as today, plus: when `defaultId === null` the new jar
        becomes default automatically.
      - `rename(id, { name?, color? })` — validates via the same rules as `add`;
        id/partition untouched; returns the updated container, or `null` for an
        unknown id (no throw).
      - `remove(id)` — deletes the entry; if it held the flag, flag moves to the first
        remaining jar in list order, or `null` when none remain; returns the removed
        container object (the IPC layer needs its partition for the wipe), or `null`
        for an unknown id. Return contract is deliberately uniform with `rename`
        (container-or-null) — Leg 3's IPC layer codes against it.
      - `setDefault(id)` — returns boolean: unknown id or `null`-while-jars-exist →
        `false`; setting the current holder again → `true` (idempotent);
        `setDefault(null)` while already empty → `true` (idempotent no-op).
        `getDefault()` — returns the default jar object, or `BURNER` when `defaultId
        === null`.
      - Every successful mutation invokes `save()` (which deliberately no-ops while
        persistence is suppressed — non-v2 load or `add()`-before-`load()`).
- [x] `save()` is atomic: writes `<storePath>.tmp` then `fs.renameSync` (the
      downloads-store pattern, downloads-store.js:122-126 — `const payload = {
      version: SCHEMA_VERSION, ... }` / `fs.writeFileSync(tmp, ...)`), envelope
      `{version: 2, defaultId, containers}`.
- [x] `test/unit/jars.test.js`: the floor-pinning tests (the "default floor" block,
      currently asserting an injected default entry) are flipped/renamed to pin the
      NEW behavior (no injection); the alias-rejection test (non-default entry
      claiming `persist:goldfinch` is dropped) is KEPT as-is per flight DD5. New
      tests cover every criterion above, including: delete-default-with-survivors,
      delete-last-jar → `getDefault() === BURNER`, add-into-empty auto-default,
      dangling-defaultId repair, reserved-namespace remap incl. a collision with an
      existing `jar-burner`, empty-v2-stays-empty, atomic save file shape, BURNER
      frozen (`Object.isFrozen`), and an explicitly-named suppression pin ("non-v2
      load → `add()` → file on disk unchanged" — interim behavior Leg 2 will
      deliberately flip; the named test makes that handoff visible).
- [x] `test/unit/container-menu.test.js` updated for the remap: the test that mints
      via `jars.add('Burner')` and asserts `created.id === 'burner'` /
      `jar:burner` in the model (container-menu.test.js:63-69) flips to pin the NEW
      mint behavior (`add('Burner')` → id `jar-burner`, model item
      `jar:jar-burner`), and the original picker-tolerance premise (a literal
      `burner`-id jar renders distinctly from the `action:burner` sentinel) is kept
      by feeding `buildContainerModel` a hand-built `{ id: 'burner', … }` object
      instead of minting through `add()`. Drop the now-unneeded electron-stub
      require (container-menu.test.js:8).
- [x] `test/unit/init-profile-order.test.js` updated: the fake jars store records
      `jars.load:${path}` and both order tests assert jars received the (dev-
      redirected / un-redirected) userData path, mirroring the existing
      settings/downloads arg assertions (:73-80, :93-100) — otherwise a forgotten
      arg silently degrades to the never-persisting seed and no gate catches it.
- [x] Full gates green: `npm test` (all suites), `npm run typecheck`,
      `npm run lint`.

## Verification Steps

- `npm test` — expect 0 fail; jars suite grown substantially past its current size.
- `npm run typecheck && npm run lint` — clean.
- `grep -c "require('electron')" src/main/jars.js` → 0.
- `node -e "require('./test/helpers/electron-stub')"` no longer needed by
  jars.test.js — verify the test file doesn't import it.
- Spot-check: `node --test test/unit/jars.test.js test/unit/init-profile-order.test.js`.

## Implementation Guidance

1. **Create `src/shared/burner.js`** modeled on `src/shared/safe-color.js`'s dual
   export (CJS `module.exports` + `globalThis` fallback for the
   nodeIntegration-free chrome renderer). `Object.freeze` the constant. Note in the
   header that `container-menu.js:36` (burner sentinel `'#ff8c42'`) and
   `renderer.js:makeBurner` currently duplicate the color literal — consuming the
   constant there is Flight 2/3 scope, NOT this leg; say so in the comment.

2. **Rewrite `src/main/jars.js`** keeping its existing comment style and the
   `isSafeColor` re-export:
   - Module state: `containers`, `defaultId` (string|null), `storePath`.
   - `SCHEMA_VERSION = 2`. New-install seed constant: Personal `#4caf50` (default) +
     Work `#2196f3`, partitions `persist:container:personal` / `persist:container:
     work`. Keep the old four-jar DEFAULTS array available for Leg 2's legacy branch
     (rename it `LEGACY_DEFAULTS` with a comment) — do not delete it.
   - `validateContainers(saved)`: keep the current per-entry discipline
     (field-by-field rebuild, never spread parsed entries — jars.js:26-62). Changes:
     drop the floor block (jars.js:53-57 — `if (!kept.some((c) => c.id ===
     'default')) …`); add the reserved-namespace remap BEFORE the id-dedup check
     (compute the remapped id with the collision loop against ids already kept).
     Reserved test: `id === 'burner' || id.startsWith('burner-')`.
   - `repairDefaultId(containers, candidate)` helper: candidate valid → keep; else
     first jar's id; empty → null. Use it in `load()` and after `remove()`.
   - `load(userDataPath)`: compute the file path into a LOCAL variable; parse; if
     envelope with `version === 2` and array `containers` → validate + repair AND
     only then assign the module-level `storePath` (persistence enabled); else
     in-memory fresh seed with `storePath` left `null` (persistence suppressed,
     `TODO(leg 2 load-migration)`). Assigning `storePath` before the shape check
     would defeat the suppression AC — the next `add()` would clobber a v1 file.
     Wrap in try/catch — load never throws.
   - `save()`: atomic tmp+rename; try/catch swallow (keep current fail-soft
     philosophy, jars.js:77-83) — and keep the explicit `if (!storePath) return;`
     guard: `add()` before `load()` is an exercised path in the test suite, and an
     unguarded `storePath + '.tmp'` with null would write a literal `null.tmp` in
     cwd.
   - Lifecycle functions per the acceptance criteria. `module.exports = { load,
     list, add, rename, remove, setDefault, getDefault, validateContainers,
     isSafeColor }` (plus anything the tests need — prefer testing through the
     public API).
   - `list()` keeps returning the live array (main.js:1793 and 2317 depend on it);
     do NOT change its shape — no `isDefault` field on entries (flight DD7 keeps the
     `jars-list` IPC array-shaped; default info is `getDefault()`'s job).

3. **Update `src/main/init-profile.js`**: `jars.load()` →
   `jars.load(app.getPath('userData'))`. Update the JSDoc stores type
   (`jars: { load: (path: string) => void }`) and the two comment blocks that say
   shields/jars read `getPath('userData')` INTERNALLY (init-profile.js:14 and :29-31)
   — jars now follows the settings/downloads arg pattern; shields remains internal.
   The ordering invariant is unchanged (the getPath call that builds the arg is the
   ordering signal, exactly as documented for settings).

4. **Update tests** following `test/unit/downloads-store.test.js`'s header pattern
   (cache-busted `freshStore()`, `fs.mkdtempSync` per test, no electron-stub):
   - Convert existing `jars.test.js` cases off the electron-stub import; pure
     `validateContainers`/`isSafeColor` cases don't need a temp dir at all.
   - Flip the floor block with the rename pattern (e.g. `'floor: missing default is
     prepended'` → `'no floor: missing default is NOT injected'`) so git blame
     documents the intent shift.
   - Add the new invariant/API cases from the acceptance criteria.

5. **Run the gates**; fix anything the rewrite surfaces.

## Edge Cases

- **`rename` with only one of `{name, color}`** — the other field is preserved, not
  reset to fallback. Validate provided fields only.
- **`remove` of the sole jar** — list empties, `defaultId` → null,
  `getDefault() === BURNER`; a subsequent `add` auto-claims the flag.
- **`setDefault` to the jar already holding the flag** — succeed (idempotent), still
  persists (cheap, simpler contract).
- **v2 envelope with a defaultId pointing at an entry that validation dropped** —
  repair runs AFTER validation, so the flag lands on the first surviving jar.
- **Reserved remap collision cascade** — input containing both `burner` and
  `jar-burner`: the remapped entry becomes `jar-burner-1`; nothing is dropped.
- **`add` name that slugs to a reserved id** (e.g. "Burner", "burner 2") — slug remap
  applies at mint time too; display name untouched.
- **Non-string / missing `defaultId` in a v2 file** — treat as dangling → repair.
- **Do not mutate `LEGACY_DEFAULTS`/seed constants on load** — clone entries
  (the current `DEFAULTS.map((c) => ({ ...c }))` discipline, jars.js:23).

## Files Affected

- `src/shared/burner.js` — new
- `src/main/jars.js` — rewritten
- `src/main/init-profile.js` — load call + comments
- `test/unit/jars.test.js` — updated + extended
- `test/unit/container-menu.test.js` — Burner-mint test flipped; electron-stub
  require dropped
- `test/unit/init-profile-order.test.js` — fake jars path assertion added + comments

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (deferred-review
mode: no commit at leg end — review and commit happen once after the final leg):**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] Do NOT commit — the flight commits once after review, per the flight's
      deferred-review workflow (nothing committed)

---

## Citation Audit

Verified at leg design time against the working tree (branch
`flight/01-jar-lifecycle-model`):

- `src/main/jars.js:26-62` (validateContainers), `:39` (alias rule), `:53-57` (floor
  block), `:69` (`if (validated.length)`), `:77-83` (plain save; `writeFileSync` at
  :79), `:23` (DEFAULTS clone) — OK (file read in full this session).
- `src/main/downloads-store.js:122-126` (atomic payload+tmp write), `:138`
  (`load(userDataPath, opts)`) — OK (grep-verified).
- `src/main/init-profile.js:14`, `:29-31`, `:36` (`jars.load()`) — OK (file read in
  full).
- `test/unit/jars.test.js:110-116` (alias test, kept), `:121-145` (floor tests,
  flipped) — OK per flight design review (Architect verified both).
- `src/shared/container-menu.js:36` (burner sentinel color literal) — OK (file read
  in full).
- `src/main/main.js:1793`, `:2317` (`jars.list()` consumers) — OK (grep-verified this
  session).
