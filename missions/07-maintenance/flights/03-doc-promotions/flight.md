# Flight: Doc Promotions

**Status**: ready
**Mission**: [Codebase Health — 2026-07-11 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] CLAUDE.md carries the three promoted patterns, post-ESM (criterion 4)

---

## Pre-Flight

### Objective

Land the three pattern promotions recommended across M06's debriefs, written
for the post-ESM codebase (Flight 2 retires 2 of 4 DD10(b) checklist items —
this flight is deliberately sequenced last so the docs describe what exists).

### Open Questions

N/A.

### Design Decisions

N/A (placements identified by the maintenance inspection; wording sourced from
the F4 flight debrief and mission debrief).

### Prerequisites

- [ ] Flight 2 landed (hard dependency — the DD10(b) rewrite depends on what
      ESM retired)

### Pre-Flight Checklist

N/A — maintenance flight.

---

## In-Flight

### Technical Approach

One doc leg, three edits to `CLAUDE.md`:

1. **Uniform focus rule** — append to the existing focus-idioms section
   (`### Cross-view focus + tab-type idioms`): any DOM container currently
   holding `document.activeElement` is patched in place, never rebuilt —
   applies uniformly (name inputs, swatch grids, nav) on every
   broadcast-rendered page. Source: M06 F4 DD6 + debrief.
2. **`action:rowId` confirm-transition key** — new short subsection near the
   focus idioms: a shared confirm area serving N sibling-visible actions keys
   its open/swap transition on the `(action, rowId)` string pair, never a
   boolean — a boolean silently breaks the same-row action swap. Source: M06
   F4 leg 3 design review.
3. **DD10(b) checklist rewrite** — rewrite the shared-module onboarding
   checklist for the post-ESM world: whichever items Flight 2 retired come
   out; the surviving items (page `<script type="module">` tag,
   `INTERNAL_PAGES` entry) stay; ADD the preload-bridge declare rule
   (`renderer-globals.d.ts` interface entries for new bridge methods — the
   M06 F4-leg-3 / F5-leg-1 recurrence) which ESM does NOT retire (bridge
   methods are contextBridge surface, not shared modules).

Also verify the behavior-test AUTHORING.md pointer notes landed mission-control
side (already committed there) — no goldfinch-side action, just note in the
flight log.

### Checkpoints

- [ ] CP1: three edits landed; CLAUDE.md internally consistent with the
      post-Flight-2 tree; no stale references to retired machinery anywhere in
      CLAUDE.md (grep for renderer-globals.d.ts shared-global mentions, eslint
      globals block, vm-replay nets)

### Adaptation Criteria

**Acceptable variations**: wording, section titles.

### Legs

- [ ] `claude-md-promotions` — the three edits + consistency grep (CP1)

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing (docs-only; run the suite once as the standard gate)
- [ ] Documentation updated (this IS the documentation)

### Verification

- Consistency grep per CP1; suite/typecheck/lint pass unchanged
