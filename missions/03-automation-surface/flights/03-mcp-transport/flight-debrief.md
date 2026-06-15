# Flight Debrief: MCP-Compatible Local Server + Transport

**Date**: 2026-06-14
**Flight**: [MCP-Compatible Local Server + Transport](flight.md)
**Status**: landed
**Duration**: 2026-06-13 (plan + autonomous legs 1–5) → 2026-06-14 (live legs 6–7, landed)
**Legs Completed**: 7 of 7

## Outcome Assessment

### Objectives Achieved

The flight delivered the third mission pillar — **automatability** — as a first-class surface. All 16 engine ops (12 drive + 4 observe) are exposed as MCP-discoverable tools over a loopback-only Streamable-HTTP transport (`127.0.0.1:7777`), via the official MCP SDK (`@modelcontextprotocol/sdk@1.29.0`, the project's deliberate first runtime dependency, pinned exact and confined to the transport layer). The SC7 Origin/Host allow-list guard runs first on every request (403 on deny). The surface is dev-gated (`--automation-dev`, structurally decoupled from `--remote-debugging-port`) so nothing ships until Flight 4. A real MCP client connected over the transport, discovered all 16 tools, and drove the running browser end to end — navigation, trusted input, tab management, screenshot, DOM, and accessibility-tree reads — confirmed by rendered-state evidence.

### Mission Criteria Advanced

- **SC6** (MCP-compatible interface — discover + invoke + drive end to end): **advanced and behavior-test-backed** — `mcp-drive-end-to-end` passed 9/9 live, exercising all 16 tools with pixel- and a11y-confirmed observation and an independent whole-window cross-check.
- **SC7** (local-only; loopback bind + Origin/Host allow-list defeating DNS-rebinding): **transport/bind/origin half landed and behavior-test-backed** — `mcp-loopback-origin-guard` passed 7/7 live (non-loopback Host/Origin and the DNS-rebinding shape all 403'd; loopback no-Origin and port-mismatch passed). The key-gated half of SC7 is Flight 4.
- The deferred SC1–SC4 behavior-test backing now has its apparatus (the MCP client over the transport) and its specs authored — the Flight-6 migration will run them.

## What Went Well

- **The Witnessed behavior-test apparatus vindicated the whole mission premise.** The mission deferred three flights to build this surface specifically so it could dogfood its own tests. On its first real use, the live `mcp-drive-end-to-end` run caught a transport-lifecycle defect that 471 unit tests could not see by construction (see Key Learnings). This is the clearest possible payoff for the deferred apparatus.
- **SDK confinement (DD1) is airtight and verifiable.** `@modelcontextprotocol/sdk` is imported in exactly two production files (`mcp-server.js` + the `main.js` mount); `mcp-tools.js` and `origin-guard.js` import nothing. The engine and op modules stayed SDK-free and dependency-free. This is the flight's best-executed design property and a reusable "quarantine a heavy SDK" pattern.
- **`origin-guard.js` is a model security predicate** — pure, Electron-free, exhaustively reasoned and unit-tested (34 cases: substring-loopback trap, IPv6-mapped/bracketed authorities, `"null"` opaque-origin deny, fail-closed missing Host, deliberate port-agnostic allow). The guard stayed first in `onRequest` even through the Leg-6 multi-session rework.
- **Design review added real, pre-implementation value.** The Leg-1 review caught (high severity) that reusing `isAutomationDevEnabled` would co-bind the server under `dev:debug` and re-introduce the DD10 confound; it forced the narrower `isMcpAutomationEnabled` predicate. The Leg-2/3 reviews corrected DD6 edge classifications and a test-count error before implementation.
- **The autonomous-1–5 / live-FD-guided-6–7 leg split was the single best structural decision** — it correctly recognized which work is headlessly provable (code + unit + spike) vs. which needs the WSLg GUI + a real client, and the deferred single-review-and-commit model worked cleanly.
- **The defect was converted into a permanent, headless regression** (`automation-mcp-server.test.js`) — a live-only-discoverable bug is now CI-runnable.

## What Could Be Improved

### Process

- **Multi-connection / reconnect was demoted to an "acceptable variation" instead of an acceptance property.** DD2 and Leg 1 framed the session model as "decide per whatever the SDK makes simplest for one local consumer; document the choice." No spec said "a second client must connect" or "a client must reconnect after disconnect" — so the property the mission actually depends on (external Claude Code reconnects routinely; the-one + dogfooding are concurrent consumers) was never expressed as acceptance, and neither the implementer nor 471 unit tests had a reason to exercise it. Spec accuracy failed not by being wrong but by being **silent** on a load-bearing behavior.
- **The DD10 affordance gap was foreseeable at flight-design time.** DD10 asked to observe the DevTools/MCP conflict *without* `--remote-debugging-port`, but Goldfinch's only DevTools-open path **is** `--remote-debugging-port` — a circular gap that a one-step "by what affordance will DevTools be open in this venue?" check at design would have surfaced before the leg.

### Technical

- **Supply-chain blast radius (the standing liability).** "One sanctioned runtime dependency" pulls in **17 direct / ~166 transitive** production packages (express, hono, cors, jose, zod, ajv, raw-body, eventsource, pkce-challenge, …). Goldfinch went from **zero** runtime deps to ~166 — none of express/cors/hono are on Goldfinch's actual code path (the transport runs over plain Node `http`), yet they ship. The flight log discloses this honestly as the accepted DD1 trade-off, but it is now the dominant `npm audit`/Dependabot surface; an SDK CVE or transitive advisory is a live release-gating risk that didn't exist before.
- **Unbounded request-body buffering in the multi-session router.** `readJsonBody` (`mcp-server.js`) fully buffers + parses any no-session POST body to test `isInitializeRequest`, with **no size cap**. Low risk while loopback-only + dev-gated, but it should get a cap before Flight 4 ships the surface.
- **Untested transport edge cases**: oversized/malformed body paths in `readJsonBody`, and the `routeRequest(...).catch(...)` 500 path, have no tests (the happy + reconnect + concurrent lifecycle paths are covered).

### Documentation

- Documentation is complete and accurate: `docs/mcp-automation.md` (cross-checked against `mcp-tools.js`), the CLAUDE.md MCP-transport section (SDK-as-sole-runtime-dep note), the README dev note, and the `.mcp.json` `goldfinch` entry. No gaps identified. One forward note: the supply-chain consequence of DD1 is worth a line in the project's security/release posture docs (it currently lives only in the flight log).

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Single stateful transport → **multi-session** (transport-per-`initialize`, keyed Map) | Live behavior test found the single transport bound one session for the app's lifetime (no reconnect / no 2nd client); the SDK's canonical stateful pattern is per-session | **Yes** — adopt the SDK's documented multi-session shape as the default for any future MCP server; never connect a single stateful transport once at startup |
| Narrower `isMcpAutomationEnabled` gate (exact `--automation-dev` only) vs. reusing `isAutomationDevEnabled` | Design review: reusing the broad predicate would co-bind under `dev:debug` and re-introduce the DD10 CDP confound | **Yes** — gate decoupling must be structural (predicate-level), not procedural |
| DD10 closed as a **recorded finding** (conflict not stageable) rather than an observation | Circular affordance gap: the only DevTools-open path is the `--remote-debugging-port` confound DD10 must avoid | Partial — the *finding* stands; the follow-up affordance is tracked (below) |
| `pressKey` accepts `key` as an alias for `name` | HAT ergonomics: an agent intuitively sending `{key:"Enter"}` got `unknown key undefined` | Maybe — "accept the obvious alias + enumerate the vocabulary in the description" is good agent-facing-tool hygiene worth applying as tool shapes solidify (Flight 9) |
| Run logs document the runs; ephemeral evidence (screenshots/a11y dumps) not committed | Per ARTIFACTS evidence policy (PII + repo-bloat) | Already standard |

## Key Learnings

1. **Transport/protocol/wire-lifecycle defects are structurally invisible to unit tests and design review — they live in the runtime wiring the fakes stub away.** This is now the **second consecutive flight** where the transport layer had a defect caught only by live verification (Flight 1: CDP `canScroll`/`buttons` event shape; Flight 3: session lifecycle). Unit/integration tests validate *the shapes the code emits*; the defects live in *the protocol lifecycle and runtime wiring*. The cure is cheap and proven: a **headless end-to-end test that exercises the real client↔server loop across more than one interaction** (the new `automation-mcp-server.test.js`, ~0.29s, would have caught this at Leg 1).
2. **"Single local consumer" silently became "single connection ever."** A reasonable-sounding scope phrase hid a load-bearing requirement. Connection-lifecycle (reconnect, concurrency, restart) is a first-class property, not an implementation detail to be "documented as a choice."
3. **DD1's "one dependency" is one *direct* dependency and ~166 transitive ones.** The identity-level cost of adopting an SDK is the whole tree, not the package count in `package.json`.
4. **A precondition staged by an affordance needs an affordance-reachability check at design time** (the DD10 circularity).

### Test Metrics (this run, 2026-06-14)

- `npm test`: **478 / 478 pass**, 0 fail, 0 skipped/todo, 6 suites; wall-clock **~341 ms**. `npm run typecheck` clean; `npm run lint` clean. No flakes observed.
- **Count delta vs priors**: Flight 1 debrief baseline **358** → Flight 2 **391** → **Flight 3 478** (**+87** this flight: +24 drive-tools, +13 observe-tools (+DD7 regression net kept green), +34 origin-guard, +CDP-decoupling cases, +4 multi-session regression, +3 pressKey alias).
- **Timing baseline shift (not a regression)**: wall-clock rose ~150 ms → ~341 ms, almost entirely the new `automation-mcp-server.test.js` suite (~0.29s) — the **first suite in this project that does real socket I/O** (four live SDK client↔server loopback round-trips) rather than pure-function/fake-engine assertions. Future debriefs should read this as the new baseline, not a slowdown. (Per the Flight-2 debrief, `node --test` wall-clock is parallelism-dependent and noisy; the count delta is the trustworthy figure.)

## Recommendations

1. **Standardize a headless multi-interaction end-to-end test for any leg that wires a protocol/transport/IPC seam.** Use `automation-mcp-server.test.js`'s 4-case shape as the template: first client, **reconnect after disconnect**, **two concurrent clients (distinct sessions)**, stop→restart-same-port. Make these explicit acceptance properties in the leg spec — not "acceptable variations." (Critical — would have moved this defect from Leg 6 to Leg 1.)
2. **Treat the SDK transitive-dep tree as a first-class supply-chain surface.** Add `npm audit` / dependency-advisory review to the release/CI posture; treat an SDK version bump as a security-review-worthy event, not a routine Dependabot accept. (Important.)
3. **Flight 4 (gating) must layer key auth alongside the guard-first ordering and the per-session model.** Slot key validation as a second pre-routing gate in `onRequest` (after `isAllowed`, before `routeRequest`); bind the jar-scoped key to the session at `onsessioninitialized` (not per-call), and thread jar identity through the per-session registry for enumeration/action filtering. Add a request-body size cap while you're in the transport. (Important.)
4. **Add an affordance-reachability check to flight design** — for any test requiring a precondition staged by an affordance, verify at design time the affordance exists in the test's own environment. (Minor, but cheap.)
5. **Schedule the non-CDP DevTools-open affordance** (a dev-only, `--automation-dev`-gated way to open guest DevTools) so DD10's `attach-failed` branch can finally be observed confound-free — likely Flight 7 alongside the ungated-`:9222`-path retirement, since both touch the dev-affordance surface. (Minor.)

## Action Items

- [ ] **Methodology**: add "multi-interaction lifecycle (reconnect / concurrent / restart) is an explicit acceptance property, headless-tested" to the transport/protocol/IPC leg-design checklist (carry into the `/flight` and `/leg` skill guidance via the next methodology pass). — *crosses into mission-control methodology; raise with the operator.*
- [ ] **Flight 4**: request-body size cap in `mcp-server.js`; key-auth as a pre-routing gate after the origin guard; jar-key↔session binding at `onsessioninitialized`.
- [ ] **Supply chain**: record the zero→~166 transitive-dep consequence in the project's security/release posture (a line in CLAUDE.md or the maintenance notes); add SDK-bump-is-a-security-event to the release checklist.
- [ ] **Flight 6**: run the four authored draft specs; expect `devtools-cdp-conflict` to remain blocked on the DevTools-open affordance (do not treat DD10's `attach-failed` branch as closable until the affordance lands).
- [ ] **Flight 7 (or wherever the dev-affordance surface is touched)**: add a non-CDP, `--automation-dev`-gated DevTools-open affordance; then close the mission's CDP-single-client Open Question.
- [ ] **Tests** (low priority): cover `readJsonBody` oversized/malformed paths and the `onRequest` 500-catch.
