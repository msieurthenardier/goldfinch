# IPC Census — `src/main/**` (Flight 01, leg `probe-and-audit`, Q8)

**Status**: Track B deliverable. Static: no product source was changed; nothing was launched. Taken at HEAD `7e2d8c4` (v0.19.13 sources, branch `flight/01-page-containment`).

## Summary

| Measure | Count |
| --- | --- |
| IPC registrations (distinct channels) in `src/main/**` | **214** (every channel registered exactly once) |
| By registration form: `ipcMain.handle` (raw) | 89 |
| By registration form: `ipcMain.on` (raw) | 51 |
| By registration form: `registerInternalHandler` (direct) | 60 |
| By registration form: `registerInternal` (alias, `jar-registry-ipc.js` + `jar-data-ipc.js`) | 14 |
| Other forms (`once`, `handleOnce`, `addListener`, `removeHandler`, computed names at call sites) | 0 |
| State-changing / read-only | 160 / 54 |
| By sender check today: internal-gated (`registerInternalHandler`) | 74 |
| By sender check today: refusing (chrome 44, ownsTab 7, sheet 19, find 2, save-prompt 6) | **78** |
| By sender check today: sender looked up, never refused (`download-media`, `choose-download-dir`) | 2 |
| By sender check today: none — bare, state-changing (29) + bare, read-only (18) | **47** |
| By sender check today: guest-preload channels (sender-derived, no refusal) | 13 |

Caller class under DD1 (proposed; the leg that migrates a channel confirms it):

| Class | Count |
| --- | --- |
| internal (`registerInternalHandler`) | 74 |
| chrome | 59 |
| owning-chrome-of-wcId | 31 |
| overlay sender (sheet 19, find 2, save prompt 6) | 27 |
| tab guest | 13 |
| open-with-reason | 1 (`automation:get-activity`) |
| undecided (no caller in any preload — delete-or-gate decision) | 9 |
| **Total** | **214** |

**Reconciliation, one line each.** Recon "214 including `registerInternalHandler` sites" — **matches exactly** (74 internal + 140 raw). Design review "90 `handle` + 51 `on` raw" — **141 raw call sites = 140 channels + 1 non-channel site** (`internal-ipc.js:72`, the `ipcMain.handle(channel, …)` inside `registerInternalHandler` itself, a computed name that is the wrapper, not a registration). Recon "79 with a refusing sender check, 46 bare" — **this census has 78 refusing and 47 bare**: the one difference is `tab-reopen` (`register-tab-ipc.js:461`), which the recon counted among the refusing handlers because its body calls `registry.getWindowForChrome(event.sender)`, but only AFTER popping the closed-tab stack and only to compute `stripIndex` — it never refuses. It is state-changing and bare, so it joins the bare-state-changing set (28 → 29 in the recon's list). Details in the reconciliation section below.

## Method (reproducible)

All commands run from the repository root. `src/main/**` includes `src/main/automation/` and `src/main/vault/` (no registration exists in either).

1. **Raw registrations** (one per line in the source, all forms):
   ```
   grep -rnE "ipcMain\.handle\(" src/main | wc -l          # 90
   grep -rnE "ipcMain\.on\(" src/main | wc -l              # 51
   grep -rnE "ipcMain\.(once|handleOnce|addListener|removeHandler|removeAllListeners|off|removeListener|prependListener)\b" src/main | wc -l   # 0
   grep -rnE "ipcMain\.(handle|on)\(" src/main | grep -v "ipcMain\.\(handle\|on\)('"   # one line: internal-ipc.js:72 (computed `channel`)
   ```
2. **Internal-wrapper registrations** (multi-line call sites, so a PCRE zero-terminated scan rather than `grep -c`):
   ```
   grep -rPzo "registerInternal(Handler)?\(\s*ipcMain,\s*'[^']+'" src/main | tr '\0' '\n' | grep -c "registerInternal"           # 74
   grep -rPzo "registerInternalHandler\(\s*ipcMain,\s*'[^']+'" src/main | tr '\0' '\n' | grep -c "registerInternalHandler"   # 60
   grep -rPzo "registerInternal\(\s*ipcMain,\s*'[^']+'" src/main | tr '\0' '\n' | grep -c "registerInternal("               # 14 (alias)
   ```
   The alias is defined by default parameters: `registerInternal = registerInternalHandler` (`jar-registry-ipc.js:10`, `jar-data-ipc.js:14`). No other alias, and no other helper registers on a caller's behalf (`registerOverlayIpc`, `registerSavePromptIpc`, … take `ipcMain` by injection and call `ipcMain.handle/on` directly, so they are covered by step 1).
3. **AST cross-check** (catches handlers that are inline vs by reference, `catchLocked(...)` wrappers, conditional registration, and the enclosing symbol). Throwaway script, not committed: `acorn` (already in `node_modules`) walks every `.js/.cjs/.mjs` under `src/main`, records every `ipcMain.<m>(…)`, `registerInternalHandler(ipcMain, …)` and `registerInternal(ipcMain, …)` call with its first-literal channel, handler argument kind, enclosing function and any enclosing `if`. It reported **215 call sites = 214 channels + the one wrapper site above**, **214 distinct channel names (no duplicates)**, matching steps 1–2 exactly (90 + 51 + 60 + 14 = 215).
4. **Sender side** (channels the chrome/internal/overlay/guest preloads send), literal channels:
   ```
   grep -rhoE "ipcRenderer\.(send|invoke|sendSync)\('[^']+'" src --include=*.js --exclude='*bundle*' --exclude='*generated*' | sed -E "s/.*\('//; s/'$//" | sort -u | wc -l   # 200
   grep -rnE "ipcRenderer\.(send|invoke|sendSync)\([^']" src --include=*.js --exclude='*bundle*' --exclude='*generated*'   # the 2 non-literal sends, below
   ```
   The two non-literal sends are `webview-preload.js:608` (`ipcRenderer.send(c.channel, c.payload)`, the `for (const c of plan)` loop; `c.channel` is one of `guest-vault-capture`, `guest-vault-capture-card`, `guest-vault-capture-identity` — `vault-capture-plan.js:97,133,183,253`) and `guest-bookmark-drop.js:145` (`GUEST_BOOKMARK_DROP_CHANNEL = 'guest-bookmark-drop'`, line 49). With those four resolved, **204 distinct channels are sent**, against **214 registered**.
   ```
   comm -23 <sent> <registered>   # sent but never registered: EMPTY
   comm -13 <sent> <registered>   # registered but not sent literally: 14 names, 4 of them the indirect sends above
   ```
   `ipcRenderer.postMessage` / `sendToHost` do not appear in any non-bundle source. The bundles (`webview-preload.bundle.js`, `internal-preload.bundle.js`) are generated from the sources scanned; they were excluded.

## Flags

**Channels registered more than once**: none. 214 registrations, 214 distinct names. (The same *handler body* is registered under two names in 20 pairs — see "Twin registrations" — which is a different thing.)

**Channels registered by a computed (non-literal) name**: none among the 214. The single computed site is `internal-ipc.js:72`, the wrapper's own `ipcMain.handle(channel, …)`; every one of the 74 call sites passes a string literal. A guard that scans for `ipcMain.handle(` must either treat this site as the sanctioned wrapper body (DD2's "sanctioned-wrapper bodies blanked") or it will see an unclassifiable computed channel.

**Handlers passed by reference rather than inline** (a guard that reads the handler's text inline would miss them): 47 registrations —
- `history-ipc.js`: 12 (`handlePage`, `handleSearch`, `handleDelete`, `handleClear`, `handleCount`, `handleSuggest`, each registered twice)
- `jar-registry-ipc.js`: 12 (`handleList` … `handleRemove`, each twice)
- `jar-data-ipc.js`: 15 (`handleClearData` … `handleSiteDataRemoveOrigin`; `handleCookiesValue` is internal-only)
- `register-bookmarks-ipc.js`: 6 (`handleGet` … `handleSuggest`)
- `register-settings-ipc.js`: 2 (`isolationState`, registered as `shields-isolation-state` and `internal-shields-isolation-state`)
And 7 registrations whose handler is a call expression, `catchLocked((event, payload) => …)`, in `register-vault-ipc.js` (`internal-vault-list`, `-reveal`, `-item-save`, `-totp-code`, `-item-delete`, `-accesskey-list`, `-accesskey-revoke`). All the rest (160 channels + the wrapper) are inline arrow functions. A scan that only recognises an inline arrow function as the second argument would miss 54.

**Conditional registrations** (inside an `if` on an injected dependency, so a scan of a running app sees fewer channels than the census): 28 — `automation:dev-invoke` (`!app.isPackaged && isMcpAutomationEnabled(argv)`); in `register-browser-ipc.js`: `internal-vault-pick-import-file`, `-clear-pending-import`, `-import-labels`, `-import-commit`, `-sever-dismiss`, `-browser-import-pick`, `-browser-import-summary`, `-browser-import-cancel`, `-browser-import-commit`; in `register-overlay-ipc.js`: the ten `menu-overlay:vault-*` sheet channels, `copy-text`, `auth-submit`, `bookmark-edit-submit`, `cert-override-proceed`; in `register-vault-ipc.js`: `internal-vault-compromise-dismiss`, `-export`, `-export-profile`, `-pick-save-path`. The conditions are all injected-dependency presence checks (offline test harnesses omit them); in the real boot every one is supplied.

**Channels a preload sends that have no main-side registration**: **none**. Every one of the 204 distinct sent channels is registered.

**Channels registered that no source in `src/` sends** (10; the 4 indirect-send names are excluded): `history-page`, `history-search`, `history-delete`, `history-clear`, `history-count`, `jars-cookies-list`, `jars-cookies-remove`, `jars-sitedata-list`, `jars-sitedata-remove-origin` — nine bare twins for which no chrome-preload bridge method exists (the jars page is internal and uses the `internal-*` twins) — and `internal-history-suggest` (registered-but-unused by a DD3 comment, `history-ipc.js:191-193`). Nine of the ten are bare, state-changing or reading per-jar data with no sender check: removing them closes finding 1q/1r for those twins without a gate (DD2 offers "chrome gate, or delete unused twins"). They are marked `undecided` below for that reason.

**Channels sent by more than one preload**: `automation:get-activity` (chrome-preload + internal-preload; bare by CLAUDE.md design, class open-with-reason); `find-overlay:close` (chrome-preload + find-overlay-preload; handler accepts both); `guest-tab-boundary` (web guests via `webview-preload.js:96` AND internal-page tabs via `internal-preload.js` — so the `tab guest` class must admit trusted internal tabs, not only web tabs).

### Twin registrations (same handler body, two channel names)

20 pairs, 40 registrations: `history-*` ↔ `internal-history-*` ×6; `jars-{list,add,rename,set-default,get-default,remove}` ↔ `internal-jars-*` ×6; `jars-{clear-data,wipe,set-retention,cookies-list,cookies-remove,sitedata-list,sitedata-remove-origin}` ↔ `internal-jars-*` ×7; `shields-isolation-state` ↔ `internal-shields-isolation-state` ×1. (`jars-cookies-value` has deliberately NO bare twin — squawk 0141, `jar-data-ipc.js:428`.) `settings-get`/`shields-get` also have internal twins (`internal-settings-get`, `internal-shields-get`) but with separate inline bodies. The standing guard's classification table should key on channel, not on body.

## Reconciliation against the two earlier counts

### Recon (214: 74 internal, 79 refusing, 2 non-refusing, 46 bare, 13 guest)

| Recon group | Recon | This census | Difference, by channel |
| --- | --- | --- | --- |
| `registerInternalHandler` / alias | 74 | 74 | none |
| Refusing sender check | 79 | 78 | **−1**: `tab-reopen` (see above) moves to bare |
| Sender looked up, never refused | 2 | 2 | none: `download-media`, `choose-download-dir` |
| Bare | 46 | 47 | **+1**: `tab-reopen` (state-changing; pops the global closed-tab stack and broadcasts `closed-tab-stack-changed` for ANY sender; only the returned `stripIndex` consults the sender) |
| Guest-preload channels | 13 | 13 | none: `shields-farble`, `vault-eligible`, `guest-vault-gesture`, `guest-tab-boundary`, `guest-vault-icon-menu`, `guest-vault-capture`, `-card`, `-identity`, `guest-vault-gesture-settle`, `guest-media-list`, `guest-privacy-fp`, `guest-window-close`, `guest-bookmark-drop` |
| **Total** | 214 | 214 | |

Refusing, by helper — recon: `recordForSheetSender` 19, `recordForFindSender` 2, save-prompt 6, `ownsTab` 7, `requireChrome`/inline `getWindowForChrome` "~45". This census: sheet **19**, find **2**, save-prompt **6**, `ownsTab` **7**, chrome-class (inline or `requireChrome`) **44** (recon's ~45 minus `tab-reopen` = 44). Bare, state-changing: recon 28, this census **29** (+ `tab-reopen`). Bare, read-only: recon 18, this census **18** (identical set).

Refusing handlers weaker than the label suggests: **13** channels are classed `owning-chrome-of-wcId` and refuse non-chrome senders, but take a `wcId`/`webContentsId` payload without comparing it to the sender's window: `rescan-media`, `zoom-apply`, `get-zoom`, `print`, `toggle-devtools`, `is-devtools-open`, `page-context-correct`, `page-context-action`, `privacy-cookies`, `privacy-clear-cookies`, `privacy-clear-storage`, `find-overlay:open`, `tab-history-snapshot`. Window B's chrome can name window A's tab (or any non-internal webContents, including a chrome or overlay view for the `externalContents` ones) through these. The other seven channels in the class with a `CHROME` check today (`vault-fill-generated`, `vault-capture-finalize`, `tab-move-to-new-window`, `tab-move-to-window`, `tab-tear-off`, `tab-drag-started`, `tab-drag-ended`) already enforce ownership one step deeper. Moving the thirteen to the owning-chrome class is a tightening DD1 delivers; no flow of the real chrome is known to depend on cross-window naming (not live-tested here).

### Design review (90 `handle` + 51 `on` raw = 141)

141 = 140 raw channels + 1 wrapper site. The 140 raw channels split into **89 `handle`** (the 90th `handle` site is `internal-ipc.js:72`) and **51 `on`**. The 74 `registerInternalHandler`/alias channels are NOT in the 141 (each wraps an `ipcMain.handle` inside the wrapper, at the single wrapper site). 140 + 74 = 214. The review's "48 registrations move (46 bare + 2 non-refusing)" becomes **49** with `tab-reopen` (47 bare + 2 non-refusing), and the 13 guest channels are separate from that 49 — they move in `ipc-gate-complete`, as the flight's leg list already has it.

The 51 raw `ipcMain.on` channels: 13 are the guest-preload channels (all of them; `shields-farble` and `vault-eligible` synchronous), the other 38 are chrome/overlay one-way sends (`window-*`, `app-quit`, `tab-*`, `zoom-apply`, `print`, `rescan-media`, `unpin-toolbar-item`, `toggle-bookmarks-bar`, bookmark/tab drag, overlays). The only raw `on` channels that carry a synchronous reply are the two guest ones.

## Caller-class legend

- **chrome** — a sender for which `registry.getWindowForChrome(sender)` is non-null (any window's chrome view).
- **owning-chrome-of-wcId** — the sender's window record must equal `registry.getWindowForGuest(wcId)` (today's `ownsTab`).
- **tab guest** — the main frame of a webContents in some window's `tabViews` (web or trusted-internal tab) or in the popup registry (DD1). See `guard-audit.md` Q7 for what that means for popups.
- **internal** — `registerInternalHandler`.
- **overlay sender** — the per-window sheet (`recordForSheetSender`), find overlay (`recordForFindSender`) or save-prompt view (`recordForPromptSender`).
- **open-with-reason** — deliberately open; needs a written reason string.
- **undecided** — no caller in any source file; the migration leg chooses delete or chrome gate.
- Check "today": `INT` = `registerInternalHandler`; `CHROME` = `getWindowForChrome(sender)` inline or via the closure-local `requireChrome` (duplicated at `register-tab-ipc.js:194`, `register-browser-ipc.js:91`, inline `main.js:2567`); `OWNER` = `ownsTab` (`register-tab-ipc.js:197`); `SHEET`/`FIND`/`PROMPT` = `registry.recordForOverlaySender(sender, key)` (`window-registry.js`); `none` = no sender comparison at all; "sender-derived" = the handler reads `event.sender.id` to find the tab but refuses nothing.
- S = state-changing, R = read-only. Judged by reading each handler, not from its name (read-only handlers that return secrets are marked in the notes).

## The census

One row per channel, ordered by file then line. `file:line (symbol)` is the registration call and its enclosing function. "Sent by" = the preload(s) that send the channel (`none` = no sender in `src/`).

| # | Channel | Form | file:line (symbol) | S/R | Sender check today | Caller class (DD1) | Sent by | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `window-boot-config` | ipcMain.handle | `app-lifecycle.js:260` (registerAppLifecycle) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | non-chrome sender gets the default `{bootTab:true}`; no mutation |
| 2 | `app-quit` | ipcMain.on | `app-lifecycle.js:323` (registerAppLifecycle) | S | none | chrome | chrome-preload | `.on` — reachable by `send` alone |
| 3 | `automation:dev-invoke` | ipcMain.handle | `app-lifecycle.js:437` (registerAppLifecycle) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | registered only when unpackaged and MCP flag set (conditional); throws on non-chrome |
| 4 | `history-page` | ipcMain.handle | `history-ipc.js:183` (registerHistoryIpc) | R | none | undecided | none | bare twin; NO caller in any preload (delete candidate); by reference |
| 5 | `history-search` | ipcMain.handle | `history-ipc.js:184` (registerHistoryIpc) | R | none | undecided | none | bare twin; NO caller in any preload; by reference |
| 6 | `history-delete` | ipcMain.handle | `history-ipc.js:185` (registerHistoryIpc) | S | none | undecided | none | bare twin; NO caller in any preload; by reference |
| 7 | `history-clear` | ipcMain.handle | `history-ipc.js:186` (registerHistoryIpc) | S | none | undecided | none | bare twin; NO caller in any preload; by reference |
| 8 | `history-count` | ipcMain.handle | `history-ipc.js:187` (registerHistoryIpc) | R | none | undecided | none | bare twin; NO caller in any preload; by reference |
| 9 | `history-suggest` | ipcMain.handle | `history-ipc.js:188` (registerHistoryIpc) | R | none | chrome | chrome-preload | bare twin used by chrome-preload (omnibox); by reference |
| 10 | `internal-history-page` | registerInternalHandler | `history-ipc.js:194` (registerHistoryIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 11 | `internal-history-search` | registerInternalHandler | `history-ipc.js:195` (registerHistoryIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 12 | `internal-history-delete` | registerInternalHandler | `history-ipc.js:196` (registerHistoryIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 13 | `internal-history-clear` | registerInternalHandler | `history-ipc.js:197` (registerHistoryIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 14 | `internal-history-count` | registerInternalHandler | `history-ipc.js:198` (registerHistoryIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 15 | `internal-history-suggest` | registerInternalHandler | `history-ipc.js:199` (registerHistoryIpc) | R | `registerInternalHandler` (origin + internal session) | internal | none | registered, no caller in any preload (DD3 comment) |
| 16 | `jars-clear-data` | ipcMain.handle | `jar-data-ipc.js:422` (registerJarDataIpc) | S | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 17 | `jars-wipe` | ipcMain.handle | `jar-data-ipc.js:423` (registerJarDataIpc) | S | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 18 | `jars-set-retention` | ipcMain.handle | `jar-data-ipc.js:424` (registerJarDataIpc) | S | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 19 | `jars-cookies-list` | ipcMain.handle | `jar-data-ipc.js:425` (registerJarDataIpc) | R | none | undecided | none | bare twin; NO caller in any preload (delete candidate); by reference |
| 20 | `jars-cookies-remove` | ipcMain.handle | `jar-data-ipc.js:426` (registerJarDataIpc) | S | none | undecided | none | bare twin; NO caller in any preload; by reference |
| 21 | `jars-sitedata-list` | ipcMain.handle | `jar-data-ipc.js:429` (registerJarDataIpc) | R | none | undecided | none | bare twin; NO caller in any preload; by reference |
| 22 | `jars-sitedata-remove-origin` | ipcMain.handle | `jar-data-ipc.js:430` (registerJarDataIpc) | S | none | undecided | none | bare twin; NO caller in any preload; by reference |
| 23 | `internal-jars-clear-data` | registerInternal | `jar-data-ipc.js:432` (registerJarDataIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 24 | `internal-jars-wipe` | registerInternal | `jar-data-ipc.js:433` (registerJarDataIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 25 | `internal-jars-set-retention` | registerInternal | `jar-data-ipc.js:434` (registerJarDataIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 26 | `internal-jars-cookies-list` | registerInternal | `jar-data-ipc.js:435` (registerJarDataIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 27 | `internal-jars-cookies-remove` | registerInternal | `jar-data-ipc.js:436` (registerJarDataIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 28 | `internal-jars-cookies-value` | registerInternal | `jar-data-ipc.js:437` (registerJarDataIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload | returns one cookie VALUE (finding 5) |
| 29 | `internal-jars-sitedata-list` | registerInternal | `jar-data-ipc.js:438` (registerJarDataIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 30 | `internal-jars-sitedata-remove-origin` | registerInternal | `jar-data-ipc.js:439` (registerJarDataIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 31 | `jars-list` | ipcMain.handle | `jar-registry-ipc.js:144` (registerJarRegistryIpc) | R | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 32 | `jars-add` | ipcMain.handle | `jar-registry-ipc.js:145` (registerJarRegistryIpc) | S | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 33 | `jars-rename` | ipcMain.handle | `jar-registry-ipc.js:146` (registerJarRegistryIpc) | S | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 34 | `jars-set-default` | ipcMain.handle | `jar-registry-ipc.js:147` (registerJarRegistryIpc) | S | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 35 | `jars-get-default` | ipcMain.handle | `jar-registry-ipc.js:148` (registerJarRegistryIpc) | R | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 36 | `jars-remove` | ipcMain.handle | `jar-registry-ipc.js:149` (registerJarRegistryIpc) | S | none | chrome | chrome-preload | bare twin used by chrome-preload; by reference |
| 37 | `internal-jars-list` | registerInternal | `jar-registry-ipc.js:151` (registerJarRegistryIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 38 | `internal-jars-add` | registerInternal | `jar-registry-ipc.js:152` (registerJarRegistryIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 39 | `internal-jars-rename` | registerInternal | `jar-registry-ipc.js:153` (registerJarRegistryIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 40 | `internal-jars-set-default` | registerInternal | `jar-registry-ipc.js:154` (registerJarRegistryIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 41 | `internal-jars-get-default` | registerInternal | `jar-registry-ipc.js:155` (registerJarRegistryIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 42 | `internal-jars-remove` | registerInternal | `jar-registry-ipc.js:156` (registerJarRegistryIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 43 | `vault-lock-state-get` | ipcMain.handle | `main.js:2489` ((top)) | R | none | chrome | chrome-preload |  |
| 44 | `vault-automation-held-get` | ipcMain.handle | `main.js:2494` ((top)) | R | none | chrome | chrome-preload |  |
| 45 | `vault-lock` | ipcMain.handle | `main.js:2506` ((top)) | S | none | chrome | chrome-preload | global lock |
| 46 | `vault-reachable-items` | ipcMain.handle | `main.js:2541` ((top)) | R | none | owning-chrome-of-wcId | chrome-preload | payload `wcId`; returns picker metadata for ANY tab |
| 47 | `vault-fill-human` | ipcMain.handle | `main.js:2545` ((top)) | S | none | owning-chrome-of-wcId | chrome-preload | payload `wcId`; no owner, no active-tab check (DD4/DD6) |
| 48 | `vault-fill-generated` | ipcMain.handle | `main.js:2565` ((top)) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | inline: sender chrome record must equal `getWindowForGuest(wcId)` |
| 49 | `bookmarks-get` | ipcMain.handle | `register-bookmarks-ipc.js:111` (registerBookmarksIpc) | R | none | chrome | chrome-preload | by reference (`handleGet`) |
| 50 | `bookmark-add` | ipcMain.handle | `register-bookmarks-ipc.js:112` (registerBookmarksIpc) | S | none | chrome | chrome-preload | by reference |
| 51 | `bookmark-update` | ipcMain.handle | `register-bookmarks-ipc.js:113` (registerBookmarksIpc) | S | none | chrome | chrome-preload | by reference |
| 52 | `bookmark-remove` | ipcMain.handle | `register-bookmarks-ipc.js:114` (registerBookmarksIpc) | S | none | chrome | chrome-preload | by reference |
| 53 | `bookmark-reorder` | ipcMain.handle | `register-bookmarks-ipc.js:115` (registerBookmarksIpc) | S | none | chrome | chrome-preload | by reference |
| 54 | `bookmarks-suggest` | ipcMain.handle | `register-bookmarks-ipc.js:116` (registerBookmarksIpc) | R | none | chrome | chrome-preload | by reference |
| 55 | `shields-farble` | ipcMain.on | `register-browser-ipc.js:108` (registerBrowserIpc) | R | none (sender-derived `event.sender.id`) | tab guest | webview-preload | SYNC (`event.returnValue`); any sender; reply derived from guest-supplied `url` + sender session seed |
| 56 | `window-minimize` | ipcMain.on | `register-browser-ipc.js:116` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 57 | `window-toggle-maximize` | ipcMain.on | `register-browser-ipc.js:119` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 58 | `window-close` | ipcMain.on | `register-browser-ipc.js:125` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 59 | `window-is-maximized` | ipcMain.handle | `register-browser-ipc.js:128` (registerBrowserIpc) | R | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 60 | `window-create` | ipcMain.handle | `register-browser-ipc.js:132` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 61 | `new-container-create` | ipcMain.handle | `register-browser-ipc.js:136` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 62 | `vault-eligible` | ipcMain.on | `register-browser-ipc.js:152` (registerBrowserIpc) | R | none (sender-derived `event.sender.id`) | tab guest | webview-preload | SYNC; answer derived from registry by sender id (non-tab sender → `eligible:false`); also returns vault `unlocked` |
| 63 | `guest-vault-gesture` | ipcMain.on | `register-browser-ipc.js:174` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | vault-fill-icon | forwards `vault-gesture` to owning chrome; no active-tab check, no rate limit, no eligibility check |
| 64 | `guest-tab-boundary` | ipcMain.on | `register-browser-ipc.js:188` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | internal-preload, webview-preload | sent by web guests AND internal-page tabs (`internal-preload`); chrome handler moves focus unconditionally |
| 65 | `guest-vault-icon-menu` | ipcMain.on | `register-browser-ipc.js:203` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | vault-fill-icon | pops a native menu (Lock now / Fill login…) on the sender's window; no active-tab check |
| 66 | `guest-vault-capture` | ipcMain.on | `register-browser-ipc.js:222` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload(via vault-capture-plan) | holds a gesture-time read keyed by sender wcId; tab/jar/vault-set-up gates in `holdGestureLogin` |
| 67 | `guest-vault-capture-card` | ipcMain.on | `register-browser-ipc.js:243` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload(via vault-capture-plan) | same, `holdGestureCard` |
| 68 | `guest-vault-capture-identity` | ipcMain.on | `register-browser-ipc.js:263` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload(via vault-capture-plan) | same, `holdGestureIdentity` |
| 69 | `guest-vault-gesture-settle` | ipcMain.on | `register-browser-ipc.js:288` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload | releases the sender tab's held captures; offers only presented when sender is its window's active tab |
| 70 | `vault-capture-dismiss` | ipcMain.handle | `register-browser-ipc.js:315` (registerBrowserIpc) | S | none | owning-chrome-of-wcId | chrome-preload | payload `captureId`; no owner check (resolve owner via `captureTabOf`) |
| 71 | `vault-capture-finalize` | ipcMain.handle | `register-browser-ipc.js:335` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | inline: caller chrome === owner of `captureTabOf(captureId)`, and tab active |
| 72 | `internal-vault-request-setup` | registerInternalHandler | `register-browser-ipc.js:372` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 73 | `internal-vault-request-unlock` | registerInternalHandler | `register-browser-ipc.js:376` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 74 | `internal-vault-request-mint` | registerInternalHandler | `register-browser-ipc.js:391` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 75 | `internal-vault-pick-import-file` | registerInternalHandler | `register-browser-ipc.js:429` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 76 | `internal-vault-begin-import-unlock` | registerInternalHandler | `register-browser-ipc.js:433` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 77 | `internal-vault-clear-pending-import` | registerInternalHandler | `register-browser-ipc.js:438` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 78 | `internal-vault-import-labels` | registerInternalHandler | `register-browser-ipc.js:444` (registerBrowserIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 79 | `internal-vault-import-commit` | registerInternalHandler | `register-browser-ipc.js:449` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 80 | `internal-vault-sever-dismiss` | registerInternalHandler | `register-browser-ipc.js:458` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 81 | `internal-vault-browser-import-pick` | registerInternalHandler | `register-browser-ipc.js:470` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 82 | `internal-vault-browser-import-summary` | registerInternalHandler | `register-browser-ipc.js:475` (registerBrowserIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 83 | `internal-vault-browser-import-cancel` | registerInternalHandler | `register-browser-ipc.js:480` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 84 | `internal-vault-browser-import-commit` | registerInternalHandler | `register-browser-ipc.js:486` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 85 | `internal-vault-request-rotate-recovery` | registerInternalHandler | `register-browser-ipc.js:503` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 86 | `internal-vault-request-rotate-admin` | registerInternalHandler | `register-browser-ipc.js:510` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 87 | `internal-vault-request-change-master` | registerInternalHandler | `register-browser-ipc.js:514` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 88 | `internal-vault-request-recover` | registerInternalHandler | `register-browser-ipc.js:518` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 89 | `internal-vault-request-compromise` | registerInternalHandler | `register-browser-ipc.js:528` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 90 | `guest-media-list` | ipcMain.on | `register-browser-ipc.js:533` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload | forwards guest-supplied list to owning chrome; payload not validated main-side |
| 91 | `guest-privacy-fp` | ipcMain.on | `register-browser-ipc.js:537` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload | forwards guest-supplied counts to owning chrome; payload not validated main-side |
| 92 | `guest-window-close` | ipcMain.on | `register-browser-ipc.js:548` (registerBrowserIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload | popup branch destroys the popup's own window; tab branch asks owning chrome to close the sender tab |
| 93 | `rescan-media` | ipcMain.on | `register-browser-ipc.js:566` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | payload `wcId`; chrome-only today |
| 94 | `zoom-apply` | ipcMain.on | `register-browser-ipc.js:584` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | payload `webContentsId` (any non-internal contents); chrome-only today |
| 95 | `get-zoom` | ipcMain.handle | `register-browser-ipc.js:589` (registerBrowserIpc) | R | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same |
| 96 | `print` | ipcMain.on | `register-browser-ipc.js:592` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same |
| 97 | `toggle-devtools` | ipcMain.handle | `register-browser-ipc.js:600` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same |
| 98 | `is-devtools-open` | ipcMain.handle | `register-browser-ipc.js:605` (registerBrowserIpc) | R | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same |
| 99 | `page-context-correct` | ipcMain.handle | `register-browser-ipc.js:610` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same |
| 100 | `page-context-action` | ipcMain.handle | `register-browser-ipc.js:620` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same; action allowlisted |
| 101 | `internal-open-tab-in-jar` | registerInternalHandler | `register-browser-ipc.js:629` (registerBrowserIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload | URL re-validated with isSafeTabUrl main-side |
| 102 | `identity-new` | ipcMain.handle | `register-browser-ipc.js:642` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | payload `partition`; refuses the internal session |
| 103 | `privacy-cookies` | ipcMain.handle | `register-browser-ipc.js:659` (registerBrowserIpc) | R | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | payload `webContentsId` |
| 104 | `privacy-clear-cookies` | ipcMain.handle | `register-browser-ipc.js:687` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | payload `webContentsId` |
| 105 | `privacy-clear-storage` | ipcMain.handle | `register-browser-ipc.js:713` (registerBrowserIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | payload `webContentsId` |
| 106 | `download-media` | ipcMain.handle | `register-download-ipc.js:48` (registerDownloadIpc) | S | none (sender looked up, never refused) | owning-chrome-of-wcId | chrome-preload | sender looked up with `getLastFocused()` fallback, never refused; payload `webContentsId` picks the downloading session; `url` not scheme-checked main-side |
| 107 | `choose-download-dir` | ipcMain.handle | `register-download-ipc.js:77` (registerDownloadIpc) | S | none (sender looked up, never refused) | chrome | chrome-preload | same fallback; native dialog; adds to `approvedDownloadDirs` |
| 108 | `show-item-in-folder` | ipcMain.handle | `register-download-ipc.js:90` (registerDownloadIpc) | S | none | chrome | chrome-preload | path must be an approved dir or a known save path |
| 109 | `downloads-snapshot` | ipcMain.handle | `register-download-ipc.js:119` (registerDownloadIpc) | R | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 110 | `open-downloaded-file` | ipcMain.handle | `register-download-ipc.js:142` (registerDownloadIpc) | S | none | chrome | chrome-preload | `shell.openPath`; completed-record gate |
| 111 | `reveal-downloaded-file` | ipcMain.handle | `register-download-ipc.js:154` (registerDownloadIpc) | S | none | chrome | chrome-preload |  |
| 112 | `internal-downloads-list` | registerInternalHandler | `register-download-ipc.js:199` (registerDownloadIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 113 | `internal-downloads-action` | registerInternalHandler | `register-download-ipc.js:201` (registerDownloadIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 114 | `internal-downloads-clear` | registerInternalHandler | `register-download-ipc.js:244` (registerDownloadIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 115 | `menu-overlay:open` | ipcMain.on | `register-overlay-ipc.js:134` (registerOverlayIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 116 | `menu-overlay:close` | ipcMain.on | `register-overlay-ipc.js:156` (registerOverlayIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 117 | `menu-overlay:activated` | ipcMain.on | `register-overlay-ipc.js:163` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token, `current` menu |
| 118 | `menu-overlay:dismissed` | ipcMain.on | `register-overlay-ipc.js:205` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token |
| 119 | `menu-overlay:refocus` | ipcMain.on | `register-overlay-ipc.js:223` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | sheet identity + window focused; no token |
| 120 | `menu-overlay:vault-unlock` | ipcMain.handle | `register-overlay-ipc.js:241` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 121 | `menu-overlay:vault-setup` | ipcMain.handle | `register-overlay-ipc.js:279` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 122 | `menu-overlay:vault-stepup-mint` | ipcMain.handle | `register-overlay-ipc.js:316` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 123 | `menu-overlay:vault-import` | ipcMain.handle | `register-overlay-ipc.js:373` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 124 | `menu-overlay:vault-rotate-recovery` | ipcMain.handle | `register-overlay-ipc.js:418` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 125 | `menu-overlay:vault-rotate-admin` | ipcMain.handle | `register-overlay-ipc.js:462` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 126 | `menu-overlay:vault-change-master` | ipcMain.handle | `register-overlay-ipc.js:500` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 127 | `menu-overlay:vault-recover` | ipcMain.handle | `register-overlay-ipc.js:538` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 128 | `menu-overlay:vault-compromise` | ipcMain.handle | `register-overlay-ipc.js:595` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token + menuType `vault-compromise` |
| 129 | `menu-overlay:vault-compromise-recover` | ipcMain.handle | `register-overlay-ipc.js:642` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token + menuType `vault-compromise-recover` |
| 130 | `menu-overlay:copy-text` | ipcMain.on | `register-overlay-ipc.js:685` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | sender identity ONLY (no token, no menuType) (22a); writes clipboard, no clear timer |
| 131 | `menu-overlay:auth-submit` | ipcMain.handle | `register-overlay-ipc.js:704` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 132 | `menu-overlay:bookmark-edit-submit` | ipcMain.handle | `register-overlay-ipc.js:766` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token; NO menuType guard (22a) |
| 133 | `menu-overlay:overflow-drop` | ipcMain.on | `register-overlay-ipc.js:834` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token + menuType `bookmarks-overflow` |
| 134 | `menu-overlay:cert-override-proceed` | ipcMain.handle | `register-overlay-ipc.js:888` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token + menuType `cert-override` + entry gate (four guards) |
| 135 | `menu-overlay:sheet-drag` | ipcMain.on | `register-overlay-ipc.js:961` (registerOverlayIpc) | S | `recordForSheetSender` | overlay sender | menu-overlay-preload | + token + menuType on `start`; `end` only sender + token type |
| 136 | `find-overlay:open` | ipcMain.on | `register-overlay-ipc.js:980` (registerOverlayIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | payload `wcId`; opens on `getWindowForGuest(wcId)` without comparing it to the sender's window |
| 137 | `find-overlay:close` | ipcMain.on | `register-overlay-ipc.js:986` (registerOverlayIpc) | S | `recordForFindSender` (+ chrome on `close`) | overlay sender | chrome-preload, find-overlay-preload | find overlay sender OR owning chrome |
| 138 | `find-overlay:query` | ipcMain.on | `register-overlay-ipc.js:998` (registerOverlayIpc) | S | `recordForFindSender` (+ chrome on `close`) | overlay sender | find-overlay-preload |  |
| 139 | `tearoff-overlay:show` | ipcMain.on | `register-overlay-ipc.js:1004` (registerOverlayIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 140 | `tearoff-overlay:move` | ipcMain.on | `register-overlay-ipc.js:1008` (registerOverlayIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 141 | `tearoff-overlay:hide` | ipcMain.on | `register-overlay-ipc.js:1012` (registerOverlayIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 142 | `save-prompt:open` | ipcMain.handle | `register-save-prompt-ipc.js:167` (registerSavePromptIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | + active-tab gate and capture-tab gate |
| 143 | `save-prompt:anchor` | ipcMain.on | `register-save-prompt-ipc.js:178` (registerSavePromptIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | + token |
| 144 | `save-prompt:pointer` | ipcMain.on | `register-save-prompt-ipc.js:200` (registerSavePromptIpc) | S | `recordForPromptSender` | overlay sender | save-prompt-preload | + token |
| 145 | `save-prompt:focus` | ipcMain.on | `register-save-prompt-ipc.js:205` (registerSavePromptIpc) | S | `recordForPromptSender` | overlay sender | save-prompt-preload | + token |
| 146 | `save-prompt:height` | ipcMain.on | `register-save-prompt-ipc.js:210` (registerSavePromptIpc) | S | `recordForPromptSender` | overlay sender | save-prompt-preload | + token |
| 147 | `save-prompt:dismiss` | ipcMain.on | `register-save-prompt-ipc.js:216` (registerSavePromptIpc) | S | `recordForPromptSender` | overlay sender | save-prompt-preload | + token |
| 148 | `save-prompt:save` | ipcMain.handle | `register-save-prompt-ipc.js:221` (registerSavePromptIpc) | S | `recordForPromptSender` | overlay sender | save-prompt-preload | + token, kind, business gate (four guards) |
| 149 | `save-prompt:consent` | ipcMain.handle | `register-save-prompt-ipc.js:247` (registerSavePromptIpc) | S | `recordForPromptSender` | overlay sender | save-prompt-preload | + token, kind, business gate (four guards) |
| 150 | `settings-get` | ipcMain.handle | `register-settings-ipc.js:39` (registerSettingsIpc) | R | none | chrome | chrome-preload | returns `settings.getAll()` incl. automation key HASHES (1i); DD13 projection |
| 151 | `shields-get` | ipcMain.handle | `register-settings-ipc.js:40` (registerSettingsIpc) | R | none | chrome | chrome-preload |  |
| 152 | `shields-isolation-state` | ipcMain.handle | `register-settings-ipc.js:45` (registerSettingsIpc) | R | none | chrome | chrome-preload |  |
| 153 | `shields-restart-to-apply` | ipcMain.handle | `register-settings-ipc.js:84` (registerSettingsIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | plus main-side `not-pending` gate |
| 154 | `shields-set` | ipcMain.handle | `register-settings-ipc.js:90` (registerSettingsIpc) | S | none | chrome | chrome-preload |  |
| 155 | `shields-pause` | ipcMain.handle | `register-settings-ipc.js:95` (registerSettingsIpc) | S | none | chrome | chrome-preload |  |
| 156 | `internal-settings-get` | registerInternalHandler | `register-settings-ipc.js:102` (registerSettingsIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 157 | `internal-settings-set` | registerInternalHandler | `register-settings-ipc.js:105` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload | accepts any settings key incl. automation key hashes (finding 11) |
| 158 | `internal-shields-get` | registerInternalHandler | `register-settings-ipc.js:122` (registerSettingsIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 159 | `internal-shields-isolation-state` | registerInternalHandler | `register-settings-ipc.js:123` (registerSettingsIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 160 | `internal-shields-restart-to-apply` | registerInternalHandler | `register-settings-ipc.js:124` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload | relaunches the app |
| 161 | `internal-shields-set` | registerInternalHandler | `register-settings-ipc.js:125` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 162 | `automation:get-status` | registerInternalHandler | `register-settings-ipc.js:131` (registerSettingsIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 163 | `automation:set-port` | registerInternalHandler | `register-settings-ipc.js:132` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 164 | `default-browser:get-status` | registerInternalHandler | `register-settings-ipc.js:141` (registerSettingsIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 165 | `default-browser:make-default` | registerInternalHandler | `register-settings-ipc.js:142` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 166 | `automation:find-free-port` | registerInternalHandler | `register-settings-ipc.js:143` (registerSettingsIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 167 | `clipboard:write` | registerInternalHandler | `register-settings-ipc.js:158` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 168 | `automation:list-keys` | registerInternalHandler | `register-settings-ipc.js:181` (registerSettingsIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 169 | `automation:jar-key-mint` | registerInternalHandler | `register-settings-ipc.js:194` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload | mints a jar key (finding 5) |
| 170 | `automation:jar-key-revoke` | registerInternalHandler | `register-settings-ipc.js:199` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 171 | `automation:admin-key-mint` | registerInternalHandler | `register-settings-ipc.js:204` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload | mints the admin key (finding 5) |
| 172 | `automation:admin-key-revoke` | registerInternalHandler | `register-settings-ipc.js:209` (registerSettingsIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 173 | `automation:get-activity` | ipcMain.handle | `register-settings-ipc.js:215` (registerSettingsIpc) | R | none | open-with-reason | chrome-preload, internal-preload | consumed by BOTH chrome-preload and internal-preload (CLAUDE.md: bare by design, non-secret) |
| 174 | `chrome-clipboard-write` | ipcMain.handle | `register-settings-ipc.js:220` (registerSettingsIpc) | S | none | chrome | chrome-preload | writes clipboard, no clear |
| 175 | `unpin-toolbar-item` | ipcMain.on | `register-settings-ipc.js:224` (registerSettingsIpc) | S | none | chrome | chrome-preload | `.on`; item allowlisted |
| 176 | `toggle-bookmarks-bar` | ipcMain.on | `register-settings-ipc.js:235` (registerSettingsIpc) | S | none | chrome | chrome-preload | `.on` |
| 177 | `chrome-welcome-set` | ipcMain.handle | `register-settings-ipc.js:247` (registerSettingsIpc) | S | none | chrome | chrome-preload | key allowlisted (homePage/searchEngine) |
| 178 | `tab-create` | ipcMain.handle | `register-tab-ipc.js:206` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | refusal comes AFTER webPreferences are chosen from payload `trusted`/`partition`; no url/partition validation (22c) |
| 179 | `tab-close` | ipcMain.on | `register-tab-ipc.js:359` (registerTabIpc) | S | `ownsTab(event, wcId)` (chrome AND owner of wcId) | owning-chrome-of-wcId | chrome-preload |  |
| 180 | `tab-reopen` | ipcMain.handle | `register-tab-ipc.js:461` (registerTabIpc) | S | none | chrome | chrome-preload | pops the global closed-tab stack; sender only used to compute `stripIndex` after the pop (NOT in recon bare list) |
| 181 | `tab-history-snapshot` | ipcMain.handle | `register-tab-ipc.js:507` (registerTabIpc) | R | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | payload `webContentsId`; chrome-only today (cross-window id accepted) |
| 182 | `tab-certificate-get` | ipcMain.handle | `register-tab-ipc.js:545` (registerTabIpc) | R | `ownsTab(event, wcId)` (chrome AND owner of wcId) | owning-chrome-of-wcId | chrome-preload |  |
| 183 | `closed-tab-stack-size` | ipcMain.handle | `register-tab-ipc.js:567` (registerTabIpc) | R | none | chrome | chrome-preload |  |
| 184 | `move-targets` | ipcMain.handle | `register-tab-ipc.js:575` (registerTabIpc) | R | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 185 | `tab-move-to-new-window` | ipcMain.handle | `register-tab-ipc.js:857` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | ownership enforced inside `moveTabIntoWindow` (`source.tabViews.get(p.wcId)`) |
| 186 | `tab-move-to-window` | ipcMain.handle | `register-tab-ipc.js:885` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same core |
| 187 | `tab-tear-off` | ipcMain.handle | `register-tab-ipc.js:907` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | same core |
| 188 | `tab-drag-started` | ipcMain.on | `register-tab-ipc.js:931` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | plus `rec.tabViews.has(wcId)` |
| 189 | `tab-drag-ended` | ipcMain.on | `register-tab-ipc.js:942` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | owning-chrome-of-wcId | chrome-preload | plus `rec.dragWcId === wcId` |
| 190 | `bookmark-drag-started` | ipcMain.on | `register-tab-ipc.js:986` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 191 | `bookmark-drag-ended` | ipcMain.on | `register-tab-ipc.js:995` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 192 | `guest-bookmark-drop` | ipcMain.on | `register-tab-ipc.js:1032` (registerTabIpc) | S | none (sender-derived `event.sender.id`) | tab guest | webview-preload(via guest-bookmark-drop.js) | sender-derived wcId; forwards only while owning window declared a bookmark drag (`rec.bookmarkDragActive`), consumed once |
| 193 | `tab-adopt-by-drop` | ipcMain.handle | `register-tab-ipc.js:1054` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload | sender is the TARGET window; source resolved from `p.wcId` and gated on `source.dragWcId === p.wcId` |
| 194 | `tab-hide` | ipcMain.on | `register-tab-ipc.js:1079` (registerTabIpc) | S | `ownsTab(event, wcId)` (chrome AND owner of wcId) | owning-chrome-of-wcId | chrome-preload |  |
| 195 | `tab-navigate` | ipcMain.on | `register-tab-ipc.js:1130` (registerTabIpc) | S | `ownsTab(event, wcId)` (chrome AND owner of wcId) | owning-chrome-of-wcId | chrome-preload | trust-branched URL gate (isInternalPageUrl vs isSafeTabUrl) main-side |
| 196 | `tab-focus-guest` | ipcMain.handle | `register-tab-ipc.js:1210` (registerTabIpc) | S | `getWindowForChrome(sender)` (inline / `requireChrome`) | chrome | chrome-preload |  |
| 197 | `tab-set-active` | ipcMain.on | `register-tab-ipc.js:1221` (registerTabIpc) | S | `ownsTab(event, wcId)` (chrome AND owner of wcId) | owning-chrome-of-wcId | chrome-preload |  |
| 198 | `tab-set-bounds` | ipcMain.on | `register-tab-ipc.js:1393` (registerTabIpc) | S | `ownsTab(event, wcId)` (chrome AND owner of wcId) | owning-chrome-of-wcId | chrome-preload |  |
| 199 | `tab-find` | ipcMain.on | `register-tab-ipc.js:1433` (registerTabIpc) | S | `ownsTab(event, wcId)` (chrome AND owner of wcId) | owning-chrome-of-wcId | chrome-preload |  |
| 200 | `internal-vault-state` | registerInternalHandler | `register-vault-ipc.js:120` (registerVaultIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 201 | `internal-vault-lock` | registerInternalHandler | `register-vault-ipc.js:175` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload | global lock |
| 202 | `internal-vault-compromise-dismiss` | registerInternalHandler | `register-vault-ipc.js:187` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 203 | `internal-vault-has` | registerInternalHandler | `register-vault-ipc.js:198` (registerVaultIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 204 | `internal-vault-list` | registerInternalHandler | `register-vault-ipc.js:205` (registerVaultIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 205 | `internal-vault-reveal` | registerInternalHandler | `register-vault-ipc.js:215` (registerVaultIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload | returns vault item PLAINTEXT (finding 5) |
| 206 | `internal-vault-item-save` | registerInternalHandler | `register-vault-ipc.js:234` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 207 | `internal-vault-totp-code` | registerInternalHandler | `register-vault-ipc.js:251` (registerVaultIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 208 | `internal-vault-item-delete` | registerInternalHandler | `register-vault-ipc.js:270` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 209 | `internal-vault-item-copy` | registerInternalHandler | `register-vault-ipc.js:286` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 210 | `internal-vault-accesskey-list` | registerInternalHandler | `register-vault-ipc.js:309` (registerVaultIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 211 | `internal-vault-accesskey-revoke` | registerInternalHandler | `register-vault-ipc.js:325` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 212 | `internal-vault-export` | registerInternalHandler | `register-vault-ipc.js:349` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 213 | `internal-vault-export-profile` | registerInternalHandler | `register-vault-ipc.js:384` (registerVaultIpc) | S | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |
| 214 | `internal-vault-pick-save-path` | registerInternalHandler | `register-vault-ipc.js:406` (registerVaultIpc) | R | `registerInternalHandler` (origin + internal session) | internal | internal-preload |  |

## Totals check

- Rows: 214. `ipcMain.handle` rows (raw channels): 89; `ipcMain.on`: 51; `registerInternalHandler`: 60; `registerInternal`: 14.
- Internal-gated: 74; refusing: 78; non-refusing lookups: 2; bare: 47; guest: 13. Sum: 214.
- Classes: internal 74, chrome 59, owning-chrome-of-wcId 31, overlay sender 27, tab guest 13, open-with-reason 1, undecided 9. Sum: 214.

## Limits of this census

- Read-only vs state-changing was judged from each handler body (every bare and guest handler read in full; internal-gated ones were read for the secret-returning cases and judged by name otherwise). It is a design input for the classification table, not a proof.
- "Caller class" is a proposal derived from today's check plus the sender in `src/preload`; DD1's registrars will fix the real class per channel. Two channels are judgment calls: `automation:get-activity` (open-with-reason because both chrome and an internal page call it; the alternative is to split it into a chrome channel and an `internal-automation-get-activity` twin) and the nine `undecided` unused twins.
- The census does not cover channels registered outside `src/main/**` (none exist: `src/preload` and `src/renderer` have no `ipcMain`) or Electron-internal channels.
