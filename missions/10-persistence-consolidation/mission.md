# Mission: Persistence Consolidation

**Status**: active

> Source feature request: [goldfinch#94](https://github.com/msieurthenardier/goldfinch/issues/94),
> executing the standing BACKLOG seed "Persistent storage substrate: JSON stores → SQLite"
> (captured 2026-06-20, M04 F5 planning).
> Operator pre-authorized autonomous execution at mission design (2026-07-17): the Flight
> Director makes judgment calls through flights and debriefs without pausing, and the
> mission closes with a HAT flight where the operator reviews the implementation and
> outstanding issues are addressed.

## Outcome

Everything Goldfinch persists lives on one storage discipline instead of two.
The five ad-hoc JSON files under `userData` (settings, shields, jar registry,
downloads, session snapshot) move onto the same SQLite substrate that browsing
history has run on since Mission 08 — an existing profile upgrades in place
with nothing lost, and a corrupt or missing database can never stop the app
from booting. The `goldfinch://jars` page stops being history-only: its
Cookies and Other-site-data panels show the operator what each jar actually
holds — live cookies and storage-bearing origins, each individually deletable —
so "what does this identity know about me" is finally answerable per jar, in
one place. And the per-jar retention promise generalizes: the retention window
the operator sets on a jar governs all of that jar's persisted traces —
history, cookies, site data — not just the history rows it governs today.

## Context

Goldfinch persists structured state two ways. Browsing history (M08) runs on
Node's built-in `node:sqlite` (`DatabaseSync`) with WAL journaling,
quarantine-and-recreate corruption handling, and an hourly per-jar retention
prune. Everything else predates that decision and persists as five ad-hoc JSON
files, each rewritten wholesale via atomic temp-write + rename. The JSON
stores were built *anticipating* this mission — `settings-store.js`,
`downloads-store.js`, and `session-store.js` carry a pluggable
`{ serialize, deserialize }` codec seam whose header comments name a future
SQLite/safeStorage backend explicitly, and the BACKLOG has carried the
"JSON stores → SQLite" seed since M04. Issue #94 is that future arriving.

Meanwhile the `goldfinch://jars` page (M08 F2) renders three per-jar
disclosure panels — History / Cookies / Other site data — but only History has
live content (visit list, search, paging, per-row delete). Cookies and
Other-site-data hold only their "Clear …" controls: the destructive path
exists (`jar-ipc.js` clear-data / wipe), the read path was never built. And
`retentionDays` on the jar record (default 30, bounds 1–3650) prunes only
history — cookies and site data accumulate until manually cleared.

Planning inputs adopted from prior artifacts and mission-design research:

- **DD1, the substrate ruling** (`missions/08-history/flights/01-history-store/flight.md`):
  built-in `node:sqlite`, chosen over a vendored native module to preserve the
  zero-runtime-dependency identity, with a **named standing tax** — it is an
  experimental Node API; every Electron major bump must re-run the store suites
  and treat an API break as a first-class migration cost. Issue #94 asks for an
  explicit re-affirmation before widening the footprint from one store to six.
  The BACKLOG 43.x note confirms the posture holds on the next Electron line.
- **The history store is the reference implementation** (`src/main/history-store.js`):
  injected `userDataPath`, Electron-free, `PRAGMA user_version`-gated schema
  bootstrap, WAL + `synchronous=NORMAL`, quarantine-to-`.corrupt-<epoch>`
  siblings on corruption, prepared-statement cache rebuilt per open,
  caller-supplied `now` for determinism, `close()` idempotent via own flag.
- **Migration friction is concentrated in one module**: settings, downloads,
  and session stores are Electron-free with injected paths and codec seams;
  jars is Electron-free with injected path (no codec seam, three-shape legacy
  load); **`shields.js` is the outlier** — it `require`s Electron, resolves
  its own path inside `load()`, writes non-atomically, and swallows errors.
  Bringing shields up to house discipline is part of this mission, not an
  accident of it.
- **The load-bearing design tension for retention generalization**: cookies
  and site storage are **Chromium-managed**, living in each jar's session
  partition — Goldfinch does not store them and (per the issue) must not
  start. The listing UI is a read/list + targeted-delete surface over live
  session APIs (`ses.cookies.get`, storage enumeration), not a migration.
  But Electron's cookie objects expose `expirationDate`, not creation time,
  and no time-ranged bulk-clear API exists anywhere in the Electron 42
  Session surface — so "clear cookies/site-data older than the retention
  window" has **no native mechanism**. The retention flight opens with a
  premise-audit/spike, and the mission's retention criterion is written to be
  satisfiable by an honest mechanism or honestly retired (the M09 F8
  precedent: a measured NO-GO is a real outcome).
- **Architect viability check** (mission design, verdict: feasible with
  caveats) verified the API surface against the installed Electron 42.6.1
  types so flight design need not re-derive: `ses.cookies.get(filter)` /
  `remove(url, name)` / `flushStore()` exist and suffice for the Cookies
  panel (the session is already partition-scoped — no jar filter needed);
  `Cookie` carries **no creation-time field**; the `Session` class has **no
  storage-quota/usage or origin-enumeration method** (`getCacheSize()` is
  HTTP-cache-only); `clearStorageData` is origin/storage-type-scoped with
  **no time range**, and the broader `clearData` (dataTypes/origins filters)
  also has **no time range**. Consequence: the Other-site-data panel's
  "usage" clause should be treated as *likely unimplementable* through
  public API — the spike should write it off early rather than hunt, and
  the HAT review should not be surprised by its absence. One additional
  enumeration candidate surfaced: `ses.getStoragePath()` + scraping
  Chromium's per-origin on-disk layout — named in Open Questions with its
  fragility caveat. Bonus finding: Electron 42.6.1's bundled Node is
  **24.18** (verified live, `node:sqlite` loads unflagged there), stronger
  than BACKLOG's stale "≥ 22.12" note — fix while retiring the entry.
- **Downloads crash-survivable in-progress records** (BACKLOG scope note: the
  M04 F5 accepted gap — terminal records only, in-progress lost on crash) is a
  *candidate rider* once downloads sits on transactional SQLite. Default
  posture: out of scope unless the flight design finds it nearly free; the
  issue does not ask for it.
- **`initProfileAndStores` is unit-pinned at a 4-store signature**
  (`src/main/init-profile.js`); the history store deliberately opens as a
  sibling call. The consolidation will reshape this boot seam — the pinning
  tests move with it deliberately, not incidentally.

## Success Criteria

- [ ] All five config/state surfaces (app preferences, shields config, jar
      registry, downloads, session snapshot) persist through the same durable
      storage substrate as browsing history, and survive an app upgrade from
      an existing profile with no data loss — settings values, jar
      definitions (including per-jar retention), download records, and the
      saved session all come through intact, with the one-time migration
      running automatically on first boot.
- [ ] With a missing or corrupt store database, the app still boots to a
      usable state with defaults (quarantine-and-recreate, per the
      history-store precedent) — corruption of any single persisted surface
      can never brick the app.
- [ ] Every persisted store remains Electron-free, dependency-injected, and
      unit-tested offline against a synthetic temp dir — including shields,
      which is brought up to that discipline as part of the move.
- [ ] The Cookies panel on `goldfinch://jars` lists the selected jar's live
      cookies (name, domain, expiry) with per-cookie delete, alongside the
      existing History list, and stays consistent with the jar's actual
      session state after deletes and clears. *(behavior-test-backed)*
- [ ] The Other-site-data panel lists the jar's storage-bearing origins (with
      usage where the platform exposes it) with per-origin delete.
      *(behavior-test-backed)*
- [ ] The per-jar retention window governs cookies and site data, not just
      history: persisted traces older than the jar's window are removed on
      the same cadence discipline as the history prune, without breaking the
      manual clear/wipe controls or the `history-changed`/`jars-changed`
      invalidation contracts. *(behavior-test-backed; mechanism is
      spike-gated — see Open Questions)*
- [ ] The substrate ruling (DD1) is explicitly re-affirmed for the widened
      footprint, and the documentation trail is current: `CLAUDE.md` reflects
      the new store architecture, and the BACKLOG "JSON stores → SQLite" seed
      is retired.
- [ ] The `safeStorage` at-rest-encryption seam survives the migration: a
      future encrypted codec can still be layered in without reshaping the
      stores (no encryption is built now).

## Stakeholders

- **The operator** — lives in this browser daily; wants one coherent answer to
  "what does this jar know about me" and a retention dial that actually
  covers everything. Reviews the mission personally in the closing HAT
  flight.
- **Existing profiles** — every current install carries real state in the five
  JSON files; the migration must be invisible except that nothing is lost.
- **The project itself** — this closes the two-substrate era; the store shape
  chosen here is what every future persisted surface inherits, and the
  experimental-API tax (DD1) is consciously widened from one store to all of
  them.
- **Agentic platforms driving Goldfinch** — the automation surface reads jar
  and history state through the same stores; their contracts must hold
  through the substrate swap.

## Constraints

- **Zero runtime dependencies, re-affirmed.** The substrate is Node's
  built-in `node:sqlite` per DD1. A vendored native module (`better-sqlite3`)
  is the named fallback only on a hard mid-mission blocker, and taking it is
  a mission-level decision, not a flight-level one.
- **Store discipline is absolute**: Electron-free modules, injected
  `userDataPath`, offline unit tests against temp dirs, caller-supplied time
  where determinism matters, quarantine-and-recreate on corruption, and the
  codec seam preserved for a future `safeStorage` pass. No encryption built
  now.
- **Cookies and site storage stay Chromium-managed.** The jars-page listing
  and the retention mechanism read and delete through live session APIs;
  Goldfinch never mirrors cookie/storage contents into its own database.
- **No data loss on upgrade.** The JSON → SQLite migration is one-time,
  automatic, and total; the app must also still boot cleanly on a fresh
  profile with no JSON files at all.
- **The cookie-jar isolation model and partition scheme are unchanged** (from
  the issue's non-goals).
- **Internal-page trust boundaries are unchanged**: new read/list IPC for
  cookies and site data follows the `jar-ipc.js` twin pattern
  (chrome-trusted + internal-origin-gated), fail-closed validation, and the
  invalidation-not-snapshot broadcast idiom.
- **Planning artifacts only from planning skills**; implementation happens in
  `/agentic-workflow`-spawned agents on flight branches.
- **Public repo hygiene**: no personal paths or usernames in committed
  content.

## Environment Requirements

- Linux (WSL2) development host; GUI Electron app via `npm run dev:automation`
  (Wayland path) for live verification.
- Electron 42.6.1 baseline (bundled Node **24.18**, verified at mission
  design — `node:sqlite` loads unflagged there); dev-host Node 22.22 for
  unit tests (`node:sqlite` unflagged, confirmed at M08 and re-confirmed).
- Unit tests via `node --test` (`npm test`, 93 files); `npm run typecheck`
  and `npm run lint` green as standing gates.
- Behavior tests via the goldfinch MCP apparatus (Witnessed pattern) for the
  jars-page and retention criteria; admin-tier key available on the rig.
- A seeded "existing profile" fixture (JSON files + populated jars/history)
  for live migration verification.

## Open Questions

- **One database or two?** Fold the config tables into `history.db`, or stand
  up a separate `app.db` keeping the write-hot history table isolated from
  small config rows? Leaning at mission design: a separate `app.db` (blast
  radius: history corruption quarantines history alone; config corruption
  doesn't take history with it) — pinned at flight design.
- **Old JSON files after migration**: leave in place, or rename to
  `.migrated`? (The issue leaves it TBD.) Decide at flight design with the
  rollback story in view — a downgraded binary reading a stale JSON file
  silently forks state.
- **Key-value rows or per-store tables?** Settings/shields are fixed-key
  objects; jars/downloads/session are record collections. One generic
  KV-with-JSON-values table, per-store tables, or a mix — pinned at flight
  design against the codec-seam and validation contracts each store already
  carries.
- **Retention mechanism for Chromium-managed data (spike-gated).** Electron
  cookie objects carry `expirationDate` but not creation time, and no
  time-ranged bulk clear exists in the Electron 42 Session API (Architect,
  verified). Candidate mechanisms: per-origin last-activity tracking
  (history as the activity signal) driving targeted
  `clearStorageData({origin})` deletes; cookie-level sweep via `cookies.get`
  + `cookies.remove` against observed-first-seen bookkeeping; or an honest
  NO-GO narrowing the criterion. The retention flight opens with this
  premise-audit; the mechanism must never mirror content into our DB
  (constraint above). **Any last-activity bookkeeping needs an explicit
  design-decision record drawing the "metadata, not content" boundary**
  (a bare origin + timestamp is metadata; cookie values / storage contents
  are content and never persisted) — ruled before anything is built.
- **Site-data origin enumeration**: no public `Session` API enumerates
  storage-bearing origins or usage (Architect, verified). Candidates:
  `ses.getStoragePath()` + scraping Chromium's per-origin on-disk directory
  layout (works without CDP but parses an undocumented, version-fragile
  internal layout — the shakiest candidate), CDP Storage-domain calls, or
  origin inference from Goldfinch's own signals (history). Spiked as its
  **own work item, budgeted separately from the retention spike** — two
  independently-likely-to-fail unknowns don't share one spike verdict. The
  criterion's "where the platform exposes it" clause absorbs a partial or
  negative answer, and usage specifically is expected to resolve NO.
- **Retention granularity**: one `retentionDays` per jar governing all data
  classes, or per-class windows (history vs cookies vs site data)? Default
  leaning: single per-jar window (one dial, matches the jar-record shape and
  the operator's mental model); pinned at the retention flight design.
- **Session-store write path on SQLite**: the session snapshot is written at
  window-close and `before-quit` (two-writer discipline from M09 F9), and the
  history store closes at `will-quit`. Ordering and single-`close()` semantics
  for a shared config DB are pinned at flight design.
- **Downloads in-progress rider**: confirmed out of scope unless flight
  design finds it nearly free on the new substrate (see Context).

## Known Issues

- [ ] **HAT-scoped carries (accumulated F1-F2)**: (1) promote + merge PR
      #96 (F1, draft) and F2's stacked PR — `gh pr ready`/`merge` are
      classifier-blocked for the FD this session; (2) **rotate/re-mint
      automation keys** — the FD leaked the registered jar-scoped bearer
      key into its session transcript at F1 leg 3 (redaction regex missed
      a leading-underscore token); re-register the session MCP entry after
      rotation; (3) **live cookie-removal-by-age witness** — structurally
      unobservable on a first-ever sweep (cold-start stamping, deliberate);
      needs a sweep against day+-aged `cookie_seen` rows on the operator's
      real profile (jar-data-surfaces run 1 disposition, 2026-07-18).

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are
> planned and created one at a time as work progresses. This list will evolve
> based on discoveries during implementation.

- [x] Flight 1: SQLite store consolidation — the DB-layout decision (one vs
      two databases, table shapes), DD1 re-affirmation record, migration of
      all five JSON stores onto the substrate with one-time on-boot import,
      shields brought up to store discipline, boot-seam reshape
      (`initProfileAndStores`), corruption/quarantine semantics, docs +
      BACKLOG retirement.
- [x] Flight 2: Jar data surfaces + generalized retention — the retention
      premise-audit/spike (mechanism for Chromium-managed data), Cookies and
      Other-site-data panel listings with per-item delete (new read-path IPC
      twins), retention applied to cookies/site data on the prune cadence,
      invalidation contracts verified end-to-end.
- [ ] Flight 3: HAT & alignment — operator-guided review of the
      implementation across all mission behavior tests, with iterative fix
      legs for outstanding issues until aligned.
