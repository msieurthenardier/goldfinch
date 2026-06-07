# Mission: First-Class Browser Automation Surface

**Status**: planning

## Outcome

Goldfinch exposes a **first-class, gated browser-automation surface** — a fast, reliable way for a
trusted **local** client to fully drive the running browser: navigate, deliver **trusted** input
(click / type / scroll / key), read a tab's **DOM and accessibility tree**, **capture screenshots**,
and **manage tabs** — exposed over an **MCP-compatible** interface so any MCP client can discover and
invoke these as tools. It serves three consumers from one surface:

1. **Goldfinch's own behavior-test development** — dogfooding the surface and retiring the dev-only
   debugging-port hack the tests rely on today.
2. **External Claude Code sessions** — attach Goldfinch as an MCP browser to drive it for other apps.
3. **Agentic platforms** (e.g. the home-grown **the-one**) — give their agents a real browser.

The surface is built **natively in the main process** (via `webContents` trusted input, page
capture, and script evaluation) rather than the external Chromium debugging port. It is **local-only**
(never bound beyond the loopback interface), **off by default / opt-in**, **API-key-gated** (the key
managed in the Settings area), and **auditable** (the operator can see and review automation
activity). The privacy thesis is upheld: this is *automation you can trust* — powerful for the
operator, unreachable by the open web or a remote attacker.

## Context

Goldfinch is a privacy-focused Electron (`^42`) / Chromium browser with **zero runtime dependencies**
and a hand-roll-over-frameworks ethos. Each tab is a real `<webview>` with its own `webContents`; the
main process (`src/main/main.js`) already addresses tabs by `webContentsId` (downloads, per-tab
privacy aggregation use `webContents.fromId(id)`), so the primitives for a native automation engine
already exist in-process:
- `webContents.sendInputEvent()` → **trusted** mouse/keyboard input (fires real handlers + native
  focus traversal) — no `--remote-allow-origins=*` needed.
- `webContents.capturePage()` → screenshots.
- `webContents.executeJavaScript()` → DOM reads.
- `webContents.debugger` → **in-process CDP** (`debugger.attach()` + `sendCommand(...)`): the exact
  `Accessibility.getFullAXTree`, `Page.captureScreenshot`, `DOM.*`, and `Input.dispatch*` the current
  behavior tests use over `:9222` — but **in-process, with no port bind and no
  `--remote-allow-origins=*`**, fully gateable. This is the likely mechanism for the rich reads
  (accessibility tree especially — there is no pure-JS path to it). Caveat: one CDP client per
  contents (conflicts with DevTools open on the same tab).
- `loadURL` / navigation / window-open handling / tab lifecycle.

**Two feasibility realities (from the viability review) the flights must design around:**
- **Hidden/background tabs.** Inactive tabs are `display:none`, so a hidden `<webview>` has no live
  render widget — `capturePage()` returns blank and `sendInputEvent` is unreliable. Acting on a
  *specific* (non-active) tab needs an **activate-then-act** strategy (switch visible → act →
  restore) or offscreen rendering. This is the chief Flight-1 design unknown.
- **The engine must target BOTH the chrome renderer AND guest webviews from day one** — dogfooding
  the chrome's own behavior tests (`tab-keyboard-operability`, `unified-tab-controls`,
  `responsive-tab-strip`) drives the chrome; `core-browsing-shields`/`farbling` drive guests. Not an
  either/or.

**Why now / the seed.** This mission grew out of the Mission-02 verify session, where driving
Goldfinch's own behavior tests was painful: the `chrome-devtools` MCP is disqualified (it launches
its *own* browser → false pass), Playwright MCP wasn't reliably connected, and the test had to
hand-roll a raw-CDP-over-WebSocket driver against the dev debugging port. That friction is captured in
`BACKLOG.md` (this mission **supersedes** that seed) and prototyped in `scripts/cdp-driver.mjs`
(attach-don't-launch, trusted `Input.dispatch*` — currently on branch `chore/cdp-driver` / PR #22,
not yet merged to `main`). The committed dev path —
`npm run dev:debug` exposing `--remote-debugging-port=9222 --remote-allow-origins=*` — is the
**cautionary tale**: powerful but completely ungated. This mission delivers the **gated, native,
production-grade replacement** and migrates the tests onto it.

**Reach decision (operator).** The surface is **local-only, period** — it never binds beyond the
loopback interface. Same-machine consumers (Goldfinch's tests, a local Claude Code session) attach
directly; **the-one** (Python / FastAPI / Docker, with a hand-rolled tool registry) reaches a
loopback-only surface via host networking / a socket bridge / a thin local shim on *its* side — the
bridge is the consumer's concern, not a remote bind in Goldfinch.

**Dependency.** Key management lives in the **Settings area from Mission 02**, so this mission is
sequenced **after Mission 02 lands** (`Mission 02 → Mission 03`); its key-management flight plugs into
the existing settings surface.

**MCP implementation is deliberately undecided.** Whether to hand-roll the MCP/JSON-RPC surface (keeps
zero runtime deps; matches the project + the-one ethos) or bundle the official MCP SDK (spec
compliance, but Goldfinch's first runtime dependency) is an **early flight-design spike**, not a
mission-level commitment.

## Success Criteria

- [ ] **SC1** — A trusted local client can **attach** to the running browser and **navigate** a tab
  (open a URL; back / forward / reload), with the result reflected in the live UI
  (*behavior-test-backed*).
- [ ] **SC2** — The client can deliver **trusted input** — click, type, scroll, key — that fires the
  page's real event handlers and native focus traversal (equivalent to a human, not synthetic
  `dispatchEvent`) (*behavior-test-backed*).
- [ ] **SC3** — The client can **read a target tab's state**: its DOM and its accessibility tree
  (*behavior-test-backed*).
- [ ] **SC4** — The client can **capture a screenshot** of a target tab (and the chrome) on demand
  (*behavior-test-backed*).
- [ ] **SC5** — The client can **manage tabs**: open, close, switch, and enumerate them, and direct
  any action at a specific tab (*behavior-test-backed*).
- [ ] **SC6** — The capabilities are exposed over an **MCP-compatible interface**: an external MCP
  client (e.g. a Claude Code session) can **discover and invoke** them as tools and drive the browser
  end to end (*behavior-test-backed*).
- [ ] **SC7** — The surface is **local-only**: it binds only to the loopback interface and a
  non-loopback connection attempt cannot reach it; the open web cannot reach it either
  (*behavior-test-backed / security*).
- [ ] **SC8** — The surface is **off by default and opt-in**, and **requires a valid API key** — a
  request with a missing or wrong key is rejected; a valid key is accepted (*behavior-test-backed /
  security*).
- [ ] **SC9** — The API key is **managed from the Settings area** (generate / rotate / revoke),
  persisted, and changes take effect immediately (*behavior-test-backed; depends on Mission 02*).
- [ ] **SC10** — Automation activity is **auditable**: while a client is attached, the operator can
  see that a session is active (a visible indicator) and review what it did (an action log)
  (*behavior-test-backed / manual*).
- [ ] **SC11** — Goldfinch's **own behavior tests run against this surface** (dogfooding), and the
  dev-only ungated debugging path is **retired or hardened** so it is no longer the verification
  apparatus. This means migrating **all six behavior specs**, rewriting the **`scripts/a11y-audit.mjs`**
  gate onto the new surface, and updating/removing **`.mcp.json`** (the Playwright-MCP-at-`:9222`
  registration) and `npm run dev:debug`'s `--remote-allow-origins=*` — not just the `.md` specs
  (*verified by the full test + a11y suite running green on the new surface*).

> **Non-functional goal (tracked, not a hard SC):** the surface should be **fast and efficient enough
> for interactive agentic use** — low round-trip latency per action so an agent loop feels responsive.
> Verified qualitatively (behavior tests complete without timeout pressure); a hard latency threshold
> can be added at flight design if useful.

## Stakeholders

- **Project owner/maintainer** — primary; wants a first-class, fast, powerful, trustworthy automation
  surface and to stop hand-rolling test apparatus.
- **Downstream agent consumers** (indirect) — external Claude Code sessions and the-one's agents that
  gain a real browser to drive.
- **Security/privacy posture** — as a privacy browser, the gating/consent model is identity-defining;
  the surface must strengthen, not undermine, the privacy thesis.

## Constraints

- **Local-only, never beyond loopback** (hard). No non-loopback bind, ever.
- **Off by default, opt-in, API-key-gated, auditable.** The surface does nothing until the operator
  turns it on and a client presents a valid key.
- **Native main-process implementation** via `webContents` (`sendInputEvent` / `capturePage` /
  `executeJavaScript` / navigation), **not** the external `--remote-debugging-port` /
  `--remote-allow-origins=*` path — which this mission retires or hardens.
- **Do not become a security-boundary bypass.** Preserve the existing two-point hostile-URL boundary
  (`isSafeTabUrl` on `createTab` + `will-navigate`); a hostile page must not reach, trigger, or
  impersonate the automation surface. **Concretely:** a main-process `loadURL()` bypasses *both*
  existing gates (the renderer `createTab` gate and `will-navigate`, which only fires for
  renderer-initiated nav), so the engine's `navigate`/`open-tab` entry points must **re-apply
  `isSafeTabUrl` themselves**.
- **Weigh the zero-runtime-dependency stance** in the MCP-impl spike (hand-roll vs SDK) — not
  pre-decided, but the project's zero-dep identity is a real input.
- **Depends on Mission 02's settings area** for key management — specifically M02's persisted
  settings store + get/set IPC + internal-page bridge (M02 Flights 4–5), not merely "after M02."
  Sequenced after those land.
- **Performance**: low-latency enough for interactive agent use.

## Environment Requirements

- Electron `^42`, Node 22 in the main process; WSLg/Linux dev + a GUI display for live verification.
- An **MCP client** for verification — a local Claude Code session, or a small hand-rolled MCP client
  over the local transport (the committed `scripts/cdp-driver.mjs` / `scripts/a11y-audit.mjs`
  attach-don't-launch pattern is the precedent).
- **the-one** (Python / FastAPI / Docker) as an integration consumer — attaches via host
  networking / a local bridge (its own side); not a remote bind in Goldfinch.
- Behavior-test apparatus: the new surface itself, once it exists (dogfooding).

## Open Questions

- **Transport**: must be **attach-to-already-running** (the server lives inside the live Electron app
  that holds the operator's tabs), so standard MCP **stdio doesn't fit** (it assumes the client
  launches the server). Likely **Streamable-HTTP/SSE over loopback**, or a custom loopback socket
  fronted by a thin MCP shim — confirm at Flight 2.
- **MCP impl**: hand-roll vs official SDK — spike early; weigh against zero-dep identity.
- **Hidden-tab strategy** (the chief Flight-1 unknown): activate-then-act (switch visible → act →
  restore) vs offscreen rendering vs force-paint, so `capturePage`/`sendInputEvent` work on a
  *non-active* target tab.
- **Rich-read mechanism**: in-process `webContents.debugger` → `Accessibility.getFullAXTree` /
  `Page.captureScreenshot` / `DOM.*` (reuses the exact tree the current tests assert, no port —
  recommended) vs a DOM-computed/axe-style approximation.
- **how the-one (Docker) reaches a loopback-only surface** — a 127.0.0.1-only bind is genuinely
  unreachable from a bridged container, and `host.docker.internal` does **not** reach host loopback;
  only Linux `--network host` shares it (Docker Desktop on macOS/Windows does not). So the-one
  integration is effectively **Linux-host-networking-only** (or via a thin local shim) — confirm
  against its deployment at Flight 6.
- **Element addressing for agents**: accessibility-tree-native handles vs CSS selectors vs raw
  coordinates — design for agent ergonomics (the a11y-tree-first instinct from prior behavior tests).
- **Audit/consent UX**: connect-time consent prompt vs a settings toggle + a live "automation active"
  indicator + an action log; how much is shown.
- **Key model**: a single operator key vs per-client keys with scopes; rotation/revocation semantics.

## Known Issues

_None yet — populated as flights surface blockers._

## Flights

> **Note:** Tentative suggestions, not commitments. Flights are planned and created one at a time as
> work progresses, and will evolve with discoveries. Runs **after Mission 02 lands**.

_(~8 flights — this is the largest mission yet; flights are created one at a time and may merge/split
as work reveals.)_

- [ ] **Flight 1: Drive engine (input / nav / tabs)** — native, tab-targeted module: trusted input
  (`sendInputEvent`), navigation (**re-applying `isSafeTabUrl`**), and tab open/close/switch/enumerate;
  targets **both** the chrome renderer and guest webviews. (SC1, SC2, SC5)
- [ ] **Flight 2: Observe engine (screenshot / DOM / a11y) + hidden-tab strategy** — `capturePage`,
  DOM read, and the **accessibility tree via in-process `webContents.debugger`**; resolve the
  **activate-then-act visibility strategy** so non-active tabs can be captured/driven. (SC3, SC4)
- [ ] **Flight 3: MCP-compatible local server + transport** — expose drive+observe as MCP-discoverable
  tools over a **loopback** transport (Streamable-HTTP/SSE or a thin shim — stdio can't attach to a
  running app); **spike hand-roll vs MCP SDK** and commit; ship an example client + consumer docs.
  (SC6, SC7)
- [ ] **Flight 4: Gating — opt-in + key auth + audit** — off-by-default toggle; API-key validation;
  hard refusal of any non-loopback path; a visible "automation active" indicator + an action/audit
  log. (SC7, SC8, SC10)
- [ ] **Flight 5: Settings key management** — generate / rotate / revoke the API key from the Settings
  area, persisted + effective immediately (plugs into Mission 02's settings store/IPC/internal-page
  bridge). (SC9)
- [ ] **Flight 6: Migrate behavior specs onto the surface** — move all six behavior specs to drive via
  the new surface (dogfooding). (SC11, part 1)
- [ ] **Flight 7: Rewrite the a11y gate + retire the ungated path** — rewrite `scripts/a11y-audit.mjs`
  onto the new surface; retire/harden `npm run dev:debug`'s `--remote-allow-origins=*` and
  update/remove `.mcp.json` so the ungated `:9222` path is no longer the apparatus. (SC11, part 2)
- [ ] **Flight 8: External-consumer enablement (incl. the-one)** — finalize the integration contract +
  docs + an end-to-end drive from an external process; coordinate the the-one-side wiring (tracked in
  the-one's repo; effectively Linux-host-networking / shim per the reach constraint). (use cases 2 & 3)
- [ ] **Flight 9: Alignment / agent-ergonomics tuning** *(optional)* — interactive vibe session with a
  real agent driving, to tune element addressing, latency feel, and the MCP tool shapes.
