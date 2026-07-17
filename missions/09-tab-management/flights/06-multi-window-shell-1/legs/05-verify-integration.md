# Leg: verify-integration

**Status**: completed
**Flight**: [Multi-Window Shell, Part 1](../flight.md)

## Objective

Close the flight's verification: the singular-window audit artifact (DD8),
the `multi-window-shell` behavior spec authored + run Witnessed (DD9),
the single-window regression pair re-run post-ALL-legs, a11y sweep,
suites, and the documentation refresh with the accumulated
enumeration-invalidation answers from legs 2–4.

## Acceptance Criteria

- [x] `docs/behavior-specs-single-window-audit.md` committed-to-be (from
      the recon §8 sweep + anything legs 2–4 changed): per spec, its
      single-window assumption class (probe-walk / getChromeTarget-
      ambiguity / captureWindow / count-precondition / none) + the F7
      consumption note. Specs NOT edited.
- [x] `tests/behavior/multi-window-shell.md` authored (draft/never; house
      style: admin apparatus preconditions incl. pin-if-free port +
      scratch profile + fixture server; the DD9 spec-authoring constraint
      stated in Preconditions — window-2 actions/observations via admin
      raw-wcId ops EXCLUSIVELY, per-wcId captureScreenshot never
      captureWindow, no OS-focus reliance (WSLg; spike facts); the
      leg-2-carry boot-state bracket — snapshot enumerateTabs immediately
      after mint). Steps cover DD9's observables: New Window (second
      window, addressable chrome, exactly one boot tab, working roaming
      menu); move-to-new-window (SAME-wcId discriminator — re-parent path;
      source closes ranks; no boot tab in target; jar + history intact via
      goBack on the same wcId; focus-follows via the deterministic
      last-focused accessor retarget, not OS focus); close-one-of-N (app
      alive, surviving window drives, whole-window capture of persist
      tabs → reopen in survivor restores LIFO appended); quit-on-last
      unchanged; the L4 sole-tab divergence noted Out of Scope (HAT).
- [x] `/behavior-test multi-window-shell` — Witnessed run PASS; spec
      `draft` → `active`. (FD orchestrates; the Developer authors.)
- [x] Single-window regression pair re-run post-all-legs, specs
      unmodified: `tab-context-menu` + `closed-tab-reopen` PASS (the
      leg-2 triple covered the conversion; legs 3–4 changed the opener,
      stack, manager, and renderer branches since — the pair re-proves
      the invariant at flight end; find-overlay-geometry was re-proven at
      leg 2 and its surfaces are untouched by legs 3–4 EXCEPT the manager
      — the sheet-interplay coverage inside tab-context-menu suffices).
- [x] `npm run a11y` green (no new violations; no new sheet states this
      flight). `npm test`/lint/typecheck green.
- [x] Docs refresh (grep-ACs + the count/enumeration-invalidation
      answers accumulated in legs 2–4 flight-log entries): CLAUDE.md
      (main-process architecture: window registry, three routing classes,
      lifecycle split, roaming overlays interim, last-focused accessor
      interim + F7 pointer; closed-tab-stack paragraph: windowId tagging,
      whole-window capture, push-cache/sync opener; tab-context-menu
      paragraph: move-to-new-window row + sync opener); README (New
      Window + Move to new window + Ctrl+N in the shortcuts table;
      multi-window divergences note: global reopen pop, sole-tab-close
      survival); docs/mcp-automation.md (interim last-focused-window
      semantics; enumerateTabs scope; captureWindow two-window caveat).
      Grep-ACs: `grep -n "window registry" CLAUDE.md`,
      `grep -n "Ctrl+N\|Move to new window" README.md`,
      `grep -n "last-focused" docs/mcp-automation.md` all hit.
- [x] tests/behavior/tab-context-menu.md wording fix rides along (the
      leg-3 doc answer: the "menu open is asynchronous" precondition
      bullet is now stale — the opener is synchronous; ALSO the
      find-overlay-geometry step-8 "fresh/reset" erratum from the leg-2
      triple) — the ONLY spec edits, both wording-only, neither changes
      an Expected Result's substance.
- [x] Flight log leg entry; leg → landed. Do NOT commit.

## Files Affected

- `docs/behavior-specs-single-window-audit.md` (new)
- `tests/behavior/multi-window-shell.md` (new) + runs/ (FD)
- `CLAUDE.md`, `README.md`, `docs/mcp-automation.md`
- `tests/behavior/tab-context-menu.md`, `tests/behavior/find-overlay-geometry.md`
  (wording-only errata)
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
