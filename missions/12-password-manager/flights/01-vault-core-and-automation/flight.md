# Flight: Vault Core + Automation Surface

**Status**: completed
**Mission**: [Built-in Password Manager](../../mission.md)

## Contributing to Criteria

Mission criteria this flight advances (fully or as the headless/automation half of a
criterion whose human-UI half lands in F2/F3):

- [ ] Vaults encrypted at rest, no plaintext secret on disk, zero new runtime deps, wrong key fails authenticated decryption — **fully**.
- [ ] Compartmentalization is structural (unlock in jar A leaves jar B locked; burner/internal partitions have no vaults) — **fully at the key-derivation + store layer** (the fill-surface picker badging is F2).
- [ ] TOTP generation matches a reference implementation — **fully** (enrollment + live display UI is F3).
- [ ] Durable-grant operations demand step-up re-auth — **the access-key-minting half** (recovery-key rotation is F3).
- [ ] Access-key delegation is cryptographic, not policy (absent-envelope property; admin seals to future vaults; revoke is immediate) — **fully**.
- [ ] MCP wire stays fill-only; no tool returns a stored password; `vaultList` metadata-only; `vaultTotp` current-code-only; every unlock/fill/TOTP audited; session-scoped zeroization — **fully**.
- [ ] Fill is gesture-gated, origin-matched, top-frame only — **the automation path** (the human lock-icon gesture is F2).
- [ ] No vault secret is readable from web content except the filled credential — **the wire half** (`vaultFill` never returns the password; main→preload injection). The master-password-in-chrome-only half is F2.

---

## Pre-Flight

### Objective

Build the entire cryptographic core of the password manager and its fill-only MCP
automation surface, so a vault can be created, unlocked with a scoped access key,
listed (metadata only), filled into a live login page (without the password ever
crossing the MCP wire), and queried for a TOTP code — end-to-end over MCP, with no
management UI in existence yet. This is the mission's hardest, most security-critical
layer, built and verified first so F2 (human trust boundary) and F3 (management
surface) build on a proven substrate.

### Open Questions

- [x] scrypt parameters and blocking → **DD11** (async `crypto.scrypt`, benchmarked, `maxmem` raised as needed)
- [x] How the vault access key composes with the existing MCP session identity → **DD4**
- [x] Ungraceful-disconnect zeroization approach → **DD5** (idle auto-lock backstop, no SSE lease)
- [x] Does `vaultFill` submit the form → **DD7** (strictly fill, never submit)
- [x] Admin-key seal-to-future vs. rotation split across flights → **DD12**
- [x] First-run setup / unlock / mint with no UI in F1 → **DD9** (store API drives it; UI is F2/F3)
- [ ] Exact scrypt N/r/p values — resolved by the Leg 1 benchmark, recorded in the flight log
- [ ] Whether exported vaults carry access-key envelopes — F1 makes the envelope set independently removable (DD3); the strip *policy* is an F3 export-UI decision, not resolved here

### Design Decisions

**DD1 — Standalone `.gfvault` files, never `app.db`**: Vaults persist as self-contained
files (`userData/vaults/global.gfvault`, `userData/vaults/<jarId>.gfvault`), not as
`app.db` document rows.
- Rationale: `app.db`'s corruption story is quarantine-and-reseed-fresh-defaults
  (`app-db.js` `open()`) — correct for settings, catastrophic for secrets.
- **Atomic write is net-new work.** Post-M10 the JSON stores migrated *onto* `app.db`
  SQLite rows (`docStore.write`) — they no longer temp-write+rename, so there is no live
  store to copy that discipline from (the only current `renameSync` calls are corrupt-file
  *quarantine* in `app-db.js`/`history-store.js`). The vault store writes its **own**
  `write-tmp → fsync → rename` helper (recover the shape from pre-M10 git history if
  useful). What *is* still live and copyable is the **Electron-free injected-`userDataPath`
  store pattern** — every store does it; `vault-store` follows it.
- Trade-off: a second persistence discipline in the tree; accepted because a corrupt
  vault must surface **loudly and never be silently quarantined or recreated**, and the
  on-disk format *is* the export format (portable, self-contained).

**DD2 — Zero-dependency crypto via `node:crypto`**: scrypt (KDF), AES-256-GCM (item
data), HMAC-SHA1/256/512 (TOTP), X25519 (admin envelope), `randomBytes` (CSPRNG). No
native module.
- Rationale: preserves the zero-runtime-dependency identity (re-affirms M08 F1 DD1 /
  M10 F1 DD1). Architect verified the full primitive set on the shipped Node (v22.22.0,
  Electron ^42).
- Trade-off: Argon2id (stronger memory-hardness) is rejected — it needs a native
  module. scrypt parameters must be tuned for a defensible brute-force margin (DD11).

**DD3 — Envelope-set file format**: one random 256-bit vault key per file encrypts item
data with AES-256-GCM; the vault key is stored wrapped independently by each grantee —
a scrypt-derived master-password key, a recovery-key-derived key, zero-or-more per-jar
symmetric access-key-derived keys, and an X25519 seal to the admin public key. Per-file
salts; each file fully self-contained.
- **Each envelope carries a plaintext grantee key-id** (a non-secret fingerprint:
  `master` / `recovery` / `admin-pub` / an access-key id) readable **without any key**.
  This is load-bearing for the absent-envelope scope property (DD10 step 8): the behavior
  test proves a *specific* grantee's envelope is **absent** by reading envelope key-ids,
  not merely counting anonymous blobs. The key-id is a fingerprint, not the key.
- Rationale: a wrong key fails GCM authentication on unwrap (no plaintext leak);
  master-password change / recovery-key rotation is **re-wrap only**, never bulk
  re-encryption; access-key envelopes form an independently-removable set (keyed by
  key-id) so revoke = delete-one-envelope and F3 can later choose to strip them on export.
- Trade-off: the file carries N envelopes + their plaintext key-ids; negligible size, and
  the independence + inspectability are the security properties.

**DD4 — Access-key wire composition (the third credential axis)**: the MCP **session
identity** (jarId | 'admin', resolved from the transport bearer key — `automation-auth.js`
`validateKey`, bound into the session entry at init) names *which vault(s) a session may
reach*; the **vault access key** is a separate secret presented as the `vaultUnlock`
tool argument, which main uses to unwrap the scoped vault key(s) into per-session state.
- **Per-session state needs a new seam — this is NOT a plain `TOOLS` append.** The
  Flight-6 observe-tools append worked because engine ops are *stateless*:
  `buildToolRegistry(getEngine)` and `def.call(engine, args)` (`mcp-tools.js`) carry only
  the shared engine + args, no session handle. But `vaultUnlock` must stash per-session
  unwrapped keys that the *same session's* `vaultList`/`vaultFill`/`vaultTotp` read and
  `transport.onclose` zeroizes. The only place per-session identity lives is `buildServer`'s
  `CallToolRequestSchema` handler (closes over `identity` + `sessionRef`,
  `mcp-server.js:384-408`) and the `sessions` Map entry `{ server, transport, identity }`.
  So Leg 3 adds a **per-session vault context**: extend the sessions-Map entry with a
  vault-unlock holder keyed by `identity`+`sessionId`, and either widen `buildToolRegistry`
  to accept a per-session accessor or special-case the four vault tools in `buildServer`
  before delegating to `registry.callTool`. Budget this as real work, not a registry append.
- Rationale: transport key authenticates drive/observe; vault access key is an
  independently minted/rotated/revoked grant. Driving a jar without vault access stays
  possible; revoking vault access doesn't kill the automation session. Scope is
  cryptographic — a jar session's access key has no envelope for the global vault or a
  sibling jar, so there is nothing to fail open into.
- Trade-off: two secrets per automation consumer (transport + vault); accepted — it is
  the whole point (the human master password never appears in any config).

**DD5 — Session-scoped zeroization with idle-auto-lock backstop**: per-session unlocked
vault keys are held as `Buffer`s in main-process memory and `.fill(0)`'d on
`transport.onclose` (graceful teardown). Because an `enableJsonResponse` client may hold
no long-lived stream, the idle auto-lock timer is the belt-and-suspenders guarantee for
ungraceful drops. No SSE liveness lease in v1.
- Rationale: simplest correct design; onclose covers the common path, idle auto-lock
  covers the abandoned-session path.
- Wire zeroization into the existing `transport.onclose` / sessions-eviction path
  (`mcp-server.js:712-719`), the single teardown chokepoint (GET-SSE `res.on('close')`,
  DELETE, and `stop()` all cascade through it — confirmed by review).
- **Auto-lock default is an additive settings key in F1.** The idle-timer default (~10 min)
  is read from a new `settings-store` `DEFAULTS`+`VALIDATORS` key (additive, no version
  bump — the `spellcheck`/`restoreSession` template; `settings-store.set` throws on unknown
  keys, so the key must be registered before use). The user-*configurable* control is F3;
  F1 only adds the key and its default.
- Trade-off: an abandoned session's key may linger until the idle timer fires (bounded,
  default ~10 min) rather than clearing instantly. Best-effort scrubbing acknowledged:
  V8 strings are unscrubbable, so secrets that must be wiped travel as `Buffer`s.

**DD6 — Step-up re-auth is a policy gate, not a crypto gate**: minting any access key
(F1) demands a fresh master-password confirmation even while the vault is unlocked; the
check verifies the entered password still unwraps the master envelope (the vault key is
already in memory).
- Rationale: minting produces a durable credential that outlives the unlock window, so
  momentary access to an unlocked machine must not suffice. Intentional defense; **must
  never be "optimized away" as redundant with unlock state.**
- Trade-off: an extra prompt on a rare operation. Ordinary unlock-window operations
  (fill, reveal/copy, TOTP display, encrypted export) are deliberately NOT re-prompted.

**DD7 — `vaultFill` fills strictly, never submits; password never crosses the wire**:
`vaultFill` sends the credential main→preload over a dedicated channel; the preload fills
the origin-matched top-frame form (`window.top === window`) and dispatches input events.
The tool result carries no password. Submission is the caller's separate action.
- Rationale: cleanest boundary, smallest blast radius, upholds "the password never
  returns over the MCP channel." Origin-matched (exact-origin default), top-frame only.
- **`vaultFill` is a new op category — the first jar-confined *custom* wcId-first façade
  op.** It targets a `wcId` (a guest tab) and so **must** be jar-membership-gated (a jar
  key filling a sibling jar's tab is a compartmentalization break), but it cannot use the
  generic `WCID_FIRST_OPS` wrapper (`scope.js`), which blindly delegates to
  `engine[op](wcId, ...)` — vault fill needs the per-session key + `vault-store` + the
  main→preload channel, not a plain engine op. Nor is it `WCID_FIRST_EXEMPT` (that means
  admin-only). Leg 3 designs it like a wcId-first analogue of the jar-confined `getHistory`:
  call `resolveContentsForJar(wcId, jar, …)` for membership, then a custom delegate — and
  **extends the `automation-scope.test.js` three-place-registration guard with a third
  category** so a `wcId`-required vault tool doesn't fail the guard (it derives every
  wcId-first tool from the registry and asserts membership in one of the known sets).
- **contextIsolation=no security check (verify in leg):** the guest preload runs in the
  main world, so confirm guests run with `nodeIntegration` OFF (page JS cannot obtain
  `ipcRenderer` to register its own listener on the fill channel), and the main-side fill
  handler validates the sending frame / target `wcId` before delivering a credential.
- Trade-off: automation must issue a separate click to submit; accepted.

**DD8 — Burner/internal exclusion via the positive persist-jar allowlist**: burner and
internal partitions get no vaults, reusing `persist-jar-gate.js` `resolvePersistJar` and
`BURNER ∉ jars.list()` — no dedicated "is-it-a-burner" exclusion code.
- Rationale: structural, matches the history-recorder / closed-tab-capture idiom.
- Trade-off: none; this is the established pattern.

**DD9 — F1 exposes a vault-store API; no vault UI exists in F1**: first-run setup (master
password + one-time recovery key), unlock, and access-key minting are reachable through
the `vault-store` module API, which F1's tests/fixtures drive directly and F2/F3 UIs will
call. The "recovery key shown exactly once" and chrome-owned prompts are F2/F3.
- Rationale: keeps F1 headless and MCP-verifiable; the store API is the seam both the
  human path and the automation path sit on.
- Trade-off: F1 verifies setup/unlock/mint at the API + behavior-test level, not through
  the eventual UI. Acceptable — the UI is the subject of F2/F3.

**DD10 — Behavior-test apparatus (both axes audited)**: the goldfinch MCP surface both
**acts** (drives `vaultUnlock`/`vaultList`/`vaultFill`/`vaultTotp` and navigates a tab to
a login fixture via existing nav/openTab tools) and **observes** most results (tool-result
JSON per `mcp-tools.js` `okResult`; filled field values via `readDom`/`evaluate`, which
are jar-membership-gated `WCID_FIRST_OPS` — a per-jar key reads/evaluates its **own** tab,
so no admin key is needed for the fill assertion); **plus filesystem `Read`** observes the
`.gfvault` file to assert a foreign access key's envelope is *absent* by its plaintext
key-id (DD3) — "unlock refused" on the wire cannot distinguish an absent envelope from a
runtime policy check.
- **Audit read has its own apparatus.** The audit log is in-memory, broadcast to
  chrome/internal, and exposed by **no MCP tool** — so the audit assertion (step 9) runs
  from an **admin** session that reads the chrome automation-activity indicator via
  `getChromeTarget` + `readDom`/`evaluate` (admin-only). The generic audit wrapper is
  safe-by-default (vault ops aren't in `deriveAuditDetail`'s switch → `detail:null`, no key
  leak); recording **origin** for vault ops requires deliberately adding vault cases to
  `deriveAuditDetail` in Leg 3.
- **`vaultList` lists only *unlocked* vaults** (reachable-but-locked vaults do not appear
  until unlocked) — this is why step 7's second jar sees no global-vault items.
- Rationale: the act path and both read paths are cited and exist today; the
  absent-envelope assertion needs the file, not the wire; the audit assertion needs an
  admin chrome read.
- Trade-off: memory-level zeroization is not directly observable; the test asserts the
  behavioral proxy (a torn-down session must re-unlock; idle auto-lock re-locks).

**DD11 — async scrypt, benchmarked**: use async `crypto.scrypt` (never `scryptSync`,
which blocks the main process); benchmark N/r/p on the dev rig targeting ~250–500 ms
unlock latency; raise `maxmem` above the 32 MiB default if N warrants. Values recorded in
the flight log at Leg 1.

**DD12 — Admin-key minting + seal-to-future in F1; rotation in F3**: F1 mints the admin
X25519 keypair and seals every vault (including jar vaults created later) to the admin
public key at creation. Admin-key **rotation** (eager one-pass re-seal: unwrap each
vault's master envelope → re-seal the admin envelope, no per-vault prompt, no lazy
stale-envelope window) is deferred to F3 where the rotation UI lives. Per-jar and admin
access-key **minting** is F1.

### Prerequisites

- [ ] MCP automation surface runs locally (`npm run dev:automation`, loopback port
      **49707** — existing default, no new port introduced; no conflict check needed
      beyond confirming 49707 is free on the dev rig).
- [ ] `node:crypto` scrypt / AES-256-GCM / HMAC / X25519 available on the shipped Node
      (**verified** by Architect on Node v22.22.0).
- [ ] A login-form test fixture (local static HTML: an origin, a username field, a
      `type=password` field) exists for the behavior test — authored in Leg 4, probed
      before the flight lands (behavior-test execution prerequisite).
- [ ] A **headless vault-fixture builder** (a node script driving the `vault-store` API to
      create the fixture vault set, seed Login items, and mint per-jar access keys — DD9)
      exists for the behavior test — authored in Leg 4. This is a second, larger apparatus
      than the fixture page.
- [ ] For the behavior test's **admin variant**: `GOLDFINCH_AUTOMATION_ADMIN` set (presence
      gate) and an admin transport key minted (`mintAdminKey` returns null otherwise), plus
      the admin vault access key — needed for the audit read and the admin-unlock variant.
- [ ] A reference RFC 6238 TOTP generator available to cross-check codes in Leg 1 unit
      tests.

### Pre-Flight Checklist

- [ ] All open questions resolved (the two remaining are leg-internal / F3-owned, noted above)
- [ ] Design decisions documented (DD1–DD12)
- [ ] Prerequisites verified
- [ ] Validation approach defined (unit suites + one end-to-end behavior test — see Verification)
- [ ] Legs defined

---

## In-Flight

### Technical Approach

Four legs (Leg 3 split into wire + fill during design review), each a coherent slice
built and tested in one pass, layered so each consumes the last:

1. **`vault-crypto`** is pure and Electron-free (unit-tested offline). It defines the
   `.gfvault` serialization, the KDF, item encryption, the four envelope operations, and
   TOTP generation. No persistence, no state, no Electron.
2. **`vault-store`** wraps the crypto module with main-process persistence and the
   stateful unlock lifecycle. It injects `userDataPath` (Electron-free like the other
   stores), owns the in-memory unlocked-key map, the idle timer, step-up re-auth, first-run
   setup, access-key minting, admin seal-to-future, and the burner/internal exclusion.
3. **`vault-mcp-wire`** builds the fill-only MCP surface without the page-fill primitive:
   the per-session vault-context seam (DD4), `vaultUnlock`/`vaultList`/`vaultTotp` on the
   `TOOLS` registry consuming `vault-store`, cryptographic scope via the session identity,
   per-session zeroization wired into `transport.onclose` + the idle backstop, and audit
   integration (adding vault cases to `deriveAuditDetail` for origin). `vaultFill`'s *tool
   def and jar-membership façade* land here too — and because registering that
   `wcId`-required def in `TOOLS` is exactly what trips the three-place guard, **the
   `automation-scope.test.js` third-category extension ships in this same leg** (co-located
   with the def, so Leg 3 never lands red). `vaultFill`'s DOM-side effect is the next leg.
4. **`vault-fill`** adds the cross-process piece and proves the whole surface: the
   main→preload credential-injection channel (extending `webview-preload.js`, top-frame +
   sending-frame guarded), the headless **vault-fixture builder** (scripts the fixture
   vault set + minted access keys via the `vault-store` API — DD9, and **surfaces each
   access key's key-id / a deterministic fingerprint fn** so the behavior test's step-8
   absent-envelope assertion can name the expected key-id), the login-form fixture page,
   and the `vault-mcp-surface` behavior test that exercises the live transport, a real page
   fill, the absent-envelope file assertion, and the admin audit read.

Verification is unit-heavy (the crypto and lifecycle carry the bulk) with one end-to-end
behavior test that exercises the live MCP transport, a real page fill, and the
absent-envelope file assertion. The Leg 3/4 split isolates the wire-policy + scope surface
(unit-and-fake testable) from the cross-process fill + live-run apparatus.

### Checkpoints

- [ ] **(a)** KDF + envelope core: round-trip, tamper-detection, wrong-key-fails-auth,
      envelope independence, re-wrap-only for master/recovery — all green (end of Leg 1).
- [ ] **(b)** TOTP generation matches the reference implementation across algorithm /
      digits / period (end of Leg 1).
- [ ] **(c)** MCP surface + absent-envelope scope: fill-only wire policy + cryptographic
      scope hold under unit/fake tests, including the `scope.js` guard extension (end of
      Leg 3); the end-to-end behavior test passes, including the file-level absent-envelope
      assertion and the admin audit read (end of Leg 4).

### Adaptation Criteria

**Divert if**:
- The benchmarked scrypt parameters can't hit both an acceptable unlock latency and a
  defensible brute-force margin on the dev rig (reconsider KDF posture before building on it).
- The MCP transport offers no reliable teardown signal even for graceful close AND idle
  auto-lock proves insufficient (revisit DD5 — an SSE liveness lease may become necessary).
- Filling a real top-frame form without the password crossing the wire proves infeasible
  through the preload channel (revisit DD7 / the F1-owns-the-fill-primitive decision).

**Acceptable variations**:
- Exact scrypt N/r/p, `maxmem`, and idle-timer default within the DD11/DD5 envelopes.
- Internal module/file naming and how the four envelope ops are factored, as long as the
  crypto module stays pure and Electron-free.
- Adding further unit cases beyond those enumerated.

### Legs

> **Note:** Tentative; planned one at a time as the flight progresses.

- [x] `vault-crypto` — pure `.gfvault` format (+ per-envelope grantee key-ids) + KDF + AES-256-GCM item crypto + four envelope types + RFC 6238 TOTP generation; unit-tested offline. *(Checkpoints a + b.)* **Landed** (41 tests).
- [x] `vault-store` — main-process persistence (net-new atomic-write helper, load-loudly), first-run setup, unlock-state lifecycle + auto-lock (+ additive settings key) + zeroization, step-up re-auth, access-key minting, admin seal-to-future, burner/internal exclusion. **Landed** (MRK composition; 30 tests).
- [x] `vault-mcp-wire` — per-session vault-context seam, `vaultUnlock`/`vaultList`/`vaultTotp` + `vaultFill` tool def & jar-membership façade, the `scope.js` / `automation-scope.test.js` third-category guard extension (co-located with the `vaultFill` def that trips it), cryptographic scope enforcement, session-scoped zeroization + idle backstop, audit integration (`deriveAuditDetail` vault cases). Unit/fake-tested. *(Checkpoint c, part 1.)* **Landed.**
- [x] `vault-fill` — main→preload credential-injection channel (top-frame + sending-frame guarded), headless vault-fixture builder (surfacing access-key key-ids) + login-form fixture page, and the `vault-mcp-surface` behavior test. *(Checkpoint c, part 2.)* **Landed** (code + fixtures + unit tests; behavior-test run **staged** for a live-GUI session — see flight log).

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Unit suites passing (`npm run test`), typecheck (`npm run typecheck`), lint clean
- [ ] `vault-mcp-surface` behavior test passing
- [ ] Flight debrief written (the go/no-go point before F2)

### Verification

- **Unit** (`node --test test/unit/*.test.js`): crypto round-trip / tamper / wrong-key;
  envelope independence + re-wrap-only + per-envelope key-id readable-without-key; TOTP vs.
  reference; store atomic-write + load-loudly-on-corrupt; unlock lifecycle (idle auto-lock,
  Lock now, quit); step-up policy (wrong password refuses mint); burner/internal produce no
  vault; access-key mint requires unlocked vault; admin seal reaches a vault created after
  the admin key; per-session vault-context isolation + zeroization-on-onclose (fake
  transport); the `automation-scope.test.js` three-place guard extended so `vaultFill`
  (wcId-first custom façade op) passes; `deriveAuditDetail` emits origin but no secret for
  vault ops.
- **Behavior test** `vault-mcp-surface` (`/behavior-test vault-mcp-surface`): end-to-end
  over the live MCP surface — set up + unlock a vault via an access key, `vaultList`
  returns metadata only (no secret), `vaultFill` populates a login fixture's fields with
  no password in the tool result, `vaultTotp` returns the current code, a foreign per-jar
  access key fails to unlock the global vault **and** the vault file carries no envelope
  for it, and a torn-down session must re-unlock. Apparatus per DD10.
