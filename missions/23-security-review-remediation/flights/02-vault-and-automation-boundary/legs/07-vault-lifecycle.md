# Leg: vault-lifecycle

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

The vault locks when the machine suspends, its screen locks, or the app quits, and a one-time-code display cannot keep it unlocked forever.

## Context

- Flight DD7 (the lock half). Mission finding 13. The clipboard and file-mode work was split at design review into the next leg, `clipboard-and-file-modes`. Nothing here changes a file format.
- **Lock.** `src/main/vault/vault-store.js`: `lockNow()` is the single lock path (zeroizes, then `onLock`, which `main.js` wires to: close vault sheets in every window, drop automation's vault keys, push the indicator state). `_touch()` re-arms the idle timer (default 10 minutes, `unref`'d); nearly every store method calls it — including `revealItem`, which the vault page's one-time-code widget calls every 30 seconds through `internal-vault-totp-code`. So an open editor with a code widget keeps the vault unlocked indefinitely. Node timers do not count time spent suspended, so a machine asleep for an hour resumes with most of its ten minutes left. There is no `powerMonitor` use anywhere in `src/`. `_touch` coerces the configured interval (settings key `vaultAutoLockMinutes`, validated 1–1440; there is no "never") and falls back to 10; there is **no last-touched stamp** and the store has no injected clock for one. `_suspendAutoLock` (the fresh-adopt key-surfacing window) makes a fired idle timer re-arm instead of locking.
- **`revealItem` has exactly two callers**: `internal-vault-reveal` and `internal-vault-totp-code` (`register-vault-ipc.js`). Automation's `vaultTotp` does not use it (its own keys and idle timer in `automation/vault-context.js`). `internal-vault-state` calls `listItemsMeta` per jar, which also touches — if anything polls it, it defeats the idle lock the same way.
- **What a lock already tears down** (design review, `main.js` `onLock`): pending vault and browser imports dropped; save prompts closed and captures dropped; automation's vault keys zeroized (`zeroizeAllVaultSessions`); vault sheets closed in every window; state broadcast. The picker context survives a lock by design. So a new trigger needs nothing beyond calling `lockNow()`.
- **The vault is NOT locked at quit today.** `before-quit` (`app-lifecycle.js`) runs the snapshot flush, the history title-timer cancel, the session write, the downloads flush and the MCP stop; the store's comment about a quit hook describes something that was never wired (`lockNow` is called only from the toolbar-lock channel and one vault channel). Process exit drops the keys regardless, but an orderly lock is what makes sheets close and automation keys zeroize before teardown, and it is one line.
- **`powerMonitor` on Electron 45.3.2** (typings): `suspend` / `resume` on every platform; `lock-screen` / `unlock-screen` on macOS and Windows only; `user-did-resign-active` on macOS only; `shutdown` on Linux and macOS. Usable only after `app.ready`. **On Linux there is no screen-lock event at all** — only suspend.
- Budgets: do not touch `src/renderer/renderer.js`. `main.js` gets wiring only.

## Inputs

- Legs 01–06 landed (uncommitted).
- Files named above; `src/renderer/pages/vault.js` / `vault-secret-reads-controller.js` (the code widget, rewritten in leg `admin-reach`); `src/main/reveal-gate.js`; `test/unit/vault-totp-code-handler.test.js` and the vault-store suites.

## Outputs

- A power/lock listener module, a quit lock, a non-touching code read — each with unit tests; docs.

## Acceptance Criteria

**Lock on suspend and screen lock**

- [ ] **AC1 — Events lock the vault.** A small Electron-free module (injected `powerMonitor`-shaped emitter, `lockNow`, `isUnlocked`, clock) subscribes to `suspend`, `lock-screen`, `user-did-resign-active` and `shutdown` with named handlers, and on each calls the store's `lockNow()` — the same single path as the toolbar's lock, so sheets close, automation's vault keys are dropped and the indicator updates, with nothing duplicated. Registered once, after `app.ready`. Already locked → no-op, no throw. Unit: each event locks; an unknown event does nothing; a throwing `lockNow` does not escape the listener; and one test through the **real** `onLock` wiring that the trigger reaches automation's `zeroizeAllVaultSessions`. **Decision — the adopt key-surfacing window**: while the store reports auto-lock suspended (`_suspendAutoLock`, exposed by a getter), the power triggers do **not** lock, exactly as the idle timer does not — locking there would close the one screen that shows a freshly adopted profile's recovery key. Tested and stated in the docs.
- [ ] **AC2 — Resume after a long sleep locks too.** On `resume` (and `unlock-screen`), if the vault is unlocked and the time since it was last touched is at least the auto-lock interval, lock. `_touch` records a stamp on an injected clock and the store exposes `idleMs()` (null when locked) and the **same coerced interval** `_touch` uses (one helper; the power module does not re-derive it). The stamp uses wall-clock time, because a monotonic clock does not advance while suspended and that elapsed sleep is the whole point here; a clock set backwards across the sleep only delays this fallback, and `suspend` has normally locked already. Belt and braces: `suspend` should already have locked; this covers a missed event. Unit with an injected wall clock.
- [ ] **AC3 — Global-hook rule.** This is a new app-wide listener. The spike premises it could change, each re-proven: (a) quit and Restart-to-apply still complete (the listener holds nothing open; unit pin that it is registered after ready and removed or harmless at quit, and a live quit and a live Restart-now on the changed build); (b) a lock arriving while a vault sheet is open in two windows closes both, exactly as the toolbar lock does (existing lock fan-out test re-used with the new trigger); (c) a lock arriving while the reveal gate's confirmation is pending — the confirmation, if then given, reveals nothing (`{ locked: true }`), as leg `admin-reach` requires; read `reveal-gate.js` and the vault registrar to confirm this holds and that a lock also voids the per-item grants (if grants survive a lock, that is a defect to fix here: a locked-then-unlocked vault must ask again).
- [ ] **AC3b — The vault locks at quit.** `before-quit` calls `lockNow()` in its own `try` (logged on failure), placed **before** `getMcpServer()?.stop()` so the lock's teardown still has a server to zeroize and windows to close sheets in. Unit pin on presence, guard and order; live quit with the listener and the lock in place exits cleanly. `app.exit()`, `process.exit` and signals do not deliver `before-quit` — stated in the docs.

**The idle timer**

- [ ] **AC4 — A code read does not re-arm the idle timer.** `revealItem(target, itemId, { touch = true } = {})`; `internal-vault-totp-code` passes `touch: false`. The locked check stays (a locked vault still answers `{ locked: true }`). Every other caller of `revealItem` is unchanged. Unit: with only code reads arriving every 30 s on a fake clock, the vault locks at the idle interval; a real reveal in between re-arms it. The page already handles `{ locked: true }` mid-poll — confirm by test that the widget stops cleanly and the editor shows the locked state rather than a stale code. **Also**: find every periodic caller that reaches a touching store method — grep the renderer and chrome for callers of the vault-state and lock-state bridges and for timers or intervals around them. Each is either shown to be event-driven (cite it) or given the same non-touching read. A poller left re-arming the timer makes this AC false.

**Docs and gates**

- [ ] **AC12 — Docs.** `docs/vault.md`: what locks the vault now — idle, suspend, resume after a long sleep, screen lock and user switch where the platform reports them, shutdown, quit — and, plainly, that **on Linux locking the screen does not lock the vault** (no event exists; suspend does); that a one-time-code display no longer holds the vault open; that the adopt key-surfacing window defers a power lock; and, as a named section, **what is not re-keyed** — access-key revocation and master-password change — with compromise rotation as the remedy (someone holding an old copy of the vault file and the revoked key or old password can still open that copy). `CLAUDE.md`: the vault paragraph and the quit order. The mission's disposition for finding 13's re-keying item (accepted) is recorded in the flight log for the flight-end table.
- [ ] **AC13 — Live** (scratch profile; **no agent types a master password** — the scratch profile has no vault, so vault-dependent checks are recorded not run and go to the HAT): the app boots with the listeners registered and **`powerMonitor` does not fail or spam on WSL** (read the launch output; a main-side log line under a trace flag may confirm registration — do not add an IPC channel for it); a clean quit and a Restart-now both complete with the quit lock in place; every apparatus primitive still works. `suspend` cannot be raised on WSL: not run, `[by-eye]` on a real machine.
- [ ] **AC14 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass. 

## Verification Steps

- AC1–AC3: new `vault-power-lock.test.js`; the existing lock fan-out tests; live quit / restart.
- AC4: `vault-store` and `vault-totp-code-handler` tests on a fake clock (MockTimers enabled per test, drained with real `setImmediate` around single-step ticks); the page controller test; the poller sweep in the flight log.
- AC12: read by the Flight Director. AC13: script output in the flight log.

## Implementation Guidance

1. Read the `onLock` wiring in `main.js` and `before-quit` in `app-lifecycle.js`; place the power listener's construction beside the former (wiring only). `app-lifecycle.js`, `register-vault-ipc.js` and `main.js` were edited by earlier legs of this flight — re-read before editing.
2. Store: stamp, `idleMs()`, the coerced-interval helper, the suspended getter, `revealItem`'s option. Then the power module, the quit lock, the code-read handler, the poller sweep.
3. Live smoke; docs.
4. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **`suspend` while an unlock is deriving its key**: the store already guards a lock arriving mid-derive (its generation check) — the new trigger uses the same `lockNow`, so nothing new; add one test that names the case.
- **`lock-screen` storms** (some platforms fire it repeatedly): idempotent.
- **`resume` with the vault already locked**: no-op.
- **macOS**: `lock-screen` and `user-did-resign-active` exist; unverifiable here → by-eye.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- New: `src/main/vault/power-lock.js` (name at the Developer's discretion).
- `src/main/main.js` (wiring), `src/main/app-lifecycle.js` (`before-quit`), `src/main/register-vault-ipc.js`, `src/main/vault/vault-store.js`; a page controller only if the poller sweep requires it.
- Tests as listed; `docs/vault.md`, `CLAUDE.md`.

## Citation Audit

Read at leg design (2026-11-14, tree after `automation-input`): `vault-store.js` `_touch` / `lockNow` and the comment on the quit hook; `register-settings-ipc.js` `clipboard:write` with its closure timer and still-holds check; `register-overlay-ipc.js` `menu-overlay:copy-text` → `writeClipboard`; `main.js` `writeClipboard: (text) => clipboard.writeText(String(text))` and the `onLock` wiring; `app-lifecycle.js` `before-quit` body; `atomic-write.js` `fs.openSync(tmp, 'wx')`; `vault-store.js` `mkdirSync(this.vaultsDir, { recursive: true })`; `main.js` bundle `writeFileSync`; `app-db.js` / `history-store.js` `mkdirSync`; `crash-log.js` `writeFileSync`. Developer design review (Sonnet, 2026-11-14): approve with changes, adopted — **the leg's premise that the vault is locked at quit was false** (a comment describes a hook that was never wired; the quit lock is now built here); no last-touched stamp or "never" setting exists; the adopt key-surfacing window must defer a power lock; `revealItem` has two callers and the non-touching read is an option on it; other touching pollers must be swept; `powerMonitor`'s event set per platform, with no screen-lock event on Linux; a lock's existing teardown confirmed sufficient. **Split**: clipboard and file modes moved to leg `clipboard-and-file-modes`. No second pass.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
