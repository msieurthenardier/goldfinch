# Leg: data-class-and-retention-backend

**Status**: completed
**Flight**: [History Panel Content](../flight.md)

## Objective

Land history's backend integration into the jar data model: the `history`
data class with discriminator-first clearing, history purge on wipe/delete
via the extracted `wipeJarData` helper, the `pruneOneJar` store method,
`setRetention` (store + IPC twins + prune-on-change), and the preload/d.ts
surface — all unit-pinned. No page changes (leg 2).

## Context

Flight DD1–DD4 (as amended through two review cycles) are the contract.
Review-cycle nits to honor here: (a) phrase the extraction comment as
honoring the M06 F4 DD3 "revisit at the next copy" trigger's INTENT (3
pre-existing copies + the new purge concern — don't claim a literal
fourth call site); (b) the history branch inside `handleClearData` gets
its own distinct error fragment (`history-failure`, static) rather than
reusing `session-failure`, for mixed-class diagnosability.

## Changes (implement exactly)

1. **`src/shared/jar-data-classes.js`**: append
   `Object.freeze({ id: 'history', label: 'History', storages: null,
   custom: 'history' })` to `JAR_DATA_CLASSES`. **Add `custom?: string`
   to the `JarDataClass` typedef** *(design review, HIGH — checkJs is
   project-wide; `d.custom` access without the typedef field fails
   `npm run typecheck`)*. Update the header comment (the promise is being
   kept). Tests (`test/unit/jar-data-classes.test.js`): update the
   hardcoded id-list assertion (now 4); replace the
   `jarDataClassById('history') === null` "unknown id" example with a
   different unknown id; add pins for the new descriptor's shape (label,
   `custom`, frozen). **ALSO in `test/unit/jar-ipc.test.js`** *(design
   review, HIGH — missed breaking tests)*: lines ~470 and ~482 use
   `'history'` as the canonical UNKNOWN class id
   (`unknown-class: history` expectations) — rewrite both with a
   genuinely-unknown id (e.g. `'nonexistent'`).
2. **`src/main/history-store.js`**: add `pruneOneJar(jarId, days, now)` —
   validates args in `recordVisit`'s style (throw `TypeError` on
   non-string jarId / non-finite days/now — pinned convention, *design
   review Q3*), runs ONLY the per-jar cutoff delete (the existing
   `pruneJar` prepared statement — `DELETE FROM visits WHERE jar_id = ?
   AND visited_at < ?` — is reusable verbatim), returns the deleted
   count. NO orphan sweep. Export it; **add it to the repo-interface
   method-list test AND the throws-before-open list** in
   `history-store.test.js` *(design review — that test only checks
   listed names; omission is a silent coverage hole)*. Tests: cutoff
   behavior, returns count, **no-collateral pin** (other jars' rows
   untouched), validation errors.
3. **`src/main/jars.js`**: `setRetention(id, days)` — unknown id → null;
   `days` must be an integer in 1–3650 (REJECT invalid → null; do NOT
   coerce — contrast with load-time `cleanRetention`); on success mutate
   the record, `save()`, return the updated container. Tests: happy path
   + persistence round-trip, unknown id, the rejection table (0, 1.5,
   '30', 3651, null), and that `rename()` still ignores retention.
4. **`src/main/jar-ipc.js`**:
   - Deps gain `historyStore` (JSDoc updated; `main.js` call site passes
     the real store).
   - `handleClearData`: discriminator-FIRST dispatch per flight DD1,
     INLINE in the existing per-descriptor loop *(design review: shape
     pinned)* — sketch:
     ```js
     for (const classId of p.classes) {
       const d = jarDataClassById(classId); // already validated above
       if (d.custom === 'history') {
         try {
           historyDeleted = historyStore.clearJar(p.id);
         } catch (e) {
           console.error('[history]', e); // house convention (Q1: yes, log)
           return { ok: false, error: 'jars: clear-data — history-failure' };
         }
         cleared.push(classId);
         continue;
       }
       // existing storages / cache branches unchanged, still inside the
       // outer session try/catch
     }
     ```
     After the loop: if history was cleared AND `historyDeleted > 0`,
     broadcast `history-changed { jarId: p.id }`. Mixed
     `['history','cookies']` therefore clears in request order with
     per-branch error attribution (`history-failure` vs
     `session-failure`). Existing branches untouched.
   - Extract `wipeJarData(ses, jarId)` (module-local): the
     clearStorageData + clearCache + `rerollSeed` composition currently
     duplicated in `handleRemove`/`handleWipe` (no shadercache-specific
     call — that exists only in the clear-data cache branch; do NOT add
     one — *design review*), PLUS the history purge. **Failure-isolation
     shape pinned** *(design review)*: the SESSION calls stay un-caught
     inside the helper — they propagate to each caller's OWN existing
     try/catch (preserving `handleRemove`'s fail-soft `wiped=false`
     continuation and `handleWipe`'s fail-hard return exactly); ONLY the
     `historyStore.clearJar(jarId)` line gets an inner try/catch —
     fail-soft (logged `console.error('[history]', …)`, never flips
     `ok`), and it runs AFTER the session calls, so a session throw
     naturally skips the purge. Returns the purged-row count (0 on purge
     failure). Extraction comment phrased as honoring the M06 F4 DD3
     revisit-trigger's INTENT (3 pre-existing copies + the new purge
     concern), not a literal fourth call site.
     Both handlers use it; `handleWipe` additionally broadcasts
     `history-changed { jarId }` when the purge deleted rows (n > 0),
     BEFORE its existing `jar-wiped` broadcast? — NO: keep `jar-wiped`
     ordering exactly as today and emit `history-changed` immediately
     after it (jar-wiped drives tab reloads; don't reorder a shipped
     contract). `handleRemove` emits no history broadcast.
   - `handleSetRetention(e, p)`: malformed payload →
     `'jars: set-retention — malformed-payload'`; unknown jar (setRetention
     returned null on id) → `'jars: set-retention — unknown-jar'`; invalid
     days (null from validation with a known id — distinguish by checking
     `jars.list()` membership first) → `'jars: set-retention — invalid-days'`;
     success → broadcast `jars-changed` (via the existing
     `broadcastJarsChanged`), then `historyStore.pruneOneJar(p.id, p.days,
     Date.now())` in its own try/catch, broadcasting
     `history-changed { jarId }` when rows were deleted; return
     `{ ok: true, container }` (deliberate first use of an
     `{ ok, container }` wrapper in jar-ipc — the validation-failure
     branches force an `ok` envelope; *design review Q2: confirmed
     deliberate*). Twin-register as `jars-set-retention` /
     `internal-jars-set-retention`.
   - All new error strings STATIC (grep-AC below).
5. **`src/preload/internal-preload.js`**: `jarsSetRetention: (payload) =>
   ipcRenderer.invoke('internal-jars-set-retention', payload)`.
   **`src/preload/chrome-preload.js`**: NOT touched (internal-only
   consumer this flight — flight Technical Approach).
   **`src/renderer/renderer-globals.d.ts`**: declare on
   `GoldfinchInternalBridge` (loose style).
6. **`src/main/main.js`**: pass `historyStore` into the `registerJarIpc`
   deps object. No other main.js changes.
7. **Tests for jar-ipc** (`test/unit/jar-ipc.test.js`): the harness has
   NO fake historyStore today (it fakes session/rerollSeed/revokeJarKey/
   settings/broadcast) — **build one from scratch** mirroring
   `history-ipc.test.js`'s `makeFakeStore` (in-memory Map-backed,
   per-method `throws.<method>` toggles) *(design review)*. Pins:
   clear-data `['history']` clears via the store + broadcasts on n>0
   (and NOT on 0); the cache class still routes to clearCache
   (regression pin for the fallthrough hazard); mixed
   `['history','cookies']` clears both; history-failure static string on
   store throw (session classes unaffected); wipe purges history +
   broadcasts history-changed after jar-wiped (order pinned) + stays
   ok:true when the purge throws (and emits no history-changed then);
   **session-throw-with-history-rows pins on BOTH handlers** (remove:
   fail-soft continues, purge skipped since it runs after the throwing
   session calls; wipe: fail-hard returns, purge skipped) *(design
   review)*; remove purges history silently; set-retention full branch
   table + prune-on-change (deleted>0 → broadcast; 0 → none) +
   jars-changed always on success; twin registration surface updated
   (count from the file — expect 9+9; pin the exact list);
   untrusted-sender loop covers the new internal channel. Also refresh
   the stale jars.test.js title "(no public setter this leg — file
   edited directly)" — a setter exists now.

## Acceptance Criteria

- [x] All changes above implemented as specified; every new error string
      pinned VERBATIM in tests.
- [x] Grep-ACs: `grep -n '\${' src/main/jar-ipc.js` → only the
      pre-existing hits (baseline is 3 call sites: `unknown-class:` once,
      `session-failure:` twice — do NOT add new dynamic strings);
      `grep -c "clearStorageData" src/main/jar-ipc.js` reflects the
      extraction (the wipe composition written once in `wipeJarData`;
      the clear-data storages/cache branches keep their own calls).
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; suite ~1s.
- [x] No page/renderer changes beyond the d.ts declare.

## Verification Steps

- Gates + grep-ACs. `node -e "require('./src/main/jar-ipc')"` side-effect
  free.

## Edge Cases

- `pruneOneJar` with days making the cutoff future-dated (huge days value
  is capped by validation at the IPC layer; the store method itself
  accepts any positive integer — document that the IPC layer is the
  validator, store is mechanism).
- Clearing history for a jar with zero rows: ok:true, no broadcast
  (n>0 gate) — same as history-ipc's clear.
- `setRetention` to the CURRENT value: still ok:true, still saves and
  broadcasts (idempotent write; no special-casing).

## Files Affected

- `src/shared/jar-data-classes.js`, `test/unit/jar-data-classes.test.js`
- `src/main/history-store.js`, `test/unit/history-store.test.js`
- `src/main/jars.js`, `test/unit/jars.test.js`
- `src/main/jar-ipc.js`, `test/unit/jar-ipc.test.js`
- `src/preload/internal-preload.js`, `src/renderer/renderer-globals.d.ts`
- `src/main/main.js` (deps line)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

Seams verified across the two flight-design review cycles against the
live tree (handleClearData dispatch shape, the 3 composition copies,
CONFIRM_REGIONS/data-driven updateConfirmAreas, the two breaking
jar-data-classes tests at :38/:86, pruneExpired's orphan contract,
cleanRetention). Symbol-form navigation.
