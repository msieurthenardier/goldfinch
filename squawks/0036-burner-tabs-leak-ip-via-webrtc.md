# Squawk 0036: Burner tabs set no WebRTC IP-handling policy — local/public IP leak defeats burner isolation

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

GitHub issue #104, burner-only carve-out. Guest tabs run Chromium's default WebRTC policy, so a page can enumerate the machine's LAN and public IPs via ICE candidate gathering; on a burner tab this defeats the isolation burners exist for, and the UDP binds trigger a Windows Firewall prompt. Set `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` on the burner branch of tab creation only — no user toggle, recorded as a burner-hardening invariant — with a source-pin test. The policy for normal tabs (the issue's four open questions) belongs to the #147 fingerprinting mission, not this squawk.

Source: maintenance report 2026-08-27, finding F53 (#104 carve-out).

## Evidence

- `grep -rn setWebRTCIPHandlingPolicy src` → no hits
- `src/main/register-tab-ipc.js` `tab-create` — burner branch (see `src/shared/burner.js`)

## Corrective Action

Added `isBurnerPartition(partition)` to `src/shared/burner.js` — a pure predicate on the already-pinned `burner:<n>` partition shape (colon separator, no `persist:` prefix; documented in `src/shared/inherit-container.js`), exported as the smallest shared hook between the two call sites below.

- `src/main/register-tab-ipc.js`: `tab-create`'s WEB (untrusted) branch calls `view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` immediately after the `WebContentsView` is constructed, gated on `!trusted && isBurnerPartition(partition)`. The internal/trusted branch and normal-jar `persist:` partitions are unaffected — no user toggle exists.
- `src/main/guest-wiring.js`: popups opened from a burner tab inherit the opener's session with no `partition` key on `overrideBrowserWindowOptions.webPreferences` (the existing DD1d posture), so they never pass through `tab-create`'s call. `did-create-window` now applies the same policy to `popupWc` when the captured opener `partition` (the same value the popup's own census/history attribution already uses) is a burner partition.

Both sites carry a one-line comment recording this as a burner-hardening invariant. Normal-tab WebRTC policy is explicitly out of scope (belongs to the #147 fingerprinting mission).

## Verification

- `test/unit/register-tab-ipc.test.js`: new test asserts the policy call fires exactly once, with `'disable_non_proxied_udp'`, for a `burner:42` partition web tab, and does not fire for a `persist:jar-a` web tab or a trusted/internal tab (harness's `FakeContents` gained a recording `setWebRTCIPHandlingPolicy`).
- `test/unit/guest-wiring.test.js`: new test drives `did-create-window` through the existing `popupHarness`, asserting the policy is applied to the popup's webContents when the captured opener partition is `burner:99`, and left unset (`undefined`) for the harness's default `persist:jar-a` opener partition (harness's `FakeContents` gained the same recording stub).
- `timeout 180 npm test` — full suite green: 3821 tests, 3821 pass, 0 fail.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `git status --short` confirms only the intended files changed: `src/main/guest-wiring.js`, `src/main/register-tab-ipc.js`, `src/shared/burner.js`, `test/unit/guest-wiring.test.js`, `test/unit/register-tab-ipc.test.js`, plus this squawk file. No other in-flight batch files touched.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
