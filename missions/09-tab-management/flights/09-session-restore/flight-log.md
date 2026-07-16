# Flight Log: Session Restore

**Flight**: [Session Restore](flight.md)

## Summary

Setting-gated startup restore of windows + tabs (addresses + jars), built on a new
Electron-free disk store cloning `downloads-store.js`'s durability discipline. Folds in the F8
debts that sit on the paths this flight touches (move-core structural fix, `shouldArm`
extraction, small hygiene items). Execution notes appended below as legs run.

---

## Reconnaissance Report

Read-only recon of the session-restore-relevant codebase and verification of each F8 debrief
action item against current code. Every claim anchored on a symbol + `file:line` (line numbers
drift; the symbol is the durable anchor).

### A. Persistence layer (closed-tab stack, Flight 4)

- **Two distinct pieces; the closed-tab stack is NOT on disk.** The persistence *exemplar* is
  `src/main/downloads-store.js` (bounded array-of-records JSON store): on-disk `{version:1, nextId, records}`
  → `downloads.json` in the injected `dir` (`load(userDataPath)`, Electron-free); atomic write
  `file+'.tmp'` then `fs.renameSync` (`save`); bound via `pruneOldest` (`MAX_RECORDS=500`, drop-oldest);
  never-throws load (corrupt/missing → empty, `nextId=1`); codec seam `{serialize, deserialize}`
  default `JSON.stringify/parse`. API: `{ load, list, append, remove, clear, getNextId }`.
  `settings-store.js` shares the identical durability discipline but an object-schema (fixed-key
  DEFAULTS) instead of array-of-records.
- **The closed-tab store** is `src/shared/closed-tab-stack.js` — a **pure factory**
  `createClosedTabStack({maxEntries=25})`, not a disk store. API `{ push, pop, peek, size, toJSON, fromJSON }`.
  Entry shape `{ url, title, jarId, stripIndex, navEntries, navIndex, closedAt }` (+ `windowId` at the
  capture layer). **`toJSON`/`fromJSON` are the designed-but-unwired F9 persistence hook** — module
  header: *"Flight-9 persistence hook … unused this flight, since this flight keeps the stack
  in-memory only."* `main.js` creates the singleton with no load/save; there is no closed-tab JSON
  file. **Resolves the mission open question: the closed-tab stack does NOT survive restart; F9 adds
  the disk wiring.**

### B. Burner exclusion (positive persist-jar allowlist)

- **History-recorder precedent** (`src/main/history-recorder.js`, `handleNavigation` gate 1):
  `const jar = listJars().find(j => j.partition === partition); if (!jar) return null;` — header states
  *"Positive allowlist … no 'is not a burner' negative check anywhere."*
- **Closed-tab exclusion** (`src/main/closed-tab-capture.js`, `captureClosedTabEntry`):
  `const jar = !tabEntry.trusted && jarsList.find(j => j.partition === tabEntry.partition); if (!jar) return null;`
  — **the exact predicate F9's snapshot builder reuses.**
- **Jar identity:** jar record `{id,name,color,partition,retentionDays}`; partitions are `persist:`-prefixed,
  immutable, `^persist:/`-validated. Tab entry (`main.js`) `{ view, partition: trusted?INTERNAL_PARTITION:partition, trusted, active }`.
  Burner is a frozen sentinel (`src/shared/burner.js`) never in `jars.list()`; renderer mints ephemeral
  `burner-<n>` ids whose partitions never appear in the store. **Canonical predicate: membership in
  `jars.list()` via `.find(j => j.partition === …)` — that IS the positive allowlist.** Never
  `partition.startsWith('burner')`.

### C. Navigation history restore

- Closed-tab entry stores `navEntries: wc.navigationHistory.getAllEntries()` + `navIndex: getActiveIndex()`
  (`closed-tab-capture.js`) — live Electron `NavigationEntry[]` (url/title/**`pageState`** base64), held as an
  in-memory reference, **not serialized to disk today**. Reopen (`tab-reopen`, `main.js`) returns them verbatim;
  the renderer's `createTab(..., {restoreHistory})` calls `navigationHistory.restore()`. **F9 implication:** to
  persist history across restart one would have to prove `getAllEntries()` JSON-round-trips — an unproven risk
  the in-memory path never exercised. **DD5 scopes history OUT of restore** (criterion is address+jar; reopen owns history).

### D. Settings surface (the F9 toggle template)

- **Store** (`src/main/settings-store.js`): boolean templates `automationEnabled:false` **with strict validator**
  `(v)=>typeof v==='boolean'` and `spellcheck:false` (no validator, typeof-fallback). **F9 follows
  `automationEnabled`: explicit strict-boolean validator, additive, no schema bump.** Merge-with-repair load;
  validate-before-mutate atomic `set`; `get`/`getAll`.
- **IPC** (`main.js`): boot read `settings-get` (bridged `window.goldfinch.settingsGet`); settings-page
  origin-gated `internal-settings-get`/`internal-settings-set` (`set` + `broadcast('settings-changed')` + optional
  live side-effect). **F9's toggle needs NO live side-effect (startup-only)** — set + broadcast suffices; main
  reads `settings.get()` directly at boot.
- **UI** (`src/renderer/pages/settings.html` + `settings.js`): the **spellcheck IIFE** is the closest template —
  a `<label class="shield-row"><span>…</span><input type="checkbox" id="…"></label>` row + a `settingsGet(...).then(v=>el.checked=v===true)`
  populate + `change`→`settingsSet(...)` write + `onSettingsChanged` sync + `pagehide` cleanup. Clone it with a new id.

### E. Startup + window lifecycle (main process)

- **Startup** `app.whenReady().then(...)`: `initProfileAndStores(app, {shields, settings, jars, downloads})`
  (dev-profile `setPath('userData')` + all four store `load()`s) → history store/recorder/downloads manager,
  internal session → **`createWindow()`** (the single default window). **F9 loads its session store in the
  `initProfileAndStores` group and adds the restore decision at the `createWindow()` seam.**
- **First window:** `function createWindow({ noBootTab=false, contentSize=null })` — builds `BaseWindow` + chrome
  `WebContentsView`, loads `index.html`, `registry.create({win, chromeView, noBootTab})`. **Boot tab is created in
  the RENDERER, gated by main:** `window-boot-config` returns `{ bootTab: !rec.noBootTab }`; renderer boot does
  `if (bootConfig.bootTab !== false) createTab(url||HOMEPAGE)`. **F9 restore seam: at `whenReady`, if restore on +
  snapshot present, rebuild N windows via `createWindow({noBootTab:true})` + adopt saved tabs (the adopt path
  `moveTabIntoWindow` uses), else the single default `createWindow()`.**
- **Quit chain:** **`before-quit` exists** — runs `downloadsManager?.flushInterrupted()` then `mcpServer?.stop()`;
  fires on real quit all platforms; **the natural clean-quit snapshot hook** (best-effort synchronous write beside
  `flushInterrupted`). `window-all-closed` (non-darwin → `stop(); app.quit()`). `will-quit` runs
  `historyStore.close()` **after** windows are gone — a snapshot enumerating live windows must NOT go here. Ordering:
  `close → 'closed' → 'window-all-closed' → app.quit()`; per-window `close` handlers already push tabs onto the
  closed-tab stack, so **F9's snapshot must read topology in `before-quit` (fires FIRST)**, a separate concept from
  the per-window close-capture.
- **Registry & census:** `src/main/window-registry.js` `createWindowRegistry()`; window record
  `{ win, chromeView, tabViews:Map<wcId,entry>, activeTabWcId, noBootTab, …, findOverlay, sheet }`; API includes
  `records()` (insertion order), `getLastFocused`, `getWindowForChrome`. Tab entry `{view, partition, trusted, active}` —
  **address is `view.webContents.getURL()`** (not on the record); **tab order is renderer DOM order** (main does not
  track visual order). Census `buildWindowCensus` (`window-census.js`) → per-window topology; `enumerateTabs`
  (`automation/tabs.js`) → `{wcId,url,title,jarId,active,windowId}` across all windows. **Snapshot build:
  `registry.records()` × per-tab `getURL()` + `partition`→`jarId` via the B allowlist (burners drop free); order =
  insertion unless a cheap main-side order source is found.**

### F. F8 debrief action items — classification

| # | Item | Classification | Evidence (symbol @ file) | Note |
|---|------|----------------|--------------------------|------|
| 1 | Move-core pre-set disarms `tab-set-active` guard (Rec 5) | **confirmed-live** | `moveTabIntoWindow` pre-set `target.activeTabWcId = p.wcId` + in-core hide/`closeMenuOverlay('tab-switch')` compensation; `tab-set-active` guard `owner.activeTabWcId!==null && owner.activeTabWcId!==wcId` (hide + menu branches + `else if (owner.sheet?.isMenuOpen()) owner.sheet.show()` re-show) @ `src/main/main.js` | Code comment already says "the STRUCTURAL fix … is F9's." F9 restore-adopt walks this path → fix in leg 1. |
| 2 | `Math.hypot` arm-threshold unit test | **confirmed-live** (not extracted, no test) | `if (Math.hypot(dx,dy) < DRAG_ARM_THRESHOLD_PX) return;` in the document `pointermove` listener; `const DRAG_ARM_THRESHOLD_PX = 5;` @ `src/renderer/renderer.js`. `grep -rn hypot\|DRAG_ARM_THRESHOLD_PX\|shouldArm test/` → zero. `tab-drag-zone.js` exports only `classifyDragPoint` | Extract `shouldArm(dx,dy)` into `tab-drag-zone.js` (pure, tracks `tab-order.js`) + unit test. Leg 1. |
| 3 | HIGH-1 net `tab-tearoff` row 8a unrun | **confirmed-live** (behavior, unrun) | banner "ROW 8a … HAS NEVER RUN"; row 8a asserts the `{T1:true, T2:false}` pair from one `enumerateTabs` call @ `tests/behavior/tab-tearoff.md`; displaced-menu residual also owed | Live behavior test; validates item 1's fix. Leg 4. |
| 4 | `tab-reorder` Step 4 cached-fiction coordinate | **confirmed-live** | Step 4 reads `window.screenX` → 564, filed INCONCLUSIVE; "OWED: re-instrument or delete; add a unit test over the threshold. Owner: F9." @ `tests/behavior/tab-reorder.md` | Overlaps item 2 (the unit pin lets Step 4 retire). Leg 4. |
| 5 | `CALL_RE` comment "nine" off-by-one | **confirmed-live** | comment says naive `grep -c "cancelDrag()"` reads NINE (7 calls + def + one prose mention); actual = **10** (7 calls + def + **two** prose mentions) @ `test/unit/tab-drag-invariants.test.js` | Test logic (7 masked) correct; only the parenthetical is stale (file grew a 2nd prose mention). Leg 1. |
| 6 | F8 leg-file/log tick consistency | **confirmed-live** (accurate flag; low priority) | leg 3 (`03-tearoff-by-drag.md`) has 6 unticked runtime ACs vs 7 ticked; leg 5 (`05-verification.md`) 0 unticked | F8 artifact hygiene; reconcile in leg 1. |

### G. Test & tooling conventions

- Runner: bare `node --test test/unit/*.test.js` (no jsdom). `test/helpers/source-scan.js` exports
  `{maskComments, findMatchingBracket, collectSources}` (regex-literal blind spot documented). **Every store
  module is Electron-free and unit-tested directly** (`closed-tab-stack`, `closed-tab-capture`, `downloads-store`,
  `settings-store`, `window-registry`, `window-census`, `init-profile`, `history-recorder` — none `require('electron')`).
  **F9's session store follows the same Electron-free `load(userDataPath)` pattern → unit-testable like `downloads-store`.**
- Gates: `test`, `lint` (`eslint .`), `typecheck` (`tsc --noEmit -p jsconfig.json`), `a11y` (`node scripts/a11y-audit.mjs`)
  all present. F8 landed **1892 pass / 0 fail / 0 skipped, 13 suites**.
- **Apparatus gap (critical for leg 4):** no relaunch/quit/restart/windowCreate op in the MCP surface — once
  `appQuit()` fires the transport dies. **A "quit → relaunch → windows come back" test needs an out-of-band harness**
  (Bash kills + relaunches the electron process, reconnects admin MCP). No precedent → DD9 premise-gates it (GO/NO-GO
  probe before the E2E spec is authored).

### Recon disposition

All six F8 items are `confirmed-live`. Nothing already-satisfied, nothing to retire. Items 1/2/5/6 → leg 1;
items 3/4 → leg 4. No source items require human recheck. Proceeding to design review with this classification.

---

## Leg Progress

_(appended as legs run)_

---

## Flight Director Notes

- **Branch/stack:** F9 branches off the F8 head (`flight/8-tearoff-cross-window-drag`); PR will base on
  `flight/8` to continue the mission's stacked-PR chain (F8 #91 → `flight/7-multi-window-2`).
- **Leg ordering rationale:** the move-core structural fix (DD8) lands in leg 1 **before** leg 3's restore-adopt
  reuses the same active-tab machinery — the F8 debrief's explicit instruction ("apply the move-core structural
  fix before editing this path").
- **Risk tiering (recorded up front):** all four legs tier **HIGH** — leg 1 (state-machine/lifecycle change that
  reverses a prior leg's approach), leg 2 (privacy-sensitive burner invariant against a new disk artifact), leg 3
  (startup/lifecycle; the regression-baseline constraint is absolute), leg 4 (authors the flight's assertions —
  F8 DD14 / F7 leg-4 lesson). Each gets a per-leg design review under `/agentic-workflow`.

---

## Design Review — Round 1 (Architect, needs-rework → reworked)

The first Architect pass returned **needs rework**, catching two load-bearing feasibility holes
(exactly the class the review targeted) plus three refinements. All folded into the spec before leg
execution:

- **[HIGH] `before-quit` snapshot reads EMPTY on close-last-window.** The per-window `close` handler
  destroys tabs *first*, then `window-all-closed → app.quit() → before-quit` fires on an empty
  registry. **Fix (DD3 rewritten):** capture at the `close` handler (tabs alive — the closed-tab
  capture site), union-at-write so the terminal write is authoritative on both quit paths;
  `before-quit` kept as the explicit-quit flush. The recon's "before-quit fires FIRST" was a
  conflation of the two quit paths — corrected.
- **[HIGH] Restore "adopts" saved tabs — wrong primitive.** Adopt re-parents a **live** view; cold
  start has no source. **Fix (DD4 rewritten):** restore **creates tabs fresh** via the proven reopen
  boot path (`createTab(url, …)`, jar from partition), never adopt.
- **[MEDIUM] Write not setting-gated.** DD3 now gates the *write* too — off ⇒ zero disk I/O.
- **[MEDIUM] DD9 clean-quit trigger.** A SIGKILL won't fire the capture; but capture-at-close means
  the last in-band `windowClose()` DOES → only relaunch+reconnect stays out-of-band. DD9 updated;
  NO-GO risk lowered.
- **[MEDIUM] Closed-tab-stack persistence conflation.** The reopen stack's `toJSON`/`fromJSON` are a
  *separate* artifact. **Fix (DD-Scope added):** explicitly deferred; the mission open question is
  decided "no, not this flight."
- **[LOW] DD8 rationale.** Restore uses the armed guard (fresh create), so the move-core fix is
  **not** a restore prerequisite — genuine F8 debt, landed in leg 1 organizationally. Recommended
  fix 2 (explicit caption, lower blast radius); leg-1 review decides.

**Confirmed sound (no change):** DD1 (store discipline faithful to both exemplars), DD2 (burner
allowlist verbatim, both-directions pin expressible), DD5 (history/geometry out — no criterion
silently failed), DD7 (settings template accurate). Round-2 review targets the reworked
DD3/DD4/DD6/DD9.

## Design Review — Round 2 (Architect, approve with changes)

Focused confirmation pass on the reworked decisions. Verdict **approve with changes** — the capture
site, fresh-create path, manifest delivery, and in-band clean quit are all confirmed against source;
one real bug remained in the write-coordination rule. All folded in (final review cycle — max 2):

- **[HIGH → fixed] The "union rewritten each close" rule shrank the snapshot on the menu-Exit path
  with ≥2 windows.** `before-quit` fires first (full registry), then each `close` fires after and
  each rewrite sees fewer windows (`registry.remove` at `closed`), so the terminal write = just the
  last-closed window → a 2-window session restores 1. **Fix (DD3 rewritten):** two-writer
  coordination — `before-quit` sets `quitting=true` and writes the full non-empty registry;
  per-window `close` writes are **suppressed while `quitting`**, and otherwise write
  `registry.records()` (serving mid-session dismissal + close-last-window). Invariant restated
  path-independently: *the terminal snapshot = the windows alive at the first quit-initiating event.*
- **[confirmed] DD4 fresh-create + delivery — no chicken-and-egg.** `window-boot-config` is a
  renderer→main invoke (the readiness signal itself); stash the ordered manifest on the registry
  record and return `{ bootTab:false, restoreTabs:[…] }`; renderer boot loop creates each tab via the
  proven `createTab(url, container, …)` reopen path. Folded into DD4.
- **[LOW → fixed] Deleted-jar edge:** a manifest entry whose jarId no longer resolves is **dropped**,
  not home-substituted. Folded into DD4.
- **[LOW → fixed] Doc drift:** the crash-recovery open question said "written in before-quit" —
  reconciled to the close-handler + before-quit story.
- **[verification] Added a leg-4 guard:** quit a **2-window** session via **menu Exit**, relaunch,
  assert **both** restored — survives the exact HIGH bug (a single-window E2E would pass over it).
- **[confirmed] DD9:** `windowClose()` (`chrome-preload.js` → `window-close` → `win.close()`) is the
  same bridge `tab-tearoff` row 9 drives; the clean quit is fully in-band, only relaunch+reconnect is
  out-of-band — the probe's sole unknown is correctly scoped.

**Disposition:** two design-review cycles complete (the workflow's max). The remaining change is
bounded to leg 3's write-coordination code and is carried into leg 3's own per-leg design review.
Spec is codebase-validated; proceeding to leg execution.

---

## Decisions

_(runtime decisions not in the original plan — appended as they arise)_

---

## Anomalies

_(unexpected issues — appended as they arise)_
