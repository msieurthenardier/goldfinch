# Leg: security-indicator-and-certificate-viewer

**Status**: completed
**Flight**: [TLS Trust — Interstitial, Override, Indicator, Viewer](../flight.md)

## Objective

Give every page its security state in one vocabulary — the address chip
and the site-info popup say "not secure" for plain `http:` and for
overridden certificates and nothing of the kind for a trusted page — and
make any page's certificate inspectable in a read-only viewer card fed by
the main-side summary; land the trusted-fixture apparatus and the a11y
`cert-blocked` state, finalise the behavior spec, and update the docs. The
flight's acceptance run (`tls-trust-surface`, operator present for the
proceed row) and `npm run a11y` exit 0 are this leg's gate.

## Context

- Binding DDs: **DD8** (vocabulary; `data-security`), **DD9** (viewer card;
  `tab-certificate-get`; caps; openers), **DD10** (`site-info` + `cert-viewer`
  become readable; `cert-override` never), **DD11** (controller growth;
  `openCertViewerOverlayForAudit` + `openCertificateViewer` → `SEAM_COUNT`
  37 → 39; CLAUDE.md lockstep), **DD13** (apparatus), **DD14** (second CA;
  `--cert-set trusted`; `import-trust-anchor.mjs`), **DD15** (`--tls-url=`
  audit state), **DD16** (contracts). Spike verdicts: (g) NSS user trust
  anchors ARE honoured (no external-host fallback needed); (i)
  `https://localhost:{T}/` under the untrusted CA reports
  `ERR_CERT_AUTHORITY_INVALID` — the behavior spec's step 14 is rewritten
  to expect that (a fresh override key is still exercised: different host).
- **Flight Director rulings for this leg**: (1) `renderer.js` is at
  1798/1799 — glue is bounded and named: `onViewCertificate` dep on the
  panel controller, the `openCertificateViewer` seam republish line, the
  audit-hook destructure line and its republish line → re-pin to the
  measured count, **≤ 1805**; the debrief carries the four consecutive
  named bumps as a finding. (2) The Witnessed run is executed by the
  Flight Director via `/mission-control:behavior-test tls-trust-surface`
  AFTER the Developer hands back — the Developer's live check covers the
  a11y audit and a smoke of every row's observable, never the Witnessed
  run itself; the leg lands only when the run passes (or the operator
  dispositions a failure). (3) Chip attribute rename `data-secure` →
  `data-security` is a contract change (DD16): the only reader outside the
  chrome CSS is a 2026-07 run log — no spec re-author needed; the
  `tab-keyboard-operability`/`chrome-guest-keyboard-nav` specs read the
  chip by id/label only (verified by grep at planning).
- **Current code (working tree = HEAD `4e4117f` + legs 1–3)**:
  - `src/renderer/chrome/navigation-controller.js:36-76` — `updateAddressChip`
    (`data-state`, `data-secure`, aria-label "…, not secure");
    `src/renderer/styles.css:505-530` — chip rules keyed on `data-secure`
    (green closed lock / red open lock via `::after` transform — shape, not
    colour alone).
  - `src/shared/site-security.js` — `SECURITY_STATES` `:11`,
    `deriveSecurityState` `:51-74` (add the vocabulary helpers here).
  - `src/shared/site-info.js` — `deriveSiteInfo(tab, internal)` returns
    `{ internal:true, note }` or `{ internal:false, host, connection,
    trackers, permissions }`; `connection` is `'HTTPS'|'HTTP'` by scheme.
    `src/renderer/chrome/overlay-menus.js:176-186` — `siteInfoModel` (fixed
    array; gains ONE conditional push).
  - `src/renderer/menu-overlay.js` — `renderPopup` `:498-542` (renders
    `note`/`row`/`action` items generically; `si-*` classes,
    `menu-overlay.css:178-236`); the `cert-override` block landed by leg 3
    (the card template to mirror for `cert-viewer`: `sheet({...})` entry,
    `attachModalCard`, `NODE_OF_ENTRY`, template map, init dispatch,
    `modelShapeOk`).
  - `src/main/register-tab-ipc.js:90-93` — `requireChrome` / `ownsTab`; `:380-390` — `tab-history-snapshot` is `requireChrome`-only (it reads an arbitrary wcId); the `requireChrome` + `ownsTab` shape `tab-certificate-get` needs is the one `tab-navigate` uses (`:951`); `src/preload/chrome-preload.js:243`
    + `renderer-globals.d.ts:351` — `tabHistorySnapshot` (mirror).
  - `src/main/certificate-summary.js:214` — `summarizeCertificate(cert,
    { status, error })` (leg 2; strings only, capped); `entry.certificate`
    stamped at `guest-wiring.js:616` (`did-navigate`), `entry.loadFailure
    .cert.summary` on failures; `entry.security` per DD7.
  - `src/renderer/chrome/site-security-controller.js` (148 lines) —
    `openSiteInfoOverlay`, `openCertOverrideOverlay` `:75`,
    `handleActivation` `:95` (`site-info` → `site-settings`; `cert-override`
    no-op), `handleClosed` `:144`, `bridge`/`findTabByWcId`/`activeTab`/
    `closeOverlayMenu` injected; return `:147`.
  - `src/renderer/chrome/load-failure-controller.js` — Retry + Advanced
    (leg 3, `onAdvanced`); `#load-failure-view-cert` goes between them.
  - `src/renderer/chrome/audit-hooks.js` — seven hooks; `renderer.js`
    destructure `:1437-1444`, republish `:1787-1797`; `SEAM_COUNT = 37`
    (`seam-contract.test.js:93`), `RENDERER_LINE_BUDGET = 1799` (`:233`,
    mirrored in `vault-restore-workflow-invariants.test.js`).
  - `src/main/automation/resolve.js:53` — `AUTOMATABLE_MENU_TYPES`;
    `automation-resolve.test.js:183-191` (the generic admission loop — covers new members automatically; add NAMED cases) and `:212-224` (the `cert-override` negative — keep) plus `sheet-automation-gate-invariant.test.js` — the pins to extend
    (`site-info`, `cert-viewer` admitted for the three read ops;
    `cert-override` still refused).
  - `scripts/a11y-audit.mjs:75-88` — `argValue` argv helpers; `:438` — the
    `load-failure` chrome state (`navigate('http://127.0.0.1:1/')` then
    `runAxe(..., 'load-failure')`); `SHEET_STATES` `:461-…` (records;
    `sheet:cert-override` at `:542`).
  - Fixtures: `tests/behavior/fixtures/web-compat/gen-certs.mjs:47-64`
    (CA + server cert via `openssl`, `server-ext.cnf` SAN `IP:127.0.0.1`);
    `serve-tls.mjs:47-60` (`readCert` of `server-key.pem`/`server.pem`/ `ca.pem`), `:95` (`listen(port, '127.0.0.1')`);
    `import-client-cert.mjs` (the `certutil` precheck/import/remove shape,
    `NSS_DB = sql:$HOME/.pki/nssdb`); `tests/behavior/fixtures/web-compat/README.md`.
  - Docs: `README.md:42-51` (the "until certificate errors get their own
    interstitial" sentence); `CLAUDE.md:238` ("### Overlay-view patterns"),
    `:254-257` (Tab strip: welcome + load-failure bullets — the named
    pattern goes beside Overlay-view patterns), the seam note (37 → 39);
    `docs/mcp-automation.md:369-370` (the sheet-gate paragraph; `:461-467` is leg 2's census prose, already done); `docs/dev-testing.md:95-119`
    (a11y audit section — add `--tls-url=`).
  - Behavior spec `tests/behavior/tls-trust-surface.md` (draft; row notes
    name steps 12 and 14 as this leg's to finalise).

## Inputs

- Legs 1–3 landed (uncommitted). Live rig; `openssl`, `certutil` present;
  the operator available for the Witnessed run's proceed row (the FD
  schedules it).

## Outputs

- `src/shared/site-security.js`: `connectionLabel(state)` → "Secure (HTTPS)"
  / "Not secure (HTTP)" / "Not secure — certificate error overridden
  (HTTPS)" / "" (none) / the internal note; `chipAriaLabel(host, state)` →
  "Site information, {host}" / "…, not secure" / "…, not secure —
  certificate error overridden"; `isNotSecure(state)`.
- `navigation-controller.js` `updateAddressChip`: sets
  `data-security="secure|insecure|overridden|internal|none"` (drops
  `data-secure`), reads `tab.security` when it is a known state, else the
  scheme rule; aria-label via `chipAriaLabel`; `title` likewise.
  `styles.css`: the two rules re-keyed to `[data-security='secure']` /
  `[data-security='insecure'], [data-security='overridden']` (same broken
  lock shape) plus an `overridden`-only strike-through of the `https`
  prefix rendered as a `::before` on the chip's text? — NO: keep the chip
  glyph-only; the distinction is the label/title text (words, not
  colour/shape alone) — DD8.
- `site-info.js`: `deriveSiteInfo(tab, internal)` reads `tab.security` →
  `connection` via `connectionLabel`, plus `showCertificate` (= `security ∈
  {secure, overridden}` OR `tab.loadFailure?.cert`); `siteInfoModel` pushes
  `{ type: 'action', id: 'certificate', label: 'Certificate' }` before
  `site-settings` when true.
- `src/shared/cert-viewer-template.js` (new ESM): `buildCertViewerCard
  (document)` → `{ node (#sheet-cert-viewer), card (role="dialog",
  aria-modal, aria-label "Certificate"), status (#sheet-cert-viewer-status),
  rows container (#sheet-cert-viewer-rows), close (#sheet-cert-viewer-close)
  }`; `applyCertViewerModel(card, summary)` renders, via `textContent`, a
  status line ("Trusted" / "Not trusted — {error}" / "Overridden this
  session — {error}" / "Certificate details unavailable — reload to
  refresh"), then labelled rows: Issued to (CN, O, L/ST/C), Issued by,
  Valid from / until, Subject alternative names (list, "+N more"), Serial,
  SHA-256 fingerprint, SHA-1 fingerprint, Chain (one row per level: subject
  → issuer). Every row `.si-row`-styled; the rows container scrolls
  (`max-height` + `overflow-y: auto`, `menu-overlay.css:90` idiom).
- `menu-overlay.js`: template `'cert-viewer'` (info-style dialog card,
  `dismissible: true`, Close focused on open, Escape/Close/backdrop/blur
  dismiss; no invoke — read-only). `menu-overlay.css` rules.
- `register-tab-ipc.js`: `ipcMain.handle('tab-certificate-get', (event,
  { wcId }) => …)` — `requireChrome` + `ownsTab`; returns `entry.loadFailure?.cert?.summary` (status `untrusted`) when cert-blocked; else — **`entry.certificate` is the OBSERVER's wrapper `{ verificationResult, errorCode, isIssuedByKnownRoot, summary }` (`cert-observer.js:52-79/:112-117`), NOT a summary** (design review, HIGH) — `entry.certificate?.summary ? { ...entry.certificate.summary, status: entry.security === 'overridden' ? 'overridden' : 'trusted', error: entry.security === 'overridden' ? (entry.certOverride?.error ?? summary.error) : undefined } : null` (a wrapper with a `null` summary counts as absent); never a PEM. **Also fix the observer's summary error text at its source**: `cert-observer.js`'s `procFor` passes `error: String(request.errorCode)` (a code like `-202`) — change it to `stripNetPrefix(request.verificationResult)` when the result is not `OK` (`ERR_CERT_AUTHORITY_INVALID`), with a unit pin, so both summary sources speak the same name. Preload `tabCertificateGet({ wcId })` + d.ts.
- `site-security-controller.js`: `openCertificateViewer(tab = activeTab())` (async: `bridge.tabCertificateGet` → model (or the "unavailable" model) → after the await, re-check the tab is still the active one (`activeTab()?.id === tab.id`, else drop — a tab switch mid-fetch must not open a card for an off-screen tab) → `openOverlayMenu('cert-viewer', model, siteInfoAnchor(), 0)`);
  `handleActivation` handles `site-info` → `certificate`; the panel's
  `onViewCertificate` dep calls it. `openCertificateViewer` is
  seam-published (behavior spec step 12; the M16 F2 L1 `openNewTab`
  precedent); `audit-hooks.js` gains `openCertViewerOverlayForAudit()`
  (synthetic summary); `SEAM_COUNT` 37 → 39 (test + CLAUDE.md lockstep);
  `SHEET_STATES` gains `sheet:cert-viewer` (recorded; skipped by ruling);
  `renderer.js` menu-state entry for `cert-viewer` refocus →
  `fixedTriggerMenu(() => els.addressChip)` (the chip is the primary
  trigger; from the panel, refocus lands on the chip — acceptable) — that
  is a fifth glue line; ≤ 1805 stands.
- `load-failure-controller.js`: `#load-failure-view-cert` ("View certificate") between Retry and Advanced, shown for cert failures; click → `onViewCertificate(tab)`. Tab order: heading → Retry → View certificate → Advanced.
- **Census/state staleness fix (design review, HIGH — DD7/DD16 invariant "a failed or cert-blocked tab has `security: none`" was never enforced end to end)**: a tab that loaded securely and then fails keeps its stale `security` because no push fires on failure. Fix at the SOURCE: `guest-wiring.js`'s `did-fail-load` (after the cert fold, before the push) sets `entry.security = SECURITY_STATES.NONE` and sends `tab-security { wcId, security: 'none' }` right after `tab-load-failure`; `did-start-navigation`'s clear leaves `security` alone (the next commit recomputes it). Belt-and-suspenders: `tab-controller.js` `listTabs()` reports `security: t.loadFailure ? 'none' : (t.security ?? 'none')`, and `updateAddressChip`/`deriveSiteInfo` treat a set `tab.loadFailure` as `none`. Unit-pinned in `guest-wiring.test.js`, `tab-controller.test.js`, the chip test; the behavior spec gains a row (after step 11): navigate the trusted, `secure` tab to the untrusted fixture → interstitial, census `security: "none"`, chip label not "secure".
- `resolve.js`: `AUTOMATABLE_MENU_TYPES` = `bookmarks-overflow`,
  `bookmark-edit`, `site-info`, `cert-viewer`; tests extended (admitted for
  `readDom`/`readAxTree`/`captureScreenshot` only; every other op refused;
  `cert-override` refused for all).
- `scripts/a11y-audit.mjs`: `--tls-url=` → after `load-failure`, `navigate
  (tlsUrl)`, wait, `runAxe(..., 'cert-blocked')`; absent → one printed skip
  line. `docs/dev-testing.md` documents it.
- Fixtures: `gen-certs.mjs` → also `trusted-ca.pem`/`trusted-ca-key.pem`
  (subject "Goldfinch Fixture Trusted CA") and `server-trusted.pem`/
  `server-trusted-key.pem` (same SAN); `serve-tls.mjs --cert-set trusted`
  reads the trusted set (default unchanged); new `import-trust-anchor.mjs --import|--remove` (nickname "Goldfinch Fixture Trusted CA", `certutil -A -t "C,,"` — `C` = trusted CA for SSL server certs — / `-D`, the `import-client-cert.mjs` precheck shape, prints the reversal command; `--remove` is idempotent by PRECHECK: `certutil -L -d <db> -n <nick>` non-zero → print "not present" and exit 0, else `-D` and fail hard on any other error); fixtures README updated.
- Behavior spec finalised: step 12 uses `openCertificateViewer()`; step 14
  expects `ERR_CERT_AUTHORITY_INVALID` for `https://localhost:{T}/` (spike
  (i)); status stays `draft` until the FD's run flips it to `active`.
- Docs: README (interstitial, indicator, viewer claims; the stale
  "until…" sentence), CLAUDE.md (a named "Chrome panel in the guest slot"
  pattern beside "Overlay-view patterns": mechanism, the two-axis
  invariant, activation projection order, frozen-contract convention,
  census; a "TLS trust" pattern: answer-at-once, override memory, the
  four-guard proceed, the observer, `security`, the readable sheet
  allowlist; seam note 39), `docs/mcp-automation.md:369-370` (the sheet-gate paragraph naming `AUTOMATABLE_MENU_TYPES`: add `site-info`, `cert-viewer`; `security` already documented by leg 2). **CLAUDE.md in-place edits** (design review): `:280` "seeded `bookmarks-overflow`, `bookmark-edit`" → the four; `:282` the standing unobservable-surfaces list must DROP `site-info` from the unobservable set and ADD `cert-override` (leg 3) to it, and name `cert-viewer` as readable.
- Tests: `site-security.test.js` (+ vocabulary); `site-info.test.js` (or
  the existing site-info test) (+ `connection`/`showCertificate` table);
  `navigation-controller` chip test (`data-security` per state; labels;
  fallback); `cert-viewer-template.test.js` (structure; every field via
  textContent; caps; the unavailable model); `register-tab-ipc.test.js`
  (`tab-certificate-get`: chrome-only, owning-window, the three returns,
  never a `data` field); `site-security-controller.test.js` (`openCertificateViewer` model paths incl. the post-await active-tab re-check; `certificate` action); `cert-observer.test.js` (+ the stripped error name); `tab-controller.test.js` (+ census `none` on failure); NAMED positive-admission tests for `site-info` and `cert-viewer` in `automation-resolve.test.js` beside the generic loop (`:183-191`);
  `load-failure-controller.test.js` (View certificate shown for cert;
  click → dep; tab order); `automation-resolve` + gate-invariant (the
  allowlist growth; `cert-override` still refused); `audit-hooks` (+1);
  `seam-contract` (39; budget); a fixture-generator smoke is NOT unit-tested
  (shells to openssl) — verified live.

## Acceptance Criteria

- [x] **AC1 — one vocabulary.** Unit: for each `SECURITY_STATES` value the
      chip's `data-security`, aria-label, and title, and the popup's
      `connection` row, come from the shared helpers; `insecure` and
      `overridden` both carry "not secure"; `overridden` alone mentions the
      certificate; `secure` mentions neither; internal keeps its note.
- [x] **AC2 — viewer reads real certificates.** Live: on the untrusted
      fixture interstitial, `#load-failure-view-cert` opens `cert-viewer`
      (`sheetVisible: true`) and `readAxTree(sheetWcId)` (now admitted)
      shows subject CN `127.0.0.1`, issuer CN `Goldfinch Fixture Throwaway
      CA`, a SHA-256 fingerprint equal to `openssl x509 -noout -fingerprint
      -sha256 -in certs/server.pem` (colon-hex, case-insensitive compare), a
      two-level chain, status "Not trusted — ERR_CERT_AUTHORITY_INVALID".
      On the trusted fixture (anchor imported before launch) the popup's
      Certificate action / `openCertificateViewer()` shows status "Trusted"
      and the trusted CA's CN; census `security: "secure"`.
- [x] **AC3 — readable, not scriptable.** `site-info` and `cert-viewer` are
      admitted for `readDom`/`readAxTree`/`captureScreenshot` only;
      `evaluate`/`click`/`pressKey`/… on the sheet stay refused for them;
      `cert-override` stays refused for every op (unit + one live refusal
      each).
- [x] **AC4 — no PEM leaves main.** `tab-certificate-get`'s reply never
      contains a `data` field or `-----BEGIN` (unit + a live `evaluate` on
      the chrome calling `window.goldfinch.tabCertificateGet` and
      `JSON.stringify`-scanning the reply).
- [x] **AC5 — a11y exit 0.** Live: `npm run a11y -- --tls-url=https://127.0.0.1:{T}/`
      exits 0 with the `cert-blocked` state audited (the `#load-failure-
      view-cert`/`-advanced` buttons included); `sheet:cert-viewer` recorded.
- [x] **AC6 — fixtures.** `gen-certs.mjs` writes both cert sets;
      `serve-tls.mjs --cert-set trusted` serves the trusted one (`curl
      --cacert certs/trusted-ca.pem` succeeds WITHOUT `-k`);
      `import-trust-anchor.mjs --import` then `--remove` leaves `certutil -L`
      without the nickname; the fixtures README documents all three.
- [x] **AC7 — seam + budget + docs.** `SEAM_COUNT` 39 in test and CLAUDE.md;
      `RENDERER_LINE_BUDGET` re-pinned ≤ 1805 naming the lines; README,
      CLAUDE.md (both new pattern sections), `docs/mcp-automation.md`,
      `docs/dev-testing.md` updated; `tls-trust-surface.md` steps 12/14
      finalised.
- [x] **AC8 — gates.** Four gates green.
- [x] **AC9 — acceptance run (FD-executed, after hand-back) — DISPOSITIONED.** Run `2026-09-16-04-59-20`: 13/16 pass; F1–F3 fixed and re-verified in-run, F4 fixed post-run (HAT verifies), rows 14–15 FAIL on #216 (operator ruling: Known Issue). The `navigation-failure-surface` re-run is folded into the HAT leg (rig time).
      `/mission-control:behavior-test tls-trust-surface` → pass (operator
      row included), run log committed; `navigation-failure-surface` re-run
      → pass (F1 regression net incl. the #216 row). The leg lands only on
      pass or an operator disposition.

## Verification Steps

- AC1/AC3/AC4/AC7: the named unit tests; `grep -n "SEAM_COUNT" CLAUDE.md
  test/unit/seam-contract.test.js`; `grep -rn "data-secure" src/` → empty.
- AC2/AC5/AC6: live per Implementation Guidance step 8; paste the
  a11y summary line, the viewer a11y-tree excerpt, the fingerprint compare,
  and the `certutil -L` before/after into the flight log.
- AC8: the four gates.
- AC9: the run logs under `tests/behavior/tls-trust-surface/runs/` and
  `tests/behavior/navigation-failure-surface/runs/`.

## Implementation Guidance

1. **Vocabulary + chip + popup** (`site-security.js`, `site-info.js`,
   `navigation-controller.js`, `styles.css`, `overlay-menus.js`) with tests.
2. **Viewer**: template + sheet entry + CSS; `tab-certificate-get` (+
   preload/d.ts); `openCertificateViewer` + `certificate` action + panel
   button + audit hook + seam/menu-state lines; `SEAM_COUNT` 39 + CLAUDE.md
   seam note; `SHEET_STATES` record; allowlist growth + tests.
3. **Fixtures**: extend `gen-certs.mjs` (second CA + server cert; keep the
   first set byte-identical in shape), `serve-tls.mjs --cert-set`,
   `import-trust-anchor.mjs`; regenerate certs; fixtures README.
4. **a11y audit** `--tls-url=` state; `docs/dev-testing.md`.
5. **Docs**: README, CLAUDE.md pattern sections, `docs/mcp-automation.md`.
6. **Behavior spec**: finalise steps 12 and 14 (and any row whose
   observable changed name); keep `Status: draft`.
7. **Gates**, Prettier, budget measure + re-pin.
8. **Live check**: import the trusted anchor (`--import`), launch (leg-1
   rules), `serve-tls.mjs --port {T}` + `serve-tls.mjs --port {T2} --cert-set
   trusted`; AC2 both halves; AC3 refusals; AC4 scan; `npm run a11y --
   --tls-url=https://127.0.0.1:{T}/` (with the media fixture served on :8000
   as `docs/dev-testing.md` describes); tear down (kill by port pid; delete
   the key file; `import-trust-anchor.mjs --remove`; verify `certutil -L`).
   Flight-log entry; leg status `landed` (the FD runs AC9 next). No commit.

## Edge Cases

- **Viewer for a tab whose observer entry was evicted / never seen**
  (repeat visit served from the network-service cache with no LRU hit and
  no override): the "unavailable — reload to refresh" model, never a
  throw; popup still offers Certificate (state is `secure`).
- **Viewer while the tab is internal / blank**: the popup offers no
  Certificate action; `openCertificateViewer()` on such a tab opens the
  unavailable model (seam callers) — pin.
- **SAN list of 200 names / chain of 12**: capped at the summary layer
  (leg 2) — the template renders what it gets; pin a long-model render.
- **The chip on a failed tab**: `security: none` → Flight 1's scheme-derived
  state (unchanged); the aria-label must not say "secure" for a
  cert-blocked `https:` address — use the `none` branch, not the scheme
  rule, when `tab.loadFailure` is set.
- **NSS anchor left behind** by a crashed run: `--remove` is idempotent
  (missing nickname → exit 0 with a note); the README says to check
  `certutil -L`.
- **`--tls-url=` given but the fixture is down**: the audit reports the
  state as an apparatus failure (exit 2), not a violation.

## Files Affected

- New: `src/shared/cert-viewer-template.js`,
  `tests/behavior/fixtures/web-compat/import-trust-anchor.mjs`,
  `test/unit/cert-viewer-template.test.js`
- Modified: `src/shared/site-security.js`, `src/shared/site-info.js`, `src/main/cert-observer.js` (error name), `src/main/guest-wiring.js` (`security: none` on failure + push), `src/renderer/chrome/tab-controller.js` (census guard),
  `src/renderer/chrome/navigation-controller.js`, `src/renderer/styles.css`,
  `src/renderer/chrome/overlay-menus.js`, `src/renderer/menu-overlay.js`,
  `src/renderer/menu-overlay.css`, `src/main/register-tab-ipc.js`,
  `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`,
  `src/renderer/chrome/site-security-controller.js`,
  `src/renderer/chrome/load-failure-controller.js`,
  `src/renderer/chrome/audit-hooks.js`, `src/renderer/renderer.js` (≤ 5
  lines), `src/main/automation/resolve.js`, `scripts/a11y-audit.mjs`,
  `tests/behavior/fixtures/web-compat/{gen-certs.mjs,serve-tls.mjs,README.md}`,
  `tests/behavior/tls-trust-surface.md`, `README.md`, `CLAUDE.md`,
  `docs/mcp-automation.md`, `docs/dev-testing.md`
- Tests: as listed in Outputs
- `missions/20-no-silent-failures/flights/02-tls-trust/flight-log.md`

## Citation Audit

2026-09-15, working tree = `4e4117f` + legs 1–3: `navigation-controller.js:36-76`;
`styles.css:505-530`; `site-security.js:11/:51-74`; `overlay-menus.js:176-186`;
`menu-overlay.js:498-542`; `menu-overlay.css:90/:178-236`;
`register-tab-ipc.js:90-93/:380`; `chrome-preload.js:243`;
`renderer-globals.d.ts:351`; `certificate-summary.js:214`;
`guest-wiring.js:616`; `site-security-controller.js:75/:95/:144/:147`;
`renderer.js:1437-1444/:1787-1797` (1799 lines by the test's metric); `seam-contract.test.js:93/:233`;
`resolve.js:53`; `automation-resolve.test.js:218-224`;
`a11y-audit.mjs:75-88/:438/:542`; `gen-certs.mjs:47-64`;
`serve-tls.mjs:47-60/:134`; `README.md:42-51`; `CLAUDE.md:238/:254-257`;
`docs/mcp-automation.md:461-467/:563`; `docs/dev-testing.md:95-119`.
Design review (Developer, 2026-09-15): `serve-tls.mjs:134` → `:95`; `docs/mcp-automation.md` sheet-gate paragraph is `:369-370`; `tab-history-snapshot` is `requireChrome`-only (use `tab-navigate`'s shape); `renderer.js` is 1799 by the test's metric; `automation-resolve.test.js` pins are `:183-191` (generic) / `:212-224` (negative). Re-grep before pinning.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
