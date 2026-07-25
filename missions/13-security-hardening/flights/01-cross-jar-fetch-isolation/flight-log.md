# Flight Log: Cross-Jar Fetch Isolation

**Flight**: [Cross-Jar Fetch Isolation](flight.md)

## Summary

**Landed 2026-07-25.** Both legs completed; commit `cecb7dc`; draft PR #135. Cross-jar fetch isolation shipped: favicons fetched main-side in the owning jar session as `data:` URLs; media proxied through the session-scoped `goldfinch-media:` protocol; chrome CSP forbids remote img/media (pinned); download chrome-view fallback removed; one-time default-session hygiene purge. Full gate green (2825 tests, lint, typecheck). Pre-fix leak confirmed live; post-fix behavior test `cross-jar-fetch-isolation` passes with zero cross-jar carry. No deviations (DD3 fallback not needed — Electron 43 has no protocol.handle seek limitation). **[COMPLETE:flight]**

---

## Reconnaissance Report

Source artifact: [issue #131](https://github.com/msieurthenardier/goldfinch/issues/131), finding 3 (verified against v0.11.3). Re-walked against v0.11.4 (HEAD `0e8e5f6`) at planning, 2026-07-24.

| item | classification | evidence | recommendation |
|---|---|---|---|
| (a) favicon forwarded to chrome | confirmed-live | `guest-wiring.js:164-166` — payload is `{ wcId, favicons }` (array), not `favicon` | keep; fix at this hook |
| (b) chrome assigns `img.src = favicon` | **drifted** | primary consumer is `renderer.js:1285-1293` (`favicons[0]`, no validation); `tab-controller.js:872-876` is the secondary adopt-by-drop site; payload producers `tab-controller.js:167,579` + `renderer.js:862,884` | fix all sites; issue cited only the adopt site |
| (c) media panel remote src assignments | confirmed-live, +1 site | `media-controller.js:122,128(poster),199,258,502` — issue missed the poster background at `:128` (gated by `isSafePosterUrl` but still default-session) | fix all five |
| (d) chrome view has no partition | confirmed-live | `window-factory.js:172-182` | addressed structurally via CSP + proxy (DD4: no partition change) |
| (e) chrome CSP permits remote img/media | confirmed-live | `index.html:5-8` verbatim | tighten per DD2 |
| live cookie-bearing request | needs-human-recheck → scheduled | not verifiable statically | Leg 1 baseline behavior run (DD5) |

Additional planning findings: favicons are **not** persisted anywhere (session store, closed-tab stack, history all clean — `data:` conversion has no persistence surface); downloads already ride the jar session (`register-download-ipc.js:49-67`) except the chrome-view terminal fallback (`:52-54`) — pulled into scope as DD6.

---

## Leg Progress

### favicon-jar-session-fetch — Baseline (AC2, FD-recorded)
**Status**: in-flight (Phase A complete, baseline recorded, Phase B pending)
**Started**: 2026-07-24

#### Baseline: leak CONFIRMED live (pre-fix, v0.11.4 + planning artifacts only)

Two probe runs against the fixture (`tests/behavior/fixtures/cross-jar-fetch/serve.mjs`, port 8231), app launched via `dev:automation`, tabs opened via admin `openTab` in jars `personal` then `work`. Evidence: `/tmp/behavior-tests/goldfinch/cross-jar-fetch-isolation/baseline-2026-07-24/` (`requests.log` = run 1, `requests-run2.log` = run 2 with per-boot nonce URLs).

- **Chrome fetches page-controlled URLs outside any jar session.** Run 2, jar A visit: `/favicon.ico?b=<nonce>` and a second `/pixel.png?b=<nonce>` arrive with `cookie: null` at timestamps where BOTH jar sessions demonstrably hold and send their cookies on their own requests — a third (default-session) fetch context. Run 1 shows those same context's responses **setting** cookies into that shared store.
- **Cross-jar carry demonstrated.** Jar B's visit produced **zero** chrome-side requests in both runs — jar B's tab favicon and media-panel thumbnail were rendered from jar A's fetched bytes (Blink memory image cache inside the single chrome document; `Cache-Control: no-store` does not defeat within-document reuse). One jar's network activity materializes another jar's UI: the linkability channel is real.
- **Bonus observation**: the media grid fetches thumbnails with the panel *closed* — `renderMedia()` builds `<img>` elements on every `tab-media-list` push. Pre-existing behavior, noted for leg 2 (the proxy inherits it; not new scope).
- **SameSite nuance for the acceptance spec**: default `SameSite=Lax` suppresses cookie *headers* on the chrome's cross-site subresource fetches over http — the leak manifests as shared-store/cache carry, not cookie-bearing header lines, on this fixture. Post-fix acceptance keys on per-jar fetch attribution (each jar's visit must produce its *own* resource fetches; zero suppressed-by-shared-cache renders) plus absence of any non-jar-context request. Behavior spec updated accordingly (still `draft`).

### favicon-jar-session-fetch — Phase B (fix implemented, AC3–AC7)
**Status**: landed
**Completed**: 2026-07-24

Implemented the fix per DD1: favicons are now fetched main-side in the guest's own jar session and delivered to the chrome as size-capped `data:` URLs, closing the leak channel the baseline confirmed above.

- **`src/main/favicon-fetch.js`** (new, Electron-free, injected-deps, house style per `settings-store.js`/`find-overlay-geometry.js`): `createFaviconFetcher({ maxBytes })` returns `{ request({ wcId, favicons, fetchImpl }), forget(wcId) }`. Picks `favicons[0]`; a page-declared `data:image/...` favicon (≤512 KB) passes through unchanged with no fetch (DD1 addendum); every other non-http(s) scheme is scheme-rejected; http/https favicons are fetched via the injected `fetchImpl`, and the FINAL response (after any redirect `session.fetch` follows) must be `image/*` and its actual body (never `Content-Length`) must be ≤256 KB; success resolves to a `data:<content-type>;base64,...` URL. Latest-wins via a per-wcId monotonic sequence bumped on every `request()` call (even ones that resolve to null), so a stale slow fetch racing a newer request is dropped. Every failure path resolves to `null` — the module never throws.
- **`src/main/guest-wiring.js`**: the `page-favicon-updated` hook (was `guest-wiring.js:164-166`) now calls the injected `faviconFetcher.request(...)` with `fetchImpl: (url) => wc.session.fetch(url)`, forwarding `{ wcId, favicons: [dataUrl] }` only on success (`.then`), with a terminal `.catch(() => {})`. `guest-wiring.js` stays deps-only — zero `require()`s added.
- **`src/main/main.js`**: `faviconFetcher` is constructed once, eagerly (`createFaviconFetcher()` — Electron-free, no init-ordering dependency unlike `historyRecorder`), and injected as a direct-value dep (no getter) into `createWindowFactory`, `createGuestWiring`, and `registerTabIpc`'s deps maps.
- **`src/main/register-tab-ipc.js`** and **`src/main/window-factory.js`**: `faviconFetcher.forget(wcId)` added beside both existing `forgetTab(wcId)` call sites (single tab-close at `register-tab-ipc.js:181`-area and whole-window close at `window-factory.js:275`-area) — both teardown paths now clear the per-tab favicon sequence map.
- **`src/main/move-tab-payload.js`**: `validateMoveTabPayload` normalizes a `favicon` string longer than 512 KB to `null` (the rest of the payload stays valid); constant documented inline.
- **Tests**: new `test/unit/favicon-fetch.test.js` (17 cases — scheme rejection, data: pass-through + oversized/non-image rejection, content-type/size-cap rejection, success + SVG success, final-response-after-redirect restatement, HTTP-error/thrown-fetch failure, latest-wins ordering, `forget` reset); `test/unit/move-tab-payload.test.js` gained boundary + over-cap favicon cases; `test/unit/guest-wiring.test.js` gained its first async cases (a controllable deferred fake `faviconFetcher.request`, asserting `h.sends` is empty until the fetch resolves and carries only the `data:` URL on success, nothing on failure); `test/unit/register-tab-ipc.test.js` and `test/unit/window-factory.test.js` (via `test/unit/helpers/window-factory-harness.js`'s default fake) each pin their teardown site's `faviconFetcher.forget(wcId)` call.
- **Regression**: `npm test` (2782 tests, 13 suites — all passing, run repeatedly to rule out flakiness), `npm run lint`, and `npm run typecheck` all green.
- No raw remote favicon URL reaches the chrome any more — verified via the `guest-wiring` unit pin and by inspection of every `tab-favicon` send site.

### media-proxy-and-csp — Phase A (helper + handler + wiring, AC1/AC2)
**Status**: in-flight (Phase A complete; Phase B — renderer wiring, CSP, DD6, DD7 — pending the FD's live seek smoke)
**Started**: 2026-07-24

Two-phase execution per the leg's design-review restructure (electron/electron#38749, #51442 — `protocol.handle`'s documented, still-open media-element Range/seek limitation): Phase A builds and unit-verifies the proxy plumbing in isolation; Phase B (renderer wiring, `index.html` CSP, DD6 download-fallback removal, DD7 purge) is deliberately deferred until the FD runs a live audio/video load+seek smoke against the real handler below.

- **`src/shared/media-proxy.js`** (new, pure ESM — `url-safety.js` precedent, `require(esm)` from main-side CJS): `toMediaProxyUrl(wcId, url)` wraps only `http:`/`https:` targets into `goldfinch-media://proxy/<wcId>/<encoded url>`, passing every other input (blob:, data:, garbage, non-string) through unchanged. Encoding is `encodeURIComponent` plus a post-pass that percent-escapes the six characters it misses (`) ( ' ! ~ *`) — the design-review correction to the original DD2 draft's "escapes `)`" claim. `parseMediaProxyUrl(raw)` is pure string parsing (prefix check, split on the first `/`, `decodeURIComponent` in a try/catch) — no `new URL` on the custom scheme — returning `{ wcId, url }` only when the decoded target itself parses as `http:`/`https:`.
- **`src/main/media-proxy-handler.js`** (new, Electron-free, injected-deps): `createMediaProxyHandler({ getTabContents, isInternalContents, parseMediaProxyUrl })` returns an async `(request) => Response` following `handleInternal`'s never-throw/controlled-headers discipline (`main.js:194-217` — citation-audit-corrected range), but streaming: `new Response(upstream.body, { status, headers })` with no full-body buffering. Non-GET → 405; unparseable/non-http(s) → 400; a wcId that doesn't resolve to a live, non-internal guest → 404; otherwise forwards only `Range`/`Accept` request headers to `wc.session.fetch`, and returns the upstream status with ONLY the allowlisted response headers (`content-type`, `content-length`, `content-range`, `accept-ranges`) — a thrown/rejected upstream fetch resolves to 502, never throws.
- **`src/main/main.js`**: `goldfinch-media` added as a second entry (`{ stream: true }`) in the existing module-load `registerSchemesAsPrivileged` array — call stays single, at module load. `createMediaProxyHandler` and `parseMediaProxyUrl` required alongside the existing `url-safety.js`/`internal-page.js` requires. `getTabContents`, `isInternalContents`, `createMediaProxyHandler`, and `parseMediaProxyUrl` threaded into the `registerAppLifecycle(...)` call — confirmed via citation audit that `getTabContents`/`isInternalContents` were NOT previously passed into that call at all (a real wiring gap, not already-done).
- **`src/main/app-lifecycle.js`**: the handler is built and registered on `session.defaultSession` ONLY, at the same ready-time point `wireDownloadHandler`/`applyShields`/`applySpellcheck` already run (`defaultSession.protocol.handle('goldfinch-media', createMediaProxyHandler({ getTabContents, isInternalContents, parseMediaProxyUrl }))`), mirroring how `handleInternal` reaches the internal session a few lines below. Jar-partitioned guest sessions get no handler for this scheme — same structural trust argument as `goldfinch://`.
- **Tests**: new `test/unit/media-proxy.test.js` (28 cases — http/https wrap, round-trip incl. query strings/fragments/unicode/the six missed characters, no-raw-`"`-or-`)` assertion, pass-through of blob:/data:/garbage/non-string, parse rejection of every malformed/non-http shape). New `test/unit/media-proxy-handler.test.js` (9 cases, all via fakes — method/parse/resolution/internal-refusal branches, Range+Accept forwarding with Cookie explicitly excluded, response header allowlist with `set-cookie`/`x-upstream-secret` explicitly excluded, upstream-throw → 502, plus one end-to-end case wiring the real `toMediaProxyUrl`/`parseMediaProxyUrl` together). `test/unit/app-lifecycle.test.js` gained a harness capture for the media-proxy deps + a new test pinning that `getTabContents`/`isInternalContents`/`parseMediaProxyUrl` reach `createMediaProxyHandler` unchanged and that the built handler is registered on the default session's protocol under `goldfinch-media` (and never on the internal session).
- **Regression**: `npm test` (2819 tests, 13 suites, all passing), `npm run lint`, `npm run typecheck` all green.
- **Not yet touched (Phase B, gated on the FD's live seek smoke)**: `media-controller.js`, `renderer.js`, `index.html` CSP, `register-download-ipc.js` (DD6), the DD7 default-session purge.

### media-proxy-and-csp — Phase B (renderer wiring, CSP, DD6, DD7, docs, tests)
**Status**: landed
**Completed**: 2026-07-24

Phase B proceeded per the FD's live seek smoke (recorded above under Decisions — DD3 resolved, seek works, no fallback): all five renderer media-assignment sites now wrap through the proxy as originally written.

- **`src/renderer/renderer.js`**: `toMediaProxyUrl` imported from `../shared/media-proxy.js` (alongside `isSafePosterUrl` at the `url-safety.js` import) and threaded into `createMediaController`'s deps object.
- **`src/renderer/chrome/media-controller.js`**: all five sites wrapped — image thumb (`img.src`), video poster (raw-URL `isSafePosterUrl` gate unchanged, wraps only the value going into the quoted `url("…")`), inline player (`playInline`, resolves `activeTab().wcId` at call time), lightbox (`openLightbox`, same), and docked audio (`loadCurrent`'s `pa.src` only). Docked player captures a single `player.wcId` in `playAudio` from the active tab at playlist-build time (not per-track in `loadCurrent`, which would attribute a post-switch track to the wrong jar). **Adjacent-line hazard respected**: `loadCurrent`'s `player.url = item.url` stays RAW (compared raw-to-raw against `card.dataset.url` for the now-playing highlight); only `pa.src` wraps. Selection sets and `downloadMedia` payloads keep the raw `item.url` untouched.
- **`test/unit/media-controller.test.js`**: `harness()` deps gained a `toMediaProxyUrl` stub (`(wcId, url) => \`proxy:${wcId}:${url}\``); the audio-playlist test's `.src` assertions updated to the wrapped form; a new test drives `renderMedia()`/`openLightbox()` directly and pins the image-thumb, poster-background, and lightbox sites all route through the stub.
- **`src/renderer/index.html`**: chrome CSP tightened to `img-src 'self' data: blob: goldfinch-media:; media-src 'self' blob: goldfinch-media:` (`http:`/`https:` removed from both; other directives untouched).
- **`test/unit/csp-pins.test.js`** (new): reads `index.html` + the three overlay documents as text (pattern precedent: `chrome-shared-scripts.test.js`'s `INDEX_HTML` read), extracts each CSP meta tag's `content` attribute (throws if the tag is missing — non-vacuous), and asserts (a) the chrome `img-src`/`media-src` contain no `http:`/`https:` tokens and do contain `goldfinch-media:`, (b) the three overlay CSPs (`find-overlay.html`, `menu-overlay.html`, `tearoff-overlay.html`) contain none of `http:`, `https:`, or `goldfinch-media:`.
- **DD6** (`src/main/register-download-ipc.js`): removed the `rec.chromeView.webContents` terminal fallback in `download-media`; a payload with no resolvable `wc`/`senderActiveTab` now falls through to the existing `{ ok: false, error: 'No web contents available to download with.' }` failure shape. New unit case in `register-download-ipc.test.js` pins the no-resolvable-context path (asserts the failure shape and that no `downloadURL` call occurred).
- **DD7** (`src/main/app-lifecycle.js`): one-time default-session hygiene purge via `appDb.createDocumentStore('hygiene')`, gated by a versioned marker (`default-session-purge-v1`). Placed at the END of the `app.whenReady()` callback (after `createWindow()`/session-restore/automation wiring/the `activate` listener) — fire-and-forget (`clearStorageData({ storages: ['cookies'] })` → `clearCache()` → marker write), with a terminal `.catch` that logs and skips the marker write on failure (retry next boot); never gates first paint. Two new `app-lifecycle.test.js` cases (fake-injection pattern, `appDb.createDocumentStore` + `getDefaultSession().clearStorageData`/`clearCache` fakes): a fresh profile purges once and writes the marker (ordering pinned: both clears precede the write); a profile with the marker already present performs neither clear call nor a rewrite.
- **`CLAUDE.md`**: added the chrome-fetch invariant (structural — CSP forbids remote img/media, not just convention) and a `goldfinch-media:` scheme note, placed alongside the existing internal `goldfinch://` scheme material.
- **Renderer line budget**: `renderer.js` grew by exactly 1 net line (the new `toMediaProxyUrl` import; the dep-injection line was folded onto the existing `isSafePosterUrl` deps line to hold net growth to +1). `test/unit/seam-contract.test.js`'s `RENDERER_LINE_BUDGET` raised 1700 → 1701 (documented inline, same precedent as the M11→M12 1200→1700 raise) — the seam-contract budget test caught this immediately and would have failed the gate otherwise.
- **Regression**: `npm test` (2825 tests, 13 suites, all passing), `npm run lint`, `npm run typecheck` all green.
- **Leg status**: `landed` (Phase A + Phase B both complete). AC9 (live behavior test) is run by the FD next, per the leg's Verification Steps.

---

---

## Decisions

### DD3 resolved: proxy playback works — no fallback needed (FD live smoke, 2026-07-24)
**Context**: DD3 flagged a documented, still-open Electron limitation (electron/electron#38749, #51442) where `protocol.handle` custom schemes break media-element seeking. Leg 2 was split two-phase to verify before wiring the renderer.
**Decision**: FD ran a live smoke against the Phase-A `goldfinch-media` handler (Electron 43.2, dev app): a chrome-document `<audio>` sourced from `goldfinch-media://proxy/<guest-wcId>/<track>`. Result — `loadedmetadata` ok, `duration` 10s, `seekable` end 10s, `play` ok, **seek 1.46s → 8.26s (target 7.5) with `seeked` firing, `seekWorked: true`**. The fixture request log confirmed the track was fetched **through the personal jar session** (carried `gfx_track` jar cookies) with `Range: bytes=0-`. Evidence: `/tmp/behavior-tests/goldfinch/cross-jar-fetch-isolation/smoke-2026-07-24/`. The process args also confirmed scheme registration (`--streaming-schemes=goldfinch-media`).
**Impact**: The seek limitation does NOT reproduce on Electron 43. Phase B proceeds as originally written (proxy for all five sites incl. playback); DD3's ephemeral-partition fallback is NOT invoked. A temporary one-line CSP addition (`goldfinch-media:` to img/media-src, http/https retained) hosted the smoke element and was reverted immediately after — Phase B makes the authoritative CSP change.

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Flight Director Notes

- 2026-07-24 — Flight status → in-flight; branch `flight/01-cross-jar-fetch-isolation` created. Fixture port moved 8123 → 8231 (8123 occupied by an unrelated local process — acceptable variation per flight spec).
- 2026-07-24 — Leg 1 `favicon-jar-session-fetch` designed. **Risk tier: HIGH** — security-sensitive surface (session/fetch boundary) and semantic change to the `tab-favicon` payload contents. Per-leg Developer design review required.
- 2026-07-24 — Baseline plan: the pre-fix leak confirmation runs as an FD-driven live probe (fixture + MCP + request log), not a full Witnessed `/behavior-test` run — the Witnessed acceptance run is reserved for post-fix at leg 2 end where it gates the flight. Rationale: the baseline is diagnostic evidence, not an acceptance criterion; two live-agent runs of a spec designed to FAIL pre-fix would burn crew cycles on a foregone conclusion. Leg 1 execution is two-phase (fixture → FD baseline → fix) so the baseline observes pre-fix code.

---

## Session Notes

- 2026-07-24 — Flight planned autonomously under the issue-#131 mission directive. Architect design review returned approve-with-changes; all issues incorporated same-day (DD1 ordering guard, DD6 test case, DD7 purge, helper scheme contract, overlay-CSP pins). Status → ready.
