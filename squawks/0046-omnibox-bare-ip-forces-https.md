# Squawk 0046: Omnibox forces `https://` on a bare `IP:port` host with no http fallback — loopback dev URLs fail to a blank error page

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-28
**Completed**: —

## Report

Typing a bare `127.0.0.1:8001/links.html` (no scheme) into the address bar navigates to `https://127.0.0.1:8001/links.html`; against an HTTP-only server the TLS handshake fails and the guest lands on `chrome-error://chromewebdata/` — a blank white page with no hint that a scheme was assumed. Observed live during the Mission 17 Flight 1 HAT (2026-08-28): the operator typed the bare loopback URL and got the blank page; the same target loads correctly when typed with an explicit `http://`.

Cause: `normalizeHomePageInput` (`src/shared/search-engines.js:191-198`) prepends `https://` to any bare value that "looks like a domain" — regex `/^[^\s]+\.[^\s]{2,}(\/.*)?$/` at `:194`. An IP literal with a port and path (`127.0.0.1:8001/links.html`) has dots and matches, so it is treated as a bare domain and forced to https. `navigation-controller.js`'s `toUrl` reuses this exact rule for the address bar's domain branch (single source, by design). The JSDoc already documents that `localhost` (no dot) is an intentional gap; dotted IP literals fall on the other side and get https with no http fallback.

## Evidence

- `src/shared/search-engines.js:194` — `if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s)) return 'https://' + s;`
- `src/shared/search-engines.js:191-198` — `normalizeHomePageInput`, reused by the address bar's `toUrl` (see the function's own JSDoc, "`navigation-controller.js`'s `toUrl` calls this for its own domain branch").
- HAT observation: guest `location.href === 'chrome-error://chromewebdata/'`, `document.body.innerHTML.length === 0`, screenshot blank — after the bare-IP navigation; flight-log 2026-08-28.

## Qualification note (read before completing)

This borders the squawk gate's "no design decisions" criterion. Prepending `https://` to bare input is a deliberate, security-motivated default (no silent http downgrade) — so the corrective action is **not** simply "prepend http". The Developer must first confirm goldfinch's intended scheme policy for loopback/IP-literal hosts. If any of these is chosen — special-casing loopback (`127.0.0.0/8`, `::1`, `localhost`) to http, treating dotted IP literals differently from domains, or retrying http on a TLS failure to a loopback host — and it changes the shared `normalizeHomePageInput` contract or the security posture, that is a **design decision** and the fix escalates to a flight (`[BLOCKED:exceeds-squawk-scope]`). The squawk-eligible slice, if one exists, is a contained defect fix (e.g. loopback-literal → http) plus a unit test on `normalizeHomePageInput`, with the security rationale confirmed in the leg/PR. A minimum acceptable outcome even without a code change is a **non-blank failed-navigation surface** so the assumed scheme is visible — but that too may be a separate concern.

## Corrective Action

*(recorded by the Developer)*

## Verification

*(recorded by the Developer)*
