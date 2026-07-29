# Leg: client-cert

**Status**: landed
**Flight**: [Main-Process Wiring — Fullscreen, Auth Challenges, Inline PDF](../flight.md)

## Objective

Wire `select-client-certificate` per flight DD4 (with the design-review correction: it is an **app-level** event) so cert-requesting sites present a picker sheet instead of failing silently, riding the leg-02 challenge queue.

## Context

- Flight DD4 as corrected: `app.on('select-client-certificate', (event, webContents, url, list, callback))` in `registerAppLifecycle`, routed like `app.on('login')` (now at `app-lifecycle.js:84`); internal exclusion via `session.__goldfinchInternal`; same per-window queue; `cert-picker` list template on the `vault-picker` precedent; selection → `callback(list[i])`, cancel → `callback()`.
- Leg 02 landed the store (`src/main/auth-challenges.js`, 353 lines): per-window FIFO, exactly-once ledger, DD2 bucket mapping with fail-safe, re-present triggers, presentation eligibility incl. `!isMenuOpen()`. This leg **extends** it with a challenge `kind` rather than adding a second store — the queue semantics are identical; only presentation menuType and resolution payload differ.
- Cert choices are **not secrets** (subject/issuer display strings; the selection is an index) — no zeroized channel needed; selection rides channel-4 `activated` with a pick index. The `vault-picker` precedent applies to the **template/index-id shape only** — the activation routing deviates (main-side, see guidance step 3); if main-side code wants `parsePickIndex`, note `cert-picker-template.js` is `src/shared/` ESM (use a local parse helper main-side if `require(esm)` is awkward).
- Chromium caches the chosen cert per session per host (mission ruling: accepted; fresh profile per behavior run).
- **Renderer budget**: `renderer.js` is at 1734 against `RENDERER_LINE_BUDGET = 1735` — this leg's sheet-state addition requires another deliberate bump (+ `SEAM_COUNT` for the a11y seam).

## Inputs

- Legs 01–02 landed (uncommitted); `npm test` 2937 green, lint/typecheck clean.
- Draft behavior spec `tests/behavior/web-compat-client-cert.md`; fixture server `tests/behavior/fixtures/web-compat/serve.mjs` (HTTP only — no TLS sibling yet).
- Store API surface: `createAuthChallenges` (`auth-challenges.js:67`), `presentNext` (`:122`), `notifySheetClosed` (`:232`), `answerWithCredential` (`:304`).

## Outputs

- `kind`-aware challenge store (`'basic-auth' | 'client-cert'`); `handleSelectClientCertificate` entry point
- `app.on('select-client-certificate')` in `app-lifecycle.js`
- `cert-picker` sheet template + registry/dispatch/state/a11y integration (channel-4 selection, no new invoke channel)
- TLS fixture `serve-tls.mjs` (`requestCert: true`, authenticated-marker page) + `gen-certs.mjs` (openssl-driven throwaway CA/server/client certs, **gitignored**, regenerated locally) + scripted NSS import/remove helper + README
- Dev-only TLS trust bypass: `--insecure-tls-fixtures` flag in `scripts/dev-launch.mjs` appending Chromium's `ignore-certificate-errors` switch — automation-dev launch path only, no production code change
- Behavior spec `web-compat-client-cert` → `active` (run deferred per the flight-log Decisions entry)
- Pin bumps: `RENDERER_LINE_BUDGET`, `SEAM_COUNT`, justified

## Acceptance Criteria

- [x] A TLS handshake requesting a client certificate presents exactly one `cert-picker` sheet (subject + issuer per row) on the owning window when that tab is active, riding the leg-02 queue (FIFO with basic-auth challenges, same eligibility rules incl. `!isMenuOpen()` and fullscreen hold)
- [x] Selecting a row resolves `callback(list[i])`; Esc/outside-click/cancel resolves `callback()`; every DD2 bucket behavior (occlusion re-present, fail-safe unknown-reason cancel, navigation-away/tab-close/move/window-teardown cancels) applies to `client-cert` challenges and is unit-pinned via the shared matrix
- [x] Internal-session, contents-less, and non-guest requests cancel silently (unit-pinned)
- [x] An empty `list` cancels silently without presenting — **defensive-unreachable guard** (Electron 43 continues cert-less before emitting the event when the list is empty; verified in source); the live no-cert expectation is "no event, no sheet, page loads unauthenticated"
- [x] The `vaultAnswerAuth` agent path does NOT answer client-cert challenges (`{answered:false, reason:'no-challenge'}` — cert selection is human-only this flight; unit-pinned)
- [x] `gen-certs.mjs` produces CA/server/client certs + a PKCS#12 bundle; all outputs gitignored; NSS import/remove helper is reversible and documented in the fixture README
- [x] `serve-tls.mjs` serves an authenticated marker only when a client cert was presented; plain requests get a distinguishable unauthenticated state
- [x] The `ignore-certificate-errors` switch is reachable ONLY via the explicit `--insecure-tls-fixtures` flag on the dev/automation launch script; no flag → no switch (unit- or script-test-pinned)
- [x] `npm test`, `npm run lint`, `npm run typecheck` pass; pin bumps justified in the flight log
- [x] Behavior spec `web-compat-client-cert` active; run deferred per the flight-log Decisions entry (admin-keyed session or HAT)

## Verification Steps

- `node --test test/unit/auth-challenges.test.js` (extended matrix) + full gates
- Fixture check: `node tests/behavior/fixtures/web-compat/gen-certs.mjs && node tests/behavior/fixtures/web-compat/serve-tls.mjs --port 8493` then `curl -k --cert client.pem --key client-key.pem https://127.0.0.1:8493/` (authenticated marker) vs `curl -k https://127.0.0.1:8493/` (unauthenticated state)

## Implementation Guidance

1. **Store extension** (`src/main/auth-challenges.js`): add `kind` to the challenge record (`'basic-auth'` default for existing paths). `handleSelectClientCertificate(webContents, url, list, callback)`: same routing ladder as `handleLogin` (null-check, internal exclusion, non-guest cancel) plus a **defensive** empty-`list` cancel — *verified against Electron 43 source: an empty list never reaches the handler (`electron_browser_client.cc` continues cert-less before emitting), so this guard is unreachable-by-construction; pinned anyway.* Enqueue the full store record shape: `{challengeId, kind:'client-cert', wcId, record, url, host (display), certSummaries: list.map(subject/issuer strings), list (raw, main-side only), resolved:false, callback}` — the machinery reads `challengeId`/`record`/`resolved`; the sheet gets display strings, never certificate objects. **`resolveOnce` gains a kind-aware resolution union** (basic-auth: `String(username)/String(password)` coercion; client-cert: `callback(cert)` or `callback()`) — the source-scan pin forbids callback sites outside `resolveOnce`, so the union lives there. `presentNext` dispatches menuType by kind (`'auth-basic'` vs `'cert-picker'`); for the main→chrome present channel, either add a new `cert-challenge-present` send or a kind field on the existing channel — **pick one and document the choice in the flight log**. Introduce a shared **`AUTH_MENU_TYPES`** set (`{'auth-basic','cert-picker'}`) used by BOTH the `notifySheetClosed` filter AND `cancelForTab`'s visible-sheet close (currently hardcoded `'auth-basic'` at `auth-challenges.js:199` — without this, navigation-away leaves a stale cert-picker open). **Kind filter on the agent seams**: `getPendingChallenge` (`:328`) and `answerWithCredential` (`:304`) skip `kind:'client-cert'` challenges — otherwise `answerAuth` could feed a string credential into a native Certificate callback. New `selectCertFromSheet(record, index)` resolves `callback(list[index])` ledger-first (bounds-checked; out-of-range → cancel).
2. **App handler** in `registerAppLifecycle` beside `app.on('login')` (`app-lifecycle.js:84`): `event.preventDefault()`, delegate to the store. Thread nothing new — `authChallenges` is already a dep.
3. **Template** `src/shared/cert-picker-template.js` on the `vault-picker` pattern for its **DOM/roving-list shape only** (roving list, `parsePickIndex`-style ids, cancel row); registry checklist as leg 02 (imports, `TEMPLATES` — the typedef union at `menu-overlay.js:1916` gains `'cert-picker'` — `NODE_OF_ENTRY`, dispatch, `renderer.js` state + present listener, `chrome-preload.js` bridge + `renderer-globals.d.ts`, `SHEET_STATES` + a11y seam). **Selection routing is main-side — a deliberate deviation from vault-picker's chrome-side dispatch** (`renderer.js:695`), because main-side gives native record identity and ledger-first ordering, mirroring `auth-submit`: in `register-overlay-ipc.js`'s `menu-overlay:activated` handler, route `current.menuType === 'cert-picker'` activations to `selectCertFromSheet` **BEFORE** the `closeMenuOverlay('activated', token)` call at `:66` — that close fires `notifySheetClosed(..., 'activated')`, a resolution reason, and without ledger-first ordering it would cancel every selection before it lands. The trailing close then hits the exactly-once no-op. New injected dep on `registerOverlayIpc` (the `authAnswerFromSheet` gating precedent at `:434`). The chrome's ch-6 dispatch validated-no-ops `cert-picker` ids (the `:70` forward is unconditional — one line in the registry checklist).
4. **Fixtures**: `gen-certs.mjs` shells to `openssl` (verified present, 3.0.13; fail with a clear message if absent). **NSS precheck**: `pk12util`/`certutil` are NOT installed on this machine — the import helper prechecks for both binaries and fails with the install hint (`libnss3-tools`) before touching anything; README documents the dependency and the operator-machine prerequisite. Then: throwaway CA → server cert (CN=127.0.0.1, SAN IP) → client cert + `client.p12`; write into `tests/behavior/fixtures/web-compat/certs/` and add that dir to `.gitignore` (test-artifact rule: never commit). `serve-tls.mjs`: `https.createServer({ key, cert, ca, requestCert: true, rejectUnauthorized: false })`; page body carries `#auth-state` = `client-cert-presented` / `no-client-cert` (peer-cert check). NSS helper (`import-client-cert.sh` or `.mjs`): `pk12util -i client.p12 -d sql:$HOME/.pki/nssdb` with a matching remove command (`certutil -D`); README documents both and flags the operator-machine mutation.
5. **Dev-launch flag**: `scripts/dev-launch.mjs` — when `--insecure-tls-fixtures` is present, **strip it from the forwarded argv** (dev-launch spreads `process.argv.slice(2)` verbatim; an unknown switch reaching Electron is a harmless-but-noisy warning) and append `--ignore-certificate-errors`. Implement as a pure decision helper (the `decideOzonePlatform` shape) so the gating AC is unit-testable. No main-process code involvement; dev-script-only by construction.
6. **Tests**: extend the store matrix parametrically over both kinds where semantics are shared; kind-dispatch presentation; empty-list cancel; out-of-range selection; agent-path refusal for cert challenges; app-lifecycle registration + routing; template structural test (roving list, labeled rows); dev-launch flag gating.

## Edge Cases

- **Basic-auth and cert challenges interleaved on one window**: single FIFO, order preserved, one sheet at a time.
- **Cert challenge for a background tab**: holds; presents on activation (shared eligibility).
- **Site requests a cert but the OS store has none**: the event never fires (Electron continues cert-less before emitting) — no sheet, page loads in the fixture's unauthenticated state. The store's empty-list guard is defense-in-depth only.
- **Agent answers a queued basic-auth challenge while a cert-picker is presented on the same tab**: kind filter + `state.presented` early-return make this clean — named case in the parametric matrix.
- **Same-host second request in-session**: Chromium's cert cache answers without firing the event — no sheet; spec expects this (step 3).
- **Challenge mid-fullscreen / sheet occlusion / window teardown**: inherited from the shared matrix — pinned parametrically.

## Files Affected

- `src/main/auth-challenges.js` — kind extension + `handleSelectClientCertificate` + `selectCertFromSheet`
- `src/main/app-lifecycle.js` — `app.on('select-client-certificate')`
- `src/main/register-overlay-ipc.js` — route `cert-picker` activations
- `src/shared/cert-picker-template.js` — new; `src/renderer/menu-overlay.js`, `src/renderer/renderer.js`, `src/preload/chrome-preload.js`, `renderer-globals.d.ts` — integration
- `scripts/dev-launch.mjs` — `--insecure-tls-fixtures`
- `tests/behavior/fixtures/web-compat/gen-certs.mjs`, `serve-tls.mjs`, NSS helper — new; `README.md`, `.gitignore` — edit (both exist)
- `src/main/main.js` — thread the new `registerOverlayIpc` dep from the composition root (the `authAnswerFromSheet` wiring precedent)
- `test/unit/auth-challenges.test.js` + integration suites; `test/unit/seam-contract.test.js` pin bumps
- `tests/behavior/web-compat-client-cert.md` — status flip

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight: update flight.md status to `landed`, check off flight in mission.md

*(Batched workflow: no commit; behavior runs FD-owned and deferred per flight-log Decisions.)*

## Citation Audit

Verified at leg design time against the post-leg-02 tree (grep): `app-lifecycle.js:84` (`app.on('login'`), `auth-challenges.js:67` (`createAuthChallenges({ registry, chromeForTab, logger })`), `:122` (`presentNext`), `:232` (`notifySheetClosed`), `:304` (`answerWithCredential`), `vault-picker-template.js:3` (template header), `menu-overlay.js:1916` (menuType typedef union incl. `'auth-basic'`), `:1923` (`'auth-basic'` TEMPLATES entry), `renderer.js` = 1734 lines vs budget 1735. `scripts/dev-launch.mjs` grep for existing cert flags: none (clean insertion). All OK.
