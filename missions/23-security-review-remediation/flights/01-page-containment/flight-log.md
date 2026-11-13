# Flight Log: Page Containment

**Flight**: [Page Containment](flight.md)

## Summary

Planning. Reconnaissance complete (2026-11-12); no leg started.

---

## Reconnaissance Report

Read-only static pass on 2026-11-12 against HEAD `8e2313f` (v0.19.13). Nothing was run. Source artifact: the 2026-11-12 security review as recorded in the mission's Context. Operator reviewed the classifications at planning and overrode none.

Limits: the handler census is a pattern scan over `src/main/**`; every bare and guest handler was read in full, the 79 guarded ones spot-read. Read-only vs state-changing for the `jars-*` / `history-*` / `bookmark*` twins is judged from handler names.

Paths are under `src/`.

| Item | Classification | Evidence | Recommendation |
| --- | --- | --- | --- |
| 1a `app-quit` | confirmed-live | `main/app-lifecycle.js:323` | chrome gate (`.on` — reachable by `send` alone) |
| 1b `vault-reachable-items` | confirmed-live | `main/main.js:2541` | owner-of-wcId gate |
| 1c `vault-fill-human` | confirmed-live | `main/main.js:2545`; comment at `:2556` admits no owner check | owner gate + active tab |
| 1d `open-downloaded-file` | confirmed-live | `main/register-download-ipc.js:142-152` | chrome gate |
| 1e `download-media` | confirmed-live (sender looked up, never refused) | `:48-51` falls back to `getLastFocused()`; payload `webContentsId` picks any tab's session | refuse non-chrome; sender must own the wcId |
| 1f `choose-download-dir` | confirmed-live (same fallback) | `:77-78` | refuse non-chrome |
| 1g `show-item-in-folder` | confirmed-live | `:90` | chrome gate |
| 1h `reveal-downloaded-file` | confirmed-live | `:154` | chrome gate |
| 1i `settings-get` | confirmed-live | `main/register-settings-ipc.js:39` returns `getAll()` incl. `automationKeyHashes` / `automationAdminKeyHash` (`settings-store.js:94-96`) | project out hashes; CLAUDE.md "non-secret only" is wrong |
| 1j `shields-set` / `shields-pause` | confirmed-live | `register-settings-ipc.js:90`, `:95` | chrome gate (model: `shields-restart-to-apply` `:84-86`) |
| 1k `chrome-clipboard-write` | confirmed-live | `:220` | chrome gate |
| 1l `unpin-toolbar-item` / `toggle-bookmarks-bar` | confirmed-live (both `.on`) | `:224`, `:235` | chrome gate |
| 1m `chrome-welcome-set` | confirmed-live | `:247` | chrome gate |
| 1n `vault-lock`, `vault-lock-state-get`, `vault-automation-held-get` | confirmed-live | `main/main.js:2506`, `:2489`, `:2494` | chrome gate |
| 1o `vault-capture-dismiss` | confirmed-live | `main/register-browser-ipc.js:315` | owner gate via `captureTabOf` |
| 1p six bookmark channels | confirmed-live | `main/register-bookmarks-ipc.js:111-116` | chrome gate |
| 1q bare `jars-*` twins (13) | confirmed-live | `main/jar-registry-ipc.js:144-149`, `main/jar-data-ipc.js:422-430` | chrome gate, or delete unused twins |
| 1r bare `history-*` twins (6) | confirmed-live | `main/history-ipc.js:183-188` | same |
| 1s other bare handlers | confirmed-live | `shields-get` `:40`, `shields-isolation-state` `:45`, `automation:get-activity` `:215`, `closed-tab-stack-size` `register-tab-ipc.js:567` | classify open-with-reason or gate |
| 1t preload `send` loop | shape confirmed; reach needs-human-recheck | `preload/webview-preload.js:606-608`; trigger listeners `:629-630` use `document.addEventListener` | live probe (Q1); literal channels, indexed iteration regardless |
| 1u Electron bundle emit route | needs-human-recheck | Electron-internal | live probe (Q1) |
| 2a `isTrusted` getter capture yields nothing | confirmed-live in code | `preload/webview-preload.js:322-328` | never decide trust in the page world |
| 2b `readTrusted` falls back to the object | confirmed-live | `preload/vault-fill-icon.js:387`; same at `webview-preload.js:624` | same |
| 2c icon handlers via patchable `addEventListener` | confirmed-live (drifted to `:464-466`) | `preload/vault-fill-icon.js:464-466` | same |
| 2d `guest-vault-gesture`: no active-tab check or rate limit | confirmed-live | `main/register-browser-ipc.js:174-178`; chrome side `renderer/chrome/vault-controller.js:450-456` | main-side active tab, verified input, throttle |
| 2e picker focused on row 0, no arming | confirmed-live | `vault-controller.js:146`, `:467`; `renderer/menu-overlay.js:1028-1031` | arm after delay; no default row |
| 2f no destination shown | confirmed-live | `shared/vault-picker-template.js` (header "Fill from vault"; no origin) | show main-derived origin |
| 2g card/identity not origin-gated | confirmed-live (by design) | `main/vault/vault-human.js:423-446`, `:497-530` | require verified gesture + http(s) |
| 2h fill payload crosses the main world | confirmed-live | `main/main.js:1477-1502` → listeners at `webview-preload.js:451`, `:464`, `:480`, `:496`; `preload/vault-entry-tracker.js:~156` | deliver main → isolated world |
| 2i background tab can raise the picker | confirmed-live | follows from 2d; `fillHuman` has no active-tab check (`vault-human.js:461-534`) | active-tab gate at gesture and fill |
| 4a `toMediaProxyUrl` passes non-http(s) | confirmed-live | `shared/media-proxy.js:~58-70`; sinks `renderer/chrome/media-controller.js:141`, `:150`, `:223`, `:284`, `:537` | null for non-web; validate at `guest-media-list` (`register-browser-ipc.js:533`) |
| 4b handler fetches via whichever tab the URL names | confirmed-live | `main/media-proxy-handler.js:~44-58` | main-minted per-tab token |
| 4c `file://host/share` variant | needs-human-recheck | CSP `'self'` semantics; Windows | closed by 4a regardless |
| 6a page `suggestedName` beats Chromium's | confirmed-live | `register-download-ipc.js:168` | keep Chromium's extension |
| 6b sanitiser passes bidi / reserved names | partially-satisfied | `main/download-path.js:46-82`: `CON`, `CON.txt` caught (`:68-74`); `CON.tar.gz`, `CON .txt`, `CONIN$` missed; no control/bidi strip; 180-char slice (`:77`) can cut the extension | strip Cc/Cf/bidi; test trimmed first segment |
| 6c no dangerous-type confirmation | confirmed-live | `:142-152`, `:233-236` | confirm executable classes main-side |
| 6d ellipsis can hide the extension | confirmed-live | `renderer/menu-overlay.css:1244-1253` | never hide the extension |
| 6e (new) internal `open` lacks completion gate | confirmed-live | `:233-236` vs `:147` | one gated open function |
| 9 title update without `jar_id` | confirmed-live | `main/history-store.js:167`; `id INTEGER PRIMARY KEY` no AUTOINCREMENT (`:38`); `lastVisitByWc` never invalidated (`history-recorder.js:58`, `:110-112`) | add `jar_id`; drop map entries on clear |
| 10 Retry via default session | confirmed-live | `register-download-ipc.js:227-229`; record shape `main/downloads-payload.js:50-58` has no jar | record partition; retry via its session |
| 14a opaque origins collapse to `"null"` | confirmed-live | `vault-human.js:113-119`, `vault-context.js:50-52`; `shared/origin-match.js:69` | require http(s) tuple origin |
| 14b capture values re-plannable in main world | confirmed-live | `webview-preload.js:~590-608` | read and send from one trusted realm, or accept and document |
| 14c fill ignores certificate override | confirmed-live | no `certOverride` reference in `main/vault/*` or fill delegates | refuse or warn |
| 15a uncapped auth realm | confirmed-live (attributed, not bounded) | `main/auth-challenges.js:357`; `menu-overlay.js:923-925` | cap, strip control characters |
| 15b address bar raw URL | partially: no formatter confirmed; userinfo needs-human-recheck | `renderer/renderer.js:1189`, `:1220`; `chrome/tab-controller.js:958` | strip userinfo; keep host visible (Q4) |
| 15c cert picker: live default, no delay | confirmed-live | `menu-overlay.js:1106-1109` | arm; no default row |
| 15d cert-override dialog | partially-satisfied | default focus Back (`menu-overlay.js:2641`); Proceed enabled at once (`:2637`) | arm delay only |
| 16a unbounded history search tokens | confirmed-live | `history-store.js:397-404`; `history-ipc.js:~107` | cap length and tokens |
| 16b unbounded pushState recording | confirmed-live | `main/guest-wiring.js:832-842`, popups `:391-393`; `history-recorder.js:85-88` | per-tab rate limit, length caps |
| 22a sheet channels lacking menu-type guard | confirmed-live; CLAUDE.md wrong | `main/register-overlay-ipc.js`: `vault-unlock` `:241`, `vault-setup` `:279`, `vault-stepup-mint` `:316`, `vault-import` `:373`, `vault-rotate-recovery` `:418`, `vault-rotate-admin` `:462`, `vault-change-master` `:500`, `vault-recover` `:538`, `auth-submit` `:704`, `bookmark-edit-submit` `:766`; `copy-text` `:685` sender only | add the guard to the eleven |
| 22b non-guest nav guard admits `file:` / `goldfinch:` | confirmed-live | `main/app-lifecycle.js:178-189` | pin each view to its own document, or accept |
| 22c `tab-create` not re-validated main-side | confirmed-live | `main/register-tab-ipc.js:206-355` (sender check `:258`; no URL/partition validation) | validate by `trusted` branch; partition against jars |

### CLAUDE.md versus the code

- Four guards on state-changing sheet channels: **false** for eleven channels (22a).
- History recorder gates on a registered-jar allowlist: **true** (`history-recorder.js:61-62`); finding 9 concerns `setTitle`, which the allowlist does not cover.
- `settings-get` carries non-secret data only: **false** (1i).
- All `menu-overlay:*` handlers are sender-validated: **true**.
- Preload comment that page JS cannot register a `vault-fill` listener (`webview-preload.js:~441`): holds only if Q1's probe shows `ipcRenderer` unreachable.

### Handler census (`src/main/**`)

214 registrations; none use `ipcMain.once`.

| Group | Count |
| --- | --- |
| `registerInternalHandler` (aliased `registerInternal` in the two jar files) | 74 |
| Refusing sender check | 79 |
| Sender looked up, never refused (`download-media`, `choose-download-dir`) | 2 |
| Bare | 46 |
| Guest-preload channels | 13 |

- Refusing checks by helper: `recordForSheetSender` 19; `recordForFindSender` 2; save-prompt 6; `ownsTab` 7; `requireChrome` / inline `getWindowForChrome` ~45.
- Bare, state-changing (28): `app-quit`; `vault-lock`, `vault-fill-human`, `vault-capture-dismiss`; `open-downloaded-file`, `reveal-downloaded-file`, `show-item-in-folder`; `shields-set`, `shields-pause`; `chrome-clipboard-write`, `unpin-toolbar-item`, `toggle-bookmarks-bar`, `chrome-welcome-set`; `bookmark-add`, `-update`, `-remove`, `-reorder`; `jars-add`, `-rename`, `-set-default`, `-remove`, `-clear-data`, `-wipe`, `-set-retention`, `-cookies-remove`, `-sitedata-remove-origin`; `history-delete`, `history-clear`.
- Bare, read-only (18): `settings-get`, `shields-get`, `shields-isolation-state`, `automation:get-activity`; `vault-lock-state-get`, `vault-automation-held-get`, `vault-reachable-items`; `closed-tab-stack-size`; `bookmarks-get`, `bookmarks-suggest`; `jars-list`, `-get-default`, `-cookies-list`, `-sitedata-list`; `history-page`, `-search`, `-count`, `-suggest`.
- Guest-preload channels (13), none asserting "sender is a tab guest" or main frame: `shields-farble` (sync), `vault-eligible` (sync), `guest-vault-gesture`, `guest-tab-boundary`, `guest-vault-icon-menu`, `guest-vault-capture`, `-card`, `-identity`, `guest-vault-gesture-settle`, `guest-media-list`, `guest-privacy-fp`, `guest-window-close` (all `register-browser-ipc.js`), `guest-bookmark-drop` (`register-tab-ipc.js:1032`).

### Facts for designers

- Sender helpers: `registry.getWindowForChrome(sender)` (`main/window-registry.js:192`), `getWindowForGuest(wcId)` (`:205`), `getChromeForTab(wcId)` (`:219`), `recordForOverlaySender(sender, key)` (`:291`); `requireChrome` / `ownsTab` are closure-local and duplicated (`register-tab-ipc.js:194-200`, `register-browser-ipc.js:91`, inline `main.js:2567-2569`); `registerInternalHandler` (`main/internal-ipc.js:71`) throws on refusal and is `handle`-only.
- Guard models: `test/unit/window-closed-invariant.test.js` (closest), `capture-save-allowlist.test.js`, `sheet-automation-gate-invariant.test.js`, `broadcast-invariant.test.js`, `internal-host-drift.test.js`. A new scan must recognise the `registerInternal` alias and handlers passed by name.
- Vault picker: initial focus `renderer/menu-overlay.js:1028-1032`; no arming logic anywhere on the sheet; card shows header, rows, jar badge, footer — no origin. Main world: all of `webview-preload.js`, `vault-fill-icon.js`, `vault-entry-tracker.js`, ordinal resolution, `planCaptures`. Isolated world: `vault-entry-observer.js` (provenance map, snapshot read, field writes).
- Downloads: record is `{url, filename, savePath, mime, startTime}` (`main/downloads-payload.js:50-58`); `will-download` is wired per session (`register-download-ipc.js:162`) but the session is not recorded; `shell.openPath` at exactly two sites (`:148`, `:236`).
- Prior ruling to respect: Mission 21 DD3f — the gesture-time **capture read** is a same-process `webFrame` call, never a cross-process `webContents.executeJavaScriptInIsolatedWorld` (`preload/vault-entry-observer-bootstrap.js:85-91`, `main/vault/vault-human.js:853-860`).

---

## Leg Progress

### Leg 01 — `probe-and-audit` (landed 2026-11-13, uncommitted)

Evidence: [`probe-results.md`](probe-results.md) (Q1–Q4), [`guard-audit.md`](guard-audit.md) (Q5–Q7, `[A]` table), [`ipc-census.md`](ipc-census.md) (Q8); rig at `tests/behavior/fixtures/page-containment-probe/`. No product source changed. Baseline: 6348 unit tests (6344 pass, 4 todo, 0 fail, ~7 s); `renderer.js` 1504 lines.

| Question | Answer | Consequence |
| --- | --- | --- |
| Q1 guest reach to preload IPC | **Object reachable** in rig and product: once any main → guest message is delivered, a page-patched array method receives Electron's emit event whose `sender` is the preload's IPC object. `require` / `process` are not reachable. | Finding 1 is live at full severity. DD1's main-side gate is the boundary; DD3's preload hardening is defence in depth only. |
| Q2 main ↔ isolated world free of page code | **Not free.** The round trip returns the right value and the world's built-ins are its own, but each main-initiated call passes through Electron's dispatch in the page world: the page's wrappers saw 7 calls, one of them a `then` lookup on an object with the result's own key names. Alteration of the reply was not measured. Mid-call cross-site navigation leaves the call pending forever. | **DD4's premise fails as written → divert (operator ruling).** DD5's "nothing secret transits the page world" also fails for a main-initiated delivery. |
| Q3 isolated-world listener trust | **Pass**, including on the product's own icon: `isTrusted` true for a real click, false for a synthetic one, despite page tampering. A page can suppress the listener (fail-closed). The world detects an overlay, a scaled icon and an opacity-0 icon. | The gesture can be _observed_ honestly; the open problem is carrying that fact to main. |
| Q4 committed-URL userinfo | Admitted directly and via redirect; `enumerateTabs` and the address bar show `user:pass@`. `file://host/` not answerable on Linux. | DD11 confirmed needed. |
| Q5 guard audit | 35 guards: 22 sound, 11 gaps, 2 not settleable statically. No critical gap outside this flight's surfaces. | No divert from the audit. Gaps owned by existing legs; one low squawk (internal session has no permission handler). |
| Q6 `confirmedOrigins` | No vault format bump needed; the editor save path drops the field and `metadataOf` hides it. | DD6's remembered-sites variant can ship in this flight. |
| Q7 popups | Default holds; a popup cannot raise the picker and no flow breaks. Popups must stay admitted for `shields-farble`, `vault-eligible`, `guest-window-close`. | DD1 tab-guest class refined. |
| Q8 census | 214 channels, each registered once: 89 `handle`, 51 `on`, 74 internal. 78 refusing, 47 bare (`tab-reopen` was miscounted as refusing), 2 non-refusing, 13 guest. | DD2's table source. 9 bare twins have no caller (delete); 13 chrome-only channels take a tab id without an ownership check. |

Other facts for later legs: a script that throws **rejects** a main-initiated isolated-world call (unlike the same-process call); `frameToken` changes on every cross-document navigation and is stable across `pushState` / hash, and must be captured as a primitive (the `mainFrame` object is reused); `WebFrameMain` has no isolated-world method; dummy credential-shaped fill payloads passed through page-patchable built-ins in the rig (confirms finding 2's payload path); `tabOriginFor` reads `wc.getURL()`, not the tab entry; `guest-tab-boundary` is also sent by internal tabs; fixture directories are lint-ignored. `[A]` re-verification: 73 rows — 63 confirmed, 5 partly true, 3 not verifiable from the repo, 2 answered by Q1.

---

## Decisions

### Flight Director Notes

- 2026-11-13 — Operator approved the flight spec. Branch `flight/01-page-containment` created; planning artifacts committed (`7e2d8c4`); mission set `active`, flight `in-flight`. Crew file `leg-execution.md` loaded and structurally valid (Developer and Reviewer on Sonnet).
- 2026-11-13 — Leg `probe-and-audit` designed. **Risk tier: high** — it changes no product source, but its answers decide the DD4 divert and the scope of every later leg, so a wrong probe is a wrong flight. Design review spawned (Developer, Sonnet).
- 2026-11-13 — Q2 cannot be answered by driving the product: nothing in `src/main/` calls into the isolated world today and the leg may not add a product hook. Decision: a standalone rig on the project's Electron binary with the product's guest `webPreferences`; rig-versus-product differences are recorded with the answers.
- 2026-11-13 — The leg runs as two parallel Developer spawns (Track A live probes, Track B static audit and census) writing disjoint files; the Flight Director folds both into this log. Neither track edits the log.
- 2026-11-13 — This leg is a decision gate: no later leg is designed until the operator has seen its results.
- 2026-11-13 — Design review of the leg: approve with changes, all incorporated; no second cycle (refinements only). Both tracks signalled `[LAND:leg]`; neither was interrupted by safeguards. Track B's documents are taken as reported; the Flight Director read Track A's Q2 evidence directly.
- 2026-11-13 — **Divert raised.** Q2 failed as posed, which the flight's adaptation criteria and the operator's no-fallback ruling make a stop. `vault-fill-trust` is not designed until the operator rules. The IPC gate legs and `jar-isolation-and-downloads` do not depend on Q2.

Runtime decisions not in original plan.

---

## Deviations

---

## Anomalies

Unexpected issues encountered.

---

## Session Notes

Chronological notes from work sessions.

- 2026-11-12 — Flight planned. Operator rulings at planning: vault gesture verified 1Password-style via the isolated world, no fallback (divert if the premise fails); card/identity confirm on a new site; audit re-run as a guard audit; HAT leg included.
