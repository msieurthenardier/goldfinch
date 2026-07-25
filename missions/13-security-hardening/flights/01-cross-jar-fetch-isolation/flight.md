# Flight: Cross-Jar Fetch Isolation

**Status**: landed

> Architect design review: **approve with changes** (2026-07-24) — all four issues incorporated (DD1 ordering guard, DD7 default-session purge, DD6 test coverage, helper scheme-pass-through contract) plus overlay-CSP pinning. Autonomous phase-gate progression pre-authorized (issue #131 directive).
**Mission**: [Web-Content Security Hardening](../../mission.md)

## Contributing to Criteria

- [x] No page-controlled URL is ever fetched by the browser chrome outside the owning jar's session; the chrome CSP no longer permits remote image/media origins, and a test pins the CSP. Cross-jar linkage via favicon or media-thumbnail fetches is demonstrated closed against a live cookie-setting server. *(finding 3, behavior-test-backed)*

---

## Pre-Flight

### Objective

Close the cross-jar linkability side channel: today the chrome `WebContentsView` (default session, no partition) fetches page-controlled URLs — favicons via `img.src` (`renderer.js:1292`, `tab-controller.js:875`) and media-panel thumbnails/players via `img.src`/`video.src`/`audio.src` (`media-controller.js:122,128,199,258,502`) — so a per-visitor-unique favicon or media URL served from two different jars is fetched twice with the *same* default-session cookies, trivially linking the jars. After this flight, every page-controlled URL is fetched in the owning jar's session (favicons converted main-side to `data:` URLs; media proxied through a session-scoped custom protocol), and the chrome CSP structurally forbids remote `img-src`/`media-src` so the invariant is enforced, not just observed.

### Open Questions

- [x] Does the favicon/media fetch actually carry default-session cookies live? → Leg 1 runs the baseline behavior test **before** the fix lands and records the observed behavior in the flight log. The fix proceeds either way (the fetch itself leaks a per-jar visit signal into an uninvolved session), but the baseline documents what we're closing.
- [x] Media playback (streaming, seek) through a jar-session proxy → resolved by DD2/DD3: session-scoped `protocol.handle` returning a streamed `ses.fetch` Response with Range forwarding. If live seek verification fails, the fallback is DD3's adaptation path.
- [x] Dedicated partition for the chrome view? → resolved by DD4: no — considered and rejected for this flight.

### Design Decisions

**DD1 — Favicons: main-side jar-session fetch → `data:` URL**
- At the `page-favicon-updated` hook (`guest-wiring.js:164`), main picks `favicons[0]`, validates it is `http:`/`https:`, fetches it via the guest's own session (`wc.session.fetch(...)` — resolved from the live webContents, which works for burner tabs whose partitions never appear in the jar registry), enforces a response size cap (256 KB) and an `image/*` content-type check, converts to a `data:` URL, and forwards `{ wcId, favicons: [dataUrl] }` — same payload shape, so the preload bridge, typedef, and renderer consumer logic are untouched except that what arrives is now inert data.
- Rationale: favicons render at 14×14; a self-contained `data:` URL survives the cross-window move/tear-off payloads (`tab-controller.js:167,579`, `renderer.js:862,884`) without any new plumbing, and the chrome CSP already permits `img-src data:`.
- **Ordering guard (design review)**: the hook goes async, so a per-wcId monotonic sequence (latest-wins) in the helper drops late-resolving fetches for superseded favicons — pages commonly fire `page-favicon-updated` twice (placeholder → real, SPA route changes).
- Trade-off: `data:` strings ride drag payloads and IPC; bounded by the fetch-side cap plus a favicon string length cap added to `move-tab-payload.js` validation. Fetch is async fire-and-forget with a terminal catch — a failed fetch means no favicon (today's behavior for a broken URL). Redirect note: `session.fetch` resolves 30x through Chromium's network stack (can't hand back `data:`/`file:`); the helper's `image/*` content-type + size checks apply to the final response — confirm with a unit case. SVG favicons: inert via `<img>`; add an explicit test case making that guarantee visible.

**DD2 — Media panel: session-scoped `goldfinch-media:` proxy protocol**
- Register scheme `goldfinch-media` in the module-load `registerSchemesAsPrivileged` call (`main.js:165`) with `{ stream: true }` privileges, and register a handler on the **default session only** (the chrome's session) via `session.defaultSession.protocol.handle('goldfinch-media', ...)` — mirroring the existing internal-session pattern (`app-lifecycle.js:98-102`). Web guests run in jar partitions and therefore *have no handler for the scheme* — same structural argument as the `goldfinch://` trust model.
- Proxy URL shape: `goldfinch-media://proxy/<wcId>/<encodeURIComponent(remoteUrl)>`, built by a pure `src/shared/` helper (unit-testable both directions). Handler: resolve the live guest via the trusted registry idiom (`getTabContents(wcId)` → `wc.session`; refuse internal/dead contents), validate the decoded URL is `http:`/`https:`, forward the request's `Range`/`Accept` headers to `ses.fetch`, and return a re-wrapped streamed `Response` (status + filtered headers: content-type, content-length, content-range, accept-ranges) — the `handleInternal` re-wrap discipline (`main.js:203-212`) applied to a streaming body.
- Renderer: `media-controller.js` wraps item URLs through the helper at all five assignment sites. The `isSafePosterUrl` gate keeps validating the **raw** URL before wrapping (the poster's only CSS call site wraps the value in a double-quoted `url("…")`, and `encodeURIComponent` escapes `"` → `%22` — so the quoted-string context can't be broken out of. Note: `encodeURIComponent` does **not** escape `)`, `(`, `'`, `!`, `~`, `*`; that's harmless inside a quoted CSS string, but the helper must never be dropped into an *unquoted* `url()` — design-review correction to the original "escapes `)`" claim, which was wrong).
- **Scheme pass-through is a contract of the shared helper, not call-site judgment (design review)**: the encode helper wraps iff the URL is `http:`/`https:` and returns any other scheme (`blob:`, `data:`) unchanged, with unit coverage — main cannot `ses.fetch()` a renderer-local blob URL, so an unconditional wrap would silently break blob-backed items. `blob:` stays in the CSP: blob resolution is local (blob registry, no network, no cookies) — no cross-jar signal.
- Trade-off: streaming rides through main's protocol handler; per DD3, seek/Range behavior gets explicit live verification.

**DD3 — Playback rides the same proxy; scoped fallback if Range fails live**
- The docked audio player (`media-controller.js:502`, seek handler at `:546-549`), inline video (`:199`), and lightbox (`:258`) all use proxy URLs. The behavior test includes a seek step against a real audio file.
- **Known-risk flag (design review)**: Electron's `protocol.handle` has a documented, still-open incompatibility with media-element seeking on custom schemes (electron/electron#38749 open since E25; #51442 closed "not planned" at E41 — audio affected too; some reports show it's *first-load-only*, fixed by close/reopen of the element). Leg 2 therefore runs an **early smoke probe** of load+seek against the real handler right after it's built — *before* wiring the five renderer sites/CSP/DD6/DD7 — so a DD3 diversion doesn't unwind completed work. The behavior test's seek step retries once after a close/reopen before concluding failure (avoids a false-positive diversion on the first-load-only variant).
- Adaptation path if live verification shows broken seek/streaming: keep thumbnails/favicons/lightbox on the proxy (fetch semantics, verified) and fall back for `<video>`/`<audio>` playback only to a dedicated **ephemeral** chrome-side partition (`media-playback:` non-persist) so playback fetches carry no default-session cookies and persist nothing — a scoped, documented residual (per-play network signal to the media host in a cookieless session) rather than the current cross-jar cookie leak. This fallback is a flight-log Deviation, not a silent swap — and if exercised, the mission-level criterion wording gets an explicit playback caveat at debrief (it must not read as unconditionally closed).

**DD4 — No dedicated partition for the chrome view (this flight)**
- Rationale: once no remote fetch sites remain and the CSP forbids remote `img-src`/`media-src`, the chrome makes no page-controlled network requests in *any* session — the CSP is the structural enforcement. The chrome renderer holds zero web storage (verified: no localStorage/cookies/indexedDB usage anywhere in chrome code), so a partition would protect nothing that the CSP doesn't already.
- Avoided cost: a new partition fires `session-created` → would need the `creatingInternalSession`-style exclusion dance in `session-runtime.js`, plus updates to four byte-exact `window-factory` test pins. Not worth it for zero marginal isolation.
- Revisit trigger: if Flight 2's chrome-view sandbox assessment ends up touching `window-factory` webPreferences anyway, the partition question may be reopened there at near-zero extra cost.

**DD5 — Verification apparatus: fixture server request log (act + observe audited)**
- **Act path**: goldfinch MCP surface (admin mode, `npm run dev:automation`) opens tabs in distinct jars against a local fixture server (committed under `tests/behavior/fixtures/`, run via shell) that serves a page whose favicon and media resources `Set-Cookie` per response and **logs every request line + Cookie header to a file**.
- **Observe path**: the server's request log (filesystem apparatus) is the single observable for the criterion — which session fetched is proven by which cookies arrive back. Pre-fix baseline: visit from jar A (cookie set on favicon response), visit from jar B → favicon request arrives **with** jar A's cookie ⇒ default-session carry confirmed. Post-fix: jar B's favicon/media requests arrive with **no** cookie (and a same-jar revisit arrives **with** that jar's cookie — proving the fetch rides the jar session, not nothing-at-all).
- This avoids any need to read Electron's default-session cookie store from outside the app — the audit's observability premise holds with zero test-only seams.
- Behavior spec: `tests/behavior/cross-jar-fetch-isolation.md` (authored this flight, draft below in Verification).

**DD6 — Download fallback tightening (minor, in scope)**
- `register-download-ipc.js:52-54` falls back to the chrome view's webContents when no guest resolves — the one path where a *download* could ride the default session. The fallback chain ends at the sender's active tab; the chrome-view terminal fallback is removed (a download with no resolvable jar context fails loudly instead). New unit case in `register-download-ipc.test.js` asserting the no-resolvable-context path fails loudly (no coverage exists today for that branch).

**DD7 — One-time default-session hygiene purge (design review)**
- Closing the path forward doesn't remove cross-jar state *already planted* pre-fix: nothing in the codebase ever purges `session.defaultSession` (all existing `clearCache`/`clearStorageData` calls target jar sessions only). A profile upgrading from an earlier build keeps the linkage-bearing cookies/cache live, ready to reactivate if any future feature issues a default-session request.
- Fix: a one-time versioned purge of `session.defaultSession` cookies + HTTP cache at startup, gated by a settings-store/app-db marker (following the existing migrate-once discipline). Safe because the chrome holds zero web storage (DD4's verified premise).

### Prerequisites

- [x] Mission 13 active; issue #131 finding 3 re-verified against v0.11.4 (recon in flight log)
- [x] Electron ^43.2.0 — `session.fetch`, streaming `protocol.handle` Responses available (verified in package.json; `net.fetch` already used at `main.js:203`)
- [ ] Live apparatus probe before execution: `npm run dev:automation` boots under WSLg and the goldfinch MCP surface responds (admin mint) — verified at flight start, not assumed
- [ ] Port for the fixture server free (default 8231 — chosen to avoid the documented `python3 -m http.server 8000` a11y fixture convention)

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified (live probe at execution start)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Main-side: extend `guest-wiring.js`'s favicon hook with jar-session fetch + `data:` conversion (new Electron-free helper module with injected fetch for unit testing); add `goldfinch-media` scheme registration at module load and a default-session `protocol.handle` proxy in `app-lifecycle.js`/`main.js` following the internal-session registration shape; remove the chrome-view download fallback. Shared: new pure proxy-URL encode/decode helper in `src/shared/` (ESM, unit-tested). Renderer: wrap the five media assignment sites; favicon consumers unchanged (payload shape preserved). CSP: `img-src 'self' data: blob: goldfinch-media:; media-src 'self' blob: goldfinch-media:` — `https:`/`http:` removed from both. Tests: new unit coverage for the favicon fetch helper (size cap, content-type, scheme rejection, fetch failure), proxy handler (wcId resolution, URL validation, header filtering, internal-contents refusal), payload cap; a source-scan-style CSP pin reading `index.html` (pattern: `chrome-shared-scripts.test.js`); updated expectations in `media-controller.test.js` (proxy-wrapped `.src`) and `register-browser-ipc.test.js` if the hop changes.

The CSP source-scan pin also asserts the three overlay documents (`find-overlay.html`, `menu-overlay.html`, `tearoff-overlay.html`) keep CSPs free of `goldfinch-media:`/`https:`/`http:` — today they can't reach the proxy scheme only because their CSPs are strict, and that invariant is otherwise unpinned. The shared proxy helper follows the `url-safety.js` precedent (ESM `export` + main-side `require(esm)` under Node ≥22) — leg confirms this load path explicitly, it's load-bearing for main-side decode.

Known test-impact set (from planning interrogation): `media-controller.test.js:105,120-124` assert raw URLs today; `move-tab-payload.test.js` gains cap cases; `guest-wiring.test.js` has **no** favicon coverage today — new test, not an edit; `register-download-ipc.test.js` gains the DD6 loud-failure case; `register-browser-ipc.test.js:110-112` pass-through pin only if the hop changes.

### Checkpoints

- [x] Baseline behavior run recorded (leak confirmed or refuted, flight log entry)
- [x] Favicons render as `data:` URLs from jar-session fetches; cross-window move/adopt still carries them
- [x] Media panel fully functional through the proxy: thumbnails, posters, inline video, lightbox, docked audio with working **seek**
- [x] CSP tightened + pinned; full suite green (`npm test`, lint, typecheck)
- [x] Post-fix behavior run: no cross-jar cookie carry, jar-session cookies observed

### Adaptation Criteria

**Divert if**:
- `protocol.handle` streaming cannot satisfy `<audio>`/`<video>` Range semantics live → invoke DD3's scoped playback fallback (flight-log Deviation) rather than shipping broken playback or reopening the leak.
- The favicon `data:` payload breaks cross-window drag at realistic sizes → fall back to re-fetching in the destination (still jar-session) rather than growing payload caps.

**Acceptable variations**:
- Exact cap values (favicon size, payload length), header allowlist contents, fixture server implementation language.
- Whether the proxy helper lives in one shared module or two (encode renderer-side / decode main-side).

### Legs

> **Note:** Tentative; legs are planned and created one at a time as the flight progresses.

- [x] `favicon-jar-session-fetch` — Fixture server + behavior spec authored and baseline run recorded; favicon main-side jar-session fetch → `data:` URL with caps; move-payload cap; unit tests.
- [x] `media-proxy-and-csp` — `goldfinch-media` scheme + default-session proxy handler; renderer wrapping at all five sites (helper contract: wrap http/https only); download fallback removal (DD6); one-time default-session purge (DD7); CSP tightening + pin (chrome + overlays); unit tests; post-fix behavior run including playback/seek.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged (flight branch `flight/01-cross-jar-fetch-isolation`, commits `flight/01: …` + `Mission: 13` trailer)
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`)
- [x] Documentation updated (CLAUDE.md: chrome fetch invariant + `goldfinch-media` scheme noted alongside the internal-scheme section)

### Verification

- Behavior test `cross-jar-fetch-isolation` (Witnessed pattern, `/behavior-test cross-jar-fetch-isolation`): fixture server log proves (1) pre-fix baseline recorded, (2) post-fix: no default-session cookie carry across jars, (3) same-jar revisit carries that jar's cookie, (4) media playback + seek functional through the proxy.
- Unit: CSP pin; favicon fetch helper; proxy encode/decode + handler; full suite green.
