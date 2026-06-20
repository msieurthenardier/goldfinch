# Behavior Test: Downloads Surface (automation tool)

**Slug**: `downloads-surface`
**Status**: active
**Created**: 2026-06-19
**Last Run**: 2026-06-20-10-02-09 (pass — scripted live integration smoke; see `downloads-surface/runs/`)

> **Apparatus note.** The `goldfinch://downloads` **page** lives in the internal session, which the
> automation surface **cannot read even for admin** (the internal-session exclusion). This spec
> therefore asserts the **app-level downloads model** through the **`downloadsList` tool result + the
> filesystem**, never the page DOM. The page UI, live progress bar, and per-item controls are verified
> by the **HAT** + `npm run a11y`, not here.

## Intent

Verify that a download triggered against a live web tab is captured in Goldfinch's **app-level,
persisted** downloads model and surfaced through the **admin-only** `downloadsList` automation tool with
a real on-disk `savePath`, and that a **jar key** is **refused** the tool (admin-only gating, SC8 part).
Real-environment observation is required: `will-download` is an engine-level event over a live document
and a real filesystem write that no unit test reproduces. This is the agent-parity (SC8) counterpart to
the human downloads page (SC7, HAT-verified).

## Preconditions

- App running via `npm run dev:automation`, operator-checkable.
- The env-gated **admin** key available (`downloadsList` accepts admin only); a valid **jar key** for the
  refusal assertion.
- The `downloadsList` / `navigate` / `enumerateTabs` tools present in the tool list (the run skill
  confirms discovery — total tool count **27**).
- A download-triggering fixture served over a local HTTP server. **Primary mechanism:** the binary
  `tests/behavior/fixtures/downloads/download-fixture.bin` served by `python3 -m http.server` rooted at
  `tests/behavior/fixtures/` — the `.bin` extension is sent as `application/octet-stream`, which Chromium
  **downloads** rather than renders, so navigating to it triggers a `will-download`. **Fallback** (only if
  octet-stream does not trigger a download in the run environment): a tiny custom server (Node/Python) that
  sets `Content-Disposition: attachment` on the response — record in the run log which mechanism was used.
- `app.getPath('downloads')` writable; the **silent default-save** (Flight-5 DD5) is in effect so the
  download completes with no native dialog.

## Observables Required

- **automation surface** (tool results — measured via the goldfinch MCP surface): the `downloadsList`
  return payload (an array of `{ id, url, filename, savePath, state, received, total, ... }` records), and
  the **refusal** response when called with a jar key.
- **filesystem** (corroboration — measured via shell/`stat`): the reported `savePath` exists on disk with
  non-zero size, so `state: 'completed'` is checked against a second source rather than asserted in
  isolation.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | With the **admin** key, call `downloadsList` and record the current record count `N` (may be 0 or more from prior runs / persisted history). | Returns an array (possibly empty); no error — the tool is discoverable and the model reads cleanly. (setup baseline.) |
| 2 | Open a web tab in the **Default** jar and `navigate` it to the fixture URL (primary: `http://127.0.0.1:8000/downloads/download-fixture.bin`, served as `application/octet-stream` by `python3 -m http.server`; fallback: a `Content-Disposition: attachment` server). Wait for the download to settle. | (setup — no judgment; the download fires and saves silently to the OS Downloads folder.) |
| 3 | Call `downloadsList` (admin). | The list now has `N + 1` records; the **new** record has `filename` matching the fixture (sanitized), a terminal `state: 'completed'`, a non-empty `savePath`, and `received === total` (> 0) — the app-level model captured the download. |
| 4 | `stat` the new record's `savePath` on the filesystem. | The file **exists** with **non-zero size** — `savePath` points at a real on-disk file (the model's `completed`/`savePath` is corroborated, not self-asserted). |
| 5 | With a **jar key** (not admin), call `downloadsList`. | **Refused** with the distinct **admin-only** error — `downloadsList` is an app-level/admin capability and does not widen the jar surface's reach (SC8 gating half). |
| 6 | (Persistence, optional) Note the new record's `id`; if the run harness can restart the app, re-open and call `downloadsList` (admin) again. | The record with the same `id` is **still present** after restart — the list is persisted, not session-only (DD3). *(Skip if the harness cannot restart the app in-run; persistence is then a HAT checkpoint.)* |

**Row conventions:** Rows 1–2 are setup (no judgment). Rows 3–6 each assert one observable checkpoint.

## Out of Scope

- The **downloads page** (`goldfinch://downloads`): list rendering, the live progress bar, and the
  per-item controls (open file, show in folder, pause/resume, cancel, remove, clear all, retry) — the
  page is **internal-session-rendered and not readable via automation**; verified by the **HAT** +
  `npm run a11y`, not this apparatus. *(Carry-forward from the Flight-1/2 debriefs: internal-page and
  OS-native steps are HAT/unit, never automation-surface steps.)*
- **Pause/resume/cancel/retry as automation actions** — not exposed to the surface this flight (SC8 asks
  for the *list* only, DD6); these are HAT checkpoints on the page.
- The **kebab `Downloads` item + `Ctrl+J`** entry and the internal-tab no-op — renderer chrome, HAT/a11y.

## Variants (optional)

- Trigger a **second** download of the same filename and assert the model dedups the on-disk path
  (` (n)` suffix via `uniquePath`) while listing both records distinctly.
