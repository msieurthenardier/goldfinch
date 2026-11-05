# Leg: locked-save-handoff

**Status**: completed
**Flight**: [Non-blocking Save Prompt](../flight.md)

## Objective
A submit into a LOCKED vault shows the same non-blocking corner prompt, with "Unlock & save". Its flow:
- Clicking it records the operator's consent and chosen vault main-side, then raises the existing unlock sheet.
- After unlock, the save completes, or the prompt re-asks non-blockingly for an update or identity merge.
- An unlock by any other route converts visible and queued locked prompts in place.
- A capture lost while awaiting unlock is reported in the corner, never silently.

## Context
- Flight **DD7**, binding in full. It is restated below where this leg settles a detail DD7 left open. Also **DD6** (the `unlock-requested` / unlock-abandoned rows) and **DD9** (metadata only, four guards).
- **Leg 1 landed (uncommitted on this branch).**
  - Code that exists and is reused:
    - the prompt view, manager, IPC (`src/main/register-save-prompt-ipc.js`) and close-effects table (`src/shared/save-prompt-close-effects.js`; the rows `unlock-requested` and `unlock-abandoned` already exist);
    - the chrome queue (`src/renderer/chrome/vault-controller.js` `advance()` ~187, `pendingCaptureUnlock` ~93 entries `{ captureId, wcId }`, `onVaultCaptureOffer` locked branch ~452-467, `onVaultLockState` ~488-512, `handleClosed` ~764-806);
    - `vault-capture-dropped` handling (~148-166);
    - `captureTabOf`, `onCaptureDropped` and `offered` in `vault-human.js`.
  - The interim locked path, to be replaced: a locked offer pushes onto `pendingCaptureUnlock` at ARRIVAL and auto-raises `vault-unlock` (`{ keepFocus: true }`).
  - `sanitizeSavePromptModel` (`register-save-prompt-ipc.js` ~44-75) refuses `mode: 'locked'`, and `RESULT_KINDS` (~27) has no `saved`.
- **Live anomaly A7 (flight log): after the operator unlocked, NO corner prompt appeared.** Likely mechanism, from timing and not traced:
  - The operator's unlock came minutes after submit, past `CAPTURE_DROP_MS` (2 min).
  - The TTL drop fired `onCaptureDropped` with `offered: true`, so main pushed `vault-capture-dropped`.
  - The chrome removed the entry from `pendingCaptureUnlock` (~148).
  - The unlock then drained nothing.

  This is a silent failure: the operator typed a master password and got no answer. AC1 reproduces it and closes it.
- **Operator ruling** (Leg 1 landing): live runs are deferred to the HAT, because "these tests seem fragile". This leg's acceptance is unit and handler level. Variant B of `save-prompt-non-blocking` and the by-eye locked flow are HAT steps.
- Main-side order on a sheet unlock (verified): `menu-overlay:vault-unlock` (`register-overlay-ipc.js` ~255-256) awaits `vaultUnlock`. The store's `onUnlock` → `broadcastVaultLockState()` (`main.js` ~1010, ~1023) runs inside that await, and THEN `closeMenuOverlay('activated')`. The chrome therefore sees `vault-lock-state {unlocked:true}` before the unlock sheet's channel-7 close, on the same webContents in IPC order.

## Inputs
- `src/main/vault/vault-human.js`:
  - locked offer models `{ origin, username, mode:'locked' }` (login ~818), `{ kind:'card', origin, brand, last4, mode:'locked' }` (~1278), `{ kind:'identity', origin, mode:'locked' }` (~1471);
  - `captureFinalize` (~1505), `captureSave` (~1555+), `rec.choices` set at disposition (~686, ~724, ~1191; `[]` for update);
  - `rec.jarId`.
- `src/main/register-browser-ipc.js` `vault-capture-finalize` (~328-333): a bare chrome-trust handle with no sender check today.
- `src/main/register-save-prompt-ipc.js`: `save-prompt:open` gates (~114-140), `:save` four guards (~190-205), `sanitizeSavePromptModel`.
- `src/main/save-prompt-manager.js`: result table (~75-95), `present`, `canSave`, the `saving` in-flight state.
- `src/renderer/save-prompt.js` (142 lines), `save-prompt.css`, `src/shared/vault-capture-template.js` `KIND_TABLE`.
- `src/renderer/chrome/vault-controller.js` and `save-prompt-client.js` as above.
- `src/preload/save-prompt-preload.js`, `src/renderer/save-prompt-globals.d.ts`.
- Tests from Leg 1: `save-prompt-*.test.js`, `vault-controller-capture.test.js`, `vault-capture-handler.test.js`, `register-browser-ipc.test.js`.

## Outputs
- `vault-human.js`:
  - locked login/card offers carry `choices` and `defaultVaultId`;
  - new `captureConsent({ captureId, vaultId })`;
  - `rec.consent`;
  - `captureFinalize` gains an options-free consent write (AC7).
- `register-browser-ipc.js`: `vault-capture-finalize` gains the sender, active-tab and consent semantics.
- `register-save-prompt-ipc.js`: `save-prompt:consent`, locked models admitted, the `saved` result kind, and `vaultTrace` lines.
- `save-prompt-manager.js`: the locked offer state, consent close, and the `saved` result.
- `save-prompt.js` / `.css`: the locked rendering ("Unlock & save", the lock note, "Save to").
- `save-prompt-preload.js` + `.d.ts`: `consent(payload)`.
- `vault-controller.js` / `save-prompt-client.js`:
  - auto-raise removed;
  - consent-time `pendingCaptureUnlock`;
  - the unlock-sheet open on `unlock-requested`;
  - convert in place;
  - the A7 fix.
- `chrome-preload.js` + `renderer-globals.d.ts` only if a chrome-facing signature changes (`vaultCaptureFinalize`'s return union).
- Tests: new `save-prompt-consent.test.js` and `vault-capture-consent.test.js`; extended `vault-controller-capture.test.js`, `save-prompt-ipc.test.js`, `register-browser-ipc.test.js`, `save-prompt-manager.test.js`, `save-prompt-page.test.js`, `save-prompt-css-drift.test.js` (if new classes).
- Docs: `docs/vault.md` (the locked flow, consent, convert in place, the A7 behavior), `CLAUDE.md` vault "Save moment" line, and `tests/behavior/save-prompt-non-blocking.md` (Variant B marked HAT per the operator ruling).

## Acceptance Criteria

**A7: no silent post-unlock miss**
- [ ] AC1 **Reproduce, then fix.**
  1. **First, on the CURRENT interim path, before any other change.** That is what shipped in Leg 1, and it is where A7 happened. Add a `vault-controller-capture.test.js` case driven from the real triggers: a locked offer arrives (interim: auto-raise, `pendingCaptureUnlock` at arrival) → the `vault-capture-dropped` push for that id (main's TTL drop) → the `vault-lock-state {unlocked:true}` push → the unlock sheet's channel-7 close. Assert that the corner presents `{ result:'expired' }`. It must FAIL before the fix, with nothing presented. Record the red run in the flight log. If it PASSES, the TTL hypothesis is wrong: stop and signal `[BLOCKED:a7-unexplained]` with findings.
  2. Fix: a `vault-capture-dropped` for a `pendingCaptureUnlock` entry marks that entry `expired` instead of removing it. In the interim, every such entry is one the operator was shown an unlock sheet for; after AC6, every entry is a consented one. The drain presents the `expired` result without calling finalize. Entries in `presentationQueue` (never consented) are still just removed. Unit-pinned both ways.
  3. After the consent flow lands (AC5/AC6), add the consented variant of the same test: consent → drop → unlock → `expired` presented.
  4. Also: when `GOLDFINCH_VAULT_TRACE=1`, `save-prompt:open` traces `{ captureId, presented, reason }`, and consent traces `{ captureId, outcome }`. These are opaque ids and reason strings only, never origin, username or vault label. A test pins the trace payload keys.
  5. Also harden `advance()`'s presentation branch: the `promptClient.present(...)` chain gains a `.catch` that resets `opening` and keeps the head, so a rejected present can never wedge the queue (`vault-controller.js` ~197-211). Tested with a rejecting fake.

**Locked offers in the corner**
- [ ] AC2 Locked login and card offers additionally carry `choices: [rec.jarId, 'global']` and `defaultVaultId: rec.jarId`. These are non-secret and deterministic, and `rec.choices` is still unset until disposition. Identity locked offers carry neither. Tests pin all three shapes; no secret key is present.
- [ ] AC3 `sanitizeSavePromptModel` admits `mode: 'locked'` with the same allowlist plus `choices`. The `save-prompt:open` gate 3 (`captureTabOf`) applies to locked offers.

  The page renders a locked offer per the approved mockup (identity's primary reads **Unlock & review**, because identity always re-asks after unlock; see AC7):
  - heading "Save password?" / "Save card?" / identity heading;
  - "Save to" for login/card, using the client's label mapping and "Unknown vault" disabled, as in Leg 1 AC20;
  - the lock note "Your vault is locked. You will enter your master password to save.";
  - primary **Unlock & save**, plus Not now and ✕.

  `:save` stays refused for a locked offer (Leg 1 guard 3, re-pinned).
- [ ] AC4 **Auto-raise removed.** `onVaultCaptureOffer` queues a locked offer on `presentationQueue` like any other offer, with `wcId`. It never pushes onto `pendingCaptureUnlock` and never opens `vault-unlock`.
  - The existing interim tests are inverted and renamed, not deleted: "a locked offer auto-raises the unlock sheet" becomes "a locked offer presents in the corner and raises no sheet".
  - Behavior-spec Variant B's regression gate (`sheetVisible` false on a locked submit) now holds at unit level. It is pinned by a test asserting no `openOverlayMenu('vault-unlock', …)` call on offer arrival.

**Consent**
- [ ] AC5 **`save-prompt:consent { token, captureId, vaultId }`** is an invoke. Four guards in order, each refused in isolation by a test:
  1. **Sender**: this window's prompt view (`registry.recordForOverlaySender(sender, 'savePrompt')`).
  2. **Token**: current.
  3. **Kind**: the prompt is in its OFFER state with `model.mode === 'locked'`, and is not `saving`/settling. The manager's synchronous in-flight flag is set here too, so a double-click sends exactly one consent.
  4. **Business gate**, all of:
     - `captureId === manager.currentCaptureId`;
     - `captureTabOf(captureId) === shownWcId === rec.activeTabWcId`;
     - then `vaultHuman.captureConsent({ captureId, vaultId })`, which itself requires: the record exists, `rec.mode === 'locked'`, the vault is still locked, and either `vaultId ∈ {rec.jarId, 'global'}` for login/card or `vaultId == null` for identity. It stashes the consented-against offer metadata `rec.consent = { vaultId, origin, username, kind }`, taken from the record as offered, never from the payload.
  - **Consent in-flight flag**: this is a dedicated `consenting` flag, NOT `save()`'s `saving`/`settling`. It is set synchronously at guard 3 and rolled back on every refusal that leaves the prompt up (`unlocked`), so a refused consent never wedges the prompt. Tested.

  On success: `rec.consent` is set as above, and the prompt closes `unlock-requested` (no capture dismissed; close-effects row unchanged).

  On a refusal from `captureConsent`:
  - vault already unlocked → `{ ok:false, reason:'unlocked' }`, and the prompt stays (AC9 converts it);
  - record gone → the `expired` result;
  - bad vault → a "Couldn't save to that vault" result, then `dismissed`.
- [ ] AC6 **Chrome on `unlock-requested`:**
  1. It pushes `{ captureId, wcId, consented: true }` onto `pendingCaptureUnlock`, populated at consent and NOT at arrival.
  2. In the NEXT task (`setTimeout 0`, after the prompt is hidden), it opens `vault-unlock` with `{ keepFocus: true }`.
  3. If `lockState.unlocked` is already true by then, it skips the sheet and calls `advance()`.
  4. Pinned: no queued offer is presented in the corner during the `setTimeout 0` gap. The `unlock-requested` row has `advance:false` (`save-prompt-close-effects.js` ~63).
  5. `save-prompt-client.test.js` (~143-145): `unlock-requested` moves from the deferred list to `CLIENT_HANDLED_REASONS`. `unlock-abandoned` stays deferred: no prompt is shown when an unlock is abandoned, so nothing emits it. State that in a comment.

  The existing unlock-abandoned branch (`handleClosed`, `vault-unlock` closed while still locked) still dismisses EVERY `pendingCaptureUnlock` entry, including consented ones, so main drops the records and their consent. Re-pinned. The design-review note about channel ordering stays true: lock-state arrives before the close, so a successful unlock never hits this branch.

**Complete after unlock**
- [ ] AC7 **The ONE finalize path, extended (not duplicated).** `vault-capture-finalize`:
  1. **Sender** (the handler, `register-browser-ipc.js` ~328): `const wcId = vh.captureTabOf(captureId)`. If null → `{ reason: 'expired' }`. Then `registry.getWindowForGuest(wcId)` must be the same record as `registry.getWindowForChrome(event.sender)` (`window-registry.js` ~192-205); else `{ reason: 'refused' }`, with NO `dropCapture` and no write. This check is load-bearing for consent: the channel is bare today.
  2. **Active tab**: `rec.wcId` is that window's `activeTabWcId`; else drop the record and return `{ reason: 'tab-changed' }` (existing reason, no write).
  3. The existing `locked` / `expired` / `tab-changed` / `unchanged` / `FAMILY_REFUSED` outcomes are unchanged.
  4. After disposition, **if `rec.consent` is set**:
     - **plain `save` for login/card with `rec.consent.vaultId ∈ rec.choices`, AND the disposed model's `origin`, `username` and `kind` equal `rec.consent`'s stashed values** (for example, `applyUsernameDowngrade` did not null the username) → `captureSave({ captureId, vaultId: rec.consent.vaultId })`. Success returns `{ captureId, saved: true, vaultId, kind }`; a `captureSave` failure returns `{ reason: 'locked' | 'error' }`.
     - **`update`, identity gap-fill/conflict, or identity `save`** → consent is CLEARED, nothing is written, and the model is returned as today for a non-blocking re-ask. Identity save is conservative: there is no vault choice was ever shown for identity, so the operator confirms in the unlocked prompt. Recorded as a Decision.
     - **`save` with `consent.vaultId ∉ rec.choices`, or a metadata mismatch with the consented offer** → no write; consent is cleared and the model is returned (a re-ask). Assert that a `save` disposition's `rec.choices` contains `[rec.jarId,'global']`, a superset of the locked offer's choices.
  6. **Idempotent finalize**: the first successful disposition is cached on the record (`rec.disposed = model`), and a repeat `captureFinalize(captureId)` returns the cached model without re-running disposition. `zeroizeCurrentPassword` runs once, so a rotation `update` can never degrade to a `save` on a second call. The chrome additionally keeps a per-captureId `finalizing` set, so it never issues two concurrent finalizes. Both are tested.
  5. Without `rec.consent`: writes nothing and returns the model (today's behavior).

  The chrome-side `vaultCaptureFinalize` return type in `renderer-globals.d.ts` gains the `saved` member.
- [ ] AC8 **Chrome drain.** In `advance()`, a consented entry's finalize result is handled as follows:
  - `saved` → presents the `saved` result. A new `RESULT_KINDS` member `saved` carries `vaultLabel` and `kind`. The chrome maps `vaultId` → label through the client's `labelChoice` (export it or move it into a shared helper; `save-prompt-client.js` ~114-118). Main sanitizes `vaultLabel` with `str()` and `kind` with `OFFER_KINDS`. The manager builds the text dynamically from `resultNounOf` (`save-prompt-manager.js` ~67) and does not add a static `RESULT_MODELS` row: "Password saved to {vault}" (card/identity nouns), `textContent`, held 2500 ms, then closes `saved`. Accepted, recorded: a compromised chrome could show a fake "saved". That is display-only and of the same class as Leg 1's result-only models.
  - A returned model → presents it as an unlocked offer with a fresh 10 s (the re-ask).
  - `unchanged` → "Already saved" (2500 ms).
  - `expired` / `tab-changed` / `locked` / `error` → the matching result (Leg 1 table).
  - `refused` → nothing is presented, and the entry is dropped (`vaultCaptureDismiss`).

  The Leg 1 result model allowlist (`{ result }` only) is widened to exactly `{ result, vaultLabel?, kind? }` for `saved`.

**Convert in place (DD7, design review 2 N5)**
- [ ] AC9 On `vault-lock-state {unlocked:true}`, every chrome window converts its visible locked prompt. The exact sequence:
  1. Finalize the shown captureId ONCE, without consent, guarded by the AC7 `finalizing` set.
  2. Push the result (the offer model, or the result-only model) to the HEAD of `presentationQueue`.
  3. Mark the shown locked entry superseded and clear `shownEntry`, so `advance()` can run.
  4. `advance()` presents the head. The happy path is a model-replace on the visible prompt with a fresh 10 s; `present()` while visible replaces the model in place (`save-prompt-manager.js` ~419-479), and a same-captureId present passes gate 3.
  5. **If the unlock came from a sheet**, the lock-state push arrives BEFORE that sheet's close, so `save-prompt:open` answers `sheet-open` (`save-prompt-manager.js` ~414). The head is KEPT and retried on the sheet's close (`handleClosed` → `advance()`). Until then the old locked prompt stays visible and paused; the retry replaces it with a fresh 10 s, which is accepted.

  Unit tests cover both the sheet-visible and the no-sheet case.

  Queued locked models convert when `advance()` reaches them: a locked model is NEVER presented while `lockState.unlocked`, and `advance()` finalizes it first.

  The unlock may happen in ANOTHER window: the lock-state broadcast reaches every chrome. A two-controller unit test asserts that window B's visible locked prompt converts when window A's unlock fires the push.

  Consented entries in `pendingCaptureUnlock` drain as AC8.

**Security pins (DD7)**
- [ ] AC10 Unit, on the real channels or handlers with fakes, each its own test:
  1. no consent → finalize writes nothing;
  2. consent + `update` disposition → no write;
  3. consent from another window's prompt view → `save-prompt:consent` refused (sender);
  4. stale token → refused;
  5. `vaultId` outside `{jarId,'global'}` → refused, and `rec.consent` unset;
  6. consent for a capture whose `captureTabOf` ≠ the shown tab → refused;
  7. finalize for a non-active tab → `tab-changed`, no write, record dropped;
  8. finalize from a non-owning window's chrome → `refused`, no write, record intact;
  9. consent while the vault is already unlocked → refused (`unlocked`), no consent set;
  10. consent cleared by every drop path: `dropCapture` evicts the record, and a test asserts `captureConsent` then `dropCapturesForTab` then a recreated id with no consent.

  11. a consented save whose disposed username was downgraded (`applyUsernameDowngrade`) → no write, re-ask;
  12. a repeat finalize returns the cached disposition, and the zeroize runs once.

  Every write in this leg goes through `captureSave`, reached only via `:save` (Leg 1) or the consented finalize. A source-scan pin asserts the EXACT allowlist of `captureSave(` call sites in `src/`, as `{ file: count }`:
  - the `window-factory.js` delegate (~335);
  - `save-prompt-manager.js` (~665);
  - the new consented-finalize call inside `vault-human.js`;
  - plus the definition.

  It throws if the scan finds zero sites. No finalize test exists today in `register-browser-ipc.test.js`, so the item 7/8 tests are new.

**Docs, gates**
- [ ] AC11 Docs:
  - `docs/vault.md` locked-flow section: consent, then unlock, then complete or re-ask; convert in place; the unlock-abandon drop; A7 "expired after unlock".
  - `CLAUDE.md` vault "Save moment" bullet: one clause on consent-gated locked save.
  - `tests/behavior/save-prompt-non-blocking.md` Variant B: requires Leg 2, run by eye at the HAT per the 2026-11-04 operator ruling.
- [ ] AC12 `npm test` (with a timeout), `npm run typecheck`, `npm run lint` and `npm run format:check` all pass. `src/renderer/renderer.js` stays ≤ 1505 lines and `SEAM_COUNT` is unchanged.

## Verification Steps
- AC1-AC10: targeted `node --test --test-timeout=60000 test/unit/<file>`, then the full `timeout 900 npm test`.
- AC10's grep pin: `rg -n "captureSave\(" src/`, with each hit judged in the flight log.
- AC12: the four commands and `wc -l src/renderer/renderer.js`.
- Live (HAT, Flight Director with the operator, not this leg): Variant B; the locked prompt look; "Unlock & save" → the unlock sheet → "Password saved to …" in the corner; unlock in another window converting; the expired-after-unlock case.

## Implementation Guidance
Checkpoints: run `npm test` and `npm run typecheck` green after each.
- **(a)** A7 red test, then fix, plus the `.catch` hardening.
- **(b)** vault-human: consent, finalize gates, idempotence.
- **(c)** Main channels and sanitize.
- **(d)** Manager and page.
- **(e)** Chrome flip (auto-raise removal, consent queue, convert in place) with the Leg 1 interim-test inversions. These tests (`vault-controller-capture.test.js` ~160-250, including AC21 and the abandoned-unlock test) seed `pendingCaptureUnlock` via arrival today; reseed them via `onSavePromptClosed{reason:'unlock-requested'}`, and rename rather than delete.
- **(f)** Docs and gates.

1. **AC1's failing test FIRST**, on the interim path, before any other change, to confirm or refute the A7 mechanism.
2. vault-human: locked choices, `captureConsent`, the finalize consent write, with tests.
3. Main channels: `:consent`, the finalize handler gates, the sanitize changes, traces.
4. Manager and page: locked state, the `saved` result.
5. Chrome:
   - remove the auto-raise;
   - consent → `pendingCaptureUnlock` → sheet;
   - the drain;
   - convert in place;
   - the A7 fix;
   - the inverted interim tests.
6. Docs, format, gates.

## Edge Cases
- **Two locked offers from one submit** (login + card): consent on the first → unlock → the first completes, then `advance()` reaches the second, a locked model while unlocked, and converts it to an unlocked offer.
- **Consent clicked, then the vault idle-locks again before the unlock sheet submits**: the vault is still locked, so this is a no-op; the sheet is still up.
- **Vault-lock fan-out while the unlock sheet is up for a consent**: the sheet stays (lock never closes `vault-unlock`); records are dropped by `dropAllCaptures`. The consented entry gets `vault-capture-dropped` → marked `expired` (AC1) → after unlock the operator sees "expired". This is correct.
- **Tab switch while the unlock sheet is up for a consent**: DD5 drops the tab's captures, and the consented entry is marked `expired`. Unlocking then shows "This save request expired" for the now-inactive tab? NO: the result is presented only if the entry's `wcId` is the active tab (gate 2); otherwise it is silently discarded. Correct, because the operator left the tab. Pin it.
- **Not now / ✕ / timeout on a locked prompt** → `dismissed` / `timeout` → `captureDismiss`. Unchanged from Leg 1, re-pinned for the locked state.
- **The prompt's pause inputs while the unlock sheet is up**: the prompt is hidden, so they do not apply.
- **Chrome renderer crash mid-consent**: the `teardown` close; the queue is lost with the renderer; main records drop on TTL. Acceptable and unchanged.

## Files Affected
See Outputs.

---

## Post-Completion Checklist
Completion steps (status transitions, flight-log update, checking off in the parent flight, and commit) are Flight Control protocol, driven by the execution workflow. They are not repeated here.

## Citation Audit
Checked against the Leg 1 working tree on `sortie/06-non-blocking-save-prompt` (2026-11-04):
- `vault-controller.js` ~93/148/187-231/452-467/488-512/764-806;
- `register-save-prompt-ipc.js` ~20-75/112-140;
- `register-browser-ipc.js` ~328-333;
- `vault-human.js` ~749-818/1275-1278/1470-1471/1505;
- `register-overlay-ipc.js` ~243-257;
- `main.js` ~1010/1023/2223.

These were re-read this session. Not re-read: the `:save` line numbers in `register-save-prompt-ipc.js` (~190-205, from a grep) and `save-prompt-manager.js`'s internal names (`canSave`, `saving`), which the Developer confirms.

**Design review 1** (Developer, Sonnet, 2026-11-04): approve with changes. It confirmed the A7 TTL mechanism on the code. Folded in:
- (high) the AC1 repro moves to the interim path so it can fail first;
- (high) the AC9 sheet-visible convert sequence;
- (high) idempotent finalize plus a chrome `finalizing` guard;
- the consented-metadata match (username downgrade → re-ask);
- the pinned finalize sender mechanism;
- the dynamic `saved` result and label source;
- a dedicated consent in-flight flag with rollback;
- the exact-allowlist `captureSave(` pin;
- the `.catch` on the present chain;
- client-reason list changes;
- the setTimeout-gap pin;
- identity's primary reading "Unlock & review";
- checkpoints.

FD rulings:
- (1) reproduce on the interim path;
- (2) re-ask after consent for update/identity is the operator's DD7 ruling, and identity's copy says so;
- (3) a fresh 10 s on the retried convert is fine;
- (4) username mismatch → re-ask, no write.

Changes are corrective, not a redesign, and every high was resolved with a concrete mechanism. The FD skips the second review cycle and records why: the flight-end Reviewer covers the code, and the security pins are enumerated.
