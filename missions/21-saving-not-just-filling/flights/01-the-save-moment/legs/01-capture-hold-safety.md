# Leg: capture-hold-safety

**Status**: completed
**Flight**: [The Save Moment](../flight.md)

## Objective

Make a held capture record incapable of outliving the conditions that should
invalidate it — vault lock, owning-window close, and tab close — before any later
leg extends how long such a record is held.

## Context

Flight DD5. Today a captured credential becomes an offer within milliseconds, so
the held record's lifetime is invisible. Leg 4 changes that: under capture-on-
gesture / offer-on-settle, **holding becomes the normal state**, and a record can
legitimately sit for up to `CAPTURE_DROP_MS` (2 minutes) waiting for a settle
signal. The gaps below are latent today and material after Leg 4, which is why
this leg runs first — the safety valve is fixed before the intake is widened.

Verified gaps (not assumed):
- `main.js` `onLock` drops `_pendingVaultImports` and `_pendingBrowserImports` and
  closes credential sheets — it does **not** touch `vault-human.js`'s `captures`.
- `releaseVaultHoldsForWindow` (`main.js:1012`) likewise drops only pending imports
  and autolock suppression.
- No other dropper exists **outside `vault-human.js` itself**. Within it, every
  exit already funnels through `dropCapture`: the TTL timer, explicit dismiss, a
  successful save, per-tab supersession in `capture()`/`captureCard()`, the
  immediate drop when `disposeCapture`/`disposeCardCapture` returns null at
  capture time, and `captureFinalize`'s `'tab-changed'` and `'unchanged'` exits.
  That completeness is why this leg adds bulk helpers rather than a new eviction
  path.

## Inputs

- `src/main/vault/vault-human.js` — `captures` Map (keyed by `captureId`; each
  record carries `wcId`, `jarId`, and zeroizable `password`/`number`/`cvv`
  Buffers), `dropCapture(captureId)` as the single zeroizing choke-point.
- `src/main/main.js` — `createVaultHuman({...})` construction with its existing
  injected deps (`getVaultStore`, `fromId`, `getTabEntry`, `listJars`,
  `fillDelegate`, `fillCardDelegate`, `setTimeout`, `clearTimeout`, `now`); the
  store's `onLock` hook; `releaseVaultHoldsForWindow(chromeId)`.
- `src/main/register-tab-ipc.js` — `registerTabIpc(deps)` destructured-deps shape;
  the `tab-close` handler, whose `authChallenges?.cancelForTab(wcId, 'tab-close')`
  line is the precedent for a per-tab teardown hook at that exact site.

## Outputs

- Bulk drop API on `vault-human.js`, all routed through `dropCapture`, **each
  returning the records it dropped** (already zeroized in place) so the
  zeroization criterion below is testable at all — see Implementation Guidance 1.
- Three wired drop paths: vault lock, window close, tab close.
- Unit coverage proving each path actually zeroizes, plus scoping proof.

## Acceptance Criteria

- [x] `vault-human.js` exposes `dropCapturesForTab(wcId)`,
      `dropCapturesForWindow(chromeId)` and `dropAllCaptures()`, and **every one
      delegates to the existing `dropCapture`** — no second eviction path exists
      that could diverge from its zeroization. Each returns the array of records
      it dropped.
- [x] `captureSave` checks vault-locked **before** it looks up the record, so a
      save attempted after a lock still reports `reason: 'locked'` rather than
      degrading to the generic failure — see Edge Cases.
- [x] A vault lock drops every held capture, via **both** lock routes: the manual
      lock AND the idle autolock timer. The test exercises the autolock path
      specifically, not only the manual one.
- [x] Closing a window drops that window's held captures **and only that
      window's** — a capture held by a second window survives, proven by assertion
      on the surviving record.
- [x] Closing a tab drops that tab's held captures **and only that tab's** — a
      sibling tab's capture in the same window survives.
- [x] Zeroization is verified by **reading the Buffer after the drop and asserting
      it is all zero bytes**, for `password`, `number` and `cvv` — not inferred
      from `dropCapture` having been called.
- [x] The TTL remains a **drop** and is never converted into an offer.
- [x] `vault-human.js` still contains no `require('electron')`; the
      chromeId→tab-wcIds resolution arrives as an injected dep.
- [x] No drop path force-constructs the vault store or the vault-human singleton:
      a lock, a window close, **or a tab close** in a session that never built
      them is a silent no-op.
- [x] The tab-close dep resolves the vault-human singleton **lazily at call
      time**, so a capture held in a tab closed later in the session is actually
      dropped — a boot-time snapshot of the memo would be permanently `null`.
- [x] Existing behaviour is unchanged for every current flow — `npm test` passes
      with no modifications to existing capture assertions. The one intentional
      behavioural delta is the `captureSave` reordering above, which *preserves*
      copy that would otherwise regress; it must not change any other outcome.

## Verification Steps

- New unit suite (`test/unit/vault-capture-drop-safety.test.js`): per-tab,
  per-window, drop-all scoping; post-drop Buffer zero-checks; TTL-still-drops.
- A **named** case for the `captureSave` reorder's actual behavioural delta:
  record already dropped by a lock AND the vault still locked → `reason: 'locked'`
  (not the generic failure). This is distinct from the existing
  record-present-and-locked case already covered in `vault-capture.test.js`, and
  is easy to skip by assuming that test covers it.
- Autolock coverage composes a real `VaultStore` with a faithful transcription of
  `main.js`'s `onLock` composition — the `test/unit/vault-close-on-lock.test.js`
  idiom, which exists precisely because hooking the manual-lock wrapper instead of
  the store's `onLock` silently misses the idle timer.
- `grep -n "require('electron')" src/main/vault/vault-human.js` → no match.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`.

## Implementation Guidance

1. **Bulk drops in `vault-human.js`.** Snapshot the keys before iterating
   (`[...captures.keys()]`) and delegate each to `dropCapture`. `dropCapturesForTab`
   filters on `rec.wcId`; `dropCapturesForWindow` resolves the window's tab wcIds
   via the injected dep and drops any record whose `wcId` is in that set;
   `dropAllCaptures` drops every record. Add all three to the returned object.
   **Each must capture `captures.get(id)` BEFORE calling `dropCapture(id)` and
   return the collected records.** This is not a convenience: the `captures` Map
   is private and the returned API exposes no record, while `capture()`/
   `captureCard()` deliberately **copy** the caller's bytes into an internal
   `Buffer` and zero the caller's own array immediately — so a test can never
   reach the record's buffer from outside. Without this return value the
   zeroization acceptance criterion is literally unsatisfiable. (The apparent
   precedent in `vault-pending-imports.test.js` works only because
   `pending-imports.js` stores the caller's buffer **by reference**; vault-human's
   copy-then-wipe design forecloses that trick.) `dropCapture` mutates the record
   in place before eviction, so a returned record is already zeroized.
   **The return value exists for tests only.** Every production call site
   (`onLock`, `releaseVaultHoldsForWindow`, the tab-close hook) discards it — bare
   calls, no assignment. This matters: `dropCapture` zeroizes the secret Buffers
   but the returned record still carries plaintext `origin`, `username`,
   `cardholder` and the like, so a future "helpful" log or trace on the returned
   array would leak that metadata even though the passwords themselves stay safe.
   Say so in a comment at the definition.
2. **New injected dep** `tabWcIdsForChrome(chromeId) => number[]`, constructed in
   `main.js` as `webContents.fromId(chromeId)` → `registry.getWindowForChrome(wc)`
   → `[...rec.tabViews.keys()]`. Null-safe at every hop: a destroyed or unknown
   chrome id yields `[]`, never a throw. This exists because
   `releaseVaultHoldsForWindow` is keyed by **chrome** id while `captures` is keyed
   by **tab** wcId, and `vault-human.js` has no registry access by design.
3. **Wire lock** in `main.js`'s `onLock`, beside `_pendingVaultImports.dropAll()`.
   Use the **memoized reference, not the getter** (`_vaultHuman?.dropAllCaptures()`)
   so a lock never force-constructs vault-human — matching the "no-op store-wise
   when the window held nothing" care already taken in
   `releaseVaultHoldsForWindow`.
4. **Wire window close** in `releaseVaultHoldsForWindow`, same memoized-reference
   rule.
5. **Wire tab close** in `register-tab-ipc.js`'s `tab-close` handler, immediately
   alongside `authChallenges?.cancelForTab(wcId, 'tab-close')`, as a new
   optional-chained injected dep on `registerTabIpc`. Optional-chain it to match
   the module's existing defensive style for injected deps (its own
   `authChallenges?.cancelForTab` calls) — **not** because a partial-deps harness
   exists; both current call sites supply full deps.

   **⚠ The dep MUST be a getter closure, not a value.** Pass
   `vaultHuman: () => _vaultHuman` and call it as
   `vaultHuman?.()?.dropCapturesForTab(wcId)`. `registerTabIpc({...})` is invoked
   exactly once at boot with a deps **object literal**, while `_vaultHuman` is
   lazily memoized and is still `null` at that moment. Passing
   `vaultHuman: _vaultHuman` would snapshot `null` **permanently**, so the
   tab-close drop would silently never fire — no error, no failing unit test
   (the suite constructs `registerTabIpc` directly with a controlled fake), just
   a dead safety path. The correct precedent is `getHistoryRecorder: () =>
   historyRecorder` in that very same deps object, consumed as
   `getHistoryRecorder()?.forgetTab(wcId)`. **Do NOT copy the `authChallenges`
   idiom here** — that dep is an eagerly-constructed stable object passed as a
   raw value, a structurally different case. And do **not** use
   `getVaultHuman()`, which force-constructs and would violate the
   no-force-construct rule on every tab close in a vault-untouched session.
6. **Reorder the lock check in `captureSave`.** Move the `!store.isUnlocked()`
   check **ahead of** the `!rec` lookup so a locked vault reports
   `reason: 'locked'` whether or not the record survived. Two lines, and it closes
   the regression described under Edge Cases rather than accepting it. Behaviour
   is otherwise unchanged: unlocked-and-missing still returns the generic
   `{ saved: false }`.

## Edge Cases

- **`mode: 'locked'` records and a lock transition.** Dropping all records on
  lock is safe, but **not** for the reason this leg originally claimed. The
  original reasoning — "at a lock transition every live record was created while
  unlocked" — is false, and `captureFinalize` documents the counter-case itself:
  when the vault is locked it returns `{ reason: 'locked' }` **without** dropping
  the record and without clearing `mode`, so a `'locked'` record can survive an
  unlock unfinalized and still be live at a *second* lock. The actual reason the
  drop is safe: the chrome's `pendingCaptureUnlock` is a one-shot, cleared
  *before* the first `vaultCaptureFinalize` call (`vault-controller.js:344-346`,
  whose own comment says it is cleared "so an unrelated later unlock can't
  re-fire it"). Such a record therefore has no live client retry waiting on it —
  it is already an orphan bound for the TTL, and dropping it immediately instead
  of up to two minutes later changes nothing observable. **Put this reason in the
  comment, not the original one** — a future reader must not build on a false
  invariant.
- **Dead chrome id at window close.** `close` fires before `closed`, so the record
  is still resolvable; but the lookup must still degrade to `[]` rather than throw
  if it is not.
- **A record whose tab already closed.** Dropping by tab must be idempotent —
  `dropCapture` already is.
- **Never force-construct.** Both the store and vault-human are lazily memoized;
  a drop in a session that built neither must be a silent no-op.
- **An open capture sheet survives a vault lock, so this leg is NOT fully
  invisible.** `vault-capture` is deliberately OUT of the close-on-lock allowlist
  (`src/shared/vault-blur-survival.js` — "the capture offer card; no typed
  secret"), so the offer sheet stays on screen when the vault locks. Today, a
  Save clicked afterwards hits `captureSave`'s `!store.isUnlocked()` branch and
  surfaces the actionable copy *"The manager locked — unlock it and try again"*.
  Once `onLock` drops the record, the same click would instead hit the bare
  `!rec` branch and degrade to the generic *"Couldn't save the password"* — a
  real, user-visible regression, and one that gets **more** likely after Leg 4
  widens the hold window. Implementation Guidance 6 closes it by checking
  locked-ness before the record lookup. **Do not instead add `vault-capture` to
  the close-on-lock set** — that set was deliberately scoped by a prior design
  review, and reopening it is out of this leg's charter.

## Out of Scope

- **Drop-on-navigation.** A same-tab navigation to another origin before settle is
  part of Leg 4's settle semantics, not this leg's teardown set. Deliberately not
  added here so the two concerns are reviewed separately.
- Any change to when an offer is raised.
- Adding `vault-capture` to the close-on-lock sheet allowlist. Deliberately
  scoped elsewhere; flagged, not silently changed.

## Files Affected

- `src/main/vault/vault-human.js` — three bulk-drop functions; one new injected dep.
- `src/main/main.js` — `createVaultHuman` deps; `onLock`; `releaseVaultHoldsForWindow`.
- `src/main/register-tab-ipc.js` — deps destructure; `tab-close` hook.
- `test/unit/vault-capture-drop-safety.test.js` — new.

## Citation Audit

Verified against current source at design time (2026-09-19). Citations are
symbol-anchored where possible; the three bare line numbers were each read and
confirmed:

- `vault-human.js` — `dropCapture` zeroizes exactly `['password','number','cvv']`
  and carries the standing comment that a new secret field MUST be added there or
  it outlives the record. Confirmed.
- `vault-human.js` — `createVaultHuman(deps)` dep set confirmed as listed; module
  contains no `require('electron')`. Confirmed.
- `main.js:1012` — `releaseVaultHoldsForWindow(chromeId)` body confirmed: touches
  `_pendingVaultImports`, `_pendingBrowserImports`, `_autolockSuppression` only.
- `main.js` `onLock` — confirmed: `_pendingVaultImports.dropAll()`,
  `_pendingBrowserImports.dropAll()`, `closeVaultCredentialSheetsOnLock()`,
  `broadcastVaultLockState()`. No capture drop.
- `register-tab-ipc.js:323` — `tab-close` handler confirmed, with
  `authChallenges?.cancelForTab(wcId, 'tab-close')` present as the sibling
  precedent. `registerTabIpc(deps)` destructure confirmed at `:117`.
- `window-factory.js` — `releaseVaultHoldsForWindow?.(chromeForAttachment(win)?.id)`
  confirmed inside the window `close` handler.

No drifted or vanished citations.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`)
- [x] `npm run format` run
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (per the orchestration instruction —
      `completed` follows the flight's end-of-flight review/commit phase)
- [x] Check off this leg in flight.md
- [x] Do NOT commit — the flight defers review and commit to Phase 2d
