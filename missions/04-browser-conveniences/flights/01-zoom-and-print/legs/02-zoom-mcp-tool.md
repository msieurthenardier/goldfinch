# Leg: zoom-mcp-tool

**Status**: completed
**Flight**: [Core Conveniences — Zoom & Print](../flight.md)

## Objective

Add `getZoom`/`setZoom` automation ops (`src/main/automation/zoom.js`) — by zoom *factor*, jar-scoped via `resolveContents`, each carrying an **op-local `isInternalContents` guard** (DD3) so they refuse internal pages even under the admin key — wire them into the engine, and expose them as two **flat-schema** MCP tools (agent parity, SC8 part). This builds the `getZoom` read path the `page-zoom` behavior test observes.

## Context

- **DD4** — MCP tools are `setZoom(wcId, factor)` + `getZoom(wcId)` keyed by zoom *factor* (`1.0` = 100%), with **flat object schemas** (no top-level `oneOf`/`allOf`/`anyOf`). `getZoom` is a brand-new read path. `zoomIn/out/reset` are keyboard affordances (leg 1), not tools. Native `print()` is not an MCP tool (printToPDF is leg 3).
- **DD3 / DD5** — The admin engine builds deps with `{ allowInternal: true }`, which is the *sole* relaxation of `resolveContents`'s internal-session exclusion (the skip logic is `resolve.js:95-97`). So `resolveContents` alone does **not** refuse internal pages for admin. New zoom ops must therefore carry their **own op-local `isInternalContents(wc)` guard** — exactly as `evaluate`/`injectScript`/`openDevTools` do (`observe.js:341/392/436`) — or admin could zoom `goldfinch://settings`. This guard is what `page-zoom` step 7 (run under the admin key) exercises.
- **DD5 (adapter)** — `mcp-tools.js` is a thin adapter: no new security logic, it just maps the named tool args → positional engine call. The engine/op guards are authoritative.
- This leg is independent of leg 1's renderer/keyboard work; it only relies on `webContents.getZoomFactor()`/`setZoomFactor()` (Electron instance methods, valid on any resolved guest — leg 1 already calls them at `main.js:320-322`).

## Inputs

What exists before this leg runs:
- `src/main/automation/nav.js:41` — op template: `async function navigate(wcId, url, deps) { … const wc = resolveContents(wcId, deps); return wc.loadURL(url); }`; `module.exports = { navigate, goBack, goForward, reload }` (named exports).
- `src/main/automation/resolve.js:76` — `function resolveContents(wcId, { fromId, chromeContents, allowInternal = false })` throwing `automation: bad-handle` / `no-such-contents` / `internal-session`; the internal check is skipped when `allowInternal === true` (`resolve.js:91-97`). `isInternalContents(wc)` at `resolve.js:28` — `!!wc && !!wc.session && wc.session.__goldfinchInternal === true`.
- `src/main/automation/observe.js:3` — `const { resolveContents, classifyContents, isInternalContents } = require('./resolve');`. Op-local guard pattern (e.g. `observe.js:341-343`): `if (isInternalContents(wc)) { throw new Error('automation: evaluate — internal-session excluded'); }`.
- `src/main/automation/engine.js:60-89` — the op dispatch map (`navigate: (wcId, url) => nav.navigate(wcId, url, deps()), …`). `deps()` is built fresh per dispatch and threads `allowInternal` from the engine opts.
- `src/main/automation/mcp-tools.js` — ToolDef typedef (`mcp-tools.js:108`); flat all-required example `navigate` (`mcp-tools.js:163-174`); default result path `okResult(value)` → `{ content: [{ type:'text', text: JSON.stringify(value) }] }` (`mcp-tools.js:57-68`); `callTool` uses the default serialize unless a tool sets `shape` (image ops only). The existing top-level `anyOf` is on `pressKey` (`mcp-tools.js:273`) — that's the issue #56 instance fixed in **F6**, NOT here; the new zoom tools must not introduce a new one.
- `test/unit/automation-nav.test.js:23-84` — fake-wc test style: `makeGuestWc(id)` / `makeInternalWc(id)` / `makeDestroyedWc(id)` (each with `session.__goldfinchInternal`, `isDestroyed()`, method spies); deps stubbed as `{ fromId: (id) => …, chromeContents: null }`; assertions via call-count/state and `assert.rejects(…, err => err.message.includes('automation: internal-session'))`.

## Outputs
- `src/main/automation/zoom.js` exporting `getZoom` and `setZoom`.
- `getZoom`/`setZoom` registered in `engine.js`.
- `getZoom`/`setZoom` MCP tool entries in `mcp-tools.js` (flat schemas).
- `test/unit/automation-zoom.test.js` with passing coverage.

## Acceptance Criteria
- [ ] `src/main/automation/zoom.js` exports `getZoom(wcId, deps)` and `setZoom(wcId, factor, deps)`, each following the `nav.js` template: `const wc = resolveContents(wcId, deps);` then an **op-local guard** `if (isInternalContents(wc)) throw new Error('automation: getZoom — internal-session excluded')` (and the `setZoom` analogue) **before** touching zoom.
- [ ] `getZoom` returns `{ factor: wc.getZoomFactor() }` (a number; `1.0` = 100%).
- [ ] `setZoom` validates `factor` is a finite number `> 0` (throws `automation: setZoom — factor must be a positive number` otherwise), clamps to `[0.25, 5.0]`, calls `wc.setZoomFactor(clamped)`, and returns `{ factor: clamped }` (the applied value, so the caller sees what landed).
- [ ] Both ops are registered in the `engine.js` dispatch map: `getZoom: (wcId) => zoom.getZoom(wcId, deps())`, `setZoom: (wcId, factor) => zoom.setZoom(wcId, factor, deps())`.
- [ ] `mcp-tools.js` declares two tools — `getZoom` (`required: ['wcId']`) and `setZoom` (`required: ['wcId','factor']`) — as **flat object schemas with NO top-level `oneOf`/`allOf`/`anyOf`**, thin-adapter `call` mapping named→positional (`call: (engine, { wcId }) => engine.getZoom(wcId)` / `(engine, { wcId, factor }) => engine.setZoom(wcId, factor)`), riding the default `okResult` serialize (no `shape`).
- [ ] **Op-local internal guard holds under admin**: a unit test proves `getZoom`/`setZoom` on an internal wc throw the op-local refusal **even when `deps` has `allowInternal: true`** (the case `resolveContents` would otherwise let through).
- [ ] `test/unit/automation-zoom.test.js` covers: `getZoom` returns the factor; `setZoom` applies + clamps (both bounds) + returns the applied factor; `bad-handle` (non-number wcId); `no-such-contents` (destroyed wc); `internal-session` op-local refusal with `allowInternal:true`; factor validation (non-positive / non-finite throws).
- [ ] **`test/unit/automation-mcp-tools.test.js` updated** for the two new tools: bump the hard tool-count assertion (currently `=== 21`, `automation-mcp-tools.test.js:70-77`) to `23`; add `getZoom`/`setZoom` to the expected name list; extend `makeFakeEngine` (`~:42-57`) with `getZoom`/`setZoom` stubs; and add a discovery-contract assertion that **both new tools' schemas have NO top-level `oneOf`/`allOf`/`anyOf`** (the DD4/SC8 flat-schema invariant — `pressKey` stays the only sanctioned `anyOf`). Also bump the self-documenting count comments to keep them honest: `mcp-tools.js:91-95` and `:440-442` ("12 drive"→"14 drive"), and `automation-mcp-tools.test.js:8`.
- [ ] `npm test` passes (including the new file AND the updated `automation-mcp-tools.test.js`); `npm run lint` and `npm run typecheck` clean.

## Verification Steps
- `npm test` — all unit tests pass, including `test/unit/automation-zoom.test.js`.
- `node -e "…"` or a test asserting: `getZoom` on a fake guest returns `{ factor: 1.25 }` when `getZoomFactor()` returns `1.25`.
- Test asserts `setZoom(wcId, 9, deps)` clamps to `{ factor: 5.0 }` and `setZoom(wcId, 0.1, deps)` clamps to `{ factor: 0.25 }`.
- Test asserts `setZoom`/`getZoom` against `makeInternalWc()` with `deps.allowInternal = true` reject with `…internal-session excluded` (proving the op-local guard, not `resolveContents`, fired).
- `npm run lint` / `npm run typecheck` — clean.
- (Live invocation over MCP is exercised later by `page-zoom` at `verify-integration` under the admin key; not required to pass this leg.)

## Implementation Guidance

1. **`src/main/automation/zoom.js`** (new) — mirror `nav.js` structure and `observe.js`'s op-local guard:
   ```js
   const { resolveContents, isInternalContents } = require('./resolve');

   // Mirrors the keyboard ladder bounds in main.js (applyZoom). Kept local: the
   // automation module must not import from the Electron entry (main.js requires
   // the engine, not vice-versa).
   const ZOOM_MIN = 0.25;
   const ZOOM_MAX = 5.0;

   function getZoom(wcId, deps) {
     const wc = resolveContents(wcId, deps);
     if (isInternalContents(wc)) throw new Error('automation: getZoom — internal-session excluded');
     return { factor: wc.getZoomFactor() };
   }

   function setZoom(wcId, factor, deps) {
     if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
       throw new Error('automation: setZoom — factor must be a positive number, got ' + String(factor));
     }
     const wc = resolveContents(wcId, deps);
     if (isInternalContents(wc)) throw new Error('automation: setZoom — internal-session excluded');
     const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
     wc.setZoomFactor(clamped);
     return { factor: clamped };
   }

   module.exports = { getZoom, setZoom };
   ```
   - Guard order matters: validate `factor` first (cheap, no side effects), then resolve, then the op-local internal guard, then act — mirroring how `nav.navigate` validates the URL before resolving.

2. **`src/main/automation/engine.js`** — add two entries to the dispatch map (`engine.js:60-89`), next to the other drive ops, and `require('./zoom')` at the top alongside the other op-module requires.

3. **`src/main/automation/mcp-tools.js`** — add two ToolDefs mirroring `navigate` (`mcp-tools.js:163-174`):
   ```js
   {
     name: 'getZoom',
     description: 'Get the current page zoom factor of the tab identified by wcId (1.0 = 100%). Refuses internal goldfinch:// pages.',
     inputSchema: {
       type: 'object',
       properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
       required: ['wcId'],
     },
     call: (engine, { wcId }) => engine.getZoom(wcId),
   },
   {
     name: 'setZoom',
     description: 'Set the page zoom factor of the tab identified by wcId (1.0 = 100%; clamped to [0.25, 5.0]). Refuses internal goldfinch:// pages. Returns the applied factor.',
     inputSchema: {
       type: 'object',
       properties: {
         wcId: { type: 'integer', description: 'webContents id of the target tab' },
         factor: { type: 'number', description: 'zoom factor; 1.0 = 100%, clamped to [0.25, 5.0]' },
       },
       required: ['wcId', 'factor'],
     },
     call: (engine, { wcId, factor }) => engine.setZoom(wcId, factor),
   },
   ```
   - Keep them strictly flat: all required args go in `required`, no top-level `anyOf`/`oneOf`/`allOf`.

4. **`test/unit/automation-zoom.test.js`** (new) — copy the fake-wc + stub-deps style from `automation-nav.test.js`. Add `getZoomFactor()`/`setZoomFactor(f)` spies to the fake wc (e.g. `getZoomFactor() { return this._factor ?? 1.0; }`, `setZoomFactor(f) { this.setCalls.push(f); this._factor = f; }`). Cover every bullet in the Acceptance Criteria, especially the `allowInternal:true` + internal-wc op-local refusal.

5. **`test/unit/automation-mcp-tools.test.js`** (update — this is the pre-existing tool-list contract test) — adding two tools breaks its hard assertions; update them:
   - Bump the count assertion at `automation-mcp-tools.test.js:70-77` from `21` to `23` and add `getZoom`/`setZoom` to the expected name set.
   - Extend `makeFakeEngine` (`~:42-57`) so it registers `getZoom`/`setZoom` (needed for any dispatch test).
   - Add a per-tool discovery-contract assertion (mirroring the existing schema-shape checks at `~:90-100`) that the two new tools' `inputSchema` has no top-level `anyOf`/`oneOf`/`allOf` — pinning DD4/SC8.
   - Bump the "12 drive" count comments: `mcp-tools.js:91-95`, `mcp-tools.js:440-442`, and `automation-mcp-tools.test.js:8`.

## Edge Cases
- **Admin + internal wc**: `resolveContents` returns the wc (allowInternal), so the op-local guard is the ONLY thing refusing it — the dedicated test must set `deps.allowInternal = true` to prove the guard, not `resolveContents`, fires.
- **Out-of-range factor**: `setZoom(wcId, 100)` clamps to `5.0` (not an error); `setZoom(wcId, 0)` / negative / `NaN` / non-number → validation throw.
- **Destroyed / bad wcId**: surfaced by `resolveContents` (`no-such-contents` / `bad-handle`) before any zoom call.
- **getZoom on internal**: also refused by the op-local guard (symmetry with setZoom; admin gets no internal read either).
- **Chip staleness on agent-driven zoom** (NON-goal this leg): an agent calling `setZoom` does not update the renderer zoom chip (the op stays pure, mirroring the `nav.js` template — no renderer coupling). Noted as a minor UX gap, deferred to HAT/polish; the `page-zoom` test observes via `getZoom` + `devicePixelRatio`, not the chip.

## Files Affected
- `src/main/automation/zoom.js` — NEW: `getZoom`/`setZoom` ops with op-local internal guard.
- `src/main/automation/engine.js` — register the two ops + `require('./zoom')`.
- `src/main/automation/mcp-tools.js` — two flat-schema tool defs; bump "12 drive" count comments (`:91-95`, `:440-442`).
- `test/unit/automation-zoom.test.js` — NEW: unit coverage.
- `test/unit/automation-mcp-tools.test.js` — UPDATE: tool count 21→23, add the two names, extend `makeFakeEngine`, assert flat schemas, bump count comment (`:8`).
- *(Docs — README shortcuts + `docs/mcp-automation.md` — are owned by the `verify-integration` leg, NOT here.)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`, lint, typecheck)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (Flight Director defers `completed` + commit to flight-end review)
- [ ] Check off this leg in flight.md (deferred to flight-end commit)
- [ ] (Not the final leg — do NOT commit)
