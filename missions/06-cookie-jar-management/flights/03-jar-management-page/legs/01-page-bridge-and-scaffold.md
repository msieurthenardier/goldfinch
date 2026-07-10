# Leg: page-bridge-and-scaffold

**Status**: completed
**Flight**: [Jar Management Page](../flight.md)

## Objective

`goldfinch://jars` exists as a registered internal special page serving a live,
read-only jar list (name, color dot, default marker, static Burner row) — with the
full origin-gated `internal-jars-*` IPC bridge and preload wrappers in place for
Leg 2's interactions.

## Context

- **DD1**: the six `internal-jars-*` channels are registered in `src/main/jar-ipc.js`
  via `registerInternalHandler` (src/main/internal-ipc.js:67 — self-contained: bakes
  `isTrustedInternalSender`, Electron-free). jar-ipc requires `./internal-ipc`
  directly (like its existing `../shared/burner` require, jar-ipc.js:26-27 area) and
  reuses its already-injected `ipcMain`. **No deps-object change.** Each internal
  channel shares the exact handler body with its chrome twin (jar-ipc.js:61-128) —
  extract each body into a named function registered on both channels; do NOT fork
  logic. (Existing burner require precedent is the single line jar-ipc.js:28.)
- **DD2**: `jars-changed` already reaches internal sessions (main.js:2367 injects
  `broadcastToChromeAndInternal`; payload `{ containers, defaultId }`, `defaultId`
  null ⇔ Burner — jar-ipc.js:50-52). This leg only adds the preload subscription
  pair; zero main-side broadcast changes.
- **DD3**: page scaffold mirrors downloads (`src/renderer/pages/downloads.{html,css,js}`);
  list logic lives in a new pure dual-export `src/shared/jar-page-model.js`. Internal
  CSP has no `unsafe-inline` (main.js:117) — external scripts only,
  `createElement`+`textContent` only.
- **F2 D1 lesson (script-scope collision)**: the page document loads several classic
  `<script>` tags sharing ONE top-level lexical scope. `burner.js` declares
  `const BURNER`; any other served script must NOT redeclare it (resolve via a
  differently-named binding, cf. `RESOLVED_BURNER` in src/shared/container-menu.js).
  A vm shared-scope regression test for jars.html's script list is part of this leg
  (pattern: test/unit/chrome-shared-scripts.test.js).
- **F2 DD3 lesson (IPC identity)**: objects cross IPC by structured clone —
  `internal-jars-get-default` returns a CLONE of the frozen BURNER; the page compares
  by `id`, never by reference (the `defaultId === null` convention in the broadcast
  payload already encodes Burner-is-default without identity tricks).
- **Deliberately NOT this leg** (design-review ruling, cycle 1): the DD3 pseudo-jar
  name generalization (renderer.js:736 hardcodes `name: 'Settings'` for every
  trusted internal tab) is owned by **Leg 3** — the leg that touches renderer.js for
  entry points. Until Leg 3, a `goldfinch://jars` tab inherits the "Settings" label
  (inert: internal tabs render no dot). Leg 2/3 designers: this is NOT done yet.

## Inputs

- Flight 2 merged (`51e1ea6`); suite 1154/1154 green; branch
  `flight/03-jar-management-page` checked out.
- Existing internal-page plumbing: `INTERNAL_PAGES` map (main.js:89-108),
  `createResolver` (src/main/internal-assets.js:45), `INTERNAL_ORIGINS` in
  src/main/internal-ipc.js:24 AND src/preload/internal-preload.js:23 (two copies,
  kept in sync), `isInternalPageUrl` backed by the internal-hosts list in
  src/shared/url-safety.js (~:104-121), the internal preload's numeric-handle
  `on()/off()` map (internal-preload.js:34-61).

## Outputs

- `goldfinch://jars` serves html/css/js under the internal CSP; page shows the live
  jar list and updates on any jar mutation without reload.
- Complete internal jar bridge: six gated channels + preload wrappers
  (`jarsList/jarsAdd/jarsRename/jarsRemove/jarsSetDefault/jarsGetDefault`,
  `onJarsChanged`/`offJarsChanged`) — Leg 2 builds interactions on these without
  touching main again.
- New pure module `src/shared/jar-page-model.js` with truth-table unit tests.

## Acceptance Criteria

- [x] `INTERNAL_PAGES` gains a `jars` host serving `/` (jars.html), `/jars.css`,
      `/jars.js`, `/jar-page-model.js`, `/safe-color.js`, `/burner.js` — the last
      three resolved from `src/shared/` (precedent: settings serves
      `audit-paging.js` from shared). Exact-match resolver untouched.
- [x] `'goldfinch://jars'` present in BOTH `INTERNAL_ORIGINS` copies
      (internal-ipc.js + internal-preload.js) — grep for `goldfinch://jars` in
      `src/` yields exactly these two plus any comment/doc hits enumerated at
      implementation.
- [x] `isInternalPageUrl('goldfinch://jars')` returns true (root-only semantics
      preserved — sub-paths still rejected); the unit spec that pins the
      internal-hosts predicate is extended with the new host (locate it by intent —
      grep `isInternalPageUrl` in `test/unit/`).
- [x] Six `internal-jars-*` channels registered through `registerInternalHandler`
      inside `registerJarIpc`, each sharing a single named handler function with its
      chrome twin (list/add/rename/remove/set-default/get-default). Chrome channels
      byte-identical in behavior (existing jar-ipc tests pass unmodified).
- [x] `test/unit/jar-ipc.test.js` extended: internal variants are registered on the
      injected ipcMain (channel presence + shared-handler equivalence — mutating via
      `internal-jars-add` is observable via `jars-list`). NOTE: invoking the wrapped
      internal handlers requires a trusted fake event mirroring
      internal-ipc.test.js:88-94's `trustedEvent()` shape (`senderFrame.origin:
      'goldfinch://jars'` + `sender.session.__goldfinchInternal: true`) — the
      existing jar-ipc harness's fake `ipcMain.handle` (jar-ipc.test.js:60-64) only
      captures `(channel, fn)` pairs. `test/unit/internal-ipc.test.js` predicate
      matrix gains the `goldfinch://jars` origin case.
- [x] `internal-preload.js` exposes the six `jars*` wrappers + `onJarsChanged`/
      `offJarsChanged` via the existing handle map; page cleans up on `pagehide`
      (settings.js:138-142 pattern).
- [x] `src/shared/jar-page-model.js`: pure, dual CJS/global export,
      `buildJarPageModel(containers, defaultId)` returning ordered rows — persistent
      jars (id, name, color, `isDefault`) followed by the static Burner row
      (`isDefault` true iff `defaultId == null`); no DOM, no Electron. Truth-table
      tests in `test/unit/jar-page-model.test.js`: flagged jar marked; Burner-default
      when null; empty registry → Burner-only list; input array not mutated.
- [x] `jars.html`/`jars.css`/`jars.js`: dark-palette CSS custom properties matching
      the existing pages; `<title>Cookie Jars — Goldfinch</title>`; jars.js is a
      single IIFE that boots via `jarsList()`+`jarsGetDefault()`, renders via
      `buildJarPageModel` with `createElement`+`textContent` only, sets dot colors
      through `isSafeColor` (fallback `#9aa0ac`), subscribes `onJarsChanged`
      (wholesale re-render), unsubscribes on `pagehide`. No edit controls this leg.
- [x] NEW sibling vm shared-scope test `test/unit/jars-page-shared-scripts.test.js`
      that parses jars.html's OWN `<script>` list from the file (self-derived like
      chrome-shared-scripts.test.js:37-46 — not hand-maintained) and replays ALL of
      its scripts (burner.js, safe-color.js, jar-page-model.js, AND jars.js itself)
      in one vm context — parse-time collisions (e.g. a second top-level
      `const BURNER`) fail the suite. A sibling test is REQUIRED, not optional: the
      existing net's script-discovery regex only matches `../shared/*.js` relative
      srcs, while internal pages use flat srcs served by the protocol map — it
      cannot be pointed at a second html file (design-review verified).
- [x] `src/renderer/renderer-globals.d.ts` extended: `GoldfinchInternalBridge`
      gains the six `jars*` methods + `onJarsChanged`/`offJarsChanged`
      (precedent: the settings/shields/automation/downloads extensions at
      renderer-globals.d.ts:199-227), and a `declare function buildJarPageModel`
      entry joins the dual-export declarations (:327, :341 precedents) — required
      for the typecheck AC.
- [x] `npm test`, `npm run typecheck`, `npm run lint` all green; no existing test
      modified except the enumerated extensions.

## Verification Steps

- `npm test` (expect: all green, new files `jar-page-model.test.js` + the jars-page
  shared-scope test running; jar-ipc/internal-ipc/url-safety extensions pass).
- `grep -rn "goldfinch://jars" src/` — hits only the two INTERNAL_ORIGINS copies,
  the INTERNAL_PAGES/url-safety registrations, and enumerated comments.
- `node -e "const m=require('./src/shared/jar-page-model.js'); console.log(m.buildJarPageModel([],null))"`
  — burner-only list, `isDefault: true`.
- Live proof of serving + live-update is Leg 5's real-boot matrix (this leg's suite
  covers everything requireable; the page render path is DOM-only by design).

## Implementation Guidance

1. **jar-ipc.js**: extract the six handler bodies into named functions
   (`handleList`, `handleAdd`, …). Register each twice: `deps.ipcMain.handle('jars-…')`
   (unchanged behavior) and `registerInternalHandler(deps.ipcMain, 'internal-jars-…', …)`.
   Update the module header comment (it currently documents the chrome-only trust
   domain per F1 DD7 — note the internal domain added per F3 DD1).
2. **internal-preload.js**: wrappers are thin `ipcRenderer.invoke` calls; the
   subscription pair follows `onSettingsChanged`/`offSettingsChanged`
   (internal-preload.js:89-96 — the settings pair specifically, not the wider
   shields block) verbatim on channel `jars-changed`.
3. **jar-page-model.js**: consume Burner identity via the shared-scope-safe
   resolution (see container-menu.js's `RESOLVED_BURNER` comment); dual export
   (`module.exports` + `globalThis` guard) like default-routing.js.
4. **Page files**: copy downloads.html's skeleton (meta, external css/js, list
   container — including `aria-live="polite"` on the list element, downloads.html
   precedent, since the list re-renders on broadcast); script order in jars.html:
   `burner.js` → `safe-color.js` → `jar-page-model.js` → `jars.js`.
5. **INTERNAL_PAGES**: follow the existing entries' `path.join(__dirname, …)` shape
   exactly; shared-file entries point into `../shared/`.
6. Do not add entry points, CRUD controls, or renderer changes — Legs 2/3 own those.
   The page is reachable this leg via
   `window.createTab('goldfinch://jars', null, { trusted: true })` (chrome eval),
   which is how Leg 5 and the HAT will drive it.

## Edge Cases

- **Boot/broadcast race**: a mutation can broadcast between the page's one-shot boot
  reads and subscription setup. Subscribe FIRST, then boot-read, and make renders
  wholesale-replace (last write wins) — same shape as renderer.js `applyJarsState`.
- **Empty registry**: `jarsList()` → `[]`, `jarsGetDefault()` → BURNER clone;
  page shows Burner row only, marked default.
- **Colors**: store-clamped, but the page still guards `style.background` with
  `isSafeColor` (defense in depth; menu-overlay.js:202 precedent).
- **Frozen-BURNER clone across IPC**: compare ids, never references.

## Files Affected

- `src/main/jar-ipc.js` — internal channel registrations + header note
- `src/main/internal-ipc.js` — INTERNAL_ORIGINS + test-relevant comment
- `src/preload/internal-preload.js` — INTERNAL_ORIGINS copy, jars wrappers,
  subscription pair
- `src/main/main.js` — INTERNAL_PAGES `jars` host (data-only edit)
- `src/shared/url-safety.js` — internal host added
- `src/shared/jar-page-model.js` — NEW pure module
- `src/renderer/pages/jars.html`, `jars.css`, `jars.js` — NEW page
- `src/renderer/renderer-globals.d.ts` — GoldfinchInternalBridge + declare entries
- `test/unit/jar-page-model.test.js` — NEW; `test/unit/jars-page-shared-scripts.test.js` — NEW
- `test/unit/jar-ipc.test.js`, `test/unit/internal-ipc.test.js`,
  `test/unit/url-safety.test.js` (:229-303 pins isInternalPageUrl) — extended

---

## Citation Audit

All code citations in this leg were verified against HEAD `51e1ea6` during flight
design (two Explore sweeps 2026-07-10) and independently re-verified by the flight
design review (Architect, cycle 1) hours before this leg was drafted; no commits have
touched the repo since. Symbol-form citations (registerInternalHandler,
INTERNAL_PAGES, INTERNAL_ORIGINS ×2, isInternalPageUrl, handle map, jar-ipc channel
block, broadcast injection site main.js:2367, CSP main.js:117, settings pagehide
pattern) all carry their verified line anchors inline above.

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (deferred-review mode: `completed` comes at
      the flight-level commit)
