# Squawk 0014: Behavior-test crew file lacks the apparatus facts from the Mission 16 Flight 3 runs (batch 2)

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-26
**Completed**: —

## Report

Squawk 0012 (PR #169) folded the Flight 2 runs' facts into `.flightops/agent-crews/behavior-tests-execution.md`'s Project Apparatus Notes. Flight 3's seven Witnessed runs (2026-08-25/26) rediscovered more, each briefed per spawn because the crew file did not carry them. Same shape as 0008/0012 — extend the notes, do not restructure.

Facts to add:
- The welcome blocks hide by a `hidden` **CSS class** — the `.hidden` IDL property is a false signal; read `className` / `getComputedStyle().display` / rect, and gate inner-block reads on `#welcome-surface`'s own display.
- The bookmarks bar is app-wide: it renders on every web-class or welcome tab (not on internal guests) and shows the same items in every window — one Executor misread it as a stale title strip.
- Burner tabs carry a `.tab-jar` swatch (`title="Burner (burner)"`, `#ff8c42`) in the strip element.
- Bookmark items are `button.bm-item` inside `#bookmarks-bar`; the chrome star is `#star`.
- `evaluate` on an internal guest (Settings) is refused ("internal-session excluded") — screenshot + a11y only.
- Re-activate a viewless welcome tab by clicking its strip rect (`.tab` by title); there is no wcId to `activateTab`.
- `enumerateWindows` gains a transient `sheetWcId` field (`sheetVisible: false`) after a dismissed sheet or an external-engine navigation — not an error.
- `pressKey` accepts `Enter`, not `Return`; `scroll` takes `dx`/`dy`.
- The stored `homePage` is as typed (no trailing slash) while navigation normalizes to `…/` — do not diff literally.
- The Settings "Show bookmarks bar" toggle is below the fold at 1080 px.
- Send `[CLOSING]` immediately after the Executor's last report — three transcript losses so far, all after the final step.

## Evidence

- `tests/behavior/*/runs/2026-08-25-20-*.md` and `2026-08-26-*.md` — Orchestrator Notes and closing summaries.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion — a fresh crew briefed from the crew file alone needs none of the above added by hand)*

## Sign-Off

*(written at completion)*
