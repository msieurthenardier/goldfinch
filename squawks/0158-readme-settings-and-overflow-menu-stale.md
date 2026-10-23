# Squawk 0158: README's overflow-menu and Settings descriptions are stale

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: —

## Report
The README describes an overflow menu with only **New window** and **Settings**. It also lists five Settings sections (Appearance, Privacy & Shields, On startup, Downloads, About). The menu now has New window | Settings, Downloads, Cookie jars, Automation, Vault | Print…, Exit. Settings has three sections (Startup & appearance, Privacy & Shields, About). The README's file table also calls `internal-preload.js` the bridge for "the Settings page" and describes `settings.html` only as Shields + Home page. These were stale before sortie 05, which left them untouched as out of scope.

## Evidence
- `README.md:75` — "**Overflow menu** … opens a menu with **New window** … and **Settings** (… five titled sections: Appearance, Privacy & Shields, On startup, Downloads, and About …)"
- `README.md:298`, `README.md:302` — file-table rows for `internal-preload.js` and `settings.html`
- Current truth: `src/renderer/chrome/overlay-menus.js` `buildKebabModel`; `src/renderer/pages/settings.html` nav.

## Corrective Action
*(written at completion)*

## Verification
Read the edited README sections against `buildKebabModel()` and the `settings.html` and `automation.html` nav. Then run `npm run format:check`.

## Sign-Off
*(written at completion)*
