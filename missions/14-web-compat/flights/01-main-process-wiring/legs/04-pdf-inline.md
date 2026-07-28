# Leg: pdf-inline

**Status**: landed
**Flight**: [Main-Process Wiring — Fullscreen, Auth Challenges, Inline PDF](../flight.md)

## Objective

Enable Chromium's built-in PDF viewer for web guests per flight DD5 — `plugins: true` plus the frame-scoped, id-pinned nav-guard carve-out — with the empirical `will-download` premise check gating the work, and land the mission-13 carry-forward 302 fixture endpoint.

## Context

- DD5 (flight.md, security-assessed): `plugins: true` on the **web** branch only; carve-out applies **only** to `will-frame-navigate` with `isMainFrame === false`, parsed URL, scheme `chrome-extension:`, host exactly `mhjfbmdgcfjbbpaeojofohoefgiehjai`. Top-frame events stay strict (two independent refusal seams: `guardNav` for page-JS, `tab-navigate`'s trust-branched gate for omnibox/MCP).
- **Premise check FIRST** (divert criterion): expectation is that with `plugins: true` an inline PDF renders without firing `will-download` (which auto-saves unconditionally — `register-download-ipc.js:145-149`), while `Content-Disposition: attachment` still downloads. If the premise fails → divert to header-based handling at `onHeadersReceived` (`session-runtime.js:218-230` seam); log the deviation and stop for FD guidance before implementing the fallback.
- The non-guest side is prepared **if** the viewer is a separate webContents: `ALLOWED_NONGUEST_SCHEMES` (`app-lifecycle.js:124`, comment written for exactly this) would cover it. Which architecture Electron 43 actually exhibits (separate-webContents vs guest-subframe) is what the premise check's three-outcome table discovers — do not assume either going in.
- Carry-forward: the cross-scheme 302 endpoint is still a fixture TODO (`serve.mjs:20` comment) — this is the flight's last leg; it lands here (endpoint only; the extended `tab-scheme-guard` re-run stays post-flight optional).
- Citation refresh from review: `tab-navigate`'s trust-branched gate is now at `register-tab-ipc.js:715-726` (drifted from `:690-696` by legs 01-02 insertions).

## Inputs

- Legs 01–03 landed (uncommitted); `npm test` 2984 green, lint/typecheck clean.
- Fixture server with `/protected`, `/video.html`, `/media.wav`; JSONL logging.
- Draft behavior spec `tests/behavior/web-compat-pdf.md` (steps 1–4 guest-content + filesystem observables; steps 5–6 guard probes).

## Outputs

- `plugins: true` on the web guest branch (`register-tab-ipc.js:104-105` region); internal branch untouched
- Frame-scoped carve-out wrapper over `guardNav` on `will-frame-navigate` (lands only on premise outcome (ii)), extension id as a named constant
- Fixture endpoints: `/doc.pdf` (inline, generated minimal PDF), `/doc-attachment.pdf` (same bytes + `Content-Disposition: attachment`), `/redirect-302` (cross-scheme 302, mission-13 carry-forward)
- Premise-check result recorded in the flight log (checkpoint from the flight spec)
- Behavior spec `web-compat-pdf` → `active`
- Unit tests: carve-out predicate (subframe-only, id-pinned, top-frame strict), webPreferences branch assertion, fixture endpoint checks

## Acceptance Criteria

- [x] Premise check performed against the live dev app BEFORE the carve-out lands, result recorded in the flight log: navigating a guest to `/doc.pdf` with `plugins: true` renders inline without a `will-download` firing; `/doc-attachment.pdf` downloads (fixture JSONL + downloads dir as the read seams)
- [x] `plugins: true` present on the web guest branch only; internal branch webPreferences unchanged; `sandbox: true` retained on both (unit-pinned)
- [x] A **`chrome-extension:` navigation** is allowed iff it is a `will-frame-navigate` subframe event (`isMainFrame === false`) with host equal to the pinned viewer id (`guardNav` itself stays strict on all three events; the carve-out is a `will-frame-navigate`-only wrapper); unit matrix: viewer subframe allowed; top-frame `will-navigate`/`will-redirect` refused; **subframe `will-redirect`** refused; missing-`isMainFrame` event refused; different extension id refused; ordinary http subframes unaffected. *(Whole criterion applies only on premise outcome (ii); on outcome (i) the strictness cases land without the wrapper.)*
- [x] Live guard probes match the spec's observables: omnibox/MCP navigation to the extension URL does not commit; page-JS top-frame attempt does not commit (tab remains on the fixture page, no extension content in DOM) — seam attribution is carried by the unit matrix, not the live probe (Chromium may refuse web→extension navigation before any event fires)
- [x] `/redirect-302` serves a 302 whose target is configurable via `?to=` with the **pinned default `Location: data:text/html,redirected`** (cross-scheme, refused by `isSafeTabUrl` — usable by the deferred `tab-scheme-guard` re-run) — endpoint verified by curl; no app code involved
- [x] `npm test`, `npm run lint`, `npm run typecheck` pass; no new a11y surface (no sheet changes this leg)
- [x] Behavior spec `web-compat-pdf` active; FD decides run vs defer (steps 1–4 need no window-level captures — potentially runnable under the jar-scoped identity)

## Verification Steps

- `node --test test/unit/guest-wiring.test.js` (carve-out matrix) + full gates
- Fixture: `curl -sI http://127.0.0.1:{P}/doc.pdf` (200, `application/pdf`, inline) / `curl -sI .../doc-attachment.pdf` (`Content-Disposition: attachment`) / `curl -sI .../redirect-302` (302 + Location)
- Premise check per AC 1 against `npm run dev:automation`

## Implementation Guidance

1. **Premise check first**: extend `serve.mjs` with the three endpoints (in-memory generated PDF — **2–3 pages** with large distinctive base-14 Helvetica text per page, so scroll is a real observable and captures carry identifiable content; no committed binary; `Cache-Control: no-store`; JSONL-log hits). Launch the dev app with a **temporary local** `plugins: true` (superseded by step 2 — not a deviation to log) **plus temporary diagnostic logging on the guest's three nav events** (event name, `url`, `isMainFrame`), navigate a tab to `/doc.pdf` via MCP, and classify against the **three-outcome table**:
   - **(i) Renders inline, no `will-download`, no `chrome-extension:` event on the guest** → separate-webContents viewer path; premise holds but the carve-out would be dead code. **FD ruling (pre-made): do NOT land an unexercised security relaxation** — land `plugins: true` + the strictness unit matrix only, amend flight DD5 in place with the finding, record in the flight log.
   - **(ii) No render; diagnostic shows `guardNav` refusing a `chrome-extension:` subframe event** → carve-out is needed; land it (step 3), re-run, then judge the download premise.
   - **(iii) Renders AND `will-download` fires** → divert to the `onHeadersReceived` fallback per Context; stop for FD guidance.
   Record the observed outcome, the `isMainFrame` field's empirical presence per event, whether `plugins: true` gates anything beyond PDF in Electron 43 (docs check — DD5 scopes the widened surface to the PDF plugin process; confirm), and the dev profile's effective downloads directory (needed by the spec's snapshot-diff) in the flight log as the DD5 checkpoint.
2. **webPreferences**: add `plugins: true` to the web branch (`register-tab-ipc.js:104-105` region, beside `sandbox: true`); assert both branches in `register-tab-ipc.test.js` (web has it, internal does not, sandbox retained).
3. **Carve-out** (only on outcome (ii)) in `guest-wiring.js`: hoist `PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'` (module-level const, comment citing DD5's security assessment). **Registration shape: the wrapper REPLACES the `will-frame-navigate` registration** (`guest-wiring.js:99`), delegating to `guardNav` when the carve-out doesn't match; `will-navigate`/`will-redirect` keep bare `guardNav`. (Keeping both listeners on `will-frame-navigate` would leave strict `guardNav` still `preventDefault`ing the viewer subframe — the allow path would be dead.) This makes DD5's "`will-navigate`/`will-redirect` stay fully strict" literally true. Wrapper: allow iff `event.isMainFrame === false` AND parsed URL scheme is `chrome-extension:` AND host equals the pinned id (URL-parse, never `startsWith`; parse failure → refuse; strict `=== false` fails closed when the field is absent).
4. **Tests**: carve-out matrix per AC 3 in `guest-wiring.test.js` — **drive the captured per-event handlers** (existing harness pattern), not a single shared function, so the test matches the wrapper shape. Matrix adds: an event lacking `isMainFrame` entirely → refused (pins fail-closed strict equality); subframe `will-redirect` to the viewer URL → refused (the strictness DD5 claims). Endpoint smoke via curl in verification.
5. **Spec + docs**: flip `web-compat-pdf` to `active`; update fixture README endpoint list; remove the `serve.mjs:20` TODO comment (the 302 lands).
6. **FD run decision**: steps 1–4 of the spec avoid window-level captures (viewer surface via `readDom`/`captureScreenshot` tab-level, downloads via `downloadsList` + Bash) — the FD attempts the behavior run under the jar-scoped identity; steps 5–6 (guard probes) also apparatus-light. If any step still blocks, the standing deferred disposition applies.

## Edge Cases

- **PDF served without extension but `application/pdf` MIME**: Chromium routes on MIME; expected to render — note behavior observed during the premise check, no code either way (spec out-of-scope line stands).
- **Viewer subframe navigating onward** (internal viewer navigations): remain within the carve-out only for the pinned id; anything else refused.
- **`plugins: true` interaction with farbling preload** (web branch runs `contextIsolation: false` + farbling): no expected interplay — confirm no console/renderer errors on `/doc.pdf` during the premise check.
- **Download of a PDF the user explicitly saves** (future save-button in viewer): out of scope; the viewer's own save action fires `will-download` and auto-saves per existing behavior — acceptable, note only.

## Files Affected

- `src/main/register-tab-ipc.js` — `plugins: true` web branch
- `src/main/guest-wiring.js` — pinned-id constant + `will-frame-navigate` wrapper (outcome (ii) only)
- `test/unit/guest-wiring.test.js`, `test/unit/register-tab-ipc.test.js` — matrices
- `tests/behavior/fixtures/web-compat/serve.mjs` — `/doc.pdf`, `/doc-attachment.pdf`, `/redirect-302`; `README.md` — endpoint list
- `tests/behavior/web-compat-pdf.md` — status flip

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight: update flight.md status to `landed`, check off flight in mission.md

*(Batched workflow: no commit. This is the final autonomous leg — after it lands, the FD runs the flight-wide review, then the single commit + draft PR.)*

## Citation Audit

Verified at leg design time against the post-leg-03 tree (grep): `guest-wiring.js:91-97` (`guardNav` + three event registrations at `:98-100`), `:86-89` (merged-event comment), `register-tab-ipc.js:104-105` (web branch `contextIsolation: false` + `sandbox: true`; internal at `:94-95`), `app-lifecycle.js:124` (`ALLOWED_NONGUEST_SCHEMES`), `:133` (startsWith allowance), `register-download-ipc.js:143-149` (latch + `will-download` + `setSavePath`), `serve.mjs:194/203/226/232` (existing endpoints), `:20` (302 TODO comment), `session-runtime.js:218-230` (`onHeadersReceived` divert seam — flight-verified). All OK.
