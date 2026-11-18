# Squawk 0220: Welcome surface still relies on the `{search}/{home}` override instead of a synchronous local cache write

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
Carried since Mission 16 (maintenance 2026-08-27, three cycles). After `chrome-welcome-set`, the chrome waits for the `settings-changed` broadcast, so `welcome-controller.js` passes `{ search }` / `{ home }` overrides to `settle()` to bridge the gap ("the broadcast may not have landed yet"). The planned fix: write the renderer's local cache synchronously on a successful set, then retire the override. Routine maintenance 2026-11-18 asked for it to become one squawk rather than be carried again.

## Evidence
- `src/main/register-settings-ipc.js` — `chrome-welcome-set` persists and broadcasts only.
- `src/renderer/chrome/welcome-controller.js` — `opts.search` / `opts.home` override, used at the settle call sites; comment about the broadcast not having landed.

## Corrective Action
*(written at completion)*

## Verification
Welcome-controller unit tests: setting the home page / engine then settling uses the cache without an override; the override parameter is gone; the existing welcome behaviour tests stay green.
