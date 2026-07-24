# Flight Debrief: Portability + Rotation + Hardening + Docs

**Flight**: [Portability + Rotation + Hardening + Docs](flight.md) · **Mission**: [Built-in Password Manager](../../mission.md)
**Status at debrief**: landed (commit `cf31cc3` + `2f8bc33`, draft PR #111 stacked on flight/03)
**Date**: 2026-07-21

Flight 4 — the crypto-risk cluster split from the original F3 — landed all 7 legs clean: per-vault
export/import, the full operator-secret rotation surface, the registrable-domain PSL fill opt-in, the
audit-origin fix, the jar-delete→vault-removal lifecycle hook, and the vault docs + threat model.
Whole-diff flight-end review CLEAN; 2638 tests / 0 fail; typecheck + lint clean.

## Outcome Assessment

### Objectives Achieved

All eight design decisions (DD1–DD8) held in implementation — the Architect debrief walked each and found
**held** (or held-with-caveat), zero diverged. Highlights:

- **Portability (DD1, Option A)** — `exportVault` produces a ciphertext-only bundle (the manager's three
  mrk envelopes + kdf + adminPublicKeyB64 + the target `.gfvault`); `importVault` supports both fresh-
  profile adopt (vault-before-manager write order, ends unlocked) and existing-profile re-key (collision-
  refuse + cache-eviction). The flight-level B→A flip proved correct.
- **Rotation/recovery (DD3/DD4)** — recovery/master/admin rotation + from-scratch admin provision, each
  a one-slot `manager.json` rewrite (the MRK is never re-keyed → `.gfvault` byte-untouched). The single-op
  `recoverMasterPassword` (recovery key IS the step-up, no bypass flag) was the flight's most important
  correctness ruling.
- **Registrable-domain matcher (DD5, vendored PSL)** — `psl.js` + `origin-match.js` deliver a genuinely
  fail-closed matcher (unlisted suffix → null → exact; exception>wildcard>longest; MITM same-scheme
  guard). This is what makes the mission's "never shares across a registry sibling / multi-tenant tenant"
  *literally* true — a curated set structurally could not. Capture stays exact.
- **Hardening (DD6/DD7)** — the audit now records the resolved fill origin + unlock count (never a
  secret); jar delete removes the vault (offer-export-first, GLOBAL-guarded, fail-soft) while wipe spares
  it.
- **Docs (DD8)** — `docs/vault.md` (11 sections) + the CLAUDE.md `### Password vault` subsection, leading
  the threat model with the unrecoverable-by-design property.

### Mission Criteria Advanced

- **Portability is file-based** — export/import round-trips (fresh-profile adopt verified in unit tests;
  the live cross-profile round-trip rides F5).
- **Recovery + rotation** — the full operator-secret surface (recovery rotation, master change, forgotten-
  master recovery, admin rotation/provision).
- **Registrable-domain opt-in** — per-credential, hardened, fail-closed; never shares across a sibling.
- **Audit records the resolved origin** — Known Issue #2 closed.
- **Lifecycle** — wipe spares / delete removes (offer export first).
- **Documentation** — the format + threat-model page criterion met.

### Checkpoints

(a) export/import fresh-profile unlock — unit-verified; live round-trip → F5. (b) rotations re-unlock by
new / reject old; only manager.json changed — verified. (c) registrable-domain fills the matched subdomain
but never an excluded sibling — verified. (d) audit records origin + unlock count — verified. (e) jar
delete removes / wipe spares — verified (**note**: checkpoint (e)'s text still says "prunes the manager
row"; there is no manager row per the DD7 correction — stale spec text, flagged not rewritten). (f)
docs/vault.md + CLAUDE.md incl. unrecoverable-by-design — verified.

## What Went Well

- **The design-review gate caught every defect before code.** Each per-leg [HIGH] was pre-empted at
  review, none reached implementation: Leg-1's two crypto bugs (all-three-mrk bundle; recovery-string vs
  master-Buffer asymmetry), Leg-4's fourth consumer of `reachableLoginItems` (capture disposition) + the
  `matchMode` re-homing, Leg-5's missed cross-file test-pin, Leg-6's under-scoped modal shape. Three of
  these were load-bearing — without any one, the flight ships a real defect.
- **Risk concentration was correct.** Pinning the two hard flight-level decisions (which bundle, which
  matcher) up front and deferring the rest to per-leg gates worked: every remaining issue was code-depth,
  discoverable only at leg granularity — a second flight-level (spec-only) pass would not have caught them.
- **Security invariants held across four new sheets.** No master-equivalent secret entered the page DOM or
  any `internal-*` payload; every secret rode the dual-zeroized Buffer channel; the audit never emits a
  secret. The whole-diff review confirmed the F1 sentinel-escalation class was not reintroduced.
- **`psl.js` / `origin-match.js` are the strongest-designed artifacts** — pure, fail-closed, exhaustively
  unit-tested (the deliberate no-implicit-`*` deviation is the load-bearing security choice).
- **Clean landing** — 2638/0, typecheck + lint clean, no flakes, no skips.

## What Could Be Improved

### Process
- **Flight-spec mechanism claims were treated as fact when they were provisional.** Three spec-body
  inaccuracies survived the flight-level review and were corrected at the owning leg: DD5's "`matchMode`
  as a nonSecret field" (wrong — trips the editor drift-guard), DD5's "three match sites" (actually four),
  DD7's "minimal wiring" renderer offer (actually a modal-shape change). The per-leg gate caught all three
  — the lesson isn't "add a second flight pass" but treat flight-spec *mechanism* claims as provisional
  until the leg's code-depth review confirms them.
- **Specs touching test-pinned shared surfaces repeatedly under-counted the pin sites** (Legs 1, 4, 5). A
  spec-authoring check — "grep every `deepEqual`/consumer site of the surface you're changing" — would
  have pre-empted the Leg-4/5/1 corrections.

### Technical
- **The four-fold copied master step-up block** (`vault-store.js` `changeMasterPassword` :582 /
  `rotateRecovery` :607 / `rotateAdminKey` :640 / `mintAccessKey` :1319) — deliberate crypto mirroring, but
  a security invariant duplicated four ways: a future step-up fix must reach all four. A single
  `_stepUpMaster(manager, password)` helper is the obvious consolidation.
- **The menu-overlay sheet registry is at 15 kinds** (8 vault, +5 this flight) dispatched across parallel
  arms (TEMPLATES / NODE_OF_ENTRY / modelShapeOk / init / per-kind render). Every new sheet threads all
  five identically. The clearest refactor candidate the flight produced — a declarative sheet-descriptor
  table.
- **The vendored 328 KB PSL has no refresh mechanism or staleness guard** (no script, no CI, no version
  test). It fails only ever *closed* as it ages (unlisted suffix → exact), so it's UX-drift not a security
  risk — but nothing will ever signal it has gone stale.

### Documentation
- Two stale flight.md citations left un-rewritten (per policy, flagged in the log not the spec): DD5's
  picker-filter cite (`:885` → actually `:1191`) and checkpoint (e)'s "prunes the manager row." A reader
  of the spec alone is misled.

## Test Metrics

| Flight | Tests | Internal `duration_ms` |
|---|---|---|
| F1 | 2308 | 2214 |
| F2 | 2389 | 2093 |
| F3 | 2522 | 2204 |
| **F4** | **2638** | **2326** |

- `npm test`: **2638 pass / 0 fail / 0 skipped**, 13 suites, exit 0. typecheck clean; lint clean. **No
  flakes.**
- **+116 tests over F3** (per-leg +6/+24/+11/+31/+11/+13/+0, internally consistent). All net-new coverage;
  one test intentionally migrated (forgotten-master → `recoverMasterPassword`).
- **Wall/internal time +122 ms over F3 (~5.5%, the mission's highest)** — proportionate to +116 tests, but
  the first flight to nudge duration up rather than hold ~2100-2200 ms. Watch, don't act.
- **The 328 KB PSL is not a measurable drag** — parsed once at module load; `psl.test.js` is 11 tests in
  46 ms, amortized across dependent suites.

## Deviations and Lessons Learned

- **DD1 flipped B→A, DD5 flipped curated-set→PSL** at the flight-level review — both load-bearing (B
  contradicted "export not re-prompted" + minted a confusing second recovery key; a curated set cannot
  make "never shares across a ccTLD sibling" true).
- **Admin rotation split out of key-rotation** at the leg-2 review (7 legs, not 6) — bounded the HIGH leg's
  blast radius; mild evidence the initial 6-leg sizing was slightly optimistic, self-corrected cleanly.
- **`matchMode` re-homed** from a `nonSecret` field to a `hasTotp`-style `metadataOf` flag — the schema's
  nonSecret whitelist has non-obvious editor-rendering side effects spec-level design can't see.
- **The origin-match chokepoint has semantically-divergent callers** (picker widens, capture must stay
  exact). The `{widen}` opt-in is the right containment, but any *future* caller inherits the widen-vs-exact
  obligation — a latent sharp edge, adequately guarded today.

## Key Learnings

- **Fail-closed is a design property, not a fallback.** The PSL's deliberate no-implicit-`*` deviation is
  what makes "never" true; the audit's parse-returns-null and `originMatches`'s degrade-to-exact are the
  same principle applied three ways.
- **Single-op beats flag-op for security flows.** `recoverMasterPassword` as one atomic op (recovery key
  IS the step-up) is safe where an `authenticated:true` flag on `changeMasterPassword` would have reopened
  the step-up hole on a transiently-unlocked session.
- **A chokepoint's callers must be enumerated, not assumed.** The fourth consumer of `reachableLoginItems`
  was the flight's clearest "design under-counted the callers" moment.

## Recommendations

1. **F5 (the HAT) must verify the live-only surfaces** the unit tests structurally can't: the export→import
   round-trip across two real profiles through the file dialogs (incl. the `_pendingVaultImport` dismiss
   edge); the **cross-machine / different-master-password comprehension path** (the single highest live-only
   *design* risk — an operator on a second machine needs the *source* master password or the recovery key);
   the dismiss-locked one-time-display sheets; the registrable-domain widen as experienced in a real fill
   (the "Subdomain match" badge + the load-bearing negative: no cross-tenant fill); and the deferred
   **sheet-state a11y for the four new sheet kinds** (the largest deferred surface) + the 3-element
   offer-export modal focus cycle.
2. **Mission debrief (after F5) should weigh three architecture-level debts**: the 15-kind sheet-registry
   refactor; the four-fold step-up consolidation (`_stepUpMaster`); and a *deliberate decision* on PSL
   staleness (accept manual refresh, or add a CI/periodic diff against publicsuffix.org — defensible either
   way because it fails closed).
3. **Adopt a spec-authoring check** for shared-surface changes: enumerate every consumer and every
   `deepEqual`/contract-pin site before writing the leg (would have pre-empted the Legs 1/4/5 corrections).
4. **Author F5 behavior-test specs** (Witnessed pattern) for the export/import round-trip and the
   registrable-domain live fill — both are multi-component real-environment flows.

## Action Items

- [ ] **F5 (HAT)** — verify the live-only surfaces in Recommendation 1; lead with the cross-machine-master-
      password comprehension risk and the deferred sheet-state a11y.
- [ ] **Carry to F5 / routine-maintenance** — `_pendingVaultImport` dismiss-clear; the stale open-vault-
      page-row after a jar delete (missing vault-specific broadcast); the cross-file fill-return test-pin
      (a shared return-shape fixture would decouple it).
- [ ] **Mission debrief** — decide on the 15-kind sheet-registry refactor, the `_stepUpMaster` extraction,
      and the PSL-staleness policy; record the per-op whole-vault-decrypt characteristic on the known-
      characteristics list and close it.
- [ ] **Spec hygiene** — reconcile the two stale flight.md citations (DD5 `:885`→`:1191`; checkpoint (e)
      "manager row") at the next spec touch.
