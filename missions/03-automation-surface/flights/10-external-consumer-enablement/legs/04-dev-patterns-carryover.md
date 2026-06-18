# Leg: dev-patterns-carryover

**Status**: completed
**Flight**: [External-consumer enablement + README reframe](../flight.md)

## Objective
Carry the F9 Rec-3 internal dev-pattern guidance into `CLAUDE.md`: document the `runSerialized`
async-serialization mutex shape and add a short pointer to the inject-then-run no-persistence pairing.

## Context
- **DD5** (flight): F9 explicitly carried these doc items to F10; doc-only, rides the same
  documentation sweep. Internal contributor guidance, not consumer-facing.
- **`runSerialized`** lives at `src/main/automation/toggle.js:52-57` — a single-chain mutex that
  serializes each op after the prior one, **tolerates a prior rejection** (`.catch(() => {})` so a
  failed op doesn't wedge the chain) while still surfacing each op's own error to its own caller, and
  uses an **identity guard in `finally`** (`if (inFlight === mine) inFlight = null`) so it doesn't clear
  the chain when a later op has already extended it. It replaced `main.js`'s old `rebinding` variable
  and covers both `applyEnabledChange` and `rebind`.
- **Inject-then-run pairing**: the contract that `injectScript(...)` defining a global must be paired
  with an immediate single `evaluate(...)` because no cross-call persistence is guaranteed (a navigation
  clears it). Stated for consumers in `docs/mcp-automation.md` (Consumer Contract, leg 2); CLAUDE.md
  gets a one-line pointer for contributors.
- **Placement**: `CLAUDE.md` has a `## Patterns` section with `### ` subsections, including
  `### Automation engine (src/main/automation/)` — the natural neighborhood. (Find by section name, not
  line number — CLAUDE.md line numbers drift as legs 1–3 land first.)

## Inputs
- `CLAUDE.md` exists with a `## Patterns` section and an `### Automation engine` subsection.
- `src/main/automation/toggle.js` contains `makeAutomationToggle` (function from ~line 44) wrapping
  `runSerialized` (the serialization logic at **lines 52-57** — cite this in CLAUDE.md).
- The inject-then-run no-persistence prose already exists in the working tree at
  `docs/mcp-automation.md` (the `injectScript`/eval section); leg 2 promotes it into a named Consumer
  Contract. The CLAUDE.md pointer references `docs/mcp-automation.md` **by file path** so it stays valid
  regardless of leg 2's heading choices — no ordering dependency on leg 2.

## Outputs
- `CLAUDE.md` documents the `runSerialized` mutex shape (what it guarantees, where it lives, when to
  reuse it) within the Patterns section, plus a one-line inject-then-run pointer into
  `docs/mcp-automation.md`.

## Acceptance Criteria
- [ ] `CLAUDE.md` describes the `runSerialized` async-serialization pattern: single in-flight chain,
      rejection-tolerant continuation (a failed op doesn't wedge the next), per-caller error surfacing,
      and the identity-guarded `finally` clear — citing `src/main/automation/toggle.js`.
- [ ] The guidance states **when to reuse** it (serializing mutating ops that must not interleave, e.g.
      bind/rebind/toggle), so a future contributor reaches for it instead of an ad-hoc `await prior`
      (which wedges on a rejected prior op).
- [ ] A one-line pointer to the **inject-then-run no-persistence pairing** is present, referencing
      `docs/mcp-automation.md` **by file path** (durable against leg 2's heading choices).
- [ ] The addition sits in the existing `## Patterns` section (near `### Automation engine`), matching
      CLAUDE.md's voice and depth; no unrelated edits.
- [ ] No source files changed (CLAUDE.md only).

## Verification Steps
- `grep -n 'runSerialized' CLAUDE.md` — pattern documented with the source citation.
- `grep -n 'inject' CLAUDE.md` — inject-then-run pointer present.
- Read the new subsection — confirms it captures rejection-tolerance + identity-guard, not just "it's a
  mutex", and that it says when to reuse.
- `git diff --stat` — only `CLAUDE.md` changed.

## Implementation Guidance
1. **Add a short pattern entry** under `## Patterns` (a new `### ` subsection, or fold into
   `### Automation engine`). Summarize `runSerialized`'s three properties (single chain;
   rejection-tolerant via `.catch(()=>{})`; identity-guarded `finally`) and cite
   `src/main/automation/toggle.js`. State the reuse rule: prefer it over a bare `await prior` when
   serializing mutating ops, because a bare await wedges the chain on a rejected prior op.
2. **Add the inject-then-run pointer**: one line noting that `injectScript` must be paired with an
   immediate `evaluate` (no cross-call persistence), with a link/reference to the Consumer Contract in
   `docs/mcp-automation.md`.
3. Keep it tight — this is a reference note, not a tutorial.

## Edge Cases
- **Don't duplicate the consumer-facing prose**: the full inject-then-run rationale lives in
  `docs/mcp-automation.md`; CLAUDE.md only points to it.
- **Optional fold**: per the flight, this leg may be folded into `consumer-contract` if convenient — but
  as authored it targets `CLAUDE.md` (a different file/audience), so keeping it separate is clean.

## Files Affected
- `CLAUDE.md` — `runSerialized` pattern note + inject-then-run pointer in the Patterns section.

---
