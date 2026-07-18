# Flight: Jar Data Surfaces + Generalized Retention

**Status**: completed
**Mission**: [Persistence Consolidation](../../mission.md)

## Contributing to Criteria

- [x] The Cookies panel on `goldfinch://jars` lists the selected jar's live
      cookies (name, domain, expiry) with per-cookie delete, alongside the
      existing History list, staying consistent after deletes/clears.
      *(behavior-test-backed)*
- [x] The Other-site-data panel lists the jar's storage-bearing origins
      (with usage where the platform exposes it — expected NO per the
      Architect's verified API gap) with per-origin delete.
      *(behavior-test-backed)*
- [x] The per-jar retention window governs cookies and site data, not just
      history — removal on the same cadence discipline as the history
      prune, without breaking manual clear/wipe controls or invalidation
      contracts. *(behavior-test-backed; mechanism spike-gated)*

---

## Pre-Flight

### Objective

Fill in the two empty `goldfinch://jars` panels with live listings over
Chromium's session APIs — cookies (name/domain/expiry, per-cookie delete)
and storage-bearing origins (per-origin delete) — through new fail-closed
IPC twins, and generalize the per-jar `retentionDays` so it prunes cookies
and site data on the history-prune cadence. The flight opens with two
separately-budgeted spikes whose GO/NO-GO verdicts gate the build legs: the
retention mechanism (including where any bookkeeping lives — the F1 debrief
warns the doc-per-row seam is NOT the default answer) and site-data origin
enumeration.

### Premises inherited (not re-derived)

- **From mission-design Architect probe (verified against electron.d.ts)**:
  `ses.cookies.get(filter)` / `remove(url, name)` / `flushStore()` exist
  and suffice for the Cookies panel; `Cookie` has NO creation-time field;
  `Session` has NO origin-enumeration or quota/usage API; neither
  `clearStorageData` nor `clearData` accepts a time range. "Usage" is
  expected unimplementable via public API — the spike writes it off early
  unless trivially available.
- **From F1 (settled, live-verified)**: all five stores row-backed on
  `app.db`; jars `retentionDays` (1-3650, default 30) persists through the
  substrate; quarantine/reseed proven; `app.db` supports `user_version`
  schema evolution but a v1→v2 migration has never been exercised; the
  `documents` doc-per-row seam is wholesale-replace — high-cardinality
  bookkeeping needs a real table (F1 debrief Key Learning).
- **From the M10 F1 behavior-test run (apparatus facts)**: MCP `openTab`
  cannot open `goldfinch://` pages under any identity — internal pages open
  via `getChromeTarget` + `evaluate` of FD-approved chrome globals
  (`openJarsPage()` etc.); admin-tier keyed calls use the one-shot
  `scripts/lib/mcp-client.mjs` mechanism; internal-session evaluate is
  uniformly refused, so page-state assertions read through the chrome
  bridge + DOM/AX/screenshot of the internal tab.

### Open Questions

- [x] Retention granularity: single per-jar window vs per-class → DD5
      (single window — locked now, not spike-dependent).
- [x] Metadata-vs-content boundary for any bookkeeping → DD7 (locked now).
- [x] Retention mechanism for cookies (no creation time exposed) →
      **Spike A** (leg 1); candidates + decision criteria in DD4. Resolved:
      candidate 1 (GO) — see DD4 VERDICT.
- [x] Site-data origin enumeration mechanism (+ usage) → **Spike B**
      (leg 1); candidates in DD3. Resolved: composite (GO) — see DD3
      VERDICT.
- [x] Storage shape for any retention bookkeeping (new `app.db` v2 table vs
      history-derived-only vs none) → **Spike A deliverable** (DD4/DD6).
      Resolved: new `app.db` v2 table — see DD4 VERDICT.
- [ ] Cookies panel freshness model → DD2 (decided: query-on-open +
      re-query after own mutations; no live cookie subscription — confirm
      at design review).

### Design Decisions

**DD1 — Spike-first structure with recorded verdicts.** Leg 1 runs two
independently-budgeted spikes (mission ruling — "two
independently-likely-to-fail unknowns don't share one spike verdict"), each
producing a GO/NO-GO + mechanism ruling recorded in the flight log and
back-annotated into DD3/DD4 before legs 2-3 are designed. A NO-GO is a real
outcome (M09 F8 precedent): it narrows the corresponding criterion honestly
rather than shipping a dishonest mechanism. Spike probes run on the live
rig (the F1 apparatus mechanism); probe scripts are scratch, never shipped.

**DD2 — Cookies panel: live reads through new fail-closed IPC twins;
query-on-open freshness.** New handlers in `jar-ipc.js` following the
extract-don't-fork twin pattern (`jars-cookies-list` /
`internal-jars-cookies-list`, same for per-cookie delete): validate
fail-closed (jar id against the registry, then
`session.fromPartition(jar.partition)`), list via `ses.cookies.get({})`,
delete via `cookies.remove(url, name)` with the URL reconstructed from the
cookie record (scheme from `secure`, host from `domain` stripped of the
leading dot, plus `path`).
- Freshness: the panel queries on open and re-queries after its own
  deletes/clears and on `jars-changed`-family invalidation. **No live
  `cookies.on('changed')` subscription for the UI** — page activity churns
  cookies constantly; a per-change broadcast would spam every open jars
  page for no operator value. Source of truth stays the session; staleness
  is bounded by panel-open lifetime and is acceptable for an inspection
  surface. (A manual refresh affordance is in scope for the panel.)
- Trust: internal twin gated by `registerInternalHandler`; static
  non-interpolated error strings (history-ipc precedent, not jar-ipc's
  older dynamic branches).
- **Query trigger (design review): cookie/site-data queries gate on
  TAB-SELECTION (the panel actually opened), NOT the section-visibility
  trigger** the history panel uses (`jars.js` fires `onExpanded()` when a
  jar section scrolls into view regardless of active tab — cheap for a
  local DB read, wrong for live session calls and a possible CDP/disk
  probe). The panel modules take an explicit activation hook.

**DD10 — `jar-data-changed { jarId, classes }` invalidation broadcast
(design review, HIGH).** Today NOTHING invalidates a cookie/site-data
listing changed by another path: `handleClearData` broadcasts only
`history-changed` (gated on the history class), `jar-wiped` never reaches
`internal-preload.js`, and the confirm-modal success path just closes.
New broadcast fired by: `handleClearData` when cookies/storage classes
clear, `handleWipe`, per-item deletes (own-panel refresh still direct),
and — critically — **the retention sweep's COMPLETION** (never the
`setRetention` invoke, which returns before the async sweep and would
paint pre-sweep state). Wired through `broadcastToChromeAndInternal` and
exposed on `internal-preload.js` like `history-changed`; panels re-query
on it. This closes the staleness gap the behavior spec's step 7 asserts
(freshness after manual Clear controls) — staleness is NOT an accepted
gap.

**DD3 — Site-data panel: mechanism spike-gated; candidates ranked.**
Candidates for enumerating storage-bearing origins per jar session, in
Spike B's probe order:
1. **CDP Storage domain** via a debugger session — needs a live target in
   the jar's session (`debugger` lives on WebContents, not Session —
   review-verified); probe whether attach without an open tab is possible
   (expected: no), and whether a hidden/offscreen helper target is
   acceptable (expected: no — rejected if it requires keeping a
   webContents alive per jar). **Time-boxed hard (design review): the
   near-certain NO must not crowd candidates 2/3's probe budget.**
2. **`ses.getStoragePath()` + per-origin on-disk layout scrape** — works
   offline but parses undocumented, version-fragile Chromium internals;
   acceptable only read-only + defensively (unknown layouts degrade to
   "unknown", never crash), with the fragility named in docs.
3. **History-derived origins** (origins with browsing activity in the jar,
   from `history.db` — metadata Goldfinch already owns) presented as
   "origins with activity" with per-origin `clearStorageData({origin})`
   delete — honest approximation; misses never-visited third-party-only
   origins, and says nothing about whether storage exists.
Usage/quota: expected NO (inherited premise); the criterion's "where the
platform exposes it" clause absorbs the NO — the spike spends at most a
probe on it. The verdict picks the mechanism (possibly a composite, e.g.
2-for-listing + 3-as-fallback) and its honest labeling in the UI.

**VERDICT (leg 1, 2026-07-17): Composite GO — candidate 1 (CDP) eliminated
(measured, <5min rig time — type-cited: `Session` has no `debugger`
member, only `WebContents` does); candidate 2 viable ONLY as an
IndexedDB-origin directory scrape (measured: IndexedDB is origin-named on
disk, Local Storage is consolidated into one non-origin-keyed leveldb
store — DD3's named fragility confirmed for Local Storage specifically);
candidate 3 (history-derived) feasible via an existing, shipped
`GROUP BY`-aggregation idiom. Mechanism = UNION of both, two-tier honest
labeling ("has stored data" vs "visited — storage unconfirmed"); usage/
quota reconfirmed NO. Full evidence in flight-log.md Decisions.**

**DD4 — Retention mechanism for Chromium-managed data: spike-gated;
candidates + decision criteria.** Candidates for Spike A:
1. **Cookie first-seen bookkeeping**: subscribe `cookies.on('changed')`
   per persist-jar session (main-side, not UI); record
   `(jarId, cookie-identity, firstSeenMs)` — identity = name+domain+path,
   NO values (DD7). Sweep removes cookies whose firstSeen predates the
   jar's window. Requires a real table (high cardinality — F1 debrief:
   NOT the documents seam; `app.db` schema v2 with `user_version` ladder,
   the first exercised v1→v2 migration). Cookies predating bookkeeping
   (or with no row) are treated as first-seen-at-first-sweep — the honest
   cold-start. **Review annotations**: (a) the listener anchors at the
   existing `app.on('session-created')` seam keyed by jar partition
   (where shields/downloads/spellcheck already attach) — NEVER eager
   `session.fromPartition` warms at boot (session-created fires
   unconditional side-effects; untouched jars stay cold); (b) the
   `removed: true` event deletes the bookkeeping row — per-cookie natural
   removal (expiry/site-initiated) must not leave orphan rows (DD7 at
   cookie granularity); (c) **the `user_version` ladder machinery does
   not exist yet** — `app-db.js` branches only on version 0; building the
   v1→v2 step (and re-testing the bootstrap ladder itself) is named
   Spike-A-deliverable/leg-3 work, not folded silently into "schema v2".
2. **Origin last-activity from history**: per jar, compute origins with
   history activity inside the window; `clearStorageData({origin})` (and
   cookie removal by domain-match) for origins whose LAST activity
   predates the window. No new storage (history rows are the signal). Risk:
   punishes rarely-visited-but-wanted logins exactly at the window edge —
   which is arguably what retention MEANS, but the semantic must be
   documented as "since last activity", not "since creation".
3. **Honest NO-GO**: neither mechanism meets the bar → the criterion
   narrows to "retention clears site data for origins aged out of history"
   or retires for cookies specifically.
Decision criteria the spike verdict must apply: correctness of the aging
semantic (creation-age vs last-activity-age — name which one ships),
bookkeeping cardinality and its storage shape, interplay with Chromium's
own cookie expiry, cost on the prune cadence (async sweeps must not block
the loop), and the DD7 boundary. Spike A's deliverable includes the
storage-shape ruling (F1 debrief Recommendation 2).

**VERDICT (leg 1, 2026-07-17): GO — candidate 1 (cookie first-seen
bookkeeping), creation-age (first-seen) semantic, new `app.db` schema-v2
table (cardinality measured live: 41 cookies/6 real sites/single visits,
on-disk sqlite count, corroborated by a document.cookie spot-check —
real-jar scale confirms a real table is warranted, no exotic scale
engineering needed). All three review annotations answered with measured/
code-cited evidence (session-created anchor: fires synchronously on FIRST
`fromPartition` only, confirmed; `user_version` ladder: still real leg-3
work, confirmed no drift). New implementation-nuance ruling surfaced by
the probe: `cookies.on('changed')` fires a same-identity `overwrite`/
`removed:true` + `inserted`/`removed:false` PAIR on a plain value refresh
— the bookkeeping delete handler must skip `cause==='overwrite'` (row
survives) or every value-refreshed cookie's aging clock resets on each
revisit. DD2's dot-strip URL reconstruction verified correct for both
host-only and domain cookies (read-back confirmed). Full evidence in
flight-log.md Decisions.**

**DD4b — Storage-class aging ruling (FD desk ruling at leg-3 design,
recorded per DD1's discipline).** Storage sweeps age by **origin
last-activity from history** (DD4 candidate 2's storage half): origins
whose most recent history activity in the jar predates the window get
`clearStorageData({origin, storages minus cookies})`; no-signal origins
are never auto-swept (documented gap). Cookies age by first-seen (DD4
VERDICT); the per-class semantics are documented user-facing. Desk
ruling, not rig-probed — both empirical components independently
verified (leg-2 `originsForJar`; spike/leg-2 `clearStorageData`).
**SEQUENCING invariant (leg-3 design review, HIGH): the aged-out-origin
snapshot is taken BEFORE the history prune in the same pass** — the
prune deletes the very rows that identify sweep targets; unit-pinned.

**DD5 — Retention granularity: one per-jar `retentionDays` governs all
classes.** One dial, matching the jar record shape and the operator's
mental model (mission leaning, locked). Per-class windows are a future
mission if ever wanted; nothing in this flight's schema forecloses them.

**DD6 — Sweep cadence rides the existing prune discipline.** The
boot-time + hourly `pruneAllJars()` cadence (main.js) gains the
cookie/site-data sweeps: same per-jar map build, sweeps are async and
fire-and-forget with per-jar error isolation (one jar's failed sweep never
blocks another's; history prune stays synchronous first). Retention-edit
(`setRetention`) triggers the same immediate one-jar sweep discipline as
history's `pruneOneJar`. Up-to-an-hour over-retention stays accepted.
Manual controls (clear-data, wipe, delete) are unchanged and remain
independent paths; sweeps and manual clears converge on the same
session-API calls. **Quit-ordering addendum (design review)**: any async
bookkeeping write or sweep in flight at quit must be guarded — the
`cookies.on('changed')` listener quiesces (or its writes check
`appDb.isOpen()` / are try-caught) BEFORE `will-quit`'s `appDb.close()`;
an uncaught throw in the quit path is the named F6-hang failure class.

**DD7 — Metadata-not-content boundary (mission-required ruling).** Any
persisted bookkeeping may contain: jar id, bare origin/host, cookie
identity tuple (name, domain, path), timestamps. It may NEVER contain:
cookie values, storage contents, URLs beyond origin, page titles, or any
row derived from content. Bookkeeping rows are deleted with their jar and
covered by the jar's own wipe/clear paths (bookkeeping about deleted data
must not outlive it).

**DD8 — Panels clone the history-panel shape; a11y parity.** New
`src/renderer/pages/jars-cookies-panel.js` and
`jars-sitedata-panel.js` modules mirroring `jars-history-panel.js`'s
constructor-deps shape (bridge, jarId, mountEl, onError), mounted from
`jars.js`'s `buildPanelContent` branches that today append only the Clear
controls. Bridge wrappers ride `internal-preload.js` (same trust boundary).
Labels/roles/keyboard reach at parity with the history panel; `npm run
a11y` is the gate where the keyed rig allows (HAT fallback otherwise, M09
precedent).

**DD9 — Verification apparatus (act + observe, audited).** Behavior spec
`jar-data-surfaces` (drafted at this flight design). Act path: the F1-run
mechanism — launch dev rig, admin one-shot client, `openJarsPage()` chrome
global, DOM interaction via evaluate on the chrome / readDom+AX+screenshot
on the internal tab; cookie fixtures seeded by driving a real page in the
jar (e.g. a data: or local http page setting cookies via document.cookie —
probe in Spike B's rig time) or via `ses.cookies.set` through a main-side
probe surface if page-set proves flaky (spike decides which). Observe
path: panel DOM/AX + screenshots (rendered state) corroborated by
`ses.cookies.get` reads through the admin client. Retention sweep
observation: seed → shrink the jar's window via the retention control → 
trigger the sweep path → observe removal (the sweep-trigger seam is a
Spike A deliverable — an operator-invisible test hook is NOT built; the
retention-edit immediate sweep (DD6) is the natural trigger).

### Prerequisites

- [x] F1 landed and committed on the flight branch (stacked base:
      `flight/01-sqlite-store-consolidation`); suite 2017 green.
- [x] Rig launchable in-session (Wayland socket verified at F1 leg 3;
      the F1 behavior run proved launch/quit/relaunch + admin client).
- [x] The five store rows + retentionDays stable (F1 live-verified).
- [x] Spike verdicts (leg 1) before legs 2-3 lock. Both verdicts recorded
      2026-07-17 (GO / composite GO) — see DD3/DD4 VERDICT annotations and
      flight-log.md Decisions.
- [ ] PR #96 remains draft (operator-scoped) — F2's PR stacks on the F1
      branch; merge order is operator's at HAT.

### Pre-Flight Checklist

- [x] Open questions resolved or explicitly spike-gated (DD1)
- [x] Design decisions documented (DD2-DD9; DD3/DD4 verdict-pending by design)
- [x] Prerequisites verified
- [x] Validation approach defined (DD9 + behavior spec draft)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 spikes both unknowns on the live rig and records rulings. Leg 2
builds the Cookies panel end-to-end (IPC twins → preload wrappers → panel
module → unit tests for the pure/main-side parts) and the Other-site-data
panel per Spike B's verdict, **including a smoke-level live check on the
rig** (open the panels against seeded cookies — implementing-agent
verification, not the Witnessed gate) so a panel-only defect doesn't wait
for leg 3's combined gate (design-review Q1 ruling). Leg 2 also lands the
DD10 broadcast (the panels' freshness contract depends on it). Leg 3 builds retention generalization per
Spike A's verdict (schema v2 + bookkeeping if ruled, sweep integration on
the prune cadence, retention-edit immediate sweep), updates docs
(CLAUDE.md jars-page + retention sections), and runs the
`jar-data-surfaces` behavior gate. Suite-timing awareness (F1 debrief): new
store-layer tests should prefer shared fixtures/`:memory:` where they
don't assert real file-family behavior.

### Checkpoints

- [x] Spike verdicts recorded (flight log + DD3/DD4 annotations) — landed
      2026-07-17; legs 2-3 not yet designed against them (next FD step).
- [x] Cookies + site-data panels live end-to-end with per-item delete;
      suite green.
- [x] Retention sweeps live on the cadence; behavior gate run; docs landed.

### Adaptation Criteria

**Divert if**:
- Both Spike A candidates fail the decision criteria AND the honest-NO-GO
  narrowing is unacceptable against the mission criterion — that's a
  mission-level conversation, not a flight patch.
- Spike B leaves no defensible listing mechanism (all three candidates
  refused) — same escalation.

**Acceptable variations**:
- Composite mechanisms (e.g. history-derived listing labeled honestly).
- Panel UX details (paging, refresh affordance placement) at leg design.
- Schema v2 shape details per Spike A.

### Legs

> **Note:** Tentative; legs are planned one at a time as the flight
> progresses.

- [x] `spikes-and-rulings` — Spike A (retention mechanism + storage shape)
      and Spike B (site-data enumeration + usage write-off) on the live
      rig; GO/NO-GO verdicts + DD annotations; no shipped code. **Landed
      2026-07-17**: Spike A GO (candidate 1), Spike B composite GO.
- [x] `data-panels` — Cookies panel + Other-site-data panel end-to-end
      (IPC twins, preload wrappers, panel modules, tests) per verdicts.
- [x] `retention-sweep-and-docs` — retention generalization per Spike A
      (schema v2 if ruled), prune-cadence integration, retention-edit
      immediate sweep, docs, `jar-data-surfaces` behavior gate.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged (or stacked PR ready — operator merge at HAT): stacked PR opened; operator merge at HAT
- [x] Tests passing (unit + typecheck + lint green; behavior gate run: partial 6/7 with accepted disposition, cookie-witness HAT-scoped; a11y green)
- [x] Documentation updated

### Verification

- `npm test` / `npm run typecheck` / `npm run lint` green.
- Behavior test `jar-data-surfaces` (drafted at flight design; finalized
  after spikes) — the live gate for panels + retention.
- `npm run a11y` on the jars page where the keyed rig allows; HAT
  fallback recorded honestly otherwise. **RUN at flight-end: GREEN (no
  new violations; 2026-07-18, flight log).**
