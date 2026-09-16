# Flight Log: TLS Trust — Interstitial, Override, Indicator, Viewer

**Flight**: [TLS Trust — Interstitial, Override, Indicator, Viewer](flight.md)

## Summary

Planning (2026-09-15). No legs executed yet.

---

## Reconnaissance Report

Source artifacts walked against the working tree at `de988e9`
(`flight/01-navigation-failure-surface`, PR #215 ready for review): the
Flight 1 debrief's Action Items, the mission's Known Issues and Flight-2
Open Questions, issue #143, and the squawks the debrief routed to this
flight.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| #143 item 1 — bad-certificate navigation: no interstitial, no override | confirmed-live | `grep -rn "certificate-error" src/` → no handler; only the M14 `select-client-certificate` registration in `app-lifecycle.js:109`. F1 leaves cert failures on the generic panel via `load-failure.js`'s `cert` kind (`classifyLoadFailure`, `ERR_CERT_*` → `cert`) | In scope — the flight's core |
| #143 item 2 — no certificate viewer | confirmed-live | no `Certificate`/`X509` reads anywhere in `src/`; `site-info.js`'s `deriveSiteInfo` returns only `connection: 'HTTPS'|'HTTP'` | In scope |
| #143 item 3 — cert-less continuation calibration note | already-satisfied (no action by the issue's own wording) | — | Not work; cite in the spec so it isn't re-triaged |
| Mission criterion 4 — "not secure" for `http:` | partially-satisfied | `navigation-controller.js` `updateAddressChip`: `data-secure="false"` + "not secure" aria-label for non-`https:` web URLs; `styles.css:518` strikethrough rule; site-info popup shows `HTTP`. Missing: the overridden-certificate state and one vocabulary across chip + popup | Scope down to the delta the mission already names |
| Mission OQ — trusted-page certificate source | confirmed-live (design) | no `setCertificateVerifyProc` call in `src/` (`session-runtime.js` `onSessionCreated` attaches shields/downloads/spellcheck/cookie listener only); Electron 44 d.ts: `Request { hostname, certificate, validatedCertificate, isIssuedByKnownRoot, verificationResult, errorCode }`, `callback(-3)` = defer to Chromium's verdict | Decide at DD (verify-proc observer vs. event-only) |
| Mission OQ — per-origin certificate cache bounds | confirmed-live (design) | no cache exists | Decide at DD |
| Mission OQ — "not secure" mixed-state machine | confirmed-live (design) | chip/popup derive from the committed `tab.url` scheme only | Decide at DD (top-frame unit, per mission) |
| #216 — failed typed navigation strands keyboard focus | confirmed-live | issue OPEN; the F1 reassert in `guest-wiring.js:622` (`did-fail-load`) and the `did-finish-load` twin are in the branch and did not change the observed behavior (debrief: "speculative code that did not fix the defect"); no main-side focus/blur trace has been run | Diagnose FIRST (spike) — the interstitial is a keyboard-reachable security decision on the same hidden-guest surface |
| Debrief — guest-slot surface projection extraction | confirmed-live | `src/renderer/renderer.js` = 1857 lines / `RENDERER_LINE_BUDGET` 1858 (`seam-contract.test.js`), zero headroom; the four wrapper functions `showWelcomePanel`/`hideWelcomePanel`/`showLoadFailurePanel`/`hideLoadFailurePanel` at `renderer.js:214-225` plus the site-info glue (`siteInfoModel` `:331`, `openSiteInfoOverlay` `:781`, chip listeners `:927-928`, the `'site-info'` dispatch case `:981`) are the extraction candidates this flight's glue will otherwise have to squeeze past | Mandatory for this flight (any chrome glue needs lines); pick the seam at DD |
| Squawk 0074 — a11y gate red on `#bookmarks-bar` `region` | confirmed-live | `squawks/0074-*.md` status `deferred`, trigger "before Mission 20 Flight 2 audits its interstitial states"; `grep bookmarks-bar scripts/a11y-audit.mjs` → nothing | Prerequisite: complete via a squawk turnaround before leg 2's a11y gate (a green gate is the only honest AC) |
| Squawk 0075 — `captureWindow` paints a hidden guest | confirmed-live, out of scope | `main.js` `grabWindow` unchanged; trigger is Flight 3's run | Carry: this flight's spec uses `captureScreenshot(chromeWcId)` as the rendered observable, as F1's run did |
| Squawk 0076 — crew protocol: false `hasFocus()` = escalation | confirmed-live (open), crew-file work | `.flightops/agent-crews/behavior-tests-execution.md` carries the apparatus note but not the escalation rule | Complete before this flight's Witnessed run (turnaround) — not flight code |
| Squawk 0077 — shared fake-DOM test harness | confirmed-live (open) | `FakeClassList`/`FakeElement` duplicated in `test/unit/tab-controller.test.js:10/:31` and `load-failure-controller.test.js:18/:39`; this flight adds at least one more chrome-controller test | Either a turnaround before the flight or absorbed by the extraction leg (same files) — operator's call |
| Debrief — name the guest-slot panel pattern in CLAUDE.md | confirmed-live | CLAUDE.md § Tab strip has two per-surface bullets (welcome, load-failure) and no named pattern beside "Overlay-view patterns" | Fold into the docs step of the leg that lands the third surface |
| Debrief — F3 double `GET` on Retry (unconfirmed) | needs-human-recheck | not reproduced in isolation | Re-check at this flight's Witnessed run (the interstitial's proceed path re-requests the origin) |

Retirements proposed: none (the only `already-satisfied` row is #143's own
no-action note). Partial scope: mission criterion 4 narrows to the
overridden-certificate state + shared vocabulary, as the mission itself
words it.

---

## Leg Progress

*(none yet)*

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### 2026-09-15 — planning

- Flight planning opened via `/mission-control:flight 2` on the Flight 1
  branch (PR #215 ready for review, not yet merged). Reconnaissance above.
- Operator rulings at the crew interview: small HAT leg (yes); squawk 0077
  absorbed by leg 1; squawks 0074 + 0076 completed as a turnaround before
  the flight (prerequisite); census gains a `security` field.
- Architect design review (Sonnet): approve with changes — one high (the
  proceed invoke needs the `current.menuType` third guard, the
  `bookmarks-overflow` precedent, not `bookmark-edit-submit`), two medium
  (verify-proc install must precede `onSessionCreated`'s Burner-skipping
  early return; `siteInfoModel` gains a conditional row — "unchanged in
  shape" was wrong), two low (seam count slip; mission one-liner described
  the rejected held-callback model). All folded in; the proceed card and
  invoke split into their own leg (`override-card-and-proceed`) on the
  Architect's suggestion. Citation audit: clean.
- Operator approved the spec (2026-09-15); PR #215 merged. Flight set `ready`.
  Planning artifacts committed on `main`; the flight branch is cut after the
  squawk turnaround (0074 + 0076).

### 2026-09-15 — turnaround + flight start

- Operator ruling: the squawk turnaround (0074 + 0076) and the flight share
  ONE branch, `flight/02-tls-trust` (cut from `main` at `24ba791`), instead
  of the ARTIFACTS.md squawk-branch scheme — a deviation of convenience;
  the squawk commit keeps its own `squawk: turnaround 2026-09-15` subject
  and `Squawks:` trailer so the record stays separable.
