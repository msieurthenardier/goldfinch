# Flight Debrief: Vault Management Page

**Date**: 2026-07-21
**Flight**: [Vault Management Page](flight.md)
**Status**: landed
**Duration**: 2026-07-20 → 2026-07-21 (autonomous execution)
**Legs Completed**: 5 of 5 (vault-page-infra, item-management, totp-and-generator, first-run-setup, access-keys-autolock)

## Outcome Assessment

### Objectives Achieved

The flight delivered `goldfinch://vault` — the trusted internal management page — wiring up F1's
already-built-but-unwired store/crypto primitives behind a first-class four-gate internal page:
item CRUD (login/card/note) with masked reveal, TOTP enrollment + a live main-computed code
display, a pure password generator, first-run setup, per-vault access-key management
(list/mint-with-step-up/revoke), and the auto-lock setting. The load-bearing invariant held
literally: **no master-equivalent secret (master password or recovery key) ever enters the vault
page DOM or an `internal-*` payload** — all master-password entry and one-time-secret display route
through the chrome-owned menu-overlay sheet over dual-zeroized Buffer invoke channels; item secrets
reach the page only on explicit reveal; the TOTP seed never leaves main. Zero new runtime deps.

### Mission Criteria Advanced

- **`goldfinch://vault` first-class trusted internal page** — **fully** (four gates,
  `registerInternalHandler`, strict CSP; item CRUD + reveal/copy, access-key mgmt, auto-lock,
  generator). a11y coverage per the amended criterion (sheet states wired; page DOM = unit + F5 HAT).
- **First-run setup** (master password + recovery-key-once) — **the UI half, fully** (chrome sheet).
- **TOTP end-to-end** (enroll + live display) — **the enrollment + display half, fully**.
- **Durable-grant step-up re-auth** (access-key mint) — **the UI half, fully** (a wrong master
  password refuses the mint before any write).

### Checkpoints

- (a) page loads/not-set-up/locked/unlocked + reserved-id SSOT — met. (b) metadata CRUD + explicit
  reveal + sentinel-lossless save — met. (c) TOTP live + generator — met. (d) setup on the sheet +
  recovery-once — met. (e) access-key mint/list/revoke + auto-lock — met. **The a11y sweep of the
  four new sheet states is wired but not run** (live-GUI, deferred to the F5 HAT — DD9).

## What Went Well

- **The per-leg design-review gate caught the flight's real defects EARLY — three of them were
  "this leg silently breaks a landed F1/F2 contract."** Structured-vs-string TOTP storage would have
  broken F1's sole automation reader (`vault-context.js:248` `parseOtpauth(item.totp)` expects a
  string); `setup`'s spec shape was wrong AND its guard rejected a Buffer; a metadata name-blacklist
  would have leaked note `body` (not named `note`) + login `notes`. Plus `parseOtpauth`'s
  `period=0`→÷0 crash and the recovery-show dismiss-lock (Escape would lose the unrecoverable key).
  **The per-leg review is doing the whole-diff review's cross-flight job earlier** — credit it as the
  flight's main quality mechanism (the flight-end whole-diff review then confirmed with zero blocking).
- **The secret-field-schema SSOT (`vault-item-schema.js`) is the strongest structural artifact —
  it closes BOTH F2 data-loss classes at once.** `metadataOf` is a positive whitelist; the
  save-preserve set is its exact complement — projection-exclude and merge-preserve can never drift.
  This structurally closes the metadata-blacklist-leak AND the TOTP-wipe-drop, verified by a
  complement-invariant test.
- **Every master-equivalent secret stayed off the page**, proven by the whole-diff review's full
  secret-inventory trace: setup + step-up master passwords ride dual-zeroized Buffer invoke channels;
  recovery/minted secrets transit main→chrome→sheet only; the admin private key never leaves main.
- **DD8 (reserved-id SSOT) closed the F1 carry-forward** — a standalone dependency-free
  `reserved-ids.js` (not routed through `jars.js`, which would have coupled `vault-store`'s
  Electron-free purity to `app-db`) + a cross-module consistency test.
- **Every leg landed green in one design-review cycle**; the suite grew monotonically
  2389 → 2410 → 2445 → 2473 → 2500 → 2522, flat wall-time, no flakes.

## What Could Be Improved

### Process
- **Leg specs consistently under-specified the cross-flight compatibility surface.** The three
  "silently breaks F1/F2" catches were all latent in the leg specs and surfaced only at design
  review. **Future flights building on a prior flight's primitives should add an explicit
  "compatibility audit" step to leg design** — enumerate every existing reader/writer of a
  primitive being extended (here: F1's `vault-context` totp reader; `setup`'s guard; the item
  field taxonomy) before locking the leg.

### Technical
- **`menu-overlay.js` grew to 1269 lines / 11 template kinds; the template-*registry* refactor the
  F2 debrief asked for (before the 8th kind) is still outstanding.** F3 did the modal-card
  *controller* extraction (the shared keyboard/backdrop/report machine, now importable + unit-tested)
  — a good foundation — but the dispatch is still a hand-maintained parallel array (`TEMPLATES` +
  `NODE_OF_ENTRY` + `modelShapeOk` + per-kind render + if/else arm ≈ 6 coordinated edits per kind).
  F4 adds more sheets (admin-provision, master-pw-change) → do the per-kind descriptor-table
  registry first.
- **Per-op whole-vault decrypt is now on a hot interactive surface, and the design decision F1
  asked to be documented is still owed.** `listItemsMeta`/`revealItem`/`deleteItem` each decrypt the
  entire vault; the live-TOTP handler calls `revealItem` (a full decrypt) once per period per widget.
  Correct no-plaintext-cache posture, but F1 flagged it and asked F3 to make it an *explicit
  documented decision* — not yet written. → carry to the F4 threat-model/perf notes.
- **The "multiple list paths" count went up (3: `listItems` full / `listItemsMeta` metadata /
  `reachableLoginItems` login-origin) but the divergent-trust debt did not** — the new two share
  `listItems`' decrypt kernel, differing only in projection. Still a footgun (a caller reaching for
  the wrong one leaks plaintext) — add a cross-reference comment at each definition.

### Documentation
- The `docs/` **threat-model page is still unwritten** (F4 owns it). F3 originates several facts it
  must carry (below, Action Items).

## Test Metrics

Third flight to capture metrics; continues the series.

- `npm test`: **2522 / 2522 pass / 0 fail / 0 skipped**, 13 suites, internal `duration_ms` **2204 ms**
  (F1 2214, F2 2093 — flat, no regression). typecheck clean; lint clean. No flakes.
- **Trajectory: F1 2308 → F2 2389 → F3 2522** (F3 +133, monotonic per leg: infra +21, item +35,
  totp +28, setup +27, access-keys +22; 25 test files added/modified). All new suites are pure-logic
  (schema/generator/template/editor-model/handlers) in the sub-ms–low-ms range.
- **No suite got slower.** The three slowest single tests (562/528/453 ms) are the **pre-existing**
  production-scrypt (`N=2¹⁷`) + audit-id-monotonicity tests, not F3's.
- **F1's standing watch-item (`jar-ipc.test.js` own-time creep) is untouched** — F3's only `jars.js`
  change is the value-preserving DD8 reserved-id refactor. Remains a future-flight watch item.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD5 elevated to "no master-equivalent secret in the page DOM" (both password AND recovery on the sheet) | TCB minimization — the page renders attacker-influenced strings; the constrained-template sheet never does | Yes — the invoke-Buffer secret channel is *the* way a master-equivalent secret crosses a renderer boundary |
| In-band `SECRET_UNCHANGED` → out-of-band `{item, unchangedSecrets:[]}` + `saveItemPreservingSecrets` store method | An in-band magic string collides with a real secret value | Yes — out-of-band field-name lists for any partial-secret update |
| Metadata blacklist → **positive whitelist** (`metadataOf`) | A blacklist leaks the note `body`/login `notes`; single-source the taxonomy | Yes — whitelist-projection / complement-preserve from one schema map |
| Structured totp → canonical `otpauth://` **string** | Keeps F1's `parseOtpauth(item.totp)` automation reader unbroken; range-validation hardens F1's ÷0 path too | Yes — store the reader-agnostic canonical form |
| Modal-card refactor relocated leg1→leg4 | Co-locate with the new kinds + the a11y/HAT guards; the card builders were already factored | Yes — refactor where the guards run |
| Schema SSOT stays CJS (main) with the page's ESM layout pinned by a consistency test | Avoids a `require(esm)` at boot on a security path | Yes — the DD8 pin pattern for CJS/ESM boundaries |

## Key Learnings

1. **A rigorous per-leg design-review gate on a flight built atop prior flights catches
   cross-flight-contract breaks that a leg's own diff can't reveal — moving the whole-diff review's
   value earlier.** Three latent "breaks an F1/F2 reader" defects were caught at design, not
   implementation or flight-end. Keep the per-leg gate non-optional for flights extending a prior
   flight's primitives, and add an explicit compatibility-audit step to leg design.
2. **A single-sourced field taxonomy consumed as exact complements is the durable fix for
   render-without-leaking-secrets** — it closed both F2 data-loss classes structurally, not by
   convention.
3. **The internal-page + cross-renderer orchestration is now a proven recipe** (four-gate + the
   `internal-vault-request-*`→`chromeForTab`→`onVaultRequest*`→`openOverlayMenu` path) — document it
   so F4 doesn't re-derive the three-file fan-out.
4. **The page-a11y coverage hole is a genuine gap, not just a deferral** — internal-session pages are
   axe-unreachable by any admin (DD9), so the F5 HAT is *load-bearing* for the vault page's
   keyboard/focus/aria correctness, backed only by pure-model unit tests beneath it.

## Recommendations

1. **F4 must build the from-scratch admin-key provision path** (the top F4 entry item) — F3 setup
   surfaces the recovery key only; `adminPrivateKeyB64` never leaves main, so there is currently no
   way to obtain the first admin key.
2. **Do the `menu-overlay.js` template-registry refactor** (per-kind descriptor table, anchored on
   the extracted `modal-card-controller`) BEFORE F4 adds its sheets — the F2-requested refactor,
   still outstanding, now overdue at 11 kinds.
3. **Write the F4 `docs/threat-model` page** carrying the F2-originated facts PLUS F3's:
   internal-page-is-a-DOM-injection-surface (→ textContent+CSP); the metadata-list + explicit-reveal
   secret-egress model; the invoke-Buffer channel now carrying setup+step-up master secrets; the
   `dismissible:false` one-time-display invariant; the reserved-id SSOT/GLOBAL_ID guard; and the
   **per-op whole-vault-decrypt design decision F1 asked F3 to document (still owed)**.
4. **F4: decide page-op auditing** — the new page management ops (list/reveal/save/delete/totp-code/
   accesskey-list/revoke) are **not audited at all**; combined with the still-open F1 audit-origin
   gap, F4 should decide whether page-side vault-management belongs in the audit trail.
5. **F5 HAT is load-bearing** — the four new sheet a11y states, the vault-page keyboard/focus/aria,
   and the live-only items (the Buffer channel surviving the real contextIsolation clone; the
   dismiss-locked one-time display surviving real blur/Escape under WSLg; the cross-renderer trigger;
   the live TOTP countdown; the generator in the sandboxed page). Bundle any still-open F1
   `vault-mcp-surface` / F2 `vault-human-fill-boundary` Witnessed runs.

## Action Items

- [ ] **F4: from-scratch admin-key provision path** (blocks admin automation; top entry item).
- [ ] **F4: `menu-overlay.js` template-registry refactor** before adding its sheets.
- [ ] **F4: MRK export-bundle** export/import (F1 Known Issue) — the serializer consumes
      `vault-item-schema.js` as the authoritative taxonomy, not a re-enumeration.
- [ ] **F4: rotation** (recovery/master/admin) — must also account for the access envelopes the
      leg-5 list/revoke surface exposes.
- [ ] **F4: audit-origin fix + decide page-op auditing** (new gap: page management ops unaudited).
- [ ] **F4: registrable-domain PSL fill opt-in**; **jar-delete→vault-removal (offer-export-first)** hook.
- [ ] **F4: `docs/threat-model` page** incl. the still-owed per-op whole-vault-decrypt decision +
      the DD9 page-can't-be-axe-audited standing gap.
- [ ] **Mission-level:** record the "`goldfinch://vault` passes `npm run a11y`" page-portion gap as an
      accepted settings-class standing gap (already amended in the mission criterion).
- [ ] **F5 HAT:** the four sheet a11y states + vault-page keyboard/focus + the enumerated live-only items.
