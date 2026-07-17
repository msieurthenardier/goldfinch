# Flight: HAT & Alignment

**Status**: in-flight
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

This flight is the mission's closing gate — it walks **every** mission behavior test with the
operator on the live rig and discharges the criteria that prior flights could only prove
structurally. It contributes to **all ten** success criteria by turning "implemented + structurally
pinned" into "operator-witnessed on the real app," and it settles the mission's remaining open
question (cross-window drag transport) with a measured GO/NO-GO.

---

## Pre-Flight

### Objective

An **operator-guided** human acceptance test: the Flight Director presents each verification step,
the operator performs it on their **own live rig**, reports results, and the FD fixes issues inline
(look-and-feel) or promotes them to a scoped review (features) until the operator is satisfied and the
mission is aligned. **This flight is not autonomous** — the mission's standing autonomous
authorization ran *through F9*; F10 is the operator's engagement point. The FD cannot run these tests:
they need the goldfinch admin MCP + a running `dev:automation` GUI + an admin key, none of which live
in the FD's session (F9's DD9 probe confirmed the NO-GO).

### Prerequisites (operator-provided — the gating fact of this flight)

- [ ] The live rig is up: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
      (Wayland). **Bind-probe for a free port** — `ss -ltn` cannot see WSL2 ports held by Windows-side
      listeners; a live sibling Goldfinch may hold the default profile's port (leave it untouched).
- [ ] The admin MCP key is captured from the launch's `AUTOMATION_DEV_MINT` line and available **by
      env-var reference ONLY, never a command literal** (standing carry — an F6 executor leaked one).
- [ ] For the E2E restore station: the **out-of-band relaunch harness** (drive a clean quit via the
      `windowClose` bridge, relaunch the same `dev:automation` against the **same userData profile**,
      reconnect the admin client).

### The HAT protocol (how each station runs)

- The FD presents **one** step; the operator performs it and reports raw results; the FD renders a
  verdict with the operator, then advances. Behavior tests run via `/behavior-test <slug>` (the FD
  orchestrates the Executor + Validator; the operator supplies the rig + confirms preconditions).
- **Fix-vs-feature gate (the FD's call, made out loud):** a mid-HAT operator request that adds *new
  behavior* (a FEATURE) is promoted to a scoped design review before implementation; only look-and-feel
  *FIXES* ride the inline protocol. **Multi-surface trigger:** even a "cosmetic" fix spanning more than
  one page/surface gets a lightweight design-review pass first (two missions of data show multi-surface
  cosmetic fixes carry riders).
- Every fix lands in a **new commit** (no amend); the fixed step is re-verified before advancing.
- Evidence is ephemeral (never committed); each run files a committed run log at
  `tests/behavior/<slug>/runs/<ts>.md`.

### Stations (the walkthrough — ordered by leverage, refined with the operator)

**Station A — F9 Session Restore (the hard criterion gate).** Run `session-restore` live. Assert the
RIGHT observables (F8 product #2): exact restored set with correct jarIds, **burner POSITIVELY ABSENT**
(count exactly 2), saved active tab active; the **2-window menu-Exit** guard (both windows return — the
exact DD3 round-2 bug); **default-off** (nothing restored); the **deleted-jar-drop variant asserting
WINDOW COUNT** (a window whose every saved tab was in a since-deleted jar must not restore as a *tabless
window* — F9 Developer latent-risk #1). Plus the F9 debrief's other latent risks: write-failure silent
session loss (read-only userData), mid-session-close staleness, active-tab-was-a-filtered-burner.

**Station B — F8 tear-off owed debts.** `tab-tearoff` **row 8a** (the `{T1:true, T2:false}` pair from
one `enumerateTabs` — the unrun HIGH-1 net) + the **displaced-menu residual**, and the **clean re-run**
`tab-tearoff` already owes (it filed `partial`). This is the live reading of F9 leg 1's move-core fix.

**Station C — Cross-window drag transport (the mission's last open question).** The **HTML5-drag
candidate-2 spike** — the only transport that needs no app-level coordinate (the browser owns it),
foreclosed by omission at F8 and **never measured**. It must (a) use a **second instrument** for any
coordinate it reads, and (b) report a **GO/NO-GO verdict**. **A NO-GO is a real outcome** that retires
criterion 8 honestly. Also measure the **DD7 blur-conditioning gap** (F7 called it an accepted permanent
gap; F8's V7 refuted that — WSLg *does* deliver OS blur to a real stimulus).

**Station D — Core tab-management regression walk.** `responsive-tab-strip`, `tab-reorder` (minus the
retired Step 4), `tab-keyboard-operability`, `tab-cycling`, `closed-tab-reopen`, `tab-context-menu`,
`multi-window-shell`, `multi-window-automation` — the mission's own contract specs, walked green on the
current tree.

**Station E — The DD12 re-pointed specs + the real a11y verdict.** The specs re-pointed at F7 with **no
post-F7 run** (`closed-tab-reopen`, `find-overlay-geometry`, `foreground-to-act`, `internal-tab-menus`,
`kebab-menu`, `menu-dismissal`, `menu-overlay`, `omnibox-suggestions`, `page-context-menu`,
`popup-jar-inheritance`, `tab-cycling`) — walk each, promoting `draft`→`active` on a clean run. Run the
**real `npm run a11y`** with the admin key (F9's toggle is statically a11y-clean but the gate never ran).

**Station F — Artifact hygiene + retirements.** The **stale-header scrub** (DD12: the true drift is
**28 of 48**, not the 11 F8 measured at its instrument's boundary — a grep for `never` cannot find a
*missing* header). The `getAttachedWindow`/`crossWindow` retirement (DD13, unblocked by F8's V7).
`tab-reorder` Step 4's no-window-move check against a **second instrument** (retired to HAT at F9).

### Legs

> Legs are the HAT stations above, run one at a time; each surfaced fix becomes an inline fix (look-and-feel)
> or a scoped fix leg (feature/multi-surface). This list firms up with the operator at kickoff.

- [ ] `hat-station-a-session-restore` *(the F9 criterion gate)*
- [ ] `hat-station-b-tearoff-debts`
- [ ] `hat-station-c-crosswindow-drag-spike` *(GO/NO-GO; may retire criterion 8)*
- [ ] `hat-station-d-core-regression-walk`
- [ ] `hat-station-e-repointed-specs-and-a11y`
- [ ] `hat-station-f-artifact-hygiene`
- [ ] `alignment` — iterative fixes until the operator is satisfied

**Takeaway implementation legs** (from the HAT walk; operator: build all five on F10, then one verification pass):

- [x] `01-strip-visual-polish` — T1 hover highlight + T2 active-tab favicon shrink floor (CSS). LOW-MED.
- [x] `02-keyboard-cycling-rearm` — T3 Ctrl+# stuck from page focus (conditional guest re-focus). HIGH (bug).
- [x] `03-sole-tab-move-close-source` — T4 sole-tab move-to-window + close empty source. HIGH (feature).
- [x] `04-tearoff-drag-feedback` — T5 in-drag ghost/hint (window-local, layout-neutral). MED.
- [→] `05-crosswindow-drag-html5` — T6 cross-window drag via HTML5 DnD (criterion 8). **MOVED TO ITS OWN
      FLIGHT F11** (operator decision): design review found it unsatisfiable as an F10 co-leg (static
      `draggable` kills the pointer reorder; needs a spike + likely a drag-layer rewrite). Built after F10.

---

## Post-Flight

### Completion Checklist

- [ ] Every mission behavior test walked with the operator; run logs filed
- [ ] The session-restore criterion witnessed live (or issues fixed until it is)
- [ ] Cross-window drag transport settled with a measured GO/NO-GO (criterion 8 satisfied or retired)
- [ ] The real `npm run a11y` verdict recorded
- [ ] Operator confirms alignment — the mission outcome feels right in daily use
- [ ] Mission ready for `/mission-debrief`

### Verification

The operator's sign-off IS the verification. Each station's behavior-test run log is the evidence of
record; the alignment leg closes when the operator says the tab-management experience matches a
mainstream browser without giving up the jar/burner model.
