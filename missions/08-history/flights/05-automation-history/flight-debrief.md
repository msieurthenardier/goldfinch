# Flight Debrief: Automation History Surface

**Date**: 2026-07-13
**Flight**: [Automation History Surface](flight.md)
**Status**: landed
**Duration**: 2026-07-12 → 2026-07-13
**Legs Completed**: 2 of 2 (`history-read-tool`, `verify-and-isolation-tests`)

## Outcome Assessment

### Objectives Achieved

Exposed a single jar-confined `getHistory` automation tool below the transport: the
engine op + two injected accessors (`getHistoryReads {listRecent, search}`,
`isKnownJar`), the labeled `HISTORY_TOOLS` ToolDef (registry 27→28), and the scope-façade
confinement (a jar key reads only its own jar; a foreign `jarId` is refused
`out-of-jar` before any store read; admin may target any known jar). Docs updated in
three places; the stale `enumerateTabs` "non-internal" description fixed. The mission-
closing isolation behavior test `history-automation-isolation` passed 7/7 across two live
launches against a retained ~50k foreign-row population. Suite green at 1494/1494.

### Mission Criteria Advanced — this flight closed the mission

- **"A jar-keyed automation client can read its own jar's history; requests targeting
  any other jar are refused"** — closed this flight (behavior-test-backed, 7/7).
- **"Jar isolation holds for history on every surface"** — the automation surface half
  closed here, completing the criterion across web-page (structural, Flight 1),
  address-bar (Flight 4), and automation (this flight).
- With Flight 5's close, **all 11 mission success criteria are checked.**

## What Went Well

- **The confinement is defense-in-depth across three genuinely independent layers:**
  (1) the scope façade forces the caller's own `jar.id` and refuses a foreign `jarId`
  *before any engine call*; (2) the engine validates known-jar + arg contract; (3) the
  store itself scopes every query by `jar_id = ?`, and the `before`-cursor path
  fail-closes on a cross-jar cursor. A single-layer bug cannot leak cross-jar rows.
- **A real, stateable security property emerged:** a jar key can *never* reach
  `unknown-jar` (any foreign jarId is refused at the façade before the engine's existence
  check), so a jar key cannot use the `out-of-jar` vs `unknown-jar` discrimination to
  enumerate whether other jars exist. Worth stating explicitly in the mission record.
- **Clean reuse, no new seams.** `getHistory` rides the `getDownloads` injection
  precedent verbatim, wired at both engine-construction sites; it slots in as a custom
  no-wcId op alongside `openTab`/`captureWindow`/`getDownloadsList`, leaving the
  wcId-first guard machinery untouched. The Flight-1 store is jar-keyed by construction,
  so no coupling leaked.
- **Exemplary isolation testing.** The unit layer pins the refusal matrix exhaustively
  *and* pins zero accessor invocations on refusal (confinement short-circuits before the
  engine). The behavior test proves the one property units cannot — live key→jar binding
  over the loopback MCP transport — and clears a high bar: every negative checkpoint
  carried a same-session *positive control* (foreign data provably exists, query provably
  live, zero leakage), grounded in the Validator's own DB audits and independently-built
  MCP client. The isolation-despite-~50k-foreign-rows condition makes it stronger than a
  clean-room run.
- **Read-only-forever is a deliberate, documented product posture** ("agents get memory,
  not erasure") — the right call, worth promoting to an explicit mission invariant.

## What Could Be Improved

### Process

- **The tool-count invariant is a multi-site footgun.** The 27→28 bump had to land in
  `mcp-tools.js`, `automation-mcp-server.test.js`'s `EXPECTED_TOOL_COUNT`, *and* a
  `mcp-server.js` comment — but the leg's Files Affected listed only the primary suite.
  The stale count didn't just fail six tests; the failed SDK handshakes left connections
  that **wedged the whole suite past the 120s gate** until fixed. When a leg changes the
  tool-registry size, its Files Affected must enumerate *every* count-coupled site — a
  missed count site fails expensively, not cheaply. Better still, consolidate to one
  source of truth (a shared constant both test files reference).

### Technical

- **Audit legibility gap (optional-in-DD3, not done).** `getHistory` is audited only via
  the generic `callTool` choke point with `detail = null`. Correct on the privacy axis
  (query text must never be logged), but the audit line can't distinguish an own-jar read
  from a refused foreign attempt without re-parsing the result. A presence-only `jarId=`
  detail is the natural future add as read tools multiply.
- **Confinement compare is now duplicated** (the `jarId != null && jarId !== jar.id →
  out-of-jar(jar.id)` block appears in `openTab` and `getHistory`). Two instances is
  tolerable; a third should trigger extracting a shared `confineToOwnJar(jarId, jar)`
  helper.
- **The `before`-cursor paging variant was not run live** (spec's optional variant,
  deferred). Confinement can't be bypassed via `before` (scope forces own jar.id), so
  this is a completeness gap, not a hole — worth a live paging checkpoint if a cross-jar
  cursor ever becomes reachable.
- **`isKnownJar` is admin-load-bearing only** (redundant for the jar-key path, which
  scope already forces to a known `jar.id`). Correct as written; worth noting the branch
  exists for admin.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `automation-mcp-server.test.js` `EXPECTED_TOOL_COUNT` + `mcp-server.js` comment bumped beyond Files Affected | Registry-size is asserted in multiple sites; covered by DD1's "count assertions update" clause | Yes — enumerate all count-coupled sites; ideally one shared constant |
| `isKnownJar` accessor + explicit `unknown-jar` (vs silent-empty) added at review | House convention: explicit refusal over silent empty | Yes |
| `query`+`before` → `bad-args` (not silent cursor drop) | No silent parameter drop | Yes |

## Key Learnings

- **The jar-confined per-jar-tool pattern is now the reusable template:** (a) a custom
  no-wcId façade op that *forces* own `jar.id` and refuses foreign with `out-of-jar`;
  (b) engine-side required/known validation as the single point that also serves admin;
  (c) distinct audit-legible codes (`out-of-jar` = trust violation, `unknown-jar` =
  lookup miss, kept unreachable by jar keys); (d) own-binding-only error disclosure.
- **Isolation properties that are emergent from façade ordering need a guarding test.**
  "Jar keys cannot enumerate other jars via error discrimination" is currently emergent,
  not enforced against a future op reordering validation before the confinement throw.
  The zero-accessor-invocation-on-refusal assertion (already pinned for `getHistory`)
  should generalize so the next per-jar tool inherits the guarantee.
- **Behavior-test authoring lessons from the run** (already banked in the flight log,
  worth landing in AUTHORING.md): pre-declare per-launch teardown mechanics when the key
  tier has no in-protocol quit (jar-only keys can't reach the admin evaluate-quit path);
  make "Executor tears down only after Validator [CLOSING]" an explicit run-protocol line;
  every negative checkpoint carries a same-session positive control; capture raw result
  JSON at refusal checkpoints, not rendered CLI lines.

## Recommendations

1. **Consolidate the tool-count invariant** to a single source of truth to kill the
   multi-file-bump / suite-wedge failure mode.
2. **Standardize the jar-confined per-jar-tool template** (above) and extract a shared
   `confineToOwnJar` helper before a third op copies the compare.
3. **Add a generalizable scope-level assertion** (zero accessor invocations on foreign
   refusal) so the enumeration-resistance property is enforced, not emergent.
4. **Add the optional `getHistory` audit detail** (`jarId` presence only, never query
   text) as read tools multiply.
5. **Promote read-only-forever to a stated mission invariant** so a future
   "add deleteVisit to automation" is forced through an explicit gate.
6. **Land the behavior-test authoring lessons in AUTHORING.md.**

## Action Items

- [ ] Consolidate `EXPECTED_TOOL_COUNT` / tool-count to one shared constant.
- [ ] Extract `confineToOwnJar(jarId, jar)` when a third per-jar op lands.
- [ ] Add a reusable zero-accessor-invocation-on-refusal scope assertion.
- [ ] Land the four behavior-test authoring lessons in `.claude/skills/behavior-test/AUTHORING.md`.
- [ ] Record read-only-forever as a mission-level automation invariant.
