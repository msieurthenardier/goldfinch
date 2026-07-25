# Behavior Test: Cross-Jar Fetch Isolation

**Slug**: `cross-jar-fetch-isolation`
**Status**: active
**Created**: 2026-07-24
**Last Run**: 2026-07-25-01-37-48 (pass)

## Intent

Proves that no page-controlled URL (favicon, media thumbnail, media stream) is fetched by the browser chrome outside the owning jar's session. The observable is a local fixture server's request log: which cookies arrive back on favicon/media requests reveals exactly which session made the fetch. Unit tests can pin the CSP string and the proxy plumbing, but only a live run demonstrates the end-to-end property — real favicon fetch, real media panel render, real `<audio>` streaming with seek — against a real cookie-setting server. This spec is the flight's acceptance gate; its pre-fix baseline run documents the leak being closed.

## Preconditions

- Goldfinch launched via `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`; admin key exported.
- Fixture server from `tests/behavior/fixtures/cross-jar-fetch/` running on `http://127.0.0.1:8231/` (serves a page declaring a favicon and containing an image + an audio file; every response to `/favicon.ico`, `/pixel.png`, `/track.mp3` sets a unique cookie and appends `{path, cookieHeader}` to a request log file).
- Request log file empty at start (server truncates on boot).
- Two persistent jars available (e.g. Personal and Work).

## Observables Required

- browser (tab/favicon/media-panel state — measured via goldfinch MCP: enumerateTabs, readDom/readAxTree, captureScreenshot)
- shell (fixture server lifecycle — measured via Bash)
- filesystem (request log contents — measured via Read)

## Steps

> **Cookie-observability note (from the 2026-07-24 pre-fix baseline)**: default `SameSite=Lax` suppresses Cookie *headers* on cross-site subresource fetches over http, so session identity is judged primarily by **fetch attribution** — which visits produce which request lines — and by cookie values where they do appear (the jar's own page-level `/` requests always carry that jar's cookies). The pre-fix leak manifested as jar B's visit producing *zero* resource fetches (chrome-shared memory cache served jar A's bytes cross-jar) plus non-jar-context (`cookie: null` while jars hold cookies) fetch lines. Post-fix, every jar visit must produce its own fetches.

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Start the fixture server (fresh boot mints a new URL nonce); note the log path. Open `http://127.0.0.1:8231/` in a tab in jar A (Personal). Wait for the page to finish loading and the tab favicon to appear. | Tab renders; favicon visible on the tab strip. Request log shows jar A's page + resource requests, **including exactly one favicon fetch** attributable to jar A's visit. |
| 2 | Read the request log; record the request lines and any issued cookies. | (setup/bookkeeping row — establishes jar A's visit fingerprint) |
| 3 | Open `http://127.0.0.1:8231/` in a tab in jar B (Work). Wait for load + favicon visible. Read the request log delta. | Jar B's visit produces **its own favicon fetch** (a new favicon request line appears — NOT served silently from state populated by jar A's visit), and no request in the delta carries a cookie value issued during jar A's visit. |
| 4 | In jar A's tab, reload the page. Read the request log delta. | Jar A's reload produces resource fetches attributable to jar A (page request carries jar A's cookies); the favicon fetch for jar A recurs per-tab-event rather than being satisfied by another jar's bytes. |
| 5 | Open the media panel on jar A's tab. Verify the image thumbnail renders (screenshot + DOM). | Thumbnail visible; the chrome's `<img>` src is a `goldfinch-media:` proxy URL, not a raw `http:` URL; the corresponding pixel fetch in the log is attributable to jar A's session (appears per-jar, never absent-because-cross-jar-cached). |
| 6 | In the media panel, start playback of the audio item in the docked player; let it play ≥2 s; then seek to ~75% of the track and confirm playback continues from the new position. | Audio plays and seeking works (currentTime jumps and playback resumes) — `Range` request lines visible in the request log for the track. |
| 7 | Close both tabs. Inspect the full request log. | No request line carries a cookie value issued to a different jar than the one its visit belongs to, and no resource render was satisfied cross-jar (every jar visit that displayed a resource has its own fetch line for it). |

## Out of Scope

- Sandbox/permission hardening (Flights 2–3 of mission 13).
- `blob:` media items (no network fetch; local blob registry only).
- Download paths (already jar-session; DD6's fallback removal is unit-covered).

## Variants (optional)

- Burner-jar variant: repeat steps 1–4 with jar B as a burner tab — same expectations (proxy resolves the live session, not the jar registry).
