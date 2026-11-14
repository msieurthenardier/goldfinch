# Behavior Test: Cross-Jar Fetch Isolation

**Slug**: `cross-jar-fetch-isolation`
**Status**: active
**Created**: 2026-07-24
**Last Run**: 2026-11-14-04-24-25 (pass, 10/10, batched; first run with steps 8–10; see runs/2026-11-14-04-24-25.md)

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
| 4 | In jar A's tab, reload the page. Read the request log delta. | Jar A's reload produces resource fetches attributable to jar A (page request carries jar A's cookies); no `/favicon.ico` line in the delta carries another jar's cookie. If Chromium re-fires the favicon on reload, the refetch carries jar A's cookies; if it doesn't (same-URL reloads typically don't), the tab keeps its own previously fetched `data:` favicon, which is per-wcId and never another jar's bytes. *(Amended 2026-10-06 after the sortie 02 AC12 run: no favicon refetch occurred on reload in either the 2026-07-25 or the 2026-10-06 run.)* |
| 5 | Open the media panel on jar A's tab. Verify the image thumbnail renders (screenshot + DOM). | Thumbnail visible; the chrome's `<img>` src is a `goldfinch-media:` proxy URL, not a raw `http:` URL; the corresponding pixel fetch in the log is attributable to jar A's session (appears per-jar, never absent-because-cross-jar-cached). |
| 6 | In the media panel, start playback of the audio item in the docked player; let it play ≥2 s; then seek to ~75% of the track and confirm playback continues from the new position. | Audio plays and seeking works (currentTime jumps and playback resumes) — `Range` request lines visible in the request log for the track. |
| 7 | Close both tabs. Inspect the full request log. | No request line carries a cookie value issued to a different jar than the one its visit belongs to, and no resource render was satisfied cross-jar (every jar visit that displayed a resource has its own fetch line for it). |
| 8 | *(added by Mission 23 Flight 1, leg `jar-isolation`; needs that leg's fixture route)* Open `http://127.0.0.1:8231/` in a tab in jar B and record its wcId **WB**. Open `http://127.0.0.1:8231/hostile?victim=WB` in a tab in jar A (**TA**). The hostile page contains, in this order: one ordinary same-site image; an `<img>` whose `src` is `goldfinch-media://proxy/WB/<encodeURIComponent of http://127.0.0.1:8231/pixel.png?probe=xjar>`; an `<img>` with a `file:` URL; a link with an `ftp:` URL ending `.mp3`. With **TA** active, ensure the media panel is open (click `#toggle-media` in the chrome only if it is closed) so its thumbnails load; read the panel's DOM from the chrome target; read the request log delta. | The panel lists the ordinary image only. No element in the chrome has a `src` or background naming `goldfinch-media://proxy/WB/`, `file:` or `ftp:`. The log delta contains **no** request carrying `probe=xjar`. *(On the pre-change build this request appears, made through jar B's session.)* |
| 9 | From the chrome target, `evaluate` a promise that sets an `Image`'s `src` to the old address shape `goldfinch-media://proxy/WB/<encoded http://127.0.0.1:8231/pixel.png?probe=oldshape>` and resolves `load` or `error`. Read the request log delta. | The image errors. The log delta contains no request carrying `probe=oldshape` — a tab number no longer addresses the proxy. |
| 10 | Read the `src` of **TA**'s thumbnail in the chrome and keep it as **U** (do not print it in the report; report only its shape). As a positive control, load **U** with the encoded suffix `%26probe%3Dlive` in an `Image` from the chrome target and confirm it resolves `load` and the log gains one `probe=live` line with jar A's cookies. Navigate **TA** to `http://127.0.0.1:8231/?again=1` and wait for the load to finish. From the chrome target, `evaluate` a promise that loads **U** with the encoded suffix `%26probe%3Dstale` appended in an `Image` and resolves `load` or `error`. Read the request log delta. Then reload **TA**, read its new thumbnail address as **U2** after the panel repopulates, reload **TA** again, and load **U2** with `%26probe%3Dstale2` the same way. | **U** has the form `goldfinch-media://proxy/<token>/…` where the token is not a decimal number and is at least 22 characters. After the navigation the stale address errors and the log delta contains no request carrying `probe=stale`; after the reload the same holds for `probe=stale2`. Close the tabs opened in steps 8–10. |

## Out of Scope

- Sandbox/permission hardening (Flights 2–3 of mission 13).
- `blob:` media items (no network fetch; local blob registry only).
- Download paths (already jar-session; DD6's fallback removal is unit-covered).

## Variants (optional)

- Burner-jar variant: repeat steps 1–4 with jar B as a burner tab — same expectations (proxy resolves the live session, not the jar registry).
