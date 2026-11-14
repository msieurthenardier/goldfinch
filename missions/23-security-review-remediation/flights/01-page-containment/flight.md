# Flight: Page Containment

**Status**: landed

> Architect design review: **approve with changes** (2026-11-12). Second pass: approve with changes, no blocking holes; its contradictions (picker-context model, token reuse, arming rule, allowlist wording, HAT text) are resolved in the text below. First-pass changes incorporated: clickjacking and record lifecycle in DD4/DD5/DD8, format-bump probe for DD6 (Q6), arming placement in DD7, sync registrar in DD1, store validator in DD9, `ipc-gate` split in two, Q6–Q8 added.
**Mission**: [Security Review Remediation](../../mission.md)

## Contributing to Criteria

- [ ] Coverage is complete before fixes are designed (web-content boundary audit finished; every `[A]` claim acted on re-verified). _(gates Flights 2 and 3)_
- [ ] A web page cannot drive a privileged handler (every handler classified; standing guard; live refusal). _(finding 1)_
- [ ] A page cannot obtain a saved card, identity or login through a prompt it raised. _(findings 2, 14)_
- [ ] Cookie-jar isolation holds on every chrome-initiated request and every history write. _(findings 4, 9, 10)_
- [ ] A downloaded file cannot masquerade and is not opened without the operator seeing what it is. _(finding 6)_
- [ ] Trusted prompts cannot be made to say or do the attacker's thing — the page-facing half: auth realm, address bar, dialog arming, history main-thread bounds. _(findings 15, 16-history; MCP bounds are Flight 2)_
- [ ] Every finding has a recorded disposition — this flight's share: 1, 2, 4, 6, 9, 10, 14, 15, 16-history, 22.

Reconnaissance (2026-11-12, see flight log) classified every item for this flight **confirmed-live** except three partials, scoped down below. No item was retired.

- 6b reserved device names: simple forms already caught (`src/main/download-path.js:68-74`); compound forms and control/bidi characters are the remaining work.
- 15d cert-override dialog: default focus is already Back (`src/renderer/menu-overlay.js:2641`); only the input-arming delay remains.
- 15b address-bar userinfo: no formatter exists (confirmed); whether the committed URL carries userinfo is a runtime fact for Leg 1.

---

## Pre-Flight

### Objective

Make a hostile page in a guest tab unable to reach beyond its own tab and jar: every main-process IPC handler knows and checks who may call it, the vault only fills on a gesture the browser itself verified and only after the operator saw where the data is going, chrome-initiated requests and history writes stay in the supplying tab's jar, downloads show their true type before they are opened, and browser-voice prompts cannot be scripted or stalled by page input. The flight opens by proving or disproving the premises its designs rest on and by finishing the interrupted audit, and ends at the operator's go/no-go checkpoint for Flights 2 and 3.

### Open Questions

- [ ] **Q1 — Does a guest page obtain the preload's `ipcRenderer` (send and/or invoke) on Electron 44.10.0?** Resolved by live probe in Leg 1. Decides finding 1's recorded severity and whether DD3's preload-side defence is mandatory or defence in depth. DD1/DD2 do not depend on the answer.
- [x] **Q2 (answered: no — DD4/DD5 revised below) — Can main call into, and read from, the vault isolated world of a guest without passing through page-controlled code** (`webContents.executeJavaScriptInIsolatedWorld` or the frame-level equivalent), and does the result survive a hostile page that has replaced `Promise`, `JSON`, `Array.prototype` and `EventTarget.prototype` members? Resolved by live probe in Leg 1. **DD4 rests on this premise; operator ruling: no fallback — if it fails, the flight diverts for a new design conversation.**
- [ ] **Q3 — Does an isolated-world listener on the shared DOM see a genuine `isTrusted` and survive main-world tampering with `addEventListener`?** Leg 1 probe (same rig as Q2). The probe attaches on the icon node itself and also checks the listener still fires when the page stops propagation in the capture phase on `window` / `document`, and that the isolated world can hit-test the click point (`elementFromPoint`) and read the icon's rendered box and opacity.
- [ ] **Q4 — Does the committed URL the chrome receives carry userinfo, and does chrome CSP `'self'` admit `file://host/…`?** Leg 1 probe (the second is Windows-only in effect; record what this host shows).
- [ ] **Q5 — What does the finished web-content audit add?** Navigation guards, permission handlers, popups, TLS trust, guest-channel checks. New items are classified in Leg 1 and either folded into Legs 2–5 by shared surface or logged as squawks.
- [ ] **Q6 — Can a non-secret per-item `confirmedOrigins` field be added without a vault file-format version bump**, and does it survive every path that carries an item (schema `metadataOf` whitelist, `ITEM_TYPES`, editor and page models, export bundle, restore, cross-vault copy)? Leg 1 static probe. If it needs a version bump, DD6 uses always-confirm in this flight and the field moves to Flight 2's format change.
- [ ] **Q7 — Popups as guest senders.** Which of the 13 guest channels can a popup-registry guest legitimately send, and what is "the window's active tab" for a popup? Leg 1 answers from code; default is that a popup is not eligible to raise the vault picker.
- [ ] **Q8 — Census reconciliation.** Recon counted 214 registrations (including `registerInternalHandler` call sites); design review counted 90 `handle` + 51 `on` raw sites. Leg 1 produces the authoritative channel list that becomes DD2's classification table.
- [x] Handler guard shape → DD1. Gesture trust root → DD4. Card/identity extra step → DD6. Audit re-run framing → DD12. HAT → included.

### Design Decisions

**DD1 — One gate module owns every main-process IPC registration.** A new Electron-free, injected-deps module in `src/main/` exports a small closed set of registrars, each naming the surface that may call the channel: chrome renderer; owning chrome of a `wcId` argument; tab guest (main frame of a webContents in `tabViews` or the popup registry); deliberately open (requires a written reason string). `registerInternalHandler` and the existing overlay-sender helpers (`recordForSheetSender` / `recordForFindSender` / `recordForPromptSender`) remain the gates for their surfaces and are recognised by the guard. `requireChrome` / `ownsTab`, today closure-local and duplicated (`register-tab-ipc.js:194-200`, `register-browser-ipc.js:91`, inline at `main.js:2567`), are single-sourced in the gate module.

- Rationale: Mission 13 fixed this by sweep and it regressed with every new handler. A registration shape that cannot be written without choosing a caller class is the only form that holds.
- Trade-off: 48 registrations move (46 bare + 2 non-refusing), and the 79 already-checked ones are either migrated or allowlisted by helper name — see DD2. Refusal values differ per channel today (`null`, `undefined`, `[]`, `{ok:false}`); each registrar takes an explicit refusal value so no chrome caller's contract changes (the class is the choice the registrar forces; the refusal value is only what a refused caller sees). The two synchronous guest channels (`shields-farble`, `vault-eligible` — `ipcMain.on` with `event.returnValue`) get a sync registrar that **always** sets `returnValue`, including on refusal, or the guest preload blocks forever. `event.senderFrame` is available on both `on` and `handle`; a destroyed frame is `null` and fails closed.

**DD2 — Standing guard: no raw `ipcMain.handle` / `ipcMain.on` outside the gate.** A source-scan unit test over `src/main/**`, modelled on `test/unit/window-closed-invariant.test.js` (comment-masked walk, sanctioned-wrapper bodies blanked, empty allowlist asserted at size 0, sanity-fail when the walk finds nothing), plus a census assertion that the set of registered channels equals a classification table (the `internal-host-drift.test.js` idiom). The scan recognises the `registerInternal` alias and handlers passed by name. Already-checked handlers that keep an inline check are migrated to a registrar in this flight rather than allowlisted — an allowlist of 79 is the regression path. The guard lands in `ipc-gate` with an explicit **file-scoped** allowlist of the not-yet-migrated files; `ipc-gate-complete` empties it and pins it at size 0, and the allowlist does not outlive the flight. In the interim the classification table is the thing that stays honest: it lists every channel from the first leg, with unmigrated ones marked as such.

- Rationale: the guard must go red on the next unclassified handler with no human remembering to look.
- Trade-off: this is a registration-shape refactor across every `register-*-ipc.js`, `main.js` and `app-lifecycle.js`; many unit tests construct those registrars with a fake `ipcMain` and need their fakes to satisfy the gate.

**DD3 — Guest-preload channels are literal, positively gated, and main-frame only.** The 13 guest channels are registered through the tab-guest registrar (sender is a live tab or popup guest; `event.senderFrame` is that webContents' main frame; fail-closed when absent). Preload-side, every `ipcRenderer.send` channel name is a string literal at the call site and no send iterates a page-patchable structure (the `for…of plan` loop at `src/preload/webview-preload.js:606-608` becomes indexed access over a fixed kind list). Payloads forwarded to the chrome (`guest-media-list`, `guest-privacy-fp`) are validated main-side.

- Rationale: closes the one traced page-influenced channel name regardless of Q1; makes "a guest reached a chrome channel" a refusal at the handler.
- Trade-off: if Q1 shows `ipcRenderer` itself is reachable through Electron's own bundle, DD1 is the real boundary and this is hardening only; say so in the docs rather than claim more.

> **Revised 2026-11-13 (operator ruling: "shape 1"; the paragraphs below are the original framing, kept as commentary).** The original premise failed (Leg 1 Q2: the isolated-world reply is page-visible and, for object values, page-alterable; see `probe-results.md` and `gesture-transport-probe.md`). The live design: **main observes the input itself.** Main listens to the guest's own input events (`input-event` / `before-mouse-event`, which fire for real input only, ahead of the page, with no page code involved) and keeps a short-lived record of the last real pointer press and key press per tab. The page-side gesture message stays a hint: the picker is raised only if (a) the sender is the active tab of its window, (b) main itself saw a real click or activation key in that tab within a short window, (c) for a pointer, the main-observed coordinates (view-local, `clientX × zoomFactor`) fall inside the icon box the page side reports, and (d) the rate limit passes. The same check gates `guest-vault-icon-menu` (real right-click; main's `context-menu` event). **Accepted residual:** the icon box and, for keyboard activation, the focus claim are page-supplied and can be forged, so a page can turn a real click anywhere on itself into a picker raise — it can no longer raise one with no click at all. DD6 (destination line, arming delay, no default row, card/identity confirmation) is the control for that misdirected click; DD4 and DD6 remain one trust unit in one leg. No debugger protocol is used. The dead `isTrustedGet` capture and `readTrusted` fallback are still removed. The HAT leg confirms that a physical pointer click produces the main-side event (the spike could only inject input).

**DD4 — The vault gesture is verified by the browser, never by the page (1Password-style; operator ruling, no fallback).** The fill icon's click and context-menu are observed by a listener registered in the vault isolated world, where `isTrusted` and the listener registry are not page-controlled. The page-world `guest-vault-gesture` send becomes a hint only: on receiving it, main (a) requires the sender to be the active tab of its window, (b) asks the isolated world directly whether a trusted activation of the icon occurred within a short window and for which field ordinal, and (c) rate-limits. Only then is the picker raised. The same check gates `guest-vault-icon-menu`. The dead `isTrustedGet` capture and the `readTrusted` fallback are removed, not left as apparent protection.

- **Clickjacking is not closed by verification alone.** The icon is a page-DOM node; a page can restyle or move it so that any real click lands on it and is genuinely trusted. The isolated-world check therefore also requires that the icon was the topmost element at the click point, at its expected size, opaque and inside its anchor field's box. What remains after that is a real click on a real-looking icon the operator did not mean — and for that, **DD6 is the control**: DD4 and DD6 are one trust unit and ship in the same leg.
- **Record lifecycle.** The verified-gesture record (timestamp, field ordinal, family) lives **inside the isolated world** and nowhere else, so it dies with its document. The isolated world owns the record and mints a document-scoped nonce for it. Each hint triggers one main-initiated query carrying the frame identity main expects (the tab's current main frame at hint time); a reply from a different or destroyed frame is discarded. The record's short freshness window covers **hint → picker raise only**. From there, authority is a **per-open picker context** main holds — `{wcId, frame identity, nonce, ordinal, family}` — bound to the sheet's open token and carried across the locked-vault branch (unlock, then pick). It is dropped on sheet close, tab switch, main-frame navigation, window move, tab close and vault lock. A fill is delivered with the nonce and the isolated world rejects it when its record is gone or the nonce differs; gesture age is never re-checked at fill, so a slow unlock does not silently fail and the window is never widened to cover one. Main holds no gesture state beyond that per-open context. Chrome recovery re-adopts tabs but creates no gesture state. A popup is not eligible (Q7).

- Rationale: the page controls every object in its own world; an isolated world plus a main-side query is the mechanism browser extensions rely on, and this codebase already has the world.
- Trade-off: one cross-process round trip before the picker opens. An earlier ruling (Mission 21, DD3f) forbade a cross-process isolated-world call for the **gesture-time capture read** because the isolated world is gone by `did-navigate`; that ruling stands and is not touched — this decision adds a main-initiated call on the fill path only, where a lost world simply means no picker (design review confirmed DD3f forbade reading at settle, not a main-initiated call). Rests on Q2/Q3; if either fails, divert.

> **Revised 2026-11-13 (operator ruling after Leg 1 and the gesture-transport spike; the paragraph below is the original framing, kept as commentary).** Leg 1 Q2 showed that nothing main sends to or reads from the isolated world through Electron's own calls is free of page code, so "nothing secret transits the page world" is not achievable without the debugger protocol, and a filled value lands in the page's own fields either way. The property this decision now keeps: **the page receives only the item the operator chose, after the operator saw where it was going.** `fillHuman` still requires a live per-open picker context for the target tab and re-checks the committed origin at fill time; the tracker's payload-into-script-text path and delivery details are settled at `vault-fill-trust` leg design. No debugger protocol in the fill path.

**DD5 — Fill payloads go main → isolated world; nothing secret transits the page world.** Login, card, identity and generated-password fills are delivered by main directly into the isolated world, with the field ordinal taken from the isolated world's own record of the verified gesture (DD4). The main-world `vault-fill*` listeners and the tracker's payload-into-script-text path are removed. `fillHuman` requires a live per-open picker context (DD4) for the target tab and delivers with its nonce; the automation `fill` has no human gesture and keeps its own gates (jar scope, login-only, origin match) while using the same main → isolated delivery. Both re-check the tab's committed origin at fill time, as today. The generate-in-picker path (`vault-fill-generated`) and the locked-vault branch (unlock, then pick) deliver the same way under the same picker context; if the document changed while the unlock sheet was up, the context is already dropped and nothing is filled.

- Rationale: closes the page-replaceable `JSON.stringify` read with zero clicks beyond the operator's own choice.
- Trade-off: the main-world preload loses its role in fills; unit tests that drive fills through `entryTracker.fill*` are re-targeted. A value the operator chose to fill is readable by that page once in the field — inherent, and stated in `docs/vault.md`.

**DD6 — The picker shows the destination, has no live default, arms after a delay, and confirms a card or identity on a new site.** The vault picker header names the tab's committed origin, derived main-side. No fill row is focused when the picker opens from a page gesture; rows ignore activation for a short arming interval after show. Filling a card or identity on an origin where that item has not been filled before takes an explicit second confirmation naming the site (operator ruling); the confirmed origins are stored with the item as non-secret metadata **if Q6 shows that needs no file-format version bump**; otherwise this flight ships always-confirm for cards and identities and the remembered-sites refinement moves to Flight 2. The destination is the tab's **committed** origin from main's tab entry, never a pending navigation and never a value from the preload; the certificate-override condition reads the same main-side entry state that already drives `tab-security`, so no new per-tab push is introduced. Capture and fill require an http(s) tuple origin — opaque origins (`"null"`) never match and are never offered. A tab whose current navigation carries a certificate override is not offered logins without an explicit warning row.

- Rationale: card and identity fills are deliberately not origin-gated, so the operator's informed choice is the only gate; it must be impossible to give by accident.
- Trade-off: one extra step the first time a card is used on a site; a new per-item field (vault item schema, editor model, page model, export/restore all carry it — the four-source rule in CLAUDE.md applies to a field as much as a type). The arming delay is a change to the **shared sheet mechanism** — see Shared Mechanisms below.

> **Revised 2026-11-14 (operator ruling: small `prompts-and-bounds` leg; DD7's text below is the original, kept as commentary).** Built: `cert-picker` joins `vault-picker` in the shared arming table at 500 ms (the arming mechanism itself shipped in `vault-picker-controls`), and the certificate picker opens with nothing selected, as the vault picker does. **Not built:** arming for `cert-override` (the certificate-error Proceed) and for `auth-basic` (the sign-in card submit). Reason: neither is a dialog a stray Enter commits by accident in the way the picker was (the picker's first row was focused at open), and the operator ruled the extra opt-ins out; either is one line in the table if a later review wants it.

**DD7 — Dialog arming is one sheet-level capability, opted into per menu type.** The sheet gains a per-open `armDelay` axis (never reusing `dismissible` / `keepFocus` / `survivesBlur`), decided once in the chrome's `src/renderer/chrome/overlay-menus.js` `open()` against a pure shared opt-in table (the `src/shared/vault-blur-survival.js` idiom, drift-guarded), sent to main as a boolean that main re-derives from `menuType` rather than trusts, and enforced in the sheet. The arming timer lives in the sheet and restarts on a same-menuType model-replace. While arming, pointer activation and keyboard activation (Enter / Space, including the accelerator path) are both ignored — they are separate code paths and both are pinned. `keepFocus` and `noFocus` opens are unaffected unless their menu type opts in. Opted in: `vault-picker` (every open — the picker has no other entry point worth a faster path, and a per-menuType rule is what main can re-derive), `cert-picker`, `cert-override` (Proceed only), `auth-basic` (submit). The client-certificate picker opens with no row selected.

- Rationale: one mechanism, pinned once, instead of four hand-rolled timers.
- Trade-off: touches `menu-controller.js`, `menu-overlay-manager.js` and `sheet-accelerator.js`'s hand-mirrored key map — changed together.

**DD8 — Media proxy URLs are minted by main and bound to the supplying tab.** `guest-media-list` items are validated main-side: only `http:` / `https:` media URLs survive (plus the inline schemes the panel already renders without a fetch); everything else is dropped before the chrome sees it. `toMediaProxyUrl` returns `null` for any other scheme and every `media-controller.js` assignment handles `null`. The proxy URL carries an unguessable per-tab token minted main-side instead of a bare `wcId`; the handler resolves the token to its tab and refuses anything else.

- Rationale: a page can neither name another tab's session nor hand the chrome a non-web URL.
- Lifecycle: the token store is main-owned, one current token per tab keyed by `wcId`; minted on the first validated media list for a document and **reused by every later list from that document**, replaced on main-frame cross-document navigation only (same-document `pushState` / hash navigation keeps it), dropped on tab close; proxy URLs still showing or playing in the panel after a replacement fail closed and the panel re-scans — intentional; a tab moved or adopted between windows keeps its `wcId` and its token (the session does not change). Source of truth is the store; the chrome never caches a token beyond the media list it arrived with, and a stale token resolves to nothing (404), never to another tab.
- Trade-off: one more piece of per-tab state to drop on close; the existing `cross-jar-fetch-isolation` spec's proxy-URL assertions change shape.

> **Revised 2026-11-14 (operator ruling: slim `downloads` leg; DD9's text below is the original, kept as commentary).** Built: records carry their partition; Retry goes through that session and is refused with a reason when impossible; `sanitizeFilename` replaces control, format and bidi characters, tests the trimmed first dot-segment for reserved names and keeps the final extension when truncating (in bytes); the downloads page opens only a finished download through one main-side function. **Not built:** the executable-class extension list, the in-app confirmation before opening, the popup rule, forcing Chromium's extension over a page-suggested name, and any change to how names are displayed. Reasons: confirmation before running a download is the operating system's (SmartScreen / the open-file warning on Windows, Gatekeeper on macOS, acting on the internet-origin mark Chromium writes; checking that mark on Windows and macOS is a HAT item), and the server already controls the name Chromium derives, so overriding the page's suggestion removes nothing from a hostile site. The `retryable` verdict rides the downloads page's list rows only (not the popup).

**DD9 — Downloads remember their jar; names come from the browser; executables confirm.** A download record carries the partition it was made in — added to the record shape, the `downloads-store.js` load validator (which copies an explicit field list and would otherwise drop it) and the typedef together. Retry re-requests through that session. Rule: Retry is refused main-side, and shown unavailable (a `retryable` flag on the downloads payload, rendered by both the downloads popup model and the `goldfinch://downloads` page), when the record has no partition (records persisted before this flight), when the partition is a burner whose session is gone (always true after a restart), or when the jar has been removed. The saved filename keeps the extension Chromium derived for the response; a page-suggested name contributes at most the stem. `sanitizeFilename` strips control, format and bidi characters and tests the trimmed first dot-segment for reserved device names; truncation preserves the final extension. Both `shell.openPath` sites go through one main-side function that enforces completion and, for an executable-class file (a closed extension list in a pure shared module), requires a confirmation naming the true extension. The name display never hides the extension.

- Rationale: the operator decides to open a file knowing what it is.
- Trade-off: the confirmation for the downloads popup rides the sheet (not automation-observable → HAT); the list of executable-class extensions is a maintained table. Retry disappears for pre-existing records and for burner downloads after restart.

> **Revised 2026-11-14 (operator ruling: small `prompts-and-bounds` leg; DD10's text below is the original, kept as commentary).** Built: search input capped at 256 characters and 16 tokens (cut, not refused); a title capped at 512 characters with title writes limited to one per second per tab (first at once, the last value written when the interval ends); an address over 8,192 characters not recorded. **Not built:** a per-tab rate limit on in-page navigation recording. Reason: Chromium already throttles `pushState` / `replaceState` to about 20 events per second, which the survey measured, and the per-visit 30 s duplicate suppression and the new address cap bound what remains.

**DD10 — History writes are jar-scoped and bounded.** `setTitle` matches on `(id, jar_id)`; the recorder's per-tab last-visit handle is dropped on clear/delete/prune/wipe of its jar. Search input is capped (length and token count) before it reaches FTS; in-page navigation recording is rate-limited per tab with URL and title length caps.

- Rationale: closes the cross-jar title write and the synchronous main-thread stall.
- Trade-off: very long queries are truncated silently; pathological single-page apps lose some history rows.

> **Revised 2026-11-14 (operator ruling: small `prompts-and-bounds` leg; DD11's text below is the original, kept as commentary).** Built: the realm is cleaned in main (control/format characters and double quotes removed, whitespace collapsed, capped at 120 characters); `user:pass@` is removed from the URL main pushes to the chrome and from what history stores, by the pure `src/shared/display-url.js` (navigation keeps the real URL, so such URLs still load and authenticate). **Not built:** eliding long subdomains so the registrable domain stays in view, and refusing `user:pass@` URLs outright. Reasons: with credentials removed the bar shows the real host, and eliding would need display code in `renderer.js` (no headroom) for a spoof that is not credentials-based; refusing such URLs would break intranet devices that authenticate that way. `renderer.js` was not edited.

**DD11 — Browser-voice text is bounded; the address bar always shows the host.** The HTTP auth realm is length-capped and stripped of control/format characters before it reaches the card. The address bar's displayed value never includes userinfo and, when not being edited, keeps the registrable domain in view.

- Rationale: page-supplied text cannot impersonate the browser or push the real host out of sight.
- Trade-off: `src/renderer/renderer.js` is at 1504/1505 lines — the display formatting lands in a pure shared module plus `navigation-controller.js`, with zero net lines in `renderer.js`, no new evaluate-seam entry (41), and nothing added to `bookmarks-bar.js` (1076/1100).

**DD12 — The audit re-run is a guard audit, not an exploit hunt (operator ruling).** Leg 1's crew is briefed to check, for each navigation, permission, popup, TLS and guest-channel guard, that it exists, what it refuses, and what it does not cover — no proof-of-concept payloads. If the run is interrupted again, the leg pauses for the operator.

> **Revised 2026-11-14 (operator ruling: small `prompts-and-bounds` leg; DD13's text below is the original, kept as commentary).** 22a, 22c and the `settings-get` projection were built in earlier legs. **22b is accepted, not built**: the browser's own views are not pinned to their own document URL. Reason: nothing reaches a navigation in those views today, and script running in one would already hold stronger access than a navigation could give it.

**DD13 — Finding 22 dispositions.** 22a: the eleven sheet channels gain the `current.menuType` guard (fix — it makes the CLAUDE.md four-guard rule true). 22c: `tab-create` re-validates `url` by its `trusted` branch and `partition` against known jars main-side (fix — defence in depth at a state-changing channel). 22b: non-guest views are pinned to their own document URL where that is a one-line change per view; otherwise accepted with reason (not reachable today). `settings-get` projects out the automation key hashes for the chrome caller and CLAUDE.md's "non-secret data only" wording is corrected.

### Shared Mechanisms Touched

Per the project planning rule, every feature sharing a changed mechanism is listed and asserted unaffected.

- **The sheet's open/activation path (DD6, DD7)** — shared by: kebab, container and engine pickers, page and tab context menus, address-bar suggestions (`noFocus`), bookmarks overflow and edit, site-info, cert viewer, input-dialog, every `vault-*` sheet, `auth-basic`, `cert-picker`, `cert-override`, downloads popup. Assertion: menu types that do not opt in to `armDelay` activate exactly as today (unit pin on the opt-in table; suggestions click-navigation and the Ch7-before-Ch6 order re-run live).
- **The isolated-world observer (DD4, DD5)** — shared by: login/card/identity capture at gesture, provenance tracking, generated-password fill, the save prompt. Assertion: the capture corpus tests and the `save-prompt` behavior specs stay green; the observer build's `installed === true` assertion still holds.
- **Guest `before-input-event` / gesture forwarding (DD3)** — shared by: chrome shortcuts from a guest, tab-boundary hop, F6 cross-view nav, bookmark drop. Assertion: `chrome-guest-keyboard-nav` re-run.
- **IPC registration (DD1)** — shared by every feature. Assertion: full unit suite; live smoke exercises every apparatus primitive (census, windows, capture, evaluate, readDom, click, typeText, pressKey, navigate) against the migrated build.
- **Global hook check**: this flight installs no new `app.on` or session-wide listener. If Leg 1's findings require one, the owning leg lists the earlier spike premises it could change and re-runs them.

### Apparatus (premise-audited on both axes)

- **Refusal of a guest-originated privileged call** — act: Leg 1's probe page loaded in a tab via `npm run dev:automation` (`GOLDFINCH_AUTOMATION_DEV_MINT=1`, key captured per launch, `connectAutomation()` scripts); observe: `GOLDFINCH_VAULT_TRACE`-style main-side log line on refusal, plus unchanged app state via `enumerateWindows` / `evaluate` in the chrome. If Q1 shows a page cannot issue the call at all, the live demonstration is the probe's negative result and the unit pin on a non-chrome sender carries the criterion.
- **Vault picker raise** — act: MCP `click` on the fill icon (real `sendInputEvent`, so trusted) vs. page-script synthetic activation via `evaluate`; observe: the picker is a `vault-*` sheet — **unobservable to automation at every tier**. Presence is read from a main-side trace line and from `enumerateWindows` census; the picker's content, missing default row, arming and the new-site confirmation are **`[by-eye]` / HAT**, pre-marked.
- **Cross-jar request** — act/observe: the existing `cross-jar-fetch-isolation` fixture server and request log (`tests/behavior/fixtures/cross-jar-fetch/`), extended with a hostile media list.
- **Downloads** — act: fixture serving a mismatched name/type; observe: `downloadsList` (admin) and the saved path on disk. The open confirmation is on the sheet or the internal page: internal-page variant observable via `readDom`; popup variant `[by-eye]`.
- **Auth realm / cert picker / address bar** — `auth-basic` and `cert-picker` sheets are unobservable → `[by-eye]`; address bar value is chrome DOM → `evaluate` on the chrome target.
- **Cross-site OOPIF input** is undeliverable by MCP — no step targets one.

### Prerequisites

- [x] Mission 23 approved by operator (done 2026-11-12) and its status set `active` at flight start.
- [ ] `npm run dev:automation` launches on this host with dev-mint; fixture server port `8231` free (the existing cross-jar fixture); no other Goldfinch dev instance holding the dev profile.
- [ ] Unit suite green at flight start (baseline: 6348 tests, ~8 s at sortie 08).
- [ ] `src/renderer/renderer.js` line count recorded (budget 1505; 1504 at sortie 06) — any renderer change is an extraction.
- [ ] A vault set up in the dev profile with one login, one card, one identity for HAT and probes.

### Pre-Flight Checklist

- [ ] All open questions resolved _(Q1–Q5 resolve in Leg 1 by design; Legs 2–5 are not designed until they are)_
- [x] Design decisions documented
- [ ] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 is evidence, not fixes: a probe page and harness under `tests/behavior/fixtures/` answer Q1–Q4 on the running dev build, the guard audit finishes the web-content surface, and the flight log's finding table is updated. Its output decides DD3's standing, confirms or diverts DD4/DD5, and may add scope.

Legs 2–5 are each a full slice (main, preload, renderer, unit pins, docs, behavior spec):

- The gate module lands first because every later leg registers or re-gates channels through it.
- The vault leg changes the observer bundle, the fill delegates, the picker template and the sheet's arming axis together — they are one design.
- Jar isolation and downloads share `register-download-ipc.js`, `register-browser-ipc.js` and the media controller.
- Prompt and bounds work is small and shares the sheet arming axis built in the vault leg.

CLAUDE.md and `docs/` are corrected in the leg that makes each claim true or false, not batched at the end.

### Checkpoints

- [x] `probe-and-audit`: Q1–Q4 answered with evidence in the flight log; audit complete; finding table final; DD4 premise confirmed (or flight diverted).
- [x] `ipc-gate`: gate module live; all bare handlers gated; guard red on a planted bare handler (neuter-verified).
- [x] `ipc-gate-complete`: zero raw registrations outside the gate, allowlist empty; live smoke across every apparatus primitive.
- [x] `vault-fill-trust`: synthetic icon activation raises no picker (trace-verified); no secret in any main-world listener or script text (grep-AC); capture corpus green.
- [x] `jar-isolation-and-downloads`: extended `cross-jar-fetch-isolation` passes; mismatched-name download saves with the true extension; Retry uses the owning jar.
- [x] `prompts-and-bounds`: arming opt-in table pinned; address bar never shows userinfo; history bounds pinned.
- [ ] HAT: operator walks the by-eye surfaces.
- [ ] Operator go/no-go for Flights 2 and 3.

### Adaptation Criteria

**Divert if**:

- Q2 or Q3 fails (main cannot reach the isolated world free of page-controlled code, or the isolated-world listener is not trustworthy) — operator ruled no fallback; stop and re-plan the vault leg.
- The finished audit surfaces a critical finding outside this flight's surfaces (e.g. a navigation-guard bypass to `goldfinch://`) — stop and re-scope with the operator.
- The gate migration cannot preserve an existing chrome caller's contract without a renderer change that breaks the 1505-line budget or the 41-entry evaluate seam.
- The per-item "sites confirmed" field cannot be added without a vault file-format version bump — that belongs with Flight 2's format change; fall back to always-confirm for this flight and record it.

**Acceptable variations**:

- Leg 1 folds small new audit findings into the leg that owns their surface; unrelated ones become squawks.
- Deleting a bare `jars-*` / `history-*` twin the chrome never calls instead of gating it.
- 22b landing as an acceptance.
- Running `jar-isolation-and-downloads` before `vault-fill-trust` (they are independent) if Leg 1 leaves the vault design waiting on a divert conversation.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `probe-and-audit` - Live probes for Q1–Q4 (guest reach to preload IPC; main ↔ isolated world; isolated-world event trust; committed-URL userinfo), the guard audit of the web-content boundary (DD12), final finding table in the flight log. No product source changes; fixtures and harness only.
- [x] `ipc-gate` - Gate module with all registrars (DD1; the sync registrar is built and unit-pinned here, first used in `ipc-gate-complete`); standing guard and full classification table, with a file-scoped allowlist for not-yet-migrated files (DD2); migration of the 46 bare and 2 non-refusing handlers; `settings-get` projection (DD13). Behavior spec: `guest-ipc-refusal`.
- [x] `ipc-gate-complete` - Migration of the already-checked handlers and the 13 guest channels onto registrars — including the two synchronous ones, with a live smoke that a guest page still loads (a missed `returnValue` blocks the preload) — literal preload sends (DD3), sheet menu-type guards and `tab-create` re-validation (DD13); guard allowlist emptied and pinned at 0. Docs: CLAUDE.md routing/guard sections.
- [x] `vault-fill-trust` - *(re-scoped 2026-11-13 after the DD4/DD5 revision and leg design review; original entry kept below as commentary)* Main-side witness of real pointer input and gesture verification (revised DD4), main-held per-open picker context carrying the committed origin, origin equality at fill for every item type, fill-target rule (revised DD5). Behavior spec: `vault-gesture-trust`.
- [x] `vault-picker-controls` - *(split out of `vault-fill-trust` at design review; ships in the same flight commit, so DD4 and DD6 still land together)* Picker destination line, no selected row, the sheet's arming axis (DD7, `vault-picker` only), certificate-override warning, card / identity confirmation on a new site with `confirmedOrigins` (DD6). Docs: `docs/vault.md`, CLAUDE.md vault and sheet sections.
  - Original entry: `vault-fill-trust` - Isolated-world gesture and main-side verification (DD4), main → isolated fill delivery (DD5), picker destination / no default / card-and-identity confirmation / http(s)-origin rule / certificate-override warning row for logins (DD6), the sheet `armDelay` axis (DD7, built here, consumed again in Leg 5). Behavior spec: `vault-gesture-trust`. Docs: `docs/vault.md`, CLAUDE.md vault section.
- [x] `jar-isolation` - *(first half of the entry below, split at leg design 2026-11-14)* Media list validation and tab-bound proxy tokens (DD8), `download-media` URL check (NF13), history title scoping (DD10, title part). Behavior spec: `cross-jar-fetch-isolation` (extended).
- [x] `downloads` - *(second half)* Download partition and owning-jar Retry, naming, gated open with executable confirmation, extension always visible (DD9). Behavior spec: `download-true-type`.
  - Original entry: `jar-isolation-and-downloads` - Media list validation and tab-bound proxy tokens (DD8), download partition / naming / gated open with executable confirmation (DD9), history title scoping (DD10, title part). Behavior specs: `cross-jar-fetch-isolation` (extended), `download-true-type`.
- [x] `prompts-and-bounds` - *(re-scoped by operator ruling 2026-11-14; original entry kept below)* History title cap and rate limit, history address length cap, credentials removed from the address shown and stored, client-certificate picker opening with nothing selected plus arming, sign-in realm cap, history search cap. Behavior spec: `address-and-history-bounds`.
  - Original entry: `prompts-and-bounds` - Auth realm bounds, address-bar host display (DD11), arming for cert picker / cert override / auth card (DD7 consumers), history search and in-page navigation bounds (DD10), 22b disposition.
- [x] `hat-and-alignment` _(optional, operator opted in)_ - Guided acceptance of the surfaces automation cannot observe: vault picker (destination, no default row, arming) for a login (origin-gated, no confirmation), a card and an identity (confirmation on a new site — or on every fill if Q6 forced the fallback), plus the warning row on a certificate-override tab, download open confirmation in the popup, auth card, cert picker, address bar; includes one walk with a second window open on the same jar (shared vault and download state the operator is not looking at). Every operator action is checked against the real UI at HAT design time.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`)
- [ ] Documentation updated (CLAUDE.md claims named by findings 1, 2, 4, 22 corrected or made true; `docs/vault.md`; `docs/mcp-automation.md` where tab-guest gating changes an op's refusal)
- [ ] Mission Context updated with Leg 1's final finding table; mission dispositions recorded for this flight's findings
- [ ] Operator go/no-go recorded

### Verification

- **Unit**: gate module refusals per caller class; the standing guard and classification-table drift test (neuter-verified); proxy token resolution; filename sanitiser table; executable-class table; history `setTitle` jar scoping and bounds; picker model with destination and no default; arming opt-in table; origin rules (opaque never matches).
- **Behavior specs** (authored at the owning leg's design; key observable and rough size fixed here):
  - `guest-ipc-refusal` — a page in a tab attempts a state-changing chrome channel; observable: main-side refusal trace and unchanged app state. ~6 steps.
  - `vault-gesture-trust` — synthetic activation of the fill icon raises no picker; a real click does; background tab cannot raise one; observable: main trace + census. Picker content steps pre-marked `[by-eye]`. ~10 steps.
  - `cross-jar-fetch-isolation` (extend) — a page-supplied proxy-shaped URL and a non-web URL in the media list cause no request in any other jar; observable: fixture request log. +3 steps.
  - `download-true-type` — mismatched suggested name saves under the response's true extension; Retry from a jar tab re-requests with that jar's cookie; observable: `downloadsList`, disk, fixture log. ~7 steps.
- **Grep-ACs**: no `ipcMain.handle(` / `ipcMain.on(` outside the gate module; no `vault-fill` listener or payload in main-world preload sources; `shell.openPath` appears at exactly one site; no `isTrustedGet`.
- **Regression re-runs**: `chrome-guest-keyboard-nav`, the save-prompt specs, the capture corpus, `core-browsing-shields`.
- **HAT**: as the `hat-and-alignment` leg.
