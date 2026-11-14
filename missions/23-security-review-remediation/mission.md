# Mission: Security Review Remediation

**Status**: active

> Architect viability check: **feasible with caveats** (2026-11-12). Caveats incorporated into Success Criteria, Constraints, Open Questions and the flight list. Operator ruling: one mission, gated — a go/no-go checkpoint follows Flight 1, and Flights 2 and 3 are scoped only after Flight 1's audit and re-verification land.

## Outcome

Every finding from the 2026-11-12 whole-project security review ends in one of two states: fixed and pinned by a test, or accepted with a written reason. After this mission a hostile page cannot reach a privileged main-process handler, cannot extract a saved card or identity through a prompt it raised itself, and cannot act through another cookie jar; an automation key of any tier cannot read vault plaintext; and an operator running an old copy of Goldfinch is told that a newer one exists and can verify what they download.

## Context

A read-only review on 2026-11-12 (v0.19.13, HEAD `8e2313f`) covered five surfaces with parallel auditors: the web-content boundary, the chrome IPC and renderer layer, the MCP automation server, the password vault, and supply chain / build / data at rest. Nothing was run live. Four audits completed; the **web-content boundary audit was cut off** mid-report, so navigation guards, permission handlers, popups and TLS trust have only partial coverage.

**Mission 13 (Web-Content Security Hardening) already claimed sender validation on every chrome-trust IPC channel.** Handlers added since then shipped without it. The lesson is that a one-time sweep does not hold: this mission needs a structural guard that goes red when a new unclassified handler appears.

Verification labels: **[V]** = the Flight Director read the cited code; **[A]** = auditor's trace only, to be re-verified at flight design.

### Critical / high

1. **Chrome-trust handlers with no sender check, reachable from a guest page.**
   - [V] `app-quit` (`src/main/app-lifecycle.js:323`), `vault-fill-human` / `vault-reachable-items` (`src/main/main.js:2541-2551`), `open-downloaded-file` → `shell.openPath` (`src/main/register-download-ipc.js:143`) ignore `event.sender`.
   - [A] Same shape: `download-media`, `choose-download-dir`, `show-item-in-folder`, `reveal-downloaded-file`; `settings-get` (returns automation key hashes), `shields-set`, `shields-pause`, `chrome-clipboard-write`, `unpin-toolbar-item`, `toggle-bookmarks-bar`, `chrome-welcome-set`; `vault-lock`, `vault-lock-state-get`, `vault-automation-held-get`, `vault-capture-dismiss`; all six bookmark channels; bare `jars-*` / `history-*` twins of the gated `internal-*` handlers.
   - [A] Two auditors independently reported the guest preload's `ipcRenderer` is reachable by prototype tampering under `contextIsolation:false`: via the `for (const c of plan) ipcRenderer.send(c.channel, c.payload)` loop ([V] exists at `src/preload/webview-preload.js:606`) and via Electron's own sandbox-bundle event emit. Neither route was executed.
2. **Page-raised vault picker leaks a card or identity on one stray keypress.**
   - [V] The `isTrusted` getter lookup on `Event.prototype` (`src/preload/webview-preload.js:324`) yields nothing in Chromium, so `readTrusted` (`src/preload/vault-fill-icon.js:387`) trusts whatever object it is handed; the handler is attached with a page-patchable `addEventListener` (`:466`); `guest-vault-gesture` (`src/main/register-browser-ipc.js:174`) forwards with no active-tab check or rate limit.
   - [A] The picker opens focused on row 0 with no arming delay and no destination origin shown; card/identity rows are not origin-gated; the fill payload crosses the page main world through a page-replaceable `JSON.stringify` (`src/preload/vault-entry-tracker.js:157`). A background tab may raise the picker over a foreground checkout.
3. **No update mechanism.** [V] No updater and no in-app update check; Electron pinned at `44.10.0`. [A] The 44 line is at 44.11.3 with five security-backport rounds since.

### Medium

4. **Media proxy breaks jar isolation.** [V] `toMediaProxyUrl` (`src/shared/media-proxy.js:70`) returns non-http(s) input unchanged, including a page-supplied `goldfinch-media://proxy/<wcId>/…`; the handler (`src/main/media-proxy-handler.js:44-58`) fetches through whichever tab the URL names. [A] `file://host/share` variant leaks NTLM on Windows.
5. **MCP admin key reads all vault plaintext.** [V] `internal-vault-reveal` (`src/main/register-vault-ipc.js:215`) is gated on internal origin + session only, which an admin `evaluate` in any open `goldfinch://` tab satisfies. [A] Same route reaches `jarsCookiesValue`, `internal-settings-set`, key minting; a chrome-view `evaluate` can call `vault-fill-human`.
6. **Download filename spoofing ahead of a one-click Open.** [A] Page-derived `suggestedName` beats Chromium's sanitised name; `sanitizeFilename` (`src/main/download-path.js:46-82`) passes bidi overrides and reserved device names; no dangerous-type confirmation before `shell.openPath`; ellipsis can hide the real extension.
7. **Release artifacts are unverifiable.** [A] Unsigned on macOS and Windows; no checksums, signatures or provenance; releases mutable.
8. **Local hardening.** [A] No Electron fuses flipped (RunAsNode, NODE_OPTIONS, inspect arguments all enabled); cookies plaintext at rest; `asar:false` with no integrity check.

### Low

9. [V] History title update has no `jar_id` (`src/main/history-store.js:167`); row ids are reused after a clear → cross-jar title overwrite.
10. [V] Download Retry re-requests through the default session (`src/main/register-download-ipc.js:229`); records carry no jar.
11. [V] A jar-map key named `admin` resolves to the admin tier (`src/main/automation/automation-auth.js:97`); the `automationKeyHashes` validator checks values only; `internal-settings-set` accepts any key.
12. [A] Vault file integrity: KDF parameters in `manager.json` are unauthenticated and survive the recovery re-wrap (downgrade); no vault id or freshness in any AAD (cross-jar file swap, rollback).
13. [A] Vault lifecycle: no lock on suspend / screen lock; TOTP polling re-arms the idle timer; recovery-key copy never cleared from the clipboard; item-copy clear not flushed at quit; access-key revocation and master change do not re-key.
14. [A] Opaque origins collapse to the string `"null"` for capture and fill; capture values are re-plannable in the page main world between isolated read and IPC; fill ignores a clicked-through certificate override.
15. [A] Spoofing: uncapped HTTP auth realm in the sign-in card; address bar shows raw userinfo and long-subdomain URLs; client-cert picker and cert dialogs open with a live default and no input delay.
16. [A] Denial of service: unbounded history search tokens and unbounded `pushState` recording on the main thread; MCP session slots never expire (64 global); unbounded strings in the automation audit ring.
17. [A] MCP: fixed default port with silent fallback lets a local process capture the bearer key; a jar-scoped `pressKey` reaches app-global shortcuts; fill-then-`evaluate` lets a key holder read a filled password (documentation gap).
18. [A] Release workflow: `v*` tags unprotected; the `build` job holds `contents: write` on all runners while `npm ci` runs install scripts with persisted credentials; Concourse images unpinned; Windows build runs on a host said to hold a signing certificate.
19. [A] Packaged build honours `--remote-debugging-port`, `--inspect`, `--ignore-certificate-errors`, `--no-sandbox`, `--disable-web-security`.
20. [A] Dependencies: two moderate runtime advisories via the MCP SDK's transitive deps (not reachable as wired); 11 moderate in the full tree.
21. [A] File modes rely on the 0700 `userData` parent; vault files, exports and `app.db` are written 0644.
22. [A] Guard gaps not reachable today: several sheet channels lack the menu-type guard CLAUDE.md claims; non-guest views' navigation guard admits `file:` / `goldfinch:`; `tab-create` does not re-validate main-side.

### Found sound — do not re-litigate

Vault cryptography primitives and key hierarchy; login origin matching; MCP Origin/Host guard, key generation and comparison, jar scoping, dev-mode gates in packaged builds; absence of HTML/script injection into privileged renderers; SQL parameterisation; internal-page bridge and route map; session restore trust; Actions SHA pinning; lockfile integrity; no secrets in tree or history.

### Operator decisions taken at planning (2026-11-12)

- **Updates**: notify only — the app tells the operator a newer release exists; no in-app download or install. The check is **on by default with a setting to turn it off**.
- **Release integrity**: no signing certificates — checksums, build provenance, protected tags, immutable releases.
- **MCP admin tier**: close it — no automation tier reads vault plaintext or cookie values. Approach: **handler-side human confirmation on reveal, held main-side** (automation cannot supply it); admin automation of internal pages otherwise keeps working, including the a11y audit. Refusing `evaluate` on all internal tabs was considered and declined.
- **Vault tamper scope**: detect key-derivation downgrade and cross-vault file swap; **rollback to an older copy is a documented limit**, not a goal (any local anchor shares the attacker's reach).
- **Packaging**: one mission, gated after Flight 1.
- **Alignment flight**: none.

## Success Criteria

- [ ] **Coverage is complete before fixes are designed**: the web-content boundary (navigation guards, permission handlers, popups, TLS trust, guest-reachable IPC) has a finished audit on record, and every `[A]` claim this mission acts on has been re-verified against the code or reproduced. New findings are added to this mission's Context with a severity; a claim that re-verification disproves is struck with a note. **[must-have; gates Flights 2 and 3]**
- [ ] **A web page cannot drive a privileged handler**: every main-process IPC handler either refuses a caller that is not the surface it serves or is recorded as deliberately open with a reason, and a standing guard fails the unit suite when a new handler is added without a classification. Demonstrated against the live app by a guest-originated call to a representative state-changing channel being refused. *(finding 1; behavior-test-backed)* **[must-have]**
- [ ] **A page cannot obtain a saved card, identity or login through a prompt it raised**: a vault fill offer can only arise from a genuine operator gesture on the tab the operator is looking at, cannot be completed by a keypress or click the operator aimed at the page, and shows where the data will go. The gesture is established main-side, never by a check the page can satisfy, and the fill payload never transits a global or prototype the page can patch. (A value the operator chose to fill is readable by that page once it is in the field — inherent to autofill, and stated in the docs.) *(findings 2, 14; behavior-test-backed for the gesture and prompt; the by-eye parts are HAT)* **[must-have]**
- [ ] **Cookie-jar isolation holds on every chrome-initiated request and every history write**: no page-supplied URL causes a request through a session other than the supplying tab's own, a re-download uses the jar it came from, no non-web scheme reaches a chrome fetch, and a page cannot alter another jar's history. *(findings 4, 9, 10; behavior-test-backed for the cross-jar request)* **[must-have]**
- [ ] **A downloaded file's saved name cannot be reordered or disguised by control characters**: a page-suggested name is cleaned of control, bidirectional and zero-width characters before it is saved (replaced, as Chromium does in the names it derives), reserved device names are caught, truncation keeps the extension, and the downloads page opens only a finished download. Confirmation before running a downloaded program is the operating system's (internet-origin mark, SmartScreen, Gatekeeper); whether this build's downloads carry that mark is checked on Windows and macOS at the HAT. *(finding 6)* **[must-have]**
  - *Revised (operator ruling 2026-11-14: slim `downloads` leg).* Original wording, kept as commentary: "**A downloaded file cannot masquerade and is not opened without the operator seeing what it is**: the displayed name always shows the true final extension, cannot be reordered by control characters, and opening an executable-class file takes a deliberate confirmation." The always-visible-extension clause and the in-app executable-class confirmation are not built: the server already controls the name Chromium derives, and the operating system warns before a downloaded program runs.
- [ ] **No automation tier reads vault plaintext or cookie values**, by any route including script evaluated in a privileged page — revealing either takes a human confirmation that automation cannot supply — and the admin tier cannot be obtained without the operator's explicit gate. The automation and vault documentation state exactly what each tier can reach, including what a key holder can read back from a page it filled. *(findings 5, 11, 17; behavior-test-backed)* **[must-have]**
- [ ] **A vault file tampered with on disk is detected rather than silently weakening or cross-wiring vaults**: altered key-derivation parameters and a file moved between vaults are each refused or surfaced (replacement by an older copy of the same vault is a documented limit); existing vaults keep opening after upgrade with no operator data loss; the vault locks when the machine suspends or the screen locks; no secret outlives its purpose on the clipboard. *(findings 12, 13, 21)* **[tamper detection and lock-on-suspend must-have; re-keying on revocation and file modes may be accepted]**
- [ ] **Trusted prompts cannot be made to say or do the attacker's thing**: site-supplied text in browser-voice dialogs is bounded and visibly attributed, the address bar always shows the real registrable domain, security-relevant dialogs ignore input that arrives before the operator could have read them, and no page- or key-holder-supplied input can stall the main process or exhaust a shared limit. *(findings 15, 16)* **[may be accepted per item]**
  - *Note 2026-11-14 (operator ruling, leg `prompts-and-bounds`) — prompts.* Built: the sign-in realm cleaned and capped in main (control/format characters and double quotes removed, 120 characters); `user:pass@` removed from the address bar (what the chrome is shown) and from history; the client-certificate picker opens with nothing selected and ignores activation for 500 ms. Accepted per item, not built: arming for the sign-in card and for the certificate-error Proceed (not a stray-Enter commit in the way the picker was); refusing `user:pass@` URLs (intranet devices authenticate that way, and with the credentials removed the bar shows the real host); eliding long subdomains so the registrable domain stays in view (needs display code in `renderer.js`, which has no headroom, for a spoof that is not credentials-based).
  - *Note 2026-11-14 (operator ruling, leg `prompts-and-bounds`) — main-thread bounds.* Built: titles capped at 512 characters and written at most once per second per tab (the last title always lands); addresses over 8,192 characters not recorded; history search capped at 256 characters and 16 tokens. Accepted per item, not built: a rate limit on in-page navigation recording (Chromium already throttles it to about 20 events per second; the address cap and duplicate suppression bound the rest); pinning the browser's own views to their document URL (nothing reaches a navigation there, and script in those views would already hold stronger access). The MCP session and audit bounds remain Flight 2.
- [ ] **An operator on an old build finds out, and can verify what they install**: the running app reports when a newer release exists (on by default, operator can turn it off; nothing is downloaded or installed automatically; the request identifies neither operator nor profile); each release publishes checksums and build provenance and cannot be altered after publication; only a protected tag on reviewed history can produce a release; the build's write credentials are not exposed to dependency install scripts. The docs state plainly that unsigned builds still trigger OS warnings. *(findings 3, 7, 18, 20)* **[must-have]**
- [ ] **Every finding 1–22 has a recorded disposition and the regression net is green**: each is fixed-and-pinned or accepted-with-reason in this mission's artifacts (runtime fuses that do not depend on packaging format are expected to be fixed; code-on-disk integrity under `asar:false`, cookies at rest, command-line switches and finding 22 — findings 8, 19, 22 — may land as acceptances, but not silently); every CLAUDE.md and `docs/` claim that a finding names as false is corrected or made true; `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check` pass at mission end.

## Stakeholders

- **Browser operator** — saved cards, identities, logins and per-jar sessions are not reachable by a page or an automation key; learns when their build is out of date.
- **Project maintainer** — the review closes with one disposition per finding; the sender-check gap cannot silently reopen; releases are verifiable without buying certificates.
- **Automation users (agents holding MCP keys)** — tier capabilities are stated accurately; the admin tier loses access to vault reveal and cookie values through internal pages.
- **Future auditors** — documented invariants match the code, and the ones that matter are pinned by tests.

## Constraints

- **Web guests stay `contextIsolation:false`.** Farbling needs the preload in the page main world; fixes must assume the page controls every global and prototype the preload touches.
- `isSafeTabUrl` is never widened to admit `goldfinch://`; internal pages stay "internal vs web", never per-page trust — closing admin reach must not introduce per-page privilege tiers by the back door without an explicit design ruling.
- **No vault data loss.** Any vault file-format change migrates existing vaults in place, keeps recovery, export/restore bundles and cross-vault copy working, and has a tested path for a vault written by the previous version.
- No signing certificates and no paid services. No automatic download or install of updates. The update check sends nothing that identifies the operator or profile, and is operator-controllable.
- The renderer evaluate-seam set (41 entries) and the two zero-headroom line budgets change only by Flight Director ruling; a file at budget needs an extraction.
- A change to a shared mechanism (the sheet, focus, the save prompt, live regions) lists every feature sharing it and asserts they are unaffected.
- Snapshot baselines are never committed; behavior specs use DOM-shape and observable assertions.
- Release workflow invariants hold: full-SHA action pins, least-privilege permissions, no lowering of the audit gate.
- The standing handler guard is a registration-shape change (recon census: 214 registrations — 74 internal-wrapped, 79 with a refusing sender check, 46 bare, 2 non-refusing, 13 guest-preload — all moved onto one gate module), not a one-line test; it is budgeted inside Flight 1 and modelled on the existing source-scan invariant tests.
- Closing admin reach must not rely on distinguishing automation-originated script from page script inside the same frame — that distinction is spoofable; the gate lives in the handler.
- The Flight Director never edits source; all code changes go through flight crews.

## Environment Requirements

- Linux/WSL2 dev host, Node ≥ 22, Electron 44 line; `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1` for behavior tests and live smokes (key captured per launch; never the registered `goldfinch-dev` server).
- A local HTTP fixture server for hostile-page behavior specs (cookie-setting origins across two jars, a login/card form page, a basic-auth endpoint).
- Local Concourse for pre-push checks; `gh` with repo-admin rights for tag protection and release settings (operator performs or approves repository-settings changes).
- Windows- and macOS-only behaviors (UNC fetch, reserved device names, Gatekeeper/SmartScreen, screen-lock events) cannot be exercised on this host; they need a unit-level pin plus an explicit by-eye or deferred note.
- The web-content audit re-run may need a different model than the one that was interrupted.

## Open Questions

- Does a guest page actually obtain `ipcRenderer` (send and/or invoke) on Electron 44.10.0? **Answered first, by live probe in Flight 1's opening leg.** It decides finding 1's real severity; the sender-check fix does not depend on the answer, but the need for a preload-side defence does.
- Can the vault-fill payload be kept out of the page main world entirely given the isolated-world observer, and what establishes a trustworthy gesture when the page controls the icon's DOM and listeners?
- What form does the main-held human confirmation on reveal take (vault items and cookie values), and how does it stay tolerable for an operator revealing several items in a row? Which other internal-page actions (`internal-settings-set` of automation keys, key minting) need the same gate?
- Vault format: a new manager/vault version with read-both, following the earlier version-bump precedent — which of export/restore bundles, cross-vault copy, compromise rotation, recovery re-wrap and access/admin-key re-wraps must change with it?
- Do the runtime fuses (run-as-node, inspect arguments, node-options) break any dev script or the dev-automation launch? What does cookie encryption do to existing profiles on a host with no keyring?
- Which packaged-build command-line switches can be refused without breaking the documented operator `--enable-features` composition?
- What does the update check contact, how often, and how is "newer" decided for prerelease tags?

## Known Issues

- [ ] Web-content boundary audit was interrupted before delivering its findings — discovered at planning, affects Flight 1 scope.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses. This list will evolve based on discoveries during implementation.

- [ ] Flight 1: **Page containment** — opening leg: live probe of guest reach to the preload's IPC, finish the web-content audit, re-verify claims; sender classification and standing guard for every handler; vault picker gesture, prompt and fill-payload path; media proxy and download session/naming/open; history `jar_id`; spoofing and main-thread bounds. *(findings 1, 2, 4, 6, 9, 10, 14, 15, 16-history, 22)*
- [ ] **Checkpoint**: operator go/no-go after Flight 1 — review the completed audit and re-verified finding list, then confirm or re-scope Flights 2 and 3.
- [ ] Flight 2: **Vault and automation boundary** — admin reach into vault and cookie values; admin-tier gate; vault file authentication, identity binding and rollback with migration; lock on suspend; clipboard; MCP port, session and audit bounds; tier documentation. *(findings 5, 11, 12, 13, 16-MCP, 17, 21)* — separate flight because the vault format change is hard to reverse and needs its own design conversation.
- [ ] Flight 3: **Shipping and at-rest** — update notification; checksums, provenance, tag protection, immutable releases, build-token scope; fuses, switches, cookies at rest and code-on-disk dispositions; dependency bumps; final disposition table and documentation sweep. *(findings 3, 7, 8, 18, 19, 20)* — separate flight because it changes the release pipeline and repository settings rather than app behavior.
