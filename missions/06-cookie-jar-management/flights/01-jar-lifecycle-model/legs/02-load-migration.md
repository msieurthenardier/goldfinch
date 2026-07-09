# Leg: load-migration

**Status**: completed
**Flight**: [Jar Lifecycle Model](../flight.md)

## Objective

Complete `jars.load()` with the flight's three-shape migration (DD3): v2 envelope,
v1 bare-array upgrade, and the no-file legacy/fresh split via the
`Partitions/goldfinch` filesystem probe — with persistence enabled on every path
(flipping Leg 1's interim suppression) and the full CP2 migration matrix pinned in
the unit suite.

## Context

- Flight DD3 (read it in full — it IS this leg's spec): (a) v2 → validate + repair
  (already implemented in Leg 1); (b) v1 bare array → validate entries under the new
  rules, `defaultId = 'default'` if that id survives else first entry, rewrite as v2;
  a v1 array validating to **zero** entries falls through to (c); (c) no
  file / corrupt → probe `path.join(userDataPath, 'Partitions', 'goldfinch')`:
  exists → legacy seed (`LEGACY_DEFAULTS`, `defaultId: 'default'`); absent → fresh
  seed (Personal default + Work). **Both (c) branches persist the v2 file
  synchronously inside the same `load()` call** — load-bearing because main.js
  pre-warms `persist:goldfinch` on every launch, so the probe dir exists on every
  profile after run 1; an unsaved fresh seed would be re-probed on launch #2 as
  legacy (flight DD3, "load-bearing, not hygiene").
- Leg 1 left the hook points ready:
  - `src/main/jars.js:load` (:133-166) — the v2 branch is done; the fallback block
    marked `// TODO(leg 2 load-migration)` (:158-164) is what this leg replaces.
  - `LEGACY_DEFAULTS` (:46-51) is already defined, carried with an
    `eslint-disable-next-line no-unused-vars` (:45) that this leg removes.
  - `FRESH_SEED` (:38-41), `repairDefaultId` (:128-131), `validateContainers`
    (:73-124, reserved-namespace remap included), atomic `save()` (:173-182) are all
    reusable as-is.
- Leg 1's suppression semantics flip: after this leg, **every** load shape assigns
  `storePath` and persists. The named suppression pins in `test/unit/jars.test.js`
  ("suppression pin (Leg 2 flips this): …") exist precisely to be flipped now.
- CP2 (flight spec) is the acceptance bar; its pins are enumerated in the criteria
  below verbatim.

## Inputs

- Leg 1 landed: v2 store model green at 1098/1098; `jars.js` Electron-free with
  `load(userDataPath)`; suppression pins present and named in `jars.test.js`.
- Branch `flight/01-jar-lifecycle-model`, uncommitted working tree (deferred review).

## Outputs

- `src/main/jars.js` — `load()` completed with the three-shape migration; TODO
  removed; `LEGACY_DEFAULTS` in real use (eslint-disable dropped); header comment's
  on-disk-shape section extended with the migration summary.
- `test/unit/jars.test.js` — suppression pins flipped to persistence pins; CP2
  migration-matrix tests added.

## Acceptance Criteria

- [x] `load()` dispatch: parsed v2 envelope → existing branch (a), unchanged
      behavior; parsed bare array (`Array.isArray`) → branch (b); file missing,
      unparseable JSON, or any other parsed shape (wrong version, non-array
      `containers`, primitive) → branch (c). `load()` still never throws.
- [x] Branch (b): entries validated via `validateContainers` (reserved-namespace
      remap and `persist:goldfinch`-only-on-`default` apply during migration);
      `defaultId = repairDefaultId(validated, 'default')` (i.e. `default` if it
      survives, else first surviving entry); the file is rewritten as a v2 envelope
      immediately via the atomic `save()`; a v1 array that validates to zero entries
      falls through to branch (c).
- [x] Branch (c): `fs.existsSync(path.join(userDataPath, 'Partitions', 'goldfinch'))`
      → clone `LEGACY_DEFAULTS` with `defaultId: 'default'`; else clone `FRESH_SEED`
      with `defaultId: 'personal'`; **both** write the v2 file synchronously in the
      same `load()` call.
- [x] Persistence enabled on every path: `storePath` is assigned for all shapes;
      Leg 1's suppression (`storePath = null` fallback) and its `TODO(leg 2
      load-migration)` comment are gone; the `eslint-disable` on `LEGACY_DEFAULTS`
      is removed. Every remaining comment asserting the suppressed contract is
      updated: (1) `save()`'s guard comment (jars.js:170-171) drops the "persistence
      is deliberately suppressed after a non-v2 load" clause — the guard itself
      stays for add-before-load; (2) the `LEGACY_DEFAULTS` lead comment
      (jars.js:43-44, "kept for Leg 2 … NOT used by this leg's load()") is rewritten
      for its real use; (3) the test-file banners at jars.test.js:538-542 ("interim
      contract — Leg 2 … DELIBERATELY flips this") and :430 ("v2 envelope only this
      leg") are rewritten for the migrated contract.
- [x] Seed constants are cloned, never aliased (`.map((c) => ({ ...c }))` — the
      existing discipline), so repeated loads can't leak mutations into the constants.
- [x] Unit tests (CP2 matrix, in `test/unit/jars.test.js`):
      - v1 array with the operator-shaped fixture (default + personal + work +
        banking + a custom jar) → all five survive, `defaultId === 'default'`, file
        on disk is now a v2 envelope; a second `load()` of the rewritten file is
        idempotent (same containers, same defaultId — and the v1→v2 rewrite happens
        exactly once: capture the file bytes after the first `load()` and assert
        they are unchanged after the second; state idempotency alone doesn't prove
        branch (a) never re-saves).
      - v1 array WITHOUT a `default` entry → `defaultId` = first surviving entry.
      - v1 array containing a `burner`-id entry → migrated under the remapped
        `jar-burner` id with its partition string intact.
      - v1 array validating to zero entries (e.g. all-garbage entries) + probe dir
        present → legacy seed; same without probe dir → fresh seed.
      - No file + probe dir present → the four legacy jars asserted by content
        (ids `default`/`personal`/`work`/`banking`, `defaultId 'default'`,
        `persist:goldfinch` on `default` only), v2 file written.
      - v2-SHAPED object with the wrong version (e.g. `{version: 3, defaultId:
        'x', containers: [validEntry]}`) + no probe dir → fresh seed (proves a
        wrong-version envelope is treated as neither v1 nor v2 — the dispatch arm
        most likely to regress in a future refactor).
      - No file + no probe dir → fresh seed, v2 file written; **then** create the
        probe dir and `load()` again → STILL Personal+Work (the fresh seed survives
        a relaunch after the partition dir appears — the flight's launch-#2 pin).
      - Corrupt JSON + probe dir present → legacy seed (do NOT encode
        "corrupt → fresh", unreachable post-first-run per CP2); corrupt without
        probe dir → fresh seed; both rewrite the file as v2.
      - Empty v2 file (`{version:2, defaultId:null, containers:[]}`) still loads
        empty with `getDefault() === BURNER` and is NOT rewritten into a seed
        (existing Leg 1 test stays green — empty-is-valid is untouched by
        migration).
      - Leg 1's named suppression pins flipped: post-migration, a non-v2 load
        followed by `add()` DOES persist — assert the post-add FILE SHAPE (a v2
        envelope whose containers include the new jar), not merely "file changed",
        since branch (b)'s load-time rewrite alone would make a weaker assertion
        pass vacuously. Rename the tests to document the flip (project
        rename-pattern convention). The Leg 1 add-before-load no-write pin
        (jars.test.js:574) is NOT flipped — that contract is unchanged.
      - Seed clone-integrity pin: legacy load → `rename('default', {name: 'X'})` →
        fresh module require → legacy load again → name is `Default` (proves branch
        (c) clones `LEGACY_DEFAULTS`/`FRESH_SEED` rather than aliasing them — branch
        (c) is now the third place the constants are instantiated).
      - The two Leg 1 tests pinning "corrupt JSON → fresh seed" and "missing file →
        fresh seed" (jars.test.js:513, :526) are folded into the matrix with
        probe-explicit names — they'd otherwise stay green while pinning the
        misleading unconditional "corrupt/missing → fresh" framing CP2 warns about.
- [x] Full gates green: `npm test`, `npm run typecheck`, `npm run lint`.

## Verification Steps

- `node --test test/unit/jars.test.js` — migration matrix passes.
- `npm test && npm run typecheck && npm run lint` — clean.
- `grep -n "TODO(leg 2" src/main/jars.js` → no matches.
- `grep -n "eslint-disable" src/main/jars.js` → no matches.

## Implementation Guidance

1. **Restructure `load()`** (jars.js:133-166): read + parse inside a try/catch that
   distinguishes "have a parsed value" from "unreadable/corrupt". Suggested shape:
   parse into `saved` (leave `saved` undefined on read/parse failure), then dispatch
   on shape: v2 object → branch (a) as today; `Array.isArray(saved)` → branch (b);
   everything else → branch (c). Assign `storePath = file` once, before the dispatch
   (persistence is now unconditional — this deliberately reverses Leg 1's
   local-variable rule, and the comment explaining suppression goes away with it).
   Keep the ENTIRE body failure-safe as today (jars.js:134-157 wraps everything):
   "load() never throws" covers any fault, not just disk/parse — don't let the
   restructure move `path.join`/assignments outside all try protection.
2. **Branch (b)**: `const validated = validateContainers(saved);` — if
   `validated.length === 0` fall through to branch (c) logic; else assign
   `containers = validated; defaultId = repairDefaultId(validated, 'default');
   save();`.
3. **Branch (c)**: probe with `fs.existsSync` (dir existence only — never read
   contents; flight DD3 trade-off note). Clone the chosen seed, set `defaultId`
   (`'default'` for legacy, `'personal'` for fresh — the literal, matching the
   mission criterion that names Personal), `save()`.
   CP2's "do NOT encode corrupt → fresh" is satisfied by making probe-dependence
   explicit and testing BOTH sides — the prohibition is on an unconditional
   corrupt→fresh pin, not on the probe-absent fresh case.
4. **Comments**: extend the file-header v2 note (:7-19) with one short migration
   paragraph (three shapes + probe rationale, cite DD3); delete the TODO block.
   Keep comment density consistent with the file's existing style.
5. **Tests**: build fixtures with `fs.mkdtempSync` dirs (existing pattern); create
   the probe dir with `fs.mkdirSync(path.join(dir, 'Partitions', 'goldfinch'),
   { recursive: true })`. Flip the suppression pins by renaming + inverting, don't
   delete (git-blame documents the intent shift — project convention).

## Edge Cases

- **v1 file that parses to a non-entry array** (e.g. `[1, "x"]`) — validates to
  zero → branch (c); must not crash.
- **v2-shaped object with `version: 1` or `version: 3`** — not `SCHEMA_VERSION` →
  branch (c). (Future versions land their own migration; today's contract is
  "unknown version = reseed via probe", matching downloads-store's
  bad-shape-→-empty philosophy adapted to DD3.)
- **Probe path is a FILE named `goldfinch`** (pathological) — `fs.existsSync`
  returns true; acceptable: the probe tests existence, not directory-ness, and the
  failure mode (legacy seed on a broken profile) is the conservative one.
- **`save()` failure during migration** (read-only disk) — fail-soft: in-memory
  state is still correct for the session; next launch re-runs the same migration.
  No test needed (save() already swallows), but don't add logic that assumes the
  write succeeded.
- **Repeated `load()` calls in one process** (tests do this) — must be idempotent
  given the same disk state.

## Files Affected

- `src/main/jars.js` — `load()` migration + comment updates
- `test/unit/jars.test.js` — matrix added, suppression pins flipped

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (deferred-review
mode: no commit at leg end):**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] Do NOT commit — single review + commit after the final leg

---

## Citation Audit

Verified at leg design time against the working tree (post-Leg-1, uncommitted):

- `src/main/jars.js:133-166` (`load` with v2 branch + TODO fallback), `:158-164`
  (TODO block), `:38-41` (`FRESH_SEED`), `:45-51` (`LEGACY_DEFAULTS` +
  eslint-disable), `:73-124` (`validateContainers` incl. remap), `:128-131`
  (`repairDefaultId`), `:173-182` (atomic `save()` with null guard), `:7-19` (header
  v2 note) — OK (file read in full immediately before this leg was authored).
- Flight DD3 / CP2 in `../flight.md` — OK (authored this session, re-verified).
- Suppression pins named "suppression pin (Leg 2 flips this)" in
  `test/unit/jars.test.js` — OK per Leg 1's flight-log entry.
