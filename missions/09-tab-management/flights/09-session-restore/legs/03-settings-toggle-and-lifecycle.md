# Leg: 03-settings-toggle-and-lifecycle

**Status**: completed
**Flight**: [Session Restore](../flight.md)

## Objective

Wire the persistence layer into the app: a default-off "Restore session on startup" setting (DD7),
a two-writer clean-quit snapshot capture at the window `close` handler + `before-quit` (DD3/DD6),
and a `whenReady` restore that rebuilds saved windows and **creates their tabs fresh** in their
saved jars (DD4) — with the setting **off** leaving startup **byte-identical** to today.

## Context

**Risk: HIGH (recorded in flight-log Flight Director Notes) — startup/lifecycle.** The mission's
"single-window behavior is the regression baseline" constraint is **absolute**: default-off startup
must change nothing. Per `/agentic-workflow` 2a this leg gets a per-leg design review.

**Depends on leg 2** (`session-store.js` `{load, read, write, clear}`, `session-snapshot.js`
`buildSessionSnapshot`, `persist-jar-gate.js`) and leg 1 (move-core fix already in `main.js`).

**DD3 two-writer coordination (the round-2-review bug fix).** The two quit paths order oppositely:
- **Close-last-window:** the per-window `close` handler (`main.js:1227`) runs first and destroys tabs
  (`webContents.destroy()` at `:1278`, clears `tabViews`, nulls `activeTabWcId`) **before**
  `window-all-closed → app.quit() → before-quit`. So `before-quit` reads an **empty** registry.
- **Menu Exit / Cmd+Q** (`app-quit` → `app.quit()`, `main.js:2499`): `before-quit` fires **first**
  (full registry alive), then windows close.

**Invariant: the terminal on-disk snapshot = the windows alive at the FIRST quit-initiating event.**
A module-scoped `quitting` flag + a non-empty guard, both **setting-gated**:
- `before-quit`: set `quitting = true`; if the setting is on **and** `registry.records()` is non-empty,
  `sessionStore.write(buildSessionSnapshot({ windows: registry.records(), jarsList: jars.list() }))`.
  Placed **before** `mcpServer?.stop()` (flush-first, beside `downloadsManager?.flushInterrupted()`).
- window `close` handler: if the setting is on **and** `!quitting`, write the same snapshot from
  `registry.records()` — placed **before** the destroy loop (`:1275`), a **sibling** to the existing
  `captureWindowCloseEntries` block (guests alive there). The closing window is still in
  `registry.records()` (removed only at `closed`, `:1294`), so close-last-window captures `{thisWindow}`;
  menu-Exit suppresses this write (`quitting` true) because `before-quit` already captured the full set.

**DD4 restore — CREATE FRESH (never adopt).** At `whenReady`, the single `createWindow()` (`main.js:3589`)
becomes: `const snap = restoreOn ? sessionStore.read() : null; if (snap) { rebuild } else { createWindow() }`.
Rebuild: per saved window `createWindow({ noBootTab: true })` and **stash its saved tab list on the
record**; `window-boot-config` (`:2494`) returns `{ bootTab: false, restoreTabs }` when present; the
renderer boot loop (`renderer.js:4069`) creates each tab fresh via the **reopen precedent**
(`createTab(url, container, { trusted: false })`, `renderer.js:3631`) — **no `restoreHistory`** (DD5).

## Inputs

- `src/main/settings-store.js` — `DEFAULTS` + validators (`automationEnabled` strict-boolean template);
  `set`/`get`.
- `src/renderer/pages/settings.html` + `settings.js` — the spellcheck toggle row + IIFE to clone.
- `src/main/main.js` — `whenReady` (`:3546`), `historyStore.open` sibling pattern (`:3555`),
  `createWindow` (`:1046`, `record` at `:1110`), `window-boot-config` (`:2483`), the `close` handler
  (`:1227`, `captureWindowCloseEntries` at `:1261`, destroy loop at `:1275`), `before-quit` (`:3709`).
- `src/renderer/renderer.js` — boot `Promise.all` (`:4065`), the reopen `createTab(url, container, …)`
  precedent + `inheritContainerFromPartition` (`:3630`), the live jars boot snapshot (`jarsBoot`).
- Leg 2's `session-store.js`, `session-snapshot.js`.

## Acceptance Criteria

> **DD10: two readings per state-asserting AC. `main.js`/`renderer.js` are never executed by unit
> tests — behavioral proof of the wiring is leg 4's `session-restore` spec; this leg pins CODE SHAPE
> (masked source-scans) + the settings-store unit-testable half, and says so honestly.**

- [ ] **AC1 — the "Restore session on startup" setting (DD7), default OFF, strict boolean.** In
      `settings-store.js`: add `DEFAULTS` key (e.g. `restoreSession: false`) **with** an explicit
      `(v) => typeof v === 'boolean'` validator (the `automationEnabled` template — not the
      typeof-fallback). In `settings.html`: a labeled checkbox row (clone the spellcheck
      `<label class="shield-row">` pattern) with a `<p class="muted">` help note. In `settings.js`:
      clone the spellcheck IIFE with the new id (populate via `settingsGet`, write on `change` via
      `settingsSet`, `onSettingsChanged` two-way sync, `pagehide` cleanup). **No live side-effect**
      (startup-only). **Unit-testable readings:** a `settings-store` unit test — default is `false`;
      `set(key, true)` persists `true`; `set(key, 'yes')` **throws** (`assert.throws`) and leaves the
      value unchanged (`settings.set` throws on an invalid value **before** mutating — not a silent
      no-op). Plus `npm run typecheck` green.
- [ ] **AC2 — `session-store.load()` wired at startup, UNCONDITIONALLY, with correct userData.** A
      **sibling** call in `whenReady` right after `initProfileAndStores(...)` returns (the
      `historyStore.open(app.getPath('userData'))` pattern at `:3555`) — the dev-profile
      `setPath('userData')` redirect has already run, so the dir is correct. Do **not** widen
      `initProfileAndStores`'s unit-pinned 4-store signature. **`load()` runs unconditionally, NOT
      gated on the setting** — `session-store.write()` throws without a `load()`-set `dir`, so a user
      who **enables restore mid-session** must have `dir` set to write at the next quit (and an uncaught
      throw in `before-quit` would wedge the quit — the F6 hang class). When off, the loaded snapshot
      sits **inert** (never `read()`); for a user who never enabled, `session.json` never exists so
      `load()`'s `existsSync` is false → genuinely zero read. **Reading:** masked source-scan that
      `sessionStore.load(` appears in the `whenReady` body after the `initProfileAndStores` call, and is
      **not** wrapped in a `settings.get` guard.
- [ ] **AC3 — clean-quit snapshot WRITE, two-writer coordinated, setting-gated, try/caught (DD3/DD6).**
      Module-scoped `let quitting = false`. `before-quit`: `quitting = true`; if `settings.get(<key>) === true`
      **and** `registry.records().length` → `sessionStore.write(buildSessionSnapshot({windows: registry.records(),
      jarsList: jars.list()}))`, **before** `mcpServer?.stop()`. `close` handler: if
      `settings.get(<key>) === true` **and** `!quitting` → the same write, **before** the destroy loop,
      a sibling to `captureWindowCloseEntries`. **Both write sites are wrapped in `try/catch`** —
      `session-store.write()` propagates fs errors by design, and an **uncaught throw in `before-quit`
      can wedge the quit** (the F6 window-close-hang class); the `close` write matches the existing
      `captureWindowCloseEntries` try/catch posture. **Design-review walk confirmed correct on all quit
      paths:** menu-Exit-2-window → `{A,B}` (before-quit writes full, closes suppressed); close-last-window
      → `{thisWindow}` (close writes, empty before-quit skipped by the non-empty guard, no clobber);
      no `win.destroy()` exists in `main.js` (all `.destroy()` are on `webContents`), so every window
      routes through `close`. **Readings (masked source-scans):** both write sites guarded by
      `settings.get(<key>)` (mutate the guard away → the "write is setting-gated" scan fails); the
      `close`-site `sessionStore.write` index **precedes** the `webContents.destroy` index within the
      handler. **Runtime proof (terminal-snapshot correctness on both quit paths, incl. the 2-window
      menu-Exit case) is leg 4's** — state it. *(Documented edge: the `close` write reads
      `registry.records()` which momentarily over-includes the closing window on a mid-session dismissal
      of a non-last window; always overwritten by the next close/quit — surfaces only on a crash between
      events, which DD6 scopes out.)*
- [ ] **AC4 — restore READ + rebuild at `whenReady`, creating tabs FRESH (DD4).** Replace the single
      `createWindow()` (`:3589`) with the gated branch: `const snap = settings.get(<key>) === true ?
      sessionStore.read() : null; if (snap) { for each snap.windows → createWindow({noBootTab:true})
      with its saved tab list stashed on the record } else { createWindow(); }`. **`createWindow`
      already returns the record** (`return record;` at `main.js:~1354`; existing caller does
      `const rec = createWindow(); return rec.win.id;`), so the rebuild is `const rec =
      createWindow({noBootTab:true}); rec.restoreTabs = w.tabs;` — **no `registry.get` needed**;
      `window-boot-config`'s `getWindowForChrome(event.sender)` resolves that same record object.
      Extend `window-boot-config` (`:2494`) to `return rec.restoreTabs ? { bootTab: false, restoreTabs:
      rec.restoreTabs } : { bootTab: !rec.noBootTab };`. **Readings (masked):** the `whenReady` restore read is guarded by
      `settings.get(<key>)` (mutate away → the branch is unreachable); `window-boot-config` returns
      `restoreTabs` only when the record carries it. **No adopt path is used** — assert
      `removeChildView`/`addChildView` do **not** appear on the restore path.
- [ ] **AC5 — the renderer boot loop creates saved tabs fresh, drops deleted jars, restores active
      (DD4).** In `renderer.js` boot `Promise.all` (`:4069`): when `bootConfig.restoreTabs` is a
      non-empty array, for each `{ url, jarId, active }` resolve the container via the **new pure helper**
      `resolveRestoreContainer(jarId, containers)` (AC5b) — the `openTab` precedent
      `containers.find(c => c.id === jarId) || null` over the live jars snapshot (`containers`, populated
      from the awaited `jarsBoot`); **if it returns `null`, `continue` — DROP the entry, never
      home-substitute** (DD4 edge). **Do NOT use `inheritContainerFromPartition`** — it takes a partition
      (not a jarId) and carries a default-jar/fresh-burner fallback that would silently re-home a deleted
      jar's tab, violating DD4. Then `createTab(url, container, { trusted: false })` (the reopen precedent
      minus `restoreHistory`/`insertAt` — DD5; loop order gives insertion-order fidelity); after the loop,
      **activate** the tab whose `active` is true via `activateTab(tab.id)`. Else → the existing
      `if (bootConfig.bootTab !== false) createTab(url || HOMEPAGE)`. **Runtime proof is leg 4's**; this
      leg pins the code shape (masked scan: the restore branch calls `resolveRestoreContainer` + `createTab`,
      `continue`s on a null container, and references **no** `restoreHistory` and **no**
      `inheritContainerFromPartition` on this path).
- [ ] **AC5b — the deleted-jar-drop rule is a both-directions unit pin (extraction).** New pure
      `src/shared/restore-container.js` `export function resolveRestoreContainer(jarId, containers)`
      returning `containers.find(c => c.id === jarId) || null`. `renderer.js` imports it. Unit test in
      `test/unit/restore-container.test.js`: a known `jarId` → the matching container (**reading 1**);
      an unknown `jarId` → **`null`, NOT a default** (**reading 2**); empty `containers` → `null`. This
      converts the privacy-critical drop rule from a source-scan into a real unit pin — the same rigor
      leg 2 applied by factoring `resolvePersistJar`.
- [ ] **AC6 — default-OFF startup is behaviorally byte-identical (the absolute constraint).** With the
      setting `false`: the `whenReady` path calls the unchanged single `createWindow()` (never the rebuild
      branch — `read()` is not called), and **neither** write site fires. **Precise claim:** `load()` runs
      **unconditionally** (AC2) but is **behaviorally inert** when off — the loaded snapshot is never read
      and nothing is written; for a user who never enabled restore, `session.json` never exists so `load()`
      does zero read. So the guarantee is *behavioral* byte-identity (same single window, same boot tab, no
      rebuild, no write), **not** literally "zero file I/O" (a stale file from a prior enable would be read
      by `load()` and then ignored). **Reading:** a masked source-scan asserting the **three behavioral
      touch points** — the `whenReady` `read()`, the `before-quit` `write()`, the `close` `write()` — are
      each guarded by `settings.get(<key>)`, and that the guard is **not** on `load()`; a mutation removing
      any of the three guards fails the scan. **Runtime byte-identity (off ⇒ no file written, same single
      window) is leg 4's** default-off row. The unit layer pins the guards; the runtime confirms the behavior.
- [ ] **AC7 — gates green.** `npm test` (state the delta), `npm run lint`, `npm run typecheck` — each
      **standalone**. The `settings.html` row is a **labeled** checkbox (a11y-safe); the authoritative
      `npm run a11y` runs on the **final** tree in leg 4 (Rec 1).

## Out of Scope

- Behavior tests / live rig / the E2E relaunch cycle — leg 4.
- Navigation history + window geometry restore — DD5.
- Strip-order beyond the manifest's array order (insertion-order fidelity — DD3 note).
- Closed-tab (reopen) stack persistence — DD-Scope.

## Verification Steps

1. Both readings per masked source-scan AC in the flight log; each `grep -c` standalone.
2. State explicitly which readings are code-shape pins vs. leg-4 runtime (no main-process harness).
3. `git status --porcelain` — only the intended files; no stray artifacts; no `session.json` committed
   (it is userData, never in the repo).

## Files Affected

- `src/main/settings-store.js` — the `restoreSession` default + validator (AC1).
- `src/renderer/pages/settings.html`, `src/renderer/pages/settings.js` — the toggle row + IIFE (AC1).
- `src/main/main.js` — `session-store.load` wiring (AC2), the two write sites (AC3), the `whenReady`
  rebuild + `createWindow` `restoreTabs` + `window-boot-config` (AC4).
- `src/renderer/renderer.js` — the boot-loop restore branch + `resolveRestoreContainer` import (AC5).
- `src/shared/restore-container.js` (new) — the pure `resolveRestoreContainer` helper (AC5b).
- Unit tests: `settings-store.test.js` (AC1 additions), `test/unit/restore-container.test.js` (new,
  AC5b, both directions), a `main.js`/`renderer.js` source-scan test for the wiring pins (new, e.g.
  `test/unit/session-restore-wiring.test.js` — AC2/AC3/AC4/AC5/AC6 masked scans).

## Line Budget (DD11 — CODE lines, comments excluded)

- `main.js`: **≤ +45 code** (est. ~20–25). `renderer.js`: **≤ +25 code** (est. ~11–13).
  `settings-store.js`: **≤ +6 code**. `settings.js`: **≤ +20 code**. `restore-container.js`: **≤ 5 code**.
  Exceed ⇒ stop and report.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (code-shape pins vs. leg-4 runtime stated honestly)
- [x] Tests passing (delta stated)
- [x] Update flight-log.md with leg progress entry (both readings per masked-scan AC)
- [x] Set this leg's status to `completed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (flight-end review + single commit per `/agentic-workflow`)
