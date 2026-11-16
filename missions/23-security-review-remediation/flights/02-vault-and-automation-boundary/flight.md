# Flight: Vault and Automation Boundary

**Status**: completed
**Mission**: [Security Review Remediation](../../mission.md)

> Architect design review: **approve with changes** (2026-11-14). Incorporated: the key-derivation floor on read dropped and the re-wrap rule narrowed (DD6); upgrade of every vault file in one transaction at unlock as the answer to old-version substitution (Q6); the reveal gate no longer covers the kill switch or revokes, its mark is set by script only and bound to the document's frame (DD2); `admin` handling corrected to what the code already does (DD3); injected-input marking specified across paced sends (DD4); `admin-reach` split in two and the measurements moved to the legs that use them.
>
> Operator go for Flight 2 at the mission checkpoint: 2026-11-14. Operator instruction the same day: the Electron major bump (Dependabot PR #286) is flown inside this flight.

## Contributing to Criteria

- [ ] No automation tier reads vault plaintext or cookie values; the admin tier cannot be obtained without the operator's explicit gate; the docs state what each tier can reach. _(findings 5, 11, 17; behavior-test-backed)_
- [ ] A vault file tampered with on disk is detected rather than silently weakening or cross-wiring vaults; existing vaults keep opening; the vault locks on suspend and screen lock; no secret outlives its purpose on the clipboard. _(findings 12, 13, 21)_
- [ ] No key-holder-supplied input can stall the main process or exhaust a shared limit — the automation half. _(finding 16-MCP)_
- [ ] Every finding has a recorded disposition — this flight's share: 5, 11, 12, 13, 16-MCP, 17, 21, and guard-audit NF2, NF5, NF6, NF11, P4.
- [ ] Finding 3, in part: the runtime moves from Electron 44.10.0 to the current 45 patch. _(the update notification itself stays Flight 3)_

Reconnaissance (2026-11-14, see flight log) classified every item **confirmed-live** except three partials, scoped below. Nothing is retired.

- 5f — chrome-view script calling the vault fill channels: a bare call is already refused by Flight 1's picker context (`src/main/vault/vault-human.js` `requireContext`). Remaining: whether an automation click on the fill icon is witnessed as a real click and mints a context (Q2).
- 12a — key-derivation parameters: already range-checked on read (`src/main/vault/vault-store.js` `validateImportedKdf`). Remaining: see DD6, which finds the downgrade is closed without a format change.
- 11d — the admin tier's gate: launch flag + minted key + automation enabled already required. Remaining: a jar-key map entry named `admin` skips the launch flag (DD3).

---

## Pre-Flight

### Objective

Move Goldfinch to Electron 45 and then close the automation and vault-file side of the security review: an automation key of any tier cannot read a vault secret or a cookie value or grant itself more access without a confirmation only a person at the machine can give; automation input cannot stand in for the operator's click or reach app shortcuts outside its jar; automation's shared limits are bounded; a vault file moved between vaults is refused; the vault locks when the machine does; and secrets do not linger on the clipboard or in world-readable files.

### Open Questions

- [x] **Q1 (answered 2026-11-14: one thing — the Flight 1 probe page no longer obtains the guest preload's IPC object; everything else measured the same; see flight log) — Does anything Goldfinch relies on behave differently on Electron 45.3.2?** Resolved in Leg 1 by the full gate, the store suites on the bundled runtime, and the live re-verification list in DD1. Not answerable from documentation: whether `node:sqlite` changed between the bundled Node 24.18 and 24.22.
- [ ] **Q2 — Is an automation `click` on the vault fill icon witnessed as a real click (minting a picker context)?** Flight 1's own comment at the witness (`src/main/guest-wiring.js`, the `input-event` listener) says an automation click "counts", so the expected answer is yes. Measured as the first step of `automation-input`, on the new runtime, with Flight 1's trace lines.
- [ ] **Q3 — Which app shortcuts does a jar-scoped `pressKey` actually trigger?** Measured as the first step of `automation-input` (`guest-wiring.js` `before-input-event` → `handleChromeShortcut`). Decides DD4's filter.
- [ ] **Q4 — What do `getDisplayMedia` and a burst of script-opened popups do on a web tab today?** (guard-audit P4, NF6.) Measured as the first step of `automation-bounds`. Each becomes a small fix there, a squawk, or a recorded "sound".
- [x] **Q5 (answered 2026-11-14: yes — cancels in milliseconds, resolves with the cancel index, window stays healthy; stacked dialogs cancel only newest-first, so one per window is mandatory; appearance and Windows / macOS unverified → HAT) — Can a native confirmation dialog be raised, left unanswered, and cancelled by main on this host without wedging the window?** Leg 2 design-time probe on WSLg (`dialog.showMessageBox` with an `AbortSignal`). DD2 rests on it; the existing precedent (`src/main/vault/browser-import-flow.js`) awaits a dialog but never cancels one. Electron's `MessageBoxOptions.signal` exists in the installed typings ("behave as if it was cancelled by the user"); its behaviour on WSLg is unverified.
- [x] **Q6 — After a vault is rewritten in the new file version, what stops an old-version file being put in its place?** → DD6: every vault file in the profile is upgraded together at the first unlock, so no old-version file of *another* vault remains to be moved; an old copy of the *same* vault is the rollback limit the mission already accepts. A marker in the plain manager file was considered and rejected — it falls to the same rollback.
- [x] Reveal gate shape → DD2 (operator ruling). Vault tamper scope → DD6 (operator ruling: new file version). Port → DD5 (operator ruling). HAT → included, combined with Flight 1's unwalked groups.

### Platform check

Flight 1's debrief asked for this before any decision is sized: what the OS, Chromium or existing code already does; what is left; why the remainder is worth building.

| Decision | Already provided | Residual | Worth a leg? |
| --- | --- | --- | --- |
| DD1 Electron 45 | Electron's own release notes list no breaking change in an API this code uses | Runtime behaviour the notes do not cover (`node:sqlite`, the cookie-blocking feature name, native surfaces) | Yes — operator instruction; a major bump is hard to bisect once other work sits on it |
| DD2 reveal gate | The internal-origin check keeps web pages out. Nothing stops admin script in an internal page. | An admin key reads every vault item and cookie value while the vault is unlocked | Yes — mission must-have |
| DD3 admin name | The launch flag gates the real admin key | A map entry named `admin` is treated as the admin tier without the flag | Yes — a few lines |
| DD4 automation input | Flight 1's picker context refuses a bare call | Possibly an automation click mints one (Q2); shortcuts reach the app (Q3) | Sized by Q2/Q3; if both measure "no", this is a pin and a doc line |
| DD5 MCP bounds | 64-session cap; 500-entry audit ring | Slots never free without a clean close; ring entries are unbounded strings | Yes — small |
| DD5 port | A process running as the operator can usually read a client's stored key anyway | Silent fallback hides that the port moved | Display only (operator ruling) |
| DD6 key-derivation downgrade | Altered parameters make the master password stop working — the vault does not silently open weaker | The altered parameters are reused when the password is next re-wrapped after a recovery-key unlock | Closed by resetting to the default on every re-wrap; **no format change needed for this half** |
| DD6 vault swap | Login fills are origin-matched | One jar's vault file opens in another jar's slot (one master key wraps every vault's key) | Operator ruling: yes, new file version |
| DD7 lock on suspend | The 10-minute idle lock | A machine suspended or screen-locked inside those ten minutes resumes unlocked | Yes — small |
| DD7 clipboard | Item copies clear after 20 s | The recovery-key copy never clears; a pending clear is lost at quit | Yes — small |
| DD7 file modes | The profile directory is owner-only on Linux | Files inside are group/world-readable if the directory is ever copied or its mode changed | Yes — four call sites |
| DD8 permissions | Web sessions use a positive allowlist | The internal session has no handler (Electron grants by default); `window-management` is granted silently | Yes — small |

### Design Decisions

**DD1 — Electron goes to 45.3.2, first, in its own leg.** The exact pin in `package.json` moves from `44.10.0` to `45.3.2` (not Dependabot's 45.3.0 — two patches have shipped since, one fixing cookies set just before quit not being saved). PR #286 is closed as superseded when the flight's PR merges; nothing is merged from it.

- Re-verified in the leg, per the standing rules in CLAUDE.md and what Flight 1 built on runtime behaviour: the full unit suite and every `node:sqlite` store suite on the bundled runtime; a real boot; the `third-party-cookie-isolation` spec (an unknown feature name is silently ignored); Flight 1's five specs (`guest-ipc-refusal`, `vault-gesture-trust`, `cross-jar-fetch-isolation`, `download-true-type`, `address-and-history-bounds`); the click witness's `input-event` and the isolated-world observer's install assertion; the built-in PDF viewer in a tab and a popup; popups and `window.open`; basic auth and the client-certificate picker, including a null `webContents` on `select-client-certificate`; the crash path (`forcefullyCrashRenderer` reason, `crashReporter` placement); Restart-to-apply (`relaunch-options.js` assumes no relaunch `env`); every automation primitive, including the two debugger-backed ones; `npm run pack`; `npm run a11y`; and, from design review: window close and teardown under Wayland/WSLg; Shields blocking and request recording (45.3.0 changes redirect-loop handling in `webRequest`); cookie `changed` events and their `cause` (the retention sweep skips `overwrite`) and cookies surviving a quit; streaming through the `goldfinch:` and `goldfinch-media:` handlers; the permission request and check handlers' call shape (DD8 builds on it); a cancellable `dialog.showMessageBox` (DD2 builds on it); the generated internal-preload bundle; `internal-session-exclusion`.
- Comments and docs that name Electron 44 or 43 as the measured version are re-measured or re-dated, not blindly edited (`capture-failure.js`, `main.js` crash directory note, `relaunch-options.js`, `session-runtime.js` — guard-audit NF11 — and CLAUDE.md's crash note).
- Rationale: every later leg should be built and tested on the runtime that ships. A failed bump is one reverted leg, not a tangle.
- Trade-off: the flight's first leg is not security work, and a real incompatibility stops the flight until it is understood (see Divert).
- **Global-hook rule**: this decision changes the runtime under every earlier spike. The spikes whose premises it could change are exactly the re-verification list above.

**DD2 — While an admin automation session is attached, reading a secret or minting a key takes a native confirmation, per item, that automation cannot answer.** (Operator ruling: prompt only while admin is attached.)

- **What is gated**: `internal-vault-reveal`; the vault page's code read (`internal-vault-totp-code`); `internal-jars-cookies-value`; minting a key (`automation:jar-key-mint`, `automation:admin-key-mint`). Vault export (`internal-vault-export`, `-export-profile`) returns no plaintext but lets the caller choose where an encrypted bundle is written; `admin-reach` leg design either puts it behind the same gate or records it as accepted, with the reason.
- **Not gated** (design review): turning automation off and revoking a key. They are the operator's kill switch, and the worst an admin script does with them is cut itself off.
- **`internal-settings-set` never writes key hashes.** `automationKeyHashes` and `automationAdminKeyHash` are refused in that handler for every caller. The refusal lives in the handler, not in the store — minting, revoking and dev-mint write through the store and keep working.
- **When the gate applies**: (a) an admin-identity session exists in the server's session map, or (b) script has been evaluated in the calling document by automation since it loaded. (b) exists because a script can set a timer and outlive its session — including a session the idle sweep (DD5) closes. Injected clicks and keys leave nothing behind and do not set the mark; a reveal they drive while the session is attached is caught by (a).
- **Where the state lives**: (a) is a `hasAdminSession()` reader on the server object, handed to the gate as a late-bound getter (the server mounts later and conditionally; no server means false). (b) is set inside the engine's `evaluate` and `injectScript` operations — before the script runs, and also when it throws — so every caller of the engine is covered, including the dev-only chrome channel that invokes engine operations directly. The setter is an injected dependency threaded at **every** engine construction site and grep-pinned, as the sheet-menu reader is; a site that omitted it would silently lose condition (b). The gate and the mark store are one Electron-free module built in `main.js` and handed to the engine and the registrars. The mark is bound to the document's main-frame token, as the media-proxy tokens are; the handler compares the sender frame, so a late message from a replaced document is not treated as untouched. It is dropped on a main-frame commit that brings a new frame token and when the contents are destroyed; an in-page navigation does not drop it, because the script survives one. No other automation operation leaves code behind in an internal document (checked at design review: DevTools is refused there, `navigate` refuses non-web URLs, reads and print run no caller code).
- **The confirmation**: a native OS dialog parented to the sender's window, Cancel as both the default and the cancel button, naming the action and the item ("Show the password for *example.com*?") and saying that automation is connected and will be able to read it. Per item, **no grant window**. One exception, scoped to the same item: once a reveal of item X is confirmed in a document, that document's code reads for X (keyed on vault id, item id and the frame token) are allowed until it goes away — otherwise the editor's code widget would prompt every 30 seconds. One dialog at a time per window; a second request while one is open is refused, not queued. An unanswered dialog is cancelled after 60 s, on main-frame commit and when the sender is destroyed (Q5).
- **Corrected from the planning conversation**: the option put to the operator said a confirmation "covers that page for two minutes". That would defeat the gate and is not built.
- **When neither condition holds, nothing changes** — no dialog in everyday use.
- **Checked at design review and found not to return a secret** (recorded so they are not re-audited): the vault list, item save, item copy, access-key list, the chrome's cookie list, export's return value, every chrome-class channel reachable by admin script in the chrome, and the vault fill channels (refused by Flight 1's picker context). `internal-settings-get` still returns key hashes to internal pages — hashes of 256-bit keys, documented, not gated.
- **Existing specs that drive the gated calls with an admin key** and will now be refused: `automation-key-gating`, `settings-automation`, and any step of `vault-copy-item` / `session-restore` that mints or reveals. They are re-authored in `admin-reach` (mint before attaching admin, or mark the step `[by-eye]`).
- Rationale: main knows when the threat exists; the dialog is the one surface no automation tier can observe or click. A confirmed reveal is then readable by the attached admin — the operator's informed choice, and the dialog says so.
- Trade-off: with admin attached, revealing ten items is ten dialogs. Automation that drives internal pages for other purposes (the a11y audit, settings specs) is untouched unless it asks for a secret or a key.
- Not chosen: refusing `evaluate` on internal tabs (declined at mission planning); a per-page privilege tier (mission constraint).

**DD3 — `admin` is never a jar key.** Design review found jar ids are already safe: `jars.js` `isReservedId` includes `admin`, a jar named "Admin" gets the id `jar-admin`, and a stored `admin` id is remapped on load. What remains is the key map: `validateKey` (`src/main/automation/automation-auth.js`) skips a map entry named `admin`; `mintJarKey('admin')` refuses unconditionally (today it refuses only because a jar list is passed in); the settings normalizer drops an `admin` entry from a stored `automationKeyHashes` map and persists the repair, **per entry** — today's validator rejects the whole map, which would reset every key. Entries for deleted jars stay: they are orphaned by design and the store does not know the jar list.

- Rationale: the admin tier's launch-flag gate must not have a second door.
- Trade-off: none known.

**DD4 — Automation input is automation's, not the operator's.** Its own leg, opened by the Q2 and Q3 measurements.

- **One mechanism, two counts**: main-side counts of in-flight injected input per target webContents — one for all tiers, one raised only when the call came through the jar scope, which is where the tier is known — held across the whole of each input helper — the paced ones (`typeText`, `dragPointer` in `src/main/automation/input.js`) span several turns of the event loop — with a short trailing allowance for late delivery, and released in a `finally`.
- **The click witness ignores input while the all-tiers count is up** (Q2 expected yes). No automation tier can then raise the vault picker; automation keeps its own login-only `vaultFill`. Flight 1's comment at the witness saying an automation click counts is corrected.
- **Key events injected for a jar-scoped key do not run app shortcuts** in `before-input-event` (`handleChromeShortcut`, DevTools, print, cross-view hops); they still reach the page. The handler has no knowledge of the caller's tier today, so the jar count carries it; a single tier-less count would suppress the admin tier's shortcuts too. Admin-tier `pressKey` keeps today's behaviour — it is how the chrome is driven in tests.
- Rationale: Flight 1 made "main saw a real click" the trust root; injected input must not count. A jar key is scoped to its jar's tabs and should not open DevTools or close other tabs.
- Trade-off: a real operator click landing while automation is injecting into the same tab is ignored once, and a real shortcut pressed in a tab while a jar key is injecting into it is lost once. `vault-gesture-trust` uses an automation click as its "real click" and needs a different actor — see Apparatus.
- Not verifiable before the leg: whether `input-event` and `before-input-event` fire synchronously inside `sendInputEvent` on Electron 45. The leg measures it first; the trailing allowance is sized from the result.

> **Revised 2026-11-14 at leg design (Flight Director decision, confirmed by design review against the client's source; the first bullet below is the original framing, kept as commentary).** No idle timeout: the MCP client this project uses does not re-initialise after a 404, so an expired session would strand a static-config client at its next call, and a timeout long enough to avoid that does little against slot exhaustion. Instead each key is capped (8 sessions) and opening one more closes that key's own stalest session — no open stream first, then no request in flight, then oldest. The reveal gate's "an admin session is attached" (DD2) becomes "an admin session made a request in the last ten minutes", which also ends confirmations lingering after a client vanishes. Stated residual: a value the operator reveals while no automation is active stays on the page until hidden, and automation attaching later can read what is still shown.

**DD5 — Automation's shared limits are bounded, and the port is shown.**

- Sessions idle longer than a fixed limit are closed and their slot freed (a sweep on an injected clock; the limit is set at leg design from what the existing clients do). A call on an expired or unknown session id answers 404, not the 401 used for a wrong key, so a client re-initialises instead of concluding its key is bad.
- Each audit-ring field is clipped inside `record()`.
- When the server is listening on a port other than the configured one, the Automation page and the toolbar indicator say so (operator ruling: keep the fallback, show it). The status the chrome can read today carries one port and the full status channel is internal-only, so the configured-and-actual pair rides the existing chrome-or-internal activity payload (or a new row in the channel table), pushed on every bind, fallback and re-bind. The display logic goes in `automation-indicator-model.js` and its controller — `renderer.js` has one line of headroom and the evaluate seam is closed.
- Rationale: 64 slots that only free on a clean close is a lockout any key holder can cause; the ring is bounded in entries but not in bytes.
- Trade-off: a client idle past the limit must reconnect. The port capture route stays open and is documented as a limit.

**DD6 — A vault file is bound to its vault, in a new file version; a re-wrap never uses key-derivation settings weaker than the app's own.** (Operator ruling: new vault file version.)

- **Key-derivation downgrade needs no format change.** Confirmed at design review: the master envelope is keyed by the password and the stored parameters, so altered parameters make the password fail. The only route is "tamper, wait for a recovery-key unlock, and the next re-wrap reuses the tampered values". Fix: where a fresh password is in hand — password change, recovery, compromise rotation — the stored parameters are kept only if they are scrypt and each of N, r and p is at least the store's injected default (`this.scryptParams`, never the bare constant), with a memory limit that fits them; otherwise the default set is written whole. Components are never mixed, and a product comparison is not used (a high-r, low-N set would pass it). **This narrows an earlier design-review ruling** recorded in `vault-store.js` at compromise rotation ("preserve `manager.kdf` … never a silent swap of an adopted profile's params"): preservation still holds for parameters at or above the default; only weaker ones are raised. The comment and the test that pin "preserve" are updated in the leg, and the leg reads that ruling's original rationale before changing it.
- **No floor on read** (dropped at design review): it detects nothing the failed password does not, and a legitimately adopted profile, or a test fixture, may sit below the default.
- **Vault identity goes into the item encryption.** A new `.gfvault` version whose items blob is authenticated against the vault's own id (`itemsAad(version, vaultId)` for the new version only). A file in another vault's slot fails to decrypt and is reported as such — never treated as empty or quarantined. The manager's envelopes are untouched, so **no manager version change**. The file's plaintext id field is also compared to the requested id as a cheap early error, with the note that an attacker can edit it.
- **Read both, write new** — `parseVault` and `serializeVault` (`vault-crypto.js`) hard-code version 1 today; both take a readable set and an explicit version, following `READABLE_MANAGER_VERSIONS` and the rule that every wrap passes the document's own stated version.
- **Upgrade every vault file together, at the first unlock that holds the master key** (password, recovery or admin key — not an access key, which cannot), in one transaction through the existing multi-file journal that compromise rotation uses. This is the answer to Q6: once a profile has been unlocked on the new build, no version-1 file of another vault remains to be swapped in. A version-1 file cannot be forged from an upgraded one, because the version is part of what is authenticated.
- **A failed upgrade never blocks opening.** The transaction covers the vaults that read and decrypt cleanly; a missing, unreadable or altered file is skipped — it stays in the old version and fails loudly on its own, as today — and the upgrade is retried at the next unlock. A read-only directory or an interrupted transaction leaves everything readable in the old version. A skipped old-version file remains swappable; that is accepted because it is already unreadable.
- **Every new write is the new version** — a vault created for a new jar, and any vault written before the profile's upgrade has run, including restore or adopt from a version-1 bundle.
- **Carriers** (second leg): export and restore bundles, adopt, cross-vault copy and compromise rotation each put items under a vault id that may differ from the source's. Each must decrypt and re-encrypt, never copy ciphertext; whether restore and adopt already do is verified at leg design.
- **Rollback to an older copy of the same vault stays a documented limit** (mission ruling), and now explicitly includes its version-1 copy.
- Rationale: one master key wraps every vault's key, so today nothing in a file says which vault it is.
- Trade-off: hard to reverse — a build before this flight cannot open an upgraded vault. `docs/vault.md` and the release notes say so.

**DD7 — The vault locks when the machine does; secrets leave the clipboard; vault files are owner-only.**

- `powerMonitor` `suspend`, `lock-screen` and (macOS user switch) `user-did-resign-active` call the existing single lock path (`lockNow`), registered after `app.ready`. On `resume`, the vault also locks if wall-clock time shows the idle limit passed while suspended — the idle timer does not count suspended time. **Global-hook rule**: this is a new app-wide listener; the spike premise it could change is the quit / relaunch order (`before-quit` flush, Restart-to-apply) and the lock fan-out that closes vault sheets in every window — both re-run in the leg. `lock-screen` does not fire on Linux; it is unit-pinned and marked by-eye for Windows and macOS.
- The vault page's code polling reads without resetting the idle timer.
- The clear timer is a closure variable inside `register-settings-ipc.js` today, unreachable at quit. It moves to one Electron-free helper (`write(text, { secret })`, `flush()`), and the three clipboard sinks go through it: the internal `clipboard:write`, the sheet's Copy on a recovery-key or access-key card, and the chrome's own write. A pending clear runs at quit, only if the clipboard still holds what was written.
- Vault files, the transaction journal and its staging files, the vaults directory, export bundles, `app.db` and `history.db` (with any existing `-wal` / `-shm` sidecars) are owner-only: mode set at creation, and existing files and directories tightened once at open. Mode bits are ignored on Windows, harmlessly. Quarantined `.corrupt-*` copies and the crash log are decided at leg design.
- **Accepted, recorded in the disposition table**: revoking an access key and changing the master password do not re-key the vault (mission allows). The docs state that someone holding an old copy of the file and a revoked key can still open that copy, and that compromise rotation is the re-key.
- Rationale and trade-off: each is small and independent; none changes a file format.

**DD8 — Permission defaults are denied, not inherited.** The internal session gets request and check handlers that deny everything (internal pages ask for no permission; the automation page's direct clipboard write already falls back to the bridge), and never report a request to the privacy panel. `window-management` leaves the web allowlist. Q4's measurements for display capture and popup bursts are fixed here if they are a few lines, or logged.

- Rationale: Electron grants when no handler is installed.
- Trade-off: a site that used `window-management` to place windows loses it silently, as with every other permission not on the list.
- **Global-hook rule**: a new session-wide handler on the internal session. Premise it could change: every internal page still boots and works (settings, downloads, jars, vault, automation) — the `settings-*`, `jar-data-*`, `downloads-surface` and `vault-filter` specs are re-run.

**DD9 — Contracts the behavior specs depend on.** Changing any of these is a spec re-author, not an inline fix at the HAT: the refusal shape the gated handlers return when a confirmation is not given; the trace line for a gate decision (`[reveal-gate] …`, added under an env flag like Flight 1's); the internal bridge method names the spec calls (`vaultReveal`, `jarsCookiesValue`, the mint calls); `enumerateWindows()` fields; Flight 1's trace lines and `data-goldfinch-vault-lock`.

### Shared Mechanisms Touched

- **The runtime (DD1)** — shared by everything. Assertion: the DD1 list.
- **The internal bridge's handlers (DD2)** — shared by the vault page, jars page, settings and automation pages. Assertion: with no admin attached and no automation touch, every gated call behaves exactly as today (unit pin on the gate's "not applicable" path; `jar-data-surfaces`, `settings-automation`, `vault-filter` re-run).
- **The click witness and `before-input-event` (DD4)** — shared by the fill icon, chrome shortcuts from a guest, F6 cross-view, the tab-boundary hop, the save prompt's keys. Assertion: `vault-gesture-trust` (re-authored actor), `chrome-guest-keyboard-nav`, `save-prompt-non-blocking` re-run; admin-tier `pressKey` unchanged (`mcp-drive-end-to-end`).
- **The vault lock (DD7)** — shared by the idle timer, the toolbar indicator, the hard sheet close in every window, automation session zeroizing. Assertion: a lock from suspend takes the same single path as the indicator's lock.
- **Vault file read/write (DD6)** — shared by unlock, every writer listed in recon, export, restore, adopt, copy, rotation. Assertion: the existing vault suites stay green unmodified except where they pin the version constant; `compromise-mode-rotation`, `multi-vault-adopt`, `vault-copy-item` re-run.
- **Settings validation (DD3)** — shared by every settings consumer. Assertion: a stored document that needs repair is persisted repaired, once.

### Apparatus (premise-audited on both axes)

All live runs use `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`, the key captured per launch, `connectAutomation()` scripts. Never a registered MCP server.

- **Admin reach is refused** (`admin-reach-refusal`, drafted) — act: admin `evaluate` on an open `goldfinch://jars` tab calling the bridge's cookie-value read, and on `goldfinch://automation` calling a mint; observe: the call's own return value (refusal shape), the `[reveal-gate]` trace line, and the unchanged key state via `settings-automation`'s existing read. The cookie-value path needs no vault, so the spec's core runs with no master password. The vault-reveal step needs an unlocked vault: **no agent types a master password** — the operator unlocks before the run, or the step is the HAT's. The native dialog is invisible to automation by design: the spec asserts what happens when nobody answers (refusal after the timeout); that a person's click releases the value is `[by-eye]`.
- **Automation click does not raise the picker** — act: MCP `click` on the fill icon; observe: Flight 1's `[vault-gesture] refused reason=…` trace. The "real click" actor in `vault-gesture-trust` must change once DD4 lands: `automation-input` records what else can produce un-marked real input on this host; if nothing can, the accept path of that spec becomes `[by-eye]` and the HAT carries it (the operator's physical click was already accepted there in Flight 1).
- **Jar-key shortcuts** — act: jar-scoped `pressKey` with a shortcut chord; observe: `enumerateTabs` / `enumerateWindows` unchanged, no DevTools (`readAxTree` still answers).
- **Session expiry and audit clipping** — unit-tested with an injected clock; one live check that an idle session's next call is refused cleanly.
- **Vault file binding** — unit and integration tests on real files in a temp directory (swap two files; open a version-1 fixture and see it rewritten). Live: the existing vault specs on a dev profile upgraded in place. A copy of the dev profile's vaults directory is taken before the first unlock on the new build.
- **Lock on suspend** — `suspend` cannot be raised on WSL; unit-pinned at the listener, `[by-eye]` on a real machine.
- **Unobservable, pre-marked `[by-eye]`**: the native confirmation; every `vault-*` sheet; the toolbar indicator's port note is chrome DOM (observable by `evaluate`).

### Prerequisites

- [x] Flight 1 merged (`376e541`) and released (v0.19.14); local `main` clean.
- [x] Operator go at the mission checkpoint (2026-11-14).
- [ ] Baseline at flight start: `npm test` (6,780 tests, 6,776 pass at Flight 1's end), typecheck, lint, format check, on Electron 44.10.0 before the bump.
- [ ] `npm run dev:automation` launches on this host; fixture ports 8231 and 8261 free; no other dev instance holding the dev profile.
- [ ] `electron@45.3.2` installs from the registry on this host and the lockfile integrity check passes; `electron-builder` 26.18 packs it (`npm run pack`).
- [ ] The dev profile's vaults directory is copied aside before any leg from `vault-binding` on runs against it.
- [ ] Budgets recorded: `renderer.js` 1,504 / 1,505; `bookmarks-bar.js` 1,076 / 1,100; evaluate seam 41. `main.js` is 3,052 lines — new vault and automation wiring goes in modules, not there.

### Pre-Flight Checklist

- [ ] All open questions resolved _(Q1 resolves in Leg 1; Q2–Q5 open the legs that use them, by design)_
- [x] Design decisions documented
- [ ] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

The runtime moves first and is proven before anything is built on it; each measurement a later decision is sized by is the first step of the leg that uses it. The automation work is then three legs split by decision cluster — who may reveal or mint (the gate, the admin name), whose input counts (injected input), and what is bounded (sessions, audit, port, permissions) — because Flight 1 showed that a leg holding two clusters is split at review anyway. The vault work is three: lifecycle fixes that touch no format, then the file-version change, then its carriers. New logic goes in Electron-free, injected-deps modules (`src/main/automation/`, `src/main/vault/`) with thin wiring; every new IPC channel is a row in `ipc-channel-table.js` under a named class. One reviewed commit at flight end, as in Flight 1, with a snapshot taken outside the tree before each fix pass.

### Checkpoints

- [ ] Electron 45.3.2: gates green, re-verification list complete, Q1 answered in the flight log.
- [ ] `admin-reach-refusal` passes; a run on the pre-change build is on record showing the same calls succeeding.
- [ ] Jar-key shortcut and automation-click measurements each end in a fix with a pin, or a recorded "not reachable".
- [ ] A swapped vault file is refused; a version-1 vault opens and is upgraded; the dev profile's own vaults survive the upgrade.
- [ ] Combined HAT walked.
- [ ] Disposition recorded for findings 5, 11, 12, 13, 16-MCP, 17, 21, NF2, NF5, NF6, NF11, P4.

### Adaptation Criteria

**Divert if**:

- Electron 45.3.2 breaks something with no fix inside the leg (`node:sqlite`, the cookie-blocking feature, the click witness's `input-event`, native surfaces). The bump is reverted, the flight continues on 44 at its latest patch (44.11.3), and the operator decides what happens to the bump.
- Q5 fails: a native dialog cannot be cancelled or wedges the window on this host. DD2 returns to the operator; the fallback already offered is refusing these actions outright while admin is attached.
- The vault upgrade cannot be made atomic through the existing journal, any existing vault fixture fails to open after it, or restore / adopt turn out to copy ciphertext in a way that cannot be re-bound without a bundle format change.
- A crew run is interrupted by safeguards: pause for the operator; no retry with altered wording.

**Acceptable variations**:

- A newer 45 patch than 45.3.2 if one ships before Leg 1 starts.
- Q2 or Q3 measuring "not reachable": DD4's half becomes a pin and a doc line.
- The two vault-file legs merging into one, or the carriers leg splitting, at leg design.
- Q4 items becoming squawks.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `electron-45` — pin 45.3.2; full gate and store suites; live re-verification (DD1); re-date the version-specific comments and docs. Nothing else. High risk.
- [x] `admin-reach` — the reveal gate and its native confirmation (DD2; Q5 answered by probe: cancellable, one dialog per window); the scripted-document mark; page handling of a refusal; `admin-reach-refusal` spec; re-author the specs that mint or reveal with an admin key; tier documentation. High risk.
- [x] `admin-key-name` — key hashes cannot be written through the settings call; `admin` is never a jar key (DD2's settings bullet, DD3). Split from `admin-reach` at its design review.
- [x] `automation-input` — Q2 and Q3 measured first; injected input does not count as the operator's click and, for a jar key, does not run app shortcuts (DD4); `vault-gesture-trust` is re-authored here and only here. High risk.
- [x] `automation-bounds` — a per-key session cap with eviction of that key's own stalest session (no idle timeout — the client cannot recover from one); the reveal gate's "admin attached" becomes "admin active in the last ten minutes"; audit fields clipped (DD5).
- [x] `port-and-permissions` — Q4 measured first; the moved-port note in the indicator and the automation page (DD5); deny-all permission handlers on the internal session and `window-management` removed (DD8). Split from `automation-bounds` at its design review.
- [x] `vault-lifecycle` — lock on suspend, screen lock, user switch, shutdown, resume after a long sleep, and quit (the vault was not locked at quit before); a one-time-code read no longer resets the idle timer; re-key acceptance in the docs (DD7).
- [x] `clipboard-and-file-modes` — one clipboard helper for all three main-side sinks, key-card copies cleared like other secrets, a flush at quit; owner-only creation and one-time tightening of vault and profile files (DD7). Split from `vault-lifecycle` at its design review.
- [x] `kdf-rewrap` — a master re-wrap never uses key-derivation parameters weaker than the app's own (DD6). Split from `vault-binding`; flown first because it is independent and easily reversed.
- [x] `vault-binding` — no new format yet: every vault-crypto call names the document's version and the vault's id; access-envelope AAD pinned; a diagnostic id check that logs and never refuses (DD6). High risk.
- [x] `vault-format-v2` — version 2 switched on for everything written anew: new vaults, bundles, restore, adopt, rotation; version-1 files and bundles keep opening; no existing file is rewritten (DD6). High risk.
- [x] `vault-upgrade` — every existing version-1 file converted at the first master-key unlock, in one transaction verified before and after, with an undo (DD6). High risk; the hard-to-reverse step, last.
- [x] `hat-and-alignment` *(groups 1 and 2 walked; the rest recorded as not verified by eye)* — one combined walk: Electron 45 by eye (rendering, sheets, PDF, popups), the confirmation dialog, lock on suspend on a real machine, and Flight 1's unwalked groups 2–6 and group 1 step 11.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged; PR #286 closed as superseded
- [ ] Tests passing (`npm test`, typecheck, lint, format check, `npm audit --audit-level=high`)
- [ ] Documentation updated (`CLAUDE.md`, `docs/vault.md`, `docs/mcp-automation.md`, `docs/dev-testing.md`, `docs/RELEASING.md` if the format change needs a release note)
- [ ] Mission criteria and Flight list updated

### Verification

- `admin-reach-refusal` passes on the flight build, with a recorded pre-change run in which the same calls returned a cookie value and minted a key.
- `third-party-cookie-isolation` and Flight 1's five specs pass on Electron 45.3.2.
- Unit and integration tests: the gate's decision table; the admin-name refusals; the session sweep and audit clipping on an injected clock; a swapped vault file refused; a version-1 vault upgraded and still readable; the suspend listener; the clipboard clear at quit; file modes on created files.
- The operator's combined walk, with anything not walked listed in the flight log as not verified by eye.
