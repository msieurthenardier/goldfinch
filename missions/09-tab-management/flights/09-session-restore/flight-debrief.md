# Flight Debrief: Session Restore

**Date**: 2026-07-16
**Flight**: [09-session-restore](./flight.md)
**Mission**: [First-Class Tab Management](../../mission.md)
**Status**: landed → **completed**
**Commits**: `0a51a5c` (spec), `da586a8` (implementation), `2cc53a5` (landed) — **PR [#92](https://github.com/msieurthenardier/goldfinch/pull/92)** (stacked on `flight/8`)
**Legs Completed**: 4 of 4

## Outcome Assessment

The flight ships **setting-gated session restore, structurally proven** — and lands with a single,
honestly-flagged exposure: **0% runtime verification of its own headline behavior.** Both are true and
both matter.

The *pure* layer is genuinely proven, both directions, in the unit suite: a new Electron-free
`session-store` (round-trip / never-throws / atomic / member-validation), a `session-snapshot` builder
whose burner exclusion is the mission's absolute constraint pinned against a **disk** artifact for the
first time, a single-sourced `persist-jar-gate`, and a `restore-container` deleted-jar-drop. The *wired*
layer — the two-writer quit capture, the fresh-create restore, default-off byte-identity — is pinned
**only by code-shape source-scans**, because `main.js`/`renderer.js` are executed by zero tests and the
automation apparatus cannot self-relaunch. The DD9 probe returned **NO-GO**, so the live
quit→relaunch→restore cycle is HAT-scoped to F10, with the `session-restore` behavior spec authored and
ready. This is the F8/F5 lesson applied correctly: **no green spec over an unproven cycle.**

### Objectives Achieved

- **Setting-gated restore (default off).** A `restoreSession` toggle (strict-boolean, the
  `automationEnabled` template); off ⇒ startup behaviorally byte-identical (same window, same boot tab,
  no read, no write).
- **A new persistence layer.** `session-store.js` clones `downloads-store.js`'s durability discipline
  (Electron-free `load(userDataPath)`, atomic temp+rename, never-throws, codec seam) with
  `settings-store`'s object schema — one document, wholesale-replaced.
- **Burner exclusion against disk, single-sourced.** `persist-jar-gate.js` `resolvePersistJar` is now
  the one definition of the burner boundary, shared by `session-snapshot.js` and `closed-tab-capture.js`
  (behavior-preserving — the latter's 14 tests re-ran green).
- **Fresh-create restore, never adopt** (DD4), with the deleted-jar entry dropped (not home-substituted).
- **The F8 debts on touched paths:** the move-core structural fix (F8 Rec 5), the `shouldArm` extraction
  with the first unit test of the straight-down (`dx=0`) case, the `CALL_RE` off-by-one, `tab-reorder`
  Step 4 retired.

### Mission Criteria Advanced

- **Criterion 9 (session restore):** **IMPLEMENTED, structurally proven; the LIVE criterion is
  undischarged and HAT-scoped to F10.** The two Contributing-to-Criteria checkboxes remain unchecked in
  the flight spec — correctly, because the observable-across-a-restart behavior is unproven until F10.
- **Criterion 10 (privacy/isolation everywhere tabs move):** the **restore** clause and the **"nothing
  about a burner is ever persisted"** clause are strengthened — the burner exclusion now holds against a
  disk artifact, single-sourced, both-directions unit-pinned.

## What Went Well

- **The two design-review rounds were load-bearing, not ceremony — they killed three feasibility bugs
  before a line of code.** Round 1 caught that `before-quit` reads an **empty** registry on the
  close-last-window path (the per-window `close` destroys tabs first) and that "adopt saved tabs" is the
  wrong primitive at cold start (adopt re-parents a *live* view). Round 2 then caught a bug **round 1's
  own fix introduced** — the "union rewritten each close" rule *shrinks* the snapshot to the last-closed
  window on a 2-window menu-Exit. That the second round caught a hole in the first round's repair is the
  strongest argument for spending the full two-round budget: the first fix of a genuinely hard decision
  (DD3) was still wrong.
- **Two DDs improved via review-driven deviation.** DD2's "verbatim inline predicate" became a *factored*
  `persist-jar-gate` (leg-2 review) — one definition of the security boundary two suites cannot drift on.
  DD8's stated "caption override" preference was *reversed* (leg-1 review) to Fix-2-no-override on the
  decisive finding that `enumerateTabs` reads `entry.active` not `activeTabWcId`, so the alternative would
  have transiently reintroduced F8 HIGH-1's double-active and flaked leg 4's own row 8a. Empowered leg
  review overriding the spec's tentative preference is the system working.
- **The honest source-scan-vs-runtime split is the flight's strongest methodological showing.** Every leg
  log refuses to claim runtime green from a code-shape scan; the wiring test's own header disclaims runtime
  proof; the DD9 NO-GO is recorded with evidence; the commit claims only the measured gates. The AC6
  honesty catch is the sharpest instance — leg-3 review found `load()` must run *unconditionally* (a
  mid-session enable needs `dir` set; an uncaught `before-quit` throw is the F6 hang class), so the "zero
  I/O when off" claim was downgraded to **behavioral** byte-identity rather than papered over.
- **House-idiom fit is faithful and self-verifying.** The new stores clone the Electron-free `load`/atomic
  discipline point-for-point; `persist-jar-gate`'s precedence is correct (`!trusted && find || null`);
  `restore-container` deliberately avoids `inheritContainerFromPartition` (whose default-jar fallback would
  violate the DD4 drop rule).

## What Could Be Improved

### Recon verified its BACKWARD claims and asserted its FORWARD ones — and the forward ones were wrong

The recon classified all six F8-debt items correctly, each anchored on symbol + `file:line`. But it made
**two confident, symbol-anchored assertions about the system's *dynamics* that were both false**, and both
became round-1 HIGH findings:

- *"F9's snapshot must read topology in `before-quit` (fires FIRST)"* — true on menu-Exit, **false** on
  close-last-window. Recon treated a **path-dependent** ordering as universal.
- *"rebuild N windows + **adopt** saved tabs (the adopt path `moveTabIntoWindow` uses)"* — adopt re-parents
  a live view; **there is no source view at cold start.**

Recon also **conflated two pairs of distinct things**: the two quit paths (→ the empty-registry bug), and
the closed-tab (reopen) stack vs. the session-store artifact (→ the DD-Scope clarification the mission's
own open question had bundled).

> **The transferable rule (this flight's portable product): a recon claim about the system's DYNAMICS —
> event ordering, which primitive applies — is a hypothesis to verify by a code trace of the actual
> ordering/primitive, not a fact to anchor on.** Recon's `file:line` discipline gives *backward-looking*
> classification (does this cited gap still exist?) real rigor; it gives *forward-looking* claims a false
> air of the same rigor. This is the F9 analog of F8's *"a read-back is not a second reading unless it is a
> second instrument"* — a plausible self-consistent claim about behavior is not evidence of that behavior.
> The reviews did the verification the recon should have. → Recommendation 2.

### The flight lands "complete" with 0% runtime verification of its headline behavior

The entire *wired* feature — the two-writer terminal-snapshot correctness on both quit paths (the exact
round-2 bug), fresh-create at saved address+jar, active-tab restore, the deleted-jar drop, default-off
byte-identity — is pinned **only by masked source-scans that assert code SHAPE, not behavior.** A scan
confirms "`before-quit` sets a flag and `close` checks it"; it cannot confirm that Electron's real event
ordering produces the correct terminal file. HAT-scoping was the **right** call given the apparatus reality
(the honest alternative — a synthetic in-process test — is either impossible, since the MCP transport dies
with `app.quit()`, or would fake the restart and could pass green over a broken restore). But the residual
is real: **the flight's criterion is undischarged until F10.**

> **This reveals a methodology tension worth naming: a criterion dischargeable ONLY by HAT lets a flight
> land "complete" with that criterion unmet.** The methodology's only answer to "the headline feature is
> unverifiable in this apparatus" is to defer to an out-of-band human step in a *later* flight. → the F10
> live run should be booked as a **hard criterion gate**, not a follow-on nicety (Recommendation 1), and
> the mission debrief should consider whether such a HAT run belongs *in* the landing flight
> (Recommendation 5).

### The main.js/renderer.js module-split debt is now SIX flights unactioned — with a measurable cost

F9 added **+78 to `main.js` (3739→3817)** and **+23 to `renderer.js` (4110→4133)** — all of it the
load-bearing restore wiring, all of it in the two god-files, all of it unexecuted by any test. F8's debrief
flagged F2's module-split watch item as "five flights unactioned"; F9 makes it **six**, and the debt now
has a **second-order cost**: the source-scan suites that must `readFileSync` + `maskComments` these files
are the suite's timing tail — `session-restore-wiring.test.js` is now the **slowest suite at 156ms**,
edging past F8's slowest source-scan. Every wiring feature grows the god-files *and* slows the nets that
mask them. → Recommendation 3 (maintenance-flight material).

### The move-core fix is correct but delicate

Removing the pre-set is a **net −1 code line**, but the diff is almost entirely a large comment rewrite:
the reasoning density of `moveTabIntoWindow` went **up**. The correctness argument (why the core hides +
closes synchronously while the now-armed round-trip re-does both idempotently) lives in a comment block,
not in structure. Future editors inherit a heavily-commented, reasoning-dense function. Honest tax for a
subtle async-lifecycle invariant, but worth flagging: this path is now "correct but delicate."

### Verification

`npm test` **1948 pass / 0 fail / 0 skipped**, 13 suites; **zero flakes across 3 runs**; ~1.22s steady
(1.42s cold). Count reconciles exactly: F8's **1892 → 1948 (+56)** = leg 1 +10 (`shouldArm` ×5 +
`move-core-fix` ×5), leg 2 +27 (`persist-jar-gate` 4 + `session-store` 12 + `session-snapshot` 11), leg 3
+19 (`settings-store` +3, `restore-container` 3, `session-restore-wiring` 13). Timing: the new
`session-restore-wiring` suite (156ms) is the slowest; `session-store`'s tmp-dir fs-I/O is **not** an
outlier (44ms) — the source-scan suites (masking multi-thousand-line files), now four, are the structural
timing cost. `lint` + `typecheck` clean. **`npm run a11y` produced no verdict** ("no automation key … needs
the live GUI") and is **NOT claimed green** (F8 Rec 1) — the settings toggle is a labeled checkbox at a11y
parity with its siblings (static accessibility review `[HANDOFF:confirmed]`).

## Key Learnings

> **1. Recon must verify its forward-design claims (dynamics: event ordering, primitive selection) by a
> code trace, not just its backward classification.** F9's two round-1 HIGH bugs were both false recon
> assertions about behavior that *looked* as rigorous as its (correct) `file:line` debt classification. A
> claim about how the system *behaves* is a hypothesis; anchor it to an ordering/primitive trace or flag it
> unverified. (The F9 analog of F8's second-instrument rule.)

> **2. A criterion dischargeable ONLY by HAT lets a flight land "complete" with the criterion unmet.**
> HAT-scoping is honest when the apparatus genuinely can't verify (here: no self-relaunch), but the
> methodology should then treat the HAT run as a landing gate on the criterion, not a downstream flight —
> otherwise "complete" and "verified" silently diverge.

> **3. The design review is worth its full budget when the decision is genuinely hard: round 2 caught the
> bug round 1's own fix introduced.** DD3 took two rewrites to get right; a one-round cap would have shipped
> the union-write-shrink bug.

> **4. Review-driven deviation is the system working, not spec failure.** DD2 (factor the predicate) and
> DD8 (drop the caption override) both improved on the written decision at leg review — the empowered leg
> review overriding a tentative spec preference is exactly its purpose.

## Recommendations

1. **Book the F10 live `session-restore` run as a HARD criterion gate** (not a follow-on). It must include:
   the **2-window menu-Exit** guard (the exact round-2 bug — assert both windows return); the
   **deleted-jar-drop asserting WINDOW COUNT** (latent risk: a window whose *every* saved tab was in a
   since-deleted jar is created by main, then emptied by the renderer drop → a **tabless window** on
   screen); **burner positively absent** (count exactly 2); **default-off** (nothing restored); plus
   `tab-tearoff` **row 8a** + the displaced-menu residual, and the **real a11y verdict**.
2. **Recon must verify forward-design (dynamics) claims by code trace before anchoring on them** — the
   cheap catch F9 missed. A "fires first" / "this primitive applies" claim gets an ordering/primitive trace
   or a `needs-verification` flag, never the same `file:line` confidence as a backward classification.
3. **Act on the `main.js`/`renderer.js` module split (six flights unactioned, now with a measurable
   timing cost).** The source-scan nets that mask these god-files are the suite's slow tail and grow with
   every wiring feature. Maintenance-flight material — extract the restore/quit-capture wiring and the
   renderer boot loop into testable seams.
4. **`persist-jar-gate.resolvePersistJar` is the canonical burner-boundary predicate — future
   burner-touching features REUSE it, never re-inline.** The leg-2 factoring is defeated if a third caller
   copies the predicate.
5. **Mission-debrief question: should a criterion dischargeable only by HAT be gated *inside* its landing
   flight** (a HAT leg) rather than deferred to a downstream HAT flight? F9 is the clean case study —
   session restore is unobservable without a restart the apparatus can't drive.

## Action Items

- [ ] **F10 (hard criterion gate):** run `session-restore` live — 2-window menu-Exit guard, deleted-jar
      drop **asserting window count**, burner-absent, default-off; then `tab-tearoff` row 8a + residual +
      the clean re-run it owes; the real `npm run a11y` verdict; `tab-reorder` Step 4 vs. a second instrument.
- [ ] **F10 verification checklist (the 6 latent risks):** (1) deleted-all-jars → tabless window; (2)
      mid-session close over-includes closing window (crash-only, documented); (3) `write()` fs-error →
      **silent** session loss (exercise a read-only userData); (4) two-writer terminal-snapshot correct on
      both quit orderings (the highest-value check); (5) manifest sync-stash ordering coupling (any future
      async refactor races the boot invoke); (6) active-tab restore degrades when the saved active tab was a
      filtered burner (arguably correct; don't file as a defect).
- [ ] **Maintenance:** the `main.js`/`renderer.js` module split — six flights unactioned, now the timing
      tail. Schedule before the god-files grow further.
- [ ] **Note for future editors:** `moveTabIntoWindow` is "correct but delicate" — the async-lifecycle
      invariant lives in a comment block; edit with the two-writer/interim-single-active reasoning in hand.
- [ ] **Mission-debrief carries:** the recon-forward-verification lesson (learning #1); the
      HAT-as-landing-gate methodology question (learning #2, Rec 5); `persist-jar-gate` as the canonical
      burner predicate; the module-split debt at six flights with a measured cost.
