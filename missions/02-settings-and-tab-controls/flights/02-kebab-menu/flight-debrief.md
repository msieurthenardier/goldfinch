# Flight Debrief: Kebab Menu

**Date**: 2026-06-07
**Flight**: [Kebab Menu](flight.md)
**Status**: landed
**Duration**: 2026-06-07 — single operator session (plan → build → verify → HAT → land)
**Legs Completed**: 5 of 5 (3 autonomous build/docs + verify-integration + optional HAT)

## Outcome Assessment

### Objectives Achieved
The flight delivered every objective. A kebab (⋮) overflow menu was added as the last control in the toolbar row (right of the Shield button) — an APG menu-button popup (`role="menu"`/`role="menuitem"`, roving tabindex, full arrow/Home/End/Escape nav, focus-into-on-open, focus-restore-on-Escape) with two items: **Settings** (inert placeholder until the `goldfinch://` mechanism lands in Flight 3+) and **Exit** (terminates the app on all platforms via a dedicated `app-quit` IPC). All In-Flight checkpoints met; the Adaptation "divert if APG nav disturbs the container menu" never fired (the kebab is a genuinely separate element).

### Mission Criteria Advanced
- **SC3** — kebab present in the toolbar row, right of Shield, exactly two actions (Settings, Exit). **Verified**: `kebab-menu` behavior test PASS 10/10.
- **SC4** — Exit terminates the application. **Verified manually**: trusted Exit click → `app.quit()` → clean termination (dev process exit 0, `:9222` dead, no procs left; Windows/Linux — macOS deferred to a mac HAT).
- **SC8** — kebab keyboard-operable, no new WCAG A/AA violations. **Verified**: behavior test (APG keyboard) PASS; `npm run a11y` 0 kebab-attributable violations.

## What Went Well

- **The both-axes apparatus premise audit (DD6) was the flight's highest-leverage move — and it caught a real gap.** Design review found `scripts/cdp-driver.mjs` shipped only horizontal `ArrowLeft/Right` (built for the tablist) with **no `ArrowDown/ArrowUp`** — exactly the keys the kebab's vertical APG nav needs. Fixed in leg 4 (`cdp-driver.mjs` KEYS, vk 40/38) *before* the test ran. Without the act-axis audit, "arrow nav is drivable" would have been assumed-true and surfaced as a runtime test failure (or silently-untested vertical nav). The observe-axis audit correctly concluded no new read-path was needed (contrast Flight 1's maximize-state seam) — and that held.
- **DD1 pinned the kebab position explicitly (child-order + ASCII diagram)** — directly applying Flight 1's sharpest lesson (the "adjacent" ambiguity that cascaded into layout rework). The behavior test confirmed placement first try (kebab left 1357 ≥ Shield right 1351).
- **The operator's placement amendment was handled cleanly.** The kebab moved from the mission's original tab-bar placement to the toolbar row by operator decision *at planning*; mission Outcome + SC3 + SC9 + the Flight-2 breakdown were all updated coherently and the now-inaccurate "departure from address-bar-row menus" framing was dropped rather than left dangling.
- **Convention fidelity throughout** — JSDoc-cast `els.*`, the d.ts/preload mirror gated by typecheck, the container-menu `stopPropagation`-before-global-close discipline, `class="icon-btn"` to inherit the focus ring with zero new CSS. Reviewer + both debrief agents confirmed the diff is tight, additive (+123/-1), and touches no tab-strip/tablist/container-menu/window-control behavior.
- **DD5's "fuller APG, deliberately" call produced a genuine a11y step-up** (kebab has `role=menu`/`menuitem` + roving tabindex; the container menu has neither) — verified by 10/10 + 0 axe violations.
- **Behavior-test apparatus discipline + Witnessed pattern** — single-pass Executor + independent Validator, trusted CDP via the committed `cdp-driver.mjs`, `chrome-devtools` MCP correctly avoided. The Validator did real adversarial re-observation (independently re-read both focus-ring PNGs for checkpoint 9).
- **The HAT earned its keep** — the operator approved the feel and elected to fix both Reviewer-flagged notes (mutual-exclusion + Tab-closes), re-verified live before landing.

## What Could Be Improved

### Process
- **The two HAT-introduced behaviors have no regression net.** Leg 5 added (a) menu **mutual exclusion** (opening the kebab closes the container menu and vice versa) and (b) **Tab/Shift+Tab closes the kebab menu + restores focus** — both verified live ad-hoc, but **neither is a checkpoint in the committed `kebab-menu` spec** (the spec's steps predate them; its "Variants" still lists Tab-handling as a *possible* future parametrization). A future refactor could silently break either and every committed test would still pass. *(Both debrief agents flagged this independently — the top actionable item.)*
- **a11y baseline drift is now biting, not hypothetical.** Current `npm run a11y` no longer shows the mission Known-Issues "2 `scrollable-region-focusable`" findings — it reports 8 moderate structural findings (`region` on `#tabs`/`#brand`/`#address-wrap`, `landmark-one-main`, `page-has-heading-one`), none kebab-attributable. "No *new* kebab violations" was provable only because a human extracted node targets by hand. The spec's instruction to "compare vs the 2 known scrollable-region-focusable" was already stale. This is exactly the failure Flight 1's debrief predicted; its "pin the a11y baseline" action is still open and should be re-flagged with raised priority.

### Technical
- **Line-number reference baked into a shipped source comment.** `main.js` (the `app-quit` handler comment) cites `main.js:536-537` for the darwin guard, which is now at `540-541` — drifted before review even finished. This was *spec-prescribed* (leg 2 guidance literally baked the line range into the suggested comment), so fix the guidance, not just the code: reference the **symbol** (`window-all-closed` handler / DD3) in committed comments, never a line range. Same silent-drift class the project already fights with the hand-mirrored d.ts.
- **Parallel-but-separate menus, now with diverging behavior.** The kebab and container menus share styling but have two open/close pairs, two always-on global `document` click listeners, two copies of the popup chrome CSS, and **bidirectional hand-wired mutual-exclusion** (each open calls the other's close — an O(n²) coupling that a third menu would aggravate). Consensus: **do not refactor reactively** (a shared helper must *lift the container menu up to the kebab's APG level*, touching the passing `unified-tab-controls`/`tab-keyboard-operability` surfaces — real regression risk for zero user-facing gain today). Instead make "extract a shared APG menu helper" an explicit precondition of the next flight that adds a third menu/popup.
- **`positionKebabMenu()` runs only on open** (no `resize` listener) — a window resize while the menu is open would mis-anchor it; near-zero real risk since any outside interaction closes it first. Acceptable; noted.

### Documentation
- README keyboard-shortcuts table brought current (closing Flight 1's carry-forward debt) and CLAUDE.md got the kebab/`app-quit` note — no critical gaps. The only doc-ish gap is the spec-level one above (HAT behaviors absent from the committed test spec).
- The mission's Known-Issues a11y baseline ("2 scrollable-region-focusable") is now out of date and should be reconciled when the baseline is pinned.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Kebab placement moved from tab bar → toolbar row | Operator decision at planning; mission amended | N/A (operator scope call; the *clean amendment* of mission Outcome+SC3 is the practice to keep) |
| HAT added menu mutual-exclusion + Tab-closes-menu | Operator elected to fix the two non-blocking Reviewer notes | Yes — but fold the new behaviors into the `kebab-menu` spec so they're witnessed |
| Single-pass Executor + Validator (not re-spawn-per-checkpoint) | `SendMessage` absent; fast UI test, no long waits | Yes — already the project's established Witnessed realization (Flight-1 precedent) |
| Flight committed before live verification (deferred-commit), then verified + follow-up commit | Live verification needs a GUI app the harness can't spin up autonomously | Yes — commit reviewed code, then verify against the running app; fix-forward in a new commit (no amend) |

## Test Metrics

- **`npm test`** → **147 pass / 0 fail / 0 skipped** (internal ~75 ms; wall ~0.18 s). No flakes (single run; pure security/privacy helpers). **`npm run typecheck`** → 0 errors (~1.0 s). **`npm run lint`** → 0 problems (~0.55 s).
- **Unit-test count delta vs Flight 1 / mission 01: 0** (147 → 147). History: 96 → 147 (+51, privacy core) → 147 held flat across all subsequent flights. **Zero new offline unit tests is correct** — this flight is renderer a11y/CSS/IPC/native-focus-traversal work, not reachable by the offline suite (which only exercises pure `src/shared` + `src/main` helpers). Coverage correctly lives in the behavior test + axe gate ("flat 147 is the honest signal").
- **Behavior tests**: +1 spec `kebab-menu`, promoted `draft → active`, **10/10**. Timing flat vs prior flights (sub-10 ms spread on a ~70 ms suite) — no regression, none expected (no `test/unit/**` or imported module touched).

## Skill Effectiveness

- **Mission skill**: the placement-amendment flow worked — the conflict between operator intent and the written mission (SC3) was surfaced *before* building and the mission was amended honestly. Reinforces Flight-1's "pin layout position explicitly" lesson; here it was pinned and held.
- **Flight skill**: the **both-axes (act + observe) premise audit** is again the strongest practice — it caught the driver KEYS gap (act axis) and correctly declined an observe-axis seam. Generalize the "does the driver actually send these specific keys?" check into the standing behavior-test preflight. The deferred-commit model + apparatus-prep-first verification leg sequencing worked.
- **Leg skill**: high-fidelity, mechanically implementable; the body-level-sibling positioning requirement and the static-HTML-items simplification (from design review) were exactly the right level of pre-spec. One miss: leg guidance prescribed a line-number reference in a committed comment (see Technical).
- **Behavior-test skill**: Witnessed separation preserved; apparatus discipline held. Gap: the spec should be updated when HAT introduces new behaviors so they enter the regression net.

## Recommendations

1. **Fold the two HAT behaviors into `tests/behavior/kebab-menu.md`** — add a *mutual-exclusion* checkpoint (open container → open kebab closes container, and reverse) and a *Tab-closes-menu* checkpoint (Tab in the open menu → closes + focus to trigger). Without this, two operator-requested behaviors have no regression net.
2. **Pin the a11y baseline** (Flight-1 carry-forward, now demonstrably biting) — a small structured expected-violations allowlist *in the audit script* (not a committed golden file, per the snapshot-not-committed convention) so `npm run a11y` diffs against it. Reconcile the mission Known-Issues "2 scrollable-region-focusable" entry while doing so. Best owned by **Flight 4** (a whole settings page = large new a11y surface) as a prerequisite.
3. **Stop baking line-number references into committed source comments** — reference symbols/DD ids instead. Fix the existing `app-quit` comment and the leg-skill guidance that prescribed it.
4. **Make "extract a shared APG menu helper" a precondition of the next flight that adds a third menu/popup** — lifting the container menu up to the kebab's APG level, with the `unified-tab-controls`/`tab-keyboard-operability` suites as its regression gate. Do not refactor reactively now.
5. **Keep macOS on the mac-HAT backlog explicitly** — the entire frameless path (Flight 1) *and* this flight's `app-quit` darwin behavior are verified only on Linux/WSL; an `app.quit()` macOS regression would be invisible to every Linux verify run. Clear both deferrals in one mac HAT before any macOS build.

## Action Items
- [x] Add mutual-exclusion + Tab-closes checkpoints to `tests/behavior/kebab-menu.md` (Rec 1) — **done**: spec now 12 checkpoints; re-run `2026-06-07-10-42-52` **12/12 pass** (both new checkpoints verified)
- [ ] Pin the a11y baseline + reconcile mission Known-Issues a11y entry (Rec 2; suggest Flight 4 owns it)
- [ ] Replace the line-number reference in the `app-quit` comment with a symbol/DD reference; fix the leg-skill guidance that prescribed it (Rec 3)
- [ ] Track "extract shared APG menu helper" as a precondition for the next menu-adding flight (Rec 4)
- [ ] Budget a mac HAT to clear the frameless + `app-quit` darwin deferrals (Rec 5)
- [ ] Flight 3: wire the Settings handler through `createTab('goldfinch://settings')` **via** the `isSafeTabUrl` predicate (not a one-call-site bolt-on), and add a positive "Settings opens the page" checkpoint (currently only inertness is tested)
- [ ] Carry-forward (not this flight): merge PR #24 (Linux-only window border) after a Windows glance; promote `farbling-correctness`/`tab-scheme-guard` from draft; `npm run format` the `.github/dependabot.yml` prettier drift; capture the 4 reusable patterns in CLAUDE.md
