# Squawk 0107: Project CLAUDE.md is too verbose — trim to what a capable model needs

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-28
**Completed**: 2026-09-28

## Report

The project `CLAUDE.md` has grown into a design-history archive: mission/flight/leg/DD provenance,
squawk numbers, "amended mid-flight" narratives, and step-by-step mechanism walkthroughs that restate
what the code and `docs/` already say. It is loaded into every session, so the size is paid on every turn.
Current models don't need that much detail. Trim it to the rules, invariants, and gotchas a model
can't recover by reading the code, and cut the rest — it already lives in `docs/`, the flight artifacts, or the code.

## Evidence

- `wc CLAUDE.md` → 410 lines, 25,706 words, ~198 KB; 20 lines are over 2,000 characters each
  (single-bullet walls, e.g. the Password vault, Bookmarks, and Crash/hang sections).
- Heavy provenance noise throughout (`M15 F2 L3 L3-DD-E`, `squawk 0100`, `design-review HIGH`, …).
- No test reads the file (`grep -rn "readFileSync[^;]*CLAUDE" test scripts` → no hits). Tests only cite
  section names in comments (`test/unit/seam-contract.test.js:9,22,41`,
  `test/helpers/renderer-line-budget.js:9`, `session-snapshot-continuous-wiring.test.js:17`, …), so keep
  those section headings (or update the comments to match).
- Related open squawks **0105** and **0106** propose *adding* CLAUDE.md content. Fold them into this pass,
  or re-check them after it lands.

## Guidance for the fix

- Keep in CLAUDE.md: commands, the process/trust-boundary architecture, security invariants (the NEVER / ⚠️ rules),
  non-obvious gotchas (the ones marked "live-probed"/"measured"), the house conventions, the
  Flight Operations block, and the project-specific planning rules.
- Cut: decision provenance (mission/flight/leg/DD/squawk ids), historical "was X, now Y"
  narratives, and mechanism detail the code explains itself.
- **Default is delete, not relocate.** The project already has plenty of docs and context
  (`docs/`, mission/flight/leg artifacts, debriefs, squawks, code comments). Before moving any
  content elsewhere, check that it isn't already there — search `docs/`, `missions/`, `squawks/`,
  and the relevant source. If it exists anywhere, just cut it (at most leave a pointer). Only
  relocate content that exists nowhere else **and** is worth keeping; never create a new doc just
  to hold what was trimmed.
- Update the `seam-contract.test.js` comment that says `SEAM_COUNT` is "dual-sourced" with CLAUDE.md,
  or keep a one-line seam-count note so the two stay in sync.
- Target: roughly 25–35 KB, well under a fifth of the current size.

## Corrective Action
Rewrote `CLAUDE.md` from 197,681 bytes (410 lines) to 44,593 bytes (~230 lines). Note: this lands above the 25-35 KB target; the remaining bulk is Commands, Release/CI and Flight Operations (kept verbatim, ~9 KB together) plus the security invariants and live-probed gotchas, which were deliberately kept. A further pass could cut the Password vault and Menu-overlay sections harder.

**Kept**: Commands; process/trust-boundary architecture and the three main-to-chrome routing classes; the `closed`-handler `win.*` wedge; the WebContentsView "DOM correct != render correct" invariant; all NEVER/warning rules (isSafeTabUrl, PDF-viewer carve-out, four gates, INTERNAL_PARTITION, CSP stamp, chrome-fetch invariant, eager sheet scrub, tab-switch resize order, four-guard channels, survivesBlur, cert-trust, killRequested, resolveOnce, Origin/Host guard, isolated-world throw resolves undefined, provenance value-bound, generation never in chrome); sqlite placeholder/tokenizer gotchas; container-query self-restyle no-op; house conventions (ESM/CJS quartet, seam closed set = 41 / `SEAM_COUNT`, Grep-AC, regex-target pins, MockTimers, drift guard, planner/actuator, cast-to-local); Formatting is Prettier's with the 1550 / 1100 line budgets and `test/helpers/renderer-line-budget.js`; Release/CI and Flight Operations blocks (incl. project planning rules) verbatim. Squawks 0105/0106 were not folded in.

**Cut**: mission/flight/leg/DD/squawk provenance ids, "was X, now Y" and amendment narratives, step-by-step mechanism walkthroughs (vault capture/generate/rotation internals, bookmarks bar/star details, crash-recovery sequencing, suggestion close matrices, settings-cache minutiae, channel-by-channel sheet protocol), all of which the code, `docs/vault.md`, `docs/renderer-menu.md`, `docs/mcp-automation.md`, and mission/flight artifacts already carry.

**Relocations**: none. Everything trimmed was deleted; pointers to existing docs/code were left where useful. Prior-existence checks: cited content lives in `docs/` (vault.md, renderer-menu.md, mcp-automation.md, dev-testing.md), in `missions/` flight/leg artifacts and in source/test comments (the tests pin most of the invariants); nothing unique worth moving was found.

**Test-cited section names preserved** (headings or same-named text): Regex-target mutation pins, Grep-AC convention, MockTimers recipe, Two specifier shapes, by consumer, New-shared-module checklist, Renderer evaluate-seam closed-set rule, CJS-by-design quartet, Chrome indicators (rule c), Formatting is Prettier's, MCP automation ("READABLE BUT NOT SCRIPTABLE since M15 F3"), destroyed-window rule. The seam-count note (41) is kept in the ESM section.

## Verification
- `npx prettier --write CLAUDE.md` then `npm run format:check`: pass.
- `timeout 600 npm test`: 5682 tests, 5678 pass, 0 fail, 4 todo.
- `wc -c CLAUDE.md`: 197,681 before, 44,593 after (above the 25-35 KB target, see Corrective Action).
- Cited section names grepped in the new file: all resolve.

Original criteria: `npm test`, `npm run format:check` pass; `wc -c CLAUDE.md` meets target;
every section name cited from `test/` comments still resolves.

## Sign-Off
**Reviewer**: independent Reviewer agent (Sonnet), scoped to the diff
**Verdict**: confirmed — non-blocking notes: 44.6 KB misses the ~25–35 KB target (Password vault and Menu-overlay sections are the densest remaining); two cited headings now loosely match ("Real-boot defects", "`keepFocus` opens"); `test/unit/overlay-dispatch.test.js:7` cites a "unit-twin inventory" no longer in CLAUDE.md (stale comment).
**Commit**: `squawk/0107` commit on branch `squawk/0107-claude-md-too-verbose`
