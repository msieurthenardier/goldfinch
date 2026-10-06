# Sortie: Partitioned-cookie-aware third-party isolation

**Status**: in-flight

## Charter

### Outcome
With Shields' third-party cookie isolation on, embedded cross-site apps that use partitioned (CHIPS) cookies — e.g. claude.ai artifacts — load normally, while unpartitioned third-party cookies stay isolated on both the HTTP and `document.cookie` paths.

### Why Now
Every claude.ai artifact shows "This browser isn't supported" in Goldfinch. Live-traced 2026-10-01: `applyShields` (`src/main/session-runtime.js`) deletes `Cookie` and drops `Set-Cookie` on the `*.frame.claudeusercontent.com` artifact frame because it is third-party to `claude.ai`; the frame's server then serves its app bundle as `text/plain` and the frame renders the notice. Isolation off → renders; on → fails. The frame's cookies (`__Host-frame-asset-*`, `__Host-frame-rt-*`) are already CHIPS-partitioned (`top_frame_site_key = https://claude.ai`), so they cannot track cross-site. The only workaround today is pausing all of Shields for the site. (Squawk 0119 / PR #244, the UA strip, was the initial wrong hypothesis.)

### Success Criteria
- [ ] A claude.ai artifact renders with Shields fully on (isolation enabled, site not paused).
- [ ] An unpartitioned third-party cookie still does not reach a cross-site frame or subresource — neither via HTTP headers nor via `document.cookie` (read or write) in a cross-site frame — proven by a fixture.
- [ ] Privacy-panel isolation accounting stays truthful: a domain is counted as cookie-isolated only when something was actually withheld.
- [ ] Unit tests pin the new rule, and a behavior spec covers the artifact-style case.

### Constraints
- No weakening of isolation for unpartitioned cookies.
- No per-site allowlist (per-site pause already exists).
- Independent of PR #244 (the UA strip) landing.

---

## Pre-Flight

### Objective
Replace Shields' header-stripping cookie isolation with Chromium's native third-party cookie blocking (`ForceThirdPartyCookieBlockingEnabled`), applied at startup from the persisted Shields config. Unpartitioned third-party cookies are then blocked on HTTP *and* `document.cookie`, while CHIPS `Partitioned` cookies, which can't track across top-level sites, keep working. That fixes claude.ai artifacts and closes the `document.cookie` hole. The privacy panel shows the restart-to-apply state truthfully, and its accounting stays honest.

### Spike evidence (planning, 2026-10-05)
Standalone Electron 44.4.4 / Chromium 152 harness (scratch, re-runnable: `scratchpad/spike3pc/run.sh`; three sites `a.test`/`b.test`/`c.test` over HTTPS; the server-observed `Cookie` header is ground truth):
- `enable-features=ForceThirdPartyCookieBlockingEnabled` (set before ready) **works**; `test-third-party-cookie-phaseout` behaves identically; `ForceThirdPartyCookieBlocking`, `ThirdPartyCookiePhaseout`, `TrackingProtection3pcd`, `--block-third-party-cookies` and Electron session APIs do nothing. Setting it after `whenReady` has no effect, so it is **restart-to-apply**. It is **process-wide**: default, `persist:` and in-memory partitions behave identically.
- ON, in a cross-site iframe: an unpartitioned Set-Cookie is not stored; an unpartitioned cookie set while the site was top-level is not sent and not visible in `document.cookie`; an unpartitioned `document.cookie` write is silently dropped. `Partitioned` cookies are stored, sent back under the same top site, and **not** sent under another top site. Cross-site `img`/credentialed `fetch` carry only partitioned-under-top cookies. **First-party cookies (None/Lax/Strict/Partitioned) are unchanged.**
- Observability: `onHeadersReceived` still sees raw 3P `Set-Cookie` (including the `Partitioned` attribute) before Chromium refuses it. `onBeforeSendHeaders` shows the Cookie header *after* filtering, so withheld cookies can't be seen there. Electron `Cookie` objects expose **no** partition key or flag. `cookies.on('changed')` doesn't fire for refused cookies. `cookies.remove(url,name)` deletes every partition's copy.
- Storage Access API: with `storage-access` granted (today's `ALLOWED_PERMISSIONS`), `requestStorageAccess()` resolves "granted" but `hasStorageAccess()` stays false and nothing unblocks, so pages are told something untrue. With it denied, the call rejects `NotAllowedError`.
- **Live pre-check (2026-10-05), run twice:** first on `squawk/0119` (UA strip present), then **re-run on `main` @ `99c4d34`**, where the UA still carries `Electron/`, so the result is independent of PR #244. Each run used the then-current code with header isolation configured off, launched with `npm run dev:automation -- --enable-features=ForceThirdPartyCookieBlockingEnabled` (exactly the post-change behavior). A real claude.ai artifact **renders**, and the log has no `text/plain` refusals for that frame. On the `main` run, the only two refusals came from a different restored artifact tab, loaded before isolate was switched off. Charter criterion 1 is de-risked. The operator's dev profile was restored afterwards (isolate on).
- **Architect probes (2026-10-05):**
  - A read-only `node:sqlite` open of WAL-mode `app.db` works under Electron 44's Node. It sees uncheckpointed WAL frames and coexists with a later read-write open. A missing file throws without creating it, and a corrupt one throws. It leaves empty `-wal`/`-shm` siblings, which the read-write open cleans up.
  - Under the feature, `session.fetch` and `webContents.downloadURL` still carry the host's own unpartitioned cookies, so the media proxy, favicons and programmatic downloads are unaffected.
  - A `sandbox="allow-scripts allow-same-origin"` cross-site frame with a `__Host-…; Partitioned` cookie round-trips.
  - `--insecure-tls-fixtures` appends `--ignore-certificate-errors`, which accepts hostname mismatches.
- Live claude.ai evidence (2026-10-01): the artifact frame's cookies `__Host-frame-asset-*`/`__Host-frame-rt-*` are stored with `top_frame_site_key = https://claude.ai`, so they are partitioned.

### Open Questions
- [x] Does native blocking exist in Electron 44, and does it keep CHIPS? Yes (spike).
- [x] Restart-to-apply acceptable? Yes (operator, 2026-10-05).
- [x] `document.cookie` in scope? Yes (operator, charter).
- [x] Does `--insecure-tls-fixtures` accept a hostname mismatch? Yes: it appends `--ignore-certificate-errors` (`scripts/insecure-tls-flag.mjs`). No SAN change is needed.
- [x] Per-site pause vs cookie isolation? **Operator ruling (2026-10-05): accept browser-wide.** See DD5.
- [x] Master Shields switch while isolation is still in force? **Operator ruling (2026-10-05): restart-pending hint plus a "Restart now" action.** See DD4 and DD11.
- [x] What the isolate row shows when paused or configured-off-but-effective? **Operator ruling (2026-10-05): show what's actually in force.** See DD6.

### Design Decisions

**DD1: Native mechanism.** Isolation is enforced by Chromium's `ForceThirdPartyCookieBlockingEnabled` feature, appended before `app.ready` when the startup Shields config resolves to isolation on (DD2).
- **Why this feature:** of the two working mechanisms, it's preferred over `test-third-party-cookie-phaseout`, whose name marks it as a test hook.
- **One switch site:** `appendSwitch('enable-features', …)` *replaces* any earlier value, so there is exactly **one** call site in `src/main/**` (grep-AC; there are none today).
- **Composing:** it merges with any operator-supplied value via `app.commandLine.getSwitchValue('enable-features')`. A pure helper composes the comma list (deduped) and is unit-tested.
- **What `isolateEffective` means:** it is the *startup decision*, not the config alone, so it tracks what Chromium is actually doing. It's computed by one pure function over the startup config and the operator's command-line switches:
  - true if `isolateConfigured(cfg)`, or if an operator-supplied `--enable-features` names the feature;
  - forced false if an operator-supplied `--disable-features` names it (Chromium's disable wins).

  The function also returns the composed `enable-features` list, and every case is unit-tested.
- *Rationale:* it's the only mechanism that covers HTTP and `document.cookie`, keeps partitioned cookies working by design, and follows Chromium's own model. Header filtering can't see partitions (spike Q4).
- *Trade-offs accepted:* restart-to-apply and process-wide (DD5).

**DD2: Pre-ready config read.** Shields loads inside `whenReady` (`initProfileAndStores` → `shields.load` → `app.db`), which is too late for the feature switch.
- **Schema single-sourcing:** add `peekDocumentReadOnly(userDataPath, store)` to `app-db.js`, so the `documents`/`store`/`payload` schema stays in one place. It opens `app.db` with `node:sqlite` **read-only** (no create, no migration, no quarantine), reads one row, and closes. Note: it can leave empty `-wal`/`-shm` siblings, which the later read-write open removes. Harmless, and documented.
- **Pure parse:** `shields.js` exports a pure `parseShieldsConfig(raw)` (no codec state) that `shields.load` also uses internally. One normalizer, drift-free.
- **Shared predicate:** one predicate, `isolateConfigured(cfg) = !!cfg.enabled && !!cfg.isolate`, matching `active()`'s truthiness. It's used by the startup reader, the IPC side and the UI model, so a malformed stored value can't cause a permanent restart hint.
- **The reader:** a new Electron-free module, e.g. `src/main/shields-startup.js` (CJS), with injected `fs`/`peek`, called at module load in `main.js`. It runs after the dev `setPath('userData')` redirect and **after** `requestSingleInstanceLock()` (the loser stays side-effect-free), and before ready.
- **Order pin:** extend `single-instance-lock-order.test.js`, or add a sibling order test.
- **Resolution order mirrors `shields.load`:** row present → parse. No row, or `app.db` unreadable/corrupt → peek legacy `shields.json` read-only → parse. Anything else → `DEFAULTS` (isolation on). **Fail-closed.**
- **Output:** the resolved config feeds DD1's pure decision, which yields the process-lifetime constant `isolateEffective`.
- **Fail-closed unit matrix:** no file; corrupt `app.db`; locked; WAL with uncheckpointed frames; legacy-json only; corrupt db plus legacy json; row present; `enabled:false`; `isolate:false`; malformed `isolate:"false"`.

**DD3: Header-level isolate stripping is removed.**
- `applyShields` stops deleting `Cookie` (`onBeforeSendHeaders`) and `Set-Cookie` (`onHeadersReceived`) for the isolate strategy. Keeping it would still kill partitioned cookies.
- `strip` (Referer, params) and `block` are untouched.
- The existing pin `session-runtime.test.js` (around line 402) that asserts stripping is rewritten as the removal pin. *Note:* PR #244 adds about 59 lines to that same test file, so whichever lands second rebases the test file. The conflict is mechanical, not semantic.

**DD4: Configured vs effective state, and the master switch.**
- **Channel:** main exposes `isolateEffective` (read-only, non-secret, never persisted) on its own bare `ipcMain.handle`, following CLAUDE.md's read-only dual-consumer rule (like `shields-get`). It needs entries in `chrome-preload.js`, `internal-preload.js` (bundle regenerated) and both `renderer-globals.d.ts` interfaces.
- **Staleness contract:** the value is a process constant, so one fetch per document load is enough and no push is needed. Chrome recovery reloads the document and re-fetches it.
- **Pure model:** a new `src/shared/shields-isolation-model.js` (indicator-model pattern; `internal-page-map.js` route for the settings page's flat specifier). It projects `(cfg, isolateEffective, paused)` into the isolate row and master-switch render model: `restartPending` (configured ≠ effective), `inForce` (= `isolateEffective`) and copy keys. It's DOM-free and unit-tested.
- **Master switch:** turning Shields **off** disables everything else immediately (unchanged). When isolation is still in force, the master switch and the isolate row show "Cookie isolation stays on until restart" in both the privacy panel (`privacy-controller.js` `pShields`) and `goldfinch://settings` (`settings.js`, Shields block). Turning isolation (or the master switch) **on** while it isn't in force shows "Restart to turn on cookie isolation". Both states offer **Restart now** (DD11).
- **Unchanged:** `shields-set` persists immediately as before.
- **Panel rebuild defect (pre-existing, fixed here):** `renderPrivacy()` clears the panel (`body.innerHTML = ''`) on every `onPrivacyNet` push, which destroys a focused toggle or Restart now button during normal network activity. That breaks CLAUDE.md's patch-in-place rule. Leg 02 patches the Shields section **in place** (or preserves focus across the rebuild), and the restart hint is **not** in a live region that re-announces on every push.
- **No `renderer.js` change:** `RENDERER_LINE_BUDGET` is at exactly 1546. The `isolateEffective` fetch lives in `privacy-controller.js` init beside `shieldsGet`. `SEAM_COUNT` stays 41.
- **Selector:** the isolate row gets `data-shield="isolate"` (and its siblings their own keys) so specs can address it. Today every row renders an anonymous `.shield-count`.

**DD5: Per-site pause no longer covers cookie isolation.** *Operator ruling, 2026-10-05: accept browser-wide.* Native blocking is process-wide, and Electron offers no per-site exception plumbing (spike).
- Pausing a site still pauses `block`/`strip`/`farble`. The isolate row reads "Applies browser-wide" while isolation is in force.
- An embed that needs unpartitioned third-party cookies is rescued only by turning isolation off and restarting. Partitioned-cookie embeds (claude.ai) no longer need rescuing.
- This is consistent with the charter's "no per-site allowlist".

**DD6: Truthful accounting and display.** *Operator ruling, 2026-10-05: show what's in force.*
- **Counting:** in `onHeadersReceived`, when `isolateEffective`, the response is not `mainFrame`, and `classify(url, firstParty).thirdParty`, the domain counts toward `cookieBlockedDomains` iff at least one `Set-Cookie` line is not a valid partitioned cookie, i.e. lacks the `Partitioned` attribute **or** lacks `Secure` (Chromium rejects `Partitioned` without `Secure`). A pure, case-insensitive attribute-token parser does the check, without matching substrings of values. It counts regardless of pause or configured state, because Chromium refuses those cookies regardless.
- **Display:** the isolate row's count and active styling key off `isolateEffective` (via the DD4 model), **not** `cfg.isolate`/`dim`. While isolation is in force the row isn't dimmed and the count shows, even on a paused site or after switching it off before a restart.
- **Footer:** the panel's "Reload to apply" footer copy no longer implies a reload applies isolation changes. Isolation changes are covered by the DD4 restart copy.
- **Known overcount:** `classify()` uses Goldfinch's vendored PSL plus `SUPPLEMENT_SUFFIX`, while Chromium uses its own PSL. A host the supplement splits can be counted as isolated even though Chromium treated it as same-site and accepted the cookie. Nested A-in-B-in-A cases undercount. Both are documented and accepted.
- **Known gap:** request-side withholding is unobservable (spike Q4). It's documented, with no guessing. Partitioned-only frames (claude.ai) are never counted.

**DD7: Storage Access is denied while isolation is in force.**
- `storage-access` and `top-level-storage-access` are refused by both the permission request handler and the check handler when `isolateEffective`, so pages get an honest `NotAllowedError` instead of a false "granted".
- With isolation off, today's allow behavior stays.
- *Shared-mechanism audit:* every other `ALLOWED_PERMISSIONS` entry is unaffected (unit-asserted). The `privacy-permission` push keeps its shape, but the panel will now list "denied — storage-access". That is expected, and an extra observable for spec step 9.

**DD8: Cookie bookkeeping and listing surfaces.** Before this change, third-party `Set-Cookie` was stripped, so partitioned cookies rarely existed. Now they're stored, and Electron's cookie API can't tell them apart (spike Q4).
- **Surfaces affected:** the privacy panel's `privacy-cookies` list (`register-browser-ipc.js`) and the `goldfinch://jars` Cookies panel (`jar-data-ipc.js`). Both will show partitioned copies as ordinary cookies, possibly as duplicate rows across partitions. Deleting one row deletes every partition's copy.
- **Retention:** `cookieSeenStore` merges partitions under `(jar,name,domain,path)`, and retention `cookies.remove` deletes all copies.
- **Accepted:** no schema change, and no partition UI (the platform gives us no partition data). Documented in CLAUDE.md's cookie/retention notes. `jar-data-surfaces` joins the DD10 re-runs.

**DD9: Apparatus (behavior spec `third-party-cookie-isolation`).**
- **Driver and fixture:** the admin MCP SDK client plus a new zero-dependency TLS fixture, `tests/behavior/fixtures/third-party-cookies/serve.mjs`. It listens on a wildcard address, so `127.0.0.2` is reachable and `localhost` resolves on IPv4 or IPv6. It serves three **distinct sites** on one port: A=`https://127.0.0.1:{fx}`, B=`https://localhost:{fx}`, C=`https://127.0.0.2:{fx}`.
- **TLS:** the fixture cert is generated locally and gitignored; `--insecure-tls-fixtures` accepts it.
- **Claude-shaped embed:** A's embed mirrors claude.ai, with `sandbox="allow-scripts allow-same-origin"` and a `__Host-…; Partitioned` cookie. Every fixture cookie carries an explicit `Max-Age`.
- **Profile isolation:** the spec runs in an **isolated profile** (`XDG_CONFIG_HOME=<scratch>`; Electron derives `appData` from it on Linux), so the operator's signed-in dev profile is never reset or left with `isolate:false`.
- **Jar:** a named `persist:` jar, never Burner.
- **Restarts:** every relaunch re-captures the `adminKey` (each `DEV_MINT` replaces the hash) and waits for the old PID to exit.
- **Act path:** `openTab`/`navigate`/`reload`/`click`, plus top-frame `evaluate` and chrome `evaluate` (`togglePrivacy(true)`, already in the evaluate seam).
- **Observe path:**
  - (1) the fixture JSONL log of cookie **names** per request: server ground truth;
  - (2) B's frame `postMessage`s its `document.cookie` names, write results and storage-access result into A's `#frame-report`, read by top-frame `evaluate`;
  - (3) the privacy panel's isolate row `.shield-count` text and the restart hint, read via chrome `evaluate`.
- **Teardown:** restore isolate and delete the scratch profile.
- **Instance scoping:** the spec's instance can coexist with the operator's own dev instance, because the isolated profile has its own lock. So every "wait for exit" and "no process remains" targets the spec's **own** main PID (the electron child of the launched wrapper, recorded at launch). Quitting uses chrome `evaluate` `window.goldfinch.appQuit()` (the normal quit path), not a signal.
- **Storage-access premise:** the storage-access button lives in an **unsandboxed** cross-site frame, because a sandbox without `allow-storage-access-by-user-activation` rejects the call regardless of policy, which would be a false pass. An isolation-off control (step 11) must show `"granted"`. Leg 01 verifies at its start that a denied `storage-access` reaches `setPermissionRequestHandler` (not only the check handler), so the `privacy-permission` push actually arrives. If it doesn't, the panel assertion in step 9 is dropped and recorded.

**DD10: Global-hook premise re-runs and the upgrade guard (CLAUDE.md rule).**
- **Leg 01 re-runs:** `core-browsing-shields`, `cross-jar-fetch-isolation`, `web-compat-pdf`, `web-compat-oauth-popup`, `download-indicator` and `jar-data-surfaces`, plus a media-panel play through the `goldfinch-media:` proxy. The Architect probe already showed main-side `session.fetch` and `downloadURL` keep first-party cookies. Any regression is fixed in-leg if it's within DD scope, otherwise logged.
- **Upgrade guard:** an unknown `enable-features` name is silently ignored, and header stripping is gone, so an Electron bump that drops the feature would make isolation fail open silently. **Add a CLAUDE.md rule** (beside the `node:sqlite` one) and a `docs/RELEASING.md` checklist line: every Electron major bump re-runs `third-party-cookie-isolation`.

**DD11: "Restart now".** *Operator ruling, 2026-10-05.*
- **What it does:** a Restart now action on the DD4 restart-pending states (privacy panel and `goldfinch://settings`) calls `app.relaunch()` and then `app.quit()` through the **normal quit path**, so the `before-quit` snapshot flush and the `will-quit` `appDb.close()` still run.
- **Channels:** two state-changing channels, one per consumer.
  - Chrome: `ipcMain.handle`, sender-validated to a registered chrome view.
  - Internal settings page: `registerInternalHandler`.
  - Each takes no page arguments. There is no MCP op for it, but admin chrome `evaluate` can reach `window.goldfinch.<restart>`, exactly as it reaches `appQuit` today. That is accepted and documented.
- **Business gate:** both handlers re-check main-side that a restart is actually pending (`isolateConfigured(shields.get()) !== isolateEffective`, using the DD1 decision) and no-op otherwise.
- **Relaunch options as a pure helper** (unit-tested):
  - delete `GOLDFINCH_AUTOMATION_DEV_MINT` from `process.env` before `app.relaunch()`. Otherwise the child re-mints and rotates every key, printing them to a stdout nobody reads (probe-verified that env edits carry over);
  - AppImage-aware: when `process.env.APPIMAGE` is set, pass `execPath: process.env.APPIMAGE`, because `process.execPath` points into the AppImage mount that vanishes when the parent exits.
- **Copy:** when `restoreSession` is false, the confirm text says open tabs won't be restored.
- **Packaged smoke:** the HAT includes clicking Restart now in a packaged AppImage (`npm run dist`), since every other check uses the unpacked dev path.
- *Dev note:* under `dev:automation` the relaunched process is detached from the npm wrapper; that's acceptable for dev. The behavior spec relaunches through its own command (DD9), not this button.

### Prerequisites
- [x] Base branch is `main`. PR #244 (UA strip) is independent and unmerged; it touches `onSessionCreated`, not `applyShields`, so conflict risk is low.
- [x] `openssl` is available for fixture cert generation (used by the web-compat fixtures).
- [x] A dev instance can be launched via `npm run dev:automation` with `GOLDFINCH_MCP_PORT` pinned plus `--insecure-tls-fixtures` (verified 2026-10-05).
- [x] The operator is signed in to claude.ai on the dev profile, which is preserved because the spec uses an isolated profile.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Architect design review passed (round 1: approve with changes; round 2: approve with changes. Both incorporated. Max 2 rounds reached.)
- [x] Behavior spec drafted (`tests/behavior/third-party-cookie-isolation.md`)

### Legs
1. **`01-native-cookie-isolation`** (main side):
   - DD1 and DD2: switch composer, read-only peek, `parseShieldsConfig`, `isolateConfigured`, startup reader, order pin.
   - DD3: removal pin.
   - DD6: counting and parser.
   - DD7: storage-access gating.
   - DD4 main half: the `isolateEffective` channel plus preload and typings.
   - DD8: docs.
   - DD9: fixture.
   - DD10: re-runs, plus the CLAUDE.md/RELEASING guard.
   - Runs behavior-spec steps 1–9 and the restart control's **cookie** assertions only (steps 10–12, minus the restart-hint, not-dimmed and `data-shield` row assertions, which belong to Leg 02).
   - *Sizing note:* this leg is heavy. If context strains, land the fixture plus DD10 re-runs as a separate commit step within the leg.
2. **`02-isolation-panel-ux`** (chrome and settings UI):
   - DD4 UI half: the `shields-isolation-model.js` model, privacy panel and `goldfinch://settings` copy, master-switch restart-pending.
   - DD6 display: count and dimming keyed to in-force, plus the footer copy.
   - DD5: browser-wide note.
   - DD11: Restart now, plus its two channels.
   - The **full** behavior-spec run, including the hint assertions.
   - Panel patch-in-place fix (DD4).
   - Accessibility review: live-region and announcement audit of the shared panel refresh cycle (CLAUDE.md shared-mechanism rule). Before relying on `npm run a11y --target=goldfinch://settings`, pre-check that target mode works under admin (the script's own comment says it can't; `observe.js` suggests it now can). If not, the gate is the default sweep's `privacy-panel` state.
   - No `renderer.js` edits.
3. **`03-hat-claude-artifacts`** (**mandatory HAT**; the live verification of criterion 1). The operator, signed in on the dev profile, opens real claude.ai artifacts with Shields fully on and walks:
   - isolate off → Restart now → artifact still works → isolate on → Restart now;
   - master switch off and on, with the restart-pending copy;
   - the panel copy for a paused claude.ai;
   - one other cookie-heavy embed of the operator's choosing;
   - one second window (a shared-state check);
   - Restart now in a **packaged AppImage** build (`npm run dist`).

### Verification
- **Unit:**
  - the startup reader fail-closed matrix (DD2);
  - the `enable-features` composer and its one-site grep-AC;
  - the order pin;
  - the `Partitioned` parser;
  - the accounting decision;
  - storage-access gating plus the other-permissions-unaffected assertion;
  - the header-stripping removal pin;
  - `shields-isolation-model` (restartPending/inForce/copy for every `(cfg, effective, paused)` combination);
  - the Restart now channel guards and business gate;
  - the relaunch-options helper (DEV_MINT strip, APPIMAGE execPath);
  - the `isolateEffective` decision, including operator `--enable-features`/`--disable-features`;
  - the `Partitioned`-plus-`Secure` parser cases.
- **Behavior:** `/mission-control:behavior-test third-party-cookie-isolation` (criteria 2–3 at fixture level, plus the restart-to-apply control). Partial in Leg 01, full in Leg 02.
- **HAT:** real claude.ai artifacts (criterion 1, live). Pre-checked 2026-10-05 under the CLI flag.

---

## In-Flight
*(see flight-log.md)*

## Post-Flight
- [ ] Charter criteria checked
- [ ] Flight debrief: `/mission-control:flight-debrief sortie 02`
