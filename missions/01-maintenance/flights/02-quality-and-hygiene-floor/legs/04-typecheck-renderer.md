# Leg: typecheck-renderer

**Status**: completed
**Flight**: [Quality & Hygiene Floor](../flight.md)

## Objective
Complete F11 by bringing the DOM-side files (`renderer.js`, `webview-preload.js`) under `// @ts-check` to zero errors — defining the `Tab` and `Window.goldfinch` types and the `Electron.WebviewTag` cast pattern the design review identified.

## Context
- Flight DD sub-split seam (b). Leg 3 stood up `jsconfig.json` (checkJs:false, per-file `@ts-check`), the `typecheck` script, and annotated the Node side. This leg adds the two DOM files.
- **DOM lib + a `setTimeout` gotcha (design-review catch)**: this leg adds `"dom"` + `"dom.iterable"` to `lib`. This is *mostly* additive, but DOM and `@types/node` both declare `setTimeout`, so its return type becomes `number | NodeJS.Timeout`. Code that stores a timer handle and later passes it to `clearTimeout` then errors. **Fix**: annotate stored timer handles `/** @type {ReturnType<typeof setTimeout>} */` at the sites where the handle is later `clearTimeout`'d — confirmed needed in `webview-preload.js` (`:159`/`:161`, `:186`/`:188`); check `main.js` (`schedulePrivacySend` stores into a `Map` and deletes by key — never `clearTimeout`s the value, so likely fine, but re-run `npm run typecheck` on the Node side after the lib change to confirm it stays clean and annotate any break).
- **`<webview>` typing (design-review catch)**: `document.createElement('webview')` returns `HTMLElement`; Electron does not augment `HTMLElementTagNameMap` for `'webview'`. There is exactly **one** creation site (`renderer.js:111`). Annotate it `/** @type {Electron.WebviewTag} */ (document.createElement('webview'))` **and** type the `Tab.webview` typedef field as `Electron.WebviewTag` — then *every* `tab.webview.loadURL()`/`.getURL()`/`.send()`/etc. (the ~10 call sites) infers for free. Do **not** annotate intermediate `wv = tab.webview` locals.
- **`window.goldfinch`**: the contextBridge API (`chrome-preload.js`) is consumed throughout `renderer.js` (`window.goldfinch.downloadMedia`, `.onOpenTab`, `.shieldsGet`, etc.). Declare a global `Window.goldfinch` typedef so these are typed.
- **`webview-preload.js`** runs in the page main world: uses DOM + `require('electron')` `ipcRenderer` (`.sendToHost`, `.sendSync`). Both covered by dom lib + electron types.

## Inputs
- `src/renderer/renderer.js`, `src/preload/webview-preload.js` (annotate).
- `jsconfig.json` (add dom lib), `src/renderer/renderer.js:53` (the stray `@type {Map<string, Tab>}`).

## Outputs
- `jsconfig.json` — `lib: ["es2022", "dom", "dom.iterable"]`, **and** fix `include` to `["src/**/*.js", "src/**/*.d.ts"]` (the current `*.js`-only glob does NOT pick up `.d.ts` files — this reliably includes both the new `renderer-globals.d.ts` and Leg 3's `session-augments.d.ts`).
- `src/renderer/renderer-globals.d.ts` (new) — `interface Window { goldfinch: GoldfinchBridge }` + a `GoldfinchBridge` type mirroring **every** key of `chrome-preload.js`'s exposed object (methods loosely typed; include `webviewPreloadPath: string` — it's a string property, not a method).
- `src/renderer/renderer.js` — `// @ts-check`; `Tab` typedef defined (fixing `:53`); `/** @type {Electron.WebviewTag} */` on `createElement('webview')` site(s); JSDoc annotations to zero errors.
- `src/preload/webview-preload.js` — `// @ts-check`; annotations to zero errors.

## Acceptance Criteria
- [ ] `jsconfig.json` `lib` includes `dom` + `dom.iterable`, and `include` covers `*.d.ts`; the Node-side files (Leg 3) still typecheck clean (re-run after the lib change — annotate any `setTimeout`/`clearTimeout` union break, expected none in main.js).
- [ ] `renderer.js` and `webview-preload.js` start with `// @ts-check` and typecheck with **zero errors**.
- [ ] The stray `@type {Map<string, Tab>}` at `renderer.js:53` resolves to a defined `Tab` typedef (shape: at least `{ id, webview, title, url, ... }` matching the object built in `createTab`). No "Cannot find name 'Tab'".
- [ ] `window.goldfinch.*` accesses in `renderer.js` are typed via a global `Window.goldfinch` declaration (`renderer-globals.d.ts`); no "Property 'goldfinch' does not exist on type 'Window'".
- [ ] The single `createElement('webview')` (`:111`) is cast `Electron.WebviewTag` and `Tab.webview` is typed `Electron.WebviewTag` — so the ~10 `tab.webview.*` call sites typecheck via inference (no per-callsite annotation).
- [ ] **`@ts-expect-error` budget ≤ 5** across both files, each with a one-line reason (most fixes are `@type` casts, which do NOT count toward this budget). If zero-errors genuinely needs >5 suppressions, STOP and report — that signals a missing upfront cast (e.g. `els` not typed), not an untypable spot. No bare `@ts-ignore`.
- [ ] `npm run typecheck` exits 0 (whole codebase now — Node + DOM); `npm test` still passes (147).

## Verification Steps
- `npm run typecheck` → exits 0.
- `grep -L "@ts-check" src/renderer/renderer.js src/preload/webview-preload.js` → empty (both annotated). Combined with Leg 3, **all** `src/**/*.js` now carry `@ts-check`.
- `grep -c "@ts-expect-error" src/renderer/renderer.js src/preload/webview-preload.js` → ≤5 total; `grep "@ts-ignore"` → none.
- `npm test` → green.

## Implementation Guidance
1. **jsconfig**: change `lib` to `["es2022", "dom", "dom.iterable"]`. Re-run `npm run typecheck` to confirm Node-side stays clean.
2. **`renderer-globals.d.ts`**: declare `interface Window { goldfinch: { downloadMedia(p:any):Promise<any>; chooseDownloadDir():Promise<string|null>; showItemInFolder(p:string):void; onPrivacyNet(cb:Function):void; ...all members of the chrome-preload bridge... } }`. Mirror the object in `chrome-preload.js` (each exposed key). Keep payloads loosely typed (`any`) where shapes are dynamic — the goal is "goldfinch is a known property", not exhaustive payload typing.
3. **Type `els` members upfront (highest-leverage step — do this FIRST)**: in the `els` object (`renderer.js:7-51`), cast each `getElementById` to its specific subtype so usages don't cascade errors — e.g. `address: /** @type {HTMLInputElement} */ (document.getElementById('address'))`, and `HTMLButtonElement` for `back`/`forward`/`reload`/etc. (`.disabled`), `HTMLAudioElement` for the audio player element (`.play()`). These are `@type` casts (NOT `@ts-expect-error` — they don't consume the suppression budget). Doing this first prevents 5–10 downstream errors.
4. **`renderer.js`**: add `// @ts-check`. Define `Tab` via `@typedef` (read `createTab` for fields; `webview: Electron.WebviewTag`) and apply at `:53`. Cast the one `createElement('webview')` (`:111`). Cast `e.target` in event handlers to the concrete element where `.classList`/`.value` is accessed (`:129-130` etc.); cast `querySelectorAll` results (`.filter` `.dataset` at `:292`). Walk `npm run typecheck`; reserve `@ts-expect-error` (≤5, each with a reason) for genuinely untypable spots only.
5. **`webview-preload.js`**: add `// @ts-check`. Annotate DOM/`ipcRenderer` usage; annotate the timer handles (`:159`,`:186`) `/** @type {ReturnType<typeof setTimeout>} */` (dom+node `setTimeout` union). `ipcRenderer.sendToHost`/`sendSync` typed via electron.
6. Re-run `npm run typecheck` (whole codebase, 0 errors) and `npm test` (annotations only — no behavior change).
- **Do not remove** the dead `pGroup` function (`renderer.js:992`, defined-not-called) in this leg — TS doesn't error on it (noUnusedLocals off); out of scope.

## Edge Cases
- **`Electron.WebviewTag` global namespace**: available because electron's types declare the global `Electron` namespace; if `Electron.WebviewTag` isn't resolved, reference via a JSDoc `import('electron').WebviewTag`.
- **`MutationObserver`/`document`/`HTMLElement`** in webview-preload: provided by the dom lib.
- **Suppression budget**: if zero errors needs >5 suppressions, STOP and report — the architect's analysis said ~10 webview sites are all castable, so >5 suppressions signals a wrong approach (likely a missing cast, not an untypable spot).
- **No behavior change**: annotations + a `.d.ts` only; `npm test` is the guard.

## Files Affected
- `jsconfig.json` — add dom lib + `*.d.ts` to include
- `src/renderer/renderer-globals.d.ts` — new (Window.goldfinch bridge type + Tab if shared)
- `src/renderer/renderer.js` — `@ts-check` + Tab typedef + `els` subtype casts + 1 WebviewTag cast + `e.target`/querySelectorAll casts
- `src/preload/webview-preload.js` — `@ts-check` + timer-handle annotations + DOM/ipcRenderer annotations
- `src/main/main.js` — only if the dom-lib `setTimeout` union requires a timer annotation (expected: none)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`) + `npm run typecheck` clean (whole codebase)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 4 of 7)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
