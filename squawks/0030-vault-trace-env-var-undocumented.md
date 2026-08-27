# Squawk 0030: `GOLDFINCH_VAULT_TRACE` is read but documented nowhere; no `.env.example` exists

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Five `GOLDFINCH_*` environment variables are read in `src/`/`scripts/`; four are documented across `docs/dev-testing.md`, `docs/mcp-automation.md`, and the README. `GOLDFINCH_VAULT_TRACE` is not. Document its purpose and values beside the other four, and add a `.env.example` (the `.gitignore` already whitelists it via `!.env.example`) listing all five with placeholder values — the dev automation key must remain a placeholder.

Source: maintenance report 2026-08-27, finding F38.

## Evidence

- `grep -rhoE "process\.env\.[A-Z_]+" src scripts | sort -u` → `GOLDFINCH_AUTOMATION_ADMIN`, `GOLDFINCH_MCP_KEY`, `GOLDFINCH_MCP_PORT`, `GOLDFINCH_MCP_URL`, `GOLDFINCH_VAULT_TRACE`
- `grep -rn VAULT_TRACE docs README.md` → no hits; `.gitignore` — `.env`, `.env.*`, `!.env.example`

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
