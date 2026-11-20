# Squawk 0220: Welcome surface still relies on the `{search}/{home}` override instead of a synchronous local cache write

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
Carried since Mission 16 (maintenance 2026-08-27, three cycles). After `chrome-welcome-set`, the chrome waits for the `settings-changed` broadcast, so `welcome-controller.js` passes `{ search }` / `{ home }` overrides to `settle()` to bridge the gap ("the broadcast may not have landed yet"). The planned fix: write the renderer's local cache synchronously on a successful set, then retire the override. Routine maintenance 2026-11-18 asked for it to become one squawk rather than be carried again.

## Evidence
- `src/main/register-settings-ipc.js` — `chrome-welcome-set` persists and broadcasts only.
- `src/renderer/chrome/welcome-controller.js` — `opts.search` / `opts.home` override, used at the settle call sites; comment about the broadcast not having landed.

## Corrective Action
`welcome-controller.js` now takes `setHomePage` / `setSearchEngine` (the existing raw cache setters) and `submitHome` / `submitEngine` call them synchronously after a reply with `ok`, then `settle(tab)` with no override. `render(tab)` and `settle(tab)` lost their `opts` parameter and read `currentHomePage()` / `currentSearchEngine()` only. `submitEngine`'s own pending-query attach branch is gone: `settle()` already attaches when a query and an engine are both known, so it does the same thing from the freshly written cache. A failed set returns before any cache write. Main is unchanged: `chrome-welcome-set` replies `{ ok: true }` only after `settings.set` accepted the value, so the sent value is the persisted one. `renderer.js`: new `const setHomePage` (replacing the inline arrow handed to the window controller, now passed by name) and two new deps lines to the welcome controller, offset by condensing two comment lines; file length is unchanged (budget test green).

## Verification
Welcome-controller unit tests: setting the home page / engine then settling uses the cache without an override; the override parameter is gone; the existing welcome behaviour tests stay green.

Ran: new `test/unit/welcome-set-cache-write.test.js` (8 behavioural tests on the real controller with a fake DOM: success writes cache and renders/settles from it for home, clear-to-null and engine; failure leaves the cache; same-value broadcast harmless; override absent). Re-targeted the two override pins in `test/unit/search-engines.test.js`. Neuter-verified: deleting `setHomePage(value)` fails 4 tests, deleting `setSearchEngine(id)` fails 2. `node --test` on the four welcome/seam files: 89 pass. `npm test`: 7479 tests, 7474 pass, 0 fail (rest skipped). `npm run lint`, `npm run typecheck`, `npm run format:check`: clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eleventh 2026-11-19 turnaround)
**Verdict**: confirmed. A failed set writes nothing; dropping `submitEngine`'s own attach branch keeps behaviour (`settle()` attaches from the fresh cache). One low note, accepted: `renderer.js` stays at its line budget by naming the shared `setHomePage` setter (a real de-duplication: two controllers use it) and shortening one comment. Neuter: removing `setHomePage(value)` fails five tests. Live check inconclusive: the engine block and its status line render only on a welcome tab opened for a search, and the plain new tab used did not show them; the write itself persisted (`searchEngine` read back). The end state was the same before the fix, so unit tests are the evidence. Gates at review: `npm test` 7,485 tests (7,480 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-k`
