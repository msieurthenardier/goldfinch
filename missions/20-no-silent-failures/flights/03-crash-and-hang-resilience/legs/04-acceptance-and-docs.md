# Leg: acceptance-and-docs

**Status**: planning
**Flight**: [Crash and Hang Resilience](../flight.md)

## Objective

Prove the flight on the live app — the Witnessed `crash-and-hang-surfaces`
run passes with OS-signal injection, `npm run a11y` exits 0 with the two
new chrome states audited — and leave the docs and the behavior spec in
their final, committed shape; this leg ships no product behaviour.

## Context

- Flight DDs binding this leg: **DD10** (apparatus: act by signal against
  the admin census `pid`/`chromePid`, observe via census, chrome a11y tree,
  `captureScreenshot(chromeWcId)`, the shell for `crash-log.jsonl` and the
  dump directory; settle-before-read), **DD12** (frozen contracts the spec
  reads), the flight's Verification section (`npm run a11y` with `crashed`
  and `hung`), and the **acceptance-gate-as-its-own-leg** ruling from the
  Flight 2 debrief.
- Two halves: (1) a Developer finalises the apparatus-side artifacts (the
  a11y script's two new states, the behavior spec's final wording from the
  spike facts, the docs completeness pass); (2) the Flight Director runs
  `/mission-control:behavior-test crash-and-hang-surfaces` and `npm run
  a11y` — a failing row is an unmet criterion: fix via a spawned Developer,
  re-run, or the operator rules it a known issue (recorded in the run log
  and the flight log).
- **Spike/leg facts the spec must encode**: SEGV → `crashed`/139, KILL →
  `killed`/9, `forcefullyCrashRenderer` → `crashed`/133 (never `killed`);
  `getOSProcessId()` → `0` → census `pid: null`; a `SIGSTOP`ped renderer
  shows the bar after ONE input event (long delay on this rig, poll up to
  40 s) and `CONT` clears it, but CANNOT service kill-and-reload — row 9
  uses the `busy.html` real hang; chrome `reload()` re-invokes
  `window-boot-config`; `crash-log.jsonl` lines carry exactly eight keys
  (`ts kind reason exitCode origin jarKind windowId recovery`); dumps land
  under the dev profile's Crashpad directory; `enumerateWindows` carries
  `chromePid` and `recoveryPaused`.
- **Rig facts**: as legs 1–3 (env-only key via a scratch file, never
  printed, never read the app log into a transcript, kill by port pid,
  `127.0.0.2` fixtures, shred the log at teardown). The behavior-test crew
  prompts (`.flightops/agent-crews/behavior-tests-execution.md`) carry the
  same rules — the Flight Director restates them in every Executor spawn.
- **Current code**: `scripts/a11y-audit.mjs` chrome-mode sequence — 5b
  downloads indicator via `showDownloadsIndicatorForAudit()` (`:427-434`),
  5c load-failure via `navigate('http://127.0.0.1:1/')` + `runAxe(...,
  'load-failure')` (`:436-444`), 5d cert-blocked behind `--tls-url=`
  (`:446-461`), then the skipped `SHEET_STATES` record. The seam hooks
  `showCrashPanelForAudit()` / `showHangNoticeForAudit()` exist (leg 2,
  `SEAM_COUNT` 41) and stamp synthetic records on the ACTIVE tab, persisting
  until that tab's next real push. `docs/dev-testing.md` "a11y audit"
  section lists the audited states (`:95-135`). The behavior spec
  `tests/behavior/crash-and-hang-surfaces.md` is `draft` (row 9 already
  re-authored for the busy-loop hang; row 12's pause observation is
  `booted: false` persisting; row 13's key set must be updated from "the
  allowed keys" to the eight names; exit codes are placeholders).

## Inputs

- Legs 1–3 landed on the branch (uncommitted), gates green.
- Fixtures: `tests/behavior/fixtures/crash/busy.html`,
  `tests/behavior/fixtures/keyboard-nav/{links,form}.html` (the two-entry
  history rows; `page2.html` does not exist — the spec already uses
  `form.html`).

## Outputs

- `scripts/a11y-audit.mjs`: 5e `crashed` — `evaluate` `showCrashPanelForAudit()`,
  sleep, `runAxe(..., 'crashed')`; 5f `hung` — `showHangNoticeForAudit()`,
  sleep, `runAxe(..., 'hung')`; both placed AFTER 5d (the active tab is the
  failed one from 5c, which is fine — the hooks stamp synthetic state on it)
  and BEFORE the sheet record; `docs/dev-testing.md`'s state list gains
  both; `ACCEPTED` unchanged unless a genuinely new finding is a
  pre-existing pattern (then justify in the flight log — never allowlist a
  new defect).
- `tests/behavior/crash-and-hang-surfaces.md`: status `active`; exit codes
  and reasons filled from the spike table; row 13 names the eight keys and
  asserts `origin` has no path; row 12 says "observed as `booted: false`
  persisting AND `recoveryPaused: true`"; row 0 records the dump directory
  as `<dev profile>/Crashpad` (probe `pending` vs `completed`); the
  fixture port `{B}` for `busy.html`; `**Last Run**` filled by the run.
- Docs completeness: README's automation table mentions the completed
  `loadState` enum if it lists the field; `docs/mcp-automation.md` already
  updated by legs 2–3 — verify `enumerateWindows`'s `chromePid`/`recoveryPaused`
  and `enumerateTabs`'s admin `pid` are both present; CLAUDE.md's new
  pattern section (leg 3) cross-checked against what shipped.
- The run log `tests/behavior/crash-and-hang-surfaces/runs/<ts>.md`
  (committed; evidence stays under `/tmp/behavior-tests/…`).
- Flight log: leg entry with the run summary (pass count, any fix pass,
  any operator ruling), the a11y result, and CP4.

## Acceptance Criteria

- [ ] AC1 `scripts/a11y-audit.mjs` audits `crashed` and `hung` chrome
      states via the two seam hooks; `docs/dev-testing.md` lists them.
- [ ] AC2 The behavior spec is `active` with every placeholder resolved
      (no `<exitCode>`, no "the allowed keys"); each row's Expected Result
      is observable through the listed apparatus.
- [ ] AC3 `/mission-control:behavior-test crash-and-hang-surfaces` → verdict
      `pass` (every checkpoint PASS), or every non-PASS row carries an
      operator ruling recorded in the run log AND the flight log.
- [ ] AC4 `npm run a11y` exits 0 against the running app with the two new
      states (the `crashed`/`hung` labels appear in its output).
- [ ] AC5 Docs cross-check complete (README, `docs/mcp-automation.md`,
      `docs/dev-testing.md`, CLAUDE.md) — any gap fixed in this leg.
- [ ] AC6 `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check` exit 0; `renderer.js` untouched (budget 1577
      is exact); no key/pid/path in any committed artifact; the app log
      shredded at teardown.

## Verification Steps

- AC1/AC4: `GOLDFINCH_MCP_ADMIN_KEY=$(cat <file>) npm run a11y` (the
  `docs/dev-testing.md` recipe) — exit code and the state labels in the
  output.
- AC2: read the spec; grep for `<exitCode>` and "allowed keys" → none.
- AC3: the run log's Summary line.
- AC5: by reading.
- AC6: the four scripts; `git diff --stat -- src/renderer/renderer.js` empty.

## Implementation Guidance

1. **Developer half**: the a11y script states + docs list; the spec's
   final wording (keep the row numbering — the runs directory and the
   flight log cite rows); the docs cross-check. Run `npm run a11y` on the
   rig once to prove AC1/AC4 before handoff (report exit code and labels,
   never the key); shred the log. Land the half: flight-log entry, leg
   stays `in-flight` (the Flight Director lands it after the run).
2. **Flight Director half**: `/mission-control:behavior-test
   crash-and-hang-surfaces` (live mode if `SendMessage` is available, else
   re-spawn per checkpoint — long waits (rows 6, 12) are Orchestrator-side
   real time, not agent sleeps); fix-and-continue on a defect per the
   Flight 2 cadence the operator endorsed; record the run; leg `landed`;
   CP4; `flight.md` checkbox.

## Edge Cases

- **Row 12's fourth crash lands outside the 60 s window** because the
  three prior recoveries took too long on the rig: the run must issue the
  four SEGVs with `booted: true` polling at 500 ms and no other work
  between them; if the window still elapses, the Validator marks
  INCONCLUSIVE and the Orchestrator re-runs the row once with tighter
  pacing before any ruling.
- **The hang row's 40 s poll expires** (rig delay): re-issue one more
  `click` and poll 20 s more before FAIL — the leg-1 spike measured ~18–19 s.
- **a11y finds a new violation on the bar or the Reload button**: a real
  defect → fix via Developer (button name, `role="status"` text), never an
  `ACCEPTED` entry.

## Files Affected

- `scripts/a11y-audit.mjs`, `docs/dev-testing.md`
- `tests/behavior/crash-and-hang-surfaces.md`,
  `tests/behavior/crash-and-hang-surfaces/runs/<ts>.md` (new)
- `README.md`, `docs/mcp-automation.md`, `CLAUDE.md` (cross-check only)
- flight log, `flight.md`, this leg

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry (run summary + a11y)
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] Commit rides the flight-end review (Flight Director)
