# Leg: prompts-and-bounds

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Six small fixes, each closing something a page or server can do today: stall the browser by flooding title changes or recording enormous addresses; show `trusted.example@evil.example` in the address bar; get a client certificate sent on a stray Enter; put unbounded text on the sign-in card; and one bound on the operator's own history search.

## Context

- **Scope ruling (operator, 2026-11-14)**: "four plus two optional", and drop the rest of what DD7, DD10, DD11 and DD13 listed for this leg. The dropped items and their reasons are recorded as dispositions (see Outputs); nothing else is built.
- **Evidence** (read-only survey with standalone probes on the project's own binaries, 2026-11-14; and leg 1's Q4):
  - A page setting `document.title` to 100 KB strings in a loop delivered 7,000 title events in under 8 s; through the real recorder and store that was about 5 s of database work and a **4 s main-process stall**. Titles have no length cap and no rate limit. In-page navigation events, by contrast, are throttled by Chromium to about 20 per second.
  - A 409 KB address from `pushState` was accepted and recorded; a row with an ~800 KB address cost over 100 ms to insert.
  - The address bar shows the raw committed URL, including `user:pass@` (leg 1, Q4), reachable by a plain link or redirect.
  - The client-certificate picker opens with its first row focused; Enter or Space sends that certificate to the requesting server.
  - The sign-in card renders `The server <host> says: “<realm>”` with the realm uncapped and unescaped (`src/main/auth-challenges.js` `handleLogin`; the card in `src/renderer/menu-overlay.js`). The host is Chromium's, not the server's text.
  - `sanitizeSearchQuery` (`src/main/history-store.js`) has no cap; a 2,000-token pasted query took 8 s. Only the operator (or an automation key holder) can issue a search.
- **Decisions taken at leg design**:
  1. **The title limiter keeps the last title.** Updates arriving faster than the interval are coalesced and the most recent one is written when the interval ends, so a page's final title is always recorded.
  2. **An over-long address is not recorded** rather than truncated — a truncated address is a wrong address.
  3. **`user:pass@` is removed from what the chrome is told and from what history stores**, by one pure helper. Navigation itself is untouched: such URLs still load and still authenticate, as intranet devices need. The automation tab census keeps reporting the real URL.
     *Note 2026-11-14 (flight-end fix pass; the original sentence above stands as written):* the census does NOT keep the real URL. The chrome is told, and therefore the census reports, the address without `user:pass@`. Navigation, reload, the session snapshot, closed-tab capture, tab moves and (after fix C2) load-failure Retry use the real address held in main. Accepted: Enter in the address bar on a cleaned address navigates without the credentials; bookmarking a page reached with credentials stores the cleaned address, and an older bookmark with credentials no longer shows as starred there.
  4. **The certificate picker follows the vault picker**: nothing selected at open, plus the existing 500 ms arming.
- **Risk tier: low**, stated in the flight log: six additive changes of a few lines each, in established patterns, each with survey evidence, none changing a shared interface. No per-leg design review; the flight-end Reviewer covers the code.
- **Not in this leg** (dispositions recorded, not built): arming for the sign-in card and certificate-error Proceed; a rate limit on in-page navigation recording; refusing `user:pass@` URLs; eliding long subdomains in the address bar; pinning the browser's own views; MCP session and audit bounds (Flight 2).

## Inputs

- Branch `flight/01-page-containment` with legs 2–7 landed (uncommitted).
- `src/main/history-recorder.js` (`handleNavigation`, `handleTitleUpdated`, the injected clock), `src/main/history-store.js` (`sanitizeSearchQuery`), `src/main/guest-wiring.js` (the `tab-did-navigate`, `tab-did-navigate-in-page` and `tab-title` pushes), `src/main/auth-challenges.js` (`handleLogin`), `src/shared/sheet-arming.js`, the certificate picker's open handler in `src/renderer/menu-overlay.js`, `test/unit/sheet-arming.test.js`.
- The probe fixture server `tests/behavior/fixtures/page-containment-probe/server.cjs` (port 8231; it already serves a redirect to a `user:pass@` URL for leg 1's Q4).

## Outputs

- The six fixes with unit tests.
- `tests/behavior/address-and-history-bounds.md` (authored with this leg) and one fixture page.
- Dispositions for the dropped items in the flight log; revision notes above DD7, DD10, DD11 and DD13 in the flight spec; a release-checklist item in `docs/RELEASING.md`.

## Acceptance Criteria

### History: titles

- [ ] A title is capped in length (one constant, 512 characters) before it is stored, and title writes for one tab are limited to one per interval (one constant, 1 s): the first update in an interval is written at once; later ones replace a single pending value that is written when the interval ends. A tab's pending value is dropped when the tab is forgotten or navigates to a new visit. The limiter uses the recorder's injected clock and an injected timer so it is unit-tested without real time.
- [ ] The `tab-title` push to the chrome carries a title capped to the same length. (The tab strip keeps updating live; only the length is bounded.)
- [ ] Unit pins: a burst of 1,000 updates in one interval produces one immediate write and one trailing write of the **last** value; a 100 KB title is stored at the cap; the trailing write still passes the four-field visit match from leg `jar-isolation`; forgetting the tab cancels the pending write.

### History: addresses

- [ ] A navigation whose address exceeds a stated length (one constant, 8,192 characters) is not recorded and does not replace the tab's last-visit handle. Unit-pinned at the boundary.
  - *Note 2026-11-14 (flight-end fix pass C5):* the criterion's wording "does not replace the tab's last-visit handle" is superseded: a navigation seen but not recorded now CLEARS the tab's last-visit handle and pending title, so the unrecorded page's title is written nowhere; a suppressed duplicate of the tab's own last address keeps the handle.
- [ ] An address with a username or password is recorded with them removed.

### Address bar

- [ ] One pure shared helper returns a URL string with username and password removed, leaving every other URL byte-identical (it returns its input unchanged when there is nothing to remove or the input does not parse). The URL main sends to the chrome on main-frame commit and on in-page navigation goes through it, as does the address the load-failure path reports if it is main-derived. Unit table: no userinfo; username only; username and password; an IPv6 host; a non-default port; an unparseable string; `about:blank`.
- [ ] Navigation, reload, the session snapshot and credential handling keep using the real URL. A `user:pass@` URL still loads. Unit- or grep-pinned: the helper is applied only to what is displayed and what history stores.
- [ ] `renderer.js` is not edited.

### Client-certificate picker

- [ ] `cert-picker` is listed in the shared arming table at 500 ms, and the picker opens with focus on its list container and no row focused. The roving-key behaviour from "nothing focused" is the one leg `vault-picker-controls` already fixed in the shared controller. `sheet-arming.test.js`'s expectations are updated deliberately (it pins the table's exact contents); a source-scan pin covers the open handler. Cancel and Escape are not delayed (fix C1: the Cancel row is now a dismissal with reason `escape`, a resolution reason, not routed through the arming-gated sender).

### Sign-in card

- [ ] The realm is cleaned in main before it is stored on the challenge: control and format characters removed, typographic and straight double quotes removed, whitespace collapsed, and capped (one constant, 120 characters) with an ellipsis. An empty result reads as no realm. Unit table including a realm that tries to close the quote and continue in the browser's voice, a 100 KB realm, and a realm of only control characters.

### History search

- [ ] `sanitizeSearchQuery` caps the query (one constant each: 256 characters, 16 tokens) before building the full-text expression; an over-long query is cut, not refused. The address-bar suggestion path, which shares the function, is covered by the same cap. Unit-pinned, with a timing-free assertion on the number of tokens emitted.

### Shared mechanisms (each sharer asserted unaffected)

- [ ] **The history recorder** — sharers: tabs and popups (both call the same title method), the `history-changed` broadcast, the jars page, address-bar suggestions. Assertion: recorder and store suites green; a normal single title update is written immediately, exactly as before.
- [ ] **The navigation pushes to the chrome** — sharers: the address bar, the tab strip, site security, the load-failure panel, the session snapshot. Assertion: `guest-wiring.test.js` pins hold; a URL with no userinfo is pushed byte-identical.
- [ ] **The arming table** — sharers: the vault picker. Assertion: its delay and pins unchanged.
- [ ] **The auth-challenge store** — its single-callback invariant and queueing are untouched (`auth-challenges.test.js` green without edits to those pins).

### Behaviour and regression

- [ ] **Non-vacuity, before any source change**, recorded in the flight log: on the unmodified build the fixture page's title loop makes an `enumerateWindows` round trip take longer than one second at least once during the loop, and the address bar shows `probeuser:probepass@` after the redirect. If the stall does not reproduce in the product, record what was measured and continue — the cap and limiter are still built, and the spec's step is then marked as a regression guard rather than a demonstration.
- [ ] `/mission-control:behavior-test address-and-history-bounds` passes (run by the Flight Director).
- [ ] Live smoke (dev mode, env-key scripts) exercises every apparatus primitive against the new state, and: an ordinary page's title appears in history and on the tab; a single-page app's title change after `pushState` is recorded; a `user:pass@` URL loads and authenticates against the fixture if it offers basic auth, or simply loads.
- [ ] `[by-eye]`, deferred to `hat-and-alignment`: the certificate picker opening with nothing selected and ignoring input briefly; the sign-in card with a long or quote-bearing realm.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `renderer.js` ≤ 1505 lines (no edit), evaluate seam 41.

### Docs and artifacts

- [ ] `CLAUDE.md`: one sentence each in the history, address-bar/navigation and auth sections for the new bounds; the sheet section's arming bullet names both menu types.
- [ ] `docs/RELEASING.md` gains a checklist item (operator ruling): on the Windows and macOS installers, download a file and confirm it carries the internet-origin mark / quarantine attribute and that the system warns before running a downloaded program.
- [ ] The flight log's Leg 08 entry records the disposition of each dropped item with its reason, and revision notes (dated, original text kept) are added above DD7, DD10, DD11 and DD13 in `flight.md`. The mission's "trusted prompts" and "main-thread bounds" criteria, which allow acceptance per item, get a dated note listing what was built and what was accepted.

## Verification Steps

1. Fixture page; non-vacuity measurements.
2. Unit suites with the runner's timeout.
3. Neuters: the title limiter bypassed → burst pin red; the userinfo helper bypassed at the push → pin red; `cert-picker` removed from the table → red; the realm cap removed → red.
4. Live smoke; Flight Director: `address-and-history-bounds`.

## Implementation Guidance

1. Fixture and non-vacuity.
2. The pure helpers (userinfo strip, realm clean, search cap) with their tables.
3. Recorder: address cap, userinfo strip, title cap and limiter.
4. Pushes in `guest-wiring.js`; realm in `handleLogin`.
5. Arming table entry and the picker's open handler.
6. Smoke; docs; dispositions and revision notes.

## Edge Cases

- **A title set once, then never again**: written immediately; no trailing write.
- **A title burst ending just before the tab closes**: the pending write is cancelled with the tab; the last written title stands.
- **A navigation during a pending title**: the pending value belonged to the previous visit and is dropped.
- **Popups** use the same recorder method and get the same limiter, keyed by their own contents id.
- **A URL whose only credential is an empty username with a password** (`:pw@host`), or percent-encoded credentials: removed like any other.
- **`blob:`, `data:`, `about:` and internal URLs** pass through the helper unchanged.
- **A realm in a non-Latin script**: kept; only control, format and quote characters are removed.
- **A certificate picker with one certificate**: still opens with nothing selected.

## Files Affected

`src/main/history-recorder.js`, `src/main/history-store.js`, `src/main/guest-wiring.js`, `src/main/auth-challenges.js`, a small pure shared module for the display-URL helper (and realm cleaning if it is shared), `src/shared/sheet-arming.js`, `src/renderer/menu-overlay.js` (the certificate picker's open handler only), their unit tests (`history-recorder`, `history-store`, `guest-wiring`, `auth-challenges`, `sheet-arming`, a new helper test), `tests/behavior/fixtures/page-containment-probe/pages/bounds.html`, `tests/behavior/address-and-history-bounds.md`, `CLAUDE.md`, `docs/RELEASING.md`, `missions/23-security-review-remediation/mission.md` (two dated notes), the flight spec's revision notes.

## Citation Audit

Cited by symbol from the 2026-11-14 survey of the working tree (legs 2–6 landed; leg 7 touched only download files): `history-recorder.js` — `handleNavigation`, `handleTitleUpdated`, `lastVisitByWc`; `history-store.js` — `sanitizeSearchQuery`; `guest-wiring.js` — the `tab-did-navigate` / `tab-did-navigate-in-page` / `tab-title` sends in `wireTabViewEvents` (sent through `sendOrQueue`, which a source pin requires); `auth-challenges.js` — `handleLogin`, `displayHost`; `sheet-arming.js` — the table and `armingDelayFor`; `menu-overlay.js` — the certificate picker's open handler and the vault picker's, which is the pattern to copy. The survey's measurements are in the flight log.

## Post-Completion Checklist

- [ ] Leg status `landed`; flight log entry under `## Leg Progress` with the non-vacuity measurements, constants, neuter text, smoke observations, the dispositions, the by-eye list and any deviation.
- [ ] No commit. Signal `[LAND:leg]`.
