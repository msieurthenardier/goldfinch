# Flight: Settings Page Shell + Address-Bar Chips

**Status**: completed
**Mission**: [Settings Area & Tab-Bar Controls](../../mission.md)

## Contributing to Criteria
- [ ] **SC6** — The settings surface presents a modern-browser-style layout — persistent section
  navigation plus titled sections — recognizable as a settings area, with placeholder content wherever
  controls are not yet wired.
- [ ] **SC8** — The new settings shell, address-bar chips, and site-info popup are keyboard-operable and
  introduce no new WCAG A/AA violations under the (now-pinned) accessibility gate.

> **Scope note — this flight is bigger than the mission's original "settings page shell" line.** Beyond
> the SC6 shell, the operator elected to also add the **address-bar chips** (internal-page identity chip
> + web-page site-info chip), a **site-info popup**, and an **internal-tab navigation lock** — all the
> address-bar surface. These are **flight-local** additions that also **partially discharge the Flight-4
> "internal-page identity chip" / internal-tab-navigability Known Issue** (the UX half; the
> security-critical bridge origin-check stays Flight 6). **SC7** (wiring real Shields/home-page controls)
> remains Flight 6 — this flight's sections hold placeholder content. If the flight balloons, the
> chip/popup/lock legs split into a Flight 5b (see Adaptation).

---

## Pre-Flight

### Objective

Enrich the `goldfinch://settings` stub into a **Chrome-style settings shell** — a single document with a
sticky left section-nav and scrolling titled sections (Appearance, Privacy & Shields, On startup / Home
page, Downloads, About), placeholder content throughout, fully accessible. Extend the internal protocol
handler to serve the page's CSS (and optional JS) subresources under the existing strict CSP. Add
**address-bar chips** — an internal-page identity chip on `goldfinch://` and a web-page site-info chip on
`http(s)` — the web chip opening a **site-info popup** (origin, connection, a trackers/permissions
summary from existing per-tab data, and a link into the Shields panel) via the shared `menuController`.
**Lock internal-tab navigation** Chrome-style (a web URL typed in a `goldfinch://` tab opens a new normal
tab rather than navigating the internal tab). No real settings controls are wired (Flight 6).

### Open Questions
- [x] Section set? → **Chrome-trimmed**: Appearance · Privacy & Shields · On startup / Home page ·
  Downloads · About (operator). See DD1.
- [x] How are the page's CSS/JS served under `default-src 'self'`? → Extend the handler to a **per-host
  path allowlist** with content-type by extension; CSP needs **no** relaxation (`'self'` permits
  same-origin subresources). See DD2.
- [x] Web chip behavior? → A **new lightweight site-info popup** via the shared `menuController`, with a
  "Site settings →" link into the existing Shields panel (operator). See DD5.
- [x] Lock internal-tab navigation this flight? → **Yes**, paired with the chip (operator). See DD6.
  The security-critical bridge origin-check stays Flight 6.
- [x] Does adding the popup trigger the Flight-3 `menuController` keyboard-contract hoist? → **Yes** —
  the site-info popup is **menu/popup #3**; hoist the APG keyboard contract into the controller first.
  See DD7.
- [ ] One-section-at-a-time vs all-sections-scrolling? → **Scrolling** (Chrome-style; native anchors,
  no JS required for core nav). Confirmed at DD1; minor, an acceptable variation.
- [ ] Exact glyphs/wording for the chips ("Goldfinch" vs a gear; lock glyph) — tune at leg design / HAT.

### Design Decisions

**DD1 — Chrome-style single-document shell: sticky left section-nav + scrolling titled sections**:
Enrich `src/renderer/pages/settings.html` into `<nav>` (a persistent left sidebar of in-page anchor
links, one per section) + a scrolling content column of `<section>`s, each with an `<h2>` and
placeholder content. Sections: **Appearance · Privacy & Shields · On startup / Home page · Downloads ·
About**. **Native `#anchor` navigation** (the nav links are `<a href="#privacy">` etc.) — keyboard- and
AT-operable with no JS; an **optional** minimal `settings.js` adds scroll-spy `aria-current` highlighting
only. Single document with in-page anchors → **no real `goldfinch://` sub-navigation ever fires
`will-navigate`** (the mission's internal-page constraint holds trivially).
- Rationale: the scrolling-sections + sidenav model is the Chrome-settings shape, is natively
  accessible, and keeps the page a single served document.
- Trade-off: all sections render at once (fine for a stub with little content); a tabbed one-at-a-time
  model would need JS and a richer APG tablist — deferred unless content volume later demands it.

**DD2 — Serve the page's subresources via a per-host PATH allowlist; CSP unchanged**: The handler today
(`handleInternal`, `main.js:52`) serves **root-path only**, a single HTML file per host
(`INTERNAL_PAGES[host]`, `main.js:32`), hardcoded `text/html`. The shell needs `settings.css` (and
optionally `settings.js`). Extend `INTERNAL_PAGES` from `host → file` to a **per-host path map**
(`{ settings: { '/': settings.html, '/settings.css': settings.css, '/settings.js': settings.js } }` or
equivalent), serve each with a **content-type by file extension** (`text/html`/`text/css`/`text/javascript`),
and keep it **traversal-proof** (fixed map, the file path is NEVER derived from `url.pathname`). The CSP
stays exactly `INTERNAL_CSP` (`default-src 'self'; …`) — `'self'` permits the page to load its own
same-origin `goldfinch://settings/settings.css` etc., so **no CSP relaxation** and **no `'unsafe-inline'`**.
- **SPIKE (leg 2, before leg 3 builds on it)**: that `default-src 'self'` permits a `goldfinch://`
  subresource on a `{standard, secure}` scheme is **very likely but unproven in this codebase** (Architect)
  — `style-src`/`script-src` fall back to `default-src`. Serve ONE `settings.css` and confirm it loads
  with no CSP block (no `securitypolicyviolation`; the stylesheet applies) before DD3 assumes it. Fallback
  if blocked: a per-page `style-src 'self'`/`script-src 'self'` in the served CSP (still no `'unsafe-inline'`).
- Traversal-proofing: match the **normalized `url.pathname`** against the fixed path map — never build a
  path FROM it. The handler already discards `net.fetch`'s headers and sets its own (`main.js:67-71`);
  extend that to content-type-by-extension.
- Rationale: strict CSP forbids inline `<style>`/`<script>`, but allows same-origin subresources; serving
  them as separate files is the correct, no-weakening path. The handler stays an explicit allowlist.
- Trade-off: the handler grows from single-file to a small path map; non-allowlisted paths still 404,
  non-GET still 405 (unchanged guarantees).

**DD3 — Self-contained `settings.css` matching the chrome's brand tokens**: `settings.css` re-declares
the brand tokens (`--accent: #f5c518`, `--accent-fg: #1e1f25`, dark bg `#1e1f25`) so the page reads as
Goldfinch, **without** `@import`ing the chrome `styles.css` (cross-document, and serving a shared tokens
file is over-engineering for a stub).
- Rationale: visual cohesion with zero coupling to the chrome stylesheet.
- Trade-off: a small token duplication (acceptable for a stub; revisit if a shared token file is ever
  warranted).

**DD4 — Address-bar chip reflecting the active tab**: Add a chip element in `#address-wrap`
(`index.html:54`), left of the address input, whose state tracks the active tab's URL: **internal-page
chip** on `goldfinch://` (a "Goldfinch"/settings identity indicator — the Flight-4 Known-Issue chip) and
**web-page site-info chip** on `http(s)` (a lock/connection indicator + the origin). Updated on tab
activate / navigation alongside the existing `els.address.value` sync (`renderer.js:476/553/569`).
- **a11y note (Architect)**: `#address-wrap` is in the pinned `ACCEPTED` `region` allowlist
  (`a11y-audit.mjs`), so a chip button added inside it MUST carry an `aria-label` (and not introduce an
  unlabelled interactive node) or the guest/chrome a11y gate flags a NEW violation. Verify against the
  baseline.
- Rationale: legibility + anti-spoofing (a web page can't fake the internal-page identity) — the
  operator's Chrome-parallel.
- Trade-off: new chrome real estate in the address row; neutral glyphs (not the brand accent, per the
  window-controls convention).

**DD5 — Site-info popup from the web chip (a non-menu popup via the shared `menuController`)**: Clicking
the **web** chip opens a small popup populated from the **existing per-tab data** — origin + connection
(`http`/`https`) + a compact summary from `tab.privacy` (trackers blocked count via
`tab.privacy.net.trackers.blocked`, permissions count via `tab.privacy.permissions.length`) + a
**"Site settings →"** action that opens the existing Shields/privacy panel (`togglePrivacy(true)`). The
**internal** chip's click shows a static "You're viewing a secure Goldfinch page" note (no site data).
The popup registers with the shared `menuController` (`renderer.js:104`) for open/close/mutual-exclusion/
outside-dismiss, plus its **own minimal keydown** (Escape/Tab close + focus-return) — it is **not** a
`role=menu` (DD7).
- **`tab.privacy.net` is `null` until the ~350ms-debounced `privacy-net` IPC arrives** (`main.js`
  webRequest → `renderer.js` ~1306); the popup MUST render gracefully from `net === null` (show `0` /
  "—", not crash), and a freshly-opened site (e.g. example.com) legitimately summarizes to `0 trackers`.
  The behavior test accepts `0`/empty as a valid "summary derived from privacy data".
- Rationale: reuses data and rendering we already have; the popup is page-info, deferring the full
  permissions/cookies detail to the Shields panel (no duplication of Shields).
- Trade-off: the popup overlaps Shields conceptually; mitigated by keeping it a thin summary + link, not
  a re-implementation.

**DD6 — Internal-tab navigation lock (Chrome-style)**: On a `goldfinch-internal` tab, the address bar
does not free-browse: `navigate(input)` (`renderer.js:607`, invoked from the address-bar Enter handler
`:622`) **reroutes a web URL to a NEW normal tab** (`createTab(url)` on the default/web branch) instead
of `loadURL`-ing it into the internal webview; the internal tab stays on `goldfinch://settings`. The
internal tab's address bar is read-only / shows the internal URL non-editably (leg-design detail).
- Rationale: prevents the user from navigating an internal tab into a web page (the UX half of the
  Flight-4 latent finding — a web page running in the privileged internal session). Matches Chrome's
  "you don't browse the web from a settings tab."
- **Implementation specifics (Architect)**: make the internal-vs-web decision **after `toUrl(input)`**
  (`renderer.js:614`), not on raw input; identify the active internal tab via
  `tab.container.partition === window.goldfinch.internalPartition` (or `tab.container.id === 'internal'`,
  set at `renderer.js:390`). **Implement the read-only internal address bar concretely** (the internal
  tab's bar shows the internal URL non-editably) so the reroute path can't receive an internal/unsafe URL
  that `createTab(url)` untrusted would silently drop (`isSafeTabUrl` → null). Confirmed safe: trusted
  Settings-open (`createTab` direct, `:329`), `reload` (`:648`), and back/forward (`:631`/`:640`) do NOT
  route through `navigate()`, so the lock won't break them — only the address-Enter handler (`:622`) does.
- **`did-navigate-in-page` coordination**: in-page anchor nav (DD1) fires `did-navigate-in-page`
  (`renderer.js:566`), which rewrites `els.address.value` to `goldfinch://settings/#privacy`. Coordinate
  this with the read-only internal address display (DD6) so the anchor fragment doesn't desync the chip /
  the displayed internal URL.
- **Boundary note**: this is **UX hardening only**. The **security-critical** gate — the internal preload
  bridge refusing privileged IPC unless `location.origin` is `goldfinch://` — stays **Flight 6** (it only
  matters once real IPC lands; the bridge is inert `{version:1}` today). This flight does NOT touch the
  bridge.
- Trade-off: internal tabs lose generic browsing (intended); a deliberate special-case in `navigate()`.

**DD7 — Reconcile the duplicated APG keyboard contract into `menuController` (Flight-3 carry-forward
debt-paydown) — NOT forced by the popup**: The container (`renderer.js:244-268`) and kebab (`:350-374`)
menus carry **near-identical** Escape/Tab/Arrow/Home/End keydown blocks (~40 lines duplicated), and their
**trigger** keydowns (`:233`, `:341`) are likewise duplicated; only `focusItem` (`:291`) is shared.
Flight-3 Rec 1 deferred this hoist. **Important correction (Architect):** the site-info popup is **NOT a
roving-tabindex `role=menu`** — it's origin/connection text + a "Site settings →" link, so it does **not**
consume the Arrow/Home/End roving contract. So registering the popup does **not** force the hoist, and the
popup must **not** be contorted into a `role=menu` (that would re-incur the container's
`role=presentation`/`aria-required-children` issues, `renderer.js:185`). The popup needs only the
open/close/mutual-exclusion/outside-dismiss half — which `register` (`:124`) already provides — plus its
own **minimal** local keydown (Escape + Tab close + focus-return).
- What leg 1 does: reconcile the **two real menus'** (container + kebab) keydown + trigger-keydown blocks
  into a controller-level keydown parameterized by the registered `menu` + items-getter + restore-target.
  This discharges the Flight-3 debt while there are exactly 2 menu call sites to reconcile.
- Rationale: it's the right moment to pay the thrice-deferrable debt (we're already in `menuController`
  to register a 3rd, non-menu consumer); doing it keeps the controller honest.
- **Discretionary, not a hard gate**: because the popup doesn't depend on it, if the hoist destabilizes
  the passing `unified-tab-controls`/`tab-keyboard-operability`/`menu-dismissal`/`kebab-menu` suites
  beyond a clean reconcile, it can be **dropped** (the popup ships with its minimal local keydown
  regardless) — see Adaptation. Those suites are the leg's regression gate. Sequenced first (leg 1) so a
  destabilization is found before the rest of the flight builds.

**DD8 — Verification apparatus, premise-audited on BOTH axes (act + observe)**:
- *Act* — the `settings-shell` behavior test attaches to the running `:9222` via the committed
  `scripts/cdp-driver.mjs` (KEYS already has `Tab`/`Enter`/`Arrow*`/`Home`/`End` from Flights 1–2) or the
  Playwright MCP; **never the `chrome-devtools` MCP** (false pass). Drivable: kebab→Settings; keyboard
  through the sidenav (Tab to a nav link, Enter → section); clicking the address chip; **typing a web URL
  in an internal tab's address bar + Enter** (the lock test); opening the web chip popup on a web page.
- *Observe (cite the read path)* — **shell**: the served guest DOM (`<nav>` links, the 5 `<section>`s +
  their `<h2>`s, `aria-current` on scroll) read via a guest CDP attach + screenshot/a11y tree. **This
  read path is PROVEN (Flight-4 live)**: `npm run a11y -- --target=goldfinch://settings` found the guest
  in the flat CDP `/json` list and ran clean, and a direct CDP attach to the `goldfinch://settings` guest
  read its DOM + the served CSP. So the Architect's "guest may not surface in `/json`" concern is
  **retired** — the flat-list `findGuestTarget` works for this scheme. (A guest-reachability probe is
  still added to the behavior-test preconditions as belt-and-suspenders.) **chip**: the chip element + its
  state in the **chrome** renderer DOM
  (`#address-wrap`); **popup**: the popup element (open/close) + its summary text from `tab.privacy`;
  **lock**: tab count + partitions after the reroute (`document.querySelectorAll('webview')` partitions —
  a new `persist:goldfinch` tab appears, the internal tab unchanged) — all existing surfaces, **no new
  read path**. **a11y**: `npm run a11y` (chrome) + the **guest-target mode** (`--target=goldfinch://settings`,
  built Flight 4) on the shell.
- Rationale: both axes satisfied by existing surfaces; the Flight-4 guest read path + guest-axe mode are
  reused directly.
- Trade-off: rendered-vs-DOM for the shell relies on screenshots/a11y tree (already this project's
  primary evidence).

### Prerequisites
- [ ] App runs via `npm run dev:debug` (CDP `:9222`); a renderer target present; `scripts/cdp-driver.mjs`
  reaches it (`node scripts/cdp-driver.mjs eval '1+1'` → 2). **Not** the `chrome-devtools` MCP.
- [ ] `npm run a11y` operational, including the **guest-target mode** (`--target=`, Flight 4) against the
  `goldfinch://settings` guest.
- [ ] A reachable web page for the web-chip / lock tests (e.g. `https://example.com/` — opened via the
  control vector or directly).
- [ ] GUI/desktop runtime (Linux/WSL dev; macOS deferred to the standing mac HAT).

### Pre-Flight Checklist
- [x] All open questions resolved (or deferred with rationale)
- [x] Design decisions documented (DD1–DD8; codebase-validated, Architect → approve-with-changes, all
  incorporated)
- [ ] Prerequisites verified — live-environment items (`:9222`, cdp-driver, guest a11y mode, web page)
  verified at execution start (GUI the harness can't autonomously launch); the **CSP-subresource spike**
  (DD2) and the **`will-navigate`-vs-anchor** confirm (DD1) run at leg 2 / leg 3
- [x] Validation approach defined (`settings-shell` behavior test authored; apparatus premise-audited, DD8)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Hoist the menu keyboard contract first (precondition for the popup), extend the handler to serve
subresources, build the shell, then the address-bar surface (chips + lock) and the popup, then docs and
verify. The shell + serving are independent of the chip/popup/lock and could split (Adaptation).

- **`menucontroller-keyboard-hoist`** (leg 1): parameterize a controller-level APG keydown in
  `menuController` (`renderer.js:104`); reconcile the container (`:244`) + kebab (`:350`) **menu** keydown
  blocks AND their **trigger** keydowns (`:233`/`:341`) into it; regression the menu/tab suites.
  Discretionary debt-paydown (DD7) — drop if it destabilizes. (SC8; Flight-3 carry-forward)
- **`serve-internal-subresources`** (leg 2): **first the CSP-subresource spike** (serve one `settings.css`,
  confirm it loads with no CSP block — DD2); then extend `INTERNAL_PAGES` (`main.js:32`) + `handleInternal`
  (`:52`) to a per-host path allowlist with content-type by extension; keep traversal-proof, 404/405
  guarantees, and `INTERNAL_CSP` unchanged. Confirm the electron-builder `files: src/**/*` glob picks up
  the new `.css`/`.js` under `src/renderer/pages/`.
- **`settings-shell`** (leg 3): enrich `settings.html` into the sidenav + 5 titled sections + placeholder
  content; add `settings.css` (brand-matched) + optional `settings.js` (scroll-spy `aria-current`);
  accessible (landmarks, heading hierarchy, keyboard). (SC6, SC8)
- **`address-bar-chips-and-lock`** (leg 4): add the internal + web chips in `#address-wrap` (each with an
  `aria-label`, DD4), reflecting the active tab (`renderer.js` activate/navigate sync); lock internal-tab
  navigation in `navigate()` (`:607`, decision after `toUrl`) — web URL from an internal tab opens a new
  normal tab; read-only internal address bar. *(Fat leg — if the Flight-5b split is NOT taken, consider
  splitting chip-render from the lock.)* (flight-local; Flight-4 Known-Issue UX half)
- **`site-info-popup`** (leg 5): the web chip opens a `menuController`-registered popup with origin +
  connection + a `tab.privacy` summary + "Site settings →" → Shields; the internal chip shows a static
  secure-page note. (flight-local)
- **`docs`** (leg 6): README/CLAUDE.md — the settings shell, the subresource-serving model, the chips,
  the internal-tab lock; reference symbols/DD ids, no line numbers.
- **`verify-integration`** (leg 7): `settings-shell` behavior test; `npm run a11y` (chrome + guest-target
  on the shell); regress the menu/tab suites (DD7 surface) + `tab-scheme-guard` (the lock/serving touch
  the internal path); offline gates. (SC6, SC8)
- **`hat-and-alignment`** (leg 8, optional): guided HAT — feel the shell, chips, popup, and the lock.

### Checkpoints
- [ ] `menuController` owns the APG keydown; kebab + container menus still pass their suites.
- [ ] `goldfinch://settings/settings.css` (and `settings.js` if used) serve with correct content-types;
  non-allowlisted paths 404; CSP unchanged; the page renders styled.
- [ ] Settings shell: sticky sidenav + 5 titled sections + placeholder content; keyboard-navigable;
  a11y-clean on the guest.
- [ ] Internal chip on `goldfinch://`; web chip + site-info popup on `http(s)`; popup summary from
  `tab.privacy`; "Site settings →" opens Shields.
- [ ] Internal-tab lock: a web URL from a `goldfinch://` tab opens a NEW normal tab; the internal tab
  stays on settings.
- [ ] `settings-shell` behavior test passes; regressions intact; a11y + offline gates green.

### Adaptation Criteria

**Divert / split if**:
- The flight balloons past ~8 legs / 3 days → **split**: keep Flight 5 = the shell (legs 1–3) + verify,
  and spin the **address-bar chips + site-info popup + internal-tab lock** (legs 4–5) into a **Flight 5b**.
  The shell (SC6) is independently shippable; the chip/popup/lock are flight-local additions.
- The `menuController` hoist (DD7) destabilizes the passing menu/tab suites beyond a clean reconcile →
  reassess (worst case: keep the popup's keydown local as the container/kebab do today, deferring the
  hoist — but that re-incurs the duplication Flight 3 flagged).

**Acceptable variations**:
- Scrolling-sections vs a tabbed APG model (DD1); whether `settings.js` ships (scroll-spy only).
- Chip glyphs/wording; popup exact summary fields.
- `settings.css` token duplication vs a served shared-tokens file.

### Legs

> **Note:** Tentative; legs are created one at a time as the flight progresses.

- [x] `menucontroller-keyboard-hoist` - Hoist the APG keydown into `menuController`; reconcile container +
  kebab; regress menu/tab suites. (SC8)
- [x] `serve-internal-subresources` - Per-host path allowlist + content-type by extension in
  `handleInternal`; traversal-proof; CSP unchanged.
- [x] `settings-shell` - Sidenav + 5 titled sections + placeholder; `settings.css` (+ optional
  `settings.js`); accessible. (SC6, SC8)
- [x] `address-bar-chips-and-lock` - Internal + web chips reflecting the active tab; lock internal-tab
  navigation (web URL → new normal tab). (flight-local)
- [x] `site-info-popup` - `menuController` popup from the web chip (origin/connection/`tab.privacy`
  summary + "Site settings →" → Shields); internal chip static note. (flight-local)
- [x] `docs` - Settings shell + subresource serving + chips + internal-tab lock in README/CLAUDE.md.
- [x] `verify-integration` - `settings-shell` behavior test (12/12); a11y (chrome + guest) clean; menu/tab +
  `tab-scheme-guard` regressions intact; offline gates 182/182; DD2 CSP spike PASS. (SC6, SC8)
- [x] `hat-and-alignment` *(optional)* - Guided HAT: shell, chips, popup, lock. Operator-confirmed; 3 fixes
  inline (Shields internal-tab Connection + Cookies-race; semantic green/red address-bar lock).

---

## Post-Flight

### Completion Checklist
- [x] All legs completed (8/8)
- [ ] Code merged (draft PR #30, base `flight/4`; ready-for-review — merges after #29)
- [x] Tests passing (offline 182/182; live `settings-shell` 12/12; a11y chrome+guest clean)
- [x] Documentation updated (README + CLAUDE.md — leg 6)

### Verification

- **Behavior test `settings-shell`** (SC6, SC8) — kebab→Settings opens the shell; sticky sidenav with 5
  section links; 5 titled `<section>`s with placeholder content; keyboard-navigable (Tab to nav, Enter →
  section); internal-page chip on `goldfinch://`; web chip + site-info popup on `http(s)` (summary from
  `tab.privacy`, "Site settings →" opens Shields); internal-tab lock (web URL → new normal tab).
- **`npm run a11y`** — chrome baseline "no new violations" vs the pinned `ACCEPTED`, AND the guest-target
  mode on `goldfinch://settings` clean (the shell is the first real internal-page a11y surface).
- **Regression** — `menu-dismissal` / `kebab-menu` / `unified-tab-controls` / `tab-keyboard-operability`
  (the DD7 hoist surface) and `tab-scheme-guard` (the serving + lock touch the internal path) still pass.
- **Offline gates** — `npm test` / `npm run typecheck` / `npm run lint` green.
- **Manual** — anything CDP can't drive; macOS deferred to the mac HAT. Tune feel via the HAT leg.
