# Leg: migrate-subset-specs

**Status**: completed
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

## Objective
Rewrite the apparatus of three Group-B chrome-driving behavior specs — `tab-keyboard-operability`, `kebab-menu`, `settings-shell` — from the ungated CDP-`:9222`/`cdp-driver.mjs` path onto the **admin MCP surface** (`getChromeTarget` + the drive/observe tools), keeping each spec's step semantics, to prove SC11-part-1 dogfooding.

## Context
- **DD4/DD5** (flight): migrate a representative subset (proof), defer the bulk. The three together exercise the whole new capability — chrome trusted input (tab/kebab), chrome DOM/a11y read, and the internal-guest path (settings-shell).
- **The leg-2 spike RESOLVED both axes** (flight-log Decisions, 2026-06-15): `getChromeTarget`→chrome `wcId`; `readDom`/`readAxTree` (335 nodes, confound-free)/`captureWindow` all work on the chrome; `click`/`typeText`/`pressKey` fire real handlers + native focus traversal. So **no divert** — the migrations may assert via the a11y tree AND DOM-shape AND trusted input. The one apparatus rule the spike surfaced: **establish a focus anchor (a `click`) before any keyboard-only sequence** — a cold `Tab` from the bare document does not relocate focus.
- This leg is **spec-authoring only** (markdown). The live runs happen in leg 7 `verify-integration`. Pure edits; no source.
- **`dev:debug`/`:9222` stays alive** — the un-migrated Group-B specs still use it (F6→F7 constraint). Only these 3 specs move.

## Inputs
- `tests/behavior/tab-keyboard-operability.md` — drives the tab strip in the chrome renderer; a11y-tree + focus-ring screenshot + trusted arrow/Home/End/Delete keys; Step 8 clicks `#address`.
- `tests/behavior/kebab-menu.md` — drives the toolbar kebab (⋮) menu in the chrome renderer; trusted click + keyboard APG menu pattern; uses `scripts/cdp-driver.mjs`.
- `tests/behavior/settings-shell.md` — opens `goldfinch://settings` (internal guest) + reads the chrome address-bar chip; drives BOTH the renderer and the internal guest target.
- **Proven apparatus** (leg-2 spike): `dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707` → stdout `AUTOMATION_DEV_MINT {"key","adminKey"}`; an admin MCP client (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- The 6 already-migrated Group-A specs (`mcp-auth-gating`, `mcp-drive-end-to-end`, etc.) as the reference style for the MCP-surface apparatus framing.

## The apparatus mapping (CDP-`:9222` → admin MCP surface)
| Old (CDP/`:9222`) | New (admin MCP surface) |
|---|---|
| `npm run dev:debug` (`:9222 --remote-allow-origins=*`) | `npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707` (no `:9222`) |
| attach to `:9222`, **select the renderer target** (index.html, not a guest) | `getChromeTarget()` → `{ wcId, kind:'chrome', url }`; pass `wcId` to the tools (no target-selection trap) |
| `Accessibility.getFullAXTree` / MCP `snapshot` | `readAxTree(wcId)` → AXNode array; focused node via the `focused` property |
| `document.activeElement` / DOM reads | `readDom(wcId)` → `{ url, title, html }` |
| CDP `Input.dispatchKeyEvent` (trusted) | `pressKey(wcId, name)` (Tab/ArrowRight/ArrowLeft/Home/End/Delete/Backspace/Escape/Enter/ShiftTab) |
| CDP `Input.dispatchMouseEvent` (trusted click) | `click(wcId, x, y)` — **coordinate-based** (no CSS selectors); locate the control via a `captureWindow` screenshot |
| typing | `typeText(wcId, text)` |
| screenshot (focus-ring delta) | `captureWindow()` (whole-window PNG) or `captureScreenshot(wcId)` |
| precondition probe `curl :9222/json` | `tools/list` shows 17 incl `getChromeTarget`; `getChromeTarget()` returns a numeric chrome `wcId` |
| `chrome-devtools` MCP disqualified | **still disqualified** (launches its own browser → false pass) — keep that warning |

## Outputs
- The 3 specs' **Preconditions / Observables Required / Step-1 probe** rewritten to the admin MCP surface; **step Actions/Expected semantics preserved**.
- Each spec carries the **focus-anchor note** (click before keyboard-only sequences) and the **coordinate-click note** (clicks are by (x,y) located from a `captureWindow` screenshot, not CSS selectors).
- `settings-shell` notes the admin engine's **`allowInternal`** access to the `goldfinch://settings` guest (enumerable + drivable by admin) and reads the chrome chip via `getChromeTarget`+`readDom`/`readAxTree`.
- The stale **`mcp-jar-scoping.md:81`** openTab v1-limitation note (carried from leg 3) updated to reflect that `openTab` jar-targeting now exists (DD3) — confinement is now enforced, not a documented gap. (Not a `:9222` migration; folded here per the leg-3 follow-up.)
- The 3 specs' `**Last Run**` left as-is (historical) — leg 7 appends new run logs; do not fabricate a run timestamp here.
- `dev:debug`/`:9222` references in OTHER specs untouched.

## Acceptance Criteria
- [x] **AC1 (apparatus rewritten, 3 specs)** — Each spec's Preconditions + Observables + Step-1 probe references the admin MCP surface (`dev:automation`, admin Bearer key, `getChromeTarget`, the drive/observe tools) instead of `dev:debug`/`:9222`/`cdp-driver.mjs`. The `chrome-devtools`-MCP-disqualified warning is preserved.
- [x] **AC2 (semantics preserved)** — Every step's Action/Expected *intent* is unchanged; only the apparatus framing and the mechanism words (CDP verbs → MCP tool names, selector-clicks → coordinate-clicks) change. No checkpoint is added or dropped.
- [x] **AC3 (focus-anchor + coordinate-click notes)** — Each spec states the two leg-2-derived apparatus rules: (a) click to establish a focus anchor before keyboard-only sequences; (b) clicks are coordinate-based, located via a `captureWindow` screenshot.
- [x] **AC4 (settings-shell internal-guest)** — `settings-shell` reflects that the **admin** identity enumerates + drives the `goldfinch://settings` internal guest (allowInternal) and reads the chrome chip via `getChromeTarget`, with no `:9222`/`cdp-driver` dependency.
- [x] **AC5 (mcp-jar-scoping note)** — `mcp-jar-scoping.md:81`'s "openTab is delegated and cannot target the jar … known v1 limitation" note is updated: `openTab` jar-targeting is implemented (leg 3 / DD3); a jar key's tab now lands in-jar or is refused. (Informational note, not a new assertion.)
- [x] **AC6 (no stray old-apparatus refs in the 3 specs)** — `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/{tab-keyboard-operability,kebab-menu,settings-shell}.md` returns nothing.
- [x] **AC7** — `npm test`/typecheck/lint unaffected (spec docs; expect green).

## Verification Steps
- AC1–AC4, AC6: read each rewritten spec; confirm the apparatus is the MCP surface, semantics intact, notes present, and `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging"` over the 3 specs is empty.
- AC5: `grep -n "v1 limitation\|cannot target the jar\|openTab" tests/behavior/mcp-jar-scoping.md` — the note reflects the implemented jar-targeting.
- AC7: `npm test && npm run typecheck && npm run lint`.
- **Live confirmation is leg 7** — this leg only authors; the actual green runs against the admin surface happen in `verify-integration`. (The leg-2 spike already proved the apparatus works on the chrome, so a divert here is not expected.)

## Implementation Guidance
1. **Use the mapping table above** for every apparatus reference. Mirror the framing of an already-migrated Group-A spec (e.g. `mcp-auth-gating.md`'s port-pin + Bearer-key Preconditions) for consistency.
2. **tab-keyboard-operability**: Step 1 probe → `getChromeTarget` returns a numeric chrome `wcId`. Steps 3–8: `pressKey(wcId, …)` for Tab/arrows/Home/End/Delete; `readAxTree(wcId)` for the `tablist`/`tab`/`aria-selected`/focused-node assertions; `captureWindow()` for the focus-ring delta screenshot; Step 8's "click `#address`" → `click(wcId, x, y)` at the address-bar coordinates (located via `captureWindow`; the spike confirmed ≈ (400, 63) hits the omnibox at 1400×900). Add the focus-anchor note to Step 3 (a `click` in the chrome before tabbing in).
3. **kebab-menu**: Step 1 probe → `getChromeTarget`. Trusted click on the kebab (⋮, top-right of the toolbar — coordinate via `captureWindow`); `readAxTree` for `aria-haspopup`/`aria-expanded`/the two menu items / focus management; `pressKey` Escape/arrows/Enter for the APG keyboard pattern; `captureWindow`/`captureScreenshot` for the focus-ring. Replace the `scripts/cdp-driver.mjs` references.
4. **settings-shell**: Step 1 probe → `getChromeTarget`. Open Settings (kebab→Settings via trusted click, or note the trusted `createTab('goldfinch://settings', …)` path). The `goldfinch://settings` guest is **admin-enumerable** (`enumerateTabs` under the admin engine includes the internal tab) and drivable via its `wcId` (admin `allowInternal`); read its guest DOM via `readDom(guestWcId)`/`readAxTree(guestWcId)`. Read the chrome **address-bar chip** via `getChromeTarget`+`readDom`/`readAxTree`. The internal-tab-nav-lock check: type a web URL in the `goldfinch://` tab → a new normal tab opens (drive via the chrome + `enumerateTabs`).
5. **mcp-jar-scoping.md:81**: rewrite the v1-limitation note to: jar-targeted `openTab` is implemented (leg 3 / DD3) — a jar key's new tab lands in its own jar (or is refused), so the tab is enumerable/confined; the old "cannot target the jar" caveat no longer applies. Keep it informational (not a new step assertion) unless a clean assertion is obvious.
6. **Do NOT** touch `Last Run` lines, the `## Out of Scope`, or the assertion semantics. **Do NOT** edit any other spec's `:9222`. Leave the historical `runs/` logs alone.

## Edge Cases
- **Focus anchor**: every keyboard-only sequence (tab-keyboard Step 3, kebab keyboard nav) must be preceded by a `click` to anchor focus — call it out so leg-7 runs don't false-fail on a cold `Tab`.
- **Coordinate clicks**: no CSS selectors over MCP — the spec instructs locating controls via a `captureWindow` screenshot then `click(wcId, x, y)`. Note exact coords are environment/zoom-dependent; the screenshot is the source of truth.
- **settings-shell dual target**: the chrome chip is on the chrome `wcId` (`getChromeTarget`); the settings content is on the **guest** `wcId` (from `enumerateTabs`). Two distinct targets — keep them straight.
- **Admin-only**: these specs require the **admin** key (chrome + internal access). A jar key would be refused `getChromeTarget` (`admin-only`) and could not see the internal guest — note the admin requirement in Preconditions.

## Files Affected
- `tests/behavior/tab-keyboard-operability.md` — apparatus → admin MCP surface.
- `tests/behavior/kebab-menu.md` — apparatus → admin MCP surface.
- `tests/behavior/settings-shell.md` — apparatus → admin MCP surface (+ internal-guest framing).
- `tests/behavior/mcp-jar-scoping.md` — update the stale openTab v1-limitation note (line ~81).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `grep` over the 3 specs shows no `9222`/`cdp-driver`/`dev:debug`/`remote-debugging`
- [x] `npm test`/typecheck/lint green (sanity)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg (committed with the live block)

## Citation Audit
Verified against current spec text at leg design time (2026-06-15): `tab-keyboard-operability.md` (Preconditions/Observables/Steps 1–8, `:9222`/Playwright-MCP/`#address` click), `kebab-menu.md` (Preconditions/`cdp-driver.mjs`/Step-1 probe), `settings-shell.md` (Preconditions/`cdp-driver.mjs`/dual renderer+guest target), `mcp-jar-scoping.md:81` (openTab v1-limitation note) — all OK. The apparatus mapping is grounded in the leg-2 spike's confirmed tool behavior (flight-log Decisions, 2026-06-15).
