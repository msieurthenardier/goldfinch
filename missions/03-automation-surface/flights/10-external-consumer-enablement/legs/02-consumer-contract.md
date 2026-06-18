# Leg: consumer-contract

**Status**: completed
**Flight**: [External-consumer enablement + README reframe](../flight.md)

## Objective
Add a brief, stated **Consumer Contract** section to `docs/mcp-automation.md` that indexes the stable
guarantees an external consumer can build against (already documented in scattered sections), states the
loopback reach boundary, and confirms/tightens the production getting-started so a consumer can onboard
unaided.

## Context
- **DD3** (flight): the contract guarantees already exist as prominent sections — this is a
  **consolidation/index**, not a rewrite. Cross-reference; don't duplicate prose (the duplication DD3
  itself warns against).
- **DD2** (flight): reach is **out of Goldfinch's domain** — Goldfinch binds `127.0.0.1` (SC7); how a
  consumer's process reaches that loopback is the consumer's concern. State it as a boundary.
- **Architect M2**: the guarantees are already prominent — inject-then-run pairing
  (`docs/mcp-automation.md:291-310`), internal-session eval/devtools exclusion (`:305-310, 332-338`),
  result/refusal semantics (`## Result and refusal semantics`, `:352-374`), auth model (`:164-203`),
  off-by-default/key-gated/loopback (top status block `:8-13`), `.mcp.json` registration (`:471-485`).
- **Architect M3**: the production getting-started must be **fenced from** the dev `AUTOMATION_DEV_MINT`
  path (`:50-90`) and must state **where the per-jar key reaches the example client** (the env var the
  example client reads after leg 3, `example-client-fix`).

## Inputs
- `docs/mcp-automation.md` exists (~485 lines) with all the sections cited above.
- The 21-tool reference is present and accurate vs `src/main/automation/mcp-tools.js`.
- Leg 3 (`example-client-fix`) defines the env var the example client reads for its Bearer key —
  coordinate the name (it may land before or after this leg; reference it by the same name both places).

## Outputs
- `docs/mcp-automation.md` gains a concise **Consumer Contract** section (near the top, after Overview)
  that:
  - enumerates the stable guarantees with cross-references to their detailed sections (not copied prose),
  - states the loopback reach boundary (DD2),
  - links the production getting-started.
- The production getting-started is confirmed accurate and explicitly fenced from the dev mint path, and
  names the env var carrying the per-jar key to the example client.

## Acceptance Criteria
- [ ] A **Consumer Contract** section exists in `docs/mcp-automation.md` listing the stable guarantees:
      off-by-default / opt-in, per-jar key-gated (+ env-gated admin tier), loopback-only bind,
      inject-then-run no-persistence pairing, internal-session (`goldfinch://settings`) eval/devtools
      exclusion even for admin, and the result/refusal error contract.
- [ ] Each guarantee **cross-references** its existing detailed section rather than duplicating the full
      prose (links/anchors or clear section names; controlled restatement of the one-line guarantee is OK).
- [ ] The section states the **reach boundary**: Goldfinch binds `127.0.0.1` only; reaching that loopback
      from the consumer's process is the consumer's responsibility (no shim is provided or implied).
- [ ] The **production getting-started** (enable via Settings toggle → mint a per-jar key in the Keys UI
      → add a `.mcp.json` entry at the live port → run a client) is present and accurate, and is
      **explicitly distinguished** from the dev `AUTOMATION_DEV_MINT` path.
- [ ] The getting-started states the **enable-before-mint ordering explicitly**: the operator must flip
      the `automationEnabled` toggle **first** — the Keys mint button is disabled while the toggle is off.
- [ ] The getting-started clarifies the `.mcp.json` entry goes in **the consumer's own MCP client
      config** (Claude Code / Cursor / etc.), **not** in Goldfinch's repo `.mcp.json` (which ships empty
      by design).
- [ ] The getting-started states **where the per-jar key goes** for the example client — the
      `GOLDFINCH_MCP_KEY` env var — matching what leg 3 implements.
- [ ] The existing **Example client** section of the doc (currently `:456-469`) is updated to note the
      `GOLDFINCH_MCP_KEY` precondition (it currently shows only `dev:automation` + `node …` with no key)
      — this leg owns `docs/mcp-automation.md`, so the section is reconciled here, not left stale.
- [ ] No factual drift introduced (tool count stays 21; endpoint/port and refusal codes match the rest
      of the doc and the code).

## Verification Steps
- `grep -n 'Consumer Contract' docs/mcp-automation.md` — section exists.
- Read the section — each guarantee links/points to its detailed section; reach boundary stated; no
  large duplicated blocks.
- Confirm the production getting-started references the same env var name used in
  `scripts/mcp-example-client.mjs` (leg 3).
- `grep -nc 'AUTOMATION_DEV_MINT' docs/mcp-automation.md` — dev path still fenced as dev-only; the new
  prod getting-started does not blur into it.

## Implementation Guidance
1. **Add the Consumer Contract section** after `## Overview`. Keep it short — a guarantee list with a
   one-line statement each and a pointer ("see *Authentication*", "see *Result and refusal semantics*",
   etc.). The point is a single authoritative index, not a re-derivation.
2. **State the reach boundary** explicitly in that section (DD2): one or two sentences. Loopback bind is
   the contract; reaching it is the consumer's environment concern (trivial when co-resident on the host).
3. **Reconcile the getting-started** as a consolidated **step list** that references (not rewrites) the
   existing `## Launch` / `## Settings controls` / `## Authentication` sections. Verify the production
   path matches current code (Settings toggle is the sole production bind gate; per-jar key minted in
   the Keys UI; entry added to the **consumer's** client `.mcp.json` at the live port). State the
   **enable-before-mint ordering** (mint button disabled while the toggle is off) and that the consumer
   may need to pick their **target jar** (the `default` jar is the usual starting point — a jar key only
   authorizes its own jar's tabs). Fence it from the dev `AUTOMATION_DEV_MINT` section. Name
   `GOLDFINCH_MCP_KEY` as the env var carrying the key to the example client (matches leg 3).
4. **Update the Example client section** (`:456-469`) to add the `GOLDFINCH_MCP_KEY` precondition
   alongside the `dev:automation` + `node …` invocation (post-leg-3 the example client requires it).
5. **Do not duplicate** the inject-then-run / internal-session / refusal-semantics prose — link to it.
   The top status block (`:8-13`) already lists the guarantees in compressed form; echo its phrasing as
   the authority rather than inventing new wording.

## Edge Cases
- **Env var name settled = `GOLDFINCH_MCP_KEY`**: leg 3 reads `process.env.GOLDFINCH_MCP_KEY`; this leg
  names the same var. No open coordination — use it directly.
- **Example client auth depends on leg 3**: the example client only authenticates after leg 3 lands. The
  getting-started is written against the **fixed** client; both legs land in the same uncommitted batch
  before the verify run, so this is consistent at commit time. (If documenting before leg 3 lands, the
  working tree's example client still 401s — don't live-test the getting-started until the verify leg.)
- **`.mcp.json` destination**: the entry is for the **consumer's own** MCP client config, never
  Goldfinch's repo `.mcp.json` (which ships empty by design, `:471-485`). Make this explicit in prose.
- **Internal-session exclusion line range**: the devtools exclusion blockquote is `:332-338` (matches the
  eval exclusion pattern at `:305-310`) — authoring pointers only; reference by section name in prose.
- **Anchor stability**: prefer section-name references over fragile line numbers in the prose (line
  numbers drift); line numbers in *this leg artifact* are fine as authoring pointers.
- **Don't expand scope**: this leg adds an index + reconciles getting-started + the Example client
  section; it does not document new tools or rewrite the existing reference sections.

## Files Affected
- `docs/mcp-automation.md` — new **Consumer Contract** section; getting-started reconciliation/fencing;
  Example client section gains the `GOLDFINCH_MCP_KEY` precondition.

---
