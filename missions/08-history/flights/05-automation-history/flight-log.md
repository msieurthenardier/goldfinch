# Flight Log: Automation History Surface

**Flight**: [Automation History Surface](flight.md)

## Summary

Leg 1 (`history-read-tool`) landed: `getHistory` end-to-end below the
transport — engine op + two injected accessors, `HISTORY_TOOLS` ToolDef
(registry 27→28), scope-façade jar confinement, the `enumerateTabs`
description fix (mcp-tools side), full unit matrix. Leg 2's Developer
half (docs) is landed; the FD half (live behavior test + leg land +
flight close-out) remains.

**Flight complete (2026-07-13).** Both legs landed and closed to
`completed`. Full gate suite green at 1494/1494 (typecheck and lint
clean); the mission-closing isolation behavior test
`history-automation-isolation` passed 7/7 across two live launches
(run log
`tests/behavior/history-automation-isolation/runs/2026-07-13-02-13-20.md`).
Flight review passed clean (`[HANDOFF:confirmed]`, one bookkeeping nit —
leg 2's Post-Completion Checklist — resolved at close-out). Flight →
`landed`; mission Success Criteria #1, #2, #3, and #10 checked off,
bringing all 11 mission criteria to closed. Flight 5 checked in the
mission's Flights list.

---

## Leg Progress

### Leg 1: history-read-tool — landed (2026-07-12)

- **Engine** (`src/main/automation/engine.js`): `createEngine` opts gain
  `getHistoryReads` (`{ listRecent, search }`, the getDownloads injection
  precedent) and `isKnownJar`. New `getHistory(jarId, { query, limit,
  before })` op: missing/non-string jarId → static `automation: bad-args
  — jarId required`; unknown jar → `automation: unknown-jar`;
  query+before → static `automation: bad-args — query does not page`;
  non-empty query → `search(jarId, query, { limit })`, else →
  `listRecent(jarId, { limit, before })`; returns `{ jarId, visits }`
  (rows verbatim). Pure computation — never touches deps()/resolve.
- **main.js**: both engine constructions threaded (the MCP
  `startMcpServerInstance` getEngine accessor AND the dev-seam
  `automation:dev-invoke` engine) — `getHistoryReads` over `historyStore`,
  `isKnownJar` over `jars.list()`, matching the existing getDownloads
  injection style at both sites.
- **mcp-tools.js**: new labeled `HISTORY_TOOLS` array (jar-confined, NOT
  admin-only — own comment) with the `getHistory` ToolDef ({ jarId?,
  query?, limit?, before? }, identity semantics spelled in the
  description, JSON-text result); merged into `TOOLS` (27→28). The
  `enumerateTabs` description's stale "non-internal" claim fixed (admin
  listings include internal tabs; jar listings never do — behavior
  unchanged, pinned by `mcp-jar-scoping`).
- **scope.js**: custom façade op `getHistory` — `requireJar()`; a
  supplied foreign jarId → `automation: out-of-jar` thrown BEFORE any
  engine/accessor call; absent/own jarId → engine call forced to the
  caller's own `jar.id`. Admin → engine unchanged. Header note updated:
  first jar-CONFINED no-wcId read (contrast with the admin-only customs).
- **Tests**: new `test/unit/automation-engine.test.js` (getHistory branch
  matrix over accessor fakes, 8 tests — file-local electron Module._cache
  double, process-isolated per node --test); `automation-scope.test.js`
  +5 (own/absent/foreign/unknown jarId, admin passthrough, zero accessor
  invocations pinned on refusal); `automation-mcp-tools.test.js` count
  27→28 + 8 getHistory ToolDef/dispatch/isError tests; the wcId-first
  guard test passes untouched (no wcId in the schema — as designed).
  `automation-mcp-server.test.js` `EXPECTED_TOOL_COUNT` 27→28 (+ its test
  title); `mcp-server.js` count comment updated.
- **Gates**: `timeout 120 npm test` → 1494/1494 pass (~1s; baseline HEAD
  1473 + 21 new), `npm run typecheck` clean, `npm run lint` clean.
  Grep-AC: zero `${` in any `src/main/automation/*.js` module (all new
  error strings static).

### Leg 2: verify-and-isolation-tests — Developer half landed (2026-07-12)

Docs-only, per flight DD3; every claim verified against the actual code
(`engine.js`, `scope.js`, `mcp-tools.js`, `main.js`'s wiring) before
writing, not copied from the flight spec's prose.

- **`docs/mcp-automation.md`**: tool count 27→28 in both places (the
  overview line's category breakdown and the "All N tools" tool-reference
  intro) — the overview line now spells all six categories including
  **1 history tool** (`getHistory`, jar-confined, called out as NOT
  admin-only alongside the other five). New **"History tools (1)"**
  section (after "Admin chrome / app-level") documents `getHistory`'s
  input schema, `{ jarId, visits }` result shape (`visits` rows —
  `{ id, url, title, visitedAt }`, verified against
  `history-store.js`'s `rowToVisit`), identity semantics (jar key:
  `jarId` optional, must match own jar if supplied, out-of-jar refusal
  thrown at the façade before any store read; admin: `jarId` required,
  any known jar, `bad-args — jarId required` / `unknown-jar` refusals),
  the query-vs-before rule (mutually exclusive; `bad-args — query does
  not page` applies to both identities, verified as an engine-level
  check that fires after the façade's own-jar delegation), and the
  refusal-code table broken out by identity. The `enumerateTabs`
  tool-reference table row's stale "non-internal" claim is fixed to
  match the already-correct ToolDef description (admin listings include
  internal `goldfinch://` tabs; jar listings never do — session filter;
  behavior unchanged, doc-only fix, mirroring the Leg-1 mcp-tools.js-side
  fix).
- **`README.md`**: one line added to the Automation-surface feature
  bullet — jar-scoped `getHistory` gives an automation client read
  access to its own jar's browsing-history memory.
- **`CLAUDE.md`** (automation-engine section): the tool-inventory
  sentence gains the sixth category, **`+ 1 history (jar-confined)`**
  (27→28 total), contrasted explicitly against the admin chrome/app-level
  pair, plus a note that `getHistory` is backed by two `createEngine`-
  injected accessors mirroring the `getDownloads` precedent —
  `getHistoryReads` (`{ listRecent, search }`, from `historyStore`) and
  `isKnownJar` (from `jars.list()`), both wired at both engine-
  construction sites in `main.js` (verified at `main.js:784-785` and
  `:2718-2719`).
- **Gates** (post-docs, no source touched): `timeout 120 npm test` →
  1494/1494 pass (~1s); `npm run typecheck` clean; `npm run lint` clean.
- Leg status → `in-flight` at Developer-half start (FD half — behavior
  test, leg land, flight close-out — remains).

---

### Leg 2 — `verify-and-isolation-tests` (FD half)

- **Status**: landed — **behavior test `history-automation-isolation`
  PASS 7/7** (run log
  `tests/behavior/history-automation-isolation/runs/2026-07-13-02-13-20.md`;
  spec → active). Live key→jar binding proven across two launches against
  a deliberately retained ~50k foreign-row population; every verdict
  independently grounded (full-row DB audits + the Validator's own MCP
  client reproductions). Refusal matrix live: out-of-jar / unknown-jar /
  bad-args, all exact strings, zero data alongside.

**Debrief carry-forwards from the run**:
- AUTHORING.md candidates: (1) multi-launch specs must PRE-DECLARE
  per-launch teardown mechanics when a run's key tier has no in-protocol
  quit (jar-only keys can't reach the admin-tier evaluate quit path);
  (2) "Executor tears down only after Validator [CLOSING]" should be an
  explicit run-protocol line (run-2 early teardown cost the Validator its
  live-reproduction option — evidence sufficed, sequencing note stands);
  (3) every negative checkpoint should carry a same-session positive
  control (the discrimination-pinning pattern this run used);
  (4) refusal checkpoints should capture raw result JSON, not rendered
  CLI lines; (5) delta narratives should enumerate rows.
- Product observation: the out-of-jar message discloses the caller's own
  bound jar id (own-binding only — acceptable, recorded).

---

## Decisions

*(none yet)*

---

## Deviations

- **Leg 1 — one file beyond the leg's Files Affected list:**
  `test/unit/automation-mcp-server.test.js` pins the registry size too
  (`EXPECTED_TOOL_COUNT`), so it needed the same 27→28 bump (covered by
  DD1's "the tool-count assertions … update" clause; discovered when the
  full suite ran — six SDK-handshake tests failed on the stale count, and
  the failed handshakes left connections that wedged the suite past the
  120 s gate until the count was fixed). `mcp-server.js`'s count comment
  was updated alongside. No behavior deviation.

---

## Anomalies

*(none yet)*

---

## Session Notes

- **2026-07-12 (flight design)**: Designed on the standing F1 recon
  (automation seams) + two live behavior runs' apparatus experience.
  Rulings: one `getHistory` tool (query param switches recent/search);
  read-only surface (no agent-facing clear/delete — agents get memory,
  not erasure); the F1-run `enumerateTabs` doc divergence resolves by
  fixing the stale DESCRIPTION (behavior is correct and already pinned by
  `mcp-jar-scoping` step 8).
- **2026-07-12 (design review)**: Architect verdict **approve with
  changes** (single cycle; the reviewer live-probed the dev profile).
  Applied: HIGH — DD4 gains dev-profile state pins (F4 leftovers:
  defaultId drifted to rename-test with ~50k rows; verify/set the flag
  deliberately, resolve jar names live, and — FD ruling — keep the large
  population as a deliberate isolation-despite-scale condition with
  delta/marker assertions); MEDIUM — admin+unknown jarId → explicit
  `unknown-jar` via a new injected `isKnownJar` accessor (FD ruling:
  house convention over silent-empty; jar-key foreign jarId stays
  `out-of-jar`); LOWs — WCID_FIRST_EXEMPT mischaracterization corrected
  (no guard edit needed), new labeled HISTORY_TOOLS array + sixth
  CLAUDE.md category, the enumerateTabs stale claim fixed in BOTH places,
  query+before → bad-args, audit auto-coverage noted. Re-review skipped
  (prescribed fixes). Flight → in-flight.
