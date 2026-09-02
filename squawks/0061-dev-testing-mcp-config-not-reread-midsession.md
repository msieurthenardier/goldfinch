# Squawk 0061: docs/dev-testing.md missing "MCP client does not re-read .mcp.json mid-session" note

**Status**: completed
**Type**: servicing
**Severity**: routine
**Completed**: 2026-09-02
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

Re-read `docs/dev-testing.md`'s *Key capture* section before writing: its
mint-goes-stale bullet already states that a static `.mcp.json` entry goes
stale at the next mint and that static client config "can't be re-registered
mid-session", but never says what the operator actually does when a live
client holds the stale token — the missing client-side half this squawk was
filed for. Confirmed placement against the squawk's Report: the
key-capture/attach guidance is exactly this section.

One bullet added to *Key capture*'s bullet list (docs/dev-testing.md:44-47),
immediately after the mint-goes-stale bullet it completes: after any
`DEV_MINT` re-mint plus a `.mcp.json` update, a live MCP client keeps its
session-start token — it never re-reads the config mid-session, so a config
edit alone changes nothing and the client keeps 401ing ("requires
re-authorization"); reconnect the server in the client session (`/mcp` in
Claude Code) to pick up the new key. Symptom string ("requires
re-authorization") and remedy (`/mcp` reconnect) taken from the squawk's
Report/Evidence (Mission 18 Flight 2 leg-5 setup, verified working
2026-09-01); voice matches the section's existing bullets (bolded key clause,
consequence-then-remedy). No other line of the doc touched by this squawk.

## Verification

- `grep -n -i 'reconnect\|/mcp\b\|session-start' docs/dev-testing.md` → the
  new bullet at lines 44-47 is the only reconnect/session-start guidance, and
  it sits inside *Key capture* (section starts line 29), i.e. where the
  launch/key-capture guidance lives — closing the squawk's "no such note"
  Evidence grep.
- The bullet's claims add nothing beyond the squawk's own Report/Evidence and
  the section's existing rotation facts (mint **replaces** the stored hash —
  launch-states table row 3; static entry goes stale — the preceding bullet).
- `npx prettier --check docs/dev-testing.md` → "All matched files use
  Prettier code style!"
- `git diff docs/dev-testing.md` at this point: the four-line bullet is the
  only change (squawk 0056's separate edits land after this and are confined
  to their own subsection for attribution).

## Sign-Off

**Reviewer**: independent batch Reviewer (squawk turnaround 2026-09-02, scoped to the diff)
**Verdict**: confirmed — the /mcp-reconnect fact accurate to the client's config-at-session-start behavior; placed in Key capture beside the bullet it completes.
**Commit**: `squawk/turnaround-2026-09-02` (via its PR)
