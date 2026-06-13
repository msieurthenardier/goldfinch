# Mission: First-Class Browser Automation Surface

**Status**: active

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
(never bound beyond the loopback interface), **off by default / opt-in**, **key-gated** (per-jar keys
for the web surface plus an env-gated admin key for the app/chrome surface, managed in the Settings
area), and **auditable** (the operator can see and review automation activity). The privacy thesis is upheld: this is *automation you can trust* — powerful for the
operator, unreachable by the open web or a remote attacker.

## Context

**Project framing — what Goldfinch is becoming.** Goldfinch began as a privacy-minded browser with one
standout feature: an expandable media panel that catalogs every image, video, audio file, and embed on
a page so the operator can preview, play, or download each independently. That's still the README's
description, but it now undersells the project. Across Mission 01 (Electron/security hardening),
Mission 02 (the settings + tab-control surface), and this mission, Goldfinch has grown a sharper
thesis: **a browser for a world where software agents are first-class users alongside people.** Three
pillars define it — **control** (the operator decides what the browser and the pages it loads are
allowed to do), **privacy** (isolation by default — container jars, per-jar fingerprint personas,
Shields — so neither the open web nor a remote attacker gets more than the operator grants), and
**automatability** (a first-class surface an agent can drive). This mission delivers the third pillar
*without spending* the first two: automation you can hand to an agent precisely because it is gated,
jar-scoped, and auditable. The README description is now the floor, not the ceiling — it gets
refreshed to match this thesis as a **Flight 8** deliverable, once the full surface exists to describe.

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
  render widget — `capturePage()` returns blank and `sendInputEvent` is unreliable. The operator
  requirement (2026-06-13) is **concurrent human + agent use**: an agent must drive/capture tabs **in
  the background** while a human keeps their own foreground tab — so "agent-active" is decoupled from
  "foreground," and agent tabs must be kept **rendered-but-not-in-front** (offscreen-positioning the
  webview, or hosting agent tabs in per-tab hidden windows — OSR does not apply to `<webview>`).
  Bring-to-front / send-to-back become explicit agent operations. **How to keep a background webview
  live (input + capture) is the chief Flight-1 design unknown — resolved by a gating spike.**
- **The engine must target BOTH the chrome renderer AND guest webviews from day one** — dogfooding
  the chrome's own behavior tests (`tab-keyboard-operability`, `unified-tab-controls`,
  `responsive-tab-strip`) drives the chrome; `core-browsing-shields`/`farbling` drive guests. Not an
  either/or.

**Why now / the seed.** This mission grew out of the Mission-02 verify session, where driving
Goldfinch's own behavior tests was painful: the `chrome-devtools` MCP is disqualified (it launches
its *own* browser → false pass), Playwright MCP wasn't reliably connected, and the test had to
hand-roll a raw-CDP-over-WebSocket driver against the dev debugging port. That friction is captured in
`BACKLOG.md` (this mission **supersedes** that seed) and prototyped in `scripts/cdp-driver.mjs`
(attach-don't-launch, trusted `Input.dispatch*` — committed to `main` since Mission 02 Flight 2 and
the apparatus for every behavior-test run since). The committed dev path —
`npm run dev:debug` exposing `--remote-debugging-port=9222 --remote-allow-origins=*` — is the
**cautionary tale**: powerful but completely ungated. This mission delivers the **gated, native,
production-grade replacement** and migrates the tests onto it.

**Reach decision (operator).** The surface is **local-only, period** — it never binds beyond the
loopback interface. Same-machine consumers (Goldfinch's tests, a local Claude Code session) attach
directly; **the-one** (Python / FastAPI / Docker, with a hand-rolled tool registry) reaches a
loopback-only surface via host networking / a socket bridge / a thin local shim on *its* side — the
bridge is the consumer's concern, not a remote bind in Goldfinch.

**Dependency — SATISFIED (2026-06-12).** Key management lives in the **Settings area from Mission
02**; that mission is now **completed** (all SC1–SC9 met, debriefed — see
`../02-settings-and-tab-controls/mission-debrief.md`), so the gate is open. The key-management
flight plugs into the landed settings surface (durable schema-versioned `settings-store.js`,
origin-checked internal bridge, settings page).

**Carried-in prerequisites (Mission-02 debrief → this planning):**
- **Internal-session exclusion (hard security rule).** Any automation enumeration or
  `webContents.debugger` attach MUST skip webContents whose session is the internal one
  (`session.__goldfinchInternal === true`) — a debugger on the `goldfinch://settings` guest is a
  privilege escalation into the privileged bridge. Gate on the session marker (main-process
  state), never partition-string matching.
- **Session-type registry before a third session category.** The `creatingInternalSession`
  one-shot flag + informal `__goldfinchInternal` marker don't scale to dynamically-created
  automation sessions; establish a registry (e.g. `WeakMap<Session, type>`) when this mission
  introduces its session category. Hidden/automation-driven tabs are **web** sessions (Shields
  applied) — never `goldfinch-internal`.
- **The settings store is the only config home.** The API key + opt-in toggle live in
  `settings-store.js` (`DEFAULTS`/`VALIDATORS`/`NORMALIZERS`; the pluggable codec seam is the
  path to `safeStorage` encryption for the key) — no parallel config file. Status changes
  (automation active, session count) fan out via `broadcastToChromeAndInternal`.
- **Any `goldfinch://automation` page follows the three-surface growth rule** (`INTERNAL_PAGES` +
  `isInternalPageUrl` + the `will-navigate` internal allowlist grow together) and enters only via
  the trusted `createTab(..., { trusted: true })` path.
- **Behavior-test mode (operator decision, M02 debrief):** FD-driven runs with cited machine-read
  evidence are the accepted standard; the two-agent Witnessed pattern remains available for
  high-stakes/first-run specs at the operator's election. SC-level "behavior-test-backed" claims
  in this mission inherit that standard.

**Authorization model — per-jar keys + an env-gated admin key (operator decision, 2026-06-13).**
Automation is keyed to **jars** (the existing container identities in `src/main/jars.js` — each an
isolated session partition with its own cookies, storage, and fingerprint persona). Two tiers:
- **Jar key (web surface).** Authorizes driving *web content within one jar only*: navigate, trusted
  input, DOM/a11y read, screenshot of web content, and managing that jar's tabs — enumeration and
  actions are **filtered to that jar's partition**, so a jar session cannot see or touch other jars'
  tabs. The internal-session exclusion stays **absolute** for jar keys. External consumers (the-one,
  external Claude Code) receive **jar keys only**, so each automation caller runs as its own isolated
  browser identity and structurally cannot reach the chrome or settings. This is the jar model doing
  what it was built for.
- **Admin key (app/chrome surface).** The single, deliberate, **authorized relaxation** of the
  internal-session exclusion: it can drive the chrome renderer (toolbar / tab strip / menus), operate
  settings controls, and `capturePage()` the whole window (chrome + composited guests) — the
  capabilities that dogfooding the *chrome's own* behavior specs need. It is **never issued to an
  external consumer** (policy) and is **hard-gated behind an environment variable**: the admin tier
  does not appear in the UI at all unless that env var is set. A normal interactive/shipped build
  cannot expose it; dogfooding, dev, and future *sandboxed agent-everything* deployments (no human at
  the browser) set the env var deliberately. Even when shown it stays off-by-default, key-gated, and
  audited. Least-privilege within admin: prefer `capturePage()` (no debugger) for the whole-window
  shot and trusted input + `executeJavaScript` for settings controls; reserve the
  CDP-debugger-on-internal attach for the **a11y-tree read** (no pure-JS path) — the single
  most-guarded capability.

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
  non-loopback connection attempt cannot reach it; the open web cannot reach it either — which
  requires **Origin/Host allow-listing in addition to the loopback bind** (a `127.0.0.1` server is
  reachable from a page via DNS-rebinding, and *this very browser* renders the hostile pages)
  (*behavior-test-backed / security*).
- [ ] **SC8** — The surface is **off by default and opt-in**, and **requires a valid key** — a request
  with a missing or wrong key is rejected; a valid key is accepted. Keys are **per jar** (each
  authorizes its own jar's web surface only); an **env-gated admin key** (invisible in the UI unless
  the gating env var is set) authorizes the app/chrome surface and is never issued to external
  consumers (*behavior-test-backed / security*).
- [ ] **SC9** — Keys are **managed from the Settings area** (generate / rotate / revoke), persisted,
  and changes take effect immediately: a **per-jar key** is issued/rotated/revoked from the existing
  jars surface, and the **admin key** from its env-gated control. Key storage routes through the
  settings store's encrypted codec seam (the `safeStorage` path), not a parallel plaintext file
  (*behavior-test-backed; depends on Mission 02*).
- [ ] **SC10** — Automation activity is **auditable**: while a client is attached, the operator can
  see that a session is active (a visible indicator that **distinguishes an admin session from a jar
  session and names the jar**) and review what it did (an action log)
  (*behavior-test-backed / manual*).
- [ ] **SC11** — Goldfinch's **own behavior tests run against this surface** (dogfooding), and the
  dev-only ungated debugging path is **retired or hardened** so it is no longer the verification
  apparatus. This means migrating **all behavior specs (11 at Mission-02 close)**, rewriting the **`scripts/a11y-audit.mjs`**
  gate onto the new surface, and updating/removing **`.mcp.json`** (the Playwright-MCP-at-`:9222`
  registration) and `npm run dev:debug`'s `--remote-allow-origins=*` — not just the `.md` specs
  (*verified by the full test + a11y suite running green on the new surface*).

> **Verification apparatus (interim).** SC1–SC4 are marked *behavior-test-backed*, but the apparatus
> that backs them — an MCP client over the loopback transport — does not exist until Flight 3. Until
> then Flights 1–2 are verified by **unit tests** (plus the existing `cdp-driver` harness where it
> still applies); the behavior-test backing for SC1–SC4 is **deferred until after Flight 3 attaches**
> and is established as part of the Flight 6 spec migration. "Behavior-test-backed" here means *will
> be*, once the surface it tests exists — not before.

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
  pre-decided, but the project's zero-dep identity is a real input; resolved by an explicit operator
  **go/no-go at Flight 3** (choosing the SDK breaks zero-dep — an identity-level call, not the
  implementer's).
- **Loopback bind is necessary but not sufficient** — the transport must also **allow-list
  Origin/Host** to defeat DNS-rebinding from pages this browser itself renders (see SC7).
- **Two-tier, jar-scoped authorization** — automation is keyed per jar (web surface, scoped to the
  jar's partition) plus a single **env-gated admin key** (app/chrome surface, never issued
  externally). The internal-session exclusion stays absolute for jar keys; the admin key is its sole
  authorized relaxation. (See the authorization-model note in Context.)
- **Depends on Mission 02's settings area** for key management — specifically M02's persisted
  settings store + get/set IPC + internal-page bridge (M02 Flights 4–5). **Satisfied** (M02 completed
  2026-06-12).
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
- **MCP impl**: hand-roll vs official SDK — spike early; weigh against zero-dep identity. **Decided by
  an explicit operator go/no-go at Flight 3** (identity-level: the SDK would be Goldfinch's first
  runtime dependency).
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
- **Key model** — **RESOLVED (2026-06-13):** **per-jar keys** (web surface, scoped to the jar's
  partition) **+ an env-gated admin key** (app/chrome surface, never issued externally). Open
  sub-detail: exact storage home (settings-store keyed by jarId vs a key field on the jar record) —
  either way through the encrypted `safeStorage` codec seam, no plaintext file; confirm at Flight 5.
- **CDP single-client-per-contents conflict**: `webContents.debugger` allows one client per contents,
  so an a11y/CDP read conflicts with **DevTools open on the same tab** (a live hazard while
  dogfooding) and with a second automation client. Resolution stance (detach-on-demand /
  single-client lock / clear refusal) — confirm at Flight 2.

## Known Issues

_None yet — populated as flights surface blockers._

## Flights

> **Note:** Tentative suggestions, not commitments. Flights are planned and created one at a time as
> work progresses, and will evolve with discoveries. *(The "after Mission 02 lands" gate is
> satisfied — Mission 02 completed 2026-06-12.)*

_(~9 flights — this is the largest mission yet; flights are created one at a time and may merge/split
as work reveals.)_

> **Accepted interim risk (operator, 2026-06-13).** Flight 3 stands up the local server *before*
> Flight 4 adds the opt-in/key/audit gate, so there is a window where an ungated loopback automation
> surface exists. Accepted because **nothing ships until Flight 4 lands** — the ungated server never
> reaches a release. Recorded here so the window is a decision, not an oversight.

- [ ] **Flight 1: Drive engine (input / nav / tabs) + background-tab strategy** — native, tab-targeted
  module: trusted input (`sendInputEvent`), navigation (**re-applying `isSafeTabUrl`**), and tab
  open/close/enumerate/**bring-to-front/send-to-back**; targets **both** the chrome renderer and guest
  webviews. **Owns the background-live render strategy** (keep a webview driveable while not in front,
  decoupling agent-active from foreground) via a **gating spike** — Flight 1 is the first to need it;
  Flight 2 reuses it for capture. (SC1, SC2, SC5)
- [ ] **Flight 2: Observe engine (screenshot / DOM / a11y)** — `capturePage`, DOM read, and the
  **accessibility tree via in-process `webContents.debugger`**; **reuses Flight 1's background-live
  strategy** so background tabs can be captured without foregrounding. (SC3, SC4)
- [ ] **Flight 3: MCP-compatible local server + transport** — expose drive+observe as MCP-discoverable
  tools over a **loopback** transport (Streamable-HTTP/SSE or a thin shim — stdio can't attach to a
  running app), with **Origin/Host allow-listing** from the start; **operator go/no-go on hand-roll vs
  MCP SDK** (identity-level — the SDK is the first runtime dep), then commit; ship an example client +
  consumer docs. (SC6, SC7)
- [ ] **Flight 4: Gating — opt-in + key auth + audit** — off-by-default toggle; **per-jar key
  validation + the env-gated admin tier**; hard refusal of any non-loopback path and any disallowed
  Origin/Host; a visible "automation active" indicator (**distinguishing admin vs jar sessions**) + an
  action/audit log. (SC7, SC8, SC10)
- [ ] **Flight 5: Settings key management** — generate / rotate / revoke **per-jar keys from the jars
  surface** plus the **env-gated admin key**, persisted via the encrypted `safeStorage` codec seam +
  effective immediately (plugs into Mission 02's settings store/IPC/internal-page bridge). (SC9)
- [ ] **Flight 6: Migrate behavior specs onto the surface** — move all behavior specs (11 at
  Mission-02 close) to drive via the new surface (dogfooding). (SC11, part 1)
- [ ] **Flight 7: Rewrite the a11y gate + retire the ungated path** — rewrite `scripts/a11y-audit.mjs`
  onto the new surface; retire/harden `npm run dev:debug`'s `--remote-allow-origins=*` and
  update/remove `.mcp.json` so the ungated `:9222` path is no longer the apparatus. (SC11, part 2)
- [ ] **Flight 8: External-consumer enablement (incl. the-one) + README reframe** — finalize the
  integration contract + docs + an end-to-end drive from an external process; coordinate the
  the-one-side wiring (tracked in the-one's repo; effectively Linux-host-networking / shim per the
  reach constraint); and **refresh the README** from the media-panel description to the
  control / privacy / automatability framing now that the automatability pillar exists to describe.
  (use cases 2 & 3)
- [ ] **Flight 9: Alignment / agent-ergonomics tuning** *(optional)* — interactive vibe session with a
  real agent driving, to tune element addressing, latency feel, and the MCP tool shapes.
