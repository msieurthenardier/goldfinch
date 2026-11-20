# Squawk 0214: About 28 exported symbols have no importer

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
Exports with no importer anywhere in `src/` or `test/` widen the public surface and make "re-exported so callers reference …" comments misleading. Unexport each (keep it module-private if used internally), or add the one test that justifies it. Found by routine maintenance 2026-11-18 (finding #24).

## Evidence
`grep -w` over `src/` and `test/` finds no importer for:
- `src/main/`: `disablesSiteIsolation`, `SITE_ISOLATION_FEATURES` (launch-switches.js); `isWebUrl`, `isBlobUrl`, `dataImageType` (media-list.js); `sanitizeQueue` (register-save-prompt-ipc.js); `FORWARDED_REQUEST_HEADERS` (media-proxy-handler.js); `WITHHELD_KEYS` (settings-chrome-view.js); `ACTIONS`, `DISPLAY_MAX_CHARS` (reveal-gate.js); `REQUEST_TIMEOUT_MS` (update-check.js); `MAX_LABEL` (move-targets.js); `OWNER_FILE`, `OWNER_DIR`, `DB_FAMILY_RE`, `MIGRATED_RE` (file-modes.js); the `SAVE_PROMPT_*` constants (save-prompt-geometry.js, save-prompt-manager.js).
- vault/automation: `BUNDLE_FORMAT` (vault-store.js), `luhnValid` (card-identity.js), `ALLOWED_EXT` (export-path.js), `boxContains` (gesture-verifier.js), `base32Encode` (vault-crypto.js), `clipField` (audit-log.js), `MAX_SESSIONS` (mcp-server.js), `LOCK_NOTE` (shared/vault-capture-template.js).
Re-check each with a destructuring-aware search before removing (`grep -w` can miss `{ name }` imports).

## Corrective Action
Re-ran a word-boundary search of `src/`, `test/` and `scripts/` for every listed name (destructured, `mod.NAME` and `require(...).NAME` forms included). Every name had hits only in its own file (definition, internal uses, and the export line), so each was unexported and kept module-private; none was deleted, since each is used inside its module. No `typeof import(...)` JSDoc referenced any of them.

| Name | File | Outcome |
|---|---|---|
| `disablesSiteIsolation`, `SITE_ISOLATION_FEATURES` | `src/main/launch-switches.js` | unexported (used internally) |
| `isWebUrl`, `isBlobUrl`, `dataImageType` | `src/main/media-list.js` | unexported (used internally) |
| `sanitizeQueue` | `src/main/register-save-prompt-ipc.js` | unexported (used internally) |
| `FORWARDED_REQUEST_HEADERS` | `src/main/media-proxy-handler.js` | unexported (used internally) |
| `WITHHELD_KEYS` | `src/main/settings-chrome-view.js` | unexported (used internally) |
| `ACTIONS`, `DISPLAY_MAX_CHARS` | `src/main/reveal-gate.js` | unexported (used internally) |
| `REQUEST_TIMEOUT_MS` | `src/main/update-check.js` | unexported (used internally) |
| `MAX_LABEL` | `src/main/move-targets.js` | unexported (used internally) |
| `OWNER_FILE`, `OWNER_DIR`, `DB_FAMILY_RE`, `MIGRATED_RE` | `src/main/file-modes.js` | unexported (used internally) |
| `SAVE_PROMPT_WIDTH`, `_MIN_HEIGHT`, `_MARGIN`, `_MARGIN_RIGHT`, `_FIND_OFFSET` | `src/main/save-prompt-geometry.js` | unexported (used internally) |
| `SAVE_PROMPT_SUCCESS_HOLD_MS`, `SAVE_PROMPT_FAILURE_HOLD_MS` | `src/main/save-prompt-manager.js` | unexported (used internally) |
| `SAVE_PROMPT_TIMEOUT_MS`, `SAVE_PROMPT_SHOW_FALLBACK_MS` | `src/main/save-prompt-manager.js` | kept: imported by `test/unit/save-prompt-manager.test.js` |
| `BUNDLE_FORMAT` | `src/main/vault/vault-store.js` | unexported; the "Re-exported ... format id + version" comment above the export block now names only the version |
| `luhnValid` | `src/main/vault/card-identity.js` | unexported (used internally) |
| `ALLOWED_EXT` | `src/main/vault/export-path.js` | unexported (used internally) |
| `boxContains` | `src/main/vault/gesture-verifier.js` | unexported (used internally) |
| `base32Encode` | `src/main/vault/vault-crypto.js` | unexported (used internally; `base32Decode` untouched) |
| `clipField` | `src/main/automation/audit-log.js` | unexported (used internally) |
| `MAX_SESSIONS` | `src/main/automation/mcp-server.js` | unexported (used internally) |
| `LOCK_NOTE` | `src/shared/vault-capture-template.js` | `export` dropped (used internally); no flat-specifier or `file://` importer exists |


## Verification
`npm test`, `npm run lint`, `npm run typecheck` green; a re-run of the importer scan finds none of the listed names exported without an importer.

Ran: `npm test` (7455 tests, 7450 pass, 0 fail, remainder skipped), `npm run lint` (clean), `npm run typecheck` (clean), `npx prettier --write` on the changed source files, `npm run format:check` (clean). Final importer scan over the changed tree: each listed name now appears only in its own file and in no export list, except the two `SAVE_PROMPT_*` names kept above because a test imports them.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the tenth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The Reviewer's own word-boundary search over `src/`, `test/` and `scripts/` finds each of the 31 names only in its own module; no consumer lost an export; the two `SAVE_PROMPT_*` constants a test imports were rightly kept; `LOCK_NOTE` has no importer and is still defined for internal use. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck, format:check and `path-hygiene.test.js` clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-j`
