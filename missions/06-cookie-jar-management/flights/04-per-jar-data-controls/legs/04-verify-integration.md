# Leg: verify-integration

**Status**: completed
**Flight**: [Per-Jar Data Controls](../flight.md)

## Objective

Prove the flight's machine-verifiable acceptance against the COMMITTED baseline
(`13c6329`): first run of the `jar-data-controls` behavior spec (7 steps — class
independence, cross-jar containment, wipe auto-reload, rejection matrix, burner
cookie cross-check), a `jar-delete-closes-tabs` re-run as relayout regression
insurance, and the full unit/typecheck/lint gates (CP4).

## Context

- Flight DD9 (verification split): these specs cover everything store/session/
  broadcast-visible; page DOM is HAT-owned (leg 5).
- The F3 two-commit shape: legs 1-3 are committed (`13c6329`); this leg runs
  against that baseline so the behavior evidence describes committed code. Any
  fix this leg forces lands as a NEW commit (no amend).
- Behavior-test protocol (established this mission, per-run staging ruling):
  each run gets its OWN fresh scratch profile + launch, torn down after; no
  instance/port/key crosses agent boundaries; key values never written into any
  committed artifact or evidence file; evidence lives under
  `/tmp/behavior-tests/goldfinch/<slug>/<ts>/` (never committed); run logs are
  committed at `tests/behavior/<slug>/runs/<ts>.md`.
- Apparatus facts (four consecutive stages on record): launch
  `XDG_CONFIG_HOME=<scratch> GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`;
  admin key is a ONE-TIME stdout print; configured port 49707 free-falls to
  49709 on this rig — discover it; curl Streamable HTTP JSON-RPC (initialize
  with Bearer → capture mcp-session-id → notifications/initialized →
  tools/call); evaluate rejects top-level await (return Promises); results are
  double-JSON-encoded; teardown = kill the Electron MAIN pid directly (npm
  never cascades signals), verify the port died.

## Inputs

- Committed baseline `13c6329` on `flight/04-per-jar-data-controls`; clean tree.
- `tests/behavior/jar-data-controls.md` (status `draft` — flips to `active` on
  first pass), `tests/behavior/jar-delete-closes-tabs.md` (status `active`).
- Crew prompts: `.flightops/agent-crews/behavior-tests-execution.md`.

## Outputs

- `tests/behavior/jar-data-controls/runs/<ts>.md` (committed) + spec header
  updated (`draft` → `active`, Last Run stamped) if it passes
- `tests/behavior/jar-delete-closes-tabs/runs/<ts>.md` (committed) + Last Run
  stamped
- Flight log: leg entry with run-log references and gate results
- A scoped commit of this leg's artifacts (run logs, spec header bumps, leg +
  flight-log updates)

## Acceptance Criteria

- [x] `/behavior-test jar-data-controls` executed per the behavior-test skill
      (Orchestrator = Flight Director; two live agents, Witnessed pattern; fresh
      stage) — ALL 7 checkpoints PASS. On pass, spec `draft` → `active`.
- [x] `/behavior-test jar-delete-closes-tabs` executed on its OWN fresh stage —
      all 5 checkpoints PASS (proves the relayout broke nothing the standing
      net pins; its steps act via IPC, not page DOM, so a pass is meaningful
      regression evidence).
- [x] `npm test` + typecheck + lint green on the committed baseline.
- [x] Both run logs committed; no key material or operator-identity strings in
      any committed artifact (grep before commit).
- [x] Any failure → investigate, fix in a NEW commit, re-run the failed spec on
      a fresh stage (the leg does not land on a failing checkpoint unless the
      operator accepts it as a known issue — not anticipated).

## Verification Steps

- The two run logs' Summary lines (7/7, 5/5) + committed paths.
- `git log --oneline` shows the scoped leg-4 commit (and any fix commits).
- Suite/gate output captured in the flight-log entry.

## Implementation Guidance

1. Gates first (cheap): suite, typecheck, lint on the committed tree.
2. Run `jar-data-controls` first (the new net — highest information). Stage,
   run the checkpoint loop (Executor + Validator per crew file, live
   continuation if SendMessage is available, else re-spawn per checkpoint),
   teardown, write the run log.
3. Then `jar-delete-closes-tabs` on a SECOND fresh stage (never reuse the
   first — its steps assume the seed registry).
4. Spec-header updates (status/Last Run), flight-log entry, scoped commit.

## Edge Cases

- **Step-5 reload timing**: the `jar-wiped` sweep fires tabNavigate reloads;
  the spec's ~1-2s settle should suffice (the F3 delete-closure precedent showed
  post-broadcast enumeration already consistent on first read). If the marker
  probe races the reload, settle-then-recapture once before judging (the
  institutionalized pattern from the jar-delete Validator's carry-forwards).
- **Step-3 post-clear cookie read (design-review suggestion)**: the same
  settle-then-recapture allowance applies to the `document.cookie` re-read after
  a granular clear — it rests on the same live-read-against-just-mutated-store
  platform assumption. One recapture before judging, never a spec change.
- **Cookie set on a public fixture URL**: JS-set first-party cookies on
  example.com work; if the fixture rejects cookie writes, switch fixture — the
  URL is immaterial to the assertions.
- **Port fallback**: expect 49709; discover, don't assume.

## Citation Audit

Procedural leg — citations are to specs/protocol rather than source:
`tests/behavior/jar-data-controls.md` (7 steps, drafted + Architect-reviewed at
flight design), `tests/behavior/jar-delete-closes-tabs.md` (active, 5 steps),
`.flightops/agent-crews/behavior-tests-execution.md` (crew prompts present —
validated at F3 leg 5). Apparatus facts carried from the F3 flight log and run
logs (port fallback ×4, teardown behavior, curl protocol). Committed baseline
`13c6329` verified via git log. All OK.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Run logs committed; spec headers updated
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (scoped commit includes it)
