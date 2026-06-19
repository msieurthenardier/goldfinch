# Leg: spellcheck-enable

**Status**: completed
**Flight**: [Custom Page Context Menu + Spellcheck](../flight.md)

## Objective

Turn on **opt-in (default-OFF) in-field spellcheck** for web content, gated at the **session layer** so
the Settings toggle reaches **already-open tabs** without a reload. Add a `spellcheck` boolean to
`settings-store.js` `DEFAULTS` (default `false`; rides the existing merge-with-repair normalizer — **no
`SCHEMA_VERSION`/version bump, no migration**, only the `@typedef Settings` annotation gains the key for
typecheck). Toggle squiggles by calling `session.setSpellCheckerLanguages(['en-US'])` (ON) /
`setSpellCheckerLanguages([])` (OFF) on the **web sessions only** (`defaultSession`, the `PAGE_PARTITION
'persist:goldfinch'` session, and every later jar via the `session-created` hook) — **never** the
`__goldfinchInternal` session; set `webPreferences.spellcheck = false` on the **internal branch** of
`will-attach-webview` as defense-in-depth and leave the web branch at Electron's default. Add a Settings
**opt-in toggle** that writes through the existing internal-origin-gated settings-write path (the same
path the devtools-pin / shields toggles use — **NOT** a new chrome IPC). **First step: a premise-audit
(verify, don't assume)** of the Electron `^42` `webPreferences.spellcheck` default and whether
`setSpellCheckerLanguages` toggles squiggles on an **already-open** guest live. This leg enables the
**squiggles + dictionary only** — *suggestions* render inside the context menu in **Leg 4**
(`context-menu-component`). It produces **no MCP tool** (tool count stays 26, DD7).

## Context

- **DD1 (verbatim authority)** — Spellcheck is opt-in (default OFF), **gated at the SESSION layer so the
  toggle applies to already-open tabs**; on opt-in, accept the documented one-time CDN dictionary fetch.
  Add a `spellcheck` boolean to `settings-store.js` `DEFAULTS` (default `false`). It rides the existing
  merge-with-repair normalizer (`load()`; the `toolbarPins.devtools` precedent) — **no `SCHEMA_VERSION`
  bump, no migration**; only the `@typedef Settings` annotation gains the key (typecheck).
- **DD1 runtime-semantics fix (architect [HIGH])** — `webPreferences.spellcheck` is set once at
  `will-attach-webview` and is **immutable after attach** — gating on it would make a runtime toggle apply
  to *new tabs only*. Instead **gate at the session layer**: `session.setSpellCheckerLanguages(...)` is
  **session-scoped** and therefore reaches already-attached guests. ON → `setSpellCheckerLanguages(['en-US'])`
  on the **web sessions only** (`defaultSession`, `PAGE_PARTITION 'persist:goldfinch'`, + per-jar via the
  `session-created` hook); OFF → `setSpellCheckerLanguages([])`. **Never** the `__goldfinchInternal`
  session; set `webPreferences.spellcheck = false` on the **internal branch** of `will-attach-webview`
  (defense-in-depth), leave the web branch at Electron's default.
- **DD1 premise-audit (Leg-2 first step, don't assume)** — confirm (a) Electron `^42`'s
  `webPreferences.spellcheck` default for web guests, and (b) that `setSpellCheckerLanguages` toggles
  squiggles on an **already-open** guest without reload. Wire per the result. **Pre-authorized fallback:**
  if live application proves not to work, ship "applies to new tabs; reload to enable on open tabs" and
  document it in the toggle help + the behavior spec — do **NOT** silently leave the `spellcheck` behavior
  spec's "wait-for-squiggle" step failing on a pre-opt-in tab.
- **DD1 egress posture** — On Linux/Windows the first editable-focus after enabling triggers a one-time
  per-language Hunspell `.bdic` GET from the Chromium CDN (`redirector.gvt1.com/edgedl/chrome/dict/…`);
  **this egress is accepted and documented** in README privacy notes + CLAUDE.md (only after explicit
  opt-in). On macOS Electron uses the native `NSSpellChecker` — **no fetch**. Rationale: honors the mission
  constraint "spellcheck must not silently leak egress" — nothing fetches until opt-in, then it's
  documented; session-layer gating makes the toggle live; zero installer growth, zero new deps. **The
  actual README + CLAUDE.md doc edits land in Leg 6 (`verify-integration`), NOT here** — this leg only
  *implements* the behavior and records the egress that Leg 6 must document (see the Leg-6 boundary note
  below).
- **Leg-1 dependency / hand-off** — Leg 1 (landed) confirmed the guest `context-menu` event carries
  `misspelledWord` / `dictionarySuggestions` in its `params` (spike POSITIVE on both sides;
  `src/main/main.js:435`), and forwards the **whole** `params` to the chrome renderer. Those suggestion
  fields are populated **only when spellcheck is ON and the dictionary has loaded** — Leg 1 observed them
  empty precisely *because spellcheck was OFF*. This leg flips that ON; **Leg 4** then renders the
  suggestions section in `#page-context-menu` and round-trips a chosen suggestion through the
  `page-context-correct` → `replaceMisspelling` channel Leg 1 already built. This leg renders **zero menu
  UI** — squiggles + dictionary only.
- **DD7** — No new MCP tools; tool count stays **26**. Spellcheck is page-driven, not agent-driven (mission
  SC8 exclusion). `mcp-tools.js` is untouched; `test/unit/automation-mcp-tools.test.js:76` (`assert.equal(
  tools.length, 26)`) stays green.

## Inputs

What exists before this leg runs:
- `src/main/settings-store.js` — `@typedef Settings` (`settings-store.js:28-37`); `DEFAULTS`
  (`:40-58`) with `toolbarPins`, `automationEnabled`, etc.; the **merge-with-repair `load()`** normalizer
  (`:189-210`: starts from `freshDefaults()`, loops `Object.keys(DEFAULTS)`, takes the stored value only if
  it passes a `VALIDATORS[key]` check — or, for a key **with no validator**, only if `typeof val ===
  typeof DEFAULTS[key]` (`:204`) — then applies any `NORMALIZERS[key]`). `VALIDATORS` (`:89-131`);
  `NORMALIZERS` (`:138-143`, only `toolbarPins`); `freshDefaults()` (`:69-77`); `set()` (`:286-301`, which
  rejects any key not `in DEFAULTS`). **The `toolbarPins.devtools` precedent (DD1-cited): a boolean was
  added to `DEFAULTS` with no version bump and no migration; the additive key is filled in for existing
  files by the merge loop.** A bare `spellcheck: false` boolean has **no validator** — it is accepted by
  the `typeof val === typeof DEFAULTS[key]` fallback at `:204` (both `'boolean'`), so it needs no
  `VALIDATORS`/`NORMALIZERS` entry (see Edge Cases for the truthy-coercion note).
- `src/main/main.js` — `will-attach-webview` (`:275-285`): the **internal branch** is `:276-281` (`if
  (params.partition === INTERNAL_PARTITION) { contextIsolation=true; nodeIntegration=false; sandbox=true;
  return; }`); the **web branch** is `:282-284` (`contextIsolation=false; sandbox=false;
  nodeIntegration=false;`). `webPreferences.spellcheck` is **not currently set on either branch** (Electron
  default applies).
- `src/main/main.js` — `PAGE_PARTITION = 'persist:goldfinch'` (`:28`); `INTERNAL_PARTITION` (the internal
  session partition).
- `src/main/main.js` — `app.on('session-created', (ses) => …)` hook (`:1103-1115`): if
  `creatingInternalSession`, marks `ses.__goldfinchInternal = true` and **returns early** (`:1109-1112`);
  otherwise calls `applyShields(ses)` + `wireDownloadHandler(ses)` (`:1113-1114`) — this is the per-jar
  hook every web session passes through.
- `src/main/main.js` — `app.whenReady()` session setup (`:1117-1136`): wires `session.defaultSession`
  (`:1120-1121`), `const pageSession = session.fromPartition(PAGE_PARTITION)` then wires it (`:1122-1124`),
  then creates the **internal** session under the `creatingInternalSession` flag (`:1130-1133`) — the
  internal marker `(internalSession).__goldfinchInternal = true` is `:1133` (also set in the hook at
  `:1110`).
- `src/main/main.js` — `applyShields(ses)` (`:676-…`): the "wire each web session once" precedent; it
  early-returns `if (ses.__goldfinchInternal)` (`:680`) and idempotency-guards via `ses.__goldfinchShields`
  (`:681-682`). The new spellcheck application mirrors this shape (web-only, idempotent, called from both
  `whenReady` and the `session-created` hook).
- `src/main/main.js` — `registerInternalHandler(ipcMain, 'internal-settings-set', async (_e, key, value)
  => …)` (`:808-821`): the **origin-gated** settings write path — guarded so `event.senderFrame.origin ===
  'goldfinch://settings'` AND the sender's session carries `__goldfinchInternal === true`. It does
  `settings.set(key, value)` → `broadcastToChromeAndInternal('settings-changed', settings.getAll())`
  (`:809-810`), and runs a **key-specific side-effect** for `automationEnabled` (`:817-819`:
  `await applyAutomationEnabledChange(value === true)`). This is the exact seam the spellcheck side-effect
  (drive the live session languages) hooks into — **no new IPC**.
- `src/preload/chrome-preload.js` — chrome read bridges: `settingsGet: (key) =>
  ipcRenderer.invoke('settings-get', key)` (`:36`) and `onSettingsChanged: (cb) => ipcRenderer.on(
  'settings-changed', (_e, all) => cb(all))` (`:37`). The chrome surface deliberately exposes **read-only**
  settings access (no chrome settings-write) — confirming the toggle must live on the Settings page, not
  the chrome.
- `src/preload/internal-preload.js` — the Settings-page bridge: `settingsGet: (key) =>
  ipcRenderer.invoke('internal-settings-get', key)` (`:64`); `settingsSet: (key, value) =>
  ipcRenderer.invoke('internal-settings-set', key, value)` (`:73`); `onSettingsChanged`/`offSettingsChanged`
  (`:82-85`). The Settings page writes via `settingsSet`.
- `src/renderer/pages/settings.html` — `#appearance` section (`:24-47`) with three `appearance-row`s
  (Media `:26-32`, Shields `:33-39`, DevTools `:40-46`), each a `<span>` label + a `pin-toggle` button. The
  shields checkboxes live in `#privacy` (`:48-58`: `#shield-enabled`/`#shield-block`/… `change`-wired).
- `src/renderer/pages/settings.js` — the **shields controller** IIFE (`:145-185`, the closest "boolean
  feature toggle" precedent: a `<input type="checkbox">` whose `change` writes via the internal bridge and
  whose `onShieldsChanged`/`pagehide` pattern re-syncs and tears down) and the **appearance-pins
  controller** IIFE (`:189-237`: `settingsGet('toolbarPins')` populate, `settingsSet('toolbarPins', next)`
  write, `onSettingsChanged`/`offSettingsChanged` two-way sync + `pagehide` teardown). Both IIFEs are
  guarded `if (!window.goldfinchInternal) return;`.
- `package.json` — `"electron": "^42.4.0"` (`:73`) — the version whose `webPreferences.spellcheck` default
  the premise-audit must confirm.
- `test/unit/automation-mcp-tools.test.js:72/76` — "returns exactly the 26 tools" / `assert.equal(
  tools.length, 26)` (the DD7 guard).

## Outputs

What exists after this leg completes:
- **Premise-audit result recorded** in `flight-log.md`: (a) the observed Electron `^42`
  `webPreferences.spellcheck` default for web guests, (b) whether `setSpellCheckerLanguages(['en-US'])` on
  an **already-open** guest's session lights up squiggles **without a reload**, and (c) the wiring decision
  that follows (live-toggle as designed, OR the pre-authorized "new-tabs-only; reload to enable on open
  tabs" fallback with the toggle-help + behavior-spec wording it requires). Method + raw observation noted.
- `src/main/settings-store.js` — `DEFAULTS.spellcheck = false`; the `@typedef Settings` annotation gains
  `spellcheck: boolean`. **No `version`/`SCHEMA_VERSION` bump, no migration, no new `VALIDATORS`/`NORMALIZERS`
  entry** (the boolean rides the typeof-match fallback). `freshDefaults()` carries it for free (it spreads
  `...DEFAULTS`).
- `src/main/main.js` — a small **web-session-only, idempotent** spellcheck applier (mirroring `applyShields`'s
  shape) that, given a session and the current `spellcheck` setting, calls `ses.setSpellCheckerLanguages(
  setting ? ['en-US'] : [])` and **skips the internal session** (`if (ses.__goldfinchInternal) return;`).
  Called for `defaultSession` + the `PAGE_PARTITION` session in `whenReady` and for every web jar in the
  `session-created` hook (the non-internal branch). `webPreferences.spellcheck = false` set on the
  **internal branch** of `will-attach-webview` (`:277-280` area, alongside the existing isolation flags);
  the **web branch** (`:282-284`) left at Electron's default.
- `src/main/main.js` — the `internal-settings-set` handler (`:808-821`) gains a **`spellcheck`
  side-effect** (mirroring the existing `automationEnabled` side-effect at `:817-819`): after the
  `settings.set` + broadcast, when `key === 'spellcheck'` it drives the live web sessions to match
  (`setSpellCheckerLanguages(value === true ? ['en-US'] : [])` on `defaultSession` + the `PAGE_PARTITION`
  session + every active web jar). This is what makes the toggle reach **already-open tabs** (the architect
  HIGH fix). (If the premise-audit fallback applies, this side-effect still writes the setting but the
  live drive is documented as new-tabs-only.)
- `src/renderer/pages/settings.html` — a `spellcheck` opt-in toggle in the `#appearance` section
  (mirroring an existing row: either a `pin-toggle`-style `aria-pressed` button or a shields-style
  `<input type="checkbox">` — match whichever existing pattern the implementer reuses; see Impl step 5).
  Label "Spellcheck" + help text noting the one-time dictionary download on opt-in (and, if the fallback
  applies, "reload open tabs to enable").
- `src/renderer/pages/settings.js` — a controller (a new IIFE or an extension of an existing one) that
  populates from `settingsGet('spellcheck')`, writes via `settingsSet('spellcheck', value)`, and re-syncs
  via `onSettingsChanged` with `pagehide` teardown — mirroring the shields/pins controllers.
- Tests: settings-store unit coverage for the `spellcheck` default (`false`) + a persistence round-trip +
  an "existing file with no `spellcheck` key loads with `spellcheck === false`" forward-compat assertion.
- **No new MCP tool**; tool count unchanged (still **26**, DD7).
- The accepted CDN egress + the macOS-native-no-fetch fact **recorded for Leg 6 to document** (README
  privacy notes + CLAUDE.md) — **no doc edit made in this leg**.

## Acceptance Criteria

- [x] **Premise-audit done & recorded** in `flight-log.md`: Electron `^42`'s `webPreferences.spellcheck`
  default for web guests confirmed `true` (live: web session defaults to `isSpellCheckerEnabled()===true`,
  `['en-US']`); the live-toggle on an already-open guest works at the **API level** (`setSpellCheckerLanguages`
  flips `isSpellCheckerEnabled` without reload), but **squiggle rendering was inconclusive-on-WSLg** (no
  underline in `capturePage`). Method + raw observation recorded; wiring decision = implement the
  session-layer design (correct at API level) + ship the conservative new-tabs-only user-facing wording +
  flag the open-tab squiggle for macOS/HAT.
- [x] `DEFAULTS.spellcheck === false` added with **NO `version` bump and NO migration**; a settings file
  written before this leg (no `spellcheck` key) loads with `spellcheck` auto-populated to `false` via the
  merge-with-repair loop. Verified by a settings-store unit test (forward-compat test).
- [x] The `@typedef Settings` annotation includes `spellcheck: boolean`; `npm run typecheck` passes.
- [x] **Session-layer gating** in place: ON → `setSpellCheckerLanguages(['en-US'])`, OFF →
  `setSpellCheckerLanguages([])` on the **web sessions only** — `defaultSession`, the `PAGE_PARTITION`
  session, **and** every later web jar via the `session-created` non-internal branch. The applier is
  idempotent (no once-guard, by design) and called from both `whenReady` (initial) and the hook (new jars).
- [x] The **internal `__goldfinchInternal` session is NEVER given a spellchecker language** (applier
  early-returns on it), **and** `webPreferences.spellcheck = false` is set on the internal
  `will-attach-webview` branch; the web branch is left at Electron's default (not forced).
- [x] The toggle side-effect drives **every live web session**: it enumerates
  `webContents.getAllWebContents()` (the `main.js` broadcast precedent), collects each non-internal web
  guest's distinct `wc.session` (deduped via a `Set`), and calls the applier on each, in addition to the
  two base sessions — so an already-open per-jar/container/burner tab is driven live. Internal session
  excluded. Verifiable by code inspection (the loop exists; internal excluded).
- [x] A **Settings opt-in toggle** exists in `#appearance` (`#spellcheck-enabled` native checkbox,
  keyboard-focusable, `<label>` accessible name "Spellcheck"), persists via the existing
  internal-origin-gated `settingsSet('spellcheck', value)` path (**no new chrome IPC**). Per the
  premise-audit (rendering inconclusive on WSLg), the **documented new-tabs-only fallback is shipped**:
  the toggle help text states "Applies to new tabs — reload open tabs to enable" and the Leg-6 `spellcheck`
  behavior spec must target a new/reloaded tab (no silently-failing wait-for-squiggle on a pre-opt-in open
  tab). Live-on-open-tab squiggle flagged for macOS/HAT.
- [x] **No fetch until opt-in** (by construction): no spellchecker language is set on any web session
  while `spellcheck` is OFF (the default) — `applySpellcheck(ses, false)` calls `setSpellCheckerLanguages([])`,
  and the internal session is never set at all. The dictionary GET can only happen after opt-in. (Network
  observation of the `.bdic` GET timing is macOS/HAT-authoritative; the probe's no-fetch was inconclusive
  as a positive proof due to dict caching.)
- [x] The accepted **CDN egress** (one-time per-language Hunspell `.bdic` GET from
  `redirector.gvt1.com`/Chromium CDN on Linux/Windows; macOS uses native `NSSpellChecker`, no fetch) is
  **recorded in `flight-log.md` for Leg 6 to document** in README privacy notes + CLAUDE.md — this leg
  makes **no** README/CLAUDE.md edit.
- [x] **No new MCP tool**; tool count unchanged — still **26** (DD7; `automation-mcp-tools.test.js`
  "returns exactly the 26 tools" green).
- [x] `npm test` (844 pass / 0 fail), `npm run typecheck`, and `npm run lint` all pass.

## Verification Steps

- **Premise-audit (FIRST, before any production wiring)**: with `npm run dev`, open a web tab and focus an
  editable field. (a) Inspect/temporarily log the guest `webPreferences.spellcheck` (or observe whether
  squiggles appear by default) to record Electron `^42`'s default. (b) From the main process, call
  `<webGuestSession>.setSpellCheckerLanguages(['en-US'])` against an **already-open** tab's session and type
  a misspelling — observe whether squiggles appear **without reloading**; then `setSpellCheckerLanguages([])`
  and confirm they clear. Record raw observations + the wiring decision in `flight-log.md`. If the live
  toggle does NOT work, switch to the pre-authorized new-tabs-only fallback and record the toggle-help +
  behavior-spec wording.
- **Default + forward-compat (unit)**: settings-store test — first load (no `settings.json`) →
  `get('spellcheck') === false`; load a config object that omits `spellcheck` → `get('spellcheck') ===
  false`; `set('spellcheck', true)` → reload → `true`.
- **Typecheck**: `npm run typecheck` (fails if the `@typedef` is left without `spellcheck`).
- **Toggle persists + reaches open tabs (manual / behavior-adjacent)**: `npm run dev`; open a web tab and
  type a misspelling (no squiggle, OFF by default); go to `goldfinch://settings` → Appearance → enable
  Spellcheck; **without reloading** the already-open tab, the misspelling gets a squiggle (live-toggle
  path) — OR, in the fallback, a new tab squiggles and the help text says reload-to-enable. Toggle OFF →
  squiggles clear. Quit + relaunch → the toggle state persists.
- **Internal never enabled**: navigate to a `goldfinch://` internal tab with spellcheck ON → confirm the
  internal session is not given a language (no spellcheck behavior on internal pages); inspect that the
  applier early-returns on `__goldfinchInternal` and the internal `will-attach-webview` branch sets
  `spellcheck = false`.
- **No fetch until opt-in (network)**: with spellcheck OFF, watch the network (DevTools / a proxy) on a
  fresh profile and confirm **no** `redirector.gvt1.com`/`.bdic` request fires while typing in an editable
  field. After opt-in (Linux/Windows), the one-time `.bdic` GET appears on first editable focus.
- **Tool count**: `npm run dev:automation` → still 26 tools; `npm test` confirms the
  `automation-mcp-tools.test.js` count assertion is green.
- `npm test` / `npm run typecheck` / `npm run lint`.

## Implementation Guidance

1. **Run the premise-audit FIRST** (before any production wiring) — this is the DD1 Leg-2 first step.
   Two facts to prove, not assume:
   - **(a) Electron `^42`'s `webPreferences.spellcheck` default for web guests.** Observe whether a fresh
     web tab squiggles misspellings with no code change (Electron's documented default is `true`, but the
     mission's egress constraint means we must *know*, not infer — DD1 says verify). Record the observed
     default.
   - **(b) Live toggle on an already-open guest.** From the main process, grab a web guest's session and
     call `ses.setSpellCheckerLanguages(['en-US'])`, then type a misspelling in an editable field on a tab
     that was **already open** before the call. Does the squiggle appear **without reloading**? Then
     `setSpellCheckerLanguages([])` and confirm it clears live.

   Record raw observations + the wiring decision in `flight-log.md`. **Pre-authorized fallback (DD1):** if
   the live toggle does NOT work on open tabs, ship "applies to new tabs; reload to enable on open tabs",
   put that wording in the toggle help text AND in the `spellcheck` behavior spec (so Leg 6's spec does not
   leave a "wait-for-squiggle" step failing on a pre-opt-in open tab). Do **NOT** silently leave a failing
   behavior-spec step. (If the audit shows squiggles are ON by default regardless of language list, the
   gating model still holds — `setSpellCheckerLanguages([])` is the documented OFF state; record exactly
   what you observe.)

   **Distinguish "observed not to work" from "could not observe" (design-review [low]).** The audit runs on
   WSLg, where squiggle *rendering itself* may be unreliable. If you cannot get squiggles to render at all
   under WSLg (so neither the default nor the live-toggle behavior is observable), record that as
   **inconclusive-on-this-platform** — NOT as a clean pass and NOT as a confirmed failure. Route an
   inconclusive result to the **same documented new-tabs-only fallback wording** (conservative) and flag the
   live-toggle path for macOS/real-display HAT confirmation, so the behavior spec never carries a step that
   silently fails on the dev platform. A silent "couldn't see it, assumed it works" pass is the failure mode
   to avoid.

2. **settings-store.js — add the default.** Add `spellcheck: false` to `DEFAULTS` (`:40-58`), e.g. after
   `toolbarPins`. Add `spellcheck: boolean` to the `@typedef Settings` (`:28-37`). **Do NOT** bump
   `version` and **do NOT** add a `VALIDATORS`/`NORMALIZERS` entry: a bare boolean has no validator and is
   accepted by the `typeof val === typeof DEFAULTS[key]` fallback in `load()` (`:204`), exactly like the
   `automationEnabled` pattern but without even needing the strict-boolean validator. `freshDefaults()`
   (`:69-77`) spreads `...DEFAULTS`, so it carries `spellcheck` for free — no edit there. This is the
   `toolbarPins.devtools` precedent applied to a top-level boolean: additive key, no migration. **Tests:**
   add a settings-store test for the `false` default + a persistence round-trip + a "config missing
   `spellcheck` loads with `false`" forward-compat assertion. Check whether any existing
   `test/unit/settings-store.test.js` assertion `deepEqual`s the **whole** config / `getAll()` snapshot
   (e.g. the `getAll` shallow-copy test ~`:250-266`) — if one does, it must gain `spellcheck: false` or
   `npm test` breaks (this is the failure mode Leg 2 of Flight 3 hit with `devtools`). The per-key
   `toolbarPins` assertions do not touch `spellcheck`.

3. **main.js — the web-session-only spellcheck applier.** Add a small idempotent helper near `applyShields`
   (`:676`), mirroring its web-only shape:
   ```js
   // Spellcheck is opt-in and gated at the SESSION layer (DD1 architect [HIGH]): setSpellCheckerLanguages
   // is session-scoped, so it reaches already-attached guests (webPreferences.spellcheck is immutable
   // after attach). Web sessions only — NEVER the internal session (goldfinch:// has no business
   // spellchecking, and we never want it to trigger the dictionary CDN fetch).
   function applySpellcheck(ses, enabled) {
     if (!ses || ses.__goldfinchInternal) return;          // DD1: never the internal session
     ses.setSpellCheckerLanguages(enabled ? ['en-US'] : []);
   }
   ```
   **Idempotency note (design-review suggestion):** unlike `applyShields` (which must wire `webRequest`
   hooks exactly once and therefore carries a `ses.__goldfinchShields` guard), `setSpellCheckerLanguages` is
   **naturally idempotent** — re-calling it on `whenReady` + every toggle + every `session-created` is
   harmless. Do **NOT** add a `ses.__goldfinchSpellcheck` once-guard by pattern-matching `applyShields`; a
   one-line comment to that effect prevents a future reader from adding a needless guard.
   Read the current `spellcheck` setting via `settings.get('spellcheck')` at call time. **Wire the initial
   state in `whenReady`** (`:1117-1136`), right where `defaultSession` and the `PAGE_PARTITION` session are
   set up (`:1120-1124`): `applySpellcheck(session.defaultSession, settings.get('spellcheck'))` and
   `applySpellcheck(pageSession, settings.get('spellcheck'))`. **Wire new jars in the `session-created`
   hook** (`:1103-1115`) on the **non-internal branch** (after `applyShields(ses)` at `:1113`):
   `applySpellcheck(ses, settings.get('spellcheck'))`. The internal early-return in the hook (`:1109-1112`)
   already prevents the internal session reaching this, and the helper's own `__goldfinchInternal` guard is
   belt-and-suspenders. **Confirm `settings` is loaded before these calls** — `initProfileAndStores`
   (`:1118`) runs first in `whenReady`, so `settings.get` is safe there; in the hook, guard against an
   early `session-created` before stores load (read defensively, default OFF).

4. **main.js — internal `will-attach-webview` defense-in-depth.** In the **internal branch** (`:276-281`),
   add `webPreferences.spellcheck = false;` alongside the existing `contextIsolation`/`nodeIntegration`/
   `sandbox` flags (before the `return`). **Leave the web branch (`:282-284`) at Electron's default** — do
   NOT set `spellcheck` there (the session-layer applier owns the web toggle; forcing it here would be the
   immutable-after-attach trap DD1 warns about).

5. **The Settings opt-in toggle.** The Settings page is `goldfinch://settings` (`__goldfinchInternal`), so
   the write goes through the **existing** internal-origin-gated path — `window.goldfinchInternal.settingsSet(
   'spellcheck', value)` → `internal-settings-set` (`main.js:808`). **Do NOT add a new chrome IPC** (the
   chrome surface is read-only: `chrome-preload.js:36-37` exposes only `settingsGet`/`onSettingsChanged`).
   Mirror an existing Settings toggle — the two precedents are both in `src/renderer/pages/settings.js`:
   - the **shields checkbox** controller (`:145-185`) — a `<input type="checkbox">` whose `change` writes
     via the internal bridge; or
   - the **appearance-pins** controller (`:189-237`) — `aria-pressed` `pin-toggle` buttons writing
     `settingsSet`.
   Either pattern is fine; pick the one whose markup best fits a single on/off feature toggle (a checkbox
   reads most naturally for "Spellcheck on/off"). Add the markup to `settings.html` `#appearance`
   (`:24-47`) — a new `appearance-row` (or a labelled checkbox row) with an accessible name "Spellcheck"
   and help text noting the one-time dictionary download on opt-in (and, if the fallback applies,
   "reload open tabs to enable"). Add the controller IIFE in `settings.js` mirroring the chosen precedent:
   guard `if (!window.goldfinchInternal) return;`, populate from `settingsGet('spellcheck')`, write on
   change via `settingsSet('spellcheck', value)`, re-sync via `onSettingsChanged` with `pagehide` teardown
   (the Settings page DOES reload, so the `pagehide` removal matters — see the shields/pins precedent).

6. **main.js — the live side-effect (what makes the toggle reach open tabs).** In the `internal-settings-set`
   handler (`:808-821`), mirror the existing `automationEnabled` side-effect (`:817-819`): after
   `settings.set` + the `settings-changed` broadcast, add a `spellcheck` branch that drives **every live
   web session**, not just the two base sessions.

   **Why this must enumerate, and why the shields analogy is misleading (design-review [HIGH]).** Shields
   never re-drives open sessions: `applyShields` registers `webRequest` hooks **once** per session and they
   lazily read global state (`shields.active(...)`) per request — which is why `internal-shields-set` only
   broadcasts and enumerates nothing. `setSpellCheckerLanguages` is the **opposite**: an imperative,
   per-session push with no lazy-read fallback. So driving only `defaultSession` + `pageSession` would leave
   an **already-open per-jar tab** (`persist:container:work`, `persist:container:banking`, a `burner:N`
   session, …) stale — squiggles would not flip live on it. That is exactly the architect-HIGH staleness
   hole the session-layer design exists to close, so the side-effect MUST reach every live web jar.

   **Concrete enumeration (the existing `main.js:781` precedent — do NOT invent a registry).** There is no
   standalone live-session registry in the codebase; jars are partition *definitions* (`jars.js`), and live
   sessions are only reachable through `webContents.getAllWebContents()` (the same iteration
   `broadcastToChromeAndInternal` uses at `main.js:781`). Collect the distinct `wc.session` of every
   non-internal web guest and apply to each:
   ```js
   if (key === 'spellcheck') {
     const enabled = value === true;
     // Base web sessions (always present).
     applySpellcheck(session.defaultSession, enabled);
     applySpellcheck(session.fromPartition(PAGE_PARTITION), enabled);
     // Every live web jar/container/burner session (already-open tabs). setSpellCheckerLanguages is an
     //   imperative per-session push (unlike shields' lazy webRequest hooks), so open per-jar tabs MUST be
     //   driven explicitly or they go stale. webContents.getAllWebContents() is the only live-session route
     //   (the main.js:781 broadcast precedent); applySpellcheck no-ops the internal session belt-and-suspenders.
     const seen = new Set();
     for (const wc of webContents.getAllWebContents()) {
       const ses = wc.session;
       if (!ses || ses.__goldfinchInternal || seen.has(ses)) continue;
       seen.add(ses);
       applySpellcheck(ses, enabled);
     }
     // The explicit base-session calls cover the no-open-tab case; the loop covers per-jar tabs; `seen`
     //   collapses the overlap (and the main-window chrome / devtools wc, which both resolve to defaultSession).
   }
   ```
   This is the **architect HIGH fix made live**: `setSpellCheckerLanguages` on the already-attached web
   sessions flips squiggles on open tabs without a reload. (If the premise-audit fallback applies, this
   branch still writes/persists the setting and applies to sessions, but the user-facing wording is
   new-tabs-only; record that in the log.) Confirm `webContents` is in scope in `main.js` (it is destructured
   from electron at `:3`).

7. **Document the egress — for Leg 6, NOT here.** Record in `flight-log.md` the exact egress facts Leg 6
   must document: on Linux/Windows the first editable-focus after opt-in triggers a one-time per-language
   Hunspell `.bdic` GET from `redirector.gvt1.com/edgedl/chrome/dict/…`; on macOS Electron uses the native
   `NSSpellChecker` (no fetch). Note that the doc edits land in **Leg 6 (`verify-integration`)** — README
   privacy notes + CLAUDE.md — so this leg and Leg 6 do not collide. **Make NO README/CLAUDE.md edit in
   this leg.**

8. **Do NOT** build any context-menu UI, suggestion rendering, or `#page-context-menu` node — that is
   **Leg 4** (which consumes Leg 1's forwarded `dictionarySuggestions` and the `page-context-correct`
   correction channel). **Do NOT** add an MCP tool (DD7). **Do NOT** touch the chrome preload's settings
   surface (keep it read-only).

## Edge Cases

- **CDN egress (accepted, opt-in only)** — On Linux/Windows the first editable-focus *after opt-in* makes a
  one-time per-language Hunspell `.bdic` GET to the Chromium CDN (`redirector.gvt1.com/edgedl/chrome/dict/…`).
  Nothing fetches while spellcheck is OFF (the default). Accepted per DD1; documented in Leg 6.
- **macOS native speller — no fetch** — On macOS Electron uses the native `NSSpellChecker`, so the `.bdic`
  CDN fetch does **not** occur there; squiggles + suggestions come from the OS dictionary. macOS suggestion
  verification is macOS-authoritative (per the flight); WSLg carries the squiggle + Linux-CDN-dict path.
- **macOS OFF-state is macOS-authoritative (design-review)** — the premise-audit is WSLg-only, so the OFF
  path's correctness on macOS is not audited here: it is unverified whether `setSpellCheckerLanguages([])`
  fully clears squiggles on macOS or whether the OS-level `NSSpellChecker` keeps an independent speller on.
  Treat "toggle OFF clears squiggles" on macOS as macOS-authoritative (same as the suggestion path) and
  flag it for the HAT / macOS verification — do not assert it green from WSLg.
- **`webPreferences.spellcheck` is immutable after attach** — this is why the toggle gates at the **session
  layer**, not at `will-attach-webview`. Setting `spellcheck` in the web `will-attach-webview` branch would
  make a runtime toggle apply to new tabs only (the architect HIGH trap) — so the web branch is left at
  Electron's default and `setSpellCheckerLanguages` does the live work.
- **Internal session never enabled** — the `applySpellcheck` helper early-returns on `__goldfinchInternal`,
  the `session-created` hook's internal branch returns before reaching the applier, and the internal
  `will-attach-webview` branch sets `spellcheck = false`. Three layers ensure `goldfinch://` pages never
  spellcheck and never trigger the dictionary fetch.
- **Pre-authorized new-tabs-only fallback** — if the premise-audit shows `setSpellCheckerLanguages` does
  NOT flip squiggles on an already-open guest, ship "applies to new tabs; reload to enable on open tabs":
  update the toggle help text AND the `spellcheck` behavior spec's wait-for-squiggle step so it targets a
  newly-opened (or reloaded) tab, never a pre-opt-in open tab. Record the decision in `flight-log.md`. Do
  not leave a behavior-spec step silently failing.
- **Truthy coercion on the boolean** — `spellcheck` has no strict-boolean validator (it rides the
  `typeof`-match fallback). The Settings toggle should write a real boolean (`!!checked` /
  `aria-pressed`-derived `true`/`false`); the `internal-settings-set` side-effect uses `value === true` so a
  non-boolean truthy value does not silently enable. If a strict guard is wanted for parity with
  `automationEnabled`, a one-line `VALIDATORS.spellcheck = (v) => typeof v === 'boolean'` is optional — note
  it but the typeof-fallback is sufficient and matches the leg's "no new validator" framing.
- **Early `session-created` before stores load** — a `session-created` event could fire before
  `initProfileAndStores`. Read `settings.get('spellcheck')` defensively (treat an unavailable store as
  OFF); `whenReady` re-applies the correct state to `defaultSession`/`pageSession` after stores load anyway.
- **Suggestions are Leg 4, not here** — enabling spellcheck makes `params.dictionarySuggestions` populate
  on the guest `context-menu` event (which Leg 1 already forwards), but **rendering** those suggestions and
  the correction round-trip UI is Leg 4. This leg's observable is the **squiggle**, not the suggestion menu.

## Files Affected

- `src/main/settings-store.js` — `DEFAULTS.spellcheck = false`; `@typedef Settings` gains `spellcheck:
  boolean`. (No version bump, no validator/normalizer, no migration.)
- `src/main/main.js` — `applySpellcheck` web-session-only helper; initial apply in `whenReady`
  (`defaultSession` + `PAGE_PARTITION` session); per-jar apply in the `session-created` non-internal
  branch; `webPreferences.spellcheck = false` on the internal `will-attach-webview` branch; the
  `spellcheck` live side-effect in the `internal-settings-set` handler.
- `src/renderer/pages/settings.html` — a Spellcheck opt-in toggle in `#appearance` (with help text).
- `src/renderer/pages/settings.js` — the spellcheck controller (populate/write/sync + `pagehide`
  teardown), mirroring the shields or appearance-pins precedent.
- `test/unit/settings-store.test.js` — `spellcheck` default + persistence round-trip + forward-compat
  assertion; update any whole-config `deepEqual`/`getAll` snapshot assertion that would break on the new key.
- `flight-log.md` — premise-audit result (default + live-toggle observation + wiring decision) + the
  accepted-CDN-egress note for Leg 6 + the Leg 2 progress entry.
- **NOT** touched here: `README.md`, `CLAUDE.md` (egress doc edits are Leg 6); `src/preload/chrome-preload.js`
  (read-only settings surface stays read-only); `mcp-tools.js` (no new tool, DD7).

---

## Post-Completion Checklist

*(Deferred-commit workflow: land the leg `in-flight`→`landed`, update the flight log, do NOT commit or
signal `[COMPLETE:leg]`/`[HANDOFF:review-needed]` — flight-level review happens after the last autonomous
leg.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` 844/0, `npm run typecheck`, `npm run lint`)
- [x] Update `flight-log.md` with the premise-audit result (Electron `^42` default + live-toggle
  observation + wiring decision), the accepted-CDN-egress note flagged for Leg 6 to document, and the
  Leg 2 progress entry (changes, deviations)
- [x] Set this leg's status to `landed` (deferred-commit workflow)

## Citation Audit

Citations verified against current code at leg design time. **The flight's `main.js` session line numbers
were stale** (the flight cited `whenReady` session setup `:1085-1102`, the `session-created` hook `:1071`,
and the internal marker `:1101`); the file has grown since the flight was drafted — all corrected below.
The `will-attach-webview` branch cites (`:276-281` / `:282-284`) are **confirmed exact**.

- `src/main/settings-store.js:28-37` — `@typedef Settings` (currently `version`, `homePage`, `toolbarPins`,
  `automationEnabled`, `automationKeyHashes`, `automationAdminKeyHash`, `automationPort`) — **OK** (gains
  `spellcheck: boolean`).
- `src/main/settings-store.js:40-58` — `DEFAULTS` (note `version: 1` at `:41` — additive boolean keys are
  added WITHOUT bumping it, per the inline comment `:46-47` "Additive keys — no schema version bump") —
  **OK**. `toolbarPins` carries `devtools: false` at `:43` (the DD1-cited precedent, added by Flight-3
  Leg 2 with no migration).
- `src/main/settings-store.js:69-77` — `freshDefaults()` (`...DEFAULTS` spread; deep-copies `toolbarPins`
  + `automationKeyHashes`) — **OK** (a top-level boolean rides the spread for free; no edit needed).
- `src/main/settings-store.js:89-131` — `VALIDATORS` (no `spellcheck` entry needed; the typeof fallback
  accepts a boolean). `:138-143` — `NORMALIZERS` (only `toolbarPins`; none needed for `spellcheck`). **OK.**
- `src/main/settings-store.js:189-210` — the merge-with-repair `load()` loop; `:204` `if (typeof val ===
  typeof DEFAULTS[key])` is the no-validator fallback that auto-accepts a stored `spellcheck` boolean and
  auto-fills the default for files that omit it — **OK** (this is the forward-compat mechanism; no migration).
- `src/main/settings-store.js:286-301` — `set()` rejects any key not `in DEFAULTS` (`:290-292`), so the
  Settings toggle's `settingsSet('spellcheck', …)` only works once `spellcheck` is in `DEFAULTS` — **OK**.
- `src/main/main.js:28` — `const PAGE_PARTITION = 'persist:goldfinch'` — **OK** (flight-cited, confirmed).
- `src/main/main.js:275-285` — `will-attach-webview`; **internal branch `:276-281`** (`if (params.partition
  === INTERNAL_PARTITION) { …; return; }`), **web branch `:282-284`** — **OK, exact** (flight's `:276-281`
  / `:282-284` confirmed verbatim). `webPreferences.spellcheck` is set on **neither** branch currently.
- `src/main/main.js:676-682` — `applyShields(ses)`: `if (ses.__goldfinchInternal) return;` (`:680`) +
  `__goldfinchShields` idempotency guard — **OK** (the web-only-applier shape `applySpellcheck` mirrors).
- `src/main/main.js:808-821` — `registerInternalHandler(ipcMain, 'internal-settings-set', …)`: `settings.set`
  + `broadcastToChromeAndInternal('settings-changed', …)` (`:809-810`); the `automationEnabled` key-specific
  side-effect `await applyAutomationEnabledChange(value === true)` (`:817-819`) — **OK** (the seam the
  `spellcheck` live side-effect mirrors; no new IPC).
- `src/main/main.js:1103-1115` — `app.on('session-created', (ses) => …)`: internal early-return
  `if (creatingInternalSession) { (ses).__goldfinchInternal = true; return; }` (`:1109-1112`); web branch
  `applyShields(ses)` + `wireDownloadHandler(ses)` (`:1113-1114`) — **CORRECTED** (flight cited the hook at
  `:1071`; it is now `:1103-1115`).
- `src/main/main.js:1117-1136` — `app.whenReady().then(() => …)`: `initProfileAndStores` (`:1118`),
  `defaultSession` wired (`:1120-1121`), `const pageSession = session.fromPartition(PAGE_PARTITION)` +
  wired (`:1122-1124`), internal session created under `creatingInternalSession` (`:1130-1133`), internal
  marker `(internalSession).__goldfinchInternal = true` at **`:1133`** (also set in the hook at `:1110`) —
  **CORRECTED** (flight cited the `whenReady` session setup `:1085-1102` and the internal marker `:1101`;
  now `:1117-1136` and `:1133`/`:1110`).
- `src/preload/chrome-preload.js:36` `settingsGet` / `:37` `onSettingsChanged` — **OK** (chrome read-only
  settings surface; confirms the toggle write must go through the Settings page, not the chrome).
- `src/preload/internal-preload.js:64` `settingsGet` / `:73` `settingsSet('internal-settings-set')` /
  `:82-85` `onSettingsChanged`/`offSettingsChanged` — **OK** (the Settings-page write/read/sync bridge).
- `src/renderer/pages/settings.html:24-47` — `#appearance` section (Media `:26-32`, Shields `:33-39`,
  DevTools `:40-46` rows); `#privacy` shields checkboxes `:48-58` — **OK** (the toggle's two markup
  precedents).
- `src/renderer/pages/settings.js:145-185` — shields-checkbox controller (boolean `change` → `shieldsSet`,
  `onShieldsChanged`/`pagehide`); `:189-237` — appearance-pins controller (`settingsGet`/`settingsSet(
  'toolbarPins')` + `onSettingsChanged`/`offSettingsChanged`/`pagehide`) — **OK** (the two controller
  precedents the spellcheck controller mirrors; both guarded `if (!window.goldfinchInternal) return;`).
- `package.json:73` — `"electron": "^42.4.0"` — **OK** (the version the premise-audit confirms the
  `webPreferences.spellcheck` default for).
- `test/unit/automation-mcp-tools.test.js:72` "returns exactly the 26 tools" / `:76` `assert.equal(
  tools.length, 26)` — **OK** (the DD7 no-new-tool guard; spellcheck adds none).
- **Leg-1 hand-off**: `src/main/main.js:425-440` — the guest `context-menu` listener (Leg 1) forwarding the
  whole `params` (incl. `misspelledWord`/`dictionarySuggestions`) — **OK** (confirms suggestions populate
  once this leg turns spellcheck ON; rendering is Leg 4).
- **Negative confirmation**: `grep -rn "spellcheck\|setSpellChecker" src/` returns nothing — no
  pre-existing spellcheck wiring; this leg is net-new. `grep -rn "spellcheck\|redirector.gvt1\|NSSpellChecker"
  README.md CLAUDE.md` returns nothing — the egress is undocumented today (Leg 6's to add).
