# Mission: Top-Bar Download Visibility

**Status**: active

## Outcome

A user who starts a download in Goldfinch always has a persistent, glanceable place in
the browser chrome to see that a download is in flight or recently finished — and can act
on it (open the file, reveal it in its folder, jump to the full downloads page) without
hunting for a toast that has already dismissed or navigating to `goldfinch://downloads`.

## Context

Today the only feedback that a download is happening is a transient toast
(`onDownloadProgress` / `onDownloadDone`, consumed in
`src/renderer/chrome/media-controller.js:591,607`) plus the entry that lands on the
`goldfinch://downloads` page. Once the toast dismisses, nothing in the chrome tells the user
a download is still running or just completed. This is a gap in the browser's core
affordances that every mainstream browser fills with a persistent top-bar download control.

Tracked as GitHub issue [#103](https://github.com/msieurthenardier/goldfinch/issues/103).
The issue resolves the one genuine architectural tension up front: downloads are
**app-scoped**, but Goldfinch's pinnable toolbar row is **tab-scoped only**. The decision
is to place the indicator in the top bar (`#tabstrip`) immediately left of
`#window-controls` — alongside the app-scoped window controls — so it never touches the
tab-scoped pin system and the toolbar invariant stays intact.

The signal layer already exists: `register-download-ipc.js` broadcasts `download-progress`
(`:109`) and `download-done` (`:117`) to the chrome and internal targets via
`broadcastToChromeAndInternal`, and the chrome preload already exposes `onDownloadProgress` /
`onDownloadDone` (`src/preload/chrome-preload.js:146-147`). No new download-*tracking* IPC is
required — the indicator subscribes to signals that are already flowing. Note the distinction
surfaced during viability review: **the chrome keeps no recent-completed list today** (the
toast nodes are transient), so accumulating that list is genuinely new chrome-side state —
the substance of this mission — even though the events feeding it already exist. Separately,
the file **actions** (open, reveal) do require new chrome-trust IPC handlers (see Constraints).

## Success Criteria

- [ ] A persistent download indicator is visible in the top-bar chrome whenever a download
      is active or recently completed, and is hidden when the recent list is empty.
- [ ] The indicator conveys its live state (downloading / count / recently-done) accessibly —
      through label updates a screen reader announces, not animation or color alone.
- [ ] Activating the indicator opens a popup listing current and recent downloads.
- [ ] From the popup a user can open a completed file and reveal it in its containing folder;
      in-progress items show progress and cannot be opened until they complete.
- [ ] The popup offers a way to open the full `goldfinch://downloads` page.
- [ ] Opening or revealing a file never trusts a renderer-supplied filesystem path — the path
      is resolved authoritatively in the main process from the download's id.
- [ ] The indicator is app-scoped: present regardless of the active tab (including internal
      tabs) and independent of the tab-scoped toolbar-pin system.
- [ ] The accessibility audit (`npm run a11y`) passes for the new button and popup, and
      existing behavior tests remain unaffected.

## Stakeholders

- **Goldfinch users** — gain a reliable, always-available way to track and act on downloads.
- **Maintainer (repo owner)** — filed #103; cares that the app-scoped/tab-scoped boundary is
  respected and that the renderer→main trust boundary for file operations is not weakened.

## Constraints

- **No new download-*tracking* IPC.** Drive the indicator's list from the existing
  `download-progress` / `download-done` broadcasts, accumulated chrome-side. New chrome-trust
  *action* IPC (open, reveal) is expected and allowed — the constraint is against re-plumbing
  the download data feed, not against the file-action handlers the trust boundary requires.
- **Preserve the toolbar invariant.** The indicator must NOT be pinnable and must NOT touch
  `toolbarPins`, `applyToolbarPins`, the unpin context menu, or the Appearance-pins settings
  controller.
- **Trust boundary is non-negotiable.** File open AND reveal must resolve the path main-side
  by download id; a renderer-held path is never trusted. (Note: today's chrome-trust
  `show-item-in-folder` trusts a renderer-supplied path — reveal-by-id is therefore new work,
  not just open-by-id.) Reuse the existing main-side resolver (`manager.listAll().find` by id,
  as the internal open handler does) rather than forking trust-domain logic.
- **Untrusted strings.** Filenames are untrusted — render via `textContent`, never as markup.
- **`#tabstrip` is a drag region.** The new button must be `no-drag` (mirror `.win-ctrl` /
  `#new-tab`).

## Environment Requirements

- Electron + Chromium desktop app; a GUI session is required to exercise the chrome and popup.
- Node toolchain per the repo; `npm run a11y` must be runnable for the accessibility gate.
- No network or external services required.

## Open Questions

- [x] **Popup: live vs. snapshot-at-open?** → Resolved during viability review: **snapshot-at-open,
      close-then-act**, matching the existing `site-info` popup. The menu-overlay sheet is
      presentation-only (one-shot activation, no main→sheet push channel), so a live-updating
      popup would break that invariant. In-progress rows render the progress captured when the
      popup opens; acting on a row closes the sheet. (Persistent live feedback lives in the
      *button*, which the chrome updates directly — not in the sheet.)
- [ ] Exact idle-visibility / eviction policy — how long a completed download keeps the
      indicator visible and how the chrome-side recent list evicts. Coupled to the accumulator
      design; resolve during flight design, not a throwaway detail.

## Known Issues

_None yet — emergent blockers will be recorded here as the flight surfaces them._

## Flights

> **Note:** These are tentative suggestions, not commitments.

- [x] Flight 1: Top-bar download indicator + downloads popup — the button, its live state,
      the sheet-hosted popup, the chrome-trust open-file handler, and accessibility, closed
      out by a guided HAT (human acceptance test) leg for hands-on alignment.
