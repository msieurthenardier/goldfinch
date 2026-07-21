# Leg: audit-origin

**Status**: completed
**Flight**: [Portability + Rotation + Hardening + Docs](../flight.md)

## Objective

Close the mission's Known Issue #2: make the MCP automation audit log record the **resolved fill
origin** for `vaultFill` and the **unlocked-vault count** for `vaultUnlock`. Today `deriveAuditDetail`
is args-only, so it can record `item=<id>` but not the origin the fill actually matched against (the
origin is computed inside `fill()` from the live tab URL — it depends on the RESULT, not the args). This
leg threads the result to the audit hook via three hops (DD6), keeping the invariant that **no accessKey,
admin private key, password, or recovery code ever enters the audit detail**. Internal-page vault-
management ops stay unaudited (DD6, out of scope).

## Context

- **Flight DD6** — the resolved origin travels THREE hops: (1) `vault-context.fill`'s return —
  currently `{ filled: true, id }` (`vault-context.js:337`) — **widened to carry the resolved
  `tabOrigin`**; (2) the `vaultFill` MCP tool result surfaces it into `result.content` — this happens
  **automatically** once (1) lands, because `okResult(value)` (`mcp-tools.js:66-68`) JSON-serializes the
  ENTIRE fill return into the single text-content block, so no tool-def/`okResult` change is required;
  (3) `deriveAuditDetail(op, args)` → `(op, args, result)` reads the new `result` param at the existing
  call site (`mcp-server.js:451` computes `result` before `:469` records). Origin is **non-secret** (the
  automation client drove the fill into that wcId and can already read its URL via `enumerateTabs`).
- **The unlock count** — `unlock` already returns `{ unlocked: opened }` where `opened` is a `string[]`
  of opened vault ids (`vault-context.js` `unlock`). The audit records `unlocked=<N>` (N = the array
  length) — the **count only**, never the ids-as-secrets and never the accessKey/code.
- **The secret invariant** — `deriveAuditDetail` must NEVER derive detail from a secret. `vaultUnlock`
  args carry the `accessKey`; today the op returns `null` (records nothing). The change reads
  `unlocked=N` from the RESULT, never from args — the accessKey stays unreadable. All result parsing is
  wrapped so a malformed/absent result degrades to the old (args-only / null) detail, never throws.

## Inputs

- `src/main/automation/mcp-server.js:80-144` (`deriveAuditDetail(op, args)` — the `switch`; `vaultUnlock`
  `:133-134` returns null, `vaultFill` `:139-140` returns `item=<id>`); `:451` (`const result = await
  registry.callTool(name, args)`); `:462-470` (the `auditLog.record({... detail: deriveAuditDetail(name,
  args) })` call); `:1118` (the `deriveAuditDetail` export).
- `src/main/vault/vault-context.js:310-338` (`fill` — `tabOrigin` computed `:316`, the success return
  `{ filled: true, id: itemId }` `:337`), the `unlock` return `{ unlocked: opened }`.
- `src/main/automation/mcp-tools.js:57-68` (`serialize`/`okResult` — confirms the whole return is
  serialized into `content[0].text`); `:662-678` (the `vaultFill` tool def + its result-shape
  description string).
- `test/unit/vault-context.test.js:447-459` (the `deriveAuditDetail` vault-op secret tests + the fill
  assertions that pin `{ filled: true, id }`); `test/unit/automation-mcp-server.test.js:1215-…` (the
  `deriveAuditDetail` per-op mapping tests + any audit-record integration).

## Outputs

- **`vault-context.fill` widened return** — on the success path, return `{ filled: true, id: itemId,
  origin: tabOrigin }` (`vault-context.js:337`). The not-filled paths are unchanged (`{ filled: false,
  reason }`). `origin` is the already-resolved top-frame origin string; no new computation.
- **`deriveAuditDetail(op, args, result)`** — signature gains an optional third param (default
  `undefined` → every existing 2-arg caller/test keeps its exact behavior). A tiny local
  `parseResultJson(result)` helper reads `result?.content?.[0]?.text` and `JSON.parse`s it inside a
  try/catch returning `null` on any failure (never throws). Then:
  - `vaultFill` — base `item=<id>` from args as today; if the parsed result has `filled === true` and a
    non-empty `origin`, append ` origin=<origin>` → `item=<id> origin=<origin>`. No result / not-filled
    / unparseable → `item=<id>` (unchanged).
  - `vaultUnlock` — if `parseResultJson(result) === null` (no result / 2-arg call / unparseable) →
    return `null` (unchanged — preserves the existing 2-arg secret tests and malformed-result
    degradation); otherwise return `unlocked=<N>` where
    `N = Array.isArray(parsed.unlocked) ? parsed.unlocked.length : 0` (the `Array.isArray` guard makes
    the count airtight against a non-array `unlocked`). NEVER reads `args.accessKey`.
  - All other ops unchanged.
- **Call site** — `mcp-server.js:469` passes the already-computed `result`:
  `detail: deriveAuditDetail(name, args, result)`.
- **`vaultFill` tool description** — update the result-shape sentence (`mcp-tools.js:666`) to note the
  success result now also carries the resolved `origin` (still no credential/password).
- **Tests** — unit: `deriveAuditDetail` — `vaultFill` with a `{filled:true,id,origin}` result →
  `item=<id> origin=<origin>`; `vaultFill` with a not-filled/absent result → `item=<id>`; `vaultUnlock`
  with `{unlocked:['global','work']}` → `unlocked=2`, with `{unlocked:[]}`/no result → `unlocked=0`/null;
  the **secret invariant** — no accessKey / admin key / password appears for ANY vault op regardless of
  the result (extend the existing `:447` test to pass results). `vault-context.fill` returns `origin` on
  success — update the pinned `deepEqual` assertions (the intentional contract change for this leg) at
  **all three sites across BOTH test files**: `vault-context.test.js:230` and
  `vault-matchmode-fill.test.js:86` & `:87` (the latter two — added by Leg 4 — drive a real matching
  origin, so their returns gain `origin`). (`vault-fill-fields.test.js`/`vault-human.test.js`
  `{filled:true}` assertions are `fillLoginForm`/`fillHuman`, different functions — NOT affected.)
  Integration
  (`automation-mcp-server.test.js`): a driven `vaultFill` records a detail containing `origin=` and a
  `vaultUnlock` records `unlocked=N`, and neither audit record contains the secret.

## Acceptance Criteria

- [x] `vaultFill` audit detail records the **resolved origin** on a successful fill
      (`item=<id> origin=<origin>`); a no-fill keeps `item=<id>`.
- [x] `vaultUnlock` audit detail records `unlocked=<N>` (the count) from the result; it never reads or
      records the `accessKey`/admin key.
- [x] `deriveAuditDetail` NEVER emits a secret (accessKey, admin private key, password, recovery code)
      for any vault op, for any result — the extended invariant test passes.
- [x] The result param is optional and back-compatible: every existing 2-arg call keeps its prior
      behavior (`vaultUnlock` 2-arg → null; all non-vault ops identical); result parsing never throws.
- [x] `vault-context.fill` success return carries `origin`; the not-filled shapes are unchanged; the
      credential/password is still NEVER returned.
- [x] Existing tests pass (the fill-return assertion + the vault-op audit tests updated for the
      intentional contract change); `npm test`, `npm run typecheck`, lint clean.

## Verification Steps

- Unit: `deriveAuditDetail` (fill origin appended / unlock count / secret invariant / 2-arg back-compat /
  malformed-result → no throw); `vault-context.fill` returns `origin` on success only.
- Integration: a driven `vaultFill` + `vaultUnlock` produce audit records with `origin=`/`unlocked=N`
  and no secret substring.
- `npm test` full — no regressions. typecheck + lint clean.
- Grep: no `accessKey`/`adminKey`/password/code path feeds `deriveAuditDetail`'s detail string.

## Implementation Guidance

1. **Widen `fill`** — add `origin: tabOrigin` to the success return only (`vault-context.js:337`).
2. **`deriveAuditDetail(op, args, result)`** — add the optional param + the `parseResultJson` try/catch
   helper; enrich the `vaultFill` and `vaultUnlock` cases per Outputs; leave all others byte-identical.
3. **Call site** — thread `result` at `mcp-server.js:469`.
4. **Tool description** — note the `origin` in the `vaultFill` result-shape sentence.
5. **Tests** — extend the existing `deriveAuditDetail` suites (do not rewrite unrelated cases); add the
   result-aware cases + the extended secret invariant; update the two fill-return assertions.

## Edge Cases

- **Malformed / absent / non-JSON result** — `parseResultJson` → null → the op falls back to its
  args-only (or null) detail; never throws inside the audit path.
- **`vaultFill` no-fill** (locked / no-match / origin-mismatch) — result has `filled:false`; detail stays
  `item=<id>` (no origin). Outcome is still `ok` (a normal result), unchanged.
- **`vaultUnlock` opened nothing** (wrong/foreign key) — `unlocked:[]` → `unlocked=0` (a truthful audit
  of a failed-to-open attempt); the accessKey is never touched.
- **Origin is non-secret** but a password/credential is — confirm only the origin string (never the
  credential, which `fill` already withholds from its return) reaches the result/detail.
- **Back-compat** — 2-arg `deriveAuditDetail` calls (existing tests, any other caller) behave exactly as
  before; grep for other callers first.

## Files Affected

- `src/main/vault/vault-context.js` — the `fill` success return `origin`.
- `src/main/automation/mcp-server.js` — `deriveAuditDetail` 3rd param + the two enriched cases + the call site.
- `src/main/automation/mcp-tools.js` — the `vaultFill` description result-shape note.
- `test/unit/vault-context.test.js` (result-aware + invariant + fill-return `:230`), `test/unit/vault-matchmode-fill.test.js` (fill-return `:86`,`:87`), `test/unit/automation-mcp-server.test.js` (result-aware + integration).

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
