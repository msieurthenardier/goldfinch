# Leg: history-read-tool

**Status**: completed
*(Designed directly against flight DD1–DD3 as amended — the Architect
review already verified every seam this leg touches (engine getDownloads
injection, scope custom-op precedents, ToolDef arrays, guard-test
mechanics, the two stale-description sites); a separate leg design review
would re-walk the same citations. FD call, logged.)*
**Flight**: [Automation History Surface](../flight.md)

## Objective

Land `getHistory` end-to-end below the transport: engine op + injected
accessors, `HISTORY_TOOLS` ToolDef, scope-façade confinement, unit tests,
and the `enumerateTabs` description fix (mcp-tools side).

## Contract (flight DD1 as amended is authoritative — read it first)

1. **`engine.js`**: deps gain `getHistoryReads` (an injected
   `{ listRecent(jarId, opts), search(jarId, query, opts) }` pair — the
   `getDownloads` precedent) and `isKnownJar(jarId)`. New op
   `getHistory(jarId, { query, limit, before } = {})`:
   - `jarId` must be a non-empty string → else throw
     `automation: bad-args — jarId required` (static; admin reaches the
     engine directly and has no implicit jar).
   - `!isKnownJar(jarId)` → throw `automation: unknown-jar`.
   - `query` AND `before` both present → `automation: bad-args —
     query does not page` (static).
   - `query` (non-empty string) → `search(jarId, query, { limit })`;
     else → `listRecent(jarId, { limit, before })`.
   - Returns `{ jarId, visits }` (rows as the store returns them).
2. **`main.js`**: thread the two accessors into `createEngine` /
   the admin engine construction —
   `getHistoryReads: { listRecent: (id, o) => historyStore.listRecent(id, o),
   search: (id, q, o) => historyStore.search(id, q, o) }`,
   `isKnownJar: (id) => jars.list().some(j => j.id === id)` (match the
   existing injection style at the `getDownloads` site).
3. **`mcp-tools.js`**: new `HISTORY_TOOLS` array (own comment:
   jar-confined, NOT admin-only — jar keys read their own jar; admin
   reads any) with the `getHistory` ToolDef: input `{ jarId?: string,
   query?: string, limit?: integer, before?: integer }`, description
   spelling the identity semantics (jar key: jarId optional and must be
   its own; admin: jarId required), JSON-text result. Merge into `TOOLS`.
   Fix the `enumerateTabs` description's stale "non-internal" claim
   (admin listings include internal tabs; jar listings never do).
4. **`scope.js`**: custom façade op (beside `enumerateTabs`):
   ```js
   async getHistory(jarId, opts) {
     requireJar();
     if (jarId != null && jarId !== jar.id) throw new Error('automation: out-of-jar');
     return engine.getHistory(jar.id, opts);
   }
   ```
   (exact style per the file's conventions; admin identity returns the
   engine unchanged, as today). File-header note: this op is the first
   jar-CONFINED no-wcId read — contrast with the admin-only customs.
5. **Tests**:
   - `automation-engine` (or the op's home suite): fakes for the two
     accessors; the full branch matrix (missing jarId, unknown jar,
     query+before, query path, recent path incl. before passthrough,
     result shape).
   - `automation-scope.test.js`: jar key — no jarId → own-jar call;
     own jarId → allowed; foreign jarId → `automation: out-of-jar`
     (thrown BEFORE any engine/accessor call — pin zero accessor
     invocations); admin — engine unchanged (any jarId flows through).
   - `automation-mcp-tools.test.js`: registry count 27→28; the new
     ToolDef's schema/description assertions per that suite's
     conventions; the guard test needs NO changes (no wcId — verify it
     still passes untouched).
   - Static error strings only (grep-AC: no `${` added to any automation
     module).
6. Gates: `timeout 120 npm test`, typecheck, lint — green, ~1s.

## Files Affected

- `src/main/automation/engine.js`, `src/main/automation/mcp-tools.js`,
  `src/main/automation/scope.js`, `src/main/main.js`
- `test/unit/automation-engine.test.js` (or equivalent),
  `test/unit/automation-scope.test.js`,
  `test/unit/automation-mcp-tools.test.js`

---

## Post-Completion Checklist

- [x] All acceptance criteria (the Contract + green gates) verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit *(no git ops performed)*
