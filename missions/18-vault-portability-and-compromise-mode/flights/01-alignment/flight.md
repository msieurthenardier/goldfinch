# Flight: Alignment — Vault Flows Prototyping

**Status**: landed
**Mission**: [Vault Portability & Compromise Mode](../../mission.md)

## Contributing to Criteria

This flight completes no mission criterion directly; it de-risks the design of
four before their implementing flights are specced:

- [ ] Full sever, one action — *flow shape: entry point, confirm/step-up feel,
      revoked-key aftermath, completion report* (binding rulings exit here)
- [ ] Compromise-mode surfacing chain — *how the chain feels stacked after the
      step-up and commit* (observed live)
- [ ] One restore workflow, explicit mapping — *feel pass only; decisions
      deferred to Flight 3 design* (operator ruling, this flight's interview)
- [ ] Master severing offered, never forced — *observed in the adopt-flow
      prototype; placement ruling deferred to Flight 3 design*

---

## Pre-Flight

### Objective

An interactive operator-and-agent session that prototypes the mission's two
new user-facing flows in the **live app on a throwaway branch** — real vault
page, real sheet system, stubbed data and IPC where the machinery doesn't
exist yet — so flow-feel judgments are made against the real idioms rather
than imagined ones. The session must exit with the **compromise-mode flow
ruled** (the four sub-decisions below); everything else it surfaces is
recorded as non-binding observations feeding Flight 2/3 design.

### Open Questions

To be resolved live, in-session (these are the binding exit deliverables):

- [x] **Compromise-mode entry point** — the master-key management kebab is
      the presumed home (`vault.js` `buildMasterKeySection`); confirm, and
      decide the action's name and framing.
- [x] **Confirm/step-up feel** — what the destructive confirmation says
      (what breaks, what survives, what to have ready), and how it composes
      with the master-password step-up sheet (or set-new-master branch from
      a recovery-unlocked session).
- [x] **Revoked-key aftermath surface** — where the operator learns which
      jars carried revoked automation access keys and how re-minting is
      directed from there.
- [x] **Completion report shape** — what the post-commit surface shows
      (jars re-keyed, keys revoked, new one-time secrets ahead) and how it
      hands off into the recovery → admin surfacing chain.

Observed but **not** ruled here (deferred to the owning flight's design, per
operator ruling at flight planning):

- Mapping modal layout details, collision/rerun presentation, per-vault
  outcome display (Flight 3)
- Held-key cancellation/idle-lock/window-close semantics (Flight 3, with
  Flight 2's suppression machinery in view)
- Sever-offer transient-vs-persistent placement (Flight 3)

### Design Decisions

**DD1 — Medium: live app, throwaway branch, real dev vault.** Prototypes
are built in the real `goldfinch://vault` page and chrome sheet system on a
scratch branch. The session runs on the isolated dev profile
(`npm run dev:automation` → `goldfinch-dev` userData) with a **real vault
and a known password**, so the step-up sheet and the existing rotate/adopt
chains work for free — real machinery, throwaway data. Stubs are needed
only for what doesn't exist yet: the compromise-mode kebab action, confirm
surface, completion report, and a scratch main-side trigger driving the
recovery→admin chain with fake keys (the chain itself never touches the
vault store except autolock suppression — design-review verified,
`register-overlay-ipc.js:118-133`). Rationale: flow feel against real
idioms is the point; static mocks under-represent the transitions this
mission's risks live in. Trade-off: prototype effort discarded by design.

**DD2 — Disposition: discard the branch, keep the rulings.** At session end
the scratch branch is deleted; deliverables are the ruled decisions and
annotated screenshots in the flight log, folded into the mission's open
questions and Flight 2/3 specs. The prototype branch is **never merged** and
no source change from this flight reaches `main`. Rationale: implementation
flights build clean against real IPC; stubbed idioms must not leak.

**DD3 — Binding scope: compromise-mode flow only.** Only the four
compromise-mode sub-decisions are binding exit deliverables. The restore
mapping and sever-offer prototypes are feel passes producing observations,
not rulings — "once the prototyping is done, the rest is technical decisions
that can be made in the flights" (operator, flight planning 2026-08-31).

**DD4 — Prototype naming and artifact separation.** The scratch branch is
named `scratch/m18-alignment` — deliberately outside the `flight/{n}-{slug}`
convention so no artifact or tooling treats it as a merge candidate. The
scratch branch holds **prototype source only**: artifact updates (spec,
log, screenshots, mission open-question updates) are committed on `main`
(or held uncommitted until teardown), never on the scratch branch — CP4's
branch deletion must not be able to destroy the flight's deliverables.

**DD5 — Sheet-state evidence mechanism.** The secret-sheet capture gate
blocks the MCP apparatus from imaging any `vault-*` sheet (`captureWindow`
silently omits the sheet layer for non-allowlisted menuTypes;
`captureScreenshot`/`readDom` refuse outright). Default mechanism:
**operator-taken OS screenshots** for every sheet-state ruling; MCP
captures serve page-surface states only. Widening the allowlist with
scratch-branch `proto-*` menuTypes is available **only by explicit operator
ruling in-session** (the mission's never-widen constraint governs; a
scratch-only widening dies with the branch but is still the operator's
call, not the agent's).

### Prerequisites

- [x] Dev app launches and reaches `goldfinch://vault` (standing dev
      environment); a dev vault set up on the `goldfinch-dev` profile with
      a known password (DD1)
- [x] Operator present for the session (this flight is the session)
- [x] Mission 18 rulings in hand: mapping lives on the vault page; step-up
      is the master password; bundle metadata encrypted (constrains what
      the mapping prototype may pretend to show pre-unlock)
- [x] `goldfinch-development` MCP attached at **admin tier**
      (`GOLDFINCH_AUTOMATION_ADMIN`) — internal-page capture and
      `captureWindow` are admin-only; a non-admin attach cannot image the
      vault page at all. Mint keys **once**, then relaunch **without**
      `DEV_MINT` for the session's many restarts — a `DEV_MINT` relaunch
      rotates the automation keys and 401s the standing config (squawks
      0054/0055)
- [x] Sheet-state evidence mechanism acknowledged by the operator (DD5:
      OS screenshots by default)

### Pre-Flight Checklist

- [x] All open questions carried into the session agenda (they resolve
      in-session by design)
- [x] Design decisions documented (DD1–DD4)
- [x] Prerequisites verified at session start
- [x] Validation approach defined (see Verification)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Work happens pair-style on `scratch/m18-alignment`. The agent builds thin,
stubbed slices — a fake compromise-mode action wired from the master-key
kebab through a confirm surface and step-up sheet into a stubbed completion
report and the existing recovery/admin one-time sheet chain (driven with
fake keys); a fake multi-vault restore returning stubbed decrypted jar
labels into a page-modal mapping table — and the operator clicks through,
reacts, and redirects. Iterate in small loops; capture each ruled decision
in the flight log as it lands, with a screenshot.

Existing surfaces to build against (verified at planning and design
review): the master-key kebab (`vault.js:1066` `buildMasterKeySection`),
the import modal and its fresh-profile mode (`vault.js:644`
`openImportModal`), the vault-import-unlock sheet handoff
(`register-overlay-ipc.js:295`), the F4 sequential recovery→admin sheet
chain (`register-overlay-ipc.js:118-133` stash-then-chain, stash store in
`main.js:839-855`), the step-up sheet's `lede` re-label seam
(`vault-stepup-template.js` — copy iteration without new templates), and
the jar-create name+color form (`jars-create-controller.js`) for the
inline new-jar row.

Session structure follows the iteration-cost asymmetry: page-side surfaces
(`vault.js` modals) iterate by tab reload — cheap, so wording-heavy loops
live there; chrome-owned sheet wiring and main-side stubs need an app
relaunch, so those changes are batched. Calibrate first at zero prototype
cost: run the real rotate-recovery and fresh-adopt flows on the dev vault
to feel the step-up and chain before building the compromise-mode stubs.
Resolve the confirm-surface and completion-report **page-vs-sheet**
question early in the session — it determines both capturability (DD5) and
which iteration loop the remaining work lives in.

### Checkpoints

- [x] CP1: Compromise-mode flow prototype clickable end-to-end (entry →
      confirm → step-up → completion report → surfacing chain, all stubbed)
- [x] CP2: The four binding rulings recorded in the flight log with
      screenshots
- [x] CP3: Restore-mapping feel pass done; observations (non-binding)
      recorded for Flight 3
- [x] CP4: Scratch branch deleted; `goldfinch-dev` profile wiped; mission
      open questions updated with the rulings (runs regardless of skipped
      legs)

### Adaptation Criteria

**Divert if**:
- Prototyping contradicts a mission-level ruling (e.g., the page-modal home
  proves unworkable for the mapping step, or the step-up composition can't
  reuse the existing sheet chain) — that goes back to the mission, not into
  an in-session workaround.

**Acceptable variations**:
- Reordering the two prototype passes; skipping the restore feel pass if
  the compromise-mode work consumes the session (it is the binding half);
  additional observations beyond the agenda are welcome in the log.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are
> planned and created one at a time as the flight progresses. This list will
> evolve based on discoveries during implementation.

- [x] `compromise-mode-flow-prototype` - Build and iterate the stubbed
      compromise-mode flow with the operator; exit with the four binding
      rulings recorded (CP1, CP2)
- [x] `restore-mapping-feel-pass` - Stubbed multi-vault restore mapping
      modal in the page idiom; observations recorded, no rulings (CP3)

**Teardown (CP4) runs regardless of which legs run**, as the closing step
of whichever leg is last: delete `scratch/m18-alignment`, wipe the
`goldfinch-dev` profile (fake vault + rotated key hashes — avoids a
stale-key 401 surprise next session), update mission open questions.

No HAT leg — the entire flight is an interactive session with the operator.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] No code merged (verify: `main` and the artifact flow contain no
      prototype source changes; `scratch/m18-alignment` deleted)
- [x] Tests passing (unchanged — this flight ships no code)
- [x] Documentation updated (mission open questions reflect the rulings)

### Verification

The flight is verified by its artifacts, not by code: the flight log
contains the four compromise-mode rulings, each with rationale and a
screenshot of the prototype state that was approved; the restore-mapping
observations are recorded for Flight 3's design phase; the mission's open
questions are updated; the scratch branch no longer exists. No behavior
tests — nothing this flight produces persists to be regression-tested.
