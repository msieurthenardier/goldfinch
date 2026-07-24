# Behavior Test: Registrable-Domain Fill Opt-In

**Slug**: `vault-registrable-domain-fill`
**Status**: draft
**Created**: 2026-07-21
**Last Run**: never

## Intent

Verifies the **guest-observable** behavior of the registrable-domain fill opt-in (Mission 12, Flight 4,
DD5): a credential with `matchMode: 'registrable-domain'` fills across a **hardened-matched subdomain**
(e.g. `accounts.example.com` ↔ a credential stored for `example.com`) but is **refused** across an
unrelated registry sibling, a multi-tenant platform tenant, or a scheme mismatch — and that an
**exact-mode** (default) credential never widens. This needs real-environment observation: the vendored
PSL matcher resolving a real `URL.hostname`, the automation fill delegate populating a real guest form,
and the refusal returning a normal `{ filled: false }` — none of which a unit test can prove end-to-end
through the live MCP wire.

**Apparatus (Flight 4 DD5):** this test drives the **automation `vaultFill` path** and observes the
**guest DOM** — both jar-key-reachable. It deliberately does NOT touch the human **picker** or the
"Subdomain match" **badge**, nor the capture save-vs-update disposition — those are human chrome-surface
concerns, verified by the F5 HAT manual segment (where the operator sees the badge on a widened offer) +
the Leg-4 unit tests (`vault-matchmode-fill.test.js`). The fill DECISION (`originMatches` → the vendored
PSL) is what this test exercises live; the widen is driven via `vaultFill`, observed in the filled fields.

**Fixture-origin premise (must be probed before the run):** the PSL keys off the tab's real
`URL.hostname`, so the fixtures need hostnames that (a) resolve to the local fixture server and (b) share
a **PSL-known** registrable domain. A reserved TLD (`.test`, `.localhost`) is **not** in the PSL → it
fails **closed** to `null` → the widen never fires, which would make a positive step silently impossible.
Use `/etc/hosts` aliases to 127.0.0.1 for real PSL-listed names:
- `example.com`, `accounts.example.com`, `app.example.com` → 127.0.0.1 (eTLD+1 `example.com`; `com` is a
  public suffix → the widen fires across these subdomains).
- `alice.github.io`, `bob.github.io` → 127.0.0.1 (**`github.io` is a public suffix** → the two tenants
  have DISTINCT eTLD+1 → the widen is REFUSED — the load-bearing negative).
The fixture HTTP server serves the login page for any `Host`; the tab origin is `http://<alias>:<port>`.
Same scheme + same port across the aliases, so only the hostname varies.

## Preconditions

- Goldfinch dev build running with the MCP automation surface (`npm run dev:automation`, loopback).
- A **jar** transport key + the fixture jar's **vault access key** (drives the guest tab, calls
  `vaultUnlock`/`vaultFill`, reads filled fields). An admin key is not required.
- `/etc/hosts` aliases (above) in place; verified that navigating to `http://accounts.example.com:<port>`
  reaches the fixture server (probe: `navigate` + `readDom` shows the login form). **If the aliases
  aren't resolvable, STOP — the positive step can't pass and the whole test is invalid.**
- **The vault-fixture builder must be EXTENDED first** (design-review [HIGH]): the current
  `tests/behavior/fixtures/vault-login/build-fixtures.mjs` seeds one login per vault at a single origin
  with no `matchMode`. This test needs per-vault **multi-origin** items **with a `matchMode` field** — a
  named pre-flight task before the run. Once extended, provision in the fixture jar's vault:
  - **RD-cred**: a login for origin `http://example.com:<port>` with `matchMode: 'registrable-domain'`,
    a known username/password.
  - **Exact-cred**: a login for origin `http://app.example.com:<port>` with `matchMode: 'exact'` (default).
  - **Tenant-cred**: a login for origin `http://alice.github.io:<port>` with `matchMode:
    'registrable-domain'`.
- The vault is unlockable via the fixture jar's access key (`vaultUnlock`).

## Observables Required

- browser (guest DOM: the login form's username/password field VALUES after a fill attempt; the form
  stays empty on a refusal) — measured via goldfinch MCP `readDom` / `evaluate` (jar key, jar-membership
  gated).
- tool-result (`vaultFill` returns `{ filled: true, id }` on a match or `{ filled: false, reason:
  'origin-mismatch' }` on a refusal — a NORMAL result, never a thrown error) — measured via the MCP
  tool response.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Unlock the fixture jar's vault via `vaultUnlock` with the jar access key. Then `vaultList`. | Unlock succeeds; `vaultList` returns the three fixture login items (RD-cred, Exact-cred, Tenant-cred) by id — no password in the listing. |
| 2 | Open a tab in the fixture jar; navigate to `http://accounts.example.com:<port>` (a matched **subdomain** of the RD-cred's `example.com`). Wait for the login form; confirm the username/password fields are empty. | The login form renders; both fields are empty. |
| 3 | Call `vaultFill` with `{ wcId, itemId: <RD-cred id> }` for this tab. Read the tool result, then read the guest DOM field values. | `vaultFill` returns `{ filled: true, id, origin: 'http://accounts.example.com:<port>' }` (the resolved tab origin the audit records — never a password). The username/password fields now hold the RD-cred's credential — the **registrable-domain widen fired** across the subdomain (same scheme, `example.com` === `example.com`). |
| 4 | Open a second tab; navigate to `http://bob.github.io:<port>`. Call `vaultFill` with `{ wcId, itemId: <Tenant-cred id> }` (stored for `alice.github.io`). Read the result + the guest DOM. | `vaultFill` returns `{ filled: false, reason: 'origin-mismatch' }` (a normal result, not an error). The form is **unfilled** — `github.io` is a public suffix, so `alice.github.io` and `bob.github.io` have distinct registrable domains: the widen is **refused**. The load-bearing negative. |
| 5 | Open a third tab; navigate to `http://accounts.example.com:<port>`. Call `vaultFill` with `{ wcId, itemId: <Exact-cred id> }` (stored for `app.example.com`, `matchMode: 'exact'`). Read the result + guest DOM. | `vaultFill` returns `{ filled: false, reason: 'origin-mismatch' }`; the form is **unfilled** — an **exact-mode** credential never widens (`app.example.com` ≠ `accounts.example.com`), even though both share `example.com`. The widen is strictly opt-in. |
| 6 | On the tab from step 3 (`accounts.example.com`), call `vaultFill` again with `{ wcId, itemId: <RD-cred id> }` but for a credential whose stored scheme is `https` while the tab is `http` (use a fixture RD-cred variant stored for `https://example.com:<port>`, or note if unavailable). Read the result. | `vaultFill` returns `{ filled: false, reason: 'origin-mismatch' }` — the same-scheme requirement holds even in registrable-domain mode (the MITM guard); an `https` credential does not fill an `http` tab. *(If the https-variant fixture isn't provisioned, mark this row skipped and cover scheme-mismatch in the unit suite.)* |
| 7 | Navigate a tab to a bare-IP or unlisted-suffix host (e.g. `http://127.0.0.1:<port>` directly) that has an RD-cred stored for a different registrable domain; attempt `vaultFill`. Read the result. | `vaultFill` refuses (`origin-mismatch`) — an IP literal / unparseable / unlisted host makes `registrableDomainSafe` return null → the matcher falls back to **exact**, which also does not match → no fill. Fail-closed, observed live. |

## Out of Scope

- **The human picker + the "Subdomain match" badge** — a chrome-sheet/picker surface, MCP-unreachable;
  verified by the F5 HAT manual segment (the operator sees the badge on a widened offer).
- **Capture save-vs-update disposition** (a subdomain submit must NOT rewrite an eTLD+1 item's origin) —
  the capture sheet is MCP-unreachable; the disposition RESULT is unit-tested (`vault-matchmode-fill.test.js`)
  and spot-checked in the HAT manual segment.
- **The PSL parser's rule classes** (`*`/`!`/exception/IDN) — exhaustively unit-tested in `psl.test.js`;
  this test proves only that the live wire uses the matcher and fails closed.

## Variants (optional)

- **Registry-sibling negative**: if `/etc/hosts` aliases for two hosts under a multi-label public suffix
  are available (e.g. `a.co.uk` / `b.co.uk` → 127.0.0.1), repeat step 4 — `co.uk` is a public suffix, so
  the two are refused. Strengthens the "never across a registry sibling" claim beyond the platform-tenant
  case.
- **Exact-cred exact match still works**: navigate to `http://app.example.com:<port>` and `vaultFill` the
  Exact-cred → `{ filled: true }` (the default exact path is unbroken by the opt-in).
