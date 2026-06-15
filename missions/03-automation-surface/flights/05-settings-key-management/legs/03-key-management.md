# Leg: key-management

**Status**: completed
**Flight**: [Settings key management + automation UI](../flight.md)

## Objective
Add self-service automation-key management to `goldfinch://settings`: a jars list where the operator generates / rotates / revokes a per-jar key (show-once plaintext + copy), plus an env-gated admin-key control — backed by new origin-checked IPC and a net-new revoke, and retiring the Flight-4 `automation:dev-enable-mint` dev seam. (SC9)

## Context
- **SC9**: keys managed from the Settings area (generate / rotate / revoke), persisted, effective immediately — per-jar keys from the jars surface + the env-gated admin key.
- **DD2**: storage stays the Flight-4 hash model — `automationKeyHashes` (`{jarId: sha256hex}`) and `automationAdminKeyHash`, plaintext shown once and never persisted. No per-key encryption.
- **DD4**: show-once plaintext via `navigator.clipboard` with the `clipboard:write` IPC fallback — **both already built in leg 2**; the shared file-scope `copyText(text, messageEl)` helper in `settings.js` is reused here.
- **DD5**: real controls replace the Flight-4 dev seam. **TWO seams, retire only ONE**: RETIRE the `automation:dev-enable-mint` IPC (chrome-renderer-only; nothing depends on it — confirmed by grep, but the implementer re-greps incl. tests before deleting); KEEP the auto-mint-to-stdout seam (`shouldAutoMint`) — it is the headless behavior-test apparatus for `mcp-auth-gating` / `mcp-jar-scoping` / leg-6 `verify-integration`. Do NOT touch it.
- **DD5 revoke semantics**: revoke deletes the hash entry only; do NOT `sessions.delete()` the live session. Flight-4's per-request re-validation (`resolveIdentity` reads live hashes every request) returns `null` once the hash is gone → the next request 401s. "Effective immediately" is therefore free.
- The audit indicator + activity log viewer are **leg 4**. This leg is keys only.

### Backend reality (from recon)
- `enableAndMintJarKey(jarId, settings, jars)` exists (`src/main/automation/mcp-server.js` ~639–657): generates a key, stores `automationKeyHashes[jarId] = hash`, flips `automationEnabled = true`, returns plaintext. It guards `jarId` against `jars.list()` (rejects unknown/burner ids). **Generate and rotate are the SAME operation** — minting overwrites any existing hash for that jar. DD5 itself says "generate/rotate = enableAndMintJarKey".
- `mintAdminKey(settings)` exists (~669–674): returns `null` if `GOLDFINCH_AUTOMATION_ADMIN` unset, else stores `automationAdminKeyHash = hash` and returns plaintext.
- **No revoke function exists** — net-new this leg.
- The `automation:get-status` IPC does NOT report the admin env gate — net-new field this leg.
- No jars UI exists in settings — `jars-list`/`jars-add` are bare `ipcMain.handle` exposed only to the chrome. This leg adds a jars list to settings.

### Design decision — unified mint channels (FD, flag for review)
DD5 lists six channels (`jar-key-generate|rotate|revoke`, `admin-key-generate|rotate|revoke`). Since **generate and rotate are byte-identical operations** (mint a fresh key, overwrite the hash — DD5 confirms they share `enableAndMintJarKey`), this leg implements **one mint channel + one revoke channel per surface** (4 total), and the UI labels the button "Generate" vs "Rotate" based on whether a hash already exists. This preserves DD5's intent and lifecycle while avoiding two pairs of duplicate handlers. **Recorded as a deliberate simplification; reviewer to confirm it's faithful to the agreed design.**

## Inputs
What exists before this leg runs:
- `src/main/automation/mcp-server.js` — `enableAndMintJarKey`, `mintAdminKey`, the module exports (~681–682); `resolveIdentity` per-request validation (~364–381); the `sessions` Map (~204–209, deleted only on transport `onclose`).
- `src/main/automation/automation-auth.js` — `hashKey`, `generateKey`, `validateKey`.
- `src/main/settings-store.js` — `automationKeyHashes` (`{}`) + `automationAdminKeyHash` (`''`) DEFAULTS + validators (HEX64).
- `src/main/main.js` — `automation:get-status` (~579–585, no `adminEnabled`); the `automation:dev-enable-mint` IPC to retire (~835–845); the `shouldAutoMint` auto-mint-to-stdout block to KEEP (~862–871); `jars-list` bare handler (~659); `registerInternalHandler` pattern; `settings` + `jars` in scope.
- `src/preload/internal-preload.js` — `window.goldfinchInternal` with leg-2's `automationGetStatus` / `automationFindFreePort` / `clipboardWrite`; the `on`/`off` registry. No jar methods yet.
- `src/renderer/pages/settings.html` / `.js` / `.css` — the leg-2 `<section id="automation">`; the file-scope `copyText(text, messageEl)` helper; the per-section IIFE pattern.
- `src/renderer/renderer-globals.d.ts` — `GoldfinchInternalBridge` interface (extended in leg 2).

## Outputs
- `revokeJarKey(jarId, settings)` + `revokeAdminKey(settings)` in `mcp-server.js`, exported.
- New origin-checked IPC: `automation:jar-key-mint`, `automation:jar-key-revoke`, `automation:admin-key-mint`, `automation:admin-key-revoke`, `automation:list-keys` (the last carries `adminEnabled` + `adminKeySet`). `automation:get-status` is unchanged.
- `automation:dev-enable-mint` removed; auto-mint-to-stdout untouched.
- New bridge methods on `window.goldfinchInternal` (+ the `.d.ts` contract).
- A "Keys" subsection in `<section id="automation">`: jars list with per-jar Generate/Rotate + Revoke, a show-once reveal, and an env-gated admin-key block.
- Unit tests for revoke + the mint/revoke→re-validation flow.

## Acceptance Criteria
- [ ] **AC1** — `mcp-server.js` adds and exports `revokeJarKey(jarId, settings)` (deletes `automationKeyHashes[jarId]` via a copied object `set`, leaving other jars' hashes intact; no-op if absent; never throws on a missing id) and `revokeAdminKey(settings)` (sets `automationAdminKeyHash = ''`). Neither touches the live `sessions` Map.
- [ ] **AC2** — The admin env gate (`!!process.env.GOLDFINCH_AUTOMATION_ADMIN`) is reported **only via `automation:list-keys`** (see AC3), NOT added to `automation:get-status` (resolves design-review [medium]: single source, no drift; the keys controller already calls `list-keys` and gets `adminEnabled` + `adminKeySet` in one round-trip; leg 4's indicator reads the audit broadcast, not the env gate, so `get-status` does not need it). `automation:get-status` is left unchanged from leg 1.
- [ ] **AC3** — Five new IPC handlers, ALL via `registerInternalHandler` (origin-checked):
  - `automation:list-keys` → `{ jars: [{ id, name, color, hasKey }], adminEnabled, adminKeySet }` (joins `jars.list()` with `automationKeyHashes` key presence; `adminKeySet` = `automationAdminKeyHash !== ''`). Never returns hashes/plaintext.
  - `automation:jar-key-mint` (jarId) → `{ key }` (calls `enableAndMintJarKey(jarId, settings, jars)`; the show-once plaintext). Propagates the unknown/burner-jar rejection as a rejected invoke.
  - `automation:jar-key-revoke` (jarId) → `{ ok: true }` (calls `revokeJarKey`).
  - `automation:admin-key-mint` → `{ key }` (calls `mintAdminKey(settings)`; `{ key: null }` when the env gate is unset).
  - `automation:admin-key-revoke` → `{ ok: true }` (calls `revokeAdminKey`).
- [ ] **AC4** — The `automation:dev-enable-mint` IPC handler is removed from `main.js`, and the now-dangling comment that names it (in the adjacent auto-mint block) is updated so no stale reference remains. A repo grep (`grep -rn "dev-enable-mint" src test tests docs .mcp.json`) confirms no remaining references anywhere (renderer, preload, tests, behavior specs, docs, `.mcp.json`). The `shouldAutoMint` auto-mint-to-stdout block is UNCHANGED (verify it still mints `default` + admin to stdout).
- [ ] **AC5** — `internal-preload.js` exposes `automationListKeys()`, `automationJarKeyMint(jarId)`, `automationJarKeyRevoke(jarId)`, `automationAdminKeyMint()`, `automationAdminKeyRevoke()` (each `ipcRenderer.invoke` of the matching channel), and the `.d.ts` contract is updated.
- [ ] **AC6** — `settings.html` gains a "Keys" subsection inside `<section id="automation">`: an `<h3>Keys</h3>`, a jars list container `#automation-jars`, a show-once reveal element `#automation-key-reveal` (hidden by default) containing a readonly key field `#automation-key-value` + a copy button + a "shown once — copy it now" warning, and an admin block `#automation-admin` (hidden unless `adminEnabled`) with an admin-key status line, a generate/rotate button, a revoke button, and its own show-once reveal (may reuse `#automation-key-reveal`).
- [ ] **AC7** — The controller renders the jars list from `automationListKeys()`: each jar row shows the jar name (+ color swatch), a "key set" / "no key" status, a button labeled **"Generate key"** when `!hasKey` else **"Rotate key"** (both call `automationJarKeyMint(jar.id)`), and a **"Revoke"** button enabled only when `hasKey` (calls `automationJarKeyRevoke(jar.id)`). After any mint, the plaintext is shown once via `#automation-key-reveal` and copyable via the shared `copyText`; after mint/revoke the list refreshes via `automationListKeys()`. The admin block renders only when `adminEnabled`, mirrors the same mint/revoke/show-once flow, and labels its button per `adminKeySet`.
- [ ] **AC8** — Plaintext keys are shown exactly once (never persisted, never re-fetchable): the reveal is populated only from a mint call's return. **Ordering (resolves design-review [high]):** `refresh()`/`renderJars`/`renderAdmin` rebuild ONLY the jars list + admin DOM and NEVER touch `#automation-key-reveal`; the reveal is cleared at the **start of each mint/revoke action** (and on section init) and `reveal(key)` is the **last** write on a mint resolve, so the post-mint list refresh cannot wipe the just-shown key. No code path writes plaintext to settings or logs.
- [ ] **AC9** — Unit tests: `revokeJarKey` (deletes only the target jar's hash; other jars untouched; absent id is a no-op), `revokeAdminKey` (clears to `''`), and an end-to-end-ish auth check using the existing headless harness/`validateKey`: after `enableAndMintJarKey` a token validates to the jarId; after `revokeJarKey` the same token validates to `null` (proves the 401-on-next-request semantics at the validation layer). `npm test`, `npm run typecheck`, `npm run lint` all green.

## Verification Steps
- AC1/AC9: `npm test` — new revoke + re-validation cases green.
- AC2/AC3/AC5: `grep -n "automation:jar-key-mint\|automation:jar-key-revoke\|automation:admin-key-mint\|automation:admin-key-revoke\|automation:list-keys" src/main/main.js` (all via `registerInternalHandler`); `grep -n "adminEnabled" src/main/main.js`.
- AC4: `grep -rn "dev-enable-mint" src test` returns nothing; `grep -n "shouldAutoMint" src/main/main.js` still present and unchanged.
- AC6/AC7/AC8: `grep -n "automation-jars\|automation-key-reveal\|automation-admin" src/renderer/pages/settings.html`; `npm run typecheck && npm run lint` clean. Live generate→copy→revoke→401 is exercised in leg 6 (`settings-automation` CDP + `mcp-jar-scoping` MCP run).

## Implementation Guidance

1. **mcp-server.js — revoke functions (AC1).** Mirror `enableAndMintJarKey`'s copy-then-set discipline:
   ```js
   function revokeJarKey(jarId, settings) {
     const hashes = { ...(settings.get('automationKeyHashes') || {}) };
     if (Object.prototype.hasOwnProperty.call(hashes, jarId)) {
       delete hashes[jarId];
       settings.set('automationKeyHashes', hashes);
     }
     // Live sessions are NOT touched (DD5): per-request re-validation 401s the next call.
   }
   function revokeAdminKey(settings) {
     settings.set('automationAdminKeyHash', '');
   }
   ```
   Add both to the module exports.

2. **main.js — new IPC + retire dev seam (AC3, AC4).** (Do NOT modify `automation:get-status` — AC2: the admin gate is reported via `list-keys` only.)
   - Import `revokeJarKey`, `revokeAdminKey` from `./automation/mcp-server` (extend the existing destructured import at ~line 18).
   - Register (next to the other `registerInternalHandler` calls):
     ```js
     registerInternalHandler(ipcMain, 'automation:list-keys', () => {
       const hashes = settings.get('automationKeyHashes') || {};
       return {
         jars: jars.list().map((j) => ({ id: j.id, name: j.name, color: j.color, hasKey: !!hashes[j.id] })),
         adminEnabled: !!process.env.GOLDFINCH_AUTOMATION_ADMIN,
         adminKeySet: (settings.get('automationAdminKeyHash') || '') !== '',
       };
     });
     registerInternalHandler(ipcMain, 'automation:jar-key-mint', (_e, jarId) => ({ key: enableAndMintJarKey(jarId, settings, jars) }));
     registerInternalHandler(ipcMain, 'automation:jar-key-revoke', (_e, jarId) => { revokeJarKey(jarId, settings); return { ok: true }; });
     registerInternalHandler(ipcMain, 'automation:admin-key-mint', () => ({ key: mintAdminKey(settings) }));
     registerInternalHandler(ipcMain, 'automation:admin-key-revoke', () => { revokeAdminKey(settings); return { ok: true }; });
     ```
   - **Before removing** the `automation:dev-enable-mint` block (~835–845), `grep -rn "dev-enable-mint" src test` to confirm zero references; then delete the handler. Leave the `shouldAutoMint` block (~862–871) and `mcpServer.start()` exactly as-is.

3. **internal-preload.js — bridge methods (AC5).** Add to the `goldfinchInternal` object:
   ```js
   automationListKeys: () => ipcRenderer.invoke('automation:list-keys'),
   automationJarKeyMint: (jarId) => ipcRenderer.invoke('automation:jar-key-mint', jarId),
   automationJarKeyRevoke: (jarId) => ipcRenderer.invoke('automation:jar-key-revoke', jarId),
   automationAdminKeyMint: () => ipcRenderer.invoke('automation:admin-key-mint'),
   automationAdminKeyRevoke: () => ipcRenderer.invoke('automation:admin-key-revoke'),
   ```
   Update `GoldfinchInternalBridge` in `renderer-globals.d.ts` with these signatures and the `adminEnabled` status field.

4. **settings.html — Keys subsection (AC6).** Inside `<section id="automation">`, after the connect-hint:
   ```html
   <h3>Keys</h3>
   <p class="muted">Generate a per-jar key for the automation surface. The key is shown once — copy it immediately.</p>
   <div id="automation-jars"></div>
   <div id="automation-key-reveal" hidden>
     <label for="automation-key-value">New key (shown once)</label>
     <div class="settings-row">
       <input id="automation-key-value" class="settings-text-input" type="text" readonly spellcheck="false" />
       <button id="automation-key-copy" class="settings-btn" type="button">Copy</button>
     </div>
     <p class="muted">Copy it now — it cannot be shown again. Only its hash is stored.</p>
   </div>
   <div id="automation-admin" hidden>
     <h3>Admin key</h3>
     <p class="muted">The admin key drives the app/chrome surface. Never share it with an external consumer.</p>
     <div class="settings-row">
       <span id="automation-admin-status">—</span>
       <button id="automation-admin-mint" class="settings-btn" type="button">Generate admin key</button>
       <button id="automation-admin-revoke" class="settings-btn" type="button">Revoke</button>
     </div>
   </div>
   ```

5. **settings.js — key-management controller (AC7, AC8).** A new IIFE (separate from the leg-2 automation IIFE; both guard on the bridge). Build DOM rows in JS (no innerHTML with interpolated data — use `document.createElement` + `textContent` to avoid injection from jar names). **Reveal lifecycle (resolves design-review [high]): `refresh()`/`renderJars`/`renderAdmin` NEVER touch `#automation-key-reveal`. The reveal is cleared by `clearReveal()` called at the START of each mint/revoke action (and on init), and `reveal(key)` is the LAST write on a mint resolve.** Flow:
   - `refresh()`: `automationListKeys().then(({ jars, adminEnabled, adminKeySet }) => { renderJars(jars); renderAdmin(adminEnabled, adminKeySet); })` — rebuilds list + admin DOM only; does not clear or set the reveal.
   - `renderJars(jars)`: clear `#automation-jars`; for each jar build a `.settings-row` with a color swatch, the name, a "key set"/"no key" span, a mint button (label by `hasKey`), and a revoke button (`disabled = !hasKey`). Wire mint → `clearReveal(); automationJarKeyMint(jar.id).then(({key}) => refresh().then(() => reveal(key))).catch(showErr)`; revoke → `clearReveal(); automationJarKeyRevoke(jar.id).then(refresh)`. (Make `refresh()` return the promise so `reveal` runs after the list rebuild.)
   - `renderAdmin(adminEnabled, adminKeySet)`: toggle `#automation-admin` `hidden = !adminEnabled`; set status text; label the mint button by `adminKeySet`; wire mint → `clearReveal(); automationAdminKeyMint().then(({key}) => refresh().then(() => { if (key) reveal(key); }))`; revoke → `clearReveal(); automationAdminKeyRevoke().then(refresh)`.
   - `clearReveal()`: empty `#automation-key-value.value`, hide `#automation-key-reveal`.
   - `reveal(key)`: set `#automation-key-value.value = key`; unhide `#automation-key-reveal`; do NOT store `key` anywhere else.
   - Copy button → `copyText(document.getElementById('automation-key-value').value, messageEl)` (reuse the file-scope helper + a message element).
   - Initial `refresh()` on load (reveal stays hidden). No `onSettingsChanged` needed (key state changes only via these controls); optional.

6. **settings.css — key UI (AC6).** Reuse `.settings-row`, `.settings-text-input`, `.settings-btn`, `.muted`. Add a small `.jar-swatch { width:12px;height:12px;border-radius:3px;display:inline-block; }` and any spacing for jar rows / the reveal block. Keep the dark-theme tokens.

## Edge Cases
- **Mint for an unknown/burner jarId** → `enableAndMintJarKey` throws; the IPC invoke rejects; the controller shows an inline error and does not reveal a key. (The UI only lists real jars from `automationListKeys`, so this is defense-in-depth.)
- **Admin mint with the env gate unset** → `mintAdminKey` returns `null`; `{ key: null }`; the controller shows no reveal (and the admin block is hidden anyway). Defense-in-depth for a forged invoke.
- **Revoke a jar with no key** → `revokeJarKey` is a no-op; the revoke button is disabled in that state regardless.
- **Revoke effective immediately** → no `sessions.delete`; the next MCP request 401s via live re-validation (verified at the validation layer in AC9; live in leg 6).
- **Jar name with HTML metacharacters** → rows built via `textContent`/`createElement`, never `innerHTML` interpolation.
- **`navigator.clipboard` blocked** → `copyText` falls back to the `clipboard:write` IPC (leg 2).
- **`automationEnabled` flips true on first jar mint** (`enableAndMintJarKey` side effect) → the leg-2 toggle reflects it on the next `onSettingsChanged`/load; acceptable and intended (minting a key implies enabling).

## Files Affected
- `src/main/automation/mcp-server.js` — `revokeJarKey`, `revokeAdminKey` + exports.
- `src/main/main.js` — 5 new origin-checked IPC handlers (incl. `list-keys` carrying `adminEnabled`/`adminKeySet`); remove `automation:dev-enable-mint` (+ fix the dangling comment); keep `shouldAutoMint`. (`get-status` untouched.)
- `src/preload/internal-preload.js` — 5 new bridge methods.
- `src/renderer/renderer-globals.d.ts` — bridge signatures for the 5 new methods (incl. the `list-keys` return type).
- `src/renderer/pages/settings.html` — Keys subsection + admin block.
- `src/renderer/pages/settings.js` — key-management IIFE controller.
- `src/renderer/pages/settings.css` — jar rows / reveal styling.
- `test/unit/automation-mcp-server.test.js` (or `automation-auth.test.js`) — revoke + re-validation tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (unit + typecheck + lint; live CDP/MCP deferred to leg 6)
- [ ] Update flight-log.md with leg progress entry (note the unified-mint-channel decision + the dev-enable-mint retirement)
- [ ] Set this leg's status to `landed` (commit deferred to Phase 2d)
- [ ] Do NOT check off the leg in flight.md (deferred to batched commit)
- [ ] Do NOT commit per-leg
