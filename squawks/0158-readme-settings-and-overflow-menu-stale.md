# Squawk 0158: README's overflow-menu and Settings descriptions are stale

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: 2026-10-24

## Report
The README describes an overflow menu with only **New window** and **Settings**. It also lists five Settings sections (Appearance, Privacy & Shields, On startup, Downloads, About). The menu now has New window | Settings, Downloads, Cookie jars, Automation, Vault | Print…, Exit. Settings has three sections (Startup & appearance, Privacy & Shields, About). The README's file table also calls `internal-preload.js` the bridge for "the Settings page" and describes `settings.html` only as Shields + Home page. These were stale before sortie 05, which left them untouched as out of scope.

FD-ruled widening: the same stale Settings descriptions elsewhere in README.md (Internal pages section, "Settings → Appearance" references, settings-store row) are folded into this squawk.

## Evidence
- `README.md:75` — "**Overflow menu** … opens a menu with **New window** … and **Settings** (… five titled sections: Appearance, Privacy & Shields, On startup, Downloads, and About …)"
- `README.md:298`, `README.md:302` — file-table rows for `internal-preload.js` and `settings.html`
- Current truth: `src/renderer/chrome/overlay-menus.js` `buildKebabModel`; `src/renderer/pages/settings.html` nav.

## Corrective Action
README.md: rewrote the Overflow menu bullet to match `buildKebabModel()` (New window | Settings, Downloads, Cookie jars, Automation, Vault | Print…, Exit) and the three Settings sections (Startup & appearance, Privacy & Shields, About); updated the `internal-preload.js` file-table row to name all five bridged internal pages and the `settings.html` row to the current sections. Also fixed the Internal pages section (three sections, new names), all "Settings → Appearance" references (spellcheck ones now "Privacy & Shields", where the toggle lives; pin/DevTools ones "Startup & appearance"), and persistence mentions (`settings.json`/`shields.json` → `app.db`). No `automation.html` row added (the table lists no other internal pages).

## Verification
Edited sections re-read against `buildKebabModel()`, `settings.html` nav and `INTERNAL_ORIGINS` in `internal-preload.js`; `npm run format` and `npm run format:check` run (see report). Original plan: read the edited README sections against `buildKebabModel()` and the `settings.html` and `automation.html` nav. Then run `npm run format:check`.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. README claims match source: Settings' three sections, the eight-item overflow menu (`overlay-menus.js` `buildKebabModel`) and `app.db` persistence. Spellcheck correctly sits under Privacy & Shields. The scope was widened by the FD to all stale Settings text in the README. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`
