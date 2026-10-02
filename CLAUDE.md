# CLAUDE.md

Goldfinch — an Electron desktop browser with a media panel (scan/play/download page media) and a privacy panel (Shields + cookie-jar identities).

## Commands

- `npm start` — run the app
- `npm run dev:automation` — canonical dev launch (`scripts/dev-launch.mjs`, WSL/headless friendly); dev-only, profile-isolated. Add `GOLDFINCH_AUTOMATION_ADMIN=1` when admin-tier MCP ops are needed. **Two consumer models, don't conflate**: script harnesses that re-capture the printed key each run add `GOLDFINCH_AUTOMATION_DEV_MINT=1` per launch (prints one parseable `AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}` line, both keys shown once) and attach via env-key scripts (`scripts/lib/mcp-client.mjs`); MCP clients holding a standing token in a static config (e.g. a `.mcp.json` entry — a legitimate, documented attach path) mint ONCE, then relaunch WITHOUT `DEV_MINT` — every re-mint **replaces** the stored per-jar/admin key hash, so a stale static config starts 401ing. Launch states, key capture, attach recipes, ozone/WSLg notes: `docs/dev-testing.md`; full MCP reference (incl. `.mcp.json` registration): `docs/mcp-automation.md`.
- `npm run dist` — build installers (electron-builder); `npm run pack` for unpacked
- `npm test` — `node --test` over `test/unit/**` (pure security/privacy helpers). For real-environment / UI behavior, drive the running app over the MCP automation surface (`npm run dev:automation`); behavior specs live in `tests/behavior/`.
- `npm run lint` — ESLint, flat config (`eslint.config.mjs`)
- `npm run format` — `prettier --write .` over the whole tree (`.prettierrc`); run before committing
- `npm run format:check` — `prettier --check .`; the CI gate (`ci/tasks/lint.yml`, run on local Concourse — see Release / CI; `.github/workflows/ci.yml`'s "Format check" step is the same check but manual `workflow_dispatch`-only, not an automatic check) — fails the build on drift
- `git config blame.ignoreRevsFile .git-blame-ignore-revs` — one-time local setup so `git blame` skips mechanical reformat commits (currently just the Leg 1 Prettier reformat, `339e808`)
- `npm run typecheck` — `tsc --noEmit -p jsconfig.json` (all `// @ts-check` files)
- `npm run a11y` — axe-core audit (`scripts/a11y-audit.mjs`) against the RUNNING app over the MCP surface (zero CDP). Verify-only — NOT part of headless CI (needs the live GUI). Violations diff against the curated `ACCEPTED` allowlist baked into the script — only NEW `(rule id, node-selector)` findings fail. Run recipe (attach, audited states, gate tags, fixture, exclusions): `docs/dev-testing.md` → *a11y audit*.


## Architecture

Three processes; understand the boundary before editing.

- **Main** (`src/main/`): `main.js` is the composition root, not the behavior owner. `window-factory.js` builds windows/chrome views and owns close teardown; `window-registry.js` owns records `{win, chromeView, tabViews, activeTabWcId}`; `register-{tab,overlay,download,settings,browser}-ipc.js` own channel families; `app-lifecycle.js` owns ready/restore/quit; `session-runtime.js` owns web-session policy and retention cadence; `internal-ipc.js` is the origin-checked bridge for trusted `goldfinch://` pages.
  - **Main↔chrome routing has three classes — classify any new send/handler site first**: (1) sender-resolved inbound (`registry.getWindowForChrome(event.sender)` / `getWindowForGuest(event.sender.id)`); (2) broadcast fan-out (`broadcastToChromeAndInternal`: all chromes + internal-session contents, once); (3) per-tab owner-routed pushes, resolved at EVENT TIME via `getChromeForTab(wcId)` (this makes move-to-new-window re-bind automatic). Never fan out a per-tab push or use a focused-window accessor; `getChromeContents()` is last-focused only — don't build on it.
  - **Close order** (`window-factory.js`, at `close`): find overlay → tear-off overlay → sheet → closed-tab capture/session snapshot → per-tab side effects + **explicit guest destroy** (Electron never auto-destroys an attached view's webContents). `closed` removes the record. Closing one of N windows never quits.
  - **⚠️ Never read `win.*` inside `closed`-or-later handlers** — capture inputs (`const winId = win.id`) at create time. A destroyed-`BaseWindow` access throws, and an uncaught throw in the native `closed` emission aborts the listener chain and permanently wedges the Wayland close path with no error output (`window-closed-invariant.test.js`: no raw `.on('closed'` in `src/main/**`).
- **Preloads** (`src/preload/`): `chrome-preload.js` exposes `window.goldfinch.*`. `webview-preload.js` runs in every web page's **main world** (media scanner, fingerprint farble) and drives an **isolated world** for vault-capture reads immune to page accessor spoofing. `internal-preload.js` is context-isolated, exposes `window.goldfinchInternal` behind an `INTERNAL_ORIGINS` check (defense in depth; main-side `registerInternalHandler` is authoritative). Keep the three separate.
- **Renderer** (`src/renderer/`): `renderer.js` is the chrome boot root; `chrome/*-controller.js` own behavior; `chrome/overlay-dispatch.js` owns the generic sheet-activation switch. Tabs are addressed by `wcId`. Menus/dialogs render from the main-owned **menu-overlay sheet**, not chrome DOM.

Cross-cutting facts:
- **Shields apply to every jar via `session-runtime.js`'s `onSessionCreated`** (each container/burner/default tab is a session partition); one `webRequest` listener per event per session shared by recording and enforcement.
- **Web guests run `contextIsolation:false`** (farbling needs the preload in the page main world) with `nodeIntegration` off, `sandbox:true` and `autoplayPolicy: 'document-user-activation-required'` (tab + popup); web sessions send a Chrome-shaped UA (the `goldfinch/`/`Electron/` tokens are stripped in `onSessionCreated`, `user-agent.js`); internal views are context-isolated + sandboxed; the chrome view is the one tracked sandbox exception. Farble config is read synchronously at page load — toggling needs a reload.
- Persisted state: `userData/app.db` (see App database); legacy JSON imports once and is renamed `.migrated`. The **session snapshot is written continuously (debounced)** by `session-snapshot-scheduler.js`; `isRestorePending` gates writes during boot restore; `before-quit` flushes the timer first so nothing fires after `appDb.close()`. The **vault** is a separate substrate (`userData/vaults/`).
- **⚠️ `WebContentsView` native-surface gotcha — "DOM correct ≠ render correct."** A guest view is an out-of-process native surface: bounds/visibility changes can mis-render composited pixels while every `getComputedStyle`/`getBoundingClientRect` looks right. A guest bounds change is a discrete `setBounds` STEP, not animatable. **INVARIANT: never animate chrome layout that resizes/repositions the guest slot; animate only things that float OVER the guest (find bar, sheet), or make the layout change instant.** The acceptance signal is a human watching the rendered surface in motion; spike on-platform first; don't blame WSLg without a cross-platform control.

## Patterns

### `src/shared/` ESM modules

Real ESM with explicit `.js` extensions, loaded via `<script type="module">`; unit tests `require()` the same file (Node ≥22), so tests run shipped code.

- **Two specifier shapes, by consumer.** `file://` chrome imports disk-relative; internal `goldfinch://` pages import **flat** specifiers (`./safe-color.js`) because `internal-page-map.js` is an exact-match map (a disk-relative specifier 404s at boot). Flat imports carry `// @ts-ignore`, typed `any`.
- **CJS-by-design quartet + eslint parse guard.** `automation-dev.js` and `internal-page.js` are preload-reachable (no `require(esm)`) and MUST stay CJS; `dev-profile.js` and `guest-forward-allowlist.js` stay CJS by ruling. `eslint.config.mjs` binds all four to `commonjs`; the later `src/shared/**` block's `ignores` entry for them is **LOAD-BEARING** (later-wins would otherwise delete the parse guard).
- **Renderer evaluate-seam closed-set rule.** Controller code stays module-scoped; `renderer.js`'s tail republishes exactly the FD-approved set with `Object.assign(globalThis, {…})`. The set is **41 entries** (`SEAM_COUNT`, `test/unit/seam-contract.test.js`); it changes only by FD ruling, updating the test constant and this line together.
- **Defer/module pin.** Every classic `<script>` on a page that also loads a module script must carry `defer` (`menu-overlay.html`'s `menu-controller.js` is the one carve-out).
- **New-shared-module checklist**: module script tag only; internal-page consumers need an exact `internal-page-map.js` route; a new `src/renderer/pages/*.js` controller also needs its own entry in `eslint.config.mjs`'s explicit module-`sourceType` file list (only `chrome/**` is a glob — a missing page entry fails lint as a script parse error); evaluate-reachable entry points go through the seam; a new contextBridge method needs its `renderer-globals.d.ts` entry.
- **Page controllers take `src/shared/` pure functions as injected deps.** Controllers under `src/renderer/pages/` receive them as arguments (exemplar: `vault-filter-controller.js`) so unit tests execute them against a mock DOM; a static flat-specifier import resolves only through the internal-page map, leaving the file source-scan-testable only.
- **Grep-AC convention.** Negative/invariant ACs may be a literal reproducible grep/diff with each hit judged exempt-or-real, instead of a unit test.
- **Regex-target mutation pins.** When a source-text pin's `.replace()` target would be an exact multi-line literal, use a wrap-insensitive regex (`\s+`/`\s*`, metacharacters escaped) with a captured-indent replacer so a Prettier re-wrap can't stale it. Keep `assertMutated` guarding every mutation (a no-op `.replace()` passes vacuously). Dispatch-table scans need a bounded non-greedy lookahead (`(?:(?!\n\s*\w+:)[\s\S])*?`). Exemplars: `move-authority.test.js`, `tab-drag-invariants.test.js`, `sheet-automation-gate-invariant.test.js`; re-targets are neuter-verified.
- **MockTimers recipe.** Enable per test (`t.mock.timers.enable(...)` in the test body, never file-global); drain with real `setImmediate` around single-step ticks, never one big tick. Exemplar: `test/unit/automation-find.test.js`.

### Two-point hostile-URL security boundary

`isSafeTabUrl` is enforced at the renderer `createTab` gate (only `http:`/`https:`/`about:blank`) and the main `will-navigate` guard. **NEVER widen it to admit `goldfinch://`.**

**PDF-viewer carve-out — the ONE relaxation**: `guardNav` stays strict on `will-navigate`/`will-redirect`/`will-frame-navigate`; only the `will-frame-navigate` registration is a wrapper that also allows a **subframe** (`isMainFrame === false`, fail-closed when absent) on a **non-internal** guest whose URL is scheme `chrome-extension:` with host exactly `PDF_VIEWER_EXTENSION_ID` (`guest-wiring.js`). Web guests carry `plugins: true`, internal guests don't. Top-frame `chrome-extension:` stays refused; never widen (matrix in `guest-wiring.test.js`).

### Recurring module shapes

- **Electron-free, injected-deps modules** (main-side): live handles passed as arguments, never `require('electron')`, so logic runs under `node --test` with fakes (`automation/engine.js`, `settings-store.js`, `menu-overlay-manager.js`). Pure decision modules live in `src/shared/`; a main-only one stays CJS.
- **Drift guard**: a constant/table asserted equal to another module's DERIVED value so a new entry on one side goes red until the other catches up (`identity-profile.test.js`, `vault-editor-model.test.js`, `vault-page-model.test.js`, `bookmarks-bar-css-pin.test.js` — the source-scan flavor throws rather than passing vacuously).
- **Planner/actuator split**: a pure planner returns independent actions; a thin loop runs each in its own `try`/`catch` with **no early return inside the loop**, so one failure never stops the rest (`planCaptures` + `onCaptureGesture`).
- **Cast-to-local before a chain.** Never put an inline `/** @type {any} */ (x)` cast inside a multi-line chain/argument list/ternary (Prettier reattaches the comment); bind `const anyX = /** @type {any} */ (x);` first. `// @ts-ignore` covers only the NEXT line, so on a multi-line import it goes right before the `} from '…'` line.
- **Decide tab type with `isInternalTab()`/`isWebTab()`, never by reading `.trusted`** (trust is call-site provenance at `createTab`).

### Internal `goldfinch://` pages — trusted-embedder security model

Internal origins (`settings`, `downloads`, `jars`, `vault`) are equally privileged: the trust boundary is **"internal vs web," never per-page**. Security-critical.

- **The welcome surface is NOT an internal page** — a chrome-owned viewless tab (`welcome-controller.js`) with no `goldfinch://` URL. Its DOM ids/classes (`#welcome-*`, `.welcome-engine-row`) are a frozen contract (`search-engines.test.js`): restyle may wrap, never rename/remove/re-toggle.
- `goldfinch` is registered privileged (`{standard: true, secure: true}`) before `app.ready`; `standard: true` is load-bearing. Served from a dedicated in-memory internal session with a **session-scoped** `protocol.handle`. **`INTERNAL_PARTITION` is single-sourced** in `src/shared/internal-page.js` — import, never re-type (drift makes every gate fail open).
- **CSP is stamped IN the response** (`INTERNAL_CSP`) — custom-protocol responses bypass `onHeadersReceived`. Don't relax without security review.
- **Route map** (`internal-page-map.js`): exact host → pathname → file; no path arithmetic, no directory passthrough.
- **The four gates**: (1) trust is call-site provenance — `createTab(url, container, { trusted: true })`, never inferred from the URL, and `onOpenTab` passes no flag; (2) trusted branch validates with `isInternalPageUrl`, untrusted with `isSafeTabUrl`; (3) session-aware `will-navigate`; (4) the protocol handler exists on the internal session alone.
- **Chrome-fetch invariant: no page-controlled URL is fetched by the chrome outside the owning jar's session.** Chrome CSP forbids remote `img-src`/`media-src` (`csp-pins.test.js`); favicons are fetched main-side and delivered as `data:` URLs; media-panel remote URLs go through the **`goldfinch-media:`** proxy (default session only, `toMediaProxyUrl`, forwarded via the guest's OWN session, streaming). Never assign an `http(s):` URL directly in `media-controller.js`.
- **Adding an internal page**: entry tree in `internal-page-map.js`; host in `INTERNAL_HOSTS`; origin in `INTERNAL_ORIGINS` (`internal-ipc.js` AND `internal-preload.js`); open via the trusted `createTab` path. `internal-page-route-closure.test.js` is the standing guard.

### Internal-bridge security model (`src/main/internal-ipc.js`)

`registerInternalHandler` checks BEFORE the handler: `INTERNAL_ORIGINS.has(event.senderFrame?.origin)` (destroyed frame → `null` → fails) AND `event.sender.session.__goldfinchInternal === true`. This is the authoritative boundary.

- **A read-only channel consumed by BOTH the `file://` chrome and an internal page must be a bare `ipcMain.handle`** (`settings-get`, `shields-get`, `automation:get-activity`; non-secret data only). Never wrap chrome channels in `registerInternalHandler`.
- **Any handler that mutates settings directly must broadcast `settings-changed`** (`broadcastToChromeAndInternal`); only `internal-settings-set` does it automatically. `chrome-welcome-set` is the one chrome-initiated settings write (only `homePage`/`searchEngine`).
- **Listener handles**: internal-preload `on…(cb)` returns a numeric handle, `off…(handle)` removes it; call `off…` in a `{ once: true }` `pagehide` listener.

### Settings store (`src/main/settings-store.js`)

The home for app preferences — don't scatter prefs into constants or `shields.js`.

- Electron-free; `documents` row `'settings'`. `load()` **never throws** (per-key validation against `DEFAULTS`, corrupt fields repair, unknown keys drop); `set()` validates before mutating. `homePage`/`searchEngine` default `null` (unset; `''` never valid); `searchEngine` must be an id in `search-engines.js`, never a user template. `jsconfig.json` is `strict: false`, so nullability is enforced by validators/tests.
- **Rule: any load path whose resolved config differs from the on-disk bytes persists it.** `migrateStored()` rungs each guard on their own `from`. Codec seam `{serialize, deserialize}`; no encryption. **Object-typed keys (`toolbarPins`) need an explicit validator** (`typeof` accepts `null`/arrays); the normalizer deep-merges over defaults.
- **`homePageCache`/`searchEngineCache` (renderer)**: boot-seeded and kept live by `settings-changed`, guarded `!== undefined` (never truthiness — `null` is meaningful), stored RAW. Unset home → `openNewTab` opens a viewless welcome tab; a search with no engine routes through `handoffSearch`, never into a URL nobody chose. `createTab` is never called with a `null` URL.

### Default browser (`src/main/default-browser.js`)

Two `registerInternalHandler` actions (`default-browser:get-status` / `:make-default`) take **no page arguments** and delegate to an Electron-free injected module; nothing is persisted and no `settings-changed` is broadcast (the OS is the source of truth). **win32 status is never claimed** (`isDefault: null`) — Electron's check reads `Classes\<scheme>`, not the Default-apps UserChoice. The `ms-settings:defaultapps?registeredAppUser=Goldfinch` literal is the ONLY `shell.openExternal` target in `src/` (source-scan pinned; `Goldfinch` is drift-guarded against `build/installer.nsh`'s `RegisteredApplications` value). The NSIS include's `customUnInstall` deletes ONLY inside `${ifNot} ${isUpdated}` (an update runs the old uninstaller; deleting the ProgID would reset the operator's default). Row copy is the pure `src/shared/default-browser-row-model.js`. `desktopName: goldfinch.desktop` also changes the dev app_id/WM_CLASS (no script/doc assumes the old value).

### Toolbar pins and DevTools

- `applyToolbarPins(pins)` toggles `.hidden` only; unpinned ≠ disabled (panels/shortcuts stay active; skip `.focus()` on a hidden button). Right-click Unpin sends `unpinToolbarItem(item)`; main validates the item and **must spread the full current map** (`{ ...settings.get('toolbarPins'), [item]: false }`). Main is the single settings writer.
- **DevTools** (`devtools.js`): handlers act on the PASSED wcId (TOCTOU — never `activeTab()`) and refuse internal/dead contents. Open DevTools takes Chromium's single CDP slot, so `readAxTree`/`scroll` return `debugger-unavailable`.

### Page context menu

Web-content-only (guest `context-menu` inside the `!__goldfinchInternal` guard is forwarded to the owning chrome). Pure `pageContextModel` builds **NAMESPACED ids** (`link:*`/`image:*`/`sel:*`/`edit:*`/`spell:<index>`/`action:*`); spelling dispatches by INDEX so guest strings never round-trip as commands. Dispatch validates every id (vanished params → no-op), allowlists edit actions, bounds-checks `spell:<i>`, and acts on the wcId captured at right-click (TOCTOU). Escape refocus never targets the guest. Backing chrome-trust IPC refuses the internal session. `canBookmark`/`isBookmarked` come from the chrome's own tab/cache, never guest `params`.

### Menu-overlay sheet

All chrome menus composite above the live guest from a per-window lazy transparent overlay `WebContentsView` (`menu-overlay.*`, `menu-overlay-manager.js`; details in `docs/renderer-menu.md`). Show = `addChildView` AFTER the guest (z-order); never focused before model init; covers the guest region only. Chrome owns triggers/models/actions; the sheet holds **no business logic or privileged APIs**, uses `textContent` only, and runs the APG keyboard contract.

- **⚠ On a tab SWITCH, close the menu BEFORE resizing the sheet.** Resizing the still-visible sheet then hiding it in the same tick leaves `document.visibilityState` stuck `'hidden'` for the window's life — state stays correct, pixels never repaint, automation can't see it.
- **Protocol**: chrome→main open/close carry a chrome-minted monotonic token (stale tokens dropped); main→chrome `menu-overlay-closed` (7) is emitted BEFORE `menu-overlay-activated` (6); `:activated` `value` is sanitized (≤24 chars). Every hide routes through the idempotent `closeMenuOverlay(reason)`; `focusChrome()` runs for `escape`/`activated` only; open-while-open is a model-replace.
- **⚠ Eager close scrub — SECURITY.** Every close sends the sheet a close message that runs `menuController.closeAll()` immediately; `openMenu` shows synchronously before `deliverInit` crosses IPC, so a lazy scrub leaves the prior card's secret in the DOM. **Do not "simplify" to scrub-on-next-init.** (Same-menuType replace deliberately doesn't scrub.)
- **Vault credential sheets survive window blur; lock closes them.** The per-open `survivesBlur` axis (never reuse `dismissible`/`keepFocus`) is decided ONCE in `overlay-menus.js`'s `open()` against `src/shared/vault-blur-survival.js` and threaded through BOTH guards (`closeMenuOverlay` and `menu-controller.js`'s blur listener). Every vault lock fans a HARD `closeMenuOverlay('vault-lock')` to all windows, scoped to that allowlist MINUS `vault-unlock`. `keepFocus` opens (unlock-to-save) make the sheet non-dismissible and re-grab focus, gated on sender identity/`win.isFocused()`/opt-in and capped by `KEEP_FOCUS_MAX`.
- **All `menu-overlay:*` handlers are sender-validated by webContents identity**, never payload-declared. **Any state-CHANGING sheet→main channel carries four guards in order**: sender identity (`recordForSheetSender`), token freshness, `current.menuType` match, a business gate (exemplar `cert-override-proceed`). The sheet is not in `tabViews` (admin-only by wcId).
- **`sheet-accelerator.js` hand-mirrors `keydownToAction` — change both together.**

### Chrome indicators (pure decision models)

The automation, vault and downloads indicators each split their truth table into a **pure, DOM-free model** the chrome imports: it projects the latest pushed snapshot to a render model, never caches, never throws, and is unit-tested without DOM or clock (`automation-indicator-model.js`, `vault-indicator-model.js`, `downloads-indicator-model.js` — a timer-free reducer, expiry time-INJECTED). Automation `admin` (rainbow) mode shows only when the admin key is enabled AND active; a color renders only if it resolves in live `containers` and passes `isSafeColor`. Vault right-click when locked is **"Unlock now"**, never an empty dropdown.

- **Per-tab pushed-state rules.** (a) A NEW per-tab state gets its OWN owner-routed channel; never ride a push whose chrome handler has unrelated side effects (`tab-security` doesn't ride `tab-did-navigate`). (b) An indicator never claims a state main hasn't pushed (no scheme guess). (c) The controller that stores a pushed state refreshes its own rendered consumer in the SAME handler (`onTabLoadFailure` updates the chip UNCONDITIONALLY; only the address-bar VALUE write is gated on `document.activeElement`).

### App database (`src/main/app-db.js`)

Durable substrate for the config stores, bookmarks and cookie bookkeeping on built-in `node:sqlite` (no native module; experimental — **every Electron major bump re-runs the full store suite**). Independent of `history.db`. `documents(store PK, payload, updated_at)` holds one row per config store (transactional whole-document UPSERT); opened in `initProfileAndStores`, closed at `will-quit` after `before-quit` snapshot writers.

- **Migration: import once, rename `.migrated`**; once a row exists legacy files are ignored. Jars' readable-but-unknown-version `containers.json` is never migrated.
- **Quarantine → fresh defaults**: a corrupt `app.db` is quarantined WHOLE to `.corrupt-<ms-epoch>` and recreated; `.migrated` files never re-imported. A migration-STEP bug (`err.errcode`) propagates instead of quarantining a healthy file.

### History store (`src/main/history-store.js`)

Per-jar history on a live `node:sqlite` handle (real schema/FTS). Recorder gates in order: registered-jar allowlist → `http(s)` → per-jar 30 s duplicate suppression. **`history-changed { jarId }` invalidation contract**: mutations broadcast only `{ jarId }`; subscribers re-query (same for `jars-changed`/`bookmarks-changed`).

- **Two live-probed sqlite gotchas**: never mix a bare `?` with numbered `?1`/`?2` in one statement (SQLite collapses them onto one slot); keep FTS5 on the default `unicode61` tokenizer — a `tokenchars` override makes a whole URL one token and silently breaks prefix search.
- `handleClearData` must dispatch on `d.custom === 'history'` FIRST (else the cache-clear fallback runs while reporting history cleared). `identity-new` deliberately does NOT purge history.

### `goldfinch://jars` page and data panels

Per-jar tab strip (History / Cookies / Other site data); Burner has no tabs (driven by `row.isBurner`, never an id check). Ids use a **double-hyphen** `jar-<jarId>--<panelId>` (`slug()` never emits `--`). The Cookies panel never exposes a cookie `value`, at any layer. Other-site-data has documented gaps (Local Storage not origin-recoverable, third-party-only origins invisible, no quota figures) — don't paper over. Cross-path staleness closes via `jar-data-changed { jarId, classes }` (fired on sweep COMPLETION, never the `setRetention` invoke).

- **Retention sweep** (`retention-sweep.js`): cookies age by first-seen (`cookie_seen`), storage by history last-activity; the cookies listener SKIPS deletion on `cause === 'overwrite'`. **⚠️ Snapshot aged-out origins BEFORE the history prune** in both `pruneAllJars` and `handleSetRetention`. **Quiesce guard**: every cookie-listener write checks `appDb.isOpen()` and is try/caught so write-after-close can't wedge quit.

### Address-bar suggestions

History + per-jar bookmarks on the sheet, dispatched by INDEX (`sug:<i>`). History and bookmarks are queried with `Promise.allSettled` (never `Promise.all`). `shouldQuery` is a positive allowlist (burner/internal never query); responses re-validate the gate at arrival. `noFocus` keeps OS focus on `#address`; the chrome owns the close matrix (blur via a 150 ms grace timer re-checking token AND `document.activeElement`).

- **⚠️ Ch7-before-Ch6 nuance**: the closed-sink clears `suggest.items`/`selectedIndex` only for reasons OTHER than `activated`; the following `sug:<i>` dispatch must still resolve the clicked row. Resetting on every reason breaks click navigation.

### Bookmarks

Jar-scoped end to end (`bookmarks-store.js`: keyed `jar_id`, unique `(jar_id, url)`; stateless and jarId-first — an id alone never authorizes a mutation). `bookmarkUrlsMatch` (exact string equality) is the ONE identity predicate. Mutations broadcast `bookmarks-changed { jarId }`. Deleting a jar drops its bookmarks; a full identity wipe does not.

- **Chrome cache** (`bookmarks-client.js`): lazy per-jar map; a `jars-changed` broadcast evicts dead jars (ids are deterministic and REUSABLE) via its OWN subscription and a late fetch for an evicted jar is DROPPED. **Chrome is the sole bookmark-mutation issuer**: the edit popover submits via the dedicated `menu-overlay:bookmark-edit-submit` invoke, main forwards to the owning chrome without touching the store, and the jar is captured at popover OPEN.
- Bar visibility = `bookmarksBarEnabled && !suppressed`, toggling `.hidden` + `sendActiveBounds()` only on a NET change; burner/internal tabs render no bar. Middle/Ctrl+click opens with the three-arg `createTab(url, activeContainer(), { background: true })`, never the two-arg form. No independent `onBookmarksChanged` subscription in the bar (stale cache).
- **`BAR_GAP`/`BAR_PADDING_X`/`CHEVRON_WIDTH` in `bookmarks-bar.js` are a PINNED CSS↔JS PAIR** with `styles.css` (`bookmarks-bar-css-pin.test.js`).

### Chrome panel in the guest slot, TLS, crash and hang

- **Chrome panel in the guest slot** (load-failure, crash, welcome): a chrome-DOM panel in `#webviews` shown OPPOSITE the guest (hidden, not occluded). **Two-axis invariant** (`applyGuestVisibility`): an entry state flag AND the active-tab check gate visibility via the ONE predicate `guestTakenOver(entry)`; `tab-focus-guest`, the `tab-set-active` re-arm and `isFindableTab` refuse while true — never read a bare `entry.loadFailure`. Each state rides its OWN owner-routed channel; `activateTab` projects EXACTLY ONE panel (crash > load-failure > welcome > none). Frozen DOM ids (`#load-failure-*`, `#hang-notice*`) are contracts.
- **TLS trust** (`cert-trust.js`): `certificate-error` is answered SYNCHRONOUSLY exactly once in a guarded `finally`. Override memory is keyed `partition + host:port + fingerprint`, IN-MEMORY ONLY (no fs/app-db/settings import — grep-AC'd), never widening to the host. The proceed channel is four-guarded and host/fingerprint/URL come from the tab's ENTRY, never the payload. `cert-observer.js` records but NEVER decides (callback unconditionally `-3`, the only `callback(` literal). `deriveSecurityState` checks the navigation's own `certOverride` before the cached verdict; `security` is forced `none` on `did-fail-load`. `cert-override` is NEVER admitted to automation.
- **Crash/hang.** **No guest ever auto-reloads.** **Kill-and-reload gates on `entry.killRequested` ALONE, never `reason`** — `forcefullyCrashRenderer()` reports `'crashed'` on Linux/Electron 44. **Live-rig finding**: with `crashReporter` active, SIGSEGV/SIGABRT don't crash a sandboxed guest here — only SIGKILL does (a real segfault may present as a hang); the unsandboxed chrome crashes on SEGV but registers only after ~15 s — corroborate by `chromePid` change.
- **Chrome recovery** (`chrome-recovery.js`): reload the chrome in place with `bootConfigServed = false` + `recoverTabs = true`; **`record.restoreTabs` is NEVER nulled**; `window-boot-config` checks `recoverTabs` BEFORE `restoreTabs`, re-adopts every `tabViews` entry, re-pushes per-tab state, THEN flushes gap-queued sends. Cap 3 per 60 s, then paused. `queueChromeSend`/`sendOrQueue` is the ONE boot-gate for per-tab pushes (no bare `chromeForTab(wcId)?.send` in `guest-wiring.js`).

### Tab strip

- **Viewless welcome records**: a tab may have `wcId === null`; `attachView(tab, url)` is the ONLY place it gets a view. Never in main's `tabViews`, so invisible to snapshots, closed-tab capture and moves.
- **⚠️ Container-query self-restyle is a silent no-op**: a `@container` rule whose selector targets the container element itself never applies — only descendants. `.tab` is the pure sizing/query container (NO padding); `.tab.active` has a 64px min-width floor (else its close button renders outside the clip).
- **DOM order is the single order authority**: use `orderedTabIds()`/`commitTabMove`, never `[...tabs.keys()]`. `enumerateTabs` is creation-order and an all-windows census; a mid-boot window contributes zero rows (`enumerateWindows().booted`).
- **Tab drags are native HTML5 DnD and fire no trailing `click`**, so the click handler's activate is **unconditional** (no suppression flag) and a drag activates in `dragstart`.
- All global shortcuts go through `keydownToAction` (digit branch gated on `!alt` for AltGr, shift-tolerant for AZERTY). Closed-tab stack: one global main-owned stack, positive persist-jar allowlist (burner/internal never captured); `tab-create` with `restoreHistory` SKIPS `loadURL` (both would race). Tab-context batch closes are ordered sweeps: activate the ANCHOR first.

### MCP automation (`src/main/automation/`)

`engine.js` is the single entry point; op modules (`tabs.js`, `nav.js`, `input.js`, `observe.js`, `resolve.js`) hold logic; Electron-free with `deps()` rebuilt per call; `wcId` is the canonical handle (key state on it, never a `wc`).

- **Foreground-to-act + re-resolve, with a read/act ASYMMETRY.** Ops needing RENDERED OUTPUT (`actOn`/`actOnPaced`/`scroll`, `captureScreenshot`, `readAxTree`, `printToPDF`, `findInPage`) run resolve → activate → **re-resolve** → act. **`readDom` and `evaluate` do NOT activate** (a read must not steal the operator's foreground). Pinned in `automation-observe.test.js`; don't harmonize.
- `executeJavaScript` is the main→guest read path (not CDP). **CDP lives only in `cdp.js`, limited to `readAxTree` + `scroll`** (shared per-wcId lock, `debugger-unavailable` refusal, detach in `finally`); route any new debugger need through it. `sendInputEvent` mouseWheel does NOT scroll `WebContentsView` guests.
- **Sheet (menuType × op) gate.** `resolveContents` admits the sheet iff its CURRENT menuType is in `AUTOMATABLE_MENU_TYPES` (`resolve.js`: `bookmarks-overflow`, `bookmark-edit`, `site-info`, `cert-viewer`) AND the op opted in with `allowSheet` (exactly `readDom`, `readAxTree`, `captureScreenshot`). Allowlist on both halves, never a denylist; everything else — including a null menu — is refused at every tier including admin. `sheetMenuFor(wc)` is a live reader threaded into deps at BOTH `createEngine` sites (grep-pinned; fail-closed). Admitted ops snapshot `{menuType, token}` after the first resolve and re-check after async work; `captureWindow`'s sheet layer uses the same predicate. Jar keys are refused by `out-of-jar`, not this guard.
- **Standing unobservable-surfaces list** (check before writing an AC against a surface):
  - **Menu-overlay sheet — READABLE BUT NOT SCRIPTABLE since M15 F3.** Under the four allowlisted menuTypes admin may `readDom`/`readAxTree`/`captureScreenshot`; under every other menuType (kebab, pickers, page/tab context, suggestions, `input-dialog`, `cert-override`, all `vault-*`/`auth-*`) it is fully unobservable. `evaluate`/`injectScript` are refused on it UNCONDITIONALLY, so axe auditing of sheet states is out of reach (the a11y audit skips them).
  - **Toast layer — wholly unobservable** at every tier.
- **`runSerialized`** (`automation/toggle.js`): shared mutex over one `inFlight` chain, rejection-tolerant; prefer it over a bare `await prior` (wedges on rejection).

#### MCP transport (`@modelcontextprotocol/sdk`)

The sanctioned first runtime dependency — pinned to an EXACT version, imported ONLY in `mcp-server.js` + the `main.js` mount; engine/op modules stay SDK-free. `http.createServer` on **`127.0.0.1` only**, stateful sessions. **The Origin/Host guard (`origin-guard.js`) runs FIRST**: loopback alone isn't enough because this browser renders hostile pages (DNS rebinding); denied requests get 403 and never reach the SDK. `openTab`-`null` and `debugger-unavailable` are normal results, not `isError`; an `undefined` `evaluate` return is indistinguishable from a void op at the wire. `dragPointer` paces events a macrotask apart (tab drags are native DnD and can't be synthesized). The repo `.mcp.json` ships empty. Reference: `docs/mcp-automation.md`.

### Password vault

Encrypted per-jar + global vaults: `.gfvault` files + `manager.json` under `userData/vaults/` (not `app.db`), `node:crypto` only. **Full reference: `docs/vault.md`.** Code: `src/main/vault/`, `src/shared/vault-*` (`vault-item-schema.js` is the secret/non-secret SSOT), `vault-controller.js` (chrome), `pages/vault*.js`.

- **Fill trust boundary.** No master-equivalent secret enters the vault PAGE DOM; entry/display go through the chrome-owned sheet over a **dual-zeroized Buffer channel** (`Uint8Array`, never a JS string); one-time key displays are dismiss-locked.
- **Automation is fill-only and login-only** (`vaultUnlock/List/Totp/Fill/AnswerAuth`): a password is never returned; card/identity are excluded structurally by `item.type !== 'login'` filters in `vault-context.js`; audit logs origin + unlock count, never a secret. Browser CSV import has no automation-reachable initiator (native dialog), holds its payload main-side, and awaits a main-side native confirm BEFORE `pending.take()`.
- **Card/identity fill is not origin-gated** (they belong to the operator, not a site), and the fill branch is chosen by the STORED item's own `type`, never by anything the page/chrome sends. Card capture adds a 12–19 digit Luhn gate; identity admissibility needs a scope anchor (postal role AND non-postal role in one form; bare `address` never admissible); the two vocabulary tables (`AUTOCOMPLETE_ROLES` hyphenated vs `ROLE_ALTERNATIVES` hyphen-free) must NOT be consolidated. Precedence login > card > identity. ONE identity profile per vault at EVERY write path. **Adding an item type means editing four sources in parallel**: `SCHEMA`, `vault-store.js` `ITEM_TYPES`, `vault-editor-model.js`, `vault.js` `ITEM_SUBSECTIONS`.
- **Save moment: read at gesture, release at settle — never read at settle.** A trusted click/Enter (`isCaptureGesture`) snapshots the isolated world's entries same-process and HOLDS them main-side; `did-navigate`/field-detach only RELEASES (the old isolated world is gone by `did-navigate`). Held records are per (tab, family); TTL is always a drop; family dispatch goes through `dispatchByFamily` (unknown kind → `FAMILY_REFUSED`, never a login fallback); the chrome presents offers one sheet at a time (resolution-class close advances, occlusion-class drops the queue).
- **The isolated world is the read substrate and carries no policy.** Web guests run `contextIsolation:false`, so a page can spoof `isTrusted`/`.target`/`.value` accessors; only an isolated world is immune (`vault-entry-observer.js`; `vault-entry-tracker.js` is the main-world policy half). Fills run IN the isolated world with an integer ORDINAL. **Provenance is value-bound, never a sticky flag**, and TTL-bounded. `usernameDetected` rides the capture IPC so an unprovenanced username can't match a null-username item (`applyUsernameDowngrade`).
- **⚠ Observer build**: `scripts/build-preload.mjs` bundles the observer require-free into a generated (gitignored) constant. **A throw inside an isolated-world script RESOLVES `undefined` rather than rejecting** — the build wraps in its own try/catch/return and `ensureInstalled()` asserts `result.installed === true`.
- **Password roles / rotation / generate** (`password-field-roles.js`, `password-policy.js`, `vault-capture-plan.js`): a classified scope captures the `new` value only when a present `confirm` is provenanced and byte-equal; ambiguity is a missed capture, never a wrong value. Rotation matches a provenanced `currentPassword` against stored passwords and must REASSIGN `rec.username` (else an update blanks it). **Generation: the chrome NEVER holds a password** — main re-sanitizes the page-influenced constraints, generates, and delivers over `vault-fill-generated` (human deps only, never MCP); page `pattern`s are tested only in the isolated world; `fillGeneratedForm` has NO first-field fallback on a stale ordinal.

### Auth challenges (HTTP basic auth + client certificates)

`src/main/auth-challenges.js`: one Electron-free store behind `app.on('login')` and `app.on('select-client-certificate')` (both unconditionally `preventDefault()`ed), per-window FIFO queues, presented as `auth-basic`/`cert-picker` sheets.

- **⚠️ INVARIANT: every Electron auth callback is resolved exactly once — `resolveOnce` is the SINGLE callback site** (source-scan pinned). Close reasons are **resolution** (escape/outside-click/activated/tab-close/teardown, and the default for unknown) or **occlusion** (blur/superseded/tab-hide/tab-switch — re-presents later). Never add a close path that can leave a callback dangling.
- **Cert selection is human-only**: agent seams (`getPendingChallenge`/`answerWithCredential`) kind-filter to basic-auth, so a string credential can never reach a Certificate callback.

### Non-obvious gotchas

- **`asar:false`** — `src/**` must stay unpacked (internal-page `path.join(__dirname, …)` resolver).
- **Node-vs-Blink origin**: Blink serializes the `goldfinch` scheme origin as `goldfinch://settings`; Node's `new URL(...).origin` is `'null'`. Do NOT "fix" `INTERNAL_ORIGINS` to match Node.
- **Electron `findNext: true` means START A NEW find session**, not step (main maps same text + Enter → step, changed text → new session).
- **Focus-then-send**: a branch forwarding a keyboard-expecting action to the chrome view must `getChromeContents()?.focus()` BEFORE `.send(...)`.
- **Patch in place, never rebuild, whatever holds `document.activeElement`** on broadcast-rendered pages (a rebuild loses the caret and fires a spurious commit-on-blur).
- **Real-boot defects `npm test` can't catch**: `mkdirSync`-before-synchronous-persist (`app-db.js`'s `open()` does it once; unit fixtures pre-create dirs) and classic-script scope collisions.
- **Vault stores load loudly**: a tampered/unknown-version `.gfvault`/`manager.json` throws and is NEVER quarantined (opposite of `app.db`).
- **Crash log** (`crash-log.js`) records a closed EIGHT-key set by destructuring, source-scan pinned — no title/jar/cookie/page content can reach it. **`crashReporter.start()` must sit AFTER the dev-profile `setPath('userData')` redirect, with NO `submitURL`** and no `addExtraParameter`.
- **Single-instance lock + external URLs** (`main.js`, `app-lifecycle.js`, `chrome/external-urls-controller.js`): `app.requestSingleInstanceLock()` sits AFTER the dev `setPath('userData')` redirect (it is keyed on userData, so dev and installed coexist) and BEFORE `crashReporter.start(`/`registerAppLifecycle(` (`single-instance-lock-order.test.js`); the loser does `app.exit(0); process.exit(0)` before any side effect — never `app.quit()` (the `whenReady` chain would still run and write a snapshot), never a top-level `return` (TS1108). OS-handed URLs (cold argv, `second-instance`, macOS `open-url`) go through ONE main-side pending buffer (`filterLaunchUrls`: http/https only, deduped, cap 20, re-validated main-side) and the owner-routed `open-external-urls` channel — cold launch flushes to the FIRST created record (never `getLastFocused()`, which after a restore names the last), post-ready to last-focused with a paused-record fallback. The chrome opens them via `createTab(url, null[, { background: true }])` ONLY — **never `trusted`, never a container**, held behind a boot barrier released in `.finally` on the whole boot chain (`external-urls-wiring.test.js`), so they land after session restore. Logs name only the URL count.
- Frameless window: Close is `win.close()`, NOT `app.quit()`; the last close rides `window-all-closed`. Find-in-page is a floating overlay view, not chrome DOM (not in `tabViews`).

### Formatting is Prettier's

`.prettierrc` is the one source of style; `npm run format` before committing; `npm run format:check` is the CI gate. Two zero-headroom line budgets in `test/unit/seam-contract.test.js` are pinned against Prettier output (`split(/\r?\n/).length`): `RENDERER_LINE_BUDGET` **1546** (`src/renderer/renderer.js`; shared with `vault-restore-workflow-invariants.test.js` via `test/helpers/renderer-line-budget.js` — retarget that ONE module when the count changes) and `BOOKMARKS_BAR_LINE_BUDGET` **1100** (`src/renderer/chrome/bookmarks-bar.js`). A file at budget needs an extraction, not a compaction.

## Release / CI

Both workflows are supply-chain hardened; preserve these invariants:

- **All `uses:` pinned to full commit SHAs** with a trailing `# vX.Y.Z` comment — never mutable tags. When bumping an action, **including accepting a Dependabot PR**, resolve the new version's commit SHA and pin to that (Dependabot proposes mutable tags; applying them verbatim regresses the hardening).
- **Least privilege**: top-level `permissions: contents: read`; only the `create-release`/`build` jobs escalate to `contents: write` per-job.
- **PR-equivalent checks run on the local Concourse instance, not GitHub Actions** (`ci/README.md`): `npm ci → test → typecheck → lint → npm audit --audit-level=high → package`, run automatically on every push to `main` (the `ci` job in `ci/pipeline.yml`) and pre-push against your working tree via `fly -t local-goldfinch execute -c ci/tasks/<task>.yml -i repo=.` (`test.yml` / `typecheck.yml` / `lint.yml` / `audit.yml` / `package-linux.yml`). `.github/workflows/ci.yml` runs the same suite but is `workflow_dispatch`-only — a deliberate manual fallback for when Concourse is unavailable, not a PR trigger. A high in a dev-only dep is fixed by bumping the dep, never by lowering the gate.

### Cutting a release (`build.yml`, on `v*` tag push)

Tag-driven — full flow in `docs/RELEASING.md`. Short form: from green `main`, `npm version patch -m "release-prep: bump to %s"` (the `version` npm-lifecycle hook regenerates the README download links into the same commit — there is no post-release README job; the `preversion` hook refuses the bump if the vendored PSL snapshot is >90 days old — fix with `node scripts/update-psl.mjs`, its own reviewed commit) then `git push --follow-tags`. Strict semver is enforced; a prerelease tag publishes as a GitHub prerelease. Rollback: `gh release delete vX.Y.Z --yes --cleanup-tag`, fix, re-tag. App icon: `build/icon.png`.

## Flight Operations

This project uses [Flight Control](https://github.com/msieurthenardier/mission-control) via the `mission-control` Claude Code plugin. Skills are invoked as `/mission-control:<skill>` from this project's root.

**Before any mission/flight/leg/squawk work, read these files in order:**
1. `.flightops/README.md` — What the flightops directory contains
2. `.flightops/FLIGHT_OPERATIONS.md` — **The workflow you MUST follow**
3. `.flightops/ARTIFACTS.md` — Where all artifacts are stored
4. `.flightops/agent-crews/` — Project crew definitions for each phase (read the relevant crew file)

**Flight Director role.** This session — the one the human talks to — is the Flight Director: it runs the Flight Control skills, plans directly, and orchestrates spawned crew, and never edits source itself. Spawned agents are crew, never the Flight Director. When a human says a leg is ready to implement, invoke `/mission-control:agentic-workflow`. Do not read the leg spec, plan execution steps, or execute commands directly — the skill orchestrates separate Developer and Reviewer agents and emits `[HANDOFF:...]` and `[COMPLETE:...]` signals. Planning skills (`/mission-control:mission`, `/mission-control:sortie`, `/mission-control:flight`, debriefs, `/mission-control:routine-maintenance`) produce artifacts only and never modify source files.

**Spawned agents** (Developer, Reviewer, Architect, Executor, Validator) do not have the Skill tool. Everything they need is in `.flightops/`; they must not try to load plugin skills.

**Methodology drift.** A SessionStart notice from the plugin means this project is behind the installed plugin version. Recommend `/mission-control:preflight-check` or `/mission-control:init-project` to bring it current; never apply migrations by hand.

**Project-specific planning rules (this file, not `.flightops/` — those two files are synced from the plugin and overwritten on `init-project`, so a rule that lives only there is lost on the next sync).**
- A leg's live smoke test exercises **every existing apparatus primitive** against the leg's new state (census, windows, capture, evaluate, …) — not only the primitive the leg added.
- A design decision that installs a **global hook** (`crashReporter`, an `app.on` listener, a session-wide listener, …) lists which earlier spike premises it could change, and **re-runs** them in that leg.
- An AC that changes a **shared mechanism** (live regions, focus, the render/refresh cycle, the sheet) lists every existing feature sharing it and asserts they're unaffected (M22 F1: a scoped `aria-live="off"` silenced Access-keys announcements).
- **Verbatim extraction TDZ checklist item**: anything referenced above the construction site needs a getter or a hoisted declaration — a straight cut-and-paste of code into a new scope can silently turn a working reference into a `const`/`let` TDZ `ReferenceError`.
