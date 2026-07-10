# Leg: data-classes-and-ipc

**Status**: completed
**Flight**: [Per-Jar Data Controls](../flight.md)

## Objective

Deliver the Electron-free substrate for per-jar data controls: the `jar-data-classes`
pure shared module (with its full four-part onboarding), the twin-registered
`jars-clear-data` / `jars-wipe` IPC handlers with the `jar-wiped` broadcast, the four
action preload wrappers, and the DD8 broadcast-invariant test net — all unit-tested
(CP1).

## Context

- Flight DD2 (data classes as a pure module), DD3 (twin-registered clear/wipe IPC),
  DD4 (the `jar-wiped` broadcast — EMISSION only in this leg; the chrome listener +
  reload sweep land in leg 3), DD8 (broadcast-invariant net), DD10 (docs — the
  CLAUDE.md checklist paragraph may land here or in a later leg; noting the new
  channels where the jar IPC surface is described belongs here).
- Architect review rulings baked into the flight spec: the four-part onboarding
  (eslint global + d.ts declare + jars.html script tag + `INTERNAL_PAGES.jars`
  entry) is ALL this leg's responsibility, so the module is page-loadable before
  leg 2 touches the DOM; partition lookup inside the new handlers is
  `jars.list().find(...)` inline (the store deliberately has no `get(id)` helper —
  do not add one).
- Nothing in this leg renders UI. The page (`src/renderer/pages/jars.js`) is NOT
  modified here beyond `jars.html` gaining the script tag.

## Inputs

- Flight 3 merged state on branch `flight/04-per-jar-data-controls` (created from
  main at `4e1d980`): `src/main/jar-ipc.js` with six extracted handler bodies
  twin-registered; suite 1242/1242 green.
- Uncommitted design artifacts for this flight (flight.md, flight-log.md, the
  `tests/behavior/jar-data-controls.md` draft) — leave them alone; they commit with
  the flight review.

## Outputs

- `src/shared/jar-data-classes.js` (new) — pure, dual-export
- `src/main/jar-ipc.js` — two new handler bodies, twin-registered (8 registrations
  total → 16 channels across both trust domains)
- `src/preload/internal-preload.js` — `jarsClearData`, `jarsWipe` wrappers
- `src/preload/chrome-preload.js` — `jarsClearData`, `jarsWipe` wrappers
- `src/main/main.js` — `INTERNAL_PAGES.jars` gains `'/jar-data-classes.js'`
- `src/renderer/pages/jars.html` — `<script src="jar-data-classes.js">` tag
- `eslint.config.mjs` + `src/renderer/renderer-globals.d.ts` — new global entries
- `test/unit/jar-data-classes.test.js` (new), `test/unit/broadcast-invariant.test.js`
  (new), `test/unit/jar-ipc.test.js` (extended)
- CLAUDE.md — jar IPC surface description mentions the two new channel pairs

## Acceptance Criteria

- [x] `src/shared/jar-data-classes.js` exists: a frozen ordered array
      `JAR_DATA_CLASSES` of frozen descriptors `{ id, label, storages }` —
      `cookies` → `['cookies']`; `storage` (label "Site storage") →
      `['filesystem','indexdb','localstorage','websql','serviceworkers','cachestorage']`;
      `cache` → `storages: null` (sentinel: the handler maps it to `clearCache()` +
      `clearStorageData({ storages: ['shadercache'] })`). Dual-export (CJS +
      `globalThis`), following `src/shared/jar-page-model.js:80-85` exactly. A
      lookup helper `jarDataClassById(id)` (returns the descriptor or null) is
      exported alongside.
- [x] Four-part onboarding complete: eslint.config.mjs globals entry/entries +
      `renderer-globals.d.ts` declares for the new globals + `jars.html` classic
      `<script src="jar-data-classes.js">` (before `jars.js`, after `burner.js` —
      script order comment updated) + `'/jar-data-classes.js'` entry in
      `INTERNAL_PAGES.jars` (`src/main/main.js:117-123` — per-file entry, never a
      directory passthrough).
- [x] `jar-ipc.js` registers `handleClearData` on `jars-clear-data` +
      `internal-jars-clear-data` and `handleWipe` on `jars-wipe` +
      `internal-jars-wipe` (extract-don't-fork — same body both domains, matching
      the six existing pairs at `jar-ipc.js:144-159`).
- [x] `handleClearData(_e, p)` behavior: payload guard identical in shape to the
      existing handlers (`jar-ipc.js:62-64` comment block — object check before any
      `in`/property access); resolves the jar via `jars.list().find(...)`; rejects
      with `{ ok: false }` when: payload is not an object, `id` is missing/unknown,
      the resolved entry is absent (Burner is never a store entry, so `burner`
      naturally rejects), `classes` is not a non-empty array, or ANY class id is
      unknown (strict fail-closed — no partial application). On success applies
      each requested class in list order against `session.fromPartition(partition)`
      and returns `{ ok: true, cleared: [class ids] }`. A thrown session call →
      `{ ok: false }` (fail-soft, matching the delete path's containment stance).
- [x] `handleWipe(_e, p)` behavior: same payload guard + lookup + rejections
      (`{ ok: false }` for burner/unknown/malformed). On success:
      `clearStorageData()` (no filter) → `clearCache()` → `rerollSeed(ses)` →
      `broadcast('jar-wiped', { id })` → return `{ ok: true }` — the same
      composition as `identity-new` (`src/main/main.js:2461-2472`) plus the
      broadcast, minus registry/key effects (the jar persists; its automation key
      stays valid — flight DD3). On a thrown session call: `{ ok: false, error }`
      and NO broadcast (nothing was wiped; no reload should fire). `rerollSeed`
      runs only on the success path.
- [x] Preload wrappers exist on both sides: `internal-preload.js` gains
      `jarsClearData(payload)` / `jarsWipe(payload)` invoking the `internal-jars-*`
      channels (inside the existing jars method block, `internal-preload.js:270-338`,
      with the house JSDoc style); `chrome-preload.js` gains the same two names
      invoking the chrome channels (beside `jarsList`..`jarsGetDefault`,
      `chrome-preload.js:52-58`). NO `onJarWiped` listener in this leg (leg 3 owns
      it with the sweep it feeds).
- [x] `test/unit/jar-data-classes.test.js` (new) pins: array + every descriptor
      frozen; ids unique and exactly `['cookies','storage','cache']` in order;
      every non-null `storages` value is a subset of Electron's
      `ClearStorageDataOptions` taxonomy (assert against a literal copy of the
      eight-value set with a comment citing electron.d.ts:20369); `cookies` maps to
      exactly `['cookies']`; `cache` is the null sentinel; labels non-empty;
      `jarDataClassById` round-trips each id and nulls on unknowns; the browser
      global branch works (vm technique per the house dual-export tests).
- [x] `test/unit/jar-ipc.test.js` extended: clear-data passes the exact `storages`
      array to the fake session's `clearStorageData` per class; cache sentinel
      calls `clearCache` AND `clearStorageData({ storages: ['shadercache'] })`;
      the full rejection matrix (non-object payload, unknown id, `burner`, missing
      classes, empty classes, unknown class id, non-array classes) returns
      `{ ok: false }` and touches no session; wipe composition order is pinned
      (storage → cache → reroll → broadcast payload `{ id }` on channel
      `jar-wiped` → resolve), wipe failure returns `{ ok: false, ... }` with no
      broadcast and no reroll; both new pairs are registered on both trust domains
      (extend the existing registration assertions).
- [x] `test/unit/broadcast-invariant.test.js` (new, DD8): a self-deriving
      source-scan net over `src/main/main.js` + `src/main/jar-ipc.js` asserting
      "every IPC handler body that mutates settings broadcasts `settings-changed`
      in that same body". Mutation markers: `settings.set(`, `mintJarKey(`,
      `revokeJarKey(`, `mintAdminKey(`, `revokeAdminKey(`. The net derives its
      inventory from the source (registration-site extraction or function-body
      extraction — implementer's choice, but it must FAIL if a new mutating handler
      is added without a broadcast, without anyone editing the test). Deliberate
      exceptions require an explicit in-test allowlist entry with a comment.
      **Known real gap, fix it in this leg (FD ruling at design review)**:
      `automation:set-port` (`src/main/main.js:1865-1869`) calls `settings.set`
      and never broadcasts — a genuine pre-existing violation the F7 fix did NOT
      cover. Add `broadcastToChromeAndInternal('settings-changed',
      settings.getAll())` to its body, matching the mint/revoke siblings
      (`main.js:1899-1933`), and record it as an incidental convention fix in the
      flight log. After that fix the net must pass with ZERO allowlist entries.
- [x] CLAUDE.md's jar IPC description mentions the two new channel pairs (one
      sentence each — semantics, trust domains) — anchors: the prose at
      CLAUDE.md:98 and the `internal-jars-*` enumeration at CLAUDE.md:175.
- [x] `automation:set-port` broadcasts `settings-changed` (the DD8-found
      incidental fix — see the invariant-net criterion above).
- [x] Full suite green (`npm test`), typecheck + lint green. Existing tests
      unmodified except `jar-ipc.test.js` extensions.

## Verification Steps

- `npm test` — all pass, incl. the three new/extended files; count strictly above
  1242.
- `npx tsc --noEmit` (or the project's typecheck script) and `npx eslint .` (or the
  project's lint script) — clean, proving the d.ts + eslint onboarding.
- `node -e "const m=require('./src/shared/jar-data-classes'); console.log(m.JAR_DATA_CLASSES.length, m.jarDataClassById('cache'))"` —
  3 descriptors, cache sentinel visible.
- Grep `INTERNAL_PAGES` in main.js — the jars map lists `/jar-data-classes.js`;
  grep `jar-data-classes` in jars.html — script tag present.
- Deliberately (temporarily) remove the broadcast from one mutating handler and run
  the invariant net — it must fail; restore. (Sanity check that the net bites;
  do this locally, do not commit the mutation.)

## Implementation Guidance

1. **`src/shared/jar-data-classes.js`** — mirror `jar-page-model.js`'s file shape:
   `// @ts-check`, header comment (purpose, extensibility contract: history slots
   in later as one more descriptor and the page renders FROM this list), frozen
   data, small helper, dual-export tail. No imports — this module depends on
   nothing. The jars page's scripts share ONE lexical scope
   (jars-page-shared-scripts.test.js enforces the F2 D1 lesson): before finalizing
   the top-level names (`JAR_DATA_CLASSES`, `jarDataClassById`), eyeball
   `jars.js`'s own top-level declarations plus `burner.js`/`safe-color.js`/
   `jar-page-model.js` for collisions.
2. **`jar-ipc.js` handlers** — add the two named functions beside the existing six,
   reusing the injected `session`, `rerollSeed`, `broadcast` deps (all already in
   the `registerJarIpc` signature — `jar-ipc.js:50`; no deps change needed). Require
   `jar-data-classes` at top beside the existing `../shared/burner` require. Update
   the module header comment (currently says "six handlers"/"twelve handlers" —
   keep it truthful).
3. **Class application** — for each class id in payload order: descriptor via
   `jarDataClassById`; `storages` non-null → `await ses.clearStorageData({ storages })`;
   null sentinel → `await ses.clearCache()` then
   `await ses.clearStorageData({ storages: ['shadercache'] })`.
4. **Preloads** — one-line wrappers per side; keep JSDoc in internal-preload
   consistent with its neighbors (document the `{ ok, cleared }` / `{ ok }` shapes
   and the burner rejection).
5. **Invariant net** — recommended derivation: read both source files; slice into
   candidate handler bodies by scanning for registration calls
   (`ipcMain.handle(`, `ipcMain.on(`, `registerInternalHandler(`) and, for
   jar-ipc.js's named-function style, top-level `function handleX` declarations;
   brace-balance to find each body's end. Classify mutating via the marker list;
   assert `settings-changed` appears within the same slice. Keep the extraction
   dumb and commented — this is a convention tripwire, not a parser.
6. **Test fakes** — jar-ipc.test.js's `makeHarness` (lines 68-83) currently mocks
   `clearStorageData()`/`clearCache()` with ZERO-ARG recorders (`{ fn, partition }`
   only). The new assertions need the fakes to (a) capture the options argument and
   (b) support multiple sequential calls with different args on one session — this
   is a harness-function rewrite shared by all 23 existing tests, so ADD fields
   (e.g. `args`) without changing the existing `{ fn, partition }` shape the
   current `events.map(e => e.fn)` assertions read.
7. **Run gates last** — suite, typecheck, lint; fix what they catch.

## Edge Cases

- **`classes` with duplicates** (e.g. `['cookies','cookies']`): valid ids, so it
  passes the strict guard; applying twice is harmless. Do not dedupe — keep the
  handler dumb; pin the behavior with a test comment if convenient.
- **Cold partition**: `session.fromPartition` on a never-opened jar creates the
  session just to clear it — harmless empty clear (same stance as delete,
  `jar-ipc.js:119-121`).
- **`{ id: 'burner' }`**: never a store entry → `find` misses → `{ ok: false }`.
  Also covers `burner-<n>` ids (never store entries either).
- **Payload with extra fields**: ignored — only `id`/`classes` are read.
- **Broadcast timing**: `jar-wiped` fires BEFORE the invoke resolves (house
  broadcast-before-resolve rule) so the page can rely on chrome having been told
  by the time its confirm closes.

## Files Affected

- `src/shared/jar-data-classes.js` — new
- `src/main/jar-ipc.js` — two handlers + registrations + header comment
- `src/preload/internal-preload.js`, `src/preload/chrome-preload.js` — wrappers
- `src/main/main.js` — one INTERNAL_PAGES entry
- `src/renderer/pages/jars.html` — one script tag
- `eslint.config.mjs`, `src/renderer/renderer-globals.d.ts` — globals onboarding
- `test/unit/jar-data-classes.test.js`, `test/unit/broadcast-invariant.test.js` — new
- `test/unit/jar-ipc.test.js` — extended
- `CLAUDE.md` — jar IPC surface sentence

## Citation Audit

Verified at leg design time (2026-07-10), all read live this session; two drift
repairs from design review applied: `jar-ipc.js:50` (registerJarIpc deps incl.
session/rerollSeed/broadcast), `:60` (payload-guard comment — was cited :62-64),
`:115-142` (handleRemove wipe composition), `:119-121` (cold-partition stance),
`:144-159` (twin registrations); `main.js:118-125` (INTERNAL_PAGES.jars — was
cited :117-123), `:2461-2472` (identity-new composition), `:1899-1933` (mint/revoke
broadcast convention + F7 fix comment), `:1865-1869` (automation:set-port — the
DD8-found gap); `internal-preload.js:270-338` (jars wrapper block),
`chrome-preload.js:52-58` (chrome jars wrappers); `jar-page-model.js:80-85`
(dual-export tail); CLAUDE.md:98 + :175 (jar IPC doc anchors);
electron.d.ts:20369 (ClearStorageDataOptions storages taxonomy). All OK.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (suite + typecheck + lint)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [ ] Do NOT commit — the flight uses deferred review (review + commit after leg 3)
