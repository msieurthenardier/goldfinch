# Flight: Per-Jar Data Controls

**Status**: landed
**Mission**: [Cookie Jar Management](../../mission.md)

## Contributing to Criteria

- [ ] Per-jar data controls let the user clear cookies, site storage, and cache
      independently, and perform a full identity wipe (data + fingerprint persona); the
      effect is observable (e.g. a logged-in site returns to logged-out).
      *(mission criterion 7 — this flight's primary charter)*
- [ ] The user can rename and recolor an existing jar; the change propagates to open tabs
      and the container picker without restart, and the jar's stored data is preserved.
      *(mission criterion 3 — re-verified under the relayout: edit mode is replaced by
      instant-apply inline controls; the propagation guarantee must survive the rework)*
- [ ] Burner storage isolation gets its first direct pin: a cookie written in one burner
      tab is not readable in another. *(closes the `popup-jar-inheritance` Validator
      carry-forward; strengthens mission criterion 6's never-share-state clause)*

---

## Pre-Flight

### Objective

Rework `goldfinch://jars` from a flat row list into the settings-style master-detail
layout — a left link-tree nav (one entry per jar, plus "+ New jar") and a right
scrolling main with one always-expanded section per jar — and give each persistent
jar's section data controls: clear cookies, clear site storage, and clear cache
independently, plus a full identity wipe (data + fingerprint persona reroll). Every
data action sits behind the in-page two-step confirm; the full wipe auto-reloads the
jar's open tabs so the logged-out effect is immediately visible. The clearable data
classes live in a pure shared module so history clearing slots in later without a
layout rethink. The flight also ships the broadcast-invariant test net (F3 debrief
Rec 3) and a HAT that deliberately exercises the two F3 carry-forward paths with zero
live witness.

### Open Questions

- [x] UX shape for data controls → operator ruling: no expanding panels — settings-style
      layout, sections always expanded, left link tree, edit button removed, "+ New jar"
      moves to the sidebar. See DD1.
- [x] Edit apply model with the edit button gone → operator ruling: instant apply
      (swatch click applies immediately; name commits on Enter/blur). See DD6.
- [x] Which actions get confirmations → operator ruling: confirm EVERY clear (cookies,
      storage, cache, wipe — and delete keeps its F3 confirm). See DD5.
- [x] Post-clear tab handling → operator ruling: auto-reload the jar's open tabs after a
      FULL WIPE only; granular clears leave tabs alone. See DD4.
- [x] Broadcast-invariant net: this flight or Flight 5 → operator ruling: this flight.
      See DD8.
- [x] HAT leg → operator opted in. See Legs.

### Design Decisions

**DD1 — Settings-style master-detail relayout**: `goldfinch://jars` adopts the settings
page's structure: a left `<nav>` of anchor links into one scrolling `<main>` of
`<section id="{jarId}">` blocks, with scroll-spy setting `aria-current` (the
settings.js IntersectionObserver pattern — `src/renderer/pages/settings.js:4-95`).
Differences from settings, by necessity:
- The nav and sections are DYNAMIC — rebuilt from `jars-changed` broadcasts (settings'
  nav is static HTML). The scroll-spy must re-observe after each rebuild.
- Each nav entry shows the jar's color dot + name (+ the Default pill on the holder);
  a "+ New jar" button sits in the nav under the jar links.
- Each jar section is always expanded and contains: inline name input + swatch grid
  (instant apply, DD6), "Make default" text button (F6 ruling: it stays text), the
  data-controls block (DD3/DD5), and Delete (icon button, F3 confirm copy verbatim).
- Rationale: operator-specced; matches the house internal-page dialect; removes the
  edit-mode state machine entirely.
- Trade-off: rename-in-place while broadcasts re-render is a new failure surface
  (see DD6's focus-preservation clause); the F3 HAT-verified row layout is replaced
  wholesale one flight after landing.

**DD2 — Clearable data classes as a pure shared module** (`src/shared/jar-data-classes.js`):
a frozen, ordered list of class descriptors `{ id, label, storages }` mapping onto
Electron's `ses.clearStorageData({ storages })` taxonomy
(`ClearStorageDataOptions` — electron.d.ts:20369):
- `cookies` → `['cookies']`
- `storage` (label "Site storage") → `['filesystem','indexdb','localstorage','websql','serviceworkers','cachestorage']`
- `cache` → `storages: null` sentinel; the handler maps it to `ses.clearCache()` +
  `clearStorageData({ storages: ['shadercache'] })`
- Dual-export (CJS + browser global), truth-table tested — the
  jar-page-model/guest-forward-allowlist house pattern. Onboarding is a DOCUMENTED
  four-part step (F3 debrief: promoted from recurring deviation; 4-for-4 recurrence),
  ALL owned by leg 1 so the module is page-loadable before leg 2 touches the DOM:
  eslint.config.mjs global + renderer-globals.d.ts declare + a `jars.html` classic
  `<script>` tag + an explicit `'/jar-data-classes.js'` entry in main.js's
  `INTERNAL_PAGES.jars` map (CLAUDE.md: per-file entries, never a directory
  passthrough). *(Architect review: the serving-path half was unassigned in the
  draft.)*
- Rationale: mission constraint — extensible list so history slots in later as one
  more descriptor; page renders buttons FROM the list, so extension is data-only.
- Trade-off: the cache class needs a sentinel (clearCache is a method, not a storages
  set) — one special case in the handler, none in the page.

**DD3 — Jar-scoped clear/wipe IPC, twin-registered in jar-ipc.js**: two new channels
following the F3 DD1 extract-don't-fork pattern (`src/main/jar-ipc.js` — shared
handler bodies registered bare on chrome-trusted channels AND through
`registerInternalHandler` on `internal-jars-*` twins):
- `jars-clear-data` / `internal-jars-clear-data`, payload `{ id, classes: [...] }` →
  resolves the jar's partition from the registry, applies each requested class per
  DD2, returns `{ ok, cleared: [...] }`. Unknown jar id, Burner (no partition on the
  identity object), or an empty/invalid classes array → `{ ok: false }`. Partition
  lookup is `jars.list().find(...)` inline — the store deliberately exposes no
  `get(id)` helper, and the handlers should not grow one for two call sites
  *(Architect note: named here so the implementer doesn't invent a divergent idiom)*.
- `jars-wipe` / `internal-jars-wipe`, payload `{ id }` → the full identity wipe:
  `clearStorageData()` + `clearCache()` + `rerollSeed(ses)` — the same composition as
  the per-tab `identity-new` (`src/main/main.js:2461`) and the delete path's wipe
  (`jar-ipc.js:handleRemove`), minus registry removal and minus automation-key revoke
  (the jar still exists; its key stays valid). Returns `{ ok }`, and broadcasts
  `jar-wiped { id }` (DD4) BEFORE resolving.
- Preload wrappers on BOTH sides: `internal-preload.js` (`jarsClearData`, `jarsWipe`
  for the page) and `chrome-preload.js` (same names — parity with the existing
  chrome-side `jars*` set, and the behavior-test act path, DD9). The chrome preload
  ALSO needs the new `onJarWiped`/`offJarWiped` subscription wrapper for DD4's
  broadcast — the `onJarsChanged` one-liner pattern; no such listener exists today.
  Action wrappers land in leg 1; the `onJarWiped` listener lands in leg 3 with the
  sweep it feeds. *(Architect review: was unnamed in the draft.)*
- Rationale: jar-ipc.js already holds every injected dep the handlers need
  (`session`, `rerollSeed`); twin registration keeps the two trust domains
  behavior-identical by construction.
- Trade-off: `identity-new`'s composition is now written in three places (identity-new,
  handleRemove, handleWipe). Deliberate: identity-new is partition-keyed and lives in
  main.js's trust domain; forcing a shared helper across the module boundary couples
  main.js to jar-ipc internals for three lines. Revisit if a fourth copy appears.

**DD4 — Reload-after-wipe via broadcast sweep**: `jars-wipe` broadcasts
`jar-wiped { id }` through `broadcastToChromeAndInternal`; the chrome renderer
subscribes and reloads every open tab whose container id matches (the DD6-F3
`jars-changed` sweep precedent — broadcast-driven, renderer-owned). Granular clears
broadcast nothing and reload nothing (operator ruling).
- Per-tab reload uses the existing web-tab reload path (the `newIdentity` handler's
  own move — `renderer.js:2346`); internal tabs can't be in a persistent jar and
  burner tabs can't be wiped, so the sweep only ever touches web tabs.
- Rationale: the page can't reach the chrome renderer directly; broadcast is the
  house cross-surface mechanism, and render/act-from-broadcast is the established
  ordering rule.
- Trade-off: a wipe with many open tabs reloads them all at once — accepted; that is
  the point of the ruling (logged-out state immediately visible).

**DD5 — Confirm everything**: all five destructive actions per section — clear
cookies, clear site storage, clear cache, full wipe, delete — use the F3 in-page
two-step confirm idiom. Exactly one transient state exists page-wide at any time
(`ui` exclusivity retained: `{ mode: 'create' | 'confirm', rowId, action }`), and
Escape dismisses ANY transient state (the F3 rule, now with more states to cover).
Confirm copy is per-action; delete keeps the F3 verbatim copy; the wipe copy states
the persona reroll and the tab reloads ("Wipes this jar's cookies, site storage, and
cache, and rerolls its fingerprint. Open tabs in this jar will reload.").
- Rationale: operator ruling (chose confirm-everything over confirm-wipe-only).
- Trade-off: routine cache clears cost an extra click; accepted deliberately.

**DD6 — Instant-apply inline editing**: the edit mode is deleted. Each section has a
live name input (commits on Enter and on blur, via `jars-rename { name }`; page-side
trim remains the SOLE whitespace-name enforcement — F3 ruling) and the swatch
radiogroup applies on click (`jars-rename { color }`). Rendering stays
broadcast-driven (render from `jars-changed`, never from the invoke resolve — the
broadcast-before-resolve rule), which forces the one new hard requirement:
- **Focus preservation across broadcast re-renders**: sections keep DOM identity
  keyed by jar id; a re-render must not clobber the value or caret of a focused name
  input (the commit-on-blur model means the input's live value can differ from the
  store while focused). A rebuild that replaces the focused element loses the caret
  and, worse, fires blur → spurious commit. The renderer reconciles per-section
  instead of innerHTML-replacing the list.
- `reconcileUi` survives in reduced form: if the jar hosting the open confirm (or the
  focused editor) disappears from a broadcast, the transient state closes / focus
  drops gracefully. This is exactly the F3 zero-witness path — the HAT exercises it
  deliberately (DD9).
- Rationale: operator ruling; settings-page feel.
- Trade-off: per-keystroke state divergence between input and store is new; commit
  points (Enter/blur) keep rename traffic off the per-keystroke path.

**DD7 — Burner section**: Burner keeps its list identity — a nav entry and a
read-only section (name, fixed color, evaporating-semantics hint grouped in the
section per the F4-F3 ruling) with NO name input, NO swatches, NO data controls, NO
delete. Rationale: mission stance (Burner is an identity, not a jar — every burner
tab is its own ephemeral partition, so there is no jar-scoped data to clear; the
identity object has no `partition` field, which is also what makes the DD3 guard
natural). The `jars-wipe`/`jars-clear-data` rejection of `burner` is behavior-pinned
(DD9), closing the jar-delete run's Validator carry-forward on the partition-less
identity shape.

**DD8 — Broadcast-invariant test net**: a self-deriving source-scan unit test (the
`jars-page-shared-scripts.test.js` technique) asserting the project convention the F7
bug violated: every IPC handler that mutates settings (calls `settings.set`, or a
helper that does — mint/revoke) must broadcast `settings-changed` in the same handler
body. The net derives the handler inventory from the source (main.js + jar-ipc.js)
rather than a hand-kept list, so new handlers are enrolled automatically.
- Scope note (recon finding): F4's own clear/wipe channels do NOT mutate settings —
  the net's value here is regression armor for the existing surface, not coverage of
  this flight's additions. Operator chose to ride it here anyway.
- Trade-off: source-scan tests assert convention, not behavior; a handler that
  broadcasts conditionally may need an explicit allowlist entry with a comment.

**DD9 — Verification split (apparatus audit)**: same boundary as F3 DD9 — the MCP
apparatus refuses internal-page DOM (op-local guards in
`src/main/automation/observe.js`), so page-DOM behavior is HAT-owned and
store/session semantics are machine-owned.
- **Act path** (cited): chrome-target `evaluate` on `window.goldfinch.jarsClearData` /
  `jarsWipe` wrappers (DD3 adds them; precedent: the popup spec's step-3
  `window.createTab(url, window.makeBurner())` chrome-eval route, proven live) and
  in-tab `evaluate` with the admin key for cookie/storage writes (`document.cookie`,
  `localStorage`) — admin evaluate on WEB pages is exactly what the observe.js guards
  permit.
- **Observe path** (cited): in-tab `evaluate` reads (`document.cookie`,
  `localStorage.getItem`), `enumerateTabs` for tab identity (wcId stability across
  reload), and an in-memory window marker (`window.__probe = 1`) whose disappearance
  is the reload observable — an in-memory expando survives if and only if the tab did
  NOT reload. No new observability seams needed.
- **Not machine-assertable**: HTTP-cache clearing has no cheap in-page observable —
  the cache class is unit-verified (handler calls `clearCache`) and excluded from the
  behavior spec's assertions. Page DOM (nav tree, sections, confirms, instant-apply
  feel, focus preservation) is HAT-owned.
- Behavior spec: `jar-data-controls` (new, drafted at design time — see Verification),
  which also carries the burner cookie cross-check steps (this flight's third
  criterion) since its stage already exercises cookie state.

**DD10 — Documentation**: CLAUDE.md gets (a) the new channels/wrappers noted where
the jar IPC surface is described, and (b) the **shared-global onboarding checklist
paragraph** in the "Recurring module shapes" pattern note — all FOUR parts (eslint
global, d.ts declare, page `<script>` tag, `INTERNAL_PAGES` entry when a page loads
it) — the F3 debrief action item, folded here because this flight touches that file
anyway.
`docs/mcp-automation.md` is unaffected (no automation-surface changes).

### Prerequisites

- [x] Flight 3 merged to main (`4e1d980`) — page, twin-registration pattern, and
      picker entry points all live; suite 1242/1242 green on main.
- [x] Behavior-test apparatus proven this mission: launch via
      `XDG_CONFIG_HOME={scratch} GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`
      (admin key printed once to stdout; port may free-fall to 49709 on this rig —
      discover it), curl Streamable HTTP JSON-RPC, per-run fresh staging, teardown by
      killing the Electron main pid. Four consecutive clean stages on record.
- [x] `identity-new` composition confirmed at `src/main/main.js:2461`; `rerollSeed`
      injected into jar-ipc already (`main.js:2449-2457`).
- [x] `ClearStorageDataOptions.storages` taxonomy confirmed against the installed
      Electron's d.ts (cookies/filesystem/indexdb/localstorage/shadercache/websql/
      serviceworkers/cachestorage).
- [x] No new network services — no environment conflicts beyond the known port
      fallback.
- [x] GUI-capable session for the HAT leg (operator present — verified at execution).

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (HAT operator-presence item is at-execution by nature)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 lays the Electron-free substrate: the `jar-data-classes` pure module, the two
twin-registered handlers in jar-ipc.js (clear-data with the class mapping incl. the
cache sentinel; wipe with the reroll + `jar-wiped` broadcast), and the four preload
wrappers — all unit-tested through injected deps, plus the DD8 broadcast-invariant
net (same test-suite surface, no page dependency). Leg 2 performs the DD1 relayout
of the page (nav tree + always-expanded sections + scroll-spy + instant apply +
focus-preserving reconcile) with the data-controls block rendered from the DD2 list
but wired in leg 3, which adds the confirm-everything flow, the clear/wipe calls,
and the chrome renderer's `jar-wiped` reload sweep. Leg 4 verifies integration
against committed state (two-commit flight shape: review + commit after leg 3, then
leg 4 runs behavior tests against that baseline): the new `jar-data-controls` spec
plus a re-run of `jar-delete-closes-tabs` (its steps act via IPC, not page DOM, so
the relayout must not break it — cheap regression insurance). The HAT closes.

### Checkpoints

- [x] CP1: `jar-data-classes` + both handler pairs + preload wrappers unit-green;
      broadcast-invariant net enrolled and green (leg 1)
- [x] CP2: relayout renders — nav tree tracks `jars-changed`, sections always
      expanded, instant-apply rename/recolor round-trips, no edit mode remains (leg 2)
- [x] CP3: data controls end-to-end — every action confirm-gated, wipe reloads the
      jar's tabs via the broadcast sweep (leg 3; live-proven at leg 4's
      jar-data-controls run)
- [x] CP4: `jar-data-controls` behavior spec passes on a fresh stage (7/7);
      `jar-delete-closes-tabs` re-passes (5/5); suite + typecheck + lint green (leg 4)
- [x] CP5: HAT signed off — including the reconcileUi cross-surface race and
      create/confirm Escape paths deliberately exercised (leg 5)

### Adaptation Criteria

**Divert if**:
- Focus preservation under broadcast re-render proves unachievable without moving to
  per-keystroke rename commits or abandoning broadcast-driven rendering (would
  invalidate DD6 and reopen the apply-model ruling).
- `clearStorageData({ storages })` behaves partition-globally in a way that breaches
  jar isolation (would invalidate DD2/DD3 premises).

**Acceptable variations**:
- Confirm copy wording, nav/section styling details, feedback presentation (toast vs
  inline note) — operator-adjustable at HAT.
- The broadcast-invariant net's exact derivation mechanics (regex vs AST), as long as
  it is self-deriving.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and
> created one at a time as the flight progresses. This list will evolve based on
> discoveries during implementation.

- [x] `data-classes-and-ipc` — DD2 pure module + full four-part onboarding (eslint,
      d.ts, jars.html script tag, INTERNAL_PAGES entry), DD3 twin handlers + action
      wrappers, DD4 broadcast emission, DD8 invariant net, unit tests incl. the cache
      sentinel mapping to `clearCache()` + shadercache (CP1)
- [x] `page-relayout` — DD1 master-detail rework, DD6 instant apply + focus-preserving
      reconcile, DD7 burner section, edit mode removed (CP2)
- [x] `data-controls-ui` — DD5 confirm-everything data actions, wipe feedback, chrome
      `onJarWiped` preload listener + reload sweep (CP3)
- [x] `verify-integration` — behavior tests on fresh stages + suite/typecheck/lint
      against committed baseline (CP4)
- [x] `hat-jar-data-controls` — guided HAT incl. the F3 carry-forward paths (CP5)

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [ ] Documentation updated

### Verification

- **Unit gates**: `jar-data-classes` truth table; jar-ipc clear/wipe handler tests
  (class mapping, cache sentinel, burner/unknown-id rejection, wipe composition +
  broadcast order); DD8 invariant net; existing suite stays green.
- **Behavior test**: `/behavior-test jar-data-controls` (spec drafted at design time,
  `tests/behavior/jar-data-controls.md`) — cookie/storage clears observable in-tab,
  class independence (cookie clear leaves localStorage), cross-jar containment, wipe
  auto-reload via the in-memory-marker observable, burner/unknown-id rejection pin,
  and the burner cookie cross-check. Plus a `jar-delete-closes-tabs` re-run as
  relayout regression insurance.
- **HAT**: page-DOM half per DD9 — layout, nav scroll-spy, instant apply feel, focus
  preservation, every confirm flow, Escape from each transient state, reconcileUi
  race (delete a jar from the picker while its section's confirm/editor is engaged).
