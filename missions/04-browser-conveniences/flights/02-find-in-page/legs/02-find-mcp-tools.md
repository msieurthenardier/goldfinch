# Leg: find-mcp-tools

**Status**: completed
**Flight**: [Find in Page](../flight.md)

## Objective

Add `findInPage` and `stopFindInPage` as gated, jar-scoped automation/MCP tools backed by a new
`src/main/automation/find.js`, with the three-place registration, an event-wrapped `findInPage`
(resolve on `found-in-page` `finalUpdate` with a timeout fallback), op-local internal guards, and
unit tests — taking the surface from **24 → 26** tools.

## Context

- **Flight DD4** — two tools: `findInPage(wcId, text, deps, { forward, findNext, matchCase }) →
  { activeMatchOrdinal, matches }` and `stopFindInPage(wcId, deps) → { ok: true }`. `findInPage`
  is **asynchronous/event-driven**: `wc.findInPage(text, opts)` returns a `requestId`
  immediately and `found-in-page` fires **multiple times** until `finalUpdate: true`. This
  event-wrap is **net-new to the codebase** — `observe.js waitForPaint` is a
  `setTimeout`/`.once('did-stop-loading')` and `cdp.js withDebuggerSession` is a synchronous
  attach/detach; neither awaits a multi-fire event. The op must specify its own listener
  contract. Returned via the default `okResult` JSON-text path (not `imageResult`).
- **Flight DD5** — both ops carry an **op-local `isInternalContents(wc)` guard AFTER
  `resolveContents`** (admin runs `allowInternal: true`, so `resolveContents` alone won't refuse
  internal). Per the Flight-1 debrief, the internal-refusal case is **unit-proven here**, not a
  live automation-surface step (the surface cannot hand an op a `goldfinch://` wcId).
- **Flight DD3 carry-forward** — counts are **live**, never cached; the op reads
  `activeMatchOrdinal`/`matches` straight off the `found-in-page` result.
- **Three-place registration (Flight-1 lesson, CI-guarded):** `engine.js` (dispatch) +
  `mcp-tools.js` (ToolDef) + `scope.js WCID_FIRST_OPS` (jar façade). The membership test in
  `test/unit/automation-scope.test.js` auto-verifies any wcId-first tool is jar-reachable — both
  new tools are auto-checked, no new guard-test needed.
- **Depends on** leg `find-bar-ui` (landed) only by theme; the MCP path is independent main-side
  code. **Precedes** `verify-integration`, whose `find-in-page` behavior test exercises these
  tools live.

## Inputs

What exists before this leg runs (verified at design time via codebase sweep):
- `src/main/automation/engine.js:62-95` — the op dispatch return object; `getZoom`/`setZoom`/
  `printToPDF` wired as `(wcId, …) => module.op(wcId, …, deps())`; `deps()` (`:41-60`) provides
  `{ fromId, chromeContents, executeInRenderer, allowInternal, fromPartition, activate }`.
- `src/main/automation/mcp-tools.js` — `DRIVE_TOOLS` array (`:117-313`) with the `getZoom`/
  `setZoom`/`printToPDF` ToolDefs (`:206-239`); flat `inputSchema` (no top-level
  `oneOf`/`anyOf`/`allOf`); `TOOLS = [...DRIVE_TOOLS, ...OBSERVE_TOOLS, ...DEVTOOLS_TOOLS,
  ...CHROME_TOOLS]` (`:478`); `okResult` (`:66`) JSON-text wrap; count comment at ~`:475`.
- `src/main/automation/scope.js:44-58` — `WCID_FIRST_OPS` array (currently ends `…, 'getZoom',
  'setZoom', 'printToPDF'`); generic wcId-membership wrapper at `:120-126`.
- `src/main/automation/print.js:1-48` — the **foreground-first template**: `resolveContents` →
  op-local `isInternalContents` guard → (guest) `activate` → re-resolve → `waitForPaint` →
  act → return; result via `okResult`.
- `src/main/automation/zoom.js:1-80` — the **simplest op-module template** (imports, JSDoc,
  guard order, plain-object return, `module.exports`).
- `src/main/automation/resolve.js` — `resolveContents(wcId, { fromId, chromeContents,
  allowInternal })` (`:76-100`, throws `automation: internal-session` only when
  `!allowInternal`); `isInternalContents(wc)` (`:28-30`, strict `=== true`).
- `src/main/automation/observe.js:79-87` — `defaultWaitForPaint` (the single-fire helper; cited
  as a **non-example** for the multi-fire event-wrap).
- `src/main/automation/cdp.js:64-81` — `withDebuggerSession` (synchronous; **non-example**).
- `test/unit/automation-mcp-tools.test.js:71-78` — `assert.equal(tools.length, 24)` + the
  name-list assertion + the "24 tools (15 drive + 4 observe + …)" comment.
- `test/unit/automation-mcp-server.test.js:26` — `const EXPECTED_TOOL_COUNT = 24;` (used by
  assertions at `:257/:272/:279/:294-295/:327`).
- `test/unit/automation-scope.test.js:211-241` — the three-place-registration CI guard (filters
  tools with required `wcId`, asserts each ∈ `WCID_FIRST_OPS`).
- `test/unit/automation-print.test.js` — unit-test structure to mirror (`node --test`).
- **Confirmed absent:** `src/main/automation/find.js`, `test/unit/automation-find.test.js`.
- Main-side `found-in-page` delivery: `wc.on('found-in-page', (event, result) => …)` where
  **`result` is the 2nd arg** (vs the renderer's `e.result`), carrying `{ requestId,
  activeMatchOrdinal, matches, selectionArea, finalUpdate }`.

## Outputs

- `src/main/automation/find.js` — `findInPage` (event-wrapped) + `stopFindInPage`.
- `src/main/automation/engine.js` — `require('./find')` + two dispatch entries threading opts.
- `src/main/automation/mcp-tools.js` — two flat-schema ToolDefs (with optional `forward`/
  `findNext`/`matchCase`) + count comment 24 → 26.
- `src/main/automation/scope.js` — `findInPage`/`stopFindInPage` added to `WCID_FIRST_OPS`.
- `test/unit/automation-find.test.js` — new unit tests (fake engine/`webContents` + fake
  `found-in-page` emitter).
- `test/unit/automation-mcp-tools.test.js` + `test/unit/automation-mcp-server.test.js` — count
  assertions bumped 24 → 26 (**required to keep the suite green — these are this leg's**).
- `npm test` green.

## Acceptance Criteria

- [ ] **AC1 — `find.js` module.** `src/main/automation/find.js` exports `findInPage(wcId, text,
  deps, { forward, findNext, matchCase } = {})` and `stopFindInPage(wcId, deps)`, Electron-free
  (handles via `deps`), mirroring the `zoom.js`/`print.js` module shape.
- [ ] **AC2 — `findInPage` event-wrap.** `findInPage` calls `const requestId =
  wc.findInPage(text, { forward, findNext, matchCase })`, attaches `wc.on('found-in-page',
  handler)`, and **resolves only on `result.requestId === requestId && result.finalUpdate ===
  true`**, returning `{ activeMatchOrdinal, matches }` read live from that result. A **timeout
  fallback** (default **2000ms**, injectable via `deps.findTimeoutMs` for tests) resolves with the
  **last-seen** update if `finalUpdate` never arrives. The listener is **removed in `cleanup()`**
  (no leak) on every exit path (resolve, timeout). `last` is updated only for the matching
  `requestId`.
- [ ] **AC3 — Options threaded end-to-end.** `forward`, `findNext`, `matchCase` flow
  ToolDef schema → `call` → engine dispatch → op. Defaults match a fresh search: a call with
  only `{wcId, text}` does a new find (`findNext` falsy); `{findNext:true, forward:true}` steps
  forward; `{findNext:true, forward:false}` steps back; `{matchCase:true}` is case-sensitive.
  (The `find-in-page` behavior test depends on this — it calls `findInPage(wcId, term,
  {findNext:true, forward:true})` etc.)
- [ ] **AC4 — `stopFindInPage`.** `stopFindInPage(wcId, deps)` calls
  `wc.stopFindInPage('clearSelection')` and returns `{ ok: true }`.
- [ ] **AC5 — Foreground-first (findInPage).** For a backgrounded **guest**, `findInPage`
  activates then re-resolves before issuing the search (mirrors `print.js` discipline); the
  op-local internal guard runs **before** activate. (No separate `waitForPaint` is required — the
  `found-in-page` event is the natural settle; if the implementer finds a paint race, a bounded
  wait is an acceptable addition.)
- [ ] **AC6 — Op-local internal guards (DD5).** Both ops call `resolveContents(wcId, deps)` then
  an op-local `if (isInternalContents(wc)) throw new Error('automation: findInPage —
  internal-session excluded')` (and the `stopFindInPage` equivalent) — **after** resolve, so
  internal is refused even under the admin `allowInternal:true` path. Unit-proven (DD5: no live
  automation step can supply an internal wcId).
- [ ] **AC7 — Three-place registration.** `engine.js` imports `./find` and dispatches both ops
  (threading opts for `findInPage`); `mcp-tools.js` adds both ToolDefs to `DRIVE_TOOLS` with
  **flat** `inputSchema` (no top-level `oneOf`/`anyOf`/`allOf`); `scope.js` adds both to
  `WCID_FIRST_OPS`. The existing `automation-scope.test.js` guard passes for both (jar-reachable).
- [ ] **AC8 — Tool count 26 (tests).** `test/unit/automation-mcp-tools.test.js` asserts 26 (with
  its name-list + comment updated to include the 2 find ops) and
  `test/unit/automation-mcp-server.test.js` `EXPECTED_TOOL_COUNT = 26`. **Scope note:** the
  CLAUDE.md prose count (`:177`), README shortcuts, and `docs/mcp-automation.md` are owned by the
  `verify-integration` leg — **do NOT touch them here** (they are prose/docs, not test gates;
  leaving them at 24 until leg 3 keeps `npm test` green and honors the flight's doc-batching).
- [ ] **AC9 — Unit tests.** `test/unit/automation-find.test.js` covers: `findInPage` resolving on
  `finalUpdate` (fake emitter firing intermediate then final updates), the timeout fallback
  (final never fires → last-seen returned), listener removal (no leak after resolve/timeout),
  option threading (forward/findNext/matchCase reach `wc.findInPage`), `stopFindInPage` returns
  `{ok:true}` and calls `clearSelection`, and the op-local internal-session refusal for **both**
  ops under `allowInternal:true`. Mirrors `automation-print.test.js` structure.
- [ ] **AC10 — Suite green.** `npm test` passes (no regressions); `npm run lint` +
  `npm run typecheck` clean.

## Verification Steps

- `npm test` — full suite green; the new `automation-find.test.js` cases pass; the three-place
  guard (`automation-scope.test.js`) passes for the two new ops; the count assertions read 26.
- `npm run lint` and `npm run typecheck` — clean.
- Grep check: `rg "oneOf|allOf" src/main/automation/mcp-tools.js` and confirm the new schemas are
  flat (only the sanctioned `pressKey` `anyOf` may remain — and that is leg-unrelated, #56/Flight 6).
- Manual read: confirm the `found-in-page` listener is removed on all three exit paths.
- Live behavior-test verification is deferred to `verify-integration` (`/behavior-test
  find-in-page`).

## Implementation Guidance

1. **`src/main/automation/find.js`.** Start from the `zoom.js` header/import style; pull the
   foreground-first activate/re-resolve from `print.js`. Import `{ resolveContents,
   classifyContents, isInternalContents }` from `./resolve`. No `require('electron')`.

2. **`findInPage(wcId, text, deps, { forward = true, findNext = false, matchCase = false } = {})`.**
   - `let wc = resolveContents(wcId, deps);`
   - `if (isInternalContents(wc)) throw new Error('automation: findInPage — internal-session excluded');`
   - Foreground-first (guest): `if (classifyContents(wc, deps.chromeContents) === 'guest' &&
     typeof deps.activate === 'function') { await deps.activate(wcId); wc = resolveContents(wcId,
     deps); }`
   - Event-wrap — **call `findInPage` first, capture its `requestId`, THEN attach the listener**
     (design-review [high] fix — Chromium emits `found-in-page` asynchronously, so attaching after
     the synchronous `findInPage()` call cannot miss an event, and `requestId` is always defined
     when the handler runs; do **not** use the `var`-hoist ordering). Update `last` **only** for
     the matching `requestId` (design-review [low] fix — a concurrent UI find on the same guest
     must not pollute this op's last-seen result):
     ```js
     const timeoutMs = (deps && deps.findTimeoutMs) || 2000; // production default 2000ms
     const requestId = wc.findInPage(text, { forward, findNext, matchCase });
     return await new Promise((resolve) => {
       let last = { activeMatchOrdinal: 0, matches: 0 };
       let done = false;
       const cleanup = () => { clearTimeout(timer); wc.removeListener('found-in-page', handler); };
       const finish = (v) => { if (done) return; done = true; cleanup(); resolve(v); };
       const handler = (_e, result) => {
         if (result.requestId !== requestId) return;           // ignore unrelated (e.g. UI) finds
         last = { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches };
         if (result.finalUpdate === true) finish(last);
       };
       const timer = setTimeout(() => finish(last), timeoutMs);
       wc.on('found-in-page', handler);
     });
     ```
     `timeoutMs` is injectable via `deps.findTimeoutMs` (default **2000**) so the unit test can
     drive the timeout fast. Use `removeListener` (Electron `WebContents` exposes both
     `removeListener` and `off`; pick one and use it consistently in the module and the fake).
   - Return `{ activeMatchOrdinal, matches }`.

3. **`stopFindInPage(wcId, deps)`.** `const wc = resolveContents(wcId, deps); if
   (isInternalContents(wc)) throw …; wc.stopFindInPage('clearSelection'); return { ok: true };`

4. **`engine.js`.** Add `const find = require('./find');` by the other op imports. In the return
   object after `printToPDF`:
   ```js
   findInPage: (wcId, text, opts) => find.findInPage(wcId, text, deps(), opts),
   stopFindInPage: (wcId) => find.stopFindInPage(wcId, deps()),
   ```

5. **`mcp-tools.js`.** Add to `DRIVE_TOOLS` (after `printToPDF`):
   ```js
   {
     name: 'findInPage',
     description: 'Search for text in the tab identified by wcId; returns { activeMatchOrdinal, matches }. Use findNext:true to step (forward:true/false) through matches; matchCase for case-sensitive. Refuses internal goldfinch:// pages.',
     inputSchema: {
       type: 'object',
       properties: {
         wcId: { type: 'integer', description: 'webContents id of the target tab' },
         text: { type: 'string', description: 'text to search for' },
         forward: { type: 'boolean', description: 'step direction when findNext; default true' },
         findNext: { type: 'boolean', description: 'true = step to next/prev match; false/omitted = new search; default false' },
         matchCase: { type: 'boolean', description: 'case-sensitive match; default false' },
       },
       required: ['wcId', 'text'],
     },
     call: (engine, { wcId, text, forward, findNext, matchCase }) =>
       engine.findInPage(wcId, text, { forward, findNext, matchCase }),
   },
   {
     name: 'stopFindInPage',
     description: 'Clear the find session on the tab identified by wcId (clearSelection). Returns {"ok":true}. Refuses internal goldfinch:// pages.',
     inputSchema: {
       type: 'object',
       properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
       required: ['wcId'],
     },
     call: (engine, { wcId }) => engine.stopFindInPage(wcId),
   },
   ```
   Update the count comment near `:475` (e.g. "15 drive" → "17 drive", total 24 → 26).

6. **`scope.js`.** Append `'findInPage', 'stopFindInPage'` to `WCID_FIRST_OPS`.

7. **Tests — count bumps.** `automation-mcp-tools.test.js:75` `24` → `26`; add
   `findInPage`/`stopFindInPage` to the **drive-names list** (`DRIVE_NAMES`, which feeds
   `ALL_NAMES`) **and** to the `allNames24` local at ~`:76` (the asserted sorted set), plus the
   "24 tools (15 drive + …)" comment at `:71`. `automation-mcp-server.test.js:26`
   `EXPECTED_TOOL_COUNT` `24` → `26`, **and** update the test-name string at `:251`
   (`'… returns 24 tools'` → `'26 tools'`; design-review [medium] — a hardcoded count in the test
   title, misleading though not failing if left). Grep both files for any other literal `24`.

8. **`test/unit/automation-find.test.js`.** Mirror `automation-print.test.js`. Build the fake
   `webContents` on Node's **`EventEmitter`** (simplest — gives real `on`/`removeListener`/`emit`
   semantics) plus `findInPage(text, opts)` (returns an incrementing `requestId`, records opts)
   and `stopFindInPage(action)` (records the action). Drive the stream with `fake.emit(
   'found-in-page', {}, {requestId, activeMatchOrdinal, matches, finalUpdate})` (note the
   2-arg `(event, result)` shape). Pass `deps.findTimeoutMs` small (e.g. 20ms) for the
   timeout-fallback case. Cover AC9, including asserting the listener was removed
   (`fake.listenerCount('found-in-page') === 0`) after resolve **and** after timeout, that a
   non-matching `requestId` event is ignored, and that a non-final stream + expired timeout
   returns the last-seen update.

9. **Do NOT** edit CLAUDE.md, README, or `docs/mcp-automation.md` (leg 3 owns those). **Do NOT**
   commit.

## Edge Cases

- **Synchronous `found-in-page`**: ensure `requestId` is assigned before the handler can compare
  it (declare/assign before `wc.on`, or capture via `var` hoist) so a fast event isn't dropped.
- **`finalUpdate` never fires**: timeout fallback returns the last-seen `{activeMatchOrdinal,
  matches}` (or the zero default if no event arrived).
- **Zero matches**: `found-in-page` reports `matches:0, activeMatchOrdinal:0` with
  `finalUpdate:true` — returned cleanly, not an error (behavior-test step 5 depends on this).
- **Listener leak**: every exit path (resolve, timeout, throw from `findInPage`) must
  `clearTimeout` + `removeListener` in the `finally`/`cleanup`.
- **Internal under admin**: op-local guard refuses even with `allowInternal:true` (AC6).
- **Stale handle after activate**: re-resolve post-activate (AC5).
- **Concurrent UI + MCP find on the same guest**: one Chromium find session per guest,
  last-writer-wins (accepted per DD1). The op only resolves on **its own** `requestId` (handler
  ignores others), so a concurrent UI find cannot corrupt the op's returned count.
- **Chrome-target (non-guest) wcId**: follow the `zoom.js`/`print.js` precedent — **no explicit
  chrome refusal** (design-review Q2). A jar key cannot reach the chrome shell (scope.js enforces
  guest-in-jar); under the admin key, searching the app chrome is harmless and consistent with
  the sibling ops. The foreground-first `activate` branch simply no-ops for a non-guest
  (`classifyContents !== 'guest'`), and `findInPage` runs on the resolved contents directly.

## Files Affected

- `src/main/automation/find.js` *(new)* — the two ops.
- `src/main/automation/engine.js` — import + 2 dispatch entries.
- `src/main/automation/mcp-tools.js` — 2 ToolDefs + count comment.
- `src/main/automation/scope.js` — `WCID_FIRST_OPS` += 2.
- `test/unit/automation-find.test.js` *(new)* — unit tests.
- `test/unit/automation-mcp-tools.test.js` — count + name-list 24 → 26.
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` 24 → 26.

---

## Post-Completion Checklist

**Complete ALL before signaling `[HANDOFF:review-needed]` (review + commit are deferred to the
end of the flight — do NOT commit / do NOT signal `[COMPLETE:leg]`):**

- [ ] All acceptance criteria verified
- [ ] `npm test` green; `npm run lint` + `npm run typecheck` clean
- [ ] Update flight-log.md with this leg's progress entry
- [ ] Set this leg's status to `landed` (in this file's header)
- [ ] Do NOT commit, do NOT touch CLAUDE.md/README/docs (leg 3), do NOT check off the flight
