# Leg: import-ui-and-vault-page-decomposition

**Status**: completed
**Flight**: [Chrome Password Import](../flight.md)

## Objective

Wire Leg 1's pipeline into an operator-driven import on `goldfinch://vault`
— native file pick → held payload → destination + Replace/Merge choice →
native confirm → commit → per-entry outcome report with "delete your export
file" guidance — through an Electron-free main-side flow module and a new
page-side controller, landing squawk 0063 and keeping `vault.js` under its
pinned budget, with the docs telling the new truth.

## Context

- **Charter DDs** (flight.md): DD5 (vault-page modals + main-side native
  dialog; the admin-tier boundary is initiation + payload-never-leaves-main,
  NOT the internal-session guard), DD6's wiring half (drop on lock /
  window-close / pagehide; zeroize after `take`), DD9 (Replace/Merge choice
  surface), DD10 (decompose before adding; squawk 0063), DD11 (report
  rendering), DD13 (native `showMessageBox` confirm awaited BEFORE `take`,
  with fresh main-side counts). Read them in full first.
- **Leg 1 is a settled upstream fact** (`legs/01-ingest-and-commit-core.md`,
  landed; flight log 2026-09-09): `src/main/vault/csv-parse.js`
  (`parseCsv`), `src/main/vault/browser-import.js` (`detectChromeExport`,
  `adaptChromeRows`, `planLogins`, `summarizeOutcomes`,
  `BrowserImportFormatError`, `MAX_PAYLOAD_BYTES`, `MAX_IMPORT_ITEMS`),
  `src/main/vault/pending-browser-imports.js`
  (`createPendingBrowserImportStore` → `{ hold, peekSummary, take, clear,
  chromeIds, dropAll }`, `HOLD_DROP_MS`; `take(chromeId, handle)` is
  handle-guarded and does NOT zeroize — this leg's commit owns
  `payload.fill(0)`), and `VaultStore#importLogins(target, candidates,
  { mode })` → `{ results, written }` (synchronous, gated, throws
  `VaultLockedError` / `VaultStateError` / `VaultBusyError`).
- **This is the LAST autonomous leg** — the flight-end Reviewer and the
  single commit follow it (Leg 3 is an operator HAT).
- Prior-flight learnings applied: the M18 F3 debrief's "pin cross-webContents
  seams" (the page↔main round-trip gets a unit-level integration test over
  the real IPC registration + flow module, no live app); the `name==slug`
  fixture convention; `vault.js` accretes — build the new UI OUTSIDE it.
- **All citations verified 2026-09-09 on branch
  `flight/01-chrome-password-import` at the post-Leg-1 working tree**
  (uncommitted; Leg 1 files present).

## Leg-Level Design Rulings

The flight DDs leave these open; recorded here so the design review can
strike at them.

1. **Main-side flow lives in a NEW Electron-free module,
   `src/main/vault/browser-import-flow.js`**, not in `main.js`
   (`main.js` is the untested composition root; the M18 restore delegates
   there are the shape to *mirror*, not the place to add). `createBrowserImportFlow(deps)`
   with injected `{ getStore, pending, dialog, fs, windowForChrome,
   listJars, now? }` returns `{ begin, summary, cancel, commit }`:
   - `begin(chromeId)` → `dialog.showOpenDialog({ title: 'Import passwords
     from a browser export', properties: ['openFile'], filters: [{ name:
     'CSV password export', extensions: ['csv'] }, { name: 'All files',
     extensions: ['*'] }] })` → `{ canceled: true }` on cancel; `stat` cap
     at `MAX_PAYLOAD_BYTES` → `{ error: 'too-large' }`; `fs.readFileSync`
     as a **Buffer** (never `'utf8'` — DD6, `main.js:1113` is the
     anti-pattern); parse + adapt ONCE (`parseCsv(payload.toString('utf8'))`
     → `detectChromeExport` → `adaptChromeRows`) to build the NON-SECRET
     `summary = { candidateCount, skipped }`, catching
     `BrowserImportFormatError` → `{ error: e.reason }` — the landed class
     (`browser-import.js:46-54`) exposes `reason`, NOT `code` (design
     review, high) — (`'unrecognized-format'` / `'too-many-rows'`) and any
     other throw →
     `{ error: 'unreadable' }`; then `pending.hold(chromeId, { payload,
     summary })` and return `{ ok: true, path, handle, summary }`. The
     parsed candidate strings are dropped on return (DD6 best-effort).
     `chromeId` not a number → `{ error: 'no-window' }`.
   - `summary(chromeId)` → `pending.peekSummary(chromeId)` verbatim
     (`{ handle, summary } | null`) — the page's only read.
   - `cancel(chromeId, handle)` → `pending.clear(chromeId, handle)`.
   - `commit(chromeId, { handle, target, mode })` — the DD13 order, pinned:
     1. validate shape (`handle` string, `target` string, `mode` ∈
        `'merge'|'replace'`) else `{ ok: false, reason: 'state' }`;
     2. `pending.peekSummary(chromeId)` must exist with a matching handle,
        else `{ ok: false, reason: 'state' }` — never consume a mismatched
        record;
     3. store pre-checks: `!store.isUnlocked()` → `{ ok: false, reason:
        'locked' }` (`VaultLockedError` is NOT in the error mapper's
        `CLASS_CHECK_ORDER`, `vault-sheet-errors.js:44-51`, and this leg
        does not widen that ladder); `store.resolveTarget(target)` inside
        the mapper (`VaultStateError` → `'state'`);
     4. **fresh count**: `existingCount = store.listItems(target).length`
        read HERE, immediately before the confirm renders (DD13 freshness
        contract — source of truth is the on-disk vault, rebuilt every
        confirm, zero staleness);
     5. `await dialog.showMessageBox(windowForChrome(chromeId) ?? undefined,
        { type: 'question', buttons: ['Import', 'Cancel'], defaultId: 0,
        cancelId: 1, noLink: true, title: 'Import passwords', message:
        `Import ${candidateCount} login(s) into ${destLabel}?`, detail })`
        where `destLabel` is `'Global'` or the jar's name via `listJars()`
        (id fallback), and `detail` is, for `replace`, "This will first
        delete the N item(s) already in <dest>." (N = `existingCount`,
        never understated), for `merge`, "N item(s) already there are
        kept; logins already present are skipped." — plus the export-file
        reminder line. `response !== 0` → `{ ok: false, reason:
        'declined' }` and the record STAYS held (the operator may change
        destination and retry; the DD6 timer still bounds it);
     6. **re-peek after the await**: the record may have been dropped by
        lock / window-close / expiry while the dialog was open — a missing
        or handle-mismatched record → `{ ok: false, reason: 'state' }`
        (DD13's "await the confirm while the record is still HELD");
     7. `rec = pending.take(chromeId, handle)`; then inside
        `try { … } finally { rec.payload.fill(0) }`: re-parse + adapt the
        Buffer, `store.importLogins(target, candidates, { mode })`,
        `counts = summarizeOutcomes(summary.skipped, results)`, return
        `{ ok: true, target, counts }`. **Reply shape = aggregate counts
        only** (DD11 "reports counts by outcome"); the per-row `results`
        array stays INTERNAL to the flow (it feeds `summarizeOutcomes`) and
        is never serialized into the reply, so no field value and no row
        content can cross to the page (the flight's Leg-2 acceptance
        note). **Error-mapping scope**: ONE `try/catch` spans steps 3–7
        (so `resolveTarget`'s `VaultStateError` at step 3 and
        `importLogins`'s throws at step 7 both route through
        `mapVaultSheetError(e, VAULT_BROWSER_IMPORT_COMMIT_CONFIG)` — a NEW
        named config in `vault-sheet-errors.js`, `{ VaultBusyError: 'busy',
        VaultStateError: 'state' }`, the `VAULT_RESTORE_COMMIT_CONFIG`
        shape; unknown errors propagate), with the zeroize-only
        `try { … } finally { rec.payload.fill(0) }` NESTED inside it from
        the `take` onward. This deliberately differs from
        `vaultImportCommit` (`main.js:1186-1224`), whose `take()` precedes
        its single flat try — here the confirm sits between validation and
        `take`, so the outer scope must already exist.
   - The flow never `require`s Electron; `dialog`/`fs` are injected so the
     unit suite drives it with doubles — this is where the DD13 ordering
     and the lock-during-confirm drop are PROVEN (CP3's "record still held
     → dropped" row), not just asserted by grep. `listJars` is injected as
     its own dep (the same `() => jars.list()` closure `main.js` already
     hands to several deps objects — the house idiom, rather than reaching
     through `getStore().listJars`).
2. **`main.js` wiring is composition only**: one
   `createPendingBrowserImportStore({ mintHandle: () =>
   crypto.randomUUID() })` instance beside `_pendingVaultImports`
   (`main.js:886`); `_pendingBrowserImports.dropAll()` added to the
   `onLock` hook (`main.js:814`, next to the existing `dropAll`);
   `_pendingBrowserImports.clear(chromeId)` added to
   `releaseVaultHoldsForWindow` (`main.js:910-913`, the window-close path
   `window-factory.js:269`); `createBrowserImportFlow({...})` constructed
   lazily beside `getVaultHuman`'s memo idiom and its four methods threaded
   into the `registerBrowserIpc` deps object (`main.js:1760-1767`, the
   `vaultImportBegin`/`vaultImportCommit` precedent — gated: offline tests
   omit them). **`windowForChrome` composition (design review, medium — no
   accessor of that shape exists today):** `(chromeId) =>
   registry.getWindowForChrome(webContents.fromId(chromeId))?.win ?? null`
   — `getWindowForChrome` takes a webContents OBJECT
   (`window-registry.js:168`), and a record's `.win` as a `dialog.*` parent
   is the `register-download-ipc.js:83` precedent (a `BaseWindow` parent is
   accepted; parentless also works, which the fallback relies on).
3. **Four new internal channels in `register-browser-ipc.js`**, registered
   with `registerInternalHandler`, each gated on its injected delegate
   (`:314-333` idiom), each resolving the window via
   `chromeForTab(event.sender.id)?.id`:
   `internal-vault-browser-import-pick` → `begin`;
   `internal-vault-browser-import-summary` → `summary`;
   `internal-vault-browser-import-cancel(handle)` → `cancel`;
   `internal-vault-browser-import-commit({ handle, target, mode })` →
   shape-validated (`{ ok:false, reason:'state' }` on a bad payload, the
   `:326-330` idiom) → `commit`. Preload (`internal-preload.js`, next to
   the restore group `:744-807`): `browserImportPick()`,
   `browserImportSummary()`, `browserImportCancel(handle)`,
   `browserImportCommit({ handle, target, mode })`. No new push event —
   the page drives every step itself (unlike restore's labels-ready, there
   is no sheet in the middle). The internal-preload bundle
   (`internal-preload.bundle.js`) is GENERATED — `npm run build:preload`
   (`scripts/build-preload.mjs`), wired as the `pretest` and `prestart`
   lifecycle hooks — so never hand-edit it; running `npm test` regenerates
   it and the diff appears alongside the source change.
4. **All new page UI lives in a NEW page-side controller,
   `src/renderer/pages/vault-browser-import-controller.js`** (the
   `vault-nav-controller.js` precedent: an ESM module the page imports as
   a flat specifier, routed in `internal-page-map.js`'s vault entry as
   `rendererPage(...)`). `createVaultBrowserImport(deps)` takes the
   page's DOM helpers and state readers injected — `{ bridge, el, button,
   iconButton, openModal, appendOption, getVaults, getJarRows,
   getJarVaultPresence, refresh, setPendingNotice }` — and exposes
   `{ openPickModal, openDestinationModal(record), heldRecord: () => …,
   loadHeld(): Promise<void>, dropHeldOnPagehide() }`. **`vault.js` grows
   by wiring only** (import line, one construction call, one button, one
   `refresh()` line, one `pagehide` line): the restore modals
   (`openImportPickModal :703`, `openMappingModal :938`,
   `openCompletionModal :1220`, `buildColorSwatchGrid :820`) are NOT moved
   — `test/unit/vault-restore-workflow-invariants.test.js` source-scans
   them in `vault.js` by name (`:104`, `:141-297`), and moving HAT-tuned
   code to satisfy a budget is exactly the "open-ended re-architecture"
   the flight's divert criterion forbids. The flight's DD10 "controller
   split" is therefore satisfied by building the NEW surface as its own
   controller from day one, and the pure display logic goes into
   `vault-page-model.js` (ruling 5).
5. **Pure display helpers in `src/shared/vault-page-model.js`**
   (unit-tested in `vault-page-model.test.js`, the
   `restoreOutcomeLines` pattern `:287`):
   - `browserImportDestinationOptions(jars, presenceById, globalPresence)`
     → `[{ vaultId: 'global', label: 'Global — <state>' }, ...jar options]`:
     the jar rows come verbatim from
     `restoreDestinationOptions(jars, presenceById).options`; the Global
     row is special-cased OUTSIDE that function from a third argument
     `globalPresence = { hasVault, count }` (same shape as a presence
     entry), rendered with the same "no secrets yet" / "N secrets" state
     text. The controller builds `globalPresence` from the page's
     `state.vaults` `global` row (`hasVault: true, count` when present,
     else `{ hasVault: false }`) — `vault.js`'s `jarVaultPresence`
     (`refresh():2750-2755`) covers persistent jars only and is NOT widened;
     the controller's `getJarVaultPresence`/`getVaults` deps supply the two
     inputs separately;
   - `browserImportSkipLines(skipped)` → `[{ line, text }]` with a fixed
     label per reason code (`malformed` → "malformed row",
     `field-too-long` → "a field is too long", `malformed-url` → "unusable
     URL", `non-web-origin` → `non-web origin (${scheme}://)`,
     `no-password` → "no stored password", unknown → the raw code) — never
     row content;
   - `browserImportOutcomeLines(counts)` → ordered display strings
     ("N imported", "N already present (skipped)", "N changed — kept as
     copies", "N could not be imported: …", "N failed"), zero-valued lines
     omitted except `imported`, every field coerced (never `NaN`).
6. **Page flow** (all `textContent`, `openModal`'s APG shell):
   - **Affordance**: `buildImportExportSection` (`vault.js:1683`) gains a
     third button "Import from a browser…" rendered ONLY when the profile
     is unlocked (the import needs the MRK; omitted, not disabled — the
     page's existing idiom). The not-set-up surface gets nothing.
   - **Pick modal** (mirrors `openImportPickModal` `:703-772`): a lede with
     the Chrome export guidance — "In Chrome, open the password manager
     (chrome://password-manager), open Settings, and choose Export
     passwords. Chrome asks for your device password and saves a CSV file.
     Choose that file here." — a read-only path field + folder button
     calling `browserImportPick()`; on `{ ok }` show "N logins found" (+
     "M rows can't be imported" when `skipped.length`) and enable Continue;
     on `{ error }` show the coded reason ("That file isn't a Chrome
     password export." / "That file is too large." / "Too many rows." /
     "Could not read that file."); Continue → `openDestinationModal`;
     Cancel after a pick → `browserImportCancel(handle)`.
   - **Destination modal** (the one-row mapping case, DD9): a summary
     block (candidate count; the `browserImportSkipLines` list, collapsed
     under a "Show" disclosure when > 5), a destination `<select>` from
     `browserImportDestinationOptions` (Global preselected), and a
     Replace/Merge `<select>` shown only when the selected destination's
     presence snapshot reports ≥ 1 item (display-only; `mode` ALWAYS rides
     the commit, defaulting to `'merge'` — a destination populated since
     the snapshot merges safely and the native confirm shows the fresh
     count). Commit → `browserImportCommit({ handle, target, mode })`:
     `{ ok }` → close + completion modal; `reason: 'declined'` → status
     "Import cancelled." and Commit re-enabled (record still held);
     `'busy'` → "A rotation is in progress — try again shortly."; `'locked'`
     / `'state'` → "That import could not be completed. Start over from
     Import." + Commit disabled. Cancel → `browserImportCancel(handle)`.
   - **Completion modal**: `browserImportOutcomeLines(counts)` as a list,
     then the guidance line "Delete the exported CSV file now — it contains
     your passwords in plain text." Done → `refresh()`.
   - **Resume + drop**: `refresh()` joins the controller's `loadHeld()`
     (`browserImportSummary()`) INTO its existing `Promise.all`
     (`:2741-2745`, beside `fetchImportLabels`) so the first post-broadcast
     `render()` already reflects the held state (no one-render-late
     flicker — the restore precedent's structure); a held record after a forced
     modal close (the autolock-mid-modal invariant, `:2769-2776`) renders
     a "Resume browser import…" button in the section (the restore
     precedent `:1693-1698`); `pagehide` cancels a held record
     (`browserImportCancel(handle)`, the `:2795-2803` precedent). `render()`
     itself never cancels (the `:104` pin's rule, applied to the new
     bridge method too — a grep-AC in the new invariants file).
7. **Squawk 0063 lands here**: add `'/jar-page-model.js':
   shared('jar-page-model.js')` to the vault route (`internal-page-map.js:55-70`),
   `import { PALETTE } from './jar-page-model.js'` in `vault.js` (flat
   specifier + `// @ts-ignore` on the line before `} from`, per CLAUDE.md's
   internal-page import rule), delete `JAR_COLOR_PALETTE` (`:780-799`,
   comment + const) and point the use site (`:1020`) at `PALETTE`; keep
   `NEW_JAR_FALLBACK_COLOR` (`:800`). **Two collateral edits the squawk
   file does not name (design review, high):** (a)
   `test/unit/vault-restore-workflow-invariants.test.js`'s swatch-prefill
   test (`~:162-176`) hard-codes the identifier `JAR_COLOR_PALETTE` three
   times in its regex — retarget that regex to `PALETTE` in the same
   change (a rename, not a delete); (b) `buildColorSwatchGrid`'s docstring
   (`vault.js:805`) still says "for the same page-surface-only reason as
   JAR_COLOR_PALETTE above" — reword it (the reason no longer exists), so
   AC13's "literal no longer appears" grep holds. Close the squawk per its completion protocol
   (status, corrective action, verification, sign-off with the flight
   commit ref — filled at the flight commit, sign-off = the flight-end
   Reviewer). The route addition is an allowlist WIDENING of one pure,
   already-shipped shared module — nothing else in that map changes
   (pinned by the new invariants file).
8. **Budget**: `vault.js` ends ≤ `VAULT_PAGE_LINE_BUDGET` (2820,
   `seam-contract.test.js:193`) with the pin UNCHANGED. **The file is AT
   the budget today, not under it** (design review, medium): the test's
   metric is `split(/\r?\n/).length` = **2820** (`wc -l` says 2819 because
   of the trailing newline). So the arithmetic is: 0063 reclaims 20 lines
   (`:780-799`) and costs 2 (import + `@ts-ignore`) → 2802; the wiring
   budget is therefore **≤ 18 lines total** across the five sites (import
   `+2`, construction `≤ 8`, button `≤ 3`, `Promise.all` join `+1`,
   `pagehide` `≤ 3`). Measure after every step with
   `node -e "console.log(require('fs').readFileSync('src/renderer/pages/vault.js','utf8').split(/\r?\n/).length)"`;
   if over, trim the wiring (a single `createVaultBrowserImport({...})`
   call taking one deps object) — never bump the pin. Soft target ≤ 2815 so
   squawk 0063's "durable headroom" intent survives this leg at least in
   part; the squawk closure states the landed number honestly. No budget
   is added for the new controller.
9. **CP4's IPC half** (`test/unit/browser-import-boundary.test.js` grows,
   or a sibling `browser-import-flow.test.js` carries it): (a) the commit
   reply and the summary reply are JSON-serialized and contain none of a
   fixture's password/username/notes/title values; (b) `commit` with the
   dialog double returning `response: 1` performs NO `importLogins` call
   and no write; (c) a `commit` whose record is dropped (`dropAll`) while
   the `showMessageBox` promise is pending returns `'state'`, calls
   `importLogins` zero times, and the payload Buffer is all-zero; (d) the
   grep-AC over `src/main/automation/**` extends to
   `browser-import-flow` and the four channel names.
10. **Docs**: `docs/vault.md` gains a "Browser import (Chrome)" subsection
    under Portability (mechanism + the ABE finding pointer to the mission,
    the flow, the held-payload lifetime matrix, the native-confirm gate,
    the plaintext-file bounded exception, the automation refusal) and a
    threat-model bullet; `CLAUDE.md`'s Password-vault "Module layout"
    bullet lists the four new main modules and the page controller, and a
    new "Browser import" bullet states the DD5/DD13 boundary in the
    pattern's voice. The Flight-2 (Edge) half is deferred by the flight's
    own wording.

## Inputs

(Verified 2026-09-09 on the post-Leg-1 working tree.)

- Leg 1 modules (above) — read each `module.exports` before wiring.
- `src/main/main.js`: `onLock` hook `:811-816` (`_pendingVaultImports.dropAll()`
  at `:814`); `_pendingVaultImports` construction `:885-886`;
  `releaseVaultHoldsForWindow` `:910-913`; `getVaultHuman` memo idiom
  `:1235-1245` region; restore delegates `vaultImportBeginFromFile`
  `:1093-1125` (dialog + 16 MiB stat cap `:1110` + `'utf8'` read `:1113`),
  `vaultImportCommit` `:1186-1224` (`finally { pending.secret.fill(0) }`
  `:1219-1223`); the `registerBrowserIpc` deps object `:1750-1770`
  (`vaultImportBegin: vaultImportBeginFromFile` `:1760`); `dialog`
  destructured from `electron` `:11`.
- `src/main/register-browser-ipc.js:265-338` — the six restore channels;
  the gated-registration + `chromeForTab(event.sender.id)?.id` idiom;
  payload shape validation `:326-330`.
- `src/preload/internal-preload.js:691-807` — the restore bridge group.
  `src/preload/internal-preload.bundle.js:735` is the bundled twin (find
  the generator in `package.json` scripts before editing).
- `src/main/vault/vault-sheet-errors.js` — `CLASS_CHECK_ORDER` `:44-51`
  (no `VaultLockedError`), `mapVaultSheetError` `:71-82`,
  `VAULT_RESTORE_COMMIT_CONFIG` `:114`, `module.exports` `:172`.
- `src/renderer/pages/vault.js` (2819 lines): `bridge` `:65`;
  `closeActivePageModal` `:382`; `pendingImportRecord` `:404`; `openModal`
  `:418` (handle `{ close, setSubmitEnabled, setStatus }`, `onCancel` runs
  on operator dismissal only); `openImportPickModal` `:703-772`;
  `appendOption` `:774`; `JAR_COLOR_PALETTE` `:780-799` (comment + const) +
  `NEW_JAR_FALLBACK_COLOR` `:800`; `buildColorSwatchGrid` `:820`;
  `openMappingModal` `:938-1210` (commit handler `:1159-1204`);
  `openCompletionModal` `:1220-1251`; `buildImportExportSection`
  `:1683-1712` (resume banner `:1694-1700`, buttons row `:1702-1705`);
  `refresh` `:2739-2761`; lock-state subscription `:2776`; labels-ready
  `:2783-2793`; pagehide drop `:2795-2803`; `createVaultNav(` call `:75`.
- `src/renderer/pages/vault-nav-controller.js` — `createVaultNav(deps)`
  `:30`, the injected-deps page-controller precedent.
- `src/main/internal-page-map.js:55-70` — the vault route.
- `src/shared/jar-page-model.js:32` — `export const PALETTE`.
- `src/shared/vault-page-model.js` — `restoreDestinationOptions` `:219`,
  `restoreOutcomeLines` `:287`, `export {…}` `:341-349`.
- `test/unit/seam-contract.test.js:193` — `VAULT_PAGE_LINE_BUDGET = 2820`;
  the metric is `split(/\r?\n/).length`, currently **2820** (zero headroom).
- `test/unit/vault-restore-workflow-invariants.test.js` — `:104` (render
  never drops), `:141-297` (mapping-modal/swatch source scans; the swatch
  prefill regex `~:162-176` names `JAR_COLOR_PALETTE` and is retargeted
  to `PALETTE` in this leg — the rest stays green with the grid untouched).
- `test/unit/register-browser-ipc.test.js` — `makeHarness` `:7`, 17 tests;
  `test/unit/register-download-ipc.test.js:64` — the `dialog` double
  shape (`showOpenDialog` only; add `showMessageBox`).
- `squawks/0063-jar-color-palette-dedup.md` — open; its Note requires the
  completion review to confirm the route change is a single-entry
  widening.
- `docs/vault.md` — Portability `:376`, restore workflow `:476-540`,
  Threat model `:618`. `CLAUDE.md` — "### Password vault".

## Outputs

- New: `src/main/vault/browser-import-flow.js`,
  `src/renderer/pages/vault-browser-import-controller.js`,
  `test/unit/browser-import-flow.test.js`,
  `test/unit/vault-browser-import-invariants.test.js` (grep-ACs: render
  never cancels; the route map's vault entry gained exactly two entries;
  no `'utf8'` read in the flow; `fill(0)` inside the commit's `finally`).
- Modified: `src/main/main.js`, `src/main/register-browser-ipc.js`,
  `src/preload/internal-preload.js` (+ bundle twin),
  `src/main/vault/vault-sheet-errors.js`, `src/main/internal-page-map.js`,
  `src/shared/vault-page-model.js`, `src/renderer/pages/vault.js`,
  `src/renderer/pages/vault.css` (only if a new class is needed),
  `test/unit/register-browser-ipc.test.js`, `test/unit/vault-page-model.test.js`,
  `test/unit/browser-import-boundary.test.js`,
  `test/unit/vault-restore-workflow-invariants.test.js` (swatch regex →
  `PALETTE`),
  `test/unit/vault-sheet-errors*.test.js` (the config export list, if
  pinned), `docs/vault.md`, `CLAUDE.md`, `squawks/0063-…md`.
- `flight-log.md` leg entry; flight.md leg checkboxes (at commit).

## Acceptance Criteria

Flow module (DD5, DD6, DD13):
- [x] AC1 `begin`: dialog cancel → `{ canceled: true }`; an over-cap file →
      `{ error: 'too-large' }` with no read and nothing held; a non-Chrome
      CSV → `{ error: 'unrecognized-format' }`; a Chrome export → `{ ok,
      path, handle, summary: { candidateCount, skipped } }` and
      `pending.peekSummary` holds it. The file is read via a Buffer path
      (grep: no `'utf8'` argument on the flow's `readFileSync`).
- [x] AC2 `commit` happy path (`merge`, Global, dialog double `response: 0`):
      `importLogins` called once with the adapted candidates and
      `{ mode: 'merge' }`; reply `{ ok: true, target: 'global', counts }`
      with `counts.imported` correct; the taken payload Buffer is all-zero
      afterward; `listItems('global')` shows the logins.
- [x] AC3 DD13 ordering, pinned three ways: (a) the dialog double records
      that `showMessageBox` was awaited BEFORE `pending.take` (a call-order
      log); (b) `response: 1` → `{ ok:false, reason:'declined' }`,
      `importLogins` uncalled, record STILL held (a second `commit` then
      succeeds); (c) `pending.dropAll()` fired while the `showMessageBox`
      promise is pending → `{ ok:false, reason:'state' }`, `importLogins`
      uncalled, payload all-zero.
- [x] AC4 The confirm's `message`/`detail` carry the FRESH count: seed the
      destination with 3 items, call `commit` with `replace` → the captured
      options mention `3`; save a 4th item between `begin` and `commit` →
      the captured options mention `4` (never the stale snapshot).
- [x] AC5 Refusals: locked store → `'locked'` with no dialog shown; unknown
      /burner target → `'state'` with no dialog; mismatched handle →
      `'state'`; re-key gate up during `importLogins` → `'busy'`, payload
      zeroized; an unknown error propagates AND the payload is zeroized.
- [x] AC6 Reply hygiene: `JSON.stringify` of every `begin`/`summary`/`commit`
      reply contains none of the fixture's password/username/notes/title
      values (the flight's Leg-2 acceptance note), and the `commit` reply's
      keys are exactly `ok`, `target`, `counts` (no `results` array).

IPC + composition (DD5):
- [x] AC7 `register-browser-ipc.test.js`: the four channels register only
      when their delegate is injected; each resolves the window via
      `chromeForTab(sender.id)`; `commit` rejects a malformed payload with
      `{ ok:false, reason:'state' }` before delegating; the harness's
      existing 17 tests stay green.
- [x] AC8 `main.js` grep-ACs: `_pendingBrowserImports.dropAll()` inside the
      `onLock` hook body; `_pendingBrowserImports.clear(chromeId)` inside
      `releaseVaultHoldsForWindow`; exactly one
      `createPendingBrowserImportStore(` call; the four flow methods
      threaded into the `registerBrowserIpc` deps.
- [x] AC9 `internal-preload.js` exposes the four `browserImport*` methods
      under the same object as `pickImportFile`, each a bare
      `ipcRenderer.invoke` of its channel; the bundle twin matches
      (regenerated or edited per its generator).
- [x] AC10 `internal-page-map.js`'s vault route gained EXACTLY two entries
      (`/jar-page-model.js`, `/vault-browser-import-controller.js`) and no
      other route changed (a source-scan diffs the map's other entries
      against a fixture list).

Page (DD9, DD10, DD11):
- [x] AC11 `vault-page-model.js`: `browserImportDestinationOptions`,
      `browserImportSkipLines`, `browserImportOutcomeLines` exported and
      unit-tested (each reason code labeled; `non-web-origin` renders the
      scheme; unknown codes echo raw; zero-lines omitted except imported;
      malformed input coerces, never throws).
- [x] AC12 Source-scan pins on the controller + `vault.js`: the "Import
      from a browser…" button is appended only inside an `unlocked` guard;
      the pick modal's lede names `chrome://password-manager` and "Export
      passwords"; the completion modal contains the "Delete the exported
      CSV file now" line; `render()`'s body contains no
      `browserImportCancel` call and no held-record assignment; every
      `browserImportCancel(` call in the controller lives in an `onCancel`
      body or the `pagehide` listener; `mode` is always sent (a
      `'merge'` default literal precedes the commit call).
- [x] AC13 Squawk 0063: `JAR_COLOR_PALETTE` no longer appears in
      `vault.js` (code OR comments); `PALETTE` is imported from
      `./jar-page-model.js`; the swatch-grid call site references
      `PALETTE`; `vault-restore-workflow-invariants.test.js`'s swatch
      regex is retargeted to `PALETTE` and the suite is green; the squawk
      file is `completed` with corrective action + verification filled
      (stating the landed `vault.js` line count) and sign-off marked
      "flight-end Reviewer; commit: flight/01 commit".
- [x] AC14 `seam-contract.test.js` green with `VAULT_PAGE_LINE_BUDGET`
      unchanged at 2820 (grep the literal); the measured
      `split(/\r?\n/).length` of `vault.js` is recorded in the flight-log
      entry.

Boundary (CP4 IPC half):
- [x] AC15 Ruling 9(a)–(d) pass; `EXPECTED_TOOL_COUNT` unchanged; the
      `src/main/automation/**` grep-AC covers `browser-import-flow` and the
      four channel names.

Docs + whole-leg:
- [x] AC16 `docs/vault.md` has the "Browser import (Chrome)" subsection
      and threat-model bullet (ruling 10); `CLAUDE.md`'s Password-vault
      pattern lists the new modules and states the DD5/DD13 boundary.
- [x] AC17 Green bar: `npm test` (with a timeout), `npm run typecheck`,
      `npm run lint`, `npm run format` then `format:check` — all clean;
      every pre-existing suite green.
- [x] AC18 `flight-log.md` leg entry (changes, verification, deviations);
      leg `landed`.

## Verification Steps

- AC1–AC6: `node --test --test-timeout=60000 test/unit/browser-import-flow.test.js`
  (FAST_SCRYPT temp-dir store, `pending-browser-imports` real, `dialog`
  double with a controllable deferred `showMessageBox`).
- AC7: `node --test test/unit/register-browser-ipc.test.js`.
- AC8, AC10, AC12, AC13 (scan half): `node --test
  test/unit/vault-browser-import-invariants.test.js test/unit/vault-restore-workflow-invariants.test.js`.
- AC9: `node --test test/unit/internal-preload*.test.js` if one exists,
  else a grep-AC in the invariants file; `git diff --stat` shows the
  bundle twin changed alongside the source.
- AC11: `node --test test/unit/vault-page-model.test.js`.
- AC14: `node --test test/unit/seam-contract.test.js`; `grep -n
  'VAULT_PAGE_LINE_BUDGET = 2820' test/unit/seam-contract.test.js`.
- AC15: `node --test test/unit/browser-import-boundary.test.js test/unit/automation-mcp-server.test.js`.
- AC16: read the two docs sections.
- AC17: the four green-bar commands.

## Implementation Guidance

1. **Squawk 0063 first** (smallest, buys headroom): route entry, import,
   delete the palette, substitute, run the invariants suite. Update the
   squawk file at the end of the leg.
2. **`vault-sheet-errors.js`**: add `VAULT_BROWSER_IMPORT_COMMIT_CONFIG`
   and export it; check for a test that pins the export list.
3. **Flow module + its suite** (ruling 1; AC1–AC6). Build the dialog
   double as `{ showOpenDialog: async () => …, showMessageBox: (win,
   opts) => { captured.push(opts); return deferred.promise; } }` so AC3(c)
   can `dropAll()` between the call and the resolve. Use
   `store.listItems` as the fresh-count source — never the page's
   presence snapshot.
4. **IPC + preload + main wiring** (rulings 2–3; AC7–AC9). Find the
   preload bundle generator before editing the bundle.
5. **Page model helpers** (ruling 5; AC11), then the **controller**
   (ruling 4, 6) — inject every DOM helper; the controller must not reach
   `document` for anything `openModal` already owns. Keep `vault.js`
   changes to the five wiring sites listed in ruling 4.
6. **Invariants + boundary suites** (AC8, AC10, AC12, AC13, AC15).
7. **Docs** (AC16), green bar, flight-log entry, leg `landed`.

## Edge Cases

- **Header-only export**: `begin` returns `{ ok, summary: { candidateCount:
  0, skipped: [] } }`; the pick modal shows "No logins found in that file"
  and keeps Continue disabled; nothing to commit.
- **Everything skipped** (`candidateCount: 0`, `skipped.length > 0`): same
  as above but the skip list is shown so the operator learns why.
- **Declined confirm then lock**: the record stays held after `declined`;
  the later lock drops it (`dropAll`); the next `commit` → `'state'`; the
  page's status tells the operator to start over.
- **Window closed mid-dialog**: `releaseVaultHoldsForWindow` clears the
  record; the pending `showMessageBox` resolves later into step 6's re-peek
  → `'state'`, nothing written. If `windowForChrome` returns nothing, pass
  no parent (Electron accepts a parentless message box).
- **Two windows**: each window's record is keyed by its own chrome id;
  `summary` in window B never sees window A's import.
- **Replace into Global**: allowed (Global is an ordinary destination for
  this op); the confirm's detail states the deletion count.
- **`mode` for an empty destination**: the page sends `'merge'`; the store
  ignores it (Leg 1 ruling 7).

## Files Affected

- `src/main/vault/browser-import-flow.js` — new, the operator flow.
- `src/main/vault/vault-sheet-errors.js` — new commit config.
- `src/main/main.js` — store instance, lock/close drops, flow memo, deps.
- `src/main/register-browser-ipc.js` — four channels.
- `src/preload/internal-preload.js` (+ `.bundle.js`) — four bridge methods.
- `src/main/internal-page-map.js` — two vault-route entries.
- `src/shared/vault-page-model.js` — three pure helpers.
- `src/renderer/pages/vault-browser-import-controller.js` — new page UI.
- `src/renderer/pages/vault.js` — 0063 + five wiring sites.
- `src/renderer/pages/vault.css` — only if needed.
- Tests: `browser-import-flow.test.js` (new),
  `vault-browser-import-invariants.test.js` (new),
  `register-browser-ipc.test.js`, `vault-page-model.test.js`,
  `browser-import-boundary.test.js`, any error-config export pin.
- `docs/vault.md`, `CLAUDE.md`, `squawks/0063-jar-color-palette-dedup.md`,
  `flight-log.md`.

## Citation Audit

Every `main.js`, `register-browser-ipc.js`, `internal-preload.js`,
`vault-sheet-errors.js`, `vault.js`, `internal-page-map.js`,
`jar-page-model.js`, `vault-page-model.js`, and test-file citation above
was read on 2026-09-09 on the post-Leg-1 working tree, then independently
re-checked by the design-review Developer (78 tool reads). Corrections
applied from that review: `BrowserImportFormatError` exposes `.reason`
(not `.code`); `vault.js` measures 2820 under the seam metric (at budget,
not 2819); four `vault.js` range drifts and the seam-contract constant's
line (`:193`) repaired; the 0063 collateral (invariants regex + docstring)
and the `windowForChrome` composition added. Flight-spec drift
carried from the Leg 1 review and corrected here: `vaultImportCommit` is
`main.js:1186` (spec `:1187`); its `finally { fill(0) }` is `:1219-1223`
(spec `:1218-1222`). `VaultLockedError` is absent from the error mapper's
class ladder — a fact the flight spec does not mention and that ruling 1
step 3 works around with a pre-check rather than a ladder widening.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (per the Developer task's explicit
      instruction — this is the LAST autonomous leg; `completed` follows
      the flight-end Reviewer + flight-debrief, not this Developer pass)
- [ ] Check off this leg in flight.md — deferred to the flight commit
      (Developer task instruction: do not commit, do not check off the
      leg in flight.md; both happen at the flight-end commit)
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts) — deferred to the
      flight-end commit, per the same instruction
