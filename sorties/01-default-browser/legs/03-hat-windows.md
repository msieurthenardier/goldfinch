# Leg: hat-windows

**Status**: completed
**Flight**: [Default Browser](../flight.md)

## Objective

The operator accepts the Windows half of the charter on real Windows: the installed app is listed and selectable as the default browser, links from other apps reach the running (or a cold-launched) Goldfinch in the default jar, hostile arguments open nothing, the settings row hands off to Default apps, and an update keeps the choice.

## Context

- Interactive HAT leg (flight DD6/DD7, residuals in the flight log). Legs 1–2 committed on `sortie/01-default-browser` (`623512b`, draft PR #239).
- WSL can't build or run the NSIS installer; the operator builds it on Windows.
- Fix-vs-feature gate applies to anything the HAT surfaces (FD calls it out loud).

## Acceptance Criteria (verification steps, operator-performed)

- [x] **H0 — Build.** On Windows: check out `sortie/01-default-browser`, `npm ci`, `npm run dist` → `dist\Goldfinch Setup 0.17.2.exe` builds (the NSIS include compiles).
- [x] **H1 — Install ("Only for me") + listing.** Install; Settings → Apps → Default apps lists **Goldfinch**; set it as default for HTTP and HTTPS.
- [x] **H2 — Settings row.** `goldfinch://settings` → Default browser row reads "Choose Goldfinch under Windows Default apps."; the button opens Windows Default apps on Goldfinch's page (the `registeredAppUser=Goldfinch` deep link).
- [x] **H3 — Warm hand-off.** With Goldfinch running, a link opened from another app (`start https://example.com/?hat=3` in cmd, and a clicked link in another app) opens as a new active tab, default jar, in the last-focused window; Task Manager shows one Goldfinch app (no second instance lingering).
- [x] **H4 — Minimized window.** Minimize Goldfinch; `start https://example.com/?hat=4` → the window restores, comes forward, new tab active.
- [x] **H5 — Special characters.** `start "" "https://example.com/?q=a b&x=1"` → one tab whose address keeps the query intact (space encoded, `&x=1` present).
- [x] **H6 — Cold launch.** Quit Goldfinch; `start https://example.com/?hat=6` → Goldfinch launches and shows the URL as the active tab (after restoring the session, if restore is on), no stray home/welcome tab beside it when restore is off.
- [x] **H7 — Hostile argument.** With Goldfinch running: `"<install dir>\Goldfinch.exe" file:///C:/Windows/win.ini` → nothing opens.
- [x] **H8 — Electron's win32 default check.** `reg query HKCU\Software\Classes\http\shell\open\command` → record the result (confirms whether Electron's `isDefaultProtocolClient` could ever report true, i.e. whether DD7's "unknown" status stands).
- [x] **H9 — Update keeps the default.** Re-run the installer over the existing install → Default apps still shows Goldfinch as the HTTP/HTTPS default.
- [x] **H10 — All-users install + uninstall.** Uninstall; install choosing "Anyone who uses this computer" → Goldfinch listed in Default apps; then uninstall → Goldfinch no longer listed.

## Verification Steps

Guided one at a time by the Flight Director; outcomes recorded in the flight log.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.

## Outcome

All H0–H10 passed on `v0.18.0-rc.1`/`rc.2` (operator-performed, 2026-09-29). HAT fixes: H2-a (row separator/legend alignment) and H2-b (button spacing) — look-and-feel, single surface, verified by the operator (rc.2 installer; dev instance for H2-b).
