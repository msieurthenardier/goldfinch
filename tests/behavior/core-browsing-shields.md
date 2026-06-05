# Behavior Test: Core browsing + Shields survive the Electron upgrade

**Slug**: `core-browsing-shields`
**Status**: draft
**Created**: 2026-06-05

## Intent

After the Electron 33 → 42 major upgrade, verify that the core runtime behaviors that unit tests and `@ts-check` cannot observe still work: the app launches, a tab navigates and renders a real page, the Shields `webRequest` pipeline still **blocks a known third-party tracker** and **strips tracking params**, and multi-tab works. This needs a behavior test (not a unit test) because the behavior lives in the live Chromium/Electron `session.webRequest` layer that the major upgrade most threatens — only the running app proves the privacy enforcement survived the Chromium bump.

## Preconditions

- Goldfinch (post-upgrade) is running via `npm run dev:debug` (CDP at `:9222`, `--no-sandbox`).
- A local HTTP fixture is served (a page that references a known tracker domain and carries tracking params) at a known `http://127.0.0.1:PORT/` URL — **use a port other than 9222** (the CDP port), e.g. `8080`; serve via `python3 -m http.server 8080` (or `npx serve -l 8080`) from the fixture dir. **Why a served fixture**: the tracker-block assertion needs a page whose HTML requests a registrable domain that is in `src/main/trackers.js`'s `TRACKERS` map — use `<script src="https://www.google-analytics.com/analytics.js"></script>` (`google-analytics.com` → `analytics`, confirmed in `trackers.js`) so the Shields `block` strategy cancels it; the param-strip assertion needs the page loaded at a URL carrying `utm_*` params.
- **Active precondition probe** (Step 1): confirm `:9222` answers and the fixture serves before exercising anything.
- Shields are at defaults (all on) — the test asserts default-on behavior; if a prior run paused a site, reset (the app starts with `pausedSites: []`).

## Observables Required

- browser (rendered tab state, webview target url/body, the per-tab privacy aggregate exposed to the renderer, the address-bar value — measured via CDP at `:9222`; screenshot + the renderer's privacy state as primary)
- shell (precondition probes: port reachability, fixture HTTP 200 — Bash/curl)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe: `curl http://127.0.0.1:9222/json/version` and the fixture URL. | Both respond (devtools lists a Goldfinch window incl. a `webview` target; fixture returns HTTP 200). Halt if not. |
| 2 | App-launch smoke: list CDP targets. | A renderer `page` target (Goldfinch chrome) and at least one `webview` guest target exist — the app started cleanly on the new Electron (no white screen / crash). |
| 3 | Open a tab to a real page (`https://example.com/`) and wait for load. | The webview navigates to `https://example.com/`; its body contains "Example Domain"; the address bar shows `https://example.com/`. Core navigation + rendering survived the upgrade. |
| 4 | Navigate a tab to the local fixture loaded at `http://127.0.0.1:8080/?utm_source=test&q=keep`. Wait for load. | The fixture renders; the resulting **webview `src` / address-bar URL** has the tracking param **stripped** — `utm_source` gone, `q=keep` preserved — confirming the top-level navigation strip redirect (`session.webRequest` → `redirectURL`) still works. (Observe the URL, **not** the privacy aggregate's `stripped` count — that field is 0 for mainFrame navigation by design: `recordRequest` returns early on `resourceType==='mainFrame'`. Don't assert on it.) |
| 5 | On the renderer target, **open the privacy panel first** (click `#toggle-privacy` / the Shield button if the panel is collapsed), then read the rendered blocked-tracker state from the DOM: `Runtime.evaluate` `document.querySelectorAll('.tag.blk').length` (count of blocked-tracker tags) and/or `document.getElementById('privacy-count').textContent` (shows `Shield (N)`, total tracker count). | After loading the fixture (which requests `google-analytics.com`), **≥1 blocked tracker is shown** (`.tag.blk` count ≥ 1, or the privacy panel lists `google-analytics.com` as blocked) — the `session.webRequest.onBeforeRequest` block path survived the Chromium bump. The privacy state lives in the renderer's `tabs` map (no JS global) and is **DOM-readable only with the panel open** — the read path is the rendered panel, not a global. |
| 6 | Open a second tab (new-tab affordance) to another page; **poll** `http://127.0.0.1:9222/json` (with a timeout) until a second `webview` target appears. | Two distinct `webview` targets exist; tab switching works; no crash. Multi-tab + session wiring intact. (Poll for the new target — there's a brief window where the webview is in the DOM but its CDP target hasn't registered.) |

## Out of Scope

- Fingerprint farbling correctness, downloads-to-disk, container/jar cookie isolation, New Identity — these are deeper runtime behaviors; this spec is the **core browsing + Shields-blocking smoke gate** for the upgrade. (Note as residual upgrade risk; a fuller privacy behavior suite is a future spec.)
- Hostile-URL scheme guarding — covered by the separate `tab-scheme-guard` spec (re-run alongside this one post-upgrade).

## Variants (optional)

- N/A for the draft. Could later parametrize Step 5 over multiple tracker categories (ads/analytics/social).
