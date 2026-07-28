# Flight Log: Main-Process Wiring — Fullscreen, Auth Challenges, Inline PDF

**Flight**: [Main-Process Wiring](flight.md)

## Summary

All four legs landed and flight-wide review confirmed (`[HANDOFF:confirmed]`, independent Reviewer, gates re-run: 2993/2993 tests, lint, typecheck). Docs pass completed (README, CLAUDE.md invariant pins + seam-count lockstep, docs/mcp-automation.md, docs/vault.md). Deferred to admin-keyed session / HAT: the four web-compat behavior runs + vault-login re-run (apparatus gap, see Decisions/Anomalies). Committed as a single batched commit; draft PR opened.

---

## Reconnaissance Report

Source artifact: GitHub issue #132 (web-compat audit, filed against v0.11.3) plus mission-planning scope additions. Verified against `main` at v0.11.6.

| Item | Classification | Evidence | Recommendation |
|------|---------------|----------|----------------|
| #132-1 video fullscreen unhandled | confirmed-live | `grep -rn "enter-html-full-screen\|setFullScreen" src/` → only `'fullscreen'` in `session-runtime.js:14` (permission allowlist, not wiring) | Leg `html-fullscreen` |
| #132-2 popup deny breaks `window.opener` | confirmed-live | `guest-wiring.js:75-80` denies; catch-all deny `app-lifecycle.js:101` | **Flight 2 scope** (design ruling gated), not this flight |
| #132-3 basic auth silently cancelled | confirmed-live | No `app.on('login')` — only 6 `app.on` registrations, all enumerated in `app-lifecycle.js:75-272` | Leg `auth-challenges` |
| #132-3b client certs unreachable (scope addition) | confirmed-live | No `select-client-certificate` anywhere in `src/` | Leg `auth-challenges` |
| #132-4 no PDF viewer | confirmed-live | No `plugins:` key in `src/`; guest webPreferences `register-tab-ipc.js:88-108` | Leg `pdf-inline` |
| #132-4 gate "after #131 sandbox work" | already-satisfied | `sandbox: true` at `register-tab-ipc.js:93,103` on `main`; #131 closed | Prerequisite retired |
| Architect finding: nav guard blocks PDF viewer frame | confirmed-live | `guardNav` `guest-wiring.js:89-98` + `isSafeTabUrl` allows only http/https/about:blank | Folded into DD5 with security assessment |
| M13 debrief: latch-ordering regression test missing | confirmed-live | `mission-debrief.md:83`; guard is comment-only at `guest-wiring.js:66-73` | Carry-forward into `html-fullscreen` leg |
| M13 debrief: fixture 302 endpoint + extended tab-scheme-guard | confirmed-live | `tab-scheme-guard.md:98` steps authored, unrunnable | 302 endpoint into DD6 fixture; spec re-run = post-flight optional |
| M13 debrief: vault fill/capture re-run under sandbox | confirmed-live | `mission-debrief.md:84` — "before/early in the next vault-touching mission" | Verification step in `auth-challenges` leg |
| M13 debrief note: mission-13 on unmerged PR chain | already-satisfied (stale note) | v0.11.6 on `main` contains the work; #131 closed | None |

Autonomous-mode note: user pre-authorized autonomous execution through Flight 2 pre-flight; recon classifications applied without interactive confirmation per that authorization. All retirements are evidence-cited above for audit.

---

## Leg Progress

### Leg 01 `html-fullscreen` — landed (2026-07-27)

**Status**: implementation complete; unit gates green (`npm test` 2869 pass, lint, typecheck); behavior run `/behavior-test web-compat-fullscreen` pending (FD-run). Spec flipped `draft` → `active`. Not committed (batched at flight end).

**Changes made** (all per DD1 / leg design):

- `src/main/html-fullscreen.js` — NEW Electron-free DI module (`createHtmlFullscreen({ registry, chromeForTab, logger })`): `enter`/`exit`/`isFullscreen` (wcId-shaped) + `forceExit`/`handleRendererBounds`/`handleWindowResize` (record-shaped). Single `restore()` path for every exit edge; mode cleared FIRST for leave-event idempotence; `pendingBounds || savedBounds` on exit; find session survives (hide on enter, `syncBounds` + `show` on exit); `trigger-send-bounds` convergence send; background-tab enter refused with a page-side exit ask; destroyed-contents restore is record-cleanup-only; `forceExit` synchronous by contract.
- `src/main/guest-wiring.js` — `enter/leave-html-full-screen` wired on the web branch only (after the internal early-return); defensive Esc branch placed before the modifier early-return (page-side `document.exitFullscreen()` ask, no `preventDefault`, auto-repeat-guarded); `htmlFullscreen` dep added. Latch untouched (first statement, now test-pinned).
- `src/main/register-tab-ipc.js` — `tab-set-bounds` gate (defer + skip overlay fan-out via early return); `tab-set-active` different-tab force-exit before the swap + same-tab geometry no-op (`fullscreenSameTab`: bounds deferred, find-restore and sheet-sync skipped); `tab-hide` force-exit before the overlay block; `tab-close` explicit idempotent cleanup after the `wasActive` block; `moveTabIntoWindow` unconditional `forceExit(source)` after the find-session close and **before** the H3 geometry capture (synchronous, synchrony pin respected); `htmlFullscreen` dep added.
- `src/main/window-factory.js` — `handleWindowResize(record)` on `resize`, `maximize`, and `unmaximize` (each before that event's `trigger-send-bounds`); `htmlFullscreen` dep added.
- `src/main/window-registry.js` — `htmlFullscreen: null` seeded at `create()` + `WindowRecord` typedef entry.
- `src/main/main.js` — `createHtmlFullscreen` constructed before the window factory; threaded into `createWindowFactory`, `createGuestWiring`, `registerTabIpc`.
- `src/main/session-runtime.js` — carry-forward 2: `ALLOWED_PERMISSIONS` comment now names the pinning test verbatim ('permission allowlist denies invented/future permissions and grants allowlisted members', `test/unit/session-runtime.test.js`).
- Tests: NEW `test/unit/html-fullscreen.test.js` (14 tests: enter snapshot/expand/raise, background-tab refusal, double-enter idempotence, exit saved-vs-pending + find restore + convergence + idempotence, gate defer scope, resize re-expand, forceExit live/destroyed/entry-gone, cross-holder enter, isFullscreen membership); NEW `test/unit/latch-ordering-invariant.test.js` (carry-forward 1, source-scan toolkit, two vacuity guards); `register-tab-ipc.test.js` +7 fullscreen call-point tests (incl. move force-exit-before-capture order via restored-rect assertion); `guest-wiring.test.js` +2 (web-only event wiring, defensive Esc contract); `window-factory.test.js` resize/maximize/unmaximize hook assertions; `window-registry.test.js` seed assert; harness `window-factory-harness.js` gained the `htmlFullscreen` dep.
- Fixtures: NEW `tests/behavior/fixtures/web-compat/serve.mjs` (`/video.html` with `<video>`, Enter-fullscreen button, `#fs-state` observability seam; `/media.wav` in-memory WAV with Range support; `--log` optional JSONL) + `README.md` noting later-leg extensions (401, PDF, 302; TLS sibling). Smoke-tested live (200/200/206/404).
- `tests/behavior/web-compat-fullscreen.md` — status `draft` → `active`.

**Notes**:

- Exit-edge inventory implemented + unit-pinned: different-tab activation, tab-hide, tab-close (cleanup-only), cross-window move (before capture), Esc (defensive, page-side), page exit. Window close needs no code — the record dies with the window (leg guidance step 7); the destroyed-contents/entry-gone forceExit unit tests pin that leaving fullscreen has no observable work beyond record death there.
- Accepted transient (documented, no code, per leg guidance step 6): `tab-create` during fullscreen `addChildView`s the new guest above the fullscreen view until an activation force-exits — momentary z-fight resolved by the activation edge.
- `moveTabIntoWindow` force-exit is **unconditional** on which tab holds the mode (guidance says "the source record's mode is cleared"): moving a background tab out from under a fullscreen tab also clears/restores rather than stranding the mode. `forceExit` is a no-op when unarmed.
- Fixture `--log` made optional (the spec's precondition invokes `serve.mjs --port {P}` with no log; JSONL format kept byte-compatible with the cross-jar-fetch precedent for the auth leg's read seam).

**Deviations**: none — implementation follows the design-reviewed guidance; no citation drift found (all leg citations verified against the working tree before editing).

**Anomalies**: none.

### Leg 02 `auth-challenges` — landed (2026-07-27)

**Status**: implementation complete; unit gates green (`npm test` 2937 pass — +68 over leg 01's 2869 — lint, typecheck); a11y sheet-sweep apparatus-blocked (pre-existing, see Anomalies); behavior run `/behavior-test web-compat-basic-auth` pending (FD-run, same deferred disposition as leg 01). Spec flipped `draft` → `active`. Not committed (batched at flight end).

**Changes made** (all per DD2/DD3 / leg design):

- `src/main/auth-challenges.js` — NEW Electron-free DI store (`createAuthChallenges({ registry, chromeForTab, logger })`): per-window FIFO queues keyed by WindowRecord (no token map — the leg's keying ruling), exactly-once ledger with a SINGLE callback choke point (`resolveOnce`; handleLogin's guard cancels mint a challenge shell and route through it — source-scan pinned), DD2 bucket mapping (resolution = escape/outside-click/activated/tab-close/teardown + **fail-safe unknown-reason default**; occlusion = blur/superseded/tab-hide/tab-switch), presentation eligibility (active tab + no presented + `!record.htmlFullscreen` + `!sheet.isMenuOpen()` — the dismiss-locked one-time-key hold case pinned), re-present triggers (tab activation / window refocus / fullscreen exit / queue events), silent cancels (proxy / contents-less / internal marker / non-guest), `cancelForTab` (navigated/tab-close/moved; closes a visible auth sheet with a resolution-family reason), `cancelForWindow` (whole queue, not just the head), `answerFromSheet`/`answerWithCredential` (ledger FIRST, then the single `'activated'` close site — 8b), `getPendingChallenge` (non-secret read seam).
- `src/main/app-lifecycle.js` — `app.on('login')` at TOP-LEVEL scope beside `web-contents-created`; unconditional `preventDefault()`; routes to the store; `authChallenges` dep.
- `src/main/menu-overlay-manager.js` — optional `onClosed({menuType, reason})` observer on BOTH emit paths: `closeMenuOverlay` (after the channel-7 emit, `currentMenu` already null) AND `openMenu`'s model-replace `'superseded'` branch (which never calls closeMenuOverlay — the stall case the leg named).
- `src/main/html-fullscreen.js` — optional `onExited(record)` at the tail of `restore()` (every exit edge); wired to `notifyFullscreenExited`.
- `src/main/window-factory.js` — `onClosed` threading at the manager construction site (closes over `record`); `win.on('focus')` → `notifyWindowFocused`; `cancelForWindow(record)` FIRST in the `close` teardown (before the sheet's `'teardown'` close — the head-only-resolve gap the leg flagged as load-bearing).
- `src/main/guest-wiring.js` — `did-start-navigation` (main-frame, non-same-document only) → `cancelForTab(wcId, 'navigated')`.
- `src/main/register-tab-ipc.js` — `tab-close` → cancelForTab; `moveTabIntoWindow` → cancelForTab at move time (after the refusal guards, before re-parent; synchrony pin untouched); `tab-set-active` → `notifyTabActivated` after the `activeTabWcId` write.
- `src/main/register-overlay-ipc.js` — `menu-overlay:auth-submit` handler cloning the vault-unlock discipline byte for byte (sender identity via `recordForSheetSender`, open-token gate, `Buffer.from` copy, dual-zeroize in `finally`; payload `{token, username, secret: Uint8Array}`); the handler never closes the sheet (single close site = the store); registration gated on the `authAnswerFromSheet` injection.
- `src/shared/auth-basic-template.js` — NEW modal-card template (role=dialog aria-modal, host/realm context line via textContent only, labeled username + password inputs, aria-live error, Sign in/Cancel, shared vault-sheet header). `src/renderer/menu-overlay.js` — auth-basic section (submit → dedicated `menuOverlay.authSubmit` invoke, stale-token guard, busy guard, dual zeroize of the sheet-side copy; Cancel rides channel-4 `activated` id `'cancel'` per the leg contract; Escape/backdrop via `attachModalCard`), TEMPLATES/NODE_OF_ENTRY/object-model-shape/dispatch entries. `menu-overlay.css` — `#sheet-auth-basic` + `.auth-basic-origin`.
- `src/preload/menu-overlay-preload.js` (`authSubmit`), `src/preload/chrome-preload.js` (`onAuthChallengePresent`), `renderer-globals.d.ts` + `menu-overlay-globals.d.ts` entries (typecheck gate).
- `src/renderer/renderer.js` — `auth-basic` overlay state entry (no trigger element → no aria target/refocus), `onAuthChallengePresent` → standard `openOverlayMenu('auth-basic', {host, realm})` open, channel-6 validated-no-op branch, `openAuthBasicOverlayForAudit` seam hook (leg-authorized 30th entry).
- `src/main/vault/vault-context.js` — `answerAuth` mirroring `fill`: touch/revalidate → locked → `resolveTarget` (jar membership; out-of-jar throw passthrough) → injected `getPendingChallenge` → `resolveItem(type === 'login')` (ambiguous refuses) → `originMatches` against **`originOf(challenge.url)`** (never authInfo.scheme) → injected `answerAuthDelegate`; credential never in the return.
- `src/main/automation/mcp-tools.js` — `vaultAnswerAuth` ToolDef (`usesEngine:false`, schema `{wcId, itemId, vaultId?}`); tool table 34 → 35. `scope.js` — `WCID_FIRST_CUSTOM_JAR_OPS = ['vaultFill', 'vaultAnswerAuth']`. `mcp-server.js` — `answerAuthDelegate`/`getPendingChallenge` opts threaded into `createVaultContext`, `boundVault.answerAuth`, `deriveAuditDetail` case (item id + resolved origin from the result — never a credential).
- `src/main/main.js` — store constructed before `htmlFullscreen` (its `onExited` closes over it); threaded into window-factory, guest-wiring, register-tab-ipc, register-overlay-ipc, app-lifecycle, and `createMcpServer`.
- `scripts/a11y-audit.mjs` — `sheet:auth-basic` SHEET_STATES entry + `sheet-auth-basic` dismissal node id.
- Fixture `tests/behavior/fixtures/web-compat/serve.mjs` — `/protected` (401 `WWW-Authenticate: Basic realm="fixture"`; validates `fixtureuser`/`fixturepass`; 200 echoes the USERNAME only; `Cache-Control: no-store`; JSONL logs `authPresent`/`authValid`/`authMatched` — never the header value). Curl-verified live (401 / 200+echo / 401 wrong / 401 malformed; log correct). `tests/behavior/web-compat-basic-auth.md` — `draft` → `active`.
- Tests: NEW `auth-challenges.test.js` (33: full bucket/FIFO/hold/re-present/fullscreen-interplay/answer/cancel matrix + the `challenge.callback`-single-site source-scan pin), NEW `auth-submit-handler.test.js` (7: zeroize/sender/token/shape/no-close discipline), NEW `auth-basic-template.test.js` (2: dialog + labeled-fields structural a11y pin), `vault-context.test.js` +9 (answerAuth matrix incl. out-of-jar passthrough, ambiguous-with-vaultId disambiguation, `deriveAuditDetail`), `menu-overlay-manager.test.js` +4 (onClosed both paths, no-op cases), `html-fullscreen.test.js` +2 (onExited every edge, no-op), `guest-wiring.test.js` +1 (main-frame/non-same-document filter), `register-tab-ipc.test.js` +4 (call points incl. refused-move-cancels-nothing), `window-factory.test.js` +4 (focus/close-ordering/onClosed threading/absent-dep tolerance), `app-lifecycle.test.js` +2 (top-level registration + preventDefault routing), tool-count pins updated (mcp-tools 35, mcp-server `EXPECTED_TOOL_COUNT` 35), `seam-contract.test.js` pin bumps (below).

**Pin bumps (planned, deliberate — flight Technical Approach):**

- `SEAM_COUNT` 29 → 30: +`openAuthBasicOverlayForAudit`, the `sheet:auth-basic` a11y driver (leg-authorized seam addition, vault-sheet precedent).
- `RENDERER_LINE_BUDGET` 1701 → 1735: +34 lines for the auth-basic chrome wiring (overlay state entry, present listener, channel-6 no-op branch, audit hook) — the minimum per-sheet chrome footprint; renderer.js extraction remains banked debt.
- Tool-count pins 34 → 35 (`automation-mcp-tools.test.js`, `automation-mcp-server.test.js`): +`vaultAnswerAuth` — same planned class as the seam bumps (the DD3 tool is a leg deliverable).

**Live smoke (dev:automation, admin MCP)**: navigating a tab to the fixture `/protected` presented exactly one sheet (`enumerateWindows` → `sheetVisible: true`); the guest DOM stayed a held empty document (no protected content, no password, NO injected input fields — the prompt is chrome-owned); a chrome-driven escape-family close resolved the challenge (`sheetVisible: false`, no re-present) and the 401 body then rendered; the fixture log shows exactly one request with `authPresent: false`. AC1/AC2-partial/AC3 witnessed live; full credential-path + agent-path live verification remains the FD behavior run.

**Deviations**: none from the design-reviewed guidance. (`cancelForTab` closes a visible sheet with `'navigation'`/`'tab-close'` — both resolution-family per the fail-safe default; the exact strings were in-leg latitude.)

### Leg 03 `client-cert` — landed (2026-07-27)

**Status**: implementation complete; unit gates green (`npm test` 2984 pass — +47 over leg 02's 2937 — lint, typecheck); a11y chrome-mode states verified clean (see Notes; sheet sweep still apparatus-blocked, pre-existing); behavior run `/behavior-test web-compat-client-cert` pending (FD-run, same deferred disposition as legs 01–02). Spec flipped `draft` → `active`. Not committed (batched at flight end).

**Changes made** (all per DD4/DD6 / leg design, incl. both design-review passes):

- `src/main/auth-challenges.js` — challenge `kind` (`'basic-auth' | 'client-cert'`) on the SHARED store (no second store): `handleSelectClientCertificate` (handleLogin's routing ladder — contents-less/internal/non-guest silent cancels — plus the defensive-unreachable empty-list cancel; record carries `certSummaries` display strings for the sheet and the raw Certificate `list` main-side only); `resolveOnce` gained the kind-aware resolution union (basic: `String()`-coerced (user, pass); cert: `callback(cert)`; null: cancel for both) — the single-callback-site source-scan pin holds; `presentNext` dispatches by kind (`auth-challenge-present` vs the new `cert-challenge-present`); shared `AUTH_MENU_TYPES` set (`auth-basic`/`cert-picker`) now drives BOTH the `notifySheetClosed` filter AND `cancelForTab`'s visible-sheet close (the stale-cert-picker-on-navigation hazard the leg named); agent seams (`getPendingChallenge`, `answerWithCredential`) kind-filter via `pendingBasicAuthFor` (cert selection is human-only; a string credential can never reach a Certificate callback); `answerFromSheet` gained the same kind guard; new `selectCertFromSheet(record, index)` resolves `callback(list[index])` LEDGER-FIRST, bounds-checked (out-of-range/tampered → cancel).
- `src/main/app-lifecycle.js` — `app.on('select-client-certificate')` at TOP-LEVEL scope beside `app.on('login')` (DD4 as design-review corrected: an APP-level event); unconditional `preventDefault()`; routes to the store.
- `src/main/register-overlay-ipc.js` — `certSelectFromSheet` injected dep (authAnswerFromSheet gating precedent); in the `menu-overlay:activated` handler, `cert-picker` activations route to the store **BEFORE** the `closeMenuOverlay('activated', token)` call — the review-critical ordering (that close maps 'activated' to resolution-cancel; ledger-first or every selection cancels). Local `CERT_PICK_PREFIX`/`parseCertPickIndex` mirror (ESM template not required from the CJS registrar; cross-pinned by unit test). Non-index ids (`cancel` row, foreign) fall through to the close's resolution-cancel.
- `src/main/main.js` — `certSelectFromSheet` threaded into `registerOverlayIpc`.
- `src/shared/cert-picker-template.js` — NEW pure ESM template on the vault-picker DOM/roving-list shape ONLY (deliberate routing deviation documented in the header): backdrop + header + `role="menu"` roving list; rows = subject over dimmed issuer (textContent only, display strings only — never certificate objects); `data-cert-index` → `cert:<i>` ids; separated keyboard-reachable "Continue without a certificate" cancel row (id `'cancel'`); defensive empty-model note.
- `src/renderer/menu-overlay.js` — cert-picker section (register/render/selection wiring, backdrop + header-close dismiss), TEMPLATES typedef union + entry, NODE_OF_ENTRY. `menu-overlay.css` — `#sheet-cert-picker` joins the vault-picker backdrop selector (row/cancel chrome reused wholesale via the `.vault-picker-*` classes).
- `src/preload/chrome-preload.js` (`onCertChallengePresent`), `renderer-globals.d.ts` entry.
- `src/renderer/renderer.js` — `cert-picker` overlay state entry (no trigger → no aria target/refocus), `onCertChallengePresent` → standard `openOverlayMenu('cert-picker', certs, …)` open, channel-6 validated-no-op branch, `openCertPickerOverlayForAudit` seam hook (leg-authorized 31st entry).
- `scripts/insecure-tls-flag.mjs` — NEW pure decision helper (`decideOzonePlatform` shape): `--insecure-tls-fixtures` → strip flag from forwarded argv + unlock `--ignore-certificate-errors`; no flag → untouched argv, no switch. `scripts/dev-launch.mjs` routes argv through it (composes args exclusively from helper output — source-pinned).
- Fixtures (`tests/behavior/fixtures/web-compat/`): NEW `gen-certs.mjs` (openssl-shelling throwaway CA → server cert CN=127.0.0.1 + SAN IP → client cert EKU clientAuth + `client.p12`; 7-day validity; clear ENOENT failure; outputs in `certs/`, **gitignored** — `.gitignore` edited); NEW `serve-tls.mjs` (`requestCert: true, rejectUnauthorized: false`; `#auth-state` = `client-cert-presented` / `no-client-cert`; JSONL presence-booleans only); NEW `import-client-cert.mjs` NSS helper (**prechecks pk12util + certutil BEFORE any mutation, fails with the `libnss3-tools` hint**; `--import`/`--remove` reversible pair, fixed nickname); README — TLS-sibling section (usage, curl verification, NSS prerequisite + operator-machine-mutation flag + db-init hint, trust-bypass rationale).
- `scripts/a11y-audit.mjs` — `sheet:cert-picker` SHEET_STATES entry + `sheet-cert-picker` dismissal node id.
- `tests/behavior/web-compat-client-cert.md` — `draft` → `active`; preconditions firmed to the implemented flag/helper invocations.
- Tests: `auth-challenges.test.js` rewritten PARAMETRIC over both kinds for every shared-semantics case (65 tests, was 33: DD2 buckets ×2 kinds, FIFO/hold/re-present/fullscreen/dismiss-locked/cancelForTab(+AUTH_MENU_TYPES close pin)/cancelForWindow/throwing-callback ×2, interleaved-kinds FIFO, cert guards + defensive empty-list, `selectCertFromSheet` ledger-first + out-of-range + kind-guard, agent-seam refusals incl. the queued-basic-while-cert-presented named edge case, source-scan pin); `register-overlay-ipc.test.js` +4 (cert-select-BEFORE-close ordering, cancel/malformed-id fall-through, non-cert menuType, absent-injection tolerance); `app-lifecycle.test.js` +2 (top-level registration + preventDefault routing); NEW `cert-picker-template.test.js` (5: card/list aria, labeled rows + cancel row, defensive states, id↔index round-trip, ESM↔CJS prefix cross-pin); NEW `insecure-tls-flag.test.js` (4: gating, stripping, duplicates/absent argv, source pin that the switch literal exists ONLY in the helper and nowhere under `src/`); `seam-contract.test.js` pin bumps (below).

**Pin bumps (planned, deliberate — leg Outputs):**

- `SEAM_COUNT` 30 → 31: +`openCertPickerOverlayForAudit`, the `sheet:cert-picker` a11y driver (leg-authorized seam addition, auth-basic precedent).
- `RENDERER_LINE_BUDGET` 1735 → 1766: +31 lines for the cert-picker chrome wiring (overlay state entry, present listener, channel-6 no-op branch, audit hook, seam-block bookkeeping) — the same minimum per-sheet chrome footprint as leg 02's auth-basic bump; renderer.js extraction remains banked debt.

**Fixture verification (leg Verification Steps, curl only — no NSS import performed):** `gen-certs.mjs` produced the full set; `serve-tls.mjs --port 8493` served `#auth-state` = `client-cert-presented` with `curl -k --cert client.pem --key client-key.pem` and `no-client-cert` without, JSONL log correct (presence booleans only). `import-client-cert.mjs` verified to fail-with-hint on this machine (pk12util/certutil absent — precheck fired, nothing touched), exactly the AC's operator-machine posture.

**a11y gate:** `npm run a11y` (admin-keyed, live app, gate tags) reproduces the pre-existing sheet-sweep abort at `sheet:kebab` unchanged (secret-sheet refusal — the flight-logged M12 anomaly; abort point identical, so no NEW breakage introduced by this leg). Chrome-mode states verified explicitly via a chrome-only run of the same audit body: **"No NEW violations — every violation node is in the ACCEPTED baseline"** across all six chrome states. `sheet:cert-picker` joins the audited matrix code-side (seam-contract-pinned) with the structural a11y contract pinned offline in `cert-picker-template.test.js` (the leg-02 compensation pattern).

**Live smoke (dev:automation, admin MCP):** `openCertPickerOverlayForAudit()` via the evaluate seam opened the cert-picker sheet through the full chrome→main→sheet path — `enumerateWindows` `sheetVisible: false → true` on the sheet wc. TLS/NSS-dependent chooser flow remains the FD behavior run (deferred per Decisions).

**Deviations**: none from the design-reviewed guidance. In-leg latitudes exercised and recorded: present-channel choice (Decisions below); NSS helper implemented as `.mjs` (leg allowed `.sh` or `.mjs`); `handleSelectClientCertificate`'s display host derived via `new URL(url).host` with a raw-string fallback.

### Leg 04 `pdf-inline` — landed (2026-07-27)

**Status**: implementation complete; unit gates green (`timeout 300 npm test` 2993 pass — +9 over leg 03's 2984 — lint, typecheck; no a11y surface this leg, per the leg AC). Premise check performed live BEFORE the carve-out landed (DD5 checkpoint below); **premise outcome (ii)** — the carve-out is exercised and landed. Spec `web-compat-pdf` flipped `draft` → `active`; behavior run remains FD-owned. Not committed (batched at flight end).

**DD5 checkpoint — empirical premise check (leg step 1, recorded per the flight spec):**

- **Method**: fixture endpoints landed first (`/doc.pdf`, `/doc-attachment.pdf`, `/redirect-302` — curl-verified); dev app launched via `npm run dev:automation` with a temporary local `plugins: true` plus temporary file-appending diagnostics on the guest's three nav events (event name, `url`, `isMainFrame` presence, guard verdict), the non-guest catch-all, and `will-download`. All temporary diagnostics removed after the check (verified via git diff — `app-lifecycle.js`/`register-download-ipc.js` carry only legs 01–03 content).
- **Observed outcome: (ii)** — with `plugins: true` and STOCK strict `guardNav`, navigating a guest to `/doc.pdf` produced `will-frame-navigate` ON THE GUEST with `isMainFrame: false` and URL `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/<stream-uuid>` (a mime-handler stream id, not `index.html`), refused by `guardNav` → viewer blank (bare toolbar, no page content, no page counter). No `will-download` fired; downloads surface and directory unchanged. **The viewer is a guest-subframe navigation, not a separate webContents** — `ALLOWED_NONGUEST_SCHEMES` is not the operative seam for rendering (the flight's "non-guest side prepared if" clause resolves: not needed for the viewer frame).
- **`isMainFrame` empirical presence**: `will-frame-navigate` carries the field (`false` for the viewer frame; `'isMainFrame' in event` true). `will-navigate`/`will-redirect` never fired during the scenario — a `loadURL`-initiated PDF navigation fires neither, and web→extension top-frame attempts are refused before any guest nav event (consistent with the spec's seam note); their strictness is carried by the unit matrix.
- **`plugins: true` scope (docs + empirical)**: in Electron 43 the only in-tree plugin is the PDF viewer (PDFium) — PPAPI/Flash are long gone; DD5's "widened surface = the PDF plugin process" stands. Empirical cross-check: with `plugins` ABSENT, a PDF navigation does NOT download (contrary to the historical Electron folklore) — the embedder shell + bare viewer toolbar still load, PDFium simply never instantiates and the tab shows an empty dark viewer; `navigator.pdfViewerEnabled`/`navigator.plugins` report the viewer as present EITHER WAY (browser-level values — not evidence of the per-guest pref).
- **Effective downloads directory (dev profile, this environment)**: `app.getPath('downloads')` resolves to the user's HOME directory (WSL, no XDG Downloads dir) — the attachment landed at `~/doc-attachment.pdf`, NOT `~/Downloads`. The behavior spec's snapshot-diff step must snapshot the resolved path (downloadsList's `savePath` is authoritative), not assume `~/Downloads`.
- **Post-carve-out re-run (carve-out + `plugins: true`)**: `/doc.pdf` renders fully inline (page counter "1 / 3", three thumbnails, zoom/download/print controls, fixture page text legible in captures); `scroll` steps to "2 / 3" (live viewer, spec step 3's observable); downloads surface + directory unchanged after inline view; fixture JSONL shows exactly ONE `/doc.pdf` request per navigation (the mime handler streams the original response — no refetch). `/doc-attachment.pdf` on the same tab: navigation does not commit (`ERR_FAILED (-2)` surfaced to the caller), download completes (downloadsList entry `state: completed`, `mime: application/pdf`; on-disk bytes identical to the fixture PDF), tab remains on the `/doc.pdf` viewer — no takeover. Farbling interplay: no renderer crash; `evaluate`/captures on the viewer tab all functional.
- **Live guard probes (AC)**: MCP/omnibox path — `navigate` to `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html` refused (`automation: bad-url`), no commit. Page-JS top-frame — `location.href = <viewer URL>` on a loaded fixture page: no commit, tab DOM still the fixture page. Seam attribution is unit-pinned per the leg.

**Changes made** (all per DD5 / leg design):

- `src/main/register-tab-ipc.js` — `plugins: true` on the WEB branch only (beside `sandbox: true`, DD5 comment); internal branch untouched.
- `src/main/guest-wiring.js` — module-level `PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'` (comment citing DD5 + the premise evidence); `guardFrameNav` wrapper **REPLACES** the `will-frame-navigate` registration (leg step 3's registration-shape ruling), delegating to `guardNav` unless the event is a subframe (`isMainFrame === false`, fail-closed on absence) on a non-internal guest whose URL-parses to scheme `chrome-extension:` with host exactly the pinned id. `will-navigate`/`will-redirect` keep bare `guardNav`.
- Fixture `tests/behavior/fixtures/web-compat/serve.mjs` — `/doc.pdf` (in-memory generated 3-page PDF, large per-page Helvetica text, `Content-Disposition: inline`, `Cache-Control: no-store`), `/doc-attachment.pdf` (same bytes, `attachment`), `/redirect-302` (`?to=` override, pinned default `Location: data:text/html,redirected`); header doc-comment updated (the "later legs extend" / 302 TODO note replaced by the real endpoint docs). `README.md` — endpoint list updated, "Planned extensions" section retired.
- Tests: `guest-wiring.test.js` +9 (carve-out matrix driving the CAPTURED per-event handlers: viewer subframe allowed; top-frame `will-navigate`/`will-redirect` refused; subframe `will-redirect` refused; `will-frame-navigate` top-frame refused; missing-`isMainFrame` refused (fail-closed pin); different extension id refused; genuinely-unparseable URL (`chrome-extension://[bad/x` — throws in `new URL`) refused; ordinary http(s) subframes unaffected both ways; internal-guest viewer subframe refused). `register-tab-ipc.test.js` — web branch asserts `plugins === true` with `sandbox` retained; internal branch pinned to have NO `plugins` key (explicit assertion atop the existing strict `deepEqual`).
- `tests/behavior/web-compat-pdf.md` — `draft` → `active`.

**Deviations**:

- **Apparatus (recorded below in Deviations): the premise check was driven over the repo's sanctioned MCP client path (SDK `StreamableHTTPClientTransport`, `scripts/mcp-example-client.mjs` pattern) against a freshly-launched instrumented instance on a pinned `GOLDFINCH_MCP_PORT`,** not the session's registered `mcp__goldfinch` tools — those turned out to be bound to a stale pre-edit app instance in an unreachable sandbox namespace (see Anomalies). Same MCP surface, same tools, admin key used only for `downloadsList`.
- **In-leg strictness addition**: the carve-out's allow branch additionally requires a non-internal guest (`!contents.session.__goldfinchInternal`) — internal guests keep the internal allowlist with no carve-out (unit-pinned). A strictness increase within the DD5 envelope, not a relaxation; internal guests have no `plugins` key so the viewer cannot instantiate there regardless.
- Final-leg verification found legs 01–03 unticked in flight.md's Legs list despite their post-completion checklists; all four now ticked (their landings are evidenced by the entries above). Flight status left `in-flight` — the flight-level review/commit phase is FD-owned.

---

## Decisions

*(runtime decisions will be appended here)*

### Cert-challenge present channel: dedicated `cert-challenge-present` send (leg 03, developer)
**Context**: Leg guidance step 1 left the main→chrome present channel open — either a new `cert-challenge-present` send or a `kind` field on the existing `auth-challenge-present` — and required the choice documented here.
**Decision**: A DEDICATED `cert-challenge-present` send (`{ wcId, host, certs: [{subject, issuer}] }`).
**Rationale**: (a) the per-surface-channel idiom every other sheet trigger uses (`vault-recovery-show`, `vault-accesskey-show`, …); (b) the existing channel's payload contract stays frozen (leg-02 consumers and its unit pins are untouched); (c) the d.ts typing stays discriminated by channel rather than a runtime kind union. Cost: one extra preload method + d.ts entry — inside the planned renderer-budget bump.

---

## Decisions

### Behavior runs for legs 02+ deferred without re-attempt (FD)
**Context**: Leg 02's AC says "FD run attempted (pass, or apparatus-blocked with deferred disposition)". Leg 01's run already proved the session-wide apparatus gap (jar-scoped MCP identity; window-level captures admin-only), and leg 02's developer additionally observed `captureWindow` timing out while a prompt holds a pending load.
**Decision**: Do not spawn Executor/Validator crews that will deterministically block at the apparatus scan. `web-compat-basic-auth` and the vault-login re-run carry the same deferred disposition as `web-compat-fullscreen` (see Anomalies), citing leg 01's aborted run log as the evidence. This is a documented deviation from the AC's literal "attempted" wording.
**Impact**: All deferred behavior runs queue for the alignment/HAT flight or any admin-keyed session; the flight's landed-state verification rests on unit gates (2993 green at flight close) plus the developers' live smoke checks.

### Leg 04 behavior run also deferred; leg checkbox hygiene corrected (FD, flight close)
**Context**: Leg 04's AC left the run-vs-defer call to the FD. The leg-04 developer additionally found the session's MCP tools bound to a stale pre-edit app instance (Anomalies), so an Executor over session MCP cannot reach a current instance.
**Decision**: Defer `web-compat-pdf` with the others — its substance (inline render, no double-download, attachment behavior, both guard probes) was already verified live during the premise check against a provably-current instance. Also per the flight Reviewer's finding: legs 02–04's internal checkboxes were ticked to match their verified `landed` state (leg-file audit-trail hygiene).
**Impact**: One consolidated deferred-verification bundle for HAT: web-compat-fullscreen, web-compat-basic-auth, web-compat-client-cert, web-compat-pdf, vault-login re-run.

### Docs pass at flight completion (FD-spawned Developer)
README web-compat feature notes; CLAUDE.md pins (auth-callback exactly-once ledger; PDF carve-out shape) plus the seam-count lockstep update (29→31) legs 02/03 owed; docs/mcp-automation.md and docs/vault.md gained `vaultAnswerAuth` (tool #35). Lint/typecheck clean after.

---

## Deviations

*(none yet)*

---

## Anomalies

### Behavior-test apparatus gap: window-level capture unavailable under jar-scoped MCP identity
**Observed**: `/behavior-test web-compat-fullscreen` run 2026-07-27-23-17-33 aborted at the Executor's apparatus scan — the session's goldfinch MCP key is jar-scoped and `captureWindow`/`enumerateWindows` are admin-only; every chrome-visibility expectation needs window-level captures. OS-level substitute capture denied by session permission policy.
**Severity**: degraded — leg 01's live-visual AC cannot close this session; the wiring itself is unit-pinned (2869 tests green).
**Resolution**: Run log committed (`tests/behavior/web-compat-fullscreen/runs/2026-07-27-23-17-33.md`) with remediation (register the dev instance's admin MCP endpoint). Leg 01 lands with the behavior AC carried as a flight-level open item; re-run planned for the alignment/HAT flight or any admin-keyed session. Same gap will affect the auth-challenges and client-cert specs (sheet visibility is also window-level); the pdf-inline spec is mostly guest-content + filesystem observables and may still be runnable. FD ruling: continue the flight; do not redesign specs around the weaker apparatus — the specs are correct, the session identity is what's lacking.

### a11y audit sheet-state sweep broken on `main` since M12 (pre-existing; discovered by leg 02's gate run)
**Observed**: `npm run a11y` (admin-keyed, live app, gate tags) aborts at the FIRST sheet state (`sheet:kebab`) with `automation: secret-sheet — wcId N is a chrome-owned secret/overlay sheet and is never automatable (any tier)`. Root cause: PR#112 finding 1 (M12 F5 review) hardened `resolveContents` to refuse the menu-overlay sheet's webContents at EVERY tier — which is exactly the wcId the audit's sheet sweep drives axe into (`findSheetWcId` → `injectScript`). Reproduced with the COMMITTED `HEAD:scripts/a11y-audit.mjs` against the same live instance: identical failure, so the breakage predates this flight — the audit's sheet sweep has been un-runnable since the M12 merge (M12's sheet-state runs evidently predate the finding-1 hardening within that PR; leg 01's branch-start gate ran test/lint/typecheck only). All chrome-mode states (base-chrome, media-panel, privacy-panel, lightbox, devtools-button, downloads-button) execute cleanly before the abort.
**Severity**: degraded — leg 02's "auth-basic joins the audited sheet matrix" AC is delivered code-side (SHEET_STATES entry + dismissal node id + seam hook, all seam-contract-pinned) but cannot be live-verified; the same holds for every existing sheet state.
**Resolution**: unresolved in-leg, DELIBERATELY — un-breaking it means relaxing a CLAUDE.md-pinned security boundary ("never automatable (any tier)", the keylog/secret-read vector), which is a security ruling outside leg authority. Compensations landed: `auth-basic-template.test.js` pins the sheet's structural a11y contract (role=dialog/aria-modal, labeled fields, aria-live error, keyboard-reachable buttons via the shared modal-card cycle) offline. Carried as a flight-level open item for FD/security: reconcile the audit with finding 1 (e.g. a dev-only, `!app.isPackaged`-gated audit affordance with a security review, or an in-sheet self-audit seam).

### Session MCP tools bound to a stale, unreachable app instance (leg 04 premise check)
**Observed**: during leg 04, the session's registered `mcp__goldfinch` tools kept returning tabs (`wcId` 8–13, monotonically continuous) from an app instance running PRE-LEG-04 code, across multiple relaunches of the instrumented app — while freshly-launched instances (verified by boot diagnostics: chrome wc 1 + boot tab wc 2 only) never received the session tools' traffic. The stale instance was invisible to `ps`/`/proc` scans and immune to `kill` from the developer's shell (sandbox pid/network-namespace isolation); its tab world proved every session-tool observation was against stock code. First symptom worth remembering: the stale instance rendered the PDF viewer's bare toolbar with `navigator.pdfViewerEnabled: true` — nearly indistinguishable from a plugins-enabled build until the instrumentation silence gave it away.
**Severity**: degraded (apparatus) — no code impact; cost ~30 minutes of forensic confusion mid-premise-check.
**Resolution**: premise check re-based on a provably-instrumented instance: fresh launch on a pinned `GOLDFINCH_MCP_PORT`, dev-minted keys, driven via the SDK client path (`scripts/mcp-example-client.mjs` pattern) from the same shell namespace; instance identity proven by boot diagnostics + a fresh small-wcId tab world. Lesson for future legs/FD runs: when a session's `mcp__goldfinch` binding predates the leg's app relaunch, treat its observations as suspect — verify instance identity (e.g. `enumerateTabs` world shape) before trusting live evidence.

### captureWindow times out while an auth prompt holds the page load
**Observed**: with a challenge pending, `captureWindow` returns `automation: capture-timeout — active guest did not settle within 3000ms` — the guest's load is deliberately held un-answered while the prompt is up, so the settle wait never completes.
**Severity**: cosmetic (apparatus) — affects the behavior spec's step-1 "window capture shows host + realm" evidence path.
**Resolution**: noted for the FD behavior run: capture after answering/cancelling, or accept `enumerateWindows`' `sheetVisible: true` + the guest-DOM cleanliness read as the step-1 evidence (both witnessed in the leg's live smoke).

---

## Flight Director Notes

- Phase file `leg-execution.md` loaded and validated (Crew/Interaction Protocol/Prompts present).
- Flight marked `in-flight`; branch `flight/01-main-process-wiring` created from `main` (v0.11.6).
- Baseline gate on branch start: `npm test`, `npm run lint`, `npm run typecheck` all green (exit 0).
- **Leg 04 `pdf-inline` risk tier: HIGH** — small leg, but it relaxes a mission-13 security surface (nav-guard carve-out) and flips a renderer capability (`plugins`); DD5 makes it a named security decision, so it gets the review despite its size.
- **Leg 03 `client-cert` risk tier: HIGH** — extends the security-adjacent challenge state machine with a second kind, introduces a dev-only TLS trust-bypass flag, and its fixture tooling mutates the operator's NSS store (reversible, documented). Design review required.
- **Leg 02 `auth-challenges` risk tier: HIGH** — security-sensitive surface (credential IPC), new challenge-lifecycle state machine with every-callback-answered obligations, and shared-interface additions (menu-overlay-manager `onClosed` hook, `vault-context` method, MCP tool). Design review required.
- Leg 01 behavior run `web-compat-fullscreen` aborted on apparatus (see Anomalies); FD disposition: continue flight, defer live-visual verification.
- **Leg 01 `html-fullscreen` risk tier: HIGH** — introduces a window-record lifecycle mode (`record.htmlFullscreen`) and gates the shared renderer→main bounds pipeline (`tab-set-bounds`) that every tab and overlay depends on; also touches `moveTabIntoWindow` (synchrony-invariant-pinned function). Design review required before implementation.

---

## Session Notes

- Planning session: mission 14 created from issue #132; architect viability review returned "feasible with caveats"; all caveats folded into flight DDs (bounds-overwrite hazard → DD1 gate; auth concurrency → DD2 queue; PDF nav-guard → DD5; OAuth bot heuristics → Flight 2/fixture strategy).
