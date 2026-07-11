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
bugs across M06, and retiring the machinery that compensates for it (the
shared-global declares in the 495-line ambient `renderer-globals.d.ts`, the
26-entry eslint globals block, two vm-replay nets, hybrid require-or-global
resolution).

### Open Questions

N/A at design level — feasibility probe-verified (maintenance report finding
1, extended by the 2026-07-11 pre-execution design review below). The pilot
leg is the remaining empirical gate.

### Design Decisions

**DD1 — Pilot-gated sweep (Architect ruling)**: Leg 1 converts a small
low-fanout slice + retags on the consuming pages, and must prove
load-order survival live before the sweep. The sweep legs are GATED on the
pilot landing green in both load paths (file:// chrome, goldfinch://
internal page), a real app boot (main-process require path), and the CJS
test suite.

**DD2 — Pilot composition (design review 2026-07-11)**: pilot =
`burner.js` + `container-menu.js` + `jar-page-model.js`. Rationale:
burner.js is the shared producer on both load paths AND is required
unconditionally by main at boot (`jars.js:41`, `jar-ipc.js:40`);
container-menu.js is its order-sensitive reader on the chrome path;
jar-page-model.js is its order-sensitive reader on the internal-page path.
This one 3-module slice proves order-survival on BOTH load paths plus
main-process require(esm) — the originally proposed pair (burner +
container-menu only) proved chrome only.

**DD3 — Transitional defer rule**: the moment a page's first shared script
converts to `type="module"`, add `defer` to EVERY remaining classic script
on that page (mirroring `settings.html`'s existing all-defer pattern).
Module scripts are always deferred; a later-positioned classic script would
otherwise start executing BEFORE an earlier-positioned module script,
inverting document order during the multi-leg transitional window.
(`renderer.js` happens to tolerate this today only because its shared-global
use is gated behind an IPC round-trip — an unstated invariant we must not
lean on.)

**DD4 — Compensating machinery adapts incrementally, retires at the end**:
the two vm-replay nets and the eslint `sourceType: 'commonjs'` binding for
`src/shared/**` break on the FIRST converted file (empirically reproduced:
`export` syntax is a SyntaxError in the nets' non-module `vm.runInContext`
and under the current per-glob eslint parse mode). Every converting leg
therefore carries its own net adaptation (drop converted files from the
replay list, or switch the net's handling for them) and an eslint override
scoping `sourceType: 'module'` to the files it converted. Leg 5 performs
final retirement only — it is NOT the first leg to touch these files.

**DD5 — Hybrid module and its producer convert together, same leg**: the
three hybrid require-or-global modules are `container-menu.js`,
`jar-page-model.js`, `automation-indicator-model.js` (design-review
correction: NOT `automation-dev.js`, which is plain unconditional CJS with
no page consumer). Each converts in the same leg as the module its hybrid
branch resolves (`burner.js` for the first two, `safe-color.js` for the
third), so the hybrid branch is deleted rather than ported.

**DD6 — `menu-controller.js` carve-out**: `src/renderer/menu-controller.js`
uses the identical dual-export shape and its globals occupy
`renderer-globals.d.ts:289-322`, but it is not in `src/shared/` and is OUT
of this flight's scope (mission constraint: no scope growth). Consequence:
Leg 5 slims the d.ts (shared-global declares out; menu-controller +
preload-bridge/window declares stay) — the ambient file is NOT fully
retired this flight. Converting menu-controller.js is a candidate follow-on
for a later cycle.

### Prerequisites

- [x] Probe evidence (report finding 1): module scripts work over file://
      (contextIsolation on) and goldfinch:// (sandbox + strict CSP);
      `require()` of ESM works unflagged under `node --test`;
      `contentTypeFor` already serves `text/javascript`
      (`internal-assets.js:17-28` confirmed)
- [x] Probe evidence (design review 2026-07-11): `require()` of a real
      `export`-syntax module works in **Electron 42.4.0's main process**
      (minimal `electron .` probe, isolated from the repo) — covers the
      main-side require surface the original probes did not (7 of the 15
      dual-export modules are required by main-process code, several
      unconditionally at module load before `app.ready`)
- [x] jsconfig verified non-blocking: `tsc --noEmit` with
      `"module": "commonjs"` accepts `import`/`export` syntax (probe, exit 0)
- [x] Flight 1 landed (fast suite for this flight's many gate runs) —
      landed 2026-07-11, suite ~1.0s

### Pre-Flight Checklist

N/A — maintenance flight.

---

## In-Flight

### Technical Approach

**Corrected conversion inventory (design review 2026-07-11 — leg design
starts from this, not the report's figures):** 19 files in `src/shared/`;
**15 dual-export** (`typeof module` tail; 18 such sites, not the report's
37), **4 plain-CJS** with no page consumers (`automation-dev.js`,
`dev-profile.js`, `guest-forward-allowlist.js`, `internal-page.js` — no
global branch to retire; convert or leave per leg-design judgment).
Notables:

- **Two dual-export modules have zero page consumers** and dead global
  branches: `sheet-accelerator.js`, `cross-view-nav.js` (main + tests
  only) — no retag, no live-boot proof needed; cheapest conversions.
- **`downloads.html` loads no shared scripts** — needs NO retag work
  (contrary to the original four-page retag list).
- **`menu-overlay.html` loads `safe-color.js`** (classic, not deferred) —
  the sheet document IS in retag scope.
- **`audit-paging.js` has a real export-name mismatch**: CJS exports
  `activeLog`, global branch exports `activeLogOf`; `settings.js:1028`
  calls the global name, the unit test requires the CJS name. ESM forces
  one canonical name — resolve via `export { activeLog as activeLogOf }`
  or a call-site rename, decided at leg design; missing this produces a
  boot-time ReferenceError on settings.
- **ESM relative specifiers need explicit `.js` extensions**
  (`import { BURNER } from './burner.js'`) — Node's ESM resolver, unlike
  the current extensionless `require('./burner')`.
- `find-overlay-globals.d.ts` / `menu-overlay-globals.d.ts` type preload
  bridges only — explicitly untouched.

**Leg 1 — pilot (DD2 slice).** Convert `burner.js`, `container-menu.js`,
`jar-page-model.js`; retag their `<script>` tags `type="module"` on
`index.html` and `jars.html`; apply DD3 (defer the remaining classic
scripts on both pages); adapt the vm nets + eslint per DD4 for exactly
these files; delete the two hybrid branches per DD5. Acceptance: live boot
of chrome AND the jars page (both load paths), a normal app boot proving
main-process require(esm) on burner.js (explicit criterion, not a side
effect), suite green via `require()`-of-ESM, typecheck/lint green.
HARD GATE: sweep legs do not start until this lands green.

**Legs 2–4 — sweep** (split by consumer surface, exact split at leg
design): convert remaining modules incl. `automation-indicator-model.js`
with `safe-color.js` (DD5) and the `audit-paging.js` name-mismatch
resolution; retag `index.html`, `jars.html`, `settings.html`,
`menu-overlay.html` (NOT downloads.html); maintain DD3/DD4 through every
leg; live-boot verification per page.

**Leg 5 — machinery retirement (final state only, per DD4).** Remove the
shared-global entries from `renderer-globals.d.ts` (file survives, slimmed:
menu-controller + bridge/window declares remain — DD6), remove the
now-empty custom-globals entries from the eslint config (26 named entries;
consolidate the per-leg sourceType overrides into one `src/shared/**`
module binding), retire or repurpose whatever remains of the two vm-replay
nets (`chrome-shared-scripts.test.js`, `jars-page-shared-scripts.test.js`)
after the per-leg adaptations. Update the DD10(b) onboarding note in
CLAUDE.md ONLY as a pointer (full doc rewrite is Flight 3).

### Checkpoints

- [ ] CP1: pilot green — both load paths live-booted, main-process
      require(esm) proven in a real app boot, suite/typecheck/lint green
      with the pilot's vm-net + eslint adaptations in place
- [ ] CP2: all of `src/shared/` ESM; all consuming pages live-boot; suite
      green
- [ ] CP3: machinery retired (d.ts slimmed per DD6, eslint globals gone,
      vm nets retired/repurposed); net line delta strongly negative; gates
      green

### Adaptation Criteria

**Divert if**: the pilot surfaces a blocking incompatibility the probes
missed (e.g. a load-order dependency that deferral breaks and can't be
expressed as an import) — halt the sweep, report, re-plan.

**Acceptable variations**: sweep-leg partitioning; the audit-paging
canonical-name choice; vm-net repurposing vs deletion; converting vs
leaving the 4 plain-CJS no-page modules.

### Legs

- [ ] `esm-pilot` — DD2 slice, hard gate (CP1)
- [ ] `esm-sweep-*` — remaining modules + page retags (CP2; count fixed at
      leg design)
- [ ] `retire-machinery` — d.ts / eslint / vm nets final state (CP3)

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing
- [ ] Documentation updated (pointer-level; Flight 3 owns the rewrite)

### Verification

- Live boot of every consuming page (chrome + jars + settings +
  menu-overlay sheet) on the converted tree; downloads.html needs no
  shared-script verification
- Suite/typecheck/lint; `npm run a11y` untouched-but-run (page markup
  changed: script tags only — confirm no a11y regression noise)
- `git diff --stat` sanity: expect strongly net-negative delta
