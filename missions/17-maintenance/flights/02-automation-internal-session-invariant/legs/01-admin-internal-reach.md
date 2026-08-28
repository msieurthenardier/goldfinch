# Leg: admin-internal-reach

**Status**: completed
**Flight**: [Automation-Surface Internal-Session Invariant](../flight.md)
**Slug**: `admin-internal-reach`
**Risk tier**: high — reverses a documented, load-bearing security invariant ("internal-session exclusion EVEN FOR ADMIN", the codebase's own DD2) on a security-sensitive surface; inverts four `[HIGH]`-tagged unit pins.

> **Correction (2026-08-28, post-implementation).** This leg's Context/Objective as originally written justified the relaxation by "admin is a dev-only tier that cannot exist in a packaged build." **That is false** (see the flight DD2 correction): admin is env-gated, not build-gated, and can be enabled on a packaged build. The CODE change (relaxing the four op-local admin refusals) is unaffected and stands per the operator's keep-as-is re-decision; only the *justification* changed. The shipped-code comments this leg wrote that repeat the false "dev-only" claim are corrected by Leg 4.

## Objective

Make the internal-session boundary tier-based per the flight's DD1–DD3: let the **admin (dev-only)** automation tier reach internal `goldfinch://` guests on **every** op — including `evaluate`/`injectScript`/`openDevTools`/`closeDevTools`, which today refuse admin — by relaxing the four op-local `isInternalContents` refusals in `observe.js`. The non-admin wall (`resolve.js`'s `!allowInternal && isInternalContents` throw) is untouched; the separate menu-overlay **sheet** gate (`isSheetContents`, DD3) is untouched. Closes finding F1 in its pivoted (inverted) form.

## Context

**The pivot (flight DD1–DD3, operator ruling 2026-08-28).** The admin key is a dev-only end-to-end test master key — `mcp-server.js` gates the mint on `!app.isPackaged`, so it does not exist in a packaged build. End-to-end testing needs to reach internal pages. So the boundary is by **tier**: non-admin refused internal (already enforced at the resolver), admin allowed internal, the master-password secret sheet refused for all. This leg does the admin-reach half; Leg 2 (`secret-sheet-wall`, F9) does the sheet half.

**Ground truth (read 2026-08-28).**

- Two separate gates, do not conflate them:
  - `src/main/automation/resolve.js:233` — `if (!allowInternal && isInternalContents(wc)) throw 'automation: internal-session — wcId …'`. This is the **non-admin** wall. Admin sets `allowInternal: true` (`engine.js`), so it is skipped for admin. **Unchanged by this leg.**
  - `src/main/automation/resolve.js:210` — `if (isSheetContents(wc)) throw 'automation: secret-sheet …'`, **ungated by `allowInternal`** — refuses any sheet wcId for every tier including admin. **Unchanged by this leg** (DD3); already pinned by `test/unit/automation-resolve.test.js:149-167` ("sheet still refused with `allowInternal:true`").
- The four ops with an **op-local** refusal that fires *after* the resolver — i.e. the ONLY thing that refuses **admin** on an internal guest:
  - `evaluate` — `observe.js:483` `if (isInternalContents(wc)) throw 'automation: evaluate — internal-session excluded'` (comment block `:437,460,481-484`).
  - `injectScript` — `observe.js:540` (`:522-523,538-541`).
  - `openDevTools` — `observe.js:585` (`:553,561-563,583-586`).
  - `closeDevTools` — `observe.js:614` (`:597,600-601,612-615`).
  - The shared design comment for all four: `observe.js:43-55` ("resolve → FINAL isInternalContents refusal → act").
- The ops that **already** let admin through (resolver-only, no op-local check) and must STAY that way: `captureScreenshot` (`observe.js:200`), `readDom` (`:293`), `readAxTree` (`:395`), plus `input.js` (`click`/`typeText`/`scroll`/`pressKey` — never imports `isInternalContents`), and `nav`/`zoom`/`print`/`find`. For a non-admin key these are refused at the resolver; for admin they succeed. So F1's original "add refusals to input/observe" is moot — those already implement DD1/DD2 correctly.
- Because non-admin is refused at `resolve.js:233` BEFORE any op-local check runs, the four op-local `isInternalContents` refusals are **admin-only-effective**: removing them lets admin through and changes nothing for non-admin (which never reaches them).
- Tests pinning the behavior this leg reverses (all in `test/unit/automation-observe.test.js`), to **invert and rename** (git-blame documents the DD2→pivot intent shift; rename over delete-and-readd):
  - `:1098` `[HIGH] evaluate: internal-session REFUSED even with allowInternal:true — no executeJavaScript`
  - `:1172` `[HIGH] injectScript: internal-session REFUSED even with allowInternal:true — no executeJavaScript`
  - `:1269` `[HIGH] openDevTools: internal-session REFUSED even with allowInternal:true — DevTools NOT opened`
  - `:1324` `[HIGH] closeDevTools: internal-session REFUSED even with allowInternal:true — closeDevTools NOT called`
- Tests that pin the walls that STAY (do NOT touch): the resolver-path non-admin internal tests `captureScreenshot:306`, `readDom:553`, `readAxTree:921` (they assert `automation: internal-session`, the resolver message, with no `allowInternal`); and `automation-resolve.test.js:150-167` (sheet refused with `allowInternal:true`).

## Inputs

- `main` at the Flight-2 branch point; Legs 1 of this flight not yet started.
- Flight DD1–DD5; the recon report in the flight log.

## Outputs

- `src/main/automation/observe.js` — the four op-local `isInternalContents` refusals removed; their "DD2 even for admin" comment blocks rewritten to the tier model (admin reaches internal guests; non-admin refused at the resolver; the sheet gate is separate).
- `test/unit/automation-observe.test.js` — the four `[HIGH] … even with allowInternal:true` tests inverted and renamed to assert admin SUCCEEDS; new negative cases confirming a non-admin (no `allowInternal`) is still refused for each of the four ops (via the resolver).
- `src/main/automation/mcp-tools.js` — the four LIVE tool descriptions (`:507` evaluate, `:531` injectScript, `:563` closeDevTools, `:580` openDevTools) that today read "The internal goldfinch://settings session is ALWAYS excluded (even for admin)" — the text the automation client reads via `listTools()` — reworded to the tier model (design-review finding, MEDIUM: this is the live contract for the exact behavior this leg changes; `docs/mcp-automation.md` is the closing leg's, but these ship in the running app).
- Flight-log leg entry; this leg `landed`.

## Acceptance Criteria

- [x] AC1: under the admin tier (`allowInternal: true` in deps), `evaluate`, `injectScript`, `openDevTools`, `closeDevTools` on an internal `goldfinch://` guest **succeed** — `executeJavaScript` / `openDevTools` / `closeDevTools` run and the op returns normally — unit-pinned (the four inverted tests).
- [x] AC2: for each of the four ops, a **non-admin** call (no `allowInternal`) on an internal guest is **still refused** with the resolver's `automation: internal-session` error, before any act — unit-pinned (new cases).
- [x] AC3: the menu-overlay **sheet** gate is untouched — a sheet wcId is still refused for these ops at every tier including admin (`automation: secret-sheet`); `automation-resolve.test.js:149-167` stays green unmodified.
- [x] AC4: `captureScreenshot`/`readDom`/`readAxTree` and the `input.js` ops are unchanged — non-admin refused at the resolver, admin succeeds (their existing tests, incl. `observe.js` `:306/:553/:921`, stay green unmodified).
- [x] AC5: the four inverted tests are RENAMED (not deleted-and-readded), and the `observe.js` comment blocks state the tier model; a reader of git-blame sees the DD2→pivot shift.
- [x] AC6: the four `mcp-tools.js` tool descriptions (`:507/:531/:563/:580`) no longer claim internal exclusion "even for admin" — they state the tier model (non-admin refused; admin reaches internal guests; the secret sheet refused for all) — grep-verified.
- [x] AC7: gates — `npm test` (0 fail/skip/todo), `npm run lint`, `npm run typecheck`, `npx prettier --check .`.

## Verification Steps

- AC1/AC2: the inverted + new tests in `automation-observe.test.js`; neuter check — re-add an op-local `isInternalContents` throw to one op → its admin-success test goes red.
- AC3/AC4: run the named unchanged tests; confirm zero diff to them.
- AC5: `git diff` shows renames + comment rewrites, no deleted-then-readded test.
- AC6: the gates.

## Implementation Guidance

1. In `observe.js`, delete the four `if (isInternalContents(wc)) throw …` blocks (`:483,540,585,614`). Rewrite each op's preceding comment (and the shared `:43-55` block) to: "internal-session is a TIER boundary (flight DD1/DD2): non-admin is refused at `resolve.js`'s `!allowInternal && isInternalContents` throw before this op runs; the admin (dev-only) tier reaches internal guests here by design; the menu-overlay SHEET remains refused for all tiers at `resolve.js`'s ungated `isSheetContents` gate (DD3), which this op does not bypass." Keep the `isInternalContents` import only if still referenced (after removal it likely is not — remove the unused import too, or lint will flag it).
2. Invert + rename the four tests in `automation-observe.test.js`: e.g. `[HIGH] evaluate: internal-session ALLOWED under admin (allowInternal:true) — executeJavaScript runs (flight-2 DD2 pivot; was "REFUSED even for admin")`. Assert the op RUNS (executeJavaScript called / DevTools opened) and returns; drop the throws-assertion.
3. Add the AC2 negative cases (reuse each op's existing internal-guest fixture without `allowInternal`): assert `automation: internal-session` from the resolver, and that the act (executeJavaScript / openDevTools) did NOT run.
4. Do NOT touch `resolve.js`, the sheet-gate tests, or the resolver-path non-admin tests. Do NOT touch `input.js`/`captureScreenshot`/`readDom`/`readAxTree` (already correct).
5. Update the four `mcp-tools.js` tool descriptions (`:507/:531/:563/:580`) to the tier model — e.g. "Jar-scoped guests and admin targets, including the internal goldfinch:// session under the dev-only admin tier; the master-password secret sheet is refused for all tiers." Match each op's existing phrasing.
6. Gates. The narrative doc `docs/mcp-automation.md` and the behavior-crew apparatus note are the closing leg (DD5), not this one — but the `observe.js` inline comments AND the live `mcp-tools.js` descriptions are updated here.

## Edge Cases

- **`injectScript` on the vault page**: runs arbitrary code in the vault renderer, but secrets never enter the page DOM (design invariant) — the injected code is bounded by the page's own secret-free IPC surface; acceptable for a dev-only key (flight DD2/DD3 rationale).
- **A sheet is never a normal `wcId` target for these ops**: the sheet gate at `resolve.js:210` fires at resolve time, so even post-relaxation an op naming a sheet wcId is refused before the (now-removed) op-local check would have run — confirm with AC3.
- **`isInternalContents` still exported/used elsewhere**: it is still used by `resolve.js` itself and possibly other callers — only the `observe.js` op-local *uses* are removed; do not remove the function.

## Files Affected

`src/main/automation/observe.js`, `src/main/automation/mcp-tools.js` (four tool descriptions), `test/unit/automation-observe.test.js`. (Not `resolve.js`, not `docs/mcp-automation.md`, not `input.js`.)

## Citation Audit

2026-08-28, against the Flight-2 branch: `observe.js` op-local refusals at `:483/:540/:585/:614` and comment blocks `:43-55,437,460,481,522,538,553,561,583,597,600,612`; resolver gates `resolve.js:210` (sheet) / `:233` (internal); `engine.js` admin `allowInternal:true`; `mcp-server.js` `!app.isPackaged` mint gate; tests `automation-observe.test.js:1098/1172/1269/1324` (invert) and `:306/:553/:921` (keep), `automation-resolve.test.js:150-167` (keep). All read at design time; nothing vanished.
