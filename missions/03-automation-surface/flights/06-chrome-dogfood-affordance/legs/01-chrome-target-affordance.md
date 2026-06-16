# Leg: chrome-target-affordance

**Status**: completed
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

## Objective
Add an admin-only `getChromeTarget` MCP tool that returns the chrome renderer's `wcId` (the missing discovery affordance), and close the partition-collision privilege-escalation hole by adding an explicit chrome-contents exclusion guard to `resolveContentsForJar`.

## Context
- **DD1** (flight): the engine can already drive a chrome `webContents` (`resolve.js:classifyContents` → `'chrome'`; every op skips foreground-to-act for chrome), but **no tool discovers the chrome `wcId`** — `enumerateTabs` lists only guest `<webview>` tabs. A dedicated admin-only `getChromeTarget` tool fills that gap. The operator chose a dedicated tool over an `enumerateTabs` `type:'chrome'` row to keep "tabs" (guest enumeration) and "chrome" (the singular app shell) as distinct concepts and to make the admin-only scoping explicit at the tool boundary.
- **The chrome-contents exclusion (defense-in-depth).** DD1 / the Architect note framed this as plugging a *live* privilege escalation: "the chrome renderer's `webContents` uses `persist:goldfinch` — the same partition as the `default` jar — so a default-jar key presenting the chrome `wcId` would PASS the session check." **The leg-1 design review (2026-06-15) corrected this premise against the code: it is factually wrong.** `mainWindow`'s `webPreferences` (main.js:197-209) specifies **no `partition`/`session`**, so the chrome renderer's `webContents.session === session.defaultSession`; the `default` jar uses `persist:goldfinch` (jars.js:22), a **distinct** Session object, and `jars.js:42` forces every jar partition to match `/^persist:/`, so no jar's session can ever equal `defaultSession`. A `default`-jar key presenting the chrome `wcId` is therefore **already** refused by the existing session check (`out-of-jar`) — there is no live hole. The guard is still worth adding as **defense-in-depth**: object-identity exclusion of the chrome contents is cleaner than relying on session topology, and it pre-empts any future config change that gives the chrome a jar-aliased session. The `getChromeTarget` façade gate (admin-only) is the front door; this guard backstops the wcId-first ops that take a caller-supplied `wcId`. (See flight-log Decisions for the corrected premise.)
- **Pattern to mirror**: `captureWindow` is the existing admin-only op — refused for jar keys at the `scope.js` façade with a **distinct** `automation: admin-only` error (NOT `out-of-jar`), and it throws on a null `mainWindow`. `getChromeTarget` follows the same shape.
- This is the first leg of Flight 6 and a **hard ordering dependency** for `chrome-drive-spike` (leg 2), which needs the tool to obtain a chrome `wcId` before verifying trusted-input/read on the chrome.

## Inputs
What exists before this leg runs (all on `main`, Flight 5 landed):
- `src/main/automation/engine.js` — `createEngine(getMainWindow, { allowInternal })`; `deps()` builds `chromeContents = mw ? mw.webContents : null`.
- `src/main/automation/resolve.js` — `resolveContents` (bad/dead/internal guards) and `resolveContentsForJar` (resolveContents → session-identity membership).
- `src/main/automation/scope.js` — `scopeEngine(engine, identity, ctx)`; admin returns the engine unchanged; jar façade refuses `captureWindow` with admin-only; `WCID_FIRST_OPS` are membership-gated via `resolveContentsForJar`; `memberDeps()` already carries `chromeContents: getChromeContents()`.
- `src/main/automation/mcp-tools.js` — `DRIVE_TOOLS` (12) + `OBSERVE_TOOLS` (4) → `TOOLS` (16); `buildToolRegistry` iterates `TOOLS` for both `listTools` and `callTool`.
- `src/main/automation/mcp-server.js` — per-session `buildServer` wires the registry over `scopeEngine(getEngine({ allowInternal: identity === 'admin' }), identity, scopeCtx)`; the scope ctx already injects `getChromeContents`.
- `docs/mcp-automation.md` — the tool reference + identity/jar-scoping section.
- `tests/behavior/mcp-drive-end-to-end.md` — asserts "exactly 16 tools" with a named list (Step 1), plus "16th tool" / "all-16" wording (intro line 10, Step 9).
- `test/unit/automation-resolve.test.js`, `test/unit/automation-scope.test.js`, `test/unit/automation-mcp-tools.test.js` — existing unit suites to extend.

## Outputs
After this leg completes:
- `engine.js` exposes `getChromeTarget()` returning `{ wcId, kind: 'chrome', url }`, throwing `automation: chrome-window-unavailable — …` when `mainWindow`/`chromeContents` is null.
- `resolve.js` `resolveContentsForJar` rejects the chrome `wcId` for any jar identity with an explicit guard **before** the session check.
- `scope.js` jar façade refuses `getChromeTarget` with a distinct `automation: admin-only` error; admin (unchanged engine) reaches the real `getChromeTarget`.
- `mcp-tools.js` registers a 17th tool `getChromeTarget`; `TOOLS.length === 17`.
- `mcp-drive-end-to-end.md` asserts **17 tools** with `getChromeTarget` in the named list (count-only; the `7777`→port reconcile stays in leg 5 `group-a-port-reconcile`).
- `docs/mcp-automation.md` documents `getChromeTarget` (admin-only).
- New unit tests pass for the affordance + the exclusion guard; full `npm test` + typecheck + lint green.

## Acceptance Criteria
- [x] **AC1** — `engine.getChromeTarget()` returns `{ wcId: <mainWindow.webContents.id>, kind: 'chrome', url: <chrome url> }` when the window is live, and **throws** `automation: chrome-window-unavailable — …` (never a soft `{ wcId: null }`) when `getMainWindow()` is null / `chromeContents` is null.
- [x] **AC2** — `resolveContentsForJar(wcId, jar, deps)` throws when the resolved `wc === deps.chromeContents`, for **any** jar, and the throw fires **before** the session-identity check. The unit test proves this with a **synthetic** fake where `wc === deps.chromeContents` AND `wc.session === deps.fromPartition(jar.partition)` simultaneously — i.e. it demonstrates the guard fires *before*/independent of the session check, without depending on the (false) real-world collision premise. Message reuses `out-of-jar`; the guard is a no-op when `deps.chromeContents` is nullish (`!= null` check).
- [x] **AC3** — Through the jar façade (`scopeEngine(engine, '<jarId>', ctx)`), `getChromeTarget()` throws `automation: admin-only` (NOT `out-of-jar`) and **never reaches the engine**; through the admin path (`scopeEngine(engine, 'admin', ctx)` → engine unchanged) `getChromeTarget()` returns the chrome target.
- [x] **AC4** — `getChromeTarget` is a registered MCP tool: `buildToolRegistry(...).listTools()` includes it with a no-input `inputSchema` (`{ type: 'object', properties: {} }`), and `TOOLS.length === 17`. `callTool('getChromeTarget', {})` over a fake admin engine returns the serialized target; over a fake jar-scoped engine returns `isError` with the admin-only message.
- [x] **AC5** — `tests/behavior/mcp-drive-end-to-end.md` asserts **exactly 17 tools** and lists `getChromeTarget` among the named tools (Step 1, intro line 10, and the Step 9 "Nth tool"/"all-N" wording updated consistently). Port references (`7777`) are **left untouched** (leg 5).
- [x] **AC6** — `docs/mcp-automation.md` documents `getChromeTarget` in the tool reference and notes it is admin-only (jar keys get `automation: admin-only`, mirroring `captureWindow`).
- [x] **AC7** — `npm test`, `npm run typecheck`, and `npm run lint` all pass.

## Verification Steps
- AC1/AC2: `node --test test/unit/automation-resolve.test.js` — new cases green (chrome-exclusion incl. the `default`-jar/partition-collision case; `chrome-window-unavailable` throw).
- AC3: `node --test test/unit/automation-scope.test.js` — new cases green (jar `getChromeTarget` → admin-only, engine not reached; admin → reaches engine).
- AC4: `node --test test/unit/automation-mcp-tools.test.js` — `TOOLS`/`listTools` length 17 + `getChromeTarget` present; `callTool` happy + jar-refusal paths.
- AC5: `grep -n "17 tools\|getChromeTarget" tests/behavior/mcp-drive-end-to-end.md` — count updated, tool listed; `grep -n "16 tools" …` returns nothing.
- AC6: `grep -n "getChromeTarget" docs/mcp-automation.md` — present in the tool reference with the admin-only note.
- AC7: `npm test && npm run typecheck && npm run lint` — all green.

## Implementation Guidance

1. **`resolve.js` — the HIGH security fix (`resolveContentsForJar`).**
   Add the chrome-exclusion guard **after** `resolveContents(...)` (so bad/dead/internal still throw first) and **before** the session-membership check (so the chrome cannot pass via the shared `default` partition):
   ```js
   function resolveContentsForJar(wcId, jar, deps) {
     const wc = resolveContents(wcId, deps); // bad-handle / no-such-contents / internal-session
     // Flight-6 chrome-exclusion (defense-in-depth): refuse the chrome renderer's webContents for
     // ANY jar identity, BEFORE the session check. Today the chrome uses session.defaultSession and
     // no jar partition aliases it (so the session check below already refuses it), but object-
     // identity exclusion is robust against any future config change that gives the chrome a
     // jar-aliased session. Backstops getChromeTarget's admin-only façade gate for the wcId-first ops.
     if (deps.chromeContents != null && wc === deps.chromeContents) {
       throw new Error('automation: out-of-jar — wcId ' + wcId + ' is the chrome renderer and is not drivable by a jar key');
     }
     if (!jar || wc.session !== deps.fromPartition(jar.partition)) {
       throw new Error('automation: out-of-jar — wcId ' + wcId + ' does not belong to jar ' + (jar ? jar.id : '(none)'));
     }
     return wc;
   }
   ```
   - Keep `out-of-jar` as the code (the scope tests already assert `out-of-jar` for refused wcId-ops; the chrome is conceptually "not your jar"). Update the JSDoc guard-order list to mention the chrome exclusion.
   - `deps.chromeContents` is already passed by `scope.js:memberDeps()` and by `resolveContents`'s deps bag — no new threading needed.

2. **`engine.js` — add `getChromeTarget`.**
   Add to the returned ops object (mirror the `captureWindow` null-window discipline; the engine's `deps()` already computes `chromeContents`):
   ```js
   getChromeTarget: () => {
     const mw = getMainWindow();
     const cc = mw ? mw.webContents : null;
     if (!cc) throw new Error('automation: chrome-window-unavailable — mainWindow is null (closed or starting up)');
     return { wcId: cc.id, kind: 'chrome', url: cc.getURL() };
   },
   ```
   - Use the **hyphenated** `chrome-window-unavailable` code (parses cleanly through `mcp-server.js`'s `ERROR_CODE_RE` ` — ` separator into the audit log's `errorCode`), distinct from `captureWindow`'s legacy `chrome window unavailable` string. Do NOT change `captureWindow`'s existing message.
   - `getChromeTarget` reads the window directly (`getMainWindow().webContents`) and does **not** call the engine's `deps()` — it needs no `fromId`/`fromPartition`/`activate` (there's no wcId lookup), mirroring how `observe.captureWindow` uses only `chromeContents`. Keep it a small self-contained op.

3. **`scope.js` — admin-only façade refusal for `getChromeTarget`.**
   Mirror the `captureWindow` refusal exactly (jar façade), placed alongside it:
   ```js
   // getChromeTarget → REFUSED for jar keys with the DISTINCT admin-only message (mirrors
   // captureWindow). The chrome shell is reachable only by the admin identity; defense-in-depth
   // is the resolveContentsForJar chrome-exclusion for any wcId-first op (DD1, Flight 6).
   facade.getChromeTarget = () => {
     requireJar(); // unknown jar errors no-such-jar first, mirroring captureWindow
     throw new Error('automation: admin-only — getChromeTarget (chrome renderer discovery) is restricted to the admin identity');
   };
   ```
   - Admin path needs no change: `scopeEngine` returns the engine unchanged for `identity === 'admin'`, so admin reaches the real `engine.getChromeTarget`.
   - Update the module header comment that currently says driving the chrome "is a Flight-6 affordance" to note the affordance now exists via `getChromeTarget`.

4. **`mcp-tools.js` — register the 17th tool.**
   Add a small dedicated array (keeps the second discovery path explicit) and fold it into `TOOLS`:
   ```js
   /** @type {ToolDef[]} */
   const CHROME_TOOLS = [
     {
       name: 'getChromeTarget',
       description: 'ADMIN ONLY. Return the chrome renderer\'s automation target: { wcId, kind: "chrome", url }. The returned wcId is passed to the drive/observe tools to act on / read the app shell (tab strip, toolbar, menus). Jar keys are refused with automation: admin-only.',
       inputSchema: { type: 'object', properties: {} }, // no-input, mirrors captureWindow's schema (mcp-tools.js:295)
       call: (engine) => engine.getChromeTarget(),
     },
   ];
   const TOOLS = [...DRIVE_TOOLS, ...OBSERVE_TOOLS, ...CHROME_TOOLS];
   ```
   - No result-shaping (`shape`) needed — the `{ wcId, kind, url }` object rides the default JSON-text serialize. Admin-only is enforced at the **scope façade** (the scoped engine throws for jar keys), exactly as `captureWindow` is — do NOT add identity logic in `mcp-tools.js`, and do NOT filter `listTools` (jar keys see the tool listed and get the admin-only refusal only on call, matching `captureWindow`).
   - Update the `TOOLS` assembly comment (currently "12 drive + 4 observe").

5. **`mcp-server.js` — fix the stale "16 tools" comment.**
   The `buildServer` JSDoc says "Build a fresh MCP Server with the **16** tools" — update to 17 so the comment doesn't lie. No logic change (the registry is built from `TOOLS`).

6. **`tests/behavior/mcp-drive-end-to-end.md` — count 16 → 17 (DD1, NOT the port).**
   - Intent paragraph, the greppable string `all 16 MCP tools (12 drive + 4 observe)` → "all 17 MCP tools (12 drive + 4 observe + 1 chrome-discovery)".
   - Step 1 expected result: "**exactly 16 tools**" → "**exactly 17 tools**", and append `getChromeTarget` to the named list.
   - Step 9: "the 16th tool" / "all-16 coverage" wording → keep it internally consistent with 17 (e.g. note `getChromeTarget` is admin-only and exercised in the Flight-6 chrome specs, not necessarily this jar-driven happy-path run — adjust phrasing rather than forcing a 17th happy-path call here). **Do NOT touch `7777`/port strings** — that is leg 5.

7. **`docs/mcp-automation.md` — document the tool AND fix the count strings.**
   - Add `getChromeTarget` to the Tool reference (a short "Admin discovery (1)" subsection or a noted row), and a sentence in the identity/jar-scoping section that it is admin-only (jar keys → `automation: admin-only`, like `captureWindow`). Note the returned `wcId` is then passed to the drive/observe tools.
   - **Also update the two existing count strings** the reviewer found: `docs/mcp-automation.md:16` ("advertises **16 tools** — 12 drive tools and 4 …") and `docs/mcp-automation.md:177` ("All **16 tools** below match …") → 17 each. (These are distinct from the `mcp-server.js` JSDoc and `mcp-tools.js` comment.) `grep -n "16 tools" docs/mcp-automation.md` must return nothing after.

8. **Unit tests.**
   - `automation-resolve.test.js`: add after the existing `resolveContentsForJar` block —
     (a) chrome `wc === deps.chromeContents` whose session **also** matches the jar (the `default`-partition collision) → throws `out-of-jar` (proves the guard fires before/independent of the session check);
     (b) nullish `deps.chromeContents` → guard is a no-op (a normal in-jar guest still resolves).
   - `automation-scope.test.js`: add beside the `captureWindow` admin-only test —
     (a) jar `getChromeTarget()` → throws `admin-only`, NOT `out-of-jar`, engine not reached (assert `engine.__calls.length === 0` like the captureWindow test);
     (b) admin (`scopeEngine(engine, 'admin', ctx)`) `getChromeTarget()` → reaches the engine and returns its value.
     Add `engine.getChromeTarget = …` to the fake engine in the test's setup.
   - `automation-mcp-tools.test.js`: `listTools().length === 17` and includes `getChromeTarget`; `callTool('getChromeTarget', {})` over a fake engine returning a target → serialized ok result; over a fake engine whose `getChromeTarget` throws admin-only → `isError` with the message. **Note**: the existing `makeFakeEngine` helper auto-generates ops only over its `ALL_NAMES` (drive + observe) list, so it will NOT include `getChromeTarget` — use a plain object `{ getChromeTarget: () => target }` (and `{ getChromeTarget: () => { throw new Error('automation: admin-only — …'); } }`) for these two cases rather than `makeFakeEngine`.

## Edge Cases
- **Null `mainWindow`** (closed / startup): `getChromeTarget` throws `chrome-window-unavailable` — never a soft `{ wcId: null }` (AC1). Mirrors `captureWindow`'s null-throw.
- **Chrome-exclusion fires before/independent of the session check**: proven by the synthetic AC2 test where `wc === chromeContents` AND the session also matches the jar. (Note: this collision is synthetic — in real code the chrome uses `defaultSession`, which no jar aliases, so the session check alone already refuses it. The guard is defense-in-depth; the test pins the ordering guarantee.)
- **Unknown/revoked jar calling `getChromeTarget`**: `requireJar()` throws `no-such-jar` before the admin-only throw (mirrors `captureWindow`) — acceptable; both are refusals.
- **`listTools` exposure**: jar keys DO see `getChromeTarget` in discovery (no list filtering) and get the admin-only refusal only at call time — matches the `captureWindow` precedent. Do not over-engineer list filtering.
- **Nullish `deps.chromeContents` in `resolveContentsForJar`**: guard must be `!= null` so a test/edge with no chrome injected doesn't falsely match (`undefined === undefined` would misfire without the null check).

## Files Affected
- `src/main/automation/resolve.js` — chrome-exclusion guard in `resolveContentsForJar` + JSDoc.
- `src/main/automation/engine.js` — `getChromeTarget` op.
- `src/main/automation/scope.js` — jar façade `getChromeTarget` admin-only refusal + header comment update.
- `src/main/automation/mcp-tools.js` — `CHROME_TOOLS` / `getChromeTarget` tool def; `TOOLS` (→17) + comment.
- `src/main/automation/mcp-server.js` — "16 tools" → "17 tools" comment.
- `tests/behavior/mcp-drive-end-to-end.md` — tool count 16 → 17 + `getChromeTarget` in list (NOT the port).
- `docs/mcp-automation.md` — `getChromeTarget` admin-tool documentation.
- `test/unit/automation-resolve.test.js` — chrome-exclusion + null-chrome cases.
- `test/unit/automation-scope.test.js` — jar refusal + admin-reaches cases.
- `test/unit/automation-mcp-tools.test.js` — 17-tool registry + callTool paths.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` + typecheck + lint)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] (Not the final leg — no flight-landing steps here)
- [ ] (Flight-6 batches review/commit to flight end — do NOT commit per-leg)

## Citation Audit
Source citations verified against current code at leg design time (2026-06-15): `resolve.js:resolveContents`/`resolveContentsForJar`, `engine.js:deps()` chromeContents, `scope.js:memberDeps`/`captureWindow` façade/`WCID_FIRST_OPS`, `mcp-tools.js:TOOLS` (length 16 confirmed)/`buildToolRegistry`, `mcp-server.js:buildServer` ("16 tools" JSDoc), `observe.js:captureWindow` null-throw, and the three unit suites — all OK (content matches). `tests/behavior/mcp-drive-end-to-end.md` "exactly 16 tools" (Step 1, intent paragraph, Step 9) confirmed present — a target of this leg.

**Design-review correction (2026-06-15)**: the Architect/DD1 "partition collision" security premise was checked against the code and found **factually incorrect** — `mainWindow` (main.js:197-209) carries no `partition`, so the chrome renderer uses `session.defaultSession`; the `default` jar uses `persist:goldfinch` (jars.js:22), a distinct session, and `jars.js:42` forbids any jar from aliasing a non-`persist:` session. No live escalation exists; the chrome-exclusion guard is retained as **defense-in-depth**. Context, AC2, implementation step 1, and Edge Cases reframed accordingly. Two additional `16 tools` strings (`docs/mcp-automation.md:16`,`:177`) and a `makeFakeEngine` test-helper gap were added to scope per the review. Recorded in the flight-log Decisions.
