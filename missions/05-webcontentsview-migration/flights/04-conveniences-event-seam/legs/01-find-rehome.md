# Leg: find-rehome

**Status**: completed
**Flight**: [Conveniences & Event-Seam Re-architecture](../flight.md)

## Objective

Re-home the automation `findInPage` / `stopFindInPage` MCP ops in `src/main/automation/find.js` from the
dead Deviation-D1 renderer-injection (`querySelectorAll('webview')`) to operate directly on the guest
`WebContentsView`'s `webContents`, correlating results on the Electron `found-in-page` `requestId`; and
rewrite the injection-coupled unit test to the event-listener model.

## Context

- **Flight DD1 (find re-home, narrowed by design review).** The D1 injection existed *only* because an
  Electron `<webview>` never delivered `found-in-page` to a main-process `webContents`. That reason is
  structurally gone: guests are now `WebContentsView`s whose `webContents` already emit `found-in-page`
  to main — **proven in production since Flight 3**, where the user find bar already runs through it
  (`tab-find` IPC `main.js:1499` → `wc.findInPage()` → the permanent `found-in-page` listener
  `main.js:670` → `tab-found-in-page` → `renderer.js:2787`).
- **The user find bar needs NO change.** It is already on the migrated path. This leg touches *only* the
  automation ops in `find.js` and their unit test. (The bar's `runFind` at `renderer.js:2092` and its
  stale `tab.trusted` guard at `:2099` are **Leg 2**'s active-view-consolidation concern — out of scope
  here.)
- **Listener model (decided, DD1).** Do **not** resolve on *any* `found-in-page`. Correlate on the
  Electron `requestId`: `wc.findInPage(text, opts)` returns the `requestId`, and the `found-in-page`
  event's `result` carries it. A find op honors only events whose `result.requestId` is one it issued —
  so concurrent finds (e.g. the user bar firing at the same time, which the permanent `main.js:670`
  listener also services) are never misattributed.
- **Cold-start retry must be ported, not dropped.** The current injected script resolves only on
  `finalUpdate===true && matches>0`, re-issuing the find on a `finalUpdate:true, matches:0` cold-start
  spurious event (every 500 ms, up to 5 attempts, within the timeout), falling back to `last` on
  timeout. That logic must move from the deleted renderer script into the main-process op so the
  WSLg cold-start quirk stays handled. (Whether the quirk still reproduces under `WebContentsView` is a
  flight Open Question re-verified live in Leg 4's `find-in-page` Witnessed run — porting the retry keeps
  correctness regardless of the answer.)
- **Security invariant (DD5) is preserved, not widened.** Both ops keep the op-local
  `isInternalContents` guard *after* `resolveContents`, so internal `goldfinch://` pages are refused even
  under the admin engine's `allowInternal:true`. Jar-scope resolution is unchanged.

## Inputs

- `src/main/automation/find.js` — current injection-based ops (D1). `findInPage` at `:85`,
  `stopFindInPage` at `:158`; the two `querySelectorAll('webview')` injections at `:120` and `:170`.
- `src/main/automation/resolve.js` — `resolveContents` / `isInternalContents` / `classifyContents`
  (unchanged; consumed as-is).
- `src/main/automation/engine.js:96-97` — wires `findInPage` / `stopFindInPage` via `deps()`
  (`{ fromId, chromeContents, executeInRenderer, allowInternal, fromPartition, grabWindow, activate }`).
  The guest `webContents` is obtained inside the op via `resolveContents(wcId, deps)` (`deps.fromId` =
  `webContents.fromId`). **No new dep is required** — the op already resolves the live guest `wc`.
- `src/main/main.js:670` — the permanent `found-in-page` listener (forwards to the chrome find bar);
  stays untouched. This leg's op adds its own correlated listener on the same `wc`; both coexist.
- `test/unit/automation-find.test.js` — ~573 lines, asserts the injected code string; must be rewritten.
- `tests/behavior/find-in-page.md` — the behavior spec with the WSLg cold-start known-issue note
  (`:9-14`) and a D1 reference; the note is rewritten to the new surface.

## Outputs

- `find.js` with both ops re-homed to the guest `wc` (no `querySelectorAll('webview')`, no
  `getWebContentsId`, no `chromeContents.executeJavaScript` injection); `requestId`-correlated result
  with cold-start retry; jar + internal guards intact.
- `test/unit/automation-find.test.js` rewritten to the event-listener model, green.
- `tests/behavior/find-in-page.md` note rewritten to the main-process `found-in-page` surface.
- `grep -rn "querySelectorAll('webview')" src/` returns nothing.

## Acceptance Criteria

- [x] `findInPage(wcId, text, deps, opts)` calls `wc.findInPage(text, { forward, findNext, matchCase })`
  on the guest `webContents` resolved via `resolveContents`, captures the returned `requestId`, and
  resolves `{ activeMatchOrdinal, matches }` from the `found-in-page` event whose
  `result.requestId` matches one it issued.
- [x] Events whose `result.requestId` is **not** one this call issued are ignored (concurrent-find
  correlation — verified by a unit test that emits a foreign `requestId` and asserts no premature
  resolve).
- [x] Cold-start retry preserved: the op resolves only on `finalUpdate===true && matches>0`; on a
  `finalUpdate:true, matches:0` event it records `last` and re-issues the find (≤5 attempts, ~500 ms
  cadence) within `findTimeoutMs` (default 3000); on timeout it resolves `last`. A genuine no-match
  resolves `{0,0}` cleanly (not an error).
- [x] The per-call `found-in-page` listener is removed on resolve **and** on timeout (no listener leak),
  and the retry interval/timeout are cleared.
- [x] `stopFindInPage(wcId, deps)` calls `wc.stopFindInPage('clearSelection')` on the guest `wc` and
  returns `{ ok: true }`.
- [x] Op-local internal-session refusal preserved for **both** ops even under `allowInternal:true`
  (`wc.findInPage` / `wc.stopFindInPage` never called for an internal `wc`); refusal fires **before**
  the foreground-first `activate`.
- [x] Foreground-first discipline preserved for guest tabs (`activate` then re-resolve before issuing
  the find); `bad-handle` / `no-such-contents` still surface via `resolveContents`.
- [x] `grep -rn "querySelectorAll('webview')" src/` and `grep -rn "getWebContentsId" src/` return
  nothing.
- [x] `test/unit/automation-find.test.js` rewritten to the event model — no assertions on an injected
  code string, no `new Function(code)` parse guards, no `userGesture` / `chromeContents`-required
  assertions for these ops. `npm test` green.
- [x] `tests/behavior/find-in-page.md` known-issue note rewritten to describe the main-process
  `found-in-page` surface (no `<webview>` / D1 framing); the unit-proven internal-refusal reference
  (`:63`) still points at the rewritten test.
- [x] `npm run typecheck` and `npm run lint` green.

## Verification Steps

- `grep -rn "querySelectorAll('webview')\|getWebContentsId" src/` → no output.
- `node --test test/unit/automation-find.test.js` (or `npm test`) → all find tests pass.
- `npm run typecheck` → no new errors. `npm run lint` → clean.
- Live `findInPage` match-count behavior is re-verified in **Leg 4** (`/behavior-test find-in-page`)
  on the live MCP surface — that run is where the WSLg cold-start re-verify happens; not required to
  launch the app in this leg.

## Implementation Guidance

1. **Rewrite `findInPage` (`find.js:85`).** Keep the prologue: `resolveContents` → `isInternalContents`
   refusal → foreground-first `activate`. **Make the post-activate re-resolve a reassignment** —
   `wc = resolveContents(wcId, deps);` after `await deps.activate(wcId)` (the current code at `:94`
   *discards* the re-resolve and reuses the stale pre-activate handle; do not carry that bug forward —
   the rewritten op must issue the find on the re-resolved handle). The unit test's `resolved===2`
   double-`fromId` assertion still holds. Then, instead of building and injecting a code string:
   - Operate on the resolved guest `wc` directly.
   - `const opts = { forward, findNext, matchCase };`
   - Implement a `requestId`-correlated promise:
     ```js
     return await new Promise((resolve) => {
       const RETRY = 500, MAX = 5;
       const issued = new Set();
       let last = { activeMatchOrdinal: 0, matches: 0 };
       let attempts = 0, done = false, iv = null, to = null;
       const cleanup = () => { if (iv) clearInterval(iv); if (to) clearTimeout(to); wc.removeListener('found-in-page', onFound); };
       const finish = (v) => { if (done) return; done = true; cleanup(); resolve(v); };
       function onFound(_e, result) {
         if (!result || !issued.has(result.requestId)) return;        // requestId correlation
         last = { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches };
         if (result.finalUpdate === true && result.matches > 0) finish(last);  // cold-start: resolve only on nonzero
       }
       const issue = () => { attempts++; issued.add(wc.findInPage(text, opts)); };  // same opts on retry (no findNext flip)
       wc.on('found-in-page', onFound);
       issue();
       iv = setInterval(() => { if (done) return; if (attempts >= MAX) { finish(last); return; } issue(); }, RETRY);
       to = setTimeout(() => finish(last), timeoutMs);
     });
     ```
   - **MAX-retry exhaustion resolves `last`** (the `attempts >= MAX` branch calls `finish(last)`, not a
     bare `return`) — so exhausting retries is equivalent to the timeout fallback and the interval does
     not busy-spin doing nothing until the timeout fires (review fix).
   - Return `{ activeMatchOrdinal: res.activeMatchOrdinal || 0, matches: res.matches || 0 }` — keep the
     `!result` guard in `onFound` (Electron always emits a `result`, but it is cheap robustness).
   - Note: each `issue()` (initial + retries) gets a fresh `requestId` from Electron — add each to
     `issued` so a late event from an earlier retry attempt still correlates. Re-issues reuse the
     caller's original `opts` (do **not** force `findNext:true` on retry — that corrupts the ordinal).
2. **Rewrite `stopFindInPage` (`find.js:158`).** Keep `resolveContents` → `isInternalContents` refusal,
   then `wc.stopFindInPage('clearSelection')`; return `{ ok: true }`.
3. **Drop the `chromeContents`-required throws** in both ops (`:97-99`, `:164-166`) — the ops no longer
   route through the chrome renderer. `classifyContents(wc, deps.chromeContents)` in the foreground-first
   block: when `chromeContents` is null it returns `'guest'` (`wc === null` is false) — this is correct,
   the guest path always activates, which is safe and conservative. Do **not** add a null-guard that
   would skip the activate. **`engine.js` is NOT modified in this leg** — `deps.chromeContents` stays in
   the `deps()` object for the other ops that still use it; `find.js` simply ignores it.
4. **Rewrite the module/function header comments** in `find.js` — replace the D1 "renderer-routed find"
   narrative with the main-process `found-in-page` + `requestId`-correlation model. Keep the SECURITY
   (DD5), FOREGROUND-FIRST, ELECTRON-FREE, and cold-start-retry rationale notes (updated to the new
   surface). Keeping `find.js` electron-free is intact — `wc` arrives via injected `deps.fromId`; the op
   only uses `wc`'s EventEmitter + find methods, never `require('electron')`.
5. **Rewrite `test/unit/automation-find.test.js`.** Replace the fake-chromeContents strategy with a fake
   guest `wc` that is an event emitter and records find calls:
   - `makeFakeWc(id, { internal })` returns `{ id, session:{__goldfinchInternal:internal},
     isDestroyed(){return false}, _finds:[], _stops:[], findInPage(text,opts){ this._finds.push({text,opts});
     return ++this._reqId; }, stopFindInPage(action){ this._stops.push(action); }, on/removeListener/emit }`
     — back the emitter with `node:events` `EventEmitter` (or a tiny handler array). Add a helper to emit
     a `found-in-page` with a chosen `{ requestId, activeMatchOrdinal, matches, finalUpdate }`.
   - Port these behaviors as tests (drop all injected-string / parse / userGesture / chromeContents-missing
     tests): resolves correlated counts on a matching-`requestId` final event; **ignores a foreign
     `requestId`** then resolves on the matching one; **cold-start** — a `finalUpdate:true,matches:0`
     event does not resolve, a re-issue happens (assert `wc._finds.length` grows), a later `matches>0`
     event resolves the real count; **timeout fallback** resolves `last` when no qualifying event arrives
     (use a small `findTimeoutMs` and/or `node:test` mock timers — prefer `t.mock.timers.enable({apis:['setInterval','setTimeout']})` so the test is deterministic and fast); **listener cleanup** —
     `removeListener` called on both resolve and timeout (assert `wc.listenerCount('found-in-page')===0`
     after); opts threading — `wc._finds[0].opts` deep-equals `{forward,findNext,matchCase}`;
     internal-session refusal for both ops under `allowInternal:true` (assert `wc._finds.length===0` /
     `wc._stops.length===0` and `activate` not called); foreground-first activate-before-find + double
     re-resolve; `bad-handle` / `no-such-contents`; `stopFindInPage` calls `wc.stopFindInPage('clearSelection')`
     and returns `{ok:true}`.
6. **Rewrite the `find-in-page.md` note (`:9-14`).** Re-frame the WSLg cold-start known issue to the
   main-process surface: the first `findInPage` on a freshly-loaded guest *may* return `{0,0}` (Chromium
   cold-start); the op now re-issues on a zero `finalUpdate` via the main-process `requestId`-correlated
   retry. Drop the `<webview>` / "Flight-2 Deviation D1" framing. Note that whether the quirk still
   reproduces under `WebContentsView` is re-verified by this run on the new surface. Leave the engine /
   stepping / jar-scoping assertions and the `:63` internal-refusal reference intact (the rewritten unit
   test still proves it).

## Edge Cases

- **Permanent listener coexistence.** When the MCP op issues `wc.findInPage()`, the permanent
  `main.js:670` listener also fires and forwards that result to the chrome find bar — so a programmatic
  find may momentarily reflect in the user's bar UI. This is a benign cosmetic side effect, out of
  scope for this leg (the DD1 "bar undisturbed" requirement is about not *breaking* the bar, which holds).
  Do **not** attempt to suppress the permanent forward.
- **Empty `text`.** `wc.findInPage('')` is invalid in Electron. The existing ops were always called with
  non-empty text from `mcp-tools.js`; preserve current behavior (no special-casing required unless a
  test reveals a throw — if so, short-circuit to `{0,0}` like the old `!wv` path did).
- **Concurrent retries.** Multiple in-flight `issue()` calls each add a `requestId` to `issued`; the
  first `finalUpdate && matches>0` for any of them resolves and `cleanup()` removes the listener — later
  stray events are ignored (listener already detached).
- **Stale handle after activate.** Keep the post-activate `resolveContents` re-resolve so a recreated
  guest handle is used (existing discipline) — and **use** its result (reassign `wc`).
- **`stopFindInPage` on a handle destroyed mid-find** now surfaces `automation: no-such-contents` from
  `resolveContents` (the old renderer-routed path returned `{ok:true}` silently via its `!wv` branch).
  This is a deliberate, minor behavior change that makes find consistent with every other wcId-first op;
  acceptable.
- **No `userGesture` analog needed.** The old path passed `executeJavaScript(code, true)`; the
  main-process `wc.findInPage()` has no `userGesture` parameter and needs none — there is no renderer
  gesture gate on a main-process find.
- **Concurrent-find listener hygiene (test).** In the foreign-`requestId` test, assert exactly one
  `found-in-page` listener is attached during the find (`wc.listenerCount('found-in-page') === 1`) — this
  catches a sloppy implementation that attaches a fresh listener per retry instead of reusing `onFound`.

## Files Affected

- `src/main/automation/find.js` — both ops re-homed to the guest `wc`; injection + `chromeContents`
  routing removed; header comments rewritten.
- `test/unit/automation-find.test.js` — rewritten to the event-listener model.
- `tests/behavior/find-in-page.md` — known-issue note + D1 reference re-framed to the new surface.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(Note: under the agentic-workflow
deferred-commit model, the Developer does NOT commit per-leg — leg lands uncommitted; the Flight
Director commits after the last autonomous leg. Update artifacts and signal `[HANDOFF:review-needed]`.)*

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` / `typecheck` / `lint`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (in this file's header)
- [ ] Check off this leg in flight.md

---

## Citation Audit

All code-location citations verified against current code on `flight/04-conveniences-event-seam` at leg
design time:

- `find.js:85` (findInPage), `:120`/`:170` (`querySelectorAll('webview')`), `:158` (stopFindInPage),
  `:97-99`/`:164-166` (chromeContents-required throws) — **OK**.
- `main.js:670` (permanent `found-in-page` listener), `:1499` (`tab-find` IPC) — **OK**.
- `renderer.js:2787` (`onTabFoundInPage`), `:2092` (`runFind`), `:2099` (`tab.trusted` guard — Leg 2) —
  **OK**.
- `engine.js:96-97` (find op wiring) — **OK**.
- `resolve.js` `resolveContents`/`isInternalContents`/`classifyContents` — **OK** (symbol-form).
- `tests/behavior/find-in-page.md:9-14` (WSLg note), `:63` (internal-refusal reference) — **OK**.
- `test/unit/automation-find.test.js` (~573 lines, injected-string strategy) — **OK** (to be rewritten).
