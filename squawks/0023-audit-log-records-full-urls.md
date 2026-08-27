# Squawk 0023: Automation audit log records full URLs including query strings

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

The MCP audit log writes the full URL of `navigate` calls, query string and fragment included, and the log is broadcast to the chrome and settings renderers. A navigation to a magic-link or `?token=` URL therefore persists the secret in the audit record. Strip query and fragment (keep scheme + host + path) before logging.

Source: maintenance report 2026-08-27, finding F10h.

## Evidence

- `src/main/automation/mcp-server.js:104, :106` — audit entry construction
- `src/main/main.js:1035` — audit broadcast to renderers

## Corrective Action

Added `redactUrlForAudit(rawUrl)` in `src/main/automation/mcp-server.js` and routed both `url=`-building sites — the `navigate` and `openTab` cases in `deriveAuditDetail` — through it. The helper only acts on values that look like an absolute URL (contain `://`); a plain non-URL string is returned untouched. For a value that parses via `new URL()`, the *original* string (not a re-serialized one, to avoid normalization surprises like an added trailing slash) is sliced at the earlier of its first `?` or `#`, dropping the query string and fragment and keeping scheme + host + path. A value that looks URL-shaped but fails to parse is fully redacted to `'(redacted)'` rather than logged raw, since an unparsable string could still contain a secret verbatim.

Checked whether audit entries embed tool arguments generically anywhere else: they don't — `deriveAuditDetail` builds each op's `detail` string explicitly per-op from named fields, so `redactUrlForAudit` only needed wiring at the two `url=` sites (now sharing one function, "once, not per tool"). The vault ops' `origin` detail (`vaultFill`/`vaultAnswerAuth`) was checked separately: it is a `scheme://host[:port]` Origin produced by `origin-guard.js`'s Origin discipline, never a full URL, so it structurally carries no query/fragment and was left as-is (documented inline). No other tool records a URL-bearing detail. `src/main/main.js:1035`'s broadcast forwards whatever `detail` the entry already carries, so redacting at construction (not the broadcast) closes the leak at its source — the broadcast shape and audit entry field names are unchanged.

Corrected the one `docs/mcp-automation.md` line that described the `detail` field as `url=https://…` (implying the full URL) to note the query/fragment stripping.

## Verification

`timeout 180 npm test` — 3815/3815 pass, including new/updated tests in `test/unit/automation-mcp-server.test.js`:
- `redactUrlForAudit('https://example.com/reset?token=abc#frag')` → `'https://example.com/reset'` (path only, both query and fragment).
- Query-only and fragment-only variants also cut to path only.
- A URL with neither query nor fragment is returned byte-for-byte unchanged (no added trailing slash / normalization).
- A non-URL string (no `://`) is returned untouched.
- A URL-ish-but-unparsable value (`http://[bad-ipv6`, `https://`) is redacted to `'(redacted)'`.
- `deriveAuditDetail('navigate', …)` / `('openTab', …)` with a `?token=…#frag` URL now redact in the constructed `url=` detail; existing non-query-string cases (incl. `openTab`'s `jar=` suffix) are unchanged.

`npm run lint` — clean. `npm run typecheck` — clean.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
