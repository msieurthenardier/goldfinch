# Mission: WebContentsView Migration

**Status**: active

## Outcome

Goldfinch renders guest web pages as native main-process **views** (`WebContentsView` on a
`BaseWindow`) instead of renderer-embedded `<webview>` tags — at full behavior parity with today's
browser. The migration removes the architectural constraint behind five recurring "DOM-correct ≠
render-correct" failures, so that the surface a user (or an agent) sees is governed by main-process
view geometry rather than CSS layout around an out-of-process compositing surface. Nothing the
browser does today regresses; the privacy model, the container/jar model, the conveniences, and the
full automation (MCP) surface all keep working, proven against the accumulated behavior-test corpus.

## Context

Across Missions 03 and 04, the Electron `<webview>` native-surface boundary surfaced **five times** as
feature-shaped bugs that share one root cause — the guest is an out-of-process native compositing
surface the renderer cannot truly position or observe:

1. find-in-page `{0,0}` cold-start mis-position,
2. `found-in-page` not delivered to the main-process guest `webContents` (Flight-2 Deviation D1),
3. docked DevTools impossible (guest has no native host region),
4. context-menu coordinate double-counting,
5. the **#27 / SC10 side-panel animation**, reverted at HAT in Flight 6 after three CSS mechanisms
   failed identically.

The Mission 04 debrief named this the convergence point of those data points and flagged the
`WebContentsView` + `BaseWindow` migration as the strong candidate next mission: it is the *single*
structural change that unblocks docked DevTools, find-directness, panel-over-guest compositing
(#27/SC10), and stronger future extensions. Critically, the automation engine already addresses guest
pages **by `webContents` id** through an injected-dependency seam (`src/main/main.js`), so the agent
surface largely survives the migration — making this a high-leverage, lower-than-it-looks-risk move,
*provided* the one genuine unknown (compositing a panel overlay as a native view) is de-risked first.

This mission is deliberately scoped to **parity, not new features**. The rewards above are pursued only
where they fall out of the new architecture essentially for free (see SC7); otherwise they are
follow-on work.

## Success Criteria

- [ ] **SC1 — Native guest surface.** Web tabs and internal `goldfinch://` pages render via
  `WebContentsView` on a `BaseWindow`; no `<webview>` tag remains in the tab/guest path. *(Verified:
  source absence + app launches and browses.)*
- [x] **SC2 — Spike-gated commitment, verified on pixels.** ✅ MET (Flight 1, 2026-06-23/24): all six
  probes passed on pixels/assertion; clean **GO** recorded. Before any migration leg is built, a spike
  validates frameless + drag-region + **panel-overlay-as-native-view** on the target Electron, and
  re-verifies the migration-fragile renderer-consumed events (esp. `found-in-page`). Because this stack's
  documented failure mode is "DOM-correct ≠ render-correct" (`CLAUDE.md`), the spike's acceptance signal
  is the **rendered surface observed** (`captureWindow` / visual HAT), not a DOM-geometry read — a
  geometry-only check is necessary-but-insufficient and a false-confidence trap. A clean spike authorizes
  the cutover; a non-clean spike pauses for an operator options-review (not auto-abort). *(Verified: spike
  artifact with pixel evidence + recorded go/review decision.)*
- [ ] **SC3 — Browser-behavior parity.** The chrome behaves as it does today — multi-tab browsing,
  back/forward/reload, address bar, persistent sessions, favicons, popups-as-tabs, tab-strip keyboard
  operability — confirmed by the existing active browsing/tab behavior tests passing on the new
  surface. *(Verified: behavior-test corpus.)*
- [ ] **SC4 — Conveniences parity (with event-seam re-architecture).** Zoom, print/Save-as-PDF,
  find-in-page, DevTools, page context menu, spellcheck, and the downloads surface all keep working on the
  native guest surface. Note this is **parity by re-architecture, not by survival** for any feature that
  rode a renderer↔`<webview>`-element seam: `find.js`'s renderer-routed `found-in-page` workaround
  (Deviation D1) and the renderer's `found-in-page`/media-rescan/privacy-stream listeners all depend on a
  `<webview>` DOM element that ceases to exist, and must be re-homed to the main-process `webContents`
  (the upside: the ~130-line find workaround can likely be *deleted*). *(Verified: per-feature behavior
  tests; find-in-page event delivery re-verified on the new surface.)*
- [ ] **SC5 — Privacy & trust model preserved.** Fingerprint farbling (the main-world,
  non-context-isolated preload path) still runs per tab; Shields apply per jar; container/burner/default
  partitions stay isolated; and the internal-page trust model (the four gates, the internal session, the
  origin-checked bridge) holds — none of these weaken in the move off `will-attach-webview`. *(Verified:
  privacy/security behavior tests + internal-session exclusion checks.)*
- [ ] **SC6 — Automation (MCP) parity, no drift.** Every MCP tool that addresses guest pages by
  `webContents` id continues to work end-to-end; auth/origin gating, jar scoping, and the
  observe/act/find/nav/devtools ops all hold. The accumulated MCP behavior-test corpus is the benchmark.
  *(Verified: `mcp-drive-end-to-end` + the `mcp-*` behavior tests.)*
- [ ] **SC7 — Side-panel compositing (#27 / SC10) — bonus, free-only.** The media/privacy panel
  composites correctly over the guest surface, closing #27/SC10 — pursued **only if** it falls out of the
  native-view model essentially for free. Not a gate; explicitly droppable without reopening as polish.
- [ ] **SC8 — Frameless window & controls parity, per platform.** The frameless window, drag regions,
  and window controls (custom minimize/maximize/close on Windows/Linux; native traffic lights on macOS)
  work as they do today on the `BaseWindow` shell. *(Verified: in-loop on Linux/WSLg; macOS by
  build-readiness + recorded decision, per Constraints.)*

## Stakeholders

- **The operator** — wants the structural debt cleared so #27, docked DevTools, and find-directness stop
  being per-flight workarounds, without destabilizing a working browser.
- **Agent users of the MCP surface** — depend on `webContents`-id addressing and the gating model
  surviving the migration unchanged (no parity drift).
- **End users** — must see zero regression in everyday browsing, privacy, and the conveniences shipped
  across M02–M04.
- **The macOS contributor** — built an earlier version on mac; the near-term mac verification path.

## Constraints

- **Parity first, features second.** This mission ships the migration at behavior parity. New
  capability (#27/SC10, docked DevTools, etc.) is claimed only where it is essentially free (SC7);
  otherwise it is follow-on work, not scope creep here.
- **The behavior-test corpus is the acceptance net.** Migration "done" is defined by the existing active
  behavior tests (browsing, tabs, find, zoom, print, downloads, context menu, kebab, settings,
  and especially the `mcp-*` suite) passing on the new surface — not by code review alone. **Caveat:** a
  few specs themselves assume a `<webview>` element (e.g. `find-in-page.md`, the element-routed find in the
  `mcp-*` suite); updating those to the new surface is **in-scope migration work**, so the corpus is the
  acceptance net but not a wholly-unchanged one.
- **Security-critical rewiring stays byte-exact.** Two partition assignments move off DOM attributes onto
  `webPreferences.partition`: the trusted internal partition and each tab's jar partition. Jar membership
  is decided by **session-object identity**, so any drift silently breaks either the internal trust
  boundary or MCP jar-scoping. The `internal-session-exclusion` and `mcp-jar-scoping` behavior tests guard
  this and run early.
- **Long-running mission branch.** All work happens on a dedicated mission branch; **each flight branches
  off the mission branch** (not `main`). `main` stays stable and shippable throughout; the mission branch
  merges to `main` only when the migration lands at parity.
- **No in-loop macOS venue (yet).** macOS cannot be verified during this mission — GitHub mac builds are
  ~a week out and there is no local mac. The macOS apparatus decision for this mission is explicit and
  recorded: **rely on Linux/WSLg as the in-loop venue + a macOS build-readiness check + the contributor's
  mac build**, and carry mac-authoritative behavior as cross-fingers-pending-venue (a documented
  decision, not a blocking gate). Nothing in the migration may hard-break the mac build path.
- **Electron ^42.4.0** (current pin); `BaseWindow` + `WebContentsView` are the target primitives.
- **No security relaxation.** The internal-page CSP, the four gates, `isSafeTabUrl`, and the
  origin-checked internal bridge are invariants — the migration may not widen any of them.

## Environment Requirements

- **Development**: local Electron toolchain, Node; Linux/WSLg as the primary in-loop run + HAT venue.
- **Runtime**: GUI (frameless window, native views); the loopback-only MCP automation transport for the
  agent-parity behavior tests.
- **Tooling**: `electron@^42.4.0`, `electron-builder@^26.x`; existing `npm run a11y` and the
  `/behavior-test` apparatus.
- **macOS**: build-readiness only this mission; CI mac builds expected ~1 week out; contributor mac build
  as a sanity venue.

## Open Questions

- **Panel-overlay-as-native-view** — can the media/privacy panel composite over a `WebContentsView`
  guest cleanly on Electron 42 (native sibling view? overlay view? clipped chrome view)? This is SC2's
  core question and gates the whole mission.
- **Per-tab `contextIsolation:false` for farbling** — reproducing the `will-attach-webview` web-tab
  config (main-world preload) on directly-constructed `WebContentsView` webContents: does the farble
  preload still run in the page main world without the `<webview>` attachment hook?
- **`found-in-page` (and other renderer-consumed events) on the new surface** — which guest events change
  delivery target when the guest stops being a renderer `<webview>` tag? (D1 is the warning shot.)
- **Tab show/hide & geometry** — driving per-tab `WebContentsView` bounds/visibility from the tab strip:
  one reused view vs. one view per tab; z-order with the chrome view and any panel overlay.
- **Internal trusted pages as views** — mapping the internal session + session-scoped `protocol.handle`
  + the four gates onto a `WebContentsView` (vs. the current trusted `<webview>` partition attribute).
- **Drag regions on `BaseWindow`** — reproducing `-webkit-app-region` drag/no-drag behavior when the
  chrome is a `WebContentsView` over a `BaseWindow`, per platform.

## Known Issues

- [ ] {none yet — populate as flights surface migration blockers}

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a
> time as work progresses, each branched off the mission branch. This list will evolve with discoveries.

- [x] **Flight 1: Spike & decision gate (alignment / hands-on)** — ✅ LANDED, clean GO (2026-06-23/24).
  All probes passed; #27 mis-composite does not reproduce under native views; SC7 looks free; D1 find
  workaround deletable; farble + partition-identity + drag all hold on Linux/WSLg (mac deferred). —
  run as an interactive alignment
  session, since this is the riskiest, most judgment-heavy step. `WebContentsView` + `BaseWindow` on
  Electron 42: prove frameless + drag-region + **panel-overlay-as-native-view** (acceptance signal =
  pixels), prototype the tab view-hosting model (one-per-tab vs. reused — the open design fork), and
  re-verify `found-in-page` delivery on the new surface. Record the macOS apparatus decision. Output:
  clean → go; not-clean → operator options-review. *(Satisfies SC2; gates everything after.)*
- [ ] **Flight 2: Window shell** — `BaseWindow` + a chrome `WebContentsView`; frameless, drag regions,
  and per-platform window controls at parity. Chrome renders on the new shell. *(SC8.)*
- [ ] **Flight 3: Tab surface** — guest tabs as `WebContentsView`s driven by main-process geometry;
  per-tab partition/preload reproduced with farbling preserved; navigation, popups-as-tabs, persistent
  sessions. *(SC1, SC3, SC5-part.)*
- [ ] **Flight 4: Conveniences & event-seam re-architecture** — re-home the renderer↔`<webview>`-element
  seams to the main-process `webContents` (delete/replace `find.js`'s D1 find workaround; re-wire the
  renderer's `found-in-page`, media-rescan, and privacy-stream listeners), then re-verify zoom, print,
  find, DevTools, context menu, spellcheck, downloads on the native surface; update the `<webview>`-assuming
  specs. *(SC4. Larger than a re-verify pass — budgeted as a rewrite.)*
- [ ] **Flight 5: Internal pages & automation parity** — internal `goldfinch://` pages on the new surface
  with the trust model intact; full MCP end-to-end parity via the `mcp-*` behavior-test corpus. *(SC1,
  SC5, SC6.)*
- [ ] **Flight 6: Panel composition, parity sweep & land** — media/privacy panel as a native overlay;
  claim #27/SC10 if free (SC7); run the full active behavior-test corpus as the parity benchmark; macOS
  build-readiness check; merge the mission branch to `main`. *(SC3, SC7, SC8, mission landing.)*

> The alignment / vibe-coding session is folded into **Flight 1** (above) rather than a standalone flight —
> the spike is the natural home for hands-on, judgment-heavy exploration.
