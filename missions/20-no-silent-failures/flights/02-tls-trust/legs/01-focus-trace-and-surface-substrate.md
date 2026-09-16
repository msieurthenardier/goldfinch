# Leg: focus-trace-and-surface-substrate

**Status**: completed
**Flight**: [TLS Trust — Interstitial, Override, Indicator, Viewer](../flight.md)

## Objective

Settle the flight's empirical premises on the live rig (the #216 focus trace
and the Electron certificate/NSS premises (a)–(i)), fix #216 per the finding,
and clear the chrome composition root's zero-headroom problem by extracting
the audit-hook family and seeding the site-security controller — plus the
shared fake-DOM test harness (squawk 0077) — so legs 2–4 build on a
substrate that already has room, tests, and a trace-backed focus model.

## Context

- Flight DDs that bind this leg: **DD11** (extraction plan, budgets, seam
  count untouched by the move), **DD12** (#216 hypotheses H1–H3 and fix
  shapes), the spike list in **Prerequisites** (a)–(i), **DD14** (NSS trust
  anchor premise (g)). Nothing in this leg adds product behaviour except the
  #216 fix; every other change is a behaviour-preserving move.
- **Flight Director rulings**: this leg's spike instrumentation is
  TEMPORARY — logging added to main for the trace is removed before handoff
  (grep-AC below); findings live in the flight log, not in code. The #216
  fix shape is chosen by the trace, not assumed (DD12). If the theft is not
  app-addressable, record that, keep #216 open with the trace attached, and
  land the rest of the leg (flight Adaptation Criteria).
- **Rig facts (carry-forward from Flight 1, mandatory)**:
  - Launch: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
    npm run dev:automation` (redirect stdout to a scratch log). Capture the
    admin key from the single `AUTOMATION_DEV_MINT {...}` stdout line into a
    `chmod 600` file under the session scratchpad, load it ONLY through an
    env var (`GOLDFINCH_MCP_ADMIN_KEY`) into
    `scripts/lib/mcp-client.mjs`'s `connectAutomation` / `callTool`
    (`callTool` returns `{ value, isError }`; `evaluate` takes
    `{ wcId, expression }`). NEVER print, paste, or commit a key; delete the
    file at teardown. NEVER use any session-registered `mcp__goldfinch*` /
    `mcp__chrome-devtools*` tool — drive only through the attach client.
  - Kill the dev app by the pid holding `:49707` (`ss -ltnp`), never by a
    `pgrep -f` pattern (it matches the calling shell and kills it).
  - WSL2 mirrored networking: `127.0.0.1` never refuses an unbound port; use
    `127.0.0.2` for a refusing address (`curl -m 3` precheck: "Connection
    refused" at once). Port 1 → `ERR_UNSAFE_PORT`, not refused.
  - Ozone backend is wayland (`scripts/dev-launch.mjs`); `captureWindow`
    paints the hidden guest over chrome panels (squawk 0075) — use
    `captureScreenshot(chromeWcId)` / `readAxTree` if a rendered read is
    needed (this leg needs none).
  - TLS fixture: `node tests/behavior/fixtures/web-compat/gen-certs.mjs` then
    `node tests/behavior/fixtures/web-compat/serve-tls.mjs --port {T}`
    (throwaway CA; `ERR_CERT_AUTHORITY_INVALID` when the app runs WITHOUT
    `--insecure-tls-fixtures`). The cert's SAN is `IP:127.0.0.1` only.
  - Typed navigation under automation: `evaluate` on the chrome sets and
    focuses `#address`, then a real `pressKey(chromeWcId, 'Enter')` — the
    `pendingFocusGuest` path (`navigation-controller.js:186-217`) is armed by
    the Enter keydown listener, which the bare `navigate()` global bypasses.
- **Current code the leg touches** (verified 2026-09-15, HEAD `4e4117f`):
  - `src/renderer/renderer.js` — 1857 lines vs `RENDERER_LINE_BUDGET = 1858`
    (`test/unit/seam-contract.test.js:200`, metric `split(/\r?\n/).length`).
    Audit-hook family: `openAuthBasicOverlayForAudit` (`:789-790`),
    `openCertPickerOverlayForAudit` (`:795-800`),
    `openBookmarkEditOverlayForAudit` (`:843-844`), `openBookmarksOverflowOverlayForAudit` (`:853-854`; the comment block `:855-866` belongs to the unrelated `openPageContextOverlaySheet` and stays), `openPageContextMenuForAudit` (`:1390-1407`), `openTabContextMenuForAudit` (`:1497-1517`). Extract by FUNCTION BOUNDARY, never by line slice. Vault hooks already live in
    `vault-controller.js` (`:424-433` destructure) and downloads hooks in
    `downloads-controller.js` (`:402`) — those stay. Seam tail:
    `Object.assign(globalThis, {…})` at `:1816`; the seam is republished BY
    NAME, so moving an implementation and binding it to the same local name
    leaves `SEAM_COUNT` (36, `seam-contract.test.js:88`) and the a11y audit
    (`scripts/a11y-audit.mjs` `SHEET_STATES` `open:` strings) untouched.
  - Site-info glue in `renderer.js`: `siteInfoAnchor` (`:700`),
    `openSiteInfoOverlay` (`:781`), the chip `click`/`keydown` listeners
    (`:927-933`), the `'site-info'` case in `dispatchOverlayActivation`
    (`:981-984`), the `'site-info': fixedTriggerMenu(() => els.addressChip)`
    entry in the menu-state table (`:440`). `siteInfoModel` itself lives in
    `overlay-menus.js:176-186` (unchanged).
  - `src/renderer/chrome/navigation-controller.js:186-217` —
    `pendingFocusGuest` one-shot; `src/main/register-tab-ipc.js:924-948` —
    `tab-navigate` handler (`loadURL` branch stamps `lastRequestedUrl` then
    `wc.loadURL`); `src/main/guest-wiring.js:495-529` — `did-fail-load`
    (with the F1 speculative reasserts at `:526` inside `did-fail-load` and `:611-624` inside `did-finish-load`, block `:602-626`); `src/main/register-tab-ipc.js:19-22` —
    `applyGuestVisibility`.
  - Fake-DOM duplication: `test/unit/tab-controller.test.js:10` /`:31`
    (`FakeClassList` / `FakeElement`) and
    `test/unit/load-failure-controller.test.js:18` / `:39`. Test helpers live
    in `test/unit/helpers/` (`jars-page-dom.js` is the DOM-shaped precedent,
    imported as `require('./helpers/jars-page-dom')`).
  - `squawks/0077-shared-fake-dom-test-harness.md` — open; completed by this
    leg (status, Corrective Action, Verification; Sign-Off = the flight-end
    Reviewer, written at the flight commit).

## Inputs

- Branch `flight/02-tls-trust` at `4e4117f` (planning artifacts + the
  0074/0076 turnaround committed); working tree clean.
- Live rig available (WSLg); `openssl`, `certutil` present; fixture certs
  regenerable.

## Outputs

- Flight log: a **Leg 1 spike** section with one row per premise (a)–(i)
  (method, observation, verdict, consequence for DD1/DD6/DD7/DD12/DD14),
  the #216 trace excerpt (timestamps, which view fired `focus`/`blur`, the
  chosen hypothesis), and the leg progress entry.
- `src/renderer/chrome/audit-hooks.js` (new): `createAuditHooks({
  openOverlayMenu, els, ... })` returning the six moved hooks, bound in
  `renderer.js` to their existing names.
- `src/renderer/chrome/site-security-controller.js` (new, seed):
  `createSiteSecurityController(deps)` owning the chip trigger listeners,
  `siteInfoAnchor`, `openSiteInfoOverlay`, and `handleActivation(payload)` for `'site-info'` (returns `true` when it consumed the activation) and `handleClosed({ menuType, reason })`, chained in `renderer.js` exactly as the vault/downloads controllers are: `handleActivation` joins the short-circuit chain in the `onActivated` callback passed to `createOverlayMenus` (`renderer.js:521-523` — `if (!downloadsController.handleActivation(payload) && !vaultController.handleActivation(payload)) dispatchOverlayActivation(payload);` gains `&& !siteSecurityController.handleActivation(payload)`), NOT inside `dispatchOverlayActivation`; `handleClosed` is called from `handleOverlayClosed` (`renderer.js:1258-1277`) beside `vaultController.handleClosed(...)` at `:1276` (a no-op for now — it is the seat legs 3–4 use for the card's navigation-away close). `openSiteInfoOverlay` stays seam-published under the same name.
- The #216 fix (shape per finding) in main, with its unit pin; the F1
  speculative `did-finish-load` reassert removed if the trace shows it dead.
- `test/unit/helpers/fake-dom.js` (new): `FakeClassList`, `FakeElement`, and
  a `createFakeDocument()` factory; `tab-controller.test.js` and
  `load-failure-controller.test.js` import it (their local copies deleted).
- `test/unit/seam-contract.test.js`: `RENDERER_LINE_BUDGET` lowered to the
  measured post-extraction count (Prettier-formatted), with the standard
  justification comment; `SEAM_COUNT` unchanged at 36.
- New tests: `audit-hooks.test.js` (each hook opens the expected menuType
  with its synthetic model), `site-security-controller.test.js` (chip
  click/keys open site-info; `handleActivation` consumes `site-settings`
  and ignores foreign menuTypes), the #216 pin.
- `squawks/0077-*.md` completed (minus Sign-Off).

## Acceptance Criteria

- [x] **AC1 — spike logged.** The flight log carries the Leg 1 spike table
      with a verdict for each of (a)–(i) (Prerequisites in `flight.md`), each
      backed by an observation from the live rig (log lines, event order,
      timings), and a one-line consequence per affected DD. "Could not
      observe" is a legal verdict only with the method and the failure
      recorded.
- [x] **AC2 — #216 traced.** The log carries the focus trace for a typed
      FAILING navigation (`http://127.0.0.2:{Q}/`) and a typed SUCCEEDING one
      (a local fixture page), naming the view that gains focus and the
      event that moves it, and the hypothesis (H1/H2/H3 or "other") it
      supports.
- [x] **AC3 — #216 fixed (dispositioned: fixed + unit-pinned; the live
      ≥ 500 ms `isFocused()` metric is unmeasurable under this automation rig
      — see the flight log's Leg 1 spike section, "rig limitation, confirmed
      empirically").** After the fix, the trace for
      the typed failing navigation ends with the CHROME webContents focused
      (`isFocused()` true at ≥ 500 ms after `did-fail-load`) and no guest
      `focus` event after `did-fail-load`; the typed succeeding navigation
      still ends with the GUEST focused (the M17 F1 `pendingFocusGuest`
      contract). Unit-pinned on the `FakeContents` harness. If not
      app-addressable: the log says so with the trace, #216 stays open, and
      this AC is checked as "dispositioned" with the operator informed at
      the flight-end summary.
- [x] **AC4 — no instrumentation left.** `grep -rn "spike\|TRACE\|focus-trace"
      src/` returns nothing new versus `4e4117f` (the trace logging is gone).
- [x] **AC5 — audit hooks extracted.** The six hooks listed in Context live
      in `src/renderer/chrome/audit-hooks.js`; `renderer.js` binds them to
      the SAME names; `SEAM_COUNT` stays 36 and `seam-contract.test.js`'s
      seam-identifier test passes unchanged; `scripts/a11y-audit.mjs` is
      untouched.
- [x] **AC6 — site-security controller seeded.** Chip click and
      Enter/Space/ArrowDown/ArrowUp open the site-info popup exactly as
      before (same `overlayTriggerClick` suppress-window path for click); the
      `site-settings` activation still routes to `openSiteSettingsTab`;
      `renderer.js` no longer contains the chip listeners or the
      `'site-info'` dispatch case.
- [x] **AC7 — budget re-pinned.** `RENDERER_LINE_BUDGET` equals the measured
      Prettier-formatted line count of `renderer.js` after this leg (expected
      ≤ 1770; the number is measured, not estimated) and the test passes.
- [x] **AC8 — shared fake DOM.** `test/unit/helpers/fake-dom.js` exists;
      `tab-controller.test.js` and `load-failure-controller.test.js` import
      it and define no local `FakeClassList`/`FakeElement`; squawk 0077's
      status is `completed` with Corrective Action + Verification filled.
- [x] **AC9 — gates.** `npm test` (with a timeout flag), `npm run lint`,
      `npm run typecheck`, `npm run format:check` all green; test count ≥
      4565 + the new tests.

## Verification Steps

- AC1/AC2/AC3: read the flight log's Leg 1 spike section; re-run the trace
  script once after the fix (the Developer keeps its harness under the
  session scratchpad, never in the repo) and paste the decisive lines.
- AC4: `git diff 4e4117f -- src/ | grep -i "spike\|trace"` → empty.
- AC5: `node --test test/unit/seam-contract.test.js`; `grep -c "ForAudit"
  src/renderer/renderer.js` shows only bindings/republishing, no bodies.
- AC6: `node --test test/unit/site-security-controller.test.js`; `grep -n
  "addressChip.addEventListener\|case 'site-info'" src/renderer/renderer.js`
  → empty.
- AC7: `node -e "console.log(require('fs').readFileSync('src/renderer/renderer.js','utf8').split(/\r?\n/).length)"`
  equals the pinned constant.
- AC8: `grep -n "class FakeClassList\|class FakeElement" test/unit/*.test.js`
  → empty; `grep -n "helpers/fake-dom" test/unit/*.test.js` → both files.
- AC9: `npm test -- --test-timeout=60000 && npm run lint && npm run typecheck && npm run format:check`.

## Implementation Guidance

1. **Spike first, on the live rig.** Add TEMPORARY main-side logging
   (prefix every line `[spike]`, write to stderr) at: `app.on('certificate-
   error')` (a throwaway handler that logs `url`, `error`, `isMainFrame`,
   `certificate.fingerprint`, then calls `callback(false)` and
   `event.preventDefault()` — for (b)/(c)/(d); flip to `callback(true)` for
   one run to measure (c)/(e)); a throwaway `setCertificateVerifyProc` installed in `onSessionCreated` BESIDE `applyShields` (`session-runtime.js:254`, BEFORE the `if (!jarEntry) return` at `:267` that skips the Burner session — flight DD6) logging `hostname`,
   `verificationResult`, `errorCode`, `isIssuedByKnownRoot`,
   `!!certificate.issuerCert`, then `callback(-3)` — for (a)/(b)/(f); and
   `webContents.on('focus'|'blur')` on the chrome view, each guest, and
   `win.on('focus'|'blur')`, plus `[spike] loadURL` immediately before/after
   `wc.loadURL` in `tab-navigate`, each line with `Date.now()` and the wcId —
   for (h). For (g): `import-client-cert.mjs` shows the `certutil`/NSS
   recipe; generate a SECOND throwaway CA + server cert by hand with
   `openssl` under the scratchpad (do not extend `gen-certs.mjs` in this
   leg — that is leg 4's), `certutil -A -n goldfinch-spike-ca -t "C,," -i
   ca2.pem -d sql:$HOME/.pki/nssdb` BEFORE launching, serve it with a
   one-off `node -e` https server on `127.0.0.1:{T2}`, navigate, and read
   the verify-proc line (`OK` → honoured); remove the anchor after
   (`certutil -D -n goldfinch-spike-ca -d …`). For (i): navigate to
   `https://localhost:{T}/`. For (h): with the app raised (`activateTab`),
   perform the typed navigation via `evaluate` + `pressKey('Enter')` for a
   failing address and for a fixture page, and ALSO drive `wc.loadURL`
   directly from the `[spike]`-instrumented `tab-navigate` handler so the
   view-level focus transfer is observable even if the WSLg window is not
   OS-active. Optional (h′): also drive automation's `navigate` op (`src/main/automation/nav.js:52-60` calls `wc.loadURL` directly, no chrome handler, chrome never held focus) on a BACKGROUND tab and record whether any focus event fires — #216 is a stranded-KEYBOARD-focus defect on the chrome-initiated path and this case is out of its scope, but the observation costs one line. Record everything in the flight log, then REMOVE all instrumentation (`git diff` must show none).
2. **Choose and implement the #216 fix from the trace** (DD12). H1
   (`loadURL` moves focus to the guest at start) → in `tab-navigate`'s
   `loadURL` branch, capture `const chromeHadFocus = chrome.isFocused()`
   before the load and, if true, call `chrome.focus()` right after
   `wc.loadURL(...)` returns (synchronously; the success path's
   `pendingFocusGuest` → `tab-focus-guest` still hands focus to the guest at
   `did-navigate`). H2/H3 → arm `entry.chromeNavPending = true` at
   `tab-navigate` when the chrome held focus, clear it at `did-navigate` /
   `did-fail-load`, and in a chrome-`blur` listener (window-factory or
   guest-wiring, wherever the chrome view's wc is wired) re-focus the chrome
   while the flag is set and no sheet menu is open. Either way: unit-pin on
   `guest-wiring.test.js`'s `FakeContents` / `register-tab-ipc.test.js`
   harness (chrome focused before → chrome focused after a failing load;
   guest focused before → untouched; sheet open → untouched); remove the F1 `did-finish-load` reassert (`guest-wiring.js:611-624`) if the trace shows
   the theft happens at start, keeping the `did-fail-load` one only if it is
   still load-bearing (say which in the log).
3. **Extract `audit-hooks.js`.** Move the six hook bodies verbatim into
   `createAuditHooks(deps)`; `renderer.js` destructures them:
   `const { openAuthBasicOverlayForAudit, … } = createAuditHooks({ openOverlayMenu, els, chromePointToSheet, … })`.
   Keep the M14/M15 provenance comments with the bodies. The seam tail is
   untouched.
4. **Seed `site-security-controller.js`.** Move the chip listeners,
   `siteInfoAnchor`, `openSiteInfoOverlay` (deps: `els`, `openOverlayMenu`,
   `siteInfoModel`, `activeTab`, `overlayTriggerClick`, `leftAnchorOf`,
   `openSiteSettingsTab`); expose `{ openSiteInfoOverlay, handleActivation,
   handleClosed }`; chain `handleActivation` into the `onActivated` short-circuit at `renderer.js:521-523` (the vault/downloads precedent — the chain runs at the CALL SITE and skips `dispatchOverlayActivation` entirely when consumed), add `siteSecurityController.handleClosed(...)` beside `vaultController.handleClosed` in `handleOverlayClosed` (`:1258-1277`), and delete the `'site-info'` case from `dispatchOverlayActivation` (`:981-984`). `overlayTriggerClick` and `leftAnchorOf` are injected deps (they stay in `renderer.js`). The `fixedTriggerMenu` table
   entry (`:440`) stays in `renderer.js` (it is the menu-state table, not
   glue).
5. **Shared fake DOM.** Create `test/unit/helpers/fake-dom.js` as the UNION of the two copies — they DIVERGE, not just subset: `tab-controller.test.js`'s `FakeElement` has an `innerHTML` setter that auto-populates `_parts` with `.tab-title/.tab-close/.tab-fav/.tab-status` (load-bearing: `tab-controller.js:167` builds the button via `innerHTML`), plus `style`, `disabled`, `value`, `tabIndex`, `parent`, `insertBefore`, `remove()`, `getBoundingClientRect()`; `load-failure-controller.test.js`'s has no `innerHTML` setter (a `makeBtn()` helper pre-assigns `_parts`) but carries `textContent` get/set, `focus()`/`focused`, `click()`. The two `document` fakes differ too (`createElement` + listener Map vs. `activeElement`, `body`, `__created`). Keep every feature; make the `innerHTML` auto-populate selector set a constructor/option so it is not tab-strip-specific. Export `{ FakeClassList, FakeElement, createFakeDocument }` (the `helpers/jars-page-dom.js` naming precedent — NOT the `support/` / `makeFakeDocument` names squawk 0077's draft text used; rewrite that text at completion). Four further copies exist (`bookmarks-bar.test.js`, `tab-boundary.test.js`, `vault-card-icon.test.js`, `vault-fill-icon.test.js`) — OUT of this leg's scope; list them in squawk 0077's Corrective Action as future consolidation candidates. Refactor the two tests to import the helper; run them. Complete squawk 0077's artifact.
6. **Re-pin the budget**, run Prettier, run all four gates, update this
   leg's status to `landed`, write the flight log entry (Changes Made /
   Verification / spike section), and STOP — do not commit.

## Edge Cases

- **Trace shows OS focus never on the chrome under automation** (WSLg):
  fall back to the main-driven `loadURL` probe in step 1 — view-level focus
  events are observable regardless of window activation; record both.
- **(g) NSS anchor not honoured**: record the verdict; DD14's fallback
  (external host) is leg 4's decision — do not attempt to make it work here.
- **(c) `certificate-error` does NOT refire after `callback(true)`**: DD7's
  decision fallback becomes load-bearing — say so in the consequence column.
- **Extraction changes a11y-audit `open:` string reachability**: it must
  not; if a hook name has to change, STOP and log — the a11y audit is
  out of this leg's surface.
- **Budget measurement**: measure AFTER `npm run format`; never fold lines
  to fit (CLAUDE.md § Formatting is Prettier's).
- **Key hygiene**: any accidental key echo → rotate by relaunching with
  `DEV_MINT` and never record the value anywhere.

## Files Affected

- `src/renderer/renderer.js` — hooks + site-info glue removed; two
  constructions + one chaining line added
- `src/renderer/chrome/audit-hooks.js` — new
- `src/renderer/chrome/site-security-controller.js` — new (seed)
- `src/main/register-tab-ipc.js` and/or `src/main/guest-wiring.js`
  (`window-factory.js` if the chrome-blur shape is chosen) — the #216 fix
- `test/unit/helpers/fake-dom.js` — new; `test/unit/tab-controller.test.js`,
  `test/unit/load-failure-controller.test.js` — import it
- `test/unit/audit-hooks.test.js`, `test/unit/site-security-controller.test.js`
  — new; `test/unit/guest-wiring.test.js` / `register-tab-ipc.test.js` — #216 pin
- `test/unit/seam-contract.test.js` — `RENDERER_LINE_BUDGET`
- `squawks/0077-shared-fake-dom-test-harness.md` — completed
- `missions/20-no-silent-failures/flights/02-tls-trust/flight-log.md`

## Citation Audit

2026-09-15, HEAD `4e4117f`: design review (Developer) found six drifted or
wrong ranges — the four hook ranges, the `:950` chaining precedent (actual
`:521-523`), and the missing `handleClosed` seat (`:1258-1277`) — all
corrected above; every other range confirmed exact by the reviewer (`renderer.js` hooks `:789-866`/`:1390-1428`/
`:1497-1515`, chip listeners `:927-933`, dispatch case `:981-984`, seam tail
`:1816`; `seam-contract.test.js:88`/`:200`; `navigation-controller.js:186-217`;
`register-tab-ipc.js:19-22`/`:924-948`; `guest-wiring.js:495-529`/`:622`;
fake-DOM duplicates `:10/:31` and `:18/:39`). Lines drift with every edit —
re-grep before pinning.

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
