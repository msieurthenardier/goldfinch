# Leg: vault-picker-controls

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Make a vault fill impossible to give by accident: the picker names where the fill will go, opens with nothing selected and ignores activation for a moment, a card or identity asks once per site, and a site reached through a certificate override offers nothing until the operator acknowledges a warning.

Second of the two legs delivering DD4 and DD6 (with DD7's arming axis). It builds on leg `vault-fill-trust`, which already supplies a main-held picker context and carries its id, the destination display string and the certificate flag to the chrome.

## Context

- **Decisions**: DD6; DD7 as amended at design review — **the sheet derives arming from its own menu type and one shared table**; the chrome-set flag and main's re-derivation in DD7's text are dropped as redundant, because the sheet already takes its menu type from main's init. Logged as a deviation from the flight spec.
- **Why**: leg `vault-fill-trust` leaves one accepted residual — a hostile page can turn a real click anywhere on itself into a picker raise. Everything in this leg is the defence against that click and against a stray Enter or double-click.
- **What is true today** (surveyed 2026-11-13): the picker (`src/shared/vault-picker-template.js`, `renderVaultPickerRows`; card in `src/renderer/menu-overlay.js`) shows no destination; its open focuses the first row (any non-number start index becomes 0, and only −1 means "last"); every row is a native button whose `click` listener calls `sendActivatedOnce`, so pointer, Enter and Space all arrive there; there is no arming anywhere on the sheet; cards and identities are offered on every site with no record of where they have been used. `src/shared/sheet-accelerator.js` maps only modifier chords and function keys — Enter and Space never pass through it.
- **Decisions taken at leg design** (logged):
  1. Confirmation is a second **view of the picker** — same menu type, opened afresh by the chrome after the pick closes the sheet — so arming applies again and no new menu type is threaded through the sheet's allowlists.
  2. The picker's model stays a flat array of rows; destination, view mode and the certificate flag travel as separate top-level fields of the open payload.
  3. `confirmedOrigins` is preserved main-side on every save (the vault page never holds it and must not be able to set it), stripped on cross-vault copy, ignored by bundle merge comparison, and appended by a dedicated store operation that does not touch `updatedAt`.
  4. Arming in this leg opts in `vault-picker` only; the cert picker, cert override and auth card opt in during `prompts-and-bounds`.
- **Not in this leg**: the gesture, the context and the fill-target rule (previous leg); DD7's other consumers; a "forget confirmed sites" control on the vault page (the field stays invisible there — noted as a possible follow-up).

## Inputs

- Leg `vault-fill-trust` landed: `pendingVaultFlow` carries the context id, destination and certificate flag; `vault-fill-human` requires a context and checks origin equality.
- `src/renderer/chrome/overlay-menus.js` `open()`, `src/main/menu-overlay-manager.js`, `src/renderer/menu-overlay.js` (`onInit`, `onOpen`, `focusItem`, `sendActivatedOnce`, `buildVaultSheetHeader`, `modelShapeOk`), `src/renderer/menu-controller.js` (roving keys), `src/shared/vault-blur-survival.js` (the shared-table idiom).
- `src/main/vault/vault-store.js` (`_saveItemPreservingSecrets`, `_copyItem`, `mergeVaultItems`, `_normalizeItem`), `src/shared/vault-item-schema.js` (`metadataOf`), `src/shared/copy-plan.js` (`isIdenticalItem`), `test/unit/vault-rekey-gate.test.js` (pins the count of gated store operations).

## Outputs

- The sheet's arming axis and its shared table.
- The picker's destination line, no-selection open, certificate warning view and confirmation view.
- `confirmedOrigins` on card and identity items with its write-path handling.
- One new chrome → main channel for acknowledging the certificate warning.
- Updated unit tests, `docs/vault.md`, `CLAUDE.md`.

## Acceptance Criteria

### Arming (DD7)

- [ ] A pure shared module maps opted-in menu types to an arming delay; this leg lists `vault-picker` at **500 ms** and nothing else. A source-scan drift guard asserts every listed type is one of the sheet's templates (the template table is private to `menu-overlay.js`).
- [ ] Arming is a **timestamp gate, not a timer**, inside the sheet's shared one-shot activation sender (`createSheetReport` in `modal-card-controller.js`): it takes an injected clock; `begin` receives the delay for the opening menu type and records "armed until"; an activation before that time returns false **without setting the one-shot latch**, so a later activation still works and nothing closes. A timestamp cannot be starved by timer throttling in a hidden document. Every other menu type opens with a zero delay and behaves exactly as today.
- [ ] Every init — a fresh open and a same-menu-type model replace alike — goes through `begin`, so arming restarts on both.
- [ ] Dismissals are not delayed: Escape, the header close control, the backdrop, and the confirmation view's Cancel (below) do not pass through the activation sender.
- [ ] Unit pins on the sender with a fake clock: an activation during arming sends nothing and leaves the latch unset; the same activation after the delay sends once; a second `begin` re-arms; a zero delay activates immediately. A source-scan pin asserts the picker's row listener — the one path pointer, Enter and Space all reach — calls the gated sender and nothing else calls the bridge directly for the picker.
- [ ] `[by-eye]`: Enter and Space during arming (the unit DOM only fires `click`); the inert style while arming (one style hook, cleared by a cosmetic timer).

### No selected row

- [ ] The vault picker's own open handler ignores the start index and always focuses its list container — no sentinel value (a negative index wraps in `focusItem`, so none is safe) and no change to the shared open path. This holds for every picker view.
- [ ] From "nothing focused", ArrowUp goes to the **last** row (today the roving code computes index −2 and lands on the second-to-last); ArrowDown, Home and End already behave correctly; Enter and Space on the container do nothing. Unit-pinned in `menu-controller.test.js`; for every other menu focus is always on an item, so nothing else changes.

### Destination

- [ ] The picker card gains a destination line ("Fill on …") as a new node **between** the header and the list — not inside the header, whose structure existing tests pin — written with `textContent` on every init, length-capped in the sheet, and referenced by the list's `aria-describedby`. The destination string travels as one extra top-level field of the open payload (declared in the payload type); the view itself is derived from the model's entries, so the model stays a flat array. It appears in every picker view: unlocked, the locked generate / unlock two-row picker, the picker after unlock, the certificate warning view and the confirmation view.
- [ ] If the chrome has no destination for a picker it is about to open, it does not open it.

### Template choke points (both new views depend on these)

- [ ] `activationIdFor` reports each new action under its own id. Today any row without a pick index or one of the two known action ids reports "manage passwords", which would send a certificate-continue or confirm-fill click to the vault page.
- [ ] `isActionEntry` (or its successor) recognises the new entries; the "nothing to fill here" note is not rendered in the warning view or the confirmation view; the "Manage passwords" footer is **omitted** from both.
- [ ] Each of the four is unit-pinned on the pure template with the existing mock document.

### Certificate override

- [ ] When the gesture's certificate flag is set, the chrome opens the **warning view first on every branch** of its gesture handler — including the locked branch that would otherwise open the unlock sheet. The view offers no items, no generate row and no footer: a notice naming the condition and one action to continue.
- [ ] Continue calls a new owning-chrome channel that sets an acknowledged bit on the main-held context, then the chrome runs the branch it would have run (the existing handler body, extracted into a function).
- [ ] Main enforces it in the one place all three vault operations share (`requireContext`): a context whose certificate flag is set and not acknowledged is refused, with trace reason `certificate`; the two result mappings that translate a context refusal gain that case. The acknowledge handler looks the context up without that clause. Unit-pinned per operation.
- [ ] The new channel is added to the classification table, `main.js`, the chrome preload, the type declarations and the count pins (`ipc-gate-invariant.test.js`, `preload-channel-literals.test.js`) together.
- [ ] The existing hop test whose fixture context has the certificate flag set is given an unflagged context, and a separate test covers the warning path on the unlocked, locked and locked-generate branches.

### Card / identity on a new site

- [ ] When the picked item is a card or identity and the context's origin is not among the item's confirmed origins, `vault-fill-human` fills nothing, records `{vault, item}` as pending on the context and answers `confirm-needed`. The context is not consumed (a non-filling answer already leaves it alive).
- [ ] **The confirm is an explicit, distinct call**: `vault-fill-human` takes `confirm: true`, which the chrome sends only from the confirmation view's Fill action. Main fills on an unconfirmed origin only when `confirm` is true **and** the pending record matches the item; any other call on an unconfirmed origin overwrites pending and answers `confirm-needed` again. Pinned: confirmation view up → vault locks → unlock → the picker reopens → the same card is picked → `confirm-needed` again, never a fill.
- [ ] On `confirm-needed` the chrome restores its flow in a confirming phase holding the picked row (mirroring how it restores the flow on `locked`), and reopens the picker as the confirmation view built from that row: title and the row's non-secret secondary line, the destination, and two actions — Fill and Cancel — neither focused, no footer.
- [ ] **Cancel is a dismissal**: it closes the sheet the way the header close control does, so the existing dismissal consumer drops the context and no new channel is needed; it is not subject to arming.
- [ ] After a confirmed fill main records the origin. A confirm for a different item, a missing context or a changed origin fills nothing and records nothing. A login never takes this step.
- [ ] Tests: a controller-level test (mock bridge — stated as a substitute for the real IPC) drives gesture → pick → `confirm-needed` → confirmation view → Fill, and the Cancel branch; one integration test runs `confirm-needed` through to the recorded origin against a real vault fixture file.

### `confirmedOrigins`

- [ ] A top-level array of origin strings on card and identity items. One small main-side module holds the tolerant reader (not an array → empty; non-string entries are filtered out), the cap (**50**, oldest dropped) and a pure append (an origin already listed is a no-op — no duplicate, no reordering, no write). Nothing is rewritten on load. No vault format version change.
- [ ] Recorded by a dedicated store operation written directly (decrypt, change the one item in place, encrypt, write) — **not** through the normaliser that stamps `updatedAt`. It is a gated operation: the gated-operations pin and its header comment move from 13 to 14 deliberately. The store has no change broadcast, so an open vault page is not re-rendered. If it throws — busy during a rotation, disk error — the failure is traced without item data and the fill, already sent, is not failed.
- [ ] Not in the vault page's list payload (`metadataOf` unchanged, asserted). A reveal returns the stored item, so the page can see the field after a reveal; it can never set it: on the editor save path the stored value is carried over from the existing item **regardless of what the page sent**, and a page-supplied value on a new item is deleted. Unit-pinned both ways.
- [ ] Stripped by cross-vault copy in both branches (replace and keep-both). Excluded from the bundle-merge equality on both of its branches, so import-merge and restore-merge do not duplicate an item that differs only here (the destination keeps its own list). Carried by capture update, **except that a card update which changes the card number clears it** (a different card asks again). Survives rotation, rekey, export and restore, which move whole items. Each is unit-pinned; the copy-plan comparison is pinned as already ignoring it.
- [ ] The four-source rule check: `vault-editor-model`, `vault-page-model` and `identity-profile` drift guards stay green with no change to their expectations (the field is outside the schema's field lists, as `matchMode` is).

### Shared mechanisms (each sharer asserted unaffected)

- [ ] **The sheet** — sharers: every other menu type. Assertion: the non-listed-type and default-focus pins above; the eager close scrub still runs on every close; blur-survival and keep-focus suites green; the four-guard pins on state-changing sheet channels untouched.
- [ ] **The picker template** — sharers: login, card and identity rows, the action rows, the empty state, the footer. Assertion: `vault-picker-template`, `vault-card-picker`, `vault-identity-picker` suites green, edited only where they pin the header or the start index.
- [ ] **The vault item write paths** — sharers: editor save, browser import, bundle import and restore, cross-vault copy, capture save and update, rotation. Assertion: the per-path pins above; rotation re-encrypts whole items and is pinned to carry the field.
- [ ] **The sheet's one-shot activation sender** — sharers: every card that reports an activation. Assertion: with a zero delay its existing suite (`modal-card-controller.test.js`) is green unedited.

### Behaviour and regression

- [ ] `/mission-control:behavior-test vault-gesture-trust` still passes (run by the Flight Director) — the sheet still rises and falls as that spec expects.
- [ ] Live smoke (dev mode, env-key scripts) exercises every apparatus primitive against the new state; raises the picker by a real click and confirms through the census only that it opened and that a tab switch closes it. Nothing inside the sheet is claimed.
- [ ] `[by-eye]`, deferred to `hat-and-alignment` and listed there by this leg — the whole operator-facing result: the destination line in each view; no row focused; arming (inert, then live) by pointer and by keyboard; the confirmation view for a card and for an identity on a new site, and its absence on the second fill there; a copied card asking again; the certificate warning view on an override tab and both confirmation views (no automation fixture exists for an overridden https page, and the chrome's context id is private — unit and by-eye only); the unlock-then-pick path opening with nothing selected.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `renderer.js` ≤ 1505 lines (no edit expected), evaluate seam 41.

### Docs

- [ ] `docs/vault.md`: the picker (destination, arming, no selection, confirmation, certificate warning) and `confirmedOrigins` (what it stores, when it is dropped). `CLAUDE.md`: the sheet section gains the arming axis and where it is decided; the vault section's "card/identity fill is not origin-gated" sentence is completed with the confirmation rule.

## Verification Steps

1. Unit suites with the runner's timeout: arming paths, focus sentinel and roving keys, the controller sequence, every `confirmedOrigins` write path.
2. Neuters: the arming check removed → the during-arming pins go red; the save-path carry-over removed → its pin goes red; the copy strip removed → its pin goes red.
3. Live smoke; Flight Director re-run of `vault-gesture-trust`.

## Implementation Guidance

1. Arming table, the gated sender, pins.
2. Picker open focus and the ArrowUp case.
3. Destination line across every view; refuse to open without one.
4. `confirmedOrigins` module, store operation and write-path pins (main-side, independent of the chrome).
5. Template choke points; certificate acknowledgement channel and warning view.
6. Confirmation: main protocol with the explicit confirm, then the chrome sequence and view.
7. Docs.

## Edge Cases

- **Model replace while arming** restarts the delay; a replace is how the same picker updates in place.
- **Vault locked while the confirmation view is up**: the fill answers `locked`, the existing re-raise applies, and the picker that reopens after unlock is the plain picker — a pick there asks for confirmation again, because only the confirmation view sends the explicit confirm.
- **A second accepted gesture while the picker is open** replaces the model and re-arms.
- **A restored bundle from elsewhere** can carry confirmed sites; it already carries the items themselves, so the trust is the same. Stated in `docs/vault.md`.
- **The same card confirmed on two sites in quick succession**: appends are serialised; both are kept.
- **Cap reached**: the oldest origin is dropped; that site asks again.
- **An item deleted between pick and confirm**: nothing fills, nothing is recorded.
- **Restore of a bundle older than this field**: items simply have no confirmed sites.
- **Global-vault items** used from several jars: one list on the item; an origin confirmed in one jar is confirmed in all, which is the item's owner's choice either way.
- **Screen reader**: the destination is the list's description, so it is announced when focus lands on the list at open.

## Files Affected

A new shared arming module; `src/renderer/modal-card-controller.js` (wherever `createSheetReport` lives), a new `src/main/vault/` confirmed-origins module, `src/renderer/menu-overlay.js`, `src/renderer/menu-controller.js`, `src/shared/vault-picker-template.js`, `src/renderer/chrome/vault-controller.js`, `src/renderer/chrome/overlay-menus.js` (only if the open payload needs the extra fields declared), `src/main/vault/vault-human.js`, `src/main/vault/vault-store.js`, the picker-context module from the previous leg, `src/main/main.js` (the new channel), `src/main/ipc-channel-table.js`, `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`, styles for the inert state and the header line, their unit tests (including `vault-rekey-gate.test.js`), `docs/vault.md`, `CLAUDE.md`.

## Citation Audit

Cited by symbol from the 2026-11-13 survey and design review of the working tree: `menu-overlay.js` — the picker rows' `click` listener and `sendActivatedOnce`, `onOpen` / `focusItem`, the init handler's start-index default, `buildVaultSheetHeader`, `modelShapeOk`; `menu-controller.js` — the arrow / Home / End roving; `sheet-accelerator.js` — chords only; `vault-store.js` — `_saveItemPreservingSecrets`, `_copyItem` (two branches), `mergeVaultItems` with its deep equality, `_normalizeItem`; `copy-plan.js` — `isIdenticalItem`; `vault-item-schema.js` — `metadataOf`. Design review (2026-11-14) re-checked the leg against the tree with leg `vault-fill-trust` landed: the context object is mutable through the gate and has no acknowledged or pending field yet; a non-filling answer does not drop it; the dismissal consumer excludes `activated`; the store has no change broadcast; `activationIdFor`, `isActionEntry`, the empty-state note and the footer are the template's choke points.

## Post-Completion Checklist

- [ ] Leg status `landed`; flight log entry under `## Leg Progress` with constants, neuter text, smoke observations, the by-eye list and any deviation.
- [ ] No commit. Signal `[LAND:leg]`.
