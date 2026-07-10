# Flight Debrief: Jar Lifecycle Model

**Date**: 2026-07-09
**Flight**: [Jar Lifecycle Model](flight.md)
**Status**: landed
**Duration**: 2026-07-09 (design) → 2026-07-09 (landed) — single day
**Legs Completed**: 4 of 4 (01-store-model, 02-load-migration, 03-ipc-surface, 04-verify-integration)

## Outcome Assessment

### Objectives Achieved

The flight delivered exactly its charter: `src/main/jars.js` rebuilt as an
Electron-free v2 lifecycle store (rename/remove/setDefault/getDefault, the
"exactly one default, Burner fallback" invariant with empty-as-valid-state, the
reserved `burner`/`burner-*` namespace remapped-never-dropped, atomic saves), the
DD3 three-shape migration (v2 / v1 bare array / no-file with the
`Partitions/goldfinch` legacy probe, both no-file branches persisting
synchronously), the shared frozen `BURNER` identity constant, and the full IPC
surface in a new dependency-injected `src/main/jar-ipc.js` (six channels, the
delete composition wipe→reroll→revoke→broadcasts, `jars-changed` after every
mutation) — with zero renderer changes, as designed. Committed as a single
reviewed commit `fa3da87` (21 files, +3559/−85); deferred flight-level code
review returned **zero issues**.

All four checkpoints landed. Real-boot verification (Leg 4) proved the migration
matrix against actual app launches on scratch and real profiles, exercised the
picker's data path end-to-end through the live chrome renderer via the admin
automation apparatus, verified both sides of the accepted auto-mint interim gap,
and migrated the operator's real 12-jar dev profile in place (backup:
`~/.config/goldfinch-dev/containers.json.v1.bak`).

### Mission Criteria Advanced

- **Fresh profile = Personal (default) + Work + Burner** — MET (fully owned by
  this flight; proven by unit matrix + two real fresh-profile boots).
- **Upgrade preserves data; legacy jar is a normal jar** — MET (fully owned;
  proven on both legacy shapes, including the operator's real profile).
- Foundations laid (model + IPC, not yet user-visible) for: exactly-one-default,
  rename/recolor/delete, Burner invariants — completing in Flights 2–3.

## What Went Well

- **The verification leg earned its keep with a real catch (D1).** On a true
  first boot, `jars.load()` runs before Electron lazily creates the userData
  directory, so the DD3c synchronous fresh-seed persist ENOENTed silently into
  `save()`'s fail-soft catch — and launch #2 would have re-probed the fresh
  install as legacy, the *exact* bug DD3c was designed to prevent. Invisible to
  the unit matrix (`mkdtempSync` always pre-creates dirs); visible only to a real
  boot. Fixed minimally (`fs.mkdirSync(dirname, {recursive:true})` in `save()`),
  pinned with a regression test, all scenarios re-run green.
- **Debrief-driven structure worked**: Leg 3 extracted `jar-ipc.js`
  (deps-injected, 22 own tests) instead of feeding the 2545-line main.js —
  a direct, cited response to the M05 debrief's #1 structural debt. Net main.js
  delta: ~+16 lines.
- **Premise-audit discipline paid twice**: the Partitions-probe premise was
  verified on real profiles at flight design (catching that untouched installs
  have NO containers.json — the silent-data-loss trap); Leg 4's Step-0
  isolation probe empirically confirmed `XDG_CONFIG_HOME` scratch isolation
  *before* any scenario relied on it, with the real profile backed up first.
- **Per-leg design reviews caught real defects before code**: Leg 1's review
  found the flight spec's own "`container-menu.test.js` untouched" claim wrong
  (its Burner-mint test collides with the DD4 remap) and the v1-clobber hole in
  the interim load fallback; Leg 3's review caught the `'in'`-operator-throws-
  on-primitives payload-hardening gap on chrome-trusted channels.
- **Staged-invariant test naming**: Leg 1 marked its deliberately-interim
  contract with tests literally named "suppression pin (Leg 2 flips this)",
  which Leg 2 renamed-and-inverted — the handoff is visible in git blame instead
  of silently vanishing. Reusable technique for multi-leg staged work.
- **ACs written as literal assertions** ("grep → 0", "byte-compare after boot
  2") made every leg's verification directly executable rather than
  interpretive.

## What Could Be Improved

### Process
- **Nothing structural.** Four legs, one flight-spec correction (caught at
  design review, not mid-implementation), zero diverts, zero blockers, review
  loops all ≤2 cycles.

### Technical
- **DD3/DD8 had a real design-completeness gap (the D1 root cause).** DD8
  modeled jars.js durability on settings/downloads-store — but those stores
  first save on *user action*, long after the userData dir exists, while DD3
  requires *synchronous first-boot persistence inside `load()`*. That divergence
  from precedent is precisely where the ENOENT lived, and the design never
  stated the "parent directory exists at write time" premise. Lesson: when a DD
  says "imitate module X," explicitly diff the contract axes where the new
  module *differs* from X — those are where the precedent's implicit premises
  break.
- **`rename`/`setDefault` are model-and-handler-proven, not renderer-proven.**
  Leg 4's live smoke covered list/add/remove only; nothing consumes
  rename/set-default until Flight 3's page. Flight 3 must not assume that IPC
  contract is live-proven.

### Documentation
- The "Electron-free module, deps/path injected at load()" pattern now has four
  exemplars (settings, downloads, jars, jar-ipc) but no named write-up; same for
  the D1 mkdirSync-before-synchronous-persist lesson (currently only a jars.js
  comment). One short CLAUDE.md architecture note would keep a fifth consumer
  from re-deriving both.

## Test Metrics

`npm test`: **1132 / 1132 pass, 0 fail, 0 skip, 0 flake**, ~5.06s (repeat run
5.06s — no flakes either run). `npm run typecheck` / `npm run lint`: clean.

**Trajectory**: M05 F9 landed 1050 (~5.1s) → inter-mission 1065 → **F1: 1132**
(+67 this flight: +33 store model, +11 migration matrix, +22 jar-ipc, +1 D1
regression pin). Wall-clock flat-to-marginally-better despite +7.8% tests since
M05 F9 — per-file Node process overhead (47 files) dominates, and this flight
added only one new test file. Slowest named suite remains mcp-client's `unwrap`
(~153ms, pre-existing, untouched). Suite reliability profile unchanged: zero
flakes across missions.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| D1 (Leg 4): `mkdirSync` added to `save()` after real-boot ENOENT | Unit harness pre-creates dirs; first-boot persistence races Electron's lazy userData creation | Yes — any store persisting synchronously inside `load()` gets the recursive-mkdir guard from day one |
| Leg 2's clone-integrity pin used same-module re-load instead of the spec'd fresh-require | Cache-busted re-require re-instantiates the constants, making the pin vacuous; same-instance actually detects aliasing | Yes — test the property, not the spec's literal mechanism |
| D2/D3 (Leg 4): MCP attach on fallback port 49709; "bind line" AC proven by live port probe | Default port unreachable on this rig; code emits no bind-success line | No — rig-specific; but note free-port fallback when writing MCP-apparatus steps |
| Leg 1 interim: persistence fully suppressed for non-v2 loads | Prevent a mid-flight `add()` from overwriting a v1 file the Leg-2 migration still needed | Yes — when staging a migration across legs, make the interim state unable to destroy the migration's input |

## Key Learnings

1. **Integration boots catch what fs-seam unit tests structurally cannot.** The
   D1 class (ENOENT on lazy directory creation) is invisible wherever the test
   harness pre-creates directories. A verification leg with real boots belongs
   in any flight whose code runs during app startup.
2. **"Imitate module X" DDs need an explicit divergence audit.** The one defect
   in eight design decisions lived exactly where the new module's contract
   differed from its cited precedent (persist-at-first-boot vs
   persist-on-user-action).
3. **Verified premises stayed verified.** Both empirically-checked premises
   (Partitions probe layout, XDG isolation) held with zero rework; the one
   unverified adjacent premise (parent dir exists) was the one that broke.
4. **The five reserved-default sites are intact and inventoried** for Flight 2
   (store floor retired this flight; remaining: PAGE_PARTITION pre-warm +
   privacy fallbacks, renderer DEFAULT_CONTAINER (:106, :677, :2079, :2441),
   dev auto-mint `'default'` (main.js:2529, comment corrected), renderer dot
   suppression (:713)). Flight 2 should re-grep rather than trust line numbers.

## Recommendations

1. **Flight 2**: retire the auto-mint `'default'` hardcode (the one accepted
   interim gap with a live failure mode on fresh profiles); decide whether
   new-tab routing is the point where a `jars-changed` renderer listener lands,
   or whether the boot-snapshot staleness holds until Flight 3; decide early
   whether routing wants the DD2 relaxation (explicit Burner-as-default) — it's
   a one-line model change and Flight 2 is `getDefault()`'s first real consumer.
2. **Flight 2/3**: consume `BURNER` from `src/shared/burner.js` in
   container-menu.js and renderer.js `makeBurner` (the `#ff8c42` literal is
   currently triplicated; burner.js's header flags it).
3. **Flight 3**: exercise `jars-rename`/`jars-set-default` end-to-end through
   the live renderer (they're the two channels Leg 4's smoke didn't cover), and
   add the internal-origin-gated variants per DD7's trust-domain note.
4. **Next CLAUDE.md touch**: add a named "Electron-free injected-deps module"
   pattern note (settings/downloads/jars/jar-ipc as exemplars) including the D1
   mkdirSync-before-synchronous-persist lesson.
5. **Housekeeping**: delete `~/.config/goldfinch-dev/containers.json.v1.bak`
   once this flight merges to main (its restoration purpose expires with the
   merge).

## Action Items

- [ ] Flight 2 design: fold in Recommendations 1–2 and the five-site inventory
      (re-grep for `'default'` literals at design time).
- [ ] Flight 3 design: Recommendation 3 (live rename/set-default exercise +
      internal-origin-gated variants).
- [ ] Next CLAUDE.md-touching flight: Recommendation 4 (named pattern note).
- [ ] Post-merge: Recommendation 5 (drop the `.v1.bak`).
