# Mission: No Silent Failures

**Status**: active

## Outcome

Goldfinch never shows the operator a blank page for a problem it already knows
about. A navigation that cannot complete, a connection the browser refuses to
trust, a tab whose renderer has died or stopped responding, and a chrome view
that has crashed each get an explanatory surface that names what happened and
offers the appropriate next step — retry, an informed override, reload, or
wait/kill. The browser explains itself instead of looking broken.

## Context

Three open issues describe the same defect class from three directions:

- **#163 — navigation failures render a blank page.** Every network failure
  (unresolvable host, refused connection, timeout, offline, and today also
  bad certificates) lands the guest on an empty document. The error code is
  known — it is logged from the rejected load — but nothing surfaces it. The
  operator hit this on a corporate VPN doing selective TLS interception:
  the home page was re-signed by an untrusted root while everything else
  worked, so the browser appeared entirely broken at launch.
- **#143 — no TLS trust-failure UX.** There is no certificate-error
  handling anywhere; Electron's default rejects the connection and the page
  fails blank. No interstitial, no informed override, no "not secure"
  indicator, no way to inspect a site's certificate. Client-certificate
  *prompts* reached parity in Mission 14; this is the adjacent layer that
  mission deliberately scoped out.
- **#133 — no crash resilience.** `render-process-gone` is handled only on
  the three overlay views. A crashed guest renders gray forever with its
  title and favicon still in the strip; a crashed chrome view bricks the
  window (guests keep compositing into an inert frame). No local crash
  record exists to tell an OOM from a GPU fault from the sleep/resume
  teardown behind the original field incident on Windows.

The 2026-08-27 maintenance cycle ranked #163 the highest user-visible defect
in the backlog and sequenced it "next cycle, before #143"; #133 was also
"next cycle". Two feature missions have shipped since. By the auto-escalation
rule adopted at the Mission 19 debrief, this work is overdue.

The three share one mechanism — a surface for a tab that has no page to
show — so they compose into one mission with a shared substrate rather than
three unrelated flights. The surface mechanism is decided once, in the first
flight, and the later flights specialise it.

Ruled at planning (2026-09-15):

- Crash resilience is in scope with all three legs (guest crash page,
  chrome-view recovery, local crash records), plus a hung-renderer surface.
- Certificate override is an **informed, gated override remembered per origin
  for the current app session only** — never persisted. The per-origin
  permission store proposed by #144 is a **follow-on mission**; this
  mission's override memory is deliberately simple in-memory state and is
  noted as that store's future second client, not a first draft of it.
- The read-only certificate viewer is in scope.
- The "not secure" indicator covers **both** plain-`http:` pages and
  cert-overridden origins (Chrome parity).
- The automation census reports per-tab load state; there is no
  agent-driven certificate override at any tier.

Architect viability review (2026-09-15): **feasible with caveats**, no
factual corrections; sizing confirmed at three flights plus optional
alignment. Its caveats are folded into Success Criteria, Constraints, and
Open Questions below.

## Success Criteria

- [x] **A failed navigation never renders an empty document.** Any
  non-certificate failure (unresolvable host, refused connection, timeout,
  offline) shows a surface naming the target address and the failure
  reason as reported by the engine, with a retry action that re-attempts
  the same address. *(behavior-test-backed: live fixtures for each failure
  class, judged on the rendered surface and the census)*
- [x] **Failure is visible from the tab strip.** A failed, crashed, or hung
  tab is identifiable in the strip without switching to it, and the address
  bar keeps showing the intended address, not an internal error address.
- [x] **Untrusted certificates get an interstitial, not a blank.** Navigating
  to an origin whose certificate fails validation shows a surface naming
  the origin and the specific certificate error, with the risk explained in
  plain language. Proceeding requires an explicit, gated action; the
  decision is remembered for that origin until the app quits, is never
  written to disk, and is never available to automation. *(behavior-test-
  backed: local self-signed fixture)*
- [x] **Insecure connections are labelled.** A page served over plain
  `http:`, or over a certificate the operator overrode, carries a visible
  "not secure" state in the address chip and the site-info popup for as
  long as that page is shown; a trusted `https:` page does not. (The
  scheme-based half already ships — the chip and popup distinguish `http:`
  from `https:` today; the new delta is the overridden-certificate state
  and one consistent vocabulary across both.)
- [x] **A site's certificate is inspectable.** From the address chip the
  operator can read the current page's certificate: subject, issuer,
  validity window, fingerprints, and the chain. Read-only.
- [ ] **A crashed tab recovers in place.** When a tab's renderer dies, the
  tab shows a crash surface with a working reload; reloading restores the
  page with back/forward history intact; the strip shows the crashed state
  until recovery. The crash reason is reflected in the copy where it helps
  (killed / out of memory / crashed).
- [ ] **A crashed chrome view recovers without losing the window.** When the
  chrome renderer dies, the window's tab strip, toolbar, and active tab are
  rebuilt from main's own record; open guests survive untouched and the
  previously active tab is active again. Several simultaneous crashes
  (the sleep/resume pattern) recover without a reload storm.
- [ ] **A hung tab offers wait-or-kill.** A renderer that stops responding
  surfaces a non-blocking notice with a wait option and a kill-and-reload
  option; kill-and-reload recovers the tab; a renderer that recovers on its
  own clears the notice.
- [ ] **Every crash leaves a local record.** Reason, exit code, and the page
  origin are logged for every renderer crash, and crash dumps are collected
  locally. Nothing is uploaded and no network request is made by any of
  this — the no-silent-egress posture is unchanged.
- [ ] **New surfaces are safe and accessible.** Every string that originates
  from a page or the engine (addresses, error codes, certificate fields,
  crash reasons) is rendered as text, never markup; every new surface is
  keyboard-operable and passes the a11y audit; the automation census
  reports each tab's load state (ok / failed / cert-blocked / crashed /
  hung) so an agent can react instead of reading a blank document.

## Stakeholders

- **The operator** — daily driver; the corporate-VPN and sleep/resume
  incidents are theirs. Wants the browser to say what went wrong.
- **Keyboard and assistive-technology users** — the new surfaces are the
  first thing a user sees when something fails; they must be reachable and
  announced (Mission 17 Flight 1's reachability work must not regress).
- **Automation consumers (MCP agents)** — a blank document is
  indistinguishable from an empty page; a census load-state lets an agent
  detect and report failure honestly.
- **The follow-on "site trust & permissions" mission (#144)** — inherits the
  override memory as the first client of a future per-origin store; this
  mission must not pre-build that store.

## Constraints

- **Trust boundaries are unchanged.** `isSafeTabUrl` is never widened; the
  internal-vs-web boundary and the four internal-page gates stay exactly as
  they are; no page-controlled URL is fetched outside the owning jar's
  session; every new IPC channel is sender-validated by webContents identity.
- **Untrusted input discipline.** Error codes, addresses, certificate fields
  and crash details come from the guest or the engine and are treated as
  hostile text — `textContent` only, capped where unbounded.
- **Guest-slot layout is never animated.** Any surface that occupies or
  covers the guest region either floats over it (view stacking) or changes
  layout instantly — the `WebContentsView` native-surface invariant.
- **Every Electron auth-class callback is resolved exactly once.** A
  `certificate-error` handler joins the auth-challenge store's single-resolve
  discipline: every close reason maps to resolution or occlusion; no path
  leaves a callback dangling.
- **Override memory is session-only and human-only.** Never persisted, never
  settable or readable as a decision by automation; the census reports state,
  not decisions.
- **No new runtime dependencies. No new network egress.** Crash collection is
  local-only with no upload endpoint, and is started from the composition
  root before app readiness so early crashes are caught too.
- **Renderer line budget.** `renderer.js` is at its pinned budget; new chrome
  surfaces are owned by extracted controllers, never by growing the
  composition root. The evaluate-seam closed set grows only by FD ruling
  (a11y hooks for new sheet/surface states are the expected additions).
- **Gates.** `npm test`, `npm run lint`, `npm run typecheck`,
  `npm run format:check`, and `npm run a11y` green at every leg; Prettier
  owns formatting.
- **Never read `win.*` inside `closed`-or-later handlers** — crash and
  teardown paths in particular must not throw into Electron's event
  dispatch (the Wayland close-path wedge).

## Environment Requirements

- Linux/WSL2 (WSLg) dev rig; canonical launch `npm run dev:automation`
  with `GOLDFINCH_AUTOMATION_ADMIN=1` for behavior tests and the a11y audit.
- Controllable failure fixtures, all local and offline-safe: a refused port
  (`127.0.0.1:1`), an `.invalid` hostname, a local HTTPS server with a
  self-signed certificate (Node `https` + a generated key pair), a page
  that crashes its renderer (`process.crash()` via the admin `evaluate`
  op) and one that hangs it (a busy loop). No external hosts required.
- Sleep/resume is not reproducible on the rig; the multi-crash guard is
  verified by forcing several guest crashes at once, and the original
  Windows incident is an operator-only follow-up check.
- Unit tests under `node --test` for every pure decision model (failure
  classification, override memory, crash-copy selection, census load-state
  projection); behavior specs under `tests/behavior/` for the live surfaces.

## Open Questions

- **Which surface mechanism?** The internal-page route is structurally
  closed (a web guest has no handler for `goldfinch://`), and the welcome
  surface's chrome-DOM approach works only because a welcome tab has no
  guest view. Three real candidates, to be decided in Flight 1 and inherited
  by every later flight: (a) chrome DOM that hides the guest view while the
  tab is in a failed state; (b) a per-window main-owned overlay view in the
  find-bar/sheet family, floated over the guest region; (c) an error
  document loaded into the guest itself. Each has a different answer for
  focus, find-overlay/sheet interplay, retry, and census visibility — and
  two axes must be weighed by name (Architect review, 2026-09-15):
  **trust boundary** — (c) puts the retry affordance in the same JS realm
  as hostile page script (web guests run without context isolation), so any
  IPC hook there is a new attack surface; a no-IPC retry is possible only
  with a new session-scoped scheme plus main-side "guest is showing the
  synthetic error page for intended address X" tracking; and **per-tab
  state** — (a)/(b) reuse per-window singletons that follow only the active
  guest, so failure state must live on the tab's own registry entry and be
  *projected* by the surface on activation, never held by the surface.
- **Where does a successful page's certificate come from?** The
  `certificate-error` event supplies the certificate only on failure. The
  viewer for a *trusted* page needs a source — the session-level certificate
  verification hook (which observes every verification and can defer to
  Chromium's verdict) is the likely answer and avoids a third CDP client;
  confirm at Flight 2 design.
- **Per-origin certificate cache bounds.** The verification hook sees every
  verification for the session's life; the viewer's cache needs a cap or
  eviction rule (and a per-jar scope) so a long session doesn't retain a
  chain per origin ever visited. Decide at Flight 2 design.
- **What does "not secure" mean for mixed states** — an overridden origin in
  a subframe, an `http:` page that later navigates in-page, a redirect from
  overridden `https:` to trusted `https:`? Decide the state machine at
  Flight 2 design; keep the top-frame origin as the unit.
- **Chrome-view recovery and in-flight state.** The registry holds tab
  views, active tab, and per-tab metadata, but chrome-side state (find text,
  welcome records, pending queries, suggestions) is lost with the renderer.
  Decide what is worth reconstructing versus honestly dropped. Confirmed:
  welcome records and their pending queries exist only in the chrome —
  rebuild must re-derive welcome reasons from settings the way the cold-boot
  new-tab path does, and a pending query is dropped, not recovered.
- **Hang detection thresholds.** Electron's `unresponsive` fires after a
  fixed delay; decide whether to surface immediately or debounce, and
  confirm heavy-but-legitimate pages do not false-positive on the rig.
- **Does a failed/crashed tab appear on the closed-tab stack and in the
  session snapshot with its intended URL?** Expected yes (the intended
  address is the tab's identity), confirm per surface mechanism.

## Known Issues

Emergent blockers and issues discovered during execution.

- [ ] **#216 — a failed typed navigation strands keyboard focus.** The chrome
      view loses OS focus ~7 ms after Enter (before the failure lands) and never
      regains it, so the panel's heading focus is inert and F6/Tab go to the
      hidden guest. Found at Flight 1's HAT (H7), invisible to the automation
      apparatus (keys are injected into the chrome wcId). Affects the
      "keyboard-operable" half of success criterion 10 and DD6's
      focus-on-failure rule; a diagnosis/design pass is needed (not a squawk).
      Discovered in Flight 1, affects Flights 2 and 3 (every hidden-guest
      surface).
      **Flight 2 update (2026-09-16)**: leg 1's trace-driven fix (`chromeNavPending` + a reactive chrome-blur reassert, disarmed at `did-fail-load`) is unit-pinned but did NOT resolve the live symptom — the `tls-trust-surface` acceptance run's keyboard rows failed by eye (no ring, F6/Tab inert after a typed failure). Operator ruling: remains a Known Issue; the override card's own keyboard contract is sound once focus is in the panel. The residual gap leg 1 recorded (a re-steal between `did-fail-load` and the error document's own commit) is the leading hypothesis for the next attempt.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are
> planned and created one at a time as work progresses. This list will
> evolve based on discoveries during implementation.

- [x] Flight 1: **The failure surface and navigation errors** (#163) — landed 2026-09-15 (PR #215); H7 → #216 —
  decide the surface mechanism (the mission's one hard-to-reverse
  decision); wire load-failure events; classify failures into
  operator-facing copy via a pure model; retry; tab-strip failed state;
  census load-state; a11y; behavior spec per failure class. Certificate
  failures reach this generic surface until Flight 2 specialises them.
- [x] Flight 2: **TLS trust: interstitial, override, indicator, viewer** — landed 2026-09-16 (PR #217); #216 still open —
  (#143) — `certificate-error` answered at once (refuse-or-remembered; the
  held-callback auth-challenge model was considered and rejected at Flight 2
  planning — a certificate refusal has a fail-then-retry shape), the
  interstitial specialising the Flight 1 surface, a human-only proceed on
  the menu-overlay sheet; per-jar per-origin session-only override memory;
  "not secure" chip/popup/census state for `http:` and overridden origins;
  read-only certificate viewer fed by a session verification observer;
  throwaway-CA fixture behavior spec.
- [ ] Flight 3: **Crash and hang resilience** (#133 + hung renderers) —
  guest crash surface with reload; chrome-view reload-and-reconcile from
  the registry with a multi-crash storm guard; `unresponsive` wait-or-kill;
  local crash records and dump collection; OS-signal-injected behavior spec for
  both surfaces.
- [ ] Flight 4 *(optional)*: **Alignment** — an interactive session for
  copy, layout, and feel across the new error, interstitial, crash, and
  hang surfaces.
