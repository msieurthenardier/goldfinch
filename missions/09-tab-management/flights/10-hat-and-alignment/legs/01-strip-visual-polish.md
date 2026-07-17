# Leg: L1 — strip-visual-polish

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

Two by-hand HAT findings, CSS-only: **T1** — a hover highlight so the pointed-at tab is obvious at high
tab counts; **T2** — the **active** tab keeps its favicon when the strip shrinks (today it drops at ≤72px).

## Context

Risk: **LOW-MEDIUM.** T1 is additive, no contract. T2 reverses a deliberate shrink-disclosure rule and
touches the `responsive-tab-strip` contract → re-run its Step 5. Both must stay **layout-neutral** (the
drag machinery snapshots slot rects at arm time — a width/margin change mid-strip would invalidate them;
`tab-drag-invariants.test.js` pins `.tab.detaching` neutrality — apply the same discipline).

Anchors (from recon): tab markup `renderer.js:~1196–1221` (`.tab` → `.tab-row`/`.tab-fav`/`.tab-title`/`.tab-close`).
All tab CSS in `src/renderer/styles.css`: `.tab` `:197`, `.tab.active` `:275`, existing hovers
`.tab .tab-close:hover` `:313`; disclosure `@container (max-width:72px){.tab .tab-title{display:none}}` `:246`,
**`@container (max-width:72px){.tab.active .tab-fav{display:none}}` `:260`** (drops active favicon),
`@container (max-width:56px){.tab:not(.active) .tab-close{display:none}}` `:264`; the only width floor is
**`.tab.active{min-width:64px}` `:285`** (budget comment `:258`: 20+8+8+16=52, favicon 14 excluded).

## Acceptance Criteria

- [x] **AC1 (T1) — a hover highlight on the pointed-at tab.** Add `.tab:not(.active):hover` in `styles.css`
      with a background tint between `.tab` (`--bg-2`) and `.tab.active` (`--bg-3`); it must **not** override
      the active tab and must **not** clash with `.tab .tab-close:hover`. **Paint-only** — no width/margin/
      layout change (a `background`/`box-shadow` transition is fine). Verify by-hand at high tab count.
- [x] **AC2 (T2) — the active tab keeps its favicon when shrunk.** Rescope/remove
      `.tab.active .tab-fav{display:none}` (`:260`) so the **active** tab never hides its favicon, and raise
      `.tab.active{min-width}` (`:285`) to fit favicon(14)+gap(8) on top of the 52 budget → **`min-width: ~78px`**.
      Inactive tabs are unchanged (they may still drop favicon/close). Active tab shows favicon + dot + close
      (title may still truncate).
- [ ] **AC3 — the `responsive-tab-strip` contract still holds** (re-run its Step 5 in the verification pass):
      at 60+ tabs, no scrollbar (`#tabs.scrollWidth <= clientWidth`), no tab clipped, and the **active**
      `.tab-close` rect stays fully inside the active `.tab` rect at the new floor. (The spec's own reasoning
      — 900px min window, ~4px/tab bound — says one wider floored tab cannot force overflow; confirm live.)
- [x] **AC4 — gates green** (`npm test`, `lint`, `typecheck` — standalone). No unit test asserts CSS; the
      live proof is the verification-pass Step 5 re-run.

## Files Affected
- `src/renderer/styles.css` — the hover rule (AC1) + the active-favicon rescope + floor bump (AC2). No JS.

## Line Budget (DD11 — code lines)
- `styles.css`: **≤ +12**. Exceed ⇒ stop and report.

---
## Post-Completion Checklist
- [x] ACs verified (AC3 live re-run deferred to the F10 verification pass, stated)
- [x] flight-log leg entry; leg status `completed`; flight.md leg checked
- [x] Do NOT commit (flight-end review + single commit)
