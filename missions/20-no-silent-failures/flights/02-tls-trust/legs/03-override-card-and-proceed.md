# Leg: override-card-and-proceed

**Status**: completed
**Flight**: [TLS Trust — Interstitial, Override, Indicator, Viewer](../flight.md)

## Objective

Give the interstitial its gated proceed: an **Advanced** button on the panel
opens a `cert-override` card on the menu-overlay sheet whose **Proceed**
rides a dedicated four-guard sheet→main invoke that is the ONE caller of
`certTrust.allow()`, re-navigates the tab, and is structurally unreachable
by every automation op at every tier.

## Context

- Binding DDs: **DD3** (the card, the four guards in order, navigation-away
  close, no chrome-callable override, `cert-override` never automatable),
  **DD2** (`allow` single call site; entry-derived key), **DD4**
  (`#load-failure-advanced` additive hook, hidden when non-overridable),
  **DD10** (`cert-override` stays OUT of `AUTOMATABLE_MENU_TYPES`), **DD11**
  (audit hook in `audit-hooks.js`; seam +1 here → 37), **DD16** (contracts).
- **Flight Director rulings for this leg**: (1) the flight's ONE
  security-decision channel — the Developer treats every guard as a named
  predicate with its own failing test; (2) `renderer.js` is at 1793/1794
  again; this leg's glue is bounded and named: the menu-state table entry,
  one `onAdvanced` dep, one `closeOverlayMenu` dep, one seam republish line
  → FIVE lines (menu-state entry, `onAdvanced` dep, `closeOverlayMenu` dep, the audit-hook DESTRUCTURE line, the seam-tail republish line — every hook costs two lines, `renderer.js:1437-1442` + `:1787-1790`); re-pin to the measured count, **≤ 1800**; (3) the card is dismissible
  (Escape / Back / backdrop / outside-click / blur all close it — it is not
  a vault sheet and must not survive blur); (4) the proceed re-navigation
  reuses the intended address and the same `isSafeTabUrl` gate as
  `tab-navigate`, never a payload URL.
- **Current code (working tree = HEAD `4e4117f` + legs 1–2 uncommitted)**:
  - `src/main/cert-trust.js` — `keyFor(partition, host, port, fingerprint)`
    `:51`; `createCertTrust` `:58`; `allow(key)` `:143` (zero callers —
    `cert-trust.test.js`'s pin "allow() has no caller yet (inverted by leg
    3)"); `NO_PARTITION` `:42`; exports `:163`.
  - `src/main/guest-wiring.js:519-540` — the `did-fail-load` fold of
    `entry.certFailure` into `entry.loadFailure.cert`. **The folded object carries `host`, `port`, `error`, `overridable`, `summary` but NOT `fingerprint`** (verified 2026-09-15 — `guest-wiring.js:530-536`; the stamp in `cert-trust.js` `stampEntry` `:86` has it): add `fingerprint: cf.fingerprint` to the fold and extend `guest-wiring.test.js` — the proceed handler keys the override from
    `entry.loadFailure.cert`, never from the payload.
  - `src/main/register-overlay-ipc.js` — `recordForSheetSender` `:125`;
    `menu-overlay:activated` `:157-197` (channel 4; `sanitizeActivatedValue`);
    `menu-overlay:bookmark-edit-submit` `:775-821` (the shape to COPY for
    the invoke plumbing — `ipcMain.handle`, gated on an injected dep,
    `{ ok }` reply — but NOT the guard set); **the three-guard precedent**
    `:829-855` (`menu-overlay:overflow-drop`: sender → token →
    `current.menuType !== 'bookmarks-overflow' → return`) — this leg adds
    the fourth guard (entry gate) after those three. `MENU_CLOSE_REASONS`
    `:8-…` includes `'navigation'`. `chromeForAttachment` is a dep (`:57`).
  - `src/preload/menu-overlay-preload.js:108` — `bookmarkEditSubmit`
    (add `certOverrideProceed: (payload) =>
    ipcRenderer.invoke('menu-overlay:cert-override-proceed', payload)`).
  - `src/renderer/menu-overlay.js` — bookmark-edit template block
    `:2601-2700` (`buildBookmarkEditCard` import `:57`; `sheet({...})`
    entry `:2624`; the submit handler awaits the invoke and closes only on
    `{ ok: true }` `:2660-2700`); template map `:2735`; `NODE_OF_ENTRY`
    `:2757`; the eager-close scrub (`onCloseReset`) `:2825-2827` and open dispatch `:3019`.
  - `src/shared/bookmark-edit-template.js` — `buildBookmarkEditCard(document)`
    + `applyBookmarkEditModel` — the pure builder shape to mirror
    (`role="dialog" aria-modal="true"`, own `aria-label`, `.new-container-*`
    classes, `attachModalCard` Tab-cycle).
  - `src/shared/modal-card-controller.js:219-260` — `attachModalCard({ node,
    getCycle, close, dismissible })`: Escape → `close('escape')`, Tab cycles
    `getCycle()`, backdrop press → `close('outside-click')`.
  - `src/renderer/chrome/overlay-menus.js:65-77` — `open(menuType, model,
    anchor, startIndex, options)`; `survivesBlur` assigned from
    `VAULT_BLUR_SURVIVAL_MENU_TYPES` (cert-override is NOT added there).
  - `src/renderer/renderer.js` — menu-state table (`'bookmark-edit':
    fixedTriggerMenu(() => els.star)` `:448`); `closeOverlayMenu: (reason)
    => overlayMenuClient.close(reason)` already passed to two controllers
    (`:402`, `:574`); `createLoadFailureController({...})` `:650-658`; `createSiteSecurityController({...})` `:897-907`; audit-hook destructure `:1437-1442`; seam tail `Object.assign` `:1752` (republish lines `:1787-1790`). 1793 lines / `RENDERER_LINE_BUDGET = 1794`
    (`seam-contract.test.js:216`; `vault-restore-workflow-invariants.test.js`
    mirrors it).
  - `src/renderer/chrome/load-failure-controller.js` — `render(tab)` `:79`
    (cert branch `:81-98`, `classifyCertError(cert.error)` → `{ kind, title,
    body, overridable }`); Retry `:48-52`, its click `:162`; the
    `onTabLoadFailure` subscription `:170` (the `null` push = navigation
    away / retry started).
  - `src/renderer/chrome/site-security-controller.js` — `onTabSecurity`
    `:73`; `handleClosed` (empty seat) `:87`; return `:89`.
  - `src/renderer/chrome/audit-hooks.js` — `createAuditHooks` `:30`;
    `openCertPickerOverlayForAudit` `:52` (synthetic-model precedent);
    return `:146`. `scripts/a11y-audit.mjs:466/:532` — `SHEET_STATES`
    record entries (skipped by ruling; the record still lists every sheet
    state).
  - `src/main/automation/resolve.js:53` — `AUTOMATABLE_MENU_TYPES`
    (`bookmarks-overflow`, `bookmark-edit`); `test/unit/automation-resolve.test.js:183`
    and `test/unit/sheet-automation-gate-invariant.test.js` — the pins to
    extend with the `cert-override` negative.
  - `src/main/register-tab-ipc.js:949-975` — `tab-navigate`'s `loadURL`
    branch: trust-branched `isSafeTabUrl`/`isInternalPageUrl` gate, stamps
    `lastRequestedUrl`, arms `chromeNavPending`, `wc.loadURL(...).catch`.
    The proceed handler mirrors this sequence for a WEB entry (a trusted/
    internal entry can never carry a cert failure — refuse if it does).
  - `src/main/main.js` — `registerOverlayIpc({...})` at `:1964`; `certTrust` constructed `:1620`; `getTabContents` `:523`; `isSafeTabUrl` required `:43`; `keyFor` is NOT yet destructured from `require('./cert-trust')` — extend that require. Thread `certTrust`, `keyFor`, `getTabContents`, `isSafeTabUrl`.

## Inputs

- Legs 1–2 landed (uncommitted): `cert-trust.js` with `allow()` uncalled;
  `loadFailure.cert` folded on cert failures; the interstitial cert branch;
  `site-security-controller.js` with `handleActivation`/`handleClosed`
  seats; `audit-hooks.js`.
- Live rig + TLS fixture (leg-1 rules verbatim; key hygiene absolute).

## Outputs

- `src/shared/cert-override-template.js` (new ESM, pure):
  `buildCertOverrideCard(document)` → `{ node (#sheet-cert-override, hidden),
  card (role="dialog", aria-modal, aria-label "Proceed despite a certificate
  error?"), heading (#sheet-cert-override-heading), body
  (#sheet-cert-override-body), errorLine (#sheet-cert-override-error, the
  raw name), status (aria-live polite, for a failed proceed), back
  (#sheet-cert-override-back, "Back to safety"), proceed
  (#sheet-cert-override-proceed, "Proceed to {host} (unsafe)") }` and
  `applyCertOverrideModel(card, model)` for `model = { host, error, title,
  body }` — every string via `textContent`; unknown/missing fields →
  empty strings, never a throw.
- `src/renderer/menu-overlay.js`: template `'cert-override'`, `NODE_OF_ENTRY`
  entry, a `sheet({...})` entry with `attachModalCard` (2-way cycle back ↔
  proceed; `dismissible: true`); `onOpen` focuses **Back**; Back click →
  `menuController.close(entry)` (dismiss); Proceed click → `await
  window.menuOverlay.certOverrideProceed({ token })` with a busy latch;
  `{ ok: true }` → main has already closed the sheet (no-op here);
  `{ ok: false }` → status line "Couldn't proceed — go back and try again",
  card stays. Enter with focus on Back closes (native button); nothing on
  the card auto-focuses Proceed.
- `src/preload/menu-overlay-preload.js`: `certOverrideProceed`.
- `src/main/register-overlay-ipc.js`: `ipcMain.handle('menu-overlay:cert-
  override-proceed', …)` registered only when `certTrust` is injected; the
  guards AS NAMED PREDICATES, in order, each returning `{ ok: false,
  reason }`: (1) `recordForSheetSender(event.sender)` → `'sender'`;
  (2) `typeof token === 'number' && token === current.token` →
  `'token'`; (3) `current.menuType === 'cert-override'` → `'menu-type'`;
  (4) `entry = rec.tabViews.get(rec.activeTabWcId)` exists, is NOT
  `trusted`, and `entry.loadFailure?.cert?.overridable === true` with
  string `host`/`fingerprint` and a `lastRequestedUrl` that passes
  `isSafeTabUrl` → `'entry'`. Then: `certTrust.allow(keyFor(entry.partition,
  cert.host, cert.port, cert.fingerprint))`; `rec.sheet.closeMenuOverlay('activated', token)` (which synchronously `focusChrome()`s — `menu-overlay-manager.js:504-506`); **`entry.chromeNavPending = true`** (design review, HIGH: the guest's asynchronous self-focus a few ms into `loadURL` would otherwise blur the freshly-focused chrome with the #216 reassert net disarmed — this ARMS the same `window-factory.js:213-224` reassert `tab-navigate` arms; it disarms at `did-navigate`/`did-fail-load` like every other chrome-initiated navigation; accepted consequence: after a SUCCESSFUL proceed OS focus rests on the chrome, not the page — F6/Tab reach the page; the HAT judges the feel); `wc.loadURL(entry.lastRequestedUrl).catch(log)`; return `{ ok: true }`. Guard 2's `!current || token !== current.token` collapses the no-menu-open case into reason `'token'` (no fifth reason string).
  No chrome→main channel exists for this; the chrome preload exposes nothing named `certOverride*`/`cert-override*` (grep-AC). Why the surface is closed (state it in the handler's comment block): automation `click`/`pressKey`/`typeText` dispatch `sendInputEvent` to the RESOLVED webContents by wcId, never by screen coordinate (`src/main/automation/input.js`), so a chrome-targeted input can never land on the sheet's overlapping region; admin `evaluate` on the chrome runs in the chrome realm, which has only `window.goldfinch.*` — `window.menuOverlay.certOverrideProceed` lives in the SHEET's preload/webContents, unreachable from the chrome; the sheet wcId itself is refused to every op while `cert-override` is current; `recordForSheetSender` compares webContents identity, never a payload id.
- `src/main/main.js`: thread `certTrust`, `keyFor`, `getTabContents`,
  `isSafeTabUrl` into `registerOverlayIpc`.
- `src/main/guest-wiring.js`: the fold carries `fingerprint` (if it does not
  already).
- Chrome: `load-failure-controller.js` gains `#load-failure-advanced`
  ("Advanced") after Retry, shown only when `cert && classification.
  overridable`; click → `onAdvanced(tab)` (injected).
  `site-security-controller.js` gains `openCertOverrideOverlay(tab)`
  (`openOverlayMenu('cert-override', { host, error, title, body }, null,
  0)`; tracks `certOverrideOpen = true`), `handleActivation` treats
  `cert-override` as a validated no-op (channel 4 never carries proceed),
  `handleClosed({ menuType: 'cert-override' })` clears the flag, and the
  navigation-away close: while the flag is set, a `tab-load-failure`
  `null` push or a `tab-did-navigate` for the ACTIVE tab →
  `closeOverlayMenu('navigation')` (deps: `closeOverlayMenu`, the existing
  `bridge`). `renderer.js`: `'cert-override': fixedTriggerMenu(() => document.getElementById('load-failure-advanced'))` in the menu-state table — the resolver MUST be lazy: `context.js`'s `IDS` map is read once at boot by `getElementById`, before the panel controller builds its children, so an `els.loadFailureAdvanced` entry would capture `null` forever (design review); this is the first `fixedTriggerMenu` target that is not a static element — pin the lazy resolution in a unit test (entry constructed before the button exists still refocuses it). `onAdvanced: siteSecurityController.openCertOverrideOverlay` passed to the panel
  controller (construction-order check: the panel controller is built
  before the site-security controller today — use a late-bound closure,
  the `homePageCache` idiom), `closeOverlayMenu` passed to the site-security
  controller.
- `src/renderer/chrome/audit-hooks.js`: `openCertOverrideOverlayForAudit()`
  (synthetic model `{ host: '127.0.0.1:8443', error: 'ERR_CERT_AUTHORITY_INVALID',
  title, body }`), republished in the seam tail; `SEAM_COUNT` 36 → 37 in
  `seam-contract.test.js` AND CLAUDE.md's seam note (lockstep);
  `scripts/a11y-audit.mjs` `SHEET_STATES` gains `{ label: 'sheet:cert-override',
  open: 'openCertOverrideOverlayForAudit()' }` (recorded, skipped by ruling).
- `src/renderer/menu-overlay.css`: card rules in the `.bookmark-edit-inner`
  /`.new-container-inner` family; the Proceed button visually secondary
  (Back is the primary) — never colour-alone.
- Tests: `cert-override-template.test.js` (structure/aria/ids; model
  application; missing fields); `register-overlay-ipc.test.js` (+ the
  proceed handler: happy path issues `allow` with the ENTRY-derived key,
  closes with `'activated'`, issues `loadURL(lastRequestedUrl)`; each guard
  failing ALONE → `{ ok: false, reason }`, no `allow`, no `loadURL`, no
  close — sender / stale token / wrong menuType (`bookmark-edit` open) /
  no entry / trusted entry / non-overridable cert / missing fingerprint /
  unsafe `lastRequestedUrl`; a payload carrying `url`/`host`/`fingerprint`
  fields is IGNORED — the key comes from the entry; not registered when
  `certTrust` is absent); `cert-trust.test.js` pin INVERTED and renamed
  ("allow() has exactly one caller: the cert-override-proceed handler" —
  source-scan over `src/`); `automation-resolve.test.js` +
  `sheet-automation-gate-invariant.test.js` (`cert-override` refused for
  every op including the three read ops, at admin); a preload source-scan
  (`chrome-preload.js` exposes no `certOverride`/`cert-override` method);
  `load-failure-controller.test.js` (Advanced shown iff overridable; click
  → `onAdvanced(tab)`; hidden for `revoked`/`pinned`/`invalid`);
  `site-security-controller.test.js` (open model shape; navigation-away
  close fires only while open and only for the active tab; `handleClosed`
  clears; channel-4 no-op); `audit-hooks.test.js` (+1); `seam-contract`
  (37; budget).

## Acceptance Criteria

- [x] **AC1 — four guards, each alone.** The proceed handler's unit tests
      show every guard failing ALONE yields `{ ok: false, reason }` with no
      `allow`, no `loadURL`, no close; the happy path calls `allow` exactly
      once with `keyFor(entry.partition, cert.host, cert.port,
      cert.fingerprint)` derived from the ENTRY, closes with `'activated'`,
      and issues `loadURL(entry.lastRequestedUrl)`; payload-carried
      host/url/fingerprint are ignored (test injects contradicting values).
- [x] **AC2 — the one caller.** `grep -rn "\.allow(" src/` → exactly one
      hit, inside the `menu-overlay:cert-override-proceed` handler; the
      leg-2 pin is inverted and renamed (git blame documents the shift).
- [x] **AC3 — unreachable by automation.** `cert-override` is not in
      `AUTOMATABLE_MENU_TYPES`; the gate tests pin that `readDom`,
      `readAxTree`, `captureScreenshot`, `click`, `pressKey`, `typeText`,
      `evaluate` on the sheet wcId are refused at admin while
      `cert-override` is current; `chrome-preload.js` exposes no
      override-related method (source-scan). Live: with the card open,
      `readAxTree(sheetWcId)`, `evaluate(sheetWcId, '1')`, and
      `click(sheetWcId, …)` via the attach client all return refusals.
- [x] **AC4 — the card.** Live: on the fixture interstitial, `evaluate`
      clicking `#load-failure-advanced` → `enumerateWindows` shows
      `sheetVisible: true`; `readAxTree(chromeWcId)` before the click shows
      the Advanced button; after a tab switch the sheet is hidden again.
      Unit: the card's structure/aria/ids; Back holds initial focus; Proceed
      never auto-focused; Escape/Back/backdrop dismiss.
- [x] **AC5 — Advanced only when overridable.** `#load-failure-advanced` is
      shown for `authority`/`name`/`date`/`weak`/`other` and hidden for
      `revoked`/`pinned`/`invalid`; the body copy for the hidden case says
      the error cannot be bypassed (from `classifyCertError`).
- [x] **AC6 — navigation-away closes the card.** Unit: with the card open,
      a `tab-load-failure` `null` push or a `tab-did-navigate` for the
      active tab calls `closeOverlayMenu('navigation')`; a background tab's
      push does not; after `handleClosed` nothing fires.
- [x] **AC7 — seam + budget.** `SEAM_COUNT` 37 (test + CLAUDE.md in
      lockstep); `SHEET_STATES` records `sheet:cert-override`;
      `RENDERER_LINE_BUDGET` re-pinned to the measured count ≤ 1800 with the justification naming the five glue lines.
- [x] **AC8 — the proceed path, end to end (HAT-verified).** The autonomous
      run cannot click the card. The Developer records in the flight log
      that AC1's happy-path test is the autonomous evidence, and the HAT leg
      carries the live verification: Proceed loads the fixture page, the
      strip clears, the census reads `security: "overridden"`, and a new tab
      to the origin loads without an interstitial.
- [x] **AC9 — gates.** The four gates green; test count grows.

## Verification Steps

- AC1/AC2: `node --test test/unit/register-overlay-ipc.test.js
  test/unit/cert-trust.test.js`; `grep -rn "\.allow(" src/`.
- AC3: `node --test test/unit/automation-resolve.test.js
  test/unit/sheet-automation-gate-invariant.test.js`; the preload scan; live
  refusals pasted into the flight log.
- AC4/AC5/AC6: `node --test test/unit/cert-override-template.test.js
  test/unit/load-failure-controller.test.js
  test/unit/site-security-controller.test.js`; live `enumerateWindows`.
- AC7: `node --test test/unit/seam-contract.test.js`; `grep -n "SEAM_COUNT"
  CLAUDE.md test/unit/seam-contract.test.js`.
- AC9: the four gates.

## Implementation Guidance

1. **Template + sheet entry first** (`cert-override-template.js`,
   `menu-overlay.js`, CSS, preload) with the template test — mirror
   `bookmark-edit` line for line, minus the inputs.
2. **The invoke handler** in `register-overlay-ipc.js`, guards as four
   named predicates with a comment block in the `overflow-drop` style
   (`:829-855`) naming WHY each exists; register only when `certTrust` is
   injected; thread deps in `main.js`. Write the guard tests BEFORE the
   happy path.
3. **Fold check** in `guest-wiring.js` (fingerprint/host/port on
   `loadFailure.cert`); extend `guest-wiring.test.js` if you add a field.
4. **Chrome**: Advanced button + `onAdvanced` in the panel controller;
   `openCertOverrideOverlay` / flag / navigation-away close / `handleClosed`
   in the site-security controller; menu-state entry + two deps + late-bound
   closure in `renderer.js`; audit hook + seam republish; `SHEET_STATES`
   record; `SEAM_COUNT` 37 + CLAUDE.md note.
5. **Invert the leg-2 pin**; add the automation negatives and the preload
   scan.
6. **Live check** (AC3/AC4): launch (leg-1 rules), `serve-tls.mjs --port {T}`,
   `openTab` the fixture, `evaluate` the Advanced click, `enumerateWindows`,
   attempt the three refused ops on the sheet wcId through the attach client
   (expect `isError`/refusal values), `activateTab` another tab to close.
   Tear down (kill by port pid; delete the key file).
7. Gates, Prettier, budget measurement + re-pin, flight-log entry, leg
   status `landed`. No commit.

## Edge Cases

- **Proceed while the entry's failure has cleared** (operator navigated
  away between open and click): guard 4 fails → `{ ok: false, reason:
  'entry' }`; the card's status line shows the failure copy; the
  navigation-away close will have closed it already in the normal case.
- **Two windows, both with cert-blocked tabs**: the sheet sender resolves
  ITS window's record; the entry is that window's active tab — never a
  cross-window write.
- **The proceed re-navigation fails again** (server changed cert between
  open and proceed → new fingerprint): `certificate-error` refires,
  the key does not match → refused → a fresh interstitial. Correct by
  construction; pin the `keyFor` mismatch in `cert-trust.test.js` if not
  already.
- **Sheet `blur` while the card is open**: closes (dismissible; not in the
  vault blur-survival set) — a re-open costs one click; acceptable.
- **`openCertOverrideOverlayForAudit` under automation**: opens a synthetic
  card that is itself refused to every op — the record entry exists for
  the skip list, not for coverage.
- **Never read `win.*` in `closed`-or-later handlers** — not touched.

## Files Affected

- New: `src/shared/cert-override-template.js`,
  `test/unit/cert-override-template.test.js`
- Modified: `src/renderer/menu-overlay.js`, `src/renderer/menu-overlay.css`,
  `src/preload/menu-overlay-preload.js`, `src/main/register-overlay-ipc.js`,
  `src/main/main.js`, `src/main/guest-wiring.js` (fold field, if needed),
  `src/renderer/chrome/load-failure-controller.js`,
  `src/renderer/chrome/site-security-controller.js`,
  `src/renderer/chrome/audit-hooks.js`, `src/renderer/chrome/context.js`
  (if an id is added), `src/renderer/renderer.js` (5 lines),
  `scripts/a11y-audit.mjs` (record entry), `CLAUDE.md` (seam note 37)
- Tests: `register-overlay-ipc.test.js`, `cert-trust.test.js`,
  `automation-resolve.test.js`, `sheet-automation-gate-invariant.test.js`,
  `load-failure-controller.test.js`, `site-security-controller.test.js`,
  `audit-hooks.test.js`, `seam-contract.test.js`,
  `vault-restore-workflow-invariants.test.js`, a preload source-scan test
- `missions/20-no-silent-failures/flights/02-tls-trust/flight-log.md`

## Citation Audit

2026-09-15, working tree = `4e4117f` + legs 1–2: `cert-trust.js:42/:51/:58/
:86/:143/:163`; `guest-wiring.js:519-540`; `register-overlay-ipc.js:8/:57/
:125/:150-196/:776-820/:829-855`; `menu-overlay-preload.js:108`;
`menu-overlay.js:57/:2601-2700/:2624/:2735/:2757/:2862/:3019`;
`modal-card-controller.js:219-260`; `overlay-menus.js:65-77`;
`renderer.js:402/:448/:574/:650-657/:897-906` (1793 lines);
`seam-contract.test.js:216`; `load-failure-controller.js:48-52/:79-98/:162/
:170`; `site-security-controller.js:73/:87/:89`; `audit-hooks.js:30/:52/
:146`; `a11y-audit.mjs:466/:532`; `resolve.js:53`;
`register-tab-ipc.js:949-975`. Design review (Developer, 2026-09-15): six drifted ranges corrected above (`:157-197`, `:775-821`, `:650-658`, `:897-907`, seam tail `:1752`, scrub `:2825-2827`); every other range confirmed exact. Re-grep before pinning.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header) — set to
      `landed` instead per this leg's explicit dispatch instructions
      (deferred-commit workflow; not the flight's final leg)
- [ ] Check off this leg in flight.md — explicitly deferred per dispatch
      instructions
- [ ] If final leg of flight: N/A — legs 4-5 remain
- [ ] Commit all changes together (code + artifacts) — explicitly deferred
      per dispatch instructions (deferred-commit workflow; no commit made)
