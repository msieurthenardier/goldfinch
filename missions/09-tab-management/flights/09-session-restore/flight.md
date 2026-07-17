# Flight: Session Restore

**Status**: completed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [ ] When the operator enables session restore in Settings, quitting and relaunching
      brings back the previous session's windows and tabs (addresses + jar assignments);
      burner tabs are excluded by construction; with the setting off (the default), startup
      behavior is unchanged.
- [ ] Privacy and isolation hold everywhere tabs now move: a tab keeps its jar identity
      through reorder, reopen, tear-off, cross-window drag, and **restore**; nothing about a
      burner tab is ever persisted; jar isolation on the automation surface is unchanged.
      *(This flight discharges the **restore** clause and the **"nothing about a burner is
      ever persisted"** clause — the first time a burner exclusion is proven against a
      **disk** artifact rather than an in-memory container.)*

---

## Pre-Flight

### Objective

Give Goldfinch a setting-gated session restore: when the operator turns on "Restore session
on startup," a clean quit writes the open window/tab topology to disk, and the next launch
rebuilds those windows with their tabs — each tab **created fresh** at its saved **address**
and in its saved **cookie jar**. Burner and internal tabs never enter the snapshot (positive
persist-jar allowlist, the history-recorder precedent — no "is-not-a-burner" check). With the
setting **off** (the default) startup is **byte-identical** to today. The persistence layer is
a **new** `session-store.js` for open-window topology, cloning `downloads-store.js`'s
durability discipline (Electron-free, atomic temp+rename, never-throws, codec seam) — it is
**not** the closed-tab stack's own `toJSON`/`fromJSON` hooks, which persist the *reopen* stack
(a separate artifact, explicitly deferred — see DD-Scope). Along the way the flight lands the
F8 debts that sit on the paths it touches: the move-core structural fix (F8 Recommendation 5 —
a latent-defect generator that already produced two defects; genuine debt, though **not** a
restore prerequisite, since restore creates tabs fresh through the armed guard), the extracted
`shouldArm` arm-threshold predicate + its first unit test, and the small artifact-hygiene items.

### Open Questions

- [x] **Is the closed-tab persistence layer already on disk?** → No. `closed-tab-stack.js`
      is an in-memory pure factory; its `toJSON`/`fromJSON` are *designed and unwired*
      (module header, and `main.js` creates the singleton with no load/save). F9 builds the
      disk store. → DD1.
- [x] **How are burners excluded?** → Positive allowlist: a tab's `partition` must resolve to
      a registered jar (`jars.list().find(j => j.partition === entry.partition)`), gated by
      `!entry.trusted`. Burner (`burner:<n>`) and internal partitions match nothing → dropped
      by construction. This is `closed-tab-capture.js`'s exact predicate. → DD2.
- [x] **Does the snapshot need a renderer round-trip?** → No, for address+jar+active+grouping:
      all four are main-authoritative (`webContents.getURL()`, entry `partition`,
      `activeTabWcId`, `registry.records()`). Only strip **order** is renderer-authoritative. → DD3.
- [x] **Where is the snapshot captured — `before-quit` or the window `close` handler?** → The
      **`close` handler** (tabs still alive), NOT `before-quit`. On the close-last-window quit
      path the per-window `close` handler runs **first** and destroys every tab, so `before-quit`
      fires on an **empty** registry. The `close` handler is where closed-tab capture already
      lives (guests alive, history readable). → DD3 (corrected from the initial before-quit design
      after design review).
- [x] **Does restore adopt live tabs or create fresh ones?** → **Creates fresh.** Adopt
      (`removeChildView`/`addChildView`) re-parents a **live** view; at cold start there is no
      source view. Restore rebuilds windows and each renderer **creates** its saved tabs via the
      reopen boot precedent (`createTab(url, …)` resolving the jar from the partition). → DD4
      (corrected from the initial adopt design after design review).
- [x] **Does F9 wire the closed-tab (reopen) stack's cross-restart persistence?** → **No —
      explicitly out of scope.** The reopen stack is a distinct artifact with its own schema; its
      `toJSON`/`fromJSON` hooks stay unwired. This flight's `session-store` is the durability
      template a later flight can reuse to persist it cheaply. → DD-Scope.
- [x] **Restore navigation history?** → **No — out of scope** (criterion is "addresses + jar
      assignments"; F8 proved coordinates fiction; live `NavigationEntry` objects are an
      unproven serialization risk). Reopen (F4) carries history; restore carries address+jar. → DD5.
- [x] **Restore window geometry (size/position)?** → **No** — criterion asks for windows +
      tabs, not geometry; F8 measured this rig's window coordinates a cached fiction. Restored
      windows open at default bounds. → DD5.
- [x] **Crash recovery, or clean-quit only?** → **Clean-quit only.** The snapshot is written on a
      clean quit only — at the window `close` handler and the `before-quit` flush (DD3), never on a
      signal kill. An unclean exit writes nothing that session; the *last clean-quit* snapshot is
      what a later launch restores. → DD6.
- [ ] **Can the test apparatus quit + relaunch + reconnect?** → **Unknown; premise-gated.** The
      MCP surface has no self-relaunch op (once `appQuit()` fires the transport dies). The
      end-to-end restore test needs an out-of-band relaunch harness. Probed before the
      verification leg builds on it; NO-GO → structural layer carries the proof and the E2E
      cycle is HAT-scoped (F10). → DD9. *(This is the observability-axis apparatus premise —
      auditing it now, not mid-flight.)*
- [ ] **Strip-order fidelity on restore.** `tabViews` is insertion order, not visual order; a
      faithful order needs either a cheap main-side order source or a round-trip. Resolved at
      design review against actual code — accept insertion order (documented fidelity note) vs.
      a low-cost order signal. The criterion requires the tab *set* + jar + window grouping;
      order fidelity is a quality target, not a criterion gate. → DD3.

### Design Decisions

**DD1 — New Electron-free disk store (`session-store.js`), cloning `downloads-store.js`'s discipline.**
- Choice: a new `src/main/session-store.js` — **Electron-free** (`load(userDataPath)` injects the
  dir; never `app.getPath` at module scope), atomic **temp-beside + `renameSync`**, **never
  throws** (corrupt/missing → empty snapshot), a **codec seam** (`{serialize, deserialize}`
  default `JSON.stringify/parse`). On-disk shape is a single **object-schema** snapshot
  `{ version: 1, windows: [ { tabs: [ { url, jarId, active } ] } ] }` — one snapshot replaced
  wholesale each clean quit (settings-store's object schema, not downloads' array-of-records,
  because a session is one document not an append log).
- Rationale: the exemplar the mission named; makes the whole layer **unit-testable without
  running `main.js`** (recon G1 — every store in this repo is Electron-free by design).
- Trade-off: a second small store file rather than folding into settings-store; kept separate
  because its lifecycle (write-at-quit, read-at-boot, wholesale-replace) differs from settings'
  per-key set/get, and because a corrupt session snapshot must never poison settings.

**DD2 — Pure snapshot builder with the burner positive-allowlist, unit-tested both directions.**
- Choice: a pure `buildSessionSnapshot`-style function (its own Electron-free module, the
  `closed-tab-capture.js` shape) that takes the window records + a jars snapshot and emits the
  DD1 object. The per-tab jar gate is **verbatim** `!entry.trusted && jarsList.find(j => j.partition === entry.partition)`;
  a tab whose partition is not a registered jar is dropped. **No negative "is-burner" check anywhere.**
- Rationale: the mission's absolute constraint ("burner ephemerality is structural, not
  filtered") gets a **both-directions unit pin** (DD10) before it is wired — a burner-partition
  tab produces **0** persisted records; a persist-jar tab produces **1** — on the real predicate,
  mutated in memory.
- Trade-off: none material; mirrors the proven history-recorder / closed-tab-capture precedent.

**DD3 — Snapshot captured in the window `close` handler (tabs alive), main-authoritative, setting-gated.**
- Choice: capture per tab at the `close` handler — the site where closed-tab capture already runs
  *because* "the guests are still alive and their navigationHistory readable here": read
  `view.webContents.getURL()` (address), `entry.partition` → `jarId` via DD2's allowlist,
  `entry.active`/`rec.activeTabWcId` (active). **The invariant the write must satisfy is
  path-independent: the terminal on-disk snapshot equals the set of windows alive at the FIRST
  quit-initiating event.** Two writers coordinate to guarantee it (a `quitting` flag + a
  non-empty guard, both setting-gated):
  - **`before-quit`** (fires first on menu Exit / Cmd+Q, full registry alive): set `quitting=true`;
    write the full `registry.records()` snapshot **iff** the registry is non-empty. Runs **before**
    `mcpServer.stop()` (same "flush first" posture as `downloads.flushInterrupted()`).
  - **per-window `close`**: **suppressed when `quitting` is true** (before-quit already captured the
    authoritative full set — this is what stops the menu-Exit path from *shrinking* the snapshot
    window-by-window to just the last-closed one). When `quitting` is false it writes
    `registry.records()` — serving both mid-session dismissal and the close-last-window path (where
    `quitting` is still false and `before-quit` would otherwise fire on an empty registry).
  Strip **order** = `tabViews` insertion order (the manifest array is ordered) unless design review
  finds a cheaper main-side order source (open question).
- Rationale: the initial "build at `before-quit`" design was **refuted at review** — the two quit
  paths order **oppositely**. Close-last-window: `close` destroys tabs (`webContents.destroy()`,
  clears `tabViews`, nulls `activeTabWcId`) **before** `window-all-closed → app.quit() → before-quit`,
  so `before-quit` reads empty. Menu Exit: `before-quit` fires first (full registry), then each
  `close` fires *after* and would shrink the snapshot. The `quitting`-flag + non-empty-guard
  coordination (round-2 review) makes the terminal write correct on **both** paths and on
  mid-session window dismissal. Everything needed is main-authoritative — no renderer round-trip.
- Trade-off: a full-session write on close/quit (infrequent; matches `downloads.flushInterrupted`
  posture). Strip-order fidelity is best-effort unless a cheap order source exists (fidelity note,
  not a silent gap). *(Leg-3 design review owns the exact write-coordination code.)*

**DD4 — Restore at `whenReady`, gated on the setting; tabs CREATED FRESH; default-off is byte-identical.**
- Choice: at `whenReady`, after stores load, **if** the setting is on **and** a non-empty snapshot
  exists → rebuild each saved window via `createWindow({ noBootTab: true })` and have each renderer
  **create** its saved tabs **fresh** via the reopen boot precedent (`createTab(url, container, …)`
  resolving the jar from the saved partition, over the normal `tab-create` IPC), then activate the
  saved active tab; **else** → today's exact single `createWindow()` with `bootTab: true`. The
  minimal insertion wraps the single `createWindow()` call: `if (restoreOn && snapshot) { rebuild… }
  else { createWindow(); }` — the default-off branch changes **nothing**.
- **Manifest delivery (round-2 review, no chicken-and-egg):** stash the saved window's ordered tab
  list on the registry record at `createWindow({ noBootTab: true })` (exactly as `noBootTab` already
  rides the record) and extend `window-boot-config`'s return to
  `{ bootTab: false, restoreTabs: [{ url, jarId, active }, …] }`. `window-boot-config` is a
  renderer→main **invoke** issued from the renderer boot tail — that invoke **is** the readiness
  signal, so main never waits on a separate "renderer ready." The renderer boot loop creates each
  tab fresh in order (insertion-order fidelity for free) and activates the saved active tab.
- **Deleted-jar edge (round-2 review):** a manifest entry whose saved `jarId`/partition no longer
  resolves (jar deleted between quit and relaunch) is **dropped**, not home-tab-substituted; the
  verification spec must not assume it. Persist jars normally survive, so this is an edge.
- Rationale: adopt (`removeChildView`/`addChildView` + renderer `onAdoptTab`'s direct `tab.wcId =`
  with no `createTab`) re-parents a **live** view and is **structurally inapplicable at cold start**
  — there is no source `webContents` to move. The correct primitive is the **proven reopen boot
  path** (`renderer.js` `createTab(entry.url, …)` resolving jar from partition), a fresh create in
  a jar. Keeps the mission's "single-window is the regression baseline" constraint literally true.
- Trade-off: restored tabs start fresh at their URL (no back-stack — DD5), which is the reopen
  primitive's normal behavior.

**DD5 — Navigation history and window geometry are OUT of scope for restore.**
- Choice: the snapshot stores `url + jarId + active` per tab and window grouping only. No
  `navEntries`, no window bounds.
- Rationale: the criterion is "addresses + jar assignments." F8 measured this rig's window
  coordinates a cached fiction (geometry would restore fiction). Live `NavigationEntry` objects
  are an unproven `JSON.stringify` round-trip (in-memory reopen never serialized them) — pulling
  them in would import a serialization risk the criterion doesn't ask for. Reopen (F4) is the
  history path; restore is the address+jar path.
- Trade-off: a restored tab starts at its saved URL with a fresh history, not mid-back-stack.
  Honest to the criterion; the "where the platform supports it" clause governs *reopen*, not
  restore.

**DD6 — Clean-quit-only; crash recovery out of scope.**
- Choice: the snapshot is written only on a clean quit — at the window `close` handler and the
  `before-quit` flush (DD3), never on a signal kill. A crash (SIGKILL/SIGTERM) writes nothing that
  session; the atomic temp+rename (DD1) means a crash mid-write leaves the prior good file intact.
- Rationale: matches the conservative posture of `downloads.flushInterrupted()`. "Restore the
  previous session" is honest for clean quits; crash-recovery is a larger design not this flight's.
- Trade-off: a crash loses that session's topology, and the staleness can exceed one session
  (clean-quit A → relaunch → crash ⇒ next launch restores A, two sessions back). Acceptable and
  stated plainly.

**DD-Scope — The closed-tab (reopen) stack's cross-restart persistence is OUT of scope.**
- Choice: F9 does **not** wire `closed-tab-stack.js`'s `toJSON`/`fromJSON` to disk. The reopen
  undo-stack stays in-memory (unchanged from F4). This flight's `session-store` (open-window
  topology) is a **separate** artifact with a different schema.
- Rationale: the mission open question ("does the reopen stack persist across restarts … decided
  with the persistence design") is **decided here: no, not this flight.** Bundling would double the
  burner-exclusion surface and the test matrix for two independent features. The reopen stack's
  hooks already exist, so a later flight can persist it cheaply using this flight's `session-store`
  as the durability template.
- Trade-off: reopen history still doesn't survive a restart. Explicitly deferred, not forgotten.

**DD7 — Settings toggle follows the `automationEnabled` pattern (strict boolean validator).**
- Choice: add a `DEFAULTS` key (default **`false`**) with an explicit
  `typeof v === 'boolean'` validator in `settings-store.js`; a checkbox row in `settings.html`;
  a cloned spellcheck-style IIFE in `settings.js`. Main reads `settings.get(<key>)` **directly**
  at `whenReady` — no live side-effect, no renderer round-trip for the startup decision.
- Rationale: the closest proven template; the strict validator avoids truthy coercion; additive,
  no schema-version bump.
- Trade-off: none.

**DD8 — Move-core structural fix (F8 Recommendation 5) lands in leg 1 as genuine F8 debt.**
- Choice: stop `moveTabIntoWindow` pre-setting `target.activeTabWcId = p.wcId` into the disarmed
  `tab-set-active` guard. **Preferred (lower blast radius): feed `broadcastMoveTargetsChanged` an
  explicit caption for `p.wcId`** so the synchronous hide + `closeMenuOverlay('tab-switch')` stay,
  and only the shared-state mutation the caption needed is removed. The alternative (stop
  pre-setting entirely; let the round-trip's armed guard hide+close) is structurally cleaner but
  widens the window where two guests are momentarily visible. **Leg-1 design review picks.**
- Rationale: the pre-set/disarm pattern is a latent-defect generator — it already produced two
  defects one branch apart (HIGH-1 double-active; the re-shown stale menu). It is real F8 debt on a
  path this flight is in the neighbourhood of. **Correction from design review:** it is **not** a
  restore prerequisite — restore creates tabs fresh (DD4) via `tab-set-active`'s **armed** guard,
  which never pre-sets, so restore does not depend on this fix. Landing it in leg 1 is
  organizational (bundle the F8 code-shaped debts), not a dependency.
- Trade-off: HIGH-risk lifecycle change — gets its own design review (leg 1).

**DD9 — The end-to-end relaunch test apparatus is premise-gated (both-axes audit).**
- Choice: before the verification leg authors the `session-restore` behavior spec, **probe** an
  out-of-band relaunch harness (Bash relaunches `npm run dev:automation`, reconnects the admin MCP
  client) and report **GO/NO-GO**. GO → author and run the full quit→relaunch→observe spec. NO-GO →
  the unit/integration layer (DD1/DD2 stores + snapshot builder, both-directions) carries the
  structural proof and the E2E cycle is **HAT-scoped (F10)**, recorded honestly.
- Rationale: the MCP surface has no self-relaunch op (transport dies with the process) — recon G3.
  **The clean quit itself is drivable in-band** *because DD3 captures at the `close` handler*: the
  behavior test drives `windowClose()` on each window (the existing chrome bridge `tab-tearoff`
  row 9 already uses), and the last close fires the capture, then `window-all-closed → app.quit()`.
  A **SIGKILL would NOT fire the capture** — so the harness must let the app quit cleanly via that
  in-band gesture, then relaunch. Only the **relaunch + admin-client reconnect** is genuinely
  out-of-band; that is the sole unknown the probe must clear. The *observability* axis
  (enumerateWindows/enumerateTabs post-relaunch) is confirmed present.
- Trade-off: the E2E test may land HAT-scoped on a relaunch/reconnect NO-GO. That is a real, honest
  outcome — not a green spec over an unproven cycle (F8/F5's lesson). *(Design review lowered this
  risk: capture-at-close removed the "no in-band clean-quit" blocker; the relaunch remains to prove.)*

### Standing methodology carries (in force this flight)

- **DD10 — Two readings per state-asserting AC, on the real artifact, both directions.** Run each
  `grep -c` **standalone**; use **masked** greps for absence claims (`test/helpers/source-scan.js`).
- **Re-run gates AFTER flight-end review fixes (F8 Rec 1).** The commit message may claim **only**
  gate results measured on the final tree. F8's commit asserted "a11y green" on an unmeasured tree —
  the Completion Checklist below closes that gap.
- **Lateral-gap rule (F8 Rec 3).** An artifact may only record its **own** coverage; a cross-reference
  is a pointer, never a claim about another artifact's coverage. Applies to every behavior spec here.
- **DD11 — Line budgets are CODE lines, comments excluded (F8 Rec 4).** Documentation of a measured
  correction is not taxed. Exceed the code budget ⇒ stop and report.
- **A read-back is not a second reading unless it is a second instrument (F8 product #1).** F9 has no
  app-coordinate premise (DD5 scopes geometry out), so this bites only at the `tab-reorder` Step 4
  disposition — which is why the threshold moves to a **unit** pin (leg 1) and Step 4 is retired.
- **A row that drives a path is not coverage of it — assert the right observable (F8 product #2).**
  The `session-restore` spec must assert the **exact restored tab set with correct jarIds AND
  burners positively absent**, not a bare "windows came back."

### Prerequisites

- [ ] F9 branch `flight/9-session-restore` off the F8 head (done); PR stacks on `flight/8`.
- [ ] Suite green at F8's baseline (**1892 pass / 0 fail / 0 skipped**, 13 suites) before leg 1.
- [ ] Live rig available for the verification leg: `npm run dev:automation` (Wayland). Bind-probe
      for a free port — `ss -ltn` cannot see WSL2 ports held by Windows-side listeners. A live
      sibling Goldfinch may hold the default profile's port — leave it untouched.
- [ ] **Admin keys via env-var reference ONLY, never a command literal** (standing carry — an F6
      executor leaked one).
- [ ] Relaunch-harness probe (DD9) reports GO/NO-GO before the verification leg authors the E2E spec.

### Pre-Flight Checklist

- [x] All open questions resolved (strip order → insertion-order via ordered manifest, DD4; relaunch
      harness → premise-gated probe, DD9)
- [x] Design decisions documented (two review cycles; codebase-validated)
- [x] Prerequisites verified (branch, F8 baseline; live rig + relaunch probe checked at leg 4)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Four legs, ordered so the risky lifecycle change lands before the feature reuses its path:

1. **`f8-debt-and-move-core-fix`** (HIGH) — the move-core structural fix (DD8), the `shouldArm`
   extraction to `tab-drag-zone.js` + its first unit test (dx=0,dy=6 arms; dx=0,dy=4 does not),
   the `CALL_RE` comment off-by-one (nine→ten), and the F8 leg-file tick reconciliation. Lands the
   prerequisites the feature legs stand on. Design-reviewed (lifecycle change).
2. **`session-persistence-layer`** (HIGH — privacy-sensitive) — the Electron-free `session-store.js`
   (DD1) + the pure snapshot builder with the burner allowlist (DD2), both unit-tested
   **both-directions**. Pure modules + tests only; no `main.js` wiring. The burner invariant gets its
   disk-artifact pin here, before integration.
3. **`settings-toggle-and-lifecycle`** (HIGH — startup/lifecycle) — the settings toggle (DD7); the
   `session-store.load()` wired into the `initProfileAndStores` group (after the dev-profile
   `setPath('userData')` redirect, same discipline as `historyStore.open`); the **close-handler**
   snapshot write with the union-at-write rule (DD3), setting-gated, flushed at `before-quit`; the
   `whenReady` restore-rebuild that **creates tabs fresh** gated on the setting (DD4); default-off
   fall-through proven byte-identical. Design-reviewed (regression-baseline constraint is absolute).
4. **`verification`** (HIGH — authors assertions) — probe the relaunch harness (DD9); author + run
   the `session-restore` behavior spec (or HAT-scope the E2E on NO-GO); run `tab-tearoff` row 8a +
   the displaced-menu residual (the unrun HIGH-1 net); retire/re-instrument `tab-reorder` Step 4;
   all gates **standalone**, **a11y re-run after any flight-end fix** (F8 Rec 1).

### Checkpoints

- [x] Move-core no longer pre-sets into a disarmed guard; `tab-set-active` drives hide + menu-close
      through its armed guard. Suite green.
- [x] `shouldArm(dx,dy)` is a `tab-drag-zone.js` export with a both-directions unit test; `renderer.js`
      calls it.
- [x] `session-store.js` round-trips a snapshot through disk (atomic, never-throws, corrupt→empty);
      the snapshot builder drops burners (0 records) and keeps persist-jar tabs (1 record) on the
      real predicate, both directions.
- [ ] `session-store.load()` runs after the dev-profile `setPath('userData')` redirect (correct dir).
- [ ] Snapshot captured at the window `close` handler (tabs alive), union-at-write; the terminal
      write on **both** quit paths (close-last-window and menu Exit) reflects the windows then open.
- [ ] Setting off ⇒ startup path byte-identical **and no snapshot write** (no disk I/O). Setting on +
      snapshot ⇒ windows rebuilt with tabs **created fresh** at saved addresses + jars, active tab restored.
- [ ] Relaunch harness GO/NO-GO recorded; E2E restore verified live **or** HAT-scoped with the
      structural layer green.
- [ ] All gates green on the **final** tree (re-run after any flight-end fix).

### Adaptation Criteria

**Divert if:**
- The `close`-handler capture cannot read live tab URLs even at that site (unexpected teardown
  ordering) → move to incremental per-mutation main-side maintenance, record in the flight log.
- The `whenReady` fresh-create restore cannot reuse the reopen-boot `createTab` path cleanly →
  escalate the integration approach before building leg 3.

**Acceptable variations:**
- Strip-order fidelity resolved either way (insertion order + note, or a cheap order source).
- The E2E restore test landing HAT-scoped on a relaunch-harness NO-GO (DD9 anticipates it).

### Legs

- [x] `f8-debt-and-move-core-fix` — move-core structural fix (DD8) + `shouldArm` extraction & unit
      test + `CALL_RE` comment + F8 leg-tick reconciliation. **HIGH-risk.**
- [x] `session-persistence-layer` — `session-store.js` (DD1) + pure snapshot builder (DD2), both
      unit-tested both-directions. **HIGH-risk (privacy-sensitive).**
- [x] `settings-toggle-and-lifecycle` — toggle (DD7) + `session-store.load()` ordering + close-handler
      snapshot write (DD3/DD6, setting-gated) + `whenReady` fresh-create restore (DD4) + default-off
      byte-identity. **HIGH-risk (startup/lifecycle).**
- [x] `verification` — relaunch-harness probe (DD9 → **NO-GO**, E2E HAT-scoped to F10) +
      `session-restore` spec authored + `tab-reorder` Step 4 retired + row 8a dispositioned (unit-pinned;
      live → F10) + final-tree gates (test/lint/typecheck green; a11y not a verdict, not claimed). **HIGH-risk (authors assertions).**

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged (stacked PR on `flight/8` — PR opened at landing; `da586a8`)
- [x] Tests passing — measured on the final tree: `npm test` **1948 pass / 0 fail / 0 skipped**,
      `lint` + `typecheck` clean. `npm run a11y` produced **no verdict** (no admin key / live GUI) and
      is **not claimed green** (F8 Rec 1); the commit message claims only the measured gates.
- [x] Documentation — the setting is a user-facing toggle in the Settings page (self-documenting);
      the `session-store` is an internal main-process module. No CLAUDE.md/README change required;
      no reviewer flagged a doc gap.

### Verification

- Unit: `session-store` round-trip + never-throws + atomic; snapshot builder burner-exclusion both
  directions; `shouldArm` both directions; move-core guard behavior pinned where expressible.
- Integration/behavior: default-off startup byte-identical (no write, no read); setting-on restore
  rebuilds windows and creates tabs fresh at saved addresses+jars with burners **positively absent**;
  `tab-tearoff` row 8a + residual; `tab-reorder` Step 4 retired. E2E quit(in-band `windowClose`)→
  relaunch(out-of-band)→observe cycle live (DD9 GO) or HAT-scoped (DD9 NO-GO), stated honestly.
- **Regression guard for the DD3 two-writer bug (round-2 review):** quit a **2-window** session **via
  menu Exit**, relaunch, assert **both** windows restored — a single-window E2E would pass over the
  exact defect the coordination fixes.
- Gates: `npm test`, `npm run lint`, `npm run typecheck`, `npm run a11y` — each **standalone**,
  re-run after flight-end fixes.
