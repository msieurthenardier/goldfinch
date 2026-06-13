# Leg: observe-a11y

**Status**: completed
**Flight**: [Observe Engine (screenshot / DOM / a11y)](../flight.md)

## Objective

Add `readAxTree(wcId, deps, opts?)` to `src/main/automation/observe.js` — a foreground-first read of a
target tab's **accessibility tree** via in-process `webContents.debugger`
(`attach('1.3')` → `Accessibility.enable` → `Accessibility.getFullAXTree` → `detach()` in `finally`),
with a synchronous single-client lock and a clean `debugger-unavailable` refusal when the contents is
already held; unit-tested with a fake `debugger`. This is the **only** `webContents.debugger` use in
the entire engine.

## Context

- **DD3 — a11y tree via in-process `webContents.debugger` → `Accessibility.getFullAXTree`.** There is
  **no pure-JS path** to the platform accessibility tree, so this is the one capability that needs the
  debugger. An in-process attach to a *resolved* `webContents` sidesteps the flat-`/json`
  guest-discovery hazard `a11y-audit.mjs` documents. `getFullAXTree` returns `{ nodes: AXNode[] }`.
- **DD4 — raw, maximally capable; opt-in projection stub.** Return the **raw** `nodes` array, no
  trimming. `readAxTree` accepts a trailing `{ depth?, properties? }` options object as a **documented
  Flight-9 extension stub** — accepted in the signature, **unimplemented in v1** (ignored), and
  **never** a default that drops nodes. Architect note (DD4): nodes are plain JSON-serializable
  AXNodes; `backendNodeId`/`frameId` are CDP-session-scoped handles that go **stale on detach** —
  informational in the snapshot, not live references (action-linking is a Flight-3+ concern).
- **DD5 — foreground-to-act, reusing Flight 1.** Guest: resolve → `await activate(wcId)` →
  **re-resolve** → (then lock + attach). Chrome: no activate. Same sequence as `captureScreenshot` /
  `readDom` / `input.js:138 (actOn)`.
- **DD6 — internal-session exclusion absolute.** `resolveContents` rejects bad-handle / dead /
  internal-session **before** any activate or debugger touch. The admin-debugger-on-internal relaxation
  is Flight 4 — not here.
- **DD7 — debugger lifecycle safety: attach-on-demand, detach in `finally`, single-client lock.**
  `detach()` runs in a `finally` so a contents is **never** left attached, even on a `sendCommand`
  error. An in-engine lock (a synchronous `Set` of attached `wcId`s) prevents a second concurrent
  attach on the same contents.
- **DD8 — single-CDP-client conflict: clean refusal (resolves the mission Open Question).** If
  `attach()` throws (another client — DevTools, or a second automation client — already holds the
  contents), `readAxTree` **returns** a clean `debugger-unavailable` refusal — never a crash or hang.
  `capturePage`/`readDom` are unaffected (debugger-free).
  - **Open premise (architect-flagged, do NOT assume).** Whether in-process `webContents.debugger` and
    the external `--remote-debugging-port` client (`cdp-driver`) contend for the same
    one-client-per-contents slot is **undocumented and version-dependent**. Verification per DD8:
    **primary unit** = a fake `debugger` whose `attach()` throws → clean refusal (authoritative);
    **primary live (HAT, Leg 6)** = operator opens **DevTools** → a11y read refuses cleanly;
    **opportunistic smoke (Leg 5)** = chrome a11y read while `cdp-driver` attached — **record** refuse
    vs succeed, **not** a required assertion.

## Decision — `debugger-unavailable` is a RETURNED refusal, not a thrown error (reconciles DD8 vs the leg-list bullet)

The flight has an internal inconsistency: **DD8 says `readAxTree` "returns a clear `debugger-unavailable`
refusal"** (twice, incl. the unit-coverage wording "returns the clean refusal"), while the flight's
leg-list bullet calls it "the *thrown* `debugger-unavailable`." **DD8 wins** (a Design Decision is
authoritative; the leg list is explicitly "tentative"). Rationale, which also justifies the split:

- **Expected operational condition → return.** A busy debugger (DevTools open during dogfooding, or a
  second client) is a *normal, expected* outcome the caller routinely handles — not exceptional. It is
  a **first-class result value**, so callers don't need try/catch around every a11y read.
- **Programmer / security error → throw.** bad-handle / dead / **internal-session** are
  `resolveContents` throws (consistent with the whole module) — genuine errors, not operational states.

**Contract:**
- bad-handle / dead / internal-session → **throws** (`resolveContents`, `automation:`-prefixed).
- attach fails (another client holds it) **or** the in-engine lock is already held → **returns**
  `{ automation: 'debugger-unavailable', reason: 'attach-failed' | 'locked', wcId }`.
- success → the **raw `nodes` array** (DD4), **possibly empty `[]`** (a contents that hasn't rendered an
  AX tree yet) — an empty array is a **valid success**, structurally distinct from the refusal object
  (`Array.isArray(result)` discriminates).
- post-attach `sendCommand` failure (attach succeeded, `enable`/`getFullAXTree` rejects) → **propagates**
  (it is not "debugger-unavailable" — the debugger *was* available); `detach()` still runs in `finally`.

Recorded in the flight log Decisions.

## Inputs

What exists before this leg runs:
- `src/main/automation/observe.js` (Legs 1–2, landed) — `captureScreenshot` / `captureWindow` /
  `readDom`; imports `resolveContents` / `classifyContents`; **currently debugger-free**. This leg adds
  the first (and only) debugger use.
- `src/main/automation/input.js:138 (actOn)` — the foreground-to-act sequence to mirror.
- Electron `Debugger` API (electron.d.ts:7459 `class Debugger`): `attach(protocolVersion?): void`
  (**synchronous, throws** on failure), `detach(): void` (sync), `isAttached(): boolean`,
  `sendCommand(method, params?): Promise<any>`.
- `test/unit/automation-observe.test.js` (Legs 1–2) — extend; reuse the `makeGuestWc` etc. helpers.
- `node --test test/unit/*.test.js` (377 pass after Leg 2); `npm run typecheck`; `npm run lint`.

## Outputs

What exists after this leg completes:
- `src/main/automation/observe.js` — gains `readAxTree` + a module-private `attached` `Set` lock + a
  refusal helper; the module-header comment updated (it is **no longer** debugger-free — the debugger
  now lives here, and **only** here).
- `test/unit/automation-observe.test.js` — gains `readAxTree` cases (happy path, empty-tree success,
  attach-throw refusal, concurrent-lock refusal, detach-in-finally on sendCommand error, foreground +
  re-resolve, resolve-rejection passthrough).
- Engine wiring still **NOT** touched — `readAxTree` is added to `engine.js` dispatch in Leg 4.

## Acceptance Criteria
- [ ] `readAxTree(wcId, { fromId, chromeContents, activate }, { depth, properties } = {})` is exported
  from `observe.js`. The `{ depth, properties }` options are accepted but **unimplemented in v1**
  (documented Flight-9 stub; never drops nodes).
- [ ] **Guest** sequence: resolve → `await activate(wcId)` → **re-resolve** → lock → attach. **Chrome**:
  no activate. (Same as `captureScreenshot`/`readDom`.)
- [ ] Happy path: `wc.debugger.attach('1.3')` → `await sendCommand('Accessibility.enable')` →
  `await sendCommand('Accessibility.getFullAXTree')` → returns its `nodes` array (`?? []`) →
  `wc.debugger.detach()` runs in a `finally`.
- [ ] **`detach()` is in a `finally`** — it runs even when `enable`/`getFullAXTree` rejects (assert
  detach called on the sendCommand-error path). `detach()` is wrapped so a throw from it (already
  detached) does not mask the original outcome.
- [ ] **Synchronous single-client lock** (a module-private `Set` of `wcId`s): the check (`has`) and the
  add are synchronous with **no `await` between them**; the only awaits are *after* the add. If the
  lock is already held → return `{ automation: 'debugger-unavailable', reason: 'locked', wcId }`
  **without** attaching. The lock is released in a `finally` (even on attach-throw / sendCommand-throw).
- [ ] **attach-throw refusal**: if `attach()` throws → return
  `{ automation: 'debugger-unavailable', reason: 'attach-failed', wcId }` (no detach — never attached;
  lock released).
- [ ] **Empty tree is success**: `getFullAXTree` → `{ nodes: [] }` returns `[]` (NOT a refusal).
- [ ] **DD6**: bad-handle / dead / internal-session **throw** before any activate/lock/attach (assert no
  attach on the internal-session path; the lock is not even acquired).
- [ ] No `Accessibility.enable`-vs-`getFullAXTree` ordering or protocol-version (`'1.3'`) assumption is
  *asserted as live-correct* — the unit test fakes the sequence; the **live** confirmation (is `enable`
  required first? is `'1.3'` accepted on a guest in Electron ^42?) is a **Leg-5 smoke / Leg-6 HAT**
  check (flight Open Question + Divert criterion). Note this in the JSDoc.
- [ ] The module header no longer claims to be debugger-free; it states the debugger lives **only** in
  `readAxTree` (the other ops + modules stay debugger-free — DD9).
- [ ] `test/unit/automation-observe.test.js` covers, with these assertions pinned explicitly:
  - **happy path**: `assert.deepEqual(dbg._log[0], ['attach', '1.3'])` (attach called with exactly
    `'1.3'`); `Accessibility.enable` is logged **before** `Accessibility.getFullAXTree` in `dbg._log`
    (the ordering, not just that both ran); returns the nodes array; `_detached === 1` (detach in
    finally); the lock is released afterward (a subsequent call succeeds).
  - **empty-tree success**: `getFullAXTree → { nodes: [] }` returns `[]` (NOT a refusal;
    `Array.isArray(result)` is true).
  - **attach-throw refusal**: returns `{ automation:'debugger-unavailable', reason:'attach-failed' }`;
    `_detached === 0` (never attached, so never detached); lock released (subsequent call succeeds).
  - **concurrent-lock refusal**: two un-awaited calls on the same wcId via a controllable pending
    `sendCommand` (deferred promise); the second returns `{ …reason:'locked' }` and `attach` was called
    **once**; after resolving the deferred, the first returns nodes and a third call succeeds (lock
    released).
  - **detach-on-sendCommand-error**: `getFullAXTree` rejects → `readAxTree` **rejects** (propagates);
    `_detached === 1`; lock released.
  - **detach() itself throws must not mask**: (a) happy sendCommand + `detach()` that throws →
    `readAxTree` still returns the nodes array; (b) `getFullAXTree` rejects **and** `detach()` throws →
    the **original sendCommand rejection** propagates (not the detach error).
  - **guest foreground + re-resolve proof** (the **second** post-activate handle's `debugger` is the one
    attached); **chrome no-activate**.
  - **three resolve-rejection paths** (bad-handle / dead / internal-session) throw before any
    lock/attach; the internal-session case asserts **no attach** *and* the `attached` Set is **size 0**
    after (lock untouched).
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all green (full suite, no regressions).

## Verification Steps
- `node --test test/unit/automation-observe.test.js` — Legs 1–2 cases + new `readAxTree` cases pass.
- `node --test test/unit/*.test.js` — full suite green.
- `npm run typecheck` — clean. `npm run lint` — clean.
- Manual read: `webContents.debugger` appears **only** inside `readAxTree` (grep `debugger` in
  `observe.js` → only `readAxTree` + the header note); the other modules remain debugger-free.

## Implementation Guidance

1. **Module-private lock + refusal helper** (top of `observe.js`, near the other module-privates):
   ```js
   // Single-client lock (DD7): wcIds with an in-flight debugger attach. The has()/add() pair is
   // synchronous (no await between) so concurrent readAxTree calls on the same contents are race-safe.
   const attached = new Set();
   const debuggerUnavailable = (wcId, reason) =>
     ({ automation: 'debugger-unavailable', reason, wcId });
   ```

2. **`readAxTree`** — foreground-to-act (mirror `readDom`) then the locked attach block:
   ```js
   async function readAxTree(wcId, { fromId, chromeContents, activate }, { depth, properties } = {}) {
     void depth; void properties;                  // DD4 Flight-9 stub — accepted, unimplemented in v1
     let wc = resolveContents(wcId, { fromId, chromeContents });   // throws bad/dead/internal (DD6)
     if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
       await activate(wcId);                        // DD5 (await BEFORE the lock — see note)
       wc = resolveContents(wcId, { fromId, chromeContents });     // stale-handle re-resolve
     }
     if (attached.has(wcId)) return debuggerUnavailable(wcId, 'locked');  // sync check…
     attached.add(wcId);                                                  // …+ add (no await between)
     try {
       try {
         wc.debugger.attach('1.3');
       } catch {
         return debuggerUnavailable(wcId, 'attach-failed');   // another client holds it (DD8)
       }
       try {
         await wc.debugger.sendCommand('Accessibility.enable');
         const res = await wc.debugger.sendCommand('Accessibility.getFullAXTree');
         return res && Array.isArray(res.nodes) ? res.nodes : [];        // empty = valid success (DD4)
       } finally {
         try { wc.debugger.detach(); } catch { /* already detached — don't mask the outcome */ }
       }
     } finally {
       attached.delete(wcId);                       // release the lock (DD7) — even on attach-throw
     }
   }
   ```
   - **Lock placement note:** the `activate` await is *before* the lock; the lock's check-and-add are
     synchronous with the only awaits *after* (the `sendCommand`s). Two concurrent calls on one wcId
     may both `activate` (idempotent bring-to-front) but only one wins the synchronous `add`; the other
     returns the `locked` refusal. This is the DD7 race-safety property.
   - **Two code comments to include** (review follow-ups): (a) the lock is keyed on the **stable
     `wcId`**, not the per-resolve `wc` handle, so it correctly spans the re-resolve; (b) the code must
     **not** re-resolve again between `attach` and `detach` — the `finally` `detach` must run on the
     **same** `wc` that was attached (it does, as written; a comment guards future edits).

3. **Export** — add `readAxTree` to `module.exports`.

4. **Module header** — update the Leg-1 comment that says the module is debugger-free: now state the
   debugger lives **only** in `readAxTree` (attach-on-demand, detach-in-finally, single-client lock,
   clean refusal — DD3/DD7/DD8/DD9), and the other ops/modules remain debugger-free.

5. **JSDoc on `readAxTree`** — deps, the `{ depth, properties }` Flight-9 stub, the return contract
   (raw nodes / empty-is-success / `debugger-unavailable` refusal object), DD4's stale-handle caveat on
   `backendNodeId`/`frameId`, and the **live-unknown** note (`enable`-required? `'1.3'` on a guest? →
   Leg-5/6).

6. **Tests** (`test/unit/automation-observe.test.js`) — add a fake `debugger` to the wc helpers:
   ```js
   function makeDebugger({ attachThrows = false, axNodes = [], sendImpl } = {}) {
     const log = [];
     return {
       _log: log, _detached: 0, _attached: 0,
       attach(v) { log.push(['attach', v]); if (attachThrows) throw new Error('already attached'); this._attached++; },
       detach() { log.push(['detach']); this._detached++; },
       isAttached() { return this._attached > this._detached; }, // parity with real API; unused by readAxTree (the Set is the lock)
       sendCommand(method, params) {
         log.push(['send', method]);
         if (sendImpl) return sendImpl(method, params);
         if (method === 'Accessibility.getFullAXTree') return Promise.resolve({ nodes: axNodes });
         return Promise.resolve({});
       },
     };
   }
   ```
   - **Concurrent-lock test**: give `sendImpl` a deferred promise you resolve manually. Call
     `readAxTree(id, deps)` twice **without awaiting the first**; await the second → assert it is the
     `{ automation:'debugger-unavailable', reason:'locked' }` object and `attach` was called **once**.
     Then resolve the deferred, await the first → it returns the nodes; assert the lock is released (a
     third call succeeds).
   - **detach-in-finally on error**: `sendImpl` rejects on `getFullAXTree` → `readAxTree` rejects;
     assert `_detached === 1` and a subsequent call succeeds (lock released).
   - Reuse the counter-backed `fromId` for the guest re-resolve proof (the **second** handle's
     `debugger` is the one attached).

## Edge Cases
- **DevTools open on the target tab (live)** → real `attach()` throws → `attach-failed` refusal. The
  unit fake models this with `attachThrows`; the live trigger is the Leg-6 HAT (DD8 primary live test).
- **Second concurrent automation read on the same contents** → the synchronous `Set` returns the
  `locked` refusal without even attempting `attach` (cheaper, cleaner than letting attach throw).
- **`getFullAXTree` returns `{ nodes: undefined }` / no `nodes`** → return `[]` (defensive; empty is a
  valid success).
- **`detach()` itself throws** (already detached by the time `finally` runs) → swallowed in its own
  `try/catch` so it never masks the real return value or error.
- **`attach()` succeeds but `enable` rejects** → propagates (NOT a refusal — the debugger *was*
  available); `detach()` still runs; lock released.
- **Internal-session / bad / dead wcId** → `resolveContents` throws before any lock/attach (DD6); assert
  the lock `Set` was never touched.
- **Live unknowns (not unit-asserted as correct):** whether `Accessibility.enable` must precede
  `getFullAXTree`, and whether protocol `'1.3'` attaches on a *guest* `webContents` on Electron ^42 —
  resolved in the Leg-5 smoke / Leg-6 HAT, per the flight Open Question and Divert criterion.

## Files Affected
- `src/main/automation/observe.js` — add `readAxTree` + `attached` lock + refusal helper; update header.
- `test/unit/automation-observe.test.js` — add `readAxTree` cases + `makeDebugger` fake.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

> **Batched-flight note:** Autonomous leg in a batched flight. Implement to acceptance criteria, update
> the flight log, set this leg's status to `landed`, signal `[HANDOFF:review-needed]`. Do **NOT**
> commit, do **NOT** set `completed`, do **NOT** check off the leg/flight. Review + `completed` +
> check-offs + commit are one flight-level pass at the end of the autonomous batch.

- [ ] All acceptance criteria verified
- [ ] Unit suite + typecheck + lint green
- [ ] Update flight-log.md with a Leg Progress entry (incl. the throw-vs-return decision)
- [ ] Set this leg's status to `landed`
