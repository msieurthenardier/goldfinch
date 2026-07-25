# Leg: favicon-jar-session-fetch

**Status**: completed

> Developer design review: approve with changes (2026-07-24) — data:-favicon pass-through carve-out added (AC3/AC6/Edge Cases), AC4 pluralized to both `forgetTab` teardown sites, fetcher placement fixed to main.js-constructed injected dep.
**Flight**: [Cross-Jar Fetch Isolation](../flight.md)

## Objective

Favicons are fetched main-side in the owning jar's session and delivered to the chrome as size-capped `data:` URLs (latest-wins per tab), with the cross-jar fixture server built and the pre-fix leak baseline recorded in the flight log.

## Context

- Flight DD1 (jar-session favicon fetch → `data:` URL, ordering guard, caps), DD5 (fixture-server request log as the observable). Read the flight spec's Design Decisions in full before starting.
- Today the hook forwards raw page-declared URLs: `src/main/guest-wiring.js:164-166 (in wireTabViewEvents) — "wc.on('page-favicon-updated', guard((_event, favicons) => { sendToChrome('tab-favicon', { wcId, favicons }); }))"`. The chrome then assigns `img.src` directly: `src/renderer/renderer.js:1288 — "const fav = favicons && favicons[0]"` and `src/renderer/chrome/tab-controller.js:875 (adopt-by-drop) — "img.src = payload.favicon"`. Those chrome consumers are **unchanged** by this leg — the payload shape `{ wcId, favicons: string[] }` is preserved; what arrives is now an inert `data:` URL (or nothing).
- The fetch must resolve the session from the **live webContents** (`wc.session`), never the jar registry — burner partitions (`burner:<n>`) exist only renderer-side and never appear in the registry.
- Two-phase execution (Flight Director orchestrates): **Phase A** builds the fixture server; the FD then records the pre-fix baseline (leak confirmation) live; **Phase B** implements the fix. Do not start Phase B until the FD confirms the baseline is recorded.

## Inputs

- Flight branch `flight/01-cross-jar-fetch-isolation` checked out; working tree contains only mission-13 planning artifacts.
- Behavior spec exists at `tests/behavior/cross-jar-fetch-isolation.md` (fixture contract: port 8231, paths `/`, `/favicon.ico`, `/pixel.png`, `/track.mp3`, per-response `Set-Cookie`, request log).
- `npm test` green at leg start.

## Outputs

- `tests/behavior/fixtures/cross-jar-fetch/serve.mjs` — zero-dependency Node fixture server.
- `src/main/favicon-fetch.js` — new Electron-free, injected-deps favicon fetch module + unit suite.
- `src/main/guest-wiring.js` — favicon hook rewired through the module.
- `src/main/move-tab-payload.js` — favicon length cap.
- Flight log: baseline entry (leak confirmed/refuted, with request-log evidence) + leg progress entry.

## Acceptance Criteria

- [x] **AC1 (fixture)**: `node tests/behavior/fixtures/cross-jar-fetch/serve.mjs --port 8231 --log <path>` serves: `/` (HTML page declaring `<link rel="icon" href="/favicon.ico">`, an `<img src="/pixel.png">`, and an `<audio>`-discoverable `/track.mp3` reference); `/favicon.ico` (valid small image); `/pixel.png` (valid PNG); `/track.mp3` (WAV/MP3 audio bytes, honoring `Range` requests with 206 + `Content-Range`). Every response to those three resource paths carries a fresh unique `Set-Cookie: gfx=<random>` and appends a JSON line `{ts, path, cookie, range}` to the log file. No runtime dependencies.
- [x] **AC2 (baseline)**: Flight log contains a baseline entry recorded by the Flight Director from a live pre-fix run against the fixture (leak confirmed or refuted, with log-line evidence). *(FD-owned — the Developer does not implement this.)*
- [x] **AC3 (helper)**: `src/main/favicon-fetch.js` exports a factory (injected deps: `fetchImpl` at minimum) whose per-tab request path: picks `favicons[0]`; **passes through a page-declared `data:image/...` favicon unchanged without fetching** (inert, non-network — DD1 addendum mirroring DD2's scheme-pass-through contract) provided its length ≤ 512 KB; rejects all other non-`http:`/`https:` schemes without fetching; fetches http/https; rejects responses whose final content-type is not `image/*` or whose body exceeds 256 KB; resolves to a `data:<content-type>;base64,...` URL. Latest-wins: a per-wcId monotonic sequence drops any resolution that is not the newest request for that wcId. A `forget(wcId)` clears per-tab state. All failure paths resolve to "no favicon" (never throw).
- [x] **AC4 (wiring)**: The `page-favicon-updated` hook calls the helper with the guest's own `wc.session`-bound fetch and forwards `{ wcId, favicons: [dataUrl] }` only on success; nothing is sent on failure. `forget(wcId)` is invoked from **both** teardown paths that already call the history recorder's `forgetTab`: `src/main/register-tab-ipc.js:181` (single tab-close) and `src/main/window-factory.js:275` (whole-window close, iterating `rec.tabViews`) — missing either leaks per-tab map entries for the process lifetime. No raw remote favicon URL reaches the chrome any more.
- [x] **AC5 (payload cap)**: `validateMoveTabPayload` normalizes a favicon string longer than 512 KB to `null` (payload otherwise valid) — `src/main/move-tab-payload.js:validateMoveTabPayload`.
- [x] **AC6 (unit tests)**: New suite `test/unit/favicon-fetch.test.js` covers: scheme rejection (`javascript:`, `goldfinch:`, `file:`), `data:image/...` pass-through (unchanged, no fetch call) + oversized-`data:` rejection + non-image `data:text/html` rejection, content-type rejection (`text/html` response), size-cap rejection, success → well-formed `data:` URL, SVG favicon (`image/svg+xml`) succeeds (inert-via-`<img>` guarantee made visible), final-response validation (the helper checks the *final* response's type/size — `session.fetch` follows 30x transparently, so this is the success path restated with a non-original URL's response), latest-wins ordering (slow first fetch resolving after a fast second is dropped), `forget` clears state. `move-tab-payload.test.js` gains the cap cases. A `guest-wiring` test asserts the hook no longer forwards raw remote URLs — note the harness is fully synchronous today; the favicon cases are its first async tests (await the fake fetch chain via a controllable deferred before asserting `h.sends`).
- [x] **AC7 (regression)**: `npm test`, `npm run lint`, `npm run typecheck` all pass.

## Verification Steps

- AC1: start the server; `curl -s -D - http://127.0.0.1:8231/favicon.ico -o /dev/null` shows `Set-Cookie`; `curl -s -H 'Range: bytes=0-99' -D - http://127.0.0.1:8231/track.mp3 -o /dev/null` shows `206` + `Content-Range`; log file gains JSON lines.
- AC3/AC5/AC6: `npm test` (the new suites run under `node --test test/unit/*.test.js`).
- AC4: `grep -n "page-favicon-updated" src/main/guest-wiring.js` shows the helper call; the unit pin from AC6 enforces it.
- AC7: run all three commands with a timeout guard.

## Implementation Guidance

**Phase A — fixture server (then STOP for FD baseline)**

1. `tests/behavior/fixtures/cross-jar-fetch/serve.mjs`: plain `node:http`. Parse `--port`/`--log` args. Generate audio in-memory at boot (a RIFF/WAV sine of ~10 s is trivial to synthesize — no committed binary; name the route `/track.mp3` per the spec but serve `audio/wav` bytes, or rename route + spec to `/track.wav` consistently, your call — keep spec and server consistent). Implement `Range` on the audio route (single-range, 206, `Accept-Ranges: bytes`). Unique cookie per resource response: `gfx_<path-slug>=<crypto.randomUUID()>`. Append log lines with `fs.appendFileSync`. Truncate log at boot.
2. Signal readiness for the FD baseline (report Phase A complete before touching `src/`).

**Phase B — favicon fetch module + wiring**

3. `src/main/favicon-fetch.js` (CJS, `// @ts-check`, house style: Electron-free, injected deps — exemplars: `src/main/settings-store.js`, `src/main/find-overlay-geometry.js`):
   - `createFaviconFetcher({ maxBytes = 256 * 1024 } = {})` returning `{ request({ wcId, favicons, fetchImpl }), forget(wcId) }` (exact shape at your discretion; keep the fetch injected per call so the wiring can pass `(url) => wc.session.fetch(url)` and tests pass fakes).
   - Latest-wins: `Map<wcId, seq>`; capture `const mySeq = ++seq` before awaiting; after resolution, drop unless `mySeq === map.get(wcId)`.
   - Size check: prefer reading the body via `response.arrayBuffer()` and checking `byteLength` (Content-Length can lie); content-type from `response.headers.get('content-type')`, must match `/^image\//`.
   - Base64 via `Buffer.from(buf).toString('base64')`.
4. Wire `src/main/guest-wiring.js:164-166`: inside the existing `guard(...)`, call the fetcher; `.then(dataUrl => { if (dataUrl) sendToChrome('tab-favicon', { wcId, favicons: [dataUrl] }); })` with a terminal `.catch(() => {})`. **Placement (design-review ruling)**: construct the fetcher in `main.js` next to the history recorder and inject it into `createGuestWiring`'s deps object as a direct value `faviconFetcher` (no getter — unlike `getHistoryRecorder` there is no init-ordering dependency); `guest-wiring.js` stays deps-only with zero `require()`s, per its own "owns no Electron state" docstring. Add `faviconFetcher.forget(wcId)` beside **both** existing `forgetTab(wcId)` call sites: `src/main/register-tab-ipc.js:181` and `src/main/window-factory.js:275` (thread the fetcher to both — follow how the recorder reaches each site).
5. `move-tab-payload.js`: in `validateMoveTabPayload`, after the type checks, normalize `favicon.length > 512 * 1024` to `null`. Document the constant inline (data:-URL favicons introduced by mission 13 flight 01).
6. Tests per AC6. For the guest-wiring pin: the existing `test/unit/guest-wiring.test.js` harness has no favicon coverage — add a case driving `page-favicon-updated` with a fake session fetch and asserting the chrome receives a `data:` URL, plus a case asserting failure sends nothing.
7. Update docs only if CLAUDE.md's favicon-adjacent claims change (none expected this leg; the CSP/proxy documentation lands in leg 2).

## Edge Cases

- **Two rapid favicon updates** (placeholder → real): latest-wins guard — unit-pinned.
- **Tab closed mid-fetch**: `guard()` already no-ops on destroyed `wc` at event time; post-await, `sendToChrome` resolves the chrome at send time (event-time routing) and a destroyed guest simply results in a dropped send; `forget(wcId)` prevents stale map growth.
- **Internal (`goldfinch://`) pages**: their favicon URLs (non-http) are scheme-rejected — no fetch, no send; behavior identical to today (internal pages declare no favicons).
- **Page-declared `data:` favicons**: passed through unchanged (≤ 512 KB, `data:image/` prefix) — inert local content, no network fetch; dropping them would regress a legitimate pattern.
- **Empty favicons array / falsy `favicons[0]`**: no fetch, no send (today the renderer dropped it at `:1289`; now main drops it earlier).
- **HTTP error responses (404/500)**: treat as failure (check `response.ok`).

## Files Affected

- `tests/behavior/fixtures/cross-jar-fetch/serve.mjs` — new
- `src/main/favicon-fetch.js` — new
- `test/unit/favicon-fetch.test.js` — new
- `src/main/guest-wiring.js` — favicon hook rewired
- `src/main/move-tab-payload.js` — cap in `validateMoveTabPayload`
- `test/unit/move-tab-payload.test.js` — cap cases
- `test/unit/guest-wiring.test.js` — favicon hook coverage
- `missions/13-security-hardening/flights/01-cross-jar-fetch-isolation/flight-log.md` — baseline + leg entries

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [ ] If final leg of flight: (not applicable — leg 2 follows)
- [ ] Commit deferred to flight end (batched review/commit per orchestration mode)

---

## Citation Audit

Verified at leg design time (2026-07-24): `guest-wiring.js:164-166` snippet matches (read directly); `renderer.js:1288` snippet matches (planning interrogation, same session); `tab-controller.js:875` matches; `move-tab-payload.js:validateMoveTabPayload` read in full this session — favicon type check at line 34, normalization at line 48. All 5 citations OK.
