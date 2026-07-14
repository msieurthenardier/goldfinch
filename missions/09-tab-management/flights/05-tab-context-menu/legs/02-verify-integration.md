# Leg: verify-integration

**Status**: completed
**Flight**: [Tab Context Menu](../flight.md)

## Objective

Author the `tab-context-menu` behavior spec (per flight DD4, incl. the
mid-strip menu-reopen row), run it Witnessed against the live app, a11y
sweep, suites; fix loop as needed.

## Acceptance Criteria

- [x] `tests/behavior/tab-context-menu.md` authored (draft/never; house
      apparatus preconditions; keyboard-trigger row notes the
      ContextMenu/F10 KEY_MAP apparatus gap and substitutes per the
      documented structural-reuse rationale, mirroring the PgDn/PgUp
      precedent).
- [x] `/behavior-test tab-context-menu` — **PASS 10/10 first run**
      (`tests/behavior/tab-context-menu/runs/2026-07-14-23-13-46.md`);
      spec `draft` → `active`. Scratch-profile convention applied
      (first use — `XDG_CONFIG_HOME` at an empty per-run dir; the
      empty-stack omission precondition held without a mid-run ruling).
      Live KEY_MAP gap probes captured (`ContextMenu`/`F10` rejected)
      as the substitution evidence; literal keypress stays HAT-scoped.
- [x] `npm run a11y` WCAG gate green (now incl. `sheet:tab-context` —
      no NEW violations; the sheet-region node matches the existing
      accepted-baseline pattern).
- [x] `npm test` 1646/1646 (~1.1 s), lint, typecheck green; flight log
      leg entry.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
