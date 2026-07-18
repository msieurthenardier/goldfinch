# Leg: spikes-and-rulings

**Status**: completed
**Flight**: [Jar Data Surfaces + Generalized Retention](../flight.md)

## Objective

Run Spike A (retention mechanism + bookkeeping storage shape) and Spike B
(site-data origin enumeration + usage write-off) against the live rig,
producing measured GO/NO-GO verdicts and mechanism rulings recorded in the
flight log — no shipped code.

## Context

- Flight DD1 governs the structure; DD3/DD4 carry the ranked candidates and
  decision criteria — read them as the probe plan. DD7 is the metadata
  boundary any recommended bookkeeping must satisfy.
- M09's spike discipline applies: **a read-back is not a second reading
  unless it is a second instrument** — where a probe's conclusion rests on
  a coordinate/state claim, verify through an independent surface (e.g.
  session API result vs on-disk state vs page-observed behavior).
- Apparatus facts (F1 run, inherited): launch via
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run
  dev:automation`; admin one-shot client via `scripts/lib/mcp-client.mjs`
  (`connectAutomation({key})` + `parseDevMintLine()` — key as function
  argument ONLY, never argv/env/disk/stdout); internal pages via chrome
  globals; profile backup/restore mandatory if the dev profile is mutated.
- Probe scripts live in the session scratchpad or /tmp — NEVER in the repo
  tree; findings live in the flight log.

## Inputs

- Flight branch `flight/02-jar-data-surfaces-and-retention` (stacked on
  F1); suite 2017 green; live rig launchable.

## Outputs

- Flight log: a `Spike A verdict` and `Spike B verdict` entry (Decisions
  section), each with: mechanism ruling, measured evidence (probe outputs
  summarized, second-instrument confirmations), storage-shape ruling
  (Spike A), usage disposition (Spike B), and the aging semantic that will
  ship (Spike A: creation-age vs last-activity-age).
- DD3/DD4 back-annotated in flight.md with the verdicts (a short
  `**VERDICT**:` line each — the flight is in-flight; the log carries the
  full record).
- No changes to src/, test/, package files.

## Acceptance Criteria

- [x] Spike A verdict recorded: mechanism (candidate 1 / 2 / composite /
      NO-GO), aging semantic named, storage-shape ruling (new v2 table vs
      history-derived vs none) with the DD7 boundary check, sweep-trigger
      seam for the behavior test named, and the `session-created` anchor +
      `removed:true` + will-quit quiesce concerns from DD4's review
      annotations addressed with measured or code-cited answers.
- [x] Spike B verdict recorded: listing mechanism (candidates probed in
      order, CDP hard time-boxed ≤ 20 min of rig time), usage disposition
      (expected NO — confirmed or refuted), honest-labeling ruling for the
      UI.
- [x] Both verdicts carry evidence, not assertion: each load-bearing claim
      probed live or cited to code/types; second-instrument rule applied
      where state is read back.
- [x] Fixture-mechanism ruling for the behavior spec (page-driven
      document.cookie vs `ses.cookies.set` via admin probe) — measured.
- [x] Working tree clean of non-artifact changes; suite untouched (2017).

## Verification Steps

- `git status` — only flight-log/flight.md/leg artifact changes. **Verified
  2026-07-17**: `git status --porcelain` shows only the flight/leg artifact
  directory and the pre-existing behavior-spec draft (both untracked from
  flight/leg design, no source files touched).
- Flight log Decisions section contains both verdict entries with evidence.
  **Verified** — see flight-log.md Decisions.
- DD3/DD4 carry `**VERDICT**:` annotations. **Verified** — see flight.md.
- `timeout 120 npm test` — **2017 pass, 0 fail** (2026-07-17 run, post-spike).

## Implementation Guidance

1. **Rig session**: launch once, keep the instance for both spikes; backup
   the dev profile first if any probe mutates it (cookie-setting probes
   do); restore at the end.
2. **Spike A probes** (candidate order per DD4): (a) confirm
   `cookies.on('changed')` fires on a persist-jar session for page-set and
   `ses.cookies.set` cookies, with `removed:true` on expiry/deletion —
   measure event payload shape; (b) confirm the `session-created` anchor
   sees jar sessions on first use (and NOT before); (c) probe
   `ses.cookies.remove(url, name)` semantics for host-only vs domain
   cookies (URL reconstruction — DD2's conditional dot-strip); (d) rule
   the storage shape against measured cardinality (how many cookies does a
   modestly-used jar hold?); (e) name the sweep-trigger seam
   (retention-edit immediate sweep per DD6) and verify it's observable
   without a test-only hook.
3. **Spike B probes** (candidate order per DD3, CDP time-boxed): (a) CDP:
   can a debugger attach reach Storage domain without a live jar tab —
   expect NO, measure quickly, move on; (b) `ses.getStoragePath()` — what
   does the on-disk layout actually contain per origin on this Electron
   (probe with seeded localStorage/IndexedDB in a jar); is a read-only
   defensive scrape viable? (c) history-derived origins — join feasibility
   against `history.db` per jar (the read path exists in
   history-store/history-ipc). Rule the mechanism (possibly composite)
   and the UI labeling.
4. **Anti-goal**: do NOT build the feature. Probes are throwaway; the
   deliverable is the verdicts.

## Edge Cases

- **Rig unavailable mid-spike** — record what was measured, mark the
  remainder honestly, re-tier the affected legs' design (no
  claimed-but-unmeasured verdicts).
- **Candidate ties** — the DD4 decision criteria order the tiebreak;
  simplicity wins at equal correctness.

## Files Affected

- flight-log.md, flight.md (annotations), this leg artifact — nothing else.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Working tree clean of code changes; suite untouched (2017 pass)
- [x] Update flight-log.md with the verdict entries
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-end review/commit model) — not committed

## Citation Audit

No new code citations beyond flight DDs (reviewed at flight design against
the live tree); apparatus facts cited from the F1 run log.
