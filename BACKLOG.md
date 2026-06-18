# Backlog

Future ideas not yet promoted to missions. Capturing the thought while it's fresh; not a
commitment, not a current mission. Promote to a `missions/NN-<slug>/mission.md` via `/mission`
when ready.

---

## First-class trusted automation surface (built-in, gated automation/MCP endpoint)

**Status:** idea / future mission seed — **NOT** in scope for mission 02 (settings & tab-bar).
**Captured:** 2026-06-07, during the Flight-01 verify-integration session.

### The thesis
Goldfinch should ship a **first-class, trusted browser-automation surface** — an endpoint an AI
agent (or test harness) can attach to and drive reliably: trusted input, DOM **+ accessibility-tree**
queries, screenshots, stable element addressing. Think a **built-in MCP server you can toggle on**
(or unlock with a key/token), so both:
1. **Goldfinch's own Witnessed behavior tests** get a clean apparatus, and
2. **external agentic platforms** get a robust, honest browser to drive.

### Why (the evidence)
This came directly out of running Flight-01's behavior tests. The off-the-shelf options were
both bad:
- The **`chrome-devtools` MCP is disqualified** — it launches its *own* browser, so it never sees
  Goldfinch's chrome (false pass; the spec calls it "the standing Goldfinch trap").
- **Playwright MCP** wasn't connected and is launch-oriented / brittle.
- So the test had to **hand-roll a raw-CDP-over-WebSocket CLI** (`/tmp/cdp.mjs` — trusted
  `Input.dispatch*`, eval, screenshot, attach-don't-launch) to drive the running app honestly.

That hand-rolled harness is the proof-of-need. The state of "drive a real browser as an agent" is
poor, and a browser that exposed a *blessed, trustworthy* automation surface would be genuinely
differentiated — most browsers treat automation as a low-level bolt-on (raw CDP) or a clunky
add-on (WebDriver).

### Where it fits the project's identity
It's the same throughline as media-visibility and privacy/tracker-visibility: **full visibility
into, and control over, what the page does and what the browser can do — for the human _and_ the
agent.** Mainstream browsers withhold all three. A virtuous loop, too: Goldfinch is built *with* a
behavior-test methodology that needs to drive a browser — if Goldfinch becomes the best browser to
run those tests in, the tool and the method co-evolve and we dogfood daily.

### Hard constraint (must be designed in, not bolted on)
An automation surface inside a **privacy** browser is a juicy attack surface. The cautionary tale
already lives in the repo: `dev:debug` shipped `--remote-debugging-port=9222 --remote-allow-origins=*`
— fine in dev, catastrophic in prod. **(Update, F7 `harden-ungated-path`:** the wide-open `*` is
**fixed** — `dev:debug` now uses `--remote-allow-origins=http://127.0.0.1:9222`, a loopback-Origin
allow-list, probe-confirmed to still admit the no-Origin Node clients while rejecting foreign web
origins. The **final `:9222` removal** + the in-page `evaluate` MCP tool remain the **F8-eval**
tracking item, since `a11y-audit.mjs` + `farbling-correctness` still need the port.**)** For this to *strengthen* the privacy thesis rather than betray
it, the surface must be **local-only, opt-in, per-session consented, key/token-gated, and
auditable**. "Automation you can actually trust" is then the pitch, not a contradiction. This reuses
the project's existing security discipline (the two-point hostile-URL boundary; the internal-scheme
caution in mission 02).

### Scope notes for when this becomes a mission
- Lead with **the surface** (an agent-drivable endpoint), not an in-browser agent — concrete, has a
  forcing function (our own tests), and is the underserved category.
- An **a11y-tree-native** automation API may beat raw CDP for agents (this session leaned on the
  a11y tree + trusted input). Worth evaluating vs. just embedding/serving CDP.
- Decide the shape: embedded MCP server vs. a higher-level semantic API vs. a gated CDP passthrough.
- Define the gating/consent model first (it's the hardest and most identity-defining part).

---

## Migrate tab rendering: `<webview>` → `WebContentsView`

**Status:** strategic future-mission seed — **likely the next mission** (operator, 2026-06-18).
**Captured:** 2026-06-18, during Mission 04 (browser conveniences) planning.

### The thesis
Goldfinch renders every tab as a `<webview>` guest embedded in the **renderer DOM**. Electron has
discouraged `<webview>` for years in favor of **`WebContentsView` + `BaseWindow`**, where each tab
is a **native view the main process positions** in the window — the same model Chrome uses with its
Views tree. Migrating aligns Goldfinch with the supported architecture and unlocks capabilities
`<webview>` structurally cannot provide.

### Why (the evidence — it has bitten twice)
1. **Extensions (M03 planning).** Chrome-extension support in Electron is weakest for `<webview>`
   guests — content-script injection and several `chrome.*` APIs have gaps with the tag. (Tier 3
   future mission.)
2. **Docked DevTools (M04 planning).** DevTools **cannot be docked into Goldfinch's own window**
   with `<webview>`: the guest lives in the renderer DOM, not a native view, so there is no host
   region for the DevTools front-end. M04 ships DevTools as a **native detached/docked window** as a
   result (see M04 `SC5`); integrated, in-window docked DevTools would come essentially "for free"
   post-migration via `setDevToolsWebContents` into a composed view.

The difference is exactly Chrome's mechanism: the embedder that **owns the native view tree** can
lay out the page contents and the DevTools front-end side-by-side in one window. `<webview>` puts the
page in the DOM (great for CSS-driven chrome) but gives up that native-view control.

### What it unlocks
- **Docked, in-window DevTools** (`contents.setDevToolsWebContents(...)` into a composed view).
- **Stronger extension support** (the M03 backlog seed depends on this).
- **Native-view layering** — the likely clean fix for the "native context menus feel clumsy" cousin
  problem (M02 Known Issue) and for side-panel composition (#27's class of animation/layout issues
  become view geometry the main process owns, not CSS `width`/reflow).
- Better performance and per-tab isolation; the supported, non-legacy path.

### The cost (why it's a mission, not a flight)
A cross-cutting rewrite of the renderer/main boundary: each tab becomes a main-process-positioned
native rectangle, not a DOM element; the chrome (toolbar/tabs) becomes its own view; the
**Media/Shields slide-out panels** that overlay the webview via CSS must be re-architected as view
geometry (z-order, rounded corners, the #27 animations — all main-process layout). Touches tab
lifecycle, frameless window geometry, the privacy/media panels, and preload injection. The
**automation engine mostly survives** — it addresses `webContents` by id, which `WebContentsView`
also has.

### Relationship to other planned work
- **Independent of the jars-lifecycle mission** (jars are *sessions*, not *rendering*) — either can
  go first.
- Doing this **before** more chrome/panel features avoids building twice on the legacy substrate.

### Scope notes for when this becomes a mission
- **Spike first**: stand up the `WebContentsView` + `BaseWindow` tab model on Electron `^42` and
  validate the frameless window + draggable region + panel-overlay story is achievable as native
  views before committing.
- Preserve the automation surface's `webContents`-by-id addressing; verify the M03 engine + the
  behavior-test apparatus survive.
- Re-home the Media / Shields / (new DevTools) panels as composed views; revisit #27 there.
- Confirm preload injection (`webview-preload`, the media scanner via `sendToHost`) ports to the
  view model.
