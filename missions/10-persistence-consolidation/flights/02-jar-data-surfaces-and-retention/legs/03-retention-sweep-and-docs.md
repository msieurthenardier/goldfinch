# Leg: retention-sweep-and-docs

**Status**: completed
**Flight**: [Jar Data Surfaces + Generalized Retention](../flight.md)

## Objective

Generalize per-jar retention to cookies and site data per the Spike A
verdict — `app.db` schema v2 (`user_version` ladder built new) with the
cookie first-seen bookkeeping table, the `session-created`-anchored
listener, sweeps on the prune cadence + retention-edit immediate sweep,
DD10 sweep-completion broadcasts — plus docs, behavior-spec finalization,
and the flight's Witnessed behavior gate.

## Context

- Governing: DD4 **VERDICT (Spike A)** — candidate 1, creation-age
  (first-seen) semantic, new v2 table; the **overwrite-cause ruling** (on
  `removed:true`: skip deletion when `cause === 'overwrite'`; delete on
  `explicit`/`expired`/`expired-overwrite`/`evicted`; inserts are
  `INSERT OR IGNORE`); the `session-created` anchor (measured: fires
  synchronously on FIRST `fromPartition` only); the will-quit quiesce
  guard (F6-hang class); DD5 (single window); DD6 (cadence + async
  fire-and-forget with per-jar error isolation); DD7 (metadata only:
  `(jar_id, name, domain, path, first_seen_ms)`; bookkeeping dies with
  its data); DD10 (sweep-COMPLETION broadcast).
- **DD4b (FD ruling completing DD4 for the storage class — recorded in
  flight.md and the flight-log Decisions per DD1's discipline)**: site-data
  sweep uses **origin last-activity from history** — for each jar, origins
  whose MOST RECENT history activity predates the retention window get
  `clearStorageData({ origin, storages: <storage set, cookies excluded> })`;
  origins with NO history signal are NOT auto-swept (no honest age
  signal; operator-deletable in the panel; known-gap note says so).
  Aging semantics shipped and documented per class: cookies =
  **first-seen age**; storage = **since-last-activity**. History keeps
  its existing prune. This is a **desk ruling, not rig-probed** — honest
  because both empirical components were independently measured
  (`originsForJar` shipped+tested at leg 2; `clearStorageData({origin})`
  spike/leg-2 verified); the semantic itself is policy, matching DD4's
  candidate 2 with its named documentation duty.
- **SEQUENCING (design-review HIGH — the load-bearing fix): the storage
  sweep's eligible-origin snapshot MUST be taken BEFORE the history prune
  runs in the same pass.** `pruneOneJar`/`pruneExpired` delete every
  visit row older than the SAME cutoff — an origin whose last activity
  predates the window loses ALL its rows to the prune, vanishing from
  `originsForJar` before a post-prune sweep could ever see it, making the
  storage sweep inert for exactly its target case. Order in BOTH
  `pruneAllJars` and `handleSetRetention`: (1) snapshot aged-out origins
  (a `expiredOriginsForJar(jarId, cutoffMs)`-style read), (2) run the
  history prune (sync, as today), (3) run the async cookie/storage sweeps
  from the snapshot. **A unit test pins this ordering directly**
  (regression guard — "sweeps ride the prune loop" reads naturally as
  'after').
- Leg-2 outputs available: `jar-data-helpers.js` (`cookieUrl`, `origin`,
  `originFromIndexedDbDirname` with the port-`0` normalization,
  `mergeOriginTiers`), `originsForJar` in history-store, the four twins,
  DD10 broadcast wiring (clear/wipe sites), panels re-querying on
  `jar-data-changed`. Suite 2061.
- `app-db.js` fact (spike-verified, no drift): `attemptOpen` branches
  only on `user_version === 0` — **the ladder machinery is real new
  work**: v0 → create current schema (now v2 directly); v1 → apply the
  v2 step (CREATE the bookkeeping table); re-test the ladder itself
  (fresh create lands v2; a v1 file steps up preserving documents rows;
  corrupt still quarantines).
- Sweep sessions: sweeps `session.fromPartition` jars on demand (the
  same pattern `handleClearData`/`wipeJarData` use); this fires
  `session-created` side-effects (shields/downloads/spellcheck config)
  for jars untouched this boot — idempotent config application,
  accepted; the design-review warning was about eager warms for the
  LISTENER anchor (which stays lazy), not on-demand sweep access. Named
  here so the reviewer can weigh it.
- Cold start (verdict): session cookies with no bookkeeping row at sweep
  time get a row stamped `now` (age from first observation — honest).
- Bookkeeping lifecycle (DD7): rows deleted on — cookie removal events
  (per the cause ruling), per-cookie panel delete, `handleClearData`
  cookies class, `wipeJarData`, jar `remove`. Grep every destructive jar
  path.

## Inputs

- Legs 1-2 landed (uncommitted on the flight branch); suite 2061 green;
  rig available (proven twice this flight).

## Outputs

- `src/main/app-db.js`: `user_version` ladder (v0→v2 create, v1→v2
  step); `cookie_seen` table
  (`jar_id TEXT, name TEXT, domain TEXT, path TEXT, first_seen_ms
  INTEGER, PRIMARY KEY (jar_id, name, domain, path)`) + statements
  (insert-or-ignore, delete-by-identity, delete-by-jar, select-expired,
  stamp-missing — final statement set at implementation).
- New `src/main/retention-sweep.js` (Electron-free, injected deps —
  house factory shape): the sweep engine (cookie sweep per first-seen;
  storage sweep per history last-activity; per-jar error isolation;
  returns per-jar summary for the broadcast).
- `src/main/main.js`: cookies-listener wiring at the `session-created`
  hook (jar partitions only, cause-ruling handlers, appDb-open guard /
  quiesce before `will-quit` close); prune cadence extended (history
  prune stays sync-first; sweeps async fire-and-forget); listener
  detach/guard at quit.
- `src/main/jar-ipc.js`: `handleSetRetention` gains the immediate
  one-jar sweep with the SEQUENCING order (snapshot aged-out origins →
  `pruneOneJar` → async sweeps from the snapshot); destructive paths
  clear bookkeeping; DD10 broadcast on sweep completion carries the
  per-jar swept-class subset.
- Docs: CLAUDE.md — jars-page section (panels), retention section
  (per-class aging semantics, the honest gaps), app-db section (v2
  ladder).
- Behavior spec `tests/behavior/jar-data-surfaces.md`: [SPIKE] markers
  resolved per verdicts (fixture = page-driven `document.cookie` +
  IndexedDB seed; sweep trigger = retention-edit; storage semantics =
  last-activity; **step 6's retention-control drive pinned to the proven
  chrome-bridge `window.goldfinch.jarsSetRetention` call** — design
  review: literal `<select>` driving on an internal page is an unproven
  apparatus step; the bridge call is the mechanism class every prior
  equivalent mutation used); then the **Witnessed gate run** (Flight
  Director runs `/behavior-test jar-data-surfaces` after implementation)
  with run log committed.
- Tests: app-db ladder suite additions; retention-sweep suite
  (Electron-free, fake session/cookies injections); jar-ipc additions;
  suite green; timing guidance (shared fixtures) respected.

## Acceptance Criteria

- [x] Ladder: fresh profile → `user_version=2` with both tables; a
      **hand-crafted v1 fixture** `app.db` (documents rows present —
      NOTE: no real v1 file exists in the wild; F1 is unreleased, so the
      ladder protects the hypothetical F1-ships-alone-first scenario)
      steps to v2 preserving every row; corrupt → quarantine unchanged.
      Unit-pinned.
- [x] Listener: attaches only for registered persist-jar partitions at
      `session-created`; `INSERT OR IGNORE` on inserts; cause ruling on
      removals (overwrite survives with original `first_seen_ms` —
      unit-pinned against the measured event sequence); writes guarded
      when app-db is closed (quit path can never throw uncaught — the
      F6-hang class). *(the cause decision is extracted to a pure
      `cookieChangeAction` helper — main.js itself has no unit-test
      harness — see Deviations.)*
- [x] Cookie sweep: FIRST stamps unseen session cookies `now`
      (explicit order: stamp pass, then expiry pass over pre-existing
      rows — safe today because the window floor is 1 day, but the order
      is pinned so a floor change can't reintroduce
      delete-what-you-just-stamped), then removes cookies whose
      bookkeeping age exceeds the window (reconstructed-URL removal) and
      deletes their rows; storage sweep: acts on the PRE-PRUNE origin
      snapshot (see Context SEQUENCING), clears storage for aged-out
      origins (cookies excluded from the storage set); no-signal origins
      untouched; per-jar isolation (one jar's failure never blocks
      another); **the snapshot-before-prune ordering is unit-pinned**.
- [x] Cadence: boot + hourly sweeps ride the existing prune loop;
      `setRetention` triggers the immediate one-jar sweep;
      `jar-data-changed` fires on sweep COMPLETION with the swept
      classes; open panels repaint post-sweep (leg-2 wiring).
- [x] Bookkeeping dies with its data on every destructive path
      (per-cookie delete, clear-data cookies, wipe, jar remove) —
      unit-pinned per path.
- [x] Docs land (CLAUDE.md sections above); behavior spec finalized
      (no [SPIKE] markers remain).
- [x] `npm test` / `npm run typecheck` / `npm run lint` green.
- [x] `/behavior-test jar-data-surfaces` run by the Flight Director
      post-implementation: **partial (6/7)** with honest failure
      disposition per the workflow — checkpoint 6's cookie-removal clause
      is structurally unobservable on a first-ever sweep (cold-start
      stamping, deliberate + unit-pinned); spec amended in-run; live
      cookie-removal witness HAT-scoped. Storage/history sweep, DD10
      auto-repaint, panels, deletes, manual controls: all live-PASSED.
      Run log: tests/behavior/jar-data-surfaces/runs/2026-07-17-23-48-56.md.

## Verification Steps

- Ladder + sweep + listener suites green in isolation, then full suite.
- Grep: every destructive jar path touches bookkeeping cleanup; no
  cookie VALUES anywhere in app-db statements or payloads (DD7).
- Behavior-test run log committed under
  `tests/behavior/jar-data-surfaces/runs/`.

## Implementation Guidance

1. **Ladder first** (app-db + tests): refactor `attemptOpen`'s bootstrap
   into stepwise migrations (`0→current` fast-path or `0→1→2` ladder —
   implementer's call, but the v1→v2 step MUST run against a real v1
   file in tests); keep quarantine semantics identical.
2. **retention-sweep.js** (pure core): factory taking injected
   `{ appDb-statements, historyOrigins, sessionFor, cookieUrl, now }`;
   returns `{ sweepJar(jar), sweepAll(jars) }` with per-jar try/catch;
   unit-test with fakes (no Electron).
3. **Listener wiring** (main.js): inside the existing `session-created`
   hook, recover the partition from **`ses.storagePath`'s
   `Partitions/<name>` segment** (design review: the hook receives only
   the Session object — no partition field; the storagePath parse is
   precedented at `jar-ipc.js:421-423`; never warm-and-compare via
   eager `fromPartition`), then positive-match against `jars.list()`
   partitions (burner/internal match nothing); handlers write through
   guarded statements (`if (!appDb.isOpen()) return;` + try/catch).
4. **jar-ipc + cadence**: extend `handleSetRetention` and the
   `pruneAllJars` loop **with the snapshot-before-prune order** (Context
   SEQUENCING); DD10 completion broadcast carries the subset actually
   swept per jar (the sweep engine's return shape reports per-class
   results — reviewer suggestion adopted).
5. **Docs + spec finalization**, then hand back to the FD for the
   Witnessed gate run.

## Edge Cases

- **Jar deleted mid-sweep** — per-jar isolation + fail-closed re-check
  against the registry inside `sweepJar`.
- **Window shrunk then immediately re-grown** — swept data is gone
  (destructive, accepted; matches history-prune semantics).
- **Cookie re-set after sweep** — new `first_seen_ms` = now (it IS new
  data).
- **`expirationDate` in the past but still listed** — session is the
  source of truth; the sweep acts only on bookkeeping age.
- **Quit during sweep** — async session calls may reject after teardown;
  every sweep promise chain has a terminal catch (log-and-drop).
- **Sweep-vs-page TOCTOU (named-accepted)** — a page may overwrite a
  cookie between the sweep's read and its `cookies.remove`; the remove
  deletes the refreshed value. Accepted: same class as other
  read-then-act races in the codebase; bounded by the sweep cadence and
  the 1-day window floor.
- **CLAUDE.md sections are NEW** — no jars-page or retention section
  exists today (only "App database"); the docs item authors them, not
  edits.

## Files Affected

- `src/main/app-db.js`, `src/main/retention-sweep.js` (new),
  `src/main/main.js`, `src/main/jar-ipc.js`
- `CLAUDE.md`, `tests/behavior/jar-data-surfaces.md`
- `test/unit/app-db.test.js`, `test/unit/retention-sweep.test.js` (new),
  `test/unit/jar-ipc.test.js`

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (behavior gate run by FD; checkpoint-6 disposition recorded)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (gate run; disposition accepted)
- [x] Do NOT commit (flight-end review/commit model)

## Citation Audit

Key seams re-verified at leg design on the live tree: `app-db.js`
`attemptOpen` version-0-only branch (spike-cited, unchanged);
`jar-ipc.js` `handleSetRetention` (`pruneOneJar` call, spike-cited);
`main.js` `session-created` hook + prune cadence + `will-quit` ordering
(F1/spike-cited). Leg-2 outputs cited from its flight-log entry.
