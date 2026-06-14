# Leg: verify-integration

**Status**: completed
**Flight**: [MCP-Compatible Local Server + Transport](../flight.md)

> **Live / FD-guided leg.** This is not an autonomous-agent leg. It requires the WSLg GUI (the running
> Electron app) and a real MCP client. The Flight Director guides the operator through the steps one at
> a time; failures are diagnosed and fixed inline (spawning a Developer for any code change), then the
> step is re-verified before moving on. Evidence (screenshots, captures) lands at the ephemeral
> `/tmp/behavior-tests/goldfinch/...` path and is **not** committed.

## Objective

Prove the whole Flight-3 surface live against the running browser: a real MCP client connects over the loopback transport, discovers all 16 tools, and drives the browser end to end; the SC7 network defenses reject non-loopback Host/Origin and a non-loopback peer cannot reach the bind; the two `active` behavior tests pass; and the DD10 DevTools-CDP-conflict outcome is recorded over the transport (app launched **without** `--remote-debugging-port`).

## Context

- **Apparatus exists now** (legs 1–5, committed `f6ae029`): the loopback MCP server (`127.0.0.1:7777`), all 16 tools, the example client `scripts/mcp-example-client.mjs`, and the two `active` specs `mcp-drive-end-to-end` (SC6) + `mcp-loopback-origin-guard` (SC7).
- **Launch via `npm run dev:automation`** (`--automation-dev`, **no** `--remote-debugging-port`) — required so the DD10 DevTools test is confound-free.
- All offline gates are already green (471 unit tests, typecheck, lint). This leg adds the **live** half that the autonomous legs explicitly deferred.

## Acceptance Criteria (verification steps — operator-performed, FD-guided)

- [ ] **V1 — Server up + loopback bind.** `npm run dev:automation` launches the app; `ss -tlnp | grep 7777` (or `curl`) shows the server bound to **`127.0.0.1:7777`** (not `0.0.0.0`/`::`). `npm run dev` (no flag) and `npm run dev:debug` (CDP, no `--automation-dev`) do **NOT** bring up `:7777` (structural CDP-decoupling).
- [ ] **V2 — Discovery + handshake.** A real MCP client (the example client, or a Claude Code MCP session via the `.mcp.json` `goldfinch` entry, or an SDK client) connects, `initialize` succeeds, and `tools/list` returns the **16** tools.
- [ ] **V3 — Drive end to end (SC6).** The client drives: `openTab` → `enumerateTabs` → `navigate` + `readDom` (URL/title) → `captureScreenshot` (a real PNG, page visibly rendered) → `readAxTree` (AXNode array) → trusted input (`click`/`typeText`/`pressKey` with a visible reaction) → tab management (`activateTab`/`closeTab`). `scripts/mcp-example-client.mjs` is the quick smoke; the Witnessed run (V6) is the graded pass.
- [ ] **V4 — SC7 network reject.** `curl -H 'Host: evil.example' http://127.0.0.1:7777/mcp` → **403**; `curl -H 'Origin: http://evil.example' …` → **403**; the DNS-rebinding shape (`Host: 127.0.0.1` + `Origin: http://attacker.example`) → **403**; a loopback no-Origin request is **not** 403'd. (The non-loopback-peer guard is bind-proxied by V1 + unit-tested.)
- [ ] **V5 — `/behavior-test mcp-loopback-origin-guard`** runs and **passes** (the FD orchestrates the run; the run log lands at `tests/behavior/mcp-loopback-origin-guard/runs/{ts}.md`, committed).
- [ ] **V6 — `/behavior-test mcp-drive-end-to-end`** runs and **passes** (run log committed).
- [ ] **V7 — DD10 finding.** With DevTools open on a target tab (app launched without `--remote-debugging-port`), MCP `readAxTree` on that tab — **record** whether it returns the `attach-failed` refusal or succeeds; closing DevTools restores success. Recorded in the flight log + the mission Open-Question closure (a finding, not a hard pass/fail).
- [ ] **V8 — Gates still green** at leg close: `npm test`, `npm run typecheck`, `npm run lint`.

## Notes

- Any code fix needed mid-verification is made via a Developer spawn (FD does not edit source directly), committed as a **new** commit (no amend), then the step re-verified.
- If a behavior test fails: it is an unmet acceptance criterion — the leg does not land while it fails. Fix + re-run, or (operator's call) accept as a recorded known issue in the flight-log entry alongside the run-log path.

---

## Post-Completion Checklist

- [ ] V1–V8 verified (or dispositions recorded)
- [ ] Run logs for the two active specs committed under `tests/behavior/{slug}/runs/`
- [ ] DD10 finding recorded in flight-log + mission Open Question
- [ ] Update flight-log.md with the `verify-integration` Leg Progress entry
- [ ] Set leg status to `completed`; check off in flight.md; commit
