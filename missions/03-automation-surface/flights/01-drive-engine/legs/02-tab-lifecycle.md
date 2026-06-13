# Leg: tab-lifecycle

**Status**: completed
**Flight**: [Drive Engine (input / nav / tabs)](../flight.md)

## Objective

Give the engine tab-lifecycle control — **enumerate / open / close / activate (bring-to-front)** —
by exposing a `window.__goldfinchAutomation` hook on the **chrome renderer only** (thin wrappers over
the renderer's existing `createTab`/`closeTab`/`activateTab`) and driving it from main via
`mainWindow.webContents.executeJavaScript`, with `listTabs` filtered in the main process by the
internal-session exclusion and mapped to the canonical DD2 tab shape.

## Context

- **DD1** — tab state is renderer-owned (the `tabs` Map at `renderer.js:86 — "const tabs = new Map()"`).
  The main process has no tab registry and a `<webview>`'s `partition`/`preload` freeze at DOM attach,
  so only the renderer's `createTab` can stand up a tab with the correct jar. `ipcMain.handle` can't
  serve a main→renderer request (no `ipcRenderer.handle`), so `executeJavaScript` is the sanctioned
  main→renderer command path — it returns a promise resolving with the JSON-serializable result.
- **DD2** — canonical handle is `webContentsId`. `listTabs` returns `{ wcId, url, title, jarId, active }`
  per tab; all targeted ops take a `wcId`.
- **DD3** — foreground-to-act. `activateTab` is bring-to-front (the renderer's `activateTab` at
  `renderer.js:547` already does exactly this — toggles the `hidden` class so only the active tab is
  live). v1 has a single live tab; "send-to-back" is not a distinct z-order primitive (see Edge Cases).
- **DD5** — the internal-session exclusion is authoritative in **main**, on the real `webContents`
  session marker — never on a renderer-supplied flag. `listTabs` drops internal-session contents;
  targeted ops (close/activate) re-validate the target `wcId` is non-internal via Leg 1's
  `resolveContents` before dispatching. The internal `goldfinch://settings` tab, if open, is a real
  entry in the renderer `tabs` Map but must be invisible and untargetable to automation.
- **DD6 / security** — `openTab(url)` flows through the renderer's `createTab` **untrusted** branch
  (`renderer.js:465 — "trusted ? isInternalPageUrl(url) : isSafeTabUrl(url)"`), so an automation-opened
  tab is validated by `isSafeTabUrl` and can never select the internal/trusted branch. Native-nav URL
  re-validation on an existing contents is Leg 3's concern.
- **The one renderer source change in this flight is exposing this hook** (flight leg note). Everything
  else this flight adds is main-process.
- **Pattern continuity** — engine functions take **injected** Electron handles
  (`executeInRenderer`, `fromId`, `chromeContents`), mirroring `resolve.js`, so the orchestration is
  unit-testable with fakes and the actual `mainWindow.webContents.executeJavaScript` binding is wired
  in the glue (Leg 5).

## Inputs

What exists before this leg runs:
- `src/main/automation/resolve.js` (Leg 1) — `resolveContents`, `isInternalContents`, `classifyContents`.
- `src/renderer/renderer.js`:
  - `renderer.js:461 — "function createTab(url = currentHomePage(), container = null, { trusted = false } = {})"` — returns the new `tab` (with `tab.wcId` initially `null`) or `null` if the URL is rejected.
  - `renderer.js:533 — "function closeTab(id)"` — takes a **renderer tab id** (e.g. `"tab-3"`), not a wcId.
  - `renderer.js:547 — "function activateTab(id)"` — bring-to-front by renderer tab id.
  - `findTabByWcId(id)` (`renderer.js:1430 — "function findTabByWcId(id)"`) — maps a wcId → tab; returns `null` if none.
  - `closeTab` auto-creates a new blank tab when the **last** tab is closed (`renderer.js:543 — "else createTab()"`) — automation closing the only tab sees one blank tab appear, not zero (see Edge Cases).
  - `renderer.js:86 — "const tabs = new Map()"`, `renderer.js:87 — "let activeTabId = null"` — module-scope state the hook reads.
  - `tab.container` is the jar object `{ id, name, color, partition }` (`renderer.js:473-475,496`); `tab.container.id` is the jarId. `tab.wcId` is set at `dom-ready` (`renderer.js:651 — "tab.wcId = wv.getWebContentsId()"`).
- `webContents.fromId` and `mainWindow.webContents` in main (`main.js:190`, `main.js:93`).

## Outputs

What exists after this leg completes:
- `src/main/automation/tabs.js` — **new**: main-side tab-lifecycle engine functions
  (`enumerateTabs`, `openTab`, `closeTab`, `activateTab`) taking injected deps, plus a **pure**
  `mapEnumeratedTabs(rawTabs, { fromId, chromeContents })` helper (filter internal/unresolvable → DD2 shape).
- `src/renderer/renderer.js` — **modified**: defines `window.__goldfinchAutomation` (chrome renderer
  only) with `listTabs`, `openTab`, `closeTabByWcId`, `activateTabByWcId`.
- `test/unit/automation-tabs.test.js` — **new**: unit tests for `mapEnumeratedTabs` and the
  injected-deps orchestration of the engine functions (fake `executeInRenderer`/`fromId`).

## Acceptance Criteria

- [x] **AC1** — `window.__goldfinchAutomation` is defined **only in the chrome renderer**
  (`renderer.js`), never injected into guest webviews. It exposes `listTabs()`, `openTab(url)`,
  `closeTabByWcId(wcId)`, `activateTabByWcId(wcId)`. Each is a thin wrapper over the existing
  `createTab`/`closeTab`/`activateTab` + `findTabByWcId`; all return JSON-serializable values.
- [x] **AC2** — `listTabs()` (renderer) returns the raw per-tab array
  `{ wcId, url, title, jarId, active }` for every tab in the `tabs` Map (`jarId` = `tab.container.id`,
  `active` = `tab.id === activeTabId`). It does **not** itself try to hide the internal tab — filtering
  is main's job (AC4).
- [x] **AC3** — `mapEnumeratedTabs(rawTabs, { fromId, chromeContents })` (pure, in `tabs.js`) returns
  the DD2 shape `{ wcId, url, title, jarId, active }[]`, **dropping** any entry whose `wcId` (a) is not
  a number / is `null` (tab not yet at `dom-ready`), (b) does not resolve to a live contents, or
  (c) resolves to an internal-session contents (`isInternalContents` → reject). Pure; never throws
  (a per-entry resolve failure drops that entry, it does not abort the map).
- [x] **AC4** — `enumerateTabs({ executeInRenderer, fromId, chromeContents })` calls
  `executeInRenderer('window.__goldfinchAutomation.listTabs()')`, then returns
  `mapEnumeratedTabs(...)` of the result — so the **internal `goldfinch://settings` tab is absent** from
  the engine's enumerate output even though it is present in the renderer's raw list (DD5 enumerate filter).
- [x] **AC5** — `closeTab(wcId, deps)` and `activateTab(wcId, deps)` **re-validate** the target via
  `resolveContents(wcId, { fromId, chromeContents })` **before** dispatching to the renderer — so a
  directly-supplied internal-guest `wcId` (or a bad/dead handle) is **rejected** (throws), and is never
  closed/activated by automation (DD5 targeted-op guard). On a valid target they call
  `executeInRenderer('window.__goldfinchAutomation.closeTabByWcId(' + wcId + ')')` (resp. `activate…`).
- [x] **AC6** — `openTab(url, { executeInRenderer })` passes the URL into the renderer **safely** —
  `executeInRenderer('window.__goldfinchAutomation.openTab(' + JSON.stringify(url) + ')')` — so a URL
  string cannot break out of the JS code context (no string-concatenation injection). The renderer's
  `createTab` untrusted branch re-applies `isSafeTabUrl`; `openTab` resolves to the new tab's `wcId`
  (see Implementation Guidance for the dom-ready wait) or `null` if the URL was rejected / no handle
  became available.
- [x] **AC7** — `test/unit/automation-tabs.test.js` covers: `mapEnumeratedTabs` filtering (internal
  dropped, null-wcId dropped, unresolvable dropped, valid kept, shape correct); `enumerateTabs`
  end-to-end with a fake `executeInRenderer` returning a raw list incl. an internal entry, asserting
  it's filtered out; `closeTab`/`activateTab` rejecting an internal-target `wcId` and dispatching the
  correct renderer call for a valid one; `openTab` JSON-encoding the URL. Full suite
  `node --test test/unit/*.test.js` green.
- [x] **AC8** — `npm run typecheck` and `npm run lint` clean (note: `renderer.js` runs with no
  `require`; the hook uses only renderer-scope functions and `window`). No behavior change to existing
  interactive tab UX (open/close/activate still work by click).

## Verification Steps

- `node --test test/unit/automation-tabs.test.js` — new tests pass.
- `npm test` — full unit suite green.
- `npm run typecheck` / `npm run lint` — clean.
- Manual read: confirm the hook is defined in `renderer.js` (chrome renderer) and is **not** added to
  `src/preload/webview-preload.js` or any guest-injected surface.
- (Deferred to Leg 6 live smoke) drive `enumerateTabs`/`openTab`/`closeTab`/`activateTab` against the
  running app, and confirm the `goldfinch://settings` tab is absent from enumerate AND its wcId is
  rejected by `closeTab`/`activateTab`.

## Implementation Guidance

1. **Renderer hook (`renderer.js`)** — add near the tab functions (after `findTabByWcId`, or at a
   clearly-marked "automation hook" block). Define on `window` so it lives in the chrome renderer world.
   Declare the timeout as a named constant near the hook: `const OPEN_TAB_TIMEOUT_MS = 5000;`
   ```js
   // Automation hook — chrome renderer ONLY (this file is the privileged app shell;
   // it is never the preload for a guest webview, so web content cannot reach this).
   // Thin wrappers over the existing tab ops; main drives these via executeJavaScript
   // and applies the authoritative internal-session filter on its side (DD1/DD5).
   window.__goldfinchAutomation = {
     listTabs() {
       return [...tabs.values()].map((t) => ({
         wcId: t.wcId,                      // null until dom-ready
         url: t.url,
         title: t.title,
         jarId: t.container ? t.container.id : null,
         active: t.id === activeTabId,
       }));
     },
     openTab(url) {
       const tab = createTab(url);          // untrusted branch → isSafeTabUrl enforced
       if (!tab) return null;               // URL rejected
       if (tab.wcId != null) return tab.wcId;
       // wcId is assigned at dom-ready; resolve once it lands (bounded wait).
       // RACE GUARD: createTab() calls activateTab() synchronously (renderer.js:529) and
       // dom-ready can fire before/while this Promise body runs. Attach the listener, then
       // RE-CHECK tab.wcId immediately — if it's already set, resolve now so a just-fired
       // dom-ready isn't missed into the timeout path.
       return new Promise((resolve) => {
         const wv = tab.webview;
         const onReady = () => { wv.removeEventListener('dom-ready', onReady); resolve(tab.wcId ?? null); };
         wv.addEventListener('dom-ready', onReady);
         if (tab.wcId != null) { wv.removeEventListener('dom-ready', onReady); resolve(tab.wcId); return; }
         setTimeout(() => { wv.removeEventListener('dom-ready', onReady); resolve(tab.wcId ?? null); }, OPEN_TAB_TIMEOUT_MS);
       });
     },
     closeTabByWcId(wcId) {
       const tab = findTabByWcId(wcId);
       if (!tab) return false;
       closeTab(tab.id);
       return true;
     },
     activateTabByWcId(wcId) {
       const tab = findTabByWcId(wcId);
       if (!tab) return false;
       activateTab(tab.id);
       return true;
     },
   };
   ```
   `executeJavaScript` awaits a returned Promise, so `openTab` resolving on `dom-ready` works across
   the boundary. Keep the timeout modest; returning `null` on timeout is acceptable (the agent can
   `enumerateTabs` to recover the handle).

2. **`src/main/automation/tabs.js`** — `// @ts-check`, `'use strict';`, Electron-free at top (inject
   handles). Import `resolveContents`, `isInternalContents` from `./resolve`.
   - **Pure** `mapEnumeratedTabs(rawTabs, { fromId, chromeContents })`:
     ```js
     function mapEnumeratedTabs(rawTabs, { fromId, chromeContents }) {
       const out = [];
       for (const t of rawTabs || []) {
         if (typeof t.wcId !== 'number') continue;        // not yet at dom-ready
         let wc;
         try { wc = fromId(t.wcId); } catch { continue; }
         if (!wc || wc.isDestroyed?.()) continue;          // gone
         if (isInternalContents(wc)) continue;             // DD5: internal dropped
         out.push({ wcId: t.wcId, url: t.url, title: t.title, jarId: t.jarId, active: !!t.active });
       }
       return out;
     }
     ```
   - `async enumerateTabs({ executeInRenderer, fromId, chromeContents })`:
     `const raw = await executeInRenderer('window.__goldfinchAutomation.listTabs()'); return mapEnumeratedTabs(raw, { fromId, chromeContents });`
   - `async closeTab(wcId, { executeInRenderer, fromId, chromeContents })`:
     `resolveContents(wcId, { fromId, chromeContents });` (throws on internal/bad/dead) then
     `return executeInRenderer('window.__goldfinchAutomation.closeTabByWcId(' + wcId + ')');`
     (wcId is a validated number — safe to interpolate.)
   - `async activateTab(wcId, deps)`: same guard, dispatch `activateTabByWcId`.
   - `async openTab(url, { executeInRenderer })`:
     guard `if (typeof url !== 'string') throw new Error('automation: bad-url — url must be a string');`
     then `return executeInRenderer('window.__goldfinchAutomation.openTab(' + JSON.stringify(url) + ')');`
     **Always** JSON-encode the URL into the code string (AC6) — never bare concatenation. (The renderer's
     `createTab` untrusted branch still re-applies `isSafeTabUrl` as the authoritative gate; the type
     guard is belt-and-suspenders for clearer engine-side errors.)
   - Export all four engine fns + `mapEnumeratedTabs`.

3. **Tests (`test/unit/automation-tabs.test.js`)** — fake `executeInRenderer` (an async fn returning a
   canned raw list or echoing the code string so you can assert what was dispatched), fake `fromId`
   (a map of wcId → fake contents, some internal via `{ session: { __goldfinchInternal: true } }`).
   Assert filtering, rejection throws (use distinct message substrings from `resolve.js`), and the
   dispatched code strings via **substring `includes`** (not brittle exact-equality) — esp. that the
   `openTab` dispatch contains the `JSON.stringify`-encoded URL and that a bad (non-string) URL throws
   `bad-url` before any dispatch.

## Edge Cases

- **Internal settings tab open during enumerate** — present in the renderer's raw `listTabs` (it's a
  real tab) but dropped by `mapEnumeratedTabs` because its wcId resolves to an internal-session
  contents. This is the DD5 enumerate filter; test it explicitly with a fake internal contents.
- **Tab not yet at `dom-ready`** (`wcId === null`) — dropped from enumerate (can't be targeted yet);
  `openTab` waits for `dom-ready` before resolving its wcId. Document both.
- **`closeTab`/`activateTab` with a non-existent wcId** — `resolveContents` throws `no-such-contents`;
  the engine surfaces that (does not silently succeed).
- **Closing the last tab** — the renderer's `closeTab` auto-spawns a new blank tab when the last one
  is closed (`renderer.js:543`). So `closeTab(onlyTabWcId)` returns `true` but a subsequent
  `enumerateTabs` shows **one** blank tab, not zero. This is existing interactive behavior, preserved;
  automation callers should expect it (the window never goes to zero tabs).
- **"Send-to-back"** — in foreground-to-act v1 only one tab is live (the active one); there is no
  z-order stack, so "send-to-back" is **not** a distinct primitive. It is expressed by activating a
  *different* tab (which sends the current one to `hidden`). No `sendToBack` op is added this leg; the
  Leg 6 smoke exercises "send a tab to back" as `activateTab(someOtherWcId)`. (If a dedicated
  convenience proves wanted during the smoke, it's a trivial follow-up — flagged, not built now.)
- **JS-string injection via `openTab(url)`** — defeated by `JSON.stringify` (AC6). wcId interpolation
  is safe because wcId is validated as a number before dispatch.
- **`createTab` side effect**: the renderer's `createTab` calls `activateTab` on the new tab
  (`renderer.js:529`), so `openTab` also brings the new tab to front — consistent with foreground-to-act.

## Files Affected
- `src/main/automation/tabs.js` — **new**: engine tab-lifecycle fns + pure `mapEnumeratedTabs`.
- `src/renderer/renderer.js` — **modified**: add `window.__goldfinchAutomation` hook (the one renderer change).
- `test/unit/automation-tabs.test.js` — **new**: unit tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (batch commit at flight end — do NOT commit, do NOT `[COMPLETE:leg]`)
- [x] Do NOT check off the leg in flight.md yet (batch at flight end)
