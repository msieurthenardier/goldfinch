# Flight: Policy and IPC Hardening Batch

**Status**: ready

> Architect design review: **approve with changes** (2026-07-25) — incorporated: HIGH `tab-navigate` internal-tab regression (branch trusted/web like guest-wiring, not unconditional isSafeTabUrl); MED owning-chrome tightening on wcId-scoped channels; MED `web-contents-created` latch must be read *inside* the handler (else guest browsing breaks); MED nav guards are a live behavior change (non-http redirect divert trigger + real cross-scheme redirect in the live pass); permission-union asymmetry note; leg split (mechanical IPC vs live-behavior permission/nav). Autonomous phase-gate progression pre-authorized (issue #131 directive).
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
- **`tab-navigate` also gets a URL-safety gate** on the `loadURL` arg (`register-tab-ipc.js:654`, the `loadURL(args[0])` branch) — parity with `automation/nav.js`. **CRITICAL (design review, HIGH)**: it must NOT be an unconditional `isSafeTabUrl` — `openSiteSettingsTab` (`overlay-menus.js:120`) legitimately navigates an *existing internal tab* to `goldfinch://settings/#privacy`, which `isSafeTabUrl` rejects. Mirror `guest-wiring.js:73-79`'s branch: resolve whether the target tab is trusted/internal (via the `tabViews` entry's `trusted` flag or `isInternalContents(wc)`) and gate with `isInternalPageUrl` for internal, `isSafeTabUrl` for web. There is **no** existing test for the `loadURL` verb — add both a web-tab (unsafe refused) and an internal-tab (`goldfinch://` allowed) case.
- **Owning-chrome, not any-chrome (design review, MEDIUM)**: for the six wcId-scoped channels (`tab-close`, `tab-hide`, `tab-set-active`, `tab-set-bounds`, `tab-navigate`, `tab-find`), tighten to `registry.getWindowForChrome(event.sender) === registry.getWindowForGuest(wcId)` — the established owned-resource pattern in this file (`tab-drag-started` checks `rec.tabViews.has(wcId)`). Prevents window A's chrome acting on window B's tabs. The non-wcId-scoped chrome-trust channels (`new-container-create`, `identity-new`, `privacy-*`) just need `requireChrome` (they act on the sender's own context or a session).
- Where a channel genuinely cannot resolve a chrome sender (e.g. `closed-tab-stack-size` takes no event), document why in a comment rather than forcing a check.
- Permission-handler union note (design review, LOW): Electron 43's request/check handlers take *different* permission-string unions (`speaker-selection`/`window-management`/`display-capture`/`keyboardLock`/`unknown` are request-only; `hid`/`serial`/`usb`/`deprecated-sync-clipboard-read` check-only). A single shared allowlist Set works for both at runtime; add a one-line comment so nobody "fixes" the apparent asymmetry.
- Tests: `register-browser-ipc.test.js` (the `new-container-create` test currently pins the *no-check* behavior — invert it; the `get-zoom`/`toggle-devtools`/`page-context-action` `{}`-event calls need a valid sender) + `register-tab-ipc.test.js`; assert a non-chrome sender is refused on a representative channel from each file, and that `tab-navigate` refuses an unsafe `loadURL`.

**DD3 — Navigation guards: subframe + redirect + a `web-contents-created` catch-all (finding 5)**
- In `wireGuestContents` (`guest-wiring.js:72`), add `will-frame-navigate` and `will-redirect` beside `will-navigate`, same session-aware predicate (internal → `isInternalPageUrl`, web → `isSafeTabUrl`), placed before the internal-session early return so both branches are covered.
- Add `app.on('web-contents-created', (e, contents) => …)` (in `app-lifecycle.js` or `main.js` composition) applying URL-independent guards to **every** webContents: a `setWindowOpenHandler` that denies (a setter — last-attached wins, so the guest's own forward-and-deny handler installed later safely overrides; no clobber risk) plus a navigation guard.
- **CRITICAL latch semantics (design review, MEDIUM)**: `web-contents-created` fires *synchronously during* `new WebContentsView()`, before `wireGuestContents` runs — so at attach time the catch-all cannot distinguish a future guest tab from a chrome/overlay view. The catch-all's `will-navigate`/`will-frame-navigate`/`will-redirect` listeners are **additive** and stay attached to guest tabs. Therefore the guard must **read a latch INSIDE the event handler** (not merely gate whether to attach): guest tabs get `__goldfinchNavGuarded` set by `wireGuestContents` (which runs synchronously before any navigation can occur), and the catch-all handler early-returns when the latch is present (the guest's own predicate already covers it) — otherwise an unconditional catch-all listener fires on every real guest navigation and **breaks ordinary web browsing wholesale**. Pin the "wireGuestContents runs synchronously before first navigation" ordering with a comment.
- The non-guest views (chrome, find/menu/tearoff overlays, DevTools frontend) are trusted `file://` surfaces — their catch-all guard is a genuine deny-by-default no-op. (Verify the DevTools frontend webContents isn't disrupted by the catch-all's nav guard — DevTools does its own internal navigation.)
- Tests: `guest-wiring.test.js` (subframe + redirect events enforce the predicate) AND a test asserting a guest tab's legitimate `https→https` navigation is **not** blocked by the catch-all (the latch works); a catch-all test asserting a newly-created non-guest webContents has a window-open denial + nav guard.

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
- The empirical permission pass shows a legitimately-needed permission that's sharp (e.g. a site genuinely needs `openExternal` or the File System Access API `fileSystem` — both flip granted→denied under DD1) → escalate the allowlist decision rather than silently granting.
- The `web-contents-created` catch-all double-wires or breaks the explicit guest wiring in a way that's not cleanly idempotent → fall back to adding the subframe/redirect guards to the explicit wiring only (guest + the four named non-guest views), skipping the global net, and document the residual.
- **A legitimate redirect or subframe navigation to a non-http scheme is refused** (design review, MEDIUM): `will-redirect`/`will-frame-navigate` were fully unguarded before — this is a *live behavior change*, not pure defense-in-depth. A real cross-scheme flow (OAuth/payment app-handoff redirect to a custom scheme, `intent://`) that worked before would now be cancelled. The live `tab-scheme-guard` pass must include at least one **real cross-scheme redirect** (not just same-scheme); if a legitimate one breaks, scope the guest redirect/subframe guard down (e.g. keep will-navigate + the catch-all for non-guest views, reconsider will-redirect breadth) rather than shipping a browsing regression.

**Acceptable variations**:
- Exact allowlist membership (empirically driven), the helper's name/shape, whether the catch-all lives in `app-lifecycle.js` or `main.js`.

### Legs

> **Note:** Tentative; planned one at a time.

> Leg split (design review): the mechanical IPC-sender work is separated from the two live-behavior-change items (permission allowlist, nav guards) so a live-verification regression in one doesn't entangle the already-unit-verified other.

- [ ] `permission-allowlist` — invert to positive allowlist (DD1); unit (invented-denies + granted) + **FD empirical real-page pass** (must include a File System Access API site + an `openExternal`/registered-protocol flow, not just the named sharp edges). *(live behavior change)*
- [ ] `ipc-sender-and-vault-guard` — `requireChrome`/owning-chrome gate across the unguarded chrome-trust channels + the trusted-vs-web-branched URL gate on `tab-navigate` (DD2), plus the vault-capture `isTrusted` guard (DD4, one line, self-contained). Pure unit work — mechanical, no live verification needed. Invert the `new-container-create` no-check test pin; add `loadURL` web + internal-tab cases; representative refusal tests.
- [ ] `nav-guards` — `will-frame-navigate`/`will-redirect` on guests + `web-contents-created` catch-all with the read-inside-handler latch (DD3); unit (subframe/redirect enforce predicate; guest https→https NOT blocked; non-guest view denied); **FD live pass** extending `tab-scheme-guard.md` with subframe + a real cross-scheme redirect. *(live behavior change — the riskiest leg)*

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
