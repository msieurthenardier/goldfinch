# Leg: chrome-drive-spike

**Status**: ready
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

## Objective
Verify, against the **live** running app via an admin MCP client, that the apparatus premise holds on the **chrome `wcId`** — both axes: (observe) `readDom` / `readAxTree` / `captureWindow` work, and (act) trusted `click` / `typeText` / `pressKey` fire the chrome's real handlers + native focus — and record a **resolve-or-divert** verdict that gates the migrations (leg 4).

## Context
- **DD2** (flight): this is the apparatus premise audit, a verification spike — NOT an implementation leg. It is a **hard ordering dependency**: it runs **after** `chrome-target-affordance` (leg 1, landed — needs `getChromeTarget` to obtain a chrome `wcId`) and **before** the migrations (`migrate-subset-specs`, leg 4), whose specs assert against this surface.
- **Both axes are unverified premises** (flight-log Reconnaissance): **act** — `input.js` synthetic-input coordinates are tuned for *guests*; chrome trusted input is unconfirmed. **observe** — `readAxTree` uses the in-process CDP debugger (`cdp.js` `withDebuggerSession`, attach `'1.3'`); its attach on a *guest* is only runtime-verified, and the **chrome** renderer may interact with Electron's own internal DevTools session differently. The spike is exactly where these are settled.
- **Verification standard** (M02 debrief, operator): FD-driven live runs with **cited machine-read evidence** are the accepted standard; the two-agent Witnessed `/behavior-test` pattern remains available at the operator's election for high-stakes specs. This spike follows the FD-driven-with-evidence standard.

## Inputs
- Leg 1 landed: `getChromeTarget` MCP tool returns `{ wcId, kind: 'chrome', url }` for an admin client; jar keys refused.
- Apparatus available: `npm run dev:automation` (`electron . --enable-logging --no-sandbox --automation-dev`) starts the loopback MCP server. With `GOLDFINCH_AUTOMATION_DEV_MINT=1` + `GOLDFINCH_AUTOMATION_ADMIN=1`, `main.js:936-939` mints a default-jar key + an admin key and writes one parseable stdout line: `AUTOMATION_DEV_MINT {"key":"…","adminKey":"…"}`. Port via `GOLDFINCH_MCP_PORT` (default `49707`).
- An **admin MCP client**: an MCP-SDK client sending `Authorization: Bearer <adminKey>` to `http://127.0.0.1:<port>/mcp` (the F4/F5 behavior-test apparatus pattern — e.g. `settings-automation`'s run used `StreamableHTTPClientTransport` + a Bearer key; `scripts/mcp-example-client.mjs` is the attach-don't-launch SDK skeleton but is currently **unauthenticated**, so the spike needs a Bearer-carrying variant).
- A live GUI display (WSLg) — `capturePage`/`sendInputEvent` need a real render surface. The **chrome renderer is always foreground/live** (no foreground-to-act), which is why the chrome axis is expected to work even though hidden *guest* tabs do not.

## Outputs
- A recorded **verdict** in the flight log (Decisions/Session Notes): for each axis, pass or the specific failure + the resolve-or-divert taken.
- If **resolve**: machine-read evidence captured (saved to the ephemeral evidence dir `/tmp/behavior-tests/goldfinch/chrome-drive-spike/<ts>/` — never committed) and the migrations (leg 4) are cleared to assert against the chrome via the admin MCP surface.
- If **divert**: a recorded limitation + the narrowed migration plan (see Adaptation), and — if the cause is a fixable engine gap (chrome coordinate/focus handling) — a follow-up implementation step folded into this flight before leg 4.
- **No production code change expected** on the pass path; this is a spike. (A divert-triggered engine fix is the only code path.)

## Acceptance Criteria
- [ ] **AC1 (observe — DOM)** — Through an admin MCP client, `getChromeTarget()` → `readDom(chromeWcId)` returns the **chrome** document (`{ url, title, html }` where `url` is the chrome app URL and `html` contains chrome-shell markers — tab strip / toolbar). Evidence: the returned `url`/`title` + a chrome-identifying HTML substring.
- [ ] **AC2 (observe — a11y)** — `readAxTree(chromeWcId)` returns a **non-empty AXNode array** (NOT the `{ automation: 'debugger-unavailable' }` refusal, NOT `[]`) — i.e. the in-process CDP debugger attaches `'1.3'` on the chrome target and `Accessibility.getFullAXTree` returns nodes. Evidence: node count + a sample node. **(If this cannot attach on chrome → divert per Adaptation; record it, do NOT fail the flight.)**
- [ ] **AC3 (observe — capture)** — `captureWindow()` returns an **image content block** (PNG) of the whole window. Evidence: the image saved to the evidence dir; non-trivial byte size.
- [ ] **AC4 (act — trusted input → observable change)** — A trusted input on the chrome `wcId` produces an **observable** chrome change read back via an observe tool: e.g. `pressKey(chromeWcId, 'Tab')` or `click(chromeWcId, x, y)` at a known chrome control moves focus (focus lands on the address bar / a toolbar control) or flips a control's `aria-*`/`data-state`, confirmed via a follow-up `readDom`/`readAxTree`. Evidence: the before/after DOM-or-a11y delta proving the handler fired. **(If chrome trusted input is unreliable → divert per Adaptation.)**
- [ ] **AC5 (verdict recorded)** — The flight log records the per-axis verdict (pass / divert-with-reason) and, on the pass path, that leg 4's migrations may assert against the chrome via the admin surface. On any divert, the recorded limitation + narrowed plan.

## Verification Steps
- Launch: `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707 npm run dev:automation`; capture the `AUTOMATION_DEV_MINT {…}` stdout line; extract `adminKey`.
- Connect an admin MCP client (Bearer `adminKey`) to `http://127.0.0.1:49707/mcp`; `initialize`; `tools/list` shows 17 tools incl. `getChromeTarget`.
- `getChromeTarget()` → record `wcId`. Then drive AC1–AC4 against that `wcId`, capturing evidence for each.
- Record the verdict (AC5) in the flight log.

## Implementation Guidance
1. **This is a run, not a build.** No source changes on the pass path. Drive the live app with the admin client and collect cited evidence for each AC.
2. **Sequence the reads before the acts** so you have a clean baseline: `readDom`/`readAxTree`/`captureWindow` first (AC1–AC3), then the trusted-input delta (AC4).
3. **For AC4, choose a chrome control with a deterministic observable**: the address-bar/omnibox is the easiest focus target (`pressKey 'Tab'` from a known state, or a `click` at its coordinates), confirmed by a `readDom` showing `document.activeElement` moved (the READ_DOM_SNIPPET returns full outerHTML — add a focus probe if needed) or a `readAxTree` focused-node change. Coordinates for chrome controls differ from guest-viewport coords — if a click misses, that IS the divert signal (chrome coordinate-space mismatch), not a flaky test.
4. **Evidence handling**: write screenshots / DOM dumps / a11y JSON to `/tmp/behavior-tests/goldfinch/chrome-drive-spike/<ts>/` (ephemeral, never committed — ARTIFACTS.md Evidence rule). Reference paths in the flight-log verdict.
5. **Resolve-or-divert is the deliverable** — a clean "both axes pass" verdict de-risks every leg-4 migration; a divert with a precise reason + narrowed plan is an equally valid, recorded outcome.

## Edge Cases / Adaptation (flight Divert criteria)
- **Chrome trusted input unreliable** (coordinate space / focus): narrow the leg-4 subset to read-only/observe-driven chrome specs (`settings-shell`-style) and record the act-axis limitation for the engine to fix (chrome coord handling) before any chrome-trusted-input migration. The flight's `tab-keyboard-operability` / `kebab-menu` proofs depend on this axis — if it diverts, they are deferred or the engine is fixed first.
- **`readAxTree` cannot attach on chrome** (`Accessibility.getFullAXTree` errors / returns refusal): migrated specs assert via `readDom` (DOM-shape) instead of the a11y tree; record the limitation. (`readDom` + `captureWindow` are debugger-free, so the observe axis still partially holds.)
- **DevTools-conflict confound is NOT in scope here** (mission Open Question; the `devtools-cdp-conflict` non-CDP affordance is deferred) — do not try to stage a second CDP client.
- **Admin auto-mint didn't fire**: confirm BOTH `GOLDFINCH_AUTOMATION_DEV_MINT=1` and `GOLDFINCH_AUTOMATION_ADMIN=1` are set (the admin key is null without the latter — `mintAdminKey` gates on `GOLDFINCH_AUTOMATION_ADMIN`).

## Files Affected
- `missions/03-automation-surface/flights/06-chrome-dogfood-affordance/flight-log.md` — the recorded verdict (Decisions / Session Notes).
- *(Pass path)* none in `src/`. *(Divert-engine-fix path only)* `src/main/automation/input.js` (chrome coordinate/focus handling) — only if AC4 diverts on a fixable engine gap.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria evaluated (pass or divert-with-reason recorded)
- [ ] Verdict + evidence references recorded in flight-log.md
- [ ] Set this leg's status to `landed` (verdict recorded; batched flight — no per-leg commit)
- [ ] Check off this leg in flight.md (at flight commit)
- [ ] If a divert triggered an engine fix, that change is implemented + unit-tested before leg 4

## Citation Audit
4 source citations verified against current code at leg design time (2026-06-15): `main.js:936-939` (`AUTOMATION_DEV_MINT` stdout mint line), `package.json:12` (`dev:automation` script), `mcp-server.js:mintAdminKey` (`GOLDFINCH_AUTOMATION_ADMIN` gate), `observe.js:readAxTree`/`captureWindow` (the observe ops under test) — all OK. Apparatus note: `scripts/mcp-example-client.mjs` is unauthenticated, so the spike needs a Bearer-carrying client (the F4/F5 run apparatus) — recorded in Inputs.
