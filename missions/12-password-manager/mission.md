# Mission: Built-in Password Manager

**Status**: active

> Source feature request: [goldfinch#100](https://github.com/msieurthenardier/goldfinch/issues/100).
> Operator pre-authorized autonomous execution at mission design (2026-07-20): the Flight
> Director makes judgment calls through flights and debriefs without pausing, and the
> mission closes with a HAT flight where the operator reviews the implementation and
> outstanding issues are addressed. The security-critical flights (F1–F3) build on each
> other, so each flight's debrief is the natural go/no-go point.

## Outcome

Goldfinch has a **built-in password manager** — its own, not the always-on autofill
of mainstream browsers. The operator sets one master password and is handed one
printable recovery key, exactly once. From then on, credentials live in encrypted
vaults that are **locked by default** and fill only after an explicit gesture: a
lock icon in a login field opens a **chrome-owned** unlock prompt, an unlocked vault
re-locks after idle, and no vault secret is ever typed into or readable from web
content — except the one credential being filled into the origin that owns it.

Vaults are **compartmentalized the way jars are**: one vault per persistent jar plus
one global vault, so a jar only ever sees its own credentials and the shared ones —
a wrong-vault pick is structurally impossible, not merely discouraged. Vaults are
**portable** — a `.gfvault` file exports and re-imports on another device, where the
master password or the recovery key unlocks it, with no cloud in the loop. Login
items can carry a **TOTP secret**, so the manager generates rotating MFA codes.

And because Goldfinch treats agents as first-class users, the manager is
**drivable by automation** — but through **scoped, revocable vault access keys**,
never the human master password, over a deliberately narrow **fill-only** MCP
surface. An agent holding a per-jar access key can unlock, list (metadata only),
fill, and read a TOTP code for its own jar — and is *cryptographically* unable to
reach any other vault, because no envelope for it exists. This makes the hardest,
most security-critical layer the first thing built and the first thing tested.

## Context

**Why now.** Goldfinch's thesis — established across M03 (automation surface) and
sharpened since — is *a browser for a world where software agents are first-class
users alongside people*, resting on three pillars: **control**, **privacy**, and
**automatability**. A password manager is a natural next capability that exercises
all three at once: it is per-jar-compartmentalized (privacy), explicit-gesture-only
(control), and agent-drivable through scoped grants (automatability). Issue #100 is
the request, and it arrives already specified in unusual depth.

**The feature is deliberately modeled on dedicated password managers, not browser
autofill.** Master password + recovery key, explicit unlock, encrypted vaults,
idle re-lock — the industry-standard dedicated-manager posture — rather than the
frictionless always-on autofill that trades security for convenience.

**Feasibility is grounded in existing substrate.** A subsystem map taken during
mission design confirmed every precedent the request leans on:

- **Zero-runtime-dependency identity holds.** Today `dependencies` is a single entry
  (`@modelcontextprotocol/sdk`, confined to `mcp-server.js`); everything else is
  dev-only. All vault primitives — scrypt, AES-256-GCM, HMAC (TOTP), X25519, CSPRNG
  — are in Node's built-in `node:crypto`, already used (lightly) by
  `automation-auth.js`. No native module, no Argon2id (which would need one).
- **Standalone files, not `app.db`.** `app.db` (M10) handles corruption by
  *quarantine-and-reseed-fresh-defaults* — correct for settings, catastrophic for
  secrets. Vaults persist as self-contained `.gfvault` files via the pre-M10 atomic
  temp-write+rename discipline, and a corrupt vault must surface loudly, never be
  silently recreated. The on-disk format **is** the export format.
- **The automation surface has clean seams.** The MCP tool registry
  (`mcp-tools.js`), the two-tier key model (`mintJarKey` / `mintAdminKey`,
  `automation-auth.js`), jar-scoping (`scope.js`), the bounded audit-log ring
  (`audit-log.js`), and the toolbar activity indicator all extend to fill-only vault
  tools and a separately-minted vault access-key secret.
- **The trust-boundary machinery exists.** `webview-preload.js` already runs in the
  guest main world (media catalog, fingerprint hooks) — the injection/detection/
  main-communication pattern the lock icon and login-form detection build on. The
  menu-overlay **input-dialog** sheet (the new-container-dialog precedent) is how a
  chrome-owned modal renders without touching page DOM, driven by the APG
  `menu-controller`.
- **The internal-page checklist is real and documented** (four gates,
  `registerInternalHandler`, `INTERNAL_HOSTS`/`INTERNAL_ORIGINS`, strict CSP) — the
  path `goldfinch://vault` follows, alongside `settings`/`downloads`/`jars`.
- **Compartmentalization reuses the positive persist-jar allowlist idiom**
  (`resolvePersistJar`) and the `BURNER ∉ jars.list()` structural exclusion, so
  burner and internal partitions get no vaults with no dedicated exclusion code.
- **Registrable-domain logic exists** (`trackers.js` `registrableDomain`) but is a
  *curated tracker-suffix set*, **not PSL-complete** — it mis-resolves ccTLD
  second-levels (`example.co.uk` → `co.uk`). Safe for its tracker-classification
  purpose; a credential-leak vector if a fill opt-in rode it unchanged. So
  **exact-origin is the default and the only guaranteed-safe scope**; the
  registrable-domain opt-in must harden matching (PSL or an expanded suffix set
  covering ccTLD second-levels) before it can gate a fill.

**One inherited constraint surfaced during mapping:** internal pages cannot be
`--target` a11y-audited (the eval tools exclude the internal session even for the
admin key), exactly as `goldfinch://settings` cannot. `goldfinch://vault`'s
accessibility coverage therefore rides the chrome-state driving path that
`a11y-audit.mjs` already uses, not a target audit.

**Sequencing rationale (operator-directed).** Automation is built *first*, folded
into the crypto core, because (a) it is the hardest, most security-critical layer
and difficult bits belong early, and (b) it is the natural end-to-end test harness —
the access-key scope model can be exercised the moment it exists, before any human
UI is in place.

## Success Criteria

Criteria are capability-framed and binary. Several are only observable against the
real running app (fill into live pages, chrome-owned prompts, MCP round-trips);
those are marked **[behavior-test]** and the owning flight plans the spec.

- [ ] **First-run setup** establishes the manager: the operator chooses a master
      password and is shown a printable recovery key exactly once; each vault key is
      independently unlockable by *either* secret — verified by recovering a vault
      with the recovery key after a forgotten master password forces a new one.
- [ ] **Vaults are encrypted at rest and reveal no plaintext secret** anywhere on
      disk (including logs), remain self-contained per file, and add **zero new
      runtime dependencies**. A wrong key fails authenticated decryption rather than
      returning garbage.
- [ ] **Compartmentalization is structural:** unlocking in jar A leaves jar B's
      vault locked; the fill surface for a tab shows only that jar's vault plus the
      global vault, each badged — never a sibling jar's credentials. Burner and
      internal partitions have no vaults at all.
- [ ] **Fill is gesture-gated and origin-bound:** credentials fill only after an
      explicit user action, only for an origin-matched login (exact origin by
      default; registrable-domain matching as a per-credential opt-in), top-frame
      only — never automatically on load and never into a cross-origin iframe. The
      registrable-domain opt-in uses hardened matching, not the tracker-classification
      suffix set, so it never shares a credential across an unrelated ccTLD sibling.
      **[behavior-test]**
- [ ] **No vault secret is entered into or readable from web content** except the
      single credential being filled into its owning origin: the master password,
      recovery key, and picker all render in chrome-owned UI; the injected lock icon
      is decorative and gains a hostile page nothing if faked or hidden.
      **[behavior-test]**
- [ ] **Locking is comprehensive:** idle timeout, an explicit "Lock now", app quit,
      and jar wipe all re-lock; unlocked keys live only in main-process memory and
      are never persisted. Jar **wipe spares** the vault; jar **delete removes** it
      after offering an export first.
- [ ] **TOTP works end-to-end:** a login enrolls a TOTP secret by pasting an
      `otpauth://` URI or base32 secret; the manager shows the live rotating code
      with a countdown and offers it for fill or copy after a login fill; generated
      codes match a reference implementation.
- [ ] **Capture offers to save:** submitting a login form raises a chrome-rendered
      save-or-update prompt (update when origin+username already exists), defaulting
      to the active jar's vault with the global vault selectable, only when the
      manager is set up. **[behavior-test]**
- [ ] **Portability is file-based:** an exported vault imports on a fresh profile and
      unlocks with the master password and, independently, with the recovery key —
      with no network egress at any point.
- [ ] **Durable-grant operations demand step-up re-auth:** minting any access key and
      rotating the recovery key each require a fresh master-password confirmation
      even while the vault is unlocked, and a wrong password refuses the operation;
      ordinary unlock-window operations (fill, reveal/copy, TOTP display, encrypted
      export) are not re-prompted.
- [ ] **Access-key delegation is cryptographic, not policy:** an access key mints
      only while its target vault is unlocked; a per-jar key unlocks its own jar's
      vault and **cannot** unlock the global vault or a sibling jar's — verified as
      an *absent-envelope* property, not a runtime check (the test inspects the vault
      file's envelope set for the absence of a grantee envelope, not merely an "unlock
      refused" from the wire — the two are otherwise indistinguishable); the admin key
      unlocks every vault including a jar vault created *after* the admin key was
      minted; revocation (envelope deletion) takes effect immediately. **[behavior-test]**
- [ ] **The MCP wire stays fill-only:** no tool at any tier returns a stored password
      over the channel; `vaultList` returns metadata only; `vaultTotp` returns only
      the current code; every unlock, fill, and TOTP issuance lands in the audit log
      and reflects on the automation-activity indicator. Automation unlock state is
      session-scoped: it clears on MCP session teardown, and — because a JSON-response
      client may hold no long-lived stream to signal an ungraceful drop — the idle
      auto-lock timer is the belt-and-suspenders guarantee that an abandoned session's
      keys do not linger. **[behavior-test]**
- [ ] **`goldfinch://vault` is a first-class trusted internal page:** it follows the
      full four-gate checklist with `registerInternalHandler`-wrapped IPC and strict
      CSP. **a11y coverage (amended 2026-07-21 after the F3 design review):** internal
      pages cannot be `npm run a11y`-audited even by an admin key (the MCP eval tools carry
      an op-local internal-session refusal — a pre-existing gap shared with
      `goldfinch://settings/downloads/jars`), so the vault page's a11y is covered the same
      way theirs is — the vault's chrome-owned **sheet** states are axe-audited via the
      chrome-state path, and the **page** DOM is covered by unit DOM/aria tests + the F5 HAT
      keyboard/focus pass. It offers item CRUD with reveal/copy, per-vault export/import,
      recovery-key rotation, master-password change, the auto-lock duration setting,
      per-vault access-key management (mint/list/revoke), and a password generator for new
      logins.
- [ ] **Docs reflect the feature:** the architecture section (`CLAUDE.md`) and a
      `docs/` page covering the vault file format and threat model are updated,
      including the user-facing property that losing both the master password and the
      recovery key makes the vault cryptographically unrecoverable by design.

## Stakeholders

- **The operator** — gains a private, portable password manager that never trusts
  the open web and never phones home.
- **Automation / AI agents operating under a jar identity** — can drive
  MFA-protected login flows end-to-end through a narrow, revocable grant, without
  ever holding the human master password.
- **Goldfinch's own test + a11y tooling** — the fill-only MCP surface is both the
  feature and the harness that verifies it.
- **Project maintainer (reviewer)** — needs confidence that the security invariants
  (trust boundary, cryptographic scope, zeroization) hold; the closing HAT flight is
  the review gate.

## Constraints

- **Zero new runtime dependencies.** All crypto from `node:crypto` (scrypt,
  AES-256-GCM, HMAC, X25519, CSPRNG). Argon2id is out (native module).
- **No plaintext secret on disk, ever** — not in vault files, not in `app.db`, not in
  logs. Unlocked keys live only in main-process memory. In-memory scrubbing is
  best-effort by nature (V8 strings are immutable and unscrubbable); secrets that must
  be wiped (vault keys, and ideally the master password handed from the chrome prompt)
  should travel as `Buffer`s that can be `.fill(0)`'d rather than as strings.
- **Vaults are NOT stored in `app.db`.** Standalone `.gfvault` files with atomic
  temp-write+rename; a corrupt vault surfaces loudly and is never quarantined or
  recreated.
- **The master password is only ever entered into chrome-owned UI** — never into page
  DOM. This is the load-bearing invariant of the whole feature.
- **Fill guardrails are non-negotiable:** user-gesture-only, origin-matched,
  top-frame only in v1.
- **The human master password never appears in any config file** — automation is
  delegated exclusively through separately-minted vault access keys.
- **No network egress.** Export/import is file-based; no cloud sync.
- **Preserve the internal-page trust model** — all four gates, `registerInternalHandler`,
  strict CSP, listener-handle cleanup.

## Environment Requirements

- **Development environment**: local Electron toolchain (Electron `^42`), Node with
  built-in `node:sqlite` and `node:crypto`; `npm run dev` / `npm run dev:automation`.
- **Runtime**: GUI required (Electron desktop app); loopback-only MCP automation
  surface for the automation flight and behavior tests.
- **Testing**: unit/integration for the headless crypto core; behavior tests (live
  Executor + Validator over the MCP + chrome surfaces) for fill, capture, the
  trust boundary, and the automation wire; `npm run a11y` (ATTACH model, live GUI,
  admin key) for `goldfinch://vault`.
- **Reference implementation** for TOTP verification (any RFC 6238 generator) to
  cross-check generated codes.

## Open Questions

Resolved at the owning flight, not blocking mission approval:

- **scrypt parameters** — target unlock latency vs. brute-force margin; benchmark on
  the dev rig. Use async `crypto.scrypt` (not `scryptSync`, which blocks the main
  process) and raise `maxmem` above the 32 MiB default if N warrants; target a
  defensible margin given scrypt's weaker memory-hardness vs. the rejected Argon2id.
  *(Flight 1)*
- **Access-key composition on the wire** — a third credential axis layers onto the
  existing two-tier MCP bearer model: the MCP session identity (jarId) scopes *which
  vault an agent may name*, while the access-key envelope is what *cryptographically
  unlocks* it. Does the access key travel as a per-call tool argument or via a separate
  unlock handshake, and how does it compose with the jar-scoped session? *(Flight 1)*
- **Ungraceful-disconnect zeroization** — the current MCP teardown trigger is the GET
  SSE stream close, which a JSON-response POST-only client may never open. Is an open
  SSE liveness lease a precondition for holding an unlocked key, or does idle auto-lock
  carry the zeroization guarantee alone? *(Flight 1)*
- **Zeroization fidelity** — is best-effort acceptable for the master password (JS
  string, unscrubbable), or should the chrome-owned prompt hand it to main as a
  transferable `Buffer` for `.fill(0)`? *(Flight 1, informed by Flight 2's prompt)*
- **Registrable-domain opt-in hardening** — the opt-in must not ride the
  tracker-classification suffix set (not PSL-complete; mis-resolves `co.uk`). Expand to
  a credential-safe suffix set, adopt a PSL, or keep exact-origin as the only supported
  scope. *(Flight 2)*
- **Password-field detection heuristics** — `type=password` alone vs. login-form
  scoring; and how the injected lock icon coexists with page styling without
  shadow-DOM isolation (position/z-index strategy). *(Flight 2)*
- **Vault-page unlock timing** — prompt on load vs. on first interaction. *(Flight 3)*
- **Admin-key rotation mechanics** — because each vault carries an independent master
  envelope, one master-password-authenticated pass can unwrap every vault's key and
  re-seal its admin envelope, avoiding per-vault prompts *and* the lazy stale-envelope
  window. Confirm this eager one-pass path over lazy re-seal. *(Flight 1, may defer
  visible UI to Flight 3)*
- **`vaultFill` form submission** — may it optionally submit after filling, or is
  filling strictly the boundary? *(Flight 1)*
- **Exported vaults and access-key envelopes** — do exports carry access-key envelopes
  (portable automation grants) or strip to password + recovery envelopes? *(Flight 1
  format decision; surfaced in Flight 3 export UI)*
- **Password generator UI** — length/charset controls scope, confirmed **in v1**
  (Flight 3).
- **safeStorage codec seam interaction** — expected none (vault crypto is
  self-contained and portable by design); confirm during Flight 1. *(Flight 1)*

## Known Issues

- [ ] **MRK shifts single-file portability to an export bundle** — discovered in Flight 1
      (Leg 2 `vault-store`), affects Flight 3 (export/import). The adopted Manager Root Key
      composition (one MRK wrapped under master/recovery/admin in `manager.json`; each vault
      key wrapped under the MRK — the faithful realization of the mission's *manager-wide*
      recovery key + lazy-jar-creation-mints-no-secret requirements) means a `.gfvault` file
      is not *independently* unlockable. **F3 export must bundle the `manager.json` MRK
      envelope set (master + recovery envelopes) with the exported vault, or re-wrap the
      exported vault key under fresh master/recovery envelopes at export time**, so the
      "imports on a fresh profile and unlocks with the master password or recovery key"
      criterion still holds. No network egress; still file-based. See Flight 1 log Decisions.
- [ ] **Audit trail records the vault *event* but not the *origin*** — discovered in Flight 1
      (debrief), affects the MCP-wire criterion + F2/F3. `deriveAuditDetail` is args-only, but the
      resolved fill origin lives in the tool result, so `vaultFill`/`vaultTotp` audit `item=<id>` only
      and `vaultUnlock`/`vaultList` derive a null origin. Every unlock/fill/TOTP *event* is audited
      (that criterion holds), but the intended origin-in-audit does not. Fix needs a **result-aware
      detail hook**, not the args-only seam — or a deliberate decision to accept event-only auditing.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and
> created one at a time as work progresses. This list will evolve based on discoveries
> during implementation.

- [x] Flight 1: **Vault core + automation surface** — the `.gfvault` format, KDF and
      all four envelope types (master / recovery / per-jar symmetric / admin X25519),
      AES-256-GCM item crypto, unlock-state lifecycle + auto-lock + zeroization,
      step-up re-auth policy gate, RFC 6238 TOTP generation, the structural
      burner/internal exclusion, and the fill-only MCP surface (`vaultUnlock` /
      `vaultList` / `vaultFill` / `vaultTotp`, two access-key tiers, cryptographic
      scope enforcement, session-scoped teardown, audit integration). Verifiable
      end-to-end over MCP with no UI. *(Hardest, most security-critical layer, built
      and tested first.)* This is the single largest risk concentration in the mission
      — plan it leg-gated with hard go/no-go checkpoints at (a) KDF + envelope core,
      (b) TOTP generation, (c) MCP surface + absent-envelope scope.
- [x] Flight 2: **Human fill trust boundary** — `webview-preload.js` lock-icon
      injection (decorative/spoofable), the chrome-owned unlock prompt + picker on the
      menu-overlay sheet, the gesture-only / origin-matched / top-frame fill flow, and
      the chrome-rendered capture (save/update) prompt. *(Landed 2026-07-20; debrief pending.)*
> **F3 split (2026-07-20, operator-approved):** the original single "Management surface +
> portability" flight spanned two distinct design/risk domains — the management-page UI vs.
> export-format + key-rotation crypto — so it was split into F3 (management page) + F4
> (portability + rotation + hardening + docs), and the HAT moved to F5. Most F1 crypto/store
> primitives already exist unwired; the split isolates the durable-credential + export-format
> crypto (F4) behind its own planning conversation and review gate.

- [x] Flight 3: **Vault management page** — the `goldfinch://vault` internal page (four gates,
      `registerInternalHandler`, strict CSP, chrome-state-path a11y), first-run setup UI (choose
      master password + show recovery key once), item CRUD (login/card/note) with reveal/copy and
      the `saveItem` merge-on-update fix, TOTP enrollment + live rotating display, a password
      generator, access-key management UI (list/mint-with-step-up/revoke), the auto-lock duration
      setting, and the reserved-id single-source-of-truth guard.
- [ ] Flight 4: **Portability + rotation + hardening + docs** — per-vault export/import (the
      MRK-bundle format — a `.gfvault` alone isn't independently unlockable), recovery-key
      rotation, master-password change, admin-key rotation (eager one-pass re-seal), the
      registrable-domain PSL-hardened per-credential fill opt-in, the audit-origin fix, the
      jar-delete → vault-removal (offer-export-first) lifecycle hook, and the docs + threat-model
      page.
- [ ] Flight 5 *(optional)*: **HAT + alignment** — guided human-acceptance-test session
      exercising the real feature end-to-end (incl. the deferred live-GUI steps from F2/F3), with
      iterative fixes for outstanding issues from F1–F4.
