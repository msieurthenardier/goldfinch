# Flight Debrief: Search Engine as a Preference

**Date**: 2026-08-24
**Flight**: [Search Engine as a Preference](flight.md)
**Status**: landed
**Duration**: 2026-08-11 – 2026-08-24 (design, both legs, and implementation on 2026-08-11; acceptance gate, review, and landing on 2026-08-24 after the intervening session was cut off)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The flight delivered exactly its objective. `searchEngine` is a real settings key restricted to a curated eight-engine table (`src/shared/search-engines.js`, Electron-free, imported by both the main-process validator and the renderer's URL construction); `toUrl`'s hardcoded Google URL is gone, replaced by a live `searchEngineCache` that is boot-seeded and broadcast-kept; Settings renders a radio group from the shared table adjacent to the home-page control, writing through the existing `internal-settings-set` bridge with no new IPC; and schema v3 force-persists both `searchEngine` and `homePage` explicit to disk for every profile — including row-less and corrupt-row profiles — so that after this flight "no settings row" once again means "never ran with the preference system", which is what Flight 2's unset-by-default must target.

Landed as a single flight-end commit (`e86330d`) on `flight/01-search-engine-preference`; PR #165 open. Unit suite 3667 → 3714 (all passing), typecheck and lint clean. Two behavior specs authored with the flight were run for the first time and promoted `draft` → `active`.

### Mission Criteria Advanced

- **Criterion 1** (address-bar search uses the chosen engine; survives restart; every window, no restart) — **met**, behavior-test-backed (`search-engine-preference` checkpoints 2, 4, 5, 8).
- **Criterion 2** (context-menu "Search for …" uses the same engine) — **met**; the automation surface cannot reach the page-context sheet, so this was operator-verified by hand at the debrief (run log Operator Notes). Structurally the `sel:search` dispatch calls the identical `toUrl`.
- **Criterion 3** (independent, adjacent preferences; setting either never changes the other) — **settable half met** (checkpoints 1, 3, 7); the clearable half is Flight 2's by DD6.
- **Criterion 4** (upgrade neutrality; Google now explicit and changeable) — **met** (`search-engine-upgrade` checkpoints 1, 3, 4, 5); the one failing row measured pre-existing squawk 0005, proven neutral by differential (below).
- **Criterion 10** (only curated engines storable; corrupt values repair without blocking startup) — **validator + repair half met**, unit-tested under the DD8 red-when-neutered rule; "without silently selecting a provider" completes with Flight 2's default flip.

All four flight checkpoints met. Value delivered: the preference is real and useful on its own even if Flight 2 were deferred — which was the flight's design premise.

## What Went Well

- **Design review caught the flight's most consequential error before a line of code.** DD4's original draft would have copied `homePageCache`'s pattern; the reviewer read the cache's actual writers instead of trusting CLAUDE.md's description and found the pattern had no boot seed at all. That one catch (a) stopped a second copy of the defect class from being born, (b) surfaced a live pre-existing defect that became squawk 0005, and (c) corrected a false claim in CLAUDE.md. The corrected DD4 text and the `searchEngineCache` comment now explicitly contrast the new cache with its defective sibling — a good idiom for keeping a known defect class from being silently reintroduced.
- **Leg 1's design review also found an undocumented gap** (`parseAndRepair`'s corrupt-row catch hardcoded `migrated: false`, so a corrupt document row was repaired in memory but never pinned to disk) and the DD5 implementation trap materialized exactly as the flight text predicted. Both were fixed pre-code; the `migrated` → `needsPersist` rename improved naming precision as a side effect.
- **DD8 was executed, not asserted.** The Developer hand-neutered `VALIDATORS.searchEngine` and named the six tests that went red. The `buildSearchUrl` tests cover the literal-`%s`-in-query case (no second substitution point) and use a function-callback `replace` that sidesteps `$&` special substitutions.
- **The Witnessed pattern held under real adversity.** Across the two runs: an apparatus dead end at checkpoint 1 (rerun through the documented chrome seam), an Executor whose transcript was lost mid-run (replacement re-spawned with the established facts, verified no state drift, and was indistinguishable in report quality), an out-of-band quit/relaunch with key rotation (the `session-restore` procedure, authored-but-unrun until now, worked as written), a structurally unreachable step, and a failing step that looked like a regression. Every verdict was rendered on rendered-state evidence and none was soft-pedalled — the Validator called checkpoint 6 inconclusive rather than a polite fail, and called checkpoint 2 a fail rather than excusing it.
- **The differential against the pre-flight build converted "likely regression" into "proven pre-existing" in five minutes.** The Validator's step-2 note said regression; its own step-5 note said state-dependent; the Orchestrator reproduced the identical first-tab miss on `c8563f3`. Three independent lines (the squawk's report, the post-broadcast Ctrl+T, the differential) closed it. This is the disposition proof a "known issue" landing should always carry.
- **The upgrade fixture by procedure worked first time.** A `git worktree` at `c8563f3` with `node_modules` symlinked, a Settings-driven home-page write on the old build, a clean quit, and a row verified `version 2` / no `searchEngine` key — authentic serializer output, as DD7 required, produced in under three minutes.
- **The deferred-commit model paid off twice**: the cut-off session lost nothing (both legs' state lived in the leg artifacts and flight log, all uncommitted work sat on the branch, and HEAD was still the pre-flight commit the fixture needed), and one flight-end Reviewer independently re-ran the suite, checked every criterion in both legs against the diff, read both run logs, and grepped for identity leaks — no blocking findings.
- **Test suite health is flat.** 3714 tests in ~3.0 s wall-clock, within 0.4–4 % of M15 F3's corrected 3,091 ms despite +156 tests (+4.4 %); no skips, no todos, no flakes in isolated runs; none of this flight's touched suites are among the slow ones.

## What Could Be Improved

### Process

- **The spec premise audit was done by half, and this project had already ruled on both missing halves.** DD7 audited the *new* widget (the radio group) on both axes — act and observe — carefully, and that half held completely. It did not audit the two *pre-existing* premises the specs leaned on: (1) that the page-context "Search for …" sheet could be driven or observed at all — `AUTOMATABLE_MENU_TYPES` in `src/main/automation/resolve.js:53` has allowlisted only `bookmarks-overflow` and `bookmark-edit` since before this flight, and `captureWindow` does not composite other sheets; one grep on 2026-08-11 would have shown checkpoint 6 was unreachable on either axis; (2) that the first new tab after launch opens on the configured home page — the flight's own corrected DD4 text and squawk 0005, written the same day as the specs, state the opposite. Prior rulings not honored: M02's "both-axes apparatus premise audit" (every widget a spec touches, not just the new one), M06's "premise-audit a new behavior spec before its first run — trace every empirical claim", and M10's "spec premise-audits must check the flight's own prior DD text". Both misses were caught by the Witnessed pattern at runtime and honestly dispositioned — but at the expensive point, thirteen days later, instead of the cheap one.
- **Suite wall-clock was again not recorded in-artifact.** M15 F3's debrief Recommendation 3 asked for a duration beside every pass count in gate entries, because a 5× timing regression there hid behind a green count. This flight's checkpoint and flight-log entries carry counts only; the debrief Developer had to reconstruct timing. Second flight running.
- **Flight-log arithmetic phrasing.** Leg 1's entry says "3706 … before and after", meaning before and after the DD8 neuter probe; read cold it suggests the flight's baseline was 3706. The pre-flight baseline was 3667. Gate entries should state the explicit before → after for the leg.
- **The session cut-off cost a full session of acceptance work but no state.** Nothing to fix in the model; worth noting that the acceptance gate for a two-spec flight (fixture production, two live runs with an out-of-band relaunch, a differential, review, commit) is a session-sized unit of work on its own and should be planned as one.

### Technical

- **Two cache shapes now coexist** — `searchEngineCache` (boot-seeded + broadcast, `!== undefined` guard) and `homePageCache` (broadcast only, squawk 0005). Deliberate and documented, but a future reader sees two same-purpose caches with different shapes side by side. Flight 2 unifies them onto the seeded shape; `homePageCache` should be treated as a known-bad exemplar, never cited as precedent.
- **The v3 stamp-only rung** departs from the store's own ladder convention ("only for changed defaults on existing keys"). Named and rationalized at the DEFAULTS comment; still one rung that doesn't fit its own rule.
- **`toUrl`'s single `|| 'google'` coalescing site** is a contained Flight-1-only liability, grep-bounded and commented; Flight 2's unset routing rewrites it alongside the three `|| HOMEPAGE` sites.
- **Squawk 0003 stays open and latent.** DD3 deliberately avoided widening its exposure (verified — no new mutation wrapper), but the broadcast-invariant net's substring detection is still a hole for any future settings key.
- **Two Flight-2-activated defects live only in the mission's Known Issues, not in any flight checklist**: `settings.js:150`'s truthy (not nullish) home-page field guard, which will leave a stale value on a `homePage: null` broadcast; and `openSiteSettingsTab()` reusing *any* internal tab, which will hijack a welcome tab. Easy to lose; Flight 2 must claim both explicitly.
- **Test infrastructure**: one non-reproducible failure was seen only when `npm test` ran concurrently with `typecheck`/`lint` in a single batched call; four isolated re-runs were clean and the Developer found no shared temp path, fixed port, or `require.cache` cross-talk in any touched suite. Most likely CPU/IO contention; noted, not chased.

### Documentation

- **The sanctioned route to internal pages under the automation surface is undocumented for spec authors.** `openTab` creates untrusted tabs (internal scheme rejected) and `navigate` refuses `goldfinch://` by design; the working route — `evaluate` on the chrome wcId calling the `kebabActionSettings` seam on `globalThis` — has now been rediscovered by two runs (`bookmarks-jar-scoping`, this flight). It belongs in the project's behavior-test crew file / apparatus notes, with the companion facts: page-context and kebab sheets are non-automatable at every tier and not composited; a tab switch dismisses a stuck sheet, a chrome-targeted Escape does not; `openTab` lands in the last-focused window; the a11y `value` on the Settings home-page textbox is build/state-dependent (absent in one run, present in the next) — judge from rendered pixels.
- **The session-registered goldfinch MCP hazard needs a standing warning.** This machine's Claude Code session carries goldfinch MCP registrations with statically pinned keys, at least one of which points at the operator's production browser. Every crew spawn this flight had to forbid `mcp__goldfinch*` tools by hand. The project crew file should carry that rule so no future Orchestrator has to remember it.
- **Grep-based acceptance criteria are defeated by prose.** Leg 1's `grep -c "require('electron')"` check and its own unit test both false-positived on a comment discussing the pattern; leg 2's duplication test false-positived on unrelated "Google" copy elsewhere in `settings.html`. The fix both times was scoping (comment-strip before the regex; scope the scan to the new region). Worth a line in the methodology's Grep-AC guidance.
- **`AUTHORING.md` should name the differential-against-pre-flight-build** as the standard proof when a first run fails on something that might be pre-existing.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Checkpoint 1 of `search-engine-preference` rerun via the `kebabActionSettings` chrome seam after `openTab`/`navigate` refused `goldfinch://settings` | Both refusals are by design (untrusted tabs; DD6 of the automation surface); the kebab sheet is non-automatable | **Yes** — document the seam as the sanctioned internal-page route in the project's behavior-test crew file |
| Executor re-spawned before step 7 after its transcript could not be resumed | Harness transcript loss | n/a — the skill's error-handling path worked; keep the "brief the replacement with established facts, verify no drift first" shape |
| Checkpoint 6 (context-menu "Search for …") recorded INCONCLUSIVE, later operator-verified by hand | Page-context sheet outside `AUTOMATABLE_MENU_TYPES`; not composited; no OS input tool | **Yes** — premise-audit every widget a spec touches against the allowlist before first run; when a row is structurally unreachable, name the operator check in the spec rather than discover it live |
| Checkpoint 2 of `search-engine-upgrade` FAIL landed as a known issue (squawk 0005) after an Orchestrator differential on the pre-flight build | The spec asserted a premise the flight's own DD4/squawk text had already disproved | **Yes** — differential against the pre-flight build as the standard "regression vs pre-existing" proof; re-author the row |
| Step 8's quit/relaunch performed by the Orchestrator (SIGTERM after confirming the PID owned the scratch `app.db`; key re-minted; crew env file rewritten; topology briefed) | The MCP transport dies with the process; `DEV_MINT` mints a fresh key per boot | **Yes** — this is the `session-restore` procedure, now proven; note it there |
| Leg 1: comment reworded and the unit test comment-strips before its regex | A prose comment containing `require('electron')` false-positived the Grep-AC and the test | **Yes** — Grep-AC guidance: scope scans, strip comments |
| Leg 2: duplication test scoped to the new fieldset, not the whole document | Pre-existing "Google" copy elsewhere in `settings.html` | **Yes** — same lesson |
| `parseAndRepair`'s `migrated` renamed `needsPersist`; corrupt-row path now pins to disk | Leg 1 design review found the corrupt-row branch never persisted its repair | **Yes** — "any load path whose resolved config differs from disk persists it" is now the store's stated rule |
| Three `settings-store` tests renamed (not deleted) with `RENAMED (M16 F1 / DD5 — was '…')` comments | Their pinned claims became false by design | Already standard; reinforced |
| Both specs promoted `draft` → `active` on a `partial` first run, with dispositions | Every product claim the apparatus could observe passed; the two non-passes were an apparatus gap (since operator-closed) and a tracked, deferred, out-of-scope defect | Case-by-case — the disposition must carry its proof (here: the differential and the operator check) |

## Key Learnings

1. **Reading the code beats reading its description.** The flight's best catch (DD4) came from a reviewer tracing `homePageCache`'s actual writers rather than trusting CLAUDE.md. The same flight then authored a spec row on the strength of the description it had just corrected. Premise audits have to include the flight's own prior text and squawks — "what did we ourselves establish yesterday?" — not only the apparatus.
2. **A both-axes apparatus audit is per widget, not per spec.** Auditing the new control thoroughly did not cover the pre-existing control the same spec leaned on. The allowlist is one grep.
3. **"Known issue" landings need a proof, and the proof is cheap.** A worktree at the pre-flight commit plus the same steps settles regression-vs-pre-existing in minutes; without it, "likely regression" would have been the record.
4. **Witnessed runs are resilient to crew loss.** A replacement Executor briefed with the established apparatus facts produced reports the Validator could not distinguish from the original's. The facts brief (wcIds, rects, coordinates, seam route, refusal rules) is the real continuity asset — keep writing it down as the run goes.
5. **Fixture-by-procedure from a worktree is the right shape for upgrade specs** and is fast enough to produce fresh every run; never reuse a stale profile.
6. **Timing in gates is still the recurring omission.** Two flights in a row.

## Recommendations

1. **[Important] Make the spec premise audit whole, and re-author the two broken rows now.** Before any new spec leaves `draft`: enumerate every widget its steps touch against `AUTOMATABLE_MENU_TYPES` and `captureWindow` compositing (act + observe, per widget), and cross-check every empirical Expected Result against the flight's own DD text, mission Known Issues, and open squawks. Concretely for this flight: re-author `search-engine-upgrade` step 2 to pin steady-state new-tab behavior (after a `settings-changed` broadcast) or defer it to a post-squawk-0005 row; re-author `search-engine-preference` step 6 to name the operator check as the row's apparatus (or a driveable alternate path). Both are squawk-sized.
2. **[Important] Flight 2 must explicitly claim five inherited items in its spec**: squawk 0005 (boot-seed `homePageCache` onto the `searchEngineCache` shape and unify), the three `|| HOMEPAGE` sites plus `toUrl`'s `|| 'google'`, `settings.js:150`'s truthy guard, `openSiteSettingsTab()`'s any-internal-tab reuse, and the DD2 note that typecheck is not the null-safety net. All are on record; none is in a checklist that Flight 2's design will read by default.
3. **[Important] Record suite wall-clock beside every pass count in gate entries** (leg completion entries and flight checkpoints), and state the explicit before → after count per leg. M15 F3 asked for this; it recurred.
4. **[Minor] Write the apparatus facts into the project's behavior-test crew file** — the `kebabActionSettings` seam route, the non-automatable sheet types, sheet dismissal by tab switch, `openTab`'s last-focused-window landing, the a11y `value` caveat, and the standing prohibition on session-registered `mcp__goldfinch*` tools (production-browser hazard). Squawk-sized servicing.
5. **[Minor] Resolve squawk 0003 before the next flight that adds a settings key.** DD3 routed around it; the next flight may not be able to.

## Action Items

- [x] Operator-verify the context-menu "Search for …" row (done at this debrief — `duckduckgo.com` tab; recorded in the run log's Operator Notes and checked off in `flight.md`/`mission.md`)
- [ ] Re-author `tests/behavior/search-engine-upgrade.md` step 2 (premise contradicted by squawk 0005) — [squawk 0006](../../../../squawks/0006-search-engine-upgrade-step2-premise.md)
- [ ] Re-author `tests/behavior/search-engine-preference.md` step 6 (context-menu sheet not automatable; name the operator check or a driveable path) — [squawk 0007](../../../../squawks/0007-search-engine-preference-step6-apparatus.md)
- [ ] Add the apparatus facts and the `mcp__goldfinch*` prohibition to `.flightops/agent-crews/behavior-tests-execution.md` — [squawk 0008](../../../../squawks/0008-behavior-test-crew-apparatus-facts.md)
- [ ] Flight 2 design: claim the five inherited items in Recommendation 2 (carry to the Flight 2 spec's Prerequisites / Known Issues)
- [ ] Methodology (mission-control side, for the mission debrief): gate entries carry wall-clock + explicit before → after counts; Grep-AC guidance on prose/comment false positives; `AUTHORING.md` names the per-widget allowlist check and the differential-against-pre-flight-build proof
- [ ] Squawk 0003 — schedule before the next settings-key flight
