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
