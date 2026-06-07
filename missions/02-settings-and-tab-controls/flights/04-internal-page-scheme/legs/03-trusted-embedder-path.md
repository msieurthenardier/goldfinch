# Leg: trusted-embedder-path

**Status**: landed
**Flight**: [Internal Page Scheme (`goldfinch://`)](../flight.md)

## Objective
Build the trusted embedder path so chrome — and only chrome — can open `goldfinch://settings` in a
real tab: add the `isInternalPageUrl` allowlist, give `createTab` a `trusted` option that selects the
internal partition + a new internal-page preload, keep the internal webview context-isolated, and wire
the kebab **Settings** item to open the page.

## Context
- **Flight DD1** — `createTab` gains `{ trusted = false }`; when trusted it validates against the new
  `isInternalPageUrl` (exact allowlist, only `goldfinch://settings`) **instead of** `isSafeTabUrl`, and
  selects the **internal partition + internal preload**. The page-reachable `onOpenTab(url => createTab(url))`
  (`renderer.js:1686`) passes **no flag** → web content can never select the internal branch. The flag
  is **never inferred from the URL** — provenance is the call site. `isSafeTabUrl` is **unchanged**.
- **Flight DD5** — a **new** internal-page preload (`src/preload/internal-preload.js`) with a **minimal**
  `contextBridge` surface (Flight 6 populates it); the internal webview runs **`contextIsolation: true`**
  (opposite of web webviews) via a `params.partition` branch in `will-attach-webview` (`main.js:46`,
  which is currently the 2-arg `(_e, webPreferences)` form and must grow `params`). The internal preload
  is exposed to the renderer as a path on `window.goldfinch` (mirroring `webviewPreloadPath`), so
  `renderer-globals.d.ts` DOES gain `internalPreloadPath` (this is the chrome bridge, distinct from the
  internal page's own bridge, which is NOT in this d.ts).
- **Depends on leg 2** — `INTERNAL_PARTITION = 'goldfinch-internal'` and the `protocol.handle` serving
  already exist in `main.js`. The webview `partition` attribute must match that string byte-for-byte.
- **`isInternalPageUrl` placement** — `src/shared/url-safety.js`, dual-exported exactly like
  `isSafeTabUrl` (`module.exports` for main/tests + `globalThis` for the renderer), declared in
  `renderer-globals.d.ts`, unit-tested beside the existing `isSafeTabUrl` tests.

## Inputs
- `src/main/main.js` post-leg-2: `INTERNAL_PARTITION`, the internal session + handler, the
  `will-attach-webview` handler at `:46` (still 2-arg).
- `src/renderer/renderer.js`: `createTab` (`:378-436`, guards `isSafeTabUrl` at `:379`, sets
  `partition`=`jar.partition` `:388`, `preload`=`window.goldfinch.webviewPreloadPath` `:386`),
  `onOpenTab` init (`:1686`), kebab Settings TODO (`:327-329`), `els`/`HOMEPAGE` (`:5-58`).
- `src/preload/chrome-preload.js`: the `window.goldfinch` bridge with `webviewPreloadPath` (`:50`).
- `src/shared/url-safety.js` (dual-export shape), `src/renderer/renderer-globals.d.ts`,
  `test/unit/url-safety.test.js`.

## Outputs
- `isInternalPageUrl` in `src/shared/url-safety.js` (+ d.ts + unit test).
- `createTab(url, container, { trusted })` selecting internal partition + internal preload when trusted.
- `src/preload/internal-preload.js` (new, minimal) + `internalPreloadPath` on the `window.goldfinch`
  bridge + d.ts.
- `will-attach-webview` keeping `contextIsolation: true` for the internal webview.
- Kebab **Settings** opens `goldfinch://settings`; the TODO at `renderer.js:329` is gone.
- Offline gates green; live "Settings opens + renders + reloads" deferred to leg 6.

## Acceptance Criteria
- [ ] **`isInternalPageUrl(url)`** added to `src/shared/url-safety.js`, dual-exported (CommonJS +
  `globalThis`) exactly like `isSafeTabUrl`. Returns true for `goldfinch://settings` **and**
  `goldfinch://settings/` (canonical root, with or without trailing slash — matching leg-2's main
  handler root-path logic, `main.js`); false for `goldfinch://settings/evil`, `goldfinch://other`,
  every web/file/data/javascript scheme, non-strings, empties, malformed. Accept `pathname === '/' || pathname === ''`
  so it holds in **both** the Node test runner (where `goldfinch` is not a registered standard scheme →
  `pathname:''`) and the Electron runtime (registered standard → `pathname:'/'`). Never throws.
- [ ] **`declare function isInternalPageUrl(url: any): boolean;`** added to `renderer-globals.d.ts`
  (next to the `isSafeTabUrl` declaration) so the renderer reference typechecks.
- [ ] **Unit test** added to `test/unit/url-safety.test.js`: accepts `goldfinch://settings` and
  `goldfinch://settings/`; rejects `goldfinch://settings/x`, `goldfinch://other`, `https://settings`,
  `file:///…`, `data:…`, `javascript:…`, `''`, non-strings. **Do NOT assert host-casing behavior**
  (e.g. `goldfinch://SETTINGS`) — host casing is normalized in Electron but case-preserving in the Node
  test runner, so such an assertion would pass for the wrong reason and diverge from runtime. `npm test`
  count rises by the number of new cases.
- [ ] **`createTab(url = HOMEPAGE, container = null, { trusted = false } = {})`**: validation is
  `const ok = trusted ? isInternalPageUrl(url) : isSafeTabUrl(url); if (!ok) return null;`. The flag is
  an explicit caller arg, **never inferred from the URL scheme** (a `goldfinch://` string on the
  untrusted branch is still rejected by `isSafeTabUrl`).
- [ ] **When `trusted`, the synthetic internal jar is set as the `jar` itself — a SINGLE object that
  the partition attribute (`renderer.js:388`), `tab.container` (`:402`), and the dot logic all derive
  from.** ⚠️ **DATA-LOSS TRAP (do NOT regress)**: if the webview partition is set to the internal string
  while `jar`/`tab.container` stays `DEFAULT_CONTAINER` (`persist:goldfinch`), then a **New Identity**
  click on the Settings tab calls `identityNew({ partition: 'persist:goldfinch' })` (`renderer.js:~1469-1499`
  reads `tab.container.partition`) and **wipes the user's real default browsing jar**. So:
  `const jar = trusted ? { id: 'internal', name: 'Settings', color: '#9aa0ac', partition: <internal-partition> } : (container || DEFAULT_CONTAINER);`
  and let `:388`/`:402`/the dot logic consume it unchanged. `preload` is
  `window.goldfinch.internalPreloadPath` (NOT `webviewPreloadPath`). The dot logic skips `id === 'internal'`
  (treat like default). `color` is a real string (not `null` — `pJar` interpolates it into
  `style="background:…"`).
- [ ] **`onOpenTab` is unchanged** — `window.goldfinch.onOpenTab((url) => createTab(url))` still passes
  no `trusted` flag (verify `renderer.js:1686` is untouched). No other `createTab` caller passes
  `trusted: true` except the Settings handler.
- [ ] **`src/preload/internal-preload.js`** (new): runs under `contextIsolation: true`, exposes a
  **minimal** `contextBridge` surface (e.g. `window.goldfinchInternal = { version: 1 }` or a no-op
  handshake — Flight 6 adds the home-page/Shields IPC). No node integration, no media/farbling logic.
- [ ] **`internalPreloadPath`** added to the `window.goldfinch` bridge in `chrome-preload.js` (mirroring
  `webviewPreloadPath`, `:50`) and declared in `renderer-globals.d.ts`.
- [ ] **Single source of truth for the partition string** (prevents silent renderer/main drift): extract
  the literal into a tiny shared CommonJS module `src/shared/internal-page.js`
  (`module.exports = { INTERNAL_PARTITION: 'goldfinch-internal' }`); `main.js` **requires it** (replacing
  leg-2's local `INTERNAL_PARTITION` const — same flight, uncommitted), `chrome-preload.js` requires it
  and exposes `internalPartition: INTERNAL_PARTITION` on the bridge, the renderer's trusted jar uses
  `window.goldfinch.internalPartition`, and `renderer-globals.d.ts` declares `internalPartition: string;`.
  No side retypes the literal.
- [ ] **`will-attach-webview`** (`main.js:46`) grows its third `params` arg and, when
  `params.partition === INTERNAL_PARTITION`, sets `contextIsolation: true` (and `nodeIntegration: false`;
  `sandbox: true` acceptable/stronger) and returns — leaving web webviews on the existing
  `contextIsolation: false`. The stale `main.js:62-66` "enforced here" comment is not relied upon
  (preload is renderer-set); fix or annotate it if touched.
- [ ] **Kebab Settings** (`renderer.js:327-329`): the TODO is replaced with
  `createTab('goldfinch://settings', null, { trusted: true })` (after `closeKebabMenu()`).
- [ ] New `els.*`/locals carry the file's JSDoc casts; **`npm run typecheck` → 0**, `npm run lint` → 0,
  `npm test` → 147 + new url-safety cases.

## Verification Steps
- `npm run typecheck` → 0 (createTab signature, `internalPreloadPath`/`isInternalPageUrl` on the typed
  surfaces, the `params` arg on `will-attach-webview`).
- `npm run lint` → 0; `npm test` → 147 + new `isInternalPageUrl` cases, all green.
- **Static read-through**: the trusted branch is reachable ONLY from the Settings handler; `onOpenTab`
  passes no flag; the flag is not inferred from the URL; the internal partition string matches leg 2;
  the internal webview gets the internal preload + `contextIsolation:true`.
- **Deferred to leg 6 (live)**: `npm run dev:debug`; click kebab → Settings; confirm a tab opens to
  `goldfinch://settings`, the stub renders, and it reloads; confirm the internal bridge is present and
  isolated. (This leg makes it embeddable; the page is served by leg 2.)

## Implementation Guidance

1. **`isInternalPageUrl`** (`src/shared/url-safety.js`)
   - Mirror `isSafeTabUrl`'s shape (string guard, `try { new URL } catch return false`, never throws).
     Accept iff `parsed.protocol === 'goldfinch:'` AND `parsed.host === 'settings'` AND the path is root
     (`parsed.pathname === '/' || parsed.pathname === ''`). Reject everything else. Add to BOTH export
     branches (`module.exports = { isSafeTabUrl, isSafePosterUrl, isInternalPageUrl }` and the
     `globalThis` block).
   - Add `declare function isInternalPageUrl(url: any): boolean;` to `renderer-globals.d.ts`.
   - Add cases to `test/unit/url-safety.test.js`.

2. **`createTab` trusted branch** (`renderer.js:378-436`)
   - Signature → `function createTab(url = HOMEPAGE, container = null, { trusted = false } = {})`.
   - Replace the guard (`:379`) with the trusted/untrusted validation split (`isInternalPageUrl` vs
     `isSafeTabUrl`).
   - **Set the jar as a SINGLE synthetic object on the trusted branch** (the data-loss fix):
     `const jar = trusted ? { id: 'internal', name: 'Settings', color: '#9aa0ac', partition: window.goldfinch.internalPartition } : (container || DEFAULT_CONTAINER);`
     so the webview `partition` (`:388`), `tab.container` (`:402`), and the dot logic all derive from the
     same object — never a partition that disagrees with `tab.container.partition`.
   - `preload` from `trusted`: trusted → `window.goldfinch.internalPreloadPath`; else →
     `window.goldfinch.webviewPreloadPath`.
   - Dot logic (`:416-420`): skip the dot when `jar.id === 'default' || jar.id === 'internal'`.
   - Keep `wireWebview`/`activateTab` shared (the settings tab is a normal tab otherwise).

2a. **Shared partition constant** (single source of truth)
   - New `src/shared/internal-page.js`: `module.exports = { INTERNAL_PARTITION: 'goldfinch-internal' };`.
   - `main.js`: `const { INTERNAL_PARTITION } = require('../shared/internal-page');` — replace leg-2's
     local `const INTERNAL_PARTITION` (same flight, uncommitted; keep all its uses).
   - `chrome-preload.js`: require it and add `internalPartition: INTERNAL_PARTITION` to the bridge.
   - `renderer-globals.d.ts`: add `internalPartition: string;`.

3. **Internal preload + bridge path**
   - New `src/preload/internal-preload.js`: `const { contextBridge } = require('electron');
     contextBridge.exposeInMainWorld('goldfinchInternal', { version: 1 });` (minimal; Flight 6 grows it).
   - `chrome-preload.js`: add `internalPreloadPath: \`file://${require('path').join(__dirname, 'internal-preload.js')}\`,`
     alongside `webviewPreloadPath` (`:50`).
   - `renderer-globals.d.ts`: add `internalPreloadPath: string;` to the `window.goldfinch` interface.

4. **`will-attach-webview` isolation** (`main.js:46`)
   - `(_e, webPreferences, params) => { if (params.partition === INTERNAL_PARTITION) { webPreferences.contextIsolation = true; webPreferences.nodeIntegration = false; webPreferences.sandbox = true; return; } /* existing web-webview prefs */ }`.

5. **Wire Settings** (`renderer.js:327-329`)
   - Replace the TODO line with `createTab('goldfinch://settings', null, { trusted: true });` (keep
     `closeKebabMenu()` first).

6. **Scope guard**: do NOT change `will-navigate` (leg 4) or the `tab-scheme-guard` fixture/spec (leg 4).
   Do NOT run the live GUI.

## Edge Cases
- **A page URL `goldfinch://settings` via `onOpenTab`**: hits the untrusted branch → `isSafeTabUrl`
  rejects it (returns null). Confirm no inference path treats it as trusted.
- **Internal partition string drift** between renderer and main: would silently serve nothing — pin the
  constant and comment both sides.
- **Internal tab + media/privacy panels**: `renderPrivacy` always renders `pJar()` + `pShields()`
  (`renderer.js:~1511`). For the Settings tab, `currentSite()` resolves `goldfinch://settings` to
  `'settings'`, so the Shields section shows toggles + an "Active on settings" pause, and the Jar
  section shows a working **New identity** button. These **render and act harmlessly — PROVIDED the
  synthetic-jar fix is in** (so New Identity targets the throwaway `goldfinch-internal` partition, NOT
  the real default jar — see the DATA-LOSS TRAP above). Media panel shows nothing (no media preload).
  All sections null-guard (`tab.privacy = blankPrivacy()`); none crash. Acceptable for Flight 4.
- **`allowpopups` inherited on the internal webview** (`renderer.js:387`): harmless (DD5) — `window.open`
  from the internal page routes to `open-tab` → untrusted `createTab` → `isSafeTabUrl` rejects
  `goldfinch://`. Conscious limitation, leave as-is.
- **`sandbox: true` + preload**: a sandboxed preload can still use `contextBridge`; if the minimal
  bridge fails to expose under sandbox, fall back to `sandbox: false` but keep `contextIsolation: true`
  (the load-bearing property).

## Files Affected
- `src/shared/url-safety.js` — `isInternalPageUrl` (+ both exports).
- `src/shared/internal-page.js` — NEW (shared `INTERNAL_PARTITION` constant).
- `src/renderer/renderer-globals.d.ts` — `isInternalPageUrl` decl + `internalPreloadPath` + `internalPartition`.
- `test/unit/url-safety.test.js` — new `isInternalPageUrl` cases.
- `src/renderer/renderer.js` — `createTab` signature/trusted-branch (synthetic jar), dot logic, Settings wiring.
- `src/preload/chrome-preload.js` — `internalPreloadPath` + `internalPartition`.
- `src/preload/internal-preload.js` — NEW (minimal isolated bridge).
- `src/main/main.js` — `will-attach-webview` `params` branch; require `INTERNAL_PARTITION` from the new shared module (replacing leg-2's local const).

---

## Post-Completion Checklist

**Batched-commit flight: implement + update artifacts, do NOT commit; signal `[HANDOFF:review-needed]`.**

- [ ] All acceptance criteria verified (static + offline gates; live open/render/reload → leg 6)
- [ ] Offline gates passing (`npm test` / `typecheck` / `lint`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; signal `[HANDOFF:review-needed]`
