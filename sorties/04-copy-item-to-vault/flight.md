# Sortie: Copy a Vault Item to Another Vault

**Status**: in-flight

## Charter

### Outcome
From the vault page, the operator can copy any item into another vault (any persistent jar's or Global) in a couple of clicks, instead of re-typing a credential they need in a second jar.

### Why Now
The same login is often needed in more than one jar (for example, one account used from two containers). Today the only way to get it into a second vault is to re-enter it by hand.

### Success Criteria
- [ ] Every item row has a "Copy to…" action. It lists every vault except the item's own (other persistent jars and Global). The copy keeps every field (password, TOTP, notes, match mode, card and identity secrets), and the source item is untouched. Copying into a jar that has no vault yet creates one.
- [ ] If the destination already has a matching item, nothing is written until the operator picks **Skip / Replace / Keep both**. A match means: login → same origin + username; card → same number; note → same title; identity → any existing identity. If the match is identical, nothing is written and the operator is told it is already there. For an identity only **Replace / Cancel** is offered, because a vault holds one identity.
- [ ] No secret field value (password, TOTP, notes, card number/CVV/expiry, identity secrets, note body) reaches the vault page DOM during a copy. The page sends only ids and the chosen resolution, the copy runs main-side, and the collision step shows only non-secret metadata (type, title, username) — the same fields item rows already show.
- [ ] No MCP tool can start a copy. A copy attempted while locked or during a rotation writes nothing and shows a visible error.

### Constraints
- Keeps existing vault rules intact: one identity per vault on every write path, the rotation lock that blocks writes mid-rotation (`_enterGatedOp`), the full-replace save contract, and loading vault files loudly.
- "Keep both" uses the existing duplicate-marking idiom: a title suffix and a fresh id. The source id is never reused across vaults.
- Copy only. Move is out of scope.
- No new automation surface, and no change to how card and identity fill are matched to sites.

---

## Pre-Flight

### Objective
Add a "Copy to…" action to every typed item row on the `goldfinch://vault` page. The page sends only `{ sourceVaultId, itemId, destVaultId, resolution?, matchId? }` over a new internal channel, `internal-vault-item-copy`. Main reads the source item, plans it against the destination with a pure planner, and either writes the copy (at most once) or returns the match's non-secret metadata so the page can ask **Skip / Replace / Keep both**. Identity items get **Replace / Cancel** only. The page's logic lives in a new injected-deps controller. To make room in `vault.js`, which is at budget, the existing delete-confirm modal moves into that controller too.

### Open Questions
- [x] Collision choices → DD3
- [x] What counts as a match → DD2
- [x] Replace semantics → DD4
- [x] "Keep both" title → DD5
- [x] Several matching items → DD3
- [x] Cross-window refresh → DD9 (not in scope)
- [x] HAT leg → included (leg 3)

### Design Decisions

**DD1 — One gated store op, main-side, two-call protocol**: `VaultStore.copyItem(sourceTarget, itemId, destTarget, opts)` with `opts = { resolution?: 'skip'|'replace'|'keep-both', matchId?: string }`.
- Public wrapper takes `_enterGatedOp()` and releases in `finally`; the body is `_copyItem` (the `importLogins`/`_importLogins` shape). It is the **thirteenth gated op**: `test/unit/vault-rekey-gate.test.js`'s hand list gains a `copyItem` throws-busy line and its "twelve" wording becomes "thirteen".
- Order inside `_copyItem`: (1) pure input-shape checks (strings; `resolution` in the closed set or absent; `matchId` a string or absent); (2) `_requireMrk()`; (3) `_resolveTarget` on BOTH targets (burner/unknown refused, no file created); (4) `sourceVaultId === destVaultId` → `VaultStateError` (same-vault copy refused); (5) `_touch()`; (6) read and decrypt the source; the item must exist and its `type` must be in `ITEM_TYPES` (unknown-type items are refused, and they have no button); (7) read the destination ONCE (absent → lazy, empty items); (8) `planCopy`; (9) act per DD3; (10) **at most one write**, lazy-create via `_writeVaultForKey` + `vaultKeys.set` exactly as `_saveItem` does.
- Returns `{ outcome: 'copied'|'replaced'|'kept-both'|'skipped'|'already-present'|'needs-resolution', match?: MatchMeta, allowed?: string[] }`. `MatchMeta` is non-secret only: `{ id, type, title, username? }`, built from `metadataOf`'s whitelist (vault-item-schema). Never a secret field.
- Rationale: one op keeps the plan and the write in one gated, single-read section, so no TOCTOU between plan and write within a call. The two calls (ask, then commit) are reconciled by DD3's re-plan rule.
- Trade-off: a commit call re-decrypts both vaults; negligible at vault sizes.

**DD2 — Match rule (`planCopy`, pure, main-side CJS)**: new `src/main/vault/copy-plan.js` exports `planCopy(item, destItems)` → `{ kind: 'new' } | { kind: 'identical', matchIds } | { kind: 'match', matchIds }`.
- login: `canonicalOrigin(origin)` (exported from `browser-import.js`) + `username ?? ''`, keyed locally in `copy-plan.js` (`identityKey` is NOT exported and is a trivial concat — inline it rather than widen `browser-import`'s exports). **`canonicalOrigin` returns the STRING `'null'` for opaque origins** (`chrome://`, `data:`, `file:`, `android://` — probed 2026-10-12) and `null` for a non-URL: both never match, on either side. Matrix row required.
- card: `digitsOf(number)` (`card-identity.js`) equal and non-empty.
- note: `title` equal after trim, case-sensitive.
- identity: the destination's `identityProfileOf(destItems).profile` (the FIRST identity) is the one match, so `matchIds` is always length 0 or 1 for identity. Extra identities (reachable via hand-edit or tolerant import paths) are left untouched by every branch.
- **Identical** = same type and every schema field (`nonSecret` ∪ `secret` from `vault-item-schema.js`, plus login `matchMode`) equal, with `undefined`/`''` treated alike. Compare over the schema's fields, never over `Object.keys` (ids/timestamps differ by design). If ANY match is identical → `identical`.
- Only `type`-equal items are candidates.
- Rationale: reuses the browser-import identity rule so "matching" means the same thing in both features.
- Cycle check (Architect probe): `vault-store` → `copy-plan` → {`browser-import`, `card-identity`, `vault-item-schema`, `identity-profile`}; `browser-import` never requires `vault-store`. No cycle.

**DD3 — Resolution semantics** (re-stated after design review 2 as one evaluation order plus an outcome table):
- **Shape check (DD1 step 1, before anything else)**: `resolution` absent or one of `'skip'|'replace'|'keep-both'`; when `resolution` is present, `matchId` must be a non-empty string (the match the operator was shown). Anything else → `VaultStateError`, no write — even if the plan would turn out `new`.
- **`allowed` for a match plan** (returned with `needs-resolution`; the page renders exactly these):
  - exactly one match, non-identity → `['skip','replace','keep-both']`
  - several matches, non-identity → `['skip','keep-both']` (never ask which one to overwrite)
  - identity → `['replace']` (the page renders Cancel as the dismiss, which sends nothing)
- **Evaluation order** after `planCopy`:
  1. plan `identical` → `already-present`, no write, whatever the resolution.
  2. no resolution: plan `new` → `copied`; plan `match` → `needs-resolution` with `match` = meta of `matchIds[0]` and `allowed`. No write.
  3. `skip` → `skipped`, no write, whatever the plan. Skip can never write, so it is never stale.
  4. `replace` / `keep-both`, plan `new` → `copied` (the operator asked for the item to land and nothing collides any more).
  5. `replace` / `keep-both`, plan `match`: **stale** iff `matchId !== matchIds[0]` OR `resolution ∉ allowed` (computed from the CURRENT plan — the payload carries no allowed set) → the fresh `needs-resolution` answer, no write. Otherwise `keep-both` → `kept-both` (DD5), `replace` → `replaced` (DD4).
- **Outcome table** (ask-time plan → commit-time plan × chosen resolution; M1 = one match, Mn = several, ID = identity):

  | Ask → Commit | skip | replace | keep-both |
  |---|---|---|---|
  | any → identical | already-present | already-present | already-present |
  | M1 (A) → new | skipped | copied | copied |
  | M1 (A) → M1 (A) | skipped | replaced | kept-both |
  | M1 (A) → M1 (B) | skipped | needs-resolution | needs-resolution |
  | M1 (A) → Mn (first A) | skipped | needs-resolution (replace ∉ allowed) | kept-both |
  | M1 (A) → Mn (first B) | skipped | needs-resolution | needs-resolution |
  | Mn (A) → M1 (A) | skipped | — (never offered) | kept-both |
  | Mn (A) → new | skipped | — | copied |
  | ID (A) → new | — | copied | — |
  | ID (A) → ID (A) | — | replaced | — |
  | ID (A) → ID (B) | — | needs-resolution | — |

  No cell overwrites an item the operator was not shown, and no cell writes on `skip`. Leg 1 pins every cell as a store test.
- Rationale: the operator decides every overwrite against the item they were shown; declined copies never land.

**DD4 — Replace keeps the destination item's identity**: the destination item keeps its `id` and `createdAt`; every other field comes from the source, wholesale (the M12 F3 full-replace contract): `_normalizeItem({ ...source, id: dest.id }, dest.createdAt)`, swapped in place in the destination array. For identity this is the only write that keeps the singleton rule (`profile.id === normalized.id`). `_copyItem` writes once itself — it does NOT route through `_saveItem` (which would re-read and re-encrypt) — and asserts the singleton invariant on the final array before writing (a `copied` identity can only occur when the destination has zero identities, by `planCopy`'s definition; assert anyway).

**DD5 — Keep both: fresh id, `"(copy)"` suffix**: `title: \`${source.title || '(untitled)'} (copy)\``, fresh id (`_normalizeItem` with no `id`), fresh `createdAt`. The source id is never reused in another vault (also keeps restore's id-identity merge honest). Identity never reaches this branch.

**DD6 — Copied fields and fresh ids**: a plain `copied` lands every field of the source item except `id`/`createdAt`/`updatedAt` (fresh id, fresh timestamps). **`_normalizeItem` spreads `...item` and KEEPS a non-empty `item.id` and `item.createdAt` (`vault-store.js:2999-3015`)**, so `copied` and `keep-both` must build the input with both keys DELETED before normalizing. Test: destination id and `createdAt` differ from the source's — including `password`, `totp`, `notes`, `matchMode`, and all card/identity fields. Any unknown extra field on a stored item is carried as-is (it survives `_saveItem` today too).

**DD7 — Channel, errors and the page contract**: `registerInternalHandler('internal-vault-item-copy', …)` in `register-vault-ipc.js`, async, delegating to `store.copyItem`.
- `VaultLockedError` → `{ locked: true }` (hand-mapped, the async-handler pattern at `register-vault-ipc.js:325-338`).
- Every other error → `{ ok: false, reason }` via `mapVaultSheetError(e, VAULT_ITEM_COPY_CONFIG)` with `VaultBusyError → 'busy'`, `VaultStateError → 'state'`, default `'failed'` (new config beside `VAULT_BROWSER_IMPORT_COMMIT_CONFIG` in `vault-sheet-errors.js`). Success → `{ ok: true, ...result }`.
- The page shows a distinct inline message per reason and per outcome, text-only (M20 rule: no failure without a surface; M18 F2: never collapse `busy` into a generic message).
- Preload `vaultItemCopy(payload)` (bare `ipcRenderer.invoke`), `renderer-globals.d.ts` entry in `GoldfinchInternalBridge`.
- `register-vault-ipc.test.js`: the exact sorted channel set gains `internal-vault-item-copy`, and the channel joins `CRUD_CHANNELS` (forbidden-sender and locked tests). A test pins `VaultLockedError` from `copyItem` → `{ locked: true }`, never an unhandled rejection.
- No step-up: a copy grants no new access (one MRK opens every vault), and `vaultItemSave` has none either.
- Rationale: matches the existing `{locked}` + reason-mapped shape the page already handles for browser import.

**DD8 — Page: new `vault-item-actions-controller.js`, delete-confirm extracted**: `src/renderer/pages/vault-item-actions-controller.js` exports `createItemActionsController(deps)` with injected `{ bridge, dom: { el, iconButton, openModal, appendOption }, copyDestinationOptions, getVaults, getJarRows, getPresence, getRenderEpoch, refresh, setNotice }` — the pure `copyDestinationOptions` is INJECTED by `vault.js` (which already imports `vault-page-model.js`), never statically imported by the controller; `getVaults`/`getJarRows`/`getPresence` are closures over `vault.js`'s reassigned `let`s (`lastViewVaults`, `jarRows`, `jarVaultPresence`), the restore-wiring precedent at `vault.js:125-137` (the `vault-filter-controller.js` shape, so it is unit-testable against a mock DOM). It owns:
- `openDeleteConfirm` (moved verbatim from `vault.js:1376-1408`; it references `el`, `openModal`, `bridge`, `refresh` — construct the controller after those are in scope; TDZ checklist applies). Grep AC: `openDeleteConfirm` appears in `vault.js` only as the `itemActions.openDeleteConfirm` call,
- `openCopyTo({ vaultId, meta })`.
- `vault.js` constructs it and the row builder calls `itemActions.openCopyTo(...)` / `itemActions.openDeleteConfirm(...)`. `vault.js` must end at or below its current count, so `VAULT_PAGE_LINE_BUDGET` is retargeted DOWN to the exact measured Prettier line count (never up, never rounded). Architect estimate: −38 (delete confirm + doc) +~25 (import, construction, row button, render epoch) ≈ −13 — achievable but thin; if it does not net negative, move one more self-contained helper (adaptation criterion).
- New route in `internal-page-map.js`, `internal-page-map.test.js` closed key list, the entry count (AC10 literal sum) AND the controller scan list (textContent-only greps, lines ~16-22) in `vault-browser-import-invariants.test.js`, and `eslint.config.mjs`'s module `sourceType` file list.
- Destination options: a new pure `copyDestinationOptions(vaults, jarRows, presence, sourceVaultId)` in `src/shared/vault-page-model.js` → Global + every persistent jar except the source, label `"Name — N items"` (or "— no vault yet"), built over the jar list (not only existing vaults — squawk 0064 / M18 F3 HAT fix 8). Unit-tested in `vault-page-model.test.js`.
- New icon key (e.g. `copy-to`, a folder-with-arrow glyph) in `ICON_PATHS`; the existing `copy` glyph stays clipboard-only. Button label `Copy ${title} to another vault`. Order in the row: Edit, Copy to…, Delete.
- Rows from `renderUnknownItems` get no Copy button.

**DD9 — Modal flow and refresh**: one `openModal` per step, single submit.
- Step 1 "Copy *title* to…": a `<select>` of destinations; submit "Copy". No destination available (no other vault and no jars) → the button still opens, shows "There is no other vault to copy to." with submit disabled.
- On `needs-resolution`: the controller opens step 2 in place (a new `openModal` call, which closes step 1) "*Destination* already has *match title*": radios over `allowed` (Skip default-selected for non-identity; identity shows a single Replace option with copy "Replace the existing identity profile"), submit label follows the selection. Replace warns in text that the existing item's fields are overwritten.
- Terminal outcomes close the modal, set the page notice via `setNotice` (the `pendingNotice` contract: set BEFORE `refresh()`, shown once by the next `render()`, `vault.js:416-423`, `2037-2042`), then call `refresh()`. Copy (text-only) such as "Copied to Work.", "Already in Work — nothing copied.", "Skipped — nothing copied.", "Replaced *title* in Work.", "Copied to Work as *title (copy)*." An interleaved lock-push `refresh()` may consume the notice first — accepted (the lock state is the more important thing to show).
- Errors stay in the open modal via `setStatus` (`busy`: "A vault rotation is in progress — try again when it finishes."; `state`: "This item could not be copied to that vault."; `failed`: "Copy failed."). `{locked}` → `refresh()` (the lock push closes every modal anyway).
- Lock while a copy modal is open: closed by the existing `render()` → `closeActivePageModal()` path, which deliberately skips `onCancel` — so the controller cannot learn of the close from the modal handle. **Mechanism: a render epoch.** `vault.js` increments a counter at the top of `render()` and injects `getRenderEpoch`; the controller captures it at open and, when an invoke resolves after the epoch moved, drops all modal UI (no step-2 modal, no `setStatus`) — but if the result is a terminal ok outcome that WROTE (`copied`/`replaced`/`kept-both`) it still calls `setNotice(...)` then `refresh()`, so a landed write always has a surface (M20). `needs-resolution`, `skipped`, `already-present` and `ok:false` are dropped silently (nothing was written; the modal they belonged to is gone). Only genuine refreshes bump the epoch (`render()`'s sole caller is `refresh()`; the filter and nav controllers never call it — review 2 grep). Tests: epoch moved between invoke and resolve × {terminal-written, `needs-resolution`, `{locked}`, `ok:false`}. `openModal` is NOT changed. The main-side op is synchronous, so a lock cannot interleave inside it; it can only land between the page's `await` and its continuation, which the epoch covers. A `{locked}` result is handled by calling `refresh()` (idempotent with the lock push).
- **Focus across steps**: `openModal` runs `closeActivePageModal()` FIRST, whose `close()` restores focus to step 1's invoker (the row's Copy-to button), and only then captures `document.activeElement` (`vault.js:437-442`) — so step 2's invoker is already the row button. The controller additionally re-focuses the row button (passed to `openCopyTo`, guarded by `isConnected`) before opening step 2, as a belt-and-braces no-op; if a refresh detached the row, focus falls to `<body>` — accepted (the modal is gone too). No `openModal` change. Test: closing step 2 returns focus to the row button.
- **Page caches**: the destination `<select>` is built from `lastViewVaults`/`jarRows`/`jarVaultPresence`, refreshed on every `refresh()` — max staleness is "last refresh" (another window may have changed them). The select is advisory; main is authoritative (`_resolveTarget` + lazy creation): a jar deleted since refresh → `state`; `hasVault` stale-false while the file now exists → the copy plans against the real file. Labels ("— N items" / "— no vault yet") may be stale and are never asserted as fact. The post-copy `refresh()` invalidates them.
- **Store cache**: `vaultKeys` is consulted only via `_vaultKeyFromDoc` after `_readVault` returns a doc; a lazy destination (`doc === null`) always mints a fresh key and overwrites any stale cache entry (`_saveItem` precedent, `vault-store.js:3056-3064`). `_copyItem` never zeroizes a cached key (cache-owned). Test: a stale `vaultKeys` entry for a jar with no file → the copy creates the vault with a fresh key and the entry is replaced.
- **Shared-mechanism ACs (CLAUDE.md planning rule)**: the copy flow uses `openModal`, `refresh()/render()` and the page notice. Existing users that must stay unaffected: the item editor (its `editorCleanups` drain), delete confirm (moved), access-key revoke confirm, browser import modals, restore modals, the page notice's existing users (export-raced-lock), `render()` (now bumps the epoch — no other reader), and the vault filter (a refresh after a copy resets the filter exactly as save/delete already do — documented, not changed).
- Cross-window: no new broadcast. Another window showing the destination vault is stale until its next refresh, exactly as after save/delete today (logged as a follow-up candidate, not in scope).

**DD10 — Automation boundary**: no MCP tool is added; a new boundary pin (alongside `browser-import-boundary.test.js`) asserts `src/main/automation/**` contains no reference to `internal-vault-item-copy`/`copyItem`, and the tool count stays 35. Admin-tier `evaluate` on the vault page can reach `goldfinchInternal.vaultItemCopy`, exactly as it already reaches `vaultItemSave`/`vaultItemDelete` — accepted (admin already holds an MRK-equivalent). Jar keys cannot resolve internal pages.

**DD11 — Behavior-test apparatus**: spec `vault-copy-item`, hybrid witnessed like `vault-filter`. **Apparatus launch (operator ruling 2026-10-12): Goldfinch dev mode, not the registered `goldfinch-dev` MCP server.** Launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (WSLg: append `-- --disable-gpu --ozone-platform=x11` if needed), capture the one `AUTOMATION_DEV_MINT {"key":…,"adminKey":…}` stdout line, export `GOLDFINCH_MCP_ADMIN_KEY=<adminKey>`, and drive the app through env-key scripts on `scripts/lib/mcp-client.mjs` → `connectAutomation()` (the script-harness consumer model in `docs/dev-testing.md` → *Key capture* / *Attaching a consumer*), re-capturing the key on every launch. The dev profile is isolated from the installed app's, so the vault under test is the DEV profile's vault (set up once there with a throwaway master password) — never the operator's real vault. **Act**: admin-tier MCP `click`/`evaluate` on the `goldfinch://vault` tab (item rows, modal controls); unlock is an operator step (the `vault-unlock` sheet is not automatable). **Observe**: `readDom`/`readAxTree` on the vault tab for rows, modal text, notices and the "no secret in the DOM" check (search the serialized DOM for seeded marker values); destination contents read by re-listing via `evaluate` → `goldfinchInternal.vaultList(destId)` (metadata only). Secret-field equality is checked by an `evaluate` script that calls `vaultReveal` for the source and destination items and returns only a boolean or a SHA-256 digest per field (`crypto.subtle`), so no secret value reaches the agent transcript or run log. Seeded values are throwaway `cq9marker` markers regardless. The stale-commit rule (DD3) cannot be produced through the UI, so one step drives it by calling `vaultItemCopy` directly via `evaluate` with a stale `matchId`. Premise to verify at planning: admin `click` lands on internal-page controls (vault-filter's run did this).

### Prerequisites
- [ ] Dev mode launchable with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, the `AUTOMATION_DEV_MINT` admin key captured, and a `connectAutomation()` script attaching (DD11). Used by leg 2's smoke step and the behavior test; the registered `goldfinch-dev` MCP server is NOT the apparatus (operator ruling 2026-10-12), so its connection failure in this planning session is not a blocker. Re-verify the dev-mode attach at the start of leg 2.
- [ ] Dev profile's vault set up (throwaway master password) with two persistent jars, one with no vault file yet (behavior spec preconditions)
- [x] `VAULT_PAGE_LINE_BUDGET` at 2153 / `vault.js` 2152 lines (recon 2026-10-12) — leg 2 extracts
- [x] Gated-op hand list at twelve (`vault-rekey-gate.test.js`)
- [x] MCP tool count 35 (`automation-mcp-server.test.js:39`)

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified (dev-mode attach re-verified at leg 2 start)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach
Leg 1 builds and pins the main-side contract (planner, store op, channel, preload, typing, docs). Leg 2 builds the page against that contract, moving delete-confirm into the new controller to pay for the row wiring. Leg 3 walks the flow with the operator.

### Checkpoints
- [x] `copyItem` lands every outcome branch with exactly-one-or-zero writes, including lazy destination creation and the stale-commit rule
- [x] Channel registered, reason-mapped, pinned in the channel-set and boundary tests
- [ ] Copy-to modal flow working on the real page; `vault.js` at or under its prior line count
- [ ] Behavior test `vault-copy-item` passes; HAT accepted

### Adaptation Criteria

**Divert if**:
- The extraction cannot bring `vault.js` to or below its current count without touching unrelated behavior
- The two-call protocol proves unable to keep secrets off the page (for example, the page would need a field value to render the collision step)

**Acceptable variations**:
- Exact modal/notice copy (settled at HAT)
- The icon glyph
- Which additional small helper moves out of `vault.js` alongside delete-confirm

### Legs

- [x] `copy-item-store-and-ipc` — `copy-plan.js` (`planCopy`), `VaultStore.copyItem` (13th gated op), `internal-vault-item-copy` + `VAULT_ITEM_COPY_CONFIG`, preload + d.ts, unit tests (planner matrix per type; every DD3 branch through the stateful store incl. lazy destination, stale commit, identity singleton, burner/same-vault/locked/busy refusals, unknown-field carry, zero-write cases, opaque-origin and multi-identity rows, id/createdAt freshness, stale `vaultKeys`), a composition test with the real store on disk + the real `registerVaultIpc` handler (lazy destination, collision, commit), channel-set/CRUD-list/rekey-gate (sync group, "thirteen")/boundary pins, `docs/vault.md` "Copying an item to another vault" under Portability
- [x] `copy-to-ui` — `vault-item-actions-controller.js` (delete-confirm moved + copy-to flow), `copyDestinationOptions` in `vault-page-model.js`, `copy-to` icon, row wiring, page-map/eslint/invariant-count updates, `VAULT_PAGE_LINE_BUDGET` retargeted down, controller + model unit tests (mock DOM), shared-mechanism non-regression ACs (DD9), render-epoch and focus-across-steps tests, a live smoke test exercising every existing apparatus primitive (census, windows, capture, readDom/readAxTree, evaluate) against the new page state, behavior spec `vault-copy-item` finalized against the shipped DOM
- [ ] `hat-and-alignment` *(optional)* — guided HAT on the real app: copy each item type, each collision choice, identity Replace/Cancel, copy into a jar with no vault yet, lock mid-modal, a second window open on the destination

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`)
- [ ] Documentation updated (`docs/vault.md`; CLAUDE.md vault section gains a one-line pointer if the op adds an invariant worth carrying)

### Verification
- Unit: the leg-1 and leg-2 suites named above.
- Behavior: `/mission-control:behavior-test vault-copy-item` (spec `tests/behavior/vault-copy-item.md`).
- HAT: leg 3 with the operator.
