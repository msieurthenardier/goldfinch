# Flight: Drive Engine (input / nav / tabs) + hidden-tab strategy

**Status**: planning
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC1** — navigate a tab (open URL; back / forward / reload), reflected in the live UI.
  *(Flight 1 delivers the native navigate capability; the client **attach** half and the
  behavior-test backing land with the transport in Flight 3 / migration in Flight 6.)*
- [ ] **SC2** — deliver **trusted input** (click / type / scroll / key) that fires real handlers and
  native focus traversal.
- [ ] **SC5** — **manage tabs**: open / close / switch / enumerate, and direct any action at a
  specific tab.

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
(open / close / switch / enumerate), targeting **both** the chrome renderer and guest `<webview>`
contents. Because tab state is renderer-owned and a webview's partition/preload freeze at attach, tab
lifecycle is **renderer-mediated via new IPC** while input and navigation act **natively on a resolved
`webContents`**. The engine resolves a target by `webContentsId`, enforces the internal-session
exclusion in the main process, and activates a non-active target before acting (leaving it active).
This flight is gate-free by design (gating is Flight 4) and exercised through a dev-only seam until the
Flight 3 transport replaces it.

### Open Questions
- [x] How does a main-process engine manage tabs when tab state is renderer-owned? → see DD1.
- [x] Restore the operator's tab after acting on a non-active one? → see DD3 (no — leave active).
- [x] Include chrome-renderer input in this flight? → see DD4 (yes).
- [x] How is the engine invoked before the Flight 3 transport exists? → see DD7 (dev-only seam).
- [x] Does this flight need the session-type registry (mission carry-in)? → see DD5 (no — deferred).
- [ ] Exact `sendInputEvent` recipe for a reliable synthetic **click** on a guest webview (single
  `mouseDown`+`mouseUp` vs needing `mouseMove` first; modifier/last-button quirks) — resolve with a
  leg-time spike against the live app, not from docs. **Known-good starting sequence:**
  `cdp-driver.mjs:88-94` already works via CDP with `mouseMoved → mousePressed → mouseReleased`; start
  the `sendInputEvent` spike from the equivalent `mouseMove → mouseDown → mouseUp` rather than from
  scratch.
- [ ] Coordinate space for input on a guest: `sendInputEvent` on a **guest** `webContents` uses
  coordinates relative to that guest's own viewport (differs from the cdp-driver's window-relative
  coords against the renderer target) — confirm on the live app so chrome-vs-guest targeting uses the
  right origin.

### Design Decisions

**DD1 — Split: native-in-main for act-on-`webContents`, renderer-mediated for tab lifecycle, via
`executeJavaScript` against a renderer-exposed hook.**
- Choice: Input (`sendInputEvent`) and navigation (`loadURL`/`goBack`/`goForward`/`reload`) act
  directly on a `webContents` resolved in the main process. Open / close / switch / enumerate are
  performed by the renderer (which owns the `tabs` map at `renderer.js:86`); the engine invokes them
  by calling **`mainWindow.webContents.executeJavaScript('window.__goldfinchAutomation.<op>(...)')`**
  against a small hook the chrome renderer exposes on its own `window`. The engine commands and reads;
  the renderer remains the single source of truth for tab state.
- Rationale: The main process has no tab registry and cannot enumerate tabs; and a `<webview>`'s
  `partition`/`preload` are frozen at DOM attach (M02 learning #3), so only the renderer's `createTab`
  (`renderer.js:461`) can stand up a tab with the correct jar. **`ipcMain.handle` cannot be used for
  this — it resolves in main, and Electron has no `ipcRenderer.handle`, so the renderer cannot answer
  a request/response IPC.** `executeJavaScript` is the Electron-sanctioned main→renderer read/command
  path (and the same surface Flight 2 uses for DOM reads): it returns a promise resolving with the
  JSON-serializable result (the DD2 tab shape; the new tab's `wcId` from open), so reads and commands
  use one uniform mechanism with no new IPC channels and **no contextBridge/preload changes** (the
  hook lives in the chrome renderer's main world where `renderer.js` runs, reachable by
  `executeJavaScript`).
- Trade-off: The engine depends on the renderer being alive/responsive for tab ops; a pure
  "everything in main" surface is not achievable. Accepted — it matches the existing architecture.
- Security: the hook is defined **only on the chrome renderer's `window`** (a privileged app shell
  that loads no web content), never injected into guest webviews — so no guest/web content can reach
  it; `executeJavaScript` targets a specific `webContents`, and guests have their own.

**DD2 — Canonical tab handle = `webContentsId`.**
- Choice: The engine addresses tabs by `webContentsId`. Enumerate returns
  `{ wcId, url, title, jarId, active }` per tab; all act/navigate calls take a `wcId`.
- Rationale: `wcId` is stable, main-process-native (`webContents.fromId`, already used at
  `main.js:190`), and survives the renderer↔main boundary. Renderer tab ids are renderer-private.
- Trade-off: Element-level addressing for agents (a11y handles vs selectors) is a separate, later
  concern (mission Open Question) — out of scope here.

**DD3 — Activate-then-act leaves the target active (no restore).**
- Choice: To act on a non-active tab, the engine switches it visible (IPC → renderer), then acts, and
  **leaves it active**. No save/restore of the operator's prior tab.
- Rationale (operator): a single agent typically performs many actions on one tab; tab create/close
  is **explicitly the agent's responsibility**, so churn-minimizing restore logic is unwanted
  complexity. Avoids flicker-storms across multi-step sequences.
- Trade-off: For a human watching, the active tab follows the agent. Acceptable; the primary mode is
  agent-driven, and an operator can switch back manually.

**DD4 — Chrome-renderer input is included now, ungated.**
- Choice: The engine can `sendInputEvent`/navigate against `mainWindow.webContents` (the chrome) as
  well as guest webviews, from this flight.
- Rationale: "target both from day one" (mission) — the chrome dogfooding specs
  (`tab-keyboard-operability`, `unified-tab-controls`, `responsive-tab-strip`) need it. Driving the
  chrome is admin-tier in the key model, but **gating is Flight 4**; per the mission's accepted
  interim risk, this flight ships the capability ungated and nothing releases until Flight 4 lands.
- Trade-off: Between this flight and Flight 4 the engine can drive the privileged chrome without a
  key. Bounded by the no-release-until-F4 commitment.

**DD5 — Internal-session exclusion enforced in main at resolve-time; session-type registry deferred.**
- Choice: The exclusion is enforced **inside `resolve(wcId)` for every act/nav call**, not merely as
  an enumerate filter: resolving a `wcId` whose `webContents.session.__goldfinchInternal === true`
  (strict `=== true`, mirroring `internal-ipc.js:65`) is **rejected** — so a directly-supplied
  internal-guest `wcId` (the bypass path that skips enumerate) cannot be driven. Enumerate applies the
  same predicate as a filter. Gate on the main-process session marker (`main.js:170` precedent), never
  on a partition string. Since this flight is ungated (DD4), the resolve-time predicate is the single
  load-bearing control protecting the internal session — it gets explicit acceptance + verify
  assertions (see the scaffold and verify legs). The mission's session-type registry
  (`WeakMap<Session, type>`) is **not** built this flight.
- Rationale: The hard security rule from the M02 debrief applies the moment automation can enumerate
  or target contents. But the registry's trigger is "a third session category" — and this flight
  introduces no new session category (it drives existing web + chrome contents). Build the registry
  when the automation **jar/session category** actually arrives (Flight 4/5).
- Trade-off: A second informal marker check now, formalized later. Low cost; avoids premature
  abstraction.

**DD6 — Main-process navigate re-applies `isSafeTabUrl`; internal URLs are never an engine navigate target.**
- Choice: The engine's `navigate`/open entry points validate the URL with **`isSafeTabUrl`** before
  `loadURL`, reusing `src/shared/url-safety.js`. The engine drives **web and chrome** contents only, so
  `goldfinch://` internal URLs are **not** a valid engine navigate target in this flight —
  `isInternalPageUrl` is not part of the engine's navigate gate (it accepts only the root
  `goldfinch://settings`, `url-safety.js:95`, and the internal guest is excluded from targeting by
  DD5 anyway).
- Rationale: `will-navigate` (`main.js:169`) only fires for **renderer-initiated** navigation; a
  main-process `loadURL()` bypasses it (M02 Flight-4 spike confirmed). Without re-validation the engine
  is a hostile-URL bypass — a mission hard constraint.
- Trade-off: Validation duplicated across the renderer gate and the engine. Belt-and-suspenders;
  consistent with the codebase's existing layered approach.

**DD7 — Interim invocation via a dev-only IPC seam, superseded by Flight 3.**
- Choice: Expose the engine through a clearly-marked **dev-only** trigger so it can be driven manually
  and by `scripts/cdp-driver.mjs` (via `Runtime.evaluate` on the chrome renderer target) for the live
  smoke. The seam is removed or folded into the gated transport when Flight 3 lands.
- Rationale: The transport doesn't exist until Flight 3, but the engine needs live exercise now. A
  temporary, named seam keeps the interim path explicit and disposable.
- Security: the seam (and the DD1 `__goldfinchAutomation` hook it reaches) must live in the **chrome
  renderer world only** and must **not** be reachable from guest web content — same containment as
  DD1's hook.
- Trade-off: A dev-only entry point exists transiently. It is dev-guarded and never ships in a release
  (same no-release-until-F4 envelope).

**DD8 — Flight 1 stays debugger-free (no `webContents.debugger`).**
- Choice: Use `sendInputEvent` and `loadURL`/`goBack`/etc. only; no CDP debugger attach in this flight.
- Rationale: Only one CDP client per `webContents`; the existing `cdp-driver.mjs` (the smoke harness)
  attaches as that client. Keeping the engine debugger-free this flight avoids the conflict; the
  debugger-based a11y/screenshot reads are **Flight 2's** concern, where the conflict is designed for.
- Trade-off: None for this flight's scope (input/nav/tabs need no debugger).

### Prerequisites
- [x] Mission 02 landed (settings store / internal-page bridge available) — satisfied 2026-06-12.
- [x] `src/shared/url-safety.js` exports `isSafeTabUrl` / `isInternalPageUrl` (`url-safety.js:15,95`).
- [x] Renderer owns the tab map and exposes `createTab`/`closeTab`/`activateTab`
  (`renderer.js:461,533,547`) to extend with IPC.
- [x] `node --test test/unit/*.test.js` runner in place (`package.json`) for the pure-logic legs.
- [ ] **Live GUI app reachable for the smoke** — `npm run dev:debug` exposes the CDP port the
  existing `scripts/cdp-driver.mjs` attaches to (verify the port is free; see Environment Conflicts).
- [ ] Confirm no other process is bound to the dev debugging port `9222` before the smoke leg.

### Pre-Flight Checklist
- [ ] All open questions resolved (two leg-time spikes remain — input recipe + coordinate space)
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
   shape-mapping are pure and unit-tested with fake session objects (the `internal-ipc.js` test
   pattern).
2. **Navigation.** `navigate(wcId, url)` re-applies `isSafeTabUrl`/`isInternalPageUrl` (DD6) then
   `wc.loadURL`; `back/forward/reload` map to `wc.goBack/goForward/reload`. URL-gate logic extracted
   pure for unit tests.
3. **Trusted input.** `sendInput(wcId, event)` wraps `wc.sendInputEvent` for mouse (down/up/move,
   wheel/scroll) and keyboard (char/keyDown/keyUp), targeting chrome or guest. Key-name and
   event-shape mapping extracted pure (mirror the `KEYS` table precedent in `cdp-driver.mjs`).
4. **Tab lifecycle via `executeJavaScript` + a renderer hook (DD1).** The chrome renderer exposes
   `window.__goldfinchAutomation = { listTabs, openTab, closeTab, activateTab }`, thin wrappers over
   its existing `createTab`/`closeTab`/`activateTab` (`renderer.js:461,533,547`). The engine calls
   these via `mainWindow.webContents.executeJavaScript(...)` (no new IPC channels, no preload change).
   `listTabs` returns the renderer's raw tab array (`{ wcId, url, title, jarId, active }`); **main then
   filters out internal-session contents** via the DD5 predicate before returning the DD2 shape, so the
   security filter stays in main, not the renderer.
5. **Activate-then-act orchestration.** The engine, before an input/nav call on a non-active target,
   issues `tab-activate` (DD3: leave active). For chrome targets, no activation needed (always
   visible).
6. **Dev-only seam (DD7).** A guarded trigger to invoke engine ops for the live smoke; removed/folded
   at Flight 3.

Pure logic lands in unit-testable modules; the thin Electron-bound calls are integration-verified by
the live smoke. The engine is the single entry point for automation actions (no scattered
`sendInputEvent` calls elsewhere).

### Checkpoints
- [ ] Engine module + target resolution + internal-session exclusion, unit-tested
- [ ] Tab lifecycle (list / open / close / activate) driven via `executeJavaScript` + renderer hook
- [ ] Native navigation with re-applied URL safety
- [ ] Trusted input on chrome and guest
- [ ] Dev seam wired; live smoke drives both chrome and a guest tab end to end
- [ ] Full unit suite green; typecheck + lint clean

### Adaptation Criteria

**Divert if**:
- `sendInputEvent` proves unreliable for synthetic clicks on a guest even when active (would force a
  CDP `Input.dispatch*` path — pulling Flight 2's debugger concern forward, and the single-client
  conflict with the cdp-driver smoke harness). Re-plan the input leg + smoke apparatus.
- Tab lifecycle cannot be round-tripped without restructuring the renderer's tab map ownership.

**Acceptable variations**:
- Module file layout under `src/main/automation/` (one file vs a few) as the code settles.
- Exact dev-seam shape (IPC channel vs a `Runtime.evaluate`-reachable hook) — whichever the cdp-driver
  smoke drives most cleanly.
- Splitting or merging the input/nav legs if one proves trivial.

### Legs

> **Note:** Tentative; created one at a time as the flight progresses.

- [ ] `engine-scaffold-and-resolve` — `src/main/automation/` module skeleton; `webContentsId →
  webContents` resolution; internal-session exclusion predicate. **Acceptance: `resolve()` rejects a
  directly-supplied internal-guest `wcId` (`session.__goldfinchInternal === true`), not only the
  enumerate path**; chrome-vs-guest classification. Pure logic unit-tested. (DD1, DD2, DD5)
- [ ] `tab-lifecycle` — renderer hook `window.__goldfinchAutomation` (chrome renderer only) wrapping
  `createTab`/`closeTab`/`activateTab`; engine drives it via `executeJavaScript`; `listTabs` filtered
  in main by the internal-session exclusion → DD2 shape; activate primitive (leave active). **The one
  renderer source change in this flight is exposing this hook** — called out so it isn't missed.
  (DD1, DD3, SC5)
- [ ] `native-navigation` — `navigate`/back/forward/reload on a resolved `webContents`, re-applying
  `isSafeTabUrl`/`isInternalPageUrl`; URL-gate unit-tested. (DD6, SC1)
- [ ] `trusted-input` — `sendInputEvent` for click / type / scroll / key on chrome and guest;
  activate-then-act for non-active targets; resolve the two input spikes live. (DD4, SC2)
- [ ] `dev-seam-and-integration` — dev-only invocation seam; wire the engine as the single automation
  entry; ensure debugger-free (DD8). (DD7)
- [ ] `verify-integration` — live smoke via the dev seam + `cdp-driver.mjs`: drive both chrome and a
  guest tab (nav + input + tab ops); confirm the internal `goldfinch://settings` guest is (a) absent
  from `listTabs` AND (b) **rejected when its `wcId` is supplied directly to an act/nav call** (the
  bypass path, per DD5); full unit suite + typecheck + lint green.
- [ ] `hat-and-alignment` *(optional)* — guided HAT: drive the live app interactively, tune the input
  feel and the engine API shape before Flight 2 builds observe on top.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (unit suite + typecheck + lint)
- [ ] Documentation updated (engine module JSDoc; note the dev-only seam is interim)
- [ ] Flight debrief written (per M02 process finding — debrief is part of landing)

### Verification

- **Unit**: `node --test test/unit/*.test.js` green, including new cases for the internal-session
  exclusion predicate, the URL-safety re-application gate, and the input/key shape mapping.
- **Live smoke** (manual + `scripts/cdp-driver.mjs`): with the app running under `npm run dev:debug`,
  drive the engine through the dev seam to (a) navigate a guest tab and observe the live UI update,
  (b) deliver a click/type to a guest and observe its real handlers fire (DOM read-back), (c) deliver
  input to the chrome (e.g. activate a tab via the real tab strip), (d) open / close / switch /
  enumerate tabs, and (e) confirm an attempt to resolve/enumerate the `goldfinch://settings` internal
  guest is **rejected** by the exclusion.
- **Static**: `npm run typecheck` and `npm run lint` clean.
- SC1/SC2/SC5 are *advanced* here and *behavior-test-backed* later (Flight 6), per the interim note.
