# Mission: Standard Browser Conveniences

**Status**: active

## Outcome

Goldfinch closes the gap between "an Electron shell that renders the web" and "a browser
that feels complete." It gains the **standard conveniences the Chromium engine enables but
Electron leaves unwired** — **page zoom**, **print / save-as-PDF**, **in-field spellcheck**,
**find-in-page**, **first-class DevTools**, a **custom right-click page context menu**, and a
**downloads surface** — each built natively on the Electron/`webContents` primitives rather
than bolted on. Consistent with Goldfinch's "agents are first-class users alongside people"
thesis, **every new capability an agent could reasonably drive also lands as a tool on the
automation/MCP surface** (agent parity), and the mission folds in an **MCP schema-hygiene fix**
so strict MCP consumers stop rejecting the toolset. Two standing UX bugs are cleared along the
way: the **side-panel open-animation glitch** (#27) and the **`press_key` top-level `anyOf`**
schema bug (#56).

This is the "free Chromium stuff" mission — with the honest caveat that almost none of it is
literally free: Electron embeds the Chromium *engine* (Blink/V8/web platform) but **not** the
Chrome *browser application*, so each feature is a wire-up of a lower-level Electron hook
(`webContents.setZoomLevel` / `print` / `printToPDF` / `findInPage` / `openDevTools` / the
`context-menu` event / `will-download`) into Goldfinch's own UI, persistence, and trust model.

## Context

**Where this sits.** Across Mission 01 (Electron/security hardening), Mission 02 (settings +
tab-control surface), and Mission 03 (the gated automation surface), Goldfinch grew a sharp
three-pillar thesis — **control**, **privacy**, and **automatability**. Those missions built
*differentiated* capability (Shields, container jars, the MCP automation surface). This mission
is deliberately different: it delivers the **table-stakes browser conveniences** a user expects
from any modern browser and that Goldfinch conspicuously lacks today. It is lower-risk and more
mechanical than its predecessors, but it materially changes how complete the browser feels —
and, by extending each capability to the automation surface, it keeps the automatability pillar
in lockstep rather than letting the human and agent feature sets diverge.

**What exists today (grounded in the codebase).**
- **Navigation history** is per-tab only — `webview.canGoBack()/goBack()/goForward()`
  (`src/renderer/renderer.js`); there is **no** zoom, find, print, spellcheck (it is explicitly
  `spellcheck="false"` on inputs), page context menu, or downloads UI.
- **DevTools** is reachable **only** as an automation/MCP tool (`openDevTools`/`closeDevTools`,
  added in M03 Flight 9) — there is **no** user-facing affordance, shortcut, or panel.
- **Downloads** are handled at the `will-download` event with a session-scoped approved-dirs set
  (`src/main/main.js`) — functional, but with **no** list/history/manager UI.
- **Context menus** exist only for **toolbar items** (Media/Shields), via a **native Electron
  menu** that M02 logged as clumsy against the custom dark/gold chrome (a standing Known Issue).
- **Native notifications** via the web `Notification` API are expected to work through Electron
  already; this mission **verifies and routes them through the existing permission model**, it
  does not build a notification subsystem.

**Loops this closes from prior missions.**
- A **user-facing, non-CDP DevTools-open affordance** is precisely what M03 flagged as missing
  when it could not stage the `devtools-cdp-conflict` behavior test for real (left unit-tested /
  inconclusive under WSLg). Adding first-class DevTools lets that conflict finally be exercised.
- The **custom context-menu component** is the reusable, on-brand, behavior-testable menu M02's
  Known Issue asked for; migrating the toolbar Unpin onto it retires the native menu and is the
  likely moment to graduate `menuController` to a shared module (its 4th consumer).

**Explicitly deferred (operator decision, this planning):**
- **Browsing history** is **out of scope** — it forces a privacy-browser stance (history by
  default? per-jar? burner tabs leave none?) that belongs with a **dedicated jars-lifecycle
  mission** (add / remove / rename jars) the operator wants to do first.
- No **bookmarks/favorites**, **password/secrets manager**, **autofill**, **reader mode**,
  **translate**, **extensions**, or **sync** — each is its own future mission (Tier 3 in
  planning). Extensions in particular hit hard Electron + `<webview>` + per-jar limits.
- **`<webview>` → `WebContentsView` rendering migration** is **out of scope** and seeded as a
  strategic future mission in `BACKLOG.md` (**likely the next mission**, operator). It's the
  supported Electron architecture that would unlock docked in-window DevTools and stronger
  extension support, but it's a cross-cutting rewrite of the renderer/main boundary, not a
  conveniences flight. DevTools docking being constrained here (SC5) is the **second** data point
  motivating it — extension limits in M03 planning was the first.

**MCP parity is cross-cutting (operator decision).** Rather than a single trailing MCP flight,
each feature flight includes the legs to expose its capability on the automation surface, so the
user feature and its agent tool land together. A small **MCP-hygiene pass** (issue #56) rides
along. All MCP additions inherit M03's gating: off-by-default, per-jar/admin-key auth, the
absolute internal-session exclusion for jar keys, and loopback-only binding.

## Success Criteria

> A11y is a cross-cutting acceptance bar, not a separate criterion: every new control below must
> be keyboard-operable and introduce **no new WCAG A/AA violations** under the project's
> accessibility gate (`npm run a11y`). Criteria marked *behavior-test-backed* are verified
> against the running app via Goldfinch's own automation surface (the M03 apparatus).

- [ ] **SC1 — Page zoom.** The operator can increase, decrease, and reset the current page's
  zoom by keyboard (conventional `Ctrl +` / `Ctrl -` / `Ctrl 0`) and see the current zoom level,
  with the change applied to the active tab's web content (*behavior-test-backed*).
- [ ] **SC2 — Print / Save-as-PDF.** The operator can print the current page and save it as a
  PDF through the system print path (*manually verified — the print dialog is OS-native and
  outside the in-app test apparatus*).
- [ ] **SC3 — Spellcheck.** Misspelled words typed into editable web fields are flagged, and
  spelling suggestions are reachable (*behavior-test-backed*).
- [ ] **SC4 — Find in page.** The operator can search for text within the current page, step
  forward/backward through matches with a visible match count/position, and dismiss the search —
  all keyboard-operable (conventional `Ctrl+F` to open, `Esc` to close) (*behavior-test-backed*).
- [ ] **SC5 — First-class DevTools.** The operator can open Chromium DevTools for the **active
  web tab** as a **first-class tool**: a **pinnable toolbar button** consistent with Media and
  Shields (driven by the existing `toolbarPins` mechanism, pin state persisted across restart,
  pinnable/unpinnable from right-click and from Settings → Appearance), **plus** a conventional
  keyboard shortcut (`F12` / `Ctrl+Shift+I`) that works **even when the button is unpinned**.
  DevTools opens in **Chromium's native detached/docked window** — not embedded inside a
  Goldfinch panel, which Electron does not support for `<webview>` guests (the guest lives in the
  renderer DOM, with no native host region for the DevTools front-end; integrated docked DevTools
  would require the `WebContentsView` migration seeded in `BACKLOG.md`). DevTools targets **only
  web content** — never the privileged `goldfinch://` internal pages or the chrome. Its
  interaction with the automation **debugger single-client lock** is **surfaced** to the user with
  no opaque failure; note the lock semantics already exist and are documented at the MCP layer
  (M03), so the new work here is the **user-facing affordance + finally staging the M03
  `devtools-cdp-conflict` observation**, not building the lock (*behavior-test-backed / manual*).
- [ ] **SC6 — Custom page context menu.** Right-clicking page content opens an **on-brand,
  keyboard-operable** custom context menu (not the native OS menu) offering context-appropriate
  actions (e.g. link / image / selection / editable-field actions, and an Inspect entry point).
  The existing toolbar right-click (**Unpin**) is migrated onto the same component, retiring the
  native menu and closing the M02 Known Issue (*behavior-test-backed / a11y*).
- [ ] **SC7 — Downloads surface.** The operator can review in-progress and completed downloads in
  a dedicated surface, see per-item state/progress, and open the downloaded file or its folder
  (*behavior-test-backed*).
- [ ] **SC8 — Agent parity (MCP).** Each newly added capability an agent could reasonably drive
  (at minimum: zoom, find-in-page, print-to-PDF, and the downloads list) is **invocable through
  the automation surface as a discoverable tool**, inheriting M03's gating and jar-scoping
  (*behavior-test-backed*).
- [ ] **SC9 — MCP schema hygiene.** The automation surface's tool schemas are accepted by strict
  MCP consumers: no tool is rejected for a top-level `oneOf`/`allOf`/`anyOf` the Anthropic
  Messages API forbids (issue #56 fixed; `press_key` and any peers flattened) (*verified by a
  schema audit / behavior-test-backed*).
- [ ] **SC10 — Side-panel animation polish.** Opening a side panel (Media / Shields / the new
  DevTools panel) animates as **smoothly as closing it**, and the top chrome (tab strip +
  address bar) **does not shift** during the animation (issue #27 resolved) (*manually verified —
  motion-dependent, outside the reduced-motion test path*).

## Stakeholders

- **Project owner/maintainer** — primary; wants the browser to feel complete and to stop missing
  table-stakes conveniences.
- **End users** (indirect) — including keyboard and assistive-technology users, who benefit from
  the conveniences and depend on the a11y bar holding.
- **Downstream agent consumers** (indirect) — external Claude Code sessions and the-one's agents,
  who gain the new capabilities as drivable tools through the parity work, and whose Anthropic-
  backed clients are unblocked by the #56 fix.

## Constraints

- **Preserve the trust boundaries — none of these features may become an escalation path.** The
  two-point hostile-URL boundary (`isSafeTabUrl` on `createTab` + `will-navigate`) stays intact;
  **DevTools and the context menu target web content only** and must not inspect, open, or act on
  the privileged `goldfinch://` internal pages or the chrome without a deliberate, reviewed
  decision.
- **MCP additions inherit M03's gating wholesale** — off by default, per-jar key (web surface,
  jar-scoped) / env-gated admin key (chrome surface), the **absolute internal-session exclusion**
  for jar keys, loopback-only bind, and audit logging. New tools must not widen the surface's
  reach.
- **Reuse existing seams, don't reinvent.** DevTools uses the existing `toolbarPins` third-item
  seam; new persisted prefs go through the durable schema-versioned `settings-store.js`
  (`DEFAULTS`/`VALIDATORS`/`NORMALIZERS`); the context menu graduates/reuses the shared
  `menuController` keyboard contract rather than a parallel menu implementation.
- **New web-facing controls no-op on internal pages.** The user-facing find / zoom / print /
  DevTools / context-menu affordances must be **absent or inert on `goldfinch://` internal tabs**
  (reuse the existing `isInternalTab` predicate) — they apply to web content only, mirroring the
  trust-boundary scoping of DevTools and the context menu.
- **Spellcheck must not silently leak egress.** Electron's spellchecker fetches Hunspell
  dictionaries from a Chromium CDN on first use by default; a privacy browser must not make that
  third-party fetch without a deliberate decision (bundle, disable, or explicitly accept it) — see
  Open Questions.
- **Native main-process implementation** via `webContents` primitives, consistent with M03 — not
  the retired external `--remote-debugging-port` path.
- **Zero new runtime dependencies** unless an explicit operator go/no-go decides otherwise
  (the project's zero-dep identity, as weighed in M03's MCP-SDK decision).
- **A11y gate holds** — no new WCAG A/AA violations; all new controls keyboard-operable.
- Planning skills produce **documentation only** — no source changes during planning.
- Inherited, out of scope: unsigned builds; absence of branch protection.

## Environment Requirements

- Electron `^42`, Node 22 in the main process; WSLg/Linux dev + a GUI display for live and
  manual verification (macOS specifics — e.g. native print dialog, DevTools docking — confirmed
  later on a mac).
- **Behavior-test apparatus = Goldfinch's own automation/MCP surface** (the M03 dogfooding
  standard): `npm run dev:automation` + the loopback MCP transport; `npm run a11y` for the
  accessibility gate.
- An **MCP client** (a local Claude Code session or the committed example client) to verify the
  agent-parity criteria.

## Open Questions

- [x] **DevTools docking shape** — RESOLVED (operator, 2026-06-18): **native detached/docked
  DevTools window + pinnable launcher button**; in-Goldfinch-panel embedding is dropped (not
  supported for `<webview>` guests) and deferred to the `WebContentsView` migration seed. See SC5.
- [ ] **DevTools default pin state** — `false` (off by default, since most users don't need it)
  vs. `true` (match Media/Shields). Resolve at flight design.
- [ ] **DevTools ↔ automation debugger-lock UX** — exact surfaced behavior when DevTools is open
  on a tab an agent tries to read (and vice-versa): DevTools open ⇒ automation returns
  `debugger-unavailable`, documented, no opaque failure. Confirm at flight design; this is the
  observation M03 could not stage.
- [ ] **`menuController` graduation** — promote it to a reusable module now that the context menu
  is its 4th consumer (long-deferred M02 debt), or keep extending in place. Flight design.
- [ ] **Downloads persistence model** — session-only list vs. persisted download *history*, and
  whether persisted history is per-jar. Persisted download history edges toward the same
  privacy-stance question as browsing history; default lean is to keep it **session/lightweight**
  and align any persistence with the future jars-lifecycle mission. Flight design.
- [ ] **Zoom persistence/scope** — Chromium's default is **per-origin-per-session** zoom, so
  **per-tab isolation is the *harder* case to enforce, not the easier one**. Decide
  per-origin-per-jar (the default behavior) vs. forced per-tab isolation. Flight design.
- [ ] **Which new capabilities warrant MCP tools** — zoom, find, print-to-PDF, downloads-list are
  the likely set; spellcheck and notifications are page-driven and probably do not. Confirm per
  feature flight.
- [ ] **Spellcheck configuration + dictionary egress** — languages/dictionaries and whether
  language selection is operator-configurable, **and** the egress decision: Electron's
  spellchecker downloads Hunspell dictionaries from a Chromium CDN on first use by default —
  decide bundle vs. disable vs. explicitly-accept-the-fetch (a privacy-posture call, not just a
  language pick). Flight design.

## Known Issues

Emergent blockers discovered during execution go here as flights surface them.

- [ ] **Find-in-page cold-start returns `{0,0}` on WSLg** — discovered in Flight 2
  (`find-mcp-tools` / behavior test). The FIRST `findInPage` on a freshly-loaded `<webview>` reports
  zero matches in the WSLg dev environment (Chromium cold-start: a cold `<webview>` only reports match
  counts via `findNext:true`); subsequent finds are correct. The op is architecturally fixed
  (renderer-routed, Flight-2 Deviation D1) and verified correct for warm/stepping finds. **Affects
  SC8 live verification on WSLg only — confirm on macOS** (the mission already plans macOS verification
  for print-dialog / DevTools docking). **Confirmed in the Flight-2 HAT to also affect the SC4 UI
  find bar**: live search-as-you-type (each keystroke issues `findNext:false`) does not update the
  `n/m` count on WSLg, but pressing **Enter** (`findNext:true`) searches correctly and shows the
  count + stepping. The find-bar code is correctly wired for per-keystroke search (renderer.js:1833);
  the degradation is purely the `findNext:false`/WSLg cold quirk. SC4 is functionally satisfied on
  WSLg via Enter (search, visible count, forward/back stepping, close, focus-restore, per-tab restore,
  internal no-op, lightbox guard all HAT-confirmed); live-incremental-search to be confirmed on macOS.

## Flights

> **Note:** Tentative suggestions, not commitments. Flights are planned and created one at a time
> as work progresses, and will evolve with discoveries. MCP-parity legs ride inside each feature
> flight (cross-cutting), per the operator decision.

- [x] **Flight 1: Core conveniences — zoom & print** *(landed 2026-06-18)* — **page zoom** (SC1) and **print /
  save-as-PDF** (SC2), plus their **MCP parity tools** (`setZoom`/`getZoom`, `printToPDF` — SC8
  part). *(SC1/SC8 live-verified; SC2 automation path verified, OS-native-dialog manual check operator-pending. Added mid-flight leg `jar-scope-parity`.)* *(Scoped at flight design, 2026-06-18: **spellcheck moved to Flight 4** — its suggestions
  surface through the context menu and it carries the dictionary-egress decision; **native
  notifications dropped from the mission** — already denied-by-default at `main.js` with no grant
  UI, so user-facing enablement is blocked-by-design on the future permissions-manager, not a
  conveniences wire-up.)*
- [x] **Flight 2: Find in page** *(landed 2026-06-19)* — the find-bar UI component
  (`findInPage`/`found-in-page` wiring, match count/position, `Ctrl+F`/`Esc`, a11y) plus MCP find
  tools (`findInPage`/`stopFindInPage`, surface 24→26). (SC4, SC8 part) *(SC4 HAT-confirmed + SC8
  stepping/warm parity live-verified; **mid-flight Deviation D1**: the MCP find was rebuilt to route
  through the chrome renderer's `<webview>` tag after the behavior test proved `found-in-page` never
  fires on a main-process guest `webContents`. New Known Issue: WSLg cold-start `findInPage`/live-type
  returns no count — `findNext:true`/Enter works — pending macOS confirmation.)*
- [ ] **Flight 3: First-class DevTools** *(issue #39)* — pinnable toolbar button via `toolbarPins`
  (right-click + Settings→Appearance pin, persisted), `F12`/`Ctrl+Shift+I` working when unpinned,
  web-content-only targeting, **native detached/docked DevTools window** (not in-panel — see SC5),
  and the surfaced automation debugger-lock interaction (closes the M03 `devtools-cdp-conflict`
  loop). (SC5)
- [ ] **Flight 4: Custom page context menu + spellcheck** — reusable, on-brand, keyboard-operable
  context-menu component for page content (link/image/selection/editable/Inspect actions); migrate
  the toolbar Unpin off the native menu and graduate `menuController` if taken (closes the M02
  Known Issue). **Includes in-field spellcheck (SC3)** — squiggles (`webPreferences.spellcheck` +
  `setSpellCheckerLanguages`), suggestions surfaced through the new context menu, and the
  **dictionary-CDN egress decision** (bundle / disable / explicitly accept). *(Heaviest non-DevTools
  flight: new webview→renderer `context-menu` param IPC — rich params incl. `dictionarySuggestions`
  arrive on the main-process event — plus the likely `menuController` graduation; a renderer-infra
  refactor, not just a menu.)* (SC6, SC3)
- [ ] **Flight 5: Downloads surface** — a downloads list/manager UI over the existing
  `will-download` handling (per-item state/progress, open file/folder) plus an MCP downloads-list
  tool. (SC7, SC8 part)
- [ ] **Flight 6: Polish & MCP hygiene** — fix the side-panel open-animation glitch (#27,
  composite a `transform` instead of animating `width`; keep the top chrome stationary) and the
  `press_key` top-level `anyOf` schema bug (#56, flatten the schema; audit peers). (SC9, SC10)
