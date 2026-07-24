# Mission Debrief: Built-in Password Manager

**Date**: 2026-07-22
**Mission**: [Built-in Password Manager](mission.md)
**Status**: completed
**Duration**: 2026-07-20 (mission design) → 2026-07-22 (F5 close + mission debrief)
**Flights Completed**: 5 of 5 (F1 vault core + automation, F2 human fill trust boundary, F3 vault management page, F4 portability + rotation + hardening + docs, F5 HAT + alignment)

## Outcome Assessment

### Success Criteria Results

All fourteen capability-framed criteria are **met**. The residual across the four
`[behavior-test]`-marked criteria is not a capability gap but a **verification-durability**
gap: those surfaces were verified **live during the F5 HAT** rather than pinned by re-runnable
Witnessed specs. The three vault behavior specs are authored but sit `draft` / `Last Run: never`
(only `vault-mcp-surface` has a single partial smoke run from F1, 2026-07-20).

| # | Criterion | Status | Evidence / Notes |
|---|-----------|--------|------------------|
| 1 | First-run setup (master + recovery once; either secret unlocks) | **Met** | F1 crypto (MRK: one root key wrapped master/recovery/admin) + F3 setup UI + F5 live: fresh-profile adopt unlocked by master AND recovery |
| 2 | Encrypted at rest, no plaintext on disk/logs, zero new runtime deps, wrong key fails auth | **Met** | F1 — all crypto in `node:crypto`; per-envelope AAD; typed errors over junk; `dependencies` unchanged |
| 3 | Compartmentalization is structural (jar A unlock ≠ jar B; picker shows {jar,global}; burner/internal none) | **Met** | F1 store scope + F2 `reachableLoginItems`/`vaultFillHuman` ordered gates (burner-`ineligible`-before-scope) |
| 4 | Fill gesture-gated, origin-bound, top-frame **[behavior-test]** | **Met (live)** | F2 logic + F5 HAT human-fill flow; hardened registrable-domain opt-in (F4 PSL). Durable spec `vault-human-fill-boundary` / `vault-registrable-domain-fill` authored, unrun (banked) |
| 5 | No vault secret entered into/readable from web content; master chrome-only; icon decorative **[behavior-test]** | **Met** | F2/F3 — three secret paths grep/test-confirmed; DD5 elevated to "no master-equivalent secret in page DOM". Live-confirmed F5 |
| 6 | Locking comprehensive (idle, Lock now, quit, jar wipe/delete); keys memory-only; wipe spares/delete removes | **Met** | F1 lifecycle + `.fill(0)` zeroization + idle backstop; F4 jar-delete→vault-removal (offer-export-first), wipe spares |
| 7 | TOTP end-to-end (enroll otpauth/base32; live rotating code; matches reference) | **Met** | F1 RFC-6238 gen (`985630` exact match) + F3 enroll/live display + F5 live |
| 8 | Capture offers to save (chrome-rendered; update on origin+username; active-jar default) **[behavior-test]** | **Met (v1)** | F2 — real-form submits when set up **and unlocked** (unlocked-only gate operator-ratified as v1); SPA/fetch a documented gap. Spec unrun (banked) |
| 9 | Portability is file-based (fresh-profile import; master AND recovery unlock; no egress) | **Met — VERIFIED LIVE** | F4 MRK-bundle export/import + F5 `hat-fresh-profile-import` live round-trip. Fidelity follow-up (`hat-import-destination-safety`) banked |
| 10 | Durable-grant ops demand step-up re-auth (mint access key; rotate recovery); wrong pw refuses | **Met** | F1 gate + F3 mint UI + F4 rotation surface (`recoverMasterPassword` single-op = recovery IS step-up) |
| 11 | Access-key delegation cryptographic (absent-envelope; admin seals-to-future; immediate revoke) **[behavior-test]** | **Met (unit/disk)** | F1 on-disk envelope-set verification. Witnessed `vault-mcp-surface` one partial run (F1), spec still draft (banked) |
| 12 | MCP wire fill-only; `vaultList` metadata-only; session-scoped teardown + idle backstop; audited **[behavior-test]** | **Met** | F1 surface + F4 audit-origin fix (Known Issue #2 closed). Spec unrun (banked) |
| 13 | `goldfinch://vault` first-class trusted internal page (four gates, `registerInternalHandler`, CSP; amended a11y) | **Met** | F3 page + full CRUD/reveal/access-key/generator/auto-lock. Sheet-state axe run + page-DOM a11y ride HAT (sheet axe run banked) |
| 14 | Docs reflect the feature (CLAUDE.md architecture + `docs/` format + threat model incl. unrecoverable-by-design) | **Met** | F4 `docs/vault.md` (11 sections) + CLAUDE.md `### Password vault`, leading with unrecoverable-by-design |

### Overall Outcome

**Achieved in full.** The operator's own assessment at debrief: *"Yes, fully delivered."* Goldfinch
now has a private, portable, agent-drivable password manager built entirely on `node:crypto` with
**zero new runtime dependencies** — master password + one-time recovery key, per-jar + global
compartmentalization that is *cryptographically* enforced (a wrong-vault pick is impossible because
no envelope exists, not merely refused at runtime), gesture-gated origin-bound fill, RFC-6238 TOTP,
file-based portability with no cloud in the loop, and a deliberately narrow fill-only MCP surface
driven by scoped, revocable access keys that never carry the human master password. The hardest,
most security-critical layer was built and tested first (F1), exactly as sequenced.

The single most valuable outcome-level event was the F5 debrief **catching a shipped-looking break
in the marquee portability criterion** (a collision mislabeled as a bad secret) and fixing it before
the mission closed — the strongest possible argument that the debrief step earns its place.

## Flight Summary

| Flight | Status | Key Outcome | Tests (end) |
|--------|--------|-------------|-------------|
| F1 Vault core + automation | completed | Whole crypto core + MRK model + fill-only MCP surface, drivable end-to-end with no UI; MRK revision caught at Leg-2 design | 2308 |
| F2 Human fill trust boundary | completed | Chrome-owned unlock/picker/capture sheets; every secret a zeroizable Buffer in main; icon decorative/spoofable | 2389 |
| F3 Vault management page | completed | `goldfinch://vault` four-gate internal page; item-schema secret-taxonomy SSOT closed BOTH F2 data-loss classes | 2522 |
| F4 Portability + rotation + hardening | completed | MRK-bundle export/import; full rotation surface; fail-closed PSL matcher; audit-origin fix; jar-delete lifecycle; docs | 2638 |
| F5 HAT + alignment | completed | Live acceptance of all core paths + large inline UX/feature pass (I1–I20); marquee portability verified live | 2689 |

**Trajectory**: monotonic test growth 2308 → 2389 → 2522 → 2638 → 2689 (+381 over the mission),
internal duration held flat ~2100–2390 ms throughout (no suite regressed; the one production-scrypt
`N=2¹⁷` test dominates the crypto suite by design). Every flight landed green in one pass, no flakes,
no skips, typecheck + lint clean at every landing.

## What Went Well

- **The design-review gate was the mission's single most consistent quality mechanism — across all
  five flights.** Per-leg design review (risk-tiered) repeatedly caught *load-bearing* defects
  **before code**, and the pattern held whether the flight ran autonomously or interactively:
  - F1: the MRK revision (literal DD3 per-vault wrapping was unbuildable against the manager-wide
    recovery + lazy-jar-creation constraints).
  - F2: the burner-`ineligible`-before-scope ordering (a bare `vaultId ∈ {global,tabJar}` passes for
    a burner tab when `vaultId='global'`).
  - F3: three separate "this leg silently breaks a landed F1/F2 contract" catches (structured-vs-string
    TOTP storage breaking the automation reader; setup's Buffer-rejecting guard; a metadata blacklist
    leaking note `body`).
  - F4: the fourth consumer of `reachableLoginItems`; the `matchMode` schema-side-effect; DD1 B→A and
    DD5 curated-set→PSL flips.
  - F5: the editor secret-wipe-on-idle-lock HIGH; the export-path write-anywhere; the coded-collision
    discipline.
  The lesson compounds: **a rigorous per-leg gate on a flight built atop prior flights does the
  whole-diff review's cross-flight job earlier.** Keep it non-optional for security-domain flights.

- **The flight-end whole-diff review caught the emergent-seam defects per-leg review is structurally
  blind to — twice, identically.** F1's `'global'` sentinel collision (a real cross-vault privilege
  escalation living in the seam between a new sentinel and *unmodified* `jars.js`) and F2's
  capture-update TOTP-wipe (an interaction between F2's capture and F1's `totp` field) were each
  invisible to every individual leg's diff. Both reviews stay non-optional.

- **A handful of structural artifacts turned "convention" into "property."** The
  `vault-item-schema.js` secret-taxonomy SSOT (whitelist-projection = exact complement of
  merge-preserve) structurally closed both F2 data-loss classes at once; the `editorCleanups`
  teardown registry converted "wipe secrets on every exit" from a per-path convention into a
  drained-choke-point invariant across five exit paths; `psl.js`/`origin-match.js` are fail-closed
  *by design* (no implicit `*`), which is what makes "never shares across a registry sibling"
  literally true. These are the mission's durable engineering wins.

- **The invoke-Buffer secret channel is now a proven, mission-wide pattern** — every
  master-equivalent secret (setup, step-up, rotation) crosses the renderer boundary as a
  dual-zeroized Buffer over `invoke`, never as a page-DOM string, verified by grep-ACs for secret
  egress. This convention deserves promotion repo-wide.

- **The autonomous-then-HAT execution model worked and is operator-ratified.** F1–F4 ran
  autonomously with the FD making judgment calls at leg granularity; the security-critical flights'
  debriefs were the natural go/no-go points; F5 absorbed the human-in-the-loop UX/acceptance work.
  Operator verdict at this debrief: **keep as-is** for security-critical missions.

## What Could Be Improved

### Process

- **The closing-HAT-as-alignment model displaced the acceptance gate — a known, cheap-to-fix weakness.**
  F5 was scoped as verify-only and became a large build/UX pass (I1–I20). Per operator guidance this
  is *intended* (the HAT is what enables autonomous mid-mission execution), and the operator
  re-ratified the model here. But within that model there was no guard against silently landing with
  a criterion unverified — the I17 portability break was landed-over and only caught at debrief. The
  standing recommendation (a pre-land "every criterion verified live or explicitly deferred with
  disposition" checkpoint) is the fix, and it's a **methodology change**, logged below.

- **Leg/flight specs repeatedly under-specified the cross-flight compatibility surface.** The same
  class recurred F1→F3→F4: a spec extends a prior flight's primitive and under-counts its
  readers/writers or test-pin sites. Every instance was caught at design review, but a cheap
  spec-authoring check — *"grep every consumer and every `deepEqual`/contract-pin site of the surface
  you're changing before writing the leg"* — would pre-empt them. Recommend adopting it as a `/leg`
  authoring step for flights extending prior-flight primitives.

- **Behavior-test apparatus needs its *identity* provisioning planned from the outset, not just its
  observation surface.** F1's DD10 planned observation thoroughly but the multi-identity provisioning
  (jar-a / jar-b / admin transports minted into the fixture-targeted registry) surfaced only at run
  time. This is why the three vault behavior specs remain draft/unrun — the apparatus (a second
  `userDataPath`, multi-origin fixtures, transport-key provisioning) was identified but never fully
  provisioned. The specs are the mission's biggest **verification-durability** debt.

### Technical (architecture debt carried to the merge / next work)

**Independent Architect verdict (post-mission code read):** *the security core IMPROVED and holds; the
renderer sheet/modal layer DEGRADED into accretion — and the split is clean and diagnostic, so the debt
is localized, not systemic.* The main-process vault subsystem is five well-factored electron-free
modules with one job each; `vault-crypto.js` is the strongest artifact in the mission (per-envelope AAD,
fresh IVs, async-scrypt-only, typed errors, no `scryptSync` anywhere) and the MRK indirection *simplified*
rotation as predicted. The accretion is entirely in the renderer: 13 template-builder files + a 15-kind
sheet dispatch across 5 parallel arms + a `vault.js` over its extraction threshold. The security
boundaries are **mostly structural** — the absent-envelope cryptographic scope, the GLOBAL sentinel
guard, and the no-master-secret-in-DOM channel-absence are exemplary — with two honest convention
residuals noted below (textContent-only, and `saveItem`).

These are the standing items from the flight debriefs plus the Architect's net-new findings, now
mission-level. All are **banked** per operator decision (recorded, not scheduled):

0. **`saveItem` wholesale-replace is still an open footgun at the store level — the flight debriefs
   overstate its closure.** The `vault-item-schema.js` SSOT closed the *projection/preserve drift*
   (metadata leak + TOTP-wipe-on-merge); it did **not** close the base hazard. `saveItem`
   (`vault-store.js:1055`) still replaces wholesale on update, preserving only `createdAt`, and stays
   exported — safety rests today on the *convention* at `:1049` ("partial-update callers must read-merge
   first"), holding only because capture read-merges and the page routes through
   `saveItemPreservingSecrets`. A new bare-item caller reintroduces the wipe. Make `saveItem`
   merge-aware, or add a test-enforced guard — this is convention, not structure.

1. **`vault.js` is overweight (1829 lines — over its own ~1800 extraction threshold).** Three inline
   subsystems (page-modal system, item editor, import/export modals) have already-extracted analogues
   on the jars page (`jars-confirm-modal.js`). Extraction is the two-for-one that makes the 5-path
   secret wipe + editor unit-testable — closing the biggest DD9 testing gap.
2. **`menu-overlay.js` is at 1725 lines / 15 sheet kinds** dispatched across ~5 hand-maintained
   parallel arrays. The declarative sheet-descriptor-table registry has been requested since the F2
   debrief (at 7 kinds) and is now overdue.
3. **THREE parallel modal/sheet primitives coexist** — menu-overlay sheets, `jars-confirm-modal.js`,
   and vault.js's own page-modal system. F5 added the third rather than paying down the debt. This is
   the clearest architectural inconsistency the mission produced; reconciling to one modal system is
   the highest-value refactor.
4. **The four-fold copied master step-up block** (`vault-store.js` `changeMasterPassword` /
   `rotateRecovery` / `rotateAdminKey` / `mintAccessKey`) — a security invariant duplicated four
   ways; a future step-up fix must reach all four. `_stepUpMaster(manager, password)` is the obvious
   consolidation.
5. **Per-op whole-vault decrypt on hot interactive surfaces — with an admin multiplier the debriefs
   never quantified.** `list`/`reveal`/`totp`/`save` each decrypt the entire vault; the live-TOTP
   widget does a full decrypt per period. Worse on the **automation admin path**:
   `vault-context.unlockedItems` re-decrypts *every unlocked vault* on *every* `list`/`totp`/`fill`
   call, so an admin agent polling `totp()` re-decrypts the whole manager's vault set each call —
   O(all-items) per interactive op, unbounded in vault × item count. Correct no-plaintext-cache
   posture; a documented **characteristic**, not a bug — but F1 asked it be an explicit decision, now
   owed on the known-characteristics list with a re-evaluation trigger (e.g. >200 items or an
   admin-poll workload). *Also noted (nuance): `decryptItems` yields item plaintext as unscrubbable
   V8 strings — the per-op-decrypt transience (never cached, immediately GC-eligible) is the
   mitigation, not `.fill(0)`.*
6. **The vendored 328 KB PSL has no staleness guard.** It fails only ever *closed* as it ages
   (unlisted suffix → exact match), so this is UX-drift not a security risk — needs a *deliberate
   decision*: accept manual refresh, or add a periodic diff against publicsuffix.org. Defensible
   either way.
7. **DD9 page-a11y gap is structural, not a deferral.** Internal-session pages are axe-unreachable by
   any admin key; the vault page's keyboard/focus/aria correctness rests on unit DOM/aria tests + the
   F5 HAT pass. The sheet-state axe run (`npm run a11y`) was also deferred and remains banked. The
   related DD9 **untested-DOM** surface (5-path secret wipe, per-row delete confirm, in-field
   reveal/copy) is unit-untestable only *because* `vault.js` isn't extracted — item 1 is the two-for-one.
8. **`manager.json` is a single point of failure the debriefs missed.** It holds the *entire* MRK
   envelope set; the constructor validates it loudly and throws on corruption (correct — never
   quarantine-and-reseed a secret store). Consequence: a corrupt `manager.json` wedges the *whole*
   manager (every vault at once), where a corrupt single `.gfvault` loses only one vault. Export
   bundles carry all three envelopes so it's recoverable *if an export exists*, but there is no
   automatic `manager.json` backup and no defined app-level behavior when the constructor throws at
   boot. Worth a maintenance decision: keep-one-generation backup, or accept + document.
9. **textContent-only rendering is convention, CSP-backstopped — not structurally enforced.** Zero
   `innerHTML` in code today, but no lint/test guard prevents a future edit from adding one; the strict
   internal-page CSP is the structural net. A grep-AC or lint rule would make it a property.

### Documentation

- `docs/vault.md` (written in F4) predates the F5 Secrets-page redesign (nav+sidebar, typed
  subsections, modal editor, unified Import/Export, in-field reveal/copy, global Lock now) and the
  `editorCleanups` teardown pattern. It needs a refresh to match the shipped UI — a maintenance item.

## Lessons Learned

**Technical**
- **Fail-closed is a design property, not a fallback.** The PSL's no-implicit-`*`, the audit's
  parse-returns-null, `originMatches`'s degrade-to-exact — the same principle three ways — are what
  make the mission's "never" claims literally true. A curated set structurally could not.
- **Single-op beats flag-op for security flows.** `recoverMasterPassword` as one atomic op (recovery
  key IS the step-up) is safe where an `authenticated:true` flag on `changeMasterPassword` would have
  reopened the step-up hole on a transiently-unlocked session.
- **A single-sourced field taxonomy consumed as exact complements** is the durable fix for
  render-without-leaking-secrets — it closed two data-loss classes structurally, not by convention.
- **A collision must never be reported as a bad secret** (I17). Typed, coded errors +
  reason-forwarding are the fix; message-matching is a truthfulness bug waiting to mislead.

**Process**
- **Per-leg review and flight-end whole-diff review cover different failure classes — keep both.**
  The cross-flight-contract breaks surface at per-leg design; the emergent-seam escalations surface
  only at whole-diff. Neither substitutes for the other.
- **The debrief's human interview earns its place** — it surfaced the I17 portability break that had
  landed-over. A build-heavy HAT needs an explicit pre-land criteria checkpoint so a marquee
  criterion can't slide to a footnote.
- **Treat flight-spec *mechanism* claims as provisional** until the owning leg's code-depth review
  confirms them; several F4 spec-body mechanism claims were corrected at the leg, none survived to code.

**Domain**
- **The MRK indirection made rotation *easier*, not harder** — recovery/master/admin rotation
  re-wraps three envelopes in `manager.json` and never re-keys the MRK, so `.gfvault` files stay
  byte-untouched. The one consequence to design around: a `.gfvault` alone is not independently
  unlockable, so portability is an *export bundle*, not a single file.

## Methodology Feedback

Improvements to Flight Control surfaced by this mission (mission-control side):

1. **Add a pre-land acceptance checkpoint to the HAT/flight model** — "every mission criterion
   verified live or explicitly deferred with a recorded disposition." This is the direct fix for the
   one weakness of the (otherwise-ratified) closing-HAT-as-alignment model: the I17 break proves a
   marquee criterion can land unverified inside a build-heavy HAT. Cheapest, highest-value change.
2. **`/leg` (and `/flight`) should prompt a compatibility/consumer audit for changes to
   prior-flight primitives** — "enumerate every reader/writer and every contract-pin/`deepEqual`
   site of the surface you're changing before locking the leg." Recurred cleanly enough (F1/F3/F4)
   to codify.
3. **Multi-identity behavior tests need an explicit identity-provisioning prerequisite** in flight
   planning, not just an observation-apparatus premise audit — provisioning gaps are why this
   mission's Witnessed suites are authored-but-unrun. The `/flight` apparatus premise-audit (both
   act and observe axes) already exists; extend it to name identity/transport provisioning as a
   gated prerequisite when the test needs >1 transport identity.
4. **Credit the risk-tiered per-leg review + non-optional flight-end whole-diff review as validated**
   — five flights of evidence that they catch different, both-load-bearing failure classes. No change
   needed; reinforce.

## Action Items

All banked per operator decision (2026-07-22) — recorded here, none scheduled:

- [ ] **Merge to main**: squash the whole 38-commit M12 stack (flight/05) into one mission PR → main;
      retire stacked draft PRs #108–#111. *(Operator-chosen; execute next.)* **Before merging, do one
      pre-merge whole-mission read** — the flight-end whole-diff review ran per-flight, but no review
      has read the mission as a single merged surface, and the F1 `'global'`-sentinel lesson (cross-file
      emergent defects invisible to any single diff) is exactly the class a whole-mission read catches.
- [ ] **`hat-import-destination-safety` Part A** — surface the bundle's `sourceVaultId` in the import
      modal + default-match destination + warn on mismatch + state the fresh→Global landing. Scoped
      safety leg.
- [ ] **`hat-import-destination-safety` Part B** — extend the bundle format to restore a jar AS a jar
      (`BUNDLE_VERSION` bump + fresh-adopt jar-recreate + v1 back-compat). Size as its own flight.
- [ ] **Architecture debt** (candidates for `/routine-maintenance`): reconcile the three modal
      primitives / extract `vault.js` page-modal + editor + import-export; the `menu-overlay.js`
      15-kind descriptor-table registry; the `_stepUpMaster` four-fold consolidation; a deliberate
      PSL-staleness policy; record the per-op whole-vault-decrypt characteristic and close it.
- [ ] **Verification-durability**: provision the behavior-test apparatus (second `userDataPath`,
      multi-origin + matchMode fixtures, transport-key provisioning; fold the `lvh.me` wildcard-DNS
      trick into fixtures) and run the three authored Witnessed specs — `vault-mcp-surface`,
      `vault-human-fill-boundary`, `vault-registrable-domain-fill` — to promote them from
      draft/live-verified to re-runnable gates; add the sheet-state `npm run a11y` run.
- [ ] **Docs**: refresh `docs/vault.md` for the F5 Secrets-page redesign + the `editorCleanups`
      teardown pattern.
- [ ] **Methodology (mission-control)**: the pre-land criteria checkpoint; the `/leg` consumer-audit
      step; the identity-provisioning prerequisite for multi-identity behavior tests.
