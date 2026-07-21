# Leg: docs-threat-model

**Status**: completed
**Flight**: [Portability + Rotation + Hardening + Docs](../flight.md)

## Objective

Document the built-in password vault as it now exists across F1–F4: a net-new `docs/vault.md`
(file/manager format + key hierarchy + trust boundaries + the MCP surface + portability/rotation +
lifecycle + **threat model**, including the unrecoverable-by-design property), plus a concise
`### Password vault` subsection under CLAUDE.md's `## Patterns` and an Architecture-section pointer.
Docs-only — **no source changes**.

## Context

- **Flight DD8** — `docs/vault.md` (format + threat model) + a `CLAUDE.md` `## Patterns` subsection +
  an Architecture pointer. `docs/` already holds peer references (`mcp-automation.md`, `renderer-menu.md`);
  `CLAUDE.md` `## Patterns` (`:37`) hosts `###` subsections (e.g. `### Menu-overlay sheet` `:114`,
  `### Automation engine` `:226`) and `## Architecture` (`:15`) is where a one-line pointer belongs.
- **This is the mission's documentation criterion** — it must capture the **unrecoverable-by-design**
  property (lose the master password AND the recovery key → the data is gone; there is no backdoor) as a
  first-class threat-model statement, not a footnote.
- **Debrief carry-forward to capture here** — the **per-op whole-vault-decrypt** design characteristic
  (each vault operation decrypts the whole vault doc rather than a single item) that F1/F3 deferred
  documenting: record it in the threat model / design-characteristics section as a known, accepted
  property (bounded vault sizes, main-process-only plaintext, zeroization) so it stops being an
  undocumented owe.
- **Source of truth is the code + the flight artifacts** — the implementer reads `src/main/vault/*`,
  `src/shared/vault-*`, the automation vault tools, and the F1–F4 flight specs/logs to document what was
  actually built (do not invent; cite modules).

## Inputs (what to read to document accurately)

- **Crypto + store**: `src/main/vault/vault-crypto.js` (envelope types, AES-256-GCM item crypto, KDFs,
  TOTP), `src/main/vault/vault-store.js` (the `.gfvault` persistence, `manager.json`, the MRK model, the
  unlock lifecycle + idle auto-lock + zeroization, export/import, rotations, `deleteVault`/`hasVault`),
  `src/main/vault/vault-context.js` + `vault-human.js` (the fill paths + the origin matcher).
- **Schema SSOT**: `src/shared/vault-item-schema.js` (per-type nonSecret/secret maps, `metadataOf`,
  `matchMode`), `src/shared/origin-match.js` + `src/main/vault/psl.js` (the registrable-domain matcher).
- **Trust boundary + sheets**: the menu-overlay sheet family (`src/renderer/menu-overlay.js` + the
  `src/shared/vault-*-template.js` sheets) — the master-equivalent-secret-never-in-page-DOM boundary
  (F3 DD5), the dual-zeroized Buffer channel, dismiss-locked one-time displays.
- **MCP surface**: `src/main/automation/mcp-tools.js` (the four vault tools), `mcp-server.js`
  (`deriveAuditDetail` — origin + unlock count), the two access-key tiers + scope enforcement +
  session-scoped teardown.
- **Lifecycle**: `src/main/jar-registry-ipc.js` (`handleRemove` — delete removes / wipe spares).
- The F1–F4 flight specs + logs under `missions/12-password-manager/flights/` for the design rationale.

## Outputs

- **`docs/vault.md` (net-new)** — the vault reference, covering at least:
  1. **Overview & goals** — encrypted per-jar + global vaults; explicit-gesture fill; scoped MCP
     automation; zero runtime deps (`node:crypto` only).
  2. **On-disk format** — the `.gfvault` file (serialized vault doc: `mrk` envelope + 0+ per-jar
     `access` envelopes, AES-256-GCM items) and `manager.json`
     (`{ format, version, kdf, adminPublicKeyB64, mrk:{master,recovery,admin} }`).
  3. **Key hierarchy — the MRK model** — one random 256-bit Manager Root Key wrapped THREE ways
     (scrypt/master, HKDF/recovery, X25519/admin); each vault key wrapped under the MRK. Why the
     indirection: rotations rewrite ONLY `manager.json`, `.gfvault` files are untouched.
  4. **Unlock lifecycle** — in-memory keys (main process only), idle auto-lock, lock-on-quit,
     best-effort zeroization; the step-up re-auth gate.
  5. **The fill trust boundary (F3 DD5)** — no master-equivalent secret ever enters the vault **page**
     DOM; entry routes through the chrome-owned menu-overlay **sheet** via a dual-zeroized Buffer
     channel; one-time secret displays are dismiss-locked. Internal-session pages can't be axe-audited
     (the settings-class a11y gap the mission accepted).
  6. **The MCP automation surface** — fill-only (`vaultUnlock`/`vaultList`/`vaultFill`/`vaultTotp`), two
     access-key tiers, cryptographic scope enforcement, session-scoped teardown, the audit surface
     (resolved fill origin + unlock count, never a secret).
  7. **Origin matching** — exact-origin by default; the per-item **registrable-domain opt-in** behind the
     vendored-PSL, fail-closed-to-exact matcher; never shares across a registry sibling / multi-tenant
     tenant; capture stays exact.
  8. **Portability** — the export bundle (Option A: the manager's three mrk envelopes + kdf +
     adminPublicKeyB64 + the target vault doc; no re-prompt, one recovery key); fresh-profile adopt vs
     existing-profile re-key on import.
  9. **Rotation & recovery** — recovery-key rotation, master-password change (old-pw step-up),
     recover-after-forgotten-master (the recovery key IS the step-up), admin-key rotation/provision
     (mints anew); each rewrites one `manager.json` slot.
  10. **Lifecycle** — jar **wipe spares** the vault; jar **delete removes** it (offering export first);
      the global vault is independent.
  11. **Threat model** — what the vault protects against (at-rest disk theft, per-jar isolation, the
      automation scope boundary) and what it does NOT (a compromised main process, a keylogger at master
      entry); the **unrecoverable-by-design** property (no master + no recovery key → data is
      permanently gone, no backdoor); the admin key as break-glass/multi-vault; burner/internal
      exclusion; and the **per-op whole-vault-decrypt** characteristic (accepted: bounded sizes,
      plaintext main-process-only, zeroized).
- **`CLAUDE.md` `### Password vault` subsection (under `## Patterns`)** — concise: the module layout
  (`src/main/vault/*`, `src/shared/vault-*`), the MRK-model one-liner, the fill trust boundary, the sheet
  family, the SEAM_COUNT/seam-contract note, and a pointer to `docs/vault.md`. Match the density/voice of
  the neighboring `### Automation engine` / `### Menu-overlay sheet` subsections.
- **Architecture pointer** — one line under `## Architecture` (or the most fitting spot) pointing at the
  vault subsection / `docs/vault.md`, mirroring how `docs/mcp-automation.md` is pointed to.

## Acceptance Criteria

- [x] `docs/vault.md` exists and accurately documents the format, the MRK key hierarchy, the fill trust
      boundary, the MCP surface, origin matching, portability, rotation/recovery, the lifecycle, and the
      threat model — including the **unrecoverable-by-design** property and the per-op whole-vault-decrypt
      characteristic. Every claim reflects the actual code (no invented behavior).
- [x] `CLAUDE.md` gains a `### Password vault` subsection under `## Patterns` + an Architecture pointer,
      matching the surrounding style and pointing to `docs/vault.md`.
- [x] **No source files changed** — docs + CLAUDE.md only (this is a documentation leg; `npm test`,
      `npm run typecheck`, lint remain green because nothing executable changed).
- [x] No operator username / absolute home paths / secrets in any prose or example.

## Verification Steps

- Read `docs/vault.md` end-to-end against the code: spot-check the format section vs `vault-store.js`, the
  MRK section vs `vault-crypto.js`, the matcher section vs `psl.js`/`origin-match.js`, the MCP section vs
  `mcp-tools.js`/`mcp-server.js` — every statement traceable to a module.
- Confirm the CLAUDE.md subsection renders under `## Patterns` and the pointer resolves.
- `npm test` / `npm run typecheck` / lint still green (no source change). Grep the docs for any leaked
  home path / username / secret.

## Implementation Guidance

1. Read the F1–F4 vault modules + flight artifacts; write `docs/vault.md` to the outline above — accurate,
   traceable, no invention. Lead the threat-model section with the unrecoverable-by-design property.
2. Add the `### Password vault` subsection under `## Patterns` (density of `### Automation engine`) + the
   Architecture pointer. Point both at `docs/vault.md`.
3. Keep it docs-only; run the suite once to confirm nothing executable moved.

## Edge Cases

- **Drift risk** — document the design/invariants, not volatile line numbers; prefer module + symbol
  references (the CLAUDE.md "Citing Code Locations" discipline) so the doc ages gracefully.
- **No secrets in examples** — any illustrative bundle/manager JSON uses placeholder ciphertext, never a
  real key; no `~/…`/home paths.
- **Accepted-gap honesty** — state the accepted limitations plainly (internal-page a11y gap; per-op
  whole-vault-decrypt; main-process-compromise out of scope) rather than overclaiming.

## Files Affected

- `docs/vault.md` (net-new).
- `CLAUDE.md` — the `### Password vault` subsection + the Architecture pointer.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (unchanged — docs-only; 2638 pass / 0 fail)
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
