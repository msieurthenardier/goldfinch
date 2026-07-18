# Flight: HAT & Alignment

**Status**: in-flight
**Mission**: [Persistence Consolidation](../../mission.md)

## Contributing to Criteria

- [ ] Operator review of the full mission implementation (all 8 mission
      criteria walked live), with outstanding issues addressed via
      iterative fix legs until aligned.

---

## Pre-Flight

### Objective

The operator-guided close of Mission 10: walk the implementation on the
operator's real rig, discharge every HAT-scoped carry accumulated across
F1-F2, apply fix riders for the outstanding issues the debriefs queued,
and iterate until the operator is aligned. This flight is INTERACTIVE —
the Flight Director guides; the operator performs and judges; fixes ride
the in-HAT protocol (fix-vs-feature gate; multi-surface fixes get a
lightweight design-review pass first).

### The accumulated HAT scope (single actionable checklist)

**Station A — Branch & release hygiene**
- [ ] Promote PR #96 (F1, draft) → ready; review; merge to main.
- [ ] Re-base/promote PR #98 (F2, stacked on the F1 branch) → ready;
      review; merge. (Stacked order: #96 first.)

**Station B — Security carries**
- [ ] **Rotate the automation keys**: the FD leaked the registered
      jar-scoped bearer key into its session transcript (F1 leg 3);
      re-mint (fresh launch mints new keys; old key's hash removed from
      settings if the store keeps multiple), update the `.mcp.json`
      registration with the new key, verify the old key refuses.
- [ ] Confirm no key material sits in any committed artifact (grep was
      clean at both flight-end reviews; operator spot-check).

**Station C — Fix riders (small, queued by the debriefs)**
- [ ] `retention-sweep.js` NUL-delimiter fix (literal NULs make the file
      binary to git — switch to a printable delimiter or `\0`-escape;
      confirm `git diff` renders line-level afterward; unit suite green).
      *(Code change → Developer spawn, look-and-feel-class fix.)*
- [ ] Optional, operator's call: `jar-ipc.test.js` shared-fixture
      conversion (twice-earned recommendation; can also defer to
      maintenance).

**Station D — Live witnesses the mission owes**
- [ ] **Real-profile migration boot**: the operator's first launch of the
      merged build migrates their real dev/user profile (JSON →
      `app.db` rows + `.migrated` renames, then v1→v2 ladder). Verify
      settings/jars/downloads/session/shields all intact by inspection.
- [ ] **Live cookie-removal-by-age** (jar-data-surfaces run-1
      disposition): needs `cookie_seen` rows older than the window —
      i.e. a sweep in a LATER session than the rows' first stamp. Plan:
      after Station D's first boot stamps the operator's real cookies,
      either (a) return after ≥1 day and shrink a jar's retention to 1
      day to witness removal, or (b) accept the unit-layer coverage and
      close the carry explicitly. Operator's call — recorded either way.
- [ ] Offline-expiry orphan self-heal (reasoned, never observed): after
      real use, inspect `cookie_seen` for rows whose cookies are gone;
      run a sweep; rows clear.
- [ ] Site-data panel against the operator's real, diverse profile
      (only curated sites tested); two-tier badge UX + known-gap note
      read — is the labeling honest and clear to a human?

**Station E — Behavior-test walkthrough (operator-witnessed)**
- [ ] Re-run `/behavior-test sqlite-store-migration` and/or
      `/behavior-test jar-data-surfaces` at the operator's discretion —
      both specs are active with run-learned apparatus notes; the
      operator may prefer to witness key steps manually instead.

### Design Decisions

**DD1 — Interactive protocol.** No autonomous execution of verification
stations; the FD presents one station at a time, the operator performs
and reports, fixes ride the in-HAT fix protocol (fix-vs-feature gate
called out loud; multi-surface fixes get a lightweight review spawn).

**DD2 — Key rotation before any further keyed automation.** Station B
runs before Station E (no new keyed runs on the leaked-key registration).

**DD3 — Merge order is the operator's.** The FD cannot promote/merge
(classifier-blocked); Station A is operator-driven with the FD preparing
anything needed (rebase, conflict resolution via Developer spawn if any).

### Prerequisites

- [x] F1 + F2 landed, committed, debriefed; PRs #96 (draft) and #98
      (draft, stacked) open.
- [x] All carries enumerated above trace to flight logs/debriefs/mission
      Known Issues (recon at flight design).
- [ ] The operator present (this flight cannot start without them).

### Pre-Flight Checklist

- [x] Open questions resolved (station plan above)
- [x] Design decisions documented
- [x] Prerequisites verified (operator availability pending — the gate)
- [x] Validation approach defined (operator judgment + existing gates)
- [x] Legs defined

---

## In-Flight

### Legs

- [ ] `hat-walkthrough` — Stations A-E with iterative fix riders until
      the operator is aligned. (Single interactive leg; fix riders spawn
      Developers as needed under the in-HAT protocol.)

---

## Post-Flight

### Completion Checklist

- [ ] All stations discharged or explicitly dispositioned by the operator
- [ ] PRs merged (or operator's alternative ruling recorded)
- [ ] Keys rotated
- [ ] Tests passing on main after merges
- [ ] Mission criteria checklist updated in mission.md

### Verification

Operator sign-off, station by station; `npm test`/typecheck/lint green on
the merged main; the mission's Known Issues list emptied or explicitly
carried with dispositions.
