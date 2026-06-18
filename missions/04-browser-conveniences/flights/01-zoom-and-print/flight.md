# Flight: Core Conveniences — Zoom & Print

**Status**: in-flight
**Mission**: [Standard Browser Conveniences](../../mission.md)

## Contributing to Criteria
- [ ] **SC1** — Page zoom: increase / decrease / reset by keyboard, current level visible, applied to the active tab's web content.
- [ ] **SC2** — Print / Save-as-PDF through the system print path.
- [ ] **SC8** (part) — Agent parity: zoom and print-to-PDF are invocable as gated automation/MCP tools.

---

## Pre-Flight

### Objective

Add the two decision-light Chromium-engine conveniences Electron leaves unwired: **page zoom**
(`Ctrl +` / `Ctrl -` / `Ctrl 0`, applied to the active tab's web content, with a visible level
indicator) and **print / save-as-PDF** (the native Chromium print dialog via `Ctrl+P` and a kebab
**Print…** item — "Save as PDF" is a destination within that dialog). Expose **`setZoom` / `getZoom`**
and **`printToPDF`** as gated automation/MCP tools (agent parity). Every new control targets **web
content only** — it no-ops on `goldfinch://` internal tabs.

### Open Questions
- [x] **Where are page-scoped shortcuts captured?** (Architect HIGH) → A **main-process
  `before-input-event` handler on each guest `webContents`** (attached at `web-contents-created`),
  so they work while the **page** has focus — the normal case — not only when the chrome shell is
  focused. The existing renderer `document` keydown (`renderer.js:1952`) fires only with chrome
  focused; that path stays as a fallback for the chrome-focused case. (DD6)
- [x] **Zoom cross-tab sharing model** — per-webContents temporary zoom vs per-origin-per-session?
  → **Not asserted.** `setZoomFactor` applies to the active tab's `webContents`; the exact
  cross-tab sharing model is confirmed by a **live check at the `zoom-controls` leg** — SC1 mandates
  neither. The invariant we **do** assert and test is **no cross-jar leak** (separate jar sessions).
  (DD1)
- [x] **Zoom persistence across restart?** → **No in v1** (session-lifetime). Persisting would add a
  `settings-store` key; deferred (noted as a future enhancement).
- [x] **Zoom indicator placement** → an **address-bar-row zoom chip** visible only when zoom ≠ 100%,
  click-to-reset (DD2). No new pinning logic.
- [x] **Zoom MCP tool shape** → **`setZoom(wcId, factor)` + `getZoom(wcId)`** by zoom *factor*
  (`1.0` = 100%), **flat schemas** (DD4). `getZoom` is a **new read path** built in this flight (it
  does not exist today). `zoomIn/out/reset` are keyboard affordances, not tools.
- [x] **Is native `print()` an MCP tool?** → **No.** Agents get **`printToPDF`** (returns
  base64-encoded PDF bytes). (DD4)
- [x] **Behavior-test apparatus** → the M03 automation surface, audited on both axes (DD5). The
  keyboard act path drives the **guest** (firing `before-input-event`, per DD6); the run uses the
  **admin** key (step 7 exercises the op-local internal guard).

### Design Decisions

**DD1 — Zoom applies to the active tab's `webContents`; the tested invariant is no cross-jar leak.**
Apply zoom with `webContents.setZoomFactor()` / `getZoomFactor()` (the `<webview>` tag proxies these
to its guest). Chromium zoom is session-scoped and goldfinch interns one session per jar partition
(`resolve.js`, `jars.js`), so zoom cannot cross jars. The exact **same-jar** sharing model
(per-webContents temporary vs per-origin-per-session) **may differ from Chrome's omnibox behavior**
and is confirmed by a live check at the `zoom-controls` leg.
- Rationale: least effort; respects the jar isolation boundary, which is the property that matters.
- Trade-off: same-origin tabs in one jar *may* share a level (confirmed live); restart resets to 100%.

**DD2 — Zoom indicator = address-bar-row chip, shown only when ≠ 100%.** When the active tab's
zoom ≠ 100%, a small chip appears in the toolbar row showing the percentage with a reset affordance,
hidden at 100%. Mirrors Chrome's omnibox zoom indicator. The renderer renders the chip from a
main→renderer zoom-changed message (since main owns the capture, per DD6).
- Rationale: satisfies SC1's "see the current zoom level" without new pinning logic or clutter.
- Trade-off: a status affordance, not a pinnable tool like Media/Shields.

**DD3 — All new controls no-op on internal tabs, on BOTH the user and admin paths.** The renderer
fallback guards with `isInternalTab(tab)` (`renderer.js:577`); the main `before-input-event` capture
skips the internal session. Crucially, the **automation** ops must carry their **own op-local
`isInternalContents(wc)` guard** (as `evaluate`/`injectScript`/`devtools` do — `observe.js:341/392/
436`) because the admin engine runs `{ allowInternal: true }`, so `resolveContents` alone does **not**
refuse internal pages for the admin key (`resolve.js:91-97`). A bare `resolveContents`-only zoom/print
op would let admin zoom or PDF `goldfinch://settings`.
- Rationale: mirrors the established op-local guard pattern; closes the admin-path hole.

**DD4 — MCP tools: `setZoom` / `getZoom` (by factor) + `printToPDF` (base64); flat schemas;
op-local internal guard.** New engine ops follow the `nav.js` template (resolve via
`resolveContents(wcId, deps)`, add the op-local `isInternalContents` guard, call the `webContents`
method) and map 1:1 to MCP tools via the thin adapter (`mcp-tools.js` DD5 invariant — no new
security logic in the adapter). `printToPDF` resolves a Node **Buffer**; the engine op must
`buf.toString('base64')` (mirroring the screenshot ops' `image.toPNG().toString('base64')` at
`observe.js:131`) and return the base64 as a **plain JSON text string** — NOT an MCP image content
block (`imageResult` is PNG-only; there is no `application/pdf` image type), so it falls through the
default `okResult`/`serialize` path. Returning the raw Buffer would instead emit `{"type":"Buffer",…}`. Schemas are **flat objects with no top-level `oneOf`/`allOf`/`anyOf`** (the
new args are all-required `{wcId, factor}` / `{wcId}` + optional opts, so no "at least one of"
construct is needed — pre-empts the issue #56 idiom, whose existing instance is fixed in F6). Native
`print()` is **not** exposed to MCP.
- Rationale: factor is clearer for agents than Electron's logarithmic zoom *level*; base64 matches
  the screenshot precedent.
- Trade-off: agents cannot trigger the human print dialog (by design).

**DD5 — Behavior-test apparatus = the M03 automation surface (dogfooding), audited both axes.**
- **Act**: zoom driven via `pressKey` modifier chords (landed F7) delivered **to the guest**, which
  fires the main `before-input-event` capture (DD6); and via the new `setZoom` tool. `printToPDF`
  invoked directly.
- **Observe**: zoom read via the new `getZoom` tool **and** in-page **`window.devicePixelRatio`** via
  the `evaluate` tool (landed F9). *(Not `visualViewport.scale` — that tracks pinch-zoom and stays
  ≈1 under `setZoomFactor`.)* `printToPDF` asserted by decoding the returned base64 and checking the
  `%PDF-` signature.
- **Key identity**: the run uses the **admin** key, so `page-zoom` step 7 actually exercises the
  DD3 op-local internal guard (a jar key would be refused generically by the façade and leave the
  guard untested).
- The native print dialog (SC2) is **manually verified** (OS-native, outside the apparatus).

**DD6 — Page-scoped shortcuts captured main-side via `before-input-event` on each guest.** In the
`app.on('web-contents-created')` hook (`main.js:296`), attach `contents.on('before-input-event', …)`
to each non-internal guest to intercept `Ctrl +`/`-`/`0` (zoom) and `Ctrl+P` (print), apply the
action to that guest, and message the renderer to update the chip. This is the only path that works
while the page is focused and is what the behavior-test `pressKey` drives. The renderer `document`
keydown (`renderer.js:1952`) keeps handling the chrome-focused case by messaging main; both converge
on one main-side apply. The new handler must early-return when the **lightbox** is open (the lightbox
binds a bare-`=`/`-`/`0` `document` keydown at `renderer.js:1190` that ignores modifiers — they don't
literally clash since page-zoom keys on `Ctrl`, but avoid double-handling).
- **Apparatus dependency (Architect cycle-2 HIGH):** the automation `pressKey` key builder
  (`input.js:22-26`: a named-key map + the `/^[a-z0-9]$/i` printable regex) **cannot emit `=`, `-`,
  or `+`** today, so `Ctrl+=`/`Ctrl+-` throw `unknown key`. Extending the key map to cover `=`/`-`/`+`
  is an explicit deliverable of the `zoom-capture-and-apply` leg (without it the keyboard behavior
  test cannot drive zoom-in/out; `Ctrl+0` already works via the digit regex).
- Rationale: correct UX (zoom the page you're looking at) + a driveable apparatus, in one mechanism.

### Prerequisites
- [ ] M03 automation surface runnable (`npm run dev:automation`) — landed (M03).
- [ ] `pressKey` modifier chords available (F7) and the `evaluate` tool available (F9) — landed.
  *(Note: `getZoom`/`setZoom`/`printToPDF` do NOT exist today — they are deliverables of legs 2–3;
  the `page-zoom`/`print-to-pdf` specs run at `verify-integration`, after those legs land.)*
- [ ] Accessibility gate runnable (`npm run a11y`).
- [ ] The **admin** key available (env-gated) for the behavior-test run (per M03 gating).

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (M03 surface, `pressKey` chords, `evaluate`, a11y gate, admin key — all landed)
- [x] Validation approach defined (`page-zoom` + `print-to-pdf` behavior tests drafted; manual native-print check)
- [x] Legs defined

---

## In-Flight

### Technical Approach

**Shortcut capture (main-side, primary).** In `app.on('web-contents-created')` (`main.js:296`),
attach a `before-input-event` listener to each non-internal guest `webContents` that intercepts
`Ctrl +`/`-`/`0` → apply `setZoomFactor` to that guest (and broadcast a zoom-changed message so the
renderer updates the chip), and `Ctrl+P` → `guest.print()` (native dialog; **Save as PDF** is a
destination there, satisfying SC2 with one path). A renderer `document` keydown (`renderer.js:1952`)
covers the chrome-focused case by messaging main. The kebab gains a **Print…** item routing to the
same main apply. The zoom chip is new markup in the toolbar row (`index.html:49`), shown/hidden by a
renderer handler driven from main's zoom-changed message; guard against the open lightbox (DD6).

**Automation (MCP parity).** Add `src/main/automation/zoom.js` (`getZoom`/`setZoom` via
`resolveContents` + an **op-local `isInternalContents` guard** → `wc.getZoomFactor()`/
`setZoomFactor()`) and `src/main/automation/print.js` (`printToPDF` via `wc.printToPDF(opts)` →
`buf.toString('base64')`, with the observe ops' foreground-first/activate discipline so a not-yet-
painted guest doesn't hang — mirror `observe.js:119-129`). Wire each as an engine op (`engine.js`)
and an MCP tool (`mcp-tools.js`, flat schema), with unit tests against a fake engine/webContents in
the `test/unit/automation-*.test.js` style.

### Checkpoints
- [ ] Zoom keyboard works **with the page focused** (via `before-input-event`) and chrome focused; chip updates; no-op on internal tabs; no cross-jar leak (live check).
- [ ] `Ctrl+P` and kebab **Print…** open the native dialog with **Save as PDF** available.
- [ ] `setZoom`/`getZoom` + `printToPDF` MCP tools live, jar-scoped, op-local-internal-guarded, base64, unit-tested, flat-schema.
- [ ] `page-zoom` + `print-to-pdf` behavior tests green on the automation surface (admin key); `npm run a11y` clean; docs updated.

### Adaptation Criteria

**Divert if**:
- Zoom turns out to leak across jars (it should not — separate sessions), or the applied zoom cannot
  be read for the behavior test (would undercut DD5's observability premise).
- `before-input-event` cannot reliably intercept the chord on the dev platform (WSLg) — fall back to
  asserting keyboard manually in HAT and driving the engine path via `setZoom` only.

**Acceptable variations**:
- Zoom indicator placement (address-bar chip vs kebab) refined during HAT.
- MCP tool naming (`setZoom` vs `zoomTo`) settled at implementation, as long as schemas stay flat.

### Legs

> **Note:** Tentative; planned and created one at a time as the flight progresses.

- [ ] `zoom-capture-and-apply` — main `before-input-event` capture on guests for `Ctrl +`/`-`/`0`
  (DD6) + renderer chrome-focused fallback, applying `setZoomFactor` to the active tab; the
  address-bar zoom chip (shown when ≠ 100%, click-to-reset); `isInternalTab` / internal-session
  no-op; lightbox early-return; **extend the `pressKey` key map to emit `=`/`-`/`+`** (`input.js:22`,
  so the keyboard behavior test can drive zoom-in/out — DD6 apparatus dependency); **live check** of
  the same-jar sharing model (DD1). Keyboard-operable, within the a11y gate.
- [ ] `zoom-mcp-tool` — `src/main/automation/zoom.js` (`getZoom`/`setZoom` by factor) with the
  op-local `isInternalContents` guard (DD3) + engine op + MCP tool entries (flat schemas) + unit
  tests; jar-scoped via `resolveContents`. This builds the `getZoom` **read path** the behavior test
  observes.
- [ ] `print-and-pdf` — `Ctrl+P` (via the DD6 capture) + kebab **Print…** → native print dialog
  (Save-as-PDF destination); `src/main/automation/print.js` (`printToPDF` → base64, foreground-first,
  op-local internal guard) + engine op + MCP tool + unit tests.
- [ ] `verify-integration` — author/run the `page-zoom` and `print-to-pdf` behavior tests on the
  automation surface **under the admin key**; assert `printToPDF` decodes to `%PDF-` bytes;
  `npm run a11y`; **manual** native print → Save-as-PDF check; regression sweep of specs touching the
  keydown handler. **Owns the docs updates**: README keyboard-shortcuts table (`README.md:141+`: add
  `Ctrl +`/`-`/`0`, `Ctrl+P`) and `docs/mcp-automation.md` (add `setZoom`/`getZoom`/`printToPDF`).
- [ ] `hat-and-alignment` *(optional)* — guided HAT for zoom + print (incl. page-focused zoom and the
  same-jar sharing behavior), fixing issues live until the operator is satisfied.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (unit + behavior + a11y)
- [ ] Docs updated (README shortcuts table; `docs/mcp-automation.md`) — owned by `verify-integration`

### Verification
- **SC1** — `page-zoom` behavior test (keyboard zoom via `before-input-event` + `setZoom`/`getZoom` +
  `devicePixelRatio` corroboration + no cross-jar leak + internal no-op) green on the automation
  surface; chip shows the level.
- **SC2** — manual: `Ctrl+P` / kebab **Print…** opens the native dialog; **Save as PDF** produces a
  file. (OS-native dialog — outside the in-app apparatus.)
- **SC8 (part)** — `setZoom`/`getZoom`/`printToPDF` discoverable and invocable over MCP; unit tests
  green; `printToPDF` returns valid base64 PDF bytes.
