# Leg: hat-and-alignment

**Status**: completed
**Flight**: [MCP-Compatible Local Server + Transport](../flight.md)

> **Interactive HAT / alignment leg (optional — included).** Not an autonomous-agent leg. The operator
> drives a real external MCP client against the running server end to end and tunes tool shapes / latency
> / ergonomics; the Flight Director applies small approved tweaks inline (Developer spawn for code) and
> commits.

## Objective

A guided human-acceptance + ergonomics pass: with the surface live-verified (Leg 6), the operator drives a real MCP client (the example client, or a Claude Code MCP session via the `.mcp.json` `goldfinch` entry) and we tune the agent-facing ergonomics — tool naming/shapes, input schemas, latency feel — before the flight lands. Bounded: tuning + sign-off, not new capability (element-addressing ergonomics remain Flight 9).

## Context

- The surface is built + live-verified: 16 tools over the loopback transport; SC6 (`mcp-drive-end-to-end`) and SC7 (`mcp-loopback-origin-guard`) behavior tests pass; the multi-session transport fix lets a real Claude Code session connect via `.mcp.json`.
- **Carried-in ergonomics finding (Leg 6 / V6):** `pressKey`'s key argument is named **`name`**, not `key` — an MCP client that intuitively sends `{key:"Enter"}` gets `automation: unknown key undefined`. Candidate tweak: accept `key` as an alias and/or sharpen the tool description. First concrete HAT item.
- HAT scope boundaries (do not pull forward): key gating/auth/audit = Flight 4; element-addressing-by-a11y-handle / richer selectors = Flight 9; README thesis reframe + external-consumer (the-one) wiring = Flight 8.

## Acceptance Criteria (operator-driven, FD-guided)

- [ ] **H1 — Operator drives the surface from a real client** (example client or a Claude Code MCP session pointed at `http://127.0.0.1:7777/mcp`) and confirms the agent-facing experience is acceptable end to end (discover → drive → observe).
- [ ] **H2 — Ergonomics tuning dispositioned**: the `pressKey` `key`/`name` finding and any others the operator hits are either fixed inline (new commit, gates green, behavior tests still pass) or recorded as a Flight-9 ergonomics follow-up with rationale.
- [ ] **H3 — Operator sign-off** that Flight 3's deliverable (a discoverable, drivable, gated-in-dev MCP automation surface) meets intent; any deferrals named.

## Notes

- Code tweaks via Developer spawn (FD does not edit source directly), committed as new commits (no amend); re-run the affected behavior test(s) after a tweak.
- This leg is the final leg: on completion, the flight lands (status `landed`, checked off in the mission) and the PR is marked ready.

---

## Post-Completion Checklist

- [ ] H1–H3 dispositioned (fixes committed or follow-ups recorded)
- [ ] Update flight-log.md with the `hat-and-alignment` Leg Progress entry (tweaks applied / deferred + operator sign-off)
- [ ] Set leg status to `completed`; check off in flight.md
- [ ] Flight → `landed`; check off the flight in mission.md
- [ ] Commit; open/mark the draft PR
