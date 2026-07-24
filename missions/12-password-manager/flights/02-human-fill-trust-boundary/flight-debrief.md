# Flight Debrief: Human Fill Trust Boundary

**Date**: 2026-07-20
**Flight**: [Human Fill Trust Boundary](flight.md)
**Status**: landed
**Duration**: 2026-07-20 (single-session autonomous execution)
**Legs Completed**: 4 of 4 (lock-icon-inject, chrome-unlock, pick-and-fill, capture-save)

## Outcome Assessment

### Objectives Achieved

The flight delivered the mission's **human trust boundary** on top of F1's crypto core: a
decorative, spoofable lock icon injected into detected login forms; a chrome-owned
master-password **unlock** prompt and a badged **vault picker** rendered on the menu-overlay
sheet (never in page DOM); the gesture → unlock → pick → **fill** flow reusing F1's `vault-fill`
main→preload channel (exact-origin, top-frame, burner-suppressed); and a chrome-rendered
**capture** (save/update) prompt on login-form submission. The load-bearing invariant — *the
master password is only ever entered into chrome-owned UI* — is realized, and **every secret
stays in main**: the master password rides a dedicated zeroized-`Buffer` invoke channel, the fill
credential is resolved and dispatched only in main, and the captured password lives in a
short-lived main-side record. Zero new runtime dependencies.

### Mission Criteria Advanced

- **No vault secret entered into / readable from web content; master password chrome-only; icon
  decorative** — **fully** (F2's core; grep- and test-confirmed across all three secret paths).
- **Fill is gesture-gated, origin-bound, top-frame — the human path** — **fully** at the
  logic/unit/integration layer; the guest-observable behavior test + true human end-to-end are
  the deferred live-GUI / F4-HAT segment (DD8).
- **Compartmentalization is structural — the fill-surface picker** shows only {active jar,
  global}, badged, never a sibling jar's credentials — **fully** (`reachableLoginItems` +
  `vaultFillHuman`'s ordered gates; the burner-`ineligible`-before-scope linchpin).
- **Capture offers to save** — **fully** for real-form submits when set up **and unlocked** (a
  deliberate v1 narrowing — see go/no-go item); SPA/fetch logins are a documented F3 gap.

### Checkpoints

- **(a)** lock-icon injection + trigger channel — met (pure-helper unit + channel wiring).
- **(b1)** chrome unlock + lock-state — met (invoke Buffer secret channel, dual-zeroize,
  `onUnlock` from `_installMrk`, `#vault-indicator`).
- **(b2)** reachable read + picker + human fill — met (integration; password never in any
  model/selection/return).
- **(c)** capture — met (held-record pipeline; `saveItem`); **a11y + the guest-observable
  behavior test remain the deferred live-GUI steps** the go/no-go schedules for F4.

## What Went Well

- **DD8 (apparatus premise audit) was the standout.** The observability-axis audit established
  *before legs locked* that the chrome-owned sheet's WebContents is MCP-unreachable, and the
  flight held that as a **security property** — the sheet wcId was never registered for the
  automation surface for test convenience. Verification split exactly as designed (unit +
  main-process integration simulating sheet IPC + one guest-observable behavior test + F4 HAT).
  This is the premise audit paying off, not a mid-flight scramble.
- **Every secret held as a zeroizable Buffer in main, three secret paths proven never to cross
  into chrome/sheet/returns.** The security-property tests are *meaningful, not vacuous* — the
  no-password-in-payload test greps a real fixture password out of the actual offer object;
  zeroization is asserted by snapshotting the Buffer reference and checking `.every(b===0)` on
  both arrays across success / auth-failure / non-auth-throw.
- **The structural burner compartmentalization held with a subtle, correct ordering** —
  `vaultFillHuman` refuses `!tabJar → ineligible` *before* the cross-vault assert, because a bare
  `vaultId ∈ {global, tabJar.id}` passes for a burner tab when `vaultId='global'`. Caught at the
  Leg-3 design review, pinned by a dedicated test.
- **DD10 landed more-correct-than-drafted** — the cycle-2 design review moved `onUnlock` to the
  `_installMrk` choke point, so recovery/admin unlock (F3 UIs) also broadcast; the indicator can
  never show "locked" while unlocked.
- **Every leg ran a HIGH-tier per-leg design review (1 cycle each), and every green in one pass**
  — full suite monotonic 2308 → 2314 → 2330 → 2353 → 2387 → 2389.

## What Could Be Improved

### Process
- **A leg AC specified the wrong behavior and was *literally* met** — leg-04's "an update
  overwrites the existing item" verified exactly the wholesale overwrite that caused the
  capture-update data loss. **Negative/preservation ACs should be written explicitly** ("update
  must **preserve** unspecified fields such as `totp`") rather than left as "overwrite," which
  reads as satisfied while hiding data loss.

### Technical
- **`saveItem`'s wholesale-replace-on-update is a live footgun, patched at one call site only.**
  The flight-end fix (read-merge in `captureSave`) closes *this* instance; `saveItem` itself still
  silently drops fields on any bare-item update, and **F3's per-credential edit surface will hit
  the identical semantics.** The class is not closed — see Action Items.
- **Two divergent list paths now materialized** (`reachableLoginItems` human/MRK vs
  `vault-context.list()` automation/session-key) — real latent debt on different key states that
  must never be conflated (F1's debrief predicted this).
- **Sheet template boilerplate** — 7 dedicated template kinds (+349 lines in `menu-overlay.js`),
  three of them near-parallel backdrop-card modals (unlock/picker/capture share backdrop +
  Tab-trap + Escape). A small template-registry / shared-modal-card factor is worth it before an
  8th kind lands.

### Documentation
- The mission's `docs/` **threat-model page is still unwritten** (that criterion targets F3). F2
  originates several facts it must hand forward: the icon-is-decorative/spoofable model; that the
  `isTrusted` gate is **annoyance-hardening only, not a security boundary** (contextIsolation is
  off — a page can override the getter; the real boundary is the chrome-owned sheet); the
  invoke-Buffer secret channel + the transient-JS-string limitation; and the DD8 caveat that an
  admin key *could* `readDom` the sheet if it ever held the raw wcId (a dedicated resolver guard
  was deferred — the boundary currently holds by non-exposure).

## Test Metrics

Second flight in this mission to capture metrics; continues the series.

- `npm test`: **2389 tests / 2389 pass / 0 fail / 0 skipped**, exit 0. Node internal `duration_ms`
  **2093 ms** (wall 2.23 s), peak RSS ~262 MB, 137 test files. No flakes.
- **Delta vs F1: 2308 → 2389 = +81**, monotonic across the legs (lock-icon +6, chrome-unlock +16,
  pick-and-fill +23, capture-save +34, +2 from the flight-end TOTP-merge fix). All new tests
  concentrate in the new vault suites; `vault-capture.test.js` (~26) is the heaviest, matching
  capture's HIGH risk tier.
- **No suite got slower.** New suites are cheap (vault-capture 0.37 s, vault-human 0.25 s,
  vault-store-reachable 0.17 s). `vault-crypto` unchanged at 0.88 s (F1: 0.89 s — the one
  production-scrypt test still dominates it, by design). The slowest single test in the run
  (604 ms, a **pre-existing** audit-id monotonicity test) is not F2's. **F1's standing watch-item
  — `jar-ipc.test.js` own-time creep — is untouched** (F2 added no jar-ipc work); it remains a
  future-flight watch item.
- `npm run typecheck` clean; `npm run lint` clean.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD4 secret channel `send` → **`invoke`** | The wrong-password re-prompt needs the `{ ok }` result back at the still-open sheet | Yes — the invoke-Buffer secret channel is the canonical way to move a secret off a `contextIsolation:true` sheet |
| DD5 reachable-items method moved chrome-unlock → **pick-and-fill** | Co-locate with its first consumer (the picker); keep chrome-unlock a tight secret+lock-state surface | Yes — the cycle-2 "heaviest leg" flag paying off; co-locate a method with its consumer |
| `vault-picker`/`vault-capture` became **dedicated template kinds** (not `'menu'` aliases) | `'menu'` renders only label+dot, can't emit a selection value or render title+username+badge | Yes — the dedicated-template-kind recipe (now proven 3×) |
| Sheet templates extracted to pure `src/shared/*-template.js` builders | The sheet IIFE isn't unit-loadable (no jsdom); each AC needs a structure/aria unit test | Yes — pure sibling for any sheet template needing a unit test |
| capture-update **read-merge** instead of bare `saveItem` replace | Flight-end review: bare replace wiped the login's `totp` seed + custom title (data loss) | Yes — read-merge at **every** update call site until `saveItem` is merge-aware |

## Key Learnings

1. **The flight-end whole-diff review caught the one real defect — again — exactly where per-leg
   review is structurally blind.** The capture-update TOTP-wipe is an emergent interaction between
   *F2's* capture-update and *F1's* `totp` field; no leg's own diff contained both, so only the
   whole-diff read could see it — a direct repeat of F1's `'global'` sentinel lesson. **Keep the
   flight-end whole-diff review non-optional.** This was the strongest process signal of the flight.
2. **Premise-auditing the behavior-test apparatus before locking legs prevents a mid-flight
   scramble.** DD8 established the sheet's MCP-unreachability up front and shaped the verification
   split; nothing had to be reworked reactively to observe the state under test.
3. **"Every secret resolved and dispatched only in main," enforced by grep-ACs for secret egress,
   is a strong, testable discipline** — promote the grep-AC-for-secret-egress convention across the
   rest of the mission.
4. **A "wrong-behavior AC that is literally satisfiable" is a real risk class** — prefer negative/
   preservation ACs for any update/merge operation.

## Recommendations

1. **Close the `saveItem` data-loss class in F3** (highest carry-forward): make `saveItem`
   merge-aware for updates, or mandate the read-merge idiom at every update call site — F3's
   per-credential edit will otherwise reintroduce the TOTP-wipe. The current fix is per-instance.
2. **Ratify or reopen the unlocked-only capture gate** (the flagged go/no-go). If locked-time
   capture (prompt→unlock→save on submit) should ship, it's an F3/F4 enhancement.
3. **Write the F3 `docs/threat-model` page** with the F2-originated facts (icon-spoofability;
   `isTrusted` is annoyance-only; the invoke-Buffer channel + JS-string limitation; the admin-key
   sheet-`readDom` caveat and whether F3 closes it with a resolver guard or documents it as
   accepted since admin ⊇ operator).
4. **Standardize the three emerged patterns** — the dedicated-template-kind recipe, the
   invoke-Buffer secret channel, the held-record + `captureId` choke-point pattern — and consider a
   template-registry refactor before an 8th sheet kind.
5. **Schedule the deferred live-GUI verification for the F4 HAT**: `npm run a11y` for the 3 new
   sheet templates; the `vault-human-fill-boundary` guest-observable behavior test; the true human
   end-to-end (typing into the real sheet); plus three live-only items to name in the HAT plan —
   the Buffer channel surviving the real `contextIsolation:true` contextBridge clone, the icon's
   positioning across diverse login layouts, and the transient-JS-string password lifetime. Bundle
   F1's still-unrun canonical `vault-mcp-surface` Witnessed test if outstanding.

## Go/No-Go Disposition (operator, 2026-07-20)

Operator reviewed the debrief and **marked Flight 2 `completed`**, **ratifying the unlocked-only
capture gate as the v1 behavior** (locked-time capture stays an optional F3/F4 enhancement, not a
committed item). Next step: **design Flight 3** (management surface). Go for F3.

## Action Items

- [x] **Operator go/no-go: ratified the unlocked-only capture gate** as v1 (2026-07-20); locked-time
      capture is an *optional* F3/F4 enhancement, not committed.
- [ ] **F3: close the `saveItem` merge-on-update class** (not just the capture instance) before the
      per-credential edit surface lands.
- [ ] F3: write the `docs/` vault file-format + **threat-model page** (icon-spoofability, `isTrusted`
      annoyance-only, invoke-Buffer channel + JS-string limit, admin-key sheet-`readDom` caveat).
- [ ] F3: the **MRK export-bundle** Known Issue, the **audit-origin** fix, the **registrable-domain**
      PSL-hardened opt-in (not `trackers.js`), and the **reserved-id single-source-of-truth guard**
      (carried from F1) — all still open.
- [ ] F4 HAT: run `npm run a11y` (3 new templates) + `/behavior-test vault-human-fill-boundary` +
      true human end-to-end; name the 3 live-only items; bundle F1's canonical `vault-mcp-surface`
      Witnessed run if still outstanding.
- [ ] Consider a **template-registry refactor** before an 8th menu-overlay sheet kind.
