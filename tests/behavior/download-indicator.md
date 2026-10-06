# Behavior Test: Top-Bar Download Indicator + Popup

**Slug**: `download-indicator`
**Status**: active
**Created**: 2026-07-19
**Last Run**: 2026-10-06-13-24-48 (pre-rescope spec; partial: 4 pass, steps 5–8 inconclusive because the downloads sheet is unobservable since 2026-07-24; 0 fail; see runs/2026-10-06-13-24-48.md)

> **Activated by scripted live integration smoke (2026-07-19).** The admin-scoped MCP run exercised the
> real download feed, chrome indicator, downloads sheet, downloads-page footer action, and a newly created
> window's snapshot hydration. The timing-dependent in-progress row was skipped because the 4 KiB fixture
> completed before observation; its transition/repaint contract remains unit-covered. See the run record.

> **Apparatus note.** The observable surface is the **chrome** (the `#downloads-indicator` button, via
> admin-only `getChromeTarget`), `enumerateWindows` (`sheetVisible` / `sheetWcId`), and `downloadsList`.
> The downloads **popup sheet's contents are NOT observable**: since 82f6eb2 (2026-07-24) the secret-sheet
> resolver refuses it (`downloads` is not in `AUTOMATABLE_MENU_TYPES`, `src/main/automation/resolve.js`),
> and its a11y state is skipped by standing ruling (squawk 0045). The internal `goldfinch://downloads`
> page is also unreadable (see `downloads-surface.md`). Popup structure, the in-progress row, footer
> activation and popup a11y are therefore `[by-eye]` HAT checkpoints (steps 5b, 6b, 7b, 8b), with the
> unit tests that pin what they can listed below. External effects of open/reveal (`shell.openPath` /
> `showItemInFolder`) are HAT as well.

**Unit coverage for the by-eye checkpoints** (run `npm test`; these, not this spec, are the regression net):
- `test/unit/downloads-popup-contract.test.js`: popup footer stays reachable (`#sheet-downloads`
  max-height/overflow, scroll-bounded `.dl-list` with `tabIndex=0` and `aria-label` "Download items",
  footer appended after the list). It does NOT pin the in-progress row's plain-text/no-button rendering.
- `test/unit/downloads-controller.test.js`: new-window hydration of active + recent state, `download-done`
  popup repaint and actionable row, cancelled terminal state disappears, expiry closes an open popup.
- `test/unit/downloads-indicator-model.test.js`: indicator label/badge truth table.

## Intent

Verify that starting a real download surfaces a persistent, app-scoped indicator in the top-bar chrome
and that its popup lists current + recent downloads with correct filenames, disabled in-progress rows,
and a working link to the full downloads page. Real-environment observation is required: the indicator is
driven by engine-level `will-download` → `download-progress`/`download-done` broadcasts over a live
document and a real filesystem write, rendered across two chrome-class WebContentsViews (chrome + sheet),
which no unit test reproduces. Complements `downloads-surface.md` (app-level model) and `npm run a11y`
(static labeling) by exercising the live button-state + popup flow.

## Preconditions

- App running via `npm run dev:automation`, operator-checkable.
- The env-gated **admin** key available (`getChromeTarget` + sheet reads are admin-only).
- Download-triggering fixture served locally: `tests/behavior/fixtures/downloads/download-fixture.bin`
  via `python3 -m http.server` rooted at `tests/behavior/fixtures/` (octet-stream ⇒ Chromium downloads).
  Fallback: a `Content-Disposition: attachment` server — record which was used.
- **Slow-download source (for step 6, in-progress state).** The 4 KiB fixture completes before it can be
  observed. Run a run-local server (not committed) that streams a few MiB of
  `application/octet-stream` with `Content-Disposition: attachment`, writing small chunks with a short
  delay (e.g. 64 KiB every 100 ms via a ~10-line `http.server` handler or Node `http` script) on its own
  port, and note its URL in the run record. `navigate` to it returns `ERR_FAILED (-2)`, which is normal
  for a download.
- **Downloads-dir isolation.** Silent default-save writes to the XDG download dir; redirect it so the run
  doesn't touch the operator's folder: create `$XDG_CONFIG_HOME/user-dirs.dirs` containing
  `XDG_DOWNLOAD_DIR="<scratch dir>"` and launch `npm run dev:automation` with that `XDG_CONFIG_HOME`
  (the dev profile is already isolated). Silent default-save then completes with no native dialog.
- Leg 3 landed (the `downloads` sheet template + `sheet:downloads` state exist).

## Observables Required

- **browser chrome** (DOM/AX of the chrome document, via goldfinch MCP `getChromeTarget` +
  `evaluate` / `readAxTree`): `#downloads-indicator` presence/visibility, its `aria-label` /
  `aria-expanded`, and `no-drag` region.
- **window state** (`enumerateWindows`): `sheetVisible` and `sheetWcId` while the popup is open/closed.
- **downloads feed** (`downloadsList`, admin): entries with filename, state and received/total bytes.
- **navigation** (`enumerateTabs`): after Ctrl+J, a tab at `goldfinch://downloads`.
- **by-eye (HAT, not apparatus-observable):** popup DOM, row text, disabled in-progress row, footer
  activation, popup a11y.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | With the **admin** key, `getChromeTarget` and read the chrome DOM/AX. Record whether `#downloads-indicator` is present and visible before any download this session; call `downloadsList`. | Baseline: the indicator is absent/hidden when no download is active or recent (idle-hidden); `downloadsList` is empty. (setup baseline.) |
| 2 | Open a web tab in the **Default** jar and `navigate` it to the fixture URL (`http://127.0.0.1:8000/downloads/download-fixture.bin`). | (setup — no judgment; the download fires and saves silently.) |
| 3 | Read the chrome DOM/AX for `#downloads-indicator`. | The indicator is now **visible**, is `-webkit-app-region: no-drag`, carries `aria-haspopup="dialog"` and `aria-expanded="false"`, and its `aria-label` conveys a live download state (e.g. a downloading/count phrasing) — state is announced via the label, not color/animation alone. (The 4 KiB fixture may already be completed; a "recently completed" label is acceptable here.) |
| 4 | Wait for the download to settle, then re-read `#downloads-indicator` and call `downloadsList`. | Within a short timeout the `aria-label` reflects a **recently-completed** state (not the in-progress phrasing); the button remains visible. `downloadsList` shows one completed entry named `download-fixture.bin` with received == total. |
| 5 | `click` the `#downloads-indicator` button (chrome target); read the button and call `enumerateWindows`. | `aria-expanded` on the button flips to `"true"`; the window reports `sheetVisible: true` with a `sheetWcId`. (Sheet contents are not read.) |
| 5b | `[by-eye]` With the popup open, look at it. | A `role="dialog"` popup anchored under the button with one row for `download-fixture.bin` (text) and a footer "Open downloads page" action. Footer reachability/list structure pinned by `downloads-popup-contract.test.js`. |
| 6 | Start a download from the run-local slow-download source; while it is progressing, re-read `#downloads-indicator` and call `downloadsList` (sample repeatedly), then wait for completion. | The `aria-label` shows the in-progress phrasing with a badge count while `downloadsList` shows the entry with received < total; afterwards it settles to the recently-completed label and received == total. |
| 6b | `[by-eye]` While the slow download is in progress, open the popup. | The in-progress row shows progress and renders its filename as plain text with **no open/reveal buttons**; only completed rows expose them. Transition/repaint on completion is unit-covered by `downloads-controller.test.js` (the plain-text row rendering itself is not). |
| 7 | With the popup open (step 5 state) press Ctrl+J via `pressKey` on the **chrome** wcId; read the button, `enumerateWindows` and `enumerateTabs`. | The sheet closes (`sheetVisible: false`), `aria-expanded` resolves back to `"false"`, and a tab at `goldfinch://downloads` is active (`openDownloads()` is reachable). |
| 7b | `[by-eye]` Reopen the popup and click the footer "Open downloads page" action. | The popup closes and a tab shows `goldfinch://downloads`. (The footer cannot be clicked over automation.) |
| 8 | Run `npm run a11y` (button state). | No new accessibility violations for `#downloads-indicator` — labeled and operable `[a11y]`. |
| 8b | `[by-eye]` Inspect the open popup with a screen reader or keyboard only. | The popup is labeled and operable: Tab reaches the scrollable "Download items" list and the footer; Escape closes. (Popup a11y state is skipped by `npm run a11y` by standing ruling.) |

**Row conventions:** Rows 1–2 setup. Rows 3–8 are apparatus-observable assertions; rows marked `b` are
`[by-eye]` HAT checkpoints the executor reports as "HAT" (not inconclusive, not fail). Row 6 is timing-
dependent: sample repeatedly while the slow download runs.

## Out of Scope

- External effects of open/reveal (`shell.openPath` / `showItemInFolder` launching an app or file
  manager) — HAT checkpoints, not observable via the automation surface.
- The app-level persisted downloads model and admin-only `downloadsList` gating — covered by
  `downloads-surface.md`.
- Exact visual/animation treatment and the precise idle-timeout value (DD5) — HAT-tuned.

## Variants (optional)

- Multiple concurrent downloads: the popup lists each as a distinct row; the button reflects an
  aggregate active state.
- New window after a completion: the second window hydrates the still-recent completion and shows the
  same app-scoped indicator without waiting for another download event.
- Cancelled/interrupted terminal state: the row leaves the active list and is not counted or described
  as a recent completion.
- Capacity: with 25 recent rows, the row list scrolls while the footer remains reachable.
