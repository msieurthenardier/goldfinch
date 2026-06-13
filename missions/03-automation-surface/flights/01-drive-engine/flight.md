# Flight: Drive Engine (input / nav / tabs) + background-tab strategy

**Status**: planning
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC1** — navigate a tab (open URL; back / forward / reload), reflected in the live UI.
  *(Flight 1 delivers the native navigate capability; the client **attach** half and the
  behavior-test backing land with the transport in Flight 3 / migration in Flight 6.)*
- [ ] **SC2** — deliver **trusted input** (click / type / scroll / key) that fires real handlers and
  native focus traversal.
- [ ] **SC5** — **manage tabs**: open / close / enumerate / **bring-to-front / send-to-back**, and
  direct any action at a **background** tab without bringing it to the foreground.

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
(open / close / enumerate / bring-to-front / send-to-back), targeting **both** the chrome renderer and
guest `<webview>` contents. Because tab state is renderer-owned and a webview's partition/preload
freeze at attach, tab lifecycle is **renderer-mediated** (via `executeJavaScript` against a chrome hook)
while input and navigation act **natively on a resolved `webContents`**. The engine addresses tabs by
`webContentsId` and enforces the internal-session exclusion in the main process.

**The defining requirement (operator clarification, 2026-06-13):** "agent-active" — a tab the agent
can drive and capture — is **decoupled from "foreground"** (the tab a human sees in front). An agent
must be able to drive tabs **in the background, concurrently**, while a human keeps using their own
foreground tab undisturbed. This means the engine must keep agent-driven tabs **rendered and live while
not in front** — the current `display:none` dormancy (no render widget → blank `capturePage`,
unreliable `sendInputEvent`) must be replaced for those tabs. **How to keep a background webview live is
the central, version-specific unknown of this flight and is resolved by a gating spike before the
engine design locks (DD9).** Bring-to-front / send-to-back become explicit agent operations (peers of
open/close), never implicit side effects of acting on a tab. This flight is gate-free by design
(gating is Flight 4) and exercised through a dev-only seam until the Flight 3 transport replaces it.

### Open Questions
- [x] How does a main-process engine manage tabs when tab state is renderer-owned? → see DD1.
- [x] Should acting on a tab bring it to the foreground? → see DD3 (no — drive in background;
  agent-active is decoupled from foreground).
- [x] Include chrome-renderer input in this flight? → see DD4 (yes).
- [x] How is the engine invoked before the Flight 3 transport exists? → see DD7 (dev-only seam).
- [x] Does this flight need the session-type registry (mission carry-in)? → see DD5 (no — deferred).
- [ ] **[CENTRAL SPIKE — gates the engine design] Can a background `<webview>` be kept live enough to
  receive `sendInputEvent` AND return a non-blank `capturePage`, while a *different* tab is in the
  foreground?** And by which mechanism (see DD9 candidates)? `display:none` kills the render widget, so
  the answer determines whether the engine can act on background `webContents` directly or needs an
  OSR / per-tab-window restructure. Must be proven on the live app (Electron `^42`), not from docs.
  Capture is Flight 2's deliverable but its *feasibility* is decided here — the spike validates both
  axes. (See DD9, `render-strategy-spike` leg.)
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

**DD3 — Agent-active is decoupled from foreground; the engine drives tabs in the background.**
- Choice: Acting on a tab does **not** bring it to the foreground. The engine drives and (in Flight 2)
  captures agent tabs while they are **background-live** — rendered and driveable but not the
  human-visible front tab — so an agent can work multiple tabs concurrently while a human uses their
  own foreground tab undisturbed. **Bring-to-front** and **send-to-back** are explicit, first-class
  agent operations (peers of open/close), invoked only when the agent intends them — never as a side
  effect of input/nav. Tab create/close/front/back are all **the agent's deliberate choices**.
- Rationale (operator, 2026-06-13): concurrent human + agent use is a core product requirement (the
  "post-AI" thesis). Most agent tabs are jar/container sessions; their web content should remain
  drivable and screenshot-able in the background.
- Consequence: the engine must track which tabs are **kept-live** (the foreground tab is always live;
  agent tabs are kept live on demand) and replace `display:none` dormancy for them — see DD9. The set
  of live tabs = {foreground} ∪ {agent-kept-live}.
- Exception: the **chrome** screenshot (admin-tier only, Flight 2) may foreground/disturb the user;
  acceptable because the admin agent is operator-sanctioned and, if a human is present at all, they
  understand what's happening.
- Trade-off: keeping multiple webviews live costs memory/CPU vs the single-live-tab status quo;
  bounded by keeping only agent-touched tabs live, and quantified by the DD9 spike.

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

**DD9 — Background-live render strategy is SPIKE-GATED (not yet decided).**
- Status: **OPEN — resolved by the `render-strategy-spike` leg before the engine design locks.** This
  is the chief Flight-1 unknown; the answer reshapes DD1/DD3 and the leg plan.
- The problem: a `<webview>` at `display:none` has no live render widget, so `capturePage` is blank and
  `sendInputEvent` is unreliable. To drive/capture a tab that is not the foreground, it must stay
  rendered. Whether Chromium keeps painting an **occluded/offscreen** webview (vs throttling/suspending
  it) is version-specific and must be measured on Electron `^42`.
- Candidate mechanisms (the spike evaluates **four** axes: input lands, `capturePage` non-blank, the
  **front/back transition**, and **focus isolation** — plus perf):
  - **(A) Offscreen-positioning / layering (test first).** Keep the webview in the DOM (not
    `display:none`), with real non-zero dimensions, moved offscreen or stacked behind the active tab.
    Pros: preserves the existing single-window/many-webviews architecture and gives a cheap same-tab
    bring-to-front (a z-order/`display` flip or a transform reset — the spike pins which sub-variant).
    **Its viability reduces to ONE make-or-break empirical question: does Electron `^42` keep painting —
    and `capturePage` — a webview that is in the DOM but visually occluded?** Chromium aggressively
    optimizes occluded surfaces, and today *nothing is ever occluded-but-live* (every webview is
    `position:absolute; inset:0`, non-active ones `display:none` — `styles.css`), so there is no
    existing evidence either way. A **No** answer triggers the divert to (B).
  - **(B) Per-agent-tab hidden `BrowserWindow` / `WebContentsView` (definitive fallback).** Host agent
    tabs in their own window (`show:false` + `paintWhenInitiallyHidden:true` +
    `backgroundThrottling:false`, and `offscreen:true` *is* available here). Definitively paints +
    captures while hidden and isolates input/focus by construction. Cost: a real departure from the
    single-window/many-webviews architecture, and bringing a window-hosted tab to the foreground inside
    the chrome is non-trivial.
  - **OSR on the `<webview>` itself is NOT a candidate.** `webPreferences.offscreen` is a
    BrowserWindow/WebContentsView option; the only webview webPreferences seam is `will-attach-webview`
    (`main.js:130`), where `offscreen` is unsupported, and those prefs **freeze at attach** (M02
    immutability) — so a webview cannot be put into OSR. OSR's paint-while-hidden guarantee is reachable
    only via (B).
- Recommendation: spike **(A)** first (it preserves the architecture); stand up **(B)** in the same
  session as the ready fallback (the spike already builds throwaway code for both). The product thesis
  leans on guaranteed concurrent background capture, so (B) is a real outcome, not a worst case.
- Divert: this spike is effectively a **pre-flight gate on F1's shape** (see Pre-Flight Checklist). If
  (A) fails and (B) is required, the (B) restructure becomes **its own flight** and Flight 1 re-scopes
  to **foreground-only** driving with background deferred — a flight-shape decision made at the spike's
  conclusion, *before* the engine/leg design locks, not a mid-flight variation.

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
- [ ] **DD9 render mechanism resolved by the gating spike — (A) chosen, OR F1 re-scoped to
  foreground-only with the (B) restructure spun into its own flight** (gates the engine/leg design)
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
   shape-mapping are pure and unit-tested with fake session objects (the `internal-ipc.js` test
   pattern).
2. **Navigation.** `navigate(wcId, url)` re-applies `isSafeTabUrl` (DD6) then `wc.loadURL`;
   `back/forward/reload` map to `wc.goBack/goForward/reload`. URL-gate logic extracted pure for unit
   tests.
3. **Trusted input.** `sendInput(wcId, event)` wraps `wc.sendInputEvent` for mouse (down/up/move,
   wheel/scroll) and keyboard (char/keyDown/keyUp), targeting chrome or guest. Key-name and
   event-shape mapping extracted pure (mirror the `KEYS` table precedent in `cdp-driver.mjs`).
4. **Tab lifecycle via `executeJavaScript` + a renderer hook (DD1).** The chrome renderer exposes
   `window.__goldfinchAutomation = { listTabs, openTab, closeTab, bringToFront, sendToBack, keepLive }`,
   thin wrappers over its existing/extended `createTab`/`closeTab`/`activateTab` plus the new
   background-live state from DD9 (`renderer.js:461,533,547`). The engine calls these via
   `mainWindow.webContents.executeJavaScript(...)` (no new IPC channels, no preload change). `listTabs`
   returns the renderer's raw tab array (`{ wcId, url, title, jarId, foreground, live }`); **main then
   filters out internal-session contents** via the DD5 predicate before returning the DD2 shape, so the
   security filter stays in main, not the renderer.
5. **Background-live orchestration (DD3 + DD9).** Acting on a tab does **not** foreground it. Before an
   input/nav/capture call, the engine ensures the target is **kept-live** (via the DD9 mechanism) but
   leaves the foreground tab untouched. `bringToFront`/`sendToBack` are separate, explicit ops. Chrome
   targets are always live (no action needed).
6. **Dev-only seam (DD7).** A guarded trigger to invoke engine ops for the live smoke; removed/folded
   at Flight 3.

The `render-strategy-spike` (DD9) runs **first** and its outcome feeds back into §4/§5 (the keep-live
mechanism) before the input/tab legs build on it.

Pure logic lands in unit-testable modules; the thin Electron-bound calls are integration-verified by
the live smoke. The engine is the single entry point for automation actions (no scattered
`sendInputEvent` calls elsewhere).

### Checkpoints
- [ ] **Render-strategy spike resolved**: a background tab proven on all four axes (input lands,
  non-blank `capturePage`, same-tab front/back without teardown, focus isolation) while another tab is
  foreground — DD9 mechanism chosen, or F1 re-scoped to foreground-only
- [ ] Engine module + target resolution + internal-session exclusion, unit-tested
- [ ] Tab lifecycle (list / open / close / bring-to-front / send-to-back / keep-live) driven via
  `executeJavaScript` + renderer hook
- [ ] Native navigation with re-applied URL safety
- [ ] Trusted input on chrome and a **background** guest
- [ ] Dev seam wired; live smoke drives the chrome and a **background** guest tab end to end
- [ ] Full unit suite green; typecheck + lint clean

### Adaptation Criteria

**Divert if**:
- **The render-strategy spike (DD9) shows candidate (A) fails and (B) — per-tab hidden windows — is
  required.** Then that restructure becomes **its own flight**, and Flight 1 re-scopes to foreground
  driving with background deferred — a flight-shape decision made at the spike's conclusion (the
  pre-flight gate), recorded in the flight log + mission Known Issues.
- `sendInputEvent` proves unreliable for synthetic clicks on a guest even when live (would force a
  CDP `Input.dispatch*` path — pulling Flight 2's debugger concern forward, and the single-client
  conflict with the cdp-driver smoke harness). Re-plan the input leg + smoke apparatus.
- Tab lifecycle cannot be driven via `executeJavaScript` without restructuring the renderer's tab map
  ownership.

**Acceptable variations**:
- The chosen DD9 mechanism among the candidates, as long as it satisfies background input + capture
  without an architectural restructure.
- Module file layout under `src/main/automation/` (one file vs a few) as the code settles.
- Exact dev-seam shape (IPC channel vs a `Runtime.evaluate`-reachable hook) — whichever the cdp-driver
  smoke drives most cleanly.
- Splitting or merging the input/nav legs if one proves trivial.

### Legs

> **Note:** Tentative; created one at a time as the flight progresses.

- [ ] `render-strategy-spike` **(gating — runs first; resolves a pre-flight gate)** — on the live app
  (Electron `^42`), against throwaway/dev code (the M02 spike-before-dependent-build pattern), prove on
  a **background** tab (a *different* tab kept foreground) all **four axes**: (1) `sendInputEvent`
  lands, (2) `capturePage` is **non-blank**, (3) the **same tab** can be brought to foreground and sent
  back without teardown/recreate and without losing live state, (4) **focus isolation** — input to the
  background tab does **not** steal focus from the human's foreground tab. Test candidate **(A)** first
  (pinning the bring-to-front sub-variant — z-order flip vs offscreen reposition) and stand up **(B)**
  as the fallback in the same session; record per-tab memory/CPU with **3–5** background-live tabs.
  Output: a chosen keep-live mechanism + evidence — **or** trigger the DD9 divert (re-scope F1 to
  foreground-only, spin (B) into its own flight). (DD3, DD9)
- [ ] `engine-scaffold-and-resolve` — `src/main/automation/` module skeleton; `webContentsId →
  webContents` resolution; internal-session exclusion predicate. **Acceptance: `resolve()` rejects a
  directly-supplied internal-guest `wcId` (`session.__goldfinchInternal === true`), not only the
  enumerate path**; chrome-vs-guest classification. Pure logic unit-tested. (DD1, DD2, DD5)
- [ ] `tab-lifecycle` — renderer hook `window.__goldfinchAutomation` (chrome renderer only) wrapping
  `createTab`/`closeTab` plus the new **bring-to-front / send-to-back / keep-live** state from the
  spike; engine drives it via `executeJavaScript`; `listTabs` filtered in main by the internal-session
  exclusion → DD2 shape. **The renderer changes in this flight** (called out so they aren't missed):
  exposing the hook; extending the tab model from binary active/hidden to **tri-state** (foreground /
  background-live / dormant); if (A) is chosen, a new `styles.css` `.bg-live` class (real non-zero
  dimensions, occluded/offscreen — never `display:none` nor full-size `inset:0` on top); and revisiting
  `activateTab`/`closeTab` foreground-selection (`renderer.js:540-558`) so send-to-back / close never
  disturb the human's foreground tab or accidentally foreground a background-live agent tab.
  (DD1, DD3, DD9, SC5)
- [ ] `native-navigation` — `navigate`/back/forward/reload on a resolved `webContents`, re-applying
  `isSafeTabUrl`; URL-gate unit-tested. (DD6, SC1)
- [ ] `trusted-input` — `sendInputEvent` for click / type / scroll / key on the chrome and on a
  **background** guest (no foregrounding); resolve the two input spikes live. (DD4, SC2)
- [ ] `dev-seam-and-integration` — dev-only invocation seam; wire the engine as the single automation
  entry; ensure debugger-free (DD8). (DD7)
- [ ] `verify-integration` — live smoke via the dev seam + `cdp-driver.mjs`: drive a **background**
  guest tab (nav + input + tab ops) **while a different tab stays foreground**, and drive the chrome;
  confirm the internal `goldfinch://settings` guest is (a) absent from `listTabs` AND (b) **rejected
  when its `wcId` is supplied directly to an act/nav call** (the bypass path, per DD5); full unit suite
  + typecheck + lint green.
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
- **Live smoke** (manual + `scripts/cdp-driver.mjs`): with the app running under `npm run dev:debug`
  and a human-style foreground tab kept in front, drive the engine through the dev seam to (a) navigate
  a **background** guest tab and observe it update without foregrounding, (b) deliver a click/type to a
  **background** guest and observe its real handlers fire (DOM read-back), (c) deliver input to the
  chrome, (d) open / close / bring-to-front / send-to-back / enumerate tabs, and (e) confirm an attempt
  to resolve/enumerate the `goldfinch://settings` internal guest is **rejected** by the exclusion.
- **Static**: `npm run typecheck` and `npm run lint` clean.
- SC1/SC2/SC5 are *advanced* here and *behavior-test-backed* later (Flight 6), per the interim note.
