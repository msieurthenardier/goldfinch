# Leg: pin-state

**Status**: completed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Add a generic, forward-compatible `toolbarPins` key to the Flight-6 settings store — a boolean map
`{ media, shields }` (both default `true`) with a robust validator and **normalize-at-load/set** so
`get`/`getAll` always return a fully-populated object — the foundation the chrome toolbar + the Appearance
pin controls read/write.

## Context
- **DD1.** Pin state lives in `src/main/settings-store.js` (don't create a parallel store). `toolbarPins` is a
  **nested object** in an otherwise-flat store; the store's current merge-with-repair (`load`) takes a
  validated value **wholesale**, and `set` stores the value as-is — so a nested object needs two additions:
  a proper **VALIDATOR** and a **NORMALIZER** (deep-merge onto the default) applied in both `load` and `set`.
- **Why a NORMALIZER (forward-compat):** a future 3rd pinnable item added to `DEFAULTS.toolbarPins` must
  default to **pinned** for existing `settings.json` files that lack it — never read as `undefined`/unpinned.
  Normalizing to `{ ...DEFAULTS.toolbarPins, ...stored }` on read (and on set) guarantees `get('toolbarPins')`
  is always complete, so **no consumer needs to spread defaults** (the Flight-6 Architect's preferred home
  for the merge).
- **Why a real VALIDATOR (not the typeof fallback):** the store's no-validator branch accepts a stored value
  if `typeof val === typeof DEFAULTS[key]`. For an object default that is `'object'` — which **also matches
  `null` and arrays** (`typeof null === 'object'`). So `toolbarPins` MUST have an explicit validator.
- **Shared-reference hazard:** `config = { ...DEFAULTS }` is a **shallow** copy — `config.toolbarPins` would
  alias `DEFAULTS.toolbarPins`. Use a `freshDefaults()` that clones the nested object so the default object is
  never mutated and `getAll()` consumers can't corrupt it.

## Inputs
- `src/main/settings-store.js` — `DEFAULTS`, `VALIDATORS`, the `load()` merge-with-repair loop, `set()`,
  `get`/`getAll`, the `{ ...DEFAULTS }` sites.
- `test/unit/settings-store.test.js` — the existing unit tests (extend).

## Outputs
- `settings-store.js` with `toolbarPins` in `DEFAULTS`, a `VALIDATORS.toolbarPins`, a `NORMALIZERS` map
  applied in `load`+`set`, and a `freshDefaults()` clone helper.
- Extended unit tests.

## Acceptance Criteria
- [ ] `DEFAULTS.toolbarPins = { media: true, shields: true }` (both default **pinned**). The `@type` JSDoc on
  `DEFAULTS`/`config`/`getAll`/`get`-return is updated to include `toolbarPins`.
- [ ] `VALIDATORS.toolbarPins = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === 'boolean')` (rejects `null`, arrays, and non-boolean values;
  **lenient on which keys are present** — forward-compat).
- [ ] A `NORMALIZERS` map with `toolbarPins: (v) => ({ ...DEFAULTS.toolbarPins, ...v })`. The `load()`
  merge-with-repair applies `NORMALIZERS[key]` to a **validated** stored value before assigning
  (`merged[key] = NORMALIZERS[key] ? NORMALIZERS[key](val) : val`); `set()` applies `NORMALIZERS[key]` to the
  validated value before storing (so even a partial `set('toolbarPins', { media:false })` persists a full map).
- [ ] A `freshDefaults()` helper returns `{ ...DEFAULTS, toolbarPins: { ...DEFAULTS.toolbarPins } }`; it
  replaces **all four** `{ ...DEFAULTS }` sites — the **module-level `let config = { ...DEFAULTS }`** init,
  the merge start, the no-file branch, and the catch branch — so `config.toolbarPins` is never the
  `DEFAULTS.toolbarPins` reference (even before `load()`).
- [ ] **`getAll()` deep-copies the nested object**: `return { ...config, toolbarPins: { ...config.toolbarPins } }`
  so a caller mutating the returned snapshot can't corrupt store state.
- [ ] `get('toolbarPins')` / `getAll().toolbarPins` always return a **complete** object (all known keys), and
  a partial/missing stored `toolbarPins` is filled to defaults (forward-compat); a wholly-malformed
  `toolbarPins` (string / `null` / array / non-boolean values) → the default `{ media:true, shields:true }`.
- [ ] Existing behavior unchanged (`homePage` validator/repair; corrupt-file → defaults; load never throws;
  save propagates; set throws on unknown key / invalid value).
- [ ] **Unit tests** (`test/unit/settings-store.test.js`, extend): `toolbarPins` default on first load;
  `set('toolbarPins', {media:false, shields:true})` persists + reloads; `set` with a **partial**
  `{media:false}` → stored normalized to `{media:false, shields:true}`; `set` **throws** on `null`, `[]`,
  `'x'`, and `{media:'no'}` (non-boolean) with the prior value kept; load of a stored partial
  `{media:false}` → `{media:false, shields:true}` (forward-compat merge); load of a malformed `toolbarPins`
  → default; `getAll().toolbarPins` is a **fresh object** (mutating it doesn't change store state).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green.

## Verification Steps
- `npm test` — new toolbarPins tests pass alongside the existing suite.
- `npm run lint && npm run typecheck` — green.
- Code read: validator rejects null/array/non-boolean; NORMALIZER applied in load + set; `freshDefaults()`
  replaces the shallow `{ ...DEFAULTS }` sites; the typeof-null pitfall is commented near the no-validator
  branch.

## Implementation Guidance
1. `DEFAULTS`: add `toolbarPins: { media: true, shields: true }`. Update the JSDoc `@type`s to include it (or
   loosen to a documented shape).
2. `VALIDATORS.toolbarPins`: the robust object-of-booleans check above.
3. Add `NORMALIZERS`: `{ toolbarPins: (v) => ({ ...DEFAULTS.toolbarPins, ...v }) }`.
4. `freshDefaults()`: `() => ({ ...DEFAULTS, toolbarPins: { ...DEFAULTS.toolbarPins } })`. Replace **all four**
   `{ ...DEFAULTS }` occurrences: the **module-level `let config = { ...DEFAULTS }`**, the merge start (top of
   the try), the no-file `else`, and the `catch`.
5. In the `load()` merge loop, after a value passes its validator (or the type-compat branch), apply the
   normalizer: `merged[key] = NORMALIZERS[key] ? NORMALIZERS[key](val) : val`. Add a brief comment at the
   no-validator/type-compat branch noting `typeof null === 'object'` (why object-typed keys need a validator).
6. In `set()`, after validation, normalize before storing: `const v = NORMALIZERS[key] ? NORMALIZERS[key](value)
   : value; config = { ...config, [key]: v };`.
6a. Update `getAll()` to deep-copy the nested object: `return { ...config, toolbarPins: { ...config.toolbarPins } }`.
7. Extend the unit tests as listed (in the load-partial test, assert **both** `get('toolbarPins')` and
   `getAll().toolbarPins` are complete).

## Edge Cases
- **Partial stored `toolbarPins`** (`{media:false}`) → merged to `{media:false, shields:true}` (forward-compat).
- **`typeof null === 'object'`** — the explicit validator rejects `null`/arrays (the type-compat fallback
  would not).
- **Shared reference** — `freshDefaults()` ensures `config.toolbarPins` is never the `DEFAULTS` object.
- **Partial `set`** — normalized to full before persisting (no partial maps on disk).
- Do NOT make the validator require *specific* keys present (that breaks forward-compat for a 3rd item).

## Files Affected
- `src/main/settings-store.js` — `toolbarPins` default + validator + NORMALIZERS + `freshDefaults()` + load/set
  normalize.
- `test/unit/settings-store.test.js` — toolbarPins unit tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified
- [ ] Tests passing (unit + offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
