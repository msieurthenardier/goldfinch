# Flight Log: Default-Jar Semantics

**Flight**: [Default-Jar Semantics](flight.md)

## Summary

**Landed 2026-07-10.** All four legs completed: renderer default routing +
`jars-changed` listener + dot policy + BURNER consumption (Leg 1); main-process
`PAGE_PARTITION` retirement, per-tab privacy handlers with internal guard,
resolved-default auto-mint (Leg 2); real-boot matrix + first M06 behavior test
`new-tab-default-routing` 7/7 PASS (Leg 3, one real defect D1 found+fixed); operator
HAT sign-off with two inline fixes — guest-focus Ctrl+T forwarding (pre-existing
gap) and link-open jar inheritance (operator semantics ruling) (Leg 4). Suite
1132 → 1154; typecheck/lint clean throughout. Two commits: `3998888` (legs 1-3),
HAT-fixes commit (leg 4 + landing artifacts).

---

## Reconnaissance Report

Source items: the mission's five reserved-default sites (mission.md Architect findings +
Known Issues fifth site) and the F1 debrief's carried-forward recommendations 1-2.
Verified against main at `d1e6be0` (2026-07-09, F1 merge). Debrief guidance followed:
re-grepped rather than trusting recorded line numbers (all five held or moved trivially).

| item | classification | evidence | recommendation |
|------|----------------|----------|----------------|
| (a) Store validation floor reserves `default` | already-satisfied | Retired by F1's jars.js v2 rewrite. Remaining `'default'` literals in jars.js are migration data: legacy seed jars.js:57, base-partition guard jars.js:108, v1 repair candidate jars.js:179, legacy-probe seed default jars.js:192 — all deliberate, keep | Retire; carried as `[x]` in flight.md Contributing to Criteria |
| (b) Main base-partition constant + fallbacks | confirmed-live | `PAGE_PARTITION` main.js:65; spellcheck apply main.js:1637; privacy fallbacks main.js:2354, :2372, :2395 (`privacy-clear-storage` *always* uses it — cross-jar bug for non-legacy tabs); whenReady pre-warm main.js:2436-2439 | Leg 2 (DD4/DD5) |
| (c) Renderer `DEFAULT_CONTAINER` constant/race | confirmed-live | renderer.js:106-107 (boot placeholder `[DEFAULT_CONTAINER]`), createTab fallback :677, pJar fallback :2079, automation openTab comment :2441, boot tab :2649 races the jarsList resolve at :108 | Leg 1 (DD1/DD2/DD3) |
| (d) Dev auto-mint literal `'default'` | confirmed-live | main.js:2529 (`mintJarKey('default', …)`); interim-gap comment block :2518-2524; docs/mcp-automation.md:124-127, :60-62 | Leg 2 (DD7) |
| (e) Renderer dot suppression by literal id | confirmed-live | renderer.js:713 (`jar.id === 'default' \|\| jar.id === 'internal'`) | Leg 1 (DD6) |
| F1-rec-1: jars-changed listener timing + DD2-relaxation decision | confirmed-live (decision items) | Zero `jars-changed` listeners (only preload wrapper chrome-preload.js:61); store already auto-claims flag on empty-add (jars.js:257-259) and migrates on remove (jars.js:286) | Decisions locked in flight.md Open Questions: listener lands now; no relaxation needed |
| F1-rec-2: consume BURNER constant | confirmed-live | `#ff8c42` triplicated: burner.js:21 (source), renderer.js:492 (`makeBurner`), container-menu.js:36 (sentinel); burner.js:17-18 self-flags it | Leg 1 (DD8) |

No `needs-human-recheck` or `drifted` items. The single retirement, (a), was F1's
explicit charter (its flight spec owned the floor rewrite) — retired without escalation
under the operator's standing autonomous-execution directive for this flight pair.

---

## Leg Progress

- 2026-07-09 — **Leg 1 (`renderer-default-routing`) implemented.** DD1/DD2/DD3/DD6/DD8.
  New `src/shared/default-routing.js` (pure `resolveNewTabContainer`, dual-exported).
  `renderer.js`: deleted `DEFAULT_CONTAINER`; replaced the boot placeholder with live
  `containers`/`defaultId` state fed by `Promise.all([jarsList(), jarsGetDefault()])`
  (`jarsBoot`) and a new `onJarsChanged` listener, both funneling through
  `applyJarsState`; added `refreshOpenTabJars()` (id-match re-render of
  `tab.container`, dot color, dot title; skips trusted/burner tabs; removed-jar tabs
  keep their stale container per the DD2 trade-off); `createTab` now resolves
  `container || resolveNewTabContainer(containers, defaultId) || makeBurner()`;
  dot-suppression narrowed to `jar.id === 'internal'` only (DD6); `makeBurner()` and
  `container-menu.js`'s sentinel now derive name/color from the shared `BURNER`
  constant (DD8, hybrid CJS/global resolution in container-menu.js); `pJar()` guards
  the no-container case by returning a neutral `—` placeholder section instead of
  falling back to `DEFAULT_CONTAINER` (must always return an `HTMLElement` —
  `renderer.js:2123` appends its return value unconditionally); boot tab creation
  gated on `Promise.all([settingsGet('homePage'), jarsBoot])` (DD3); picker's
  `createContainerAndOpenTab` no longer does `containers.push(c)` (step 7b — the
  `jars-changed` broadcast fires before the creating `invoke` resolves, so the push
  would have appended a duplicate, differently-referenced entry). `index.html` gained
  `<script src="../shared/burner.js">` (before container-menu.js) and
  `<script src="../shared/default-routing.js">` (before renderer.js).
  `renderer-globals.d.ts` gained `BURNER`/`resolveNewTabContainer` declarations plus
  `jarsGetDefault`/`onJarsChanged` on `GoldfinchBridge` (both were missing and blocked
  `tsc`; only `jarsList`/`jarsAdd` were previously declared — `jarsRename`/
  `jarsRemove`/`jarsSetDefault` remain undeclared, unused by the renderer until
  Flight 3's UI). Comment sweep: `renderer.js` DATA-LOSS-TRAP comment,
  `renderer.js`'s automation `openTab` comment (:2441 in the leg spec's pre-edit
  numbering), the automation `unknown-jar` refuse comment (an additional
  `DEFAULT_CONTAINER` mention the leg spec didn't enumerate but the grep AC caught),
  `menu-overlay.js:157`, `chrome-preload.js:60`, and `burner.js`'s header NOTE.
  New `test/unit/default-routing.test.js` (9 tests: full truth table + the
  verification-steps snippet, pinned). `test/unit/container-menu.test.js`: sentinel
  assertions now reference `BURNER.color`/`BURNER.name` instead of the literal
  `#ff8c42`, plus one new test pinning the sentinel to the shared constant (1 test
  added). Test count: 1132 → 1142 (+10). Suite green, `npm run typecheck` green,
  `npm run lint` green. Grep ACs: `grep -n "DEFAULT_CONTAINER" src/ -r` → 0 matches;
  `grep -rn "ff8c42" src/` → exactly 1 match (`src/shared/burner.js:21`).
  **Deviation**: `eslint.config.mjs`'s renderer globals list needed `BURNER` and
  `resolveNewTabContainer` added (`no-undef` otherwise) — outside the leg's Files
  Affected list but required for the `npm run lint` green acceptance criterion; same
  pattern as the existing `buildContainerModel`/`deriveSiteInfo` entries. No other
  deviations from the leg spec. Leg 1 → `landed` (code review + commit deferred to
  flight level per the flight's execution mode).
- 2026-07-09 — **Leg 2 (`main-retirement-sweep`) implemented.** DD4/DD5/DD7.
  `src/shared/automation-dev.js`: added pure `resolveAutoMintTarget(jars)` (id-compares
  `jars.getDefault()` against `BURNER.id`, never reference-compares — same discipline as
  DD3); `test/unit/automation-dev.test.js` gained 4 tests pinning its truth table
  (default jar → its id; BURNER sentinel → `null`; burner-id-shaped non-sentinel object →
  `null`; legacy `default` jar → `'default'`). `src/main/main.js`: deleted the
  `PAGE_PARTITION` constant and its three uses — the whenReady pre-warm block
  (`pageSession` + its three apply calls), the spellcheck toggle's legacy-partition
  apply, and the three privacy handlers' `session.fromPartition` fallback;
  `privacy-cookies`/`privacy-clear-cookies` now return their empty/failure shape when
  `webContentsId` resolves to no live `webContents`; `privacy-clear-storage` gained a
  `webContentsId` payload field, resolves `wc.session` like its siblings, and returns
  `{ ok: false, error: 'no-tab' }` on no live tab. **All three handlers additionally
  refuse an internal-session target** (`wc.session.__goldfinchInternal` guard, design
  review cycle 1 MEDIUM — the privacy panel can stay open across a switch to the
  internal Settings tab, and `privacy-clear-storage` never touched `wc` before this leg
  so the reachability is new). Auto-mint block rewritten to resolve via
  `resolveAutoMintTarget(jars)`: mints for the resolved id, or on `null` (Burner holds
  the flag) prints the exact stderr line `[mcp] dev auto-mint skipped: default is
  Burner (no persistent jars)` and still emits `AUTOMATION_DEV_MINT` with `key: null`
  (admin mint unaffected). Comment rewrites: the auto-mint block's "literal jar id
  'default' / INTERIM GAP" comment now describes resolved-default + Burner-skip
  behavior; the session-created hook's `defaultSession/pageSession` comment reworded to
  `defaultSession`-only (design review cycle 1 MEDIUM — stale `pageSession` reference
  would have survived the pre-warm deletion); the whenReady pre-warm site gained a
  replacement comment explaining lazy per-jar coverage via `session-created` (M06 F2
  DD5). `src/renderer/renderer.js`: `clearStorage()`'s `privacyClearStorage` call
  gained `webContentsId: tab.wcId` (preload pass-through, no preload edit needed).
  `docs/mcp-automation.md`: rewrote the auto-mint `key` bullet (resolved-default +
  Burner-skip, INTERIM GAP language removed), the pick-a-jar guidance, and the
  omitted-`jarId` `openTab` row (current default jar / admin-identity-only /
  jar-key's-own-jar clarification). Behavior-spec text migrations (text-only, no
  `runs/` files touched): `automation-key-gating.md` (Preconditions bullet 3 + Steps
  1/2/6, exhaustive reword to "the resolved-default jar" with a
  record-which-jar-holds-the-flag precondition), `mcp-jar-scoping.md` and
  `mcp-auth-gating.md` (mint-target references reworded to "the resolved-default jar";
  each gained a "verify (or set via `jarsSetDefault`) that `personal` holds the default
  flag" precondition bullet; staged `personal`/`work` tab fixtures left as-is per the
  deliberate migration-strategy split), `settings-automation.md` Step 8 ("find the
  `default` jar row" → "find a persistent jar row with no key (on this dev profile e.g.
  the legacy `default` jar)"), `farbling-correctness.md` (the design-review-flagged
  sixth literal-`default` spec, same treatment as the three auto-mint specs),
  `spellcheck.md` Intent prose (`PAGE_PARTITION` mention replaced with "every live web
  jar session ... via the session-created hook"). `CLAUDE.md` swept: the spellcheck
  prose paragraph's `PAGE_PARTITION` mention replaced with the session-created-hook
  description; README.md had no stale claims (grep clean). Test count: 1142 → 1146
  (+4, all in `automation-dev.test.js`). Suite green (~5.1s), `npm run typecheck`
  green, `npm run lint` green. Grep ACs: `grep -rn "PAGE_PARTITION" src/ test/` → 0
  matches; `grep -n "'default'" src/main/main.js` → 0 matches; the `node -e`
  verification snippet → `personal null` (exact match); the broadened
  `tests/behavior/*.md` grep (`default. jar\|jar .default\|` the backtick-`default`
  pattern) returned 5 hits, all inspected — none assert the auto-mint provisions or a
  fixture requires the literal reserved `default` jar; all are either negative
  assertions (`new-tab-default-routing.md`'s "not `default`") or this leg's own "legacy
  `default` jar as one possible flag-holder" phrasing (exempt per the leg spec). **No
  deviations** from the leg spec — implementation guidance steps 1-9 followed as
  written, including the internal-session guard and the session-created-hook comment
  fix design review cycle 1 required. Leg 2 → `landed` (code review + commit deferred
  to flight level).
- 2026-07-09 — **Leg 3 (`verify-integration`) implemented — real-boot matrix.**
  Scratch profiles under `/tmp/goldfinch-f2-verify/` (`s0`-`s4`), XDG_CONFIG_HOME
  isolation; operator's real `~/.config/goldfinch-dev` verified untouched throughout
  (S0 pre/post hash `40e68b01…` unchanged, mtime `1783627580` unchanged). MCP attach
  via `scripts/lib/mcp-client.mjs`'s `connectAutomation`/`callTool` (SDK
  StreamableHTTPClientTransport) — live port discovered per boot (free-fallback
  observed: 49709/49709/49710/49709 across the four scratch boots, never the
  configured 49707, which the operator's own real instance or TIME_WAIT held).
  **D1 (product defect, caught by S1's first real boot):** `container-menu.js`'s
  DD8 hybrid `BURNER` resolution (`const { BURNER } = ...`) is a top-level `const`
  declaration; `index.html` loads it via `<script>` immediately after `burner.js`
  (also `const BURNER = ...` at top level) — classic (non-module) `<script>` tags
  in one document share ONE global lexical environment for top-level
  `let`/`const`/`class`, so the second declaration threw
  `SyntaxError: Identifier 'BURNER' has already been declared` at parse time on
  every real chrome-document boot, silently killing the entire `container-menu.js`
  script (`buildContainerModel` never defined) — invisible to the Node-runner unit
  suite (`require()` gives each module its own scope; the existing
  `container-menu.test.js` never hit this). Confirmed live via
  `[…]:INFO:CONSOLE:1] "Uncaught SyntaxError: Identifier 'BURNER' has already been
  declared", source: file://…/src/shared/container-menu.js` in the S1 scratch
  stderr log. Fixed minimally: renamed the browser-path local binding to
  `RESOLVED_BURNER` (`src/shared/container-menu.js`) so it no longer re-declares
  the global `BURNER` burner.js already installed; the CJS branch is unaffected
  (`require('./burner').BURNER`). Regression test added:
  `test/unit/chrome-shared-scripts.test.js` — replays every `../shared/*.js`
  `<script>` tag index.html loads (parsed from index.html itself, not a
  hand-maintained list) into one shared `vm` context in load order (a fresh `vm`
  context's top-level lexical environment reproduces the browser's
  shared-script-tag collision semantics exactly — verified: a second
  `vm.runInContext('const X=2')` after `const X=1` throws the identical
  `SyntaxError` a document would) and asserts none throws — turns this defect
  class unit-visible going forward. 2 tests added. Re-ran S1 after the fix: no
  `SyntaxError`/`BURNER` console errors, `AUTOMATION_DEV_MINT` prints a non-null
  `key`. Full scenario matrix (all post-fix):

  | scenario | observable | result |
  |---|---|---|
  | S0 isolation probe | scratch boot creates `<scratch>/goldfinch-dev/containers.json`; real profile hash/mtime before vs. after | scratch dir + containers.json created (FRESH_SEED, `defaultId: personal`); real profile hash `40e68b01…` and mtime `1783627580` **unchanged** — PASS |
  | S1 fresh profile — boot tab | `enumerateTabs` (admin) on first boot | single boot tab, `jarId: "personal"` — PASS |
  | S1 fresh profile — auto-mint | `AUTOMATION_DEV_MINT` stdout line | `{"key":"jb56_…","adminKey":"8L06…"}` — non-null `key` — PASS |
  | S1 fresh profile — key hash target | `settings.json` `automationKeyHashes` | `{"personal": "<hash>"}` — keyed `personal`, not `default` — PASS |
  | S1 fresh profile — no re-seed | `containers.json` hash after S5 mutation, SIGTERM, boot #2, re-hash | both hashes `087adcf7…` — byte-identical — PASS |
  | S2 migrated legacy profile — v1→v2 rewrite | `containers.json` before/after boot | v1 bare 4-entry array → `{"version":2,"defaultId":"default","containers":[…4 entries…]}` — PASS |
  | S2 migrated legacy profile — boot tab | `enumerateTabs` (admin) | `jarId: "default"` — PASS |
  | S2 migrated legacy profile — auto-mint target | `settings.json` `automationKeyHashes` | `{"default": "<hash>"}` — keyed `default` (resolved default), matching DD7 — PASS |
  | S3 emptied registry — boot tab | `enumerateTabs` (admin) | `jarId: "burner-796073110"` — matches `^burner-` — PASS |
  | S3 emptied registry — auto-mint skip | stdout `AUTOMATION_DEV_MINT` + stderr | stdout `{"key":null,"adminKey":"EpFt…"}`; stderr exact line `[mcp] dev auto-mint skipped: default is Burner (no persistent jars)` — PASS |
  | S3 emptied registry — no reseed | `containers.json` hash before/after boot | both `c04771bb…` — byte-identical, `{"version":2,"defaultId":null,"containers":[]}` unchanged — PASS |
  | S4 privacy-handler — live web tab | chrome-eval `privacyClearStorage({url, webContentsId: <web wcId>})` | `{"ok":true,"origin":"https://www.google.com"}` — PASS |
  | S4 privacy-handler — internal tab (via `window.createTab(..., {trusted:true})`) | same call, `webContentsId` of `goldfinch://settings` (opened via the documented chrome-eval `window.createTab` route, admin `enumerateTabs` confirms `jarId: "internal"`) | `{"ok":false,"error":"no-tab"}` — PASS (internal guard; same shape as the 999999 case, as documented) |
  | S4 privacy-handler — nonexistent wcId | same call, `webContentsId: 999999` | `{"ok":false,"error":"no-tab"}` — PASS |
  | S5 live routing — omitted `jarId` (admin) | `openTab({url:'about:blank'})` → `enumerateTabs` | new tab `jarId: "personal"` (matches the live default) — PASS |
  | S5 live routing — post-`jarsSetDefault` | chrome-eval `window.goldfinch.jarsSetDefault({id:'work'})` → `openTab({url:'about:blank'})` → `enumerateTabs` | `jarsSetDefault` → `true`; next omitted-`jarId` tab `jarId: "work"` — PASS, no explicit wait needed (per leg's broadcast-before-resolve note) |

  **Greps** (all against the post-D1-fix working tree): `PAGE_PARTITION|DEFAULT_CONTAINER`
  in `src/ test/` → 0 matches. `'default'` in `src/main/main.js` → 0 matches.
  `'default'` in `src/renderer/renderer.js` → exactly 1 match, `renderer.js:1302`
  `thumb.style.cursor = 'default';` — the pre-enumerated CSS cursor false positive,
  exempt (design review cycle 1). `ff8c42` in `src/` → exactly 1 match,
  `src/shared/burner.js:21`. `tests/behavior/*.md` sweep
  (`default. jar\|jar .default\|` the backtick-`default` pattern) → 5 hits,
  every hit inspected:
  `farbling-correctness.md:16` (resolved-default migration language, Leg 2's own
  text) — exempt; `new-tab-default-routing.md:40` ("not `default` and not a
  `burner-*` id" — negative assertion) — exempt; `automation-key-gating.md:47-50`
  (resolved-default + explicit "not necessarily the literal id `default`"
  disclaimer, Leg 2's own text) — exempt; `settings-automation.md:142`
  ("a persistent jar row with no key (on this dev profile e.g. the legacy
  `default` jar)" — generalized example parenthetical, Leg 2's own text) — exempt.
  The narrower flight-level pattern (`the .default. jar\|literal .default.`) → 1
  hit, `automation-key-gating.md` (same Preconditions block above, explicitly
  disclaimed as non-literal) — exempt; 0 specs assert the auto-mint provisions,
  or a fixture requires, the literal reserved `default` jar.
  **Spec-preconditions audit** (text audit against the S1/S2 observed mint
  behavior above, no full reruns): `automation-key-gating.md` Preconditions
  ("resolved-default jar's key… the legacy `default` jar on this migrated dev
  profile unless the flag has been moved") — satisfiable, matches both S1
  (`personal`) and S2 (`default`) observed targets; `mcp-jar-scoping.md` /
  `mcp-auth-gating.md` Preconditions ("verify (or set via `jarsSetDefault`) that
  `personal` currently holds the default flag") — satisfiable, S1's fresh-seed
  boot defaults to `personal` exactly as assumed; `farbling-correctness.md`
  (resolved-default + record-the-flag-holder language) — satisfiable, same
  pattern. All four preconditions hold under the DD7 behavior as implemented.
  **Suite**: `timeout 120 npm test` run twice, both `1148/1148` (1146 + 2 new
  regression tests), zero flakes; `npm run typecheck` green; `npm run lint`
  green. Test count 1146 → 1148 (+2, `test/unit/chrome-shared-scripts.test.js`).
  All scratch app instances confirmed exited (SIGTERM + process-list check)
  before each next scenario and at the end of the leg; no stray Electron
  processes remain. Leg 3 → `landed` (behavior test `new-tab-default-routing`
  deferred to the Flight Director per the leg spec — this leg's matrix is its
  precondition, now green).

---

- 2026-07-10 — **Leg 3 final AC closed: behavior test `new-tab-default-routing` PASS
  7/7** (first run; spec → `active`). FD-orchestrated Witnessed run, live two-agent
  mode (Executor adb8d8de7204317da / Validator afd4fa78dacc47ad0, both Sonnet), fresh
  scratch profile, MCP surface on free-port fallback 49709, curl-driven JSON-RPC
  apparatus. Run log: `tests/behavior/new-tab-default-routing/runs/2026-07-10-04-43-55.md`.
  Every routing transition proven live: fresh-seed default → flag move → last-jar
  deletion (burner fallback, literal id `burner-604573697`) → re-add auto-claim
  (validator independently confirmed the flag itself moved via its own
  `jarsGetDefault()` read). Carry-forwards recorded in the run log: spec revision
  items (explicit read actions in step 5, post-add getDefault assertion or
  second-jar-no-claim step, codified step-1 live-flag read), the dangling-jarId-on-
  surviving-tabs observation (documented DD2 trade-off; Flight 3/5 owns
  tabs-close-on-delete), and an app-side nicety (evaluate tool's generic
  "Script failed to execute" hides SyntaxError detail). Leg 3 fully `landed`.

---

- 2026-07-10 — **HAT leg (04-hat-default-semantics) designed** (lightweight per the
  HAT protocol). FD ruling: agent design-review skipped for this leg — it contains
  no implementation tasks; its steps restate already-twice-reviewed flight DDs and
  the Leg-3-proven apparatus, and its safety posture (real profile =
  reversible-only; destructive demo isolated to scratch) is the only novel content,
  reviewed here explicitly. Leg → `ready`; session begins with the operator.
- 2026-07-10 — **HAT inline fixes implemented — D2 (Ctrl+T) + D3 (link-open jar
  inheritance)**. Diagnosed and fixed live against scratch profiles
  (`XDG_CONFIG_HOME`-isolated, `GOLDFINCH_AUTOMATION_DEV_MINT`/`_ADMIN`, MCP
  `pressKey`/`enumerateTabs`/`evaluate` apparatus — Leg 3/HAT's proven rig); the
  operator's real profile was never attached to: a real instance
  (`~/.config/goldfinch-dev`, port 49709) was already running independently
  before this session's first process check; every scratch launch used its own
  `XDG_CONFIG_HOME` and every MCP/curl call targeted the scratch instance's own
  discovered port, never 49709. **Caveat**: no pre-session hash of
  `~/.config/goldfinch-dev/containers.json` was captured before starting, so
  this is a spot-check, not a byte-for-byte before/after diff — post-session:
  `eb5d93683de12728cd266da365cbc23a`, mtime `1783627559` (unix), consistent with
  a file untouched since well before this session began.

  **D2 fix**: `src/main/main.js` gains `handleGuestNewTab` (beside
  `handleGuestCrossViewNav`) — forwards Ctrl/Cmd+T to the chrome renderer via the
  existing `chrome-shortcut-action:new-tab` channel, autoRepeat-guarded. Wired
  into both `wireGuestContents` branches (web-guest capture, called first
  alongside `handleGuestCrossViewNav`; and the internal-guest minimal handler),
  since `dispatchChromeAction('new-tab')` has no internal-tab gate. Root cause and
  regression-vs-pre-existing classification recorded in the D2 deviation entry
  above (updated per the HAT protocol's one authorized edit). Live-verified
  post-fix: guest-focused `pressKey` Ctrl+T → tab count +1 (was: no-op,
  reproduced identically pre-fix on both this branch and a `d1e6be0` worktree);
  internal-Settings-focused Ctrl+T → tab count +1. No regression unit test — the
  defect is a real-boot focus/IPC interaction unreachable through the
  `require()`-based runner (D1/Leg-3 precedent).

  **D3 implementation**: new `src/shared/inherit-container.js` — pure
  `inheritContainerDecision(sourceContainer, sourceIsInternal)`, dual-exported
  like `default-routing.js`, returning at most one of `{ container }`
  (persistent-jar source — inherit the same reference) / `{ freshBurner: true }`
  (burner source — caller mints a NEW burner, never the source's own partition,
  per the mission's burner-tabs-never-share-state invariant) / `{}` (internal or
  unresolvable source — no inheritance, falls through to DD1's default-jar
  resolution). `src/renderer/renderer.js` gains `inheritContainerFrom(tab)`
  (beside `makeBurner`) — the impure wrapper that calls `makeBurner()` on the
  `freshBurner` decision (burner minting stays renderer-side, same DD1 split).
  The three context-menu open call sites (`link:open`, `image:open`,
  `sel:search`, inside the `page-context` `onMenuOverlayActivated` case) now
  resolve `srcContainer = inheritContainerFrom(findTabByWcId(wcId))` once
  (`wcId` is `pageCtx.wcId`, already the captured SOURCE tab per the existing
  TOCTOU-safe body discipline; `findTabByWcId` was already defined,
  Flight-3-era) and pass it as `createTab`'s second argument. `index.html` gained
  `<script src="../shared/inherit-container.js">` (after `default-routing.js`,
  before `renderer.js`). `renderer-globals.d.ts` and `eslint.config.mjs`'s
  renderer-globals list gained `inheritContainerDecision` (same pattern as
  Leg 1's `BURNER`/`resolveNewTabContainer` additions). New
  `test/unit/inherit-container.test.js` (6 tests: the full truth table —
  persistent→inherit-same-reference, burner→freshBurner-sentinel,
  internal→`{}` regardless of container shape, missing/null source→`{}`,
  mutual-exclusion of the two fields, malformed-input never-throws). Test count:
  1148 → 1154 (+6). Live-verified via chrome-eval composing the exact production
  expression (`inheritContainerFrom(findTabByWcId(wcId))` then
  `createTab(url, container)`): persistent-jar source (`personal`) → new tab
  `personal` (same id); burner source (`burner-167921881`) → new tab
  `burner-434801479` (fresh id, both `burner:true`, `sameContainerRef:false` —
  confirms no partition sharing); internal (Settings) source →
  `inheritContainerFrom` returns `null` (falls through to default resolution, as
  designed).

  **window.open/target=_blank audit (report only, per the leg's ask — not
  fixed)**: popups do NOT inherit the opener's jar, and do NOT route through
  `inheritContainerFrom` — same gap D3 fixed for context-menu opens, still open
  here. `wireGuestContents`'s `contents.setWindowOpenHandler` (src/main/main.js,
  line 1042, inside the per-guest wiring closure that already has the
  opener's `contents` in scope) denies the native Electron window and forwards
  ONLY the target `url` — `getChromeContents()?.send('open-tab', url)` — never
  the opener's `contents.id`. The preload wrapper
  (src/preload/chrome-preload.js:114, `onOpenTab: (cb) => ipcRenderer.on('open-tab',
  (_e, url) => cb(url))`) and the renderer subscriber
  (src/renderer/renderer.js:2367, `window.goldfinch.onOpenTab((url) =>
  createTab(url))`) both carry only the URL. `createTab(url)` with no second
  argument falls straight through to DD1's default-jar resolution — so a
  `window.open()` call from a tab in a persistent non-default jar (or a burner
  tab) opens its popup in the DEFAULT jar, not the opener's, mirroring D3's
  pre-fix context-menu behavior exactly. Not fixed here: closing this gap needs
  the opener's `contents.id` threaded through all three sites (the
  `setWindowOpenHandler` send, the preload `onOpenTab` signature, and the
  renderer subscriber resolving `inheritContainerFrom(findTabByWcId(openerWcId))`
  before calling `createTab`) — a real three-file plumbing change, not a
  trivial one-liner, so left for a future flight/leg per the leg's audit-only
  instruction.

  **Verification**: `timeout 120 npm test` → 1154/1154 (baseline 1148, +6, all in
  `inherit-container.test.js`); `npm run typecheck` green; `npm run lint` green
  (both re-run clean after the eslint.config.mjs globals addition).
  `test/unit/chrome-shared-scripts.test.js` (Leg 3's D1 regression replay) still
  passes with the new `inherit-container.js` script tag in the load order — no
  top-level identifier collision. All scratch app instances (SIGTERM, confirmed
  by PID) and the `d1e6be0` diagnostic worktree torn down;
  `/tmp/goldfinch-hat-fix` removed; the operator's real `~/.config/goldfinch-dev`
  confirmed never attached to during this session (spot-check hash/mtime above).
  Leg 4 verification steps 1/3/4/5 (visual/propagation/burner-
  fallback/sign-off) remain for the live HAT session with the operator — this
  entry covers only the D2/D3 inline-fix diagnosis and implementation.

---

- 2026-07-10 — **Leg 4 (`hat-default-semantics`) completed — operator sign-off,
  flight landed.** Guided session outcomes:
  **Step 1** (real profile, migrated look-and-feel): PASS — boot tab in legacy
  `Default` with its new grey dot; picker lists all migrated jars + Burner. **DD6
  decision: always-dotted KEPT** (operator: "Keep the dot on all tabs").
  **Step 2** (new-tab routing): initially surfaced two findings → D2 (Ctrl+T dead
  under guest focus — diagnosed as a PRE-EXISTING before-input-event forwarding gap,
  not an F2 regression; fixed via `handleGuestNewTab` in main.js; sibling
  accelerators logged as Anomaly) and D3 (operator ruling: link-opens inherit the
  source tab's jar — implemented via new `src/shared/inherit-container.js` + three
  context-menu call sites; burner sources mint a FRESH burner preserving the
  never-share-state invariant and fixing the burner→persistent-jar leak;
  window.open/target=_blank audit: popups still default-route, deferred). After
  fixes: operator re-verified both paths — PASS ("pass").
  **Step 3** (live propagation, reversible, FD-driven via admin apparatus on port
  49709): rename+recolor Work → "Work (HAT)"/pink propagated live to the open tab's
  dot and the picker — PASS; `jarsSetDefault(personal)` → operator Ctrl+T landed in
  Personal — PASS; full restore verified by post-restore reads (default flag back on
  `default`, Work name/color restored, FD demo tab closed).
  **Step 4** (scratch profile, destructive isolated): delete both seed jars →
  operator's Ctrl+T produced an evaporating burner tab (orange dot), picker showed
  no persistent jars — PASS; `jarsAdd('Fresh')` auto-claimed the flag, next Ctrl+T
  landed in Fresh — PASS. Operator also observed the deleted-jar tab staying open
  (green dot) — confirmed as the documented DD2 trade-off; recorded as
  operator-confirmed input for Flight 3's tabs-close-on-delete (mission criterion 4).
  **Step 5**: operator sign-off — "pass, sign off. land the flight."
  Environment: FD launched/tore down both instances; real instance left running for
  the operator; scratch profile removed. Suite post-fixes 1154/1154, typecheck +
  lint clean. Leg → `completed`; CP4 checked; flight → `landed`.

---

## Decisions

*(none yet)*

---

## Deviations

### D2 (HAT step 2): Ctrl+T reported non-functional on the operator's real profile
**Planned**: HAT step 2 expected Ctrl+T to open a tab in the default jar.
**Actual**: Operator reports Ctrl+T does nothing; context-menu open-in-new-tab works
(lands in default). Wiring exists (keydown-action.js:61 `'t'` → `new-tab` →
renderer dispatch `createTab()`), so the failure is in the live key path —
regression-vs-pre-existing to be determined by bisect against main.
**Reason**: pre-existing gap (not a Flight 2 regression) — root-caused live. On the
native multi-`WebContentsView` surface, OS keyboard focus sits in whichever guest
webContents is foreground; the chrome-shell `document.addEventListener('keydown')`
handler that dispatches `keydownToAction`'s `'t'` → `'new-tab'` mapping
(renderer.js) only fires while the chrome DOM itself holds OS focus (freshly
booted / address bar focused). `wireGuestContents`'s `before-input-event` capture
on a focused guest (main.js) forwards a curated accelerator subset (F12, zoom,
print, find, Ctrl+J downloads, Ctrl+Shift+I devtools) plus the dedicated
cross-view bridge for Ctrl+L — but never forwarded `'t'`/new-tab, so a normally
focused web page (the overwhelmingly common state during real browsing) silently
swallowed Ctrl+T with no console error. `sheetAcceleratorAction`
(sheet-accelerator.js) already enumerated `new-tab` as chrome-class for the
menu-sheet-open forwarding path (M05 F8 DD13) — the plain no-sheet guest capture
simply never implemented the equivalent forward, so the union that path's own doc
comment describes was only ever half-wired. Confirmed pre-existing, not a Flight 2
regression: `git diff d1e6be0 3998888 -- src/main/main.js` touches none of
`wireGuestContents`/`before-input-event`, and a live d1e6be0 worktree boot
reproduced the identical swallow (chrome-target Ctrl+T opened a tab, 1→2;
guest-target Ctrl+T did not, count unchanged) on a scratch profile seeded to the
legacy-migrated shape (fresh-seed profiles can't auto-mint on main — the very
`'default'`-literal gap this flight retires — so the legacy shape was needed to
get a key). Fixed: `handleGuestNewTab` (src/main/main.js, new function beside
`handleGuestCrossViewNav`) forwards Ctrl/Cmd+T via the existing
`chrome-shortcut-action:new-tab` channel (same channel the sheet path and the
cross-view bridge already use), autoRepeat-guarded (mirrors the Ctrl+J downloads
guard — a held chord must not stack tabs). Wired into BOTH `wireGuestContents`
branches (the normal web-guest capture AND the internal-guest minimal handler),
since `dispatchChromeAction('new-tab')` has no `isInternalTab` gate (unlike
devtools/zoom/find) — Ctrl+T must work regardless of which guest currently holds
focus, web or internal. Live-verified post-fix on a fresh scratch boot (MCP
`pressKey` Ctrl+T against a guest wcId → tab count +1; against a chrome-eval-opened
internal Settings tab's wcId → tab count +1). No regression unit test added: the
defect is a real-boot-only focus/IPC interaction (identical class to Leg 3's D1),
not reachable through the `require()`-based unit runner — same reasoning as D1's
own regression coverage being a real-boot replay, not a unit assertion.
Sibling chrome-class keys the same guest capture never forwards either — Ctrl+W
(close-tab), Ctrl+M (toggle-panel), Ctrl+Shift+P (toggle-privacy), Ctrl+R
(reload), all enumerated in `sheetAcceleratorAction`'s chrome-class branch but,
like `'t'` before this fix, never wired into the plain no-sheet guest capture —
left untouched (out of the reported D2 scope; the operator did not report them
non-functional) and logged as an Anomaly below for a future flight/leg.

### D3 (HAT step 2): scope addition — link-opens inherit the source tab's jar
**Planned**: all partition-less tab creation routes to the default jar (DD1).
**Actual/Decision**: Operator ruling at HAT — opening a link in a new tab from a
non-default tab must stay in THAT tab's jar. FD design ruling for the two
non-persistent sources: burner source → a FRESH burner (inheriting the same burner
partition would violate the mission's burner-tabs-never-share-state invariant; note
this also fixes the pre-existing leak where burner link-opens landed in a persistent
jar), internal source → default resolution (status quo). Applies to the
context-menu open paths (link / image / selection-search); window.open/target=_blank
flow to be audited by the fixing Developer and reported.
**Reason**: user-visible semantics judged at HAT — exactly what the leg exists for.

---

## Deviations (pre-HAT)

- **D1 (Leg 3, product defect — real-boot-only, F1's D1 precedent repeated)**:
  `src/shared/container-menu.js`'s DD8 hybrid `BURNER` resolution declared a
  top-level `const { BURNER } = …`, colliding with `src/shared/burner.js`'s own
  top-level `const BURNER = …` in the shared global lexical environment classic
  `<script>` tags in one HTML document use — `index.html` loads both, in that
  order, for the chrome renderer. The collision threw
  `SyntaxError: Identifier 'BURNER' has already been declared` at parse time on
  every real boot, silently killing all of `container-menu.js` (`buildContainerModel`
  undefined) — invisible to `require()`-based unit tests, which each get their own
  module scope. Caught by Leg 3's S1 (the first real boot of the flight). Fixed by
  renaming the browser-path local binding to `RESOLVED_BURNER` (no functional
  change; the CJS/test-runner path is unaffected). Regression-tested:
  `test/unit/chrome-shared-scripts.test.js` replays every shared `<script>`
  index.html loads, in order, in one `vm` context (which reproduces the browser's
  shared top-level-lexical-scope semantics) and asserts none throws — this defect
  class is now unit-visible. See the Leg 3 flight-log entry above for the full
  diagnosis and fix detail.

---

## Anomalies

- **Sibling guest-focus keyboard gap (found while root-causing D2, not fixed —
  out of D2's reported scope)**: `wireGuestContents`'s plain (no-sheet) guest
  `before-input-event` capture (src/main/main.js) never forwards Ctrl+W
  (close-tab), Ctrl+M (toggle-panel), Ctrl+Shift+P (toggle-privacy), or Ctrl+R
  (reload) to the chrome shell — the identical defect class D2 fixed for Ctrl+T
  (new-tab). All four are already enumerated as chrome-class in
  `sheetAcceleratorAction` (src/shared/sheet-accelerator.js:63-67, the
  menu-sheet-open forwarding path), confirming they were always intended to
  reach the chrome dispatcher; the plain guest capture just never implemented
  that forward for them (same half-wired-union shape as `'t'` before this leg's
  fix). Pre-existing (predates this flight), not reported by the operator, not
  reproduced/confirmed live — flagging for a future flight/leg to root-cause and
  fix with the same `handleGuestNewTab` pattern (or a single generalized
  chrome-class forwarder reusing `keydownToAction`/`sheetAcceleratorAction`
  instead of one hand-rolled function per key).

---

## Session Notes

- 2026-07-09 — Flight designed. Behavior-test spec `new-tab-default-routing` authored
  at design time (draft; first run scheduled in Leg 3).

### Flight Director Notes

- 2026-07-09 — Recon executed before spec drafting (all five sites re-grepped at
  `d1e6be0`); no contentious classifications, proceeded without recon escalation per
  the operator's autonomy directive.
- 2026-07-09 — **Design review cycle 1** (Architect, Sonnet): *approve with changes*,
  2 HIGH + 3 suggestions, all incorporated. (1) HIGH: `jars-get-default` raw shape vs
  `jars-changed` normalized shape — reference-identity Burner detection is meaningless
  across IPC; DD3 now mandates id-comparison (`d.id !== BURNER.id`) reconciliation,
  averting a `createTab` crash on emptied-registry boots. (2) HIGH: recon missed
  `tests/behavior/automation-key-gating.md` hardcoding the literal `default` jar DD7
  retires (the gap lived outside the `src/`-scoped grep) — fixture migration added to
  Leg 2, grep ACs extended to `test/` + `tests/behavior/`. Suggestions folded: DD1
  admin-only scope clause (jar-scoped keys force own jar, scope.js:157-163);
  `spellcheck.md:25` prose drift; Leg 3 joint re-verify of the three
  auto-mint-dependent specs. Architect independently confirmed DD5's no-functional-gap
  premise (session-created hook + getAllWebContents sweep) and ran the suite
  (1132/1132). Substantive changes → cycle 2 spawned.
- 2026-07-09 — **Design review cycle 2** (Architect, Sonnet): *approve with changes*.
  Verified cycle-1 amendments correctly incorporated (DD3 reconciliation sound against
  jar-ipc.js:95 / reserved-id remap; DD8 script order OK). One NEW HIGH: cycle 1's
  claim that `mcp-jar-scoping.md`/`mcp-auth-gating.md` already used resolved-default
  phrasing was **false** — both hardcode `personal` as the auto-mint target (same
  defect class), and neither pins an isolated profile, so this flight's own
  set-default exercises could shift the flag under them. DD7 corrected + fixture
  migration extended to all three specs (mint-target refs only; staged-tab `personal`
  fixtures stay, gated by a verify-flag precondition). Reviewer ruled fold-in
  sufficient, no cycle 3 required (max-2 protocol respected). Flight → `ready`.
- 2026-07-09 — Flight → `in-flight`; branch `flight/02-default-jar-semantics` created
  off main `d1e6be0`. Execution mode: deferred review (design review per leg; single
  code review + commit after Leg 3; HAT leg follows the commit, fixes committed
  separately).
- 2026-07-09 — **Leg 1 design review** (Developer, Sonnet): *approve with changes* —
  1 HIGH (picker's `containers.push` at renderer.js:2644 duplicates the new jar now
  that `jars-changed` replaces the array before the invoke resolves → push deleted,
  step 7b), 2 MEDIUM (menu-overlay.js:157 comment would break the grep AC → added to
  comment sweep; pJar must always return an HTMLElement — appendChild call site
  renderer.js:2123). All fixes were direct adoptions of the reviewer's prescribed
  remedies — no novel design introduced, second cycle skipped (FD ruling, consistent
  with F1 practice). Reviewer confirmed baseline 1132/1132 + clean typecheck/lint and
  independently re-verified the DD3 reconciliation necessity. Leg 1 → `ready`.
  Carry-forward for Leg 2 design: reviewer flagged
  `tests/behavior/settings-automation.md:142-143` ("find the `default` jar row") as a
  possible fourth literal-default spec — assess during Leg 2 design.
- 2026-07-09 — **Leg 2 design review** (Developer, Sonnet): *approve with changes* —
  1 HIGH (`tests/behavior/farbling-correctness.md:16` is a SIXTH literal-`default`
  spec, missed by recon AND by the leg's own verification grep pattern → added to
  the migration list, grep pattern broadened to inspect-every-hit form), 2 MEDIUM
  (new internal-session reachability in the rewritten `privacy-clear-storage` —
  `__goldfinchInternal` guard added to all three handlers; stale `pageSession`
  comment at main.js:2420 added to step 4). Suggestions folded: migration-strategy
  note (exhaustive reword vs verify-the-flag precondition is deliberate per spec),
  spellcheck.md reword keeps "never the internal session", automation-dev.js module
  header note. All fixes direct adoptions → second cycle skipped (FD ruling, same
  basis as Leg 1). Answering the reviewer's questions for the record:
  farbling-correctness was a recon miss, not a deliberate exclusion (now in scope);
  the internal-session guard lands NOW, in this leg. Leg 2 → `ready`.
  Methodology observation for the debrief: literal-default fixture text in
  tests/behavior/ has now produced FOUR review catches across two artifacts — the
  recon phase should have grepped tests/behavior/ from the start.
- 2026-07-09 — **Leg 3 design review** (Developer, Sonnet): *approve with changes* —
  2 HIGH (S4's settings-tab route via automation `openTab` is non-viable — the hook
  never forwards `trusted` and `isSafeTabUrl` rejects `goldfinch://`; replaced with
  the chrome-eval `window.createTab(...trusted)` route as the sole documented path.
  The flight grep AC `'default'`-in-renderer.js has a false positive:
  `thumb.style.cursor = 'default'` — a FIFTH literal-'default' grep incident this
  flight; exemption enumerated in leg + flight.md Verification), 1 MEDIUM (S1
  byte-compare note read backwards → reworded: both hashes captured post-S5).
  Suggestions folded: broadcast-before-resolve ordering citation (no wait needed in
  S5), S2 probe-dir note (realism only), S4 same-failure-shape clarification.
  Reviewer verified all scenario observables against the implemented working tree
  (mint line format, skip string, FRESH_SEED ids, v1→defaultId 'default', v2 branch
  never re-saves, burner-<n> jarId shape, admin enumerates internal tab, behavior
  spec rows 5/7 match code). Direct adoptions → cycle 2 skipped (FD ruling). Leg 3
  → `ready`.
- 2026-07-10 — Flight-level code review (Reviewer, Sonnet): [HANDOFF:confirmed], zero
  issues; 1148/1148 independently re-run; grep ACs re-verified; hygiene grep clean.
  Legs 1-3 committed; HAT leg next.
