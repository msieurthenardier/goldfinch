# Squawk 0019: `jar-data-ipc.js` cookie-shape assumption pinned to Electron 42 was never re-checked after the 43 bump

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

A comment in `jar-data-ipc.js` states the jar-data wipe logic is "contingent on Electron 42's Cookie shape … re-check this assumption on any Electron version bump." Electron 43.2.0 merged on 2026-07-24 (PR #125) and nothing records the re-check. Verify the `Cookie` object shape on Electron 43 (specifically whether a CHIPS/partitioned-cookie field now exists and would need to be included in the wipe) and update the comment either way. If drift is found, escalate — jar isolation depends on it.

Source: maintenance report 2026-08-27, finding F32.

## Evidence

- `src/main/jar-data-ipc.js:324-326` — the self-flagged re-check comment
- `package.json` — `"electron": "^43.2.0"`; `git log --grep 43.2.0` → PR #125, 2026-07-24

## Corrective Action

Verified the `Cookie` shape assumption against Electron 43.2.0, the version installed at `node_modules/electron`'s `electron.d.ts` when this check was run (`package.json` pins the exact version `43.4.1` as of squawk 0037, landed in this same batch — the re-check instruction added to the code comment below covers resyncing this verification when the installed version moves again). The wipe/identity logic in `src/main/jar-data-ipc.js` (`handleCookiesRemove`, `handleCookiesValue`) depends on `{name, domain, path}` being a unique identity tuple per cookie within a jar's partition — it does not depend on any other `Cookie` field. The comment at `jar-data-ipc.js:319-326` (formerly pinned to "Electron 42's `Cookie` shape") flags that this uniqueness assumption would break if Electron added a CHIPS/partitioned-cookie field (e.g. `partitionKey`) to `Cookie`, since two cookies with the same `{name, domain, path}` but different partition keys would then collide under the tuple match.

No such field exists on Electron 43.2.0 — the assumption holds unchanged from 42. Updated the comment to record the re-check date and result, and to drop the version-42-specific pinning language (now states the general dependency and cites the verification date/squawk instead of hardcoding "42"). No logic change — comment-only, plus this squawk artifact.

## Verification

Checked `node_modules/electron/electron.d.ts` (Electron 43.2.0, confirmed via `require('./node_modules/electron/package.json').version` → `43.2.0`):

- `interface Cookie` (electron.d.ts:7193-7239) — full field list: `domain?`, `expirationDate?`, `hostOnly?`, `httpOnly?`, `name`, `path?`, `sameSite`, `secure?`, `session?`, `value`. No `partitionKey`, `partitioned`, or any CHIPS-related field present.
- `interface CookiesGetFilter` (electron.d.ts:21042-21068) and `interface CookiesSetDetails` (electron.d.ts:21074-21111) — same absence; no partition-key filter/set field either.
- `Cookies.remove(url: string, name: string): Promise<void>` (electron.d.ts:7340) — signature unchanged, still keyed only on URL + name (no partition argument).

Conclusion: the `{name, domain, path}` uniqueness assumption still holds on Electron 43.2.0. No drift found; no escalation needed.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round; one non-blocking wording correction applied in the batch fix cycle; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
