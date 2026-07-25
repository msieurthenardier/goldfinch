# Leg: permission-allowlist

**Status**: landed
**Flight**: [Policy and IPC Hardening Batch](../flight.md)

## Objective

Invert the web-session permission handlers from a 12-entry deny-list (`granted = !SENSITIVE.has(perm)`, default-allow) to a positive allowlist (`granted = ALLOWED.has(perm)`, default-deny), so unknown/future permission strings deny by default, while keeping the harmless web features real sites need and preserving the `privacy-permission` indicator push and the internal-session exclusion.

## Context

- Flight DD1. Read it in full. This is a **live behavior change** (not pure defense-in-depth): `openExternal`, `fileSystem` (File System Access API), `keyboardLock`, `deprecated-sync-clipboard-read` go from silently-granted to denied.
- `session-runtime.js:4-17` = `SENSITIVE_PERMISSIONS` (12 entries); handlers at `:227-235`. `granted = !SENSITIVE_PERMISSIONS.has(permission)` → replace with `ALLOWED_PERMISSIONS.has(permission)`.
- `privacy-permission` push (`:231`, payload `{ webContentsId, permission, granted }`) must stay byte-identical — the chrome privacy indicator consumes it (`chrome-preload.js:43` → privacy controller → site-info count).
- Internal-session exclusion is preserved automatically: the handlers install inside `applyShields`, which early-returns on `__goldfinchInternal` (`:157`).
- Electron 43's request vs check handlers take **different** permission-string unions — a single shared `ALLOWED_PERMISSIONS` Set works for both at runtime; comment the asymmetry so nobody "fixes" it.

## Inputs

- Branch `flight/03-policy-and-ipc-hardening` (stacked on flights 1+2); `npm test` green.
- `session-runtime.test.js` has handler-capture fakes (`:102-103`) + one deny assertion (`:194-201`); **no granted assertion exists**.

## Outputs

- `src/main/session-runtime.js` — `SENSITIVE_PERMISSIONS` → `ALLOWED_PERMISSIONS`; both handlers use `.has()` positively; union-asymmetry comment.
- `test/unit/session-runtime.test.js` — invented-permission-denies + a granted-allowlist-member assertion; both handlers share the set.
- flight-log.md — leg entry + FD empirical-pass record.

## Acceptance Criteria

- [x] **AC1 (allowlist)**: `session-runtime.js` defines `ALLOWED_PERMISSIONS` (positive set); both `setPermissionRequestHandler` and `setPermissionCheckHandler` compute `granted = ALLOWED_PERMISSIONS.has(permission)`. The `privacy-permission` push payload `{ webContentsId, permission, granted }` is unchanged.
- [x] **AC2 (membership)**: the allowlist contains the harmless web features real sites need — start from `fullscreen`, `clipboard-sanitized-write`, `pointerLock`, `mediaKeySystem`, `storage-access`, `top-level-storage-access`, `speaker-selection`, `window-management` — and **excludes** the sharp edges that keep denying: `openExternal`, `media`, `geolocation`, `notifications`, `midi`, `midiSysex`, `hid`, `serial`, `usb`, `display-capture`, `idle-detection`, `clipboard-read`, `keyboardLock`, `fileSystem`, `deprecated-sync-clipboard-read`, `unknown`. (Final membership may adjust from the FD empirical pass — record any change.)
- [x] **AC3 (invented denies)**: a unit test asserts an invented/future permission string (e.g. `'some-future-perm-2030'`) is **denied** by both handlers; a second asserts an allowlist member (e.g. `'fullscreen'`) is **granted** and pushes `granted:true`. The prior `geolocation`-denies assertion still holds.
- [x] **AC4 (regression)**: `npm test`, `npm run lint`, `npm run typecheck` pass.
- [ ] **AC5 (FD empirical pass)**: on real pages under `dev:automation`, confirm nothing legitimate regresses — deliberately exercise (a) a **fullscreen** video (granted), (b) a **File System Access API** site (`fileSystem` — now denied; confirm graceful, not a crash), (c) an **`openExternal`/registered-protocol** link (now denied). Record the observed behavior; if a denial breaks a genuinely-needed flow, escalate the allowlist decision (divert).

## Verification Steps

- AC1/AC2/AC3/AC4: `npm test` + read the diff.
- AC5: FD `dev:automation` live pass (deferred to FD after `[HANDOFF:review-needed]`).

## Implementation Guidance

1. Rename/replace `SENSITIVE_PERMISSIONS` → `ALLOWED_PERMISSIONS` with the AC2 membership. Keep it one `Set` shared by both handlers.
2. Both handlers: `const granted = ALLOWED_PERMISSIONS.has(permission);` (request handler keeps the `privacy-permission` push exactly; check handler returns the boolean).
3. Add the union-asymmetry comment (request-only vs check-only members) so the shared set isn't "corrected".
4. Tests: add the invented-denies + granted-member assertions in `session-runtime.test.js` (reuse the existing handler-capture fakes). Keep the existing deny assertion.
5. Run the gate. Hand to FD for AC5.

## Edge Cases

- **Internal session**: still gets no permission handler (applyShields early-returns) — unchanged; don't add one.
- **`bluetooth`**: was in the old deny-list but isn't in Electron 43's unions — simply absent from the allowlist (denied), fine.
- **Handler union mismatch**: an allowlist member only valid for the request union (e.g. `window-management`) will never be asked of the check handler — harmless.

## Files Affected

- `src/main/session-runtime.js`
- `test/unit/session-runtime.test.js`
- flight-log.md

---

## Post-Completion Checklist

- [x] All ACs verified (AC5 by FD, pending)
- [x] Tests passing
- [x] Update flight-log.md
- [x] Set leg status `landed`; commit batched at flight end

---

## Citation Audit

Verified at leg design (2026-07-25, from flight-3 recon): `session-runtime.js:4-17` (set), `:227-235` (handlers), `:231` (push), `:157` (internal early-return); `session-runtime.test.js:102-103,194-201`; `chrome-preload.js:43` (consumer). All OK.
