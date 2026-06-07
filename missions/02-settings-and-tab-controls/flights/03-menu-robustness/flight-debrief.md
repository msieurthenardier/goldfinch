# Flight Debrief: Menu Dismissal & Shared APG Helper

**Date**: 2026-06-07
**Flight**: [Menu Dismissal & Shared APG Helper](flight.md)
**Status**: landed
**Duration**: 2026-06-07 — single operator session (plan → spike → build → verify → HAT → land)
**Legs Completed**: 4 of 4 (menu-controller + migrate-container-menu + verify-integration + HAT)

## Outcome Assessment

### Objectives Achieved
Every objective delivered. Both dropdown menus (kebab `⋮` and container `▾`) now route through a shared in-file `menuController` that owns open/close, mutual-exclusion (open closes others), and robust outside-dismiss — a target-aware `document` `pointerdown` handler (in-chrome clicks) + a `window` `blur` handler (page/`<webview>` clicks + app-switch). This fixes the reported bug (menus surviving page clicks / the other menu's trigger) at the root and deletes Flight-2's hand-wired mutual-exclusion + dual `document` listeners + per-trigger `stopPropagation` reliance. The container menu was lifted to the kebab's APG level (`role=menu`/`menuitem`, roving tabindex via the shared `focusItem`, Arrow/Home/End/Tab, trigger keyboard). No diverts fired.

### Mission Criteria Advanced
- **SC8** — keyboard-operable, no new WCAG A/AA violations. **Verified**: `menu-dismissal` 9/9; open container menu axe-clean (0 violations); `npm run a11y` no new violations vs baseline; kebab + tablist regressions intact. The container menu's APG uplift is the SC8 advance; flight-local dismissal correctness is the rest.

## What Went Well

- **Spike-first DD1 was the single best call of the flight** (both agents independently). The window-blur premise (does focusing a `<webview>` fire `window` blur on WSLg?) was empirical and the *entire* dismissal mechanism hung on it. The Flight Director ran the spike **before** designing leg 1 in detail, it confirmed, and the preload-forward fallback (a whole second surface touching `webview-preload.js` + the `ipc-message` switch) was correctly never built. The implementation is a one-liner (`renderer.js:155`) precisely because the risk was retired up front — the exact Flight-2 debrief lesson ("a divert spike must run before the build it gates") applied correctly.
- **The leg-1 design review caught a high-severity infinite-recursion before any code was written** — `close → onClose → closeX → close` if `onClose` were wired to the public wrapper. The shipped code encodes the fix structurally (raw hide bodies as `onClose`; distinct thin wrappers delegating to `menuController.close`) with a 7-line header comment explaining why they must stay distinct. This would have been a hang, not a test failure, if it had shipped.
- **DD4 re-scoping (front-load all removals into leg 1) closed the intermediate-`ReferenceError` gap** — moving both cross-call removals + dual-listener removal + container dismissal registration into leg 1 (leaving leg 2 = APG-uplift-only) made every committed state internally consistent. The gap DD2 worried about never materialized.
- **Honest witness/real-click epistemics (DD5)** — the witnessed path drove `webview.focus()` (the same `window` blur a real click fires); the real pointer page-click stayed a *mandatory* manual check rather than assumed-covered. That humility paid off: the real trusted CDP click into the webview *also* dismissed (bonus), which only counts as confirmation *because* it was kept as a separate check.
- **The `menuController` is a genuine architectural improvement** over the Flight-2-flagged shape (two parallel open/close pairs, two global `document` listeners, O(n²) bidirectional cross-calls, per-trigger `stopPropagation`). Mutual-exclusion is now inherent (open ⇒ `closeAll`); `menuController.current` is a single source of truth both triggers read for toggle, which quietly kills the `stopPropagation`-vs-global-listener race that caused the original bug class.
- **Governance**: inserting a dedicated robustness/debt flight (reordering scheme/settings down by one) to do the refactor properly — rather than smuggling it into a feature flight — was the right call, and it discharged Flight-2 debrief Rec 4.

## What Could Be Improved

### Important
- **The `menuController` is under-factored relative to DD2's own promise: the APG keyboard contract is duplicated across both menus (~40 lines).** The controller owns open/close/dismiss/mutex but NOT keyboard nav. The container menu keydown (`renderer.js:245-268`) and kebab menu keydown (`:355-374`) are near-identical Escape/Tab/Arrow/Home/End blocks; the two trigger keydowns (`:234-242` / `:347-356`) likewise. Only `focusItem` is genuinely shared. The per-entry split was a *deliberate, logged* leg-1 safeguard ("don't uplift the container's keyboard before leg 2") — but that rationale **fully expired** when leg 2 gave the container the identical contract, and no leg's remit was "now hoist the shared contract into the controller." **This is the flight's one self-inflicted new debt, and it's the thing that bites when Flight 4 adds menu #3** (the open/close/dismiss/mutex half scales for free via `register`; the keyboard half makes #3 copy ~40 lines a third time).
- **The a11y baseline is still unpinned — now thrice-flagged (Flight 1 → Flight 2 Rec 2 → here) — and Flight 4 is the forcing function.** `scripts/a11y-audit.mjs` still has no allowlist/baseline diff; it fails on raw violations, so leg-3's "no new violations" stayed a *manual* node-target judgment. Tolerable here (tiny surface that *reduced* violations) but **Flight 4's `goldfinch://` scheme + Flight 5's settings page add a large net-new a11y surface** where a manual diff stops being credible.

### Minor
- **Tab-closes path not witnessed this flight.** `menu-dismissal` Step 6 is Escape-only; the FD smoke didn't list Tab; `kebab-menu` Step 12 (Tab-closes, a Flight-2 action item) wasn't re-run. The Tab branch was freshly written for the container and refactored for the kebab this flight, so it's the one controller-touched behavior no test re-exercised. Low severity (mirrors the proven Escape path).
- **`window.prompt` "New container…" not witnessed** (manual-only) — DD3 called it a "real must-verify" because the prompt steals focus (now interacting with the blur-dismiss path). `menu-dismissal` Step 8 only activates a *named* container.
- **Inline-left anchor + no resize-listener, now on two menus.** Both `positionKebabMenu()` (`:296-301`) and the container's inline `left` (`:215`) recompute only on open; a resize-while-open mis-anchors. Near-zero risk (blur dismissal masks it; `minWidth:900`), but the controller is the natural owner of a reposition-on-resize for `current`.
- **`entries` array is write-only** — `register` pushes but only the single `current` is ever closed (correct given the mutex invariant); either use it for a defensive closeAll or drop it.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD4 removals front-loaded leg 2 → leg 1 (leg 2 = APG-uplift-only) | Design review: close the intermediate-`ReferenceError` gap; keep each committed state consistent | Yes — when removing N cross-wired call sites, move them all in one leg |
| `register({trigger, menu, onOpen, onClose})` object form vs DD2's `register(trigger, menu, {buildItems, anchor})` sketch | In-implementation refinement; `buildItems`/`anchor` folded into `onOpen` | Yes (cleaner) |
| Regressions run as targeted smokes, not full Witnessed re-runs | FD proportionality call; `menu-dismissal` + smoke jointly cover most kebab behavior | Partially — acceptable, but re-run the full spec when the controller is next touched (left the Tab-closes gap) |
| FD ran the DD1 spike before leg-1 design | Spike gates the dismissal mechanism (divert trigger) | Yes — already a standing lesson; reinforced |

## Test Metrics

- **`npm test`** → **147 pass / 0 fail / 0 skipped** (internal ~83 ms; per-suite: url-safety 49, jars 38, download-path 29, shields 16, trackers 15). No flakes. **`npm run typecheck`** → 0 (~1.0 s). **`npm run lint`** → 0 (~0.55 s).
- **Unit-test count: flat at 147** — fourth consecutive renderer/a11y flight at 147 (history 96 → 147 +51 privacy core → flat). Correct: the diff is renderer-only (`renderer.js` +194/−60, `index.html` 1 line, `CLAUDE.md` 1 line), touching zero `test/unit/**`/`src/main/**`/`src/shared/**`. Timing ~83 ms vs Flight-2 ~75 / Flight-1 ~72 ms = sub-100 ms run-to-run noise on unchanged suites, not a regression.
- **Behavior tests**: +1 spec `menu-dismissal` (9/9), promoted `draft → active`. `kebab-menu` held at 12 checkpoints; `unified-tab-controls`/`tab-keyboard-operability` run as smokes (cores confirmed), not full re-runs.

## Skill Effectiveness

- **Mission skill**: the reorder (insert a robustness flight, push scheme/settings down) via the "tentative, not commitments" flight list worked cleanly; the amendment was coherent.
- **Flight skill**: the **spike-before-the-dependent-build** practice (DD1) and the **both-axes apparatus audit** (DD5) are again the strongest practices — the spike retired the one real risk to a one-liner, and the audit's witness/real-click split was vindicated. New lesson: when a flight's later leg makes an earlier leg's per-entry safeguard redundant, the spec should include an explicit "now hoist the shared contract" cleanup step — its absence is exactly why the keyboard duplication shipped.
- **Leg skill**: high-fidelity; the design-review catches (recursion, DD4 front-load) were the system working. The leg-2 remit "APG-uplift-only" was correct for the ReferenceError gap but is also why no leg owned the keyboard-hoist — a one-line cleanup directive in leg 2 would have caught it.
- **Behavior-test skill**: Witnessed discipline held (single-pass Executor + independent Validator re-driving key checkpoints; trusted CDP, not chrome-devtools MCP). The Validator surfaced a real spec-quality issue (trigger coordinates drift as tabs are added → re-query per click), now folded into the spec.

## Recommendations

1. **Hoist the APG keyboard contract into `menuController` before Flight 4 adds menu #3** — parameterize a controller-level keydown by the registered `menu` + an items-getter (both menus already expose `kebabItems()`/`containerItems()` with identical shape) + a restore-target. Do it while there are exactly two call sites to reconcile (same "reconcile while N is small" logic that made DD4's front-load work). This completes DD2's promise and makes "register with the controller" a *complete* contract.
2. **Pin the a11y baseline as Flight 4 leg 1, before the settings-page markup lands** — a structured expected-violations allowlist *in `scripts/a11y-audit.mjs`* (gitignored local regression artifact per the user-global snapshot rule — NOT a committed golden file), with targeted axe-on-open assertions (like this flight's) as the committed/CI-able contract. Once a whole settings page exists, manual "no new violations" is no longer credible.
3. **Make the shared `menuController` a hard precondition for any new menu/popup** (Flight 4/5) — re-introducing a hand-wired `document` listener or per-trigger `stopPropagation` would regress this flight's exact bug. Add a one-line contract note in CLAUDE.md. Caveat: registering today gets dismissal/mutex free but NOT keyboard nav — fix #1 first.
4. **Re-audit the blanket close-on-blur assumption per new popup** — Flight 4/5 may add a popup that legitimately survives focus leaving the chrome (OS file dialog, intentional guest focus). If so, the controller needs a per-entry `dismissOnBlur` opt-out rather than the blunt `window.blur → closeAll`.
5. **Close the small witness gaps** — add a Tab-closes-and-restores checkpoint to `menu-dismissal` (one step covers both menus; handlers are identical) and a `window.prompt` New-container manual checkpoint; and when the controller graduates to its own module (recommended once it absorbs the keyboard contract + gains a 3rd consumer, via the `src/shared` dual-export pattern), add a unit test for the mutex/recursion-avoidance logic — a second net under the recursion trap.

## Action Items
- [ ] Hoist the duplicated APG keyboard contract into `menuController` before Flight 4 adds a third menu/popup (Rec 1)
- [ ] Pin the a11y baseline (allowlist in `scripts/a11y-audit.mjs`, gitignored) as Flight 4 leg 1, before settings markup (Rec 2)
- [ ] CLAUDE.md: note the `menuController` is the mandatory pattern for any new menu/popup (Rec 3)
- [ ] Flight 4: re-audit close-on-blur per new popup; add per-entry `dismissOnBlur` opt-out if needed (Rec 4)
- [ ] Add Tab-closes + New-container checkpoints; add a `menuController` unit test when it graduates to a module (Rec 5)
- [ ] Flight 4: wire the inert Settings handler (`renderer.js:329` TODO) through `isSafeTabUrl` + add a positive "Settings opens the page" checkpoint (carried Flight-2 action item)
- [ ] Carry-forward: merge PR #24 (Linux-only border) after a Windows glance; `npm run format` the `.github/dependabot.yml` drift; budget a mac HAT (frameless + app-quit + menu dismissal on macOS)
