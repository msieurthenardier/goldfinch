# Squawk 0111: Restored background tabs report `loadState: ok` before they have loaded

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: —

## Report
With "Restore session on startup" on, two tabs whose local server was down (`loadState: failed`, ERR_NETWORK_CHANGED, before the quit) came back after a clean quit + relaunch reporting `loadState: ok` in the automation census, with strip title "New tab". Reproduce: open a tab to an unreachable `http://127.0.0.1:<port>/…` (load fails), quit via `appQuit()`, relaunch, `enumerateTabs`.

## Evidence
`src/main/automation/tabs.js:61` — `loadState: t.loadState || LOAD_STATES.OK`: a tab with no recorded state is reported `ok`, so a restored background tab that hasn't navigated yet (title "New tab") is indistinguishable from a loaded one. Observed in `tests/behavior/default-browser-handoff/runs/2026-09-29-21-01-11.md` (checkpoint 7, Validator notes).

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: pre-existing, outside Sortie 01's charter; needs a one-read-pass check of whether restored background tabs load lazily (then the census default is the bug) or never load (a restore bug) — revisit the next time session restore or the automation census's `loadState` is touched.
