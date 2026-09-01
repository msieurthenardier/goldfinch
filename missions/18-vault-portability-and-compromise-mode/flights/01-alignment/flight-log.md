# Flight Log: Alignment — Vault Flows Prototyping

**Flight**: [flight.md](flight.md)
**Mission**: [Vault Portability & Compromise Mode](../../mission.md)

Execution notes, rulings, screenshots, and observations land here during the
session.

## Rulings (binding — compromise-mode flow)

- **R1 (partial OQ2, 2026-09-01): the master-password change is a REQUIRED
  step of compromise mode.** Rationale (operator): in the compromised case
  the password is suspect too — no partial sever. The cryptography already
  forces the step-up to be the master password (or set-new-master from a
  recovery-unlocked session); this ruling makes the new-password entry
  unconditional. Scope note: this is compromise-mode only — the mission's
  adopt-time master sever stays "offered, never forced" (different flow,
  unchanged). Flow shape becomes: entry → confirm → step-up (old master, or
  recovery-unlocked branch) → **set new master** → re-key → completion
  report → recovery→admin one-time chain.

- **R2 (OQ1, 2026-09-01): entry point ruled.** Compromise mode is entered
  from a single visible affordance in Master-key management: a plain row —
  explainer "Think a key or your master password leaked?" — with a
  danger-styled button labeled "Rotate Everything…". No kebab item (the
  prototype's second entry was tried and removed: "cluttered" as a red box;
  the kebab door dropped in favor of one clear entry). The confirm modal is
  the required next step; its structure (lede, short steps list, plain
  jar-keys-revoked consequence line, required understanding-checkbox gating
  a danger-styled Continue) is ruled good; final wording iterating toward
  plain, non-technical language (operator: "too verbose and technical").

- **R3 (OQ2 confirm surface, 2026-09-01): confirm modal ruled final.**
  Title "Rotate everything"; lede "This creates fresh keys for your vault
  and locks out anyone who may have your old ones. Everything you've saved
  is kept."; steps ("What happens next"): enter current master password /
  choose a new master password / save the new recovery key and admin key —
  they're shown once; consequence line "Jar access keys will be revoked.
  You can create new ones afterward."; checkbox "I understand my old keys
  will stop working" gating a danger-styled Continue. Plain-language pass
  ruled good by operator ("modal is good"). Screenshot: operator-held OS
  capture (to be attached at teardown). Step-up composition (the sheet
  half of OQ2) rides increment 2.

- **R4 (2026-09-01): the Rotate Everything entry is visible while the vault
  is locked.** The workflow demands the master password anyway; the step-up
  sheet doubles as unlock on the locked path. Flight 2 must design the
  locked-entry branch deliberately.
- **R5 (2026-09-01): the admin key is REVOKED by compromise mode, not
  re-minted.** No new admin keypair; the manager is left with no admin
  provision, and the operator re-provisions manually afterward (existing
  `rotateAdminKey` is also the from-scratch provision). Consequence: the
  compromise-mode surfacing chain collapses to a SINGLE dismiss-locked
  sheet (the new recovery key). Mission criteria 1 and 3 updated
  accordingly (criterion 1 also reconciled to R1's required master change,
  which had already invalidated its "master password continues to work"
  line).
- **R6 (2026-09-01): total-revocation visibility.** Both the confirm modal
  and the completion report must state that the admin key AND every jar
  access key are revoked and must be manually recreated — the revocation
  list is complete and explicit, not implied.
- **R7 (2026-09-01): the new master password must differ from the old,
  enforced.** Normal branch: compare against the step-up entry at submit.
  Recovery-unlocked branch: detect reuse by test-unwrapping the old master
  envelope with the candidate (an unwrap success IS the old password —
  reject). Flight 2 implementation detail recorded.
- Flight Director call: these fixes span page + chrome + main, which would
  normally trigger the multi-surface design-review pass; skipped out loud —
  that gate exists to catch riders headed for a merge, and this scratch
  branch never merges.

- **R8 (OQ3 aftermath, 2026-09-01): the persistent page card is ruled the
  aftermath surface**, with two fixes: every revocation row reads simply
  "Revoked" (consistent — no per-row instructions; operator, with
  screenshot), and the card renders in the post-flow state regardless of
  the lock state the flow was entered from. Prototype artifact behind the
  second fix recorded for Flight 2: the stub never unlocks the store, so a
  locked-entry run stayed in locked-view where the card didn't render; the
  real flow ends unlocked (fresh MRK installed) — Flight 2 must pin
  "completion card renders post-flow regardless of entry lock state" as an
  acceptance criterion. Evidence: `evidence/completion-card-unlocked.png`.
- **R9 (OQ4 completion & handoff, 2026-09-01): ordering ruled final.**
  Confirm → step-up → new-master (must differ, inline error) → single
  dismiss-locked recovery sheet → ack → persistent completion card.
  Operator: "functionally works" — covering the step-up/new-master sheet
  composition (the sheet half of OQ2) as well.
- **R4 amendment (2026-09-01): entry placement must be consistent between
  lock states** — bottom of the Settings flow in both (unlocked: bottom of
  Master-key management; locked: below the Auto-lock block, not above it).
  Evidence: `evidence/locked-entry-placement.png` (pre-fix placement).

**All four binding rulings (OQ1–OQ4) are landed.** Leg 1 remains in-flight
pending the three R8/R4 fixes, verified live; then leg 2
(restore-mapping-feel-pass) begins.

## Leg Outcomes

- **Leg 1 `compromise-mode-flow-prototype` — completed 2026-09-01.** AC1:
  calibration done via rotate-recovery on the real dev vault ("current
  workflow feels fine"); the optional export→wipe→re-adopt chain walk was
  skipped (acceptable variation — the stub drove the chain instead, and R5
  later removed the chain from this flow anyway). AC2–AC4 met: flow
  clickable end-to-end across two increments and three fix passes; rulings
  R1–R9 recorded; observations logged. Evidence: two operator OS
  screenshots in `evidence/`.
- **Leg 2 `restore-mapping-feel-pass` — completed 2026-09-01.** AC1–AC3
  met over two loops (initial mapping prototype, then the calmed
  merge-default revision — approved, O4). AC2's sheet-moment stand-in
  panel made the decrypt-before-mapping inversion explicit. AC4 teardown:
  `scratch/m18-alignment` deleted (was 763eeb5; tracked changes
  discarded), `goldfinch-dev` profile wiped (next dev session must re-mint
  automation keys), dev app stopped, mission updated (criteria 1/3/5/7 +
  new open question) during the session as rulings landed.

## Teardown Record (CP4, 2026-09-01)

- Prototype source discarded: 12 tracked files restored, branch deleted,
  nothing merged; `main` clean at 763eeb5 + flight artifacts only.
- `goldfinch-dev` profile removed — the standing automation keys' hashes
  went with it; the next dev session mints fresh keys (`DEV_MINT` once,
  then relaunch without).
- The two scratch hash seams (`#proto-complete`, `#proto-restore`) died
  with the branch.

## Observations (non-binding — feeding Flight 2/3 design)

From the restore-mapping feel pass (2026-09-01; prototype: fake bundle →
mapping rows with existing-jar/create-new/skip + Replace-checkbox collision
idiom → per-vault outcome summary):

- **O1 — the browse step must be present.** The prototype elided the file
  pick; the real workflow starts with the existing dialog-bound pick
  (import modal machinery). Operator noticed its absence immediately.
- **O2 — import and restore are ONE experience.** No separate "Restore
  profile" entry: the Import… flow becomes file pick → bundle secret →
  mapping, where a single-vault (v1) bundle is the one-row case of the same
  mapping step. Converges with the ruled decrypt-before-mapping inversion —
  destination moves after the secret universally.
- **O3 — Replace or Merge, per colliding vault.** Overwrite-only is not
  enough: the operator wants a Merge option that keeps existing items and
  imports the bundle's alongside, with an explicit item-level collision
  mechanism. This is new scope — mission criteria 5/7 updated, and
  item-level merge semantics added as an open question for Flight 3 design
  (identity rule, conflict resolution, per-vault merge reporting).
- Mapping-panel mechanics (name-match defaults, create-new-jar inline form,
  per-row resolution gating Restore, per-vault outcome badges) drew no
  objections in the pass; treated as a workable baseline for Flight 3, not
  a ruling.
- **O4 — the revised (calmed) mapping shape approved** (2026-09-01, second
  loop): two-column hairline rows, single "Restore to" header, progressive
  disclosure, amber collision note with **Merge as the non-destructive
  default** and Replace escalating to the confirm checkbox, Merged badge in
  the outcome summary. Operator: "this works." Baseline for Flight 3's
  design, with merge-default as the collision posture to start from.
- **O2 reinforced at wrap (operator, verbatim intent): "important note that
  restore and import should be a single button/workflow."** Flight 3 must
  treat the unified entry as a requirement, not a preference — one button,
  one flow (file pick → bundle secret → mapping), single-vault bundles as
  the one-row case.

## Anomalies

*(none yet)*

## Flight Director Notes

- 2026-09-01 — Flight started via /agentic-workflow. `leg-execution.md`
  phase file validated. Flight status `ready` → `in-flight`. Git state at
  start: `main` clean at 763eeb5, mission-18 artifacts untracked, no
  `scratch/*` or `flight/*` branches.
- **Git deviation from default convention, per DD4**: no `flight/{n}-{slug}`
  branch for this flight. Prototype source lives on `scratch/m18-alignment`
  (never merged, deleted at CP4); artifacts commit on `main`.
- Leg 1 `compromise-mode-flow-prototype` designed as an **interactive
  (alignment) leg** — no autonomous Developer/Reviewer cycle; the Flight
  Director guides the operator step-by-step, spawning Developer agents only
  for prototype stub increments on the scratch branch. Risk tier: **low**
  (throwaway branch, no merge path, no store writes beyond dev profile) —
  per-leg design review skipped; the flight-level Architect review
  (2026-08-31) already validated the anchors and stub seams.
