# Flight: Accessibility — Keyboard & Screen-Reader Baseline

**Status**: landed
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [x] F22 — tabs keyboard-operable with correct ARIA roles/state (verified by behavior test — `tab-keyboard-operability` 7/7 PASS)
- [x] F23 — icon-only chrome controls have accessible names and a visible focus indicator
- [x] F24 — remaining WCAG AA gaps addressed

> Source: [maintenance/2026-06-05.md](../../../../maintenance/2026-06-05.md) Accessibility addendum. Reconnaissance against current `main` (2026-06-06): **all three findings confirmed-live**, none satisfied by Flights 1–4; only the report's line numbers drifted (renderer/styles were edited in Flights 1–3). Re-located citations are in the [flight log](flight-log.md#reconnaissance-report) and in Technical Approach below. No items retired.

---

## Pre-Flight

### Objective
Make the browser chrome operable by keyboard and screen-reader users, starting with the completely-inoperable tab strip (F22), then accessible names and focus visibility across all icon-only controls (F23), then the remaining WCAG 2.1 AA gaps split into semantics (F24a) and visual/motion (F24b). This is the mission's final flight; landing it closes criteria F22–F24 and the mission.

### Open Questions
- [x] Leg breakdown for F24 → **split** into `aa-semantics` + `aa-visual` (see Legs).
- [x] How to verify F23/F24 beyond unit/lint/typecheck → **axe-core audit** injected via CDP, plus the F22 behavior test and screenshot checks (see Design Decisions).
- [x] Optional HAT/alignment leg → **no** (operator declined; verification is the Witnessed behavior test + axe audit + per-leg ACs).
- [x] Tab keyboard model → **automatic activation** with a roving tabindex (see DD1).

### Design Decisions

**DD1 — Tab strip semantics & keyboard model (F22).** Give `#tabs` `role="tablist"`; each `.tab` becomes `role="tab"` with `aria-selected` and a **roving tabindex** (selected tab `tabindex="0"`, others `-1`); the close affordance becomes a real `<button class="tab-close">` with `aria-label="Close tab: {title}"`. Keyboard contract: **ArrowLeft/Right** move focus *and* activate the adjacent tab (automatic activation, wrapping), **Home/End** jump to first/last, **Delete/Backspace** on a focused tab closes it (focus then moves to a sibling tab, never to `<body>`).
- Rationale: matches the WAI-ARIA Authoring Practices tabs pattern; automatic activation mirrors how a browser's tab strip already feels (click = activate) and avoids a redundant Enter step; Delete-to-close is the APG "deletable tabs" idiom and sidesteps roving-tabindex conflicts from a second tabbable element per tab.
- **Scope the key handler to the tablist/tab elements, NOT `document`** (the renderer already has two `document`-level keydown listeners — lightbox `:641`, shortcuts `:1283`). A document-level arrow/Delete handler would hijack `ArrowLeft/Right` while typing in `#address` and `Delete` while a `<webview>` is focused. Add `aria-keyshortcuts="Delete"` (or an SR-instructions element) so AT users discover the close affordance.
- Implementation couplings the leg must honor: (a) webviews currently have **no `id`** (`renderer.js:137-143`) — assign one so `aria-controls` can reference it; (b) the close `<button>`'s accessible name must **track the tab title**, so update its `aria-label` on `page-title-updated` (`renderer.js:239-243`), not just once at creation (mirror the F23 reload-name-sync pattern).
- Trade-off: `activateTab`/`createTab`/`closeTab` gain focus/tabindex/`aria-selected` bookkeeping. The `<webview>` is the logical tab "panel" but is a cross-origin guest custom element — we set `aria-controls` to each webview's id but do **not** force strict `role="tabpanel"` semantics onto it (out of scope; documented deviation).

**DD2 — Behavior-test apparatus, premise-audited on both axes (F22).** A CDP client **attached to the running app's existing `:9222`** (`dev:debug`), targeting the **chrome/renderer** target — *not* a `<webview>` guest (the strip lives in the renderer; selecting a guest is the proven #1 false-pass trap). The load-bearing constraint is **attach, don't launch**: the apparatus must connect to the already-running Electron instance, never spin up a fresh browser (a fresh browser has none of the app's tabs). Two registered/precedented clients satisfy this — the **Playwright MCP** registered in `.mcp.json` with `--cdp-endpoint http://127.0.0.1:9222` (attaches; exposes trusted `press_key`, a11y `snapshot`, `screenshot`, `select_page`), and the **raw CDP-over-Node-WebSocket** client used in the Flights 2–4 live runs. The Executor selects one at run time by name pattern. **`chrome-devtools` MCP does NOT qualify** — it launches its own browser (Flight 2 debrief, standardized lesson).
- **Act path**: trusted key events (`Input.dispatchKeyEvent` / MCP `press_key`) for Tab/Shift+Tab/Arrow/Home/End/Delete — only *trusted* events drive native focus traversal and fire the renderer's real keydown handlers (synthetic `Runtime.evaluate` events would not).
- **Observe path (read surfaces that exist today, no test-only seam)**: the a11y tree (`Accessibility.getFullAXTree` / MCP `snapshot`) for roles/`aria-selected`/accessible names; `document.activeElement` for focus identity; **a screenshot** for the visible focus ring (focus visibility is a rendered-pixel property the a11y tree can't attest — rendered-state discipline).
- Spec: [tests/behavior/tab-keyboard-operability.md](../../../../tests/behavior/tab-keyboard-operability.md) (`draft`).
- Trade-off: the run requires the GUI app + a two-live-agent crew; it is the verify-leg's operator-gated real-environment gate, not an offline CI gate.

**DD3 — F23/F24 automated audit = axe-core injected via CDP (F23, F24).** Stand up `scripts/a11y-audit.mjs` + an `npm run a11y` script that attaches to the renderer target at `:9222`, injects `axe-core` (new devDependency; CDP `Runtime.evaluate` bypasses the page CSP, so injection is permitted), runs `axe.run()`, and exits non-zero on violations.
- **Gate = WCAG A/AA tag set, not axe's full default (refined during leg-3 design review).** The hard gate runs `axe.run` over `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa` (+ the `nested-interactive` exclusion). axe's **best-practice** rules (`region`, `landmark-one-main`, `page-has-heading-one`, `heading-order`, `landmark-unique`, …) assume a *document*; a browser-chrome app shell legitimately has no `<main>`/`<h1>` and content outside landmarks, so those run **advisory** (reviewed at verify, not hard-failed). This prevents the verify sweep surprise-failing on app-shell-inappropriate rules that no leg owns.
- **Rule-subset parameter (resolves the deferred-contrast / run-at-each-checkpoint tension):** the harness accepts a `--rules=`/`--tags=` filter. Because `color-contrast` is deferred to F24b (DD5) and `label` is deferred to F24b (the media-pick checkbox), the **F23 checkpoint** runs `--rules=button-name,aria-allowed-attr,aria-valid-attr-value,aria-required-attr,aria-roles`; the **F24a checkpoint** runs the ARIA-validity + dialog/input-name rules for its new markup; the **F24b checkpoint and verify** run the full WCAG-tag set (now including `color-contrast` + `label`). Without the filter a per-checkpoint sweep would exit non-zero on rules the flight hasn't fixed yet.
- **What axe can't verify** (live-region *announcement*, focus trap, Escape, focus restore — 4.1.3 + focus management aren't statically detectable) is verified **behaviorally at `verify-a11y`**, not by axe.
- **Coverage hazard (must be designed for, not assumed):** the controls F23/F24 target live in **collapsed/hidden/dynamic** DOM — the media panel and privacy panel are `class="collapsed"` (`index.html:42,85`), the lightbox is `class="hidden"` (`:101`), and `renderPrivacy()` returns early while collapsed (`renderer.js:1096`), so the **Shields switches do not exist in the DOM until the privacy panel is opened**, the media cards / `iconBtn` / media-pick checkboxes don't exist until the media panel is open **with a media-bearing page loaded**, and the lightbox dialog + transport controls aren't rendered until opened. axe-core skips non-visible nodes — so a sweep of the default chrome silently green-lights all of these. The harness MUST drive the UI into each state before auditing: load the a11y media fixture, open the media panel, open the privacy panel (so `pShields()` renders), open the lightbox — and audit each state.
- **Fixture (follow the house convention):** the committed media fixture lives at `tests/behavior/fixtures/a11y-media/` (alongside `tab-scheme-guard`/`core-browsing-shields`/`farbling-correctness` fixtures), **served over HTTP on a non-`9222` port** (e.g. `python3 -m http.server 8080`) — media **must** load over `http(s)`, not `file://`: the media panel never catalogs `file://` sources (the `tab-scheme-guard` run confirmed `file://` media yields `error=4`, never cataloged). It carries a known image + audio + video so the media-card / `iconBtn` / media-pick controls render. **Owned solely by the F23 leg** (first consumer); F24b reuses it.
- Rationale: a repeatable, permanent regression net (debriefs repeatedly preferred permanent nets over one-shot checks) covering the breadth of F23/F24 that the focused F22 behavior test does not.
- Trade-off: adds an `axe-core` devDependency and a GUI/`:9222` prerequisite for *this* gate. **Not added to `ci.yml`** — `ci.yml`'s gates are headless/offline (test/typecheck/lint); the a11y audit is a real-environment gate run in the verify leg, like the behavior tests. **The per-leg offline gate (DD4) cannot run axe** (GUI-bound), so F23/F24 correctness rides on the GUI-available checkpoints; run `npm run a11y` at each GUI-available checkpoint, not only in the final verify leg, to avoid front-loading all a11y risk onto one step.

**DD4 — Per-leg offline gate (carry-forward from Flight 2 debrief).** Every implementation leg's ACs include `npm test` + `npm run typecheck` + `npm run lint` clean. The renderer is whole-codebase `@ts-check`'d with `sourceType:"script"`; budget for `els`-member / `HTMLElement` casts on any new DOM access (e.g. `getAttribute`, `Element` → `HTMLButtonElement`).

**DD5 — Contrast & color-independence remediation scope (F24b).** Raise `--fg-dim` and the `.switch` off-state track to meet WCAG AA (4.5:1 normal text, 3:1 large/UI components); add non-color cues to color-only state (`.tab.active`, `#toggle-privacy.alert`, `.filter.active`).
- **Verification split (axe `color-contrast` is text-only — WCAG 1.4.3):** axe verifies only the `--fg-dim` small-**text** shortfall. It does **not** check non-text/UI-component contrast (1.4.11 — the `.switch` track has no text) or color-independence (1.4.1). Route the switch-track contrast and every color-only-state cue to **screenshot/manual review**, not axe (same rendered-pixel discipline as the focus ring). Do not claim axe covers these.
- Trade-off: `--fg-dim` is a global token used widely across the chrome; the change ripples. Isolated to the `aa-visual` leg with a screenshot diff review.
- Acceptable variation: if a global token bump cascades into unacceptable visual regressions, scope the fix to the specific failing surfaces rather than the global token (document in the flight log).
- **Ordering note (resolves F23/F24b contrast overlap):** `--fg-dim` small text also appears in the Shields area (e.g. `.shield-row.pause span`, `styles.css:735`), which the F23 leg touches but does not remediate for contrast. Therefore the **F23 axe gate is scoped to `button-name`/`label`/aria-validity only; ALL `color-contrast` is deferred to F24b/verify** — otherwise F23 would fail on text it doesn't own.

### Prerequisites
- [x] **Verify-leg real-environment env** — `npm run dev:debug` launched the GUI; `:9222` answered with the renderer target; fixture served on `:8090` (`:8080` was a pre-existing Concourse instance — see verify notes). No port conflict.
- [x] **axe-core resolvable** — installed in leg 2; `axe.min.js` injected successfully over CDP.
- [x] **Two-live-agent crew** — Executor + Validator spawned (consolidated single-pass Witnessed; `SendMessage` absent).

### Pre-Flight Checklist
- [x] All open questions resolved (see above)
- [x] Design decisions documented
- [x] Prerequisites verified (probed at the verify leg)
- [x] Validation approach defined (behavior test + axe audit + per-leg offline gate)
- [x] Legs defined (all 5 generated via `/leg`)

---

## In-Flight

### Technical Approach

One finding → one (or two) legs, in dependency order. F22 first (the strip is wholly inoperable), then F23 (names + focus + the axe harness), then F24 split semantics/visual, then a real-environment verify leg mirroring the Flight 2/3/4 `verify-*` house pattern. Current-`main` citations (post-recon; supersede the maintenance report's drifted numbers):

- **F22 — tab strip operability (Action Required).** Tabs are click-only `<div class="tab">` built at `src/renderer/renderer.js:160-177` (close is a `<span class="tab-close">`, `:168`; click-only listener `:169-175`); `#tabs` is a bare `<div>` (`src/renderer/index.html:15`); `activateTab` toggles only a `.active` class (`:198-212`). **Fix:** per DD1 — `tablist`/`tab`/roving-tabindex/`aria-selected`, arrow+Home/End+Delete keys, close `<button>` with an accessible name. Author + reference the `tab-keyboard-operability` behavior test.
- **F23 — accessible names + focus visibility (Action Required).** Reload `title="Reload"` is static (`index.html:26`) while only `textContent` swaps ⟳↔✕ for Stop (`renderer.js:233,236,351`); Shields switches set `role="switch"`+`aria-checked` but **no** accessible name (`toggle()`, `:1053-1060`); icon-only toolbar buttons name via `title` only (`index.html:16-17,24-26`); media-card `iconBtn` title-only (`:499-509`); player transport title-only (`index.html:75-77`); `#address` has `outline:none` (`styles.css:153`) and there is **no `:focus-visible` rule anywhere**. **Fix:** `aria-label` on every icon-only control; keep the reload name in sync with Stop/Reload; label each switch (via `aria-label`/`aria-labelledby` to its row label); add a global `:focus-visible` indicator (≥3:1) across interactive chrome. Stand up the axe-core harness (DD3).
- **F24a — WCAG AA semantics (Advisory).** No live regions (`#toasts` `index.html:98`, `#media-empty` `:66`); lightbox lacks `role="dialog"`/focus-trap (`index.html:101`; Escape already at `renderer.js:641-647`); container menu + panels lack Escape/focus management (`:88-119`); `#address` unlabeled (`index.html:28`); toolbar/tabstrip are bare `<div>`s with no landmark/heading structure (`:14,22`). **Fix:** `role="status"`/`aria-live` on toasts + media list/empty; `role="dialog"` + focus trap + Escape on the lightbox, container menu, and panels; `aria-label` on the address bar; toolbar/landmark roles + real headings. Audited via axe `landmark-*`/`heading-order`/`aria-*`.
- **F24b — WCAG AA visual & motion (Advisory).** No `prefers-reduced-motion` (animations `styles.css:189-191,593-595,748,762,514`); color-only state (`.tab.active` `:67`, `#toggle-privacy.alert` `:690`, `.filter.active` `:227`); `--fg-dim #9a9ca6` small-text + `.switch` off-track `#555` contrast (`styles.css:6,745`); media-pick checkbox unlabeled (`renderer.js:421-435`). **Fix:** `@media (prefers-reduced-motion: reduce)` to neutralize panel/player/switch/toast animation; non-color cues for Shields on/off + alert + active-tab; raise `--fg-dim` + switch off-track per DD5; `aria-label` per media-pick checkbox naming its item. Audited via axe `color-contrast` + screenshots.

### Checkpoints
- [x] Tabs keyboard/AT operable (key handler scoped to the strip, not `document`) + `tab-keyboard-operability` spec authored (F22)
- [x] Accessible names + visible focus across chrome; axe `button-name`/`label`/aria-validity clean across all states (panels/lightbox opened, media fixture loaded); axe harness + a11y media fixture in place (F23)
- [x] Live regions, dialog/focus-management, landmarks/headings; axe `landmark-*`/`heading-order`/`aria-*` clean (F24a)
- [x] Reduced-motion + AA text contrast (axe `color-contrast`) + non-text contrast & color-independent cues (screenshot review) (F24b)
- [x] Real-environment gate green: behavior test passes (7/7) + full multi-state `npm run a11y` WCAG-tag sweep clean (verify)

### Adaptation Criteria

**Divert if**:
- Retrofitting `role="tab"` + roving tabindex onto the webview-backed tab model causes focus-management conflicts that need a design rethink (e.g. focus stealing between the strip and an active `<webview>`).
- The GUI/`:9222` environment cannot be brought up at the verify leg (no WSLg display, CDP won't attach) — fall back to authoring-complete + deferred run, flagged in the log, not silently skipped.

**Acceptable variations**:
- Scoping the F24b contrast fix to specific surfaces instead of the global `--fg-dim` token if a global bump cascades (DD5).
- Splitting `aa-semantics` or `aa-visual` further if a single leg proves too large for one session.

### Legs

> **Note:** Tentative. Legs are generated one at a time via `/leg` as the flight progresses.

- [x] `tab-strip-a11y` — F22: tablist/tab/roving-tabindex/arrow+Home/End+Delete keys (handler scoped to the strip), close `<button>` + title-tracking accessible name, webview ids for `aria-controls`; author the `tab-keyboard-operability` behavior-test spec
- [x] `control-names-and-focus` — F23: aria-labels on all icon-only controls, reload name sync, switch labels, global `:focus-visible`; stand up `scripts/a11y-audit.mjs` + `npm run a11y` (axe-core, multi-state) + a committed a11y media fixture; axe gate scoped to `button-name`/`label`/aria-validity (contrast deferred to F24b)
- [x] `aa-semantics` — F24a: live regions, `role="dialog"` + focus trap + Escape, landmarks/headings, address-bar label
- [x] `aa-visual` — F24b: `prefers-reduced-motion`, color-independent state cues (screenshot-verified), AA text contrast (`--fg-dim`, axe) + non-text switch-track contrast (screenshot), media-pick checkbox labels
- [x] `verify-a11y` — operator-gated real-environment gate (Flight 2/3/4 `verify-*` house pattern): probed `:9222`, ran `/behavior-test tab-keyboard-operability` (7/7 PASS), ran the full WCAG-tag `npm run a11y` sweep (0 violations across all states) + screenshot review; **found + fixed a real `image-alt` bug** during verify

---

## Post-Flight

### Completion Checklist
- [x] All legs completed (1–5)
- [ ] Code merged (PR pending — branch committed locally; push/PR operator-gated)
- [x] `npm test` (147) + `npm run typecheck` (0) + `npm run lint` (0) clean
- [x] `tab-keyboard-operability` behavior test passes (7/7; spec promoted `draft → active`)
- [x] `npm run a11y` WCAG-tag sweep reports zero violations across all states (advisory best-practice: only `region`, the documented app-shell exception)

### Verification
A keyboard-only user can focus the tab strip, switch tabs with arrows/Home/End, and close a tab with Delete — with a visible focus indicator throughout; a screen reader announces the strip as a tablist with a selected tab, meaningful names for every icon button and Shields switch, and dynamic updates via live regions; the lightbox/menus/panels trap focus and close on Escape; `prefers-reduced-motion` is respected; contrast and color-independence meet WCAG 2.1 AA. Confirmed by: the `tab-keyboard-operability` Witnessed behavior test (F22), the `npm run a11y` axe sweep (F23/F24 breadth), and screenshot review of the focus ring and reduced-motion (F24b).
