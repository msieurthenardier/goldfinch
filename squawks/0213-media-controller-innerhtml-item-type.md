# Squawk 0213: `media-controller.js` interpolates `item.type` into `innerHTML` unescaped

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
One media-panel row template puts `item.type` into an `innerHTML` string without escaping (the sibling template escapes its fields). It is safe today only because main's media-list validator restricts `type` to four values; the chrome sink should not depend on that. Defense in depth. Found by routine maintenance 2026-11-18 (finding #32).

## Evidence
- `src/renderer/chrome/media-controller.js` — the second `innerHTML` template (~:231) uses `${item.type}`; the first (~:184) escapes name and label.
- `src/main/media-list.js` — `type` allowlist image/video/audio/embed.

## Corrective Action
*(written at completion)*

## Verification
The row is built with `createElement`/`textContent` (or `item.type` is escaped); a unit test renders a row with a hostile `type` string and asserts no element is created from it.
