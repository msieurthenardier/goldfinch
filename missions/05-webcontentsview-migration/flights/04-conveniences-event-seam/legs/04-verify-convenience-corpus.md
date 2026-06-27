# Leg: verify-convenience-corpus

**Status**: ready
**Flight**: [Conveniences & Event-Seam Re-architecture](../flight.md)

## Objective

Prove SC4 (conveniences parity on the native view surface) and SC6-partial (find MCP op) by running the
full convenience behavior-test corpus + the two new rendered-state specs as Witnessed runs on the live
app, plus the `npm run a11y` gate, recording a run log per spec.

## Type

**Behavior-test-driven verification leg** — not an autonomous code leg. The Flight Director drives each
spec via `/behavior-test {slug}` (the run skill orchestrates its own Executor + Validator crew). No
Developer/Reviewer agents. Requires the live environment (see Prerequisites).

## Prerequisites (operator + environment)

- App launched via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`
  `GOLDFINCH_AUTOMATION_ADMIN=1` and a pinned free `GOLDFINCH_MCP_PORT` (confirm nothing is bound on the
  chosen loopback port first). Capture the `adminKey` (and jar key) from the `AUTOMATION_DEV_MINT` stdout
  line.
- Operator confirms preconditions per spec (running instance, a content-rich web page for the geometry
  spec, ability to open Settings/Downloads for the internal-menus spec).
- WSLg is the in-loop venue; macOS deferred to Flight 6 (DD6).

## Run plan

1. **Gating sub-step — run the two NEW specs FIRST** (design-review ordering fix, DD3): new specs often
   need an apparatus fix on first run; validate them before the 9-spec corpus so a late spec-apparatus
   bug doesn't force a corpus restart.
   - `/behavior-test tab-surface-geometry`
   - `/behavior-test internal-tab-menus`
   - **Authoritative freeze tell:** `readDom(chromeWcId)` of `#webviews` `backgroundImage` (`data:` URL
     = frozen; `''`/`none` = live). `captureWindow` menu-above pixels are **corroborating only** on the
     WSLg fallback path (see each spec's "Apparatus caveat"). `captureWindow` IS authoritative for
     panel-resizes-guest and find-bar inset (real bounds changes).
2. **Full convenience corpus** as Witnessed runs (after the gate passes):
   `page-zoom`, `print-to-pdf`, `find-in-page`, `devtools-cdp-conflict`, `page-context-menu`,
   `kebab-menu`, `menu-dismissal`, `spellcheck`, `downloads-surface`.
   - `find-in-page` is where the **WSLg cold-start re-verify** (flight Open Question) happens on the live
     MCP surface — confirm `findInPage` returns real match counts via the re-homed op; if the cold-start
     `{0,0}` quirk reproduces, confirm the ported main-process retry handles it (record disposition).
   - `responsive-tab-strip` is **retired** (recon `already-satisfied`); not in this corpus.
3. **a11y gate:** run `npm run a11y` against the live surface (the real-environment WCAG gate that legs
   1-3 could not run headless — folded here, where the automation surface is up). Confirm no NEW
   `(rule id, node-selector)` findings vs the curated baseline.

## Acceptance Criteria

- [ ] `tab-surface-geometry` and `internal-tab-menus` each PASS (or carry an operator-accepted
  WSLg-class known issue with disposition recorded) — gating sub-step before the corpus.
- [ ] All nine corpus specs run as Witnessed runs; each PASS or operator-accepted known issue with
  disposition recorded in its run log.
- [ ] `findInPage` returns live match counts via the MCP surface (SC6-partial); cold-start quirk
  disposition recorded.
- [ ] `npm run a11y` reports no new findings vs baseline.
- [ ] A run log committed per spec at `tests/behavior/{slug}/runs/{ts}.md`.

## Notes

- A failing behavior test is an unmet acceptance criterion: the leg does not land while a test fails —
  investigate + fix-forward (new commit, no amend) + re-run, OR operator accepts as a known issue with
  disposition recorded (flight debrief carries it forward).
- Evidence (screenshots/snapshots) lives at the ephemeral `/tmp/behavior-tests/...` path, never
  committed; only the run-log markdown is committed.

---

## Post-Completion Checklist

- [ ] Both new specs + nine corpus specs run; run logs committed
- [ ] `npm run a11y` green
- [ ] Update flight-log.md with the Leg-4 verification summary (per-spec verdicts + dispositions)
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
