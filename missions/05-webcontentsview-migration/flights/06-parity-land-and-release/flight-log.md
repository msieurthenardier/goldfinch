# Flight Log: Parity Sweep, Mission Landing & v0.6.0 Release

**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](flight.md)

## Summary
Planning. F6 is the mission-landing + release flight: SC3 browsing/tab/chrome corpus on the native surface,
the F5 debrief carry-forwards + the parked `<webview>` sweep, macOS build-readiness, merge `mission/05` → `main`,
and a real v0.6.0 GitHub release with all installers.

---

## Reconnaissance Report

Source: the **Flight-5 debrief** action items + the **mission** SC/roadmap, walked against current code (2026-07-08).

| Item (source) | Classification | Evidence / recommendation |
|---|---|---|
| SC3 browsing/tab/chrome corpus on new surface | `confirmed-live` | 8 specs (core-browsing-shields, unified-tab-controls, responsive-tab-strip, tab-keyboard-operability, settings-shell/controls/activity-viewer, toolbar-pins); prior run logs are pre-migration → re-run on the native surface. **Leg 1.** |
| `nav.js` internal-guard asymmetry (F5 debrief) | `confirmed-live` | `nav.js` lacks the op-local `isInternalContents` guard `zoom`/`find`/`print`/`observe` carry (`resolve.js:104` honors admin `allowInternal`). Add the guard. **Leg 2 (DD6).** |
| Doc reconciliations: page-context Escape target; mcp-drive Preconditions (F5 debrief) | `confirmed-live` | CLAUDE.md page-context prose says "address bar" vs spec `#kebab`; `mcp-drive-end-to-end.md` Preconditions frame the run jar-only. **Leg 2.** |
| `<webview>`→WebContentsView terminology sweep (mission Known Issue) | `confirmed-live` | ~15 specs' prose + `src/preload/webview-preload.js:1-5` header + residual source comments. Prose/comments only; zero functional dependency. **Leg 2 (DD5).** |
| DD9 mint-gate OFF-branch never positively witnessed (F5 debrief) | `confirmed-live` | Dev profile was `automationEnabled:true` in F5; witness the persisted-false ⇒ mint-DISABLED branch. **Leg 1 (apparatus-gated).** |
| Keyboard-bridge macOS HAT + WSLg-authoritative items (CDP-conflict, find count, focus-ring/squiggle, F10 key) | `needs-human-recheck` | No in-loop mac venue (DD2). **Deferred** — post-release/contributor follow-ups + carried to the mission debrief; NOT F6 gates. |
| Live two-agent Witnessed re-run of the 2 BLOCKING security specs (F5 debrief) | `needs-human-recheck` | Belt-and-suspenders; no defect suspected (Leg-3 offline validation + source cross-check stand). **Optional** — carry to mission debrief, not an F6 gate. |
| Retire the "947 baseline" convention (F5 debrief) | `already-satisfied` (methodology) | Not F6 code work; captured in the F5 debrief for future out-of-order flights. |
| Release infra | `confirmed-live` | electron-builder `^26.x` → GitHub Releases; `build.yml` tag-driven (`v*`) with `workflow_dispatch` build-only smoke; `GITHUB_TOKEN` only; version 0.5.7. **Legs 3/4/6.** |

**Decisions confirmed with operator (2026-07-08):** macOS = build-readiness only; cut a real v0.6.0 release; land
the `<webview>` sweep. See flight.md DD1–DD9.

---

## Flight Director Notes

_(execution notes recorded here)_

## Leg Progress

_(none yet — planning)_

## Decisions

_(runtime decisions recorded here)_

## Deviations

_(none yet)_

## Anomalies

_(none yet)_

## Session Notes

- **2026-07-08** — F6 planned via `/flight` after F5 completed. Reconnaissance above. Three planning decisions
  locked with the operator (macOS build-readiness only; real v0.6.0 release; land the `<webview>` sweep).
- **2026-07-08 — Architect design review (Phase 5b): approve-with-changes.** All codebase claims verified
  (release path `build.yml`, nav.js asymmetry, SC3 corpus, `<webview>` prose-only, clean FF merge). Fixes
  incorporated: (1) **[HIGH]** DD6 — the existing `automation-nav` unit tests give false coverage (assert
  internal refusal *without* `allowInternal`, so they miss the admin path); scoped the guard to all 4 nav ops and
  made "unit tests assert refusal with `allowInternal:true`" a Leg-2 acceptance criterion. (2) **[MED]** SC1
  defined as absence of the *functional* forms + a whitelist (preload filename, `#webviews` id, historical
  comments) — DD10. (3) **[MED]** unsigned/un-notarized mac installer → release notes must disclose + give open
  instructions — DD11. (4) **[MED]** `build.yml` `update-readme` auto-commits to `main` on a stable publish →
  noted in `cut-release`. (5) **[LOW]** pre-tag version==tag check; confirm `asar:false`+`files:src/**` deliberate.
  Two operator-facing decisions surfaced: ship unsigned mac publicly (with disclosure) vs withhold; and confirm
  the `update-readme` auto-commit is desired on the cut.
