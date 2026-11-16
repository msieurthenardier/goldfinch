# Leg: admin-reach

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

While an admin automation session is attached — or script it evaluated is still alive in an internal page — reading a vault secret, reading a cookie value, exporting a vault or minting an automation key takes a native confirmation that no automation tier can answer.

## Context

- Flight DD2 (read it in full; it is the specification). DD3 and the settings-write refusal were split out at design review into the next leg, `admin-key-name` — they do not depend on the dialog. Mission finding 5 and 11. Operator ruling: the confirmation appears **only while the threat exists**; everyday use is unchanged.
- **Q5 is answered** (standalone probe on Electron 45.3.2 / WSLg, 2026-11-14; script and logs in the session scratchpad `dialog-probe/`): `dialog.showMessageBox(win, { …, signal })` on a `BaseWindow` parent cancels within a few milliseconds of `abort()` and **resolves** (never rejects) with `{ response: cancelId }`; a signal already aborted resolves at once with **no `response` key** (`{ cancelId, checkboxChecked }` — read `response ?? cancelId`); the window, its view and the event loop stay healthy; main is not blocked while a dialog is open. **Stacked dialogs on one window only cancel newest-first** — an older one stays unsettled until the newer is dismissed — so the one-dialog-per-window rule in DD2 is a correctness requirement, not a nicety. Closing the parent window with a dialog open does not wedge; whether that promise settles was not observed, so the gate must not depend on it. Not verifiable here: what the dialog looks like, and Windows / macOS behaviour — HAT.
- Why a per-document mark as well as "admin attached": a script evaluated in an internal page can set a timer and wait for its session to close (or for the idle sweep of leg `automation-bounds` to close it). Injected clicks and keys leave nothing behind and need no mark.
- What was checked at flight design review and is **not** in this leg (do not re-audit): the vault list, item save, item copy, access-key list, the chrome's cookie list and every chrome-class channel return no secret; the vault fill channels are refused by Flight 1's picker context; `internal-settings-get` still returns key hashes to internal pages (documented, not gated). Turning automation off and revoking keys are **not** gated — they are the operator's kill switch.
- **A reveal returns the whole item** (`{ item: revealItem(…) }`), every secret field at once; the vault page calls it per field (each eye button and each Copy) and the code widget calls the code read as soon as an item's editor opens, with no click. So the confirmation is **per item, per document**: one dialog covers that item's later reveals and code reads from the same document, and gives the caller nothing the first reply did not already contain. With admin attached, opening the editor of an item that has a one-time code raises the dialog. By-eye at the HAT.
- Also checked at this leg's design review and **not gated** (recorded so they are not re-audited): `internal-vault-state` / `has` / `list` / `accesskey-list`, import labels and the browser-import summary (counts only), `pick-save-path` (a path), `internal-jars-sitedata-list` (origins), `automation:list-keys` (booleans), `automation:get-activity` (typed text and URL queries already redacted), `clipboard:write` (write-only); the destructive but secret-free jar remove / wipe / clear-data; and `internal-settings-set` of `vaultAutoLockMinutes` and `automationPort` — an admin script can lengthen the auto-lock or move the port. Accepted: neither yields a secret, and both are visible in settings.
- The leg `automation-input` (next) handles automation clicks raising the vault picker and jar-key shortcuts. Not here.
- Budgets: `src/renderer/renderer.js` is at 1,504 / 1,505 lines — do not touch it. `src/main/main.js` is 3,052 lines — the gate is its own module; `main.js` gets construction and wiring only.

## Inputs

- Leg `electron-45` landed: Electron 45.3.2; gates green (6,780 tests / 6,776 pass / 0 fail / 4 todo).
- The handlers as they stand:
  - `src/main/register-vault-ipc.js` — `internal-vault-reveal` (`catchLocked((_event, payload) => … revealItem(vaultId, itemId))`), `internal-vault-totp-code` (same store call, returns a code), `internal-vault-export` and `internal-vault-export-profile` (dual-mode: a page-supplied `savePath` writes directly; without one a native save dialog runs).
  - `src/main/jar-data-ipc.js` — `handleCookiesValue` (`internal-jars-cookies-value`; returns `{ ok: true, value }` or `{ ok: false, error }`).
  - `src/main/register-settings-ipc.js` — `internal-settings-set` (`settings.set(key, value)` for any key), `automation:jar-key-mint`, `automation:admin-key-mint` (return `{ key }`), the two revokes.
  - `src/main/internal-ipc.js` `registerInternalHandler` — origin + internal-session check; the handler receives `(event, ...args)`.
  - `src/main/automation/mcp-server.js` — `const sessions = new Map()` holding `{ server, transport, identity, vaultCtx }`; the returned object already exposes `isVaultHeld`; `mintJarKey(jarId, settings, jars)` refuses an unknown jar only when a `jars` accessor is passed; `mintAdminKey` is gated on the launch flag.
  - `src/main/automation/automation-auth.js` `validateKey` — returns the jar-map key verbatim.
  - `src/main/settings-store.js` — the `automationKeyHashes` validator checks values only and rejects the whole map.
  - `src/main/automation/observe.js` `evaluate` / `injectScript` — `resolveContents(wcId, deps)` then `wc.executeJavaScript(…)`. Engine construction sites: `src/main/main.js` (`createEngine(getChromeContents, { … sheetMenuFor … })`) and `src/main/app-lifecycle.js` (the dev-only chrome channel).
  - `src/main/media-proxy-tokens.js` — the pattern for state bound to a document's main-frame token.
  - `src/main/vault/browser-import-flow.js` — the existing awaited native confirm (its `defaultId: 0` is the **affirmative** button — do not copy that).
- Draft spec `tests/behavior/admin-reach-refusal.md`.
- Page callers (design review): `src/renderer/pages/vault.js` — the per-field eye button and Copy (`vaultReveal`), `buildTotpWidget` (`vaultTotpCode`, with `stop()` / `start()` wired to `visibilitychange`, `blur`, `focus`); `jars-cookies-panel.js` (eyeball; a `!ok` reply already goes to its error line); `automation.js` (jar mint and admin mint); `vault-restore-controller.js` and `jars-section-controller.js` → `jars-confirm-modal.js` (the two export flows, the second being the export offered before deleting a jar). `jar-data-ipc.js` is registered through `src/main/jar-ipc.js` `registerJarIpc`.
- Store: `getVaultStore().listItemsMeta(vaultId)` is the non-secret projection (it throws the locked error, like `revealItem`); `catchLocked` in `register-vault-ipc.js` is a **synchronous** try/catch.

## Outputs

- `src/main/reveal-gate.js` (new, Electron-free, injected deps) and its unit tests.
- The gated handlers call it; the internal pages handle a refusal without breaking.
- `tests/behavior/admin-reach-refusal.md` finalised (`active`), with a recorded pre-change run; existing specs that mint, reveal or export through an admin key re-authored.
- `ipc-channel-table.js` unchanged in row count unless a channel is added (none is planned).
- Docs: `CLAUDE.md`, `docs/vault.md`, `docs/mcp-automation.md`, `docs/dev-testing.md`.

## Acceptance Criteria

**The gate module**

- [ ] **AC1 — One decision function.** `reveal-gate.js` exports a factory taking injected deps (`hasAdminSession`, `isTouched(wcId)`, `showConfirm(win, options, signal)`, `windowFor(sender)`, `now`, `setTimeout` / `clearTimeout`, `trace`). Its `confirm(event, request)` resolves to exactly one of `'not-applicable'`, `'confirmed'`, `'denied'`, `'timeout'`, `'busy'`, `'gone'`, `'refused-frame'`. It never throws; an internal error resolves `'denied'`.
- [ ] **AC2 — When it applies.** `'not-applicable'` if and only if `hasAdminSession()` is false **and** the sender's document is not marked touched. No dialog is shown and no state is created on that path (unit: `showConfirm` never called).
- [ ] **AC3 — Sender.** The sender must be the main frame of its `webContents` (compare inside a `try`; a null `senderFrame`, a subframe, or a throw is `'refused-frame'` when the gate applies and is otherwise left to the existing internal-origin check). A touched lookup that throws counts as touched.
- [ ] **AC4 — The dialog.** Parented on the sender's window (resolved main-side from the sender, never from the payload); `type: 'question'`; two buttons with **Cancel first**; `defaultId` and `cancelId` both the Cancel index; `noLink: true`; message names the action and the item; detail says an automation connection is attached to this browser and will be able to read what is shown. The result is read as `response ?? cancelId`. Only the affirmative index is `'confirmed'`.
- [ ] **AC5 — Text is main's and is bounded.** Every string in the dialog comes from main's own data (the store's non-secret item metadata, the cookie actually found, the validated jar or vault name) — never from the request payload — and passes one cleaner: control and Unicode format characters removed, whitespace collapsed, capped at 80 characters with an ellipsis, slicing before any regular expression runs (a cookie name can be large). Extract the realm cleaner's body from `auth-challenges.js` into one shared `cleanDisplayText(text, max)` that `cleanRealm` then calls — one character-class table, not two. A secret never appears in the dialog.
- [ ] **AC6 — One at a time, bounded in time.** While a confirmation is open for a window, any further request for that window resolves `'busy'` immediately (no second dialog — stacked dialogs cannot be cancelled in order). An unanswered dialog is aborted after 60 s (`'timeout'`), when the sender's main frame commits a new document, when the sender is destroyed, and when its window closes (`'gone'`); the abort uses the dialog's `AbortSignal`; the per-window slot is released on **every** exit path, including a `showConfirm` that never settles after its window closed (release on the abort, not on the promise).
- [ ] **AC7 — No grant window; one grant, scoped to an item.** A confirmation covers exactly the request it was shown for, with one exception: after `'confirmed'` for a vault reveal **or** code read of `(vaultId, itemId)`, later reveals and code reads of the same `(vaultId, itemId)` from the same document (same `webContents`, until its next main-frame navigation or destruction) are `'confirmed'` without a dialog. Nothing else is remembered — not another item, not a cookie, not an export, not a mint. Unit: a reveal of another item asks; the same item from another tab asks; after a navigation it asks again.
- [ ] **AC8 — Trace.** With `GOLDFINCH_REVEAL_GATE_TRACE=1`, one line per decision other than `'not-applicable'`: `[reveal-gate] channel=<c> decision=<d> reason=<admin-attached|touched>`. Never an item name, cookie name, path or id.

**The mark**

- [ ] **AC9 — Script marks the document.** The engine's `evaluate` and `injectScript` call an injected `markScripted(wc)` **after** `resolveContents` and **before** `executeJavaScript`; the mark stands if the script throws. It is keyed on the target's `webContents` id. Threaded through `deps()` with the same conditional-spread idiom as `sheetMenuFor` in `engine.js`.
- [ ] **AC10 — Every production engine site.** The setter is passed at both production `createEngine` call sites (`src/main/main.js`, inside the `getEngine` arrow, and `src/main/app-lifecycle.js`, the dev-only chrome channel, which has no session and so relies on the mark alone). A source-scan test copied from `test/unit/sheet-automation-gate-invariant.test.js` ("sheetMenuFor is wired at BOTH createEngine sites") fails if either lacks it, and is neuter-verified. Keep the literal spelling `createEngine(getChromeContents` (another pin keys on it). The engine tolerates an absent setter, as it does `sheetMenuFor`, so existing engine unit tests construct it unchanged; the pin is what holds production.
- [ ] **AC11 — Lifetime.** The mark is dropped on every main-frame navigation that is not in-page (`did-navigate`) and when the contents are destroyed; an in-page navigation keeps it. (A reload may reuse the frame, so the frame token is not the discriminator.) Hook it where the media-proxy token store is already hooked in `guest-wiring.js` — **and confirm that code path runs for internal tabs**; if it sits inside a web-only guard, add the two listeners for internal tabs explicitly. Unit-tested on the store; one integration test that an internal tab's `did-navigate` drops its mark.

- [ ] **AC12 — Reveal.** `internal-vault-reveal` becomes async with its own locked mapping (the synchronous `catchLocked` cannot wrap an awaited gate): `listItemsMeta(vaultId)` first — a locked vault returns `{ locked: true }` **before** any dialog, and it supplies the label; no matching item → today's path with no dialog; otherwise the gate; `'not-applicable'` or `'confirmed'` → `revealItem` exactly as today, still mapped to `{ locked: true }` if the vault locked while the dialog was up; anything else → `{ refused: 'not-confirmed' }` and `revealItem` is **not called**.
- [ ] **AC13 — Code read.** `internal-vault-totp-code`: the same sequence; refusal is `{ code: null, refused: 'not-confirmed' }`.
- [ ] **AC14 — Cookie value.** `handleCookiesValue`: validation and the lookup run first, as today; only when a cookie was found is the gate consulted (label: the cookie's name and domain, cleaned); refusal is `{ ok: false, error: 'jars: cookies-value — not-confirmed' }` and the value is not placed in the reply. After a confirmation the cookie is fetched again and that value returned (the first read may be a minute old); if it is gone, `not-found` as today.
- [ ] **AC15 — Export.** `internal-vault-export` and `internal-vault-export-profile`: when the gate applies, a confirmation naming the vault(s) is required **before** the bundle is built; refusal uses the handler's existing non-success shape plus `refused: 'not-confirmed'`. (Design decision recorded here: export returns no plaintext but lets the caller choose where an encrypted bundle is written — gated rather than accepted, since the gate is one call. The dialog names the vault(s) and the destination folder's name, cleaned. The gate is required even when the save delegate is absent and these two handlers are not registered.)
- [ ] **AC16 — Minting.** `automation:jar-key-mint` and `automation:admin-key-mint`: gate first (label: the jar's name, or "the admin key"); refusal is `{ key: null, refused: 'not-confirmed' }`, nothing is written, and no `settings-changed` is broadcast. The two revokes and `internal-settings-set` of `automationEnabled` are **not** gated (unit pin: with an admin session attached they behave as today).
- [ ] **AC17 — Mandatory wiring.** Each registrar that owns a gated handler (`registerVaultIpc`, `registerSettingsIpc`, and `registerJarDataIpc` through `registerJarIpc`) takes the gate as a required dependency and throws at registration if it is missing. About fourteen test construction sites change by one line each (design review listed them: `register-vault-ipc.test.js` ×9, `vault-totp-code-handler.test.js`, `vault-compromise-report-surface.test.js`, `register-settings-ipc.test.js`, `test/unit/helpers/settings-ipc-harness.js`, `test/unit/helpers/jar-ipc-harness.js`). Unit tests use a real gate built from fakes (a small helper beside `test/helpers/ipc-gate-fixture.js`), not a stub that always says yes.
- [ ] **AC18 — Unchanged when not applicable.** With no admin session and an unmarked document, every gated handler's reply is byte-for-byte what it is today (unit: existing registrar tests pass with the real gate in its not-applicable state, unmodified in their assertions).

**Pages**

- [ ] **AC19 — A refusal is handled, at every caller.** Today's page code mishandles an unexpected reply; each needs an explicit `refused` branch, with a mock-DOM unit test:
  - vault eye button: today an absent `item` marks the field revealed and empty → it stays hidden, with a status line;
  - vault Copy: today it would write an **empty string to the operator's clipboard** → no clipboard write at all;
  - the code widget: a refusal is handled **before** its `stopped` check and sets a latched `denied` flag that `start()`, the focus handler and the visibility handler all respect — a native dialog blurs the window, and without the latch the widget asks again on every refocus, forever. Unit: deny → focus → no second request. A confirmed first reply must not be discarded because the dialog's blur set `stopped`;
  - jar mint: today a null key opens an empty reveal box → no box (the admin mint already guards);
  - the jars cookie eyeball: already quiet; it gains a distinct message for the `not-confirmed` suffix;
  - the two export flows: a `refused` branch; in the export-before-delete offer a refused export neither proceeds to the delete nor blocks the operator from choosing to delete.
  Patch in place — never rebuild the node holding focus. The status lines use these existing live regions, and the leg asserts every other announcement sharing each still fires: vault `#vault-root` (polite; a new line must not sit under the filter's `aria-live="off"` scope) and the editor shell's status; jars `jars-cookies-panel.js` status line and `#jars-page-error`; automation `#automation-key-message` (shared with "Copied" and errors) and `#automation-message`; `jars-confirm-modal.js` error and export-result lines.

- [ ] **AC22 — The gate reads the right thing.** The server object exposes `hasAdminSession()` beside `isVaultHeld` — true iff some entry in the session map has identity exactly `'admin'` (the pending-session counter does not count: identity is bound when the session enters the map, before any tool call can carry its id). The gate receives it as `() => mcpServer?.hasAdminSession?.() === true`, built in `main.js` after the `mcpServer` binding is declared (TDZ rule) — no server reads false. A session whose key was revoked stays in the map until it closes, so the gate stays on a little longer than strictly needed: conservative, documented.

**Evidence and docs**

- [ ] **AC23 — Pre-change record.** Before any source change in this leg, on the current tree, a scripted run (scratch profile, admin key) shows: an admin `evaluate` on `goldfinch://jars` obtaining a known fixture cookie's value, and on `goldfinch://automation` minting a jar key (state precisely what was observed). Output saved in the scratchpad and summarised in the flight log. This is the non-vacuity record for `admin-reach-refusal`.
- [ ] **AC24 — The spec is final.** `tests/behavior/admin-reach-refusal.md` is updated to the real bridge method names, the refusal shapes above, the trace flag, the 60 s wait and the `'busy'` rule (the run should not wait 60 s three times if it can show one timeout and then the immediate refusals honestly — but each gated action must be exercised at least once on its own), a **required** step for the scripted-document mark outliving its session (the client evaluates a call armed on a timer that stores its eventual reply on the page, closes its session, waits, re-attaches and reads the stored reply: a refusal, and the trace line's reason is `touched`) — this is the only trigger-driven proof of condition (b), a note that a native dialog will appear on the operator's screen during the run and must not be clicked, and status `active`. Step 8 (vault reveal) stays conditional on an operator-unlocked vault, so reveal and the code read have no unattended trigger-driven proof: the spec says so, and the HAT walks them. The key-hash settings-write step moves to leg `admin-key-name`.
- [ ] **AC25 — Existing specs.** Every spec under `tests/behavior/` whose steps mint or revoke a key, reveal an item or cookie value, or export a vault through an admin-keyed `evaluate` is listed in the flight log with the step numbers, and re-authored so the step either runs before an admin session attaches, is performed through a path that is not gated, or is marked `[by-eye]`. Design review's reading, to be re-walked step by step rather than trusted: `settings-automation` steps 8 and 10 and its cleanup (they click Generate / Rotate / admin mint with an admin key attached — an injected click is gated by condition (a) and would hang 60 s each); `vault-copy-item` (its observable calls `vaultReveal` by admin `evaluate` for per-field equality — needs the operator's confirmation per item or another equality method); `automation-key-gating` appears unaffected (reads `disabled`; clicks Revoke, which is not gated). Also walk `jar-data-controls`, `jar-data-surfaces`, `vault-filter`, `session-restore`, `mcp-auth-gating`, `jar-key-revocation-on-delete`.
- [ ] **AC26 — Docs.** `docs/mcp-automation.md` and `docs/vault.md` state what each tier can reach: what admin script in an internal page can and cannot do now, the confirmation, that a confirmed value is readable by the attached automation, that a key holder can read back a password from a page it filled (finding 17c), and that key hashes are still returned to internal pages. `CLAUDE.md` gains the gate under *Internal-bridge security model* (what is gated, the two conditions, the one-dialog rule, "adding a secret-returning internal channel means calling the gate") and corrects the line that says admin reaching internal pages is unrestricted. `docs/dev-testing.md` documents the trace flag.
- [ ] **AC27 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass. Live smoke on a scratch profile exercising every apparatus primitive against the new state, plus: with admin attached, a gated call opens a dialog (observable as the call staying pending and the `[reveal-gate]` trace after the timeout) and the window remains responsive meanwhile (`enumerateWindows` answers); with the dialog pending, a second gated call returns `'busy'` at once; after the timeout the app quits cleanly.

## Verification Steps

- AC1–AC8, AC11: `test/unit/reveal-gate.test.js` with an injected clock and a fake `showConfirm` that records its options and settles on command or on abort — including the already-aborted shape with no `response` key, and a `showConfirm` that never settles.
- AC9–AC10: `test/unit/automation-observe.test.js` additions; the new source-scan test, neuter-verified (remove the setter from one site, see it fail).
- AC12–AC18: the registrar suites (`register-vault-ipc`, `jar-data-ipc`, `register-settings-ipc`) with the real gate in three states (not applicable, confirm, deny).
- AC19: page-controller unit tests against the mock DOM for each refusal; by-eye wording at the HAT.
- AC20–AC22: `automation-auth`, `settings-store`, `mcp-server` unit tests.
- AC23, AC27: the smoke scripts' output in the flight log.
- AC24–AC26: read by the Flight Director; the spec is then run by the Flight Director (Executor and separate Validator) and must pass before the leg is counted complete.

## Implementation Guidance

1. **AC23 first**, before touching source. Scratch profile; `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`; `connectAutomation()`; the `cross-jar-fetch` fixture for a known cookie. Do not touch any vault sheet or type a master password. Revoke nothing in the operator's real profile — scratch only.
2. **The store and the gate** (`reveal-gate.js`): pure, small, modelled on `media-proxy-tokens.js` for the mark and on `auth-challenges.js` for "settle exactly once". Write its tests before wiring.
3. **Wire the mark** into `observe.js` through `deps()`; thread the setter at every `createEngine` site; add the source-scan pin.
4. **Wire `hasAdminSession`** from the server; build the gate in `main.js` with the late-bound getter; hand it to the three registrars.
5. **Handlers**, one family at a time (thread the gate through `registerJarIpc`), each with its registrar tests. Keep the existing early returns (locked, unknown jar, malformed payload) ahead of the gate so a dialog is never raised for a request that would fail anyway.
6. **Pages**. Find each caller of the gated bridge methods (`grep -rn "vaultReveal\|vaultTotpCode\|jarsCookiesValue\|KeyMint\|vaultExport" src/renderer/pages src/preload/internal-preload.js`) and handle the refusal.
7. **Spec and docs** (AC24–AC26). **Live smoke** (AC27).
8. Do not commit. Leg status `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **A dialog is open and the operator locks the vault**: the confirmation, if then given, must not reveal — after `'confirmed'` the handler runs the same store call as today and returns `{ locked: true }`.
- **The item is deleted while the dialog is open**: the store call fails as it does today; no stale label is reused.
- **Two windows**: the busy slot is per window; a confirmation in window A does not block a request from window B, and each dialog is parented to its own window.
- **The sender has no window** (a tab mid-move, or contents not in any record): `'gone'` — never an unparented dialog.
- **Admin attaches while a dialog-free reveal is in flight**: the decision is taken once, at the start of the handler; no re-check.
- **Admin detaches while a dialog is open**: the dialog stays; the operator's answer is honoured.
- **The page asks for a code before any reveal of that item** (the list view): gated like a reveal, with its own dialog.
- **An internal page reloads itself after being scripted**: the mark is dropped at the commit; with the admin session gone the gate no longer applies. That is intended — the reload destroyed the script.
- **`showConfirm` rejects** (it should not): `'denied'`, slot released.
- **Dev-mint launches** print an admin key and attach nothing until a client connects: no admin session, no gate — the dev page flows keep working until a spec attaches as admin.
- **macOS / Windows dialog behaviour** (sheets, task dialogs) is unverified: by-eye, HAT. Do not branch on platform beyond what Electron requires.
- **Anything that needs a design call** (a channel that returns a secret and is not listed here; a page flow that cannot handle a refusal without a redesign): stop and report `[BLOCKED:<reason>]` rather than deciding.

## Files Affected

- `src/main/reveal-gate.js` (new); `src/main/main.js` (construct, wire); `src/main/app-lifecycle.js` (engine site).
- `src/main/register-vault-ipc.js`, `src/main/jar-data-ipc.js`, `src/main/jar-ipc.js`, `src/main/register-settings-ipc.js`, `src/main/auth-challenges.js` (cleaner extraction), `src/main/guest-wiring.js` (mark lifetime).
- `src/main/automation/observe.js`, `engine.js`, `mcp-server.js`.
- `src/renderer/pages/` — the vault, jars and automation page controllers that call the gated methods.
- `test/unit/**` — new `reveal-gate.test.js`, the engine-site pin, additions to the registrar, auth, settings-store, observe and page suites; `test/helpers/` gate fixture.
- `tests/behavior/admin-reach-refusal.md` and the re-authored specs.
- `CLAUDE.md`, `docs/vault.md`, `docs/mcp-automation.md`, `docs/dev-testing.md`.

## Citation Audit

Read at leg design (2026-11-14, tree after `electron-45`): `register-vault-ipc.js` `internal-vault-reveal` / `internal-vault-totp-code` / `internal-vault-export` (dual-mode comment present); `jar-data-ipc.js` `handleCookiesValue`; `register-settings-ipc.js` `internal-settings-set` and the four key handlers; `internal-ipc.js` `registerInternalHandler`; `automation-auth.js` `validateKey` (jar loop returns `jarId`); `settings-store.js` `automationKeyHashes` validator (values only); `mcp-server.js` `sessions` map, `isVaultHeld` in the returned object, `mintJarKey`, `mintAdminKey`; `observe.js` `evaluate` / `injectScript`; `createEngine(` at `main.js` and `app-lifecycle.js`; `media-proxy-tokens.js` frame-token map; `browser-import-flow.js` `showMessageBox` dep. Developer design review (Sonnet, 2026-11-14): approve with changes, adopted — the code widget's refocus loop and the three page callers that mishandle an unexpected reply (one would have emptied the operator's clipboard); the editor does not reveal on open, so the grant is per item per document; `catchLocked` is synchronous; the gate dependency's fourteen test sites and `jar-ipc.js`; the mark keyed on the tab and dropped on navigation rather than on a frame token a reload may keep; the setter grep-pinned at the two production sites rather than thrown at construction; the timer step made mandatory; the cleaner extracted; DD3 and the settings-write refusal split into leg `admin-key-name`. No second pass: every change is the reviewer's own correction, and the split removes scope.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
