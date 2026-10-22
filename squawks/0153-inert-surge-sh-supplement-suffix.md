# Squawk 0153: `surge.sh` in `SUPPLEMENT_SUFFIX` is redundant now that the PSL lists it natively

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: 2026-10-22

## Report
Squawk 0152 refreshed the vendored PSL to snapshot 2026-10-20. That snapshot adds a PRIVATE-section `surge.sh` rule. The PSL now gives the correct tenant split for `*.surge.sh` on its own, so the `surge.sh` entry in `SUPPLEMENT_SUFFIX` never fires (its `safe === suffix` guard is never true). It is dead config, and the comment justifying the set is now stale: it says "Checked 2026-08-27 … snapshot 2026-07-20" and that all four entries are absent from the `.dat`.

Behavior is unchanged, so this is cleanup:
- drop `surge.sh` from the set;
- re-date the comment against the 2026-10-20 snapshot;
- move the `surge.sh` cases in the unit test from "supplement" to "PSL resolves natively". Keep asserting that a tenant label survives.

## Evidence
- `src/main/public_suffix_list.dat` — `// Surge : https://surge.sh` followed by the rule `surge.sh` (PRIVATE section, new in VERSION `2026-10-20_08-40-56_UTC`).
- `src/main/trackers.js` — `const SUPPLEMENT_SUFFIX = new Set(['amazonaws.com', 'netlify.com', 'surge.sh', 'glitch.me']);`, and the comment above it ("Checked 2026-08-27 against the vendored public_suffix_list.dat (snapshot 2026-07-20)"). The CAUGHT IN REVIEW block names the same four entries.
- `test/unit/trackers.test.js` — the supplement loop `for (const suffix of ['amazonaws.com', 'netlify.com', 'surge.sh', 'glitch.me'])` and `assert.equal(registrableDomain('surge.sh'), 'surge.sh');`.
- The squawk 0152 review's old-vs-new sweep: `a.surge.sh` resolves to `a.surge.sh` under both snapshots (0 differences). `amazonaws.com`, `netlify.com` and `glitch.me` still have no bare rule, so they still need the supplement.

## Corrective Action
- `src/main/trackers.js`: removed `'surge.sh'` from `SUPPLEMENT_SUFFIX`; re-dated the set's comment to 2026-10-22 / snapshot 2026-10-20 and noted the drop as the "PSL wins" case; added one sentence to the CAUGHT IN REVIEW block pointing at this squawk.
- `test/unit/trackers.test.js`: the supplement loop and bare-suffix case now cover only `amazonaws.com`, `netlify.com`, `glitch.me`; new test asserts `surge.sh` tenants resolve natively (`tenant-a.surge.sh`, distinct from `tenant-b.surge.sh`, deep host collapses to the tenant, bare `surge.sh` unchanged). No drift pin: `SUPPLEMENT_SUFFIX` is not exported and no export was added just for a test.

## Verification
- With the entry present and with it removed, `registrableDomain('tenant.surge.sh') === 'tenant.surge.sh'` and `registrableDomain('surge.sh') === 'surge.sh'`.
- With the whole supplement emptied (scratch copy), `t.amazonaws.com`, `t.netlify.com`, `t.glitch.me` collapse to the bare suffix, so those three still need it.
- `npm test`: 5978 tests, 5974 pass, 0 fail (rest skipped); `npm run typecheck`, `npm run lint`, `npm run format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking issues.
- Re-verified: `registrableDomain('tenant.surge.sh')` is `'tenant.surge.sh'` with the entry gone, and the native rule is at `public_suffix_list.dat:16080`.
- amazonaws.com, netlify.com and glitch.me still have no bare PSL rule, so they still need the supplement.
- Comments are accurate and in the file's style; the tests assert tenant distinctness, deep-host collapse and the bare suffix.
- Behavior is unchanged for every host. Gates: `npm test` 5978 (5974 pass, 0 fail, 4 todo); typecheck, lint and format:check clean.

**Commit**: the `squawk: turnaround 2026-10-22 (2)` commit on `squawk/turnaround-2026-10-22-2`
