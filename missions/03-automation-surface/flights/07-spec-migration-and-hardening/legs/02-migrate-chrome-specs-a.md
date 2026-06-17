# Leg: migrate-chrome-specs-a

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Rewrite the apparatus of three Group-B chrome-driving behavior specs — `unified-tab-controls`, `responsive-tab-strip`, `toolbar-pins` — from the ungated CDP-`:9222`/`cdp-driver.mjs` path onto the **admin MCP surface** (`getChromeTarget` + the drive/observe tools), preserving each spec's step semantics, continuing the SC11-part-2 bulk migration.

## Context
- **DD1** (flight): reuse the proven F6 migration template (F6 leg 04 `migrate-subset-specs`, three specs green live in leg 7). This is templated repetition of a validated apparatus, not new risk.
- **Depends on leg 1 (`pressKey-modifier-chords`)**: `toolbar-pins` Step 6 + its Shields variant assert that an *unpinned* item keeps its keyboard shortcut (`Ctrl+M` / `Ctrl+Shift+P`). The design review found the surface could not send modifier chords; per the operator decision (flight-log Decisions, 2026-06-16) leg 1 adds that capability. This leg authors `toolbar-pins`' Step 6 to use `pressKey` **with `modifiers`** — no longer a defer. (Leg 1 must land before leg 8 runs `toolbar-pins` live.)
- **The F6 leg-2 spike RESOLVED both axes**: `getChromeTarget`→chrome `wcId`; `readDom`/`readAxTree`/`captureWindow` all read the chrome; `click`/`typeText`/`pressKey` fire real handlers + native focus traversal. The one apparatus rule the spike surfaced: **establish a focus anchor (a `click`) before any keyboard-only sequence** — a cold `Tab` from the bare document does not relocate focus. Plus: **clicks are coordinate-based** (no CSS selectors) — locate controls via a `captureWindow` screenshot.
- This leg is **spec-authoring only** (markdown). The live runs happen in leg 8 `verify-integration`. Pure edits; no source.
- **`dev:debug`/`:9222` stays alive** through F7 — un-migrated specs + the eval-deferred `a11y-audit`/`farbling` still use it (hardened, not removed, at leg 6). Only these 3 specs move here.
- **Two specs carry an apparatus nuance beyond the F6 template** (see Edge Cases): `responsive-tab-strip` asserts on **layout geometry** (no numeric `getBoundingClientRect` over the surface — there is no in-page eval), so geometry becomes **screenshot-observed** via `captureWindow`; `toolbar-pins` is **dual-target** (chrome toolbar + `goldfinch://settings` guest) plus a **filesystem** read (`settings.json`), mirroring the F6 `settings-shell` dual-target pattern.

## Inputs
- `tests/behavior/unified-tab-controls.md` — drives the chrome tab strip; focus-ring visibility, container menu open/close, jar dots, roving tabindex; trusted clicks + Tab/Shift+Tab/Enter/Space; reads `document.activeElement`, the a11y tree, `.tab` DOM. Currently `:9222`/Playwright-MCP or raw CDP. (status `active`)
- `tests/behavior/responsive-tab-strip.md` — drives the chrome tab strip; tab sizing, scroll fallback on overflow, **deferred reflow on pointer-close** vs immediate on keyboard-close, window maximize/restore button state. Currently `:9222` with **real-coordinate synthetic mouse + `mouseleave`** (pointer fidelity matters). (status `active`)
- `tests/behavior/toolbar-pins.md` — **dual target**: chrome toolbar (`#toggle-media`/`#toggle-privacy` presence/visibility/badge) + `goldfinch://settings` guest (Appearance pin toggles, `aria-pressed`) + filesystem (`userData/settings.json` `toolbarPins`); live two-way sync (Appearance toggle → file → chrome re-render); `Ctrl+M` shortcut. Currently `:9222`/`cdp-driver.mjs`, dual CDP attach. (status `draft` — never run live; migrate the apparatus, leave status `draft`.)
- **Proven apparatus** (F6 leg-2 spike): `npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707` → stdout `AUTOMATION_DEV_MINT {"key","adminKey"}`; an admin MCP client (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- The 3 F6-migrated specs (`tab-keyboard-operability`, `kebab-menu`, `settings-shell`) as the reference style.

## The apparatus mapping (CDP-`:9222` → admin MCP surface)
| Old (CDP/`:9222`) | New (admin MCP surface) |
|---|---|
| `npm run dev:debug` (`:9222 --remote-allow-origins=*`) | `npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707` (no `:9222`) |
| attach to `:9222`, **select the renderer target** (index.html, not a guest) | `getChromeTarget()` → `{ wcId, kind:'chrome', url }`; pass `wcId` to the tools (no target-selection trap) |
| `Accessibility.getFullAXTree` / MCP `snapshot` | `readAxTree(wcId)` → AXNode array; focused node via the `focused` property |
| `document.activeElement` / DOM reads | `readDom(wcId)` → `{ url, title, html }` |
| CDP `Input.dispatchKeyEvent` (trusted), incl. shortcut chords | `pressKey(wcId, name)` (Tab/ArrowRight/ArrowLeft/Home/End/Delete/Backspace/Escape/Enter/ShiftTab); **modifier chords** (`Ctrl+M`, `Ctrl+Shift+P`) via `pressKey(wcId, name, modifiers)` — capability added in **leg 1** |
| no move-only primitive (induce `mouseleave` via a click) | `click(wcId, x, y)` at a safe coordinate **outside** the target region — the move-out is a side-effect of the click's `mouseMove` (the surface has no standalone mouse-move tool) |
| CDP `Input.dispatchMouseEvent` (trusted click) | `click(wcId, x, y)` — **coordinate-based** (no CSS selectors); locate the control via a `captureWindow` screenshot |
| typing | `typeText(wcId, text)` |
| screenshot / focus-ring / **layout geometry** | `captureWindow()` (whole-window PNG) or `captureScreenshot(wcId)` — **also the only way to read tab widths/overflow** (no numeric `getBoundingClientRect` over the surface) |
| settings-guest target (`goldfinch://settings`) | admin `enumerateTabs()` includes the internal guest (`allowInternal`); drive/read its `wcId` via `readDom`/`readAxTree`/`click`/`pressKey` |
| `userData/settings.json` read | filesystem read (Bash/Read on the `userData` path) — unchanged by the migration |
| precondition probe `curl :9222/json` / `cdp-driver eval` | `tools/list` shows 17 incl `getChromeTarget`; `getChromeTarget()` returns a numeric chrome `wcId` |
| `chrome-devtools` MCP disqualified | **still disqualified** (launches its own browser → false pass) — keep that warning |

## Outputs
- The 3 specs' **Preconditions / Observables Required / Step-1 probe** rewritten to the admin MCP surface; **step Actions/Expected semantics preserved** (no checkpoint added or dropped).
- Each spec carries the **focus-anchor note** (click before keyboard-only sequences) and the **coordinate-click note** (clicks by (x,y) located from a `captureWindow` screenshot, not CSS selectors).
- `responsive-tab-strip` notes that **layout-geometry assertions are screenshot-observed** (`captureWindow`) — overflow/scroll fallback, relative tab widths, and reflow timing are judged from **before/after screenshot deltas** (the Validator compares two `captureWindow` frames); the `mouseleave` that triggers the deferred re-expand is induced by a `click` at a safe coordinate **outside** the strip (no move-only primitive); maximize/restore state is read from the button's `data-state`/accessible name via `readDom`/`readAxTree`. The spec's existing Out-of-Scope (no exact-pixel floor / scroll-onset count) is preserved.
- `toolbar-pins` notes the **dual-target** apparatus (chrome via `getChromeTarget`; settings guest via admin `enumerateTabs`→guest `wcId`) and that `settings.json` is a filesystem read; the `Ctrl+M` / `Ctrl+Shift+P` shortcut is `pressKey(wcId, name, modifiers)` (leg-1 chord capability) into the chrome `wcId` after a focus anchor. **Step 9's `npm run a11y` is NOT migrated** — it is the eval-deferred `a11y-audit.mjs` harness (axe injection over the hardened `:9222`, F8-eval), invoked as a shell command; leave it as-is and note it runs against the hardened `:9222` separately.
- The 3 specs' `**Last Run**` left as-is (historical; `toolbar-pins` stays `never` — leg 8 will be its first live run). `toolbar-pins` `**Status**` stays `draft`.
- `dev:debug`/`:9222` references in OTHER specs untouched.

## Acceptance Criteria
- [x] **AC1 (apparatus rewritten, 3 specs)** — Each spec's Preconditions + Observables + Step-1 probe references the admin MCP surface (`dev:automation`, admin Bearer key, `getChromeTarget`, the drive/observe tools) instead of `dev:debug`/`:9222`/`cdp-driver.mjs`. The `chrome-devtools`-MCP-disqualified warning is preserved.
- [x] **AC2 (semantics preserved)** — Every step's Action/Expected *intent* is unchanged; only apparatus framing + mechanism words change (CDP verbs → MCP tool names, selector-clicks → coordinate-clicks, numeric geometry → screenshot observation). No checkpoint added or dropped.
- [x] **AC3 (focus-anchor + coordinate-click notes)** — Each spec states the two apparatus rules: (a) click to establish a focus anchor before keyboard-only sequences; (b) clicks are coordinate-based, located via a `captureWindow` screenshot.
- [x] **AC4 (responsive-tab-strip geometry — no numeric eval)** — `responsive-tab-strip` expresses all geometry as **visual** observation: single-frame screenshots for overflow/scroll-fallback + favicon/close visibility (Steps 2–4), and **before/after `captureWindow` deltas** for the width-invariance + reflow-timing checks (Steps 5–6, judged by the Validator comparing two frames); maximize/restore is a `data-state`/accessible-name read (Step 7). **No checkpoint depends on numeric in-page geometry** (`getBoundingClientRect`/`scrollWidth`), and the spec's existing Out-of-Scope (no exact floor px / scroll-onset count) is preserved verbatim. If any checkpoint genuinely cannot be judged visually → defer that checkpoint to F8-eval and record (do not invent a numeric read).
- [x] **AC5 (toolbar-pins dual-target + chord)** — `toolbar-pins` reads the chrome toolbar via `getChromeTarget`+`readDom`/`readAxTree`, drives/reads the `goldfinch://settings` Appearance toggles via admin `enumerateTabs`→guest `wcId`, reads `settings.json` via the filesystem, and fires the `Ctrl+M` (and Shields-variant `Ctrl+Shift+P`) shortcut via `pressKey(wcId, name, modifiers)` (leg-1 chord capability) after a focus anchor — no `:9222`/`cdp-driver` for the *driving* apparatus. Step 9's `npm run a11y` is left verbatim (the F8-deferred axe harness, invoked as a shell command). Status stays `draft`.
- [x] **AC6 (no stray old-apparatus refs in the 3 specs)** — `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/{unified-tab-controls,responsive-tab-strip,toolbar-pins}.md` returns nothing. (Step 9's a11y step is invoked as `npm run a11y` and carries no port literal, so it does not trip the grep; the harness's own use of the hardened `:9222` is internal to `a11y-audit.mjs`, F8-deferred.)
- [x] **AC7 (eval-free driving)** — None of the 3 migrated specs' *driving/observation* steps assert on script-runtime values absent from `outerHTML`/the a11y tree/a screenshot. The only retained eval-dependent step is `toolbar-pins` Step 9's `npm run a11y` (explicitly F8-deferred, run as a shell harness — not migrated). Any *other* residual needing in-page JS eval → defer that part to F8-eval and record per the flight's divert criteria.
- [x] **AC8** — `npm test`/typecheck/lint unaffected (spec docs; expect green).

## Verification Steps
- AC1–AC5, AC7: read each rewritten spec; confirm the apparatus is the MCP surface, semantics intact, notes present, geometry/dual-target framing correct, no script-runtime reads.
- AC6: `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/{unified-tab-controls,responsive-tab-strip,toolbar-pins}.md` — empty.
- AC8: `npm test && npm run typecheck && npm run lint` (with the project's fail-fast timeout).
- **Live confirmation is leg 8** — this leg only authors; the actual green runs against the admin surface happen in `verify-integration`. (The F6 spike already proved the apparatus on the chrome.)

## Implementation Guidance
1. **Use the mapping table above** for every apparatus reference. Mirror the framing of an already-migrated spec (`tests/behavior/tab-keyboard-operability.md` Preconditions: port-pin + Bearer-key + `getChromeTarget` probe) for consistency.
2. **unified-tab-controls**: Step-1 probe → `getChromeTarget` returns a numeric chrome `wcId`. New-tab/container-menu clicks → `click(wcId, x, y)` located via `captureWindow`. Focus/activation via `pressKey(wcId, Tab/ShiftTab/Enter/Space)` — precede the first keyboard sequence with a focus-anchor `click` in the chrome. Roving-tabindex / `aria-selected` / focused-node → `readAxTree(wcId)`; `.tab` jar-dot DOM → `readDom(wcId)`; focus-ring delta → `captureWindow()`.
3. **responsive-tab-strip**: Step-1 probe → `getChromeTarget`. **Geometry is screenshot-observed** — overflow/scroll-fallback (scrollbar appears), relative tab widths, and the deferred-reflow-on-pointer-close vs immediate-on-keyboard-close timing are judged from before/after `captureWindow()` screenshots (the Validator compares two frames). Pointer-close = `click(wcId, x, y)` on a tab's close affordance with the cursor left over the strip; the **deferred re-expand fires on `mouseleave`** — induce it with a `click(wcId, x, y)` at a safe coordinate **outside** the tab strip (the move-out is a side-effect of the click's `mouseMove`; there is no move-only tool). Keyboard-close = focus-anchor then `pressKey` (immediate reflow). Window maximize/restore button → `click` the control; read its `data-state`/accessible name via `readDom`/`readAxTree`. **Call out** that there is no numeric geometry read over the surface — the screenshot is the source of truth (mirror the coordinate-click note). If the Validator cannot cleanly separate "reflow on `mouseleave`" from "reflow on the click itself," flag that checkpoint as a candidate F8-eval defer and record.
4. **toolbar-pins**: Step-1 probe → `getChromeTarget`. Chrome toolbar (`#toggle-media`/`#toggle-privacy` presence/visibility/badge) → `readDom`/`readAxTree`/`captureWindow` on the chrome `wcId`. Settings Appearance toggles → open `goldfinch://settings`, find its guest entry via admin `enumerateTabs()`, drive/read via the guest `wcId` (`click` the pin toggle located via `captureWindow`/screenshot; read `aria-pressed` via `readAxTree`). `settings.json` `toolbarPins` → filesystem read on the `userData` path. Two-way sync = toggle in guest → re-read file → re-read chrome toolbar. **Step 6 shortcut** = focus-anchor `click` in the chrome, then `pressKey(chromeWcId, 'M', ['control'])` (Shields variant: `pressKey(chromeWcId, 'P', ['control','shift'])`) — the **leg-1 chord capability**. **Step 9 (`npm run a11y`)**: leave the action verbatim — it is the F8-deferred axe harness (its own `a11y-audit.mjs` run over the hardened `:9222`), invoked as a shell command, NOT migrated to the MCP surface; add a one-line note in the spec that this step is the deferred a11y harness run separately. Keep status `draft`. Replace all `cdp-driver.mjs` *driving* references (not the `npm run a11y` shell step).
5. **Do NOT** touch `Last Run` lines, `## Out of Scope`, or assertion semantics. **Do NOT** edit any other spec's `:9222`. Leave the historical `runs/` logs alone.

## Edge Cases
- **Focus anchor**: every keyboard-only sequence (unified-tab roving tabindex, toolbar-pins `Ctrl+M`) must be preceded by a `click` to anchor focus — call it out so leg-8 runs don't false-fail on a cold `Tab`.
- **Coordinate clicks**: no CSS selectors over MCP — locate controls via a `captureWindow` screenshot then `click(wcId, x, y)`. Exact coords are environment/zoom-dependent; the screenshot is the source of truth.
- **No move-only primitive (responsive-tab-strip `mouseleave`)**: the surface has no standalone mouse-move tool — `click` always emits move→down→up. To trigger the strip's `mouseleave` (the deferred re-expand), `click` at a safe coordinate outside the strip (mid web-content); the move-out is the click's side-effect. Pick a coordinate that won't activate web content or shift a meaningful focus.
- **Modifier chords (toolbar-pins Step 6)**: `Ctrl+M`/`Ctrl+Shift+P` require the **leg-1** `pressKey(wcId, name, modifiers)` capability — author Step 6 against it. Leg 1 must land before leg 8 runs `toolbar-pins` live; if leg 1 were skipped this checkpoint would have to defer to F8-eval (it is NOT deferred now).
- **responsive-tab-strip geometry without eval**: the old spec read numeric widths/`scrollWidth` (runtime values, not in `outerHTML`); the surface has **no in-page eval**, so these become **visual** judgments (single-frame for overflow; before/after deltas for width-invariance). If any width assertion genuinely cannot be made visually (needs an exact pixel count) → defer that checkpoint to F8-eval and record; do not invent a numeric read.
- **toolbar-pins Step 9 a11y is not migrated**: `npm run a11y` is the F8-deferred axe-injection harness over the hardened `:9222`; it stays a shell step, run separately from the MCP-surface driving apparatus. Don't rewrite it to MCP tools (the surface has no axe-rule evaluation).
- **toolbar-pins dual target**: the chrome toolbar is on the chrome `wcId` (`getChromeTarget`); the Appearance toggles are on the **guest** `wcId` (from `enumerateTabs`). Two distinct targets — keep them straight (same trap as F6 `settings-shell`).
- **Admin-only**: all three need the **admin** key (chrome + internal-guest access). A jar key would be refused `getChromeTarget` (`admin-only`) and could not see the internal guest — note the admin requirement in Preconditions.
- **toolbar-pins is `draft`**: migrate the apparatus but do NOT promote it to `active` or fabricate a `Last Run` — it has never run live; leg 7 will be its first live run.

## Files Affected
- `tests/behavior/unified-tab-controls.md` — apparatus → admin MCP surface.
- `tests/behavior/responsive-tab-strip.md` — apparatus → admin MCP surface (+ geometry-via-screenshot note).
- `tests/behavior/toolbar-pins.md` — apparatus → admin MCP surface (+ dual-target/filesystem framing); status stays `draft`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `grep` over the 3 specs shows no `9222`/`cdp-driver`/`dev:debug`/`remote-debugging`
- [x] `npm test`/typecheck/lint green (sanity)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg (committed with the Phase-2d review block)

## Citation Audit
Citations to verify at design-review time (2026-06-16): the apparatus mapping is the proven F6 leg-04 table (`missions/03-automation-surface/flights/06-chrome-dogfood-affordance/legs/04-migrate-subset-specs.md:22-34`) grounded in the F6 leg-2 spike. Tool surface: `src/main/automation/mcp-tools.js` (17-tool registry: `DRIVE_TOOLS`+`OBSERVE_TOOLS`+`CHROME_TOOLS`); auto-mint: `src/shared/automation-dev.js:shouldAutoMint` + `src/main/main.js` (`AUTOMATION_DEV_MINT` stdout line); `package.json:dev:automation`. Spec current-apparatus lines confirmed by recon: `unified-tab-controls.md` (`:9222`/Playwright-MCP/curl probe), `responsive-tab-strip.md` (`:9222`/real-coordinate mouse), `toolbar-pins.md` (`cdp-driver.mjs`/dual-target/`settings.json`). The design-review Developer cross-checks all of these against current code.
