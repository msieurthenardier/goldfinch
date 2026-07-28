# Mission: Web Compatibility — Silent Failures Become Working Features

**Status**: active

## Outcome

Everyday web behaviors that currently fail silently in Goldfinch — video fullscreen, popup-based sign-in, HTTP-auth-protected pages, client-certificate sites, and inline PDFs — either work the way a user of any mainstream browser expects, or visibly explain themselves. The same capabilities are first-class for agent consumers: popups are visible to the automation census, and agents can answer auth challenges through the vault. After this mission, no page in the audited set breaks with nothing on screen saying why.

## Context

Issue [#132](https://github.com/msieurthenardier/goldfinch/issues/132) reports a full-tree web-compatibility audit that found four silent failures, all sharing one shape: missing Electron main-process wiring. Because each fails with no error and no affordance, they read as "this browser is broken" rather than "this feature is off." All four were re-verified present on `main` at v0.11.6 during mission planning:

1. **HTML5 video fullscreen unhandled** — no `enter-html-full-screen` / `leave-html-full-screen` handling anywhere; under the BaseWindow + WebContentsView architecture the guest cannot escape its slot on its own. The `'fullscreen'` permission is already allowlisted in `session-runtime.js`, so `requestFullscreen()` succeeds page-side while the guest stays in its slot — the missing piece is solely the bounds/window handling. Every video site is affected.
2. **Popup-to-tab conversion breaks `window.opener`** — every popup is denied (`guest-wiring.js`, plus a catch-all deny in `app-lifecycle.js`) and re-created as an ordinary tab, so `window.open()` returns `null` to the calling page. The dominant OAuth/SSO popup pattern hangs silently. The self-close half was already fixed (#119); this is the other half. **Requires a design ruling before any code** — the human wants a written proposal to review.
3. **HTTP basic auth silently cancelled** — no `app.on('login')` handler, so any basic-auth-protected page (routers, intranet, staging sites) fails with no prompt. The scope also includes the adjacent gap the audit noted in passing: no `select-client-certificate` handler, making client-cert sites equally unreachable.
4. **No PDF viewer** — `plugins` is never enabled for guests, so PDFs fall through to the auto-download path. The audit gated this behind the #131 sandbox hardening; that work is complete (`sandbox: true` is live), so the prerequisite is satisfied. **Architect finding**: enabling `plugins` alone is insufficient — the guest navigation guard (`guardNav` in `guest-wiring.js`) blocks the PDF viewer's `chrome-extension://` inner frame, so the fix requires a deliberate, narrowly-scoped relaxation of a Mission-13 security surface, assessed as such.

Mission-planning rulings by the human:

- Fix all of it — no documented-decline paths.
- The popup/OAuth approach is decided via a written proposal reviewed by the human before implementation.
- Automation parity is in scope: popups must be visible to `enumerateTabs`/`enumerateWindows`, and agents get a vault-mediated path to answer basic-auth challenges.
- The live-provider OAuth proof is a witnessed manual run; the repeatable regression net is a local OAuth-popup fixture (third-party bot heuristics can fail an automated live run for non-codebase reasons; GitHub preferred over Google as the live provider).
- Fullscreen bar is guest-over-chrome within the window; true OS fullscreen is an optional extra.
- Client-cert chooser appearing once per session per host (Chromium's cert-choice caching) is acceptable.

## Success Criteria

- [x] Activating fullscreen on an embedded video expands the video over the browser chrome to fill the window, and restores the normal layout cleanly when fullscreen exits (including via Esc) — verified live on at least one real video site. *(behavior-test-backed)*
- [x] A popup-based OAuth sign-in flow completes end to end against a local OAuth-popup fixture — the popup opens with a working opener relationship, the result reaches the opening page, and the popup closes. *(behavior-test-backed)*
- [x] A real popup-based OAuth/SSO sign-in with a live provider (GitHub preferred) completes end to end in a witnessed manual run. *(Delivered via Google OAuth popup on claude.ai — the harder provider; deviation recorded in the F3 log.)*
- [x] The popup handling approach is recorded as a design ruling that was reviewed and approved by the human before implementation began, including a per-contents parity checklist (nav guards, registry membership, teardown, automation census) for whatever form popups take. *(Option B, human-ruled 2026-07-28; closed at the F2 debrief.)*
- [x] Script-opened popups are visible to the automation surface: `enumerateTabs`/`enumerateWindows` report them like any other guest.
- [x] Navigating to a page behind HTTP basic auth prompts for credentials through browser-owned secure UI; correct credentials load the page, and cancelling dismisses cleanly. Credentials never enter any page's DOM. *(behavior-test-backed)*
- [x] An agent can answer a basic-auth challenge through a vault-mediated path (vault-fill-style) that preserves the credentials-never-in-page-DOM guarantee.
- [x] Sites requesting a client certificate present a certificate chooser instead of failing silently (once per session per host, per Chromium's cert-choice caching; verified against a local TLS fixture).
- [x] Navigating to a PDF renders it inline in the tab, and the same navigation does not also trigger a download.
- [x] None of the fixes regresses the mission-13 security posture: guests remain OS-sandboxed, the nav-guard relaxation for the PDF viewer is a named, narrowly-scoped design decision with a recorded security assessment, and credential-handling UI keeps credentials out of page-reachable contexts.

## Stakeholders

- **Goldfinch users** — the direct beneficiaries; these are the "why doesn't this browser work" moments that drive people back to Chrome.
- **Project owner (msieurthenardier)** — wants the browser to be daily-drivable; reviews and approves the popup/OAuth design ruling personally.
- **Automation/agent consumers** (goldfinch MCP surface) — first-class in this mission: popup enumeration parity and a vault-mediated auth-answer path are success criteria, not side effects.

## Constraints

- **Guest bounds changes are discrete** — the standing CLAUDE.md invariant: a guest bounds change is a single `setBounds` step, never an animatable quantity. Fullscreen enter/exit must be instant transitions, no ramps.
- **Popup ruling gates popup code** — no implementation of gap 2 until the human has reviewed and approved a written proposal weighing the options (allow genuine popups with a live opener vs. deny-and-convert with a visible notice, or a hybrid keyed on `features`/named targets). Electron 43's `setWindowOpenHandler` create-window override makes an opener-preserving popup hostable inside the existing WebContentsView/registry machinery — a viable middle path the proposal must weigh.
- **Security posture is not negotiable** — `sandbox: true` stays. The PDF viewer's nav-guard carve-out (`chrome-extension://` inner frame) and the `plugins` enablement are assessed against, not traded against, the #131 hardening. Auth credential entry uses chrome-owned UI (the vault sheet family is the established model) so credentials never touch a guest DOM.
- **Auth challenges must be serialized** — `app.on('login')` can fire concurrently (per-subresource, multi-tab, tab-less download challenges) against a per-window singleton sheet with model-replace semantics; the flight design must define challenge queueing and an every-callback-answered discipline so no load hangs.
- **Fullscreen must respect the overlay/bounds pipeline** — the menu sheet and find overlay track guest bounds via renderer-driven hooks that a main-initiated fullscreen change bypasses; the design must cover overlay tracking plus exit edges (tab switch, tab close, window close while fullscreen).
- **No new UI paradigms** — prompts and sheets reuse the existing chrome-owned overlay surfaces and their keyboard/zeroization contracts rather than inventing new ones. New sheet templates join the existing a11y-audit sheet matrix.

## Environment Requirements

- Local Electron development environment (Electron 43.x, electron-builder toolchain already in repo)
- Live network access to real external sites for verification (a video site; GitHub for the witnessed live OAuth run)
- A GitHub test account for the witnessed live OAuth sign-in
- Local fixtures: an OAuth-popup fixture (opener/postMessage round-trip), a basic-auth endpoint, a TLS server configured to request a client certificate — no mainstream public endpoint reliably exercises client certs, and the live OAuth providers' bot heuristics make them unsuitable as automated regression targets
- goldfinch MCP server running for behavior-test execution

## Open Questions

- [ ] Popup/OAuth design ruling: real popup windows for genuine popup requests (with inherited partition/prefs, hosted in the registry machinery), deny-and-convert with a visible notice, or a hybrid keyed on `features`/named targets? → Proposal authored in Flight 2 pre-flight; human approves before implementation.
- [ ] Fullscreen mechanics: how the guest-over-chrome expansion coordinates with overlay tracking and teardown edges; whether optional OS fullscreen is layered on. → Flight 1 design decision.
- [ ] PDF + download-path interaction: how the download interceptor distinguishes an inline PDF render from a download so PDFs aren't double-handled; exact shape of the nav-guard carve-out. → Flight 1 design decision (with security assessment).
- [ ] Auth-challenge queueing model and the vault-mediated agent auth-answer path (how an agent designates credentials for a pending challenge without them entering a page DOM). → Flight 1 design decision.
- [ ] Client-cert chooser UI: does the vault sheet family accommodate a list-picker, or is a minimal native dialog acceptable here? → Flight 1 design decision.

## Known Issues

- [ ] **Stale-oversized guest/chrome bounds after fullscreen-exit × window-geometry change** — discovered in Flight 3 (HAT), affects window rendering under WSLg Wayland + display scaling; self-corrects on any manual window resize; manual fullscreen re-entry unaffected. Accepted by operator ruling at the fullscreen run's checkpoint 7 (run log `tests/behavior/web-compat-fullscreen/runs/2026-07-28-18-04-00.md`). Suspected root: units/convention mismatch between `win.getContentBounds()` (fullscreen expansion/resize re-expand) and the renderer-measured slot convention; same finding's other face is the fullscreen logical-viewport undershoot. Follow-up diagnosis disposition to be set at mission debrief (queue vs fold into the #144 mission vs maintenance).

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses. This list will evolve based on discoveries during implementation.

- [x] Flight 1: **Main-process wiring** — video fullscreen, HTTP basic auth + client-certificate prompts (including the vault-mediated agent auth path), inline PDF viewing (including the nav-guard security assessment). Self-contained gaps sharing one risk profile: main-process event wiring with chrome-owned UI. *(Landed; behavior runs deferred to HAT/admin-keyed session — see flight log.)*
- [x] Flight 2: **Popup & opener ruling + implementation** — proposal authored (spike-grounded), human ruled **Option B (real BrowserWindow popups)** 2026-07-28, implemented with challenge/census/addressability parity re-implemented explicitly per the ruling's accepted cost. *(Landed; fixture behavior run + census admin-tier steps deferred to HAT per the standing apparatus disposition.)*
- [x] Flight 3: **Alignment/HAT** *(no longer optional — Flight-1 debrief ruling)* — hands-on session against live sites: fullscreen feel, the witnessed live GitHub OAuth sign-in, auth prompts, and adjustments benefiting from real-time human judgment. **Owns the deferred verification bundle** (admin-keyed session): `web-compat-fullscreen` → `web-compat-basic-auth` + `vaultAnswerAuth` + vault-login re-run → `web-compat-client-cert` (install `libnss3-tools` first) → `web-compat-pdf`. Most Flight-1 mission criteria can only be checked off here.
