# Leg: renderer-headroom

**Status**: completed
**Flight**: [Decompose main.js and Restore renderer.js Headroom](../flight.md)

## Objective

Move the tab context-menu cluster out of `src/renderer/renderer.js` into a new chrome controller, `src/renderer/chrome/tab-context-controller.js`. The cluster is the `tabCtx` state, the closed-tab-stack-size and move-targets push caches with their seeds and subscriptions, and `openTabContextMenu`. Behaviour must not change, `renderer.js` must drop to at most 1,465 lines (from 1,504), and `RENDERER_LINE_BUDGET` is retargeted to the new count.

## Context

- **The flight's Technical Approach**, `renderer.js` headroom: move the context-menu and overlay-dispatch cluster out to free budget.
  - The seam set stays at 41 (`SEAM_COUNT`).
  - `RENDERER_LINE_BUDGET` in `test/helpers/renderer-line-budget.js` is retargeted to the new count with zero headroom, per the CLAUDE.md rule. "Headroom" in the flight criterion means the count falls at least 40 below the old budget of 1,505.
  - Add `.catch` to the two seed calls on the way (maintenance finding #31, two of its seven sites).
- **The cluster** (`renderer.js` on `main` @ 25e3bbd), from the `/* ---- tab context menu (M09 F5 Leg 1) */` banner (~:1066) through the end of `function openTabContextMenu` (~:1142):
  - `const tabCtx = { tabId: null, returnFocus: null }` (:1077);
  - `const closedTabStackSizeCache = createPushCache(0)`, plus its `onClosedTabStackChanged` subscription and its `closedTabStackSize()` seed (:1086–1092);
  - `const moveTargetsCache = createPushCache([])`, plus its `onMoveTargetsChanged` subscription and its `moveTargets()` seed (:1101–1107);
  - `function openTabContextMenu(id, anchorEl)` (:1117–1142).
- **`openTabContextMenu`'s free identifiers:** `orderedTabIds`, `tabs`, `isInternalTab`, `tabContextModel`, `openOverlayMenu`, `chromePointToSheet`, `document`, plus `createPushCache` and `window.goldfinch` for the caches. The Developer must check where each is declared, and pass live values as deps and late ones as getters.
- **Consumers of the moved names in `renderer.js`, all of which must keep working:**
  - `tabCtx`:
    - `:455` (`tabCtx.returnFocus`, inside a handler, so it runs later);
    - `:947` (`tabCtx: () => tabCtx`, the overlay-dispatch getter);
    - `:1161` (the `createAuditHooks` deps, read when that construction runs).
  - `openTabContextMenu`:
    - `:178` (`openTabContextMenu: (id, anchorEl) => openTabContextMenu(id, anchorEl)`, a lazy arrow);
    - `chrome/tab-controller.js` (receives it through that dep);
    - `chrome/overlay-dispatch.js` (reads `tabCtx()` through the getter);
    - `chrome/audit-hooks.js` (mutates `tabCtx.tabId` / `.returnFocus` on the SAME object).
  - **`tabCtx` must stay ONE object, shared by identity.** The controller creates it and exposes it; `renderer.js` binds the same reference.
- **Precedent:** `chrome/audit-hooks.js` (Mission 20 F2 L1). It was extracted verbatim, bound in `renderer.js` to the same names, and the seam tail was untouched.
- **New-module checklist** (CLAUDE.md *src/shared ESM modules*): a chrome controller under `chrome/**` is covered by the `eslint.config.mjs` module glob. It is imported by `renderer.js` and takes its pure functions (`tabContextModel`, `createPushCache`) as injected deps (the "page controllers take shared pure functions as injected deps" pattern), so it can be unit-tested with fakes.

## Inputs

- Leg 1 is landed, so `main.js` is changed; `renderer.js` is untouched so far. Leg 2 runs separately (main process only). Do not touch `src/main/`.

## Outputs

- **New `src/renderer/chrome/tab-context-controller.js`:** `createTabContextController(deps)` returns `{ tabCtx, openTabContextMenu }`, owns the two push caches, and wires their subscription and seed through `deps.goldfinch` (= `window.goldfinch`).
- **`src/renderer/renderer.js`:** the cluster is replaced by one import and one construction bound to the same names; the line count drops to at most 1,465.
- **`test/helpers/renderer-line-budget.js`:** `RENDERER_LINE_BUDGET` is set to the new exact count. `vault-restore-workflow-invariants.test.js` reads the same constant.
- **New `test/unit/tab-context-controller.test.js`.**
- **CLAUDE.md:** the *Formatting is Prettier's* line-budget sentence states the new `RENDERER_LINE_BUDGET` value.

## Acceptance Criteria

- [ ] **Verbatim move.** The cluster moves into `createTabContextController` with only free identifiers turned into deps. The diff of the bodies (indent stripped) shows no logic change, apart from the two `.catch` additions below. Record the method and its result in the flight log.
- [ ] **Seed errors are handled.** The `closedTabStackSize()` and `moveTargets()` seed calls each gain a `.catch(() => {})`. The cache keeps its default when a seed rejects, which is today's outcome minus the unhandled rejection. Unit-tested.
- [ ] **`tabCtx` is shared by identity.** `renderer.js`'s `tabCtx` is the controller's object: the overlay-dispatch getter, the audit hooks and the handler at `:455` all see writes made by `openTabContextMenu`. A unit test asserts that the returned `tabCtx` is the object `openTabContextMenu` mutates.
- [ ] **Unit tests with fakes:**
  - a vanished tab id is a no-op;
  - the model gets `stackSize` from the cache, with push-wins-over-seed (`createPushCache`'s rule);
  - `moveTargets` comes from the cache;
  - `isInternal` / `hasView` are derived from the tab entry;
  - `openOverlayMenu('tab-context', model, point, 0)` is called;
  - `tabCtx.returnFocus` is set to `document.activeElement`.
- [ ] **Seam and budget.**
  - `SEAM_COUNT` stays 41 and the seam tail is byte-identical.
  - `renderer.js` is at most 1,465 lines.
  - `RENDERER_LINE_BUDGET` equals the new count.
  - `seam-contract.test.js` and `vault-restore-workflow-invariants.test.js` pass.
- [ ] **Existing tests unchanged.** `tab-controller.test.js`, `overlay-dispatch.test.js` and `audit-hooks.test.js` pass without changes. If any reads `renderer.js` text for the moved code, re-target that pin to the new file and neuter-verify it.
- [ ] **No regression.** `npm test`, `npm run lint`, `npm run typecheck` and `npm run format:check` are all green.
- [ ] **Live smoke** (every primitive). In a dev launch on a scratch profile, with env-key scripts:
  - run `enumerateWindows`, `enumerateTabs`, `openTab` ×2, `captureWindow` and `evaluate`;
  - open the tab context menu through the a11y hook (`evaluate` on the chrome: `openTabContextMenuForAudit()`), then read the sheet's state through the census (`enumerateWindows`). The tab-context sheet is NOT readable (it is not an automatable menu type), so record only that the call returned without error and that the census shows the window responsive;
  - close the sheet with `pressKey` Escape on the chrome;
  - record `closedTabStackSize` after closing a tab: `evaluate` `window.goldfinch.closedTabStackSize()`;
  - quit, and remove the scratch profile and keys.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/tab-context-controller.test.js test/unit/seam-contract.test.js test/unit/vault-restore-workflow-invariants.test.js test/unit/tab-controller.test.js test/unit/overlay-dispatch.test.js test/unit/audit-hooks.test.js`
- `wc -l src/renderer/renderer.js`
- `timeout 300 npm test && npm run lint && npm run typecheck && npm run format:check`
- The live smoke.

## Implementation Guidance

1. List the free identifiers and where each is declared in `renderer.js`.
2. Create the controller, injecting `goldfinch`, `document`, the pure functions and the live getters.
3. Bind it in `renderer.js` at the old site: `const { tabCtx, openTabContextMenu } = createTabContextController({ … })`. Check the TDZ: every reference to the two names is below the construction or inside a closure that runs later.
4. Retarget the budget constant to the exact new count, after `npm run format`.

## Edge Cases

- **A push arrives before the seed resolves:** `createPushCache` already handles this (push wins). The move must not change the order in which the subscription is registered relative to the seed call: subscription first, then seed, as today.

## Files Affected

- `src/renderer/chrome/tab-context-controller.js` (new), `src/renderer/renderer.js`
- `test/unit/tab-context-controller.test.js` (new), `test/helpers/renderer-line-budget.js`
- `CLAUDE.md`

## Citation Audit

Checked 2026-11-19 on `main` @ 25e3bbd. `renderer.js` is 1,504 lines.
- The cluster: `:1066–1142`.
- The consumers: `:178`, `:455`, `:947`, `:1161`.
- `tab-controller.js:56/:218`, `overlay-dispatch.js:52/:281`, `audit-hooks.js:29–41/:175–180`.
- `renderer-line-budget.js:28`: `RENDERER_LINE_BUDGET = 1505`.
