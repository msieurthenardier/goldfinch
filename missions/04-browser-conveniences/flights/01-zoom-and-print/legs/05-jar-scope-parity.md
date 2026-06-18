# Leg: jar-scope-parity

**Status**: completed
**Flight**: [Core Conveniences — Zoom & Print](../flight.md)

## Objective

Close the SC8 parity gap surfaced by live verification: add `getZoom`/`setZoom`/`printToPDF` to the jar-scope façade (`scope.js` `WCID_FIRST_OPS`) so a **jar key** can drive them on its **own** tabs (jar-membership-checked), instead of throwing `engine.getZoom is not a function`.

## Context

- **Defect (flight-log Anomaly)**: legs 2–3 wired the three ops into the full engine (`engine.js`) and the MCP tool list (`mcp-tools.js`), but not into the jar-scope façade. `scope.js`'s `scopeEngine` builds a per-op wrapper **only** for ops in `WCID_FIRST_OPS` (plus the special-cased `enumerateTabs`/`captureWindow`/`openTab`/`getChromeTarget`); ops not in that set are simply absent from the jar façade, so a jar-key call hits `undefined` → TypeError. Live run confirmed: under a jar key, `getZoom`/`setZoom`/`printToPDF` all throw `engine.<op> is not a function`; under admin they work (admin bypasses scoping — `scope.js:64`).
- **Why these belong in `WCID_FIRST_OPS`**: all three are **wcId-first** ops (first arg = `wcId`), exactly like `navigate`/`evaluate`/`openDevTools`. The generic wrapper (`scope.js:109-115`) runs `resolveContentsForJar(wcId, jar, memberDeps())` FIRST — which throws on out-of-jar / bad / dead / **internal** — then delegates to the engine op. So adding them yields: jar key + own-jar guest → works (jar-scoped, SC8 parity); jar key + out-of-jar/internal/chrome → clean refusal (which is what `print-to-pdf` step 3 expects). DevTools set the precedent (`scope.js:43-46`: "on a jar's own guest is within the jar key's authority — NOT admin-only"); zoom/print are no more sensitive.
- The op-local internal guard in `zoom.js`/`print.js` still protects the **admin** path (admin runs `allowInternal:true`); the jar path is protected by `resolveContentsForJar`'s internal-exclusion. Both axes now covered.
- Leg 4's docs already list the three ops as jar-scoped — this leg makes the **code match the docs** (the docs currently over-claim).

## Inputs
- `src/main/automation/scope.js:37-47` — `const WCID_FIRST_OPS = [ … 'openDevTools', 'closeDevTools' ]` (the set the jar façade wraps). `scope.js:64` — admin returns the engine unchanged. `scope.js:109-115` — the generic wcId-first wrapper (`resolveContentsForJar` then `engine[op](wcId, ...rest)`). `resolveContentsForJar` (from `./resolve`) throws out-of-jar / bad / dead / internal / chrome.
- `test/unit/automation-scope.test.js` — `makeEngine` builds a fake engine by looping `WCID_FIRST_OPS` (`~:59`), so new ops get auto-stubbed; the generic test `every wcId-first op is membership-gated` (`~:166-176`) loops `WCID_FIRST_OPS` and asserts each throws out-of-jar for an out-of-jar wcId; the positive "in-jar op reaches the engine" pattern is at `~:115-122`.
- Live finding: ops present in `listTools` (24 total) but jar façade missing them.

## Outputs
- `getZoom`/`setZoom`/`printToPDF` in `WCID_FIRST_OPS`.
- A positive jar-scope test proving a jar key reaches the three on an in-jar tab.

## Acceptance Criteria
- [ ] `getZoom`, `setZoom`, `printToPDF` are added to `WCID_FIRST_OPS` (`scope.js`), grouped with a short comment noting they are Flight-1 zoom/print ops, wcId-first, jar-membership-checked (internal exclusion enforced op-locally for admin + by `resolveContentsForJar` for jar keys).
- [ ] Under a jar key, calling `getZoom`/`setZoom`/`printToPDF` on an **in-jar** tab reaches the engine (no TypeError); on an **out-of-jar** tab throws `automation: out-of-jar`; on the **internal** tab throws `automation: internal-session` — the first two covered by the existing generic membership test (now iterating the three), plus a new **positive** in-jar test for the three (mirroring `~:115-122`; `await` the async `printToPDF`, pass a real `factor` to `setZoom`).
- [ ] Admin behavior unchanged (admin still bypasses scoping; the op-local internal guard in `zoom.js`/`print.js` still fires for admin).
- [ ] `npm test`, `npm run lint`, `npm run typecheck` all green. (No doc change — leg 4 already lists these as jar-scoped; verify that claim is now accurate.)

## Verification Steps
- `npm test` — all green; the generic `every wcId-first op is membership-gated` test now exercises the three; the new positive test passes.
- Re-confirm live (Flight Director, after landing): under the **jar key**, `getZoom`/`setZoom`/`printToPDF` on the jar's own tab succeed; on an out-of-jar wcId give `out-of-jar`.
- `npm run lint` / `npm run typecheck` — clean.

## Implementation Guidance
1. **`src/main/automation/scope.js`** — append to `WCID_FIRST_OPS`:
   ```js
     // Zoom & print (Flight 1): wcId-first, jar-membership-checked. A jar key may
     // zoom/print its OWN guests; resolveContentsForJar refuses out-of-jar/internal/chrome.
     // The op-local internal guard in zoom.js/print.js additionally covers the admin path.
     'getZoom', 'setZoom', 'printToPDF',
   ```
2. **`test/unit/automation-scope.test.js`** — add a positive test mirroring the in-jar "reaches the engine" case (`~:115`): build a jar-scoped engine, call `getZoom(inJarWcId)` / `setZoom(inJarWcId, 1.5)` / `await printToPDF(inJarWcId)`, assert the fake engine recorded the call (not thrown). The generic membership test needs no edit — it auto-iterates the expanded `WCID_FIRST_OPS`. Confirm `makeEngine` auto-stubs the three (it loops `WCID_FIRST_OPS`); if any stub needs an async return for `printToPDF`, follow the file's existing stub convention.

## Edge Cases
- **`printToPDF` is async**: the generic wrapper returns `engine[op](...)` (the promise) untouched — fine; the positive test must `await` it.
- **`setZoom` needs `factor`**: the generic membership test calls `scoped[op](2)` (out-of-jar) which throws at `resolveContentsForJar` BEFORE the engine op, so the missing `factor` is irrelevant there; the positive test passes a real factor.
- **No widening of reach**: these ops were already admin-callable; this leg only restores the *intended* jar-scoped path. No new capability beyond SC8's requirement.

## Files Affected
- `src/main/automation/scope.js` — +3 entries in `WCID_FIRST_OPS`.
- `test/unit/automation-scope.test.js` — positive in-jar test for the three.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`, lint, typecheck)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] (Do NOT commit — flight-end review + single commit follows)
