# Flight: Window Shell

**Status**: ready
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria
- [ ] **SC8** — Frameless window, drag regions, and per-platform window controls work on the
  `BaseWindow` shell at parity (primary)
- [ ] Lays the `BaseWindow` + chrome-`WebContentsView` foundation that SC1/SC3 (guest-tab migration)
  build on in Flight 3 — not claimed here

---

## Pre-Flight

### Objective

Migrate the real app's window shell from `BrowserWindow` to `BaseWindow` + a chrome `WebContentsView`,
at full behavior parity. The existing browser chrome (`src/renderer/index.html` + `renderer.js`) renders
inside the chrome view; **tabs deliberately stay `<webview>`** inside that chrome for now (guest-tab
migration is Flight 3). Frameless window, drag regions, and per-platform window controls
(custom minimize/maximize/close on Windows/Linux; native traffic lights on macOS) all keep working. This
is the first production migration flight and is intentionally narrow: it changes the *window host*, not
the tabs — keeping `main` stable and the diff reviewable.

### Open Questions
- [x] Does `<webview>` embedding survive when the chrome doc is hosted in a `WebContentsView` (not a
  `BrowserWindow`)? → **Premise-verified GO** (Flight-2 planning spike): `will-attach-webview` fires on
  the chrome view's `webContents`, the webview contents is created, and the guest renders (pixels). The
  incremental shell-only migration is viable. Evidence: `premise-report.json` + `premise-webview-in-view.png`
  in the ephemeral scratch dir.
- [x] How is the chrome-contents reference structured once `BaseWindow` has no `.webContents`? → DD2.
- [x] Do window controls map onto `BaseWindow`? → DD4 (all methods + maximize/unmaximize events exist).
- [ ] **Carried to execution (now a divert trigger, see Adaptation Criteria):** does `captureWindow`
  (`chromeContents.capturePage()` at `observe.js:214`) still composite the **in-chrome `<webview>` guest
  pixels** when the chrome is a `WebContentsView`? The planning premise-spike covered `<webview>`
  *rendering*, NOT *capture* of a guest nested in a view-hosted chrome — this is the one capture-path
  unknown. A guest-blind capture is an SC6 regression a live-eyeball HAT would miss → the verify leg reads
  the captured PNG (agent-reads-PNG loop), not just the live screen. Any launch white-flash? → DD6.

### Design Decisions

**DD1 — Incremental migration: shell only; tabs stay `<webview>` (premise-verified).**
- Choice: Flight 2 migrates only the window host (`BaseWindow` + chrome `WebContentsView`,
  `webviewTag:true`). Guest tabs remain `<webview>` inside the chrome document; their migration to
  per-tab `WebContentsView`s is Flight 3.
- Rationale: The planning spike proved `<webview>` works inside a view-hosted chrome, so the shell can
  move without touching tabs — a small, `main`-stable, reviewable diff that de-risks the rest.
- Trade-off: A transient hybrid (native shell + `<webview>` tabs) for one flight; removed in Flight 3.

**DD2 — Single `chromeView` reference behind a `getChromeContents()` accessor; re-point EVERY site (grep-driven, not a hand-list).**
- Choice: Introduce one module-level `chromeView` (the chrome `WebContentsView`) + a
  `getChromeContents()` accessor returning `chromeView.webContents`. `mainWindow` becomes the `BaseWindow`,
  used only for window-level ops (bounds, minimize/maximize/close, resize, dialog parent). The acceptance
  criterion is **every `mainWindow.webContents.*` site routes through the accessor** — verified by grep,
  not by a hand-enumerated list. Full audited set (from the design review):
  - **Renderer IPC sends** (each `mainWindow.webContents.send(...)`): `zoom-changed` (`main.js:346`),
    `open-tab` (359), `open-find` (416), `open-downloads` (425), `devtools-state-changed` (447),
    `page-context-menu` (464), `privacy-net` (682), `privacy-permission` (825), the
    `broadcastToChromeAndInternal` chrome send (850), and `window-maximized-change` (310–311, Leg 3).
  - **The `will-attach-webview` hook** (`main.js:286`) — attach to `getChromeContents()`.
  - **Downloads**: `downloadURL` retry (`main.js:993`) and the `mainWindow && mainWindow.webContents`
    fallback in `download-media` (`main.js:495`).
  - **Dev-seam identity check** `event.sender === mainWindow.webContents` (`main.js:1392`) →
    `=== getChromeContents()`.
  - **The automation engine accessor contract** — `createEngine(() => mainWindow, …)` at **`main.js:151`
    and `main.js:1387`** passes the *window*; `engine.js` dereferences `mw.webContents` (`engine.js:48,51,97`).
    `BaseWindow` has no `.webContents`, so this silently breaks the WHOLE engine + `captureWindow` + the
    dev seam. **Change the accessor contract window→contents**: pass `getChromeContents` and update
    `engine.js` to treat its arg as the contents accessor (+ its `@param` JSDoc at `engine.js:22-23`,
    `Electron.BrowserWindow`→`Electron.WebContents`). The separate `scopeCtx.getChromeContents` seam at
    `main.js:159` also points at the accessor.
  - **Leave unchanged**: `dialog.showOpenDialog(mainWindow, …)` (`main.js:531`) — a `BaseWindow` is a valid
    dialog parent; do NOT "fix" it.
- Rationale: `mainWindow.webContents` is pervasive AND the engine dereferences it indirectly via a window
  accessor — the load-bearing correction over the first draft's "no engine change."
- Trade-off: One indirection (the accessor) vs. a scattered rename — chosen deliberately (operator decision).

**DD3 — Chrome view fills the window; geometry driven from the `BaseWindow`.**
- Choice: Size the chrome view to `win.getContentBounds()` (x:0,y:0,full width/height) at create and on
  `resize`. The chrome view is the only child this flight (tabs are still `<webview>` *inside* it, so no
  per-tab geometry yet).
- Rationale: Parity with today's full-window chrome; per-tab view geometry is Flight 3's concern.
- Trade-off: None this flight.

**DD4 — Window controls & maximize-state re-point to `BaseWindow` (parity).**
- Choice: `window-minimize`/`window-toggle-maximize`/`window-close`/`window-is-maximized` (handlers at
  `main.js:1119–1127`) call the same-named `BaseWindow` methods; the `maximize`/`unmaximize` events
  (forwarded as `window-maximized-change`, `main.js:310–311`) move to the `BaseWindow` and send via the
  chrome-contents accessor. `app-quit` and the `closed→window-all-closed→app.quit()` chain are unchanged.
- Rationale: `BaseWindow` exposes the identical window API surface — a clean re-point, no behavior change.
- Trade-off: None (parity).

**DD5 — macOS unverified; recorded unknown, not pass (per mission DD5).**
- Choice: `titleBarStyle:'hidden'` + `trafficLightPosition` move to the `BaseWindow` ctor unchanged, but
  mac frameless/traffic-light/drag parity is **unverifiable this mission** (no in-loop venue). Recorded as
  unknown; build-readiness only. The Linux/WSLg branch (`frame:false`) is the verified path.
- Rationale: Honesty about the venue gap (Mission 04 lesson).
- Trade-off: Mac parity carries an explicit caveat into the mission's landing.

**DD6 — Preserve launch appearance (no white flash).**
- Choice: Keep `backgroundColor:'#1e1f25'` on the `BaseWindow` and set the chrome view's background to
  match, so the frameless launch shows no white flash before the chrome paints. `minWidth:900`/
  `minHeight:600`, `icon`, and `title` carry to the `BaseWindow` ctor.
- Rationale: Parity with today's launch look.
- Trade-off: None; verify at the HAT leg.

**DD7 — Fix `app.on('activate')`'s window count (latent mac bug this flight introduces).**
- Choice: `app.on('activate')` uses `BrowserWindow.getAllWindows()` (`main.js:1455`), which does **not**
  count `BaseWindow`s — so post-migration it always reads 0 and re-creates a window on macOS dock-click,
  spawning duplicates. Change to `BaseWindow.getAllWindows()`.
- Rationale: This flight *introduces* the bug by switching window classes; fix it in the same flight even
  though it's on the (unverifiable) mac path — cheap, correct, and avoids leaving a known latent defect.
- Trade-off: Mac-path behavior remains unverified (DD5), but the code is correct by construction.

### Prerequisites
- [ ] Flight-2 branch created off `mission/05-webcontentsview-migration` (the long-running mission branch).
- [ ] App runs under Linux/WSLg with a live display (verified during the Flight-1 spike).
- [ ] Visual-HAT apparatus available (`desktopCapturer` window-grab + agent-reads-PNG, from the spike).
- [ ] `<webview>`-in-view premise verified (done — see Open Questions / DD1).

### Pre-Flight Checklist
- [x] All open questions resolved (the one carried item is a verify-leg confirmation + divert trigger, not a blocker)
- [x] Design decisions documented (DD1–DD7)
- [ ] Prerequisites verified (flight branch creation is the first execution step)
- [x] Validation approach defined (visual HAT + `captureWindow` PNG read + existing behavior-test corpus + a11y)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Executed via `/agentic-workflow` (mechanical, deterministic re-pointing), with a final guided HAT leg.
Leg 1 is one atomic change — the shell swap AND the full DD2 re-point (including the engine accessor
contract) land together so the app runs again at the leg's end (no non-runnable intermediate, matching
`/agentic-workflow`'s single end-of-flight review). Leg 2 re-points window controls + fixes the
`activate` window count. Leg 3 is the interactive HAT + behavior-test verification. The acceptance signal
for shell appearance is pixels (visual HAT); for SC6 the `captureWindow` PNG is read directly (the one
capture-path unknown). This flight changes the *host*, not guest compositing, so the render risk is lower
than Flight 3's — the real risk is the wide re-point surface (silent dead-`webContents` sends), gated by
`typecheck`/`lint` + a working MCP op, not just "tabs browse."

### Checkpoints
- [ ] `BaseWindow` + chrome `WebContentsView` renders the chrome (index.html) frameless under WSLg
- [ ] **Every** `mainWindow.webContents.*` site re-pointed via `getChromeContents()` (grep clean) +
  the engine accessor contract changed; `typecheck`/`lint` green; **tabs browse** + at least one **MCP op
  works** (engine alive) — not just "tabs render"
- [ ] Window controls (minimize/maximize-restore/close) + drag + maximize-state sync at parity; `activate`
  uses `BaseWindow.getAllWindows()`
- [ ] `captureWindow` composites the in-chrome guest — **confirmed by reading the captured PNG**
- [ ] HAT: frameless shell, drag, controls, tab browsing confirmed on pixels; behavior corpus + a11y green where runnable

### Adaptation Criteria

**Divert if**:
- `<webview>` tabs fail to render/attach inside the chrome view in the REAL app (contradicting the
  premise spike) → stop, reassess shell+tabs-together (would fold Flight 3 forward). *(Low likelihood —
  premise-verified — but this is the one assumption that would force a restructure.)*
- **`captureWindow` returns chrome-without-guest** (the in-chrome `<webview>` doesn't composite into
  `chromeContents.capturePage()`) → SC6 regression; stop and decide (capture the guest contents directly,
  or accept until Flight 3 makes guests their own views). Judged on the captured PNG, not the live screen.
- Window drag or controls can't reach parity on the `BaseWindow` shell under WSLg → options-review.

**Acceptable variations**:
- Accessor naming/placement; exact resize-event set wired (`resize` minimum; add `enter/leave-full-screen`
  if needed).
- mac branch shipped unverified (DD5) — expected, not a divert.
- Minor renderer tweaks if the chrome view needs them (kept minimal; renderer is not the focus).

### Legs

> **Note:** Tentative; planned one at a time. Leg 1 is one **atomic** change (the app must run again at
> its end — no non-runnable intermediate, per the `/agentic-workflow` single-review model). Executed via
> `/agentic-workflow`; Leg 3 is the interactive HAT.

- [ ] `basewindow-chrome-shell` - **Atomic shell swap — app must run at the end.** Swap
  `BrowserWindow`→`BaseWindow`; create the chrome `WebContentsView` (`webviewTag:true`, chrome-preload,
  `contextIsolation:true`, `sandbox:false`, dev `additionalArguments`); `win.contentView.addChildView(chromeView)`
  (**not** `win.addChildView`); `chromeView.webContents.loadFile(index.html)` (**`loadFile` is on
  webContents, not the window**); fill geometry from `getContentBounds()` + `resize` wiring; carry
  `backgroundColor`/`minWidth`/`minHeight`/`icon`/`title`. Then introduce the `getChromeContents()`
  accessor and **re-point every site in DD2** — all ~10 renderer sends, the `will-attach-webview` hook,
  the download retry + `download-media` fallback, the dev-seam identity check, AND **the engine accessor
  contract** (`createEngine` at `main.js:151` + `1387` → contents accessor; `engine.js` + JSDoc). **Gate:
  app runs, tabs browse via `<webview>`, `npm run typecheck` + `npm run lint` green.** (SC8 foundation +
  SC6 preservation.)
- [ ] `window-controls-parity` - Re-point `window-minimize`/`window-toggle-maximize`/`window-close`/
  `window-is-maximized` + the `maximize`/`unmaximize` forwarding to the `BaseWindow`; fix
  `app.on('activate')` → `BaseWindow.getAllWindows()` (DD7); verify drag + controls + maximize-state sync. (SC8.)
- [ ] `verify-shell-hat` *(guided HAT / alignment)* - Walk the operator through the frameless shell, drag,
  window controls, and tab browsing (visual HAT via `desktopCapturer`); **confirm `captureWindow`
  composites the in-chrome guest by reading the captured PNG** (divert trigger, not live-eyeball-only); run
  the runnable behavior-test corpus (responsive-tab-strip, tab-keyboard-operability, settings-shell) +
  `npm run a11y`; fix issues live. (SC8 verification + SC6 capture check.)

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] App runs frameless on `BaseWindow` + chrome `WebContentsView`; tabs browse via `<webview>`
- [ ] Window controls + drag + maximize-state at parity (Linux/WSLg); mac shipped unverified (DD5)
- [ ] `captureWindow` + the runnable behavior-test corpus + a11y green
- [ ] No production code merged to `main` (stays on the mission branch)
- [ ] Flight branch merged to the mission branch; mission `flights` checklist updated
- [ ] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)

### Verification

Verified on Linux/WSLg by **visual HAT** (frameless shell, drag, controls, tab browsing — pixels, per
DD3/the mission's render-correctness rule) plus the existing behavior-test corpus where it runs on the new
shell (`responsive-tab-strip`, `tab-keyboard-operability`, `settings-shell`) and `npm run a11y`. macOS
frameless/traffic-light parity is **unverified** this mission (DD5) — build-readiness only. No new
behavior-test spec is authored: this is a parity change and the existing corpus is the net.
