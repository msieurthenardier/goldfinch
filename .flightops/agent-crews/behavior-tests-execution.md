# Behavior Tests Execution — Project Crew

Crew definitions and interaction protocol for running behavior tests. The
Orchestrator (Mission Control) coordinates this phase using the
`/behavior-test {slug}` skill. Specs are authored inline during planning
conversations (flight, leg, mission, debrief, maintenance) rather than via
a dedicated authoring skill — see `.claude/skills/behavior-test/AUTHORING.md`
on the mission-control side for the authoring guide.

The defining feature: **two persistent agents** stay alive across the entire
test via SendMessage continuation. The Orchestrator drives the step cursor;
the Executor performs each step's Actions when handed one; the Validator
judges each step's Expected Results when handed the Executor's raw state.

The two-role separation is the load-bearing discipline: if one agent both
acted and judged, it would tend to confabulate success. Independence forces
a colder verdict.

## Crew

### Executor
- **Context**: `{target-project}/` — loads the project's CLAUDE.md.
- **Model**: Sonnet (override per-project if needed).
- **Lifetime**: Spawned once at run start; alive across all steps via
  SendMessage continuation.
- **Role**: Performs the Actions for each step the Orchestrator sends.
  Reports raw observed state. Makes NO pass/fail judgments.
- **Tools**: All — including any registered browser MCPs (chrome-devtools,
  playwright), HTTP / shell / filesystem.
- **Per-step actions**: receive step → perform actions → save evidence →
  report structured state → await next step.

### Validator
- **Context**: `{target-project}/` — loads the project's CLAUDE.md.
- **Model**: Sonnet (default; **NEVER Opus** — mirrors the existing crew
  discipline from `leg-execution.md`). Validator needs judgment + reading
  comprehension, not raw reasoning power.
- **Lifetime**: Spawned once at run start; alive across all steps.
- **Role**: For each step the Orchestrator sends (with the Executor's raw
  state + the spec's Expected Results), renders PASS / FAIL / INCONCLUSIVE.
  May take its own fresh observations independently if the Executor's
  report is insufficient.
- **Tools**: All — same MCP envelope as Executor (so it can re-observe
  state without spawning a second Executor).
- **Per-step actions**: receive step report → judge → render verdict →
  await next step.

### Accessibility Validator (optional)
- **Context**: `{target-project}/`.
- **Model**: Sonnet.
- **Enabled**: false (project opts in by setting `Enabled: true`).
- **Role**: Same as Validator but reads each step's Expected Results
  through an accessibility lens — WCAG 2.1 AA, screen-reader
  compatibility, keyboard navigation, color contrast, ARIA usage,
  semantic HTML. Spawn only for tests with `[a11y]`-marked rows.
- **Per-step actions**: judge `[a11y]`-marked rows; pass through
  non-marked rows silently.

### Visual Validator (optional)
- **Context**: `{target-project}/`.
- **Model**: Sonnet.
- **Enabled**: false.
- **Role**: Screenshot-diff comparison against a baseline. Pin: baselines
  stay gitignored (user-global "test snapshots not committed" rule).
  Use sparingly — visual regression is fragile and high-noise.

## Separation Rules

- Executor and Validator load the project's CLAUDE.md and conventions
  independently. They are fresh agents per test run; no carryover.
- The Validator has **NO knowledge of the Executor's reasoning** — only
  the structured per-step report (raw state + evidence). The Executor MAY
  include freeform commentary in each per-step report, but the
  Orchestrator extracts only the structured subset (the report's
  `raw_state`, `evidence_paths`) to forward to the Validator.
- The Orchestrator coordinates state passing and writes the run log. It
  does NOT execute Actions or render verdicts. The Orchestrator's role is
  step-cursor management + operator-facing decision points.

**Note:** Handoff signals (`[READY]`, `[STEP:N:done]`, `[STEP:N:exception]`,
`[VERDICT:N:pass/fail/inconclusive]`, `[BLOCKED:reason]`, `[CLOSING]`) are
defined by the behavior-tests methodology in the skill, not in this file.
Do not modify signal names here — they must match what the Orchestrator
parses.

## Interaction Protocol

### Lifecycle

1. Orchestrator validates the spec + computes the run timestamp.
2. Orchestrator spawns **Executor** with the Executor: Initial prompt
   (full spec + role intro). Executor returns `[READY]` + its agent ID.
3. Orchestrator spawns **Validator** with the Validator: Initial prompt
   (full spec + role intro). Validator returns `[READY]` + its agent ID.
4. For each row N in the Steps table:
   1. Orchestrator `SendMessage`s Executor with Step N's Actions →
      Executor performs → returns `[STEP:N:done]` + structured report.
   2. Orchestrator extracts the structured subset; `SendMessage`s
      Validator with Step N's Expected Results + Executor's structured
      report → Validator judges → returns
      `[VERDICT:N:pass|fail|inconclusive]` + structured verdict.
   3. Orchestrator records the step result.
   4. If verdict is fail/inconclusive, Orchestrator may prompt the
      operator: continue / halt / rerun-step. Default: continue.
5. Orchestrator `SendMessage`s both agents `[CLOSING]` →
   both return their freeform closing summaries.
6. Orchestrator composes the run log + surfaces summary to operator.

### Actions-only rows

If row N has no Expected Results (pure setup), the Orchestrator skips
Step 4.2 above (no Validator call) and advances directly. The step's
record in the run log notes `verdict: skipped (setup row)`.

### Wait-point rows

If row N has no Actions (pure waitpoint), the Orchestrator skips Step
4.1 above (no Executor call) and goes directly to Validator with just
the Expected Results. The Validator polls or observes independently
until either the expected result is observed or a reasonable timeout
elapses (default: 30s; spec may override).

### Aborts

- `[BLOCKED:reason]` from either agent at any point → Orchestrator
  marks the run `aborted`, sends `[CLOSING]` to both agents, writes
  partial run log, surfaces to operator.
- Operator interrupts the step loop → same as `[BLOCKED]` flow.

### Re-runs

Each re-run gets fresh Executor + Validator agents. Old run logs are
kept; the operator prunes manually if desired. The spec is the source of
truth across runs — if the system changed but the spec didn't, the run
log reflects that.

### Specialized Validator concurrency

If the project opts in to Accessibility Validator + the spec has
`[a11y]`-marked rows, the Orchestrator spawns Accessibility Validator
alongside the base Validator at Phase 3. For each step, the Orchestrator
sends to BOTH validators in parallel; collects both verdicts; records
both in the run log. A step is PASS only if all spawned validators
verdict it PASS.

## Template Variables

The Orchestrator substitutes these in prompts at runtime:

| Variable | Description | Available In |
|----------|-------------|-------------|
| `{project-slug}` | Project identifier from projects.md | All prompts |
| `{test-slug}` | The behavior test being run | All prompts |
| `{spec-path}` | Path to the spec file | Initial prompts |
| `{spec-content}` | Verbatim spec markdown | Initial prompts |
| `{run-timestamp}` | The run's timestamp (UTC, YYYY-MM-DD-HH-MM-SS) | All prompts |
| `{evidence-dir}` | Absolute path to the evidence directory | Initial + per-step |
| `{cache-mode}` | Resolved cache mode (`cold` default; `warm` if spec opts in) | Executor: Initial |
| `{step-number}` | Current step index (1-based) | Per-step prompts |
| `{step-actions}` | The current step's Actions cell | Per-step Executor prompt |
| `{step-expected}` | The current step's Expected Results cell | Per-step Validator prompt |
| `{executor-step-report}` | The Executor's structured report (per-step) | Per-step Validator prompt |

## Project Apparatus Notes (goldfinch)

Facts rediscovered live across multiple runs (`bookmarks-jar-scoping`,
`search-engine-preference`, `search-engine-upgrade`, `welcome-home-first`,
`welcome-home-routing`, `welcome-first-launch`, `welcome-search-handoff`,
`new-tab-default-routing`) —
read before signalling `[READY]` so a crew spawn needs no hand-added apparatus
instructions beyond run-specific keys/ports.

- **Never use session-registered `mcp__goldfinch*` / `mcp__chrome-devtools*`
  tools.** The registrations on the dev machine carry statically pinned keys
  and at least one points at the operator's production browser. Drive the
  instance under test only through an attach-only client with the run's
  freshly minted key (`scripts/lib/mcp-client.mjs` pattern) — see
  `tests/behavior/bookmarks-jar-scoping/runs/2026-07-31-19-35-58.md`.
- **Reaching internal pages**: `openTab` creates untrusted tabs and
  `navigate` refuses `goldfinch://` by design; the sanctioned route is
  `evaluate` on the chrome wcId calling the `globalThis` dogfooding seam
  (`kebabActionSettings()`, `openJarsPage()`, …) — see
  `src/renderer/renderer.js`'s `Object.assign(globalThis, …)` block and
  `tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md`
  (Checkpoint 1 / Orchestrator Notes).
- **Sheets**: kebab and page-context menus are outside
  `AUTOMATABLE_MENU_TYPES` (`src/main/automation/resolve.js:53`), refused at
  every tier, and not composited by `captureWindow`; a tab switch dismisses a
  stuck sheet, a chrome-targeted Escape does not — see
  `tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md`
  (Checkpoint 6 / Orchestrator Notes). Allowlisted sheets (`bookmark-edit`,
  `bookmarks-overflow`) are **read-only** to automation, categorically:
  `click`/`typeText`/`pressKey`/`dragPointer`/`evaluate`/`injectScript` never
  opt into the sheet gate — only `captureScreenshot`/`readDom`/`readAxTree`
  pass `allowSheet: true` (`src/main/automation/engine.js`'s three
  `deps({ allowSheet: true })` call sites feeding `resolve.js`'s
  `admitted` check) — no write op ever resolves a sheet wcId, so a refused
  click/type against a sheet is not evidence that the underlying action (e.g.
  a bookmark) didn't happen — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-02-45-35.md`
  (Setup row / Orchestrator Notes).
- **Coordinates**: `click` on a tab wcId is guest-viewport-relative — read
  from `captureScreenshot {wcId}` (1:1), not from `captureWindow` (includes
  the chrome). `openTab` lands in the last-focused window — focus the
  intended window first — see
  `tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md`
  (Orchestrator Notes). Welcome-surface controls (radios, the Set button, the
  address bar) instead use chrome-relative coordinates — the same frame as
  `#address`, no guest-viewport translation; on the Settings page the search
  engine block's Clear button sits beneath the eighth radio and its position
  is layout-dependent — locate it by `getBoundingClientRect()`, not a fixed
  pixel — see
  `tests/behavior/welcome-search-handoff/runs/2026-08-25-04-48-18.md`
  (Orchestrator Notes / Executor closing).
- **Reads**: the address bar's committed URL is authoritative via `evaluate`
  of `#address.value` on the chrome wcId (a11y textbox nodes may expose no
  `value`); the Settings home-page textbox's a11y `value` is
  build/state-dependent — judge from rendered pixels — see
  `tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md`
  (Checkpoint 3 / Orchestrator Notes). DOM-count probes
  (`querySelectorAll(...).length`) do not reflect visibility — a hidden
  block's controls still count, and `#welcome-surface`'s `textContent`
  includes hidden blocks' text too; use hidden-class flags or an a11y-tree
  scan (e.g. grep the a11y dump for the absent control's name) as the
  reliable absence signal — see
  `tests/behavior/welcome-first-launch/runs/2026-08-25-04-22-08.md`
  (Checkpoint 4 / Orchestrator Notes). A freshly rendered welcome panel shows
  a keyboard-focus ring on its first radio (DuckDuckGo) — outline only,
  unchecked per a11y, not a selection — see
  `tests/behavior/welcome-search-handoff/runs/2026-08-25-04-48-18.md`
  (Orchestrator Notes / Executor closing). The welcome blocks hide by a
  `hidden` **CSS class** — the element's own `hidden` IDL property reads
  `false` even while it is hidden by class, a false signal on this build;
  read `className` / `getComputedStyle().display` / rect instead, and gate
  any inner-block read on `#welcome-surface`'s own display — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-20-38-40.md`
  (Checkpoint 3 / Validator notes) and
  `tests/behavior/welcome-home-routing/runs/2026-08-26-02-29-57.md`
  (Orchestrator Notes).
- **Out-of-band relaunch** (`session-restore` procedure, proven
  2026-08-24): the MCP transport dies with the process and
  `GOLDFINCH_AUTOMATION_DEV_MINT` mints a fresh key per boot — the
  Orchestrator relaunches, re-reads the mint line, rewrites the crew's env,
  and briefs the restored topology — see
  `tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md`
  (Checkpoint 8 / Orchestrator Notes). Give every restart-adjacent row an
  explicit Orchestrator PID attestation (the process holding the profile's
  `app.db`) by default, not only once a Validator asks for it — corroborate
  with the re-minted automation key hash and wcId renumbering as independent
  signals of a real relaunch, not tab-list lineage alone — see
  `tests/behavior/search-engine-preference/runs/2026-08-25-05-35-38.md`
  (Checkpoints 4/5/8, Orchestrator Notes). The Executor's closing summary is
  the one artifact transcript loss can drop — three occurrences in this
  project's runs so far, each after the Executor's final per-step report;
  send `[CLOSING]` to the Executor immediately after that report, before
  other wrap-up work, to minimize the window — see the same run's Closing
  Summaries section and, for the third occurrence,
  `tests/behavior/welcome-home-routing/runs/2026-08-26-02-29-57.md`
  (Orchestrator Notes: "Executor transcript loss (third occurrence in this
  project's runs)").
- **Welcome tabs**: a welcome tab (viewless record, no web contents) is
  invisible to `enumerateTabs`, and `enumerateWindows` reports
  `activeTabWcId: null` for it — the tab strip must be read from chrome DOM,
  not the tab-enumeration API — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-02-45-35.md`
  (Checkpoint 3 / Orchestrator Notes) and
  `tests/behavior/welcome-first-launch/runs/2026-08-25-04-22-08.md`
  (Checkpoint 4).
- **Bookmarks**: a chrome star click persists a bookmark immediately
  (`bookmarks-client.js`'s `activateStar` → `bridge.bookmarkAdd`) — the
  bookmark-edit sheet's Done only edits/closes the sheet. A refused
  click/type against the sheet is not evidence the bookmark wasn't created;
  confirm via the `bookmarks` table, not the sheet interaction — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-02-45-35.md`
  (Setup row / Orchestrator Notes).
- **Settings layout shift**: inserting a status line ("Saved"/"Cleared —
  …") after Save/Clear shifts the controls beneath it by roughly 20–24 px —
  re-capture the Settings guest before every click rather than reusing
  coordinates from an earlier capture — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-02-45-35.md`
  (Setup row) and
  `tests/behavior/new-tab-default-routing/runs/2026-08-25-05-04-03.md`
  (Orchestrator Notes / Executor closing).
- **`scroll`/`pressKey` arguments**: `scroll`'s own arguments are
  `wcId, x, y, dx, dy` (`src/main/automation/mcp-tools.js`'s `scroll` entry);
  the underlying CDP dispatch (`Input.dispatchMouseEvent` in
  `src/main/automation/input.js`) names the same values `deltaX`/`deltaY` —
  don't pass `deltaX`/`deltaY` as the call's own argument names — see
  `tests/behavior/welcome-first-launch/runs/2026-08-25-04-22-08.md`
  (Orchestrator Notes / Executor closing). `pressKey` accepts `Enter`, not
  `Return` (`unknown key`) — its vocabulary is
  `Tab, Enter, Escape, Space, Arrow*, Home, End, Delete, Backspace, ShiftTab`
  or a single character — see
  `tests/behavior/welcome-home-first/runs/2026-08-25-20-08-57.md`
  (Orchestrator Notes / Executor closing).
- **Cross-window/broadcast baselines**: setting a preference broadcasts
  live to every window — a welcome tab already shown in any window
  re-renders immediately with the newly saved value and its confirmation
  line, whether or not that window made the change. As of M16 F3 Leg 2's
  DD7 pivot (`src/renderer/chrome/welcome-controller.js`'s `settle`/
  `submitHome`, commit `46b3f5a`) this is re-render only — a shown welcome
  tab no longer auto-navigates on the broadcast; the surface's one
  remaining self-navigation is `settle`'s pending-search branch, which
  attaches only once a query is waiting and an engine resolves.
  (Historical, pre-pivot: a preference broadcast could instead auto-attach
  another window's already-shown pending welcome tab (DD7) between two
  steps, shifting that window's "before" baseline for a later row —
  retired at the pivot.) Call out a cross-window step that follows one
  that sets a preference — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-02-45-35.md`
  (Checkpoint 8 side finding / Orchestrator Notes),
  `tests/behavior/welcome-first-launch/runs/2026-08-25-04-22-08.md`
  (DD7 auto-attach scope observed / Orchestrator Notes), and
  `tests/behavior/welcome-home-routing/runs/2026-08-26-02-29-57.md`
  (Checkpoints 8-9 / Orchestrator Notes — retirement confirmed: re-render,
  no navigation).
- **Anti-automation interstitials**: Google's `/sorry/` interstitial can
  intercept a scripted search after repeated queries from one IP/session —
  judge the row on the committed address-bar URL (host `google.com` plus the
  encoded query, preserved in the tab title and in the interstitial's own
  `continue=` parameter), not on reaching a live results page; route
  scripted rows to a non-Google engine (DuckDuckGo, Brave) where the spec
  allows it — see
  `tests/behavior/search-engine-upgrade/runs/2026-08-25-03-16-36.md`
  (Checkpoint 3 / Orchestrator Notes) and
  `tests/behavior/search-engine-preference/runs/2026-08-25-05-35-38.md`
  (Checkpoint 2 / Orchestrator Notes).
- **Bookmarks bar**: renders app-wide — on every web-class or welcome tab,
  in every window, showing the same items — but suppressed on burner-jar
  tabs as well as internal guests (e.g. Settings); one Executor initially
  misread it as a stale title strip before recognizing it at a later step.
  Bookmark items are `button.bm-item` inside `#bookmarks-bar`; the chrome
  star toggle is `#star` — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-20-38-40.md`
  (Setup row and Checkpoint 4 / Orchestrator Notes) and
  `tests/behavior/welcome-home-routing/runs/2026-08-26-02-29-57.md`
  (Checkpoints 3 and 7 / Orchestrator Notes and Validator notes); burner
  suppression confirmed at Checkpoint 5 of both runs.
- **Burner tabs**: carry a `.tab-jar` swatch in the strip element
  (`title="Burner (burner)"`, colour `#ff8c42`) — the positive signal for
  identifying a burner tab, distinct from the green default-jar swatch,
  when titles alone would coincide — see
  `tests/behavior/welcome-home-routing/runs/2026-08-25-20-38-40.md`
  (Checkpoint 5 / Raw state) and
  `tests/behavior/welcome-home-routing/runs/2026-08-26-02-29-57.md`
  (Checkpoint 5).
- **`evaluate` on internal guests**: refused outright on an internal
  guest's own wcId (e.g. Settings) — "internal-session excluded" —
  screenshot + a11y are the only readable apparatus there; judge internal-
  guest DOM state from rendered pixels/a11y, never `evaluate` — see
  `tests/behavior/welcome-first-launch/runs/2026-08-25-20-20-29.md`
  (Orchestrator Notes).
- **Re-activating a viewless welcome tab**: has no wcId, so `activateTab`
  cannot target it — click its strip rect instead (`.tab` located by
  title) — see
  `tests/behavior/welcome-first-launch/runs/2026-08-25-20-20-29.md`
  (Orchestrator Notes / Executor closing) and
  `tests/behavior/welcome-home-routing/runs/2026-08-25-20-38-40.md`
  (Checkpoint 6 / Actions taken).
- **Transient `sheetWcId`**: `enumerateWindows` can gain a `sheetWcId`
  field (`sheetVisible: false`) after a dismissed sheet or an
  external-engine navigation — a resolved artifact never enumerated as a
  tab, not an error — see
  `tests/behavior/welcome-first-launch/runs/2026-08-25-20-20-29.md`
  (Checkpoint 5 / Validator notes) and
  `tests/behavior/welcome-home-routing/runs/2026-08-26-02-29-57.md`
  (Setup row).
- **Stored `homePage` value**: persisted exactly as typed (e.g.
  `https://example.com`, no trailing slash) while navigation normalizes
  the same value to `https://example.com/` — don't diff the settings-row
  value against the committed address literally — see
  `tests/behavior/welcome-first-launch/runs/2026-08-26-02-10-54.md`
  (Spec notes for the next revision / Orchestrator Notes).
- **Settings scroll position**: the "Show bookmarks bar" toggle sits below
  the fold at a 1080 px window height — scroll to it before clicking — see
  `tests/behavior/welcome-first-launch/runs/2026-08-26-02-10-54.md`
  (Closing Summaries / Executor closing).

## Prompts

### Executor: Initial

```
role: executor
phase: behavior-test-run
project: {project-slug}
test: {test-slug}
run: {run-timestamp}

You are the Executor for behavior test `{test-slug}` on project
`{project-slug}`. You will perform Actions step-by-step as the
Orchestrator sends them via SendMessage.

LIFECYCLE
- Now: scan registered MCPs by name pattern. Report which apparatus
  is available for each observable kind listed in the spec's
  Observables Required section. If any required observable has no
  matching apparatus, signal `[BLOCKED:no-apparatus-<observable>]`
  and stop.
- Cache mode is `{cache-mode}` (one of `cold` or `warm`). If `cold`,
  defeat apparatus cache before `[READY]` (see CACHE DEFEAT below).
  If `warm`, skip.
- Signal `[READY]` with the cache mode noted ("`[READY]` — cache-cold"
  or "`[READY]` — cache-warm"). Wait.
- PROJECT APPARATUS NOTES: read the `Project Apparatus Notes (goldfinch)`
  section of this crew file before signalling `[READY]` — in particular the
  prohibition on session-registered `mcp__goldfinch*` tools.
- Per step: I will SendMessage you with the step number and Actions.
  Perform them. Capture raw state. Save evidence files to
  {evidence-dir}. Return a structured report. Wait for the next step.
- At end: I will send `[CLOSING]`. Return your freeform closing
  summary and terminate.

CACHE DEFEAT (cold mode only)
Per apparatus, ensure no prior-run state bleeds into this run:
- Browser: fresh page context (`new_page` or equivalent); if Step 1's
  URL is in the spec, hard-reload with cache bypass (e.g.
  `ignoreCache=true`); else defer to Step 1.
- HTTP: fresh connection (no pooled streams from prior runs).
- Filesystem: do not inherit cwd from prior runs; cd explicitly at
  Step 1.

Rationale: stale apparatus state makes a run appear to exercise
post-change behavior while actually exercising pre-change cache.

THE FULL SPEC (for context — actions and expected results sections
both visible, so you can see what's coming and what the Validator will
check):

{spec-content}

PER-STEP REPORT FORMAT
After performing a step's Actions, return:

```json
{
  "step_number": <N>,
  "actions_taken": ["<verbatim summary per action>", ...],
  "raw_state": "<observed state after all actions; ≤2000 chars; cite
    DOM snapshot regions, API response bodies, file contents, command
    outputs as relevant>",
  "evidence_paths": ["<relative paths into {evidence-dir}>", ...],
  "executor_notes": "<optional operational notes; NOT pass/fail
    judgment>"
}
```

Then signal `[STEP:N:done]` (or `[STEP:N:exception]` with the
exception detail in `executor_notes`).

APPARATUS DISCOVERY
At session start, list the tool names available to you. Group by name
pattern, mapping each to the observable kind it can measure:
- `*chrome-devtools*` / `*playwright*` / `*browser*` → browser observables
- `*http*` (or Bash + curl) → http observables
- Bash → shell observables
- Read / Write / Bash → filesystem observables
Report to me ("`[READY]` — browser observables: chrome-devtools
available; shell observables: Bash; http observables: via Bash + curl;
filesystem observables: native"). I'll abort the run if any required
observable has no matching apparatus.

EVIDENCE
Save evidence files to {evidence-dir} with descriptive names per step:
- Browser snapshots: `step-N-snapshot.txt`
- Screenshots: `step-N-screenshot.png`
- API responses: `step-N-api-{endpoint-slug}.json`
- File captures: `step-N-{file-basename}`

YOU ARE NOT THE JUDGE
Do NOT decide pass/fail. Your job is to perform and report. The
Validator (a separate agent) will judge. If you have opinions about
correctness, put them in `executor_notes` — they are advisory only.

Signal `[READY]` now.
```

### Validator: Initial

```
role: validator
phase: behavior-test-run
project: {project-slug}
test: {test-slug}
run: {run-timestamp}

You are the Validator for behavior test `{test-slug}` on project
`{project-slug}`. You will judge Expected Results step-by-step as the
Orchestrator sends them via SendMessage.

LIFECYCLE
- Now: read the full spec for context. Identify any spec-level concerns
  (ambiguous Expected Results, missing observability, unsafe
  assumptions). Report them in your `[READY]` message.
- Then: signal `[READY]` and wait. Do NOT pre-judge upcoming steps.
- PROJECT APPARATUS NOTES: read the `Project Apparatus Notes (goldfinch)`
  section of this crew file before signalling `[READY]` — in particular the
  prohibition on session-registered `mcp__goldfinch*` tools.
- Per step: I will SendMessage you with (a) the step's Expected
  Results from the spec and (b) the Executor's structured report.
  Judge whether the Expected Results were met. Render PASS / FAIL /
  INCONCLUSIVE. Wait for the next step.
- At end: I will send `[CLOSING]`. Return your freeform closing
  summary and terminate.

THE FULL SPEC (for context — see both Actions and Expected Results
so you know what each step's setup is):

{spec-content}

PER-STEP VERDICT FORMAT
After judging a step, return:

```json
{
  "step_number": <N>,
  "verdict": "pass" | "fail" | "inconclusive",
  "reasoning": "<one-paragraph reasoning that cites either the
    Executor's raw_state or your own fresh observation>",
  "evidence_paths": ["<relative paths into {evidence-dir} that you
    cite>", ...],
  "validator_notes": "<optional: anomalies, downstream-effect
    concerns, spec-quality feedback>"
}
```

Then signal `[VERDICT:N:pass|fail|inconclusive]`.

JUDGMENT RULES
1. Read the Expected Results from the spec.
2. Read the Executor's raw_state.
3. If raw_state contains enough information to judge → render verdict
   directly.
4. If raw_state is insufficient → take your own fresh observation. You
   have the same MCP envelope as the Executor (browser snapshots, API
   calls, file reads, shell). Cite which fresh observation you took
   in `reasoning`.
5. Use INCONCLUSIVE only when the evidence is missing or contradictory
   — never as a polite "fail." Inconclusive means the TEST itself
   failed (spec gap, evidence loss), not the system.
6. Frame-aware judgment for `[mixed-frame]` rows: weight the
   observable in the same taxonomy as the row's Action. The
   cross-frame observable is supplementary, present only to
   distinguish internal states the user-facing observable collapses.
   A pass on the user-facing observable plus a fail on the
   supplementary observable is a real fail (system is behaving
   differently from the spec's distinguishing case); a fail on the
   user-facing observable is a fail regardless of the supplementary
   observable. Cite which observable carried the verdict in
   `reasoning`.
7. Rendered state over internal state. For browser-frame
   Expected Results, weight the screenshot and accessibility
   snapshot above any DOM eval the Executor included. An element
   that is DOM-queryable but visually missing (broken CSS,
   zero-sized chrome, hidden ancestor, off-viewport positioning)
   is a fail at the user-perceivable level even when the DOM
   agrees. Verdicts must reflect what a real observer would
   perceive, not what JavaScript can read. If you suspect a
   DOM-vs-rendered divergence, take your own fresh screenshot
   to verify before rendering verdict.

YOU ARE NOT THE EXECUTOR
Do NOT perform the Actions yourself. If the Executor reports it
couldn't perform a step, your verdict for that step is whatever the
Expected Results say should have been observed — usually `fail`
because the post-action state wasn't reached.

WHAT YOU DO NOT SEE
You do NOT see the Executor's freeform reasoning or chat history. Only
the structured per-step report. The Orchestrator filters out the
Executor's `executor_notes` field before forwarding to you (those notes
are advisory only and could bias your verdict).

Signal `[READY]` now, after reporting any spec-level concerns.
```

### Per-step prompt: Executor

```
Step {step-number} of {total-steps}.

Actions to perform:
{step-actions}

Perform the actions in order. Capture raw state after all actions
complete. Save evidence to {evidence-dir}. Return your structured
report and signal `[STEP:{step-number}:done]`.

If an action raises an exception, capture what state you got to,
return the report with the exception noted in `executor_notes`, and
signal `[STEP:{step-number}:exception]`.
```

### Per-step prompt: Validator

```
Step {step-number} of {total-steps}.

Expected Results:
{step-expected}

Executor's structured report:
{executor-step-report}

Render your verdict. If the Executor's `raw_state` is sufficient,
judge directly. Otherwise take a fresh observation. Return the
structured verdict and signal `[VERDICT:{step-number}:pass|fail|inconclusive]`.
```

### Closing prompt (both agents)

```
[CLOSING]

The test run is complete. Return your closing summary — anomalies you
noticed, environment hiccups (Executor), spec-quality observations or
patterns of failure (Validator). Freeform, ≤500 words. After this
message you may terminate.
```

### Accessibility Validator: Initial (when enabled)

```
role: accessibility-validator
phase: behavior-test-run
project: {project-slug}
test: {test-slug}
run: {run-timestamp}

Same protocol as the base Validator, but you judge ONLY rows of the
Steps table marked `[a11y]` in their Expected Results. For non-marked
rows, return:

```json
{
  "step_number": <N>,
  "verdict": "skipped",
  "reasoning": "Row is not [a11y]-marked; base Validator is the
    authority.",
  "evidence_paths": [],
  "validator_notes": ""
}
```

For [a11y]-marked rows, judge against:
1. WCAG 2.1 AA — do the observed UI states meet Level AA criteria?
2. Semantic HTML — heading hierarchy, landmark regions, form labels?
3. Keyboard navigation — all interactive elements reachable, focus
   visible?
4. Screen readers — ARIA attributes correct, live regions used
   appropriately?
5. Color and contrast — minimum 4.5:1 for text, 3:1 for large
   text/UI?

Add a `wcag_criterion` field to your verdict when failing, citing the
specific WCAG rule violated.

THE FULL SPEC:

{spec-content}

Signal `[READY]` now.
```
