# Squawk 0060: CLAUDE.md MRK-model bullet stale after manager v2 / compromise rotation

**Status**: completed
**Type**: servicing
**Severity**: routine
**Completed**: 2026-09-02
**Reported**: 2026-09-02

## Report

`CLAUDE.md:303` (vault Module layout / MRK bullets) still states the MRK
is "wrapped three ways in `manager.json`" and that "a rotation rewrites
only `manager.json`". Both are conditionally false since Mission 18
Flight 2: a v2 no-admin manager carries two wraps (master + recovery;
admin optional-but-paired), and compromise rotation rewrites the manager
plus every on-disk `.gfvault`. Fix: reword the bullet(s) to state the
v1/v2 split and carve out compromise rotation, consistent with
`docs/vault.md` (which is accurate). Docs only; found at the Flight 2
debrief (Developer interview).

## Evidence

- `CLAUDE.md:303` region — "wrapped three ways", "rewrites only
  manager.json" (grep at HEAD 52494f9).
- Shipped contract: `_readManager` v2 optional-admin pairing;
  `compromiseRotate` multi-file transaction
  (`src/main/vault/vault-store.js`, `vault-txn.js`); `docs/vault.md`
  compromise section (accurate reference text).

## Corrective Action

Re-read the shipped contract directly before writing any claim (the squawk-0055
re-verification discipline):

- `src/main/vault/vault-store.js` `_readManager` (~481-545) and the manager
  format comment (~65-80): v1 requires all three `mrk` slots +
  `adminPublicKeyB64`; v2 requires `mrk.master` + `mrk.recovery` while the
  admin pair (`mrk.admin` + `adminPublicKeyB64`) may be deliberately absent —
  present-together-or-absent-together, a lone half throws `VaultFormatError`.
- `compromiseRotate` (~1197-1410): mints a fresh MRK and a fresh key for EVERY
  vault, rebuilds each `.gfvault` with exactly one (mrk) envelope — dropping
  every access envelope — writes the new manager at `MANAGER_VERSION_V2` with
  NO admin fields, and commits `manager.json` + every rebuilt vault through
  ONE `vtxn.beginTransaction`/`commit` (crash-safe, load-time recovery).
- The single-slot rotations (`recoverMasterPassword` ~1112-1155 read directly;
  `changeMasterPassword`/`rotateRecovery`/`rotateAdminKey` per
  `docs/vault.md:388-406`) each rewrite one `manager.json` slot and never
  touch a `.gfvault`.
- `docs/vault.md` (the accurate reference this bullet must agree with):
  v2 optional-admin rules (lines 71-79), "a rotation rewrites only
  `manager.json`" correctly scoped to the single-slot family (149-152,
  390-393), compromise-mode section (408-426).

`CLAUDE.md:303` (the MRK-model bullet) reworked minimally, telegraphic style
preserved:

- "wrapped THREE ways in `manager.json`" → the v1/v2 split: v1 three required
  wraps; v2 master + recovery with the admin pair optional-but-paired
  (absence = unprovisioned/revoked, a lone half malformed).
- "master OR recovery OR admin opens everything" → "each held wrap credential
  opens everything" (true at both versions; a v2 no-admin manager has no
  admin credential to name).
- "a rotation rewrites ONLY `manager.json`" → single-slot rotations rewrite
  only `manager.json`, with the compromise-rotation carve-out stated inline:
  fresh MRK + fresh key per vault, `manager.json` (v2 no-admin, access
  envelopes dropped) plus every on-disk `.gfvault` rewritten as one
  crash-safe transaction.
- Everything else in the bullet (access-key directness, Buffer/zeroize,
  load-loudly) untouched.

Swept the rest of CLAUDE.md for other echoes of the two stale claims:
`grep -n -i 'three ways\|wrapped three\|rewrites only\|master OR recovery OR
admin\|opens everything\|rewrite\|manager.json' CLAUDE.md` — the only vault
hits outside line 303 are the structural mentions at lines 37/300/302
(`.gfvault` files + `manager.json` under `userData/vaults/`; vault-store's
persistence role), which state no wrap-count and no rotation-scope claim, so
they needed no change. No other file touched besides `CLAUDE.md` and this
squawk artifact.

## Verification

- Every claim in the reworded bullet checked against
  `src/main/vault/vault-store.js` (`_readManager` v1/v2 validation branches at
  ~520-545; `compromiseRotate`'s `MANAGER_VERSION_V2` no-admin manager at
  ~1352-1371 and single `beginTransaction` over `manager.json` + all rebuilt
  vaults at ~1373-1381) and against `docs/vault.md:71-79`, `149-152`,
  `388-426` before writing — no claim added beyond what those sources state.
- Post-edit `grep -n -i 'three ways\|wrapped three\|rewrites only\|master OR
  recovery OR admin\|opens everything' CLAUDE.md` → sole hit is the rewritten
  line 303 itself, where each phrase is now correctly scoped (v1-only /
  single-slot-only / per-credential).
- `npx prettier --check CLAUDE.md` → "All matched files use Prettier code
  style!" — no formatting drift.
- `git diff CLAUDE.md` reviewed: one bullet (line 303) changed; no heading,
  sibling bullet, or other line touched.

## Sign-Off

**Reviewer**: independent batch Reviewer (squawk turnaround 2026-09-02, scoped to the diff)
**Verdict**: confirmed — every reworded CLAUDE.md claim matches the shipped store contract (v1/v2 wrap split, single-slot vs compromise transaction); independent stale-echo sweep clean; telegraphic style kept; prettier clean.
**Commit**: `squawk/turnaround-2026-09-02` (via its PR)
