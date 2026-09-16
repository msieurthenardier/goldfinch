# Leg: certificate-trust-and-interstitial

**Status**: completed
**Flight**: [TLS Trust — Interstitial, Override, Indicator, Viewer](../flight.md)

## Objective

Main answers every certificate error at once (refuse, or allow when the
origin is remembered), records the failing certificate on the tab entry so
Flight 1's panel renders certificate-specific copy, observes every TLS
verification through a session verify-proc that always defers to Chromium,
computes a per-tab `security` state at each main-frame commit, and reports
`cert-blocked` and `security` in the census — with `allow()` existing but
having NO caller (the proceed path is leg 3).

## Context

- Binding DDs: **DD1** (answer-at-once; stamps; popups), **DD2** (override
  memory shape; clears; persistence grep-ACs), **DD4** (panel specialisation
  — this leg ships the copy/code branch and Retry only; `#load-failure-view-
  cert` is leg 4's, `#load-failure-advanced` leg 3's), **DD5** (cert kinds,
  `CERT_BLOCKED`, `security` enum), **DD6** (observer, placement, cap),
  **DD7** (state derivation), **DD16** (contracts).
- **Leg 1 spike verdicts that bind this leg** (flight log, "Leg 1 spike"):
  (b) the verify-proc sees `ERR_CERT_AUTHORITY_INVALID` and
  `certificate-error` follows with `isMainFrame: true`; (c) `certificate-
  error` REFIRES on every navigation to the origin even after
  `callback(true)` — so the remembered-key lookup runs per request and must
  be O(1); (d) `preventDefault()` + `callback(false)` yields the same
  `did-fail-load` as today; (e) after `callback(true)` the page commits and
  same-origin subresources load; (f) the verify-proc does NOT refire on a
  repeat navigation to the same origin (network-service cache) — the
  per-partition LRU is therefore the ONLY source for a repeat visit's
  certificate, and DD7's observation-first derivation must treat "no cache
  entry" as ordinary, falling back to `entry.certOverride`; (i) a SAN
  mismatch under an untrusted CA reports `ERR_CERT_AUTHORITY_INVALID` (the
  root check wins) — `classifyCertError` needs no special case for it.
- **Flight Director ruling — the `security` push channel (variation on
  DD7).** DD7 says the state "rides the existing `tab-did-navigate` push".
  The adopt/move path re-pushes state after `adopt-tab` but must NOT replay
  `tab-did-navigate` (its chrome handler resets media/privacy/suggestions).
  So the state gets its OWN owner-routed push, `tab-security { wcId,
  security }` (routing class 3), sent (1) from `did-navigate` right after
  `tab-did-navigate`, and (2) from the adopt re-push site beside the existing
  `tab-load-failure` re-push (`register-tab-ipc.js` `queueChromeSend(target,
  …)` after `adopt-tab`, `:639` onward). The chrome stores `tab.security`
  from it. Recorded as an acceptable variation (DD7's intent is the state,
  not the channel).
- **Current code (HEAD `4e4117f` + leg 1 uncommitted)**:
  - `src/main/app-lifecycle.js:96-112` — `login` /
    `select-client-certificate` registered top-level with
    `event.preventDefault()`; the `certificate-error` registration goes
    beside them; `authChallenges` is an injected dep at `:70` — `certTrust`
    joins the deps the same way (constructed in `main.js`, which builds
    `createGuestWiring({...})` at `:1673-1702` and threads
    `applyGuestVisibility` there).
  - `src/main/guest-wiring.js` — `wireTabViewEvents(view, wcId, partition)`
    `:447` (the `partition` string is in scope for the observer lookup);
    `resolveEntry` `:460`; `did-start-navigation` `:468` (clears
    `loadFailure`, stamps `lastRequestedUrl`, and — leg 1 — nothing else);
    `did-fail-load` `:496` (records `loadFailure`; leg 1 clears
    `chromeNavPending` at `:527`); `did-navigate` `:532` (pushes
    `tab-did-navigate` with `effectiveUrl`; clears `chromeNavPending`
    `:542`).
  - `src/main/register-tab-ipc.js` — entry seed with `loadFailure`,
    `lastRequestedUrl`, `chromeNavPending` (`:183-191`; the entry stores
    `partition` at `:183`); `tab-navigate` `:928`; adopt re-push after
    `adopt-tab` (`:639`).
  - `src/main/session-runtime.js:248-284` — `onSessionCreated`;
    `applyShields(session)` at `:254`; the Burner-skipping `if (!jarEntry)
    return` at `:267`; `partitionFromStoragePath` is already imported
    (`:39`, from `jar-data-helpers.js:159`) — the default session has no
    jar storage path → key it `'default'`.
  - `src/main/jar-data-lifecycle.js:20` — `wipeJarData(ses, jarId)`;
    `src/main/jar-registry-ipc.js:88` — `handleRemove`; both gain a
    `certTrust.clearPartition(partition)` + `certObserver.clearPartition`
    call (fail-soft try/catch like the bookmarks drop).
  - `src/main/popup-registry.js:73` — `getByWcId(wcId)` (a popup record
    carries its captured partition; read ONLY that).
  - `src/shared/load-failure.js` — `LOAD_STATES` `:12`, `NAME_KIND`,
    `KIND_COPY`, `classifyLoadFailure` (`ERR_CERT_*` → `cert`),
    `shouldRecordLoadFailure`, `failedTabTitle`.
  - `src/renderer/chrome/load-failure-controller.js` — `render(tab)`
    (heading/body/url/code/retry from `classifyLoadFailure`);
    `bridge.onTabLoadFailure` subscription; `applyStripState`.
  - `src/renderer/chrome/site-security-controller.js` (leg 1 seed, 73
    lines) — the natural owner of the `onTabSecurity` subscription
    (stores `tab.security`; chip/popup consumers come in leg 4).
  - `src/renderer/chrome/tab-controller.js:1212-1213` — `listTabs()`
    `loadState`/`loadError`; `src/main/automation/tabs.js:41-66` —
    `mapEnumeratedTabs`; `src/main/automation/mcp-tools.js:133` —
    `enumerateTabs` description; `docs/mcp-automation.md:461-467`, `:563`.
  - `src/preload/chrome-preload.js:348/:357` — `onTabDidNavigate` /
    `onTabLoadFailure` (add `onTabSecurity`);
    `src/renderer/renderer-globals.d.ts:492-501`.
  - `src/main/window-registry.js:36-42` — entry typedef (add `certFailure`,
    `certOverride`, `certificate`, `security`).
  - `src/main/session-snapshot.js:42-51`, `src/main/closed-tab-capture.js:70-85`
    — explicit allowlisted object literals (DD2 pin).
  - `scripts/insecure-tls-flag.mjs:7` — header comment "no
    `certificate-error` handler" → refresh.
  - Electron 44: `app.on('certificate-error', (event, webContents, url,
    error, certificate, callback, isMainFrame))` (`electron.d.ts:251-260`);
    `session.setCertificateVerifyProc((request, callback) => …)` with
    `request: { hostname, certificate, validatedCertificate,
    isIssuedByKnownRoot, verificationResult, errorCode }`, `callback(-3)` =
    Chromium's verdict (`:13355-13365`, `:23462-23481`); `Certificate`
    (`:6678-6722`: `data` PEM, `fingerprint`, `issuer`, `issuerCert`,
    `subject`, `serialNumber`, `validStart`, `validExpiry`);
    `node:crypto` `X509Certificate` (Node 22) for SAN/hex fingerprints.

## Inputs

- Leg 1 landed (uncommitted): `site-security-controller.js` seed,
  `audit-hooks.js`, `fake-dom.js` helper, the #216 fix; `renderer.js` 1792
  lines under its re-pinned budget; 4590 tests green.
- Live rig + TLS fixture as in leg 1 (same key-hygiene rules; the rig facts
  in leg 1's Context apply verbatim).

## Outputs

- `src/shared/load-failure.js`: `LOAD_STATES.CERT_BLOCKED = 'cert-blocked'`;
  `classifyCertError(name)` → `{ kind, title, body, overridable }` with the
  DD5 table (`authority`, `name`, `date`, `weak`, `revoked`✗, `pinned`✗,
  `invalid`✗, `other`; ✗ = `overridable: false`); `stripNetPrefix(error)`
  (`'net::ERR_X'` → `'ERR_X'`). `classifyLoadFailure` unchanged for non-cert
  names.
- `src/shared/site-security.js` (new ESM): `SECURITY_STATES` (`secure`,
  `insecure`, `overridden`, `none`, `internal`);
  `deriveSecurityState({ url, internal, verification, overridden })` pure
  (DD7 order: internal → none (blank/unparseable) → insecure (non-https) →
  overridden (verification present and not `OK`) → overridden (no
  verification and `overridden` true) → secure).
- `src/main/cert-trust.js` (new, Electron-free): `createCertTrust({ registry, popupRegistry, logger })` → `{ handleCertificateError, allow, has, clearPartition, keyFor }` (documented deviation from DD1's signature: `chromeForTab` is dropped — this module pushes nothing to the chrome; `guest-wiring.js` owns every push). A non-tab, non-popup contents (chrome, sheet, find, DevTools frontend, an internal `goldfinch://` guest) resolves partition to a named sentinel constant (`NO_PARTITION`), is answered by the same rule (never remembered → `false`), and stamps nothing. `keyFor(partition, host, port, fingerprint)`
  → `${partition}\n${host}:${port}\n${fingerprint}`. `handleCertificateError
  (wc, url, error, certificate, callback, isMainFrame)`: resolve partition
  (registry tab entry → popup record → `null`); compute key; `let decision = false; try { decision = has(key) === true } catch (e) { logger.error(...); decision = false } finally { callback(decision) }` — ONE `callback(` site, and a `try/finally` WITHOUT a `catch` is NOT acceptable (it re-throws after the callback, straight into Electron's top-level event dispatch); the stamp block that follows is wrapped in its own `try/catch` (a throwing `stripNetPrefix`/`summarizeCertificate` must never escape). `handleCertificateError` never throws, full stop. Then, only for a registry TAB entry with `isMainFrame`: on refusal
  stamp `entry.certFailure = { url, host, port, error: stripNetPrefix(error),
  fingerprint, summary }`, on allow stamp `entry.certOverride = { host, port,
  fingerprint, error }`. Never throws out. No `fs`/`app-db`/`settings-store`
  imports. `allow(key)` exists with ZERO callers in `src/` after this leg.
- `src/main/cert-observer.js` (new, Electron-free): `createCertObserver({
  cap = 256, summarize })` → `{ procFor(partition), lookup(partition,
  hostname), clearPartition(partition) }`; per-partition LRU Map (delete +
  re-set on hit; evict oldest at cap); the proc: `try { record } catch (e)
  { logger } finally { callback(-3) }` — the ONLY `callback(` literal is
  `-3`. Installed in `onSessionCreated` beside `applyShields` (`:254`),
  BEFORE the jar-lookup block; partition = `partitionFromStoragePath(
  session.storagePath) ?? 'default'`.
- `src/main/certificate-summary.js` (new, pure): `summarizeCertificate(cert,
  { status, error })` → strings-only `{ subject: { commonName, organization,
  locality, state, country }, issuer: {…}, validFrom, validTo (ISO),
  serial, fingerprints: { sha256, sha1 }, san: string[] (≤ 25 + '+N more'),
  chain: [{ subject, issuer }] (≤ 10), knownRoot, status, error? }` via
  `new X509Certificate(cert.data)`; on parse failure fall back to Electron's
  fields with `fingerprints.sha256 = cert.fingerprint`; never throws.
- `guest-wiring.js`: `did-fail-load` folds `entry.certFailure` (when set and
  the failure name starts with `ERR_CERT_`) into `entry.loadFailure.cert =
  { host, port, error, overridable, summary }` (`overridable` from
  `classifyCertError`), then clears `entry.certFailure`; `did-start-
  navigation` (non-`chrome-error:` main frame) clears `certFailure` and
  `certOverride`; `did-navigate` sets `entry.certificate = observer.lookup(
  partition, hostname)` (or `null`) and `entry.security =
  deriveSecurityState(...)`, then pushes `tab-security { wcId, security }`
  after `tab-did-navigate`. Adopt re-push sends `tab-security` beside
  `tab-load-failure`.
- `app-lifecycle.js`: `app.on('certificate-error', …)` top-level,
  `event.preventDefault()`, delegate. `main.js`: construct `certTrust`,
  `certObserver`, thread into guest-wiring, session-runtime,
  jar-data-lifecycle, jar-registry-ipc deps.
- Chrome: `load-failure-controller.js` `render()` branches on
  `failure.cert` (title/body from `classifyCertError(failure.cert.error)`;
  the code line `ERR_CERT_AUTHORITY_INVALID (-202)` unchanged; Retry shown;
  a CSS hook `data-failure-kind="cert"` on `#load-failure-surface` for leg
  4's styling); `site-security-controller.js` subscribes
  `bridge.onTabSecurity` and stores `tab.security`; `tab-controller.js`
  `listTabs()` → `loadState: CERT_BLOCKED` when `t.loadFailure?.cert`, plus
  `security: t.security ?? 'none'`; `tabs.js` passes `security` through
  (default `'none'`); `mcp-tools.js` description + `docs/mcp-automation.md`
  document `cert-blocked` and `security`.
- Preload `onTabSecurity`; `renderer-globals.d.ts`; `window-registry.js`
  typedef; `scripts/insecure-tls-flag.mjs` header refreshed.
- Tests (all on `node --test`): `load-failure.test.js` (+ cert table incl.
  `overridable`, `CERT_BLOCKED`, `stripNetPrefix`); `site-security.test.js`
  (derivation truth table, every branch); `cert-trust.test.js`
  (exactly-once under a throwing `has`/stamp; refused vs remembered; key
  shape; popup partition; non-main-frame → no stamp; non-tab contents →
  refuse, no stamp; `clearPartition`; source-scan: one `callback(` site, no
  storage imports, zero `allow(` callers in `src/`); `cert-observer.test.js`
  (LRU cap/eviction/hit-refresh; always `-3` incl. when `summarize` throws;
  source-scan: only `-3`); `certificate-summary.test.js` (an embedded
  self-signed test PEM constant → fields; garbage → fallback; SAN/chain
  caps); `guest-wiring.test.js` (cert fold, clears, `certificate`/`security`
  stamp + `tab-security` push order); `register-tab-ipc.test.js` (adopt
  re-push); `session-snapshot*.test.js` + `closed-tab-capture.test.js`
  (object-shape pins: output keys exactly the allowlisted set);
  `automation-tabs.test.js` (`security` mapping, `cert-blocked` passthrough); `load-failure-controller.test.js` (cert branch, on the shared fake DOM); `jar-data-ipc.test.js` + `jar-registry-ipc.test.js` (clears, ordering before the fail-hard calls); `session-runtime` test (observer installed before the
  jar lookup; internal session never gets one); `app-lifecycle` test
  (`certificate-error` registered, `preventDefault` called, delegate
  invoked).

## Acceptance Criteria

- [x] **AC1 — answered exactly once, synchronously, never throws.** `cert-trust.js` has exactly one `callback(` call site inside a `finally` guarded by a `catch`; the unit test shows the callback invoked once AND `handleCertificateError` returning without throwing when `has` throws, when the stamp throws, on refusal, and on a remembered key.
- [x] **AC2 — refuse-or-remember.** Unremembered key → `callback(false)` and,
      for a main-frame TAB entry, `entry.certFailure` stamped; remembered key
      (set through `allow` in the test) → `callback(true)` and
      `entry.certOverride` stamped; subframe/non-tab → answered, nothing
      stamped; popup → partition from `popupRegistry.getByWcId`.
- [x] **AC3 — the panel says why.** Live: navigating to
      `https://127.0.0.1:{T}/` renders the panel with `classifyCertError`'s
      `authority` title/body, the address, `ERR_CERT_AUTHORITY_INVALID (-202)`,
      Retry visible, `#load-failure-surface[data-failure-kind="cert"]`;
      `readAxTree(chromeWcId)` exposes heading + Retry; unit-pinned in the
      controller test.
- [x] **AC4 — census.** `enumerateTabs` reports `loadState: "cert-blocked"`,
      `loadError.name` `ERR_CERT_AUTHORITY_INVALID`, `security: "none"` for
      that tab; a plain `http://` fixture tab reports `security: "insecure"`;
      `about:blank` → `"none"`; the admin listing's `goldfinch://settings`
      tab → `"internal"`. `docs/mcp-automation.md` and the tool description
      updated.
- [x] **AC5 — observer always defers.** `cert-observer.js`'s only
      `callback(` literal is `-3` (source-scan); the proc never throws
      (throwing `summarize` → logged, `-3` still called); LRU cap 256 with
      eviction and hit-refresh unit-pinned; installed in `onSessionCreated`
      BEFORE the `if (!jarEntry) return` (test: a session with no jar entry
      still gets `setCertificateVerifyProc` called; the internal session
      never does).
- [x] **AC6 — security state.** `deriveSecurityState` truth table pinned
      (every DD7 branch); `did-navigate` stamps `entry.certificate` and
      `entry.security` and pushes `tab-security` AFTER `tab-did-navigate`;
      `did-start-navigation` clears `certFailure`/`certOverride`; adopt
      re-pushes `tab-security`.
- [x] **AC7 — nothing persists.** `cert-trust.js` and `cert-observer.js`
      import no `fs`/`app-db`/`settings-store` (source-scan); the snapshot
      and closed-tab per-tab literals are pinned to their exact key sets.
- [x] **AC8 — `allow` has no caller.** `grep -rn "\.allow(" src/` → no hit
      referencing `certTrust`; pinned in `cert-trust.test.js`'s source scan
      (the pin is INVERTED by leg 3 when the proceed handler lands — name
      the test so the rename documents the intent shift).
- [x] **AC9 — clears.** `wipeJarData` (reached by BOTH `jar-data-ipc.js:166` `handleWipe` — the Jars page's Wipe button — and `jar-registry-ipc.js:113` `handleRemove`) calls `clearPartition` on both modules FIRST, before the fail-hard `clearStorageData()`/`clearCache()` calls (`jar-data-lifecycle.js:18-22`), so trust is dropped even when a storage clear throws; fail-soft try/catch around the clears; unit-pinned through `jar-data-ipc.test.js` (handleWipe) and `jar-registry-ipc.test.js` (handleRemove).
- [x] **AC10 — gates.** `npm test -- --test-timeout=60000`, `npm run lint`, `npm run typecheck`, `npm run format:check` green. Renderer budget: the seed controller's construction (`renderer.js:897-904`) must gain `bridge: window.goldfinch` and `findTabByWcId` (two keys — the `createLoadFailureController` precedent at `:650-657`; a background tab's `tab-security` push cannot be resolved through `activeTab()`), and the file has ONE line of headroom (1791 / 1792). Re-pin `RENDERER_LINE_BUDGET` to the measured post-Prettier count (≤ 1796) with the standard justification — a named, bounded bump for two dependency keys, not glue; the leg adds no other renderer line.

## Verification Steps

- AC1/AC2/AC5/AC7/AC8: `node --test test/unit/cert-trust.test.js
  test/unit/cert-observer.test.js test/unit/certificate-summary.test.js`;
  `grep -n "callback(" src/main/cert-trust.js src/main/cert-observer.js`;
  `grep -rn "require('fs')\|app-db\|settings-store" src/main/cert-trust.js
  src/main/cert-observer.js` → empty.
- AC3/AC4: live — launch (leg-1 rules), `serve-tls.mjs --port {T}`,
  `openTab` the fixture URL, `captureScreenshot(chromeWcId)` +
  `readAxTree(chromeWcId)`, `enumerateTabs`; open `http://{L}:{P}/` (a
  `python3 -u -m http.server {P} --bind 127.0.0.2`) and `about:blank`;
  `enumerateTabs` again; paste the census rows (redact nothing — no secrets
  in them) into the flight log.
- AC6: `node --test test/unit/guest-wiring.test.js test/unit/site-security.test.js
  test/unit/register-tab-ipc.test.js`.
- AC9: `node --test test/unit/jar-data-ipc.test.js test/unit/jar-registry-ipc.test.js` (there is no `jar-data-lifecycle.test.js`; both handlers reach `wipeJarData`).
- AC10: the four gates.

## Implementation Guidance

1. **Shared models first** (`load-failure.js`, `site-security.js`) with
   their truth-table tests — the rest of the leg imports them.
2. **`certificate-summary.js`**: build the embedded test PEM once with
   `openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=goldfinch-test" -addext "subjectAltName=DNS:goldfinch-test,IP:127.0.0.1"`
   under the scratchpad and paste the PEM into the test as a constant
   (fixture constant, not a golden file). Cap every array; every field a
   string; date fields ISO-8601.
3. **`cert-trust.js` and `cert-observer.js`** in the `auth-challenges.js`
   injected-deps shape (Electron-free; `logger` injected). Write the source-
   scan tests with `test/helpers/source-scan.js`'s `maskComments` (see
   `tab-drag-zone.test.js:18`) so a comment mentioning `callback(true)`
   cannot fool the pin.
4. **Wire main**: `main.js` constructs both, threads them; `app-lifecycle.js`
   registers `certificate-error` beside `login` with the same top-level
   rationale comment; `session-runtime.js` installs the proc at `:254`;
   `guest-wiring.js` stamps/folds/pushes per Outputs (keep `did-fail-load`'s
   pinned order: record → fold cert → hide → find → push); `register-tab-
   ipc.js` seeds the four new entry fields and re-pushes `tab-security` at
   adopt; `jar-data-lifecycle.js` / `jar-registry-ipc.js` clear.
5. **Chrome**: `load-failure-controller.js` cert branch + `data-failure-kind`;
   `site-security-controller.js` `onTabSecurity` → `tab.security`
   (`findTabByWcId`); `tab-controller.js` census fields; preload + d.ts.
6. **Census docs**: `mcp-tools.js` description, `docs/mcp-automation.md`
   (both places), `scripts/insecure-tls-flag.mjs` header.
7. **Live check** (AC3/AC4) with the fixture; tear down (kill by port pid;
   delete the key file). Then gates, Prettier, flight-log entry, leg status
   `landed`. No commit.

## Edge Cases

- **`certificate-error` for a subresource on an OVERRIDDEN host while the
  top frame is a different, trusted origin**: allowed (remembered key), no
  stamp, `security` stays `secure` (DD7 accepted divergence) — pin it.
- **Two rapid main-frame cert errors (redirect A→B, both bad)**: the second
  stamp overwrites `certFailure`; `did-fail-load` folds whichever is
  current — matching `validatedURL`'s host when possible; if the hosts
  differ, prefer the stamp whose `url` host equals the failure's host, else
  the latest (say which in a comment).
- **`certificate.data` empty / `X509Certificate` throws**: fallback summary,
  never a thrown error into the event dispatch.
- **Verify-proc for the DEFAULT session** (media proxy fetches): key
  `'default'`; never affects any tab entry (no tab lives on it).
- **Session teardown mid-verification**: the proc's `finally` still answers.
- **`did-navigate` for a `chrome-error:` commit**: never fires (F1 spike);
  if it did, `effectiveUrl` guards the URL — `security` for an error commit
  is `none`.
- **Never read `win.*` in `closed`-or-later handlers** — none of this leg's code runs there; the clears run on wipe/remove, not close.
- **`certificate-error` from a non-tab contents** (chrome, sheet, find overlay, DevTools frontend, an internal `goldfinch://` guest — none should ever negotiate TLS, but the app-level event reaches the handler for ANY webContents): answered `false` under the `NO_PARTITION` sentinel, nothing stamped, no throw — pinned as its own test case, distinct from the subframe case. DD6's internal-session exclusion is about the OBSERVER; the trust handler still answers.
- **Cross-window move**: `moveTabIntoWindow` moves the SAME entry object by reference (`register-tab-ipc.js:549-550`), so `certFailure`/`certOverride`/`certificate`/`security` travel with zero new code — add a one-line comment there naming the cert/security fields so a future field-by-field rebuild cannot silently drop them; the adopt `tab-security` re-push is still required (the chrome record is rebuilt).
- **`did-navigate-in-page` on an overridden page**: `security` is untouched (no push, no recompute) — pin it.
- **Session restore of a failed cert tab** (`navigationHistory.restore`): the restored load fires `certificate-error` afresh → refuse → interstitial; nothing special.
- **`@ts-check`**: add `security` (and the main-side entry fields) to the renderer `Tab` typedef (`tab-controller.js:~7-27`) and the registry typedef.

## Files Affected

- New: `src/shared/site-security.js`, `src/main/cert-trust.js`,
  `src/main/cert-observer.js`, `src/main/certificate-summary.js`
- Modified: `src/shared/load-failure.js`, `src/main/app-lifecycle.js`, `src/main/main.js`, `src/main/session-runtime.js`, `src/main/guest-wiring.js`, `src/main/register-tab-ipc.js`, `src/main/jar-data-lifecycle.js` (the clear inside `wipeJarData`, reached by `jar-data-ipc.js` `handleWipe` and `jar-registry-ipc.js` `handleRemove` — those two files change only if deps must be threaded), `test/unit/seam-contract.test.js` (`RENDERER_LINE_BUDGET` re-pin),
  `src/main/window-registry.js`, `src/main/automation/tabs.js`,
  `src/main/automation/mcp-tools.js`, `src/preload/chrome-preload.js`,
  `src/renderer/renderer-globals.d.ts`,
  `src/renderer/chrome/load-failure-controller.js`,
  `src/renderer/chrome/site-security-controller.js`,
  `src/renderer/chrome/tab-controller.js`, `docs/mcp-automation.md`,
  `scripts/insecure-tls-flag.mjs`
- Tests: new `site-security.test.js`, `cert-trust.test.js`,
  `cert-observer.test.js`, `certificate-summary.test.js`; extended
  `load-failure.test.js`, `guest-wiring.test.js`, `register-tab-ipc.test.js`,
  `session-snapshot*.test.js`, `closed-tab-capture.test.js`,
  `automation-tabs.test.js`, `load-failure-controller.test.js`,
  `site-security-controller.test.js`, the session-runtime / app-lifecycle /
  jar-lifecycle tests
- `missions/20-no-silent-failures/flights/02-tls-trust/flight-log.md`

## Citation Audit

2026-09-15, against HEAD `4e4117f` plus leg 1's uncommitted tree:
`app-lifecycle.js:70/:96-112`; `main.js:1673-1702`; `guest-wiring.js:447/
:460/:468/:496/:527/:532/:542`; `register-tab-ipc.js:183-191/:639/:928`;
`session-runtime.js:39/:254/:267`; `jar-data-lifecycle.js:20`;
`jar-registry-ipc.js:88`; `popup-registry.js:73`; `tab-controller.js:1212-
1213`; `tabs.js:41-66`; `mcp-tools.js:133`; `chrome-preload.js:348/:357`;
`renderer-globals.d.ts:492-501`; `window-registry.js:36-42`;
`session-snapshot.js:42-51`; `closed-tab-capture.js:70-85`;
`insecure-tls-flag.mjs:7`; `electron.d.ts` ranges as in the flight spec.
Design review (Developer, 2026-09-15): all ranges confirmed exact except
`main.js:1673-1702` (closes at `:1704`) and the non-existent
`jar-data-lifecycle.test.js` (replaced by `jar-data-ipc.test.js` /
`jar-registry-ipc.test.js`). Re-grep before pinning.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
