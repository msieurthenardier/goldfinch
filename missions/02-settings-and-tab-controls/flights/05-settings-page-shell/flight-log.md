# Flight Log: Settings Page Shell + Address-Bar Chips

**Flight**: [Settings Page Shell + Address-Bar Chips](flight.md)

## Summary
Flight `in-flight` (2026-06-07). Execution via `/agentic-workflow` (agentic crew: Developer + Reviewer).
Leg design reviewed per leg; code review + commit deferred to one pass after the last autonomous leg.
Execution notes, decisions, deviations, and anomalies appended here during the flight.

---

## Flight Director Notes

### 2026-06-07 — Flight start
- **Phase file**: loaded `.flightops/agent-crews/leg-execution.md` (well-formed: Crew / Interaction
  Protocol / Prompts all present). Crew: Developer (Sonnet, implement + design-review + fix + commit),
  Reviewer (Sonnet, never Opus). Accessibility Reviewer present but `Enabled: false`.
- **Branch decision**: `flight/4-internal-page-scheme` (PR #29) is **OPEN, not merged to main**. Flight 5
  builds directly on Flight 4's `goldfinch://` scheme + `handleInternal` (`main.js`) + internal preload —
  none of which is on `main`. Branched `flight/5-settings-page-shell` **stacked on the flight/4 tip**, not
  on main. When PR #29 merges, flight 5's PR rebases/retargets onto main. Recorded so a reviewer doesn't
  read the diff as "re-introducing Flight 4 code."
- **Planning baseline**: flight 5's planning artifacts (this flight dir, the `settings-shell` behavior-test
  spec, the mission.md flight-list/Known-Issues update) were uncommitted on the flight/4 tip; committed as
  the flight-5 planning baseline at branch start.
- **Leg sequencing**: following the flight's In-Flight order — leg 1 (menu hoist, sequenced first so a
  destabilization surfaces before the rest builds) → 2 (subresource serving, with the CSP spike) → 3
  (shell) → 4 (chips + lock) → 5 (popup) → 6 (docs) → 7 (verify). Leg 8 HAT is the interactive close.

### 2026-06-07 — Flight review + checkpoint commit (Phase 2d)
- **Offline gate sweep (integrated, post leg-6)**: `npm run lint` clean, `npm run typecheck` clean,
  `npm test` 182/182. Green.
- **Flight-level Reviewer** (Sonnet, fresh context, no developer-reasoning knowledge) reviewed the full
  uncommitted diff vs the planning baseline (`a6ebee5`) against all six legs' acceptance criteria, code
  quality, correctness (resolver traversal-proofing, the `navigate()` lock, popup null-safety, the menu
  hoist, CSP cleanliness, operator-identity leaks) and tests. Verdict: **[HANDOFF:confirmed]** — no blocking
  issues. One non-blocking note (tracker/permission counts injected without `escapeHtml` — safe, they're
  `?? 0` numbers, never strings). No fix cycle needed.
- **Checkpoint commit**: committed legs 1–6 (code + docs + artifacts) as a **reviewed implementation
  checkpoint**. Leg statuses kept at **`landed`** (not `completed`) and the flight kept **`in-flight`** —
  because this flight's acceptance is **live** (leg-7 behavior test / guest a11y / regression suites / the
  DD2 CSP spike) plus the leg-8 HAT, none of which the agentic harness can run (it can't launch the Electron
  GUI). Those are operator-gated. Legs flip to `completed` + flight `landed` only after live verification +
  HAT pass; any live failure is fixed in a **new** commit (no amend), per the skill.
- **PR deferred**: flight/5 is stacked on the **unmerged** flight/4 (PR #29). The draft-PR base is a real
  choice (base=flight/4 for a clean diff vs base=main which folds in #29's commits) — deferred to the
  operator handoff alongside the live verification.

---

## Leg Progress

### 2026-06-07 — `menucontroller-keyboard-hoist` — LANDED

**Status**: landed

**Changes made:**
- `src/renderer/renderer.js` — extended `MenuEntry` typedef with optional `items?: () => HTMLElement[]`
- Extended `register(...)` inside the `menuController` IIFE to attach per-entry trigger-keydown and
  menu-keydown listeners at registration time (per-element attach, not document-level)
- Added `items: containerItems` to the container `register({...})` call
- Added `items: kebabItems` to the kebab `register({...})` call
- Deleted the four duplicated inline keydown listeners: container menu-keydown, container `▾`
  trigger-keydown, kebab menu-keydown, and kebab `⋮` trigger-keydown
- Kept `closeContainerMenu` / `closeKebabMenu` as distinct thin wrappers (no collapse)
- Kept the kebab click toggle, all `onOpen`/`onClose` bodies, and the pointerdown/blur
  outside-dismiss listeners exactly as-is
- Updated the now-stale kebab section comment
- Net: 55 lines added, 76 lines deleted → net −21 lines in `renderer.js`

**Hoist decision: LANDED cleanly.**
- `npm run lint` — green
- `npm run typecheck` — green
- `npm test` — 161/161 tests pass
- No structural issues; the `focusItem` hoisted function declaration is reachable by closure from
  inside the IIFE as specified (not converted to const)
- All four live regression suites (`unified-tab-controls`, `tab-keyboard-operability`,
  `menu-dismissal`, `kebab-menu`) require the running app on CDP `:9222` and are batched into the
  verify-integration leg — not run here per leg spec

---

### 2026-06-07 — `serve-internal-subresources` — LANDED

**Status**: landed

**Changes made:**
- `src/main/internal-assets.js` (new) — pure CommonJS module (no Electron, no `__dirname`); exports
  `contentTypeFor(file)` (extension-to-Content-Type; `.html`/`.css`/`.js` + conservative
  `application/octet-stream` default) and `createResolver(map)` → `resolve(host, pathname)` →
  `{ file, contentType } | null`. Traversal-proof: file path comes from the fixed map value, never
  built from `pathname`. Normalizes `'' → '/'`. Case-sensitive exact-match; mismatches return `null`.
- `src/main/main.js` — imported `createResolver` from `./internal-assets`; changed `INTERNAL_PAGES`
  from `{ settings: <html-path> }` to `{ settings: { '/': <html-path>, '/settings.css': <css-path> } }`;
  added `const resolveInternal = createResolver(INTERNAL_PAGES)` at startup; reworked `handleInternal`
  to call `resolveInternal(url.host, url.pathname)` (null → 404; hit → `net.fetch` re-wrapped with
  `resolved.contentType` + unchanged `INTERNAL_CSP`); removed the old `rootPath` check.
- `src/renderer/pages/settings.css` (new) — minimal brand-token stylesheet (`:root` with
  `--accent:#f5c518`, `--accent-fg:#1e1f25`, `--bg:#1e1f25`, `--fg:#e8e8ec`; `body` background rule);
  serves as proof-of-path for the subresource handler. Leg 3 enriches.
- `src/renderer/pages/settings.html` — added `<link rel="stylesheet" href="settings.css" />` (relative
  href → resolves to `goldfinch://settings/settings.css`).
- `test/unit/internal-assets.test.js` (new) — 21 tests covering `contentTypeFor` (`.html`, `.css`,
  `.js`, unknown, no-ext, uppercase extension) and `resolve` (allowlisted paths `/`/`''`/`/settings.css`/
  `/settings.js`; traversal/garbage → null for `/../main.js`, `/settings.css/../x`, `/settings.css/`,
  `//settings.css`, `/nope`, `/SETTINGS.CSS`, `/Settings.css`; unknown/empty host → null; two-host
  isolation).

**Builder glob confirmed:** `package.json` `build.files: ["src/**/*", "package.json"]` with `asar: false`
covers the new `src/renderer/pages/settings.css` (and any future `settings.js`) unpacked in dev and
packaged builds alike. No config change needed or made.

**Offline gates:**
- `npm run lint` — green (no ESLint findings)
- `npm run typecheck` — green (no tsc errors)
- `npm test` — **182/182 pass** (161 existing + 21 new `internal-assets` tests)

**Live CSP spike carried to leg 7:** That `default-src 'self'` admits a `goldfinch://` subresource on a
`{standard, secure}` scheme is very likely but unproven in this codebase. The live confirmation (no
`securitypolicyviolation`, stylesheet applies) is batched into leg 7's live verification (which runs the
app on `:9222` regardless). The fallback — adding an explicit `style-src 'self'; script-src 'self'` to
the served CSP (no `'unsafe-inline'`) — is a one-line change to `INTERNAL_CSP` in `main.js`.

### 2026-06-07 — `settings-shell` — LANDED

**Status**: landed

**Changes made:**
- `src/renderer/pages/settings.html` — rewrote body: `<nav aria-label="Settings sections">` with
  `<ul role="list">` of five `<li><a href="#…">…</a></li>` links; `<main>` with `<h1>Settings</h1>`
  as first child followed by five `<section id="…"><h2>…</h2><p>…placeholder…</p></section>`.
  Section ids in document order: `appearance`, `privacy`, `startup`, `downloads`, `about`. Added
  `<script src="settings.js" defer></script>`. Zero inline style/script/on* handlers — CSP compliant.
- `src/renderer/pages/settings.css` — enriched into Chrome-style shell layout: corrected `--fg` to
  `#e6e7ea` (was `#e8e8ec` from leg 2); added `--fg-dim:#9a9ca6`, `--bg-2`, `--bg-3`, `--border`;
  flex row layout with `<body>` as the scroll container (no `overflow:auto` on `<main>`, avoiding
  `scrollable-region-focusable` axe finding); sticky left `<nav>` (`position:sticky; top:0; height:100vh`);
  nav link hover + `:focus-visible` ring + `[aria-current]` highlight; `scroll-margin-top` on sections;
  `h1`/`h2` type scale; placeholder text at `--fg-dim` (#9a9ca6 on #1e1f25 ≈ 4.55:1, meets WCAG AA);
  smooth scroll gated behind `prefers-reduced-motion: no-preference`.
- `src/renderer/pages/settings.js` (new) — scroll-spy progressive enhancement: `IntersectionObserver`
  sets `aria-current="true"` on the nav link of the in-view section; removes it from others. No other
  behavior. Page fully navigable without it (native anchors carry navigation).
- `src/main/main.js` — added `'/settings.js': path.join(__dirname, '..', 'renderer', 'pages', 'settings.js')`
  to the `INTERNAL_PAGES` `settings` host map (alongside `/` and `/settings.css`).

**settings.js shipped:** Yes. Map entry added to `INTERNAL_PAGES`. The `internal-assets` unit test
already covered `/settings.js` in the synthetic map (leg-2 test) — no new test code added; confirmed
the real map now matches.

**Live render + guest a11y + CSP spike:** Carried to leg 7 per spec. The `npm run a11y --
--target=goldfinch://settings` guest audit and the DD2 CSP-subresource live confirm (no
`securitypolicyviolation`, `settings.css` and `settings.js` load) are batched into leg 7's live
verification (which runs the app on `:9222`).

**Offline gates:**
- `npm run lint` — green (no ESLint findings)
- `npm run typecheck` — green (no tsc errors)
- `npm test` — **182/182 pass** (count unchanged — internal-assets tests already covered `/settings.js`;
  no new test code added or needed)

### 2026-06-07 — `address-bar-chips-and-lock` — LANDED

**Status**: landed

**Changes made:**
- `src/renderer/index.html` — added `<button id="address-chip" class="addr-chip" type="button" aria-label="Site information"></button>` inside `#address-wrap`, before `#address`.
- `src/renderer/renderer.js`:
  - Added `addressChip: document.getElementById('address-chip')` to the `els` map (after `kebabMenu`).
  - Added `isInternalTab(tab)` helper: checks `tab.container.id === 'internal'` or `tab.container.partition === window.goldfinch.internalPartition`.
  - Added `updateAddressChip(tab)`: neutral default for `!tab` / empty / `about:blank`; `data-state="internal"` + `aria-label="Secure Goldfinch page"` + `readOnly=true` for `isInternalPageUrl(url)`; `data-state="web"` + `aria-label="Site information, {host}"` + `readOnly=false` for web tabs; try/catch around `new URL(url).host` (unparseable → neutral default). Folds in the `applyAddressEditable` concern (no separate function needed).
  - Called `updateAddressChip(tab)` from `activateTab` (next to `els.address.value = tab.url`), from `onNav` (`did-navigate`), and from the `did-navigate-in-page` handler — every address-sync site.
  - Added internal-tab navigation lock in `navigate()`: after `const url = toUrl(input)`, if `isInternalTab(tab)` → if `!isInternalPageUrl(url)` call `createTab(url)` (new normal tab, untrusted/web branch) then return; else return (belt-and-suspenders no-op). Non-internal tabs fall through to existing `loadURL` behavior unchanged.
- `src/renderer/styles.css`:
  - Changed `#address-wrap` to `display:flex; align-items:center; position:relative`.
  - Added `.addr-chip` styling: `position:absolute; left:7px; top:50%; transform:translateY(-50%)`; 28×28px; neutral lock-glyph via `::before`/`::after` pseudo-elements; `[data-state='internal']` keyed to a diamond/secure mark in secure green (`#6dff8f`); `[data-state='web']` keeps the neutral lock color (`--fg-dim`).
  - Added `padding-left:40px` to `#address` to make room for the chip.
  - Added `#address[readonly]` subtle cue: `background:var(--bg-2); cursor:default; color:var(--fg-dim)`.

**Notes:**
- Chip **click behavior is leg 5** — chip is intentionally left unwired here; no placeholder handler added.
- Lock + read-only address bar land here; live verification (open Settings → chip shows; type web URL in internal tab → new tab opens; a11y clean) deferred to leg 7.
- `readOnly` only blocks user keyboard input; programmatic `els.address.value = …` in `onNav` / `did-navigate-in-page` still works — no toggling-off needed around existing syncs.
- `isInternalPageUrl` confirmed to return `true` for fragmented internal URLs (`goldfinch://settings/#startup`) — fragment is in `.hash`, not `.pathname`; chip stays internal across anchor nav.

**Offline gates:**
- `npm run lint` — green (one `no-useless-assignment` on initial `let host = ''` fixed by removing the initializer)
- `npm run typecheck` — green
- `npm test` — **182/182 pass** (count unchanged — no new unit tests; renderer changes are DOM-level, not unit-testable offline)

### 2026-06-07 — `site-info-popup` — LANDED

**Status**: landed

**Changes made:**
- `src/renderer/index.html`:
  - Added `<div id="site-info-popup" class="site-info-popup hidden" role="dialog" aria-label="Site information" tabindex="-1"></div>` after `#kebab-menu`, with the other chrome popups.
  - Added `aria-haspopup="dialog"` to the existing `#address-chip` button.
- `src/renderer/renderer.js`:
  - Added `siteInfoPopup: document.getElementById('site-info-popup')` to the `els` map.
  - Added `positionSiteInfoPopup()`: left-anchors the popup under the chip (`left = chipRect.left`, `top = chipRect.bottom + 4`, `right = 'auto'`).
  - Added `buildSiteInfo(tab)`: branches on `isInternalTab(tab)` / `isInternalPageUrl(tab.url)` — internal → static "secure Goldfinch page" note; web → host (try/catch → `'—'`), connection (HTTPS/HTTP from protocol), trackers (`tab.privacy?.net?.trackers?.blocked ?? 0`), permissions (`tab.privacy?.permissions?.length ?? 0`) + a "Site settings →" `<button class="text-btn small si-settings-btn">` whose click calls `closeSiteInfo(); togglePrivacy(true)`. Host passed through `escapeHtml`.
  - Registered `siteInfoEntry` via `menuController.register({ trigger: els.addressChip, menu: els.siteInfoPopup, onOpen, onClose })` — NO `items` getter (controller's roving keydown no-ops it per DD7).
  - `onOpen`: calls `buildSiteInfo(activeTab())`, removes `hidden`, calls `positionSiteInfoPopup()`, focuses first `button`/`a` (web) or the popup container (internal).
  - `onClose`: adds `hidden`.
  - Added `closeSiteInfo()` thin wrapper → `menuController.close(siteInfoEntry)`.
  - Wired `els.addressChip.addEventListener('click', …)`: toggles popup (if `menuController.current === siteInfoEntry` → close, else → open). This is the chip click handler leg 4 intentionally left off.
  - Added `els.siteInfoPopup.addEventListener('keydown', …)`: Escape or Tab → `e.preventDefault(); closeSiteInfo(); els.addressChip.focus()`. No Arrow/Home/End (not a menu). This is the only Escape/Tab handler — the controller's menu-keydown early-returns on `!entry.items`.
- `src/renderer/styles.css`:
  - Added `.site-info-popup` block: `position:absolute; z-index:60; background:var(--bg-3); border:1px solid var(--border); border-radius:8px; padding:10px 12px 8px; min-width:220px; max-width:320px; box-shadow:0 8px 24px rgba(0,0,0,0.5); outline:none`. Focus ring via `:focus-visible` (2px solid `var(--accent)`).
  - Added `.si-section`, `.si-row`, `.si-host`, `.si-secure`, `.si-label`, `.si-value`, `.si-actions` helpers for the popup's content layout (flex column, label/value rows, action row).

**Notes:**
- `tab.privacy.net === null` guard: optional chaining + `?? 0` on both tracker and permission counts — gracefully renders `0` from the pre-IPC null state, never crashes. A fresh site legitimately shows `0 trackers`.
- Mutual exclusion and outside-click/blur dismiss are free via the shared `menuController` (opening the popup closes any open kebab/container menu and vice versa).
- Live verification (chip click → popup; web/internal branches; Escape/outside-click dismiss; mutual-exclusion with kebab; "Site settings →" opens Shields; a11y) deferred to leg 7 per spec.

**Offline gates:**
- `npm run lint` — green
- `npm run typecheck` — green
- `npm test` — **182/182 pass** (count unchanged — no new unit tests; changes are DOM-level)

### 2026-06-07 — `docs` — LANDED

**Status**: landed

**Changes made:**
- `README.md`:
  - **Features — Overflow menu bullet**: updated the Settings description to name `goldfinch://settings`
    and describe the Chrome-style shell (sticky section-nav, five titled sections, placeholder controls).
  - **Features — new Address-bar chips bullet**: describes the `#address-chip` (internal identity chip vs.
    web site-info chip + popup), the read-only address bar on internal tabs, and the neutral blank-tab state.
  - **Features — new Internal-tab navigation lock bullet**: describes the `navigate()` lock — web URL in
    an internal tab opens a new normal tab instead.
  - **Architecture — Internal pages section**: expanded to describe the settings shell layout, the
    per-host path allowlist serving model (traversal-proof, content-type by extension), and notes the
    address-bar chip and security model pointer to `CLAUDE.md`.
- `CLAUDE.md`:
  - **Internal `goldfinch://` pages — CSP bullet**: split off a new **Subresource-serving model** bullet
    documenting `INTERNAL_PAGES` as `host → pathname → file` map, `createResolver`/`contentTypeFor` in
    `src/main/internal-assets.js`, traversal-proof guarantee, `INTERNAL_CSP` unchanged, and the unit-test
    coverage in `test/unit/internal-assets.test.js`.
  - **Address-bar chip + read-only address bar bullet** (new): documents `updateAddressChip(tab)`,
    `data-state` values, `readOnly` toggling, `#address-chip` / `#site-info-popup` wiring via
    `menuController` (no `items` getter), and the popup's own Escape/Tab keydown handler.
  - **Internal-tab navigation lock bullet** (new): documents the `navigate()` UX lock in `renderer.js`
    and **explicitly flags that the security-critical bridge origin-check is a Flight-6 TODO** — the lock
    is UX-only; internal pages are not yet fully isolated from web-origin code.
  - **"When adding an internal page" line**: updated `host → file` to `host → pathname → file` to match
    the landed `INTERNAL_PAGES` shape.

**Offline gates:**
- `npm run lint` — green (ESLint, no findings)
- No source/behavior changes — docs only; `git diff` would show only `README.md` / `CLAUDE.md`.

---

### 2026-06-07 — `verify-integration` — LANDED (live, Flight-Director-driven)

**Status**: landed

**What ran** (app launched in-harness via `npm run dev:debug` on CDP `:9222` — the harness CAN launch the
GUI; driven via `scripts/cdp-driver.mjs` + a node-CDP attach to the `goldfinch://settings` guest, which
surfaces as `type: webview` in the flat `/json` list; the `chrome-devtools` MCP was NOT used):

- **Offline gates (integrated)**: `npm run lint` / `npm run typecheck` clean; `npm test` **182/182**.
- **`settings-shell` behavior test**: **12/12 PASS** — run log at
  `tests/behavior/settings-shell/runs/2026-06-07-18-07-42.md`; spec promoted `draft → active`. Covers the
  shell DOM (5 nav ↔ 5 sections, h1, sticky labelled nav), keyboard/anchor nav + chip coherence, the
  internal/web chips, the site-info popup (origin/connection/`0`-trackers-graceful/"Site settings →" →
  Shields), the internal-tab lock (count +1, settings tab unchanged), and Escape/outside-click/
  mutual-exclusion dismissal.
- **DD2 CSP-subresource spike — CONFIRMED PASS** (see Deviations, now resolved): `settings.css` applied
  (`body` computed bg `rgb(30,31,37)`) and `settings.js` executed (scroll-spy set `aria-current`), both
  served same-origin under the **unchanged** `INTERNAL_CSP`. No fallback needed.
- **a11y (SC8)**: `npm run a11y` (chrome) and `npm run a11y -- --target=goldfinch://settings` (guest) both
  **No NEW violations** vs the pinned `ACCEPTED` baseline — after the `role="search"` fix (see Anomalies).
- **Regressions (live spot-checks)**: kebab + container menu keyboard contract intact after the leg-1 hoist
  (open-to-first/last, Arrow/Home/End, Escape + focus-return) → `kebab-menu` / `unified-tab-controls` /
  `tab-keyboard-operability` / `menu-dismissal` core. `tab-scheme-guard` core invariant: a web origin's
  `window.open('goldfinch://…')` + `<iframe src="goldfinch://…">` created **no** internal tab and caused no
  web-tab navigation (internal tab count unchanged) — boundary survives the leg-2 serving + leg-4 lock.
  Full 13-vector `tab-scheme-guard` not re-run (flight 5 left `isSafeTabUrl` / `will-navigate` / the
  trusted-embedder path / internal CSP untouched — reviewer-confirmed; covered by `url-safety.test.js` +
  flight-4's 13/13).

**SC6 + SC8 verified.** One a11y regression found and fixed mid-leg (Anomalies). `role="search"` source fix
applied (`index.html`), reloaded-from-disk, chrome a11y re-confirmed clean.

**Note on apparatus**: this leg was Flight-Director-driven (cdp-driver + node-CDP), not the two-live-agent
Witnessed crew — every verdict cites a raw machine-read value (DOM/computed-style/partition/ARIA/audit exit)
rather than model judgment. See the run log's Orchestrator Notes for the deviation + compensating control.

---

## Decisions

### Per-leg design review skipped for the docs leg (leg 6)
**Context**: Legs 1–5 each got a Developer design-review pass before implementation (per the agentic-workflow
protocol). Leg 6 is **docs-only** (`README.md` / `CLAUDE.md`) — there are no acceptance criteria to
cross-reference against codebase state, which is the design review's primary value.
**Decision**: The Flight Director folded leg 6's review into the **flight-level Reviewer pass** (which
reviews the entire uncommitted diff, docs included, against the landed code) rather than spawning a separate
per-leg design-review round.
**Impact**: One fewer agent round-trip; doc accuracy is still adversarially checked at flight review before
commit. Legs 1–5 and leg 7 keep the standard per-leg design review.

---

## Deviations

### DD2 CSP-subresource spike — live-confirm deferred from leg 2 to leg 7
**Planned**: DD2 sequences the CSP-subresource spike at **leg 2, before leg 3 builds on it** — serve one
`settings.css` and confirm live (no `securitypolicyviolation`, stylesheet applies) before the shell assumes
same-origin subresources work.
**Actual**: The spike's *implementation* (serve `settings.css` via the path allowlist, structured so the
CSP fallback is a one-line change) lands in leg 2; the *live confirmation* is **batched into leg 7's live
verification** (which runs the app on `:9222` regardless). Leg 3 proceeds on the architectural prior.
**Reason**: The agentic harness cannot autonomously launch the Electron GUI, and this flight already defers
*all* live verification to leg 7 / the HAT. The risk is low — `default-src 'self'` admitting a same-origin
`goldfinch://` subresource on a `{standard, secure}` scheme is exactly what `'self'` covers — and DD2's
fallback (per-page `style-src 'self'; script-src 'self'`, no `'unsafe-inline'`) is cheap if the live check
ever fails. Recorded so leg 3's reliance on served CSS is a known, accepted prior, not an oversight.
**RESOLVED at leg 7 (2026-06-07)**: live spike **PASSED** — `settings.css` applied + `settings.js` executed
under the unchanged `INTERNAL_CSP`; no fallback needed. The architectural prior held.

---

## Anomalies

### `region` a11y regression on `#address` — the chip exposed an un-landmarked address bar (FIXED)
**Observed**: at leg-7 chrome a11y, **4 NEW** axe `region` violations ("All page content should be contained
by landmarks") on `#address`, in all four audit states (base-chrome / media-panel / privacy-panel /
lightbox). DD4 had assumed `#address-wrap` was already in the pinned `ACCEPTED` baseline; it was not (the
baseline only accepts `#tabs` / `#brand`). Adding the `#address-chip` button inside `#address-wrap` (leg 4)
surfaced the wrap's contents as un-landmarked.
**Severity**: degraded (new WCAG A/AA region findings — would fail SC8's "no new violations" gate).
**Resolution**: added `role="search"` to `#address-wrap` in `src/renderer/index.html` (the address bar is
semantically a search/address landmark; it now wraps both the chip and the input). Validated live (DOM patch
→ 0 NEW), then persisted to source, reloaded-from-disk, and re-audited: **chrome a11y No NEW violations**.
`#address` already carries `aria-label="Address and search bar"`, which serves as the landmark's accessible
name (no duplicate label added). Offline gates stayed green (182/182). Fixed in the leg-7 commit.

### Settings shell stub doesn't visibly scroll (by design — not a defect)
**Observed**: with placeholder content, all five sections fit the viewport (`scrollY` stays `0`), so
activating a nav anchor doesn't visibly scroll and the scroll-spy reports the topmost section.
**Severity**: cosmetic.
**Resolution**: not a defect — this is DD1's documented "all sections render at once (fine for a stub)"
trade-off. Flight-6's real controls will grow the content and engage scrolling. Noted in the run log so a
future runner doesn't read no-scroll as a failure.

---

## Session Notes

_(none yet)_
