# Flight: Observe Engine (screenshot / DOM / a11y)

**Status**: landed
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC3** — the client can **read a target tab's state**: its DOM and its accessibility tree.
  *(Flight 2 delivers the native read capability; the client **attach** half + behavior-test backing
  land with the transport in Flight 3 / migration in Flight 6.)*
- [ ] **SC4** — the client can **capture a screenshot** of a target tab (and the chrome) on demand.

> **Interim verification (per mission decision).** SC3/SC4 are *behavior-test-backed* at the mission
> level, but the apparatus (an MCP client over the loopback transport) does not exist until Flight 3.
> This flight is verified by **unit tests** over the injected-deps orchestration (fake `webContents` /
> `debugger`) plus a **live smoke** driven through the Flight-1 dev seam and `scripts/cdp-driver.mjs`,
> and an optional **guided HAT** where the operator is the ground-truth oracle for observation
> *faithfulness*. The Witnessed behavior-test backing is deferred to the Flight 6 spec migration. No
> behavior-test spec is authored for this flight.

---

## Pre-Flight

### Objective

Build the native main-process **observe engine** — the *read* half of the automation surface — that
captures a **screenshot** (`capturePage`), reads a tab's **DOM** (`executeJavaScript`), and reads its
**accessibility tree** (in-process `webContents.debugger` → `Accessibility.getFullAXTree`), on the
**foreground** tab, targeting both the chrome renderer and guest `<webview>` contents. It reuses
Flight 1's `resolveContents` (internal-session exclusion stays absolute), `classifyContents`, and the
foreground-to-act model, and is exposed through the existing dev-only seam + `engine.js` single entry.
The accessibility tree is the **only** capability that needs the debugger; it is attached on demand,
read, and **detached immediately**, with a single-client lock and a **clean refusal** when another
client (DevTools, or `cdp-driver` on the chrome) already holds the contents — which resolves the
mission's CDP single-client-per-contents open question. Gate-free by design (gating is Flight 4);
nothing releases until Flight 4 lands.

### Open Questions
- [x] Rich-read mechanism for the a11y tree? → DD3: in-process `webContents.debugger` →
  `Accessibility.getFullAXTree` (no port; reuses the exact tree the current tests assert; and an
  in-process attach to a resolved `webContents` **sidesteps** the flat-`/json`-list guest-discovery
  problem `a11y-audit.mjs` warns about).
- [x] CDP single-client-per-contents conflict (DevTools open / a second client)? → DD8:
  attach-on-demand + detach-immediately + single-client lock + **clean refusal** (not a crash/hang).
- [x] DOM read mechanism — CDP `DOM.*` vs `executeJavaScript`? → DD2: `executeJavaScript`
  (debugger-free, no single-client conflict, reuses the established main→guest read path).
- [x] Output shape (a11y tree, DOM) — trimmed/normalized vs raw full-fidelity? → DD4: **raw,
  maximally capable** for v1 (operator steer: agents navigate complexity well and improve; trimming
  discards signal). A higher-level projection is a later/Flight-9 ergonomics concern. **Architect to
  validate** the raw shape against payload/serialization cost.
- [x] Does observe operate on background tabs? → DD5: **no — foreground-to-act**, matching the mission
  ("on the foreground tab") and Flight 1. `capturePage` returns blank on a hidden webview
  (spike-proven), so screenshot *must* foreground; DOM/a11y reads route through the same model for a
  single consistent contract in v1. Background reads are part of the deferred concurrent-driving flight.
- [ ] Exact `webContents.debugger` protocol version + the `Accessibility` enable/`getFullAXTree`
  command sequence on Electron `^42`, and whether a guest `capturePage` needs a paint-settle delay
  after foregrounding — resolve with a leg-time check against the live app (the `observe-a11y` and
  `observe-scaffold-and-screenshot` legs), not from docs.

### Design Decisions

**DD1 — Screenshot via `capturePage()` (debugger-free), foreground-first for guests.**
- Choice: `captureScreenshot(wcId)` resolves the target, and — for a guest — brings it to front
  (reusing Flight 1's injected `activate`) before `wc.capturePage()`; returns the PNG as base64
  (`NativeImage.toPNG().toString('base64')`) so the result is JSON-serializable across the dev seam
  and the future transport. A whole-window capture uses `mainWindow.webContents.capturePage()` (chrome
  + composited guests).
- Rationale: `capturePage` is the trusted, debugger-free screenshot path and has **no** single-client
  conflict, so it composes freely with the cdp-driver smoke. The Flight-1 spike proved `capturePage`
  returns blank on a hidden/offscreen webview → foreground-to-act is required for guest shots.
- Trade-off: base64 inflates the payload ~33%; acceptable for v1 (a screenshot is large regardless),
  revisit if the Flight-3 transport needs a binary channel.

**DD2 — DOM read via `executeJavaScript` (debugger-free), not CDP `DOM.*`.**
- Choice: `readDom(wcId)` resolves the target and returns full-fidelity DOM via
  `wc.executeJavaScript('document.documentElement.outerHTML')` (plus the document URL/title for
  context). No debugger.
- Rationale: `executeJavaScript` is the established main→guest read path (Flight 1 DD1, and the same
  surface `a11y-audit.mjs` uses for axe), is debugger-free (no single-client conflict), and works on a
  resolved guest `webContents` without target discovery.
- Trade-off: `outerHTML` is a serialized snapshot, not a live handle; element-addressing (a11y handles
  vs selectors) is the mission's deferred Open Question, out of scope here.

**DD3 — Accessibility tree via in-process `webContents.debugger` → `Accessibility.getFullAXTree`.**
- Choice: `readAxTree(wcId)` resolves the target, then `wc.debugger.attach('1.3')` →
  `sendCommand('Accessibility.enable')` → `sendCommand('Accessibility.getFullAXTree')` →
  `wc.debugger.detach()` in a `finally`. Returns the **raw** node array (DD4).
- Rationale: there is **no pure-JS path** to the platform a11y tree; the in-process debugger is the
  mission-recommended mechanism and an in-process attach to a *resolved* `webContents` sidesteps the
  flat-`/json` guest-discovery hazard `a11y-audit.mjs:142-179` documents. This is the **only** debugger
  use in the whole engine.
- Trade-off: introduces the single-client-per-contents constraint (DD8); managed by attach-on-demand +
  immediate detach.

**DD4 — Output shape: raw, maximally capable (a11y + DOM), pending architect validation.**
- Choice: `readAxTree` returns the raw `getFullAXTree` node array; `readDom` returns full `outerHTML`.
  No trimming/normalization in v1.
- Rationale (operator, 2026-06-13): agents navigate complexity well and are improving; a normalized
  shape discards signal and bakes in today's assumptions. A projection layer (role/name/value) is a
  cheap later addition (Flight 9 ergonomics) on top of raw data — the reverse is lossy.
- Trade-off: larger payloads over the eventual transport. **Architect-validated (2026-06-13):** the
  `getFullAXTree` result is a **flat array of plain AXNodes — JSON-serializable, no cyclic refs or
  non-JSON values**, so the raw shape is safe across `executeJavaScript`/IPC/the transport. Two caveats
  recorded: (a) each node's `backendNodeId`/`frameId` are **CDP-session-scoped handles** that serialize
  as integers but go **stale immediately on detach** — they are *informational in the snapshot, not
  live references* (action-linking by `backendNodeId` is a Flight-3+ concern needing re-attach); (b) a
  rich page can yield 100–500 KB of JSON — acceptable for v1 (human in the loop), to be revisited at
  the Flight-3 transport. The projection layer is added as an **opt-in `{ depth?, properties? }`
  parameter stub** in `readAxTree`'s signature (documented extension point for Flight 9), **never** a
  default payload truncation that drops nodes.

**DD5 — Observe operates on the foreground tab (foreground-to-act), reusing Flight 1.**
- Choice: guest observe ops bring the target to front (injected `activate`) before acting; chrome is
  always live. One live tab at a time (the existing model).
- Rationale: the mission scopes SC3/SC4 to "the foreground tab"; `capturePage` *requires* foreground
  (blank otherwise); routing DOM/a11y through the same model gives one consistent contract. The
  stale-handle re-resolve discipline from Flight 1's `actOn` (re-resolve **after** the async
  `activate`) applies identically here.
- Trade-off: no background observation in v1 — deferred to the concurrent-driving flight (mission Known
  Issue), forward-compatible.

**DD6 — Internal-session exclusion stays absolute; admin-debugger-on-internal is Flight 4.**
- Choice: every observe op resolves through Flight 1's `resolveContents`, which **rejects** internal
  (`goldfinch://settings`) contents. So Flight 2 **cannot** read the settings tab's DOM/a11y/screenshot.
- Rationale: the mission's *one* authorized debugger-on-internal relaxation (the admin key reading the
  settings a11y tree) is **gated behind the admin key (Flight 4/5)**. Until that gate exists, observe
  inherits the absolute exclusion — exactly as input/nav do. Building it ungated now would be the
  privilege escalation the carry-in rule forbids.
- Trade-off: the settings-page a11y read (a real future capability) waits for Flight 4; correct.

**DD7 — Debugger lifecycle safety: attach-on-demand, detach in `finally`, single-client lock.**
- Choice: `readAxTree` never leaves a contents attached — `detach()` runs in a `finally` even on error.
  An in-engine lock (a `Set` of currently-attached `wcId`s, or an `isAttached()` pre-check) prevents a
  second concurrent attach on the same contents.
- Rationale: a leaked attach would block DevTools and all future reads on that contents; the lock plus
  immediate detach keeps the single-client slot free between reads.
- Trade-off: a11y reads on one contents are serialized; fine for v1.

**DD8 — Single-CDP-client conflict: clean refusal (resolves the mission Open Question).**
- Choice: if `wc.debugger.attach()` throws because another client already holds the contents (DevTools
  open on that tab, or a second automation client), `readAxTree` catches it and returns a **clear
  `automation: debugger-unavailable` refusal** — never a crash or hang. `capturePage`/DOM read are
  unaffected (debugger-free).
- Rationale: this is the mission's "detach-on-demand / single-client lock / clear refusal" stance,
  resolved at the engine level.
- **Open premise (architect-flagged, do NOT assume):** in-process `webContents.debugger` and the
  external `--remote-debugging-port` client (`cdp-driver`) are *distinct* CDP attachment mechanisms;
  whether they contend for the same one-client-per-contents slot is **undocumented and
  version-dependent**, and Flight 1 never attached `webContents.debugger` (it was debugger-free), so we
  have no prior evidence. Therefore the conflict path is verified as follows:
  - **Primary (unit):** a fake `debugger` whose `attach()` throws → `readAxTree` returns the clean
    `debugger-unavailable` refusal. This is the authoritative coverage.
  - **Primary (live, HAT):** the operator opens **DevTools** on a tab (an unambiguous second client on
    that contents), then an a11y read on that tab must refuse cleanly. This is the reliable live trigger.
  - **Opportunistic (smoke):** attempt a **chrome** a11y read while `cdp-driver` is attached — it **may**
    refuse (if the slots contend) **or may succeed** (if the in-process path is privileged). The smoke
    records which occurred as a finding; it is **not** a required pass/fail assertion (the premise is
    exactly what's unknown).
- Trade-off: the live *success* path for chrome a11y is confirmed by the DevTools-closed guest read and
  unit tests now; full chrome-a11y-under-load is live-verified once the Flight-3 transport replaces the
  cdp-driver apparatus.

**DD9 — Exposed via the existing engine + dev seam; debugger use confined to `observe.js`.**
- Choice: the new ops (`captureScreenshot`, `readDom`, `readAxTree`) are added to `engine.js`'s
  dispatch and reachable through the same dev-gated `automation:dev-invoke` seam; no new seam surface.
  `webContents.debugger` appears **only** in `observe.js` (the other modules stay debugger-free).
- Rationale: one automation entry point (Flight 1 convention); minimal new surface; the seam is still
  removed/folded at Flight 3.
- Trade-off: none material.

### Prerequisites
- [x] Flight 1 landed — `resolveContents` (internal-session reject), `classifyContents`,
  foreground-to-act (`activate`), `engine.js` single entry, and the dev seam all exist
  (`src/main/automation/`). Completed 2026-06-13.
- [x] `scripts/cdp-driver.mjs` (`eval`/`shot`) is the live-smoke driver and is the precedent for the
  CDP single-client conflict this flight must handle.
- [ ] **Live GUI reachable for the smoke** — `npm run dev:debug` (WSLg display, `--no-sandbox
  --disable-dev-shm-usage`); confirm port 9222 free (verified at the verify/HAT legs, as in Flight 1).
- [ ] Confirm Electron `^42` `webContents.debugger` + `Accessibility.getFullAXTree` behavior on a guest
  `webContents` (leg-time check in `observe-a11y`).

### Pre-Flight Checklist
- [ ] Remaining open question resolved (debugger protocol/command sequence + capturePage paint-settle — leg-time checks)
- [x] Design decisions documented
- [ ] Prerequisites verified (live-app smoke prereqs checked at the verify/HAT legs)
- [x] Validation approach defined (unit tests + dev-seam/cdp-driver live smoke + guided HAT; no behavior-test spec)
- [x] Legs defined

---

## In-Flight

### Technical Approach

A new main-process module `src/main/automation/observe.js` joining the Flight-1 module group, following
the same **injected-deps** convention (so orchestration is unit-testable with fakes; real capture is
integration-verified):

1. **`captureScreenshot(wcId, { fromId, chromeContents, activate })`** — resolve; if guest, `await
   activate(wcId)` then **re-resolve** (stale-handle guard); `wc.capturePage()` → `.toPNG()` → base64.
   A `captureWindow({ chromeContents })` variant captures the whole window.
2. **`readDom(wcId, { fromId, chromeContents, activate })`** — resolve (+ foreground for guest);
   `wc.executeJavaScript('document.documentElement.outerHTML')`; return `{ url, title, html }`.
3. **`readAxTree(wcId, { fromId, chromeContents, activate })`** — resolve (+ foreground for guest);
   guard the single-client lock; `wc.debugger.attach('1.3')` → `Accessibility.enable` →
   `Accessibility.getFullAXTree` → `detach()` in `finally`; on attach failure return the
   `debugger-unavailable` refusal. Return the raw node array.
4. **`engine.js`** gains the three ops in its dispatch; the dev seam reaches them unchanged.
5. **Shared-surface cleanup** (bundled carry-forward from the Flight-1 debrief, both confirmed-live in
   recon): refresh the stale `input.js:52,63` "Pending Leg 6 live confirmation" comments to the
   confirmed finding, and add an **Automation** section to `CLAUDE.md` documenting
   `src/main/automation/` (engine home, the `executeJavaScript` main→renderer rationale,
   foreground-to-act + stale-handle re-resolve, `webContentsId` as the canonical handle, the
   debugger-only-in-`observe.js` rule, and the **no-release-until-Flight-4** ungated-surface invariant).

Pure-ish orchestration lands in `observe.js` (unit-testable with fake `wc`/`debugger`); the live
capture/attach is integration-verified by the smoke and the operator-oracle HAT.

### Checkpoints
- [x] `observe.js` scaffold + `captureScreenshot` (foreground-first guest; base64; whole-window), unit-tested
- [x] `readDom` via `executeJavaScript`, full-fidelity, unit-tested
- [x] `readAxTree` via `webContents.debugger` (attach→getFullAXTree→detach), single-client lock + clean refusal, unit-tested
- [x] Engine + dev seam wired for the three ops; `CLAUDE.md` automation section + `input.js` comment refresh
- [x] Live smoke: guest screenshot/DOM/a11y succeed; whole-window capture; internal-session observe rejected; chrome-a11y-under-cdp-driver outcome **recorded** (not asserted, DD8); full unit suite + typecheck + lint green
- [x] Guided HAT: operator confirms observation *faithfulness* (screenshot/DOM/a11y match reality) + foreground-correctness + the refusal contract (live via the lock path). **DevTools-open conflict test was apparatus-limited (no live trigger; see flight-log Deviations) — dispositioned: land, defer to Flight-3 transport.**

### Adaptation Criteria

**Divert if**:
- `webContents.debugger` + `Accessibility.getFullAXTree` proves unworkable in-process on a guest in
  Electron `^42` (e.g. attach is rejected for guest webContents) — would force a fallback
  (DOM-computed/axe-style a11y approximation, mission's alternative) and re-plan the a11y leg.
- `capturePage` on a foregrounded guest still returns blank despite a paint-settle delay — re-open the
  render-strategy question (it should not, per the spike, but the spike used an ad-hoc harness).

**Acceptable variations**:
- Module file layout (`observe.js` one file vs split capture/dom/a11y) as the code settles.
- The exact `readDom` return shape (`outerHTML` only vs `{url,title,html}`) and whether `readAxTree`
  takes an optional projection/`depth` param (per the DD4 architect outcome).
- A small paint-settle delay before guest `capturePage`.

### Legs

> **Note:** Tentative; created one at a time as the flight progresses.

- [x] `observe-scaffold-and-screenshot` — `observe.js` skeleton (`// @ts-check`, **no top-level
  `require('electron')`** — handles injected, mirroring `input.js`); `captureScreenshot(wcId)` via
  `capturePage().toPNG()`→base64 + a **separate `captureWindow()`** export (whole window via injected
  `chromeContents`; symmetrical dispatch keys in `engine.js`, not a `null`-wcId overload). **Guest
  sequence: resolve → classify → `await activate(wcId)` → re-resolve (stale-handle guard from Flight-1
  `actOn`) → `capturePage`**, with a paint-settle wait after foregrounding (prefer
  `wc.once('did-stop-loading')` when loading, else a small fixed delay — resolve live). Orchestration
  unit-tested with a fake `wc.capturePage`. (DD1, DD5)
- [x] `observe-dom` — `readDom` via `executeJavaScript`, full-fidelity `{url,title,html}` (same guest
  resolve→activate→re-resolve sequence). **JSDoc note:** web guests run `contextIsolation:false`
  (`main.js` `will-attach-webview`), so `outerHTML` reflects the **preload/farbled DOM**, not the raw
  network response — that is the intended "what's actually live" faithfulness. Unit-tested with a fake
  `wc.executeJavaScript`. (DD2, DD4)
- [x] `observe-a11y` — `readAxTree` via in-process `webContents.debugger`: guest sequence
  resolve→classify→activate→**re-resolve**→ then `attach('1.3')` → `Accessibility.enable` →
  `getFullAXTree` → `detach()` in `finally`. **Single-client lock = a synchronous `Set` of attached
  `wcId`s** (`if (locked.has(id)) return refusal; locked.add(id); try { …await… } finally {
  locked.delete(id) }` — race-safe because check-and-add are synchronous, the only `await` is after).
  On `attach()` throw → clean `automation: debugger-unavailable` refusal. **Return contract:** success →
  the raw node array (**possibly empty** if the contents hasn't rendered — an empty array is a valid
  success, distinct from the *thrown* `debugger-unavailable`); accept the opt-in `{ depth?, properties? }`
  stub (may be unimplemented in v1). Unit-tested with a fake `debugger` (attach/enable/getFullAXTree/
  detach happy path + the throw-on-attach refusal + the concurrent-lock refusal). Resolve the exact
  protocol-version + whether `Accessibility.enable` is required before `getFullAXTree` on Electron `^42`
  **live**. (DD3, DD4, DD7, DD8)
- [x] `wire-and-docs` — add the three ops to `engine.js` + the dev-seam dispatch; **refresh the stale
  `input.js` comments**; **add the `CLAUDE.md` Automation section** (carry-forward from the F1 debrief,
  shared-surface). (DD9 + F1-debrief action items)
- [x] `verify-integration` — live smoke via the dev seam + `cdp-driver.mjs`: foreground a guest and
  screenshot/DOM/a11y it (succeed); whole-window capture; confirm an internal `goldfinch://settings`
  wcId is **rejected** for all three observe ops (DD6); full unit suite + typecheck + lint green.
  **Opportunistic (not a required assertion):** attempt a chrome a11y read while cdp-driver is attached
  and **record** whether it refuses or succeeds (the DD8 premise is unverified) — the clean-refusal path
  is authoritatively covered by the unit test + the HAT DevTools scenario, not this step.
- [x] `hat-and-alignment` *(optional — included)* — guided HAT: the operator is the ground-truth oracle
  for observation **faithfulness** — screenshot shows the real page (incl. whole-window chrome+guest),
  DOM/a11y match the visible controls, and a backgrounded tab is correctly foregrounded (non-blank shot).
  **Primary live conflict test:** operator opens **DevTools** on a tab, then an a11y read on that tab
  must **refuse cleanly** (the reliable second-client trigger, per DD8). Tune output shape/ergonomics
  with the operator.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed (1–6)
- [ ] Code merged *(draft PR #38 open, stacked on flight/01 PR #36 — merges after review)*
- [x] Tests passing (unit suite 391/0 + typecheck + lint) — re-confirmed at the verify leg
- [x] Documentation updated (`observe.js` JSDoc; the new `CLAUDE.md` Automation section)
- [ ] Flight debrief written — separate `/flight-debrief` step (transitions the flight to `completed`)

### Verification
- **Unit**: `node --test test/unit/*.test.js` green, including new `observe.js` cases — the
  foreground-for-guest orchestration, the resolve-rejection passthrough (internal/bad/dead), the
  screenshot base64 shape, the DOM read shape, and the a11y attach→getFullAXTree→detach happy path +
  the single-client/clean-refusal path (all with fakes).
- **Live smoke** (`scripts/cdp-driver.mjs` + dev seam): guest screenshot (non-blank, foregrounded),
  guest DOM read (matches page), guest a11y read (tree returned), whole-window capture, and
  internal-session observe **rejected**. Chrome-a11y-under-cdp-driver: **outcome recorded, not
  asserted** (DD8 premise unverified).
- **HAT** (operator oracle): observation faithfulness + foreground correctness + the **DevTools-open →
  clean a11y refusal** (primary live conflict test).
- **Static**: `npm run typecheck` and `npm run lint` clean.
- SC3/SC4 are *advanced* here and *behavior-test-backed* later (Flight 6), per the interim note.
