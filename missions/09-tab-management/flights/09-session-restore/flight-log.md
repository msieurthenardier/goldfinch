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

### Leg 1 — f8-debt-and-move-core-fix
**Status**: ready → (design review) → in-flight
**Risk tier**: **HIGH** — state-machine/lifecycle edit on the multi-window active-tab path that
reverses an F8 compensation (the pre-set + hand-compensation). Per `/agentic-workflow` 2a, gets a
per-leg design review before implementation. Bundles the code-shaped F8 debts (move-core fix,
`shouldArm` extraction + first unit test, `CALL_RE` comment, F8 leg-tick reconciliation).

**Design review (Developer, approve with changes) — move-core fix decided:**
- **Fix 2, WITHOUT the caption override.** The decisive finding: `enumerateTabs` reads
  `entry.active`, not `activeTabWcId`. Fix 2 keeps the synchronous hide + `closeMenuOverlay`, so the
  interim has exactly one active/visible guest; **Fix 1 (delete the hand-compensation) would
  transiently reintroduce F8 HIGH-1's double-active and FLAKE leg 4's own row 8a.** So Fix 2 is
  strictly lower-risk. The `activeTabWcId` lag after removing the pre-set is equal under both fixes,
  self-heals on the round-trip broadcast (`main.js:3125`), and does not discriminate.
- **Caption override dropped as gold-plating** — it would drag the unbudgeted, out-of-scope
  `move-targets.js` in; the transient stale caption is doctrine-sanctioned cosmetic ("can never
  mis-target") and self-heals. Change stays **main.js-only**, ≈ −1 code line.
- **No extraction warranted** — the caption computation is already a pure module (`move-targets.js`);
  the core's active-state transition is intertwined with Electron view ops and doesn't factor
  cleanly. The AC1 masked-grep is the proportionate pin; runtime proof is leg 4's (honest).
- Folded in: AC1 pins Fix-2-no-override; **AC1b** added (rewrite the now-false hand-comp comment);
  AC2 re-anchored to "pre-set gone AND synchronous hide+menu-close remain"; AC3 notes the two
  `DRAG_ARM_THRESHOLD_PX` comment refs; **AC6 reframed as a confirmation pass that may produce zero
  edits** (leg-3 already fully reconciled). Confirmations passed: AC4 case values, AC5 count=10
  (the F8 log already records "naive grep → 10"), require-of-ESM, line budgets, clean dependencies.

**Implementation (Developer) — COMPLETE. `[HANDOFF:review-needed]`.**

Changes made:
- **AC1/AC1b/AC2 (move-core fix, `src/main/main.js` `moveTabIntoWindow`):** removed the single
  pre-set line `target.activeTabWcId = p.wcId;`. KEPT the synchronous displaced-guest hide
  (`prevActive.view.setVisible(false)` + `prevActive.active = false`) and
  `target.sheet?.closeMenuOverlay('tab-switch')`. Did **not** touch `broadcastMoveTargetsChanged`
  or `move-targets.js` (transient stale caption is doctrine-sanctioned cosmetic, self-heals on the
  round-trip caption broadcast). Rewrote the now-false hand-compensation comment block: old reason
  ("the round-trip CANNOT do the hide/close because the pre-set disarms the guard") replaced by the
  true one — the round-trip is **async**, so the core hides + closes **synchronously** to hold the
  interim to one active/one visible guest; the round-trip's **now-armed** guard
  (`owner.activeTabWcId !== null && owner.activeTabWcId !== wcId`, true because `activeTabWcId` still
  holds the OLD active until the round-trip sets it) re-does both idempotently.
- **AC3 (`shouldArm` extraction):** added `export const DRAG_ARM_THRESHOLD_PX = 5;` and
  `export function shouldArm(dx, dy)` (`Math.hypot(dx, dy) >= DRAG_ARM_THRESHOLD_PX`) to
  `src/shared/tab-drag-zone.js` (single source of truth). `src/renderer/renderer.js`: imported
  `shouldArm` alongside `classifyDragPoint`; deleted the local `const DRAG_ARM_THRESHOLD_PX = 5;`;
  replaced the `Math.hypot(...)  < ...` guard with `if (!shouldArm(dx, dy)) return;`.
  **AC3-comment choice:** the two renderer comments that name `DRAG_ARM_THRESHOLD_PX` (`~:1257`,
  `~:1414`) were **UPDATED to point at the module** ("tab-drag-zone.js's DRAG_ARM_THRESHOLD_PX via
  shouldArm") rather than left — so no comment names a constant no longer defined in that file, and
  the mutation-grep author is not surprised by a dangling reference.
- **AC4 (`shouldArm` unit test, `test/unit/tab-drag-zone.test.js`):** added 5 tests covering all 6
  cases — `(0,6)→true`, `(0,4)→false`, `(6,0)→true`/`(4,0)→false` (one test, two asserts), `(0,5)→true`
  (boundary `>=`), `(3,4)→true` (hypot=5). House style (`require`, `node:test`, `node:assert/strict`).
- **AC5 (`CALL_RE` comment, `test/unit/tab-drag-invariants.test.js`):** "reads NINE" → "reads TEN",
  "one prose mention" → "two prose mentions". Comment only; the `CALL_RE` regex and the `7` assertion
  are untouched.

Both-readings per state-asserting AC (each `grep -c` run STANDALONE; masked scans via the new
`test/unit/move-core-fix.test.js` and the existing helpers):
- **AC1 — pre-set gone (masked, over `moveTabIntoWindow`):** real → **0**, mutate the pre-set back →
  **1**. Pinned by `move-core-fix.test.js` ("AC1: … real → 0" and "mutating the pre-set back …
  mutated → 1"). *(Standalone unmasked `grep -c "target.activeTabWcId = p.wcId" src/main/main.js` →
  **1**, because the rewritten comment now names the removed pre-set in prose — this is the exact
  comment over-read the masked scan exists to defeat; the load-bearing-mask control test asserts the
  unmasked body reads NON-zero while the masked body reads 0.)*
- **AC2 — synchronous hide + menu-close remain (masked, over `moveTabIntoWindow`):**
  `setVisible(false)` present real → **present**, mutate away → **gone**; `closeMenuOverlay('tab-switch')`
  present real → **present**, mutate away → **gone**. Both pinned in `move-core-fix.test.js`.
  **AC2's RUNTIME reading is LEG 4's** (`tab-tearoff` row 8a — the `{T1:true, T2:false}` pair from one
  `enumerateTabs` — plus the displaced-menu residual). This repo has **no main-process harness**;
  `main.js` is never executed by any test, so **no runtime verification is claimed here** — only the
  code shape.
- **AC3 — `Math.hypot` in `src/renderer/renderer.js`:** real → **0** (moved into the module), and
  `grep -c "export function shouldArm" src/shared/tab-drag-zone.js` → **1**. `DRAG_ARM_THRESHOLD_PX`
  in `src/renderer/renderer.js` → **2** (both now comment references, pointing at the module).
- **AC5 — `grep -c "cancelDrag()" src/renderer/renderer.js`:** → **10** (verified before editing the
  comment; 7 calls + `function cancelDrag() {` + 2 prose mentions).

**AC6 (F8 leg reconciliation) — ZERO EDITS, confirmed.** Read
`missions/…/08-tearoff-cross-window-drag/legs/03-tearoff-by-drag.md` and the F8 flight log. Every
unticked runtime AC in leg 3 either states "genuinely owed, no DOM harness" (AC4, AC5 rect reading —
no "pass" is claimed) or carries a leg-5 pointer that RESOLVES: AC6 → `tab-tearoff` rows 4 & 8
(both assert the announcement sequence and the absence of `'Move canceled'`); AC10 → rows 6 & 7
(sole-tab and internal-tab refusal announcements at origin index); AC11 → row 5, which literally reads
"This row discharges leg 3's AC11", corroborated by `multi-window-shell`; AC13 → leg 5 ran a11y on the
live rig (exit-code defect is a mission Known Issue). **No case has the log saying "pass" while the
file lacks a pointer.** The F8 flight log corroborates (its Leg-3 section and FD rulings record these
as runtime readings leg 3 could not take and deliberately left unticked). No F8 log bodies rewritten;
no ticks fabricated.

Line budgets (DD11, CODE lines, comments excluded):
- `src/main/main.js`: **net −1** code line (only the pre-set removed; everything else is comment
  rewrite). ≤ +15. ✅
- `src/shared/tab-drag-zone.js`: **+4** code lines (`export const` + the 3-line `shouldArm`); the rest
  of the +26 insertions are JSDoc. ≤ +8. ✅
- `src/renderer/renderer.js`: **net −1** (const deleted; import + guard swaps are 0-net). ✅

Gates (each run STANDALONE, 300s timeout on the test run — no hang):
- `npm test` → **1902 pass / 0 fail / 0 skipped**, 13 suites. Baseline was **1892** → **delta +10**
  (5 `shouldArm` tests + 5 `move-core-fix` source-scan tests).
- `npm run lint` → clean (exit 0).
- `npm run typecheck` → clean (exit 0).
- `npm run a11y` **NOT run** (no chrome-DOM change here; leg 4 runs it once on the final tree).

Files changed: `src/main/main.js`, `src/shared/tab-drag-zone.js`, `src/renderer/renderer.js`,
`test/unit/tab-drag-zone.test.js`, `test/unit/tab-drag-invariants.test.js`, new
`test/unit/move-core-fix.test.js`, plus this leg's artifacts (leg status, flight.md checkbox, this log).
Not committed (flight-end single commit per `/agentic-workflow`).

**Leg 1 landed at suite 1902 (+10 from 1892), lint/typecheck clean, budgets held.**

---

### Leg 2 — session-persistence-layer
**Status**: ready → (design review) → in-flight → completed
**Risk tier**: **HIGH** — privacy-sensitive; the mission's absolute burner constraint gets its first
pin against a **disk** artifact here. Pure modules + tests only, no `main.js` wiring (leg 3). Per
`/agentic-workflow` 2a, per-leg design review.

**Design review (Developer, approve with changes):**
- **FACTOR the burner predicate** (the one call reaching outside leg 2's file set — accepted).
  New neutral `src/main/persist-jar-gate.js` `resolvePersistJar(tabEntry, jarsList)` → jar-or-null,
  used by **both** `session-snapshot.js` and `closed-tab-capture.js` (which changes one inlined line
  to a call; its existing tests re-run green and catch any drift). Rationale: it is incoherent to
  spend leg 1 killing a latent-defect generator while spawning a duplicated *security* predicate two
  suites can't keep in sync; the mission's burner boundary is structural, so it deserves **one**
  definition. → AC0 added.
- **`read()` → null extended to zero-window snapshots** (missing/corrupt/bad-shape/zero-window), so
  leg 3's single `if (restoreOn && snapshot)` gate is provably sufficient and can never boot zero
  windows. → AC1.
- **Load-time member validator** required (untrusted bytes enter on load; `url` feeds `createTab`).
  One `validateSnapshot` reused on load (load-bearing) + write (belt-and-suspenders); object-shape
  (settings-store) + per-member drop (downloads-store mechanism), **not** settings' DEFAULTS/merge.
  → AC1/AC2 (added a malformed-member test).
- **`active: wcId === activeTabWcId` confirmed authoritative** by codebase trace — `entry.active` is
  write-only in main; every authority read uses `activeTabWcId`. → AC3.
- **AC4 additions:** destroyed-wc skip, empty `jarsList` → all dropped (purest positive-allowlist
  pin), active-tab-is-a-filtered-burner → none active, multi-window drop, `version:1` + `jarId===jar.id`.
- Confirmed sound: API faithful to exemplars, zero file overlap with leg 1, budgets generous.

**Implementation (Developer) — COMPLETE. `[HANDOFF:review-needed]`.**

Changes made (three new modules + three new test files, one modified — zero overlap with leg 1):
- **AC0 — `src/main/persist-jar-gate.js` (new).** `resolvePersistJar(tabEntry, jarsList)` →
  jar-or-null, body exactly `!tabEntry.trusted && jarsList.find(j => j.partition ===
  tabEntry.partition) || null` (`&&` binds before `||`: trusted → `false || null` → null;
  no match → `undefined || null` → null; match → jar). Electron-free, `// @ts-check`,
  `'use strict'`. `src/main/closed-tab-capture.js` now CALLS it (one inlined predicate line →
  one call, plus the import + a pointer comment) — **behavior-preserving**: its own destroyed-wc
  guard and emission are untouched, and its existing 14-test suite re-ran **green unchanged**.
  New `test/unit/persist-jar-gate.test.js` pins the gate both directions (4 tests): registered
  non-trusted → jar; `burner:1` → null; `trusted:true` on a registered partition → null; empty
  jarsList → null.
- **AC1/AC2 — `src/main/session-store.js` (new).** Object-schema snapshot
  `{ version:1, windows:[{ tabs:[{ url, jarId, active }] }] }` in `session.json` in the injected
  dir; clones downloads-store's durability (atomic temp+rename, never-throws load, `{serialize,
  deserialize}` codec seam). API `load(userDataPath, opts?)` / `read()` / `write(snapshot)` /
  `clear()`. **One `validateSnapshot(x)` reused on load (load-bearing) AND write:** top-level
  non-array object with a `windows` array else null; per tab `url`+`jarId` non-empty strings else
  drop, `active` coerced `!!`; per window `tabs` array else drop, zero-surviving-tab window
  dropped; **`read()` → null when no usable session (missing / corrupt / bad-shape / zero
  surviving windows).** Did NOT clone settings-store's DEFAULTS/VALIDATORS merge (session has no
  fixed keys). `test/unit/session-store.test.js` (12 tests, tmp dir + `delete require.cache`
  cache-bust): round-trip; corrupt→no-throw+null; missing→null; bad top-shape (array / non-object)
  →null; zero-window on disk→null; all-windows-drop→null; malformed members (non-string url,
  `tabs:{}`, zero-tab window) dropped while valid siblings kept both directions; codec seam
  honored (on-disk bytes carry the custom prefix); atomic (no `.tmp` after write); clear() removes.
- **AC3/AC4 — `src/main/session-snapshot.js` (new).** `buildSessionSnapshot({ windows, jarsList })`
  → `{ version:1, windows:[...] }`; per window iterate `tabViews`, keep a tab iff
  `resolvePersistJar(entry, jarsList)` (AC0) returns a jar, skip destroyed wc (`!wc ||
  wc.isDestroyed()`), emit `{ url: wc.getURL(), jarId: jar.id, active: wcId === activeTabWcId }` —
  **active from `activeTabWcId`, NOT `entry.active`**; drop a zero-surviving-tab window.
  `test/unit/session-snapshot.test.js` (11 tests) covers the full AC4 matrix: persist+burner→1;
  flip burner→persist→2; flip persist→trusted→dropped; destroyed-wc skipped + only-destroyed
  window dropped; empty jarsList→`{version:1,windows:[]}`; `activeTabWcId===null`→none active;
  active-tab-is-a-filtered-burner→none active; active survivor→marked active; two-window
  (all-burner dropped, persist kept)→exactly one; `version:1` + `jarId===jar.id` (not the
  partition string).

Both-readings per state-asserting AC (each `grep -c` run STANDALONE, masked via
`test/helpers/source-scan.js`'s `maskComments`):
- **AC0 gate** — pinned by `persist-jar-gate.test.js` both directions (jar ↔ null), and by
  `closed-tab-capture.test.js` re-running green unchanged (catches any refactor drift).
- **AC1 — `require('electron')` absent from `src/main/session-store.js`:** masked real → **0**,
  masked mutate (inject `const { app } = require('electron');`) → **1**.
- **AC3 — `require('electron')` absent from `src/main/session-snapshot.js`:** masked real → **0**,
  masked mutate → **1**. (`persist-jar-gate.js` also: masked real → **0**, mutate → **1**.)
- The disk round-trip / burner-drop-both-directions readings are the passing unit assertions in
  the two new suites (0-record vs 1-record on the real `resolvePersistJar`, mutated via fake
  partitions in memory).

Line budgets (DD11, CODE lines, comments masked):
- `persist-jar-gate.js`: **5** ≤ 15 ✅  `session-store.js`: **67** ≤ 120 ✅
  `session-snapshot.js`: **18** ≤ 45 ✅  `closed-tab-capture.js`: **net +1 code** (the shared-gate
  import; predicate swap is 0-net) ≈ 0 ✅

Gates (each run STANDALONE; test run timed out at 300s — no hang):
- `npm test` → **1929 pass / 0 fail / 0 skipped**, 13 suites. Baseline after leg 1 was **1902** →
  **delta +27**, exactly the three new suites (4 persist-jar-gate + 12 session-store + 11
  session-snapshot). The new suites use flat `test()` calls (no `describe`), so the node
  suite-count metric stays 13.
- `npm run lint` → clean (exit 0). `npm run typecheck` → clean (exit 0).
- `npm run a11y` **NOT run** (no chrome-DOM change; pure main-process modules).

No `main.js` wiring (leg 3). `git status --porcelain` adds only the six intended new files
(`persist-jar-gate.js`, `session-store.js`, `session-snapshot.js` + their three tests) + modified
`closed-tab-capture.js` + this leg's artifacts. Not committed (flight-end single commit per
`/agentic-workflow`).

**Leg 2 landed at suite 1929 (+27 from 1902), lint/typecheck clean, budgets held, burner
invariant pinned against the disk artifact both directions.**

---

### Leg 3 — settings-toggle-and-lifecycle
**Status**: ready → (design review) → in-flight
**Risk tier**: **HIGH** — startup/lifecycle; the default-off byte-identity constraint is absolute.
Depends on legs 1 (move-core, landed) + 2 (session-store/session-snapshot/persist-jar-gate, landed).
Per `/agentic-workflow` 2a, per-leg design review.

**Design review (Developer, approve with changes):**
- **Two-writer coordination CONFIRMED correct on every real quit path.** Walked menu-Exit-2-window
  (`before-quit` writes `{A,B}`, closes suppressed), close-last-window (`close` writes `{thisWindow}`,
  empty `before-quit` skipped by the non-empty guard), close-2-one-by-one (`{B}`), macOS no-quit, and
  SIGKILL. **No `win.destroy()` exists in `main.js`** (all `.destroy()` are on `webContents`), so every
  window routes through `close` — no silent-skip path.
- **jarId→container RESOLVED** — the `openTab` precedent `containers.find(c => c.id === jarId) || null`
  over the live `containers` snapshot (from the awaited `jarsBoot`). `inheritContainerFromPartition` is
  the **wrong** tool (partition-typed + default-jar fallback → home-substitutes a deleted jar, DD4
  violation) — forbidden on the restore path. → AC5 locked; **AC5b added** (extract a pure
  `resolveRestoreContainer` + both-directions unit pin on the deleted-jar-drop, mirroring leg 2's
  `resolvePersistJar` factoring).
- **[medium] AC6 reworded** — `load()` must run **unconditionally** (a mid-session enable must be able
  to `write()` at quit; `write()` throws without a `load()`-set `dir`; an uncaught throw in `before-quit`
  wedges quit). So off-startup is **behaviorally** byte-identical (same window/boot tab, no read, no
  write), not literally "zero I/O." The masked-scan guards `read()` + both `write()`s, **not** `load()`.
- **[medium] Both write sites wrapped in `try/catch`** (not just `close`) — an uncaught `before-quit`
  throw is the F6 window-close-hang class. → AC3.
- **createWindow already returns the record** (`return record`), so the rebuild stashes `rec.restoreTabs`
  directly — no `registry.get`. → AC4 sharpened.
- Confirmed sound: settings toggle template (`automationEnabled` strict-boolean + spellcheck IIFE),
  minimal byte-identical-off insertion, budgets generous, honest source-scan-vs-leg-4-runtime split.

**Implementation (Developer) — COMPLETE. `[HANDOFF:review-needed]`.**

Changes made:
- **AC1 — the "Restore session on startup" setting (DD7), `src/main/settings-store.js`.** Added
  `restoreSession: false` to `DEFAULTS` (+ the `Settings` typedef member) and
  `restoreSession: (v) => typeof v === 'boolean'` to `VALIDATORS` — the `automationEnabled`
  strict-boolean template, NOT spellcheck's typeof-fallback. `src/renderer/pages/settings.html`:
  a labeled checkbox row cloned from the spellcheck `<fieldset class="shields-group">`/
  `<label class="shield-row"><span>…</span><input type="checkbox" id="restore-session-enabled"></label>`
  + a `<p class="muted">` help note, placed in the "On startup" section. `src/renderer/pages/settings.js`:
  a cloned spellcheck IIFE (`settingsGet` populate, `change`→`settingsSet`, `onSettingsChanged`
  two-way sync, `pagehide` cleanup) via `window.goldfinchInternal.*`. No live side-effect (startup-only).
- **AC2 — `sessionStore.load()` wired UNCONDITIONALLY in `whenReady`**, a sibling right after
  `historyStore.open(app.getPath('userData'))`, NOT gated on the setting (a mid-session enable must
  have `dir` set to `write()` at quit; an uncaught `before-quit` throw is the F6 hang class). Did NOT
  widen `initProfileAndStores`'s signature.
- **AC3 — two-writer snapshot WRITE, coordinated, setting-gated, BOTH try/caught.** Module-scoped
  `let sessionQuitting = false;`. `before-quit`: `sessionQuitting = true`, then a try/catch write of
  `buildSessionSnapshot({ windows: registry.records(), jarsList: jars.list() })` iff
  `settings.get('restoreSession') === true && registry.records().length`, placed before
  `downloadsManager?.flushInterrupted()` / `mcpServer?.stop()`. Per-window `close` handler: a sibling
  to the `captureWindowCloseEntries` block (after `if (!rec) return;`, BEFORE the destroy loop), a
  try/catch write iff `settings.get('restoreSession') === true && !sessionQuitting`. Both log-and-continue.
- **AC4 — restore READ + rebuild at `whenReady`, tabs created FRESH.** Replaced the single
  `createWindow();` with `const restoreSnap = settings.get('restoreSession') === true ? sessionStore.read() : null;`
  then per saved window `const rec = createWindow({ noBootTab: true }); rec.restoreTabs = w.tabs;`, else
  the unchanged single `createWindow()`. Extended `window-boot-config` to
  `return rec.restoreTabs ? { bootTab: false, restoreTabs: rec.restoreTabs } : { bootTab: !rec.noBootTab };`.
  No adopt path.
- **AC5 / AC5b — renderer fresh-create + deleted-jar drop.** New pure `src/shared/restore-container.js`
  `export function resolveRestoreContainer(jarId, containers)` → `containers.find(c => c.id === jarId) || null`.
  `src/renderer/renderer.js` boot `Promise.all`: on a non-empty `bootConfig.restoreTabs`, per `{url, jarId, active}`
  → resolve container, `continue` (DROP) on null (never home-substitute; no `inheritContainerFromPartition`),
  `createTab(url, container, { trusted: false })` (no `restoreHistory`, no `insertAt`), track the active
  tab, `activateTab(activeTab.id)` after the loop.
- **AC6 — default-off byte-identity.** All three behavioral touch points (whenReady `read()`,
  before-quit `write()`, close `write()`) gated on `settings.get('restoreSession') === true`; `load()`
  NOT gated. Off ⇒ the unchanged single `createWindow()` and no write.
- **Two type-only touches beyond the leg's named files (required for `tsc` green, no runtime code):**
  `src/main/window-registry.js` `WindowRecord` typedef gained an optional `restoreTabs?` member (JSDoc
  comment); `src/renderer/renderer-globals.d.ts` `windowBootConfig()` return type gained the optional
  `restoreTabs?` field and the boot-loop `.catch` fallback was annotated so the union collapses.

Both-readings per state-asserting AC (DD10). AC1 is UNIT-TESTABLE (settings-store is Electron-free);
AC2/AC3/AC4/AC5/AC6 wiring in `main.js`/`renderer.js` is pinned as **CODE SHAPE** via masked
source-scans (`test/unit/session-restore-wiring.test.js`) — this repo has **no main-process harness and
no DOM harness**, so `main.js`/`renderer.js` are never executed by any unit test. The RUNTIME readings
(terminal-snapshot correctness on both quit paths incl. the 2-window menu-Exit case, fresh-create at
saved addresses+jars, active-tab restore, deleted-jar drop, off ⇒ no file written / same single window)
are **LEG 4's** `session-restore` behavior spec:
- **AC1 (unit, real store):** `restoreSession` default `false`; `set(key, true)` persists `true` (reload
  round-trip); `set(key, 'yes')` **throws** `TypeError` and leaves the value `false` (validate-before-mutate).
  Both directions in `test/unit/settings-store.test.js`.
- **AC5b (unit, real helper, both directions):** known jarId → the matching container; unknown jarId →
  **`null`, NOT a default**; empty containers → `null`. `test/unit/restore-container.test.js`.
- **AC2 (masked code-shape):** whenReady body — `sessionStore.load(` present (real → 1; deleted → 0) and
  NOT settings-gated (real → its preceding window has no `restoreSession`; wrapping it in a guard → gated,
  pin fails).
- **AC3 (masked code-shape):** before-quit write settings-gated (real → gated; guard-expr removed →
  ungated); close write settings-gated (same, other guard-expr); and within the close handler the
  `sessionStore.write` index **precedes** the `webContents.destroy` index (real → holds; relocating the
  write after the destroy loop → fails).
- **AC4 (masked code-shape):** whenReady `read()` settings-gated (real → gated; ternary flattened to
  bare `read()` → ungated); `window-boot-config` returns `restoreTabs` (real → present; return stripped →
  absent); the whenReady rebuild branch uses no `addChildView`/`removeChildView` (real → absent; injected →
  present).
- **AC5 (masked code-shape):** the renderer restore branch calls `resolveRestoreContainer` + `createTab`
  and `continue`s on a null container (real → present; drop removed → `continue` gone), and references
  **no** `restoreHistory`, **no** `inheritContainerFromPartition`, **no** adopt (real → absent; injecting
  `inheritContainerFromPartition` → present).
- **AC6 (masked code-shape):** exactly **three** `settings.get('restoreSession')` guards in `main.js`
  (read + two writes) — remove any one → two; and the guard is on read()/write()/write() but NOT load().

Masking honesty: the source-scan mask is applied and correct for `main.js` (its documented
regex-literal blind-spot pattern reads 0). `renderer.js` **trips** that blind spot before the boot loop,
so masking is unreliable there — the renderer scans deliberately extract a **pure-code** branch body (the
descriptive comment naming `restoreHistory`/`inheritContainerFromPartition` is kept OUTSIDE the branch
braces), so `findMatchingBracket` balances and the exclude-scans are robust regardless of the upstream
mask state. A dedicated test pins that the branch body carries no comment text and no quote chars, and
that the naming comment really sits just above the branch. So the wiring scans do NOT lean on a
load-bearing renderer mask — the discrimination is the code-injecting/removing mutation flipping each
reading.

Line budgets (DD11, CODE lines, comments/blank excluded):
- `src/main/main.js`: **+29** ≤ +45 ✅  `src/renderer/renderer.js`: **+16** ≤ +25 ✅
  `src/main/settings-store.js`: **+3** ≤ +6 ✅  `src/renderer/pages/settings.js`: **+13** ≤ +20 ✅
  `src/shared/restore-container.js`: **3** ≤ 5 ✅  (window-registry.js / renderer-globals.d.ts:
  comment/type-only, 0 runtime code.)

Gates (each run STANDALONE; test run timed out at 300s — no hang):
- `npm test` → **1948 pass / 0 fail / 0 skipped**, 13 suites. Baseline after leg 2 was **1929** →
  **delta +19** (3 restoreSession settings-store + 3 restore-container + 13 session-restore-wiring).
- `npm run lint` → clean (exit 0). `npm run typecheck` → clean (exit 0).
- `npm run a11y` **NOT run** (leg 4 runs it once on the final tree; the settings row is a labeled checkbox).

`git status --porcelain` adds only the intended new files (`restore-container.js`,
`restore-container.test.js`, `session-restore-wiring.test.js`) + modified `main.js`, `settings-store.js`,
`settings.html`, `settings.js`, `settings-store.test.js`, `window-registry.js`, `renderer-globals.d.ts`,
`renderer.js` + this leg's artifacts. No `session.json` (it is userData — never in the repo). Not
committed (flight-end single commit per `/agentic-workflow`).

**Leg 3 landed at suite 1948 (+19 from 1929), lint/typecheck clean, budgets held, default-off
byte-identity pinned by the three code-shape guards + `load()`-ungated scan; runtime proof is leg 4's.**

---

### Leg 4 — verification (FD-run; HAT/verification leg, no autonomous Developer)
**Status**: completed
**Risk tier**: **HIGH** — authors the flight's assertions (F8 DD14 / F7 leg-4 lesson). Run by the
Flight Director directly (a HAT/verification leg is not spawned to an autonomous Developer).

**DD9 relaunch-harness probe → NO-GO (recorded with evidence).** The authoring session has **no
goldfinch automation MCP** (ToolSearch: no `enumerateWindows`/`enumerateTabs` tools), **no admin key**
(`GOLDFINCH_MCP_ADMIN_KEY` unset), and **no running dev instance** (no electron/goldfinch process). The
Executor would signal `[BLOCKED:no-apparatus]`; the relaunch cycle cannot be exercised. Per DD9 this is
a real, honest outcome — **the structural proof carries (legs 1–3), the live E2E cycle is HAT-scoped to
F10**, never a green spec over an unproven cycle (F8/F5's lesson). The same gap blocks the existing
behavior tests (`tab-tearoff` row 8a) and the real a11y verdict, which all need the same rig.

**Deliverables (measured THIS session):**
- **AC1 — `session-restore` behavior spec authored** (`tests/behavior/session-restore.md`, `draft`).
  Asserts the RIGHT observable (F8 product #2): the **exact** restored tab set with correct jarIds and
  the **burner POSITIVELY ABSENT** (count exactly 2, no burner jarId), the saved active tab active; a
  **2-window menu-Exit** guard that fails if only one window returns (the DD3 two-writer bug); a
  **default-off** row (nothing restored); a **deleted-jar-drop** variant. Documents the out-of-band
  relaunch harness (in-band `windowClose` quit + Bash relaunch + admin-MCP reconnect; no SIGKILL) and
  scopes history+geometry OUT (DD5). **Run is HAT-scoped (F10).**
- **AC3 — `tab-reorder` Step 4 RETIRED to HAT.** It read `screenX === 564` (the cached fiction F8
  refuted) — a guaranteed false green; re-instrumenting needs a second instrument (Win32/RAIL),
  operator-tier. The header + the Step 4 row now record the retirement and that the **arm-threshold**
  half of its debt is **discharged** by leg 1's `shouldArm` unit pin (both directions, incl. `dx=0`).
- **AC4 — HIGH-1 net (`tab-tearoff` row 8a + residual) dispositioned.** Cannot run without the rig;
  the move-core fix now carries a **unit-layer** structural pin (`move-core-fix.test.js`, leg 1); row
  8a's live reading is **carried to F10** (booked to the clean re-run `tab-tearoff` already owes). Not
  claimed as run.
- **AC5 — final-tree gates (MEASURED):** `npm test` **1948 pass / 0 fail / 0 skipped**; `npm run lint`
  clean; `npm run typecheck` clean. **`npm run a11y`: NOT a verdict** — it printed *"no automation key …
  this gate needs the live GUI"* and audited nothing. **NOT claimed green** (F8 Rec 1 — the commit
  message may claim only what was measured; the real a11y run is F10's). The `settings.html` change is a
  **labeled** checkbox (structurally a11y-safe).

**Carried to F10 (the operator's HAT):** run `session-restore` live; run `tab-tearoff` row 8a + the
displaced-menu residual (+ the clean re-run it owes); the real `npm run a11y` verdict; `tab-reorder`
Step 4's no-window-move check against a second instrument.

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
