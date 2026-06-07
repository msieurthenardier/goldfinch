# Leg: docs-shortcuts

**Status**: completed
**Flight**: [Kebab Menu](../flight.md)

## Objective

Document the new kebab (⋮) menu and bring the README keyboard-shortcuts/features documentation current — covering the kebab's keys plus the carry-forward tab-strip navigation keys and frameless window controls that Flight 1 added but never documented.

## Context

- **Flight docs leg** — the kebab is a new user-facing affordance and needs documenting; the README keyboard-shortcuts table (`README.md:92-101`) still predates Flight 1's tab-strip keyboard nav and frameless window controls. This is a **shared docs surface**, so the carry-forward doc debt is bundled here (per the flight's carry-forward guidance) rather than scheduled separately.
- **Flight-1 debrief action item** — "add tab-nav keys + window controls to the README keyboard-shortcuts table" (still open). This leg closes it.
- **Documentation-only leg** — no source-code behavior changes. README (and optionally goldfinch's CLAUDE.md) only.
- **Auto-generation guard** — `scripts/update-readme.mjs` regenerates ONLY the `<!-- DOWNLOADS:START … END -->` block (`update-readme.mjs:15-37`); the keyboard-shortcuts table and Features section are hand-edited and safe to modify.

## Inputs

What exists before this leg runs:
- `README.md` — the `## Keyboard shortcuts` table with 6 global `Ctrl+*` rows (`README.md:92-101`); the `## Features` section (`README.md:30+`) describing the privacy/media panels; the `## Architecture` file table (`README.md:103-113`).
- The actual key behavior to document, all live in the renderer:
  - Global shortcuts (`renderer.js:1550-1573`): `Ctrl+T`/`W`/`L`/`M`/`Shift+P`/`R` (already in the table).
  - Tab-strip roving nav (`renderer.js:523-547`): `ArrowRight`/`ArrowLeft` switch+focus between tabs, `Home`/`End` jump to first/last, `Delete`/`Backspace` close the focused tab. **Not yet documented.**
  - Kebab menu (added legs 1–2): the `#kebab` button opens a menu with Settings + Exit; `Enter`/`Space`/`ArrowDown` open (to first item), `ArrowUp` opens to last, arrows navigate, `Home`/`End` jump, `Escape` closes, `Enter`/`Space` activate. **New.**
  - Frameless custom window controls (Flight 1): minimize / maximize-restore / close in the tab bar's right zone (win/linux; native traffic lights on macOS). **Not yet documented.**

## Outputs

What exists after this leg completes:
- README documents the kebab menu (Features) and a current keyboard-shortcuts table including tab-strip navigation.
- A short note on the frameless window controls (so the README reflects the post-Flight-1 chrome).
- No source/behavior changes; `npm test` still green (docs don't affect it, but run to confirm nothing else regressed).

## Acceptance Criteria
- [ ] The README `## Keyboard shortcuts` table gains rows for the tab-strip navigation keys: `←` / `→` (move between tabs when a tab is focused), `Home` / `End` (first / last tab), `Delete` / `Backspace` (close the focused tab). Existing `Ctrl+*` rows are preserved.
- [ ] The README documents the **kebab (⋮) menu**: where it is (right end of the toolbar row), what it contains (**Settings** — placeholder for now; **Exit** — quits the app), and that it is keyboard-operable (open with `Enter`/`Space`/`↓`, navigate with arrows, close with `Esc`). A Features bullet and/or a keyboard-shortcuts note is acceptable; keep it accurate to the implemented behavior.
- [ ] The README mentions the **frameless window with custom window controls** (minimize / maximize / close in the tab-bar right zone on Windows/Linux; native traffic lights on macOS) — at least a one-line note so the chrome description isn't stale (Flight-1 carry-forward).
- [ ] No source files (`.js`, `.css`, `.html`, `.ts`) are modified — documentation only. (Updating goldfinch's own `CLAUDE.md` is optional and at the Developer's discretion; if the kebab/IPC architecture warrants a line, add it, but do not over-document a two-item menu.)
- [ ] Documentation is accurate: the **Settings** item is described as a placeholder/not-yet-functional (it is inert until a later flight), not as a working settings page.
- [ ] `npm test` → still 147/147 (sanity; confirms no accidental source edits).

## Verification Steps
- `git diff --name-only` — only `README.md` (and optionally `CLAUDE.md`) changed; no `src/**` files.
- Read the README `## Keyboard shortcuts` table — tab-strip nav rows present; `Ctrl+*` rows intact.
- Read the kebab description — accurate, and Settings is described as a placeholder.
- `npm test` → 147/147 (no source regressions).

## Implementation Guidance

1. **Extend the keyboard-shortcuts table** (`README.md:94-101`). Keep the existing rows; append a small visual divider or just add tab-strip rows. Example additions:
   ```markdown
   | `←` / `→`       | Move between tabs (when a tab is focused) |
   | `Home` / `End`  | First / last tab    |
   | `Delete` / `Backspace` | Close the focused tab |
   | `Esc`           | Close an open menu / panel |
   ```
   - Keep the table's column alignment consistent with the existing rows.

2. **Document the kebab menu** — add a Features bullet (near the panel descriptions around `README.md:62-67`) or a short subsection. Suggested copy:
   > **Overflow menu** (the **⋮** button at the right end of the toolbar): opens a menu with **Settings** (placeholder — coming in a later release) and **Exit** (quits Goldfinch). Keyboard: focus the button and press `Enter`, `Space`, or `↓` to open; arrow keys to move; `Esc` to close.

3. **Note the frameless window controls** — a one-liner in Features or near the toolbar description:
   > Goldfinch uses a custom frameless window: minimize / maximize / close controls live at the right end of the tab bar on Windows and Linux; macOS keeps its native traffic-light controls.

4. **(Optional) goldfinch CLAUDE.md** — if the project's CLAUDE.md enumerates IPC channels or renderer affordances, a one-line mention of the kebab + the `app-quit` IPC keeps it current. Skip if it would be noise.

5. **Do not** edit the auto-generated DOWNLOADS block or any source files.

## Edge Cases
- **Table alignment**: markdown tables tolerate ragged source spacing, but match the existing style for readability.
- **Accuracy over completeness**: do not document the kebab's internal `role="menu"` mechanics for end users; describe observable behavior. Do not claim Settings works.
- **CLAUDE.md scope**: this is goldfinch's own CLAUDE.md (architecture doc), not mission-control's. Do not write project-specific issues anywhere outside the project.

## Files Affected
- `README.md` — keyboard-shortcuts table + kebab/window-controls documentation.
- `CLAUDE.md` *(optional, goldfinch's own)* — a line on the kebab / `app-quit` IPC if it fits the existing structure.

---

## Post-Completion Checklist

**Do NOT commit (deferred-commit flight). Complete these, then signal `[HANDOFF:review-needed]`:**

- [ ] All acceptance criteria verified
- [ ] `npm test` passes (sanity)
- [ ] Update flight-log.md with a leg progress entry
- [ ] Set this leg's status to `landed` (in this file's header)
- [ ] Do NOT check off the leg in flight.md yet, do NOT commit — single review + commit after the last autonomous leg

---

## Citation Audit

All citations verified against current code at leg-design time (clean): `README.md:92-101`
(keyboard-shortcuts table), `update-readme.mjs:15-37` (auto-generated DOWNLOADS block only),
`renderer.js:523-547` (tab-strip roving nav: Arrow/Home/End/Delete/Backspace),
`renderer.js:1550-1573` (global `Ctrl+*` shortcuts). Kebab keys reference legs 1–2 output (uncommitted).
Citation ranges widened per design review to fully enclose the Delete/Backspace and `Ctrl+R` branches.
