# Flight Debrief: Jar Data Surfaces + Generalized Retention

**Date**: 2026-07-18
**Flight**: [Jar Data Surfaces + Generalized Retention](flight.md)
**Status**: landed
**Duration**: 2026-07-17 – 2026-07-18 (autonomous execution)
**Legs Completed**: 3 of 3

## Outcome Assessment

### Objectives Achieved

All three mission criteria this flight owns are implemented and
live-verified to the honest extent a single session allows: the Cookies
and Other-site-data panels list real session state with per-item delete
(DD7 value-free boundary held under a hard validator gate); the composite
site-data mechanism ships with honest two-tier labeling; retention
generalizes to cookies (first-seen bookkeeping, `app.db` v2) and site data
(last-activity aging) on the prune cadence with the DD10
sweep-completion broadcast proven live (panels repaint with no manual
refresh). The behavior gate ran **partial 6/7**: the single failing clause
— live cookie-removal-by-age — is structurally unobservable on a
first-ever sweep (deliberate, unit-pinned cold-start stamping); spec
amended, witness HAT-scoped. `npm run a11y` green (no new violations).

### Mission Criteria Advanced

Criteria 4 (cookies panel), 5 (site-data panel), 6 (retention
generalization — with the cookie-witness carry named) — checked at the
flight level with the disposition recorded.

## What Went Well

- **The spike-first structure earned its cost with findings underivable
  from the desk**: CDP eliminated by type-cite in minutes; localStorage's
  non-origin-keyed store narrowing the scrape to IndexedDB-only; the
  overwrite/removed two-event pair whose naive handling would have reset
  first-seen ages on every cookie refresh — a correctness bug avoided
  before a line of feature code existed.
- **Risk-adaptive review cycles tracked real catches (0+1+2)**: leg 2's
  single cycle yielded two HIGHs (INTERNAL_PAGES registration; the
  activation seam that didn't exist) plus the origin-normalization
  correction; leg 3's cycle 1 caught the flight's biggest bug — the
  storage sweep sequenced after the history prune would have shipped
  functionally inert (the prune destroys the sweep's own evidence).
- **The extended smoke check caught a live parser bug the spike missed**:
  Chromium encodes default ports as a literal `_0` sentinel in IndexedDB
  dirnames — one origin would have silently split into two rows.
- **The Witnessed pattern rendered an honest FAIL against
  working-as-coded behavior**: Executor predicted the outcome from code
  BEFORE acting; Validator independently read the same code (mechanism,
  not symptom); the FD disposition amended the spec rather than
  stretching a pass. The system working — with the caveat below.
- Suite grew +99 tests for ~flat wall time (~1.94s) — F1's
  shared-fixture/fakes recommendation honored in the two new pure modules
  (42-43ms for ~40 tests).

## What Could Be Improved

### Process

- **Spec finalization must premise-audit against the flight's OWN prior
  DD text.** DD4's VERDICT recorded the cold-start ruling at leg 1
  ("cookies predating bookkeeping are first-seen-at-first-sweep"); leg
  3's spec rework self-caught the fixture-freshness half but not its
  whole-population corollary — on a first-ever boot NO cookie has a row,
  so the "genuinely aged" real cookies were just as unremovable. Two
  review cycles + one self-correction still left it to the live gate.
  Rule: when a spec's premise depends on "this table has existed a
  while" and the table ships in the same flight, ask "what does time
  zero look like for every row this feature touches," and re-read the
  flight's own DD/VERDICT text before locking assertions.
- **Third key-handling incident this mission, same failure class.** F1:
  transcript leak via redaction regex. F2 run: the briefed launch
  command redirected key-bearing stdout into the evidence dir; the
  in-place redaction then destroyed the only key copy (SIGTERM recovery).
  "Redaction is not a mechanism" is now measured three ways. Structural
  fix adopted mid-mission and to be codified: **launch stdout goes to a
  private non-evidence path; any evidence copy is an explicitly redacted
  derivative; keys move only as function arguments.** Mission debrief
  should promote this from lesson to standing methodology text.
- The SEQUENCING interaction was arguably derivable at flight design
  (DD4 candidate 2 and the history prune share cutoff and table) — an
  explicit ordering-constraint check when two mechanisms consume the
  same aging signal belongs in the DD-writing checklist.

### Technical

- **`src/main/retention-sweep.js` is binary to git** (both debrief
  interviews independently found it): the `identityKey` helper embeds
  three LITERAL NUL bytes, so diff/blame/PR review collapse the flight's
  newest 11.4KB engine to "Binary files differ". Functionally harmless;
  process cost real (it silently degraded the flight-end review's diff
  visibility). **Action item (HAT fix rider): switch to a printable
  delimiter (e.g. `␟`) or `\0`-escape + `.gitattributes` text
  forcing; add the "literal NULs make files binary to git" note to house
  docs.**
- **`jar-ipc.test.js` is now the slowest suite** (906ms, +39% — passed
  automation-mcp-server): F1's named conversion candidate wasn't
  converted while this flight added ~37 real-file-pattern tests to it.
  The recommendation stands, now twice-earned.
- The IndexedDB-dirname scrape is a named fragility with one live bite
  already; give it DD1-style standing-tax treatment (re-verify the
  dirname format on every Electron major bump).
- `cookie_seen` growth is bounded by design (four destructive-path
  cleanups + cause routing); the offline-expiry orphan self-heal is
  reasoned-but-not-observed — HAT eye on a long-lived profile.

### Documentation

- CLAUDE.md's new sections verified accurate (one attribution fixed at
  flight-end review); behavior spec's amended step 6 now carries the
  cold-start semantics explicitly.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD4b storage-aging ruled at leg 3 as a desk ruling | Both empirical components independently measured; semantic is policy | Yes, with the record discipline it followed |
| Behavior spec step 6 reworked twice (fixture-freshness self-catch, then cold-start amendment at the gate) | Premise gaps | The premise-audit rule above |
| Executor SIGTERM recovery mid-run | Key destroyed by own redaction; bridge unreachable | The private-launch-log convention |
| `snapshotAgedOutOrigins` exposed as a third engine function | Callers must enforce SEQUENCING explicitly | Yes — invariants belong in signatures |
| Behavior gate accepted at partial 6/7 | Failing clause structurally unobservable first-run | The documented disposition path worked |

## Key Learnings

- **Cold-start is a whole-population property, not a fixture property.**
- A NUL byte in source is invisible in editors and fatal to diff tooling.
- Two mechanisms consuming one aging signal need an explicit ordering
  constraint at design time (snapshot-before-prune).
- The activation-hooks generalization removed a hardcoded special case —
  the next panel is a drop-in.

## Recommendations

1. **[Important — HAT riders]** Fix the NUL-delimiter/binary-diff issue;
   witness live cookie-removal-by-age (day-aged bookkeeping,
   cross-session); verify offline-expiry orphan self-heal and the
   site-data mechanism against the operator's real profile; operator
   read of the two-tier badge UX and known-gap note.
2. **[Important — mission debrief]** Promote the key-handling structural
   fix (private launch log, redacted derivative, keys as function args
   only) to standing methodology text — three incidents, one class.
3. **[Important]** Convert `jar-ipc.test.js` to a shared/`:memory:`
   app-db harness (keep real files only where WAL/quarantine is the
   assertion) — twice-earned.
4. **[Minor]** Add the DD-checklist item: shared-aging-signal mechanisms
   get an explicit ordering constraint.
5. **[Minor]** Record F1's fixture recommendation as confirmed-effective
   (+99 tests / ~flat wall where applied).

## Action Items

- [ ] HAT flight: NUL-delimiter fix rider; cookie-removal witness;
      orphan self-heal + real-profile site-data check; badge UX read;
      plus the mission Known Issues carries (PR promotions/merges, key
      rotation).
- [ ] Mission debrief: key-handling methodology promotion; suite-timing
      trajectory; the premise-audit rule.

## Test Suite Metrics (this debrief's run)

2116 pass / 0 fail / 0 skipped, wall ~1.94s, no flakes (single run).
vs F1 (2017, ~1.92s): +99 tests, ~flat wall (runner parallelism).
Own-time tail: jar-ipc 906ms (NEW slowest, +39%), automation-mcp-server
894ms (flat), downloads-store 559ms, jars 521ms, settings-store 505ms,
history-store 483ms (+18%), app-db 272ms (+109% — the ladder tests'
legitimate real-file cost), retention-sweep 43ms + jar-data-helpers 42ms
(new, pure fakes — the recommendation working). Persistence-family
own-time ≈3.5-3.7s sequential.
