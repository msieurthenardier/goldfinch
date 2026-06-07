# Mission: Settings Area & Tab-Bar Controls

**Status**: active

## Outcome

Goldfinch gains a first-class **Settings area that lives in its own tab**, reminiscent of
modern browsers (persistent section navigation + titled sections), reached through a
**kebab (⋮) menu placed in the tab bar** — a deliberate departure from Chrome-style browsers
that hang their overflow menu off the address-bar row. Reaching this also reshapes the
tab-strip controls: the **New Tab** (`+`) and **container/jar picker** (`▾`) buttons are
unified into a single **golden, pill-shaped control** (`( + | ▾ )`) left-aligned with the
open tabs. In the same move Goldfinch **sheds the standard OS window frame** for its own
chrome — window controls and draggable space live in a **reserved right-side zone of the tab
bar** (custom minimize/maximize/close on Windows/Linux; native traffic lights retained on
macOS), which also leaves room for the Settings entry point. The Settings surface ships as a
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
- [ ] **SC3** — A kebab/overflow menu is present in the tab bar — distinct from the
  address/toolbar row — and exposes exactly two actions to begin with: open **Settings** and
  **Exit** (*behavior-test-backed*).
- [ ] **SC4** — Choosing **Exit** terminates the application (*manually verified — quitting the
  app tears down the test harness, so this is checked by hand, not by behavior test*).
- [ ] **SC5** — Choosing **Settings** opens the settings surface in its own tab via an internal
  address, reloadable like any other tab, while web-page content **cannot navigate to, open,
  embed, or spoof** the internal scheme — page-originated attempts (`window.open('goldfinch://…')`,
  `location = 'goldfinch://…'`, `<iframe src="goldfinch://…">`, cross-origin `fetch`) are all
  rejected (*behavior-test-backed — extends the `tab-scheme-guard` spec*).
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
  controls (e.g. the Settings entry point). (*Maximize/restore state is behavior-test-backed via an
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
- [ ] Whether **Exit** confirms before quitting when tabs are open (nice-to-have; default is a
  plain quit).
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

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created
> one at a time as work progresses. This list will evolve based on discoveries during
> implementation.

- [ ] **Flight 1: Tab-bar control restructure & frameless chrome** — unify `+` and `▾` into the
  golden, pill-shaped `( + | ▾ )` control leading the tabs; make tabs shrink/grow to fit with a
  deferred resize-on-close (*flight-local — no mission SC*); preserve new-tab/container behavior
  and keyboard/AT operability; and go **frameless** — remove the OS frame for custom window
  controls (native traffic lights on macOS) in a reserved, draggable right-side zone.
  (SC1, SC2, SC8, SC9) *(Heaviest flight; the frameless window-chrome legs may split into a
  follow-on flight if frameless resize proves unstable on the dev platform.)*
- [ ] **Flight 2: Tab-bar kebab menu** — add the ⋮ menu button to the tab bar with the APG
  menu-button pattern; two items, Settings and Exit; wire Exit to quit the app. (SC3, SC4, SC8)
- [ ] **Flight 3: Internal page scheme (`goldfinch://`)** — register the privileged internal
  scheme (`{ standard, secure }`) and serve bundled assets via `protocol.handle` on a dedicated
  internal session; open internal pages only through a trusted embedder path; keep `will-navigate`
  rejecting the scheme from web origins; add a dedicated internal-page preload bridge; extend the
  `tab-scheme-guard` behavior test to cover `goldfinch://` spoof/embed vectors. (SC5)
  *(May split during flight design into "scheme registration + serving" and "boundary hardening +
  spoof test" — risk is concentrated here.)*
- [ ] **Flight 4: Settings page shell** — build the stub `goldfinch://settings` page with
  modern-browser chrome (persistent section nav + titled sections) and placeholder content;
  accessible. (SC6, SC8)
- [ ] **Flight 5: Wire existing controls** — surface the Shields toggles into the settings page
  via the internal-page bridge (reusing `shields-get`/`shields-set`); promote `HOMEPAGE` to a real
  persisted, editable home-page setting (minimal store + get/set IPC, read at tab creation). Both
  persist and take live effect, matching the existing panels. (SC7, SC8)
