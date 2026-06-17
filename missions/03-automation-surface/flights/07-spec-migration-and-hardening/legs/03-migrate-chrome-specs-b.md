# Leg: migrate-chrome-specs-b

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Rewrite the apparatus of three more Group-B specs — `menu-dismissal`, `tab-scheme-guard`, `settings-controls` — from the ungated CDP-`:9222`/`cdp-driver.mjs` path onto the **admin MCP surface**, preserving step semantics, deferring only the genuinely eval-dependent checkpoints (settings-controls Steps 9/10) and the a11y harness (Steps 11–12) to F8-eval.

## Context
- **DD1** (flight): reuse the proven F6 migration template + leg-2's pattern. Same apparatus mapping table.
- **Key correction over a naive read (load-bearing for `menu-dismissal`)**: focus assertions migrate **without** in-page eval. The F6 `tab-keyboard-operability` spec (green live) reads the **focused node via `readAxTree`'s `focused` property** (`observe.js:readAxTree` → `Accessibility.getFullAXTree`), dismisses/moves focus via a coordinate `click` into the page area, and re-locates shifting controls via a `captureWindow` screenshot. So the old apparatus's `document.activeElement` reads → `readAxTree` focused-node; `getBoundingClientRect()` coordinate re-query → `captureWindow`-locate; `document.getElementById('webview').focus()` (focus-the-page-to-dismiss) → `click(wcId, x, y)` into the guest/page area. **None of these are in-page eval** — they are the proven F6 apparatus rules.
- **Genuine eval defers are narrow**: only reads of **script-runtime values absent from DOM/a11y/screenshot** (a JS global's presence, an `ipcRenderer.invoke` attack from page context) and the axe-injection a11y harness. Those go to F8-eval; everything observable migrates.
- This leg is **spec-authoring only** (markdown). Live runs are leg 8 `verify-integration`. Pure edits; no source.
- **`dev:debug`/`:9222` stays alive** through F7 for un-migrated specs + the eval-deferred items (hardened at leg 7).

## Inputs
- `tests/behavior/menu-dismissal.md` (status `active`) — chrome-only. Kebab/container-menu open/close + mutual exclusion; **click-away dismissal** (currently `eval ...focus()` → migrates to a coordinate `click` into the page); **Escape restores focus to trigger**; **arrow/Home/End/Space/Enter** menu navigation with focus assertions (currently `document.activeElement` reads → `readAxTree` focused-node); coordinate re-query before each click (currently `getBoundingClientRect()` → `captureWindow`-locate). All keys are unmodified (no chords). **Migrates fully.**
- `tests/behavior/tab-scheme-guard.md` (status `active`) — multi-target (chrome + a web **trigger-page** guest + the internal `goldfinch://settings` guest for the positive open). **Purely observational**: the hostile vectors (`window.open`/`window.location`/`<iframe>`/`fetch`) are driven **by the trigger page's own buttons**, not the harness — the harness clicks the trigger page's buttons (coordinate `click` on the guest) and **observes** outcomes (webview `src`/tab set via `readDom`+`enumerateTabs`, screenshots, and the fixture's **DOM status element** for the Step-11 fetch-rejection — the fixture writes the result to its own DOM, read via `readDom`). **Migrates fully.**
- `tests/behavior/settings-controls.md` (status `active`) — chrome + internal settings guest + a web guest + filesystem. Steps 1–8 (toggle/​input drive via `pressKey`/`typeText` + `readDom`/`readAxTree` on the settings guest; chrome slide-out panel via `getChromeTarget`; `settings.json`/`shields.json` via filesystem; new-tab home-effect via `enumerateTabs`) **migrate**. **Step 9** (`typeof window.goldfinchInternal === undefined` in a web guest) and **Step 10** (chrome-context `ipcRenderer.invoke('internal-settings-set', …)` attack) are **genuine in-page eval** → **F8-eval defer**. **Steps 11–12** (`npm run a11y -- --target=goldfinch://settings` + baseline compare) stay the **F8-deferred axe harness** (shell step, not migrated). **Partial migration.**
- **Proven apparatus** (F6 leg-2 spike + leg-2 of this flight): `npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`; admin MCP client (`StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- The migrated F6 + leg-2 specs (`tab-keyboard-operability`, `unified-tab-controls`, …) as reference style.

## The apparatus mapping (CDP-`:9222` → admin MCP surface)
| Old (CDP/`:9222`) | New (admin MCP surface) |
|---|---|
| `npm run dev:debug` (`:9222 --remote-allow-origins=*`) / `cdp-driver.mjs` | `npm run dev:automation` + dev-mint/admin env + `GOLDFINCH_MCP_PORT=49707` (no `:9222`) |
| attach to `:9222`, select the renderer target | `getChromeTarget()` → chrome `wcId` |
| web trigger-page guest / internal `goldfinch://settings` guest | admin `enumerateTabs()` (incl. internal via `allowInternal`) → the guest `wcId`; `openTab(url[, jarId])` to create a web guest |
| `Accessibility.getFullAXTree` / `document.activeElement` | `readAxTree(wcId)` → AXNode array; **focused node via the `focused` property** (this is how focus assertions migrate — NOT eval) |
| `document.activeElement` / DOM reads / webview `src` | `readDom(wcId)` → `{ url, title, html }` (the guest's current URL is in `url`/`outerHTML`) |
| `getBoundingClientRect()` coordinate re-query | `captureWindow()` screenshot-locate immediately before each click (controls shift; never cache coords) |
| `document.getElementById('webview').focus()` (focus-the-page-to-dismiss) | `click(wcId, x, y)` into the guest/page area (trusted click moves focus → dismisses the menu) |
| CDP `Input.dispatchKeyEvent` (trusted) | `pressKey(wcId, name)` (Escape/ArrowUp/ArrowDown/Home/End/Space/Enter/Tab/ShiftTab) — all unmodified here |
| CDP `Input.dispatchMouseEvent` (trusted click) | `click(wcId, x, y)` — coordinate-based; locate via `captureWindow` |
| typing into the settings input | `typeText(wcId, text)` |
| `userData/settings.json` / `shields.json` reads | filesystem read (Read/Bash) — unchanged |
| **in-page eval of a script-runtime value** (`typeof window.X`, page-context `ipcRenderer.invoke`) | **NOT expressible on the surface → F8-eval defer** (record the checkpoint) |
| `npm run a11y` axe-injection audit | **NOT migrated** — F8-deferred harness, run as a shell step over the hardened `:9222` |
| `chrome-devtools` MCP disqualified | **still disqualified** (launches its own browser → false pass) — keep the warning |

## Outputs
- `menu-dismissal`, `tab-scheme-guard`: **fully migrated** — Preconditions/Observables/Step-1 probe on the admin MCP surface; all steps' Action/Expected intent preserved; focus assertions via `readAxTree` focused-node; click-away dismissal + coordinate re-query via `click`/`captureWindow`; the focus-anchor + coordinate-click notes added; `chrome-devtools`-disqualified warning kept.
- `settings-controls`: **partially migrated** — Steps 1–8 on the MCP surface; **Step 9 + Step 10 marked deferred to F8-eval** (genuine in-page eval) with the reason inline in the spec (do NOT silently drop them — annotate as "deferred to F8-eval: needs the in-page `evaluate` capability"); **Steps 11–12** kept verbatim as the F8-deferred a11y harness.
- `tab-scheme-guard` Step 11 (fetch-rejection): reads the **fixture's DOM status element** via `readDom` on the trigger guest (the fixture page performs the `fetch` + writes its result to the DOM) — not harness eval.
- The 3 specs' `**Last Run**` left as-is (historical); statuses stay `active`.
- `dev:debug`/`:9222` references in OTHER specs untouched.

## Acceptance Criteria
- [x] **AC1 (apparatus rewritten)** — Each spec's Preconditions + Observables + Step-1 probe references the admin MCP surface instead of `dev:debug`/`:9222`/`cdp-driver.mjs`. The `chrome-devtools`-MCP-disqualified warning is preserved in each. **This applies in full to `settings-controls` despite its deferred steps** — the apparatus header migrates wholesale; the deferral is per-step-body only.
- [x] **AC2 (semantics preserved)** — Every migrated step's Action/Expected *intent* is unchanged; only apparatus framing + mechanism words change. No checkpoint added or dropped (deferred checkpoints are annotated, not removed).
- [x] **AC3 (focus via readAxTree, not eval)** — `menu-dismissal`'s focus assertions (Escape-restores-to-trigger, arrow/Home/End navigation staying in the menu, Space/ArrowUp open-and-focus) and `settings-controls` keyboard steps are expressed by reading `readAxTree(wcId)` (the raw `Accessibility.getFullAXTree` node array) and **scanning for the node whose `focused` property is set** + roles, NOT `document.activeElement`/in-page eval. Click-away dismissal is a coordinate `click` into the **guest** page (Steps 2–3) or chrome (Step 5) per the two dismissal handlers; coordinate re-query is `captureWindow`-locate.
- [x] **AC4 (focus-anchor + coordinate-click notes)** — Each spec states the two apparatus rules (focus-anchor click before keyboard-only sequences; coordinate clicks located via `captureWindow`).
- [x] **AC5 (tab-scheme-guard observational integrity)** — `tab-scheme-guard` drives the trigger page's own buttons (coordinate `click` on the web guest) and reads outcomes via `readDom`+`enumerateTabs` (webview `src`/tab set), screenshots, and the fixture's DOM status element (Step 11). The harness performs **no** in-page eval; the hostile vectors remain page-driven. Multi-target (chrome + web guest + internal-guest positive check) handled via `getChromeTarget`/`openTab`/`enumerateTabs`.
- [x] **AC6 (settings-controls partial defer recorded)** — `settings-controls` Steps 9 + 10 are explicitly annotated in the spec as **deferred to F8-eval** (genuine in-page `evaluate` needed: `window.goldfinchInternal` presence / page-context `ipcRenderer.invoke`), and Steps 11–12 noted as the F8-deferred a11y harness. Steps 1–8 are migrated to the MCP surface. The defers are recorded in the flight log.
- [x] **AC7 (no stray old-apparatus refs)** — `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/{menu-dismissal,tab-scheme-guard,settings-controls}.md` returns **zero** matches. The deferred-step annotations (settings-controls 9/10/11/12) are phrased to name "`evaluate` MCP tool / F8-eval" and `npm run a11y` — none of which contain the four tokens — so a clean grep is achievable and is the explicit target (the old CDP wording in Steps 10/11 is stripped, not preserved).
- [x] **AC8** — `npm test`/typecheck/lint unaffected (spec docs; expect green — leg 1 + 2 changes stay green).

## Verification Steps
- AC1–AC6: read each rewritten spec; confirm apparatus, preserved semantics, focus-via-readAxTree, the deferral annotations for settings-controls 9/10/11/12.
- AC7: `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/{menu-dismissal,tab-scheme-guard,settings-controls}.md` — empty (or only intentional defer-annotation context lines, reported).
- AC8: `npm test && npm run typecheck && npm run lint` (fail-fast timeout).
- **Live confirmation is leg 8** — this leg only authors.

## Implementation Guidance
1. **Use the mapping table** + mirror `tests/behavior/tab-keyboard-operability.md` (focused-node-via-readAxTree framing) and leg-2's `unified-tab-controls` (coordinate-click + focus-anchor).
2. **menu-dismissal** — **two-`wcId` bookkeeping (key correction from design review)**: open the kebab/container menus via coordinate `click` on the **chrome `wcId`** (`getChromeTarget`; re-locate via `captureWindow` each time — the pill shifts). There are **two distinct dismissal paths**, on different handlers:
   - **Page-click dismissal (Steps 2–3)** rides the chrome's `window` **blur** handler (`src/renderer/renderer.js:212`), which fires only when native focus crosses **into the `<webview>`'s separate web-contents**. So the dismissing click must land on the **guest webview `wcId`** (from `enumerateTabs`), NOT the chrome — `click(guestWcId, x, y)` at a neutral page area. (This is a *more faithful* witness than the old `eval document.getElementById('webview').focus()` proxy — it's a real trusted page click.)
   - **In-chrome outside-click dismissal (Step 5)** rides the `document` **pointerdown** handler (`renderer.js:203-209`) — stays on the **chrome `wcId`** (`click` the address-bar/neutral chrome area).
   Escape/arrows/Home/End/Space/Enter → `pressKey` on the chrome `wcId` (focus-anchor first). Every focus assertion (`activeElement` →) read `readAxTree(chromeWcId)` and **scan the returned AX-node array for the node whose `focused` property is set** (the tool returns the raw `Accessibility.getFullAXTree` array — there is no top-level `focused` field), plus `role=menu`/`menuitem`/`aria-expanded`. **Step 9** (Space opens once; ArrowUp opens with focus on the last item) is the subtlest — fully expressible via the focused-node + `aria-expanded`; do NOT reach for eval. Per-checkpoint escape hatch: if a focus assertion genuinely cannot be expressed via the focused-node, defer that checkpoint to F8-eval and record (do not invent an eval).
   - **Also update the stale disclaimer**: menu-dismissal currently frames the real page-click as "verified manually / not cleanly CDP-drivable across web-contents" (row-conventions footnote + Out-of-Scope). After migration the coordinate `click(guestWcId, …)` **is** that real page click — reconcile those notes so they no longer claim it's manual-only; leave only genuine OS/app-switch focus loss as manual.
3. **tab-scheme-guard**: Step-1 probe → `getChromeTarget` + `openTab` the HTTP trigger fixture (web guest). For each vector step, `click` the trigger page's own button (coordinate, on the web-guest `wcId` — the hostile `window.open`/`location`/`iframe`/`fetch` are the **page's** code, never the harness); observe via `enumerateTabs` (no tab on a forbidden scheme), `readDom(guestWcId)` (webview stays on the original `http://`; no `file://`/`javascript:`/`data:`/`goldfinch://` src), and `captureWindow`/`captureScreenshot` (no file contents / injected HTML rendered). Step 11 fetch-rejection → `readDom` the fixture's status element **`#goldfinch-fetch-result`** (the fixture writes `rejected: …`/`resolved`); the iframe-embed result is **`#goldfinch-embed-result`** (`tests/behavior/fixtures/tab-scheme-guard/index.html`). Step 12–13 positive internal open → kebab→Settings (coordinate `click` on chrome) + `enumerateTabs` shows `goldfinch://settings`. Keep the `chrome-devtools`-disqualified warning.
4. **settings-controls**: **The apparatus header migrates wholesale** — Preconditions + Observables Required + Step-1 probe go fully to the MCP surface (AC1), EVEN THOUGH Steps 9–12 are deferred. The deferral is **per-step-body only**; do not leave the shared header on `dev:debug`/`:9222`/`cdp-driver.mjs`. Step-1 probe → `getChromeTarget`; open Settings; find the `goldfinch://settings` guest via admin `enumerateTabs` (`allowInternal`). Steps 2–8: toggle/​input via `pressKey`/`typeText` on the guest `wcId`; read toggle/​input state via `readDom`/`readAxTree`; `shields.json`/`settings.json` via filesystem; chrome slide-out panel (Step 5) via `getChromeTarget`+`readDom`; new-tab home-effect (Step 8) via `enumerateTabs`+`readDom`.
   - **Step 9** — annotate as deferred and rewrite the step body to drop the CDP framing (do NOT preserve `:9222`/`Runtime.evaluate` language): `> **Deferred to F8-eval:** asserts `typeof window.goldfinchInternal === undefined` in a web guest — a script-runtime read with no DOM/a11y/pixel manifestation. Needs an in-page `evaluate(wcId, expr)` MCP tool (F8-eval); not expressible on the current surface.`
   - **Step 10** — annotate similarly and **strip the old `via CDP Runtime.evaluate against the file:// chrome target` wording** (it would otherwise survive as stale apparatus language): `> **Deferred to F8-eval:** the page-context `ipcRenderer.invoke('internal-settings-set', …)` privilege-escalation probe needs an in-page `evaluate` MCP tool to drive from a guest/chrome context (F8-eval).` Keep the assertion's intent (the call must be rejected; `settings.json` unchanged) in the annotation so the checkpoint isn't lost.
   - **Steps 11–12** — leave `npm run a11y` verbatim as the F8-deferred axe harness, with a one-line note (no `:9222` literal — `npm run a11y` carries none).
   - **Grep cleanliness**: phrase all deferral annotations to name "`evaluate` MCP tool / F8-eval", never the four grep tokens (`9222`/`cdp-driver`/`dev:debug`/`remote-debugging`) — so AC7 comes back with **zero** matches.
5. **Do NOT** touch `Last Run`, `## Out of Scope` semantics, or other specs' `:9222`. Leave historical `runs/` logs alone.

## Edge Cases
- **Focus-via-readAxTree is the crux**: do not let any `activeElement`/`getBoundingClientRect`/`focus()` survive as an in-page-eval instruction — each has a proven non-eval migration (focused-node / `captureWindow`-locate / coordinate `click`). Only a *script-runtime value with no DOM/a11y/pixel manifestation* defers.
- **tab-scheme-guard page-driven vectors**: the harness must NOT itself call `window.open`/`fetch` — those are the trigger page's buttons. The harness clicks buttons + observes. Keep that boundary explicit so leg-8 runs don't accidentally drive the attack from the harness (which would not test the guard).
- **settings-controls deferred steps are annotated, not deleted**: AC2/AC6 — a reader must see Steps 9/10 exist and why they're deferred; do not renumber or drop them.
- **Multi-target bookkeeping (tab-scheme-guard, settings-controls)**: chrome `wcId` (`getChromeTarget`) vs web-guest `wcId` (`openTab`/`enumerateTabs`) vs internal-guest `wcId` (`enumerateTabs` `allowInternal`) — keep them straight.
- **Admin-only**: all three need the admin key (chrome + internal-guest access).
- **menu-dismissal two dismissal handlers**: page-click dismissal (Steps 2–3) = `click` on the **guest `wcId`** (trips the chrome `window` blur handler when focus crosses into the webview); in-chrome outside-click (Step 5) = `click` on the **chrome `wcId`** (trips the `document` pointerdown handler). Targeting the wrong `wcId` would silently fail to dismiss.
- **leg-8 runnability note (carry to verify-integration)**: Steps 2–3 need a coordinate `click` landing on a **neutral region of the guest page** (dead space, not a link/button that navigates). The precondition's default homepage tab should have such space — leg 8 should pick a neutral coordinate from a `captureWindow` screenshot, not a blind center click. Not a spec-authoring blocker; flagged for the live run.

## Files Affected
- `tests/behavior/menu-dismissal.md` — apparatus → admin MCP surface (full migrate; focus-via-readAxTree).
- `tests/behavior/tab-scheme-guard.md` — apparatus → admin MCP surface (full migrate; observational, multi-target).
- `tests/behavior/settings-controls.md` — apparatus → admin MCP surface for Steps 1–8; Steps 9/10 annotated F8-eval defer; Steps 11–12 kept as the deferred a11y harness.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `grep` over the 3 specs shows no stray `9222`/`cdp-driver`/`dev:debug`/`remote-debugging` (zero matches; grep exit 1)
- [x] `npm test`/typecheck/lint green (sanity)
- [x] Update flight-log.md with leg progress entry (incl. the settings-controls Step 9/10 F8-eval defers)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg (committed with the Phase-2d review block)

## Citation Audit
To verify at design-review time (2026-06-16): apparatus mapping = proven F6 leg-04 table + leg-2 of this flight; focus-via-`readAxTree`-focused-node grounded in `observe.js:readAxTree` (`Accessibility.getFullAXTree`, `:248-266`) and the F6 `tab-keyboard-operability.md` (Steps 3–8, focused-node + coordinate-click + click-away, green live 2026-06-07). Spec current-apparatus + the genuine-eval checkpoints (`settings-controls` Step 9 `window.goldfinchInternal`, Step 10 `ipcRenderer.invoke`, Steps 11–12 `npm run a11y`) confirmed by the leg-3 recon. The design-review Developer cross-checks the eval-vs-observable classification per checkpoint (the load-bearing judgment of this leg).
