# Flight: Bulk spec migration + ungated-path hardening (scoped)

**Status**: landed
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC11 (part 2, scoped)** — migrate the **surface-compatible** remaining Group-B specs onto the admin/jar MCP surface (dogfooding), and **harden** the ungated `:9222` path so it is no longer a wide-open apparatus. **Full** retirement of `:9222` + the `a11y-audit.mjs` rewrite + `farbling-correctness` are **deferred to a follow-on** (they require an in-page `evaluate` capability the surface lacks — operator decision 2026-06-16).

---

> **Scope (operator-agreed, 2026-06-16).** "Migrate what fits the current surface; defer the eval items." F7 migrates the Group-B specs that read via DOM / a11y / trusted input (no in-page JS eval), adds audit-log paging, and **hardens** `:9222` (narrows `--remote-allow-origins=*`, trims `.mcp.json`) rather than removing it — because `farbling-correctness` (script-observable fingerprint values) and the `a11y-audit.mjs` rewrite (axe-core injection) both need an in-page `evaluate`/`injectScript` MCP tool that does not exist yet. That tool + those two items + the *final* `:9222` removal are a **follow-on flight (F8-eval)**.

> **Why an `evaluate` tool is needed for the deferred items (premise audit, both axes).** The 17-tool surface can *act* (click/type/key/nav) and *observe* DOM (`readDom` = `outerHTML`), the a11y tree (`readAxTree`), and pixels (`captureScreenshot`/`captureWindow`) — but it has **no arbitrary in-page JS evaluation**. `farbling-correctness` asserts on **runtime JS values** (`navigator.hardwareConcurrency`, canvas/WebGL fingerprints) that are not in `outerHTML`; `a11y-audit.mjs` works by **injecting axe-core via CDP `Runtime.evaluate`** (CSP-bypassing) and running axe's rule engine in the page. Neither is expressible through the current tools. Confirmed against `observe.js:READ_DOM_SNIPPET` (outerHTML only) and the 17-tool registry (no eval tool), and `scripts/a11y-audit.mjs:1-4,44` (axe via `Runtime.evaluate` at `:9222`).

## Pre-Flight

### Objective
Migrate the **~7–8 surface-compatible Group-B chrome/guest specs** (`unified-tab-controls`, `responsive-tab-strip`, `toolbar-pins`, `menu-dismissal`, `tab-scheme-guard`, `settings-controls`, `settings-automation`, and `core-browsing-shields` if eval-free) from the CDP-`:9222`/`cdp-driver.mjs` apparatus onto the admin/jar MCP surface (reusing the F6 template); add **audit-log paging (20/page, in-memory)**; and **harden** the ungated `:9222` path (narrow `dev:debug`'s `--remote-allow-origins=*`, trim the stale `.mcp.json` Playwright-`:9222` entry, re-evaluate the `devtools-cdp-conflict` block) so the only remaining `:9222` consumers are the **deferred** `a11y-audit.mjs` + `farbling-correctness`, served by a narrowed (loopback-Origin-only) port.

### Open Questions
- [x] **`core-browsing-shields` apparatus** → RESOLVED (Architect, DD2): it is an **admin** spec (Step 5 reads the chrome privacy panel via `getChromeTarget`; Steps 3–4 navigate a guest via `openTab`). Eval-free. Not a jar-key migration.
- [x] **`settings-automation` migration shape** → RESOLVED (Architect, Technical Approach §3): **two targets** — chrome indicator via `getChromeTarget`+`readDom`; settings-guest viewer via admin `allowInternal` `enumerateTabs`→internal `wcId`+`readDom`. Eval-free (DOM elements). The staged MCP session is unchanged.
- [x] **How narrow can `dev:debug`'s `--remote-allow-origins` go** while the Node CDP clients (`a11y-audit.mjs`, `farbling`) still attach? **RESOLVED (`harden-ungated-path`, probe-confirmed):** landed `--remote-allow-origins=http://127.0.0.1:9222`. The live WS probe showed no-Origin clients attach (arm1=101), a foreign Origin is rejected (arm2 `http://evil.example`=403 → load-bearing), and the loopback Origin is admitted (arm3=101); `npm run a11y` ran over the narrowed port. NOT a no-op, NOT a break.
- [x] **`devtools-cdp-conflict` disposition** — **RESOLVED (annotated, stays blocked):** the spec carries a Flight-7 annotation that its `BLOCKED-AS-WRITTEN` state is gated on the **missing non-CDP DevTools-open affordance**, explicitly NOT the (now-narrowed) wide-open Origin; status stays `draft`, venue `dev:automation` (no `:9222`) → carried to F8-eval.

### Design Decisions

**DD1 — Reuse the F6 migration template for the surface-compatible specs.**
- Choice: migrate the chrome-driving specs (`unified-tab-controls`, `responsive-tab-strip`, `toolbar-pins`, `menu-dismissal`, `tab-scheme-guard`, `settings-controls`, `settings-automation`) using the **F6 apparatus mapping** (admin MCP client + `getChromeTarget` → drive/observe tools; `captureWindow`-locate for coordinate clicks; focus-anchor before keyboard-only sequences). The mapping table + the two apparatus rules are proven (F6 leg 7, three specs green live).
- Rationale: the apparatus is empirically validated; this is templated repetition, not new risk.
- Trade-off: blind-coordinate clicking carries forward (F6 debt) — accept for now; the element-addressing affordance is mission Flight 9.

**DD2 — `core-browsing-shields` migrates as an ADMIN spec (not pure jar-key) — its key assertion reads the CHROME privacy panel.**
- **Corrected at Architect review (2026-06-16):** `core-browsing-shields` is NOT pure guest-driving. Its param-stripping check (Steps 3–4) IS guest-observable (`location.href` in `readDom` `outerHTML` on the guest `wcId`), but its **tracker-block assertion (Step 5) reads `.tag.blk`/`#privacy-count` in the chrome renderer's privacy panel** (`core-browsing-shields.md:32`) — chrome-shell DOM, reachable only via `getChromeTarget` + `readDom` (admin), which a jar key is refused (`scope.js:149`, `resolve.js:148`). So the spec runs as **admin**: `openTab(url, <jarId>)` to create the guest, `readDom`/`readAxTree` on the guest `wcId` for the URL/param result, AND `getChromeTarget` + `readDom` on the chrome for the privacy-panel block count. Admin-only (one identity) — simpler than a two-client spec, and correct because the spec asserts chrome-visible state, not jar isolation (operator Q1 → admin-only).
- **Premise audit (observability)**: confirmed eval-free — `.tag.blk` count + `location.href` are both DOM, no script-runtime reads. (If a residual assertion needs script values → defer that part to F8-eval, record.)
- Note: with `core-browsing-shields` going admin, F7 has no remaining *pure jar-key guest* migration — jar-isolation driving is already covered by the landed `mcp-jar-scoping`. The general guest-`wcId` read path (jar key → `enumerateTabs` → guest `wcId` → `readDom`) still exists and is exercised where a spec needs it.

**DD3 — Harden `:9222`, don't remove it (scoped).**
- Choice: narrow `dev:debug`'s `--remote-allow-origins=*` to a **loopback-Origin allow-list** (defeating the DNS-rebinding/wide-open exposure the mission's SC7 thesis warns about), keep the port available ONLY for the deferred `a11y-audit.mjs` + `farbling-correctness`. Trim the stale `.mcp.json` Playwright-`:9222` entry once the migrated specs that named it (e.g. `responsive-tab-strip.md:25`) no longer reference it.
- Rationale: the mission's SC11 says "retired **or hardened**." Full removal can't happen while the eval-deferred items still need `:9222`. Hardening removes the *wide-open* exposure (the actual risk) without blocking the deferred harness.
- **Premise risk (Architect MED) — verify EMPIRICALLY before landing the narrowed flag:** `a11y-audit.mjs` connects with Node 22's **global `WebSocket`** (`a11y-audit.mjs:182-216,37`), which **does not send an `Origin` header by default** (unlike a browser). Chromium's `--remote-allow-origins` is checked against that header on the WS upgrade. So narrowing `*` → `http://127.0.0.1` may (a) be a **no-op** for the Node client (no Origin → nothing to allow-list against; it may still attach) or (b) **break** the attach (a non-`*` list may reject an absent Origin). This is unknown from code alone → a **resolve-or-divert** at the `harden-ungated-path` leg: first run a Node-22 `new WebSocket('ws://127.0.0.1:9222/…')` probe to observe whether an `Origin` is sent and whether the attach survives a narrowed list, THEN choose the narrowing form (an explicit allow-list that matches the absent/loopback Origin, or — if narrowing can't both block `*` and keep the Node attach — a different hardening, e.g. an Origin-injecting shim in `a11y-audit.mjs`/`farbling`, or a documented residual carried to F8-eval).
- Trade-off: `:9222` survives this flight (narrowed). Full removal is F8-eval. Recorded; not a silent omission.

**DD4 — Audit-log paging: 20/page, IN-MEMORY, newest-first, with a live-ring freshness contract.**
- Choice: the Settings activity viewer paginates the in-memory ring at **20 entries/page**, **newest-first** (page 1 = the most-recent 20, matching today's `reverse().slice`), with prev/next + a "showing X–Y of N" indicator, replacing the silent `LOG_DISPLAY_CAP = 50` slice (`settings.js`). The ring stays the existing 500-entry in-memory store (`audit-log.js`); the renderer receives the full snapshot per broadcast and does **renderer-side windowing** — no backend/IPC/cursor change.
- **Freshness contract (Architect HIGH — the live ring grows on every tool call, so naive page indices shift under the operator):** **freeze-on-page-2+.** Page 1 (newest) stays **live** — broadcasts re-render it. Navigating to **page 2+ snapshots the ring at that instant** and the viewer **stops applying live broadcasts** while paged back, showing a small "paused — N newer entries · back to live" affordance; returning to page 1 resumes live. This keeps "see older entries" coherent (older entries don't slide mid-read) without persistence. Source of truth = the in-memory ring snapshot; rebuild trigger = broadcast (page 1 only) / explicit back-to-live; max staleness = until the operator returns to page 1 (bounded, operator-controlled). Implemented in the `settings.js` activity-viewer IIFE.
- **Persistence is explicitly DEFERRED to a future mission** (operator decision) — no disk store, no retention/clear policy here. This leg only fixes the "can't see older entries" gap (F6 debrief), which bulk runs (hundreds of entries) make acute.
- Trade-off: lost on restart (acceptable — persistence is a named future mission); a paged-back operator misses live updates until they return to page 1 (intended — that's the freeze).

**DD5 — Defer the `evaluate` tool + `farbling-correctness` + `a11y-audit.mjs` rewrite + final `:9222` removal to a follow-on (F8-eval).**
- Choice: F7 does NOT add an in-page `evaluate`/`injectScript` MCP tool. `farbling-correctness` stays on its current apparatus; `a11y-audit.mjs` stays on the (now hardened) `:9222`; `devtools-cdp-conflict` stays `BLOCKED-AS-WRITTEN`. A follow-on flight adds the guarded `evaluate` tool, migrates those two, and fully removes `:9222`.
- Rationale: the `evaluate` tool is a real new capability + security surface (arbitrary JS in a guest/chrome) deserving its own design + premise audit; bundling it here would balloon F7.

**DD6 — Guided HAT.**
- Choice: include the optional `hat-and-alignment` leg — dogfood the audit-paging UI + a sample of the migrated specs live; the F6 HAT caught real SC10/UX gaps, and the paging UI is exactly the kind of interactive surface worth witnessing.

### Prerequisites
- [ ] **Flight 6 landed + v0.5.1 released** (the chrome affordance + the proven F6 migration template). Satisfied.
- [ ] **The admin/jar auto-mint apparatus** (`dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1` [+ `GOLDFINCH_AUTOMATION_ADMIN=1` for chrome specs]) — proven in F6.
- [ ] **`:9222` stays usable** through F7 for the deferred `a11y-audit` + `farbling` (hardened, not removed).
- [ ] **No new port/bind** — reuses the F3–F5 loopback MCP server (`GOLDFINCH_MCP_PORT`).

### Pre-Flight Checklist
- [x] Open questions resolved (core-browsing-shields → admin; settings-automation → dual target; allow-origins + devtools-cdp-conflict are named resolve-or-divert/annotate items at the `harden-ungated-path` leg, not pre-flight blockers)
- [x] Design decisions documented (DD1–DD6) + Architect-reviewed (approve-with-changes; all incorporated)
- [x] Prerequisites verified (F6 landed + v0.5.1 released; admin/jar auto-mint proven; `:9222` stays usable for deferred items; no new port)
- [x] Validation approach defined (migrated specs run live on the MCP surface + confound-free `:9222`-stopped re-run; audit-paging via HAT; hardened `:9222` still serves a11y/farbling)
- [x] Legs defined
- [x] Operator sign-off (2026-06-16)

---

## In-Flight

### Technical Approach
1. **`presskey-modifier-chords`** *(source; added in-flight — flight-log Decisions 2026-06-16)* — extend the trusted-input `pressKey` path to send modifier chords (`Ctrl+M`, `Ctrl+Shift+P`) via `pressKey(wcId, name, modifiers)`, so keyboard-shortcut checkpoints (`toolbar-pins` Step 6 + Shields variant) become drivable over the MCP surface. Discovered at the leg-2 design review; a trusted-input gap (not an eval gap), landed here per operator decision rather than deferred to F8.
2. **`migrate-chrome-specs-a`** — migrate `unified-tab-controls`, `responsive-tab-strip`, `toolbar-pins` (chrome tab-strip/toolbar) onto the admin MCP surface (F6 template).
3. **`migrate-chrome-specs-b`** — migrate `menu-dismissal`, `tab-scheme-guard`, `settings-controls` (chrome menus/guards/settings controls) onto the admin MCP surface.
4. **`migrate-settings-automation`** — migrate `settings-automation`'s read apparatus, which has **two distinct targets** (Architect MED): the **chrome `#automation-indicator`** → admin `getChromeTarget` + `readDom`/`readAxTree`; the **settings-guest viewer** (`#automation-active-sessions`, `#automation-activity-log` — in the `goldfinch://settings` internal guest) → the F6 `settings-shell` pattern: the **admin** engine (`allowInternal:true`) `enumerateTabs` → the internal-guest `wcId` → `readDom` (NOT `getChromeTarget`, which is chrome-only). The staged MCP session under test is unchanged.
5. **`migrate-core-browsing-shields`** — `core-browsing-shields` as an **admin** spec (DD2): `openTab(url, jarId)` for the guest nav + guest-`wcId` `readDom` for the param/URL result + `getChromeTarget`+`readDom` for the chrome privacy-panel block count. Eval-free (confirmed).
6. **`audit-log-paging`** — Settings activity viewer paginates the in-memory ring at 20/page (prev/next + "X–Y of N"); replaces the silent 50-cap. Renderer-only (`settings.js`); no backend change.
7. **`harden-ungated-path`** — narrow `dev:debug`'s `--remote-allow-origins=*` to a loopback-Origin allow-list; trim the stale `.mcp.json` Playwright-`:9222` entry; re-evaluate/annotate the `devtools-cdp-conflict` block. Confirm `a11y-audit.mjs` + `farbling` still attach over the narrowed port.
8. **`verify-integration`** — run the migrated specs live on the MCP surface (FD-driven, cited evidence); full `npm test` + typecheck + lint green; confirm the hardened `:9222` still serves the deferred `a11y` + `farbling` (no regression); confirm audit paging.
9. **`hat-and-alignment`** *(optional — included)* — guided HAT of the audit-paging UI + a sample of the migrated specs.

### Checkpoints
- [ ] Chrome specs migrated (groups a + b) — green live on the admin surface.
- [ ] `settings-automation` reads via the MCP surface.
- [ ] `core-browsing-shields` migrated (or deferred-with-reason if it needs eval).
- [ ] Audit-log paging (20/page, in-memory) — replaces the 50-cap.
- [ ] `:9222` hardened (allow-origins narrowed; `.mcp.json` trimmed); a11y + farbling still attach.
- [ ] Live: migrated specs pass; full gates green; deferred-item path unbroken.
- [ ] Guided HAT.

### Adaptation Criteria
**Divert if**:
- A spec assumed surface-compatible turns out to need in-page JS eval (script-runtime reads) → **defer it to F8-eval** with the reason recorded; do not add an eval tool in this flight.
- **(Architect MED — named divert) Narrowing `--remote-allow-origins` cannot both block `*` AND keep the Node CDP clients attaching** (the empirical WS-probe at `harden-ungated-path` shows the Node global `WebSocket` sends no `Origin`, so a non-`*` allow-list rejects the attach) → do NOT land a narrowing that breaks `a11y-audit`/`farbling`. Fall back to: an allow-list form that still admits the absent/loopback Origin, OR an Origin-injecting shim on the Node clients, OR record the hardening limit reached and carry the residual `:9222` exposure to F8-eval (with the wide-open `*` documented as a known, dev-only residual until then). The migration + paging work still lands regardless.

**Acceptable variations**:
- Exact grouping of the chrome-spec migration legs (a/b split is for sizing).
- Whether `core-browsing-shields` lands here or defers (premise-audit outcome).

### Legs
> **Note:** Tentative; created one at a time as the flight progresses. May merge/split.

- [x] `presskey-modifier-chords` — *(source; added in-flight)* `pressKey(wcId, name, modifiers)` for `Ctrl+M`/`Ctrl+Shift+P` shortcut checkpoints. (flight-log Decisions 2026-06-16)
- [x] `migrate-chrome-specs-a` — `unified-tab-controls`, `responsive-tab-strip`, `toolbar-pins` → admin MCP surface. (DD1)
- [x] `migrate-chrome-specs-b` — `menu-dismissal`, `tab-scheme-guard`, `settings-controls` → admin MCP surface. (DD1)
- [x] `migrate-settings-automation` — dual target: chrome indicator via `getChromeTarget`; settings-guest viewer via admin `allowInternal` `enumerateTabs`→internal `wcId`. (DD1)
- [x] `migrate-core-browsing-shields` — admin spec: guest nav via `openTab` + chrome privacy-panel read via `getChromeTarget`. (DD2)
- [x] `audit-log-paging` — 20/page, in-memory; replace the 50-cap. (DD4)
- [x] `harden-ungated-path` — narrow `--remote-allow-origins`; trim `.mcp.json`; devtools-cdp-conflict re-eval. (DD3) — landed `http://127.0.0.1:9222`, WS probe-confirmed (arm1=101, arm2=403, arm3=101; a11y attaches).
- [x] `verify-integration` — migrated specs live + full gates + deferred-path regression check. (DD1) — FD-driven live pass (admin MCP client; 17 tools; `:9222` confound-free); leg-1 `Ctrl+M` chord `{ok:true}` live; 709 gates green.
- [x] `hat-and-alignment` *(optional — included)* — guided HAT (audit paging + sample specs). (DD6) — caught + fixed the audit-paging 404 render bug + numbered-pagination UX directive; operator-confirmed; dogfooded via the real `mcp__goldfinch__*` MCP. AC4 (zero-state) deferred to F8.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged (PR onto `main`) — PR #51 marked ready for review (merge is the operator's call)
- [x] Tests passing (audit-paging renderer change + any migration-driven unit deltas + typecheck + lint) — 709 pass / 0 fail; typecheck + lint clean
- [x] Documentation updated (`docs/mcp-automation.md` if the audit-paging contract changes; CLAUDE.md if `dev:debug` hardening changes the dev workflow note) — CLAUDE.md `dev:debug` bullet updated for the narrowed `--remote-allow-origins` (leg 7); audit-paging is renderer-only (broadcast data contract unchanged), so `docs/mcp-automation.md` needed no change
- [ ] Flight debrief written (separate `/flight-debrief` step)

### Verification
- **Behavior tests (MCP surface)**: the migrated subset passes driven by the admin/jar MCP client + `getChromeTarget`/guest `wcId`, NOT `cdp-driver.mjs`/`:9222`. **Confound-free check (F6 precedent)**: at least one migrated spec is re-run with `dev:debug`/`:9222` **not running** — clean evidence the spec is truly off `:9222` (the F6 spike's clean-instance discipline).
- **Audit paging**: the Settings activity viewer shows 20/page with prev/next + "X–Y of N"; verified live (HAT) — older entries reachable (the F6-debrief gap closed).
- **Hardening**: `dev:debug` no longer allows `*` origins; `a11y-audit.mjs` + `farbling-correctness` still attach over the narrowed loopback port (no regression); `.mcp.json` trimmed.
- **Regression**: full `npm test` + typecheck + lint green.
- **SC11 part 2 (scoped)**: surface-compatible specs migrated + the ungated path hardened; the `evaluate` tool + `farbling` + `a11y-audit` rewrite + final `:9222` removal remain (F8-eval).
