# Sortie: Automation Honors the Vault Lock

**Status**: completed

## Charter

### Outcome
When the operator locks the vault (Lock now OR the idle auto-lock), every live MCP automation
session loses its vault access at once, the operator can see — and end — agent vault access even
while their own vault is locked, and a `vaultUnlock` that opens nothing tells the agent truthfully
what its session still holds.

### Why Now
Operator-found live (2026-11-05): an MCP jar session unlocked its jar vault with the jar's access
key; the operator clicked Lock now; the session kept listing/filling. A later `vaultUnlock` with
BAD credentials returned `{ unlocked: [] }` while the session's earlier keys survived, so the agent
reported "already unlocked". Root cause: `vault-context.js` holds per-session key copies zeroized
only on transport teardown or its own op-reset idle timer; the store's `onLock` never reaches them,
and `docs/mcp-automation.md:849-851` documents that decoupling as intended. This sortie reverses it.

### Success Criteria
- [x] With an MCP session holding a jar vault key, operator **Lock now** leaves that session
      locked: `vaultList` returns no items, `vaultTotp` returns `code: null`, `vaultFill` /
      `vaultAnswerAuth` refuse as locked; a fresh `vaultUnlock` with the valid key works again.
- [x] The same holds when the operator's **idle auto-lock** fires.
- [x] A `vaultUnlock` with a wrong key returns `unlocked: []` plus an explicit `held` list of the
      vault ids the session still holds (empty after a lock); existing session keys are untouched.
- [x] While the operator's vault is locked and any automation session holds vault keys, the
      toolbar vault indicator shows an accent badge + the label "Vault locked — automation has
      vault access", and its right-click menu offers **Unlock now** AND **Lock now**; Lock now
      ends the agents' current vault access and clears the badge (a durable cut-off is still
      revoking the access key).
- [x] `docs/mcp-automation.md`, `docs/vault.md` and `CLAUDE.md` describe the new coupling; no doc,
      test or comment still asserts that a human lock leaves automation sessions untouched.

### Constraints
- No secret (access key, admin key, vault key, item data) is logged, returned, audited, or sent to
  the chrome. The chrome receives one boolean.
- Coupling is **one-way**: automation unlock/activity never changes the operator's lock state and
  never resets the operator's idle timer.
- The lock zeroizes every session's key Buffers; a failure on one session never stops the others,
  nor any other step of the lock teardown.
- `renderer.js` stays within `RENDERER_LINE_BUDGET` 1505 (currently 1504).

### Deferred (out of scope)
- **Brute-force detection** for repeated failed `vaultUnlock` calls (rate limit / lockout / audit
  alert) — candidate future sortie or squawk. Operator interest noted 2026-11-05.
- A held cue / Lock-out control on the `goldfinch://vault` page itself (the toolbar indicator and
  the guest fill-icon native menu are the operator's lock surfaces this sortie).

---

## Pre-Flight

### Objective
Make the operator's vault lock authoritative over automation. The store's single `onLock` hook —
already the path for manual Lock now (chrome `vault-lock`, `internal-vault-lock`, the fill-icon
native menu), the store idle timer and `before-quit` — gains an isolated step that zeroizes every
live MCP session's vault keys. A new boolean projection ("some automation session holds vault
keys") is pushed to the chrome on its own channel so the vault indicator can badge itself and offer
Lock now while the operator's vault is locked. `vaultUnlock` results gain a `held` list so a failed
unlock is reported truthfully.

### Open Questions
- [x] Does Lock now zeroize sessions, or end them? → DD1 (zeroize keys; sessions stay open)
- [x] Manual only, or idle auto-lock too? → both (operator ruling 1)
- [x] Should a failed unlock drop held keys? → no, report them (operator ruling 2; DD3)
- [x] How does the operator lock agents out when their own vault is already locked? → DD4–DD6
      (operator chose option (b): held cue + Lock now)
- [x] Indicator cue? → accent badge + label (operator ruling)
- [x] Menu in locked+held state? → "Unlock now" + "Lock now" (operator ruling)
- [x] HAT leg? → yes (operator ruling)

### Design Decisions

**DD1 — The lock reaches automation through the ONE `onLock` hook, as an isolated teardown step
that zeroizes keys but leaves sessions open.**
`runVaultLockTeardown` (`src/main/vault-lock-teardown.js`) gains a `zeroizeAutomationVaults` dep,
wired in `main.js`'s store `onLock` as `() => mcpServer?.zeroizeAllVaultSessions()`, reading the
module-scoped `mcpServer` LIVE at call time (a rebind/toggle swaps the instance; a disabled surface
is `null` → no-op). Order: prompts close → captures drop → **automation zeroize** → credential
sheets close → lock-state broadcast. The new step runs in its own `try/catch` so a throw never
skips the sheet close or broadcast. `zeroizeAllVaultSessions()` (new on `createMcpServer`'s
return) loops every `sessions` entry calling `vaultCtx.zeroize()` each in its own `try/catch` with
no early return (planner/actuator shape). Transports, identities and the audit session list are
untouched: a lock is a VAULT lock, not an automation revocation, so the agent re-unlocks with its
key and keeps driving tabs.
- Covers: Lock now from the chrome indicator, the vault page and the fill-icon menu (all
  `vaultLockNow()` → `lockNow()`), the store idle timer (`_touch` → `lockNow()`), and
  `before-quit` (harmless). `lockNow()` fires `onLock` even when the store is already locked —
  which is what makes Lock-out-while-locked (DD6) work with no new IPC.
- Rationale: one hook already owns "everything that must die on lock"; a second path would drift.
- Trade-off: an agent mid-task when the operator's idle timer fires is cut off and must re-unlock.
- **A lock ends CURRENT access, not the grant.** An agent holding the access key can re-unlock
  immediately (the badge returns). The durable cut-off stays "revoke / rotate the access key";
  `docs/mcp-automation.md` and the HAT script say so explicitly.
- **Lock-while-already-locked re-runs the whole teardown** (`lockNow()` fires `onLock`
  unconditionally, `vault-store.js:1231-1251`): save prompts close `vault-lock`,
  `dropAllCaptures` drops pending `mode:'locked'` unlock-to-save offers, both pending-import
  stores drop, credential sheets close, and `vault-lock-state` re-broadcasts an identical payload.
  This is already true of today's fill-icon "Lock now" while locked. **Accepted and documented**:
  "Lock now" means "drop everything held", and a pending locked-vault save offer is dropped
  (operator re-submits). HAT walks it once.
- **Wiring pin**: `main.js` can't be unit-run, so `vault-lock-teardown.test.js` gains a
  source-scan pin, next to the existing `onLock → runVaultLockTeardown` one. It asserts that the
  call passes `zeroizeAutomationVaults` reading the live `mcpServer?.zeroizeAllVaultSessions()`.
  The behavior test is the end-to-end check.

**DD2 — One-way coupling.** Automation unlock/activity never calls the stateful store paths
(`openVaultWithAccessKey` / `openAllWithAdminKey` stay stateless — no `_touch`, no `_installMrk`)
and so never changes the operator's lock state or resets the operator's idle timer. The session's
own idle timer (`vault-context.js` `touch()`) is unchanged and still applies independently.

**DD3 — `vaultUnlock` reports `held` on every result.** The result becomes
`{ unlocked: string[], held: string[] }`: `unlocked` keeps its meaning (vaults THIS call opened);
`held` is every vault id the session holds after the call (insertion order of `keys`). A wrong key
leaves existing keys untouched (no DoS of a working session by a bad call) and returns
`{ unlocked: [], held: [<existing>] }`; after a lock, `{ unlocked: [], held: [] }`. Vault ids are
non-secret (jar ids / `global`). `deriveAuditDetail` stays `unlocked=<n>` (unchanged by design:
the audit panel already names the jar per session; vault ids add nothing). The
`vaultUnlock` tool description in `mcp-tools.js` documents `held`.

**DD4 — Held projection: a boolean on its OWN channel, live-computed, transition-pushed.**
- **Source of truth**: `mcpServer.isVaultHeld()` = some `sessions` entry's `vaultCtx` holds ≥ 1
  key, computed from **ctx key sizes** (new `vaultCtx.heldIds()`), never from `sessions.has`
  (`onclose` zeroizes BEFORE `sessions.delete`, `mcp-server.js:923-933`). `mcpServer === null` →
  `false`.
- **Rebuild trigger**: `createVaultContext` gains an optional `onHeldChange` dep, fired AFTER the
  mutation and ONLY on the ctx's own empty↔non-empty flip (setKey from empty; `zeroize()` /
  `dropVault()` to empty). That covers unlock, idle expiry, transport teardown, `stop()`/rebind/
  toggle-off (all cascade through `onclose`), revalidation drop and lock. An admin unlock opening
  N vaults flips ONCE; re-unlocking an already-held vault does not fire. `dropVault` runs
  mid-`revalidate` iteration, so the callback is try/caught and never throws. `MAX_SESSIONS`
  rejects with a 429 and never evicts, so it is not a path. `createMcpServer` threads it per
  session and calls its injected `onVaultHeldChange` option. `main.js` recomputes the aggregate
  and sends `vault-automation-held` `{ held: boolean }` to every **chrome** (chrome-only fan-out;
  internal pages don't consume it) ONLY when the aggregate differs from the last pushed value. That
  last-pushed value is a push gate ONLY: nothing ever answers a read from it. Any throw in the
  notify path is swallowed (it must never fail an unlock or a zeroize).
- **Init fetch**: bare `ipcMain.handle('vault-automation-held-get')` computes LIVE (chrome trust,
  non-secret boolean — the bare-handle rule). Chrome subscribes FIRST, then fetches, with its OWN
  `heldPushed` flag (the existing `vaultStatePushed` guards `lockState` only) so a late fetch never
  overwrites a fresher push. A new window and a chrome-recovery reload rebuild the stash from this
  boot fetch.
- **Own channel, never `vault-lock-state`**: the chrome's `onVaultLockState` handler runs the
  fill-picker and unlock-to-save continuations (`vault-controller.js:586-614`); riding it would fire
  them on agent transitions. The `vault-lock-state` payload stays exactly `{ setUp, unlocked }`
  (guest `vault-lock-changed`, the vault page and `isVaultUnlocked` consumers untouched).
- **Max staleness / accepted**: an access-key revoke or admin-key rotation drops a session's key
  lazily at its next vault op (`revalidate()`), so the cue can stay ON until that op, the session
  idle timer (`vaultAutoLockMinutes`) or teardown. Accepted: the error is in the safe direction
  (cue on, access already gone) and Lock now clears it.
- **Payload carries no identity**: no session ids, jar ids or counts reach the chrome.
- New contextBridge methods (`onVaultAutomationHeld`, `getVaultAutomationHeld`) get their
  `renderer-globals.d.ts` entries.

**DD5 — Indicator model: a third input, badge only in the locked state.**
`buildVaultIndicatorModel({ setUp, unlocked, automationHeld })` returns
`{ visible, state, automationHeld }` where `automationHeld` is true only when
`setUp && !unlocked && automationHeld`. Rendering toggles a `vault-automation-held` class (accent
badge on the locked padlock, `styles.css`) and sets `aria-label` to
"Vault locked — automation has vault access"; otherwise labels are unchanged. Left-click behavior
is unchanged (locked → unlock sheet). The controller stashes the held boolean separately from
`lockState` and re-renders from both on either push. No badge while the operator is UNLOCKED
(operator ruling scoped the cue to the locked state; Lock now is already offered then).
Teardown order means the chrome can briefly see `unlocked: true, held: false` (zeroize precedes
the lock-state broadcast). That's harmless, because no badge shows while unlocked, and tests must
not pin the opposite order.

**DD6 — Right-click menu: locked+held offers both items.** `pageContextModel`'s toolbar-`vault`
branch takes `opts.automationHeld`: unlocked → [Lock now]; locked → [Unlock now]; locked + held →
[Unlock now, Lock now]. **HAT amendment (operator ruling, Leg 2 H5):** the locked+held menu became [note "Automation has vault access", separator, Unlock now, **End automation access**] and the indicator `title` shows "Vault locked — automation has vault access" while held — copy only, ids/dispatch unchanged. Ids stay `action:vault-unlock` / `action:vault-lock` (dispatch unchanged).
`renderer.js:828` passes the opts via a REPLACED line (e.g. `...vaultController.vaultMenuOpts()`
returning `{ vaultLocked, automationHeld }`) so the line count is unchanged — `renderer.js` is at
1504/1505. CLAUDE.md's "Vault right-click when locked is 'Unlock now'" line is updated.

**DD7 — Apparatus.** Behavior test `vault-mcp-lock-coupling` (draft, this sortie), on the
`vault-login` fixture profile (operator's vault LOCKED at launch; jar access secrets known).
- **Act**: a jar-key MCP session's vault tools; Lock now via an ADMIN session `evaluate` on the
  chrome target with `expression: "goldfinch.vaultLock()"` — the exact IPC the indicator menu's
  Lock now item calls (`vault-controller.js` `lockNow()`); MCP session close via the client.
- **Observe**: the jar session's own tool results (`vaultUnlock.held`, `vaultList`, `vaultTotp`);
  admin `readDom` on the chrome for `#vault-indicator`'s classes + `aria-label`.
- **Not observable → HAT**: the right-click menu (page-context sheet: not in
  `AUTOMATABLE_MENU_TYPES`), the badge's pixels, the operator's own unlock (vault-unlock sheet),
  and the operator's idle auto-lock (arms only while the operator is unlocked).

### Prerequisites
- [x] `vault-login` fixture builder current — used by Sortie 06's `save-prompt-non-blocking`
      (2026-11-04).
- [x] Sortie 06 landed (PR #280 merged, debrief written); local `main` == `origin/main` (the working tree
      carried uncommitted Sortie 06 leg-04 changes at planning time; since merged).
- [x] Dev launch with `GOLDFINCH_AUTOMATION_ADMIN=1` + `GOLDFINCH_AUTOMATION_DEV_MINT=1` available
      (operator standing preference: dev mode, env-key scripts, never the registered MCP server).

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach
1. **Session ctx** (`src/main/vault/vault-context.js`): `heldIds()`; `onHeldChange` dep fired on
   empty↔non-empty flips (in `setKey`, `zeroize`, `dropVault`), guarded; `unlock()` returns
   `{ unlocked, held: heldIds() }`.
2. **Server** (`src/main/automation/mcp-server.js`): `zeroizeAllVaultSessions()` (isolated per
   session), `isVaultHeld()`, `onVaultHeldChange` option threaded into every `createVaultContext`.
3. **Main** (`src/main/main.js`, `src/main/vault-lock-teardown.js`): teardown's isolated
   `zeroizeAutomationVaults` step; held recompute + dedup broadcast `vault-automation-held`;
   `vault-automation-held-get` handle.
4. **Chrome** (`chrome-preload.js`, `renderer-globals.d.ts`, `src/shared/vault-indicator-model.js`,
   `src/shared/page-context-model.js`, `chrome/vault-controller.js`, `renderer.js` one-line
   replacement, `styles.css` badge).
5. **Tool + docs**: `mcp-tools.js` description; `docs/mcp-automation.md` (Session lifecycle +
   zeroization, vaultUnlock result), `docs/vault.md` (automation section), `CLAUDE.md`.

### Shared mechanisms touched (project rule: list every sharer, assert unaffected)
- **`onLock` / `runVaultLockTeardown`** — existing sharers: save-prompt close (`vault-lock`),
  `dropAllCaptures`, `_pendingVaultImports.dropAll`, `_pendingBrowserImports.dropAll`, credential
  sheet close, `vault-lock-state` broadcast (+ guest `vault-lock-changed`). Order and isolation
  pinned in `vault-lock-teardown.test.js`, extended to include the new step and a throwing-zeroize
  case proving the later steps still run.
- **Toolbar `vault` context-menu model** — unlocked / locked / pre-setup cases unchanged.
- **Vault indicator render** — locked/unlocked/hidden rendering unchanged when not held.

### Tests that change (design review)
- **Break on `held`**: `vault-context.test.js:368,371,374` (`deepEqual … { unlocked: [] }`).
- **Assert the old decoupling, so rewrite or retitle them**: `vault-context.test.js:776,779,799-811`
  ("vault-store.lockNow() NEVER empties a live MCP session"). The claim stays true at ctx level,
  so retitle it to say the coupling lives in `onLock`, and pair it with the new wiring pin.
- **Controller harness mocks**: `vault-controller-capture.test.js` and
  `vault-controller-generate.test.js` (and any other suite constructing the vault controller) mock
  `goldfinch.getVaultLockState`/`onVaultLockState`. They gain `getVaultAutomationHeld` and
  `onVaultAutomationHeld`.
- **Extend**: `page-context-model.test.js:216-228` (toolbar vault cases),
  `vault-controller-capture.test.js:766`, the vault-indicator-model suite,
  `vault-lock-teardown.test.js`, and `automation-mcp-server.test.js`.
- Grep for any preload-surface / `renderer-globals.d.ts` drift test and update it.
- **Comments asserting decoupling**: `vault-context.js:25-29`, the `main.js` vault-store comment
  (~946-955).

### Checkpoints
- [x] Unit: a wrong key after a good key keeps keys and reports `held`; lock → `held: []`.
- [x] Unit (required): `zeroizeAllVaultSessions` zeroizes EVERY session across ≥2 sessions, and
      one throwing ctx doesn't stop the others.
- [x] Unit: `onHeldChange` fires once per flip (admin multi-vault unlock = one flip; re-unlock of
      a held vault = none); the aggregate push dedups against the last pushed value and recomputes
      from ctx sizes.
- [x] Unit: teardown step order + throwing-zeroize isolation; source-scan wiring pin.
- [x] Behavior test `vault-mcp-lock-coupling` passes.
- [x] HAT signed off.

### Adaptation Criteria

**Divert if**:
- `lockNow()` turns out not to fire `onLock` on an already-locked store in some path (DD6's
  lock-out-while-locked would need its own IPC).
- The held projection cannot be computed without exposing session identity to the chrome.

**Acceptable variations**:
- Exact method/field names (`held`, `heldIds`, `isVaultHeld`, channel name) may change if the
  leg design finds a better fit, provided the docs and this spec are updated together.
- Badge visual details are settled in the HAT.

### Legs

> **Note:** These are tentative suggestions, not commitments.

- [x] `automation-honors-vault-lock` - DD1–DD6 end to end: session ctx + server + teardown step,
      held projection channel, indicator badge + menu, tool description, docs, unit tests, and the
      `vault-mcp-lock-coupling` behavior test run.
- [x] `hat-and-alignment` - Guided HAT: operator unlocks by hand, agent unlocks, Lock now from the
      indicator menu (both states), idle auto-lock at `vaultAutoLockMinutes: 1`, badge by eye,
      bad-key unlock reporting, the agent re-unlocking after a lock (badge returns), and
      Lock-now-while-locked with a pending locked-vault save offer (offer dropped, as accepted).

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged
- [x] Tests passing (`npm test`, `typecheck`, `lint`, `format:check`)
- [x] Documentation updated (`docs/mcp-automation.md`, `docs/vault.md`, `CLAUDE.md`)

### Verification
`npm test` (new + updated vault-context / mcp-server / teardown / indicator / page-context suites),
behavior test [`vault-mcp-lock-coupling`](../../tests/behavior/vault-mcp-lock-coupling.md) (draft),
and the HAT leg. The existing `vault-mcp-surface` spec's step-1 expectation ("returns success")
still holds; its result shape gains `held`, which it does not pin.
