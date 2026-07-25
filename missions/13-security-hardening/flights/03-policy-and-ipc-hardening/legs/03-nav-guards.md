# Leg: nav-guards

**Status**: completed

> Developer design review: **needs rework → reworked** (2026-07-25). [HIGH] avoided: `will-frame-navigate` takes a single Event, not `(event, url)` — use `event.url` uniformly or preventDefault fires on every nav. [MED] catch-all must allow `devtools:`/`file:`/`chrome-extension:`/`about:` (DevTools/PDF/extension nav). [MED] PDF-viewer is a 5th non-guest surface → AC5 opens a PDF. [LOW] inject url-safety into app-lifecycle (no require), register at top-level not inside whenReady. Latch confirmed race-free.
**Flight**: [Policy and IPC Hardening Batch](../flight.md)

## Objective

Extend navigation guarding to subframe navigations and server-side redirects on guests (`will-frame-navigate`, `will-redirect` with the same session-aware predicate as `will-navigate`), and add an `app.on('web-contents-created')` catch-all so every non-guest webContents (chrome, overlays, sheets, DevTools frontend) gets a window-open denial and a navigation guard — without breaking ordinary guest browsing.

## Context

- Flight DD3. Read it in full. This is the flight's **riskiest** leg — a *live behavior change* on a previously-unguarded surface, not pure defense-in-depth.
- `wireGuestContents` (`guest-wiring.js:64-142`) has `setWindowOpenHandler` (`:65-70`, deny+forward) and `will-navigate` (`:72-79`, session-aware: internal → `isInternalPageUrl`, web → `isSafeTabUrl`), then an internal-session early return (`:80-86`). No `will-frame-navigate`, no `will-redirect` anywhere in `src/`. No `web-contents-created`.
- **The latch subtlety (design review, MEDIUM — the crux of this leg)**: `web-contents-created` fires *synchronously during* `new WebContentsView()` (`register-tab-ipc.js:112-115` comment), before `wireGuestContents` runs — so the catch-all cannot tell a future guest tab from a chrome/overlay view at attach time. Its `will-navigate`/`will-frame-navigate`/`will-redirect` listeners are **additive** and stay attached to guest tabs. Therefore the catch-all's nav handler MUST **read a latch inside the handler** and early-return for guests: `wireGuestContents` sets `contents.__goldfinchNavGuarded = true` (synchronously, before any navigation can occur), and the catch-all's nav listener does `if (contents.__goldfinchNavGuarded) return;` at the top — otherwise an unconditional catch-all nav guard fires on every real guest navigation and **breaks web browsing wholesale**. `setWindowOpenHandler` is a setter (last wins), so the guest's later-installed handler safely overrides the catch-all's deny — no latch needed there.
- **Live behavior change (design review, MEDIUM)**: `will-redirect` (any target) + `will-frame-navigate` (subframe) were fully unguarded. `isSafeTabUrl` allows only http/https/about:blank, so a legit cross-scheme redirect (OAuth/payment app-handoff, `intent://`) that worked before is now cancelled. The FD live pass must include a **real cross-scheme redirect**; if a legit one breaks, scope down (divert).

## Inputs

- Branch `flight/03` (stacked; legs 1+2 landed uncommitted); `npm test` green.
- `guest-wiring.test.js` has a tab-events harness (drives navigate/title events).

## Outputs

- `src/main/guest-wiring.js` — `will-frame-navigate` + `will-redirect` beside `will-navigate` (same predicate, before the internal early-return so both branches covered); set `__goldfinchNavGuarded` in `wireGuestContents`.
- `src/main/app-lifecycle.js` (or main.js composition) — `app.on('web-contents-created')` catch-all: deny window-open + a latch-gated nav guard for non-guest views.
- Tests: `guest-wiring.test.js` (subframe + redirect enforce predicate; guest https→https NOT blocked); a catch-all test (non-guest view denied + guarded).
- `tests/behavior/tab-scheme-guard.md` — extended with subframe + a real cross-scheme redirect step (FD live).
- flight-log.md — leg entry + FD live-pass record.

> **Design review (needs-rework → reworked 2026-07-25)**: incorporated four fixes below. The latch mechanism was confirmed **race-free** (wireGuestContents runs synchronously after `new WebContentsView()`, before any `loadURL`; web-contents-created fires during construction, so at attach time the latch is always unset and only set by fire time). Critical bug avoided: `will-frame-navigate`'s listener takes a **single merged Event object**, NOT `(event, url)` — reading a positional `url` yields `undefined` → `preventDefault` fires on every navigation → browsing breaks. Use `event.url` uniformly across all three events.

## Acceptance Criteria

- [x] **AC1 (subframe + redirect on guests, `event.url` uniform)**: `wireGuestContents` installs `will-frame-navigate` and `will-redirect` with the same session-aware predicate as `will-navigate`, all reading **`event.url`** (a single-arg merged Event for `will-frame-navigate`; `will-navigate`/`will-redirect` also expose `event.url` on their first arg — do NOT rely on the deprecated positional `url` param). Predicate: internal guest → `isInternalPageUrl(event.url)`, web guest → `isSafeTabUrl(event.url)`, `preventDefault` on fail. Placed so BOTH the internal and web branches are covered (before the `:80` internal early-return, or replicated). Unit: a subframe nav (emitted with the **single details-object shape** `{ url, isMainFrame, preventDefault }`, not a positional 2nd arg — else the test masks the real signature) and a redirect to a disallowed scheme are `preventDefault`'d; an allowed http/https is not.
- [x] **AC2 (catch-all + scheme allowlist)**: `app.on('web-contents-created')` applies to every webContents: `setWindowOpenHandler(() => ({ action: 'deny' }))` and a nav guard reading `event.url`. The nav guard **reads `__goldfinchNavGuarded` inside the handler and early-returns for guests**. For non-guest views it blocks only **clearly-remote unsafe** navigations: it must **explicitly allow** the trusted internal schemes `devtools:`, `file:`, `chrome-extension:`, `about:` (in addition to `isSafeTabUrl`/`isInternalPageUrl`) — DevTools frontend, source-map/`file:` links, and extension pages navigate on these, and blocking them breaks DevTools. Only preventDefault a URL that is none of {isSafeTabUrl, isInternalPageUrl, or a `devtools:`/`file:`/`chrome-extension:`/`about:` scheme}.
- [x] **AC3 (guest browsing not broken — the critical guard)**: a unit test asserts a guest tab's legitimate `https→https` navigation is **NOT** blocked by the catch-all (the latch early-returns). The `__goldfinchNavGuarded` latch is set synchronously in `wireGuestContents` before any navigation; a comment pins that ordering.
- [x] **AC4 (regression)**: `npm test`, `npm run lint`, `npm run typecheck` pass. Ordinary browsing (multi-frame pages, redirects to http/https) is unaffected.
- [ ] **AC5 (FD live pass)**: extend + run `tab-scheme-guard` — subframe navigation to a dangerous scheme is blocked; a **real cross-scheme redirect** (e.g. an OAuth provider or a `mailto:`/custom-scheme 302) is exercised and its handling recorded. Ordinary browsing (a normal multi-frame site, an http→https redirect) works. **DevTools opens and navigates internally without interference; opening a PDF in-browser (built-in viewer) works** (both hit the catch-all — verify the scheme allowlist covers them). If a legitimate cross-scheme flow breaks, invoke the divert (scope the guest redirect/subframe guard down).

## Verification Steps

- AC1-AC4: `npm test` + read diffs.
- AC5: FD `dev:automation` live pass (deferred to FD).

## Implementation Guidance

1. `guest-wiring.js`: factor the predicate into a small local `guardNav(event)` reading **`event.url`** (internal → `isInternalPageUrl`, web → `isSafeTabUrl`, `preventDefault` on fail) and attach it to `will-navigate`, `will-frame-navigate`, `will-redirect`. **Do NOT use `(event, url)`** — `will-frame-navigate` passes only a single merged Event; `event.url` is correct for all three. Place before the internal early-return (or attach in both branches). Set `contents.__goldfinchNavGuarded = true` at the top of `wireGuestContents` (comment: set synchronously before any navigation can occur; a future `await` between `new WebContentsView()` and `wireGuestContents` would reopen the race).
2. Catch-all — inject the predicates, don't `require` them (design review, LOW). `app-lifecycle.js` has **zero** `require()`s by design (Electron-free, deps-injected); thread `isSafeTabUrl`/`isInternalPageUrl` into the `registerAppLifecycle({...})` call in `main.js:1679` (both already imported at `main.js:24`, already threaded into `registerTabIpc` at `:1279`). Register at **top-level scope** (like the existing `app.on('session-created', …)` at `app-lifecycle.js:73`), NOT inside `app.whenReady().then(...)` — `createWindow()` runs inside whenReady and creates the first chrome view, so a late registration misses it.
   ```js
   const ALLOWED_NONGUEST_SCHEMES = ['devtools:', 'file:', 'chrome-extension:', 'about:'];
   app.on('web-contents-created', (_e, contents) => {
     contents.setWindowOpenHandler(() => ({ action: 'deny' }));
     const guard = (event) => {
       if (contents.__goldfinchNavGuarded) return;                 // guests: own predicate covers them
       const url = event.url || '';
       if (isSafeTabUrl(url) || isInternalPageUrl(url)) return;
       if (ALLOWED_NONGUEST_SCHEMES.some((s) => url.startsWith(s))) return;  // DevTools / extension / file / about
       event.preventDefault();
     };
     contents.on('will-navigate', guard);
     contents.on('will-frame-navigate', guard);
     contents.on('will-redirect', guard);
   });
   ```
   Guests early-return via the latch. DevTools frontend, the built-in PDF viewer (MimeHandlerViewGuest — a fifth non-guest webContents surface, design review), and overlay `file://` views are covered by the scheme allowlist.
3. Tests per AC1-AC3. For AC3, drive a guest contents with the latch set and assert a will-navigate to `https://…` is not prevented.
4. `tests/behavior/tab-scheme-guard.md`: add step(s) for a subframe dangerous-scheme nav + a cross-scheme redirect. Keep the existing 13 steps.
5. Run the gate. Hand to FD for AC5.

## Edge Cases

- **DevTools frontend** (`devtools:`): must not be blocked by the catch-all — the scheme allowlist (guidance step 2) covers it. Highest catch-all risk. The initial `devtools://` load is programmatic (won't fire will-navigate), but user-driven in-panel nav (source-map `file:` link, extension-panel `chrome-extension:` page, doc links) can — hence the allowlist.
- **Built-in PDF viewer** (MimeHandlerViewGuest): a fifth non-guest webContents surface (design review) — covered by the scheme allowlist; AC5 opens a PDF to confirm.
- **`about:blank`** subframes (ad iframes often start there): `isSafeTabUrl` allows `about:blank` — fine. Same-document navigations don't fire will-frame-navigate/will-redirect (Electron pins `isSameDocument:false`), so no false blocks there.
- **Guest latch timing**: `wireGuestContents` runs synchronously right after `new WebContentsView()` and before `loadURL`, so no guest navigation can occur before the latch is set (pin with a comment).
- **Internal guests**: covered by the guest predicate (internal → isInternalPageUrl); the catch-all latch early-returns for them too.

## Files Affected

- `src/main/guest-wiring.js`, `src/main/app-lifecycle.js` (or main.js)
- `test/unit/guest-wiring.test.js` (+ possibly `app-lifecycle.test.js`)
- `tests/behavior/tab-scheme-guard.md`
- flight-log.md

---

## Post-Completion Checklist

- [x] All ACs verified (AC5 by FD, pending — `[HANDOFF:review-needed]`)
- [x] Tests passing (`npm test` 2840/2840, `npm run lint`, `npm run typecheck` all green)
- [x] Update flight-log.md
- [ ] Set leg status `completed`; check off in flight.md — leg status set to `landed` instead (per developer-implementation instructions: AC5 still outstanding, and flight.md/mission.md checkboxes are flight-end, FD-owned)
- [ ] Final leg → flight.md `landed` + mission checkboxes (flight-end) — deferred to FD
- [ ] Commit batched at flight end — deferred to FD (not committed)

---

## Citation Audit

Verified at leg design (2026-07-25, from flight-3 recon): `guest-wiring.js:64-142` (wireGuestContents, will-navigate at :72, internal early-return at :80); `register-tab-ipc.js:112-115` (web-contents-created timing comment); no existing will-frame-navigate/will-redirect/web-contents-created (grep clean); `url-safety.js` predicates. All OK.
