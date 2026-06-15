# Flight: Settings key management + automation UI

**Status**: in-flight
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC9** — keys are **managed from the Settings area** (generate / rotate / revoke), persisted, effective immediately: per-jar keys from the jars surface + the env-gated admin key from its env-gated control. *(Storage: the DD5 hash model — see DD2 below — reframes "encrypted safeStorage codec" as already-satisfied; hashes are non-secret at rest.)*
- [ ] **SC10** (visible half) — automation activity is **auditable**: a visible "automation active" indicator that **distinguishes an admin session from a jar session and names the jar**, plus an action-log viewer. *(The data layer + `automation-activity-changed` broadcast landed in Flight 4; this flight renders it.)*
- [ ] **SC8** (UI completion) — the off-by-default **opt-in toggle** gets its operator-facing control (the gate/validation landed in Flight 4; this flight surfaces the toggle).

---

> **Branch / PR cascade.** Flight 3 (#40) and Flight 4 (#41) are not yet merged. This flight **branches off `flight/04-gating`** and **stacks its PR** on #41. Branch: `flight/05-settings-key-management`. The auth stack cascades (#40 → #41 → this) until merged in order.

> **Scope boundary (Flight 4 ↔ 5, honored).** Flight 4 shipped the auth **core** (toggle gate, key model/storage/validation, jar-scoping, env-gated admin tier, audit **data** layer, behavior tests, a dev-only enable/mint path). **This flight ships the management UX**: the operator-facing enable toggle, generate/rotate/revoke key controls, the env-gated admin-key control, the visible "automation active" indicator, the audit-log viewer, **and** surfacing the MCP connection address (operator-raised). It replaces the Flight-4 dev seam (`automation:dev-enable-mint` IPC / auto-mint-to-stdout) with real controls.

## Pre-Flight

### Objective

Give the operator a complete, self-service automation control surface in `goldfinch://settings`: turn the surface on/off, generate/rotate/revoke per-jar keys (and the env-gated admin key) with show-once plaintext + copy, **see the live MCP connection address** (host:port + `/mcp` + bind status + a copy button + a cross-OS connect hint) so they can configure any MCP client/the-one, and watch automation activity (a visible active-session indicator + an action-log viewer). Backed by a **persisted, configurable port** (moved off the collision-prone 7777 into the IANA dynamic range, with a "find a free port" helper) so the displayed address is real and stable across launches. SC9 + the visible half of SC10 + the SC8 toggle UI.

### Open Questions
- [x] **Port strategy** → **RESOLVED (DD1):** persisted+configurable `automationPort` (default in the dynamic range; "find free port" button; env > setting > default precedence); UI shows the live bound address + bind status.
- [x] **SC9 storage form** → **RESOLVED (DD2):** keep the Flight-4 DD5 hash model (hashes non-secret at rest); no per-key encryption; the safeStorage codec seam stays available but unused for keys.
- [x] **UI behavior-test apparatus** → **RESOLVED (DD3):** existing CDP `:9222` (`settings-shell` precedent); full migration to the new MCP surface stays Flight 6.
- [x] **HAT** → **RESOLVED:** include the optional guided HAT (DD7).
- [x] **`openTab` jar-targeting gap (carried from F4 debrief)** → **RESOLVED: DEFER to Flight 6.** It's automation-**engine** work (renderer `createTab` in a specific jar), not settings UI — out of scope here; carried as a Flight-6 item.
- [x] **Indicator location** → **RESOLVED (DD6):** always-visible chrome toolbar indicator **+** detailed audit viewer in settings (SC10 needs visible-without-opening-settings).
- [ ] **Default port value** → propose `49707` (dynamic range); confirm or pick another at execution. Low-stakes (UI displays + copies it).

### Design Decisions

**DD1 — Persisted, configurable port (default in the IANA dynamic range) + live address surfacing.**
- Choice: add a persisted `automationPort` setting (validated integer in `1024–65535`; **default a fixed dynamic-range port, proposed `49707`**, moving off the collision-prone 7777). `resolvePort` precedence becomes **`GOLDFINCH_MCP_PORT` env (dev/test) > persisted `automationPort` > default**. The Settings UI shows the **live bound address** (`http://127.0.0.1:{port}/mcp`), a **bind-status** indicator (bound / failed-EADDRINUSE / disabled), a **copy** button, a **port field** to change it, and a **"find a free port"** button that scans loopback `49152–65535` for an open port and sets it. Host stays `127.0.0.1` (hard SC7 constraint — never configurable).
- Rationale: 7777 is heavily squatted (we hit a live collision); the dynamic range has no registered services. Persisted+configurable keeps a consumer's config (the-one, `.mcp.json`) valid across launches; the find-free-port button + bind-status recover from collisions in-app (Flight 4 failed to bind silently to stderr — a real UX gap this fixes). Surfacing the live address is the operator-raised requirement and the only reliable way to "know how to set up the MCP."
- **Port-change semantics → NEXT-LAUNCH (resolved-to-divert, design-review).** `resolvePort()` reads only the env var today and is called at `createMcpServer` construction, baking the port into `start()`'s `srv.listen`. A live rebind would need `stop()` + a fresh `createMcpServer(newPort)` + `start()` (re-passing all deps) — out of scope for v1. **Commit:** a port change is persisted and **takes effect on next launch**; the UI shows BOTH the **active** port (what the running server is bound to, from the status IPC) and the **pending** port (the stored `automationPort`), annotated "(takes effect on next launch)". Live-rebind is a possible future enhancement, not this flight.
- **`resolvePort` refactor:** read the persisted `automationPort` at construction → precedence `env > setting > default`. Inject the settings reader (the same `getSettings` seam Flight 4 added) rather than a bare require.
- **Free-port scanner:** probe candidates **sequentially** with `net.createServer().listen(c,'127.0.0.1')`+close; result is advisory (a TOCTOU window remains — the real bind on next launch is authoritative; bind-status surfaces a failure).
- Trade-off: a port-config control + a free-port scanner + capturing the bind result for the renderer. Changing the default is a minor migration — and the hardcoded `7777` references in `.mcp.json`, `CLAUDE.md`, and the F4 behavior-test specs (`mcp-auth-gating`, `mcp-jar-scoping`) must be reconciled (see Prerequisites + the docs checklist).

**DD2 — SC9 storage: keep the DD5 hash model; no per-key encryption.**
- Choice: per-jar key hashes (`automationKeyHashes`) and the admin key hash (`automationAdminKeyHash`) stay as SHA-256 hex in the plaintext settings JSON. The `{serialize,deserialize}` safeStorage codec seam remains available but is **not** applied to keys.
- Rationale: hashes are non-secret at rest — nothing to decrypt, nothing to leak; this is arguably stronger than an encrypted retrievable key for a validation-only credential. Reframes the mission's "encrypted safeStorage codec seam, not plaintext" sub-detail as **satisfied by hashing** (operator-confirmed). The plaintext key is shown **once** at generation and never persisted.
- Trade-off: the literal "encrypted" wording in SC9 is met by non-secrecy rather than encryption. Recorded; reversible to a file-level codec later if wanted.

**DD3 — UI behavior-test apparatus: existing CDP `:9222`.**
- Choice: the Flight-5 settings UI behavior test(s) drive `goldfinch://settings` via the existing `dev:debug` + CDP-at-`:9222` apparatus (the `settings-shell`/`settings-controls` precedent). **Apparatus premise (act + observe):** CDP `Runtime.evaluate` against the settings guest target *acts* (click toggle, fill port, click generate/copy) and *observes* (read the rendered address text, the bind-status element, the show-once key field, the indicator/viewer DOM) — both axes are the same surface the existing settings specs already use; no test-only seam needed.
- Rationale: proven for the settings page; keeps Flight 5 focused. Dogfooding the new MCP surface to drive the chrome/settings is a Flight-6 concern (needs the chrome-enumeration affordance the F4 debrief flagged).
- Trade-off: this flight's UI spec rides the to-be-retired `:9222` path (consistent with the other settings specs until Flight 6/7 migrates them).

**DD4 — Show-once plaintext keys via `navigator.clipboard` in the secure settings context.**
- Choice: generated/rotated plaintext keys are displayed **once** with a **copy** button using `navigator.clipboard.writeText` (the `goldfinch://settings` scheme is registered `secure:true`, so the clipboard API is available — no IPC needed; an internal-bridge IPC fallback is optional). Plaintext is never persisted or retrievable; only the hash is stored (DD2).
- Rationale: matches Flight 4's hash-and-show-once model; the secure context makes the web clipboard API the simplest path.
- **Fallback built in parallel (design-review):** implement an internal-bridge `clipboard:write` IPC (main-side `clipboard.writeText`) alongside the `navigator.clipboard` primary path — the internal webview runs `contextIsolation:true` + `sandbox`, where the web clipboard API can be blocked at runtime. Build both up front, not reactively at test time.
- Trade-off: if the operator dismisses the show-once display without copying, they must rotate to get a new key (expected for a show-once secret).

**DD5 — Real Settings controls replace the Flight-4 dev seam; new generate/rotate/revoke IPC.**
- Choice: the Settings "Automation" section drives `automationEnabled` via `settingsSet`, and **new internal IPC handlers** — `automation:jar-key-generate` / `automation:jar-key-rotate` / `automation:jar-key-revoke` and `automation:admin-key-generate|rotate|revoke` — back the key lifecycle (generate/rotate = `enableAndMintJarKey`/`mintAdminKey` returning show-once plaintext; revoke = delete the hash entry). Admin controls are **rendered only when `GOLDFINCH_AUTOMATION_ADMIN` is set** (the env presence gate; query it via the status IPC).
- **TWO seams, retire only ONE (design-review — load-bearing):** Flight 4 has (a) the **`automation:dev-enable-mint` IPC** (chrome-renderer-only; nothing behavior-tests through it) — **RETIRE** it (superseded by these UI controls); and (b) the **auto-mint-to-stdout** seam (`shouldAutoMint`: `--automation-dev` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, prints `{key,adminKey}` once) — **KEEP it indefinitely.** The stdout seam is the **headless behavior-test apparatus** for `mcp-auth-gating`, `mcp-jar-scoping`, and this flight's `verify-integration` (a behavior-test client needs a key *before* any UI exists). Do NOT retire (b).
- **`revoke` semantics:** delete the hash entry only; do **NOT** `sessions.delete()` the live session (the transport is still open and the SDK owns it). Flight-4's per-request live re-validation kills the session via 401 on its next request; the audit indicator shows it "connected" until the transport closes (DD6 wording).
- Rationale: completes SC9 self-service; reuses the production-ready Flight-4 backend; keeps the IPC origin-checked (internal-page bridge, `registerInternalHandler`).
- Trade-off: new IPC surface; revoke is net-new (Flight 4 only had generate). "Effective immediately" is free — the live re-validation already kills a revoked/toggled-off session.

**DD6 — Visible activity indicator (chrome) + audit-log viewer (settings), consuming `automation-activity-changed`.**
- Choice: **both surfaces (design-review — resolved at design time, not leg time).** (1) An **always-visible chrome indicator** — `broadcastToChromeAndInternal` already fans `automation-activity-changed` to the chrome renderer, so add `onAutomationActivity`/`offAutomationActivity` to **`chrome-preload.js`** (`window.goldfinch`) + a small toolbar status light that lights when ≥1 session is attached. An always-visible indicator is what SC10 ("the operator can **see** that a session is active") actually requires — a settings-only indicator is invisible until the operator opens settings. (2) A detailed **audit-log viewer in the settings page** via `onAutomationActivity` on the **internal** bridge (`window.goldfinchInternal`). Both **distinguish admin vs jar and name the jar**.
- Indicator copy reflects **transport lifecycle, not auth-liveness** (a revoked session lingers until its transport closes) — phrase it "connected", not "authorized".
- Rationale: renders SC10's visible half on the stable data contract Flight 4 shipped; the chrome listener is a ~10-line addition since the fan-out already reaches the chrome.
- Trade-off: two preload surfaces get a listener (chrome + internal); broadcast fires per-mutation (fine for one consumer; debounce only if the live viewer feels chatty).

**DD7 — Guided HAT included; close the `mcp-jar-scoping` partial run.**
- Choice: include the optional `hat-and-alignment` leg (UI look/feel + the generate→copy→connect flow + indicator). **Also** fold in completing the Flight-4 `mcp-jar-scoping` **full live run** during `verify-integration` — the new jars UI is the apparatus that finally lets the operator stage tabs across jars + a burner + the settings tab, so the cross-jar/internal/burner refusals become stageable live (flips that run log from `partial`).
- **Apparatus for the run (design-review):** the **kept stdout auto-mint seam** (DD5) supplies the jar key(s) + admin key headlessly (launch with `GOLDFINCH_AUTOMATION_DEV_MINT=1`); the **multi-jar staging** that was previously impossible now comes from the new jars UI (open tabs in `personal`/`work` + a burner + the settings tab via the operator). Pin the port with `GOLDFINCH_MCP_PORT` for the run so the client URL is deterministic regardless of the new default.
- **Stale-spec reconciliation (HIGH, design-review):** `mcp-jar-scoping.md` (and `mcp-auth-gating.md`) currently (a) frame the auto-mint-to-stdout as a not-yet-built `verify-integration` prerequisite — **now landed in F4**, so that precondition is stale and must be corrected; and (b) hardcode `http://127.0.0.1:7777/mcp` — must be reconciled to the pinned `GOLDFINCH_MCP_PORT` (and the new default). Update both specs as a `verify-integration` task **before** running.
- Rationale: the jars-management UI is exactly the missing apparatus from the F4 disposition; closing it here is the natural home.
- Trade-off: a cross-surface verification step (CDP for the new UI spec; the MCP surface for `mcp-jar-scoping`).

### Prerequisites
- [x] **Flight 4 landed** — auth core, the three settings keys, `enableAndMintJarKey`/`mintAdminKey`, the `automation-activity-changed` broadcast + audit data, `createMcpServer` returning `{start,stop,port,getActivity}`. (Completed 2026-06-15; PR #41.)
- [ ] **Branch off `flight/04-gating`** (PR #41 not merged) — verify the stack base at flight start.
- [ ] **Mission-02 settings substrate present** — `goldfinch://settings` page (`src/renderer/pages/settings.{html,js}`), the `window.goldfinchInternal` bridge (`settingsGet/Set`, `onSettingsChanged`), `registerInternalHandler` origin-checked IPC, `broadcastToChromeAndInternal`, and the jars IPC (`jars-list`/`jars-add`). (Landed M02.)
- [ ] **Bind-status capture** — `main.js` currently only `console.error`s an EADDRINUSE; this flight must capture the start outcome (bound port | error) and expose it via a status IPC. Confirm the `mcpServer.start()` call site is the integration point.
- [ ] **Env-conflict check** — the new default port (proposed `49707`) must be confirmed free on the dev box; the find-free-port scanner covers collisions. `GOLDFINCH_AUTOMATION_ADMIN` unchanged.
- [ ] **No new session category** — UI + IPC only; no new `webContents` session partition (the mission's session-type-registry prerequisite still does not apply).
- [ ] **Hardcoded `7777` references to reconcile** when the default changes (DD1): `.mcp.json`, `CLAUDE.md` (automation section), and the F4 specs `tests/behavior/mcp-auth-gating.md` + `mcp-jar-scoping.md` (which also carry the stale "auto-mint-to-stdout is a not-yet-built prerequisite" note — now landed). Reconcile during `key-management`/`verify-integration`, not silently.

### Pre-Flight Checklist
- [x] Open questions resolved (port strategy, SC9 storage, apparatus, HAT, `openTab`-defer, indicator location) — only the default-port *value* (`49707` proposed) left to confirm at execution (low-risk; UI displays it)
- [x] Design decisions documented (DD1–DD7, Architect-reviewed: approve-with-changes, all incorporated)
- [x] Prerequisites identified (branch base `flight/04-gating`; M02 settings substrate; bind-status integration point at `mcpServer.start()`) — *verified at flight start*
- [x] Validation approach defined (CDP UI behavior test `settings-automation` + the completed `mcp-jar-scoping` live run + unit/headless for the port/status/key IPC; guided HAT)
- [x] Legs defined (7 tentative; created one at a time during execution)
- [x] Operator sign-off (2026-06-15) — flight marked `ready`

---

## In-Flight

### Technical Approach

UI + a thin backend layer over the Flight-4 auth core, all origin-checked through the internal-page bridge:

1. **`port-and-address-backend`** — add the `automationPort` setting (validator: integer `1024–65535`) + a `freePortInRange()` helper (scan loopback `49152–65535`); change `resolvePort` precedence (env > setting > default; default → `49707`); capture the `start()` outcome (bound port | EADDRINUSE | disabled) into queryable state; add an origin-checked status IPC (`automation:get-status` → `{ enabled, host:'127.0.0.1', port, bound, error }`) + a `automation:find-free-port` IPC. Unit + headless.
2. **`automation-settings-section`** — a new `<section id="automation">` in `settings.html` + a controller in `settings.js`: the enable toggle (`settingsSet('automationEnabled')`), the live address display + copy button + bind-status, the port field + "find free port" button (writes `automationPort` → triggers a rebind or prompts relaunch — confirm rebind feasibility at leg time), and a short "how to connect" hint (Bearer header + the WSL2-mirror / Docker `--network host` note + a docs link). Bridge: add the status getter + `onAutomationActivity` listener.
3. **`key-management`** *(jar + admin)* — per-jar generate/rotate/revoke controls on the jars surface (list jars via `jars-list`, each row: generate/rotate → show-once plaintext + copy; revoke → delete hash) + the env-gated admin-key control (rendered only when the status IPC reports the admin gate set). New origin-checked IPC handlers backed by `enableAndMintJarKey`/`mintAdminKey` + a net-new revoke. Retire/demote the Flight-4 dev seam.
4. **`activity-indicator-and-audit-viewer`** — `onAutomationActivity`/`offAutomationActivity` on the bridge; a visible active-session indicator (admin vs jar, names the jar; "connected" semantics) + an audit-log viewer in settings rendering the action log. Indicator location decided here.
5. **`behavior-test-specs`** — author `settings-automation` (CDP apparatus, DD3): enable toggle flips the setting; key generate → show-once + copy; address display + port-config + bind-status; indicator + viewer render on a live session. (The existing `mcp-jar-scoping` spec is reused, not re-authored.)
6. **`verify-integration`** — run `settings-automation` (CDP); **complete the `mcp-jar-scoping` full live run** (stage multi-jar + burner + settings tabs via the new UI; flip run-log to pass); full unit + typecheck + lint green.
7. **`hat-and-alignment`** *(optional — included)* — guided HAT: operator drives the new UI end to end (enable → generate key → copy → connect a client → watch the indicator/log → rotate/revoke → confirm the live session dies), admin tier when env-set.

### Checkpoints
- [ ] `automationPort` setting + validator; `resolvePort` precedence (env > setting > default `49707`); free-port scanner; bind-status capture; `automation:get-status` + `automation:find-free-port` IPC (origin-checked).
- [ ] Settings "Automation" section: enable toggle, live address + copy + bind-status, port field + find-free-port, connect hint.
- [ ] Per-jar generate/rotate/revoke + env-gated admin-key controls (show-once + copy); dev seam retired/demoted; revoke kills a live session (Flight-4 live re-validation).
- [ ] Visible active-session indicator (admin vs jar, names jar) + audit-log viewer; `onAutomationActivity` bridge.
- [ ] `settings-automation` behavior test authored.
- [ ] Live: `settings-automation` passes (CDP); `mcp-jar-scoping` full live run passes (flips from `partial`); full gates green.
- [ ] Guided HAT.

### Adaptation Criteria
**Divert if**:
- A live port change can't rebind the running server without a relaunch → fall back to "change takes effect on next launch" (display the pending vs active port) and record it.
- `navigator.clipboard` is unavailable/blocked in the settings context at runtime → fall back to the internal-bridge `copy-to-clipboard` IPC.

**Acceptable variations**:
- Indicator location (chrome toolbar vs settings-only).
- Default port value (any free dynamic-range port).
- Whether the dev seam is fully removed vs demoted-for-CI.
- Audit-viewer richness (live-tail vs on-open snapshot).

### Legs

> **Note:** Tentative; created one at a time as the flight progresses. May merge/split.

- [x] `port-and-address-backend` — `automationPort` setting + validator; free-port scanner; `resolvePort` precedence + new default; bind-status capture; `automation:get-status` / `automation:find-free-port` IPC. (DD1)
- [x] `automation-settings-section` — Settings "Automation" section: enable toggle, live address + copy + bind-status, port field + find-free-port, connect hint; bridge status getter. (DD1, DD5, SC8 toggle)
- [x] `key-management` — per-jar generate/rotate/revoke + env-gated admin-key controls (show-once + copy); new IPC; retire/demote dev seam. (SC9; DD2, DD4, DD5)
- [x] `activity-indicator-and-audit-viewer` — visible active-session indicator (admin vs jar, names jar) + audit-log viewer; `onAutomationActivity` bridge. (SC10 visible half; DD6)
- [x] `behavior-test-specs` — author `settings-automation` (CDP apparatus). (DD3)
- [x] `verify-integration` — run `settings-automation`; complete the `mcp-jar-scoping` full live run; full gates. (DD7)
- [x] `hat-and-alignment` *(optional — included)* — guided HAT of the full control surface. (DD7)

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged (PR stacked on #41 / `flight/04-gating`)
- [ ] Tests passing (unit + headless port/status/key IPC + typecheck + lint)
- [ ] Documentation updated (`docs/mcp-automation.md`: the Settings controls, the configurable port + address display, the connect hint; CLAUDE.md settings/automation note) **and port references reconciled to the new default** (`.mcp.json`, CLAUDE.md automation section, `tests/behavior/mcp-auth-gating.md` + `mcp-jar-scoping.md` — incl. the stale auto-mint-prerequisite note in those specs)
- [ ] Flight debrief written (separate `/flight-debrief` step)

### Verification
- **Unit/headless**: `automationPort` validator (range, non-integer, out-of-range); `freePortInRange` (returns a free loopback port; skips occupied); `resolvePort` precedence (env > setting > default); bind-status capture (bound vs EADDRINUSE vs disabled); the generate/rotate/revoke IPC (origin-checked; revoke deletes the hash; generate returns show-once plaintext + stores the hash).
- **Behavior test (CDP)**: `/behavior-test settings-automation` — enable toggle flips `automationEnabled`; the live address renders + copies; the port field + find-free-port work; bind-status reflects reality; key generate shows-once + copies; the indicator + audit viewer render on a live session.
- **Behavior test (MCP)**: `/behavior-test mcp-jar-scoping` — **full live run** (cross-jar `out-of-jar`, internal `internal-session`, burner unautomatable, admin sees all) now stageable via the jars UI; flips the F4 `partial` run to pass.
- **Static**: `npm run typecheck`, `npm run lint` clean.
- SC9 met (self-service key management, hash model per DD2); SC10 visible half met (indicator + viewer); SC8 toggle UI complete.
