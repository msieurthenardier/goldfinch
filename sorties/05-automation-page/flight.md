# Sortie: Automation Page

**Status**: in-flight

## Charter

### Outcome
The operator manages the MCP automation surface — enable toggle, address/port, MCP config, per-jar keys, admin key, activity log — on its own `goldfinch://automation` page, opened from a new **Automation** item in the kebab (⋯) menu directly above **Vault**, with short hints saying where to create a new jar and where to get a jar's vault access key.

### Why Now
Automation is a distinct concern from browser preferences and has crowded the Settings page; the operator also wants the two "where do I get…" answers on the page where the question arises.

### Success Criteria
- [ ] The kebab menu shows **Automation** directly above **Vault**; activating it opens `goldfinch://automation` as a trusted internal tab
- [ ] Every Automation control behaves on the new page exactly as it did in Settings, and Settings no longer has an Automation section (nor a nav entry for one)
- [ ] The page carries a plain-text hint pointing to Cookie jars for creating a new jar, and one pointing to Vault → the jar's Access keys for minting a vault access key
- [ ] Docs and behavior specs that direct readers to Settings → Automation point at the new page

### Constraints
- Full internal-page onboarding checklist (CLAUDE.md "Adding an internal page"): route map, `INTERNAL_HOSTS`, `INTERNAL_ORIGINS` in BOTH `internal-ipc.js` and `internal-preload.js`, trusted `createTab` open path, ESLint module-`sourceType` page entries
- No change to automation behavior, key handling, IPC channels/semantics, or the internal trust model ("internal vs web", never per-page)
- Hints are plain text — no new internal→chrome "open page" channel (operator ruling)

---

## Pre-Flight

### Objective
Lift the Automation section (markup, controller code, page-specific CSS) out of `goldfinch://settings` into a new trusted internal page `goldfinch://automation` with the same sidebar shell as Settings, add a kebab item above Vault that opens it, add the two hint lines, and retarget the docs/behavior specs. Because `renderer.js` sits at its zero-headroom line budget (1546/1546), the kebab action table moves out of `renderer.js` into `overlay-menus.js` first, so the new item lands with a net line reduction.

### Open Questions
- [x] Hints plain text or clickable? → plain text (operator; DD5)
- [x] What remains in Settings? → nothing; section and nav entry removed (operator; DD4)
- [x] Page layout? → sidebar shell like Settings (operator; DD3)
- [x] Hint copy? → as proposed (operator; DD5)
- [x] HAT leg? → yes (operator)
- [x] Where does the kebab action land given the renderer budget? → extracted into `overlay-menus.js` (DD2)

### Design Decisions

**DD1 — New internal host `automation`, full onboarding, plus an origin drift guard**: add `automation` to `INTERNAL_HOSTS` (`src/shared/url-safety.js`), `'goldfinch://automation'` to `INTERNAL_ORIGINS` in `src/main/internal-ipc.js` AND `src/preload/internal-preload.js`, and an `automation` entry in `internal-page-map.js` serving `/`, `/automation.css`, `/automation.js`, `/settings.css` (shared shell, DD3), `/section-scroll-spy.js` (DD3), `/audit-paging.js`, `/safe-color.js`. Add `src/renderer/pages/automation.js` and `section-scroll-spy.js` to `eslint.config.mjs`'s explicit module file list.
- Rationale: the page needs the same internal bridge the Settings Automation section uses today; every bridge method it calls is gated by `registerInternalHandler` (origin + `__goldfinchInternal`) or is a bare read-only `ipcMain.handle` (`automation:get-activity`, `settings-get`) — both host-agnostic. Pushes (`settings-changed`, `automation-activity-changed`) go through `broadcastToChromeAndInternal`, which walks every internal-session contents — host-agnostic. The internal session's `protocol.handle` serves any host in the map, stamping `INTERNAL_CSP` in the response, so no handler changes.
- **Chrome-side host enumerator** (design review 1): `src/renderer/chrome/tab-controller.js`'s `INTERNAL_JAR_NAMES` (`{settings, downloads, jars, vault}`, fallback `'Settings'`) names the internal tab's container dot tooltip and the automation-indicator fallback. Add `automation: 'Automation'` plus a case in `test/unit/tab-controller.test.js` (the `'Cookie Jars'` precedent) asserting the exact string `'Automation'`; that test's `isInternalPageUrl` fake (~123, regex `(settings|downloads|jars|vault)`) must gain `automation`, else the case never reaches `getContainerName` and passes vacuously via the `'Settings'` fallback (design review 2). Stale comment-only host lists (`internal-ipc.js` ~20, `internal-preload.js` ~20, `url-safety.js` ~79) are refreshed in passing. Also update the four-origin comment in `src/renderer/renderer-globals.d.ts` (~640). `chrome-recovery.js` derives names from the URL host and session restore (`main.js` ~2150/~2813) uses `isInternalPageUrl` — both follow `INTERNAL_HOSTS` automatically.
- No existing test asserts the origin/host lists and the map keys agree (grep: none). A missed origin fails CLOSED (the page's bridge calls reject), but silently. Add a source-scan drift guard: `INTERNAL_HOSTS` set === map keys === host part of `INTERNAL_ORIGINS` (main, literal `new Set([...])` regex) === `INTERNAL_ORIGINS` (preload, same) === `INTERNAL_JAR_NAMES` keys (tab-controller); throws, never passes vacuously, neuter-verified. Per-host unit cases: `isInternalPageUrl('goldfinch://automation')` in `url-safety.test.js`, `isTrustedInternalSender('goldfinch://automation', …)` in `internal-ipc.test.js`.
- Dev bundle: `internal-preload.bundle.js` is gitignored and rebuilt by `build:preload` (`dev-launch.mjs`, `pretest`) — never hand-edited.
- Trade-off: a fifth equally-privileged internal origin — accepted; the trust boundary is internal vs web by design.

**DD2 — Kebab item via extraction out of `renderer.js`**: move the seven `kebabAction*` bodies and the `KEBAB_ACTIONS` table (`renderer.js` ~374–405) into `createChromePageActions` in `src/renderer/chrome/overlay-menus.js` (which already owns `openDownloads`/`openJarsPage`/`openVaultPage`), exposed as a `kebabActions` map; add `openAutomationPage()` (`createTab('goldfinch://automation', null, { trusted: true })`) and the `automation: …` action. `buildKebabModel()` gains `{ id: 'automation', label: 'Automation' }` immediately before `{ id: 'vault', … }`. `renderer.js` passes `pageActions.kebabActions` to `createOverlayDispatch` (constructed at ~956, after `pageActions` is assigned at ~544 — TDZ-safe; leg design re-verifies). Any new deps (`windowCreate`/`print`/`appQuit` via `window.goldfinch`) come from the factory's existing `window` dep.
- Rationale: `renderer.js` is at 1546/1546 and "a file at budget needs an extraction, not a compaction" (sortie 01 rec. 3 flagged this). The page-actions factory is the natural owner and is already unit-tested.
- **Seam wrapper kept (design review 1)**: `kebabActionSettings` IS a seam entry (`renderer.js` seam tail, "dogfooding"), driven by name via `evaluate("kebabActionSettings()")` in `welcome-home-routing.md`, `sqlite-store-migration.md`, `third-party-cookie-isolation.md`. `renderer.js` keeps a thin hoisted `function kebabActionSettings() { return pageActions.kebabActions.settings(); }` (the `openJarsPage` wrapper precedent, ~334–350) so the seam name list and `SEAM_COUNT` (41) are **unchanged** — pinned by `seam-contract.test.js` passing untouched (the only seam pin; no second pin on the wrapper body — its behavior is covered by the `settings` action unit test).
- Expected landing: ~1517 lines (−~29) — the six bodies, `@type` line and table (~374–405) go, the wrapper adds ~3. The stale comment block above them (~361–373: "seven", "Passwords") is refreshed or trimmed. The budget retarget lands **in the same change** as the `renderer.js` edit so the zero-headroom test is never red mid-leg.
- `openAutomationPage` is a plain `createTab` (no tab reuse), matching Downloads/Jars/Vault; `isSettingsUrl`'s reuse logic stays settings-only.
- `createOverlayDispatch`'s dep keeps its name/shape (`KEBAB_ACTIONS: pageActions.kebabActions`) so `overlay-dispatch.test.js` (~147, ~207–215) needs no change; if the Developer renames the dep, those tests update in the same change.
- **TDZ order pin**: `pageActions` is `let`-declared (~108), assigned (~544), and read at `createOverlayDispatch` (~956). Add a source-scan assertion that the assignment line precedes the construction line (regex-target, neuter-verified).
- **Moved-action tests**: each moved action gets a unit test in `overlay-menus.test.js`; the harness (~160–165) stubs `window` without `goldfinch`, so tests supply `window.goldfinch.{windowCreate,print,appQuit}` fakes. Print keeps its `!isInternalTab(t) && t.wcId != null` guard.
- Drift guard: every non-separator `buildKebabModel()` id has a `kebabActions` entry and vice versa. Update `overlay-menus.test.js` ~296–310 (id order + separator layout; fix its stale "after Passwords" comment).
- `RENDERER_LINE_BUDGET` (`test/helpers/renderer-line-budget.js`) is retargeted to the landed count measured with the pinned convention `split(/\r?\n/).length` (not `wc -l`, which reads one lower). The stale `buildKebabModel` header comment ("Settings…Secrets" band) is updated to name the real band.
- Trade-off: a small mechanical move in the composition root alongside the feature — accepted; it is the minimum that keeps the budget invariant.

**DD3 — Page shell reuses Settings' shell; scroll-spy and nav selector generalized**: `automation.html` mirrors `settings.html`'s structure: left `<nav class="section-nav" aria-label="Automation sections">` with anchors **Connection** / **Keys** / **Activity**, `<main>` with `<h1>Automation</h1>` and three `<section>`s. It links `settings.css` (shell + shared controls) then `automation.css` (automation-only rules moved verbatim out of `settings.css`: `#automation-port`, `.connect-hint`, `.mcp-config-block`, the robot glyph, `#automation-key-reveal`, `#automation-admin`, `.activity-*` — a rule moves only if no selector in the remaining `settings.html` needs it; Developer greps each).
- `settings.css`'s `nav[aria-label='Settings sections']` selectors retarget to `nav.section-nav` (Settings' nav gains the class; its aria-label is unchanged) so both pages share the shell without a mislabelled landmark.
- The scroll-spy IIFE (`settings.js` ~61–124) is extracted verbatim to `src/renderer/pages/section-scroll-spy.js` (`export function initSectionScrollSpy()`, nav query `nav.section-nav a[href^="#"]`), imported by both `settings.js` and `automation.js` via flat specifier and routed on both hosts.
- The scroll-spy module takes its DOM/`IntersectionObserver` as injected deps (the `vault-filter-controller.js` pattern) and gets a unit test against a mock DOM.
- Pin (design review 1): a unit source-scan asserts both pages' `<nav>` carry `class="section-nav"` and that no `Settings sections` attribute selector remains in `settings.css` — a missed selector would silently unstyle the Settings nav. (No test, a11y script, or spec pins the old selector/label — grep-clean.)
- Rationale: native look, no CSS duplication, one scroll-spy.
- Shared-mechanism non-regression (project rule): Settings' nav styling and `aria-current` scroll-spy are unaffected — asserted in the live smoke and HAT.

**DD4 — Settings loses the Automation section entirely**: remove `<section id="automation">` and its nav `<li>`; remove the three automation IIFEs, `automationKeysOnce`, and `copyText` (automation-only — grep-verified: no non-automation use) from `settings.js`, plus the now-unused `audit-paging.js`/`safe-color.js` imports, their `<script>` tags in `settings.html`, and their `settings` routes in the map (keep the allowlist minimal; route-closure test proves nothing still needs them). `test/unit/internal-page-map.test.js` updates: the `Object.keys(map)` pin (~12) gains `automation`; the settings key list (~19) drops `/audit-paging.js`/`/safe-color.js`; the settings `/audit-paging.js` resolve case moves to the automation host; an automation key-list pin is added. `settings-page-shared-scripts.test.js` has no automation pins (grep) — run it unchanged. No redirect from `goldfinch://settings/#automation` (nothing in the chrome deep-links it — grep-verified).

**DD5 — Hints: plain text, under the Keys heading, agreed copy**: two `<p class="muted">` lines after the existing "Generate a per-jar key…" line, verbatim:
- "Each key is scoped to one cookie jar. To create a new jar, open Cookie jars from the … menu."
- "An agent unlocks a jar's vault with a separate vault access key. Mint one in Vault (… menu) under that jar's Access keys."
- Rationale: operator ruling; internal pages have no sanctioned way to open another internal tab, and adding one is a security-sensitive channel out of charter.

**DD6 — Page contract (behavior specs depend on it)**: URL `goldfinch://automation`; `<title>Automation — Goldfinch</title>`; section ids `connection` / `keys` / `activity`; **every existing `automation-*` element id unchanged** (controllers and specs select by id). Controller code moves **verbatim** into `automation.js` (comments trimmed of stale "settings" references only where they'd mislead); the Settings-era guard comments ("goldfinch://settings origin") are updated to the new origin. TDZ checklist item applies to the verbatim move (anything referenced above its construction site needs a hoisted declaration). A HAT change to this contract is a spec re-author, not an inline fix.

**DD7 — Docs and behavior specs retargeted, slugs kept**: update `docs/mcp-automation.md` (enable instructions, "Settings controls", port/fallback notes), `docs/dev-testing.md`, `README.md` (§ automation), and CLAUDE.md (internal origins list `settings, downloads, jars, vault` → add `automation`; any Settings→Automation wording) to name the ⋯ menu → Automation / `goldfinch://automation`. Re-author `tests/behavior/settings-automation.md`, `settings-activity-viewer.md`, `automation-key-gating.md`, and the Settings references in `vault-mcp-surface.md` to open `goldfinch://automation` (chrome-seam `createTab('goldfinch://automation', null, { trusted: true })`). **Slugs kept** so run history stays continuous; titles/intent re-worded. Historic run logs are never edited.
- **Also re-authored (design review 1)** — specs pinning the UI this flight changes:
  - `settings-shell.md` (~row 85): nav links / titled sections drop Automation (3 links/sections).
  - `kebab-menu.md`, `menu-overlay.md`, `multi-window-shell.md` (~row 4): their kebab item lists/counts are already stale (they omit Vault); re-author those rows to the current model (New window | Settings, Downloads, Cookie jars, Automation, Vault | Print…, Exit), since the assertion being corrected is the one this flight changes.
- **Human-directed strings in `src/`**: `src/main/automation/mcp-server.js` `eaddrinuseMessage` (~1085) "change the automation port in Settings" → name the Automation page; check any test pinning that string.
- Developer greps and judges each hit (grep-AC convention) across `docs/ README.md CLAUDE.md tests/behavior/*.md src/`: `goldfinch://settings`, `Settings.{0,40}([Aa]utomation|port|toggle|[Kk]ey)`, `Settings → (Keys|Automation)`; body rows of the re-authored specs (not only headers/intent — e.g. `settings-automation.md` rows ~2/~119/~136, `#automation` anchors); `scripts/a11y-audit.mjs` example comments (~26/~64/~89/~264) gain a `goldfinch://automation` example; known hits include `docs/mcp-automation.md` ~42/~346/~665, `docs/dev-testing.md` ~12, `README.md` ~216 (and check the Settings-shell description ~323). Main-process comments that merely name the `automationEnabled` *setting* stay unless they direct a human to a location. `docs/behavior-specs-single-window-audit.md` is a dated M09 deliverable — left as historic. Historic run logs are never edited.

**DD8 — Verification apparatus**:
- **Unit** (`npm test`): origin/host drift guard incl. `INTERNAL_JAR_NAMES` + per-host cases (DD1); kebab model↔actions drift guard, Automation-above-Vault order, moved-action tests, TDZ order pin, seam unchanged (DD2); scroll-spy mock-DOM test + `section-nav` pin (DD3); map-test updates (DD4); an `automation-page-shared-scripts.test.js` sibling to `settings-page-shared-scripts.test.js` (flat srcs resolve, every script routed, module/defer pins); route-closure test covers the new host automatically; line budget retarget.
- **Live smoke** (Developer, Goldfinch dev mode per operator standing preference: `npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`, key captured per launch, `connectAutomation()` env-key scripts — never the registered `goldfinch-dev` MCP server). **Act path**: admin `evaluate` on the chrome target calling the seam's `createTab('goldfinch://automation', null, { trusted: true })`; `click(guestWcId, x, y)` on page controls. **Observe path**: `enumerateTabs`/`enumerateWindows` (admin `allowInternal` census lists the internal tab), `readDom`/`readAxTree`/`captureScreenshot` on the internal guest, `captureWindow`, and `evaluate` on the guest for `location.origin`. Project rule: exercise every existing primitive against the new state.
- **Unobservable**: the kebab sheet (menuType `kebab` ∉ `AUTOMATABLE_MENU_TYPES`) — kebab item placement and click are **[by-eye] in the HAT**, not in any automated AC.
- **Behavior specs** (HAT leg): `/mission-control:behavior-test settings-automation`, `settings-activity-viewer`, `automation-key-gating` after re-author.
- **a11y**: `npm run a11y -- --target=goldfinch://automation` in the HAT (verify-only; new findings judged).

### Prerequisites
- [x] `renderer.js` budget state known: 1546/1546 (probed) → DD2 extraction
- [x] Internal-page plumbing is host-agnostic (protocol handler via map, `registerInternalHandler`, `broadcastToChromeAndInternal`) — code-read
- [x] No chrome deep-link into `settings#automation` — grep
- [x] Chrome seam exposes `createTab` (seam tail) — act path for smoke/specs
- [x] Design review 1 (Architect): approve with changes — 2 high, 4 medium, 2 low folded into DD1/DD2/DD3/DD4/DD7/DD8
- [x] Design review 2 (Architect): approve with changes — 2 medium, 2 low folded into DD1/DD2/DD7; no decision conflicts; seam/budget plan verified
- [ ] Dev-mode apparatus launches on this host (`npm run dev:automation` with DEV_MINT + ADMIN) — verified by the Developer at smoke time

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach
1. Extract kebab actions into `createChromePageActions` (`kebabActions` + `openAutomationPage`), add the model item above Vault, wire `pageActions.kebabActions` into `createOverlayDispatch`, retarget the renderer budget.
2. Extract the scroll-spy into `section-scroll-spy.js`; generalize the nav selector to `nav.section-nav`.
3. Create `automation.html` / `automation.js` / `automation.css` by moving the Settings Automation markup, controllers, and page-specific CSS verbatim; add the two hints.
4. Onboard the host (DD1) and add the drift guard; remove the section from Settings (DD4).
5. Retarget docs and behavior specs (DD7); `npm run format`, `npm test`, `npm run lint`, `npm run typecheck`; live smoke.

### Checkpoints
- [ ] Kebab extraction lands with `renderer.js` below its old budget and all overlay-dispatch tests green
- [ ] `goldfinch://automation` renders with all controls live; Settings has no Automation section
- [ ] Docs/specs retargeted; live smoke passes

### Adaptation Criteria

**Divert if**:
- Any automation bridge call turns out to be gated on the `settings` origin/host specifically (contradicts DD1's premise)
- Moving the controllers verbatim requires changing an IPC channel or bridge method
- The kebab extraction needs a seam change (any edit to the `Object.assign(globalThis, …)` name list, incl. dropping `kebabActionSettings`)

**Acceptable variations**:
- Exact CSS rule partition between `settings.css` and `automation.css`
- Comment wording in moved code
- Splitting the leg's work across Developer passes

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses.

- [x] `automation-page` - Kebab-action extraction + Automation item; new `goldfinch://automation` page (shell, controllers, CSS, hints) with full host onboarding and drift guards; Settings section removed; docs + behavior specs retargeted; live smoke
- [ ] `hat-and-alignment` *(optional)* - Guided HAT: kebab placement/click by eye, page vs Settings look, hints, Settings nav non-regression, re-authored behavior specs, a11y audit of the new page

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check` green
- Live smoke (DD8) in dev mode: page opens via trusted `createTab`, controls work, Settings lacks the section
- HAT: kebab ⋯ → Automation (above Vault) opens the page [by-eye]; behavior specs `settings-automation`, `settings-activity-viewer`, `automation-key-gating` pass against `goldfinch://automation`; `npm run a11y -- --target=goldfinch://automation` shows no new findings
