# Squawk 0229: Compromise rotation does not tell the operator which vaults it skipped

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
Since squawk 0191, compromise rotation re-encrypts every readable vault, leaves an unreadable file untouched on disk, and returns `skipped: [{ id, reason }]` with one log line for each skipped vault (operator ruling 2026-11-19). The list stops in main. `vaultCompromiseRotate` in `main.js` forwards only `recoveryKey` and `revoked`, so the sheet shows a successful rotation with no hint that a vault was left out.

A skipped vault stays under the OLD master key, cannot be opened with the new one, and keeps its access envelopes. Its id is also missing from `revoked.vaultIds`. During a compromise, the operator needs to know this in order to restore that vault from a bundle or delete it. Found in the 2026-11-19 batch review (0190/0191).

## Evidence
- `src/main/main.js`, `vaultCompromiseRotate`: `return { ok: true, recoveryKey: res.recoveryKey, revoked: res.revoked };`
- `src/main/vault/vault-store.js`, `compromiseRotate`: the `skipped` return (squawk 0191).
- `src/main/register-overlay-ipc.js`: the `menu-overlay:vault-compromise` and `-recover` handlers, which stash the result for the recovery-show sheet.
- Scope note: the natural display is the recovery-show sheet (a secret, dismiss-locked card). If the fix has to change that card's protocol rather than add a count line, it fails the squawk gate (security-sensitive surface) and goes to a sortie.

## Corrective Action
*(written at completion)*

## Verification
- After a rotation that skipped a vault, the operator sees how many vaults were not rotated and that those vaults still open only with the old key.
- The message shows a count and a fixed sentence: no vault content, and no vault ids beyond what the vault page already shows.
- A unit test pins the forwarding through `vaultCompromiseRotate` and the handler.

## Sign-Off
*(written at completion)*
