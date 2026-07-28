# Flight Log: Popup & Opener Ruling + Implementation

**Flight**: [Popup & Opener Ruling + Implementation](flight.md)

## Summary

In-flight. Option B ruled; leg 01 (popup-windows) landed — both in-leg premise checks favorable, popup mechanics + discipline implemented. Leg 02 (parity + fixture) landed — challenge-store popup contract (DD1b as refined), real DD1f cancel seam, census rows + addressability widening (DD1a), OAuth fixture pages + `web-compat-oauth-popup` spec (active), 3089 tests green. Both legs awaiting the flight-close review/commit (batched workflow); behavior run FD-owned post-landing.

---

## Premise Check (pre-flight spike, 2026-07-28)

Throwaway worktree at `71a4f15`, Electron 43.2.0, OAuth fixture (opener/popup postMessage round-trip), driven via admin-keyed automation on a pinned port with fresh userData (instance identity guaranteed). All findings observed directly:

- `{action:'allow'}` (± `overrideBrowserWindowOptions`): live opener handle, bidirectional postMessage, **session always the opener's jar** (partition overrides silently ignored); popup is a `BrowserWindow` outside the registry (no census, auth challenges silently cancel, non-guest nav-guard shape).
- `createWindow` override: **adopt hook, not construct hook** — Electron passes a pre-created opener-linked `options.webContents`; adopting it into a `WebContentsView` on the existing BaseWindow preserves the opener fully (both postMessage directions verified). **Returning any other contents permanently wedges the opener renderer, silently** — absolute implementation taboo.
- Teardown manual in the adopt path (`close` → `destroyed`; host window untouched; dead view must be detached by the implementation). #119 hazard does not apply to window.open-created contents.
- Latch race: same shape as tab-create; setting `__goldfinchNavGuarded` first-thing in the adopt hook is early enough (observed).
- Preload not inherited; injectable via `overrideBrowserWindowOptions.webPreferences.preload`; with preload in, self-close routes through `guest-window-close` → works **only** if `chromeForTab` resolves the popup (i.e., chrome-registered) — else silent no-op.
- Popup `window.open` needs no user gesture (automation-triggerable).

## Flight Director Notes

- Flight 1 debrief carry-forwards applied: premise-check-first (done, above); four grown parity rows folded into the proposal's checklist; apparatus DD names the key-tier/instance-identity constraints explicitly.
- Proposal authored at [popup-proposal.md](popup-proposal.md) — three options, recommendation Option A (popup-as-adopted-tab). **Paused for the human ruling per the mission gate.** No implementation, no legs, until approved.

---

## Flight Director Notes (execution)

- Ruling received (Option B); flight `in-flight` on branch `flight/02-popup-opener` (stacked on flight/01 branch — PR #141 chain).
- **Leg 01 `popup-windows` risk tier: HIGH** — new window class outside prior discipline, security-relevant allow predicate, two live premise checks. Design review required.
- **Leg 02 `popup-parity-and-fixture` risk tier: HIGH** — challenge-store contract change (eligibility/presentation/cancel), security-relevant jar-addressability widening at the DD8 defense-in-depth gate, census semantics. Design review required.

---

## Leg Progress

### Leg 01: popup-windows
**Status**: landed | **Started**: 2026-07-28 | **Landed**: 2026-07-28 (awaiting review)

**In-leg premise checks (both run BEFORE dependent code landed; temporary instrumentation removed after; fresh userData under a scratch `XDG_CONFIG_HOME`, pinned port 49733 — 49717 was refused as in-use at the WSL2/Windows network layer while invisible to `ss`, so the pin moved; instance identity proven by the launch's own freshly minted admin key on the exactly-bound port):**

- **#2 — full webPreferences posture under the EXACT allow+override combination: PASS (all honored).** Probes on the live popup: preload honored (`window.close` is the guest shim, visible from the page main world); `contextIsolation:false` honored (preload-stamped marker readable from the main world; preload `process.contextIsolated === false`); `sandbox:true` honored (`process.sandboxed === true` in the preload — measured under the dev launcher's `--no-sandbox`, so this proves the webPreferences flag/renderer environment, not OS-layer confinement); `nodeIntegration` off (`require`/`process` absent in page); `plugins:true` honored (`navigator.pdfViewerEnabled === true`, 5 plugins). Session automatically the opener's jar partition (`container:personal` storagePath match, `sameSession: true`); opener handle live both directions (`window.opener` truthy in popup; `__pp.closed === false` in opener). No DD1d divert.
- **#1 — latch timing vs did-create-window under plain allow: PASS (favorable).** Measured event sequence: `allow return (seq 1) → web-contents-created(popup, latch false, seq 2) → did-create-window (seq 3) → did-start-navigation (latch true, seq 4) → will-navigate (latch true, seq 5)`. `did-create-window` precedes the popup's FIRST navigation event, so latching/wiring there is race-free. **The DD1c pending-popup fallback stays unused; `app-lifecycle.js` is untouched** (its catch-all is now source-scan-pinned byte-unchanged).
- **Bonus (named consequence confirmed live)**: `window.open(url, 'name')` with no features arrives with `disposition: 'foreground-tab'` — deny-converted to a tab, exactly as the DD3 disposition ruling predicts.

**Changes made:**

- `src/main/popup-registry.js` (new, Electron-free DI): `register` / `remove` / `getByWcId` / `isPopupWcId` / `listForRecord` / `rekeyForRecord(openerWcId, record)` / `closeAllForRecord` — the leg-2 seam. `closeAllForRecord` runs the DD1f order (cancel-challenges seam per popup first — a no-op stub this leg, wired in main.js as `cancelChallengesForPopup: () => {}`, real popup-challenge cancel lands in leg 2 — then destroy), snapshotting before destroying. Entries: `{ popupWcId, openerWcId, openerRecord, partition (captured eagerly), win }`; tolerated-dead-`openerWcId` by design (leg-2 eligibility seam note).
- `src/main/guest-wiring.js`: exported pure `qualifiesAsPopupRequest` (DD3 + disposition conjunction); window-open handler reworked — popup-registry-first owner resolution (`resolveOpenerOwner`, liveness-checked), qualifying → `{action:'allow', overrideBrowserWindowOptions:{autoHideMenuBar, webPreferences: DD1d posture incl. plugins:true}}` with NO adopt-hook key (DD2), non-qualifying → owner-aware deny-convert forward (popup opener → owning record's chrome with the CAPTURED partition; tab opener → byte-equivalent prior path); `did-create-window` → orphan-destroy guard (opener record died between allow and creation), `wireGuestContents` reuse (latch + guardNav trio + `guardFrameNav` + input surfaces + the popup's own window-open handler → chained popups, parented FLAT), registry registration, slim popup event variant (did-navigate / did-navigate-in-page / page-title-updated → history recorder under the captured partition), teardown on `closed` (via the sanctioned `onWindowClosed` wrapper — the raw-`closed` tripwire net caught the first draft) + `destroyed`, with `forgetTab`.
- `src/main/register-browser-ipc.js`: `guest-window-close` popup-registry lookup FIRST → destroy the popup's BrowserWindow (the spike's silent no-op closed); tab path unchanged.
- `src/main/window-factory.js`: `popupRegistry.closeAllForRecord(record)` slotted in the close handler AFTER the unit-pinned `authChallenges.cancelForWindow` (still first) and before sheet/overlay teardown.
- `src/main/register-tab-ipc.js`: `moveTabIntoWindow` gains the synchronous `popupRegistry.rekeyForRecord(p.wcId, target)` re-key after the delete/set pair (synchrony pin untouched — suite green).
- `src/main/main.js`: constructs the registry and threads it into guest-wiring (+ `webPreloadPath`), window-factory, register-tab-ipc, register-browser-ipc.

**Verification:**

- New `test/unit/popup-registry.test.js` (9 tests): lifecycle, DD1e structural pin (registration never touches the WindowRecord/tabViews), flat chained parenting, dead-opener seam, re-key scoping, DD1f order (all cancels precede first destroy), snapshot-before-destroy, dead-window tolerance, throw isolation.
- `guest-wiring.test.js` +15: predicate matrix (all four axes incl. disposition cases and named-no-features → deny pin), exact-allow-shape + no-adopt-key, **DD2 source-scan pin** (no `createWindow` identifier anywhere in guest-wiring.js), deny-convert matrix, teardown-race refusals, did-create-window registration/latch/discipline, **guest-shape nav-guard pin** (popup refuses `file:` — the non-guest allowlist would admit it; PDF-viewer subframe carve-out live in popups), popup HTML-fullscreen non-interference (popup wcId resolves no record; pairs with html-fullscreen.test.js's unowned-wcId no-op pin), history-under-opener-jar, idempotent teardown, popup-originated owner-aware forward, chained-popup flat parenting, dead-owner no-forward.
- `register-browser-ipc.test.js` +3 (popup destroy / tab path intact / optional-registry + forged-historyLength), `window-factory.test.js` +2 (DD1f slot ordering probes; absent-dep tolerance), `register-tab-ipc.test.js` +2 (committed move re-keys to destination; refused move re-keys nothing), `app-lifecycle.test.js` +1 (catch-all deny + guard source-scan, byte-unchanged pin).
- Gates: `timeout 300 npm test` → **3025 pass / 0 fail** (was 2993 + 32 new); `npm run lint` clean; `npm run typecheck` clean.
- **Live smoke (fresh instance, pinned port, post-implementation)**: qualifying `window.open` → real popup, opener handle live (`closed:false`); popup `window.close()` from page script → popup destroyed, opener observes `closed:true` (AC5 end-to-end — previously the spike-documented silent no-op). No uncaught errors in the app log.

**Present-channel/API notes (for leg 2):**

- `popupRegistry.isPopupWcId` is the exact predicate `resolve.js:141`'s widening consumes; `listForRecord`/`getByWcId` carry `{openerWcId, openerRecord, partition, win}` for census rows and challenge routing; `rekeyForRecord` keeps DD1f owner-correct across tab moves.
- No new IPC channels; `guest-window-close` (existing) now popup-aware. Popups are absent from `enumerateTabs`/`enumerateWindows` until leg 2's census rows; a popup wcId is already addressable admin-tier (used by the smoke's popup-side evaluate).
- **Named-accepted input gaps** (Electron-default parity, for HAT): chrome shortcuts are swallowed in popups (Ctrl+L/T/F/J no-op — chromeForTab resolves null), no custom context menu in popups, devtools-state pushes drop. F12/Ctrl+Shift+I still toggle DevTools (guest-local branch); zoom keys and Ctrl+P work (guest-local).
- The DD1f cancel seam (`cancelChallengesForPopup`) is a stub in main.js — leg 2 replaces it with the real popup-challenge cancel.

**Deviations**: none from the leg spec. One in-flight correction: the popup `closed` teardown registration was rewritten through `onWindowClosed` after the house raw-`closed` source-scan net (window-closed-invariant.test.js) correctly refused the direct registration — guest-wiring now imports the sanctioned wrapper from window-factory (no require cycle).

**Anomalies**: port 49717 refused as in-use by the strict dev pin while no Linux-side listener existed (`ss` empty; WSL2 mirrored networking — a Windows-side holder). Moved the pin to 49733; binds-exactly-or-fails-loudly behaved as designed.

### Leg 02: popup-parity-and-fixture
**Status**: landed | **Started**: 2026-07-28 | **Landed**: 2026-07-28 (awaiting review)

**Changes made:**

- `src/main/auth-challenges.js` (DD1b, all four walls; kind-agnostic): optional `popupRegistry` dep (lazy `{ getByWcId }` seam — main.js construction order untouched); `handleLogin` + `handleSelectClientCertificate` route popup-registry-FIRST to the entry's `openerRecord` (before `getWindowForGuest`, which misses popups by construction) and stamp `isPopup: true` on the challenge; `presentNext` eligibility becomes `c.isPopup === true || c.wcId === record.activeTabWcId` (popup challenges eligible independent of `activeTabWcId`, opener liveness, and popup occlusion — the flight-logged DD1b refinement; record-level gates untouched); popup presentation resolves `record.chromeView.webContents` directly (destroyed-guarded) and the payload gains `popup: true` (tab payload contracts frozen — the field is absent for tab challenges).
- **DD1f seam, real wiring (stub replaced)**: `main.js` — `const cancelChallengesForPopup = (popupWcId) => authChallenges.cancelForTab(popupWcId, 'tab-close')`, threaded into BOTH the popup registry (`closeAllForRecord`'s cancel phase — DD1f order pin intact) and guest-wiring (NEW dep), whose popup teardown now runs the seam before deregistering — a self-closed/OS-closed popup resolve-cancels and the owning window's visible auth sheet closes with a resolution-family reason. Seam signature changed `(entry)` → `(popupWcId)` per the leg spec (popup-registry + its tests updated).
- `src/main/guest-wiring.js`: popup slim variant gains `did-start-navigation` → `cancelForTab(popupWcId, 'navigated')` (main-frame, non-same-document — the exact tab filter; DD2 max-staleness holds for popups).
- `src/main/register-tab-ipc.js` (FD cancel-on-rekey ruling): `moveTabIntoWindow`'s hook, after `rekeyForRecord`, synchronously cancels the MOVED opener's popups' challenges with `'moved'` (tab parity; no migration seam; synchrony pin untouched — suite green).
- **Addressability (DD1a)**: `resolve.js`'s `:141` refusal widens to "not a tab AND not a popup → refuse" via injected `isPopupWcId` — the ONLY resolve-side change; membership rides the existing session-identity check untouched (the popup's session IS the interned opener-jar session); the secret-sheet refusal and internal exclusion precede the widened guard. No partition-string comparison anywhere (source-scan-pinned for resolve.js AND tabs.js).
- **Census (DD1a)**: `window-census.js` appends popup entries `{ popupWcId, openerWindowId, url, title }` after the window rows (distinct shape, no `windowId` — `requireWindow`/`getChromeTarget` skip them structurally; omitted third arg → byte-identical); `tabs.enumerateTabs` merges main-built popup rows `{ wcId, url, title, jarId, active: false, windowId (owner's), popup: true }` via the injected `listPopups` seam (both assembly paths, appended last; absent → no rows). `main.js` builds both accessors zero-state from the live registries; **jarId maps main-side from the captured partition via `jars.list()`** — burner popups map to no jar → admin-only visibility (jar tier drops them on the scope façade's resolved-session filter, which needed NO change: popup sessions are the interned jar sessions).
- **Dual engine-deps injection (grep-pinned)**: `listPopups` + `isPopupWcId` threaded at main.js's MCP `getEngine` site AND app-lifecycle.js's dev-seam engine (new `listPopups`/`isPopupWcId` deps destructured; the byte-unchanged catch-all pin untouched); engine.js rides both by the conditional-spread idiom. New `test/unit/popup-parity-pins.test.js` source-scans both sites, the stub replacement, the census accessor, and the lazy routing seam.
- **DD5 marker (no new sheet)**: `auth-basic-template.js` + `cert-picker-template.js` gain a fixed-copy `popupNote` line ("This request comes from a pop-up window opened by this page.", hidden by default); `menu-overlay.js` toggles it per `model.popup` (cert-picker model accepts the bare rows array OR `{ certs, popup }` — a11y hook unchanged); `renderer.js` forwards the store-stamped flag (net-zero lines — the 1766-line budget pin held and forced comment trims); `renderer-globals.d.ts` payload types gain `popup?: boolean`.
- `mcp-tools.js` descriptions: enumerateTabs popup rows, enumerateWindows popup entries, `activateTab(popup) → false` + no-raise note, vaultAnswerAuth popup note.
- **Fixture** (`tests/behavior/fixtures/web-compat/serve.mjs` + README): `/oauth/opener.html` (button → `window.open('/oauth/popup.html','oauth','width=420,height=520')`, `#popup-state` via live-handle `.closed` polling, `#result` token sink + ack, handle exposed as `window.__oauthPopup`) and `/oauth/popup.html` (provider-shaped: HOLDS at `#status` awaiting-approval until `#approve` is clicked — gives the spec a live window to census/drive the popup by wcId — then token → ack → `window.close()` self-close). JSONL logging covers both (existing per-request line). Curl-verified live: both pages 200 with the expected DOM seams, unknown `/oauth/*` 404, existing endpoints intact, log lines written.
- **Behavior spec** `tests/behavior/web-compat-oauth-popup.md` (NEW, status `active`, `Cache: cold`): 8 steps — open opener → [admin] baseline census → click opens a real popup (jar-visible popup row) → [admin] census entries (`openerWindowId` match) → drive the popup by wcId (jar-runnable) → approve → token in `#result` + self-close + handle `.closed` → [admin] census clean. Census steps marked **[admin]** per DD4; core steps jar-runnable. Run is FD-owned post-landing.
- **Spec audit** `tests/behavior/popup-jar-inheritance.md`: premise re-audited — its `window.open('<url>')` calls are featureless/unnamed → `foreground-tab` disposition → still deny-convert; every step remains correct. Annotated (M14 F2 note) rather than rewritten; points real-popup coverage at `web-compat-oauth-popup`.
- **Docs**: `docs/mcp-automation.md` — new *Popup windows (M14 F2)* section (census shapes, tiers, driving semantics, auth, lifecycle) + tool-table rows updated; `README.md` — OAuth-popup feature note (plain `target=_blank` still tabs).

**Verification:**

- `auth-challenges.test.js` +69 (104 total): popup matrix parametric over BOTH kinds — registry-first routing + record-chrome presentation + `popup: true` payload, eligibility independence (foreign active tab + dead `openerWcId` + occlusion), record-level gates hold, full DD2 bucket loop (5 resolution + fail-safe unknown + 4 occlusion reasons, per kind), destroy-cancel via the seam body (idempotent), re-key `'moved'` no-hung-callback, navigation-away, `cancelForWindow` sweep, two-popup FIFO, first-ELIGIBLE-not-first-queued, frozen tab payloads, agent seams on popups (getPendingChallenge/answerWithCredential; cert kind invisible), destroyed-chrome present guard.
- `automation-resolve.test.js` +6: popup widening (resolves with predicate, non-member still refused, admin/secret-sheet/internal orders unaffected), session-identity membership own/foreign popup, DD7 no-partition-compare source pin.
- `automation-tabs.test.js` +5: popup-row merge (multi-window + fallback paths, appended last, verbatim rows, absent/null seam), `activateTab(popup)` → false with zero dispatch/raise.
- `window-census.test.js` +3: entry shape/order/no-windowId, omitted-arg byte-parity, malformed-entry skip. `popup-parity-pins.test.js` (NEW, 5): the dual-injection + stub-replacement + census-accessor + routing-seam source scans.
- `register-tab-ipc.test.js` +2 (cancel-on-rekey: moved opener's popups cancel `'moved'`, staying tab's popup untouched; refused move cancels nothing — harness popupRegistry fake gained `listForRecord`); `guest-wiring.test.js` +2 (teardown seam-first; popup `did-start-navigation` filter matrix); template suites +2 (marker line: fixed copy, hidden default, placement); `popup-registry.test.js` updated to the `(popupWcId)` seam signature.
- Gates: `timeout 300 npm test` → **3089 pass / 0 fail** (was 3025 + 64 net new); `npm run lint` clean; `npm run typecheck` clean. Fixture endpoints curl-verified (see above).

**Deviations**: none from the leg spec. Two in-flight notes: (1) the seam signature `(entry)` → `(popupWcId)` is the leg spec's own naming (`cancelChallengesForPopup(popupWcId)`) — leg-01's tests updated to match; (2) renderer.js's 1766-line budget pin fired on the first draft's comment lines — trimmed to net-zero (DD5's "no >trivial renderer.js addition" held; no extraction needed).

**Anomalies**: none.

## Decisions

### DD3 refinement: disposition axis added to the popup predicate (FD, leg-01 design)
**Context**: Design review found the features/named-target axes alone capture middle-clicks (`background-tab`) and plain clicks on named-target links — tab-intent gestures would become focused floating popups.
**Decision**: qualifying requires `disposition === 'new-window'` (Chromium's own popup classification) in addition to the approved axes. Within the flight's delegated "detection details → leg design" latitude; the human-approved A/B/C ruling is untouched.
**Impact**: middle-clicks and named-target link clicks keep deny-and-convert. **Named consequence** (review pass 2): `window.open(url, 'name')` *without* features is classified `foreground-tab` by Chromium, so it also keeps deny-convert with a null opener — the disposition conjunction intentionally narrows DD3's original "features OR named" reading; unit-pinned (named-no-features → deny) so HAT doesn't rediscover it as a surprise.

### DD1b refinement: popup-challenge eligibility decoupled from the opener tab (FD, leg-02 design)
**Context**: DD1b said "eligible when the opener tab is the window's active tab." Design review + the tolerated-dead-`openerWcId` seam showed that rule strands challenges (dead opener) and is conceptually wrong (a popup is a floating always-visible surface).
**Decision**: popup challenges are eligible independent of `activeTabWcId`, opener-tab liveness, and popup occlusion; standard sheet/fullscreen eligibility still applies. Re-key = cancel-on-move (`'moved'`, tab parity — no migration seam). Within delegated latitude; A/B/C ruling untouched.

### Popup parity rulings at leg-01 design (FD)
`plugins: true` in popup webPreferences (guest parity — else the PDF carve-out is dead code in popups); popup-originated `window.open` is leg-01 scope with popup-registry-first owner resolution and owner-aware deny-forwarding; opener-tab-moved re-keys popup entries to the destination record; opener-tab-closed leaves popups alive with a tolerated-dead `openerWcId` (leg-02 eligibility must not depend on it).

## Deviations

*(none)*

## Anomalies

*(none)*

## Session Notes

- 2026-07-27/28: planning session — spike, proposal, flight draft; architect design review of the draft follows, then the pause.
