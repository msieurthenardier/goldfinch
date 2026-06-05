# Leg: containers-json-validation

**Status**: completed
**Flight**: [Harden the Hostile-Page Security Boundary](../flight.md)

## Objective
Validate `containers.json` per-entry on load so a tampered file cannot collapse cookie-jar isolation (e.g. two jars sharing a session partition), while preserving valid user-created containers rather than wiping them.

## Context
- Flight DD/technical approach F7. `jars.js:21-30` `load()` does `if (Array.isArray(saved) && saved.length) containers = saved;` — wholesale assignment with no per-field validation. Jar isolation is a core security property (each container = its own session partition + fingerprint persona, per `jars.js:3-5`); a crafted `partition` could break it.
- Decision (from flight, refined in design review): **per-entry** validation — keep valid entries, drop only malformed ones (never all-or-nothing), and merge the `DEFAULTS` floor only if no valid `default` entry survives. Building fresh objects per entry also neutralizes any `__proto__` keys from `JSON.parse`.
- Prerequisite: leg 1's `node --test` runner.

## Inputs
- `src/main/jars.js` — `DEFAULTS` (`:11-16`), `load()` (`:21-30`), `add()` (`:42-51`, the shape user containers take), `module.exports` (`:53`).

## Outputs
- `src/main/jars.js` — add a pure, exported `validateContainers(saved)`; `load()` uses it; malformed entries dropped, valid ones (incl. user-created) kept, `default` floor ensured.
- `test/unit/jars.test.js` (new) — unit tests for `validateContainers`.

## Acceptance Criteria
- [ ] `validateContainers(saved)` returns an array where each kept entry has: `id` a non-empty string; `partition` a string matching `/^persist:/`; `name` coerced to a non-empty safe string (fallback like `'Jar'`); `color` coerced to a string (fallback to a default color). Entries failing the `id`/`partition` checks are **dropped**, not repaired into something arbitrary.
- [ ] **Per-entry, not all-or-nothing**: given a mix of valid and malformed entries, the valid ones survive and only the malformed are dropped.
- [ ] **Id de-duplication**: duplicate `id`s collapse to one (first occurrence wins).
- [ ] **Partition uniqueness (the core isolation guarantee)**: no two kept entries share the same `partition` value — duplicate `partition`s collapse to one (first occurrence wins). Id-dedup alone does NOT prevent this: a tampered file with two distinct ids both pointing at `persist:container:work` would otherwise put two jars on one session, which is exactly the isolation break F7 targets.
- [ ] **Reserve the default partition**: any non-`default` entry whose `partition` is `persist:goldfinch` (the built-in default session) is dropped, so a crafted entry cannot hijack/alias the default session.
- [ ] **`default` floor**: ensure a valid `default` entry exists — if none survives, prepend a **clone** of the `DEFAULTS` default entry (`{ ...DEFAULTS.find(c => c.id === 'default') }`, never the shared reference), so a usable default container always exists. Order the floor so the canonical `persist:goldfinch` wins partition-dedup.
- [ ] `load()`: on `JSON.parse` error, non-array, empty array, or all-invalid input → falls back to `DEFAULTS` (current safe behavior preserved); on partially-valid input → the validated subset (+ floor).
- [ ] Objects are rebuilt field-by-field (no spreading the parsed object wholesale), so a `__proto__`/prototype-polluting key in the JSON cannot leak into the container objects.
- [ ] `validateContainers` is exported and unit-tested; `npm test` passes (all suites).

## Verification Steps
- `npm test` → exits 0; `jars` suite passes.
- `grep -n "validateContainers" src/main/jars.js` → defined, used in `load()`, exported.
- Read `load()` to confirm it routes the parsed array through `validateContainers` and retains the try/catch → DEFAULTS fallback.

## Implementation Guidance

1. **Add `validateContainers(saved)` to `jars.js`** (pure)
   - If `!Array.isArray(saved)` → return **`[]`** (the empty-array sentinel; `load` then keeps its pre-initialized DEFAULTS via a simple `.length` check — cleaner than a `null` type-dispatch).
   - Map each entry: skip if not a plain object, if `typeof id !== 'string' || !id`, or if `typeof partition !== 'string' || !/^persist:/.test(partition)`. Also drop a non-`default` entry whose `partition === 'persist:goldfinch'` (reserved for the built-in default). Otherwise build a **new** object `{ id, name: String(name).slice(0, 24) || 'Jar', color: typeof color === 'string' ? color : '#b06ef5', partition }` (mirror the shape `add()` produces at `jars.js:47`, incl. the 24-char name cap). Read fields explicitly — never spread the parsed entry (avoids `__proto__`/unexpected-key leakage).
   - **De-dupe in one pass with two Sets** (`seenId`, `seenPartition`): keep an entry only if neither its `id` nor its `partition` has been seen; first occurrence wins for both.
   - **Default floor**: if no kept entry has `id === 'default'`, prepend a clone `{ ...DEFAULTS.find(c => c.id === 'default') }`. (Prepending before the final list means its `persist:goldfinch` partition is the canonical one.)
   - Return the resulting array.

2. **Wire `load()`**
   - Keep the `try { … } catch { /* defaults */ }` structure. Inside, after `JSON.parse`, replace `if (Array.isArray(saved) && saved.length) containers = saved;` with: `const validated = validateContainers(saved); if (validated.length) containers = validated;` — on `[]` (or parse error) `containers` stays the pre-initialized `DEFAULTS.map(...)` clone.
   - Preserve `storePath` assignment and the `return containers;`.

3. **Export + test** — add `validateContainers` to `module.exports`. Create `test/unit/jars.test.js` (`require('../../src/main/jars')`) covering: all-valid passthrough; mixed valid/invalid (valid kept); missing/non-string `partition` dropped; bad `partition` prefix dropped; duplicate **ids** deduped; **two distinct ids sharing one `partition` → only first kept**; a non-`default` entry with `partition: 'persist:goldfinch'` dropped; missing `default` gets the (cloned) floor; non-array → `[]`; a `{"__proto__": {...}}`-style entry yields no unexpected keys on the built object; `name` >24 chars truncated; `name`/`color` non-string coerced.

## Edge Cases
- **`saved` not an array / parse error**: DEFAULTS (unchanged).
- **Entry with valid id but `partition` not `persist:`-prefixed**: dropped (a non-persistent or colliding partition would break isolation).
- **Duplicate ids** (e.g. tampered file with two `personal`): dedupe, first wins.
- **Duplicate partitions, distinct ids** (the real isolation break): dedupe by partition too, first wins — two jars can never share one session.
- **Hijacking the default session**: a non-`default` entry with `partition: 'persist:goldfinch'` is dropped.
- **Unexpected/`__proto__` keys**: objects are rebuilt field-by-field (no spread), so only `id`/`partition`/`name`/`color` are read — no unexpected keys leak through. (`JSON.parse` makes `__proto__` a literal own-property, not a live prototype attack; the rebuild neutralizes it regardless.)
- **All entries invalid**: DEFAULTS floor (so the app always has containers, incl. `default`).
- **`name`/`color` wrong type** (number, object): coerce to string with fallback.

## Files Affected
- `src/main/jars.js` — add/export `validateContainers`; use in `load()`
- `test/unit/jars.test.js` — new: validator unit tests

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed` — handled at flight review/commit
  - [ ] Check off flight in mission.md — handled at flight review/commit
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
