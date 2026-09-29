# Squawk 0112: Crash-dump prune debug line prints in packaged builds

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report
A cold launch of the installed Windows build from a console prints `[app-lifecycle] pruning crash dumps under C:\Users\<user>\AppData\Roaming\goldfinch\Crashpad` — debug noise in production output that also exposes a local path.

## Evidence
`src/main/app-lifecycle.js:341` — `logger.debug?.('[app-lifecycle] pruning crash dumps under', crashDumpsDir);` with `logger = console` (`:109`), so `debug` always prints. Added M20 F3 L3 ("logged once at debug level so a live run can confirm the resolved root"). Seen in Sortie 01's Windows HAT (H6).

## Corrective Action
`src/main/app-lifecycle.js`: the `logger.debug?.('[app-lifecycle] pruning crash dumps under', ...)` line is now wrapped in `if (!app.isPackaged)`. Dev/unpackaged runs keep the confirmation line (its M20 F3 L3 purpose); packaged builds no longer print the local profile path. `pruneCrashDumps` still runs unconditionally. Chosen over dropping the line because dev-run confirmation of the resolved dump root is still useful. No other logging changed. Test added in `test/unit/app-lifecycle.test.js` (harness logger gained a `debug` capture): unpackaged logs the line with `/profile/crashDumps`, packaged logs nothing and still prunes. No existing test pinned the log line.

## Verification
- `node --test --test-timeout=60000 test/unit/app-lifecycle.test.js` — 41 pass, 0 fail
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run format:check` — all files formatted (after `npm run format`)

## Sign-Off
**Reviewer**: independent Reviewer agent (batch review scoped to the diff; `npm test` 5749 pass / 0 fail, lint, typecheck, format:check clean)
**Verdict**: confirmed
**Commit**: the `squawk: turnaround 2026-09-29` commit on `squawk/turnaround-2026-09-29-2`

## Disposition
*(Deferred at logging during Sortie 01; completed in the same-day turnaround.)*