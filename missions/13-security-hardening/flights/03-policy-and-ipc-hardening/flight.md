# Flight: Policy and IPC Hardening Batch

**Status**: planning
**Mission**: [Web-Content Security Hardening](../../mission.md)

## Contributing to Criteria

- [ ] Permission requests are governed by a positive allowlist: any permission string not explicitly enumerated — including ones that don't exist yet — is denied, and a unit test proves an invented permission denies. The chrome privacy indicator keeps receiving grant/deny events. *(finding 2)*
- [ ] Every chrome-trust IPC channel either verifies its sender is a chrome renderer (or documents why it can't), and `tab-navigate`'s URL argument passes the same safety gate as every other navigation entry point. A test asserts a non-chrome sender is refused on a representative channel. *(finding 4)*
- [ ] Subframe navigations and server-side redirects are subject to the same URL-safety predicate as top-level navigations, and every webContents in the app — chrome, overlays, sheets, DevTools — has a window-open denial handler and a navigation guard. *(finding 5)*
- [ ] The vault-capture path either ignores synthetic (page-dispatched) submit events, or the accepted-tradeoff note explicitly covers the update-disposition case. *(finding 6)*

---

## Pre-Flight

### Objective

Close the four remaining audit findings — mostly mechanical defense-in-depth with a shared risk profile (nothing web-reachable exploits them today; each hardens the blast radius of a *future* regression). (2) Invert the permission handler from a 12-entry deny-list to a positive allowlist so unknown/future permissions deny by default. (4) Add sender-identity validation to the chrome-trust IPC channels that ignore it, and apply `isSafeTabUrl` to `tab-navigate`'s `loadURL` arg (the one live-ish gap — parity with the automation path that already closed it). (5) Add `will-frame-navigate` + `will-redirect` alongside the existing `will-navigate`, and an `app.on('web-contents-created')` catch-all so non-guest views (chrome, overlays, DevTools) get a window-open denial + navigation guard. (6) Add the `isTrusted` guard to the vault-capture `submit` listener (the sibling icon handlers already have it).

### Open Questions

- [x] Which permissions must the allowlist keep granted? → The app itself requests **nothing** (recon: no `getUserMedia`/`requestFullscreen`/device-permission handlers anywhere in `src/`); the risk is purely web-content regression. DD1 seeds the allowlist from real-usage web features (`fullscreen`, `clipboard-sanitized-write`, `pointerLock`, `mediaKeySystem`, `storage-access`, `top-level-storage-access`) and verifies empirically before shipping.
- [x] `bluetooth` in the current deny-list is dead (not in Electron 43's permission unions) — dropped in the rewrite.
- [x] Does `web-contents-created` conflict with the existing explicit guest wiring? → No. The comment at `register-tab-ipc.js:112-114` objects only to *identification timing* (the view isn't identifiable when the event fires synchronously during construction). A catch-all that applies **URL-independent** guards (`setWindowOpenHandler` deny + `will-navigate`/`will-frame-navigate`/`will-redirect`) doesn't need identification and doesn't double-wire (guest wiring stays explicit; the net covers only views not already covered, idempotently).

### Design Decisions

**DD1 — Permission policy: invert to a positive allowlist (finding 2)**
- `session-runtime.js:4-17`: replace `SENSITIVE_PERMISSIONS` (deny-list) with `ALLOWED_PERMISSIONS` (positive set). Both handlers compute `granted = ALLOWED_PERMISSIONS.has(permission)`. Unknown/new/`'unknown'` strings deny by default.
- Seed the allowlist empirically: start from the web features real sites need that are harmless-to-grant (candidates: `fullscreen`, `clipboard-sanitized-write`, `pointerLock`, `mediaKeySystem`, `storage-access`, `top-level-storage-access`, `speaker-selection`, `window-management`), drive real pages against an instrumented handler (FD live pass) to confirm nothing legitimate breaks, and **exclude** the sharp edges (`openExternal`, `media`, `geolocation`, `notifications`, `midi`/`midiSysex`, `hid`/`serial`/`usb`, `display-capture`, `idle-detection`, `clipboard-read`, `keyboardLock`, `fileSystem`) — those keep denying (they were denied before as the deny-list's members, or are newly-denied sharp edges).
- **Preserve the `privacy-permission` push** (`session-runtime.js:231`, payload `{ webContentsId, permission, granted }`) exactly — the chrome privacy indicator consumes it.
- **Preserve the internal-session exclusion** (the handlers install inside `applyShields`, which early-returns on `__goldfinchInternal`).
- Test: `session-runtime.test.js` gains an **invented-permission-denies** assertion (e.g. `handlers.permissionRequest({id:1}, 'some-future-perm', cb)` → `false`) and a granted-permission assertion (currently none exists); both handlers share the one set.

**DD2 — IPC sender validation: add a `requireChrome(event)` gate to unguarded chrome-trust channels (finding 4)**
- Introduce one small helper (model: `register-overlay-ipc.js`'s `recordForOverlaySender`): `requireChrome(event) → rec|null` = `registry.getWindowForChrome(event.sender)`, early-return on null. Apply it to the chrome-trust channels that currently ignore the sender: `new-container-create`, `rescan-media`, `zoom-apply`/`get-zoom`, `print`, `toggle-devtools`/`is-devtools-open`, `page-context-action`/`page-context-correct`, `identity-new`, `privacy-cookies`/`privacy-clear-cookies`/`privacy-clear-storage`, `tab-find`, `tab-history-snapshot`, `tab-navigate`, `tab-close`, `tab-hide`, `tab-set-active`, `tab-set-bounds`.
- **Distinguish the two IPC classes** — recon flagged this: channels that resolve their target from a **payload wcId** (`tab-close`, `tab-hide`, `tab-set-active`, `tab-set-bounds`, `tab-navigate`, `tab-find`, `rescan-media`) currently do NOT verify the caller; add `requireChrome`. Channels that resolve from `event.sender.id` (self-scoped: `vault-*`, `guest-*`, `shields-farble`) are already caller-bound — leave them. The existing target-guards (`externalContents`, internal-session checks) stay as additional gates, not replacements.
- **`tab-navigate` also gets `isSafeTabUrl`** on the `loadURL` arg (`register-tab-ipc.js:654`, the `loadURL(args[0])` branch) — parity with `automation/nav.js`, which documents closing exactly this bypass. Refuse (no-op) an unsafe URL.
- Where a channel genuinely cannot resolve a chrome sender (e.g. `closed-tab-stack-size` takes no event), document why in a comment rather than forcing a check.
- Tests: `register-browser-ipc.test.js` (the `new-container-create` test currently pins the *no-check* behavior — invert it; the `get-zoom`/`toggle-devtools`/`page-context-action` `{}`-event calls need a valid sender) + `register-tab-ipc.test.js`; assert a non-chrome sender is refused on a representative channel from each file, and that `tab-navigate` refuses an unsafe `loadURL`.

**DD3 — Navigation guards: subframe + redirect + a `web-contents-created` catch-all (finding 5)**
- In `wireGuestContents` (`guest-wiring.js:72`), add `will-frame-navigate` and `will-redirect` beside `will-navigate`, same session-aware predicate (internal → `isInternalPageUrl`, web → `isSafeTabUrl`), placed before the internal-session early return so both branches are covered.
- Add `app.on('web-contents-created', (e, contents) => …)` (in `app-lifecycle.js` or `main.js` composition) applying URL-independent guards to **every** webContents: a `setWindowOpenHandler` that denies (for views that don't already set one — the guest sets its own that forwards-and-denies; the net must not clobber it) and the `will-navigate`/`will-frame-navigate`/`will-redirect` predicate for any view not already explicitly wired. Design it to be **idempotent / non-clobbering** with the explicit guest wiring (e.g. a `__goldfinchNavGuarded` latch, or only attach to contents whose type isn't a guest tab). The non-guest views (chrome, find/menu/tearoff overlays, DevTools) are trusted `file://` surfaces, so their guard is a deny-by-default catch-all, not a functional change.
- Tests: `guest-wiring.test.js` (subframe + redirect events enforce the predicate); a catch-all test asserting a newly-created non-guest webContents has a window-open denial + nav guard.

**DD4 — Vault-capture `isTrusted` guard (finding 6)**
- `webview-preload.js` submit listener (`:329`): add `if (!(isTrustedGet ? isTrustedGet.call(e) : e.isTrusted)) return;` at the top — the module-scope `isTrustedGet` (captured at `:235-242`) is already in scope. Mirrors the sibling `readTrusted` guard in `vault-fill-icon.js:191`.
- Rewrite the accepted-tradeoff comment (`:324-327`) to reflect that synthetic submits are now ignored (closing the spurious-offer AND the sharper update-disposition case the audit flagged). Source edit propagates via the bundle (regenerated at every entry).
- Test: a `webview-preload` submit test is awkward (the file has top-level DOM side effects, unrequirable in plain Node) — instead pin via the `vault-fill-icon`-style pattern if extractable, or a grep-AC that the guard literal is present. Prefer the cheapest sound check.

**DD5 — Sequencing & batch coherence**
- The four findings share one risk profile (mechanical, defense-in-depth, no live exploit) and touch adjacent files, so they batch into one flight. Legs split by finding-cluster where the design decisions are independent: permission (2) + IPC-sender (4) + nav-guards (5) are all main-process policy edits with overlapping test files; vault (6) is a one-line preload guard. Leg breakdown groups them to minimize churn while keeping each leg's acceptance independently checkable.

### Prerequisites

- [x] Flights 1 & 2 landed (branch stacked); `npm test` green
- [ ] Live apparatus for the permission empirical pass + nav-guard behavior test (`dev:automation` + real pages) — verified at execution
- [x] Recon complete (flight log): full IPC inventory, permission unions, nav-guard gaps, vault listener

### Pre-Flight Checklist

- [x] Open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified (live apparatus at execution)
- [x] Validation approach defined
- [ ] Legs defined (pending design review)

---

## In-Flight

### Technical Approach

Main-process policy edits (permission allowlist, IPC sender gate + `tab-navigate` URL safety, navigation guards) plus a one-line preload guard. Each finding gets unit coverage in its existing test file; the permission allowlist and nav guards additionally get live/behavior verification (permission empirical pass; extend `tab-scheme-guard.md` with subframe/redirect steps). No schema, no interface break, no cross-jar data changes — pure hardening.

### Checkpoints

- [ ] Permission handler is a positive allowlist; invented permission denies (unit); privacy indicator still fed; real pages don't regress (FD live)
- [ ] Unguarded chrome-trust channels validate the sender; `tab-navigate` applies `isSafeTabUrl`; representative refusal tests pass
- [ ] Subframe + redirect navigations enforce the predicate; every webContents has a window-open denial + nav guard
- [ ] Vault-capture ignores synthetic submits
- [ ] Full gate green; relevant behavior tests pass

### Adaptation Criteria

**Divert if**:
- The empirical permission pass shows a legitimately-needed permission that's sharp (e.g. a site genuinely needs `openExternal`) → escalate the allowlist decision rather than silently granting.
- The `web-contents-created` catch-all double-wires or breaks the explicit guest wiring in a way that's not cleanly idempotent → fall back to adding the subframe/redirect guards to the explicit wiring only (guest + the four named non-guest views), skipping the global net, and document the residual.

**Acceptable variations**:
- Exact allowlist membership (empirically driven), the helper's name/shape, whether the catch-all lives in `app-lifecycle.js` or `main.js`.

### Legs

> **Note:** Tentative; planned one at a time.

- [ ] `permission-allowlist` — invert to positive allowlist (DD1); unit (invented-denies + granted) + FD empirical real-page pass.
- [ ] `ipc-sender-and-nav-guards` — `requireChrome` gate across unguarded chrome-trust channels + `isSafeTabUrl` on `tab-navigate` (DD2); `will-frame-navigate`/`will-redirect` + `web-contents-created` catch-all (DD3); unit refusal tests; extend `tab-scheme-guard.md` with subframe/redirect.
- [ ] `vault-capture-trusted-guard` — `isTrusted` guard on the submit listener + comment rewrite (DD4); cheapest sound pin. *(May fold into the leg above if small — decided at leg design.)*

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged (branch `flight/03-policy-and-ipc-hardening`, `flight/03: …` + `Mission: 13`)
- [ ] Tests passing (`npm test`, lint, typecheck)
- [ ] Documentation updated (CLAUDE.md permission-policy + IPC-sender + nav-guard invariants if the existing notes drift)

### Verification

- Unit: invented-permission-denies; sender-refusal on a representative channel per file; `tab-navigate` unsafe-URL refusal; subframe/redirect predicate; catch-all window-open denial.
- Live/behavior: FD permission empirical pass (real pages don't regress); `tab-scheme-guard` extended with subframe + redirect steps; full gate green.
