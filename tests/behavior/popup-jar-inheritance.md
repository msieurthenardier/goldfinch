# Behavior Test: Popup Jar Inheritance

**Slug**: `popup-jar-inheritance`
**Status**: active
**Created**: 2026-07-10
**Last Run**: 2026-07-10-16-52-13

## Intent

Verifies that `window.open` popups inherit the opener tab's jar — the popup half of
the jar-confinement inheritance stance set at Flight 2's HAT (context-menu link opens
already inherit; popups routed to the default jar through main's window-open handler,
leaking cross-jar). Pins: persistent-jar openers keep their jar; burner openers mint a
FRESH burner (never-share-state invariant — two burner tabs must not share a
partition); the popup opens as a tab (native windows stay denied). Real-environment
behavior spanning main's window-open handler, the `open-tab` IPC payload, and the
renderer's inheritance decision — no unit seam covers the cross-process path.

## Preconditions

- Goldfinch dev build launched against a **fresh scratch profile** (`XDG_CONFIG_HOME`
  pointed at an empty directory) with the automation surface enabled and keys minted:
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`
  (admin key required — the test evaluates inside tabs across jars).
- MCP client attached (bound port may be a free-port fallback — discover it).
- Fresh-profile seed is Personal (default) + Work. No other jars.
- A navigable http(s) URL that loads quickly (any stable public page or local
  fixture; the URL itself is immaterial — only jar placement is asserted).

## Observables Required

- app tab/jar state (per-tab `jarId` + `wcId` — via the goldfinch MCP
  `enumerateTabs` tool)
- in-page script execution inside specific tabs (via the goldfinch MCP `evaluate`
  tool with the admin key, targeting a tab's `wcId`)
- chrome-renderer jar registry state (via `getChromeTarget` + `evaluate` on the
  `window.goldfinch.jars*` wrappers)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab via `openTab` with `jarId: "work"` at the fixture URL. Enumerate tabs; record its `wcId`. | The tab exists with `jarId` `work`. |
| 2 | Via `evaluate` targeted at that tab, run `window.open('<fixture-url>')` (no-await form). Then enumerate tabs. | Exactly one NEW tab appeared, and its `jarId` is `work` — the popup inherited the opener's jar, not the default (`personal`). No new native window (the popup is a tab in the enumeration). |
| 3 | Open a burner tab via the chrome apparatus: evaluate `window.createTab('<fixture-url>', window.makeBurner())` on the chrome target (renderer.js loads as a classic non-module script, so its top-level `createTab`/`makeBurner` declarations are real `window` properties reachable by chrome-target evaluate). Enumerate; record the burner tab's `wcId` and `jarId` (`burner-<n>`). | A tab with `jarId` matching `^burner-\d+$` exists. |
| 4 | Via `evaluate` targeted at the burner tab, run `window.open('<fixture-url>')`. Then enumerate tabs. | Exactly one new tab appeared; its `jarId` matches `^burner-\d+$` AND is DIFFERENT from the opener's recorded `jarId` — a fresh burner, not the opener's partition (burner tabs never share state). |
| 5 | Enumerate tabs and cross-check the full set. | Tabs from steps 1-4 all retain their original `jarId`s (no reassignment side-effects); total tab count equals boot tab + 4 opened. |

## Out of Scope

- Context-menu link-open inheritance (unit-pinned in `inherit-container.test.js`;
  operator-verified at Flight 2's HAT).
- `target=_blank` anchor clicks (same main-process handler path as `window.open` —
  a real-click spot check belongs to the flight's HAT; if the handler paths ever
  diverge, add a variant).
- Popup blocking / rate limiting (no such feature exists yet).
- Inheritance for `openTab` automation calls (jar-key scoping owns that —
  `mcp-jar-scoping`).

## Variants

None.
