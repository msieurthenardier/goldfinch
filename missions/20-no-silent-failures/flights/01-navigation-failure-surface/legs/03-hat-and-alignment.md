# Leg: hat-and-alignment

**Status**: ready
**Flight**: [The Failure Surface and Navigation Errors](../flight.md)

## Objective

The operator walks the failure surface on the live app, one step at a time,
and every look-and-feel issue found is fixed inline before the flight lands.

## Context

- Interactive leg (operator-elected at flight planning). No autonomous
  Developer/Reviewer cycle: the Flight Director presents one step, the
  operator performs it and reports, and the FD fixes issues inline —
  spawning a Developer only when a code change is needed.
- **Fix-vs-feature gate** (`/mission-control:agentic-workflow`): a request
  that adds behavior is promoted to a scoped design review before code;
  look-and-feel fixes ride the inline protocol. **Multi-surface trigger**: a
  "cosmetic" fix that touches more than the panel (strip, main wiring,
  another page) gets a lightweight Developer design-review pass first.
- **Frozen contract** (DD10): the ids `#load-failure-surface`,
  `#load-failure-heading`, `#load-failure-url`, `#load-failure-code`,
  `#load-failure-body`, `#load-failure-retry`, the `.hidden` toggles, and
  `.tab[data-load-state]` / `.tab-status` are read by the behavior spec, the
  a11y audit, and the contract test. A HAT change to any of them is a spec
  re-author handled deliberately, not an inline fix.
- Precondition: legs 1 and 2 completed and committed (`flight/01`), the
  Witnessed run of `navigation-failure-surface` passed (9/9, 2026-09-15),
  `npm run a11y` green apart from squawk 0074's pre-existing finding.
- **H7 carries the Validator's retroactive-fail condition**: a visible focus
  ring on Retry after a typed failed navigation + Tab — unobservable under
  automation, so the operator's eye is the record.

## Inputs

- The flight branch with legs 1–2 committed (the flight-end review passed).
- Live rig: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
  npm run dev:automation` (WSLg), operator at the window.
- Fixtures: a bind-probed free port `{P}` with nothing listening on the
  refusing loopback host `{L}` (`127.0.0.2` here); the keyboard-nav static
  pages via `python3 -u -m http.server {P} --bind {L} --directory
  tests/behavior/fixtures/keyboard-nav` when the retry step needs a server;
  the throwaway-CA TLS fixture on `{T}`
  (`node tests/behavior/fixtures/web-compat/serve-tls.mjs --port {T}`).

## Outputs

- Flight log HAT entry: each step's operator verdict, every fix made (with
  its classification: fix / feature-promoted / contract re-author), and any
  deferred item logged as a squawk id.
- Any inline fixes committed with the flight (see Post-Completion).

## Acceptance Criteria

Each is an operator-performed step; the operator's verdict is the record.

- [ ] **H1 — Refused, in the foreground.** Type `http://{L}:{P}/` in
      the address bar, Enter (`{L}` = a loopback host that refuses —
      `127.0.0.2` on this rig; `127.0.0.1` never refuses under WSL2 mirrored
      networking, see the run log). Verdict on: the panel appears promptly; the
      copy reads right; the address and code lines are legible; the strip
      shows the glyph and host; focus is on the panel heading (screen
      reader users hear it) and NOT stranded.
- [ ] **H2 — DNS.** Navigate the same tab to
      `http://nonexistent-host-abc123xyz.invalid/`. Verdict on the
      re-render and the wording for a name failure.
- [ ] **H3 — Background failure.** Open a second tab, then from the first
      tab's context (or a bookmark/middle-click) cause the first tab to
      fail while the second is active. Verdict on: the inactive strip entry
      is identifiable at a glance; nothing about the active tab changed.
- [ ] **H4 — Projection on activation.** Click the failed background tab.
      Verdict on: the panel is shown immediately, no flash of a blank or
      stale guest, the address bar shows the intended address.
- [ ] **H5 — Retry.** Start the fixture server on `{P}`, click Retry.
      Verdict on: the page loads, the panel disappears cleanly, the strip
      restores its favicon and title, Reload/Stop glyph behaves.
- [ ] **H6 — Certificate class.** Navigate to `https://127.0.0.1:{T}/`.
      Verdict on: the generic panel's certificate wording is honest for a
      surface that (until Flight 2) offers no override.
- [ ] **H7 — Keyboard-only.** From the address bar with a failed tab
      active: F6 lands on the panel heading; Tab reaches Retry; Enter on
      Retry retries; Shift+F6 returns to the chrome. Ctrl+F on a failed tab
      opens nothing dead.
- [ ] **H8 — Second window.** Move the failed tab to a new window (tab
      context menu → Move to new window). Verdict on: the new window shows
      the panel and strip state; the old window is clean.
- [ ] **H9 — Reopen.** Close the failed tab, Ctrl+Shift+T. Verdict on: it
      reopens at the intended address (and fails again, honestly).
- [ ] **H10 — Look and feel, window-wide.** With the panel showing: resize
      the window, open the media panel, toggle the bookmarks bar, open the
      kebab menu over it. Verdict on layout, palette against the chrome,
      and that nothing animates the guest slot.

## Verification Steps

Operator verdicts, one step at a time, recorded in the flight log. A failed
step is diagnosed and fixed inline, then re-verified before moving on.

## Implementation Guidance

1. Present H1; wait for the report; fix or proceed. Repeat through H10.
2. For each fix: classify out loud (fix / feature / contract), run the four
   gates, and if the fix touches the panel's contract ids, re-author the
   spec row it affects and re-run that row.
3. After H10: append the HAT entry, set this leg `completed`, then proceed
   to the flight's completion checklist.

## Edge Cases

- **Operator cannot reproduce a spec-passing step** (rig difference): record
  both observations; the Witnessed run log is the acceptance record, the
  HAT verdict is the alignment record.
- **A request for auto-retry on reconnect or a countdown**: feature —
  promote, do not build inline.

## Files Affected

- `missions/20-no-silent-failures/flights/01-navigation-failure-surface/flight-log.md`
- Whatever an inline fix touches (each named in the HAT entry).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
