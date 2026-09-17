# Leg: chrome-recovery-and-crash-records

**Status**: completed
**Flight**: [Crash and Hang Resilience](../flight.md)

## Objective

Make a dead chrome renderer recover in place — reload at once, reconcile
every live guest from the registry with the active tab re-activated and
per-tab state re-pushed, pause after three crashes in a minute — and make
every crash leave a local record whose fields can never carry browsing data
or secrets, with Chromium's minidumps collected locally and never uploaded.

## Context

- Flight DDs binding this leg: **DD5** (recovery via `window-boot-config`
  `recoverTabs`; `restoreTabs` left INTACT — cycle-2 ruling; the new
  `sendOrQueue` push routing; adopts and re-pushes sent directly, then the
  gap queue flushed deduped last-wins per `(wcId, channel)`; the honest
  dropped-state list), **DD6** (cap 3 per 60 s; pause for the window's
  lifetime; title), **DD7** (the closed field set — operator constraint),
  **DD8** (`crashReporter` AFTER `main.js:274`'s dev-profile redirect, no
  `submitURL`, `pruneDumps` keep 20, docs), **DD9** (`enumerateWindows`
  `chromePid`), **DD2** (popup record; `child-process-gone`). Flight-log
  Decisions: spike (g) confirmed `chromeView.webContents.reload()` re-runs
  `index.html` and re-invokes `window-boot-config` WITHOUT resetting
  `bootConfigServed` — this leg resets it explicitly.
- **Leg 2 outcomes this leg builds on**: `createGuestWiring(deps)` accepts
  an optional `onCrash` dep and calls it from three sites — popup
  (`guest-wiring.js:375`, `{ kind: 'popup', reason, exitCode, url, recovery:
  'closed' }`), kill-reload (`:639`, `recovery: 'reloaded'`), and the panel
  path (`:655`, `recovery: 'panel'`) — NONE of which carry `partition` or
  `windowId` yet; this leg adds both at all three sites (`partition` is
  closed over by `wireTabViewEvents(view, wcId, partition)` `:472` and is
  `popupWc`'s captured partition for popups; `windowId` for the two GUEST sites = `owner.win.id` (the `owner` record
  already resolved there), and for the POPUP site = `win.id` of the popup's
  own window in that closure — `registry.getWindowForGuest` searches only
  `tabViews`, so it would always yield `null` for a popup). The popup site's `recovery: 'closed'` is a
  FIFTH enum value — DD7's enum is amended to `panel | reloaded | paused |
  ignored | closed` (flight-log Decision); registry
  entries carry `crash`/`hung`; `tab-crash`/`tab-hung` are re-pushed on
  adopt. This leg wires `onCrash` to `crash-log.js` in the composition
  root and adds the chrome-crash and child-process callers.
- **Security posture (operator constraint, DD7)**: the record's field set is
  CLOSED. The writer's object literal has exactly these keys — `ts`, `kind`,
  `reason`, `exitCode`, `origin`, `jarKind`, `windowId`, `recovery` — and a
  source-scan test pins the literal; a redaction test pins that
  `origin` is scheme + host + non-default port ONLY (a URL with path, query,
  fragment, or userinfo → origin; `goldfinch://x/…` → `goldfinch://x`; a
  burner partition → `null`; an unparsable/empty url → `null`). No title,
  jar NAME, cookie, header, or page content can reach the writer because the
  writer's INPUT type has none of those fields and the callers build the
  input from `{ reason, exitCode, url, partition, windowId }` only.
- **Rig facts**: as leg 2 (env-only key via a scratch file, never printed;
  never read the app log into the transcript; kill by port pid; shred the
  log at teardown). Every launch uses `DEV_MINT`, which re-mints and
  replaces the stored key hashes — the prior legs' exposed keys are dead the
  moment this leg's rig starts. This leg's live smoke: SEGV the chrome pid (read from
  `enumerateWindows.chromePid`) with two guests open → `booted` false then
  true, same `activeTabWcId`, same wcIds in the census; a fourth SEGV inside
  a minute → `booted` stays false; `crash-log.jsonl` tail parses with only
  the allowed keys; a `.dmp` exists under the dev profile's `crashDumps`.
- **Current code (verified 2026-09-16 on the leg-1 tree; leg 2 shifts
  line numbers — cite by symbol, audit at design review)**:
  - `src/main/app-lifecycle.js` `window-boot-config` handler (`:169-190`):
    sets `rec.bootConfigServed = true`, `bootConfigServedAt`, flushes
    `rec.pendingChromeSends.splice(0)` in FIFO order via `chrome.send`,
    calls `onChromeBooted?.(rec)`, returns `rec.restoreTabs ? { bootTab:
    false, restoreTabs } : { bootTab: !rec.noBootTab }`. `restoreTabs` is
    set once at `:232` and read by `session-snapshot-scheduler.js`'s
    `isRestorePending` (`:127-137`) — NEVER null it.
  - `src/main/register-tab-ipc.js` `queueChromeSend(record, buildMessage)`
  (`:78-88`) ALREADY gates on `record.bootConfigServed`: booted → sends via
  `record.chromeView.webContents` at once, else pushes the thunk onto
  `pendingChromeSends` (an append FIFO flushed by `window-boot-config`).
  It is the ONE boot-gate decision; `sendOrQueue` wraps it, never
  reimplements it. The move/adopt block's re-push span (`:711-739` — load-failure `:712`,
  security `:721`, crash `:727`, hung `:730`, `tab-nav-state` to `:739`;
  NOT the `tab-moved-away` send to the SOURCE chrome at `:698-700` and NOT
  the `adopt-tab` send at `:706`) is the shape to extract: `adopt-tab` via `buildAdoptPayload(p,
    wc)` (`src/main/move-tab-payload.js:83-94` — its header says the
    container `{ id, name, color }` and favicon come from the SOURCE chrome's
    live strip because main cannot rebuild them; recovery has no live chrome,
    so this leg derives the container main-side in `buildRecoveryAdopts`),
    then the state re-pushes, then `tab-nav-state`.
  - `src/main/guest-wiring.js:474` `sendToChrome` (leg 2 leaves it as
    `chromeForTab(wcId)?.send(...)`); `chromeForTab` in `main.js:471-474`.
  - `src/main/window-factory.js`: chrome view creation `:183-197`
  (`loadFile(paths.chromeHtml)`), `registry.create({ win, chromeView,
  noBootTab })` `:197`, the chrome `blur` reassert `:224-230`, the overlay
  managers constructed `:237-281` and assigned onto the record `:283-285`
  (the slots are NULL before that point), the `close` teardown order `:287-358`
    (`authChallenges.cancelForWindow` → vault holds → popups →
    `findOverlay.teardown()` → `tearoffOverlay.teardown()` →
    `sheet.closeMenuOverlay('teardown')` → `sheet.teardown()` → captures);
    `win.on('closed', () => handler(winId))` `:16` (capture `winId` at
    create; never `win.*` after `closed`).
  - `src/main/window-registry.js` `create` `:96-110`: `{ win, chromeView,
    tabViews, activeTabWcId, noBootTab, bootConfigServed: false,
    pendingChromeSends: [], findOverlay, sheet, … }`.
  - `src/main/window-census.js` `:107-130` — `booted: !!rec.bootConfigServed`,
    `chromeWcId`; the row typedef `:20`.
  - `src/main/main.js` — module-load tail: `registerSchemesAsPrivileged`
    `:233`, the dev-profile redirect `:273-275` (`if (!app.isPackaged)
    app.setPath('userData', devUserDataPath(…))`), `createInternalPageMap`
    after it; `createGuestWiring` deps object (locate by
    `createGuestWiring({`); `logger: console` `:371`.
  - `src/renderer/renderer.js` boot: `windowBootConfig()` `:1416-1445`
    (`restoreTabs` branch creates tabs; `bootTab !== false` boots a home
    tab; `bootTab: false` with no `restoreTabs` boots NOTHING — the
    `noBootTab` move-window path); `tab-controller.js:1099` `onAdoptTab`
    (inserts a strip record without `tab-create`; activates when
    `payload.active`).
  - Window caption: NOTHING in `src/main/` or the chrome calls
  `win.setTitle` today (verified by grep — the only `setTitle` is
  `history-store.js`'s visit-title statement), so the paused title set by
  `win.setTitle` is never clobbered. Overlay hide/close names: `findOverlay.hide()`
  (`find-overlay-manager.js:233`), `tearoffOverlay.hide()`
  (`tearoff-overlay-manager.js:121`), `sheet.closeMenuOverlay('teardown')`
  (`menu-overlay-manager.js:447`). Burner identity: the `burner` / `burner-*`
  id namespace is reserved (`src/shared/burner.js`, `jars.js:140-152`) —
  derive `jarKindOf` from the partition string the same way `session-runtime.js`
  / `jar-data-helpers.js`'s `partitionFromStoragePath` family does (read them;
  reuse, never re-type a prefix). Boot-config tests live in
  `test/unit/app-lifecycle.test.js` (plus `session-restore-wiring.test.js`,
  `session-snapshot-continuous-wiring.test.js` — the `restoreTabs`
  interplay pins to extend, rename-over-delete).
  - Docs: `docs/dev-testing.md` headings (`Launch states`, `Key capture`,
    `Attaching a consumer`, `a11y audit`, `Debug flags`, `Test layers`);
    README's "no-silent-egress posture" wording at `:121-122`.
  - Electron 44 (`electron.d.ts:21426-21481`): `crashReporter.start`
    options; `submitURL` required only when uploading; `app.getPath('crashDumps')`
    valid; `app.on('child-process-gone', (event, details: { type, reason,
    exitCode, serviceName?, name? }))`.

## Inputs

- Legs 1–2 landed on the branch (uncommitted, gates green).

## Outputs

**Main — recovery**
- `src/main/chrome-recovery.js` (new, Electron-free, injected `{ now,
  logger, windowMs = 60_000, maxReloads = 3 }`): `createChromeRecovery()` →
  `{ onChromeGone(record, details, hooks), buildRecoveryAdopts(record, ctx) }`.
  `hooks = { windowId, closeSheet, hideFind, hideTearoff, reload, setTitle,
  onCrash }` — every hook is a CLOSURE the caller writes as
  `(…) => record.sheet?.closeMenuOverlay(…)` (property access at CALL time;
  the slots are null until `window-factory.js:283-285` — a bound value
  captured at registration would freeze `undefined`, the leg-1 TDZ anomaly
  class). Ring state is lazily initialised ON the record
  (`record.chromeCrashTimes ??= []`, `record.chromeRecoveryPaused ??= false`
  — the `restoreTabs`/`recoverTabs` precedent; `window-registry.js` is not
  touched). `onChromeGone`: `clean-exit` → return `'ignored'` (no record);
  paused record → `onCrash({ kind: 'chrome', reason, exitCode, url: null,
  partition: null, windowId, recovery: 'ignored' })`, return `'ignored'`;
  push `now()` and drop entries older than `windowMs`; if the ring now holds
  MORE than `maxReloads` → `record.chromeRecoveryPaused = true`,
  `setTitle('Goldfinch — chrome crashed (recovery paused)')`, `onCrash(…,
  recovery: 'paused')`, return `'paused'`; else `closeSheet('teardown')`,
  `hideFind()`, `hideTearoff()`, `record.bootConfigServed = false`,
  `record.recoverTabs = true`, then `let outcome = 'reloaded'; try { reload() } catch { outcome = 'ignored' }`,
  ONE `onCrash(…, recovery: outcome)` record after the attempt, return
  `outcome` (pinned: exactly one record per event). Never touches `restoreTabs`.
  `buildRecoveryAdopts(record, { jarsList, defaultJar, buildAdoptPayload })`
  → an ordered array of `[channel, payload]` pairs: for each `[wcId, entry]`
  of `record.tabViews` in insertion order, `['adopt-tab',
  buildAdoptPayload(adoptInputFor(entry, wcId), entry.view.webContents)]`
  with `active: wcId === record.activeTabWcId` and **`trusted:
  entry.trusted`** (see the trust bullet below), then the shared re-push
  set for that entry (`pushTabStateFor`, below). `adoptInputFor` derives the
  container MAIN-SIDE: a burner partition (`burner:<n>`, COLON — `src/shared/burner.js:35`
  `isBurnerPartition`) → `{ id: 'burner-<n>' /* HYPHEN — the renderer's
  `makeBurner()` id namespace */, name: BURNER.name, color: BURNER.color }`
  from `src/shared/burner.js` (split on `:`, reassemble with `-`; pinned); an INTERNAL entry (`entry.trusted` or `entry.partition ===
  INTERNAL_PARTITION`) → the SAME container `tab-controller.js:349` builds
  for a trusted create, `{ id: 'internal', name: <the page's host, e.g.
  'settings'>, color: '#9aa0ac', partition: INTERNAL_PARTITION }` (import
  `INTERNAL_PARTITION` from `src/shared/internal-page.js`) — `isInternalTab()`
  reads `container.id === 'internal' || container.partition ===
  internalPartition`, NEVER `.trusted`, so a default-jar container would
  render Settings as a web page with toolbar buttons enabled; a persistent partition →
  the matching `jarsList` entry's `{ id, name, color }`, falling back to the
  default jar's snapshot when no jar matches (deleted mid-session — logged;
  note `jars.getDefault()` returns the bare `BURNER` sentinel with NO
  `partition` when Burner holds the default — acceptable for a fallback
  container, the guest's real partition is unaffected).
  `title` = `entry.view.webContents.getTitle()` or the URL host; `favicon`
  omitted (documented drop — it refreshes at the next navigation).
- **Internal tabs across recovery (trust).** `tab-controller.js`'s
  `onAdoptTab` (`~:1122`) hardcodes `trusted: false` because the
  cross-window move path structurally never carries an internal tab. Recovery
  DOES: `buildAdoptPayload` gains a `trusted` field read from
  `entry.trusted` in MAIN (never from any renderer/move payload —
  `validateMoveTabPayload` is unchanged and the move path passes
  `trusted: false`), and `onAdoptTab` sets `trusted: !!payload.trusted`
  on the strip record. **Activation**: `onAdoptTab` (`tab-controller.js:1111-1140`)
  today ends with an UNCONDITIONAL `activateTab(id)` — it never reads
  `payload.active` (the move path adopts one tab per round-trip, so it never
  mattered). Recovery adopts N tabs; as-is the LAST would end active. Change
  to `if (payload.active !== false) activateTab(id);` (absent → activate,
  so every existing single-adopt caller is unchanged; pinned) and have
  `buildRecoveryAdopts` send an explicit `active: false` for every non-active
  entry and `active: true` for `activeTabWcId`. This widens no gate: the adopt push is main→chrome
  (not page-reachable), trust still originates from the entry that
  `tab-create`'s trusted branch stamped, `isSafeTabUrl` is untouched, and
  `createTab` is never called. Pinned: a move-path adopt payload never has
  `trusted: true`; a recovery adopt for a trusted entry does; `onAdoptTab`
  honours it (`tab-controller.test.js`). `tab-controller.js` is not
  budget-pinned; `renderer.js` stays untouched.
- `window-factory.js`: `chromeView.webContents.on('render-process-gone',
  (_e, details) => { if (chromeView.webContents.isDestroyed()) return;
  chromeRecovery.onChromeGone(record, details, hooks); })` registered AFTER
  the overlay slots are assigned (`:283-285`), with `hooks = { windowId:
  winId /* captured at create */, closeSheet: (r) =>
  record.sheet?.closeMenuOverlay(r), hideFind: () => record.findOverlay?.hide(),
  hideTearoff: () => record.tearoffOverlay?.hide(), reload: () =>
  chromeView.webContents.reload(), setTitle: (t) => { if (!win.isDestroyed())
  win.setTitle(t); }, onCrash }`. The chrome wc is destroyed in `closed` via
  `setImmediate`, so a post-`closed` event cannot reach a live listener; the
  `isDestroyed()` guard covers the window.
- `app-lifecycle.js` `window-boot-config`: BEFORE the queue flush, `if
  (rec.recoverTabs) { rec.recoverTabs = false; recovered = true; if
  (rec.tabViews.size > 0) for (const [ch, p] of chromeRecovery.buildRecoveryAdopts(rec,
  ctx)) chrome.send(ch, p); }`; THEN flush `pendingChromeSends` — build
  every queued message first, dedupe last-wins per `(payload.wcId, channel)` — the survivor takes the
  LAST occurrence's position (messages without a `wcId` keep their order;
  pinned), send. Return: `recovered ?
  { bootTab: rec.tabViews.size === 0 ? !rec.noBootTab : false } : (rec.restoreTabs
  ? … : …)` — `recovered` checked STRICTLY BEFORE `restoreTabs`, which is
  left intact.
- `register-tab-ipc.js`: `pushTabStateFor(target, wcId, entry, wc, send)` —
  the ONE definition of the re-push set (`tab-load-failure` if set,
  `tab-security` if set, `tab-crash` if set, `tab-hung` if set,
  `tab-nav-state`), used by the move/adopt block (queued thunks, values read
  at delivery — keep the thunk shape by passing `send = (ch, build) =>
  queueChromeSend(target, build)`) and by `buildRecoveryAdopts` (direct,
  `send = (ch, build) => out.push(build())`). `sendOrQueue`: `queueChromeSend`
  is today a closure-local inside `registerTabIpc(deps)` (`:78`), which
  returns nothing and is called in `main.js` (`:1924`) AFTER
  `createGuestWiring` (`:1699`) — so a `sendOrQueue` defined there cannot
  reach guest-wiring's deps. Lift `queueChromeSend(record, buildMessage)`
  (it needs only its `record` argument) and a `createSendOrQueue(registry)`
  factory (`(wcId, channel, payload) => { const record =
  registry.getWindowForGuest(wcId); if (record) queueChromeSend(record, ()
  => [channel, payload]); }`) to MODULE-LEVEL exports of
  `register-tab-ipc.js`; `main.js` constructs `sendOrQueue` once BEFORE both
  `createGuestWiring` and `registerTabIpc`, threads it into guest-wiring's
  deps, and `registerTabIpc` uses the same exported `queueChromeSend`
  (delete the closure copy — one implementation). `guest-wiring.js`'s
  `sendToChrome` (`:474`) becomes `sendOrQueue(wcId, channel, payload)`. A normal fresh window never takes
  the queue branch (guests exist only after boot); the move-window
  `noBootTab` path already rides the queue — its ordering is unchanged
  (adopts are queued FIRST there, so dedupe-then-flush keeps them ahead).
- `window-census.js`: `chromePid` (`getOSProcessId()` coerced `0`/throw →
  `null`) and `recoveryPaused: !!rec.chromeRecoveryPaused` on every row
  (`enumerateWindows` is admin-gated already).

**Main — records**
- `src/main/crash-log.js` (new, Electron-free, injected `{ dir, fs, now,
  cap = 200, keepDumps = 20 }`): `createCrashLog()` → `{ record(input),
  pruneDumps(dumpDir) }`. `record({ kind, reason, exitCode, url, partition,
  windowId, recovery })` builds EXACTLY `{ ts: now().toISOString(), kind,
  reason, exitCode, origin: originOf(url, partition), jarKind:
  jarKindOf(partition), windowId, recovery }` and appends one JSON line to
  `path.join(dir, 'crash-log.jsonl')` (`appendFileSync`); when the file
  exceeds `cap` lines (counted on write via a cheap `readFileSync` split —
  200 lines is small), keep the newest `cap / 2`. `originOf`: `null` for a
  burner partition (`isBurnerPartition` — read `src/main/jars.js` /
  `session-runtime.js` for the burner-partition predicate; reuse it), else
  `new URL(url).origin` for `http:`/`https:`/`goldfinch:` (with
  `goldfinch://host` reconstructed since Node's `origin` is `'null'` for the
  custom scheme — the CLAUDE.md Node-vs-Blink note), else `null`; never a
  path/query/fragment/userinfo. `jarKindOf`: `internal` for the internal
  partition, `burner` for a burner partition, `persistent` otherwise,
  `null` when absent. `recovery` values: `panel | reloaded | paused |
  ignored | closed` (validated against this list; unknown → `'ignored'`). Everything fail-soft: `record` never throws (try/catch
  → `logger.warn` once). `pruneDumps(dumpDir)`: list `*.dmp` recursively
  one level (`Crashpad/pending`, `Crashpad/completed`, or the flat
  `crashDumps` — probe which exists), sort by mtime, unlink all but the
  newest `keepDumps`; fail-soft.
- `main.js`: `crashReporter.start({ uploadToServer: false, compress: false,
  ignoreSystemCrashHandler: false, rateLimit: false })` placed IMMEDIATELY
  AFTER the `if (!app.isPackaged) { app.setPath('userData', …) }` block and
  before anything else touches `userData`; `const crashLog = createCrashLog({
  dir: app.getPath('userData'), fs, now: () => new Date(), logger })` —
  constructed after the redirect too; `onCrash: (e) => crashLog.record(e)`
  threaded into `createGuestWiring` and the window-factory hooks —
  `record()` reads ONLY the named fields off its input (destructure
  `{ kind, reason, exitCode, url, partition, windowId, recovery }`; never
  spread) so no caller can smuggle a title or object through; the three
  `guest-wiring.js` `onCrash` sites (`:375`, `:639`, `:655`) gain
  `partition` and `windowId`; at
  `app.ready` (in `app-lifecycle.js`'s ready chain, after
  `initProfileAndStores`) `crashLog.pruneDumps(app.getPath('crashDumps'))`;
  `app.on('child-process-gone', (_e, details) => crashLog.record({ kind:
  kindOf(details.type) /* Electron's `type` is capitalised: 'GPU' → 'gpu',
  'Utility' → 'utility', everything else ('Zygote', 'Sandbox helper',
  'Pepper Plugin', 'Pepper Plugin Broker', 'Unknown') → 'other' — an
  explicit table, pinned */, reason:
  details.reason, exitCode: details.exitCode, url: null, partition: null,
  windowId: null, recovery: 'ignored' }))`. `app.log` gets one `warn` line
  per record via the injected logger (no url).

**Docs**
- `docs/dev-testing.md`: a "Crash records and dumps" section — where the
  file and dumps live under the dev profile, the field set, the redaction
  rule, that dumps are memory images and as sensitive as the profile,
  local-only, pruned to 20, deleted with the profile; how to trigger a
  crash for testing (`kill -SEGV` on the admin census `pid`).
- README: one bullet under the privacy posture — crash records are local,
  field-limited (no URLs, titles, or page data), and minidumps never leave
  the machine.
- `docs/mcp-automation.md`: `enumerateWindows` gains `chromePid` and
  `recoveryPaused`.
- CLAUDE.md: a "Crash and hang resilience" pattern section (guest crash
  panel + kill-reload flag; chrome recovery via boot-config `recoverTabs`,
  `sendOrQueue`, the cap; crash-log field allowlist as a security control;
  `crashReporter` placement rule) — concise, the "TLS trust" section's
  length.

**Tests**: `chrome-recovery.test.js` (new: `buildRecoveryAdopts` order,
active flag, trusted flag, container derivation table; three reloads in 60 s then pause;
timestamps outside the window do not count; paused ignores; hooks called in
order: sheet → find → tearoff → flags → record → reload; `restoreTabs`
untouched — assert the record still has it); `app-lifecycle` boot-config
pins (existing test file? locate; else a focused new test constructing the
handler with a fake registry): `recoverTabs` branch sends adopts in
insertion order with the active flag, then the re-push set, then the
deduped queue, returns `{ bootTab: false }` even when `restoreTabs` is set;
`register-tab-ipc.test.js` (`sendOrQueue` booted → send, unbooted → queued,
replayed after boot; the move/adopt block still sends its set via the
shared helper); `guest-wiring.test.js` (`sendToChrome` routes through
`sendOrQueue`); `crash-log.test.js` (new: the key-set source scan on the
writer's object literal; redaction table; burner null; goldfinch origin;
rotation; fail-soft; `pruneDumps` keeps newest N); a `main.js` source-scan
test (`crash-reporter-pins.test.js`: exactly one `crashReporter.start(`,
its literal contains `uploadToServer: false`, no `submitURL` and no
`addExtraParameter` anywhere in `src/`, and the `start(` index is greater
than the `setPath('userData'` index); `window-census.test.js` (`chromePid`,
`recoveryPaused`); `tab-controller.test.js` (`onAdoptTab` honours
`payload.trusted`); `move-tab-payload.test.js` or the move pins (a move
adopt never carries `trusted: true`).

## Acceptance Criteria

- [x] AC1 A chrome `render-process-gone` (non-`clean-exit`) closes the
      sheet with `teardown`, hides find/tearoff, resets `bootConfigServed`,
      sets `recoverTabs`, records `reloaded`, and calls `reload()`; a
      `clean-exit` is ignored (unit-pinned).
- [x] AC2 The fourth crash within 60 s of the first does NOT reload: it
      sets `recoveryPaused`, sets the title, records `paused`; a later crash
      on a paused record is `ignored`; crashes older than 60 s fall out of
      the ring (unit-pinned).
- [x] AC3 `window-boot-config` with `recoverTabs`: one `adopt-tab` per
      registry entry in insertion order (active flag on `activeTabWcId`;
      `trusted` from the entry; container derived main-side — burner (`:`→`-`), persistent,
      deleted-jar fallback, internal → the `id: 'internal'` container with
      `INTERNAL_PARTITION`, pinned; non-active entries carry `active: false`
      and `onAdoptTab` activates only when `active !== false`),
      then the shared re-push set for each, then the queued sends deduped
      last-wins per `(wcId, channel)`, returns `{ bootTab: false }`; with
      `restoreTabs` ALSO set, `recoverTabs` wins and `restoreTabs` is left
      intact (unit-pinned).
- [x] AC4 `sendOrQueue`: booted → immediate send; unbooted → queued and
      replayed after the adopts; `guest-wiring.js`'s `sendToChrome` uses it
      (grep-AC: zero `chromeForTab(wcId)?.send` in `wireTabViewEvents`).
- [x] AC5 `crash-log.js` writes exactly the eight allowed keys (source-scan
      pinned on the writer's literal); redaction table pinned (path/query/
      fragment/userinfo stripped; burner → `null`; `goldfinch://host`;
      unparsable → `null`); rotation at `cap`; never throws.
- [x] AC6 `crashReporter.start` pins: one call, `uploadToServer: false`, no
      `submitURL`/`addExtraParameter` in `src/`, textually after the
      `setPath('userData'` line (source-scan test).
- [x] AC7 `pruneDumps` keeps the newest 20 and is called at ready
      (unit-pinned + a grep-AC on the ready chain).
- [x] AC8 `child-process-gone` and popup crashes produce records with
      `kind` `gpu`/`utility`/`other`/`popup` (the capitalised-type table
      pinned), no `origin` for non-guest kinds, and guest/popup records
      carry `jarKind` and `windowId` (the three `onCrash` sites pinned to
      pass `partition` + `windowId`) (unit-pinned via the composition-root wiring test or a
      source-scan of the handler).
- [x] AC9 `enumerateWindows` rows carry `chromePid` (null when gone) and
      `recoveryPaused` (unit-pinned).
- [x] AC10 Live smoke: two guests open; `kill -SEGV <chromePid>` →
      `enumerateWindows` `booted` false → true within 15 s, `activeTabWcId`
      unchanged, `enumerateTabs` lists the same wcIds all `ok`, `chromePid`
      new; three more SEGVs within the same minute → after the fourth,
      `booted` stays false for 20 s and `recoveryPaused: true`;
      `crash-log.jsonl` tail: every line has exactly the eight keys, guest
      lines' `origin` is `http://127.0.0.2:{P}` with no path; a `.dmp`
      exists under the dev profile; the app process survives. Findings in
      the flight log; app log shredded.
- [x] AC11 Docs (four files) updated; `npm test`, `npm run lint`,
      `npm run typecheck`, `npm run format:check` exit 0; no key/pid/path in
      artifacts.

## Verification Steps

- AC1–AC3, AC5, AC7, AC9: `node --test test/unit/chrome-recovery.test.js
  test/unit/crash-log.test.js test/unit/window-census.test.js` plus the
  boot-config and register-tab-ipc suites.
- AC4: the grep, pasted.
- AC6: `node --test test/unit/crash-reporter-pins.test.js`.
- AC8: the wiring test.
- AC10: the smoke driver; census reads twice; the jsonl tail parsed by the
  driver (keys asserted in code, not by eye).
- AC11: the four scripts.

## Implementation Guidance

1. **Records first** (`crash-log.js` + tests + `main.js` placement + pins) —
   independent of recovery and the security-critical half.
2. **`sendOrQueue` + the shared `pushTabStateFor`** in `register-tab-ipc.js`;
   re-point the move/adopt block and `guest-wiring.js`'s `sendToChrome`.
3. **`chrome-recovery.js`** + tests; the `window-factory.js` hook; the
   `window-boot-config` `recoverTabs` branch with the dedupe; census fields.
4. **Wire `onCrash`** everywhere (guest wiring already calls it; the chrome
   hook and `child-process-gone` are new callers).
5. **Docs**, **smoke**, flight-log entry, leg `landed`, `flight.md` + CP3.

## Edge Cases

- **Crash during a pending cross-window move**: the move's queued adopt for
  the TARGET window is on the target record; recovery on the SOURCE record
  re-adopts whatever is still in its `tabViews`. No special case.
- **Zero tabs at recovery** (all closed just before): the branch sends no
  adopts and returns `{ bootTab: false }` → an empty chrome. Instead return
  `{ bootTab: !rec.noBootTab }` when `tabViews.size === 0` so the window
  gets a home/welcome tab as on a fresh boot (pinned).
- **The active tab is crashed/hung at recovery**: the re-push set carries
  `tab-crash`/`tab-hung`; the adopt's `activateTab` projects the panel/bar.
- **Recovery while the find overlay is open**: hidden by the hook; the
  chrome's per-tab `findOpen` state is lost (documented drop). Favicons are
  also dropped until each tab's next navigation (documented in CLAUDE.md's
  recovery bullet alongside welcome tabs, find text, and sheet content;
  internal `goldfinch://` tabs are NOT dropped — the trust bullet above).
- **`reload()` throws** (destroyed wc): guarded by `isDestroyed()`; if it
  throws anyway, catch, record `ignored`, and leave the window (never
  crash main).
- **Two windows crash in the same second**: independent rings, one reload
  each (pinned with two fake records).
- **`crash-log.jsonl` unwritable** (read-only userData): `record` warns once
  and returns; the app keeps running.
- **Dump directory absent** (no crash yet): `pruneDumps` returns silently.

## Files Affected

- `src/main/chrome-recovery.js` (new), `src/main/crash-log.js` (new)
- `src/main/app-lifecycle.js`, `src/main/register-tab-ipc.js`,
  `src/main/guest-wiring.js`, `src/main/window-factory.js`,
  `src/main/window-census.js`, `src/main/move-tab-payload.js`,
  `src/main/main.js`, `src/renderer/chrome/tab-controller.js` (`onAdoptTab`
  `trusted` — two lines; NOT `renderer.js`)
- `test/unit/chrome-recovery.test.js` (new), `crash-log.test.js` (new),
  `crash-reporter-pins.test.js` (new), `window-census.test.js`,
  `tab-controller.test.js`, `move-tab-payload.test.js`,
  `register-tab-ipc.test.js`, `guest-wiring.test.js`, the boot-config test
- `docs/dev-testing.md`, `docs/mcp-automation.md`, `README.md`, `CLAUDE.md`
- flight log, `flight.md`, this leg

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] Do NOT commit — the Flight Director commits after the flight-end review

## Citation Audit (2026-09-16, leg-2 tree)

Two design-review cycles; every `file:line` re-pointed to the leg-2 tree
(`guest-wiring.js:474/375/639/655`, `register-tab-ipc.js:78-88`, `:711-739`,
`window-factory.js:183-197/:224-230/:283-285/:287-358`, `window-census.js:107-130`,
`tab-controller.js:349/:1015-1027/:1111-1140`, `move-tab-payload.js:38-71/:83-94`,
`burner.js:35`, `main.js:1699/:1924`). Four post-cycle-2 point fixes folded by
the Flight Director (internal container, conditional activation,
`sendOrQueue` construction order, popup `windowId`) — verified by the review,
not re-reviewed; the flight-end Reviewer checks them.
