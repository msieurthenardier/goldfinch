# Flight Log: Jar Data Surfaces + Generalized Retention

**Flight**: [Jar Data Surfaces + Generalized Retention](flight.md)

## Summary

Flight executed 2026-07-17/18: spikes (2 GO verdicts, measured), panels + retention sweep landed, flight-end review [HANDOFF:confirmed], behavior gate partial 6/7 with accepted spec-premise disposition (cookie witness HAT-scoped), a11y green. Suite 2017 → 2116. Flight landed.

---

## Reconnaissance Report

Source artifacts: GitHub issue #94 (goals 2-3), mission Open Questions,
F1 flight-debrief forward guidance. Verified against the flight branch
(post-F1, `d86365c`) at flight design.

| Item | Classification | Evidence | Recommendation |
|------|---------------|----------|----------------|
| Cookies panel empty (Clear controls only) | confirmed-live | `src/renderer/pages/jars.js` buildPanelContent — only `history` branch adds content; F1 touched none of the panel files | Build (leg 2) |
| Other-site-data panel empty | confirmed-live | same | Build (leg 2, spike-gated) |
| Retention history-only | confirmed-live | prune cadence in `main.js` covers `historyStore` only | Build (leg 3, spike-gated) |
| No cookie/site-data read IPC | confirmed-live | `jar-ipc.js` has clear-data/wipe (destructive) only | New twins (leg 2) |
| Architect API facts (no enumeration/usage/time-range APIs) | confirmed-live (inherited premise) | mission.md Context, verified against electron.d.ts at mission design | Spike candidates ranked in DD3/DD4 |
| F1 debrief: storage-shape decision belongs in the spike | confirmed-live | F1 flight-debrief Recommendations 2 | Spike A deliverable |
| F1 debrief: suite-timing tax | confirmed-live | F1 flight-debrief metrics | Leg 2/3 test-fixture guidance in Technical Approach |

No stale items. Autonomous mode: classifications confirmed by the Flight
Director under the mission's pre-authorization.

---

## Leg Progress

- 2026-07-17: `spikes-and-rulings` — landed. Both spikes run on the live rig
  (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run
  dev:automation`) plus a throwaway scratch-Electron instrument (same
  binary, `/tmp` userData, never touched the goldfinch app or dev profile)
  for main-process-only probes. Dev profile (`~/.config/goldfinch-dev`)
  backed up (tar+sha256) before the three throwaway jars created for the
  cardinality probe, and restored byte-for-byte after (sha256-verified tar,
  directory census matched pre/post: 26 `container*` partitions both
  times, no `spike-cardinality*` residue). App quit via
  `window.goldfinch.appQuit()` (never SIGKILL). See Decisions below for the
  full verdicts; DD3/DD4 in flight.md carry the short back-annotations.

- 2026-07-17: `data-panels` — landed. Cookies panel + Other-site-data panel
  built end-to-end per the spike verdicts (DD2, DD3 VERDICT) and the leg-2
  design review's fixes.

  **Implementation summary.** New pure-helper module
  `src/main/jar-data-helpers.js` (`cookieUrl`, `origin`,
  `originFromIndexedDbDirname`, `mergeOriginTiers` — Electron-free, shared by
  `jar-ipc.js` and `history-store.js`). `history-store.js` gained
  `originsForJar(jarId)` (GROUP BY-on-url idiom + JS-side origin
  normalization/collapse, reusing `origin()`). `jar-ipc.js` gained four twin
  pairs (`jars-cookies-list`/`-remove`, `jars-sitedata-list`/
  `-remove-origin` + `internal-*`) plus the DD10 `jar-data-changed
  { jarId, classes }` broadcast wired into `handleClearData` (classes ∩
  {cookies, storage}, only when actually cleared) and `handleWipe`
  (unconditional `['cookies','storage']`) — per-item deletes deliberately do
  NOT broadcast it (own-panel direct refresh only, per leg spec). New
  renderer modules `jars-cookies-panel.js` / `jars-sitedata-panel.js`
  (history-panel-shaped: manual refresh, per-row no-confirm delete, monotonic
  `viewGen` staleness guard, empty/error states; site-data panel adds the
  two-tier badges + known-gap note). `jars-tabs.js`'s `selectTab` was
  generalized from a hardcoded History-only activation branch to a
  data-driven `refs.activationHooks` map dispatch (design review fix) — the
  new panels' `onActivated` re-queries on EVERY tab-selection (no
  first-time-only guard, unlike History's `onExpanded`, since neither has a
  live update subscription — DD2). `main.js`'s `INTERNAL_PAGES.jars` and
  `jars.html`'s script tags gained the two new module entries (design review
  fix — the exact-match resolver 404s an unregistered module).
  `renderer-globals.d.ts` gained the four new bridge methods + the
  `jar-data-changed` event pair. `eslint.config.mjs`'s module-sourceType
  files list gained the two new panel modules (the `jars-history-panel.js`
  precedent).

  **Test delta.** Suite grew from 2017 to 2061 (unit + typecheck + lint all
  green). New: `test/unit/jar-data-helpers.test.js` (15 tests — pure-helper
  coverage incl. the live-measured default-port sentinel, see Findings).
  `history-store.test.js` gained 6 `originsForJar` tests (collapse-by-origin,
  distinct-origin isolation, cross-jar isolation, empty, validation).
  `jar-ipc.test.js` gained ~24 new/updated tests: the four new twins'
  fail-closed validation/session-failure/internal-twin-parity matrices, the
  composite-union site-data cases (real temp-dir `IndexedDB/` scrape via
  actual `fs.readdir`, never mocked), and updated DD10 broadcast assertions
  on the existing `jars-clear-data`/`jars-wipe` tests (the new
  `jar-data-changed` broadcast changed their expected event/broadcast
  sequences).

  **Smoke-level live check (rig).** Launched
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run
  dev:automation`; dev profile (`~/.config/goldfinch-dev`) backed up
  (tar+sha256 to `/tmp`) before mutating. Admin one-shot Node client
  (`scripts/lib/mcp-client.mjs`, key captured via `parseDevMintLine` on the
  launch log and passed to `connectAutomation({ key })` as a function
  argument only — never printed/argv/env/disk). Opened `goldfinch://jars` via
  `evaluate(chromeWcId, 'openJarsPage()')`; drove the internal tab's own
  controls via `click`/`scroll` (readDom/readAxTree/captureScreenshot for
  observation — the jars page's own wcId correctly refuses `evaluate`, as
  expected for the internal session). Fixture: two local `http://127.0.0.1`
  origins opened in the pre-existing `work` persist jar — one seeded with
  `document.cookie` (Spike B's verified mechanism) + `indexedDB.open`/put,
  the other visited-only (no storage). On the real `Work` jar section (149
  live visits, real Google/Wikipedia cookies already present):
  - **Cookies tab**: listed the jar's real live cookies (name/domain/expiry,
    no value field) plus the new fixture cookie; per-cookie delete on a real
    `.google.com` domain-attribute cookie removed exactly that row (9→8
    rows) with no page reload — the live re-query IS the session read-back,
    confirmed empty for that identity.
  - **Site-data tab**: composite union rendered correctly — the seeded
    origin showed `Has stored data` (stored tier), the visited-only origin
    showed `Visited — storage unconfirmed`, pre-existing history-only
    origins from the real jar all showed `visited`, no usage figure, the
    known-gap note rendered. Per-origin delete on the `stored` origin
    cleared its IndexedDB dir and the row correctly DOWNGRADED to `visited`
    on next paint (history row survives storage clear — matches the
    documented no-op-on-history edge case) rather than disappearing.
  - **Default-port dirname probe (leg AC)**: opened a real
    `https://example.com/` tab in the same jar (network reachable from the
    rig) and seeded IndexedDB there. **Finding**: the on-disk dirname was
    `https_example.com_0.indexeddb.leveldb` — Chromium DOES carry a port
    segment for a default-port origin, but as the literal sentinel `0`, not
    443/80 and not omitted. This is NEW information beyond Spike B (which
    only measured an explicit non-default port). As originally written,
    `originFromIndexedDbDirname` would have parsed this to
    `https://example.com:0`, which never merges with `origin()`'s own
    `new URL().origin` (default ports omitted) — silently splitting one
    default-port origin into two rows (`stored` at `:0` + `visited`
    unported). **Fixed**: the parser now normalizes a literal port segment
    of `0` to "no port". Unit-pinned
    (`jar-data-helpers.test.js`). Re-verified live after an app restart
    (`window.goldfinch.appQuit()`, relaunch): `https://example.com` now
    renders as ONE `Has stored data` row.
  - Evidence: `/tmp/gf-leg2-jars-screenshot-{1,2,3,4,5,6,9,10,11,14,15,16}.png`,
    `/tmp/gf-leg2-jars-dom-*.html` (raw DOM captures per step).
  - Cleanup: quit via `window.goldfinch.appQuit()` (never SIGKILL, both
    launches); dev profile restored from the tar backup and sha256-verified;
    directory census stable (47 top-level entries pre/post); the `work`
    jar's `IndexedDB/` directory confirmed back to empty (the fixture/probe
    origins gone) post-restore.

- 2026-07-17: `retention-sweep-and-docs` — implementation complete, pending
  the Witnessed behavior gate (FD runs `/behavior-test jar-data-surfaces`
  next). Leg status stays `in-flight` per the leg spec's Post-Completion
  Checklist (landed only after the gate passes). Everything except the
  behavior-test run itself was implemented against the leg spec's SEQUENCING
  invariant, overwrite-cause ruling, storagePath partition recovery,
  stamp-then-expire order, will-quit quiesce guard, DD7 bookkeeping
  lifecycle, and DD10 completion broadcast.

  **Implementation summary.** `src/main/app-db.js`'s `attemptOpen` is now a
  real, cumulative `user_version` ladder (v0→v1→v2 in one open for a fresh
  profile; v1→v2 as the standalone step) adding the `cookie_seen` table
  (metadata-only, DD7) and a `createCookieSeenStore()` seam
  (`insertIfAbsent`/`deleteByIdentity`/`deleteByJar`/`selectExpired`) mirroring
  `createDocumentStore`'s module-singleton shape. `src/main/history-store.js`
  gained `expiredOriginsForJar(jarId, cutoffMs)` (a pure post-filter over
  `originsForJar`'s existing per-origin MAX, doc-commented with the
  SEQUENCING invariant its callers must honor). New
  `src/main/jar-data-helpers.js` additions (all pure, unit-tested):
  `partitionFromStoragePath` (parses `ses.storagePath`'s `Partitions/<name>`
  segment — the `session-created` hook receives no partition field) and
  `cookieChangeAction(cause, removed)` (the DD4 VERDICT overwrite-cause
  decision, extracted to a pure function specifically so it's unit-pinned
  against the full measured `cause` enum — main.js itself has no unit-test
  harness). New `src/main/retention-sweep.js` (Electron-free,
  `createRetentionSweep({ cookieSeen, historyOrigins, sessionFor, cookieUrl,
  now })`): `snapshotAgedOutOrigins` (the pre-prune synchronous read callers
  must run first), `sweepJar`/`sweepAll` (cookie sweep: stamp-then-expire
  order, pinned; storage sweep: acts only on the caller-supplied snapshot,
  never recomputes it; per-jar and per-half isolation throughout). `main.js`:
  a `cookies.on('changed')` listener wired inside the existing
  `session-created` hook (partition recovered via `partitionFromStoragePath`,
  positive-matched against `jars.list()`, never an eager `fromPartition`
  warm), guarded by `appDb.isOpen()` + try/catch (the F6-hang quiesce guard);
  `pruneAllJars` extended with the snapshot-before-prune sequencing and an
  async fire-and-forget `sweepAll` call, broadcasting `jar-data-changed` per
  jar on completion. `jar-ipc.js`'s `handleSetRetention` gained the identical
  sequencing discipline (snapshot → `pruneOneJar` → fire-and-forget
  `sweepJar`, broadcasting on completion, never on the invoke); every
  destructive path (`wipeJarData` — shared by `handleWipe`/`handleRemove`,
  the `cookies` class of `handleClearData`, `handleCookiesRemove`) now also
  clears `cookie_seen` bookkeeping, fail-soft. `chrome-preload.js` gained a
  `jarsSetRetention` wrapper over the ALREADY chrome-trusted
  `jars-set-retention` channel — resolves the behavior spec's step-6 fixture
  gap (internal-session `evaluate` is refused, so the internal page's own
  retention `<select>` is unreachable from the act path; the wrapper gives
  the same chrome-bridge-evaluate mechanism class every prior mutation uses).
  `renderer-globals.d.ts` gained the matching `GoldfinchBridge` entry.
  CLAUDE.md gained two NEW sections ("Jars page data panels", "Retention
  sweep — cookies + site data") plus an addition to "App database" for the
  v2 ladder — no such sections existed before this leg (edge case noted in
  the leg spec). `tests/behavior/jar-data-surfaces.md` finalized: all
  `[SPIKE]` markers resolved (fixture = page-driven `document.cookie` +
  IndexedDB seed, `localStorage` deliberately NOT used as a fixture since
  Spike B found it non-origin-parseable; step 6 pinned to the
  `window.goldfinch.jarsSetRetention` chrome-bridge call; storage aging =
  last-activity per DD4b) — step 6 was also substantively reworked from the
  original draft: a freshly re-seeded fixture's age is always ≈0, which can
  never exceed even the 1-day retention floor within a single live run, so
  the live removal assertion targets the `work` jar's PRE-EXISTING
  real-aged cookies/history (present from ordinary prior use, corroborated
  by leg 2's own smoke check) while the fixture data's SURVIVAL proves the
  sweep discriminates by age rather than blanket-wiping — day-boundary
  arithmetic itself stays a unit concern (`retention-sweep.test.js`).

  **Test delta.** Suite grew from 2061 to 2116 (unit + typecheck + lint all
  green). New: `test/unit/retention-sweep.test.js` (17 tests — the sweep
  engine with fakes, no Electron: stamp-then-expire ordering, cold-start
  stamping, cookie removal + bookkeeping-row deletion with `secure` recovered
  from the live cookie, per-origin storage clears excluding cookies,
  no-signal origins never touched, per-half and per-jar isolation, DD7
  no-`.value` source grep). `test/unit/app-db.test.js` gained the ladder
  suite (hand-crafted v1 fixture steps to v2 preserving rows; already-v2
  reopen is a no-op; corrupt-file quarantine still lands on v2) plus a full
  `createCookieSeenStore()` suite (7 tests); the pre-existing schema-bootstrap
  test now asserts `user_version=2` with both tables (was pinned to v1 —
  updated, not just extended). `test/unit/history-store.test.js` gained 6
  `expiredOriginsForJar` tests (origin-grain MAX semantics, exclusive cutoff
  boundary, per-jar isolation). `test/unit/jar-data-helpers.test.js` gained
  `partitionFromStoragePath` (POSIX/Windows separators, no-Partitions-segment,
  trailing-segment, non-string inputs) and `cookieChangeAction` (the full
  measured `cause` enum) coverage. `test/unit/jar-ipc.test.js` gained ~20
  tests: DD7 bookkeeping-cleanup pins for all four destructive paths
  (jars-remove, jars-clear-data cookies class, jars-wipe, jars-cookies-remove
  — each against the REAL `appDb.createCookieSeenStore()`, not a fake, since
  jar-ipc.js requires app-db.js directly), and `jars-set-retention`'s
  SEQUENCING pin (`expiredOriginsForJar` called before `pruneOneJar`, via the
  fake historyStore's own call-order log) plus a regression guard proving the
  sweep actually clears the aged-out origin end-to-end (a wrong post-prune
  ordering would make this assertion fail, not just a logged call order) and
  the DD10 completion-broadcast timing (absent synchronously after invoke,
  present after a `flush()` macrotask tick).

  **Deviations from the leg spec (see Deviations section below for the
  full list).**

<!-- FD note anchor -->


---

## Flight Director Notes

- 2026-07-17: Flight 2 designed autonomously. Spike-first structure (DD1)
  per the mission's premise-audit requirement; DD3/DD4 deliberately carry
  ranked candidates + decision criteria rather than pre-locked mechanisms —
  the spike verdicts back-annotate them. Branch strategy: stacked on
  `flight/01-sqlite-store-consolidation` (PR #96 draft; classifier blocks
  `gh pr ready`/`merge` this session — operator merges at HAT).
- 2026-07-17: Design review (Architect, 1 cycle): **approve with
  changes**. HIGH: no broadcast invalidates cookie/site-data listings
  changed via Clear/Wipe/sweep paths (`handleClearData` broadcasts only
  history-changed; `jar-wiped` never reaches internal-preload) → **DD10**
  added (`jar-data-changed {jarId, classes}`, fired incl. on SWEEP
  COMPLETION, never the setRetention invoke — closes the race the review
  spotted). Mediums adopted: app-db `user_version` ladder machinery named
  as real work (only version-0 branch exists); cookies listener anchored
  at `session-created` (no eager fromPartition warms); `removed:true`
  deletes bookkeeping rows; will-quit quiesce guard (F6-hang class); panel
  queries gate on tab-selection, not section-visibility. Q-rulings: leg 2
  gets a smoke-level live check (Witnessed gate stays at leg 3); CDP probe
  hard time-boxed. Reviewer re-verified all inherited electron.d.ts
  premises — no drift. Second cycle skipped (changes adopt the reviewer's
  recommendations). Flight → ready.
- 2026-07-17: Flight → in-flight; branch
  `flight/02-jar-data-surfaces-and-retention` stacked on the F1 branch.
  Leg 1 `spikes-and-rulings` designed. **Risk tier: LOW for design review**
  (no shipped code; the flight design review vetted candidates + decision
  criteria) — per-leg review skipped; the spike discipline (second
  instrument, GO/NO-GO, time-boxes) is written into the leg. Leg 1 → ready.
- 2026-07-17: Leg 2 `data-panels` designed against the spike verdicts.
  **Risk tier: HIGH** — new security-sensitive IPC surface (internal
  twins over live sessions) + the DD10 freshness contract. Design review
  (Developer, 1 cycle): **approve with changes**. High: INTERNAL_PAGES.jars
  allowlist registration missing (exact-match resolver → unregistered
  modules 404); high: the tab-selection activation seam doesn't exist —
  jars-tabs.js selectTab's hardcoded history branch must be generalized
  (now in scope). Medium: origin normalization corrected to a pure
  `new URL(url).origin` helper (trackers.js helpers drop scheme/port and
  collapse eTLD+1 — union keys and clearStorageData would break); medium:
  smoke check extended to seed IndexedDB and verify the `stored` tier +
  live-probe the default-port dirname format (spike only measured
  explicit-port localhost). Lows + suggestions folded (four wrappers,
  both-panels direct refresh, no-confirm delete convention, viewGen
  staleness guard required, empty-name cookie + visited-tier-no-op edge
  cases). Second cycle skipped (fixes adopt the reviewer's
  recommendations). Leg 2 → ready.
- 2026-07-17: Leg 3 `retention-sweep-and-docs` designed. **Risk tier:
  HIGH** — schema migration (the first real user_version ladder),
  destructive sweeps, lifecycle listener. Design review cycle 1: **needs
  rework** — the review caught a genuine design bug (storage sweep
  sequenced after the history prune would destroy its own evidence: aged
  origins vanish from originsForJar before the sweep reads them) plus a
  process gap (the storage-class aging ruling lacked DD1's record
  discipline). Rework: SEQUENCING invariant (snapshot-before-prune,
  unit-pinned) + DD4b recorded in flight.md and Decisions as an honest
  desk ruling; session-created partition recovery via storagePath parse;
  behavior-gate step 6 pinned to the jarsSetRetention bridge; v1-fixture
  framing made honest; lows folded. Cycle 2: **approve** — consistency
  verified across all four artifact locations, no new issues. Leg 3 →
  ready.
- 2026-07-18: **Behavior gate `jar-data-surfaces` RUN: PARTIAL 6/7**
  (run log tests/behavior/jar-data-surfaces/runs/2026-07-17-23-48-56.md;
  spec → active with amended step 6). Checkpoints 2-5, 7 PASS with
  triangulated evidence (DD7 no-value gate held; tier downgrade semantics;
  data-class boundaries; confirm-gated region clears). Checkpoint 6:
  storage/history sweep LIVE-VALIDATED (153→56 history, 9→5 origins,
  fresh fixture survived, DD10 auto-repaint proven) but the cookie-removal
  clause rendered an honest FAIL — structurally unobservable on a
  first-ever sweep (cold-start stamp-before-expire, deliberate and
  unit-pinned). FD disposition (pre-authorized): accepted as a SPEC
  premise gap (not a product defect), spec amended in-run to the
  cold-start semantics, **live cookie-removal witness HAT-scoped**
  (needs day+-aged cookie_seen rows — cross-session by nature).
  Apparatus incidents (Executor, self-caught): launch-stdout mint-line
  captured into evidence (redacted in place) → the redaction destroyed
  the only key copy → SIGTERM recovery + relaunch (clean, fixture
  survived). Lessons recorded in the run log for future specs: private
  launch-log path with redacted evidence derivative; re-screenshot before
  every mutating coordinate click. Leg 3 → landed.
- 2026-07-18: Flight-end review (Reviewer, 1 cycle): **[HANDOFF:confirmed]**,
  zero blocking issues; every DD verified in code (SEQUENCING invariant,
  overwrite-cause routing, quiesce guard, DD7 value-free boundary, DD10
  sites, ladder correctness, activation generalization, fail-closed twins);
  suite 2116/typecheck/lint re-verified. Two non-blocking findings, both
  discharged by the FD: CLAUDE.md JAR_PANELS attribution fixed;
  **`npm run a11y` RUN on the live rig — GREEN** ("No NEW violations —
  every violation node is in the ACCEPTED baseline"; key handled by
  env-var reference from a PRIVATE launch log per the run-1 lesson, log
  removed after; app quit via SIGTERM to the main process after the
  one-shot bridge call hit a client-side JSON-RPC error — clean exit
  verified, the run-proven fallback).

---

## Decisions

### Spike A verdict — retention mechanism (GO: candidate 1)

**Mechanism: candidate 1 (cookie first-seen bookkeeping via
`cookies.on('changed')`), creation-age (first-seen) semantic, new `app.db`
schema-v2 table.** Evidence below; each claim names its instrument.

- **Instrument.** Scratch Electron app (`/tmp/gf-probe-main.js`, run via
  `./node_modules/.bin/electron … --ozone-platform=wayland --no-sandbox`
  with `userData=/tmp/gf-probe-userdata`) — a throwaway app on the SAME
  Electron binary, never the goldfinch app or profile. Full log:
  `/tmp/gf-probe-results.json`.

- **Review annotation (a) — `session-created` anchor, MEASURED.** Attached
  the listener before any `fromPartition` call. `session-created` fired
  synchronously on the FIRST `session.fromPartition('persist:jarA')` call
  (count 0→1, `firedSynchronously: true`); a SECOND call for the same
  partition did NOT refire it (`refired: false`, same session instance
  returned); a never-touched partition never fired it. Confirms main.js's
  existing hook (`app.on('session-created', …)`, main.js:3694) is the
  correct anchor — no eager `fromPartition` warm-at-boot needed, matching
  the design-review ruling.

- **Review annotation (b) — `removed:true` / orphan rows, MEASURED, ruling
  refined.** Full `cause` enum (electron.d.ts:7261): `inserted` |
  `inserted-no-change-overwrite` | `inserted-no-value-change-overwrite` |
  `explicit` | `overwrite` | `expired` | `evicted` | `expired-overwrite`.
  Live sequence observed: explicit set → `inserted`/`removed:false`;
  explicit remove → `explicit`/`removed:true`; **same-identity value
  overwrite → TWO events, `overwrite`/`removed:true` for the old value
  immediately followed by `inserted`/`removed:false` for the new value,
  same name+domain+path identity.** A naive "delete row on any
  `removed:true`" handler would wipe and recreate the bookkeeping row on
  every value refresh (e.g. a session/CSRF cookie re-issued on repeat
  visits), resetting `firstSeenMs` and defeating creation-age aging for
  exactly the cookies most likely to be revisited. **Ruling for leg 3**:
  the `removed:true` handler skips deletion when `cause === 'overwrite'`
  (row survives with its original `firstSeenMs`); it deletes on
  `explicit`, `expired`, `expired-overwrite`, `evicted`. The
  `removed:false` handler is `INSERT OR IGNORE` (never clobbers an
  existing row), so the insert half of an overwrite pair is a no-op
  against the surviving row. Bonus finding: `cookies.set` with an
  already-past `expirationDate` produces NO `changed` event at all (silent
  refusal, not an insert-then-immediate-expire) — distinct from natural
  `expired`, which fires later for a cookie that WAS valid.
- **Review annotation (c) — `user_version` ladder, CODE-CITED, reconfirmed
  no drift.** `src/main/app-db.js` `attemptOpen` (lines 99-118) branches
  only on `user_version === 0`; no v1→v2 step exists. Building it (and
  re-testing the bootstrap ladder) remains real leg-3 work.

- **Cookie identity / URL reconstruction (DD2 dot-strip), MEASURED,
  second-instrument confirmed.** Host-only cookie (`cookies.set` with no
  `domain` field) → `{ domain: 'host-only.test', hostOnly: true }` (no
  leading dot). Domain-attribute cookie (`domain: 'domain-cookie.test'`) →
  `{ domain: '.domain-cookie.test', hostOnly: false }` (leading dot).
  DD2's unconditional dot-strip is safe for both (a strip on a dotless
  domain is a no-op). `cookies.remove(reconstructedUrl, name)` verified
  successful for BOTH shapes — confirmed via a `cookies.get` read-back
  after each remove (the second instrument): neither cookie was present
  afterward.

- **Storage-shape ruling against measured cardinality.** Live rig (admin
  MCP client, `scripts/lib/mcp-client.mjs`), throwaway jar
  `spike-cardinality-3`, single visit each to 6 major real sites (google,
  github, wikipedia, reddit, nytimes, amazon), no logins. **On-disk
  `Cookies` sqlite table (direct `sqlite3` read, first instrument): 41
  rows** after a full settle wait (Chromium batches cookie-store commits;
  an immediate read returned 0 — waited ~50s post-navigation for the
  commit timer). **`document.cookie` JS-visible spot-check per site
  (second instrument, separate run): 1/4/3/5/9/10 = 32 total** across the
  same 6 sites — lower as expected (excludes httpOnly cookies), same order
  of magnitude, corroborating the on-disk figure. A real jar with logins
  and repeat visits over weeks will likely run to the low hundreds. This
  is real, indexable-scale data — rules OUT "no bookkeeping" and confirms
  the F1 debrief's high-cardinality guidance: a real `app.db` v2 table
  (not the `documents` wholesale-replace-per-store shape) is warranted,
  and no exotic scale engineering is needed at this cardinality.

- **DD7 boundary check.** Bookkeeping row = `(jarId, name, domain, path,
  firstSeenMs)` only — no cookie value, no storage content. Satisfies
  DD7 (metadata-not-content).

- **Sweep-trigger seam, CODE-CITED, no test-only hook needed.**
  `src/main/jar-ipc.js` `handleSetRetention` (lines 306-320) already calls
  `historyStore.pruneOneJar` synchronously immediately after
  `broadcastJarsChanged` on every retention edit — a real, already-shipped
  production IPC path (`jars-set-retention` / `internal-jars-set-retention`).
  Leg 3 extends the same handler to also sweep the new bookkeeping table;
  the behavior test's step 6 drives it through the actual retention
  control, no test-only hook required.

- **Quit-ordering (DD6 addendum), CODE-CITED.** `will-quit` (main.js
  3972-3986) currently closes `historyStore` then `appDb`, each in its own
  try/catch; no cookies-listener quiesce guard exists yet because the
  listener doesn't exist pre-leg-3. Ruling stands as a leg-3 build
  requirement, with a direct precedent already in the file to extend
  (same try/catch shape), not a new pattern to invent.

**GO.** All three DD4 review-annotation concerns answered with measured or
code-cited evidence; one new implementation-nuance ruling (`overwrite`
cause handling) surfaced by the probe that leg 3 must implement.

### Spike B verdict — site-data origin enumeration (composite GO)

- **Candidate 1 (CDP without a live tab) — NO, confirmed cheaply
  (<5 min rig time, well under the 20-min box).** Type-cited:
  `node_modules/electron/electron.d.ts` — `debugger` (line 18460) is a
  member of `WebContents` only; `Session` (class starting line 12268 in
  this Electron version) has no `debugger` member at all — no
  session/browser-level CDP entry point exists in Electron's public API.
  Apparatus-confirmed: the live rig's `openDevTools` MCP tool is wcId-only
  (calling it with no `wcId` returns `automation: bad-handle — wcId must
  be a number, got undefined`) — there is no jar/session-level variant to
  even attempt this against. **Eliminated.**

- **Candidate 2 (`ses.getStoragePath()` + on-disk scrape) — MEASURED,
  partially viable.** Scratch Electron instrument: seeded a real HTTP
  origin (`http://127.0.0.1:<port>`, a local Node `http` server — `data:`
  URLs have opaque origins and refuse localStorage) with both
  `localStorage.setItem` and an `indexedDB.open`/put, in a session created
  via `session.fromPartition`. Walked `ses.storagePath` afterward
  (`/tmp/gf-probe-storage-layout.json`). **IndexedDB is stored as an
  ORIGIN-NAMED leveldb directory**
  (`IndexedDB/http_127.0.0.1_<port>.indexeddb.leveldb`) — the origin is
  directly recoverable from directory-name parsing, no content parsing
  needed (low fragility). **`Local Storage` is a single, consolidated,
  NON-origin-keyed `leveldb` store** (`Local Storage/leveldb`) — the
  origin is NOT recoverable from the directory structure; recovering it
  would require parsing an undocumented internal leveldb key encoding —
  exactly the fragility DD3 named. **Ruling**: candidate 2 is viable ONLY
  as an IndexedDB-origin directory scrape (defensive, degrade-to-"unknown"
  per DD3's shape); it cannot enumerate localStorage-only origins.

- **Candidate 3 (history-derived origins) — FEASIBLE, code-cited, no live
  probe needed (not a new coordinate claim).** `src/main/history-store.js`
  already stores `(jar_id, url, visited_at)` per visit row, and a proven,
  already-shipped `GROUP BY`-aggregation idiom exists in production (the
  `suggest` query, history-store.js:205-219, `GROUP BY v.url` +
  `MAX(v.visited_at)`). Normalizing `url` → origin (reusing
  `hostnameOf`/`registrableDomain`, `src/main/trackers.js:71,81`, already
  used for the privacy-cookies IPC) and grouping the same way is a direct
  extension of an existing, tested pattern — no new schema, no new read
  shape.

- **Mechanism ruling: COMPOSITE.** Origin list = UNION of (i) IndexedDB-
  scrape origins ("has stored data") and (ii) history-derived origins with
  jar activity inside the retention window ("visited — storage
  unconfirmed"), each with per-origin `clearStorageData({ origin })`
  delete. Refines DD3's anticipated "2-for-listing + 3-as-fallback" by
  scoping candidate 2 down to IndexedDB only (not full on-disk parsing),
  keeping the "defensive, never crash, degrade to unknown" bar honest.

- **Usage/quota — CONFIRMED NO, premise reconfirmed (no drift).**
  `Session` exposes no quota/usage API in electron.d.ts. Raw on-disk file
  sizes ARE technically visible (seen in the scratch probe's layout dump)
  but presenting them as "usage" would mislabel implementation overhead
  (leveldb amplification, cache) as user-meaningful storage — rejected.
  **UI shows no usage figure.**

- **Honest-labeling ruling.** Two-tier origin badges: "has stored data"
  (IndexedDB-confirmed) vs "visited — storage unconfirmed" (history-only).
  The panel documents the known gap (localStorage-only, never-visited
  third-party-only origins are invisible to both mechanisms) rather than
  presenting the list as complete.

### DD4b — storage-class aging ruling (leg-3 design, FD desk ruling)

Storage sweeps age by origin last-activity from history; no-signal
origins exempt (documented gap); cookies age by first-seen per Spike A.
Recorded as a DESK ruling — not rig-probed — with the honest basis: the
two empirical components (`originsForJar`, `clearStorageData({origin})`)
were each independently measured at spike/leg 2; the aging semantic is
policy (DD4 candidate 2), carrying its named documentation duty
("since last activity", never "since creation"). Surfaced by the leg-3
design review's process check; back-annotated into flight.md as DD4b
alongside the SEQUENCING invariant the same review caught (snapshot
aged-out origins BEFORE the history prune — post-prune, the sweep's
targets are invisible; unit-pinned by the leg).

### Fixture-mechanism ruling (behavior spec `jar-data-surfaces`)

**Page-driven `document.cookie`, not `ses.cookies.set`.** The automation
MCP surface (`docs/mcp-automation.md`'s full tool table) exposes NO
admin-tier cookie-setting tool — `ses.cookies.set` is not reachable
through the current apparatus without shipping a new admin-only tool
(out of scope for this spike). Page-driven `document.cookie` IS
live-verified: admin-opened `https://example.com/` in a throwaway jar,
ran `document.cookie = 'spikeFixture=hello; max-age=3600; path=/'` via
`evaluate` on the page's OWN wcId (not internal-session, so not refused),
and read back `document.cookie === 'spikeFixture=hello'` in the same
call. **`jar-data-surfaces` step 1's fixture mechanism is page-driven
`document.cookie` via `evaluate` on a real jar tab.**

---

## Deviations

- 2026-07-17, leg 3 (`retention-sweep-and-docs`): **behavior spec step 6
  reworked, not just [SPIKE]-resolved.** The original draft's step 6 asserted
  "aged-out cookie/site data is removed" after re-seeding the fixture and
  shrinking to the minimum retention window — but a freshly re-seeded
  cookie/origin has age ≈ 0, which can never exceed even the 1-day
  retention floor within one live run (no fake-timer capability in a real
  Electron process). Finalized instead to assert removal against the `work`
  jar's PRE-EXISTING, genuinely-aged real cookies/history (present from
  ordinary prior use, corroborated by leg 2's own smoke-check findings on
  the same jar), while asserting the freshly re-seeded fixture data SURVIVES
  the same sweep pass — proving the sweep discriminates by age rather than
  wiping the jar wholesale. Exact day-boundary arithmetic stays a unit
  concern (`retention-sweep.test.js`'s stamp/expiry-order and cutoff-boundary
  tests), consistent with the leg's own "Out of Scope: Retention long-horizon
  aging" framing, which this rework makes literally honest rather than
  contradicted by step 6's own expected-results text.
- 2026-07-17, leg 3: **`retention-sweep.js`'s factory returns a third
  function, `snapshotAgedOutOrigins`, beyond the `{ sweepJar, sweepAll }`
  shape the Outputs section names.** The SEQUENCING invariant requires the
  aged-out-origin read to happen strictly BEFORE the history prune, and the
  prune itself stays in the caller (`main.js`/`jar-ipc.js`, unchanged call
  sites) — so the snapshot step needed its own caller-invokable entry point
  rather than being folded into `sweepJar`/`sweepAll` (which would either
  recompute it too late or require the caller to pre-empt an internal call,
  neither of which is expressible in a two-function API). Implementer's-call
  latitude per the leg's own framing elsewhere ("final statement set at
  implementation").
- 2026-07-17, leg 3: **the DD4 VERDICT overwrite-cause decision was
  extracted to a pure function** (`jar-data-helpers.js`'s
  `cookieChangeAction`) rather than left inline in `main.js`'s
  `session-created` listener as the leg's Implementation Guidance describes
  it. `main.js` has no unit-test harness in this repo (Electron-required),
  so the acceptance criterion's "unit-pinned against the measured event
  sequence" language would otherwise be unverifiable by an actual unit test
  — the extraction makes the full measured `cause` enum
  (`inserted`/`inserted-no-change-overwrite`/`inserted-no-value-change-overwrite`/
  `explicit`/`overwrite`/`expired`/`expired-overwrite`/`evicted`) directly
  testable, with `main.js` reduced to a thin dispatch over the pure result.

---

## Anomalies

*(none)*

---

## Session Notes

- 2026-07-17: Flight designed; behavior spec `jar-data-surfaces` drafted.
