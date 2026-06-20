# Leg: downloads-page

**Status**: completed
**Flight**: [Downloads Surface](../flight.md)

## Objective

Build the **`goldfinch://downloads` internal page** — a new trusted internal page (`downloads.html/css/js`)
that renders the app-level downloads list with **live per-item progress**, the **full browser-parity
control set** (open file, show in folder, pause, resume, cancel, remove-from-list, retry) plus list-level
**"Clear now"** and the **"files aren't deleted" footer note** — wiring the **three single-origin
internal-seam widenings** so a second internal page exists, and the **main-process action handlers** the
controls invoke over the origin-checked internal-IPC pattern.

## Context

- **DD1** — surface = a new internal page in the `INTERNAL_PAGES` allowlist, served over the `goldfinch://`
  protocol handler under the internal CSP, opened as a trusted tab. **The internal seam is single-origin
  (`settings`) today** — three points hardcode `goldfinch://settings` and must widen to an internal-host
  **set/allowlist** for a second internal page to function.
- **DD4** — full per-item controls; **remove = history-only** (never touches disk); "Clear now" clears
  terminal records (in-progress stay); a footer note states files aren't deleted; retry re-issues
  `downloadURL` (a fresh download) for a failed/cancelled item.
- **DD3** — the page reads the **merged** view (`manager.listAll()`: in-memory in-progress + persisted
  terminal, deduped by id) and subscribes to **live** id-keyed `download-progress`/`download-done`
  broadcasts (already routed through `broadcastToChromeAndInternal` by leg 1).
- **Depends on leg 1** (landed): `DownloadsManager` (`register`/`update`/`finalize`/`listAll`/`remove`/
  `clear`/`flushInterrupted`), the module-scoped `downloadsManager` in main.js, the `liveDownloadItems`
  `Map<id, DownloadItem>` registry seam, and the id-keyed broadcasts.
- Accessibility is a flight-wide bar: the page must be keyboard-operable with **0 new WCAG A/AA
  violations** under `npm run a11y`.
- **Out of scope here**: the kebab/`Ctrl+J` entry point (leg 3), the `downloadsList` MCP tool (leg 4).
  This leg's deliverable is reachable by typing/navigating to `goldfinch://downloads` via the trusted
  path (which leg 1 doesn't provide an entry for — verify by temporarily opening it, or defer the
  live-open smoke to leg 3). The `isInternalPageUrl` widening here is what makes the trusted `createTab`
  path leg 3 adds actually resolve.

## Inputs

What exists before this leg runs:
- **Internal-page seam (settings is the only inhabitant):**
  - `src/main/main.js:51` `INTERNAL_PAGES` — host→pathname→absolute-file allowlist; only `settings`
    today. `:65` `resolveInternal = createResolver(INTERNAL_PAGES)`; `:86` `handleInternal` serves the
    allowlist under `INTERNAL_CSP` (`:71`, `default-src 'self'`). Adding a page is an explicit edit here.
  - `src/preload/internal-preload.js:20` — `if (location.origin === 'goldfinch://settings')` gates the
    **entire** `goldfinchInternal` bridge; a downloads page gets **no bridge** until this widens. The
    bridge uses an `on(channel,cb)→handle` / `off(handle)` pattern (`:36`-`:54`) for reload-safe
    listeners (cleaned up from a `pagehide` handler).
  - `src/main/internal-ipc.js:18` `INTERNAL_ORIGIN = 'goldfinch://settings'`; `isTrustedInternalSender`
    (`:31`) checks `origin === INTERNAL_ORIGIN && isInternalSession === true`. **Every** downloads-page
    IPC is refused as a non-internal sender until this accepts the downloads origin too.
    `registerInternalHandler` (`:54`) is the registration wrapper; settings/shields/automation channels
    use it (`main.js:871`-`:972`).
  - `src/shared/url-safety.js:109` `isInternalPageUrl` — hardcodes `parsed.host === 'settings'`. The
    `will-navigate` guard and the trusted `createTab` path both gate on this, so navigation to
    `goldfinch://downloads` is blocked until widened. (CLAUDE.md:88 prescribes exactly this widening.)
- **Page template:** `src/renderer/pages/settings.{html,css,js}` — the working pattern for an internal
  page: same-origin `<script>`/`<link>` only (CSP `default-src 'self'`, no inline), `window.goldfinchInternal`
  bridge usage, `on/off` listener handles with `pagehide` cleanup, dark/gold chrome styling.
- **Leg-1 seams (main.js):** module-scoped `downloadsManager`; `liveDownloadItems` `Map<id, DownloadItem>`;
  id-keyed `download-progress`/`download-done` broadcasts via `broadcastToChromeAndInternal` (`main.js:798`).
- **Reuse:** `shell.showItemInFolder` (existing `show-item-in-folder` IPC, `main.js:593` — leg 1 shifted
  it from `:550`); `shell.openPath` (new, for "open file"); `DownloadItem.pause()`/`.resume()`/`.cancel()`;
  `downloadURL` for retry.
- **NOTE — leg 1 shifted main.js ~43 lines.** Post-leg-1 current lines: `show-item-in-folder` →
  `main.js:593`, `broadcastToChromeAndInternal` → `main.js:841`. `INTERNAL_PAGES:51`, `handleInternal:86`,
  and the `registerInternalHandler` block `871`-`972` are unchanged. The id-keyed broadcast payloads (leg
  1): **`download-progress` = `{ id, url, filename, state, received, total }`** (no `savePath`/`mime`);
  **`download-done` = `{ id, url, filename, state, savePath }`** (`savePath` null unless `completed`).

## Outputs

What exists after this leg completes:
- **`src/renderer/pages/downloads.html` / `downloads.css` / `downloads.js`** (new) — the internal page.
- **`src/main/main.js`** — `INTERNAL_PAGES` gains the `downloads` host entry; new internal-IPC handlers
  for list/actions; `shell.openPath` open-file handler; the live-item action wiring against
  `liveDownloadItems`.
- **`src/preload/internal-preload.js`** — origin gate widened to the internal-host **set**; new downloads
  bridge methods (`downloadsList`, the action calls, `onDownloadsChanged`/`offDownloadsChanged`).
- **`src/main/internal-ipc.js`** — `INTERNAL_ORIGIN` (single string) → an internal-origin **allowlist**;
  `isTrustedInternalSender` accepts any allowlisted internal origin.
- **`src/shared/url-safety.js`** — `isInternalPageUrl` accepts an internal-host **set**.
- **`CLAUDE.md`** — security note updated for a **second trusted internal origin** (downloads).
- **Tests** — `url-safety` internal-page test extended for `downloads`; `internal-ipc`
  `isTrustedInternalSender` test extended for the downloads origin (+ still-rejects-web-origin).

## Acceptance Criteria

- [ ] **Seam widening #1 (preload):** `internal-preload.js` exposes the `goldfinchInternal` bridge for
  **both** `goldfinch://settings` and `goldfinch://downloads` (origin ∈ an internal-origin set), and
  **nothing** for any other origin.
- [ ] **Seam widening #2 (main IPC):** `internal-ipc.js` exports an internal-origin allowlist (set/array);
  `isTrustedInternalSender(origin, isInternalSession)` returns true iff `origin` is in the allowlist
  **and** `isInternalSession === true`. A web origin (even on the internal session) and a non-internal
  session (even with an allowlisted origin) both return false. The existing settings/shields/automation
  channels still work.
- [ ] **Seam widening #3 (URL predicate):** `isInternalPageUrl` returns true for `goldfinch://downloads`
  (and `goldfinch://downloads/`) and still true for `settings`, false for web URLs and unknown
  `goldfinch://` hosts.
- [ ] **Page registered + served:** `INTERNAL_PAGES` has a `downloads` host entry mapping `/`,
  `/downloads.css`, `/downloads.js` to the new files; navigating a trusted tab to `goldfinch://downloads`
  renders the page under `INTERNAL_CSP` (no inline script/style; no CSP violations in the console).
- [ ] **List render (merged view):** the page calls a new internal-IPC `downloads-list` channel →
  `downloadsManager.listAll()` and renders every record with filename, state, and (for terminal) a size/
  status; in-progress records show a **live progress bar** updated from the subscribed broadcasts.
- [ ] **Live progress:** the page subscribes via a new `onDownloadsChanged` bridge (over the existing
  id-keyed `download-progress`/`download-done` broadcasts) and updates the affected row **by id** without
  a full reload; listeners are cleaned up on `pagehide` (the settings on/off-handle pattern).
- [ ] **Full per-item controls, each wired to a main-process handler, gated by record `state`:**
  - **Open file** → `shell.openPath(savePath)` (new IPC); **Show in folder** → existing
    `show-item-in-folder`/`shell.showItemInFolder`. **Both enabled only for `state === 'completed'`**
    — NOT keyed on savePath presence (in-progress records DO carry a real savePath, set before
    `register`, so opening a partially-written file must be prevented by the state gate).
  - **Pause** → `liveDownloadItems.get(id)?.pause()`; **Resume** → `.resume()`; **Cancel** → `.cancel()`
    — **in-progress (`progressing`/`paused`) rows only**; absent for terminal records.
  - **Remove from list** → `downloadsManager.remove(id)` (**history-only — never deletes the file**).
    **Available for TERMINAL records only.** For an in-progress row the user **cancels** (→ a `cancelled`
    terminal record), which is then removable. This avoids the silent-history-loss gap: removing a live
    item from the manager's memory while its `DownloadItem` is still running would make the eventual
    `finalize(id)` a no-op and the completed file would never enter history.
  - **Retry** (failed/cancelled terminal records only) → re-issue `downloadURL(originalUrl)` — a **fresh**
    download that registers through `wireDownloadHandler` and gets a **new id/new record**; the **old
    failed record stays visible** (the user sees both; DD3).
  - Action handlers **tolerate a missing/pruned id** (no-op, no throw — DD3 cache contract).
- [ ] **List-level "Clear now"** → `downloadsManager.clear()` (clears terminal records; in-progress
  stay), and a one-line **footer note** stating downloaded files are not deleted from disk (remove/clear
  affect history only).
- [ ] **Accessibility (HAT-verified — the harness can't reach internal pages):** the page is built
  keyboard-operable (controls reachable/operable by keyboard, logical focus order, visible focus,
  `aria-live` on the progress region or an equivalent announced update), to the same bar as the settings
  page. **`npm run a11y` audits the file:// chrome and CANNOT audit the internal session** (same
  exclusion that already prevents auditing `goldfinch://settings`) — so page-level a11y is **HAT-verified
  keyboard operability** (the `hat-and-alignment` leg), NOT an automated `npm run a11y` assertion on the
  page. `npm run a11y` must still show **0 new violations in the chrome sweep** (relevant once leg 3 adds
  the kebab item).
- [ ] **Trust boundary intact:** the new internal channels are registered with `registerInternalHandler`
  (origin + session checked); web content cannot invoke them. No web gate is relaxed.
- [ ] `node --test test/unit/*.test.js` passes (incl. extended `url-safety` + `internal-ipc` tests); `npm
  run typecheck` + `npm run lint` clean.

## Verification Steps

- `node --test test/unit/url-safety.test.js` — `isInternalPageUrl('goldfinch://downloads')` true,
  `settings` still true, web + unknown internal host false.
- `node --test test/unit/internal-ipc.test.js` (or the file holding the `isTrustedInternalSender` tests) —
  downloads origin + internal session → true; web origin → false; allowlisted origin + non-internal
  session → false.
- `node --test test/unit/*.test.js` — full suite green.
- `npm run typecheck` && `npm run lint` — clean.
- `npm run a11y` — 0 new violations in the **chrome** sweep (the harness cannot reach the internal
  downloads page; page-level a11y is HAT-verified — see the Accessibility AC). Do NOT spend time trying to
  point `a11y-audit.mjs` at `goldfinch://downloads`; it's internal-session-excluded like settings.
- Manual smoke (`npm run dev`, open `goldfinch://downloads` via a trusted tab): a completed download
  appears with Open/Show/Remove; trigger a live download and watch the progress bar + Pause/Cancel; click
  Remove → row disappears, **file still on disk**; "Clear now" empties terminal rows, in-progress stays;
  footer note visible; tab/enter through every control.

## Implementation Guidance

1. **Widen the three single-origin points first (smallest, highest-leverage, unit-testable).**
   - `src/shared/url-safety.js:109` — replace `parsed.host === 'settings'` with membership in an
     **internal-host set** (e.g. `const INTERNAL_HOSTS = new Set(['settings', 'downloads'])` near the
     top; `INTERNAL_HOSTS.has(parsed.host)`). Keep the `pathname === '/' || ''` clause. Preserve the
     dual CJS/global export tail.
   - `src/main/internal-ipc.js:18` — change `INTERNAL_ORIGIN` (single string) to an **allowlist** (e.g.
     `const INTERNAL_ORIGINS = new Set(['goldfinch://settings', 'goldfinch://downloads'])`); update
     `isTrustedInternalSender` to `INTERNAL_ORIGINS.has(origin) && isInternalSession === true`. Keep the
     Chromium-serialized-origin comment (the Node `new URL().origin === 'null'` gotcha still applies).
     Export the allowlist (some tests/callers may reference it). **Note the intended consequence:** any
     internal page can now call any `registerInternalHandler` channel — the trust boundary is
     "internal page vs web," not "settings vs downloads," consistent with the existing model. Document
     this in a comment.
   - `src/preload/internal-preload.js:20` — change the gate to expose the bridge when `location.origin`
     is in the internal-origin set. **Add the downloads methods to the same bridge** (they're harmless to
     the settings page, which never calls them, and main-side origin checks gate them regardless).
   - Update `CLAUDE.md` (the internal-page note around `:88` and the security paragraph above it) to
     state there are now **two** trusted internal origins (`settings`, `downloads`) and that
     `isTrustedInternalSender`/`isInternalPageUrl` are allowlist-based.

2. **Register the page in `INTERNAL_PAGES` (`main.js:51`).** Add a `downloads` host:
   ```js
   downloads: {
     '/': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.html'),
     '/downloads.css': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.css'),
     '/downloads.js': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.js')
   }
   ```
   No `handleInternal`/`createResolver`/CSP change needed — they're allowlist-driven already.

3. **Internal-IPC handlers (main.js, near the settings handlers ~`:871`), all via `registerInternalHandler`.**
   - `internal-downloads-list` → `downloadsManager.listAll()` (plain records; no live `DownloadItem`).
   - `internal-downloads-action` — **one dispatch channel `{ id, action }` with a main-side action
     allowlist** (`['pause','resume','cancel','remove','retry','open','show']`), mirroring the existing
     `page-context-action` allowlisted-dispatch pattern (CLAUDE.md) — one origin-checked surface, one
     validation point. Map:
     - `pause`/`resume`/`cancel` → `liveDownloadItems.get(id)?.[action]?.()` (no-op if absent).
     - `remove` → `downloadsManager.remove(id)`.
     - `retry` → look up the original url from the record by `id`, then issue
       **`mainWindow.webContents.downloadURL(url)`** directly. **Confirmed safe (cycle-2 review):**
       `mainWindow` has no `partition` in `webPreferences` (`createWindow`, `main.js:241`-`265`), so it
       uses `session.defaultSession`, which is download-wired at `main.js:1248`
       (`wireDownloadHandler(session.defaultSession)`). With no `pendingDownloads` meta, the download hits
       the DD5 silent default-save branch, registers through `wireDownloadHandler`, gets a **new id**, and
       the **old failed record stays** in the list (DD3). No fallback branch needed.
     - `open` → `shell.openPath(savePath)` (resolve `savePath` main-side from the record by id; do **not**
       trust a renderer-supplied path — look it up in the manager/store to avoid an arbitrary-open vector).
     - `show` → reuse the existing `show-item-in-folder` semantics, but resolve `savePath` by id main-side
       for the same reason (the existing `show-item-in-folder` takes a renderer path; for the internal
       page, prefer an id-keyed internal channel that resolves the path main-side).
   - `internal-downloads-clear` → `downloadsManager.clear()`.
   - **Security note:** resolve `savePath` from the trusted manager/store by `id` rather than accepting a
     path argument from the page, so "open file"/"show in folder" can't be coerced into opening an
     arbitrary path. Return enough in `downloads-list` for the page to render, but keep the actionable
     path server-side-resolved.

4. **Preload bridge additions (`internal-preload.js`).** **Append** to the existing `goldfinchInternal`
   bridge object (it has grown to carry settings/shields/automation methods through ~line 214; the
   `on/off`-handle machinery is still at `:36`-`:54`). Inside the (now widened) gate, add:
   - `downloadsList: () => ipcRenderer.invoke('internal-downloads-list')`
   - `downloadsAction: (id, action) => ipcRenderer.invoke('internal-downloads-action', { id, action })`
     (and `downloadsClear: () => ipcRenderer.invoke('internal-downloads-clear')`).
   - `onDownloadsChanged: (cb) => { const h1 = on('download-progress', cb); const h2 = on('download-done',
     cb); return [h1, h2]; }` and `offDownloadsChanged: (hs) => hs.forEach(off)` — OR a single combined
     handle scheme; reuse the existing `on/off` handle machinery (`:36`-`:54`). The page cleans up on
     `pagehide`.

5. **The page (`src/renderer/pages/downloads.{html,css,js}`).** Model it on the settings page:
   - **HTML**: same-origin `<link rel="stylesheet" href="downloads.css">` + `<script src="downloads.js">`
     (no inline — CSP forbids it). A semantic list region with an `aria-live="polite"` area for progress
     announcements, a heading, a "Clear now" button, and the footer note. Each row: filename, state/size,
     a progress bar for in-progress, and the control buttons (labelled, keyboard-focusable).
   - **JS**: on load, `await window.goldfinchInternal.downloadsList()` and render; subscribe via
     `onDownloadsChanged` and update the affected row **by id** (don't full-reload on every tick); wire
     each control to `downloadsAction(id, action)` / `downloadsClear()`; re-render or patch the row on
     action results; register `pagehide` cleanup of the listener handles.
   - **Live-payload gap:** `download-progress` carries no `savePath`/`mime` and `download-done`'s
     `savePath` is null unless `completed`. So a brand-new in-progress row first seen via a broadcast
     won't have full metadata. Handle it: when an event arrives for an **unknown id**, OR on
     `download-done`, **re-fetch `downloadsList()`** to backfill the row (savePath/size/state) rather than
     trusting the broadcast alone for actionable metadata. (Open/Show resolve savePath main-side by id
     regardless, so controls stay correct even if the row's displayed metadata lags by one fetch.)
   - **CSS**: dark/gold chrome consistent with settings; visible focus rings; progress-bar styling.
   - Disable/hide live-only controls (pause/resume/cancel) for terminal records and terminal-only controls
     (open/show/retry/remove) appropriately by state.

6. **Tests.** Extend `test/unit/url-safety.test.js` for the downloads host (true) + an unknown internal
   host (false). Extend the `isTrustedInternalSender` test for: downloads origin + internal session →
   true; web origin + internal session → false; allowlisted origin + non-internal session → false. (The
   page UI itself is HAT/a11y-verified, not unit-tested — internal-page DOM isn't in the unit harness.)

## Edge Cases

- **Pruned/finalized id between render and click:** action handlers no-op on a missing id (DD3); the page
  should refresh the row/list on a no-op result rather than show a stale control.
- **Retry of a record whose original url is gone/expired:** the fresh `downloadURL` will fail and surface
  as a new `interrupted` record — acceptable; don't special-case.
- **Open/Show gating:** disable Open/Show unless `state === 'completed'` (in-progress records carry a
  real but partial savePath — gate on state, not savePath null). For a completed record whose file was
  deleted on disk, `shell.openPath` returns a non-empty error string — surface a small inline notice,
  don't throw.
- **Remove on an in-progress row:** not offered (terminal-only). Cancel first → `cancelled` terminal
  record → then removable. Prevents the finalize-noop history-loss described in the AC.
- **CSP traps:** any inline handler/style will be blocked silently — keep everything external. Verify the
  console is clean of CSP violations.
- **Listener accumulation across electronmon reloads:** use the `on/off` handle + `pagehide` cleanup
  pattern (the settings page's reason for that machinery).
- **Cross-page bridge exposure:** the settings page now also receives the downloads bridge methods — they
  are inert there (it never calls them) and main-side origin-checked regardless; this is intended.

## Files Affected

- `src/renderer/pages/downloads.html` / `downloads.css` / `downloads.js` — **new** internal page.
- `src/main/main.js` — `INTERNAL_PAGES` downloads entry (`:51`); new `registerInternalHandler` channels
  (list/action/clear, near `:871`); `shell.openPath` open handler; action wiring against
  `liveDownloadItems` + `downloadsManager` + retry via `downloadURL`.
- `src/preload/internal-preload.js` — origin gate → internal-origin set (`:20`); downloads bridge methods
  + `onDownloadsChanged`/`offDownloadsChanged`.
- `src/main/internal-ipc.js` — `INTERNAL_ORIGIN` → allowlist (`:18`); `isTrustedInternalSender` allowlist
  membership.
- `src/shared/url-safety.js` — `isInternalPageUrl` host set (`:109`).
- `CLAUDE.md` — second trusted internal origin; allowlist-based predicates.
- `test/unit/url-safety.test.js`, `test/unit/internal-ipc.test.js` (or wherever `isTrustedInternalSender`
  is tested) — extended.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`, `npm run typecheck`, `npm run lint`)
- [ ] `npm run a11y` — 0 new violations
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 2 of 6)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

Citations verified against current code at leg design time; **2 drifted (repaired)** because leg 1's
just-landed `wireDownloadHandler` refactor shifted main.js ~43 lines:

- **`show-item-in-folder` — drifted `:550` → `:593`** (repaired in Inputs/Reuse).
- **`broadcastToChromeAndInternal` — drifted `:798` → `:841`** (repaired in Inputs/Reuse note).
- Clean: `internal-preload.js:20` (origin gate) + on/off machinery `:36`-`:54` (bridge object now extends
  to ~`:214`); `internal-ipc.js:18`/`:31`/`:54` (`INTERNAL_ORIGIN`, `isTrustedInternalSender`,
  `registerInternalHandler`); `url-safety.js:109` (`isInternalPageUrl` `host === 'settings'`);
  `main.js:51` (`INTERNAL_PAGES`), `:65` (`createResolver`), `:71` (`INTERNAL_CSP`), `:86`
  (`handleInternal`), `:871`-`:972` (`registerInternalHandler` channels); `CLAUDE.md` (the "adding an
  internal page" prescription + the second-trusted-internal-origin note to update).
- Leg-1 broadcast payload shapes confirmed: `download-progress = {id,url,filename,state,received,total}`,
  `download-done = {id,url,filename,state,savePath}` (savePath null unless completed). Leg-1 seams
  (`downloadsManager.listAll/remove/clear`, `liveDownloadItems`) are deliverables of the landed leg 1.
- **a11y reachability:** `npm run a11y` (`scripts/a11y-audit.mjs`) cannot audit the internal session;
  page-level a11y is HAT-verified (AC + Accessibility section updated accordingly).
