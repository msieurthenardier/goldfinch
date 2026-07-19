# Behavior Test: Top-Bar Download Indicator + Popup

**Slug**: `download-indicator`
**Status**: draft
**Created**: 2026-07-19
**Last Run**: never

> **Apparatus note.** The observable UI lives in the **chrome** (the `#downloads-indicator` button) and
> the **menu-overlay sheet** (the downloads popup) — NOT the internal `goldfinch://downloads` page (which
> automation cannot read; see `downloads-surface.md`). Both surfaces are reached with the **admin** key:
> the button via `getChromeTarget` (admin-only), the popup via the sheet's wcId (`enumerateWindows`). This
> is the same drive+read path the a11y audit (`scripts/a11y-audit.mjs`) already uses. The **external**
> effects of open/reveal (`shell.openPath` / `showItemInFolder` launching an app or file manager) are
> **not** asserted here — they are HAT checkpoints. Drafted with Flight 1 (M11); activate after Leg 3.

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
- Silent default-save in effect (download completes with no native dialog).
- Leg 3 landed (the `downloads` sheet template + `sheet:downloads` state exist).

## Observables Required

- **browser chrome** (DOM/AX of the chrome document — measured via goldfinch MCP `getChromeTarget` +
  `evaluate` / `readAxTree`): `#downloads-indicator` presence/visibility, its `aria-label` /
  `aria-expanded`, and `no-drag` region.
- **menu-overlay sheet** (DOM of the sheet document — measured via the sheet wcId from `enumerateWindows`
  + `evaluate` / `readDom`): the popup row list (filenames via `textContent`), disabled state of
  in-progress rows, and the footer "Open downloads page" action.
- **filesystem / navigation** (corroboration): after the footer action, the active tab's URL is
  `goldfinch://downloads`.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | With the **admin** key, `getChromeTarget` and read the chrome DOM/AX. Record whether `#downloads-indicator` is present and visible before any download this session. | Baseline: the indicator is absent/hidden when no download is active or recent (idle-hidden). (setup baseline.) |
| 2 | Open a web tab in the **Default** jar and `navigate` it to the fixture URL (`http://127.0.0.1:8000/downloads/download-fixture.bin`). | (setup — no judgment; the download fires and saves silently.) |
| 3 | Read the chrome DOM/AX for `#downloads-indicator`. | The indicator is now **visible**, is `-webkit-app-region: no-drag`, carries `aria-haspopup="dialog"` and `aria-expanded="false"`, and its `aria-label` conveys a live download state (e.g. a downloading/count phrasing) — state is announced via the label, not color/animation alone. |
| 4 | Wait for the download to settle, then re-read `#downloads-indicator`. | Within a short timeout the `aria-label` reflects a **recently-completed** state (not the in-progress phrasing); the button remains visible (recent list non-empty). |
| 5 | `click` the `#downloads-indicator` button (chrome target). Discover the sheet wcId via `enumerateWindows` and read the sheet DOM. | `aria-expanded` on the button flips to `"true"`; the sheet renders a `downloads` popup (`role="dialog"`) anchored under the button with **one row for the completed download** whose filename equals `download-fixture.bin` (rendered as text). A footer "Open downloads page" action is present. |
| 6 | (In-progress row, best-effort) Trigger a fresh download of a larger/slower fixture and, while it is still progressing, open the popup and read the sheet. | The in-progress row shows progress and renders its filename as **plain text with no open/reveal buttons** (not activatable); only completed rows expose the filename/folder buttons. *(Skip if the run environment completes the fixture too fast to catch mid-flight; then this is a HAT checkpoint.)* |
| 7 | Activate the footer "Open downloads page" action; read the active tab's URL. | The popup closes and a tab shows `goldfinch://downloads` (reuses `openDownloads()`). `aria-expanded` on the button resolves back to `"false"` on sheet close. |
| 8 | Read the chrome document accessibility scan for the button + open-popup states (or run `npm run a11y` for the `sheet:downloads` state). | No new accessibility violations for the button or the popup — both are labeled and operable `[a11y]`. |

**Row conventions:** Rows 1–2 setup. Rows 3–8 each assert one checkpoint. Row 6 is best-effort (timing-
dependent); rows 5 and 7 are the core popup-flow assertions.

## Out of Scope

- External effects of open/reveal (`shell.openPath` / `showItemInFolder` launching an app or file
  manager) — HAT checkpoints, not observable via the automation surface.
- The app-level persisted downloads model and admin-only `downloadsList` gating — covered by
  `downloads-surface.md`.
- Exact visual/animation treatment and the precise idle-timeout value (DD5) — HAT-tuned.

## Variants (optional)

- Multiple concurrent downloads: the popup lists each as a distinct row; the button reflects an
  aggregate active state.
