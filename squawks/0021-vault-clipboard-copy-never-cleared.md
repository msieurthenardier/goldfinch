# Squawk 0021: Vault "copy password" leaves the secret in the OS clipboard indefinitely

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Copying a vault password is a bare `clipboard.writeText`; nothing clears it. Clear the clipboard after ~20 s if its contents are still the copied value (the pattern every password manager uses). Platform "concealed"/exclude-from-history markers are a separate, platform-specific item and are out of this squawk's scope.

Source: maintenance report 2026-08-27, finding F5 (timeout half).

## Evidence

- `src/renderer/pages/vault.js:1532` → `src/main/register-settings-ipc.js:79-81` — `clipboard.writeText(text)` with no follow-up

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
