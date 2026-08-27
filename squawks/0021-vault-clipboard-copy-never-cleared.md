# Squawk 0021: Vault "copy password" leaves the secret in the OS clipboard indefinitely

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Copying a vault password is a bare `clipboard.writeText`; nothing clears it. Clear the clipboard after ~20 s if its contents are still the copied value (the pattern every password manager uses). Platform "concealed"/exclude-from-history markers are a separate, platform-specific item and are out of this squawk's scope.

Source: maintenance report 2026-08-27, finding F5 (timeout half).

## Evidence

- `src/renderer/pages/vault.js:1532` → `src/main/register-settings-ipc.js:79-81` — `clipboard.writeText(text)` with no follow-up

## Corrective Action

`clipboard:write` (`src/main/register-settings-ipc.js`) is the one generic internal
clipboard sink — the vault's secret Copy button rides it, and so does the
settings page's `navigator.clipboard` fallback (DD4/`copyText`) for non-secret
values. Added an explicit `opts.secret` discriminator (a third, optional call
argument) rather than a new channel, so every existing caller that omits it keeps
its exact prior behavior:

- The handler now writes the clipboard as before, then clears any previously
  pending clear-timer (one pending timer total, always cleared and re-armed on
  every write, secret or not — a later plain copy can't be wiped by a stale
  secret timer). When `opts.secret === true`, it arms a fresh 20s timer that, on
  fire, reads the clipboard back and clears it **only if it still equals the
  value that was written** — an operator's later copy (in this app or another)
  is never clobbered. The timer is `unref()`ed so it can never hold the process
  open.
- `src/preload/internal-preload.js`'s `clipboardWrite` bridge method forwards an
  optional second argument straight through to the IPC call; the exposed shape
  for the settings page's existing single-argument callers is unchanged.
- `src/renderer/pages/vault.js`'s secret Copy button now calls
  `bridge.clipboardWrite(secret, { secret: true })`.
- `src/renderer/renderer-globals.d.ts`'s `clipboardWrite` type gained the
  optional `opts` parameter.

No injection seam was added: the timer uses the global `setTimeout`/
`clearTimeout` pair directly (the `src/main/capture-timeout.js` precedent),
driven in tests by `node:test` MockTimers rather than an injected clock — the
real `clipboard` dependency (Electron's `clipboard` module, passed in from
`main.js`) already exposes `readText()`, so no new seam was needed there either.
Platform "concealed"/exclude-from-history clipboard markers remain out of scope.

## Verification

Extended `test/unit/helpers/settings-ipc-harness.js`'s fake `clipboard` from a
write-only spy to a stateful `{ writeText, readText }` fake (exposed on the
harness return value) so tests can assert on read-back-and-compare behavior, not
just calls. Added five tests to `test/unit/register-settings-ipc.test.js`
(`t.mock.timers.enable(...)` per test, per CLAUDE.md's MockTimers recipe):

1. A secret copy clears the clipboard 20s later when unchanged.
2. A secret copy leaves the clipboard alone if it was changed before the window
   elapsed.
3. A second secret copy re-arms the timer and resets the 20s window (proven by
   ticking to 25s-since-copy-1/10s-since-copy-2 and observing no clear, then to
   20s-since-copy-2 and observing the clear).
4. A non-secret copy (`opts` omitted — the settings-page DD4 fallback) never
   arms a clear timer.
5. A later non-secret copy cancels a still-pending secret-clear timer rather
   than being wiped by it.

Ran `timeout 180 npm test` (3806/3806 pass, including the 12 in
`register-settings-ipc.test.js`), `npm run lint` (clean), and
`npm run typecheck` (clean). No files outside the copy path + its tests +
the squawk artifact were touched; squawks 0017–0020's uncommitted changes in
the shared working tree were left untouched.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
