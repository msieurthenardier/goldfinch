# Proposal: Script-Opened Popups & `window.opener` — Design Ruling

**Flight**: [Popup & Opener Ruling + Implementation](flight.md)
**Status**: awaiting human ruling (mission gate — no popup implementation until approved)
**Grounding**: every mechanism claim below was **observed directly** in a throwaway spike on Electron 43.2.0 against this repo at `71a4f15` (spike report summarized in the flight log; worktree discarded, no code landed).

## The problem (recap)

`window.open()` returns `null` today: every popup is denied and re-created as an ordinary tab with no opener relationship (`guest-wiring.js:89`). The dominant OAuth/SSO pattern — popup completes sign-in, `postMessage`s the result to `window.opener`, closes itself — hangs silently. Mission criteria require a working OAuth popup flow (local fixture automated; live GitHub witnessed), automation-census visibility for popups, and a human-approved ruling with a per-contents parity checklist.

## What the spike established (Electron 43 facts)

1. **`setWindowOpenHandler` → `{action:'allow'}` preserves the opener fully** — live handle, bidirectional `postMessage`, shared jar session (automatic and non-negotiable: Electron pre-creates the popup contents on the opener's session; a `partition` override is silently ignored).
2. **The `createWindow` override is an *adopt* hook, not a *construct* hook**: Electron hands you a **pre-created, opener-linked `options.webContents`**. Wrapping it in a `WebContentsView` and adding it to the *existing* BaseWindow works — popup renders in-window, opener live, postMessage both ways. **Returning any other contents wedges the opener renderer permanently, with no error** — the one absolute implementation taboo.
3. **Teardown is manual** in the adopt path: `window.close()` destroys the popup contents (host window untouched — the #119 hazard doesn't apply), but the dead view stays attached until the implementation detaches on `close`/`destroyed`.
4. **The guest-discipline latch race has the same shape as tab-create and the same fix** (set `__goldfinchNavGuarded` synchronously first-thing in the adopt hook — observed early enough).
5. **Preload is not inherited.** Without it: native `window.close()` works, but no farbling, no vault fill, no close-shim. With it (injectable via `overrideBrowserWindowOptions.webPreferences.preload` — honored even though `partition` isn't): farbling/vault discipline returns, but the shim routes `window.close()` → `guest-window-close` → `chromeForTab(popupWcId)`, which resolves **only if the chrome knows the popup as a tab** — otherwise self-close silently breaks (the exact bug class this mission kills).
6. A plain-`allow` popup is a **`BrowserWindow` outside the registry**: invisible to `enumerateWindows`/chrome/session-snapshot, auth challenges **silently cancel** (`getWindowForGuest` → null → cancel branch), and its nav guard is the *non-guest* shape (wider than guest). Flight 1 made the parity stakes concrete: challenge routing, sheet presence, fullscreen-mode seeding, and the `guardFrameNav`+`plugins` shape all key off registry membership.

## Options

### Option A — Adopt the popup as a first-class tab with a live opener *(recommended)*

`createWindow` adopts `options.webContents` into a `WebContentsView` hosted in the opener's window and **registers it as a real tab**: `tabViews` entry (opener's partition), chrome notified via a new adopt channel (tab-strip row appears), preload injected, `wireGuestContents` attached with the latch set first-thing, teardown wired on `close`/`destroyed` (detach + deregister + chrome notify).

- **What users see**: OAuth popups open as a new tab that works — sign-in completes, result reaches the opener, popup closes itself, focus returns. (`width`/`height` features are ignored; it's a tab, not a floating window.)
- **Parity — bought wholesale by registry membership**: auth challenges route and present; census (`enumerateTabs`) sees it once the chrome registers it; fullscreen mode seeds; `guardFrameNav`+`plugins` apply; farbling + vault fill work (preload in); self-close works through the existing #119 path *because* `chromeForTab` resolves. Every row of Flight 1's grown parity checklist is satisfied structurally rather than re-implemented.
- **Scope guard** (review-hardened): only *genuine* popup requests take this path (has `features`, or a named non-`_blank` target), **and** the URL must pass `isSafeTabUrl`, **and** the opener must be a non-internal (web) guest — internal pages and unsafe URLs keep today's deny. Rationale: the adopt path bypasses the renderer-side `createTab` gate, leaving single-point enforcement; without the internal-opener exclusion, an internal page's `window.open` would mint an adopted tab on the internal session outside the trusted-provenance rule (mission-13 posture regression). Plain `target=_blank` keeps deny-and-convert.
- **Popup-features disposition** (complete UX picture): `width`/`height`/`left`/`top` are ignored (it's a tab); `resizeTo`/`moveTo` are no-ops. Popups need **no user gesture** to open (spike-observed) — gesture-less genuine-popup requests become adopted tabs, the same spam exposure as today's deny-and-convert (no regression, stated for completeness).
- **Risks**: the adopt-hook taboo (mitigated: source-scan pin that `createWindow` returns `options.webContents` and nothing else); manual teardown (unit matrix); chrome/tab-strip integration is the bulk of the implementation cost.

### Option B — Real `BrowserWindow` popups

`{action:'allow', overrideBrowserWindowOptions}` for genuine popup requests. Native popup UX (floating window, honors `width`/`height`), minimal main-process code, native close works.

- **Cost**: the popup lives **outside** the entire guest discipline. Every parity row must be re-implemented piecemeal: challenge routing (else auth in popups silently cancels — recreating the mission's target failure class), census exposure, nav-guard shape, chrome affordances (no tab strip, no sheet — where would a basic-auth prompt for the popup even render?), session-restore semantics. Flight 1's debrief explicitly scored this: any non-registry hosting "must re-implement each row."
- Honest fit: closest to what other browsers *look* like; architecturally the most expensive to make *behave* right in goldfinch.

### Option C — Keep deny-and-convert, add a visible notice

No opener, ever; a notice ("this site tried to open a popup…") replaces the silent `null`.

- Fails two mission criteria outright (fixture OAuth flow cannot complete; live GitHub run impossible). Only defensible as a documented decline — which the mission ruling ("fix all of it") already rejected. Included for completeness as the fallback if A and B are both refused.

## Recommendation

**Option A.** It is the only option that satisfies the OAuth criteria *and* the automation-parity criteria with structural guarantees rather than re-implementation; the spike proved its critical mechanism (opener survives adoption into the existing view machinery) directly. Popup-window aesthetics (floating window, sizing) are the only thing conceded, and a future flight could layer optional detachment on top without touching the opener contract.

## Per-contents parity checklist (Option A — becomes the leg acceptance skeleton)

| Row | Mechanism | How satisfied |
|---|---|---|
| Opener relationship | Adopted pre-created contents | Spike-proven; pinned by fixture behavior spec |
| Session/jar | Automatic (Electron) | Assert-only test |
| Nav guards | `wireGuestContents` + latch-first | Latch source-scan pin extends to the adopt hook |
| PDF carve-out + `plugins` | Registered-tab webPreferences path | Note: popup prefs are Electron-fixed; verify `plugins` behavior in-leg |
| Auth challenges (basic + cert) | `getWindowForGuest` resolves | Store matrix gains a popup-tab case |
| Sheet presence | Owning window's sheet | Existing eligibility rules apply unchanged |
| Fullscreen mode | Record membership | Exit-edge matrix gains popup case |
| Census (`enumerateTabs`) | Main-side registry `tabViews` membership (chrome notification is the tab-strip UI half) | Mission criterion; behavior spec asserts |
| Self-close (#119 path) | `chromeForTab` resolves post-registration | Fixture spec asserts popup closes itself + focus returns |
| Teardown | `close`/`destroyed` → detach + deregister | Unit matrix; no dead-view leak |
| **Session persistence / closed-tab reopen** | **Named decision required**: popup tabs are transient by nature — recommend **excluding** them from the session snapshot and closed-tab capture (a restored/reopened popup would be an openerless husk and would pollute Ctrl+Shift+T with OAuth transients). Alternative: accept-as-plain-tab. | In-leg decision + unit pins either way |
| Move-to-window / tear-off | Popup tab is a real tab-strip row → draggable; opener handle is renderer-level and *should* survive a view re-parent, but the spike didn't observe it | In-leg verification before ship |
| Chained popups (popup opens popup) | Structurally supported (`wireGuestContents` recursion applies the same scope guard) | Named fixture non-goal this flight; structural support assert-only |
| Opener closes first | Pure web semantics (`window.opener` → dead handle); no goldfinch machinery holds opener references | Assert-only |
| Preload in the adopt combination | Spike verified injection in the plain-allow path; the allow+adopt **combination** is a one-line in-leg premise verification before self-close parity is trusted | In-leg premise check |
| History/favicon/downloads | `wireTabViewEvents` as any tab | Assert-only |

## What approval unlocks

On your ruling, Flight 2 implementation proceeds autonomously: the ruling is recorded as the flight's governing DD, legs are designed/reviewed/implemented per the standard cycle, the local OAuth fixture behavior spec becomes the regression net, and the live GitHub witnessed run lands in Flight 3 (HAT) alongside the deferred verification bundle.
