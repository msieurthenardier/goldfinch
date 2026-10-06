# Leg: native-cookie-isolation

**Status**: completed
**Flight**: [Partitioned-cookie-aware third-party isolation](../flight.md)

## Objective
Replace Shields' header-stripping cookie isolation with Chromium's native third-party cookie blocking. This covers:
- a startup decision taken before `app.ready` from the persisted config;
- honest accounting;
- storage-access gating;
- a read-only effective-state channel;
- a fixture-backed behavior run;
- the global-hook regression re-runs and the upgrade guard.

## Context
- Flight DDs in scope: DD1, DD2, DD3, DD4 (main half only: the channel, preload entries and typings), DD6 (counting only; display is Leg 02), DD7, DD8 (docs), DD9 (fixture and the partial spec run), DD10.
- DD5, DD11 and the UI parts of DD4/DD6 are Leg 02. **No renderer UI changes in this leg**, and no `src/renderer/renderer.js` edits at all.
- Planning spike (`flight.md` → Spike evidence): `enable-features=ForceThirdPartyCookieBlockingEnabled` must be set before ready. It is process-wide and restart-only. Electron cookie objects carry no partition data. `onHeadersReceived` still sees raw 3P `Set-Cookie`.
- Live pre-check: a real claude.ai artifact renders on `main` with native blocking and header isolation off.
- Branch `sortie/02-partitioned-cookie-isolation`, cut from `main` @ `99c4d34`. PR #244 (UA strip) is NOT on this branch.

## Inputs
- `src/main/main.js`: dev `setPath('userData')` redirect, then `requestSingleInstanceLock()` (`const gotSingleInstanceLock = …`), then `crashReporter.start(`, …, `createSessionRuntime({` (the `const sessionRuntime = createSessionRuntime({` site), then `registerAppLifecycle({`. There is no `appendSwitch('enable-features'` anywhere in `src/main/**`.
- `src/main/shields.js`: `DEFAULTS` (with `isolate: true`), `parseAndRepair(raw)` (codec-stateful, never throws), `load()` (row → legacy `shields.json` → `DEFAULTS`), `active(strategy, site)` (truthiness).
- `src/main/app-db.js`: `FILE_NAME = 'app.db'`, `documents(store, payload, updated_at)`, the `selectDoc` SQL `SELECT payload FROM documents WHERE store = ?1`, and `attemptOpen` (sets WAL).
- `src/main/session-runtime.js`:
  - `createSessionRuntime(deps)` and `ALLOWED_PERMISSIONS` (includes `storage-access` and `top-level-storage-access`);
  - `applyShields`: the `onBeforeSendHeaders` isolate block deletes `headers.Cookie` and marks `cookieBlockedDomains`; the `onHeadersReceived` isolate block deletes `set-cookie`;
  - the request and check permission handlers.
- `src/main/register-settings-ipc.js`: the `shields-get` (bare) / `internal-shields-get` (`registerInternalHandler`) pair.
- `src/preload/chrome-preload.js` (`shieldsGet`), `src/preload/internal-preload.js` (`shieldsGet` → `internal-shields-get`), and `src/renderer/renderer-globals.d.ts` (both bridge interfaces).
- `test/unit/session-runtime.test.js`, test `'Shields pipeline strips tracking URLs and isolates third-party request/response cookies'`, which pins header stripping. `test/unit/single-instance-lock-order.test.js`.
- `tests/behavior/third-party-cookie-isolation.md` (draft spec); `tests/behavior/fixtures/web-compat/` (zero-dep fixture and `gen-certs.mjs` conventions; `certs/` gitignored).

## Outputs
- **New** `src/main/third-party-cookies.js` (CJS, `// @ts-check`, Electron-free, pure). It exports:
  - `FEATURE` = `'ForceThirdPartyCookieBlockingEnabled'`;
  - `decideStartup({ configured, enableFeatures, disableFeatures })` → `{ isolateEffective, enableFeatures }`. Rules:
    - the composed comma list adds `FEATURE` iff `configured`, deduped, with operator entries preserved;
    - `isolateEffective` = (`configured` OR the operator list names `FEATURE`) AND NOT (the operator's `disableFeatures` names `FEATURE`);
    - when disabled, the composed list need not change, because Chromium's disable wins;
    - **feature-list syntax:** entries are split on `,`, trimmed, and empty entries dropped. An entry's **name** is everything before the first `:` or `<` (Chromium's `Name:param/val` and `Name<Trial` forms), so `ForceThirdPartyCookieBlockingEnabled:x/y` names `FEATURE`;
    - it also returns `operatorOverride`: `'disabled'` if the operator disable list names `FEATURE`, else `'enabled'` if the operator enable list names it, else `null`;
    - *Note:* `getSwitchValue` returns one value; a repeated `--enable-features` is outside our control (documented, not handled);
  - `isValidPartitionedSetCookie(line)`: true iff the attribute tokens (after the first `;`) include `Partitioned` **and** `Secure`, matched case-insensitively and whitespace-tolerantly on attribute **names** only, never on substrings of values;
  - `refusedThirdPartySetCookie(setCookieLines)`: true iff any line is not a valid partitioned cookie.
- **New** `src/main/shields-startup.js` (CJS, `// @ts-check`, Electron-free, injected deps): `readStartupShieldsConfig({ userDataPath, peek, fs })`. It mirrors `shields.load`'s resolution order: row → legacy `shields.json` (read-only, never renamed) → `DEFAULTS`. A thrown or corrupt `app.db` falls through to the legacy peek. **Never throws.**
- `src/main/app-db.js`: new `peekDocumentReadOnly(userDataPath, store)`. If `app.db` doesn't exist it returns `null` without creating anything. Otherwise it opens `new DatabaseSync(path, { readOnly: true })`, runs the same `selectDoc` SQL text, closes in `finally`, and returns the payload or `null`. It **throws** on open or read failure (the caller decides). It has no WAL pragma and no migration.
- `src/main/shields.js`: exports a pure `parseShieldsConfig(raw, deserialize = JSON.parse)` (merged over `DEFAULTS`, `pausedSites` normalized, never throws). `parseAndRepair` becomes `parseShieldsConfig(raw, codec.deserialize)`: one normalizer, no branch on codec identity. It also exports `isolateConfigured(cfg)` = `!!cfg.enabled && !!cfg.isolate`.
- `src/main/main.js`, after the single-instance lock block and before `crashReporter.start(`:
  - one block computes the startup config via `readStartupShieldsConfig`, then `decideStartup(...)` with `app.commandLine.getSwitchValue('enable-features')` / `('disable-features')`;
  - it calls `app.commandLine.appendSwitch('enable-features', composed)` **only** when the composed list is non-empty and differs from the operator value (the only `appendSwitch('enable-features'` in `src/main/**`);
  - it holds `isolateEffective` in a module const, threaded into `createSessionRuntime` deps and `registerSettingsIpc` deps.
- `src/main/session-runtime.js`:
  - **(DD3)** the isolate branches of `onBeforeSendHeaders` (Cookie deletion) and `onHeadersReceived` (Set-Cookie deletion) are removed. The Referer `strip` branch is untouched.
  - **(DD6)** `onHeadersReceived` instead runs: when `isolateEffective && details.resourceType !== 'mainFrame' && classify(details.url, firstParty).thirdParty` and the response's `set-cookie` lines (any header-name case) satisfy `refusedThirdPartySetCookie`, set `aggregate.cookieBlockedDomains[classification.domain] = 1` and `schedulePrivacySend`. This is **independent of pause and of `shields.active('isolate', …)`**. Response headers pass through **unmodified**.
  - **(DD7)** when `isolateEffective`, both the request handler and the check handler deny `storage-access` and `top-level-storage-access`. Everything else in `ALLOWED_PERMISSIONS` behaves as before. The `privacy-permission` push shape is unchanged; it now carries `granted:false` for these.
- `src/main/register-settings-ipc.js`: a new bare `ipcMain.handle('shields-isolation-state', () => ({ isolateEffective, operatorOverride }))`. With `operatorOverride`, Leg 02 can compute *restart-pending* as "would a restart change anything": `decideStartup` over the **current** configured value plus the same override, compared with `isolateEffective`. So an operator `--disable-features` never yields a permanent hint. The handler is plus `registerInternalHandler(ipcMain, 'internal-shields-isolation-state', …)`, mirroring the `shields-get` pair. Both are read-only and non-secret. `test/unit/register-settings-ipc.test.js` pins the exact sorted bare and internal channel lists, so add both names there. `test/unit/helpers/settings-ipc-harness.js` gains the `isolateEffective` and `operatorOverride` deps.
- Preloads and typings:
  - `chrome-preload.js`: `shieldsIsolationState()`.
  - `internal-preload.js`: `shieldsIsolationState()` → the internal channel. Bundles are rebuilt automatically by `prestart`/`pretest` (`build:preload`), so no manual step is needed.
  - `renderer-globals.d.ts`: both interfaces gain the method.
- **New fixture** `tests/behavior/fixtures/third-party-cookies/`: `serve.mjs`, `gen-certs.mjs` (or reuse web-compat's generator into its own gitignored `certs/`), `README.md` and a `.gitignore` for `certs/`. Behavior:
  - It listens on `0.0.0.0` (or dual-stack `::`) with TLS and serves the hosts and paths the spec names: `/health`, `/b/set-fp`, `/a/embed` (with `?b=part-only`), `/b/frame` (with `?report-only=1`), `/b/sa-frame`, `/b/pixel`, `/b/api`, `/c/embed`, `/a/set-fp`.
  - Every cookie carries `Max-Age=3600`. The claude-shaped frame uses `sandbox="allow-scripts allow-same-origin"` and a `__Host-b_part` partitioned cookie; the `sa-frame` is **unsandboxed**.
  - The relay `postMessage`s reports to the embedder's `#frame-report`.
  - It writes a JSONL log of `{ ts, host, path, cookieNames, setCookieNames }`, **names only**.
- `tests/behavior/third-party-cookie-isolation.md`: corrected wherever implementation reality differs (paths and selectors), with Status left `draft`.
- `CLAUDE.md`:
  - The Shields cross-cutting line: isolation is native (`ForceThirdPartyCookieBlockingEnabled`), decided before ready from the persisted config, process-wide, restart-to-apply, and `isolateEffective` is a process constant.
  - The App database / retention notes: partition copies merge in `cookieSeenStore`, `cookies.remove` deletes every partition's copy, and the listing surfaces show partition copies as plain rows (DD8).
  - **Beside the `node:sqlite` rule:** every Electron major bump re-runs `third-party-cookie-isolation`, because an unknown feature name is silently ignored and isolation would fail open.
- `docs/RELEASING.md`: the doc has no checklist, so add a short **"Electron major bump"** subsection in the "Notes" area, beside the PSL freshness steps, stating the rule. CLAUDE.md's `node:sqlite` rule is the App database paragraph.

## Acceptance Criteria
- [ ] **AC1** `decideStartup` unit matrix passes:
  - configured on/off × operator `enable-features` (absent / names FEATURE / other features) × operator `disable-features` (absent / names FEATURE);
  - the composed list keeps operator entries, is deduped, and has no empty entries;
  - syntax cases: whitespace, empty entries, `FEATURE:p/v` and `FEATURE<Trial` recognized as naming FEATURE, and a similar-prefix name (`FEATUREX`) not;
  - `operatorOverride` is correct for every combination;
  - `isolateEffective` follows the rule exactly.
- [ ] **AC2** `isValidPartitionedSetCookie` / `refusedThirdPartySetCookie` unit cases pass:
  - `Partitioned; Secure` valid, any case, any spacing;
  - `Partitioned` without `Secure` invalid;
  - no attributes invalid;
  - a value containing the text `Partitioned` (e.g. `x=Partitioned; Secure`) invalid;
  - `SameSite=None; Secure` without `Partitioned` invalid;
  - multi-line arrays: any invalid line makes the response refused;
  - an empty or missing list is not refused.
- [ ] **AC3** `readStartupShieldsConfig` fail-closed matrix passes, using real temp dirs and a real `node:sqlite` `app.db` built with `app-db.open` (the same schema):
  - no `app.db` and no legacy file → DEFAULTS, and **no `app.db` file is created**;
  - row present with isolate false → isolate false;
  - row with `enabled:false` → `isolateConfigured` false;
  - corrupt `app.db` (garbage bytes) and no legacy → DEFAULTS;
  - corrupt `app.db` plus legacy `shields.json` with isolate false → isolate false, and the legacy file is **not** renamed;
  - legacy only → parsed;
  - WAL-mode db with uncheckpointed frames (written via a still-open read-write handle) → the latest row is seen;
  - malformed `isolate: "false"` → `isolateConfigured` treats it as truthy, consistently with `active()`, asserted explicitly;
  - **locked:** a read-write handle holds `BEGIN EXCLUSIVE` and the reader still doesn't throw (it either reads, or falls through to legacy/DEFAULTS; assert the documented outcome);
  - `app.db` exists but has no `documents` table → falls to legacy/DEFAULTS;
  - the reader never throws.
- [ ] **AC4** `peekDocumentReadOnly` unit cases:
  - missing file → `null`, no file created;
  - present → payload;
  - absent store → `null`;
  - corrupt → throws;
  - read-write `app-db.open` succeeds afterwards on the same path (the coexistence/cleanup premise);
  - when `app.db` is absent, **no** `app.db`, `-wal` or `-shm` file appears;
  - a source-scan pin asserts `readOnly:\s*true` appears in `peekDocumentReadOnly`'s body, mutation-verified with `assertMutated`. A lowercase `readonly` is silently accepted by `node:sqlite` and opens read-write, so behavior tests alone can't catch the typo.
- [ ] **AC5** Startup order pin (source-scan over comment-masked `main.js`, regex-target mutation style with `assertMutated`, wrap-insensitive):
  - exactly one `appendSwitch('enable-features'` across **every** file in `src/main/**`, each scanned with `maskComments`;
  - the startup block sits after the dev `setPath('userData'` redirect, after `requestSingleInstanceLock(`, before `crashReporter.start(` and before `registerAppLifecycle(`, at **module top level** (not inside `whenReady` or any function);
  - neuter-verified: moving the block before the lock turns the pin red.
- [ ] **AC6** DD3 removal pin: the existing `session-runtime.test.js` stripping test is **renamed and inverted** (rename, don't delete and re-add). With isolate active, a third-party subresource's `Cookie` request header and `Set-Cookie` response headers pass through **unchanged**. The tracking-URL strip and Referer assertions are kept.
- [ ] **AC7** DD6 accounting unit tests (fake session, as existing tests do):
  - with `isolateEffective` true, a third-party `subFrame` response with an unpartitioned Set-Cookie marks its domain, so `cookiesBlocked` = 1 in the serialized aggregate;
  - a response with only valid partitioned cookies does not mark;
  - `mainFrame` does not mark;
  - first-party does not mark;
  - `isolateEffective` false does not mark;
  - a paused site with `isolateEffective` true **does** mark;
  - robustness: `webContentsId` undefined (worker requests) or no aggregate → no throw, no mark; `classification.domain` missing → no mark; `set-cookie` as a bare string (not an array) is normalized; `responseHeaders` undefined or no `set-cookie` → no throw;
  - pass-through: the callback's `responseHeaders` `deepEqual` the original object, for third-party and first-party alike.
- [ ] **AC8** DD7 permission tests: with `isolateEffective` true, both handlers deny `storage-access` and `top-level-storage-access`, and every other `ALLOWED_PERMISSIONS` entry is still granted (loop over the set). With `isolateEffective` false, behavior is identical to today.
- [ ] **AC9** The `shields-isolation-state` / `internal-shields-isolation-state` pair returns `{ isolateEffective }` (unit test against the register module with a fake `ipcMain`, following existing register-*-ipc tests). The preload methods and both `.d.ts` entries exist; `npm run typecheck` passes.
- [ ] **AC10** Premise check at leg start, recorded in the flight log: in a live dev instance on this branch, does a denied `storage-access` reach `setPermissionRequestHandler`, or only the check handler? If only the check handler, step 9's panel-list assertion is struck from the spec and the reason recorded. Record which case happened either way.
- [ ] **AC11** *(The sole proof of the DD1/DD2 startup path. AC1–AC5 test components only, and the `main.js:219` ozone note shows that a before-ready `appendSwitch` isn't guaranteed for every switch, so steps 10–12 are mandatory and can't be waived.)* Behavior spec, partial run via `/mission-control:behavior-test third-party-cookie-isolation`, run by the Flight Director after the Developer lands the leg. Steps 1–9 pass. Steps 10–12 pass on their **cookie / log / storage-access** expectations. The restart-hint, not-dimmed and `data-shield`-dependent assertions are recorded as deferred to Leg 02 (step 8 may use a `.shield-lbl`-text-scoped selector in this leg).
- [ ] **AC12** DD10 re-runs. The following pass or are dispositioned in the flight log: `core-browsing-shields`, `cross-jar-fetch-isolation`, `web-compat-pdf`, `web-compat-oauth-popup`, `download-indicator`, `jar-data-surfaces`, and a media-panel play through the `goldfinch-media:` proxy. The Flight Director runs these after landing. The Developer confirms each spec's fixture and launch recipe is still valid on this branch.
- [ ] **AC13** `npm run format:check`, `npm run lint`, `npm run typecheck` and `npm test` all pass. `CLAUDE.md` and `docs/RELEASING.md` are updated as listed in Outputs.

## Verification Steps
- AC1–AC9, AC13: `npm test` (the new and updated unit files), `npm run lint`, `npm run typecheck`, `npm run format:check`. For AC5, a neuter mutation in the test itself.
- AC10: in a live dev instance, log or observe a permission-request-handler call for `storage-access` from a cross-site frame click, using the new fixture's `sa-frame`.
- AC11/AC12: `/mission-control:behavior-test <slug>` run logs under `tests/behavior/<slug>/runs/`, referenced in the flight log.

## Implementation Guidance
1. **Pure modules first.** Write `third-party-cookies.js` and its tests. `decideStartup` must handle `getSwitchValue` returning `''` (absent).
2. **`peekDocumentReadOnly`.** `fs.existsSync` gates creation. Open with `{ readOnly: true }` (Node 22+/Electron 44 `node:sqlite` supports it; the Architect probed it). Don't call `attemptOpen` or set pragmas. Reuse the SQL text as a module constant shared with `prepareStatements` (single-sourced).
3. **`parseShieldsConfig`.** Factor it out of `parseAndRepair` without changing `parseAndRepair`'s observable behavior; existing shields tests must stay green. `isolateConfigured` lives in `shields.js`, beside `active`.
4. **Placement in `main.js`.** Insert right after the lock block's closing `}`, with a comment citing sortie 02 DD1/DD2 in the house comment style.
   - `userDataPath` is `app.getPath('userData')`, already redirected.
   - Keep the module-level binding a `const` declared **above** every use: `createSessionRuntime` and `registerSettingsIpc` are both far below, so there's no TDZ. Apply the CLAUDE.md verbatim-extraction TDZ checklist.
5. **`session-runtime.js`.**
   - Add `isolateEffective` to `deps` (boolean, default `false` if absent so existing tests are unaffected unless they opt in).
   - Removing the isolate Cookie-deletion block also removes its `cookieBlockedDomains` marking there. The accounting moves to `onHeadersReceived` per DD6.
   - Header-name case: Electron gives `responseHeaders` keys in server case, so find `set-cookie` case-insensitively, as the existing code does.
6. **Permissions.** Compute grant as `ALLOWED_PERMISSIONS.has(p) && !(isolateEffective && STORAGE_ACCESS.has(p))` in both handlers. Keep the `privacy-permission` push as is.
7. **Fixture.**
   - Model it on `web-compat/serve-tls.mjs`/`serve.mjs`: zero-dep, CLI args `--port`, `--log`, in-memory pages.
   - The server cert can be any self-signed cert, because the app runs with `--insecure-tls-fixtures` (`--ignore-certificate-errors`).
   - `localhost` may resolve to `::1`, so bind dual-stack (`::` with `ipv6Only:false`) or verify v4.
   - Host routing uses the request's `Host` header without the port.
   - In the README, document the three sites, every path, and the log schema. State that the log holds cookie **names** only, never values.
8. **Docs.** Make the CLAUDE.md edits concise. Respect Prettier (`npm run format`).
9. **Don't touch** `src/renderer/**` (beyond the `.d.ts`), the privacy panel UI, `pausedSites` semantics in `shields.js`, or anything in DD11.

## Completion (overrides any older in-file checklist)
Implement to the ACs. AC10–AC12 live runs are performed by the Flight Director after landing; the Developer prepares the fixture and spec, and verifies the fixture serves all paths with a quick `curl -k` per host. Update the flight log's Leg Progress entry. Set this leg's status to `landed`. **Do not commit.** Signal `[LAND:leg]`.

## Design Review
Round 1 (Developer, 2026-10-05): approve with changes. Incorporated:
- the channel-list pin and harness;
- Chromium feature-list syntax and `operatorOverride` (which resolves the permanent-hint question);
- the `readOnly` source-scan pin and the no-sibling-files assertion;
- AC7 robustness and pass-through cases;
- `parseShieldsConfig` takes `deserialize` as a parameter;
- the locked and no-table cases;
- the full AC5 ordering and top-level pin;
- RELEASING placement;
- AC11 named as the sole startup-path proof.

Answered: the packaged build uses the same `app.commandLine` path (Leg 03 HAT verifies it). `isolateEffective` is computed rather than observed; that is accepted, and AC11 step 11 is the observation.

## Citation Audit
Checked 2026-10-05 against `main` @ `99c4d34`:
- `main.js` `const gotSingleInstanceLock = app.requestSingleInstanceLock();` (line 297), `crashReporter.start({` (316), `const sessionRuntime = createSessionRuntime({` (2611), `registerAppLifecycle({` (2702).
- `shields.js` `parseAndRepair` (64), `load` (81).
- `app-db.js` `selectDoc` SQL (275), `createDocumentStore` (405).
- `session-runtime.js` `createSessionRuntime` (34), `applyShields` (173), the `cookieBlockedDomains` marking (219), the permission handlers (242/249).
- `register-settings-ipc.js` `shields-get` (32) and `internal-shields-get` (65).
- `session-runtime.test.js` stripping test (345).

All present.
