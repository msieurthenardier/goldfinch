# Flight: Default-Jar Semantics

**Status**: in-flight
**Mission**: [Cookie Jar Management](../../mission.md)

## Contributing to Criteria

- [ ] Exactly one jar is the default at all times; **new tabs open in the default jar** —
      this flight lands the new-tab-routing half (the flag-moving UI is Flight 3's page;
      the IPC to move it already exists and is live-exercised here)
- [ ] Burner always exists … **deleting the last persistent jar makes Burner the default**
      — this flight lands the routing consequence (new tabs open as evaporating burner
      tabs while Burner holds the flag)
- [ ] *(plumbing for criterion 3)* Rename/recolor **propagates to open tabs and the
      container picker without restart** — the renderer's `jars-changed` listener and
      open-tab re-render land here; Flight 3 adds the UI that makes it user-drivable
- [x] *(retired at recon)* Reserved-default site (a), the jar store's validation floor —
      retired by Flight 1 (jars.js v2 rewrite; remaining `'default'` literals in jars.js
      are migration **data**: the legacy seed and the v1 repair candidate, deliberate)

---

## Pre-Flight

### Objective

Retire every remaining reserved-`default` assumption in the product and route all
partition-less behavior through the live default flag. After this flight: the renderer
has no hardcoded `DEFAULT_CONTAINER` (new tabs — including the boot tab, context-menu
opens, and automation `openTab` without a jar — resolve the flagged default jar, or a
fresh evaporating Burner tab when Burner holds the flag); the main process has no
`PAGE_PARTITION` constant (privacy handlers operate strictly per-tab, the legacy
pre-warm is gone); the dev auto-mint mints for the *resolved* default jar instead of the
literal id `default`; the tab-strip dot policy treats the default jar as a normal jar;
and the frozen `BURNER` constant is consumed everywhere its identity is currently
triplicated. No new UI — Flight 3 builds the management page on these semantics.

### Open Questions

- [x] Does the renderer need a `jars-changed` listener this flight, or can the boot
      snapshot stay stale until Flight 3? → **Listener lands now** — see DD2 (set-default
      and rename are live IPC as of Flight 1; without a listener the tab strip and picker
      lie the moment anything mutates, including during this flight's own HAT).
- [x] Does new-tab routing need the DD2 (F1) relaxation — explicit Burner-as-default
      while persistent jars exist? → **No** (store semantics already match the mission:
      Burner holds the flag only via last-jar deletion; `add()` into an empty store
      auto-claims the flag — jars.js:257-259, jars.js:286).
- [x] Auto-mint when the resolved default is Burner (mint guard forbids burner ids):
      skip, mint-first-persistent, or fail loudly? → **Skip with a single parseable
      stderr notice** — see DD7 (mission open question, owned by this flight).
- [x] What replaces the privacy handlers' `PAGE_PARTITION` fallback session? →
      **Nothing** — per-tab handlers refuse when the tab is gone; see DD4.
- [x] Fate of the always-warmed base partition (mission open question)? → **Retired
      entirely**; not collapsed into "current default". See DD5 — the `session-created`
      hook already applies protections to every jar session on first use, and the
      legacy-probe premise rests on on-disk history, not the runtime pre-warm.

### Design Decisions

**DD1 — Renderer default resolution**: `createTab(url, null)` resolves the container at
call time from live state: `defaultId === null` → `makeBurner()` (a fresh evaporating
burner tab — the mission's "Burner is the default" meaning, mission.md "Burner design
stance"); otherwise the `containers` entry with `id === defaultId`. The boot tab is
gated on the jars snapshot (DD3), so no hardcoded fallback container exists anywhere in
the renderer; `DEFAULT_CONTAINER` (renderer.js:106) is deleted, not aliased.
- Rationale: one resolution point covers every partition-less call site (new-tab button,
  context-menu opens, `onOpenTab`, zero-tabs guard, automation `openTab` without jarId,
  boot tab) — retiring site (c) wholesale instead of patching six call sites.
- Trade-off: automation `openTab` with omitted `jarId` changes meaning from "legacy
  `default` jar" to "current default jar (possibly a burner)" — this is the *documented
  intent* of the tool (docs/mcp-automation.md:363 "omit to open in the default
  container"); the doc's surrounding prose is updated, not the contract. **Scope of the
  change is admin-identity only** (Architect review, cycle 1): a jar-scoped key's
  `openTab` with omitted `jarId` is unconditionally forced to that key's own jar
  (src/main/automation/scope.js:157-163 — `engine.openTab(url, jar.id)`) and never
  reaches this resolution logic; untouched by this flight.

**DD2 — Renderer subscribes to `jars-changed`**: the renderer replaces its
`containers` array and `defaultId` wholesale from each `{ containers, defaultId }`
broadcast (Flight 1 already ships the event and the `onJarsChanged` preload wrapper,
chrome-preload.js:61 — zero listeners today), then re-renders open tabs' jar dots
(color + title) and refreshes `tab.container` references by id match.
- Rationale: set-default/rename/remove are live, chrome-reachable IPC as of Flight 1;
  a snapshot-only renderer shows stale dots/picker the moment they're used — including
  by this flight's own HAT and behavior test. This is the plumbing half of mission
  criterion 3 (propagation), landed where it's first needed.
- Trade-off: tabs whose jar was *removed* keep their last-known container object
  (they're live sessions on a wiped partition); closing those tabs is management-UI
  behavior owned by Flight 3/5, deliberately out of scope here.
- Note: the wholesale replace also fixes the boot-time empty-registry bug — the current
  `if (list && list.length)` guard (renderer.js:109) keeps the phantom placeholder
  when the registry is legitimately empty.

**DD3 — Boot tab waits for the jars snapshot**: the initial tab creation
(renderer.js:2649) gates on `Promise.all` of the home-page setting **and** the jars
boot snapshot (`jarsList()` + `jarsGetDefault()`; the pair is read once and reconciled),
eliminating the startup race the mission's Architect flagged ("only benign today
because the hardcoded value happens to equal the real default").
- **Reconciliation contract (Architect review, cycle 1 — HIGH)**: `jars-get-default`
  (jar-ipc.js:95) returns the raw `jars.getDefault()` result — a container object or
  the frozen `BURNER` sentinel — and the reference-identity trick jar-ipc.js uses
  internally (`d === BURNER`) is **meaningless across the IPC boundary** (the renderer
  receives a structured clone). The renderer MUST detect the sentinel by id:
  `defaultId = (d && d.id !== BURNER.id) ? d.id : null` (global `BURNER` from
  burner.js, loaded per DD8; the reserved-id namespace guarantees no persistent jar
  can hold id `burner` — jars.js `isReservedId` + `slug` remap). Naively storing
  `d.id` would set `defaultId = 'burner'`, match no container, and — with the old
  `|| DEFAULT_CONTAINER` fallback deleted — crash `createTab` on an emptied-registry
  boot, exactly DD1's headline scenario.
- Rationale: with `DEFAULT_CONTAINER` gone there is nothing to race against; correctness
  by sequencing instead of by coincidence.
- Trade-off: boot tab waits on one extra IPC round-trip (~single-digit ms; same
  mechanism as the settings read it already awaits).

**DD4 — Privacy handlers are strictly per-tab**: `privacy-cookies` /
`privacy-clear-cookies` (main.js:2354, main.js:2372) drop the
`session.fromPartition(PAGE_PARTITION)` fallback — a missing/destroyed `webContents`
returns the channel's empty/failure value instead of silently operating on the legacy
jar. `privacy-clear-storage` (main.js:2392) — which today *always* acts on the legacy
partition, a real cross-jar bug for any non-legacy tab — gains `webContentsId` in its
payload (renderer call site renderer.js:1761 passes `tab.wcId`) and resolves
`wc.session` like its two siblings.
- Rationale: these handlers answer "this tab's jar"; acting on an arbitrary partition
  when the tab is gone is a wrong-jar data operation, exactly the class of bug the
  mission exists to eliminate.
- Trade-off: a destroyed-tab race now surfaces as an empty panel / failed clear rather
  than a silently-wrong success. Correct, and consistent with `identity-new`'s
  containment.

**DD5 — `PAGE_PARTITION` retired entirely**: delete the constant (main.js:65), the
whenReady pre-warm block (main.js:2436-2439), and the spellcheck-toggle legacy apply
(main.js:1637). The `session-created` hook (main.js:2405) already applies Shields,
download handling, and spellcheck to every web session on first creation; the
`getAllWebContents()` sweep (main.js:1640) already covers live sessions on toggle.
- Rationale: the pre-warm existed to service the reserved default jar; with routing
  through the flag, the legacy jar is an ordinary jar that gets protections the same
  lazy way every other jar does.
- Premise (verified at design time): the jars.js legacy-migration probe
  (`Partitions/goldfinch` existence) is **not** runtime-dependent on the pre-warm — the
  probe only runs when `containers.json` is absent, and any profile that ever ran
  pre-v2 code has the directory on disk from those runs; any profile that ran Flight 1+
  code has `containers.json` (persisted synchronously in `load()`, D1 fix). Removing
  the pre-warm cannot flip a fresh profile to the legacy branch.
- Trade-off: none identified — the partition string `persist:goldfinch` survives as
  migration *data* (jars.js LEGACY_DEFAULTS / the id-'default' guard at jars.js:108),
  which is correct and untouched.

**DD6 — Tab-dot policy, default is a normal jar**: the dot suppression
`jar.id === 'default'` (renderer.js:713) is retired; only the `internal` (Settings)
pseudo-jar stays dotless. Every user jar — including whichever holds the default flag —
shows its color dot.
- Rationale: the suppression encoded "default = no container chosen". Post-F1 the
  default is a real, named, colored jar (Personal on fresh installs); its dot is
  identity information, and suppressing by literal id would hide the dot on a migrated
  profile's legacy jar even after the user renames it to something meaningful.
- Trade-off: migrated profiles see a new grey dot on legacy-jar tabs — a deliberate,
  visible signal that the old "Default" is now an ordinary jar. HAT (Leg 4) confirms
  the feel; if the operator hates it, the fallback posture is *suppress the
  current-default jar's dot* (dynamic, not literal-id) — an Adaptation-Criteria
  variation, not a divert.

**DD7 — Auto-mint resolves the default jar**: the dev auto-mint block (main.js:2529)
mints for `jars.getDefault()`. When the resolved default is `BURNER` (reference
identity — empty registry), it prints one parseable stderr notice
(`[mcp] dev auto-mint skipped: default is Burner (no persistent jars)`) and continues —
the surface still binds, matching today's failure containment.
- Rationale: resolves the mission's open question with least surprise — keys belong to
  persistent jars (the mint guard already refuses burner ids, mcp-server.js:870), and a
  harness that auto-mints against an empty registry gets a diagnosable skip instead of
  a jar minted for an identity the operator never chose. For `automation-key-gating.md`
  the minted jar matches what the spec expects on both real profile shapes once its
  fixture is generalized (below); the other two auto-mint specs need the same
  generalization — see the fixture-migration bullet.
- Trade-off: a zero-jar dev profile gets no auto jar key (admin key, gated separately
  by `GOLDFINCH_AUTOMATION_ADMIN`, still mints) — acceptable: that state is reachable
  only by deliberately deleting every jar.
- docs/mcp-automation.md:124-127 (the "literal `default` / fresh-install gap" block)
  and :60-62 are rewritten to describe the resolved-default behavior; the interim-gap
  language retires with the gap.
- **Behavior-spec fixture migration (Architect review, cycle 1 — HIGH)**: the
  checked-in spec `tests/behavior/automation-key-gating.md` hardcodes the auto-mint
  target as the literal `default` jar (Preconditions bullet 3; Steps 1/2/6 assert "the
  `default` jar row"/"a non-empty `default` key hash"). Post-DD7 on a fresh-seed
  profile no `default` jar exists, so the spec's own precondition probe would halt —
  silently voiding a previously-passing regression spec, against the mission's
  "existing behavior tests must keep passing" constraint. Leg 2 generalizes that
  spec's fixture wording to "the resolved-default jar (read via `jarsGetDefault()`)".
  **All three auto-mint-dependent specs carry this defect class (Architect review,
  cycle 2 — HIGH; the cycle-1 claim that two were already safe was wrong)**:
  `mcp-jar-scoping.md` (:24, :36, :59, :61, :70) and `mcp-auth-gating.md` (:26, :40,
  :66, :67) hardcode `personal` as the mint target — accurate post-DD7 only on an
  untouched fresh-seed profile, and this flight's own Leg 3/4 set-default exercises
  can move the flag out from under them. Leg 2 migrates the **mint-target** references
  in all three specs to resolved-default phrasing; where a spec deliberately stages
  tabs in `personal` as a fixture, that stays, but its preconditions gain "verify (or
  set) that `personal` currently holds the default flag" so the auto-mint keys the jar
  the staged tabs live in. Leg 3 re-verifies all three specs' preconditions together
  (spec-text audit; a full re-run of all three is not an acceptance gate of this
  flight). One more doc-drift fix rides along: `tests/behavior/spellcheck.md:25` names
  `PAGE_PARTITION` in its Intent prose — functionally unaffected (its assertions are
  state-proxy/new-tab observables), prose updated in Leg 2.

**DD8 — `BURNER` constant consumed at all three duplication sites**: `burner.js` is
added to index.html's shared-script block (before container-menu.js,
src/renderer/index.html:188); `makeBurner()` (renderer.js:490-492) derives `name` and
`color` from the global `BURNER`; `buildContainerModel`'s sentinel (container-menu.js:36)
resolves `BURNER` hybrid-style (`module.exports` present → `require('./burner')`, else
`globalThis.BURNER`) so the same file serves the test runner and the script-tag chrome.
- Rationale: F1 debrief recommendation 2; burner.js's own header flags the triplication
  (src/shared/burner.js:17-18). The `burner-<n>` per-tab id/partition scheme is
  identity-bearing and unchanged — only the display name and color literals collapse.
- Trade-off: index.html gains one script tag; load order becomes a (documented,
  test-pinned) dependency.

### Prerequisites

- [x] Flight 1 merged to main (`d1e6be0`; v2 store, six IPC channels, `jars-changed`
      broadcast, preload wrappers incl. `jarsGetDefault`/`onJarsChanged` all present)
- [x] Store semantics already handle the flag lifecycle this flight consumes
      (auto-claim on first add, flag migration on remove — verified jars.js:257-259,
      jars.js:286, jars.js:295-313)
- [x] Chrome-renderer evaluation apparatus for driving mutations without UI (proven in
      F1 Leg 4: MCP attach — note free-port fallback on this rig, F1 debrief D2 — +
      `getChromeTarget`-based chrome evaluation; used by Leg 3's behavior test and
      Leg 4's HAT)
- [ ] GUI-capable dev environment (WSLg) for Legs 3-4 real boots — confirm at Leg 3
      start
- [x] XDG_CONFIG_HOME scratch-profile isolation technique (proven F1 Leg 4, Step-0
      probe)

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (one runtime confirm deferred to Leg 3 start, marked above)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Two code legs split on the process boundary, then a verification leg, then HAT.

**Renderer (Leg 1)**: delete `DEFAULT_CONTAINER`; hold `containers` (starts `[]`) +
`defaultId` (starts `undefined` until the boot snapshot lands) as the single source of
truth; `resolveNewTabContainer(containers, defaultId)` extracted as a **pure shared
helper** (new `src/shared/` module, dual-export like container-menu.js) so the
routing truth-table is unit-testable without DOM: returns the default jar's container,
or `null` meaning "make a burner" (the caller invokes `makeBurner()` — burner minting
stays in the renderer because it's per-tab stateful, `burner-<n>` counter). Boot:
`Promise.all([settingsGet('homePage'), jarsBoot])` where `jarsBoot` performs the
snapshot reads and populates state, then creates the boot tab. `onJarsChanged` replaces
state and re-renders open-tab dots. Dot policy per DD6. BURNER consumption per DD8.

**Main (Leg 2)**: DD4 + DD5 + DD7 — a single sweep of main.js (net-negative lines
except the auto-mint resolution), plus the renderer/preload payload change for
`privacy-clear-storage` (one-line each side), the docs/mcp-automation.md rewrite of
the auto-mint block, and the behavior-spec text migrations from DD7 (mint-target
generalization in `automation-key-gating.md`, `mcp-jar-scoping.md`, and
`mcp-auth-gating.md`; `spellcheck.md` prose). After this
leg, `grep -rn "PAGE_PARTITION" src/` → 0 and `grep -n "'default'" src/main/main.js`
→ 0.

**Verification (Leg 3)**: real-boot matrix on XDG scratch profiles (fresh → boot tab in
Personal with green dot; migrated v1 → boot tab in legacy jar, now dotted; auto-mint
resolved-default on both; delete-all-jars via chrome-driven IPC → next tab is a burner)
+ first M06 behavior test `new-tab-default-routing` (spec authored at this flight's
design, `tests/behavior/new-tab-default-routing.md`) + full suite/typecheck/lint +
grep ACs. The Leg-3 grep sweep covers `test/` and `tests/behavior/` as well as `src/`
(Architect review, cycle 1: the `automation-key-gating.md` gap lived entirely in
`tests/behavior/`, which `src/`-scoped ACs would never catch), and re-verifies the
preconditions of the three auto-mint-dependent specs (`automation-key-gating`,
`mcp-jar-scoping`, `mcp-auth-gating`) against the DD7 behavior.

**HAT (Leg 4, interactive)**: operator-witnessed walkthrough of the same semantics on
their real dev profile — the FD drives set-default/rename/delete through the chrome
apparatus, the operator judges the visible behavior (dots, picker, routing, burner
fallback, propagation to open tabs) and the DD6 dot-policy feel.

Test-suite posture (from F1 debrief): 1132 tests, ~5s, zero flakes; per-file process
overhead dominates, so new tests join existing files where natural (container-menu
tests) and at most two new files land (the routing helper's, and none for main.js —
its changes are deletions covered by integration + behavior test).

### Checkpoints

- [x] **CP1**: Renderer routes every partition-less tab through the live flag (Leg 1;
      helper truth-table green, `DEFAULT_CONTAINER` gone)
- [x] **CP2**: Zero reserved-default assumptions outside migration data
      (Leg 2; grep ACs above)
- [x] **CP3**: Real-boot matrix + `new-tab-default-routing` behavior test pass (Leg 3)
- [ ] **CP4**: Operator HAT sign-off (Leg 4)

### Adaptation Criteria

**Divert if**:
- Gating the boot tab on the jars snapshot visibly degrades startup or exposes an
  ordering dependency between the settings read and jar IPC (would force a
  fallback-then-reconcile design — a different flight shape)
- The legacy-probe premise in DD5 turns out runtime-dependent after all (a fresh-profile
  real boot misclassifying as legacy in Leg 3)

**Acceptable variations**:
- DD6 fallback posture (suppress the *current-default* jar's dot dynamically) if the
  operator rejects always-dotted at HAT
- Doc wording, test-file organization, exact stderr notice text
- Behavior-test spec step adjustments discovered during its first run (spec is `draft`
  until it passes once)

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and
> created one at a time as the flight progresses.

- [x] `renderer-default-routing` - DD1/DD2/DD3/DD6/DD8: retire `DEFAULT_CONTAINER`,
      boot-snapshot gating, `jars-changed` listener + open-tab re-render, routing
      helper, dot policy, BURNER consumption
- [x] `main-retirement-sweep` - DD4/DD5/DD7: privacy handlers per-tab, `PAGE_PARTITION`
      deleted, auto-mint resolves default; preload/renderer payload change + MCP doc
      rewrite
- [x] `verify-integration` - real-boot matrix (fresh / migrated / emptied registry),
      run `/behavior-test new-tab-default-routing`, grep ACs, full suite
- [ ] `hat-default-semantics` *(interactive — HAT)* - operator-witnessed verification
      and DD6 feel check; fixes applied inline until operator is satisfied

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated (docs/mcp-automation.md auto-mint + default-container
      wording; README/CLAUDE.md only if their jar sections state retired behavior)

### Verification

- `grep -rn "PAGE_PARTITION\|DEFAULT_CONTAINER" src/ test/` → 0 matches (comments in
  historical flight artifacts exempt)
- `grep -n "'default'" src/main/main.js src/renderer/renderer.js` → 0 jar-related
  matches (jars.js migration-data literals exempt and enumerated in the recon
  report; renderer.js's `thumb.style.cursor = 'default'` is a CSS cursor value,
  exempt — enumerated at Leg 3 design review)
- `grep -rln "the .default. jar\|literal .default." tests/behavior/*.md` → 0 specs
  still asserting the literal reserved jar (fixture migration per DD7)
- `grep -rn "ff8c42" src/` → exactly 1 match (src/shared/burner.js)
- Full suite + typecheck + lint green; F1 count (1132) strictly increased
- `/behavior-test new-tab-default-routing` → pass (run log committed)
- HAT session recorded in flight log with operator sign-off
