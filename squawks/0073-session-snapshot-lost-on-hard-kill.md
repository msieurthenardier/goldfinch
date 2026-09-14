# Squawk 0073: Session snapshot is only written at quit, so a hard kill loses every tab

**Status**: completed
**Type**: defect
**Severity**: grounding
**Reported**: 2026-09-14
**Completed**: 2026-09-14

## Report

After installing an update (0.16.1, 0.16.2 and 0.16.3, all on 2026-09-14) the
relaunched app restored a single two-day-old tab instead of the tabs that were
open. Session restore was ON and working — the data it restored was stale.

The session snapshot is written at exactly two moments: `before-quit` (graceful
quit) and per-window `close`. Nothing writes it while browsing. The Windows NSIS
installer does not quit the running app gracefully: with PowerShell available
(the default) electron-builder's `KILL_PROCESS` macro runs `Stop-Process` with
no `-Force`, which is still a hard kill (no `WM_CLOSE`, so no `close`, no
`before-quit`). The same loss applies to any crash, power loss, or `taskkill /F`.

Reproduce: open several tabs, kill the process (Task Manager → End task, or run
an installer over it), relaunch — the restored session is whatever the LAST
graceful quit wrote, however old.

## Evidence

- `src/main/app-lifecycle.js:before-quit` — `sessionStore.write(buildSessionSnapshot(…))` — the quit-time write.
- `src/main/window-factory.js` (`win.on('close')`) — `if (settings.get('restoreSession') === true && !isSessionQuitting()) sessionStore.write(…)` — the only other write.
- `grep -c sessionStore src/main/register-tab-ipc.js` → `0` — no tab-lifecycle site writes the snapshot.
- `node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh:KILL_PROCESS` — PowerShell path: `Stop-Process -Id $$_.ProcessId $0` (a hard terminate regardless of `-Force`); the `taskkill` path without `/F` would send `WM_CLOSE`, but it is only used when PowerShell is unavailable.
- Operator profile (`%APPDATA%/goldfinch/app.db`, read from a copy 2026-09-14): `documents` row `session` `updated_at` = 2026-09-12T22:07Z, payload = one tab (`https://github.com/msieurthenardier/goldfinch/pull/209`); row `downloads` `updated_at` = 2026-09-14T22:00Z (the relaunch wrote other rows, never `session`). `history.db` holds the visits of the lost tabs.
- `test/unit/session-restore-wiring.test.js`, `session-runtime.test.js`, `session-snapshot.test.js`, `session-store.test.js` — the existing suites; none exercises a write outside quit/close.

## Corrective Action

Added a continuous, debounced session-snapshot writer so the on-disk snapshot tracks
live browsing instead of only the last graceful quit:

- **`src/main/session-snapshot-scheduler.js` (new, Electron-free, injected-deps)**:
  - `createSessionSnapshotScheduler({ write, setTimeout, clearTimeout, delayMs, isPending, logger })`
    — `schedule()` arms/re-arms a single trailing debounce (default 1500ms), `flush()`
    performs the pending write now and cancels the timer, `cancel()` drops a pending
    write. Both `write()` and `isPending()` are try/catch-wrapped inside the scheduler
    (`logger.error` on throw) — a broken snapshot write or gate check can never
    propagate into whatever IPC/event handler called `schedule()`/`flush()`.
  - **Timer hygiene (review fix)**: `arm()` calls `.unref()` on the handle `setTimeout`
    returns, guarded (`typeof handle?.unref === 'function'`) — matches the codebase's
    other standing timers (`pruneAllJars`'s interval, `clipboardClearTimer`, the vault
    timers), so this debounce alone can never hold the event loop open, and MockTimers /
    plain numeric handles in the unit suite (which expose no `unref`) are unaffected.
  - `isRestorePending(records, now, settleMs = 30000)` — the pure boot-restore gate
    (hazard #4). A record blocks iff it carries a non-empty `restoreTabs` (the
    boot-restore payload) AND its live `tabViews.size` hasn't yet reached that count,
    UNLESS `settleMs` has elapsed since `rec.bootConfigServedAt` — covering a saved URL
    legitimately rejected by `isSafeTabUrl` at `tab-create` and never arriving. ANY
    pending record gates the whole write (one write touches every window at once).
    When the scheduler's debounce fires while `isPending()` is true, it re-arms itself
    (same delay) instead of writing AND instead of dropping the request — no new
    `schedule()` call is required for the write to eventually land once the gate clears.
  - `createDedupedSnapshotWriter({ buildSnapshot, persist, serialize })` — the process-
    local dedupe cache (requirement #2): skips `persist()` when the newly built
    snapshot serializes identically to the last one this process actually persisted. A
    `buildSnapshot()` returning `null` (nothing to write) is a no-op that does not touch
    the dedupe cache.
- **`src/main/main.js`**: constructs the scheduler once, module-scope, right beside the
  window registry. The `write` callback composes `createDedupedSnapshotWriter` with the
  existing `restoreSession` setting gate and an `appDb.isOpen()` guard; `isPending`
  wires to `isRestorePending(registry.records(), Date.now())`. A bound
  `scheduleSessionSnapshot` accessor is threaded (the existing `getMcpServer`/
  `getDownloadsManager`/`getHistoryRecorder` late-bound-closure idiom — deps objects
  built before the scheduler line executes still resolve correctly because nothing
  calls them until the app is running) into `createWindowFactory`, `createGuestWiring`,
  and `registerTabIpc`'s deps as `scheduleSnapshot`; `sessionSnapshotScheduler.flush`
  is threaded into `registerAppLifecycle` as `flushSessionSnapshotScheduler`.
- **Call sites armed** (every `tabViews.set(`/`tabViews.delete(`/`activeTabWcId =`
  site, plus navigation and window creation):
  - `src/main/register-tab-ipc.js`: `tab-create` (after `rec.tabViews.set`), `tab-close`
    (after `owner.tabViews.delete`), `tab-hide` and `tab-set-active` (after the
    `activeTabWcId` write — `active` is part of the snapshot), and the shared
    `moveTabIntoWindow` core (after the cross-window `tabViews` delete/set pair — one
    call covers all four move/tear-off/adopt entry points since they funnel through it).
  - `src/main/guest-wiring.js`: `wireTabViewEvents`'s `did-navigate` and
    `did-navigate-in-page` handlers (the URL is part of the snapshot).
  - `src/main/window-factory.js`: end of `createWindow()` (new-window topology; low
    value alone since a 0-tab window is dropped by `buildSessionSnapshot`, but listed
    explicitly in the squawk as a site to cover).
- **`src/main/app-lifecycle.js`**:
  - `window-boot-config` now also stamps `rec.bootConfigServedAt = Date.now()` beside
    the existing `rec.bootConfigServed = true` — the settle-timeout reference point for
    `isRestorePending`. (Not added to `window-registry.js`'s `WindowRecord` JSDoc typedef
    — the field is duck-typed like `dragWcId`/`bookmarkDragActive` were before being
    formally typed, and `app-lifecycle.js` carries no type annotations on `registry`/
    `rec`, so `tsc` treats the chain as `any` and raises nothing; kept out to stay
    within the squawk's file scope.)
  - `before-quit` now calls the injected `flushSessionSnapshotScheduler()` (try/catch,
    logged) BEFORE its existing unconditional write — cancels the debounce timer so
    nothing can fire after `appDb.close()` at `will-quit`. The existing write is
    byte-unchanged (still the authoritative quit-time snapshot); `flushSessionSnapshotScheduler`
    defaults to a no-op so offline harnesses that omit it are unaffected.

**Why debounced-continuous over alternatives**: a write on every keystroke/frame is
wasteful and could contend with the write-hot parts of `app.db`; a periodic timer
(e.g. every 30s) either writes too often when idle or lags too far behind a burst of
tab activity. A trailing debounce armed from the actual topology-changing events writes
exactly once ~1.5s after browsing activity settles — bounded staleness with no polling,
matching the existing `schedulePrivacySend`/menu-overlay debounce idioms already in the
codebase. Dedupe avoids a write storm on same-content events (e.g. rapid `tab-set-active`
churn during strip keyboard nav) at near-zero cost (a string compare).

**Why the gate is a pure function threaded as `isPending`, not baked into the scheduler**:
keeps `session-snapshot-scheduler.js` fully Electron-free and domain-agnostic (it knows
nothing about `restoreTabs`/`tabViews`/`bootConfigServedAt`), while still making the
"re-arm instead of drop or partial-write" behavior itself unit-testable in isolation
from the registry/settings wiring that only exists in `main.js`.

## Verification

Commands run from the repo root, exact pass/fail counts:

- `timeout 400 npm test` → `# tests 4469` / `# pass 4469` / `# fail 0`
- `timeout 120 npm run lint` → clean (no output beyond the npm banner)
- `timeout 300 npm run typecheck` → clean (`tsc --noEmit -p jsconfig.json`, no errors)
- `npm run format` → applied (one file needed formatting: the re-targeted wiring-pin test)
- `npm run format:check` → `All matched files use Prettier code style!`

Tests added (exact counts, `grep -c "^test(" <file>` cross-checked against
`node --test <file>`'s own `# tests` line):

- `test/unit/session-snapshot-scheduler.test.js` (**11 tests** — corrected; a prior draft
  of this artifact claimed 16, which was never true of the committed file) —
  `createSessionSnapshotScheduler`: N `schedule()` calls coalesce into one write after
  the trailing debounce; `flush()` writes immediately (when pending) and cancels the
  timer, and is a no-op with nothing pending; `cancel()` drops a pending write; a
  throwing `write()`/`isPending()` is swallowed and logged (and a throwing `isPending()`
  still lets the write through, logged once); `isPending() === true` re-arms instead of
  writing, and a later `false` (with NO new `schedule()` call) lets the self-re-armed
  timer produce the write; **`schedule()` calls `.unref()` on the armed handle when the
  handle exposes one, and tolerates a handle that doesn't** (review fix — two new tests).
  Plus `createDedupedSnapshotWriter`: persists on change, skips an identical serialized
  snapshot (including a different-object-identity/same-content case), and a
  `null`/`undefined` `buildSnapshot()` skips without seeding the dedupe cache.
- `test/unit/session-restore-gate.test.js` (**7 tests**) — `isRestorePending`: a record
  short of its `restoreTabs` length blocks; reaching (or exceeding) the count releases;
  no `restoreTabs` never blocks (absent/null/empty array); the settle timeout releases
  regardless of count once elapsed; no `bootConfigServedAt` yet never settles; any one
  pending record gates the whole result; an empty/missing records list is never pending.
- `test/unit/session-snapshot-continuous-wiring.test.js` (**13 tests**) — source-scan
  pins, in the `session-restore-wiring.test.js`/`move-tab-synchrony.test.js` house style
  (read the real source, mutate it in memory, assert the property flips — non-vacuous):
  each of `register-tab-ipc.js`'s five call sites (deps destructure + `tab-create`/
  `tab-close`/`tab-hide`/`tab-set-active`/`moveTabIntoWindow`), `guest-wiring.js`'s three
  (deps destructure + `did-navigate`/`did-navigate-in-page`), `window-factory.js`'s two
  (deps destructure + end-of-`createWindow()`), `app-lifecycle.js`'s two (`before-quit`
  calls `flushSessionSnapshotScheduler()` before the existing write; `window-boot-config`
  stamps `bootConfigServedAt`), and `main.js`'s composition (the scheduler is
  constructed and threaded into all four deps objects) each get their own discriminating
  mutation, so a future accidental removal of any one site fails loudly rather than the
  suite passing on a silently-shrunk feature.

**Review fix — regex-target mutation pins (CLAUDE.md, "Regex-target mutation pins",
Flight 5 M17).** The seven `register-tab-ipc.js`/`guest-wiring.js` arm-site pins
(`tab-create`, `tab-close`, `tab-hide`, `tab-set-active`, `moveTabIntoWindow`,
`did-navigate`, `did-navigate-in-page`) originally used exact multi-line string literals
as `.replace()` mutation targets — stale-able by a Prettier re-wrap of the (sometimes
very long) anchor statement. Each was re-targeted to a wrap-insensitive regex: `\s*`
between every token, metacharacters escaped, a captured anchor group (group 1) kept in
the replacement so no code is re-typed and could itself drift from the source, and
`assertMutated` still guards every one (a no-op `.replace()` would discharge vacuously).
Two disambiguation notes, both pinned by an added same-run assertion that the SIBLING
site's regex still matches the mutated text (proving the mutation didn't over-reach):

- `tab-hide` and `tab-set-active` share byte-identical Squawk 0073 comment text
  (`` `active` is part of the snapshot — … ``) — disambiguation comes entirely from each
  regex's own anchor statement, never the comment.
- `did-navigate` and `did-navigate-in-page` share byte-identical comment text AND an
  identical `getHistoryRecorder()?.handleNavigation(…)` call — disambiguation comes from
  each regex's `wc.on('did-navigate'` / `wc.on('did-navigate-in-page'` anchor prefix
  (structurally exclusive: the trailing comma after `'did-navigate'` cannot match inside
  the longer `'did-navigate-in-page'` string), and each is additionally bounded with a
  negative lookahead against a subsequent `wc.on(` registration so a scan can never walk
  past its own handler into its sibling's.

**Neuter-verified, all seven** (real call site temporarily removed from the actual
source file via a throwaway script, the specific test re-run to confirm it goes RED,
the file restored from a pre-edit backup, the test re-run to confirm GREEN again, and
`diff` against the backup confirmed byte-identical restoration before moving to the
next site — `register-tab-ipc.js` and `guest-wiring.js` each verified byte-identical to
their pre-neuter state after all of that file's sites were exercised):

| Pin | File | Neutered → | Restored → |
| --- | --- | --- | --- |
| `tab-create` | `register-tab-ipc.js` | RED (assertion failure) | GREEN |
| `tab-close` | `register-tab-ipc.js` | RED | GREEN |
| `tab-hide` | `register-tab-ipc.js` | RED | GREEN |
| `tab-set-active` | `register-tab-ipc.js` | RED | GREEN |
| `moveTabIntoWindow` | `register-tab-ipc.js` | RED | GREEN |
| `did-navigate` | `guest-wiring.js` | RED | GREEN |
| `did-navigate-in-page` | `guest-wiring.js` | RED | GREEN |

Consciously left out / not touched:

- No schema/IPC-channel change, no renderer change, no `window-registry.js` edit (the
  `bootConfigServedAt` field is duck-typed, matching the pre-typed history of several
  other ad-hoc record fields in this codebase).
- `rec.restoreTabs` is never explicitly cleared once a window's restore completes — the
  gate re-derives "pending" live from `tabViews.size >= restoreTabs.length` every check,
  which is simpler and already covers the "count reached" release path the squawk asked
  for without extra mutation/state at the `tab-create` site.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet), two cycles, scoped to the diff
**Verdict**: confirmed — cycle 1 traced the boot-restore gate end to end
(`bootConfigServedAt` stamped synchronously before any restored `tab-create`
can arrive; an unserved window always blocks; a gated debounce re-arms rather
than drops; the count-based re-block after closing a restored tab inside the
30 s settle window is bounded, self-releasing staleness — accepted), quit
ordering, an exhaustive grep of every `tabViews.set`/`delete` and
`activeTabWcId =` site (no misses), dedupe + setting gate, and the
Electron-free module shape; three non-blocking findings (artifact test count,
`.unref()` on the debounce timer, exact-literal mutation pins) were fixed and
re-reviewed in cycle 2, with two pins independently neuter-verified. Both
cycles re-ran the green bar (4467 → 4469/4469), lint, typecheck, format:check.
**Commit**: `squawk/0073: write the session snapshot continuously, debounced`
on branch `squawk/0073-continuous-session-snapshot`
