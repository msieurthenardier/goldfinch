# Leg: picker-default-marker

**Status**: landed
**Flight**: [Mission-Close Gaps](../flight.md)

## Objective

The container picker marks the current default jar (the `defaultId` holder, or
Burner when `defaultId` is null), live-consistent with the jars page's Default
semantics.

## Context

- Flight DD1. The mission-close audit found `buildContainerModel()`
  (`src/shared/container-menu.js`) never consults `defaultId` — the picker is
  the only jar surface without the marker (jars page and settings key list
  both show it).
- The renderer already holds both inputs at the single call site:
  `openContainerOverlay` calls `buildContainerModel(containers)`
  (renderer.js:352) and module state carries `defaultId` (renderer.js:113,
  kept fresh by `applyJarsState` on every `jars-changed`). Design review
  confirmed this is the ONLY production caller.
- The picker model is rebuilt per open (container-menu.js module doc: "rebuilt
  per open... no runtime jar-list refresh") — so marker freshness per open is
  free; no live-refresh work is in scope.
- Default-holder semantics: the row whose `id === defaultId` carries the
  marker; when `defaultId` is null OR matches no container in the list, BURNER
  carries it. NOTE (design-review correction): the dangling-id half is a NEW,
  more defensive rule than the jars page's (`jar-page-model.js:74` marks Burner
  only on `defaultId == null`; the dangling case leaves every row unmarked
  there). The rule here is motivated by `resolveNewTabContainer`
  (`default-routing.js:22-24`), which returns null for BOTH cases → burner
  routing — the marker must never lie about where a new tab actually opens.
  Do NOT import jar-page-model into container-menu (different row shapes), and
  do NOT change jar-page-model here.
- The sheet (`menu-overlay.js`) renders items textContent-only; `color` is the
  precedent for per-item DATA rendered by the sheet (a `.cm-dot` span,
  isSafeColor-guarded). Labels must never carry markup.

## Inputs

- `src/shared/container-menu.js` as shipped v0.7.0 (no defaultId awareness)
- `src/renderer/renderer.js` call site + `defaultId` module state
- `src/renderer/menu-overlay.js` item renderer (`.cm-dot` precedent)
- `test/unit/container-menu.test.js` (134 lines)

## Outputs

- `buildContainerModel(containers, defaultId)` — marker data on the holder row
- Call site passes `defaultId`
- Sheet renders the marker (presentation per Implementation Guidance)
- Extended unit truth table

## Acceptance Criteria

- [x] `buildContainerModel(containers, defaultId)`: the item whose jar id equals
      `defaultId` carries a marker field (e.g. `isDefault: true`); when
      `defaultId` is null/undefined or matches no container in the list, the
      Burner sentinel row carries it instead; no other row ever carries it.
      Action rows (`action:new-container`, `action:manage-jars`) and the
      separator are never marked.
- [x] Backward compatibility: calling with one argument still works (marker
      falls to Burner, matching the null-default semantics) — no other caller
      exists, but the shape must not throw.
- [x] The sheet renders a visible, textContent-safe marker on the marked row —
      consistent with the surrounding menu styling and distinguishable from the
      color dot. `[a11y]` The marker must be perceivable to screen readers
      (e.g. included in the accessible name — "Personal, default jar" — or an
      equivalent ARIA-clean mechanism), not a bare visual glyph.
- [x] Marker is correct per open across flag moves: open picker → default is X;
      move default to Y on the jars page; reopen picker → marker on Y. (Per-open
      rebuild makes this structural; verify via unit truth table + manual smoke.)
- [x] Unit tests: marker on holder; Burner fallback on null `defaultId`; Burner
      fallback on dangling `defaultId` (id not in list); no marker on action
      rows; single-argument call shape. KNOWN REQUIRED TEST EDIT (design-review
      H2): the first test in `container-menu.test.js` asserts the full model
      via strict `deepEqual` with a single-arg call — its expected Burner
      literal MUST gain `isDefault: true` (single-arg ≡ null default ⇒ Burner
      marked). That one literal update is the only permitted existing-test
      change; all other existing tests stay untouched and green.
- [x] Gates: full suite green (1277 baseline + new), typecheck, lint.
      Typecheck REQUIRES the `renderer-globals.d.ts` update (see Files
      Affected) — without it the two-arg call site fails TS2554.

## Verification Steps

- `node --test test/unit/container-menu.test.js` — new truth table green
- `npm test` / `npm run typecheck` / `npm run lint`
- Manual smoke (FD or operator): open picker, confirm marker; move default,
  reopen, confirm it moved

## Implementation Guidance

1. **Model change** (`container-menu.js`): add the second parameter; compute the
   holder id (`defaultId` if present in the container list, else Burner). Set
   `isDefault: true` on exactly that row. Keep the item typedef updated — AND
   update the hand-written declare at `renderer-globals.d.ts:348-350` to match
   (add the `defaultId` param + `isDefault?: boolean` on the return shape);
   the typecheck gate fails TS2554 without it (design-review H1; this is the
   preload-declare checklist case Flight 4's debrief flagged).
2. **Call site** (`renderer.js:352`, inside `openContainerOverlay`): pass the
   module-state `defaultId`.
3. **Presentation** (`menu-overlay.js` + `menu-overlay.css` — the sheet's own
   stylesheet owns `.cm-dot`/`.cm-item`; styles.css's `.cm-dot` block is the
   unrelated privacy panel's): follow the `.cm-dot` precedent — a dedicated
   span (suggested `.cm-default`) appended when `item.isDefault`, with a
   compact visual (mirror `.jar-nav-badge`, jars.css:128-136 — the jars page's
   compact Default pill — scaled to menu row height, via textContent or CSS
   only, never innerHTML). Ensure the accessible name includes the default
   state (visible descendant text inside the `<button role="menuitem">`
   contributes to the accessible name automatically — verified at design
   review; visible text like "default" in the span satisfies this; if the
   visual is glyph-only, add `aria-label`/`.sr-only` text equivalently —
   CSS-generated `::before` content does NOT reliably contribute).
4. **Tests**: extend `container-menu.test.js` per the AC truth table, including
   the one mandated existing-literal update (AC note).

## Edge Cases

- **Dangling defaultId** (jar deleted, stale value): Burner carries the marker —
  matches `resolveNewTabContainer`'s fallback routing so the marker never lies
  about where a new tab will actually open.
- **Marker + color dot coexistence**: jar rows have both; ensure layout holds
  (dot leads, marker trails — or per existing row flex order).
- **Burner marked row**: Burner's row already has color + "(evaporates)" label
  text; the marker must compose with it.

## Files Affected

- `src/shared/container-menu.js` — model change
- `src/renderer/renderer-globals.d.ts` — declare update (lines 348-350; REQUIRED
  for typecheck)
- `src/renderer/renderer.js` — call site (one line)
- `src/renderer/menu-overlay.js` — marker rendering
- `src/renderer/menu-overlay.css` — marker style (NOT styles.css)
- `test/unit/container-menu.test.js` — truth table + one mandated literal update

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md
- [ ] Do NOT commit (deferred single review + commit at flight end)
