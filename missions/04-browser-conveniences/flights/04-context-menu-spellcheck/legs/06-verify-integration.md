# Leg: verify-integration

**Status**: completed
**Flight**: [Custom Page Context Menu + Spellcheck](../flight.md)

## Objective

Author the two committed behavior-test specs (`tests/behavior/page-context-menu.md` +
`tests/behavior/spellcheck.md`), update `tests/behavior/toolbar-pins.md` for the migrated (in-DOM) unpin
path, document the page context menu + opt-in spellcheck (incl. the accepted one-time Chromium-CDN
Hunspell egress) in README + CLAUDE.md, add a chrome-side **open-menu a11y state-driver** so `npm run a11y`
can audit the open `#page-context-menu`, run a regression sweep of the keydown/`before-input-event`
handlers, and **run both behavior tests via `/behavior-test` (Flight-Director-driven)** — verifying SC6 +
SC3 end-to-end with the WSLg-runnable observables as the acceptance and the visual-squiggle /
native-speller paths dispositioned as macOS/HAT-authoritative — all with **no MCP tool-count change (26)**.

## Context

This is the final autonomous leg of the flight: Legs 1–5 built the feature; this leg authors the
regression nets, documents the user-facing behavior + privacy posture, and exercises the whole thing.

**What Legs 1–5 delivered (the behaviors/observables this leg encodes):**

- **Leg 1 (`context-menu-ipc`, landed).** The guest `context-menu` event is captured main-side inside the
  `!__goldfinchInternal` guard (`web-contents-created`), `event.preventDefault()`s the native OS menu, and
  forwards `{ wcId, params }` to the chrome renderer via `mainWindow.webContents.send('page-context-menu',
  …)`. The spike was **POSITIVE on both sides** with the full rich payload (`linkURL`, `imageURL`/`srcURL`,
  `mediaType`, `selectionText`, `isEditable`, `editFlags`, `misspelledWord`/`dictionarySuggestions`,
  `x`/`y`); the **guest side** was wired (internal guests auto-excluded by the outer guard — DD6 for free).
  A `page-context-correct` correction channel (`replaceMisspelling`, target-by-`wcId`, internal-refused)
  also landed. **`misspelledWord`/`dictionarySuggestions` populate only once spellcheck is ON** (Leg 2).
- **Leg 2 (`spellcheck-enable`, landed).** `settings-store` `spellcheck:false` default (no version bump,
  no migration), gated at the **session layer** (`setSpellCheckerLanguages(['en-US'])` ON / `[]` OFF on web
  sessions — `defaultSession`, `PAGE_PARTITION`, every live web jar — **never** the internal session;
  `webPreferences.spellcheck=false` on the internal `will-attach-webview` branch as defense). Settings →
  Appearance opt-in checkbox (`#spellcheck-enabled`). **Premise-audit result (Electron 42.4.0 / WSLg):**
  the API-level toggle is **CONFIRMED live** on an already-open guest; the **squiggle RENDERING is
  inconclusive on WSLg** (the compositor does not paint the red wavy underline into a `capturePage` frame),
  so the leg took the conservative **"applies to new tabs; reload open tabs to enable"** wording and flagged
  the live-on-open-tab squiggle + macOS native-speller path for HAT/macOS. **Accepted CDN egress facts to
  document (Leg 2 recorded these for Leg 6):** on **Linux/Windows** the first editable-field focus *after
  opt-in* triggers a one-time per-language Hunspell `.bdic` GET from `redirector.gvt1.com/edgedl/chrome/dict/…`;
  on **macOS** Electron uses the native `NSSpellChecker` — **no `.bdic` fetch**; **nothing fetches while OFF**
  (the default). README + CLAUDE.md have **no** spellcheck/context-menu content today (Leg-2 grep confirmed;
  re-confirmed in this leg's Citation Audit).
- **Leg 3 (`keydown-test-seam`, landed).** The pure `keydownToAction({key,ctrl,meta,shift,lightboxOpen})`
  mapper was extracted from the **global chrome shortcut handler** (`renderer.js`) into
  `src/shared/keydown-action.js` (dual-export + `<script>` global, like `url-safety.js`) with 35 unit tests;
  the lightbox-scoped handler was left untouched; the main-side `before-input-event` stays **inline**
  (verified by the behavior-test net, not unit-tested). The `freePortInRange` one-liner was folded
  (`test/unit/automation-port.test.js`). **Regression target this leg:** confirm the global shortcut set
  (`F12`/`Ctrl+Shift+I`, `Ctrl+M`, `Ctrl+Shift+P`, zoom, find, new/close-tab, focus-address, reload) still
  works and the main-side `before-input-event` is untouched.
- **Leg 4 (`context-menu-component`, landed).** The `#page-context-menu` DOM node + the `pageContextEntry`
  `menuController` **4th consumer** (registered **in place**, DD3 — additive `focusReturn?` option only),
  with context-appropriate sections built per-invocation from `params`: **link** (Open in new tab / Copy
  link) → **image** (Open / Copy image address / Save) → **selection** (Copy / Search for "…") → **editable**
  (Cut/Copy/Paste/Undo/Redo, `editFlags`-gated, omit-not-disable) → **spelling suggestions** (capped at 8;
  "No suggestions" placeholder if `misspelledWord` set but list empty; correction → `correctMisspelling`
  round-trip) → always **Inspect** (→ the existing `toggle-devtools` IPC path, web-only). Cursor-position
  open via the webview-rect offset; chrome-focused **Shift+F10 / ContextMenu-key** opens an Inspect-only
  menu (the in-guest case synthesizes a real guest `context-menu` event — needs no synthetic handling). Two
  new narrow IPC channels: `chrome-clipboard-write` + `page-context-action` (allowlisted edit-actions).
  **No-op on internal pages** (the whole wiring is behind the `!__goldfinchInternal` guard). The
  **open-menu axe state was NOT driven** (deferred here); static a11y mirrors the passing `#container-menu`.
- **Leg 5 (`migrate-toolbar-unpin`, landed).** The toolbar **Unpin** (Media/Shields/DevTools) moved off the
  native `Menu.popup` onto the same `#page-context-menu` component (toolbar-mode: a `pageCtx.toolbarItem`
  field + a `buildPageContextSections` short-circuit rendering a single **"Unpin {Media|Shields|DevTools}"**
  `cm-item role="menuitem"`, opened via `openToolbarContextMenu(item, anchorEl)` anchored just below the
  button). A **new narrow chrome-trusted `unpinToolbarItem(item)` IPC** + bridge replaced the retired
  `toolbar-context-menu` handler + `toolbarContextMenu` bridge; the now-dead `Menu` import was removed. The
  read-modify-write (`{ ...settings.get('toolbarPins'), [item]:false }`) + `broadcastToChromeAndInternal`
  preserve the live two-way pin sync byte-for-byte. **M02 Known Issue closed.** Activating "Unpin {item}"
  hides that button immediately, syncs the settings-page toggle live, persists across restart, and focuses
  `#url` (the address bar). **Hand-off for this leg:** the toolbar Unpin now renders **in the chrome DOM**
  (MCP-readable via `getChromeTarget`/`readDom`), so the Media/Shields/DevTools right-click unpin paths that
  were **HAT-only in `toolbar-pins.md`** ("native menu not in the renderer DOM") are now MCP-drivable;
  **`toolbar-pins.md` Step 14's "native context menu" wording is now stale.**

**The WSLg-vs-macOS/HAT verification split (the load-bearing framing for both new specs).** The whole
mission runs under WSLg in dev; macOS + a real GUI are the HAT environment. Three platform realities from
the prior legs shape what each behavior spec can *assert as acceptance* vs *mark as macOS/HAT-authoritative*:

1. **The menu is DOM-readable (WSLg-runnable).** The page context menu and the toolbar Unpin menu both
   render in the **chrome** renderer's `#page-context-menu` node — readable via `getChromeTarget` →
   `readDom`/`readAxTree`/`captureWindow`, and drivable via coordinate `click`/`pressKey`. The act side
   (`click {button:'right'}` dispatches a **real** guest `context-menu` event; `typeText` enters real
   misspellings) is the M03 automation surface. So **the menu's presence, sections, cursor position,
   keyboard nav, Shift+F10 invocation, no-op-on-internal, and the toolbar unpin live-flip/persist are all
   WSLg-acceptance observables.**
2. **The spellcheck squiggle is NOT reliably observable on WSLg** (Leg 2: the red wavy underline does not
   paint into a `capturePage`/`captureWindow` frame even with `isSpellCheckerEnabled() === true`). The
   **squiggle-rendering path is macOS/HAT-authoritative.** What IS WSLg-acceptance for spellcheck: the
   **opt-in state** (OFF by default; the Settings checkbox flips it — a settings/`params` STATE proxy, NOT
   a network assertion: goldfinch has no network-observation MCP tool and `evaluate` can't read the
   main-process session, so the literal no-`.bdic`-fetch egress is HAT/network-trace-authoritative), and the
   **menu plumbing** for suggestions/correction once a `misspelledWord` is present in `params`.
3. **`npm run a11y` needs a live GUI + the admin automation key** (it attaches over the loopback MCP
   surface to drive chrome states). Prior legs recorded it **inconclusive under non-interactive WSLg**; it
   is a verify-only gate, run in the HAT/interactive environment. This leg adds the missing **open-menu
   state-driver** so the gate *can* audit the open menu when run there.

Plus the **find-in-page WSLg cold-start known issue** (`find-in-page.md`): the FIRST `findInPage` on a
freshly-loaded `<webview>` returns `{matches:0}` on WSLg — an accepted Chromium cold-start quirk, relevant
here only as a precedent for how a WSLg-environment limitation is **documented as a known issue in the
spec** (a warning block at the top) rather than left to silently fail.

**Authoring discipline.** Both specs follow the project's behavior-test format (`.flightops/ARTIFACTS.md`
"Behavior Test — Spec") and the Witnessed pattern (every action judged by an independent Validator). They
are authored at status **`draft`** (the operator promotes to `active` after review). The **runs** are
executed by the Flight Director via `/behavior-test {slug}`, NOT by a Developer agent — authoring produces
the spec; running is a separate operation. Evidence lands at the ephemeral, never-committed path
`/tmp/behavior-tests/goldfinch/{slug}/{ts}/` (per `.flightops/ARTIFACTS.md`).

## Inputs

What exists before this leg runs (Legs 1–5 landed; verified in the Citation Audit):

- `tests/behavior/toolbar-pins.md` — Step 14 + Out-of-Scope describe the **native** right-click Unpin as
  HAT-only ("the native Electron menu is not in the renderer DOM, not drivable over the MCP surface"). Now
  **stale** post-Leg-5 (the unpin renders in the chrome DOM). To be updated by intent (not rewritten).
- `tests/behavior/find-in-page.md` — the WSLg-known-issue warning-block precedent (top-of-spec) to mirror.
- `tests/behavior/devtools-cdp-conflict.md` + `tests/behavior/menu-dismissal.md` +
  `tests/behavior/kebab-menu.md` — additional style references (preconditions block, dual-target rules,
  `[a11y]` markers, Out-of-Scope / macOS-authoritative dispositioning).
- `scripts/a11y-audit.mjs` — the `npm run a11y` harness: a 6-state chrome sweep (`base-chrome`,
  `media-panel`, `privacy-panel`, `lightbox`, `find-bar`, `devtools-button`) driven by **renderer top-level
  function declarations** reachable in the guest main world via the MCP `evaluate` tool
  (`togglePanel(true)`, `togglePrivacy(true)`, `openLightbox({…})`, `openFind()`, `closeFind(activeTab())`,
  `applyToolbarPins({…})`). It injects `axe.min.js` per state and diffs against the curated `ACCEPTED`
  allowlist (the 7 app-shell/scroll-region entries). **There is no menu-open state today** — the harness
  cannot fire a guest `context-menu` event, so the open `#page-context-menu` is unaudited (Leg 4 deferred it
  here). Chrome sweep needs `GOLDFINCH_MCP_ADMIN_KEY` (`getChromeTarget` is admin-only).
- `src/renderer/renderer.js` — the Leg-4/5 page-context block: `pageCtx` (`const`, **NOT** main-world
  reachable), `buildPageContextSections(ctx)` (top-level fn, reachable), `positionPageContextMenu(px,py,kbd)`
  (top-level fn), `pageContextEntry`/`menuController` (`const`s, **NOT** reachable),
  `openToolbarContextMenu(item, anchorEl)` (top-level fn — reachable, but needs a real toolbar button as the
  anchor and only renders the single Unpin item). `applyToolbarPins(pins)`, `togglePanel`, `openFind`,
  `closeFind`, `openLightbox`, `closeLightbox` confirmed as top-level fns (the harness already drives them).
  `renderer.js` is a **classic (non-module) script** (`index.html:214` plain `<script>`), so top-level
  `function` declarations become `window` globals — but `const`/`let` do not. **This is why a new top-level
  state-driver function is needed** (the menu's open path is gated behind `const` state + a guest event).
- `README.md` — `## Features` (lines ~33–123: pinnable toolbar icons ~90, Privacy & Shields ~63), `## Run`
  / `### Development`, `## Keyboard shortcuts` (~141), `## Architecture`. **No spellcheck/context-menu
  content** (grep empty). The natural homes: a context-menu feature bullet + a spellcheck feature bullet in
  `## Features`, and the CDN-egress note in the privacy-relevant prose (Shields/privacy area).
- `CLAUDE.md` — line **113** "**Right-click Unpin — main-owned write path**" describes the **retired**
  native menu (`window.goldfinch.toolbarContextMenu`, `ipcMain.on('toolbar-context-menu', …)`,
  `Menu.buildFromTemplate`, `item ∈ ['media', 'shields']`) — **doubly stale** (the path is gone AND it
  omitted DevTools). Adjacent: line 107 `applyToolbarPins` + `settings-changed`; line 100–105 the DevTools
  affordance. The natural homes: rewrite the right-click section for the migrated `unpinToolbarItem` path +
  the custom `#page-context-menu` component, and add a spellcheck/egress architecture note.
- `package.json:18` — `"a11y": "node scripts/a11y-audit.mjs"`.
- `test/unit/automation-mcp-tools.test.js` ("26 tools") + `test/unit/automation-mcp-server.test.js`
  ("tools/list returns 26 tools") — the DD7 no-new-tool guard. This leg adds no tool.

## Outputs

What exists after this leg completes:

- `tests/behavior/page-context-menu.md` — **new** committed behavior-test spec, status `draft`. Covers SC6
  (custom page context menu + the migrated toolbar Unpin), with WSLg-runnable observables as acceptance and
  any visual-feel/macOS bits marked HAT/macOS-authoritative.
- `tests/behavior/spellcheck.md` — **new** committed behavior-test spec, status `draft`. Covers SC3 (opt-in
  spellcheck), with the opt-in-state + no-fetch + menu-plumbing as WSLg acceptance and the squiggle-render +
  native-speller suggestion paths marked macOS/HAT-authoritative.
- `tests/behavior/toolbar-pins.md` — **updated** (by intent) for the migrated in-DOM unpin path (Step 14 +
  Out-of-Scope reframed; the DevTools/Media/Shields right-click is now MCP-drivable, not native-menu HAT).
- `README.md` — documents the custom page context menu + opt-in spellcheck + the accepted one-time CDN
  Hunspell `.bdic` egress (Linux/Windows, post-opt-in only) + the macOS native-speller no-fetch posture, in
  the existing features/privacy prose.
- `CLAUDE.md` — the stale native-menu "Right-click Unpin" section rewritten for the migrated path + custom
  component; a spellcheck/egress architecture note added.
- `scripts/a11y-audit.mjs` + `src/renderer/renderer.js` — a new **open-page-context-menu audit state** added
  to the chrome sweep (7th state), driven by a **new top-level state-driver function** in `renderer.js`
  (e.g. `openPageContextMenuForAudit()`). `ACCEPTED` extended only if the open menu surfaces a real,
  reviewed accepted finding (default: it should be clean).
- `tests/behavior/page-context-menu/runs/{ts}.md` + `tests/behavior/spellcheck/runs/{ts}.md` — the run logs
  from the Flight-Director-driven `/behavior-test` runs (committed; evidence stays at
  `/tmp/behavior-tests/goldfinch/{slug}/{ts}/`, never committed).
- `flight-log.md` — Leg 6 progress entry (spec structure, the a11y state-driver mechanism, the
  toolbar-pins reframe, the docs locations, the regression-sweep result, the behavior-test verdicts + which
  steps were WSLg-acceptance vs HAT-dispositioned).
- **NOT touched:** `src/main/automation/mcp-tools.js` / the MCP layer (tool count **26**, DD7); the feature
  source from Legs 1–5 (the menu/spellcheck/toolbar code is exercised, not changed — the only `renderer.js`
  edit is the additive a11y state-driver function).

## Acceptance Criteria

- [x] **`tests/behavior/page-context-menu.md` authored** — valid project behavior-test format (frontmatter,
  Intent, Preconditions, Observables Required, Steps table, Out of Scope, Variants), status `draft`. Covers:
  right-click web content → on-brand **custom** menu (not native); context-appropriate sections
  (link/image/selection/editable/Inspect); cursor-position open; keyboard nav (arrows/Esc/Enter/Home/End) +
  **Shift+F10 / ContextMenu-key** invocation; **no-op on internal `goldfinch://` pages**; the **toolbar
  Unpin migration** (right-click Media/Shields/DevTools → custom menu → Unpin flips the toolbar live +
  persists). Each step's observable is **DOM/a11y-tree/screenshot-readable via `getChromeTarget`** (the
  WSLg acceptance); any visual-feel-only items are marked **HAT-authoritative** in Out-of-Scope (not asserted
  as pass/fail steps).
- [x] **`tests/behavior/spellcheck.md` authored** — valid format, status `draft`. Covers: spellcheck **OFF
  by default** (state proxy: `settings.json spellcheck:false` + no spellcheck engagement in `params`);
  **enable via Settings → Appearance**; squiggle on a misspelled word; right-click → suggestions → choose →
  correction applies. The **opt-in state + menu/correction plumbing** are the WSLg-acceptance observables;
  the **literal no-`.bdic`-egress assertion** (no network tool on the MCP surface), the
  **visual squiggle render**, and the **macOS native-speller suggestion** path are marked
  **macOS/HAT-authoritative** (per Leg 2 — squiggle inconclusive on WSLg). The spec carries a top-of-spec
  **WSLg known-limitation block** (mirroring `find-in-page.md`) so no step silently fails, and the
  "wait-for-squiggle" step uses the Leg-2 **new-tab/reload** wording (never asserts a squiggle on a
  pre-opt-in open tab).
- [x] **`tests/behavior/toolbar-pins.md` updated** for the migrated unpin path — Step 14's stale "native
  context menu" wording reframed (the Media/Shields/DevTools right-click Unpin now renders the in-DOM custom
  `#page-context-menu`, MCP-drivable), and the Out-of-Scope "native menu not in the renderer DOM" carve-out
  corrected. Done **by intent** (minimal, surgical edits — not a rewrite); the spec stays coherent.
- [x] **README documents the context menu + spellcheck + the accepted CDN egress** — a custom page
  context-menu feature description, an opt-in spellcheck description, the one-time per-language Hunspell
  `.bdic` CDN fetch (`redirector.gvt1.com/edgedl/chrome/dict/…`) on **Linux/Windows after opt-in only**, and
  the macOS native-speller **no-fetch** posture, placed in the existing features/privacy prose (no
  prescribed heading — located in this leg's reading).
- [x] **CLAUDE.md documents** the same — the stale native-menu "Right-click Unpin" section (line ~113)
  rewritten for the migrated `unpinToolbarItem` IPC + the custom `#page-context-menu` component (4th
  `menuController` consumer); a spellcheck architecture note (session-layer gating, the accepted egress, the
  macOS native-speller no-fetch). No leaked operator paths/usernames.
- [x] **a11y open-menu state-driver added (warranted) + `npm run a11y` reports no NEW violations.** A new
  top-level **state-driver function** in `renderer.js` opens a representative page-content menu (the harness
  cannot fire a guest `context-menu` event, and `pageCtx`/`pageContextEntry`/`menuController` are `const`s
  unreachable from the main world); `scripts/a11y-audit.mjs` gains a 7th sweep state that calls it and audits
  the open `#page-context-menu` (`role="menu"`, `role="menuitem"` items, separators, accessible names,
  roving tabindex). `npm run a11y` reports **no NEW violations** vs the curated `ACCEPTED` baseline when run
  in the HAT/live-GUI environment (the gate is verify-only; **inconclusive under non-interactive WSLg** is
  the recorded prior-leg reality — flag, don't fake).
- [x] **Keydown / `before-input-event` regression confirmed.** The Leg-3 renderer keydown refactor preserves
  the full global shortcut set (`F12`/`Ctrl+Shift+I`, `Ctrl+M`, `Ctrl+Shift+P`, zoom `+`/`-`/`0`, find
  `Ctrl+F`, new/close-tab, focus-address, reload) and the main-side `before-input-event` is **untouched**
  (the 35 `keydown-action` unit tests stay green; the behavior-test net + HAT cover the main-side branch).
- [x] **Tool count 26** — `automation-mcp-tools.test.js` "26 tools" + `automation-mcp-server.test.js`
  "tools/list returns 26 tools" stay green; `mcp-tools.js` / `src/main/automation/` untouched (DD7).
- [x] **`npm test` / `npm run typecheck` / `npm run lint` pass** (the suite stays at its Leg-5 count of
  879 pass / 0 fail — this leg adds no unit tests; the new state-driver fn must typecheck + lint clean).
- [ ] **Both behavior tests RUN by the Flight Director via `/behavior-test`**, with run logs committed. The
  WSLg-runnable observables are the **acceptance**; any step whose observable is squiggle-visual or
  native-speller (macOS) is **explicitly dispositioned as macOS/HAT-authoritative in the run log** — marked
  INCONCLUSIVE-on-WSLg with the disposition, **never silently passed**.

## Verification Steps

- **page-context-menu spec authored** — `tests/behavior/page-context-menu.md` exists, status `draft`, parses
  as a valid spec (frontmatter + Intent + Preconditions + Observables Required + Steps table + Out of Scope);
  every Steps-table Expected Result references a DOM/a11y/screenshot observable read via `getChromeTarget`
  (the WSLg-acceptance discipline); HAT/macOS-only items live in Out of Scope, not as judged steps.
- **spellcheck spec authored** — `tests/behavior/spellcheck.md` exists, status `draft`, valid; carries the
  top-of-spec WSLg known-limitation block; the Default-OFF step asserts a STATE proxy (settings + `params`),
  NOT a network observable; the literal no-`.bdic`-egress assertion, the squiggle render, and the
  native-speller paths are in Out of Scope as HAT / network-trace / macOS-authoritative.
- **toolbar-pins.md reframed** — `grep -n "native context menu\|native Electron menu\|not in the renderer
  DOM" tests/behavior/toolbar-pins.md` shows the stale wording is gone/corrected; the migrated in-DOM path
  reads coherently; `git diff` is surgical (Step 14 + Out-of-Scope only, no churn elsewhere).
- **README/CLAUDE.md docs** — `grep -ni "spellcheck\|context menu\|redirector.gvt1\|NSSpellChecker"
  README.md CLAUDE.md` now returns the new content; the CLAUDE.md `toolbarContextMenu`/`toolbar-context-menu`/
  `Menu.buildFromTemplate` references are gone (`grep -n "toolbarContextMenu\|toolbar-context-menu\|
  Menu.buildFromTemplate" CLAUDE.md` → empty); no leaked `/home/<user>` paths or usernames in either file.
- **a11y state-driver** — `scripts/a11y-audit.mjs` has a 7th sweep state opening `#page-context-menu` via the
  new `renderer.js` top-level fn; `npm run a11y` (in the HAT/live-GUI env, admin key exported) reports the
  open-menu state with **no NEW violations** (or a single reviewed `ACCEPTED` entry if a real, justified
  finding surfaces). Under non-interactive WSLg the gate is **inconclusive** (recorded, flagged for HAT).
- **keydown regression** — `node --test test/unit/keydown-action.test.js` → 35/0; `git diff` confirms
  `src/main/main.js` `before-input-event` is untouched this leg; the global shortcuts are exercised by the
  `page-context-menu` spec's keyboard steps + the HAT.
- **tool count + suite** — `npm test` (879/0), `npm run typecheck`, `npm run lint` all pass;
  `automation-mcp-tools.test.js` "26 tools" + `automation-mcp-server.test.js` "tools/list returns 26 tools"
  green; `git diff src/main/automation/mcp-tools.js` empty.
- **behavior-test runs** — `/behavior-test page-context-menu` and `/behavior-test spellcheck` were run by the
  Flight Director; run logs exist at `tests/behavior/{slug}/runs/{ts}.md`; the verdict dispositions every
  WSLg-inconclusive visual step as macOS/HAT-authoritative (not a silent pass).

## Implementation Guidance

> **Documentation + test-spec + verification leg.** The source touch is limited to the additive a11y
> state-driver function (`renderer.js`) + the harness state (`scripts/a11y-audit.mjs`). The behavior-test
> **runs** are executed by the **Flight Director via `/behavior-test`**, not a Developer agent.

1. **Author `tests/behavior/page-context-menu.md`** (status `draft`, format per `.flightops/ARTIFACTS.md`
   "Behavior Test — Spec"; consult `AUTHORING.md` on the mission-control side for the process). Model the
   **Preconditions / dual-target / coordinate-click / admin-key** blocks on `toolbar-pins.md` (the menu is
   in the **chrome** renderer, read via `getChromeTarget` → `readDom`/`readAxTree`/`captureWindow`; the act
   side is `click {button:'right'}` for a real guest `context-menu` event + `pressKey`/`type`). **Intent:**
   verify SC6 — right-clicking web content opens the on-brand keyboard-operable custom menu (not native),
   with context-appropriate sections + Inspect, and the toolbar Unpin migrated onto it. **Why this paradigm:**
   the menu is rendered cross-process UI (guest event → main → chrome renderer) that no unit test reproduces.
   Suggested Steps (one logical checkpoint per row; every Expected Result a `getChromeTarget`-readable
   observable — the WSLg acceptance):
   - **Active-precondition probe** — admin client connects; `getChromeTarget()` returns a numeric chrome
     `wcId`; `tools/list` includes the drive/observe tools (presence-checked).
   - **Right-click a link** on a web page → `#page-context-menu` becomes visible in the chrome DOM with
     **Open link in new tab** + **Copy link** items (and always **Inspect**); it is the **custom on-brand
     menu**, NOT the native OS menu (the native menu is not in the chrome DOM — its absence is the negative
     observable). `[a11y]` `role="menu"` + `role="menuitem"`.
   - **Right-click an image** → image section (Open image / Copy image address / Save image) + Inspect.
   - **Select text, right-click the selection** → selection section (Copy / Search for "…") + Inspect.
   - **Right-click an editable field** → editable section (Cut/Copy/Paste/Undo/Redo, `editFlags`-gated —
     items omitted, not disabled, when the flag is falsy) + Inspect.
   - **Cursor position** — the menu opens at/near the right-click coordinates (read the node's position vs
     the click point; the webview-rect offset maps guest coords to chrome client coords).
   - **Keyboard nav** — with the menu open, `ArrowDown`/`ArrowUp`/`Home`/`End` move the roving focus across
     items (read `aria`/active element via `readAxTree`); `Escape` closes and focus returns off the hidden
     node (not stranded on `<body>`). `[a11y]`
   - **Shift+F10 / ContextMenu-key** — focus a chrome element (e.g. the address bar) and press the
     ContextMenu key → an **Inspect-only** menu opens anchored at that element (the chrome-focused path).
     *(In-guest Shift+F10 synthesizes a real guest `context-menu` event — note it as covered by the
     right-click steps, not separately scripted; the live in-guest keyboard render is HAT.)*
   - **No-op on internal pages** — activate a `goldfinch://settings` tab, right-click its content → **no**
     `#page-context-menu` appears (the whole wiring is behind the `!__goldfinchInternal` guard).
   - **Toolbar Unpin migration** — right-click `#toggle-media` (or `#toggle-privacy`/`#toggle-devtools`) →
     `#page-context-menu` opens with a single **"Unpin {Media|Shields|DevTools}"** `cm-item role="menuitem"`
     (the in-DOM custom menu, **not** native — the Leg-5 migration); activate it → the button gets `.hidden`
     **immediately** (live flip), `userData/settings.json` `toolbarPins.{item} === false` (filesystem
     observable — persistence), the settings-page pin toggle reflects it live, and focus lands on `#url`.
   - **Out of Scope** (HAT/macOS-authoritative): the menu's pixel-level on-brand *feel* (dark/gold styling
     vs the native menu — a visual judgment, HAT); the live **in-guest** Shift+F10 keyboard render under a
     real display; macOS native-menu suppression confirmation. Link related specs: `toolbar-pins.md`
     (pin/persist), `menu-dismissal.md` / `kebab-menu.md` (menuController contract regression),
     `devtools-cdp-conflict.md` (the Inspect → DevTools materialization, macOS-authoritative).

2. **Author `tests/behavior/spellcheck.md`** (status `draft`). Put a **WSLg known-limitation block at the
   top** (mirror `find-in-page.md`'s warning block): *"Under WSLg the red spellcheck squiggle does not paint
   into a `captureWindow` frame even when `isSpellCheckerEnabled() === true` (Leg-2 premise-audit); the
   squiggle-render and macOS native-speller suggestion steps are macOS/HAT-authoritative and expected
   INCONCLUSIVE on WSLg — do not fail them, disposition them."* **Intent:** verify SC3 — opt-in spellcheck
   (OFF by default, no egress until opt-in), squiggles on misspelled words, and suggestions reachable +
   correctable through the context menu. **Why this paradigm:** session-layer spellcheck + the live CDN
   fetch + the cross-process suggestion round-trip are real-environment behaviors no unit test reproduces.
   Suggested Steps:
   - **Default OFF — opt-in gate (WSLg-acceptance, STATE observable).** Fresh profile, spellcheck OFF
     (`settings.json` `spellcheck` absent/`false`). Open a web tab, focus an editable field, type a
     misspelled word, then right-click it. **Expected (WSLg-observable):** `settings.json` carries
     `spellcheck:false`/absent (filesystem), and the forwarded `page-context-menu` `params` carry an
     **empty/absent `misspelledWord`** and **empty `dictionarySuggestions`** (the menu shows no suggestions
     section) — i.e. the spellchecker is not engaged because the gate is OFF. **Design-review MEDIUM — the
     literal "no `.bdic` GET" is NOT measurable on goldfinch's own MCP surface:** there is no network tool
     in the 26-tool surface, and `evaluate` runs in the **guest main world** so it cannot reach the
     main-process `session.getSpellCheckerLanguages()` API. So the *no-egress assertion* (no
     `redirector.gvt1.com` `.bdic` GET) is **HAT / network-trace-authoritative** and lives in Out of Scope —
     NOT a WSLg pass. What WSLg asserts here is the **state proxy**: OFF by default + no spellcheck engagement
     in `params`. Do not author a `[mixed-frame]` network row (there is no network frame to pair it with).
     *(Setup-friendly: reset `settings.json` in Preconditions.)*
   - **Enable via Settings (WSLg-acceptance, state observable).** Open `goldfinch://settings` → Appearance →
     toggle the **Spellcheck** checkbox ON (`#spellcheck-enabled`, drive the guest toggle like `toolbar-pins`
     drives the pin toggles). **Expected:** the checkbox reads checked; `settings.json` `spellcheck === true`
     (persisted, filesystem); the help text shows the **new-tabs/reload** wording (Leg-2 conservative copy).
     `[a11y]`
   - **Squiggle on a misspelled word (macOS/HAT-authoritative — INCONCLUSIVE on WSLg).** In a **new** web
     tab (per the new-tabs wording), type a misspelled word into an editable field; wait. **Expected
     (HAT/macOS):** a red wavy underline renders under the misspelled word (screenshot observable). **WSLg
     disposition:** INCONCLUSIVE — the API toggle is confirmed but the squiggle doesn't paint into a captured
     frame; flag, don't fail.
   - **Right-click → suggestions → choose → correction applies (mixed acceptance).** Right-click the
     misspelled word → `#page-context-menu` shows a **spelling-suggestions section** (the
     `dictionarySuggestions` from `params`, capped at 8; "No suggestions" placeholder if empty) above the
     editable section. **WSLg-acceptance** that's drivable: the **menu plumbing** — that when `params`
     carries a `misspelledWord` + `dictionarySuggestions`, the suggestion items render in the chrome DOM and
     activating one fires the `correctMisspelling` round-trip (the field text changes — a DOM observable via
     `evaluate` on the guest, if the dict has loaded). **macOS-authoritative:** the native-`NSSpellChecker`
     suggestion list content + the visual correction on a real display. *(The suggestions only populate after
     the dict loads — the one-time CDN fetch on Linux; on WSLg the dict may already be cached or the fetch
     may not fire on `executeJavaScript`-driven focus, so treat a populated list as confirming the plumbing
     and an empty list as the dict-not-loaded case, NOT a failure — note this in the spec.)*
   - **Disable round-trips OFF.** Toggle the Settings checkbox OFF → `settings.json` `spellcheck === false`;
     `setSpellCheckerLanguages([])` clears the web sessions. *(macOS OFF-state — whether `NSSpellChecker`
     squiggles clear — is macOS-authoritative, Out of Scope.)*
   - **Out of Scope:** the **literal no-egress assertion** (that no `.bdic` GET to `redirector.gvt1.com`
     fires before opt-in, and exactly one per-language fetch after) — **HAT / network-trace-authoritative**,
     since goldfinch's MCP surface has no network-observation tool and `evaluate` can't read the main-process
     session (see the Default-OFF step; WSLg asserts the state proxy only); the macOS native-speller path (OS
     dictionary, no fetch — macOS-authoritative); the squiggle pixels (HAT); the find-bar / other editable
     affordances. Link: `page-context-menu.md` (the menu render itself), `settings-controls.md` (the
     Appearance toggle mechanics, as a regression).

3. **Update `tests/behavior/toolbar-pins.md` (by intent, surgical).** Read it first. Reframe **Step 14**
   (the "Right-click → native Unpin DevTools" / "HAT-only" row): the toolbar Unpin now renders the **in-DOM
   custom `#page-context-menu`** (a single "Unpin {item}" `cm-item role="menuitem"`), so it **is** drivable
   over the MCP surface (`getChromeTarget` → `readDom` → coordinate `click` on the menu item) — the same way
   `page-context-menu.md`'s toolbar-Unpin step drives it. Correct the **Out-of-Scope** carve-out that says
   the native Electron menu "is not in the renderer DOM, not drivable over the MCP surface" — that premise no
   longer holds for the unpin path. Keep edits minimal: do not rewrite the whole spec; just make the migrated
   path coherent (and you may cross-reference `page-context-menu.md` for the full toolbar-Unpin coverage so
   the two specs don't duplicate). Frame by intent — do not couple to a heading that the project owner may
   rename.

4. **Document in README + CLAUDE.md.** Read both first; locate the existing features/privacy prose (do not
   prescribe headings).
   - **README (`## Features` + the privacy prose):** add a **custom page context menu** bullet (right-click
     web content → on-brand keyboard-operable menu with link/image/selection/editable actions + Inspect;
     no-op on internal pages; the toolbar right-click Unpin uses the same menu). Add an **opt-in spellcheck**
     bullet (OFF by default; enable in Settings → Appearance; suggestions via the right-click menu). In the
     privacy-relevant prose, document the **accepted egress**: on **Linux/Windows**, the first editable-field
     focus *after you opt in* triggers a **one-time per-language Hunspell `.bdic` download from the Chromium
     dictionary CDN** (`redirector.gvt1.com/edgedl/chrome/dict/…`); **nothing is fetched while spellcheck is
     OFF (the default)**; on **macOS** the OS native speller is used and **no download occurs**. Also update
     the "Pinnable toolbar icons" bullet that says right-click gives an "Unpin **menu item**" so it reads as
     the on-brand custom menu, **and** add DevTools as the third pinnable item (the current bullet at ~:90-94
     names only Media/Shields — DevTools landed in Flight 3 and must be listed).
   - **CLAUDE.md:** rewrite the stale **"Right-click Unpin — main-owned write path"** section (line ~113):
     the renderer's three `contextmenu` listeners now call `openToolbarContextMenu(item, button)`, which
     opens the custom `#page-context-menu` (the 4th `menuController` consumer) in toolbar-mode; the new narrow
     chrome-trusted **`unpinToolbarItem(item)`** IPC + bridge (item-allowlisted, no origin gate) does the
     read-modify-write `{ ...settings.get('toolbarPins'), [item]:false }` + `broadcastToChromeAndInternal`;
     the native `Menu.popup` path + `toolbarContextMenu` bridge are **retired** (M02 closed). Add a
     **page context menu** architecture note (guest `context-menu` → `event.preventDefault()` → main →
     `page-context-menu` IPC → chrome `#page-context-menu`; the `page-context-correct` /
     `page-context-action` / `chrome-clipboard-write` channels; web-content-only) and a **spellcheck** note
     (session-layer gating via `setSpellCheckerLanguages`, default OFF, the accepted CDN egress on opt-in
     Linux/Windows, macOS `NSSpellChecker` no-fetch). Keep it accurate to the landed code; no operator paths.

5. **Add the a11y open-menu state-driver (warranted — investigated).** The harness drives chrome states by
   calling **renderer top-level function declarations** in the guest main world via the MCP `evaluate` tool
   (e.g. `togglePanel(true)`, `openLightbox({…})`, `applyToolbarPins({…})`). The open page-context menu has
   **no such reachable driver**: the harness can't fire a guest `context-menu` event, and the menu's open
   path is gated behind `const pageCtx` / `const pageContextEntry` / `const menuController` — **`const`s are
   NOT reachable from the main world** (only top-level `function` declarations are, since `renderer.js` is a
   classic script). So **add a new top-level function** to `renderer.js`, e.g.:
   ```js
   // Test/audit hook: open the page context menu with a representative synthetic params payload so the
   // a11y harness (which cannot fire a guest context-menu event) can audit the open #page-context-menu.
   // Builds a full-section menu (link + selection + editable + suggestions + Inspect) at a fixed chrome
   // coord. Not wired to any UI; reachable in the main world by the evaluate tool (classic-script global).
   function openPageContextMenuForAudit() {
     pageCtx.wcId = (activeTab() && activeTab().wcId) || null;
     pageCtx.params = {
       linkURL: 'https://example.com/', selectionText: 'sample', isEditable: true,
       editFlags: { canCut: true, canCopy: true, canPaste: true, canUndo: true, canRedo: true },
       misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'tea'], x: 80, y: 80
     };
     pageCtx.x = 80; pageCtx.y = 80; pageCtx.keyboard = true; pageCtx.toolbarItem = null;
     pageCtx.returnFocus = els.address;
     menuController.open(pageContextEntry, 0);
   }
   ```
   Then add a **7th sweep state** in `scripts/a11y-audit.mjs` after the `devtools-button` state (close the
   prior state's transient UI first if needed): `await evaluate(client, wcId, 'openPageContextMenuForAudit()');
   await sleep(400); allViolations.push(...(await runAxe(client, wcId, axeSource, 'page-context-menu')));`.
   **Also fix the harness's stale state-count comments while you're in the file (design-review):** the
   `5-state` / `5-state sweep` comment references in `a11y-audit.mjs` (the code already runs 6 states, so they
   are already wrong; the 7th makes them triply so) — update them to the post-leg count (`7-state`).
   The open menu must audit clean (`role="menu"` node, `role="menuitem"` buttons with text accessible names,
   `role="separator"` between sections, roving tabindex) — it reuses the already-a11y-passing `#container-menu`
   markup, so expect **no NEW violations**. Only extend `ACCEPTED` if a real, justifiable finding surfaces
   (and then with a reviewed `{ id, selector, state:'page-context-menu', reason }` entry — never an
   auto-dump). **Note on running:** the gate needs a live GUI + the admin automation key
   (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, export
   `GOLDFINCH_MCP_ADMIN_KEY`); under non-interactive WSLg it is **inconclusive** (the prior-leg reality) —
   the state-driver is added regardless so the audit *can* run in HAT/macOS; record the WSLg disposition.

6. **Regression sweep of the keydown / `before-input-event` handlers.** Confirm the Leg-3 refactor left
   behavior intact: `node --test test/unit/keydown-action.test.js` → 35/0 (the pure mapper); `git diff
   src/main/main.js` shows the main-side `before-input-event` is **untouched** this leg; and the full chrome
   shortcut set (F12/Ctrl+Shift+I, Ctrl+M, Ctrl+Shift+P, zoom, Ctrl+F find, new/close-tab, focus-address,
   reload) is exercised by the `page-context-menu` spec's keyboard steps + the optional HAT. Do **not**
   refactor either handler in this leg.

7. **RUN both behavior tests via `/behavior-test` (Flight Director).** After authoring + the docs/a11y/
   regression work, the **Flight Director** invokes `/behavior-test page-context-menu` and `/behavior-test
   spellcheck` (the run skill spawns the live Executor + Validator crew — not a Developer agent). The
   **WSLg-runnable observables are the acceptance**; the **squiggle-render + macOS native-speller** steps are
   **dispositioned as macOS/HAT-authoritative** in the run log (marked INCONCLUSIVE-on-WSLg with the
   disposition — never silently passed). Promote each spec `draft → active` once the operator has reviewed
   the first green/dispositioned run. Run logs commit to `tests/behavior/{slug}/runs/{ts}.md`; evidence stays
   at `/tmp/behavior-tests/goldfinch/{slug}/{ts}/` (never committed).

8. **Do NOT** add an MCP tool (DD7 — tool count stays **26**). **Do NOT** modify the Legs 1–5 feature source
   (the menu/spellcheck/toolbar code is *exercised*, not changed — the only `renderer.js` edit is the additive
   audit state-driver fn). **Do NOT** commit per-leg or signal `[COMPLETE:leg]`/`[HANDOFF:review-needed]` —
   this is the last autonomous leg of a deferred-commit flight; flight-level review + commit follow.

9. **Update `flight-log.md`** with the Leg 6 entry: the two spec structures (steps + WSLg-acceptance vs
   HAT/macOS-authoritative split), the a11y state-driver mechanism (top-level-fn-in-classic-script + the 7th
   sweep state + whether the open menu was clean), the toolbar-pins reframe, the README/CLAUDE.md doc
   locations, the keydown regression result, and the behavior-test verdicts (WSLg observables that passed +
   the dispositioned HAT/macOS items).

## Edge Cases

- **WSLg squiggle render is inconclusive (Leg 2).** The red wavy underline does not paint into a
  `captureWindow` frame on WSLg even with `isSpellCheckerEnabled() === true`. The `spellcheck` spec's
  squiggle-render step is **macOS/HAT-authoritative** and expected INCONCLUSIVE on WSLg — the spec's
  top-of-spec block says so, and the Flight-Director run **dispositions** it (not a silent pass, not a fail).
- **Page-context-menu CAN run under WSLg; spellcheck squiggle CANNOT.** The page context menu renders in the
  **chrome DOM** (read via `getChromeTarget`/`readDom`), and the act side (`click {button:'right'}`) fires a
  real guest `context-menu` event — so the menu presence/sections/keyboard/no-op-internal/toolbar-unpin are
  all genuine WSLg-acceptance observables. The spellcheck **squiggle** is a guest-rendered visual the WSLg
  compositor won't surface — hence the split: menu = WSLg-acceptance; squiggle = HAT/macOS.
- **Suggestions only populate after the dict loads.** On Linux the `dictionarySuggestions` populate only
  after the one-time `.bdic` CDN fetch; on WSLg the dict may be cached from a prior run or the fetch may not
  fire on `executeJavaScript`-driven focus. The spec treats a **populated** suggestion list as confirming the
  menu plumbing and an **empty** list as the dict-not-loaded case (NOT a failure) — and the Default-OFF step
  asserts the **state proxy** (OFF + no spellcheck engagement in `params`), which IS WSLg-observable; the
  literal no-`.bdic`-fetch egress assertion is HAT/network-trace-authoritative (no network tool on the MCP
  surface; `evaluate` can't read the main-process session) — see the MEDIUM note in Implementation Guidance.
- **behavior-test cold-start quirks (WSLg).** The `find-in-page` WSLg cold-start (first `findInPage` returns
  `{matches:0}`) is the precedent for warning blocks; for these specs, the analogous quirk is the spellcheck
  dict-not-yet-loaded case (above) and the Leg-4 blur-race (observed NOT to bite on WSLg — the chrome window
  blur fires ~26ms before the IPC, so the menu opens clean). Note any first-action warm-up the runs reveal.
- **a11y gate inconclusive under non-interactive WSLg.** `npm run a11y` attaches over the loopback MCP
  surface and needs a live GUI + admin key — prior legs recorded it inconclusive in non-interactive WSLg.
  The state-driver is added so the audit *can* run in HAT/macOS; the WSLg run is flagged inconclusive, the
  static structure (mirroring the passing `#container-menu`) is the interim assurance.
- **What's HAT-authoritative (not asserted as WSLg pass/fail):** the menu's pixel-level on-brand *feel*
  (dark/gold vs native); the live **in-guest** Shift+F10 keyboard render; the macOS native-speller squiggle +
  suggestion content + the macOS OFF-state squiggle clearing; the Inspect → detached-DevTools materialization
  (macOS-authoritative, cross-ref `devtools-cdp-conflict.md`). These live in each spec's Out of Scope.
- **No double-spec-overlap.** `page-context-menu.md` owns the menu render + the toolbar-Unpin coverage;
  `toolbar-pins.md` keeps the pin/persist/shortcut coverage and **cross-references** `page-context-menu.md`
  for the right-click-unpin path rather than duplicating it. `spellcheck.md` owns the opt-in/egress/suggestion
  plumbing and cross-references `page-context-menu.md` for the menu render itself.

## Files Affected

- `tests/behavior/page-context-menu.md` — **new** behavior-test spec (status `draft`).
- `tests/behavior/spellcheck.md` — **new** behavior-test spec (status `draft`).
- `tests/behavior/toolbar-pins.md` — surgical update for the migrated in-DOM unpin path (Step 14 +
  Out-of-Scope).
- `README.md` — context-menu + spellcheck feature docs + the accepted CDN egress (features/privacy prose);
  update the "Pinnable toolbar icons" right-click wording.
- `CLAUDE.md` — rewrite the stale native-menu "Right-click Unpin" section for the migrated path + custom
  component; add page-context-menu + spellcheck architecture notes.
- `src/renderer/renderer.js` — **additive** top-level `openPageContextMenuForAudit()` state-driver fn (the
  ONLY feature-source touch; opens a representative page-content menu for the a11y sweep).
- `scripts/a11y-audit.mjs` — a 7th sweep state (`page-context-menu`) calling the new driver; `ACCEPTED`
  extended ONLY if a real reviewed finding surfaces (default: unchanged).
- `tests/behavior/page-context-menu/runs/{ts}.md` + `tests/behavior/spellcheck/runs/{ts}.md` — committed
  run logs (Flight-Director-driven). Evidence at `/tmp/behavior-tests/goldfinch/{slug}/{ts}/` (never
  committed).
- `flight-log.md` — Leg 6 progress entry.
- **NOT touched:** `src/main/automation/mcp-tools.js` / the MCP layer (tool count **26**, DD7); the Legs 1–5
  feature source beyond the additive audit driver; `src/main/main.js` `before-input-event` (regression-
  confirmed untouched).

---

## Post-Completion Checklist

*(Deferred-commit workflow: land the leg `in-flight`→`landed`, update the flight log, do NOT commit or
signal `[COMPLETE:leg]`/`[HANDOFF:review-needed]` — this is the LAST autonomous leg; flight-level review +
commit happen after it.)*

- [x] Both behavior specs authored (valid format, status `draft`; WSLg-runnable observables as acceptance,
  macOS/HAT-authoritative parts marked in Out of Scope / top-of-spec block)
- [x] `tests/behavior/toolbar-pins.md` updated for the migrated in-DOM unpin path (surgical, by intent)
- [x] README + CLAUDE.md document the context menu + spellcheck + the accepted CDN egress (no leaked paths)
- [x] a11y open-menu state-driver added (`renderer.js` fn + harness 7th state); `npm run a11y` **inconclusive
  under non-interactive WSLg** (no live GUI + admin key — flagged, not faked; driver+state added so the
  gate CAN audit the open menu in HAT/macOS; `node --check` confirms the script parses)
- [x] Keydown / `before-input-event` regression confirmed (35/0 mapper tests; main-side untouched; shortcut
  set works)
- [x] Tool count **26** (`automation-mcp-tools.test.js` + `automation-mcp-server.test.js` green)
- [x] `npm test` (879/0) / `npm run typecheck` / `npm run lint` pass
- [ ] Both behavior tests RUN by the Flight Director via `/behavior-test`; run logs committed; WSLg-
  inconclusive visual paths dispositioned as macOS/HAT-authoritative (not silently passed) — **PENDING
  Flight-Director execution / HAT** (Developer authored the specs only; runs are FD-driven)
- [x] Update `flight-log.md` with the Leg 6 entry (spec structures + WSLg/HAT split; a11y state-driver
  mechanism; toolbar-pins reframe; docs locations; regression result; behavior-test verdicts)
- [x] Set this leg's status to `landed`; check off `verify-integration` in `flight.md`; (final leg) update
  `flight.md` status to `landed` + check off the flight in `mission.md`
- [x] Do NOT commit / signal per-leg — flight-level review + single commit follow this leg (honored — no
  commit, no `[COMPLETE:leg]`/`[HANDOFF:review-needed]` signal)

## Citation Audit

All citations verified against current code at leg design time (`OK`). Line numbers reflect the post-Leg-5
codebase (the file shifted across Legs 1–5; current verified lines given).

- `tests/behavior/toolbar-pins.md` — Step 14 ("Right-click → native Unpin DevTools", *HAT-only*) + Out-of-
  Scope ("a **native Electron menu** is not in the renderer DOM … not drivable over the MCP surface") —
  **OK, present and now stale** (Leg-5 moved the unpin into the chrome DOM). This leg's reframe target.
- `tests/behavior/find-in-page.md` — top-of-spec **WSLg known-limitation warning block** (the first
  `findInPage` cold-start returns `{matches:0}`) — **OK** (the warning-block precedent the `spellcheck` spec
  mirrors).
- `.flightops/ARTIFACTS.md` — "Behavior Test — Spec" format (frontmatter `Slug`/`Status`/`Created`/`Last
  Run`/optional `Cache`; Intent; Preconditions; Observables Required; Steps table with `[a11y]`/`[mixed-
  frame]` markers; Out of Scope; Variants) + the evidence path
  `/tmp/behavior-tests/{project-slug}/{slug}/{YYYY-MM-DD-HH-MM-SS}/` (**outside the tree, never committed**)
  + run-log path `tests/behavior/{slug}/runs/{ts}.md` (committed) — **OK, exact** (project-slug = `goldfinch`).
- `scripts/a11y-audit.mjs` — the chrome sweep drives **6 states** (`base-chrome`, `media-panel`,
  `privacy-panel`, `lightbox`, `find-bar`, `devtools-button`) by calling renderer **top-level fns** in the
  guest main world via the MCP `evaluate` tool (`togglePanel(true)` `:273`, `togglePrivacy(true)` `:278`,
  `openLightbox({…})` `:282`, `openFind()` `:291`, `closeFind(activeTab())` `:305`, `applyToolbarPins({…})`
  `:307`); injects `axe.min.js` per state (`:198`) and diffs per-node against the curated `ACCEPTED`
  allowlist (`:117-133`, 7 app-shell/scroll entries). **No menu-open state today** — the harness cannot fire
  a guest `context-menu` event; chrome sweep needs `getChromeTarget` (admin-only) → `GOLDFINCH_MCP_ADMIN_KEY`
  (`:138-149`, `:37-41`). **OK** — confirms a new top-level state-driver fn + a 7th state is the right shape.
- `package.json:18` — `"a11y": "node scripts/a11y-audit.mjs"` — **OK**.
- `src/renderer/renderer.js:128` — `const menuController = (() => {…` (an IIFE, **`const`** — NOT main-world
  reachable). `:510` `const pageCtx` (NOT reachable). `:684` `const pageContextEntry = menuController.register(
  {…})` (NOT reachable). **`function` declarations** ARE reachable (classic script): `buildPageContextSections`
  (`:539`), `positionPageContextMenu` (`:669`), `closePageContextMenu` (`:728`), `openToolbarContextMenu`
  (`:794`), `togglePanel` (`:1290`), `openLightbox` (`:1534`), `closeLightbox` (`:1552`), `togglePrivacy`
  (`:1867`), `applyToolbarPins` (`:2057`), `openFind` (`:2173`), `closeFind` (`:2195`) — **OK**. This
  **confirms a new top-level `openPageContextMenuForAudit()` fn is warranted** (the open menu's path is gated
  behind unreachable `const`s + a guest event). `:684-726` the `pageContextEntry`/`menuController.open`
  surface the driver calls; `:738-748` the `onPageContextMenu` subscription (the real open path);
  `:761-784` the Shift+F10 chrome-focus handler (the keyboard invocation the spec exercises) — **OK, exact**.
- `src/renderer/index.html:213-214` — `<script src="../shared/keydown-action.js">` then
  `<script src="renderer.js">` (plain, **NOT** `type="module"`) — **OK**, confirms classic-script globals.
- `README.md` — `## Features` (`:33`), "Pinnable toolbar icons" right-click-Unpin wording (`:90-97`),
  Privacy & Shields prose (`:63-78`), `## Run`/`### Development` (`:125-139`), `## Keyboard shortcuts`
  (`:141`), `## Architecture` (`:173`). `grep -ni "spellcheck\|context menu\|context-menu\|redirector.gvt1\|
  NSSpellChecker" README.md` → **empty** (confirms absent today; this leg adds it) — **OK**.
- `CLAUDE.md:113-118` — "**Right-click Unpin — main-owned write path**": describes the **retired** native
  path (`window.goldfinch.toolbarContextMenu`, `ipcRenderer.send('toolbar-context-menu', …)`,
  `ipcMain.on('toolbar-context-menu', …)`, `Menu.buildFromTemplate`, **`item ∈ ['media', 'shields']`** —
  doubly stale: gone post-Leg-5 AND omits DevTools) — **OK, the stale section to rewrite**. Adjacent context:
  `:107` `applyToolbarPins` + `settings-changed` (still accurate); `:100-105` DevTools affordance (accurate).
  `grep -ni "spellcheck\|NSSpellChecker\|redirector.gvt1" CLAUDE.md` → **empty** (spellcheck absent; this leg
  adds it) — **OK**.
- Leg-5 flight-log hand-off (`flight-log.md` `migrate-toolbar-unpin` entry) — the toolbar Unpin now renders
  in the chrome DOM as `#page-context-menu` (single `cm-item role="menuitem"` "Unpin {label}"); right-click /
  ContextMenu-key on `#toggle-media`/`#toggle-privacy`/`#toggle-devtools` → menu just below the button;
  activating it hides the button immediately, syncs the settings-page toggle live, persists across restart,
  focuses `#url`; **Step 14's "native context menu" wording is stale** — **OK, exact** (the spec-update +
  page-context-menu toolbar-step source of truth).
- Leg-2 flight-log hand-off (`spellcheck-enable` entry) — the **accepted CDN egress** facts (Linux/Windows
  one-time per-language Hunspell `.bdic` GET from `redirector.gvt1.com/edgedl/chrome/dict/…` after opt-in;
  macOS `NSSpellChecker` no-fetch; nothing fetches while OFF; README/CLAUDE.md grep empty → Leg 6 documents
  it) + the **squiggle-render inconclusive-on-WSLg** classification (API toggle confirmed live; the red wavy
  underline doesn't paint into `capturePage`; conservative new-tabs/reload wording) — **OK, exact** (the
  README/CLAUDE.md egress copy + the `spellcheck` spec's WSLg/HAT split source of truth).
- Leg-1 flight-log hand-off (`context-menu-ipc` entry) — the spike payload (rich `params`:
  `linkURL`/`imageURL`/`srcURL`/`mediaType`/`selectionText`/`isEditable`/`editFlags`/`misspelledWord`/
  `dictionarySuggestions`/`x`/`y`); `dictionarySuggestions` empty until spellcheck ON; guest-side wiring +
  `page-context-correct` channel — **OK** (the `page-context-menu` spec's act/observe payload source).
- Leg-3/4 flight-log hand-offs — the `keydownToAction` extraction (`src/shared/keydown-action.js`, 35 tests;
  main-side `before-input-event` stays inline) + the Leg-4 menu sections / Inspect-via-`toggle-devtools` /
  blur-race-doesn't-bite-on-WSLg / the two new IPC channels — **OK** (the regression-sweep + the
  page-context-menu spec's section coverage source).
- `test/unit/automation-mcp-tools.test.js` ("26 tools") + `test/unit/automation-mcp-server.test.js`
  ("tools/list returns 26 tools") — **OK** (the DD7 no-new-tool guard; this leg adds none).
- **Negative confirmations:** `grep -rn "page-context-menu\|spellcheck" tests/behavior/*.md` → returns only
  `toolbar-pins.md`'s native-menu reference + nothing named `page-context-menu.md`/`spellcheck.md` (the two
  specs are net-new this leg). `grep -n "openPageContextMenuForAudit" src/renderer/renderer.js scripts/
  a11y-audit.mjs` → **empty** (the audit driver + state are net-new). Tool count **26** unchanged.
