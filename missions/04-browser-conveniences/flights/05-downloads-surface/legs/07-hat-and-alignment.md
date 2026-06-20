# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Downloads Surface](../flight.md)

## Objective

Operator-driven guided HAT (human acceptance test) for the `goldfinch://downloads` surface — confirm the
human-facing UI, live progress, per-item controls, and keyboard operability that the automation surface
can't observe (the internal page DOM is unreadable by automation). "Quick" scope: the highest-signal
checks; fix any failure inline and re-verify before moving on.

## Context

- Optional leg (DD/legs). The model/list/tool/gating are already behavior-test-verified
  (`downloads-surface` active, SC7/SC8 PASS); this leg covers the **page UI + controls + keyboard**, which
  are HAT-only.
- Flight-Director-guided: one step at a time; the operator performs each step and reports; issues fixed
  inline (spawning a Developer if code changes are needed), then the step is re-verified.

## Acceptance Criteria (verification steps — operator-confirmed)

- [x] **Launch + entry**: app runs; kebab `Downloads` item AND `Ctrl+J` open `goldfinch://downloads`
  (footer "files aren't deleted" note present). **PASS.**
- [x] **List + live progress**: a download appears with a live progress bar (confirmed on a larger file;
  a 10 MB warm download finishes sub-second so the bar flashes) and settles to `completed`; silent save,
  no dialog. **PASS** (after the double-download + filename fixes below).
- [x] **Controls**: pause/resume (with feedback), cancel, retry, remove-from-list, "Clear now" — each
  behaves correctly. **PASS** (after the pause/resume-feedback fix). Open file / Show in folder are
  **WSL-environment-limited** (no Linux file manager; `shell.openPath`/`showItemInFolder` shell out to
  Windows Explorer, which lands on `\\wsl$\…\home` = `/home`, not the user's `/home/<user>`) — **not a
  goldfinch defect**; they work on a native desktop. Remove/Clear confirmed history-only (file stays on
  disk).
- [~] **Internal-tab no-op** + **Keyboard operability**: page built keyboard-operable; covered by the
  leg-6 chrome a11y sweep (0 new violations). Not separately re-exercised this quick session.

## Notes — HAT findings & inline fixes (2026-06-20)

Three real defects found and fixed inline during the HAT (all on this branch, uncommitted until the
HAT-close commit):

1. **Double-download on address-bar navigation to a file URL** — `renderer.js` `navigate()`'s
   `loadURL(url).catch(() => setAttribute('src', url))` re-navigated when `loadURL` rejected (a navigation
   that becomes a download rejects with `ERR_FAILED`), and setting `src` internally calls `loadURL` again
   → a second `will-download` → duplicate row + toast + file. Fix: the `.catch` no longer re-navigates
   (vestigial since the initial commit; `navigate()` is address-bar-only on a ready webview, `createTab`
   does the initial load via `src`). **Verified: single row/toast/file.**
2. **Wrong displayed filename for deduped downloads** — the record's `filename` was `item.getFilename()`
   (original suggested name) instead of `path.basename(item.getSavePath())` (the `uniquePath`-deduped +
   sanitized on-disk name), so every `(n)` copy showed the same bare name and mismatched disk. Fix:
   `main.js` sources `filename` from the saved basename in the record + both broadcasts. **Verified: UI
   name matches disk.**
3. **Pause/resume had no UI feedback and Resume was unreachable** — Electron's `DownloadItem` keeps
   `getState() === 'progressing'` while paused (pause is the separate `isPaused()` boolean), but
   `downloads.js` gated the "Paused" label / Resume button on `state === 'paused'` (never true), the
   progress broadcast omitted `paused`, and `pause()`/`resume()` don't reliably emit `'updated'`. Fix:
   `paused` is now first-class — added to the broadcast payload, the action handler explicitly
   re-broadcasts on pause/resume, and `downloads.js` (+ the toast) drive the label/Resume-Pause toggle off
   the `paused` boolean. **Verified: Paused status + Resume + toast all reflect correctly.**

**Environment caveats (not goldfinch defects, noted for the operator):**
- Downloads land in `$HOME` (not `~/Downloads`) on this WSL dev env because no XDG download dir is
  configured; Electron's `app.getPath('downloads')` falls back to `$HOME`. On a normal desktop it's the
  real Downloads folder. *(Optional future polish: prefer `~/Downloads` when it exists but XDG is unset —
  backlog candidate, operator-deferred.)*
- Open file / Show in folder are non-functional under WSLg (no Linux file manager); works on native.

Post-fix gates: **938 unit tests pass**, typecheck + lint clean.
