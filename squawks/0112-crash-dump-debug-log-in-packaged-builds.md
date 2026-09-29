# Squawk 0112: Crash-dump prune debug line prints in packaged builds

**Status**: deferred
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: —

## Report
A cold launch of the installed Windows build from a console prints `[app-lifecycle] pruning crash dumps under C:\Users\<user>\AppData\Roaming\goldfinch\Crashpad` — debug noise in production output that also exposes a local path.

## Evidence
`src/main/app-lifecycle.js:341` — `logger.debug?.('[app-lifecycle] pruning crash dumps under', crashDumpsDir);` with `logger = console` (`:109`), so `debug` always prints. Added M20 F3 L3 ("logged once at debug level so a live run can confirm the resolved root"). Seen in Sortie 01's Windows HAT (H6).

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: cosmetic, no functional impact — revisit at the next squawk turnaround (fix: gate the line on `!app.isPackaged`, or drop it).
