# Leg: presskey-schema-hygiene

**Status**: completed
**Flight**: [Polish & MCP Hygiene](../flight.md)

## Objective

Fix #56 (SC9): flatten the `pressKey` ToolDef's `inputSchema` by removing its top-level `anyOf`
combinator (the construct strict MCP consumers reject), enforce the dropped "at least one of `name`/`key`"
contract with a distinct runtime guard in the tool `call`, and add a **standing schema-hygiene unit test**
that asserts no tool's `inputSchema` carries a top-level `anyOf`/`oneOf`/`allOf`/`not` — making SC9 durable
against any future tool.

## Context

- **DD2** (flight.md) — flatten the schema, validate name-or-key in the handler with a clean thrown error,
  keep the human-readable requirement in the `description`, add the schema-hygiene test plus a `pressKey`
  both-missing error-path test. Top-level combinators are the strict-MCP-rejected construct; runtime
  validation preserves the contract without the offending schema shape.
- **Open Question (resolved here): #56 runtime-validation error shape.** Flattening drops the schema-level
  "at least one of name/key". The error string is `automation: pressKey requires 'name' or 'key'`, thrown
  from the tool `call` when **both** are absent, surfaced as an MCP **tool error** (`isError: true`) — not
  a crash. See Acceptance Criteria for the dispatch-path proof.
- **Recon (flight-log Reconnaissance Report, rows #56 + "Peer tools with top-level schema combinator",
  2026-06-20):** peer audit is **clean** — `pressKey` is the ONLY tool with a top-level combinator.
  Re-verified this leg design (`grep -nE 'anyOf|oneOf|allOf|"not"' src/main/automation/mcp-tools.js` →
  only `mcp-tools.js:332` (a comment) and `:335` (the construct) match). The hygiene test therefore passes
  immediately after the flatten — no other tool needs fixing.
- **Result/error semantics** are already established (DD6, documented at `mcp-tools.js:21-37`): a thrown
  engine/handler error → tool error (`isError: true`); operational conditions → normal result. The
  `pressKey` `call` already does `args.name ?? args.key` (`mcp-tools.js:338`); the new guard runs before
  that fallback can pass `undefined` downstream.
- **Why a distinct guard (not the existing engine throw):** when `name`/`key` are both absent,
  `args.name ?? args.key` is `undefined`; `engine.pressKey(wcId, undefined, …)` calls
  `keyEvents(undefined)` (`input.js:83`,`:297`), which matches no key and throws
  `automation: unknown key undefined (known: …)` (`input.js:95`-`:98`) — a confusing "unknown key
  undefined" message for what is really a missing-argument programmer error. The leg-added guard turns that
  into a clean, distinct `automation: pressKey requires 'name' or 'key'`.
- **Standing pattern**: the in-project example leg (`../../05-downloads-surface/legs/04-downloads-mcp-tool.md`)
  for the ToolDef + unit-test conventions; the existing hygiene-style test already lives at
  `automation-mcp-tools.test.js:157`-`:173` (currently *sanctions* the `pressKey` anyOf — this leg inverts
  and generalizes it).

## Inputs

What exists before this leg runs:
- `src/main/automation/mcp-tools.js:314`-`:339` — the `pressKey` ToolDef. Top-level
  `required: ['wcId']` (`:334`) **and** `anyOf: [{ required: ['name'] }, { required: ['key'] }]` (`:335`,
  with explanatory comment `:331`-`:333`). `call` at `:338`:
  `(engine, args) => engine.pressKey(args.wcId, args.name ?? args.key, args.modifiers)`.
- `src/main/automation/mcp-tools.js:530`-`:566` — `buildToolRegistry(getEngine)`; `listTools()` (`:537`)
  returns `{ name, description, inputSchema }` for **all** tools; `callTool` (`:548`) wraps `def.call` in a
  try/catch (`:553`-`:562`) that maps any throw to `errResult(err)` (`:560`-`:561`, an `isError: true`
  result via `errResult` at `:76`-`:78`).
- `src/main/automation/mcp-server.js:354`-`:378` — the `CallToolRequestSchema` handler: `:357`
  `const result = await registry.callTool(name, args)`; `:361` `const isError = result.isError === true`;
  `:377` `return result`. **This is the proof that a thrown `call` error becomes an MCP tool error, not a
  crash** (the throw is caught in `callTool`'s try/catch at `mcp-tools.js:553`-`:562`, returned as a result
  object, then returned verbatim to the SDK here).
- `src/main/automation/engine.js:81` — `pressKey: (wcId, name, modifiers) => input.pressKey(...)`;
  `src/main/automation/input.js:83`-`:98` (`keyEvents`, throws `automation: unknown key <name>` on no
  match), `:297` (`pressKey = (...) => actOn(wcId, keyEvents(name, modifiers), deps)`). Engine signature
  and behavior are **unchanged** by this leg.
- `test/unit/automation-mcp-tools.test.js` — the SDK-free registry tests (938-test suite). Relevant
  existing assertions that **pin the current `anyOf`** and MUST be inverted (state-machine reachability):
  - **`:128`-`:132`** — inside `test('input schemas carry the correct required fields …')`:
    `:132` `assert.deepEqual(pressKeySchema.anyOf, [{ required: ['name'] }, { required: ['key'] }]);`
    (comment `:128`-`:129` calls the anyOf the carrier of the name/key contract).
  - **`:152`-`:173`** — `test('getZoom/setZoom schemas are flat — no top-level oneOf/allOf/anyOf')`:
    header comment `:153`-`:154` says "pressKey stays the ONLY sanctioned anyOf"; `:167`-`:169` assert
    `withAnyOf` (tools whose `inputSchema.anyOf !== undefined`) deepEquals `['pressKey']`.
  - **`:425`-`:432`** — `test('pressKey unknown-key throw → isError')` — unaffected (engine throw, still
    valid), included here only to note the both-missing test sits beside it.
  - Fake-engine note: `makeFakeEngine` (`:44`-`:59`) covers `ALL_NAMES` (drive + observe + eval +
    devtools) but NOT `getChromeTarget`/`downloadsList` — fine, because the hygiene test reads only
    `listTools()` metadata (`inputSchema`), which does not call the engine.

## Outputs

What exists after this leg completes:
- `src/main/automation/mcp-tools.js` — `pressKey` ToolDef: top-level `anyOf` removed (keep
  `required: ['wcId']`); `description` keeps the human-readable "exactly one of name/key" requirement;
  `call` gains a both-missing runtime guard throwing the distinct error.
- `test/unit/automation-mcp-tools.test.js` —
  - the two existing anyOf-pinning assertions inverted (`:132`; `:167`-`:169`) and their comments updated;
  - a **standing schema-hygiene test** asserting **no** tool's `inputSchema` carries a top-level
    `anyOf`/`oneOf`/`allOf`/`not` (count-agnostic; iterates `listTools()`);
  - a **`pressKey` both-missing → distinct-error** dispatch test.

## Acceptance Criteria

- [x] **Schema flattened**: the `pressKey` ToolDef's `inputSchema` no longer has a top-level `anyOf`
  (`mcp-tools.js:335` removed); it retains `required: ['wcId']` and the `name`/`key`/`modifiers`
  properties unchanged. No top-level `oneOf`/`allOf`/`not` is introduced.
- [x] **Description preserves the contract**: the `pressKey` `description` still states that exactly one of
  `name`/`key` is required (the existing text at `:316` "exactly one is required, alongside wcId" already
  satisfies this — keep it; the `description`-pins at test `:144`-`:149` still pass).
- [x] **Runtime guard, distinct error**: when `pressKey` is called with **both** `name` and `key` absent
  (`args.name == null && args.key == null`), the `call` throws `Error('automation: pressKey requires
  'name' or 'key'')` **before** invoking the engine (the engine is not called; no `undefined` reaches
  `keyEvents`). The error string is distinct from the engine's `automation: unknown key …`.
- [x] **Surfaces as a tool error, not a crash**: `callTool('pressKey', { wcId: 1 })` returns
  `{ isError: true, content: [{ type: 'text', text: "automation: pressKey requires 'name' or 'key'" }] }`.
  Proof of the dispatch path: the throw is caught by `callTool`'s try/catch (`mcp-tools.js:553`-`:562`) →
  `errResult` (`:76`-`:78`); `mcp-server.js`'s `CallToolRequestSchema` handler returns that result
  verbatim (`:357` call, `:361` reads `isError`, `:377` `return result`) — never re-thrown, never a crash.
- [x] **Standing schema-hygiene test**: a unit test iterates `buildToolRegistry(() => fake).listTools()`
  and asserts, for **every** tool, that `inputSchema.anyOf`, `.oneOf`, `.allOf`, and `.not` are all
  `undefined`. It is **count-agnostic** (iterates whatever `listTools()` returns; no hardcoded tool count).
- [x] **Existing anyOf-pinning assertions inverted**: `automation-mcp-tools.test.js:132` now asserts
  `pressKeySchema.anyOf === undefined`; the flat-schema test (`:167`-`:169`) now asserts no tool carries a
  top-level `anyOf` (`withAnyOf` deepEquals `[]`); the "ONLY sanctioned anyOf" comments (`:128`-`:129`,
  `:153`-`:154`, `:167`) are updated to reflect zero sanctioned combinators.
- [x] **`pressKey` both-missing dispatch test**: a test asserts `callTool('pressKey', { wcId: 1 })` →
  `isError: true` with text `automation: pressKey requires 'name' or 'key'`, and that the fake engine's
  `pressKey` was **not** called (guard short-circuits before the engine).
- [x] **Suite green**: `npm test` (`node --test test/unit/*.test.js`) passes (currently 938 tests; this
  leg net-adds tests and inverts two assertions — no test should remain red), `npm run typecheck` clean,
  `npm run lint` clean.

## Verification Steps

- `node --test test/unit/automation-mcp-tools.test.js` — the inverted required-fields + flat-schema
  assertions pass; the new hygiene test passes; the both-missing dispatch test passes.
- Inspect `mcp-tools.js:314`-`:339`: `inputSchema` has no `anyOf` key; `call` guards both-missing.
- `grep -nE 'anyOf|oneOf|allOf|"not"' src/main/automation/mcp-tools.js` — returns **no matches** (the
  comment at the old `:331`-`:333` is removed with the construct; if any explanatory comment remains it
  must not contain those literal words, to keep the grep clean as a quick operator check).
- `npm test && npm run typecheck && npm run lint` — all clean.
- (Live, owned by the verify leg's behavior pass, not this leg) a strict MCP consumer accepts the
  `pressKey` tool schema; `pressKey` with no key → tool error, not a crash.

## Implementation Guidance

1. **Flatten the schema (`mcp-tools.js`, the `pressKey` ToolDef ~`:314`-`:339`).**
   - Delete the top-level `anyOf: [{ required: ['name'] }, { required: ['key'] }]` line (`:335`) and its
     explanatory comment (`:331`-`:333`). Keep `required: ['wcId']` (`:334`).
   - Leave `properties` (`name`, `key`, `modifiers`) and the `description` (`:315`-`:318`) unchanged —
     the description already carries "exactly one is required, alongside wcId" (`:316`), which is the
     human-readable contract DD2 wants retained.

2. **Add the runtime guard in `call` (~`:337`-`:338`).** Replace the one-line `call` with a guard +
   the existing fallback:
   ```js
   call: (engine, args) => {
     // Flattened schema (was a top-level anyOf, #56/SC9): enforce "at least one of
     // name/key" here. Throw a clean, DISTINCT error rather than passing undefined to
     // the engine (which would throw the confusing "unknown key undefined"). The throw
     // is caught by callTool's try/catch → isError tool result (NOT a crash).
     if (args.name == null && args.key == null) {
       throw new Error("automation: pressKey requires 'name' or 'key'");
     }
     return engine.pressKey(args.wcId, args.name ?? args.key, args.modifiers);
   },
   ```
   - Use `== null` (covers both `undefined` and `null`); preserves the existing `name ?? key` precedence
     (an explicit `name` still wins). Keep the error string EXACTLY as the AC specifies (it is not parsed
     by `ERROR_CODE_RE` at `mcp-server.js:62` — that regex needs ` — ` after the code; this message has no
     ` — `, so it audit-logs as the fallback `errorCode: 'error'`, which is correct for a generic
     bad-arguments error and consistent with the existing engine throws).

3. **Invert the two existing anyOf-pinning assertions (`automation-mcp-tools.test.js`).**
   - `:128`-`:132` (in `test('input schemas carry the correct required fields …')`): change the comment to
     note the key arrives as `name`/`key` enforced at RUNTIME (no schema combinator), and replace
     `assert.deepEqual(pressKeySchema.anyOf, [...])` with
     `assert.equal(pressKeySchema.anyOf, undefined, 'pressKey must not declare a top-level anyOf (#56/SC9)');`
     Keep `assert.deepEqual(req('pressKey'), ['wcId']);` (`:131`) and all the `properties`/`description`
     assertions (`:133`-`:149`) as-is.
   - `:152`-`:173` (`test('getZoom/setZoom schemas are flat …')`): update the section/header comment
     (`:153`-`:154`, `:167`) to drop "pressKey stays the ONLY sanctioned anyOf". Change `:168`-`:169`
     from `withAnyOf … deepEqual(['pressKey'])` to assert `[]` (no tool carries a top-level anyOf). The
     oneOf/allOf assertions (`:170`-`:172`) already expect `[]` — leave them.

4. **Add the standing schema-hygiene test (`automation-mcp-tools.test.js`).** Place it near the flat-schema
   test (after ~`:173`). Iterate the full registry, count-agnostic, covering all four combinators:
   ```js
   test('no tool inputSchema carries a top-level anyOf/oneOf/allOf/not (SC9 hygiene — count-agnostic)', () => {
     const reg = buildToolRegistry(() => makeFakeEngine().engine);
     const offenders = [];
     for (const t of reg.listTools()) {
       for (const combinator of ['anyOf', 'oneOf', 'allOf', 'not']) {
         if (t.inputSchema[combinator] !== undefined) {
           offenders.push(t.name + '.' + combinator);
         }
       }
     }
     assert.deepEqual(offenders, [], 'strict MCP consumers reject top-level schema combinators (#56/SC9)');
   });
   ```
   `listTools()` returns every tool's `inputSchema` (`mcp-tools.js:537`-`:539`); the test reads metadata
   only, so the fake engine never has to implement `getChromeTarget`/`downloadsList`.

5. **Add the `pressKey` both-missing dispatch test (`automation-mcp-tools.test.js`).** Place it beside the
   existing pressKey dispatch/throw tests (near `:285`-`:310` or `:425`):
   ```js
   test('pressKey with neither name nor key → distinct isError, engine not called (#56/SC9)', async () => {
     const { engine, calls } = makeFakeEngine();
     const reg = buildToolRegistry(() => engine);
     const result = await reg.callTool('pressKey', { wcId: 1 });
     assert.equal(result.isError, true);
     assert.equal(textOf(result), "automation: pressKey requires 'name' or 'key'");
     assert.equal(calls.pressKey.length, 0); // guard short-circuits before the engine
   });
   ```
   (`textOf` is the existing helper at `:62`-`:66`; `makeFakeEngine().calls` records per-op invocations.)

6. **Run the gates**: `npm test`, `npm run typecheck`, `npm run lint`. Confirm
   `grep -nE 'anyOf|oneOf|allOf|"not"' src/main/automation/mcp-tools.js` returns nothing.

## Edge Cases

- **`name: ''` (empty string):** `'' == null` is `false`, so the guard passes and `args.name ?? args.key`
  yields `''`; the engine's `keyEvents('')` throws `automation: unknown key ` (existing behavior,
  unchanged). The guard targets *absent* keys, not invalid ones — invalid-key handling stays in the engine.
  Do not over-broaden the guard to reject empty strings (that would change existing engine-owned semantics
  and is out of scope for #56).
- **`name` present, `key` absent (or vice-versa):** guard passes; `name ?? key` selects the present one —
  existing tests at `:285`-`:303` still pass.
- **Both present:** guard passes; `name ?? key` prefers `name` — existing test `:299`-`:303` still passes.
- **`modifiers` only, no name/key:** treated as both-missing → distinct guard error (a chord needs a key).
- **Audit logging:** `deriveAuditDetail('pressKey', { wcId: 1 })` returns `null` (no `name`/`key`,
  `mcp-server.js:106`-`:114`) — correct; the call audit-logs `outcome: 'error'`, `errorCode: 'error'`
  (the message has no ` — ` for `ERROR_CODE_RE` to capture). No audit change needed in this leg.

## Files Affected

- `src/main/automation/mcp-tools.js` — `pressKey` ToolDef: remove top-level `anyOf` (`:335`) + its comment
  (`:331`-`:333`); add the both-missing runtime guard in `call` (`:337`-`:338`).
- `test/unit/automation-mcp-tools.test.js` — invert the two anyOf-pinning assertions (`:132`; `:167`-`:169`)
  + comments; add the standing schema-hygiene test; add the `pressKey` both-missing dispatch test.

## Observations / Flags (not this leg's to fix)

- **Tool-count comment drift**: `automation-mcp-tools.test.js:8` says "14 drive tool names" but
  `DRIVE_NAMES` (`:22`-`:27`) has **17** entries. Separate from the 26→27 tool-count reconcile. Both are
  owned by **leg 6** (`verify-and-behavior-tests`), not this leg — flagged only.
- The `buildServer` JSDoc at `mcp-server.js:328` says "24 tools" and `:329` "the 24 tools" — also stale
  (live count is 27). Same ownership (leg 6). This leg does not touch `mcp-server.js`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`, `npm run typecheck`, `npm run lint`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — not the final leg)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

All citations verified clean against current code at leg design time (read directly this session):
`mcp-tools.js:314`-`:339` (`pressKey` ToolDef: `:315`-`:318` description, `:334` `required:['wcId']`,
`:335` the `anyOf` construct, `:331`-`:333` its comment, `:338` `call` with `name ?? key`); `:76`-`:78`
(`errResult`); `:530`-`:566` (`buildToolRegistry`/`listTools` `:537`-`:539`/`callTool` try-catch
`:553`-`:562`). `mcp-server.js:354`-`:378` (CallToolRequestSchema handler: `:357` callTool, `:361` isError,
`:377` return result) and `:62` (`ERROR_CODE_RE`). `engine.js:81` (`pressKey` op); `input.js:83`-`:98`
(`keyEvents` unknown-key throw), `:297` (`pressKey`). Test ref sites: `automation-mcp-tools.test.js:8`
(stale "14 drive" comment), `:22`-`:27` (`DRIVE_NAMES`, 17 entries), `:44`-`:59` (`makeFakeEngine`),
`:62`-`:66` (`textOf`), `:128`-`:132` (anyOf-pin in required-fields test), `:152`-`:173` (flat-schema test;
`:167`-`:169` `withAnyOf` pin), `:285`-`:310` / `:425`-`:432` (pressKey dispatch/throw tests). Peer-audit
grep re-run: only `mcp-tools.js:332`/`:335` match — clean, matching the flight-log recon. Live suite
confirmed green: 938 tests / 938 pass via `npm test`. No drift; no `gone` citations.
