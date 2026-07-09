# Flight Debrief: Cross-View Keyboard Bridge & Admin-Wired Parity Sweep

**Date**: 2026-07-08
**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](flight.md)
**Status**: landed
**Duration**: 2026-07-07 (plan) → 2026-07-08 (landed + merged to `mission/05`)
**Legs Completed**: 6 of 6 (+ the DD4 Witnessed net run during this debrief)

## Outcome Assessment

### Objectives Achieved
The flight delivered both halves of its scope and certified them:
- **Cross-view keyboard bridge (the one code deliverable).** All three chrome↔guest gaps closed — Ctrl+L
  revived from a focused guest (typeable via the OS-focus handoff, not just DOM-focused), Tab guest→chrome
  handoff, chrome Tab-order wrap (Chromium-native — no code). Resolves the F8-HAT mission Known Issue.
  **Formally certified**: the `chrome-guest-keyboard-nav` Witnessed run (2026-07-08-21-06-32) PASSed 6/6 with
  an independent Validator confirming every step from persisted evidence — including internal-tab Ctrl+L, the
  path FD verification could not reach.
- **Admin-wired behavior-test corpus sweep.** 22 specs across security/gating, MCP automation, and
  conveniences, each Executor-driven with an independent Validator judging the evidence.

### Mission Criteria Advanced
- **SC6 (automation parity, no drift)** — met on the native surface (Leg 4).
- **SC4 (conveniences parity, *formal* net)** — met: convenience corpus + `npm run a11y` green (Legs 5–6),
  closing the Flight-4 HAT-only acceptance.
- **SC5 (privacy & trust, part)** — met: internal-session exclusion, jar scoping, farbling, scheme guard all
  re-verified live (Leg 3).
- **Mission Known Issue (keyboard bridging)** — resolved and Witnessed-certified.

All checkpoints met. Two of the corpus's scariest findings triaged to **non-regressions** (below).

## What Went Well

- **The apparatus-wiring litmus (DD2) earned its keep decisively.** It caught the port problem *before* any
  corpus effort and disambiguated a reserved-port `EADDRINUSE` from the F4 foreign-instance wiring blocker it
  superficially resembled. Seconds of cost; a whole corpus that never ran against a mis-bound client.
- **Scoped restraint on the keyboard fix (DD3) paid off twice.** Narrowing to the named gaps avoided seizing
  the guest's native Ctrl+R reload (an ownership change that would have been a real regression); and the
  Tab-wrap "no code" call was vindicated live (26 controls, wraps at press 26, zero `<body>` stranding) —
  no speculative document-level handler shipped against the dynamic chrome's roving-tabindex tab strip.
- **The driver≠judge corpus model held the Witnessed discipline at scale — and caught two false alarms.** Both
  the DD9 key-gating "FAIL" (dev-vs-prod profile mismatch) and the internal-session-exclusion "breach" (admin's
  documented `allowInternal` relaxation, driven with the admin key) were observation-setup artifacts, not
  product regressions — surfaced and killed by independent triage, not accepted on the Executor's say-so.
- **Reconnaissance was accurate.** No spec needed a functional `<webview>` rewrite (recon predicted it: zero
  `sendToHost` hits; corpus drives by `wcId`).
- **Positive architectural retirement.** The first-ever runs of `tab-surface-geometry` + `internal-tab-menus`
  confirmed the F3 freeze-frame/occlusion regression class is netted on the native surface.
- **Pure-mapper + contained-wiring code.** `cross-view-nav.js` (dual-export, unit-tested with a negative
  regression guard proving existing accelerators return `null`) + one `if(...)return;` at the top of the
  web-guest handler (existing branches byte-for-byte untouched) + a separate minimal internal-guest handler.

## What Could Be Improved

### Process
- **The DD4 Witnessed net was deferred out of existence — and only closed during this debrief.** The flight's
  designated regression net (`chrome-guest-keyboard-nav`, two-agent Witnessed) was repeatedly deferred to "the
  corpus phase," but the corpus phase completed running the *other* specs without ever running it; the flight
  landed on an FD-driven pass instead. The Developer debrief caught this; it was then run (PASS 6/6, Validator
  CONFIRMED) and committed. **Lesson:** when a leg's acceptance names a Witnessed run, run it *in that leg* —
  don't defer to an unscheduled "phase."
- **Evidence hygiene was adopted mid-flight, not from the start.** Leg 3 Executors self-witnessed and recorded
  refusals as prose; the raw-`isError`-payload-per-assertion rule was added only from Leg 4. It should be the
  default for any apparatus-gated corpus from leg 1.
- **Two false-alarm triage cycles were avoidable with runbook hygiene.** Pinning the dev profile
  (`~/.config/goldfinch-dev`) and pre-documenting admin's two relaxations (all-jars + internal) in the Executor
  runbook would have prevented both the DD9 and internal-exclusion mis-flags.

### Technical
- **`nav.js` internal-guard asymmetry (pre-existing — the one genuine hardening item).** `zoom.js`/`find.js`/
  `print.js`/`observe.js` each carry an op-local `isInternalContents` refusal that fires *even for admin*;
  `nav.js` does not, so an admin key can `navigate`/`reload` the internal `goldfinch://settings` partition,
  loading web content into it (script injection stays blocked). NOT migration-caused (`nav.js` unchanged this
  mission), bounded blast radius, admin-only — but a defensible-consistency gap worth closing.
- **Test-metric baseline was stale.** The leg/flight cited "947/947" (copied from the F4 debrief); the real
  branch head was ~1050 because F7/F8/F9 had already merged into `mission/05` before F5 ran (F5 is numbered 05
  but executed last). Harmless (all green) but "delta from baseline" understated the true count by ~103.

### Documentation
- **Page-context Escape target is double-sourced.** The corpus observed Escape→`#kebab`; Leg 6 aligned the
  *spec* but left CLAUDE.md's page-context prose saying "else the address bar" — pick one source of truth.
- **`mcp-drive-end-to-end.md` Preconditions are half-consistent** — Leg 6 fixed the Step-9 `captureWindow`
  admin-only parenthetical but left the Preconditions framing the whole run as jar-driven.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Default MCP port 49707 → 8899 | 49707 is Hyper-V-reserved on this WSL2 rig (`bind`→EADDRINUSE while `ss` shows free) | Yes — pin a non-reserved `GOLDFINCH_MCP_PORT` in the corpus runbook |
| Evidence hygiene (raw payloads) adopted after Leg 3 | Leg-3 Validator flagged prose-only self-witnessed evidence | Yes — make raw-payload-per-assertion the default from leg 1 |
| DD4 Witnessed net deferred, then run in the debrief | FD deferred to an "unscheduled corpus phase" that completed without it | The anti-pattern: NO. Standardize the fix: run a leg's named Witnessed net in that leg |
| Keyboard Tab-wrap: no code shipped | Chromium wraps natively in the standalone chrome document (verified live) | Yes — verify-before-adding restraint on speculative focus handlers |
| DD1 F5/F6 boundary rationale corrected mid-planning | First draft wrongly said "only F5 needs the apparatus"; F6's corpus needs it too | Yes — don't assume any flight is apparatus-light |

## Key Learnings
- **The apparatus has three axes — act, observe, and *wiring*.** The litmus gate on the wiring axis is cheap
  insurance and it repeatedly earns its cost; promote it to a standing pre-corpus rule.
- **The scariest findings were observation-setup artifacts, not product bugs.** A wrong-profile comparison and
  an admin-key-vs-jar-key confusion both read as "security regressions." The driver≠judge separation (an
  independent agent judging raw evidence + source) is exactly what distinguished false alarm from real defect.
- **WSLg is not the authoritative venue for compositing/CDP/paint-sensitive checks** — CDP-conflict, find
  new-search count, focus-ring pixels, spellcheck squiggle/dictionary are all macOS-authoritative (DD8).
- **Pure-mapper + contained-wiring** is the codebase idiom for cross-view keyboard/focus routing (now cemented
  in CLAUDE.md with the focus-then-send rule + `isWebTab()`/`isInternalTab()`).

## Recommendations
1. **Close the two never-witnessed positives in F6/macOS** where the apparatus doesn't block them: the DD9
   mint-gate OFF-branch (persisted-false ⇒ mint DISABLED, against a fresh/prod profile), and the keyboard-bridge
   macOS HAT (cross-view Tab + Ctrl+L from guest, web *and* internal tabs).
2. **Live two-agent Witnessed re-run of the two BLOCKING security specs** (`internal-session-exclusion`,
   `mcp-jar-scoping`) under the upgraded raw-payload hygiene — belt-and-suspenders; no defect suspected, the
   Leg-3 offline validation + source cross-check already stand.
3. **Harden `nav.js`** with an op-local `isInternalContents` guard on its mutating ops (at minimum `navigate`)
   to match zoom/find/print — closes the pre-existing admin-navigate-internal asymmetry. F6 or end-of-mission
   maintenance; small and self-contained.
4. **Standardize the corpus model** for any apparatus-gated sweep: the wiring litmus as a mandatory pre-corpus
   gate; Executor→independent-Validator with raw-payload evidence from leg 1; and a pinned runbook carrying the
   proven gotchas — port `8899`, profile `~/.config/goldfinch-dev`, no double-`unwrap`, `evaluate` arg is
   `expression`, wait for non-empty `enumerateTabs`, `openTab` is http(s)-only (internal tabs via the chrome UI).
5. **F6 planning:** don't assume it's apparatus-light (DD1 correction); carry every WSLg venue limit to the
   macOS gate; pre-document admin's two relaxations so an Executor doesn't re-flag `allowInternal` as a breach.

## Action Items
- [ ] **F6/macOS gate:** keyboard-bridge HAT (cross-view Tab + Ctrl+L, web *and* internal); DD9 mint-gate
  OFF-branch positive-witness; CDP-conflict + observe-refusal CDP arm; find new-search count; focus-ring /
  spellcheck squiggle / dictionary paint; F10/ContextMenu key (HAT-only).
- [ ] **Live two-agent Witnessed re-run** of `internal-session-exclusion` + `mcp-jar-scoping` under raw-payload hygiene.
- [ ] **Harden `nav.js`** — op-local `isInternalContents` guard on mutating ops (pre-existing; F6 or maintenance).
- [ ] **Reconcile docs:** page-context Escape target (CLAUDE.md vs `page-context-menu.md`); finish
  `mcp-drive-end-to-end.md` Preconditions (admin key for Step 9).
- [ ] **Keep the `<webview>`→WebContentsView terminology sweep on the mission known-issue list** (parked for
  F6/maintenance; prose-only, zero functional dependency — must not silently drop off).
- [ ] **Retire the "947 baseline" convention** for out-of-order flights — measure the branch head at flight start.

## Test Metrics (this debrief, fresh run)
- `npm test`: **1060/1060 pass**, 0 fail, 0 skipped, no flakes; **~5.05 s** wall, 12 suites. `npm run typecheck`
  clean (~1.6 s); `npm run lint` clean (~1.25 s).
- **Delta:** F3 951/951 → F4 947/947 → F5 1060/1060. F5's own code added **10** (`cross-view-nav` unit tests);
  the other ~103 arrived via F7/F8/F9 already merged into `mission/05` before F5 executed (see the stale-baseline
  note above — true pre-F5 branch head was ~1050, not 947).
