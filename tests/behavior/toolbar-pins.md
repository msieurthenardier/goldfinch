# Behavior Test: Pinnable toolbar items (Media + Shields)

**Slug**: `toolbar-pins`
**Status**: draft
**Created**: 2026-06-08

## Intent
Verify the **pin/unpin** system for toolbar items: a pinned item shows in the toolbar as an **icon + count
badge**; unpinning (from the settings Appearance section) **removes the toolbar icon** but leaves its
**keyboard shortcut** working; the pin state **persists** (`settings.json` `toolbarPins`) and the toolbar
reflects changes **live** (two-way with settings); and the site-info popup's **"Site settings →"** opens the
**settings page** (Privacy & Shields) rather than the slide-out panel. This needs a behavior test, not a unit
test: the assertions are real-environment, cross-process UI — the pin toggle lives in a `<webview>` guest on
a privileged scheme, the toolbar lives in the chrome renderer and reflects the active pin state via an IPC
broadcast, and persistence is a file the main process writes.

## Preconditions
- Goldfinch running via `npm run dev:debug` (CDP `:9222`); `scripts/cdp-driver.mjs` reaches it. **Not** the
  `chrome-devtools` MCP.
- The build includes the `toolbarPins` store key, the icon toolbar + pin-apply, the Appearance pin toggles,
  and the "Site settings →" rewire.
- `userData/settings.json` is readable on the filesystem; a reachable web page (e.g. `https://example.com/`).
- **Guest-reachability probe**: the `goldfinch://settings` guest is attachable for DOM reads.

## Observables Required
- browser (chrome toolbar DOM — `#toggle-media`/`#toggle-privacy` presence/`hidden` + icon + count badge;
  panel `aria-expanded`/visibility; the settings guest's Appearance pin toggles; the active tab's URL —
  measured via `scripts/cdp-driver.mjs` + node-CDP guest attach)
- filesystem (`userData/settings.json` `toolbarPins` — measured via Read/Bash)
- shell (precondition probes — measured via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe `:9222` (`cdp-driver eval '1+1'` → 2). Read the chrome toolbar: `#toggle-media` + `#toggle-privacy`. | Both toolbar controls render as **icons with a count badge** (not text "Media"/"Shield"); both are visible (default pinned). |
| 2 | Open Settings (kebab → Settings); attach to the guest; read the **Appearance** section. | The Appearance section shows a **pin-icon toggle button** for **Media** and **Shields** (pushpin glyph, `aria-pressed`), both **pinned** (`aria-pressed="true"`, filled). `[a11y]` |
| 3 | In the settings guest, activate the **Media** pin-icon toggle (by keyboard) to UNPIN it. | The Media pin toggles to unpinned (`aria-pressed="false"`, outline glyph); keyboard-operable. `[a11y]` |
| 4 | Read `userData/settings.json`. | `toolbarPins.media === false` — the change **persisted**. |
| 5 | Read the chrome toolbar `#toggle-media`. | The Media toolbar icon is now **removed/hidden** — the toolbar reflects the unpin **live** (two-way). `#toggle-privacy` (Shields) remains visible. |
| 6 | With Media unpinned, dispatch **Ctrl+M** to the **chrome renderer document** (via `cdp-driver` against the chrome target — the shortcut is a chrome `document` keydown, independent of the toolbar button; this drives it directly rather than relying on real focus routing). | The media panel still **opens** — unpinning removed the toolbar icon only; the keyboard shortcut remains active. |
| 7 | Re-pin Media from the settings Appearance toggle (back ON). | `settings.json` `toolbarPins.media === true`; the Media icon **returns** to the toolbar. |
| 8 | Open a normal web tab (`https://example.com/`); click the web chip; in the site-info popup, activate **"Site settings →"**. | A **`goldfinch://settings/#privacy`** tab opens or an existing settings tab is activated + navigated to it (active webview `src`/address contains `#privacy`); the **slide-out panel does NOT open**. The popup closes. |
| 9 | Run `npm run a11y` (chrome) and `npm run a11y -- --target=goldfinch://settings`; read both results. | **No NEW** violations vs the pinned `ACCEPTED` baseline — the icon toolbar (chrome) and the Appearance pin toggles (guest) introduce no new WCAG A/AA violations. `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Step 6 is the "unpinned keeps its
shortcut" assertion; step 8 is the "Site settings → opens the settings page, not the panel" assertion.

## Out of Scope
- **Right-click → native "Unpin" context menu** (DD7) — a **native Electron menu** is not in the renderer DOM,
  so its "Unpin" click is **not CDP-drivable**; it is **HAT-verified**. (This test covers unpin via the
  settings Appearance pin toggle, which is the drivable path; both write `toolbarPins` + broadcast, so the
  store/toolbar effect is equivalent.)
- **Per-site Shields overrides** (more-strict-only) — a future flight (mission Known Issues).
- The Shields/home wiring itself — covered by `settings-controls` (run as a regression).
- The `goldfinch://` boundary — covered by `tab-scheme-guard` (regression).

## Variants (optional)
- Repeat the pin/unpin (steps 3–7) for **Shields** (`toolbarPins.shields`; Ctrl+Shift+P for step 6).
