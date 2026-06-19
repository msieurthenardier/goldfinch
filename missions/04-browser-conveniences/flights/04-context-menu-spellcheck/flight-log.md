# Flight Log: Custom Page Context Menu + Spellcheck

**Flight**: [Custom Page Context Menu + Spellcheck](flight.md)
**Mission**: [Standard Browser Conveniences](../../mission.md)

This log captures runtime decisions, deviations, and anomalies during execution.

## Reconnaissance Report

Source artifacts: the Flight-3 debrief (carry-forwards #2, #4, #5) + the mission SC6/SC3 + M02 Known
Issue. All items verified against current `main` at flight-design time.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| #2 inline-Electron-handler test seam | `confirmed-live` | No test file references `before-input-event`/`keydown` (grep `test/`); chrome keydown handler `renderer.js:~2256`, main `before-input-event` `main.js:357` | Extract a renderer-only pure `keydownToAction` mapper + unit tests (DD5); main-side stays inline + behavior-test net (Leg 5) |
| #4 migrate toolbar Unpin off native menu | `confirmed-live` (= core SC6) | Native menu `main.js:985-996`; renderer triggers `renderer.js:988/1567/1591`; preload bridge `chrome-preload.js:19` | Migrate to the custom component, retire the native handler (Leg 4 / DD4) |
| #5 `freePortInRange` flake | `confirmed-live` | `test/unit/automation-port.test.js` — `assert.equal(result, port+1)` contradicts its own comment claiming it tolerates the collision; reds the suite under parallelism (not a F3 regression) | One-line fix `assert.ok(result === null || result === port + 1)` (Leg 5 / DD5) |
| SC6 context-menu component | `confirmed-live` (greenfield) | No page-content `context-menu` handling today (native/OS); `menuController` `renderer.js:126-209` (3 consumers, inlined, DOM-coupled) | New guest-event→IPC path + `#page-context-menu` via menuController 4th consumer in place (DD2/DD3) |
| SC3 spellcheck | `confirmed-live` (greenfield) | Off today; enable at `will-attach-webview` web-branch `main.js:282-284` + `setSpellCheckerLanguages` in `app.whenReady` `main.js:1085-1102`; no `.bdic` bundled; `applyShields` webRequest hooks `main.js:660-743`; macOS native speller | Opt-in (default OFF), accept documented CDN fetch on opt-in (DD1) |

**Apparatus audit (both axes, at planning):** *Act* — the `click` MCP op supports `button:'right'`
(`input.js` `mouseClickEvents` → `sendInputEvent`), dispatching a **real** native `context-menu` event
with genuine `dictionarySuggestions`; `typeText` enters real misspellings. *Observe* — the menu renders
in the **chrome** renderer, read via `getChromeTarget` → `readDom`/`captureScreenshot`, plus the
forwarded `page-context-menu` params payload. Both axes feasible — no reactive test seam needed (DD8).

**Operator ratification (this planning):** spellcheck egress = **accept-CDN-on-opt-in** (default OFF);
`menuController` = **extend in place**; sizing = **one flight, 5 legs + optional HAT**; test seam =
**renderer pure mapper** + main-side behavior-test net. Carry-forwards #2/#5 folded into Leg 5; #4 is
core SC6 (Leg 4).

## Flight Director Notes

**2026-06-19 — Flight start (agentic-workflow).** Loaded crew phase file
`.flightops/agent-crews/leg-execution.md` (well-formed: Crew / Interaction Protocol / Prompts
present). Created feature branch `flight/04-context-menu-spellcheck`; flight `ready` → `in-flight`.
Execution order (dependency-driven): `context-menu-ipc` → `spellcheck-enable` → `keydown-test-seam`
→ `context-menu-component` (needs ipc) → `migrate-toolbar-unpin` (needs component) →
`verify-integration`, then optional `hat-and-alignment` (interactive). Per the agentic-workflow
batched model: each leg gets a per-leg design review (Developer), implementation lands uncommitted,
and a single Reviewer pass + commit is deferred until after the last autonomous leg.

**2026-06-19 — Leg 3 design-review note (numbering drift corrected).** The Leg-3 design review surfaced
that the flight's "Contributing to Criteria" cross-referenced the keydown-test-seam (#2) and the
`freePortInRange` fix (#5) as "Leg 5" — vestigial text from an earlier 5-leg sizing where the test seam
was the last leg. The architect later split it into its own leg landing 3rd (before
`context-menu-component`), so the live leg list places `keydown-test-seam` as Leg 3 and
`migrate-toolbar-unpin` as Leg 5. Corrected the two cross-references in `flight.md` to "Leg 3" to keep
the flight coherent; design intent unchanged.

**2026-06-19 — Leg 3 design decision (seam route).** Leg-3 design review [HIGH, style] flagged that the
draft presented the preload-bridge as the only route to surface the pure `keydownToAction` mapper to the
non-module `renderer.js`. `src/shared/` actually has a co-equal **dual-export + global `<script>`**
pattern (`url-safety.js`/`audit-paging.js`, consumed as bare globals in the renderer) that is the closer
fit for pure renderer-side logic and drops the bridge plumbing + the `renderer-globals.d.ts` edit.
Adopted the dual-export route; the mapper stays off the audited `goldfinch` preload surface (it is pure
logic, not a capability). Re-reviewed (2nd cycle) before landing.

**2026-06-19 — Flight review (single Reviewer over all uncommitted changes, Sonnet per crew).** All six
legs' acceptance criteria confirmed met against the actual code. Gates: `npm test` **879 pass / 0 fail**,
`npm run typecheck` clean, `npm run lint` clean, MCP tool count **26**. Security posture verified on all
four new IPC channels (`page-context-correct`, `page-context-action`, `chrome-clipboard-write`,
`unpin-toolbar-item`): each acts on the passed `wcId` (TOCTOU), refuses the internal session where
applicable, and is narrowly allowlisted — none is a general write-into-arbitrary-`webContents` primitive.
Context-menu wiring confirmed inside the `!__goldfinchInternal` guard; spellcheck never enables the
internal session; `toolbarPins` write is read-modify-write. Anonymization clean (pre-existing persona
references only; no new operator-path/username leaks). **Reviewer signalled `[HANDOFF:confirmed]`.**

**Two NON-BLOCKING quality findings (deferred to HAT / follow-up — not commit blockers):**
1. **Click-close focus return** — closing the page context menu by *clicking an item* (the common path)
   runs `onClose` only (not `focusReturn`), so for a **guest right-click** invocation focus returns to
   `document.body` rather than the active `<webview>` (the Escape/Tab path is correct via `focusReturn`).
   Minor UX; live-verifiable in the HAT (real-display focus behavior). Candidate one-line follow-up:
   have `onClose` apply the same guest→webview return that `focusReturn` does.
2. **"No suggestions" placeholder** — the disabled placeholder `div.cm-item` has `aria-disabled` but no
   `role`; correctly excluded from the roving `[role="menuitem"]` set, so functionally fine; cosmetic
   a11y-semantics polish only.

**Remaining acceptance before flight `completed` (carried to HAT + debrief):** the two behavior-test
specs (`page-context-menu`, `spellcheck`) are authored (`draft`) but **not yet executed** — the
Flight-Director-driven `/behavior-test` runs + the `npm run a11y` open-menu sweep + the macOS/HAT-authoritative
paths (squiggle render, native-speller suggestions, DevTools materialization, in-guest Shift+F10) are the
HAT's scope (WSLg can't render squiggles / drive the a11y harness non-interactively — consistent with
Legs 2/4/5). SC3/SC6 mission success criteria stay **unchecked** until those runs pass. The flight lands
code-complete + reviewed; the debrief (run via `/flight-debrief`) transitions it to `completed`.

## Leg Entries

### `context-menu-ipc` — Status: landed (2026-06-19)

**Spike (DD8) — POSITIVE on BOTH sides; full rich payload confirmed.**

Method: ran `npm run dev` under WSLg (GUI launched successfully — DISPLAY=:0, Wayland present).
Attached throwaway `console.log` listeners on BOTH sides — the guest
`contents.on('context-menu', …)` inside the `!__goldfinchInternal` guard, and the renderer
`wv.addEventListener('context-menu', …)` in `wireWebview`. Drove right-clicks via
`sendInputEvent({button:'right'})` against a crafted `data:` page with a link / image / editable
`<input>` / selectable paragraph (programmatic auto-driver gated on `GOLDFINCH_SPIKE=1`).

**Result: the `context-menu` event fires on BOTH the main-process guest `webContents` AND the
renderer `<webview>` tag**, for every target class, each carrying rich `params`. Raw observed
fields per target (guest side):

| Target | linkURL | imageURL/srcURL | mediaType | selectionText | isEditable | editFlags | misspelledWord / dictionarySuggestions | x/y |
|--------|---------|-----------------|-----------|---------------|------------|-----------|----------------------------------------|-----|
| Link   | `https://example.com/page` | — | `none` | "" | false | canSelectAll | "" / `[]` | populated |
| Image  | "" | `https://www.google.com/favicon.ico` | `image` | "" | false | canSelectAll | "" / `[]` | populated |
| Editable `<input>` | "" | — | `none` | "" | **true** | **canPaste:true** | "" / `[]` | populated |
| Selection | "" | — | `none` | **"selectable paragraph text here"** | false | **canCopy:true** | "" / `[]` | populated |

The `<webview>`-tag side carries a superset (`linkText`, `mediaFlags`, `hasImageContents`,
`formControlType` e.g. `"input-text"`, `selectionRect`, `spellcheckEnabled`, `frameCharset`, …) —
also fully rich. `misspelledWord`/`dictionarySuggestions` were empty here ONLY because spellcheck
is OFF (default; the dict + squiggles are Leg 2). The event itself surfaces those fields and will
populate them once Leg 2 enables `setSpellCheckerLanguages`.

**Wiring decision (DD2 primary design, NOT the DD8 acceptable variation): wire the GUEST
`webContents` side, main→IPC.** Both sides carry the full payload, but the guest side sits inside
the `!__goldfinchInternal` guard in `web-contents-created`, so internal `goldfinch://` guests are
**auto-excluded** with no renderer-side internal-ness gate (DD6 satisfied for free). The tag path
would have required Leg 4 to gate on `isInternalTab` in the renderer (it fires for ALL guests
including internal) — the guest path avoids that footgun. Therefore **Leg 4 subscribes to
`onPageContextMenu`** (the `page-context-menu` IPC), NOT the `<webview>`-tag event.

**Two facts recorded for Leg 4:**
- **The correction round-trip is main-side regardless** — `replaceMisspelling` is a method on the
  main-process guest `webContents`; the `page-context-correct` channel built here is unchanged by
  the spike decision (the decision only governs where the *params* come from).
- **DD6 internal enforcement** is handled by the guest-side capture's outer `!__goldfinchInternal`
  guard, so Leg 4 inherits NO unguarded internal-page menu (the tag-path footgun was not taken).

**Wired this leg:**
- `src/main/main.js` — guest `contents.on('context-menu', (event, params) => …)` inside the
  `!__goldfinchInternal` block (alongside `before-input-event` / `devtools-state-changed`):
  `event.preventDefault()` (suppress native OS menu, SC6) + `mainWindow.webContents.send(
  'page-context-menu', { wcId: contents.id, params })` — full params, no field-stripping.
- `src/main/main.js` — `ipcMain.on('page-context-correct', …)` near the DevTools handlers:
  `fromId(webContentsId)` → dead/destroyed guard → `isInternalContents` refusal (DD6) →
  `replaceMisspelling(word)` ONLY, gated on `typeof word === 'string' && word`. Acts on the passed
  `wcId` (no `activeTab()` — TOCTOU). NOT a general write primitive; edit-actions deferred to Leg 4.
- `src/preload/chrome-preload.js` — `onPageContextMenu` subscription bridge + `correctMisspelling`
  one-way send bridge.

**Verification:** `npm test` 841 pass / 0 fail; `npm run typecheck` clean; `npm run lint` clean.
MCP tool count unchanged at **26** (`automation-mcp-tools.test.js` "26 tools" green — no new tool,
DD7). All throwaway spike `console.log` listeners + the `GOLDFINCH_SPIKE` auto-driver removed
before landing (`grep -rn "SPIKE" src/` → clean). Native `toolbar-context-menu` handler untouched
(Leg 5). No `#page-context-menu` DOM built (Leg 4).

### `spellcheck-enable` — Status: landed (2026-06-19)

**Premise-audit (DD1 Leg-2 first step) — Electron 42.4.0 under WSLg.**

Method: ran a self-contained Electron probe harness (the installed `electron@42.4.0` binary, not the
app) that created a real web session (`session.fromPartition('persist:probe-web')`), queried the
spellcheck API state at defaults, exercised the toggle mechanisms, hosted a `BrowserWindow` with a
`<textarea>` of misspelled text, and captured `webContents.capturePage()` screenshots OFF vs. ON
(live toggle, no reload) for a pixel diff. Probe removed after the audit (no probe artifacts remain).

Raw observations:

| Probe step | Observed |
|------------|----------|
| (a) Default web-session state | `isSpellCheckerEnabled() === true`, `getSpellCheckerLanguages() === ['en-US']`. So **Electron `^42`'s `webPreferences.spellcheck` default for web guests is `true`** — confirmed, not inferred. `availableSpellCheckerLanguages` = 57 langs. |
| OFF via `setSpellCheckerLanguages([])` | `isSpellCheckerEnabled() === false`, `langs === []`. (NB: the `electron.d.ts` doc text says an empty list "falls back to en-US" — that wording applies to launch-time auto-population from OS locale, NOT to an explicit runtime `setSpellCheckerLanguages([])`, which **does** disable. Verified live.) |
| ON via `setSpellCheckerLanguages(['en-US'])` | `isSpellCheckerEnabled() === true`, `langs === ['en-US']`. |
| (b) Live toggle on an ALREADY-OPEN guest, no reload | API state flips correctly on the open guest's session (`[] → false`, then `['en-US'] → true`) without reloading the page — the session-scoped API reaches the attached guest. |
| Squiggle RENDERING (capturePage OFF vs ON) | **Not observable.** Both screenshots byte-identical in size (3355 B); bitmap diff 0.021% (90/426000 bytes — just the caret + the extra space typed). The misspelled words show **no red wavy underline** in the captured frame even with `isSpellCheckerEnabled() === true`. |
| Dictionary CDN fetch | No `.bdic` `spellcheck-dictionary-download-begin` fired during the probe — but inconclusive as a no-fetch proof (the dict may be cached from prior runs, and the `executeJavaScript`-driven focus may not have triggered a real spellcheck pass). |

**Classification: API-level toggle CONFIRMED live; squiggle RENDERING inconclusive-on-this-platform (WSLg).**
This is exactly the design-review [low] "could not observe" case — NOT a clean pass (rendering never
seen) and NOT a confirmed failure (the API does everything correctly; WSLg's compositor simply does not
paint the squiggle into a `capturePage` frame).

**Wiring decision: implement the session-layer design as specified (it is correct at the API level),
but ship the CONSERVATIVE new-tabs-only USER-FACING wording and flag the live-toggle path for
macOS/real-display HAT.** Rationale: the architect-HIGH session-layer mechanism is provably live at the
API level, so the code is wired exactly as DD1 describes (drive defaultSession + PAGE_PARTITION + every
live web jar on toggle). But because squiggle rendering could not be witnessed on the dev platform, the
toggle help text and the (Leg-6) `spellcheck` behavior spec must NOT assert "squiggle appears on a
pre-opt-in OPEN tab" — they take the pre-authorized "applies to new tabs; reload open tabs to enable"
wording so no behavior-spec step silently fails on WSLg. The Settings toggle help text already carries
"Applies to new tabs — reload open tabs to enable." HAT/macOS should confirm whether the live-on-open-tab
squiggle actually renders (and whether `setSpellCheckerLanguages([])` clears squiggles on macOS, where
the native `NSSpellChecker` runs — a macOS-authoritative OFF-state question, per the leg Edge Cases).

**Accepted CDN egress — RECORDED FOR LEG 6 TO DOCUMENT (no doc edit made this leg).** Leg 6
(`verify-integration`) must add to README privacy notes + CLAUDE.md:
- On **Linux/Windows**, the first editable-field focus *after the user opts in* triggers a one-time
  per-language Hunspell `.bdic` GET from the Chromium CDN (`redirector.gvt1.com/edgedl/chrome/dict/…`).
  Nothing fetches while spellcheck is OFF (the default) — verified by code inspection that no
  spellchecker language is set on any web session until opt-in (and the internal session is never set).
- On **macOS**, Electron uses the native `NSSpellChecker` — **no `.bdic` fetch occurs**; squiggles +
  suggestions come from the OS dictionary. `setSpellCheckerLanguages` / `setSpellCheckerDictionaryDownloadURL`
  are documented no-ops on macOS.
- This egress is **accepted** per DD1 (honors the mission "spellcheck must not silently leak egress"
  constraint: nothing fetches until explicit opt-in, then it is documented).
- `grep -rn "spellcheck\|redirector.gvt1\|NSSpellChecker" README.md CLAUDE.md` is still empty today —
  Leg 6 adds it. This leg made **no** README/CLAUDE.md edit.

**Wired this leg:**
- `src/main/settings-store.js` — `DEFAULTS.spellcheck = false` (additive boolean, NO version bump, NO
  migration, NO validator/normalizer — rides the `typeof val === typeof DEFAULTS[key]` fallback in
  `load()`); `@typedef Settings` gains `spellcheck: boolean`. `freshDefaults()` carries it via the
  `...DEFAULTS` spread (no edit).
- `src/main/main.js` — `applySpellcheck(ses, enabled)` web-session-only helper near `applyShields`
  (`setSpellCheckerLanguages(enabled ? ['en-US'] : [])`; early-returns on `__goldfinchInternal`; NO
  once-guard — naturally idempotent, with a comment saying so). Initial state applied in `whenReady` for
  `defaultSession` + `PAGE_PARTITION` session; per-jar in the `session-created` non-internal branch
  (defensive read — OFF if stores not yet loaded). `webPreferences.spellcheck = false` on the internal
  `will-attach-webview` branch (defense-in-depth); web branch left at Electron's default. Live side-effect
  in `internal-settings-set` on `key === 'spellcheck'`: drives `defaultSession` + `PAGE_PARTITION` +
  every live web jar via `webContents.getAllWebContents()` (deduped by session, internal excluded) — the
  architect-HIGH "reach already-open tabs" fix.
- `src/renderer/pages/settings.html` — a "Spellcheck" checkbox row in `#appearance` (`#spellcheck-enabled`,
  keyboard-focusable native checkbox with a `<label>` accessible name) + a `.muted` help paragraph noting
  the one-time dictionary download and the new-tabs-only/reload wording.
- `src/renderer/pages/settings.js` — a spellcheck controller IIFE mirroring the shields-checkbox
  precedent: guarded `if (!window.goldfinchInternal) return;`, populates from `settingsGet('spellcheck')`,
  writes `settingsSet('spellcheck', !!checked)` via the existing internal-origin-gated path (NO new chrome
  IPC), re-syncs via `onSettingsChanged`, removes the listener on `pagehide`.
- `test/unit/settings-store.test.js` — 3 new tests: `spellcheck` default `false` (+ version stays 1),
  set-true persist/reload round-trip (+ toggle back OFF), and a forward-compat "pre-leg file with no
  `spellcheck` key loads with `false`" assertion. No existing whole-config `deepEqual`/`getAll` snapshot
  exists (all assertions are per-key), so none needed updating.

**Verification:** `npm test` 844 pass / 0 fail (was 841 in Leg 1; +3 spellcheck tests). `npm run typecheck`
clean. `npm run lint` clean. MCP tool count unchanged at **26** (`automation-mcp-tools.test.js` "26 tools"
green — no new tool, DD7; `mcp-tools.js` + `src/main/automation/` untouched). `grep` confirms no spellcheck
wiring leaked into `chrome-preload.js` (read-only settings surface preserved) or the MCP layer. No
`#page-context-menu` / suggestion UI built (Leg 4). No README/CLAUDE.md edit (Leg 6).

### `keydown-test-seam` — Status: landed (2026-06-19)

Behavior-preserving refactor + one-line test fix. Paid down Flight-3 carry-forwards #2 (renderer
keydown test seam) and #5 (`freePortInRange` assertion). No runtime behavior change.

**Extraction.** Pulled the pure decision out of the GLOBAL chrome shortcut keydown handler
(`src/renderer/renderer.js:2256` ONLY — the lightbox-scoped handler at `:1287` was left byte-for-byte
untouched) into a new pure module `src/shared/keydown-action.js`:
`keydownToAction({key, ctrl, meta, shift, lightboxOpen})` → action enum | `null`. The mapper has NO
DOM / IPC / Electron / side effects (`grep` for `document|window|ipcRenderer|require('electron')|els\.|activeTab`
in the file returns nothing). It reproduces the live gating exactly: F12 decided BEFORE the modifier
gate (returns `null` if `lightboxOpen`); `mod = ctrl||meta`, `if (!mod) return null`; zoom (`=`/`+`/`-`/`0`)
and find (`f`/`F`) lightbox-deferred; the `t`/`w`/`l`/`m`/Shift+P/`r` chain NOT lightbox-gated; Ctrl+Shift+I
(devtools) IS lightbox-guarded (matching the live `:2313` branch and the F12 entry point); Ctrl+Shift+I
vs Ctrl+Shift+P disambiguated by key letter. The enum is complete and 1:1 with the live branches:
`devtools` (F12 + Ctrl+Shift+I), `zoom-in`/`zoom-out`/`zoom-reset`, `find`, `new-tab`, `close-tab`,
`focus-address`, `toggle-panel`, `toggle-privacy`, `reload`, `null`.

**Dual-export + script seam.** Module ends with the exact `url-safety.js` dual-export idiom (CommonJS
`module.exports` for tests + `globalThis.keydownToAction` for the renderer). Added
`<script src="../shared/keydown-action.js">` to `src/renderer/index.html` immediately above
`renderer.js`, beside the existing `../shared/url-safety.js` tag, so the bare global is defined before
`renderer.js` runs. The handler now builds the descriptor from the event, calls the global
`keydownToAction(...)`, then `switch`-dispatches the impure side-effects — preserving the EXACT
per-branch guards (active-tab resolution, `isInternalTab` / null-`wcId` no-ops) and `preventDefault`
placement (e.g. reload calls `preventDefault` unconditionally then reloads only if a tab exists;
close-tab calls `preventDefault` then closes only if `activeTabId`). NO `chrome-preload.js` change, NO
`goldfinch`-bridge member.

**Behavior-preservation verification.** Did a careful before/after branch-by-branch diff of the
handler: every live branch (F12 pre-gate, `!mod` gate, zoom, find, t/w/l/m/Shift+P/Ctrl+Shift+I/r)
maps to exactly one mapper action + one dispatch case with identical guards and preventDefault timing.
Lightbox-deferred keys now return `null` from the mapper and fall out before dispatch — matching the
live early-returns. The new 35-case unit test pins the mapping (incl. F12-before-the-gate, Cmd/meta
equivalence, lightbox gating per-key, Ctrl+Shift+I-vs-P). Full suite stayed green with no other test
edits, confirming no observable change.

**Deviation — d.ts + eslint global (necessary).** The leg text said "NO `renderer-globals.d.ts` edit"
and named no eslint change, but the bare-global route the leg *chose* (the `url-safety.js` precedent)
inherently requires both a `declare function` in `src/renderer/renderer-globals.d.ts` and a
`readonly` entry in `eslint.config.mjs` — exactly as `isSafeTabUrl`/`isInternalPageUrl` have. Without
them, `tsc` raised `TS2304 Cannot find name 'keydownToAction'` and eslint raised `no-undef`, which
would fail the leg's hard "typecheck + lint pass" criterion. Added both, mirroring the url-safety
declarations verbatim. This is a documentation seam the mapper consumes, not a runtime/preload/bridge
surface change; the "no d.ts edit" note was predicated on the dual-export route being self-sufficient,
which the established precedent contradicts.

**#5 fix.** `test/unit/automation-port.test.js:237` changed from
`assert.equal(result, port + 1, …)` to `assert.ok(result === null || result === port + 1, …)` — the
only line touched in that file; tolerates the rare port+1 race the test's own comment already claims.

**Files:** `src/shared/keydown-action.js` (new), `test/unit/keydown-action.test.js` (new, 35 tests),
`src/renderer/renderer.js` (handler rewired), `src/renderer/index.html` (+script tag),
`src/renderer/renderer-globals.d.ts` (+declare), `eslint.config.mjs` (+global),
`test/unit/automation-port.test.js` (1 assertion). NOT touched: `src/main/main.js` (before-input-event
stays inline — its 85-line diff is Leg 1's context-menu work, not this leg),
`src/main/automation/mcp-tools.js`, the lightbox handler at `renderer.js:1287`.

**Verification:** `keydown-action.test.js` standalone `node --test` → 35 pass / 0 fail. `npm test`
**879 pass / 0 fail** (was 844 after Leg 2; +35 keydown tests). `npm run typecheck` clean.
`npm run lint` clean. MCP tool count unchanged at **26** (`automation-mcp-tools.test.js` "26 tools" +
`automation-mcp-server.test.js` "tools/list returns 26 tools" both green; `mcp-tools.js` diff empty).

### `context-menu-component` — Status: landed (2026-06-19)

The heaviest leg: built the on-brand, keyboard-operable custom page context menu as the
`menuController` 4th consumer (registered IN PLACE — NOT graduated, DD3), wired against Leg-1's
`onPageContextMenu`/`correctMisspelling` bridges + Flight-3's `toggleDevtools`, plus two new narrow
IPC channels (edit-actions + clipboard).

**Step-0 blur-race finding (the design-review HIGH) — VERIFIED LIVE; race does NOT bite on WSLg.**
Ran `npm run dev` under WSLg with a throwaway instrumentation probe (temporary `console.log`s on the
chrome `window` blur handler + the `onPageContextMenu` subscription, and a temporary main-side
`GOLDFINCH_BLURPROBE` auto-driver that fired a synthetic `sendInputEvent` right-click into the first
guest after `dom-ready`). Observed ordering (timestamps, ms):

| t | event |
|---|-------|
| 382968 | main dispatches synthetic guest right-click |
| 382971 / 382972 | chrome `window` **blur** fires (twice — mousedown then mouseup focus shift into guest) → `closeAll()` runs, `current=null` (nothing open yet) |
| 382997 | main guest `context-menu` fires → forwards `page-context-menu` |
| 382998 | renderer `onPageContextMenu` IPC arrives → this is where `open()` runs |

So the chrome-window `blur` fires **~26 ms BEFORE** the `page-context-menu` IPC arrives: `closeAll()`
runs on an *empty* controller, well before `open()`. The menu opens and stays open with no mitigation
needed on this platform. **Mitigations applied defensively anyway** (harmless if the race doesn't
occur, robust against a different ordering on macOS/real-display): (a) the `onPageContextMenu`
subscription opens the menu on a `queueMicrotask` so any pending blur settles first; (b) `onOpen`
calls `els.pageContextMenu.focus()` to pull focus to the chrome while the menu is up. Did NOT exempt
the entry from the global blur close (the no-controller-change options sufficed). The probe was fully
removed before landing (`grep -rn "BLURPROBE" src/` → clean). The forwarded `params.x/y` were observed
as guest-viewport-relative (a click at guest `(80,80)` produced `params.x≈81`), confirming the
webview-rect-offset mapping reference frame (step 5).

**`focusReturn?` controller extension (step 3a).** Added a minimal **additive** `focusReturn?: () =>
void` option to `menuController.register`. The Escape/Tab branch now calls `entry.focusReturn()` if
present, else defaults to `entry.trigger.focus()` exactly as before. Blast-radius nil: the 3 existing
consumers (container / kebab / site-info) omit `focusReturn` and keep `entry.trigger.focus()` verbatim
(container/kebab hit the default branch; site-info has no `items` getter so the controller's
menu-keydown early-returns before that branch — it supplies its own Escape/Tab). This is the additive
tweak DD3 permits, NOT a graduation — the controller stays an in-place IIFE. The page context menu
passes the menu node as its own `trigger` (only so the controller's trigger-keydown has a target;
harmless — a hidden menu never receives the open chord) and routes focus-return through `focusReturn`,
which branches on invocation source: a guest right-click / in-page ContextMenu returns focus to the
active `<webview>` (`document.activeElement` is the chrome `<body>`/webview, not useful); a
chrome-focused Shift+F10 returns to the captured `activeElement`; fallback `els.address`. Never strands
focus on the hidden menu node.

**Cursor-mapping frame (step 5) — CONFIRMED webview-relative.** `params.x/y` are guest-page coords
relative to the active `<webview>`'s top-left; `positionPageContextMenu` maps them via the live
`activeTab().webview.getBoundingClientRect()` offset (correct whether the media panel is open or the
window resized — `getBoundingClientRect` reads the live rect), shows the node BEFORE measuring
`offsetWidth/offsetHeight`, then clamps within the viewport (`Math.min(x, innerWidth - mw - 4)` /
`Math.max(4, …)`). The probe's observed `params.x≈click x` confirmed the frame. A chrome-focused
keyboard invocation passes `keyboard:true` so the webview offset is skipped (x/y are already chrome
client coords derived from the focused element's rect).

**Shift+F10 / ContextMenu-key in-page finding (step 6).** Wired the invocation HERE (where the menu is
wired), NOT in the Leg-3 `keydownToAction` mapper (DD5). **Finding:** when focus is INSIDE the guest
`<webview>`, Chromium synthesizes a real `context-menu` event on the guest `webContents` for both
Shift+F10 and the ContextMenu key — it flows through Leg-1's main-side listener and the
`onPageContextMenu` subscription exactly like a right-click (real params + caret-derived x/y), so the
**in-page keyboard case needs NO synthetic handling** in the renderer (the guest event doesn't bubble
to the chrome document — the webview is a separate web-contents). The chrome-side keydown listener
therefore only covers the **chrome-focused** case (focus on a toolbar/chrome element, no guest event):
derive x/y from the focused element's rect and open a minimal **Inspect-only** menu (params null) on
the active web tab, returning focus to that chrome element on close. (This in-page synthesis was
reasoned from Chromium's documented ContextMenu-key behavior + the Leg-1 spike that the guest
`context-menu` event fires for programmatic input; a live keyboard-driven confirmation under WSLg was
not separately scripted — flagged for HAT alongside the squiggle-render check, but the chrome-focused
path is exercised by the renderer handler regardless.)

**Clipboard bridge (step 7).** Added a narrow chrome-trusted one-way `clipboardWriteText(text)` preload
bridge + a NON-origin-gated `ipcMain.on('chrome-clipboard-write', …)` handler calling
`clipboard.writeText(String(text))`. Used for Copy link / Copy image address / Copy selection. Same
trust domain as `window-minimize`/`app-quit` (writing a STRING to the OS clipboard is not a guest
mutation). Chosen over `navigator.clipboard.writeText`, which is unreliable from a `file://` doc right
after a guest context-menu steals focus, and over the internal-origin-gated `clipboard:write` (settings
page only — unreachable from the chrome renderer).

**Edit-action channel + trust posture (step 8) — NEW, reviewer-flagged.** Added a new allowlisted
main-side `page-context-action` channel + a `pageContextAction({ webContentsId, action })` preload
bridge, mirroring `page-context-correct`'s discipline EXACTLY: `fromId(webContentsId)` → dead-guard →
`isInternalContents` refuse (DD6) → fixed `Set` allowlist `{cut,copy,paste,undo,redo}` → `wc[action]()`.
Acts on the wcId captured at right-click (TOCTOU — never `activeTab()`); refuses internal. NOT a
run-any-method primitive (anything outside the allowlist is ignored). A SEPARATE channel rather than
widening `page-context-correct` (whose narrow `word`-string contract is part of its audited surface).
`wc.paste()` reads the OS clipboard into the guest — same as a native menu Paste, the user-invoked
intended behavior, not a new exfil path. Rendered edit items are gated by `editFlags` (render-only-if-
truthy): `canCut`/`canCopy`/`canPaste`/`canUndo`/`canRedo` — items whose flag is falsy are **OMITTED**
(kept out of the roving `[role="menuitem"]` set), never rendered disabled (the resolved omit-vs-disabled
decision). The Leg-1 spike only observed `canSelectAll`/`canPaste`/`canCopy`; `canCut`/`canUndo`/
`canRedo` were unobserved, so the render-only-if-truthy guard means an absent flag simply omits the item
(no broken/always-disabled entry). The `editFlags` gating is a UX nicety, not the security boundary —
the boundary is the step-8 allowlist + internal-refusal main-side.

**Sections built per-invocation** from `params` (`buildPageContextSections`, mirroring the container
picker's `innerHTML`-build + per-item click wiring): link (Open in new tab / Copy link) → image
(`mediaType==='image'`, prefer `srcURL` fall back `imageURL`: Open image / Copy image address / Save
image via the existing `downloadMedia` plumbing) → selection (Copy / Search for "…" via `toUrl`) →
editable (Cut/Copy/Paste/Undo/Redo, editFlags-gated) → spelling suggestions (capped at first 8;
`correctMisspelling` round-trip; "No suggestions" placeholder if `misspelledWord` set but list empty) →
always Inspect (`toggleDevtools`, web-only). A union target (linked image, editable+selection) shows
every applicable section; Inspect last. Every item handler calls `closePageContextMenu()` first so
focus-return runs. Labels set via `textContent` (no HTML injection). "Copy image" (binary) deliberately
out of scope — "Copy image address" (URL string) satisfies the DD2 copy-image intent.

**Styling.** `#page-context-menu` reuses the `#container-menu`/`#kebab-menu` chrome (dark `--bg-3`,
`--border`, gold-on-dark `.cm-item:hover`, `box-shadow`, `z-index:60` menu tier below the `z-index:100`
lightbox), a `.cm-sep` `role="separator"` (top-border idiom) between sections, and an
`aria-disabled`-dim style for the rare "No suggestions" placeholder. CSP-safe (no inline JS). The node
has `tabindex="-1"` + `outline:none` so the blur-race self-focus doesn't show a ring on the container.

**a11y.** `role="menu"` node + `role="menuitem"` buttons (text accessible name) + roving tabindex via
the shared `focusItem`; separators `role="separator"`. The structure mirrors the already-a11y-passing
`#container-menu` (empty hidden `role="menu"` at rest — axe skips hidden nodes). The open-menu
audit-state driver is Leg-6 scope (noted in the leg). The live `npm run a11y` attach harness was
inconclusive in this non-interactive WSLg session (the GUI attach model is interactive — same
fragility Legs 1-2 noted); a11y for this leg is satisfied by static inspection + the unchanged
`menuController` contract (the Leg-3 precedent for a hidden/dynamic chrome surface). Flag the open-menu
axe sweep for Leg 6 / HAT.

**Hand-off facts for Leg 5 (`migrate-toolbar-unpin`, which reuses this component for toolbar-mode
Unpin):**
- The 4th consumer is `pageContextEntry` (`renderer.js`), with `closePageContextMenu()` thin wrapper,
  module-scoped `pageCtx` state (`{ wcId, params, x, y, returnFocus, keyboard }`), `pageContextItems()`
  roving getter, `buildPageContextSections(ctx)` builder, `positionPageContextMenu(px, py, keyboard)`
  cursor mapper.
- For a toolbar-mode (chrome-element) invocation, Leg 5 should follow the **keyboard/chrome-focused
  pattern** the Shift+F10 handler established: set `pageCtx.keyboard = true` (skips the webview offset —
  x/y are chrome client coords), set `pageCtx.returnFocus` to the toolbar element, build a custom
  section (e.g. an "Unpin {item}" item) — `buildPageContextSections` currently keys off guest `params`,
  so Leg 5 will need a parallel build path or to pass a synthetic params/section descriptor. The
  `focusReturn` already branches on `keyboard` to return to the captured chrome element.
- The `menuController.register` `focusReturn?` option is the additive extension Leg 5 inherits — no
  further controller change should be needed.
- Leg 5 retires the native `toolbar-context-menu` handler (`main.js`) + the toolbar `contextmenu`
  listeners + the `toolbarContextMenu` bridge — this leg did NOT touch any of those (out of scope).

**Scope honored:** menuController extended in place (additive `focusReturn?` only), NOT graduated (DD3);
no MCP tool added — tool count stays **26** (DD7; `mcp-tools.js`/`src/main/automation/` untouched); no
new bare globals (the menu is wired against bridges, so no `renderer-globals.d.ts`/`eslint.config.mjs`
*global* edit — the only d.ts edit was adding the 4 bridge methods to the `GoldfinchBridge` *interface*,
required for typecheck since renderer.js is now their first consumer); native `toolbar-context-menu`
path untouched (Leg 5); no `tests/behavior/*`/README/CLAUDE.md edit (Leg 6).

**Verification:** `npm test` **879 pass / 0 fail** (unchanged from Leg 3 — no test regressions; this
leg adds renderer/main wiring covered by behavior-test + a11y, not new unit tests). `npm run typecheck`
clean. `npm run lint` clean. MCP tool count **26** (`automation-mcp-tools.test.js` "26 tools" +
`automation-mcp-server.test.js` "tools/list returns 26 tools" both green). 3-consumer regression
confirmed by code-path analysis: container/kebab hit the unchanged `else entry.trigger.focus()` default;
site-info's no-`items` early-return never reaches the Escape/Tab branch — all three are behaviorally
byte-identical post-`focusReturn` addition. `npm run a11y` inconclusive under non-interactive WSLg
attach (static a11y verified; open-menu axe sweep deferred to Leg 6/HAT). App boots clean under
`npm run dev` (blur-race probe run).

**Reviewer notes (flight-level):**
- TWO new IPC channels added: `chrome-clipboard-write` (non-origin-gated string clipboard write —
  chrome-trust domain, like `window-minimize`) and `page-context-action` (allowlisted edit-action
  dispatch on the captured guest wcId, internal-refused). Both flagged for trust-posture review; the
  edit-action channel was design-review-approved per the leg's step 8.
- The Shift+F10 in-page synthesis claim (Chromium fires a guest `context-menu` event) was reasoned, not
  separately scripted live under WSLg — flagged for HAT. The chrome-focused keyboard path IS handled
  by the renderer regardless.
- `npm run a11y` open-menu state was not driven (Leg-6 scope / interactive attach fragility) — static
  structure mirrors the passing `#container-menu`.

### `migrate-toolbar-unpin` — Status: landed (2026-06-19)

Migrated the toolbar right-click **Unpin** (Media / Shields / DevTools) off the native Electron
`Menu.popup` onto the Leg-4 custom `#page-context-menu` component, and retired the native path. **Closes
the M02 Known Issue** and completes SC6 ("the existing toolbar right-click is migrated onto the same
component, retiring the native menu").

**Toolbar-mode reuse approach (no duplication, no fork).** Reused the Leg-4 component in place — no second
menu node, no second `menuController.register`, no controller graduation (DD3 honored). Three small
additions:
- A `toolbarItem` field on the shared module-scoped `pageCtx` (`'media'|'shields'|'devtools'|null`; null =
  page-content mode).
- A short-circuit at the top of `buildPageContextSections(ctx)` (right after the `item`/`sep` helper
  definitions): when `ctx.toolbarItem` is set, it renders a **single "Unpin {Media|Shields|DevTools}"**
  item via the existing `item(label, onClick)` helper (so the `cm-item role="menuitem"` markup +
  close-then-act wiring are byte-identical to the page-menu items) and `return`s before any page sections
  or Inspect. The `itm` value is captured into a local before the closure, since `pageCtx.toolbarItem` is
  shared state that may be reset before the click fires.
- An `openToolbarContextMenu(item, anchorEl)` helper that sets `pageCtx` for a button-anchored open
  (`keyboard:true` so `positionPageContextMenu` treats x/y as chrome client coords and skips the webview
  offset — the same chrome-anchored path the Shift+F10 handler uses; x/y from the button's
  `getBoundingClientRect()` → just below the button; `returnFocus = anchorEl`; `wcId = null`, since the
  toolbar Unpin is a chrome-only settings write needing no guest wcId) and calls
  `menuController.open(pageContextEntry, 0)`. The three `contextmenu` listeners
  (`renderer.js` toggleMedia/togglePrivacy/toggleDevtools) were rewired to it (keeping
  `e.preventDefault()` to suppress the OS menu on the chrome `file://` document).

**Read-modify-write (REQUIRED — a bare object corrupts the other pins).** The new main handler does
`{ ...settings.get('toolbarPins'), [item]: false }` before `settings.set`. This is mandatory, not stylistic:
`settings.set` top-level **replaces** `toolbarPins`, and `NORMALIZERS.toolbarPins` deep-merges the incoming
value over **`DEFAULTS`** (`media:true, shields:true, devtools:false`), NOT over the current config. A bare
`{ [item]: false }` would therefore reset the other two items to their DEFAULTS — silently re-pinning a
previously-unpinned item. The read-merge preserves the other two items' live state (this is exactly what
the native handler's click callback did).

**New narrow chrome-trusted IPC `unpin-toolbar-item` / preload `unpinToolbarItem(item)`.** Item-allowlisted
(`{media, shields, devtools}`), one-way `ipcRenderer.send`, **no origin gate** — same chrome-trust domain as
`window-minimize`/`app-quit`/`chrome-clipboard-write`. NOT a general settings-write surface: it writes only
the one nested boolean to `false` for an allowlisted item. The native handler's `if (!mainWindow) return;`
guard was **deliberately dropped** (it was only needed for `menu.popup({ window: mainWindow })`; the new
handler never touches `mainWindow`) — a reviewer should not flag its absence as a regression.

**Live two-way sync preserved (byte-for-byte).** The handler emits the **same**
`broadcastToChromeAndInternal('settings-changed', settings.getAll())` the native handler did, so the chrome
`onSettingsChanged → applyToolbarPins` reaction (button `.hidden` flip) and the internal settings-page pin
toggle both update live, and `settings.set` persists across restart. No staleness hole introduced.

**Focus fix (design-review HIGH).** The Unpin action HIDES the button the menu was anchored to, so the
close-path focus-return cannot reliably land on it: a **mouse** close runs `onClose` only (not
`focusReturn`), and `onClose` focuses `pageCtx.returnFocus` (the button) unconditionally; even a `.hidden`
guard there wouldn't help, because the button is still **visible** at close time (the unpin broadcast
round-trips async and hides it ~immediately after). Resolution: the Unpin item's `onClick` calls
`els.address.focus()` explicitly **after** the `unpinToolbarItem` send — this runs on both the mouse and
keyboard close paths and is the only spot that reliably lands focus off the disappearing button. No
`focusReturn` `.hidden` fallback was added.

**Shift+F10 / ContextMenu gate (wired as the DEFAULT, not "if observed").** A focused toolbar pin button +
the ContextMenu key double-fires **deterministically** (both a `contextmenu` event AND a global `keydown`
reach their listeners). The global chrome-focus handler now returns early when `document.activeElement` is
one of the three pin buttons (`els.toggleMedia`/`els.togglePrivacy`/`els.toggleDevtools`), so only the
toolbar `contextmenu` path opens — single-open guaranteed.

**Mode isolation.** Both page-mode entry points (the `onPageContextMenu` subscription AND the Shift+F10
chrome-focus handler) now reset `pageCtx.toolbarItem = null`, so a prior toolbar Unpin can never leak a
single-Unpin menu into a later page right-click (and vice-versa).

**Native retirement.** Removed the `ipcMain.on('toolbar-context-menu', …)` handler, the `toolbarContextMenu`
preload bridge, and its `GoldfinchBridge` d.ts entry; removed the now-dead `Menu` from the
`require('electron')` destructuring (it had no other consumer). `clipboard` stays (used by
`chrome-clipboard-write`). Greps clean: `grep -rn "toolbar-context-menu\|toolbarContextMenu" src/` → empty;
`grep -n "\bMenu\b" src/main/main.js` → empty.

**Verification:** `npm test` **879 pass / 0 fail** (unchanged — this leg is renderer/main wiring covered by
behavior-test + a11y, adds no unit tests; the DD7 guards `automation-mcp-tools.test.js` "26 tools" +
`automation-mcp-server.test.js` "tools/list returns 26 tools" both green → tool count **26**, unchanged).
`npm run typecheck` clean (added a `toolbarItem?` field to the `buildPageContextSections` `@param` JSDoc to
match the new `pageCtx` shape). `npm run lint` clean (removing the dead `Menu` import avoided a
`no-unused-vars` trip). 3-consumer + Leg-4 page-menu regression confirmed by code-path analysis: the
component is reused unchanged (one menu node, one registration); page-mode entry points are untouched except
the additive `toolbarItem = null` reset, so container/kebab/site-info and the page-content menu are
behaviorally unchanged.

**WSLg-inconclusive (for HAT):** `npm run a11y` is inconclusive under this non-interactive WSLg session (the
audit needs a live GUI + automation key — the interactive attach model prior legs flagged). Static a11y is
satisfied: the toolbar Unpin item reuses the identical `cm-item role="menuitem"` markup of the
already-a11y-passing page menu. The mouse-vs-keyboard focus landing, the live toolbar-flip + settings-page
sync, persistence across restart, the read-modify-write "other items undisturbed" check, and the single-open
gate were verified by code-path analysis here and are flagged for live HAT confirmation (Leg-6 / HAT scope).

**Hand-off facts for Leg 6** (which updates `tests/behavior/toolbar-pins.md` for the migrated path):
- The toolbar Unpin now renders **in the chrome DOM** as `#page-context-menu` (a single
  `cm-item role="menuitem"` "Unpin {label}"), so the Media/Shields unpin paths previously HAT-only ("native
  menu not in the renderer DOM") are now MCP-drivable.
- Invocation: right-click or ContextMenu-key on a `#toggle-media`/`#toggle-privacy`/`#toggle-devtools`
  button → menu anchored just below the button; activating "Unpin {item}" hides that button immediately,
  updates the settings-page pin toggle live, persists across restart, and focuses `#url` (the address bar).
- Step 14's "native context menu" wording for DevTools right-click is now stale — the migrated path is
  the on-brand custom menu. `tests/behavior/toolbar-pins.md` was NOT edited this leg (Leg-6 scope), nor were
  README / CLAUDE.md.

### `verify-integration` — Status: landed (2026-06-19)

Final autonomous leg: authored the two committed behavior-test specs, reframed `toolbar-pins.md` for the
migrated in-DOM unpin, documented the menu + spellcheck + accepted CDN egress in README/CLAUDE.md, added
the a11y open-menu state-driver + harness 7th state, and ran the keydown / tool-count / suite regression.
**No feature source changed** — the only source touches are the additive `renderer.js` audit driver and
the `a11y-audit.mjs` state/comment edits.

**Specs authored (status `draft`):**

- **`tests/behavior/page-context-menu.md`** (SC6). Frontmatter + Intent + Preconditions (admin MCP surface,
  single chrome target, the **real guest `context-menu` event** via `click {button:'right'}`, coordinate-
  click rule) + Observables Required + 12-row Steps table + Out of Scope + Variants.
  - **WSLg-acceptance steps** (every Expected Result a `getChromeTarget`-readable DOM / a11y-tree /
    screenshot / filesystem observable): probe (1); right-click link (3) / image (4) / selection (5) /
    editable (6) → context-appropriate sections + always Inspect, custom menu NOT native (the native
    menu's absence in the chrome DOM is the negative observable); cursor position (7); keyboard nav +
    Esc focus-return (8); chrome-focused Shift+F10 / Context-Menu → Inspect-only (9); **no-op on
    `goldfinch://` internal** (10); toolbar Unpin migration — right-click `#toggle-media/privacy/devtools`
    → single in-DOM "Unpin {item}" → button hides live + `settings.json toolbarPins.{item}===false` +
    settings-page toggle live + focus to address bar (11–12).
  - **HAT/macOS-authoritative (Out of Scope, not judged steps):** the menu's pixel-level on-brand *feel*;
    the live **in-guest** Shift+F10 keyboard render on a real display; macOS native-menu suppression
    confirmation; Inspect → detached-DevTools materialization (cross-ref `devtools-cdp-conflict.md`).
- **`tests/behavior/spellcheck.md`** (SC3). Carries a **top-of-spec WSLg known-limitation block**
  (mirroring `find-in-page.md`): the red squiggle does not paint into a `captureWindow` frame even with
  `isSpellCheckerEnabled()===true` (Leg-2), so the squiggle-render + macOS native-speller steps are
  macOS/HAT-authoritative and expected INCONCLUSIVE on WSLg — dispositioned, not failed. 6-row Steps table.
  - **WSLg-acceptance:** Default-OFF as a **STATE proxy** (2) — `settings.json spellcheck:false`/absent +
    empty/absent `misspelledWord` and `dictionarySuggestions` in the forwarded `params` (NOT a network/
    no-fetch assertion — goldfinch has no network MCP tool and `evaluate` is guest-main-world only; **no
    `[mixed-frame]` network row authored**); enable via Settings → Appearance (3) → checkbox checked +
    `settings.json spellcheck===true` + new-tabs/reload help copy; suggestions→choose→correction **menu
    plumbing** (5) drivable when `params` carries a `misspelledWord` (empty list = dict-not-loaded, treated
    as NOT a failure; populated list confirms the plumbing); disable round-trips OFF (6).
  - **HAT/macOS-authoritative (Out of Scope):** the **literal no-`.bdic`-egress assertion** (HAT/network-
    trace-authoritative — no network tool on the surface); the macOS native-`NSSpellChecker` path; the
    squiggle pixels.
- **`tests/behavior/toolbar-pins.md`** reframed **by intent** (surgical — Step 14 + the row-conventions
  note + the Out-of-Scope carve-out only): the Media/Shields/DevTools right-click Unpin now renders the
  in-DOM custom `#page-context-menu` and **is** MCP-drivable (no longer native / HAT-only); full
  toolbar-Unpin coverage cross-referenced to `page-context-menu.md` to avoid duplication.
  `grep "native context menu\|native Electron menu\|not in the renderer DOM"` now returns only the
  corrected "**not** a native Electron menu" / "**no longer** HAT-only" wording.

**Docs updated:**

- **README.md** — `## Features`: added a **Custom page context menu** bullet + an **Opt-in spellcheck**
  bullet; rewrote the "Pinnable toolbar icons" bullet to read as the **custom** on-brand menu **and** added
  **DevTools** as the third (default-unpinned) pinnable item with its `F12`/`Ctrl+Shift+I` shortcuts. In
  the **Privacy & Shields** prose: documented the accepted one-time per-language Hunspell `.bdic` egress
  from the Chromium CDN (`redirector.gvt1.com/edgedl/chrome/dict/…`) on **Linux/Windows after opt-in only**,
  the macOS `NSSpellChecker` **no-fetch** posture, and **nothing fetched while OFF** (the default).
- **CLAUDE.md** — rewrote the doubly-stale "Right-click Unpin — main-owned write path" section for the
  migrated `unpinToolbarItem` IPC + the custom `#page-context-menu` (4th `menuController` consumer,
  toolbar-mode short-circuit, read-modify-write `{ ...toolbarPins, [item]:false }`, the address-bar focus
  fix, the Context-Menu-key double-fire gate). Added a **Page context menu** architecture note (guest
  `context-menu` → `preventDefault` → main → `page-context-menu` IPC → chrome `#page-context-menu`; the
  `page-context-correct` / `page-context-action` / `chrome-clipboard-write` channels; web-content-only,
  internal auto-excluded) and a **Spellcheck** note (session-layer `setSpellCheckerLanguages` gating,
  default OFF, accepted CDN egress on opt-in / macOS native-speller no-fetch). Fixed the stale a11y state
  list in `## Commands` (added DevTools button + page context menu). `grep` confirms the stale
  `toolbarContextMenu`/`toolbar-context-menu`/`Menu.buildFromTemplate` refs are gone and no operator
  paths/usernames leaked.

**a11y open-menu state-driver:** added a top-level `openPageContextMenuForAudit()` to `renderer.js` (sets a
representative synthetic `pageCtx.params` — full sections: link + selection + editable + spelling
suggestions + Inspect — and opens via `menuController.open(pageContextEntry, 0)`). It is a top-level
`function` declaration so it is a `window` global reachable in the guest main world by the MCP
`evaluate`/`injectScript` tools (the gated `const pageCtx`/`pageContextEntry`/`menuController` are NOT
reachable, and the harness cannot fire a guest `context-menu` event — hence the driver). It carries an
`eslint-disable-next-line no-unused-vars` (it is reached only at runtime via the eval tool, never called
in-tree by design — a live entry point, not dead code). `scripts/a11y-audit.mjs` gained a **7th sweep
state** (`page-context-menu`) after `devtools-button` that `evaluate`s `openPageContextMenuForAudit()` →
runs axe. **Also fixed the stale `5-state`/`5-state sweep` comments** in `a11y-audit.mjs` to `7-state`
(they were already wrong at 6 states pre-leg). `ACCEPTED` baseline unchanged (the open menu reuses the
already-a11y-passing `#container-menu` markup — expected no new violations).

**a11y disposition:** `npm run a11y` is **INCONCLUSIVE under non-interactive WSLg** (it requires a live GUI
+ the admin automation key over the loopback MCP surface; exits at the no-key precondition before any audit
— the prior-leg reality, flagged not faked). The driver + 7th state are added so the gate **can** audit the
open menu when run in HAT/macOS (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run
dev:automation`, export `GOLDFINCH_MCP_ADMIN_KEY`). `node --check scripts/a11y-audit.mjs` confirms the 7th
state + argv parse syntactically valid.

**Regression sweep:** `node --test test/unit/keydown-action.test.js` → **35 pass / 0 fail** (the Leg-3 pure
mapper, covering the full chrome shortcut set). `git diff src/main/main.js | grep before-input-event` →
empty (the main-side `before-input-event` is **untouched** this leg — its 124-line diff is the Legs 1-2
context-menu + spellcheck work). The global shortcut set is exercised by the `page-context-menu` spec's
keyboard steps + HAT.

**Verification numbers:** `npm test` **879 pass / 0 fail** (this leg adds no unit tests). `npm run
typecheck` clean. `npm run lint` clean (the audit driver's `no-unused-vars` handled by the inline disable).
MCP **tool count 26** — `automation-mcp-tools.test.js` "26 tools" + `automation-mcp-server.test.js`
"tools/list returns 26 tools" both green; `git diff src/main/automation/` empty (DD7 honored, no tool
added). Source touches confined to the additive `renderer.js` audit driver + the `a11y-audit.mjs`
state/comment edits.

**Behavior-test RUNS are PENDING.** Per the leg, the Developer agent authored the spec files only; the
`/behavior-test page-context-menu` and `/behavior-test spellcheck` **runs are Flight-Director-driven** (the
orchestrator runs them / dispositions the squiggle + native-speller steps as macOS/HAT-authoritative, or
defers them to HAT). Run logs will land at `tests/behavior/{slug}/runs/{ts}.md` once executed; specs
promote `draft → active` after the operator reviews the first green/dispositioned run.

**Note for the flight-level reviewer:** the leg text said the toolbar Unpin focuses `#url`; the actual
address-bar element is `#address` / `els.address` (there is no `#url` element). The Leg-5 code already
focuses `els.address`, so the specs + docs say "the address bar (`#address`)" to match the real code —
flagged here as a deliberate accuracy correction, not a deviation in behavior.

## Deviations

- **None affecting code behavior.** The only deviation from the leg's literal wording is the **toggle
  help-text / behavior-spec stance**: the leg's primary path was "live-toggle as designed (squiggle on
  open tab)", with the new-tabs-only fallback reserved for an observed failure. The premise-audit landed
  in the explicitly-pre-authorized **inconclusive-on-WSLg** branch (API confirmed, rendering unobservable),
  so per the leg's design-review [low] note the conservative new-tabs-only wording was taken and the
  live-on-open-tab squiggle is flagged for macOS/HAT. The session-layer CODE is implemented exactly as
  specified (it drives open tabs); only the user-facing claim is conservative.

## Anomalies

*(populated during execution)*
