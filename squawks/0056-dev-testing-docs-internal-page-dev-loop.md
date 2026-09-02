# Squawk 0056: docs/dev-testing.md missing two internal-page dev-loop facts (stale module cache on reload; openTab internal-URL refusal)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Completed**: 2026-09-02
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

Re-verified both facts' supporting contracts in-tree before writing (the
squawk-0055 discipline; the runtime observations themselves are this squawk's
Evidence — three/two independent Developer agents, 2026-09-01):

- `src/renderer/renderer.js:1793-1799` — `createTab` IS on the FD-approved
  evaluate-reachable dogfooding seam (`Object.assign(globalThis, { … createTab
  … })`), so the chrome-target `evaluate` route the note prescribes exists.
- `src/renderer/renderer.js:352` — the chrome's own internal-page open idiom
  is `createTab('goldfinch://settings', null, { trusted: true })`; the note's
  example mirrors it exactly (container `null`, `{ trusted: true }`) rather
  than inventing a variant.
- `docs/mcp-automation.md` `openTab` row (~558) + result-contract row (~43) —
  an `openTab` URL rejected renderer-side returns `null` as a NORMAL result,
  and internal-session/chrome-target access is admin-tier; the note's
  "returns `null`, not an error" and "admin tier" claims match.

New section **Internal-page dev loop** added to `docs/dev-testing.md`
(lines 79-93), between *Attaching a consumer* and *a11y audit* — its own
section, deliberately separate from squawk 0061's *Key capture* bullet so the
two squawks' edits stay attributable. Two bullets, per the Report:

1. Plain reload (both `location.reload()` and the chrome Reload button)
   re-serves the old module from the renderer's memory cache (transferSize 0)
   after editing internal-page JS/CSS; the working loop is close-the-tab and
   reopen (fresh renderer refetches from disk); no app relaunch needed for
   page-side changes.
2. `openTab` refuses `goldfinch://` URLs by design (no trusted flag on the
   automation route; `null` normal result, mechanism deferred to
   `mcp-automation.md`); (re)open internal pages by evaluating the chrome
   target's dogfooding seam — `createTab('goldfinch://vault', null,
   { trusted: true })`, admin tier via `getChromeTarget`.

No other file touched by this squawk besides `docs/dev-testing.md` and this
artifact.

## Verification

- `grep -n -i 'stale\|memory cache\|Close the tab' docs/dev-testing.md` →
  fact 1's bullet present (lines 84-87; the line-42 "stale" hit is squawk
  0061/0055-era key-rotation text, unrelated); `grep -n
  'openTab\|createTab' docs/dev-testing.md` → fact 2's bullet present (lines
  88-93) and these are the file's only openTab/createTab mentions — closing
  this squawk's "no hits / no workflow note" Evidence greps.
- The seam example was copied from the shipped chrome idiom
  (`renderer.js:352`) and the seam-membership of `createTab` confirmed at
  `renderer.js:1799` — not written from session memory.
- `npx prettier --check docs/dev-testing.md` and repo-wide
  `npm run format:check` → "All matched files use Prettier code style!"
- `git diff docs/dev-testing.md` reviewed: exactly two hunks — squawk 0061's
  four-line *Key capture* bullet and this squawk's self-contained
  *Internal-page dev loop* section — each attributable to its own squawk.

## Sign-Off

**Reviewer**: independent batch Reviewer (squawk turnaround 2026-09-02, scoped to the diff)
**Verdict**: confirmed — both dev-loop facts verified against cited code (createTab seam form copied from the chrome's own idiom; openTab null-result contract); self-contained section, attributably separate from 0061's hunk.
**Commit**: `squawk/turnaround-2026-09-02` (via its PR)
