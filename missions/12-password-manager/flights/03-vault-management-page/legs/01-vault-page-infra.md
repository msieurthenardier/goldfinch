# Leg: vault-page-infra

**Status**: completed
**Flight**: [Vault Management Page](../flight.md)

## Objective

Stand up `goldfinch://vault` as a first-class trusted internal page following the exact four-gate
recipe — reachable from the chrome, rendering the not-set-up / locked / unlocked vault-list states —
with a `registerInternalHandler`-gated IPC scaffold, and land the reserved-id single-source-of-truth
guard (DD8). *(The DD5 template-registry refactor moved to leg 4 — the card builders are already
factored; what remains is F2 sheet-controller wiring best refactored where leg 4's new sheet kinds
land and the a11y/HAT guards run.)*

## Context

- **Flight DD1** — no new gate code; add `goldfinch://vault` to the existing allowlists and follow
  the settings/downloads/jars recipe. The four gates key on `wc.session.__goldfinchInternal`.
- **Flight DD2** — all vault IPC via `registerInternalHandler` (origin + session-identity gated),
  mirroring `register-settings-ipc.js`.
- **Flight DD5** — no master-equivalent secret in the page DOM; master-password entry + recovery
  display live on the chrome-owned sheet (leg 4). The template-registry refactor lands in **leg 4**
  (with the new sheet kinds), not here.
- **Flight DD8** — put the reserved-id constant in a **standalone `src/shared/reserved-ids.js`**
  (plain CJS) so both `vault-store.js` (`GLOBAL_ID`, unexported) and `jars.js` (`isReservedId`'s own
  `'global'`) consume it — **not** exported from `jars.js` (which `require`s `./app-db` and would
  break `vault-store`'s Electron-free purity). Add a cross-module consistency test.
- **Flight DD9** — the page is not axe-auditable (internal-session exclusion); a11y for the page is
  unit DOM/aria + F5 HAT. This leg's page shell should carry correct landmarks/roles from the start.

## Inputs

- `src/shared/url-safety.js:84` — `INTERNAL_HOSTS = new Set(['settings','downloads','jars'])`;
  `isInternalPageUrl` (`:104-121`).
- `src/main/internal-ipc.js:25` — `INTERNAL_ORIGINS`; `registerInternalHandler` (`:68-84`).
- `src/preload/internal-preload.js:24` — `INTERNAL_ORIGINS` + the `goldfinchInternal` bridge
  (`exposeInMainWorld` `:64`); the listener-handle map (`:35-62`).
- `src/main/internal-page-map.js:8-48` — route map + the "three-point onboarding seam" (`:3-7`).
- `src/main/register-settings-ipc.js:44-116` — the `registerInternalHandler`-mirror composition
  precedent.
- `src/renderer/pages/{settings,downloads}.{html,css,js}` — the internal-page file template
  (downloads is the smallest).
- `src/renderer/renderer.js:189` — `createTab('goldfinch://settings', null, { trusted:true })`;
  `src/renderer/chrome/overlay-menus.js:93-99` — `openDownloads()`/`openJarsPage()` precedent.
- `src/main/main.js:172` — `INTERNAL_CSP`; `:187-210` `handleInternal`.
- `src/main/vault/vault-store.js:43` — `GLOBAL_ID='global'` (unexported, `:902-910`);
  `isSetUp()`/`isUnlocked()` (`:352-357`); the store singleton `getVaultStore()` (`main.js:567-581`).
- `src/main/jars.js:110-118` — `isReservedId` (its own `'global'`).
- `src/renderer/menu-overlay.js` — the F2 `vault-unlock`/`vault-picker`/`vault-capture` template kinds
  (the backdrop-card modals to factor).
- `src/renderer/renderer-globals.d.ts` — types for new bridge methods (`CLAUDE.md:47` requires an
  entry per new `goldfinchInternal` method).

## Outputs

- **Four-gate onboarding**: `'vault'` in `INTERNAL_HOSTS`; `'goldfinch://vault'` in `INTERNAL_ORIGINS`
  in **both** `internal-ipc.js` and `internal-preload.js`; a `vault:` entry (+ each shared module the
  page imports) in `internal-page-map.js`.
- **Page files**: `src/renderer/pages/vault.{html,css,js}` — a trusted shell rendering three states:
  **not-set-up** (a "Set up the password manager" CTA — wired to a stub/marker; the real setup lands
  in leg 4), **locked** (a "Vault locked — unlock" affordance — **stubbed in leg 1**; the real
  request-unlock path, page→main→chrome→F2 sheet, lands in leg 4, since an internal page cannot call
  chrome-trust `menuOverlay.*` directly), **unlocked** (the vault list: `'Global'` + each persistent
  jar's vault, **labels only** — item counts need the MRK and land in leg 2 via the DD10 metadata op).
  No inline scripts/styles (CSP); correct landmarks/roles/headings.
- **IPC scaffold**: `src/main/register-vault-ipc.js` composing `registerInternalHandler` handlers,
  wired at the `main.js` composition site (`registerSettingsIpc({...})` neighbor). **Inject `jars`
  as a dep** (mirroring `register-settings-ipc`, `main.js:1279`) — the store has no public
  vault-enumeration method, so the handler composes `'global' + jars.list()` itself. Leg 1 lands
  `internal-vault-state` → `{ setUp: store.isSetUp(), unlocked: store.isUnlocked(), vaults:
  [{ vaultId, label }] }` (metadata only, no counts, no secret). Later legs add
  CRUD/reveal/totp/accesskeys/setup/autolock handlers to this module.
- **Bridge**: `internal-preload.js` `goldfinchInternal.vaultState()` (+ later-leg methods) and the
  `renderer-globals.d.ts` types (also update the `GoldfinchInternalBridge` JSDoc host list at
  `:367` to include vault).
- **Entry**: `openVaultPage()` (trusted `createTab('goldfinch://vault', null, { trusted:true })`) in
  `overlay-menus.js` + `renderer.js` dispatch + a kebab/menu item to reach it.
- **DD8 reserved-id SSOT**: a standalone `src/shared/reserved-ids.js` (CJS) exporting the reserved-id
  constant; `vault-store.js` + `jars.js` consume it; a cross-module test asserting the vault-store
  sentinel ∈ jars reserved ids (export `GLOBAL_ID` from `vault-store.js` or assert via the shared
  constant directly).

## Acceptance Criteria

- [x] `goldfinch://vault` loads as a **trusted internal page** (internal session,
      `contextIsolation:true`, `sandbox:true`, strict CSP) reachable via an `openVaultPage()` chrome
      affordance; a web tab cannot navigate to it (the four gates hold — `isSafeTabUrl` rejects it).
      *(Four gates admit it: `'vault'` ∈ `INTERNAL_HOSTS` → `isInternalPageUrl` true / `isSafeTabUrl`
      still false; `'goldfinch://vault'` ∈ both `INTERNAL_ORIGINS`; `vault:` route in the map; CSP
      inherited via `handleInternal`. Live-GUI reachability is the F5 HAT — DD9.)*
- [x] The page renders **not-set-up** (setup CTA → stub), **locked** (unlock affordance → stub;
      vault labels shown, no counts), and **unlocked** (vault list: `'Global'` + jars, **labels
      only**) from `internal-vault-state`; no secret in the state payload (grep AC).
      *(`vault-page-model.selectVaultView` unit-tested for all three modes; `register-vault-ipc.test.js`
      asserts labels-only rows `{vaultId,label}` and no secret-shaped keys in the payload.)*
- [x] `internal-vault-state` (and every future vault handler) is `registerInternalHandler`-gated — a
      non-internal sender is rejected (`forbidden`), unit-tested; the handler enumerates via the
      injected `jars` dep (`'global' + jars.list()`). *(Tested with the REAL `registerInternalHandler`
      — wrong origin AND missing internal marker both throw `forbidden`.)*
- [x] **Reserved-id SSOT**: one shared constant in a standalone `src/shared/reserved-ids.js` (CJS);
      `vault-store.js` + `jars.js` consume it; a cross-module test asserts `vault-store` sentinel ∈
      jars reserved ids. No behavior change; `vault-store` stays Electron-free (no `app-db` coupling).
- [x] Every new `goldfinchInternal` bridge method has a `renderer-globals.d.ts` entry (+ JSDoc host
      list updated); typecheck clean.
- [x] Existing tests pass unmodified; `npm test` (2410 pass), `npm run typecheck`, lint clean.
      *(Two exact-shape contract tests — `internal-page-map.test.js` host set, `overlay-menus.test.js`
      kebab ids — had their expected-value lists extended for the new page/menu item; see flight-log.)*

## Verification Steps

- Unit/integration: `register-vault-ipc` `internal-vault-state` returns the right shape (labels only,
  no secret) + rejects a non-internal sender (fake `ipcMain`/event, `register-settings-ipc.test.js`
  pattern); the reserved-id cross-module test; page-logic state-selection if factored purely.
- `npm test` full — F2 sheet tests + all pre-existing green. `npm run typecheck` + lint clean.
- Grep: `internal-vault-state` payload carries no `password`/secret.
- (Live-GUI reachability of `goldfinch://vault` + its a11y are the F5-HAT / chrome-state-a11y steps —
  DD9; not headless here.)

## Implementation Guidance

1. **Allowlists** — add `'vault'` to `INTERNAL_HOSTS` (`url-safety.js:84`) and `'goldfinch://vault'`
   to `INTERNAL_ORIGINS` in **both** `internal-ipc.js:25` and `internal-preload.js:24`. These three
   edits are what make the four gates admit the page (`CLAUDE.md:74`).
2. **Route map** — add a `vault:` entry to `internal-page-map.js` mapping the page + each shared
   module it imports (the strict CSP has no directory passthrough; honor the three-point seam).
3. **Page shell** — `vault.{html,css,js}` modeled on `downloads.*`; `type="module"` scripts; render
   the three states from `vaultState()`. Correct landmarks (`main`, headings, list roles) for the
   unit-aria a11y (DD9). Guard every bridge call with "bridge exists on the genuine origin only"
   (`settings.js:120,550` idiom).
4. **IPC scaffold** — `register-vault-ipc.js` mirroring `register-settings-ipc.js`; inject the vault
   store singleton **and `jars`** (the store has no public vault-enumeration method); land
   `internal-vault-state` → `{ setUp, unlocked, vaults: [{ vaultId, label }] }` (`'global'` +
   `jars.list()`, labels only, no MRK, no counts). Wire it at the `main.js` `registerSettingsIpc`
   composition site. Later legs add handlers here.
5. **Bridge + types** — `internal-preload.js` `vaultState()` wrapper (+ a `renderer-globals.d.ts`
   entry + the JSDoc host-list update); the origin gate already exists once `'goldfinch://vault'` is
   in `INTERNAL_ORIGINS`.
6. **Entry** — `openVaultPage()` in `overlay-menus.js` (trusted `createTab`) + `renderer.js` dispatch
   + a kebab/menu item. Mirror `openJarsPage()`. The not-set-up CTA and the locked-state unlock
   affordance are **stubs** in leg 1 (markers) — their real flows land in leg 4.
7. **DD8 SSOT** — create a standalone `src/shared/reserved-ids.js` (CJS) exporting the reserved-id
   constant; refactor `vault-store.js`'s `GLOBAL_ID` and `jars.js`'s `isReservedId` to consume it
   (do **not** route it through `jars.js`, which would couple `vault-store` to `app-db`); add the
   cross-module consistency test.
8. *(The DD5 template-registry refactor moved to leg 4.)*

## Edge Cases

- **Not-set-up first run** — the page must render cleanly on a fresh profile (no `manager.json`);
  `vaultState()` returns `setUp:false`; the CTA routes to setup (stubbed until leg 4).
- **Locked** — `unlocked:false`; the list shows vault labels + (optionally) that they're locked, no
  item counts requiring the MRK; the unlock affordance triggers the F2 sheet.
- **Reserved-id drift** — the cross-module test fails loudly if the two literals ever diverge.
- **CSP violation** — an unlisted shared module import is blocked by the strict CSP; every import
  must be in the map.
- **Shared-bridge blast radius (flag for leg 2+)** — adding vault to the internal-trust set means the
  vault page inherits the *entire* `goldfinchInternal` bridge (and vice versa — the "internal vs web,
  not per-page" model, `CLAUDE.md:64`). Because leg 2+ renders **attacker-influenced item strings**
  (titles/usernames/origins), its XSS blast radius is larger than the other internal pages; the strict
  CSP + **`textContent`-only rendering** (never `innerHTML`) are the load-bearing mitigations. Leg 1's
  shell renders only operator-controlled jar labels + "Global," so leg 1 is low-risk — but the
  discipline starts here.

## Files Affected

- `src/shared/url-safety.js`, `src/main/internal-ipc.js`, `src/preload/internal-preload.js` — allowlists.
- `src/main/internal-page-map.js` — route + module map.
- `src/renderer/pages/vault.{html,css,js}` — new page.
- `src/main/register-vault-ipc.js` (new) + `src/main/main.js` — IPC scaffold + wiring.
- `src/renderer/renderer-globals.d.ts` — bridge types.
- `src/renderer/chrome/overlay-menus.js` + `src/renderer/renderer.js` — `openVaultPage()` + dispatch + menu item.
- `src/shared/reserved-ids.js` (new) + `src/main/vault/vault-store.js` + `src/main/jars.js` — reserved-id SSOT.
- `test/unit/…` — `register-vault-ipc` state/guard, reserved-id cross-module.
- *(No `menu-overlay.js` changes — the template refactor is leg 4.)*

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
