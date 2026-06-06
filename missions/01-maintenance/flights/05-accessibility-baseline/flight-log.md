# Flight Log: Accessibility — Keyboard & Screen-Reader Baseline

**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](flight.md)

## Summary
Legs 1–4 (F22, F23, F24a, F24b) implemented, reviewed, and committed; verify-a11y (live behavior test + full multi-state axe sweep) pending.

---

## Reconnaissance Report

**Date**: 2026-06-06 · **Source artifact**: [maintenance/2026-06-05.md](../../../../maintenance/2026-06-05.md) (Accessibility addendum — F22, F23, F24)

The maintenance report's cited line numbers predate Flights 1–4, which edited `renderer.js` and `styles.css` (poster sanitize, container-color validation, whole-repo lint/format/typecheck). All cited locations **drifted** but were re-located against current `main`; every gap was then re-verified. **No items are already-satisfied — all three findings are confirmed-live.** Re-located citations below supersede the report's numbers.

| Item | Classification | Evidence (current `main`) | Recommendation |
|------|----------------|---------------------------|----------------|
| **F22** — tab strip non-operable by keyboard/SR | `confirmed-live` (drifted from report's `renderer.js:122-132`) | Tabs are `<div class="tab">` built at `renderer.js:160-177` with a click-only listener (`:169-175`); close is a `<span class="tab-close">✕` (`:168`); no `tabindex`/`role`/`aria-selected`/keydown. Strip container `#tabs` is a bare `<div>` (`index.html:15`). `activateTab` toggles only a `.active` class (`:198-212`). | Real work. `role="tablist"`/`role="tab"` + roving tabindex + arrow-key nav + `aria-selected`; close becomes a focusable `<button>` with an accessible name. Pin with a behavior test. |
| **F23** — missing/stale accessible names; no visible focus | `confirmed-live` (drifted from report's `:182-183,264`/`:867-874`/`styles.css:101`) | Reload `title="Reload"` is static (`index.html:26`) while `renderer.js` swaps only `textContent` ⟳↔✕ for Stop (`:233,236,351`). Shields switches set `role="switch"`+`aria-checked` but **no** accessible name (`toggle()`, `:1053-1060`). Icon-only toolbar buttons name via `title` only (`index.html:16-17,24-26`); media-card `iconBtn` title-only (`:499-509`); player transport title-only (`index.html:75-77`). `#address` has `outline:none` (`styles.css:153`); **no `:focus-visible` rule anywhere**. | Real work. `aria-label` on every icon-only control; sync reload name with Stop/Reload; label each switch; add a global `:focus-visible` indicator (≥3:1). |
| **F24** — remaining WCAG 2.1 AA gaps | `confirmed-live` (drifted; 7 sub-items) | No `prefers-reduced-motion` (animations at `styles.css:189-191,593-595,748,762,514`). No live regions (`#toasts` `index.html:98`, `#media-empty` `:66`). Lightbox lacks `role="dialog"`/focus-trap (`index.html:101`; Escape exists `renderer.js:641-647`); container menu + panels lack Escape/focus mgmt (`:88-119`). `#address` unlabeled (`index.html:28`); toolbar/tabstrip are bare `<div>`s (`:14,22`). Color-only state (`.tab.active` `styles.css:67`, `#toggle-privacy.alert` `:690`, `.filter.active` `:227`). `--fg-dim #9a9ca6` small-text + `.switch` off-track `#555` contrast (`styles.css:6,745`). Media-pick checkbox unlabeled (`renderer.js:421-435`). | Real work, batchable. Sub-items are independent; may split if one leg is too large. |

**Recon outcome**: nothing to retire; no scope reduction. The only correction vs the source artifact is the drifted citations (recorded above and to be reflected in the flight's Technical Approach). Carried into the flight per the methodology — no items silently dropped.

---

## Leg Progress

### 2026-06-06 — `tab-strip-a11y` (F22) — landed

Implemented the tab strip keyboard/SR baseline per DD1.

**What changed:**
- `src/renderer/index.html` — `#tabs` now `role="tablist" aria-label="Open tabs"`.
- `src/renderer/renderer.js`:
  - `createTab` — each webview gets `id="webview-${id}"`; the tab `<div>` gains `role="tab"`, `aria-selected="false"`, roving `tabIndex=-1`, `aria-controls="webview-${id}"`, `aria-keyshortcuts="Delete"`, and `aria-label="New tab"`. Favicon `<img>` gets `alt=""`; the close affordance is now a `<button class="tab-close" tabindex="-1" aria-label="Close tab: New tab">` (was a `<span>`). The leading `${dot}` jar color dot is preserved. Click handler routes via `.closest('.tab-close')`.
  - `activateTab` — the existing `for (const t of tabs.values())` loop now also sets `aria-selected` (string) and roving `tabIndex` (active 0, others -1).
  - `page-title-updated` — syncs the tab `aria-label` and the close button's `aria-label` (`Close tab: {title}`) to the live title.
  - New `focusTab(id)` helper + a `keydown` listener on `els.tabs` (NOT `document`): Arrow Left/Right move+activate with wrapping, Home/End jump to first/last, Delete/Backspace close the focused tab and refocus the resulting active tab. `cur` resolves via `closest('.tab')` cast to HTMLElement.
- `src/renderer/styles.css` — `.tab-close` button chrome neutralized (transparent bg, no border, padding 0, `font: inherit`, pointer cursor); added `.tab:focus-visible` / `.tab .tab-close:focus-visible` outline (`2px solid var(--accent)`, offset -2px).

**Gate results (all green):**
- `npm run typecheck` → `tsc --noEmit` exit 0, 0 errors.
- `npm run lint` → `eslint .` exit 0, 0 problems.
- `npm test` → `# tests 147 # pass 147 # fail 0` (exit 0).

No `@ts-expect-error` / no lint downgrades — the leg's prescribed `/** @type {...} */` casts typechecked cleanly. Live keyboard/AT run (`/behavior-test tab-keyboard-operability`) remains deferred to the `verify-a11y` leg. Commit deferred to the flight-level review per `/agentic-workflow`.

### 2026-06-06 — `control-names-and-focus` (F23) — landed

Implemented accessible names, reload-name sync, and a keyboard focus indicator across the chrome, and stood up the axe-core audit harness + media fixture (DD3/DD5).

**What changed:**
- `src/renderer/index.html` — explicit `aria-label` on every icon-only button (`#new-tab`→"New tab", `#new-tab-menu`→"New tab in a container", `#back`/`#forward`/`#reload`, `#media-close`→"Close media panel", `#privacy-close`→"Close privacy panel", `#lightbox-zoom-out`/`#lightbox-zoom-in`/`#lightbox-close`→"Close image viewer", `#player-prev`/`#player-play`/`#player-next`), keeping existing `title` tooltips; `#reload` gets an initial `aria-label="Reload"`.
- `src/renderer/renderer.js`:
  - `did-start-loading` / `did-stop-loading` — reload control's accessible name now tracks state: `aria-label` **and** `title` swap to "Stop" / "Reload" alongside the `textContent` glyph (no longer `textContent`-only).
  - `toggle(on, onChange, label)` — switch factory takes a label and sets `aria-label` on the `role="switch"` element; the enable toggle is named "Shields" and each row switch is named from its row label ("Block trackers", "Strip tracking params", "Isolate 3rd-party cookies", "Farble fingerprint"). No unnamed `role="switch"` remains.
  - `iconBtn` — media-card action buttons (`.icon-action`) get `aria-label` from their `title` (durable explicit name).
- `src/renderer/styles.css` — control-scoped `:focus-visible` ring (`2px solid var(--accent)`) across `.icon-btn`/`.text-btn`/`.filter`/`.switch`/`.icon-action`/`#player-controls button`/`.cm-item`/`a`, plus an id-specificity `#address:focus-visible` rule (the `#address { outline:none }` id selector would otherwise win). Leg 1's `.tab:focus-visible` preserved.
- `scripts/a11y-audit.mjs` (NEW) — axe-core harness: attaches to the renderer target at `:9222` (target whose url ends with `index.html`) over CDP via Node's global `WebSocket`/`fetch` (Node 22, no new runtime dep); accepts `--rules=`/`--tags=`/`--url=`; always disables `nested-interactive` (inline comment citing leg 1's tab/close pattern); injects `node_modules/axe-core/axe.min.js`; **drives the UI into each state separately and aggregates** — loads the fixture via `navigate()`, then audits base chrome, media panel (`togglePanel(true)`), privacy panel (`togglePrivacy(true)`), and lightbox (`openLightbox(...)`), never by toggling `.collapsed`; calls `axe.run(...)` through `Runtime.evaluate` with `awaitPromise:true` + `returnByValue:true`; prints per-violation `state/id/impact/node-count/help`; exits non-zero on any violation.
- `package.json` — `"a11y": "node scripts/a11y-audit.mjs"` script; `axe-core@^4.12.0` added to `devDependencies` (installed; present in `package-lock.json`). Dev-only, so `ci.yml`'s `npm audit` is unaffected.
- `tests/behavior/fixtures/a11y-media/` (NEW) — `index.html` referencing same-dir local `bird.png` (image) + `tone.wav` (audio) + `clip.webm` (video), no `<iframe>` embed; real generated assets (valid PNG/WAV/WebM per `file(1)`); `README.md` with the `python3 -m http.server` serve instruction (→ `http://127.0.0.1:8000/`), matching the sibling-fixture tone.

**Gate results (all green):**
- `npm run typecheck` → `tsc --noEmit` exit 0, 0 errors.
- `npm run lint` → `eslint .` exit 0, 0 problems (the `scripts/**` ESM block covers the new `.mjs`).
- `npm test` → `# tests 147 # pass 147 # fail 0` (exit 0; no unit changes).
- `node --check scripts/a11y-audit.mjs` → exit 0.
- `axe-core` resolvable (`require.resolve('axe-core/axe.min.js')` ok).

No `@ts-expect-error` / no lint downgrades; the renderer edits are `setAttribute`/`title` writes on already-typed `els.*`, so no new casts were needed. **The live multi-state `npm run a11y` sweep was NOT run here** — it needs the GUI app at `:9222`, which the autonomous leg can't launch; per DD3 its execution is deferred to the `verify-a11y` leg (the harness is authored, syntax-valid, lint-clean, and wired). Commit deferred to the flight-level review per `/agentic-workflow`.

> Note: `renderer.js:391` (a leg-1 line) is Prettier-nonconformant on `main`'s current state; left untouched here to avoid modifying leg-1's work, and CI does not gate on Prettier (`ci.yml` runs test/typecheck/lint/audit/build only). Flag for the flight-level review.

### 2026-06-06 — `aa-semantics` (F24a) — landed

Implemented the WCAG 2.1 AA semantics gaps: live regions, lightbox modal-dialog focus management, container-menu/panel Escape + focus management, address-bar/panel labels, and panel headings.

**What changed:**
- `src/renderer/index.html`:
  - `#toasts` → `role="status" aria-live="polite" aria-atomic="false"` (download/error toasts now announce as they're appended).
  - NEW visually-hidden `#media-status` (`class="sr-only" role="status" aria-live="polite"`) right after `#toasts` — the reliable announce surface for the media count/empty state. `#media-empty` kept as the visual-only cue (NO `role` added — un-hiding a `display:none` node doesn't announce reliably).
  - `#lightbox` → `role="dialog" aria-modal="true" aria-label="Image viewer"`.
  - `#address` → `aria-label="Address and search bar"`.
  - `#media-panel`/`#privacy-panel` `<aside>`s → unique `aria-label`s ("Media panel" / "Privacy panel"). **No `role="toolbar"`** added to `#toolbar` (declined per AC — would imply unimplemented arrow-key nav; controls are already individually Tab-focusable/labeled from leg 2).
  - Panel title spans → real `<h2>` headings ("Media on this page", "Privacy on this page").
- `src/renderer/renderer.js`:
  - `els.mediaStatus` cache entry added.
  - `renderMedia` writes `els.mediaStatus.textContent` on every render ("N media item(s)" / "No media on this page").
  - Lightbox modal focus: module-scoped `let lbReturnFocus`; `openLightbox` stores `document.activeElement` (cast `HTMLElement|null`) then focuses `els.lightboxClose`; `closeLightbox` restores it (null-guarded no-op if the opener is gone). The existing document-level lightbox `keydown` gained a `Tab` branch (Escape + zoom `+`/`=`/`-`/`0` branches preserved): traps focus among `els.lightbox.querySelectorAll('button')`, including the focus-outside-buttons case (image/backdrop blur → pull back to first/last).
  - Container menu: `openContainerMenu` focuses the first `.cm-item`; a single module-scope `els.containerMenu` keydown handles Escape → `closeContainerMenu()` + refocus `els.newTabMenu`.
  - Panels (non-modal, no trap): focus moved into the panel close button **only when actually opening** (guarded inside the `if (show)` block so programmatic `togglePanel(false)`/init calls don't steal focus); single module-scope `els.panel`/`els.privacyPanel` keydown handlers for Escape → close + restore focus to `els.toggleMedia`/`els.togglePrivacy`.
- `src/renderer/styles.css` — `.sr-only` visually-hidden utility; `#media-panel-header h2, #privacy-header h2 { margin:0; font-size:inherit; font-weight:inherit; }` so the new headings don't disrupt the existing header layout.

**Duplicate-listener discipline:** all Escape/keydown listeners registered ONCE at module scope (verified `grep -c` = 1 each for `els.panel`/`els.privacyPanel`/`els.containerMenu`); only `.focus()` calls live in the open paths.

**Gate results (all green):**
- `npm run typecheck` → `tsc --noEmit` exit 0, 0 errors (the `activeElement`/`querySelector` casts typechecked cleanly).
- `npm run lint` → `eslint .` exit 0, 0 problems.
- `npm test` → `# tests 147 # pass 147 # fail 0` (exit 0; no unit changes).

No `@ts-expect-error` / no lint downgrades; Prettier-clean (`npx prettier --write` on the three changed files — index.html/styles.css unchanged, renderer.js normalized). Under the project Prettier config (`{ singleQuote, trailingComma:none, printWidth:120 }`) the whole renderer.js is now conformant, so the full-file `--write` also normalized the single pre-existing line the leg-2 entry above had intentionally left non-conformant. Since all three uncommitted legs land in one combined commit at the flight-level review (no per-leg diffs to preserve), a uniformly Prettier-clean renderer.js is the intended end state; flagged here for the reviewer in case they prefer to revert that one line.

**Deferred to `verify-a11y`** (GUI/`:9222`-bound, not run here): the WCAG-tag axe run (`npm run a11y -- --tags=wcag2a,wcag2aa,wcag21a,wcag21aa`) confirming the new ARIA is valid + named (dialog/status/live/address-input); and the behavioral checks axe can't statically detect — live-region announcement (toasts + media-status), lightbox focus trap + restore, container-menu/panel Escape + focus management. Commit deferred to the flight-level review per `/agentic-workflow`.

### 2026-06-06 — `aa-visual` (F24b) — landed

Implemented the WCAG 2.1 AA visual & motion gaps: `prefers-reduced-motion`, the one real text-contrast failure, non-text switch-track contrast, color-independent state cues, and per-item media-pick checkbox names (DD5).

**What changed:**
- `src/renderer/styles.css`:
  - NEW `@media (prefers-reduced-motion: reduce)` block (appended at end) — global `*, *::before, *::after` `transition-duration`/`animation-duration` → `0.01ms !important` (+ `animation-iteration-count:1`, `scroll-behavior:auto`), neutralizing the panel-width (`:219,641`), toast-bar (`:550`), and switch track/knob (`:796,810`) transitions. `0.01ms` (not `none`) keeps any `transitionend` listener firing; the JS-driven lightbox transform zoom/pan isn't a CSS transition and is intentionally unaffected.
  - **Required contrast fix** — `.ps-main.bad` `#ff6b6b` (4.47:1 on `--bg-3`, **fails** AA 1.4.3; the HTTP "Not secure" privacy state the verify sweep reaches) → `#ff8a8a` (5.46:1).
  - **Switch off-track** — `.switch` `background:#555` (1.66:1 vs `--bg-3`, fails 1.4.11) → `#7c7f8a` (3.10:1) **plus a `1px solid #9a9ca6` border** for a robust contrasting edge (the 3.10 margin is thin). `.switch.on` accent fill preserved.
  - **Active-tab non-color cue** — `.tab.active` gains `box-shadow: inset 0 2px 0 var(--accent)` + `font-weight:600` alongside the existing `--bg-3` background tint.
  - `--fg-dim` left at `#9a9ca6` — per the leg's design-review computation it already passes AA (5.23:1 on `--bg-2`, 4.53:1 on `--bg-3`); the optional defensive bump was declined to preserve the intended "dim" hierarchy (token is used widely across the chrome). Not a contrast failure.
- `src/renderer/renderer.js`:
  - Filter click handler (`els.filters.forEach`) — now sets `aria-pressed` (string) on every filter (active true / others false) as the AT non-color signal for the active filter, alongside the `.active` class.
  - Panel-toggle `aria-expanded` synced on **all three** paths: `togglePanel` (`els.toggleMedia`), `togglePrivacy` (`els.togglePrivacy`), **and `closePrivacyPanel()`** (`els.togglePrivacy` → `false`) — the media-open mutual-exclusion path calls `closePrivacyPanel()` directly, so without this the privacy toggle would keep a stale `aria-expanded="true"` after collapsing.
  - Media-pick checkbox — `cb.setAttribute('aria-label', \`Select ${item.label || item.name}\`)` at creation, giving each checkbox a unique descriptive name (the wrapping `<label>` only carries the type badge) — a name-quality improvement, not a fix for a missing name.
  - `updatePrivacyBadge` — added a comment noting the visible `(N)` tracker count is the non-color cue (1.4.1) reinforcing the red `.alert`; no behavior change.
- `src/renderer/index.html` — initial `aria-pressed` on the 5 filters (`true` on "All", `false` others); initial `aria-expanded="false"` on `#toggle-media` and `#toggle-privacy`.

**Gate results (all green):**
- `npm run typecheck` → `tsc --noEmit` exit 0, 0 errors (no new casts — `setAttribute` on already-typed `els.*`/freshly-created `cb`).
- `npm run lint` → `eslint .` exit 0, 0 problems.
- `npm test` → `# tests 147 # pass 147 # fail 0` (exit 0; no unit changes).

No `@ts-expect-error` / no lint downgrades; Prettier-clean (`npx prettier --write` on the three changed files — styles.css/renderer.js unchanged, index.html normalized).

**Deferred to `verify-a11y`** (GUI/`:9222`-bound, not run here): the full WCAG-tag axe sweep — now including `color-contrast` (verifies the `.ps-main.bad` text fix and the `--fg-dim` small-text) and `label` (the now-uniquely-named media-pick checkbox); and the screenshot/manual review items axe can't attest as rendered pixels — reduced-motion suppression, the raised switch-track non-text contrast (1.4.11), and the active-tab / active-filter / shield-alert color-independent cues (1.4.1). Commit deferred to the flight-level review per `/agentic-workflow`.

---

## Flight Director Notes

### 2026-06-06 — Flight start (`/agentic-workflow`)
- Phase file loaded: `.flightops/agent-crews/leg-execution.md` (valid — Crew / Interaction Protocol / Prompts present). Crew: Developer (Sonnet), Reviewer (Sonnet, never Opus).
- **Accessibility Reviewer** crew exists but is `Enabled: false` (project config). Decision: respect the config — do not auto-spawn per leg. This flight's a11y gate is the `tab-keyboard-operability` Witnessed behavior test + the `npm run a11y` axe sweep + screenshot review (the verify-a11y leg), backed by the per-leg Reviewer checking criteria compliance. Will reconsider spawning one Accessibility Reviewer at the single flight-review stage given the flight is wholly a11y work.
- Branch `flight/05-accessibility-baseline` created off `main`; planning artifacts (flight.md, flight-log.md, tab-keyboard-operability.md) committed as the flight-start commit. Flight status `ready → in-flight`.
- Total legs: 5 — `tab-strip-a11y`, `control-names-and-focus`, `aa-semantics`, `aa-visual`, `verify-a11y`. Legs 1–4 autonomous; `verify-a11y` is operator-gated (runs `/behavior-test` + axe). Per the deferred model, code review + commit batch after the last **autonomous** leg (aa-visual); the verify leg runs separately.

### 2026-06-06 — Flight review + commit (autonomous legs 1–4)
- Every leg got a per-leg design review (Developer crew, 1 cycle each, all "approve with changes" → incorporated): leg-1 typecheck-snippet fix + nested-interactive cross-leg note; leg-2 iconBtn labels + per-state axe driving + network flag; leg-3 WCAG-tag gate (DD3) + live-region redesign + listener-once + trap-leak fix; leg-4 real `.ps-main.bad` contrast failure pulled into scope + `aria-expanded` on `closePrivacyPanel` + corrected `--fg-dim` premise (already passes). Separate Developer agents implemented; offline gates green each leg.
- **Flight-level review: two reviewers in parallel** — standard Reviewer + an **Accessibility Reviewer** (spawned at FD discretion despite the crew's `Enabled:false`, since the flight is wholly a11y). **Both `[HANDOFF:confirmed]`**; gates re-verified green (147 / typecheck 0 / lint 0 / `node --check` OK).
- **A11y non-blocking findings — disposition:** (1) panel close-button strands focus (restore only on Escape) → **fixed** (restore to the toggle when a panel closes with focus inside, matching the lightbox); (3) `#new-tab-menu` missing `aria-haspopup`/`aria-expanded` → **fixed**; (2) focus-restore on menu item-select/click-away → **declined** (would fight the natural move to the new tab; Escape already restores); (4) `aria-controls`→webview w/o `tabpanel` → deliberate DD1, no action; (5) `aria-modal` without `inert` background → **deferred to verify-a11y** (focus trap is the safeguard; acceptable for AA). The two small fixes are on-pattern with approved code → committed without a re-review cycle (gates re-run).
- **Commit**: legs 1–4 source + artifacts, single commit. Flight stays **`in-flight`** — `verify-a11y` (leg 5) is operator-gated (live GUI/`:9222` behavior test + axe) and runs next; flight is NOT `landed` and the mission box is NOT checked until verify passes. PR opening deferred to post-verify (outward-facing).

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes

### 2026-06-06 — Flight planning (`/flight`)

Fleshed the `ready` stub into a codebase-validated spec. Recon (above): F22/F23/F24 all confirmed-live; only line numbers drifted. Operator decisions: **4 implementation legs** (F24 split into `aa-semantics` + `aa-visual`), **axe-core audit** for F23/F24 breadth alongside the F22 behavior test, **no HAT leg**; a final `verify-a11y` leg added per the Flight 2/3/4 `verify-*` house pattern.

Authored behavior-test spec `tests/behavior/tab-keyboard-operability.md` (`draft`) for F22. Apparatus (both axes, premise-audited): a CDP client **attached to the app's `:9222`** (Playwright MCP `--cdp-endpoint` or raw CDP — `chrome-devtools` MCP disqualified, launches its own browser), driving the **renderer** target (not a guest) with trusted key events; observing via a11y tree + `document.activeElement` + screenshot.

**Design review — 2 cycles (Architect, Sonnet):**
- Cycle 1 → *approve with changes*. Key catch: axe would **false-pass** F23/F24 controls in collapsed/hidden DOM (Shields switches, media cards, lightbox don't exist until opened; media needs an HTTP-served fixture). Also: axe `color-contrast` is text-only (can't verify switch-track 1.4.11 / color-independence 1.4.1); apparatus framing vs registered tools; F23 contrast gate unsatisfiable before F24b; global arrow/Delete key-hijack undesigned + untested; Step 4 non-discriminating observable; webview ids + title-tracking close label. All incorporated (DD1/DD2/DD3/DD5, checkpoints, legs, behavior-spec Steps 2/4/8).
- Cycle 2 → all 7 prior issues RESOLVED; 3 small mechanical follow-ups applied directly (axe rule-subset `--rules` param so per-checkpoint sweeps skip deferred contrast; behavior-spec offline-network claim reconciled; media fixture pinned to `tests/behavior/fixtures/a11y-media/`, HTTP-served, single-leg ownership). Within the max-2 cycle budget; follow-ups were minor → no 3rd cycle.
