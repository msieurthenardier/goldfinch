# Leg: hat-page-sidebar — Secrets Management page restructure

**Status**: in-flight
**Flight**: [HAT + Alignment — End-to-End Acceptance](../flight.md)

## Objective

Restructure `goldfinch://vault` from a flat, single-column page into a **master-detail nav+main** layout
matching the cookie-jars page, and **rename it "Secrets Management"** (it holds more than passwords). Left
nav entries: a **Settings** section (auto-lock, import, master-key management) + one section **per vault**
(Global with a globe icon; each jar with its color dot). Operator-designed, worked through live during the
F5 HAT (alignment mode — implement a first cut, then iterate with the operator).

## Context

- Split from `hat-fixes-01` (the design review found this a restructure of the ~911-line imperative
  `vault.js`, comparable to the jars-nav leg — its own leg).
- **Pattern to mirror — the jars page master-detail** (`src/renderer/pages/jars.html:39` `<nav
  aria-label="Jars"><ul id="jars-nav" role="list">` + `<main>`; driven by
  `src/renderer/pages/jars-nav-controller.js` `createJarsNav` — `buildNavEntry`, `setActiveNav` via
  `aria-current`, `observeSections`, keyboard nav). jars.html itself notes it adapted settings.html's
  nav+main.
- **Jar color** — jars carry a 6-digit hex `color` (`src/shared/jar-page-model.js` `toJarViewModel` →
  `{id,name,color,isDefault,isBurner}`); the nav dot reuses it (apply `isSafeColor`, the existing backstop).
- **Icons** — inline SVG-path arrays (e.g. `ICON_EYE`, `jars-cookies-panel.js:139`). **No globe icon
  exists** → add an `ICON_GLOBE` path array for the Global vault entry.
- **DD5 boundary is preserved** — the page holds only TRIGGERS (buttons that open chrome sheets); no
  master-equivalent secret enters the page DOM. Moving master-key controls into a "Settings > master-key
  management" subsection **relocates buttons only** — the secret flow (sheets + Buffer channel) is
  unchanged. `textContent`-only throughout.
- **Subsumes I7** — the per-jar divider re-level (done in `hat-fixes-01`) is superseded by the new per-vault
  nav sections; the old flat per-jar grouping goes away.

## Requirements (operator design)

1. **Rename → "Secrets Management"** — both the **kebab menu item** (currently "Passwords" /
   `vault` entry in `overlay-menus.js buildKebabModel`) and the **page title/`<h1>`**. The internal URL
   stays `goldfinch://vault` (no route change).
2. **nav+main layout** — replace the flat page with `<nav aria-label="Secrets Management"><ul
   id="vault-nav">` + `<main>` holding the sections; a nav controller mirroring `createJarsNav`
   (`aria-current` active state, arrow-key roving, focus management). Sections built dynamically from
   vault state (the existing `internal-vault-state` read: global + `jars.list()`).
3. **"Settings" nav entry** (top) → a section grouping the **existing** controls: auto-lock timeout,
   import, and **master-key management** (change master password, rotate recovery, recover, admin
   rotate/provision, export). These are today's rotation/recovery/import/auto-lock sections — regrouped
   under one "Settings" heading with subsection headers, NOT re-implemented.
4. **Per-vault nav entries** — one per vault: **Global** (with the new `ICON_GLOBE`) + each jar (with a
   **color dot** from the jar's `color`). Each entry's section shows that vault's login/secret items
   (the existing item list + editor) and, for jars, that jar's access keys.
5. **Left nav matches the jars page** visually + behaviorally (the same nav rail styling / active state /
   keyboard model). Reuse `jars-nav-controller.js` if cleanly generalizable, else mirror it.

## Acceptance Criteria

- [ ] The page and the kebab menu item both read **"Secrets Management"**; URL unchanged.
- [ ] The page is a **nav+main master-detail** matching the jars page — a left nav with a **Settings**
      entry + one entry **per vault** (Global with a globe icon, jars with color dots); selecting an entry
      shows its section; `aria-current` tracks the active entry; keyboard (arrow/Tab) nav works.
- [ ] **Settings** groups auto-lock + import + master-key management (change/rotate/recover/admin/export)
      as subsections — same controls, regrouped; every secret action still routes through its chrome sheet
      (no master-equivalent secret in the page DOM).
- [ ] Each **vault** entry shows that vault's items (+ jars show their access keys); the "Lock now" button
      (from `hat-fixes-01`) remains reachable (global — e.g. in the nav or Settings).
- [ ] Existing tests pass; page-model/nav unit tests updated for the new structure; `npm test`,
      `npm run typecheck`, lint clean; `npm run a11y` unaffected (chrome sheets unchanged).

## Verification Steps

- Unit: the vault page model / nav controller (entries built from vault state; global + jars; active
  state); the rename. Mirror `jars` nav tests.
- Live (HAT, iterative): the operator reviews the layout, the nav, the globe/dot affordances, the Settings
  grouping, and per-vault navigation — iterate on specifics.
- `npm test` / typecheck / lint clean. Grep: no master-equivalent secret enters the page DOM (the
  restructure preserves the trigger-only page).

## Implementation Guidance

1. **Rename** first (menu item + `<h1>`/title) — small, isolated.
2. **Layout** — restructure `vault.html` to nav+main (mirror `jars.html`); split `vault.js`'s imperative
   section builders into (a) a nav controller (mirror `jars-nav-controller.js`) and (b) per-section
   render, driven by the vault-state read. Keep the master-key/import/auto-lock controls' existing
   sheet-triggering wiring — regroup, don't rewrite.
3. **Globe + dots** — add `ICON_GLOBE`; the jar dot reuses the jar `color` (via the jar model +
   `isSafeColor`).
4. **Preserve DD5** — trigger-only page, `textContent`-only, no secret in the DOM.

## Edge Cases

- **Locked vault** — the nav renders; per-vault sections gate their items on unlock as today; Settings
  (auto-lock/import/master-key triggers) is reachable while locked where it is today.
- **A jar with no vault yet** — a per-jar entry with an empty/"no secrets" state (or omit until a vault
  exists — operator's call at live review).
- **Global has no access keys / no color** — globe icon, no dot; no access-key subsection (access keys are
  a jar concept).
- **Many jars** — the nav scrolls like the jars nav.

## Files Affected

- `src/renderer/chrome/overlay-menus.js` — menu item rename.
- `src/renderer/pages/vault.html` — nav+main structure + title.
- `src/renderer/pages/vault.js` + a new `vault-nav-controller.js` (or generalized `jars-nav-controller.js`) — the nav + per-section render.
- `src/renderer/pages/vault.css` — nav rail styling (match jars); globe/dot.
- `src/shared/*` — the vault page model (nav entries from vault state); `ICON_GLOBE`.
- `test/unit/…` — page-model/nav tests; the rename.

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified (+ operator live-review iterations applied)
- [ ] Tests passing (`npm test`, typecheck, lint, a11y)
- [ ] Update flight-log.md (I5 → this leg; resolution)
- [ ] Set this leg's status to `landed`
- [ ] Commit on the flight/05 branch
