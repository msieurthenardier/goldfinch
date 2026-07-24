# Flight: HAT + Alignment — End-to-End Acceptance

**Status**: completed
**Mission**: [Built-in Password Manager](../../mission.md)

> **Reopened then closed 2026-07-22**: after the debrief the operator added one more leg —
> `hat-fresh-profile-import` — to make the marquee file-based portability criterion (`mission.md:144`, import
> on a FRESH profile) reachable and verify it live. It PASSED (fresh-profile adopt → unlock by master AND
> recovery), closing the criterion. A destination-safety gap found at the gate (a jar vault flattens to
> Global; no wrong-vault warning) was banked as `hat-import-destination-safety` (I20). Flight completed.

## Contributing to Criteria

This is the mission's **closing acceptance gate** — a guided human-acceptance-test session exercising the
built-in password manager end-to-end in a live goldfinch instance, with iterative inline fixes. It does
not add product surface; it **verifies** the mission's success criteria against the real running feature,
with emphasis on the **live-only surfaces** that unit/integration tests structurally cannot reach and that
F1–F4 explicitly deferred here.

Advances (by verifying, live): first-run setup; encrypted-at-rest / no-plaintext; structural
compartmentalization; gesture-gated origin-bound fill; no-secret-in-web-content; comprehensive locking;
TOTP end-to-end; capture-to-save; **portability (export/import across profiles)**; durable-grant step-up;
cryptographic access-key delegation; fill-only MCP wire; `goldfinch://vault` as a first-class internal
page (keyboard/focus/aria); docs. Plus the F4 hardening: **registrable-domain fill**, **audit-origin**,
**jar-delete→vault-removal lifecycle**.

## Pre-Flight

### Objective

Run a guided HAT across the whole feature, fix issues inline (look-and-feel FIXES on the inline protocol;
new-behavior FEATURES promoted to a scoped design review — DD3), and close the mission's deferred
live-only verification: the **sheet-state a11y** (the chrome-class sheet kinds via `npm run a11y`), the
**vault-page keyboard/focus/aria** (manual + unit, since internal pages can't be axe-audited), the
**multi-component flows** (export/import round-trip, rotation one-time displays, the offer-export modal,
the registrable-domain fill), and the enumerated live-only items carried from F1–F4.

### The deferred-to-HAT inventory (what F1–F4 explicitly scheduled here)

- **F1** — the canonical `vault-mcp-surface` Witnessed run (fill-only wire, two access-key tiers, scope
  enforcement, session teardown), if still outstanding.
- **F2** — `npm run a11y` for the sheet templates; the `vault-human-fill-boundary` guest-observable
  behavior test; a true human end-to-end (typing into the real capture/unlock sheet); and 3 live-only
  items: the Buffer channel surviving the real `contextIsolation:true` contextBridge clone, the fill
  icon's positioning across diverse login layouts, the transient-JS-string password lifetime.
- **F3** — the four (F3) sheet a11y states + the `goldfinch://vault` page keyboard/focus/aria (the DD9
  page-can't-be-axe-audited standing gap makes the HAT load-bearing for the page portion).
- **F4** — the export/import round-trip across two profiles (+ the cross-machine master-password
  comprehension path, the highest live-only *design* risk; + the `_pendingVaultImport` dismiss edge); the
  rotation one-time-display sheets (recovery/admin, dismiss-locked, shown once); the registrable-domain
  widen in a real fill (the "Subdomain match" badge + the load-bearing negative: no cross-tenant fill);
  the 4 new sheet kinds' a11y + the 3-element offer-export modal focus cycle; the stale open-vault-page-
  row after a jar delete.

### Design Decisions

**DD1 — Apparatus split: the human DRIVES the chrome sheets; the FD READS them (admin-reachable) for
exact evidence; the Executor drives the guest.** Two distinct reachability facts, established against the
code (the F5 design review corrected an earlier over-claim):
- **The menu-overlay SHEET is admin-READABLE.** It is built on the *default* session (not an internal
  partition), so `isInternalContents(sheet)` is false, and at the **admin tier** the overlay view resolves
  (`enumerateWindows` exposes `sheetWcId`/`sheetVisible` → admin `readDom`/`evaluate`/`click` on it
  succeed; the `npm run a11y` harness already probes the sheet this way). Only `getChromeTarget` is
  toolbar-only (one tool). **The security boundary from F2/F3 still holds** — a *jar* key or hostile page
  cannot reach the sheet (non-tab-contents / out-of-jar); admin reachability is a *verification*
  affordance, not a jar-tier hole.
- **Therefore, for sheet-driven flows the HUMAN drives** (a real gesture / `isTrusted` / the genuine UX —
  human-in-the-loop fidelity the MCP path can't replicate) **and the FD additionally READS the live sheet
  DOM/aria via the admin key** (`enumerateWindows`→`sheetWcId`→`readDom`/`evaluate`) to capture EXACT
  assertions — the aria tree, the focus target, the displayed copy text — rather than relying only on a
  `captureWindow` screenshot + the human's report. `npm run a11y` still covers the chrome-class sheet
  states as the regression net.
- **Guest-observable flows are Witnessed behavior tests** (Executor drives the web page / the `vaultFill`
  MCP tool; Validator reads the guest DOM + the tool result): the origin-bound fill, the fill-only wire,
  jar isolation, and the registrable-domain fill.
- **Act/observe premise (per acceptance surface):** every step names the act path (human gesture / MCP
  tool) and a concrete read path (admin `readDom`/`evaluate` of the sheet, guest `readDom`, the tool
  result, the file written, or — for the internal PAGE, per DD2 — `captureWindow` pixels + human-visual).
  No acceptance criterion asserts a state with no read path.

**DD2 — Page a11y is manual + unit, never axe.** `goldfinch://vault` is an internal-session page that
the op-local `isInternalContents` refusal keeps out of `readAxTree`/lighthouse even for admin (DD9-of-F3,
the accepted settings-class standing gap). So the page's keyboard order, focus management, and aria are
verified by a **manual keyboard walkthrough + a screen-reader spot-check + the existing unit aria tests**
— NOT by `npm run a11y` (which covers only the chrome-class sheet states). This is a known, mission-
accepted limitation, restated so the HAT owns the page-a11y verification explicitly.

**DD3 — Fix-vs-feature gate (per the agentic-workflow HAT protocol).** A mid-HAT operator request that
adds new behavior is a **FEATURE** → promoted to a scoped design review before implementation; only
**look-and-feel FIXES** ride the inline fix protocol. A "cosmetic" fix spanning more than one
surface/page/main-process wiring gets a lightweight Developer design-review pass first. The fix-vs-feature
line is the Flight Director's call, made out loud and logged.

**DD4 — Prerequisites are apparatus, probed before landing.** A running goldfinch with the MCP surface
bound (`npm run dev:automation --automation-dev`); a **second, fresh profile** (a distinct
`userDataPath`) for the import round-trip; and fixtures: at least two jars, a login item with an enrolled
TOTP, a credential with the registrable-domain opt-in ON, and a same-registrable-domain sibling to prove
the widen + the negative. **Named pre-flight task (design-review [HIGH]):** the current push-button
vault-fixture builder (`tests/behavior/fixtures/vault-login/build-fixtures.mjs`) seeds ONE login per
vault at a single origin with **no `matchMode`** — it CANNOT yet provision the `vault-registrable-domain-
fill` fixture (multiple items at distinct origins + the `matchMode` field). Extending the builder
(per-vault multi-origin seeding + `matchMode` support) is a prerequisite for Segment D step 17, done
before that behavior test runs. Plus the `/etc/hosts` PSL-known aliases the behavior spec requires. The
apparatus is probed (can act + can observe) before the flight lands.

### Prerequisites

- [ ] A running goldfinch instance with the automation surface bound (`--automation-dev`), an admin key
      + at least one jar key minted.
- [ ] A second, fresh `userDataPath` profile available for the export→import round-trip.
- [ ] Fixtures: ≥2 jars; a login with an enrolled TOTP (otpauth paste); a registrable-domain-opt-in
      credential + a sibling subdomain + an excluded multi-tenant sibling to prove the negative.
- [ ] `npm run a11y` runnable (covers the chrome-class sheet states, now 15 kinds).
- [ ] The three behavior-test specs present: `vault-mcp-surface` (F1), `vault-human-fill-boundary` (F2),
      `vault-registrable-domain-fill` (new, authored in this flight). Their apparatus probed (live MCP +
      guest observation).
- [ ] **The vault-fixture builder extended** for `matchMode` + per-vault multi-origin seeding (DD4) — the
      current builder can't provision the registrable-domain fixture. Plus the `/etc/hosts` PSL-known
      aliases (`example.com`/`accounts.example.com`, `github.io` tenants) resolvable to the fixture server.

### Pre-Flight Checklist

- [ ] Objective + the deferred inventory agreed with the operator.
- [ ] Design decisions documented (DD1 apparatus split is load-bearing).
- [ ] The new behavior-test spec authored; the two existing bundled.
- [ ] Prerequisites verified (a live instance + a fresh profile + fixtures), not assumed.

## In-Flight

### Guided Verification (the HAT script)

Run as guided segments; present one step at a time, wait for the human to act + report, then proceed.
Fix issues inline (DD3 gate). The segments:

**Segment A — Core: setup, lock, fill, TOTP, capture (F1/F2).**
1. First-run **setup** on the sheet: choose a master password, receive the one-time recovery key + admin
   key (dismiss-locked displays). *Verify*: no secret in the page DOM; the recovery/admin displays are
   shown once and dismiss-locked.
2. **Lock lifecycle**: idle auto-lock, "Lock now", lock-on-quit. *Verify*: unlocked keys clear (a
   subsequent fill refuses with `locked`).
3. **Gesture-gated, origin-bound fill** (guest-observable → behavior test candidate): a fill only after
   an explicit gesture and only on the matching origin; a foreign origin refuses.
4. **TOTP end-to-end**: enroll via otpauth paste; a code generates and is fillable.
5. **Capture-to-save**: submit a login form → the chrome capture sheet offers save; saving does not wipe
   an existing item's TOTP (the F2 fix, live).
6. **Live-only items (F2), via observable proxies**: a successful human-path fill **proves** the Buffer
   secret channel survived the real `contextIsolation:true` contextBridge clone (the proxy — the clone
   itself isn't directly inspectable); the fill icon positions sensibly across ≥3 diverse login layouts
   (guest `readDom`). *(The transient-JS-string password lifetime is a memory property with NO HAT read
   path — as F1's `vault-mcp-surface` already conceded; not asserted here, noted for completeness.)*

**Segment B — Management + rotation (F3/F4).**
7. **`goldfinch://vault` keyboard/focus/aria** (manual + unit, DD2 — the internal PAGE is genuinely
   NOT MCP-readable even by admin; read path is human-visual + `captureWindow` pixels + the unit aria
   tests): tab order matches visual order; focus never strands on `<body>`; item rows + the editor are
   operable by keyboard; a screen-reader spot-check reads labels sensibly.
8. **Item CRUD + the password generator** on the page; secret fields never render a stored secret in the
   page DOM (reveal routes through the item-level path, not master-equivalent).
9. **Rotation** (sheet-driven, manual): rotate the recovery key; change the master password (old-pw
   step-up; wrong old pw refuses); recover-after-forgotten-master (the recovery key unlocks + sets a new
   master). *Verify*: each new secret works, the old is rejected; the one-time displays are dismiss-locked.
10. **Admin rotation/provision** (sheet-driven): mint a fresh admin key; the new key opens all vaults, the
    old is invalidated; the private key shows once, dismiss-locked.
11. **Sheet a11y**: `npm run a11y` passes for all chrome-class sheet states (15 kinds), incl. the new F4
    kinds (import-unlock, change-master, recover, adminkey-show). For any sheet needing an EXACT aria/focus
    assertion, the FD reads the live sheet DOM directly via the admin key
    (`enumerateWindows`→`sheetWcId`→`readDom`/`evaluate`, DD1) rather than a screenshot.

**Segment C — Portability + lifecycle (F4).**
12. **Export → import round-trip across two profiles** (manual, the highest live-only risk): export a
    vault to a file; on a **fresh second profile**, import it — it unlocks by the (source) master password
    AND independently by the export recovery key. *Verify the comprehension path*: the FD reads the live
    import-sheet copy via the admin key (`readDom`/`evaluate` of `sheetWcId`, DD1) and confirms it makes
    clear which secret is required (source master pw / recovery key) — so an operator on a second machine
    isn't misled toward the *destination* master password (the highest live-only design risk; captured as
    exact sheet text, not recollection). Also exercise the **dismiss-without-submit** path (the
    `_pendingVaultImport` stale-ciphertext edge).
13. **Jar-delete offer-export-first** (sheet/modal, manual): deleting a vault-bearing jar surfaces the
    permanence copy + the "Export vault first" button; the confirm's focus cycle is 3-element and
    keyboard-reachable; a locked vault surfaces "unlock to export" (never a faked success). *Verify*: the
    `.gfvault` is removed after delete; a **wipe** on a vault-bearing jar leaves the `.gfvault` intact.
14. **Stale vault-page-row** (read path: human-visual + `captureWindow` pixels — the internal PAGE isn't
    MCP-DOM-readable, DD2): with `goldfinch://vault` open, delete a jar; observe whether the row updates
    (the Leg-6 carry-forward — a fix candidate if it strands a stale row).

**Segment D — Behavior-test suite (Witnessed, guest/MCP-observable).**
15. `/behavior-test vault-mcp-surface` — the canonical fill-only wire + tiers + scope + teardown (F1).
16. `/behavior-test vault-human-fill-boundary` — the guest-observable human-fill trust boundary (F2).
17. `/behavior-test vault-registrable-domain-fill` — the registrable-domain widen (fills the matched
    subdomain via `vaultFill`; **refuses** an excluded multi-tenant sibling; capture on a subdomain does
    not rewrite the apex item's origin) — new, authored this flight.

### Checkpoints

- [ ] (A) Setup + lock + gesture/origin fill + TOTP + capture verified live; no secret in the page DOM.
- [ ] (B) Vault-page keyboard/focus/aria verified (manual); rotation (recovery/master/admin +
      forgotten-master recovery) round-trips live; `npm run a11y` green for all 15 sheet kinds.
- [ ] (C) Export→import round-trip works on a fresh profile by both secrets; the comprehension copy is
      clear; jar delete removes the vault (offer-export-first, 3-element focus) and wipe spares it.
- [ ] (D) All three behavior tests pass.
- [ ] Any issue found is fixed inline (FIX) or promoted (FEATURE) per DD3, and re-verified.

### Adaptation Criteria

**Divert if**: a live surface reveals a design defect (not a look-and-feel fix) — promote to a scoped
design review (DD3), and if it's mission-level, surface to the operator before fixing. **Acceptable
variations**: the exact fixture set; the order of segments; whether the screen-reader spot-check uses
Orca/NVDA/VoiceOver.

### Legs

> **Note:** Interactive/guided legs (`hat-*`) — the human performs verification; the Flight Director
> guides step-by-step and fixes inline. Not autonomously executed.

- [ ] `hat-core-fill-lock` — Segment A: setup, lock lifecycle, gesture/origin fill, TOTP, capture, the
      F2 live-only items *(interactive)*.
- [ ] `hat-management-rotation` — Segment B: vault-page keyboard/focus/aria, CRUD+generator, rotation +
      forgotten-master recovery, admin rotation, `npm run a11y` (15 kinds) *(interactive)*.
- [ ] `hat-portability-lifecycle` — Segment C: export/import round-trip across profiles (+ comprehension
      + dismiss edge), jar-delete offer-export modal, wipe-spares, the stale-row check *(interactive)*.
- [ ] `hat-behavior-suite` — Segment D: run the three Witnessed behavior tests *(interactive; each run
      via `/behavior-test {slug}`)*.

## Post-Flight

### Completion Checklist

- [ ] All four segments verified live; every checkpoint met.
- [ ] Every inline FIX committed; every promoted FEATURE either implemented (post-review) or logged as a
      deferred item with operator disposition.
- [ ] The three behavior tests pass (run logs committed).
- [ ] The mission success criteria confirmed against the live feature; any residual gap recorded.

### Verification

The HAT itself is the verification. Evidence: screenshots (ephemeral, outside the repo per ARTIFACTS.md),
the behavior-test run logs (committed), and the flight-log's per-segment results. On completion, the
mission is ready for `/mission-debrief` + `/routine-maintenance`.

### Mission Criteria — final confirmation

On landing, walk the mission's success criteria one last time against the live feature and record
pass/residual for each. This flight is where "verified against the real environment" becomes true for the
criteria that unit tests could only approximate.
