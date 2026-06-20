# Leg: downloads-mcp-tool

**Status**: completed
**Flight**: [Downloads Surface](../flight.md)

## Objective

Expose the app-level downloads list to the automation surface as the **read-only, admin-only**
`downloadsList` MCP tool: add a `getDownloadsList()` engine op (returning `downloadsManager.listAll()`),
gate it **admin-only via an explicit jar-façade refusal block** in `scope.js` (mirroring `getChromeTarget`),
add the dedicated **jar-refused** + **admin-returns-list** tests (the three-place guard does NOT cover
app-level ops), and bump the **tool count 26 → 27** across the code + test ref sites.

## Context

- **DD6** — `downloadsList` is **app-level** (no `wcId`), **admin-only**, **read-only**. It must **NOT** be
  added to `WCID_FIRST_OPS` (it's not a wcId-first op). For a jar identity, `scopeEngine` builds a façade
  of only the explicitly-named ops; an op merely *left out* resolves to `undefined` and the MCP dispatch
  throws the **opaque `"engine.getDownloadsList is not a function"`** (the documented gap at
  `scope.js:38`-`:43`). So the refusal must be an **explicit façade block** mirroring `getChromeTarget`
  (`scope.js:168`-`:171`), and a **dedicated jar-refused unit test** is required because the three-place
  registration guard (`automation-scope.test.js:211`) only iterates `WCID_FIRST_OPS`.
- **Depends on leg 1** (landed): the module-scoped `downloadsManager` with `listAll()` returning merged
  records `{ id, url, filename, savePath, state, received, total, mime?, startTime, endTime?, ... }`.
- **Template**: `getChromeTarget` — the existing admin-only, app-level (`wcId`-less) tool. Engine op
  `engine.js:91`-`:96`; scope refusal `scope.js:168`; CHROME_TOOLS def `mcp-tools.js:493`-`:499`; tests
  `automation-mcp-tools.test.js:798`-`:831` (listed / admin-returns / jar-refused) and the scope refusal
  pattern (`captureWindow`/`getChromeTarget`).
- **Out of scope**: acting controls (pause/cancel/retry) are **not** exposed to automation this flight
  (SC8 asks for the *list* only). **Docs** (CLAUDE.md prose tool list, `docs/mcp-automation.md`) are owned
  by **leg 6** — this leg bumps only the **code + unit-test** count ref sites (the tests fail the moment
  the tool lands otherwise).

## Inputs

What exists before this leg runs:
- `src/main/automation/engine.js:32` `createEngine(getMainWindow, { allowInternal } = {})` — builds the
  engine; `:91`-`:96` `getChromeTarget` is the app-level op template. Called at **`main.js:150`**
  (`getEngine: (engineOpts) => createEngine(() => mainWindow, engineOpts)`) and **`main.js:1371`**
  (`createEngine(() => mainWindow)` — a dev/smoke path).
- `src/main/automation/scope.js:44` `WCID_FIRST_OPS` (downloadsList must NOT join it); `:76` `scopeEngine`
  (admin → engine unchanged, `:78`); `:97` `requireJar`; `:149` `captureWindow` refusal, `:168`
  `getChromeTarget` refusal — the two app-level admin-only refusal templates; `:38`-`:43` the gap doc.
- `src/main/automation/mcp-tools.js:493`-`:499` `CHROME_TOOLS` (currently just `getChromeTarget`); `:503`
  the tool-count comment ("chrome-discovery = 26 …"); `:505` `TOOLS = [...DRIVE, ...OBSERVE, ...DEVTOOLS,
  ...CHROME_TOOLS]`; `:524`/`:531` `buildToolRegistry`/`listTools`; `:66` `okResult` (default JSON-text
  serialize); `:549`-`:552` dispatch (`def.shape ? … : okResult(value)`).
- `src/main/main.js` — module-scoped `downloadsManager` (leg 1), `listAll()` available; `:150` the
  `getEngine` factory; `:1371` the dev createEngine.
- **Tool-count ref sites (current value 26):**
  - `src/main/automation/mcp-tools.js:503` comment.
  - `test/unit/automation-mcp-tools.test.js:72` (test title "26 tools …"), `:76` `assert.equal(tools.length,
    26)`, `:77` `allNames26 = [...ALL_NAMES, 'getChromeTarget']`, `:78` `assert.deepEqual(... .sort())`.
  - `test/unit/automation-mcp-server.test.js:26` `EXPECTED_TOOL_COUNT = 26`, plus the `:251` test-title
    string "returns 26 tools".
- `test/unit/automation-scope.test.js:149`-onwards (captureWindow/getChromeTarget refusal tests), `:211`
  (the wcId-first three-place guard — does NOT cover app-level ops).

## Outputs

What exists after this leg completes:
- `src/main/automation/engine.js` — `getDownloadsList` op + a `getDownloads` accessor param threaded in.
- `src/main/main.js` — both `createEngine` call sites pass `() => downloadsManager.listAll()`.
- `src/main/automation/scope.js` — `facade.getDownloadsList` admin-only refusal block (jar identity).
- `src/main/automation/mcp-tools.js` — `downloadsList` ToolDef in `CHROME_TOOLS`; count comment 26 → 27.
- `test/unit/automation-mcp-tools.test.js` — count 26 → 27, name set + `downloadsList`, the category
  comment; new listed / admin-returns / jar-refused tests for `downloadsList`.
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` 26 → 27 + the title string.
- `test/unit/automation-scope.test.js` — new dedicated test: jar identity refuses `getDownloadsList`
  (admin-only); admin passes it through.

## Acceptance Criteria

- [ ] **Engine op**: `engine.getDownloadsList()` returns the app-level records (`downloadsManager.listAll()`),
  wired via a `getDownloads` accessor injected into `createEngine`; it takes **no `wcId`**. If the accessor
  is absent it throws a clean `automation: downloads-unavailable` (not a null-deref).
- [ ] **NOT wcId-first**: `getDownloadsList` is **absent** from `WCID_FIRST_OPS`; the three-place guard
  (`automation-scope.test.js:211`) still passes (it only covers wcId-first ops, and downloadsList isn't a
  registered wcId-first tool).
- [ ] **Admin-only via explicit façade refusal**: for a jar identity, `scopeEngine(engine, jarId,
  ctx).getDownloadsList()` throws a **distinct admin-only error** (`automation: admin-only — downloadsList
  …`), mirroring `getChromeTarget` (`scope.js:168`). For `identity === 'admin'` the engine is returned
  unchanged so `getDownloadsList()` passes through.
- [ ] **MCP tool**: `downloadsList` is in `CHROME_TOOLS` with `inputSchema: { type: 'object', properties:
  {} }` (no input) and `call: (engine) => engine.getDownloadsList()`; default `okResult` JSON-text
  serialization (no custom `shape`). `listTools()` includes it with only `{ name, description,
  inputSchema }` (no `call`/`shape` leak).
- [ ] **Tool count 26 → 27** updated in: `mcp-tools.js:503` comment; `automation-mcp-tools.test.js`
  (length + name set + category breakdown comment); `automation-mcp-server.test.js` `EXPECTED_TOOL_COUNT`
  + the test-title string. (CLAUDE.md / `docs/mcp-automation.md` are **leg 6**.)
- [ ] **New tests**: (a) scope — jar refused / admin pass-through for `getDownloadsList`; (b) mcp-tools —
  `downloadsList` listed with no-input schema + no leak; (c) mcp-tools — `callTool('downloadsList', {})`
  over a fake admin engine returns the serialized records; (d) mcp-tools — `callTool('downloadsList', {})`
  over a jar-scoped engine (throws admin-only) → `isError` with the message.
- [ ] `node --test test/unit/*.test.js` passes (all updated + new tests); `npm run typecheck` + `npm run
  lint` clean.

## Verification Steps

- `node --test test/unit/automation-scope.test.js` — jar `getDownloadsList` → admin-only throw; admin
  pass-through; the three-place guard still green.
- `node --test test/unit/automation-mcp-tools.test.js` — 27-tool count + name set incl. `downloadsList`;
  the listed/admin-returns/jar-refused `downloadsList` tests pass.
- `node --test test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT === 27`; tools/list returns
  27.
- `node --test test/unit/*.test.js` && `npm run typecheck` && `npm run lint` — all clean.
- Live (deferred to leg 6 behavior test): admin key `downloadsList` returns records; jar key refused.

## Implementation Guidance

1. **Engine op (`engine.js`).** Fold the accessor into the **opts bag** (cleaner than a 3rd positional
   param — avoids a `{}` placeholder at the dev call site): `function createEngine(getMainWindow, {
   allowInternal = false, getDownloads = null } = {})`. Add to the returned object (beside
   `getChromeTarget`, `:91`):
   ```js
   getDownloadsList: () => {
     if (typeof getDownloads !== 'function') {
       throw new Error('automation: downloads-unavailable — downloads manager not wired');
     }
     return getDownloads();
   },
   ```
   (Field named `getDownloads` to avoid shadowing the op name `getDownloadsList`.)
2. **Thread the accessor (`main.js`).** At `:150`:
   `getEngine: (engineOpts) => createEngine(() => mainWindow, { ...engineOpts, getDownloads: () => downloadsManager.listAll() })`
   (spread so the `{ allowInternal: identity==='admin' }` from mcp-server is preserved). At `:1371` (dev
   path): `createEngine(() => mainWindow, { getDownloads: () => downloadsManager.listAll() })`. The closure
   is lazy — `downloadsManager` is assigned at store-load in `app.whenReady` (leg 1, ~`main.js:1335`),
   strictly before the MCP server starts and before the dev seam registers, so no dispatch can precede
   assignment (confirmed in design review).
3. **Scope refusal (`scope.js`).** Add beside `getChromeTarget` (`:168`), inside the jar façade build (NOT
   in `WCID_FIRST_OPS`):
   ```js
   // downloadsList → REFUSED for jar keys (admin-only, app-level — mirrors getChromeTarget/captureWindow).
   // An app-level cross-jar view is an admin capability; a jar key must not learn what other jars
   // downloaded ("new tools must not widen the surface's reach", DD6). Explicit block, NOT a WCID_FIRST_OPS
   // omission — the latter throws the opaque "engine.getDownloadsList is not a function" (the scope.js:38 gap).
   facade.getDownloadsList = () => {
     requireJar(); // unknown jar errors no-such-jar first, mirroring captureWindow/getChromeTarget
     throw new Error('automation: admin-only — downloadsList (app-level downloads view) is restricted to the admin identity');
   };
   ```
4. **MCP ToolDef (`mcp-tools.js`).** Add to `CHROME_TOOLS` (`:493`):
   ```js
   {
     name: 'downloadsList',
     description: 'List the app-level downloads (in-progress + completed history). Admin-only.',
     inputSchema: { type: 'object', properties: {} }, // no input, mirrors getChromeTarget
     call: (engine) => engine.getDownloadsList(),
   },
   ```
   Update the `:503` count comment (26 → 27; note CHROME_TOOLS now has 2: `getChromeTarget` +
   `downloadsList`, both admin-only via the scope façade).
5. **Tests.**
   - `automation-scope.test.js`: a dedicated test mirroring the `getChromeTarget` admin-only scope test —
     build a jar-scoped façade and assert `facade.getDownloadsList()` throws `/admin-only — downloadsList/`;
     assert `scopeEngine(engine, 'admin', ctx) === engine` already covers admin pass-through (or assert
     `getDownloadsList` is callable on the admin path). Keep it OUTSIDE the `WCID_FIRST_OPS` iteration.
   - `automation-mcp-tools.test.js`: bump `:76` to `27`, add `'downloadsList'` to the expected name set
     (`:77`), update the `:72` title + the category breakdown comment ("… + 2 chrome/app-admin
     (getChromeTarget + downloadsList)"). Add three tests mirroring `getChromeTarget` (`:798`/`:809`/`:818`):
     `downloadsList` listed with no-input schema + no leak; `callTool('downloadsList', {})` over a fake
     admin engine `{ getDownloadsList: () => [records] }` returns the serialized records; `callTool` over a
     jar engine `{ getDownloadsList: () => { throw new Error('automation: admin-only — downloadsList …') } }`
     → `isError` with the message.
   - `automation-mcp-server.test.js`: `EXPECTED_TOOL_COUNT = 27` (`:26`); update the `:251` title string
     "returns 27 tools". **Also add `'downloadsList'` to the `nullOps` audit-detail array (`:1210`)** so
     its no-args → null audit detail is asserted for parity with `getChromeTarget`/`captureWindow` (it
     won't fail if omitted — `deriveAuditDetail` defaults to null — but every sibling tool is covered).

## Edge Cases

- **Empty list**: `downloadsManager.listAll()` returns `[]` when nothing has downloaded — the tool returns
  an empty array (valid; the behavior test's baseline step expects this).
- **downloadsManager not yet assigned**: can't happen at dispatch time (assigned at store-load before the
  surface accepts calls), but the `downloads-unavailable` guard covers a misconfigured dev path
  (`main.js:1371` if not threaded).
- **Record serialization**: records are plain JSON-serializable objects (no `DownloadItem` handles —
  `listAll` returns data records, not live items), so `okResult`'s `JSON.stringify` is safe.
- **Admin engine + allowInternal**: orthogonal — `getDownloadsList` ignores `allowInternal` (it's
  app-level, reads the manager, touches no session). No internal-session concern.

## Files Affected

- `src/main/automation/engine.js` — `getDownloadsList` op + `getDownloads` param.
- `src/main/main.js` — thread `() => downloadsManager.listAll()` at both `createEngine` call sites
  (`:150`, `:1371`).
- `src/main/automation/scope.js` — `facade.getDownloadsList` admin-only refusal.
- `src/main/automation/mcp-tools.js` — `downloadsList` ToolDef + `:503` count comment.
- `test/unit/automation-mcp-tools.test.js` — count/name/category + 3 new `downloadsList` tests.
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` + title string + `downloadsList` in
  the `nullOps` audit-detail array (`:1210`).
- `test/unit/automation-scope.test.js` — new jar-refused / admin-pass `getDownloadsList` test.
- *(CLAUDE.md prose tool list + `docs/mcp-automation.md` — **leg 6's** scope; not edited here.)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`, `npm run typecheck`, `npm run lint`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 4 of 6)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

All citations verified clean against current code at leg design time (read directly this session):
`engine.js:32` (`createEngine`), `:91`-`:96` (`getChromeTarget` op template), `:100` (export);
`scope.js:44` (`WCID_FIRST_OPS`), `:76`/`:78` (`scopeEngine`, admin pass-through), `:97` (`requireJar`),
`:149` (`captureWindow` refusal), `:168`-`:171` (`getChromeTarget` refusal), `:38`-`:43` (gap doc);
`mcp-tools.js:493`-`:499` (`CHROME_TOOLS`/`getChromeTarget` def), `:503` (count comment), `:505` (`TOOLS`),
`:549`-`:552` (dispatch/`okResult`); `main.js:150` (`getEngine` factory) + `:1371` (dev `createEngine`);
tool-count current value **26** confirmed by `grep -c "name: '"` and the live tests. Test ref sites:
`automation-mcp-tools.test.js:72`/`:76`/`:77`/`:78` + the `getChromeTarget` tests `:798`/`:809`/`:818`;
`automation-mcp-server.test.js:26` (`EXPECTED_TOOL_COUNT`) + `:251` title; `automation-scope.test.js:211`
(three-place guard, app-level-uncovered). Leg-1 `downloadsManager.listAll()` is a landed deliverable.
