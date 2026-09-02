# Squawk 0056: docs/dev-testing.md missing two internal-page dev-loop facts (stale module cache on reload; openTab internal-URL refusal)

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-01

## Report

Two operational facts about iterating on internal `goldfinch://` pages were
discovered (and re-discovered) during the Mission 18 Flight 1 alignment
session and are documented nowhere. Both cost live-session time and will
bite every future dev loop that touches internal-page code (Mission 18
Flights 2–3 first):

1. **The internal session serves stale cached modules on reload.** After
   editing an internal page's JS/CSS (e.g. `src/renderer/pages/vault.js`),
   both `location.reload()` and the chrome Reload button re-serve the old
   module from memory cache (transferSize 0). The working loop is
   **close the tab and reopen it** — a fresh renderer process refetches
   from disk. No app relaunch needed for page-side changes.
2. **The MCP `openTab` refuses internal `goldfinch://` URLs** (http(s)
   only, returns null/refused — the automation route passes no trusted
   flag). The mechanism is documented in `docs/mcp-automation.md`, but the
   practical consequence — to (re)open an internal page from automation,
   drive the chrome target instead (e.g. evaluate
   `createTab('goldfinch://vault', null, { trusted: true })` on the chrome
   wcId, admin tier) — is not written where a driving agent will look.

Fix: add both facts to `docs/dev-testing.md`'s dev-loop/apparatus notes —
one short subsection or two bullets. Docs only.

## Evidence

- Mission 18 Flight 1 debrief (`missions/18-vault-portability-and-compromise-mode/flights/01-alignment/flight-debrief.md`),
  "Anomalies must land in the log at occurrence" — both facts recovered at
  debrief from session memory; recommendation 3 names this squawk.
- Observed live 2026-09-01 (three separate Developer agents independently
  hit fact 1; two hit fact 2): stale `vault.js` served with transferSize 0
  after edit; fresh code confirmed via cache-busted import and via fresh
  tab; `openTab('goldfinch://vault')` refused, chrome-target `createTab`
  with `{ trusted: true }` succeeded.
- `grep -ri 'stale\|memory cache\|close.*reopen' docs/dev-testing.md` — no
  hits; `grep -n 'openTab' docs/dev-testing.md` — no workflow note.

## Corrective Action

*(recorded at completion)*

## Verification

*(recorded at completion)*

## Sign-Off

*(recorded at completion)*
