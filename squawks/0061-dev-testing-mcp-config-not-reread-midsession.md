# Squawk 0061: docs/dev-testing.md missing "MCP client does not re-read .mcp.json mid-session" note

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-02

## Report

After a `DEV_MINT` re-key and a `.mcp.json` update, the live Claude Code
MCP client keeps presenting its session-start token — it does not
re-read the config on reconnect attempts; the operator must reconnect
the server via `/mcp` (verified working 2026-09-01, Mission 18 Flight 2
leg-5 setup, after "requires re-authorization" errors). This is the
standing Mission 17 apparatus-fragility risk, realized; the fact lives
only in flight logs and the behavior-test crew file. Fix: one bullet in
`docs/dev-testing.md`'s key-capture/attach section: after any re-mint +
config update, reconnect the MCP server in the client session (`/mcp`
in Claude Code); a mid-session config edit alone is not picked up. Docs
only.

## Evidence

- Mission 18 Flight 2 flight log, 2026-09-01 anomaly entry ("Apparatus
  token not re-read mid-session").
- `.flightops/agent-crews/behavior-tests-execution.md` apparatus notes
  (out-of-band relaunch law) — lacks the client-side reconnect half.
- `grep -i 'mcp\|reconnect' docs/dev-testing.md` — no such note.

## Corrective Action

*(recorded at completion)*

## Verification

*(recorded at completion)*

## Sign-Off

*(recorded at completion)*
