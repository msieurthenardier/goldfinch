# Squawk 0036: Burner tabs set no WebRTC IP-handling policy — local/public IP leak defeats burner isolation

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

GitHub issue #104, burner-only carve-out. Guest tabs run Chromium's default WebRTC policy, so a page can enumerate the machine's LAN and public IPs via ICE candidate gathering; on a burner tab this defeats the isolation burners exist for, and the UDP binds trigger a Windows Firewall prompt. Set `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` on the burner branch of tab creation only — no user toggle, recorded as a burner-hardening invariant — with a source-pin test. The policy for normal tabs (the issue's four open questions) belongs to the #147 fingerprinting mission, not this squawk.

Source: maintenance report 2026-08-27, finding F53 (#104 carve-out).

## Evidence

- `grep -rn setWebRTCIPHandlingPolicy src` → no hits
- `src/main/register-tab-ipc.js` `tab-create` — burner branch (see `src/shared/burner.js`)

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
