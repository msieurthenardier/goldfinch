# Mission: Settings Area & Tab-Bar Controls

**Status**: active

## Outcome

Goldfinch gains a first-class **Settings area that lives in its own tab**, reminiscent of
modern browsers (persistent section navigation + titled sections), reached through a
**kebab (⋮) menu in the toolbar row, to the right of the Shield button**. Reaching this also reshapes the
tab-strip controls: the **New Tab** (`+`) and **container/jar picker** (`▾`) buttons are
unified into a single **golden, pill-shaped control** (`( + | ▾ )`) left-aligned with the
open tabs. In the same move Goldfinch **sheds the standard OS window frame** for its own
chrome — window controls and draggable space live in a **reserved right-side zone of the tab
bar** (custom minimize/maximize/close on Windows/Linux; native traffic lights retained on
macOS). The Settings surface ships as a
stub — modern chrome with placeholder content — but already wires through a few real controls
(Shields and the default page), proving the internal-page plumbing end to end.

## Context

Goldfinch is a privacy-focused Electron/Chromium browser whose chrome (tab strip, toolbar,
media/privacy panels) is the renderer at `src/renderer/`. Each tab is a real `<webview>`.
The just-completed maintenance mission (`01-maintenance`) left the codebase flight-ready with
a security and accessibility regression net: a two-point hostile-URL boundary (`isSafeTabUrl`
gating `createTab` and `will-navigate`, currently allowing only `http`/`https`/`about:blank`),
an ARIA `tablist` tab strip with roving-tabindex keyboard operability, an axe-core gate
(`npm run a11y`), and behavior tests under `tests/behavior/`.

Today the tab strip (`index.html:13-28`) places the `+` (`#new-tab`) and `▾` (`#new-tab-menu`,
which opens `#container-menu`) buttons *after* the tabs. There is **no kebab menu and no
settings page** — settings-like controls live only inside the Shields/privacy panel and the
hardcoded `HOMEPAGE` constant (`renderer.js:5`). This mission introduces the settings surface
and the internal-page mechanism (`goldfinch://`) needed to host it, while restructuring the
tab-bar controls. The brand accent already exists as `--accent: #f5c518` (`--accent-fg:
#1e1f25`); the golden pill reuses that token rather than introducing a new color.

The window is **framed by the OS today** (`new BrowserWindow` at `main.js:17` uses the default
`frame: true`; no `-webkit-app-region` anywhere). Removing window controls to make room in the
tab bar means going **frameless**, so this mission also takes that step and handles the platform
split: `frame: false` + custom controls on Windows/Linux, `titleBarStyle: 'hidden'` +
`trafficLightPosition` (native traffic lights) on macOS. The dev/verify platform is Linux/WSL, so
macOS specifics are confirmed later on a mac.

An Architect viability review (feasible-with-caveats) shaped the security posture below. The
stack supports every outcome — Electron `^42.x` provides `protocol.registerSchemesAsPrivileged`
and `protocol.handle`, and Shields already has persisted state + IPC (`shields-get`/`shields-set`).
The key correction: the internal scheme must **not** be admitted by widening the shared
`isSafeTabUrl` predicate (both gates are reachable by hostile pages — `window.open` routes
through `createTab`, and page self-navigation hits `will-navigate`). Internal pages open only
through a **trusted embedder path** distinct from the page-reachable `onOpenTab` route; the
settings surface is a **single document with client-side section switching** (so no real
`goldfinch://` sub-navigation ever fires `will-navigate`); and the scheme handler is registered
on a **dedicated internal session/partition** with its own CSP (`frame-ancestors 'none'`), not on
web-content sessions. The settings document needs its own small internal-page preload bridge — it
cannot reuse the media webview-preload or the chrome `window.goldfinch` surface.

## Success Criteria

- [x] **SC1** — The New Tab and container/jar picker actions are presented as a single
  unified pill-shaped control with the brand accent (golden) background, positioned
  left-aligned/adjacent to the open tabs rather than trailing them.
- [x] **SC2** — Opening a plain new tab and opening a new tab in a specific container are both
  still operable from the unified control, by mouse and by keyboard, preserving prior behavior
  (*behavior-test-backed*).
- [x] **SC3** — A kebab/overflow menu is present in the **toolbar row, to the right of the
  Shield button**, and exposes exactly two actions to begin with: open **Settings** and
  **Exit** (*behavior-test-backed*). *(Placement amended at Flight 2 planning, by operator
  decision, from the original tab-bar placement; the "departure from address-bar-row menus"
  framing was dropped — see `flights/02-kebab-menu/`.)*
- [x] **SC4** — Choosing **Exit** terminates the application (*manually verified — quitting the
  app tears down the test harness, so this is checked by hand, not by behavior test*).
  *(Verified Flight 2: trusted Exit click → `app.quit()` → clean termination, Windows/Linux;
  macOS deferred to a mac HAT.)*
- [x] **SC5** — Choosing **Settings** opens the settings surface in its own tab via an internal
  address, reloadable like any other tab, while web-page content **cannot navigate to, open,
  embed, or spoof** the internal scheme — page-originated attempts (`window.open('goldfinch://…')`,
  `location = 'goldfinch://…'`, `<iframe src="goldfinch://…">`, cross-origin `fetch`) are all
  rejected (*behavior-test-backed — extends the `tab-scheme-guard` spec*). **Verified Flight 4:
  `tab-scheme-guard` 13/13 live; all four spoof vectors rejected; trusted kebab→Settings opens +
  reloads `goldfinch://settings`. (Surface is a stub — SC6/SC7 enrich/wire it in Flights 5/6.)**
- [ ] **SC6** — The settings surface presents a modern-browser-style layout — persistent
  section navigation plus titled sections — recognizable as a settings area, with placeholder
  content wherever controls are not yet wired.
- [ ] **SC7** — The privacy/Shields controls (already persisted) and the default/home page are
  operable from the settings surface, and changes persist and take effect consistently with the
  existing panels. Promoting the home page to a real setting includes the minimal persistence it
  needs (it is hardcoded today) (*behavior-test-backed*).
- [x] **SC8** — The new tab-bar controls, kebab menu, and settings surface are keyboard-operable
  and introduce no new WCAG A/AA violations under the project's accessibility gate
  (*behavior-test-backed / a11y gate*).
- [x] **SC9** — The application window is **frameless**: Goldfinch removes the standard OS window
  frame and supplies its own chrome — custom **minimize / maximize-restore / close** controls in
  the tab bar's reserved right-side zone on Windows/Linux, with the **native traffic-light
  controls retained** (inset into that zone) on macOS. The window stays **movable** (a drag region
  in the reserved zone) and **resizable**, and the reserved zone leaves space for forthcoming
  controls. (*Maximize/restore state is behavior-test-backed via an
  observable read path; window **drag** and **close/quit** are manually verified — dragging can't
  be driven over CDP and closing tears down the test harness.*)

## Stakeholders

The project owner/maintainer. As a public, privacy-focused browser, end users — including
keyboard and assistive-technology users — are indirect stakeholders in the settings
discoverability, the unchanged container/privacy behavior, and the accessibility outcomes.

## Constraints

- **Reuse the existing brand token** (`--accent` / `--accent-fg`) for the golden pill; do not
  introduce a new palette.
- **Preserve the two-point hostile-URL security boundary — without globally widening it.** Do
  **not** make `isSafeTabUrl` return true for `goldfinch://` (that would expose the scheme via
  both `window.open`→`createTab` and `will-navigate`). Internal pages open only through a trusted
  embedder path that web content cannot reach; `will-navigate` keeps rejecting `goldfinch://` from
  web origins; the scheme handler lives on a dedicated internal session with its own CSP. Web
  content must not navigate to, open, embed, or spoof the scheme.
- **Preserve the tab-strip ARIA/roving-tabindex contract** and the `tab-keyboard-operability`
  behavior test; the kebab follows the APG menu-button pattern.
- **Frameless chrome stays cross-platform and non-trapping.** Retain the **native macOS
  traffic-light controls** (no custom replacement on mac); the window must remain **resizable and
  movable** after the frame is removed (no stranding the operator with a fixed, undraggable
  window). Window controls use neutral glyphs, not the brand accent.
- **Settings is a stub.** Only settings that map to *existing* concepts get wired (Shields
  toggles; the home page). No new browser settings are invented. The one permitted new backend is
  the minimal persistence to turn the hardcoded `HOMEPAGE` into a real, editable setting.
- Planning skills produce documentation only — no source changes during planning.
- Inherited, out of scope: unsigned builds and the absence of branch protection remain accepted
  tradeoffs.

## Environment Requirements

- Local Node toolchain (Node ≥20) and `npm`.
- Electron desktop runtime (GUI) for manual and behavior verification.
- Behavior tests / a11y gate drive the running app over CDP — `npm run dev:debug` (remote
  debugging on `:9222`), `npm run a11y`, and the Playwright/chrome-devtools MCP per `.mcp.json`.

## Open Questions

- [x] Should settings be a single document with client-side section nav (no real `goldfinch://`
  sub-navigation)? → **Yes** — keeps `will-navigate` from ever firing for the scheme. (Architect)
- [x] Which session hosts settings? → A **dedicated internal partition**, with the protocol
  handler registered only there (not on web-content sessions). (Architect)
- [ ] Exact `goldfinch://` serving mechanism (`protocol.handle` on the internal session, scheme
  registered `{ standard: true, secure: true }` pre-`app.ready`) — confirmed at flight design.
- [ ] Internal-page bridge shape — a dedicated internal-page preload exposing a minimal
  `ipcRenderer` surface (the settings doc can use neither the media webview-preload nor the chrome
  `window.goldfinch`) — confirmed at flight design.
- [x] Whether **Exit** confirms before quitting when tabs are open → **No, plain quit**
  (resolved at Flight 2 planning; the nice-to-have confirm dialog is not built).
- [ ] macOS `trafficLightPosition` inset for the frameless window — confirmed on a mac (dev
  platform is Linux/WSL). Flagged `needs-human-recheck` for the mac build.
- [ ] Frameless resizability/snapping on the dev compositor (WSLg) with `frame: false` — verified
  at flight execution; the chief unknown gating the frameless work (see Flight 1).

## Known Issues

- **Tab-overflow handling needs a dedicated "many-tabs" pass** (surfaced during Flight 1
  verify-integration HAT; deferred by operator decision). Two issues to fix when that work is
  taken up in earnest: (a) the `#tabs` horizontal `overflow-x:auto` scrollbar isn't reliably
  grabbable in the frameless chrome — and is slated to be **replaced by left/right arrow scroll
  controllers** flanking the tabs; (b) the **active tab can scroll off-screen** with many tabs
  (no scroll-into-view on activate/close). Neither blocks Flight 1; both are tracked here as
  cross-flight scope for a future tab-overflow flight. See
  `flights/01-tab-bar-control-restructure/flight-log.md` (Anomalies) for detail.
- **Pre-existing a11y: 2 `scrollable-region-focusable` (WCAG 2.1.1, serious)** in the privacy
  panel and lightbox scroll regions (lacking keyboard access). Surfaced by Flight 1's
  verify-integration a11y sweep but **confirmed pre-existing** (identical on the pre-flight build);
  not introduced by Flight 1, which touched neither component. Tracked here for a future a11y /
  panels touch-up — fix: give `#privacy-body` + the lightbox scroll container `tabindex="0"`.
  *(Flight 4 update: the a11y gate is now baseline-pinned — `scripts/a11y-audit.mjs` diffs against a
  curated `ACCEPTED` allowlist. The live 2026-06-07 run did NOT reproduce these two (they only fire
  when the scroll region overflows, which the gate's empty states don't); they are kept **pre-accepted**
  in the allowlist so a future overflow-state audit won't flag them as NEW. The underlying fix still
  stands.)*

- **Internal tab is freely web-navigable → harden the internal bridge before Flight 6 wires real IPC**
  — discovered in Flight 4 verify-integration. The settings tab is a first-class tab (Option A), so its
  address bar / programmatic `navigate()` can load an arbitrary http page **into the privileged
  `goldfinch-internal` session** (webPreferences are fixed at webview attach, so the http page inherits
  `contextIsolation:true` + the internal preload + access to the `goldfinch://` handler). **Inert in
  Flight 4** (the bridge exposes only `{version:1}`; entry requires a *trusted, chrome-initiated*
  navigation — not web-reachable; all SC5 gates verified 13/13). **But Flight 6 adds real
  home-page/Shields IPC to the internal bridge** — at which point web content in the internal tab could
  call privileged IPC. **This is the Electron analogue of Chrome's process model**: `chrome://` WebUI
  pages run in a dedicated privileged renderer, and navigating to a web URL forces a **cross-process
  swap** so web content lands in a fresh sandboxed renderer that never inherits the WebUI context (the
  "Chrome" address-bar chip / "secure Chrome page" is Chrome surfacing that privileged context). Our
  `<webview>` can't do that automatically — `partition`/`preload`/`contextIsolation` are **immutable
  after attach**, so the internal session persists across the navigation. Fix in Flight 5/6, layered:
  - **(must, before Flight 6 IPC) Origin-check the bridge** — the internal preload refuses every
    privileged IPC unless `location.origin` is `goldfinch://…`. Cheap backstop that neutralizes the
    blast radius even if the swap/lock below slips.
  - **(swap or lock) Either** re-home the tab on cross-context navigation (tear down + recreate the
    `<webview>` in the correct session/preload — closest to Chrome's swap) **or** lock internal tabs so
    they don't free-browse (read-only/special address bar on `goldfinch://`; a web navigation opens a
    new normal tab instead — simplest, and you don't browse the web *from* a settings page anyway).
  - **(UX, Flight 5) Address-bar internal-page identity indicator** — a `goldfinch://`/internal chip
    (à la Chrome's "Chrome" chip) for legibility + anti-spoofing, so web content can't fake a settings
    page. See `flights/04-internal-page-scheme/flight-log.md` (Anomalies).

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created
> one at a time as work progresses. This list will evolve based on discoveries during
> implementation.

- [x] **Flight 1: Tab-bar control restructure & frameless chrome** — unify `+` and `▾` into the
  golden, pill-shaped `( + | ▾ )` control leading the tabs; make tabs shrink/grow to fit with a
  deferred resize-on-close (*flight-local — no mission SC*); preserve new-tab/container behavior
  and keyboard/AT operability; and go **frameless** — remove the OS frame for custom window
  controls (native traffic lights on macOS) in a reserved, draggable right-side zone.
  (SC1, SC2, SC8, SC9) *(Heaviest flight; the frameless window-chrome legs may split into a
  follow-on flight if frameless resize proves unstable on the dev platform.)*
- [x] **Flight 2: Kebab menu** — add the ⋮ menu button to the **toolbar row (right of the Shield
  button)** with the APG menu-button pattern; two items, Settings (inert placeholder until the
  internal-page mechanism lands in Flight 4+) and Exit; wire Exit to quit the app via a dedicated
  `app-quit` IPC (terminates on all platforms). (SC3, SC4, SC8) *(landed 2026-06-07; `kebab-menu`
  behavior test 10/10, Exit quit verified, a11y clean)*
- [x] **Flight 3: Menu dismissal & shared APG helper** — fix the dismissal bug where open menus don't
  close on page/`<webview>` clicks or the other menu's trigger; route both the kebab and container
  (`▾`) menus through a shared APG menu controller (window-blur + in-chrome outside-dismiss +
  mutual-exclusion + roving/arrow-nav), lifting the container menu to the kebab's a11y level and
  removing Flight 2's hand-wired mutual-exclusion. (SC8; flight-local dismissal correctness)
  *(landed 2026-06-07; `menu-dismissal` 9/9, container menu axe-clean, regressions intact, page-click +
  app-switch dismissal HAT-confirmed)*
- [x] **Flight 4: Internal page scheme (`goldfinch://`)** — register the privileged internal
  scheme (`{ standard, secure }`) and serve bundled assets via `protocol.handle` on a dedicated
  internal session; open internal pages only through a trusted embedder path; keep `will-navigate`
  rejecting the scheme from web origins; add a dedicated internal-page preload bridge; extend the
  `tab-scheme-guard` behavior test to cover `goldfinch://` spoof/embed vectors. (SC5)
  *(landed 2026-06-07; NOT split — kept one flight, 7 legs; `tab-scheme-guard` 13/13 live, CSP
  `frame-ancestors 'none'` confirmed, a11y baseline pinned. The two design reviews caught a synchronous
  `session-created` exclusion bug and a New-Identity data-loss trap before any code shipped. Latent
  internal-tab web-navigability finding carried to Flight 5/6 — see Known Issues.)*
- [ ] **Flight 5: Settings page shell + address-bar chips** — build the stub `goldfinch://settings`
  page with modern-browser chrome (persistent section nav + titled sections) and placeholder content;
  accessible. (SC6, SC8) *(Scope expanded at planning by operator: also adds the **address-bar chips**
  (internal-page identity chip + web-page site-info chip), a **site-info popup** (summarizing existing
  per-tab data, linking into Shields), and an **internal-tab navigation lock** — flight-local additions
  that partially discharge the Flight-4 internal-page identity-chip / web-navigability Known Issue (UX
  half; the security bridge origin-check stays Flight 6). Requires extending the internal protocol
  handler to serve CSS/JS subresources, and hoisting the shared `menuController` keyboard contract
  before the popup becomes menu #3. May split into Flight 5 (shell) + 5b (chips/popup/lock) if it
  balloons.)*
- [ ] **Flight 6: Wire existing controls** — surface the Shields toggles into the settings page
  via the internal-page bridge (reusing `shields-get`/`shields-set`); promote `HOMEPAGE` to a real
  persisted, editable home-page setting (minimal store + get/set IPC, read at tab creation). Both
  persist and take live effect, matching the existing panels. (SC7, SC8)
