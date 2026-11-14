# Leg: jar-isolation

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Stop a page from making the browser fetch through another jar, or write into another jar's history: the media list is validated in main, the media proxy is addressed by an unguessable per-tab token instead of a tab number, a media download accepts only web URLs, and a history title update can only touch the visit it belongs to.

This is the first half of the flight's `jar-isolation-and-downloads` entry. The downloads half (DD9: owning-jar Retry, file naming, gated open) is leg `downloads`, split out at leg design because it shares no code or risk with this one beyond one registrar file.

## Context

- **Decisions**: DD8 (media list validation; proxy token), DD10's title-scoping part, and finding NF13 ([`guard-audit.md`](../guard-audit.md)).
- **Mission findings**: 4 (the proxy fetches through whichever tab a page-supplied URL names), 9 (a title update can overwrite another jar's visit).
- **What is true today** (surveyed 2026-11-14, working tree with legs 2–4 landed and leg 5 in flight):
  - The guest preload's `collect()` (`src/preload/webview-preload.js`) runs in the page's world and applies no scheme filter except dropping `blob:`. `register-browser-ipc.js` forwards `guest-media-list` to the chrome verbatim, unbounded.
  - `toMediaProxyUrl` (`src/shared/media-proxy.js`) returns anything that is not http(s) **unchanged**. A page can therefore list `goldfinch-media://proxy/<another tab's number>/<url>` and the chrome will load it; the handler (`src/main/media-proxy-handler.js`) fetches through the session of whatever tab the number names. Tab numbers are small integers.
  - The chrome assigns list URLs at five sinks in `src/renderer/chrome/media-controller.js` (thumbnail, poster, inline player, lightbox, docked audio) and uses the raw URL as its selection and player key, with a comment that the player key must stay raw.
  - `download-media` (`src/main/register-download-ipc.js`) passes `url` to `downloadURL` with no check at all; its pending-download record is keyed by URL alone, across every tab and jar.
  - `history-store.js` updates a title with `WHERE id = ?`; `visits.id` is a plain rowid that SQLite reuses after deletes; the recorder (`history-recorder.js`) keeps a per-tab handle to its last visit that nothing clears when a jar's history is cleared, pruned or deleted.
- **Decisions taken at leg design** (logged in the flight log):
  1. **Inline images are kept, narrowly.** DD8 lets "the inline schemes the panel already renders without a fetch" survive. In practice that is `data:` on image items only. They stay, as raster image types under a size cap; everything else that is not http(s) is dropped.
  2. **The token rides the existing list push.** No new channel: the chrome receives the tab's current token with each list and never keeps one beyond the list it arrived with; the docked player captures the token it started with, as it already captures the tab number.
  3. **History handles are made self-invalidating rather than hooked.** DD10 says the recorder's handle is dropped when its jar is cleared; three unrelated modules clear history. Instead the handle carries the visit's own timestamp and the update matches on id, jar **and** timestamp, so a reissued row id can never match — in another jar or the same one — and no cross-module hook is needed. Same outcome; logged as a deviation in wording.
  4. **The pending-download record is keyed by tab and URL**, so a page-started download of the same URL in another tab cannot pick up the media panel's suggested name or folder.
- **Not in this leg**: anything else about downloads (leg `downloads`); history search and navigation bounds (`prompts-and-bounds`); favicons (already fetched main-side through the owning session).

## Inputs

- Branch `flight/01-page-containment` with legs 2–5 landed (uncommitted).
- `src/shared/media-proxy.js`, `src/main/media-proxy-handler.js`, its registration in `src/main/app-lifecycle.js`; `gate.tabGuest.on('guest-media-list'` in `src/main/register-browser-ipc.js`; `onTabMediaList` in `src/preload/chrome-preload.js` and `src/renderer/renderer.js`; `src/renderer/chrome/media-controller.js`.
- Per-tab lifecycle points already used by other per-tab maps: tab close in `register-tab-ipc.js`, window close in `window-factory.js`, the main-frame navigation handlers in `guest-wiring.js`.
- `tests/behavior/cross-jar-fetch-isolation.md` (active, 7/7 on 2026-10-06) and its fixture `tests/behavior/fixtures/cross-jar-fetch/serve.mjs`.

## Outputs

- A pure main-side media-list validator; a per-tab proxy-token store; the proxy handler resolving tokens.
- `toMediaProxyUrl` answering nothing for anything that is not http(s); every chrome sink handling that.
- `download-media` scheme check and per-tab pending key.
- History title update bound to its own visit.
- `cross-jar-fetch-isolation` extended (three steps, authored with this leg) and its fixture's hostile page.

## Acceptance Criteria

### Media list validation (main)

- [ ] A pure, Electron-free validator turns whatever the guest sent into a clean list or an empty one, never throwing: not an array → empty; at most a stated number of items (one constant); each item rebuilt from an explicit field list — `type` from the closed set the preload produces, `url`, `name`, and the optional `width`, `height`, `alt`, `label`, `poster` — with strings length-capped, numbers finite and non-negative, and every other key dropped.
- [ ] `url` survives only if it parses as `http:` or `https:`, **or** the item is an image and the URL is a `data:` URL of a raster image type (a closed list; not SVG) under a stated size cap. `poster` survives only as http(s). An item whose `url` fails is dropped whole; a failed `poster` is removed and the item kept.
- [ ] The validator runs at the `guest-media-list` registration; the chrome only ever receives its output. A unit table covers: `goldfinch-media:`, `file:`, `ftp:`, `javascript:`, `blob:`, `about:`, a custom scheme, `data:text/html`, `data:image/svg+xml`, an oversize `data:` image, a non-string URL, a prototype-polluted or getter-bearing item, an oversize list, and a well-formed list passing through unchanged in order.
- [ ] The existing registrar test that expects a verbatim forward is rewritten to the new contract, not deleted.

### Proxy token

- [ ] **A token belongs to a document.** Main keeps, per tab, the token (at least 128 bits from a cryptographic source, base64url) together with the main-frame frame token of the document it was minted for, and a reverse map from token to tab. On each `guest-media-list` the handler reads the sender frame's frame token and the sender's current main-frame frame token as plain values inside a `try`; if either is missing or they differ, **the list is dropped and nothing is pushed** — a late list from a document that has already been replaced is never given the new document's token. Otherwise the stored token is reused when its frame token matches, or a new one is minted and the old reverse entry deleted.
- [ ] At `did-navigate` on the tab (cross-document main-frame commits only, a reload included) the token is invalidated **unless** it was already minted for the document that is now current — a new document whose list arrived before the commit event keeps its fresh token. `did-start-navigation` is not used (a cancelled navigation would strand a live document). The token is also deleted when the webContents is destroyed, which covers tab close and window close without editing those paths; it follows the tab across a move between windows because the webContents does. Same-document navigation changes nothing.
- [ ] Lifecycle unit matrix: mint; reuse; a list from a stale frame token dropped; mint-before-commit surviving `did-navigate`; invalidation at commit; reload; destroy; a move.
- [ ] The list push to the chrome carries the tab's current token beside the list. A token is never sent to a guest, and no code path logs it (design review saw none on stdout for a refused or failed proxy request with Electron's logging enabled; DevTools' own network view is outside this criterion).
- [ ] The proxy URL is `goldfinch-media://proxy/<token>/<encoded url>`. The handler resolves the token to its tab and fetches through that tab's session; The pure parser accepts any token of the base64url alphabet up to a stated length and returns `{ token, url }`; the store is the single authority, reached through one new injected resolver on the handler — so an unknown token, a replaced token and a decimal tab number all answer 404. Method, target-scheme, internal-tab and header rules are unchanged. Unit-pinned, including the end-to-end wiring test with the real builder and parser.
- [ ] `toMediaProxyUrl(token, url)` returns `null` unless the URL is http(s) and the token is a non-empty string. The tests that pin "passes through unchanged" are inverted, by rename rather than delete-and-re-add.
- [ ] Every chrome sink handles `null` explicitly — nothing assigns it to a `src` or interpolates it into a style: thumbnail, poster, inline player, lightbox, docked audio, and the play/pause truthiness read. An inline `data:` image is assigned directly at the two image sinks and nowhere else. The raw URL remains the selection key, the card key and the player key.
- [ ] The docked player and its playlist use the token captured when playback began; after that tab navigates, the stale token fails closed (playback stops; no request reaches another tab) — unit-pinned at the handler, `[by-eye]` for what the player shows.
- [ ] Grep AC: no `http(s):` URL from a media item is assigned to an element or style in `media-controller.js` except through the proxy builder (the standing chrome-fetch invariant), and `toMediaProxyUrl` has no caller that passes a tab number.

### Added at design review

- [ ] **Validator constants are named and stated**: maximum items (2000), maximum web URL length (2048), maximum `data:` URL length (one constant, stated in the flight log), maximum text length for `name` / `label` / `alt`. The length check runs **before** any URL parsing.
- [ ] A `data:` item's `name` is synthesised (`image.<type>`): today the name derived from a `data:` URL is its entire payload, which would become the suggested file name.
- [ ] The stray boolean the preload leaks onto embed items is dropped by the explicit field list; an embed with a non-web URL is dropped like any other item.
- [ ] The docked player captures the **token** where it captures the tab number today, and the tab number is no longer needed there.
- [ ] The getter-bearing-item unit case is a defensive input only — messages arrive as plain cloned data — and is described as such.
- [ ] **Order of work**: the validator, parser, handler, chrome sinks, download checks and history change first (files no other in-flight work touches); the three wiring edits (`main.js`, `guest-wiring.js`, `register-browser-ipc.js`) last. `register-tab-ipc.js` and `window-factory.js` need no edit.

### Media download

- [ ] `download-media` refuses, before touching anything, a `url` that is not a string parsing as `http:` or `https:` — a `blob:` URL (it resolves only in the downloading tab's own storage and session, so it cannot name another jar), or a `data:` image URL of the same closed raster types and cap as the validator. Design review measured that saving `data:` and `blob:` images works today and that `file:` also downloads today — refusing `file:` and every other scheme is the hole this closes, without regressing save-image. The page context menu's save-image and the panel's single and bulk download all go through this check. Unit-pinned per scheme; a refused call starts no download and records nothing.
- [ ] The pending-download record is keyed by the downloading tab and the URL, matched against the `webContents` the download event reports (a download with no reporting webContents never matches), and **consumed when the download starts** rather than when it finishes, so a request that never produced a download leaves nothing behind for a later page-started download to inherit. A page-started download of the same URL from a different tab gets Chromium's own name and the default folder. Unit-pinned.

### History title

- [ ] The title update matches on the visit's id, jar, **URL** and recorded timestamp, with numbered SQL parameters throughout (the store's standing rule against mixing bare and numbered parameters). The recorder's per-tab handle carries all four. (Timestamp alone is not enough: a row id reissued within the same millisecond would match.)
- [ ] The store's update already reports whether a row changed; the recorder broadcasts `history-changed` only when one did, and forgets its handle when none did.
- [ ] Unit tests on the real store: tab in jar A records a visit; jar A's history is cleared; a visit in jar B is recorded and receives the reused row id; the tab's later title update changes **no row**, and no `history-changed` is broadcast for it. The same sequence within one jar — with the test's clock advancing between the visits, and once more with the same URL — also changes no row. A normal title update still works and still broadcasts its own jar.
- [ ] The full-text index needs no change (it is keyed by row and follows the row's update trigger) — asserted by a search for the new title after a normal update and for the absence of the hostile title after a refused one.

### Shared mechanisms (each sharer asserted unaffected)

- [ ] **The list push to the chrome** — sharers: the media panel, the toolbar's media count, the docked player. Assertion: `media-controller` suite green with the proxy stub updated to the new signature; the count reflects the validated list.
- [ ] **Per-tab lifecycle points** (tab close, window close, navigation, move) — sharers: history recorder, favicon fetcher, capture drops, the picker context. Assertion: the token's hooks are additive; `guest-wiring.test.js` and `register-tab-ipc.test.js` pins hold.
- [ ] **The proxy registration** — exactly one handler, on the default session, never the internal session (`app-lifecycle.test.js` pin unchanged). The chrome's CSP is unchanged (`csp-pins.test.js`).
- [ ] **The history store's statements list and `setTitle` signature** — every caller found by search (the recorder is the only one) and the pins in `history-store.test.js` / `history-recorder.test.js` updated.

### Behaviour and regression

- [ ] `/mission-control:behavior-test cross-jar-fetch-isolation` passes with its three new steps (run by the Flight Director). **Non-vacuity**: before any source change, the Developer runs the new hostile fixture page on the unmodified build and records that the fixture's log shows the cross-jar request the new step 8 forbids. If it does not appear on the unmodified build, stop and report — the step would prove nothing.
- [ ] Live smoke (dev mode, env-key scripts) exercises every apparatus primitive against the new state, and: the media panel on a normal page (thumbnails, lightbox, inline video, docked audio with a seek); a bulk download; save-image from the page context menu's backing call; a tab moved to a second window keeps playing; a history title appears for a fresh visit.
- [ ] `[by-eye]`, deferred to `hat-and-alignment`: the docked player's behaviour when its tab navigates away; the media panel's look with dropped items; the download toast.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `renderer.js` stays at or under 1505 lines: the list handler and the on-navigation reset each set the list and the token in one statement on their existing lines, and the token's type goes on an existing typedef line or in the tab controller's typedef — no new line. Evaluate seam 41.

### Docs

- [ ] `CLAUDE.md`'s chrome-fetch invariant paragraph states the token and the main-side validation; the header comments of `media-proxy.js` and `media-proxy-handler.js` and the list push's type declaration are corrected. (`docs/` does not describe the proxy today.)

## Verification Steps

1. Hostile fixture page, then the non-vacuity run on the unmodified build.
2. Unit suites with the runner's timeout: validator table, token lifecycle, handler, builder, controller sinks, download checks, history sequence.
3. Neuters: validation bypassed → the registrar test goes red; the handler resolving a tab number → red; the jar clause removed from the title update → red.
4. Live smoke; Flight Director: `cross-jar-fetch-isolation`.

## Implementation Guidance

1. Fixture and non-vacuity.
2. Validator (pure) and its wiring.
3. Token store, push field, handler, builder; then the chrome sinks.
4. `download-media` check and pending key.
5. History title.
6. Smoke; docs.

## Edge Cases

- **A list arriving before the navigation it belongs to has committed, or just after the next one started**: the token is replaced at commit; a list from the old document that arrives late is given the new token or dropped — one rule, stated and unit-pinned.
- **A tab with no list yet** has no token; the chrome builds no proxy URL for it.
- **Two windows showing the media panel for a moved tab**: the token follows the tab.
- **Chrome recovery or a tab move**: nothing re-pushes a media list today, so the panel is empty until the page's next rescan — existing behaviour, unchanged. The token itself stays valid, because it follows the webContents and its document.
- **Internal tabs and popups** send no media list through this path (popups are refused by the gate today).
- **Very large `data:` images**: dropped by the cap, not truncated.
- **A redirect at the proxied URL** is followed by the session as today; noted, not changed.
- **A title update for a visit whose row was pruned and not reissued**: changes no row, silently.

## Files Affected

A new `src/main/` media-list validator and proxy-token module; `src/main/register-browser-ipc.js`, `src/main/media-proxy-handler.js`, `src/main/app-lifecycle.js` (handler deps), `src/main/main.js` (wiring), `src/main/guest-wiring.js`, `src/renderer/chrome/tab-controller.js` (typedef and initial tab object), `src/shared/media-proxy.js`, `src/preload/chrome-preload.js` (only if the push shape is declared there), `src/renderer/renderer.js` (the list handler), `src/renderer/renderer-globals.d.ts`, `src/renderer/chrome/media-controller.js`, `src/main/register-download-ipc.js`, `src/main/history-store.js`, `src/main/history-recorder.js`, their unit tests (`media-proxy`, `media-proxy-handler`, `media-controller`, `register-browser-ipc`, `register-download-ipc`, `history-store`, `history-recorder`, `app-lifecycle`), `tests/behavior/fixtures/cross-jar-fetch/serve.mjs`, `CLAUDE.md`, `docs/`.

## Citation Audit

From a read-only survey of the working tree on 2026-11-14, cited by symbol: `webview-preload.js` — `collect()`, `absUrl`; `register-browser-ipc.js` — "gate.tabGuest.on('guest-media-list', {}"; `media-proxy.js` — `toMediaProxyUrl`, `parseMediaProxyUrl`; `media-proxy-handler.js` — `createMediaProxyHandler`, `handleMediaProxy`; `media-controller.js` — the five sinks, `isSafePosterUrl`, the raw-key comment at the docked player; `register-download-ipc.js` — the `download-media` registration, `pendingDownloads`, `wireDownloadHandler`; `history-store.js` — the `setTitle` statement; `history-recorder.js` — `handleTitleUpdated`, `lastVisitByWc`. Design review (2026-11-14) verified these with standalone probes on the project's Electron: an old document's last list can arrive after `did-navigate` with a live sender frame whose frame token differs from the current main frame's; every cross-document navigation, reload and history hop gives a new frame token and same-document navigation does not; `data:`, `blob:` and `file:` URLs all download today; the download event reports the downloading webContents for tab-started downloads; a reissued row id can match on timestamp alone within one millisecond.

## Post-Completion Checklist

- [ ] Leg status `landed`; flight log entry under `## Leg Progress` with the non-vacuity result, constants, neuter text, smoke observations, the by-eye list and any deviation.
- [ ] No commit. Signal `[LAND:leg]`.
