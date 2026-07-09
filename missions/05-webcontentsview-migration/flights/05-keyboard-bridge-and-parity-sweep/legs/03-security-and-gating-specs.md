# Leg: security-and-gating-specs

**Status**: completed
**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](../flight.md)

> **Outcome (2026-07-08): 6/6 PASS, Validator CONFIRMED.** Both BLOCKING security specs clean (trust boundary +
> jar scoping intact on the new surface); freeze-frame retirement confirmed by the two first-ever geometry/menu
> runs. No regressions, no source changes. Evidence-hygiene caveat + cosmetic spec-drift → flight log. Run logs
> under `tests/behavior/{slug}/runs/`.

## Objective
Re-verify the trust-boundary and gating behavior tests on the native `WebContentsView` surface — run first
because a silent partition/scoping drift breaks either the internal trust boundary or MCP jar-scoping.

## Context
- Mission constraint: `internal-session-exclusion` + `mcp-jar-scoping` (byte-exact partition-identity guards)
  run early. This leg bundles them with the never-run gating specs and the apparatus-gated privacy specs.
- Apparatus: admin-wired instance on `GOLDFINCH_MCP_PORT=8899` (Leg-1 recipe; 49707 is Hyper-V-reserved here).

## Specs (this leg)
- `internal-session-exclusion` — internal `goldfinch://` session excluded from automation (even admin).
- `mcp-jar-scoping` — a jar key sees only its jar's tabs; admin sees all + internal.
- `tab-surface-geometry` — (never run) per-tab `WebContentsView` bounds/visibility on the new surface.
- `internal-tab-menus` — (never run) menu behavior on internal tabs.
- `farbling-correctness` — fingerprint farbling values on the guest main world.
- `tab-scheme-guard` — hostile-scheme navigation blocked through all vectors.

## Acceptance Criteria
- [ ] All six specs PASS on the new surface (or a failure is triaged: real regression → fix-and-rerun; or spec
  drift → spec update recorded).
- [ ] Per-spec run logs written under `tests/behavior/{slug}/runs/{ts}.md` (committed); evidence stays in the
  ephemeral `/tmp/behavior-tests/…` path.
- [ ] Any regression found is logged in the flight log; security-critical failures (internal exclusion, jar
  scoping) are BLOCKING.

## Verification Steps
- Executor drives each spec's steps against the admin-wired instance; independent Validator judges evidence.
- Security specs (`internal-session-exclusion`, `mcp-jar-scoping`) are the trust-boundary gate — treat any
  drift as blocking.

## Files Affected
- `tests/behavior/{slug}/runs/*.md` (run logs). Source fixes only if a real regression surfaces.

---

## Post-Completion Checklist
- [ ] Six specs run; verdicts recorded with evidence
- [ ] Flight log updated (results + any regressions)
- [ ] Leg status → `landed` (no commit — batch-commit at flight end)
- [ ] Check off in flight.md
