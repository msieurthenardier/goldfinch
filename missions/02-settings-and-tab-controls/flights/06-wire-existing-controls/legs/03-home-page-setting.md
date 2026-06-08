# Leg: home-page-setting

**Status**: landed
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](../flight.md)

## Objective
Promote `HOMEPAGE` from a hardcoded `renderer.js` constant to a **persisted, editable home-page setting**:
read it live from the store at startup (with the initial-tab race fix), edit it from the settings page's "On
startup" section over the secured bridge (validated), broadcast changes to both the chrome and the settings
guest, and have new tabs open to it.

## Context
- **DD4.** `HOMEPAGE` (`renderer.js:5`) is used at the createTab default + several call sites; the **initial
  tab opens synchronously at file end** (`renderer.js:1893` `createTab(HOMEPAGE)`), before any async store
  read could populate a cache — so the initial open must **await** the store, and the createTab signature
  default must read a **live cache** so every no-arg `createTab()` gets the current value.
- **Trust domains.** The settings **guest** writes via the leg-2 origin-locked `internal-settings-set`. The
  **chrome** (`file://`) cannot use that channel (origin guard), so it gets its **own** chrome-trusted
  `settings-get` channel (unguarded, exactly like the existing `shields-get` — web webviews have no
  `ipcRenderer`, so only chrome + the internal guest can reach IPC). The chrome **reads** the home page +
  **subscribes** to changes; it does not write it (no chrome home-page UI — that's the settings page).
- **Broadcast (DD3 fan-out, introduced here, reused by leg 4).** When the guest sets `homePage`, main
  broadcasts `settings-changed` to **both** `mainWindow.webContents` (chrome) **and** every internal-session
  `webContents` (the settings page) so all surfaces stay consistent. A small `broadcastToChromeAndInternal`
  helper is added here and reused in leg 4 for `shields-changed`.
- **Migration.** The store default `homePage` already equals the old constant (leg 1) — first run is
  behavior-identical. `HOMEPAGE` stays as the in-renderer **fallback** for the pre-load window.
- Leg-2 bridge already exposes `settingsGet`/`settingsSet`/`onSettingsChanged` on the guest's
  `window.goldfinchInternal`.

## Inputs
- `src/renderer/renderer.js` — `HOMEPAGE` const + createTab (`function createTab(url = HOMEPAGE, …)`) and its
  call sites: explicit `createTab(HOMEPAGE, c)` at the container/burner/jar opens; no-arg `createTab()` (new
  tab `+`, Ctrl+T, last-tab guard); the initial `createTab(HOMEPAGE)` at file end.
- `src/preload/chrome-preload.js` — the `window.goldfinch` surface (add `settingsGet` + `onSettingsChanged`).
- `src/main/main.js` — `settings` store (module scope, leg 2), `internal-settings-set` handler (leg 2),
  `mainWindow`, `webContents`, the internal-session `__goldfinchInternal` marker.
- `src/renderer/pages/settings.html` `#startup` section + `src/renderer/pages/settings.js` (currently
  scroll-spy only).

## Outputs
- Chrome reads/caches `homePage` (race-safe initial tab; live cache for all no-arg creates).
- `settings-get` chrome channel + `settings-changed` broadcast (chrome + guest) on home-page change.
- An editable, validated home-page control in the settings page "On startup" section.

## Acceptance Criteria
- [ ] **Chrome cache + race fix** (`renderer.js`): a `homePageCache` (init = `HOMEPAGE` fallback) +
  `currentHomePage()` accessor; createTab's signature default becomes `url = currentHomePage()`; the explicit
  `createTab(HOMEPAGE, …)` call sites use `currentHomePage()`. The **initial tab awaits the store**:
  `window.goldfinch.settingsGet('homePage').then((url) => createTab(url || HOMEPAGE))` replaces the
  synchronous `createTab(HOMEPAGE)` at file end. `window.goldfinch.onSettingsChanged((all) => { homePageCache
  = all.homePage; })` keeps the cache live. **The first tab at startup opens to the persisted home page**, not
  the compile-time default.
- [ ] **Chrome channel** (`main.js` + `chrome-preload.js`): `ipcMain.handle('settings-get', (_e, key) => key
  ? settings.get(key) : settings.getAll())` — chrome-trusted/unguarded **with a comment** that its trust
  domain is the `file://` chrome (like `shields-get`); `chrome-preload.js` exposes `settingsGet(key)` (invoke
  `settings-get`) + `onSettingsChanged(cb)` (on `settings-changed`).
- [ ] **Broadcast helper** (`main.js`): `broadcastToChromeAndInternal(channel, payload)` sends to
  `mainWindow.webContents` (guarded `!isDestroyed()`) **and** every `webContents.getAllWebContents()` whose
  `session.__goldfinchInternal` is true (guarded `!isDestroyed()`). Give it a **JSDoc** describing its
  two-audience contract (chrome `file://` renderer is sent separately because the `__goldfinchInternal` filter
  excludes it) — leg 4 reuses it for `shields-changed`. **MODIFY the existing leg-2
  `registerInternalHandler(ipcMain, 'internal-settings-set', …)` lambda** (do NOT add a second
  `ipcMain.handle('internal-settings-set', …)` — Electron throws "handler already registered"): after a
  successful `settings.set(key, value)`, call `broadcastToChromeAndInternal('settings-changed',
  settings.getAll())` and return the config.
- [ ] **Settings-page control** (`settings.html` `#startup` + `settings.js`): an editable home-page **input**
  with an associated `<label>` + a **Save** button + a `role="status"` message area (no inline handlers — CSP).
  `settings.js` populates it via `window.goldfinchInternal.settingsGet('homePage')`, saves via
  `settingsSet('homePage', value)`, shows **"Saved"** on success and a clear **error** on rejection (the
  bridge rejects an invalid/unsafe URL — surface it, don't drop it), and subscribes
  `onSettingsChanged((all) => …)` to reflect external changes. Keyboard-operable (native input + button).
  Guards `if (!window.goldfinchInternal) return;` defensively.
- [ ] **Take-effect**: after setting a new home page in settings, opening a new tab (`+`/Ctrl+T) opens to it
  (via the chrome cache updated by the `settings-changed` broadcast). Verified live in leg 6.
- [ ] **Validation**: an unsafe home page (`javascript:`, `goldfinch://…`, `about:blank`) is rejected by the
  store (leg 1) → the bridge `invoke` rejects → the settings page shows the error; `settings.json` keeps the
  prior value.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (210 — no new unit tests expected; the store +
  predicate are already covered; renderer/settings-page/IPC behavior is verified live in leg 6).

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Code read: createTab default = `currentHomePage()`; initial tab awaits `settingsGet`; all no-arg/explicit
  home sites read the cache; `settings-get` chrome channel + `settings-changed` broadcast to chrome + guest;
  settings page input/save/status wired with no inline handlers; validation error surfaced.
- **Deferred to leg 6 (live):** first tab opens to a persisted custom home; editing home in settings persists
  to `settings.json` + a new tab opens to it; invalid URL rejected with a visible error; chrome + guest both
  reflect a change.

## Implementation Guidance
1. **renderer.js**: add `let homePageCache = HOMEPAGE;` near the const; `function currentHomePage() { return
   homePageCache || HOMEPAGE; }`. Change `createTab`'s signature default to `url = currentHomePage()`. Replace
   the three explicit `createTab(HOMEPAGE, …)` with `createTab(currentHomePage(), …)`. Replace the final
   `createTab(HOMEPAGE)` with `window.goldfinch.settingsGet('homePage').then((url) => createTab(url ||
   HOMEPAGE)).catch(() => createTab(HOMEPAGE));`. Near the other `window.goldfinch.*` startup subscriptions,
   add `window.goldfinch.onSettingsChanged((all) => { if (all && all.homePage !== undefined) homePageCache =
   all.homePage || HOMEPAGE; });` (semantically-correct guard).
2. **chrome-preload.js**: add `settingsGet: (key) => ipcRenderer.invoke('settings-get', key)` and
   `onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_e, all) => cb(all))` to `window.goldfinch`.
3. **main.js**: add the chrome `settings-get` handler (comment: chrome trust domain, like `shields-get`); add
   `broadcastToChromeAndInternal`; in the leg-2 `internal-settings-set` handler, broadcast `settings-changed`
   after a successful set.
4. **settings.html** `#startup`: replace the placeholder `<p>` with a labelled input + Save button + status:
   `<label for="home-page-input">Home page</label> <input id="home-page-input" type="url"
   autocomplete="off" spellcheck="false" /> <button id="home-page-save" type="button">Save</button> <p
   id="home-page-status" role="status"></p>` (`type="url"` for intent/keyboard; `role="status"` starts
   **empty** so no phantom announcement on load).
5. **settings.js**: add a home-page controller (guard on `window.goldfinchInternal`): populate the input from
   `settingsGet('homePage')`; Save → `settingsSet('homePage', input.value).then(() => status='Saved').catch((e)
   => status = 'Not saved: ' + (e && e.message ? e.message : 'invalid URL'))`; `onSettingsChanged` → refresh
   the input. Keep the scroll-spy code intact.

## Edge Cases
- **Pre-load window**: until `settingsGet` resolves, `homePageCache` = `HOMEPAGE` (the const fallback) — any
  early no-arg create uses the fallback; the initial tab explicitly awaits, so it's correct.
- **`settingsGet` rejects/throws at startup** (shouldn't — chrome channel is unguarded): the `.catch(() =>
  createTab(HOMEPAGE))` keeps boot working.
- **Empty/invalid input on Save**: the store rejects → the bridge rejects → the status shows the error; the
  input keeps the typed (rejected) value so the user can fix it; `settings.json` unchanged.
- **`onSettingsChanged` before the input exists** (timing): guard for the element; the listener is additive.
- **Do NOT** let the chrome write `homePage` (no chrome UI for it); the settings page is the only writer (via
  the origin-locked bridge).
- **Do NOT** widen the internal bridge to the chrome or vice-versa — two channels, two trust domains.

## Files Affected
- `src/renderer/renderer.js` — homePageCache + currentHomePage + createTab default + call sites + race-safe
  initial tab + onSettingsChanged.
- `src/preload/chrome-preload.js` — `settingsGet` + `onSettingsChanged`.
- `src/main/main.js` — `settings-get` chrome channel + `broadcastToChromeAndInternal` + broadcast on
  `internal-settings-set`.
- `src/renderer/pages/settings.html` — `#startup` home-page control.
- `src/renderer/pages/settings.js` — home-page controller.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live take-effect/persist/validation deferred to leg 6)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
