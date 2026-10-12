# Leg: copy-to-ui

**Status**: completed
**Flight**: [Copy a Vault Item to Another Vault](../flight.md)

## Objective
Add the "Copy to…" row action and its two-step modal on `goldfinch://vault`, built in a new injected-deps controller (`vault-item-actions-controller.js`) that also takes over the existing delete-confirm and revoke-access-key-confirm modals, so `vault.js` shrinks below its current line count while the page gains the feature.

## Context
- Flight DDs that bind this leg: **DD8** (controller, injected deps, delete-confirm extraction, destination options, icon, row order), **DD9** (modal flow, notice-before-refresh, render epoch, focus across steps, page caches, shared-mechanism ACs), **DD3** (the `allowed` set the page renders exactly), **DD7** (reply shapes: `{ ok: true, outcome, match?, allowed?, title? }`, `{ ok: false, reason: 'busy'|'state'|'failed' }`, `{ locked: true }`).
- Depends on leg 1: `goldfinchInternal.vaultItemCopy(payload)` exists (preload + d.ts), with the reply shapes above. Read the landed leg 1 code and its flight-log entry before starting; if the reply shape differs from DD7, follow the code and record the deviation.
- **Destination labels**: reuse the page's existing destination idiom rather than inventing new copy — `copyDestinationOptions` is `browserImportDestinationOptions(jars, presence, globalPresence)` with the source vault filtered out ("Global — 3 secrets", "Work — no secrets yet"). This refines DD8's "Name — N items" wording for consistency with the restore and browser-import pickers.
- **Live verification is NOT in this leg.** Unlock is an operator step (the `vault-unlock` sheet is not automatable), so the live smoke test (every existing apparatus primitive against the new page state) and the `vault-copy-item` behavior test run with the operator at the start of leg 3 (HAT), on Goldfinch dev mode (DD11). This leg finalizes the spec against the shipped DOM so leg 3 can run it.

## Inputs
- `src/renderer/pages/vault.js` (2152 lines; `VAULT_PAGE_LINE_BUDGET = 2153`, `test/unit/seam-contract.test.js:367`):
  - controller wiring ≈ 90-137 (`createVaultFilter`, `jarRows`, `jarVaultPresence`, `lastViewVaults`, `createVaultBrowserImport`, `createVaultRestoreController` with `setNotice`)
  - `el` ≈147, `button` ≈160, `ICON_PATHS` ≈170-193 (`copy` = clipboard), `iconButton` ≈231-241
  - `pendingNotice` ≈423 (shown once by the next `render()` ≈2037-2042)
  - `openModal` ≈437-537 (`closeActivePageModal()` first, then captures `document.activeElement` as invoker); `appendOption` ≈545
  - `openDeleteConfirm` ≈1370-1408 (doc comment + body; refs `el`, `document.createTextNode`, `openModal`, `bridge.vaultItemDelete`, `refresh`)
  - `renderItems` row actions ≈1506-1522 (Edit, Delete)
  - `render()` ≈2013 (sole caller: `refresh()` ≈2084-2105)
- `src/renderer/pages/vault-browser-import-controller.js` — the injected-deps controller template (header, JSDoc deps typedef, flat `// @ts-ignore` import of `vault-page-model.js`)
- `src/shared/vault-page-model.js` — `browserImportDestinationOptions` ≈358-376, `restoreDestinationOptions` ≈219-247
- `test/unit/vault-filter-controller.test.js` — mock-DOM `El` + dynamic `import()` precedent
- Pins to update: `test/unit/seam-contract.test.js` (`VAULT_PAGE_LINE_BUDGET`), `src/main/internal-page-map.js` vault route (≈59-89), `test/unit/internal-page-map.test.js` (closed key list ≈43-56 + path assertion), `test/unit/vault-browser-import-invariants.test.js` (controller scan list ≈16-22; AC10 route-sum ≈98-162), `eslint.config.mjs` module file list (≈242-251)

## Outputs
- NEW `src/renderer/pages/vault-item-actions-controller.js` — `createItemActionsController(deps)` returning `{ openDeleteConfirm, openRevokeConfirm, openCopyTo }`
- `src/renderer/pages/vault.js` — delete-confirm and revoke-confirm removed; controller constructed; row gains Copy-to; `renderEpoch` counter; `copy-to` icon; `vault.js` line count strictly lower than before
- `src/shared/vault-page-model.js` — `copyDestinationOptions`
- `src/renderer/pages/vault.css` — a minimal `.vault-copy-choice` rule set for the native radio group (design review: no `fieldset`/`legend`/radio rules exist on this page; a bare UA fieldset renders a border/padding/min-width quirk on the dark theme)
- Route, eslint, invariant and budget pins updated
- NEW `test/unit/vault-item-actions-controller.test.js`; `test/unit/vault-page-model.test.js` extended
- `tests/behavior/vault-copy-item.md` finalized against the shipped DOM (status stays `draft` until its first run)

## Acceptance Criteria

**Controller and extraction**
- [ ] AC1 `vault-item-actions-controller.js` exports `createItemActionsController(deps)` with deps `{ document, bridge: { vaultItemDelete, vaultAccessKeyRevoke, vaultItemCopy, vaultState }, dom: { el, iconButton, openModal, appendOption }, copyDestinationOptions, getJarRows, getJarVaultPresence, getRenderEpoch, refresh, setNotice }` (JSDoc-typed like `vault-browser-import-controller.js`). It statically imports NOTHING from `src/shared/` (pure helpers are injected), so the unit test loads it via dynamic `import()` without the internal-page map.
- [ ] AC2 `openDeleteConfirm` (vault.js ≈1370-1408) AND `openRevokeConfirm` (≈1410-1447, same shape; its caller passes `refreshKeys`) moved verbatim in behavior (same titles "Delete item" / "Revoke access key", same message text nodes, danger submits, `{locked}` → close + `refresh()`, success → close + `refresh()` / `refreshKeys()`, catch → "Could not delete the item." / "Could not revoke the access key."); grep AC: `grep -nE "openDeleteConfirm|openRevokeConfirm" src/renderer/pages/vault.js` → only `itemActions.open…(` call sites. The revoke move is the DEFAULT, not a fallback (design review: delete-confirm alone nets ≈ −4..+2 lines). TDZ checklist: the controller is constructed after `el`, `iconButton`, `openModal`, `appendOption`, `refresh` and `bridge` are in scope; reassigned `let`s (`jarRows`, `jarVaultPresence`) are read through getters.
- [ ] AC3 `vault.js` final Prettier line count (`split(/\r?\n/).length`) is strictly less than 2152, and `VAULT_PAGE_LINE_BUDGET` is retargeted to EXACTLY that count (with a one-line history note in the test, the existing style). Design-review arithmetic: −≈40 (delete) −≈39 (revoke) vs +≈36-42 (import 2, construction 18-22, epoch 2, icon 4-6, row button 8-9) → net ≈ −35. If it still does not net negative, stop and report (do not compact).

**Row action and destination step**
- [ ] AC4 (source-scan pinned in the new test: the `renderItems` actions block appends Edit, Copy-to, Delete in that order — vault.js is not unit-loadable) Each typed item row (`renderItems`) shows Edit, Copy to…, Delete in that order. The Copy-to button is `iconButton('copy-to', \`Copy ${meta.title || 'item'} to another vault\`, …)`; `ICON_PATHS['copy-to']` is a NEW glyph distinct from `copy` (e.g. a folder-with-arrow or arrow-into-box path set). Rows from `renderUnknownItems` get no Copy-to button.
- [ ] AC5 `copyDestinationOptions(jars, presenceById, globalPresence, sourceVaultId)` in `vault-page-model.js` returns `browserImportDestinationOptions(jars, presenceById, globalPresence)` minus the option whose `vaultId === sourceVaultId`; never throws on malformed input. Unit tests: source Global → only jars; source a jar → Global + the other jars; a jar with no vault keeps its "no secrets yet" label; empty jars + source Global → `[]`.
- [ ] AC6 `openCopyTo({ vaultId, meta, invoker })` opens step 1: title `Copy “<title>” to…` (title via `textContent`; null title → "(untitled)"), a labelled `<select>` (`aria-label` "Copy destination") of `copyDestinationOptions(...)` (global presence from a fresh `bridge.vaultState()` read, the browser-import precedent), submit "Copy". With zero options the body says "There is no other vault to copy to." and submit stays disabled.

**Collision step and outcomes**
- [ ] AC7 On `{ ok: true, outcome: 'needs-resolution', match, allowed }`, the controller re-focuses `invoker` (the row's Copy-to button, passed explicitly by the row's click callback; only if `isConnected`) and opens step 2: title "Already in <destination label name>", a message naming the match (`match.title` or "(untitled)", plus `match.username` for a login), and a radio group (`fieldset` + `legend`, one labelled `input[type=radio][name=...]` per entry in `allowed`, in the order skip, replace, keep-both). Non-identity: Skip is pre-selected. Identity (`allowed` = `['replace']`): the single Replace option reads "Replace the existing identity profile" and is pre-selected. Submit label follows the selection ("Skip" / "Replace" / "Keep both"); Replace's option text states the existing item's fields will be overwritten. The radio group is `<fieldset class="vault-copy-choice">` + `<legend>` + one `<label>` per radio; the controller reads the checked radio AT SUBMIT TIME (never a cached value). Submitting calls `vaultItemCopy({ sourceVaultId, itemId, destVaultId, resolution, matchId: match.id })`. `vault.css` gains `.vault-copy-choice` (border 0, padding 0, margin 0, min-width 0; legend styled like `.vault-field-label`; each radio row a flex row with a gap) using existing color tokens only.
- [ ] AC8 A `needs-resolution` reply to a step-2 commit (stale) re-renders step 2 from the NEW `match`/`allowed`, with the status line "This vault changed since you chose — please choose again." (role=status via `setStatus`).
- [ ] AC9 Terminal outcomes: close the modal, `setNotice(text)`, then `refresh()` — in that order (notice before refresh). Texts: `copied` "Copied to <dest>."; `kept-both` "Copied to <dest> as “<title>”." (title from the reply); `replaced` "Replaced “<match title>” in <dest>."; `skipped` "Skipped — nothing copied."; `already-present` "Already in <dest> — nothing copied." `<dest>` is the destination option's name part (the text before " — "), never a raw id.
- [ ] AC10 Errors keep the modal open with `setStatus`: `reason: 'busy'` → "A vault rotation is in progress — try again when it finishes."; `'state'` → "This item could not be copied to that vault."; anything else / a rejected invoke → "Copy failed."; submit re-enabled. `{ locked: true }` → close + `refresh()` (no notice). No code path renders any reply field other than `match.title`, `match.username`, the kept-both `title` and destination labels — all via `textContent`.
- [ ] AC11 **Render epoch** (DD9): `vault.js` has `let renderEpoch = 0;` incremented as the first statement of `render()`, injected as `getRenderEpoch: () => renderEpoch`. The controller captures the epoch at EACH modal open (step 2 re-captures at its own open), and every `submitCopy(payload, epoch, handle)` carries the epoch of the modal that sent it; when a reply resolves after the epoch moved it opens no modal and calls no `setStatus`, but for a WRITTEN outcome (`copied`/`replaced`/`kept-both`) it still calls `setNotice(text)` then `refresh()`; `needs-resolution`/`skipped`/`already-present`/`ok:false`/`{locked}` are dropped silently.

**Unit tests (`vault-item-actions-controller.test.js`, mock DOM, dynamic import)**
- [ ] AC12 The test brings its OWN mock `El` (the `vault-filter-controller.test.js` shape is the starting point but lacks `checked`, `name`, `disabled`, meaningful `hidden`, `setAttribute`/`getAttribute`, and a simple event dispatch for `click`/`change`) plus a mock `document` with `createElement` and `createTextNode`. All copy strings (AC6-AC10) live in one frozen constants object exported from the controller (e.g. `COPY_TEXT`), and tests assert against it. Cover: delete-confirm parity (title, message text nodes, submit → `vaultItemDelete` args, `{locked}` path, rejected path status text); step-1 options exclude the source; zero-destination state; every terminal outcome's notice text AND call order (`setNotice` before `refresh` — record calls in one ordered log); step 2 for one-match (3 radios, Skip checked), several-match (2 radios, no Replace), identity (1 radio, Replace checked, identity copy); the commit payload carries `matchId: match.id`; stale re-render with the status line; each error reason's text and submit re-enabled; `{locked}`; render-epoch matrix (epoch bumped between invoke and resolve × {`copied`, `needs-resolution`, `{locked}`, `ok:false`}: only `copied` produces `setNotice`+`refresh`, none opens a modal or sets status); focus: before step 2 opens, `invoker.focus` was called when `invoker.isConnected`, and not when detached; a `null` match title renders "(untitled)"; no secret marker passed in a hostile reply (e.g. an extra `password` key) reaches any element's `textContent`.

**Shared-mechanism non-regression (CLAUDE.md planning rule; DD9)**
- [ ] AC13 Unchanged users of `openModal` / `render()` / `pendingNotice`: the item editor (its `editorCleanups` drain before `closeActivePageModal`), access-key revoke confirm, browser-import modals, restore/export modals (`setNotice` users), and the vault filter (reset on refresh, as today). The moved revoke confirm keeps its `refreshKeys` success path (access-keys subsection re-list) — covered in AC12. Evidence: `openModal`'s body and signature unchanged (`git diff` of that function is empty); `render()`'s only change is the epoch increment; existing suites `vault-filter-controller`, `vault-nav-controller`, `vault-browser-import-invariants`, `vault-restore-*`, `seam-contract`, `vault-page-model` pass unmodified except the listed pin edits.

**Pins and spec**
- [ ] AC14 `internal-page-map.js` vault route gains `'/vault-item-actions-controller.js': rendererPage('vault-item-actions-controller.js')` with a comment in the neighbors' style; `internal-page-map.test.js` closed key list + a path assertion updated; `vault-browser-import-invariants.test.js` AC10 route-sum gains a "Sortie 04" block; a NEW source-scan block (in the new controller test or the invariants file) asserts over `vault-item-actions-controller.js`: no `innerHTML|insertAdjacentHTML|outerHTML`, `bridge.vaultItemCopy(` appears exactly once (the shared submit path), and no `src/shared/` static import; `eslint.config.mjs` module list includes the new file with a comment.
- [ ] AC15 `tests/behavior/vault-copy-item.md` finalized against the shipped DOM: real selectors/labels/notice texts substituted for the draft's descriptive wording; a new **step 0** (live smoke, CLAUDE.md planning rule) exercising every existing apparatus primitive against the copy modal state — `enumerateTabs`, `enumerateWindows`, `captureWindow`, `captureScreenshot` (vault tab), `readDom`, `readAxTree`, `evaluate` — each returning without error while the step-1 modal is open; status stays `draft`.
- [ ] AC16 `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass (run `npm run format` first).

## Verification Steps
- AC1, AC6-AC12: `node --test test/unit/vault-item-actions-controller.test.js`
- AC2: the grep in AC2; `git diff main -- src/renderer/pages/vault.js` shows the delete-confirm body removed, not altered elsewhere
- AC3: `node -e "console.log(require('fs').readFileSync('src/renderer/pages/vault.js','utf8').split(/\r?\n/).length)"`; `node --test test/unit/seam-contract.test.js`
- AC4: read `renderItems`; controller test covers the button label via a vault.js source-scan or a row-render assertion (source-scan acceptable — vault.js is not unit-loadable)
- AC5: `node --test test/unit/vault-page-model.test.js`
- AC13: `git diff main -- src/renderer/pages/vault.js` reviewed for `openModal`/`render` hunks; full `npm test`
- AC14: `node --test test/unit/internal-page-map.test.js test/unit/vault-browser-import-invariants.test.js`; `npm run lint`
- AC15: read the spec
- AC16: `timeout 300 npm test && npm run typecheck && npm run lint && npm run format:check`

## Implementation Guidance
1. Read leg 1's landed code (`register-vault-ipc.js` handler, `vault-store.js` `copyItem` return shape) and flight-log entry first.
2. Add `copyDestinationOptions` + tests.
3. Create the controller: move `openDeleteConfirm` first (behavior-identical), then build `openCopyTo` with small internal helpers (`renderStep1`, `renderStep2`, `finish(outcome)`, `fail(reason)`); keep one `submitCopy(payload, epoch, handle)` path for both steps.
4. Wire `vault.js`: import (flat specifier + `// @ts-ignore` before the `} from` line, the browser-import precedent), construct after `refresh`/`openModal` are in scope (function declarations hoist; `bridge` is a const above), inject `copyDestinationOptions` from the existing `vault-page-model.js` import, add `renderEpoch`, add the row button, add the icon, remove the old function and its doc comment.
5. Pins (route, eslint, invariants, page-map test, budget) — measure the final line count AFTER `npm run format`.
6. Finalize the behavior spec.

## Edge Cases
- **Destination select default**: first option selected; no "please choose" placeholder.
- **Source vault deleted (jar removed) while the modal is open**: main returns `state` → AC10 text.
- **Copy-to on an item in Global while no jars exist**: zero-destination state (AC6).
- **Double-submit**: submit disabled from click until the reply lands (both steps).
- **Escape/backdrop on step 2**: plain dismissal, nothing sent (identity "Cancel" is this).
- **Item deleted by another window between open and submit**: main returns `state` → AC10 text (unit row).
- **Zero destinations**: the button stays (the modal explains why) — FD call, design review question 2.
- **Render epoch live proof**: a lock landing while a copy invoke is in flight cannot be driven by the apparatus (the main-side op is synchronous and sub-millisecond); the AC11 unit matrix is the proof, and the behavior spec's Out of Scope says so.

## Files Affected
- `src/renderer/pages/vault-item-actions-controller.js` — new
- `src/renderer/pages/vault.js` — extraction, wiring, epoch, icon, row button
- `src/shared/vault-page-model.js` — `copyDestinationOptions`
- `src/renderer/pages/vault.css` — only if needed
- `src/main/internal-page-map.js`, `eslint.config.mjs` — new controller entries
- `test/unit/vault-item-actions-controller.test.js` — new
- `test/unit/vault-page-model.test.js`, `test/unit/seam-contract.test.js`, `test/unit/internal-page-map.test.js`, `test/unit/vault-browser-import-invariants.test.js` — pins
- `tests/behavior/vault-copy-item.md` — finalized

## Citation Audit
Checked 2026-10-12 against `d16dfb2` (leg 1 in progress touches none of these files except `renderer-globals.d.ts`): `vault.js` wiring 90-137, `el` 147, `button` 160, `ICON_PATHS` 170-193, `iconButton` 231-241, `pendingNotice` 423, `openModal` 437, `appendOption` 545, `openDeleteConfirm` 1370-1408, row actions ≈1506-1522, `render` 2013 (notice 2037-2042), `refresh` 2084-2105; `vault-page-model.js` `browserImportDestinationOptions` 358-376; `internal-page-map.js` vault route 59-89; `eslint.config.mjs` 242-251; `internal-page-map.test.js` 43-56/74-83; `vault-browser-import-invariants.test.js` 16, 98-162. No vanished content.

---

## Post-Completion Checklist
Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
