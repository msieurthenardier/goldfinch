# Leg: frameless-window-shell

**Status**: completed
**Flight**: [Tab-Bar Control Restructure](../flight.md)

## Objective
Remove the OS window frame and supply Goldfinch's own chrome: a `process.platform` branch in
`main.js` (`frame:false` on Windows/Linux; `titleBarStyle:'hidden'` + `trafficLightPosition` on
macOS), a reserved right-side zone in the tab strip for the custom window controls (filled in
leg 5), and `-webkit-app-region` drag / no-drag regions so the window stays movable while controls
and tabs stay clickable (DD6; mission SC9 + SC8).

## Context
- Flight **DD6**: macOS uses `titleBarStyle:'hidden'` + `trafficLightPosition` (native traffic
  lights inset); Windows/Linux use `frame:false` with our own controls. Branch on
  `process.platform` at the `new BrowserWindow` call (`main.js:17`). `minWidth:900`/`minHeight:600`
  (`main.js:20-21`) are preserved.
- **DD6 quit-path consistency (Architect)**: the custom **close** button (leg 5) must call
  `win.close()` (→ `closed` → `window-all-closed` → `app.quit()` on non-darwin, `main.js:514-516`),
  not `app.quit()` directly. Leg 4 does **not** add the close button — it only changes the frame —
  but it must not disturb the existing `window-all-closed`/quit path that leg 5 relies on.
- **DD6 frameless-resize risk + divert trigger (Architect)**: with `frame:false` on Linux/WSLg,
  resize grips / window snapping vary by compositor. The flight requires leg 4 to **open with a
  resize spike** confirming the window is still resizable before leg 5 builds on it; if it is not,
  **split legs 4–5 into Flight 1b** and land renderer-only legs 1–3. **Per operator decision
  ("code 4–5 now, verify all later") the live resize spike is deferred to the `verify-integration`
  session — it is deferred, NOT skipped.** The divert trigger stays armed and is decided live: if
  the frameless window is non-resizable/un-snappable on WSLg at verify time and not quickly
  fixable, legs 4–5 split into Flight 1b. This leg records that the spike is outstanding.
- Flight **DD7** (read path) is leg 5's concern; leg 4 only lays the reserved zone + drag regions
  the controls live in.
- **Renderer needs to know the platform**: the mac path hides the custom right-zone controls (leg 5)
  and insets native traffic lights on the left, while win/linux show custom controls on the right.
  This leg exposes `platform` on the `goldfinch` contextBridge surface (`chrome-preload.js`) and
  tags `<html>` with a `platform-{process.platform}` class so CSS (this leg's mac left-inset; leg
  5's mac control-hiding) can branch. This is the minimal shared foundation both window-chrome legs
  need.
- **Drag-region model (Electron)**: `-webkit-app-region: drag` makes an area a window-move handle;
  interactive children must be `-webkit-app-region: no-drag` or they can't be clicked. Make the
  tab-strip background draggable and mark the pill, the tabs, and (leg 5) the window-control
  buttons `no-drag`.
- Live verification is the `responsive-tab-strip` behavior test **Step 7** (maximize — leg 5's read
  path) and the flight's **manual** checks (drag-to-move, resize spike), all deferred to
  `verify-integration`. In-leg verification is code/markup presence + offline gates.
- **Tooling**: `jsconfig.json` sets `checkJs:true` over `include: ["src/**/*.js"]`, so `main.js`,
  the preload, and the renderer are all in the `tsc` typecheck scope (no per-file `// @ts-check`
  directive needed). Two type touchpoints this leg must handle:
  - **`window.goldfinch` is statically typed** by `src/renderer/renderer-globals.d.ts` via a
    `GoldfinchBridge` interface that **explicitly mirrors the preload surface** (the same way
    `webviewPreloadPath` is declared in both). Adding `platform` to the preload **requires** adding
    it to that interface, or `window.goldfinch.platform` raises "Property 'platform' does not exist
    on type 'GoldfinchBridge'" and the typecheck gate fails.
  - The conditional `frameOpts` ternary widens `titleBarStyle: 'hidden'` to `string`, which is not
    assignable to Electron's `titleBarStyle` literal union — so `frameOpts` **must** be annotated
    `/** @type {Electron.BrowserWindowConstructorOptions} */` (the `Electron.*` namespace is already
    available globally; the renderer uses `Electron.WebviewTag` and typechecks clean).

## Inputs
What must be true before this leg runs:
- Legs 1–3 landed (working tree, uncommitted): `#tabstrip` contains `#newtab-pill` + `#tabs`.
- `src/main/main.js` — `createWindow()` with `new BrowserWindow({...})` (`:16-33`, options at
  `:17-32`); `minWidth:900`/`minHeight:600` (`:20-21`); `mainWindow.on('closed')` (`:46-48`);
  `app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); })`
  (`:514-516`).
- `src/preload/chrome-preload.js` — `contextBridge.exposeInMainWorld('goldfinch', {...})` surface.
- `src/renderer/index.html` — `#tabstrip` (`:14`) wraps `#newtab-pill` (`:15`) + `#tabs` (`:28`).
- `src/renderer/styles.css` — `#tabstrip` (`:40-46`), `#tabs` (`:47-53`), `#newtab-pill` (`:54-84`),
  `.tab` (`:85-99`).
- Offline gates green.

## Outputs
What exists after this leg completes:
- `main.js` creates the window frameless per platform (`frame:false` win/linux; `titleBarStyle:
  'hidden'` + `trafficLightPosition` mac), minWidth/minHeight preserved.
- `goldfinch.platform` exposed; `<html>` carries a `platform-{platform}` class.
- A reserved right-side zone (`#window-controls`) exists at the end of `#tabstrip` (empty
  placeholder for leg 5).
- `#tabstrip` background is a drag region; pill + tabs are `no-drag`; the window stays movable.
- macOS gets a left inset on `#tabstrip` so the pill clears the native traffic lights (default,
  flagged for mac recheck).
- Offline gates green. **Resize spike outstanding** (deferred to `verify-integration`).

## Acceptance Criteria
- [x] `main.js` builds the `BrowserWindow` options with a `process.platform` branch: `frame: false`
  on Windows/Linux; `titleBarStyle: 'hidden'` + a `trafficLightPosition` on macOS. `width`,
  `height`, `minWidth: 900`, `minHeight: 600`, `backgroundColor`, `title`, `icon`, and the full
  `webPreferences` block are all preserved unchanged.
- [x] The existing `window-all-closed` → `app.quit()` (non-darwin) path (`main.js:514-516`) and the
  `mainWindow.on('closed')` handler are left intact (leg 5's close button depends on them).
- [x] `chrome-preload.js` exposes `platform: process.platform` on the `goldfinch` bridge object.
- [x] `src/renderer/renderer-globals.d.ts` — the `GoldfinchBridge` interface gains
  `platform: string;` (mirroring the new preload field), so `window.goldfinch.platform` typechecks.
- [x] On load, the renderer adds a `platform-${window.goldfinch?.platform ?? 'unknown'}` class to
  `document.documentElement` (e.g. `platform-linux` / `platform-win32` / `platform-darwin`). The
  optional-chain guards against any non-preload load path so init never aborts at the top level.
- [x] `index.html` adds `<div id="window-controls"></div>` as the **last** child of `#tabstrip`
  (after `#tabs`), reserved for leg 5's buttons (empty in this leg).
- [x] `styles.css`: `#tabstrip` is `-webkit-app-region: drag`; `#newtab-pill` and `.tab` are
  `-webkit-app-region: no-drag` (so the pill and tabs remain clickable); `#window-controls` is a
  `flex: none` right-side zone with a reserved width on win/linux (≈138px for three controls) sized
  so leg 5's buttons fit and the empty space stays draggable.
- [x] macOS only (`html.platform-darwin`): `#tabstrip` gets a left inset (default ≈ `78px`,
  flagged needs-human-recheck) so the leading pill clears the native traffic lights; the
  `#window-controls` right zone is collapsed/hidden on mac (native traffic lights handle window
  controls there). The exact `trafficLightPosition` inset and mac left-padding are an open
  question — a reasonable default now, confirmed on a mac later.
- [x] `npm test`, `npm run typecheck` (0 errors), `npm run lint` (0 problems), and
  `npx prettier --check` on the changed files all clean.
- [ ] **Deferred (not in-leg) — NOT run this leg; deferred to `verify-integration`, divert trigger armed**: the WSLg `frame:false` resize spike (window still resizable /
  snappable) — run live at `verify-integration`; if it fails and isn't quickly fixable, the flight
  diverts (legs 4–5 → Flight 1b). Recorded in the flight log.

## Verification Steps
- `grep -n "process.platform\|titleBarStyle\|trafficLightPosition\|frame:" src/main/main.js` →
  platform-branched frame options at the BrowserWindow call.
- `grep -n "minWidth\|minHeight" src/main/main.js` → `900`/`600` still present.
- `grep -n "platform" src/preload/chrome-preload.js` → `platform: process.platform` exposed.
- `grep -n "platform" src/renderer/renderer-globals.d.ts` → `platform` added to `GoldfinchBridge`.
- `grep -n "platform-" src/renderer/renderer.js` → `documentElement.classList.add('platform-…')`.
- `grep -n "window-controls" src/renderer/index.html` → reserved zone is the last child of
  `#tabstrip`.
- `grep -n "app-region" src/renderer/styles.css` → `drag` on `#tabstrip`, `no-drag` on
  `#newtab-pill` and `.tab`.
- `grep -n "platform-darwin" src/renderer/styles.css` → mac left-inset + right-zone-hidden rules.
- `npm run typecheck` → 0 errors; `npm run lint` → exit 0; `npm test` → all pass;
  `npx prettier --check` on changed files → clean.
- Deferred to `verify-integration`: resize spike (manual), drag-to-move (manual), and
  `responsive-tab-strip` Step 7 (leg 5 maximize read path).

## Implementation Guidance

1. **`main.js` — platform-branched frame options (`:16-33`).** Before `new BrowserWindow`, build
   the frame branch; spread it into the options so the rest is untouched:
   ```js
   const isMac = process.platform === 'darwin';
   /** @type {Electron.BrowserWindowConstructorOptions} */
   const frameOpts = isMac
     ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 14 } } // mac inset — recheck on a mac (open question)
     : { frame: false };
   mainWindow = new BrowserWindow({
     width: 1400,
     height: 900,
     minWidth: 900,
     minHeight: 600,
     backgroundColor: '#1e1f25',
     title: 'Goldfinch',
     icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
     ...frameOpts,
     webPreferences: { /* unchanged */ }
   });
   ```
   Do not touch `window-all-closed`/`closed`/quit logic.

2. **`chrome-preload.js` — expose platform.** Add to the `exposeInMainWorld('goldfinch', {...})`
   object (e.g. near the top): `platform: process.platform,`.

3. **`renderer-globals.d.ts` — mirror the new field.** In the `GoldfinchBridge` interface, add:
   ```ts
   platform: string;
   ```
   (Place it alongside the other fields, mirroring how `webviewPreloadPath` appears in both the
   preload and this d.ts.)

4. **`renderer.js` — tag the document with the platform (early, after the `els` block / near other
   one-time init).**
   ```js
   document.documentElement.classList.add(`platform-${window.goldfinch?.platform ?? 'unknown'}`);
   ```

5. **`index.html` — reserved right zone (`:14-28`).** Add as the last child of `#tabstrip`, after
   `#tabs`:
   ```html
   <div id="window-controls"></div>
   ```
   (Empty in this leg; leg 5 inserts the minimize/maximize/close buttons.)

6. **`styles.css` — drag regions + reserved zone.** Near the tab-strip rules:
   ```css
   #tabstrip {
     /* ...existing... */
     -webkit-app-region: drag; /* frameless: the strip background moves the window */
   }
   #newtab-pill,
   .tab {
     -webkit-app-region: no-drag; /* keep the pill and tabs clickable */
   }
   #window-controls {
     flex: none;
     display: flex;
     align-items: stretch;
     width: 138px; /* three controls @46px (leg 5); refinement of the flight's "~200px" reserve —
                      remaining headroom for a future Settings entry comes in a later flight */
   }
   /* macOS: native traffic lights sit top-left; inset the strip so the pill clears them,
      and drop the custom right zone (mac uses native controls). Defaults — recheck on a mac. */
   html.platform-darwin #tabstrip {
     padding-left: 78px;
   }
   html.platform-darwin #window-controls {
     display: none;
   }
   ```
   (Merge the `-webkit-app-region: drag` line into the existing `#tabstrip` rule rather than
   duplicating the selector.)

## Edge Cases
- **Drag vs. click**: any interactive element inside a drag region needs `no-drag`. The pill
  (`#newtab-pill`, covering both buttons) and `.tab` (covering tab activate + close) are marked;
  leg 5's window-control buttons must also be `no-drag` (leg 5 owns that). The container menu
  (`#container-menu`) is a `<body>` child outside `#tabstrip`, unaffected.
- **Empty `#tabs` space**: with few tabs (capped at 240px) the trailing space inside `#tabs` stays
  draggable (only `.tab` is `no-drag`, not `#tabs`), giving a comfortable drag target. Good.
- **Scrollbar thumb inside the drag region**: when `#tabs` overflows past the floor (leg 2's
  scroll-only-past-floor), its scrollbar sits within the `#tabstrip` drag region (only `.tab` is
  `no-drag`, not `#tabs`), so dragging the thumb could move the window instead of scrolling. Low
  likelihood (only at high tab counts) — note it for the live verify; if it bites, mark `#tabs`
  `no-drag` (trading away the trailing-space drag target). Deferred to `verify-integration`.
- **macOS traffic-light overlap**: with `titleBarStyle:'hidden'` the native lights overlay the
  top-left of our content; the `platform-darwin` left inset (default 78px) keeps the pill clear.
  Both the inset and `trafficLightPosition` are unverified on the Linux/WSL dev box — flagged
  needs-human-recheck for the mac build (open question).
- **Frameless resize on WSLg (the spike)**: deferred to the live verify session per operator
  decision. If the window is not resizable/snappable there and not quickly fixable, the flight
  diverts legs 4–5 to Flight 1b (renderer legs 1–3 land alone). The divert remains armed.
- **No window controls yet**: leg 4 ships a frameless win/linux window with **no** visible
  minimize/maximize/close affordance — this is intentionally incomplete and **must not be run as a
  user-facing build between legs 4 and 5**. Leg 5 lands with leg 4 (DD6: "don't ship a frameless
  win/linux window with no close affordance"); the flight-level commit covers both.
- **`@ts-check`**: the conditional `frameOpts` ternary widens `titleBarStyle: 'hidden'` to `string`,
  which is **not** assignable to Electron's `titleBarStyle` literal union — so `frameOpts` **must**
  carry the `/** @type {Electron.BrowserWindowConstructorOptions} */` annotation shown in step 1
  (not an optional fallback). With the annotation the spread into the options object typechecks.

## Files Affected
- `src/main/main.js` — `process.platform` frame branch at the `BrowserWindow` call. Quit/closed
  paths untouched.
- `src/preload/chrome-preload.js` — `platform: process.platform` on the `goldfinch` bridge.
- `src/renderer/renderer-globals.d.ts` — `platform: string;` added to the `GoldfinchBridge`
  interface (mirrors the new preload field; required for the typecheck gate).
- `src/renderer/renderer.js` — add `platform-${platform}` class to `<html>` (optional-chained).
- `src/renderer/index.html` — `#window-controls` reserved zone as the last child of `#tabstrip`.
- `src/renderer/styles.css` — `#tabstrip` drag region; `#newtab-pill`/`.tab` no-drag;
  `#window-controls` reserved zone; `platform-darwin` mac inset + right-zone-hidden.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (commit deferred to the
flight-level review/commit per `/agentic-workflow`):**

- [x] All acceptance criteria verified (except the explicitly deferred resize spike)
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint` + `npx prettier --check`)
- [x] Update flight-log.md with leg progress entry (incl. the outstanding resize spike)
- [x] Set this leg's status to `landed` (in this file's header) — flight-level commit promotes to
  `completed`
- [x] (Not the final leg — leg 5 lands with it; no flight.md leg checkoff or flight-status change
  here)

## Citation Audit
Citations verified against the current working tree — all `OK`: `main.js:3` (electron requires
incl. `app`/`BrowserWindow`/`ipcMain`), `:16-33` (`createWindow`/`new BrowserWindow` options),
`:20-21` (`minWidth`/`minHeight`), `:46-48` (`closed`), `:514-516` (`window-all-closed` →
`app.quit`); `chrome-preload.js` (`exposeInMainWorld('goldfinch', …)` surface); `index.html:14`
(`#tabstrip`), `:15` (`#newtab-pill`), `:28` (`#tabs`); `styles.css:40-46` (`#tabstrip`), `:47-53`
(`#tabs`), `:54-84` (`#newtab-pill`), `:85-99` (`.tab`). Behavior-test alignment: deferred —
`responsive-tab-strip` Step 7 (leg 5) + manual drag/resize at `verify-integration`.
