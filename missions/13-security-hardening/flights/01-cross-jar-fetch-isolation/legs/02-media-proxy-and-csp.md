# Leg: media-proxy-and-csp

**Status**: completed

> Developer design review: approve with changes (2026-07-24) — incorporated: DD2/AC1 CSS-encoding correction (`encodeURIComponent` doesn't escape `)`; strict encoder + assert-no-raw-`"`), early two-phase smoke probe for the Electron protocol.handle seek limitation (#38749/#51442), media-controller harness stub note, `loadCurrent` adjacent-line hazard (`player.url` stays raw), DD7 end-of-ready non-blocking placement, citation drift fixes.
**Flight**: [Cross-Jar Fetch Isolation](../flight.md)

## Objective

All media-panel remote URLs load through a jar-session-scoped `goldfinch-media:` proxy protocol, the chrome CSP forbids remote image/media origins (pinned by test), the chrome-view download fallback is removed, a one-time default-session hygiene purge ships, and the post-fix behavior test passes live.

## Context

- Flight DD2 (proxy protocol), DD3 (playback rides proxy; scoped fallback if Range fails live), DD6 (download fallback removal), DD7 (default-session purge). Read the flight spec's Design Decisions in full.
- DD6's removal target confirmed: the terminal `|| (rec ? rec.chromeView.webContents : null)` at `register-download-ipc.js:54`; removal falls through to the existing failure shape `{ ok: false, error: 'No web contents available to download with.' }` (`:55`) — keep that shape, add the missing test for the branch.
- Leg 1 landed: favicons already arrive as `data:` URLs; this leg owns the remaining remote-assignment sites — all in `src/renderer/chrome/media-controller.js`: image thumb (`:122 — "img.src = item.url"` with `img.loading='lazy'`), video poster (`:128 — isSafePosterUrl gate + backgroundImage`), inline player (`playInline`, `:199 — "player.src = item.url"`), lightbox (`openLightbox`, `:258`), docked audio (`loadCurrent`, `:502 — "pa.src = item.url"` with seek handler at `:546-549`; note `player.url = item.url` at `:501` stays RAW).
- `mediaCard(item, tab)` receives the owning tab (use `tab.wcId`); `playInline`/`openLightbox` run against `activeTab()` at interaction time (fine — the item belongs to the active tab). The **docked audio playlist** (`:487-497`) plays across tab switches: capture the owning `wcId` into the queue entries at build time — an event-time `activeTab()` would attribute the stream to the wrong jar after a switch.
- Baseline finding (flight log): the media grid fetches thumbnails even with the panel closed (`renderMedia()` on every `tab-media-list` push). The proxy inherits this; not new scope.
- Chrome CSP today: `src/renderer/index.html:5-8 — "img-src 'self' data: https: http: blob:; media-src 'self' https: http: blob:"`. Overlay CSPs (strict, must stay that way): `find-overlay.html:5`, `menu-overlay.html:5` (`default-src 'self'`), `tearoff-overlay.html:7` (`default-src 'none'`).
- Protocol precedent: scheme privileges at module load `src/main/main.js:166 — "protocol.registerSchemesAsPrivileged([{ scheme: 'goldfinch', ... }])"`; session-scoped handler `src/main/app-lifecycle.js:102 — "internalSession.protocol.handle('goldfinch', handleInternal)"`; response re-wrap discipline `src/main/main.js:187-216 (handleInternal)`.
- wcId → live guest: `src/main/main.js:329-336 (getTabContents)`; internal-contents refusal idiom: `isInternalContents`.

## Inputs

- Leg 1 landed (uncommitted, on `flight/01-cross-jar-fetch-isolation`); `npm test` green (2782 tests).
- Fixture server final (`tests/behavior/fixtures/cross-jar-fetch/serve.mjs`, nonce + no-store).
- Behavior spec `tests/behavior/cross-jar-fetch-isolation.md` (post-baseline revision, attribution-based expectations).

## Outputs

- `src/shared/media-proxy.js` (new ESM) + unit suite — encode/decode helpers.
- `src/main/media-proxy-handler.js` (new, Electron-free injected-deps) + unit suite — the protocol handler body.
- `src/main/main.js` — scheme privilege registration + handler construction/wiring.
- `src/main/app-lifecycle.js` (or main.js wiring, whichever composition point fits the existing shape) — default-session `protocol.handle('goldfinch-media', ...)` registration + DD7 purge.
- `src/renderer/chrome/media-controller.js` — five sites wrapped; playlist entries carry `wcId`.
- `src/renderer/index.html` — CSP tightened.
- `src/main/register-download-ipc.js` — chrome-view fallback removed.
- New CSP pin test; updated `media-controller.test.js`; DD6/DD7 tests; CLAUDE.md updates.

## Acceptance Criteria

- [x] **AC1 (shared helper)**: `src/shared/media-proxy.js` exports `toMediaProxyUrl(wcId, url)` — returns `goldfinch-media://proxy/<wcId>/<encoded url>` iff `url` parses with protocol `http:`/`https:`; returns `url` unchanged for every other input (blob:, data:, garbage, non-string → returned as-is) — and `parseMediaProxyUrl(raw)` — pure string parsing (no `new URL` on the custom scheme), returning `{ wcId: number, url: string }` only for a well-formed proxy URL whose decoded target is http/https, else `null`. **Encoding (design-review correction)**: `encodeURIComponent` does NOT escape `)` `(` `'` `!` `~` `*` — use a strict encoder that additionally percent-escapes those six (post-pass `.replace`), as defense-in-depth for any future unquoted CSS/attr call site. Round-trip is unit-pinned including query strings, fragments, unicode; the test asserts no raw `"` **or** `)` survives encoding.
- [x] **AC2 (scheme + handler)**: `goldfinch-media` is registered in the module-load `registerSchemesAsPrivileged` array with `{ stream: true }`; a handler built by `src/main/media-proxy-handler.js`'s factory (injected deps: `getTabContents`, `isInternalContents`, parse fn) is registered on the **default session only**. Handler behavior (unit-pinned with fakes): non-GET → 405; unparseable/non-http(s) → 400; wcId that doesn't resolve to a live, non-internal guest → 404; otherwise forwards `Range` and `Accept` request headers to the guest session's `fetch`, and returns a Response with the upstream status and **only** allowlisted headers (`content-type`, `content-length`, `content-range`, `accept-ranges`), streaming the upstream body (no buffering of the full body in the handler).
- [x] **AC3 (renderer)**: all five media-controller assignment sites wrap through the injected `toMediaProxyUrl`; the poster site still gates the **raw** URL with `isSafePosterUrl` before wrapping; docked-audio queue entries capture their owning `wcId` at playlist build; selection sets and `downloadMedia` payloads keep the **raw** `item.url` (downloads already ride the jar session main-side).
- [x] **AC4 (CSP)**: `index.html` CSP becomes `img-src 'self' data: blob: goldfinch-media:; media-src 'self' blob: goldfinch-media:` (other directives untouched). A new source-scan-style unit test pins: (a) the chrome CSP's `img-src`/`media-src` contain no `http:`/`https:` tokens and do contain `goldfinch-media:`; (b) the three overlay documents' CSPs contain no `http:`, `https:`, or `goldfinch-media:` sources (they must stay unable to reach the proxy).
- [x] **AC5 (DD6)**: the chrome-view terminal fallback in `src/main/register-download-ipc.js:52-54` is removed — a `download-media` invoke with no resolvable guest context fails loudly (consistent with the handler's existing failure shape) instead of downloading via the default session; unit test covers the no-resolvable-context path.
- [x] **AC6 (DD7)**: on startup, exactly once per profile, the default session's cookies and HTTP cache are purged, gated by a persisted marker (app-db document row, migrate-once discipline); unit-testable via injected fakes; a second startup with the marker present performs no purge.
- [x] **AC7 (docs)**: CLAUDE.md gains the chrome-fetch invariant (no page-controlled URL fetched outside the owning jar's session; chrome CSP forbids remote img/media — enforcement, not just convention) and a `goldfinch-media:` scheme note alongside the internal-scheme material.
- [x] **AC8 (regression)**: `npm test`, `npm run lint`, `npm run typecheck` all pass; `media-controller.test.js` updated expectations (proxy-wrapped `.src`; raw URLs in download payloads).
- [x] **AC9 (live acceptance)**: `/behavior-test cross-jar-fetch-isolation` passes (run by the Flight Director post-implementation): per-jar fetch attribution for favicon + thumbnail, proxy URLs visible in chrome DOM, audio playback + seek working through the proxy, zero cross-jar carry. **If seek fails** even after a close/reopen retry, DD3's scoped playback fallback is invoked and recorded as a flight-log Deviation (see the early smoke probe in guidance — this should already be known before AC9).

## Verification Steps

- AC1/AC2/AC5/AC6: `npm test`.
- AC4: `npm test` (pin) + read the diff of index.html.
- AC3: unit assertions in media-controller.test.js + AC9's live DOM check.
- AC9: FD launches `dev:automation` + fixture, runs the behavior test per the skill.

## Implementation Guidance

**⚠️ Two-phase execution (design-review restructure).** Electron's `protocol.handle` has a known, unresolved media-element Range/seek limitation (electron/electron#38749 open since Electron 25; #51442 closed "not planned" against an implementation matching this leg's exact approach; one reporter notes the failure may be first-load-only). DD3's fallback exists for exactly this. To avoid building renderer wiring on an unverified premise: **Phase A** = steps 1–3 (helper + handler + scheme/session wiring) plus unit tests, then STOP — the FD runs a live audio/video seek smoke against the real handler (including a close/reopen retry before concluding failure, per the first-load nuance). Phase B proceeds per the smoke's verdict: seek works → wire all five sites through the proxy as written; seek broken → DD3 fallback for `<audio>`/`<video>` playback (ephemeral non-persist chrome-side partition), thumbnails/poster/lightbox stay on the proxy, and the deviation is recorded in the flight log.

1. **`src/shared/media-proxy.js`** — ESM (`export function`), consumed by the chrome via disk-relative import and by main via Node ≥22 `require(esm)` (the `url-safety.js` precedent — confirm the require works from main at implementation time). Parsing: operate on the raw string (`goldfinch-media://proxy/` prefix check, split on the next `/`, `decodeURIComponent` the remainder in a try/catch); do **not** rely on `new URL` for the custom scheme.
2. **`src/main/media-proxy-handler.js`** — factory `createMediaProxyHandler({ getTabContents, isInternalContents, parseMediaProxyUrl })` returning an async `(request) => Response` suitable for `protocol.handle`. Follow `handleInternal`'s never-throw + controlled-headers discipline (`main.js:187-216`), but stream: `new Response(upstream.body, { status, headers })`. Build error responses with plain `new Response(null, { status })`.
3. **Wiring in `main.js`/`app-lifecycle.js`**: add the scheme to the existing `registerSchemesAsPrivileged` array literal (same call, second entry — the call must remain single and at module load). Register the handler where the app's ready-time session wiring lives, on `session.defaultSession` (injected as `getDefaultSession` in app-lifecycle — mirror how `handleInternal` reaches its session). Thread `getTabContents` from main.js.
4. **Renderer**: inject `toMediaProxyUrl` into `createMediaController`'s deps from `renderer.js` (import it there alongside `isSafePosterUrl` at `renderer.js:13`). Wrap: `img.src = toMediaProxyUrl(tab.wcId, item.url)` (`:122`); poster `if (isSafePosterUrl(item.poster)) thumb.style.backgroundImage = url("${toMediaProxyUrl(tab.wcId, item.poster)}")` (`:128`); `playInline`/`openLightbox` resolve `activeTab().wcId` at call time; docked player: a single `player.wcId` set in `playAudio` from the active tab (the playlist is always built from one tab — simpler than per-entry tagging), used by `loadCurrent`. **⚠️ Adjacent-line hazard**: `loadCurrent` has `player.url = item.url` (`:501`) immediately above `pa.src` (`:502`) — wrap ONLY `pa.src`; `player.url` is compared raw-to-raw against `card.dataset.url` (`:514`, `:136`) for the now-playing highlight, and wrapping it silently breaks the highlight. **Harness note**: `createMediaController` destructures its full deps bag — `test/unit/media-controller.test.js`'s `harness()` deps object (`:53-58`) MUST gain a `toMediaProxyUrl` stub (e.g. `(wcId, url) => \`proxy:${wcId}:${url}\``) or nearly every existing test throws; update `.src`/`backgroundImage` assertions to the wrapped form.
5. **CSP**: edit `index.html:7`; new `test/unit/csp-pins.test.js` reading `src/renderer/index.html`, `find-overlay.html`, `menu-overlay.html`, `tearoff-overlay.html` as text (pattern precedent: `test/unit/chrome-shared-scripts.test.js` reads INDEX_HTML at `:44`), extracting the CSP meta content and asserting token sets per AC4. Keep assertions non-vacuous (fail if the meta tag is missing).
6. **DD6**: inspect `register-download-ipc.js:49-67`; remove the `rec.chromeView.webContents` terminal fallback; return the handler's existing failure shape (read how it reports failures today — keep consistent). Add the loud-failure unit case in `register-download-ipc.test.js`.
7. **DD7**: read a document-store row (`createDocumentStore('hygiene')` — confirmed coherent with app-db's API, no schema-ladder change); if the purge marker is absent, purge default-session cookies + cache, then write the marker. **Placement (design-review ruling)**: at the END of the `app.whenReady()` callback — after `createWindow()`/session restore/automation wiring — so "after `appDb.open` (`app-lifecycle.js:83`)" is satisfied by ordering and first paint is never gated on the purge; run it fire-and-forget with a terminal catch (failure = no marker write = retry next boot; never blocks or crashes boot). Unit-test via app-lifecycle's existing fake-injection pattern or a small extracted helper.
8. **CLAUDE.md**: add the invariant + scheme note (AC7); keep edits surgical.
9. Run the full gate (AC8) with timeouts; hand back to the FD for AC9.

## Edge Cases

- **Tab closed while docked audio plays**: subsequent Range requests 404 (guest gone → no session). Accept and document: cross-tab playback survives tab *switches* (wcId captured at build), not tab *closure* of the owning tab. If review finds today's behavior differs materially, note it in the flight log rather than engineering around it.
- **Burner tabs**: `getTabContents` resolves live burner guests (registry holds them); the proxy must work for burners — covered by resolving the session from the live webContents.
- **Duplicate items across jars**: same remote URL in two jars yields two distinct proxy URLs (different wcIds) — no chrome-renderer memory-cache cross-jar reuse (this is what closes the baseline's carry channel). Do not "optimize" by normalizing proxy URLs across tabs.
- **`blob:` items**: pass through unwrapped (AC1) and remain loadable under the CSP (`blob:` kept).
- **Upstream fetch rejection mid-stream**: handler resolves 502 on a thrown fetch; a stream error after headers is Chromium's problem (media element error UI) — never crash main.

## Files Affected

- `src/shared/media-proxy.js`, `test/unit/media-proxy.test.js` — new
- `src/main/media-proxy-handler.js`, `test/unit/media-proxy-handler.test.js` — new
- `src/main/main.js`, `src/main/app-lifecycle.js` — wiring + DD7
- `src/renderer/chrome/media-controller.js`, `src/renderer/renderer.js` — wrapping + dep injection
- `src/renderer/index.html` — CSP
- `test/unit/csp-pins.test.js` — new
- `src/main/register-download-ipc.js`, `test/unit/register-download-ipc.test.js` — DD6
- `test/unit/media-controller.test.js`, `test/unit/app-lifecycle.test.js` — updates
- `CLAUDE.md` — invariant + scheme note
- flight-log.md — leg entry

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (AC9 run by FD)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [ ] Final leg: flight.md → `landed` + mission.md checkbox (at flight-end commit stage)
- [ ] Commit batched at flight end (review first)

---

## Citation Audit

Verified at leg design time (2026-07-24, this session): media-controller sites `:122` (`img.src = item.url`), `:128` (poster gate) read directly; `playInline :191`, `openLightbox :254`, `loadCurrent :498` symbol-verified via grep; `main.js:166` scheme registration and `app-lifecycle.js:102` session-scoped handler read directly; `index.html:5-8` CSP verbatim from planning interrogation (same session); `register-download-ipc.js:49-67` per planning interrogation; `getTabContents` at `main.js:329-336` per planning interrogation. Leg-1-adjacent lines unaffected by leg 1's changes (media-controller untouched in leg 1).

**Design-review citation corrections**: `handleInternal`'s function body spans `main.js:194-217` (the `:187-216` cited in Context includes preceding comment lines — the re-wrap discipline referenced is real). Docked-audio seek handler is at `:546-549`, not `:538-541` (that range is `fmtTime()`) — corrected in Context. `getTabContents` is confirmed NOT currently threaded into the app-lifecycle registration call — the guidance's "thread it from main.js" is a real wiring gap, not already-done. All targets accurate for implementation.
