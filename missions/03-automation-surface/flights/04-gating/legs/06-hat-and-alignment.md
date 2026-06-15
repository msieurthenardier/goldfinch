# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Gating — opt-in + key auth + audit](../flight.md)

## Objective
Operator-guided human acceptance test: the operator drives a keyed MCP client confined to one jar, observes jar-scoping live in the real GUI (the thing the FD-driven machine run couldn't stage — multi-jar confinement via the chrome jar switcher), confirms the jar key is refused `captureWindow`, and confirms the env-gated admin tier reaches the whole-window composite + sees all jars.

## Context
- Optional leg (flight spec). Auth gate + admin tier already FD-driven live-confirmed (run logs under `tests/behavior/*/runs/`); this is the operator's hands-on confirmation + an alignment opportunity, focused on the GUI-staged multi-jar confinement.
- Apparatus: `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (prints the jar key to stdout); add `GOLDFINCH_AUTOMATION_ADMIN=1` for the admin run. MCP client = `scripts/mcp-example-client.mjs` (jar key via a Bearer-aware variant) or the Bearer-aware probe. If port 7777 is busy, override with `GOLDFINCH_MCP_PORT`.

## Acceptance Criteria (verification steps — operator performs)
- [x] **Launch + mint** — `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` opened the window and printed `AUTOMATION_DEV_MINT {"key":…}`; surface enabled. (Done repeatedly this session; port overridden to 7799 — a stale non-goldfinch service holds 7777 on this box.)
- [x] **Jar key drives its own jar** — a keyed external MCP client (a user-wide Claude Code session, the canonical use-case #2) drove the default jar live: openTab, navigate, typeText, click (Google result → Electron docs), captureScreenshot, enumerateTabs, scroll — all visibly changed the real window. `enumerateTabs` returned only the default jar's tab (`jarId:"default"`).
- [~] **Live multi-jar confinement** — **dispositioned (operator-accepted):** the GUI-staged cross-jar/internal/burner refusals were not hand-staged; they are exhaustively covered by the 579 headless integration tests (fake multi-jar world, real session-object-identity) + the partial-live `mcp-jar-scoping` run. Operator accepted FD-driven + headless coverage (AskUserQuestion, 2026-06-14). The full Witnessed GUI run remains a noted follow-up.
- [x] **Jar key refused whole-window capture** — live: the default-jar key's `captureWindow` → `automation: admin-only` (distinct refusal).
- [x] **Admin tier (env-set)** — live: with `GOLDFINCH_AUTOMATION_ADMIN=1`, the admin key's `captureWindow` returned a whole-window PNG and the admin key was accepted (200) while the same key was inert (401) on an admin-env-unset server.

## Alignment notes (real-world findings this session)
- **External-consumer reach validated early (mission use-case #2 & #3):** a user-wide Claude Code MCP client attached through the gate and drove the browser; and a **cross-OS-boundary** consumer (curl from the Windows side, the-one's path) completed an MCP `initialize` (200, session issued) over WSL2 mirrored-loopback with the Bearer key — origin guard + auth gate both pass. the-one's remaining work is its own client config (auth header + session-id), per the mission's "bridge is the consumer's concern."
- **`scroll` bug found + fixed (out-of-band, operator-approved):** synthetic `sendInputEvent` mouseWheel doesn't move `<webview>` guests; rewired to in-process CDP `Input.dispatchMouseEvent` (commit `cb58231`, crosses Flight-2 DD8). Verified live (~2500px scroll).
- **WSL2 mirrored-mode note:** "loopback" admits the Windows host side of this machine — still same physical machine, still key-gated; relevant to the operator's threat model.

## Notes
Issues found are fixed inline (new commit, no amend) and the step re-verified. Evidence (screenshots) → ephemeral `/tmp/behavior-tests/...`, never committed.

---

## Post-Completion Checklist
- [x] All verification steps passed (or dispositioned)
- [x] Update flight-log with HAT results
- [x] Set this leg's status to `completed`
- [x] Check off this leg in flight.md; flight → landed; check off flight in mission.md
- [x] Commit
