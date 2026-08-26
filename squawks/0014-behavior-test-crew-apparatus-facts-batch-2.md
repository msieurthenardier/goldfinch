# Squawk 0014: Behavior-test crew file lacks the apparatus facts from the Mission 16 Flight 3 runs (batch 2)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-26
**Completed**: 2026-08-26

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

Extended `.flightops/agent-crews/behavior-tests-execution.md`'s Project Apparatus Notes (goldfinch) — no restructuring, no prompt changes, no source changes. Added `welcome-home-first` to the intro's run-slug list (the crew file was missing it even though it was already in scope for these facts).

Merged into existing bullets:
- **Reads** — added the `.hidden`-CSS-class-vs-IDL-property fact (blocks hide by class; read `className`/`getComputedStyle().display`/rect, gate on `#welcome-surface`'s own display).
- **`scroll` parameters** (renamed to **`scroll`/`pressKey` arguments**) — added the `pressKey` `Enter`-not-`Return` fact and its accepted-key vocabulary alongside the existing `scroll` `dx`/`dy` fact.
- **Out-of-band relaunch** — updated the transcript-loss sentence from "on one run" to "three occurrences … so far", citing the third occurrence.

Reconciled:
- **Cross-window/broadcast baselines** — rewritten to the current (post-DD7-pivot) behavior: a preference broadcast re-renders other windows' shown welcome tabs with the saved value but no longer navigates them; `settle`'s only remaining self-navigation is the pending-search branch. The retired pre-pivot auto-attach is kept as an explicit "historical" note rather than deleted, since older run citations documented it. Original two citations kept; added the F3 Leg 2 run confirming the retirement plus a citation to `welcome-controller.js` (`settle`/`submitHome`) and commit `46b3f5a`.

Added new bullets (topics with no prior coverage): **Bookmarks bar** (app-wide rendering + `button.bm-item`/`#star` selectors), **Burner tabs** (`.tab-jar` swatch), **`evaluate` on internal guests** (refused, "internal-session excluded"), **Re-activating a viewless welcome tab** (strip-rect click, no wcId), **Transient `sheetWcId`**, **Stored `homePage` value** (as-typed vs. navigation-normalized), **Settings scroll position** (bookmarks-bar toggle below the fold at 1080 px).

Review fix: the **Bookmarks bar** bullet omitted burner-tab suppression — it named only internal guests. Confirmed against `src/renderer/chrome/window-controller.js` (~lines 91-113), where `applyBarVisibility` gates on `barEnabled && !barSuppressed` and the comment scopes suppression to "burner / internal — L3-DD-C/D". Amended the bullet to state the bar is suppressed on burner-jar tabs as well as internal guests, citing Checkpoint 5 of both `welcome-home-routing` runs (2026-08-25-20-38-40 and 2026-08-26-02-29-57), which record "bookmarks bar suppressed on the burner tab".

## Verification

- Read all seven Flight 3 runs in full (Orchestrator Notes, Checkpoint Raw State/Validator notes, and Closing Summaries) to survey the batch for undocumented facts: `tests/behavior/welcome-first-launch/runs/2026-08-25-20-20-29.md`, `tests/behavior/welcome-first-launch/runs/2026-08-26-02-10-54.md`, `tests/behavior/welcome-home-first/runs/2026-08-25-20-08-57.md`, `tests/behavior/welcome-home-first/runs/2026-08-26-02-00-25.md`, `tests/behavior/welcome-home-routing/runs/2026-08-25-20-38-40.md`, `tests/behavior/welcome-home-routing/runs/2026-08-26-02-29-57.md`, `tests/behavior/new-tab-default-routing/runs/2026-08-26-03-01-14.md`. Of these, only five are actually cited by a bullet in the crew-file diff (`welcome-first-launch/runs/2026-08-25-20-20-29.md`, `welcome-first-launch/runs/2026-08-26-02-10-54.md`, `welcome-home-first/runs/2026-08-25-20-08-57.md`, `welcome-home-routing/runs/2026-08-25-20-38-40.md`, `welcome-home-routing/runs/2026-08-26-02-29-57.md`); `welcome-home-first/runs/2026-08-26-02-00-25.md` and `new-tab-default-routing/runs/2026-08-26-03-01-14.md` were read but yielded no fact not already covered by another citation, so no bullet cites them. Every new/extended bullet's citation points at a specific checkpoint/section in one of the cited runs that actually states the fact (verified by re-reading the cited passage, not just grepping for the topic word).
- The reconciled **Cross-window/broadcast baselines** bullet was checked directly against `src/renderer/chrome/welcome-controller.js`'s `settle()` (lines ~328-336) and `submitHome()` (lines ~286-307): `submitHome` now calls `settle(tab, { home: value })` instead of `attachView` on success (save-and-stay), and `settle`'s only `attachView` call is gated on `query != null && engine != null` (the pending-search branch) — confirming the broadcast handler (`onSettingsChanged`) calls `settle(tab)` for re-render only, never a bare attach. Cross-checked against `missions/16-search-and-startup-choice/flights/03-welcome-branding/flight-log.md`'s HAT item 6 entries and commit `46b3f5a` (`git show --stat`), which confirm the DD7 pivot and the commit hash.
- Confirmed no other bullet's meaning was touched (diff reviewed in full — only the intro run-list, the three merge targets, the one reconciled bullet, and the eight new bullets changed).
- Confirmed the `## Prompts` section, all source files, and all test/spec files are untouched (`git diff --stat` shows only the crew file and this squawk file).
- `npm test`: 3792 pass / 0 fail (unchanged from before this squawk's edits — no source or test files touched).

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — two review rounds, batch turnaround 2026-08-26 — round 1 blocked on the new Bookmarks bar bullet omitting burner-jar suppression (`window-controller.js` `applyBarVisibility`, `barEnabled && !barSuppressed`, burner/internal), fixed and confirmed in round 2
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-26 (0013, 0014, 0015)` on `squawk/turnaround-2026-08-26` (PR number recorded on the PR itself)

Reviewer spot-checked five citations in full against the run-log text (hidden-CSS-class, the reconciled cross-window bullet, `pressKey` vocabulary, `evaluate` refusal / re-activate / `sheetWcId`, stored `homePage` / scroll position) and confirmed all eleven facts present, the `## Prompts` section untouched, and the DD7 reconciliation correct against `settle`/`submitHome`. Suite 3792/3792. Verdict: "Squawk 0014's crew-file extension is now correct and complete: all eleven Flight 3 facts are added without restructuring the file, citations were spot-checked against the actual run-log text and hold up, the reconciled cross-window/broadcast bullet correctly reflects the DD7 pivot against `welcome-controller.js`, and the Bookmarks bar bullet — flagged in the first review pass for omitting burner-jar suppression — now correctly states the bar is suppressed on burner-jar tabs as well as internal guests, verified against both `window-controller.js`'s `applyBarVisibility` and Checkpoint 5 of the two cited `welcome-home-routing` runs. The Verification section's read-vs-cited distinction is now accurate. Approved."
