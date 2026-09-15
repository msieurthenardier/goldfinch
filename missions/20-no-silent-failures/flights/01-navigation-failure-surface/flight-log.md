# Flight Log: The Failure Surface and Navigation Errors

**Flight**: [flight.md](flight.md)
**Mission**: [No Silent Failures](../../mission.md)

Append-only during execution. Ground truth for what happened.

---

## Reconnaissance Report (planning, 2026-09-15)

Source artifacts: GitHub issue #163 (canonical), the 2026-08-27 maintenance
report's #163 triage row, and the Mission 20 Architect review's flight-1
inputs. Every cited item walked against `main` @ `0fcb100`.

| Item | Classification | Evidence | Recommendation |
|---|---|---|---|
| #163-1 No `did-fail-load` / `did-fail-provisional-load` handling anywhere | confirmed-live | repo-wide grep: zero hits in `src/`; `guest-wiring.js` `wireTabViewEvents` registers `did-start-navigation`, `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `page-favicon-updated`, `did-start/stop-loading`, `did-finish-load`, `dom-ready`, `found-in-page` only (`:451-541`) | leg 1 (DD2) |
| #163-2 Rejected `loadURL` only logs (`register-tab-ipc.js:163`, `:838`) | drifted → confirmed-live | now `src/main/register-tab-ipc.js:185-187` (`tab-create`) and `:895-897` (`tab-navigate`); both `logger.warn` only | leg 1 stamps `lastRequestedUrl` at both sites (DD2); the catch stays diagnostic |
| #163-3 Failed guest lands on `chrome-error://chromewebdata/` with a 39-byte empty document | confirmed-live | corroborated by `squawks/0046-omnibox-bare-ip-forces-https.md:11,19` (in-guest `location.href`, blank capture); Chromium's net-error page is a browser-layer feature Electron does not ship | DD1 — the surface is chrome-owned |
| #163-4 `enumerateTabs` reports the intended URL while the guest is at `chrome-error://` | needs-human-recheck | census rows are renderer-sourced (`tab-controller.js:1172-1180` `listTabs()`), `tab.url` is set from `did-navigate`'s `wc.getURL()` push (`renderer.js:1513`); what `getURL()` returns after the error commit is unmeasured | leg-1 spike (DD4 premise); design is branch-complete either way |
| #163-5 Tab title stays "New tab" on failure | confirmed-live | `.tab-title` is written only by the `tab-title` push (`renderer.js:1568-1578`, `title \|\| tab.url`); no title event fires for an error document | DD6 — host-derived title on failure |
| #163-6 Certificate failures reach the same generic surface until #143 specialises | confirmed-live | no `certificate-error` handler (`app-lifecycle.js` registers `login` `:96` and `select-client-certificate` `:109` only); Electron's default rejects, so the failure arrives as `did-fail-load` `ERR_CERT_AUTHORITY_INVALID` | DD3 `cert` kind; Flight 2 intercepts earlier |
| Maint-08-27 "no `did-fail-load` handling; highest user-visible" | confirmed-live | same as #163-1 | — |
| Architect (M20 review): per-tab failure state must live on the tab's own entry, projected by the surface | confirmed design input | registry entry shape is `{ view, partition, trusted, active }` (`register-tab-ipc.js:154`), no failure field; overlay managers are per-window singletons tracking only the active guest (`find-overlay-manager.js:212-236`) | DD1/DD2 add `loadFailure` + `lastRequestedUrl` to the entry |
| Architect (M20 review): session snapshot / closed-tab capture read live `wc.getURL()` | confirmed-live | `session-snapshot.js:41`, `closed-tab-capture.js:67` | DD4 `effectiveUrl` |

No item is `already-satisfied`; nothing retires. Item #163-4 is the flight's
one empirical premise and is settled by the leg-1 spike (CP1), not assumed.

---

## Leg Progress

*(entries appended as legs execute)*

---

## Flight Director Notes

- **2026-09-15 — flight start.** Phase file `.flightops/agent-crews/leg-execution.md`
  loaded and structurally valid (Crew / Interaction Protocol / Prompts with fenced
  blocks; Developer + Reviewer on Sonnet, Accessibility Reviewer disabled). Flight
  status `ready` → `in-flight`. Branch `flight/01-navigation-failure-surface`
  created from `main` @ `0fcb100`. Planning artifacts (flight spec, this log, the
  `navigation-failure-surface` behavior spec) committed as the branch's baseline
  commit per the M19 F2 / M02 F1 precedent. Legs: 2 autonomous + 1 HAT
  (operator-elected). Code review and commit deferred to flight end per the
  workflow; the HAT leg commits on its own.
