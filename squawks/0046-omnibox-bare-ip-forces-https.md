# Squawk 0046: Omnibox forces `https://` on a bare `IP:port` host with no http fallback — loopback dev URLs fail to a blank error page

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-28
**Completed**: 2026-08-28

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

Scope-gate decision: contained fix qualifies. Added a narrow `LOOPBACK_LITERAL_RE` check in `normalizeHomePageInput` (`src/shared/search-engines.js`), checked before the existing domain regex, that prepends `http://` instead of `https://` to a bare loopback literal:

- `127.0.0.0/8` (e.g. `127.0.0.1`), bare or with `:port` and/or `/path`
- `::1` bare, or bracketed `[::1]` with `:port` and/or `/path` — an unbracketed `::1:port` is deliberately NOT matched (it is a distinct, non-loopback IPv6 address, not "loopback plus port")
- `localhost` ONLY when a `:port` or `/path` follows

The pre-existing, intentionally tested gap — a bare `localhost` with nothing following stays unchanged (M16 F3 Leg 2, HAT item 5) — is preserved unchanged: widening it would alter the Settings/welcome home-page write sites' already-agreed contract for that exact input, which is a design decision outside this squawk's scope. Real domains (e.g. `example.com`, `example.com:8001/x`) are unaffected — still forced to `https://`. An explicit scheme on any input (including `http://` on a loopback host) is always respected, unchanged.

`normalizeHomePageInput` is shared by three call sites (`navigation-controller.js`'s `toUrl` for the address bar, `welcome-controller.js`'s `submitHome`, `settings.js`'s home-page Save handler) — all three now agree on the loopback carve-out, same as they already agreed on the domain rule.

Not done (per the qualification note, out of contained scope): non-loopback IP literals, public-host scheme policy, and TLS-failure retry/fallback are untouched.

## Verification

- New unit tests in `test/unit/search-engines.test.js` (9 new test blocks (10 assertions)): `127.0.0.1:8001/links.html` → `http://127.0.0.1:8001/links.html` (the exact HAT repro); bare `127.0.0.1`; `localhost:3000`; `localhost/app`; bare `::1`; bracketed `[::1]:8001/x`; unbracketed `::1:3000` NOT treated as loopback (unchanged); `example.com` and `example.com:8001/x` unchanged (still https); explicit `http://127.0.0.1:8001/x` unchanged (no double-prepend).
- Full suite: `timeout 300 npm test` — 3950/3950 pass.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npx prettier --check .` — clean.

## Sign-off

Independent Reviewer (batch turnaround 2026-08-28): `[HANDOFF:confirmed]` — the `LOOPBACK_LITERAL_RE` carve-out matches only `127.0.0.0/8` (bare/port/path), `::1`/`[::1]` (port/path), and `localhost` with a trailing `:`/`/`; verified directly that `localhost.example.com`, `127.0.0.1.example.com`, and real domains do NOT false-match and still resolve to https; the bare-`localhost` gap is preserved; `normalizeHomePageInput`'s three call sites (toUrl, welcome-controller, settings) are unaffected (they assert delegation, not values) and http-for-loopback is coherent at each. 9 new test blocks; gates green (3950/3950). Scope-gate call (contained loopback carve-out, no scheme-policy decision) upheld on independent review.
