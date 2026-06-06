# Leg: control-names-and-focus

**Status**: completed
**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](../flight.md)

## Objective
Give every icon-only chrome control an accessible name, keep the reload control's name in sync with its Stop/Reload state, name the Shields switches, and add a visible keyboard focus indicator across the chrome (F23) — then stand up the reusable axe-core audit harness (`npm run a11y`) and a committed media fixture that the F23/F24 sweeps run against.

## Context
- Flight **DD3**: the axe harness attaches to the running app's renderer target at `:9222`, injects `axe-core` (net-new devDependency — confirmed ABSENT in `package.json`), and exits non-zero on violations. It MUST accept a rule/tag filter so per-checkpoint sweeps can skip deferred rules, MUST drive the UI into each state before auditing (collapsed panels/lightbox aren't in the DOM otherwise), and audits an HTTP-served media fixture (the media panel never catalogs `file://` sources).
- **DD5 ordering**: this leg's axe gate is scoped to **`button-name` + aria-validity** only. `color-contrast` is deferred to F24b (the `--fg-dim` Shields text isn't remediated here); `label` is also deferred to F24b (its only failing control — the media-pick checkbox — is labeled in the F24b leg). So leg 2 runs `--rules=button-name,aria-allowed-attr,aria-valid-attr-value,aria-required-attr,aria-roles` (NOT `label`/`color-contrast`).
- **Leg 1 cross-leg note**: the harness MUST exclude `nested-interactive` (the `role="tab"` + focusable close `<button>` is an accepted, documented pattern — see `01-tab-strip-a11y.md` "Cross-Leg Note").
- **DD4**: renderer is `@ts-check`'d, `sourceType:"script"` — budget casts on new DOM access; offline gates (`npm test` + `npm run typecheck` + `npm run lint`) must stay clean. `scripts/**` already has an ESM lint block (Flight 2) for `.mjs` files.
- **GUI-dependence**: the harness needs the live app at `:9222`, which the autonomous implementer can't launch. So its *execution* is deferred to `verify-a11y` (like the behavior test). This leg's harness ACs are authoring/syntax/lint/wiring only; the green multi-state run is a verify-leg concern.
- Leg 2 of 5. Leg 1 (`tab-strip-a11y`) is `landed` (uncommitted). Citations below were re-located against current `main` **after** leg 1's edits.

## Inputs
- `src/renderer/index.html` — icon-only buttons: `#new-tab` (`:16`), `#new-tab-menu` (`:17`), `#back` (`:24`), `#forward` (`:25`), `#reload` (`:26`), `#media-close` (`:55`), `#privacy-close` (`:90`), `#lightbox-zoom-out` (`:105`), `#lightbox-zoom-in` (`:107`), `#lightbox-close` (`:109`), `#player-prev`/`#player-play`/`#player-next` (`:75-77`). (`#toggle-media`/`#toggle-privacy` carry visible span text; `#lightbox-zoom-reset` has visible "Fit"; `#brand` has `alt`.)
- `src/renderer/renderer.js` — reload glyph swap: `did-start-loading` sets `els.reload.textContent='✕'` (`:242`), `did-stop-loading` sets `'⟳'` (`:245`); click handler stop-check (`:364`). Shields switch factory `toggle(on, onChange)` (`:1096-1103`; `role="switch"`+`aria-checked` set, **no name**); called for the enable toggle (`:1037`) and per `SHIELD_ROWS` row (`:1064`); row label text at `:1055` (`lbl.textContent = label`), `SHIELD_ROWS` at `:1020-…`.
- `src/renderer/styles.css` — `#address {` block at `:155` (`outline: none` at `:163`), `#address:focus { border-color }` at `:166-168`; leg 1 added `.tab:focus-visible` at `:99-103`. No other `:focus-visible`.
- `src/renderer/renderer.js` — also `iconBtn(glyph, title, onClick)` (`:542-552`): media-card action buttons (`.icon-action`) built icon-only with `title` only (no `aria-label`).
- `package.json` — scripts (no `a11y`), devDependencies (no `axe-core`). Fixtures convention: `tests/behavior/fixtures/<slug>/` served via `python3 -m http.server`.
- `eslint.config.mjs` — has a `scripts/**` ESM block (from Flight 2).

## Outputs
- Every icon-only control has an explicit `aria-label`; reload name tracks Stop/Reload; Shields switches are named; a visible `:focus-visible` ring exists across chrome controls (incl. `#address`).
- `scripts/a11y-audit.mjs` + `npm run a11y` (axe-core devDep) authored, syntax-valid, lint-clean, with rule-filter + multi-state + fixture support; `tests/behavior/fixtures/a11y-media/` committed.
- Offline gates green.

## Acceptance Criteria
- [x] Every icon-only button has an explicit `aria-label`: `#back`→"Back", `#forward`→"Forward", `#reload`→"Reload", `#new-tab`→"New tab", `#new-tab-menu`→"New tab in a container", `#media-close`→"Close media panel", `#privacy-close`→"Close privacy panel", `#lightbox-zoom-out`→"Zoom out", `#lightbox-zoom-in`→"Zoom in", `#lightbox-close`→"Close image viewer", `#player-prev`→"Previous track", `#player-play`→"Play / pause", `#player-next`→"Next track". (Existing `title` tooltips retained.)
- [x] The reload control's accessible name tracks its state: when it acts as Stop (`did-start-loading`, `:242`) its `aria-label` (and `title`) becomes "Stop"; when it returns to Reload (`did-stop-loading`, `:245`) it returns to "Reload". (Both updated, not just `textContent`.)
- [x] The Shields switch factory `toggle()` accepts a label and sets `aria-label` on the switch; the enable toggle is named (e.g. "Shields") and each row switch is named from its row label (e.g. "Block trackers", "Strip tracking params", "Isolate 3rd-party cookies", "Farble fingerprint"). No `role="switch"` element is left without an accessible name.
- [x] The dynamically-created media-card action buttons (`iconBtn`, `.icon-action`) get an explicit `aria-label` from their `title` (one line in `iconBtn`) — for consistency with the durable-name rationale (they already pass `button-name` via `title`).
- [x] A visible keyboard focus indicator exists across interactive chrome via `:focus-visible` (outline ≥3:1, e.g. `2px solid var(--accent)`), including an explicit `#address:focus-visible` rule (its id-specificity `outline:none` would otherwise win). Leg 1's `.tab:focus-visible` is preserved.
- [x] `axe-core` is added to `devDependencies` and installed (present in `package-lock.json`).
- [x] `scripts/a11y-audit.mjs` exists and: connects to the renderer target at `http://127.0.0.1:9222` (selecting the target whose `url` ends with `index.html` — guests are `http(s)://…`), injects axe-core, runs `axe.run()`, prints a per-violation summary, and exits non-zero if any violation in the active rule set is found. It accepts a `--rules=<comma-list>` (or `--tags=`) filter and **excludes `nested-interactive`** (inline comment citing leg 1's rationale). It **audits each state separately and aggregates** — open the media panel and `axe.run`, then open the privacy panel and `axe.run`, then open the lightbox and `axe.run` — because the panels are mutually exclusive (`togglePrivacy(true)` closes the media panel, `renderer.js:921`) and `renderPrivacy()` only renders the switches when actually opened (it early-returns on `.collapsed`, `:1139`). Drive panels by calling the renderer's toggles / clicking the controls (`togglePrivacy(true)`, `togglePanel(true)`), **not** by removing the `.collapsed` class.
- [x] `package.json` has an `"a11y"` script invoking the harness (e.g. `"a11y": "node scripts/a11y-audit.mjs"`).
- [x] `tests/behavior/fixtures/a11y-media/` contains an `index.html` referencing a known image + audio + video (same-dir/local assets so the media panel catalogs them — **no `<iframe>` embed**: `webview-preload.js:163-167` only catalogs embeds from youtube/vimeo/etc., so a local embed won't appear) and a `README.md` documenting how to serve it (`python3 -m http.server`), matching the sibling-fixture convention.
- [x] `node --check scripts/a11y-audit.mjs` passes (syntax valid); `npm run lint` is clean for the new `.mjs` (scripts ESM block covers it).
- [x] `npm test` (147 pass — no unit changes expected), `npm run typecheck` (0 errors), `npm run lint` (0 problems) all clean.
- [x] Live multi-state `npm run a11y` run is **deferred to `verify-a11y`** — noted in the flight log, not run here (no GUI in the autonomous leg).

## Verification Steps
- `grep -n 'aria-label' src/renderer/index.html` → present on all listed icon buttons.
- `grep -n "els.reload.setAttribute('aria-label'\|els.reload.title" src/renderer/renderer.js` → reload name synced in both did-start/did-stop handlers.
- `grep -n "aria-label" src/renderer/renderer.js` near `toggle(` → switch naming wired; confirm `toggle(` call sites (`:1037`, `:1064`) pass a label.
- `grep -n ':focus-visible' src/renderer/styles.css` → global/control + `#address:focus-visible` rules present (plus leg 1's `.tab`).
- `node --check scripts/a11y-audit.mjs` → exit 0. `grep -n "nested-interactive\|--rules\|9222" scripts/a11y-audit.mjs` → filter + exclusion + endpoint present.
- `node -e "require('axe-core')"` (or check `package-lock.json`) → axe-core resolvable.
- `ls tests/behavior/fixtures/a11y-media/` → `index.html` + `README.md`.
- `npm run typecheck` → 0 errors; `npm run lint` → exit 0; `npm test` → 147 pass.
- Deferred to `verify-a11y`: `npm run a11y` (full multi-state sweep) against the running app.

## Implementation Guidance

1. **`index.html` aria-labels** — add `aria-label="…"` to each icon-only button listed in AC 1 (keep existing `title`). Example: `<button id="back" class="icon-btn" title="Back" aria-label="Back">◀</button>`.

2. **Reload name sync (`renderer.js`)** — set an initial `aria-label="Reload"` on `#reload` in index.html, then in the webview handlers update name with glyph:
   - `:242` (`did-start-loading`): after setting `textContent='✕'`, add `els.reload.setAttribute('aria-label', 'Stop'); els.reload.title = 'Stop';`
   - `:245` (`did-stop-loading`): after `textContent='⟳'`, add `els.reload.setAttribute('aria-label', 'Reload'); els.reload.title = 'Reload';`

3. **Shields switch naming (`renderer.js:1096`)** — extend `toggle(on, onChange, label)`; inside, `if (label) t.setAttribute('aria-label', label);`. Update call sites:
   - `:1037` enable toggle → `toggle(!!cfg.enabled, (v) => setShield('enabled', v), 'Shields')`
   - `:1064` row toggle → `toggle(!!cfg[key], (v) => setShield(key, v), label)` (the `label` is already in scope from `for (const [key, label] of SHIELD_ROWS)`).

3b. **Media-card action buttons (`renderer.js:542-552`)** — in `iconBtn`, after `b.title = title;` add `b.setAttribute('aria-label', title);` (the glyph stays as visible content; the label makes the name explicit).

4. **Focus-visible (`styles.css`)** — add a control-scoped rule and an `#address` override (place near leg 1's `.tab:focus-visible`):
   ```css
   .icon-btn:focus-visible,
   .text-btn:focus-visible,
   .filter:focus-visible,
   .switch:focus-visible,
   .icon-action:focus-visible,
   #player-controls button:focus-visible,
   .cm-item:focus-visible,
   a:focus-visible {
     outline: 2px solid var(--accent);
     outline-offset: 2px;
   }
   #address:focus-visible {
     outline: 2px solid var(--accent);
     outline-offset: 1px;
   }
   ```
   (Leave the existing `#address:focus { border-color }` as the additional cue. Do not remove `outline:none`; the `:focus-visible` rule re-adds the ring for keyboard focus.)

5. **axe harness `scripts/a11y-audit.mjs`** — an ES module (project is CJS, so `.mjs`). Outline:
   - Parse argv for `--rules=a,b,c` (and/or `--tags=`) and an optional `--url=` fixture URL.
   - GET `http://127.0.0.1:9222/json` → pick the target whose `url` ends with `index.html` (the renderer), grab its `webSocketDebuggerUrl`. Halt with a clear message if `:9222` is unreachable (mirror the behavior-test probe).
   - Connect over CDP. Prefer Node's global `WebSocket` (dev Node is 22) to avoid a new runtime dep; if unavailable, the implementer may add a minimal CDP client dep — keep deps minimal, document the choice.
   - Drive states before auditing: navigate the active tab to the fixture URL; open the media panel; open the privacy panel (so `pShields()` renders the switches); open the lightbox on a fixture image. Use `Runtime.evaluate` calling the renderer's own functions / clicking the controls.
   - Read `node_modules/axe-core/axe.min.js`, inject via `Runtime.evaluate`, then call `axe.run(document, { runOnly: <rules or tags>, rules: { 'nested-interactive': { enabled: false } } })`. **`axe.run` returns a Promise** — the `Runtime.evaluate` that calls it must pass `awaitPromise: true` and `returnByValue: true` so the violations come back as a value (easy to miss when authoring blind).
   - **Per-state, then aggregate**: `axe.run` once per opened state (media panel, privacy panel, lightbox) since they're mutually exclusive; collect all violations.
   - Print `id — impact — node count` per violation; `process.exit(totalViolations ? 1 : 0)`.
   - Top-of-file comment: why `nested-interactive` is disabled (leg 1 tab/close pattern), and that default (no `--rules`) runs the full set used at verify.

6. **`package.json`** — add `"a11y": "node scripts/a11y-audit.mjs"` to scripts; add `axe-core` to `devDependencies` via `npm install -D axe-core` (**needs network** — if the autonomous environment is offline, signal `[BLOCKED: axe-core install needs network]` rather than hand-editing `package.json` without a lockfile entry). axe-core is dev-only, so `ci.yml`'s `npm audit` is unaffected.

7. **Fixture `tests/behavior/fixtures/a11y-media/`** — `index.html` with at least one `<img>`, one `<audio>`, one `<video>` (and optionally an `<iframe>` embed) using small inline/data or same-dir asset sources so the media panel catalogs them; `README.md` with the serve instruction (`python3 -m http.server` → `http://127.0.0.1:8000/`). Match the tone of `tests/behavior/fixtures/tab-scheme-guard/README.md`.

## Edge Cases
- **`title` already satisfies `button-name`**: most toolbar buttons pass axe `button-name` via `title` even today; the explicit `aria-label` is the durable fix (and the real failing control is the unnamed switch). Don't remove `title` — keep both.
- **`#address:focus-visible` specificity**: the id selector `#address { outline:none }` (1,0,0) beats a bare `:focus-visible` (0,1,0) — the id-specific `#address:focus-visible` (1,1,0) is required, hence its own rule.
- **Harness can't run offline**: do NOT block the leg on a green `npm run a11y` — it needs the GUI. Verify only syntax/lint/wiring here; the live run is `verify-a11y`.
- **Node WebSocket availability**: global `WebSocket` is stable in Node 22 (dev), behind a flag in Node 20. The a11y gate is dev/verify-only (not CI), so Node 22 is acceptable; document it.
- **`@ts-check` does not cover `.mjs` under `scripts/`** unless `checkJs` globs it; the harness is a script, lint covers it. Renderer `.js` edits (reload sync, toggle label) need standard casts only if reading DOM — these are `setAttribute`/`title` writes on already-typed `els.*`, so no new casts expected.

## Files Affected
- `src/renderer/index.html` — `aria-label` on icon-only buttons (+ `#reload` initial label).
- `src/renderer/renderer.js` — reload name sync (did-start/did-stop), `toggle()` label param + 2 call sites, `iconBtn` aria-label.
- `src/renderer/styles.css` — `:focus-visible` control rules + `#address:focus-visible`.
- `scripts/a11y-audit.mjs` — new axe harness.
- `package.json` (+ `package-lock.json`) — `a11y` script + `axe-core` devDependency.
- `tests/behavior/fixtures/a11y-media/index.html`, `tests/behavior/fixtures/a11y-media/README.md` — new fixture.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (offline ones; harness live-run deferred)
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint`; `node --check` the harness)
- [x] Update flight-log.md with leg progress entry (incl. that the live `npm run a11y` run is deferred to verify)
- [x] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md _(deferred to the flight-level review/commit)_
- [x] (Not the final leg — no flight-level status change)
- [ ] Commit handled at the deferred flight-level review/commit, not per-leg

## Citation Audit
Citations re-located against current `main` after leg 1's edits and verified `OK`: `renderer.js:242/245` (reload glyph swap), `:364` (stop-check), `:542-552` (`iconBtn`), `:1096-1103` (`toggle()`), `:1037`/`:1064` (toggle call sites), `:1020`/`:1055` (SHIELD_ROWS / row label), `:1139` (renderPrivacy collapsed early-return), `:921` (togglePrivacy closes media panel); `index.html:16,17,24,25,26,55,75-77,90,105,107,109` (icon buttons). **Corrected (design review)**: `styles.css` `#address` block `:155`, `outline:none` `:163`, `#address:focus` `:166-168`, leg-1 `.tab:focus-visible` `:99-103` (earlier draft cited `:153/156-158/94-98` — drift repaired). `webview-preload.js:163-167` (embed allowlist). `axe-core` confirmed ABSENT in `package.json` (net-new). All `OK`.
