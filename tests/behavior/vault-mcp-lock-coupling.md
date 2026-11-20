# Behavior Test: Automation honors the operator's vault lock

**Slug**: `vault-mcp-lock-coupling`
**Status**: active
**Created**: 2026-11-05
**Last Run**: 2026-11-06-05-34-20 (pass, 10/10)

## Intent

Verify, against the live app, that the operator's vault lock is authoritative over MCP
automation (Sortie 07): an MCP session holding a jar vault key loses it when the operator
locks; a failed `vaultUnlock` reports what the session still holds instead of looking like
"already unlocked"; and the toolbar vault indicator shows (and clears) the
"automation has vault access" cue while the operator's own vault is locked. Unit tests pin
the session/server/teardown logic; only a live run shows the full path: MCP wire → main
`onLock` → every session zeroized → owner push → chrome indicator.

## Preconditions

- A **throwaway** profile provisioned by
  `node tests/behavior/fixtures/vault-login/build-fixtures.mjs <userDataDir>` (fresh, empty dir).
  The operator's vault is **locked** at launch; the builder's JSON gives Jar A's id, Jar A's
  **vault access secret** (`jarAccessSecrets.a`) and Jar A's **transport key**
  (`jarTransportKeys.a`).
- Goldfinch running against that profile:
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --user-data-dir=<dir>`.
  The **admin** key is captured from the `AUTOMATION_DEV_MINT` stdout line. `DEV_MINT`
  re-mints only the default jar's and the admin key hashes, so Jar A's builder transport key
  stays valid **unless Jar A is the resolved default jar** (then DEV_MINT replaces its hash).
  Precondition check: the profile's default jar is neither Jar A nor Jar B. The sanctioned
  probe is a read-only query of the profile's `app.db` (`userData/app.db`, opened read-only,
  never written) for the default jar's id, done as part of Step 1. The Executor also
  confirms in Step 1 that Jar A's key authenticates; if not, halt.
- Attach via env-key scripts (`scripts/lib/mcp-client.mjs` `connectAutomation()`), never the
  registered `goldfinch-dev` MCP server (operator standing preference).
- Two MCP sessions: **J** (Jar A transport key) and **A** (admin key).

## Observables Required

- **mcp**: tool results on session J (`vaultUnlock`, `vaultList`, `vaultTotp`) and session A
  (`getChromeTarget`, `readDom`, `evaluate`, `enumerateWindows`, `captureWindow`).
- **browser (chrome DOM)**: `#vault-indicator`'s `class` and `aria-label`, read by session A
  via `readDom` on the chrome target. If `readDom` doesn't return attributes, use `evaluate`
  (`expression`) reading `className` / `getAttribute('aria-label')`.
- **shell**: the `AUTOMATION_DEV_MINT` line; app stderr and `app.log` for uncaught errors; the
  read-only `app.db` default-jar query (Step 1); the HTTP status of Step 9's session DELETE.
- **Indicator polling timeline** (Steps 3, 7, 8, 9): every "within 2 s" row is judged from a
  mandatory timeline, not one read. The trigger is the **return of the prior call** (the
  `vaultUnlock`, `evaluate` or `terminateSession` that should flip the cue). The Executor then
  polls `#vault-indicator` on A (`evaluate` reading `className` / `getAttribute('aria-label')`)
  about every 250 ms for up to 2 s, recording a timestamp per sample, and stops at the first
  sample showing the expected state. The first sample may already show it; record that as such.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Baseline.** Connect J and A. On A: `getChromeTarget`, then `readDom` `#vault-indicator`; also `enumerateWindows`. | Both sessions authenticate. The indicator has `vault-locked`, NOT `vault-automation-held`, and `aria-label` is `Vault locked`. `enumerateWindows` reports the window as booted. |
| 2 | On J: `vaultUnlock` with `jarAccessSecrets.a`. | Result is `{ unlocked: ["<jarA>"], held: ["<jarA>"] }`. No secret appears in the result. |
| 3 | On A: poll `#vault-indicator` per the polling timeline, triggered by Step 2's return. | Within 2 s: the indicator has `vault-locked` AND `vault-automation-held`, and `aria-label` is `Vault locked — automation has vault access`. [a11y] |
| 4 | On J: `vaultUnlock` with a **wrong** key (`"not-the-secret"`), then `vaultList`. | `vaultUnlock` returns `{ unlocked: [], held: ["<jarA>"] }`. `vaultList` still lists Jar A's seeded login (metadata only). The bad call did not drop the session's keys. |
| 5 | **Lock-while-locked.** Judged together with Steps 6-7: Step 5's own result only shows the call did not error; its effect is judged by the reads in Steps 6 and 7. **Lock now (operator vault already locked).** On A: `evaluate` on the chrome target with `expression: "goldfinch.vaultLock()"`. This is the same IPC the indicator menu's Lock now item calls. The fixture starts with the operator's vault locked, so this step is the Lock-now-while-locked path (the new menu item). Lock-from-unlocked is a HAT step. | The call returns `{ ok: true }` (or resolves without error). |
| 6 | (Judged with Step 5.) On J: `vaultList`, then `vaultTotp` for Jar A's TOTP item id (from Step 4), then `vaultUnlock` with the wrong key. | `vaultList` returns `[]`. `vaultTotp` returns `code: null`. `vaultUnlock` returns `{ unlocked: [], held: [] }`. The empty list and the null code are normal, non-error results (`isError` false). Session J is still connected (no transport error). |
| 7 | (Judged with Steps 5-6.) On A: poll `#vault-indicator` per the polling timeline, triggered by the return of Step 6's last call. | Within 2 s: `vault-automation-held` is gone and `aria-label` is `Vault locked`. [a11y] |
| 8 | On J: `vaultUnlock` with `jarAccessSecrets.a`, then `vaultList`. | `{ unlocked: ["<jarA>"], held: ["<jarA>"] }`; `vaultList` lists the login again. The indicator regains `vault-automation-held` (read on A). |
| 9 | **Teardown clears the cue.** Precondition: no lock is issued between Steps 8 and 9, so the cue is still on. End session J with a graceful DELETE: `transport.terminateSession()` (plain `client.close()` sends no DELETE, so it is not enough). Capture the DELETE's HTTP status in evidence. On A: poll `#vault-indicator` per the polling timeline, triggered by `terminateSession()` returning. | The DELETE returns a success status (2xx), recorded. Within 2 s: `vault-automation-held` is gone. |
| 10 | **Apparatus sweep** (project rule: every existing primitive against the new state). Re-open J, `vaultUnlock` (cue on). On A: `enumerateWindows`, `captureWindow`, `evaluate` `document.querySelector('#vault-indicator').className` on the chrome. | `enumerateWindows` and `captureWindow` succeed. `captureWindow` returns an image, which the Validator judges only for presence; badge pixels are a HAT item. `evaluate` returns a className containing `vault-automation-held`. App stderr and `app.log` show no uncaught exception for the whole run, AND a positive teardown observable holds: the Step 9 DELETE status is recorded, and after the run's last session is ended with `terminateSession()` the indicator on A shows `vault-locked` without `vault-automation-held`. (`app.log` may hold only startup lines, so its silence alone is weak evidence.) |

## Out of Scope

- **The right-click menu contents** (Unlock now + Lock now): the page-context sheet is not in
  `AUTOMATABLE_MENU_TYPES`, so the menu is unobservable. Covered by `pageContextModel` unit tests
  and the HAT.
- **Badge pixels**: HAT (by eye).
- **The operator's own unlock and idle auto-lock**: the vault-unlock sheet is not scriptable, and
  the operator's idle timer arms only while the operator is unlocked. Covered by unit tests
  (teardown order and the store idle → `onLock`) and the HAT.
- **Admin-key sessions and multi-session fan-out**: unit tests (`zeroizeAllVaultSessions`). An
  optional variant appears below.
- **Presence-only screenshot comparison at the cue flips**: optional; badge pixels stay HAT.
- **Memory-level zeroization**: not observable. Steps 6 and 8 assert the behavioral proxy.

## Variants (optional)

- **Two sessions**: open a second J-like session on Jar B (`jarTransportKeys.b`,
  `jarAccessSecrets.b`), unlock both, then Lock now. Both sessions report `held: []`. The cue
  clears only after both are empty, so closing one of two unlocked sessions keeps it on.
- **Ungraceful drop**: end J without a DELETE (`client.close()`) and record whether the cue
  clears; sessions are JSON-response with no stream, so the keys are expected to persist until
  the idle timer or `stop()`. Observation only, no pass/fail.
