# Squawk 0030: `GOLDFINCH_VAULT_TRACE` is read but documented nowhere; no `.env.example` exists

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Five `GOLDFINCH_*` environment variables are read in `src/`/`scripts/`; four are documented across `docs/dev-testing.md`, `docs/mcp-automation.md`, and the README. `GOLDFINCH_VAULT_TRACE` is not. Document its purpose and values beside the other four, and add a `.env.example` (the `.gitignore` already whitelists it via `!.env.example`) listing all five with placeholder values — the dev automation key must remain a placeholder.

Source: maintenance report 2026-08-27, finding F38.

## Evidence

- `grep -rhoE "process\.env\.[A-Z_]+" src scripts | sort -u` → `GOLDFINCH_AUTOMATION_ADMIN`, `GOLDFINCH_MCP_KEY`, `GOLDFINCH_MCP_PORT`, `GOLDFINCH_MCP_URL`, `GOLDFINCH_VAULT_TRACE`
- `grep -rn VAULT_TRACE docs README.md` → no hits; `.gitignore` — `.env`, `.env.*`, `!.env.example`

## Corrective Action

Re-ran `grep -rhoE "process\.env\.[A-Z_]+" src scripts | sort -u` — still exactly five:
`GOLDFINCH_AUTOMATION_ADMIN`, `GOLDFINCH_MCP_KEY`, `GOLDFINCH_MCP_PORT`, `GOLDFINCH_MCP_URL`,
`GOLDFINCH_VAULT_TRACE`. (Two other `GOLDFINCH_*` names — `GOLDFINCH_AUTOMATION_DEV_MINT`,
`GOLDFINCH_MCP_ADMIN_KEY` — are read via a destructured `env` param rather than the literal
`process.env.X` form this grep matches; both are already documented in `docs/dev-testing.md`
and `docs/mcp-automation.md`, so they're out of this squawk's bounded scope.)

Read `src/main/register-browser-ipc.js:35-43`, the `vaultTrace` default-param definition, to
learn what `GOLDFINCH_VAULT_TRACE` does: an opt-in trace of the vault capture → hold → unlock
→ finalize lifecycle (a sequence spanning three processes, so a failure in it otherwise
surfaces to the operator as "no prompt appeared" with nothing to go on). Gate is strict
equality against `'1'`; OFF by default and silent in every normal run. Logs each step, tagged
`[vault-capture]`, via `logger.info` (main-process console). What it prints is bounded by
construction to non-secrets — the opaque main-minted `captureId`, the tab's `wcId`, the
disposition mode, and the finalize outcome — never a password, username, or origin.

Added a `## Debug flags` section to `docs/dev-testing.md` (after `a11y audit`, before `Test
layers`) documenting `GOLDFINCH_VAULT_TRACE` per the above, plus one pointer sentence in the
existing `Key capture` section noting that every `GOLDFINCH_*` variable has a placeholder
entry in the new `.env.example`.

Created `.env.example` at the repo root listing all five vars from the authoritative grep,
each with a one-line comment and a `replace-me` placeholder (including the automation key,
`GOLDFINCH_MCP_KEY`) — no real values, per the existing `.env`/`.env.*`/`!.env.example`
`.gitignore` rule (unchanged; already correct).

## Verification

- `grep -rhoE "process\.env\.[A-Z_]+" src scripts | sort -u` → same five vars as the squawk's
  evidence; all five now have an entry in `.env.example` and, for `GOLDFINCH_VAULT_TRACE`
  specifically, a documented entry in `docs/dev-testing.md`.
- `git status --short` → `.env.example` shows as `??` (untracked, addable — not ignored).
  `git check-ignore .env.example` (non-verbose) → empty output, exit 1 — confirms the file is
  not excluded. `git check-ignore -v .env.example` → reports the deciding pattern is
  `.gitignore:17:!.env.example`, i.e. the existing whitelist negation, confirming it's the
  rule that lets this file be tracked.
- `npx prettier --check docs/dev-testing.md` → "All matched files use Prettier code style!"
  — no pre-existing formatting drift in this file.
- Diff scoped to `docs/dev-testing.md` (one pointer sentence + new `Debug flags` section),
  the new `.env.example`, and this squawk file; no source files touched.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 3)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 3)` on `squawk/turnaround-2026-08-27-3` (PR number recorded on the PR itself)

Batch gates at review: 3792/3792 tests (no code changed), lint clean, typecheck clean.
