# Flight Log: External-consumer enablement + README reframe

**Mission**: First-Class Browser Automation Surface
**Flight**: 10 — External-consumer enablement + README reframe

---

## Reconnaissance Report

Source items walked against current code (`main` @ PR #54). The mission roadmap's Flight 10 line and
the F9 debrief carried items (Rec 3, Rec 5).

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Reframe README (media-panel → control / privacy / automatability) | `confirmed-live` | `README.md:5-9,30+` lead entirely with the media-panel pitch; no mention of the automation surface anywhere in the README | Real work → `readme-reframe` leg |
| Promote inject-then-run no-persistence pairing to a stated boundary (F9 Rec 3) | `partially-satisfied` | Present as an inline note at `docs/mcp-automation.md:303` (the `injectScript` tool row), not as a stated consumer guarantee | Scope down to consolidation → `consumer-contract` leg |
| Promote internal-session eval/devtools exclusion to a hard boundary (F9 Rec 3) | `partially-satisfied` | Present inline at `docs/mcp-automation.md:306,333` and enforced in code; not surfaced as a top-level contract boundary | Consolidate into the contract section |
| Add `runSerialized` async-serialization shape to dev-patterns (F9 Rec 3) | `confirmed-live` | No `runSerialized`/dev-pattern mention in `CLAUDE.md` (grep empty) | Small carryover → `dev-patterns-carryover` leg |
| `createJar` jar-lifecycle MCP tool (F9 Rec 5) | `confirmed-live` but **DEFERRED** | No jar-provisioning tool among the 21 registered (`src/main/automation/mcp-tools.js`); `grep createJar` empty | Operator deferred (OQ3) — out of scope; record as a follow-on item |
| External end-to-end drive (SC6) | `already-satisfied` (demonstration) | Operator has driven Goldfinch from the-one (native external install) over the loopback surface; `mcp-drive-end-to-end` behavior test exists at `tests/behavior/mcp-drive-end-to-end.md` | Close SC6 by documentation + a live getting-started confirmation (OQ2/DD1), not a new behavior test |
| Cross-boundary "reach" / host-networking shim | `already-satisfied` (out of domain) | the-one is now a **native install** (operator, 2026-06-17); surface binds `127.0.0.1` by SC7 design; reaching loopback is the consumer's concern | Not Goldfinch's problem domain — state as a boundary (DD2), build nothing |
| Tool-count accuracy (21) | `already-satisfied` (docs) / `drifted` (example client) | docs `:19,261` + `CLAUDE.md:167` say **21**; but `scripts/mcp-example-client.mjs:65-67` still says "17 tools" | Fix the example-client comment in `example-client-fix` leg |
| Example client authenticates against the gate | `confirmed-live` defect | `scripts/mcp-example-client.mjs` builds a bare `StreamableHTTPClientTransport` with **no `Authorization` header** → `401` on `initialize` (`mcp-server.js:490-491,533-537`); working pattern at `scripts/lib/mcp-client.mjs:80` | **Architect H1** — fix before SC6 close → `example-client-fix` leg (DD6) |

**Operator confirmations (planning, 2026-06-17):**
- the-one connect+control is already proven — no live the-one drive leg.
- the-one is a native install now, not a container — the reach/shim concern is fully moot.
- `createJar` deferred to a later flight.
- No HAT/alignment leg.
- SC6 closes on the existing demonstration + a documented-path confirmation.

---

## Design Review

**Architect review (2026-06-17) — VERDICT: approve-with-changes.** SC6-closed-by-documentation is
defensible (drive capability genuinely exists + demonstrated; the contract is real, not aspirational),
and the leg breakdown is right-sized for a closeout. Findings folded into the spec:
- **H1 (HIGH)** — `mcp-example-client.mjs` sends no auth key → `401`; the verify run can't pass and SC6
  can't be honestly marked met without fixing it. → new `example-client-fix` leg + DD6.
- **M1 (MED)** — example-client comment "17 tools" is stale (real 21). → folded into `example-client-fix`.
- **M2 (MED)** — the contract guarantees are already prominent sections, not scattered asides; scope the
  `consumer-contract` leg as a linking/index section, not a rewrite (avoid the duplication DD3 warns of).
  → leg reworded.
- **M3 (MED)** — getting-started must fence dev `AUTOMATION_DEV_MINT` from the production Settings-key
  path and state where the per-jar key reaches the example client. → folded into `consumer-contract`.
- **L1** — README `### Development` (`:125`) already points at the automation surface; reframe targets
  the intro/Features thesis, don't duplicate. → `readme-reframe` reworded.
- **L2** — confirmed: README has one header logo, no screenshots. **Operator clarified (2026-06-17): the
  imagery-removal request was for a different project; keep the logo.** Imagery removal dropped from scope.

Confirmed-accurate premises (Architect, auditable): README media-panel-only intro + DOWNLOADS markers
owned by `update-readme.mjs`; `docs/mcp-automation.md` is a near-complete consumer reference (DD3
consolidation premise holds); no `runSerialized` in `CLAUDE.md` (DD5); `createJar` genuinely absent
(correctly deferred); example client uses only HTTP-transport tools (not WSLg-blocked); the production
toggle→key→`.mcp.json`→client path matches the code.

No second review cycle needed — only the one source-edit (DD6) was added; all other changes are
spec-wording tightenings.

## Flight Director Notes

- **2026-06-17 — Flight start.** `/agentic-workflow` loaded; `leg-execution.md` crew file validated
  (Crew / Interaction Protocol / Prompts all present). Branch `flight/10-external-consumer-enablement`
  created off `main`; flight status `ready` → `in-flight`. 5 legs: `readme-reframe`, `consumer-contract`,
  `example-client-fix`, `dev-patterns-carryover`, `verify-and-close`. Per the skill: design + per-leg
  design-review, implement all autonomous legs uncommitted, single code review + commit at the end.
- **Sequencing note.** `verify-and-close` runs last and includes a *live* getting-started confirmation
  needing the running app + enabled surface (GUI/WSLg). Spawned agents are headless — if the live run
  can't be executed autonomously, that step is handed to the operator (FD-guided) before SC6 is marked
  met; the doc-reconciliation half of the leg is autonomous.

## Execution Notes

### Leg design + design review (legs 1–4, 2026-06-17)
- Authored leg artifacts `01-readme-reframe`, `02-consumer-contract`, `03-example-client-fix`,
  `04-dev-patterns-carryover` (independent files → designed as a batch). Leg 5 (`verify-and-close`)
  authored after legs 1–4 land (depends on their outputs + has a live-run step).
- Spawned 4 Developer (Sonnet) design reviews in parallel. **All returned approve-with-changes**;
  feedback incorporated:
  - **Leg 1**: posture must name the Settings `automationEnabled` toggle as the bind gate (not just
    "key-gated"); DOWNLOADS block is lines 14–28 (heading 12 is editable); keep README high-level, keep
    admin tier out, don't reorder Download, leave `### Development` "dev-gated" wording as-is.
  - **Leg 2**: state enable-before-mint ordering (mint button disabled while toggle off); `.mcp.json`
    goes in the **consumer's** client config, not Goldfinch's repo; consolidated step list referencing
    existing sections; also update the Example client doc section with the `GOLDFINCH_MCP_KEY`
    precondition; env var settled = `GOLDFINCH_MCP_KEY`.
  - **Leg 3**: also fix the stale `getChromeTarget` aside (refused for lack of admin scope, not lack of
    auth); add header-comment `GOLDFINCH_MCP_KEY` precondition AC; optional bad-key hint.
  - **Leg 4**: cite `toggle.js:52-57`; reference `docs/mcp-automation.md` by **file path** (durable vs
    leg 2 heading changes); drop drift-prone CLAUDE.md line numbers.
- **Decision (FD):** changes are spec-precision refinements, not design reworks → **no second
  design-review cycle** (skill: skip when only minor fixes applied). Legs 1–4 → `ready`.
- **Implementation plan:** legs 1–4 touch four different files (`README.md`,
  `docs/mcp-automation.md`, `scripts/mcp-example-client.mjs`, `CLAUDE.md`) with no overlap → spawn 4
  implement Developers in **parallel** (no merge conflict risk). Single code review + commit after.

### Implementation (legs 1–4, 2026-06-17)
- 4 implement Developers (Sonnet) ran in parallel, each on its own file; all signaled
  `[HANDOFF:review-needed]`; all four leg statuses → `landed`. Changed files:
  `README.md` (+16/-4), `docs/mcp-automation.md` (+73/-2 — Consumer Contract + getting-started +
  Example-client key precondition), `scripts/mcp-example-client.mjs` (+38/-8 — Bearer auth + key guard +
  comment fixes), `CLAUDE.md` (+10 — `runSerialized` pattern + inject-then-run pointer).

### Static verification (FD, 2026-06-17)
- `npm test` → **773 pass / 0 fail**; `npm run typecheck` → clean; `npm run lint` → clean;
  `node --check scripts/mcp-example-client.mjs` → OK.
- Cross-file drift checks: DOWNLOADS block byte-for-byte unchanged ✓; README→`mcp-automation.md` link
  count = 2 ✓; logo retained ✓; no stale "17 tools" ✓; `GOLDFINCH_MCP_KEY` consistent in client+docs ✓;
  21-tool count + port 49707 consistent ✓.

### Independent code review (Reviewer, Sonnet, 2026-06-17) — [HANDOFF:confirmed]
- All four legs meet acceptance criteria; correctness cross-checked against code (Settings toggle is the
  sole production bind gate `mcp-server.js:488`; 21 tools in `mcp-tools.js`; Bearer construction matches
  `scripts/lib/mcp-client.mjs`; `GOLDFINCH_MCP_KEY` per-jar vs `GOLDFINCH_MCP_ADMIN_KEY` admin correct).
  No overreach; DOWNLOADS block confirmed unchanged.
- **One non-blocking nit fixed (FD):** the example-client usage comment prepended `GOLDFINCH_MCP_KEY=` to
  the `dev:automation` server-launch line, where the server doesn't consume it (dev key comes from
  `AUTOMATION_DEV_MINT`). Corrected to show `GOLDFINCH_AUTOMATION_DEV_MINT=1` on the server line and the
  key only on the client line. Re-checked: `node --check` OK, lint clean.

### Close-out (leg 5 + flight, 2026-06-17)
- **Live SC6 confirmation operator-waived.** Static verification + independent review established the
  docs are accurate; SC6 is already empirically demonstrated by the-one driving Goldfinch end-to-end;
  the example-client auth fix is character-for-character identical to the proven `scripts/lib/mcp-client.mjs`
  harness. Operator judged the belt-and-suspenders live example-client run low marginal value and
  waived it. A doc/example bug, if ever surfaced, is a one-line follow-up — not a flight blocker.
- All 5 legs → `completed`. **SC6 marked met** + **Flight 10 ticked** in `mission.md`. Flight status →
  `landed`. Single commit covers the 4 file changes + all flight/leg/mission artifacts. Draft PR opened.
- `[COMPLETE:flight]`
