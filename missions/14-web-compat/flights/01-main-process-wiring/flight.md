# Flight 1: Main-Process Wiring — Fullscreen, Auth Challenges, Inline PDF

**Status**: completed
**Mission**: [Web Compatibility — Silent Failures Become Working Features](../../mission.md)

## Contributing to Criteria

- [ ] Fullscreen on an embedded video expands guest-over-chrome and restores cleanly (incl. Esc) — live on a real video site *(behavior-test-backed)*
- [ ] Basic-auth pages prompt via browser-owned secure UI; correct credentials load; cancel dismisses cleanly; credentials never enter any page DOM *(behavior-test-backed)*
- [ ] An agent can answer a basic-auth challenge through a vault-mediated path preserving the credentials-never-in-page-DOM guarantee
- [ ] Client-cert sites present a chooser (once per session per host; local TLS fixture)
- [ ] PDFs render inline without also triggering a download
- [ ] No regression of mission-13 posture; the PDF nav-guard relaxation is a named, security-assessed decision

## Pre-Flight

### Objective

Wire the four missing main-process behaviors that make everyday pages fail silently: HTML5 fullscreen (`enter/leave-html-full-screen`), HTTP auth challenges (`app.on('login')` + a sheet prompt + a vault-mediated agent answer path), client-certificate selection (`select-client-certificate` + a picker sheet), and inline PDF viewing (`plugins: true` + a narrow nav-guard carve-out). All work is additive wiring inside the established architecture: Electron-free dependency-injected main modules, chrome-owned sheet UI, dual-zeroized credential IPC.

### Open Questions

- [x] How does a main-initiated fullscreen bounds change survive renderer bounds sends? → DD1 (fullscreen mode gates `tab-set-bounds`)
- [x] Who answers auth callbacks that never reach a prompt? → DD2 (every-callback-answered ledger)
- [x] How does an agent answer a native auth prompt without credentials crossing the MCP boundary? → DD3 (pending-challenge store + vault delegate)
- [x] How is the client-cert chooser presented and live-verified given no TLS fixture exists? → DD4, DD6
- [x] What exactly does the PDF nav-guard carve-out allow? → DD5 (security assessment inline)
- [x] Does enabling `plugins` stop `will-download` from also capturing PDFs? → Empirical premise check, first step of the PDF leg (mission-13 lesson: verify the risky premise before building)

### Design Decisions

**DD1 — Fullscreen is a window-record mode that gates the bounds pipeline**
- On `enter-html-full-screen` (wired in `wireGuestContents`, `src/main/guest-wiring.js`): resolve the owning record via `registry.getWindowForGuest(contents.id)`; snapshot `entry.view.getBounds()`; set `record.htmlFullscreen = { wcId, savedBounds }`; one discrete `entry.view.setBounds({x:0, y:0, ...win.getContentBounds() size})`; re-add the guest view to raise it above the chrome; hide the find overlay and close the sheet (reason `'tab-hide'` semantics family — exact reason string decided in-leg from the validated set).
- On `leave-html-full-screen`: restore `savedBounds` (one discrete `setBounds`), clear the mode, re-assert normal z-order (guest → find overlay → sheet → tear-off pill, the ordering invariant at `register-tab-ipc.js:748-751`), and send `trigger-send-bounds` to the owning chrome so the renderer re-asserts the true slot rect.
- **Bounds-pipeline gate**: while `record.htmlFullscreen` is set, `tab-set-bounds` (`register-tab-ipc.js:811`) stores the incoming rect as `record.htmlFullscreen.pendingBounds` instead of applying it; exit applies `pendingBounds || savedBounds`. This neutralizes the overwrite hazard from `ResizeObserver`/panel-toggle/window-resize sends (`window-factory.js:298-303`). `win.on('resize')` while fullscreen re-expands the guest to the new content bounds.
- **Exit edges**: `tab-set-active` to a different tab, `tab-hide` of the fullscreen tab, tab close, window close, and **cross-window tab move** (`moveTabIntoWindow`, all four entry paths — force-exit through the restore path *before* the geometry capture at `register-tab-ipc.js:400`, else the full-window rect seeds the target and the gate stays armed on the source record) all force-exit fullscreen through the same restore path (page-side exit requested only if the contents is still alive; destruction skips straight to record cleanup). All edges enter the unit-test matrix.
- **Overlay sync during fullscreen**: the bounds gate defers everything — `entry.view.setBounds` *and* the `findOverlay`/`sheet` `syncBounds` fan-out at `register-tab-ipc.js:827-831`; exit's `trigger-send-bounds` re-converges all three managers from the renderer's authoritative slot rect.
- **Esc**: Blink exits element fullscreen on Esc natively and fires `leave-html-full-screen`; we rely on that and add a defensive Esc branch in the existing `before-input-event` web branch that no-ops unless `record.htmlFullscreen` is set (then asks the page to exit). **Placement constraint**: the branch must precede the `if (!(input.control || input.meta)) return;` early-return at `guest-wiring.js:118`, or Esc never reaches it. Verified live in the behavior test.
- Rationale: keeps main the single writer during fullscreen without touching the renderer's slot-measurement model; honors the discrete-`setBounds` invariant (single step each way).
- Trade-off: one more piece of per-window mode state; accepted — it lives on the `WindowRecord` beside existing overlay state.

**DD2 — Auth challenges: global handler, per-window serialized queue, every callback answered**
- `app.on('login')` registered in `registerAppLifecycle` (`src/main/app-lifecycle.js`), dep-injected like everything else. `event.preventDefault()` always; build a challenge record `{challengeId (opaque), callback, authInfo, url, wcId?, partition?}` in a new main-side **pending-challenge store** (module `src/main/auth-challenges.js`, Electron-free, DI).
- **Routing**: challenges whose `webContents` maps to a registered guest (`registry.getWindowForGuest`) enqueue on that window's queue; the queue presents one challenge at a time on the sheet (model-replace semantics make an unserialized second prompt clobber the first — hence the queue). Challenges from non-guest contents (favicon `session.fetch`, downloads, DevTools) are **cancelled silently** — no prompt spam from background subresources; documented limitation.
- **Every-callback-answered discipline**: the store owns each `callback` and guarantees exactly one resolution. Two distinct lifecycles, pinned in the unit matrix:
  - *Resolution* (challenge ends): submit → `callback(user, pass)`; Esc/explicit cancel → `callback()`; tab close, window close, queue teardown → `callback()`; **navigation away** (`did-start-navigation` on that wcId — the challenge's invalidation trigger; max staleness is one navigation) → `callback()`.
  - *Occlusion* (challenge survives): sheet blur, superseded by an unrelated sheet, tab-hide/fullscreen-enter on the same tab → challenge stays pending and re-presents from the queue on refocus/re-activation. Mainstream browsers don't cancel a load because the window lost focus.
  - **Cross-window tab move**: the tab's pending challenges are cancelled (`callback()`) at move time — re-homing a live native callback across records is complexity without a user-visible payoff; the page re-issues the challenge on reload in the new window.
  - A source-scan-style unit test pins that no code path abandons a callback.
  - Bucket assignments for the full `SHEET_DISMISS_REASONS` set: `outside-click` → resolution (explicit cancel, matching Esc). When the agent path answers first (DD3), the sheet must close with a **resolution-family** reason so the occlusion queue does not re-present the already-answered challenge — both pinned in the leg's test matrix.
- **Proxy auth**: challenges with `authInfo.isProxy` are cancelled silently this flight (no proxy feature exists to configure credentials for); revisit if a proxy feature lands. Ruled here, not just in the spec.
- **Contents-less challenges**: the `webContents` parameter of `app.on('login')` can be undefined (utility/contents-less requests) — null-checked before `.id`; such challenges cancel silently like other non-guest challenges.
- **Sheet**: new `auth-basic` template (`src/shared/auth-basic-template.js`) in the modal-card family — host + realm display, username + password fields, submit/cancel, `dismissible: true`. Credentials ride a new dedicated `menu-overlay:auth-submit` invoke channel following the dual-zeroized Buffer discipline verbatim (`register-overlay-ipc.js:91-112` pattern: sender identity, token gate, `Buffer.from` copy, `finally { fill(0) }` both halves). Credentials never transit channel-4 `activated`.
- Trade-off: subresource challenges on tabs *do* prompt (they're guest challenges) — one at a time via the queue; accepted, that's what browsers do.

**DD3 — Agent auth path: `vaultAnswerAuth` MCP tool consuming the same pending-challenge store**
- New entry in `VAULT_TOOLS` (`src/main/automation/mcp-tools.js`), `usesEngine: false`, registered in `WCID_FIRST_CUSTOM_JAR_OPS` (`src/main/automation/scope.js:83`) like `vaultFill`.
- New `vault-context` method `answerAuth({wcId, itemId, vaultId})`: touch/revalidate → locked check → `resolveTarget` (jar membership enforced verbatim, `vault-context.js:373-396`) → look up the tab's pending challenge in the store → `resolveItem(... type === 'login')` → `originMatches` the item against the challenge's `authInfo.host`/`url` → hand `{challengeId, credential}` to an injected `answerDelegate` that resolves the store's callback. Returns `{answered, reason?}` — the credential **never** crosses the MCP boundary (mirror of `fill`, `vault-context.js:416-449`).
- The human sheet and the agent tool are two consumers of one store; whichever answers first wins, the other path is informed (sheet closes with an appropriate reason).
- Rationale: reuses every existing enforcement seam (jar scoping, origin match, audit logging via the `TOOLS` wrap) instead of inventing a parallel one.

**DD4 — Client certs: app-level handler + minimal picker sheet**
- `select-client-certificate` is an **`app` event, not a session event** (design-review correction): `app.on('select-client-certificate', (event, webContents, url, list, callback))` registered in `registerAppLifecycle` beside `app.on('login')`, same DI shape. Route by `registry.getWindowForGuest(webContents.id)` exactly as DD2 does; internal content excluded via the contents/session marker (`session.__goldfinchInternal`), not the `onSessionCreated` seam. `event.preventDefault()`; route through the same per-window queue as DD2 (same "modal challenge on a tab" shape); present a new `cert-picker` list template modeled on `vault-picker` (roving list, `src/shared/vault-picker-template.js` precedent) showing subject/issuer per cert; selection resolves `callback(cert)`; cancel resolves `callback()` (no cert).
- Chromium caches the choice per session per host — accepted at mission level; behavior verification uses a fresh session/profile per run.
- No secrets ride IPC here (cert display strings only), so channel-4 `activated` with the cert index is sufficient — no Buffer channel needed.

**DD5 — PDF: `plugins: true` on the web branch + a two-line, id-pinned nav-guard carve-out** *(security assessment)*
- `plugins: true` added to the **web** guest `webPreferences` branch only (`src/main/register-tab-ipc.js:88-108`); the internal branch stays as-is.
- Carve-out is **frame-scoped** (design-review correction): the relaxation applies only to non-main-frame navigations — `will-frame-navigate` with `isMainFrame === false`, URL parsed (not `startsWith`) with scheme `chrome-extension:` and host equal to the built-in PDF viewer's fixed extension id (`mhjfbmdgcfjbbpaeojofohoefgiehjai`). `will-navigate`/`will-redirect` (top frame) stay fully strict, so page-JS `location = chrome-extension://…` remains blocked by `guardNav` itself, and the omnibox/MCP path stays blocked by `tab-navigate`'s trust-branched gate (`register-tab-ipc.js:690-696`) — two independent seams, both probed by the behavior spec.
- **Assessment**: (a) the PDF viewer runs sandboxed in stock Chrome; `plugins: true` with `sandbox: true` preserves the mission-13 posture (`sandbox: true` confirmed live on both branches). (b) The viewer's extension frame is a *non-guest* webContents already anticipated by `ALLOWED_NONGUEST_SCHEMES` (`app-lifecycle.js:99,106-107` — comment written for exactly this). (c) The widened surface is: one fixed extension id navigable inside guests, plus the plugin process for PDF rendering. No new remote content classes, no new IPC. (d) The `__goldfinchNavGuarded` latch ordering in `wireGuestContents` is untouched but this flight adds the debrief-mandated regression test pinning it (carry-forward, see below).
- **Download interaction — empirical premise check first**: expectation is that with `plugins: true`, an inline-viewable PDF navigation renders without firing `will-download` (which auto-saves unconditionally, `register-download-ipc.js:145-150`), while `Content-Disposition: attachment` still downloads. The PDF leg's first step verifies this against the fixture before any carve-out code lands; if the premise fails, the leg diverts to header-based handling at the existing `onHeadersReceived` hook (`session-runtime.js:218-230` is the natural seam) — that's the fallback, not the plan.

**DD6 — Fixtures: one Node fixture server; client-cert live check runs under a dev-only TLS trust bypass**
- New `tests/behavior/fixtures/web-compat/serve.mjs` extending the `cross-jar-fetch/serve.mjs` pattern (zero-dep `http.createServer`, CLI args, JSONL log, in-memory assets): `401 WWW-Authenticate: Basic` endpoint (validates `Authorization`), a generated-in-memory minimal PDF endpoint (inline and `attachment` variants), a cross-scheme `302` endpoint (mission-13 carry-forward), and an HTML page with an embedded `<video>` (synthesized WAV precedent shows in-memory media is fine; a tiny generated video or a `<video>` wrapping a data source — exact asset decided in-leg) for fullscreen testing without a third-party site dependency in the automated path.
- A sibling `serve-tls.mjs` (Node `https.createServer` with `requestCert: true`) plus a keygen script generating a throwaway CA + server cert + client cert into the fixture dir (gitignored, regenerated locally — consistent with the no-committed-baselines rule). Because goldfinch has no `certificate-error` handler and Chromium won't trust a throwaway CA, the client-cert behavior spec runs the app via the automation dev launch with `ignore-certificate-errors` **only in that launch path** (`scripts/dev-launch.mjs`, flag-gated, never in production paths) — recorded as a deliberate, dev-scoped trust bypass. Client certs must also be importable for selection: Chromium reads the OS cert store, so the *chooser-appears* live check uses the OS-level test cert import documented in the spec's preconditions; unit tests carry the handler/queue logic regardless.
- The live real-video-site fullscreen check stays in the behavior spec as its own step (mission criterion says "at least one real video site").

**DD7 — Apparatus (behavior tests): goldfinch MCP acts AND observes**
- Act path: `mcp__goldfinch__navigate/click/pressKey/evaluate` drive real tabs (`npm run dev:automation`, precedent: 57 existing specs).
- Observe path, audited per criterion: fullscreen → guest bounds/z-order via `evaluate` (`document.fullscreenElement`) plus `captureScreenshot`/`captureWindow` for chrome-visibility judgment; basic auth → page body via `readDom` after submit, fixture JSONL request log via `Read` (asserts the `Authorization` header arrived — the fixture log is the read seam for "credentials reached the server"); credentials-never-in-DOM → `readDom`/`evaluate` on the page during the prompt; PDF inline → `readDom` for the viewer surface + downloads dir listing via `Bash` (asserts *no* file appeared); agent path → `vaultList`/`vaultAnswerAuth` MCP tools directly, with the `vault-login` fixture provisioner (`tests/behavior/fixtures/vault-login/build-fixtures.mjs`) as the profile-seeding precedent.

### Mission-13 carry-forward (shared-surface bundle)

Bundled because each lands on a file this flight already edits (debrief action items, `missions/13-security-hardening/mission-debrief.md:79-88`):

- [ ] **Latch-ordering regression test** — this flight edits `wireGuestContents`; add the unit test asserting `__goldfinchNavGuarded` is set before any await/event wiring (source-scan style, `test/helpers/source-scan.js` toolkit).
- [ ] **Cross-scheme 302 fixture endpoint** — folded into the DD6 fixture server. Re-running the extended `tab-scheme-guard` spec steps 14-15 is a post-flight verification item, not a leg.
- [ ] **Vault fill/capture behavior re-run under `sandbox: true`** — this is a vault-touching flight; the auth leg's verification includes running the existing vault-login behavior spec. **Scope note** (design review): `dev:automation` launches Electron with `--no-sandbox` (`package.json:12`), so this re-run exercises the sandboxed-renderer *webPreferences code paths*, not the OS sandbox itself — that is the debrief item's practical scope and is recorded as such.
- [ ] **Permission-Set comment guard** (debrief action item 7) — this flight reads and reasons about `ALLOWED_PERMISSIONS` (`session-runtime.js:13-22`); add the linked-test-name comment guarding the shared-`Set` union from a "fix the asymmetry" refactor. One comment on a surface being touched; the Set's membership is not modified.
- Not bundled: chrome-view sandbox flip (own flight per debrief).

### Prerequisites

- [x] Mission 13 merged to `main` — verified live this session (`sandbox: true` at `register-tab-ipc.js:93,103`, v0.11.6, #131 closed); the debrief's "unmerged PR chain" note is stale
- [x] `'fullscreen'` permission already allowlisted (`session-runtime.js:14`) — DD1 needs no permission change
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run a11y` green on `main` before branching (verify at execution start)
- [ ] Behavior-test apparatus probe: `npm run dev:automation` boots and `mcp__goldfinch__enumerateTabs` responds (verify before first behavior-spec run)
- [ ] Fixture ports free at run time (fixture server takes `--port`; specs must not collide with the MCP port — precedent `core-browsing-shields.md:37-38`)

### Environment conflict check

New listeners are test-time only (fixture HTTP/TLS servers on operator-chosen loopback ports, `--port` CLI); no new persistent services, databases, or containers. No conflict surface beyond port choice at spec run time.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (two runtime items re-checked at execution start)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

All changes follow the house pattern: Electron-free, dependency-injected main modules with offline unit tests plus behavior specs for live verification. New state lives on the `WindowRecord` (fullscreen mode) and in one new Electron-free module (`auth-challenges.js` pending-challenge store). New UI is two sheet templates entering the existing registry (`TEMPLATES`/`NODE_OF_ENTRY`/dispatch in `src/renderer/menu-overlay.js`, state entries in `renderer.js`, a11y-audit `SHEET_STATES` additions). **Planned pin bumps** (design review: these are certain, not conditional — `renderer.js` sits at 1700 against `RENDERER_LINE_BUDGET = 1701`, and the a11y audit seam additions trip `SEAM_COUNT = 29`): both constants in `test/unit/seam-contract.test.js` get deliberate, justified bumps in the same commit as the sheet-state additions, with the justification in the commit message. Parallel-leg log contention (mission-13 process note): legs run sequentially in this flight; the flight log has a single writer (FD).

### Checkpoints

- [ ] Fullscreen enter/exit works with overlay coordination and all exit edges unit-tested
- [ ] `will-download` premise check result recorded (PDF leg gate)
- [ ] Auth store guarantees every-callback-answered (unit-pinned)
- [ ] `vaultAnswerAuth` enforces jar + origin and never returns credentials (unit-pinned)
- [ ] All four behavior specs runnable; fixture server serves all endpoints

### Adaptation Criteria

**Divert if**:
- The `will-download` premise fails (PDF renders AND downloads) → header-based handling at `onHeadersReceived` per DD5 fallback; log the deviation
- Blink does not exit element fullscreen on Esc in Electron 43 (leave event never fires) → the defensive Esc branch becomes the primary path; log it
- `plugins: true` interacts badly with `sandbox: true` on this Electron version → stop the PDF leg, escalate to human (mission constraint territory)

**Acceptable variations**:
- Exact sheet copy/layout, close-reason strings from the validated set, fixture asset formats, cert-picker column choice
- Splitting the web-compat fixture server endpoints across files if cleaner

### Legs

> Tentative; created one at a time as the flight progresses.

- [x] `html-fullscreen` — DD1 end to end: guest-wiring events, record mode, bounds-pipeline gate, overlay/z-order coordination, exit edges (incl. cross-window move), latch regression test + permission-Set comment guard (carry-forwards), fullscreen behavior spec + fixture video page
- [x] `auth-challenges` — DD2 + DD3: pending-challenge store with the two-lifecycle contract, `app.on('login')`, auth-basic sheet + zeroized channel, `vaultAnswerAuth` tool + context method, fixture 401 endpoint, basic-auth behavior spec, vault-login re-run (carry-forward)
- [x] `client-cert` — DD4 (depends on the DD2 queue): app-level handler, cert-picker sheet, TLS fixture + cert generation + scripted OS-store import (Linux `certutil` NSS scripted in fixture README), dev-launch trust-bypass flag, client-cert behavior spec
- [x] `pdf-inline` — DD5: premise check first, `plugins: true`, frame-scoped id-pinned carve-out, PDF fixture endpoints, PDF behavior spec (independent; can run any time)

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged (draft PR #141 open; merge is post-mission-review)
- [x] Tests passing (`npm test` 2993, lint, typecheck; a11y chrome-mode clean — sheet sweep pre-broken on main, flight-logged)
- [x] Documentation updated (README web-compat notes; CLAUDE.md invariant pins + seam lockstep; docs/mcp-automation.md, docs/vault.md)

### Verification

- Behavior specs: `web-compat-fullscreen`, `web-compat-basic-auth`, `web-compat-client-cert`, `web-compat-pdf` — all pass (fullscreen spec includes the real-video-site step)
- Unit suite green including new: fullscreen mode/bounds-gate tests, every-callback-answered pin, `answerAuth` enforcement tests, carve-out predicate tests, latch regression test
- Optional (carry-forward): extended `tab-scheme-guard` steps 14-15 against the new 302 endpoint
- Manual/HAT items deferred to the alignment flight: real OAuth (Flight 2 scope), fullscreen "feel"
