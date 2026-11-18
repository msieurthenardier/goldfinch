# Squawk 0214: About 28 exported symbols have no importer

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
Exports with no importer anywhere in `src/` or `test/` widen the public surface and make "re-exported so callers reference …" comments misleading. Unexport each (keep it module-private if used internally), or add the one test that justifies it. Found by routine maintenance 2026-11-18 (finding #24).

## Evidence
`grep -w` over `src/` and `test/` finds no importer for:
- `src/main/`: `disablesSiteIsolation`, `SITE_ISOLATION_FEATURES` (launch-switches.js); `isWebUrl`, `isBlobUrl`, `dataImageType` (media-list.js); `sanitizeQueue` (register-save-prompt-ipc.js); `FORWARDED_REQUEST_HEADERS` (media-proxy-handler.js); `WITHHELD_KEYS` (settings-chrome-view.js); `ACTIONS`, `DISPLAY_MAX_CHARS` (reveal-gate.js); `REQUEST_TIMEOUT_MS` (update-check.js); `MAX_LABEL` (move-targets.js); `OWNER_FILE`, `OWNER_DIR`, `DB_FAMILY_RE`, `MIGRATED_RE` (file-modes.js); the `SAVE_PROMPT_*` constants (save-prompt-geometry.js, save-prompt-manager.js).
- vault/automation: `BUNDLE_FORMAT` (vault-store.js), `luhnValid` (card-identity.js), `ALLOWED_EXT` (export-path.js), `boxContains` (gesture-verifier.js), `base32Encode` (vault-crypto.js), `clipField` (audit-log.js), `MAX_SESSIONS` (mcp-server.js), `LOCK_NOTE` (shared/vault-capture-template.js).
Re-check each with a destructuring-aware search before removing (`grep -w` can miss `{ name }` imports).

## Corrective Action
*(written at completion)*

## Verification
`npm test`, `npm run lint`, `npm run typecheck` green; a re-run of the importer scan finds none of the listed names exported without an importer.
