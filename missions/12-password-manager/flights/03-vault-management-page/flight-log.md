# Flight Log: Vault Management Page

**Flight**: [Vault Management Page](flight.md)

## Summary

Flight 3 of Mission 12 (Built-in Password Manager) — `goldfinch://vault` trusted internal
management page. Split from the original F3 "management surface + portability" (operator-approved
2026-07-20); portability + key rotation + hardening + docs moved to F4, HAT to F5.

Status: **landed** — all 5 legs completed; whole-diff flight-end review passed
(`[HANDOFF:confirmed]`, no blocking; two trivial NB cleanups applied — gitignored stray test-capture
files, fixed an a11y comment count); `npm test` **2522/2522**, typecheck + lint clean. Committed +
draft PR. `npm run a11y` (four new sheet states) is a live-GUI step deferred to F5-HAT (DD9). Debrief
next (the go/no-go before F4).

**Branch**: `flight/03-vault-management-page`, **stacked on `flight/02-...`** (F1+F2 both unmerged;
F3 builds on F2's sheet family + F1's store primitives). Rebases onto main once F1/F2 merge.

---

## Reconnaissance Report

F3 sources carried-forward items from the F1 + F2 debriefs and mission Known Issues; two
code-interrogation sweeps walked them against the current tree (branch
`flight/02-human-fill-trust-boundary`).

**Internal-page infra (settings/downloads/jars precedent):** the four gates key on
`wc.session.__goldfinchInternal` (session identity). `goldfinch://vault` is net-new but needs **no
new gate code** — add to `INTERNAL_HOSTS` (`url-safety.js:84`) + `INTERNAL_ORIGINS` (`internal-ipc.js:25`
and `internal-preload.js:24`) + `internal-page-map.js` + `vault.{html,css,js}` + a `register-vault-ipc.js`
(mirroring `register-settings-ipc.js`) + `internal-preload` bridge + `openVaultPage()` trusted-createTab
entry. Strict CSP is header-stamped (`main.js:172`). **a11y cannot `--target` the internal page** (the
MCP `evaluate` tool excludes the internal session even for admin) — it rides a new chrome-state hook in
`a11y-audit.mjs` (DD9). **Jar wipe already spares the vault** (`jar-data-lifecycle.js` touches only
session/history/cookies); vault-removal hooks into jar **delete** (`jar-registry-ipc.js:handleRemove`)
with export-first — **both moved to F4** (coupled to export).

**Vault management API — exists vs net-new** (recon Part A): **already built (F1, unwired)** —
`setup`, `changeMasterPassword`, `mintAccessKey` (step-up), `revokeAccessKey`, `listItems`, `saveItem`,
`parseOtpauth`, `totp`, `listEnvelopeKeyIds`, the recovery/access/admin generators, `serializeVault`/
`parseVault`, `vaultAutoLockMinutes`. **Net-new for F3** — delete-item op, single-item reveal op,
list-access-keys op, password generator, and all the IPC + page UI. (Export/import, rotation,
master-pw-change surface → F4.)

**Carry-forward classification (recon Part B):**
| Item | Status | F3? |
|------|--------|-----|
| `saveItem` merge-on-update | confirmed-live (still full-replace; only F2 capture merges) | **F3 — via DD3**: the editor is full-item (replace correct); document the contract, mandate merge for partial callers |
| reserved-id SSOT guard | partially-satisfied (two independent `'global'` literals, no shared constant / cross-module test) | **F3 — DD8** |
| audit-origin fix | confirmed-live (`deriveAuditDetail` args-only) | F4 |
| registrable-domain PSL opt-in | confirmed-live/absent (exact-origin only) | F4 |
| first-run setup UI | confirmed-live (`setup()` unwired) | **F3 — DD5** |

---

## Leg Progress

### vault-page-infra
**Status**: landed
**Risk tier**: **HIGH** — a new trusted internal page + `registerInternalHandler` IPC surface
(trust-boundary infra) + the reserved-id SSOT refactor. Ran the per-leg design review.

**Design review (1 cycle, approve with changes)** — four-gate recipe confirmed complete/correct
against the tree; locked-state renders labels (`'global' + jars.list()`, no MRK), counts need the MRK.
Incorporated: **[MED]** `internal-vault-state` injects `jars` (no public vault-enumeration method) +
**defer item counts to leg 2** (labels only in leg 1); **[MED] moved the DD5 template refactor to
leg 4** — the card builders are already factored, the remaining ~300 lines are F2 sheet-*controller*
wiring best refactored where leg 4's new sheet kinds + the a11y/HAT guards land (the picker is roving,
won't fold onto the dialog helper anyway); **[MED]** the locked-state unlock affordance is **stubbed**
in leg 1 (an internal page can't call chrome-trust `menuOverlay.*`; the request-unlock path lands in
leg 4); **[LOW-MED]** the reserved-id SSOT lives in a **standalone `src/shared/reserved-ids.js`**, not
`jars.js` (which `require`s `app-db` and would break `vault-store`'s Electron-free purity); **[LOW]**
citation drift + JSDoc host-list. Also flagged for leg 2+: the vault page inherits the whole
`goldfinchInternal` bridge and renders attacker-influenced strings → `textContent`-only + CSP are
load-bearing. Reviewer-specified fixes → no second cycle; flight-end Reviewer backstops.

**Implementation (2026-07-21)** — landed to ACs. All 5 ACs + post-completion checklist checked off.

Files changed:
- `src/shared/reserved-ids.js` (NEW) — DD8 SSOT: exports the `'global'` sentinel (`GLOBAL_ID`), dependency-free plain CJS.
- `src/main/vault/vault-store.js` — consume `GLOBAL_ID` from reserved-ids; export it (for the cross-module test). No behavior change.
- `src/main/jars.js` — `isReservedId` consumes the shared `GLOBAL_ID` (was a literal `'global'`). No behavior change.
- `src/shared/url-safety.js` — add `'vault'` to `INTERNAL_HOSTS`.
- `src/main/internal-ipc.js` — add `'goldfinch://vault'` to `INTERNAL_ORIGINS`.
- `src/preload/internal-preload.js` — add `'goldfinch://vault'` origin + the `vaultState()` bridge wrapper.
- `src/main/internal-page-map.js` — add the `vault:` route (`/`, `/vault.css`, `/vault.js`, `/vault-page-model.js`).
- `src/shared/vault-page-model.js` (NEW) — pure `selectVaultView()` three-state selector (unit-tested; no DOM).
- `src/renderer/pages/vault.html` / `vault.css` / `vault.js` (NEW) — trusted internal-page shell (module script), renders not-set-up/locked/unlocked from `vaultState()`, `textContent`-only, setup+unlock affordances stubbed (markers `data-setup-requested`/`data-unlock-requested`).
- `src/main/register-vault-ipc.js` (NEW) — `internal-vault-state` via `registerInternalHandler`; injects `getVaultStore` accessor + `jars`; composes `'global' + jars.list()`, labels only.
- `src/main/main.js` — require + wire `registerVaultIpc({ ipcMain, registerInternalHandler, getVaultStore, jars })` at the `registerSettingsIpc` composition site.
- `src/renderer/chrome/overlay-menus.js` — `openVaultPage()` (trusted `createTab`) + kebab model item `{ id:'vault', label:'Passwords' }`.
- `src/renderer/renderer.js` — `openVaultPage()` delegate, `kebabActionVault`, `KEBAB_ACTIONS.vault`, APG kebab count comment (six→seven).
- `src/renderer/renderer-globals.d.ts` — `vaultState()` type on `GoldfinchInternalBridge` + JSDoc host-list updated to include vault.
- `eslint.config.mjs` — bind `reserved-ids.js` commonjs (src/main block + src/shared ignores, the CJS-quartet pattern); add `vault.js` to the renderer module-sourceType list.
- Tests (NEW): `register-vault-ipc.test.js` (shape/labels-only/no-secret/reserved-global-dedup + real-guard non-internal rejection), `reserved-ids.test.js` (cross-module SSOT), `vault-page-model.test.js` (three states, pure), `vault-page-shared-scripts.test.js` (flat-import route/module/defer contract).
- Tests (contract-shape updates, expected for adding a page/menu item): `internal-page-map.test.js` (host set + vault entries), `overlay-menus.test.js` (kebab id list).

Results: `npm test` **2410 pass / 0 fail** (13 suites); `npm run typecheck` clean; `npm run lint` clean. All pre-existing vault-store/jars tests pass unmodified (the reserved-id refactor is value-preserving — the constant's home moved, `'global'` unchanged).

Deviations from the leg spec:
- **Two pre-existing contract tests updated** (not additive): `internal-page-map.test.js` pins the exact internal-host set + entries, and `overlay-menus.test.js` pins the exact kebab id list — both MUST reflect the new page/menu item (the "script-contract test" seam point; the same updates downloads/jars required). No behavior semantics changed, only expected-value lists extended.
- **`eslint.config.mjs` edited** (not in the leg's Files Affected): unavoidable consequence of "plain CJS in `src/shared/`" (reserved-ids.js binds commonjs) and "vault.js is a module" (added to the module-sourceType files list) — the established quartet / jars-page patterns.
- **`getVaultStore` injected as an accessor** (not the eagerly-constructed singleton) into `registerVaultIpc`, so the top-level composition never forces store construction at module load and the handler reads live setup/lock state. Faithful to main.js's dominant `getVaultStore()` idiom.

**For leg 2 (`item-management`):**
- `register-vault-ipc.js` is the home for all future vault handlers. Signature: `{ ipcMain, registerInternalHandler, getVaultStore, jars }`. Resolve the store per-call via `getVaultStore()`. The metadata-only all-types list op (DD10) goes here; register every new channel via `registerInternalHandler` (a non-internal sender must throw `forbidden` — mirror the register-vault-ipc.test.js real-guard test).
- Page render path: `vault.js` (module) imports `./vault-page-model.js` (flat specifier — needs an `internal-page-map.js` `vault` route entry + `// @ts-ignore` on the import). Rendering is **`textContent`-only, never `innerHTML`** — leg 2 renders attacker-influenced item strings, so keep the discipline. All DOM built via the `el(tag, className, text)` helper. Bridge calls guarded by `if (!window.goldfinchInternal) return;`.
- New pure page-logic (item-list/editor state) should factor into `src/shared/` modules (like `vault-page-model.js`) for unit tests — there is NO DOM lib, so page a11y/DOM correctness rests on pure-model unit tests + the F5 HAT (DD9).
- `internal-vault-state` shape: `{ setUp, unlocked, vaults: [{ vaultId, label }] }`. The global vault is `vaultId:'global'` (from the shared `GLOBAL_ID`), label `'Global'`; jars follow as `{ vaultId: jar.id, label: jar.name }`. Item counts (need the MRK) were deferred to leg 2 — extend the state op or add a metadata op.
- Live lock-state freshness: leg 1 renders once on load (no `vault-lock-state` subscription on the internal bridge yet). If leg 2 needs the page to react to lock/unlock while open, add an `onVaultLockState`/`offVaultLockState` internal-bridge pair (the listener-handle pattern) — the main-side `vault-lock-state` broadcast already exists (`broadcastVaultLockState`).
- Setup + unlock affordances are stubs (markers) in leg 1; their real chrome-owned-sheet flows land in leg 4.

---

## Decisions

### Flight Director Notes — design phase

Designed F3 as the **management-page** half of the split. Key design call flagged for the Architect
review: **DD5 — where the master password is entered** (setup + step-up mint). Provisional: route
through F2's chrome-owned sheet family (uphold the "master password only in chrome-owned UI"
invariant + reuse F2's zeroized-Buffer channel), with the vault page orchestrating + showing the
recovery key once. The review should confirm this or relax it (a trusted internal page may be an
acceptable surface, which would simplify the flows into the page). **DD3** corrects the F2-debrief
"make saveItem merge-aware" to the more accurate "full-item editor uses replace (lossless + allows
field-clearing); *partial*-update callers merge" — a blind always-merge would break field removal.

---

## Session Notes

- **2026-07-20** — Mission F3 split approved; F3 = vault management page. Spec drafted (DD1–DD9,
  4 legs).
- **2026-07-20** — **Architect design review (1 cycle, approve with changes).** Four-gate recipe
  confirmed complete/correct; primitives present. Incorporated: **DD5 ruled sheet-only** (page renders
  user-controlled content = DOM-injection surface; TCB-minimization) **+ recovery-key display moved to
  the sheet** (master-equivalent) + template-registry refactor folded into leg 1; **[HIGH] DD9 a11y
  premise corrected** — the internal-session *page* cannot be axe-audited even by admin (op-local
  `isInternalContents` refusal, `observe.js:43-44`), so only the new *sheet* states are auditable and
  the mission's "page passes `npm run a11y`" is not literally achievable (pre-existing settings-class
  gap — operator go/no-go); **[high/med] added DD10** metadata-only all-types list op (else the item
  list ships plaintext into the page DOM); **[med] DD3↔DD6 editor reconciled** (editor loads metadata,
  secrets only on explicit reveal, unchanged-secret sentinel on save); **[med] leg 4 split** into
  `first-run-setup` + `access-keys-autolock` (each a security gate) → **5 legs**; **[low]** added the
  `renderer-globals.d.ts` step to leg 1. Two operator-facing items surfaced for approval: the DD5
  interpretation (recorded) and the DD9 a11y-gap acceptance. **Awaiting operator approval to execute.**

### item-management
**Status**: landed
**Risk tier**: **HIGH** — single-item secret reveal, the unchanged-secret (DD3/DD6) save contract, and the page rendering attacker-influenced item strings (XSS surface). Ran the per-leg design review.

**Design review (1 cycle, approve with changes)** — verified `saveItem` is genuinely full-replace (merge needed), `_requireMrk`→`VaultLockedError`, all ops net-new. Incorporated several HIGH corrections: **[HIGH]** metadata projection must be a **positive whitelist**, not a name-blacklist (the note body is `body`, not `note` — a blacklist would leak it; login `notes` holds secrets per the capture test); **[HIGH]** the card/note item **schema doesn't exist yet** — this leg defines it and single-sources a canonical secret-field-per-type map (`src/shared/vault-item-schema.js`) that both the projection (exclude) and the save-merge (preserve) consume as complements; **[HIGH]** the preserve set = the **complement** of the metadata whitelist (else editing a title drops `notes`/`body` — the F2 data-loss class); **[HIGH→MED]** replaced the in-band `SECRET_UNCHANGED` magic string with an **out-of-band `{item, unchangedSecrets:[...]}`** signal + a `saveItemPreservingSecrets` **store method** + a create-defense; **[MED]** locked handlers return structured `{locked:true}` (a thrown error only serializes to a string); **[MED]** `internal-vault-state` counts `isUnlocked`-guarded (keep the locked read non-throwing); **[MED]** added a revealed-secret **DOM-hygiene** AC (clear on hide/blur/save); **[LOW]** origin-link http/https scheme guard; citation drift. Reviewer-specified → no second cycle; flight-end Reviewer backstops.

**Implementation (2026-07-21)** — landed to ACs. All 9 ACs + post-completion checklist checked off.

Files changed:
- `src/shared/vault-item-schema.js` (NEW) — the secret/non-secret SSOT. Per-type `{nonSecret,secret}` maps (login/card/note) + `metadataOf(item)` (POSITIVE whitelist → id/type/hasTotp + non-secret fields; reads no secret value) + `secretFieldsFor`/`nonSecretFieldsFor`. Plain CJS (reserved-ids precedent — main-only, no require(esm) at boot).
- `src/main/vault/vault-store.js` — requires the schema; adds `listItemsMeta` (metadata via `metadataOf`, +`vaultId`), `revealItem` (single-item full, id-scoped), `deleteItem` (filter + atomic write, false on missing), `saveItemPreservingSecrets` (validate `unchanged ⊆ secretFieldsFor`, pull unchanged from existing, create-defense throw, then `saveItem`); extends `saveItem`'s JSDoc with the DD3 full-replace contract. No change to `saveItem` behavior.
- `src/main/register-vault-ipc.js` — four `registerInternalHandler`-gated handlers (`internal-vault-list`/`-reveal`/`-item-save`/`-item-delete`) each wrapped by a `catchLocked` helper → structured `{locked:true}` (save returns `metadataOf(saved)`, never a secret); `internal-vault-state` gains per-vault `count` guarded on `isUnlocked()` (per-vault try/catch keeps it non-throwing).
- `src/shared/vault-editor-model.js` (NEW, ESM) — pure page logic: per-type editor field LAYOUT (presentation), `assembleSave` (unchanged-secret assembly), the mask/reveal/edit/hide state reducers (clear-on-hide), `initialSecretStates`, and `safeHttpUrl` (http/https origin-link guard). Pinned to the schema by a consistency test.
- `src/renderer/pages/vault.js` — unlocked state now renders a per-vault metadata item list (`textContent`-only) + add-item picker + a full-item editor (masked secrets, per-field Reveal/Hide + Copy via `clipboardWrite`, save assembles `{item,unchangedSecrets}`, delete). Origin rendered as an http/https-guarded link outside the open button. Clears secret inputs on save/cancel; blur clears pure reveals.
- `src/renderer/pages/vault.css` — item-list + editor styling.
- `src/preload/internal-preload.js` — `vaultList`/`vaultReveal`/`vaultItemSave`/`vaultItemDelete` bridge wrappers; `vaultState` type note updated for `count`.
- `src/renderer/renderer-globals.d.ts` — the four new bridge method types + a `VaultItemMeta` interface; `vaultState` count.
- `src/main/internal-page-map.js` — `/vault-editor-model.js` flat route.
- `eslint.config.mjs` — bind `vault-item-schema.js` commonjs (src/main files list + src/shared ignores — the reserved-ids CJS-carve-out pattern).
- Tests (NEW): `vault-item-schema.test.js` (complement invariant, metadataOf no-secret/positive-whitelist), `vault-item-management.test.js` (listItemsMeta no-secret all types, revealItem id-scope, deleteItem, saveItemPreservingSecrets all-three-type round-trip + create-defense + unchanged⊆secret guard + locked), `vault-editor-model.test.js` (assembleSave unchanged/clear/edit, reveal-not-touched, clear-on-hide, safeHttpUrl, schema-consistency pin).
- Tests (extended): `register-vault-ipc.test.js` (four CRUD handlers: non-internal rejection, locked→{locked:true}, save preserves password+notes/body, explicit clear, reveal single-id, delete; the leg-1 state test extended for `isUnlocked`-guarded counts + the handler-list contract). `vault-page-shared-scripts.test.js` + `internal-page-map.test.js` (the `/vault-editor-model.js` route — the script-contract seam). `vault-capture.test.js` UNCHANGED (the F2 read-merge re-assert at `:258` still passes).

Results: `npm test` **2445 pass / 0 fail** (13 suites); `npm run typecheck` clean; `npm run lint` clean. Pre-existing tests pass unmodified except the two exact-contract pins (internal-page-map host/route list + register-vault-ipc handler list + state-count expectation) — expected contract updates, no assertion weakened.

Deviations from the leg spec:
- **Schema kept main-only CJS; the page's field taxonomy lives in the ESM `vault-editor-model.js`, pinned to the schema by a consistency test** (the reserved-ids DD8 pattern). The leg named "BOTH the metadata projection and the save-merge import this" — both are store methods (main-side), which the CJS schema single-sources exactly. The page can't import a CJS `module.exports` file as a browser ES module, and requiring an ESM schema from main-side `vault-store` at app boot would mean a `require(esm)` on a security-critical path I can't verify inside Electron here (the "boot defect `npm test` can't catch" class) — so the security projection/merge stay single-sourced in CJS, and the page presentation layout is drift-guarded by test rather than shared-imported. No secret can leak from a page/schema drift: main's `metadataOf` is authoritative and the page only ever receives a secret on an explicit per-field `revealItem`.
- **Two exact-contract test pins updated** (not additive): `internal-page-map.test.js` (route list) and `register-vault-ipc.test.js` (handler list + state shape) — the same script-contract seam leg 1 touched.

**For leg 3 (`totp-and-generator`):**
- **Schema module**: `src/shared/vault-item-schema.js` (CJS) is the secret/non-secret SSOT — TOTP is a `login` **secret** field (`totp`). If the generator/TOTP editor adds a field, add it to BOTH the schema (security) AND `vault-editor-model.js`'s `EDITOR_LAYOUT` (presentation) — the consistency test in `vault-editor-model.test.js` enforces they match.
- **Editor shape**: `vault.js`'s `openEditor` builds non-secret + secret fields from `EDITOR_LAYOUT[type]`; secret fields are masked with per-field Reveal/Copy for existing items and marked touched-on-edit. TOTP live display (DD4, main-computed code + countdown) is a NEW read — the seed stays a normal secret field (revealed only on the explicit reveal path); the live code needs a new `internal-vault-totp-code(itemId)` handler + bridge wrapper (register in `register-vault-ipc.js`, wrap with `catchLocked`). The generator (DD7, pure `password-generator.js`) is offered in the editor's password field — a new `src/shared/` ESM module + its `internal-page-map.js` route + the shared-scripts test entry.
- **Reveal/DOM hygiene**: revealed secrets are cleared from the DOM on hide/blur/save (the `revealing` guard prevents a programmatic reveal from being read as a user edit; `wipeSecretInputs` on save/cancel). A live TOTP code display is derived (code, not seed) so it does not need the same masking, but keep the seed on the reveal path.
- **Locked routing**: every new handler must `catchLocked` → `{locked:true}`; the page's `.then(res => { if (res.locked) refresh(); ... })` idiom routes a mid-session idle-lock back to the (leg-4) unlock path.
- **`internal-vault-state`** now returns `count` per vault when unlocked (omitted when locked) — leg-1's deferred item counts, done.

### totp-and-generator
**Status**: landed
**Risk tier**: **HIGH** — TOTP 2FA-secret handling (enrollment normalization of untrusted otpauth input; live-code IPC that must return code+countdown only, never the seed). Runs the per-leg design review. The generator is pure/low-risk but rides along.

**Design review (1 cycle, approve with changes)** — two HIGH must-fixes on the TOTP path: **[HIGH]**
storing a structured totp object would break F1's automation `vaultTotp` read (the sole value-reader,
`vault-context.js:248` `parseOtpauth(item.totp)`, expects a string) → **store the canonical
`otpauth://` URI string** instead (zero reader changes, legacy items keep working, `parseOtpauth`
round-trips everywhere); **[HIGH]** `parseOtpauth` doesn't range-check — `period=0` crashes `totp()`
(÷0) and the automation read → `normalizeTotpField` range-validates (`period≥1`, `digits∈{6,7,8}`,
`algorithm∈{SHA1,256,512}`) and throws, hardening F1's path too. **[MED]** generator source =
`globalThis.crypto.getRandomValues` (works in the sandboxed page AND `node --test`), unbiased
Fisher-Yates, length<class-count + all-off rejected. Adopted the per-period-poll + local-countdown
suggestion (`revealItem` decrypts the whole vault per call — per-period beats per-second). Added a
compat test (F1 `vaultTotp` still returns a code for a newly-enrolled item) + the `password-generator.js`
page-map route; reconciled the leg's MED label → HIGH. Reviewer-specified → no second cycle.

**Implementation (2026-07-21)** — landed to ACs. All 5 ACs + post-completion checklist checked off.

Files changed:
- `src/shared/password-generator.js` (NEW, ESM) — pure `generatePassword({length,lower,upper,digits,symbols})`; `globalThis.crypto.getRandomValues` rejection-sampled index draw (no modulo bias) + unbiased Fisher-Yates; ≥1 char/enabled class, none from disabled; defaults length 20 / all classes; rejects `length<class-count` and all-off. No DOM/Electron.
- `src/main/vault/vault-crypto.js` — `normalizeTotpField(raw)` (`parseOtpauth` → range-validate `period≥1`/`digits∈{6,7,8}`/`algorithm∈{SHA1,256,512}` → re-serialize to a canonical `otpauth://totp/…` STRING that round-trips `parseOtpauth`; throws `VaultFormatError` on malformed/out-of-range) + `totpSecondsRemaining(period, nowMs)` (the pure countdown math, always `[1,period]`); both exported. `parseOtpauth`/`totp` unchanged.
- `src/main/register-vault-ipc.js` — enroll normalization in `internal-vault-item-save` (via `normalizeTotpForSave` helper: normalize `totp` only when present AND not in `unchangedSecrets`) + net-new `internal-vault-totp-code` handler (`catchLocked`: MRK-gated `revealItem` → `{ code, secondsRemaining }` only, `{ code:null }` no-totp; the seed never crosses).
- `src/preload/internal-preload.js` + `src/renderer/renderer-globals.d.ts` — `vaultTotpCode(payload)` bridge wrapper + its type.
- `src/main/internal-page-map.js` — `/password-generator.js` flat route in the `vault:` block.
- `src/renderer/pages/vault.js` — editor totp field gains a live code widget (fetch `vaultTotpCode` once, count down LOCALLY per second, re-fetch on the period boundary, stop on hide/blur, `textContent`-only) + an editor-cleanup registry (drained by openEditor/closeEditor/render so widget timers/listeners never outlive the editor); password field gains a Generate control (length + per-class toggles → `generatePassword`, sets the value + marks it touched).
- `src/renderer/pages/vault.css` — generator + live-TOTP-widget styling.
- Tests (NEW): `password-generator.test.js` (length/each-class/disabled-absent/min-length/unbiased smoke + position/`getRandomValues` spy/reject length<classes + all-off + bad length); `vault-totp-normalize.test.js` (otpauth + bare-base32 normalize + round-trip, garbage throws, `period=0`/`digits=99`/bad-algorithm throw, boundary values accepted, `totpSecondsRemaining` countdown math); `vault-totp-code-handler.test.js` (code+seconds, no-seed grep, null-no-totp, `{locked:true}`, enroll round-trip stores canonical + computes, malformed-throws-stores-nothing, unchanged-totp-preserved, the F1 `vault-context.totp` COMPAT test).
- Tests (contract-shape pins extended, not weakened): `register-vault-ipc.test.js` (handler list +`internal-vault-totp-code`), `internal-page-map.test.js` + `vault-page-shared-scripts.test.js` (the `/password-generator.js` route — the script-contract seam).

Results: `npm test` **2473 pass / 0 fail** (13 suites, +28 over leg 2's 2445); `npm run typecheck` clean; `npm run lint` clean. No hang. Pre-existing tests pass unmodified except the three exact-contract pins above (handler list + route map ×2) — expected additive extensions, no assertion weakened.

Deviations from the leg spec:
- **`normalizeTotpField` + `totpSecondsRemaining` live in `vault-crypto.js`** (the leg said "crypto/store layer") — the pure crypto core already owns `parseOtpauth`/`totp`/base32 and `VaultFormatError`, so the canonical-string re-serialization + countdown math sit beside their primitives (Electron-free, unit-tested there). The IPC handler in `register-vault-ipc.js` wires them in — matching the guidance's "normalize before `saveItemPreservingSecrets`" placement.
- **Enroll normalization applied in the `internal-vault-item-save` handler** (not inside the store method), exactly per the leg's "wire into `internal-vault-item-save`" instruction — keeps the store's full-replace/preserve contract untouched and the "not in `unchangedSecrets`" gate at the one save site.

**For leg 4 (`first-run-setup`) / leg 5 (`access-keys-autolock`):**
- **Editor-cleanup registry**: `vault.js` now has a module-scoped `editorCleanups` array drained by `runEditorCleanups()` at `openEditor`/`closeEditor`/`render`. Any future editor affordance that arms a timer/listener (autolock countdown, access-key widgets) MUST register teardown there — a leaked per-period poll is a full-vault decrypt each tick.
- **Live-code op precedent**: `internal-vault-totp-code` is the template for any new MRK-gated read that must return a DERIVED value and never a secret — `catchLocked` wrap, compute in main, return only the non-secret projection, grep/assert no-seed in the handler test.
- **Canonical-string enrollment**: a stored `totp` is ALWAYS the canonical `otpauth://totp/…` string post-leg-3 (legacy F1 string items keep working; `parseOtpauth(item.totp)` is the single value-reader in both the page op and the automation `vault-context`). Don't introduce a structured totp object.
- **Generator**: `src/shared/password-generator.js` `generatePassword(opts)` is pure/reusable — the setup flow (if it ever offers a generated master password) can call it directly in-page (no IPC).

### first-run-setup
**Status**: landed
**Risk tier**: **HIGH** — the master-password first-run flow (a second master-secret entry surface), the cross-renderer page→main→chrome→sheet orchestration, and the F2 sheet-controller refactor (touches landed security UI). Runs the per-leg design review.

**Design review (1 cycle, approve with changes)** — the riskiest bet holds: the cross-renderer
page→main→chrome→sheet path is wireable with a real precedent (`onVaultGesture`→`openOverlayMenu`;
internal tab resolves via `chromeForTab`). Incorporated: **[HIGH]** `setup({masterPassword})` requires
a non-empty STRING (my `setup(buffer)` was wrong on shape+type) → widen the guard to accept a Buffer
(scrypt accepts it), `vaultSetup(buf)→setup({masterPassword:buf})`, and explicitly scope that one
landed-F1 `vault-store.js` edit; **[HIGH]** `vault-recovery-show` must **opt out of dismiss wiring**
(store is set-up+unlocked, key unrecoverable — Escape/backdrop/blur would lose it) → the shared helper
parameterizes dismissibility; **[MED]** the `internal-vault-request-*` forwards live in
`register-browser-ipc.js` (has `chromeForTab`); **[MED]** a **distinct `onVaultRequestUnlock`** (NOT
F2's `pendingVaultFlow`, which springs the fill picker); **admin key DEFERRED to F4** (machine
credential, not first-run material — F3 shows recovery only; **F4 must add a from-scratch admin-provision
path**); refactor discipline (importable modal-card module + characterization tests green-against-F2-first,
own checkpoint); the recovery string crosses main→sheet in the channel-3 init payload (drop-on-close,
never re-emit); add the new sheets to a11y SHEET_STATES. Reviewer-specified → no second cycle.

**Implementation (landed, uncommitted).** Built in the leg's sub-step order, modal-card refactor first with its own green checkpoint before the new kinds stacked.

Files changed (one line each):
- `src/shared/modal-card-controller.js` (NEW) — the extracted importable helper: `createSheetReport(bridge)` (one-report-per-open-token machine) + `attachModalCard({node,getCycle,close,dismissible,activeElement})` (dialog-local Escape + Tab-trap + backdrop dismiss, dismissibility-parameterized).
- `src/shared/vault-set-template.js` (NEW) — `buildVaultSetCard` (password + confirm + aria-live error + Set up/Cancel).
- `src/shared/vault-recovery-template.js` (NEW) — `buildVaultRecoveryCard` (read-only key display + Copy + "I've saved it"; NO input element).
- `src/renderer/menu-overlay.js` — re-expressed F2 `vault-unlock`/`vault-capture` onto `attachModalCard`; adopted the single shared `createSheetReport` instance (`report.token/sent/lastStimulus` replace the module-scoped state); added `vault-set` (EIGHTH) + `vault-recovery-show` (NINTH, dismissible:false) template kinds + TEMPLATES/NODE_OF_ENTRY/onInit branches + object-model shape check for recovery-show.
- `src/renderer/menu-controller.js` — global blur + outside-click pointerdown handlers skip an entry with `dismissible === false`.
- `src/main/menu-overlay-manager.js` — `currentDismissible` tracked at open; `closeMenuOverlay` ignores the SOFT reasons (escape/outside-click/blur) for a non-dismissible menu (covers window-factory's `win.on('blur')`).
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-setup` handler (mirrors vault-unlock byte-for-byte: sender+token, Uint8Array→Buffer, dual-zeroize in finally; drives chrome to open recovery-show with the KEY ONLY) + `menu-overlay:copy-text` (injected `writeClipboard`, sheet-sender-validated).
- `src/main/main.js` — injected `vaultSetup` (calls `setup({masterPassword:buf})`, broadcasts lock-state on success, returns setup's shape unchanged) + `writeClipboard: clipboard.writeText` into `registerOverlayIpc`.
- `src/main/vault/vault-store.js` — widened `setup`'s guard (~:389) to accept a non-empty Buffer OR non-empty string (scrypt accepts a Buffer; no crypto change); return unchanged.
- `src/main/register-browser-ipc.js` — `internal-vault-request-setup` / `internal-vault-request-unlock` handlers (origin-gated via `registerInternalHandler`) → `chromeForTab(event.sender.id)?.send(...)`.
- `src/renderer/renderer.js` — overlayMenus states for `vault-set` + `vault-recovery-show`; `onVaultRequestSetup` (opens vault-set), distinct `onVaultRequestUnlock` (opens vault-unlock, NO `pendingVaultFlow`), `onVaultRecoveryShow` (opens recovery-show `{dismissible:false}`); `vault-recovery-show` activation case (no-op); `openVault{Set,RecoveryShow}OverlayForAudit` + seam.
- `src/preload/chrome-preload.js` — `onVaultRequestSetup` / `onVaultRequestUnlock` / `onVaultRecoveryShow`.
- `src/preload/menu-overlay-preload.js` — `setupVault` (invoke) + `copyText` (send).
- `src/preload/internal-preload.js` — `requestSetup` / `requestUnlock` (invoke) + `onVaultLockState` / `offVaultLockState` (listener-handle).
- `src/renderer/pages/vault.js` — un-stubbed the not-set-up CTA (`requestSetup()`) + locked affordance (`requestUnlock()`); subscribed to `onVaultLockState` → `refresh()` with pagehide cleanup.
- `src/renderer/renderer-globals.d.ts`, `src/renderer/menu-overlay-globals.d.ts` — new bridge method types + `MenuEntry.dismissible?`.
- `scripts/a11y-audit.mjs` — added `sheet:vault-set` + `sheet:vault-recovery-show` SHEET_STATES; extended dismiss/closed exprs (recovery-show dismissed via acknowledge, not Escape).
- `src/renderer/menu-overlay.css` — vault-set / vault-recovery-show card + error + monospace key styles.
- `CLAUDE.md` — evaluate-seam count 19→21; a11y "six→eight sheet states".
- Tests (NEW): `modal-card-controller.test.js` (characterization: Tab-cycle, Escape/backdrop, dismissibility, one-report token), `vault-set-template.test.js`, `vault-recovery-template.test.js`, `vault-store-setup-buffer.test.js`, `vault-setup-handler.test.js`, `vault-request-triggers.test.js`. Extended contract pins: `register-browser-ipc.test.js` (internal-channel inventory +2), `seam-contract.test.js` (SEAM_COUNT 19→21).

Results: `npm test` **2500 pass / 0 fail** (13 suites; +27 new tests); `npm run typecheck` clean; `npm run lint` clean. Pre-existing tests pass UNMODIFIED except the two exact-contract pins above (internal-channel inventory + seam count) — additive extensions, no assertion weakened. The F2 sheet DOM-builder suites (the refactor guard) and the F1 vault-store suite (the setup widening — the existing string path + double-setup + non-string rejection stay green) pass untouched.

Deviations from the leg spec:
- **`createSheetReport` extracted alongside `attachModalCard`** (both in `modal-card-controller.js`): the leg's "one-report token" was named as part of the extracted controller, so the token/sent/lastStimulus machine moved into the importable module (a SINGLE shared instance in menu-overlay.js preserves the module-scoped sharing). This makes the "one-report token" characterization test real (against the module, not the untestable IIFE).
- **`input-dialog` (new-container) was NOT folded onto `attachModalCard`.** The leg scoped the refactor to "F2's two dialog-style kinds" (vault-unlock + vault-capture); input-dialog is a pre-F2 kind and keeps its inline wiring (only the `report.*` renames), minimizing blast radius on non-target UI.
- **Recovery key transits the chrome renderer** (main→chrome `vault-recovery-show` send → chrome opens the sheet with `{recoveryKey}` in the model → channel-3 to the sheet), exactly as the leg's "The setup-success handler drives chrome to open vault-recovery-show with the returned recovery key" directs. It never touches the vault PAGE DOM or any `internal-*` payload (grep-AC clean); `adminPrivateKeyB64` never leaves main (grep-confirmed absent from renderer/preload).
- **Recovery-show Copy routes through main** (`menu-overlay:copy-text` → injected `clipboard.writeText`), following the codebase's "main owns the OS clipboard" discipline (the `chrome-clipboard-write` precedent) rather than `navigator.clipboard` in the sheet.
- **Setup broadcasts lock-state from the main.js `vaultSetup` delegate**, not from inside `setup()` (whose body the leg scoped to the guard-widening edit only) — `setup()` sets the MRK directly (not via `_installMrk`'s `onUnlock`), so without this the transition would not project to the chrome indicator / the vault page. Return shape unchanged.

**Notes for the final leg (`access-keys-autolock`):**
- **Modal-card helper API** (`src/shared/modal-card-controller.js`): the step-up mint sheet should build on `attachModalCard({ node, getCycle, close, dismissible?, activeElement? })` for its Escape+Tab+backdrop wiring, and use the shared `report` instance's `sendActivatedOnce` / `report.sent`/`report.token`/`report.lastStimulus` (do NOT reintroduce local token/sent/lastStimulus). Dialog-style kinds go on the helper; a roving list (like vault-picker) does not.
- **`vault-set` / `menu-overlay:vault-setup` pattern is the template the step-up mint mirrors**: a dialog-style card whose secret leaves as a `Uint8Array` over a DEDICATED invoke channel (never channel-4), main-side sender+token validation + `Buffer.from` copy + **dual-zeroize** (`buf.fill(0); secret.fill?.(0)`) in `finally`, gated on an injected delegate. The mint's master-password step-up input is the same shape (F1 `mintAccessKey({ masterPassword })` already accepts a Buffer via the same scrypt-accepts-Buffer property the setup widening relied on — verify/scope any store-guard widening the same way).
- **Request-trigger idiom** (`internal-vault-request-*` in `register-browser-ipc.js` → `chromeForTab(event.sender.id)?.send(...)` → a distinct `onVaultRequest*` chrome handler → `openOverlayMenu`): reuse this for any new page→chrome-sheet orchestration (e.g. an access-key list action that must open a sheet). Keep the handler in `register-browser-ipc.js` (it has `chromeForTab`); origin-gate via `registerInternalHandler`.
- **Dismissibility opt-out** is honored on BOTH sides: the sheet entry's `dismissible:false` (menu-controller blur/outside-click guards) AND the open payload's `{ dismissible:false }` (menu-overlay-manager's soft-reason guard, covering window-factory's `win.on('blur')`). A future one-time-reveal sheet reuses both.
- **`vault-recovery-show` a11y** (`sheet:vault-recovery-show`) is dismiss-disabled, so the a11y-audit loop acknowledges it (clicks the last actions button) rather than Escaping — the live-GUI a11y sweep for the new sheets is the flight-end / F5-HAT run (DD9).

### access-keys-autolock
**Status**: landed
**Risk tier**: **HIGH** — the durable-grant step-up mint (a master-password step-up on the chrome sheet + a one-time minted access secret) is security-sensitive. The auto-lock setting is low-risk but rides along. Runs the per-leg design review. This is the FINAL F3 leg.

**Design review (1 cycle, approve with changes)** — de-risked: **no `mintAccessKey` widening needed**
(unlike `setup`, it has no string guard — passes to `unwrapMaster`/`scrypt` which accept Buffer); a
**wrong step-up password genuinely refuses** (`VaultAuthError` before any write, → `{ok:false}`);
`listAccessKeys` keyIds are plaintext fingerprints (MRK-gating is policy). Minted secret on the sheet
(`vault-accesskey-show`) confirmed right. Incorporated: **[MED]** `listAccessKeys` goes through
`_resolveTarget` (allowlist, no raw-target path) + filters `keyId !== 'mrk'` (`TYPE_ACCESS` not
exported); **[MED]** a11y-audit needs THREE edits (`SHEET_STATES` + `SHEET_NODE_IDS` + a
`SHEET_DISMISS_EXPR` dismiss-locked branch for `vault-accesskey-show`, else the audit's Escape leaves
it open and fails); the mint channel payload is `{token, secret, target}` with the delegate adapting to
`mintAccessKey`'s positional target; auto-lock reuses the existing `settingsGet/Set` (no new IPC,
re-arms next op); revoke handler passes a `_resolveTarget`-validated id; citation drift fixed. Reviewer-
specified → no second cycle. **Final F3 leg.**

**Implementation (2026-07-21)** — landed to ACs. All 6 ACs + post-completion checklist checked off. The step-up mint mirrors leg-4's setup byte-for-byte; no `mintAccessKey` widening was needed (confirmed: no string guard).

Files changed:
- `src/main/vault/vault-store.js` — NEW `listAccessKeys(target)` (`_requireMrk` → `_resolveTarget` → `_readVault` → `listEnvelopeKeyIds` → filter `keyId !== 'mrk'` → `[{ keyId }]`, no secret); NEW public `resolveTarget(target)` (the `_resolveTarget` allowlist surfaced for the revoke handler — no raw-path). No `mintAccessKey` change.
- `src/main/register-vault-ipc.js` — NEW `internal-vault-accesskey-list` (catchLocked → `listAccessKeys`) + `internal-vault-accesskey-revoke` (catchLocked → `revokeAccessKey(store.resolveTarget(vaultId), keyId)`).
- `src/main/register-browser-ipc.js` — NEW `internal-vault-request-mint` (mirrors request-setup, EXTENDED with the non-secret `{ target }`) → `vault-request-mint`.
- `src/main/register-overlay-ipc.js` — NEW `menu-overlay:vault-stepup-mint` handler (mirrors `menu-overlay:vault-setup`: sender+token, `Buffer.from` copy, DUAL-ZEROIZE in finally; adds the non-secret `target`), gated on the `vaultMintAccessKey` injection; on success closes the sheet + sends `vault-accesskey-show { secret, keyId }`.
- `src/main/main.js` — NEW `vaultMintAccessKey` delegate (vaultUnlock pattern: catch `VaultAuthError` → `{ ok:false }`; adapts to the positional target; returns `{ ok, secret, keyId }`).
- `src/shared/vault-stepup-template.js` (NEW) — the step-up card builder (single master-password field, mirrors vault-set).
- `src/shared/vault-accesskey-template.js` (NEW) — the one-time minted-secret card builder (keyId + secret read-only displays + Copy + acknowledge, mirrors vault-recovery-show; acknowledge is the last actions button for the dismiss-locked audit branch).
- `src/renderer/menu-overlay.js` — wired the `vault-stepup` (TENTH kind) + `vault-accesskey-show` (ELEVENTH kind) templates: build/register/submit/copy/acknowledge, `renderStepup`/`renderAccessKey`, TEMPLATES + NODE_OF_ENTRY + object-model set + init-dispatch branches.
- `src/preload/menu-overlay-preload.js` + `src/renderer/menu-overlay-globals.d.ts` — `stepupMint` invoke + type.
- `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts` — `onVaultRequestMint` / `onVaultAccessKeyShow` (chrome bridge) + types.
- `src/renderer/renderer.js` — overlayMenus config for both kinds; dispatch case `vault-accesskey-show` (ack no-op); `onVaultRequestMint` → open vault-stepup; `onVaultAccessKeyShow` → open vault-accesskey-show (dismiss-disabled); two audit hooks; seam Object.assign +2 (21→23, count comment updated).
- `src/preload/internal-preload.js` + `src/renderer/renderer-globals.d.ts` — `vaultAccessKeys` / `vaultAccessKeyRevoke` / `requestMint` internal-bridge methods + types.
- `src/renderer/pages/vault.js` — access-keys section per vault (list by keyId + Mint + per-row Revoke; `textContent`-only, no secret) + a manager-wide auto-lock number input (1–1440) bound to `settingsGet/Set('vaultAutoLockMinutes')`, surfacing the validator's rejection; window-focus drain refreshes access-key lists on return from the mint sheet.
- `src/renderer/pages/vault.css` + `src/renderer/menu-overlay.css` — access-key + auto-lock page sections; vault-stepup + vault-accesskey sheet cards.
- `scripts/a11y-audit.mjs` — THREE edits: `sheet-vault-stepup`/`sheet-vault-accesskey` in SHEET_NODE_IDS; a `SHEET_DISMISS_EXPR` dismiss-locked branch for `sheet-vault-accesskey`; `sheet:vault-stepup` + `sheet:vault-accesskey-show` SHEET_STATES.
- `CLAUDE.md` — evaluate-seam count 21→23.
- Tests (NEW): `vault-stepup-template.test.js`, `vault-accesskey-template.test.js`, `vault-stepup-mint-handler.test.js` (Buffer→mint, dual-zeroize, sender/token, wrong-password refuses + nothing minted, secret+keyId once — never in the invoke reply). Extended suites: `vault-store.test.js` (+4: listAccessKeys keyIds-only/MRK-gated/allowlist, resolveTarget, Buffer step-up mint), `register-vault-ipc.test.js` (+4: channel-set pin +2, accesskey list/revoke non-internal + locked + immediate revoke + burner-target rejection), `vault-request-triggers.test.js` (+request-mint), `settings-store.test.js` (+auto-lock get/set round-trip + out-of-range rejection).
- Tests (contract-shape pins, additive): `register-browser-ipc.test.js` (internal-channel inventory +`internal-vault-request-mint`), `seam-contract.test.js` (SEAM_COUNT 21→23).

Results: `npm test` **2522 pass / 0 fail** (13 suites); `npm run typecheck` clean; `npm run lint` clean. All pre-existing F2 + leg-1..4 suites pass UNMODIFIED except the two exact-contract pins above (internal-channel inventory + seam count) — additive extensions, no assertion weakened. Grep-AC clean: the minted access secret leaves main ONLY on the `vault-accesskey-show` chrome send — never on an `internal-*` payload, never in the vault page DOM, never in the mint invoke reply (`{ ok:true }` only).

Deviations from the leg spec:
- **`vaultMintAccessKey` delegate wraps the positional-target call in the vaultUnlock catch pattern** (Open-Q-44's "delegate maps VaultAuthError → `{ok:false}`") rather than being the bare passthrough shown in the guidance's `(buf, target) => …mintAccessKey(…)` snippet. This keeps a WRONG step-up password a normal `{ ok:false }` (sheet re-prompts, nothing minted) instead of a rejected invoke — and returns `{ ok, secret, keyId }` so the handler can gate the `vault-accesskey-show` send on success. The two hints are reconciled: the snippet is the core call, the wrapper is the pattern.
- **Public `resolveTarget(target)` added to the store** (not in the leg's Files-Affected list) so the revoke handler literally passes a `_resolveTarget`-validated vaultId (leg directive) without re-implementing the allowlist in the handler (drift risk) — a 3-line passthrough to the single-source `_resolveTarget`, needed because `revokeAccessKey` takes a raw vaultId and a traversal/burner target would otherwise build a raw path.
- **Post-mint page refresh rides a window-`focus` listener** (drains each vault section's cheap keyId re-fetch). There is no page-side mint-complete callback (the minted secret lives only on the chrome sheet), and no lock-state change to piggyback on; focus-on-return is the idiomatic page-side signal (parallels the TOTP widget's focus handling). Revoke refreshes directly (page-controlled). Named-accepted: if OS focus doesn't return to the guest under WSLg, the list updates on the next page interaction — a UX nicety, not an AC.

**This is the FINAL F3 leg — the flight is ready for the flight-end review.** All four F3 legs (vault-page-infra, item-management, totp-and-generator, first-run-setup) plus this one are landed-uncommitted; the Flight Director runs the flight-end review (incl. the live-GUI a11y/HAT sweep for the four new sheet states across legs 4–5: `sheet:vault-set`, `sheet:vault-recovery-show`, `sheet:vault-stepup`, `sheet:vault-accesskey-show` — DD9) and commits + lands the whole flight.
