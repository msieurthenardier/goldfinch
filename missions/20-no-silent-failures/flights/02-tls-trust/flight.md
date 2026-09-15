# Flight: TLS Trust — Interstitial, Override, Indicator, Viewer

**Status**: ready
**Mission**: [No Silent Failures](../../mission.md)

## Contributing to Criteria

- [ ] Untrusted certificates get an interstitial, not a blank — origin and
      specific error named, risk in plain language, explicit gated proceed,
      remembered per origin until quit, never on disk, never available to
      automation (behavior-test-backed: local throwaway-CA fixture)
- [ ] Insecure connections are labelled — one "not secure" vocabulary across
      the address chip and the site-info popup for plain `http:` AND
      overridden-certificate pages; a trusted `https:` page is not labelled
- [ ] A site's certificate is inspectable — subject, issuer, validity,
      fingerprints, chain; read-only
- [ ] *(partial — the cert-blocked census value, the `security` census field,
      the interstitial's keyboard operability, and the #216 stranded-focus
      fix)* New surfaces are safe and accessible
- [x] *(carried from Flight 1, now specialised)* Certificate failures never
      fail blank

---

## Pre-Flight

### Objective

Turn a certificate failure from a generic "didn't load" into an informed
decision. Main intercepts every certificate error, answers the engine
immediately, records the failing certificate on the tab's registry entry, and
lets Flight 1's surface specialise into an interstitial that names the origin
and the exact error and explains the risk. Proceeding is a gated, human-only
action on the menu-overlay sheet, remembered in memory for that origin (by
certificate fingerprint, per jar) until the app quits. Every page then carries
a security state — secure, not secure (`http:`), not secure (overridden) —
shown with one vocabulary in the address chip and the site-info popup and
reported in the automation census; and any page's certificate can be read in
a viewer fed by a session-level verification observer. Before any of that is
built on the hidden-guest surface, the flight diagnoses and fixes the Flight 1
stranded-focus defect (#216) and extracts the chrome glue that the
composition root no longer has room for.

### Open Questions

- [x] Hold the `certificate-error` callback until the operator decides (the
      auth-challenge model) or answer it at once and re-navigate on proceed
      → DD1 (answer at once; Chrome parity; no dangling callback by shape)
- [x] Where a trusted page's certificate comes from (mission OQ) → DD6
      (session verify-proc observer, always deferring to Chromium)
- [x] Per-origin certificate cache bounds and scope (mission OQ) → DD6
      (per-session LRU of 256 hostnames; the durable copy is per open tab)
- [x] "Not secure" state machine for mixed states (mission OQ) → DD7
      (top-frame committed origin is the unit; observation-first)
- [x] How "never available to automation" is made structural → DD3/DD10
      (proceed lives on a sheet card the automation gate refuses; no chrome
      channel can add an override)
- [x] Which surface hosts the viewer → DD9 (a `cert-viewer` sheet card, read
      by automation under the allowlist)
- [x] What to extract from `renderer.js` first → DD11 (the audit-hook family
      + the site-info glue seeding the new controller)
- [x] #216 — diagnose here or defer → DD12 (leg 1 spike + fix; the
      interstitial is a keyboard-reachable security decision on the same
      surface)
- [x] HAT leg → yes, small (operator ruling 2026-09-15)
- [x] Squawk 0077 → absorbed by leg 1; squawks 0074 + 0076 → turnaround before
      the flight (operator rulings 2026-09-15)
- [x] Census `security` field → yes (operator ruling 2026-09-15)
- [x] Architect second pass (2026-09-15): **approve with changes** — three drafting residues from the leg split (a stale seam count, leg 2 still listing the proceed card, the spec's row note attributing the viewer opener to the wrong leg) fixed; every citation for the folded-in changes verified exact. Review cycles exhausted (2/2).
- [x] Architect design review (2026-09-15): **approve with changes** — the
      proceed invoke's missing current-menuType guard (high), the observer's
      placement ahead of the Burner-skipping early return and the popup
      model's shape (medium), a seam-count slip and the mission one-liner
      (low) — all folded into DD1/DD2/DD3/DD6/DD8/DD11 and the leg split
      (proceed card → its own leg). No citation errors found.

### Design Decisions

**DD1 — Certificate errors are answered at once; proceed re-navigates.**
`app.on('certificate-error', (event, wc, url, error, certificate, callback,
isMainFrame))` is registered at top level in `app-lifecycle.js` beside
`login` / `select-client-certificate` (`app-lifecycle.js:96-112`, same
before-`whenReady` rationale), always `event.preventDefault()`, and delegates
to a new Electron-free module `src/main/cert-trust.js`
(`createCertTrust({ registry, popupRegistry, chromeForTab, logger })`,
the `auth-challenges.js` injected-deps shape). `handleCertificateError` does,
in this order and synchronously: (1) resolve the guest's partition and the
override key (DD2); (2) answer the callback **exactly once** — `true` iff the
key is remembered, else `false` — inside a `try/finally` so no throw can
leave it dangling (source-scan pinned: one `callback(` site in the module);
(3) if `isMainFrame` and the guest is a registry tab, stamp
`entry.certFailure = { url, host, port, error, fingerprint, summary }`
(`error` = the event's string with its `net::` prefix stripped, e.g.
`ERR_CERT_AUTHORITY_INVALID`; `summary` per DD9) on a refusal, or
`entry.certOverride = { host, port, fingerprint, error }` on a remembered
allow. A refused main-frame load then fails exactly as it does today —
Chromium emits `did-fail-load` with the same `ERR_CERT_*` name and Flight
1's handler (`guest-wiring.js:495-528`) records `loadFailure`; the handler
now folds the pending `certFailure` into it (`loadFailure.cert`, DD4) and
clears `entry.certFailure`. `did-start-navigation`'s existing clear
(`guest-wiring.js:466-490`) also clears a stale `certFailure`/`certOverride`
for a non-`chrome-error:` main-frame navigation. Subframe and subresource
errors are answered by the same rule (remembered → allow, else refuse) and
never stamp anything — a blocked subresource on a bad host stays blocked
silently (Chrome parity). **Popup windows** (Option B `BrowserWindow`
popups, `popupRegistry` is read ONLY to resolve the popup's captured
partition): the same Set is consulted with the same key, so a jar's
remembered override also applies to that jar's popups — intended; but a
refused popup navigation has no chrome to host an interstitial and fails
Chromium-blank — an accepted, documented gap (the popup surface is not this
mission's).
- Rationale: the auth-challenge store holds callbacks because a credential
  prompt has no "fail then retry" shape; a certificate refusal does — Chrome
  itself fails the load into an interstitial and re-navigates on proceed.
  Answering synchronously makes the single-resolve invariant true by
  construction (no queue, no occlusion bucket), and Flight 1's surface,
  state, census, and snapshot behaviour are inherited unchanged.
- Trade-off: proceed costs one extra request round-trip (the re-navigation);
  the engine may emit `certificate-error` once per request to the origin
  (spike (c)), so the remembered-key lookup must be O(1) and side-effect-free.

**DD2 — Override memory: in-memory, per jar, per host:port, per certificate
fingerprint, session-only.** `cert-trust.js` holds one `Set` of keys
`${partition}\n${host}:${port}\n${fingerprint}`; `allow(key)` is called from
exactly ONE site — the sheet-sender proceed handler (DD3) — and nothing else
(grep-AC). `clearPartition(partition)` is called from
`jar-data-lifecycle.js`'s `wipeJarData` and from jar removal
(`jar-registry-ipc.js`'s `handleRemove`), so an identity wipe drops the
jar's trust decisions (Chrome clears SSL decisions with browsing data); a
burner partition's keys die with the session. The module never imports
`fs`, `app-db`, or `settings-store` (grep-AC: nothing here is ever
persisted); `session-snapshot.js`'s and `closed-tab-capture.js`'s per-tab
output stays an explicit allowlisted object literal
(`session-snapshot.js:42-51`, `closed-tab-capture.js:70-85`) so
`certFailure`/`certOverride`/`certificate` can never reach disk by a spread
— pinned by an object-shape assertion in their tests, and no MCP op or chrome-callable IPC reads or writes the set.
A changed certificate (new fingerprint) re-interstitials; a refused kind
(DD5's non-overridable table) never reaches `allow`.
- Rationale: the mission's ruling (session-only, human-only; the #144
  per-origin store is a follow-on that may later become this set's owner).
- Trade-off: unbounded by design — one entry per explicit operator proceed.

**DD3 — Proceed is a sheet card the automation gate refuses.** The
interstitial's `#load-failure-advanced` button (shown only for an
overridable error) opens a new sheet menuType `cert-override`
(`src/shared/cert-override-template.js`, rendered by `menu-overlay.js`
through `createSheetEntry` — the `bookmark-edit` card discipline) with a
heading naming the host, the plain-language risk body for the error kind,
the raw error name, and two buttons: **Back to safety** (initially focused;
Escape/backdrop/outside-click are equivalent) and **Proceed to {host}
(unsafe)**. The proceed button never holds initial focus and Enter on the
card's initial focus never proceeds. Its activation rides a DEDICATED
sheet→main invoke `menu-overlay:cert-override-proceed { token }`
(`register-overlay-ipc.js`) with the FULL three-guard shape the
`bookmarks-overflow` drop/drag channels learned the hard way
(`register-overlay-ipc.js:829-855` — the comments there record the
current-menuType guard being omitted four times in Mission 15): in order,
(1) `recordForSheetSender(event.sender)` (sheet identity), (2) `token ===
current.token` (freshness), (3) **`current.menuType === 'cert-override'`**
(the sheet document is persistent and shared — a stale or foreign card must
never proceed), then (4) the entry gate. The lower-stakes
`bookmark-edit-submit` shape (`:776-820`, no menuType guard) is NOT the
precedent. Main then takes the SHEET's window record's `activeTabWcId`
entry, requires `entry.loadFailure?.cert?.overridable === true`, calls
`certTrust.allow(key)` from the entry's own
recorded host/port/fingerprint (never from any payload field), closes the
sheet (`'activated'`), stamps `entry.lastRequestedUrl` and issues
`wc.loadURL(entry.lastRequestedUrl)` — the same path `tab-navigate loadURL`
takes (`register-tab-ipc.js:942-948`). The chrome preload exposes NO
override method; channel-4 `menu-overlay:activated` for this menuType is a
validated no-op; `cert-override` is NOT in `AUTOMATABLE_MENU_TYPES`
(`resolve.js:53`), so every op — `readDom`, `click`, `pressKey`, `evaluate`
— is refused on the sheet while it shows, at every tier (pinned in
`automation-resolve.test.js`'s existing matrix plus a negative case).
- Rationale: the mission's "never available to automation" cannot be met by
  chrome DOM (admin `click`/`pressKey` on the chrome wcId inject trusted
  input events); the sheet is the one surface the engine structurally
  refuses (M15 F3 DD1), and the vault-unlock prompt is the precedent for
  a security decision rendered there. Chrome's own "Advanced → Proceed"
  two-step is preserved as panel-button → card.
  **Navigation-away closes the card**: `site-security-controller.js`
  closes an open `cert-override` card (`overlayMenuClient.close('navigation')`)
  when the active tab's `tab-load-failure` push turns `null` or a
  `tab-did-navigate` arrives for it — the entry gate above already makes a
  stale proceed a no-op; this keeps the card from outliving its question.
- Trade-off: the proceed path cannot be exercised by the Witnessed crew —
  the spec carries one operator-performed row (DD13); the proceed leg's
  Developer verifies the handler by unit test (all four guards, each
  failing alone) and the HAT by eye. The card + invoke get their OWN leg
  and design review (Architect, 2026-09-15).

**DD4 — The interstitial is the Flight 1 panel, specialised.**
`load-failure-controller.js`'s `render(tab)` branches on
`tab.loadFailure.cert`: heading/body from `classifyCertError` (DD5), the
`#load-failure-url` and `#load-failure-code` lines unchanged
(`ERR_CERT_AUTHORITY_INVALID (-202)`), **Retry** kept (a transient
interception clears on retry), plus two ADDITIVE hooks —
`#load-failure-view-cert` (opens the viewer with the failing certificate,
DD9) and `#load-failure-advanced` (opens the `cert-override` card, DD3;
hidden when the error is non-overridable, where the body says so). The
strip glyph, host title, aria suffix, address-bar preservation, F6/heading
focus, find exclusion, snapshot/closed-tab substitution, and the
`applyGuestVisibility` invariant are all inherited. DD10 of Flight 1 (frozen
contract) is EXTENDED, never changed: the two new ids join the contract
(read by this flight's spec, the a11y audit, and the controller test).
- Rationale: the mission decided the surface once; a second surface for the
  same tab state would duplicate every consumer.
- Trade-off: the panel now has three actions — the copy must make "Retry"
  (try the same address again) and "Advanced" (proceed despite the error)
  unmistakably different.

**DD5 — Certificate kinds, the census, and the security enum are shared
models.** `src/shared/load-failure.js` grows `LOAD_STATES.CERT_BLOCKED =
'cert-blocked'` and `classifyCertError(name)` → `{ kind, title, body,
overridable }`, name-matched: `authority` (`ERR_CERT_AUTHORITY_INVALID`),
`name` (`ERR_CERT_COMMON_NAME_INVALID`), `date` (`ERR_CERT_DATE_INVALID`),
`weak` (`ERR_CERT_WEAK_SIGNATURE_ALGORITHM`, `ERR_CERT_WEAK_KEY`),
`revoked` (`ERR_CERT_REVOKED`, non-overridable), `pinned`
(`ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN`, `ERR_CERT_KNOWN_INTERCEPTION_BLOCKED`,
non-overridable), `invalid` (`ERR_CERT_INVALID`, `ERR_CERT_CONTAINS_ERRORS`,
non-overridable), `other` (any other `ERR_CERT_*`, overridable with generic
copy). `classifyLoadFailure` is unchanged for non-cert names. `listTabs()`
reports `loadState: 'cert-blocked'` when `tab.loadFailure.cert` is set
(`tab-controller.js:1212`), `loadError` unchanged, and a new `security`
field (DD7's enum) mapped through `mapEnumeratedTabs` (`tabs.js:41-66`);
`docs/mcp-automation.md`'s census rows and the `enumerateTabs` description
document both. A new `src/shared/site-security.js` exports
`SECURITY_STATES = { SECURE: 'secure', INSECURE: 'insecure', OVERRIDDEN:
'overridden', NONE: 'none', INTERNAL: 'internal' }` and the pure
`deriveSecurityState({ url, verification, overridden, internal })` (DD7)
plus the display vocabulary (DD8) — one source for main, chip, popup, census.
- Rationale: the F1 DD3 precedent — engine strings never become prose; the
  enum lives where Flight 1 said it would.

**DD6 — Any page's certificate comes from a session-level verification
observer that always defers to Chromium.** `session-runtime.js`'s
`onSessionCreated` (`session-runtime.js:248-284`, web sessions only — the
internal-session early return already excludes `goldfinch://`) installs
`session.setCertificateVerifyProc(observer.proc)` **beside `applyShields`
at the top of the function (`:254`), BEFORE the jar-lookup block whose
`if (!jarEntry) return` (`:267`) would otherwise skip the Burner session
(Burner is never a `jars.list()` entry — `src/main/jars.js:18`); every
partition, Burner included, gets an observer — the Shields precedent** from a new Electron-free
`src/main/cert-observer.js` (`createCertObserver({ cap: 256 })`). The proc
records `{ hostname → { verificationResult, errorCode, isIssuedByKnownRoot,
summary } }` in a per-partition LRU (cap 256, oldest evicted) and calls
`callback(-3)` — "use Chromium's own verdict" — in a `finally`; it never
throws into the network service and never returns any other value
(source-scan pinned: the only `callback(` literal in the module is `-3`).
At each main-frame `did-navigate` commit (`guest-wiring.js:530-548`) main
copies the observer's entry for the committed URL's hostname onto the tab
entry as `entry.certificate` (or `null` when absent) — the DURABLE copy is
per open tab and travels with the entry on cross-window move; the
per-session cache is a short bridge between verification and commit, and an
evicted host reads "certificate details unavailable — reload to refresh".
`clearPartition` runs on wipe/remove beside DD2's. The cache is keyed by the session's partition string (Burner's included) —
per-jar scope, per the mission.
- Rationale: `certificate-error` carries a certificate only on failure; CDP
  `Security` would be a third debugger client (`cdp.js` rule); a Node
  `tls.connect` re-fetch would be new egress outside the jar's session. The
  verify proc sees every verification, costs one main-process hop per
  verification (cached by the network service per its own docs), and
  changes no trust decision.
- Trade-off: a security-sensitive hook whose whole safety rests on "always
  -3" — hence the source-scan pin and the try/finally shape. Premises (a),
  (b), (f) in the leg-1 spike.

**DD7 — Security state: top-frame committed origin, observation-first.**
At each main-frame `did-navigate` main computes `security` for the
committed URL: `internal` for a trusted entry; `none` for `about:blank`/
unparseable; `insecure` for non-`https:`; for `https:`: `overridden` if the
observer's entry for the hostname reports a non-`OK` verification (the load
succeeded despite an error → an override let it through), else — when no
observer entry exists — `overridden` if `entry.certOverride` matches the
committed host:port (decision fallback), else `secure`. The value rides the
existing `tab-did-navigate` push (`{ wcId, url, security }`,
`guest-wiring.js:538`; the chrome handler at `renderer.js:1532-1546` stores
`tab.security`), the adopt-time re-push (F1 DD8) and `listTabs`. In-page
navigations keep the state (same origin by definition); a redirect chain
resolves at its final commit; subframes never change it (accepted
divergence: Chrome downgrades for overridden subresources); a failed or
cert-blocked tab has `security: none` (the chip stays in Flight 1's
scheme-derived web state); `certOverride` clears at the next non-error
main-frame `did-start-navigation`.
- Rationale: the mission fixed the unit (top frame); observation-first means
  a server that fixed its certificate mid-session reads `secure` on the next
  verification instead of "not secure until quit".
- Trade-off: a hostname evicted from the observer AND overridden earlier in
  the session falls to the decision path — correct in every case except the
  fixed-mid-session one, which then reads `overridden` until quit.

**DD8 — One "not secure" vocabulary, chip and popup.** The chip's
`data-secure` attribute (`navigation-controller.js:69-75`,
`styles.css:511-524`) becomes `data-security="secure|insecure|overridden|
internal|none"` (the two existing CSS rules re-key; nothing else reads it —
only a 2026-07 run log mentions it). `updateAddressChip` reads
`tab.security` when present and falls back to the scheme rule otherwise
(pre-push tabs, failed tabs). `insecure` and `overridden` share the broken
lock SHAPE (not colour alone) and the aria-label suffix "not secure";
`overridden` adds "— certificate error overridden" to the label and a
distinct title. `deriveSiteInfo(tab, internal)` (`site-info.js`) reads `tab.security`
and returns `connection` as one of: "Secure (HTTPS)", "Not secure (HTTP)",
"Not secure — certificate error overridden (HTTPS)", plus a new boolean
`showCertificate` = `tab.security ∈ {secure, overridden}` OR
`tab.loadFailure?.cert` truthy — both already held SYNCHRONOUSLY by the
chrome record (DD7 push / F1 push), never the async `tab-certificate-get`
read. `siteInfoModel` (`overlay-menus.js:176-186`) gains exactly one
conditional push of `{ type: 'action', id: 'certificate', label:
'Certificate' }` before the `site-settings` action when `showCertificate`
is true (its return TYPE is unchanged — the same row/action item shapes the
`info-popup` template already renders, `menu-overlay.js:498-542`).
- Rationale: the mission's criterion 4 delta, Chrome-parity words.

**DD9 — Certificate viewer: a read-only `cert-viewer` sheet card fed by a
main-computed summary.** `src/main/certificate-summary.js` (pure,
`node:crypto` `X509Certificate` over Electron's `certificate.data` PEM, with
Electron's own principal fields as the fallback when parsing fails) builds
`{ subject: {...}, issuer: {...}, validFrom, validTo, serial,
fingerprints: { sha256, sha1 }, san: string[] (capped at 25 + "+N more"),
chain: [{ subject, issuer }] (depth capped at 10), status: 'trusted' |
'untrusted' | 'overridden', error?: string, knownRoot: boolean }` — strings
only, every field capped, no PEM leaves main. The chrome reads it by a
chrome-trust bare `ipcMain.handle('tab-certificate-get', { wcId })`
(`requireChrome` + the F1 `ownsTab` check, the `tab-history-snapshot`
precedent at `register-tab-ipc.js:367-379`) which returns
`entry.loadFailure?.cert?.summary` (status `untrusted`) or
`entry.certificate` (status `trusted`/`overridden` per DD7) or `null`.
`src/shared/cert-viewer-template.js` renders rows via `textContent` in a
scrollable card (`menu-overlay.css` max-height + `overflow-y` idiom, `:90`);
Escape/Close dismiss. Opened from the popup's `certificate` action and the
interstitial's `#load-failure-view-cert`.
- Rationale: the sheet already hosts the site-info popup the viewer sits
  behind; read-only text is exactly what the automation allowlist admits
  (DD10). Node's X.509 parser gives SANs and hex fingerprints Electron's
  structure lacks, at zero dependencies.

**DD10 — Automation allowlist: `site-info` and `cert-viewer` become
readable; `cert-override` never.** `AUTOMATABLE_MENU_TYPES` (`resolve.js:53`)
gains `'site-info'` and `'cert-viewer'` — both display-only, non-secret
models — so the three read ops (`readDom`, `readAxTree`,
`captureScreenshot`) can observe them; every other op stays refused on the
sheet, and `cert-override` stays out of the set. Pinned by
`automation-resolve.test.js` + `sheet-automation-gate-invariant.test.js`
(add the negative). No new MCP tool; the census field is the only new
agent-facing surface.
- Rationale: the acceptance run must read the popup and the viewer; the
  M15 F3 rule ("allowlist on both halves") admits exactly this.

**DD11 — Chrome ownership and the line budgets.** New
`src/renderer/chrome/site-security-controller.js`
(`createSiteSecurityController({ document, els, bridge, activeTab,
findTabByWcId, openOverlayMenu, siteInfoModel, updateAddressChip })`) owns:
the chip trigger listeners (moved from `renderer.js:924-935`),
`openSiteInfoOverlay`/`siteInfoAnchor` (`:700`, `:781`), the viewer and
override openers, the `tab-certificate-get` read, and `handleActivation`/
`handleClosed` for `site-info`/`cert-viewer`/`cert-override` chained ahead
of the generic dispatch (the `vaultController`/`downloadsController`
precedent, `renderer.js:950`). The interstitial's two new buttons call the
controller's openers through injected callbacks (`load-failure-controller.js`
gains `onViewCertificate`/`onAdvanced` deps). Leg 1 first EXTRACTS the
`open*ForAudit` hook family (`renderer.js:789-866`, `:1390-1428`,
`:1497-1515` — ≈90 lines) into `src/renderer/chrome/audit-hooks.js`
(`createAuditHooks({ openOverlayMenu, ... })`); the seam tail republishes
the same names, so `SEAM_COUNT` and the a11y audit are untouched by the
move. `RENDERER_LINE_BUDGET` is LOWERED to the measured post-extraction
count in leg 1 (≤ 1770 is a conservative floor — ≈90 hook lines + ≈25
site-info lines leave; leg 1 pins whatever Prettier measures, not the
estimate) and this flight's glue must fit under it
(construction + chaining, ≤ 12 lines). The two new audit hooks
(`openCertViewerOverlayForAudit`, `openCertOverrideOverlayForAudit`, in
`audit-hooks.js`, synthetic models) plus ONE behavior-spec-driven opener,
`openCertificateViewer()` (the controller's real-model opener for the active
tab — the only automation-reachable route to a TRUSTED page's viewer, since
the popup's Certificate action lives on the sheet; the M16 F2 L1 `openNewTab`
precedent) carry `SEAM_COUNT` 36 → 39 (FD ruling; CLAUDE.md seam note
updated in lockstep). Squawk 0077's shared fake-DOM harness
(`test/unit/helpers/fake-dom.js`) lands in leg 1 and every chrome-controller
test in this flight imports it.
- Rationale: zero headroom (1857/1858) — the extraction is the price of any
  glue; the audit hooks are the cheapest large block with no behaviour.
- Trade-off: `renderer.js` still owns the generic dispatch switch; a fuller
  extraction is a later maintenance item.

**DD12 — #216 is diagnosed first and fixed in this flight.** Leg 1's spike
instruments main with `webContents.on('focus'|'blur')` on the chrome, the
guest, the sheet, and `win.on('focus'|'blur')`, logging `Date.now()` and
`BaseWindow.getFocusedWindow()?.id` for (i) a typed navigation that FAILS
(`http://127.0.0.2:{P}/`) and (ii) a typed navigation that SUCCEEDS, on the
live rig. Hypotheses, in order: (H1) `wc.loadURL()` itself focuses the
navigating guest at navigation START (the 7 ms blur in #216's log precedes
`did-fail-load` at ~30 ms and any commit); (H2) the outgoing document; (H3)
the `chrome-error:` commit. Fix shapes, chosen by finding: for H1, main
re-asserts chrome focus immediately after `loadURL` in the `tab-navigate`
handler when the SENDER chrome held focus at the call (chrome-initiated
navigations arrive only on this channel; the success path's guest focus
still arrives through `pendingFocusGuest` → `tab-focus-guest`,
`navigation-controller.js:186-217`); for H2/H3, a main-side chrome-`blur`
listener re-asserts while the entry is in the "chrome-initiated navigation
pending" window (armed at `tab-navigate`, disarmed at `did-navigate`/
`did-fail-load`). Either shape is unit-pinned on the F1 `FakeContents`
harness and the speculative `did-finish-load` reassert from F1 is removed
if the finding makes it dead. Acceptance: (a) the trace shows the chrome
`isFocused()` after a typed failure; (b) HAT step re-verifies F1's H7 by
eye (ring on Retry after Tab); (c) F1's spec step 8 still passes. If the
spike shows the theft is not app-addressable (e.g. the ozone backend), the
leg records the finding, keeps #216 open with the trace attached, and the
flight continues — the interstitial's keyboard path is then verified at HAT
with a mouse click first (documented degradation).
- Rationale: the debrief's first recommendation; a stranded-focus security
  surface would be worse than a stranded-focus error page.

**DD13 — Verification apparatus (act + observe audited).**
- *Act*: MCP `openTab`/`navigate` to fixture URLs; admin `evaluate` on the
  chrome wcId to click `#load-failure-view-cert`, `#load-failure-advanced`,
  and `openSiteInfoOverlay()` (the a11y audit's drive idiom); `pressKey`
  for the keyboard row; **one operator-performed row** for the proceed
  click (the sheet is refused to every op by design, DD3) — the run pauses,
  the operator clicks, the Executor observes post-state; closing a sheet the
  crew cannot press Escape in uses `activateTab` to another tab (main's
  `tab-switch` close) and back.
- *Observe*: `captureScreenshot(chromeWcId)` for rendered chrome state (the
  F1 ruling — `captureWindow` paints the hidden guest, squawk 0075);
  `readAxTree(chromeWcId)` for the panel and chip labels; `enumerateWindows`
  for `sheetVisible`; `readAxTree(sheetWcId)` for `site-info`/`cert-viewer`
  (DD10) and its REFUSAL for `cert-override` (the refusal is itself the
  assertion that proceed is not automatable); `enumerateTabs` for
  `loadState`/`loadError`/`security`/`url`; `readDom` of the loaded fixture
  page (`#auth-state`) after proceed; `openssl x509 -fingerprint -sha256`
  in the shell for the viewer's fingerprint row.
- Read paths cited: `tabs.js:41-66` (+ `security`), `enumerateWindows` rows
  (`sheetWcId`, `sheetVisible`), `resolve.js:210-214` (sheet gate).

**DD14 — Fixtures: the existing throwaway CA, plus a second CA the rig
trusts.** Untrusted rows use `serve-tls.mjs --port {T}` as F1 did
(`ERR_CERT_AUTHORITY_INVALID`; the app launched WITHOUT
`--insecure-tls-fixtures`, which appends `--ignore-certificate-errors` and
would suppress the event — `scripts/insecure-tls-flag.mjs`). Trusted rows
need a certificate Chromium accepts with no network: `gen-certs.mjs` gains a
SECOND throwaway CA + server cert (`trusted-ca.pem`, `server-trusted.pem`,
same 7-day validity, gitignored), `serve-tls.mjs` gains `--cert-set
trusted`, and a new `import-trust-anchor.mjs` (beside
`import-client-cert.mjs`, same `certutil`/`~/.pki/nssdb` precheck) installs
and removes that CA as a trust anchor (`certutil -A -t "C,,"` / `-D`) —
imported BEFORE launch, removed at teardown. Premise (g) in the leg-1
spike: Electron 44 on Linux honours NSS user trust anchors. Fallback if it
does not: the trusted rows run against ONE external host (operator-
confirmed network; skippable and noted in the run log), and the mission's
"no external hosts" note gets an amendment.
- Rationale: `certutil` is present (`libnss3-tools`), the NSS helper pattern
  exists, and a second CA keeps the untrusted and trusted states
  simultaneously reachable with no mid-session trust-store change.

**DD15 — a11y audit states.** `scripts/a11y-audit.mjs` gains a
`cert-blocked` chrome state driven by `navigate('{tls-url}')` when
`--tls-url=` is passed (skipped with a printed notice otherwise — the TLS
fixture needs a second process); the two new sheet hooks are recorded in
`SHEET_STATES` (skipped by the standing M15 F3 ruling, like every sheet
state). With squawk 0074 completed first (prerequisite), the audit AC is
**exit 0**, not "zero new findings".

**DD16 — Frozen contracts (this flight).** The Flight 1 panel contract
(F1 DD10) plus `#load-failure-view-cert`, `#load-failure-advanced`; the chip
`data-security` values and aria-label suffixes; `cert-override` and
`cert-viewer` menuTypes and their template row roles; the census
`loadState: 'cert-blocked'` and `security` values; the `tab-did-navigate`
payload's `security` field; `tab-certificate-get`'s summary shape. Read by
this flight's spec, the audit, and the unit pins — a HAT change to any of
them is a spec re-author.

### Prerequisites

- [x] PR #215 (Flight 1) merged to `main` (2026-09-15); the flight branch
      `flight/02-tls-trust` is cut from `main` after the merge.
- [ ] Squawk turnaround completed and merged before leg 1: **0074**
      (`#bookmarks-bar` region → `ACCEPTED`) and **0076** (crew-protocol
      escalation on a false `document.hasFocus()`) via
      `/mission-control:squawk complete 0074 0076`.
- [ ] Live rig launchable (`GOLDFINCH_AUTOMATION_ADMIN=1
      GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, WSLg, ozone
      wayland — `scripts/dev-launch.mjs`); the admin key by env-var reference
      only.
- [ ] `openssl` (3.0.13) and `certutil` (`libnss3-tools`) present —
      verified 2026-09-15 (`/bin/openssl`, `/bin/certutil`). `xdotool` is
      absent and unusable under wayland; nothing in this flight depends on it.
- [ ] Fixture certs generated (`node tests/behavior/fixtures/web-compat/gen-certs.mjs`)
      — regenerated after leg 3 extends the generator.
- [ ] Free fixture ports chosen by bind-probe at run time; `127.0.0.2` as the
      refusing loopback for the #216 row (F1 run finding); MCP port left alone.
- [ ] Leg-1 spike recorded in the flight log before leg 2 starts:
      (a) `setCertificateVerifyProc` fires for a trusted `https:` main-frame
      navigation with `verificationResult: 'OK'` and a `certificate` whose
      `issuerCert` chain is populated; (b) for the throwaway fixture the proc
      reports `ERR_CERT_AUTHORITY_INVALID` and `certificate-error` follows
      with `isMainFrame: true`; (c) whether `certificate-error` refires on a
      second navigation to the same origin after `callback(true)`;
      (d) `preventDefault()` + `callback(false)` yields the same
      `did-fail-load` name/code as the default path; (e) after `callback(true)`
      the page commits and its same-origin subresources load; (f) whether the
      proc fires again on a repeat navigation (network-service caching) —
      informs DD6/DD7's fallback; (g) an NSS user trust anchor imported
      before launch makes the second fixture CA trusted (DD14); (h) the #216
      focus trace for typed-fail and typed-success (DD12); (i) which
      `ERR_CERT_*` Chromium reports for `https://localhost:{T}/` (SAN
      mismatch under an untrusted CA) — fixes the spec's step 14.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified (PR #215 merged; the squawk turnaround and the leg-1 spike remain)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

1. **Substrate first (leg 1)** — the focus trace and #216 fix; the
   `audit-hooks.js` extraction and the `site-security-controller.js` seed;
   the shared fake-DOM harness (0077); the Electron premise spike (a)–(h)
   logged; budgets re-pinned.
2. **Trust decisions (leg 2)** — `load-failure.js` cert kinds +
   `CERT_BLOCKED`; `site-security.js`; `cert-trust.js` (+ app-lifecycle
   registration, wipe/remove clears); `cert-observer.js` (+
   `session-runtime.js` install); `certificate-summary.js`; entry stamps in
   `guest-wiring.js` (`certFailure` fold at `did-fail-load`, `certificate` +
   `security` at `did-navigate`, clears at `did-start-navigation`); the
   `tab-did-navigate` payload growth + adopt re-push; the interstitial branch in `load-failure-controller.js` (+ CSS; Retry only — the View certificate button lands with the viewer in leg 4, Advanced with the card in leg 3); census fields; preload/typing;
   allowlist; `docs/mcp-automation.md`; `scripts/insecure-tls-flag.mjs`'s
   header comment ("no `certificate-error` handler") refreshed.
3. **The proceed leg (leg 3)** — the `cert-override` template + sheet
   entry, the `#load-failure-advanced` button, the four-guard proceed
   invoke, navigation-away close, the negative automation pins.
4. **Presentation and apparatus (leg 4)** — chip `data-security` + labels;
   `deriveSiteInfo` vocabulary + `certificate` action; `cert-viewer`
   template + `tab-certificate-get`; controller growth + audit hooks (SEAM
   38); a11y `cert-blocked` state; fixture generator/server/trust-anchor
   helper; the `tls-trust-surface` Witnessed run + `npm run a11y`;
   README/CLAUDE.md (the named guest-slot panel pattern, the TLS trust
   section, the seam note).
5. **HAT (leg 5, optional, elected)** — interstitial copy and feel, proceed
   by hand, chip/popup/viewer on all three states, #216 re-verification.

### Checkpoints

- [ ] CP1 — Spike (a)–(i) logged; #216 root cause named and fixed (or
      documented as not app-addressable); `renderer.js` under its new budget
- [ ] CP2 — Model + trust wiring landed; the fixture navigation shows the
      interstitial with `ERR_CERT_AUTHORITY_INVALID`; census `cert-blocked`
- [ ] CP2b — Proceed leg landed: four guards unit-pinned each failing alone;
      no chrome channel can add an override; a hand-clicked proceed loads
      the page and the origin is remembered
- [ ] CP3 — Chip/popup/viewer render all three states on the live rig;
      a trusted fixture page reads `secure` with a populated viewer
- [ ] CP4 — `tls-trust-surface` behavior run: pass (operator row included);
      `npm run a11y` exit 0 with the `cert-blocked` state
- [ ] CP5 — HAT walk complete; flight `landed`

### Adaptation Criteria

**Divert if**:
- `certificate-error` does not fire for the fixture on Electron 44, or
  `callback(true)` does not let the page commit — the override model's
  premise is wrong; re-plan before leg 2's chrome work.
- `setCertificateVerifyProc` never observes a trusted page's certificate
  (spike (a)) — the viewer needs another source; re-plan DD6 (candidates:
  event-only viewer for failed pages + "unavailable" for trusted, or a
  scoped CDP `Security.getCertificate` read routed through `cdp.js`).
- The proceed card cannot be made unreachable to admin ops without a new
  refusal shape in `resolve.js` — re-plan DD3 with the operator.
- The #216 fix requires changing the M17 F1 chrome↔guest handoff model —
  escalate; it is a separate flight.

**Acceptable variations**:
- Copy edits and kind-table additions in `classifyCertError`.
- The observer cap (256) and the SAN/chain caps.
- The trusted rows running against an external host if (g) fails (noted).
- Skipping the a11y `cert-blocked` state on a run where no TLS fixture is
  up (the script prints the skip).
- The `did-finish-load` reassert from F1 kept or removed per the spike.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned
> and created one at a time as the flight progresses. This list will evolve
> based on discoveries during implementation.

- [ ] `focus-trace-and-surface-substrate` — spike (a)–(h) on the live rig;
      the #216 diagnosis and fix with its unit pin; `audit-hooks.js`
      extraction and the `site-security-controller.js` seed (site-info glue
      moved, behaviour unchanged); shared fake-DOM harness (squawk 0077,
      completed by this leg); `RENDERER_LINE_BUDGET` lowered to the measured
      count. Ends with a typed failed navigation keeping keyboard focus in
      the panel (trace-verified main-side) and every existing test green.
- [ ] `certificate-trust-and-interstitial` — shared models, `cert-trust.js`
      (refuse-or-remember; `allow` exists but has NO caller yet),
      `cert-observer.js`, `certificate-summary.js`, entry stamps and pushes,
      the interstitial branch (cert copy + code line; Retry only — View certificate arrives with leg 4's viewer, Advanced with leg 3's card),
      census fields, allowlist, MCP docs; unit tests for every link plus the
      grep-ACs (single `callback(` site; only `-3`; no persistence imports;
      snapshot/closed-tab object-shape pins). Ends with the fixture
      interstitial live and the census reporting `cert-blocked`.
- [ ] `override-card-and-proceed` — the `cert-override` template + sheet
      entry, `#load-failure-advanced`, the four-guard
      `menu-overlay:cert-override-proceed` invoke (the flight's one
      security-decision channel — its own design review), the single
      `allow(` call site, navigation-away close, the negative automation
      pins (`cert-override` refused to every op at every tier; no chrome
      preload method). Ends with a hand-clicked proceed loading the fixture
      page and a second tab to the origin loading directly.
- [ ] `security-indicator-and-certificate-viewer` — chip states + vocabulary,
      popup rows + action, `cert-viewer` template + read invoke, controller
      growth + audit hooks (SEAM 39), a11y state, fixtures (second CA,
      `--cert-set`, trust-anchor helper), README/CLAUDE.md; runs
      `tls-trust-surface` and `npm run a11y` as its acceptance gate.
- [ ] `hat-and-alignment` *(optional, operator-elected)* — guided walk: the
      interstitial for authority/name/date errors, View certificate,
      Advanced → Back to safety, Advanced → Proceed, the overridden chip and
      popup, a plain-`http:` page, the trusted fixture page and its viewer,
      keyboard-only reach of every panel action and of the card, a second
      window / a second jar, and the #216 re-check (F1's H7); inline fixes;
      contract changes (DD16) are spec re-authors.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`, `npm run a11y` exit 0)
- [ ] Documentation updated (`docs/mcp-automation.md`, README, CLAUDE.md —
      named guest-slot panel pattern, TLS trust section, seam note)

### Verification

- Behavior spec `tests/behavior/tls-trust-surface.md` — run via
  `/mission-control:behavior-test tls-trust-surface`; verdict `pass`,
  including the operator-performed proceed row and the trusted-fixture rows
  (or their external-host fallback, noted).
- Behavior spec `navigation-failure-surface` re-run: pass (regression net for
  the F1 surface and the #216 fix's F6/Tab row).
- `npm run a11y -- --tls-url=https://127.0.0.1:{T}/` exit 0 with the
  `cert-blocked` state.
- Unit: `classifyCertError` truth table + overridable table +
  `CERT_BLOCKED`; `deriveSecurityState` truth table; `cert-trust` (exactly-
  once callback under throw, remembered-vs-refused, key shape, popup
  routing, non-main-frame no-stamp, `clearPartition`); `cert-observer`
  (LRU cap/eviction, always `-3`, never throws); `certificate-summary`
  (parse of an embedded test PEM, fallback on garbage, caps);
  `guest-wiring` (cert fold at `did-fail-load`, `certificate`/`security`
  at `did-navigate`, clears); `register-overlay-ipc` proceed handler
  (sheet-sender only, token, overridable gate, entry-derived key, loadURL
  issued); `automation-resolve` (`site-info`/`cert-viewer` admitted,
  `cert-override` refused); `mapEnumeratedTabs` `security`; chip/popup
  vocabulary in `site-security-controller.test.js`; interstitial branch in
  `load-failure-controller.test.js` (on the shared harness); #216 fix pin;
  `seam-contract` (SEAM 39, budgets); grep-ACs listed in DD1/DD2/DD6.
- Mission criteria 3, 4, 5 checked off in `mission.md` at landing; criterion
  10's cert-blocked/security census half and the #216 Known Issue closed
  (or the Known Issue updated with the trace if not app-addressable).
