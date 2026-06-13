# Flight: Drive Engine (input / nav / tabs)

**Status**: landed
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC1** — navigate a tab (open URL; back / forward / reload), reflected in the live UI.
  *(Flight 1 delivers the native navigate capability; the client **attach** half and the
  behavior-test backing land with the transport in Flight 3 / migration in Flight 6.)*
- [ ] **SC2** — deliver **trusted input** (click / type / scroll / key) that fires real handlers and
  native focus traversal.
- [ ] **SC5** — **manage tabs**: open / close / enumerate / **switch (bring-to-front) / send-to-back**,
  and direct any action at a specific tab (by bringing it to the front first — see DD3).

> **Interim verification (per mission decision).** SC1/SC2/SC5 are *behavior-test-backed* at the
> mission level, but the apparatus (an MCP client over the loopback transport) does not exist until
> Flight 3. This flight is verified by **unit tests** over the extracted pure logic plus a **live
> smoke** driven through a dev-only seam and the existing `scripts/cdp-driver.mjs`. The Witnessed
> behavior-test backing is deferred to the Flight 6 spec migration. No behavior-test spec is authored
> for this flight.

---

## Pre-Flight

### Objective

Build the native main-process **drive engine** — the act half of the automation surface — that can
navigate a tab, deliver trusted input (click / type / scroll / key), and manage tab lifecycle
(open / close / enumerate / switch / send-to-back), targeting **both** the chrome renderer and guest
`<webview>` contents. The engine addresses tabs by `webContentsId`, enforces the internal-session
exclusion in the main process, and follows a **foreground-to-act** model (DD3): to act on or screenshot
a tab the agent brings it to the front first (an explicit switch), matching how a human uses tabs and
keeping the existing single-live-tab architecture. Tab lifecycle is **renderer-mediated** (via
`executeJavaScript` against a chrome hook); input and navigation act **natively on a resolved
`webContents`**. This flight is gate-free by design (gating is Flight 4) and exercised through a
dev-only seam until the Flight 3 transport replaces it.

### Open Questions
- [x] How does a main-process engine manage tabs when tab state is renderer-owned? → see DD1.
- [x] Does acting on a tab happen in the background or foreground? → see DD3 (foreground-to-act for
  v1; true background driving deferred + de-risked, see DD9).
- [x] Include chrome-renderer input in this flight? → see DD4 (yes).
- [x] How is the engine invoked before the Flight 3 transport exists? → see DD7 (dev-only seam).
- [x] Does this flight need the session-type registry (mission carry-in)? → see DD5 (no — deferred).
- [ ] Exact `sendInputEvent` recipe for a reliable synthetic **click** on a guest webview (single
  `mouseDown`+`mouseUp` vs needing `mouseMove` first; modifier/last-button quirks) — resolve with a
  leg-time spike against the live app, not from docs. **Known-good starting sequence:**
  `cdp-driver.mjs:88-94` already works via CDP with `mouseMoved → mousePressed → mouseReleased`; start
  the `sendInputEvent` spike from the equivalent `mouseMove → mouseDown → mouseUp`.
- [ ] Coordinate space for input on a guest: `sendInputEvent` on a guest `webContents` uses
  coordinates relative to that guest's own viewport — confirm on the live app so chrome-vs-guest
  targeting uses the right origin.

### Design Decisions

**DD1 — Split: native-in-main for act-on-`webContents`, renderer-mediated for tab lifecycle, via
`executeJavaScript` against a renderer-exposed hook.**
- Choice: Input (`sendInputEvent`) and navigation (`loadURL`/`goBack`/`goForward`/`reload`) act
  directly on a `webContents` resolved in the main process. Open / close / switch / enumerate are
  performed by the renderer (which owns the `tabs` map at `renderer.js:86`); the engine invokes them by
  calling **`mainWindow.webContents.executeJavaScript('window.__goldfinchAutomation.<op>(...)')`**
  against a small hook the chrome renderer exposes on its own `window`.
- Rationale: The main process has no tab registry and cannot enumerate tabs; and a `<webview>`'s
  `partition`/`preload` freeze at DOM attach (M02 learning #3), so only the renderer's `createTab`
  (`renderer.js:461`) can stand up a tab with the correct jar. **`ipcMain.handle` cannot be used — it
  resolves in main, and Electron has no `ipcRenderer.handle`, so the renderer cannot answer a
  request/response IPC.** `executeJavaScript` is the Electron-sanctioned main→renderer read/command
  path (and the same surface Flight 2 uses for DOM reads): it returns a promise resolving with the
  JSON-serializable result, so reads and commands use one mechanism with no new IPC channels and **no
  contextBridge/preload changes**.
- Security: the hook is defined **only on the chrome renderer's `window`** (a privileged app shell that
  loads no web content), never injected into guests — so no guest/web content can reach it.
- Trade-off: the engine depends on the renderer for tab ops; a pure "everything in main" surface isn't
  achievable. Accepted — it matches the existing architecture.

**DD2 — Canonical tab handle = `webContentsId`.**
- Choice: The engine addresses tabs by `webContentsId`. Enumerate returns
  `{ wcId, url, title, jarId, active }` per tab; all act/navigate calls take a `wcId`.
- Rationale: `wcId` is stable, main-process-native (`webContents.fromId`, `main.js:190`), and survives
  the renderer↔main boundary. Renderer tab ids are renderer-private.
- Trade-off: element-level addressing for agents (a11y handles vs selectors) is a separate, later
  concern (mission Open Question) — out of scope here.

**DD3 — Foreground-to-act (v1): bring a tab to the front to act on or screenshot it.**
- Choice: The engine acts on the **foreground** tab. To act on or capture a different tab, the agent
  **brings it to the front first** — an explicit switch — and acting leaves it foreground. Only one tab
  is live at a time (the existing `display:none`-for-others architecture, `renderer.js:554`).
  Bring-to-front / send-to-back are explicit agent operations (the switch); tab create/close/switch are
  all the agent's deliberate choices.
- Rationale (operator, 2026-06-13): the named v1 consumers — dogfooding behavior tests, external Claude
  Code, the-one's agents — are **headless / sandboxed** (no human concurrently at the browser), so an
  agent "taking the wheel" (foregrounding the tab it acts on) is fine. This keeps v1 simple and
  low-risk: it reuses the existing single-live-tab model and **eliminates the focus-interference risk
  entirely** (only one tab is ever live).
- Trade-off (consciously accepted): v1 agents **cannot** work invisibly behind a human who is actively
  browsing — they share the foreground. True concurrent human+agent background driving is deferred and
  de-risked (DD9).
- Forward-compatible: the agent-facing contract ("direct an action at tab X; bring-to-front /
  send-to-back explicitly") is unchanged by a later move to background driving — that change is a
  strict, non-breaking improvement.

**DD4 — Chrome-renderer input is included now, ungated.**
- Choice: The engine can `sendInputEvent`/navigate against `mainWindow.webContents` (the chrome) as
  well as guest webviews, from this flight.
- Rationale: "target both from day one" (mission) — the chrome dogfooding specs
  (`tab-keyboard-operability`, `unified-tab-controls`, `responsive-tab-strip`) need it. Driving the
  chrome is admin-tier in the key model, but **gating is Flight 4**; per the mission's accepted interim
  risk, this flight ships the capability ungated and nothing releases until Flight 4 lands.
- Trade-off: between this flight and Flight 4 the engine can drive the privileged chrome without a key.
  Bounded by the no-release-until-F4 commitment.

**DD5 — Internal-session exclusion enforced in main at resolve-time; session-type registry deferred.**
- Choice: enforced **inside `resolve(wcId)` for every act/nav call**, not merely as an enumerate
  filter: resolving a `wcId` whose `webContents.session.__goldfinchInternal === true` (strict
  `=== true`, mirroring `internal-ipc.js:65`) is **rejected** — so a directly-supplied internal-guest
  `wcId` (the bypass path) cannot be driven. Enumerate applies the same predicate as a filter. Gate on
  the main-process session marker (`main.js:170` precedent), never on a partition string. Since this
  flight is ungated (DD4), the resolve-time predicate is the single load-bearing control protecting the
  internal session — it gets explicit acceptance + verify assertions. The mission's session-type
  registry (`WeakMap<Session, type>`) is **not** built this flight.
- Rationale: the hard security rule from the M02 debrief applies the moment automation can enumerate or
  target contents. The registry's trigger is "a third session category" — this flight introduces none
  (it drives existing web + chrome contents). Build it when the automation jar/session category arrives
  (Flight 4/5).
- Trade-off: a second informal marker check now, formalized later. Low cost; avoids premature
  abstraction.

**DD6 — Main-process navigate re-applies `isSafeTabUrl`; internal URLs are never an engine navigate target.**
- Choice: the engine's `navigate`/open entry points validate the URL with **`isSafeTabUrl`** before
  `loadURL`, reusing `src/shared/url-safety.js`. The engine drives web and chrome contents only, so
  `goldfinch://` internal URLs are **not** a valid engine navigate target (the internal guest is
  excluded from targeting by DD5 anyway).
- Rationale: `will-navigate` (`main.js:169`) only fires for **renderer-initiated** navigation; a
  main-process `loadURL()` bypasses it (M02 Flight-4 spike confirmed). Without re-validation the engine
  is a hostile-URL bypass — a mission hard constraint.
- Trade-off: validation duplicated across the renderer gate and the engine. Belt-and-suspenders;
  consistent with the codebase's existing layered approach.

**DD7 — Interim invocation via a dev-only seam, superseded by Flight 3.**
- Choice: expose the engine through a clearly-marked **dev-only** trigger so it can be driven manually
  and by `scripts/cdp-driver.mjs` (via `Runtime.evaluate` on the chrome renderer target) for the live
  smoke. Removed or folded into the gated transport when Flight 3 lands.
- Security: the seam (and the DD1 hook it reaches) lives in the **chrome renderer world only** and is
  not reachable from guest web content.
- Trade-off: a dev-only entry point exists transiently; dev-guarded, never in a release (same
  no-release-until-F4 envelope).

**DD8 — Flight 1 stays debugger-free (no `webContents.debugger`).**
- Choice: use `sendInputEvent` and `loadURL`/`goBack`/etc. only; no CDP debugger attach this flight.
- Rationale: only one CDP client per `webContents`; the existing `cdp-driver.mjs` (the smoke harness)
  attaches as that client. Keeping the engine debugger-free avoids the conflict; the debugger-based
  a11y/screenshot reads are **Flight 2's** concern.
- Trade-off: none for this flight's scope (input/nav/tabs need no debugger).

**DD9 — Background driving deferred for v1, and de-risked by a pre-flight spike.**
- Status: **RESOLVED (2026-06-13)** — v1 is foreground-to-act (DD3); true concurrent background
  driving/capture is deferred to a future flight.
- Evidence: a throwaway Electron `^42` spike (recorded in the flight log; PNG evidence in
  `/tmp/gf-spike/render-strategy/`, outside the repo) proved the future path is viable, not a research
  risk:
  - **(A) behind-layering** (a full-size webview kept on-screen but occluded behind the foreground)
    captures **non-blank** real content and receives `sendInputEvent`, and survives a same-tab
    front↔back flip with state preserved.
  - **(B) per-tab hidden `BrowserWindow`** (`paintWhenInitiallyHidden` + `backgroundThrottling:false` +
    `sandbox:false`) captures + receives input while never shown, focus-isolated by construction.
  - **Offscreen-translation does NOT work** for capture (`capturePage` hangs — no frame); OSR does not
    apply to `<webview>`.
- Future recommendation: when concurrent human+agent background work becomes a requirement, prefer
  **(A) behind-layering** (preserves the tab-strip architecture; cheap front/back), validating the
  single-window focus-interference question with a real human; **(B)** is the focus-isolated fallback.
  Tracked in the mission Known Issues.

### Prerequisites
- [x] Mission 02 landed (settings store / internal-page bridge available) — satisfied 2026-06-12.
- [x] `src/shared/url-safety.js` exports `isSafeTabUrl` / `isInternalPageUrl` (`url-safety.js:15,95`).
- [x] Renderer owns the tab map and exposes `createTab`/`closeTab`/`activateTab`
  (`renderer.js:461,533,547`) to extend with the hook.
- [x] `node --test test/unit/*.test.js` runner in place for the pure-logic legs.
- [x] DD9 render question resolved by the pre-flight spike (foreground-to-act; background deferred).
- [ ] **Live GUI app reachable for the smoke** — `npm run dev:debug` exposes the CDP port the existing
  `scripts/cdp-driver.mjs` attaches to. (Spike confirmed the GUI + capturePage work in this env with
  `--no-sandbox --disable-dev-shm-usage` and `sandbox:false` web webviews — `main.js:139`.)
- [ ] Confirm no other process is bound to the dev debugging port `9222` before the smoke leg.

### Pre-Flight Checklist
- [ ] Remaining open questions resolved (input recipe + coordinate space — leg-time spikes)
- [x] Design decisions documented
- [ ] Prerequisites verified (live-app smoke prereqs checked at the verify leg)
- [x] Validation approach defined (unit tests + dev-seam/cdp-driver live smoke; no behavior-test spec)
- [ ] Legs defined

---

## In-Flight

### Technical Approach

A new main-process module group under `src/main/automation/` (following the project's pure-module
convention — `url-safety.js`, `internal-ipc.js`):

1. **`resolve.js` (pure where possible).** `webContentsId → webContents` resolution, the
   internal-session exclusion predicate (`session.__goldfinchInternal === true` → reject), and
   chrome-vs-guest classification (`wc === mainWindow.webContents`). The exclusion predicate and any
   shape-mapping are pure and unit-tested with fake session objects (the `internal-ipc.js` pattern).
2. **Navigation.** `navigate(wcId, url)` re-applies `isSafeTabUrl` (DD6) then `wc.loadURL`;
   `back/forward/reload` map to `wc.goBack/goForward/reload`. URL-gate logic extracted pure for tests.
3. **Trusted input.** `sendInput(wcId, event)` wraps `wc.sendInputEvent` for mouse (down/up/move,
   wheel/scroll) and keyboard (char/keyDown/keyUp), targeting chrome or the foreground guest. Key-name
   and event-shape mapping extracted pure (mirror the `KEYS` table in `cdp-driver.mjs`).
4. **Tab lifecycle via `executeJavaScript` + a renderer hook (DD1).** The chrome renderer exposes
   `window.__goldfinchAutomation = { listTabs, openTab, closeTab, activateTab }`, thin wrappers over
   its existing `createTab`/`closeTab`/`activateTab` (`renderer.js:461,533,547`) — `activateTab` already
   implements bring-to-front. The engine calls these via `mainWindow.webContents.executeJavaScript(...)`.
   `listTabs` returns the renderer's raw tab array; **main filters out internal-session contents** via
   the DD5 predicate before returning the DD2 shape.
5. **Foreground-to-act orchestration (DD3).** Before an input/nav call on a tab that isn't foreground,
   the engine issues `activateTab` (bring-to-front) and leaves it foreground. Chrome targets are always
   reachable (the chrome renderer is always live).
6. **Dev-only seam (DD7).** A guarded trigger to invoke engine ops for the live smoke; removed/folded
   at Flight 3.

Pure logic lands in unit-testable modules; the thin Electron-bound calls are integration-verified by
the live smoke. The engine is the single entry point for automation actions (no scattered
`sendInputEvent` calls elsewhere).

### Checkpoints
- [ ] Engine module + target resolution + internal-session exclusion, unit-tested
- [ ] Tab lifecycle (list / open / close / activate=bring-to-front / send-to-back) via the renderer hook
- [ ] Native navigation with re-applied URL safety
- [ ] Trusted input on the chrome and on a (foregrounded) guest
- [ ] Dev seam wired; live smoke drives the chrome and a guest tab end to end
- [ ] Full unit suite green; typecheck + lint clean

### Adaptation Criteria

**Divert if**:
- `sendInputEvent` proves unreliable for synthetic clicks on a guest even when foreground (would force
  a CDP `Input.dispatch*` path — pulling Flight 2's debugger concern forward, and the single-client
  conflict with the cdp-driver smoke harness). Re-plan the input leg + smoke apparatus.
- Tab lifecycle cannot be driven via `executeJavaScript` without restructuring the renderer's tab map
  ownership.

**Acceptable variations**:
- Module file layout under `src/main/automation/` (one file vs a few) as the code settles.
- Exact dev-seam shape (IPC channel vs a `Runtime.evaluate`-reachable hook) — whichever the cdp-driver
  smoke drives most cleanly.
- Splitting or merging the input/nav legs if one proves trivial.

### Legs

> **Note:** Tentative; created one at a time as the flight progresses.

- [x] `engine-scaffold-and-resolve` — `src/main/automation/` module skeleton; `webContentsId →
  webContents` resolution; internal-session exclusion predicate. **Acceptance: `resolve()` rejects a
  directly-supplied internal-guest `wcId` (`session.__goldfinchInternal === true`), not only the
  enumerate path**; chrome-vs-guest classification. Pure logic unit-tested. (DD1, DD2, DD5)
- [x] `tab-lifecycle` — renderer hook `window.__goldfinchAutomation` (chrome renderer only) wrapping
  `createTab`/`closeTab`/`activateTab`; engine drives it via `executeJavaScript`; `listTabs` filtered
  in main by the internal-session exclusion → DD2 shape. **The one renderer source change in this
  flight is exposing this hook.** (DD1, DD3, SC5)
- [x] `native-navigation` — `navigate`/back/forward/reload on a resolved `webContents`, re-applying
  `isSafeTabUrl`; URL-gate unit-tested. (DD6, SC1)
- [x] `trusted-input` — `sendInputEvent` for click / type / scroll / key on the chrome and on a
  foregrounded guest; bring-to-front before acting (DD3); resolve the two input spikes live. (DD4, SC2)
- [x] `dev-seam-and-integration` — dev-only invocation seam; wire the engine as the single automation
  entry; ensure debugger-free (DD8). (DD7)
- [x] `verify-integration` — live smoke via the dev seam + `cdp-driver.mjs`: bring a guest tab to front
  and drive it (nav + input + tab ops), and drive the chrome; confirm the internal `goldfinch://settings`
  guest is (a) absent from `listTabs` AND (b) **rejected when its `wcId` is supplied directly to an
  act/nav call** (the bypass path, per DD5); full unit suite + typecheck + lint green.
- [ ] `hat-and-alignment` *(optional)* — guided HAT: drive the live app interactively, tune the input
  feel and the engine API shape before Flight 2 builds observe on top.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed (6 autonomous legs; optional `hat-and-alignment` not run — see Flight Director Notes)
- [ ] Code merged (draft PR opened at landing; merges after review)
- [x] Tests passing (358/358 unit + typecheck + lint green; live smoke passed)
- [x] Documentation updated (engine modules carry JSDoc headers marking the dev seam interim/DD7; no
  README/CLAUDE.md change — the surface is dev-only with no transport until Flight 3, and the README
  reframe is a Flight 8 deliverable)
- [ ] Flight debrief written (separate `/flight-debrief` step — transitions flight to `completed`)

### Verification

- **Unit**: `node --test test/unit/*.test.js` green, including new cases for the internal-session
  exclusion predicate, the URL-safety re-application gate, and the input/key shape mapping.
- **Live smoke** (manual + `scripts/cdp-driver.mjs`): with the app under `npm run dev:debug`, drive the
  engine through the dev seam to (a) bring a guest tab to front and navigate it, observing the live UI
  update, (b) deliver a click/type to the foreground guest and observe its real handlers fire (DOM
  read-back), (c) deliver input to the chrome, (d) open / close / switch / send-to-back / enumerate
  tabs, and (e) confirm an attempt to resolve/enumerate the `goldfinch://settings` internal guest is
  **rejected** by the exclusion.
- **Static**: `npm run typecheck` and `npm run lint` clean.
- SC1/SC2/SC5 are *advanced* here and *behavior-test-backed* later (Flight 6), per the interim note.
