# Squawk 0148: CLAUDE.md lacks the Sortie 04 invariants and the dev-mode apparatus rule

**Status**: in-progress
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-13
**Completed**: —

## Report
Sortie 04 established invariants and apparatus facts that live only in its debrief and `docs/vault.md`. Add short CLAUDE.md entries (and no other code changes) for:
- **Password vault**: cross-vault copy is a main-side two-call protocol. `needs-resolution` carries metadata only. A stale commit (`matchId !== matchIds[0]` or a resolution not in the current `allowed`) never writes, and Skip never writes. The vault page's `renderEpoch` guards async modal continuations, because `closeActivePageModal` skips `onCancel`.
- **Planning rules** (the "Project-specific planning rules" list): a write-targeting picker never defaults to a real destination; every AC that relies on an existing primitive is checked against that primitive's actual signature at design review.
- **Operator standing preference**: behavior tests and live smokes use Goldfinch **dev mode**. Launch with `dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, capture the key per launch, and attach with `connectAutomation()` scripts. Never use the registered `goldfinch-dev` MCP server.
- **MCP apparatus facts**: `evaluate` takes `expression`, and a wrong key evaluates `undefined` and returns `{ok:true}` silently. The `reload` tool refuses internal tabs, so use `location.reload()` via `evaluate`.

Respect the file's density. Fold each item into its existing section rather than adding a new section.

## Evidence
- `sorties/04-copy-item-to-vault/flight-debrief.md`: Key Learnings, Human Interview (dev mode as standing preference), Recommendation 2.
- `docs/vault.md` "Copying an item to another vault" already documents the feature itself.
- `src/main/automation/mcp-tools.js` `evaluate` `inputSchema.required: ['wcId', 'expression']`.

## Corrective Action
Folded the four notes into CLAUDE.md (Commands dev:automation bullet, MCP automation, Password vault, planning rules). Checked against code: `mcp-tools.js` evaluate requires `expression`; `nav.js` reload throws `internal-session excluded`; `vault-store.js` `_copyItem` stale commit re-answers `needs-resolution`, skip returns early; `renderEpoch` in `vault.js`.

## Verification
Read-through: each bullet is present in its CLAUDE.md section. `npm run format:check` is clean.
