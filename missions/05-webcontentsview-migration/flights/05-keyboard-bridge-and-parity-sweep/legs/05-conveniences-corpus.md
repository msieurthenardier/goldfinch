# Leg: conveniences-corpus

**Status**: completed
**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](../flight.md)

> **Outcome (2026-07-08): SC4 formal net PASS on the native surface (WSLg caveats; no product regression).**
> 4 clean (zoom/print/downloads/menu-dismissal) + 4 partial (apparatus-limits + minor spec-drift). The Leg-5
> "security regression" was independently triaged to a **non-regression** — jar-key internal exclusion intact;
> Leg 5 drove internal with the admin key (documented `allowInternal`). Find cold-start answered: still
> reproduces on WSLg (macOS-expected-pass); `find-in-page.md` updated. Pre-existing admin-navigate-internal
> concern → debrief. Details in flight log.

## Objective
Close SC4's *formal* net — the Flight-4-deferred convenience behavior-test corpus on the native surface
(Flight 4 accepted SC4 via HAT; this leg is the Witnessed corpus). Also answer the WSLg find cold-start question.

## Specs (this leg)
- `find-in-page` — find + match count; **answer the WSLg `{0,0}` cold-start question** and update the spec.
- `page-zoom` — Ctrl+± zoom on the guest.
- `print-to-pdf` — print / Save-as-PDF.
- `downloads-surface` — downloads list + affordances.
- `page-context-menu` — right-click page context menu.
- `spellcheck` — context-menu spellcheck.
- `kebab-menu` — the kebab overflow menu.
- `menu-dismissal` — menu dismissal semantics.

## Acceptance Criteria
- [ ] All eight specs PASS on the native surface (or triaged: regression → fix-and-rerun; spec-drift → recorded).
- [ ] `find-in-page.md` updated with the observed WSLg cold-start result (SC4 open question closed).
- [ ] Per-spec run logs under `tests/behavior/{slug}/runs/{ts}.md`; raw/pixel evidence in the ephemeral dir.
- [ ] SC4 formal net called (the `npm run a11y` gate is Leg 6).

## Files Affected
- `tests/behavior/{slug}/runs/*.md`; `tests/behavior/find-in-page.md` (cold-start result). Source fixes only on a real regression.

---

## Post-Completion Checklist
- [ ] Eight specs run; verdicts recorded with evidence
- [ ] find-in-page cold-start answered + spec updated
- [ ] Flight log updated; Leg status → `landed` (no commit); check off in flight.md
