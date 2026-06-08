# Flight Log: Wire Existing Controls (Shields + Home Page) into Settings

**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](flight.md)

## Summary
Flight `in-flight` (2026-06-08). Execution via `/agentic-workflow` (Developer + Reviewer crew; leg design
reviewed per leg; code review + commit batched after the last autonomous leg). Execution notes, decisions,
deviations, and anomalies appended here during the flight.

---

## Reconnaissance Report

Source artifact: the **Flight-5 debrief** (`../05-settings-page-shell/flight-debrief.md`, Action Items +
Recommendations) and the **mission Known Issues** (the Flight-4 "internal tab is freely web-navigable" item).
Each carried item walked against current `main` (post-v0.4.7):

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Internal-bridge **origin-check** before real IPC | `confirmed-live` | `src/preload/internal-preload.js` still exposes only `{ version: 1 }`; no sender verification anywhere | **This flight's hard prerequisite** (DD2, leg 2) |
| Promote `HOMEPAGE` to a persisted setting | `confirmed-live` | `src/renderer/renderer.js:5` `const HOMEPAGE = 'https://www.google.com'`; 5 call sites | This flight (DD4, leg 3) |
| `shields-changed` reaches only the chrome renderer | `confirmed-live` | `src/main/main.js` `shields-set`/`shields-pause` send to `mainWindow.webContents` only — not the guest | Fix in `shields-in-settings` (DD3, leg 4) |
| Graduate `menuController` to a unit-testable module + test | `confirmed-live` but **out of this flight's surface** | still an IIFE in `renderer.js`; this flight adds no menu consumer | **Defer** — pull in only when a 4th menu/popup consumer lands (Flight 7's pin system may; revisit there) |
| Author a `shields-internal-tab` behavior spec (Connection + Cookies on the internal tab) | `partially-satisfied` | the two HAT fixes (Connection label, fetchCookies race) already landed in Flight 5 (`renderer.js`); only the *standing gate* is missing | Fold a regression check into `settings-controls` / the verify leg rather than a separate spec |
| `buildSiteInfo` defensive `escapeHtml` on future string fields | `confirmed-live` (latent) | `renderer.js` `buildSiteInfo` escapes `host` only; counts are numbers | **Defer to Flight 7** (the pin work touches the site-info popup / "Site settings →" rewire) |
| `isInternalTab` string-literal coupling comment | `confirmed-live` (minor) | `renderer.js` `isInternalTab` + the `createTab` set-site | Opportunistic — fold into leg 2/3 if touching nearby, else Flight 7 |
| Retarget/branch hygiene (PR base) | `already-satisfied` | flights 4+5 merged to `main`; v0.4.7 released; branches pruned | Retired — no action |

**Carried into this flight**: the origin-check (leg 2), `HOMEPAGE` promotion (leg 3), the `shields-changed`
guest-sync fix (leg 4), and a Shields-on-internal-tab regression in verify. **Explicitly deferred to Flight
7**: `menuController` module graduation, `buildSiteInfo` escaping, `isInternalTab` comment — all sit on the
pin-system / site-info surface Flight 7 owns.

---

## Flight Director Notes

### 2026-06-08 — Flight start (execution)
- **Phase file**: `.flightops/agent-crews/leg-execution.md` loaded + validated (Crew / Interaction Protocol /
  Prompts present) — same well-formed file used for Flight 5. Crew: Developer (Sonnet), Reviewer (Sonnet,
  never Opus). Accessibility Reviewer present but disabled.
- **Branch**: `flight/6-wire-existing-controls` cut from `main` (now at `42f40da`, post-v0.4.7 — flights 4+5
  merged + released). No stacking this time; `main` is the base.
- **Planning baseline**: the Flight-6 planning artifacts (this flight dir, `tests/behavior/settings-controls.md`,
  the mission.md re-scope + Flight-7 addition) were uncommitted on `main` from the `/flight` session; committed
  as the flight-6 planning baseline at branch start.
- **Legs**: 6 autonomous + 1 optional HAT, per the flight order — settings-store → internal-bridge-secured
  (hard prereq) → home-page-setting → shields-in-settings → docs → verify-integration → hat-and-alignment.
  Store + bridge are the foundations (sequenced first); the two wirings follow.

### Planning
- **Split decision (operator):** the operator's ask grew past SC7 into (a) a *durable, secure* general
  settings store built now, and (b) a generic **pin/unpin** system for toolbar items (Media + Shields) with
  icon-in-toolbar-when-pinned / settings-only-when-unpinned, plus rewiring the site-info "Site settings →"
  link to the settings page. Agreed split: **Flight 6** = the store + origin-checked bridge + SC7 wiring
  (Shields + home page); **Flight 7** = the pin system + the "Site settings →" rewire (depends on this
  flight's store + settings Privacy section). Flight 7 to be added to the mission flight list.
- **"Secure" store (operator):** access-controlled + validated + atomic + schema-versioned now; **not**
  encrypted. The serialization seam is built pluggable (DD6) so safeStorage can be layered in **when a
  secrets manager is built** — additive, not now.
- **Pin defaults (operator, for Flight 7):** both Media + Shields default **pinned** (preserve today's UX);
  unpinned = **settings-only**.

---

## Decisions

### Per-leg design review skipped for the docs leg (leg 5)
**Context**: Legs 1–4 each got a Developer design-review pass. Leg 5 is **docs-only** (`README.md` /
`CLAUDE.md`) — no acceptance criteria to cross-reference against codebase state. Same call as Flight 5.
**Decision**: folded leg 5's review into the **flight-level Reviewer pass** (reviews the whole uncommitted
diff, docs included).
**Impact**: one fewer round-trip; doc accuracy still adversarially checked before commit.

---

## Deviations

_(none yet)_

---

## Anomalies

### Flight-6 form controls shipped as raw browser defaults (FIXED, HAT)
**Observed**: the Flight-5 settings shell was brand-styled, but the new Flight-6 controls (Shields fieldset/
checkboxes, home-page input + Save) rendered as unstyled browser defaults on the dark bg — surprisingly poor
(operator).
**Severity**: cosmetic (functional throughout).
**Resolution**: iterative `settings.css`/`settings.html` styling passes (all style/copy, offline gates stayed
211/211): brand-matched controls → native checkboxes restyled as the panel's **gold pill switches**
(`appearance:none` mirroring `.switch`) → panel model (label-left/toggle-right; **Shields** bold parent +
indented children; fieldset border removed, `legend` SR-only) → Save button un-bolded. Verified by
screenshot each pass. See the `hat-and-alignment` leg.

### "Per-site exceptions" copy was inaccurate (FIXED, HAT) — future feature recorded
**Observed**: the settings note "Per-site exceptions are managed from the Shields panel" overclaims — the
Shields toggles are **global** (settings page and panel are lock-step regardless of site); no per-site
override feature exists (only a coarse per-site pause).
**Severity**: cosmetic (misleading copy).
**Resolution**: changed to "These are global Shields defaults, applied to every site." The real **per-site
overrides (more-strict-only)** need is recorded in the **mission Known Issues** for a future flight (operator,
explicitly out of scope for Flight 6).

### `dev:debug` electronmon restarts on `settings.css`/`.html` edits (process note, not a defect)
**Observed**: during the HAT, each settings-page style edit triggered electronmon to restart the app,
resetting to a single tab at the persisted home page (`example.com`) — which incidentally re-confirmed
home-page persistence across restart. Required reopening Settings (or a guest reload) to see each CSS change.
**Severity**: none (dev-loop ergonomics).
**Resolution**: n/a — expected watcher behavior; noted for future HAT sessions on served internal-page assets.

---

## Session Notes

_(none yet)_

---

## Leg Progress

### 2026-06-07 — `settings-store` — LANDED

**Status**: landed

**Changes made:**
- `src/main/settings-store.js` (new) — Electron-free, durable, schema-versioned settings store.
  Exports `{ DEFAULTS, load, get, getAll, set }`. Module-scoped `dir`/`config`/`codec`; `load(userDataPath,
  opts?)` injects the path and pluggable `{ serialize, deserialize }` codec (defaulting to
  `JSON.stringify`/`JSON.parse`). `save()` writes atomically via temp file + `renameSync` (beside the target
  in `dir`, not `os.tmpdir()`, ensuring same-filesystem rename). `set(key, value)` validates before mutating,
  throws `Error` for set-before-load and `TypeError` for unknown keys / invalid values. `getAll()` returns a
  shallow copy. Per-key `VALIDATORS` map: `homePage` requires `isSafeTabUrl(v)` AND not `about:blank`.
  Save errors propagate; load errors fall back to defaults (never throws).
- `src/main/main.js` — added `const settings = require('./settings-store'); settings.load(app.getPath('userData'));`
  in `whenReady`, next to `shields.load()`. No behavior change; no reader yet (legs 2+).
- `test/unit/settings-store.test.js` (new) — 14 tests using `node:test` + `node:assert/strict`, real temp
  dirs (`fs.mkdtempSync`), no Electron stub. Covers: defaults on first load; set→persist→reload round-trip;
  atomic write produces valid JSON; corrupt-file repair → defaults (no throw); bad-field repair keeps valid
  siblings; `set` throws on `javascript:` / `goldfinch://` / `about:blank` and accepts `https://` (prior
  value kept on reject); unknown-key throws; set-before-load throws a clear error; `getAll()` returns a copy;
  version field present; custom-serializer round-trip.

**Offline gates:**
- `npm run lint` — green
- `npm run typecheck` — green
- `npm test` — **196/196 pass** (182 existing + 14 new settings-store tests)

### 2026-06-07 — `internal-bridge-secured` — LANDED

**Status**: landed

**Changes made:**
- `src/main/internal-ipc.js` (new) — Electron-free pure predicate + guarded-registration wrapper.
  Exports `{ INTERNAL_ORIGIN, isTrustedInternalSender, registerInternalHandler }`. `INTERNAL_ORIGIN =
  'goldfinch://settings'` (comment explains Chromium serialization vs. Node's misleading `'null'` output).
  `isTrustedInternalSender(origin, isInternalSession)` returns true only on exact origin match AND
  `isInternalSession === true` (strict, not truthy). `registerInternalHandler(ipcMain, channel, handler)`
  extracts `event.senderFrame?.origin` (null-safe) and the `event.sender.session.__goldfinchInternal` flag
  (full session path), throws 'forbidden: non-internal sender for …' on any mismatch.
- `src/main/main.js` — hoisted `const settings = require('./settings-store')` and
  `const { registerInternalHandler } = require('./internal-ipc')` to module scope (keeping `settings.load()`
  call inside `whenReady`). Registered `internal-settings-get` and `internal-settings-set` channels via the
  wrapper, backed by the settings store. Added a comment at the `shields-get`/`shields-set`/`shields-pause`
  handlers noting they are intentionally NOT behind the internal-sender guard (trust domain = file:// chrome).
- `src/preload/internal-preload.js` — replaced inert `{ version: 1 }` stub with the full origin-guarded
  bridge. When `location.origin === 'goldfinch://settings'` exposes `window.goldfinchInternal`:
  `{ version, settingsGet(key), settingsSet(key, value), onSettingsChanged(cb), onShieldsChanged(cb) }`.
  When origin does NOT match, exposes NOTHING — not even `version`.
- `eslint.config.mjs` — added a separate rule block for `internal-preload.js` with both `node` and `browser`
  globals (the sandbox:true + contextIsolation:true preload has `location` available; this was the only change
  needed to satisfy lint).
- `test/unit/internal-ipc.test.js` (new) — 14 tests using `node:test` + `node:assert/strict`, Electron-free.
  Predicate matrix: 8 cases covering the exact-match pass, false/truthy session fail, wrong/trailing-slash
  origin fail, null/undefined origin fail. Wrapper tests: 6 cases — trusted event forwards (returns value,
  forwards args); wrong origin rejects; null senderFrame rejects; missing session flag rejects; marker-on-sender
  (not session) rejects (catches `event.sender.__goldfinchInternal` extraction bug).

**Offline gates:**
- `npm run lint` — green
- `npm run typecheck` — green
- `npm test` — **210/210 pass** (196 + 14 new internal-ipc tests)

**Note:** Live round-trip (settingsGet/settingsSet from goldfinch://settings guest) and non-internal sender
rejection are deferred to leg 6 (need the running app). This leg proves the predicate offline + the wiring
by code-correctness.

### 2026-06-07 — `home-page-setting` — LANDED

**Status**: landed

**Changes made:**
- `src/renderer/renderer.js` — Added `let homePageCache = HOMEPAGE` and `function currentHomePage()` cache
  accessor next to the `HOMEPAGE` const. Changed `createTab` signature default from `url = HOMEPAGE` to
  `url = currentHomePage()`. Changed the three explicit `createTab(HOMEPAGE, ...)` call sites (container
  item click, burner click, `addContainer`) to `createTab(currentHomePage(), ...)`. Replaced the synchronous
  boot `createTab(HOMEPAGE)` with a race-safe async call:
  `window.goldfinch.settingsGet('homePage').then((url) => createTab(url || HOMEPAGE)).catch(() => createTab(HOMEPAGE))`.
  Added `window.goldfinch.onSettingsChanged(...)` subscription next to `onShieldsChanged` to keep
  `homePageCache` live on broadcast.
- `src/preload/chrome-preload.js` — Added `settingsGet(key)` (invoke `settings-get`) and
  `onSettingsChanged(cb)` (on `settings-changed`) to the `window.goldfinch` surface.
- `src/main/main.js` — Added `ipcMain.handle('settings-get', ...)` chrome-trusted channel (comment:
  same trust domain as `shields-get`, file:// chrome). Added `broadcastToChromeAndInternal(channel,
  payload)` helper with JSDoc describing its two-audience contract (chrome renderer sent separately
  because the `__goldfinchInternal` filter excludes it; leg 4 reuses for `shields-changed`). Modified the
  existing leg-2 `registerInternalHandler(ipcMain, 'internal-settings-set', ...)` lambda to broadcast
  `settings-changed` via the helper after a successful `settings.set()`.
- `src/renderer/pages/settings.html` — Replaced `#startup` placeholder `<p>` with a `<label>` +
  `<input id="home-page-input" type="url">` + `<button id="home-page-save">` + empty
  `<p id="home-page-status" role="status">`. No inline handlers (CSP-compliant).
- `src/renderer/pages/settings.js` — Added a home-page controller IIFE after the scroll-spy IIFE.
  Guards `if (!window.goldfinchInternal) return`. On load: populates the input via `settingsGet('homePage')`.
  Save button: calls `settingsSet('homePage', input.value)`, shows "Saved" on success or
  "Not saved: <message>" on rejection. Subscribes `onSettingsChanged` to reflect external changes.
- `src/renderer/renderer-globals.d.ts` — Added `settingsGet`/`onSettingsChanged` to `GoldfinchBridge`;
  added `GoldfinchInternalBridge` interface; added `goldfinchInternal?: GoldfinchInternalBridge` to
  `Window` interface.
- `src/main/session-augments.d.ts` — Added `__goldfinchInternal?: boolean` to the `Session` augment
  (used `@type {any}` cast at the one access site that tsc could not resolve via the augment module).

**Offline gates:**
- `npm run lint` — green
- `npm run typecheck` — green
- `npm test` — **210/210 pass** (no new unit tests; store + predicate already covered; renderer/settings/IPC
  behavior verified live in leg 6)

**Note:** Live take-effect (new tab opens to persisted home), persist-to-settings.json, validation error
display, and chrome+guest sync are all deferred to leg 6 (need the running app).

### 2026-06-07 — `shields-in-settings` — LANDED

**Status**: landed

**Changes made:**
- `src/main/main.js` — Replaced chrome-only `mainWindow.webContents.send('shields-changed', cfg)` in the
  existing `shields-set` and `shields-pause` handlers with `broadcastToChromeAndInternal('shields-changed', cfg)`
  so panel toggles now reach both the chrome renderer and any internal guest (the settings page). Added
  `internal-shields-get` and `internal-shields-set` channels via `registerInternalHandler` (origin-locked),
  backed by `shields.get()` / `shields.set()`; the set handler broadcasts `shields-changed` after every write.
- `src/preload/internal-preload.js` — Added `shieldsGet: () => ipcRenderer.invoke('internal-shields-get')` and
  `shieldsSet: (patch) => ipcRenderer.invoke('internal-shields-set', patch)` to the `window.goldfinchInternal`
  bridge (inside the `location.origin === 'goldfinch://settings'` guard, next to the settings methods).
  `onShieldsChanged` (leg 2) unchanged.
- `src/renderer/pages/settings.html` — Replaced the `#privacy` placeholder `<p>` with a `<fieldset>` grouping
  five labelled checkboxes: `shield-enabled` (Shields), `shield-block` (Block trackers), `shield-strip` (Strip
  tracking params), `shield-isolate` (Isolate 3rd-party cookies), `shield-farble` (Farble fingerprint). Added
  a note `<p>Per-site exceptions are managed from the Shields panel.</p>`. No inline handlers (CSP).
- `src/renderer/pages/settings.js` — Added a shields controller IIFE (after the home-page controller). Guards
  on `!window.goldfinchInternal`. `KEYS = ['enabled','block','strip','isolate','farble']`; `applyConfig(cfg)`
  assigns `.checked` directly (never `.click()` / `.dispatchEvent`, which would echo-loop). On load:
  `shieldsGet().then(applyConfig)`. Each checkbox `change` → `shieldsSet({ [key]: el.checked })`.
  `onShieldsChanged(applyConfig)` re-syncs on panel→settings direction.
- `src/renderer/renderer-globals.d.ts` — Added `shieldsGet()` and `shieldsSet(patch)` to the
  `GoldfinchInternalBridge` interface (required to satisfy typecheck).

**Offline gates:**
- `npm run lint` — green
- `npm run typecheck` — green
- `npm test` — **210/210 pass** (no new unit tests; shields store is already covered; wiring verified live in leg 6)

**Note:** Live two-way sync (settings ↔ panel), persistence to `shields.json`, and guest a11y sweep are
deferred to leg 6 (need the running app).

### 2026-06-07 — `docs` — LANDED

**Status**: landed

**Changes made:**
- `CLAUDE.md` — Four areas updated:
  - **Architecture section**: updated the `src/main/` bullet to reference `settings-store.js` and `internal-ipc.js`; updated the preload bullet to describe the full `window.goldfinchInternal` bridge surface and its `location.origin` defense-in-depth guard.
  - **New "Settings store" pattern section**: documents `settings-store.js` — Electron-free injected path, atomic temp+rename persistence, schema-versioned `DEFAULTS`, per-key `VALIDATORS` (including `homePage` excluding `about:blank`), pluggable `{ serialize, deserialize }` seam (DD6 / future safeStorage), safe-default repair, `userData/settings.json` location, and that it is the canonical home for app preferences. Also documents `homePageCache`/`currentHomePage()`, the `settings-get` chrome read channel (intentionally not behind `registerInternalHandler`), and the `broadcastToChromeAndInternal` two-audience fan-out (chrome + internal guests) for `settings-changed` and `shields-changed`.
  - **New "Internal-bridge security model" pattern section**: documents `registerInternalHandler` as the authoritative boundary (`event.senderFrame.origin === 'goldfinch://settings'` + `__goldfinchInternal === true` strict check; null senderFrame → reject); the Node-vs-Blink `INTERNAL_ORIGIN` gotcha; the preload `location.origin` guard as defense-in-depth only; the two separate trust domains (`internal-*` channels origin-locked vs chrome `shields-*`/`settings-get` on the `file://` trust domain); and that the Flight-4/5 "internal-bridge Known Issue" is now **closed**.
  - **Internal-tab navigation lock note**: updated to reflect that the origin-check **landed** in Flight 6 — the nav lock is the UX half, `registerInternalHandler` is the security half; both now present. Removed the "Flight-6 TODO" framing.
- `README.md` — Three areas updated:
  - **Overflow menu feature bullet**: replaced "controls are placeholder stubs until a later release" with a description of the working Privacy & Shields toggles and editable Home page, noting both are persisted and synced with the panel.
  - **Architecture table**: added rows for `src/main/settings-store.js` and `src/main/internal-ipc.js`; updated the `settings.html` row from "coming soon stub" to "wired and persisted."
  - **Internal pages prose section**: extended to describe the working Privacy & Shields checkboxes (global toggles, two-way sync, per-site pause stays in panel) and the Home page field (persisted to `settings.json`, invalid URLs rejected); noted that privileged IPC is gated at the main process by `registerInternalHandler`.

**Offline gates:**
- `npm run lint` — green (docs only; no source changes)

### 2026-06-08 — Flight review + checkpoint commit (Phase 2d)
- **Offline sweep (integrated, post leg-5)**: lint + typecheck clean; `npm test` 210/210.
- **Flight-level Reviewer** (Sonnet, fresh context) reviewed the full diff vs the planning baseline
  (`1cae9cd`) against all five legs + security. Verdict **[HANDOFF:confirmed]** — no blocking issues. One
  non-blocking precision finding: the bridge wrapper pre-coerced the session marker with `!!` before the
  predicate's strict `=== true`. **Fixed pre-commit** (raw value flows to the predicate; added a wrapper test
  with `__goldfinchInternal:1 → reject`). Tests now **211/211**.
- **Checkpoint commit** `79c93f1`: legs 1–5 + the hardening (code + docs + artifacts). Legs kept `landed`,
  flight `in-flight` — leg-6 live verification + leg-7 HAT gate the landing.

### 2026-06-08 — `verify-integration` — LANDED (live, Flight-Director-driven)
**Status**: landed

App launched fresh with the Flight-6 code on CDP `:9222`; driven via `scripts/cdp-driver.mjs` + node-CDP
guest attach + filesystem reads (`userData/{settings,shields}.json`); `chrome-devtools` MCP NOT used.

- **`settings-controls` behavior test — PASS** (run log `tests/behavior/settings-controls/runs/2026-06-07-21-23-58.md`;
  spec → `active`): controls present + full bridge surface; **Shields** flip from settings → `shields.json`
  persisted → chrome panel reflects (settings→panel); panel "Block" click → guest checkbox + `shields.json`
  reflect (panel→settings) — **two-way sync both directions**; **home page** set from settings → "Saved" →
  `settings.json` `{version:1,homePage:"https://example.com/"}` → **new tab opened to it** (take-effect);
  **invalid** `javascript:` rejected with the store's `TypeError` surfaced in the UI, `settings.json`
  unchanged.
- **Origin-check security — PASS**: `window.goldfinchInternal` undefined in a web tab; the chrome **page**
  context has no `ipcRenderer`/`require`/`settingsSet` → cannot reach `internal-*` channels; main-side check
  unit-tested (mandatory wrapper test). **In-session vector not driven** (hard post-Flight-5 lock) — asserted
  structurally + unit-tested, **gap logged per DD5**. The Flight-4/5 internal-bridge Known Issue is **closed**
  for all drivable vectors.
- **a11y — PASS**: `npm run a11y` (chrome) + `--target=goldfinch://settings` (guest, wired controls) both no
  NEW violations (the `<fieldset>/<legend>` + labelled input held).
- **Regression — PASS**: `tab-scheme-guard` core (web `window.open('goldfinch://…')` → internal tab count
  unchanged at 1); settings shell intact (guest a11y attached + ran).
- **SC7 + SC8 verified.** Offline 211/211. No remediation needed.

### 2026-06-08 — `hat-and-alignment` — COMPLETED (operator-confirmed)
**Status**: completed

Guided HAT on the live app. Functionality sound; findings were styling/copy of the Flight-6 controls — all
fixed inline (style/copy only; offline gates stayed 211/211) + re-verified by screenshot (see Anomalies):
brand-styled the controls → native checkboxes restyled as the panel's **gold pill switches** → panel model
(label-left/toggle-right; **Shields** bold parent + indented children; border box removed, legend SR-only) →
Save un-bolded → corrected the inaccurate "per-site exceptions" note to "global Shields defaults." The real
**per-site overrides (more-strict-only)** need was recorded in the **mission Known Issues** (out of scope,
operator). **Flight lands.** All 7 legs complete; SC7 + SC8 verified.
