# Leg: operator-input-predicate

**Status**: completed
**Flight**: [Reveal Gate Covers Vault Item Writes](../flight.md)

## Objective

Replace the two inline "is automation injecting into this tab" checks — the vault click witness in `guest-wiring.js` and the reveal gate's `handleRevealInputEvent` — with one exported predicate, `isOperatorInput(injectedInput, wcId)`, with two deliberate fail-safe tightenings and no other behaviour change:
- a store that throws can no longer escape the witness listener;
- a malformed store (`isInjecting` not a function, or returning a non-boolean) never counts as the operator's input.

The production store always returns booleans.

## Context

- Flight Design Decision: "`isOperatorInput` lands here, not as a squawk" (maintenance finding #28; known Mission 23 debt).
- Today the two consumers differ in null-safety:
  - `src/main/guest-wiring.js`, the witness `input-event` listener: `if (injectedInput?.isInjecting(wcId)) return;`. A missing store means "operator". A store that throws, throws out of the listener.
  - `src/main/reveal-gate.js` `handleRevealInputEvent`: `if (injectedInput?.isInjecting?.(wcId)) return;`, inside a `try` that swallows. A throw means no cancel.
- **A third consumer needs no change.** `window-factory.js`'s chrome-view listener calls `handleRevealInputEvent` with `injectedInput`, so the chrome view inherits the predicate through that shared function.
- **Deliberately out of scope:** `guest-wiring.js`'s `injectedInput?.isJarInjecting(contents.id)` in the guest `before-input-event` handler is a different concern (jar-tier shortcut suppression). A throw there could escape too; this is noted and left alone.
- The store: `src/main/automation/injected-input.js` `createInjectedInput()` returns `{ begin, isInjecting, isJarInjecting, forget }`.
- **Fail-safe direction, per consumer:**
  - Witness: anything other than a clear "not injecting" must NOT record the input as the operator's.
  - Reveal cancel: a missed cancel leaves the dialog to its 60 s timeout, which is today's behaviour on a throw.
  - So one predicate that answers `true` only when the store clearly says "not injecting" is correct for both.

## Inputs

- Legs 2 and 3 landed; `reveal-gate.js` has their edits. Re-read it. The coupling is the shared file only; the predicate itself is independent.

## Outputs

- `src/main/automation/injected-input.js`: the new exported `isOperatorInput(store, wcId)`.
- `src/main/guest-wiring.js` and `src/main/reveal-gate.js`: both call it.
- Tests: `test/unit/injected-input.test.js`, plus any source-scan pin that names the old inline form (`test/unit/injected-input-invariant.test.js`, `test/unit/reveal-gate-stranding-wiring.test.js`), re-targeted.
- CLAUDE.md: the two sentences that describe the witness and the reveal-gate listener's `isInjecting` check now name `isOperatorInput`.

## Acceptance Criteria

- [ ] **The predicate.** `isOperatorInput(store, wcId)` is exported from `injected-input.js`. It returns:
  - `true` when `store` is `null` / `undefined` (no automation wiring, so all input is the operator's);
  - `false` when `store.isInjecting` is not a function, or when it throws;
  - otherwise `store.isInjecting(wcId) === false`. Anything else, a truthy or non-boolean value included, means "not operator".
  - It never throws. Unit-tested for: `null` store, `{}`, a throwing `isInjecting`, `isInjecting: () => 1`, `() => true`, and `() => false`.
- [ ] **The witness listener** in `guest-wiring.js` uses `if (!isOperatorInput(injectedInput, wcId)) return;` and keeps its mouse-type filter first. Existing witness tests stay green.
- [ ] **`handleRevealInputEvent`** uses `if (!isOperatorInput(injectedInput, wcId)) return;` after `isRevealCancelInput`. Existing stranding and gate tests stay green.
- [ ] **Pins.**
  - `test/unit/injected-input-invariant.test.js`'s witness pin (the regex on `if \(injectedInput\?\.isInjecting\(wcId\)\) return;` before `gestureWitness.onInput`) and its "witness gate" mutation entry are re-targeted to `if (!isOperatorInput(injectedInput, wcId)) return;`. The mutation keeps its `assertMutated` call.
  - A NEW pin asserts that `reveal-gate.js` `handleRevealInputEvent` calls `isOperatorInput` and contains no raw `isInjecting` call.
  - Both are neuter-verified.
  - `reveal-gate-stranding-wiring.test.js` does not name `isInjecting`; confirm it needs no change.
- [ ] **No other `isInjecting(` call remains** in `src/main/**` outside `injected-input.js` itself (grep AC). Every source-scan pin that matched the old inline text is re-targeted to the new call and neuter-verified. Record which pins were touched in the flight log.
- [ ] **One behaviour change, tested:** a throwing store in the witness listener no longer throws out of the listener, and the input is not fed to the witness.
- [ ] **CLAUDE.md** names `isOperatorInput` at both places that describe these checks: the reveal-gate paragraph ("never injected input per `injectedInput.isInjecting`") and the vault *Raising the picker* paragraph ("the listener skips while `isInjecting(wcId)` at EVERY tier").
- [ ] **Stale text.** The `handleRevealInputEvent` JSDoc typedef and the `guest-wiring.js` comments that describe the old inline check are updated.
- [ ] **No regression.** `npm test`, `npm run lint`, `npm run typecheck` and `npm run format:check` are green.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/injected-input.test.js test/unit/injected-input-invariant.test.js test/unit/reveal-gate.test.js test/unit/reveal-gate-stranding-wiring.test.js test/unit/guest-wiring.test.js`
- `grep -rn "isInjecting(" src/main | grep -v automation/injected-input.js` returns nothing.
- `timeout 300 npm test && npm run lint && npm run typecheck && npm run format:check`

## Implementation Guidance

1. Add and export the function in `injected-input.js`, next to `createInjectedInput`.
2. `guest-wiring.js` requires it from `./automation/injected-input`. Check that this does not create a require cycle; `injected-input.js` requires nothing from `src/main`.
3. `reveal-gate.js` requires it too. `reveal-gate.js` is Electron-free and `injected-input.js` is too, so the CLAUDE.md "Electron-free" shape holds.
4. Find the pins with `grep -rn "isInjecting" test/unit` and re-target each one.

## Edge Cases

- **`injectedInput` is undefined in a unit-test harness** (`createGuestWiring` without the dep): the predicate returns `true`, the same as today's `?.`.
- **`isJarInjecting`** is a different concern (the jar-tier shortcut suppression) and is NOT folded in.

## Files Affected

- `src/main/automation/injected-input.js`, `src/main/guest-wiring.js`, `src/main/reveal-gate.js`
- `test/unit/injected-input.test.js` (plus the re-targeted pins)
- `CLAUDE.md`

## Citation Audit

Checked 2026-11-18:
- `guest-wiring.js`: the witness listener `if (injectedInput?.isInjecting(wcId)) return;` (~:592).
- `reveal-gate.js` `handleRevealInputEvent`: `if (injectedInput?.isInjecting?.(wcId)) return;`.
- `injected-input.js` `createInjectedInput` returns `{ begin, isInjecting, isJarInjecting, forget }`; the module exports `{ createInjectedInput, ALLOWANCE_MS, MENU_HOLD_MS }`.
