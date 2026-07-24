# Flight Debrief: Vault Core + Automation Surface

**Date**: 2026-07-20
**Flight**: [Vault Core + Automation Surface](flight.md)
**Status**: landed
**Duration**: 2026-07-20 (single-session autonomous execution)
**Legs Completed**: 4 of 4 (vault-crypto, vault-store, vault-mcp-wire, vault-fill)

## Outcome Assessment

### Objectives Achieved

The flight delivered the mission's hardest, most security-critical layer: the entire
cryptographic core of the password manager (`.gfvault` format, KDFs, AES-256-GCM, four
envelope types, RFC 6238 TOTP), the stateful vault store (atomic persistence, unlock
lifecycle, step-up re-auth, access-key minting), and the fill-only MCP automation surface
(`vaultUnlock`/`vaultList`/`vaultTotp`/`vaultFill`) with a real main→preload credential
channel — all with **zero new runtime dependencies**. The whole surface is drivable
end-to-end over MCP with no UI, exactly as scoped.

### Mission Criteria Advanced

- Encrypted-at-rest / no-plaintext-on-disk / zero-new-deps / wrong-key-fails-auth — **fully**.
- Structural compartmentalization (per-jar scope, burner/internal exclusion) — **fully** at the
  key-derivation + store layer.
- TOTP generation matches a reference implementation — **fully** (verified live: `985630` exact match).
- Durable-grant step-up re-auth (access-key minting) — **fully**.
- Access-key delegation is cryptographic (absent-envelope, admin seal-to-future, immediate revoke) — **fully** (verified on disk).
- MCP wire stays fill-only; session-scoped zeroization — **fully** (one sub-property partially unmet — audit-origin, below).
- Gesture-gated / origin-matched / top-frame fill (automation path) — **fully** (verified live).

### Checkpoints

- **(a)** KDF + envelope core — met (41-case crypto suite).
- **(b)** TOTP vs. reference — met (unit + live).
- **(c)** MCP surface + absent-envelope scope — met at unit/fake + a live smoke run; the
  **canonical Witnessed behavior test remains unrun** (see What Could Be Improved).

## What Went Well

- **The DD7 fill-delegate contract was a model cross-leg seam.** The Leg 3 stub and Leg 4 real
  delegate shared the `({ wcId, credential })` signature byte-for-byte; wiring the real one was a
  literal stub swap. The credential is handed to the delegate at exactly one call site and never
  returned across the boundary (grep- and test-confirmed).
- **The crypto was written with real respect for the threat model** — per-envelope AAD binding
  `keyId+type+version`, fresh IVs, async scrypt only (the literal `scryptSync` deliberately never
  appears in source), typed errors over junk returns, thorough zeroization (`.fill(0)` on teardown +
  idle backstop, `unref`'d timers).
- **The electron-free-core + injected-deps discipline extended cleanly** to four new modules
  (`vault-crypto`/`vault-store`/`vault-context` + the pure `vault-fill-fields` preload sibling),
  keeping the whole subsystem unit-testable offline.
- **Leg-at-a-time planning with per-leg design review adapted well** — the Leg 3 split
  (`vault-mcp-wire` + `vault-fill`) and the MRK revision both came from design review and landed clean.
- **Every leg landed green in one pass**, full suite green throughout (2280 → 2299 → 2305 → 2308).

## What Could Be Improved

### Process
- **DD3 was under-specified at flight design and had to be revised mid-build.** The literal
  "each vault wrapped under master + recovery" conflicted with three explicit mission constraints
  (manager-wide recovery key, lazy jar creation, "never mint a new secret at jar creation") — a
  conflict latent in the flight spec, caught only at Leg 2 design (the MRK). It cost nothing because
  the per-leg design-review gate worked, but **future flights in this security domain should
  pressure-test the envelope model against lazy-creation/recovery constraints during flight design**.
- **The behavior-test apparatus under-specified identity coordination.** DD10 planned the
  *observation* apparatus thoroughly but not the *identity* apparatus: a 10-step test needs three
  distinct transport identities (jar-a, jar-b, admin) minted into the app registry the fixtures
  target. Two harness gaps (fixture jars not registered; transport keys not provisioned) surfaced
  only at run time and were fixed to push-button. **Plan multi-identity behavior tests around an
  operator-interactive provisioning step from the outset.**

### Technical
- **Audit-origin is unmet (DD10 sub-property).** `deriveAuditDetail` is args-only, but the resolved
  fill origin lives in the tool *result* — so `vaultFill`/`vaultTotp` audit `item=<id>` only and
  `vaultUnlock`/`vaultList` derive `null` origin. The *events* are audited (the criterion "every
  unlock/fill/TOTP lands in the audit log" holds), but the intended **origin-in-audit** does not.
  The args-only seam is the wrong place; it needs a result-aware detail hook. → Action item; carried
  to mission Known Issues for F2/F3.
- **Per-op decrypt-from-disk in `vault-context`.** By the no-plaintext-caching design, `list`/`totp`/
  `fill` re-read + re-decrypt the `.gfvault` every call. Correct security posture; a potential cost
  once vaults are large or listing is hot — make it an explicit documented decision in F3, don't
  silently rework it.
- **Reserved-identifier namespace now spans two modules with nothing enforcing agreement** (see
  Lessons / the `'global'` collision). Latent debt; design-level guard recommended below.

### Documentation
- The MRK composition and its portability consequence are well-documented (flight log + mission
  Known Issues), but the **vault file-format + threat-model `docs/` page** the mission calls for is
  not yet written (that mission criterion targets a later flight; noted so it isn't lost).

## Test Metrics

First flight in this mission to capture metrics; seeds the continuing series.

- `npm test`: **2308 tests / 2308 pass / 0 fail / 0 skipped**, 13 suite files, exit 0. Internal
  `duration_ms` 2214 ms (wall 4.1 s, parallelized). No flakes (reviewer also ran 3× clean).
- Vault suites (scrypt concern the FD flagged — **designed out**): `vault-crypto` 41 tests / 0.89 s,
  `vault-context` 17 / 0.87 s, `vault-store` 20 / 0.43 s, `vault-atomic-write` 5 / 0.07 s,
  `vault-fill-fields` 6 / 0.05 s. Functional round-trips use fast `N=2¹⁴`; only one isolated test
  exercises production params (`N=2¹⁷ r8 p2 ≈ 434 ms`). No vault suite is slow.
- **Prior comparison**: most recent captured full-suite prior is **M10 F3 = 2123**; this flight
  **2308** (+185, ~89 from the new vault suites, rest from jars/register-tab-ipc/automation additions).
  Standing prior concern — `jar-ipc.test.js` own-time creep (906→1440 ms across M10) — is **untouched**
  by this flight (vault work is additive in separate files); it remains a watch item for a future flight.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD3 literal per-vault wrapping → **Manager Root Key** | Literal DD3 unbuildable vs. mission's manager-wide-recovery + lazy-jar-creation intent | Yes — the *approach* (pressure-test envelope model at flight design); MRK is now the vault's composition |
| Leg 3 split into `vault-mcp-wire` + `vault-fill` | Isolate wire/scope (unit-testable) from cross-process fill + live harness | Yes — split at the unit-vs-live seam |
| Leg 3 added stateless `readVaultItems` (spec listed stateful accessor methods) | Honor the no-singleton rule the spec itself mandated | Spec bug; the rule stands |
| Leg 4 field helpers → new `src/preload/vault-fill-fields.js` (not inline) | `webview-preload.js` can't be `require()`d under `node --test` | Yes — pure sibling for any preload logic needing unit tests |
| Fixture builder rewritten to fully provision (jars + transport keys) | Surfaced only at live-run time; original staged vault files uncoupled from the jar registry | Yes — behavior-test fixtures must provision identities, not just data |

## Key Learnings

1. **Per-leg review and flight-end whole-diff review cover different failure classes — keep both.**
   The `'global'` jar-id sentinel collision (a real cross-vault privilege escalation) was
   *structurally invisible* to per-leg review: it's an emergent property of the seam between Leg 2's
   new sentinel and the *unmodified* `jars.js`, which no leg's diff contained. Only the flight-end
   review, reading both as one surface, could catch it. This validates keeping the flight-end
   whole-diff review **non-optional**.
2. **Introducing a sentinel into a shared identifier namespace is a design act** — it must be
   registered in the module that owns the namespace, or it silently collides.
3. **A live run surfaces integration gaps no amount of unit testing or diff review will** — the two
   fixture-harness gaps (jar registration, transport-key provisioning) existed precisely because the
   vault side and the app-registry/auth side were only ever exercised separately until a live drive.
4. **The MRK indirection made rotation *easier*, not harder** — recovery/admin/master rotation now
   re-wraps three envelopes in `manager.json`, not one-per-vault. F3 should exploit this.

## Recommendations

1. **Adopt a single source of truth for reserved identifiers** (design-level guard beyond the
   `'global'` fix): have `vault-store` assert `GLOBAL_ID ∈ jars.reservedIds()` at load, plus a
   namespace-consistency test that every vault-store route sentinel is a `jars.js` reserved id.
   Directly relevant to F3, which adds `goldfinch://vault` and new access-key/route identifiers.
2. **F3 export must bundle the `manager.json` MRK envelope set** (or re-wrap under fresh
   master/recovery envelopes at export) — the single most important carry-forward; a `.gfvault` alone
   is no longer independently unlockable. Already in mission Known Issues; plan it into F3 from the start.
3. **Resolve the audit-origin gap** — decide whether origin/outcome must appear in the audit trail;
   if so, replace the args-only `deriveAuditDetail` seam with a result-aware detail hook (F2/F3).
4. **Run the canonical `/behavior-test vault-mcp-surface`** (admin + two-jar identities) before F2
   leans on the fill/scope surface — the fixture builder is now push-button; the remaining step is
   operator-interactive identity provisioning. Steps 7 (sibling isolation) and 9 (admin audit read)
   have no live coverage yet.
5. **Decide the global-vault-via-jar-automation question for F2** — F1 scopes a jar automation
   session to its own vault only, but F2's human picker shows jar+global together; decide whether a
   global-scoped access-key tier is needed.

## Action Items

- [ ] Add the reserved-id single-source-of-truth guard + namespace-consistency test (before F3).
- [ ] F3: export bundles the MRK envelope set (tracked in mission Known Issues).
- [ ] Resolve audit-origin: result-aware detail hook or accept event-only auditing (F2/F3).
- [ ] Run the canonical Witnessed `/behavior-test vault-mcp-surface` with admin + two-jar identities.
- [ ] F2/F3 planning: decide global-vault-via-jar-automation; harden the registrable-domain opt-in
      (the `trackers.js` set is not PSL-complete) before any fill rides it.
