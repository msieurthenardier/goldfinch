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

### Why (the evidence — it has bitten three times)
1. **Extensions (M03 planning).** Chrome-extension support in Electron is weakest for `<webview>`
   guests — content-script injection and several `chrome.*` APIs have gaps with the tag. (Tier 3
   future mission.)
2. **Docked DevTools (M04 planning).** DevTools **cannot be docked into Goldfinch's own window**
   with `<webview>`: the guest lives in the renderer DOM, not a native view, so there is no host
   region for the DevTools front-end. M04 ships DevTools as a **native detached/docked window** as a
   result (see M04 `SC5`); integrated, in-window docked DevTools would come essentially "for free"
   post-migration via `setDevToolsWebContents` into a composed view.
3. **Find-in-page event delivery (M04 Flight 2 — Deviation D1).** Chromium delivers the
   `found-in-page` event **only to the renderer-side `<webview>` DOM element, never to the
   corresponding main-process `webContents`** for guests. The automation `findInPage` op therefore
   could not observe its own find result main-side and had to be rebuilt to route through the chrome
   renderer via `chromeContents.executeJavaScript` on the tag — a working but indirect path, plus a
   WSLg cold-start retry workaround (see M04 Flight-2 debrief / Known Issue). With `WebContentsView`,
   each tab is a real main-process `webContents` the embedder owns, so `webContents.on('found-in-page')`
   would fire directly — no renderer round-trip, and the cold-start workaround likely disappears. Same
   class of constraint as docked DevTools: the renderer-DOM guest hides behavior the main process
   should own. (Generalize: any `<webview>`-guest DOM event the automation surface needs to observe —
   selection, paint-timing, future media events — hits this same wall today.)

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

---

## Persistent storage substrate: JSON stores → SQLite

**Status:** strategic future-mission seed (operator, 2026-06-20).
**Captured:** 2026-06-20, during Mission 04 Flight 5 (downloads surface) planning.

### The thesis
Goldfinch persists structured state as **schema-versioned JSON files** under `userData`
(`settings-store.js`, and — added in M04 Flight 5 — `downloads-store.js`). JSON is fine for
**low-cardinality** state (settings; download history, which M04 Flight 5 caps at 500 entries), but
the **browsing-history** capability the operator wants next is **high-cardinality** (thousands to tens
of thousands of rows) with **prefix search** for the address bar — a workload JSON cannot serve
(whole-file parse on load, no index, linear scan). Move Goldfinch's persistent storage to a single
**SQLite** substrate (e.g. `better-sqlite3` or Node's built-in `node:sqlite` on a current runtime),
shared by downloads, browsing history, and any future history-class store.

### Why (the evidence)
1. **Browsing history needs an index (the trigger).** The deferred browsing-history / jars-lifecycle
   mission needs fast prefix lookup and bounded memory — the canonical SQLite use case. Building it on
   JSON would be a known dead end.
2. **Downloads is already shaped for the swap (M04 Flight 5).** Flight 5 deliberately put the JSON
   downloads store **behind a narrow repository interface** (`list`/`append`/`remove`/`clear`, DD3/DD9)
   so the SQLite migration is a one-module change, not a `main.js` excavation. That interface is the
   template for re-homing `settings-store.js` too.
3. **Crash-survivable in-progress downloads.** M04 Flight 5's JSON model persists **terminal records
   only** (in-progress is memory-only, lost on a crash). SQLite with transactional writes can persist
   in-progress safely and reconcile dead `progressing` rows on load — the "proper" version of the gap
   Flight 5 accepted.

### The zero-dep tension
Goldfinch holds a **zero-runtime-dependency identity** (weighed in M03's MCP-SDK decision). SQLite is
the most defensible exception to date — but the mission must make the call explicitly: **Node's
built-in `node:sqlite`** vs. a vendored native module (`better-sqlite3`). A go/no-go like M03's, not an
assumed yes. **The zero-dep path is open today**: Electron `^42` bundles Node ≥ 22.12, where
`node:sqlite` is available — so the decision is not gated on a runtime upgrade.

### Scope notes for when this becomes a mission
- **Likely sequenced with / just before the browsing-history mission** — history is the workload that
  justifies SQLite; doing storage first avoids building history twice.
- Re-home both `settings-store.js` and `downloads-store.js` onto the SQLite-backed repository
  interface; keep the interface stable so callers don't change.
- Add a one-time **JSON → SQLite migration** on first launch (read the existing JSON, import, retire
  the file) so existing users keep their settings + download history.
- Decide the dependency posture (`node:sqlite` vs vendored) up front (the zero-dep go/no-go).
- Add crash-survivable in-progress downloads once on SQLite (closes the M04 Flight 5 accepted gap).

---

## Tab strip: Chrome-style shrink, no scrollbar (small fix — not a mission)

**Status:** landed in M09 (First-Class Tab Management) Flight 1, Leg 1
(`progressive-shrink-and-middle-click`) — container-query staged shrink, no hard floor,
`overflow: hidden`, and the `responsive-tab-strip` spec evolution all shipped there.

---

## Connection-security transparency: surface post-quantum key exchange (+ trust anchor) in site-info

**Status:** idea / future-mission seed — small, on-brand, mostly leverages inherited Chromium capability.
**Captured:** 2026-07-11, during a threat-model thought-experiment session (OS-level identification →
what a browser *can* honestly defend → encryption longevity).

### The thesis
Add a **connection-security readout** to the 🔒 site-info popup that tells the user, legibly, what
protection is actually in force on the current connection. The headline row is **post-quantum status**:
whether this page's TLS key exchange is **post-quantum-hybrid** (`X25519MLKEM768`) or **classical-only**
(`X25519`). Chromium already negotiates hybrid ML-KEM by default where the server supports it — Goldfinch
implements **no crypto and changes no connection**; the feature just makes the invisible visible. This is
pure transparency over inherited capability, in the same spirit as media-visibility and tracker-visibility.

### Why (the reasoning)
The threat-model walk that produced this landed on a sharp scope boundary: a browser **cannot** defend
the base OS or the transport envelope, and it **cannot** detect a dishonest/colluding endpoint. What it
**can** do well is (a) enforce genuine end-to-end encryption, (b) make interception *detectable*, and
(c) **tell the user honestly what is and isn't protected** on this connection. Most browsers negotiate PQ
key exchange silently and never surface it; drawing the line sharply — "this connection is safe against
harvest-now-decrypt-later, that one isn't" — is itself the feature. The relevant threat PQ addresses is
**harvest-now-decrypt-later** (record ciphertext today, decrypt once a CRQC exists), which is why it
matters even though no quantum computer exists yet.

### What it is / is NOT
- **IS:** a readout. Three states per tab: **post-quantum** (positive), **classical-only** (neutral/muted,
  an honest "not HNDL-protected" signal), **not applicable** (`http://` / internal `goldfinch://`).
- **NOT** a control — Goldfinch can't force PQ; the server decides. **NOT** new crypto. **NOT**
  anonymity/metadata/OS protection — orthogonal to the whole identification thread; it speaks only to
  *content-confidentiality longevity* on honest connections.

### The gating spike (do this first — it decides whether the rest is worth building)
**Data acquisition is the real risk, not the UI.** Electron exposes no clean public API for the negotiated
key-exchange group. The source is **CDP** — `Network.responseReceived → response.securityDetails.keyExchangeGroup`,
or `Security.getVisibleSecurityState`. That collides with two documented constraints:
- The **`cdp.js` single-client lock** — a standing Network/Security-domain attach conflicts with a user
  opening DevTools (the existing `debugger-unavailable` case).
- The project's **prefer-`executeJavaScript`-over-CDP** discipline — and there is **no** main-world JS path
  to the TLS group, so this feature genuinely needs CDP or it doesn't ship.
Spike question (per the "gate any new mechanism on a cheap on-platform spike" rule): can we read
`keyExchangeGroup` cheaply per-navigation (momentary attach on `did-navigate`, read once, detach, cache by
`wcId`) **without** holding an attach that breaks DevTools? Options the spike settles: momentary-attach vs.
accept a DevTools-open blind spot vs. decide the value isn't worth the CDP dependency.

### Scope notes for when this becomes a mission (or small flight)
- The pure/testable core is the **classification** (`keyExchangeGroup` string → {post-quantum | classical |
  none} + label). Home it in `deriveSiteInfo` (`src/shared/site-info.js`, the single derivation source) as a
  new `keyExchange` field; `siteInfoModel(activeTab())` carries it; the sheet's `info-popup` template renders
  the row via `textContent`. Add a dual-export-style unit test for the classifier.
- Data path mirrors existing site-info: main captures the group per-tab keyed by `wcId`, exposes it to the
  renderer.
- **Natural extension** (only if worth more than one row): a small **connection-transparency block** — TLS
  version, cipher, PQ-ness, and the **trust anchor** (which root/CA validated this, surfaced so an
  OS-injected MITM CA becomes *visible rather than silent*). The trust-anchor row is the one that pays off
  the "make interception detectable" half of the thesis; PQ-status is the headline.
- **Keep-current is the real prerequisite:** the inherited PQ benefit only exists if Electron/Chromium stays
  current enough to ship `X25519MLKEM768` and Goldfinch doesn't override/downgrade the TLS config. Worth a
  standing note wherever Electron bumps are decided.

---

## Renderer crash / sleep-resume resilience (chrome + guest views) + crash observability

**Status:** defect-driven flight seed — likely a maintenance-mission flight, not its own mission.
**Captured:** 2026-07-11, from a live incident on the operator's installed (packaged) Windows build.

### The incident (the evidence)

After a sleep/resume, the installed build came back unusable: **tab strip empty, content area flat
dark gray, buttons dead — but CSS hover still working**. Live diagnosis established:

- **Main was healthy** — window drag/resize (main-process message loop) worked; the process tree
  showed the browser process, GPU, utilities, and 9 renderers all alive. Not a main-process hang.
- The fingerprint decodes as **renderer-side death during suspend**: a guest `WebContentsView`
  whose renderer is killed paints as a **solid gray surface** (the view object stays alive —
  `isDestroyed()` stays false — so main keeps it attached); the **chrome** renderer was killed and
  came back as a fresh/broken document — the tab strip is built purely in `renderer.js` memory, so
  a reset chrome document starts blank, and if its boot gate (`renderer.js` bottom:
  `Promise.all([settingsGet('homePage'), jarsBoot]).then(createTab)`) never completes, you get
  exactly "empty strip + dead buttons + live hover" (hover is CSS, needs no JS).
- Chromium killing backgrounded renderers across suspend (memory pressure / GPU reset on resume)
  is a **known, recurring environment hazard**, and this machine has a kernel-level history of
  flaky sleep (an April 2026 `0xA0 INTERNAL_POWER_ERROR` bugcheck in the Event Log).
- **Forensics hit a wall — that's a finding in itself.** A killed *child* renderer writes nothing
  to the Windows Application log, and Goldfinch never starts `crashReporter`, so there is **no
  ground truth anywhere** about which process died or why. Silence in the logs ≠ nothing died.

### The gap

Crash recovery exists **only for the two overlay views** — the find overlay (`main.js` ~291) and
the menu-overlay sheet (`menu-overlay-manager.js` ~154) both have the **AC7 teardown-and-rebuild
`render-process-gone` pattern** (M05 F7/F8). The **chrome view and guest tabs have none**; there
are no `unresponsive` handlers and no `powerMonitor` hooks. A crashed guest silently renders gray
forever; a crashed chrome renderer bricks the whole UI until the user kills the process tree.

### Fix shape (three legs, roughly)

1. **Chrome view `render-process-gone` → reload + reconcile.** Reload the chrome document and
   reconcile main's tab state with the fresh renderer (main still holds the live guest views; the
   fresh chrome knows nothing about them — decide re-announce vs. teardown). **Ordering hazards —
   this is why it wants a spec'd leg, not a drive-by patch:** the pending-init queues, the
   find-overlay session state (`findOverlayTabWcId`), and the sheet's chrome-wcId assumptions all
   assume a stable chrome renderer.
2. **Guest tab `render-process-gone` → visible recovery.** Auto-`reload()` the tab, or notify the
   chrome to render a "tab crashed — reload" affordance, instead of the silent gray surface.
   (Extends the AC7 pattern from overlays to tabs.)
3. **Observability.** `crashReporter.start({ uploadToServer: false })` for local dumps under
   `userData`, plus log `render-process-gone` `details.reason` (`oom` / `killed` / `crashed`) per
   process — so the next incident self-identifies instead of needing live forensics. Optionally
   `powerMonitor.on('resume')` as a cheap post-resume health-check trigger and `unresponsive`
   handlers for symmetry.

### Scope notes

- Recovery must respect the **internal-page trust model**: reloading a crashed internal
  (`goldfinch://`) tab goes through the trusted-nav rules (`isInternalPageUrl`), never a relaxed gate.
- Verification is awkward by nature (killing renderers on purpose): `wc.forcefullyCrashRenderer()`
  is the test lever for both the chrome and guest paths; drive it over the automation surface.
- Cheap first leg candidate: observability (leg 3) alone is small, zero-risk, and converts the
  next field incident into data — worth doing even if 1–2 wait.

---

## Internal pages: flat-served import specifiers are untypeable (TS2307)

**Status:** typing debt — future typing cycle, not urgent.
**Captured:** M07 Flight 2 leg 5 (ESM conversion, FD ruling).

The two internal page controllers (`src/renderer/pages/settings.js`, `pages/jars.js`) import
their shared dependencies via the pages' SERVING paths (`./safe-color.js` etc.) because
`INTERNAL_PAGES` (main.js) is an exact-match flat map — a disk-true `../../shared/*.js`
specifier would 404 at boot. tsc resolves against the disk layout and cannot see the protocol
map, so the six flat imports each carry `// @ts-ignore` and their bindings type as `any`
(matching the ambient-global typing they replaced — no regression). Options for a future cycle:
`paths` mapping in jsconfig for the internal-page directory, or `.d.ts` shims per flat specifier.
Do NOT restructure the protocol map for this — it is trust-sensitive (traversal-proof by design).

---

## Electron major bump: 42 → 43 (post-history maintenance sweep item)

**Status:** small deferred upgrade — routed to the post-mission-08 full-category maintenance
sweep (operator ruling at mission-08 sign-off, 2026-07-12). **Not a mission.**
**Captured:** 2026-07-12, during mission-08 (per-jar browsing history) planning.

At mission-08 sign-off Goldfinch took the in-line **patch bump 42.4.0 → 42.6.1** (Node 24.18,
Chrome 148.0.7778.280; full unit suite + typecheck green). The **major bump to 43.x**
(Chrome 150, same Node 24.18 line) was deliberately deferred: Electron 42 is still in support
(latest three majors), majors can shift renderer/main behavior right after the M05
WebContentsView migration settled, and the next full-category maintenance sweep is already
queued for right after the history mission — the natural home for it.

Notes for that sweep:
- 43.1.0 bundles the same Node line (24.18), so `node:sqlite` posture (mission-08 substrate)
  is unchanged — still experimental; re-check the `ExperimentalWarning` and API surface on
  the new runtime as part of the bump.
- Re-run the behavior-test net after the bump — chrome/guest event timing is the risk class
  a major moves.

---

## Internal-page keyboard focus (guest-view focus on tab activation)

**Status:** follow-up seed — surfaced at Mission 08 Flight 6 HAT (2026-07-13).

Activating an internal `goldfinch://` tab (settings/downloads/jars) raises the
guest `WebContentsView` to the top so mouse input works (`tab-set-active`,
`src/main/main.js:2215`, `addChildView`) but never calls
`webContents.focus()` on it. OS keyboard focus stays on the chrome view, so
pressing Tab inside an internal page jumps to the address bar and cycles the
chrome toolbar rather than traversing the page's own controls — internal
pages are effectively keyboard-inoperable.

Pre-existing and never test-covered (`tab-keyboard-operability` covers the
tab STRIP, not internal page content). The fix (focus the guest on
activation) is cross-cutting: `main.js:2241` already documents that
refocusing a guest can steal focus from tab-strip keyboard nav, and it must
not fight the find-overlay or menu-overlay-sheet focus handoffs. Warrants its
own flight: design the focus-handoff rules, then a behavior test covering
internal-page Tab traversal + the find/sheet/tab-strip interactions.
