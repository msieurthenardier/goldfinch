# Leg: ipc-surface

**Status**: completed
**Flight**: [Jar Lifecycle Model](../flight.md)

## Objective

Expose the v2 jar lifecycle over IPC — `jars-rename`, `jars-remove`,
`jars-set-default`, `jars-get-default` alongside the existing `jars-list`/`jars-add`
— with the delete-time side-effect composition (partition wipe, seed reroll, key
revoke) and a `jars-changed` broadcast after every mutation, implemented in a new
unit-testable `src/main/jar-ipc.js` module rather than inline in main.js (flight CP3).

## Context

- Flight DD6: the store stays pure; session side-effects live in the IPC handler
  layer. Delete composes: `jars.remove()` → partition wipe (`clearStorageData()` +
  `clearCache()`, the identity-new pattern at main.js:2322-2333) → `rerollSeed(ses)`
  (fresh persona if the slug is ever re-created) → `revokeJarKey(removed.id,
  settings)` (mcp-server.js:914 — idempotent, hash-only) → `settings-changed`
  broadcast (the mint path already broadcasts, main.js:1805; revoke today doesn't —
  this closes that gap for the delete path) → `jars-changed` broadcast.
- Flight DD6: after EVERY mutating operation (add / rename / remove / setDefault)
  broadcast `jars-changed` carrying `{ containers, defaultId }` via
  `broadcastToChromeAndInternal` (main.js:1579 — reaches the chrome renderer plus
  every internal-session webContents; the mechanism `shields-changed` /
  `settings-changed` already use). Both add entry points emit it: the `jars-add`
  IPC (main.js:2317-2318) and the picker's `new-container-create`
  (main.js:1876-1882).
- Flight DD7: `jars-list` keeps its bare-array shape (renderer boot unchanged);
  default info rides `jars-get-default` (returns the jar object, or `BURNER`).
  The mutating channels are deliberately **chrome-trusted** (bare `ipcMain.handle`,
  same domain as `jars-add` — see the "INTENTIONALLY NOT behind the internal-sender
  guard" precedent comment at main.js:1591-1593); Flight 3 adds internal-origin-
  gated variants for the management page. Zero renderer changes this flight.
- **Module extraction (this leg's structural choice)**: the M05 mission debrief's
  #1 structural debt is the 2545-line main.js; this leg does NOT feed it. New
  `src/main/jar-ipc.js` exports `registerJarIpc(deps)` — deps injected
  (`{ ipcMain, jars, session, rerollSeed, revokeJarKey, settings, broadcast }`) so
  the whole surface is unit-testable without Electron (the init-profile.js /
  downloads-manager extraction precedent). It registers the six jar-registry
  channels (`jars-list`, `jars-add`, `jars-rename`, `jars-remove`,
  `jars-set-default`, `jars-get-default`) and returns `{ broadcastJarsChanged }`
  for main.js to reuse in `new-container-create` (which stays in main.js — its
  flow is renderer-tangled, only its body gains the broadcast call).
- `defaultId` derivation for the payload: `jars.getDefault()` returns the module's
  own `BURNER` object (same reference, src/shared/burner.js) when the store is
  empty — so `const d = jars.getDefault(); const defaultId = d === BURNER ? null :
  d.id;` is exact. jar-ipc.js requires `BURNER` itself; no new jars.js export
  needed.
- `identity-new` (main.js:2322-2333) is partition-generic, not jar-registry —
  leave it in main.js untouched.

## Inputs

- Legs 1–2 landed: full lifecycle store API (`rename`/`remove` return
  container-or-null; `setDefault` boolean; `getDefault` jar-or-BURNER), migration
  complete, 1109/1109 green, uncommitted on `flight/01-jar-lifecycle-model`.

## Outputs

- `src/main/jar-ipc.js` — new: `registerJarIpc(deps)` + jar-changed broadcast.
- `src/main/main.js` — inline `jars-list`/`jars-add` handlers replaced by the
  `registerJarIpc` call; `new-container-create` gains the broadcast; no other
  handlers touched.
- `src/preload/chrome-preload.js` — `jarsRename` / `jarsRemove` / `jarsSetDefault`
  / `jarsGetDefault` invoke wrappers + `onJarsChanged` listener.
- `test/unit/jar-ipc.test.js` — new suite.

## Acceptance Criteria

- [x] `src/main/jar-ipc.js` exists, Electron-free (all deps injected), and
      registers exactly the six jar-registry channels via `deps.ipcMain.handle`.
      Handler contracts:
      - `jars-list` → `jars.list()` (bare array, unchanged shape).
      - `jars-add` `{ name, color }` → `jars.add(name, color)`, then broadcast.
      - `jars-rename` `{ id, name?, color? }` → `jars.rename(id, patch)` passing
        ONLY the fields present in the payload (an absent field must stay absent so
        the store preserves it); broadcast on success (non-null); return the
        container-or-null result.
      - `jars-set-default` `{ id }` → `jars.setDefault(id)`; broadcast on `true`;
        return the boolean.
      - `jars-get-default` → `jars.getDefault()` (jar object or `BURNER`).
      - `jars-remove` `{ id }` (async) → `jars.remove(id)`; unknown id → `{ ok:
        false }` with NO side effects; on success: wipe the removed jar's partition
        (`session.fromPartition(removed.partition)` → `await clearStorageData()` +
        `await clearCache()`), `rerollSeed(ses)`, `revokeJarKey(removed.id,
        settings)`, broadcast `settings-changed` with `settings.getAll()`, broadcast
        `jars-changed`; return `{ ok: true, removed, wiped }` where `wiped: false`
        if the wipe threw (registry removal already happened — fail-soft, matching
        identity-new's error containment; reroll/revoke/broadcasts still run).
- [x] All handlers are payload-hardened: a missing/undefined/malformed payload —
      including non-object primitives (string, number) — returns the failure value
      (`null` / `false` / `{ ok: false }`) instead of throwing. Guard shape:
      `if (p === null || typeof p !== 'object') return <failure>;` BEFORE any
      `'in'` access (the `in` operator throws on primitives — an `if (!p)` guard
      alone doesn't cover `'x'` or `42`). `jars-add` additionally mirrors
      `new-container-create`'s name guard (`if (!name || typeof name !== 'string')
      return null`, main.js:1879) so the two add entry points agree — a `{}` or
      `{ name: 42 }` payload returns `null` with no broadcast, never a jar named
      "undefined".
- [x] `jars-changed` payload is `{ containers: jars.list(), defaultId }` with
      `defaultId` derived by BURNER reference identity (null ⇔ Burner default);
      emitted via the injected `broadcast` function on every successful mutation
      (add, rename, set-default, remove) and NOT on failed ones.
- [x] `src/main/main.js`: the two inline handlers at the "cookie jars / container
      identities" section (main.js:2316-2318) are replaced by `registerJarIpc({...})`
      wired with the real deps (`ipcMain`, `jars`, `session`, `rerollSeed`,
      `revokeJarKey`, `settings`, `broadcast: broadcastToChromeAndInternal`);
      `new-container-create` (main.js:1876-1882) calls the returned
      `broadcastJarsChanged()` after a successful `jars.add`; a short comment marks
      the mutating channels as deliberately chrome-trusted with Flight 3 noted for
      the internal-origin-gated variants (DD7).
- [x] `src/preload/chrome-preload.js`: `jarsRename(payload)`, `jarsRemove(payload)`,
      `jarsSetDefault(payload)`, `jarsGetDefault()` invoke wrappers beside the
      existing `jarsList`/`jarsAdd` (chrome-preload.js:53-55), and
      `onJarsChanged(cb)` following the `onShieldsChanged` pattern
      (chrome-preload.js:43).
- [x] `test/unit/jar-ipc.test.js`: fake `ipcMain` capturing handlers; real jars
      module (cache-busted + temp-dir loaded, the jars.test.js pattern); spy
      `session.fromPartition` returning a fake session with async
      `clearStorageData`/`clearCache`; spy `rerollSeed`/`revokeJarKey`/`broadcast`;
      fake `settings` with `get`/`set`/`getAll`. Cover at minimum:
      - six channels registered, no others;
      - list passthrough; add broadcasts with correct payload shape;
      - rename: field-preservation (color-only patch keeps name), success
        broadcast, unknown-id → null + no broadcast;
      - set-default: true + broadcast; unknown id → false + no broadcast;
      - get-default: returns BURNER (reference-equal) when store empty; derived
        `defaultId` null in the empty-store broadcast, string otherwise;
      - remove: full composition ordering observable (wipe called on the removed
        partition's session, reroll same session object, revoke with removed id +
        settings, settings-changed broadcast with getAll() payload, jars-changed
        broadcast, `{ ok: true, wiped: true }`);
      - remove unknown id: `{ ok: false }`, zero spy calls;
      - remove with a throwing `clearStorageData`: `{ ok: true, wiped: false }`,
        reroll/revoke/broadcasts still invoked;
      - payload hardening for all four mutating channels (undefined payload), plus
        a non-object payload case (e.g. a string) for at least `jars-rename`, and
        `jars-add` with `{}` / `{ name: 42 }` → null, no broadcast;
      - `jars-set-default` with `{ id: null }`: `false` + no broadcast while jars
        exist; `true` + broadcast carrying `defaultId: null` on an empty store
        (exercises DD2 strictness through the IPC layer);
      - assert broadcast payloads immediately (or snapshot them): the payload
        carries the LIVE containers array (structured-cloned at the real IPC
        boundary, but a plain reference in the fake harness).
- [x] Full gates green: `npm test`, `npm run typecheck`, `npm run lint` (baseline
      entering: 1109/1109).

## Verification Steps

- `node --test test/unit/jar-ipc.test.js` — suite passes.
- `npm test && npm run typecheck && npm run lint` — clean.
- `grep -n "jars-list\|jars-add" src/main/main.js` → only the `registerJarIpc`
  call region (no inline handlers left).
- `grep -c "ipcMain.handle" src/main/jar-ipc.js` → 6 (or equivalent via the
  injected dep).

## Implementation Guidance

1. **`src/main/jar-ipc.js`**: header comment stating the DD6/DD7 contract (pure
   store + side-effect composition here; chrome-trusted; Flight 3 adds
   internal-origin-gated variants). Shape:
   ```js
   const { BURNER } = require('../shared/burner');
   function registerJarIpc({ ipcMain, jars, session, rerollSeed, revokeJarKey, settings, broadcast }) {
     function broadcastJarsChanged() {
       const d = jars.getDefault();
       broadcast('jars-changed', { containers: jars.list(), defaultId: d === BURNER ? null : d.id });
     }
     // ... six ipcMain.handle registrations ...
     return { broadcastJarsChanged };
   }
   module.exports = { registerJarIpc };
   ```
   For `jars-rename`, guard first (`if (p === null || typeof p !== 'object')
   return null;`), then build the patch conditionally: `if ('name' in p)
   patch.name = p.name;` etc. — `rename` treats `undefined` as "not provided", but
   an explicit `{ name: undefined }` key must not clobber either; the `'in'` check
   (after the object guard) is the robust form.
2. **`jars-remove`**: wrap ONLY the wipe (`clearStorageData`/`clearCache`) in
   try/catch → `wiped` flag; `rerollSeed`, `revokeJarKey`, and both broadcasts run
   regardless. Order: remove → wipe → reroll → revoke → settings-changed →
   jars-changed.
3. **main.js**: replace main.js:2316-2318 with the `registerJarIpc` call (keep the
   `// --- cookie jars / container identities ---` section banner); destructure
   `broadcastJarsChanged` and call it in `new-container-create` after `jars.add`
   returns a container (handler body main.js:1878-1882 — keep its existing
   null-name guard and return shape). Note: the handler body references
   `broadcastJarsChanged` whose `const` destructuring sits ~440 lines later — this
   is legal (deferred execution; the handler runs long after module evaluation)
   and passes tsc + this eslint config. Do NOT relocate the `registerJarIpc` call
   to "fix" it; either placement works, in-place keeps the section banner
   meaningful. `session`, `rerollSeed`, `revokeJarKey`, `settings`,
   `broadcastToChromeAndInternal` are all in scope at that point in the file
   (rerollSeed defined at main.js:1837; ensure the registration happens after those
   definitions — the current jar section at :2316 already is).
4. **Preload**: mirror the existing wrapper style exactly (chrome-preload.js:53-55,
   `onShieldsChanged` at :43).
5. **Tests**: model the fake-deps harness on existing patterns (internal-ipc /
   downloads-manager suites use injected fakes); reuse jars.test.js's temp-dir +
   cache-bust helpers for the real store. Node's per-file process isolation keeps
   the shared jars module state safe.

## Edge Cases

- **Removing the default-flag holder** — store already reassigns the flag
  (Leg 1); the jars-changed payload must reflect the NEW defaultId (assert in the
  composition test).
- **Removing the last jar** — payload `defaultId: null`, `containers: []`;
  `getDefault()` (and the `jars-get-default` channel) returns BURNER.
- **`session.fromPartition` on an already-cold partition** — creates the session
  to wipe it; harmless (empty wipe) and unavoidable without tracking liveness.
- **Open tabs in a removed jar** — out of scope (Flight 2/3 owns renderer
  reaction; mission criterion "open tabs close" lands with the UI). The broadcast
  is the hook they'll use.
- **`jars-changed` with zero listeners** — fire-and-forget by design (flight DD6);
  nothing subscribes until Flight 2.
- **`setDefault(currentHolder)`** — the store returns `true` (idempotent success,
  Leg 1 contract), so the channel re-broadcasts on a no-op change. Deliberate:
  harmless, keeps the contract simple; test authors should not treat it as a bug.
- **`settings-changed` on remove is unconditional** — broadcast even when the jar
  had no automation key (`revokeJarKey` no-ops). Intentional simplicity, matching
  the mint path's unconditional broadcast (main.js:1805); harmless re-sync.
- **Rename/remove of id `default` (the legacy jar)** — fully allowed, no special
  casing: it's a normal jar in the v2 model. (Its partition `persist:goldfinch` is
  still pre-warmed by main.js at startup — pre-existing Flight 2 concern, not
  this leg's.)

## Files Affected

- `src/main/jar-ipc.js` — new
- `src/main/main.js` — jar section swap + new-container-create broadcast
- `src/preload/chrome-preload.js` — four wrappers + one listener
- `test/unit/jar-ipc.test.js` — new

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

Verified at leg design time against the working tree (post-Leg-2, uncommitted):

- `src/main/main.js:1579` (`broadcastToChromeAndInternal`), `:1591-1593`
  (chrome-trust precedent comment), `:1806` (mint-path `settings-changed`
  broadcast), `:1837` (`rerollSeed`), `:1876-1882` (`new-container-create`),
  `:2316-2318` (jar section + inline handlers), `:2322-2333` (`identity-new`
  wipe pattern) — OK (all re-read this session, post-Leg-1/2 tree; jar section
  observed at 2316-2318 in current tree).
- `src/main/automation/mcp-server.js:914` (`revokeJarKey(jarId, settings)`,
  hash-only, idempotent) — OK (read this session).
- `src/preload/chrome-preload.js:43` (`onShieldsChanged`), `:53-55`
  (`jarsList`/`jarsAdd`/`identityNew`) — OK (grep-verified this session).
- `src/shared/burner.js` (`BURNER` frozen constant, reference-identity contract)
  — OK (Leg 1 output, read).
- jars.js lifecycle API return contracts — OK (file read in full post-Leg-1;
  Leg 2 touched only `load()` and comments).
