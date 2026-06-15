# Flight Log: Settings key management + automation UI

**Flight**: [Settings key management + automation UI](flight.md)

## Summary
Flight `ready` (drafted + Architect-reviewed + operator-signed-off 2026-06-15). Management UX for the Flight-4 auth core: operator-facing enable toggle, generate/rotate/revoke per-jar keys + env-gated admin key (show-once + copy), the visible "automation active" indicator + audit-log viewer, and — operator-raised — surfacing the live MCP connection address backed by a persisted, configurable port (moved off the collision-prone 7777 into the IANA dynamic range, with a "find a free port" helper + bind-status). SC9 + SC10 visible half + the SC8 toggle UI. Branches off `flight/04-gating` (PR stacks on #41). 7 tentative legs.

Operator decisions (planning interview, 2026-06-15): port = persisted+configurable, default in the dynamic range, "find free port" button (DD1); SC9 = keep the hash model (DD2); UI behavior-test apparatus = existing CDP `:9222` (DD3); include the guided HAT + fold in completing the F4 `mcp-jar-scoping` full live run (DD7).

---

## Design Review Notes

Architect review (2026-06-15): **approve with changes** — all incorporated (single cycle; reviewer's prescribed fixes + FD decisions on the open questions, no new design risk → no second review).
- **[high]** Stale F4 behavior-test specs: `mcp-jar-scoping`/`mcp-auth-gating` frame the auto-mint-to-stdout as a not-yet-built prerequisite (it landed in F4) and hardcode `7777`. → Reconcile before the `mcp-jar-scoping` run (DD7 + prereqs + docs checklist).
- **[med]** `resolvePort` reads only env + port baked at construction → port change is **next-launch** (resolved-to-divert); UI shows active vs pending port; `resolvePort` refactored to `env > setting > default` via injected settings reader (DD1).
- **[med]** Two dev seams: retire only the **`automation:dev-enable-mint` IPC**; **keep the auto-mint-to-stdout** seam — it's the headless behavior-test apparatus (DD5).
- **[low]** Indicator location resolved at design time → chrome toolbar indicator (`chrome-preload.js` listener) **+** settings audit viewer (DD6). `revoke` deletes the hash only, never `sessions.delete` (DD5). `navigator.clipboard` fallback (`clipboard:write` IPC) built in parallel (DD4). Free-port scan sequential/advisory (DD1).
- **Open questions resolved:** `openTab` jar-targeting → defer to Flight 6; indicator location → both surfaces. Default port `49707` (confirm at execution; low-stakes).
- Confirmed sound: DD2 keep-hash, DD3 CDP apparatus, the leg breakdown (7 legs; jar+admin key controls merged into `key-management`), prereqs, the bind-status integration point at `mcpServer.start()`.

---

## Reconnaissance Report
_(Sources Flight-4 debrief action items. Recon folded into the spec: `openTab` jar-targeting = confirmed-live, deferred to Flight 6 per open question; `mcp-jar-scoping` partial run = confirmed, folded into this flight's verify-integration; indicator-lag + SC9-storage = design decisions DD6/DD2.)_

---

## Leg Progress

### port-and-address-backend — `landed` (2026-06-15)
Backend half of the port/address surface. All 7 ACs met; `npm test` (607 pass), `npm run typecheck`, `npm run lint` all green. Uncommitted (batched to Phase 2d).

**What changed:**
- `src/main/settings-store.js` — added `automationPort` (default `49707`) to `DEFAULTS`, grew the `Settings` typedef with `automationPort: number`, and added a range-bound validator (`[1024, 65535]`, integer-only). No normalizer (primitive — `freshDefaults()`' spread copies it).
- `src/main/automation/mcp-server.js` — `DEFAULT_PORT` `7777` → `49707`; refactored `resolvePort(getSettings)` to precedence **env (`> 0`, escape hatch) > persisted setting (range-bound) > default**; added + exported `freePortInRange(lo=49152, hi=65535)` (sequential loopback probe via `net`); `const net = require('net')`; `createMcpServer` now passes its injected `getSettings` to `resolvePort`. No `7777` port literal remains (only a comment reference).
- `src/main/main.js` — added module-scoped `mcpStatus`, captured the start outcome (`bound`/`error`) on the `.then/.catch`, registered origin-checked `automation:get-status` and `automation:find-free-port` via `registerInternalHandler`, imported `resolvePort`/`freePortInRange`, dropped the stale `EADDRINUSE on 7777` comment. The disabled-path port is computed only in the get-status handler (single source — no eager dual-write).
- Tests: `automationPort` validator + repair cases in `test/unit/settings-store.test.js`; new `test/unit/automation-port.test.js` covering `resolvePort` precedence (env-wins, sub-1024 env hatch, setting-when-no-env, default-when-neither, invalid-env-falls-through, out-of-range-setting, throwing-accessor) and `freePortInRange` (in-range, single-occupied → null, skips occupied → next).

**Notes:**
- Typecheck caught that `Number.isInteger(v)` does not narrow `unknown` in TS — added an explicit `typeof v === 'number'` guard to the validator (matches the file's existing typeof-guard convention). Behavior unchanged.
- Host stays hard-pinned to `127.0.0.1` in both the status surface and `freePortInRange` (SC7 — never configurable). No npm dependencies added (`net`/`http` are Node built-ins).
- Live IPC exercise deferred to leg 2 / verify-integration (the bridge does not exist yet).

### automation-settings-section — `landed` (2026-06-15)
Renderer/bridge/UI half of the port/address surface (consumes leg 1's backend). All 8 ACs met; `npm test` (607 pass), `npm run typecheck`, `npm run lint` all green. Uncommitted (batched to Phase 2d).

**What changed:**
- `src/preload/internal-preload.js` — added `automationGetStatus`, `automationFindFreePort`, `clipboardWrite(text)` to the `window.goldfinchInternal` bridge (after the shields methods). `onAutomationActivity`/`offAutomationActivity` deliberately NOT added — that's leg 4.
- `src/main/main.js` — added `clipboard` to the `electron` require; registered origin-checked `clipboard:write` via `registerInternalHandler` (NOT bare `ipcMain.handle`), backed by `clipboard.writeText(String(text ?? ''))`, returns `{ ok: true }`.
- `src/renderer/pages/settings.html` — "Automation" nav link (between Privacy & Shields and On startup) + `<section id="automation">`: enable toggle (`#automation-enabled`, styled as a shield toggle) + `#automation-enabled-note`; steady-state `#automation-status` (plain element, NOT `role="status"`, to avoid double-announce with the transient line); address row (`#automation-address` readonly + `#automation-copy-address`); port row (`#automation-port` `min/max` 1024/65535 + Save + Find free port + `#automation-port-note`); transient `#automation-message` (`role="status"`); one-line connect-hint referencing `docs/mcp-automation.md` (single source of truth — no inlined prose, no hardcoded port). Each non-toggle control row wrapped in `.settings-row`.
- `src/renderer/pages/settings.js` — file-scope `async function copyText(text, messageEl)` (navigator.clipboard primary → `clipboardWrite` IPC fallback → "Copy failed", no throw) added in a shared-helpers block ABOVE the IIFEs so leg 3's key-copy reuses it directly; new automation IIFE controller wiring toggle/address/port/status per AC4–AC7, with module-local `lastStatus` + `recomputePortNote()` and `onSettingsChanged`/`pagehide` cleanup.
- `src/renderer/renderer-globals.d.ts` — extended the `GoldfinchInternalBridge` interface with the three new methods (typecheck required it; the `.d.ts` is the renderer's bridge contract).
- `src/renderer/pages/settings.css` — dedicated shared classes `.settings-row` (flex row), `.settings-text-input` / `.settings-btn` (mirror the home-page input/button tokens — NOT extending the `#home-page-*` ID selectors), `.muted`, `.connect-hint`, plus a narrow `#automation-port` width override.

**Notes:**
- **Toggle-honesty (AC5, resolves design-review [high]):** when `status.enabled === false` the enabled-note reads "Takes effect when Goldfinch is launched with `--automation-dev`." — so an operator who flips it ON and sees "Not running" understands why. The setting still persists for the next dev launch (option (a): keep the toggle, annotate it).
- The shared `copyText` helper + the `clipboard:write` fallback IPC are built here as the first copy consumer (the MCP address); leg 3's key copy reuses both with no duplication.
- The pending-port note gates on `status.bound` (not bare inequality), so a transient disabled-state resolve never shows a misleading "(takes effect on next launch)". Recomputed on port `input`, on save/find-port refresh, and on `onSettingsChanged`.
- Live CDP verification (toggle flips setting, address/port/status render, copy works) deferred to leg 6's `settings-automation` run; no new unit tests this leg (UI-only).

---

### key-management — `landed` (2026-06-15)
Self-service automation-key management in `goldfinch://settings` (SC9): per-jar generate/rotate/revoke + show-once reveal, env-gated admin-key block, net-new revoke functions, and the Flight-4 `automation:dev-enable-mint` dev seam retired. All 9 ACs met; `npm test` (611 pass, +4 new), `npm run typecheck`, `npm run lint` all green. Uncommitted (batched to Phase 2d).

**What changed:**
- `src/main/automation/mcp-server.js` — net-new `revokeJarKey(jarId, settings)` (copy-then-set delete of `automationKeyHashes[jarId]`; `hasOwnProperty` guard → no-op + no throw on a missing id; mirrors `enableAndMintJarKey`'s copy discipline) and `revokeAdminKey(settings)` (sets `automationAdminKeyHash = ''`); both exported. Neither touches the live `sessions` Map — DD5 "effective immediately" rides on per-request re-validation (`resolveIdentity` reads live hashes), so the next request 401s without tearing down the transport.
- `src/main/main.js` — extended the `mcp-server` destructured import with `revokeJarKey`/`revokeAdminKey`; registered FIVE origin-checked handlers via `registerInternalHandler` (next to `clipboard:write`): `automation:list-keys` (joins `jars.list()` with key presence; carries `adminEnabled = !!process.env.GOLDFINCH_AUTOMATION_ADMIN` + `adminKeySet`; never returns hashes/plaintext), `automation:jar-key-mint` (→ `enableAndMintJarKey`, propagates the unknown/burner rejection), `automation:jar-key-revoke`, `automation:admin-key-mint` (→ `mintAdminKey`, `{ key: null }` when the gate is unset), `automation:admin-key-revoke`. REMOVED the `automation:dev-enable-mint` handler and rewrote the now-dangling comment in the adjacent auto-mint block (it no longer references the deleted IPC). `automation:get-status` UNCHANGED (AC2 — env gate reported only via `list-keys`). The `shouldAutoMint` auto-mint-to-stdout block UNCHANGED (still mints `default` + admin to stdout).
- `src/preload/internal-preload.js` — five new bridge methods on `window.goldfinchInternal` (`automationListKeys`, `automationJarKeyMint(jarId)`, `automationJarKeyRevoke(jarId)`, `automationAdminKeyMint`, `automationAdminKeyRevoke`), each a thin `ipcRenderer.invoke` of the matching channel.
- `src/renderer/renderer-globals.d.ts` — five new `GoldfinchInternalBridge` signatures incl. the `list-keys` return type.
- `src/renderer/pages/settings.html` — "Keys" subsection inside `<section id="automation">`: `#automation-jars` container, `#automation-key-reveal` (hidden) with the readonly `#automation-key-value` + copy + "shown once" warning + a `#automation-key-message` status line, and the env-gated `#automation-admin` block (status line + generate/rotate + revoke). Connect-hint reworded "generate a key under Jars" → "under Keys below".
- `src/renderer/pages/settings.js` — new key-management IIFE (separate from the leg-2 automation IIFE; both guard on the bridge). Jar rows built with `createElement` + `textContent` (NOT innerHTML — jar names are user-controlled). Reuses the file-scope `copyText`.
- `src/renderer/pages/settings.css` — `.jar-row` / `.jar-name` / `.jar-swatch` (12×12 chip) and `#automation-key-reveal` / `#automation-admin` spacing, all on existing dark-theme tokens.
- `test/unit/automation-mcp-server.test.js` — imported `revokeJarKey`/`revokeAdminKey`; 4 new tests using the existing `memSettings()` stub + `validateKey`: revokeJarKey deletes only the target hash; absent-id no-op; revokeAdminKey clears to `''`; and the re-validation proof (token → jarId before revoke, → `null` after — proves 401-on-next-request at the validation layer).

**Notes:**
- **Unified mint channels (deliberate simplification — reviewer please confirm faithful to DD5):** DD5 lists six channels (generate|rotate|revoke × jar|admin), but generate and rotate are byte-identical (`enableAndMintJarKey` / `mintAdminKey` mint a fresh key and overwrite the hash). This leg implements ONE mint + ONE revoke channel per surface (4 total, + `list-keys`); the UI labels the button "Generate" vs "Rotate" by `hasKey`/`adminKeySet`. Preserves DD5's lifecycle while avoiding duplicate handler pairs.
- **`dev-enable-mint` retirement (DD5):** re-greped `src test tests docs .mcp.json` before deleting → zero references; handler removed and the dangling comment fixed. The OTHER dev seam — `shouldAutoMint` auto-mint-to-stdout — is the headless behavior-test apparatus and was left untouched.
- **Show-once reveal ordering (AC8, resolves design-review [high]):** `refresh()`/`renderJars`/`renderAdmin` NEVER touch `#automation-key-reveal`; `clearReveal()` runs at the START of each mint/revoke action (and on init); `reveal(key)` is the LAST write on a mint resolve — sequenced via `refresh().then(() => reveal(key))` (refresh returns its promise) so the post-mint list rebuild cannot wipe the just-shown key. Plaintext lives only in the readonly field, never persisted/logged (it leaves main only via the mint IPC return).
- **Revoke is `sessions`-free (DD5):** revoke deletes the hash only; the next MCP request 401s via live re-validation. Proven at the validation layer in AC9; live generate→copy→revoke→401 deferred to leg 6 (`settings-automation` CDP + `mcp-jar-scoping` MCP).
- `automationEnabled` flips true as a side effect of the first jar mint (`enableAndMintJarKey`); the leg-2 toggle reflects it on the next load — intended (minting a key implies enabling).

### activity-indicator-and-audit-viewer — `landed` (2026-06-15)
Visible half of SC10/DD6: the always-visible chrome toolbar indicator + the settings-page audit viewer, both consuming the Flight-4 `automation-activity-changed` broadcast + `mcpServer.getActivity()`. All 8 ACs met; `npm run typecheck`, `npm run lint`, `npm test` (611 pass) all green. No new unit tests (UI; live verification is leg 6). Uncommitted (batched to Phase 2d).

**What changed:**
- `src/main/main.js` — added a **bare** `ipcMain.handle('automation:get-activity', () => mcpServer ? mcpServer.getActivity() : { sessions: [], log: [] })` with a code comment mirroring the `settings-get`/`shields-get` bare-rationale: it is intentionally NOT `registerInternalHandler` because BOTH the file:// chrome indicator AND the goldfinch://settings viewer read it — the chrome's file:// origin fails the internal-origin check, so wrapping it would silently break the indicator. Documented so nobody "fixes" it. Safe: payload is non-secret operator-facing audit state (no key/hash), reachable only via the chrome/internal preloads. The sibling `automation:*` handlers stay origin-checked.
- `src/preload/chrome-preload.js` — added `automationGetActivity` (invoke) + `onAutomationActivity` (raw `ipcRenderer.on`, matching `onShieldsChanged`) to `window.goldfinch`.
- `src/preload/internal-preload.js` — added `automationGetActivity` (invoke) + `onAutomationActivity`/`offAutomationActivity` via the existing on/off handle registry (matching `onSettingsChanged`/`offSettingsChanged`).
- `src/renderer/renderer-globals.d.ts` — declared `AutomationSession`/`AutomationLogEntry`/`AutomationActivity` shapes; extended both the chrome `GoldfinchBridge` and `GoldfinchInternalBridge` interfaces.
- `src/renderer/index.html` — added `#automation-indicator` (`.icon-btn.hidden`, a bot/robot inline SVG `.tb-glyph` + `#automation-indicator-badge` `.tb-badge`) between `#toggle-privacy` and `#kebab`. Not pinnable.
- `src/renderer/renderer.js` — added `automationIndicator`/`automationIndicatorBadge` to `els`; `jarDisplayName(jarId)` (maps through `containers`, raw-jarId fallback); `updateAutomationIndicator(snap)` (hides + clears badge + drops `.admin` when 0 sessions; else shows count badge, "N automation session(s) connected: …" title/aria-label naming each identity, `.admin` class when any session `kind === 'admin'`); initial `automationGetActivity()` + `onAutomationActivity` subscribe. Caches `lastSnap` and re-runs after `jarsList()` resolves (containers race). `applyToolbarPins` left untouched — documented that it must NOT touch the indicator (self-manages `.hidden` via session count).
- `src/renderer/styles.css` — `#automation-indicator` mirrors `#toggle-privacy` (relative, 36px, flex-centered); connected (jar-only) state uses `--accent` (gold), `.admin` state a **non-alarm** violet `#a371f7` (NOT danger-red).
- `src/renderer/pages/settings.html` — Activity viewer (`<h3>Activity</h3>` + connected-semantics note + `#automation-active-sessions` + `<h4>Recent actions</h4>` + `#automation-activity-log`) placed AFTER `#automation-admin` (order Keys → Admin → Activity).
- `src/renderer/pages/settings.js` — new activity-viewer IIFE: seeds a jarId→name map from `automationListKeys()` (raw-id fallback), initial `automationGetActivity()` + live `onAutomationActivity`, `offAutomationActivity` on pagehide. Active sessions render kind (admin/jar) + named identity + "connected since {time}", admin rows distinct; action log newest-first (contract is newest-last → reversed copy), capped to 50, each "{time} {op} {identity} {outcome}" with error rows distinct + errorCode; empty states ("No automation sessions" / "No recent activity"). All audit-derived strings via createElement + textContent.
- `src/renderer/pages/settings.css` — `.activity-session`/`.activity-kind`/`.activity-name`/`.activity-since` + `.activity-log-row`/columns + `.activity-empty`, on existing dark-theme tokens; admin chip + error outcome distinct colors.

**Notes:**
- **Bare get-activity handler is the deliberate exception (AC1):** the only non-origin-checked `automation:*` IPC, because the chrome reads it too. Checked the test/lint surface for any rule asserting ALL `automation:*` channels are origin-checked — none exists. `test/unit/internal-ipc.test.js` only exercises `registerInternalHandler`'s own `test-channel`; the `automation: internal-session` strings across the unit/behavior suites are MCP wcId-resolution refusals (`resolve.js`), unrelated to IPC channel guarding. Nothing to reconcile.
- **Containers race (AC5):** the activity snapshot can arrive before `jarsList()`/`automationListKeys()` resolve, so a jar session would transiently show the raw jarId. Both surfaces cache the last snapshot and re-render once names load (renderer re-runs `updateAutomationIndicator(lastSnap)` in the `jarsList().then`; the viewer re-runs `renderActivity(lastSnap)` after `automationListKeys()`). Admin sessions are unaffected (labeled "admin").
- **Admin non-alarm color:** violet `#a371f7` (indicator + viewer chip), deliberately NOT danger-red — admin is "more privileged", not "broken". Flagged as a HAT/leg-7 polish point.
- **"Connected" wording (DD6):** indicator + viewer phrase sessions as "connected" (transport lifecycle), never "authorized" — a revoked-but-still-connected session correctly lingers until its transport closes.
- Live behavior (indicator lights on a real attached session, viewer lists it, admin vs jar) deferred to leg 6 (`settings-automation` CDP + `mcp-jar-scoping` MCP).

---

### behavior-test-specs — `landed` (2026-06-15)
FD-authored the `settings-automation` behavior-test spec (`tests/behavior/settings-automation.md`, status `draft`, Last Run `never`) — the CDP-`:9222` UI acceptance test for legs 2–4 (toggle, address/port/bind-status, per-jar + admin key show-once, indicator + audit viewer). Design-reviewed by a Developer for **selector accuracy** against the implemented `settings.html`/`settings.js`/`index.html`/`renderer.js`. Reused `mcp-jar-scoping` as-is (its 7777/auto-mint reconciliation is a leg-6 task per DD7). No code; the sole deliverable is the spec. Uncommitted (batched to Phase 2d).

**Review corrections folded into the spec (would have caused false-fails):**
- Jar key control is a SINGLE mint button relabeling **Generate key** ↔ **Rotate key** (not separate buttons); **Revoke** is `disabled` until a key exists.
- Verbatim status strings: `Connected — listening on 127.0.0.1:{port}` / `Not running — start Goldfinch with --automation-dev to bind the surface` / `Failed to bind: <error>`; enabled-note `Takes effect when Goldfinch is launched with --automation-dev.`; admin status `Admin key set` / `No admin key` (capitalized); empty states `No automation sessions` / `No recent activity`.
- Indicator observable is `title`/`aria-label` = `<n> automation session(s) connected: <names>` + the `.admin` class (not a separate visible jar element).
- Launch seams the live-session steps depend on all confirmed present (`--automation-dev`, `GOLDFINCH_AUTOMATION_DEV_MINT=1`, `GOLDFINCH_MCP_PORT`, `GOLDFINCH_AUTOMATION_ADMIN`).

---

## Flight Director Notes

### 2026-06-15 — Flight start (orchestration)
- Loaded `/agentic-workflow`; phase file `leg-execution.md` validated (Crew / Interaction Protocol / Prompts present). Crew: Developer (Sonnet), Reviewer (Sonnet, never Opus).
- Branch base verified: was on `flight/04-gating` (HEAD `17aeabf`, F4 completed). Created `flight/05-settings-key-management` off it per the spec's stack cascade (#40→#41→this).
- Working-tree state at branch creation: `.mcp.json` already had the stale `goldfinch` `:7777` http MCP entry removed (a partial start on the DD1/prereq 7777 reconciliation — will be folded into `key-management`/`verify-integration`, not committed loose). Two untracked PNGs (`src/renderer/assets/gf_01*.png`) are unrelated to this flight — held out of flight commits, flagged to operator.
- Flight status `ready` → `in-flight`.
- Batched-commit model (per skill): autonomous code legs 1–5 implemented uncommitted → single flight review + commit (Phase 2d) + draft PR → then `verify-integration` (FD-run behavior tests) → guided HAT.

### 2026-06-15 — Phase 2d: batched flight review + commit
- Spawned an independent Reviewer (Sonnet) over ALL uncommitted changes for legs 1–5. Verdict: **[HANDOFF:confirmed]** — every leg's ACs met; `npm test` 611/611, `npm run typecheck` + `npm run lint` clean; security invariants confirmed (origin-checked IPC except the deliberately-bare `automation:get-activity`; SC7 loopback-only; show-once key lifecycle; revoke-without-session-teardown; XSS via textContent; resolvePort range asymmetry; dev-enable-mint retired / auto-mint-to-stdout intact). Only non-blocking observations (a redundant `automationListKeys` call in the activity viewer; a harmless `7777` comment) — no fix loop needed.
- Committed legs 1–5 (code + tests + the `settings-automation` spec + flight artifacts), legs 1–5 marked `completed` + checked off in flight.md.
- **Deliberately EXCLUDED from this commit**: `.mcp.json` (the stale `:7777` goldfinch entry removal — folded into leg 6's full 7777 reconciliation across `.mcp.json`/CLAUDE.md/F4 specs) and the two unrelated untracked PNGs (`src/renderer/assets/gf_01*.png`).
- Draft PR opened, stacked on `flight/04-gating` (#41); legs 6 (verify-integration) + 7 (HAT) still open → PR stays draft until the flight lands (Phase 3).

---

### verify-integration (leg 6) — reconciliation done; live runs pending (2026-06-15)
**Part 1 — 7777 + stale-prereq reconciliation (DONE, committed):** a Developer reconciled the scoped docs/specs to the new default `49707`:
- `docs/mcp-automation.md` (default URL / port-override / `/mcp` example / `.mcp.json` snippet → 49707; **added a "Settings controls" section** documenting the Flight-5 toggle / configurable port / live address + bind-status / connect hint; documented why no standing `.mcp.json` goldfinch entry ships — off-by-default → a standing entry would perpetually fail to connect).
- `CLAUDE.md` (automation default port → 49707), `README.md` (→ 49707), `scripts/mcp-example-client.mjs` (`|| 49707`).
- `tests/behavior/mcp-auth-gating.md` + `mcp-jar-scoping.md`: corrected the **stale** "auto-mint apparatus does NOT exist yet / to be built in verify-integration" notes → "landed in F4" (`shouldAutoMint` gating `--automation-dev` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`); reconciled hardcoded `127.0.0.1:7777` → `127.0.0.1:$GOLDFINCH_MCP_PORT` (pinned for runs; new default 49707). Step semantics unchanged.
- `.mcp.json`: the stale goldfinch `:7777` entry removal committed (kept removed; rationale documented).
- **Left out of scope** (recorded, not silently skipped): the origin-guard unit-test 7777 fixtures (port-agnostic loopback samples), origin-guard.js illustrative comments, and the six other F1–F3 behavior specs still referencing 7777 — deferred to **Flight 6** (spec migration, which moves them all onto the new surface).
- Static gates after reconciliation: `npm test` 611/611, `npm run typecheck`, `npm run lint` — all green.

**Part 2 — live behavior-test runs (PENDING operator + GUI):** `settings-automation` (CDP `:9222`) and the `mcp-jar-scoping` full live run require the GUI/CDP apparatus and operator tab-staging across jars (`personal`/`work` + a burner + the settings tab) — inherently interactive. Held for the operator; the flight stays `in-flight` and PR #42 stays draft until these + the leg-7 HAT complete.

---

## Decisions
_Runtime decisions not in the original plan will be recorded here._

---

## Deviations
_Departures from the planned approach will be recorded here._

---

## Anomalies

### Enable-toggle does not live-update when a key mint flips `automationEnabled` (minor UX lag)
**Observed**: `enableAndMintJarKey` flips `automationEnabled = true` as a side effect via a direct `settings.set(...)` in the main process, which does NOT fan out a `settings-changed` broadcast (only the `internal-settings-set` IPC path does). So after generating the first jar key, the persisted setting is `true` but the `#automation-enabled` checkbox in the open settings page only re-syncs on the next settings load.
**Severity**: cosmetic. The stored value is correct and the surface behaves correctly; only the live checkbox lags.
**Resolution**: surfaced during the leg-5 spec review (2026-06-15). The `settings-automation` spec asserts the *stored* `automationEnabled` (read-back), not the live checkbox. Candidate polish for the leg-7 HAT (have the key-management controller re-sync the toggle on `refresh()`, or broadcast on the side-effect write) — not a blocker for the flight's SCs.

---

## Session Notes
_Chronological notes from work sessions will be recorded here._
