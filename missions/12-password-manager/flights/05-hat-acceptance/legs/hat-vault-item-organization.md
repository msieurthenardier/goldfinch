# Leg: hat-vault-item-organization — Per-vault type subsections + modal editor

**Status**: landed
**Flight**: [HAT + Alignment — End-to-End Acceptance](../flight.md)

## Objective

Rework each vault's section on the Secrets page (`goldfinch://vault`) from a flat, single-list layout with a
type-dropdown + inline editor into a **typed master-detail**: a title row with the vault's identity marker,
**per-type subsections** (Logins / Cards / Notes / Access keys) each with its own list + **Add** button, **per-row
Edit + Delete** controls (delete confirmed), and the **add/edit form moved into a modal** (no more inline
editor host). Operator-designed live during the F5 HAT.

## Context

- **This is a FEATURE + a security-sensitive restructure** (the item editor handles vault secrets). Risk-tier
  **HIGH** → design review before implementation.
- **Current shape** (all in `src/renderer/pages/vault.js`):
  - `buildVaultSection` (:771) — head = `h3` title `${label} (${count})` + a **type `<select>`** (:793) + an
    **Add** button (:801) that opens a **blank inline editor** in a per-section `editorHost` (:789); then one
    flat `vault-item-list` (:807) populated from `bridge.vaultList(vaultId)` via `renderItems` (:902); then
    (jars only) `buildAccessKeysSection` (:820).
  - `renderItems` (:902) — each row is a single `vault-item-open` **button** (title/type/sub) that opens the
    editor (:920); the origin is a **scheme-guarded** link (`safeHttpUrl`, :930) kept OUTSIDE the button.
    There are **no per-row Edit/Delete controls** today — Delete lives INSIDE the editor (:1040).
  - `openEditor` (:950) — builds the rich form into the inline host: non-secret fields, **secret fields**
    (masked-until-reveal via `buildSecretField` :1069; `MASK` placeholder; per-field Reveal/Copy; clear a pure
    reveal on blur), the **TOTP widget** (arms timers/listeners registered in `editorCleanups`), the login
    **matchMode** checkbox + **password generator**, and Save/Delete/Cancel (:1024-1052). `wipeSecretInputs`
    runs on **Save and Cancel** (:1031,1050). `assembleSave` + the out-of-band `unchangedSecrets` signal
    (:1028) preserve unrevealed secrets.
  - `closeEditor` (:1319) — drains `runEditorCleanups()` (TOTP timers) + clears the host.
  - `buildAccessKeysSection` (:836) — head (`h3` "Access keys" + **Mint** → chrome step-up sheet, :847) + a
    `renderAccessKeys` list (:876) of `keyId` + immediate **Revoke** (:886, no confirm).
- **Reusable modal infra already exists** (I14, this flight): `openModal({ title, body, submitLabel, onSubmit,
  onCancel, submitEnabled })` in `vault.js` — role=dialog / aria-modal, Tab focus-trap, Esc + backdrop
  dismiss, focus-return, single-open via `activePageModal`, torn down in `render()` via `closeActivePageModal()`
  (M5). The item editor becomes this modal's `body`.
- **Jar identity for the title dot**: `jarRows` is already cached for the nav dots (`{id, color}`); reuse it
  with the existing `isSafeColor` guard (never a raw color into a style). Global uses the globe icon
  (`ICON_GLOBE` idiom from `vault-nav-controller.js`), not a dot.

## Security invariants (MUST hold — DD6; the load-bearing risk of this leg)

Moving the editor into a modal must preserve **every** secret-handling invariant that `openEditor`/`closeEditor`
enforce today:

1. **Masked-until-reveal** — secret inputs start empty with the `MASK` placeholder; a value only appears after
   an explicit per-field Reveal (fetched on demand); a pure reveal clears on hide/blur.
2. **Wipe on EVERY exit** — a revealed secret must never survive a modal exit in the DOM. **[Design-review
   HIGH]** `openModal`'s `close()` (vault.js:310) runs **neither** `onCancel` **nor** `wipeSecretInputs`, and
   the `render()`/idle-lock path reaches `close()` via `closeActivePageModal()` (:1359/:251) — so a wipe wired
   only into `onCancel` is **skipped** on the idle-lock close, leaving a revealed secret in the detached-but-
   live input. **Fix: register `() => wipeSecretInputs(secretInputs)` into the `editorCleanups` registry**
   (:207) at editor-modal build time, mirroring the TOTP cleanup — then `render()`'s `runEditorCleanups()`
   (:1353, run BEFORE `closeActivePageModal()` while the modal is still attached) zeroes the inputs on the
   idle-lock path too. Keep the synchronous pre-roundtrip `wipeSecretInputs` on Save to shrink the reveal
   window.
3. **TOTP teardown** — the TOTP widget's per-period poll + listeners register in `editorCleanups`; **every**
   close path must drain `runEditorCleanups()`. **Do NOT rely on `handle.close()` — it drains nothing.** Wire
   `onCancel` (Esc/backdrop/Cancel) and `onSubmit` (after a successful save) to call `runEditorCleanups()`
   THEN `handle.close()`; and keep `openEditor`'s existing `runEditorCleanups()` (:951) BEFORE `openModal()`
   so the preempting `closeActivePageModal()` (:275) can't detach a prior editor modal with un-drained
   cleanups. `render()` (:1353) covers the idle-lock path.
4. **No secret in the DOM until reveal; `textContent`-only** for all labels/titles/usernames (attacker-
   influenced strings); the origin renders as a link ONLY when `safeHttpUrl` accepts its scheme, else inert
   text. `assembleSave` + `unchangedSecrets` preserved.
5. **Access-key secrets never touch the page** — Add = Mint routes to the chrome-owned step-up sheet; the
   minted secret shows only on the chrome `accesskey-show` sheet. `keyId` is a non-secret fingerprint.

## Requirements (operator design)

1. **Title row** — replace `${label} (${count})` with a **jar color dot + vault name** (Global: globe icon +
   "Global"). Use the entry's own `child.color` + `child.kind` (`vault-page-model.js:102-105` — the child
   already carries `color` and `kind: 'global'|'jar'`), applying `isSafeColor(c) ? c : fallback` (the nav-dot
   idiom, `vault-nav-controller.js:127`) — no need to re-derive from `jarRows`.
2. **Per-type subsections** — partition the vault's items (one `vaultList` read, split client-side by
   `item.type`) into **Logins / Cards / Notes**, each rendered as a subsection with its own heading, list, and
   an **Add** button that opens a blank editor modal **of that type** (the type `<select>` is removed —
   each Add knows its type). **[Design-review LOW]** partition **defensively**: bucket only the known types
   (`login`/`card`/`note`, single-sourced in `vault-item-schema.js:24`) and surface an unexpected `item.type`
   rather than silently dropping it. Extract the partition as a **pure helper and unit-test it** (see
   Verification) — it is the one cleanly unit-testable new piece. **Access keys** (jars only) is a fourth
   subsection with the same head+list shape; its Add = **Mint**.
3. **Per-row Edit + Delete** — each item row shows its info (title, sub, scheme-guarded origin link) plus an
   **Edit** button (opens the edit modal) and a **Delete/trash** button. Delete requires a **confirmation**
   (a confirm modal). The Edit + Delete controls sit together with **no divider between them**. Delete moves
   OFF the editor (the edit modal is Save/Cancel only).
4. **Add/Edit is a MODAL** — the editor form renders in `openModal`'s body, not the inline `editorHost` (the
   host is removed). Save = submit; Cancel/Esc/backdrop = wipe + teardown + close.

## Design decisions (made here; confirm at review)

- **DD-A. Empty subsections still render** (heading + "No logins yet." + Add) so Add is always reachable —
  the master-detail reads consistently even for an empty type.
- **DD-B. Access-key Revoke gains a confirmation** to match the new delete-confirm pattern (revoking is
  destructive — it breaks live automation). Add = "Add" (aria "Mint access key") for label uniformity.
- **DD-C. Reuse `openModal` for BOTH** the editor (rich body) and the delete/revoke confirm (message body +
  danger submit). No modal nesting: per-row Delete opens the confirm directly (no editor open at the time).
- **DD-D. Editor-modal teardown via the `editorCleanups` registry** (per the design-review HIGH). Register
  `() => wipeSecretInputs(secretInputs)` into `editorCleanups` at build time (alongside the TOTP widget's
  cleanup). Then: `onCancel`/`onSubmit` call `runEditorCleanups()` then `handle.close()`; `openEditor` keeps
  its top-of-function `runEditorCleanups()` BEFORE `openModal()`; and `render()`'s existing
  `runEditorCleanups()` (run before `closeActivePageModal()`, while the modal is still attached) covers the
  idle-lock path. `handle.close()` is used ONLY to remove the backdrop + restore focus — it is never the
  teardown, because it drains nothing.

## Acceptance Criteria

- [ ] Each vault section shows a **title row with a jar color dot + name** (Global: globe + "Global").
- [ ] Items are split into **Logins / Cards / Notes** subsections, each with its own list + **Add** button;
      the type `<select>` is gone; Add opens a blank editor **modal of that type**.
- [ ] **Access keys** (jars only) is a subsection with an **Add**(=Mint) button + a list; Global has none.
- [ ] Each item row has **Edit** + **Delete** controls with no divider between them; Edit opens the edit
      modal; **Delete opens a confirm modal**, and only deletes on confirm.
- [ ] The **add/edit form is a modal** (no inline editor host); Save persists + closes; **Esc / backdrop /
      Cancel wipe every secret input and drain the TOTP cleanups** before closing.
- [ ] **Every DD6 secret invariant holds in the modal**: masked-until-reveal, per-field Reveal/Copy, pure-
      reveal clears on blur, `unchangedSecrets` preserves unrevealed secrets on save, no secret in the DOM
      until reveal, `textContent`-only, scheme-guarded origin link.
- [ ] Access-key **Revoke** is confirmed (DD-B); Mint still routes to the chrome step-up sheet (no secret on
      the page).
- [ ] `npm run typecheck`, `npm test`, lint clean. **[Design-review MEDIUM]** the page DOM is deliberately
      NOT unit-covered (DD9) — the existing `vault-editor-model` / `vault-page-model` / `vault-accesskey-template`
      tests pin logic this leg PRESERVES and should stay green **unchanged** (do not force-edit them). The one
      cleanly unit-testable new piece is the **partition-by-type pure helper** — add a unit test for it. The
      modal secret-lifecycle regression net is the **live HAT + the DD6 grep**, per Verification.

## Verification

- **Unit**: partition-by-type of the item list; the per-row Edit/Delete wiring; the delete-confirm modal;
  the editor-in-modal secret lifecycle (masked/reveal/wipe-on-dismiss); the access-key Revoke confirm. Mirror
  the existing editor-model / secret-field tests.
- **Live (HAT, FD restart)**: operator adds a login/card/note via the modal, reveals + copies a secret,
  edits + saves, deletes with confirm, mints + revokes an access key — across Global + a jar.
- **DD6 grep**: no secret enters the page DOM until reveal; the modal dismiss paths wipe; TOTP timers don't
  outlive a closed modal.

## Files Affected (anticipated)

- `src/renderer/pages/vault.js` — `buildVaultSection` restructure (title row + per-type subsections);
  `renderItems` → per-type render + per-row Edit/Delete; `openEditor` → editor-in-modal (drop inline host +
  the in-editor Delete); a delete/revoke confirm modal; `buildAccessKeysSection` Add-label + Revoke confirm.
- `src/renderer/pages/vault.css` — subsection heads, item-row action buttons (Edit/trash, no divider),
  title-row dot/globe, modal editor sizing.
- `src/shared/vault-editor-model.js` — only if the type-partition or layout needs a shared helper (prefer
  client-side partition in vault.js; avoid changing the secret model).
- `test/unit/*` — vault page-model / editor-model / secret-field / access-key tests updated for the new
  structure; a partition helper test if one is added.

## Edge Cases

- **Locked vault** — the per-type subsections gate on unlock as today (`buildLockedVaultSection` unchanged);
  the modal only opens from the unlocked view.
- **Idle auto-lock mid-edit** — `render()` M5 teardown closes the modal AND drains `runEditorCleanups()`;
  ensure a lock during a revealed edit wipes secrets (the close path runs `wipeSecretInputs`).
- **Empty type** — DD-A: heading + empty state + Add.
- **Global vault** — globe title, no dot, **no access-keys subsection**.
- **Delete confirm then lock race** — the delete invoke already handles `{ locked }` (refresh); the confirm
  modal closes on either outcome.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (+ operator live-review: row/header polish, icon buttons, in-field reveal/copy)
- [x] Tests passing (`npm test` 2680/0, typecheck, lint)
- [x] Flight-log updated (I15 + the operator polish note)
- [x] Leg status → `landed`
- [x] Commit on the flight/05 branch
