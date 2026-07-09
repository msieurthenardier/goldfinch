# Flight Log: Cross-View Keyboard Bridge & Admin-Wired Parity Sweep

**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](flight.md)

## Summary
Planning. Flight sources the Flight-4 Leg-4 deferral (convenience corpus + a11y) and the mission's named
"automation parity sweep" (SC6), draining both in one admin-wired session, and lands the F8-HAT keyboard-bridge
Known Issue that blocks corpus runs crossing the chrome/guest boundary.

---

## Reconnaissance Report

Source artifacts walked against current code (2026-07-07): the **Flight-4 debrief** action items + the
**mission Known Issues** + the mission's F5/F6 roadmap. Classification per `/flight` Phase 1b.

| Item (source) | Classification | Evidence (repo state) | Recommendation |
|---|---|---|---|
| Run deferred convenience corpus + a11y in an admin-wired session (F4 rec #1) | `confirmed-live` | No run logs on the new surface; `npm run a11y` not run since F4 Leg 2 | Core of this flight (conveniences + a11y legs) |
| Apparatus-wiring litmus as a pre-leg gate (F4 rec #2) | `confirmed-live` | The F4 blocker: MCP client jar-authed to a foreign instance; no litmus gate exists in the flow | Leg 1 (DD2) — hard gate |
| Multi-`WebContentsView` keyboard/focus bridge (mission Known Issue, F8 HAT) | `confirmed-live` | Guest `before-input-event` set at `src/main/main.js:998` captures F12/zoom/print/find/downloads/devtools but **not Ctrl+L or Tab**; DD13 template exists (`src/shared/sheet-accelerator.js`, forwarding at `main.js:385`) | Leg 2 — full three-gap fix (operator-approved into F5) |
| CLAUDE.md conventions: focus-then-send + `isWebTab()`/`isInternalTab()` (F4 rec #3) | `confirmed-live` | Neither string present in `CLAUDE.md` (grep: 0 hits) | Fold into housekeeping leg (DD5) |
| Stale `will-attach-webview` comments | `confirmed-live` | `renderer.js:956` ("Leg 4 removes will-attach-webview / webviewTag"), `internal-preload.js:4`, `settings-store.js:64` | Fold into housekeeping leg (DD5) |
| Plan Flight 7 (F4 rec #4) | `already-satisfied` | Flight 7 LANDED 2026-07-02 (floating overlay find bar) | Retire — done |
| Behavior-test AUTHORING promotions (F4 rec #5, `captureWindow` WSLg-fallback hierarchy) | `needs-human-recheck` | Mission-control-side methodology doc, not this repo | Out of scope here; methodology item |
| Repo-wide `<webview>`→`WebContentsView` terminology sweep (mission Known Issue) | `confirmed-live` (parked) | ~15 specs call the guest a "`<webview>` guest" in prose; `webview-preload.js:1-5` header drift; **zero** `sendToHost` in specs → no functional dependency | **Parked** for F6/maintenance (DD5) — prose only |
| Spec functional `<webview>` dependency (mission constraint: "element-routed find in mcp-* suite") | `already-satisfied` | `sendToHost`: 0 hits across `tests/behavior/*.md`; every spec drives by `wcId` via the MCP client (survives migration) | No functional spec rewrites expected; confirm per-spec on run |
| find `find-in-page.md` WSLg cold-start question | `needs-human-recheck` | Spec flags the open question at `find-in-page.md:15`; defensive retry ported (F4 Leg 1) | Answer on run; update spec |
| Flight-6 macOS gate additions (F4 action item) | `confirmed-live` (F6) | macOS unverified since F3; find-focus + `activeViewWcId` delta + now the keyboard bridge all mac-unverified | Carry to **F6** macOS gate — not this flight |

**Presented to operator; scope confirmed** (2026-07-07): F5 boundary = the admin-wired apparatus corpus
(SC6 + SC4 + SC5-apparatus); F6 = browsing/tab/chrome + macOS + merge. Keyboard bridge folded into F5 as a
prerequisite (blocks corpus runs). See flight.md DD1–DD7.

---

## Flight Director Notes

- **2026-07-07 — Flight execution started (`/agentic-workflow`).** Branch `flight/05-keyboard-bridge-and-parity-sweep`
  cut off `mission/05`; plan committed (`8345258`); flight `ready`→`in-flight`. Crew file
  `.flightops/agent-crews/leg-execution.md` loaded and structurally valid (Developer + Reviewer +
  optional Accessibility Reviewer).
- **Execution fork raised to operator before spawning.** The leg order has a hard environment dependency:
  Legs 1/3/4/5 are **apparatus-gated** — they require a live admin-wired Goldfinch GUI instance (WSLg) with
  **no foreign instance** bound (the exact F4 Leg-4 blocker), which is operator-machine-dependent and not
  something an autonomous Developer agent can stand up. **Leg 2 (keyboard bridge)** is code — implementable
  autonomously — and the flight spec (DD1) explicitly notes it is apparatus-independent. Decision pending:
  start Leg 1 (interactive bring-up + litmus) if the environment is ready now, vs. start Leg 2 (autonomous
  code) first while the admin-wired venue is prepared.
- **Operator chose Leg-1-first (interactive bring-up); F4 foreign-instance blocker confirmed cleared.**
- **Leg 1 design review waived** (Flight Director discretion): a lightweight interactive environment/gate leg
  whose litmus ops (`getChromeTarget`/`enumerateTabs`) + launch recipe were already codebase-verified during
  flight planning (Architect Phase-5b) and my direct reads — a full design-review Developer spawn would be
  disproportionate. Recorded here per the decision-log requirement.
- **Leg 1 COMPLETE — litmus green** (details in Leg Progress). Material finding surfaced by the gate: the
  default MCP port `49707` is Hyper-V-reserved on this WSL2 rig → pinned `8899` (Deviation logged). No source
  changes; nothing committed (batch-commit model). **Next: Leg 2 (`cross-view-keyboard-bridge`) — autonomous
  code**, paused for operator go-ahead before the design+implementation cycle.
- **Operator: "proceed with the rest of the flight."** Ran Leg 2 design (direct-authored, code-grounded) →
  design-review Developer (**approve-with-changes**; incorporated: internal-tab path pinned to a minimal
  internal-guest handler, chrome Tab-wrap citations corrected, Tab target + Shift+Tab scope pinned) →
  implementation Developer (**complete, `landed`**; new `src/shared/cross-view-nav.js` + contained main.js
  wiring; **1060/1060 tests, typecheck+lint clean**; Tab-wrap: no code, reasoned Chromium-native).
- **Leg 2 FD verification (apparatus-driven, on the fixed build @ 8899) — all three gaps confirmed working:**
  - **Ctrl+L (web guest):** ✅ guest `field` focused → Ctrl+L → chrome `address` focused → `typeText(C,"example.com")`
    **lands in the address bar** (typeable, proving the OS-focus handoff, not just DOM focus).
  - **Tab handoff:** ✅ chrome `address` focused after `pressKey(G,"Tab")`. Caveat (recorded in the spec): the
    guest's own `document.activeElement` still reads `field` — Chromium dispatches no blur when OS focus leaves a
    sibling view; inert, and the meaningful assertion (chrome focused) passes. Spec Step 5 relaxed accordingly.
  - **Chrome Tab-wrap:** ✅ 26 distinct controls traversed, `address` reappears at press 26 (wraps), **zero
    `<body>`/null stranding** — Chromium-native wrap in the standalone chrome document. Developer's no-code call vindicated.
  - **Internal-tab Ctrl+L:** ⏸ not verifiable via the automation apparatus — `openTab` refuses non-http(s), so an
    internal `goldfinch://` tab can't be stood up through MCP. The code path (a minimal internal-guest
    `before-input-event`) is in place; spec Step 7 updated to open settings via the chrome UI route. Carried to
    the formal Witnessed run.
  - **Method note:** FD verification drove the `chrome-guest-keyboard-nav` steps directly via the MCP client
    (Executor-role). The **formal two-agent Witnessed run** of `chrome-guest-keyboard-nav` remains the committed
    regression net (to run in the corpus phase). Two apparatus gotchas learned for the corpus: (1) the
    `scripts/lib/mcp-client.mjs` `callTool` ALREADY unwraps — do not double-`unwrap`; (2) the `evaluate` tool arg
    is **`expression`**, not `script`; (3) wait for a non-empty `enumerateTabs` before asserting (window/tab not
    interactive ~2 s post-bind).

- **Operator: "fire it off… it's all automation."** Full autonomous corpus execution authorized. **Corpus
  orchestration model (FD decision):** run the corpus leg-by-leg; per leg, a self-contained **Executor** agent
  owns one admin-wired instance (8899) and drives every spec in the leg sequentially (no cross-spec state
  collision), writing per-spec run logs with evidence; then an **independent Validator** agent judges the
  Executor's evidence against each spec's expected results (preserving the Witnessed separation: driver ≠ judge).
  Legs run sequentially (each owns the single GUI instance). Real regressions → FD triages + spawns a Developer
  fix + re-run; spec-drift → spec update recorded; apparatus-limit (e.g. internal tab un-openable via `openTab`)
  → recorded, deferred to the formal two-agent Witnessed run. The proven apparatus gotchas (no double-unwrap;
  `evaluate` arg is `expression`; readiness-wait; `openTab` http-only; port 8899) are handed to each Executor.
- **Leg 3 (security + gating) Executor spawned** (background): `internal-session-exclusion`, `mcp-jar-scoping`
  (both BLOCKING), `tab-scheme-guard`, `farbling-correctness`, `tab-surface-geometry`, `internal-tab-menus`.

## Leg Progress

### Leg 1 — apparatus-bringup-and-litmus
**Status**: completed
**Started**: 2026-07-08
**Completed**: 2026-07-08

#### Changes Made
- No source changes (environment/gate leg). Stood up a clean admin-wired flight-5 instance and proved the
  DD2 wiring litmus **green**.

#### Notes
- **Pre-flight**: port free, zero foreign Goldfinch processes (F4 foreign-instance blocker confirmed cleared).
- **Litmus (admin tier, via `scripts/lib/mcp-client.mjs`):**
  - `getChromeTarget()` → `{"wcId":1,"kind":"chrome","url":"file://…/src/renderer/index.html"}` — numeric chrome
    wcId, **not** the `automation: admin-only` refusal ⇒ admin scope honored, bound to THIS instance.
  - `enumerateTabs()` → `[{wcId:2, url:"https://www.google.com/", jarId:"default", active:true}]` — this
    instance's tabs only, **no foreign jar** (the F4 failure mode is absent).
  - `openTab("https://example.com")` + re-`enumerateTabs()` → new tab wcId 3, `active` flags flip correctly ⇒
    drive+observe apparatus works end-to-end at admin tier.
- **Readiness caveat (for the corpus legs):** immediately (~2 s) after bind, `getChromeTarget`/`enumerateTabs`
  return empty — the window/default tab aren't up yet. Wait for a non-empty `enumerateTabs` (or the chrome
  target to resolve) before asserting. Not a defect; a start-order timing note.
- Instance torn down after the litmus to leave a clean slate for the Leg 2 code work (the recipe below is
  proven and reused per leg).

---

### Leg 2 — cross-view-keyboard-bridge
**Status**: landed
**Started**: 2026-07-08
**Completed**: 2026-07-08

#### Changes Made
- **New pure helper `src/shared/cross-view-nav.js`** (`crossViewNavAction`, dual-export, `// @ts-check`) —
  mirrors `sheet-accelerator.js` / `keydown-action.js`. Pure decision: Ctrl/Cmd+L → `'focus-address'`,
  unmodified Tab → `'tab-handoff'`, everything else (incl. Shift/Ctrl/Alt+Tab and every existing guest
  accelerator) → `null`. No DOM/IPC/Electron, so it unit-tests under plain `node --test`.
- **`src/main/main.js`** — three surgical additions, contained approach:
  1. `require('../shared/cross-view-nav')`.
  2. New module-scope `handleGuestCrossViewNav(event, input)` (defined just above `wireGuestContents`): runs
     the pure decision, then the side effects — `event.preventDefault()`, an `isAutoRepeat` swallow-but-no-op
     guard, and **focus-then-send** (`getChromeContents()?.focus()` for OS focus, reusing the `focusChrome`
     primitive, THEN `getChromeContents()?.send('chrome-shortcut-action', { action: 'focus-address' })`). Both
     cross-view keys resolve to the pinned address bar, so both ride the existing `focus-address` channel →
     renderer `dispatchChromeAction('focus-address')` (`els.address.focus()/select()`).
  3. Wired into BOTH guest handlers: a single `if (handleGuestCrossViewNav(event, input)) return;` at the TOP
     of the existing web-guest `before-input-event` (the F12/zoom/print/find/downloads/devtools branches below
     it are **byte-for-byte UNTOUCHED** — no regression surface added), AND a NEW minimal `before-input-event`
     registered in a fresh `else` branch of the `!__goldfinchInternal` guard on internal guest contents that
     calls ONLY `handleGuestCrossViewNav` (internal tabs gain Ctrl+L/Tab and nothing else — they get no
     `before-input-event` at all today, so the chrome renderer-keydown fallback the flight Open Question floated
     could never fire when an internal tab holds OS focus; main-side capture is the only viable path).
- **New unit tests `test/unit/cross-view-nav.test.js`** (10 tests): Ctrl/Cmd+L (both cases) → focus-address;
  unmodified Tab → tab-handoff; Shift/Ctrl/Alt/Cmd+Tab → null; and a **regression guard** asserting every
  existing guest accelerator (F12/Ctrl+Shift+I/zoom/print/find/downloads) and every chrome-class key
  (Ctrl+T/W/M/R/Shift+P) returns `null` here — proving the new capture never shadows the untouched branches.

#### Chrome Tab-wrap gap — NOT reproduced-determination deferred to the live behavior run; NO code added
- Per the leg's explicit conditional ("FIRST determine whether the wrap gap reproduces under `WebContentsView`;
  if Chromium already wraps within the chrome document, do NOT add redundant code"), and because the reproduction
  is **behavior-spec Step 6 on the live GUI build** — which the Flight Director runs, not the autonomous
  Developer — **no top-level chrome-document Tab handler was added.**
- **Static analysis / rationale for leaning "already wraps":** a `WebContentsView` is a self-contained focus
  scope. Electron does **not** auto-traverse OS keyboard focus between sibling `WebContentsView`s (that is the
  entire premise of this flight — the boundary must be bridged manually), so when Tab reaches the end of the
  chrome document there is no sibling view to escape to and Chromium wraps within the chrome document by default.
- **Why a speculative handler would be actively wrong here:** the chrome is a large, dynamic focus scope (media
  panel, privacy panel open/close; the tab strip is a **roving-tabindex** widget where non-active tabs carry
  `tabindex="-1"`; hidden/disabled toolbar pins). A naive document-level `querySelectorAll` boundary handler
  (à la the lightbox trap, which works only because the lightbox is a tiny fixed button set) would mis-identify
  "the last focusable control" across chrome states and add real regression surface over the address bar / tab
  strip / panel keydown paths — exactly the "redundant code" the leg warns against. If the FD's
  `/behavior-test chrome-guest-keyboard-nav` Step 6 shows focus stranding on `<body>`, the correct follow-up is
  a **minimal boundary-only** handler (preventDefault only at the first↔last wrap, modeled on the lightbox trap /
  `focusItem` wrap math) — designed against the observed strand, not speculatively.

#### Verification
- `npm test` → **1060/1060 pass, 0 fail** (baseline was 947 at leg-spec authoring; the suite has since grown —
  the 10 new `cross-view-nav` tests are included; every prior test still green).
- `npm run typecheck` → clean. `npm run lint` → clean.
- Not run here (Flight-Director-driven on the live build): `/behavior-test chrome-guest-keyboard-nav` — the
  Witnessed net for all three gaps + typeability + internal-tab Ctrl+L, and the authoritative Tab-wrap
  determination.

#### Decisions / Deviations / Anomalies
- **DECISION (extraction):** extracted the two-key decision to a pure `src/shared/` helper (the leg marked this
  OPTIONAL). Rationale: main.js `before-input-event` branches are not unit-testable without Electron, so a pure
  dual-export helper is the only path to real `npm test` coverage + the "existing accelerators untouched"
  assertion — consistent with the codebase's `sheet-accelerator.js` / `keydown-action.js` pattern.
- **DECISION (Tab target):** unmodified Tab hands off to the **address bar** (the pinned, deterministic first
  chrome control) via the existing `focus-address` channel rather than a new dedicated signal — matches the leg
  AC's pinned target and avoids adding a renderer action. Select-all on Tab (a side effect of reusing
  focus-address) is harmless and the AC only requires `els.address` focused.
- **NOTE (internal-tab Ctrl+L):** on internal `goldfinch://` tabs the address bar is `readOnly` by design;
  `els.address.focus()` still focuses it (AC = "focuses the address bar," not typeability there), so the intent
  is satisfied.
- **No deviations, no anomalies** in the code work. Did NOT commit and did NOT signal `[HANDOFF:review-needed]`
  (batch-commit model — code review + commit at flight end).

---

### Leg 3 — security-and-gating-specs
**Status**: landed
**Started/Completed**: 2026-07-08

#### Result: 6/6 PASS — Validator CONFIRMED all six (no source changes, no regressions)
| Spec | Executor | Validator | Run log |
|------|----------|-----------|---------|
| internal-session-exclusion (BLOCKING) | PASS 5/5 | CONFIRMED | `internal-session-exclusion/runs/2026-07-08-18-17-19.md` |
| mcp-jar-scoping (BLOCKING) | PASS 10/10 | CONFIRMED | `mcp-jar-scoping/runs/2026-07-08-18-19-42.md` |
| tab-scheme-guard | PASS 13/13 | CONFIRMED | `tab-scheme-guard/runs/2026-07-08-18-21-36.md` |
| farbling-correctness | PASS 6/6 core | CONFIRMED | `farbling-correctness/runs/2026-07-08-18-27-53.md` |
| tab-surface-geometry (first run) | PASS 8/8 | CONFIRMED | `tab-surface-geometry/runs/2026-07-08-18-30-51.md` |
| internal-tab-menus (first run) | PASS 7/7 | CONFIRMED | `internal-tab-menus/runs/2026-07-08-18-34-54.md` |

- **Trust boundary intact (SC5-part):** internal `goldfinch://settings` session refused at resolve-time on all
  drive/observe tools (`automation: internal-session`, exact wcId echo — `resolve.js:95-106`) with a working
  web-tab control; jar key confined with the correct discriminated refusal per case (`out-of-jar` /
  `internal-session` / `admin-only`), admin's two relaxations (all jars + internal) demonstrated. Validator
  cross-checked the verbatim refusal strings against `resolve.js:105/172` + `scope.js:151`.
- **Freeze-frame retirement confirmed on the new surface** (first-ever runs of tab-surface-geometry +
  internal-tab-menus): menus composite above LIVE guests/internal views; panel reflows the view 1398↔1038;
  find floats over a full-bounds guest. The F3 occlusion/no-resize regression class is netted.
- **Deviations (Anomalies section):** methodology hygiene gap (self-witnessed execution) + cosmetic spec-drift.

### Leg 4 — automation-mcp-corpus (SC6)
**Status**: landed
**Started/Completed**: 2026-07-08

#### Result: SC6 automation parity PASS — Validator CONFIRMED (no regression; no source changes)
| Spec | Verdict | Note |
|------|---------|------|
| mcp-loopback-origin-guard | **PASS 7/7** | 403 on bad Host/Origin/DNS-rebind; loopback-bound (raw status evidence) |
| mcp-drive-end-to-end | **PASS 9/9** | real pixels (non-blank PNGs) + Step-9 independent cross-check |
| foreground-to-act | **PASS 5/5** | background-capture + input render |
| mcp-auth-gating | **PASS 10/10** | keyless/wrong/empty→401, valid jar/admin→accept (raw HTTP statuses) |
| automation-key-gating | **PASS (on triage)** | Executor FAIL was a **profile-mismatch false alarm** — see DD9 triage |
| settings-automation | **PASS (on triage)** | Step-3 FAIL same false alarm; structure/status otherwise pass |
| devtools-cdp-conflict | **apparatus-limit** | CDP attach-failed not reproducible on WSLg — macOS-authoritative (DD8), not a regression |
| observe-refusal-contract | **PASS (Step 2 DD8)** | error+image arms pass; CDP-refusal arm is the WSLg venue limit |

- **DD9 triage (FD + independent Validator agree — FALSE ALARM, DD9 intact):** the dev launch uses the
  **`goldfinch-dev`** profile (`init-profile.js` `!app.isPackaged` redirect), which has `automationEnabled:true`
  + populated key hashes; the Executor compared the UI against the **`goldfinch`** (prod) profile (`false`).
  `settings.js` derives BOTH the toggle `checked` (`:390/:488`) and mint `disabled` (`:605/:641`) from the
  PERSISTED value (`settingsGet('automationEnabled')`, `:691`) — no dev-override term in the render path
  (`renderStatus` touches only text). So toggle-ON + mint-enabled is the CORRECT reflection of the dev profile's
  persisted `true`. No migration drift.
- **Open (not blocking; debrief follow-up):** the DD9 mint-gate **OFF branch** (persisted false ⇒ mint DISABLED)
  was not positively witnessed this run (dev profile was `true`); code + the working keyless-`Revoke`-disabled path
  strongly imply it. Recommend a clean OFF-case re-run against the **dev** profile.
- **For Leg 6 (housekeeping) / spec refresh:** (1) pin the Executor runbook to read `~/.config/goldfinch-dev`
  under `dev:automation` (prevents this wrong-profile comparison); (2) fix `mcp-drive-end-to-end` Step 9's
  parenthetical — `captureWindow` is admin-only (correct posture, spec text wrong); (3) note the WSLg DPR-1.25
  device-pixel `click(x,y)` coordinate-space fact (`readDom`/`readAxTree` carry no geometry).

### Leg 5 — conveniences-corpus (SC4)
**Status**: landed
**Started/Completed**: 2026-07-08

#### Result: SC4 formal net PASS on the native surface (WSLg-venue caveats; no product regression)
| Spec | Verdict | Note |
|------|---------|------|
| page-zoom | **PASS** | keyboard + setZoom + per-jar isolation + internal refusal |
| print-to-pdf | **PASS** | valid `%PDF-1.4` + internal/permission refusals |
| downloads-surface | **PASS** | one record/trigger, admin-only gating, on-disk corroboration, `(1)` dedup |
| menu-dismissal | **PASS** | all 9 (outside-click, mutual exclusion, Escape focus-restore, APG, keyboard-open) |
| kebab-menu | **PASS (on triage)** | primary behavior clean; step-8 "internal exclusion" sub-assertion was the admin-vs-jar mis-classification (below); step-9 focus-ring = WSLg apparatus-limit |
| page-context-menu | **PASS (partial)** | steps clean except Escape→`#kebab` not `#address` (minor SPEC-DRIFT, invariants hold) + F10/ContextMenu unemittable by pressKey (APPARATUS-LIMIT, HAT) |
| spellcheck | **PASS (state-proxy)** | toggle both directions via store+AX; squiggle/dictionary unpaintable on WSLg (INCONCLUSIVE-WSLg, per-spec not-a-failure) |
| find-in-page | **PARTIAL (WSLg)** | see cold-start below; stepping correct, new-search count blanks on WSLg |

- **SECURITY FLAG TRIAGED → NOT A REGRESSION (independent triage agent, raw evidence in
  `/tmp/behavior-tests/goldfinch/_triage-internal-exclusion/`):** Leg 5 drove the internal `goldfinch://settings`
  tab with the **admin** key and read admin's documented `allowInternal` relaxation as a breach. Confirmed live:
  a **JAR key is absolutely excluded** from internal (all ops → `automation: internal-session`; not enumerated)
  — the untrusted-consumer boundary is intact and Leg 3 holds. Admin's enumerate/readDom/navigate on internal is
  by design (resolve.js:104; evaluate/zoom/find/print/devtools still refuse even admin). **Pre-existing concern
  (NOT migration-caused, → debrief):** admin `navigate` loads web content into the internal partition (`nav.js`
  has no op-local internal guard, unlike zoom/find/print; `nav.js` unchanged this mission; script-injection stays
  blocked post-nav). Optional hardening: add an `isInternalContents` guard to `nav.js`.
- **FIND COLD-START ANSWERED (SC4 open question closed):** the M04 `{0,0}` cold-start blank-match-count quirk
  **still reproduces under WebContentsView on WSLg** — every `findNext:false` new-search returns `{0,0}` after
  ~2.5 s, while `findNext` stepping reports the correct `matches:2` and moves the ordinal. WSLg-known (prior runs
  likewise), **macOS-expected-pass**; `find-in-page.md` updated with the observed result. Carry to the F6 macOS gate.
- **For Leg 6 (housekeeping):** page-context Escape→`#kebab` spec-drift; F10/ContextMenu HAT note; spellcheck
  Default-OFF baseline needs a fresh-profile run.

### Leg 6 — a11y-and-housekeeping
**Status**: landed
**Started/Completed**: 2026-07-08

#### Result: a11y gate GREEN; housekeeping + spec-drift fixes folded; no source-logic changes
- **a11y gate PASS.** Ran `npm run a11y` against a fresh admin-wired instance (launch recipe: `GOLDFINCH_AUTOMATION_ADMIN=1
  GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_MCP_PORT=8899 npm run dev:automation`; fixture served on `:8000` from
  `tests/behavior/fixtures/a11y-media/`; `GOLDFINCH_MCP_ADMIN_KEY` exported from the `AUTOMATION_DEV_MINT` line).
  Result: **0 NEW violations — every violation node is in the ACCEPTED baseline ✅** (exit 0). 21 accepted baseline
  nodes reported informationally across the 5 chrome states + 3 sheet states (the documented app-shell exceptions:
  `landmark-one-main`/`page-has-heading-one` on `html`, `region` on `#tabs`/`#brand`/`#sheet-menu`). The
  pre-accepted `#address-wrap` region, the two `scrollable-region-focusable` overflow entries, and the
  `sheet:site-info`/`sheet:new-container` states did not fire in this run's states (consistent with the harness's
  documented not-always-reproduced notes). This closes the SC4 formal-net a11y half deferred since F4 Leg 2.
  **No a11y regression from the flight** — no triage/venue exceptions needed.

#### Changes Made
- **CLAUDE.md conventions (F4 rec #3):** new Patterns subsection "**Cross-view focus + tab-type idioms**" carrying
  (a) the **focus-then-send rule** (`getChromeContents()?.focus()` before `.send()` when routing a keyboard-input
  action to the chrome view; cross-refs `handleGuestCrossViewNav` in `main.js` + `src/shared/cross-view-nav.js`,
  and flags the `sheet-accelerator.js` branch as NOT a copyable template since it omits `.focus()`), and (b) the
  **`isWebTab()`/`isInternalTab()`** decision idiom (never branch on raw `.trusted` — trust is call-site provenance
  at `createTab(..., { trusted: true })`).
- **Stale `will-attach-webview` comments corrected** to present-reality WebContentsView wording (machinery gone
  since F3), load-bearing context preserved: `src/renderer/renderer.js` (~:956), `src/preload/internal-preload.js:4`,
  `src/main/settings-store.js:64`. Comments only — no logic touched.
- **Specs promoted draft→active:** `tests/behavior/tab-surface-geometry.md`, `tests/behavior/internal-tab-menus.md`
  (both PASSed their first-ever runs in Leg 3).
- **Spec-drift text fixes:**
  - `mcp-drive-end-to-end.md` Step 9 (+ the Out-of-Scope clause): corrected the parenthetical — **`captureWindow`
    is admin-only** (verified `scope.js:149-151` refuses it for jar keys), so it is NOT part of the jar-driven
    observe set; the Step-9 whole-window cross-check runs at the admin tier. Both `captureWindow` and
    `getChromeTarget` now flagged admin-only.
  - `page-context-menu.md`: Escape focus-return for a pointer-invoked page-context menu aligned to **`#kebab`**
    (was `#address`); invariant "chrome-focused, not body/guest" preserved (Step 8 + the header summary quote).
  - **Dev-profile apparatus note** added to the four store-reading specs that lacked it — `settings-controls.md`,
    `toolbar-pins.md`, `settings-automation.md`, `spellcheck.md`: under `dev:automation` the profile is
    `~/.config/goldfinch-dev`, NOT `~/.config/goldfinch` (prevents the wrong-profile comparison that mis-fired in
    Leg 4). Specs that already carried this note (`automation-key-gating`, `page-context-menu`,
    `settings-activity-viewer`) were left as-is; `downloads-surface`/`tab-scheme-guard` don't read the profile
    store on disk, so no note added.

#### Verification
- `npm test` → **1060/1060 pass, 0 fail** (baseline held — comment/doc/spec-only changes).
- `npm run typecheck` → clean (exit 0). `npm run lint` → clean (exit 0).
- Did NOT commit; did NOT signal `[HANDOFF:review-needed]` (batch-commit model).

#### Notes / Deviations
- **NOTE (page-context Escape→`#kebab`):** the corpus-observed fallback (`#kebab`) diverges from CLAUDE.md's
  page-context prose ("else the address bar"). Only the **spec** was aligned this leg (per the leg scope); the
  CLAUDE.md page-context description was left untouched (out of this leg's scope) — flag for the debrief if a
  reconciliation is wanted.
- **NOTE (mcp-drive Step 9 admin tier):** the spec's Preconditions still frame the run as jar-driven and do not
  mention capturing the admin key; the corrected Step-9/Out-of-Scope text notes `captureWindow` requires the admin
  identity. A fuller Preconditions reconciliation (spell out the admin key for Step 9) is a possible follow-up,
  left out here to keep the change to the named parenthetical.
- **PARKED (unchanged, per DD5):** the repo-wide `<webview>`→WebContentsView terminology sweep across the behavior
  specs + `webview-preload.js` header — deferred to F6/maintenance.

---

## Decisions

### Corpus evidence-hygiene upgrade (applied from Leg 4 onward)
**Context**: Leg-3 Validator flagged that the Executor self-witnessed (drove + judged) and recorded refusals as
prose, not raw payloads — a real hygiene gap for BLOCKING specs (though it independently CONFIRMED via source).
**Decision**: from Leg 4 on, Executors persist the **raw `isError`/JSON tool-result payload per load-bearing
assertion** into the evidence dir (not just prose quotes), so the independent Validator judges artifacts. The
driver≠judge split stays at my orchestration level (separate Executor + Validator agents). A future belt-and-
suspenders **live** two-agent Witnessed re-run of the two BLOCKING security specs is recommended for the debrief
(no defect found — evidence hygiene only).

### Leg-1 apparatus launch + litmus recipe (authoritative for all corpus legs + F6)
**Context**: Legs 3–6 (and F6) all need the same admin-wired bring-up; record the proven recipe once.
**Decision**:
- **Launch**: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_MCP_PORT=8899 npm run dev:automation`
  → scrape the `AUTOMATION_DEV_MINT {"key":<jarKey>,"adminKey":<adminKey>}` stdout line (adminKey non-null under `GOLDFINCH_AUTOMATION_ADMIN=1`).
- **Keys**: `export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>` (admin/chrome), `export GOLDFINCH_MCP_KEY=<jarKey>` (jar/guest).
- **Litmus**: `connectAutomation()` (reads `GOLDFINCH_MCP_ADMIN_KEY` + `GOLDFINCH_MCP_PORT`) → `getChromeTarget` (expect numeric wcId, not the `admin-only` refusal) + `enumerateTabs` (expect this-instance tabs, no foreign jar). Wait for a non-empty enumerate first.
**Impact**: every apparatus-gated leg exports `GOLDFINCH_MCP_PORT=8899` at launch and in all client/curl calls; the mint keys are per-launch (re-scrape on each relaunch).

---

## Deviations

### Default MCP port 49707 unusable on this WSL2 rig → pinned to 8899
**Planned**: The flight spec/prereqs pinned `GOLDFINCH_MCP_PORT` at its default `49707`.
**Actual**: Launched with `GOLDFINCH_MCP_PORT=8899`.
**Reason**: On this WSL2/WSLg host, `49707` is **reserved by the Windows/Hyper-V networking layer** — `bind()`
fails with `EADDRINUSE` while `ss`/`netstat` show the port free (nothing *listening*). Proven independent of
Goldfinch: a plain `node net.createServer().listen(49707,'127.0.0.1')` throws `EADDRINUSE`, while 8899 / 49152 /
51000 all bind. `49707` sits in the ephemeral 49152–65535 range prone to Hyper-V port reservation; **8899** (a
stable low registered port) is used instead. Spec-compatible — `GOLDFINCH_MCP_PORT` override is the sanctioned
mechanism (the `mcp-drive-end-to-end` spec itself uses a custom port). Carry `8899` into every corpus leg + F6.

---

## Anomalies

### Reserved-port EADDRINUSE masqueraded as the F4 wiring blocker (resolved)
**Observed**: First two admin-wired launches (default port 49707) failed with `[mcp] failed to start automation
server: automation: MCP port 49707 is in use` — the server never bound, despite pre-flight showing the port
free. Superficially resembled the F4 apparatus-wiring failure.
**Severity**: blocking (until root-caused) → resolved.
**Resolution**: Root-caused to WSL2 Hyper-V **port reservation** (see Deviation above), NOT a Goldfinch
double-start regression — `toggle.js` already serializes the F8 double-bind race, and startup issues a single
`startMcpServerInstance()` (`main.js:2425`). Relaunch on `8899` bound cleanly; litmus green. The Leg-1 gate
did its job — it caught an apparatus problem before any corpus effort was spent.

---

## Session Notes

- **2026-07-07** — Flight planned via `/flight`. Reconnaissance walked the F4 debrief + mission Known Issues
  against current code (report above). Four planning decisions locked with the operator: (1) Leg-1 apparatus
  bring-up + wiring litmus; (2) full three-gap keyboard fix; (3) new `chrome-guest-keyboard-nav` Witnessed spec;
  (4) fold small F4 housekeeping, park the terminology sweep. New behavior spec drafted:
  `tests/behavior/chrome-guest-keyboard-nav.md`.
- **2026-07-07 — Architect design review (Phase 5b): approve-with-changes.** All premises verified against real
  code (guest `before-input-event` set `main.js:998` lacks Ctrl+L/Tab ✓; DD13 mapper `sheet-accelerator.js` maps
  `l→focus-address` ✓; apparatus real ✓; zero functional `<webview>` spec dependency ✓). Four fixes applied:
  (1) **[HIGH]** the keyboard-nav spec read focus via `readDom`→`activeElement`, but `readDom` returns only
  `{url,title,html}` and doesn't serialize `activeElement` — rewrote focus observables to `evaluate` +
  `readAxTree` (+ `typeText` typeability proof). (2) **[MED]** `pressKey` chord notation fixed to
  `pressKey(G,"l",["control"])` (name + separate modifiers array). (3) **[MED]** DD3 now states the OS-focus
  requirement (`getChromeContents().focus()` — the sheet branch is *not* a copyable template; it omits `.focus()`).
  (4) **[MED]** DD1 rationale corrected — F6 also needs the admin apparatus; the split is thematic + fix-keyed,
  not "only F5 needs it." Suggestions folded: DD3 narrowed to the named gaps (not the full accelerator union —
  avoids seizing guest Ctrl+R reload); Tab handoff flagged as guest-specific (do NOT edit the shared mapper,
  which returns `null` for Tab by design); internal-tab Ctrl+L intent + deterministic Tab target added as
  leg-design Open Questions.
