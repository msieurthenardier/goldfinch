# Leg: copy-item-store-and-ipc

**Status**: completed
**Flight**: [Copy a Vault Item to Another Vault](../flight.md)

## Objective
Add the main-side cross-vault copy: a pure planner (`planCopy`), a gated store op (`VaultStore.copyItem`) that writes at most once, the `internal-vault-item-copy` internal channel with reason-mapped errors, the preload method and its typing, every closed-set test pin, and the `docs/vault.md` section — so leg 2 builds the page against a finished, tested contract.

## Context
- Flight DDs that bind this leg: **DD1** (op shape, evaluation order steps 1-10, return shape), **DD2** (match rule incl. opaque origins and identity = first profile), **DD3** (shape check, `allowed` sets, evaluation order, outcome table), **DD4** (Replace keeps destination id/createdAt), **DD5** (Keep both `"(copy)"`), **DD6** (fresh id/createdAt on copy — delete the keys), **DD7** (channel, `{locked}`, `VAULT_ITEM_COPY_CONFIG`), **DD9** store-cache paragraph (`vaultKeys`), **DD10** (automation boundary).
- The page is NOT touched in this leg (`src/renderer/**` unchanged except `renderer-globals.d.ts`).
- Template ops: `importLogins`/`_importLogins` (`src/main/vault/vault-store.js` — gated wrapper + body, read destination once, plan, write at most once, lazy create) and `_saveItem` (lazy-create + `vaultKeys.set`, identity singleton check).

## Inputs
- `src/main/vault/vault-store.js` — `_normalizeItem` (≈2999, spreads `...item`, keeps a non-empty `id` and `createdAt`), `_saveItem` (≈3050; lazy create ≈3056-3064; identity singleton ≈3083-3090), `importLogins` (≈3112) / `_importLogins` (≈3130), `_resolveTarget` (≈2870), `_enterGatedOp` (≈1336), `_vaultKeyFromDoc` (≈2975), `_writeVaultForKey` (≈1472), `_writeVault` (≈1157)
- `src/main/vault/browser-import.js` — `canonicalOrigin` (exported; returns the STRING `'null'` for opaque origins, `null` for non-URLs); `identityKey` is NOT exported
- `src/main/vault/card-identity.js` — `digitsOf` (exported)
- `src/main/vault/identity-profile.js` — `identityProfileOf(items)` → `{ profile, extra }` (exported)
- `src/shared/vault-item-schema.js` — `SCHEMA`, `ITEM_TYPES`, `secretFieldsFor`, `nonSecretFieldsFor`, `metadataOf` (exported)
- `src/main/vault/vault-sheet-errors.js` — `mapVaultSheetError`, `VAULT_BROWSER_IMPORT_COMMIT_CONFIG` (the sibling to copy the shape of)
- `src/main/register-vault-ipc.js` — `catchLocked` (≈29, sync-only), `internal-vault-item-delete` (≈269), `internal-vault-export` async `{locked}` hand-map (≈325-338)
- `src/preload/internal-preload.js` — `vaultItemDelete` (≈639)
- `src/renderer/renderer-globals.d.ts` — `interface GoldfinchInternalBridge` (≈642), vault methods (≈749-790)

## Outputs
- NEW `src/main/vault/copy-plan.js` (CJS, Electron-free, pure): `planCopy(item, destItems)`, `allowedFor(plan, item)` (or equivalent), `isIdentical(a, b)`
- `src/main/vault/vault-store.js`: `copyItem` (gated wrapper) + `_copyItem` (body)
- `src/main/vault/vault-sheet-errors.js`: `VAULT_ITEM_COPY_CONFIG` exported
- `src/main/register-vault-ipc.js`: `internal-vault-item-copy` handler
- `src/preload/internal-preload.js`: `vaultItemCopy(payload)`
- `src/renderer/renderer-globals.d.ts`: `vaultItemCopy` entry
- Tests (new): `test/unit/vault-copy-plan.test.js`, `test/unit/vault-copy-item.test.js`, `test/unit/vault-copy-boundary.test.js` (or an added block in an existing boundary file — see AC10)
- Tests (updated): `test/unit/vault-rekey-gate.test.js`, `test/unit/register-vault-ipc.test.js`, and any vault-sheet-errors config-list test if one enumerates the exports (grep for `VAULT_BROWSER_IMPORT_COMMIT_CONFIG` in `test/unit/`)
- `docs/vault.md`: new `### Copying an item to another vault` under `## Portability`

## Acceptance Criteria

**Planner (`copy-plan.js`, pure — `vault-copy-plan.test.js`)**
- [ ] AC1 `planCopy(item, destItems)` returns `{ kind: 'new' }`, `{ kind: 'identical', matchIds }` or `{ kind: 'match', matchIds }`, considering only destination items with `type === item.type`. Match rules (DD2): **login** `canonicalOrigin(origin)` + `(username ?? '')`, keyed by a LOCAL helper (no new export from `browser-import.js`); a `canonicalOrigin` result of `null` OR the string `'null'` on either side never matches; **card** `digitsOf(number)` equal and non-empty; **note** `title` trimmed, case-sensitive, equal; **identity** the single match is `identityProfileOf(destItems).profile` (so identity `matchIds.length` is 0 or 1). `matchIds` preserves destination array order.
- [ ] AC2 **Identical** = every field in `SCHEMA[type].nonSecret ∪ SCHEMA[type].secret`, plus `matchMode` for login, compares equal with `undefined`/`null`/`''` treated alike — EXCEPT login `matchMode`, normalized on both sides as `=== 'registrable-domain' ? 'registrable-domain' : 'exact'` (absent IS exact: `origin-match.js:73`, `metadataOf` `vault-item-schema.js:111-112`); tests: absent vs `'exact'` → identical, `'exact'` vs `'registrable-domain'` → not; `id`/`createdAt`/`updatedAt`/unknown extras are ignored. If ANY match is identical the plan is `identical`.
- [ ] AC3 `allowed` (DD3): one non-identity match → `['skip','replace','keep-both']`; several non-identity matches → `['skip','keep-both']`; identity → `['replace']`.
- [ ] AC4 Planner matrix tests cover, per type: no match; one match differing; one match identical; several matches (login, note, card); opaque-origin logins (`chrome://a` vs `chrome://b`, same username → NOT a match; `file:///x` both sides → NOT a match; a non-URL origin → NOT a match); origin canonicalization (`https://Example.com/path` matches `https://example.com`); card digits normalization (`4242 4242 4242 4242` matches `4242424242424242`); empty card number never matches; destination with two identities → match is the first, `matchIds` length 1; a different-type item with the same title never matches; login `username` `null` vs `''` vs absent → same key; a card whose `number` is a non-string → no throw, no match.

**Store op (`vault-copy-item.test.js`, real store, `FAST_SCRYPT`)**
- [ ] AC5 `copyItem(sourceTarget, itemId, destTarget, opts)` is a gated op: the public wrapper takes `_enterGatedOp()` and releases in `finally`; the body `_copyItem` follows DD1's order: (1) shape check — `sourceTarget`/`itemId`/`destTarget` strings; `opts.resolution` absent or in `{'skip','replace','keep-both'}`; when a resolution is present, `opts.matchId` a non-empty string — else `VaultStateError`; (2) `_requireMrk()`; (3) `_resolveTarget` both targets; (4) same vault → `VaultStateError`; (5) `_touch()`; (6) source read + item lookup (a source with no `.gfvault` — the lazy path is destination-only — or a missing item → `VaultStateError`; type not in `ITEM_TYPES` → `VaultStateError`); (7) destination read once (absent → lazy); (8) `planCopy`; (9) act per DD3's evaluation order; (10) at most one write.
- [ ] AC6 **Every DD3 outcome-table cell is a test** (fixtures SEED the destination for every non-`new` cell — an `identical`/match plan cannot arise on a lazy destination), each asserting the outcome AND the destination's item list / file mtime-or-bytes for zero-write cells. Cells: any→identical × {none, skip, replace, keep-both} → `already-present`; M1→new × {skip→`skipped` no write, replace→`copied`, keep-both→`copied`}; M1(A)→M1(A) × {skipped, replaced, kept-both}; M1(A)→M1(B) × {skipped, needs-resolution, needs-resolution}; M1(A)→Mn(first A) × {skipped, needs-resolution, kept-both}; M1(A)→Mn(first B) × {skipped, needs-resolution, needs-resolution}; Mn(A)→M1(A) keep-both → `kept-both`; Mn→new keep-both → `copied`; ID(A)→new replace → `copied`; ID(A)→ID(A) replace → `replaced`; ID(A)→ID(B) replace → `needs-resolution`. Plus no-resolution: new → `copied`; match → `needs-resolution` with `match` and `allowed`. "Ask-time" state is produced by a no-resolution call; the commit-time state by mutating the destination (save/delete) before the commit call.
- [ ] AC7 `needs-resolution` returns `match` = `{ id, type, title }` plus `username` ONLY when `type === 'login'`, built ONLY from `metadataOf` (vault-item-schema whitelist) of `matchIds[0]` (`title` may be `null` — leg 2 renders a fallback); a test asserts no key of the reply (deep) is a secret field name for that type and no seeded secret marker string appears in `JSON.stringify(reply)`. `copied`/`replaced`/`kept-both` replies carry no item fields beyond `{ outcome }` plus, for `kept-both`, the new title (non-secret).
- [ ] AC8 Field carry and ids (DD4-DD6): a `copied` item has every field of the source (login password/totp/notes/matchMode; card number/cvv/expiry/notes/cardholder/brand/last4; identity all fields; note body), a fresh `id` ≠ source id, a fresh `createdAt` (≠ source `createdAt`) and `updatedAt === ` the injected `now` (clock via `deps.now`), and an unknown extra field on the source survives; `kept-both` additionally has title `${source.title || '(untitled)'} (copy)`; `replaced` keeps the destination item's `id` and `createdAt`, takes every other field from the source (a destination-only field absent on the source is gone — full replace), and sits at the same array index. The source vault is byte-identical before and after every outcome.
- [ ] AC9 Lazy destination: copying into a persistent jar with no `.gfvault` creates it (`hasVault` true after), the item is readable via `listItems`, and a **stale `vaultKeys` entry** pre-seeded for that jar id (the test sets `store.vaultKeys.set('personal', bogusBuffer)` directly) is replaced: afterwards `store.vaultKeys.get('personal') !== bogusBuffer` and `listItems('personal')` decrypts the copy. A copy that writes nothing (`skipped`/`needs-resolution`/`already-present`) into a jar with no vault creates NO file. `_copyItem` never zeroizes any cached key.
- [ ] AC10 Refusals with zero writes: locked → `VaultLockedError`; gate raised → `VaultBusyError`; burner/unknown source or destination → `VaultStateError` with no file created; same source and destination → `VaultStateError`; missing item → `VaultStateError`; bad resolution string / resolution without `matchId` → `VaultStateError` (including when the plan would have been `new`); `skip` without `matchId` → `VaultStateError`. **Identity singleton**: (a) ID→ID(A) replace leaves exactly one identity when the destination had one; (b) with two destination identities, the first is replaced and the extra is deep-equal (decrypted) to its pre-copy value; (c) the pre-write singleton guard in `_copyItem` is itself pinned — a test stubs `store._normalizeItem` for one call to return an identity with a different id and asserts `VaultStateError` plus zero write (destination bytes unchanged), so a mutation removing the guard goes red.

**IPC, preload, typing**
- [ ] AC11 `registerInternalHandler(ipcMain, 'internal-vault-item-copy', async (_event, payload) => …)` destructures `{ sourceVaultId, itemId, destVaultId, resolution, matchId }` from `payload || {}`, calls `getVaultStore().copyItem(sourceVaultId, itemId, destVaultId, { resolution, matchId })`, and returns `{ ok: true, ...result }`; `VaultLockedError` → `{ locked: true }` (hand-mapped in the handler's own try/catch, the `internal-vault-export` precedent); otherwise `mapVaultSheetError(e, VAULT_ITEM_COPY_CONFIG)` → `{ ok: false, reason }`, and a `null` mapping rethrows unchanged. `VAULT_ITEM_COPY_CONFIG = { VaultBusyError: 'busy', VaultStateError: 'state' }` is its own named export with a comment in the module's per-delegate style (never a reuse of the browser-import config). No broadcast is sent.
- [ ] AC12 `register-vault-ipc.test.js`: the exact sorted channel list gains `'internal-vault-item-copy'` (test title updated); `CRUD_CHANNELS` gains it (so the forbidden-sender and locked tests cover it — adjust the locked-test payload if it needs one); new tests: a `realHarness` round-trip covering lazy destination → `copied`, a collision → `needs-resolution` → commit `replace` → `replaced` (the composition test: real store on disk + real handler), a STALE commit through the handler (destination's match deleted and another added between ask and a `replace` commit with the old `matchId` → `{ ok: true, outcome: 'needs-resolution' }`, no write), `VaultBusyError` → `{ ok:false, reason:'busy' }`, a `VaultStateError` → `{ ok:false, reason:'state' }`, and `VaultLockedError` → `{ locked: true }` (a resolved value, never a rejection).
- [ ] AC13 `internal-preload.js` exposes `vaultItemCopy: (payload) => ipcRenderer.invoke('internal-vault-item-copy', payload)` with a JSDoc block in the neighbors' style; `renderer-globals.d.ts` gains the matching `vaultItemCopy(payload: { sourceVaultId: string, itemId: string, destVaultId: string, resolution?: 'skip'|'replace'|'keep-both', matchId?: string }): Promise<…>` entry with the reply union. No existing test pins the vault bridge's preload/d.ts method set (design review: `vaultItemDelete` has no test reference; the only pins cover `browserImport*` in `vault-browser-import-invariants.test.js:74,385`). Do not hand-edit the generated `internal-preload.bundle.js` — `pretest` rebuilds it.

**Pins, boundary, docs**
- [ ] AC14 `vault-rekey-gate.test.js`: "twelve" → "thirteen" in the test title, the section banner and the file header history (append "then to THIRTEEN by Sortie 04 Leg 1, which added `copyItem`"); `copyItem` added to the SYNCHRONOUS group (`assert.throws(() => store.copyItem('global', 'x', 'work', {}), busy, 'copyItem')` or equivalent). The sync group already lists EIGHT ops while its comment says "seven" — the comment becomes "nine synchronous" (8 + `copyItem`); grep the file for `twelve|seven|TWELVE` and fix every live (non-history) hit.
- [ ] AC15 Automation boundary (DD10): a test asserts `src/main/automation/**` contains zero matches for `/internal-vault-item-copy|copyItem|copy-plan/`, and that the MCP tool count is still 35 and no tool name matches `/copy/i` (zero pre-existing matches — design review grep of `mcp-tools.js`).
- [ ] AC16 `docs/vault.md` gains `### Copying an item to another vault` under `## Portability` (after `### Browser import`), covering: main-side op, gated, at most one write, lazy creation, the match rule, the two-call protocol with the DD3 outcome table, Replace keeps the destination id/createdAt, Keep both `(copy)` with a fresh id, identity Replace targets the first profile and leaves extras, opaque-origin non-match, no broadcast (cross-window staleness, as save/delete), no MCP surface, admin `evaluate` reachability accepted. The `identityProfileOf` / one-identity paragraph cross-references it.
- [ ] AC17 `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check` pass (run `npm run format` first).

## Verification Steps
- AC1-AC4: `node --test test/unit/vault-copy-plan.test.js`
- AC5-AC10: `node --test test/unit/vault-copy-item.test.js`
- AC11-AC12: `node --test test/unit/register-vault-ipc.test.js`
- AC13: `grep -n "vaultItemCopy" src/preload/internal-preload.js src/renderer/renderer-globals.d.ts`; `npm run typecheck`
- AC14: `node --test test/unit/vault-rekey-gate.test.js`; `grep -n "twelve\|TWELVE" test/unit/vault-rekey-gate.test.js` → only historical-narrative hits
- AC15: `node --test test/unit/vault-copy-boundary.test.js` (or the file the block lands in); `grep -rnE "internal-vault-item-copy|copyItem|copy-plan" src/main/automation/` → no hits
- AC16: read the new section
- AC17: `npm test && npm run typecheck && npm run lint && npm run format:check` (use a timeout; the suite runs ~6-8 s)

## Implementation Guidance

1. **`copy-plan.js`** — `'use strict'` CJS, `// @ts-check`, header comment in the vault modules' style (why it exists, DD refs: "Sortie 04 DD2/DD3"). Requires `canonicalOrigin` (`./browser-import`), `digitsOf` (`./card-identity`), `identityProfileOf` (`./identity-profile`), `SCHEMA` (`../../shared/vault-item-schema`). A local `loginKey(origin, username)` returns `null` when `canonicalOrigin` returns `null` or `'null'`; a `null` key never matches. Export `planCopy`, `allowedFor`, `isIdenticalItem` for the store and tests.
2. **`copyItem` / `_copyItem`** — place directly after `importLogins`/`_importLogins`. Mirror their JSDoc depth (contract, DD refs). Build inputs explicitly:
   - copied / keep-both: `const input = { ...source }; delete input.id; delete input.createdAt; delete input.updatedAt;` (+ `input.title = …(copy)` for keep-both) → `this._normalizeItem(input, undefined)`, push.
   - replace: `this._normalizeItem({ ...source, id: dest.id }, dest.createdAt)`, assign at the destination index.
   - Before the write, re-check the singleton (`identityProfileOf(final).profile` and the written item agree when the written item is an identity, else throw `VaultStateError` with no write).
   - Lazy write: `_writeVaultForKey(vaultId, freshKey, mrk, items)` then `this.vaultKeys.set(vaultId, freshKey)`; existing: `_writeVault(vaultId, { kdf, envelopes, items: vc.encryptItems(items, vaultKey) })`.
   - Return objects per DD1/DD3; `needs-resolution` builds `match` from `metadataOf(destItems[idx])` picking only `id/type/title/username`.
3. **Errors config + handler** — config with a comment explaining why it is its own export; handler placed after `internal-vault-item-delete` with a comment block in the neighbors' style.
4. **Preload + d.ts** — after `vaultItemDelete`.
5. **Tests** — reuse `vault-import-logins.test.js`'s setup helpers style (tmp dir, `FAST_SCRYPT`, `listJars` stub with persistent jars `work`/`personal` and a burner); for zero-write assertions compare the destination file bytes (`fs.readFileSync`) before/after, and `fs.existsSync` for lazy cases. For timestamps inject a clock via the store's `deps.now` (`vault-store.js:951` — `this._now = deps.now ?? Date.now`) rather than mocking timers.
6. **Docs** — as AC16.

## Edge Cases
- **Source item is an identity and the destination has no identity** → `copied` (identity lands; singleton holds).
- **Login with no username** — `username ?? ''` both sides; two username-less logins on the same origin match.
- **Note with empty title** — trimmed `''` equals `''`: two untitled notes match (acceptable; document in the planner comment).
- **Card with no number** — never matches (AC4).
- **`matchMode` absent vs `'exact'`** — settled: absent IS exact (`origin-match.js:73`); normalized in the identical check (AC2). The copied item carries `matchMode` through unchanged.
- **Destination vault exists but is empty** — not lazy; behaves as `new`.
- **The copied item's type is `identity` and resolution `keep-both` sent by a hostile/buggy caller** — `keep-both ∉ allowed` → stale rule → `needs-resolution` (no write), per DD3 step 5.

## Files Affected
- `src/main/vault/copy-plan.js` — new
- `src/main/vault/vault-store.js` — `copyItem` / `_copyItem`, require `copy-plan`
- `src/main/vault/vault-sheet-errors.js` — `VAULT_ITEM_COPY_CONFIG`
- `src/main/register-vault-ipc.js` — new handler, require the config
- `src/preload/internal-preload.js` — `vaultItemCopy`
- `src/renderer/renderer-globals.d.ts` — `vaultItemCopy`
- `test/unit/vault-copy-plan.test.js`, `test/unit/vault-copy-item.test.js`, `test/unit/vault-copy-boundary.test.js` — new
- `test/unit/vault-rekey-gate.test.js`, `test/unit/register-vault-ipc.test.js` — updated pins
- `docs/vault.md` — new section + cross-reference

## Citation Audit
Checked 2026-10-12 against `d16dfb2`: `vault-store.js` `_normalizeItem` 2999-3015, `_saveItem` 3050 (lazy 3056-3064, singleton 3083-3090), `importLogins` 3112 / `_importLogins` 3130, `_resolveTarget` 2870, `_enterGatedOp` 1336, `_now` 951; `register-vault-ipc.js` `catchLocked` 29, item-save 233, item-delete 269, export hand-map 325-338; `vault-sheet-errors.js` `mapVaultSheetError` 71, `VAULT_BROWSER_IMPORT_COMMIT_CONFIG` 125, exports 183; `card-identity.js` exports 117; `identity-profile.js` exports 122; `vault-item-schema.js` exports 117 (`metadataOf` 103); `browser-import.js` exports incl. `canonicalOrigin`, not `identityKey`; `renderer-globals.d.ts` bridge 642, `vaultItemDelete` 784; `vault-rekey-gate.test.js` twelve-op test ≈96-139; `register-vault-ipc.test.js` `CRUD_CHANNELS` 96, channel set 103-117; `browser-import-boundary.test.js` tool count 35. No vanished content. `matchMode` default: the store does not normalize an absent `matchMode`, but every reader treats absent as exact (`origin-match.js:73`, `vault-item-schema.js:111-112`) — AC2 normalizes accordingly (design review correction). `_writeVault` second wall (1157-1165) and `_touch` (1187-1209) need nothing special for a synchronous two-vault read under `_enterGatedOp`. `vault-sheet-errors.test.js` imports named configs only (no closed export set); an optional `VAULT_ITEM_COPY_CONFIG` mapping test is welcome.

---

## Post-Completion Checklist
Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
