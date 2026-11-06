# Leg: automation-honors-vault-lock

**Status**: completed
**Flight**: [Automation Honors the Vault Lock](../flight.md)

## Objective
Make the operator's vault lock authoritative over every live MCP automation session, and make
the agent's vault access visible to the operator. The store's `onLock` teardown zeroizes every
session's vault keys. `vaultUnlock` reports `held`. A chrome-only `vault-automation-held` push
drives the indicator badge and the locked-state "Lock now" menu item (flight DD1–DD6).

## Context
- Flight design decisions DD1–DD7 (`../flight.md`) are binding. In particular:
  - **DD1**: zeroize session vault keys only; transports, identities and the audit session list
    are untouched.
  - **DD2**: one-way coupling.
  - **DD3**: every `vaultUnlock` result is `{ unlocked, held }`; the audit detail is unchanged.
  - **DD4**: own channel, aggregate computed from ctx key sizes, transition-pushed and deduped,
    live get-handle, separate `heldPushed` flag.
  - **DD5**: badge only when `setUp && !unlocked && held`.
  - **DD6**: locked+held menu shows [Unlock now, Lock now] and `renderer.js` gains no lines.
- This reverses a documented decision (`docs/mcp-automation.md` "Session lifecycle +
  zeroization", `docs/vault.md` "Session-scoped teardown", the `vault-context.js` header). Tests
  that pin the old decoupling are **renamed / re-scoped, not deleted** (git blame should show the
  intent shift).
- `lockNow()` fires `onLock` unconditionally (`vault-store.js` `lockNow` — `if (this.onLock)` is
  not gated on `mrk`), so Lock-now-while-locked reaches the new step with no new IPC (verified by
  the flight Architect review).
- First leg of the sortie; nothing prior in the flight log beyond planning.

## Inputs
- `main` @ b85189c on branch `sortie/07-automation-honors-vault-lock`.
- `src/main/vault-lock-teardown.js` `runVaultLockTeardown({ records, vaultHuman, closeSheets, broadcast })`.
- `src/main/vault/vault-context.js` `createVaultContext` (`setKey`, `zeroize`, `dropVault`,
  `revalidate`, `unlock` — `return { unlocked: opened };`).
- `src/main/automation/mcp-server.js` `createMcpServer` (opts parsing near `getVaultAutoLockMinutes`;
  `const vaultCtx = createVaultContext({ … getAutoLockMinutes: getVaultAutoLockMinutes })`;
  `transport.onclose`; `stop()`; `return { start, stop, get port(), getActivity }`).
- `src/main/main.js`: `let mcpServer = null;`; `mcpServer = createMcpServer({ … })`; the store's
  `onLock: () => { … runVaultLockTeardown({ … }) }`; `createBroadcasters({ … })`.
- `src/main/broadcasts.js` `createBroadcasters` (`liveChrome`, `broadcastToChromeAndInternal`).
- `src/shared/vault-indicator-model.js` `buildVaultIndicatorModel`.
- `src/shared/page-context-model.js`: the toolbar `'vault'` branch.
- `src/renderer/chrome/vault-controller.js`: `vaultStatePushed`, `lockState`,
  `renderVaultIndicator`, `isVaultLocked`, the `onVaultLockState` subscribe + `getVaultLockState`
  fetch, and the returned API.
- `src/renderer/renderer.js`: `vaultLocked: vaultController.isVaultLocked()` inside
  `pageContextModel(…)` (in `openToolbarContextMenu`'s dispatch, near line 828).
- `src/preload/chrome-preload.js` `onVaultLockState` / `getVaultLockState` / `vaultLock`, and
  `src/renderer/renderer-globals.d.ts` (their entries near lines 579-583).
- `src/renderer/styles.css` `#vault-indicator` block (comment says "no badge").

## Outputs
- Session vault keys zeroized on every vault lock (manual, idle, quit), via an isolated teardown
  step.
- `vaultUnlock` → `{ unlocked: string[], held: string[] }`.
- New main→chrome channel `vault-automation-held` `{ held: boolean }`, plus the
  `vault-automation-held-get` handle.
- The indicator shows the `vault-automation-held` class and its label; the menu shows
  [Unlock now, Lock now] when locked+held.
- Docs, CLAUDE.md and the tool description updated; tests added, updated and renamed.

## Acceptance Criteria

**Session context (`vault-context.js`)**
- [ ] AC1. `unlock()` returns `{ unlocked, held }`, where `held` is the ids currently in `keys`
      (insertion order) after the call. A wrong/foreign key leaves existing keys untouched:
      good key then bad key → `{ unlocked: [], held: ['work'] }`, and `list()` still returns the
      item. After `zeroize()`, a bad key → `{ unlocked: [], held: [] }`.
- [ ] AC2. A new `heldIds()` returns a fresh array copy of the held vault ids, and is exported on
      the ctx object.
- [ ] AC3. An optional `onHeldChange(held: boolean)` dep fires AFTER the mutation, ONLY on the
      ctx's own empty↔non-empty flip:
      - `setKey` from empty → `true`;
      - `zeroize()` from non-empty → `false`;
      - a `dropVault` that empties the map (via `revalidate`) → `false`.
      It does not fire for:
      - an admin unlock opening N vaults (exactly one `true`);
      - re-unlocking an already-held vault;
      - `zeroize()` on an empty ctx;
      - a failed unlock.
      A throwing callback is swallowed: `unlock`/`zeroize`/`revalidate` behave identically and
      never throw because of it.
- [ ] AC4. The header comment's "NO singleton coupling either direction" bullet is rewritten.
      Automation → store stays decoupled (stateless methods only). Store lock → automation now
      zeroizes via main's `onLock` teardown (`mcpServer.zeroizeAllVaultSessions()`). The ctx
      itself still holds no store reference to the human lock.

**Server (`mcp-server.js`)**
- [ ] AC5. `createMcpServer` accepts an optional `onVaultHeldChange()` option, defaulting to a
      no-op. Every per-session `createVaultContext` receives an `onHeldChange` that calls it,
      guarded by try/catch.
- [ ] AC6. The returned API gains `zeroizeAllVaultSessions()` and `isVaultHeld()`.
      - The per-session loop lives in a small **exported** helper (e.g.
        `zeroizeVaultContexts(ctxs)`, exported from `mcp-server.js` beside `deriveAuditDetail`).
        It calls `zeroize()` on each ctx in its own try/catch with no early return, and is
        unit-tested directly with fake ctxs, including a throwing one.
      - `zeroizeAllVaultSessions()` runs the helper over every `sessions` entry's `vaultCtx`. It
        does not close transports, delete sessions or touch the audit log.
      - **`stop()` also runs the helper over every entry BEFORE `sessions.clear()` and the
        transport closes.** Otherwise a `transport.close()` throw (swallowed by `stop()`)
        orphans that ctx's keys with no flip.
      - `isVaultHeld()` is `true` iff some entry's `vaultCtx.heldIds().length > 0`, computed from
        ctx key state, never from `sessions` membership.
      - `port`, `start`, `stop` and `getActivity` are unchanged.
- [ ] AC7. Unit (`automation-mcp-server.test.js`), using the existing vault harness
      (`buildVaultFixture` + `startVaultServer` ~1507-1570). `startVaultServer` gains a one-line
      `onVaultHeldChange` pass-through (or an `extraOpts` spread). With two sessions from
      `connectClient(WORK_KEY)` ×2, both unlocked:
      - `zeroizeAllVaultSessions()` empties both: each session's next `vaultList` returns `[]`
        and a bad-key `vaultUnlock` reports `held: []`;
      - `isVaultHeld()` goes `true` → `false`;
      - both sessions are still routable afterwards (a further `tools/call` on each succeeds);
      - `onVaultHeldChange` fired.
      Throw-isolation is proven on the exported helper (AC6), not through the server.
      Also cover: `stop()` with held sessions zeroizes them, and the helper ran before transport
      close (an `isVaultHeld()` read after `stop()` resolves returns `false`).
- [ ] AC7b. **Real-trigger integration unit**, in a new
      `test/unit/vault-lock-automation-coupling.test.js` or inside `automation-mcp-server.test.js`.
      Setup:
      - a REAL vault store via `vault-store` `load(dir, { onLock })` on the same fast-scrypt
        fixture;
      - `onLock` wired exactly as `main.js` wires the new step:
        `() => runVaultLockTeardown({ records: () => [], vaultHuman: null, closeSheets() {}, broadcast() {}, zeroizeAutomationVaults: () => server.zeroizeAllVaultSessions() })`;
      - a REAL `createMcpServer` over that store.
      With a session holding the `work` key:
      - (a) `store.lockNow()` while the store is LOCKED leaves the session's `vaultList` returning
        `[]`. This is the Lock-now-while-locked path.
      - (b) the store unlocked by master password, then its idle timer firing
        (`getAutoLockMinutes` + the MockTimers recipe from CLAUDE.md, or the store's injected
        `setTimeout` seam if it has one), leaves the session's `vaultList` returning `[]`.
      - (c) the session can `vaultUnlock` again afterwards.
      This drives success criteria 1 and 2 from the store's own entry points; only `main.js`'s
      literal wiring is left to the AC9 pin.

**Main wiring (`vault-lock-teardown.js`, `main.js`, `broadcasts.js`)**
- [ ] AC8. `runVaultLockTeardown` accepts an optional `zeroizeAutomationVaults` dep. The order is
      prompts close → `dropAllCaptures` → **`zeroizeAutomationVaults()` in its own try/catch** →
      `closeSheets` → `broadcast`.
      Unit (`vault-lock-teardown.test.js`):
      - the order spy includes the new step in that position (a `'zeroize'` entry between the
        capture drop and `'sheets'`; existing deepEquals stay unchanged because the dep is
        optional);
      - a throwing `zeroizeAutomationVaults` still runs `closeSheets` and `broadcast`;
      - an absent dep is a no-op;
      - every existing case is unchanged.
- [ ] AC9. `main.js`'s store `onLock` passes
      `zeroizeAutomationVaults: () => mcpServer?.zeroizeAllVaultSessions()`. It reads the live
      module `let mcpServer` at call time; never a captured instance.
      A new source pin in `vault-lock-teardown.test.js`, next to the AC15 pin and in the same
      style (`maskComments`, wrap-insensitive regex, mutation-guarded with `assertMutated` or the
      file's equivalent idiom), asserts that the `runVaultLockTeardown({…})` call inside `onLock`
      contains `zeroizeAutomationVaults` bound to `mcpServer?.zeroizeAllVaultSessions()`:
      - scope the match to that call (a bounded regex or `findMatchingBracket` from
        `test/helpers/source-scan`);
      - match `/zeroizeAutomationVaults:\s*\(\)\s*=>\s*mcpServer\?\.zeroizeAllVaultSessions\(\)/`.
      Neuter-verify it: deleting the property makes the pin fail. The existing AC15 regex must
      still pass.
- [ ] AC10. `broadcasts.js` gains a chrome-only `broadcastToChromes(channel, payload)` (the same
      `liveChrome` walk; internal pages and guests never receive it), with a case in
      `broadcasts.test.js`.
      `main.js`:
      - defines ONE `publishHeld()`, module-scoped near `let mcpServer`. It recomputes
        `held = mcpServer?.isVaultHeld() === true` and sends `vault-automation-held`
        `{ held }` via `broadcastToChromes` ONLY when `held !== lastPushedHeld` (module-scoped,
        initial `false`). The whole body is try/caught.
      - passes `onVaultHeldChange: () => publishHeld()` to `createMcpServer`.
      - also calls `publishHeld()` after every server stop, start and swap: the
        `automationToggle` `stop` wrapper (`stop: async () => { await mcpServer.stop(); publishHeld(); }`
        or equivalent) and after `startMcpServerInstance` assigns `mcpServer`. A rebind or a
        flip-off therefore can never leave the cue stale-true.
      - registers a bare `ipcMain.handle('vault-automation-held-get', () => ({ held: mcpServer?.isVaultHeld() === true }))`,
        computed LIVE and never from `lastPushedHeld`.
      - The payload carries ONLY `{ held: boolean }`.

**Chrome**
- [ ] AC11. `chrome-preload.js` adds
      `onVaultAutomationHeld: (cb) => ipcRenderer.on('vault-automation-held', (_e, d) => cb(d))`
      and `getVaultAutomationHeld: () => ipcRenderer.invoke('vault-automation-held-get')`.
      `renderer-globals.d.ts` gains both entries (chrome `goldfinch` interface, beside
      `onVaultLockState`). No internal-preload change.
- [ ] AC12. `buildVaultIndicatorModel({ setUp, unlocked, automationHeld })` returns
      `{ visible, state, automationHeld }`, where `automationHeld = setUp && !unlocked && !!automationHeld`.
      It never throws on malformed input. Existing outputs gain only the `automationHeld: false`
      key: update the existing `vault-indicator-model.test.js` deepEquals (7 across 4 tests,
      lines ~14-49) to include it.
      `vault-indicator-model.test.js` covers:
      - not set up + held → hidden, `automationHeld: false`;
      - locked + held → `true`;
      - unlocked + held → `false`;
      - locked + not held → `false`;
      - malformed input, including a truthy non-boolean `automationHeld: 'yes'`, which coerces.
- [ ] AC13. `vault-controller.js`:
      - **State:** stashes `let automationHeld = false` and `let heldPushed = false`.
      - **Subscribe order:** subscribes `goldfinch.onVaultAutomationHeld` FIRST and then fetches
        `getVaultAutomationHeld()`; the fetch applies only if `!heldPushed`. It neither STASHES
        nor renders when a push already arrived, which differs from the existing `lockState`
        fetch at ~617-620. That fetch stashes unconditionally; don't copy it.
      - **Render:** `renderVaultIndicator` renders from BOTH `lockState` and `automationHeld`,
        and is called from every push or fetch of either. It toggles `vault-automation-held`, and
        `aria-label` becomes `Vault locked — automation has vault access` when
        `model.automationHeld`; otherwise the labels are unchanged.
      - **Unaffected:** the held push NEVER runs the `onVaultLockState` continuations
        (`pendingVaultFlow` → picker, `convertShownLocked`/`advance`).
      - **New method:** `vaultMenuOpts()` returning `{ vaultLocked: isVaultLocked(), automationHeld }`
        is added to the returned API; `isVaultLocked` stays.
- [ ] AC14. `pageContextModel` toolbar `'vault'` with `opts.automationHeld`:
      - locked + held → `[{ type: 'item', id: 'action:vault-unlock', label: 'Unlock now' }, { type: 'item', id: 'action:vault-lock', label: 'Lock now' }]`
        (the same item objects as today, including `type: 'item'`; in that order; no separator);
      - locked → [Unlock now];
      - unlocked (held or not) → [Lock now];
      - opts omitted → [Lock now] (unchanged).
      `page-context-model.test.js` covers all of these. The JSDoc `opts` type (~line 59) gains
      `automationHeld?: boolean`. `overlay-dispatch.js` needs no change: both ids already route.
- [ ] AC15. `renderer.js`'s `vaultLocked: vaultController.isVaultLocked()` line is replaced by
      `...vaultController.vaultMenuOpts()`, so the line count is unchanged.
      `test/unit/seam-contract.test.js` passes with `RENDERER_LINE_BUDGET` 1505 untouched, and
      `SEAM_COUNT` stays 41.
      A source pin (regex-target, wrap-insensitive, mutation-guarded and neuter-verified, beside
      the other `renderer.js` source scans) asserts that the `pageContextModel(` call in
      `renderer.js` spreads `...vaultController.vaultMenuOpts()`. `renderer.js` isn't
      unit-reachable, so the pin is the only proof the menu receives `automationHeld`.
- [ ] AC16. `styles.css` adds `#vault-indicator.vault-automation-held` with a small accent badge on
      the locked padlock, using an existing token such as `var(--accent)` and no new colors. It
      must not change the button's box size: use a positioned pseudo-element. Add
      `position: relative` to the `#vault-indicator` block (`styles.css` ~2090). It isn't in the
      shared `position: relative` block at ~1961-1965 that the automation and downloads
      indicators use. Update the block comment, which currently says "no badge".

**Tool, docs, tests**
- [ ] AC17. The `vaultUnlock` description in `mcp-tools.js` documents `held` ("`held` lists every
      vault this session holds after the call, so a wrong key reports what remains unlocked"), and
      that an operator vault lock (Lock now or idle) zeroizes every session's vault keys, after
      which the agent must call `vaultUnlock` again. `automation-mcp-tools.test.js` still passes.
- [ ] AC18. Docs:
      - **`docs/mcp-automation.md`:** the `vaultUnlock` row (`{ unlocked, held }`, bad-key
        example) and the "Session lifecycle + zeroization" paragraph. The paragraph now says the
        operator's lock (Lock now from any surface, idle auto-lock, quit) zeroizes every live
        session's vault keys while sessions stay open; that the coupling is one-way; that a lock
        ends current access and a durable cut-off is revoking or rotating the access key; and
        that JSON-response sessions have no SSE stream, so teardown means a graceful `DELETE`.
      - **`docs/vault.md`:** the "Session-scoped teardown" bullet.
      - **`CLAUDE.md`:**
        - the Chrome-indicators sentence becomes "Vault right-click when locked is 'Unlock now'
          (plus 'Lock now' while an automation session holds vault keys)…";
        - the Password-vault "Automation is fill-only…" bullet gains one clause that the
          operator's lock zeroizes every MCP session's vault keys (`onLock` →
          `zeroizeAllVaultSessions`).
        Keep CLAUDE.md edits minimal.
- [ ] AC19. Tests asserting the old decoupling are re-scoped, renamed rather than deleted:
      - `vault-context.test.js`'s "no singleton coupling: vault-store.lockNow() NEVER empties a live
        MCP session" becomes a ctx-level statement, e.g. "ctx holds independent key copies: the
        store's own lockNow() does not reach a ctx directly (main's onLock teardown does —
        vault-lock-teardown.test.js)". Its section header "No singleton coupling — both
        directions" is updated.
      - The `deepEqual` cases at `vault-context.test.js` (`{ unlocked: [] }` ×3, in the "wrong/foreign
        access key unlocks NOTHING" test) gain `held`.
      - The "an MCP unlock NEVER changes the vault-store human lock state" test stays (still true,
        DD2).
- [ ] AC20. Both harnesses that construct the vault controller with a fake `goldfinch`
      (`vault-controller-capture.test.js` ~84-96 and `vault-controller-generate.test.js` ~41-50)
      gain a `getVaultAutomationHeld` fake returning a Promise. This is a hard requirement: their
      Proxy fallback returns `() => {}`, so `.then` on `undefined` would throw at construction
      and break every controller test. The `on*` subscription is auto-recorded by the Proxy. The
      capture suite's fake must be controllable (a deferred promise) for case (c).
      New controller cases (in `vault-controller-capture.test.js`, beside the existing indicator
      cases near the `isVaultLocked` / "Lock now" tests):
      - (a) a held push while locked toggles the class and label;
      - (b) a held push does NOT spring a pending unlock→picker continuation;
      - (c) a late `getVaultAutomationHeld` fetch after a push does not overwrite it;
      - (d) `vaultMenuOpts()` reflects both stashes.
- [ ] AC21. Gates: `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check` all
      pass. Report the counts; the renderer line count stays ≤ 1505.
- [ ] AC22. **Live smoke — the behavior test.** `/mission-control:behavior-test vault-mcp-lock-coupling`
      is run by the **Flight Director** after the Developer lands (not by the Developer), against
      a fixture profile. The leg does not complete while it fails. The Developer only confirms
      the app boots cleanly in dev mode with the change (`npm run dev:automation`, then stop), and
      reports any startup error.

## Verification Steps
- AC1–AC3, AC6 (helper), AC7, AC7b, AC8, AC12, AC14, AC19, AC20: `node --test` on the named
  suites, then the full `npm test`.
- AC15 pin: neuter-verify (remove the spread, confirm the pin fails, restore it).
- AC9: run the new pin, then temporarily delete the property and confirm the pin fails; restore
  it (neuter-verify, reported).
- AC10: `broadcasts.test.js` case. Then grep `vault-automation-held` across `src/` and confirm
  exactly: one send site (main), one handle, two preload lines, and d.ts entries.
- AC11: typecheck.
- AC15: `wc -l` is not the measure; the budget test is (`split(/\r?\n/).length`).
- AC16–AC18: diff review, plus a doc grep. Run
  `rg -n "never empties a live automation|never empties a live MCP|a human \"Lock now\" never" docs src test CLAUDE.md`;
  every hit must be judged exempt or rewritten. Separately, run
  `rg -n "no singleton coupling" docs src test CLAUDE.md` and judge each hit. The automation →
  store direction is still true (e.g. the "an MCP unlock NEVER changes the vault-store human lock
  state" test, `main.js` ~68-70), but `main.js` ~1620-1622 "STATELESS methods only (no singleton
  coupling)" is now misleading and gets reworded.
- AC22: the Flight Director runs the behavior test.

## Implementation Guidance

1. **vault-context.js.** Add `onHeldChange` dep parsing beside `getAutoLockMinutes`. Write a tiny
   `notifyIfFlipped(wasHeld)` helper, called after `setKey` (from `unlock`), at the end of
   `zeroize`, and in `revalidate` after the loop (capture `wasHeld` before the loop — firing once
   after the loop avoids mid-iteration callbacks). `unlock` captures `wasHeld` before its try and
   notifies after `setKey` calls. Add `heldIds`. Return `held` from `unlock`. Rewrite the header
   bullet.
2. **mcp-server.js.** Parse `opts.onVaultHeldChange`. Pass `onHeldChange: () => { try { onVaultHeldChange(); } catch {} }`
   into the per-session `createVaultContext`. Add `zeroizeAllVaultSessions` and `isVaultHeld`
   beside `getActivity`, and return them.
3. **vault-lock-teardown.js.** Add the isolated step and update the header's numbered order.
4. **broadcasts.js.** Add `broadcastToChromes` and export it. In `main.js`, destructure it from
   `createBroadcasters`. Mind the TDZ: the broadcaster is constructed near line 604, `mcpServer`
   is declared at 645, and the `onVaultHeldChange` closure runs only at runtime, but confirm the
   destructured binding exists before any call.
5. **main.js.** Add the `onVaultHeldChange` option, `lastPushedHeld`, the get-handle (beside
   `vault-lock-state-get`), and the `onLock` teardown dep. Update the vault-store comment block
   (~946-955) that narrates onLock consumers.
6. **Chrome.** Preload, d.ts, model, controller (`renderVaultIndicator(state)` → render from the
   stashes; keep its call sites working), page-context-model, the `renderer.js` one-line swap,
   CSS.
7. **Tool description, docs, CLAUDE.md, tests** (AC17–AC20).
8. Run `npm run format`, then all gates.

## Edge Cases
- **Automation surface disabled / server null**: `mcpServer?.` makes the lock step a no-op, and
  the get-handle returns `{ held: false }`.
- **Lock while no session holds keys**: zeroize is a no-op and no held push happens (no flip).
- **Server stop/rebind with held sessions**: `onclose` → `zeroize` → flip → push `false`.
- **Revoked access key**: the cue stays on until the session's next vault op, its idle timer or
  teardown (accepted, DD4). Do not add revalidation to `isVaultHeld`.
- **Chrome recovery / new window**: the boot fetch rebuilds the stash. Nothing else is needed.
- **Teardown order**: the chrome may see `held: false` before `vault-lock-state`. No test may pin
  the opposite order.
- **Admin session**: covered by the same ctx paths (`openAllWithAdminKey` map → several `setKey`
  calls → one flip).

## Files Affected
- `src/main/vault/vault-context.js` — `held`, `heldIds`, `onHeldChange`, header.
- `src/main/automation/mcp-server.js` — option, two API methods.
- `src/main/automation/mcp-tools.js` — `vaultUnlock` description.
- `src/main/vault-lock-teardown.js` — isolated step.
- `src/main/broadcasts.js` — `broadcastToChromes`.
- `src/main/main.js` — onLock dep, held push + dedup, get-handle, comment.
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts` — two bridge methods.
- `src/shared/vault-indicator-model.js`, `src/shared/page-context-model.js` — models.
- `src/renderer/chrome/vault-controller.js` — stash, render, `vaultMenuOpts`.
- `src/renderer/renderer.js` — one-line swap.
- `src/renderer/styles.css` — badge.
- `docs/mcp-automation.md`, `docs/vault.md`, `CLAUDE.md`.
- Tests: `vault-context`, `automation-mcp-server`, `vault-lock-teardown`, `broadcasts`,
  `vault-indicator-model`, `page-context-model`, `vault-controller-capture`,
  `vault-controller-generate` (+ any other controller harness).

## Citation Audit
2026-11-05 (Flight Director). Citations were checked against `main` @ b85189c:
- `vault-context.js` header bullet at lines 25-29, `unlock` return at ~323, `touch` at 246,
  `setKey` at 269 and `revalidate` at 217;
- `vault-context.test.js` deepEquals at 368/371/374 and the decoupling tests at 776-811;
- `vault-lock-teardown.test.js` AC15 pin at 78-81;
- `mcp-server.js` opts at ~478-498, the per-session ctx at ~895-904, `onclose` at ~923 and the
  return at ~1146;
- `main.js` `mcpServer` at 645, `createBroadcasters` at 604, `createMcpServer` at 1536, `onLock`
  at ~985-1008, `vault-lock-state-get` at ~2459 and `vaultLockNow` at 2467;
- `renderer.js` line ~828; `chrome-preload.js` 437-442; `renderer-globals.d.ts` 579-583;
- `page-context-model.test.js` 216-228; `overlay-dispatch.js` ~268-271;
- `styles.css` ~2085-2112; the docs anchors at `mcp-automation.md` 796 and 845-852, and
  `vault.md` 298-301.
All present; none vanished.

---

## Post-Completion Checklist
Completion steps — status transitions, flight-log update, checking off in the parent flight, and
commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
