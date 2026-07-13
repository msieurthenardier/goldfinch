# Flight: Manage-Jars Page Panels

**Status**: completed
**Mission**: [Per-Jar Browsing History](../../mission.md)

## Contributing to Criteria

- [x] The manage-jars page presents each jar's data in collapsible panels
      (history, cookies, other site data) with left-nav anchors; panels
      expand/collapse independently and anchors jump to the right
      jar/section. *(this flight's primary charter — the STRUCTURE; the
      history panel's browse/search/delete content is Flight 3 — satisfied:
      8/8 live probes confirm collapsible panels, independent toggles, and
      anchor/hash navigation land correctly)*
- [ ] Groundwork for "the history panel supports browsing…" (Flight 3): the
      panel shell, the page's `history-changed` subscription, and a live
      per-jar visit count land here. *(this flight lands the groundwork —
      panel shell, subscription, live count — in full; left unchecked
      because the criterion's full text ("supports browsing recent visits,
      text search, deleting entries") is only satisfied once Flight 3 adds
      the browse/search/delete content — groundwork alone does not close
      the wording)*

---

## Pre-Flight

### Objective

Reorganize `goldfinch://jars` from always-expanded flat sections into
per-jar **collapsible per-data-class panels** — History, Cookies, Other site
data — while preserving everything the current page contracts guarantee:
focus-preserving per-section reconcile (M06 F4 DD6), the single-transient
`ui` exclusivity machine, the `action:rowId` confirm key, the dynamic
scroll-spy, and Burner's read-only carve-out. The panel taxonomy lives in a
new pure shared model module (the mission's growth-check answer), the
History panel gains a live visit count (the first real `history-changed`
consumer, plus a new `history-count` IPC twin), and the existing clear
controls regroup into their panels. No history browse/search UI yet
(Flight 3); no cookie/storage listings or counts (pinned out, below).

### Open Questions

- [x] Depth of the cookies / other-site-data panels (mission open question)
      → **counts and listings are OUT for this flight**; the panels carry
      the existing clear controls, regrouped. See DD5.
- [x] Jars-page controller growth scope check (mission open question) →
      **pure-model extraction, not a controller split**. See DD2.
- [x] Panel default state + persistence → collapsed by default, in-page
      state only. See DD4.
- [x] Where wipe/delete live under the panel taxonomy → section footer,
      outside panels. See DD1.

### Design Decisions

**DD1 — Panel taxonomy: a pure shared model maps data classes → panels.**
New `src/shared/jar-panel-model.js` (ESM, unit-tested, Electron/DOM-free)
exports the ordered panel descriptors for a persistent jar:
- `history` — label "History"; content is flight-3 territory; this flight
  renders the count line + a short hint.
- `cookies` — label "Cookies"; hosts the existing `clear-cookies` control.
- `site-data` — label "Other site data"; hosts the existing `clear-storage`
  and `clear-cache` controls (the `storage` + `cache` descriptors from
  `JAR_DATA_CLASSES`, grouped).
The model exposes `JAR_PANELS` and `panelForDataClass(classId)` so the
page renders panels and routes each `JAR_DATA_CLASSES` entry into its panel
data-driven — when Flight 3 adds the `history` data class, its clear
control lands in the History panel with no layout rethink (the
jar-data-classes header comment's promise, kept).
- **Wipe ("Clear identity") and Delete stay at the jar-section footer,
  outside all panels** — they are jar-level identity actions, not
  data-class actions.
- Burner: no panels at all (`isBurner` branch unchanged — M06 F4 DD7).

**DD2 — Growth check verdict: extract the pure model, keep ONE page
controller.** The mission's Architect flag asked for a scope check on
splitting `pages/jars.js` (1,389 lines) into per-panel modules. Verdict:
a full controller split mid-mission is refactor risk without a forcing
defect — the closure shares `state`/`ui`/`sectionMap` everywhere, and a
split would re-plumb all three. What earns extraction now is the pure
taxonomy (DD1's shared model) plus the panel DOM builders staying
table-driven so they don't multiply per class. Revisit a real split if
Flight 3's content pushes the controller past ~1,800 lines (named trigger,
logged for the debrief).
- New module registration is a **three-point onboarding** (house rule):
  `<script type="module">` in `jars.html` + flat entry in
  `INTERNAL_PAGES.jars` (`main.js`) + the script-tag contract test
  self-derives the rest (`jars-page-shared-scripts.test.js`).

**DD3 — Collapse mechanics: heading-button + region, per-section refs,
patch-in-place.** Each panel renders as an `<h3>` wrapping a
`<button aria-expanded>` that toggles a `role="region"`
`aria-labelledby`-linked content div's `.hidden` (the standard WAI-ARIA
disclosure pattern — **greenfield in this codebase**, not an existing
house pattern *(Architect review: premise corrected)*; NOT `<details>` —
we need full control of the reconcile and CSS). Panel open/closed state lives in the section's
`SectionRefs` (a `panelOpen` map keyed by panel id), diffed **in place** on
every broadcast re-render — a `jars-changed` or `history-changed` arriving
mid-interaction must never rebuild an expanded panel that hosts a focused
control (M06 F4 DD6, the inviolable rule; same discipline as
`dataConfirmOpenKey`).
- The open/close toggle itself only flips `.hidden` + `aria-expanded` —
  no content rebuild on toggle — with ONE exception *(Architect review,
  state-machine gap)*: collapsing a panel that currently owns the open
  confirm (`ui.mode === 'confirm' && ui.rowId === row.id &&` the action
  belongs to this panel's region) first calls `closeTransient()` — never
  hide a live confirm's focused buttons under a collapsed region.
- **Confirm areas are PER-REGION, gated by the ONE global `ui` singleton**
  *(Architect review — the draft's "single confirm area" and "renders
  inside the owning panel" were contradictory once buttons scatter)*:
  the Cookies panel region hosts a confirm area serving `clear-cookies`;
  the Other-site-data region hosts one serving `clear-storage`/
  `clear-cache`; the section footer hosts ONE generalized string-keyed
  confirm area serving BOTH `wipe` and `delete` (the boolean-keyed
  `deleteConfirmOpen` mechanism retires into it — one `(action, rowId)`
  key discipline everywhere; Flight 3's history clear-all will live in the
  History panel's own confirm area the same way). Exclusivity is unchanged
  — `ui` is still one page-wide singleton; each region's update diffs
  "does `ui.action` belong to MY region?" against its own open-key ref.
  `SectionRefs` shape change pinned now: `dataConfirmArea`/
  `dataConfirmOpenKey`/`deleteArea`/`deleteConfirmOpen` are replaced by a
  per-region map (`confirmAreas`/`confirmOpenKeys` keyed by region id:
  `cookies` | `site-data` | `footer`). `buildDataControlsBlock` is
  restructured into a per-region builder — **leg 2 has explicit authority
  for this builder reshape; it is NOT the DD2 controller split** (that
  clause targets splitting the file/closure, not reshaping one builder).
- Opening a confirm in a **collapsed** panel cannot happen (its buttons
  aren't reachable while hidden).

**DD4 — Default collapsed; in-page state only; independent.** All panels
start collapsed on page load (the long scroll gets shorter, per-jar
scanning faster). State is per `(jar, panel)`, held in-page only — NOT
persisted to settings (a fresh page load starts collapsed; cheap, no new
settings key; HAT can revisit). Panels toggle independently — no accordion
coupling. Deep-link affordance: each panel region gets a stable id
(`jar-<id>-<panel>`); a `hashchange`/load handler that targets a panel id
expands it and scrolls to it (acceptable to land minimal; Flights 3–5 may
link into it). **Boot-race pin** *(Architect review)*: sections exist only
after the async boot read resolves — the load-time hash check runs after
the FIRST successful `applyState` render, never on raw `load`.

**DD5 — Cookies / other-site-data depth: clear controls only, no counts,
no listings.** The mission left depth open; recon shows NO existing
main-side per-jar cookie count or storage-usage read (`ses.cookies.get` is
per-tab only; storage usage is never measured). Building those reads is
real main-process surface for panel garnish — OUT of this flight, noted as
a candidate backlog/HAT item. The History count is IN because it is one
IPC over an existing store method (DD6). Panels therefore contain: their
clear control(s) + (history) the count line + hint.

**DD6 — `history-count` IPC twin + the page becomes the first
`history-changed` consumer.** `history-ipc.js` gains
`history-count` / `internal-history-count` — payload `{ jarId }`, ok shape
`{ ok: true, count }`, same fail-closed static-string contract
(`history: count — malformed-payload | unknown-jar | store-failure`) over
the existing `historyStore.countByJar`. Preload gains `historyCount`;
`renderer-globals.d.ts` gains the declare. The jars page subscribes via
`onHistoryChanged` (handle pattern, `pagehide` cleanup beside
`offJarsChanged`) and on `{ jarId }` re-queries that jar's count only —
invalidation-signal semantics honored (re-query, never payload data). The
count renders **in the disclosure BUTTON's own label** ("History —
N visits" / "History — no visits"), glanceable while collapsed
*(Architect review: DD1/DD6 placement ambiguity pinned — a content-only
count would defeat DD4's collapsed-by-default scanning goal)*; the hint
copy lives inside the collapsible region. Patch-in-place.
- **Initial fetch is mandatory and uniform** *(Architect review, HIGH)*:
  `buildJarSection` issues `bridge.historyCount({ jarId })` at
  construction — for boot-time jars AND jars added later via `jarsAdd`
  (uniform both paths; no local "assume 0" special case — a fresh query
  is ~0.1 ms). The broadcast path only refreshes.
- Per-navigation broadcast volume is fine: the handler is one count query
  for the named jar (~0.1 ms store-side), and only when the page is open.

**DD7 — Scroll-spy and anchors unaffected by construction.** Collapse
changes scroll geometry but never the section SET, so
`observeSectionsIfChanged` keeps its key and the observer keeps working;
`scroll-margin-top` on sections still clears the sticky nav for anchor
jumps. Nav stays one entry per jar (no per-panel nav links this flight —
panel deep-links exist via DD4's ids for future surfaces).

**DD8 — A11y semantics now, polish at HAT.** The heading-button pattern
(`h3 > button[aria-expanded]` + `role="region"` + `aria-labelledby`) is
the correct disclosure semantics; `npm run a11y` cannot audit this page
(the eval tool excludes the internal session by design — recon-confirmed),
so fine-grained a11y verification is operator/HAT territory (mission
Flight 6), consistent with M06 F4 DD9's split. No new aria-live regions
(the existing no-live-on-sections rule stands; the count line is NOT
live-announced).

### Prerequisites

- [x] Flight 1 landed on `flight/01-history-store` (store + recorder + IPC
      + `historyStore.countByJar`); PR #74 open (merge pending human
      review — this flight stacks on the branch).
- [x] Recon verified: no behavior test or a11y gate asserts jars-page DOM
      (relayout cannot break existing automated gates); the one
      load-bearing contract is the script-tag test + `INTERNAL_PAGES`
      registration for any new module.
- [x] `buildJarPageModel` ordering contract (Burner last) unchanged by
      this flight.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

1. **`src/shared/jar-panel-model.js`** (new, ESM): `JAR_PANELS` ordered
   descriptors `{ id, label }` + `panelForDataClass(classId)` mapping
   (`cookies`→cookies, `storage`/`cache`→site-data, `history`→history for
   Flight 3). Unit tests pin order, mapping totality (every
   `JAR_DATA_CLASSES` id maps to a panel), and frozen-ness.
2. **`history-count` twin** in `src/main/history-ipc.js` (+ preload +
   d.ts) following the flight-1 handler conventions exactly.
3. **`pages/jars.js`**: `buildJarSection` grows a panels block between the
   name/swatch area and the footer (wipe/delete): for each `JAR_PANELS`
   entry, a heading-button + region; `buildDataControlsBlock` splits so
   each clear button renders into its panel (via `panelForDataClass`)
   while the shared confirm-area logic and `DATA_ACTIONS` stay single;
   History panel content = count line + hint. `SectionRefs` gains
   `panelOpen`/`panelRefs`; `updateJarSection` diffs panels in place.
   `onHistoryChanged` subscription + per-jar count refresh + `pagehide`
   cleanup. Hash deep-link expand handler.
4. **`jars.css`**: panel header/region styles (chevron state via
   `aria-expanded` attribute selector), collapsed spacing, reduced-motion
   respected (no height animation — instant toggle; the guest-geometry
   invariant doesn't apply to in-page DOM but instant is also the cheap
   correct default).
5. Registration: `jars.html` script tag + `INTERNAL_PAGES.jars` entry for
   the new shared module.

### Checkpoints

- [x] Panel model + count IPC unit-tested; suite ~1s; typecheck/lint green.
- [x] Live page renders three collapsed panels per persistent jar, none on
      Burner; toggles are independent; controls work inside panels
      (confirm flow intact). *(probes 1, 2, 4, 5 — see flight-log)*
- [x] Focus preservation holds: rename mid-edit + a `jars-changed`
      broadcast does not lose caret; expanded panel survives broadcasts.
      *(probe 6)*
- [x] History count live-updates while browsing in another tab
      (`history-changed` → count re-query). *(probe 3)*
- [x] Scroll-spy + nav anchors still track correctly with mixed
      expanded/collapsed sections. *(probes 7, 8)*

### Adaptation Criteria

**Divert if**:
- The panel reconcile cannot preserve focus without restructuring the
  section builder wholesale (would mean the M06 F4 DD6 discipline and the
  panel architecture are incompatible — stop, re-plan with the operator).
- The controller split (DD2's deferred option) becomes unavoidable to land
  panels at all.

**Acceptable variations**:
- Exact copy in panel headers/hints; chevron styling; count line format.
- Dropping the hash deep-link expand if it fights the scroll-spy (log it).
- Panel order tweaks.

### Legs

> Tentative; created one at a time.

- [x] `panel-model-and-count-ipc` — shared model + tests; `history-count`
      twin + preload + d.ts; registrations (html script tag +
      INTERNAL_PAGES).
- [x] `panels-relayout` — jars.js panel builders + reconcile + count
      wiring + CSS.
- [x] `verify-integration` — live boot: rendered-state screenshots
      (captureWindow) of collapsed/expanded states, focus-preservation
      probe, count live-update probe, gates green; docs touch-up
      (CLAUDE.md jars-page paragraph if its description drifted).

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged *(PR stacked on flight/01; merges after human review)*
- [x] Tests passing
- [x] Documentation updated

### Verification

- Unit: panel-model tests; history-ipc count branches (verbatim error
  strings); script-tag contract test still green with the new module.
- Live (leg 3): screenshots of the three-panel layout collapsed + expanded;
  a broadcast-while-editing focus probe driven via a second surface
  (chrome-side rename IPC) while the page holds focus; count live-update
  observed while a jar tab navigates. Internal-page DOM is deliberately
  not behavior-test territory (M06 F4 DD9) — no new Witnessed spec; the
  mission's panel criterion is operator-confirmed at the Flight 6 HAT.
