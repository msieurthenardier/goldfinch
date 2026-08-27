# Squawk 0027: `PICK_PREFIX` export in `vault-picker-template.js` has no importer

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

`src/shared/vault-picker-template.js` exports `PICK_PREFIX` but nothing imports it. Its sibling `CERT_PICK_PREFIX` is deliberately mirrored as a literal in `register-overlay-ipc.js:17` for the CJS/ESM split. Either mirror `PICK_PREFIX` the same way (if a consumer is intended) or drop the export.

Source: maintenance report 2026-08-27, finding F28.

## Evidence

- `src/shared/vault-picker-template.js:26` — the export; `grep -rn PICK_PREFIX src test` → no importer of the un-prefixed name

## Corrective Action

Verified by evidence which of the two cases in the report applied. A whole-word grep for
`PICK_PREFIX` (excluding `CERT_PICK_PREFIX`) across `src/`, `test/`, `docs/` found only the
definition and its two internal uses (`pickId`, `parsePickIndex`) in
`vault-picker-template.js` — no importer and no literal mirror anywhere, including
`register-overlay-ipc.js`.

This differs from `CERT_PICK_PREFIX`, which *is* mirrored as a local `'cert:'` literal in
`register-overlay-ipc.js` — because main-process code parses cert-picker selection ids
directly (a CJS/ESM split). Vault-picker selection ids are parsed only in the renderer
(`menu-overlay.js`, `vault-controller.js`), and both already import the wrapper functions
`pickId` / `parsePickIndex` rather than the raw prefix — so there is no CJS-side consumer
that would need a mirrored literal. Case (2) from the squawk (mirror it like
`CERT_PICK_PREFIX`) does not apply; case (3) does.

Fix: dropped the `export` keyword from `PICK_PREFIX` in `src/shared/vault-picker-template.js`
(kept the `const`, since `pickId`/`parsePickIndex` still use it internally), and added a
comment explaining why it stays unexported, contrasting it with `CERT_PICK_PREFIX`. No other
file changed — nothing imported the named export, so removing it is safe.

## Verification

- `timeout 180 npm test` — 3793/3793 passing, 0 failures.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- Re-grepped after the edit for `{ PICK_PREFIX` / `PICK_PREFIX }` import patterns across
  `src/` and `test/` — no matches, confirming nothing was importing the now-removed export.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 2)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 2)` on `squawk/turnaround-2026-08-27-2` (PR number recorded on the PR itself)

Batch gates at review: 3806/3806 tests, lint clean, typecheck clean.
