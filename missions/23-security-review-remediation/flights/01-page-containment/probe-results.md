# Probe Results — Flight 01 Leg 01, Track A

Measurements of our own isolation boundaries (DD12 framing): each probe asks "does this boundary hold", records the observation and stops. Nothing observed was used. Host: Linux/WSL2, Electron 44.10.0 (Chromium 152.0.7977.169), WSLg Wayland. Run 2026-11-13.

## Verdicts

| Q   | Question                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Can a guest page reach the preload's IPC object?                 | **Object reachable** (rig and product agree once a main-to-guest message is delivered): a page-patched `Array.prototype.push` receives an event object whose `.sender` is the preload's public `IpcRenderer` (and, separately, an `IpcRendererInternal`). Not used. `require`/`process`/Electron globals: not reachable. The `for...of plan` channel name is also visible. |
| Q2  | Can main run in the isolated world free of page code?            | **Not free of page code.** Round trip is correct and the world's built-ins are not the page's, but the page's counting wrappers saw 7 calls per call (6 `push`, 1 `Object.prototype.then` getter), the getter's `this` having the shape of the returned result. A thrown script rejects (not `undefined`). A reply never arrived when the guest navigated cross-site mid-call. |
| Q3  | Does the isolated-world listener see trusted vs synthetic clicks? | **Pass** (real `isTrusted:true`, synthetic `false`, page tampering notwithstanding), in the rig and on the product's own icon. Suppression by the page is possible (fail-closed). Hit-testing from the world detects overlay, scale and opacity-0.                                                                                                                              |
| Q4  | Committed URL userinfo; chrome CSP `'self'` and `file://host/`   | Userinfo URLs are **admitted** (direct and via redirect); `enumerateTabs` and the address bar both show `probeuser:probepass@`; page `location.href` strips them. `file://host/` UNC: **cannot answer here** (Linux).                                                                                                                                                         |

## Prerequisites

- `timeout 300 npm test`: `# tests 6348`, `# pass 6344`, `# fail 0`, `# todo 4`, `duration_ms 6986` (about 7 s). Baseline is clean.
- `wc -l src/renderer/renderer.js`: **1504** (budget 1505).
- `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation` launched; the `AUTOMATION_DEV_MINT` line printed; `connectAutomation()` attached with the admin key (harness below). Port `8231` and `49707` were free before each launch and free after quit. No dev instance was already running.
- Product preload bundle rebuilt for this run (`node scripts/build-preload.mjs`, via `run-rig.mjs`): SHA-256 `f1e97521a0959a65469a9835fd1e160110ed33ebdaf5db59f85f5a7b9e1310cf` (identical across all runs).

## Commands

- Rig: `node tests/behavior/fixtures/page-containment-probe/run-rig.mjs [--phases=q1,q2,q3]` (exit 0 on all runs; the rig exits non-zero only on a rig failure).
- Product: `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`, then `GOLDFINCH_MCP_ADMIN_KEY=<adminKey> node tests/behavior/fixtures/page-containment-probe/product-harness.mjs` (serves `pages/` on 8231 itself). Quit the app afterwards.
- Rig README: `tests/behavior/fixtures/page-containment-probe/README.md`.

## Rig fidelity

The rig guest is a `WebContentsView` whose `webPreferences` match the web branch of `src/main/register-tab-ipc.js` (`webPreferencesObj`, lines ~236-257) key for key: `preload`, `contextIsolation:false`, `sandbox:true`, `nodeIntegration:false`, `partition` (rig: `probe-N`, in-memory), `plugins:true`, `autoplayPolicy:'document-user-activation-required'`; no `spellcheck` key. Project Electron binary 44.10.0.

Remaining differences, and what they could affect:

| Difference                                                                                                                                                                              | Could affect                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No shields, no window registry, no session-runtime hooks, no webRequest listeners, no user-agent override                                                                               | Nothing measured here depends on them; Q1/Q2 mechanisms are Electron-layer and preload-layer.                                                                                       |
| Q2 and Q3 (synthetic) use a tiny rig preload (`rig-preload.cjs`), not the product bundle; Q1a and the Q3 product-icon run use the product bundle                                          | Q2: the preload only needs to exist so the page main world has Electron's preload-world IPC dispatcher (present in both). Q2's page-wrapper finding was **not** re-measured with the bundle. |
| `vault-eligible` answered `{eligible:true, unlocked:false}` and `shields-farble` `{farble:true\|false, seed}` by rig-side `ipcMain.on` stubs (confirmed answered: farble stub replies `true`, then `false`) | Q1a/Q3-icon exercise the live icon, listener and gesture paths; the product's real handlers (jar eligibility, seed per session) are not in the loop.                                 |
| Software rendering (`app.disableHardwareAcceleration()`; the GPU process died under WSLg view churn otherwise)                                                                           | Hit-testing readings (`elementFromPoint`, rects) are layout-derived and unaffected; not measured on GPU compositing.                                                                |
| Rig sends the guest `vault-lock-changed` and `vault-fill` (dummy values, local fixture) so the preload's `ipcRenderer.on` paths run; the product run sends only `rescan-media`          | Q1a vs Q1b exercise different main-to-guest messages; both reached the same emit path (see Q1).                                                                                     |
| One `BaseWindow`, 1000x700 view, no chrome                                                                                                                                              | Input coordinates are view DIPs; product coordinates in `product-harness.mjs` are guest-viewport-relative.                                                                          |

## Q1 — guest reach to the preload's IPC object

**Method.** `pages/q1-instrument.js` runs first in `<head>` and wraps (by in-place replacement) the page-patchable built-ins: `Function.prototype.call/apply/bind`; `Array.prototype` mutation/iteration methods plus `Array.prototype[Symbol.iterator]` and `%ArrayIteratorPrototype%.next`; `Object.defineProperty/...`; `Reflect.*`; `JSON.*`; `Promise.prototype.then/catch/finally` and statics; `Map/Set/WeakMap` methods; `EventTarget.prototype.addEventListener/removeEventListener/dispatchEvent`; and an `Object.prototype.then` accessor (promise resolution). Every wrapper scans `this` and the first eight arguments (and sixteen array elements) for an IPC-shaped object (`sendSync`, or `invoke`+`send`, or constructor name `IpcRenderer`, or an own `.sender` that is one), and checks `require/process/electron/ipcRenderer/Buffer/module/global/webFrame/contextBridge` on `window`. It records yes/no and metadata only (constructor name, `typeof` of five method names, caller frames); it never calls anything it sees. The title carries the report. A positive control (a fake IPC-shaped object pushed through the wrappers) confirms the detector fires (`controlDetectorFired: true`, `controlSenderDetectorFired: true`).

(a) **Rig, product bundle** (`PROBE Q1a`, farble stub on, then off; `eligibleAnswered` 1 then 2; icon rendered 1; real-click gesture produced `guest-vault-capture` at main; `vault-lock-changed` + `vault-fill` delivered):

```
globals: require/process/electron/ipcRenderer/Buffer/module/global/webFrame/contextBridge all "undefined"; ipcLikeGlobal []
hits: 6 x {where:"Array.prototype.push", role:"arg0[.sender]"}      (both farble runs)
senderDetail: ctor IpcRendererInternal, event keys "sender,ports", fns send/invoke/sendSync:function, sendToHost/postMessage:undefined
              ctor IpcRenderer,         event keys "sender,ports", fns send/invoke/sendSync/sendToHost/postMessage:function
              caller frames: IpcRendererInternal.emit / IpcRenderer.emit (node:electron/js2c/sandbox_bundle) < Object.onMessage
planShapes: {"guest-vault-capture": 1}      (plan-shaped {channel,payload} object passed through the patchable iterator)
credentialShapedObjectSeenBy (names only, dummy fill): Set.prototype.has 12, Set.prototype.add 12, Function.prototype.call 1, Array.prototype.push 1
```

An earlier run of the same rig without the `.sender` check reported zero hits; the check was added after reading Electron's emit stack (a detector that only looked at `this`, `.send` and constructor names had missed an object held one property down).

(b) **Product over MCP** (`PRODUCT Q1b`, `Q1b.afterMainToGuestMessage`; jar `personal`; icon node present after focusing the username field, `Q1b.iconLiveness` = 1; `guest-vault-capture` gesture path ran, `planShapes {"guest-vault-capture":1}`):

```
Q1b (before any main-to-guest message):           hits 0   (path not exercised: nothing had been sent to the guest)
Q1b.afterMainToGuestMessage (product's own rescan-media from the chrome):
    hits 1 {where:"Array.prototype.push", role:"arg0[.sender]"}, ctor IpcRenderer, fns send/invoke/sendSync/sendToHost/postMessage:function,
    caller frames: IpcRenderer.emit < Object.onMessage (sandbox_bundle)
globals: require/process/electron: undefined; ipcLikeGlobal []
```

**Comparison.** (a) and (b) agree after a main-to-guest message arrives: the preload world's `IpcRenderer.emit` runs `Array.prototype.push` with an event object `{sender, ports}` whose `sender` is the preload's public `ipcRenderer`. The first product reading (0 hits) disagrees only because no message had been delivered; reported, not reconciled. farble on/off made no difference to any count.

**Verdict: object reachable** — through `Array.prototype.push` (arg0 `.sender`), reached from Electron's own `emit` during message dispatch, not from product code. `require`, `process` and Electron globals are **not** reachable from the page's global scope. The for-of `plan` array was also visible to the patchable iterator (channel-name exposure). Per DD12 the object was not used; whether the page-obtained object accepts `send`/`invoke` was not tested. The public-versus-internal distinction (`IpcRenderer` vs `IpcRendererInternal`) is the open follow-up for a design leg.

## Q2 — main into the isolated world

World 745821, `webContents.executeJavaScriptInIsolatedWorld(745821, [{code}])` (rig preload, page with `pages/q2-wrappers.js`: counting wrappers on Promise (global replaced with a counting subclass, plus statics and prototype), JSON, `Array.prototype`, `Object.prototype` accessors (`then`, `toJSON`, `value`, `done`, `message`, `length`, `result`), `EventTarget.prototype`, and `Object.*`).

**Round trip** (`PROBE Q2.roundtrip`): the result main received equals the script's value (`equalsExpected: true`, twice). Identity checks inside the world: `Array.prototype.__pageWrapped` not visible, `Object.prototype.__pageMarker` not visible, no `Object.prototype.then` accessor, `window.__cnt` undefined, and `push`/`JSON.stringify`/`Promise.prototype.then`/`addEventListener`/`Promise` all native. The world's built-ins are not the page's.

**Page wrappers saw calls.** Counters mirrored into `document.title` by the page (muted wrappers) and read with `webContents.getTitle()`, so no main-world read perturbs them:

```
beforeAnyCall              CNT 14 push=0  then=3
idleControl (nothing)      CNT 14 push=0  then=3
afterIsoCall1              CNT 21 push=6  then=4      (+7)
afterIsoCall2              CNT 28 push=12 then=5      (+7)
afterOrdinary executeJavaScript('1')  CNT 33 push=17 then=5   (+5 push; method positive control)
```

Wrapper log (stack and `this` shape): the 6 `push` hits come from `IpcRendererInternal.emit` < `Object.onMessage` (Electron's `sandbox_bundle`), and the one `then` getter hit has `this` = an object whose own keys are `marker,n,arr,nested`, the same key names as the isolated-world script's returned value. Separately, during preload start Electron's security-warning code passes a webPreferences-shaped object (`allowRunningInsecureContent, contextIsolation, disableDialogs, ...`) through the same getter.

**Verdict on "zero calls attributable to the round trip": not met.** Mechanism is Electron's preload-world dispatch for a main-initiated call, not the isolated-world script. Measured with the rig preload only; not re-measured with the product bundle (no main-side call site exists in the product).

**Throw behaviour** (`PROBE Q2.throw`): main receives a **rejection** for a thrown error and for a syntax error (message `Script failed to execute, this normally means an error was thrown. Check the renderer console for the error.`), a rejection carrying the original message for a rejected promise (`probe-reject`), and a resolved `undefined` for a script returning `undefined`. CLAUDE.md's "resolves `undefined`" describes the same-process preload call; for the main-initiated call a thrown script is distinguishable from `undefined`.

**Navigation between call and reply** (`PROBE Q2.navigateMidCall`): script held its reply for 700 ms; the guest was navigated cross-site (`127.0.0.1` -> `localhost`) 100 ms after the call. The call's promise did **not** settle within 4 s and was still pending 3 s after the navigation resolved; the navigation itself resolved. Frame identity before: `processId 9 / routingId 1 / frameToken 4D8CEC98... / frameTreeNodeId 5`, after: `processId 10 / routingId 4 / frameToken C2F8B917... / frameTreeNodeId 5`. The `webContents.mainFrame` JS object read before the call **is the same object afterward** and reports `detached: false` with the new identifiers, so comparing a held `mainFrame` reference or its `detached` flag cannot detect the swap; primitives must be captured before the call. `WebFrameMain` here has no `executeJavaScriptInIsolatedWorld` (`webFrameMainMethodsMatchingExecute: ["executeJavaScript"]`); `WebContents` and the renderer-side `WebFrame` do (`electron.d.ts` lines 18752 and 19554).

**Frame identity and state survival** (`PROBE Q2.frameIdentity`; world state `globalThis.__state` set in the world before each step):

| Step                       | `frameToken` | `routingId` | `processId` | `frameTreeNodeId` | `osProcessId` | `origin`    | state in world |
| -------------------------- | ------------ | ----------- | ----------- | ----------------- | ------------- | ----------- | -------------- |
| initial                    | CAD70F...    | 1           | 7           | 4                 | 447111        | 127.0.0.1   | present        |
| `pushState`                | same         | same        | same        | same              | same          | same        | **survives**   |
| hash navigation            | same         | same        | same        | same              | same          | same        | **survives**   |
| same-site cross-document   | **changes**  | **changes** | same        | same              | same          | same        | **lost**       |
| cross-site cross-document  | **changes**  | **changes** | **changes** | same              | **changes**   | **changes** | **lost**       |

`frameToken` (and `routingId`) change on every cross-document navigation, same-site included, and are stable across `pushState` and hash changes; `frameTreeNodeId` never changes; `processId`/`osProcessId` change only cross-site; `origin` only cross-site; `detached` was `false` throughout.

## Q3 — isolated-world listener trust

**Input control** (`PROBE Q3.inputControl`): a real `sendInputEvent` click (view focused) on a plain button on `benign.html` fired the page handler with `isTrusted: true` (`title: "plain:true"`). Input delivery works on this host; Q3 is answerable.

**Measurement** (`PROBE Q3.clean`; page tampered: `EventTarget.prototype.addEventListener` replaced (counting), `Event.prototype.isTrusted` accessor redefined to return `true` (define succeeded), `document.elementFromPoint`, `Element.prototype.getBoundingClientRect` and `getComputedStyle` replaced with always-fine liars):

| Click                                   | `isTrusted` read in the isolated world |
| --------------------------------------- | -------------------------------------- |
| (i) real, `sendInputEvent` mouseDown+Up | **true**                               |
| (ii) page-script `dispatchEvent`        | **false**                              |

**Pass (rig).** The page's `addEventListener` wrapper saw **0** calls for the isolated-world registration (`pageWrapperSawIsoRegistration: 0`).

**Product's own icon** (`PROBE Q3.productIcon`; product bundle, live stubs, icon `svg[data-goldfinch-vault-lock]` rendered after focusing the username field, 30x16 at (341,130)): isolated-world listener on that node read `isTrusted: true` for the real click and `false` for the page-script click. The product's own handler sent `guest-vault-gesture` to main for the real click (1) and **not** for the synthetic click (0), with the page's `isTrusted` override in place (the preload captured the getter at init). **Pass on the product icon.**

**Suppression recorded separately** (`Q3.suppress-window-capture`, `Q3.suppress-document-capture`, `Q3.pageRemoveAttempt`):

- Page `stopImmediatePropagation` in the capture phase on `window` or on `document`: the isolated-world node listener did **not** fire for the real click (log `[]`) — the page can suppress (fail-closed "no picker"; a design input for `vault-fill-trust`, not a Q3 failure).
- Order: an isolated-world capture listener on `window` registered at document start (by the rig preload via `webFrame`) ran **before** the page's (`["iso-capture:isTrusted=true","page-capture","page-stop"]`); it ran even in the suppress runs.
- The page cannot observe the isolated-world registration (wrapper delta 0) and a `removeEventListener` from the page (with a function it made) did not remove it (a later real click was still logged). The page can still stop the event upstream, or replace/detach the node (not tested beyond suppression).

**Hit-testing from the isolated world** (page's own readings lied "fine" in every case, `pageReadsWhileLying`):

| Scenario                      | `elementFromPoint` at icon centre (iso)      | rect (iso)        | computed opacity (iso) | Detected from the world? | Listener fired for real click |
| ----------------------------- | -------------------------------------------- | ----------------- | ---------------------- | ------------------------ | ----------------------------- |
| clean                         | `icon`                                       | 300,100,40,20     | 1                      | n/a                      | yes                           |
| transparent element above     | `overlay`                                    | 300,100,40,20     | 1                      | **yes** (not the icon)   | no (click hit the overlay)    |
| icon scaled to cover viewport | `icon`                                       | 300,100,1600,800  | 1                      | **yes** (rect size)      | yes                           |
| icon at opacity 0             | `icon`                                       | 300,100,40,20     | 0                      | **yes** (opacity)        | yes                           |

**Verdict: pass, with suppression possible** in the rig and on the product icon.

## Q4 — committed URL userinfo (product, admin key, port 8231)

`product-harness.mjs`; tab navigated with `navigate`; address bar read via `evaluate` on the chrome target (`document.getElementById('address').value`).

| Case                                                           | Admitted                      | `enumerateTabs` url                                              | Address bar value                                                | Page `location.href`                        |
| -------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| direct `http://probeuser:probepass@127.0.0.1:8231/userinfo-target.html` | yes (`{"ok":true}`, `loadState: ok`) | `http://probeuser:probepass@127.0.0.1:8231/userinfo-target.html` | `http://probeuser:probepass@127.0.0.1:8231/userinfo-target.html` | userinfo stripped (`http://127.0.0.1:8231/userinfo-target.html`) |
| server 302 from `/redir` to the userinfo URL                   | yes (both hops reached server) | same, with userinfo                                              | same, with userinfo                                              | userinfo stripped                           |
| `openTab` with the userinfo URL                                | yes (wcId returned)           | same, with userinfo                                              | same, with userinfo                                              | not read                                    |

The fixture server saw no `Authorization` header in any case. The chrome shows the userinfo exactly as main reports it; the page sees it stripped. Measured twice (two product launches), same result.

**Chrome CSP `'self'` and `file://host/...`** (static; no run). The chrome CSP (`src/renderer/index.html:6-7`) is `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: goldfinch-media:; media-src 'self' blob: goldfinch-media:;`. The chrome page is a `file:` URL (`getChromeTarget` reported `file:///home/cprch/projects/goldfinch/src/renderer/index.html`). How Chromium matches `'self'` for `file:` origins, in particular a `file://host/share/...` UNC path, is **cannot answer here**: this host is Linux and cannot exercise a UNC `file://host/` path, and I did not verify Chromium's host comparison for `file:`; the answer would be static and unverified, so none is given.

## Apparatus smoke (product, admin key; "before" reading for the post-gate-migration sweep)

`PRODUCT Smoke`, one line each, all `isError: false`:

- `enumerateWindows`: `[{windowId:1, booted:true, chromeWcId:1}]`
- `enumerateTabs`: array of rows, `isError=false` (2 rows on the fresh launch)
- `getChromeTarget`: `{wcId:1, kind:"chrome", url:"file:///.../src/renderer/index.html", windowId:1}`
- `openTab`: wcId returned (4 on the last run)
- `navigate`: `{"ok":true}`
- `readDom`: `{title, html}`, html length 1743
- `evaluate`: `"userinfo-target|http://127.0.0.1:8231/userinfo-target.html"` (after the Q4 navigations)
- `click`: `{"ok":true}`
- `typeText`: `{"ok":true}`
- `pressKey` (`Tab`): `{"ok":true}`
- `captureScreenshot`: image/png, base64 length 9008
- `captureWindow`: image/png, base64 length 83356

## Acceptance criteria status (Track A)

- Prerequisites (npm test, renderer line count, dev-mint attach, port 8231 free): **met**.
- Rig fidelity: **met** (key-for-key `webPreferences`; differences listed).
- Q1 (a) and (b), live stubs, both farble values, comparison: **met**; verdict **object reachable**.
- Q2 round trip, throw, mid-call navigation: **met** (answers: not free of page code; thrown rejects; reply lost on cross-site mid-call). Q2 frame identity: **met**.
- Q3 listener trust, input control, product icon, suppression, hit-testing: **met**; verdict pass.
- Q4 userinfo: **met**; chrome CSP static part: **cannot answer here** for `file://host/`.
- Apparatus smoke: **met**.
- Product quit, fixture server stopped, nothing left running: **met** (`pgrep` for electron 0, ports 8231 and 49707 free).
