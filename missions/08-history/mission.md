# Mission: Per-Jar Browsing History

**Status**: active

## Outcome

The operator can always answer "where have I been?" — per jar, on their terms.
Every jar keeps its own browsing history: visible and manageable inline on the
manage-jars page, searchable from the address bar as you type, aging out
automatically under a retention policy the operator sets per jar, and readable
by automation only within the jar the client is keyed to. Burner tabs remain
truly ephemeral — nothing they visit is ever recorded. History deepens
Goldfinch's identity (visibility and control for the human *and* the agent)
instead of diluting the privacy posture that identity rests on: jar isolation
extends to history on every surface, with no exceptions.

## Context

Goldfinch has completed seven missions and currently records **no browsing
history at all** — back/forward is per-tab navigation state only, and the
address bar offers no suggestions from past visits. History support was
explicitly deferred twice (M06 sequenced jar management first so history could
land on a proven clear-data extension point; M07 ran a maintenance cycle
specifically to clear this mission's runway — ESM conversion of `src/shared/`,
seam contracts pinned, `main.js` growth checked).

Prior debriefs left concrete planning inputs this mission adopts:

- **The storage-substrate decision opens the mission** (M07 action item,
  BACKLOG "Persistent storage substrate"). Browsing history is high-cardinality
  (thousands to tens of thousands of rows) with prefix search on the hot path —
  a workload the existing whole-file JSON stores cannot serve. An indexed
  embedded store is required; whether it's the runtime's built-in engine or a
  vendored native module is an explicit go/no-go with the zero-runtime-dependency
  identity at stake (M03 MCP-SDK precedent). This mission builds **history only**
  on the new substrate; re-homing the settings and downloads stores is a
  follow-on mission (BACKLOG seed stands).
- **Per-jar is the unit of history** (M06 Architect forward analysis): the
  session partition is Goldfinch's isolation unit; burner tabs are mechanically
  excluded via the existing no-partition guard.
- **Surface shape** (operator ruling at mission design): there is **no
  standalone history page**. The manage-jars page is reorganized into
  collapsible per-data-class panels (history, cookies, other site data) with
  left-nav anchors serving the long scroll. History is one panel among several.
- **Automation posture** (operator ruling at mission design): history is
  exposed on the automation surface **jar-scoped only** — a jar-keyed client
  reads its own jar's history and nothing else, riding the existing
  session-identity façade (`scope.js`). Automation access is already opt-in
  per jar via key minting; operators who want automated browsing with history
  access can dedicate a jar (or jars) to it.
- **Contract carry-forwards** (M06/M07 debriefs): `history-changed` broadcasts
  need invalidation-signal semantics, not full-payload snapshots; new main-side
  wiring lands as a `registerXIpc`-style extraction; the first `result.error`
  consumer prefix-matches the `jars: <op> — <code>` branches; `JAR_DATA_CLASSES`
  is the verified extension point for history clearing (and plausibly the
  fourth wipe-composition copy that triggers DD3's extraction clause); run the
  execution-environment probe inventory proactively at flight design; re-read
  the four-gate internal-page pattern before design review; the outstanding
  CLAUDE.md pattern promotions **landed in M07 Flight 3** (doc promotions) —
  no doc-pass rider needed.
- **Architect viability check** (mission design, verdict: feasible with
  caveats): a live probe confirmed `node:sqlite` opens a database and creates
  FTS5 virtual tables inside a real Electron 42 main process — the built-in
  path is practically de-risked, though the module is still an **experimental**
  Node API (emits `ExperimentalWarning`; API may shift across runtime
  upgrades), which the go/no-go writeup must name as an ongoing cost, not
  gloss. Navigation observability is already wired at the right seam:
  `wireTabViewEvents` (main.js) listens to `did-navigate` /
  `did-navigate-in-page` / `did-finish-load` per guest and knows each view's
  partition — recording is an addition alongside an existing forward, not new
  instrumentation. Burner exclusion must gate on a **positive allowlist**
  (partition starts with `persist:container:`), never on "is not a burner" —
  burner partitions are distinguished by naming convention (`burner:<n>`, no
  `persist:` prefix), and an inverted check is a serious privacy leak. The
  jar-scoped automation façade already has multiple precedents for
  custom-scoped ops (`enumerateTabs`, `getDownloadsList`, …), so the history
  read tool follows an established shape. Address-bar suggestions are genuinely
  greenfield (no existing autocomplete code), justifying own-flight sizing.

## Success Criteria

- [ ] Visits to web pages in jar-backed tabs are recorded (address, title,
      visit time) and survive an app restart.
- [ ] Burner tabs and internal (`goldfinch://`) pages never produce history
      records — nothing from a burner session is persisted anywhere.
      *(behavior-test-backed)*
- [ ] Jar isolation holds for history on every surface: no web page, no
      address-bar session, and no jar-keyed automation client can observe
      history from a jar other than its own. *(behavior-test-backed)*
- [x] The manage-jars page presents each jar's data in collapsible panels
      (history, cookies, other site data) with left-nav anchors; panels
      expand/collapse independently and anchors jump to the right jar/section.
- [x] The history panel supports browsing recent visits, text search, deleting
      an individual entry, and clearing all history for that jar.
- [x] History participates in the jar data controls: clearing history via the
      data-class control and wiping a jar both remove that jar's history
      alongside its other data classes.
- [x] Each jar has its own retention policy (initial value 30 days), editable
      on the manage-jars page; entries older than the jar's retention are
      removed automatically without operator action.
- [ ] Typing in the address bar surfaces matching suggestions drawn
      exclusively from the active tab's jar history; a suggestion can be
      chosen by keyboard or pointer and navigates the tab.
      *(behavior-test-backed)*
- [ ] Suggestions stay felt-instant at scale: prefix lookups remain responsive
      against a history of tens of thousands of entries.
- [ ] A jar-keyed automation client can read its own jar's history through the
      automation surface; requests targeting any other jar are refused.
      *(behavior-test-backed)*
- [ ] History adds no network egress: recording, search, retention, and
      suggestions operate entirely locally.

## Stakeholders

- **The operator** — wants to find where they've been and get back there fast,
  without history becoming a cross-jar correlation surface or a silent data
  leak. Controls retention per jar.
- **Agentic platforms driving Goldfinch** — gain memory of what their jar has
  visited, scoped to exactly that jar; the trusted-automation pitch stays
  honest.
- **The project itself** — history is the workload that justifies the storage
  substrate; the decision made here shapes the follow-on store migrations.

## Constraints

- **Jar isolation is non-negotiable.** No surface — page content, omnibox,
  automation, IPC — may expose one jar's history to another jar's context.
  The chrome (manage-jars page) is the operator's own surface and shows all
  jars; that is the only place all histories are visible.
- **Burner exclusion is structural**, not a filter: burner sessions must never
  write history, so there is nothing to leak or forget to clear.
- **Substrate: built-in `node:sqlite`** (operator ruling at mission design,
  informed by the Architect's live probe — FTS5 confirmed working in Electron
  42's main process). The zero-runtime-dependency identity holds. Flight 1
  writes the decision record (M03-style), naming the experimental-API status
  as the accepted ongoing cost; a vendored native module is the fallback only
  if the built-in path hits a hard blocker mid-mission.
- **History only on the new substrate.** The settings and downloads JSON
  stores are untouched this mission (their migration is the follow-on
  storage-substrate mission).
- **No standalone history page** — the manage-jars page is the surface.
- **No new network egress.** Suggestions never call out (no search-engine
  suggestion blending); everything is local.
- **Do not copy `jars.js` whole-file-rewrite persistence** for this
  write-heavy store (M06 forward analysis).

## Environment Requirements

- Linux (WSL2) development host; the app runs as a GUI Electron process
  (existing `npm start` / dev-profile tooling).
- Electron **42.6.1** baseline (patch bump from 42.4.0 applied at mission
  sign-off; full unit suite + typecheck green). The 42 → 43 major bump is
  deliberately deferred to the post-mission maintenance sweep (BACKLOG entry)
  — Electron 42 remains in support through this mission.
- Unit tests via the repo's existing node test runner; no new test
  infrastructure expected.
- Behavior tests need a built, running Goldfinch with the goldfinch MCP
  apparatus attached (existing Witnessed-pattern setup); jar-scoped and
  admin keys mintable as fixtures.
- The substrate is the runtime's built-in engine (operator ruling), so no
  native-module build/CI changes are expected. If the fallback (vendored
  native module) is ever triggered, per-platform prebuilds **and**
  electron-builder packaging verification become prerequisites at that point.

## Open Questions

- ~~Substrate go/no-go~~ **Resolved at mission design** (operator ruling):
  built-in `node:sqlite`. Flight 1 writes the M03-style decision record —
  experimental-API status named as the accepted cost; vendored
  `better-sqlite3` is fallback-only (and would need electron-builder
  packaging verification — `build.files` has no `node_modules` entry).
- **Write path** (pin at Flight 1 design, first-class decision): `node:sqlite`
  is synchronous-only — no async or worker variant. A per-navigation write on
  the main-process event loop is precedented (settings/downloads write sync)
  but history writes at far higher frequency; options are batched/debounced
  writes, WAL mode, or offloading the store to a utility process. This
  decision also carries the "felt-instant" criterion for concurrent
  suggestion queries.
- **What counts as a visit**: redirects, SPA/pushState navigations, reloads,
  failed loads, duplicate consecutive visits — recording semantics to pin at
  flight design.
- **Suggestion ranking**: recency vs frequency blend (frecency?) — and how
  ties and prefix-vs-substring matches order.
- **Admin identity and history**: does the admin automation key read any
  jar's history (consistent with the existing admin bypass in `scope.js`),
  or is history carved out of admin scope? Default assumption: consistent
  with the existing identity model; confirm at flight design.
- **Retention pruning cadence**: on-write, on-launch, periodic timer, or a
  blend — and what "felt-instant at scale" costs each option.
- **Depth of the cookies / other-site-data panels**: listings (a read
  surface) vs counts plus the existing clear controls — scope to pin when
  the jars-page flight is designed.
- **`history-changed` channel shape**: invalidation-signal semantics are
  adopted; the exact payload (jar id? data-class?) and subscriber inventory
  (broadcast-consumer audit, M06 lesson 3) land at flight design.
- **Jars-page controller growth** (Architect flag): `pages/jars.js` is already
  ~1,400 lines before the panel reorganization; Flight 2 design runs a scope
  check on splitting the panel/anchor architecture into per-panel modules
  rather than repeating the `main.js` growth pattern two debriefs flagged.

## Known Issues

- **`rerollSeed` is skipped when a session call throws during jar delete**
  (`wipeJarData` extraction, Flight 3): if the same slug is re-minted in the
  SAME app process, a stale fingerprint seed could persist onto the
  re-created jar's partition. Bounded (restart closes it; the precondition
  already left storage uncleaned pre-Flight-3). Discovered in Flight 3,
  adjudicated acceptable at flight review; candidate for a future hardening
  touch.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are
> planned and created one at a time as work progresses. This list will evolve
> based on discoveries during implementation.

- [x] Flight 1: Per-jar history store on built-in `node:sqlite` (decision
      record written, incl. write-path pin) — record visits (jar-backed tabs
      only; burner/internal structurally excluded via positive partition
      allowlist), persist across restarts, retention pruning,
      invalidation-signal broadcasts, `registerXIpc`-style wiring.
- [x] Flight 2: Manage-jars page reorganization — collapsible per-data-class
      panels (history, cookies, other site data) with left-nav anchors;
      panel/anchor architecture serves all data classes.
- [x] Flight 3: History panel content — browse, search, per-entry delete,
      clear-all; per-jar retention control; history data-class wired into
      clear-data and jar wipe (`JAR_DATA_CLASSES` extension).
- [ ] Flight 4: Address-bar suggestions — active-jar prefix search, ranking,
      keyboard/pointer selection, felt-instant at scale.
- [ ] Flight 5: Automation surface — jar-scoped history read tool through the
      existing identity façade; docs (mcp-automation.md, README) and the
      isolation behavior tests that close the mission's criteria.
- [ ] Flight 6 *(optional)*: Alignment — vibe coding session on the jars-page
      panels and omnibox feel (collapse behavior, anchor scroll, suggestion
      ranking) with real-time human judgment.
