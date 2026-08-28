# Leg: secret-sheet-wall

**Status**: completed
**Flight**: [Automation-Surface Internal-Session Invariant](../flight.md)
**Slug**: `secret-sheet-wall`
**Risk tier**: high — the master-password secret sheet is the ONE surface that must never be reachable by automation (flight DD3); the fix threads security predicates through a shared vault path.

## Objective

Close finding F9: the vault automation tools (`vaultFill`, `vaultAnswerAuth`) resolve their target through `resolveTarget` (`src/main/vault/vault-context.js`), whose admin branch calls `resolveContents` **without** the `isSheetContents`/`sheetMenuFor`/`isTabViewWcId`/`isPopupWcId` predicates — so the `resolve.js:210` sheet gate is `typeof`-gated and no-ops, letting a vault tool name the master-password **secret sheet** (or find overlay) as a target, refused today only by a later origin match. Thread the predicate set into the vault path so a vault tool targeting the secret sheet is refused at resolve time, for **all** tiers including admin (flight DD3). This is the wall Leg 1's admin-reach pivot leaves standing, and it is the ONLY internal surface admin must not reach.

## Context

**Ground truth (read 2026-08-28).**

- `src/main/vault/vault-context.js:413` `resolveTarget(identity, wcId, engineDeps)`:
  - admin branch `:420` → `resolveContents(wcId, { fromId, allowInternal: true, chromeContents, ...chromeDep })` — **missing** the four predicates.
  - jar branch `:428` → `resolveContentsForJar(wcId, jar, { fromId, fromPartition, chromeContents, ...chromeDep })` — also predicate-free.
  - Called by `fill` (`:460` `const wc = resolveTarget(...)`) and `answerAuth` (`:515` `resolveTarget(...)`).
- `src/main/automation/resolve.js:210` — `if (typeof isSheetContents === 'function' && isSheetContents(wc)) throw 'automation: secret-sheet …'`. **`typeof`-gated**: absent predicate ⇒ the gate never fires. `:246-259` — the `isTabViewWcId`/`isPopupWcId` membership widening, likewise predicate-gated.
- The predicates exist in `main.js`'s **general engine** deps (`:1041` `isPopupWcId`, `:1045` `isTabViewWcId`, `:1056` `isSheetContents`, `:1057` `sheetMenuFor`) with a load-bearing comment (`:1050-1055`): *"sheetMenuFor is the menuType half and MUST be injected wherever isSheetContents is … Grep-pinned as a PAIR across both engine sites."*
- But the **vault** path's `scopeCtx` (`main.js:1075-1085`) supplies only `jars, fromId, fromPartition, getChromeContents, isChromeContents` — **not** the four predicates. That omission is F9's root: the vault tools' `resolveTarget` cannot pass what it was never given.
- The residual guard today is origin-matching inside `fill`/`answerAuth` after resolve (`vault-context.js` `originOf(wc.getURL())` compare) — which the secret sheet may or may not defeat; not a substitute for the resolve-time sheet gate.
- Existing tests to extend: `test/unit/vault-context.test.js` (fill/answerAuth via `resolveTarget`, membership at `:740`), `test/unit/automation-sheet-gate.test.js` (the sheet gate), `test/unit/automation-resolve.test.js:150-167` (sheet refused with `allowInternal:true` — the precedent this leg extends to the vault path). Grep-pin: the `isSheetContents`+`sheetMenuFor` PAIR injection (the M15 F3 pin the main.js comment names).

## Inputs

- `flight/02` after Leg 1 (`admin-internal-reach`) landed (uncommitted). Leg 1 touched `observe.js`/`mcp-tools.js`/`automation-observe.test.js` only — no overlap with this leg's files.

## Outputs

- `src/main/main.js` — add `isSheetContents`, `sheetMenuFor`, `isTabViewWcId`, `isPopupWcId` to the vault `scopeCtx` (`:1075`), reusing the same registry/popup accessors the engine deps use; `isSheetContents`+`sheetMenuFor` added as a PAIR (honor the grep pin).
- `src/main/vault/vault-context.js` — thread the four predicates from the vault deps into the `resolveContents` call in `resolveTarget`'s admin branch (and the `resolveContentsForJar` call in the jar branch), so the sheet/membership gates fire for vault tools.
- Tests: `vault-context.test.js` (and/or `automation-sheet-gate.test.js`) — `vaultFill`/`vaultAnswerAuth` naming the secret-sheet wcId is refused with `automation: secret-sheet` under BOTH admin and jar identities; a normal in-jar tab still fills (no regression). Extend the pair-injection grep pin to the vault site if one guards it.
- Flight-log leg entry; this leg `landed`.

## Acceptance Criteria

- [x] AC1: `vaultFill` with a wcId that is the master-password **secret sheet** is refused with `automation: secret-sheet` — under the **admin** identity — before any fill; unit-pinned.
- [x] AC2: same for `vaultAnswerAuth` (secret sheet → `automation: secret-sheet`, admin); and same for a **jar** identity for both tools (the sheet is refused at every tier, DD3).
- [x] AC3: a legitimate `vaultFill`/`vaultAnswerAuth` on a normal in-jar web tab still succeeds (no regression). **Note (design review, HIGH):** threading `isTabViewWcId`/`isPopupWcId` into the JAR branch newly activates the `!allowInternal`-gated non-tab-contents guard for jar identity, so the existing jar test helpers (`vault-context.test.js` `fillDeps()`/`makeWorld()`, `:92-124`, with no `isTabViewWcId` fake) will throw `automation: non-tab-contents` until updated with a fake (e.g. `isTabViewWcId: (id) => byWcId.has(id)`). Updating that fake so the legitimate-tab tests stay green IS part of this AC.
- [x] AC4: the vault `scopeCtx` supplies `isSheetContents` and `sheetMenuFor` as a PAIR (never one alone) plus `isTabViewWcId`/`isPopupWcId`. **A NEW source-pin is required** (design review): the existing pair-pin `sheet-automation-gate-invariant.test.js:234-249` only scans `createEngine(` call sites and does NOT reach the `scopeCtx:` literal, so injecting only one of the pair there would not trip it. Add a standalone source-pin (recommended: in `vault-context.test.js`) asserting the vault `scopeCtx` block carries the `isSheetContents`+`sheetMenuFor` pair; neuter-verify (drop `sheetMenuFor` -> red).
- [x] AC5: Leg 1's and every other suite stays green; gates — `npm test` (0 fail/skip/todo), `npm run lint`, `npm run typecheck`, `npx prettier --check .`.

## Verification Steps

- AC1/AC2: the new refusal tests (admin + jar × fill + answerAuth); neuter — remove `isSheetContents` from the vault `scopeCtx` → the admin refusal test goes red (proving it is the resolve-time gate, not the origin match, that refuses).
- AC3: the existing fill-succeeds test stays green.
- AC4: the pair-injection grep pin.
- AC5: the gates.

## Implementation Guidance

1. In `main.js`'s vault `scopeCtx` (`:1075`), add `isSheetContents: (wc) => registry.isSheetContents(wc)`, `sheetMenuFor: (wc) => registry.sheetMenuFor(wc)` (as a PAIR), `isTabViewWcId: (id) => registry.isTabViewWcId(id)`, `isPopupWcId: (id) => popupRegistry.isPopupWcId(id)` — copy the exact accessors the engine deps block uses (do not re-derive). Add a comment noting these mirror the engine site and are the F9 fix.
2. **Plumbing (confirmed by design review — one hop, no remapping):** the `scopeCtx` literal at `main.js:1075` is passed to `createMcpServer`, captured in `mcp-server.js` (`const scopeCtx = opts.scopeCtx`), and handed verbatim as the 3rd arg to `vaultCtx.fill(identity, target, scopeCtx || {})` / `.answerAuth(...)` (`mcp-server.js:~550/553`), landing as `engineDeps` in `fill`/`answerAuth` and forwarded to `resolveTarget(identity, wcId, engineDeps)`. So step 1 (adding the predicates to `scopeCtx`) is sufficient to get them onto `engineDeps`. In `vault-context.js` `resolveTarget` (`:413-433`) — which today reads only `fromId`/`getChromeContents`/`isChromeContents` off `engineDeps` — ALSO read `engineDeps.isSheetContents`, `.sheetMenuFor`, `.isTabViewWcId`, `.isPopupWcId` and splice them into BOTH the admin `resolveContents(wcId, { fromId, allowInternal: true, chromeContents, ...chromeDep, isSheetContents, sheetMenuFor, isTabViewWcId, isPopupWcId })` and the jar `resolveContentsForJar(wcId, jar, { ..., isSheetContents, sheetMenuFor, isTabViewWcId, isPopupWcId })`. (For admin the sheet gate is `allowInternal`-exempt, so `isSheetContents`/`sheetMenuFor` are what refuse the sheet; the tab/popup predicates are `!allowInternal`-gated and only bite the jar branch — see the AC3 regression note.) Update the `FillEngineDeps` JSDoc typedef (`vault-context.js:~85-91`) to declare the four new optional predicates.
3. Tests in `vault-context.test.js` (correct home — full fill/answerAuth harness; but it has NO fake-sheet harness today, so PORT the pattern from `automation-sheet-gate.test.js`/`automation-resolve.test.js`, do not assume reuse): add a sheet-tagged fake wc + an `isSheetContents`/`sheetMenuFor` closure to `fillDeps()`/`makeWorld()`; add an `isTabViewWcId` fake (`(id) => byWcId.has(id)`) so the newly-activated jar guard does not break the legitimate-tab tests (AC3). Assert `vaultFill`/`vaultAnswerAuth` on the sheet wcId -> `automation: secret-sheet` under BOTH admin and jar; assert a normal in-jar tab still fills. Neuter-verify AC1 (drop `isSheetContents` from the vault `scopeCtx` -> the admin refusal test goes red, proving the resolve-time gate, not the origin match, refuses).
4. Add the NEW source-pin (AC4): the existing `sheet-automation-gate-invariant.test.js:234-249` pin is keyed to `createEngine(` and does not reach the `scopeCtx` literal — add a standalone assertion (recommended: `vault-context.test.js`) that the vault `scopeCtx` block in `main.js` carries the `isSheetContents`+`sheetMenuFor` pair; neuter-verify (delete `sheetMenuFor` from the scopeCtx -> red).
5. Gates.

## Edge Cases

- **Find overlay** (`isTabViewWcId`/`isPopupWcId` membership): threading these too means a vault tool naming the find-overlay wc is also refused — desired (the finding names it alongside the sheet).
- **Jar branch**: a jar key targeting a sheet is already unlikely to pass membership, but thread the predicates there too for consistency and defense-in-depth (AC2 covers it).
- **No secret exposure regardless**: master-equivalent secrets never enter the page DOM and ride a dual-zeroized Buffer channel — this leg hardens the *entry surface*, it is not the sole secrecy guarantee.
- **Origin-match residual stays**: keep the existing post-resolve origin compare; this leg adds the resolve-time gate in front of it, not instead of it.

## Files Affected

`src/main/main.js` (vault `scopeCtx`), `src/main/vault/vault-context.js` (`resolveTarget`), `test/unit/vault-context.test.js` and/or `test/unit/automation-sheet-gate.test.js`. (Not `resolve.js` — its gate is correct and merely un-fed; not `observe.js`.)

## Citation Audit

2026-08-28, against `flight/02` post-Leg-1: `vault-context.js:413/420/428/460/515`; `resolve.js:210/246-259`; `main.js:1041/1045/1056/1057` (engine predicates + the pair comment `:1050-1055`) and `:1075-1085` (vault scopeCtx, missing them); tests `vault-context.test.js:740`, `automation-resolve.test.js:150-167`. All read at design time; the design review to confirm the exact `engineDeps`→`resolveTarget` plumbing for step 2.
