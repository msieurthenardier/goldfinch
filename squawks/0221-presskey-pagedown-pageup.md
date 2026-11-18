# Squawk 0221: MCP `pressKey` cannot send PageDown or PageUp

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
`KEY_MAP` has Home and End but no PageDown/PageUp, so `pressKey(wcId, 'PageDown')` throws "automation: unknown key", although the browser's own sheet keyboard contract uses both. Carried since Mission 09 (maintenance 2026-08-27).

## Evidence
- `src/main/automation/input.js:KEY_MAP` — Tab, Enter, Escape, Space, arrows, Home, End, Delete, Backspace, F6, F5; no PageDown/PageUp.
- `KEY_NAMES` is derived from `KEY_MAP`, so the tool schema follows automatically.

## Corrective Action
*(written at completion)*

## Verification
Unit test: `keyEvents('PageDown')` / `('PageUp')` produce the `PageDown`/`PageUp` accelerator events; `docs/mcp-automation.md` key list updated if it enumerates keys.
