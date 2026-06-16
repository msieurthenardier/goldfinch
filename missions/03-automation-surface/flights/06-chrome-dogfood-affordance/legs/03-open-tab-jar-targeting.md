# Leg: open-tab-jar-targeting

**Status**: completed
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

## Objective
Add an optional `jarId` parameter to the `openTab` automation tool so a new tab opens in a specific jar — a jar key confined to its own jar, admin to any jar — refusing an unknown jarId rather than silently landing the tab in the default container.

## Context
- **DD3** (flight): today `openTab` takes only `{ url }` and the renderer's `createTab(url)` defaults to `DEFAULT_CONTAINER` — so a jar key's new tab can land **outside its jar**, silently absent from `enumerateTabs` (the F4→F5→F6 carried gap). This leg threads a `jarId` through all four layers and enforces jar-scoping.
- **The silent-wrong-jar bug this fixes**: an unknown/foreign jarId must be **refused**, never silently fall back to `DEFAULT_CONTAINER`.
- Independent of the chrome-drive spike (leg 2) — pure code work, no live app needed; sequenced into the autonomous-first batch (flight-log FD Notes).

## Inputs (the four change sites + the call chain)
- `src/main/automation/mcp-tools.js:126-134` — the `openTab` tool def: `inputSchema` has only `url`; `call: (engine, { url }) => engine.openTab(url)`.
- `src/main/automation/engine.js:62` — `openTab: (url) => tabs.openTab(url, deps())`.
- `src/main/automation/tabs.js:81-86` — `openTab(url, { executeInRenderer })` → `executeInRenderer('window.__goldfinchAutomation.openTab(' + JSON.stringify(url) + ')')`.
- `src/renderer/renderer.js:2002-2014` — the renderer hook `__goldfinchAutomation.openTab(url)` → `createTab(url)` (untrusted branch → `isSafeTabUrl`). `createTab(url, container = null, …)` (renderer.js:467) resolves `container || DEFAULT_CONTAINER` (renderer.js:481). The jar registry is `containers` (renderer.js:217, an array of `{ id, name, color, partition }`).
- `src/main/automation/scope.js:137-144` — `facade.openTab = (url) => { requireJar(); return engine.openTab(url); }` with the stale "KNOWN LIMITATION (v1) … Acceptable for Flight 4" comment.
- `docs/mcp-automation.md` — the `openTab` tool reference row.

## Outputs
- `openTab` accepts an optional `jarId`; default (no jarId) preserves today's behavior exactly.
- A **jar key** may only open in its own jar — the scope façade forces the caller's jarId; a foreign/mismatched jarId is **refused**. **Admin** may target any jar.
- An **unknown jarId** (not in the renderer's `containers`) is **refused** (error result), never a silent `DEFAULT_CONTAINER` fallback.
- `docs/mcp-automation.md` documents `openTab.jarId`; the stale `scope.js` v1-limitation comment is corrected.
- Unit + engine tests cover the main-side threading + scope enforcement; renderer-side container-lookup/refusal is live-verified (leg 7).

## Acceptance Criteria
- [x] **AC1 (schema + threading)** — The `openTab` tool's `inputSchema` gains an optional `jarId` (string, described as the target container/jar id; omit to use the default). The value threads `mcp-tools.js → engine.openTab(url, jarId) → tabs.openTab(url, jarId, deps) → renderer __goldfinchAutomation.openTab(url, jarId)`. With **no** `jarId`, the renderer call string is byte-identical to today (`openTab("<url>")`, single arg) — verified by a `tabs.openTab` unit test on the generated code string.
- [x] **AC2 (jar-key confinement)** — Through the jar façade (`scopeEngine(engine, '<jarId>', ctx)`), `openTab(url)` (no jarId) opens in the **caller's own jar** (the façade passes the caller's `jar.id` to the engine); `openTab(url, '<own-jarId>')` is allowed; `openTab(url, '<other-jarId>')` is **refused** with a distinct error (engine NOT reached). Admin (engine unchanged) passes any `jarId` straight through. **Semantic tightening (note)**: a jar key's no-jarId `openTab` now lands **in its own jar** (or fails `unknown-jar` if `containers` lacks that jar mid-startup) — replacing the old silent `DEFAULT_CONTAINER` fallback. This is the intended fix, not a regression.
- [x] **AC3 (unknown-jarId refusal)** — When the renderer's `containers` lacks the requested `jarId`, the renderer hook **throws** (a `automation: unknown-jar — …` style error that propagates via `executeJavaScript` rejection → `isError` at the MCP boundary) — it does **NOT** call `createTab` with `DEFAULT_CONTAINER`. (Main-side: verified by the engine/tabs path; renderer-side behavior is asserted live in leg 7.)
- [x] **AC4 (default unchanged)** — `openTab(url)` with no jarId and no scoping (admin / default engine) behaves exactly as before: opens in `DEFAULT_CONTAINER`, returns the new wcId or null (URL-rejected). Existing `openTab` tests still pass unmodified (or are extended, not broken).
- [x] **AC5 (docs + comment)** — `docs/mcp-automation.md` documents `openTab.jarId` (semantics + jar-key-confinement + admin-any + unknown-jar refusal). The stale `scope.js:137-140` "KNOWN LIMITATION (v1) … Acceptable for Flight 4" comment is rewritten to describe the now-implemented jar-targeting.
- [x] **AC6** — `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Verification Steps
- AC1/AC4: `node --test test/unit/automation-mcp-tools.test.js` (openTab passes jarId) + a `tabs.openTab` test (in the engine/tabs test file) asserting the generated renderer call string for (url) vs (url, jarId).
- AC2: `node --test test/unit/automation-scope.test.js` — jar `openTab` forces own jar / refuses foreign jarId (engine not reached on refusal); admin passes through.
- AC3: covered main-side by the tabs/engine path; the renderer container-lookup + throw is exercised live in leg 7 `verify-integration` (note in the leg).
- AC5: `docs/mcp-automation.md` documents `openTab.jarId` AND its semantics — confirm the doc mentions the `out-of-jar` (foreign jarId) and `unknown-jar` (unknown jarId) refusals and admin-any-jar passthrough, not merely that the `jarId` string appears. `grep -n "Acceptable for Flight 4" src/main/automation/scope.js` returns nothing.
- AC6: `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance
1. **`mcp-tools.js` — `openTab` tool def.** Add `jarId` to `inputSchema.properties` (string; NOT required), and update the call seam: `call: (engine, { url, jarId }) => engine.openTab(url, jarId)`. Extend the description to note jar-targeting (jar keys confined to own jar; admin any; unknown jar refused).
2. **`engine.js` — `openTab` op.** `openTab: (url, jarId) => tabs.openTab(url, jarId, deps())`.
3. **`tabs.js` — `openTab(url, jarId, { executeInRenderer })`.** Build the renderer call so the jarId arg is appended **only when provided** (avoid the `JSON.stringify(undefined) → "undefined"` footgun):
   ```js
   async function openTab(url, jarId, { executeInRenderer }) {
     if (typeof url !== 'string') throw new Error('automation: bad-url — url must be a string');
     const jarArg = jarId == null ? '' : ', ' + JSON.stringify(jarId);
     return executeInRenderer('window.__goldfinchAutomation.openTab(' + JSON.stringify(url) + jarArg + ')');
   }
   ```
   (Keep the existing JSON.stringify(url) injection guard. `jarId == null` covers both undefined and null → today's single-arg call.)
4. **`renderer.js` — `__goldfinchAutomation.openTab(url, jarId)`.** Accept the optional `jarId`; when present, look it up in `containers` and **refuse** if absent (throw — propagates as `executeJavaScript` rejection); when absent, today's behavior:
   ```js
   openTab(url, jarId) {
     let container = null;
     if (jarId != null) {
       container = containers.find((c) => c.id === jarId) || null;
       // Unknown jarId → REFUSE (DD3): do NOT silently fall back to DEFAULT_CONTAINER.
       if (!container) throw new Error('automation: unknown-jar — no container ' + jarId);
     }
     const tab = createTab(url, container);   // null container → createTab uses DEFAULT_CONTAINER (today's behavior)
     if (!tab) return null;                    // URL rejected (unchanged)
     // …existing dom-ready race-guard Promise, unchanged…
   }
   ```
   Do not disturb the dom-ready race-guard logic below the createTab call.
5. **`scope.js` — jar façade `openTab` enforcement.** Replace the delegate-with-known-limitation:
   ```js
   // openTab → jar-targeted (DD3, Flight 6). A jar key may only open in ITS OWN jar:
   // a supplied jarId must match this identity (or be absent → defaulted to own jar);
   // a foreign jarId is refused. Admin (engine unchanged) may target any jar.
   facade.openTab = (url, jarId) => {
     const jar = requireJar();
     if (jarId != null && jarId !== jar.id) {
       throw new Error('automation: out-of-jar — a jar key may only open tabs in its own jar (' + jar.id + ')');
     }
     return engine.openTab(url, jar.id);   // force the caller's own jar
   };
   ```
   - Note: the façade **forces** `jar.id` (so even a no-jarId jar-key open now lands in-jar — tightening the old silent-fallback gap). Admin reaches `engine.openTab` unchanged (scopeEngine returns the engine as-is for admin), so admin's `jarId` passes straight to the renderer lookup.
   - Update `WCID_FIRST_OPS` handling: `openTab` is already special-cased outside that set — leave it special-cased, just replace the body.
6. **`docs/mcp-automation.md` — document `openTab.jarId`.** Update the `openTab` row/section: optional `jarId`; jar key confined to own jar (foreign jarId → `out-of-jar`); admin any jar; unknown jarId → refused (`unknown-jar`); omitted → default container.
7. **Tests.** The `openTab` call arity changes from 1 → 2 args, so **existing stubs and assertions must be updated, not just extended** (design-review [high]):
   - `automation-scope.test.js`: **update the existing test** at ~line 196-203 ("jar openTab is delegated … known v1 limitation"). The fake `engine.openTab` (~line 62) is 1-arity `(url) => calls.push(['openTab', url])` → make it `(url, jarId) => calls.push(['openTab', url, jarId])`, and update the assertion (~line 202) `[['openTab', 'https://new']]` → `[['openTab', 'https://new', 'personal']]` (the façade now forces the caller's `jar.id`). Rename the test to drop "known v1 limitation: no jar targeting". **Add** cases: jar `openTab(url, ownId)` allowed (engine gets own jar.id); jar `openTab(url, otherId)` throws `out-of-jar`, engine NOT reached; admin `openTab(url, anyId)` passes through unchanged.
   - `automation-mcp-tools.test.js`: the fake `openTab` stub (~line 62) and its assertion (~line 182) are 1-arity — update them so the `jarId` arg is recorded. **Add** a case asserting the call seam forwards `jarId` to `engine.openTab(url, jarId)`, and that with no jarId the engine receives `(url, undefined)` (documents the contract explicitly).
   - `automation-tabs.test.js` (the openTab unit tests live at ~lines 208-257): existing assertions (`code.includes('"…url…"')`, `…openTab(`) still pass unchanged (no-jarId → single-arg string). **Add**: with `jarId`, the generated string is exactly `window.__goldfinchAutomation.openTab(<JSON url>, <JSON jarId>)` — assert the precise format your `tabs.js` produces (the guidance uses `', '` comma-space; the test must match the implementation byte-for-byte); with no jarId, assert the string has **no** second arg (e.g. it ends `openTab(<JSON url>)`); `bad-url` (non-string) still throws.
   - Renderer-side container-lookup/refusal (`unknown-jar`): NOT unit-tested here (renderer.js has no offline harness — confirmed by review) — assert live in leg 7.
   - **Also**: `grep -rn "openTab" tests/behavior/*.md` for any spec that assumes the old "jar key tab lands in DEFAULT_CONTAINER" behavior; if one exists (e.g. `mcp-jar-scoping`), note it for leg 4/7 (the behavior is now tightened to in-jar-or-refused). Likely none — the old behavior was an unflagged limitation — but check.

## Edge Cases
- **`jarId == null` (undefined or null)**: no second arg in the generated call; default container; today's behavior. The `== null` (loose) check is deliberate — covers both.
- **Jar key supplies its own jarId explicitly**: allowed (matches `jar.id`); same as omitting.
- **Jar key supplies a foreign jarId**: refused `out-of-jar` at the façade — the engine/renderer never see it.
- **Admin supplies an unknown jarId**: passes the façade (admin engine unchanged) → refused at the renderer container-lookup (`unknown-jar`). Both refusal paths are exercised (façade for jar keys, renderer for admin).
- **Startup race (`containers` not yet populated with a valid jarId)**: the renderer refuses (`unknown-jar`) rather than mis-targeting — correct per DD3 (no silent `DEFAULT_CONTAINER`).
- **`createTab` returns null (URL rejected)**: unchanged — `openTab` returns null (a normal result), distinct from the unknown-jar throw (isError).

## Files Affected
- `src/main/automation/mcp-tools.js` — `openTab` inputSchema `jarId` + call seam + description.
- `src/main/automation/engine.js` — `openTab(url, jarId)` op signature.
- `src/main/automation/tabs.js` — `openTab(url, jarId, deps)` + conditional jarId injection.
- `src/renderer/renderer.js` — `__goldfinchAutomation.openTab(url, jarId)` container-lookup + unknown-jar refusal.
- `src/main/automation/scope.js` — jar-façade `openTab` own-jar enforcement + comment rewrite.
- `docs/mcp-automation.md` — `openTab.jarId` documentation.
- `test/unit/automation-mcp-tools.test.js`, `test/unit/automation-scope.test.js`, and the tabs/engine openTab unit test — new/extended cases.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (main-side; renderer-side noted for leg 7)
- [x] Tests passing (`npm test` + typecheck + lint)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg

## Citation Audit
7 source citations verified against current code at leg design time (2026-06-15): `mcp-tools.js:126-134` (openTab def), `engine.js:62` (openTab op), `tabs.js:81-86` (openTab + executeInRenderer injection), `renderer.js:2002-2014` (hook), `renderer.js:467/481` (createTab container default), `renderer.js:217` (`containers`), `scope.js:137-144` (façade openTab + stale comment) — all OK (content matches).
