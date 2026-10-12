# Flight Log: Copy a Vault Item to Another Vault

**Flight**: [Copy a Vault Item to Another Vault](flight.md)

## Summary
Planning. Charter agreed 2026-10-12.

---

## Leg Progress

### Leg 1 `copy-item-store-and-ipc` — landed (2026-10-12)
- **Changes**: new `src/main/vault/copy-plan.js` (`planCopy`, `allowedFor`, `isIdenticalItem`); `VaultStore.copyItem`/`_copyItem` after `importLogins` (13th gated op); `VAULT_ITEM_COPY_CONFIG`; `internal-vault-item-copy` handler (async, hand-mapped `{locked}`); `vaultItemCopy` preload + d.ts; docs/vault.md `### Copying an item to another vault` (+ identity cross-reference). Tests: `vault-copy-plan`, `vault-copy-item`, `vault-copy-boundary` (new); `register-vault-ipc` and `vault-rekey-gate` updated (channel set, CRUD list, thirteen, sync group = nine).
- **Decision / deviation**: the AC10(c) singleton pin could not go red from a bare "different id" stub on a `replace` if the guard only compared against `identityProfileOf(final).profile` (the replaced slot would itself be the first identity). The guard therefore also requires a replace to land under the displaced item's id (`displacedId`), which is what the stub test pins.
- Skip never reads `matchId` beyond the shape check (DD3 step 3). Scenario-table tests seed the destination for every non-`new` cell.
- CLAUDE.md untouched (no new invariant beyond docs/vault.md).

### Leg 2 `copy-to-ui` — landed (2026-10-12)
- **Changes**: new `src/renderer/pages/vault-item-actions-controller.js` (`createItemActionsController`: `openDeleteConfirm`, `openRevokeConfirm` moved from vault.js, `openCopyTo`; frozen `COPY_TEXT`; single `bridge.vaultItemCopy(` call in `submitCopy`; no static imports). `copyDestinationOptions` in `vault-page-model.js` (+ tests). `vault.js`: controller construction, `renderEpoch` (first statement of `render()`), `copy-to` icon, row order Edit / Copy to… / Delete, old confirms removed. `vault.css`: `.vault-copy-choice` / `.vault-copy-option`. Pins: internal-page-map route + test, invariants "Sortie 04" route-sum block, eslint module list, `VAULT_PAGE_LINE_BUDGET`. `docs/vault.md` gained a "Page UI" paragraph. `tests/behavior/vault-copy-item.md` finalized (selector key, real notice texts, new step 0 live smoke; status stays draft). New `vault-item-actions-controller.test.js` (23 tests).
- **Line counts**: `vault.js` 2152 → **2105** (Prettier, `split(/\r?\n/).length`); `VAULT_PAGE_LINE_BUDGET` 2153 → 2105 (exact). CLAUDE.md does not name the vault budget or controller set, so it is untouched.
- **Verification**: `npm test` 5965 tests / 5961 pass / 0 fail (rest skipped), `typecheck`, `lint`, `format:check` clean. Live run NOT done (leg 3, operator).
- **Deviation 1 (submit label)**: AC7 says the step-2 submit label follows the selection. `openModal` takes a static `submitLabel` and has no setter, and AC13 forbids changing `openModal`, so step 2 uses the fixed label `Apply` (identity: `Replace`, since it has one option). Radio text carries the Skip/Replace/Keep both meaning, incl. the overwrite warning.
- **Deviation 2 (revoke)**: delete-confirm simplified to one `.then` (identical `close()` + `refresh()` on both reply branches, as before); revoke kept the `{locked}` → `refresh()` / success → `refreshKeys()` split.
- **Decisions**: dest name = label text before the LAST " — "; locked reply with a moved epoch is dropped silently (the render already closed the modal and refreshed); a stale-commit is recognised by the payload carrying a `resolution`.
- **Out-of-scope notes**: none found.

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes
- 2026-10-12: Sortie qualified (all four criteria met; no active mission or open sortie covers it). Charter agreed with the operator: Skip / Replace / Keep both on collision; per-type content-identity match rule; destinations are any other persistent jar vault or Global; copy only.
- 2026-10-12: Recon (vault code + M18–M22 debriefs). Key constraints: `vault.js` at 2152/2153 budget (extraction required), `openModal` single-submit, no cross-window vault-changed broadcast, admin `evaluate` can reach `goldfinchInternal.*` (accepted).
- 2026-10-12: Crew interview — operator rulings: Replace overwrites fields and keeps the destination id; Keep both titles `"Title (copy)"`; several matches → Skip / Keep both only; no cross-window refresh; HAT leg included.
- 2026-10-12: Architect design review 1 — approve with changes (5 high, 6 medium, 2 low). Fixed: stale `skip` never writes; `_normalizeItem` keeps source id/createdAt unless deleted; notice set before `refresh()`; render-epoch guard (render-close skips `onCancel`); `canonicalOrigin` returns the string `'null'` for opaque origins; identity Replace targets `identityProfileOf().profile`; cache contracts; closed-set test lists; injected `copyDestinationOptions`. Charter criterion 3 narrowed from "no item field value" to "no secret field value" (collision step shows non-secret title/username, as rows already do) — surfaced to the operator.
- 2026-10-12: Architect design review 2 (final cycle) — approve with changes. Fixed: DD3 re-stated as an evaluation order + outcome table (stale = `matchId !== matchIds[0]` OR resolution ∉ current `allowed`; `skip` always `skipped`); render epoch still surfaces a notice for a write that landed; focus-across-steps premise corrected; behavior step 11 gains a positive-control marker; step 10a traced achievable.
- 2026-10-12: Operator ruling — the apparatus is Goldfinch dev mode (`dev:automation` + `DEV_MINT`, key captured per launch, `connectAutomation()` scripts), not the registered `goldfinch-dev` MCP server. The vault under test is the dev profile's. DD11, prerequisites and the behavior spec preconditions updated; the `goldfinch-dev` connect failure is no longer a blocker.
- 2026-10-12: Operator approved the flight (charter criterion 3 accepted as narrowed to secret fields). Status → ready.

### Flight Director Notes
- 2026-10-12: `/mission-control:agentic-workflow sortie 04` started. Phase file `.flightops/agent-crews/leg-execution.md` loaded (well-formed: Crew / Interaction Protocol / Prompts). Status → in-flight. Branch `sortie/04-copy-item-to-vault` from `main` (`d16dfb2`). 3 legs: 2 autonomous + HAT.
- 2026-10-12: Leg 1 `copy-item-store-and-ipc` designed (17 ACs). **Risk tier: HIGH** — new gated write op on the vault store (state machine: two-call protocol with a stale-commit rule), a new internal IPC channel on a security-sensitive surface, the `vaultKeys` cache on the lazy path, and closed-set test pins. Spawning a Developer design review.
- 2026-10-12: Leg 1 design review (Developer) — approve with changes, no high issues. Applied: login `matchMode` absent ≡ `'exact'` in the identical check (`origin-match.js:73`); AC10 singleton clause restated as reachable assertions + a stub-driven pin on the pre-write guard; rekey-gate sync group is eight → nine (comment said "seven"); `match.username` login-only; handler-level stale-commit case; explicit `vaultKeys` pre-seed; source with no file → `VaultStateError`. Targeted fixes only — no second review cycle. Leg 1 → ready.

### Flight Director Notes (continued)
- 2026-10-12: Leg 1 `[LAND:leg]` received. FD spot-check: leg status `landed`; the five leg-1 test files pass (104 tests); store reply shapes match DD7 (`kept-both` carries `title`, `match` metadata-only). Accepted the Developer's AC10(c) deviation (identity replace must land under the displaced id — the leg's comparison could not fail under the stub).
- 2026-10-12: Leg 2 `copy-to-ui` designed (16 ACs) while leg 1 ran (disjoint files). **Risk tier: HIGH** — shared page mechanisms (`render()` epoch, `openModal`, `pendingNotice`), a verbatim extraction, and a textContent-only security surface. Developer design review: approve with changes (no high). Applied: revoke-access-key confirm moves with delete-confirm by DEFAULT (delete alone nets ≈ −4..+2 lines; both ≈ −35); minimal `.vault-copy-choice` CSS for the native radio fieldset; epoch re-captured per modal; test brings its own richer mock `El`; copy strings in one frozen table; source-scan pins (row order, no innerHTML, single `vaultItemCopy(` call). FD calls: zero-destination keeps the explanatory modal; destination labels reuse `browserImportDestinationOptions` wording ("— N secrets"), refining DD8's "N items". Live smoke + behavior test move to leg 3 start (unlock is an operator step). No second review cycle (targeted fixes). Leg 2 → ready; spawning the implementing Developer.
- 2026-10-12: Leg 2 `[LAND:leg]` received (vault.js 2152 → 2105; budget retargeted to 2105; 5961 pass / 0 fail). Accepted deviation: step-2 submit is a fixed "Apply" (identity: "Replace") because `openModal` has no label setter and AC13 forbids changing it — carried to the HAT as an alignment item. Last autonomous leg → Phase 2d flight review (Reviewer, Sonnet).
- 2026-10-12: Flight review (Reviewer, Sonnet): `[HANDOFF:confirmed]`, no blocking issues; independently re-ran `npm test` (5961 pass / 0 fail), typecheck, lint, format:check. Non-blocking: (1) revoke-confirm move is per leg 2 AC2 (beyond DD8's wording) — accepted; (2) stale step-2 re-render is unit-only — added to the HAT walk. Legs 1–2 → completed. Spawning the Developer to commit legs 1–2 in one commit; leg 3 (HAT) follows with the operator.
