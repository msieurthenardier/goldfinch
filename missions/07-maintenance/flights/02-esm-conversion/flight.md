# Flight: ESM Conversion of src/shared/

**Status**: ready
**Mission**: [Codebase Health — 2026-07-11 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] `src/shared/` on real `import`/`export`; collision class structurally
      gone; compensating machinery retired (criterion 1)

---

## Pre-Flight

### Objective

Convert `src/shared/` from CJS+global dual-export (loaded via classic
`<script>` tags into one shared lexical scope) to real ES modules, eliminating
the top-level-const collision defect class that caused three real-boot-only
bugs across M06, and retiring the machinery that compensates for it (495-line
ambient `renderer-globals.d.ts` shared-global declares, 32-entry eslint
globals block, two vm-replay nets, hybrid require-or-global resolution).

### Open Questions

N/A at design level — feasibility probe-verified (maintenance report finding
1). The pilot leg is the remaining empirical gate.

### Design Decisions

**Pilot-gated sweep (Architect ruling)**: Leg 1 converts 2–3 low-fanout
modules + ONE page and must include an order-sensitive dependency pair (e.g.
burner → container-menu) — module scripts are always deferred while several
current tags are NOT, so load-order survival must be proven live before the
sweep. The sweep legs are GATED on the pilot landing green in both load paths
(file:// chrome, goldfinch:// internal page) and the CJS test suite.

### Prerequisites

- [x] Probe evidence (report finding 1): module scripts work over file://
      (contextIsolation on) and goldfinch:// (sandbox + strict CSP);
      `require()` of ESM works unflagged under `node --test`;
      `contentTypeFor` already serves `text/javascript`
- [ ] Flight 1 landed (keeps the suite fast for this flight's many gate runs —
      soft prerequisite, not a hard dependency)

### Pre-Flight Checklist

N/A — maintenance flight.

---

## In-Flight

### Technical Approach

Inventory note: the report counted 15 dual-export modules among ~19 files in
`src/shared/` — re-derive the exact conversion inventory at leg-design time
(some files may not carry the dual-export shape).

**Leg 1 — pilot.** Convert 2–3 low-fanout modules incl. one order-sensitive
dependency pair; retag their `<script>` tags `type="module"` on ONE page;
verify live boot of that page (real app, both a chrome-loaded and
internal-page consumer if the chosen modules span both; else scope to one and
note it), suite green via `require()`-of-ESM, typecheck/lint adapted for the
pilot slice. HARD GATE: sweep legs do not start until this lands green.

**Legs 2–4 — sweep** (split by consumer surface, exact split at leg design):
convert remaining modules; retag `index.html`, `jars.html`, `settings.html`,
`downloads.html` (+ the menu-overlay sheet document if it loads shared
modules); remove the hybrid require-or-global resolution
(`automation-dev.js`, `jar-page-model.js`, `automation-indicator-model.js`);
live-boot verification per page.

**Leg 5 — machinery retirement.** Remove the shared-global entries from
`renderer-globals.d.ts` (whole ambient file if nothing else remains), the
eslint shared-globals block (split `sourceType` config), and the two vm-replay
nets (`chrome-shared-scripts.test.js`, `jars-page-shared-scripts.test.js`) —
retire or repurpose per what the sweep leaves meaningful. Update the DD10(b)
onboarding note in CLAUDE.md ONLY as a pointer (full doc rewrite is Flight 3).

### Checkpoints

- [ ] CP1: pilot green — both load paths live-booted, suite/typecheck/lint
- [ ] CP2: all of `src/shared/` ESM; all pages live-boot; suite green
- [ ] CP3: machinery retired; net line delta strongly negative; gates green

### Adaptation Criteria

**Divert if**: the pilot surfaces a blocking incompatibility the probes missed
(e.g. a load-order dependency that deferral breaks and can't be expressed as
an import) — halt the sweep, report, re-plan.

**Acceptable variations**: sweep-leg partitioning; keeping a slimmed d.ts if
non-shared declares remain; vm-net repurposing vs deletion.

### Legs

- [ ] `esm-pilot` — pilot slice, hard gate (CP1)
- [ ] `esm-sweep-*` — remaining modules + page retags (CP2; count fixed at
      leg design)
- [ ] `retire-machinery` — d.ts / eslint / vm nets (CP3)

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing
- [ ] Documentation updated (pointer-level; Flight 3 owns the rewrite)

### Verification

- Live boot of every page (chrome + 3 internal) on the converted tree
- Suite/typecheck/lint; `npm run a11y` untouched-but-run (page markup changed:
  script tags only — confirm no a11y regression noise)
- `git diff --stat` sanity: expect strongly net-negative delta
