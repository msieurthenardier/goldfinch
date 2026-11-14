# Gesture-transport probe (G1-G8)

Rig: `tests/behavior/fixtures/page-containment-probe/` (`--phases=g`, code in `gesture-phase.cjs`). Electron 44.10.0, Chromium 152.0.7977.169, Linux/WSLg (ozone wayland), guest `webPreferences` mirror the web-guest branch (`contextIsolation:false`, `sandbox:true`, `partition`, rig preload). Page-side hostile wrappers are `q2-wrappers.js` (+ `g-argscan.js`, an argument scanner). Counters are read as in Q2 (page mirrors its counters into `document.title`, main reads `getTitle()`).

Re-run: `node tests/behavior/fixtures/page-containment-probe/run-rig.mjs --phases=g` (subset: `--phases=g3,g6`). Exit 0 unless the rig fails.

## Verdict table

| Probe  | Question                                         | Verdict                                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | main-side events for real vs synthetic click     | HOLDS for the rig's input path. `input-event` and `before-mouse-event` both fire for `sendInputEvent` mouseMove/Down/Up with type/x/y/button/clickCount/globalX/globalY/modifiers; neither fires for `el.click()` or dispatched `MouseEvent`s (0 events). Page wrappers saw 0 calls attributable to the events. |
| **G2** | coordinate space                                 | HOLDS with a rule: main `x,y` are view-local DIPs after zoom, so `mainX = clientX * zoomFactor`; scroll does not matter (both are viewport-relative). Device emulation (dsf 2) does not change the mapping. `globalX/Y` are 0 here (useless).                                                                    |
| **G3** | ordering/timing                                  | Main event first in 30/30 clicks (and 10/10 with the page main thread blocked). Idle gap 0-2 ms (`Date.now()`); with the page blocked 49-90 ms. `before-mouse-event` precedes `input-event` for the same event.                                                                                                |
| **G4** | keyboard and context-menu                        | `before-input-event` + `input-event` fire for Enter/Space (type/key/code/modifiers only). Main learns nothing about which element has focus. `context-menu` fires for a real right-click with x/y (and a `frame`), not for a synthetic `contextmenu` dispatch.                                                   |
| **G5** | subframes                                        | Main-side events fire on the top-level webContents in TOP-LEVEL coordinates, for same-site AND cross-site iframes; neither `event` nor `inputEvent` identifies a frame. `context-menu` params DO carry `frame` (WebFrameMain) and `frameURL`, but for the cross-site case it named the top frame, not the iframe.  |
| **G6** | can the page alter the isolated-world reply?     | YES. Page `Object.prototype.then` getter substituted an object reply and a promise-resolved reply; a `Promise.prototype.then` wrapper substituted a promise-resolved reply. Plain string replies and the `toJSON` hook were not altered.                                                                        |
| **G7** | is the outbound code text page-visible?          | YES. A marker present only in the code reaches page-world wrappers (`Array.prototype.push` argument). Same for the reply, and for main-world `executeJavaScript`.                                                                                                                                                |
| **G8a** | debugger `Runtime.evaluate` into world 745821    | WORKS and is page-invisible: correct result, 0 scanner hits for expression and reply, page counter delta equal to bare attach overhead of the rig's own reads (no marker hit). Holds the single debugger slot (second attach throws).                                                                          |
| **G8b** | `insertText`                                     | Text reaches the field, but is ALSO page-visible: 4 wrapper hits carrying the text vs 0 for a real key press; counter +4 vs +0.                                                                                                                                                                                  |

Rig limit that applies to everything above: input is delivered only via `webContents.sendInputEvent`; no physical pointer exists on this host. Whether OS input takes the same renderer-host path is not measured here (typings/docs do not say; `input-event` is documented only as "emitted when an input event is sent to the WebContents", `before-mouse-event` as "before dispatching mouse events in the page"). The main-side x/y in G2 are the values the rig supplied, so G2 shows the mapping rule, not independent hit-testing.

## G1 - main-side input events

Method: attach `input-event`, `before-mouse-event`, `before-input-event`, `context-menu` to the guest. Input control first: plain button page handler reports `isTrusted:true` for a rig click. Then (a) click at the stand-in centre, (b) page-script `icon.click()` + `dispatchEvent(new MouseEvent(...))` x3. Counter method: page counters read before/after a click with no main listeners and with all four attached.

```
G1.inputControl  pageHandlerLog ["plain:mousedown:trusted=true","plain:mouseup:trusted=true","plain:click:trusted=true"]
G1.realClick     before-mouse-event/input-event each: mouseMove, mouseDown, mouseUp
  ev: {"type":"mouseDown","clickCount":1,"movementX":0,"movementY":0,"button":"left","globalX":0,"globalY":0,"x":320,"y":110}
  event object enumerable keys: ["preventDefault","defaultPrevented"]
  isolated-world DOM: pointerdown, mousedown, mouseup, click, all isTrusted:true, tgt icon
  counters: before "CNT 1358 push=23 then=4"; after click, no main listeners "CNT 1358 push=23 then=4";
            with listeners, before "CNT 1364 push=29 then=4", after "CNT 1364 push=29 then=4"
G1.syntheticClick mainEventsCount 0; DOM click x2, mousedown, mouseup, all isTrusted:false
```

Fields: `type, x, y, button, clickCount, movementX/Y, globalX/Y (0), modifiers`; no timestamp field on the event (rig timestamps are its own `Date.now()`), no target, no frame. Verdict: main-side events are produced by the browser-side input path, are not produced by page script, and the page counters show no change from the click with or without main listeners (delta 0 both).

## G2 - coordinate space

Method: for each state, send the click at three candidate coordinates (A: css centre, B: css centre x zoom, C: css centre x dpr), record main `input-event` x/y, DOM `clientX/Y` and target.

```
default zoom          A=B=C sent [320,110]  main [320,110] dom [320,110] icon
scrollY=60            icon css cy 50: sent [320,50] main [320,50] dom [320,50] icon
setZoomFactor(1.5)    dpr 1.5, innerWidth 667; icon css centre [320,110]
   A sent [320,110] -> main [320,110] dom [213,73]  target BODY   (missed)
   B sent [480,165] -> main [480,165] dom [320,110] target icon   (hit)
device emulation dsf2 dpr 2; A/B sent [320,110] main [320,110] dom [320,110] icon;  C sent [640,220] -> dom [640,220] BODY (missed)
```

Rule: `mainX = clientX * zoomFactor`, `mainY = clientY * zoomFactor`, view-local (origin = the view's top-left); equivalently `clientX = mainX / zoomFactor`. Scroll offset is not part of it (use the rect from `getBoundingClientRect()`, already viewport-relative). dsf emulation: no effect on main coordinates. `visualViewport.scale` stayed 1; pinch-zoom was not tested.

## G3 - ordering and timing

Method: five clicks idle and five with a 150 ms busy loop in the page main thread; main records `Date.now()` and `performance.timeOrigin+now()`, the isolated world records both for `mousedown`/`click`.

```
G3.idle     DateNow gap input-event mouseDown -> DOM mousedown: 1,2,2,2,1 ms; mouseUp -> click: 1,1,2,2,0 ms; mainFirst true x5
G3.pageMainThreadBlocked  mouseDown -> mousedown 89-90 ms; mouseUp -> click 48-49 ms; mainFirst true x5
before-mouse-event precedes input-event for the same event in every run
```

Caveat: the two processes' `performance.timeOrigin` clocks are skewed by ~187 ms in this rig (a raw hi-res comparison showed a constant 187 ms), so only the `Date.now()` gaps above are trustworthy (1 ms resolution). Verdict: main-side event precedes the DOM event in every run; the gap is small when the page is idle and grows when the page is busy, so a time window must be tolerant of tens of ms to hundreds under load.

## G4 - keyboard and context-menu

Method: focus the stand-in `<button>` in the isolated world (`activeElement` = icon), `sendInputEvent` keyDown/char/keyUp for Enter and Space; separate right-click, and a synthetic `contextmenu` dispatch.

```
Enter: before-input-event keyDown, input-event rawKeyDown, char, keyUp; before-input-event keyUp
  Input: {"type":"keyDown","key":"Enter","code":"Enter","isAutoRepeat":false,"isComposing":false,"shift":..,"control":..,"alt":..,"meta":..,"location":0,"modifiers":[]}
  DOM: keydown, click (isTrusted:true), keyup       Space: DOM keydown, keyup, click
Context menu (real right-click at [320,110]): before-mouse-event/input-event mouseDown (button right), context-menu {x:320,y:110,frame:{url,processId,routingId},frameURL,...}, mouseUp; DOM mousedown, contextmenu (isTrusted true), mouseup
Synthetic contextmenu dispatch: main events []; DOM contextmenu isTrusted:false
```

Main-side keyboard data contains no target element, no focus information and no frame. Verdict: main cannot know which element had focus without asking the page (or a debugger/CDP read).

## G5 - subframes

Method: top-level page with an iframe at (100,150); stand-in inside at (50,30) in the frame, so top-level centre is (170,190), expected inner client (70,40). Same-site origin `127.0.0.1`, cross-site `localhost`.

```
same-site (same process as main)   main events x:170,y:190 (all six); inner page saw mousedown/mouseup/click trusted=true client=70,40
cross-site (frame processId != main) main events x:170,y:190 (all six); inner page saw [] (event not delivered by sendInputEvent)
event keys: ["preventDefault","defaultPrevented"] in both
context-menu same-site:  frame {url: .../g-inner.html, processId 5, routingId 4}, frameURL g-inner.html, x:170,y:190
context-menu cross-site: frame {url: .../g-frame.html?inner=..., processId 6, routingId 1}   (the TOP frame), x:170,y:190
```

Verdict: mouse/key events are not frame-identifying; coordinates are top-level view space for any frame. For `context-menu`, `params.frame` names the frame for the same-site case but named the top frame in the cross-site (OOPIF) case here. The cross-site result for the inner click is a rig limit (`sendInputEvent` cannot reach an OOPIF, as the project docs already record), so "main event fired but the frame received nothing" is a rig artifact, not evidence about real OS input.

## G6 - can the page alter the isolated-world reply?

Method: three page hook modes, each in its own guest, inert markers only. Control: the hook alters a page-world promise. Main calls `executeJavaScriptInIsolatedWorld(745821, ...)` three ways (object reply, string reply, `Promise.resolve(object)`).

```
modeA Object.prototype.then getter:  control ctl:"SUBSTITUTE"; main received object {"marker":"SUBSTITUTE"}; string "ORIG-STRING"; promise value {"marker":"SUBSTITUTE"}; hook calls during iso calls: then=5
modeB Promise.prototype.then wrapper: control "SUBSTITUTE"; object {"marker":"ORIG-obj"}; string "ORIG-STRING"; promise value {"marker":"SUBSTITUTE"}; ptThen=1
modeC Object.prototype.toJSON getter: control not applicable; object ORIG, string ORIG, promise ORIG; hook calls 0
```

Verdict: yes, for object-valued replies a page can substitute the reply main receives. Primitive (string) replies were not altered by these hooks; that is a statement about these hooks, not a proof that primitives are safe.

## G7 - is the outbound code text page-visible?

Method: `g-argscan.js` wraps built-ins (JSON, Reflect, Object, Array/String/Promise/EventTarget/Map/Set/RegExp prototypes, console) and records a label when an argument or receiver contains `INERT`. Positive control: page-world `JSON.stringify` of a marker string. Calls: marker only in code (reply `"benign"`); marker only in reply (code built from two literals, reply `"G7-INERT-SPLIT"`); main-world `executeJavaScript` with the marker only in a comment.

```
scanner control (JSON.stringify of marker in the page): n=6 (JSON.stringify@arg0 + 5)
marker only in CODE, reply "benign":   +5 hits: iterator@this(array), push@arg0, push@this(array), iterator@this(array), iterator@this(array)
marker only in REPLY:                   +5 hits, same signature
main-world executeJavaScript, marker only in code: +5 hits, same signature
```

Verdict: yes, a payload embedded in the code text, and the reply, are visible to page-world wrappers (`Array.prototype.push` receives it). Same signature for all three, consistent with Q2's finding that Electron's dispatch of these calls runs through page-world built-ins.

## G8 - delivery alternatives

(a) `webContents.debugger.attach('1.3')`, `Runtime.enable`, collect `Runtime.executionContextCreated`.

```
contexts: {id:2, name:"", origin:"", auxData:{type:"isolated", isDefault:false}} (marker __wmark="w745821" found here), {id:1, origin: http://127.0.0.1:..., type:"default"}
Runtime.evaluate {contextId:2, expression:'/* G8A-INERT-EXPR */ ({marker:"G8A-INERT-REPLY", n:42})', returnByValue:true} -> {"marker":"G8A-INERT-REPLY","n":42}
scanner hits: before attach 0; after attach+enable+context search 0; after evaluate 0; after the same call through the Electron API (control) 5
page counters: before "CNT 1345 push=12", after attach/enable "push=17", after evaluate "push=22" (these deltas are the rig's own reads: title polling and getTitle; scanner hits stayed 0)
second attach while held: "Debugger is already attached to the target"; isAttached true; detach -> false
Page.createIsolatedWorld: makes a NEW world (contextId 3, __wmark undefined), cannot address 745821
```

Contexts for an existing world are found by evaluating a marker in each `isolated` context (name is empty because `webFrame` created it without world info); there is no way to select by world id 745821. The counter deltas in this row are not attributable to the evaluate call (the same-size increments appear around any rig read), so the scanner (0 hits) is the stronger observation; a counter-only reading of "zero wrapper calls" is not claimed.

(b) `webContents.insertText`.

```
focused field via real click (activeElement f); insertText("G8B-INERT-TEXT") -> field value "G8B-INERT-TEXT"; page's own handlers saw beforeinput/input data=G8B-INERT-TEXT (trusted:true)
scanner: before 0; after 4 hits (iterator@this(array), push@arg0, iterator, iterator)
control, real key events of 'inert' (one char per event): 0 hits
counter control without marker: real key 'x' -> no change (push=69 -> 69); insertText('x') -> push 69 -> 73
```

Verdict: insertText works, but the text also passes through page-world built-ins (beyond the field's own DOM value and input events). The real-key control types one character per event, so it cannot trip a multi-character marker scanner; the marker-free counter control (+0 vs +4) is the comparison that carries the claim.

## What a design could rely on (facts)

- With `sendInputEvent`, `input-event` and `before-mouse-event` fire main-side for mouse down/up/move with x/y/button/clickCount/modifiers; they do not fire for page-script clicks (`el.click()`, `dispatchEvent`). `before-input-event`/`input-event` fire for keys. `context-menu` fires for a real right-click and not for a synthetic `contextmenu` event.
- The page's counting wrappers observed nothing from main receiving these events (delta 0 for the click with and without listeners).
- The main event preceded the DOM `mousedown`/`click` in 100% of measured clicks (idle gap 0-2 ms, blocked-page gap up to ~90 ms).
- x/y relate to `getBoundingClientRect()` centre by `mainX = clientX * zoomFactor` in view-local coordinates; scroll and dsf emulation did not change the mapping.
- Main-side mouse/key events carry no target element, no focus information and no frame; `context-menu` params carry a `frame` (correct for a same-site iframe, the top frame for the cross-site one tested).
- `webContents.debugger` + `Runtime.evaluate` with a `contextId` of the existing isolated world returns a correct result with zero page-visible calls for expression and reply, while holding the single debugger slot.

## What a design could not rely on (facts)

- The reply of a main-initiated `executeJavaScriptInIsolatedWorld` call: for object replies a page can substitute it (G6).
- Secrecy of anything placed in the code text or the reply of that API, or of main-world `executeJavaScript`, or of text sent with `webContents.insertText` (G7, G8b).
- Any binding between a main-side event and a particular element: main has only coordinates, and for key events nothing at all (G2, G4).
- Frame identity from mouse/key events; coordinates are always top-level (G5).
- Real OS input behaving like `sendInputEvent` (not measurable here); `globalX/globalY` (always 0 here); delivery of `sendInputEvent` into a cross-site iframe.
- Having the debugger slot free: attaching blocks DevTools/automation `readAxTree`/`scroll`, and a second attach throws.
- Selecting an isolated world by id over CDP: contexts must be discovered by probing a marker.
